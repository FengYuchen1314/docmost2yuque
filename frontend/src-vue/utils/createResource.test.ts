import { describe, expect, it } from 'vitest'
import {
  canCreateResource,
  resetCreateResourceDraft,
  resourceTitle,
  type CreateResourceDraft,
} from './createResource'

describe('create resource draft', () => {
  it('resets every field and returns to the default document type', () => {
    const draft: CreateResourceDraft = {
      kind: 'DATABASE',
      title: '旧标题',
      slug: 'old-path',
      knowledgeBaseId: 'old-kb',
    }

    resetCreateResourceDraft(draft, 'first-kb')

    expect(draft).toEqual({ kind: 'DOCUMENT', title: '', slug: '', knowledgeBaseId: 'first-kb' })
  })

  it('can reset into the resource type and destination requested by an entry point', () => {
    const draft: CreateResourceDraft = {
      kind: 'DOCUMENT',
      title: '旧标题',
      slug: 'old-path',
      knowledgeBaseId: 'old-kb',
    }

    resetCreateResourceDraft(draft, 'route-kb', 'SPREADSHEET')

    expect(draft).toEqual({ kind: 'SPREADSHEET', title: '', slug: '', knowledgeBaseId: 'route-kb' })
  })

  it('allows untitled pages and supplies the matching default title', () => {
    const draft: CreateResourceDraft = { kind: 'WHITEBOARD', title: '   ', slug: '', knowledgeBaseId: 'kb-1' }

    expect(canCreateResource(draft)).toBe(true)
    expect(resourceTitle(draft.kind, draft.title)).toBe('无标题白板')
  })

  it('still requires a destination for pages and a name for containers', () => {
    expect(canCreateResource({ kind: 'DOCUMENT', title: '', slug: '', knowledgeBaseId: '' })).toBe(false)
    expect(canCreateResource({ kind: 'KNOWLEDGE_BASE', title: '', slug: '', knowledgeBaseId: '' })).toBe(false)
    expect(canCreateResource({ kind: 'WORKSPACE', title: '团队空间', slug: '', knowledgeBaseId: '' })).toBe(true)
  })
})
