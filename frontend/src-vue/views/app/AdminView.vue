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
const activeTab = computed(() => tabs.find((item) => item.value === tab.value) ?? tabs[0])
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
  <main class="page-shell admin-page">
    <header class="admin-head">
      <span class="admin-mark"><v-icon size="21">mdi-shield-crown-outline</v-icon></span>
      <div><span>实例管理</span><h1>管理后台</h1><p>登录入口、邮件、成员与实例运行状态</p></div>
      <span class="admin-badge">实例管理员</span>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="admin-alert" @click:close="error=''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" height="2" class="admin-progress" />

    <div class="admin-layout">
      <nav class="admin-nav" aria-label="管理后台导航">
        <span class="nav-group">实例设置</span>
        <button v-for="item in tabs.slice(0,4)" :key="item.value" :class="{active:tab===item.value}" type="button" @click="tab=item.value"><v-icon size="17">{{ item.icon }}</v-icon>{{ item.title }}</button>
        <span class="nav-group">治理与运维</span>
        <button v-for="item in tabs.slice(4)" :key="item.value" :class="{active:tab===item.value}" type="button" @click="tab=item.value"><v-icon size="17">{{ item.icon }}</v-icon>{{ item.title }}</button>
      </nav>

      <section class="admin-content" :aria-label="activeTab.title">
        <template v-if="tab==='access'">
          <header class="content-heading action-heading"><div><h2>登录与注册</h2><p>邮箱是唯一账号；密码为默认登录方式，公开注册必须验证邮箱。</p></div><span class="state-badge" :class="{success:auth?.registrationMode==='PUBLIC'}">{{ auth?.registrationMode==='PUBLIC'?'公开注册':'仅邀请注册' }}</span></header>
          <div v-if="auth" class="flat-panel setting-list">
            <div class="setting-row"><div><strong>允许公开注册</strong><p>访客可使用邮箱申请账号，注册后必须完成邮箱验证。</p></div><v-switch v-model="auth.registrationMode" false-value="CLOSED" true-value="PUBLIC" color="primary" hide-details :disabled="!auth.smtpReady" /></div>
            <div v-if="!auth.smtpReady" class="inline-warning"><v-icon size="17">mdi-email-alert-outline</v-icon><span>SMTP 尚未通过测试，请先在“邮件服务”保存配置并成功发送测试邮件。</span></div>
            <div class="setting-row"><div><strong>密码登录</strong><p>登录页默认展示邮箱和密码，建议保留为可靠入口。</p></div><v-switch v-model="auth.passwordLoginEnabled" color="primary" hide-details /></div>
            <div class="setting-row"><div><strong>邮箱验证码登录</strong><p>用户可切换到一次性验证码；SMTP 不可用时自动禁用。</p></div><v-switch v-model="auth.emailCodeLoginEnabled" color="primary" hide-details :disabled="!auth.smtpReady" /></div>
          </div>
          <div v-if="auth" class="panel-footer"><span>策略版本 {{ auth.settingsVersion }}</span><v-btn color="primary" size="small" :loading="busy==='auth-save'" :disabled="!auth.passwordLoginEnabled&&!auth.emailCodeLoginEnabled" @click="saveAuth">保存策略</v-btn></div>
        </template>

        <template v-else-if="tab==='users'">
          <header class="content-heading"><h2>实例用户</h2><p>管理账号状态和实例管理员权限，共 {{ users.length }}{{ usersMore?'+':'' }} 个账号。</p></header>
          <div class="admin-toolbar"><v-text-field v-model="userQuery" prepend-inner-icon="mdi-magnify" label="邮箱或显示名" density="compact" hide-details clearable @keyup.enter="loadUsers(true)" /><v-select v-model="userStatus" :items="[{title:'全部状态',value:'ALL'},{title:'正常',value:'ACTIVE'},{title:'已停用',value:'SUSPENDED'},{title:'待激活',value:'PENDING'}]" label="账号状态" density="compact" hide-details /><v-btn variant="tonal" size="small" @click="loadUsers(true)">查询</v-btn></div>
          <div class="flat-panel data-list">
            <div v-for="user in users" :key="user.userId" class="user-row">
              <span class="row-avatar">{{ (user.displayName||user.email).slice(0,1).toUpperCase() }}</span>
              <span class="row-copy"><span class="row-title"><strong>{{ user.displayName||user.email }}</strong><em v-if="user.instanceRole!=='USER'">{{ instanceRoleLabel(user.instanceRole) }}</em></span><small>{{ user.displayName?`${user.email} · `:'' }}{{ user.workspaceCount }} 个空间 · {{ user.lastSeenAt?`最近活动 ${dateTime(user.lastSeenAt)}`:'尚无活动' }}</small><small>注册于 {{ dateTime(user.createdAt) }} · {{ user.emailVerifiedAt?'邮箱已验证':'邮箱待验证' }}</small></span>
              <span class="state-badge" :class="user.status.toLowerCase()">{{ userStatusLabel(user.status) }}</span>
              <v-menu><template #activator="{props}"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" size="small" :loading="busy===`user-${user.userId}`" /></template><v-list min-width="210" density="compact"><v-list-item v-if="user.instanceRole==='USER'" prepend-icon="mdi-shield-account-outline" title="设为实例管理员" :disabled="user.status!=='ACTIVE'" @click="confirmUserAction(user,'grant')" /><v-list-item v-else-if="user.instanceRole==='ADMIN'" prepend-icon="mdi-shield-off-outline" title="撤销管理员" :disabled="userProtected(user)" @click="confirmUserAction(user,'revoke')" /><v-divider /><v-list-item v-if="user.status==='SUSPENDED'" prepend-icon="mdi-account-check-outline" title="恢复账号" @click="confirmUserAction(user,'activate')" /><v-list-item v-else prepend-icon="mdi-account-cancel-outline" title="停用账号" base-color="error" :disabled="userProtected(user)" @click="confirmUserAction(user,'suspend')" /></v-list></v-menu>
            </div>
            <div v-if="!loading&&!users.length" class="empty-box"><v-icon size="23">mdi-account-search-outline</v-icon><strong>没有匹配的用户</strong><span>调整关键词或状态筛选后再试</span></div>
          </div>
          <div v-if="usersMore" class="load-more"><v-btn variant="text" size="small" :loading="loading" @click="loadUsers(false)">加载更多用户</v-btn></div>
        </template>

        <template v-else-if="tab==='smtp'">
          <header class="content-heading action-heading"><div><h2>SMTP 邮件服务</h2><p>用于邮箱验证、验证码登录、邀请和系统通知。</p></div><span class="state-badge" :class="smtp?.ready?'success':smtp?.testStatus==='FAILED'?'failed':'pending'">{{ smtp?.ready?'已测试可用':smtp?.testStatus==='FAILED'?'测试失败':'尚未就绪' }}</span></header>
          <v-form class="smtp-form" @submit.prevent="saveSmtp">
            <div class="form-grid"><v-text-field v-model="smtpDraft.host" label="SMTP 主机" placeholder="smtp.example.com" density="compact" required class="span-2" /><v-text-field v-model.number="smtpDraft.port" label="端口" type="number" inputmode="numeric" :min="1" :max="65535" density="compact" required /><v-select v-model="smtpDraft.security" label="安全方式" density="compact" :items="[{title:'STARTTLS',value:'STARTTLS'},{title:'TLS / SMTPS',value:'TLS'},{title:'无加密（受控内网）',value:'NONE'}]" /><v-text-field v-model="smtpDraft.username" label="用户名" autocomplete="username" density="compact" class="span-2" /><v-text-field v-model="smtpDraft.password" label="密码" type="password" autocomplete="new-password" density="compact" :placeholder="smtp?.hasPassword?'已保存；留空表示不修改':'SMTP 密码'" hint="密码由服务端加密保存，接口不会返回明文" persistent-hint class="span-2" @update:model-value="smtpDraft.clearPassword=false" /><v-checkbox v-if="smtp?.hasPassword" v-model="smtpDraft.clearPassword" label="清除已保存的密码" color="error" density="compact" hide-details class="span-2" @update:model-value="smtpDraft.password=''" /><v-text-field v-model="smtpDraft.fromName" label="发件人名称" density="compact" required /><v-text-field v-model="smtpDraft.fromAddress" label="发件邮箱" type="email" density="compact" required /><v-text-field v-model="smtpDraft.replyTo" label="回复邮箱（可选）" type="email" density="compact" class="span-2" /></div>
            <div class="flat-panel compact-toggle"><div><strong>启用邮件服务</strong><p>关闭后不会发送验证、验证码、邀请和通知邮件。</p></div><v-switch v-model="smtpDraft.enabled" color="primary" hide-details /></div>
            <div v-if="smtp?.lastErrorCode" class="inline-warning error-warning"><v-icon size="17">mdi-alert-circle-outline</v-icon><span>最近测试失败：{{ smtp.lastErrorCode }}</span></div>
            <div class="panel-footer"><span>{{ smtp?.testedAt?`最近测试：${dateTime(smtp.testedAt)}`:'保存后请发送测试邮件' }}</span><v-btn type="submit" color="primary" size="small" :loading="busy==='smtp-save'">保存 SMTP</v-btn></div>
          </v-form>
          <div class="subsection"><div class="subsection-copy"><strong>发送测试邮件</strong><p>留空时发送到当前管理员邮箱，提交后自动轮询投递结果。</p></div><div class="smtp-test"><v-text-field v-model="smtpRecipient" label="收件邮箱（可选）" type="email" density="compact" hide-details /><v-btn variant="tonal" size="small" :loading="busy==='smtp-test'" :disabled="!smtp?.enabled" @click="testSmtp">发送测试</v-btn></div></div>
        </template>

        <template v-else-if="tab==='invitations'">
          <header class="content-heading"><h2>成员邀请</h2><p>邀请不受公开注册开关影响，只会发送到管理员指定的邮箱。</p></header>
          <v-alert v-if="!organisationWorkspaces.length" type="warning" variant="tonal" density="compact" class="mb-4">个人空间不能邀请成员，请先创建组织空间。</v-alert>
          <v-form class="invite-panel" @submit.prevent="createInvitation">
            <div class="form-grid"><v-select v-model="invitationWorkspaceId" :items="organisationWorkspaces" item-title="name" item-value="id" label="目标组织空间" density="compact" /><v-text-field v-model="invitationEmail" label="受邀邮箱" type="email" placeholder="member@example.com" density="compact" required /><v-select v-model="invitationRole" label="空间角色" density="compact" :items="[{title:'成员',value:'MEMBER'},{title:'空间管理员',value:'ADMIN'},{title:'外部联系人',value:'EXTERNAL'}]" /><v-select v-model="invitationExpiry" label="有效期" density="compact" :items="[{title:'1 天',value:24},{title:'3 天',value:72},{title:'7 天',value:168},{title:'30 天',value:720}]" /></div>
            <details class="target-details"><summary>同时加入团队或知识库 <span>已选 {{ invitationTeams.length+Object.keys(invitationKnowledgeBases).length }} 项</span></summary><div class="target-grid"><v-select v-model="invitationTeams" :items="teams" item-title="name" item-value="id" label="加入团队" density="compact" multiple chips clearable /><div><strong class="target-title">知识库权限</strong><div v-if="knowledgeBases.length" class="kb-targets"><div v-for="kb in knowledgeBases" :key="kb.id" class="kb-target-row"><v-checkbox-btn :model-value="Boolean(invitationKnowledgeBases[kb.id])" :label="kb.name" @update:model-value="toggleInvitationKnowledgeBase(kb.id,Boolean($event))" /><v-select :model-value="invitationKnowledgeBases[kb.id]||'READER'" :disabled="!invitationKnowledgeBases[kb.id]" :items="[{title:'阅读',value:'READER'},{title:'编辑',value:'EDITOR'},{title:'管理',value:'MANAGER'}]" density="compact" hide-details @update:model-value="setInvitationKnowledgeBaseRole(kb.id,$event)" /></div></div><p v-else class="empty-inline">当前空间没有知识库</p></div></div></details>
            <div class="form-actions"><v-btn type="submit" color="primary" size="small" :loading="busy==='invitation-create'" :disabled="!invitationWorkspaceId||!invitationEmail">创建并发送邀请</v-btn></div>
          </v-form>
          <div class="list-heading"><strong>邀请记录</strong><span>{{ invitations.filter(item=>['QUEUED','SENT','FAILED'].includes(item.status)).length }}{{ invitationsMore?'+':'' }} 个待处理</span></div>
          <div class="flat-panel data-list">
            <div v-for="invitation in invitations" :key="invitation.id" class="invitation-row"><span class="row-icon"><v-icon size="17">mdi-at</v-icon></span><span class="row-copy"><strong>{{ invitation.email }}</strong><small>{{ invitationRoleLabel(invitation.workspaceRole) }} · {{ invitation.sentAt?`发送于 ${dateTime(invitation.sentAt)}`:'等待邮件任务' }} · 到期 {{ dateTime(invitation.expiresAt) }}</small><small v-if="invitationTargets(invitation)">加入：{{ invitationTargets(invitation) }}</small></span><span class="state-badge" :class="invitation.status.toLowerCase()">{{ invitationStatusLabel(invitation.status) }}</span><span class="row-actions"><v-btn v-if="['QUEUED','SENT','FAILED'].includes(invitation.status)" icon="mdi-refresh" size="x-small" variant="text" title="重新发送" :loading="busy===`invite-${invitation.id}`" @click="resendInvitation(invitation)" /><v-btn v-if="['QUEUED','SENT','FAILED'].includes(invitation.status)" icon="mdi-close" size="x-small" color="grey-darken-1" variant="text" title="撤销邀请" @click="confirmRevokeInvitation(invitation)" /></span></div>
            <div v-if="!loading&&!invitations.length" class="empty-box"><v-icon size="23">mdi-email-plus-outline</v-icon><strong>还没有邀请记录</strong><span>创建后，邮件投递状态会自动更新</span></div>
          </div>
          <div v-if="invitationsMore" class="load-more"><v-btn variant="text" size="small" :loading="loading" @click="loadInvitations(false)">加载更多邀请</v-btn></div>
        </template>

        <template v-else-if="tab==='moderation'">
          <header class="content-heading action-heading"><div><h2>内容治理</h2><p>审核用户、知识花园与公开内容举报，并保留处理说明。</p></div><span class="state-badge pending">{{ reports.filter(item=>item.status==='OPEN').length }}{{ reportsMore?'+':'' }} 个待处理</span></header>
          <div class="moderation-filter"><v-select v-model="reportStatus" label="举报状态" density="compact" hide-details :items="[{title:'全部',value:'ALL'},{title:'待处理',value:'OPEN'},{title:'审核中',value:'REVIEWING'},{title:'已处理',value:'RESOLVED'},{title:'已驳回',value:'DISMISSED'}]" /></div>
          <div class="report-list">
            <article v-for="report in reports" :key="report.id" class="report-block"><header><span class="state-badge" :class="report.status.toLowerCase()">{{ reportStatusLabel(report.status) }}</span><div><strong>{{ reportTargetLabel(report.targetType) }}举报 · {{ report.reason }}</strong><small>举报人 {{ report.reporterId }} · {{ dateTime(report.createdAt) }}</small></div><v-btn v-if="report.targetType==='PUBLICATION'" :href="`/p/${report.targetId}`" target="_blank" variant="text" size="small" append-icon="mdi-open-in-new">查看</v-btn></header><p>{{ report.details||'举报人未补充详细说明。' }}</p><code>{{ report.targetType }} · {{ report.targetId }}</code><v-text-field v-model="reportResolutions[report.id]" label="审核结论或处理说明" maxlength="1000" counter density="compact" class="mt-3" /><footer><v-btn v-if="report.status==='OPEN'" variant="tonal" size="small" :loading="busy===`report-${report.id}`" @click="reviewReport(report,'REVIEWING')">开始审核</v-btn><v-btn variant="text" size="small" color="error" :disabled="busy===`report-${report.id}`" @click="confirmReview(report,'DISMISSED')">驳回</v-btn><v-btn color="primary" size="small" :disabled="!reportResolutions[report.id]?.trim()" :loading="busy===`report-${report.id}`" @click="confirmReview(report,'RESOLVED')">完成处理</v-btn></footer></article>
            <div v-if="!loading&&!reports.length" class="empty-box bordered"><v-icon size="23">mdi-shield-check-outline</v-icon><strong>当前没有举报</strong><span>符合筛选条件的举报会显示在这里</span></div>
          </div>
          <div v-if="reportsMore" class="load-more"><v-btn variant="text" size="small" :loading="loading" @click="loadReports(false)">加载更多举报</v-btn></div>
        </template>

        <template v-else>
          <header class="content-heading action-heading"><div><h2>搜索索引运维</h2><p>按空间逐批重建索引，可暂停、恢复并清理陈旧文档。</p></div><span class="state-badge" :class="rebuilds.some(item=>item.status==='RUNNING'||item.status==='PAUSED')?'pending':'success'">{{ rebuilds.some(item=>item.status==='RUNNING'||item.status==='PAUSED')?'存在活动任务':'索引空闲' }}</span></header>
          <div class="operation-toolbar"><v-select v-model="rebuildWorkspaceId" :items="session.workspaces" item-title="name" item-value="id" label="目标空间" density="compact" hide-details /><v-btn color="primary" size="small" :disabled="!rebuildWorkspaceId||rebuilds.some(item=>item.status==='RUNNING'||item.status==='PAUSED')" @click="confirmStartRebuild">新建重建任务</v-btn></div>
          <div class="rebuild-list">
            <article v-for="job in rebuilds" :key="job.id" class="rebuild-block"><header><span class="row-icon"><v-icon size="17">mdi-database-sync-outline</v-icon></span><div><strong>{{ rebuildPhaseLabel(job.cursorType) }}</strong><small>任务 {{ job.id.slice(0,8) }} · 开始于 {{ dateTime(job.startedAt) }}</small></div><span class="state-badge" :class="job.status.toLowerCase()">{{ rebuildStatusLabel(job.status) }}</span></header><div class="metric-row"><span><strong>{{ job.processedCount.toLocaleString('zh-CN') }}</strong> 已处理</span><span><strong>{{ job.errorCount }}</strong> 错误</span><span>{{ job.completedAt?'完成':'更新' }} {{ dateTime(job.completedAt||job.updatedAt) }}</span></div><div v-if="job.lastError" class="inline-warning error-warning"><v-icon size="17">mdi-alert-circle-outline</v-icon><span>{{ job.lastError }}</span></div><footer><template v-if="job.status==='RUNNING'"><v-btn variant="tonal" size="small" :disabled="Boolean(runningRebuildId)" :loading="busy===`rebuild-${job.id}`" @click="rebuildAction(job,'advance')">继续一批</v-btn><v-btn variant="text" size="small" :disabled="runningRebuildId===job.id" @click="rebuildAction(job,'pause')">暂停</v-btn><v-btn color="primary" size="small" :loading="runningRebuildId===job.id" :disabled="Boolean(runningRebuildId)&&runningRebuildId!==job.id" @click="runToCompletion(job)">{{ runningRebuildId===job.id?'自动重建中':'运行至完成' }}</v-btn></template><template v-else-if="job.status==='PAUSED'"><v-btn variant="tonal" size="small" :disabled="Boolean(runningRebuildId)" @click="rebuildAction(job,'resume')">恢复</v-btn><v-btn color="primary" size="small" :disabled="Boolean(runningRebuildId)" @click="runToCompletion(job)">恢复并运行至完成</v-btn></template><v-btn v-if="runningRebuildId===job.id" color="error" variant="tonal" size="small" @click="stopRequested=true">当前批次后暂停</v-btn></footer></article>
            <div v-if="!loading&&!rebuilds.length" class="empty-box bordered"><v-icon size="23">mdi-database-check-outline</v-icon><strong>还没有索引重建记录</strong><span>增量索引无需人工操作，仅在迁移或修复后执行</span></div>
          </div>
          <div v-if="rebuildsMore" class="load-more"><v-btn variant="text" size="small" :loading="loading" @click="loadRebuilds(false)">加载更多记录</v-btn></div>
        </template>
      </section>
    </div>

    <v-dialog v-model="confirmation.open" max-width="420" persistent><v-card class="confirm-dialog" rounded="lg"><v-card-title>{{ confirmation.title }}</v-card-title><v-card-text>{{ confirmation.text }}</v-card-text><v-card-actions><v-spacer /><v-btn size="small" :disabled="confirmation.loading" @click="confirmation.open=false">取消</v-btn><v-btn :color="confirmation.color" size="small" :loading="confirmation.loading" @click="confirmAction">{{ confirmation.confirmText }}</v-btn></v-card-actions></v-card></v-dialog>
  </main>
