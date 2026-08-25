import type { DocumentSettings } from '../../src/types'

export type KnowledgeBaseTheme = 'PAPER' | 'MINIMAL' | 'MAGAZINE' | 'DARK'
export type KnowledgeBaseContentWidth = 'STANDARD' | 'WIDE' | 'FULL'
export type WatermarkPosition = 'CENTER' | 'TILED' | 'FOOTER'

export interface KnowledgeBaseAppearance {
  theme: KnowledgeBaseTheme
  coverUrl: string
  backgroundColor: string
  accentColor: string
  contentWidth: KnowledgeBaseContentWidth
}

export interface KnowledgeBaseWatermark {
  enabled: boolean
  text: string
  position: WatermarkPosition
  opacity: number
}

export interface KnowledgeBaseCatalogDisplay {
  defaultExpandDepth: number
  showPath: boolean
  showUpdatedAt: boolean
}

export function parseKnowledgeBaseAppearance(value: unknown): KnowledgeBaseAppearance {
  const record = jsonRecord(value)
  return {
    theme: oneOf(record.theme, ['PAPER', 'MINIMAL', 'MAGAZINE', 'DARK'], 'PAPER'),
    coverUrl: safePresentationUrl(record.coverUrl),
    backgroundColor: color(record.backgroundColor, '#f7f8f6'),
    accentColor: color(record.accentColor, '#2563eb'),
    contentWidth: oneOf(record.contentWidth, ['STANDARD', 'WIDE', 'FULL'], 'STANDARD'),
  }
}

export function parseKnowledgeBaseWatermark(value: unknown): KnowledgeBaseWatermark {
  const record = jsonRecord(value)
  return {
    enabled: record.enabled === true,
    text: typeof record.text === 'string' ? record.text.slice(0, 120) : '{{email}} · 内部资料',
    position: oneOf(record.position, ['CENTER', 'TILED', 'FOOTER'], 'TILED'),
    opacity: numberInRange(record.opacity, 0.05, 0.4, 0.12),
  }
}

export function parseKnowledgeBaseCatalogDisplay(value: unknown): KnowledgeBaseCatalogDisplay {
  const record = jsonRecord(value)
  return {
    defaultExpandDepth: Math.round(numberInRange(record.defaultExpandDepth, 1, 6, 3)),
    showPath: record.showPath === true,
    showUpdatedAt: record.showUpdatedAt === true,
  }
}

/**
 * The server intentionally accepts extension fields in these JSON objects.
 * Visual settings must therefore patch, rather than replace, the stored value.
 */
export function mergeKnowledgeBaseConfig(value: unknown, patch: object): string {
  return JSON.stringify({ ...jsonRecord(value), ...patch })
}

export function normalizeDocumentSettings(value: unknown): DocumentSettings {
  const record = jsonRecord(value)
  return {
    pageWidth: oneOf(record.pageWidth, ['STANDARD', 'WIDE'], 'STANDARD'),
    fontFamily: oneOf(record.fontFamily, ['SERIF', 'SANS'], 'SERIF'),
    fontSize: oneOf(record.fontSize, ['SMALL', 'MEDIUM', 'LARGE'], 'MEDIUM'),
    paragraphSpacing: oneOf(record.paragraphSpacing, ['COMPACT', 'NORMAL', 'RELAXED'], 'NORMAL'),
    showOutline: typeof record.showOutline === 'boolean' ? record.showOutline : true,
  }
}

export function safePresentationUrl(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) return ''
  const trimmed = value.trim()
  if (trimmed.startsWith('/')) return trimmed.startsWith('//') || trimmed.startsWith('/\\') ? '' : trimmed
  try {
    const url = new URL(trimmed)
    return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : ''
  } catch { return '' }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return jsonRecord(JSON.parse(value)) } catch { return {} }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  const normalized = typeof value === 'string' ? value.toUpperCase() as T : fallback
  return allowed.includes(normalized) ? normalized : fallback
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

function numberInRange(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback
}
