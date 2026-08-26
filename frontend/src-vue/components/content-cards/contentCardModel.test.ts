import { describe, expect, it } from 'vitest'
import { safeResourceUrl } from './contentCardModel'

describe('content card resource URL safety', () => {
  it('accepts deployable HTTP/HTTPS and site-relative resources without credentials', () => {
    expect(safeResourceUrl('http://185.99.135.224:8088/api/files/one')).toBe('http://185.99.135.224:8088/api/files/one')
    expect(safeResourceUrl('https://cdn.example.test/image.png')).toBe('https://cdn.example.test/image.png')
    expect(safeResourceUrl('/api/files/local')).toBe('/api/files/local')
  })

  it('rejects executable, protocol-relative and credential-bearing resources', () => {
    expect(safeResourceUrl('javascript:alert(1)')).toBeNull()
    expect(safeResourceUrl('//evil.example.test/file')).toBeNull()
    expect(safeResourceUrl('https://user:secret@example.test/file')).toBeNull()
  })
})
