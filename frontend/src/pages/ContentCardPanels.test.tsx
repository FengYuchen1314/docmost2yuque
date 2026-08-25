// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeContentCardToken, parseContentCardTokens } from '../lib/contentCards'
import type { ContentCardDefinition } from '../types'
import { ContentCardMenu } from './ContentCardPanels'

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  upload: vi.fn(),
  post: vi.fn(async (path: string) => path.endsWith('/definitions') ? [imageDefinition, pollDefinition, checkinDefinition, calendarDefinition, quoteDefinition, tableDefinition, galleryDefinition, sensitiveTextDefinition, mentionDefinition, kanbanDefinition, databaseDefinition, whiteboardDefinition, drawioDefinition, excalidrawDefinition, mindMapDefinition] : path.endsWith('/recent') ? [] : path.endsWith('/workspaces/members') ? mentionMembers : undefined),
}))

const imageDefinition: ContentCardDefinition = {
  id: 'image',
  version: 1,
  title: '图片',
  aliases: ['image'],
  category: '基础',
  icon: 'image',
  fullScreen: false,
  interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'],
  initialData: { url: '', alt: '', width: 'LARGE' },
  enabled: true,
}

const pollDefinition: ContentCardDefinition = {
  id: 'poll',
  version: 1,
  title: '投票',
  aliases: ['poll'],
  category: '协作',
  icon: 'list-checks',
  fullScreen: false,
  interactive: true,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'],
  initialData: { question: '你怎么看？', options: [{ id: 'option-a', label: '选项 A' }, { id: 'option-b', label: '选项 B' }], multiple: false, anonymous: false },
  enabled: true,
}

const checkinDefinition: ContentCardDefinition = {
  id: 'checkin', version: 1, title: '打卡', aliases: ['checkin'], category: '协作', icon: 'calendar-check', fullScreen: false, interactive: true,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true,
  initialData: { title: '每日打卡', startDate: '2026-08-24', endDate: '2026-09-24', timezone: 'Asia/Shanghai' },
}

const calendarDefinition: ContentCardDefinition = {
  id: 'calendar', version: 1, title: '日历', aliases: ['calendar'], category: '协作', icon: 'calendar-days', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true,
  initialData: { timezone: 'Asia/Shanghai', events: [] },
}

const quoteDefinition: ContentCardDefinition = {
  id: 'quote', version: 1, title: '引用', aliases: ['quote'], category: '布局', icon: 'quote', fullScreen: false, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { text: '', source: '' },
}

const tableDefinition: ContentCardDefinition = {
  id: 'table', version: 1, title: '表格', aliases: ['table'], category: '基础', icon: 'table', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { rows: [['', ''], ['', '']] },
}

const galleryDefinition: ContentCardDefinition = {
  id: 'gallery', version: 1, title: '画廊', aliases: ['gallery'], category: '数据', icon: 'images', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { items: [] },
}

const sensitiveTextDefinition: ContentCardDefinition = {
  id: 'sensitive-text', version: 1, title: '敏感文字', aliases: ['sensitive'], category: '安全', icon: 'lock-keyhole', fullScreen: false, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true,
  initialData: { ciphertext: '', salt: '', iv: '', kdf: 'PBKDF2-SHA256', iterations: 210_000, hint: '' },
}

const mentionDefinition: ContentCardDefinition = {
  id: 'mention', version: 1, title: '提及', aliases: ['mention'], category: '协作', icon: 'at-sign', fullScreen: false, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { userId: '', label: '' },
}

const mentionMembers = [
  { userId: '0198fbe0-ae3d-7000-8000-000000000150', email: 'lin@example.com', displayName: '林静', role: 'MEMBER' },
  { userId: '0198fbe0-ae3d-7000-8000-000000000151', email: 'zhou@example.com', displayName: null, role: 'MEMBER' },
]

const kanbanDefinition: ContentCardDefinition = {
  id: 'kanban', version: 1, title: '看板', aliases: ['kanban'], category: '数据', icon: 'columns', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true,
  initialData: { columns: [{ id: 'todo', title: '待处理', color: '#6f9c7e', cards: [] }, { id: 'done', title: '已完成', color: '#5f7798', cards: [] }] },
}

const databaseDefinition: ContentCardDefinition = {
  id: 'database', version: 1, title: '数据表', aliases: ['database'], category: '数据', icon: 'database', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true,
  initialData: { type: 'database', fields: [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '进行中', '已完成'] }, { id: 'date', name: '日期', type: 'DATE' }], rows: [], view: 'TABLE', filter: '', sortFieldId: null },
}

