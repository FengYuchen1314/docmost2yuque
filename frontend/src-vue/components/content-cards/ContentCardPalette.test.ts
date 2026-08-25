import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import ContentCardPalette from './ContentCardPalette.vue'
import { createContentCardNode } from './contentCardModel'

const envelope = {
  ciphertext: 'A'.repeat(23),
  salt: 'A'.repeat(22),
  iv: 'A'.repeat(16),
  kdf: 'PBKDF2-SHA256' as const,
  iterations: 210_000,
  hint: '原提示',
}

function mountPalette(initialCard: unknown = null) {
  return mount(ContentCardPalette, {
    attachTo: document.body,
    props: {
      modelValue: false,
      initialCard,
      allowedKinds: ['sensitive-text'],
    },
    global: { plugins: [vuetify] },
  })
}

function useInsecureBrowserCapabilities() {
  vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes })
  vi.stubGlobal('visualViewport', {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('ContentCardPalette on an insecure origin', () => {
  it('disables creation that would require unavailable local encryption', async () => {
    useInsecureBrowserCapabilities()
    const wrapper = mountPalette()
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(document.body.textContent).toContain('请通过 HTTPS 访问后再加密或解密敏感内容')
    const insert = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('插入内容卡'))
    expect(insert?.disabled).toBe(true)
  })

  it('still saves an existing ciphertext unchanged when no re-encryption is requested', async () => {
    useInsecureBrowserCapabilities()
    const initialCard = createContentCardNode('sensitive-text', envelope, {
      instanceId: '00000000-0000-4000-8000-000000000002',
    })
    const wrapper = mountPalette(initialCard)
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(document.body.textContent).toContain('现有密文不会被解密或改写')
    const save = Array.from(document.body.querySelectorAll('button')).find((button) => button.textContent?.includes('保存内容卡'))
    expect(save?.disabled).toBe(false)
    save?.click()
    await nextTick()

    const payload = wrapper.emitted('insert')?.[0]?.[0] as { card: { data: Record<string, unknown> } }
    expect(payload.card.data).toMatchObject(envelope)
  })
})
