import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { post } from '../../services/api'
import type { AttachmentView, PublicationState } from './types'
import AttachmentsPanel from './AttachmentsPanel.vue'
import HistoryPanel from './HistoryPanel.vue'
import PermissionsPanel from './PermissionsPanel.vue'
import PublicationPanel from './PublicationPanel.vue'
import SharesPanel from './SharesPanel.vue'

vi.mock('../../services/api', () => ({
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
  post: vi.fn(),
  upload: vi.fn(),
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

describe('page management loading states', () => {
  it.each([
    [AttachmentsPanel, '.load-error', '附件加载失败'],
    [PermissionsPanel, '.permission-load-error', '权限信息加载失败'],
    [PublicationPanel, '.publication-load-error', '发布状态加载失败'],
    [SharesPanel, '.load-error', '分享链接加载失败'],
  ] as const)('keeps API errors distinct from empty content in %s', async (component, selector, message) => {
    vi.mocked(post).mockRejectedValue(new Error('网络不可用'))
    wrapper = mount(component, {
      attachTo: document.body,
      props: { page: pageFixture() },
      global: { plugins: [createPinia(), vuetify] },
    })
    await flushPromises()

    expect(wrapper.find(selector).exists()).toBe(true)
    expect(wrapper.text()).toContain(message)
  })

  it('does not label a failed history request as an empty version history', async () => {
    vi.mocked(post).mockRejectedValue(new Error('网络不可用'))
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: { template: '<div />' } }],
    })
    await router.push('/')
    await router.isReady()
    wrapper = mount(HistoryPanel, {
      attachTo: document.body,
      props: { page: pageFixture() },
      global: { plugins: [createPinia(), router, vuetify] },
    })
    await flushPromises()

    expect(wrapper.find('.load-error').exists()).toBe(true)
    expect(wrapper.text()).toContain('历史加载失败')
    expect(wrapper.text()).not.toContain('暂无历史版本')
  })

  it('keeps attachment retry and write protection after the error alert is dismissed', async () => {
    let attempts = 0
    vi.mocked(post).mockImplementation(async (path) => {
      if (path !== '/api/v1/attachments/list') throw new Error(`Unexpected POST ${path}`)
      attempts += 1
      if (attempts === 1) throw new Error('网络不可用')
      return []
    })
    wrapper = mount(AttachmentsPanel, {
      attachTo: document.body,
      props: { page: pageFixture() },
      global: { plugins: [createPinia(), vuetify] },
    })
    await flushPromises()

    expect(wrapper.find('.load-error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无附件')
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()

    dismissErrorAlert()
    await nextTick()

    expect(wrapper.find('.load-error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('暂无附件')
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeDefined()

    await buttonIn('.load-error', '重新加载').trigger('click')
    await flushPromises()

    expect(wrapper.find('.load-error').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无附件')
    expect(wrapper.get('input[type="file"]').attributes('disabled')).toBeUndefined()
  })

  it('keeps publication-state retry and publish protection after the error alert is dismissed', async () => {
    let stateAttempts = 0
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/pages/publication-state') {
        stateAttempts += 1
        if (stateAttempts === 1) throw new Error('状态加载失败')
        return publicationStateFixture()
      }
      if (path === '/api/v1/pages/publication-history/page') return { items: [], nextOffset: 0, hasMore: false }
      throw new Error(`Unexpected POST ${path}`)
    })
    wrapper = mount(PublicationPanel, {
      attachTo: document.body,
      props: { page: pageFixture() },
      global: { plugins: [createPinia(), vuetify] },
    })
    await flushPromises()

    expect(wrapper.find('.publication-load-error').exists()).toBe(true)
    expect(button('立即发布').attributes('disabled')).toBeDefined()

    dismissErrorAlert()
    await nextTick()

    expect(wrapper.find('.publication-load-error').exists()).toBe(true)
    expect(button('立即发布').attributes('disabled')).toBeDefined()

    await buttonIn('.publication-load-error', '重新加载').trigger('click')
    await flushPromises()

    expect(wrapper.find('.publication-load-error').exists()).toBe(false)
    expect(button('立即发布').attributes('disabled')).toBeUndefined()
  })

  it('shows a retry instead of a false empty publication history after dismissal', async () => {
    let historyAttempts = 0
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/pages/publication-state') return publicationStateFixture()
      if (path === '/api/v1/pages/publication-history/page') {
        historyAttempts += 1
        if (historyAttempts === 1) throw new Error('历史加载失败')
        return { items: [], nextOffset: 0, hasMore: false }
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    wrapper = mount(PublicationPanel, {
      attachTo: document.body,
      props: { page: pageFixture() },
      global: { plugins: [createPinia(), vuetify] },
    })
    await flushPromises()

    expect(wrapper.find('.publication-history-load-error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('尚无发布记录')
    expect(button('立即发布').attributes('disabled')).toBeDefined()

    dismissErrorAlert()
    await nextTick()

    expect(wrapper.find('.publication-history-load-error').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('尚无发布记录')
    expect(button('立即发布').attributes('disabled')).toBeDefined()

    await buttonIn('.publication-history-load-error', '重新加载').trigger('click')
    await flushPromises()

    expect(wrapper.find('.publication-history-load-error').exists()).toBe(false)
    expect(wrapper.text()).toContain('尚无发布记录')
    expect(button('立即发布').attributes('disabled')).toBeUndefined()
  })

  it('clears the previous page attachments while the replacement page is pending and keeps them cleared on failure', async () => {
    const replacement = deferred<AttachmentView[]>()
    vi.mocked(post)
      .mockResolvedValueOnce([attachmentFixture('old-attachment', '旧页面附件.pdf', 'page')])
      .mockImplementationOnce(() => replacement.promise)
    wrapper = mount(AttachmentsPanel, {
      attachTo: document.body,
      props: { page: pageFixture('page') },
      global: { plugins: [createPinia(), vuetify] },
    })
    await flushPromises()
    expect(wrapper.text()).toContain('旧页面附件.pdf')

    await wrapper.setProps({ page: pageFixture('replacement-page') })
    await nextTick()
    expect(wrapper.text()).not.toContain('旧页面附件.pdf')

    replacement.reject(new Error('新页面加载失败'))
    await flushPromises()
    expect(wrapper.text()).toContain('附件加载失败')
    expect(wrapper.text()).not.toContain('旧页面附件.pdf')
  })

  it('ignores an older attachments request that finishes after the new page request', async () => {
    const oldPageRequest = deferred<AttachmentView[]>()
    const newPageRequest = deferred<AttachmentView[]>()
    vi.mocked(post)
      .mockImplementationOnce(() => oldPageRequest.promise)
      .mockImplementationOnce(() => newPageRequest.promise)
    wrapper = mount(AttachmentsPanel, {
      attachTo: document.body,
      props: { page: pageFixture('page') },
      global: { plugins: [createPinia(), vuetify] },
    })

    await wrapper.setProps({ page: pageFixture('replacement-page') })
    newPageRequest.resolve([attachmentFixture('new-attachment', '新页面附件.pdf', 'replacement-page')])
    await flushPromises()
    expect(wrapper.text()).toContain('新页面附件.pdf')

    oldPageRequest.resolve([attachmentFixture('old-attachment', '迟到的旧页面附件.pdf', 'page')])
    await flushPromises()
    expect(wrapper.text()).toContain('新页面附件.pdf')
    expect(wrapper.text()).not.toContain('迟到的旧页面附件.pdf')
  })
})

function pageFixture(id = 'page'): Page {
  return {
    id, workspaceId: 'workspace', knowledgeBaseId: 'kb', title: '示例文档', icon: null, cover: null,
    contentType: 'DOCUMENT', path: 'example', publishMode: 'MANUAL', publishedRevisionId: null, publishedAt: null,
    visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 3,
    content: { type: 'doc', content: [] }, plainText: '', createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', deletedAt: null,
  }
}

function attachmentFixture(id: string, originalName: string, pageId: string): AttachmentView {
  return {
    id,
    workspaceId: 'workspace',
    pageId,
    originalName,
    mediaType: 'application/pdf',
    sizeBytes: 1024,
    checksumSha256: 'a'.repeat(64),
    uploadedBy: 'user',
    extractionStatus: 'EXTRACTED',
    extractedAt: '2026-08-26T00:00:00Z',
    createdAt: '2026-08-26T00:00:00Z',
    contentUrl: `/api/v1/attachments/${id}`,
  }
}

function publicationStateFixture(): PublicationState {
  return {
    pageId: 'page',
    draftRevision: 3,
    publicationId: null,
    publishedDraftRevision: null,
    published: false,
    upToDate: false,
    effectivePublishMode: 'MANUAL',
    automaticJobStatus: null,
  }
}

function dismissErrorAlert() {
  const alert = wrapper!.findComponent({ name: 'VAlert' })
  expect(alert.exists()).toBe(true)
  alert.vm.$emit('click:close')
}

function button(text: string) {
  const match = wrapper!.findAll('button').find((item) => item.text().trim() === text)
  expect(match, `button ${text}`).toBeTruthy()
  return match!
}

function buttonIn(selector: string, text: string) {
  const match = wrapper!.get(selector).findAll('button').find((item) => item.text().trim() === text)
  expect(match, `${selector} button ${text}`).toBeTruthy()
  return match!
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
