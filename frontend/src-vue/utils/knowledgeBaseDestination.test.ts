import { describe, expect, it } from 'vitest'
import { knowledgeBaseDestination } from './knowledgeBaseDestination'

describe('knowledgeBaseDestination', () => {
  it('opens the configured homepage when one exists', () => {
    expect(knowledgeBaseDestination({ id: 'product/library', homepagePageId: 'getting started#1' }))
      .toBe('/app/kb/product%2Flibrary/pages/getting%20started%231')
  })

  it('opens the knowledge-base overview when no homepage exists', () => {
    expect(knowledgeBaseDestination({ id: '中文 知识库', homepagePageId: null }))
      .toBe('/app/kb/%E4%B8%AD%E6%96%87%20%E7%9F%A5%E8%AF%86%E5%BA%93')
  })

  it('treats an empty homepage id as not configured', () => {
    expect(knowledgeBaseDestination({ id: 'kb', homepagePageId: '' })).toBe('/app/kb/kb')
  })
})
