import { describe, expect, it } from 'vitest'
import { documentSettingsClassNames, normalizeDocumentSettings } from './documentSettings'

describe('document settings', () => {
  it('uses stable defaults for old and malformed documents', () => {
    expect(normalizeDocumentSettings(null)).toEqual({
      pageWidth: 'STANDARD',
      fontFamily: 'SERIF',
      fontSize: 'MEDIUM',
      paragraphSpacing: 'NORMAL',
      showOutline: true,
    })
    expect(normalizeDocumentSettings({ fontSize: 'huge' }).fontSize).toBe('MEDIUM')
  })

  it('creates allowlisted presentation classes only', () => {
    expect(documentSettingsClassNames({
      pageWidth: 'wide',
      fontFamily: 'sans',
      fontSize: 'large',
      paragraphSpacing: 'relaxed',
      untrustedCss: 'position:fixed',
    })).toBe('document-width-wide document-font-sans document-size-large document-spacing-relaxed')
  })
})
