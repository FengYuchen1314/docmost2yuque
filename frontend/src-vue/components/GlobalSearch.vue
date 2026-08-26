<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDebounce } from '@vueuse/core'
import type { SearchResponse, SearchResult } from '../../src/types'
import { messageOf, post } from '../services/api'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import { searchResultDestination, searchResultTypeLabel } from '../utils/searchNavigation'
import { relativeTime } from '../utils/workbench'

const ui = useUiStore()
const session = useSessionStore()
const router = useRouter()
const query = ref('')
const debounced = useDebounce(query, 220)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const results = ref<SearchResult[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const activeIndex = ref(0)
const types = ref<SearchResult['resourceType'][]>(['PAGE', 'QUICK_NOTE', 'KNOWLEDGE_BASE', 'TEAM', 'USER', 'TEMPLATE', 'ATTACHMENT'])
let requestVersion = 0

const typeOptions: Array<{ title: string; value: SearchResult['resourceType'] }> = [
  { title: '文稿', value: 'PAGE' }, { title: '小记', value: 'QUICK_NOTE' }, { title: '知识库', value: 'KNOWLEDGE_BASE' },
  { title: '团队', value: 'TEAM' }, { title: '成员', value: 'USER' }, { title: '模板', value: 'TEMPLATE' }, { title: '附件', value: 'ATTACHMENT' },
]
const workspaceId = computed(() => session.activeWorkspace?.id ?? '')
const activeResultId = computed(() => results.value.length ? `search-result-${activeIndex.value}` : undefined)

watch([debounced, types, workspaceId], () => void search(true), { deep: true })
watch(query, (value) => {
  if (value.trim() === debounced.value.trim()) return
  ++requestVersion
  results.value = []
  activeIndex.value = 0
  nextOffset.value = 0
  hasMore.value = false
  loading.value = false
  loadingMore.value = false
  error.value = ''
})
watch(() => ui.searchOpen, (open) => {
  activeIndex.value = 0
  error.value = ''
  if (!open) {
    query.value = ''
    results.value = []
    hasMore.value = false
    ++requestVersion
  }
})

async function search(reset = false) {
  const normalized = debounced.value.trim()
  if (!ui.searchOpen || !normalized || !workspaceId.value || !types.value.length) {
    results.value = []
    hasMore.value = false
    loading.value = false
    loadingMore.value = false
    ++requestVersion
    return
  }
  if (!reset && (loading.value || loadingMore.value || !hasMore.value)) return
  const version = reset ? ++requestVersion : requestVersion
  const offset = reset ? 0 : nextOffset.value
  if (reset) {
    loading.value = true
    loadingMore.value = false
    results.value = []
    activeIndex.value = 0
    nextOffset.value = 0
    hasMore.value = false
  }
  else loadingMore.value = true
  error.value = ''
  try {
    const response = await post<SearchResponse>('/api/v1/search', {
      workspaceId: workspaceId.value,
      query: normalized,
      resourceTypes: types.value,
      knowledgeBaseId: null,
      creatorId: null,
      updatedFrom: null,
      updatedTo: null,
      offset,
      limit: 40,
    })
    if (version !== requestVersion || normalized !== query.value.trim()) return
    results.value = reset ? response.results : deduplicate([...results.value, ...response.results])
    nextOffset.value = response.nextOffset
    hasMore.value = response.hasMore
    activeIndex.value = reset ? 0 : Math.min(activeIndex.value, Math.max(0, results.value.length - 1))
  } catch (value) {
    if (version === requestVersion) error.value = messageOf(value)
  } finally {
    if (version === requestVersion) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function deduplicate(values: SearchResult[]) {
  return [...new Map(values.map((item) => [item.documentId, item])).values()]
}

function icon(type: SearchResult['resourceType']) {
  return ({ PAGE: 'mdi-file-document-outline', QUICK_NOTE: 'mdi-note-text-outline', KNOWLEDGE_BASE: 'mdi-book-open-page-variant-outline', TEAM: 'mdi-account-group-outline', USER: 'mdi-account-outline', TEMPLATE: 'mdi-view-grid-plus-outline', ATTACHMENT: 'mdi-paperclip' } as const)[type]
}

async function open(result: SearchResult) {
  const destination = searchResultDestination(result, workspaceId.value)
  if (!destination) {
    ui.notify(`${searchResultTypeLabel(result.resourceType)}结果暂不支持独立打开`, 'info')
    return
  }
  ui.searchOpen = false
  await router.push(destination)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.isComposing || !results.value.length) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value + 1) % results.value.length
    scrollActiveResultIntoView()
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    activeIndex.value = (activeIndex.value - 1 + results.value.length) % results.value.length
    scrollActiveResultIntoView()
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const selected = results.value[activeIndex.value]
    if (selected) void open(selected)
  }
}

