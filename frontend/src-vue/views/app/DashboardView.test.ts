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
let intersectionCallback: IntersectionObserverCallback | null = null
let disconnectObserver = vi.fn()

beforeEach(() => {
  intersectionCallback = null
  disconnectObserver = vi.fn()
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { intersectionCallback = callback }
    observe() {}
    unobserve() {}
    disconnect() { disconnectObserver() }
  })
  vi.mocked(post).mockReset()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('DashboardView Yuque workbench', () => {
  it('renders the four quick actions, exact document controls and paged plain list', async () => {
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path !== '/api/v1/workbench/page') throw new Error(`Unexpected POST ${path}`)
      const request = body as { reason: string; offset: number }
      return request.offset === 0
        ? workbenchPage(`${request.reason}-first`, 1, true)
        : workbenchPage(`${request.reason}-second`, 2, false)
    })
    await mountDashboard()

    expect(wrapper!.get('h1').text()).toBe('开始')
    expect(wrapper!.findAll('.quick-copy strong').map((item) => item.text())).toEqual([
      '新建文档', '新建知识库', '模板中心', 'AI 帮你写',
    ])
    expect(wrapper!.findAll('.quick-copy small').map((item) => item.text())).toEqual([
      '文档、表格、画板、数据表', '使用知识库整理知识', '从模板中获取灵感', 'AI 助手帮你一键生成文档',
    ])
    expect(wrapper!.findAll('[role="tab"]').map((item) => item.text())).toEqual([
      '编辑过', '浏览过', '我点赞的', '我评论过',
    ])
    expect(wrapper!.findAll('.filter-button').map((item) => item.text())).toEqual(['类型', '归属', '创建者'])
    expect(wrapper!.text()).not.toContain('快速记录')
    expect(wrapper!.text()).not.toContain('待处理消息')
    expect(wrapper!.text()).not.toContain('我的空间')
    expect(wrapper!.text()).toContain('EDITED-first')
    expect(wrapper!.text()).toContain('测试用户 / 测试知识库')
    expect(wrapper!.find('table.document-list').exists()).toBe(true)
    expect(wrapper!.findAll('table.document-list tbody tr')).toHaveLength(1)
    expect(wrapper!.findAll('table.document-list tbody tr td')).toHaveLength(4)

    await wrapper!.get('[data-testid="create-knowledge-base"]').trigger('click')
    expect(useUiStore().createRequest).toEqual({ kind: 'KNOWLEDGE_BASE', workspaceId: 'workspace', source: 'WORKBENCH' })

    expect(wrapper!.text()).not.toContain('加载更多')
    expect(intersectionCallback).not.toBeNull()
    intersectionCallback!([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver)
    await flushPromises()
    expect(wrapper!.text()).toContain('EDITED-second')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/workbench/page', { reason: 'EDITED', offset: 1, limit: 25 })

    await wrapper!.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('VIEWED-first')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/workbench/page', { reason: 'VIEWED', offset: 0, limit: 25 })

    wrapper!.unmount()
    wrapper = null
    expect(disconnectObserver).toHaveBeenCalledOnce()
  })

  it('does not let a slower previous tab response replace the active tab', async () => {
    let resolveEdited!: (page: WorkbenchPage) => void
    const edited = new Promise<WorkbenchPage>((resolve) => { resolveEdited = resolve })
    vi.mocked(post).mockImplementation(async (_path, body) => {
      const reason = (body as { reason: string }).reason
      return reason === 'EDITED' ? edited : workbenchPage('viewed-result', 1, false)
    })
    await mountDashboard(false)

    await wrapper!.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('viewed-result')

    resolveEdited(workbenchPage('stale-edited-result', 1, false))
    await flushPromises()
    expect(wrapper!.text()).toContain('viewed-result')
    expect(wrapper!.text()).not.toContain('stale-edited-result')
  })

  it('keeps a low-profile manual pagination fallback without IntersectionObserver', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    vi.mocked(post).mockImplementation(async (_path, body) => {
      const offset = (body as { offset: number }).offset
      return offset === 0 ? workbenchPage('first', 1, true) : workbenchPage('second', 2, false)
    })
    await mountDashboard()

    const loadMore = wrapper!.findAll('button').find((button) => button.text() === '加载更多')
    expect(loadMore).toBeTruthy()
    await loadMore!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('second')
  })
})

async function mountDashboard(flush = true) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore()
  session.user = { userId: 'user', email: 'user@example.com', displayName: '测试用户', instanceAdmin: false }
  session.workspaces = [{ id: 'workspace', workspaceType: 'PERSONAL', name: 'Yuchen', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'OWNER' }]
  session.knowledgeBases = [{
    id: 'kb', workspaceId: 'workspace', name: '测试知识库', slug: 'test', description: null, icon: null,
    ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId: null, visibility: 'PRIVATE',
    allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}',
    catalogRevision: 0, createdBy: 'user', createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
  }]
  session.selectWorkspace('workspace')
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app', component: DashboardView },
      { path: '/app/:pathMatch(.*)*', component: { template: '<div />' } },
    ],
  })
  await router.push('/app')
  await router.isReady()
  wrapper = mount(DashboardView, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  if (flush) await flushPromises()
  return { pinia, router }
}

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
