import type {
  ContentCardDefinition,
  ContentCardInput,
  ContentCardKind,
  ContentCardNode,
  ContentCardSource,
  NormalizedContentCard,
} from '../../types/content-card'
import { createUuid } from '../../utils/uuid'

const TOKEN_PATTERN = /^\{\{card:([a-z0-9-]{1,64})\|id=([^|}]{1,80})\|v=(\d{1,6})\|data=([A-Za-z0-9_-]+)\}\}$/i
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/

const KIND_ALIASES: Record<string, ContentCardKind> = {
  bookmark: 'bookmark',
  'bookmark-card': 'bookmark',
  link: 'bookmark',
  url: 'bookmark',
  code: 'code',
  'code-block': 'code',
  'text-diagram': 'code',
  attachment: 'attachment',
  file: 'attachment',
  'file-preview': 'attachment',
  office: 'attachment',
  pdf: 'attachment',
  image: 'image',
  photo: 'image',
  picture: 'image',
  video: 'video',
  iframe: 'iframe',
  embed: 'iframe',
  'web-embed': 'iframe',
  youtube: 'iframe',
  bilibili: 'iframe',
  figma: 'iframe',
  map: 'iframe',
  music: 'iframe',
  callout: 'callout',
  alert: 'callout',
  notice: 'callout',
  tip: 'callout',
  status: 'status',
  state: 'status',
  'sensitive-text': 'sensitive-text',
  secret: 'sensitive-text',
  encrypted: 'sensitive-text',
}

export const CONTENT_CARD_DEFINITIONS: ContentCardDefinition[] = [
  { kind: 'bookmark', cardId: 'bookmark', title: '网页书签', description: '展示链接标题、摘要与来源', icon: 'mdi-bookmark-outline', color: 'primary', aliases: ['url', 'link'] },
  { kind: 'code', cardId: 'code', title: '代码块', description: '带语言标识和一键复制', icon: 'mdi-code-tags', color: 'secondary' },
  { kind: 'attachment', cardId: 'attachment', title: '附件', description: '文件名、大小、类型与下载入口', icon: 'mdi-paperclip', color: 'info', aliases: ['file', 'pdf', 'office'] },
  { kind: 'image', cardId: 'image', title: '图片', description: '自适应图片、说明和尺寸控制', icon: 'mdi-image-outline', color: 'success' },
  { kind: 'video', cardId: 'video', title: '视频', description: '播放直链视频与封面', icon: 'mdi-play-box-outline', color: 'error' },
  { kind: 'iframe', cardId: 'iframe', title: '网页嵌入', description: '沙箱化展示 HTTPS 网页或服务', icon: 'mdi-application-brackets-outline', color: 'primary', aliases: ['embed'] },
  { kind: 'callout', cardId: 'callout', title: '提示块', description: '信息、成功、警告或危险提示', icon: 'mdi-lightbulb-outline', color: 'warning' },
  { kind: 'status', cardId: 'status', title: '状态卡', description: '展示事项状态与补充说明', icon: 'mdi-list-status', color: 'secondary' },
  { kind: 'sensitive-text', cardId: 'sensitive-text', title: '加密敏感卡', description: '浏览器本地加密与解密', icon: 'mdi-shield-lock-outline', color: 'error', aliases: ['secret'] },
]

export function normalizeContentCard(input: ContentCardInput): NormalizedContentCard {
  if (typeof input === 'string') return normalizeString(input)
  if (!isRecord(input)) return invalidCard('无法识别的内容卡数据', typeof input === 'undefined' ? '' : String(input))
  return normalizeRecord(input, 'legacy')
}

function normalizeString(input: string): NormalizedContentCard {
  const raw = input.trim()
  const token = raw.match(TOKEN_PATTERN)
  if (token) return normalizeToken(token, raw)

  if (raw.startsWith('{') || raw.startsWith('[')) {
    try {
      const decoded: unknown = JSON.parse(raw)
      const normalized = normalizeContentCard(decoded)
      return { ...normalized, source: 'json', raw }
    } catch {
      return invalidCard('JSON 内容损坏，已保留原始数据', raw, 'json')
    }
  }

  if (safeResourceUrl(raw)) {
    return finalizeCard('bookmark', createInstanceId(), 1, { url: raw }, 'legacy', raw)
  }
  return invalidCard('旧内容不是可识别的卡片或安全链接', raw)
}

