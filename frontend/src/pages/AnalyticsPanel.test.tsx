// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadPost, post } from '../lib/api'
import { AnalyticsPanel } from './AnalyticsPanel'

const knowledgeBaseId = '0198fbe0-ae3d-7000-8000-000000000240'
const report = { resourceType: 'KNOWLEDGE_BASE', resourceId: knowledgeBaseId, from: '2026-07-27', to: '2026-08-25', totals: { date: null, views: 12, uniqueViews: 7, edits: 3, comments: 2, shares: 1, exports: 1, reactions: 0 }, daily: [{ date: '2026-08-25', views: 12, uniqueViews: 7, edits: 3, comments: 2, shares: 1, exports: 1, reactions: 0 }] }

vi.mock('../lib/api', () => ({
  messageOf: (error: unknown) => error instanceof Error ? error.message : '请求失败',
  post: vi.fn(async () => report),
  downloadPost: vi.fn(async () => ({ blob: new Blob(['date,views\n2026-08-25,12\n'], { type: 'text/csv' }), filename: 'analytics-kb.csv' })),
}))

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('analytics panel', () => {
  it('loads knowledge-base analytics by range and downloads the server CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:analytics')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
    render(<QueryClientProvider client={client}><AnalyticsPanel knowledgeBaseId={knowledgeBaseId} onClose={() => undefined} /></QueryClientProvider>)

    expect(await screen.findByRole('complementary', { name: '知识库统计' })).toBeTruthy()
    await waitFor(() => expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/analytics/knowledge-base', expect.objectContaining({ knowledgeBaseId, from: expect.any(String), to: expect.any(String) })))
    fireEvent.click(screen.getByRole('button', { name: '90 天' }))
    await waitFor(() => expect(vi.mocked(post).mock.calls.filter(([path]) => path === '/api/v1/analytics/knowledge-base').length).toBe(2))
    fireEvent.click(await screen.findByRole('button', { name: /从服务端导出 CSV/ }))
    await waitFor(() => expect(vi.mocked(downloadPost)).toHaveBeenCalledWith('/api/v1/analytics/knowledge-base/export', expect.objectContaining({ knowledgeBaseId, from: expect.any(String), to: expect.any(String) })))
    expect(createObjectURL).toHaveBeenCalled()
  })
})
