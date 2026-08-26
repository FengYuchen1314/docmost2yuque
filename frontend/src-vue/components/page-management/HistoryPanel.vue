<script setup lang="ts">
import { ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Page } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import type { PageHistory, PageHistoryPage } from './types'
import { formatDateTime, historyCopyPath, revisionKindLabel, slugify } from './utils'

const props = defineProps<{ page: Page }>()
const emit = defineEmits<{ updated: [page: Page, resetEditorBody: boolean] }>()
const router = useRouter()
const ui = useUiStore()

const revisions = ref<PageHistory[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const loadFailed = ref(false)
const manualDescription = ref('')
const savingManual = ref(false)
const preview = ref<PageHistory | null>(null)
const restoreTarget = ref<PageHistory | null>(null)
const restoring = ref(false)

const copySource = ref<PageHistory | null>(null)
const copyTitle = ref('')
const copyPath = ref('')
const copying = ref(false)
const copiedPage = ref<Page | null>(null)
const copyError = ref('')
let requestVersion = 0

watch(() => props.page.id, () => {
  preview.value = null
  restoreTarget.value = null
  copySource.value = null
  copiedPage.value = null
  copyError.value = ''
  manualDescription.value = ''
  void loadHistory(true)
}, { immediate: true })

async function loadHistory(reset = false) {
  const pageId = props.page.id
  const version = reset ? ++requestVersion : requestVersion
  if (reset) {
    loadFailed.value = false
    loading.value = true
    loadingMore.value = false
    revisions.value = []
    nextOffset.value = 0
    hasMore.value = false
    preview.value = null
    restoreTarget.value = null
  }
  else {
    if (loading.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  }
  error.value = ''
  try {
    const page = await post<PageHistoryPage>('/api/v1/pages/history/page', { pageId, limit: 30, offset: reset ? 0 : nextOffset.value })
    if (version !== requestVersion || pageId !== props.page.id) return
    const items = Array.isArray(page.items) ? page.items : []
    if (reset) loadFailed.value = false
    revisions.value = reset ? items : deduplicate([...revisions.value, ...items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (version === requestVersion && pageId === props.page.id) { error.value = messageOf(value); if (reset) loadFailed.value = true }
  } finally {
    if (version === requestVersion && pageId === props.page.id) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function saveManualVersion() {
  if (savingManual.value || loading.value || loadingMore.value || loadFailed.value) return
  const pageId = props.page.id
  savingManual.value = true
  error.value = ''
  try {
    const page = await post<Page>('/api/v1/pages/update', {
      pageId,
      expectedRevision: props.page.draftRevision,
      title: props.page.title,
      content: props.page.content,
      schemaVersion: props.page.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: manualDescription.value.trim() || '手动保存版本',
    })
    if (pageId !== props.page.id) return
    manualDescription.value = ''
    emit('updated', page, false)
    await loadHistory(true)
    ui.notify(`已保存手工版本 v${page.draftRevision}`)
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    savingManual.value = false
  }
}

async function restoreRevision() {
  const revision = restoreTarget.value
  if (!revision || restoring.value || loading.value || loadingMore.value || loadFailed.value || error.value || !revisions.value.some((item) => item.id === revision.id)) return
  const pageId = props.page.id
  restoring.value = true
  error.value = ''
  try {
    const page = await post<Page>('/api/v1/pages/update', {
      pageId,
      expectedRevision: props.page.draftRevision,
      title: revision.title,
      content: revision.content,
      schemaVersion: revision.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: `恢复自版本 ${revision.revisionNo}`,
    })
    if (pageId !== props.page.id) return
    restoreTarget.value = null
    preview.value = null
    emit('updated', page, true)
    await loadHistory(true)
    ui.notify(`已从 v${revision.revisionNo} 创建新的恢复版本`)
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    restoring.value = false
  }
}

function openCopy(revision: PageHistory) {
  if (loading.value || loadingMore.value || loadFailed.value || error.value || !revisions.value.some((item) => item.id === revision.id)) return
  copySource.value = revision
  copyTitle.value = `${revision.title}（副本）`.slice(0, 500)
  copyPath.value = historyCopyPath(props.page.path, revision.revisionNo)
  copiedPage.value = null
  copyError.value = ''
}

function closeCopy() {
  if (copying.value) return
  copySource.value = null
  copiedPage.value = null
  copyError.value = ''
}

async function createCopy() {
  if (!copySource.value || copying.value || !copyTitle.value.trim() || !copyPath.value) return
  const pageId = props.page.id
  const revisionNo = copySource.value.revisionNo
  copying.value = true
  copyError.value = ''
  try {
    copiedPage.value = await post<Page>('/api/v1/pages/history/copy', {
      pageId,
      revisionNo,
      title: copyTitle.value.trim(),
      path: copyPath.value,
    })
    if (pageId !== props.page.id) return
    ui.notify('历史版本副本已创建')
  } catch (value) {
    if (pageId === props.page.id) copyError.value = messageOf(value)
  } finally {
    copying.value = false
  }
}

async function openCopiedPage() {
  const page = copiedPage.value
  if (!page) return
  await router.push(`/app/kb/${encodeURIComponent(page.knowledgeBaseId)}/pages/${encodeURIComponent(page.id)}`)
  closeCopy()
}

function deduplicate(items: PageHistory[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function previewText(revision: PageHistory) {
  if (revision.plainText) return revision.plainText
  try { return JSON.stringify(revision.content, null, 2) } catch { return '无法显示此版本内容' }
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-icon size="18">mdi-history</v-icon>
      <div><h2>版本历史</h2><p>历史快照不可变；恢复会基于旧内容创建一个新的手工版本。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <v-card variant="tonal" color="primary" class="manual-card mb-4">
      <v-card-text>
        <div class="manual-copy"><strong>保存当前版本</strong><span>为当前草稿生成不会被自动保存覆盖的手工版本节点。</span></div>
        <v-text-field v-model="manualDescription" label="版本说明（可选）" maxlength="500" variant="outlined" density="compact" hide-details @keydown.enter.prevent="saveManualVersion" />
        <v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" :loading="savingManual" :disabled="loading || loadingMore || loadFailed" @click="saveManualVersion">保存版本</v-btn>
      </v-card-text>
    </v-card>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5" />
    <div v-if="revisions.length" class="history-list">
      <article v-for="revision in revisions" :key="revision.id">
        <span class="revision-number">v{{ revision.revisionNo }}</span>
        <div class="revision-copy"><strong>{{ revision.title }}</strong><p>{{ revision.plainText || '空白内容' }}</p><small>{{ revisionKindLabel(revision.revisionKind) }} · {{ formatDateTime(revision.createdAt) }}<template v-if="revision.description"> · {{ revision.description }}</template></small></div>
        <div class="revision-actions">
          <v-btn size="small" variant="text" prepend-icon="mdi-eye-outline" :disabled="loading || loadingMore || Boolean(error)" @click="preview = revision">预览</v-btn>
          <v-btn size="small" variant="text" prepend-icon="mdi-content-copy" :disabled="loading || loadingMore || Boolean(error)" @click="openCopy(revision)">副本</v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-backup-restore" :disabled="loading || loadingMore || Boolean(error) || revision.revisionNo === page.draftRevision" @click="restoreTarget = revision">恢复</v-btn>
        </div>
      </article>
    </div>
    <div v-else-if="!loading && loadFailed" class="empty-box load-error"><v-icon size="28">mdi-alert-circle-outline</v-icon><strong>历史加载失败</strong><span>请检查网络后重试</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadHistory(true)">重新加载</v-btn></div>
    <div v-else-if="!loading && !loadFailed" class="empty-box"><v-icon size="28">mdi-history</v-icon><strong>暂无历史版本</strong><span>编辑或手动保存后会显示在这里</span></div>
    <div v-if="hasMore" class="load-more"><v-btn variant="tonal" :loading="loadingMore" @click="loadHistory(false)">加载更多历史版本</v-btn></div>

    <v-dialog :model-value="Boolean(preview)" max-width="680" scrollable @update:model-value="value => { if (!value) preview = null }">
      <v-card v-if="preview" class="preview-dialog">
        <v-toolbar flat border="bottom" class="px-3"><div><strong>历史版本 v{{ preview.revisionNo }}</strong><div class="preview-meta">{{ revisionKindLabel(preview.revisionKind) }} · {{ formatDateTime(preview.createdAt) }}</div></div><v-spacer /><v-btn icon="mdi-close" variant="text" @click="preview = null" /></v-toolbar>
        <v-card-text><h1>{{ preview.title }}</h1><pre>{{ previewText(preview) }}</pre></v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(restoreTarget)" max-width="520" persistent>
      <v-card><v-card-title class="px-6 pt-5">恢复到版本 {{ restoreTarget?.revisionNo }}？</v-card-title><v-card-text class="px-6"><v-alert type="warning" variant="tonal">当前内容会先保留在历史中，旧版本内容将作为新的草稿版本写入。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="restoring" @click="restoreTarget = null">取消</v-btn><v-btn color="primary" :loading="restoring" :disabled="loading || loadingMore || Boolean(error)" @click="restoreRevision">恢复此版本</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(copySource)" max-width="560" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">{{ copiedPage ? '副本已经创建' : `基于 v${copySource?.revisionNo} 创建副本` }}</v-card-title>
        <v-card-text class="px-6">
          <v-alert v-if="copiedPage" type="success" variant="tonal" class="mb-4">“{{ copiedPage.title }}”已创建。发布、分享和文稿级权限不会从原文复制。</v-alert>
          <template v-else>
            <p class="copy-note">正文来自不可变历史快照；新文稿继承知识库权限，但不会复制旧分享链接和发布状态。</p>
            <v-text-field v-model="copyTitle" label="副本标题" maxlength="500" variant="outlined" density="compact" autofocus />
            <v-text-field :model-value="copyPath" label="访问路径" prefix="/" maxlength="180" variant="outlined" density="compact" @update:model-value="copyPath = slugify(String($event))" />
          </template>
          <v-alert v-if="copyError" type="error" variant="tonal">{{ copyError }}</v-alert>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="copying" @click="closeCopy">{{ copiedPage ? '关闭' : '取消' }}</v-btn><v-btn v-if="copiedPage" color="primary" prepend-icon="mdi-open-in-new" @click="openCopiedPage">打开副本</v-btn><v-btn v-else color="primary" prepend-icon="mdi-content-copy" :loading="copying" :disabled="!copyTitle.trim() || !copyPath" @click="createCopy">创建副本</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { width: 100%; margin: 0; }.panel-heading { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.panel-heading > .v-icon { margin-top: 2px; color: #737876; }.panel-heading h2 { margin: 0; font-size: 15px; line-height: 20px; }.panel-heading p { margin: 2px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; }
.manual-card { border: 1px solid #dce8e0; border-radius: 6px !important; background: #f7faf8 !important; color: #262626 !important; }.manual-card :deep(.v-card-text) { display: grid; grid-template-columns: minmax(150px, .75fr) minmax(210px, 1.25fr) auto; align-items: center; gap: 10px; padding: 12px; }.manual-copy { display: flex; flex-direction: column; font-size: 13px; }.manual-copy span { margin-top: 2px; color: #8a8f8d; font-size: 11px; }
.history-list { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 6px; }.history-list article { display: flex; min-height: 58px; align-items: center; gap: 10px; padding: 9px 8px 9px 12px; }.history-list article:hover { background: #fafbfa; }.history-list article + article { border-top: 1px solid #eef0ef; }
.revision-number { width: 38px; flex: 0 0 38px; color: #2f6feb; font: 600 12px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace; }.revision-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.revision-copy > strong { font-size: 13px; }.revision-copy p { overflow: hidden; margin: 2px 0; color: #737876; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }.revision-copy small, .preview-meta { color: #969a98; font-size: 11px; }.revision-actions { display: flex; align-items: center; gap: 1px; opacity: 1; transition: opacity .12s; }.history-list article:hover .revision-actions, .history-list article:focus-within .revision-actions { opacity: 1; }
.empty-box { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 5px; border: 1px dashed #e0e3e1; border-radius: 6px; color: #9ba09e; text-align: center; }.empty-box strong { color: #606562; font-size: 13px; }.empty-box span { font-size: 12px; }.load-more { display: flex; justify-content: center; padding-top: 14px; }
.load-error > .v-icon { color: #d84b42; }
.preview-dialog { max-height: 84vh; border-radius: 8px !important; }.preview-dialog h1 { margin: 4px auto 20px; max-width: 600px; font-size: 24px; }.preview-dialog pre { max-width: 600px; margin: 0 auto; color: #262626; font: 14px/1.75 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; overflow-wrap: anywhere; white-space: pre-wrap; }.copy-note { margin-top: 0; color: #737876; font-size: 12px; }
@media (hover: hover) and (pointer: fine) { .revision-actions { opacity: 0; } }
@media (max-width: 760px) { .manual-card :deep(.v-card-text) { grid-template-columns: 1fr; }.history-list article { align-items: flex-start; flex-wrap: wrap; }.revision-copy { min-width: calc(100% - 60px); }.revision-actions { width: 100%; justify-content: flex-end; } }
</style>
