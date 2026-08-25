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
const loading = ref(false); const error = ref('')
const kinds = [
  { title: '文档', value: 'DOCUMENT', icon: 'mdi-file-document-outline' },
  { title: '白板', value: 'WHITEBOARD', icon: 'mdi-drawing-box' },
  { title: '电子表格', value: 'SPREADSHEET', icon: 'mdi-table-large' },
  { title: '数据表', value: 'DATABASE', icon: 'mdi-database-outline' },
  { title: '知识库', value: 'KNOWLEDGE_BASE', icon: 'mdi-book-plus-outline' },
  { title: '组织空间', value: 'WORKSPACE', icon: 'mdi-domain-plus' },
]
const needsKnowledgeBase = computed(() => kindNeedsKnowledgeBase(form.kind))
const createEnabled = computed(() => canCreateResource(form))
watch(() => ui.createOpen, () => { resetCreateResourceDraft(form, session.activeKnowledgeBases[0]?.id ?? ''); error.value = '' })
watch(() => form.title, (title) => { form.slug = slugify(title) })
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) }
async function create() {
  loading.value = true; error.value = ''
  try {
    if (form.kind === 'WORKSPACE') {
      const workspace = await post<{ id: string }>('/api/v1/workspaces/create', { name: form.title })
      await session.loadNavigation(); ui.createOpen = false; await router.push(`/app/w/${workspace.id}`)
    } else if (form.kind === 'KNOWLEDGE_BASE') {
      const workspaceId = session.activeWorkspace?.id
      if (!workspaceId) throw new Error('请先选择工作区')
      const kb = await post<KnowledgeBase>('/api/v1/knowledge-bases/create', { workspaceId, name: form.title, slug: form.slug, ownerType: 'WORKSPACE', ownerId: workspaceId, visibility: 'PRIVATE', publishMode: 'MANUAL' })
      await session.loadNavigation(); ui.createOpen = false; await router.push(`/app/kb/${kb.id}`)
    } else {
      const kind = form.kind as Exclude<ResourceKind, 'KNOWLEDGE_BASE' | 'WORKSPACE'>
      const page = await post<Page>('/api/v1/pages/create', { knowledgeBaseId: form.knowledgeBaseId, title: resourceTitle(kind, form.title), path: form.slug || `untitled-${Date.now()}`, contentType: kind })
      ui.createOpen = false; await router.push(`/app/kb/${page.knowledgeBaseId}/pages/${page.id}`)
    }
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
</script>

<template>
  <v-dialog v-model="ui.createOpen">
    <v-card><v-card-title class="d-flex align-center pa-6"><span>新建内容</span><v-spacer /><v-btn icon="mdi-close" variant="text" @click="ui.createOpen = false" /></v-card-title>
      <v-card-text class="px-6 pb-2">
        <v-item-group v-model="form.kind" mandatory class="surface-grid mb-5">
          <v-item v-for="kind in kinds" :key="kind.value" v-slot="{ isSelected, toggle }" :value="kind.value"><v-card class="section-card clickable pa-4" :color="isSelected ? 'primary' : undefined" :variant="isSelected ? 'tonal' : 'flat'" @click="toggle"><v-icon class="mr-2">{{ kind.icon }}</v-icon><strong>{{ kind.title }}</strong></v-card></v-item>
        </v-item-group>
        <v-select v-if="needsKnowledgeBase" v-model="form.knowledgeBaseId" :items="session.activeKnowledgeBases" item-title="name" item-value="id" label="保存到知识库" prepend-inner-icon="mdi-book-open-page-variant-outline" class="mb-4" />
        <v-text-field v-model="form.title" :label="form.kind === 'WORKSPACE' ? '空间名称' : form.kind === 'KNOWLEDGE_BASE' ? '知识库名称' : '标题'" autofocus class="mb-4" />
        <v-text-field v-if="form.kind !== 'WORKSPACE'" v-model="form.slug" label="访问路径" prefix="/" class="mb-4" />
        <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="pa-6 pt-4"><v-spacer /><v-btn variant="text" @click="ui.createOpen = false">取消</v-btn><v-btn color="primary" :loading="loading" :disabled="!createEnabled" @click="create">创建</v-btn></v-card-actions>
    </v-card>
  </v-dialog>
</template>
