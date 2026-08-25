// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import type { Workspace } from '../types'
import { AdminCenter, InvitationSettings, ModerationPanel, SearchOperationsPanel, UserManagementPanel } from './AdminCenter'
import { post } from '../lib/api'

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  request: vi.fn(async (path: string) => path === '/api/v1/admin/auth-settings' ? {
    registrationMode: 'CLOSED',
    passwordLoginEnabled: true,
    emailCodeLoginEnabled: false,
    smtpReady: false,
    settingsVersion: 1,
  } : {}),
  post: vi.fn(async (path: string, body: unknown) => {
    const offset = (body as { offset?: number } | undefined)?.offset ?? 0
    if (path === '/api/v1/admin/users/page') return offset === 0
      ? { items: [adminUser('user-1', 'first@example.com')], nextOffset: 1, hasMore: true }
      : { items: [adminUser('user-2', 'second@example.com')], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/admin/social/reports/page') return offset === 0
      ? { items: [socialReport('report-1', '第一条举报')], nextOffset: 1, hasMore: true }
      : { items: [socialReport('report-2', '第二条举报')], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/admin/invitations/page') return offset === 0
      ? { items: [invitation('invite-1', 'first-invite@example.com')], nextOffset: 1, hasMore: true }
      : { items: [invitation('invite-2', 'second-invite@example.com')], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/teams/list') return [team]
    if (path === '/api/v1/knowledge-bases/list') return [knowledgeBase]
    if (path === '/api/v1/admin/invitations/create') return { id: 'invite-1' }
    if (path === '/api/v1/search/rebuild/page') return offset === 0
      ? { items: [runningJob], nextOffset: 1, hasMore: true }
      : { items: [{ ...runningJob, id: '0198fbe0-ae3d-7000-8000-000000000199', status: 'SUCCEEDED', cursorType: 'ATTACHMENT' }], nextOffset: 2, hasMore: false }
    if (path.endsWith('/advance')) return { ...runningJob, status: 'SUCCEEDED', cursorType: 'DONE', processedCount: 321, completedAt: '2026-08-25T10:10:00Z' }
    if (path.endsWith('/pause')) return { ...runningJob, status: 'PAUSED' }
    return runningJob
  }),
}))