function normalizeToken(match: RegExpMatchArray, raw: string): NormalizedContentCard {
  const cardId = normalizeCardId(match[1] ?? '')
  const instanceCandidate = match[2] ?? ''
  const version = positiveInteger(match[3], 1)
  const warnings: string[] = []
  const instanceId = UUID_PATTERN.test(instanceCandidate) ? instanceCandidate : createInstanceId()
  if (instanceId !== instanceCandidate) warnings.push('旧卡片实例 ID 无效，已生成临时 ID')
  try {
    const data = decodeTokenData(match[4] ?? '')
    return finalizeCard(cardId, instanceId, version, data, 'token', raw, warnings)
  } catch {
    return {
      ...finalizeCard(cardId, instanceId, version, {}, 'token', raw, warnings),
      valid: false,
      warnings: [...warnings, '卡片 token 的 data 无法解码'],
    }
  }
}

function normalizeRecord(value: Record<string, unknown>, fallbackSource: ContentCardSource): NormalizedContentCard {
  if (value.type === 'contentCard' && isRecord(value.attrs)) {
    const attrs = value.attrs
    const cardId = normalizeCardId(stringValue(attrs.cardId) || stringValue(attrs.kind) || 'unknown')
    const data = recordValue(attrs.data) ?? parseRecordString(attrs.data) ?? withoutMetadata(attrs)
    return finalizeCard(
      cardId,
      validInstanceId(attrs.instanceId),
      positiveInteger(attrs.version, 1),
      data,
      'node',
    )
  }

  if (typeof value.token === 'string' && value.token.trim().startsWith('{{card:')) {
    return normalizeString(value.token)
  }

  const rawType = stringValue(value.cardId)
    || stringValue(value.cardType)
    || stringValue(value.kind)
    || (value.type !== 'contentCard' ? stringValue(value.type) : '')
  const inferredType = rawType || inferLegacyType(value)
  const cardId = normalizeCardId(inferredType || 'unknown')
  const data = recordValue(value.data) ?? parseRecordString(value.data) ?? withoutMetadata(value)
  return finalizeCard(
    cardId,
    validInstanceId(value.instanceId ?? value.id),
    positiveInteger(value.version, 1),
    data,
    fallbackSource,
  )
}

function finalizeCard(
  cardId: string,
  instanceId: string,
  version: number,
  rawData: Record<string, unknown>,
  source: ContentCardSource,
  raw?: string,
  existingWarnings: string[] = [],
): NormalizedContentCard {
  const kind = kindForCardId(cardId)
  const data = normalizeData(kind, rawData)
  const warnings = [...existingWarnings]
  if (kind === 'unknown') warnings.push(`暂不支持内容卡类型“${cardId || 'unknown'}”`)
  const url = primaryUrl(kind, data)
  if (url && !safeResourceUrl(url)) warnings.push('卡片 URL 未通过安全校验')
  return {
    cardId: cardId || 'unknown',
    instanceId,
    version,
    data,
    kind,
    source,
    valid: kind !== 'unknown',
    warnings,
    ...(raw ? { raw } : {}),
  }
}

