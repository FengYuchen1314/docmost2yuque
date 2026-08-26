import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { CatalogTree, Page } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { post } from '../services/api'
import CatalogPanel from './CatalogPanel.vue'

vi.mock('../services/api', () => ({
  ApiError: class ApiError extends Error { problem = { code: '' } },
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
  post: vi.fn(),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.mocked(post).mockReset()
  vi.stubGlobal('visualViewport', {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('CatalogPanel compact catalog tree', () => {
  it('renders document, group and external-link nodes as 36px rows and collapses descendants', async () => {
    installCatalogApi()
    wrapper = mountPanel()
    await flushPromises()

    const rows = wrapper.findAll('.catalog-node')
    expect(rows).toHaveLength(3)
    expect(rows.map((row) => row.attributes('data-node-type'))).toEqual(['GROUP', 'DOCUMENT', 'LINK'])
    expect(rows[0]!.attributes('style')).toContain('--catalog-depth: 0')
    expect(rows[1]!.attributes('style')).toContain('--catalog-depth: 1')
    expect(rows[0]!.findAll('.node-actions button')).toHaveLength(1)

    await rows[0]!.get('button.collapse-button').trigger('click')
    await nextTick()
    await flushPromises()
    expect(wrapper.findAll('.catalog-node')).toHaveLength(2)
    expect(wrapper.text()).not.toContain('入门文档')
  })

  it('keeps drag sorting wired to the atomic catalog move endpoint', async () => {
    installCatalogApi()
    wrapper = mountPanel()
    await flushPromises()

    const rows = wrapper.findAll('.catalog-node')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    await rows[1]!.trigger('dragstart', { dataTransfer })
    await rows[2]!.trigger('drop')
    await flushPromises()

    expect(post).toHaveBeenCalledWith('/api/v1/catalog/move', expect.objectContaining({
      nodeId: 'document',
      targetParentId: null,
      beforeNodeId: 'link',
      expectedRevision: 7,
    }))
  })

  it('shows a compact retryable error state instead of an empty tree when loading fails', async () => {
    vi.mocked(post).mockRejectedValue(new Error('目录读取失败'))
    wrapper = mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('目录读取失败')
    expect(wrapper.find('.catalog-load-error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('目录为空')
    expect(wrapper.find('.section-card').exists()).toBe(false)
  })

  it('accepts credential-free HTTP and HTTPS external links while rejecting unsafe schemes', async () => {
    installCatalogApi()
    wrapper = mountPanel()
    await flushPromises()
    const vm = wrapper.vm as unknown as { createUrl: string; secureCreateUrl: string | null }

    vm.createUrl = 'http://docs.example.test/guide'
    await nextTick()
    expect(vm.secureCreateUrl).toBe('http://docs.example.test/guide')

    vm.createUrl = 'https://docs.example.test/guide'
    await nextTick()
    expect(vm.secureCreateUrl).toBe('https://docs.example.test/guide')

    vm.createUrl = 'https://user:secret@docs.example.test/guide'
    await nextTick()
    expect(vm.secureCreateUrl).toBeNull()

    vm.createUrl = 'javascript:alert(1)'
    await nextTick()
    expect(vm.secureCreateUrl).toBeNull()
  })

  it('clears the loaded catalog and history immediately while the next knowledge base is pending or fails', async () => {
    const nextCatalog = deferred<CatalogTree>()
    const nextHistory = deferred<HistoryPage>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
      if (knowledgeBaseId === 'kb-a' && path === '/api/v1/catalog/list') return switchCatalogFixture('kb-a', '旧库', 11)
      if (knowledgeBaseId === 'kb-a' && path === '/api/v1/catalog/history/page') return historyFixture('kb-a', 11)
      if (knowledgeBaseId === 'kb-b' && path === '/api/v1/catalog/list') return nextCatalog.promise
      if (knowledgeBaseId === 'kb-b' && path === '/api/v1/catalog/history/page') return nextHistory.promise
      throw new Error(`Unexpected POST ${path}`)
    })

    wrapper = mountPanel({ knowledgeBaseId: 'kb-a', showHistory: true })
    await flushPromises()
    expect(wrapper.text()).toContain('旧库分组')
    expect(wrapper.text()).toContain('v11')

    await wrapper.setProps({ knowledgeBaseId: 'kb-b' })
    await nextTick()

    expect(wrapper.text()).not.toContain('旧库分组')
    expect(wrapper.text()).not.toContain('v11')
    expect(wrapper.findAll('.history-row')).toHaveLength(0)
    expect(wrapper.find('.catalog-skeleton').exists()).toBe(true)

    nextCatalog.reject(new Error('新库目录读取失败'))
    nextHistory.reject(new Error('新库历史读取失败'))
    await flushPromises()

    expect(wrapper.text()).toContain('新库目录读取失败')
    expect(wrapper.text()).toContain('新库历史读取失败')
    expect(wrapper.text()).not.toContain('旧库分组')
    expect(wrapper.findAll('.history-row')).toHaveLength(0)
  })

  it('ignores catalog and history responses that arrive after switching knowledge bases', async () => {
    const oldCatalog = deferred<CatalogTree>()
    const oldHistory = deferred<HistoryPage>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
      if (knowledgeBaseId === 'kb-a' && path === '/api/v1/catalog/list') return oldCatalog.promise
      if (knowledgeBaseId === 'kb-a' && path === '/api/v1/catalog/history/page') return oldHistory.promise
      if (knowledgeBaseId === 'kb-b' && path === '/api/v1/catalog/list') return switchCatalogFixture('kb-b', '新库', 22)
      if (knowledgeBaseId === 'kb-b' && path === '/api/v1/catalog/history/page') return historyFixture('kb-b', 22)
      throw new Error(`Unexpected POST ${path}`)
    })

    wrapper = mountPanel({ knowledgeBaseId: 'kb-a', showHistory: true })
    await nextTick()
    await wrapper.setProps({ knowledgeBaseId: 'kb-b' })
    await flushPromises()

    expect(wrapper.text()).toContain('新库分组')
    expect(wrapper.text()).toContain('v22')

    oldCatalog.resolve(switchCatalogFixture('kb-a', '旧库晚到', 99))
    oldHistory.resolve(historyFixture('kb-a', 99))
    await flushPromises()

    expect(wrapper.text()).toContain('新库分组')
    expect(wrapper.text()).toContain('v22')
    expect(wrapper.text()).not.toContain('旧库晚到')
    expect(wrapper.text()).not.toContain('v99')
  })

  it('does not apply a late mutation result to the newly selected knowledge base', async () => {
    const oldMutation = deferred<CatalogTree>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
      if (path === '/api/v1/catalog/list' && knowledgeBaseId === 'kb-a') return switchCatalogFixture('kb-a', '旧库', 11)
      if (path === '/api/v1/catalog/list' && knowledgeBaseId === 'kb-b') return switchCatalogFixture('kb-b', '新库', 22)
      if (path === '/api/v1/catalog/move') return oldMutation.promise
      throw new Error(`Unexpected POST ${path}`)
    })

    wrapper = mountPanel({ knowledgeBaseId: 'kb-a', showHistory: false })
    await flushPromises()
    const rows = wrapper.findAll('.catalog-node')
    const dataTransfer = { setData: vi.fn(), effectAllowed: '' }
    await rows[1]!.trigger('dragstart', { dataTransfer })
    await rows[2]!.trigger('drop')
    await nextTick()

    await wrapper.setProps({ knowledgeBaseId: 'kb-b' })
    await flushPromises()
    expect(wrapper.text()).toContain('新库分组')

    oldMutation.resolve(switchCatalogFixture('kb-a', '旧 mutation 晚到', 99))
    await flushPromises()

    expect(wrapper.text()).toContain('新库分组')
    expect(wrapper.text()).not.toContain('旧 mutation 晚到')
    expect(wrapper.emitted('catalog-change')).toBeUndefined()
  })

  it('closes an old knowledge-base confirmation before the new catalog can be operated on', async () => {
    vi.mocked(post).mockImplementation(async (path, body) => {
      const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
      if (path === '/api/v1/catalog/list') return switchCatalogFixture(knowledgeBaseId!, knowledgeBaseId === 'kb-a' ? '旧库' : '新库', knowledgeBaseId === 'kb-a' ? 11 : 22)
      throw new Error(`Unexpected POST ${path}`)
    })

    wrapper = mountPanel({ knowledgeBaseId: 'kb-a', showHistory: false })
    await flushPromises()
    const vm = wrapper.vm as unknown as {
      askForConfirmation: (value: { kind: 'REMOVE'; node: CatalogTree['nodes'][number] }) => void
      confirmation: unknown
      renameOpen: boolean
      copyOpen: boolean
    }
    vm.askForConfirmation({ kind: 'REMOVE', node: switchCatalogFixture('kb-a', '旧库', 11).nodes[0]! })
    await nextTick()
    expect(vm.confirmation).not.toBeNull()

    await wrapper.setProps({ knowledgeBaseId: 'kb-b' })
    await flushPromises()

    expect(vm.confirmation).toBeNull()
    expect(vm.renameOpen).toBe(false)
    expect(vm.copyOpen).toBe(false)
    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/catalog/remove' || path === '/api/v1/catalog/batch' || path === '/api/v1/pages/trash')).toBe(false)
  })
})

function mountPanel(options: { knowledgeBaseId?: string; pages?: Page[]; showHistory?: boolean } = {}) {
  return mount(CatalogPanel, {
    attachTo: document.body,
    props: {
      knowledgeBaseId: options.knowledgeBaseId ?? 'kb',
      pages: options.pages ?? [pageFixture()],
      showHistory: options.showHistory ?? false,
    },
    global: { plugins: [vuetify] },
  })
}

function installCatalogApi() {
  vi.mocked(post).mockImplementation(async (path) => {
    if (path === '/api/v1/catalog/list') return catalogFixture()
    if (path === '/api/v1/catalog/move') return { ...catalogFixture(), revision: 8 }
    throw new Error(`Unexpected POST ${path}`)
  })
}

function catalogFixture(): CatalogTree {
  return {
    knowledgeBaseId: 'kb',
    revision: 7,
    nodes: [
      { id: 'group', knowledgeBaseId: 'kb', nodeType: 'GROUP', pageId: null, parentId: null, position: '0001', titleOverride: '开始使用', url: null },
      { id: 'document', knowledgeBaseId: 'kb', nodeType: 'DOCUMENT', pageId: 'page', parentId: 'group', position: '0001', titleOverride: null, url: null },
      { id: 'link', knowledgeBaseId: 'kb', nodeType: 'LINK', pageId: null, parentId: null, position: '0002', titleOverride: '产品主页', url: 'https://example.com/' },
    ],
  }
}

interface HistoryPage {
  items: Array<{
    id: string
    knowledgeBaseId: string
    revisionNo: number
    operation: string
    actorId: string
    snapshot: unknown
    createdAt: string
  }>
  nextOffset: number
  hasMore: boolean
}

function switchCatalogFixture(knowledgeBaseId: string, label: string, revision: number): CatalogTree {
  return {
    knowledgeBaseId,
    revision,
    nodes: [
      { id: `${knowledgeBaseId}-group`, knowledgeBaseId, nodeType: 'GROUP', pageId: null, parentId: null, position: '0001', titleOverride: `${label}分组`, url: null },
      { id: `${knowledgeBaseId}-document`, knowledgeBaseId, nodeType: 'DOCUMENT', pageId: null, parentId: null, position: '0002', titleOverride: `${label}文档`, url: null },
      { id: `${knowledgeBaseId}-link`, knowledgeBaseId, nodeType: 'LINK', pageId: null, parentId: null, position: '0003', titleOverride: `${label}链接`, url: 'https://example.com/' },
    ],
  }
}

function historyFixture(knowledgeBaseId: string, revisionNo: number): HistoryPage {
  return {
    items: [{
      id: `${knowledgeBaseId}-revision-${revisionNo}`,
      knowledgeBaseId,
      revisionNo,
      operation: 'CREATE',
      actorId: 'user',
      snapshot: {},
      createdAt: '2026-08-26T00:00:00Z',
    }],
    nextOffset: 1,
    hasMore: false,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function pageFixture(): Page {
  return {
    id: 'page', workspaceId: 'workspace', knowledgeBaseId: 'kb', title: '入门文档', icon: null, cover: null,
    contentType: 'DOCUMENT', path: 'getting-started', publishMode: 'MANUAL', publishedRevisionId: null, publishedAt: null,
    visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 1,
    content: { type: 'doc', content: [] }, plainText: '', createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', deletedAt: null,
  }
}
