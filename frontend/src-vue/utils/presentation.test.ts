import { describe, expect, it } from 'vitest'
import {
  mergeKnowledgeBaseConfig,
  parseKnowledgeBaseCatalogDisplay,
} from './presentation'

describe('knowledge base presentation settings', () => {
  it('normalizes catalog controls to values supported by the reader', () => {
    expect(parseKnowledgeBaseCatalogDisplay('{"defaultExpandDepth":12,"showPath":true,"showUpdatedAt":"true"}')).toEqual({
      defaultExpandDepth: 6,
      showPath: true,
      showUpdatedAt: false,
    })
  })

  it('preserves extension fields when visual controls update known fields', () => {
    const result = mergeKnowledgeBaseConfig('{"extension":{"enabled":true},"theme":"PAPER"}', {
      theme: 'DARK',
      contentWidth: 'WIDE',
    })

    expect(JSON.parse(result)).toEqual({
      extension: { enabled: true },
      theme: 'DARK',
      contentWidth: 'WIDE',
    })
  })

  it('repairs malformed legacy JSON instead of emitting invalid configuration', () => {
    expect(JSON.parse(mergeKnowledgeBaseConfig('{bad json', { enabled: false }))).toEqual({ enabled: false })
  })
})
