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
const kinds: Array<{ title: string; value: ResourceKind; icon: string }> = [
  { title: '文档', value: 'DOCUMENT', icon: 'mdi-file-document-outline' },
  { title: '白板', value: 'WHITEBOARD', icon: 'mdi-drawing-box' },
  { title: '电子表格', value: 'SPREADSHEET', icon: 'mdi-table-large' },
  { title: '数据表', value: 'DATABASE', icon: 'mdi-database-outline' },
  { title: '知识库', value: 'KNOWLEDGE_BASE', icon: 'mdi-book-plus-outline' },
  { title: '组织空间', value: 'WORKSPACE', icon: 'mdi-domain-plus' },
]
const pageKindValues = new Set<ResourceKind>(['DOCUMENT', 'WHITEBOARD', 'SPREADSHEET', 'DATABASE'])
const targetWorkspaceId = computed(() => ui.createRequest.workspaceId || session.activeWorkspace?.id || '')
const targetWorkspace = computed(() => session.workspaces.find((item) => item.id === targetWorkspaceId.value) ?? session.activeWorkspace)
const availableKnowledgeBases = computed(() => session.knowledgeBases.filter((item) => item.workspaceId === targetWorkspaceId.value))
const visibleKinds = computed(() => {
  if (ui.createRequest.kind) return kinds.filter((item) => item.value === ui.createRequest.kind)
  if (ui.createRequest.knowledgeBaseId) return kinds.filter((item) => pageKindValues.has(item.value as ResourceKind))
  return kinds
})
const selectedKind = computed(() => kinds.find((item) => item.value === form.kind) ?? kinds[0])
const isPageKind = computed(() => pageKindValues.has(form.kind))
const dialogTitle = computed(() => {
  if (form.kind === 'KNOWLEDGE_BASE') return '新建知识库'
  if (form.kind === 'WORKSPACE') return '新建组织空间'
  if (ui.createRequest.knowledgeBaseId) return '在当前知识库中新建'
  return '新建内容'
})
const needsKnowledgeBase = computed(() => kindNeedsKnowledgeBase(form.kind))
const createEnabled = computed(() => canCreateResource(form))
const untitledName = computed(() => isPageKind.value ? resourceTitle(form.kind, '') : '')
const createButtonLabel = computed(() => {
  if (isPageKind.value) return '新建并打开'
  return form.kind === 'KNOWLEDGE_BASE' ? '创建知识库' : '创建空间'
})
const kindDescriptions: Record<ResourceKind, string> = {
  DOCUMENT: '写作与沉淀知识',
  WHITEBOARD: '自由整理想法',
  SPREADSHEET: '处理表格数据',
  DATABASE: '用多种视图管理记录',
  KNOWLEDGE_BASE: '集中组织一组内容',
  WORKSPACE: '创建新的协作空间',
}
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
watch(() => form.kind, (kind, previous) => {
  if (kind === previous) return
  form.title = ''
  form.slug = ''
  error.value = ''
  showAdvanced.value = false
  if (kindNeedsKnowledgeBase(kind) && !availableKnowledgeBases.value.some((item) => item.id === form.knowledgeBaseId)) {
    form.knowledgeBaseId = availableKnowledgeBases.value[0]?.id ?? ''
  }
})
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
  <v-dialog v-model="ui.createOpen" max-width="520" content-class="create-dialog-overlay">
    <v-card class="create-dialog" rounded="lg" @keydown="handleCreateKeydown">
      <header class="create-header">
        <div><strong>{{ dialogTitle }}</strong><span v-if="targetWorkspaceId">{{ targetWorkspace?.name || '当前工作区' }}</span></div>
        <v-btn icon="mdi-close" size="small" aria-label="关闭新建窗口" variant="text" @click="ui.closeCreate" />
      </header>

      <div class="create-body">
        <div v-if="visibleKinds.length > 1" class="create-kind-grid" role="radiogroup" aria-label="内容类型">
          <button
            v-for="kind in visibleKinds"
            :key="kind.value"
            type="button"
            class="kind-option"
            :class="{ active: form.kind === kind.value }"
            role="radio"
            :aria-checked="form.kind === kind.value"
            @click="form.kind = kind.value"
          >
            <span class="kind-icon"><v-icon size="18">{{ kind.icon }}</v-icon></span>
            <span><strong>{{ kind.title }}</strong><small>{{ kindDescriptions[kind.value] }}</small></span>
          </button>
        </div>
        <div v-else class="selected-kind">
          <span class="kind-icon"><v-icon size="19">{{ selectedKind?.icon }}</v-icon></span>
          <span><strong>{{ selectedKind?.title }}</strong><small>{{ kindDescriptions[selectedKind?.value ?? 'DOCUMENT'] }}</small></span>
        </div>

        <template v-if="needsKnowledgeBase">
          <v-select
            v-if="availableKnowledgeBases.length"
            v-model="form.knowledgeBaseId"
            class="destination-select"
            :items="availableKnowledgeBases"
            item-title="name"
            item-value="id"
            label="保存到"
            prepend-inner-icon="mdi-book-open-page-variant-outline"
            variant="outlined"
            density="comfortable"
            hide-details
          />
          <div v-else class="no-destination">
            <v-icon size="19">mdi-book-plus-outline</v-icon>
            <span><strong>当前空间还没有知识库</strong><small>先创建知识库，才能保存文档类内容。</small></span>
            <v-btn size="small" variant="tonal" @click="switchToKnowledgeBase">新建知识库</v-btn>
          </div>
          <p v-if="availableKnowledgeBases.length" class="untitled-hint">将创建“{{ untitledName }}”，打开后即可直接输入标题和内容。</p>
        </template>

        <v-text-field
          v-if="!isPageKind"
          v-model="form.title"
          :label="form.kind === 'WORKSPACE' ? '空间名称' : '知识库名称'"
          autofocus
          variant="outlined"
          density="comfortable"
          hide-details
        />

        <button v-if="form.kind !== 'WORKSPACE'" type="button" class="advanced-toggle" :aria-expanded="showAdvanced" @click="showAdvanced = !showAdvanced">
          <span>{{ isPageKind ? '标题与访问路径' : '访问路径' }}</span>
          <small>可选</small>
          <v-icon size="16">{{ showAdvanced ? 'mdi-chevron-up' : 'mdi-chevron-down' }}</v-icon>
        </button>
        <v-expand-transition>
          <div v-if="form.kind !== 'WORKSPACE' && showAdvanced" class="advanced-fields">
            <v-text-field v-if="isPageKind" v-model="form.title" label="标题" placeholder="留空则使用无标题" variant="outlined" density="comfortable" hide-details />
            <v-text-field v-model="form.slug" label="访问路径" prefix="/" placeholder="留空自动生成" variant="outlined" density="comfortable" hide-details />
          </div>
        </v-expand-transition>

        <div v-if="error" class="create-error" role="alert"><v-icon size="18">mdi-alert-circle-outline</v-icon><span>{{ error }}</span></div>
      </div>

      <footer class="create-actions">
        <span class="shortcut-hint"><kbd>Ctrl</kbd><kbd>Enter</kbd> 创建</span>
        <v-spacer />
        <v-btn size="small" variant="text" @click="ui.closeCreate">取消</v-btn>
        <v-btn size="small" color="primary" variant="flat" :loading="loading" :disabled="!createEnabled" @click="create">{{ createButtonLabel }}</v-btn>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.create-dialog { overflow: hidden; border: 1px solid #e3e5e7; background: #fff; box-shadow: 0 18px 52px rgb(31 35 41 / 16%) !important; }
.create-header { display: flex; min-height: 52px; align-items: center; border-bottom: 1px solid #eef0f2; padding: 0 10px 0 18px; }
.create-header > div { display: flex; min-width: 0; flex-direction: column; }
.create-header strong { color: #262626; font-size: 15px; font-weight: 600; }
.create-header span { overflow: hidden; margin-top: 1px; color: #9aa0a8; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.create-body { display: grid; gap: 16px; padding: 18px; }
.create-kind-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
.kind-option { display: flex; min-width: 0; min-height: 50px; align-items: center; gap: 10px; border: 1px solid transparent; border-radius: 7px; padding: 7px 9px; color: #3d424a; background: #f7f8fa; cursor: pointer; font: inherit; text-align: left; }
.kind-option:hover { background: #f0f1f2; }
.kind-option.active { border-color: #cddcff; color: #2468f2; background: #f2f6ff; }
.kind-icon { display: inline-grid; width: 30px; height: 30px; place-items: center; flex: 0 0 30px; border-radius: 6px; color: #5b6f91; background: #fff; box-shadow: inset 0 0 0 1px #e7e9e8; }
.kind-option.active .kind-icon { color: #2468f2; box-shadow: inset 0 0 0 1px #cddcff; }
.kind-option > span:last-child,
.selected-kind > span:last-child,
.no-destination > span { display: flex; min-width: 0; flex-direction: column; }
.kind-option strong,
.selected-kind strong,
.no-destination strong { overflow: hidden; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.kind-option small,
.selected-kind small,
.no-destination small { overflow: hidden; margin-top: 2px; color: #8a8f8d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.selected-kind { display: flex; min-height: 48px; align-items: center; gap: 10px; border-radius: 7px; padding: 7px 9px; color: #3d424a; background: #f7f8fa; }
.destination-select :deep(.v-field) { border-radius: 7px; }
.destination-select :deep(.v-field__input) { font-size: 13px; }
.untitled-hint { margin: -9px 2px 0; color: #8a8f8d; font-size: 11px; line-height: 18px; }
.no-destination { display: flex; align-items: center; gap: 10px; border: 1px solid #d9e4ff; border-radius: 7px; padding: 10px; color: #5270a3; background: #f4f7ff; }
.no-destination > span { min-width: 0; flex: 1; }
.advanced-toggle { display: flex; width: 100%; height: 32px; align-items: center; gap: 7px; border: 0; border-radius: 6px; padding: 0 8px; color: #646a73; background: transparent; cursor: pointer; font: inherit; font-size: 12px; text-align: left; }
.advanced-toggle:hover { background: #f5f6f7; }
.advanced-toggle small { margin-left: auto; color: #a0a5ac; font-size: 11px; }
.advanced-fields { display: grid; gap: 12px; margin-top: -8px; border-left: 2px solid #eef0f2; padding-left: 12px; }
.create-error { display: flex; min-height: 38px; align-items: center; gap: 8px; border-radius: 6px; padding: 7px 10px; color: #c53b37; background: #fff2f1; font-size: 12px; }
.create-actions { display: flex; min-height: 50px; align-items: center; gap: 6px; border-top: 1px solid #eef0f2; padding: 8px 12px 8px 18px; }
.create-actions :deep(.v-btn) { min-height: 30px; border-radius: 6px; letter-spacing: 0; text-transform: none; }
.shortcut-hint { display: flex; align-items: center; gap: 3px; color: #9aa0a8; font-size: 11px; }
.shortcut-hint kbd { border: 1px solid #e3e5e7; border-radius: 4px; padding: 2px 4px; color: #8a8f8d; background: #f7f8fa; box-shadow: none; font: inherit; }
@media (max-width: 560px) {
  .create-kind-grid { grid-template-columns: 1fr; }
  .shortcut-hint { display: none; }
}
</style>
