import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { ref } from 'vue'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CatalogTree, Page } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import PageEditorView from './PageEditorView.vue'

vi.mock('../../services/api', () => ({
  ApiError: class ApiError extends Error { problem = { code: '' } },
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
  post: vi.fn(),
  upload: vi.fn(),
}))

vi.mock('../../composables/usePageCollaboration', () => ({
  usePageCollaboration: () => {
    const body = ref('')
    return {
      body,
      status: ref('idle'),
      error: ref(''),
      peers: ref([]),
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

    const title = wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]')
    expect(title.element.value).toBe('初始标题')
    await title.setValue('正文内标题')

    expect(wrapper!.get('.header-document-title').text()).toBe('正文内标题')
    expect(wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]').element.value).toBe('正文内标题')
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
    await wrapper!.get('.catalog-header-toggle').trigger('click')

    const slowRow = wrapper!.findAll('.catalog-row').find((row) => row.text().includes(slow.title))
    expect(slowRow).toBeTruthy()
    await slowRow!.trigger('click')
    await flushPromises()

    const latestRow = wrapper!.findAll('.catalog-row').find((row) => row.text().includes(latest.title))
    expect(latestRow).toBeTruthy()
    await latestRow!.trigger('click')
    await flushPromises()

    expect(router!.currentRoute.value.params.pageId).toBe(latest.id)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]').element.value).toBe(latest.title)

    resolveSlow(slow)
    await flushPromises()

    expect(router!.currentRoute.value.params.pageId).toBe(latest.id)
    expect(wrapper!.get('.header-document-title').text()).toBe(latest.title)
    expect(wrapper!.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe(`${latest.title}正文`)
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

function installImmediatePageApi(pages: Page[]) {
  vi.mocked(post).mockImplementation(async (path, body) => {
    if (path === '/api/v1/pages/get') {
      const pageId = (body as { pageId: string }).pageId
      return pages.find((page) => page.id === pageId) ?? pages[0]!
    }
    if (path === '/api/v1/pages/list') return pages
    if (path === '/api/v1/catalog/list') return catalogFixture(pages)
    if (path === '/api/v1/pages/publication-state') return { published: false, changedSincePublication: false }
    if (path === '/api/v1/activities/page-view') return null
    throw new Error(`Unexpected POST ${path}`)
  })
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
