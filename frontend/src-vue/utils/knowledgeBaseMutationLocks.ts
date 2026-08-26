export type KnowledgeBaseMutationLane = 'settings' | 'members' | 'transfer' | 'lifecycle'
export type KnowledgeBaseLifecycleMutation = 'plan' | 'merge' | 'archive'

const locks: Record<KnowledgeBaseMutationLane, Map<string, string>> = {
  settings: new Map(),
  members: new Map(),
  transfer: new Map(),
  lifecycle: new Map(),
}

export function acquireKnowledgeBaseMutation(
  knowledgeBaseId: string,
  lane: KnowledgeBaseMutationLane,
  operation = lane,
) {
  const laneLocks = locks[lane]
  if (!knowledgeBaseId || laneLocks.has(knowledgeBaseId)) return false
  laneLocks.set(knowledgeBaseId, operation)
  return true
}

export function releaseKnowledgeBaseMutation(knowledgeBaseId: string, lane: KnowledgeBaseMutationLane) {
  locks[lane].delete(knowledgeBaseId)
}

export function knowledgeBaseMutationInFlight(knowledgeBaseId: string, lane: KnowledgeBaseMutationLane) {
  return locks[lane].has(knowledgeBaseId)
}

export function knowledgeBaseLifecycleMutation(knowledgeBaseId: string): KnowledgeBaseLifecycleMutation | '' {
  const value = locks.lifecycle.get(knowledgeBaseId)
  return value === 'plan' || value === 'merge' || value === 'archive' ? value : ''
}
