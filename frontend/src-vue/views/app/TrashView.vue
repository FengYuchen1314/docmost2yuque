<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { TrashItem, TrashPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'

const ui = useUiStore()
const searchInput = ref('')
const appliedQuery = ref('')
const items = ref<TrashItem[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const selectedIds = ref<string[]>([])
const restoring = ref(false)
const error = ref('')

const deleteTargets = ref<TrashItem[]>([])
const deleteDialogOpen = ref(false)
const deleteConfirmation = ref('')
const deleting = ref(false)
const deleteError = ref('')
let trashRequestVersion = 0

const selectedItems = computed(() => items.value.filter((item) => selectedIds.value.includes(item.id)))
const allSelected = computed(() => items.value.length > 0 && items.value.every((item) => selectedIds.value.includes(item.id)))
const canRestoreSelected = computed(() => selectedItems.value.length > 0 && selectedItems.value.every((item) => item.restoreAllowed))
const canDeleteSelected = computed(() => selectedItems.value.length > 0 && selectedItems.value.every((item) => item.deleteAllowed))
const displayedCount = computed(() => `${items.value.length}${hasMore.value ? '+' : ''}`)
const deletePhrase = computed(() => {
  if (deleteTargets.value.length === 1) return deleteTargets.value[0]?.title ?? ''
  return `永久删除 ${deleteTargets.value.length} 项`
})

onMounted(() => void loadTrash(true))

async function loadTrash(reset = false) {
  const requestVersion = reset ? ++trashRequestVersion : trashRequestVersion
  if (reset) {
    loading.value = true
    selectedIds.value = []
  } else {
    if (loading.value || !hasMore.value || loadingMore.value) return
    loadingMore.value = true
  }
  error.value = ''
  const offset = reset ? 0 : nextOffset.value
  try {
    const page = await post<TrashPage>('/api/v1/pages/trash/page', {
      query: appliedQuery.value || null,
      offset,
      limit: 25,
    })
    if (requestVersion !== trashRequestVersion) return
    items.value = reset ? page.items : deduplicate([...items.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (requestVersion === trashRequestVersion) error.value = messageOf(value)
  } finally {
    if (requestVersion === trashRequestVersion) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

function applySearch() {
  appliedQuery.value = searchInput.value.trim().slice(0, 200)
  void loadTrash(true)
}

function clearSearch() {
  searchInput.value = ''
  if (appliedQuery.value) {
    appliedQuery.value = ''
    void loadTrash(true)
  }
}

function toggleSelected(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id]
}

function toggleAll() {
  if (allSelected.value) {
    const loadedIds = new Set(items.value.map((item) => item.id))
    selectedIds.value = selectedIds.value.filter((id) => !loadedIds.has(id))
  } else {
    selectedIds.value = [...new Set([...selectedIds.value, ...items.value.map((item) => item.id)])]
  }
}

async function restorePages(targets: TrashItem[]) {
  if (!targets.length || targets.some((item) => !item.restoreAllowed) || restoring.value) return
  restoring.value = true
  error.value = ''
  const pageIds = targets.map((item) => item.id)
  try {
    await post('/api/v1/pages/restore-batch', { pageIds })
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.includes(id))
    await loadTrash(true)
    ui.notify(pageIds.length === 1 ? '文稿已恢复' : `已恢复 ${pageIds.length} 项内容`)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    restoring.value = false
  }
}

function openDeleteDialog(targets: TrashItem[]) {
  if (!targets.length || targets.some((item) => !item.deleteAllowed)) return
  deleteTargets.value = [...targets]
  deleteConfirmation.value = ''
  deleteError.value = ''
  deleteDialogOpen.value = true
}

function closeDeleteDialog() {
  if (deleting.value) return
  deleteDialogOpen.value = false
  deleteTargets.value = []
  deleteConfirmation.value = ''
  deleteError.value = ''
}

async function permanentlyDelete() {
  if (
    deleting.value
    || !deleteTargets.value.length
    || deleteConfirmation.value !== deletePhrase.value
  ) return
  deleting.value = true
  deleteError.value = ''
  const pageIds = deleteTargets.value.map((item) => item.id)
  try {
    await post<void>('/api/v1/pages/delete-permanently-batch', { pageIds })
    deleteDialogOpen.value = false
    deleteTargets.value = []
    deleteConfirmation.value = ''
    selectedIds.value = selectedIds.value.filter((id) => !pageIds.includes(id))
    await loadTrash(true)
    ui.notify(pageIds.length === 1 ? '内容已永久删除' : `已永久删除 ${pageIds.length} 项内容`)
  } catch (value) {
    deleteError.value = messageOf(value)
  } finally {
    deleting.value = false
  }
}

function deduplicate(values: TrashItem[]) {
  return [...new Map(values.map((item) => [item.id, item])).values()]
}

function contentTypeName(type: TrashItem['contentType']) {
  return {
    DOCUMENT: '文档',
    WHITEBOARD: '画板',
    SPREADSHEET: '电子表格',
    DATABASE: '数据表',
  }[type]
}

function contentTypeIcon(type: TrashItem['contentType']) {
  return {
    DOCUMENT: 'mdi-file-document-outline',
    WHITEBOARD: 'mdi-drawing-box',
    SPREADSHEET: 'mdi-table-large',
    DATABASE: 'mdi-database-outline',
  }[type]
}

function displayPath(path: string) {
  return `/${path.replace(/^\/+/, '')}`
}

function deletedBy(item: TrashItem) {
  return item.deletedByName || item.deletedByEmail || '未知用户'
}

function relativeTime(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return value
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  const days = Math.floor(minutes / 1_440)
  if (days < 7) return `${days} 天前`
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <main class="trash-page">
    <header class="trash-header">
      <div>
        <h1>回收站</h1>
        <p>删除的内容会保留在这里，恢复后仍位于原知识库。</p>
      </div>
    </header>

    <div class="trash-body">
    <section class="trash-toolbar">
      <form class="search-form" role="search" @submit.prevent="applySearch">
        <v-text-field
          v-model="searchInput"
          label="搜索回收站"
          placeholder="搜索文稿、知识库或空间…"
          prepend-inner-icon="mdi-magnify"
          :append-inner-icon="searchInput ? 'mdi-close' : undefined"
          variant="outlined"
          density="compact"
          hide-details
          maxlength="200"
          @click:append-inner="clearSearch"
        />
        <v-btn type="submit" variant="tonal" color="primary" size="small">搜索</v-btn>
      </form>
      <span class="result-count"><strong>{{ displayedCount }}</strong> 项</span>
    </section>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="trash-error" @click:close="error = ''">
      <div class="d-flex align-center flex-wrap ga-2">
        <span>{{ error }}</span>
        <v-btn size="small" variant="text" @click="loadTrash(true)">重试</v-btn>
      </div>
    </v-alert>

    <v-card v-if="items.length" class="batch-card" variant="flat">
      <v-checkbox-btn
        :model-value="allSelected"
        color="primary"
        :aria-label="allSelected ? '取消选择当前已加载内容' : '选择当前已加载内容'"
        @update:model-value="toggleAll"
      />
      <div class="batch-copy">
        <strong>{{ selectedItems.length ? `已选择 ${selectedItems.length} 项` : '选择当前已加载内容' }}</strong>
        <span>可批量恢复或永久删除</span>
      </div>
      <v-spacer />
      <v-btn
        variant="text"
        size="small"
        prepend-icon="mdi-restore"
        :disabled="!canRestoreSelected"
        :loading="restoring"
        @click="restorePages(selectedItems)"
      >
        批量恢复
      </v-btn>
      <v-btn
        color="error"
        variant="text"
        size="small"
        prepend-icon="mdi-delete-forever-outline"
        :disabled="!canDeleteSelected"
        @click="openDeleteDialog(selectedItems)"
      >
        永久删除
      </v-btn>
    </v-card>

    <v-card class="trash-list-card" variant="flat">
      <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />

      <div v-if="!loading && items.length" class="trash-list">
        <article
          v-for="item in items"
          :key="item.id"
          class="trash-item"
          :class="{ selected: selectedIds.includes(item.id) }"
        >
          <v-checkbox-btn
            :model-value="selectedIds.includes(item.id)"
            color="primary"
            :aria-label="`选择 ${item.title}`"
            @update:model-value="toggleSelected(item.id)"
          />

          <v-avatar color="primary" variant="tonal" rounded="lg" size="36" class="resource-icon">
            <span v-if="item.knowledgeBaseIcon" class="kb-icon">{{ item.knowledgeBaseIcon }}</span>
            <v-icon v-else size="21">{{ contentTypeIcon(item.contentType) }}</v-icon>
          </v-avatar>

          <div class="trash-main">
            <div class="trash-title-row">
              <strong>{{ item.title }}</strong>
              <v-chip size="x-small" variant="tonal">{{ contentTypeName(item.contentType) }}</v-chip>
            </div>
            <p>{{ item.workspaceName }} / {{ item.knowledgeBaseName }} · {{ displayPath(item.path) }}</p>
            <small>
              {{ deletedBy(item) }}<template v-if="item.deletedByEmail && item.deletedByName">（{{ item.deletedByEmail }}）</template>
              于 <time :datetime="item.deletedAt">{{ relativeTime(item.deletedAt) }}</time>删除
            </small>
          </div>

          <div class="trash-actions">
            <v-btn
              size="small"
              variant="text"
              prepend-icon="mdi-restore"
              :disabled="!item.restoreAllowed"
              :loading="restoring"
              :title="item.restoreAllowed ? '恢复到原知识库和原路径' : '你没有恢复此内容的权限'"
              @click="restorePages([item])"
            >
              恢复
            </v-btn>
            <v-btn
              icon="mdi-delete-forever-outline"
              size="small"
              color="error"
              variant="text"
              :disabled="!item.deleteAllowed"
              :aria-label="`永久删除 ${item.title}`"
              :title="item.deleteAllowed ? '永久删除' : '你没有永久删除此内容的权限'"
              @click="openDeleteDialog([item])"
            />
          </div>
        </article>

        <div v-if="hasMore" class="load-more">
          <v-btn
            variant="text"
            size="small"
            prepend-icon="mdi-chevron-down"
            :loading="loadingMore"
            @click="loadTrash(false)"
          >
            加载更多
          </v-btn>
        </div>
      </div>

      <div v-else-if="!loading && !error" class="trash-empty">
        <div>
          <v-icon size="38">mdi-delete-empty-outline</v-icon>
          <h3>{{ appliedQuery ? '没有匹配的已删除内容' : '回收站是空的' }}</h3>
          <p>{{ appliedQuery ? '换一个关键词，或清空搜索条件。' : '你有权管理的已删除文稿会出现在这里。' }}</p>
          <v-btn v-if="appliedQuery" variant="tonal" class="mt-4" @click="clearSearch">清空搜索</v-btn>
        </div>
      </div>
    </v-card>
    </div>

    <v-dialog
      v-model="deleteDialogOpen"
      max-width="520"
      persistent
      @after-leave="deleteConfirmation = ''; deleteError = ''"
    >
      <v-card class="delete-dialog" rounded="lg">
        <v-card-title class="delete-heading">
          <v-avatar color="error" variant="tonal" size="36">
            <v-icon>mdi-alert-octagon-outline</v-icon>
          </v-avatar>
          <div>
            <div class="danger-eyebrow">不可撤销</div>
            <h2>{{ deleteTargets.length === 1 ? `永久删除“${deleteTargets[0]?.title}”` : `永久删除 ${deleteTargets.length} 项内容` }}</h2>
          </div>
          <v-spacer />
          <v-btn icon="mdi-close" size="small" variant="text" :disabled="deleting" aria-label="关闭" @click="closeDeleteDialog" />
        </v-card-title>

        <v-card-text>
          <v-alert type="error" variant="tonal" density="compact" icon="mdi-delete-alert-outline" class="mb-4">
            正文、历史版本、发布快照和关联数据将一并删除，且无法恢复。
          </v-alert>

          <div class="delete-preview mb-5">
            <div v-for="item in deleteTargets.slice(0, 5)" :key="item.id">
              <strong>{{ item.title }}</strong>
              <small>{{ item.workspaceName }} / {{ item.knowledgeBaseName }}</small>
            </div>
            <span v-if="deleteTargets.length > 5">另有 {{ deleteTargets.length - 5 }} 项</span>
          </div>

          <p class="confirm-instruction">
            输入 <strong>{{ deletePhrase }}</strong> 确认
          </p>
          <v-text-field
            v-model="deleteConfirmation"
            label="永久删除确认文字"
            variant="outlined"
            density="compact"
            autocomplete="off"
            :disabled="deleting"
            autofocus
            hide-details="auto"
            @keydown.enter="permanentlyDelete"
          />
          <v-alert v-if="deleteError" type="error" variant="tonal" density="compact" class="mt-4">{{ deleteError }}</v-alert>
        </v-card-text>

        <v-card-actions class="delete-actions">
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="closeDeleteDialog">取消</v-btn>
          <v-btn
            color="error"
            variant="flat"
            prepend-icon="mdi-delete-forever-outline"
            :disabled="deleteConfirmation !== deletePhrase"
            :loading="deleting"
            @click="permanentlyDelete"
          >
            确认永久删除
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.trash-page { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.trash-page :deep(.v-btn) { text-transform: none; letter-spacing: 0; }
.trash-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; }
.trash-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.trash-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.trash-body { width: min(940px, calc(100% - 48px)); margin: 18px auto 64px; }
.trash-toolbar { padding-bottom: 13px; border-bottom: 1px solid #e7e9e8; display: flex; align-items: center; gap: 12px; }
.search-form { min-width: 0; max-width: 620px; display: flex; flex: 1; align-items: center; gap: 8px; }
.search-form :deep(.v-field) { border-radius: 6px; }
.search-form :deep(.v-btn) { height: 32px; border-radius: 5px; }
.result-count { color: #969c99; font-size: 11px; white-space: nowrap; }
.result-count strong { color: #5e6561; }
.trash-error { margin: 12px 0; }
.batch-card { min-height: 44px; margin: 12px 0 6px; padding: 5px 8px; border: 1px solid #d9e5fa !important; border-radius: 6px !important; display: flex; align-items: center; gap: 7px; background: #f7f9fd !important; box-shadow: none !important; }
.batch-copy { display: flex; flex-direction: column; }
.batch-copy strong { color: #4b5e78; font-size: 12px; }
.batch-copy span { color: #8792a0; font-size: 10px; }
.trash-list-card { min-height: 300px; overflow: hidden; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; background: transparent !important; }
.trash-list { padding: 0; }
.trash-item { position: relative; min-height: 68px; padding: 9px 6px; border-radius: 4px; display: flex; align-items: center; gap: 9px; transition: background-color .12s; }
.trash-item:hover, .trash-item.selected { background: #f7f8f7; }
.trash-item + .trash-item::before { position: absolute; top: 0; right: 12px; left: 61px; height: 1px; background: #eceeed; content: ''; }
.resource-icon { flex: 0 0 auto; border-radius: 5px !important; }
.kb-icon { font-size: 1rem; line-height: 1; }
.trash-main { min-width: 0; flex: 1; }
.trash-title-row { min-width: 0; display: flex; align-items: center; gap: 7px; }
.trash-title-row strong { overflow: hidden; color: #3c433f; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.trash-main p { margin: 2px 0 1px; overflow: hidden; color: #858c88; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.trash-main small { color: #a0a6a3; font-size: 10px; }
.trash-actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; opacity: 0; }
.trash-item:hover .trash-actions, .trash-actions:focus-within { opacity: 1; }
.load-more { padding: 18px 12px 12px; display: flex; justify-content: center; }
.trash-empty { min-height: 340px; display: grid; place-content: center; color: #adb2af; text-align: center; }
.trash-empty h3 { margin: 12px 0 4px; color: #606763; font-size: 15px; font-weight: 600; }
.trash-empty p { margin: 0; color: #979d9a; font-size: 12px; }
.delete-dialog { border-radius: 10px !important; }
.delete-heading { min-height: 68px; padding: 12px 12px 10px 20px; display: flex; align-items: center; gap: 11px; white-space: normal; }
.delete-heading h2 { margin: 0; font-size: 16px; line-height: 1.35; }
.danger-eyebrow { margin-bottom: 1px; color: #d33b35; font-size: 10px; font-weight: 700; letter-spacing: .06em; }
.delete-dialog :deep(.v-card-text) { padding: 10px 22px 4px; }
.delete-preview { overflow: hidden; border: 1px solid #e2e5e3; border-radius: 7px; }
.delete-preview > div { padding: 8px 11px; display: flex; flex-direction: column; gap: 1px; }
.delete-preview > div + div { border-top: 1px solid #eceeed; }
.delete-preview strong { overflow: hidden; color: #444b47; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.delete-preview small { color: #929895; font-size: 10px; }
.delete-preview > span { padding: 7px 11px; border-top: 1px solid #eceeed; display: block; color: #858c88; font-size: 11px; }
.confirm-instruction { margin: 0 0 7px; color: #737a76; font-size: 12px; }
.confirm-instruction strong { color: #d14343; }
.delete-actions { padding: 12px 16px 16px; }

@media (max-width: 720px) {
  .trash-page { margin: -16px; }
  .trash-header { padding: 0 18px; }
  .trash-body { width: calc(100% - 24px); margin-top: 12px; }
  .trash-toolbar { align-items: stretch; flex-direction: column; gap: 7px; }
  .result-count { align-self: flex-end; }
  .batch-card { align-items: flex-start; flex-wrap: wrap; }
  .batch-card :deep(.v-spacer) { display: none; }
  .batch-copy { min-width: calc(100% - 42px); }
  .trash-item { align-items: flex-start; flex-wrap: wrap; }
  .resource-icon { display: none; }
  .trash-main { min-width: calc(100% - 45px); }
  .trash-actions { width: 100%; padding-left: 37px; justify-content: flex-end; opacity: 1; }
  .trash-item + .trash-item::before { left: 10px; }
}
@media (max-width: 520px) {
  .search-form { align-items: stretch; flex-direction: column; }
  .search-form .v-btn { width: 100%; }
  .batch-card > .v-btn { flex: 1; }
  .trash-item { padding: 12px 5px; }
  .delete-heading > .v-avatar { display: none; }
}
</style>
