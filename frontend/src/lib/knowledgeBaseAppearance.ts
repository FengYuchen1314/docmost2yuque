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

const themes = new Set<KnowledgeBaseTheme>(['PAPER', 'MINIMAL', 'MAGAZINE', 'DARK'])
const widths = new Set<KnowledgeBaseContentWidth>(['STANDARD', 'WIDE', 'FULL'])
const positions = new Set<WatermarkPosition>(['CENTER', 'TILED', 'FOOTER'])

export function parseKnowledgeBaseAppearance(value: unknown): KnowledgeBaseAppearance {
  const record = jsonRecord(value)
  return {
    theme: enumValue(record.theme, themes, 'PAPER'),
    coverUrl: safeUrl(record.coverUrl),
    backgroundColor: color(record.backgroundColor, '#f7f8f6'),
    accentColor: color(record.accentColor, '#3f8f61'),
    contentWidth: enumValue(record.contentWidth, widths, 'STANDARD'),
  }
}

export function parseKnowledgeBaseWatermark(value: unknown): KnowledgeBaseWatermark {
  const record = jsonRecord(value)
  return {
    enabled: record.enabled === true,
    text: typeof record.text === 'string' ? record.text.slice(0, 120) : '{{email}} · 内部资料',
    position: enumValue(record.position, positions, 'TILED'),
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

export function mergeKnowledgeBaseConfig(value: unknown, patch: object): string {
  return JSON.stringify({ ...jsonRecord(value), ...patch })
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try { return jsonRecord(JSON.parse(value)) } catch { return {} }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function enumValue<T extends string>(value: unknown, allowed: Set<T>, fallback: T): T {
  const normalized = typeof value === 'string' ? value.toUpperCase() as T : fallback
  return allowed.has(normalized) ? normalized : fallback
}

function color(value: unknown, fallback: string) {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback
}

function safeUrl(value: unknown) {
  if (typeof value !== 'string' || value.length > 2_000 || /[\u0000-\u001f\u007f]/.test(value)) return ''
  try { const url = new URL(value.trim()); return url.protocol === 'https:' && !url.username && !url.password ? url.toString() : '' } catch { return '' }
}

function numberInRange(value: unknown, minimum: number, maximum: number, fallback: number) {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback
}
