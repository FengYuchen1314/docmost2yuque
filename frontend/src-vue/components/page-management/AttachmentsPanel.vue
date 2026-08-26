<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Page } from '../../../src/types'
import { messageOf, post, upload } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import type { AttachmentView } from './types'
import { formatBytes, formatDateTime } from './utils'

const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const props = defineProps<{ page: Page }>()
const ui = useUiStore()
const fileInput = ref<HTMLInputElement | null>(null)
const attachments = ref<AttachmentView[]>([])
const loading = ref(false)
const uploading = ref(false)
const downloadingId = ref('')
const deleting = ref(false)
const deleteTarget = ref<AttachmentView | null>(null)
const error = ref('')
const attachmentsLoaded = ref(false)
const attachmentsLoadFailed = ref(false)
let attachmentsRequestVersion = 0

watch(() => props.page.id, () => {
  deleteTarget.value = null
  void loadAttachments()
}, { immediate: true })

async function loadAttachments() {
  const pageId = props.page.id
  const version = ++attachmentsRequestVersion
  loading.value = true
  error.value = ''
  attachmentsLoaded.value = false
  attachmentsLoadFailed.value = false
  attachments.value = []
  deleteTarget.value = null
  try {
    const values = await post<AttachmentView[]>('/api/v1/attachments/list', { pageId })
    if (version !== attachmentsRequestVersion || pageId !== props.page.id) return
    attachments.value = Array.isArray(values) ? values : []
    attachmentsLoaded.value = true
  } catch (value) {
    if (version === attachmentsRequestVersion && pageId === props.page.id) {
      attachmentsLoadFailed.value = true
      error.value = messageOf(value)
    }
  } finally {
    if (version === attachmentsRequestVersion && pageId === props.page.id) loading.value = false
  }
}

async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value || loading.value || attachmentsLoadFailed.value || error.value) return
  if (!file.size) {
    error.value = '不能上传空文件'
    return
  }
  if (file.size > MAX_ATTACHMENT_BYTES) {
    error.value = '单个附件不能超过 50 MB'
    return
  }
  uploading.value = true
  error.value = ''
  const pageId = props.page.id
  try {
    const form = new FormData()
    form.append('pageId', pageId)
    form.append('file', file)
    await upload<AttachmentView>('/api/v1/attachments/upload', form)
    if (pageId !== props.page.id) return
    await loadAttachments()
    ui.notify('附件上传成功')
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    uploading.value = false
  }
}

async function downloadAttachment(attachment: AttachmentView) {
  if (downloadingId.value || loading.value || attachmentsLoadFailed.value || error.value || !attachments.value.some((item) => item.id === attachment.id)) return
  const pageId = props.page.id
  downloadingId.value = attachment.id
  error.value = ''
  try {
    const url = new URL(attachment.contentUrl, window.location.origin)
    if (url.origin !== window.location.origin) throw new Error('附件地址不安全')
    url.searchParams.set('download', 'true')
    const response = await fetch(url, { credentials: 'include' })
    if (!response.ok) throw new Error(`下载失败（${response.status}）`)
    const blobUrl = URL.createObjectURL(await response.blob())
    const anchor = document.createElement('a')
    anchor.href = blobUrl
    anchor.download = attachment.originalName
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1_000)
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    downloadingId.value = ''
  }
}

async function deleteAttachment() {
  if (!deleteTarget.value || deleting.value || loading.value || attachmentsLoadFailed.value || error.value) return
  const pageId = props.page.id
  const attachmentId = deleteTarget.value.id
  if (!attachments.value.some((item) => item.id === attachmentId)) return
  deleting.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/attachments/delete', { attachmentId })
    if (pageId !== props.page.id) return
    deleteTarget.value = null
    await loadAttachments()
    ui.notify('附件已永久删除')
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    deleting.value = false
  }
}

function attachmentIcon(mediaType: string) {
  if (mediaType.startsWith('image/')) return 'mdi-file-image-outline'
  if (mediaType.startsWith('audio/')) return 'mdi-file-music-outline'
  if (mediaType.startsWith('video/')) return 'mdi-file-video-outline'
  if (mediaType === 'application/pdf') return 'mdi-file-pdf-box'
  if (mediaType.includes('zip') || mediaType.includes('compressed')) return 'mdi-folder-zip-outline'
  return 'mdi-file-outline'
}