const drawingViewport = { x: 0, y: 0, zoom: 1 }
const whiteboardDefinition: ContentCardDefinition = {
  id: 'whiteboard', version: 1, title: '画板', aliases: ['whiteboard'], category: '图形', icon: 'pen-tool', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { type: 'whiteboard', viewport: drawingViewport, elements: [] },
}
const drawioDefinition: ContentCardDefinition = {
  id: 'drawio', version: 1, title: 'Draw.io', aliases: ['drawio'], category: '图形', icon: 'shapes', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { type: 'drawio', viewport: drawingViewport, nodes: [], edges: [], xml: '<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/></root></mxGraphModel></diagram></mxfile>' },
}
const excalidrawDefinition: ContentCardDefinition = {
  id: 'excalidraw', version: 1, title: 'Excalidraw', aliases: ['excalidraw'], category: '图形', icon: 'pencil', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { type: 'excalidraw', viewport: drawingViewport, elements: [] },
}
const mindMapDefinition: ContentCardDefinition = {
  id: 'mind-map', version: 1, title: '思维导图', aliases: ['mind-map'], category: '图形', icon: 'git-branch', fullScreen: true, interactive: false,
  exportFormats: ['MARKDOWN', 'HTML', 'PDF', 'DOCX'], enabled: true, initialData: { root: '中心主题', nodes: [] },
}

afterEach(cleanup)

