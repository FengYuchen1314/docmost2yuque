import { describe, expect, it } from 'vitest'
import { sharedMediaUrl } from './sharedMedia'

describe('shared attachment URLs', () => {
  const attachmentId = '0198fbe0-ae3d-7000-8000-000000000001'
  const token = 'share-token-with-at-least-thirty-two-characters'

  it('scopes an internal attachment request to the active share and page', () => {
    const result = sharedMediaUrl(
      `/api/v1/attachments/${attachmentId}/content`,
      token,
      'password-session',
      '0198fbe0-ae3d-7000-8000-000000000002',
    )
    expect(result).toContain(`/api/v1/attachments/${attachmentId}/shared-content?`)
    expect(result).toContain(`shareToken=${encodeURIComponent(token)}`)
    expect(result).toContain('shareAccessToken=password-session')
    expect(result).toContain('sharePageId=0198fbe0-ae3d-7000-8000-000000000002')
  })

  it('does not proxy external or malformed media URLs', () => {
    expect(sharedMediaUrl('https://cdn.example.com/image.png', token, '', null))
      .toBe('https://cdn.example.com/image.png')
    expect(sharedMediaUrl('/api/v1/attachments/not-a-uuid/content', token, '', null))
      .toBe('/api/v1/attachments/not-a-uuid/content')
  })
})
