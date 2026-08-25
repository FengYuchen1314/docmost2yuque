// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { post } from '../lib/api'
import type { TransferTask } from '../types'
import { ContentTransferCenter } from './ContentTransferCenter'

const pending: TransferTask = {
  id: '0198fbe0-ae3d-7000-8000-000000000301',
  workspaceId: '0198fbe0-ae3d-7000-8000-000000000302',
  taskType: 'IMPORT',
  sourceFormat: 'MARKDOWN',
  resourceType: 'KNOWLEDGE_BASE',
  resourceId: '0198fbe0-ae3d-7000-8000-000000000303',
  status: 'PENDING',
  progress: 0,
  originalFilename: 'handbook.md',
  resultFilename: null,
  resultMediaType: null,
  artifactSize: 0,
  report: {},
  requestedBy: '0198fbe0-ae3d-7000-8000-000000000304',
  createdAt: '2026-08-25T10:00:00Z',
  startedAt: null,
  completedAt: null,
  expiresAt: null,
  cancelRequested: false,
}
const completed: TransferTask = { ...pending, id: '0198fbe0-ae3d-7000-8000-000000000305', status: 'SUCCEEDED', progress: 100, originalFilename: 'older.md', completedAt: '2026-08-24T10:01:00Z', report: { importedCount: 1 } }

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  post: vi.fn(async (path: string, body: unknown) => {
    if (path === '/api/v1/content-transfers/page') return (body as { offset: number }).offset === 0
      ? { items: [pending], nextOffset: 1, hasMore: true }
      : { items: [completed], nextOffset: 2, hasMore: false }
    if (path === '/api/v1/content-transfers/cancel') return {
      ...pending,
      status: 'CANCELLED',
      progress: 100,
      completedAt: '2026-08-25T10:01:00Z',
      cancelRequested: false,
      report: { cancelled: true },
    }
    return undefined
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('content transfer cancellation', () => {
  it('cancels an unfinished task and renders the durable cancelled state', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentTransferCenter /></QueryClientProvider>)

    expect(await screen.findByText('handbook.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.getByRole('alertdialog', { name: '取消“handbook.md”' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '取消任务' }))

    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith(
      '/api/v1/content-transfers/cancel',
      { taskId: pending.id },
    ))
    expect(await screen.findByText('未完成的输入与产物已清理')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '取消' })).toBeNull()
  })

  it('loads transfer tasks beyond the first page', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(<QueryClientProvider client={client}><ContentTransferCenter /></QueryClientProvider>)
    expect(await screen.findByText('handbook.md')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多任务' }))
    expect(await screen.findByText('older.md')).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/content-transfers/page', { limit: 30, offset: 1 }))
    expect(screen.queryByRole('button', { name: '加载更多任务' })).toBeNull()
  })
})
