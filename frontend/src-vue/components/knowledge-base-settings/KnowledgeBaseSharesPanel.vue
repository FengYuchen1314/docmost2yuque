<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { KnowledgeBase } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import { copyText } from '../page-management/utils'

interface ShareView {
  id: string
  workspaceId: string
  resourceType: 'KNOWLEDGE_BASE'
  resourceId: string
  shareType: 'PUBLIC' | 'INVITE_LINK'
  passwordProtected: boolean
  role: 'READER' | 'COMMENTER' | 'EDITOR'
  requireApproval: boolean
  expiresAt: string | null
  allowCopy: boolean
  allowDownload: boolean
  allowExport: boolean
  allowComment: boolean
  allowSearchIndex: boolean
  policyVersion: number
  createdBy: string
  revokedAt: string | null
  createdAt: string
  updatedAt: string
}
interface CreatedShare { share: ShareView; token: string }
interface AccessRequest { id: string; shareId: string; requesterId: string; requesterEmail: string; requesterDisplayName: string | null; policyVersion: number; message: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string }
interface ShareDraft { shareType: ShareView['shareType']; role: ShareView['role']; password: string; expiresAt: string; requireApproval: boolean; allowCopy: boolean; allowDownload: boolean; allowExport: boolean; allowSearchIndex: boolean }
interface EditDraft { role: ShareView['role']; password: string; clearPassword: boolean; expiresAt: string; requireApproval: boolean; allowCopy: boolean; allowDownload: boolean; allowExport: boolean; allowSearchIndex: boolean }

const props = defineProps<{ knowledgeBase: KnowledgeBase }>()
const ui = useUiStore()
const shares = ref<ShareView[]>([])
const requests = ref<Record<string, AccessRequest[]>>({})
const loading = ref(false)
const working = ref(false)
const reviewing = ref(false)
const error = ref('')
const createOpen = ref(false)
const createDraft = ref<ShareDraft>(freshDraft())
const editingId = ref('')
const editDraft = ref<EditDraft | null>(null)
const issuedUrl = ref('')
const copied = ref(false)
const copyError = ref('')
const resetTarget = ref<ShareView | null>(null)
const revokeTarget = ref<ShareView | null>(null)
const reviewTarget = ref<{ request: AccessRequest; decision: 'APPROVE' | 'REJECT' } | null>(null)

const createPasswordError = computed(() => passwordError(createDraft.value.password))
const createExpiryError = computed(() => expiryError(createDraft.value.expiresAt))
const editPasswordError = computed(() => passwordError(editDraft.value?.password ?? ''))
const editExpiryError = computed(() => expiryError(editDraft.value?.expiresAt ?? ''))

watch(() => props.knowledgeBase.id, () => void loadShares(), { immediate: true })

function freshDraft(): ShareDraft {
  return { shareType: 'PUBLIC', role: 'READER', password: '', expiresAt: '', requireApproval: false, allowCopy: true, allowDownload: false, allowExport: false, allowSearchIndex: false }
}

async function loadShares() {
  loading.value = true
  error.value = ''
  try {
    shares.value = await post<ShareView[]>('/api/v1/shares/list', { resourceType: 'KNOWLEDGE_BASE', resourceId: props.knowledgeBase.id })
    await Promise.all(shares.value.filter((share) => share.requireApproval).map((share) => loadRequests(share, false)))
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
  }
}

async function loadRequests(share: ShareView, report = true) {
  try {
    const values = await post<AccessRequest[]>('/api/v1/shares/requests', { shareId: share.id })
    requests.value = { ...requests.value, [share.id]: values }
  } catch (value) {
    if (report) error.value = messageOf(value)
  }
}

function openCreate() {
  createDraft.value = freshDraft()
  error.value = ''
  createOpen.value = true
}

function changeCreateType(value: ShareView['shareType']) {
  createDraft.value.shareType = value
  if (value === 'PUBLIC' && createDraft.value.role === 'EDITOR') createDraft.value.role = 'READER'
  if (value === 'INVITE_LINK') createDraft.value.allowSearchIndex = false
}

