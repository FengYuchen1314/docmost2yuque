<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Team, Workspace } from '../../../src/types'
import { get, messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

type AdminTab = 'access' | 'users' | 'smtp' | 'invitations' | 'moderation' | 'operations'
type UserStatus = 'PENDING' | 'ACTIVE' | 'SUSPENDED'
type ReportStatus = 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'
type InvitationStatus = 'QUEUED' | 'SENT' | 'FAILED' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'
type KnowledgeBaseRole = 'MANAGER' | 'EDITOR' | 'READER'

interface PageResult<T> { items: T[]; nextOffset: number; hasMore: boolean }
interface RegistrationSettings { registrationMode: 'CLOSED' | 'PUBLIC'; passwordLoginEnabled: boolean; emailCodeLoginEnabled: boolean; smtpReady: boolean; settingsVersion: number }
interface SmtpSettings { host: string | null; port: number | null; security: 'NONE' | 'STARTTLS' | 'TLS' | null; username: string | null; hasPassword: boolean; fromName: string | null; fromAddress: string | null; replyTo: string | null; enabled: boolean; configurationVersion: number; testedAt: string | null; testStatus: string | null; lastErrorCode: string | null; ready: boolean }
interface InstanceUser { userId: string; email: string; displayName: string | null; status: UserStatus; emailVerifiedAt: string | null; instanceRole: 'OWNER' | 'ADMIN' | 'USER'; workspaceCount: number; lastSeenAt: string | null; createdAt: string }
interface Invitation { id: string; workspaceId: string; email: string; workspaceRole: 'ADMIN' | 'MEMBER' | 'EXTERNAL'; targetTeamIds: string[]; targetKnowledgeBaseRoles: Array<{ knowledgeBaseId: string; role: KnowledgeBaseRole }>; status: InvitationStatus; expiresAt: string; sentAt: string | null }
interface SocialReport { id: string; reporterId: string; targetType: 'USER' | 'GARDEN' | 'PUBLICATION'; targetId: string; reason: string; details: string | null; status: ReportStatus; reviewedBy: string | null; reviewedAt: string | null; resolution: string | null; createdAt: string }
interface SearchRebuild { id: string; workspaceId: string; status: 'RUNNING' | 'PAUSED' | 'SUCCEEDED' | 'FAILED'; cursorType: 'KNOWLEDGE_BASE' | 'TEAM' | 'PAGE' | 'QUICK_NOTE' | 'TEMPLATE' | 'ATTACHMENT' | 'PUBLICATION' | 'CLEANUP' | 'DONE'; cursorId: string | null; processedCount: number; errorCount: number; requestedBy: string; startedAt: string; updatedAt: string; completedAt: string | null; lastError: string | null }

const session = useSessionStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const tab = ref<AdminTab>(normaliseTab(route.query.tab))
const loading = ref(false)
const busy = ref('')
const error = ref('')

const tabs: Array<{ value: AdminTab; title: string; icon: string }> = [
  { value: 'access', title: '登录与注册', icon: 'mdi-login-variant' },
  { value: 'users', title: '用户管理', icon: 'mdi-account-group-outline' },
  { value: 'smtp', title: '邮件服务', icon: 'mdi-email-outline' },
  { value: 'invitations', title: '成员邀请', icon: 'mdi-account-plus-outline' },
  { value: 'moderation', title: '内容治理', icon: 'mdi-shield-search-outline' },
  { value: 'operations', title: '系统运维', icon: 'mdi-database-cog-outline' },
]
const organisationWorkspaces = computed(() => session.workspaces.filter((workspace) => workspace.workspaceType === 'ORGANIZATION'))

const auth = ref<RegistrationSettings | null>(null)
const smtp = ref<SmtpSettings | null>(null)
const smtpDraft = reactive({ host: '', port: 587, security: 'STARTTLS' as 'NONE' | 'STARTTLS' | 'TLS', username: '', password: '', clearPassword: false, fromName: 'Knowledge', fromAddress: '', replyTo: '', enabled: true })
const smtpRecipient = ref('')
const smtpPollRemaining = ref(0)

const userQuery = ref('')
const userStatus = ref<'ALL' | UserStatus>('ALL')
const users = ref<InstanceUser[]>([])
const userOffset = ref(0)
const usersMore = ref(false)

const invitationWorkspaceId = ref('')
const invitationEmail = ref('')
const invitationRole = ref<Invitation['workspaceRole']>('MEMBER')
const invitationExpiry = ref(168)
const invitationTeams = ref<string[]>([])
const invitationKnowledgeBases = reactive<Record<string, KnowledgeBaseRole>>({})
const teams = ref<Team[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const invitations = ref<Invitation[]>([])
const invitationOffset = ref(0)
const invitationsMore = ref(false)

const reportStatus = ref<'ALL' | ReportStatus>('OPEN')
const reports = ref<SocialReport[]>([])
const reportOffset = ref(0)
const reportsMore = ref(false)
const reportResolutions = reactive<Record<string, string>>({})

const rebuildWorkspaceId = ref('')
const rebuilds = ref<SearchRebuild[]>([])
const rebuildOffset = ref(0)
const rebuildsMore = ref(false)
const runningRebuildId = ref('')
const stopRequested = ref(false)

const confirmation = reactive({ open: false, title: '', text: '', confirmText: '确认', color: 'error', loading: false, action: null as null | (() => Promise<void>) })
let pollTimer: number | undefined
let pollTick = 0

onMounted(() => {
  pollTimer = window.setInterval(() => void poll(), 2_000)
  void loadActiveTab()
})
onBeforeUnmount(() => {
  stopRequested.value = true
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
})

watch(() => route.query.tab, (value) => { const next = normaliseTab(value); if (next !== tab.value) tab.value = next })
watch(tab, (value) => {
  const query = { ...route.query }
  if (value === 'access') delete query.tab; else query.tab = value
  void router.replace({ query })
  error.value = ''
  void loadActiveTab()
})
watch(() => session.workspaces.map((workspace) => workspace.id).join(','), () => {
  ensureWorkspaceSelections()
  if (tab.value === 'invitations' || tab.value === 'operations') void loadActiveTab()
})
watch(userStatus, () => { if (tab.value === 'users') void loadUsers(true) })
watch(reportStatus, () => { if (tab.value === 'moderation') void loadReports(true) })
watch(invitationWorkspaceId, () => {
  clearInvitationTargets()
  if (tab.value === 'invitations' && invitationWorkspaceId.value) void Promise.all([loadInvitationResources(), loadInvitations(true)])
})
watch(rebuildWorkspaceId, () => { if (tab.value === 'operations' && rebuildWorkspaceId.value) void loadRebuilds(true) })

function normaliseTab(value: unknown): AdminTab {
  return value === 'users' || value === 'smtp' || value === 'invitations' || value === 'moderation' || value === 'operations' ? value : 'access'
}
function ensureWorkspaceSelections() {
  if (!organisationWorkspaces.value.some((workspace) => workspace.id === invitationWorkspaceId.value)) invitationWorkspaceId.value = organisationWorkspaces.value[0]?.id ?? ''
  if (!session.workspaces.some((workspace) => workspace.id === rebuildWorkspaceId.value)) rebuildWorkspaceId.value = session.activeWorkspace?.id ?? session.workspaces[0]?.id ?? ''
}
async function loadActiveTab() {
  ensureWorkspaceSelections()
  if (tab.value === 'access') await loadAuth()
  else if (tab.value === 'users') await loadUsers(true)
  else if (tab.value === 'smtp') await loadSmtp(true)
  else if (tab.value === 'invitations' && invitationWorkspaceId.value) await Promise.all([loadInvitationResources(), loadInvitations(true)])
  else if (tab.value === 'moderation') await loadReports(true)
  else if (tab.value === 'operations' && rebuildWorkspaceId.value) await loadRebuilds(true)
}
async function guarded(key: string, action: () => Promise<void>) {
  busy.value = key; error.value = ''
  try { await action() } catch (value) { error.value = messageOf(value) } finally { busy.value = '' }
}
function ask(title: string, text: string, confirmText: string, action: () => Promise<void>, color = 'error') {
  Object.assign(confirmation, { open: true, title, text, confirmText, color, loading: false, action })
}
async function confirmAction() {
  if (!confirmation.action) return
  confirmation.loading = true; error.value = ''
  try { await confirmation.action(); confirmation.open = false } catch (value) { error.value = messageOf(value) } finally { confirmation.loading = false }
}

async function loadAuth() {
  loading.value = true; error.value = ''
  try { auth.value = await get<RegistrationSettings>('/api/v1/admin/auth-settings') } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function saveAuth() {
  if (!auth.value) return
  await guarded('auth-save', async () => {
    auth.value = await post<RegistrationSettings>('/api/v1/admin/auth-settings/registration', { registrationMode: auth.value!.registrationMode, passwordLoginEnabled: auth.value!.passwordLoginEnabled, emailCodeLoginEnabled: auth.value!.emailCodeLoginEnabled })
    ui.notify('登录与注册策略已保存')
  })
}

function hydrateSmtp(value: SmtpSettings) {
  Object.assign(smtpDraft, { host: value.host ?? '', port: value.port ?? 587, security: value.security ?? 'STARTTLS', username: value.username ?? '', password: '', clearPassword: false, fromName: value.fromName ?? 'Knowledge', fromAddress: value.fromAddress ?? '', replyTo: value.replyTo ?? '', enabled: value.enabled })
}
async function loadSmtp(hydrate = false) {
  loading.value = true; error.value = ''
  try { const value = await get<SmtpSettings>('/api/v1/admin/smtp'); smtp.value = value; if (hydrate) hydrateSmtp(value) } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function saveSmtp() {
  await guarded('smtp-save', async () => {
    const value = await post<SmtpSettings>('/api/v1/admin/smtp/update', { ...smtpDraft, port: Number(smtpDraft.port), password: smtpDraft.password || null, replyTo: smtpDraft.replyTo || null })
    smtp.value = value; hydrateSmtp(value); auth.value = null; ui.notify('SMTP 配置已加密保存')
  })
}
async function testSmtp() {
  await guarded('smtp-test', async () => {
    await post('/api/v1/admin/smtp/test', { recipient: smtpRecipient.value.trim() || null })
    smtpPollRemaining.value = 15
    ui.notify('测试邮件已进入投递队列', 'info')
  })
}

async function loadUsers(reset: boolean) {
  if (loading.value && reset) return
  loading.value = true; error.value = ''
  try {
    const page = await post<PageResult<InstanceUser>>('/api/v1/admin/users/page', { query: userQuery.value.trim() || null, status: userStatus.value, limit: 30, offset: reset ? 0 : userOffset.value })
    users.value = reset ? page.items : [...users.value, ...page.items]; userOffset.value = page.nextOffset; usersMore.value = page.hasMore
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
function userProtected(user: InstanceUser) { return user.instanceRole === 'OWNER' || user.userId === session.user?.userId }
function confirmUserAction(user: InstanceUser, operation: 'activate' | 'suspend' | 'grant' | 'revoke') {
  const copies: Record<typeof operation, { title: string; text: string; confirmText: string; color: string }> = {
    activate: { title: `恢复 ${user.email}`, text: '恢复后用户可以重新登录。', confirmText: '恢复账号', color: 'primary' },
    suspend: { title: `停用 ${user.email}`, text: '账号将无法登录，现有会话会立即失效。之后仍可恢复。', confirmText: '停用账号', color: 'error' },
    grant: { title: `授予 ${user.email} 管理员权限`, text: '该用户将能管理实例注册、SMTP、邀请和所有用户，并需重新登录。', confirmText: '授予权限', color: 'primary' },
    revoke: { title: `撤销 ${user.email} 的管理员权限`, text: '该用户全部登录设备会立即退出，下次登录仅保留普通用户权限。', confirmText: '撤销权限', color: 'error' },
  }
  const copy = copies[operation]
  ask(copy.title, copy.text, copy.confirmText, async () => {
    busy.value = `user-${user.userId}`
    try {
      if (operation === 'activate' || operation === 'suspend') await post('/api/v1/admin/users/status', { userId: user.userId, status: operation === 'activate' ? 'ACTIVE' : 'SUSPENDED' })
      else await post('/api/v1/admin/users/administrator', { userId: user.userId, administrator: operation === 'grant' })
      await loadUsers(true); ui.notify('用户权限已更新')
    } finally { busy.value = '' }
  }, copy.color)
}

function clearInvitationTargets() { invitationTeams.value = []; for (const key of Object.keys(invitationKnowledgeBases)) delete invitationKnowledgeBases[key] }
function toggleInvitationKnowledgeBase(knowledgeBaseId: string, selected: boolean) { if (selected) invitationKnowledgeBases[knowledgeBaseId] = 'READER'; else delete invitationKnowledgeBases[knowledgeBaseId] }
function setInvitationKnowledgeBaseRole(knowledgeBaseId: string, value: unknown) { if (value === 'MANAGER' || value === 'EDITOR' || value === 'READER') invitationKnowledgeBases[knowledgeBaseId] = value }
async function loadInvitationResources() {
  if (!invitationWorkspaceId.value) return
  try { [teams.value, knowledgeBases.value] = await Promise.all([post<Team[]>('/api/v1/teams/list', { workspaceId: invitationWorkspaceId.value }), post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: invitationWorkspaceId.value })]) } catch (value) { error.value = messageOf(value) }
}
async function loadInvitations(reset: boolean, preserve = false) {
  if (!invitationWorkspaceId.value) return
  if (!preserve) loading.value = true
  try {
    const limit = preserve ? Math.min(Math.max(invitations.value.length, 30), 200) : 30
    const page = await post<PageResult<Invitation>>('/api/v1/admin/invitations/page', { workspaceId: invitationWorkspaceId.value, limit, offset: reset ? 0 : invitationOffset.value })
    invitations.value = reset ? page.items : [...invitations.value, ...page.items]; invitationOffset.value = page.nextOffset; invitationsMore.value = page.hasMore
  } catch (value) { if (!preserve) error.value = messageOf(value) } finally { if (!preserve) loading.value = false }
}
async function createInvitation() {
  await guarded('invitation-create', async () => {
    await post('/api/v1/admin/invitations/create', { workspaceId: invitationWorkspaceId.value, email: invitationEmail.value.trim(), workspaceRole: invitationRole.value, targetTeamIds: invitationTeams.value, targetKnowledgeBaseRoles: Object.entries(invitationKnowledgeBases).map(([knowledgeBaseId, role]) => ({ knowledgeBaseId, role })), expiresInHours: invitationExpiry.value })
    invitationEmail.value = ''; clearInvitationTargets(); await loadInvitations(true); ui.notify('邀请已创建并进入邮件队列')
  })
}
async function resendInvitation(invitation: Invitation) {
  await guarded(`invite-${invitation.id}`, async () => { await post('/api/v1/admin/invitations/resend', { invitationId: invitation.id }); await loadInvitations(true); ui.notify('邀请已重新排队') })
}
function confirmRevokeInvitation(invitation: Invitation) {
  ask(`撤销发给 ${invitation.email} 的邀请`, '撤销后邀请链接立即失效，且无法恢复。', '撤销邀请', async () => { await post('/api/v1/admin/invitations/revoke', { invitationId: invitation.id }); await loadInvitations(true); ui.notify('邀请已撤销') })
}
function invitationTargets(invitation: Invitation) {
  const teamNames = invitation.targetTeamIds.map((id) => teams.value.find((team) => team.id === id)?.name ?? '已删除团队')
  const kbNames = invitation.targetKnowledgeBaseRoles.map((target) => `${knowledgeBases.value.find((kb) => kb.id === target.knowledgeBaseId)?.name ?? '已删除知识库'}（${kbRoleLabel(target.role)}）`)
  return [...teamNames, ...kbNames].join('、')
}

async function loadReports(reset: boolean) {
  loading.value = true; error.value = ''
  try {
    const page = await post<PageResult<SocialReport>>('/api/v1/admin/social/reports/page', { status: reportStatus.value === 'ALL' ? null : reportStatus.value, limit: 30, offset: reset ? 0 : reportOffset.value })
    reports.value = reset ? page.items : [...reports.value, ...page.items]; reportOffset.value = page.nextOffset; reportsMore.value = page.hasMore
    for (const report of page.items) if (!(report.id in reportResolutions)) reportResolutions[report.id] = report.resolution ?? ''
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function reviewReport(report: SocialReport, status: Exclude<ReportStatus, 'OPEN'>) {
  const resolution = reportResolutions[report.id]?.trim() || null
  await guarded(`report-${report.id}`, async () => { await post('/api/v1/admin/social/reports/review', { reportId: report.id, status, resolution }); await loadReports(true); ui.notify('举报状态已更新') })
}
function confirmReview(report: SocialReport, status: 'RESOLVED' | 'DISMISSED') {
  ask(status === 'RESOLVED' ? '确认完成处理' : '确认驳回举报', status === 'RESOLVED' ? '审核结论会保存到治理记录。' : '举报将标记为已驳回，请确认处理说明准确。', status === 'RESOLVED' ? '完成处理' : '驳回举报', () => reviewReport(report, status), status === 'RESOLVED' ? 'primary' : 'error')
}

async function loadRebuilds(reset: boolean, preserve = false) {
  if (!rebuildWorkspaceId.value) return
  if (!preserve) loading.value = true
  try {
    const limit = preserve ? Math.min(Math.max(rebuilds.value.length, 20), 100) : 20
    const page = await post<PageResult<SearchRebuild>>('/api/v1/search/rebuild/page', { workspaceId: rebuildWorkspaceId.value, limit, offset: reset ? 0 : rebuildOffset.value })
    rebuilds.value = reset ? page.items : [...rebuilds.value, ...page.items]; rebuildOffset.value = page.nextOffset; rebuildsMore.value = page.hasMore
  } catch (value) { if (!preserve) error.value = messageOf(value) } finally { if (!preserve) loading.value = false }
}
function confirmStartRebuild() {
  const workspace = session.workspaces.find((item) => item.id === rebuildWorkspaceId.value)
  ask('新建全量索引任务', `将为「${workspace?.name ?? '当前空间'}」逐批重建全部可搜索资源。运行期间增量索引仍可使用。`, '开始重建', async () => { await post('/api/v1/search/rebuild/start', { workspaceId: rebuildWorkspaceId.value }); await loadRebuilds(true); ui.notify('索引重建任务已创建') }, 'primary')
}
async function rebuildAction(job: SearchRebuild, operation: 'advance' | 'pause' | 'resume') {
  await guarded(`rebuild-${job.id}`, async () => { const value = await post<SearchRebuild>(`/api/v1/search/rebuild/${operation}`, { rebuildId: job.id, batchSize: operation === 'advance' ? 500 : undefined }); replaceRebuild(value); ui.notify(operation === 'pause' ? '任务已暂停' : operation === 'resume' ? '任务已恢复' : '已处理一批索引') })
}
function replaceRebuild(value: SearchRebuild) { const index = rebuilds.value.findIndex((item) => item.id === value.id); if (index >= 0) rebuilds.value[index] = value; else rebuilds.value.unshift(value) }
async function runToCompletion(initial: SearchRebuild) {
  if (runningRebuildId.value) return
  runningRebuildId.value = initial.id; stopRequested.value = false; error.value = ''
  let job = initial
  try {
    if (job.status === 'PAUSED') job = await post<SearchRebuild>('/api/v1/search/rebuild/resume', { rebuildId: job.id })
    for (let batch = 0; batch < 10_000 && job.status === 'RUNNING'; batch += 1) {
      if (stopRequested.value) { job = await post<SearchRebuild>('/api/v1/search/rebuild/pause', { rebuildId: job.id }); break }
      job = await post<SearchRebuild>('/api/v1/search/rebuild/advance', { rebuildId: job.id, batchSize: 500 })
      replaceRebuild(job)
      if (batch % 3 === 0) await loadRebuilds(true, true)
    }
    ui.notify(job.status === 'SUCCEEDED' ? '索引重建已完成' : job.status === 'PAUSED' ? '索引任务已暂停' : `任务状态：${rebuildStatusLabel(job.status)}`, job.status === 'FAILED' ? 'error' : 'success')
  } catch (value) { error.value = messageOf(value) } finally { runningRebuildId.value = ''; await loadRebuilds(true, true) }
}

async function poll() {
  pollTick += 1
  if (tab.value === 'smtp' && smtpPollRemaining.value > 0) { smtpPollRemaining.value -= 1; await loadSmtp(false) }
  if (tab.value === 'invitations' && pollTick % 3 === 0 && invitations.value.some((item) => item.status === 'QUEUED')) await loadInvitations(true, true)
  if (tab.value === 'operations' && !runningRebuildId.value && rebuilds.value.some((item) => item.status === 'RUNNING')) await loadRebuilds(true, true)
}

function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—' }
function userStatusLabel(value: UserStatus) { return ({ ACTIVE: '正常', SUSPENDED: '已停用', PENDING: '待激活' })[value] }
function userStatusColor(value: UserStatus) { return value === 'ACTIVE' ? 'success' : value === 'SUSPENDED' ? 'error' : 'warning' }
function instanceRoleLabel(value: InstanceUser['instanceRole']) { return ({ OWNER: '所有者', ADMIN: '管理员', USER: '普通用户' })[value] }
function invitationStatusLabel(value: InvitationStatus) { return ({ QUEUED: '排队中', SENT: '已发送', FAILED: '失败', ACCEPTED: '已接受', EXPIRED: '已过期', REVOKED: '已撤销' })[value] }
function invitationStatusColor(value: InvitationStatus) { return value === 'ACCEPTED' || value === 'SENT' ? 'success' : value === 'FAILED' || value === 'REVOKED' ? 'error' : value === 'QUEUED' ? 'warning' : undefined }
function invitationRoleLabel(value: Invitation['workspaceRole']) { return ({ ADMIN: '空间管理员', MEMBER: '成员', EXTERNAL: '外部联系人' })[value] }
function kbRoleLabel(value: KnowledgeBaseRole) { return ({ MANAGER: '管理', EDITOR: '编辑', READER: '阅读' })[value] }
function reportStatusLabel(value: ReportStatus) { return ({ OPEN: '待处理', REVIEWING: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回' })[value] }
function reportStatusColor(value: ReportStatus) { return value === 'RESOLVED' ? 'success' : value === 'DISMISSED' ? 'error' : value === 'REVIEWING' ? 'warning' : 'info' }
function reportTargetLabel(value: SocialReport['targetType']) { return ({ USER: '用户', GARDEN: '知识花园', PUBLICATION: '公开内容' })[value] }
function rebuildStatusLabel(value: SearchRebuild['status']) { return ({ RUNNING: '运行中', PAUSED: '已暂停', SUCCEEDED: '已完成', FAILED: '失败' })[value] }
function rebuildStatusColor(value: SearchRebuild['status']) { return value === 'SUCCEEDED' ? 'success' : value === 'FAILED' ? 'error' : value === 'PAUSED' ? 'warning' : 'info' }
function rebuildPhaseLabel(value: SearchRebuild['cursorType']) { return ({ KNOWLEDGE_BASE: '知识库索引', TEAM: '团队索引', PAGE: '文稿索引', QUICK_NOTE: '小记索引', TEMPLATE: '模板索引', ATTACHMENT: '附件索引', PUBLICATION: '公开内容索引', CLEANUP: '清理陈旧索引', DONE: '重建完成' })[value] }
</script>

<template>
  <div class="page-shell admin-page">
    <header class="page-heading">
      <div><div class="text-overline text-primary">INSTANCE ADMINISTRATION</div><h1>管理后台</h1><p>统一管理身份入口、邮件、成员和实例运行状态。敏感操作会强制二次确认。</p></div>
      <v-chip color="primary" variant="tonal" prepend-icon="mdi-shield-crown-outline">实例管理员</v-chip>
    </header>

    <v-card class="section-card admin-nav mb-5"><v-tabs v-model="tab" color="primary" show-arrows><v-tab v-for="item in tabs" :key="item.value" :value="item.value" :prepend-icon="item.icon">{{ item.title }}</v-tab></v-tabs></v-card>
    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <v-window v-model="tab" :touch="false">
      <v-window-item value="access">
        <v-card class="section-card pa-6">
          <div class="panel-heading"><v-avatar color="primary" variant="tonal"><v-icon>mdi-login-variant</v-icon></v-avatar><div><h2>登录与注册</h2><p>邮箱是唯一账号标识；密码登录默认开启，公开注册必须先通过 SMTP 测试。</p></div><v-spacer /><v-chip :color="auth?.registrationMode === 'PUBLIC' ? 'success' : undefined" variant="tonal">{{ auth?.registrationMode === 'PUBLIC' ? '公开注册已开启' : '仅邀请注册' }}</v-chip></div>
          <template v-if="auth">
            <div class="setting-list mt-6">
              <div class="setting-row"><div><strong>允许公开注册</strong><p>访客可用邮箱和密码申请账号，并必须完成邮箱验证。</p></div><v-switch v-model="auth.registrationMode" false-value="CLOSED" true-value="PUBLIC" color="primary" inset hide-details :disabled="!auth.smtpReady" /></div>
              <v-alert v-if="!auth.smtpReady" type="warning" variant="tonal" icon="mdi-email-alert-outline">SMTP 尚未通过测试。请先在“邮件服务”保存配置并成功发送测试邮件。</v-alert>
              <div class="setting-row"><div><strong>密码登录</strong><p>登录页默认展示邮箱和密码，建议始终保留作为可靠入口。</p></div><v-switch v-model="auth.passwordLoginEnabled" color="primary" inset hide-details /></div>
              <div class="setting-row"><div><strong>邮箱验证码登录</strong><p>用户可切换到一次性验证码；SMTP 不可用时自动禁用。</p></div><v-switch v-model="auth.emailCodeLoginEnabled" color="primary" inset hide-details :disabled="!auth.smtpReady" /></div>
            </div>
            <div class="panel-footer mt-6"><span class="text-caption text-medium-emphasis">策略版本 {{ auth.settingsVersion }}</span><v-btn color="primary" prepend-icon="mdi-content-save-outline" :loading="busy === 'auth-save'" :disabled="!auth.passwordLoginEnabled && !auth.emailCodeLoginEnabled" @click="saveAuth">保存策略</v-btn></div>
          </template>
        </v-card>
      </v-window-item>

      <v-window-item value="users">
        <v-card class="section-card">
          <div class="panel-heading pa-6 pb-4"><v-avatar color="primary" variant="tonal"><v-icon>mdi-account-group-outline</v-icon></v-avatar><div><h2>实例用户</h2><p>管理账号状态和实例管理员权限；停用或降权会使现有会话失效。</p></div><v-spacer /><v-chip variant="tonal">{{ users.length }}{{ usersMore ? '+' : '' }} 个账号</v-chip></div>
          <div class="data-toolbar px-6 pb-4 mb-0"><v-text-field v-model="userQuery" prepend-inner-icon="mdi-magnify" label="邮箱或显示名" clearable max-width="420" @keyup.enter="loadUsers(true)" /><v-select v-model="userStatus" :items="[{title:'全部状态',value:'ALL'},{title:'正常',value:'ACTIVE'},{title:'已停用',value:'SUSPENDED'},{title:'待激活',value:'PENDING'}]" label="账号状态" max-width="190" /><v-btn variant="tonal" prepend-icon="mdi-refresh" @click="loadUsers(true)">查询</v-btn></div><v-divider />
          <v-list lines="three" class="pa-3"><v-list-item v-for="user in users" :key="user.userId" rounded="lg" class="user-row"><template #prepend><v-avatar color="primary" variant="tonal">{{ (user.displayName || user.email).slice(0, 1).toUpperCase() }}</v-avatar></template><v-list-item-title class="d-flex align-center flex-wrap ga-2"><strong>{{ user.displayName || user.email }}</strong><v-chip v-if="user.instanceRole !== 'USER'" size="x-small" color="primary" variant="tonal" prepend-icon="mdi-crown-outline">{{ instanceRoleLabel(user.instanceRole) }}</v-chip></v-list-item-title><v-list-item-subtitle>{{ user.displayName ? `${user.email} · ` : '' }}{{ user.workspaceCount }} 个空间 · {{ user.lastSeenAt ? `最近活动 ${dateTime(user.lastSeenAt)}` : '尚无活动' }}<br>注册于 {{ dateTime(user.createdAt) }} · {{ user.emailVerifiedAt ? '邮箱已验证' : '邮箱待验证' }}</v-list-item-subtitle><template #append><div class="row-actions"><v-chip size="small" :color="userStatusColor(user.status)" variant="tonal">{{ userStatusLabel(user.status) }}</v-chip><v-menu><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" :loading="busy === `user-${user.userId}`" /></template><v-list min-width="220"><v-list-item v-if="user.instanceRole === 'USER'" prepend-icon="mdi-shield-account-outline" title="设为实例管理员" :disabled="user.status !== 'ACTIVE'" @click="confirmUserAction(user, 'grant')" /><v-list-item v-else-if="user.instanceRole === 'ADMIN'" prepend-icon="mdi-shield-off-outline" title="撤销管理员" :disabled="userProtected(user)" @click="confirmUserAction(user, 'revoke')" /><v-divider /><v-list-item v-if="user.status === 'SUSPENDED'" prepend-icon="mdi-account-check-outline" title="恢复账号" @click="confirmUserAction(user, 'activate')" /><v-list-item v-else prepend-icon="mdi-account-cancel-outline" title="停用账号" base-color="error" :disabled="userProtected(user)" @click="confirmUserAction(user, 'suspend')" /></v-list></v-menu></div></template></v-list-item></v-list>
          <div v-if="!loading && !users.length" class="empty-state"><div><v-icon size="44">mdi-account-search-outline</v-icon><h3>没有匹配的用户</h3><p>调整关键词或状态筛选后再试。</p></div></div>
          <div v-if="usersMore" class="load-more"><v-btn variant="tonal" :loading="loading" @click="loadUsers(false)">加载更多用户</v-btn></div>
        </v-card>
      </v-window-item>

      <v-window-item value="smtp">
        <v-card class="section-card pa-6">
          <div class="panel-heading"><v-avatar color="primary" variant="tonal"><v-icon>mdi-email-outline</v-icon></v-avatar><div><h2>SMTP 邮件服务</h2><p>用于公开注册验证、验证码登录、邀请和系统通知。</p></div><v-spacer /><v-chip :color="smtp?.ready ? 'success' : smtp?.testStatus === 'FAILED' ? 'error' : 'warning'" variant="tonal">{{ smtp?.ready ? '已测试可用' : smtp?.testStatus === 'FAILED' ? '测试失败' : '尚未就绪' }}</v-chip></div>
          <v-form class="smtp-grid mt-6" @submit.prevent="saveSmtp">
            <v-text-field v-model="smtpDraft.host" label="SMTP 主机" placeholder="smtp.example.com" required class="span-2" />
            <v-text-field v-model.number="smtpDraft.port" label="端口" type="number" inputmode="numeric" :min="1" :max="65535" required />
            <v-select v-model="smtpDraft.security" label="安全方式" :items="[{title:'STARTTLS',value:'STARTTLS'},{title:'TLS / SMTPS',value:'TLS'},{title:'无加密（受控内网）',value:'NONE'}]" />
            <v-text-field v-model="smtpDraft.username" label="用户名" autocomplete="username" class="span-2" />
            <v-text-field v-model="smtpDraft.password" label="密码" type="password" autocomplete="new-password" :placeholder="smtp?.hasPassword ? '已保存；留空表示不修改' : 'SMTP 密码'" hint="密码由服务端加密保存，读取接口永不返回明文" persistent-hint class="span-2" @update:model-value="smtpDraft.clearPassword = false" />
            <v-checkbox v-if="smtp?.hasPassword" v-model="smtpDraft.clearPassword" label="清除已保存的密码" color="error" hide-details class="span-2" @update:model-value="smtpDraft.password = ''" />
            <v-text-field v-model="smtpDraft.fromName" label="发件人名称" required />
            <v-text-field v-model="smtpDraft.fromAddress" label="发件邮箱" type="email" required />
            <v-text-field v-model="smtpDraft.replyTo" label="回复邮箱（可选）" type="email" class="span-2" />
            <div class="setting-row span-2"><div><strong>启用邮件服务</strong><p>关闭后不会发送验证、验证码、邀请和通知邮件。</p></div><v-switch v-model="smtpDraft.enabled" color="primary" inset hide-details /></div>
            <v-alert v-if="smtp?.lastErrorCode" type="error" variant="tonal" class="span-2">最近测试失败：{{ smtp.lastErrorCode }}</v-alert>
            <div class="panel-footer span-2"><span class="text-caption text-medium-emphasis">{{ smtp?.testedAt ? `最近测试：${dateTime(smtp.testedAt)}` : '保存后请发送测试邮件' }}</span><v-btn type="submit" color="primary" prepend-icon="mdi-content-save-outline" :loading="busy === 'smtp-save'">保存 SMTP</v-btn></div>
          </v-form>
          <v-divider class="my-6" />
          <div class="smtp-test"><div><strong>发送测试邮件</strong><p>留空时发送到当前管理员邮箱；提交后页面会自动轮询投递结果。</p></div><v-text-field v-model="smtpRecipient" label="收件邮箱（可选）" type="email" hide-details /><v-btn variant="tonal" prepend-icon="mdi-send-outline" :loading="busy === 'smtp-test'" :disabled="!smtp?.enabled" @click="testSmtp">发送测试</v-btn></div>
        </v-card>
      </v-window-item>

      <v-window-item value="invitations">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-account-plus-outline</v-icon></v-avatar><div><h2>成员邀请</h2><p>不受公开注册开关影响，邀请只能由管理员发送到指定邮箱。</p></div><v-spacer /><v-chip variant="tonal">{{ invitations.filter(item => ['QUEUED','SENT','FAILED'].includes(item.status)).length }}{{ invitationsMore ? '+' : '' }} 个待处理</v-chip></div>
          <v-divider />
          <v-form class="invite-form pa-6" @submit.prevent="createInvitation">
            <v-select v-model="invitationWorkspaceId" :items="organisationWorkspaces" item-title="name" item-value="id" label="目标组织空间" />
            <v-text-field v-model="invitationEmail" label="受邀邮箱" type="email" placeholder="member@example.com" required />
            <v-select v-model="invitationRole" label="空间角色" :items="[{title:'成员',value:'MEMBER'},{title:'空间管理员',value:'ADMIN'},{title:'外部联系人',value:'EXTERNAL'}]" />
            <v-select v-model="invitationExpiry" label="有效期" :items="[{title:'1 天',value:24},{title:'3 天',value:72},{title:'7 天',value:168},{title:'30 天',value:720}]" />
            <v-expansion-panels variant="accordion" class="span-2"><v-expansion-panel><v-expansion-panel-title>同时加入团队或知识库 <v-chip size="x-small" class="ml-3">已选 {{ invitationTeams.length + Object.keys(invitationKnowledgeBases).length }} 项</v-chip></v-expansion-panel-title><v-expansion-panel-text><div class="target-grid"><v-select v-model="invitationTeams" :items="teams" item-title="name" item-value="id" label="加入团队" multiple chips clearable /><div><div class="text-subtitle-2 mb-2">知识库权限</div><div v-if="knowledgeBases.length" class="kb-targets"><div v-for="kb in knowledgeBases" :key="kb.id" class="kb-target-row"><v-checkbox-btn :model-value="Boolean(invitationKnowledgeBases[kb.id])" :label="kb.name" @update:model-value="toggleInvitationKnowledgeBase(kb.id, Boolean($event))" /><v-select :model-value="invitationKnowledgeBases[kb.id] || 'READER'" :disabled="!invitationKnowledgeBases[kb.id]" :items="[{title:'阅读',value:'READER'},{title:'编辑',value:'EDITOR'},{title:'管理',value:'MANAGER'}]" density="compact" hide-details @update:model-value="setInvitationKnowledgeBaseRole(kb.id, $event)" /></div></div><p v-else class="text-medium-emphasis">当前空间没有知识库。</p></div></div></v-expansion-panel-text></v-expansion-panel></v-expansion-panels>
            <div class="span-2 d-flex justify-end"><v-btn type="submit" color="primary" prepend-icon="mdi-send-outline" :loading="busy === 'invitation-create'" :disabled="!invitationWorkspaceId || !invitationEmail">创建并发送邀请</v-btn></div>
          </v-form>
          <v-alert v-if="!organisationWorkspaces.length" type="warning" variant="tonal" class="mx-6 mb-5">个人空间不能邀请成员，请先创建组织空间。</v-alert>
          <v-divider />
          <v-list lines="three" class="pa-3"><v-list-item v-for="invitation in invitations" :key="invitation.id" rounded="lg"><template #prepend><v-avatar color="primary" variant="tonal"><v-icon>mdi-at</v-icon></v-avatar></template><v-list-item-title><strong>{{ invitation.email }}</strong></v-list-item-title><v-list-item-subtitle>{{ invitationRoleLabel(invitation.workspaceRole) }} · {{ invitation.sentAt ? `发送于 ${dateTime(invitation.sentAt)}` : '等待邮件任务' }} · 到期 {{ dateTime(invitation.expiresAt) }}<br><span v-if="invitationTargets(invitation)">加入：{{ invitationTargets(invitation) }}</span></v-list-item-subtitle><template #append><div class="row-actions"><v-chip size="small" :color="invitationStatusColor(invitation.status)" variant="tonal">{{ invitationStatusLabel(invitation.status) }}</v-chip><v-btn v-if="['QUEUED','SENT','FAILED'].includes(invitation.status)" icon="mdi-refresh" variant="text" title="重新发送" :loading="busy === `invite-${invitation.id}`" @click="resendInvitation(invitation)" /><v-btn v-if="['QUEUED','SENT','FAILED'].includes(invitation.status)" icon="mdi-delete-outline" color="error" variant="text" title="撤销邀请" @click="confirmRevokeInvitation(invitation)" /></div></template></v-list-item></v-list>
          <div v-if="!loading && !invitations.length" class="empty-state"><div><v-icon size="44">mdi-email-plus-outline</v-icon><h3>还没有邀请记录</h3><p>创建后，邮件投递状态会自动更新。</p></div></div>
          <div v-if="invitationsMore" class="load-more"><v-btn variant="tonal" :loading="loading" @click="loadInvitations(false)">加载更多邀请</v-btn></div>
        </v-card>
      </v-window-item>

      <v-window-item value="moderation">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-shield-search-outline</v-icon></v-avatar><div><h2>内容治理</h2><p>集中审核用户、知识花园和公开内容举报，并保留处理说明。</p></div><v-spacer /><v-chip color="warning" variant="tonal">{{ reports.filter(item => item.status === 'OPEN').length }}{{ reportsMore ? '+' : '' }} 个待处理</v-chip></div>
          <div class="data-toolbar px-6 pb-4 mb-0"><v-btn-toggle v-model="reportStatus" mandatory density="compact" color="primary"><v-btn value="ALL">全部</v-btn><v-btn value="OPEN">待处理</v-btn><v-btn value="REVIEWING">审核中</v-btn><v-btn value="RESOLVED">已处理</v-btn><v-btn value="DISMISSED">已驳回</v-btn></v-btn-toggle></div><v-divider />
          <div class="report-list pa-4"><v-card v-for="report in reports" :key="report.id" variant="outlined" class="report-card pa-5"><div class="d-flex align-start ga-3"><v-chip size="small" :color="reportStatusColor(report.status)" variant="tonal">{{ reportStatusLabel(report.status) }}</v-chip><div class="flex-grow-1"><strong>{{ reportTargetLabel(report.targetType) }}举报 · {{ report.reason }}</strong><div class="text-caption text-medium-emphasis mt-1">举报人 {{ report.reporterId }} · {{ dateTime(report.createdAt) }}</div></div><v-btn v-if="report.targetType === 'PUBLICATION'" :href="`/p/${report.targetId}`" target="_blank" variant="text" size="small" append-icon="mdi-open-in-new">查看内容</v-btn></div><p class="mt-4 mb-2">{{ report.details || '举报人未补充详细说明。' }}</p><code>{{ report.targetType }} · {{ report.targetId }}</code><v-text-field v-model="reportResolutions[report.id]" label="审核结论或处理说明" maxlength="1000" counter class="mt-4" /><div class="d-flex justify-end flex-wrap ga-2"><v-btn v-if="report.status === 'OPEN'" variant="tonal" :loading="busy === `report-${report.id}`" @click="reviewReport(report, 'REVIEWING')">开始审核</v-btn><v-btn variant="text" color="error" :disabled="busy === `report-${report.id}`" @click="confirmReview(report, 'DISMISSED')">驳回</v-btn><v-btn color="primary" :disabled="!reportResolutions[report.id]?.trim()" :loading="busy === `report-${report.id}`" @click="confirmReview(report, 'RESOLVED')">完成处理</v-btn></div></v-card></div>
          <div v-if="!loading && !reports.length" class="empty-state"><div><v-icon size="44">mdi-shield-check-outline</v-icon><h3>当前没有举报</h3><p>符合筛选条件的举报会显示在这里。</p></div></div>
          <div v-if="reportsMore" class="load-more"><v-btn variant="tonal" :loading="loading" @click="loadReports(false)">加载更多举报</v-btn></div>
        </v-card>
      </v-window-item>

      <v-window-item value="operations">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-database-cog-outline</v-icon></v-avatar><div><h2>搜索索引运维</h2><p>按空间逐批重建索引，可暂停、恢复并在完成后清理陈旧文档。</p></div><v-spacer /><v-chip :color="rebuilds.some(item => item.status === 'RUNNING' || item.status === 'PAUSED') ? 'warning' : 'success'" variant="tonal">{{ rebuilds.some(item => item.status === 'RUNNING' || item.status === 'PAUSED') ? '存在活动任务' : '索引空闲' }}</v-chip></div>
          <div class="operation-toolbar px-6 pb-5"><v-select v-model="rebuildWorkspaceId" :items="session.workspaces" item-title="name" item-value="id" label="目标空间" hide-details /><v-btn color="primary" prepend-icon="mdi-database-refresh-outline" :disabled="!rebuildWorkspaceId || rebuilds.some(item => item.status === 'RUNNING' || item.status === 'PAUSED')" @click="confirmStartRebuild">新建重建任务</v-btn></div><v-divider />
          <div class="rebuild-list pa-4"><v-card v-for="job in rebuilds" :key="job.id" variant="outlined" class="rebuild-card pa-5"><div class="d-flex align-start ga-3"><v-avatar color="primary" variant="tonal"><v-icon>mdi-database-sync-outline</v-icon></v-avatar><div class="flex-grow-1"><strong>{{ rebuildPhaseLabel(job.cursorType) }}</strong><div class="text-caption text-medium-emphasis">任务 {{ job.id.slice(0, 8) }} · 开始于 {{ dateTime(job.startedAt) }}</div></div><v-chip :color="rebuildStatusColor(job.status)" size="small" variant="tonal">{{ rebuildStatusLabel(job.status) }}</v-chip></div><div class="metric-grid my-4"><div><strong>{{ job.processedCount.toLocaleString('zh-CN') }}</strong><span>已处理</span></div><div><strong>{{ job.errorCount }}</strong><span>错误</span></div><div><strong>{{ dateTime(job.completedAt || job.updatedAt) }}</strong><span>{{ job.completedAt ? '完成时间' : '最近进度' }}</span></div></div><v-alert v-if="job.lastError" type="error" variant="tonal" class="mb-4">{{ job.lastError }}</v-alert><div class="d-flex justify-end flex-wrap ga-2"><template v-if="job.status === 'RUNNING'"><v-btn variant="tonal" prepend-icon="mdi-play" :disabled="Boolean(runningRebuildId)" :loading="busy === `rebuild-${job.id}`" @click="rebuildAction(job, 'advance')">继续一批</v-btn><v-btn variant="text" prepend-icon="mdi-pause" :disabled="runningRebuildId === job.id" @click="rebuildAction(job, 'pause')">暂停</v-btn><v-btn color="primary" prepend-icon="mdi-fast-forward" :loading="runningRebuildId === job.id" :disabled="Boolean(runningRebuildId) && runningRebuildId !== job.id" @click="runToCompletion(job)">{{ runningRebuildId === job.id ? '自动重建中' : '运行至完成' }}</v-btn></template><template v-else-if="job.status === 'PAUSED'"><v-btn variant="tonal" prepend-icon="mdi-play" :disabled="Boolean(runningRebuildId)" @click="rebuildAction(job, 'resume')">恢复</v-btn><v-btn color="primary" prepend-icon="mdi-fast-forward" :disabled="Boolean(runningRebuildId)" @click="runToCompletion(job)">恢复并运行至完成</v-btn></template><v-btn v-if="runningRebuildId === job.id" color="error" variant="tonal" prepend-icon="mdi-stop" @click="stopRequested = true">当前批次后暂停</v-btn></div></v-card></div>
          <div v-if="!loading && !rebuilds.length" class="empty-state"><div><v-icon size="44">mdi-database-check-outline</v-icon><h3>还没有索引重建记录</h3><p>正常增量索引无需人工操作，仅在迁移或修复后执行全量重建。</p></div></div>
          <div v-if="rebuildsMore" class="load-more"><v-btn variant="tonal" :loading="loading" @click="loadRebuilds(false)">加载更多记录</v-btn></div>
        </v-card>
      </v-window-item>
    </v-window>

    <v-dialog v-model="confirmation.open" max-width="520" persistent><v-card><v-card-title class="pt-6 px-6">{{ confirmation.title }}</v-card-title><v-card-text class="px-6 text-medium-emphasis">{{ confirmation.text }}</v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" :disabled="confirmation.loading" @click="confirmation.open = false">取消</v-btn><v-btn :color="confirmation.color" :loading="confirmation.loading" @click="confirmAction">{{ confirmation.confirmText }}</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.admin-page { max-width: 1280px; }
.admin-nav { overflow: hidden; }
.panel-heading { display: flex; align-items: center; gap: 14px; }
.panel-heading h2 { margin: 0; font-size: 18px; }
.panel-heading p, .setting-row p, .smtp-test p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface)); opacity: .62; font-size: 13px; }
.setting-list { display: grid; gap: 12px; }
.setting-row { min-height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 24px; padding: 16px 18px; border: 1px solid rgba(15,23,42,.09); border-radius: 12px; background: rgba(var(--v-theme-surface-variant),.22); }
.panel-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.row-actions { display: flex; align-items: center; gap: 6px; }
.user-row { margin-bottom: 4px; }
.load-more { display: flex; justify-content: center; padding: 8px 20px 24px; }
.smtp-grid, .invite-form { display: grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap: 8px 16px; }
.span-2 { grid-column: 1 / -1; }
.smtp-test { display: grid; grid-template-columns: minmax(260px,1fr) minmax(260px,420px) auto; align-items: center; gap: 16px; }
.target-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
.kb-targets { display: grid; gap: 8px; }
.kb-target-row { display: grid; grid-template-columns: minmax(0,1fr) 130px; align-items: center; gap: 12px; }
.report-list, .rebuild-list { display: grid; gap: 12px; }
.report-card code { color: rgb(var(--v-theme-on-surface)); opacity: .6; font-size: 12px; }
.operation-toolbar { display: grid; grid-template-columns: minmax(280px,460px) auto; align-items: center; gap: 16px; }
.metric-grid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 10px; }
.metric-grid > div { padding: 12px; border-radius: 10px; background: rgba(var(--v-theme-surface-variant),.28); }
.metric-grid strong, .metric-grid span { display: block; }
.metric-grid span { margin-top: 3px; color: rgb(var(--v-theme-on-surface)); opacity: .58; font-size: 12px; }
@media (max-width: 800px) { .panel-heading { align-items: flex-start; flex-wrap: wrap; }.panel-heading .v-spacer { display:none; }.smtp-grid,.invite-form,.target-grid { grid-template-columns:1fr; }.span-2 { grid-column:auto; }.smtp-test,.operation-toolbar { grid-template-columns:1fr; }.row-actions { flex-wrap:wrap; justify-content:flex-end; }.metric-grid { grid-template-columns:1fr 1fr; }.metric-grid>div:last-child { grid-column:1/-1; } }
</style>
