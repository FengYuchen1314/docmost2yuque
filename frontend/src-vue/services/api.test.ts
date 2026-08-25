import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get, post, resetCsrf } from './api'

function response(body: unknown, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('Vue API client', () => {
  beforeEach(() => { resetCsrf(); vi.restoreAllMocks() })

  it('loads the server-selected CSRF header before an authenticated write', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(response({ headerName: 'X-KP-CSRF', parameterName: '_csrf', token: 'csrf-value' }))
      .mockResolvedValueOnce(response({ saved: true }))
    await expect(post('/api/v1/pages/update', { pageId: 'page-1' })).resolves.toEqual({ saved: true })
    expect(fetcher).toHaveBeenNthCalledWith(1, '/api/v1/auth/csrf', expect.objectContaining({ credentials: 'include' }))
    expect(fetcher).toHaveBeenNthCalledWith(2, '/api/v1/pages/update', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'X-KP-CSRF': 'csrf-value' }) }))
  })

  it('does not request CSRF for public authentication calls', async () => {
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(response(undefined, 204))
    await post('/api/v1/auth/login/password', { email: 'owner@example.com', password: 'strong-password' }, false)
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('preserves RFC 9457 problem details', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response({ status: 409, code: 'PAGE_REVISION_CONFLICT', title: 'Conflict', detail: '页面已有新版本' }, 409))
    await expect(get('/api/v1/pages/get')).rejects.toMatchObject({ problem: { code: 'PAGE_REVISION_CONFLICT', detail: '页面已有新版本' } })
  })
})
