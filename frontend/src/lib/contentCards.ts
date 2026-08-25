export interface ParsedContentCard {
  cardId: string
  instanceId: string
  version: number
  data: Record<string, unknown> | null
  raw: string
  start: number
  end: number
  supportedEncoding: boolean
}

export type ImageWidth = 'SMALL' | 'MEDIUM' | 'LARGE' | 'FULL'

export function normalizeImageWidth(value: unknown): ImageWidth {
  const normalized = typeof value === 'string' ? value.toUpperCase() : ''
  return normalized === 'SMALL' || normalized === 'MEDIUM' || normalized === 'FULL' ? normalized : 'LARGE'
}

export function imageWidthClassName(value: unknown): string {
  return `image-width-${normalizeImageWidth(value).toLowerCase()}`
}

const tokenPattern = /\{\{card:([a-z0-9-]{1,64})\|id=([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\|v=([1-9][0-9]{0,4})\|data=([A-Za-z0-9_-]{1,350000})}}/gi

export function encodeContentCardToken(cardId: string, version: number, data: Record<string, unknown>, instanceId: string = crypto.randomUUID()) {
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `{{card:${cardId}|id=${instanceId}|v=${version}|data=${encoded}}}`
}

export function parseContentCardTokens(value: string): ParsedContentCard[] {
  const cards: ParsedContentCard[] = []
  tokenPattern.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenPattern.exec(value)) !== null) {
    const cardId = match[1]!
    const instanceId = match[2]!
    const version = match[3]!
    const payload = match[4]!
    let data: Record<string, unknown> | null = null
    let supportedEncoding = true
    try {
      const padded = payload.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - payload.length % 4) % 4)
      const binary = atob(padded)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const decoded = JSON.parse(new TextDecoder().decode(bytes)) as unknown
      if (decoded && typeof decoded === 'object' && !Array.isArray(decoded)) data = decoded as Record<string, unknown>
      else supportedEncoding = false
    } catch {
      supportedEncoding = false
    }
    cards.push({
      cardId: cardId.toLowerCase(),
      instanceId: instanceId.toLowerCase(),
      version: Number(version),
      data,
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      supportedEncoding,
    })
  }
  return cards
}

const providerHosts: Record<string, string[]> = {
  youtube: ['youtube.com', 'youtu.be'],
  bilibili: ['bilibili.com', 'b23.tv'],
  figma: ['figma.com'],
  map: ['amap.com', 'maps.google.com'],
  music: ['music.163.com', 'open.spotify.com'],
}

export function allowedProviderUrl(cardId: string, raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password || /[\u0000-\u001f\u007f]/.test(raw)) return null
    const host = url.hostname.toLowerCase()
    return providerHosts[cardId]?.some((candidate) => host === candidate || host.endsWith(`.${candidate}`)) ? url.toString() : null
  } catch {
    return null
  }
}

export function safeMediaUrl(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null
  if (raw.startsWith('/')) return raw.startsWith('//') || raw.startsWith('/\\') ? null : raw
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : null
  } catch {
    return null
  }
}
