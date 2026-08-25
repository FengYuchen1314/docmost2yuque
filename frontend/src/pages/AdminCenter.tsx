import { useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AtSign, CheckCircle2, Clock3, Crown, Database, ExternalLink, Flag, KeyRound, LoaderCircle, Mail, Pause, Play, RefreshCw, Search, Send, ShieldCheck, Trash2, UserCheck, UserPlus, Users, UserX, Wrench } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { messageOf, post, request } from '../lib/api'
import type { CurrentUser, KnowledgeBase, Team, Workspace } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

interface RegistrationSettings {
  registrationMode: 'CLOSED' | 'PUBLIC'
  passwordLoginEnabled: boolean
  emailCodeLoginEnabled: boolean
  smtpReady: boolean
  settingsVersion: number
}

interface SmtpSettings {
  host: string | null
  port: number | null
  security: 'NONE' | 'STARTTLS' | 'TLS' | null
  username: string | null
  hasPassword: boolean
  fromName: string | null
  fromAddress: string | null
  replyTo: string | null
  enabled: boolean
  configurationVersion: number
  testedAt: string | null
  testStatus: string | null
  lastErrorCode: string | null
  ready: boolean
}

interface Invitation {
  id: string
  workspaceId: string
  email: string
  workspaceRole: 'ADMIN' | 'MEMBER' | 'EXTERNAL'
  targetTeamIds: string[]
  targetKnowledgeBaseRoles: Array<{ knowledgeBaseId: string; role: 'MANAGER' | 'EDITOR' | 'READER' }>
  status: 'QUEUED' | 'SENT' | 'FAILED' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED'
  expiresAt: string
  sentAt: string | null
}

interface SocialReport { id: string; reporterId: string; targetType: 'USER' | 'GARDEN' | 'PUBLICATION'; targetId: string; reason: string; details: string | null; status: 'OPEN' | 'REVIEWING' | 'RESOLVED' | 'DISMISSED'; reviewedBy: string | null; reviewedAt: string | null; resolution: string | null; createdAt: string }

interface InstanceUser { userId: string; email: string; displayName: string | null; status: 'PENDING' | 'ACTIVE' | 'SUSPENDED'; emailVerifiedAt: string | null; instanceRole: 'OWNER' | 'ADMIN' | 'USER'; workspaceCount: number; lastSeenAt: string | null; createdAt: string }

interface AdminPage<T> { items: T[]; nextOffset: number; hasMore: boolean }

interface SearchRebuild {
  id: string
  workspaceId: string
  status: 'RUNNING' | 'PAUSED' | 'SUCCEEDED' | 'FAILED'
  cursorType: 'KNOWLEDGE_BASE' | 'TEAM' | 'PAGE' | 'QUICK_NOTE' | 'TEMPLATE' | 'ATTACHMENT' | 'PUBLICATION' | 'CLEANUP' | 'DONE'
  cursorId: string | null
  processedCount: number
  errorCount: number
  requestedBy: string
  startedAt: string
  updatedAt: string
  completedAt: string | null
  lastError: string | null
}

type Tab = 'access' | 'users' | 'smtp' | 'invitations' | 'moderation' | 'operations'

export function AdminCenter({ workspaces }: { workspaces: Workspace[] }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = adminTab(searchParams.get('tab'))
  const setTab = (value: Tab) => {
    const next = new URLSearchParams(searchParams)
    if (value === 'access') next.delete('tab'); else next.set('tab', value)
    setSearchParams(next, { replace: true })
  }
  return <div className="content-page admin-center">
    <header className="page-header"><div><p className="eyebrow">实例管理</p><h1>管理后台</h1><p>控制注册入口、邮件投递和成员邀请。所有变更都会由服务端再次校验管理员权限。</p></div><span className="admin-shield"><ShieldCheck />实例管理员</span></header>
    <nav className="admin-tabs" aria-label="管理后台导航">
      <button className={tab === 'access' ? 'active' : ''} onClick={() => setTab('access')}><KeyRound />登录与注册</button>
      <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><Users />用户管理</button>
      <button className={tab === 'smtp' ? 'active' : ''} onClick={() => setTab('smtp')}><Mail />邮件服务</button>
      <button className={tab === 'invitations' ? 'active' : ''} onClick={() => setTab('invitations')}><UserPlus />成员邀请</button>
      <button className={tab === 'moderation' ? 'active' : ''} onClick={() => setTab('moderation')}><Flag />内容治理</button>
      <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}><Wrench />系统运维</button>
    </nav>
    {tab === 'access' && <AccessSettings />}
    {tab === 'users' && <UserManagementPanel />}
    {tab === 'smtp' && <SmtpSettingsPanel />}
    {tab === 'invitations' && <InvitationSettings workspaces={workspaces} />}
    {tab === 'moderation' && <ModerationPanel />}
    {tab === 'operations' && <SearchOperationsPanel workspaces={workspaces} />}
  </div>
}

