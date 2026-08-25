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

watch(() => props.page.id, () => void loadAttachments(), { immediate: true })

async function loadAttachments() {
  loading.value = true
  error.value = ''
  try {
    attachments.value = await post<AttachmentView[]>('/api/v1/attachments/list', { pageId: props.page.id })
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
  }
}

async function selectFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || uploading.value) return
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
  try {
    const form = new FormData()
    form.append('pageId', props.page.id)
    form.append('file', file)
    await upload<AttachmentView>('/api/v1/attachments/upload', form)
    await loadAttachments()
    ui.notify('附件上传成功')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    uploading.value = false
  }
}

async function downloadAttachment(attachment: AttachmentView) {
  if (downloadingId.value) return
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
    error.value = messageOf(value)
  } finally {
    downloadingId.value = ''
  }
}

async function deleteAttachment() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/attachments/delete', { attachmentId: deleteTarget.value.id })
    deleteTarget.value = null
    await loadAttachments()
    ui.notify('附件已永久删除')
  } catch (value) {
    error.value = messageOf(value)
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
      <v-avatar color="primary" variant="tonal"><v-icon>mdi-paperclip</v-icon></v-avatar>
      <div><h2>附件管理</h2><p>上传、下载和清理本页文件；单个文件最大 50 MB。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <label class="upload-box" :class="{ disabled: uploading }" :for="`attachment-upload-${page.id}`">
      <v-avatar color="primary" variant="tonal" size="52"><v-progress-circular v-if="uploading" indeterminate size="24" width="2" /><v-icon v-else size="27">mdi-cloud-upload-outline</v-icon></v-avatar>
      <span><strong>{{ uploading ? '正在上传并校验…' : '上传附件' }}</strong><small>选择任意文件；服务端会净化文件名并计算 SHA-256。</small></span>
      <span class="upload-cta">选择文件</span>
    </label>
    <input :id="`attachment-upload-${page.id}`" ref="fileInput" type="file" class="visually-hidden" :disabled="uploading" @change="selectFile">

    <v-progress-linear v-if="loading" indeterminate color="primary" class="my-5" />
    <div v-if="attachments.length" class="attachment-list mt-5">
      <article v-for="attachment in attachments" :key="attachment.id">
        <v-avatar color="primary" variant="tonal" rounded="lg"><v-icon>{{ attachmentIcon(attachment.mediaType) }}</v-icon></v-avatar>
        <div class="attachment-copy">
          <strong>{{ attachment.originalName }}</strong>
          <span>{{ attachment.mediaType }} · {{ formatBytes(attachment.sizeBytes) }} · {{ formatDateTime(attachment.createdAt) }}</span>
          <small>{{ extractionLabel(attachment.extractionStatus) }} · SHA-256 {{ attachment.checksumSha256.slice(0, 16) }}…</small>
        </div>
        <v-btn icon="mdi-download-outline" variant="text" :loading="downloadingId === attachment.id" :disabled="Boolean(downloadingId)" :aria-label="`下载 ${attachment.originalName}`" @click="downloadAttachment(attachment)" />
        <v-btn icon="mdi-delete-outline" variant="text" color="error" :aria-label="`删除附件 ${attachment.originalName}`" @click="deleteTarget = attachment" />
      </article>
    </div>
    <div v-else-if="!loading" class="empty-box"><v-icon size="40">mdi-paperclip</v-icon><strong>本页还没有附件</strong><span>上传后可从这里下载或删除。</span></div>

    <v-dialog :model-value="Boolean(deleteTarget)" max-width="520" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">永久删除附件“{{ deleteTarget?.originalName }}”？</v-card-title>
        <v-card-text class="px-6"><v-alert type="error" variant="tonal">此操作无法恢复，文稿中现有的附件引用会立即失效。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="deleting" @click="deleteTarget = null">取消</v-btn><v-btn color="error" :loading="deleting" @click="deleteAttachment">永久删除</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { max-width: 940px; margin: 0 auto; }.panel-heading { display: flex; align-items: center; gap: 13px; margin-bottom: 24px; }.panel-heading h2 { margin: 0; font-size: 1.15rem; }.panel-heading p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
.upload-box { display: flex; width: 100%; align-items: center; gap: 15px; border: 1px dashed rgba(var(--v-theme-primary), .42); border-radius: 14px; padding: 18px; background: rgba(var(--v-theme-primary), .03); color: inherit; text-align: left; cursor: pointer; }.upload-box:hover { background: rgba(var(--v-theme-primary), .06); }.upload-box.disabled { cursor: wait; opacity: .75; pointer-events: none; }.upload-box > span:not(.upload-cta) { display: flex; min-width: 0; flex: 1; flex-direction: column; }.upload-box small { margin-top: 3px; color: rgb(var(--v-theme-on-surface-variant)); }.upload-cta { border-radius: 8px; padding: 8px 13px; background: rgba(var(--v-theme-primary), .12); color: rgb(var(--v-theme-primary)); font-size: .82rem; font-weight: 650; }
.visually-hidden { position: fixed; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.attachment-list { overflow: hidden; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; }.attachment-list article { display: flex; align-items: center; gap: 12px; padding: 13px; }.attachment-list article + article { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }
.attachment-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.attachment-copy strong, .attachment-copy span, .attachment-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.attachment-copy span, .attachment-copy small { color: rgb(var(--v-theme-on-surface-variant)); font-size: .77rem; }.attachment-copy small { margin-top: 2px; font-family: ui-monospace, monospace; font-size: .69rem; }
.empty-box { display: grid; min-height: 220px; place-items: center; align-content: center; gap: 7px; margin-top: 20px; border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }.empty-box span { font-size: .82rem; }
@media (max-width: 600px) { .upload-box { align-items: flex-start; flex-wrap: wrap; }.upload-box > span { min-width: calc(100% - 70px); }.upload-box > .v-btn { width: 100%; }.attachment-list article { align-items: flex-start; flex-wrap: wrap; }.attachment-copy { min-width: calc(100% - 60px); } }
</style>