function scrollActiveResultIntoView() {
  void nextTick(() => document.getElementById(activeResultId.value ?? '')?.scrollIntoView({ block: 'nearest' }))
}
</script>

<template>
  <v-dialog v-model="ui.searchOpen" max-width="820" scrollable>
    <v-card>
      <v-toolbar color="surface" flat><v-icon class="ml-5">mdi-magnify</v-icon><v-text-field v-model="query" autofocus placeholder="搜索文稿、小记、成员或附件…" variant="plain" hide-details class="mx-3" aria-label="搜索工作区" aria-controls="global-search-results" :aria-activedescendant="activeResultId" @keydown="handleKeydown" /><v-btn icon="mdi-close" aria-label="关闭搜索" @click="ui.searchOpen = false" /></v-toolbar>
      <v-divider />
      <div class="type-filters px-5 py-3"><span>筛选</span><v-chip-group v-model="types" multiple selected-class="text-primary"><v-chip v-for="option in typeOptions" :key="option.value" :value="option.value" filter size="small" variant="tonal">{{ option.title }}</v-chip></v-chip-group></div>
      <v-divider />
      <div class="search-results">
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <v-alert v-if="error" type="error" variant="tonal" class="ma-4"><div class="retry-row"><span>{{ error }}</span><v-btn size="small" variant="text" @click="search(true)">重试</v-btn></div></v-alert>
        <div v-if="!query.trim()" class="empty-state"><div><v-icon size="44">mdi-text-search</v-icon><h3>搜索整个工作区</h3><p>输入关键词后，可用方向键选择、Enter 打开。</p></div></div>
        <div v-else-if="!loading && !error && !results.length" class="empty-state"><div><v-icon size="44">mdi-file-search-outline</v-icon><h3>没有找到匹配内容</h3><p>尝试缩短关键词或选择更多类型。</p></div></div>
        <v-list v-else id="global-search-results" lines="three" class="pa-2" role="listbox" aria-label="搜索结果">
          <v-list-item v-for="(item, index) in results" :id="`search-result-${index}`" :key="item.documentId" :active="index === activeIndex" :prepend-icon="icon(item.resourceType)" :title="item.title" rounded="lg" role="option" :aria-selected="index === activeIndex" @mouseenter="activeIndex = index" @click="open(item)">
            <template #subtitle><span>{{ item.snippet || '无摘要' }}</span><small class="result-meta">{{ item.path ? `/${item.path} · ` : '' }}{{ relativeTime(item.updatedAt) }}</small></template>
            <template #append><v-chip size="x-small" variant="tonal">{{ searchResultTypeLabel(item.resourceType) }}</v-chip></template>
          </v-list-item>
        </v-list>
        <div v-if="hasMore" class="load-more"><v-btn variant="text" :loading="loadingMore" @click="search(false)">加载更多结果</v-btn></div>
      </div>
      <v-divider /><v-card-actions class="px-5 text-caption text-medium-emphasis">↑ / ↓ 选择 · Enter 打开 · Esc 关闭</v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.type-filters { display: flex; align-items: center; gap: 12px; overflow-x: auto; }
.type-filters > span { color: rgba(var(--v-theme-on-surface), .55); font-size: 12px; }
.search-results { min-height: 340px; max-height: 58vh; overflow: auto; }
.result-meta { display: block; margin-top: 3px; color: rgba(var(--v-theme-on-surface), .46); }
.retry-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.load-more { display: flex; justify-content: center; padding: 8px 16px 18px; }
</style>
