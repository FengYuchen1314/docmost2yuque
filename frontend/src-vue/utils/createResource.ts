export type ResourceKind = 'DOCUMENT' | 'WHITEBOARD' | 'SPREADSHEET' | 'DATABASE' | 'KNOWLEDGE_BASE' | 'WORKSPACE'

export interface CreateResourceDraft {
  kind: ResourceKind
  title: string
  slug: string
  knowledgeBaseId: string
}

export const DEFAULT_RESOURCE_KIND: ResourceKind = 'DOCUMENT'

const DEFAULT_PAGE_TITLES: Record<Exclude<ResourceKind, 'KNOWLEDGE_BASE' | 'WORKSPACE'>, string> = {
  DOCUMENT: '无标题文档',
  WHITEBOARD: '无标题白板',
  SPREADSHEET: '无标题电子表格',
  DATABASE: '无标题数据表',
}

export function resetCreateResourceDraft(draft: CreateResourceDraft, knowledgeBaseId = '') {
  draft.kind = DEFAULT_RESOURCE_KIND
  draft.title = ''
  draft.slug = ''
  draft.knowledgeBaseId = knowledgeBaseId
}

export function needsKnowledgeBase(kind: ResourceKind) {
  return kind !== 'KNOWLEDGE_BASE' && kind !== 'WORKSPACE'
}

export function resourceTitle(kind: ResourceKind, title: string) {
  const normalized = title.trim()
  if (normalized || kind === 'KNOWLEDGE_BASE' || kind === 'WORKSPACE') return normalized
  return DEFAULT_PAGE_TITLES[kind]
}

export function canCreateResource(draft: CreateResourceDraft) {
  if (needsKnowledgeBase(draft.kind) && !draft.knowledgeBaseId) return false
  if (draft.kind === 'KNOWLEDGE_BASE' || draft.kind === 'WORKSPACE') return Boolean(draft.title.trim())
  return true
}