function normalizeData(kind: ContentCardKind, value: Record<string, unknown>): Record<string, unknown> {
  if (kind === 'bookmark') return compactRecord({
    url: firstString(value.url, value.href, value.link, value.src),
    title: firstString(value.title, value.name),
    description: firstString(value.description, value.summary, value.text),
    siteName: firstString(value.siteName, value.site, value.provider),
    icon: firstString(value.icon, value.favicon),
  })
  if (kind === 'code') return compactRecord({
    language: firstString(value.language, value.lang) || 'text',
    code: firstString(value.code, value.content, value.value, value.text),
    title: firstString(value.title, value.name),
  })
  if (kind === 'attachment') return compactRecord({
    name: firstString(value.name, value.fileName, value.title) || '未命名附件',
    url: firstString(value.url, value.href, value.downloadUrl, value.src),
    size: finiteNumber(value.size, value.sizeBytes, value.fileSize),
    mimeType: firstString(value.mimeType, value.mediaType, value.contentType, value.type),
    description: firstString(value.description, value.summary),
    previewUrl: firstString(value.previewUrl),
  })
  if (kind === 'image') return compactRecord({
    url: firstString(value.url, value.src, value.href),
    alt: firstString(value.alt, value.title, value.name) || '内容图片',
    caption: firstString(value.caption, value.description),
    width: normalizeImageWidth(firstString(value.width, value.size)),
  })
  if (kind === 'video') return compactRecord({
    url: firstString(value.url, value.src, value.href),
    poster: firstString(value.poster, value.thumbnail, value.cover),
    title: firstString(value.title, value.name) || '视频',
    caption: firstString(value.caption, value.description),
  })
  if (kind === 'iframe') return compactRecord({
    url: providerEmbedUrl(firstString(value.url, value.src, value.embedUrl, value.href)),
    title: firstString(value.title, value.name, value.provider) || '网页嵌入',
    height: clampedNumber(value.height, 240, 900, 420),
  })
  if (kind === 'callout') return compactRecord({
    tone: normalizeTone(firstString(value.tone, value.level, value.kind, value.status)),
    title: firstString(value.title, value.label),
    text: firstString(value.text, value.content, value.message, value.description),
  })
  if (kind === 'status') return compactRecord({
    value: normalizeStatus(firstString(value.value, value.status, value.state)),
    label: firstString(value.label, value.title, value.name),
    description: firstString(value.description, value.text, value.summary),
  })
  if (kind === 'sensitive-text') {
    const envelope = recordValue(value.envelope)
    return { ...(envelope ?? value), hint: firstString(value.hint, envelope?.hint) }
  }
  return { ...value }
}

export function createContentCardNode(
  cardId: string,
  data: Record<string, unknown>,
  options: { instanceId?: string; version?: number } = {},
): ContentCardNode {
  const normalizedId = normalizeCardId(cardId)
  if (!/^[a-z0-9-]{1,64}$/.test(normalizedId)) throw new Error('内容卡类型无效')
  return {
    type: 'contentCard',
    attrs: {
      cardId: normalizedId,
      instanceId: options.instanceId && UUID_PATTERN.test(options.instanceId) ? options.instanceId : createInstanceId(),
      version: positiveInteger(options.version, 1),
      data: normalizeData(kindForCardId(normalizedId), data),
    },
  }
}

export function encodeContentCardToken(node: ContentCardNode): string {
  const { cardId, instanceId, version, data } = node.attrs
  if (!/^[a-z0-9-]{1,64}$/.test(cardId) || !UUID_PATTERN.test(instanceId)) throw new Error('内容卡标识无效')
  const bytes = new TextEncoder().encode(JSON.stringify(data))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  const encoded = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  return `{{card:${cardId}|id=${instanceId}|v=${version}|data=${encoded}}}`
}

