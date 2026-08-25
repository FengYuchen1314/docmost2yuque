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

watch(() => props.page.id, () => void loadHistory(true), { immediate: true })

async function loadHistory(reset = false) {
  const version = reset ? ++requestVersion : requestVersion
  if (reset) loading.value = true
  else {
    if (loading.value || loadingMore.value || !hasMore.value) return
    loadingMore.value = true
  }
  error.value = ''
  try {
    const page = await post<PageHistoryPage>('/api/v1/pages/history/page', { pageId: props.page.id, limit: 30, offset: reset ? 0 : nextOffset.value })
    if (version !== requestVersion) return
    revisions.value = reset ? page.items : deduplicate([...revisions.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (version === requestVersion) error.value = messageOf(value)
  } finally {
    if (version === requestVersion) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function saveManualVersion() {
  if (savingManual.value) return
  savingManual.value = true
  error.value = ''
  try {
    const page = await post<Page>('/api/v1/pages/update', {
      pageId: props.page.id,
      expectedRevision: props.page.draftRevision,
      title: props.page.title,
      content: props.page.content,
      schemaVersion: props.page.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: manualDescription.value.trim() || '手动保存版本',
    })
    manualDescription.value = ''
    emit('updated', page, false)
    await loadHistory(true)
    ui.notify(`已保存手工版本 v${page.draftRevision}`)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    savingManual.value = false
  }
}

async function restoreRevision() {
  const revision = restoreTarget.value
  if (!revision || restoring.value) return
  restoring.value = true
  error.value = ''
  try {
    const page = await post<Page>('/api/v1/pages/update', {
      pageId: props.page.id,
      expectedRevision: props.page.draftRevision,
      title: revision.title,
      content: revision.content,
      schemaVersion: revision.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: `恢复自版本 ${revision.revisionNo}`,
    })
    restoreTarget.value = null
    preview.value = null
    emit('updated', page, true)
    await loadHistory(true)
    ui.notify(`已从 v${revision.revisionNo} 创建新的恢复版本`)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    restoring.value = false
  }
}

function openCopy(revision: PageHistory) {
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
  copying.value = true
  copyError.value = ''
  try {
    copiedPage.value = await post<Page>('/api/v1/pages/history/copy', {
      pageId: props.page.id,
      revisionNo: copySource.value.revisionNo,
      title: copyTitle.value.trim(),
      path: copyPath.value,
    })
    ui.notify('历史版本副本已创建')
  } catch (value) {
    copyError.value = messageOf(value)
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
      <v-avatar color="primary" variant="tonal"><v-icon>mdi-history</v-icon></v-avatar>
      <div><h2>版本历史</h2><p>历史快照不可变；恢复会基于旧内容创建一个新的手工版本。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <v-card variant="tonal" color="primary" class="manual-card mb-6">
      <v-card-text>
        <div class="manual-copy"><strong>保存当前版本</strong><span>为当前草稿生成不会被自动保存覆盖的手工版本节点。</span></div>
        <v-text-field v-model="manualDescription" label="版本说明（可选）" maxlength="500" variant="outlined" density="comfortable" hide-details @keydown.enter.prevent="saveManualVersion" />
        <v-btn color="primary" variant="flat" prepend-icon="mdi-content-save-outline" :loading="savingManual" @click="saveManualVersion">保存版本</v-btn>
      </v-card-text>
    </v-card>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5" />
    <div v-if="revisions.length" class="history-list">
      <article v-for="revision in revisions" :key="revision.id">
        <v-avatar color="primary" variant="tonal" size="42"><strong>v{{ revision.revisionNo }}</strong></v-avatar>
        <div class="revision-copy"><strong>{{ revision.title }}</strong><p>{{ revision.plainText || '空白内容' }}</p><small>{{ revisionKindLabel(revision.revisionKind) }} · {{ formatDateTime(revision.createdAt) }}<template v-if="revision.description"> · {{ revision.description }}</template></small></div>
        <div class="revision-actions">
          <v-btn size="small" variant="text" prepend-icon="mdi-eye-outline" @click="preview = revision">预览</v-btn>
          <v-btn size="small" variant="text" prepend-icon="mdi-content-copy" @click="openCopy(revision)">副本</v-btn>
          <v-btn size="small" variant="tonal" prepend-icon="mdi-backup-restore" :disabled="revision.revisionNo === page.draftRevision" @click="restoreTarget = revision">恢复</v-btn>
        </div>
      </article>
    </div>
    <div v-else-if="!loading" class="empty-box"><v-icon size="40">mdi-history</v-icon><strong>还没有历史版本</strong><span>编辑或手动保存后，版本会出现在这里。</span></div>
    <div v-if="hasMore" class="load-more"><v-btn variant="tonal" :loading="loadingMore" @click="loadHistory(false)">加载更多历史版本</v-btn></div>

    <v-dialog :model-value="Boolean(preview)" max-width="900" scrollable @update:model-value="value => { if (!value) preview = null }">
      <v-card v-if="preview" class="preview-dialog">
        <v-toolbar flat border="bottom" class="px-3"><div><strong>历史版本 v{{ preview.revisionNo }}</strong><div class="preview-meta">{{ revisionKindLabel(preview.revisionKind) }} · {{ formatDateTime(preview.createdAt) }}</div></div><v-spacer /><v-btn icon="mdi-close" variant="text" @click="preview = null" /></v-toolbar>
        <v-card-text><h1>{{ preview.title }}</h1><pre>{{ previewText(preview) }}</pre></v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(restoreTarget)" max-width="520" persistent>
      <v-card><v-card-title class="px-6 pt-5">恢复到版本 {{ restoreTarget?.revisionNo }}？</v-card-title><v-card-text class="px-6"><v-alert type="warning" variant="tonal">当前内容会先保留在历史中，旧版本内容将作为新的草稿版本写入。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="restoring" @click="restoreTarget = null">取消</v-btn><v-btn color="primary" :loading="restoring" @click="restoreRevision">恢复此版本</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(copySource)" max-width="560" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">{{ copiedPage ? '副本已经创建' : `基于 v${copySource?.revisionNo} 创建副本` }}</v-card-title>
        <v-card-text class="px-6">
          <v-alert v-if="copiedPage" type="success" variant="tonal" class="mb-4">“{{ copiedPage.title }}”已创建。发布、分享和文稿级权限不会从原文复制。</v-alert>
          <template v-else>
            <p class="copy-note">正文来自不可变历史快照；新文稿继承知识库权限，但不会复制旧分享链接和发布状态。</p>
            <v-text-field v-model="copyTitle" label="副本标题" maxlength="500" variant="outlined" autofocus />
            <v-text-field :model-value="copyPath" label="访问路径" prefix="/" maxlength="180" variant="outlined" @update:model-value="copyPath = slugify(String($event))" />
          </template>
          <v-alert v-if="copyError" type="error" variant="tonal">{{ copyError }}</v-alert>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="copying" @click="closeCopy">{{ copiedPage ? '关闭' : '取消' }}</v-btn><v-btn v-if="copiedPage" color="primary" prepend-icon="mdi-open-in-new" @click="openCopiedPage">打开副本</v-btn><v-btn v-else color="primary" prepend-icon="mdi-content-copy" :loading="copying" :disabled="!copyTitle.trim() || !copyPath" @click="createCopy">创建副本</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { max-width: 980px; margin: 0 auto; }.panel-heading { display: flex; align-items: center; gap: 13px; margin-bottom: 24px; }.panel-heading h2 { margin: 0; font-size: 1.15rem; }.panel-heading p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
.manual-card :deep(.v-card-text) { display: grid; grid-template-columns: minmax(180px, .8fr) minmax(240px, 1.4fr) auto; align-items: center; gap: 14px; }.manual-copy { display: flex; flex-direction: column; }.manual-copy span { margin-top: 3px; color: rgb(var(--v-theme-on-surface-variant)); font-size: .77rem; }
.history-list { overflow: hidden; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; }.history-list article { display: flex; align-items: center; gap: 12px; padding: 14px; }.history-list article + article { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.revision-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.revision-copy p { overflow: hidden; margin: 3px 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .8rem; text-overflow: ellipsis; white-space: nowrap; }.revision-copy small, .preview-meta { color: rgb(var(--v-theme-on-surface-variant)); font-size: .71rem; }.revision-actions { display: flex; align-items: center; gap: 2px; }
.empty-box { display: grid; min-height: 220px; place-items: center; align-content: center; gap: 7px; border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }.empty-box span { font-size: .82rem; }.load-more { display: flex; justify-content: center; padding-top: 20px; }
.preview-dialog { max-height: 84vh; }.preview-dialog h1 { margin: 4px auto 24px; max-width: 760px; font-size: 1.6rem; }.preview-dialog pre { max-width: 760px; margin: 0 auto; color: rgb(var(--v-theme-on-surface)); font: inherit; line-height: 1.75; overflow-wrap: anywhere; white-space: pre-wrap; }.copy-note { margin-top: 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
@media (max-width: 760px) { .manual-card :deep(.v-card-text) { grid-template-columns: 1fr; }.history-list article { align-items: flex-start; flex-wrap: wrap; }.revision-copy { min-width: calc(100% - 60px); }.revision-actions { width: 100%; justify-content: flex-end; } }
</style>
