import { describe, expect, it } from 'vitest'
import type { SearchResult } from '../../src/types'
import { searchResultDestination, searchResultTypeLabel } from './searchNavigation'

const result = (resourceType: SearchResult['resourceType'], resourceId = 'resource'): SearchResult => ({
  documentId: `${resourceType}-${resourceId}`,
  resourceId,
  resourceType,
  sourceScope: 'CANONICAL',
  title: '标题',
  snippet: '',
  path: null,
  contentType: null,
  publicationId: null,
  knowledgeBaseId: null,
  score: 1,
  updatedAt: '2026-08-26T00:00:00Z',
})

describe('search result navigation', () => {
  it('routes navigable result types to their actual detail screens', () => {
    expect(searchResultDestination({ ...result('PAGE', 'page'), knowledgeBaseId: 'kb' }, 'workspace')).toBe('/app/kb/kb/pages/page')
    expect(searchResultDestination(result('TEAM', 'team'), 'workspace')).toBe('/app/w/workspace/teams/team')
    expect(searchResultDestination(result('QUICK_NOTE', 'note'), 'workspace')).toBe('/app/notes?open=note')
  })

  it('does not pretend member or attachment results have a detail route', () => {
    expect(searchResultDestination(result('USER'), 'workspace')).toBeNull()
    expect(searchResultDestination(result('ATTACHMENT'), 'workspace')).toBeNull()
    expect(searchResultTypeLabel('ATTACHMENT')).toBe('附件')
  })
})
