const attachmentContentPattern = /^\/api\/v1\/attachments\/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\/content$/i

export function sharedMediaUrl(
  rawUrl: string,
  shareToken: string,
  shareAccessToken: string,
  sharePageId: string | null,
): string {
  const match = attachmentContentPattern.exec(rawUrl)
  if (!match || shareToken.length < 32) return rawUrl
  const query = new URLSearchParams({ shareToken })
  if (shareAccessToken) query.set('shareAccessToken', shareAccessToken)
  if (sharePageId) query.set('sharePageId', sharePageId)
  return `/api/v1/attachments/${match[1]}/shared-content?${query}`
}
