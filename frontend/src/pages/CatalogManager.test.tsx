// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post } from '../lib/api'
import type { CatalogTree, Page } from '../types'
import { CatalogManager } from './CatalogManager'

const tree: CatalogTree = {
  knowledgeBaseId: 'kb-1',
  revision: 7,
  nodes: [
    { id: 'group-a', knowledgeBaseId: 'kb-1', nodeType: 'GROUP', pageId: null, parentId: null, position: '1', titleOverride: '产品', url: null },
    { id: 'doc-a', knowledgeBaseId: 'kb-1', nodeType: 'DOCUMENT', pageId: 'page-a', parentId: 'group-a', position: '1', titleOverride: '需求文档', url: null },
    { id: 'group-b', knowledgeBaseId: 'kb-1', nodeType: 'GROUP', pageId: null, parentId: null, position: '2', titleOverride: '归档', url: null },
  ],
}
const page = { id: 'page-a', knowledgeBaseId: 'kb-1', workspaceId: 'workspace-1', title: '原始需求', path: 'requirements', contentType: 'DOCUMENT', draftRevision: 3 } as Page
const copiedPage = { ...page, id: 'page-copy', title: '原始需求（副本）', path: 'requirements-copy', draftRevision: 1 }

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  post: vi.fn(async (path: string, body: unknown) => {
    if (path === '/api/v1/catalog/list') return tree
    if (path === '/api/v1/catalog/history/page') return (body as { offset: number }).offset === 0
      ? { items: [{ id: 'revision-7', knowledgeBaseId: 'kb-1', revisionNo: 7, operation: 'MOVE', actorId: 'user-1', snapshot: {}, createdAt: '2026-08-25T10:00:00Z' }], nextOffset: 1, hasMore: true }
      : { items: [{ id: 'revision-6', knowledgeBaseId: 'kb-1', revisionNo: 6, operation: 'CREATE', actorId: 'user-1', snapshot: {}, createdAt: '2026-08-24T10:00:00Z' }], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/catalog/batch') return { ...tree, revision: tree.revision + 1 }
    if (path === '/api/v1/catalog/move') return { ...tree, revision: tree.revision + 1 }
    if (path === '/api/v1/catalog/rename') return { ...tree, revision: tree.revision + 1 }
    if (path === '/api/v1/pages/copy') return copiedPage
    if (path === '/api/v1/catalog/create') return { ...tree, revision: tree.revision + 1, nodes: [...tree.nodes, { id: 'doc-copy', knowledgeBaseId: 'kb-1', nodeType: 'DOCUMENT', pageId: copiedPage.id, parentId: 'group-a', position: '2', titleOverride: null, url: null }] }
    if (path === '/api/v1/pages/trash') return undefined
    return undefined
  }),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('catalog batch operations', () => {
  it('offers announced Alt+Arrow alternatives for drag-and-drop reordering', async () => {
    renderCatalog()
    const down = await screen.findByRole('button', { name: '下移 产品' })
    fireEvent.keyDown(down, { key: 'ArrowDown', altKey: true })

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/move', {
      nodeId: 'group-a', targetParentId: null, beforeNodeId: null, afterNodeId: 'group-b', expectedRevision: 7,
    }))
    expect((await screen.findByRole('status')).textContent).toContain('产品 下移，目录已更新')
  })

  it('moves a parent and selected child as one optimistic catalog revision', async () => {
    renderCatalog()
    fireEvent.click(await screen.findByRole('checkbox', { name: '选择 产品' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '选择 需求文档' }))
    fireEvent.change(screen.getByRole('combobox', { name: '批量移动目标' }), { target: { value: 'group-b' } })
    fireEvent.click(screen.getByRole('button', { name: /批量移动/ }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/batch', {
      knowledgeBaseId: 'kb-1', nodeIds: ['group-a', 'doc-a'], operation: 'MOVE', targetParentId: 'group-b', expectedRevision: 7,
    }))
  })

  it('selects all entries and removes them without deleting their documents', async () => {
    renderCatalog()
    await screen.findByRole('checkbox', { name: '选择 产品' })
    fireEvent.click(await screen.findByRole('checkbox', { name: '全选目录项' }))
    fireEvent.click(await screen.findByRole('button', { name: /批量移出/ }))
    const dialog = screen.getByRole('alertdialog', { name: '移出选中的 3 项目录内容' })
    fireEvent.click(within(dialog).getByRole('button', { name: '批量移出' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/batch', {
      knowledgeBaseId: 'kb-1', nodeIds: ['group-a', 'doc-a', 'group-b'], operation: 'REMOVE', targetParentId: null, expectedRevision: 7,
    }))
  })

  it('loads older catalog revisions beyond the first page', async () => {
    renderCatalog()
    expect(await screen.findByText('移动节点')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多目录历史' }))
    expect(await screen.findByText('创建节点')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/history/page', { knowledgeBaseId: 'kb-1', limit: 30, offset: 1 }))
  })

  it('renames a catalog item in an accessible in-app dialog', async () => {
    renderCatalog()
    fireEvent.click(await screen.findByRole('button', { name: '重命名 产品' }))
    expect(screen.getByRole('dialog', { name: '重命名目录项' })).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '新标题' }), { target: { value: '产品手册' } })
    fireEvent.click(screen.getByRole('button', { name: '保存标题' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/rename', {
      nodeId: 'group-a', title: '产品手册', expectedRevision: 7,
    }))
  })

  it('rejects insecure or credentialed external catalog links before submission', async () => {
    renderCatalog()
    fireEvent.click(await screen.findByRole('button', { name: /外部链接/ }))
    fireEvent.change(screen.getByPlaceholderText('链接标题'), { target: { value: '外部系统' } })
    const input = screen.getByPlaceholderText('https://example.com')
    const add = screen.getByRole('button', { name: /添加/ }) as HTMLButtonElement

    fireEvent.change(input, { target: { value: 'https://user:secret@example.com/private' } })
    expect(screen.getByRole('alert').textContent).toContain('HTTPS')
    expect(add.disabled).toBe(true)
    fireEvent.change(input, { target: { value: 'https://example.com/docs' } })
    expect(add.disabled).toBe(false)
  })

  it('copies the current draft beside the original without copying publication policy objects', async () => {
    renderCatalog()
    fireEvent.click(await screen.findByRole('button', { name: '复制文稿 需求文档' }))
    expect(await screen.findByRole('dialog', { name: '复制文稿 原始需求' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '创建副本' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/copy', {
      pageId: page.id, targetKnowledgeBaseId: 'kb-1', title: '原始需求（副本）', path: 'requirements-copy',
    }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/catalog/create', expect.objectContaining({
      knowledgeBaseId: 'kb-1', nodeType: 'DOCUMENT', pageId: copiedPage.id, parentId: 'group-a', afterNodeId: 'doc-a', expectedRevision: 7,
    })))
    expect(await screen.findByText('副本已经创建')).toBeTruthy()
  })

  it('keeps remove-from-catalog and delete-document as separate actions', async () => {
    renderCatalog()
    fireEvent.click(await screen.findByRole('button', { name: '删除文稿 需求文档' }))
    expect(screen.getByRole('alertdialog', { name: '删除文稿「原始需求」' }).textContent).toContain('恢复后仍回到当前目录位置')
    fireEvent.click(screen.getByRole('button', { name: '删除文稿' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/trash', { pageId: page.id }))
    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/catalog/remove')).toBe(false)
  })
})

function renderCatalog() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}><CatalogManager knowledgeBaseId="kb-1" pages={[page]} onClose={() => undefined} /></QueryClientProvider>)
}
