// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post } from '../lib/api'
import type { Comment, KnowledgeBase, KnowledgeBaseGroup, Template, TrashItem, Workspace } from '../types'
import { CommentDrawer } from './EngagementPanels'
import { PageExportDialog } from './ContentTransferCenter'
import { Appearance, Danger } from './KnowledgeBaseSettings'
import { PageLabelsEditor, PublicationPanel, ShareManager } from './PageManagement'
import { GlobalTrashPage, KnowledgeBaseGroups, NotificationsPage, PermanentTrashDeleteDialog, WorkbenchHistoryClear } from './ProductPages'
import { SaveTemplateDialog, TemplateCenter } from './TemplateCenter'
import { UserGroupManagement } from './WorkspaceSettings'
import { PageViewTracker } from './WorkspaceApp'
import { QuickNoteBatchToolbar, QuickNoteTagManager } from './ProductPages'

const workspace: Workspace = { id: '0198fbe0-ae3d-7000-8000-000000000200', workspaceType: 'ORGANIZATION', name: '远山工作室', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'ADMIN' }
const knowledgeBases: KnowledgeBase[] = [knowledgeBase('201', 'API'), knowledgeBase('202', '设计')]
const groups: KnowledgeBaseGroup[] = [group('210', '研发', knowledgeBases), group('211', '产品', [])]
const comment: Comment = { id: '0198fbe0-ae3d-7000-8000-000000000220', workspaceId: workspace.id, pageId: '0198fbe0-ae3d-7000-8000-000000000221', parentId: null, anchor: { kind: 'PAGE' }, body: {}, plainText: '旧评论', status: 'OPEN', createdBy: '0198fbe0-ae3d-7000-8000-000000000222', creatorEmail: 'owner@example.com', resolvedBy: null, resolvedAt: null, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
const template: Template = { id: '0198fbe0-ae3d-7000-8000-000000000230', workspaceId: workspace.id, templateType: 'DOCUMENT', name: '研发周报', description: '每周研发进度', category: '研发', thumbnail: null, sourceResourceId: comment.pageId, snapshot: {}, visibility: 'PRIVATE', useCount: 3, createdBy: comment.createdBy, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
const publication = { id: '0198fbe0-ae3d-7000-8000-000000000240', workspaceId: workspace.id, knowledgeBaseId: knowledgeBases[0]!.id, pageId: comment.pageId, sourceDraftRevision: 3, contentType: 'DOCUMENT', title: '旧版发布内容', content: { type: 'doc', content: [{ type: 'paragraph', text: '不可变历史正文' }] }, plainText: '不可变历史正文', metadata: { icon: '🧭', cover: 'https://cdn.example.com/history.jpg', documentSettings: { pageWidth: 'WIDE' } }, schemaVersion: 1, publishedBy: comment.createdBy, publishedAt: '2026-08-25T10:00:00Z', supersededAt: '2026-08-25T11:00:00Z' }
const mergePlan = { sourceKnowledgeBaseId: knowledgeBases[0]!.id, sourceName: 'API', targetKnowledgeBaseId: knowledgeBases[1]!.id, targetName: '设计', pageCount: 8, activePageCount: 7, catalogNodeCount: 6, publicationCount: 4, memberCount: 3, activeKnowledgeBaseShareCount: 1, paths: [{ pageId: comment.pageId, title: '接口规范', originalPath: 'guide', resolvedPath: 'guide-api', renamed: true }], warnings: ['目标知识库设置保持不变'], fingerprint: 'a'.repeat(64) }
const trashItem: TrashItem = { id: comment.pageId, workspaceId: workspace.id, workspaceName: workspace.name, knowledgeBaseId: knowledgeBases[0]!.id, knowledgeBaseName: knowledgeBases[0]!.name, knowledgeBaseIcon: '📚', title: '已删除的接口规范', contentType: 'DOCUMENT', path: 'deleted-api-guide', deletedBy: comment.createdBy, deletedByName: '林静', deletedByEmail: 'owner@example.com', deletedAt: '2026-08-25T10:00:00Z', restoreAllowed: true, deleteAllowed: true }

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  post: vi.fn(async (path: string, body: unknown) => {
    if (path === '/api/v1/comments/page') return (body as { offset: number }).offset === 0
      ? { items: [comment], nextOffset: 1, hasMore: true }
      : { items: [{ ...comment, id: '0198fbe0-ae3d-7000-8000-000000000223', plainText: '第二页评论' }], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/workspaces/members') return []
    if (path === '/api/v1/comments/update') return { ...comment, plainText: (body as { plainText: string }).plainText }
    if (path === '/api/v1/templates/page') return { items: [template], nextOffset: 1, hasMore: false }
    if (path === '/api/v1/templates/get') return template
    if (path === '/api/v1/knowledge-bases/list') return knowledgeBases
    if (path === '/api/v1/pages/publication-state') return { pageId: comment.pageId, draftRevision: 4, publicationId: null, publishedDraftRevision: null, published: false, upToDate: false, effectivePublishMode: 'AUTO', automaticJobStatus: 'PENDING' }
    if (path === '/api/v1/pages/publication-history/page') return (body as { offset: number }).offset === 0
      ? { items: [publication], nextOffset: 1, hasMore: true }
      : { items: [{ ...publication, id: '0198fbe0-ae3d-7000-8000-000000000241', sourceDraftRevision: 2, title: '更早发布内容' }], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/pages/labels') return { pageId: comment.pageId, revision: 0, labels: [] }
    if (path === '/api/v1/pages/labels/update') return { pageId: comment.pageId, revision: 1, labels: (body as { labels: unknown[] }).labels }
    if (path === '/api/v1/knowledge-bases/merge/plan') return mergePlan
    if (path === '/api/v1/knowledge-bases/merge/execute') return { mergeId: 'merge-1' }
    if (path === '/api/v1/shares/list') return []
    if (path === '/api/v1/shares/create') return { share: { id: 'share-1' }, token: 'share-token-value' }
    if (path === '/api/v1/user-groups/list') return []
    if (path === '/api/v1/user-groups/create') return { id: 'group-reviewers', workspaceId: workspace.id, name: '产品评审人', description: '参加发布评审', memberCount: 0, createdBy: comment.createdBy, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
    if (path === '/api/v1/activities/page-views/clear') return { deleted: 3 }
    if (path === '/api/v1/notifications/page') return { items: [{ id: 'notification-mention', workspaceId: workspace.id, type: 'COMMENT_MENTION', actorId: comment.createdBy, resourceType: 'PAGE', resourceId: comment.pageId, anchor: {}, payload: { preview: '请看新的评审意见' }, occurrenceCount: 1, readAt: null, createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }], nextOffset: 1, hasMore: false }
    if (path === '/api/v1/pages/trash/page') return { items: [trashItem], nextOffset: 1, hasMore: false }
    if (path === '/api/v1/pages/restore-batch') return []
    return undefined
  }),
}))

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('remaining web operation coverage', () => {
  it('clears personal browsing history without changing analytics', async () => {
    renderWithClient(<WorkbenchHistoryClear />)
    fireEvent.click(screen.getByRole('button', { name: '清空记录' }))
    const dialog = screen.getByRole('alertdialog', { name: '清空全部浏览记录' })
    fireEvent.click(within(dialog).getByRole('button', { name: '清空记录' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/activities/page-views/clear', {}))
  })

  it('filters the paged notification center by message category', async () => {
    renderWithClient(<MemoryRouter><NotificationsPage /></MemoryRouter>)
    expect(await screen.findByText('在评论中提到了你')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '提及' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/notifications/page', {
      unreadOnly: false, category: 'MENTIONS', offset: 0, limit: 25,
    }))
  })

  it('lists manageable trash across workspaces and restores selected pages in one batch', async () => {
    renderWithClient(<MemoryRouter><GlobalTrashPage /></MemoryRouter>)
    expect(await screen.findByText(trashItem.title)).toBeTruthy()
    expect(screen.getByText(`${workspace.name} / ${knowledgeBases[0]!.name} · /${trashItem.path}`)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '恢复' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/restore-batch', { pageIds: [trashItem.id] }))
  })

  it('requires the exact page title before permanent trash deletion', async () => {
    const onDeleted = vi.fn()
    renderWithClient(<PermanentTrashDeleteDialog items={[trashItem]} onClose={() => undefined} onDeleted={onDeleted} />)
    const remove = screen.getByRole('button', { name: '确认永久删除' }) as HTMLButtonElement
    expect(remove.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox', { name: '永久删除确认文字' }), { target: { value: trashItem.title } })
    fireEvent.click(remove)
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/delete-permanently-batch', { pageIds: [trashItem.id] }))
    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith([trashItem.id]))
  })

  it('adds and removes tags from a selected quick-note batch', () => {
    const tag = { id: '0198fbe0-ae3d-7000-8000-000000000260', name: '重点', color: 'RED', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
    const onBatch = vi.fn()
    render(<QuickNoteBatchToolbar selectedCount={2} status="ACTIVE" tags={[tag]} pending={false} onBatch={onBatch} onConvert={() => undefined} onCancel={() => undefined} />)
    fireEvent.change(screen.getByRole('combobox', { name: '批量添加标签' }), { target: { value: tag.id } })
    expect(onBatch).toHaveBeenCalledWith('ADD_TAG', [tag.id])
    fireEvent.change(screen.getByRole('combobox', { name: '批量移除标签' }), { target: { value: tag.id } })
    expect(onBatch).toHaveBeenCalledWith('REMOVE_TAG', [tag.id])
  })

  it('creates, edits and deletes quick-note tags without browser prompts', async () => {
    const tag = { id: '0198fbe0-ae3d-7000-8000-000000000260', name: '重点', color: 'RED', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
    renderWithClient(<QuickNoteTagManager tags={[tag]} onClose={() => undefined} />)

    fireEvent.change(screen.getByRole('textbox', { name: '新标签名称' }), { target: { value: '稍后阅读' } })
    fireEvent.change(screen.getByRole('combobox', { name: '新标签颜色' }), { target: { value: 'BLUE' } })
    fireEvent.click(screen.getByRole('button', { name: '创建标签' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/quick-notes/tags/create', { name: '稍后阅读', color: 'BLUE' }))

    fireEvent.change(screen.getByRole('textbox', { name: '标签名称 重点' }), { target: { value: '最高优先级' } })
    fireEvent.change(screen.getByRole('combobox', { name: '标签颜色 重点' }), { target: { value: 'PURPLE' } })
    fireEvent.click(screen.getByRole('button', { name: '保存标签 重点' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/quick-notes/tags/update', { tagId: tag.id, name: '最高优先级', color: 'PURPLE' }))

    fireEvent.click(screen.getByRole('button', { name: '删除标签 重点' }))
    const deleteDialog = screen.getByRole('alertdialog', { name: '删除标签“重点”' })
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '删除标签' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/quick-notes/tags/delete', { tagId: tag.id }))
  })

  it('records a successful editor visit for recent views and analytics', async () => {
    renderWithClient(<PageViewTracker pageId={comment.pageId} />)
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/activities/page-view', { pageId: comment.pageId }))
  })

  it('lets the comment author edit an existing comment', async () => {
    renderWithClient(<CommentDrawer pageId={comment.pageId} workspaceId={workspace.id} currentUserId={comment.createdBy} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: /编辑/ }))
    fireEvent.change(screen.getByRole('textbox', { name: '编辑评论' }), { target: { value: '更新后的评论' } })
    fireEvent.click(screen.getByRole('button', { name: /保存/ }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/comments/update', expect.objectContaining({ commentId: comment.id, plainText: '更新后的评论' })))
  })

  it('loads an older comment page without replacing the visible discussion', async () => {
    renderWithClient(<CommentDrawer pageId={comment.pageId} workspaceId={workspace.id} currentUserId={comment.createdBy} onClose={() => undefined} />)
    fireEvent.click(await screen.findByRole('button', { name: '加载更多评论' }))
    expect(await screen.findByText('第二页评论')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/comments/page', { pageId: comment.pageId, limit: 30, offset: 1 }))
  })

  it('reorders groups and knowledge bases with complete ordered id lists', async () => {
    renderWithClient(<MemoryRouter><KnowledgeBaseGroups workspaceId={workspace.id} groups={groups} knowledgeBases={knowledgeBases} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '下移分组 研发' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/knowledge-base-groups/reorder', { workspaceId: workspace.id, orderedGroupIds: [groups[1]!.id, groups[0]!.id] }))
    fireEvent.click(screen.getByRole('button', { name: '下移知识库 API' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/knowledge-base-groups/items/reorder', { groupId: groups[0]!.id, orderedKnowledgeBaseIds: [knowledgeBases[1]!.id, knowledgeBases[0]!.id] }))
  })

  it('renames a personal knowledge-base group in the site dialog', async () => {
    renderWithClient(<MemoryRouter><KnowledgeBaseGroups workspaceId={workspace.id} groups={groups} knowledgeBases={knowledgeBases} /></MemoryRouter>)
    fireEvent.click(screen.getByRole('button', { name: '重命名分组 研发' }))
    fireEvent.change(screen.getByRole('textbox', { name: '分组名称' }), { target: { value: '核心研发' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/knowledge-base-groups/rename', { groupId: groups[0]!.id, name: '核心研发' }))
  })

  it('loads current template detail and lets an authorized user delete it', async () => {
    renderWithClient(<TemplateCenter workspaces={[workspace]} />)
    fireEvent.click(await screen.findByRole('button', { name: /研发周报/ }))
    expect((await screen.findAllByText('每周研发进度')).length).toBe(2)
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/templates/get', { templateId: template.id }))
    fireEvent.click(screen.getByRole('button', { name: /删除模板/ }))
    const deleteDialog = screen.getByRole('alertdialog', { name: '删除模板「研发周报」' })
    fireEvent.click(within(deleteDialog).getByRole('button', { name: '删除模板' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/templates/delete', { templateId: template.id }))
  })

  it('saves a template with an optional validated HTTPS cover', async () => {
    renderWithClient(<SaveTemplateDialog sourceType="DOCUMENT" sourceId={comment.pageId} onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('textbox', { name: '模板名称' }), { target: { value: '发布检查表' } })
    const thumbnail = screen.getByRole('textbox', { name: '模板封面（可选）' })
    const save = screen.getByRole('button', { name: '保存模板' }) as HTMLButtonElement

    fireEvent.change(thumbnail, { target: { value: 'https://user:secret@example.com/private.jpg' } })
    expect(screen.getByRole('alert').textContent).toContain('HTTPS')
    expect(save.disabled).toBe(true)
    fireEvent.change(thumbnail, { target: { value: 'https://cdn.example.com/templates/release.jpg' } })
    fireEvent.click(save)

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/templates/save-document', {
      pageId: comment.pageId, name: '发布检查表', description: '', category: '', thumbnail: 'https://cdn.example.com/templates/release.jpg', visibility: 'PRIVATE',
    }))
  })

  it('saves knowledge-base appearance, watermark and catalog controls as compatible JSON', async () => {
    renderWithClient(<Appearance knowledgeBase={{ ...knowledgeBases[0]!, appearanceConfig: '{"extension":"kept"}' }} />)
    fireEvent.click(screen.getByRole('button', { name: '杂志' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /显示水印/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存外观' }))

    await waitFor(() => expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/knowledge-bases/update')).toBe(true))
    const body = vi.mocked(post).mock.calls.find(([path]) => path === '/api/v1/knowledge-bases/update')?.[1] as Record<string, string>
    expect(JSON.parse(body.appearanceConfig!)).toEqual(expect.objectContaining({ extension: 'kept', theme: 'MAGAZINE' }))
    expect(JSON.parse(body.watermarkConfig!)).toEqual(expect.objectContaining({ enabled: true, position: 'TILED' }))
    expect(JSON.parse(body.catalogConfig!)).toEqual(expect.objectContaining({ defaultExpandDepth: 3 }))
  })

  it('previews superseded publication snapshots inside the authenticated management UI', async () => {
    const page = { id: comment.pageId, workspaceId: workspace.id, knowledgeBaseId: knowledgeBases[0]!.id, title: '当前草稿', contentType: 'DOCUMENT', draftRevision: 4 } as never
    renderWithClient(<PublicationPanel page={page} />)
    expect(await screen.findByText('等待自动发布')).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('系统将在防抖窗口结束后发布草稿版本')
    expect(screen.getByRole('button', { name: '自动发布排队中' }).hasAttribute('disabled')).toBe(true)
    fireEvent.click(await screen.findByTitle('预览发布版本 3'))
    expect(await screen.findByRole('dialog', { name: '预览 旧版发布内容' })).toBeTruthy()
    expect(screen.getByText('不可变历史正文')).toBeTruthy()
    expect(screen.getByText('🧭')).toBeTruthy()
  })

  it('loads publication history beyond the first page', async () => {
    const page = { id: comment.pageId, workspaceId: workspace.id, knowledgeBaseId: knowledgeBases[0]!.id, title: '当前草稿', contentType: 'DOCUMENT', draftRevision: 4 } as never
    renderWithClient(<PublicationPanel page={page} />)
    expect(await screen.findByText('旧版发布内容')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多发布历史' }))
    expect(await screen.findByText('更早发布内容')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/publication-history/page', { pageId: comment.pageId, limit: 30, offset: 1 }))
    expect(screen.queryByRole('button', { name: '加载更多发布历史' })).toBeNull()
  })

  it('only offers export formats that preserve the current content type', () => {
    const { unmount } = renderWithClient(<PageExportDialog pageId={comment.pageId} contentType="DATABASE" canUsePublished={false} onClose={() => undefined} />)
    expect(screen.getByRole('option', { name: 'XLSX' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'CSV' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'PDF' })).toBeNull()
    unmount()

    renderWithClient(<PageExportDialog pageId={comment.pageId} contentType="WHITEBOARD" canUsePublished={false} onClose={() => undefined} />)
    expect(screen.getByRole('option', { name: 'PNG' })).toBeTruthy()
    expect(screen.getByRole('option', { name: 'SVG' })).toBeTruthy()
    expect(screen.queryByRole('option', { name: 'DOCX' })).toBeNull()
  })

  it('adds colored page labels and saves with optimistic label revision', async () => {
    renderWithClient(<PageLabelsEditor pageId={comment.pageId} />)
    fireEvent.change(await screen.findByRole('textbox', { name: '新标签名称' }), { target: { value: '服务端架构' } })
    fireEvent.click(screen.getByRole('button', { name: /添加/ }))
    expect(screen.getByText('服务端架构')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /保存标签/ }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/pages/labels/update', {
      pageId: comment.pageId,
      expectedRevision: 0,
      labels: [{ name: '服务端架构', color: '#5A8F6B' }],
    }))
  })

  it('previews path conflicts before executing a knowledge-base merge', async () => {
    renderWithClient(<MemoryRouter><Danger knowledgeBase={knowledgeBases[0]!} /></MemoryRouter>)
    await screen.findByRole('option', { name: /设计/ })
    fireEvent.change(await screen.findByRole('combobox', { name: '合并目标知识库' }), { target: { value: knowledgeBases[1]!.id } })
    fireEvent.click(screen.getByRole('button', { name: '生成合并预检' }))
    expect(await screen.findByText('/guide-api')).toBeTruthy()
    expect(screen.getByText('8')).toBeTruthy()
    fireEvent.change(screen.getByRole('textbox', { name: '合并确认名称' }), { target: { value: 'API' } })
    fireEvent.click(screen.getByRole('button', { name: /确认并入/ }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/knowledge-bases/merge/execute', expect.objectContaining({
      sourceKnowledgeBaseId: knowledgeBases[0]!.id,
      targetKnowledgeBaseId: knowledgeBases[1]!.id,
      planFingerprint: mergePlan.fingerprint,
      idempotencyKey: expect.any(String),
    })))
  })

  it('creates a knowledge-base share with independent access capabilities', async () => {
    renderWithClient(<ShareManager resourceType="KNOWLEDGE_BASE" resourceId={knowledgeBases[0]!.id} resourceName={knowledgeBases[0]!.name} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建链接' }))
    expect(screen.getByRole('heading', { name: '分享“API”' })).toBeTruthy()
    const toggles = screen.getAllByRole('checkbox')
    fireEvent.click(toggles[0]!)
    fireEvent.click(screen.getByRole('button', { name: '创建链接' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/create', expect.objectContaining({
      resourceType: 'KNOWLEDGE_BASE',
      resourceId: knowledgeBases[0]!.id,
      shareType: 'PUBLIC',
      requireApproval: true,
    })))
    expect(await screen.findByText(/share-token-value/)).toBeTruthy()
  })

  it('offers authenticated invite links with an editor role', async () => {
    renderWithClient(<ShareManager resourceType="KNOWLEDGE_BASE" resourceId={knowledgeBases[0]!.id} resourceName={knowledgeBases[0]!.name} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建链接' }))
    fireEvent.click(screen.getByRole('button', { name: /邀请链接/ }))
    fireEvent.change(screen.getByRole('combobox', { name: '访问角色' }), { target: { value: 'EDITOR' } })
    fireEvent.click(screen.getByRole('button', { name: '创建链接' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/create', expect.objectContaining({
      resourceType: 'KNOWLEDGE_BASE', shareType: 'INVITE_LINK', role: 'EDITOR', allowSearchIndex: false,
    })))
  })

  it('creates a public read-only quick-note snapshot without invitation or indexing controls', async () => {
    renderWithClient(<ShareManager resourceType="QUICK_NOTE" resourceId="quick-note-1" resourceName="待评审的灵感" />)
    fireEvent.click(await screen.findByRole('button', { name: '新建链接' }))

    expect(screen.getByText(/不可变的当前版本快照/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /邀请链接/ })).toBeNull()
    expect(screen.getByRole('combobox', { name: '访问角色' }).hasAttribute('disabled')).toBe(true)
    expect(screen.queryByRole('checkbox', { name: '允许搜索引擎收录' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '创建链接' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/shares/create', expect.objectContaining({
      resourceType: 'QUICK_NOTE', resourceId: 'quick-note-1', shareType: 'PUBLIC', role: 'READER', allowComment: false, allowSearchIndex: false,
    })))
  })

  it('creates a reusable workspace user group without conflating it with a team', async () => {
    renderWithClient(<UserGroupManagement workspaceId={workspace.id} />)
    fireEvent.click(await screen.findByRole('button', { name: '新建用户组' }))
    fireEvent.change(screen.getByRole('textbox', { name: '用户组名称' }), { target: { value: '产品评审人' } })
    fireEvent.change(screen.getByRole('textbox', { name: '用途说明（可选）' }), { target: { value: '参加发布评审' } })
    fireEvent.click(screen.getByRole('button', { name: '创建用户组' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/user-groups/create', {
      workspaceId: workspace.id,
      name: '产品评审人',
      description: '参加发布评审',
    }))
  })
})

function renderWithClient(value: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  return render(<QueryClientProvider client={client}>{value}</QueryClientProvider>)
}

function knowledgeBase(suffix: string, name: string): KnowledgeBase {
  return { id: `0198fbe0-ae3d-7000-8000-000000000${suffix}`, workspaceId: workspace.id, name, slug: name.toLowerCase(), description: null, icon: null, ownerType: 'WORKSPACE', ownerId: workspace.id, teamId: null, homepagePageId: null, visibility: 'PRIVATE', allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}', catalogRevision: 0, createdBy: '0198fbe0-ae3d-7000-8000-000000000222', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
}

function group(suffix: string, name: string, values: KnowledgeBase[]): KnowledgeBaseGroup {
  return { id: `0198fbe0-ae3d-7000-8000-000000000${suffix}`, workspaceId: workspace.id, name, position: suffix, items: values.map((value, index) => ({ knowledgeBaseId: value.id, name: value.name, icon: value.icon, visibility: value.visibility, ownerType: value.ownerType, position: String(index) })), createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
}
