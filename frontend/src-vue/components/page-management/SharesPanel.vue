<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Page } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import type { CreatedShare, ShareAccessRequest, ShareView } from './types'
import { copyText, formatDateTime, toIso, toLocalInput } from './utils'

interface CreateDraft {
  shareType: ShareView['shareType']
  password: string
  role: ShareView['role']
  expiresAt: string
  requireApproval: boolean
  allowCopy: boolean
  allowDownload: boolean
  allowExport: boolean
  allowSearchIndex: boolean
}

interface EditDraft {
  role: ShareView['role']
  expiresAt: string
  requireApproval: boolean
  allowCopy: boolean
  allowDownload: boolean
  allowExport: boolean
  allowSearchIndex: boolean
  password: string
  clearPassword: boolean
}

const props = defineProps<{ page: Page }>()
const ui = useUiStore()
const shares = ref<ShareView[]>([])
const requestsByShare = ref<Record<string, ShareAccessRequest[]>>({})
const loading = ref(false)
const working = ref(false)
const reviewingId = ref('')
const error = ref('')

const createOpen = ref(false)
const createDraft = ref<CreateDraft>(newCreateDraft())
const editingId = ref('')
const editDraft = ref<EditDraft | null>(null)
const issuedUrl = ref('')
const copied = ref(false)
const copyError = ref('')
const resetTarget = ref<ShareView | null>(null)
const revokeTarget = ref<ShareView | null>(null)
const reviewTarget = ref<{ request: ShareAccessRequest; decision: 'APPROVE' | 'REJECT' } | null>(null)

const createPasswordInvalid = computed(() => Boolean(createDraft.value.password) && (createDraft.value.password.length < 8 || createDraft.value.password.length > 200))
const createExpiryInvalid = computed(() => expiryInvalid(createDraft.value.expiresAt))
const editPasswordInvalid = computed(() => Boolean(editDraft.value?.password) && ((editDraft.value?.password.length ?? 0) < 8 || (editDraft.value?.password.length ?? 0) > 200))
const editExpiryInvalid = computed(() => expiryInvalid(editDraft.value?.expiresAt ?? ''))

watch(() => props.page.id, () => void loadShares(), { immediate: true })

function newCreateDraft(): CreateDraft {
  return { shareType: 'PUBLIC', password: '', role: 'READER', expiresAt: '', requireApproval: false, allowCopy: true, allowDownload: false, allowExport: false, allowSearchIndex: false }
}

async function loadShares() {
  loading.value = true
  error.value = ''
  try {
    shares.value = await post<ShareView[]>('/api/v1/shares/list', { resourceType: 'PAGE', resourceId: props.page.id })
    const approvalShares = shares.value.filter((share) => share.requireApproval)
    await Promise.all(approvalShares.map((share) => loadRequests(share, false)))
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
  }
}

async function loadRequests(share: ShareView, reportError = true) {
  try {
    const values = await post<ShareAccessRequest[]>('/api/v1/shares/requests', { shareId: share.id })
    requestsByShare.value = { ...requestsByShare.value, [share.id]: values }
  } catch (value) {
    if (reportError) error.value = messageOf(value)
  }
}

function openCreate() {
  createDraft.value = newCreateDraft()
  createOpen.value = true
}

function setCreateShareType(value: ShareView['shareType']) {
  createDraft.value.shareType = value
  if (value === 'PUBLIC' && createDraft.value.role === 'EDITOR') createDraft.value.role = 'READER'
  if (value === 'INVITE_LINK') createDraft.value.allowSearchIndex = false
}

