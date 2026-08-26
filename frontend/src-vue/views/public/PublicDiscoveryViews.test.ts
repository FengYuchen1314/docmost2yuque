import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Component } from 'vue'
import type { Explore, Garden, PublicContent, PublicProfile, SearchResponse, SocialPage } from '../../../src/types'
import { vuetify } from '../../plugins/vuetify'
import { get, post } from '../../services/api'
import ExploreView from './ExploreView.vue'
import GardenView from './GardenView.vue'
import ProfileView from './ProfileView.vue'

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

describe('public discovery pages', () => {
  it('searches and opens public content from the restrained discovery list', async () => {
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/public/v1/social/explore') return exploreFixture()
      if (path === '/api/public/v1/search') return searchFixture()
      throw new Error(`Unexpected POST ${path}`)
    })
    const router = await mountView(ExploreView, '/explore')

    expect(wrapper!.get('h1').text()).toBe('发现好知识')
    expect(wrapper!.find('.explore-hero').exists()).toBe(false)
    expect(wrapper!.findAll('.v-card')).toHaveLength(0)
    expect(wrapper!.text()).toContain('热门内容')
    expect(wrapper!.text()).toContain('知识花园')
    expect(wrapper!.get('a[href="/u/creator"]').text()).toContain('创作者')
    expect(wrapper!.get('a[href="/garden/garden"]').text()).toContain('公开花园')

    await wrapper!.get('input[placeholder="搜索公开内容"]').setValue('检索词')
    await wrapper!.get('form[role="search"]').trigger('submit')
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/public/v1/search', {
      workspaceId: null, query: '检索词', offset: 0, limit: 24,
    }, false)
    expect(wrapper!.text()).toContain('搜索结果文档')
    await wrapper!.get('a[href="/p/search-result"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/p/search-result')
  })

  it('keeps profile following and public-content navigation intact without a social cover', async () => {
    vi.mocked(get).mockResolvedValue({ userId: 'viewer', email: 'viewer@example.com', displayName: '访客', instanceAdmin: false })
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/public/v1/social/profile') return profileFixture()
      if (path === '/api/public/v1/social/profile/content/page') return page([content('profile-doc', '主页文档')])
      if (path === '/api/v1/social/follow') return {}
      throw new Error(`Unexpected POST ${path}`)
    })
    const router = await mountView(ProfileView, '/u/creator')

    expect(wrapper!.get('h1').text()).toBe('创作者')
    expect(wrapper!.find('.profile-cover').exists()).toBe(false)
    expect(wrapper!.findAll('.v-card')).toHaveLength(0)
    expect(wrapper!.text()).toContain('主页文档')
    expect(wrapper!.get('a[href="https://example.com"]').attributes('rel')).toContain('noopener')

    await buttonWithText('关注').trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/social/follow', {
      targetType: 'USER', targetId: 'creator-id', notificationsEnabled: true,
    })
    expect(wrapper!.text()).toContain('已关注')
    expect(wrapper!.text()).toContain('4 关注者')

    await wrapper!.get('a[href="/p/profile-doc"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/p/profile-doc')
  })

  it('renders an explicit profile not-found state', async () => {
    vi.mocked(post).mockRejectedValue(new Error('404 profile not found'))
    await mountView(ProfileView, '/u/missing')

    expect(wrapper!.get('[role="alert"]').text()).toContain('没有找到这个个人主页')
    expect(wrapper!.text()).toContain('404 profile not found')
  })

  it('switches garden knowledge bases and opens content through the original endpoints', async () => {
    vi.mocked(post).mockImplementation(async (path, body) => {
      if (path === '/api/public/v1/social/garden') return gardenFixture()
      if (path === '/api/public/v1/social/garden/content/page') {
        const id = (body as { knowledgeBaseId: string | null }).knowledgeBaseId
        return page([id ? content('selected-doc', '产品知识', '产品库') : content('all-doc', '全部知识')])
      }
      throw new Error(`Unexpected POST ${path}`)
    })
    const router = await mountView(GardenView, '/garden/garden')

    expect(wrapper!.get('h1').text()).toBe('公开花园')
    expect(wrapper!.find('.garden-public').exists()).toBe(false)
    expect(wrapper!.findAll('.v-card')).toHaveLength(0)
    expect(wrapper!.text()).toContain('全部知识')
    expect(wrapper!.get('a[href="/u/creator"]').text()).toContain('创作者')

    const productTab = wrapper!.findAll('[role="tab"]').find((tab) => tab.text().includes('产品库'))
    expect(productTab).toBeTruthy()
    await productTab!.trigger('click')
    await flushPromises()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/public/v1/social/garden/content/page', {
      slug: 'garden', knowledgeBaseId: 'kb-product', offset: 0, limit: 48,
    }, false)
    expect(wrapper!.text()).toContain('产品知识')
    expect(wrapper!.text()).not.toContain('全部知识')

    await wrapper!.get('a[href="/p/selected-doc"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/p/selected-doc')
  })

  it('renders an explicit garden not-found state', async () => {
    vi.mocked(post).mockRejectedValue(new Error('404 garden not found'))
    await mountView(GardenView, '/garden/missing')

    expect(wrapper!.get('[role="alert"]').text()).toContain('没有找到这个知识花园')
    expect(wrapper!.text()).toContain('404 garden not found')
  })
})

