import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { Page } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { post } from '../services/api'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import CreateResourceDialog from './CreateResourceDialog.vue'

vi.mock('../services/api', () => ({
  post: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.mocked(post).mockReset()
  vi.stubGlobal('visualViewport', {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
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

describe('CreateResourceDialog quick creation', () => {
  it('creates an untitled document after choosing its knowledge base without requiring optional fields', async () => {
    const { router, ui } = await mountDialog()
    vi.mocked(post).mockResolvedValue(page())

    ui.openCreate({ kind: 'DOCUMENT', workspaceId: 'workspace', source: 'TOP_BAR' })
    await nextTick()

    expect(document.body.textContent).toContain('无标题文档')
    expect(document.body.querySelector('.advanced-fields')).toBeNull()
    const createButton = buttonWithText('新建并打开')
    expect(createButton.disabled).toBe(false)

    createButton.click()
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/create', expect.objectContaining({
      knowledgeBaseId: 'kb',
      title: '无标题文档',
      contentType: 'DOCUMENT',
      path: expect.stringMatching(/^untitled-\d+$/),
    }))
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe('/app/kb/kb/pages/page'))
    expect(ui.createOpen).toBe(false)
  })
})

async function mountDialog() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const session = useSessionStore()
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
      { path: '/app', component: { template: '<div />' } },
      { path: '/app/kb/:knowledgeBaseId/pages/:pageId', component: { template: '<div />' } },
    ],
  })
  await router.push('/app')
  await router.isReady()
  wrapper = mount(CreateResourceDialog, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  const ui = useUiStore()
  return { router, ui }
}

function buttonWithText(text: string) {
  const button = [...document.body.querySelectorAll('button')].find((item) => item.textContent?.includes(text))
  expect(button, `button containing ${text}`).toBeTruthy()
  return button as HTMLButtonElement
}

function page(): Page {
  return {
    id: 'page', workspaceId: 'workspace', knowledgeBaseId: 'kb', title: '无标题文档', icon: null, cover: null,
    contentType: 'DOCUMENT', path: 'untitled', publishMode: 'MANUAL', publishedRevisionId: null, publishedAt: null,
    visibilityOverride: 'INHERIT', documentSettings: {}, schemaVersion: 1, draftRevision: 1,
    content: { type: 'doc', content: [] }, plainText: '', createdBy: 'user', updatedBy: 'user',
    createdAt: '2026-08-26T00:00:00Z', updatedAt: '2026-08-26T00:00:00Z', deletedAt: null,
  }
}
