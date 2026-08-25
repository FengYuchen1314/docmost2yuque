import { describe, expect, it } from 'vitest'
import { parsePublicNavigation, safeExternalNavigationUrl, safePublicNavigationUrl } from './publicNavigation'

describe('public navigation safety', () => {
  it('allows application paths, anchors, and credential-free HTTPS URLs', () => {
    expect(safePublicNavigationUrl('/u/author')).toBe('/u/author')
    expect(safePublicNavigationUrl('#overview')).toBe('#overview')
    expect(safePublicNavigationUrl('https://example.com/articles')).toBe('https://example.com/articles')
  })

  it('rejects executable, protocol-relative, credentialed, and insecure URLs', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,unsafe', '//evil.example', '/\\evil.example', 'http://example.com', 'https://user:password@example.com']) {
      expect(safePublicNavigationUrl(value)).toBeNull()
    }
  })

  it('drops invalid text entries before they reach a link href', () => {
    expect(parsePublicNavigation('关于 | /u/author\n危险 | javascript:alert(1)\n官网 | https://example.com'))
      .toEqual([{ label: '关于', url: '/u/author' }, { label: '官网', url: 'https://example.com/' }])
  })

  it('limits user-defined external links to credential-free HTTPS destinations', () => {
    expect(safeExternalNavigationUrl('https://example.com/docs')).toBe('https://example.com/docs')
    expect(safeExternalNavigationUrl('/internal')).toBeNull()
    expect(safeExternalNavigationUrl('http://example.com')).toBeNull()
    expect(safeExternalNavigationUrl('https://user@example.com')).toBeNull()
  })
})