async function createShare() {
  const draft = createDraft.value
  if (working.value || createPasswordError.value || createExpiryError.value) return
  working.value = true
  error.value = ''
  try {
    const created = await post<CreatedShare>('/api/v1/shares/create', {
      resourceType: 'KNOWLEDGE_BASE', resourceId: props.knowledgeBase.id,
      shareType: draft.shareType, password: draft.password || null, role: draft.role,
      requireApproval: draft.requireApproval, expiresAt: toIso(draft.expiresAt),
      allowCopy: draft.allowCopy, allowDownload: draft.allowDownload, allowExport: draft.allowExport,
      allowComment: draft.role === 'COMMENTER' || draft.role === 'EDITOR',
      allowSearchIndex: draft.shareType === 'PUBLIC' && draft.allowSearchIndex,
    })
    createOpen.value = false
    showToken(created.token)
    await loadShares()
    ui.notify('知识库分享链接已创建，请立即保存')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

function toggleEdit(share: ShareView) {
  error.value = ''
  if (editingId.value === share.id) {
    editingId.value = ''
    editDraft.value = null
    return
  }
  editingId.value = share.id
  editDraft.value = {
    role: share.role, password: '', clearPassword: false, expiresAt: toLocalInput(share.expiresAt),
    requireApproval: share.requireApproval, allowCopy: share.allowCopy, allowDownload: share.allowDownload,
    allowExport: share.allowExport, allowSearchIndex: share.allowSearchIndex,
  }
}

async function updateShare(share: ShareView) {
  const draft = editDraft.value
  if (!draft || working.value || editPasswordError.value || editExpiryError.value) return
  working.value = true
  error.value = ''
  try {
    await post<ShareView>('/api/v1/shares/update', {
      shareId: share.id, password: draft.password || null, clearPassword: draft.clearPassword,
      role: draft.role, requireApproval: draft.requireApproval, expiresAt: toIso(draft.expiresAt),
      allowCopy: draft.allowCopy, allowDownload: draft.allowDownload, allowExport: draft.allowExport,
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
    showToken(created.token)
    await loadShares()
    ui.notify('令牌已重置，旧链接已失效')
  } catch (value) { error.value = messageOf(value) } finally { working.value = false }
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
  } catch (value) { error.value = messageOf(value) } finally { working.value = false }
}

async function reviewRequest() {
  const target = reviewTarget.value
  if (!target || reviewing.value) return
  reviewing.value = true
  error.value = ''
  try {
    await post<AccessRequest>('/api/v1/shares/review-request', { requestId: target.request.id, decision: target.decision })
    const share = shares.value.find((item) => item.id === target.request.shareId)
    reviewTarget.value = null
    if (share) await loadRequests(share)
    ui.notify(target.decision === 'APPROVE' ? '访问申请已通过' : '访问申请已拒绝')
  } catch (value) { error.value = messageOf(value) } finally { reviewing.value = false }
}

function currentRequests(share: ShareView) {
  return (requests.value[share.id] ?? []).filter((request) => request.policyVersion === share.policyVersion)
}
function pendingCount(share: ShareView) { return currentRequests(share).filter((request) => request.status === 'PENDING').length }
function roleItems(type: ShareView['shareType']) { return type === 'INVITE_LINK' ? [{ title: '只读', value: 'READER' }, { title: '可评论', value: 'COMMENTER' }, { title: '可编辑', value: 'EDITOR' }] : [{ title: '只读', value: 'READER' }, { title: '可评论', value: 'COMMENTER' }] }
function roleName(value: ShareView['role']) { return ({ READER: '只读', COMMENTER: '可评论', EDITOR: '可编辑' })[value] }
function passwordError(value: string) { return value && (value.length < 8 || value.length > 200) ? '密码长度必须为 8–200 位' : '' }
function expiryError(value: string) { if (!value) return ''; const time = new Date(value).getTime(); return !Number.isFinite(time) || time <= Date.now() + 60_000 ? '到期时间必须晚于当前时间至少 1 分钟' : '' }
function toIso(value: string) { return value ? new Date(value).toISOString() : null }
function toLocalInput(value: string | null) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16) }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function showToken(token: string) { issuedUrl.value = `${window.location.origin}/s/${encodeURIComponent(token)}`; copied.value = false; copyError.value = '' }
async function copyToken() { try { await copyText(issuedUrl.value); copied.value = true; copyError.value = '' } catch { copied.value = false; copyError.value = '浏览器未允许自动复制，请手动复制链接' } }
</script>

<template>
  <v-card class="section-card share-panel" variant="flat">
    <v-card-title class="panel-title px-6 pt-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-key-chain-variant</v-icon></v-avatar><div><h2>分享与访问</h2><p>为整个知识库创建独立链接，并分别控制访问策略与审批。</p></div></v-card-title>
    <v-card-text class="px-6 pb-7">
      <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error=''">{{error}}</v-alert>
      <v-alert v-if="issuedUrl" type="success" variant="tonal" icon="mdi-shield-check-outline" class="issued mb-5"><div><strong>请立即保存分享链接</strong><span>原始令牌关闭后无法再次查看，只能重置。</span><code>{{issuedUrl}}</code><small v-if="copyError">{{copyError}}</small></div><v-btn variant="tonal" :prepend-icon="copied?'mdi-check':'mdi-content-copy'" @click="copyToken">{{copied?'已复制':'复制'}}</v-btn><v-btn icon="mdi-close" variant="text" @click="issuedUrl=''"/></v-alert>
      <div class="toolbar mb-5"><div><strong>{{shares.length}} 个有效链接</strong><p>知识库链接只展示已有发布快照；目录外内容与未发布草稿不会暴露。</p></div><v-btn color="primary" prepend-icon="mdi-link-plus" @click="openCreate">新建链接</v-btn></div>
      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5"/>
      <div v-if="shares.length" class="share-list">
        <article v-for="share in shares" :key="`${share.id}-${share.policyVersion}`">
          <header><v-avatar color="primary" variant="tonal"><v-icon>{{share.shareType==='INVITE_LINK'?'mdi-account-multiple-plus-outline':share.passwordProtected?'mdi-lock-outline':'mdi-earth'}}</v-icon></v-avatar><div class="share-copy"><strong>{{share.shareType==='INVITE_LINK'?'邀请链接':'公开链接'}} · {{roleName(share.role)}}<template v-if="share.requireApproval"> · 需审批</template></strong><span>策略 v{{share.policyVersion}} · {{formatTime(share.createdAt)}} 创建<template v-if="share.expiresAt"> · {{formatTime(share.expiresAt)}} 到期</template><template v-else> · 永久有效</template></span><small><template v-if="share.passwordProtected">密码保护 · </template>{{[share.allowCopy&&'可复制',share.allowDownload&&'可下载',share.allowExport&&'可导出',share.allowComment&&'可评论',share.allowSearchIndex&&'可收录'].filter(Boolean).join(' · ')||'仅阅读'}}</small></div><v-chip v-if="pendingCount(share)" color="warning" size="small">{{pendingCount(share)}} 待审批</v-chip><v-btn size="small" variant="text" prepend-icon="mdi-cog-outline" @click="toggleEdit(share)">{{editingId===share.id?'收起':'设置'}}</v-btn><v-btn icon="mdi-refresh" variant="text" title="重置令牌" @click="error='';resetTarget=share"/><v-btn icon="mdi-link-off" variant="text" color="error" title="撤销链接" @click="error='';revokeTarget=share"/></header>
          <div v-if="editingId===share.id&&editDraft" class="editor"><div class="form-grid"><v-select v-model="editDraft.role" label="访问角色" :items="roleItems(share.shareType)"/><v-text-field v-model="editDraft.expiresAt" type="datetime-local" label="到期时间" :error-messages="editExpiryError"/><v-text-field v-model="editDraft.password" type="password" label="新密码（留空不修改）" maxlength="200" :disabled="editDraft.clearPassword" :error-messages="editPasswordError"/><v-switch v-model="editDraft.clearPassword" label="清除现有密码" color="primary" @update:model-value="value=>{if(value&&editDraft)editDraft.password=''}"/></div><div class="switch-grid"><v-switch v-model="editDraft.requireApproval" label="需要审批" color="primary" inset/><v-switch v-model="editDraft.allowCopy" label="允许复制" color="primary" inset/><v-switch v-model="editDraft.allowDownload" label="允许下载" color="primary" inset/><v-switch v-model="editDraft.allowExport" label="允许导出" color="primary" inset/><v-switch v-if="share.shareType==='PUBLIC'" v-model="editDraft.allowSearchIndex" label="搜索引擎收录" color="primary" inset/></div><p class="hint">可评论/可编辑角色会自动允许评论。后端当前不支持用空值清除已有到期时间。</p><v-alert v-if="error" type="error" variant="tonal" class="mb-3">{{error}}</v-alert><div class="actions"><v-btn color="primary" :loading="working" :disabled="Boolean(editPasswordError||editExpiryError)" @click="updateShare(share)">保存策略</v-btn></div></div>
          <section v-if="share.requireApproval" class="approvals"><div class="approval-head"><strong>访问申请</strong><v-btn icon="mdi-refresh" size="x-small" variant="text" @click="loadRequests(share)"/></div><div v-if="currentRequests(share).length" class="request-list"><div v-for="request in currentRequests(share)" :key="request.id"><v-avatar size="34" color="primary" variant="tonal">{{(request.requesterDisplayName||request.requesterEmail).slice(0,1).toUpperCase()}}</v-avatar><span class="request-copy"><strong>{{request.requesterDisplayName||request.requesterEmail}}</strong><small>{{request.requesterEmail}} · {{formatTime(request.createdAt)}}</small><p v-if="request.message">{{request.message}}</p></span><v-chip :color="request.status==='PENDING'?'warning':request.status==='APPROVED'?'success':'error'" size="x-small">{{request.status==='PENDING'?'待审批':request.status==='APPROVED'?'已通过':'已拒绝'}}</v-chip><template v-if="request.status==='PENDING'"><v-btn size="small" variant="text" color="error" @click="error='';reviewTarget={request,decision:'REJECT'}">拒绝</v-btn><v-btn size="small" variant="tonal" color="primary" @click="error='';reviewTarget={request,decision:'APPROVE'}">通过</v-btn></template></div></div><p v-else class="hint">当前策略还没有访问申请。</p></section>
        </article>
      </div>
      <div v-else-if="!loading" class="empty"><v-icon size="42">mdi-link-variant-off</v-icon><strong>还没有分享链接</strong><span>公开链接可加密码或审批；邀请链接要求访问者登录。</span></div>
    </v-card-text>

    <v-dialog v-model="createOpen" max-width="680" persistent scrollable><v-card><v-card-title class="px-6 pt-5">分享“{{knowledgeBase.name}}”</v-card-title><v-card-text class="px-6"><v-btn-toggle :model-value="createDraft.shareType" mandatory color="primary" class="mb-5" @update:model-value="changeCreateType"><v-btn value="PUBLIC">公开访问</v-btn><v-btn value="INVITE_LINK">邀请链接</v-btn></v-btn-toggle><v-alert type="info" variant="tonal" class="mb-5">{{createDraft.shareType==='PUBLIC'?'无需登录；知识库中仅展示已有发布快照。':'访问者登录接受后获得持久权限，之后重置链接不会移除已加入成员。'}}</v-alert><div class="form-grid"><v-select v-model="createDraft.role" label="访问角色" :items="roleItems(createDraft.shareType)"/><v-text-field v-model="createDraft.expiresAt" type="datetime-local" label="到期时间（可选）" :error-messages="createExpiryError"/><v-text-field v-model="createDraft.password" type="password" label="访问密码（可选，8–200 位）" maxlength="200" :error-messages="createPasswordError"/></div><div class="switch-grid"><v-switch v-model="createDraft.requireApproval" label="需要审批" color="primary" inset/><v-switch v-model="createDraft.allowCopy" label="允许复制" color="primary" inset/><v-switch v-model="createDraft.allowDownload" label="允许下载" color="primary" inset/><v-switch v-model="createDraft.allowExport" label="允许导出" color="primary" inset/><v-switch v-if="createDraft.shareType==='PUBLIC'" v-model="createDraft.allowSearchIndex" label="搜索引擎收录" color="primary" inset/></div><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{error}}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer/><v-btn :disabled="working" @click="createOpen=false">取消</v-btn><v-btn color="primary" :loading="working" :disabled="Boolean(createPasswordError||createExpiryError)" @click="createShare">创建链接</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(resetTarget)" max-width="520" persistent><v-card><v-card-title class="px-6 pt-5">重置分享令牌？</v-card-title><v-card-text class="px-6"><v-alert type="warning" variant="tonal">旧链接和当前策略下已有审批会立即失效，新令牌只显示一次。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{error}}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer/><v-btn :disabled="working" @click="resetTarget=null">取消</v-btn><v-btn color="warning" :loading="working" @click="resetToken">确认重置</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(revokeTarget)" max-width="520" persistent><v-card><v-card-title class="px-6 pt-5">撤销分享链接？</v-card-title><v-card-text class="px-6"><v-alert type="error" variant="tonal">撤销后链接立即不可访问且无法恢复，其他链接不受影响。</v-alert><v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{error}}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer/><v-btn :disabled="working" @click="revokeTarget=null">取消</v-btn><v-btn color="error" :loading="working" @click="revokeShare">确认撤销</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(reviewTarget)" max-width="500" persistent><v-card><v-card-title class="px-6 pt-5">{{reviewTarget?.decision==='APPROVE'?'通过访问申请？':'拒绝访问申请？'}}</v-card-title><v-card-text class="px-6">申请人：{{reviewTarget?.request.requesterDisplayName||reviewTarget?.request.requesterEmail}}。结果会立即生效并通知申请人。<v-alert v-if="error" type="error" variant="tonal" class="mt-3">{{error}}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer/><v-btn :disabled="reviewing" @click="reviewTarget=null">取消</v-btn><v-btn :color="reviewTarget?.decision==='APPROVE'?'primary':'error'" :loading="reviewing" @click="reviewRequest">确认{{reviewTarget?.decision==='APPROVE'?'通过':'拒绝'}}</v-btn></v-card-actions></v-card></v-dialog>
  </v-card>
