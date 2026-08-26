import type { SearchResult } from '../../src/types'

export function searchResultTypeLabel(type: SearchResult['resourceType']) {
  return ({
    PAGE: '文稿',
    QUICK_NOTE: '小记',
    KNOWLEDGE_BASE: '知识库',
    TEAM: '团队',
    USER: '成员',
    TEMPLATE: '模板',
    ATTACHMENT: '附件',
  } as const)[type]
}

export function searchResultDestination(result: SearchResult, workspaceId: string) {
  if (result.resourceType === 'PAGE') {
    return result.knowledgeBaseId
      ? `/app/kb/${encodeURIComponent(result.knowledgeBaseId)}/pages/${encodeURIComponent(result.resourceId)}`
      : `/app/pages/${encodeURIComponent(result.resourceId)}`
  }
  if (result.resourceType === 'QUICK_NOTE') return `/app/notes?open=${encodeURIComponent(result.resourceId)}`
  if (result.resourceType === 'KNOWLEDGE_BASE') return `/app/kb/${encodeURIComponent(result.resourceId)}`
  if (result.resourceType === 'TEAM' && workspaceId) return `/app/w/${encodeURIComponent(workspaceId)}/teams/${encodeURIComponent(result.resourceId)}`
  if (result.resourceType === 'TEMPLATE') return '/app/templates'
  return null
}
