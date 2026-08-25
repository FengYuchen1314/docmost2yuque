// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadPost, post, request } from '../lib/api'
import { encodeContentCardToken } from '../lib/contentCards'
import { ShareReaderPage } from './ShareReaderPage'

const token = 'a'.repeat(32)

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  post: vi.fn(async (path: string) => {
    if (path !== '/api/v1/shares/resolve') return undefined
    return {
      share: { role: 'READER', allowCopy: true, allowDownload: true, allowExport: true, allowComment: false, allowSearchIndex: false, expiresAt: null },
      passwordRequired: false,
      approvalRequired: false,
      approvalStatus: 'APPROVED',
      publication: { id: 'publication', pageId: 'page', contentType: 'DOCUMENT', title: '受控文稿', content: { type: 'doc', content: [{ type: 'paragraph', text: '正文' }] }, plainText: '正文', metadata: { icon: '🧭', cover: 'https://cdn.example.com/page-cover.jpg' }, schemaVersion: 1, publishedAt: '2026-08-25T10:00:00Z' },
      appearanceConfig: { theme: 'DARK', contentWidth: 'WIDE', accentColor: '#123456', backgroundColor: '#202020' },
      watermarkConfig: { enabled: true, text: '内部 · {{email}}', position: 'FOOTER', opacity: 0.2 },
    }
  }),
  request: vi.fn(async () => ({ userId: 'viewer', email: 'reader@example.com', instanceAdmin: false })),
  downloadPost: vi.fn(async (path: string) => ({
    blob: new Blob(['server artifact']),
    filename: path.endsWith('/export') ? '受控文稿.json' : '受控文稿.txt',
  })),
}))

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('controlled share reader', () => {
  it('applies knowledge-base appearance and identifies the signed-in viewer in its watermark', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', { name: '受控文稿' })).toBeTruthy()
    expect(await screen.findByText('内部 · reader@example.com')).toBeTruthy()
    expect(screen.getByText('🧭')).toBeTruthy()
    expect((container.querySelector('.reader-page-cover') as HTMLElement).style.backgroundImage).toContain('page-cover.jpg')
    expect(container.querySelector('.shared-reader-page')?.classList.contains('kb-reader-theme-dark')).toBe(true)
    const reader = container.querySelector('.public-reader') as HTMLElement
    expect(reader.classList.contains('kb-reader-width-wide')).toBe(true)
    expect(reader.style.getPropertyValue('--reader-accent')).toBe('#123456')
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/resolve', { token, accessToken: null, pageId: null }, false)
    expect(vi.mocked(request)).toHaveBeenCalledWith('/api/v1/auth/me')
  })

  it('downloads server-generated artifacts instead of rebuilding publication data in the browser', async () => {
    const createObjectURL = vi.fn(() => 'blob:shared-artifact')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '下载文本' }))
    fireEvent.click(screen.getByRole('button', { name: '导出 JSON' }))

    await waitFor(() => expect(downloadPost).toHaveBeenCalledTimes(2))
    expect(vi.mocked(downloadPost)).toHaveBeenCalledWith('/api/v1/shares/download', { token, accessToken: null, pageId: null }, false)
    expect(vi.mocked(downloadPost)).toHaveBeenCalledWith('/api/v1/shares/export', { token, accessToken: null, pageId: null }, false)
    await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2))
    expect(click).toHaveBeenCalledTimes(2)
  })

  it('routes private publication attachments through the active share policy', async () => {
    const attachmentId = '0198fbe0-ae3d-7000-8000-000000000001'
    const content = encodeContentCardToken('image', 1, {
      url: `/api/v1/attachments/${attachmentId}/content`,
      attachmentId,
      alt: '受控图片',
      width: 'LARGE',
    })
    vi.mocked(post).mockImplementationOnce(async () => ({
      share: { role: 'READER', allowCopy: true, allowDownload: false, allowExport: false, allowComment: false, allowSearchIndex: false, expiresAt: null },
      passwordRequired: false,
      approvalRequired: false,
      approvalStatus: 'APPROVED',
      publication: { id: 'publication', pageId: '0198fbe0-ae3d-7000-8000-000000000002', contentType: 'DOCUMENT', title: '私密分享', content: {}, plainText: content, metadata: {}, schemaVersion: 1, publishedAt: '2026-08-25T10:00:00Z' },
      appearanceConfig: {}, watermarkConfig: {},
    }) as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    const image = await screen.findByRole('img', { name: '受控图片' })
    expect(image.getAttribute('src')).toContain(`/api/v1/attachments/${attachmentId}/shared-content?`)
    expect(image.getAttribute('src')).toContain(`shareToken=${token}`)
    expect(image.getAttribute('src')).toContain('sharePageId=0198fbe0-ae3d-7000-8000-000000000002')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
  })

  it('renders a knowledge-base catalog and sends the selected published page to the resolver', async () => {
    vi.mocked(post).mockImplementationOnce(async () => ({
      share: { resourceType: 'KNOWLEDGE_BASE', role: 'READER', allowCopy: true, allowDownload: false, allowExport: false, allowComment: false, allowSearchIndex: false, expiresAt: null },
      passwordRequired: false,
      approvalRequired: false,
      approvalStatus: 'APPROVED',
      knowledgeBase: {
        id: 'kb', name: '研发手册', slug: 'engineering', description: '团队工程知识', icon: '📚', homepagePageId: 'page-1', catalogRevision: 4, selectedPageId: 'page-2',
        pages: [
          { pageId: 'page-1', publicationId: 'pub-1', title: '开始', path: 'start', contentType: 'DOCUMENT', icon: null, publishedAt: '2026-08-25T09:00:00Z' },
          { pageId: 'page-2', publicationId: 'pub-2', title: '部署', path: 'deploy', contentType: 'DOCUMENT', icon: null, publishedAt: '2026-08-25T10:00:00Z' },
        ],
        catalog: [
          { id: 'group', nodeType: 'GROUP', pageId: null, parentId: null, position: '1', title: '运维', url: null },
          { id: 'node-2', nodeType: 'DOCUMENT', pageId: 'page-2', parentId: 'group', position: '1', title: null, url: null },
          { id: 'safe-link', nodeType: 'LINK', pageId: null, parentId: null, position: '2', title: '发布平台', url: 'https://deploy.example.com/releases' },
          { id: 'unsafe-link', nodeType: 'LINK', pageId: null, parentId: null, position: '3', title: '危险入口', url: 'https://user:secret@evil.example/private' },
        ],
      },
      publication: { id: 'pub-2', pageId: 'page-2', contentType: 'DOCUMENT', title: '部署', content: { type: 'doc', content: [{ type: 'paragraph', text: '部署正文' }] }, plainText: '部署正文', metadata: {}, schemaVersion: 1, publishedAt: '2026-08-25T10:00:00Z' },
      appearanceConfig: {}, watermarkConfig: {},
    }) as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}?page=page-2`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', { name: '部署' })).toBeTruthy()
    expect(screen.getByText('研发手册')).toBeTruthy()
    expect(screen.getByText('运维')).toBeTruthy()
    expect(screen.getByText('/deploy')).toBeTruthy()
    expect(screen.getByRole('link', { name: '发布平台' }).getAttribute('href')).toBe('https://deploy.example.com/releases')
    expect(screen.queryByRole('link', { name: '危险入口' })).toBeNull()
    expect(screen.getByText('危险入口').closest('[aria-disabled="true"]')).toBeTruthy()
    expect(container.querySelector('.shared-kb-catalog-link.active')).toBeTruthy()
    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/resolve', { token, accessToken: null, pageId: 'page-2' }, false)
  })

  it('accepts an authenticated page invitation and keeps a direct workspace destination', async () => {
    const pendingInvite = {
      share: { resourceType: 'PAGE', resourceId: 'page-invite', shareType: 'INVITE_LINK', role: 'EDITOR', allowCopy: false, allowDownload: false, allowExport: false, allowComment: true, allowSearchIndex: false, expiresAt: null },
      passwordRequired: false,
      approvalRequired: false,
      approvalStatus: 'APPROVED',
      publication: null,
      knowledgeBase: null,
      acceptanceRequired: true,
      destinationKnowledgeBaseId: 'kb-invite',
    }
    vi.mocked(post)
      .mockImplementationOnce(async () => pendingInvite as never)
      .mockImplementationOnce(async () => ({ resourceType: 'PAGE', resourceId: 'page-invite', knowledgeBaseId: 'kb-invite', role: 'EDITOR', alreadyAccepted: false }) as never)
      .mockImplementationOnce(async () => ({ ...pendingInvite, acceptanceRequired: false }) as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '接受邀请' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/accept-invite', { token, accessToken: null }))
    const destination = await screen.findByRole('link', { name: '打开工作区' })
    expect(destination.getAttribute('href')).toBe('/app/kb/kb-invite/pages/page-invite')
  })

  it('renders an immutable quick-note snapshot with its captured source revision', async () => {
    vi.mocked(post).mockImplementationOnce(async () => ({
      share: { resourceType: 'QUICK_NOTE', resourceId: 'note-1', shareType: 'PUBLIC', role: 'READER', allowCopy: true, allowDownload: true, allowExport: true, allowComment: false, allowSearchIndex: false, expiresAt: null },
      passwordRequired: false,
      approvalRequired: false,
      approvalStatus: 'APPROVED',
      publication: null,
      knowledgeBase: null,
      quickNote: {
        id: 'note-1', sourceRevision: 7, content: { type: 'doc', content: [{ type: 'paragraph', text: '创建链接时的灵感' }] }, plainText: '创建链接时的灵感', capturedAt: '2026-08-25T12:30:00Z',
      },
      appearanceConfig: {}, watermarkConfig: {},
    }) as never)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    const { container } = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/s/${token}`]}><Routes><Route path="/s/:token" element={<ShareReaderPage />} /></Routes></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByRole('heading', { name: '共享小记' })).toBeTruthy()
    expect(screen.getByText('创建链接时的灵感')).toBeTruthy()
    expect(screen.getByText('来源版本 7')).toBeTruthy()
    expect(screen.getByText('后续编辑不会改变此快照')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载小记文本' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '导出小记 JSON' })).toBeTruthy()
    expect(container.querySelector('.shared-quick-note-reader')).toBeTruthy()
    expect(document.querySelector<HTMLMetaElement>('meta[name="robots"]')?.content).toBe('noindex,nofollow')
  })
})
