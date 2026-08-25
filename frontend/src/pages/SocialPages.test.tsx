// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import * as api from '../lib/api'
import { encodeContentCardToken } from '../lib/contentCards'
import { FeedPage, GardenDeleteDialog, KnowledgeBaseFollow, PublicContentBody, PublicSearch } from './SocialPages'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('public document reader', () => {
  it('renders editor blocks and safe inline formatting as document structure', () => {
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: [
        '# 架构说明',
        '普通 **重点**、*补充*、`代码` 与 [官方文档](https://example.com/docs)。',
        '## 实现细节',
        '> 这是一段引用',
        '- 第一项',
        '  - 第二层',
        '3. 第三项',
        '- [x] 已完成',
        '- [ ] 待处理',
        '``` const answer = 42',
        '``` console.log(answer)',
      ].join('\n') }] },
      plainText: '',
      metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getByRole('heading', { level: 2, name: '架构说明' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: '实现细节' }).id).toMatch(/^section-/)
    expect(screen.getByRole('navigation', { name: '本文大纲' }).querySelectorAll('a')).toHaveLength(2)
    expect(screen.getByText('重点').tagName).toBe('STRONG')
    expect(screen.getByText('补充').tagName).toBe('EM')
    expect(screen.getByRole('link', { name: '官方文档' }).getAttribute('href')).toBe('https://example.com/docs')
    expect(screen.getByText('这是一段引用').closest('blockquote')).toBeTruthy()
    expect(screen.getByText('第二层').closest('li')?.getAttribute('style')).toContain('18px')
    expect((screen.getByRole('checkbox', { name: '已完成' }) as HTMLInputElement).checked).toBe(true)
    expect((screen.getByRole('checkbox', { name: '未完成' }) as HTMLInputElement).checked).toBe(false)
    expect(container.querySelector('.reader-code-block code')?.textContent).toBe('const answer = 42\nconsole.log(answer)')
  })

  it('keeps surrounding prose and renders an uploaded media card', () => {
    const attachmentId = '0198fbe0-ae3d-7000-8000-000000000099'
    const token = encodeContentCardToken('image', 1, {
      url: `/api/v1/attachments/${attachmentId}/content`,
      alt: '架构图',
      attachmentId,
      width: 'SMALL',
    }, '0198fbe0-ae3d-7000-8000-000000000100')
    render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: `正文之前\n\n${token}\n\n正文之后` }] },
      plainText: `正文之前 ${token} 正文之后`,
      metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getByText('正文之前')).toBeTruthy()
    expect(screen.getByText('正文之后')).toBeTruthy()
    const image = screen.getByRole('img', { name: '架构图' })
    expect(image.getAttribute('src')).toBe(`/api/v1/attachments/${attachmentId}/content`)
    expect(image.closest('.media-card')?.classList.contains('image-width-small')).toBe(true)
  })

  it('renders column cards with saved ratios and block content', () => {
    const token = encodeContentCardToken('columns', 1, {
      count: 2,
      columns: [{ content: '# 左栏标题\n左侧正文' }, { content: '## 右栏标题\n右侧正文' }],
      ratios: [1, 2],
    }, '0198fbe0-ae3d-7000-8000-000000000101')
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: token }] },
      plainText: token,
      metadata: { contentType: 'DOCUMENT' },
    }} />)

    const columns = container.querySelector('.public-columns-card') as HTMLElement
    expect(columns.style.gridTemplateColumns).toBe('1fr 2fr')
    expect(screen.getByRole('heading', { level: 2, name: '左栏标题' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: '右栏标题' })).toBeTruthy()
  })

  it('renders calendar events and mind-map topics in the public reader', () => {
    const calendar = encodeContentCardToken('calendar', 1, {
      timezone: 'Asia/Shanghai',
      events: [{ id: 'launch', title: '正式发布', start: '2026-08-24T10:00:00+08:00', end: '2026-08-24T11:00:00+08:00' }],
    }, '0198fbe0-ae3d-7000-8000-000000000136')
    const mindMap = encodeContentCardToken('mind-map', 1, { root: '产品架构' }, '0198fbe0-ae3d-7000-8000-000000000137')
    render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: `${calendar}\n${mindMap}` }] },
      plainText: '',
      metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getByText('正式发布')).toBeTruthy()
    expect(screen.getByText('产品架构')).toBeTruthy()
    expect(screen.getByText('Asia/Shanghai')).toBeTruthy()
  })

  it('renders a gallery as ordered accessible images', () => {
    const gallery = encodeContentCardToken('gallery', 1, { items: [
      { id: 'one', url: 'https://cdn.example.com/one.png', alt: '第一张图' },
      { id: 'two', url: 'https://cdn.example.com/two.png', alt: '第二张图' },
    ] }, '0198fbe0-ae3d-7000-8000-000000000140')
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: gallery }] }, plainText: '', metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getAllByRole('img').map((image) => image.getAttribute('alt'))).toEqual(['第一张图', '第二张图'])
    expect(container.querySelectorAll('.gallery-content-card figure')).toHaveLength(2)
  })

  it('renders encrypted sensitive text without exposing ciphertext as document text', () => {
    const token = encodeContentCardToken('sensitive-text', 1, {
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA',
      salt: 'AAAAAAAAAAAAAAAAAAAAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      kdf: 'PBKDF2-SHA256',
      iterations: 210_000,
      hint: '纪念日',
    }, '0198fbe0-ae3d-7000-8000-000000000143')
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: token }] }, plainText: '', metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getByText('纪念日')).toBeTruthy()
    expect(screen.getByLabelText('敏感内容查看密码')).toBeTruthy()
    expect(container.textContent).not.toContain('AAAAAAAAAAAAAAAAAAAAAAA')
  })

  it('renders a mention label without exposing the internal user id', () => {
    const userId = '0198fbe0-ae3d-7000-8000-000000000154'
    const token = encodeContentCardToken('mention', 1, { userId, label: '林静' }, '0198fbe0-ae3d-7000-8000-000000000155')
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'doc', content: [{ type: 'paragraph', text: token }] }, plainText: '', metadata: { contentType: 'DOCUMENT' },
    }} />)

    expect(screen.getByText('林静')).toBeTruthy()
    expect(container.textContent).not.toContain(userId)
  })

  it('renders ordered kanban columns and cards', () => {
    const token = encodeContentCardToken('kanban', 1, { columns: [
      { id: 'todo', title: '待处理', color: '#6f9c7e', cards: [{ id: 'one', title: '实现登录', description: '密码与验证码' }] },
      { id: 'done', title: '已完成', color: '#5f7798', cards: [{ id: 'two', title: '搭建项目', description: '' }] },
    ] }, '0198fbe0-ae3d-7000-8000-000000000159')
    const { container } = render(<PublicContentBody reader={{ content: { type: 'doc', content: [{ type: 'paragraph', text: token }] }, plainText: '', metadata: { contentType: 'DOCUMENT' } }} />)

    expect([...container.querySelectorAll('.kanban-content-card > section > header strong')].map((node) => node.textContent)).toEqual(['待处理', '已完成'])
    expect(screen.getByText('实现登录')).toBeTruthy()
    expect(screen.getByText('密码与验证码')).toBeTruthy()
  })

  it('renders a database card in its selected view', () => {
    const token = encodeContentCardToken('database', 1, {
      type: 'database', view: 'KANBAN', filter: '', sortFieldId: null,
      fields: [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '已完成'] }],
      rows: [{ id: 'row-one', values: { name: '首页改版', status: '待处理' }, createdAt: '2026-08-25T08:00:00Z' }],
    }, '0198fbe0-ae3d-7000-8000-000000000162')
    const { container } = render(<PublicContentBody reader={{ content: { type: 'doc', content: [{ type: 'paragraph', text: token }] }, plainText: '', metadata: { contentType: 'DOCUMENT' } }} />)

    expect(container.querySelector('.database-card-view.view-kanban')).toBeTruthy()
    expect(screen.getByText('首页改版')).toBeTruthy()
    expect(screen.getByText('待处理')).toBeTruthy()
  })

  it('renders structured drawing cards as safe read-only canvases', () => {
    const token = encodeContentCardToken('excalidraw', 1, {
      type: 'excalidraw', viewport: { x: 0, y: 0, zoom: 1 }, elements: [
        { id: 'decision', kind: 'DIAMOND', x: 30, y: 25, width: 170, height: 100, text: '是否通过？', color: '#fff1a8' },
        { id: 'arrow', kind: 'ARROW', x: 200, y: 70, width: 180, height: 28, text: '', color: '#ffffff' },
      ],
    }, '0198fbe0-ae3d-7000-8000-000000000168')
    const { container } = render(<PublicContentBody reader={{ content: { type: 'doc', content: [{ type: 'paragraph', text: token }] }, plainText: '', metadata: { contentType: 'DOCUMENT' } }} />)

    expect(screen.getByText('Excalidraw 手绘')).toBeTruthy()
    expect(screen.getByText('是否通过？')).toBeTruthy()
    expect(container.querySelector('.drawing-card-view .kind-diamond')).toBeTruthy()
    expect(container.querySelector('.drawing-card-view marker')).toBeTruthy()
    expect(container.querySelector('textarea')).toBeNull()
  })

  it('renders diagram source and LaTeX as visual, script-free content', () => {
    const mermaid = encodeContentCardToken('mermaid', 1, { source: 'graph LR\nA[开始] -->|检查| B{通过}\nB --> C[发布]' }, '0198fbe0-ae3d-7000-8000-000000000171')
    const formula = encodeContentCardToken('formula', 1, { latex: '\\frac{x^2 + \\pi}{2}' }, '0198fbe0-ae3d-7000-8000-000000000172')
    const { container } = render(<PublicContentBody reader={{ content: { type: 'doc', content: [{ type: 'paragraph', text: `${mermaid}\n${formula}` }] }, plainText: '', metadata: { contentType: 'DOCUMENT' } }} />)

    expect(screen.getByRole('img', { name: 'Mermaid预览' })).toBeTruthy()
    expect(screen.getByText('开始')).toBeTruthy()
    expect(screen.getByText('通过')).toBeTruthy()
    expect(screen.getByText('检查')).toBeTruthy()
    expect(screen.getByRole('math').getAttribute('aria-label')).toBe('\\frac{x^2 + \\pi}{2}')
    expect(container.querySelector('.formula-frac')).toBeTruthy()
    expect(container.textContent).toContain('π')
    expect(container.querySelector('script')).toBeNull()
  })

  it('renders first-class whiteboard arrows as connected SVG geometry', () => {
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'whiteboard', viewport: { x: 0, y: 0, zoom: 1 }, elements: [
        { id: 'node', kind: 'STICKY', x: 20, y: 30, width: 180, height: 100, text: '发布流程', color: '#fff1a8' },
        { id: 'edge', kind: 'ARROW', x: 210, y: 70, width: 160, height: 3, text: '', color: '#fff' },
      ] },
      plainText: '', metadata: { contentType: 'WHITEBOARD' },
    }} />)

    expect(screen.getByText('发布流程')).toBeTruthy()
    expect(container.querySelector('.reader-board-arrow line')).toBeTruthy()
    expect(container.querySelector('.reader-board-arrow marker')).toBeTruthy()
    expect(container.querySelector('.reader-board-element.kind-arrow')).toBeNull()
  })

  it('calculates spreadsheet formulas and preserves published cell styles', () => {
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'workbook', activeSheetId: 'sheet', sheets: [{
        id: 'sheet', name: '预算', rows: [['项目', '金额', '内部备注'], ['甲', '10', '不公开'], ['乙', '20', '不公开'], ['合计', '=SUM(B2:B3)', '不公开']],
        styles: { '3:1': { bold: true, italic: true, underline: true, align: 'RIGHT', numberFormat: 'CURRENCY', background: '#dff3e6' } }, frozenRows: 1, frozenColumns: 1, hiddenRows: [2], hiddenColumns: [2], filter: '',
      }] },
      plainText: '', metadata: { contentType: 'SPREADSHEET' },
    }} />)

    const formula = [...container.querySelectorAll('td')].find((cell) => cell.textContent?.includes('30.00')) as HTMLElement
    expect(formula).toBeTruthy()
    expect(formula.style.fontWeight).toBe('700')
    expect(formula.style.fontStyle).toBe('italic')
    expect(formula.style.textDecoration).toBe('underline')
    expect(formula.style.textAlign).toBe('right')
    expect(formula.style.background).toBe('rgb(223, 243, 230)')
    expect(formula.textContent).toContain('¥')
    expect(container.textContent).not.toContain('=SUM(B2:B3)')
    expect(container.textContent).not.toContain('乙')
    expect(container.textContent).not.toContain('内部备注')
    expect(container.querySelector('td.frozen-column')).toBeTruthy()
  })

  it('keeps the selected database view and evaluates formula fields in publications', () => {
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'database', view: 'KANBAN', filter: '', sortFieldId: null,
        fields: [
          { id: 'name', name: '名称', type: 'TEXT' },
          { id: 'status', name: '状态', type: 'SELECT', options: ['进行中'] },
          { id: 'total', name: '合计', type: 'FORMULA', formula: '{单价} * {数量}' },
          { id: 'price', name: '单价', type: 'NUMBER' },
          { id: 'quantity', name: '数量', type: 'NUMBER' },
        ],
        rows: [{ id: 'row', values: { name: '服务器', status: '进行中', price: 120, quantity: 3 }, createdAt: '2026-08-25T00:00:00Z' }],
      },
      plainText: '', metadata: { contentType: 'DATABASE' },
    }} />)

    expect(container.querySelector('.database-card-view.view-kanban')).toBeTruthy()
    expect(screen.getByText('服务器')).toBeTruthy()
    expect(screen.getByText('合计 · 360')).toBeTruthy()
    expect(container.querySelector('.reader-database > table')).toBeNull()
  })

  it('honors the active saved database view and its visible fields in publications', () => {
    const { container } = render(<PublicContentBody reader={{
      content: { type: 'database', view: 'TABLE', filter: '', sortFieldId: null, activeViewId: 'release-view',
        views: [
          { id: 'all', name: '全部', type: 'TABLE', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['name', 'status', 'owner'] },
          { id: 'release-view', name: '发布看板', type: 'KANBAN', filter: '发布', sortFieldId: 'name', groupFieldId: 'status', visibleFieldIds: ['name', 'owner'] },
        ],
        fields: [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['进行中', '已完成'] }, { id: 'owner', name: '负责人', type: 'TEXT' }],
        rows: [
          { id: 'one', values: { name: '发布首页', status: '进行中', owner: '林静' } },
          { id: 'two', values: { name: '内部归档', status: '已完成', owner: '陈明' } },
        ],
      },
      plainText: '', metadata: { contentType: 'DATABASE' },
    }} />)

    expect(container.querySelector('.database-card-view.view-kanban')).toBeTruthy()
    expect(screen.getByText('发布首页')).toBeTruthy()
    expect(screen.getByText('负责人 · 林静')).toBeTruthy()
    expect(screen.queryByText('内部归档')).toBeNull()
    expect(container.textContent).not.toContain('状态 ·')
  })

  it('submits a configured public database form with an idempotency key', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ rowId: 'row-public', duplicate: false, submittedAt: '2026-08-25T12:00:00Z' })
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><PublicContentBody databaseFormPublicationId="publication-form" reader={{
      content: { type: 'database', view: 'TABLE', filter: '', sortFieldId: null,
        fields: [
          { id: 'name', name: '需求名称', type: 'TEXT' },
          { id: 'price', name: '预算', type: 'NUMBER' },
          { id: 'total', name: '合计', type: 'FORMULA', formula: '{预算}' },
        ],
        rows: [],
        form: { enabled: true, title: '需求登记', description: '告诉我们你的需求', submitLabel: '提交需求', successMessage: '登记成功', fieldIds: ['name', 'price'], requiredFieldIds: ['name'] },
      },
      plainText: '', metadata: { contentType: 'DATABASE' },
    }} /></QueryClientProvider>)

    expect(screen.getByRole('heading', { name: '需求登记' })).toBeTruthy()
    expect(screen.queryByLabelText('合计')).toBeNull()
    fireEvent.change(screen.getByLabelText(/需求名称/), { target: { value: '新官网' } })
    fireEvent.change(screen.getByLabelText('预算'), { target: { value: '8000' } })
    fireEvent.click(screen.getByRole('button', { name: '提交需求' }))

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/public/v1/database-forms/submit', {
      publicationId: 'publication-form',
      idempotencyKey: expect.any(String),
      values: { name: '新官网', price: 8000 },
    }, false))
    expect(await screen.findByRole('heading', { name: '登记成功' })).toBeTruthy()
  })
})

