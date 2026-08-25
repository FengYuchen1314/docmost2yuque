import type { DocumentSettings } from '../types'

export const defaultDocumentSettings: DocumentSettings = {
  pageWidth: 'STANDARD',
  fontFamily: 'SERIF',
  fontSize: 'MEDIUM',
  paragraphSpacing: 'NORMAL',
  showOutline: true,
}

export function normalizeDocumentSettings(value: unknown): DocumentSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
  return {
    pageWidth: oneOf(record.pageWidth, ['STANDARD', 'WIDE'], defaultDocumentSettings.pageWidth),
    fontFamily: oneOf(record.fontFamily, ['SERIF', 'SANS'], defaultDocumentSettings.fontFamily),
    fontSize: oneOf(record.fontSize, ['SMALL', 'MEDIUM', 'LARGE'], defaultDocumentSettings.fontSize),
    paragraphSpacing: oneOf(record.paragraphSpacing, ['COMPACT', 'NORMAL', 'RELAXED'], defaultDocumentSettings.paragraphSpacing),
    showOutline: typeof record.showOutline === 'boolean' ? record.showOutline : defaultDocumentSettings.showOutline,
  }
}

export function documentSettingsClassNames(value: unknown) {
  const settings = normalizeDocumentSettings(value)
  return [
    `document-width-${settings.pageWidth.toLowerCase()}`,
    `document-font-${settings.fontFamily.toLowerCase()}`,
    `document-size-${settings.fontSize.toLowerCase()}`,
    `document-spacing-${settings.paragraphSpacing.toLowerCase()}`,
  ].join(' ')
}

function oneOf<T extends string>(value: unknown, supported: readonly T[], fallback: T): T {
  return typeof value === 'string' && supported.includes(value.toUpperCase() as T)
    ? value.toUpperCase() as T
    : fallback
}
