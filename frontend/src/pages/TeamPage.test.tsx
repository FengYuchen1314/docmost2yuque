// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { post, request } from '../lib/api'
import type { CurrentUser, KnowledgeBase, Team, Workspace } from '../types'
import { TeamPage } from './TeamPage'

const currentUser: CurrentUser = { userId: 'user-member', email: 'member@example.com', displayName: '成员', instanceAdmin: false }
const workspace: Workspace = { id: 'workspace-1', workspaceType: 'ORGANIZATION', name: '产品空间', defaultVisibility: 'PRIVATE', defaultPublishMode: 'MANUAL', membershipRole: 'MEMBER' }
const team: Team = { id: 'team-1', workspaceId: workspace.id, name: '研发团队', slug: 'engineering', description: '研发协作', avatar: null, visibility: 'WORKSPACE' }
const knowledgeBase = { id: 'kb-1', workspaceId: workspace.id, name: '研发手册', slug: 'engineering-guide', description: null, icon: null, ownerType: 'TEAM', ownerId: team.id, teamId: team.id, visibility: 'PRIVATE', publishMode: 'MANUAL' } as KnowledgeBase
const member = { userId: currentUser.userId, email: currentUser.email, displayName: currentUser.displayName, role: 'MEMBER', createdAt: '2026-08-25T08:00:00Z', updatedAt: '2026-08-25T08:00:00Z' }
const manager = { userId: 'user-manager', email: 'manager@example.com', displayName: '管理者', role: 'MANAGER', createdAt: '2026-08-25T08:00:00Z', updatedAt: '2026-08-25T08:00:00Z' }

vi.mock('../lib/api', () => ({ messageOf: (reason: unknown) => reason instanceof Error ? reason.message : '请求失败', request: vi.fn(), post: vi.fn() }))

beforeEach(() => {
  vi.mocked(request).mockResolvedValue([workspace] as never)
  vi.mocked(post).mockImplementation(async (path, body) => {
    if (path === '/api/v1/teams/list') return [team]
    if (path === '/api/v1/teams/members') return [manager, member]
    if (path === '/api/v1/knowledge-bases/list') return [knowledgeBase]
    if (path === '/api/v1/teams/activity/page') return (body as { offset: number }).offset === 0
      ? { items: [{ id: 'event-1', actorId: manager.userId, action: 'team.member.add', outcome: 'SUCCESS', occurredAt: '2026-08-25T08:00:00Z' }], nextOffset: 1, hasMore: true }
      : { items: [{ id: 'event-2', actorId: currentUser.userId, action: 'team.member.leave', outcome: 'SUCCESS', occurredAt: '2026-08-24T08:00:00Z' }], nextOffset: 2, hasMore: false }
    return undefined
  })
})

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.restoreAllMocks() })

describe('team detail page', () => {
  it('exposes team knowledge, member self-leave and no management controls to a regular member', async () => {
    renderTeam(currentUser)
    expect(await screen.findByText('研发手册')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '团队设置' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '退出团队' }))
    expect(screen.getByRole('alertdialog', { name: '退出团队「研发团队」' })).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: '退出团队' }).at(-1)!)
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/teams/members/leave', { teamId: team.id }))
  })

  it('loads the complete paged team activity stream', async () => {
    renderTeam(currentUser)
    fireEvent.click(await screen.findByRole('button', { name: '动态' }))
    expect(await screen.findByText('添加了团队成员')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多动态' }))
    expect(await screen.findByText('成员退出了团队')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/teams/activity/page', { teamId: team.id, limit: 25, offset: 1 }))
  })

  it('lets a team manager adjust member roles and add workspace members', async () => {
    const managerUser = { ...currentUser, userId: manager.userId, email: manager.email, displayName: manager.displayName }
    vi.mocked(post).mockImplementation(async (path) => {
      if (path === '/api/v1/teams/list') return [team]
      if (path === '/api/v1/teams/members') return [manager, member]
      if (path === '/api/v1/knowledge-bases/list') return [knowledgeBase]
      if (path === '/api/v1/workspaces/members') return [manager, member, { userId: 'user-new', email: 'new@example.com', displayName: null, role: 'MEMBER', createdAt: manager.createdAt, updatedAt: manager.updatedAt }]
      return undefined
    })
    renderTeam(managerUser)
    fireEvent.click(await screen.findByRole('button', { name: /成员 2/ }))
    fireEvent.change(await screen.findByRole('combobox', { name: 'member@example.com 的团队角色' }), { target: { value: 'MANAGER' } })
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/teams/members/update', { teamId: team.id, userId: member.userId, role: 'MANAGER' }))
    fireEvent.change(screen.getByRole('combobox', { name: '选择要加入团队的空间成员' }), { target: { value: 'user-new' } })
    fireEvent.click(screen.getByRole('button', { name: '加入团队' }))
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/teams/members/add', { teamId: team.id, userId: 'user-new', role: 'MEMBER' }))
  })
})

function renderTeam(user: CurrentUser) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/app/w/${workspace.id}/teams/${team.id}`]}><Routes><Route path="/app/w/:workspaceId/teams/:teamId" element={<TeamPage currentUser={user} />} /><Route path="/app/w/:workspaceId" element={<p>空间首页</p>} /></Routes></MemoryRouter></QueryClientProvider>)
}
