import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PublicContent, PublicReader, SocialPage } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { get, post } from '../../services/api'
import ReaderView from './ReaderView.vue'

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
  vi.mocked(get).mockRejectedValue(new Error('not signed in'))
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

describe('ReaderView', () => {
  it('renders the Yuque-like reader shell and a filtered published catalog', async () => {
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/public/v1/social/publication') return readerFixture(String((body as { publicationId: string }).publicationId), '当前文稿')
      if (path === '/api/public/v1/social/profile/content/page') {
        return page([
          content('first', '起步文稿'),
          content('current', '当前文稿'),
          content('other-book', '另一个知识库', 'kb-other'),
          { ...content('other-author', '其他作者'), authorSlug: 'someone-else' },
        ])
      }
      throw new Error(`Unexpected POST ${path}`)
    })

    await mountReader('/p/current')

    expect(wrapper!.find('.reader-topbar').exists()).toBe(true)
    expect(wrapper!.get('.reader-catalog').attributes('id')).toBe('public-reader-catalog')
    expect(wrapper!.get('.reader-stage h1').text()).toBe('当前文稿')
    expect(wrapper!.get('.reader-floating-actions').text()).toContain('评论')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/public/v1/social/profile/content/page', {
      slug: 'creator', offset: 0, limit: 50,
    }, false)

    const links = wrapper!.findAll('.catalog-list a')
    expect(links.map((link) => link.text())).toEqual(['起步文稿', '当前文稿'])
    expect(wrapper!.get('.catalog-list a[aria-current="page"]').text()).toBe('当前文稿')

    await wrapper!.get('input[placeholder="搜索当前知识库"]').setValue('起步')
    expect(wrapper!.findAll('.catalog-list a').map((link) => link.text())).toEqual(['起步文稿'])
  })

  it('keeps the article readable when the optional catalog request fails', async () => {
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/public/v1/social/publication') return readerFixture('current', '可以阅读的正文')
      if (path === '/api/public/v1/social/profile/content/page') throw new Error('catalog offline')
      throw new Error(`Unexpected POST ${path}`)
    })

    await mountReader('/p/current')

    expect(wrapper!.get('.reader-stage h1').text()).toBe('可以阅读的正文')
    expect(wrapper!.get('.public-content-renderer').text()).toContain('正文内容')
    expect(wrapper!.get('.catalog-warning').text()).toContain('目录暂时无法加载')
    expect(wrapper!.get('.catalog-list a[aria-current="page"]').text()).toBe('可以阅读的正文')
  })

  it('ignores a stale publication response after navigating to another reader route', async () => {
    const firstRequest = deferred<PublicReader>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/public/v1/social/publication') {
        const id = String((body as { publicationId: string }).publicationId)
        if (id === 'first') return firstRequest.promise
        return readerFixture('second', '第二篇文稿')
      }
      if (path === '/api/public/v1/social/profile/content/page') return page([content('second', '第二篇文稿')])
      throw new Error(`Unexpected POST ${path}`)
    })

    const router = await mountReader('/p/first')
    await router.push('/p/second')
    await settle()
    expect(wrapper!.get('.reader-stage h1').text()).toBe('第二篇文稿')

    firstRequest.resolve(readerFixture('first', '迟到的第一篇'))
    await settle()
    expect(wrapper!.get('.reader-stage h1').text()).toBe('第二篇文稿')
    expect(wrapper!.text()).not.toContain('迟到的第一篇')
  })

  it('ignores a stale catalog response after a route switch', async () => {
    const firstCatalog = deferred<SocialPage<PublicContent>>()
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/public/v1/social/publication') {
        const id = String((body as { publicationId: string }).publicationId)
        return readerFixture(id, id === 'first' ? '第一篇' : '第二篇')
      }
      if (path === '/api/public/v1/social/profile/content/page') {
        const calls = vi.mocked(post).mock.calls.filter(([calledPath]) => calledPath === '/api/public/v1/social/profile/content/page').length
        return calls === 1 ? firstCatalog.promise : page([content('second', '第二篇')])
      }
      throw new Error(`Unexpected POST ${path}`)
    })

    const router = await mountReader('/p/first')
    await router.push('/p/second')
    await settle()
    expect(wrapper!.get('.catalog-list a[aria-current="page"]').text()).toBe('第二篇')

    firstCatalog.resolve(page([content('first', '迟到的目录项')]))
    await settle()
    expect(wrapper!.get('.catalog-list a[aria-current="page"]').text()).toBe('第二篇')
    expect(wrapper!.text()).not.toContain('迟到的目录项')
  })

  it('opens the compact catalog with focus and restores the trigger on Escape', async () => {
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/public/v1/social/publication') return readerFixture('current', '当前文稿')
      if (path === '/api/public/v1/social/profile/content/page') return page([content('current', '当前文稿')])
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountReader('/p/current')

    const toggle = wrapper!.get<HTMLButtonElement>('.catalog-toggle')
    await toggle.trigger('click')
    await settle()
    expect(wrapper!.get('.reader-catalog').classes()).toContain('catalog-open')
    expect(document.activeElement).toBe(wrapper!.get('input[placeholder="搜索当前知识库"]').element)

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await settle()
    expect(wrapper!.get('.reader-catalog').classes()).not.toContain('catalog-open')
    expect(document.activeElement).toBe(toggle.element)
  })

  it('keeps authenticated reactions working from the floating action rail', async () => {
    vi.mocked(get).mockResolvedValue({ userId: 'viewer', email: 'viewer@example.com', displayName: '访客', instanceAdmin: false })
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/public/v1/social/publication') return readerFixture('current', '当前文稿')
      if (path === '/api/public/v1/social/profile/content/page') return page([content('current', '当前文稿')])
      if (path === '/api/v1/social/reactions/toggle') return { reactions: { LIKE: 4 }, viewerReactions: ['LIKE'] }
      throw new Error(`Unexpected POST ${path}`)
    })
    await mountReader('/p/current')

    await wrapper!.get('button[aria-label="赞这篇文稿"]').trigger('click')
    await settle()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/social/reactions/toggle', {
      publicationId: 'current', reactionType: 'LIKE',
    })
    expect(wrapper!.get('button[aria-label="赞这篇文稿"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper!.get('button[aria-label="赞这篇文稿"]').text()).toContain('4')
  })
})

