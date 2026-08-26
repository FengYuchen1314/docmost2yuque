import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref, type Ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogTree, Comment, Page } from '../../../src/types'
import { isNetworkFailure, queuePageUpdate } from '../../../src/lib/offline'
import { vuetify } from '../../plugins/vuetify'
import { ApiError, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import PageEditorView from './PageEditorView.vue'

vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error {
    constructor(public problem: { status: number; code: string; title: string; detail: string }) {
      super(problem.detail || problem.title)
    }
  },
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
  post: vi.fn(),
  upload: vi.fn(),
}))

interface CollaborationMock {
  status: Ref<string>
  error: Ref<string>
  peers: Ref<unknown[]>
}
let collaborationMock: CollaborationMock | null = null

vi.mock('../../composables/usePageCollaboration', () => ({
  usePageCollaboration: () => {
    const body = ref('')
    const status = ref('idle')
    const error = ref('')
    const peers = ref<unknown[]>([])
    collaborationMock = { status, error, peers }
    return {
      body,
      status,
      error,
      peers,
      lastAcknowledgedSequence: ref(null),
      connect: vi.fn(),
      disconnect: vi.fn(),
      setBody: (value: string) => { body.value = value },
      broadcastSelection: vi.fn(),
    }
  },
}))

vi.mock('../../../src/lib/offline', () => ({
  cachePage: vi.fn().mockResolvedValue(undefined),
  flushPageUpdates: vi.fn().mockResolvedValue({ conflictPageIds: [], remaining: 0 }),
  isNetworkFailure: vi.fn().mockReturnValue(false),
  optimisticPage: (_page: Page, update: { title: string }) => ({ ..._page, title: update.title }),
  queuePageUpdate: vi.fn(),
  readCachedPage: vi.fn().mockResolvedValue(null),
  toPendingPageUpdate: (_userId: string, page: Page, snapshot: { title: string; body: string }) => ({
    userId: _userId,
    pageId: page.id,
    expectedRevision: page.draftRevision,
    title: snapshot.title,
    body: snapshot.body,
    content: page.content,
  }),
}))

let wrapper: VueWrapper | null = null
let router: Router | null = null

