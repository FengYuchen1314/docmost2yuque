import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { defineComponent, nextTick } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBase, Page } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import KnowledgeBaseView from './KnowledgeBaseView.vue'

vi.mock('../../services/api', () => ({
  post: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

const CatalogPanelStub = defineComponent({
  name: 'CatalogPanel',
  props: {
    knowledgeBaseId: { type: String, required: true },
    pages: { type: Array, required: true },
  },
  template: '<div class="catalog-panel-stub">{{ knowledgeBaseId }}:{{ pages.length }}</div>',
})

const AnalyticsDialogStub = defineComponent({
  name: 'AnalyticsDialog',
  props: {
    modelValue: Boolean,
    knowledgeBaseId: String,
  },
  template: '<div v-if="modelValue" class="analytics-dialog-stub">{{ knowledgeBaseId }}</div>',
})

let wrapper: VueWrapper | null = null
let router: Router
let ui: ReturnType<typeof useUiStore>

const firstKnowledgeBase = knowledgeBaseFixture('kb-a', '知识库 A')
const secondKnowledgeBase = knowledgeBaseFixture('kb-b', '知识库 B')
const firstPage = pageFixture('page-a', firstKnowledgeBase.id, '文档 A')
const secondPage = pageFixture('page-b', secondKnowledgeBase.id, '文档 B')

beforeEach(() => {
  vi.mocked(post).mockReset()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('visualViewport', {
    width: 1024, height: 768, offsetLeft: 0, offsetTop: 0, scale: 1,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('KnowledgeBaseView route safety', () => {
  it('clears every page-local overlay immediately and ignores an older route response', async () => {
    const staleFirst = deferred<KnowledgeBase>()
    const pendingSecond = deferred<KnowledgeBase>()
    let firstGetCount = 0
    vi.mocked(post).mockImplementation(async (path, body) => {
      const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
      if (path === '/api/v1/knowledge-bases/get' && knowledgeBaseId === firstKnowledgeBase.id) {
        firstGetCount += 1
        return firstGetCount === 1 ? firstKnowledgeBase : staleFirst.promise
      }
      if (path === '/api/v1/knowledge-bases/get' && knowledgeBaseId === secondKnowledgeBase.id) return pendingSecond.promise
      if (path === '/api/v1/pages/list' && knowledgeBaseId === firstKnowledgeBase.id) return [firstPage]
      if (path === '/api/v1/pages/list' && knowledgeBaseId === secondKnowledgeBase.id) return [secondPage]
      throw new Error('Unexpected POST ' + path)
    })
    await mountView(firstKnowledgeBase.id)

    await wrapper!.get('[aria-label="查看知识库统计"]').trigger('click')
    await wrapper!.get<HTMLInputElement>('[aria-label="搜索此知识库"]').setValue('旧查询')
    await wrapper!.get('[title="网格"]').trigger('click')
    await wrapper!.get('[aria-label="整理目录"]').trigger('click')
    viewModel().requestRemove(firstPage)
    await nextTick()
    expect(wrapper!.find('.catalog-manager-stage').exists()).toBe(true)
    expect(wrapper!.find('.analytics-dialog-stub').exists()).toBe(true)
    expect(document.body.textContent).toContain('文档 A')

    void viewModel().reloadCurrent()
    await flushPromises()
    await router.push('/app/kb/' + secondKnowledgeBase.id)
    await flushPromises()

    expect(wrapper!.text()).not.toContain(firstKnowledgeBase.name)
    expect(wrapper!.find('.catalog-manager-stage').exists()).toBe(false)
    expect(wrapper!.find('.analytics-dialog-stub').exists()).toBe(false)
    expect(document.body.textContent).not.toContain('将“文档 A”移到回收站？')
    expect(wrapper!.get<HTMLInputElement>('[aria-label="搜索此知识库"]').element.value).toBe('')
    expect(wrapper!.get('[title="列表"]').classes()).toContain('active')
    expect(wrapper!.find('.content-empty').exists()).toBe(false)

    pendingSecond.resolve(secondKnowledgeBase)
    await flushPromises()
    staleFirst.resolve({ ...firstKnowledgeBase, name: '过时的知识库 A' })
    await flushPromises()

    expect(wrapper!.text()).toContain(secondKnowledgeBase.name)
    expect(wrapper!.text()).toContain(secondPage.title)
    expect(wrapper!.text()).not.toContain('过时的知识库 A')
  })

  it('keeps a retryable failure state after the closable alert is dismissed', async () => {
    let shouldFail = true
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/knowledge-bases/get') {
        if (shouldFail) throw new Error('知识库服务暂时不可用')
        return firstKnowledgeBase
      }
      if (path === '/api/v1/pages/list') return shouldFail ? [] : [firstPage]
      throw new Error('Unexpected POST ' + path)
    })
    await mountView(firstKnowledgeBase.id)

    expect(wrapper!.get('.content-load-error').text()).toContain('知识库服务暂时不可用')
    expect(wrapper!.find('.content-empty').exists()).toBe(false)

    wrapper!.getComponent({ name: 'VAlert' }).vm.$emit('click:close')
    await nextTick()
    expect(wrapper!.find('.page-error').exists()).toBe(false)
    expect(wrapper!.get('.content-load-error').text()).toContain('知识库加载失败')

    shouldFail = false
    await pageButton('重新加载').trigger('click')
    await flushPromises()

    expect(wrapper!.find('.content-load-error').exists()).toBe(false)
    expect(wrapper!.text()).toContain(firstKnowledgeBase.name)
    expect(wrapper!.text()).toContain(firstPage.title)
  })

  it('rejects a mismatched server response instead of rendering another knowledge base', async () => {
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/knowledge-bases/get') return secondKnowledgeBase
      if (path === '/api/v1/pages/list') return [secondPage]
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView(firstKnowledgeBase.id)

    expect(wrapper!.get('.content-load-error').text()).toContain('知识库响应与当前页面不一致')
    expect(wrapper!.text()).not.toContain(secondKnowledgeBase.name)
    expect(wrapper!.text()).not.toContain(secondPage.title)
  })

  it('redirects a legacy overview entry to the configured knowledge-base homepage', async () => {
    const homepageKnowledgeBase = { ...firstKnowledgeBase, homepagePageId: 'home/page#start' }
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/knowledge-bases/get') return homepageKnowledgeBase
      if (path === '/api/v1/pages/list') return [firstPage]
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView(firstKnowledgeBase.id)

    await vi.waitFor(() => {
      expect(router.currentRoute.value.fullPath).toBe('/app/kb/kb-a/pages/home%2Fpage%23start')
    })
    expect(wrapper!.text()).not.toContain(firstPage.title)
  })

  it('never navigates or reloads the current route when a copy from the previous route completes', async () => {
    const pendingCopy = deferred<Page>()
    mockTwoKnowledgeBases(async (path) => {
      if (path === '/api/v1/pages/copy') return pendingCopy.promise
      throw new Error('Unexpected POST ' + path)
    })
    await mountView(firstKnowledgeBase.id)

    void viewModel().duplicate(firstPage)
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/copy', expect.objectContaining({
      pageId: firstPage.id,
      targetKnowledgeBaseId: firstKnowledgeBase.id,
    }))

    await router.push('/app/kb/' + secondKnowledgeBase.id)
    await flushPromises()
    pendingCopy.resolve({ ...firstPage, id: 'page-a-copy', title: '文档 A 副本' })
    await flushPromises()

    expect(router.currentRoute.value.params.knowledgeBaseId).toBe(secondKnowledgeBase.id)
    expect(ui.toast.text).toBe('')
    expect(pageListCalls(firstKnowledgeBase.id)).toHaveLength(1)
    expect(wrapper!.text()).toContain(secondKnowledgeBase.name)
  })

  it('does not refresh another knowledge base when an earlier trash request completes', async () => {
    const pendingTrash = deferred<void>()
    mockTwoKnowledgeBases(async (path) => {
      if (path === '/api/v1/pages/trash') return pendingTrash.promise
      throw new Error('Unexpected POST ' + path)
    })
    await mountView(firstKnowledgeBase.id)

    viewModel().requestRemove(firstPage)
    void viewModel().remove()
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/trash', { pageId: firstPage.id })

    await router.push('/app/kb/' + secondKnowledgeBase.id)
    await flushPromises()
    pendingTrash.resolve()
    await flushPromises()

    expect(router.currentRoute.value.params.knowledgeBaseId).toBe(secondKnowledgeBase.id)
    expect(ui.toast.text).toBe('')
    expect(pageListCalls(firstKnowledgeBase.id)).toHaveLength(1)
    expect(pageListCalls(secondKnowledgeBase.id)).toHaveLength(1)
  })
})

async function mountView(knowledgeBaseId: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  ui = useUiStore()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/kb/:knowledgeBaseId', component: { template: '<div />' } },
      { path: '/app/kb/:knowledgeBaseId/pages/:pageId', component: { template: '<div />' } },
      { path: '/app/kb/:knowledgeBaseId/settings', component: { template: '<div />' } },
    ],
  })
  await router.push('/app/kb/' + knowledgeBaseId)
  await router.isReady()
  wrapper = mount(KnowledgeBaseView, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router, vuetify],
      stubs: { CatalogPanel: CatalogPanelStub, AnalyticsDialog: AnalyticsDialogStub },
    },
  })
  await flushPromises()
}