</template>

<style scoped>
.admin-page{max-width:1100px;padding-top:25px}.admin-head{display:flex;align-items:center;gap:11px;padding-bottom:19px;border-bottom:1px solid #e8eaee}.admin-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:9px;color:#2468f2;background:#edf3ff}.admin-head>div{min-width:0}.admin-head>div>span{display:block;color:#969ca6;font-size:11px;line-height:14px}.admin-head h1{margin:0;color:#292d33;font-size:20px;font-weight:650;line-height:26px}.admin-head p{margin:1px 0 0;color:#8e959f;font-size:12px}.admin-badge{margin-left:auto;padding:4px 9px;border-radius:10px;color:#5271aa;background:#f0f4fb;font-size:11px}.admin-alert{margin-top:12px}.admin-progress{margin-top:0}.admin-layout{display:grid;grid-template-columns:178px minmax(0,1fr);gap:42px;padding-top:25px}.admin-nav{display:flex;align-self:start;position:sticky;top:16px;flex-direction:column}.nav-group{margin:17px 10px 5px;color:#a0a6af;font-size:10px;font-weight:600;letter-spacing:.04em}.nav-group:first-child{margin-top:0}.admin-nav button{display:flex;align-items:center;width:100%;height:34px;gap:8px;padding:0 10px;border:0;border-radius:6px;color:#656c77;background:transparent;font-size:13px;text-align:left;cursor:pointer}.admin-nav button:hover{background:#f5f6f8}.admin-nav button.active{color:#2468f2;background:#edf3ff;font-weight:600}.admin-content{min-width:0;max-width:790px}.content-heading{margin-bottom:18px}.content-heading h2{margin:0;color:#2e3238;font-size:18px;font-weight:650}.content-heading p{margin:4px 0 0;color:#9299a4;font-size:12px}.action-heading{display:flex;align-items:center;justify-content:space-between;gap:18px}.flat-panel,.report-block,.rebuild-block{overflow:hidden;border:1px solid #e6e8ec;border-radius:8px;background:#fff}.setting-row,.compact-toggle{display:flex;align-items:center;justify-content:space-between;min-height:68px;gap:24px;padding:12px 16px;border-bottom:1px solid #eef0f3}.setting-row:last-child{border-bottom:0}.setting-row strong,.compact-toggle strong,.subsection strong{color:#41464d;font-size:13px;font-weight:600}.setting-row p,.compact-toggle p,.subsection p{margin:3px 0 0;color:#959ba5;font-size:11px}.inline-warning{display:flex;align-items:flex-start;gap:8px;padding:10px 14px;color:#8b681a;background:#fff9e8;font-size:12px;line-height:18px}.error-warning{color:#a34747;background:#fff3f3}.panel-footer{display:flex;align-items:center;justify-content:space-between;margin-top:17px;padding-top:15px;border-top:1px solid #eceef1}.panel-footer>span{color:#999fa8;font-size:11px}.state-badge{display:inline-flex;align-items:center;flex:none;padding:3px 7px;border-radius:9px;color:#69717c;background:#f0f2f5;font-size:10px;font-style:normal;line-height:15px}.state-badge.success,.state-badge.active,.state-badge.accepted,.state-badge.sent,.state-badge.succeeded,.state-badge.resolved{color:#31805a;background:#eaf7f0}.state-badge.pending,.state-badge.queued,.state-badge.reviewing,.state-badge.paused,.state-badge.running{color:#9a6a18;background:#fff5df}.state-badge.failed,.state-badge.suspended,.state-badge.revoked,.state-badge.dismissed{color:#b44747;background:#fff0f0}.admin-toolbar{display:grid;grid-template-columns:minmax(220px,1fr) 150px auto;align-items:center;gap:8px;margin-bottom:12px}.data-list{overflow:hidden}.user-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto 34px;align-items:center;min-height:67px;padding:8px 12px;border-bottom:1px solid #eef0f3}.user-row:last-child{border-bottom:0}.row-avatar{display:grid;place-items:center;width:29px;height:29px;border-radius:50%;color:#536176;background:#eef1f5;font-size:12px;font-weight:600}.row-copy{display:flex;min-width:0;flex-direction:column}.row-copy strong{overflow:hidden;color:#353a41;font-size:13px;font-weight:550;text-overflow:ellipsis;white-space:nowrap}.row-copy small{overflow:hidden;color:#959ba5;font-size:11px;line-height:16px;text-overflow:ellipsis;white-space:nowrap}.row-title{display:flex;align-items:center;min-width:0;gap:6px}.row-title em{padding:1px 5px;border-radius:7px;color:#4f73b6;background:#edf3ff;font-size:9px;font-style:normal}.load-more{display:flex;justify-content:center;padding:10px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px}.span-2{grid-column:1/-1}.smtp-form{max-width:720px}.compact-toggle{margin-top:8px;border:1px solid #e6e8ec;border-radius:8px}.subsection{display:grid;grid-template-columns:minmax(220px,1fr) minmax(330px,1fr);align-items:center;gap:24px;margin-top:30px;padding-top:20px;border-top:1px solid #eceef1}.smtp-test{display:grid;grid-template-columns:1fr auto;align-items:center;gap:8px}.invite-panel{padding:16px;border:1px solid #e6e8ec;border-radius:8px;background:#fff}.target-details{margin-top:4px;border-top:1px solid #eceef1;border-bottom:1px solid #eceef1}.target-details summary{display:flex;align-items:center;justify-content:space-between;padding:12px 2px;color:#4e545d;font-size:12px;cursor:pointer;list-style:none}.target-details summary span{color:#9299a4;font-size:10px}.target-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px;padding:8px 2px 14px}.target-title{display:block;margin-bottom:6px;color:#4b515a;font-size:12px}.kb-targets{display:grid;gap:6px}.kb-target-row{display:grid;grid-template-columns:minmax(0,1fr) 116px;align-items:center;gap:8px}.empty-inline{color:#989ea7;font-size:11px}.form-actions{display:flex;justify-content:flex-end;padding-top:13px}.list-heading{display:flex;align-items:center;justify-content:space-between;margin:26px 3px 9px}.list-heading strong{color:#454a52;font-size:13px}.list-heading span{color:#999fa8;font-size:11px}.invitation-row{display:grid;grid-template-columns:36px minmax(0,1fr) auto 58px;align-items:center;min-height:66px;padding:8px 12px;border-bottom:1px solid #eef0f3}.invitation-row:last-child{border-bottom:0}.row-icon{display:grid;place-items:center;width:28px;height:28px;border-radius:7px;color:#59709c;background:#f0f4fb}.row-actions{display:flex;align-items:center}.moderation-filter{width:170px;margin-bottom:12px}.report-list,.rebuild-list{display:grid;gap:10px}.report-block,.rebuild-block{padding:15px}.report-block header,.rebuild-block header{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:start;gap:10px}.report-block header>div,.rebuild-block header>div{display:flex;min-width:0;flex-direction:column}.report-block header strong,.rebuild-block header strong{color:#3d4249;font-size:13px;font-weight:600}.report-block header small,.rebuild-block header small{margin-top:2px;color:#969ca6;font-size:11px}.report-block>p{margin:13px 0 4px;color:#555c65;font-size:12px}.report-block code{color:#9a9fa7;font-size:10px}.report-block footer,.rebuild-block footer{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:6px;margin-top:8px}.metric-row{display:flex;flex-wrap:wrap;gap:16px;margin:13px 0;padding:9px 10px;border-radius:6px;color:#858c96;background:#f7f8fa;font-size:11px}.metric-row strong{color:#50565e;font-size:12px}.empty-box{display:flex;align-items:center;justify-content:center;min-height:132px;flex-direction:column;color:#9aa0a9}.empty-box strong{margin-top:6px;color:#606770;font-size:12px}.empty-box span{margin-top:2px;font-size:10px}.empty-box.bordered{border:1px solid #e6e8ec;border-radius:8px}.operation-toolbar{display:grid;grid-template-columns:minmax(240px,410px) auto;align-items:center;gap:8px;margin-bottom:12px}.confirm-dialog :deep(.v-card-title){padding:20px 20px 6px;font-size:17px;font-weight:650}.confirm-dialog :deep(.v-card-text){padding:0 20px 16px;color:#747b85;font-size:13px}.confirm-dialog :deep(.v-card-actions){padding:8px 14px 14px}@media(max-width:820px){.admin-page{padding:18px 16px 40px}.admin-layout{display:block;padding-top:14px}.admin-nav{overflow-x:auto;position:static;flex-direction:row;gap:4px;padding-bottom:10px}.nav-group{display:none}.admin-nav button{flex:none;width:auto}.admin-content{padding-top:16px}.form-grid,.target-grid{grid-template-columns:1fr}.span-2{grid-column:auto}.subsection{grid-template-columns:1fr}.admin-toolbar{grid-template-columns:1fr 135px auto}}@media(max-width:600px){.admin-badge{display:none}.action-heading{align-items:flex-start}.admin-toolbar,.operation-toolbar,.smtp-test{grid-template-columns:1fr}.user-row{grid-template-columns:36px minmax(0,1fr) 34px}.user-row>.state-badge{display:none}.invitation-row{grid-template-columns:36px minmax(0,1fr) 52px}.invitation-row>.state-badge{display:none}.report-block header{grid-template-columns:auto minmax(0,1fr)}.report-block header>.v-btn{grid-column:2}.rebuild-block header{grid-template-columns:36px minmax(0,1fr)}.rebuild-block header>.state-badge{grid-column:2;justify-self:start}.kb-target-row{grid-template-columns:minmax(0,1fr) 105px}}
</style>