function adminTab(value: string | null): Tab { return value === 'users' || value === 'smtp' || value === 'invitations' || value === 'moderation' || value === 'operations' ? value : 'access' }

export function SearchOperationsPanel({ workspaces }: { workspaces: Workspace[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [runningId, setRunningId] = useState<string | null>(null)
  const [runError, setRunError] = useState<unknown>(null)
  const stopRequested = useRef(false)
  useEffect(() => { if (!workspaces.some((workspace) => workspace.id === workspaceId)) setWorkspaceId(workspaces[0]?.id ?? '') }, [workspaces, workspaceId])
  const rebuilds = useInfiniteQuery({ queryKey: ['search-rebuilds', workspaceId], initialPageParam: 0, queryFn: ({ pageParam }) => post<AdminPage<SearchRebuild>>('/api/v1/search/rebuild/page', { workspaceId, limit: 20, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined, enabled: Boolean(workspaceId), refetchInterval: runningId ? 2_000 : false })
  const refresh = async () => rebuilds.refetch()
  const start = useMutation({ mutationFn: () => post<SearchRebuild>('/api/v1/search/rebuild/start', { workspaceId }), onSuccess: refresh })
  const action = useMutation({
    mutationFn: ({ operation, rebuildId }: { operation: 'advance' | 'pause' | 'resume'; rebuildId: string }) => post<SearchRebuild>(`/api/v1/search/rebuild/${operation}`, { rebuildId, batchSize: operation === 'advance' ? 500 : undefined }),
    onSuccess: refresh,
  })
  const runToCompletion = async (initial: SearchRebuild) => {
    setRunningId(initial.id); setRunError(null); stopRequested.current = false
    let job = initial
    try {
      if (job.status === 'PAUSED') job = await post<SearchRebuild>('/api/v1/search/rebuild/resume', { rebuildId: job.id })
      for (let batch = 0; batch < 10_000 && job.status === 'RUNNING'; batch += 1) {
        if (stopRequested.current) { job = await post<SearchRebuild>('/api/v1/search/rebuild/pause', { rebuildId: job.id }); break }
        job = await post<SearchRebuild>('/api/v1/search/rebuild/advance', { rebuildId: job.id, batchSize: 500 })
        if (batch % 3 === 0) await refresh()
      }
    } catch (reason) {
      setRunError(reason)
    } finally {
      setRunningId(null); await refresh()
    }
  }
  const jobs = rebuilds.data?.pages.flatMap((value) => value.items) ?? []
  const active = jobs.find((job) => job.status === 'RUNNING' || job.status === 'PAUSED')
  const operationError = rebuilds.error ?? start.error ?? action.error ?? runError
  return <section className="admin-panel search-operations-panel"><header><span><Database /></span><div><h2>搜索索引运维</h2><p>按空间重建搜索索引；新索引逐批写入，可暂停和恢复，完成后清理陈旧文档。</p></div><StatusBadge good={!active}>{active ? statusLabel(active.status) : '索引空闲'}</StatusBadge></header>
    <div className="search-operation-controls"><label className="field"><span className="field-label">目标空间</span><select aria-label="索引目标空间" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label><button className="button primary" disabled={!workspaceId || Boolean(active) || start.isPending} onClick={() => start.mutate()}>{start.isPending ? <LoaderCircle className="spin" /> : <RefreshCw />}新建重建任务</button></div>
    <div className="search-rebuild-list">{jobs.map((job) => { const running = runningId === job.id; return <article key={job.id} className={`status-${job.status.toLowerCase()}`}><header><span><Database /></span><div><strong>{phaseLabel(job.cursorType)}</strong><small>任务 {job.id.slice(0, 8)} · 开始于 {formatTime(job.startedAt)}</small></div><i>{statusLabel(job.status)}</i></header><div className="search-rebuild-metrics"><span><strong>{job.processedCount.toLocaleString('zh-CN')}</strong><small>已处理</small></span><span><strong>{job.errorCount}</strong><small>错误</small></span><span><strong>{job.completedAt ? formatTime(job.completedAt) : formatTime(job.updatedAt)}</strong><small>{job.completedAt ? '完成时间' : '最近进度'}</small></span></div>{job.lastError && <div className="inline-error">{job.lastError}</div>}<footer>{job.status === 'RUNNING' && <><button className="button secondary small" disabled={action.isPending || running} onClick={() => action.mutate({ operation: 'advance', rebuildId: job.id })}><Play />继续一批</button><button className="button quiet small" disabled={action.isPending || running} onClick={() => action.mutate({ operation: 'pause', rebuildId: job.id })}><Pause />暂停</button><button className="button primary small" disabled={Boolean(runningId)} onClick={() => void runToCompletion(job)}>{running ? <LoaderCircle className="spin" /> : <Play />}{running ? '自动重建中' : '运行至完成'}</button></>}{job.status === 'PAUSED' && <><button className="button secondary small" disabled={action.isPending || Boolean(runningId)} onClick={() => action.mutate({ operation: 'resume', rebuildId: job.id })}><Play />恢复</button><button className="button primary small" disabled={Boolean(runningId)} onClick={() => void runToCompletion(job)}><Play />恢复并运行至完成</button></>}{running && <button className="button danger small" onClick={() => { stopRequested.current = true }}><Pause />完成当前批次后暂停</button>}</footer></article> })}{!rebuilds.isPending && !jobs.length && <div className="admin-empty"><Database /><strong>还没有索引重建记录</strong><p>正常增量索引无需人工操作；仅在迁移、修复或搜索结构升级后执行全量重建。</p></div>}</div>
    {rebuilds.hasNextPage && <button className="button secondary admin-load-more" disabled={rebuilds.isFetchingNextPage} onClick={() => rebuilds.fetchNextPage()}>{rebuilds.isFetchingNextPage ? '加载中…' : '加载更多重建记录'}</button>}
    {Boolean(operationError) && <div className="form-error">{messageOf(operationError)}</div>}
  </section>
}

export function UserManagementPanel() {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query.trim())
  const [status, setStatus] = useState<'ALL' | InstanceUser['status']>('ALL')
  const currentUser = useQuery({ queryKey: ['me'], queryFn: () => request<CurrentUser>('/api/v1/auth/me') })
  const users = useInfiniteQuery({
    queryKey: ['admin-users', deferredQuery, status],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<AdminPage<InstanceUser>>('/api/v1/admin/users/page', { query: deferredQuery || null, status, limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
  })
  const update = useMutation({
    mutationFn: ({ operation, user }: { operation: 'activate' | 'suspend' | 'grant-admin' | 'revoke-admin'; user: InstanceUser }) => operation === 'activate' || operation === 'suspend'
      ? post<InstanceUser>('/api/v1/admin/users/status', { userId: user.userId, status: operation === 'activate' ? 'ACTIVE' : 'SUSPENDED' })
      : post<InstanceUser>('/api/v1/admin/users/administrator', { userId: user.userId, administrator: operation === 'grant-admin' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  })
  const values = users.data?.pages.flatMap((value) => value.items) ?? []
  return <section className="admin-panel user-management-panel"><header><span><Users /></span><div><h2>实例用户</h2><p>管理账号状态和实例管理员权限；停用或降权会立即退出该用户的全部设备。</p></div><StatusBadge good>{values.filter((user) => user.status === 'ACTIVE').length}{users.hasNextPage ? '+' : ''} 个活跃账号</StatusBadge></header>
    <div className="admin-user-toolbar"><label><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="按邮箱或显示名搜索…" /></label><div>{(['ALL', 'ACTIVE', 'SUSPENDED', 'PENDING'] as const).map((value) => <button className={status === value ? 'active' : ''} key={value} onClick={() => setStatus(value)}>{({ ALL: '全部', ACTIVE: '正常', SUSPENDED: '已停用', PENDING: '待激活' })[value]}</button>)}</div></div>
    <div className="admin-user-list">{values.map((user) => { const protectedUser = user.instanceRole === 'OWNER' || user.userId === currentUser.data?.userId; return <article key={user.userId} className={user.status === 'SUSPENDED' ? 'suspended' : ''}><span className="admin-user-avatar">{(user.displayName || user.email).slice(0, 1).toUpperCase()}</span><div className="admin-user-identity"><strong>{user.displayName || user.email}{user.instanceRole !== 'USER' && <i className={user.instanceRole.toLowerCase()}><Crown />{user.instanceRole === 'OWNER' ? '所有者' : '管理员'}</i>}</strong><p>{user.displayName && `${user.email} · `}{user.workspaceCount} 个空间 · {user.lastSeenAt ? `最近活动 ${formatTime(user.lastSeenAt)}` : '尚无活动记录'}</p><small>注册于 {formatTime(user.createdAt)} · {user.emailVerifiedAt ? '邮箱已验证' : '邮箱待验证'}</small></div><span className={`admin-user-status ${user.status.toLowerCase()}`}>{({ ACTIVE: '正常', SUSPENDED: '已停用', PENDING: '待激活' })[user.status]}</span><div className="admin-user-actions">
      {user.instanceRole === 'USER' ? <button className="button quiet small" disabled={user.status !== 'ACTIVE' || update.isPending} onClick={() => confirmation.confirm({ title: `将 ${user.email} 设为实例管理员`, description: '该用户将可管理注册、SMTP、邀请和实例用户，并需重新登录。', confirmLabel: '授予管理权限', tone: 'primary' }, () => update.mutate({ operation: 'grant-admin', user }))}><ShieldCheck />设为管理员</button> : user.instanceRole === 'ADMIN' ? <button className="button quiet small" disabled={protectedUser || update.isPending} onClick={() => confirmation.confirm({ title: `撤销 ${user.email} 的管理员权限`, description: '该用户的全部登录设备会立即退出，下次登录仅保留普通用户权限。', confirmLabel: '撤销管理员' }, () => update.mutate({ operation: 'revoke-admin', user }))}><UserX />撤销管理员</button> : <button className="button quiet small" disabled><Crown />实例所有者</button>}
      {user.status === 'SUSPENDED' ? <button className="button secondary small" disabled={update.isPending} onClick={() => update.mutate({ operation: 'activate', user })}><UserCheck />恢复账号</button> : <button className="button danger small" disabled={protectedUser || update.isPending} onClick={() => confirmation.confirm({ title: `停用账号 ${user.email}`, description: '账号将无法登录，现有全部会话会立即失效。管理员之后仍可恢复账号。', confirmLabel: '停用账号' }, () => update.mutate({ operation: 'suspend', user }))}><UserX />停用账号</button>}
    </div></article> })}{!users.isPending && !values.length && <div className="admin-empty"><Users /><strong>没有匹配的用户</strong><p>尝试更换状态筛选或搜索关键词。</p></div>}</div>
    {users.hasNextPage && <button className="button secondary admin-load-more" disabled={users.isFetchingNextPage} onClick={() => users.fetchNextPage()}>{users.isFetchingNextPage ? '加载中…' : '加载更多用户'}</button>}
    {(users.error || update.error) && <div className="form-error admin-user-error">{messageOf(users.error ?? update.error)}</div>}
    {confirmation.dialog}
  </section>
}

export function ModerationPanel() {
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<'ALL' | SocialReport['status']>('OPEN')
  const reports = useInfiniteQuery({ queryKey: ['admin-social-reports', status], initialPageParam: 0, queryFn: ({ pageParam }) => post<AdminPage<SocialReport>>('/api/v1/admin/social/reports/page', { status: status === 'ALL' ? null : status, limit: 30, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined })
  const review = useMutation({ mutationFn: ({ reportId, nextStatus, resolution }: { reportId: string; nextStatus: Exclude<SocialReport['status'], 'OPEN'>; resolution: string }) => post<void>('/api/v1/admin/social/reports/review', { reportId, status: nextStatus, resolution: resolution || null }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-social-reports'] }) })
  const values = reports.data?.pages.flatMap((value) => value.items) ?? []
  return <section className="admin-panel moderation-panel"><header><span><Flag /></span><div><h2>内容治理</h2><p>集中审核用户、知识花园和公开内容举报，并保留处理结论。</p></div><StatusBadge good={!values.some((report) => report.status === 'OPEN')}>{values.filter((report) => report.status === 'OPEN').length}{reports.hasNextPage ? '+' : ''} 个待处理</StatusBadge></header><div className="moderation-filter">{(['ALL', 'OPEN', 'REVIEWING', 'RESOLVED', 'DISMISSED'] as const).map((value) => <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{({ ALL: '全部', OPEN: '待处理', REVIEWING: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回' })[value]}</button>)}</div><div className="report-list">{values.map((report) => <ReportRow key={report.id} value={report} pending={review.isPending} onReview={(nextStatus, resolution) => review.mutate({ reportId: report.id, nextStatus, resolution })} />)}{!reports.isPending && !values.length && <div className="admin-empty"><ShieldCheck /><strong>当前没有举报</strong><p>符合筛选条件的举报会显示在这里。</p></div>}</div>{reports.hasNextPage && <button className="button secondary admin-load-more" disabled={reports.isFetchingNextPage} onClick={() => reports.fetchNextPage()}>{reports.isFetchingNextPage ? '加载中…' : '加载更多举报'}</button>}{(reports.error || review.error) && <div className="form-error">{messageOf(reports.error ?? review.error)}</div>}</section>
}

function ReportRow({ value, pending, onReview }: { value: SocialReport; pending: boolean; onReview: (status: Exclude<SocialReport['status'], 'OPEN'>, resolution: string) => void }) {
  const [resolution, setResolution] = useState(value.resolution ?? '')
  return <article className="report-row"><header><span className={`report-status ${value.status.toLowerCase()}`}>{({ OPEN: '待处理', REVIEWING: '审核中', RESOLVED: '已处理', DISMISSED: '已驳回' })[value.status]}</span><div><strong>{targetLabel(value.targetType)}举报 · {value.reason}</strong><small>举报人 {value.reporterId} · {formatTime(value.createdAt)}</small></div>{value.targetType === 'PUBLICATION' && <a className="button quiet small" href={`/p/${value.targetId}`} target="_blank" rel="noreferrer">查看内容<ExternalLink /></a>}</header><div className="report-body"><p>{value.details || '举报人未补充详细说明。'}</p><code>{value.targetType} · {value.targetId}</code></div><footer><input value={resolution} onChange={(event) => setResolution(event.target.value.slice(0, 1000))} placeholder="填写审核结论或处理说明…" />{value.status === 'OPEN' && <button className="button secondary small" disabled={pending} onClick={() => onReview('REVIEWING', resolution)}>开始审核</button>}<button className="button quiet small" disabled={pending} onClick={() => onReview('DISMISSED', resolution)}>驳回</button><button className="button primary small" disabled={pending || !resolution.trim()} onClick={() => onReview('RESOLVED', resolution)}>完成处理</button></footer></article>
}

function AccessSettings() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['admin-auth-settings'], queryFn: () => request<RegistrationSettings>('/api/v1/admin/auth-settings') })
  const [draft, setDraft] = useState<RegistrationSettings | null>(null)
  useEffect(() => { if (settings.data) setDraft(settings.data) }, [settings.data])
  const save = useMutation({
    mutationFn: () => post<RegistrationSettings>('/api/v1/admin/auth-settings/registration', {
      registrationMode: draft?.registrationMode,
      passwordLoginEnabled: draft?.passwordLoginEnabled,
      emailCodeLoginEnabled: draft?.emailCodeLoginEnabled,
    }),
    onSuccess: async (value) => {
      setDraft(value)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-auth-settings'] }),
        queryClient.invalidateQueries({ queryKey: ['registration-status'] }),
      ])
    },
  })
  if (!draft) return <PanelLoading />
  return <section className="admin-panel">
    <header><span><KeyRound /></span><div><h2>登录与注册</h2><p>邮箱是唯一账号标识，密码登录保持为默认入口。</p></div><StatusBadge good={draft.registrationMode === 'PUBLIC'}>{draft.registrationMode === 'PUBLIC' ? '公开注册已开启' : '公开注册已关闭'}</StatusBadge></header>
    <div className="admin-setting-list">
      <SettingSwitch title="允许公开注册" description="访客可使用邮箱和密码申请账号；必须完成邮件验证后才能进入。" checked={draft.registrationMode === 'PUBLIC'} disabled={!draft.smtpReady} onChange={(checked) => setDraft({ ...draft, registrationMode: checked ? 'PUBLIC' : 'CLOSED' })} />
      {!draft.smtpReady && <div className="admin-warning"><Mail /><div><strong>邮件服务尚未就绪</strong><p>先在“邮件服务”保存配置并发送测试邮件，成功后才能开启公开注册。</p></div></div>}
      <SettingSwitch title="允许密码登录" description="登录页默认显示邮箱与密码。建议始终保留，避免邮件服务故障时所有用户无法进入。" checked={draft.passwordLoginEnabled} onChange={(checked) => setDraft({ ...draft, passwordLoginEnabled: checked })} />
      <SettingSwitch title="允许邮箱验证码登录" description="用户可主动切换到一次性验证码登录；仅在 SMTP 就绪时可用。" checked={draft.emailCodeLoginEnabled} disabled={!draft.smtpReady} onChange={(checked) => setDraft({ ...draft, emailCodeLoginEnabled: checked })} />
    </div>
    {save.error && <div className="form-error">{messageOf(save.error)}</div>}
    <footer><small>配置版本 {draft.settingsVersion}</small><button className="button primary" disabled={save.isPending || (!draft.passwordLoginEnabled && !draft.emailCodeLoginEnabled)} onClick={() => save.mutate()}>{save.isPending ? '正在保存…' : '保存登录设置'}</button></footer>
  </section>
}

function SmtpSettingsPanel() {
  const queryClient = useQueryClient()
  const settings = useQuery({ queryKey: ['admin-smtp'], queryFn: () => request<SmtpSettings>('/api/v1/admin/smtp') })
  const [draft, setDraft] = useState({ host: '', port: '587', security: 'STARTTLS' as SmtpSettings['security'], username: '', password: '', clearPassword: false, fromName: '知序', fromAddress: '', replyTo: '', enabled: true })
  const [recipient, setRecipient] = useState('')
  const [testQueued, setTestQueued] = useState(false)
  useEffect(() => {
    if (!settings.data) return
    setDraft({
      host: settings.data.host ?? '', port: String(settings.data.port ?? 587), security: settings.data.security ?? 'STARTTLS',
      username: settings.data.username ?? '', password: '', clearPassword: false, fromName: settings.data.fromName ?? '知序',
      fromAddress: settings.data.fromAddress ?? '', replyTo: settings.data.replyTo ?? '', enabled: settings.data.enabled,
    })
  }, [settings.data])
  const save = useMutation({
    mutationFn: () => post<SmtpSettings>('/api/v1/admin/smtp/update', { ...draft, port: Number(draft.port), password: draft.password || null, replyTo: draft.replyTo || null }),
    onSuccess: async () => {
      setDraft((current) => ({ ...current, password: '', clearPassword: false }))
      setTestQueued(false)
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-smtp'] }), queryClient.invalidateQueries({ queryKey: ['admin-auth-settings'] })])
    },
  })
  const test = useMutation({
    mutationFn: () => post<void>('/api/v1/admin/smtp/test', { recipient: recipient || null }),
    onSuccess: () => {
      setTestQueued(true)
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ['admin-smtp'] }), 2_000)
    },
  })
  const value = settings.data
  if (settings.isPending) return <PanelLoading />
  return <section className="admin-panel smtp-panel">
    <header><span><Mail /></span><div><h2>SMTP 邮件服务</h2><p>用于公开注册验证、验证码登录、邀请和测试邮件。</p></div><StatusBadge good={Boolean(value?.ready)}>{value?.ready ? '已测试可用' : value?.testStatus === 'FAILED' ? '测试失败' : '尚未就绪'}</StatusBadge></header>
    <form className="admin-form-grid" onSubmit={(event) => submit(event, save.mutate)}>
      <label className="field span-2"><span className="field-label">SMTP 主机</span><input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="smtp.example.com" required /></label>
      <label className="field"><span className="field-label">端口</span><input type="number" min="1" max="65535" value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} required /></label>
      <label className="field"><span className="field-label">安全方式</span><select value={draft.security ?? 'STARTTLS'} onChange={(event) => setDraft({ ...draft, security: event.target.value as SmtpSettings['security'] })}><option value="STARTTLS">STARTTLS</option><option value="TLS">TLS / SMTPS</option><option value="NONE">无加密（仅限受控内网）</option></select></label>
      <label className="field span-2"><span className="field-label">用户名</span><input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} autoComplete="username" /></label>
      <label className="field span-2"><span className="field-label">密码</span><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value, clearPassword: false })} autoComplete="new-password" placeholder={value?.hasPassword ? '已保存；留空表示不修改' : 'SMTP 密码'} /><small>密码由服务端加密保存，读取接口永不返回明文。</small></label>
      {value?.hasPassword && <label className="admin-check span-2"><input type="checkbox" checked={draft.clearPassword} onChange={(event) => setDraft({ ...draft, clearPassword: event.target.checked, password: '' })} />清除已保存的密码</label>}
      <label className="field"><span className="field-label">发件人名称</span><input value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} required /></label>
      <label className="field"><span className="field-label">发件邮箱</span><input type="email" value={draft.fromAddress} onChange={(event) => setDraft({ ...draft, fromAddress: event.target.value })} required /></label>
      <label className="field span-2"><span className="field-label">回复邮箱（可选）</span><input type="email" value={draft.replyTo} onChange={(event) => setDraft({ ...draft, replyTo: event.target.value })} /></label>
      <SettingSwitch title="启用邮件服务" description="关闭后不会发送验证、验证码或邀请邮件。" checked={draft.enabled} onChange={(checked) => setDraft({ ...draft, enabled: checked })} />
      {(save.error || value?.lastErrorCode) && <div className="form-error span-2">{save.error ? messageOf(save.error) : `最近测试失败：${value?.lastErrorCode}`}</div>}
      <div className="admin-form-actions span-2"><small>{value?.testedAt ? `最近测试：${formatTime(value.testedAt)}` : '保存配置后发送测试邮件'}</small><button className="button primary" disabled={save.isPending}>{save.isPending ? '正在保存…' : '保存 SMTP 配置'}</button></div>
    </form>
    <div className="smtp-test-row"><div><strong>发送测试邮件</strong><p>留空时发送到当前管理员邮箱。测试任务会异步投递。</p></div><input type="email" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="recipient@example.com" /><button className="button secondary" disabled={!value?.enabled || test.isPending} onClick={() => test.mutate()}><Send />{test.isPending ? '提交中' : '发送测试'}</button></div>
    {(test.error || testQueued) && <div className={test.error ? 'form-error' : 'admin-success'}>{test.error ? messageOf(test.error) : '测试邮件已加入队列，稍后会刷新测试状态。'}</div>}
  </section>
}

export function InvitationSettings({ workspaces }: { workspaces: Workspace[] }) {
  const queryClient = useQueryClient()
  const organizationWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.workspaceType === 'ORGANIZATION'),
    [workspaces],
  )
  const [workspaceId, setWorkspaceId] = useState(organizationWorkspaces[0]?.id ?? '')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Invitation['workspaceRole']>('MEMBER')
  const [expiresInHours, setExpiresInHours] = useState('168')
  const [targetTeamIds, setTargetTeamIds] = useState<string[]>([])
  const [targetKnowledgeBaseRoles, setTargetKnowledgeBaseRoles] = useState<Record<string, 'MANAGER' | 'EDITOR' | 'READER'>>({})
  useEffect(() => {
    if (!organizationWorkspaces.some((workspace) => workspace.id === workspaceId)) {
      setWorkspaceId(organizationWorkspaces[0]?.id ?? '')
    }
  }, [organizationWorkspaces, workspaceId])
  const teams = useQuery({ queryKey: ['teams', workspaceId], queryFn: () => post<Team[]>('/api/v1/teams/list', { workspaceId }), enabled: Boolean(workspaceId) })
  const knowledgeBases = useQuery({ queryKey: ['knowledge-bases', workspaceId], queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }), enabled: Boolean(workspaceId) })
  const invitations = useInfiniteQuery({ queryKey: ['admin-invitations', workspaceId], initialPageParam: 0, queryFn: ({ pageParam }) => post<AdminPage<Invitation>>('/api/v1/admin/invitations/page', { workspaceId, limit: 30, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined, enabled: Boolean(workspaceId) })
  const create = useMutation({
    mutationFn: () => post<Invitation>('/api/v1/admin/invitations/create', { workspaceId, email, workspaceRole: role, targetTeamIds, targetKnowledgeBaseRoles: Object.entries(targetKnowledgeBaseRoles).map(([knowledgeBaseId, targetRole]) => ({ knowledgeBaseId, role: targetRole })), expiresInHours: Number(expiresInHours) }),
    onSuccess: async () => { setEmail(''); setTargetTeamIds([]); setTargetKnowledgeBaseRoles({}); await queryClient.invalidateQueries({ queryKey: ['admin-invitations', workspaceId] }) },
  })
  const action = useMutation({
    mutationFn: ({ operation, invitationId }: { operation: 'resend' | 'revoke'; invitationId: string }) => post(`/api/v1/admin/invitations/${operation}`, { invitationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-invitations', workspaceId] }),
  })
  const invitationValues = invitations.data?.pages.flatMap((value) => value.items) ?? []
  const changeWorkspace = (nextWorkspaceId: string) => { setWorkspaceId(nextWorkspaceId); setTargetTeamIds([]); setTargetKnowledgeBaseRoles({}) }
  const toggleTeam = (teamId: string, checked: boolean) => setTargetTeamIds((current) => checked ? [...current, teamId] : current.filter((value) => value !== teamId))
  const toggleKnowledgeBase = (knowledgeBaseId: string, checked: boolean) => setTargetKnowledgeBaseRoles((current) => { const next = { ...current }; if (checked) next[knowledgeBaseId] = 'READER'; else delete next[knowledgeBaseId]; return next })
  return <section className="admin-panel invitation-panel">
    <header><span><UserPlus /></span><div><h2>成员邀请</h2><p>无论公开注册是否开启，管理员都可以向指定邮箱发送一次性邀请。</p></div><StatusBadge good>{invitationValues.filter((item) => ['QUEUED', 'SENT', 'FAILED'].includes(item.status)).length}{invitations.hasNextPage ? '+' : ''} 个待处理</StatusBadge></header>
    <form className="invite-create-row" onSubmit={(event) => submit(event, create.mutate)}>
      <label><span>目标组织空间</span><select value={workspaceId} onChange={(event) => changeWorkspace(event.target.value)}>{organizationWorkspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
      <label className="invite-email"><span>受邀邮箱</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="member@example.com" required /></label>
      <label><span>角色</span><select value={role} onChange={(event) => setRole(event.target.value as Invitation['workspaceRole'])}><option value="MEMBER">成员</option><option value="ADMIN">空间管理员</option><option value="EXTERNAL">外部联系人</option></select></label>
      <label><span>有效期</span><select value={expiresInHours} onChange={(event) => setExpiresInHours(event.target.value)}><option value="24">1 天</option><option value="72">3 天</option><option value="168">7 天</option><option value="720">30 天</option></select></label>
      <button className="button primary" disabled={!workspaceId || !email || create.isPending}><Send />{create.isPending ? '正在创建' : '发送邀请'}</button>
      <details className="invite-resource-targets">
        <summary>同时加入团队或知识库 <small>{targetTeamIds.length + Object.keys(targetKnowledgeBaseRoles).length ? `已选 ${targetTeamIds.length + Object.keys(targetKnowledgeBaseRoles).length} 项` : '可选'}</small></summary>
        <div className="invite-target-columns">
          <fieldset><legend>团队</legend>{teams.data?.map((team) => <label key={team.id}><input type="checkbox" aria-label={`加入团队 ${team.name}`} checked={targetTeamIds.includes(team.id)} onChange={(event) => toggleTeam(team.id, event.target.checked)} /><span>{team.name}</span><small>成员</small></label>)}{!teams.isPending && !teams.data?.length && <p>当前空间没有团队</p>}</fieldset>
          <fieldset><legend>知识库</legend>{knowledgeBases.data?.map((knowledgeBase) => { const targetRole = targetKnowledgeBaseRoles[knowledgeBase.id]; return <label key={knowledgeBase.id}><input type="checkbox" aria-label={`加入知识库 ${knowledgeBase.name}`} checked={Boolean(targetRole)} onChange={(event) => toggleKnowledgeBase(knowledgeBase.id, event.target.checked)} /><span>{knowledgeBase.name}</span><select aria-label={`${knowledgeBase.name} 的知识库角色`} disabled={!targetRole} value={targetRole ?? 'READER'} onChange={(event) => setTargetKnowledgeBaseRoles((current) => ({ ...current, [knowledgeBase.id]: event.target.value as 'MANAGER' | 'EDITOR' | 'READER' }))}><option value="READER">阅读</option><option value="EDITOR">编辑</option><option value="MANAGER">管理</option></select></label>})}{!knowledgeBases.isPending && !knowledgeBases.data?.length && <p>当前空间没有知识库</p>}</fieldset>
        </div>
      </details>
    </form>
    {!organizationWorkspaces.length && <div className="admin-warning"><Users /><div><strong>还没有组织空间</strong><p>个人空间始终只属于本人；请先创建组织空间，再邀请成员。</p></div></div>}
    {(invitations.error || create.error || action.error) && <div className="form-error">{messageOf(invitations.error ?? create.error ?? action.error)}</div>}
    <div className="invitation-list">
      {invitationValues.map((invitation) => <article key={invitation.id}>
        <span className="invitation-avatar"><AtSign /></span><div><strong>{invitation.email}</strong><p>{roleLabel(invitation.workspaceRole)} · {invitation.sentAt ? `发送于 ${formatTime(invitation.sentAt)}` : '等待邮件任务'} · 到期 {formatTime(invitation.expiresAt)}</p>{invitationTargetSummary(invitation, teams.data ?? [], knowledgeBases.data ?? []) && <small className="invitation-target-summary">{invitationTargetSummary(invitation, teams.data ?? [], knowledgeBases.data ?? [])}</small>}</div><InvitationStatus value={invitation.status} />
        {['QUEUED', 'SENT', 'FAILED'].includes(invitation.status) && <div className="invitation-actions"><button className="icon-button" title="重新发送" aria-label={`重新发送给 ${invitation.email}`} disabled={action.isPending} onClick={() => action.mutate({ operation: 'resend', invitationId: invitation.id })}><RefreshCw /></button><button className="icon-button danger" title="撤销" aria-label={`撤销发给 ${invitation.email} 的邀请`} disabled={action.isPending} onClick={() => action.mutate({ operation: 'revoke', invitationId: invitation.id })}><Trash2 /></button></div>}
      </article>)}
      {!invitations.isPending && !invitationValues.length && <div className="admin-empty"><Users /><strong>还没有邀请记录</strong><p>上方创建后，邮件投递状态会出现在这里。</p></div>}
    </div>
    {invitations.hasNextPage && <button className="button secondary admin-load-more" disabled={invitations.isFetchingNextPage} onClick={() => invitations.fetchNextPage()}>{invitations.isFetchingNextPage ? '加载中…' : '加载更多邀请'}</button>}
  </section>
}

function SettingSwitch({ title, description, checked, disabled = false, onChange }: { title: string; description: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className={`admin-switch ${disabled ? 'disabled' : ''}`}><div><strong>{title}</strong><p>{description}</p></div><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><i /></label>
}
function StatusBadge({ good = false, children }: { good?: boolean; children: React.ReactNode }) { return <span className={`admin-status ${good ? 'good' : ''}`}>{good ? <CheckCircle2 /> : <Clock3 />}{children}</span> }
function InvitationStatus({ value }: { value: Invitation['status'] }) { return <span className={`invitation-status ${value.toLowerCase()}`}>{({ QUEUED: '排队中', SENT: '已发送', FAILED: '失败', ACCEPTED: '已接受', EXPIRED: '已过期', REVOKED: '已撤销' })[value]}</span> }
function PanelLoading() { return <section className="admin-panel admin-loading"><span className="loading-pulse" /></section> }
function roleLabel(role: Invitation['workspaceRole']) { return ({ ADMIN: '空间管理员', MEMBER: '成员', EXTERNAL: '外部联系人' })[role] }
function invitationTargetSummary(invitation: Invitation, teams: Team[], knowledgeBases: KnowledgeBase[]) { const teamNames = (invitation.targetTeamIds ?? []).map((id) => teams.find((team) => team.id === id)?.name ?? '已删除团队'); const knowledgeBaseNames = (invitation.targetKnowledgeBaseRoles ?? []).map((target) => `${knowledgeBases.find((knowledgeBase) => knowledgeBase.id === target.knowledgeBaseId)?.name ?? '已删除知识库'}（${({ MANAGER: '管理', EDITOR: '编辑', READER: '阅读' })[target.role]}）`); return [...teamNames, ...knowledgeBaseNames].length ? `加入：${[...teamNames, ...knowledgeBaseNames].join('、')}` : '' }
function targetLabel(value: SocialReport['targetType']) { return ({ USER: '用户', GARDEN: '知识花园', PUBLICATION: '公开内容' })[value] }
function statusLabel(value: SearchRebuild['status']) { return ({ RUNNING: '运行中', PAUSED: '已暂停', SUCCEEDED: '已完成', FAILED: '失败' })[value] }
function phaseLabel(value: SearchRebuild['cursorType']) { return ({ KNOWLEDGE_BASE: '知识库索引', TEAM: '团队索引', PAGE: '文稿索引', QUICK_NOTE: '小记索引', TEMPLATE: '模板索引', ATTACHMENT: '附件索引', PUBLICATION: '公开内容索引', CLEANUP: '清理陈旧索引', DONE: '重建完成' })[value] }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function submit(event: FormEvent, action: () => void) { event.preventDefault(); action() }
