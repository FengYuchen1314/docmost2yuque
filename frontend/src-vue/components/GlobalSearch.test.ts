import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { SearchResponse } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { post } from '../services/api'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import GlobalSearch from './GlobalSearch.vue'

vi.mock('../services/api', () => ({
  post: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
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

describe('GlobalSearch command palette', () => {
  it('searches every enabled resource type and opens the active result with Enter', async () => {
    const { router, ui } = await mountSearch()
    vi.mocked(post).mockResolvedValue(response())

    ui.searchOpen = true
    await nextTick()
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="搜索工作区"]')
    expect(input).toBeTruthy()
    input!.value = '接口'
    input!.dispatchEvent(new Event('input', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 260))
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/search', expect.objectContaining({
      workspaceId: 'workspace',
      query: '接口',
      resourceTypes: ['PAGE', 'QUICK_NOTE', 'KNOWLEDGE_BASE', 'TEAM', 'USER', 'TEMPLATE', 'ATTACHMENT'],
      offset: 0,
      limit: 40,
    }))
    expect(document.body.textContent).toContain('接口说明')

    input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/app/kb/kb/pages/page'))
    expect(ui.searchOpen).toBe(false)
  })
})

async function mountSearch() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore()
  session.workspaces = [{ id: 'workspace', workspaceType: 'PERSONAL', name: 'Yuchen', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'OWNER' }]
  session.selectWorkspace('workspace')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app', component: { template: '<div />' } },
      { path: '/app/kb/:knowledgeBaseId/pages/:pageId', component: { template: '<div />' } },
    ],
  })
  await router.push('/app')
  await router.isReady()
  wrapper = mount(GlobalSearch, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  return { router, ui: useUiStore() }
}

function response(): SearchResponse {
  return {
    results: [{
      documentId: 'PAGE-page', resourceId: 'page', resourceType: 'PAGE', sourceScope: 'CANONICAL',
      title: '接口说明', snippet: '接口正文', path: 'api', contentType: 'DOCUMENT', publicationId: null,
      knowledgeBaseId: 'kb', score: 1, updatedAt: '2026-08-26T00:00:00Z',
    }],
    nextOffset: 1,
    hasMore: false,
  }
}
