import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import type { ApiKeyCredential, Garden, OAuthClient, PublicProfile, WebhookDeliveryPage, WebhookSubscription } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { get, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import AccountView from './AccountView.vue'
import OpenPlatformView from './OpenPlatformView.vue'
import ProfileSettingsView from './ProfileSettingsView.vue'

vi.mock('../../services/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  resetCsrf: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.mocked(get).mockReset()
  vi.mocked(post).mockReset()
  vi.mocked(resetCsrf).mockReset()
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

describe('flat Yuque-style settings views', () => {
  it('keeps profile, password and device-security account actions intact', async () => {
    vi.mocked(get).mockImplementation(async (path) => {
      if (path === '/api/v1/account') return accountProfile()
      if (path === '/api/v1/account/sessions') return accountSessions()
      throw new Error(`Unexpected GET ${path}`)
    })
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/account/profile') return { ...accountProfile(), displayName: (body as { displayName: string }).displayName }
      if (path === '/api/v1/account/password' || path.endsWith('/revoke')) return undefined
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView(AccountView, '/app/account')

    expect(wrapper!.findAll('.account-nav a').map((item) => item.text())).toEqual(['个人资料', '修改密码', '登录设备'])
    expect(wrapper!.findAll('.account-section')).toHaveLength(3)
    expect(wrapper!.findAll('.account-grid > .v-card').every((item) => item.classes().includes('account-section'))).toBe(true)

    await wrapper!.get('input[placeholder="例如：林静"]').setValue('新显示名')
    await buttonWithText('保存资料').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/account/profile', { displayName: '新显示名' })

    const passwordInputs = wrapper!.findAll('input[type="password"]')
    await passwordInputs[0]!.setValue('current-password')
    await passwordInputs[1]!.setValue('new-password-123')
    await passwordInputs[2]!.setValue('new-password-123')
    await buttonWithText('更新密码').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/account/password', {
      currentPassword: 'current-password', newPassword: 'new-password-123', passwordConfirmation: 'new-password-123',
    })

    await buttonWithText('退出').trigger('click')
    expect(document.body.textContent).toContain('该设备的会话将立即失效')
    await bodyButtonWithText('确认退出').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/account/sessions/other/revoke', {})
  })

  it('keeps public-profile saving and explicit garden editing/deletion flows', async () => {
    vi.stubGlobal('confirm', vi.fn(() => true))
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/v1/social/profile/me') return profileFixture()
      if (path === '/api/v1/social/gardens/mine') return [gardenFixture()]
      if (path === '/api/v1/social/profile/save') return { ...profileFixture(), ...(body as object) }
      if (path === '/api/v1/social/gardens/update' || path === '/api/v1/social/gardens/delete') return {}
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView(ProfileSettingsView, '/app/profile', true)

    expect(wrapper!.findAll('.settings-tabs [role="tab"]').map((item) => item.text())).toEqual(['主页资料', '知识花园'])
    expect(wrapper!.find('.settings-panel.v-card').exists()).toBe(false)
    const displayNameInput = wrapper!.findAll('input')[0]!
    await displayNameInput.setValue('新的公开名称')
    await buttonWithText('保存主页').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/social/profile/save', expect.objectContaining({ displayName: '新的公开名称', slug: 'creator' }))

    await wrapper!.findAll('[role="tab"]')[1]!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('产品花园')
    await buttonWithText('编辑').trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('编辑花园')
    expect(document.body.textContent).toContain('允许被发现')
    await bodyButtonWithText('保存').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/social/gardens/update', expect.objectContaining({ gardenId: 'garden', title: '产品花园', knowledgeBaseIds: ['kb-public'] }))

    await buttonWithText('删除').trigger('click')
    await flushPromises()
    expect(confirm).toHaveBeenCalledWith('删除花园「产品花园」？')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/social/gardens/delete', { gardenId: 'garden' })
  })

  it('retains API Key secrets, OAuth, Webhook deliveries and MCP documentation', async () => {
    vi.spyOn(window, 'setInterval').mockReturnValue(1 as unknown as number)
    vi.spyOn(window, 'clearInterval').mockImplementation(() => {})
    const key = apiKeyFixture()
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/open-platform/api-keys/list') return [key]
      if (path === '/api/v1/open-platform/api-keys/create') return { ...key, id: 'new-key', secret: 'kp_live_one_time_secret' }
      if (path === '/api/v1/open-platform/api-keys/revoke') return {}
      if (path === '/api/v1/open-platform/oauth-clients/list') return [oauthFixture()]
      if (path === '/api/v1/open-platform/webhooks/list') return [webhookFixture()]
      if (path === '/api/v1/open-platform/webhooks/deliveries/page') return deliveriesFixture()
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountView(OpenPlatformView, '/app/open-platform', true)

    expect(wrapper!.get('h1').text()).toBe('开放平台')
    expect(wrapper!.find('.platform-nav.v-card').exists()).toBe(false)
    expect(wrapper!.text()).toContain('自动化密钥')

    await buttonWithText('创建密钥').trigger('click')
    await flushPromises()
    await bodyButtonWithText('创建密钥', true).trigger('click')
    await flushPromises()
    expect(document.body.textContent).toContain('kp_live_one_time_secret')
    expect(document.body.textContent).toContain('关闭后无法再次查看')
    await bodyButtonWithText('我已安全保存').trigger('click')

    await wrapper!.get('button[title="撤销密钥"]').trigger('click')
    expect(document.body.textContent).toContain('立即失去访问权限，且无法恢复')
    await bodyButtonWithText('撤销密钥', true).trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/open-platform/api-keys/revoke', { workspaceId: 'workspace', id: 'key' })

    await wrapper!.findAll('[role="tab"]').find((item) => item.text().includes('OAuth'))!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('测试 OAuth')

    await wrapper!.findAll('[role="tab"]').find((item) => item.text().includes('Webhooks'))!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('文档通知')
    expect(wrapper!.text()).toContain('document.published')
    expect(wrapper!.text()).toContain('DELIVERED')

    await wrapper!.findAll('[role="tab"]').find((item) => item.text().includes('API 与 MCP'))!.trigger('click')
    await flushPromises()
    expect(wrapper!.text()).toContain('REST API v2')
    expect(wrapper!.text()).toContain('MCP Server')
    expect(wrapper!.text()).toContain('Webhook 签名验证')
  })
})