describe('public knowledge search', () => {
  it('searches public publications and loads every result page', async () => {
    const first = {
      results: [{ documentId: 'document-1', resourceId: 'page-1', resourceType: 'PAGE' as const, sourceScope: 'PUBLISHED' as const, title: '开放知识架构', snippet: '从公开正文中检索到的架构说明', path: 'open-architecture', contentType: 'DOCUMENT', publicationId: 'publication-1', knowledgeBaseId: 'kb-1', score: 88, updatedAt: '2026-08-25T08:00:00Z' }],
      nextOffset: 1,
      hasMore: true,
    }
    const second = {
      results: [{ documentId: 'document-2', resourceId: 'page-2', resourceType: 'PAGE' as const, sourceScope: 'PUBLISHED' as const, title: '架构实践', snippet: '第二页公开内容', path: 'architecture-practice', contentType: 'WHITEBOARD', publicationId: 'publication-2', knowledgeBaseId: 'kb-1', score: 70, updatedAt: '2026-08-24T08:00:00Z' }],
      nextOffset: 2,
      hasMore: false,
    }
    const post = vi.spyOn(api, 'post').mockResolvedValueOnce(first).mockResolvedValueOnce(second)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<MemoryRouter><QueryClientProvider client={client}><PublicSearch /></QueryClientProvider></MemoryRouter>)

    fireEvent.change(screen.getByLabelText('搜索公开文章'), { target: { value: '  架构  ' } })
    fireEvent.click(screen.getByRole('button', { name: '搜索' }))

    expect((await screen.findByRole('link', { name: /开放知识架构/ })).getAttribute('href')).toBe('/p/publication-1')
    expect(post).toHaveBeenNthCalledWith(1, '/api/public/v1/search', { workspaceId: null, query: '架构', offset: 0, limit: 12 }, false)
    fireEvent.click(screen.getByRole('button', { name: '加载更多结果' }))
    expect((await screen.findByRole('link', { name: /架构实践/ })).getAttribute('href')).toBe('/p/publication-2')
    await waitFor(() => expect(post).toHaveBeenNthCalledWith(2, '/api/public/v1/search', { workspaceId: null, query: '架构', offset: 1, limit: 12 }, false))
    expect(screen.queryByRole('button', { name: '加载更多结果' })).toBeNull()
  })
})

