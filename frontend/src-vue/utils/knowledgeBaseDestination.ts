import type { KnowledgeBase } from '../../src/types'

type KnowledgeBaseDestination = Pick<KnowledgeBase, 'id' | 'homepagePageId'>

export function knowledgeBaseDestination(knowledgeBase: KnowledgeBaseDestination): string {
  const knowledgeBasePath = `/app/kb/${encodeURIComponent(knowledgeBase.id)}`
  return knowledgeBase.homepagePageId
    ? `${knowledgeBasePath}/pages/${encodeURIComponent(knowledgeBase.homepagePageId)}`
    : knowledgeBasePath
}
