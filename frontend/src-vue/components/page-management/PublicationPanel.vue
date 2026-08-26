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
const stateLoadFailed = ref(false)
const historyLoaded = ref(false)
const historyLoadFailed = ref(false)
const publishIdempotencyKey = ref('')
const publishIntentRevision = ref<number | null>(null)
let pollTimer = 0
let stateRequestVersion = 0
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

watch(() => [props.page.id, props.page.draftRevision] as const, (current, previous) => {
  resetPublishIntent()
  if (!previous || current[0] !== previous[0]) {
    resetPublicationContext()
    void Promise.all([loadState(true), loadHistory(true)])
  } else {
    state.value = null
    error.value = ''
    void loadState(true)
  }
}, { immediate: true })
onBeforeUnmount(() => window.clearTimeout(pollTimer))

async function loadState(clear = false) {
  const pageId = props.page.id
  const version = ++stateRequestVersion
  if (clear) {
    state.value = null
  }
  stateLoadFailed.value = false
  loadingState.value = true
  try {
    const value = await post<PublicationState>('/api/v1/pages/publication-state', { pageId })
    if (version !== stateRequestVersion || pageId !== props.page.id) return
    state.value = value
    schedulePoll(pageId)
  } catch (value) {
    if (version === stateRequestVersion && pageId === props.page.id) {
      stateLoadFailed.value = true
      error.value = messageOf(value)
    }
  } finally {
    if (version === stateRequestVersion && pageId === props.page.id) loadingState.value = false
  }
}

function reloadPublication() {
  resetPublicationContext()
  void Promise.all([loadState(true), loadHistory(true)])
}

function schedulePoll(pageId: string) {
  window.clearTimeout(pollTimer)
  if (automaticBusy.value) pollTimer = window.setTimeout(() => {
    if (pageId === props.page.id) void loadState()
  }, 1_000)
}

