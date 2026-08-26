import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBase } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import WorkspaceView from './WorkspaceView.vue'

vi.mock('../../services/api', () => ({
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

describe('WorkspaceView knowledge-base navigation', () => {
  it('uses the configured homepage as the knowledge-base entry point', async () => {
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/knowledge-bases/list') {
        return [
          knowledgeBase('kb/workspace', '有首页', 'home#page'),
          knowledgeBase('kb-overview', '无首页', null),
        ]
      }
      throw new Error(`Unexpected POST ${path}`)
    })

    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useSessionStore()
    session.workspaces = [{
      id: 'workspace', workspaceType: 'PERSONAL', name: '个人空间', defaultVisibility: 'PRIVATE',
      defaultPublishMode: 'MANUAL', membershipRole: 'OWNER',
    }]
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/app/w/:workspaceId', component: WorkspaceView },
        { path: '/app/:pathMatch(.*)*', component: { template: '<div />' } },
      ],
    })
    await router.push('/app/w/workspace')
    await router.isReady()

    wrapper = mount(WorkspaceView, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
    await flushPromises()

    expect(wrapper.findAll('.resource-list a').map((link) => link.attributes('href'))).toEqual([
      '/app/kb/kb%2Fworkspace/pages/home%23page',
      '/app/kb/kb-overview',
    ])
  })
})

function knowledgeBase(id: string, name: string, homepagePageId: string | null): KnowledgeBase {
  return {
    id, workspaceId: 'workspace', name, slug: 'unused-slug', description: null, icon: null,
    ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId, visibility: 'PRIVATE',
    allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}',
    catalogRevision: 0, createdBy: 'user', createdAt: '2026-08-27T00:00:00Z', updatedAt: '2026-08-27T00:00:00Z',
  }
}
