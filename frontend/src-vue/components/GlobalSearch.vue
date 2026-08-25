<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounce } from '@vueuse/core'
import type { SearchResponse, SearchResult } from '../../src/types'
import { messageOf, post } from '../services/api'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'

const ui = useUiStore(); const session = useSessionStore(); const router = useRouter()
const query = ref(''); const debounced = useDebounce(query, 220)
const loading = ref(false); const error = ref(''); const results = ref<SearchResult[]>([])
const types = ref(['PAGE', 'QUICK_NOTE', 'KNOWLEDGE_BASE', 'TEAM', 'USER', 'TEMPLATE', 'ATTACHMENT'])
const typeOptions = [{ title: '文稿', value: 'PAGE' }, { title: '小记', value: 'QUICK_NOTE' }, { title: '知识库', value: 'KNOWLEDGE_BASE' }, { title: '团队', value: 'TEAM' }, { title: '成员', value: 'USER' }, { title: '模板', value: 'TEMPLATE' }, { title: '附件', value: 'ATTACHMENT' }]
const workspaceId = computed(() => session.activeWorkspace?.id ?? '')

watch([debounced, types, workspaceId], async () => {
  if (!ui.searchOpen || !debounced.value.trim() || !workspaceId.value || !types.value.length) { results.value = []; return }
  loading.value = true; error.value = ''
  try {
    const response = await post<SearchResponse>('/api/v1/search', { workspaceId: workspaceId.value, query: debounced.value.trim(), resourceTypes: types.value, knowledgeBaseId: null, creatorId: null, updatedFrom: null, updatedTo: null, offset: 0, limit: 40 })
    results.value = response.results
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}, { deep: true })

function icon(type: string) { return ({ PAGE: 'mdi-file-document-outline', QUICK_NOTE: 'mdi-note-text-outline', KNOWLEDGE_BASE: 'mdi-book-open-page-variant-outline', TEAM: 'mdi-account-group-outline', USER: 'mdi-account-outline', TEMPLATE: 'mdi-view-grid-plus-outline', ATTACHMENT: 'mdi-paperclip' } as Record<string, string>)[type] ?? 'mdi-magnify' }
async function open(result: SearchResult) {
  ui.searchOpen = false
  if (result.resourceType === 'PAGE' && result.knowledgeBaseId) await router.push(`/app/kb/${result.knowledgeBaseId}/pages/${result.resourceId}`)
  else if (result.resourceType === 'QUICK_NOTE') await router.push(`/app/notes?open=${result.resourceId}`)
  else if (result.resourceType === 'KNOWLEDGE_BASE') await router.push(`/app/kb/${result.resourceId}`)
  else if (result.resourceType === 'TEMPLATE') await router.push('/app/templates')
  else await router.push(`/app/w/${workspaceId.value}`)
}
</script>

<template>
  <v-dialog v-model="ui.searchOpen" max-width="820" scrollable>
    <v-card>
      <v-toolbar color="surface" flat><v-icon class="ml-5">mdi-magnify</v-icon><v-text-field v-model="query" autofocus placeholder="搜索文稿、小记、成员或附件…" variant="plain" hide-details class="mx-3" /><v-btn icon="mdi-close" @click="ui.searchOpen = false" /></v-toolbar>
      <v-divider />
      <v-card-text class="py-3"><v-select v-model="types" :items="typeOptions" label="结果类型" multiple chips closable-chips /></v-card-text>
      <v-divider />
      <div style="min-height:340px;max-height:58vh;overflow:auto">
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <v-alert v-if="error" type="error" variant="tonal" class="ma-4">{{ error }}</v-alert>
        <div v-if="!query.trim()" class="empty-state"><div><v-icon size="44">mdi-text-search</v-icon><h3>搜索整个工作区</h3><p>结果会自动按当前账号权限过滤。</p></div></div>
        <div v-else-if="!loading && !results.length" class="empty-state"><div><v-icon size="44">mdi-file-search-outline</v-icon><h3>没有找到匹配内容</h3><p>尝试缩短关键词或选择更多类型。</p></div></div>
        <v-list v-else lines="three" class="pa-2">
          <v-list-item v-for="item in results" :key="item.documentId" :prepend-icon="icon(item.resourceType)" :title="item.title" :subtitle="item.snippet || '无摘要'" rounded="lg" @click="open(item)">
            <template #append><v-chip size="x-small" variant="tonal">{{ item.resourceType }}</v-chip></template>
          </v-list-item>
        </v-list>
      </div>
      <v-divider /><v-card-actions class="px-5 text-caption text-medium-emphasis">Ctrl / ⌘ + K 打开 · Esc 关闭</v-card-actions>
    </v-card>
  </v-dialog>
</template>
