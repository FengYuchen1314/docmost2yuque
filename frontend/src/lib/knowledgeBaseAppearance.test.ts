import { describe, expect, it } from 'vitest'
import { mergeKnowledgeBaseConfig, parseKnowledgeBaseAppearance, parseKnowledgeBaseCatalogDisplay, parseKnowledgeBaseWatermark } from './knowledgeBaseAppearance'

describe('knowledge-base appearance settings', () => {
  it('normalizes safe visual settings and rejects unsafe cover or color values', () => {
    expect(parseKnowledgeBaseAppearance(JSON.stringify({ theme: 'dark', coverUrl: 'javascript:alert(1)', backgroundColor: 'red', accentColor: '#AABBCC', contentWidth: 'wide' }))).toEqual({ theme: 'DARK', coverUrl: '', backgroundColor: '#f7f8f6', accentColor: '#aabbcc', contentWidth: 'WIDE' })
    expect(parseKnowledgeBaseAppearance({ coverUrl: 'https://user:secret@example.com/cover.jpg' }).coverUrl).toBe('')
  })

  it('bounds watermark and catalog controls', () => {
    expect(parseKnowledgeBaseWatermark({ enabled: true, text: '内部', position: 'footer', opacity: 9 })).toEqual({ enabled: true, text: '内部', position: 'FOOTER', opacity: 0.4 })
    expect(parseKnowledgeBaseCatalogDisplay({ defaultExpandDepth: 99, showPath: true, showUpdatedAt: true })).toEqual({ defaultExpandDepth: 6, showPath: true, showUpdatedAt: true })
  })

  it('preserves extension keys while saving visible fields', () => {
    expect(JSON.parse(mergeKnowledgeBaseConfig('{"extension":"kept","theme":"PAPER"}', { theme: 'MAGAZINE', contentWidth: 'FULL' }))).toEqual({ extension: 'kept', theme: 'MAGAZINE', contentWidth: 'FULL' })
  })
})