describe('content card configuration', () => {
  it('exposes the slash command palette as a keyboard listbox', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000120" onInsert={() => undefined} onClose={() => undefined} /></QueryClientProvider>)

    const search = await screen.findByRole('combobox', { name: '搜索内容卡片' })
    const listbox = screen.getByRole('listbox', { name: '内容卡片命令' })
    const image = await screen.findByRole('option', { name: /图片/ })
    const poll = screen.getByRole('option', { name: /投票/ })
    expect(search.getAttribute('aria-controls')).toBe(listbox.id)
    expect(search.getAttribute('aria-activedescendant')).toBe(image.id)
    expect(image.getAttribute('aria-selected')).toBe('true')

    fireEvent.keyDown(search, { key: 'ArrowDown' })
    expect(search.getAttribute('aria-activedescendant')).toBe(poll.id)
    fireEvent.keyDown(search, { key: 'End' })
    expect(search.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: /思维导图/ }).id)
    fireEvent.keyDown(search, { key: 'Home' })
    expect(search.getAttribute('aria-activedescendant')).toBe(image.id)

    fireEvent.change(search, { target: { value: '投票' } })
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1))
    fireEvent.keyDown(search, { key: 'Enter' })
    expect(await screen.findByRole('heading', { name: '投票' })).toBeTruthy()
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.closest('.card-configuration')).toBeTruthy())
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(await screen.findByRole('combobox', { name: '搜索内容卡片' })).toBeTruthy()
  })

  it('edits an image card while preserving its instance id', async () => {
    const instanceId = '0198fbe0-ae3d-7000-8000-000000000124'
    const initial = parseContentCardTokens(encodeContentCardToken('image', 1, {
      url: 'https://cdn.example.com/image.png',
      alt: '旧说明',
      width: 'SMALL',
    }, instanceId))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000125" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    const alt = await screen.findByLabelText('替代文字')
    fireEvent.change(alt, { target: { value: '新说明' } })
    fireEvent.change(screen.getByLabelText('显示宽度'), { target: { value: 'FULL' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const updated = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]
    expect(updated?.instanceId).toBe(instanceId)
    expect(updated?.data).toMatchObject({ alt: '新说明', width: 'FULL' })
  })

  it('edits all poll controls without replacing stable option ids', async () => {
    const instanceId = '0198fbe0-ae3d-7000-8000-000000000126'
    const initial = parseContentCardTokens(encodeContentCardToken('poll', 1, {
      question: '午饭吃什么？',
      options: [{ id: 'rice', label: '米饭' }, { id: 'noodle', label: '面条' }],
      multiple: false,
      anonymous: false,
    }, instanceId))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000127" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('投票问题'), { target: { value: '今天吃什么？' } })
    fireEvent.change(screen.getByLabelText('投票选项 2'), { target: { value: '水饺' } })
    fireEvent.click(screen.getByLabelText('允许多选'))
    fireEvent.click(screen.getByLabelText('匿名投票'))
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const updated = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]
    expect(updated?.instanceId).toBe(instanceId)
    expect(updated?.data).toMatchObject({
      question: '今天吃什么？',
      options: [{ id: 'rice', label: '米饭' }, { id: 'noodle', label: '水饺' }],
      multiple: true,
      anonymous: true,
    })
  })

  it('configures a check-in date range and timezone', async () => {
    const instanceId = '0198fbe0-ae3d-7000-8000-000000000128'
    const initial = parseContentCardTokens(encodeContentCardToken('checkin', 1, checkinDefinition.initialData, instanceId))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000129" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('打卡名称'), { target: { value: '晨间阅读' } })
    fireEvent.change(screen.getByLabelText('打卡结束日期'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('打卡时区'), { target: { value: 'Asia/Tokyo' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    expect(parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data).toMatchObject({ title: '晨间阅读', endDate: '2026-10-01', timezone: 'Asia/Tokyo' })
  })

  it('adds a validated calendar event', async () => {
    const instanceId = '0198fbe0-ae3d-7000-8000-000000000130'
    const initial = parseContentCardTokens(encodeContentCardToken('calendar', 1, calendarDefinition.initialData, instanceId))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000131" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: /添加事件/ }))
    fireEvent.change(screen.getByLabelText('日历事件 1 标题'), { target: { value: '正式发布' } })
    fireEvent.change(screen.getByLabelText('日历事件 1 开始'), { target: { value: '2026-08-24T10:00' } })
    fireEvent.change(screen.getByLabelText('日历事件 1 结束'), { target: { value: '2026-08-24T11:00' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const data = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    expect(data?.events).toEqual([expect.objectContaining({ title: '正式发布' })])
    expect(String((data?.events as Array<Record<string, unknown>>)[0]?.start)).toMatch(/^2026-08-24T/)
  })

  it('edits a structured quote without exposing raw JSON', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('quote', 1, { text: '旧引用', source: '旧来源' }, '0198fbe0-ae3d-7000-8000-000000000132'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000133" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('引用内容'), { target: { value: '新引用' } })
    fireEvent.change(screen.getByLabelText('来源（可选）'), { target: { value: '新来源' } })
    expect(screen.queryByText(/"text"/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    expect(parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data).toEqual({ text: '新引用', source: '新来源' })
  })

  it('edits table cells and dimensions with a grid', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('table', 1, { rows: [['名称', '状态'], ['首页', '完成']] }, '0198fbe0-ae3d-7000-8000-000000000134'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000135" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('表格第 2 行第 2 列'), { target: { value: '进行中' } })
    fireEvent.click(screen.getByTitle('添加一列'))
    fireEvent.change(screen.getByLabelText('表格第 1 行第 3 列'), { target: { value: '负责人' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    expect(parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data?.rows).toEqual([['名称', '状态', '负责人'], ['首页', '进行中', '']])
  })

  it('reorders gallery images and edits accessible descriptions', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('gallery', 1, { items: [
      { id: 'one', url: 'https://cdn.example.com/one.png', alt: '第一张' },
      { id: 'two', url: 'https://cdn.example.com/two.png', alt: '第二张' },
    ] }, '0198fbe0-ae3d-7000-8000-000000000138'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000139" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByTitle('画廊图片 1 右移'))
    fireEvent.change(screen.getByLabelText('画廊图片 1 替代文字'), { target: { value: '第二张更新' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const items = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data?.items as Array<Record<string, unknown>>
    expect(items.map((item) => item.id)).toEqual(['two', 'one'])
    expect(items[0]?.alt).toBe('第二张更新')
  })

  it('preserves an existing encrypted payload when only its hint changes', async () => {
    const encrypted = {
      ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAA',
      salt: 'AAAAAAAAAAAAAAAAAAAAAA',
      iv: 'AAAAAAAAAAAAAAAA',
      kdf: 'PBKDF2-SHA256',
      iterations: 210_000,
      hint: '旧提示',
    }
    const initial = parseContentCardTokens(encodeContentCardToken('sensitive-text', 1, encrypted, '0198fbe0-ae3d-7000-8000-000000000141'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000142" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('密码提示（可选）'), { target: { value: '仅项目负责人知晓' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const updated = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    expect(updated).toMatchObject({ ...encrypted, hint: '仅项目负责人知晓' })
  })

  it('selects a workspace member and stores a stable user id with its visible label', async () => {
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000152" workspaceId="0198fbe0-ae3d-7000-8000-000000000153" onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByPlaceholderText('搜索卡片、中文名或英文别名'), { target: { value: '提及' } })
    fireEvent.click(await screen.findByRole('option', { name: /提及/ }))
    const memberSelect = await screen.findByLabelText('提及成员') as HTMLSelectElement
    await waitFor(() => expect(memberSelect.disabled).toBe(false))
    fireEvent.change(memberSelect, { target: { value: mentionMembers[0]!.userId } })
    const insert = screen.getByRole('button', { name: /插入卡片/ }) as HTMLButtonElement
    await waitFor(() => expect(insert.disabled).toBe(false))
    fireEvent.click(insert)

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    expect(parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data).toEqual({ userId: mentionMembers[0]!.userId, label: '林静' })
  })

  it('edits and moves kanban cards while preserving stable card ids', async () => {
    const initialData = { columns: [
      { id: 'todo', title: '待处理', color: '#6f9c7e', cards: [{ id: 'task-one', title: '旧标题', description: '说明' }] },
      { id: 'done', title: '已完成', color: '#5f7798', cards: [] },
    ] }
    const initial = parseContentCardTokens(encodeContentCardToken('kanban', 1, initialData, '0198fbe0-ae3d-7000-8000-000000000157'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000158" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('看板第 1 列卡片 1 标题'), { target: { value: '完成发布页' } })
    fireEvent.click(screen.getByTitle('卡片移到右列'))
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const columns = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data?.columns as Array<{ id: string; cards: Array<{ id: string; title: string }> }>
    expect(columns[0]?.cards).toEqual([])
    expect(columns[1]?.cards).toEqual([expect.objectContaining({ id: 'task-one', title: '完成发布页' })])
  })

  it('uses the full database editor to add typed records and change views', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('database', 1, databaseDefinition.initialData, '0198fbe0-ae3d-7000-8000-000000000160'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000161" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '新记录' }))
    fireEvent.change(screen.getByLabelText('名称'), { target: { value: '首页改版' } })
    fireEvent.change(screen.getByLabelText('状态'), { target: { value: '进行中' } })
    fireEvent.change(screen.getByLabelText('日期'), { target: { value: '2026-08-25' } })
    fireEvent.click(screen.getByRole('button', { name: '创建记录' }))
    fireEvent.click(screen.getByRole('button', { name: '看板' }))
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const data = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    expect(data?.view).toBe('KANBAN')
    expect(data?.rows).toEqual([expect.objectContaining({ values: { name: '首页改版', status: '进行中', date: '2026-08-25' } })])
  })

  it('creates and resizes a whiteboard shape with structured data', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('whiteboard', 1, whiteboardDefinition.initialData, '0198fbe0-ae3d-7000-8000-000000000162'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000163" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '矩形' }))
    fireEvent.change(screen.getByLabelText('矩形文字'), { target: { value: '项目目标' } })
    fireEvent.change(screen.getByLabelText('图形宽度'), { target: { value: '240' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const data = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    expect(data).toMatchObject({ type: 'whiteboard', elements: [expect.objectContaining({ kind: 'RECT', text: '项目目标', width: 240 })] })
  })

  it('creates connected Draw.io nodes and serializes mxGraph XML', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('drawio', 1, drawioDefinition.initialData, '0198fbe0-ae3d-7000-8000-000000000164'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000165" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '矩形' }))
    fireEvent.click(screen.getByRole('button', { name: '椭圆' }))
    fireEvent.click(screen.getByRole('button', { name: '连接节点' }))
    const labels = screen.getAllByRole('textbox', { name: /文字/ })
    fireEvent.click(labels[0]!)
    fireEvent.click(labels[1]!)
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const data = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    expect(data?.edges).toHaveLength(1)
    expect(data?.xml).toContain('<mxGraphModel>')
    expect(data?.xml).toContain('edge="1"')
  })

  it('adds an Excalidraw diamond without raw JSON editing', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('excalidraw', 1, excalidrawDefinition.initialData, '0198fbe0-ae3d-7000-8000-000000000166'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000167" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '菱形' }))
    fireEvent.change(screen.getByLabelText('菱形文字'), { target: { value: '是否通过？' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    expect(parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data).toMatchObject({ type: 'excalidraw', elements: [expect.objectContaining({ kind: 'DIAMOND', text: '是否通过？' })] })
  })

  it('builds nested mind-map branches with stable identities', async () => {
    const initial = parseContentCardTokens(encodeContentCardToken('mind-map', 1, mindMapDefinition.initialData, '0198fbe0-ae3d-7000-8000-000000000169'))[0]!
    const onInsert = vi.fn()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentCardMenu pageId="0198fbe0-ae3d-7000-8000-000000000170" initialCard={initial} onInsert={onInsert} onClose={() => undefined} /></QueryClientProvider>)

    fireEvent.change(await screen.findByLabelText('思维导图中心主题'), { target: { value: '产品架构' } })
    fireEvent.click(screen.getByRole('button', { name: /添加主分支/ }))
    fireEvent.change(screen.getByLabelText('思维导图节点 1'), { target: { value: '前端' } })
    fireEvent.click(screen.getByTitle('添加子分支'))
    fireEvent.change(screen.getByLabelText('思维导图节点 2'), { target: { value: '编辑器' } })
    fireEvent.click(screen.getByRole('button', { name: /保存更改/ }))

    await waitFor(() => expect(onInsert).toHaveBeenCalledOnce())
    const data = parseContentCardTokens(onInsert.mock.calls[0]![0] as string)[0]?.data
    const nodes = data?.nodes as Array<{ id: string; parentId: string | null; text: string }>
    expect(data?.root).toBe('产品架构')
    expect(nodes[0]?.text).toBe('前端')
    expect(nodes[1]).toMatchObject({ parentId: nodes[0]?.id, text: '编辑器' })
  })
})
