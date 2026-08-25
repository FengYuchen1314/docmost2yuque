import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { vuetify } from '../../plugins/vuetify'
import ContentCardRenderer from './ContentCardRenderer.vue'
import { createContentCardNode, encodeContentCardToken } from './contentCardModel'

const mountCard = (card: unknown) => mount(ContentCardRenderer, {
  props: { card },
  global: { plugins: [vuetify] },
})

afterEach(() => {
  vi.unstubAllGlobals()
})

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
})