</template>

<style scoped>
.share-panel{overflow:hidden}.panel-title{display:flex;align-items:center;gap:13px}.panel-title h2{margin:0;font-size:1.1rem}.panel-title p,.toolbar p{margin:3px 0 0;color:rgb(var(--v-theme-on-surface-variant));font-size:.8rem}.toolbar{display:flex;align-items:center;justify-content:space-between;gap:16px}.issued :deep(.v-alert__content){display:flex;align-items:center;gap:9px}.issued :deep(.v-alert__content)>div{display:flex;min-width:0;flex:1;flex-direction:column}.issued code{overflow:hidden;margin-top:6px;border-radius:6px;padding:6px 8px;background:rgba(var(--v-theme-on-surface),.07);text-overflow:ellipsis;white-space:nowrap}.issued span,.issued small{font-size:.75rem}.issued small{color:rgb(var(--v-theme-error))}.share-list{display:flex;flex-direction:column;gap:12px}.share-list>article{overflow:hidden;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:12px}.share-list>article>header{display:flex;align-items:center;gap:9px;padding:13px}.share-copy{display:flex;min-width:0;flex:1;flex-direction:column}.share-copy span,.share-copy small{overflow:hidden;color:rgb(var(--v-theme-on-surface-variant));font-size:.72rem;text-overflow:ellipsis;white-space:nowrap}.editor,.approvals{border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity));padding:17px;background:rgba(var(--v-theme-on-surface),.018)}.form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 14px}.switch-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px 12px}.hint{margin:8px 0;color:rgb(var(--v-theme-on-surface-variant));font-size:.76rem}.actions,.approval-head{display:flex;justify-content:flex-end}.approval-head{align-items:center;justify-content:space-between}.request-list{overflow:hidden;border:1px solid rgba(var(--v-border-color),var(--v-border-opacity));border-radius:9px}.request-list>div{display:flex;align-items:center;gap:8px;padding:9px}.request-list>div+div{border-top:1px solid rgba(var(--v-border-color),var(--v-border-opacity))}.request-copy{display:flex;min-width:0;flex:1;flex-direction:column}.request-copy small{color:rgb(var(--v-theme-on-surface-variant));font-size:.69rem}.request-copy p{margin:3px 0 0;font-size:.76rem}.empty{display:grid;min-height:220px;place-items:center;align-content:center;gap:7px;border:1px dashed rgba(var(--v-border-color),var(--v-border-opacity));border-radius:12px;color:rgb(var(--v-theme-on-surface-variant));text-align:center}.empty span{font-size:.8rem}@media(max-width:720px){.form-grid,.switch-grid{grid-template-columns:1fr}.share-list>article>header{align-items:flex-start;flex-wrap:wrap}.share-copy{min-width:calc(100% - 58px)}.issued :deep(.v-alert__content){align-items:stretch;flex-direction:column}}
</style>