beforeEach(() => {
  vi.mocked(post).mockReset()
  vi.mocked(isNetworkFailure).mockReset()
  vi.mocked(isNetworkFailure).mockReturnValue(false)
  vi.mocked(queuePageUpdate).mockReset()
  vi.mocked(queuePageUpdate).mockImplementation(async (update) => update)
  collaborationMock = null
  localStorage.clear()
  stubViewport(1280)
  vi.stubGlobal('visualViewport', null)
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  router = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PageEditorView Yuque editor shell', () => {
  it('renders the focus header and synchronizes the in-document title with its header copy', async () => {
    installImmediatePageApi([pageFixture('page-a', '初始标题')])
    await mountPageEditor('page-a')

    wrapper!.get('header.editor-header')
    expect(wrapper!.get('.header-document-title').text()).toBe('初始标题')
    expect(wrapper!.find('.document-lock').exists()).toBe(false)

    const saveStatus = wrapper!.get('.editor-header-status')
    expect(saveStatus.text()).toBe('已保存')
    expect(saveStatus.attributes()).toMatchObject({ role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' })
    expect(saveStatus.findAll('.v-icon')).toHaveLength(1)
    expect(saveStatus.find('.mdi-check-circle-outline').exists()).toBe(true)
    expect(saveStatus.find('.mdi-cloud-outline').exists()).toBe(false)

    const title = wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]')
    expect(title.element.value).toBe('初始标题')
    await title.setValue('正文内标题')

    expect(wrapper!.get('.header-document-title').text()).toBe('正文内标题')
    expect(wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]').element.value).toBe('正文内标题')
  })

  it('announces the unsaved, saving and saved lifecycle with one precise icon', async () => {
    const page = pageFixture('page-a', '保存状态')
    let resolveUpdate!: (value: Page) => void
    const pendingUpdate = new Promise<Page>((resolve) => { resolveUpdate = resolve })
    installImmediatePageApi([page], [], { update: () => pendingUpdate })
    await mountPageEditor(page.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('正在编辑的正文')
    expect(wrapper!.get('.editor-header-status').text()).toBe('未保存')
    expect(wrapper!.get('.editor-header-status').find('.mdi-circle-medium').exists()).toBe(true)

    await input.trigger('blur', { relatedTarget: document.body })
    expect(wrapper!.get('.editor-header-status').text()).toBe('保存中…')
    expect(wrapper!.get('.editor-header-status').find('.mdi-loading').exists()).toBe(true)
    expect(wrapper!.get('.editor-header-status').findAll('.v-icon')).toHaveLength(1)

    resolveUpdate({ ...page, content: { type: 'doc', content: [{ type: 'paragraph', text: '正在编辑的正文' }] }, plainText: '正在编辑的正文', draftRevision: 2 })
    await flushPromises()

    expect(wrapper!.get('.editor-header-status').text()).toBe('已保存')
    expect(wrapper!.get('.editor-header-status').find('.mdi-check-circle-outline').exists()).toBe(true)
  })

  it('announces an offline queued save without presenting it as synced', async () => {
    const page = pageFixture('page-a', '离线保存')
    const networkFailure = new TypeError('network unavailable')
    vi.mocked(isNetworkFailure).mockImplementation((value) => value === networkFailure)
    installImmediatePageApi([page], [], { update: async () => { throw networkFailure } })
    await mountPageEditor(page.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('排队等待同步的正文')
    await input.trigger('blur', { relatedTarget: document.body })
    await flushPromises()

    const saveStatus = wrapper!.get('.editor-header-status')
    expect(saveStatus.text()).toBe('已离线保存，待同步')
    expect(saveStatus.find('.mdi-cloud-off-outline').exists()).toBe(true)
    expect(vi.mocked(queuePageUpdate)).toHaveBeenCalledOnce()
  })

  it('announces revision conflicts independently from ordinary save errors', async () => {
    const page = pageFixture('page-a', '冲突保存')
    const conflict = new ApiError({ status: 409, code: 'PAGE_REVISION_CONFLICT', title: '版本冲突', detail: '远端版本已更新' })
    installImmediatePageApi([page], [], { update: async () => { throw conflict } })
    await mountPageEditor(page.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('与远端冲突的正文')
    await input.trigger('blur', { relatedTarget: document.body })
    await flushPromises()

    const saveStatus = wrapper!.get('.editor-header-status')
    expect(saveStatus.text()).toBe('保存冲突')
    expect(saveStatus.find('.mdi-alert-circle-outline').exists()).toBe(true)
  })

  it('shows the live collaboration phase and prioritizes connection health over stale peers', async () => {
    installImmediatePageApi([pageFixture('page-a', '协作状态')])
    await mountPageEditor('page-a')
    const collaboration = collaborationMock!
    const state = () => wrapper!.get('.collaboration-state')

    for (const phase of ['idle', 'connecting', 'syncing', 'reconnecting']) {
      collaboration.status.value = phase
      await flushPromises()
      expect(state().get('.collaboration-label').text()).toBe('连接中')
      expect(state().attributes('aria-label')).toBe('实时协作：连接中')
    }

    collaboration.status.value = 'connected'
    await flushPromises()
    expect(state().get('.collaboration-label').text()).toBe('已连接')
    expect(state().find('.collaboration-connected').exists()).toBe(true)

    collaboration.peers.value = [{}, {}]
    await flushPromises()
    expect(state().get('.collaboration-label').text()).toBe('3 人协作')
    expect(state().attributes('aria-label')).toBe('实时协作：3 人协作')

    collaboration.status.value = 'unavailable'
    await flushPromises()
    expect(state().get('.collaboration-label').text()).toBe('协作不可用')
    expect(state().find('.collaboration-unavailable').exists()).toBe(true)
  })

  it('routes a slash image command through the content-card palette and keeps its exact insertion point', async () => {
    installImmediatePageApi([pageFixture('page-a', '插入图片')])
    await mountPageEditor('page-a')

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('/image')
    input.element.focus()
    input.element.setSelectionRange(6, 6)
    await input.trigger('input')
    await wrapper!.get('[data-command="image"]').trigger('click')
    await flushPromises()

    const palette = wrapper!.findComponent({ name: 'ContentCardPalette' })
    expect(palette.props('modelValue')).toBe(true)
    expect(palette.props('allowedKinds')).toEqual(['image'])

    palette.vm.$emit('insert', { token: '{{card:test-image}}' })
    palette.vm.$emit('update:modelValue', false)
    await flushPromises()

    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe('{{card:test-image}}')
    expect(palette.props('allowedKinds')).toEqual([])

    const insertedInput = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    insertedInput.element.focus()
    insertedInput.element.setSelectionRange(insertedInput.element.value.length, insertedInput.element.value.length)
    await wrapper!.get('header [aria-label="插入内容"]').trigger('click')
    await flushPromises()
    expect(palette.props('modelValue')).toBe(true)
    expect(palette.props('allowedKinds')).toEqual([])
    palette.vm.$emit('update:modelValue', false)
    palette.vm.$emit('cancel')
    await flushPromises()
    expect(document.activeElement).toBe(insertedInput.element)
  })

  it('opens the reference panel directly in insertion mode and restores editor focus when cancelled', async () => {
    installImmediatePageApi([pageFixture('page-a', '插入引用')])
    await mountPageEditor('page-a')

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(2, 2)
    await wrapper!.get('[aria-label="引用"]').trigger('click')
    await flushPromises()

    const references = wrapper!.findComponent({ name: 'ReferencePanel' })
    expect(wrapper!.find('aside.editor-side-panel--references').exists()).toBe(true)
    expect(references.props('initialTab')).toBe('INSERT')

    const token = '[[page:target|mode=link]]'
    const original = input.element.value
    references.vm.$emit('insert', { token })
    await flushPromises()
    expect(wrapper!.find('aside.editor-side-panel--references').exists()).toBe(false)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe(`${original.slice(0, 2)} ${token} ${original.slice(2)}`)

    const insertedInput = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    insertedInput.element.focus()
    insertedInput.element.setSelectionRange(1, 1)
    await wrapper!.get('[aria-label="引用"]').trigger('click')
    await flushPromises()
    await wrapper!.get('[aria-label="关闭侧栏"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('aside.editor-side-panel--references').exists()).toBe(false)
    expect(document.activeElement).toBe(insertedInput.element)
    expect(insertedInput.element.selectionStart).toBe(1)
  })

  it('keeps relationship browsing insertable and isolates superseded external insert surfaces', async () => {
    installImmediatePageApi([pageFixture('page-a', '关系浏览')])
    await mountPageEditor('page-a')

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(1, 1)
    await wrapper!.get('[aria-label="更多操作"]').trigger('click')
    await flushPromises()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const relationshipItem = Array.from(document.querySelectorAll<HTMLElement>('.v-list-item'))
      .find((item) => item.textContent?.includes('页面关系'))
    expect(relationshipItem).toBeTruthy()
    relationshipItem!.click()
    await flushPromises()

    let references = wrapper!.findComponent({ name: 'ReferencePanel' })
    expect(references.props('initialTab')).toBe('OUTGOING')
    expect(references.props('allowInsert')).toBe(true)

    await wrapper!.get('header [aria-label="插入内容"]').trigger('click')
    await flushPromises()
    const palette = wrapper!.findComponent({ name: 'ContentCardPalette' })
    expect(wrapper!.find('aside.editor-side-panel--references').exists()).toBe(false)
    expect(palette.props('modelValue')).toBe(true)

    await wrapper!.get('[aria-label="引用"]').trigger('click')
    await flushPromises()
    references = wrapper!.findComponent({ name: 'ReferencePanel' })
    expect(palette.props('modelValue')).toBe(false)
    expect(references.props('initialTab')).toBe('INSERT')

    palette.vm.$emit('cancel')
    references.vm.$emit('insert', { token: '[[page:isolated|mode=link]]' })
    await flushPromises()
    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toContain('[[page:isolated|mode=link]]')
  })

  it('does not let a slower catalog page response overwrite the most recently selected page', async () => {
    const first = pageFixture('page-a', '第一页')
    const slow = pageFixture('page-b', '较慢的第二页')
    const latest = pageFixture('page-c', '最终第三页')
    let resolveSlow!: (page: Page) => void
    const slowResponse = new Promise<Page>((resolve) => { resolveSlow = resolve })

    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/pages/get') {
        const requested = (body as { pageId: string }).pageId
        if (requested === slow.id) return slowResponse
        return requested === latest.id ? latest : first
      }
      if (path === '/api/v1/pages/list') return [first, slow, latest]
      if (path === '/api/v1/catalog/list') return catalogFixture([first, slow, latest])
      if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
      if (path === '/api/v1/activities/page-view') return null
      throw new Error(`Unexpected POST ${path}`)
    })

    await mountPageEditor(first.id)
    expect(wrapper!.find('aside[aria-label="知识库目录"]').exists()).toBe(true)

    const slowRow = wrapper!.findAll('.catalog-row').find((row) => row.text().includes(slow.title))
    expect(slowRow).toBeTruthy()
    await slowRow!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(router!.currentRoute.value.params.pageId).toBe(slow.id))

    const latestRow = wrapper!.findAll('.catalog-row').find((row) => row.text().includes(latest.title))
    expect(latestRow).toBeTruthy()
    await latestRow!.trigger('click')
    await flushPromises()
    await vi.waitFor(() => expect(router!.currentRoute.value.params.pageId).toBe(latest.id))

    expect(router!.currentRoute.value.params.pageId).toBe(latest.id)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]').element.value).toBe(latest.title)

    resolveSlow(slow)
    await flushPromises()

    expect(router!.currentRoute.value.params.pageId).toBe(latest.id)
    expect(wrapper!.get('.header-document-title').text()).toBe(latest.title)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe(`${latest.title}正文`)
  })

  it('saves the dirty source page before a reused editor route switches pageId', async () => {
    const first = pageFixture('page-a', '第一页')
    const next = pageFixture('page-b', '第二页')
    installImmediatePageApi([first, next])
    await mountPageEditor(first.id)

    await wrapper!.get<HTMLTextAreaElement>('textarea.block-input').setValue('切页前必须保存的正文')
    await router!.push(`/app/kb/kb/pages/${next.id}`)
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/update', expect.objectContaining({
      pageId: first.id,
      content: { type: 'doc', content: [{ type: 'paragraph', text: '切页前必须保存的正文' }] },
    }))
    expect(router!.currentRoute.value.params.pageId).toBe(next.id)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe(`${next.title}正文`)
  })

  it('collapses to the narrow Yuque edge handle and opens comments as an inline rail', async () => {
    installImmediatePageApi([pageFixture('page-a', '交互测试')])
    await mountPageEditor('page-a')

    expect(wrapper!.get('[aria-label="切换知识库"]')).toBeTruthy()
    await wrapper!.get('[aria-label="收起侧栏"]').trigger('click')
    expect(wrapper!.find('aside[aria-label="知识库目录"]').exists()).toBe(false)
    expect(wrapper!.get('[aria-label="展开目录"]')).toBeTruthy()
    expect(wrapper!.find('[aria-label="返回知识库"]').exists()).toBe(false)

    await wrapper!.get('[aria-label="展开目录"]').trigger('click')
    expect(wrapper!.find('aside[aria-label="知识库目录"]').exists()).toBe(true)

    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()

    expect(wrapper!.get('aside.editor-side-panel--comments').text()).toContain('划词评论（0）')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/comments/page', { pageId: 'page-a', limit: 50, offset: 0 })
    expect(wrapper!.find('.v-navigation-drawer__scrim').exists()).toBe(false)
  })

  it('keeps catalog, outline and side panels mutually exclusive on a tablet viewport', async () => {
    stubViewport(768)
    installImmediatePageApi([pageFixture('page-a', '平板交互')])
    await mountPageEditor('page-a')

    expect(wrapper!.find('aside[aria-label="知识库目录"]').exists()).toBe(false)
    expect(wrapper!.find('aside[aria-label="文稿大纲"]').exists()).toBe(false)

    const catalogTrigger = wrapper!.get<HTMLElement>('[aria-label="展开目录"]')
    catalogTrigger.element.focus()
    await catalogTrigger.trigger('click')
    await flushPromises()
    expect(wrapper!.get('aside[aria-label="知识库目录"]').attributes('aria-modal')).toBe('true')
    expect(wrapper!.find('.editor-overlay-scrim.catalog-overlay').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper!.get<HTMLInputElement>('input[aria-label="搜索目录"]').element)
    expect(wrapper!.get('header.editor-header').attributes('inert')).toBeDefined()

    await wrapper!.get('.editor-overlay-scrim.catalog-overlay').trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(wrapper!.get<HTMLElement>('[aria-label="展开目录"]').element)

    const referencesTrigger = wrapper!.get<HTMLElement>('[aria-label="引用"]')
    referencesTrigger.element.focus()
    await referencesTrigger.trigger('click')
    await flushPromises()
    expect(wrapper!.get('aside.editor-side-panel--references').attributes('aria-modal')).toBe('true')
    expect(wrapper!.find('.editor-overlay-scrim.side-overlay').exists()).toBe(true)
    expect(document.activeElement).toBe(wrapper!.get<HTMLElement>('[aria-label="关闭侧栏"]').element)
    expect(wrapper!.get('.editor-content').attributes('inert')).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await flushPromises()
    expect(wrapper!.find('aside.editor-side-panel').exists()).toBe(false)
    expect(document.activeElement).toBe(referencesTrigger.element)

    await wrapper!.get('button[aria-label="文稿大纲"]').trigger('click')
    await flushPromises()
    expect(wrapper!.get('aside[aria-label="文稿大纲"]').attributes('aria-modal')).toBe('true')
    await wrapper!.get('[aria-label="展开目录"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('aside[aria-label="文稿大纲"]').exists()).toBe(false)
    expect(wrapper!.find('aside[aria-label="知识库目录"]').exists()).toBe(true)
  })

  it('creates a full-page comment and renders quotes from existing text-range comments', async () => {
    const page = pageFixture('page-a', '全文评论')
    installImmediatePageApi([page], [commentFixture(page, { type: 'TEXT_RANGE', start: 0, end: 4, quote: '已有摘录', draftRevision: 1 })])
    await mountPageEditor(page.id)

    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()
    expect(wrapper!.get('.comment-quote').text()).toContain('已有摘录')
    expect(wrapper!.find('.comment-composer').exists()).toBe(false)

    await wrapper!.get('.comment-compose-trigger').trigger('click')
    await wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').setValue('全文意见')
    await wrapper!.get('form.comment-composer').trigger('submit')
    await flushPromises()

    expect(commentCreateBody()).toEqual(expect.objectContaining({
      workspaceId: page.workspaceId,
      pageId: page.id,
      anchor: { type: 'PAGE' },
      plainText: '全文意见',
      mentionedUserIds: [],
    }))
  })

  it('opens the composer with a selected-text summary and creates a revisioned text-range anchor', async () => {
    const page = pageFixture('page-a', '划词评论')
    installImmediatePageApi([page])
    await mountPageEditor(page.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(0, 4)
    await input.trigger('select')
    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()

    expect(wrapper!.get('.comment-selection-summary').text()).toContain('划词评论')
    await wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').setValue('这里需要解释')
    await wrapper!.get('form.comment-composer').trigger('submit')
    await flushPromises()

    expect(commentCreateBody()).toEqual(expect.objectContaining({
      pageId: page.id,
      anchor: { type: 'TEXT_RANGE', start: 0, end: 4, quote: '划词评论', draftRevision: 1 },
      plainText: '这里需要解释',
    }))
  })

  it('clears a text selection when navigating and falls back to a page anchor on the next page', async () => {
    const first = pageFixture('page-a', '第一页')
    const next = pageFixture('page-b', '第二页')
    installImmediatePageApi([first, next])
    await mountPageEditor(first.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(0, 3)
    await input.trigger('select')
    await router!.push(`/app/kb/kb/pages/${next.id}`)
    await flushPromises()

    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()
    expect(wrapper!.find('.comment-selection-summary').exists()).toBe(false)
    expect(wrapper!.find('.comment-composer').exists()).toBe(false)
    await wrapper!.get('.comment-compose-trigger').trigger('click')
    await wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').setValue('第二页全文意见')
    await wrapper!.get('form.comment-composer').trigger('submit')
    await flushPromises()

    expect(commentCreateBody()).toEqual(expect.objectContaining({pageId: next.id, anchor: { type: 'PAGE' }}))
  })

  it('does not let a late comment submission from the previous page mutate the new page composer', async () => {
    const first = pageFixture('page-a', '第一页')
    const next = pageFixture('page-b', '第二页')
    let resolveOldComment!: (value: unknown) => void
    const oldCommentResponse = new Promise((resolve) => { resolveOldComment = resolve })
    vi.mocked(post).mockImplementation(async (path, body) => {
      if(path==='/api/v1/pages/get')return(body as {pageId:string}).pageId===first.id?first:next
      if(path==='/api/v1/pages/list')return[first,next]
      if(path==='/api/v1/catalog/list')return catalogFixture([first,next])
      if(path==='/api/v1/pages/publication-state')return{published:false,changedSincePublication:false}
      if(path==='/api/v1/favorites/status')return{favorite:false}
      if(path==='/api/v1/comments/page')return{items:[],nextOffset:0,hasMore:false}
      if(path==='/api/v1/comments/create')return oldCommentResponse
      if(path==='/api/v1/activities/page-view')return null
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountPageEditor(first.id)

    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()
    await wrapper!.get('.comment-compose-trigger').trigger('click')
    await wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').setValue('旧页提交')
    await wrapper!.get('form.comment-composer').trigger('submit')

    await router!.push(`/app/kb/kb/pages/${next.id}`)
    await flushPromises()
    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()
    await wrapper!.get('.comment-compose-trigger').trigger('click')
    await wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').setValue('新页草稿')

    resolveOldComment(null)
    await flushPromises()

    expect(router!.currentRoute.value.params.pageId).toBe(next.id)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="评论内容"]').element.value).toBe('新页草稿')
    expect(wrapper!.find('.comment-composer').exists()).toBe(true)
  })

  it('clears the previous page and comment rail when the next page cannot load', async () => {
    const first = pageFixture('page-a', '不应残留的旧页面')
    const next = pageFixture('page-b', '加载失败的新页面')
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/pages/get') {
        const requested = (body as { pageId: string }).pageId
        if (requested === next.id) throw new Error('新页面加载失败')
        return first
      }
      if (path === '/api/v1/pages/list') return [first, next]
      if (path === '/api/v1/catalog/list') return catalogFixture([first, next])
      if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
      if (path === '/api/v1/favorites/status') return { favorite: false }
      if (path === '/api/v1/comments/page') return { items: [{ id: 'comment-a', creatorEmail: 'old@example.test', createdAt: '2026-08-26T00:00:00Z', plainText: '旧页面评论', status: 'OPEN' }], nextOffset: 1, hasMore: false }
      if (path === '/api/v1/activities/page-view') return null
      throw new Error(`Unexpected POST ${path}`)
    })

    await mountPageEditor(first.id)
    await wrapper!.get('[aria-label="评论"]').trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('旧页面评论')

    await router!.push(`/app/kb/kb/pages/${next.id}`)
    await flushPromises()

    expect(wrapper!.find('aside.editor-side-panel').exists()).toBe(false)
    expect(wrapper!.find('textarea[aria-label="文稿标题"]').exists()).toBe(false)
    expect((wrapper!.get('input[aria-label="文稿标题"]').element as HTMLInputElement).value).toBe('')
    expect(wrapper!.text()).not.toContain('旧页面评论')
    expect(wrapper!.text()).toContain('新页面加载失败')
  })

  it('loads favorite state per page instead of carrying it across navigation', async () => {
    const first = pageFixture('page-a', '已收藏页面')
    const next = pageFixture('page-b', '未收藏页面')
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/pages/get') return (body as { pageId: string }).pageId === first.id ? first : next
      if (path === '/api/v1/pages/list') return [first, next]
      if (path === '/api/v1/catalog/list') return catalogFixture([first, next])
      if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
      if (path === '/api/v1/favorites/status') return { favorite: (body as { pageId: string }).pageId === first.id }
      if (path === '/api/v1/activities/page-view') return null
      throw new Error(`Unexpected POST ${path}`)
    })

    await mountPageEditor(first.id)
    expect(wrapper!.get('[aria-label="取消收藏"]')).toBeTruthy()

    await router!.push(`/app/kb/kb/pages/${next.id}`)
    await flushPromises()

    expect(wrapper!.get('[aria-label="收藏"]')).toBeTruthy()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/favorites/status', { pageId: next.id })
  })

  it('keeps unsupported canonical content intact when only the title is edited', async () => {
    const originalContent = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [] }] }] }
    const original = { ...pageFixture('page-a', '结构化旧文稿'), content: originalContent, plainText: '表格内容' }
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/pages/get') return original
      if (path === '/api/v1/pages/list') return [original]
      if (path === '/api/v1/catalog/list') return catalogFixture([original])
      if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
      if (path === '/api/v1/favorites/status') return { favorite: false }
      if (path === '/api/v1/activities/page-view') return null
      if (path === '/api/v1/pages/update') return { ...original, title: (body as { title: string }).title, draftRevision: 2 }
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountPageEditor(original.id)

    expect(wrapper!.text()).toContain('正文已启用只读保护')
    expect(wrapper!.get('.document-lock').attributes('title')).toBe('正文只读保护')
    expect(wrapper!.get('textarea.block-input').attributes('readonly')).toBeDefined()
    const title = wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]')
    expect(title.attributes('readonly')).toBeUndefined()
    await title.setValue('只修改标题')
    await title.trigger('blur', { relatedTarget: document.body })
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/update', expect.objectContaining({
      pageId: original.id,
      title: '只修改标题',
      content: originalContent,
    }))
  })

  it('rejects an invalid successful save response without corrupting the active page', async () => {
    const original = pageFixture('page-a', '有效页面')
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/pages/get') return original
      if (path === '/api/v1/pages/list') return [original]
      if (path === '/api/v1/catalog/list') return catalogFixture([original])
      if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
      if (path === '/api/v1/favorites/status') return { favorite: false }
      if (path === '/api/v1/activities/page-view') return null
      if (path === '/api/v1/pages/update') return {}
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountPageEditor(original.id)

    const input = wrapper!.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('本地新内容')
    await input.trigger('blur', { relatedTarget: document.body })
    await flushPromises()

    expect(wrapper!.get('.header-document-title').text()).toBe(original.title)
    expect(wrapper!.get('.editor-error').text()).toContain('页面响应格式无效')
    expect(wrapper!.find('textarea.block-input').exists()).toBe(true)
  })
})

