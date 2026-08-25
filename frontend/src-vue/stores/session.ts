import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { CurrentUser, KnowledgeBase, Workspace } from '../../src/types'
import { get, post, resetCsrf } from '../services/api'

export const useSessionStore = defineStore('session', () => {
  const user = ref<CurrentUser | null>(null)
  const workspaces = ref<Workspace[]>([])
  const knowledgeBases = ref<KnowledgeBase[]>([])
  const ready = ref(false)
  const activeWorkspaceId = ref(localStorage.getItem('active-workspace') ?? '')
  const activeWorkspace = computed(() => workspaces.value.find((item) => item.id === activeWorkspaceId.value) ?? workspaces.value[0] ?? null)
  const activeKnowledgeBases = computed(() => knowledgeBases.value.filter((item) => item.workspaceId === activeWorkspace.value?.id))

  async function loadUser() {
    try { user.value = await get<CurrentUser>('/api/v1/auth/me') } catch { user.value = null }
    ready.value = true
    return user.value
  }
  async function loadNavigation() {
    const workspaceValues = await get<Workspace[]>('/api/v1/workspaces')
    const knowledgeBaseValues = (await Promise.all(workspaceValues.map((workspace) => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: workspace.id })))).flat()
    workspaces.value = workspaceValues
    knowledgeBases.value = knowledgeBaseValues
    if (!activeWorkspaceId.value || !workspaceValues.some((item) => item.id === activeWorkspaceId.value)) selectWorkspace(workspaceValues[0]?.id ?? '')
  }
  function selectWorkspace(id: string) {
    activeWorkspaceId.value = id
    if (id) localStorage.setItem('active-workspace', id)
  }
  async function logout() {
    await post('/api/v1/auth/logout', {})
    resetCsrf()
    user.value = null
    workspaces.value = []
    knowledgeBases.value = []
  }
  return { user, workspaces, knowledgeBases, ready, activeWorkspaceId, activeWorkspace, activeKnowledgeBases, loadUser, loadNavigation, selectWorkspace, logout }
})