async function mountView(component: Component, path: string): Promise<Router> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/explore', component: { template: '<div />' } },
      { path: '/u/:slug', component: { template: '<div />' } },
      { path: '/garden/:slug', component: { template: '<div />' } },
      { path: '/p/:publicationId', component: { template: '<div />' } },
      { path: '/:pathMatch(.*)*', component: { template: '<div />' } },
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

function content(publicationId: string, title: string, knowledgeBaseName = '公开知识库'): PublicContent {
  return {
    publicationId, pageId: `${publicationId}-page`, knowledgeBaseId: 'kb', knowledgeBaseName, title,
    path: publicationId, contentType: 'DOCUMENT', preview: `${title}摘要`, authorId: 'creator-id',
    authorSlug: 'creator', authorName: '创作者', authorAvatar: null, reactions: {}, viewerReactions: [],
    publishedAt: '2026-08-26T00:00:00Z',
  }
}

function profileFixture(): PublicProfile {
  return {
    userId: 'creator-id', slug: 'creator', displayName: '创作者', bio: '长期整理产品与技术知识',
    avatarUrl: null, coverUrl: 'https://example.com/unused-cover.jpg', theme: 'PAPER',
    navigation: [{ label: '个人网站', url: 'https://example.com' }], seoTitle: null, seoDescription: null,
    discoverable: true, rssEnabled: true, followerCount: 3, followingCount: 2, followed: false,
    updatedAt: '2026-08-26T00:00:00Z',
  }
}

function gardenFixture(): Garden {
  return {
    id: 'garden-id', userId: 'creator-id', ownerSlug: 'creator', ownerName: '创作者', slug: 'garden',
    title: '公开花园', description: '聚合产品与技术知识', icon: '🌿', coverUrl: 'https://example.com/unused-cover.jpg',
    theme: 'PAPER', navigation: [{ label: '站点', url: 'https://example.com' }], seoTitle: null,
    seoDescription: null, discoverable: true, rssEnabled: true, followerCount: 8, followed: false,
    knowledgeBases: [
      { id: 'kb-product', name: '产品库', slug: 'product', description: '产品知识', icon: '📘' },
      { id: 'kb-tech', name: '技术库', slug: 'tech', description: null, icon: null },
    ],
    updatedAt: '2026-08-26T00:00:00Z',
  }
}

function exploreFixture(): Explore {
  return {
    trending: [content('trending', '热门文档')],
    latest: [content('latest', '最新文档')],
    creators: [profileFixture()],
    gardens: [gardenFixture()],
  }
}

function searchFixture(): SearchResponse {
  return {
    results: [{
      documentId: 'search-result', resourceId: 'search-page', resourceType: 'PAGE', sourceScope: 'PUBLISHED',
      title: '搜索结果文档', snippet: '命中的正文摘要', path: 'search-result', contentType: 'DOCUMENT',
      publicationId: 'search-result', knowledgeBaseId: 'kb', score: 1, updatedAt: '2026-08-26T00:00:00Z',
    }],
    nextOffset: 1,
    hasMore: false,
  }
}

function page(items: PublicContent[]): SocialPage<PublicContent> {
  return { items, nextOffset: items.length, hasMore: false }
}