async function mountPageEditor(pageId: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore()
  session.user = { userId: 'user', email: 'editor@example.test', displayName: '编辑者', instanceAdmin: false }
  session.ready = true

  router = createRouter({
    history: createMemoryHistory(),
    routes: [{
      path: '/app/kb/:knowledgeBaseId/pages/:pageId',
      component: PageEditorView,
      meta: { shell: 'focus' },
    }],
  })
  await router.push(`/app/kb/kb/pages/${pageId}`)
  await router.isReady()

  wrapper = mount({ template: '<router-view />' }, {
    attachTo: document.body,
    global: {
      plugins: [pinia, router, vuetify],
      stubs: {
        AnalyticsDialog: true,
        ContentCardPalette: true,
        PageManagementDialog: true,
        ReferencePanel: true,
        StructuredEditor: true,
        VNavigationDrawer: { template: '<aside><slot /></aside>' },
      },
    },
  })
  await flushPromises()
}

function installImmediatePageApi(
  pages: Page[],
  comments: Comment[] = [],
  options: { update?: (page: Page, body: unknown) => Page | Promise<Page> } = {},
) {
  vi.mocked(post).mockImplementation(async (path, body) => {
    if (path === '/api/v1/pages/get') {
      const pageId = (body as { pageId: string }).pageId
      return pages.find((page) => page.id === pageId) ?? pages[0]!
    }
    if (path === '/api/v1/pages/list') return pages
    if (path === '/api/v1/catalog/list') return catalogFixture(pages)
    if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
    if (path === '/api/v1/favorites/status') return { favorite: false }
    if (path === '/api/v1/comments/page') return { items: comments, nextOffset: comments.length, hasMore: false }
    if (path === '/api/v1/comments/create') return null
    if (path === '/api/v1/pages/update') {
      const update = body as { pageId: string; title: string; content: unknown }
      const current = pages.find((page) => page.id === update.pageId) ?? pages[0]!
      if (options.update) return options.update(current, body)
      return { ...current, title: update.title, content: update.content, draftRevision: current.draftRevision + 1 }
    }
    if (path === '/api/v1/activities/page-view') return null
    throw new Error(`Unexpected POST ${path}`)
  })
}