export function safeResourceUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const url = value.trim()
  if (!url || url.length > 4096 || CONTROL_PATTERN.test(url) || /[<>"']/.test(url)) return null
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return url
  try {
    const parsed = new URL(url)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
    return parsed.href
  } catch {
    return null
  }
}

export function iframeUrlAllowed(value: unknown, allowHosts: readonly string[] = []): string | null {
  const safe = safeResourceUrl(value)
  if (!safe) return null
  if (safe.startsWith('/')) return safe
  if (allowHosts.length === 0) return safe
  const hostname = new URL(safe).hostname.toLowerCase()
  const allowed = allowHosts.some((candidate) => {
    const host = candidate.trim().toLowerCase().replace(/^\./, '')
    return Boolean(host) && (hostname === host || hostname.endsWith(`.${host}`))
  })
  return allowed ? safe : null
}

export function displayHostname(value: unknown): string {
  const safe = safeResourceUrl(value)
  if (!safe) return '链接地址无效'
  if (safe.startsWith('/')) return '本站内容'
  try { return new URL(safe).hostname.replace(/^www\./, '') } catch { return '安全链接' }
}

export function formatFileSize(value: unknown): string {
  const size = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
  if (size === null) return ''
  if (size < 1024) return `${Math.round(size)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let result = size / 1024
  let unitIndex = 0
  while (result >= 1024 && unitIndex < units.length - 1) { result /= 1024; unitIndex += 1 }
  return `${result >= 10 ? result.toFixed(0) : result.toFixed(1)} ${units[unitIndex]}`
}

export function kindForCardId(value: string): ContentCardKind {
  return KIND_ALIASES[normalizeCardId(value)] ?? 'unknown'
}

export function createInstanceId(): string {
  return createUuid()
}

function decodeTokenData(encoded: string): Record<string, unknown> {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - encoded.length % 4) % 4)
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  const decoded: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  if (!isRecord(decoded)) throw new Error('token data must be an object')
  return decoded
}

function providerEmbedUrl(value: string): string {
  const safe = safeResourceUrl(value)
  if (!safe || safe.startsWith('/')) return value
  try {
    const url = new URL(safe)
    const host = url.hostname.replace(/^www\./, '')
    if (host === 'youtu.be') return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(url.pathname.slice(1))}`
    if ((host === 'youtube.com' || host === 'm.youtube.com') && url.pathname === '/watch') {
      const id = url.searchParams.get('v')
      if (id) return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}`
    }
  } catch { /* The renderer will present an invalid-URL state. */ }
  return value
}

function inferLegacyType(value: Record<string, unknown>): string {
  if ('ciphertext' in value && 'salt' in value && 'iv' in value) return 'sensitive-text'
  if ('code' in value || 'language' in value) return 'code'
  if ('poster' in value) return 'video'
  if ('alt' in value || 'caption' in value) return 'image'
  if ('fileName' in value || 'mimeType' in value || 'downloadUrl' in value) return 'attachment'
  if ('url' in value || 'href' in value) return 'bookmark'
  if ('tone' in value || 'message' in value) return 'callout'
  if ('status' in value || 'state' in value) return 'status'
  return ''
}

function withoutMetadata(value: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value)) {
    if (!['type', 'kind', 'cardType', 'cardId', 'instanceId', 'id', 'version', 'attrs', 'token'].includes(key)) result[key] = item
  }
  return result
}

function invalidCard(message: string, raw = '', source: ContentCardSource = 'unknown'): NormalizedContentCard {
  return {
    cardId: 'unknown', kind: 'unknown', instanceId: createInstanceId(), version: 1,
    data: raw ? { raw } : {}, source, valid: false, warnings: [message], ...(raw ? { raw } : {}),
  }
}

function normalizeCardId(value: string): string {
  return value.trim().toLowerCase().replace(/_/g, '-').replace(/\s+/g, '-')
}

function validInstanceId(value: unknown): string {
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : createInstanceId()
}

function normalizeTone(value: string): string {
  const tone = value.trim().toUpperCase()
  return ['INFO', 'SUCCESS', 'WARNING', 'DANGER'].includes(tone) ? tone : 'INFO'
}

function normalizeStatus(value: string): string {
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, '_')
  return ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'].includes(status) ? status : 'TODO'
}

function normalizeImageWidth(value: string): string {
  const width = value.trim().toUpperCase()
  return ['SMALL', 'MEDIUM', 'LARGE', 'FULL'].includes(width) ? width : 'LARGE'
}

function primaryUrl(kind: ContentCardKind, data: Record<string, unknown>): string {
  return ['bookmark', 'attachment', 'image', 'video', 'iframe'].includes(kind) ? stringValue(data.url) : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null
}

function parseRecordString(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim().startsWith('{')) return null
  try { const parsed: unknown = JSON.parse(value); return isRecord(parsed) ? parsed : null } catch { return null }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function firstString(...values: unknown[]): string {
  for (const value of values) { const text = stringValue(value); if (text) return text }
  return ''
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(stringValue(value), 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function finiteNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const parsed = typeof value === 'number' ? value : Number(value)
    if (Number.isFinite(parsed) && parsed >= 0) return parsed
  }
  return undefined
}

function clampedNumber(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}

function compactRecord(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && typeof item !== 'undefined'))
}