async function mountReader(path: string): Promise<Router> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/p/:publicationId', component: ReaderView },
      { path: '/explore', component: { template: '<div />' } },
      { path: '/u/:slug', component: { template: '<div />' } },
      { path: '/login', component: { template: '<div />' } },
      { path: '/app', component: { template: '<div />' } },
    ],
  })
  await router.push(path)
  await router.isReady()
  wrapper = mount(ReaderView, { attachTo: document.body, global: { plugins: [pinia, router, vuetify] } })
  await settle()
  return router
}

async function settle() {
  await flushPromises()
  await flushPromises()
}

function readerFixture(publicationId: string, title: string): PublicReader {
  return {
    metadata: content(publicationId, title),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '正文内容' }] }] },
    plainText: '正文内容',
    schemaVersion: 1,
    documentSettings: { pageWidth: 'STANDARD', fontFamily: 'SANS', fontSize: 'MEDIUM', paragraphSpacing: 'NORMAL', showOutline: true },
    pageMetadata: { icon: '📘', cover: null, labels: [] },
    appearanceConfig: { backgroundColor: '#ffffff', accentColor: '#2f6feb', contentWidth: 'STANDARD', theme: 'PAPER' },
    watermarkConfig: { enabled: false },
  }
}

function content(publicationId: string, title: string, knowledgeBaseId = 'kb-current'): PublicContent {
  return {
    publicationId,
    pageId: `${publicationId}-page`,
    knowledgeBaseId,
    knowledgeBaseName: knowledgeBaseId === 'kb-current' ? '产品知识库' : '其他知识库',
    title,
    path: publicationId,
    contentType: 'DOCUMENT',
    preview: `${title}摘要`,
    authorId: 'creator-id',
    authorSlug: 'creator',
    authorName: '创作者',
    authorAvatar: null,
    reactions: { LIKE: 3 },
    viewerReactions: [],
    publishedAt: '2026-08-26T00:00:00Z',
  }
}

function page(items: PublicContent[]): SocialPage<PublicContent> {
  return { items, nextOffset: items.length, hasMore: false }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}
