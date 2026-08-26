<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { KnowledgeBase, Page } from '../../src/types'
import { messageOf, post } from '../services/api'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import {
  canCreateResource,
  needsKnowledgeBase as kindNeedsKnowledgeBase,
  resetCreateResourceDraft,
  resourceTitle,
  type CreateResourceDraft,
  type ResourceKind,
} from '../utils/createResource'

const session = useSessionStore(); const ui = useUiStore(); const router = useRouter()
const form = reactive<CreateResourceDraft>({ kind: 'DOCUMENT', title: '', slug: '', knowledgeBaseId: '' })
const loading = ref(false); const error = ref(''); const showAdvanced = ref(false)
const kinds = [
  { title: '文档', value: 'DOCUMENT', icon: 'mdi-file-document-outline' },
  { title: '白板', value: 'WHITEBOARD', icon: 'mdi-drawing-box' },
  { title: '电子表格', value: 'SPREADSHEET', icon: 'mdi-table-large' },
  { title: '数据表', value: 'DATABASE', icon: 'mdi-database-outline' },
  { title: '知识库', value: 'KNOWLEDGE_BASE', icon: 'mdi-book-plus-outline' },
  { title: '组织空间', value: 'WORKSPACE', icon: 'mdi-domain-plus' },
]
const pageKindValues = new Set<ResourceKind>(['DOCUMENT', 'WHITEBOARD', 'SPREADSHEET', 'DATABASE'])
const targetWorkspaceId = computed(() => ui.createRequest.workspaceId || session.activeWorkspace?.id || '')
const availableKnowledgeBases = computed(() => session.knowledgeBases.filter((item) => item.workspaceId === targetWorkspaceId.value))
const visibleKinds = computed(() => {
  if (ui.createRequest.kind) return kinds.filter((item) => item.value === ui.createRequest.kind)
  if (ui.createRequest.knowledgeBaseId) return kinds.filter((item) => pageKindValues.has(item.value as ResourceKind))
  return kinds
})
const selectedKind = computed(() => kinds.find((item) => item.value === form.kind) ?? kinds[0])
const dialogTitle = computed(() => {
  if (form.kind === 'KNOWLEDGE_BASE') return '新建知识库'
  if (form.kind === 'WORKSPACE') return '新建组织空间'
  if (ui.createRequest.knowledgeBaseId) return '在当前知识库中新建'
  return '新建内容'
})
const needsKnowledgeBase = computed(() => kindNeedsKnowledgeBase(form.kind))
const createEnabled = computed(() => canCreateResource(form))
watch([() => ui.createOpen, () => ui.createRequest], ([open]) => {
  if (!open) return
  const requestedKnowledgeBase = availableKnowledgeBases.value.find((item) => item.id === ui.createRequest.knowledgeBaseId)?.id
  resetCreateResourceDraft(
    form,
    requestedKnowledgeBase ?? availableKnowledgeBases.value[0]?.id ?? '',
    ui.createRequest.kind ?? 'DOCUMENT',
  )
  error.value = ''
  showAdvanced.value = false
})
watch(() => form.title, (title) => { form.slug = slugify(title) })
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) }
async function create() {
  if (loading.value || !createEnabled.value) return
  loading.value = true; error.value = ''
  try {
    if (form.kind === 'WORKSPACE') {
      const workspace = await post<{ id: string }>('/api/v1/workspaces/create', { name: form.title })
      await session.loadNavigation(); ui.closeCreate(); await router.push(`/app/w/${workspace.id}`)
    } else if (form.kind === 'KNOWLEDGE_BASE') {
      const workspaceId = targetWorkspaceId.value
      if (!workspaceId) throw new Error('请先选择工作区')
      const kb = await post<KnowledgeBase>('/api/v1/knowledge-bases/create', { workspaceId, name: form.title, slug: form.slug, ownerType: 'WORKSPACE', ownerId: workspaceId, visibility: 'PRIVATE', publishMode: 'MANUAL' })
      await session.loadNavigation(); ui.closeCreate(); await router.push(`/app/kb/${kb.id}`)
    } else {
      const kind = form.kind as Exclude<ResourceKind, 'KNOWLEDGE_BASE' | 'WORKSPACE'>
      const page = await post<Page>('/api/v1/pages/create', { knowledgeBaseId: form.knowledgeBaseId, title: resourceTitle(kind, form.title), path: form.slug || `untitled-${Date.now()}`, contentType: kind })
      ui.closeCreate(); await router.push(`/app/kb/${page.knowledgeBaseId}/pages/${page.id}`)
    }
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
function switchToKnowledgeBase() {
  ui.openCreate({ kind: 'KNOWLEDGE_BASE', workspaceId: targetWorkspaceId.value, source: ui.createRequest.source })
}
function handleCreateKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || loading.value || !createEnabled.value) return
  const target = event.target instanceof HTMLElement ? event.target : null
  const commandSubmit = event.ctrlKey || event.metaKey
  if (!commandSubmit && target?.closest('button, textarea, select, [role="button"], [role="combobox"], [role="option"]')) return
  event.preventDefault()
  void create()
}
</script>

