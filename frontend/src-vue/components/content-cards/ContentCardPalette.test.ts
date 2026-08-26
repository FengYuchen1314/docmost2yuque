import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import ContentCardPalette from './ContentCardPalette.vue'
import { createContentCardNode } from './contentCardModel'

const encryptSensitiveCardMock = vi.hoisted(() => vi.fn())

vi.mock('./sensitiveCardCrypto', async () => {
  const actual = await vi.importActual<typeof import('./sensitiveCardCrypto')>('./sensitiveCardCrypto')
  return { ...actual, encryptSensitiveCard: encryptSensitiveCardMock }
})

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

function useSecureBrowserCapabilities() {
  useInsecureBrowserCapabilities()
  vi.stubGlobal('crypto', {
    subtle: {},
    getRandomValues: (bytes: Uint8Array) => bytes,
  })
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

function selectFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { configurable: true, value: [file] })
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

function setNativeValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  encryptSensitiveCardMock.mockReset()
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

describe('ContentCardPalette presentation', () => {
  it('uses the compact insertion flow without exposing persistence details', async () => {
    useInsecureBrowserCapabilities()
    const wrapper = mount(ContentCardPalette, {
      attachTo: document.body,
      props: {
        modelValue: false,
        allowedKinds: ['bookmark', 'code'],
      },
      global: { plugins: [vuetify] },
    })
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    expect(wrapper.getComponent({ name: 'VDialog' }).props('maxWidth')).toBe('720')
    expect(document.body.querySelector('[data-testid="content-card-palette"]')).not.toBeNull()
    expect(document.body.textContent).toContain('插入后可选中卡片继续修改')
    expect(document.body.textContent).not.toContain('结构化 JSON')
    expect(document.body.textContent).not.toContain('兼容 token')

    const types = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.palette-type'))
    expect(types).toHaveLength(2)
    expect(types[0]?.getAttribute('aria-pressed')).toBe('true')
    types[1]?.click()
    await nextTick()
    expect(types[1]?.getAttribute('aria-pressed')).toBe('true')
  })

  it('locks upload controls and rejects a completion from a replaced form context', async () => {
    useInsecureBrowserCapabilities()
    const upload = deferred<{ url: string; name: string; size: number; mimeType: string }>()
    const uploadHandler = vi.fn(() => upload.promise)
    const wrapper = mount(ContentCardPalette, {
      attachTo: document.body,
      props: {
        modelValue: false,
        allowedKinds: ['attachment', 'image'],
        uploadHandler,
      },
      global: { plugins: [vuetify] },
    })
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    const fileInput = document.body.querySelector<HTMLInputElement>('input[type="file"]')!
    const file = new File(['old upload'], 'old.pdf', { type: 'application/pdf' })
    selectFile(fileInput, file)
    await nextTick()

    expect(uploadHandler).toHaveBeenCalledWith(file, 'attachment')
    const typeButtons = Array.from(document.body.querySelectorAll<HTMLButtonElement>('.palette-type'))
    expect(typeButtons.every((button) => button.disabled)).toBe(true)
    expect(typeButtons[0]?.getAttribute('aria-pressed')).toBe('true')
    typeButtons[1]?.click()
    await nextTick()
    expect(typeButtons[0]?.getAttribute('aria-pressed')).toBe('true')
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="/api/files/... 或 https://..."]')?.disabled).toBe(true)
    expect(document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭内容卡面板"]')?.disabled).toBe(true)

    const replacement = createContentCardNode('image', {
      url: 'https://example.com/replacement.png',
      alt: '替换后的图片',
    })
    await wrapper.setProps({ initialCard: replacement })
    await nextTick()
    expect(document.body.querySelector<HTMLInputElement>('input[placeholder="/api/files/... 或 https://..."]')?.value).toBe('https://example.com/replacement.png')

    upload.resolve({
      url: 'https://example.com/stale.pdf',
      name: 'stale.pdf',
      size: 10,
      mimeType: 'application/pdf',
    })
    await flushPromises()
    await nextTick()

    const imageUrl = document.body.querySelector<HTMLInputElement>('input[placeholder="/api/files/... 或 https://..."]')
    expect(imageUrl?.value).toBe('https://example.com/replacement.png')
    expect(wrapper.emitted('upload-start')?.[0]?.[0]).toMatchObject({ kind: 'attachment', file })
    expect(wrapper.emitted('upload-complete')).toBeUndefined()
    expect(Array.from(document.body.querySelectorAll<HTMLButtonElement>('.palette-type')).every((button) => !button.disabled)).toBe(true)
  })

  it('does not attach an older asynchronous encryption result to a replacement card identity', async () => {
    useSecureBrowserCapabilities()
    const encryption = deferred<Record<string, unknown>>()
    encryptSensitiveCardMock.mockReturnValueOnce(encryption.promise)
    const firstCard = createContentCardNode('sensitive-text', envelope, {
      instanceId: '00000000-0000-4000-8000-000000000011',
      version: 2,
    })
    const wrapper = mountPalette(firstCard)
    await wrapper.setProps({ modelValue: true })
    await nextTick()

    const plaintext = document.body.querySelector<HTMLTextAreaElement>('.palette-form textarea')!
    setNativeValue(plaintext, '第一张卡待加密的旧明文')
    await nextTick()
    const passwords = Array.from(document.body.querySelectorAll<HTMLInputElement>('.palette-form input[type="password"]'))
    setNativeValue(passwords[0]!, 'password-one')
    setNativeValue(passwords[1]!, 'password-one')
    await nextTick()

    const save = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('保存内容卡'))!
    save.click()
    await nextTick()
    expect(encryptSensitiveCardMock).toHaveBeenCalledWith('第一张卡待加密的旧明文', 'password-one', '原提示')
    expect(document.body.querySelector<HTMLTextAreaElement>('.palette-form textarea')?.matches(':disabled')).toBe(true)
    expect(Array.from(document.body.querySelectorAll<HTMLButtonElement>('.palette-type')).every((button) => button.disabled)).toBe(true)
    expect(document.body.querySelector<HTMLButtonElement>('button[aria-label="关闭内容卡面板"]')?.disabled).toBe(true)

    const replacementEnvelope = { ...envelope, ciphertext: 'B'.repeat(23), hint: '替换卡提示' }
    const replacement = createContentCardNode('sensitive-text', replacementEnvelope, {
      instanceId: '00000000-0000-4000-8000-000000000012',
      version: 7,
    })
    await wrapper.setProps({ initialCard: replacement })
    await nextTick()

    encryption.resolve({ ...envelope, ciphertext: 'C'.repeat(23), hint: '旧加密结果' })
    await flushPromises()
    await nextTick()

    expect(wrapper.emitted('insert')).toBeUndefined()
    expect(wrapper.emitted('error')).toBeUndefined()
    expect(Array.from(document.body.querySelectorAll<HTMLButtonElement>('.palette-type')).every((button) => !button.disabled)).toBe(true)

    const currentSave = Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('保存内容卡'))!
    currentSave.click()
    await flushPromises()

    const payload = wrapper.emitted('insert')?.[0]?.[0] as { card: { instanceId: string; version: number; data: Record<string, unknown> } }
    expect(payload.card.instanceId).toBe('00000000-0000-4000-8000-000000000012')
    expect(payload.card.version).toBe(7)
    expect(payload.card.data.ciphertext).toBe('B'.repeat(23))
    expect(payload.card.data.ciphertext).not.toBe('C'.repeat(23))
    expect(encryptSensitiveCardMock).toHaveBeenCalledTimes(1)
  })
})