describe('following feed pagination', () => {
  it('loads older followed publications without truncating the feed', async () => {
    const content = (id: string, title: string) => ({
      publicationId: `publication-${id}`, pageId: `page-${id}`, knowledgeBaseId: 'kb-1', knowledgeBaseName: '开放知识库',
      title, path: `page-${id}`, contentType: 'DOCUMENT' as const, preview: `${title}正文`, authorId: 'writer-1', authorSlug: 'writer',
      authorName: '作者', authorAvatar: null, reactions: {}, viewerReactions: [], publishedAt: '2026-08-25T08:00:00Z',
    })
    const post = vi.spyOn(api, 'post')
      .mockResolvedValueOnce({ items: [{ reason: 'FOLLOWING', content: content('1', '最新发布') }], nextOffset: 1, hasMore: true })
      .mockResolvedValueOnce({ items: [{ reason: 'FOLLOWING', content: content('2', '更早发布') }], nextOffset: 2, hasMore: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<MemoryRouter><QueryClientProvider client={client}><FeedPage /></QueryClientProvider></MemoryRouter>)

    expect(await screen.findByText('最新发布')).toBeTruthy()
    expect(post).toHaveBeenNthCalledWith(1, '/api/v1/social/feed/page', { offset: 0, limit: 25 })
    fireEvent.click(screen.getByRole('button', { name: '加载更早的动态' }))
    expect(await screen.findByText('更早发布')).toBeTruthy()
    await waitFor(() => expect(post).toHaveBeenNthCalledWith(2, '/api/v1/social/feed/page', { offset: 1, limit: 25 }))
    expect(screen.queryByRole('button', { name: '加载更早的动态' })).toBeNull()
  })
})

describe('knowledge garden lifecycle', () => {
  it('requires the exact garden title before permanent deletion', async () => {
    const garden = { id: 'garden-delete', userId: 'user-1', ownerSlug: 'writer', ownerName: '作者', slug: 'old-garden', title: '旧知识花园', description: null, icon: '🌿', coverUrl: null, theme: 'PAPER' as const, navigation: [], seoTitle: null, seoDescription: null, discoverable: true, rssEnabled: true, followerCount: 2, followed: false, knowledgeBases: [], updatedAt: '2026-08-25T08:00:00Z' }
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><GardenDeleteDialog garden={garden} onClose={() => undefined} onDeleted={onDeleted} /></QueryClientProvider>)

    const remove = screen.getByRole('button', { name: '永久删除花园' }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('花园标题确认'), { target: { value: garden.title } })
    expect(remove.disabled).toBe(false)
    fireEvent.click(remove)

    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/social/gardens/delete', { gardenId: garden.id }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledOnce())
  })
})

describe('public knowledge-base follow', () => {
  it('loads the saved notification preference and can unmute publication updates', async () => {
    const post = vi.spyOn(api, 'post').mockImplementation(async (path) => path === '/api/v1/social/follow/status'
      ? { followed: true, notificationsEnabled: false }
      : true)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<MemoryRouter><QueryClientProvider client={client}><KnowledgeBaseFollow
      viewer={{ userId: 'reader-1', email: 'reader@example.com', instanceAdmin: false }}
      authorId="writer-1"
      knowledgeBaseId="kb-public"
      knowledgeBaseName="开放知识库"
    /></QueryClientProvider></MemoryRouter>)

    expect(await screen.findByText('已静音')).toBeTruthy()
    expect(post).toHaveBeenCalledWith('/api/v1/social/follow/status', { targetType: 'KNOWLEDGE_BASE', targetId: 'kb-public' })
    fireEvent.click(screen.getByRole('button', { name: '开启发布通知' }))
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/v1/social/follow', {
      targetType: 'KNOWLEDGE_BASE', targetId: 'kb-public', notificationsEnabled: true,
    }))
    expect(await screen.findByText('接收更新')).toBeTruthy()
  })
})