<template>
  <v-dialog v-model="ui.createOpen">
    <v-card @keydown="handleCreateKeydown"><v-card-title class="d-flex align-center pa-6"><span>{{ dialogTitle }}</span><v-spacer /><v-btn icon="mdi-close" aria-label="关闭新建窗口" variant="text" @click="ui.closeCreate" /></v-card-title>
      <v-card-text class="px-6 pb-2">
        <v-item-group v-if="visibleKinds.length > 1" v-model="form.kind" mandatory class="create-kind-grid mb-5">
          <v-item v-for="kind in visibleKinds" :key="kind.value" v-slot="{ isSelected, toggle }" :value="kind.value"><v-card class="section-card clickable pa-4" :color="isSelected ? 'primary' : undefined" :variant="isSelected ? 'tonal' : 'flat'" @click="toggle"><v-icon class="mr-2">{{ kind.icon }}</v-icon><strong>{{ kind.title }}</strong></v-card></v-item>
        </v-item-group>
        <v-card v-else class="selected-kind mb-5 pa-4" color="primary" variant="tonal"><v-icon class="mr-2">{{ selectedKind?.icon }}</v-icon><strong>{{ selectedKind?.title }}</strong></v-card>
        <v-select v-if="needsKnowledgeBase" v-model="form.knowledgeBaseId" :items="availableKnowledgeBases" item-title="name" item-value="id" label="保存到知识库" prepend-inner-icon="mdi-book-open-page-variant-outline" class="mb-4" />
        <v-alert v-if="needsKnowledgeBase && !availableKnowledgeBases.length" type="info" variant="tonal" class="mb-4"><div class="d-flex flex-wrap align-center justify-space-between ga-2"><span>当前空间还没有知识库，请先新建知识库。</span><v-btn size="small" variant="tonal" @click="switchToKnowledgeBase">立即新建</v-btn></div></v-alert>
        <v-text-field v-model="form.title" :label="form.kind === 'WORKSPACE' ? '空间名称' : form.kind === 'KNOWLEDGE_BASE' ? '知识库名称' : '标题'" autofocus class="mb-4" />
        <v-btn v-if="form.kind !== 'WORKSPACE'" variant="text" size="small" :append-icon="showAdvanced ? 'mdi-chevron-up' : 'mdi-chevron-down'" class="mb-2" @click="showAdvanced = !showAdvanced">高级设置</v-btn>
        <v-expand-transition><v-text-field v-if="form.kind !== 'WORKSPACE' && showAdvanced" v-model="form.slug" label="访问路径" prefix="/" class="mb-4" /></v-expand-transition>
        <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="pa-6 pt-4"><v-spacer /><v-btn variant="text" @click="ui.closeCreate">取消</v-btn><v-btn color="primary" :loading="loading" :disabled="!createEnabled" @click="create">创建并打开</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.create-kind-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.selected-kind { display: flex; align-items: center; }
@media (max-width: 560px) { .create-kind-grid { grid-template-columns: 1fr; } }
</style>