async function mountView(component: Component, path: string, withNavigation = false): Promise<Router> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore()
  session.user = { userId: 'user', email: 'user@example.com', displayName: '用户', instanceAdmin: false }
  if (withNavigation) {
    session.workspaces = [{ id: 'workspace', workspaceType: 'PERSONAL', name: '个人空间', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'OWNER' }]
    session.knowledgeBases = [{
      id: 'kb-public', workspaceId: 'workspace', name: '公开知识库', slug: 'public', description: null, icon: '📘',
      ownerType: 'WORKSPACE', ownerId: 'workspace', teamId: null, homepagePageId: null, visibility: 'PUBLIC',
      allowPublicIndex: true, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}',
      catalogRevision: 0, createdBy: 'user', createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
    }]
    session.selectWorkspace('workspace')
  }
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/app/account', component: { template: '<div />' } },
      { path: '/app/profile', component: { template: '<div />' } },
      { path: '/app/open-platform', component: { template: '<div />' } },
      { path: '/u/:slug', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(component, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  await flushPromises()
  return router
}

function buttonWithText(text: string) {
  const button = wrapper!.findAll('button').find((item) => item.text() === text)
  expect(button, `button ${text}`).toBeTruthy()
  return button!
}

function bodyButtonWithText(text: string, last = false) {
  const matches = [...document.body.querySelectorAll('button')].filter((item) => item.textContent?.trim() === text)
  const button = last ? matches.at(-1) : matches[0]
  expect(button, `body button ${text}`).toBeTruthy()
  return { trigger: (event: string) => { button!.dispatchEvent(new Event(event, { bubbles: true, cancelable: true })); return flushPromises() } }
}

function accountProfile() {
  return {
    userId: 'user', email: 'user@example.com', displayName: '原显示名', status: 'ACTIVE',
    emailVerifiedAt: '2026-08-01T00:00:00Z', emailVerificationSource: 'REGISTRATION',
    createdAt: '2026-08-01T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z',
  }
}

function accountSessions() {
  return [
    { id: 'current', current: true, userAgent: 'Chrome/120 Windows', ipAddress: '127.0.0.1', lastSeenAt: '2026-08-26T10:00:00Z', createdAt: '2026-08-20T00:00:00Z' },
    { id: 'other', current: false, userAgent: 'Firefox/120 Linux', ipAddress: '192.0.2.1', lastSeenAt: '2026-08-25T10:00:00Z', createdAt: '2026-08-20T00:00:00Z' },
  ]
}

function profileFixture(): PublicProfile {
  return {
    userId: 'user', slug: 'creator', displayName: '公开名称', bio: '个人简介', avatarUrl: null, coverUrl: null,
    theme: 'MINIMAL', navigation: [], seoTitle: null, seoDescription: null, discoverable: true, rssEnabled: true,
    followerCount: 2, followingCount: 1, followed: false, updatedAt: '2026-08-26T00:00:00Z',
  }
}

function gardenFixture(): Garden {
  return {
    id: 'garden', userId: 'user', ownerSlug: 'creator', ownerName: '公开名称', slug: 'product', title: '产品花园',
    description: '产品知识', icon: '🌿', coverUrl: null, theme: 'MINIMAL', navigation: [], seoTitle: null,
    seoDescription: null, discoverable: true, rssEnabled: true, followerCount: 0, followed: false,
    knowledgeBases: [{ id: 'kb-public', name: '公开知识库', slug: 'public', description: null, icon: '📘' }],
    updatedAt: '2026-08-26T00:00:00Z',
  }
}

function apiKeyFixture(): ApiKeyCredential {
  return {
    id: 'key', workspaceId: 'workspace', name: '自动化密钥', prefix: 'abcd', scopes: ['documents:read'],
    lastUsedAt: null, expiresAt: null, revokedAt: null, createdAt: '2026-08-26T00:00:00Z', secret: null,
  }
}

function oauthFixture(): OAuthClient {
  return {
    id: 'oauth', workspaceId: 'workspace', clientId: 'client-id', name: '测试 OAuth',
    redirectUris: ['https://example.com/callback'], scopes: ['documents:read'], publicClient: true, active: true,
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', clientSecret: null,
  }
}

function webhookFixture(): WebhookSubscription {
  return {
    id: 'webhook', workspaceId: 'workspace', name: '文档通知', endpointUrl: 'https://example.com/webhook',
    events: ['document.*'], active: true, consecutiveFailures: 0, suspendedAt: null,
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', signingSecret: null,
  }
}

function deliveriesFixture(): WebhookDeliveryPage {
  return {
    items: [{
      id: 'delivery', webhookId: 'webhook', eventId: 'event', eventType: 'document.published', status: 'DELIVERED',
      attempts: 1, nextAttemptAt: '2026-08-26T00:00:00Z', responseStatus: 200, lastError: null,
      deliveredAt: '2026-08-26T00:00:01Z', createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:01Z',
    }],
    nextOffset: 1,
    hasMore: false,
  }
}
