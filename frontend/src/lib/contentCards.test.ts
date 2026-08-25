import { describe, expect, it, vi } from 'vitest'
import { allowedProviderUrl, encodeContentCardToken, parseContentCardTokens, safeMediaUrl } from './contentCards'

describe('content card tokens', () => {
  it('round trips unicode data without padding', () => {
    vi.stubGlobal('crypto', { randomUUID: () => '0198fbe0-ae3d-7000-8000-000000000099' })
    const token = encodeContentCardToken('status', 1, { label: '进行中', value: 'IN_PROGRESS' })
    const parsed = parseContentCardTokens(`before\n${token}\nafter`)
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.data).toEqual({ label: '进行中', value: 'IN_PROGRESS' })
    expect(parsed[0]!.supportedEncoding).toBe(true)
  })

  it('allows only HTTPS provider allowlist URLs', () => {
    expect(allowedProviderUrl('youtube', 'https://www.youtube.com/embed/abc')).toContain('youtube.com')
    expect(allowedProviderUrl('youtube', 'https://evil.example/embed/abc')).toBeNull()
    expect(allowedProviderUrl('youtube', 'http://youtube.com/embed/abc')).toBeNull()
    expect(allowedProviderUrl('youtube', 'https://user:password@youtube.com/embed/abc')).toBeNull()
  })

  it('rejects protocol-relative, credentialed, HTTP, and control-character media URLs', () => {
    expect(safeMediaUrl('/api/v1/attachments/0198fbe0-ae3d-7000-8000-000000000001/content')).toContain('/api/v1/attachments/')
    expect(safeMediaUrl('https://cdn.example.com/image.png')).toContain('cdn.example.com')
    expect(safeMediaUrl('//evil.example/image.png')).toBeNull()
    expect(safeMediaUrl('/\\evil.example/image.png')).toBeNull()
    expect(safeMediaUrl('https://user:password@cdn.example.com/image.png')).toBeNull()
    expect(safeMediaUrl('http://cdn.example.com/image.png')).toBeNull()
    expect(safeMediaUrl('https://cdn.example.com/image.png\nunsafe')).toBeNull()
  })
})