function mockTwoKnowledgeBases(extra: (path: string, body: unknown) => Promise<unknown>) {
  vi.mocked(post).mockImplementation(async (path, body) => {
    const knowledgeBaseId = (body as { knowledgeBaseId?: string }).knowledgeBaseId
    if (path === '/api/v1/knowledge-bases/get') return knowledgeBaseId === secondKnowledgeBase.id ? secondKnowledgeBase : firstKnowledgeBase
    if (path === '/api/v1/pages/list') return knowledgeBaseId === secondKnowledgeBase.id ? [secondPage] : [firstPage]
    return extra(path, body)
  })
}

function viewModel() {
  return wrapper!.vm as unknown as {
    reloadCurrent: () => Promise<void>
    requestRemove: (page: Page) => void
    remove: () => Promise<void>
    duplicate: (page: Page) => Promise<void>
  }
}

function pageButton(text: string) {
  const button = wrapper!.findAll('button').find((item) => item.text() === text)
  expect(button, 'page button ' + text).toBeTruthy()
  return button!
}

function pageListCalls(knowledgeBaseId: string) {
  return vi.mocked(post).mock.calls.filter(([path, body]) => (
    path === '/api/v1/pages/list'
    && (body as { knowledgeBaseId?: string }).knowledgeBaseId === knowledgeBaseId
  ))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function knowledgeBaseFixture(id: string, name: string): KnowledgeBase {
  return {
    id, workspaceId: 'workspace', name, slug: id, description: null, icon: '📘',
    ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId: null,
    visibility: 'PRIVATE', allowPublicIndex: false, publishMode: 'MANUAL',
    watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}', catalogRevision: 0,
    createdBy: 'user', createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
  }
}

function pageFixture(id: string, knowledgeBaseId: string, title: string): Page {
  return {
    id, workspaceId: 'workspace', knowledgeBaseId, title, icon: null, cover: null,
    contentType: 'DOCUMENT', path: id, publishMode: 'MANUAL', publishedRevisionId: null,
    publishedAt: null, visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1,
    draftRevision: 1, content: {}, plainText: title, createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z', deletedAt: null,
  }
}
