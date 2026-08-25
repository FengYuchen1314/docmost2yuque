// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { post, request } from '../lib/api'
import type { Team, Workspace } from '../types'
import { WorkspaceAudit, WorkspaceSettingsPage } from './WorkspaceSettings'

const organization: Workspace = { id: '0198fbe0-ae3d-7000-8000-000000000250', workspaceType: 'ORGANIZATION', name: '远山工作室', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'OWNER' }
const personal: Workspace = { ...organization, id: '0198fbe0-ae3d-7000-8000-000000000251', workspaceType: 'PERSONAL', name: '我的空间' }
const team: Team = { id: '0198fbe0-ae3d-7000-8000-000000000252', workspaceId: organization.id, name: '研发团队', slug: 'engineering', description: '研发协作', avatar: null, visibility: 'WORKSPACE' }
const owner = { userId: '0198fbe0-ae3d-7000-8000-000000000253', email: 'owner@example.com', displayName: null, role: 'OWNER', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }
const member = { userId: '0198fbe0-ae3d-7000-8000-000000000254', email: 'member@example.com', displayName: null, role: 'MEMBER', createdAt: '2026-08-25T10:00:00Z', updatedAt: '2026-08-25T10:00:00Z' }

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  request: vi.fn(),
  post: vi.fn(async (path: string, body: unknown) => {
    if (path === '/api/v1/teams/list') return [team]
    if (path === '/api/v1/workspaces/members') return [owner, member]
    if (path === '/api/v1/teams/members') return [
      { ...owner, role: 'MANAGER' },
      { ...member, role: 'MEMBER' },
    ]
    if (path === '/api/v1/teams/members/update') return { ...member, role: 'MANAGER' }
    if (path === '/api/v1/workspaces/ownership/transfer') return [
      { ...owner, role: 'ADMIN' },
      { ...member, role: 'OWNER' },
    ]
    if (path === '/api/v1/pages/trash/list') return []
    if (path === '/api/v1/audit/page') return (body as { offset: number }).offset === 0
      ? { items: [{ id: 'audit-1', workspaceId: organization.id, actorId: owner.userId, action: 'page.update', resourceType: 'PAGE', resourceId: 'page-1', outcome: 'SUCCESS', details: '{}', occurredAt: '2026-08-25T10:00:00Z' }], nextOffset: 1, hasMore: true }
      : { items: [{ id: 'audit-2', workspaceId: organization.id, actorId: owner.userId, action: 'page.create', resourceType: 'PAGE', resourceId: 'page-2', outcome: 'SUCCESS', details: '{}', occurredAt: '2026-08-24T10:00:00Z' }], nextOffset: 2, hasMore: false }
    return undefined
  }),
}))

beforeEach(() => {
  vi.mocked(request).mockImplementation(async (path) => (path === '/api/v1/workspaces'
    ? [organization]
    : { userId: owner.userId, email: owner.email, instanceAdmin: true }) as never)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('workspace and team settings', () => {
  it('uses the MANAGER role contract and protects the last team manager', async () => {
    renderSettings(`/app/w/${organization.id}/settings?tab=teams&team=${team.id}`)

    expect(await screen.findByDisplayValue('研发协作')).toBeTruthy()
    const ownerRole = await screen.findByRole('combobox', { name: 'owner@example.com 的团队角色' }) as HTMLSelectElement
    const memberRole = screen.getByRole('combobox', { name: 'member@example.com 的团队角色' }) as HTMLSelectElement
    expect(ownerRole.value).toBe('MANAGER')
    expect(ownerRole.disabled).toBe(true)
    expect(memberRole.value).toBe('MEMBER')

    fireEvent.change(memberRole, { target: { value: 'MANAGER' } })
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/teams/members/update', {
      teamId: team.id,
      userId: member.userId,
      role: 'MANAGER',
    }))
  })

  it('does not expose organization membership controls in a personal workspace', async () => {
    vi.mocked(request).mockImplementation(async (path) => (path === '/api/v1/workspaces'
      ? [personal]
      : { userId: owner.userId, email: owner.email, instanceAdmin: true }) as never)
    renderSettings(`/app/w/${personal.id}/settings?tab=teams`)

    expect(await screen.findByText('个人空间受保护')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '成员与角色' })).toBeNull()
    expect(screen.queryByRole('button', { name: '用户组' })).toBeNull()
    expect(screen.queryByRole('button', { name: '团队' })).toBeNull()
    expect(vi.mocked(post).mock.calls.some(([path]) => path === '/api/v1/teams/list')).toBe(false)
  })

  it('transfers organization ownership through one confirmed operation', async () => {
    renderSettings(`/app/w/${organization.id}/settings?tab=members`)

    const transferButton = await screen.findByRole('button', { name: '转让所有权' }) as HTMLButtonElement
    await waitFor(() => expect(transferButton.disabled).toBe(false))
    fireEvent.click(transferButton)
    fireEvent.change(await screen.findByRole('combobox', { name: '新所有者' }), { target: { value: member.userId } })
    fireEvent.change(screen.getByPlaceholderText(organization.name), { target: { value: organization.name } })
    fireEvent.click(screen.getByRole('button', { name: '确认转让所有权' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/workspaces/ownership/transfer', {
      workspaceId: organization.id,
      targetUserId: member.userId,
      confirmationName: organization.name,
    }))
  })

  it('loads older workspace audit events', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><WorkspaceAudit workspaceId={organization.id} /></QueryClientProvider>)
    expect(await screen.findByText('page / update')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多审计日志' }))
    expect(await screen.findByText('page / create')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/audit/page', { workspaceId: organization.id, limit: 30, offset: 1 }))
  })
})

function renderSettings(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[entry]}><Routes><Route path="/app/w/:workspaceId/settings" element={<WorkspaceSettingsPage />} /></Routes></MemoryRouter></QueryClientProvider>)
}
