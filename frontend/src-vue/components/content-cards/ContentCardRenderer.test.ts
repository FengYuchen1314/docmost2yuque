import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vuetify } from '../../plugins/vuetify'
import ContentCardRenderer from './ContentCardRenderer.vue'
import { createContentCardNode, encodeContentCardToken } from './contentCardModel'

const decryptSensitiveCardMock = vi.hoisted(() => vi.fn())

vi.mock('./sensitiveCardCrypto', async () => {
  const actual = await vi.importActual<typeof import('./sensitiveCardCrypto')>('./sensitiveCardCrypto')
  return { ...actual, decryptSensitiveCard: decryptSensitiveCardMock }
})

const mountCard = (card: unknown, props: Record<string, unknown> = {}) => mount(ContentCardRenderer, {
  props: { card, ...props },
  global: { plugins: [vuetify] },
})

afterEach(() => {
  decryptSensitiveCardMock.mockReset()
  vi.unstubAllGlobals()
})

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function sensitiveCard(ciphertext: string, hint: string) {
  return createContentCardNode('sensitive-text', {
    ciphertext,
    salt: 'A'.repeat(22),
    iv: 'A'.repeat(16),
    kdf: 'PBKDF2-SHA256',
    iterations: 210_000,
    hint,
  }, {
    instanceId: '00000000-0000-4000-8000-000000000009',
    version: 1,
  })
}

describe('ContentCardRenderer', () => {
  it('normalizes a legacy URL object into a usable bookmark', () => {
    const wrapper = mountCard({ type: 'url', href: 'https://example.com/guide', name: '迁移指南', summary: '旧内容仍可阅读' })
    const link = wrapper.get('[data-testid="bookmark-card"]')
    expect(wrapper.attributes('data-card-kind')).toBe('bookmark')
    expect(link.attributes('href')).toBe('https://example.com/guide')
    expect(wrapper.text()).toContain('迁移指南')
    expect(wrapper.text()).toContain('旧内容仍可阅读')
  })

  it('renders an old token and keeps its structured code data', () => {
    const token = encodeContentCardToken(createContentCardNode('code', { language: 'ts', code: 'const ready = true' }))
    const wrapper = mountCard(token)
    expect(wrapper.attributes('data-card-kind')).toBe('code')
    expect(wrapper.text()).toContain('const ready = true')
    expect(wrapper.text()).toContain('ts')
    expect(wrapper.get('.code-card__toolbar').text()).toContain('复制代码')
    expect(wrapper.attributes('data-card-state')).toBe('ready')
  })

  it('does not mount an iframe for an unsafe legacy URL', () => {
    const wrapper = mountCard({ cardType: 'iframe', src: 'javascript:alert(1)', title: '不安全嵌入' })
    expect(wrapper.find('iframe').exists()).toBe(false)
    expect(wrapper.text()).toContain('未通过安全校验')
  })

  it('shows a recoverable fallback for damaged JSON', () => {
    const wrapper = mountCard('{"type":"contentCard", bad json')
    expect(wrapper.attributes('data-card-kind')).toBe('unknown')
    expect(wrapper.text()).toContain('暂不支持此内容卡')
    expect(wrapper.text()).toContain('JSON 内容损坏')
    expect(wrapper.find('.unknown-card__header').exists()).toBe(true)
    expect(wrapper.find('details').exists()).toBe(true)
  })

  it('exposes compact loading, uploading, and error states without rendering stale card content', () => {
    const card = { type: 'url', href: 'https://example.com/guide', name: '不应显示的旧标题' }
    const loading = mountCard(card, { loading: true })
    expect(loading.attributes('data-card-state')).toBe('loading')
    expect(loading.attributes('aria-busy')).toBe('true')
    expect(loading.get('[data-testid="content-card-pending"]').text()).toContain('正在加载')
    expect(loading.text()).not.toContain('不应显示的旧标题')

    const uploading = mountCard(card, { uploading: true })
    expect(uploading.attributes('data-card-state')).toBe('uploading')
    expect(uploading.get('[data-testid="content-card-pending"]').text()).toContain('正在上传')

    const failed = mountCard(card, { errorMessage: '资源暂时不可用' })
    expect(failed.attributes('data-card-state')).toBe('error')
    expect(failed.get('[data-testid="content-card-error"]').text()).toContain('资源暂时不可用')
    expect(failed.text()).not.toContain('不应显示的旧标题')
  })

  it('marks read-only and selected card shells for viewer and editor states', () => {
    const readonly = mountCard({ type: 'url', href: 'https://example.com' }, { interactive: false })
    expect(readonly.attributes('data-card-state')).toBe('readonly')
    expect(readonly.attributes('aria-readonly')).toBe('true')
    expect(readonly.classes()).toContain('content-card--readonly')

    const selected = mountCard({ type: 'url', href: 'https://example.com' }, { selected: true })
    expect(selected.classes()).toContain('content-card--selected')
    expect(selected.attributes('tabindex')).toBe('0')
  })

  it('explains the HTTPS requirement and disables decryption when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes })
    const wrapper = mountCard({
      cardId: 'sensitive-text',
      instanceId: '00000000-0000-4000-8000-000000000001',
      version: 1,
      data: {
        ciphertext: 'A'.repeat(23),
        salt: 'A'.repeat(22),
        iv: 'A'.repeat(16),
        kdf: 'PBKDF2-SHA256',
        iterations: 210_000,
      },
    })

    expect(wrapper.text()).toContain('请通过 HTTPS 访问后再加密或解密敏感内容')
    expect(wrapper.get('input[aria-label="敏感内容查看密码"]').attributes('disabled')).toBeDefined()
    const reveal = wrapper.findAll('button').find((button) => button.text().includes('查看'))
    expect(reveal?.attributes('disabled')).toBeDefined()
  })

  it('resets by full card payload and ignores an older decryption result', async () => {
    vi.stubGlobal('crypto', {
      subtle: {},
      getRandomValues: (bytes: Uint8Array) => bytes,
    })
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    })
    const first = deferred<string>()
    const second = deferred<string>()
    decryptSensitiveCardMock
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const wrapper = mountCard(sensitiveCard('A'.repeat(23), '第一张卡'))
    await wrapper.get('input[aria-label="敏感内容查看密码"]').setValue('password-one')
    await wrapper.get('form.sensitive-card__form').trigger('submit')
    expect(decryptSensitiveCardMock).toHaveBeenCalledTimes(1)

    await wrapper.setProps({ card: sensitiveCard('B'.repeat(23), '第二张卡') })
    expect(wrapper.text()).toContain('第二张卡')
    expect(wrapper.find('.sensitive-card__plaintext').exists()).toBe(false)
    expect((wrapper.get('input[aria-label="敏感内容查看密码"]').element as HTMLInputElement).value).toBe('')

    await wrapper.get('input[aria-label="敏感内容查看密码"]').setValue('password-two')
    await wrapper.get('form.sensitive-card__form').trigger('submit')
    expect(decryptSensitiveCardMock).toHaveBeenCalledTimes(2)

    second.resolve('第二张卡的明文')
    await flushPromises()
    expect(wrapper.get('.sensitive-card__plaintext').text()).toBe('第二张卡的明文')

    first.resolve('第一张卡的旧明文')
    await flushPromises()
    expect(wrapper.get('.sensitive-card__plaintext').text()).toBe('第二张卡的明文')
    expect(wrapper.text()).not.toContain('第一张卡的旧明文')
    expect(wrapper.emitted('unlock')).toHaveLength(1)
  })
})