async function loadHistory(reset = false) {
  const pageId = props.page.id
  const version = reset ? ++historyRequestVersion : historyRequestVersion
  if (reset) {
    loadingHistory.value = true
    loadingMore.value = false
    historyLoaded.value = false
    historyLoadFailed.value = false
    history.value = []
    nextOffset.value = 0
    hasMore.value = false
    preview.value = null
  }
  else {
    if (loadingHistory.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  }
  try {
    const page = await post<PublicationHistoryPage>('/api/v1/pages/publication-history/page', { pageId, limit: 30, offset: reset ? 0 : nextOffset.value })
    if (version !== historyRequestVersion || pageId !== props.page.id) return
    const items = Array.isArray(page.items) ? page.items : []
    history.value = reset ? items : deduplicate([...history.value, ...items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
    historyLoaded.value = true
    historyLoadFailed.value = false
  } catch (value) {
    if (version === historyRequestVersion && pageId === props.page.id) {
      historyLoadFailed.value = true
      error.value = messageOf(value)
    }
  } finally {
    if (version === historyRequestVersion && pageId === props.page.id) {
      loadingHistory.value = false
      loadingMore.value = false
    }
  }
}

async function publish() {
  if (publishing.value || loadingState.value || loadingHistory.value || stateLoadFailed.value || historyLoadFailed.value || error.value || !state.value || automaticBusy.value || (state.value.published && state.value.upToDate)) return
  const pageId = props.page.id
  publishing.value = true
  error.value = ''
  if (!publishIdempotencyKey.value || publishIntentRevision.value !== props.page.draftRevision) {
    publishIntentRevision.value = props.page.draftRevision
    publishIdempotencyKey.value = `vue-${props.page.id}-${props.page.draftRevision}-${createUuid()}`
  }
  try {
    const path = state.value.published ? '/api/v1/pages/republish' : '/api/v1/pages/publish'
    await post<PagePublication>(path, { pageId, idempotencyKey: publishIdempotencyKey.value })
    if (pageId !== props.page.id) return
    resetPublishIntent()
    error.value = ''
    await Promise.all([loadState(true), loadHistory(true)])
    ui.notify('发布成功')
  } catch (value) {
    // Keep the key so retrying the same draft remains idempotent after a lost response.
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    publishing.value = false
  }
}

async function unpublish() {
  if (unpublishing.value || loadingState.value || loadingHistory.value || stateLoadFailed.value || historyLoadFailed.value || error.value || !state.value?.published) return
  const pageId = props.page.id
  unpublishing.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/pages/unpublish', { pageId })
    if (pageId !== props.page.id) return
    unpublishOpen.value = false
    resetPublishIntent()
    await Promise.all([loadState(true), loadHistory(true)])
    ui.notify('当前发布版本已下线')
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    unpublishing.value = false
  }
}

function resetPublishIntent() {
  publishIdempotencyKey.value = ''
  publishIntentRevision.value = null
}

function resetPublicationContext() {
  window.clearTimeout(pollTimer)
  stateRequestVersion += 1
  historyRequestVersion += 1
  state.value = null
  stateLoadFailed.value = false
  history.value = []
  historyLoaded.value = false
  historyLoadFailed.value = false
  nextOffset.value = 0
  hasMore.value = false
  loadingState.value = false
  loadingHistory.value = false
  loadingMore.value = false
  unpublishOpen.value = false
  preview.value = null
  error.value = ''
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
      <v-icon size="18">mdi-rocket-launch-outline</v-icon>
      <div><h2>发布管理</h2><p>发布的是不可变快照；之后编辑草稿不会悄悄改变线上内容。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loadingState" indeterminate color="primary" class="mb-5" />

    <v-card v-if="(state && !stateLoadFailed) || loadingState" class="state-card mb-5" :color="automaticFailed ? 'error' : state?.published ? 'success' : 'primary'" variant="tonal">
      <v-card-text>
        <span class="state-icon" :class="{ error: automaticFailed, success: state?.published && !automaticFailed }">
          <v-progress-circular v-if="automaticBusy" indeterminate size="22" width="2" />
          <v-icon v-else>{{ automaticFailed ? 'mdi-alert-outline' : state?.published ? 'mdi-earth' : 'mdi-archive-outline' }}</v-icon>
        </span>
        <div><strong>{{ stateTitle }}</strong><p>{{ stateText }}</p></div>
        <v-btn v-if="state?.publicationId" :href="`/p/${state.publicationId}`" target="_blank" rel="noreferrer" variant="tonal" prepend-icon="mdi-open-in-new">查看线上版</v-btn>
      </v-card-text>
    </v-card>
    <div v-else-if="stateLoadFailed" class="publication-load-error mb-5"><v-icon size="28">mdi-alert-circle-outline</v-icon><strong>发布状态加载失败</strong><span>当前没有可用于发布判断的状态，请重新加载</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="reloadPublication">重新加载</v-btn></div>

    <div class="publication-actions mb-5">
      <v-btn color="primary" prepend-icon="mdi-rocket-launch-outline" :loading="publishing || automaticBusy" :disabled="loadingState || loadingHistory || stateLoadFailed || historyLoadFailed || Boolean(error) || !state || automaticBusy || (state?.published && state.upToDate)" @click="publish">
        {{ automaticBusy ? '自动发布排队中' : state?.published ? '发布最新草稿' : '立即发布' }}
      </v-btn>
      <v-btn v-if="state?.published" color="error" variant="tonal" prepend-icon="mdi-link-off" :disabled="loadingState || loadingHistory || stateLoadFailed || historyLoadFailed || Boolean(error) || unpublishing" @click="unpublishOpen = true">下线</v-btn>
    </div>

    <div class="history-heading"><h3><v-icon size="18">mdi-clock-outline</v-icon> 发布历史</h3><v-chip size="small" variant="tonal">{{ history.length }}{{ hasMore ? '+' : '' }} 条</v-chip></div>
    <v-progress-linear v-if="loadingHistory" indeterminate color="primary" class="my-4" />
    <div v-if="history.length" class="publication-history">
      <article v-for="item in history" :key="item.id">
        <v-chip :color="item.supersededAt ? undefined : 'success'" size="small" variant="tonal">{{ item.supersededAt ? '历史' : '当前' }}</v-chip>
        <div><strong>{{ item.title }}</strong><span>草稿 v{{ item.sourceDraftRevision }} · {{ formatDateTime(item.publishedAt) }} · {{ contentTypeLabel(item.contentType) }}</span></div>
        <v-btn icon="mdi-eye-outline" variant="text" :disabled="loadingHistory || Boolean(error)" :aria-label="`预览发布版本 ${item.sourceDraftRevision}`" @click="preview = item" />
      </article>
    </div>
    <div v-else-if="!loadingHistory && historyLoadFailed" class="empty-box publication-history-load-error"><v-icon size="28">mdi-alert-circle-outline</v-icon><strong>发布历史加载失败</strong><span>当前无法确认发布历史，请重新加载</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadHistory(true)">重新加载</v-btn></div>
    <div v-else-if="!loadingHistory && historyLoaded" class="empty-box"><v-icon size="28">mdi-earth-off</v-icon><strong>尚无发布记录</strong><span>首次发布后会保留快照历史</span></div>
    <div v-if="hasMore" class="load-more"><v-btn variant="tonal" :loading="loadingMore" @click="loadHistory(false)">加载更多发布历史</v-btn></div>

    <v-dialog v-model="unpublishOpen" max-width="480" persistent>
      <v-card><v-card-title class="px-6 pt-5">下线当前发布版本？</v-card-title><v-card-text class="px-6"><v-alert type="error" variant="tonal">下线后，公开阅读和依赖发布快照的现有分享链接将不可访问；发布历史仍会保留。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="unpublishing" @click="unpublishOpen = false">取消</v-btn><v-btn color="error" :loading="unpublishing" :disabled="loadingState || loadingHistory || stateLoadFailed || historyLoadFailed || Boolean(error) || !state?.published" @click="unpublish">确认下线</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(preview)" max-width="680" scrollable @update:model-value="value => { if (!value) preview = null }">
      <v-card v-if="preview" class="preview-dialog">
        <v-toolbar flat border="bottom" class="px-3"><div><strong>发布快照 · 草稿 v{{ preview.sourceDraftRevision }}</strong><div class="preview-meta">{{ formatDateTime(preview.publishedAt) }} · schema v{{ preview.schemaVersion }}</div></div><v-spacer /><v-btn icon="mdi-close" variant="text" @click="preview = null" /></v-toolbar>
        <v-card-text><v-chip size="small" variant="tonal">{{ contentTypeLabel(preview.contentType) }}</v-chip><h1>{{ preview.title }}</h1><pre>{{ previewText(preview) }}</pre></v-card-text>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { width: 100%; margin: 0; }.panel-heading { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.panel-heading > .v-icon { margin-top: 2px; color: #737876; }.panel-heading h2 { margin: 0; font-size: 15px; line-height: 20px; }.panel-heading p { margin: 2px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; }
.state-card { border: 1px solid #dce8e0; border-radius: 6px !important; background: #f7faf8 !important; color: #262626 !important; }.state-card :deep(.v-card-text) { display: flex; align-items: center; gap: 10px; padding: 12px; }.state-card :deep(.v-card-text) > div { min-width: 0; flex: 1; }.state-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 5px; background: #edf3ff; color: #2f6feb; }.state-icon.success { background: #eaf7ef; color: #25834b; }.state-icon.error { background: #fff0ef; color: #d33b32; }.state-card strong { font-size: 13px; }.state-card p { margin: 2px 0 0; color: #737876; font-size: 12px; }
.publication-actions { display: flex; gap: 7px; }.history-heading { display: flex; align-items: center; justify-content: space-between; }.history-heading h3 { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 14px; }
.publication-history { overflow: hidden; margin-top: 12px; border: 1px solid #e7e9e8; border-radius: 6px; }.publication-history article { display: flex; min-height: 54px; align-items: center; gap: 9px; padding: 8px; }.publication-history article:hover { background: #fafbfa; }.publication-history article + article { border-top: 1px solid #eef0ef; }.publication-history article > div { display: flex; min-width: 0; flex: 1; flex-direction: column; }.publication-history article strong { font-size: 13px; }.publication-history span { margin-top: 2px; color: #818684; font-size: 11px; }
.empty-box { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 5px; margin-top: 12px; border: 1px dashed #e0e3e1; border-radius: 6px; color: #9ba09e; text-align: center; }.empty-box strong { color: #606562; font-size: 13px; }.empty-box span { font-size: 12px; }.load-more { display: flex; justify-content: center; padding-top: 14px; }
.publication-load-error { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 5px; border: 1px dashed #ead4d1; border-radius: 6px; color: #8a8f8d; text-align: center; }.publication-load-error > .v-icon { color: #d84b42; }.publication-load-error strong { color: #606562; font-size: 13px; }.publication-load-error span { font-size: 12px; }
.publication-history-load-error > .v-icon { color: #d84b42; }
.preview-dialog { max-height: 84vh; border-radius: 8px !important; }.preview-dialog h1 { max-width: 600px; margin: 16px auto 20px; font-size: 24px; }.preview-dialog pre { max-width: 600px; margin: 0 auto; font: 14px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; overflow-wrap: anywhere; white-space: pre-wrap; }.preview-meta { color: #8a8f8d; font-size: 11px; }
@media (max-width: 620px) { .state-card :deep(.v-card-text) { align-items: flex-start; flex-wrap: wrap; }.state-card :deep(.v-card-text) > .v-btn { width: 100%; }.publication-actions > .v-btn { flex: 1; } }
</style>
