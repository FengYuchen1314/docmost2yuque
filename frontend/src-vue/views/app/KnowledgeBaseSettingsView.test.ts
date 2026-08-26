import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { KnowledgeBase, Team } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { get, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import KnowledgeBaseSettingsView from './KnowledgeBaseSettingsView.vue'

vi.mock('../../services/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  resetCsrf: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

interface TransferBody { knowledgeBaseId: string; ownerType: string; ownerId: string }
interface OwnerItem { value: string; title: string }

let wrapper: VueWrapper | null = null
let knowledgeBase: KnowledgeBase
let capabilities: Record<string, string[]>
let transferHandler: (body: TransferBody) => Promise<KnowledgeBase>
let session: ReturnType<typeof useSessionStore>
let ui: ReturnType<typeof useUiStore>
let router: Router

const managedTeam: Team = {
  id: 'team-managed', workspaceId: 'workspace', name: '研发团队', slug: 'engineering',
  description: null, avatar: null, visibility: 'WORKSPACE',
}
const deniedTeam: Team = {
  id: 'team-denied', workspaceId: 'workspace', name: '财务团队', slug: 'finance',
  description: null, avatar: null, visibility: 'WORKSPACE',
}

beforeEach(() => {
  knowledgeBase = knowledgeBaseFixture()
  capabilities = {
    'KNOWLEDGE_BASE:kb': ['READ', 'MANAGE'],
    'WORKSPACE:workspace': ['READ', 'MANAGE'],
    'TEAM:team-managed': ['READ', 'MANAGE'],
    'TEAM:team-denied': ['READ'],
  }
  transferHandler = async (body) => {
    knowledgeBase = { ...knowledgeBase, ownerType: body.ownerType, ownerId: body.ownerId, teamId: body.ownerType === 'TEAM' ? body.ownerId : null }
    return knowledgeBase
  }
  vi.mocked(get).mockReset()
  vi.mocked(post).mockReset()
  vi.mocked(resetCsrf).mockReset()
  vi.mocked(post).mockImplementation(async (path, body) => {
    if (path === '/api/v1/knowledge-bases/get') return knowledgeBase
    if (path === '/api/v1/pages/list' || path === '/api/v1/knowledge-bases/members') return []
    if (path === '/api/v1/workspaces/members') {
      return [{ userId: 'user', email: 'user@example.com', displayName: '当前用户', role: 'MEMBER' }]
    }
    if (path === '/api/v1/teams/list') return [managedTeam, deniedTeam]
    if (path === '/api/v1/knowledge-bases/list') return [knowledgeBase]
    if (path === '/api/v1/authorization/resolve') {
      const request = body as { resourceType: string; resourceId: string }
      return { capabilities: capabilities[`${request.resourceType}:${request.resourceId}`] ?? [] }
    }
    if (path === '/api/v1/knowledge-bases/transfer') return transferHandler(body as TransferBody)
    throw new Error(`Unexpected POST ${path}`)
  })
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

describe('knowledge-base ownership settings', () => {
  it('renders ownership as the fifth of six tabs and shows only server-authorized targets', async () => {
    await mountView()

    expect(wrapper!.findAll('.settings-tabs button').map((item) => item.text())).toEqual([
      '基础', '外观', '成员', '分享与访问', '归属', '高级',
    ])

    await openOwnershipTab()
    const panel = wrapper!.get('.ownership-panel')
    expect(panel.get('h2').text()).toBe('知识库归属')
    expect(panel.text()).toContain('当前归属')
    expect(panel.text()).toContain('空间 · 示例空间')
    expect(panel.text()).not.toContain('WORKSPACE')

    const items = ownerSelect().props('items') as OwnerItem[]
    expect(items.map((item) => item.value)).toEqual(['PERSONAL:user', 'TEAM:team-managed'])
    expect(items.map((item) => item.title)).toContain('团队 · 研发团队')
    expect(items.map((item) => item.title)).not.toContain('团队 · 财务团队')
    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/teams/members')).toBe(false)

    const transferButton = pageButton('转移归属')
    expect(transferButton.attributes('disabled')).toBeDefined()
    await selectOwner('TEAM:team-managed')
    expect(transferButton.attributes('disabled')).toBeUndefined()
    await transferButton.trigger('click')
    await flushPromises()

    expect(document.body.textContent).toContain('确认转移知识库归属？')
    expect(document.body.textContent).toContain('空间 · 示例空间')
    expect(document.body.textContent).toContain('团队 · 研发团队')
    expect(document.body.textContent).toContain('不会改变内容、文稿 ID 和公开链接')
    expect(transferCalls()).toHaveLength(0)
  })

  it('shows a disabled selector and a clear empty state when no authorized target exists', async () => {
    knowledgeBase = { ...knowledgeBase, ownerType: 'PERSONAL', ownerId: 'user' }
    capabilities['WORKSPACE:workspace'] = ['READ']
    capabilities['TEAM:team-managed'] = ['READ']
    await mountView()
    await openOwnershipTab()

    expect(ownerSelect().props('items')).toEqual([])
    expect(ownerSelect().props('disabled')).toBe(true)
    expect(wrapper!.get('.ownership-empty').text()).toContain('暂无可转移的归属')
    expect(wrapper!.get('.ownership-empty').text()).toContain('没有其他你具备管理权限')
    expect(pageButton('转移归属').attributes('disabled')).toBeDefined()
  })

  it('locks the transfer flow, ignores duplicate confirmation clicks, then refreshes and reports success', async () => {
    const pending = deferred<KnowledgeBase>()
    transferHandler = () => pending.promise
    await mountView()
    const loadNavigation = vi.spyOn(session, 'loadNavigation').mockResolvedValue()
    await openOwnershipTab()
    await selectOwner('TEAM:team-managed')
    await pageButton('转移归属').trigger('click')
    await flushPromises()

    const confirm = bodyButton('确认转移')
    confirm.click()
    confirm.click()
    await flushPromises()

    expect(transferCalls()).toHaveLength(1)
    expect(bodyButton('取消').disabled).toBe(true)
    expect(confirm.disabled).toBe(true)
    expect(ownerSelect().props('disabled')).toBe(true)
    expect(wrapper!.findAll('.settings-tabs button').every((item) => item.attributes('disabled') !== undefined)).toBe(true)

    knowledgeBase = { ...knowledgeBase, ownerType: 'TEAM', ownerId: managedTeam.id, teamId: managedTeam.id }
    pending.resolve(knowledgeBase)
    await flushPromises()

    expect(loadNavigation).toHaveBeenCalledTimes(1)
    expect(wrapper!.get('.current-owner').text()).toContain('团队 · 研发团队')
    expect(ui.toast.text).toBe('知识库归属已转移')
    expect(document.body.textContent).not.toContain('确认转移知识库归属？')
  })

  it('keeps the selected target and confirmation open when transfer fails', async () => {
    transferHandler = async () => { throw new Error('目标团队权限已变化') }
    await mountView()
    const loadNavigation = vi.spyOn(session, 'loadNavigation').mockResolvedValue()
    await openOwnershipTab()
    await selectOwner('TEAM:team-managed')
    await pageButton('转移归属').trigger('click')
    await flushPromises()
    bodyButton('确认转移').click()
    await flushPromises()

    expect(transferCalls()).toHaveLength(1)
    expect(document.body.textContent).toContain('确认转移知识库归属？')
    expect(document.body.textContent).toContain('目标团队权限已变化')
    expect(ownerSelect().props('modelValue')).toBe('TEAM:team-managed')
    expect(loadNavigation).not.toHaveBeenCalled()
    expect(ui.toast.text).toBe('')

    bodyButton('取消').click()
    await flushPromises()
    expect(document.body.textContent).not.toContain('确认转移知识库归属？')
    expect(ownerSelect().props('modelValue')).toBe('TEAM:team-managed')
    expect(pageButton('转移归属').attributes('disabled')).toBeUndefined()
  })

  it('clears the previous knowledge-base form while a routed replacement is still loading', async () => {
    const first = knowledgeBaseFixture()
    const second = { ...knowledgeBaseFixture(), id: 'kb-second', name: '第二知识库', slug: 'second' }
    const pendingSecond = deferred<KnowledgeBase>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/knowledge-bases/get') return (body as { knowledgeBaseId: string }).knowledgeBaseId === second.id ? pendingSecond.promise : first
      if (path === '/api/v1/pages/list' || path === '/api/v1/knowledge-bases/members' || path === '/api/v1/workspaces/members' || path === '/api/v1/teams/list') return []
      if (path === '/api/v1/knowledge-bases/list') return [first, second]
      if (path === '/api/v1/authorization/resolve') return { capabilities: ['READ', 'MANAGE'] }
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView()
    expect(wrapper!.text()).toContain(first.name)

    await router.push(`/app/kb/${second.id}/settings`)
    await flushPromises()

    expect(wrapper!.text()).not.toContain(first.name)
    expect(wrapper!.find('.settings-stage').exists()).toBe(false)
    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/knowledge-bases/update')).toBe(false)

    pendingSecond.resolve(second)
    await flushPromises()
    expect(wrapper!.get<HTMLInputElement>('.compact-grid input').element.value).toBe(second.name)
  })

  it('keeps one settings update in flight per knowledge base across an A-B-A route cycle', async () => {
    const first = knowledgeBaseFixture()
    const second = { ...knowledgeBaseFixture(), id: 'kb-second', name: '第二知识库', slug: 'second' }
    const pendingUpdate = deferred<KnowledgeBase>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/knowledge-bases/get') return (body as { knowledgeBaseId: string }).knowledgeBaseId === second.id ? second : first
      if (path === '/api/v1/pages/list' || path === '/api/v1/knowledge-bases/members' || path === '/api/v1/workspaces/members' || path === '/api/v1/teams/list') return []
      if (path === '/api/v1/knowledge-bases/list') return [first, second]
      if (path === '/api/v1/authorization/resolve') return { capabilities: ['READ', 'MANAGE'] }
      if (path === '/api/v1/knowledge-bases/update') return pendingUpdate.promise
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView()
    vi.spyOn(session, 'loadNavigation').mockResolvedValue()

    await wrapper!.get<HTMLInputElement>('.compact-grid input').setValue('第一次保存')
    await pageButton('保存设置').trigger('click')
    await flushPromises()
    await router.push(`/app/kb/${second.id}/settings`)
    await flushPromises()
    await router.push('/app/kb/kb/settings')
    await flushPromises()

    expect(pageButton('保存设置').attributes('disabled')).toBeDefined()
    await wrapper!.get<HTMLInputElement>('.compact-grid input').setValue('第二次尝试')
    await pageButton('保存设置').trigger('click')
    expect(vi.mocked(post).mock.calls.filter(([path]) => path === '/api/v1/knowledge-bases/update')).toHaveLength(1)

    pendingUpdate.resolve({ ...first, name: '第一次保存' })
    await flushPromises()
    expect(pageButton('保存设置').attributes('disabled')).toBeUndefined()
  })

  it('renders merge conflicts from the backend paths contract', async () => {
    const source = knowledgeBaseFixture()
    const target = { ...knowledgeBaseFixture(), id: 'kb-target', name: '目标知识库', slug: 'target' }
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/knowledge-bases/get') return source
      if (path === '/api/v1/pages/list' || path === '/api/v1/knowledge-bases/members' || path === '/api/v1/workspaces/members' || path === '/api/v1/teams/list') return []
      if (path === '/api/v1/knowledge-bases/list') return [source, target]
      if (path === '/api/v1/authorization/resolve') return { capabilities: ['READ', 'MANAGE'] }
      if (path === '/api/v1/knowledge-bases/merge/plan') return {
        sourceKnowledgeBaseId: source.id,
        targetKnowledgeBaseId: target.id,
        fingerprint: 'plan-fingerprint',
        pageCount: 3,
        catalogNodeCount: 4,
        paths: [
          { pageId: 'page-1', title: '重复路径', originalPath: 'guide', resolvedPath: 'guide-2', renamed: true },
          { pageId: 'page-2', title: '普通路径', originalPath: 'intro', resolvedPath: 'intro', renamed: false },
        ],
        warnings: ['存在重命名'],
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView()
    await wrapper!.findAll('.settings-tabs button')[5]!.trigger('click')
    const mergeSelect = wrapper!.findAllComponents({ name: 'VSelect' }).find((item) => item.props('label') === '目标知识库')
    expect(mergeSelect).toBeTruthy()
    mergeSelect!.vm.$emit('update:modelValue', target.id)
    await flushPromises()
    await pageButton('开始预检').trigger('click')
    await flushPromises()

    expect(wrapper!.text()).toContain('检测到 1 个路径冲突')
  })
})

async function mountView() {
  const pinia = createPinia()
  setActivePinia(pinia)
  session = useSessionStore()
  session.user = { userId: 'user', email: 'user@example.com', displayName: '当前用户', instanceAdmin: false }
  session.workspaces = [{
    id: 'workspace', workspaceType: 'ORGANIZATION', name: '示例空间', defaultVisibility: 'PRIVATE',
    defaultPublishMode: 'MANUAL', membershipRole: 'MEMBER',
  }]
  ui = useUiStore()
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/kb/:knowledgeBaseId/settings', component: { template: '<div />' } },
      { path: '/app/kb/:knowledgeBaseId', component: { template: '<div />' } },
    ],
  })
  await router.push('/app/kb/kb/settings')
  await router.isReady()
  wrapper = mount(KnowledgeBaseSettingsView, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  await flushPromises()
}

async function openOwnershipTab() {
  await wrapper!.findAll('.settings-tabs button')[4]!.trigger('click')
  await flushPromises()
}

function ownerSelect(): VueWrapper<any> {
  return wrapper!.getComponent('.owner-select') as VueWrapper<any>
}

async function selectOwner(value: string) {
  ownerSelect().vm.$emit('update:modelValue', value)
  await flushPromises()
}

function pageButton(text: string) {
  const button = wrapper!.findAll('button').find((item) => item.text() === text)
  expect(button, `page button ${text}`).toBeTruthy()
  return button!
}

function bodyButton(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.trim() === text) as HTMLButtonElement | undefined
  expect(button, `body button ${text}`).toBeTruthy()
  return button!
}

function transferCalls() {
  return vi.mocked(post).mock.calls.filter(([path]) => path === '/api/v1/knowledge-bases/transfer')
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

function knowledgeBaseFixture(): KnowledgeBase {
  return {
    id: 'kb', workspaceId: 'workspace', name: '产品手册', slug: 'product', description: null, icon: '📘',
    ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId: null, visibility: 'PRIVATE',
    allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}',
    catalogRevision: 0, createdBy: 'user', createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
  }
}
