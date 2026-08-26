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

function icon(result: SearchResult) {
  if (result.resourceType === 'PAGE') {
    return ({ WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' } as Record<string, string>)[result.contentType ?? ''] ?? 'mdi-file-document-outline'
  }
  return ({ QUICK_NOTE: 'mdi-note-text-outline', KNOWLEDGE_BASE: 'mdi-book-open-page-variant-outline', TEAM: 'mdi-account-group-outline', USER: 'mdi-account-outline', TEMPLATE: 'mdi-view-grid-plus-outline', ATTACHMENT: 'mdi-paperclip' } as const)[result.resourceType]
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
  <v-dialog v-model="ui.searchOpen" max-width="680" scrollable content-class="search-dialog-overlay">
    <v-card class="search-palette" rounded="lg">
      <div class="search-input-row">
        <v-icon size="20">mdi-magnify</v-icon>
        <v-text-field
          v-model="query"
          autofocus
          placeholder="搜索文稿、知识库、小记或成员"
          variant="plain"
          hide-details
          aria-label="搜索工作区"
          aria-controls="global-search-results"
          :aria-activedescendant="activeResultId"
          @keydown="handleKeydown"
        />
        <kbd>Esc</kbd>
        <v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭搜索" @click="ui.searchOpen = false" />
      </div>
      <div class="type-filters">
        <span>范围</span>
        <v-chip-group v-model="types" multiple selected-class="filter-selected">
          <v-chip v-for="option in typeOptions" :key="option.value" :value="option.value" size="small" variant="text">{{ option.title }}</v-chip>
        </v-chip-group>
      </div>
      <div class="search-results">
        <v-progress-linear v-if="loading" indeterminate color="primary" height="2" class="search-progress" />
        <div v-if="error" class="search-error" role="alert"><v-icon size="18">mdi-alert-circle-outline</v-icon><span>{{ error }}</span><v-btn size="small" variant="text" @click="search(true)">重试</v-btn></div>
        <div v-if="!query.trim()" class="search-placeholder">
          <v-icon size="28">mdi-text-search-variant</v-icon>
          <strong>搜索当前工作区</strong>
          <span>输入标题、正文内容、成员或附件名称</span>
        </div>
        <div v-else-if="!loading && !error && !results.length" class="search-placeholder">
          <v-icon size="28">mdi-file-search-outline</v-icon>
          <strong>没有找到相关内容</strong>
          <span>试试缩短关键词，或选择更多搜索范围</span>
        </div>
        <v-list v-else id="global-search-results" density="compact" class="result-list" role="listbox" aria-label="搜索结果">
          <v-list-item v-for="(item, index) in results" :id="`search-result-${index}`" :key="item.documentId" :active="index === activeIndex" rounded="lg" role="option" :aria-selected="index === activeIndex" @mouseenter="activeIndex = index" @click="open(item)">
            <template #prepend><span class="result-icon"><v-icon size="18">{{ icon(item) }}</v-icon></span></template>
            <div class="result-copy">
              <div class="result-title"><strong>{{ item.title }}</strong><span>{{ searchResultTypeLabel(item.resourceType) }}</span></div>
              <div class="result-subtitle"><span>{{ item.snippet || '无摘要' }}</span><small>{{ item.path ? `/${item.path} · ` : '' }}{{ relativeTime(item.updatedAt) }}</small></div>
            </div>
            <template #append><v-icon class="result-enter" size="16">mdi-keyboard-return</v-icon></template>
          </v-list-item>
        </v-list>
        <div v-if="hasMore" class="load-more"><v-btn size="small" variant="text" :loading="loadingMore" @click="search(false)">加载更多</v-btn></div>
      </div>
      <footer class="search-footer"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span class="workspace-name">{{ session.activeWorkspace?.name || '当前工作区' }}</span></footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.search-palette { overflow: hidden; border: 1px solid #e3e5e7; background: #fff; box-shadow: 0 20px 56px rgb(31 35 41 / 18%) !important; }
.search-input-row { display: flex; height: 52px; align-items: center; gap: 10px; padding: 0 10px 0 16px; border-bottom: 1px solid #eef0f2; color: #646a73; }
.search-input-row :deep(.v-field__input) { min-height: 50px; padding: 0; color: #262626; font-size: 15px; }
.search-input-row :deep(.v-field__input)::placeholder { color: #9aa0a8; opacity: 1; }
.search-input-row > kbd,
.search-footer kbd { border: 1px solid #e3e5e7; border-radius: 4px; padding: 2px 5px; color: #8a8f8d; background: #f7f8fa; box-shadow: none; font: 11px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.type-filters { display: flex; height: 42px; align-items: center; gap: 8px; overflow-x: auto; border-bottom: 1px solid #eef0f2; padding: 0 12px 0 16px; scrollbar-width: none; }
.type-filters::-webkit-scrollbar { display: none; }
.type-filters > span { flex: 0 0 auto; color: #8a8f8d; font-size: 12px; }
.type-filters :deep(.v-chip-group) { overflow: visible; padding: 0; }
.type-filters :deep(.v-chip) { height: 26px; padding-inline: 8px; border-radius: 5px; color: #646a73; font-size: 12px; }
.type-filters :deep(.v-chip:hover) { background: #f1f2f2; }
.type-filters :deep(.filter-selected) { color: #2468f2; background: #eef3ff; }
.search-results { position: relative; min-height: 260px; max-height: min(520px, 60vh); overflow: auto; }
.search-progress { position: sticky; top: 0; z-index: 2; }
.search-error { display: flex; min-height: 42px; align-items: center; gap: 8px; margin: 10px 12px 0; border-radius: 6px; padding: 5px 8px 5px 10px; color: #c53b37; background: #fff2f1; font-size: 13px; }
.search-error span { min-width: 0; flex: 1; }
.search-placeholder { display: flex; min-height: 260px; align-items: center; justify-content: center; flex-direction: column; color: #9aa0a8; text-align: center; }
.search-placeholder strong { margin-top: 12px; color: #646a73; font-size: 14px; font-weight: 500; }
.search-placeholder span { margin-top: 5px; font-size: 12px; }
.result-list { padding: 6px; }
.result-list :deep(.v-list-item) { min-height: 58px; margin: 1px 0; padding: 7px 10px; border-radius: 6px !important; }
.result-list :deep(.v-list-item:hover),
.result-list :deep(.v-list-item--active) { background: #f1f3f5; }
.result-list :deep(.v-list-item--active .v-list-item__overlay) { opacity: 0; }
.result-list :deep(.v-list-item__prepend) { align-self: center; padding-right: 10px; }
.result-list :deep(.v-list-item__append) { align-self: center; }
.result-icon { display: inline-grid; width: 30px; height: 30px; place-items: center; border-radius: 6px; color: #5b6f91; background: #f0f3f7; }
.result-copy { min-width: 0; }
.result-title { display: flex; align-items: center; gap: 8px; }
.result-title strong { overflow: hidden; color: #262626; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.result-title span { flex: 0 0 auto; color: #9aa0a8; font-size: 11px; }
.result-subtitle { display: flex; min-width: 0; gap: 8px; margin-top: 3px; color: #8a8f8d; font-size: 12px; }
.result-subtitle > span { overflow: hidden; flex: 1; text-overflow: ellipsis; white-space: nowrap; }
.result-subtitle small { flex: 0 0 auto; color: #a0a5ac; font-size: 11px; }
.result-enter { color: #b0b4ba; opacity: 0; }
.result-list :deep(.v-list-item--active) .result-enter { opacity: 1; }
.load-more { display: flex; justify-content: center; padding: 5px 16px 12px; }
.search-footer { display: flex; height: 34px; align-items: center; gap: 14px; border-top: 1px solid #eef0f2; padding: 0 12px; color: #8a8f8d; font-size: 11px; }
.search-footer > span { display: flex; align-items: center; gap: 4px; }
.search-footer .workspace-name { overflow: hidden; min-width: 0; margin-left: auto; text-overflow: ellipsis; white-space: nowrap; }
@media (max-width: 560px) {
  .search-input-row > kbd { display: none; }
  .search-results { max-height: 62vh; }
  .result-subtitle small { display: none; }
}
</style>