function commentCreateBody() {
  return vi.mocked(post).mock.calls.find(([path]) => path === '/api/v1/comments/create')?.[1]
}

function commentFixture(page: Page, anchor: unknown): Comment {
  return {
    id: 'comment-existing',
    workspaceId: page.workspaceId,
    pageId: page.id,
    parentId: null,
    anchor,
    body: { type: 'doc', content: [{ type: 'paragraph', text: '已有评论' }] },
    plainText: '已有评论',
    status: 'OPEN',
    createdBy: 'reviewer',
    creatorEmail: 'reviewer@example.test',
    resolvedBy: null,
    resolvedAt: null,
    createdAt: '2026-08-26T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
  }
}

function catalogFixture(pages: Page[]): CatalogTree {
  return {
    knowledgeBaseId: 'kb',
    revision: pages.length,
    nodes: pages.map((page, index) => ({
      id: `node-${page.id}`,
      knowledgeBaseId: 'kb',
      nodeType: 'DOCUMENT',
      pageId: page.id,
      parentId: null,
      position: String(index + 1).padStart(4, '0'),
      titleOverride: null,
      url: null,
    })),
  }
}

function stubViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    const maximum = /max-width:\s*(\d+)px/.exec(query)?.[1]
    const matches = maximum ? width <= Number(maximum) : false
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  }))
}

function pageFixture(id: string, title: string): Page {
  return {
    id,
    workspaceId: 'workspace',
    knowledgeBaseId: 'kb',
    title,
    icon: null,
    cover: null,
    contentType: 'DOCUMENT',
    path: id,
    publishMode: 'MANUAL',
    publishedRevisionId: null,
    publishedAt: null,
    visibilityOverride: 'INHERIT',
    documentSettings: { pageWidth: 'STANDARD', fontFamily: 'SANS', fontSize: 'MEDIUM', paragraphSpacing: 'NORMAL', showOutline: true },
    schemaVersion: 1,
    draftRevision: 1,
    content: { type: 'doc', content: [{ type: 'paragraph', text: `${title}正文` }] },
    plainText: `${title}正文`,
    createdBy: 'user',
    updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z',
    updatedAt: '2026-08-26T00:00:00Z',
    deletedAt: null,
  }
}
