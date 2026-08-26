import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { VApp } from 'vuetify/components'
import type { KnowledgeBase } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { useSessionStore } from '../stores/session'
import AppLayout from './AppLayout.vue'

vi.mock('../../src/lib/offline', () => ({
  OFFLINE_QUEUE_EVENT: 'offline-queue-change',
  pendingPageUpdateCount: vi.fn().mockResolvedValue(0),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  localStorage.clear()
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('AppLayout knowledge-base navigation', () => {
  it('opens configured homepages and keeps overview links for other knowledge bases', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const session = useSessionStore()
    session.user = { userId: 'user', email: 'user@example.com', displayName: '用户', instanceAdmin: false }
    session.workspaces = [{
      id: 'workspace', workspaceType: 'PERSONAL', name: '个人空间', defaultVisibility: 'PRIVATE',
      defaultPublishMode: 'MANUAL', membershipRole: 'OWNER',
    }]
    session.knowledgeBases = [
      knowledgeBase('kb/home', '产品手册', 'page start'),
      knowledgeBase('kb-overview', '无首页知识库', null),
    ]
    session.selectWorkspace('workspace')
    vi.spyOn(session, 'loadNavigation').mockResolvedValue()

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/app', component: { template: '<div />' } },
        { path: '/app/:pathMatch(.*)*', component: { template: '<div />' } },
      ],
    })
    await router.push('/app')
    await router.isReady()

    wrapper = mount({
      components: { AppLayout, VApp },
      template: '<VApp><AppLayout /></VApp>',
    }, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
    await flushPromises()

    const links = wrapper.findAll('.knowledge-list a')
    expect(links.map((link) => link.attributes('href'))).toEqual([
      '/app/kb/kb%2Fhome/pages/page%20start',
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
