import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { EmbeddedPageView, KnowledgeGraph, Page, PageReferenceSummary } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { post } from '../services/api'
import ReferencePanel from './ReferencePanel.vue'

vi.mock('../services/api', () => ({
  post: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.mocked(post).mockReset()
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

describe('ReferencePanel', () => {
  it('loads relations, resolves previews, opens references and inserts a selected page', async () => {
    installReferenceApi()
    wrapper = await mountPanel()

    await vi.waitFor(() => expect(wrapper!.text()).toContain('接口说明'))
    await vi.waitFor(() => expect(wrapper!.text()).toContain('这是引用预览'))
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/page-references/outgoing', { pageId: 'page-current' })
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/page-references/backlinks', { pageId: 'page-current' })

    await wrapper.get('.reference-row').trigger('click')
    expect(wrapper.emitted('open-page')?.[0]?.[0]).toEqual({ pageId: 'page-source', knowledgeBaseId: 'kb-source' })

    await tabButton('插入').trigger('click')
    await wrapper.get('.page-option').trigger('click')
    await wrapper.get('.insert-actions button').trigger('click')

    expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual({
      token: '[[page:page-candidate|mode=link]]',
      targetPageId: 'page-candidate',
      knowledgeBaseId: 'kb-current',
      mode: 'LINK',
      blockId: null,
      fixedPublicationId: null,
    })
  })

  it('loads the knowledge graph only when its tab is opened', async () => {
    installReferenceApi()
    wrapper = await mountPanel()

    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/page-references/graph')).toBe(false)
    await tabButton('图谱').trigger('click')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/page-references/graph', { pageId: 'page-current', depth: 3, limit: 100 })
    expect(wrapper.find('svg[aria-label="页面知识图谱"]').exists()).toBe(true)
  })

  it('keeps fixed-version insertion and block-id sanitizing intact', async () => {
    installReferenceApi()
    wrapper = await mountPanel([
      page('page-current', '当前页面'),
      { ...page('page-candidate', '已发布目标'), publishedRevisionId: 'publication-1' },
    ])

    await tabButton('插入').trigger('click')
    await wrapper.get('.page-option').trigger('click')
    const fixedMode = wrapper.findAll('.mode-picker button').find((item) => item.text().includes('固定版本'))
    expect(fixedMode).toBeTruthy()
    await fixedMode!.trigger('click')
    await wrapper.get('input[placeholder="留空则嵌入整篇内容"]').setValue('章节 1/$')
    await wrapper.get('.insert-actions button').trigger('click')

    expect(wrapper.emitted('insert')?.[0]?.[0]).toEqual({
      token: '{{embed:page-candidate#章节-1--|mode=fixed|publication=publication-1}}',
      targetPageId: 'page-candidate',
      knowledgeBaseId: 'kb-current',
      mode: 'FIXED',
      blockId: '章节-1--',
      fixedPublicationId: 'publication-1',
    })
  })

  it('removes stale relations immediately when the page changes and the new request fails', async () => {
    vi.mocked(post).mockImplementation(async (path, body) => {
      const requestedPageId = (body as { pageId?: string } | undefined)?.pageId
      if (path === '/api/v1/page-references/outgoing') {
        if (requestedPageId === 'page-new') throw new Error('新页面关系加载失败')
        return [outgoing()]
      }
      if (path === '/api/v1/page-references/backlinks') {
        if (requestedPageId === 'page-new') throw new Error('新页面关系加载失败')
        return []
      }
      if (path === '/api/v1/page-references/resolve') return preview()
      throw new Error(`Unexpected POST ${path}`)
    })
    wrapper = await mountPanel()
    await vi.waitFor(() => expect(wrapper!.text()).toContain('接口说明'))

    await wrapper.setProps({ pageId: 'page-new' })
    await flushPromises()

    expect(wrapper.text()).not.toContain('接口说明')
    expect(wrapper.text()).not.toContain('这是引用预览')
    expect(wrapper.text()).toContain('新页面关系加载失败')
  })

  it('treats malformed relation arrays as empty instead of crashing preview loading', async () => {
    vi.mocked(post).mockResolvedValue({})
    wrapper = await mountPanel()
    await flushPromises()

    expect(wrapper.text()).toContain('还没有引用其他页面')
    expect(wrapper.find('.reference-row').exists()).toBe(false)
  })
})

async function mountPanel(pages = [page('page-current', '当前页面'), page('page-candidate', '引用目标')]) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/app/kb/:knowledgeBaseId/pages/:pageId', component: { template: '<div />' } }],
  })
  await router.push('/app/kb/kb-current/pages/page-current')
  await router.isReady()
  const mounted = mount(ReferencePanel, {
    props: {
      pageId: 'page-current',
      pages,
      allowInsert: true,
      navigateOnOpen: false,
    },
    global: { plugins: [router, vuetify] },
  })
  await flushPromises()
  return mounted
}

function tabButton(text: string) {
  const button = wrapper!.findAll('.reference-tabs > button').find((item) => item.text().startsWith(text))
  expect(button, `tab containing ${text}`).toBeTruthy()
  return button!
}

function installReferenceApi() {
  vi.mocked(post).mockImplementation(async (path) => {
    if (path === '/api/v1/page-references/outgoing') return [outgoing()]
    if (path === '/api/v1/page-references/backlinks') return []
    if (path === '/api/v1/page-references/resolve') return preview()
    if (path === '/api/v1/page-references/graph') return graph()
    throw new Error(`Unexpected POST ${path}`)
  })
}

function outgoing(): PageReferenceSummary {
  return {
    referenceId: 'reference-1', direction: 'OUTGOING', sourceScope: 'DRAFT', kind: 'EMBED', mode: 'CARD',
    targetBlockId: null, fixedPublicationId: null, accessible: true, pageId: 'page-source', knowledgeBaseId: 'kb-source',
    title: '接口说明', contentType: 'DOCUMENT', path: 'api', updatedAt: '2026-08-26T00:00:00Z',
  }
}

function preview(): EmbeddedPageView {
  return {
    referenceId: 'reference-1', status: 'READY', mode: 'CARD', pageId: 'page-source', title: '接口说明',
    contentType: 'DOCUMENT', content: null, plainText: '这是引用预览', targetBlockId: null, publicationId: null, snapshotAt: null,
  }
}

function graph(): KnowledgeGraph {
  return {
    rootPageId: 'page-current',
    nodes: [
      { pageId: 'page-current', knowledgeBaseId: 'kb-current', title: '当前页面', contentType: 'DOCUMENT' },
      { pageId: 'page-source', knowledgeBaseId: 'kb-source', title: '接口说明', contentType: 'DOCUMENT' },
    ],
    edges: [{ referenceId: 'reference-1', sourcePageId: 'page-current', targetPageId: 'page-source', kind: 'EMBED', mode: 'CARD' }],
    truncated: false,
  }
}

function page(id: string, title: string): Page {
  return {
    id, workspaceId: 'workspace', knowledgeBaseId: 'kb-current', title, icon: null, cover: null,
    contentType: 'DOCUMENT', path: id, publishMode: 'MANUAL', publishedRevisionId: null, publishedAt: null,
    visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 1,
    content: { type: 'doc', content: [] }, plainText: '', createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', deletedAt: null,
  }
}
