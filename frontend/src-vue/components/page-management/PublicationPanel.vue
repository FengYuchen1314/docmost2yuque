<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { Page } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import { createUuid } from '../../utils/uuid'
import type { PagePublication, PublicationHistoryPage, PublicationState } from './types'
import { contentTypeLabel, formatDateTime } from './utils'

const props = defineProps<{ page: Page }>()
const ui = useUiStore()
const state = ref<PublicationState | null>(null)
const history = ref<PagePublication[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loadingState = ref(false)
const loadingHistory = ref(false)
const loadingMore = ref(false)
const publishing = ref(false)
const unpublishing = ref(false)
const unpublishOpen = ref(false)
const preview = ref<PagePublication | null>(null)
const error = ref('')
const publishIdempotencyKey = ref('')
const publishIntentRevision = ref<number | null>(null)
let pollTimer = 0
let historyRequestVersion = 0

const automaticBusy = computed(() => state.value?.effectivePublishMode === 'AUTO' && (state.value.automaticJobStatus === 'PENDING' || state.value.automaticJobStatus === 'RUNNING'))
const automaticFailed = computed(() => state.value?.effectivePublishMode === 'AUTO' && state.value.automaticJobStatus === 'FAILED')
const stateTitle = computed(() => {
  if (automaticBusy.value) return state.value?.automaticJobStatus === 'RUNNING' ? '正在自动发布' : '等待自动发布'
  if (automaticFailed.value) return '自动发布失败'
  if (!state.value?.published) return '尚未发布'
  return state.value.upToDate ? '线上版本已是最新' : '草稿有尚未发布的更新'
})
const stateText = computed(() => {
  const value = state.value
  if (!value) return '正在读取发布状态…'
  if (automaticBusy.value) return `系统将发布草稿版本 ${value.draftRevision}；连续编辑只保留最新版本。`
  if (automaticFailed.value) return '后台任务已达到重试上限；可以立即手动发布，或再次编辑重新排队。'
  if (value.published) return `线上来自草稿版本 ${value.publishedDraftRevision}，当前草稿版本 ${value.draftRevision}。`
  return '发布后可用于公开阅读、知识花园和分享链接。'
})

watch(() => props.page.id, () => {
  resetPublishIntent()
  void Promise.all([loadState(), loadHistory(true)])
}, { immediate: true })
watch(() => props.page.draftRevision, () => {
  resetPublishIntent()
  void loadState()
})
onBeforeUnmount(() => window.clearTimeout(pollTimer))

async function loadState() {
  loadingState.value = !state.value
  error.value = ''
  try {
    state.value = await post<PublicationState>('/api/v1/pages/publication-state', { pageId: props.page.id })
    schedulePoll()
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loadingState.value = false
  }
}

function schedulePoll() {
  window.clearTimeout(pollTimer)
  if (automaticBusy.value) pollTimer = window.setTimeout(() => void loadState(), 1_000)
}

async function loadHistory(reset = false) {
  const version = reset ? ++historyRequestVersion : historyRequestVersion
  if (reset) loadingHistory.value = true
  else {
    if (loadingHistory.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  }
  try {
    const page = await post<PublicationHistoryPage>('/api/v1/pages/publication-history/page', { pageId: props.page.id, limit: 30, offset: reset ? 0 : nextOffset.value })
    if (version !== historyRequestVersion) return
    history.value = reset ? page.items : deduplicate([...history.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (version === historyRequestVersion) error.value = messageOf(value)
  } finally {
    if (version === historyRequestVersion) {
      loadingHistory.value = false
      loadingMore.value = false
    }
  }
}

async function publish() {
  if (publishing.value || automaticBusy.value || (state.value?.published && state.value.upToDate)) return
  publishing.value = true
  error.value = ''
  if (!publishIdempotencyKey.value || publishIntentRevision.value !== props.page.draftRevision) {
    publishIntentRevision.value = props.page.draftRevision
    publishIdempotencyKey.value = `vue-${props.page.id}-${props.page.draftRevision}-${createUuid()}`
  }
  try {
    const path = state.value?.published ? '/api/v1/pages/republish' : '/api/v1/pages/publish'
    await post<PagePublication>(path, { pageId: props.page.id, idempotencyKey: publishIdempotencyKey.value })
    resetPublishIntent()
    await Promise.all([loadState(), loadHistory(true)])
    ui.notify('发布成功')
  } catch (value) {
    // Keep the key so retrying the same draft remains idempotent after a lost response.
    error.value = messageOf(value)
  } finally {
    publishing.value = false
  }
}

async function unpublish() {
  if (unpublishing.value) return
  unpublishing.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/pages/unpublish', { pageId: props.page.id })
    unpublishOpen.value = false
    resetPublishIntent()
    await Promise.all([loadState(), loadHistory(true)])
    ui.notify('当前发布版本已下线')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    unpublishing.value = false
  }
}

function resetPublishIntent() {
  publishIdempotencyKey.value = ''
  publishIntentRevision.value = null
}

function deduplicate(items: PagePublication[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function previewText(value: PagePublication) {
  if (value.plainText) return value.plainText
  try { return JSON.stringify(value.content, null, 2) } catch { return '无法显示此发布快照' }
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-avatar color="primary" variant="tonal"><v-icon>mdi-rocket-launch-outline</v-icon></v-avatar>
      <div><h2>发布管理</h2><p>发布的是不可变快照；之后编辑草稿不会悄悄改变线上内容。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loadingState" indeterminate color="primary" class="mb-5" />

    <v-card class="state-card mb-5" :color="automaticFailed ? 'error' : state?.published ? 'success' : 'primary'" variant="tonal">
      <v-card-text>
        <v-avatar :color="automaticFailed ? 'error' : state?.published ? 'success' : 'primary'" variant="flat">
          <v-progress-circular v-if="automaticBusy" indeterminate size="22" width="2" />
          <v-icon v-else>{{ automaticFailed ? 'mdi-alert-outline' : state?.published ? 'mdi-earth' : 'mdi-archive-outline' }}</v-icon>
        </v-avatar>
        <div><strong>{{ stateTitle }}</strong><p>{{ stateText }}</p></div>
        <v-btn v-if="state?.publicationId" :href="`/p/${state.publicationId}`" target="_blank" rel="noreferrer" variant="tonal" prepend-icon="mdi-open-in-new">查看线上版</v-btn>
      </v-card-text>
    </v-card>

    <div class="publication-actions mb-7">
      <v-btn color="primary" prepend-icon="mdi-rocket-launch-outline" :loading="publishing || automaticBusy" :disabled="automaticBusy || (state?.published && state.upToDate)" @click="publish">
        {{ automaticBusy ? '自动发布排队中' : state?.published ? '发布最新草稿' : '立即发布' }}
      </v-btn>
      <v-btn v-if="state?.published" color="error" variant="tonal" prepend-icon="mdi-link-off" @click="unpublishOpen = true">下线</v-btn>
    </div>

    <div class="history-heading"><h3><v-icon size="18">mdi-clock-outline</v-icon> 发布历史</h3><v-chip size="small" variant="tonal">{{ history.length }}{{ hasMore ? '+' : '' }} 条</v-chip></div>
    <v-progress-linear v-if="loadingHistory" indeterminate color="primary" class="my-4" />
    <div v-if="history.length" class="publication-history">
      <article v-for="item in history" :key="item.id">
        <v-chip :color="item.supersededAt ? undefined : 'success'" size="small" variant="tonal">{{ item.supersededAt ? '历史' : '当前' }}</v-chip>
        <div><strong>{{ item.title }}</strong><span>草稿 v{{ item.sourceDraftRevision }} · {{ formatDateTime(item.publishedAt) }} · {{ contentTypeLabel(item.contentType) }}</span></div>
        <v-btn icon="mdi-eye-outline" variant="text" :aria-label="`预览发布版本 ${item.sourceDraftRevision}`" @click="preview = item" />
      </article>
    </div>
    <div v-else-if="!loadingHistory" class="empty-box"><v-icon size="40">mdi-earth-off</v-icon><strong>尚无发布记录</strong><span>首次发布后，快照历史会保留在这里。</span></div>
    <div v-if="hasMore" class="load-more"><v-btn variant="tonal" :loading="loadingMore" @click="loadHistory(false)">加载更多发布历史</v-btn></div>

    <v-dialog v-model="unpublishOpen" max-width="520" persistent>
      <v-card><v-card-title class="px-6 pt-5">下线当前发布版本？</v-card-title><v-card-text class="px-6"><v-alert type="error" variant="tonal">下线后，公开阅读和依赖发布快照的现有分享链接将不可访问；发布历史仍会保留。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="unpublishing" @click="unpublishOpen = false">取消</v-btn><v-btn color="error" :loading="unpublishing" @click="unpublish">确认下线</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(preview)" max-width="900" scrollable @update:model-value="value => { if (!value) preview = null }">
      <v-card v-if="preview" class="preview-dialog">
        <v-toolbar flat border="bottom" class="px-3"><div><strong>发布快照 · 草稿 v{{ preview.sourceDraftRevision }}</strong><div class="preview-meta">{{ formatDateTime(preview.publishedAt) }} · schema v{{ preview.schemaVersion }}</div></div><v-spacer /><v-btn icon="mdi-close" variant="text" @click="preview = null" /></v-toolbar>
        <v-card-text><v-chip size="small" variant="tonal">{{ contentTypeLabel(preview.contentType) }}</v-chip><h1>{{ preview.title }}</h1><pre>{{ previewText(preview) }}</pre></v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { max-width: 980px; margin: 0 auto; }.panel-heading { display: flex; align-items: center; gap: 13px; margin-bottom: 24px; }.panel-heading h2 { margin: 0; font-size: 1.15rem; }.panel-heading p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
.state-card { border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }.state-card :deep(.v-card-text) { display: flex; align-items: center; gap: 14px; }.state-card :deep(.v-card-text) > div { min-width: 0; flex: 1; }.state-card p { margin: 3px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .82rem; }
.publication-actions { display: flex; gap: 9px; }.history-heading { display: flex; align-items: center; justify-content: space-between; }.history-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 1rem; }
.publication-history { overflow: hidden; margin-top: 14px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; }.publication-history article { display: flex; align-items: center; gap: 12px; padding: 13px; }.publication-history article + article { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }.publication-history article > div { display: flex; min-width: 0; flex: 1; flex-direction: column; }.publication-history span { margin-top: 3px; color: rgb(var(--v-theme-on-surface-variant)); font-size: .75rem; }
.empty-box { display: grid; min-height: 210px; place-items: center; align-content: center; gap: 7px; margin-top: 14px; border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }.empty-box span { font-size: .82rem; }.load-more { display: flex; justify-content: center; padding-top: 20px; }
.preview-dialog { max-height: 84vh; }.preview-dialog h1 { max-width: 760px; margin: 18px auto 24px; font-size: 1.6rem; }.preview-dialog pre { max-width: 760px; margin: 0 auto; font: inherit; line-height: 1.75; overflow-wrap: anywhere; white-space: pre-wrap; }.preview-meta { color: rgb(var(--v-theme-on-surface-variant)); font-size: .72rem; }
@media (max-width: 620px) { .state-card :deep(.v-card-text) { align-items: flex-start; flex-wrap: wrap; }.state-card :deep(.v-card-text) > .v-btn { width: 100%; }.publication-actions > .v-btn { flex: 1; } }
</style>
