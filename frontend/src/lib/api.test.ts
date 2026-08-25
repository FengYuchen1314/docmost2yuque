import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, downloadPost, post, request, resetCsrf } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  resetCsrf()
})

describe('API client', () => {
  it('uses same-origin credentials and parses JSON', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ initialized: true }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ))
    vi.stubGlobal('fetch', fetchMock)

    await expect(request('/api/v1/setup/status')).resolves.toEqual({ initialized: true })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/setup/status', expect.objectContaining({ credentials: 'include' }))
  })

  it('preserves structured API problem details', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ status: 409, code: 'PAGE_REVISION_CONFLICT', title: 'Conflict', detail: 'reload' }),
      { status: 409, headers: { 'Content-Type': 'application/problem+json' } },
    )))

    const error = await request('/api/v1/pages/get').catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).problem.code).toBe('PAGE_REVISION_CONFLICT')
  })

  it('does not request CSRF for explicitly public mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal('fetch', fetchMock)

    await post('/api/v1/auth/login/password', { email: 'user@example.com', password: 'secret' }, false)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ email: 'user@example.com', password: 'secret' })
  })

  it('downloads an authenticated server-generated file with its response filename', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ headerName: 'X-CSRF-TOKEN', parameterName: '_csrf', token: 'token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('date,views\n2026-08-25,2\n', { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=analytics-report.csv' } }))
    vi.stubGlobal('fetch', fetchMock)

    const file = await downloadPost('/api/v1/analytics/page/export', { pageId: 'page' })

    expect(file.filename).toBe('analytics-report.csv')
    expect(await file.blob.text()).toContain('2026-08-25,2')
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({ method: 'POST', credentials: 'include', body: JSON.stringify({ pageId: 'page' }) }))
  })
})
