export interface PublicNavigationItem {
  label: string
  url: string
}

export function safePublicNavigationUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value || value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) return null
  if (value.startsWith('/')) return value.startsWith('//') || value.startsWith('/\\') ? null : value
  if (value.startsWith('#')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}

export function safeExternalNavigationUrl(raw: unknown): string | null {
  const value = safePublicNavigationUrl(raw)
  return value?.startsWith('https://') ? value : null
}

export function parsePublicNavigation(value: string): PublicNavigationItem[] {
  return value
    .split('\n')
    .map((line) => line.split('|', 2).map((part) => part.trim()))
    .map(([label, rawUrl]) => ({ label: label?.slice(0, 100) ?? '', url: safePublicNavigationUrl(rawUrl) }))
    .filter((item): item is PublicNavigationItem => Boolean(item.label && item.url))
    .slice(0, 30)
}
