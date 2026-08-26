import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkbenchPage } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import DashboardView from './DashboardView.vue'

vi.mock('../../services/api', () => ({
  post: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.mocked(post).mockReset()
  vi.mocked(post).mockImplementation(async (path, body) => {
    if (path === '/api/v1/notifications/list') return []
    if (path === '/api/v1/workbench/page') {
      const offset = (body as { offset: number }).offset
      return offset === 0 ? workbenchPage('first', 1, true) : workbenchPage('second', 2, false)
    }
    throw new Error(`Unexpected POST ${path}`)
  })
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('DashboardView interaction shell', () => {
  it('keeps workbench pagination and creation destination context wired to the UI', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useSessionStore()
    session.user = { userId: 'user', email: 'user@example.com', displayName: '测试用户', instanceAdmin: false }
    session.workspaces = [{ id: 'workspace', workspaceType: 'PERSONAL', name: '个人空间', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'OWNER' }]
    session.knowledgeBases = [{
      id: 'kb', workspaceId: 'workspace', name: '测试知识库', slug: 'test', description: null, icon: null,
      ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId: null, visibility: 'PRIVATE',
      allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}',
      catalogRevision: 0, createdBy: 'user', createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
    }]
    session.selectWorkspace('workspace')
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/app', component: DashboardView }, { path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
    })
    await router.push('/app')
    await router.isReady()

    wrapper = mount(DashboardView, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
    await flushPromises()
    expect(wrapper.text()).toContain('first')
    const loadMore = wrapper.findAll('button').find((button) => button.text().includes('加载更多'))
    expect(loadMore).toBeTruthy()
    await loadMore!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('second')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/workbench/page', { reason: 'EDITED', offset: 1, limit: 25 })

    const createButton = wrapper.findAll('button').find((button) => button.text().trim() === '新建内容')
    expect(createButton).toBeTruthy()
    await createButton!.trigger('click')
    const ui = useUiStore()
    expect(ui.createRequest).toMatchObject({ knowledgeBaseId: 'kb', workspaceId: 'workspace', source: 'WORKBENCH' })
  })
})

function workbenchPage(id: string, nextOffset: number, hasMore: boolean): WorkbenchPage {
  return {
    items: [{
      resourceId: id, resourceType: 'PAGE', workspaceId: 'workspace', knowledgeBaseId: 'kb', knowledgeBaseName: '测试知识库',
      title: id, path: id, contentType: 'DOCUMENT', publicationStatus: 'UNPUBLISHED', reason: 'EDITED',
      activityAt: '2026-08-26T00:00:00Z', favorite: false, collaborators: [],
    }],
    nextOffset,
    hasMore,
  }
}