async function createShare() {
  const draft = createDraft.value
  if (working.value || createPasswordInvalid.value || createExpiryInvalid.value) return
  working.value = true
  error.value = ''
  try {
    const created = await post<CreatedShare>('/api/v1/shares/create', {
      resourceType: 'PAGE',
      resourceId: props.page.id,
      shareType: draft.shareType,
      password: draft.password || null,
      role: draft.role,
      requireApproval: draft.requireApproval,
      expiresAt: toIso(draft.expiresAt),
      allowCopy: draft.allowCopy,
      allowDownload: draft.allowDownload,
      allowExport: draft.allowExport,
      allowComment: draft.role === 'COMMENTER' || draft.role === 'EDITOR',
      allowSearchIndex: draft.shareType === 'PUBLIC' && draft.allowSearchIndex,
    })
    createOpen.value = false
    showIssuedToken(created.token)
    await loadShares()
    ui.notify('分享链接已创建，请立即保存')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

function openEdit(share: ShareView) {
  if (editingId.value === share.id) {
    editingId.value = ''
    editDraft.value = null
    return
  }
  editingId.value = share.id
  editDraft.value = {
    role: share.role,
    expiresAt: toLocalInput(share.expiresAt),
    requireApproval: share.requireApproval,
    allowCopy: share.allowCopy,
    allowDownload: share.allowDownload,
    allowExport: share.allowExport,
    allowSearchIndex: share.allowSearchIndex,
    password: '',
    clearPassword: false,
  }
}

async function updateShare(share: ShareView) {
  const draft = editDraft.value
  if (!draft || working.value || editPasswordInvalid.value || editExpiryInvalid.value) return
  working.value = true
  error.value = ''
  try {
    await post<ShareView>('/api/v1/shares/update', {
      shareId: share.id,
      password: draft.password || null,
      clearPassword: draft.clearPassword,
      role: draft.role,
      requireApproval: draft.requireApproval,
      expiresAt: toIso(draft.expiresAt),
      allowCopy: draft.allowCopy,
      allowDownload: draft.allowDownload,
      allowExport: draft.allowExport,
      allowComment: draft.role === 'COMMENTER' || draft.role === 'EDITOR',
      allowSearchIndex: share.shareType === 'PUBLIC' && draft.allowSearchIndex,
    })
    editingId.value = ''
    editDraft.value = null
    await loadShares()
    ui.notify('分享策略已更新')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

async function resetToken() {
  if (!resetTarget.value || working.value) return
  working.value = true
  error.value = ''
  try {
    const created = await post<CreatedShare>('/api/v1/shares/reset-token', { shareId: resetTarget.value.id })
    resetTarget.value = null
    showIssuedToken(created.token)
    await loadShares()
    ui.notify('令牌已重置，旧链接已失效')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

async function revokeShare() {
  if (!revokeTarget.value || working.value) return
  working.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/shares/revoke', { shareId: revokeTarget.value.id })
    revokeTarget.value = null
    editingId.value = ''
    editDraft.value = null
    await loadShares()
    ui.notify('分享链接已撤销')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

async function reviewRequest() {
  const target = reviewTarget.value
  if (!target || reviewingId.value) return
  reviewingId.value = target.request.id
  error.value = ''
  try {
    await post<ShareAccessRequest>('/api/v1/shares/review-request', { requestId: target.request.id, decision: target.decision })
    const share = shares.value.find((item) => item.id === target.request.shareId)
    reviewTarget.value = null
    if (share) await loadRequests(share)
    ui.notify(target.decision === 'APPROVE' ? '访问申请已通过' : '访问申请已拒绝')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    reviewingId.value = ''
  }
}

function currentRequests(share: ShareView) {
  return (requestsByShare.value[share.id] ?? []).filter((request) => request.policyVersion === share.policyVersion)
}

function pendingCount(share: ShareView) {
  return currentRequests(share).filter((request) => request.status === 'PENDING').length
}

function roleItems(shareType: ShareView['shareType']) {
  const items = [{ title: '只读', value: 'READER' }, { title: '可评论', value: 'COMMENTER' }]
  if (shareType === 'INVITE_LINK') items.push({ title: '可编辑', value: 'EDITOR' })
  return items
}

function roleName(role: ShareView['role']) {
  return ({ READER: '只读', COMMENTER: '可评论', EDITOR: '可编辑' })[role]
}

function expiryInvalid(value: string) {
  if (!value) return false
  const time = new Date(value).getTime()
  return !Number.isFinite(time) || time <= Date.now() + 60_000
}

function showIssuedToken(token: string) {
  issuedUrl.value = `${window.location.origin}/s/${encodeURIComponent(token)}`
  copied.value = false
  copyError.value = ''
}

async function copyIssued() {
  try {
    await copyText(issuedUrl.value)
    copied.value = true
    copyError.value = ''
  } catch {
    copied.value = false
    copyError.value = '浏览器未允许自动复制，请手动复制链接'
  }
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-avatar color="primary" variant="tonal"><v-icon>mdi-link-variant</v-icon></v-avatar>
      <div><h2>分享链接</h2><p>每个链接独立设置密码、有效期和能力；原始令牌只显示一次。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <v-alert v-if="issuedUrl" type="success" variant="tonal" icon="mdi-shield-check-outline" class="issued-link mb-5">
      <div><strong>请立即保存分享链接</strong><span>关闭后无法再次查看；需要时只能重置令牌。</span><code>{{ issuedUrl }}</code><small v-if="copyError">{{ copyError }}</small></div>
      <v-btn variant="tonal" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" @click="copyIssued">{{ copied ? '已复制' : '复制' }}</v-btn>
      <v-btn icon="mdi-close" variant="text" aria-label="关闭令牌提示" @click="issuedUrl = ''" />
    </v-alert>

    <div class="share-toolbar mb-5"><div><strong>{{ shares.length }} 个有效链接</strong><p>修改或撤销一个链接不会影响其他链接；公开链接依赖当前发布快照。</p></div><v-btn color="primary" prepend-icon="mdi-link-plus" @click="openCreate">新建链接</v-btn></div>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5" />

    <div v-if="shares.length" class="share-list">
      <article v-for="share in shares" :key="`${share.id}-${share.policyVersion}`" class="share-item">
        <header>
          <v-avatar color="primary" variant="tonal" size="42"><v-icon>{{ share.shareType === 'INVITE_LINK' ? 'mdi-account-multiple-plus-outline' : share.passwordProtected ? 'mdi-lock-outline' : 'mdi-earth' }}</v-icon></v-avatar>
          <div class="share-copy"><strong>{{ share.shareType === 'INVITE_LINK' ? '邀请链接' : '公开链接' }} · {{ roleName(share.role) }}<template v-if="share.requireApproval"> · 需审批</template></strong><span>策略 v{{ share.policyVersion }} · {{ formatDateTime(share.createdAt) }} 创建<template v-if="share.expiresAt"> · {{ formatDateTime(share.expiresAt) }} 失效</template><template v-else> · 永久有效</template></span><small><template v-if="share.passwordProtected">密码保护 · </template>{{ [share.allowCopy && '可复制', share.allowDownload && '可下载', share.allowExport && '可导出', share.allowComment && '可评论', share.allowSearchIndex && '可收录'].filter(Boolean).join(' · ') || '仅阅读' }}</small></div>
          <v-chip v-if="pendingCount(share)" color="warning" size="small">{{ pendingCount(share) }} 待审批</v-chip>
          <v-btn size="small" variant="text" :prepend-icon="editingId === share.id ? 'mdi-chevron-up' : 'mdi-cog-outline'" @click="openEdit(share)">{{ editingId === share.id ? '收起' : '设置' }}</v-btn>
          <v-btn icon="mdi-refresh" variant="text" title="重置令牌" aria-label="重置分享令牌" @click="resetTarget = share" />
          <v-btn icon="mdi-link-off" variant="text" color="error" title="撤销链接" aria-label="撤销分享链接" @click="revokeTarget = share" />
        </header>

        <div v-if="editingId === share.id && editDraft" class="share-editor">
          <div class="form-grid">
            <v-select v-model="editDraft.role" label="访问角色" variant="outlined" :items="roleItems(share.shareType)" />
            <v-text-field v-model="editDraft.expiresAt" type="datetime-local" label="失效时间" variant="outlined" :error="editExpiryInvalid" :error-messages="editExpiryInvalid ? ['失效时间必须晚于当前时间至少 1 分钟'] : []" />
            <v-text-field v-model="editDraft.password" type="password" label="设置新密码" hint="不修改则留空；8–200 位" persistent-hint maxlength="200" variant="outlined" :disabled="editDraft.clearPassword" :error="editPasswordInvalid" />
            <v-switch v-model="editDraft.clearPassword" label="清除现有密码" color="primary" hide-details @update:model-value="value => { if (value && editDraft) editDraft.password = '' }" />
          </div>
          <div class="switch-grid">
            <v-switch v-model="editDraft.requireApproval" label="需要所有者审批" color="primary" hide-details inset />
            <v-switch v-model="editDraft.allowCopy" label="允许复制" color="primary" hide-details inset />
            <v-switch v-model="editDraft.allowDownload" label="允许下载" color="primary" hide-details inset />
            <v-switch v-model="editDraft.allowExport" label="允许导出" color="primary" hide-details inset />
            <v-switch v-if="share.shareType === 'PUBLIC'" v-model="editDraft.allowSearchIndex" label="搜索引擎收录" color="primary" hide-details inset />
          </div>
          <p class="form-note">角色为“可评论”或“可编辑”时会自动允许评论。后端当前不支持用空值清除有效期。</p>
          <div class="editor-actions"><v-btn color="primary" prepend-icon="mdi-content-save-outline" :loading="working" :disabled="editPasswordInvalid || editExpiryInvalid" @click="updateShare(share)">保存策略</v-btn></div>
        </div>

        <section v-if="share.requireApproval" class="request-section">
          <div class="request-heading"><strong><v-icon size="17">mdi-account-clock-outline</v-icon>访问申请</strong><v-btn size="x-small" variant="text" icon="mdi-refresh" :aria-label="`刷新 ${share.id} 的访问申请`" @click="loadRequests(share)" /></div>
          <div v-if="currentRequests(share).length" class="request-list">
            <div v-for="request in currentRequests(share)" :key="request.id" class="request-item">
              <v-avatar color="primary" variant="tonal" size="34">{{ (request.requesterDisplayName || request.requesterEmail).slice(0, 1).toUpperCase() }}</v-avatar>
              <div><strong>{{ request.requesterDisplayName || request.requesterEmail }}</strong><span>{{ request.requesterEmail }} · {{ formatDateTime(request.createdAt) }}</span><p v-if="request.message">{{ request.message }}</p></div>
              <v-chip :color="request.status === 'PENDING' ? 'warning' : request.status === 'APPROVED' ? 'success' : 'error'" size="x-small" variant="tonal">{{ request.status === 'PENDING' ? '待审批' : request.status === 'APPROVED' ? '已通过' : '已拒绝' }}</v-chip>
              <template v-if="request.status === 'PENDING'">
                <v-btn size="small" variant="text" color="error" :disabled="Boolean(reviewingId)" @click="reviewTarget = { request, decision: 'REJECT' }">拒绝</v-btn>
                <v-btn size="small" variant="tonal" color="primary" :disabled="Boolean(reviewingId)" @click="reviewTarget = { request, decision: 'APPROVE' }">通过</v-btn>
              </template>
            </div>
          </div>
          <p v-else class="request-empty">当前策略还没有访问申请。</p>
        </section>
      </article>
    </div>
    <div v-else-if="!loading" class="empty-box"><v-icon size="42">mdi-link-variant-off</v-icon><strong>还没有分享链接</strong><span>公开链接需要文稿已经发布；邀请链接要求访问者登录。</span><v-btn color="primary" variant="tonal" class="mt-2" @click="openCreate">新建链接</v-btn></div>

    <v-dialog v-model="createOpen" max-width="680" persistent scrollable>
      <v-card>
        <v-card-title class="px-6 pt-5">分享“{{ page.title }}”</v-card-title>
        <v-card-text class="px-6">
          <v-btn-toggle :model-value="createDraft.shareType" mandatory color="primary" variant="outlined" divided class="mb-5" @update:model-value="setCreateShareType">
            <v-btn value="PUBLIC" prepend-icon="mdi-earth">公开访问</v-btn><v-btn value="INVITE_LINK" prepend-icon="mdi-account-multiple-plus-outline">邀请链接</v-btn>
          </v-btn-toggle>
          <v-alert type="info" variant="tonal" class="mb-5">{{ createDraft.shareType === 'PUBLIC' ? '无需登录，可加密码或审批；内容读取当前发布快照。' : '访问者登录后接受邀请并获得持久权限，之后重置令牌不会移除已加入成员。' }}</v-alert>
          <div class="form-grid">
            <v-select v-model="createDraft.role" label="访问角色" variant="outlined" :items="roleItems(createDraft.shareType)" />
            <v-text-field v-model="createDraft.expiresAt" type="datetime-local" label="失效时间（可选）" variant="outlined" :error="createExpiryInvalid" :error-messages="createExpiryInvalid ? ['失效时间必须晚于当前时间至少 1 分钟'] : []" />
            <v-text-field v-model="createDraft.password" type="password" label="访问密码（可选）" hint="8–200 位" persistent-hint maxlength="200" variant="outlined" :error="createPasswordInvalid" :error-messages="createPasswordInvalid ? ['密码长度必须为 8–200 位'] : []" />
          </div>
          <div class="switch-grid">
            <v-switch v-model="createDraft.requireApproval" label="需要所有者审批" color="primary" hide-details inset />
            <v-switch v-model="createDraft.allowCopy" label="允许复制" color="primary" hide-details inset />
            <v-switch v-model="createDraft.allowDownload" label="允许下载" color="primary" hide-details inset />
            <v-switch v-model="createDraft.allowExport" label="允许导出" color="primary" hide-details inset />
            <v-switch v-if="createDraft.shareType === 'PUBLIC'" v-model="createDraft.allowSearchIndex" label="搜索引擎收录" color="primary" hide-details inset />
          </div>
          <v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert>
        </v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="working" @click="createOpen = false">取消</v-btn><v-btn color="primary" prepend-icon="mdi-link-plus" :loading="working" :disabled="createPasswordInvalid || createExpiryInvalid" @click="createShare">创建链接</v-btn></v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(resetTarget)" max-width="520" persistent>
      <v-card><v-card-title class="px-6 pt-5">重置分享令牌？</v-card-title><v-card-text class="px-6"><v-alert type="warning" variant="tonal">旧链接和当前策略下已有的审批申请会立即失效，系统将生成一个只显示一次的新链接。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="working" @click="resetTarget = null">取消</v-btn><v-btn color="warning" :loading="working" @click="resetToken">确认重置</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(revokeTarget)" max-width="520" persistent>
      <v-card><v-card-title class="px-6 pt-5">撤销分享链接？</v-card-title><v-card-text class="px-6"><v-alert type="error" variant="tonal">撤销后链接立即不可访问，且无法恢复。其他分享链接不受影响。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="working" @click="revokeTarget = null">取消</v-btn><v-btn color="error" :loading="working" @click="revokeShare">确认撤销</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(reviewTarget)" max-width="500" persistent>
      <v-card><v-card-title class="px-6 pt-5">{{ reviewTarget?.decision === 'APPROVE' ? '通过访问申请？' : '拒绝访问申请？' }}</v-card-title><v-card-text class="px-6">申请人：{{ reviewTarget?.request.requesterDisplayName || reviewTarget?.request.requesterEmail }}。审批结果会立即生效并通知申请人。<v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="Boolean(reviewingId)" @click="reviewTarget = null">取消</v-btn><v-btn :color="reviewTarget?.decision === 'APPROVE' ? 'primary' : 'error'" :loading="Boolean(reviewingId)" @click="reviewRequest">确认{{ reviewTarget?.decision === 'APPROVE' ? '通过' : '拒绝' }}</v-btn></v-card-actions></v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { max-width: 1000px; margin: 0 auto; }.panel-heading { display: flex; align-items: center; gap: 13px; margin-bottom: 24px; }.panel-heading h2 { margin: 0; font-size: 1.15rem; }.panel-heading p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
.issued-link :deep(.v-alert__content) { display: flex; min-width: 0; align-items: center; gap: 10px; }.issued-link :deep(.v-alert__content) > div { display: flex; min-width: 0; flex: 1; flex-direction: column; }.issued-link span { margin: 2px 0 7px; font-size: .78rem; }.issued-link code { overflow: hidden; border-radius: 7px; padding: 7px 9px; background: rgba(var(--v-theme-on-surface), .07); text-overflow: ellipsis; white-space: nowrap; }.issued-link small { margin-top: 5px; color: rgb(var(--v-theme-error)); }
.share-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; }.share-toolbar p { margin: 3px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .8rem; }
.share-list { display: flex; flex-direction: column; gap: 12px; }.share-item { overflow: hidden; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 13px; }.share-item > header { display: flex; align-items: center; gap: 10px; padding: 13px; }.share-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.share-copy span, .share-copy small { overflow: hidden; margin-top: 2px; color: rgb(var(--v-theme-on-surface-variant)); font-size: .74rem; text-overflow: ellipsis; white-space: nowrap; }.share-copy small { font-size: .69rem; }
.share-editor { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding: 18px; background: rgba(var(--v-theme-on-surface), .018); }.form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 14px; }.switch-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px 14px; }.form-note { margin: 12px 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .77rem; }.editor-actions { display: flex; justify-content: flex-end; }
.request-section { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding: 14px 18px 17px; }.request-heading { display: flex; align-items: center; justify-content: space-between; margin-bottom: 9px; }.request-heading strong { display: flex; align-items: center; gap: 5px; font-size: .84rem; }.request-list { overflow: hidden; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 10px; }.request-item { display: flex; align-items: center; gap: 9px; padding: 10px; }.request-item + .request-item { border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); }.request-item > div { display: flex; min-width: 0; flex: 1; flex-direction: column; }.request-item span { color: rgb(var(--v-theme-on-surface-variant)); font-size: .7rem; }.request-item p { margin: 4px 0 0; font-size: .77rem; }.request-empty { margin: 8px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .78rem; }
.empty-box { display: grid; min-height: 230px; place-items: center; align-content: center; gap: 7px; border: 1px dashed rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 12px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }.empty-box span { max-width: 430px; font-size: .82rem; }
@media (max-width: 760px) { .share-item > header { align-items: flex-start; flex-wrap: wrap; }.share-copy { min-width: calc(100% - 62px); }.share-item > header > .v-chip { margin-left: 52px; }.form-grid, .switch-grid { grid-template-columns: 1fr; }.request-item { align-items: flex-start; flex-wrap: wrap; }.issued-link :deep(.v-alert__content) { align-items: stretch; flex-direction: column; } }
</style>
