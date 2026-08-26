import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import { get, post, resetCsrf } from '../../services/api'
import ForgotPasswordView from './ForgotPasswordView.vue'
import InvitationView from './InvitationView.vue'
import LoginView from './LoginView.vue'
import RegisterView from './RegisterView.vue'
import SetupView from './SetupView.vue'

vi.mock('../../services/api', () => ({
  get: vi.fn(),
  post: vi.fn(),
  resetCsrf: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

const registrationOpen = {
  publicRegistrationEnabled: true,
  emailVerificationRequired: true,
  passwordLoginEnabled: true,
  emailCodeLoginAvailable: true,
}
const currentUser = { userId: 'user', email: 'member@example.com', displayName: '成员', instanceAdmin: false }
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
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('Yuque-style authentication views', () => {
  it('renders the white branded login shell and keeps password login as the default', async () => {
    vi.mocked(get).mockResolvedValueOnce(registrationOpen).mockResolvedValueOnce(currentUser)
    vi.mocked(post).mockResolvedValue({})
    const router = await mountView(LoginView, '/login')

    expect(wrapper!.get('.auth-brand-header').element).toBeTruthy()
    expect(wrapper!.get('.auth-brand-name').text()).toBe('知序')
    expect(wrapper!.get('h1').text()).toBe('登录知序')
    expect(wrapper!.findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['密码登录', '验证码登录'])
    expect(wrapper!.findAll('[role="tab"]')[0]!.attributes('aria-selected')).toBe('true')

    await wrapper!.get('input[type="email"]').setValue('member@example.com')
    await wrapper!.get('input[type="password"]').setValue('correct-password')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/auth/login/password', {
      email: 'member@example.com',
      password: 'correct-password',
    }, false)
    expect(resetCsrf).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/app')
  })

  it('makes the email-code login steps explicit without changing their API contract', async () => {
    vi.mocked(get).mockResolvedValueOnce(registrationOpen).mockResolvedValueOnce(currentUser)
    vi.mocked(post).mockResolvedValue({})
    const router = await mountView(LoginView, '/login')

    await wrapper!.findAll('[role="tab"]')[1]!.trigger('click')
    expect(wrapper!.findAll('[role="tab"]')[1]!.attributes('aria-selected')).toBe('true')
    await wrapper!.get('input[type="email"]').setValue('member@example.com')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/auth/login/email-code/request', { email: 'member@example.com' }, false)
    expect(wrapper!.text()).toContain('验证码已发送至 member@example.com')
    await wrapper!.get('input[inputmode="numeric"]').setValue('123456')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenLastCalledWith('/api/v1/auth/login/email-code/verify', {
      email: 'member@example.com',
      code: '123456',
    }, false)
    expect(router.currentRoute.value.path).toBe('/app')
  })

  it('continues to enforce the public registration policy', async () => {
    vi.mocked(get).mockResolvedValueOnce({ ...registrationOpen, publicRegistrationEnabled: false })
    const router = await mountView(RegisterView, '/register')

    expect(router.currentRoute.value.path).toBe('/login')
    expect(post).not.toHaveBeenCalled()
  })

  it('keeps the registration start and email verification flow intact', async () => {
    vi.mocked(get).mockResolvedValueOnce(registrationOpen).mockResolvedValueOnce(currentUser)
    vi.mocked(post).mockResolvedValueOnce({ challengeId: 'challenge' }).mockResolvedValueOnce({})
    const router = await mountView(RegisterView, '/register')

    const accountInputs = wrapper!.findAll('input')
    await accountInputs[0]!.setValue('new@example.com')
    await accountInputs[1]!.setValue('long-password')
    await accountInputs[2]!.setValue('long-password')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/auth/register/start', {
      email: 'new@example.com',
      password: 'long-password',
      passwordConfirmation: 'long-password',
    }, false)
    expect(wrapper!.text()).toContain('验证码已发送至 new@example.com')
    await wrapper!.get('input[inputmode="numeric"]').setValue('654321')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenLastCalledWith('/api/v1/auth/register/verify', { challengeId: 'challenge', code: '654321' }, false)
    expect(router.currentRoute.value.path).toBe('/app')
  })

  it('retains both stages of password recovery', async () => {
    vi.mocked(post).mockResolvedValueOnce({ challengeId: 'reset-challenge' }).mockResolvedValueOnce({})
    await mountView(ForgotPasswordView, '/forgot-password')

    await wrapper!.get('input[type="email"]').setValue('member@example.com')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/auth/password-reset/request', { email: 'member@example.com' }, false)

    const resetInputs = wrapper!.findAll('input')
    await resetInputs[0]!.setValue('123456')
    await resetInputs[1]!.setValue('new-long-password')
    await resetInputs[2]!.setValue('new-long-password')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenLastCalledWith('/api/v1/auth/password-reset/complete', {
      challengeId: 'reset-challenge',
      code: '123456',
      password: 'new-long-password',
      passwordConfirmation: 'new-long-password',
    }, false)
    expect(wrapper!.text()).toContain('新密码已生效')
  })

  it('keeps first-deployment administrator setup email-only and verification-free', async () => {
    vi.mocked(get).mockResolvedValueOnce({ initialized: false })
    vi.mocked(post).mockResolvedValue({})
    const router = await mountView(SetupView, '/setup')

    expect(wrapper!.text()).toContain('第一个邮箱账号将成为实例管理员，无需邮件验证')
    expect(wrapper!.text()).toContain('首个管理员邮箱无需验证')
    const inputs = wrapper!.findAll('input')
    await inputs[0]!.setValue('admin@example.com')
    await inputs[1]!.setValue('我的工作区')
    await inputs[2]!.setValue('administrator-password')
    await inputs[3]!.setValue('administrator-password')
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/setup/initialize', {
      email: 'admin@example.com',
      workspaceName: '我的工作区',
      password: 'administrator-password',
      passwordConfirmation: 'administrator-password',
    }, false)
    expect(resetCsrf).toHaveBeenCalledOnce()
    expect(router.currentRoute.value.path).toBe('/app')
  })

  it.each([
    { accountExists: true, password: null, passwordConfirmation: null },
    { accountExists: false, password: 'invited-password', passwordConfirmation: 'invited-password' },
  ])('preserves invitation acceptance for accountExists=$accountExists', async ({ accountExists, password, passwordConfirmation }) => {
    vi.mocked(get)
      .mockResolvedValueOnce({
        invitationId: 'invite', workspaceId: 'workspace', workspaceName: '团队空间', maskedEmail: 'm***@example.com',
        workspaceRole: 'MEMBER', accountExists, expiresAt: '2026-09-01T00:00:00Z',
      })
      .mockResolvedValueOnce(currentUser)
    vi.mocked(post).mockResolvedValue({ workspaceId: 'workspace' })
    const router = await mountView(InvitationView, '/invitation?token=signed-token')

    if (!accountExists) {
      const inputs = wrapper!.findAll('input')
      await inputs[0]!.setValue(password)
      await inputs[1]!.setValue(passwordConfirmation)
    }
    await wrapper!.get('form').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/invitations/accept', {
      token: 'signed-token', password, passwordConfirmation,
    }, false)
    expect(router.currentRoute.value.path).toBe('/app/w/workspace')
  })
})

async function mountView(component: Component, path: string): Promise<Router> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/:pathMatch(.*)*', component: { template: '<div />' } }],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(component, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  await flushPromises()
  return router
}