function extractionLabel(status: AttachmentView['extractionStatus']) {
  return ({ EXTRACTED: '全文已索引', EMPTY: '无可提取文字', UNSUPPORTED: '仅索引文件名', TOO_LARGE: '文件过大，仅索引文件名', FAILED: '提取失败，仅索引文件名', METADATA_ONLY: '等待重建索引' })[status]
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-icon size="18">mdi-paperclip</v-icon>
      <div><h2>附件管理</h2><p>上传、下载和清理本页文件；单个文件最大 50 MB。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <label class="upload-box" :class="{ disabled: uploading || loading || attachmentsLoadFailed || Boolean(error) }" :for="`attachment-upload-${page.id}`">
      <span class="upload-icon"><v-progress-circular v-if="uploading" indeterminate size="18" width="2" /><v-icon v-else size="20">mdi-cloud-upload-outline</v-icon></span>
      <span><strong>{{ uploading ? '正在上传并校验…' : '上传附件' }}</strong><small>选择任意文件；服务端会净化文件名并计算 SHA-256。</small></span>
      <span class="upload-cta">选择文件</span>
    </label>
    <input :id="`attachment-upload-${page.id}`" ref="fileInput" type="file" class="visually-hidden" :disabled="uploading || loading || attachmentsLoadFailed || Boolean(error)" @change="selectFile">

    <v-progress-linear v-if="loading" indeterminate color="primary" class="my-5" />
    <div v-if="attachments.length" class="attachment-list mt-5">
      <article v-for="attachment in attachments" :key="attachment.id">
        <span class="file-icon"><v-icon size="18">{{ attachmentIcon(attachment.mediaType) }}</v-icon></span>
        <div class="attachment-copy">
          <strong>{{ attachment.originalName }}</strong>
          <span>{{ attachment.mediaType }} · {{ formatBytes(attachment.sizeBytes) }} · {{ formatDateTime(attachment.createdAt) }}</span>
          <small>{{ extractionLabel(attachment.extractionStatus) }} · SHA-256 {{ attachment.checksumSha256.slice(0, 16) }}…</small>
        </div>
        <v-btn icon="mdi-download-outline" variant="text" :loading="downloadingId === attachment.id" :disabled="Boolean(downloadingId) || loading || attachmentsLoadFailed || Boolean(error)" :aria-label="`下载 ${attachment.originalName}`" @click="downloadAttachment(attachment)" />
        <v-btn icon="mdi-delete-outline" variant="text" color="error" :disabled="loading || attachmentsLoadFailed || Boolean(error) || deleting" :aria-label="`删除附件 ${attachment.originalName}`" @click="deleteTarget = attachment" />
      </article>
    </div>
    <div v-else-if="!loading && attachmentsLoadFailed" class="empty-box load-error"><v-icon size="28">mdi-alert-circle-outline</v-icon><strong>附件加载失败</strong><span>请检查网络后重试</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadAttachments">重新加载</v-btn></div>
    <div v-else-if="!loading && attachmentsLoaded" class="empty-box"><v-icon size="28">mdi-paperclip</v-icon><strong>暂无附件</strong><span>上传后可从这里下载或删除</span></div>

    <v-dialog :model-value="Boolean(deleteTarget)" max-width="520" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">永久删除附件“{{ deleteTarget?.originalName }}”？</v-card-title>
        <v-card-text class="px-6"><v-alert type="error" variant="tonal">此操作无法恢复，文稿中现有的附件引用会立即失效。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="deleting" @click="deleteTarget = null">取消</v-btn><v-btn color="error" :loading="deleting" :disabled="loading || attachmentsLoadFailed || Boolean(error)" @click="deleteAttachment">永久删除</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { width: 100%; margin: 0; }.panel-heading { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.panel-heading > .v-icon { margin-top: 2px; color: #737876; }.panel-heading h2 { margin: 0; font-size: 15px; line-height: 20px; }.panel-heading p { margin: 2px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; }
.upload-box { display: flex; width: 100%; min-height: 58px; align-items: center; gap: 10px; border: 1px dashed #cdd7d1; border-radius: 6px; padding: 9px 10px; background: #fafcfb; color: inherit; text-align: left; cursor: pointer; }.upload-box:hover { border-color: #7ca58d; background: #f5faf7; }.upload-box.disabled { cursor: wait; opacity: .75; pointer-events: none; }.upload-icon, .file-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 5px; background: #edf5f0; color: #397a55; }.upload-box > span:not(.upload-cta,.upload-icon) { display: flex; min-width: 0; flex: 1; flex-direction: column; }.upload-box strong { font-size: 13px; }.upload-box small { margin-top: 2px; color: #8a8f8d; font-size: 11px; }.upload-cta { border-radius: 5px; padding: 6px 10px; background: #edf3ff; color: #2f6feb; font-size: 12px; font-weight: 600; }
.visually-hidden { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.attachment-list { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 6px; }.attachment-list article { display: flex; min-height: 54px; align-items: center; gap: 9px; padding: 8px 7px 8px 10px; }.attachment-list article:hover { background: #fafbfa; }.attachment-list article + article { border-top: 1px solid #eef0ef; }
.attachment-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.attachment-copy strong, .attachment-copy span, .attachment-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.attachment-copy strong { font-size: 13px; }.attachment-copy span, .attachment-copy small { color: #8a8f8d; font-size: 11px; }.attachment-copy small { margin-top: 1px; font-family: ui-monospace, monospace; font-size: 10px; }
.empty-box { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 5px; margin-top: 14px; border: 1px dashed #e0e3e1; border-radius: 6px; color: #9ba09e; text-align: center; }.empty-box strong { color: #606562; font-size: 13px; }.empty-box span { font-size: 12px; }
.load-error > .v-icon { color: #d84b42; }
@media (max-width: 600px) { .upload-box { align-items: flex-start; flex-wrap: wrap; }.upload-box > span { min-width: calc(100% - 70px); }.upload-box > .v-btn { width: 100%; }.attachment-list article { align-items: flex-start; flex-wrap: wrap; }.attachment-copy { min-width: calc(100% - 60px); } }
</style>
