// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post, request } from '../lib/api'
import { InvitationAcceptPage } from './AuthPages'

const token = 'invitation-token-value-1234567890abcd'
const invitation = {
  invitationId: '0198fbe0-ae3d-7000-8000-000000000260',
  workspaceId: '0198fbe0-ae3d-7000-8000-000000000261',
  workspaceName: '远山工作室',
  maskedEmail: 'n***@example.com',
  workspaceRole: 'MEMBER',
  accountExists: false,
  expiresAt: '2026-09-01T10:00:00Z',
}

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  resetCsrf: vi.fn(),
  request: vi.fn(),
  post: vi.fn(),
}))

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('invitation acceptance account modes', () => {
  it('requires a password for a new invited email even when another account is signed in', async () => {
    vi.mocked(request).mockImplementation(async (path: string) => path === '/api/v1/auth/me'
      ? { userId: 'other-user', email: 'other@example.com', instanceAdmin: false }
      : invitation as never)
    vi.mocked(post).mockResolvedValue({ invitationId: invitation.invitationId, workspaceId: invitation.workspaceId })
    renderInvitation()

    expect(await screen.findByText(/当前登录账号与这封新邮箱邀请无关/)).toBeTruthy()
    fireEvent.change(screen.getByLabelText(/设置密码/), { target: { value: 'New-Password-2026!' } })
    fireEvent.change(screen.getByLabelText(/确认密码/), { target: { value: 'New-Password-2026!' } })
    fireEvent.click(screen.getByRole('button', { name: '接受邀请并进入' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/invitations/accept', {
      token,
      password: 'New-Password-2026!',
      passwordConfirmation: 'New-Password-2026!',
    }, false))
  })

  it('accepts an existing invited account without asking for a new password', async () => {
    vi.mocked(request).mockImplementation(async (path: string) => {
      if (path === '/api/v1/auth/me') throw new Error('Unauthorized')
      return { ...invitation, accountExists: true } as never
    })
    vi.mocked(post).mockResolvedValue({ invitationId: invitation.invitationId, workspaceId: invitation.workspaceId })
    renderInvitation()

    expect(await screen.findByText(/该受邀邮箱已有账号/)).toBeTruthy()
    expect(screen.queryByLabelText(/设置密码/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '接受邀请并进入' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/invitations/accept', {
      token,
      password: null,
      passwordConfirmation: null,
    }, false))
  })
})

function renderInvitation() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[`/invitations/accept?token=${token}`]}><Routes><Route path="/invitations/accept" element={<InvitationAcceptPage />} /><Route path="/app/w/:workspaceId" element={<div>accepted</div>} /></Routes></MemoryRouter></QueryClientProvider>)
}
