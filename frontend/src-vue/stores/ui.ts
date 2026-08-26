import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ResourceKind } from '../utils/createResource'

export type CreateResourceSource = 'TOP_BAR' | 'WORKBENCH' | 'SIDEBAR_KB' | 'WORKSPACE' | 'KNOWLEDGE_BASE'

export interface CreateResourceRequest {
  kind?: ResourceKind
  workspaceId?: string
  knowledgeBaseId?: string
  source?: CreateResourceSource
}

export const useUiStore = defineStore('ui', () => {
  const navigationOpen = ref(true)
  const searchOpen = ref(false)
  const createOpen = ref(false)
  const createRequest = ref<CreateResourceRequest>({})
  const toast = ref({ open: false, text: '', color: 'success' })
  const notify = (text: string, color = 'success') => { toast.value = { open: true, text, color } }
  const openCreate = (request: CreateResourceRequest = {}) => {
    createRequest.value = { ...request }
    createOpen.value = true
  }
  const closeCreate = () => {
    createOpen.value = false
  }
  return { navigationOpen, searchOpen, createOpen, createRequest, toast, notify, openCreate, closeCreate }
})