const workspace: Workspace = { id: '0198fbe0-ae3d-7000-8000-000000000180', workspaceType: 'ORGANIZATION', name: '远山工作室', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'ADMIN' }
const personalWorkspace: Workspace = { ...workspace, id: '0198fbe0-ae3d-7000-8000-000000000183', workspaceType: 'PERSONAL', name: '我的空间', membershipRole: 'OWNER' }
const team = { id: '0198fbe0-ae3d-7000-8000-000000000184', workspaceId: workspace.id, name: '产品团队', slug: 'product', description: null, avatar: null, visibility: 'PRIVATE' }
const knowledgeBase = { id: '0198fbe0-ae3d-7000-8000-000000000185', workspaceId: workspace.id, name: '产品手册', slug: 'handbook', description: null, icon: null, ownerType: 'WORKSPACE', ownerId: workspace.id, teamId: null, homepagePageId: null, visibility: 'PRIVATE', allowPublicIndex: false, publishMode: 'MANUAL', watermarkConfig: '{}', appearanceConfig: '{}', catalogConfig: '{}', catalogRevision: 0, createdBy: 'user-1', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
const runningJob = { id: '0198fbe0-ae3d-7000-8000-000000000181', workspaceId: workspace.id, status: 'RUNNING', cursorType: 'PAGE', cursorId: null, processedCount: 120, errorCount: 0, requestedBy: '0198fbe0-ae3d-7000-8000-000000000182', startedAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:05:00Z', completedAt: null, lastError: null }
const adminUser = (userId: string, email: string) => ({ userId, email, displayName: null, status: 'ACTIVE', emailVerifiedAt: '2026-08-25T10:00:00Z', instanceRole: 'USER', workspaceCount: 1, lastSeenAt: null, createdAt: '2026-08-25T10:00:00Z' })
const socialReport = (id: string, reason: string) => ({ id, reporterId: 'reporter-1', targetType: 'USER', targetId: 'target-1', reason, details: null, status: 'OPEN', reviewedBy: null, reviewedAt: null, resolution: null, createdAt: '2026-08-25T10:00:00Z' })
const invitation = (id: string, email: string) => ({ id, workspaceId: workspace.id, email, workspaceRole: 'MEMBER', targetTeamIds: [team.id], targetKnowledgeBaseRoles: [{ knowledgeBaseId: knowledgeBase.id, role: 'EDITOR' }], status: 'SENT', expiresAt: '2026-09-01T10:00:00Z', sentAt: '2026-08-25T10:00:00Z' })

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('search index operations', () => {
  it('shows rebuild progress and advances or pauses an active task', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><SearchOperationsPanel workspaces={[workspace]} /></QueryClientProvider>)

    expect(await screen.findByText('文稿索引')).toBeTruthy()
    expect(screen.getByText('120')).toBeTruthy()
    expect((screen.getByRole('button', { name: /新建重建任务/ }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /继续一批/ }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/search/rebuild/advance', { rebuildId: runningJob.id, batchSize: 500 }))

    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/search/rebuild/pause', { rebuildId: runningJob.id, batchSize: undefined }))
  })

  it('can automatically run batches until the server reports completion', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><SearchOperationsPanel workspaces={[workspace]} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '运行至完成' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/search/rebuild/advance', { rebuildId: runningJob.id, batchSize: 500 }))
    await waitFor(() => expect(screen.queryByText('自动重建中')).toBeNull())
  })

  it('loads older rebuild records and labels the attachment phase', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><SearchOperationsPanel workspaces={[workspace]} /></QueryClientProvider>)

    fireEvent.click(await screen.findByRole('button', { name: '加载更多重建记录' }))
    expect(await screen.findByText('附件索引')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/search/rebuild/page', { workspaceId: workspace.id, limit: 20, offset: 1 }))
  })

  it('never offers a personal workspace as a member invitation target', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<MemoryRouter><QueryClientProvider client={client}><AdminCenter workspaces={[personalWorkspace, workspace]} /></QueryClientProvider></MemoryRouter>)

    fireEvent.click(screen.getByRole('button', { name: /成员邀请/ }))
    const target = await screen.findByRole('combobox', { name: '目标组织空间' })
    expect(screen.getByRole('option', { name: workspace.name })).toBeTruthy()
    expect(screen.queryByRole('option', { name: personalWorkspace.name })).toBeNull()
    expect((target as HTMLSelectElement).value).toBe(workspace.id)
    fireEvent.change(screen.getByRole('textbox', { name: '受邀邮箱' }), { target: { value: 'member@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /发送邀请/ }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/admin/invitations/create', expect.objectContaining({
      workspaceId: workspace.id,
      email: 'member@example.com',
    })))
  })

  it('opens the invitation tab from an admin deep link', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<MemoryRouter initialEntries={['/app/admin?tab=invitations']}><QueryClientProvider client={client}><AdminCenter workspaces={[workspace]} /></QueryClientProvider></MemoryRouter>)

    expect(await screen.findByRole('combobox', { name: '目标组织空间' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /成员邀请/ }).className).toContain('active')
    expect(screen.queryByText('注册入口')).toBeNull()
  })

  it('can grant team and knowledge-base membership in the invitation', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><InvitationSettings workspaces={[workspace]} /></QueryClientProvider>)

    fireEvent.click(screen.getByText('同时加入团队或知识库'))
    fireEvent.click(await screen.findByRole('checkbox', { name: `加入团队 ${team.name}` }))
    fireEvent.click(screen.getByRole('checkbox', { name: `加入知识库 ${knowledgeBase.name}` }))
    fireEvent.change(screen.getByRole('combobox', { name: `${knowledgeBase.name} 的知识库角色` }), { target: { value: 'EDITOR' } })
    fireEvent.change(screen.getByRole('textbox', { name: '受邀邮箱' }), { target: { value: 'resource-member@example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /发送邀请/ }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/admin/invitations/create', expect.objectContaining({
      targetTeamIds: [team.id],
      targetKnowledgeBaseRoles: [{ knowledgeBaseId: knowledgeBase.id, role: 'EDITOR' }],
    })))
    expect(await screen.findByText(/产品团队、产品手册（编辑）/)).toBeTruthy()
  })
})

describe('admin collection pagination', () => {
  it('loads additional instance users', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><UserManagementPanel /></QueryClientProvider>)
    expect(await screen.findByText('first@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多用户' }))
    expect(await screen.findByText('second@example.com')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/admin/users/page', { query: null, status: 'ALL', limit: 30, offset: 1 }))
  })

  it('loads additional moderation reports in queue order', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ModerationPanel /></QueryClientProvider>)
    expect(await screen.findByText(/第一条举报/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多举报' }))
    expect(await screen.findByText(/第二条举报/)).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/admin/social/reports/page', { status: 'OPEN', limit: 30, offset: 1 }))
  })

  it('loads additional invitation delivery records', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><InvitationSettings workspaces={[workspace]} /></QueryClientProvider>)
    expect(await screen.findByText('first-invite@example.com')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多邀请' }))
    expect(await screen.findByText('second-invite@example.com')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/admin/invitations/page', { workspaceId: workspace.id, limit: 30, offset: 1 }))
  })
})
