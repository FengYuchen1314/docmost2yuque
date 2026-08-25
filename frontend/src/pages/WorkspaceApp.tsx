import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowUpDown, BarChart3, Bell, BookOpen, ChevronDown, ChevronRight, Code2, Compass, Copy, Download, FileText, Folder, FolderPlus, Home, LayoutGrid, LayoutTemplate, Link2,
  Cloud, DownloadCloud, LogOut, Menu, MoreHorizontal, Network, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Search, Settings, Share2, Sparkles, StickyNote, Trash2, Unlink, UserRound, Users, WifiOff, X,
} from 'lucide-react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ApiError, messageOf, post, request, resetCsrf, upload } from '../lib/api'
import { encodeContentCardToken, safeMediaUrl, type ParsedContentCard } from '../lib/contentCards'
import { usePageCollaboration } from '../lib/collaboration'
import {
  cachePage, flushPageUpdates, isNetworkFailure, OFFLINE_QUEUE_EVENT, optimisticPage,
  pendingPageUpdateCount, queuePageUpdate, readCachedPage, toPendingPageUpdate,
  type PendingPageUpdate,
} from '../lib/offline'
import type { CatalogNode, CatalogTree, CurrentUser, KnowledgeBase, Page, Team, Workspace } from '../types'
import { CommentDrawer, FavoriteButton } from './EngagementPanels'
import { ReferenceDrawer, ReferenceInsertDialog } from './ReferencePanels'
import { ContentCardMenu, DocumentCardPreview } from './ContentCardPanels'
import { SearchOverlay } from './SearchOverlay'
import { AnalyticsPanel } from './AnalyticsPanel'
import { SaveTemplateDialog, TemplateCenter } from './TemplateCenter'
import { ContentTransferCenter, KnowledgeBaseTransferDialog, PageExportDialog } from './ContentTransferCenter'
import { FirstClassEditor } from './FirstClassEditors'
import { CatalogManager } from './CatalogManager'
import { PageManagement, type PageManagementTab } from './PageManagement'
import { BlockDocumentEditor, type BlockDocumentEditorHandle } from './BlockDocumentEditor'
import { documentSettingsClassNames, normalizeDocumentSettings } from '../lib/documentSettings'
import { parseKnowledgeBaseAppearance, parseKnowledgeBaseCatalogDisplay } from '../lib/knowledgeBaseAppearance'
import { safeExternalNavigationUrl } from '../lib/publicNavigation'
import { useConfirmDialog } from '../components/ConfirmDialog'

const ProductWorkbench = lazy(() => import('./ProductPages').then((module) => ({ default: module.ProductWorkbench })))
const QuickNotesPage = lazy(() => import('./ProductPages').then((module) => ({ default: module.QuickNotesPage })))
const CaptureSharedContent = lazy(() => import('./ProductPages').then((module) => ({ default: module.CaptureSharedContent })))
const NotificationsPage = lazy(() => import('./ProductPages').then((module) => ({ default: module.NotificationsPage })))
const GlobalTrashPage = lazy(() => import('./ProductPages').then((module) => ({ default: module.GlobalTrashPage })))
const FeedPage = lazy(() => import('./SocialPages').then((module) => ({ default: module.FeedPage })))
const PublicProfileSettingsPage = lazy(() => import('./SocialPages').then((module) => ({ default: module.PublicProfileSettingsPage })))
const OpenPlatformCenter = lazy(() => import('./OpenPlatformCenter').then((module) => ({ default: module.OpenPlatformCenter })))
const AdminCenter = lazy(() => import('./AdminCenter').then((module) => ({ default: module.AdminCenter })))
const WorkspaceSettingsPage = lazy(() => import('./WorkspaceSettings').then((module) => ({ default: module.WorkspaceSettingsPage })))
const KnowledgeBaseSettingsPage = lazy(() => import('./KnowledgeBaseSettings').then((module) => ({ default: module.KnowledgeBaseSettingsPage })))
const AccountSettingsPage = lazy(() => import('./AccountSettings').then((module) => ({ default: module.AccountSettingsPage })))
const TeamPage = lazy(() => import('./TeamPage').then((module) => ({ default: module.TeamPage })))

function DeferredPage({ children }: { children: ReactNode }) {
  return <Suspense fallback={<div className="route-loading"><span className="loading-pulse" /><p>正在加载页面…</p></div>}>{children}</Suspense>
}

export function WorkspaceApp({ currentUser }: { currentUser: CurrentUser }) {
  const [mobileNav, setMobileNav] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(`kp:sidebar-collapsed:${currentUser.userId}`) === '1')
  const location = useLocation()
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => request<Workspace[]>('/api/v1/workspaces') })
  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', shortcut)
    return () => window.removeEventListener('keydown', shortcut)
  }, [])
  useEffect(() => {
    if (new URLSearchParams(location.search).get('search') === '1') setSearchOpen(true)
  }, [location.search])
  const changeSidebar = (collapsed: boolean) => {
    setSidebarCollapsed(collapsed)
    localStorage.setItem(`kp:sidebar-collapsed:${currentUser.userId}`, collapsed ? '1' : '0')
  }
  return (
    <div className={`app-frame ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <a className="skip-link" href="#app-main-content">跳到主要内容</a>
      <header className="mobile-topbar">
        <button className="icon-button" onClick={() => setMobileNav(true)} aria-label="打开导航"><Menu size={19} /></button>
        <Link className="brand compact" to="/app"><span className="brand-mark">序</span><span>知序</span></Link>
        <button className="icon-button" onClick={() => setSearchOpen(true)} aria-label="搜索"><Search size={19} /></button>
      </header>
      <GlobalRail currentUser={currentUser} onSearch={() => setSearchOpen(true)} />
      <div className={`mobile-scrim ${mobileNav ? 'visible' : ''}`} onClick={() => setMobileNav(false)} />
      <AppSidebar currentUser={currentUser} workspaces={workspaces.data ?? []} mobileOpen={mobileNav} collapsed={sidebarCollapsed} onCollapsedChange={changeSidebar} onClose={() => setMobileNav(false)} onSearch={() => setSearchOpen(true)} />
      <main className="app-main" id="app-main-content" tabIndex={-1}>
        <Routes>
          <Route index element={<DeferredPage><ProductWorkbench workspaces={workspaces.data ?? []} /></DeferredPage>} />
          <Route path="notes" element={<DeferredPage><QuickNotesPage workspaces={workspaces.data ?? []} /></DeferredPage>} />
          <Route path="capture" element={<DeferredPage><CaptureSharedContent workspaces={workspaces.data ?? []} /></DeferredPage>} />
          <Route path="notifications" element={<DeferredPage><NotificationsPage /></DeferredPage>} />
          <Route path="trash" element={<DeferredPage><GlobalTrashPage /></DeferredPage>} />
          <Route path="templates" element={<TemplateCenter workspaces={workspaces.data ?? []} />} />
          <Route path="transfers" element={<ContentTransferCenter />} />
          <Route path="feed" element={<DeferredPage><FeedPage /></DeferredPage>} />
          <Route path="profile" element={<DeferredPage><PublicProfileSettingsPage currentUser={currentUser} /></DeferredPage>} />
          <Route path="account" element={<DeferredPage><AccountSettingsPage /></DeferredPage>} />
          <Route path="open-platform" element={<DeferredPage><OpenPlatformCenter workspaces={workspaces.data ?? []} /></DeferredPage>} />
          <Route path="admin" element={currentUser.instanceAdmin ? <DeferredPage><AdminCenter workspaces={workspaces.data ?? []} /></DeferredPage> : <Navigate to="/app" replace />} />
          <Route path="w/:workspaceId" element={<WorkspaceHome />} />
          <Route path="w/:workspaceId/teams/:teamId" element={<DeferredPage><TeamPage currentUser={currentUser} /></DeferredPage>} />
          <Route path="w/:workspaceId/settings" element={<DeferredPage><WorkspaceSettingsPage /></DeferredPage>} />
          <Route path="pages/:pageId" element={<PageRouteRedirect />} />
          <Route path="kb/:knowledgeBaseId" element={<KnowledgeBaseHome />} />
          <Route path="kb/:knowledgeBaseId/settings" element={<DeferredPage><KnowledgeBaseSettingsPage /></DeferredPage>} />
          <Route path="kb/:knowledgeBaseId/pages/:pageId" element={<PageEditor currentUser={currentUser} />} />
          <Route path="*" element={<Navigate to="/app" replace />} />
        </Routes>
      </main>
      <SearchOverlay workspaces={workspaces.data ?? []} open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ClientRuntimeStatus userId={currentUser.userId} />
    </div>
  )
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

function ClientRuntimeStatus({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const [online, setOnline] = useState(() => navigator.onLine)
  const [pending, setPending] = useState(0)
  const [conflicts, setConflicts] = useState(0)
  const [installPrompt, setInstallPrompt] = useState<InstallPromptEvent | null>(null)
  useEffect(() => {
    let active = true
    void pendingPageUpdateCount(userId).then((count) => active && setPending(count)).catch(() => undefined)
    const queueChange = (event: Event) => setPending((event as CustomEvent<{ count: number }>).detail.count)
    const offline = () => setOnline(false)
    const flush = async () => {
      setOnline(true)
      const result = await flushPageUpdates(userId, async (update) => {
        const saved = await sendPendingUpdate(update)
        queryClient.setQueryData(['page', update.pageId], saved)
        return saved
      })
      setPending(result.remaining)
      setConflicts(result.conflictPageIds.length)
      if (result.sent) void queryClient.invalidateQueries({ queryKey: ['pages'] })
    }
    const beforeInstall = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPromptEvent) }
    window.addEventListener(OFFLINE_QUEUE_EVENT, queueChange)
    window.addEventListener('offline', offline)
    window.addEventListener('online', flush)
    window.addEventListener('beforeinstallprompt', beforeInstall)
    if (navigator.onLine) void flush()
    return () => {
      active = false
      window.removeEventListener(OFFLINE_QUEUE_EVENT, queueChange)
      window.removeEventListener('offline', offline)
      window.removeEventListener('online', flush)
      window.removeEventListener('beforeinstallprompt', beforeInstall)
    }
  }, [queryClient, userId])
  if (online && pending === 0 && !installPrompt) return null
  const install = async () => {
    if (!installPrompt) return
    await installPrompt.prompt()
    await installPrompt.userChoice
    setInstallPrompt(null)
  }
  return <aside className={`client-runtime-status ${online ? '' : 'offline'}`} aria-live="polite">
    {!online ? <><WifiOff size={15} /><span>离线模式</span></> : pending > 0 ? <><Cloud size={15} /><span>{conflicts ? `${conflicts} 篇存在版本冲突` : `${pending} 篇等待同步`}</span></> : null}
    {installPrompt && <button onClick={install}><DownloadCloud size={14} />安装应用</button>}
  </aside>
}

function sendPendingUpdate(update: PendingPageUpdate): Promise<Page> {
  return post<Page>('/api/v1/pages/update', {
    pageId: update.pageId,
    expectedRevision: update.expectedRevision,
    title: update.title,
    content: update.content,
    revisionKind: 'AUTO',
  })
}

function GlobalRail({ currentUser, onSearch }: { currentUser: CurrentUser; onSearch: () => void }) {
  const [accountOpen, setAccountOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const notifications = useQuery({
    queryKey: ['notifications', 'unread-preview'],
    queryFn: () => post<import('../types').Notification[]>('/api/v1/notifications/list', { unreadOnly: true, limit: 20 }),
    refetchInterval: 30_000,
  })
  const unread = notifications.data?.length ?? 0
  const logout = useMutation({
    mutationFn: () => post<void>('/api/v1/auth/logout', {}),
    onSuccess: () => { resetCsrf(); queryClient.clear(); navigate('/login', { replace: true }) },
  })
  return (
    <nav className="global-rail" aria-label="全局导航">
      <Link className="rail-logo" to="/app" aria-label="知序"><span className="brand-mark">序</span></Link>
      <div className="rail-actions">
        <Link className="rail-button active" to="/app" title="工作台"><Home size={20} /></Link>
        <button className="rail-button" onClick={onSearch} title="全局搜索"><Search size={20} /></button>
        <Link className="rail-button notification-rail" to="/app/notifications" title="消息"><Bell size={20} />{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</Link>
      </div>
      <div className="rail-bottom">
        {currentUser.instanceAdmin && <Link className="rail-button" to="/app/admin" title="管理后台"><Settings size={19} /></Link>}
        <div className="account-menu-wrap"><button className="avatar" title={currentUser.email} onClick={() => setAccountOpen((open) => !open)}>{(currentUser.displayName || currentUser.email).slice(0, 1).toUpperCase()}</button>{accountOpen && <><button className="account-menu-scrim" aria-label="关闭账号菜单" onClick={() => setAccountOpen(false)} /><aside className="account-menu"><header><span>{(currentUser.displayName || currentUser.email).slice(0, 1).toUpperCase()}</span><div><strong>{currentUser.displayName || currentUser.email}</strong><small>{currentUser.email} · {currentUser.instanceAdmin ? '实例管理员' : '成员账号'}</small></div></header><Link to="/app/account" onClick={() => setAccountOpen(false)}><Settings />账号设置</Link><Link to="/app/profile" onClick={() => setAccountOpen(false)}><UserRound />个人主页</Link><Link to="/app/open-platform" onClick={() => setAccountOpen(false)}><Code2 />开放平台</Link>{currentUser.instanceAdmin && <Link to="/app/admin" onClick={() => setAccountOpen(false)}><Settings />管理后台</Link>}<button className="danger" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut />{logout.isPending ? '正在退出…' : '退出登录'}</button>{logout.error && <p>{messageOf(logout.error)}</p>}</aside></>}</div>
      </div>
    </nav>
  )
}

function PageRouteRedirect() {
  const { pageId = '' } = useParams()
  const location = useLocation()
  const page = useQuery({ queryKey: ['page', pageId], queryFn: () => post<Page>('/api/v1/pages/get', { pageId }), enabled: Boolean(pageId), retry: false })
  if (page.isPending) return <div className="editor-loading"><span className="loading-pulse" /></div>
  if (!page.data) return <div className="content-page"><EmptyState icon={<FileText />} title="无法打开文稿" description={messageOf(page.error)} action={<Link className="button secondary" to="/app">返回工作台</Link>} /></div>
  return <Navigate to={`/app/kb/${page.data.knowledgeBaseId}/pages/${page.data.id}${location.search}`} replace />
}

function AppSidebar({ currentUser, workspaces, mobileOpen, collapsed, onCollapsedChange, onClose, onSearch }: { currentUser: CurrentUser; workspaces: Workspace[]; mobileOpen: boolean; collapsed: boolean; onCollapsedChange: (collapsed: boolean) => void; onClose: () => void; onSearch: () => void }) {
  const [createWorkspaceOpen, setCreateWorkspaceOpen] = useState(false)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const logout = useMutation({ mutationFn: () => post<void>('/api/v1/auth/logout', {}), onSuccess: () => { resetCsrf(); queryClient.clear(); navigate('/login', { replace: true }) } })
  return (
    <><aside className={`app-sidebar ${mobileOpen ? 'mobile-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-head">
        <Link className="brand compact desktop-brand" to="/app"><span>知序</span></Link>
        <button className="icon-button sidebar-collapse-button" onClick={() => onCollapsedChange(!collapsed)} aria-label={collapsed ? '展开侧边栏' : '折叠侧边栏'} title={collapsed ? '展开侧边栏' : '折叠侧边栏'}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        <button className="icon-button mobile-only" onClick={onClose} aria-label="关闭导航"><X size={18} /></button>
      </div>
      <button className="search-trigger" title="搜索全部内容" onClick={() => { onSearch(); onClose() }}><Search size={16} /><span>搜索全部内容</span><kbd>⌘ K</kbd></button>
      <nav className="sidebar-nav">
        <Link to="/app" title="工作台" onClick={onClose}><LayoutGrid size={17} /><span>工作台</span></Link>
        <Link to="/app?filter=VIEWED" title="最近浏览" onClick={onClose}><FileText size={17} /><span>最近浏览</span></Link>
        <Link to="/app?filter=FAVORITE" title="收藏" onClick={onClose}><Sparkles size={17} /><span>收藏</span></Link>
        <Link to="/app/notes" title="小记" onClick={onClose}><StickyNote size={17} /><span>小记</span></Link>
        <Link to="/app/notifications" title="消息" onClick={onClose}><Bell size={17} /><span>消息</span></Link>
        <Link to="/app/trash" title="回收站" onClick={onClose}><Trash2 size={17} /><span>回收站</span></Link>
        <Link to="/app/feed" title="关注动态" onClick={onClose}><Compass size={17} /><span>关注动态</span></Link>
        <Link to="/app/profile" title="个人主页" onClick={onClose}><UserRound size={17} /><span>个人主页</span></Link>
        <Link to="/app/account" title="账号设置" onClick={onClose}><Settings size={17} /><span>账号设置</span></Link>
        <Link to="/app/open-platform" title="开放平台" onClick={onClose}><Code2 size={17} /><span>开放平台</span></Link>
        <Link to="/app/templates" title="模板中心" onClick={onClose}><LayoutTemplate size={17} /><span>模板中心</span></Link>
        <Link to="/app/transfers" title="导入与导出" onClick={onClose}><ArrowUpDown size={17} /><span>导入与导出</span></Link>
      </nav>
      <div className="sidebar-section">
        <div className="section-label"><span>空间</span><button aria-label="新建空间" onClick={() => setCreateWorkspaceOpen(true)}><Plus size={15} /></button></div>
        {workspaces.map((workspace) => (
          <Link className="workspace-link" title={workspace.name} to={`/app/w/${workspace.id}`} key={workspace.id} onClick={onClose}>
            <span className="workspace-glyph">{workspace.workspaceType === 'PERSONAL' ? '我' : workspace.name.slice(0, 1)}</span>
            <span>{workspace.name}</span>
          </Link>
        ))}
      </div>
      <div className="sidebar-mobile-account"><span className="avatar">{currentUser.email.slice(0, 1).toUpperCase()}</span><div><strong>{currentUser.email}</strong><small>{currentUser.instanceAdmin ? '实例管理员' : '成员账号'}</small></div><button className="icon-button" disabled={logout.isPending} onClick={() => logout.mutate()} title="退出登录" aria-label="退出登录"><LogOut /></button></div>
      <div className="sidebar-footer"><span className="status-dot" />服务运行正常</div>
    </aside>
    {createWorkspaceOpen && <CreateWorkspaceDialog onClose={() => setCreateWorkspaceOpen(false)} />}
    </>
  )
}

function CreateWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const create = useMutation({
    mutationFn: () => post<Workspace>('/api/v1/workspaces/create', { name }),
    onSuccess: async (workspace) => { await queryClient.invalidateQueries({ queryKey: ['workspaces'] }); onClose(); navigate(`/app/w/${workspace.id}`) },
  })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={(event) => { event.preventDefault(); create.mutate() }}><div className="dialog-head"><div><p className="eyebrow">新建</p><h2>组织空间</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭新建组织空间"><X /></button></div><label className="field"><span className="field-label">空间名称</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：远山工作室" required /></label><p className="form-note">你将成为空间 Owner，可继续邀请成员并创建团队。</p>{create.error && <div className="form-error">{messageOf(create.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim() || create.isPending}>创建空间</button></div></form></div>
}

function WorkspaceHome() {
  const { workspaceId = '' } = useParams()
  const [tab, setTab] = useState<'knowledge' | 'teams'>('knowledge')
  const [createOpen, setCreateOpen] = useState(false)
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => request<Workspace[]>('/api/v1/workspaces') })
  const workspace = workspaces.data?.find((item) => item.id === workspaceId)
  const organization = workspace?.workspaceType === 'ORGANIZATION'
  const teams = useQuery({ queryKey: ['teams', workspaceId], queryFn: () => post<Team[]>('/api/v1/teams/list', { workspaceId }), enabled: Boolean(workspaceId) && organization === true })
  const knowledgeBases = useQuery({ queryKey: ['knowledge-bases', workspaceId], queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }), enabled: Boolean(workspaceId) })
  useEffect(() => { if (workspace && !organization && tab === 'teams') setTab('knowledge') }, [organization, tab, workspace])
  return (
    <div className="content-page">
      <PageHeader eyebrow={organization ? '组织空间' : '个人空间'} title={workspace?.name ?? '空间'} description={organization ? '组织团队、知识库和成员协作。' : '沉淀只属于你的知识库与文稿。'} actions={<><button className="button primary small" onClick={() => setCreateOpen(true)}><Plus size={16} />新建知识库</button>{workspace && ['OWNER', 'ADMIN'].includes(workspace.membershipRole) && <Link className="button secondary small" to={`/app/w/${workspaceId}/settings`}><Settings size={16} />空间设置</Link>}</>} />
      <div className="tabs"><button className={tab === 'knowledge' ? 'active' : ''} onClick={() => setTab('knowledge')}>知识库</button>{organization && <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>团队</button>}</div>
      {tab === 'knowledge' ? (
        <div className="resource-grid">
          {(knowledgeBases.data ?? []).map((knowledgeBase) => <KnowledgeBaseCard key={knowledgeBase.id} value={knowledgeBase} />)}
          {!knowledgeBases.isPending && !knowledgeBases.data?.length && <EmptyState icon={<BookOpen />} title="创建第一个知识库" description="将相关文稿组织在清晰的目录中。" action={<button className="button secondary" onClick={() => setCreateOpen(true)}>新建知识库</button>} />}
        </div>
      ) : (
        <div className="resource-grid">
          {(teams.data ?? []).map((team) => <Link className="resource-card" key={team.id} to={`/app/w/${workspaceId}/teams/${team.id}`}><span className="resource-icon team">{team.avatar || <Users />}</span><div><h3>{team.name}</h3><p>{team.description || '团队知识与成员协作空间'}</p><small>{team.visibility === 'PRIVATE' ? '仅团队成员' : '空间内可见'}</small></div><ChevronRight size={18} /></Link>)}
          {!teams.isPending && !teams.data?.length && <EmptyState icon={<Users />} title="还没有团队" description="团队可共同管理多个知识库。" />}
        </div>
      )}
      {createOpen && <CreateKnowledgeBaseDialog workspaceId={workspaceId} teams={teams.data ?? []} onClose={() => setCreateOpen(false)} />}
    </div>
  )
}

function KnowledgeBaseCard({ value }: { value: KnowledgeBase }) {
  return (
    <Link className="resource-card" to={`/app/kb/${value.id}`}>
      <span className="resource-icon">{value.icon || <BookOpen />}</span>
      <div><h3>{value.name}</h3><p>{value.description || '一个安静生长的知识库'}</p><small>{value.visibility.toLowerCase()} · {value.ownerType.toLowerCase()}</small></div>
      <ChevronRight size={18} />
    </Link>
  )
}

function CreateKnowledgeBaseDialog({ workspaceId, teams, onClose }: { workspaceId: string; teams: Team[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [teamId, setTeamId] = useState(teams[0]?.id ?? '')
  const mutation = useMutation({
    mutationFn: () => post<KnowledgeBase>('/api/v1/knowledge-bases/create', {
      workspaceId, name, slug, ownerType: teamId ? 'TEAM' : 'WORKSPACE', ownerId: teamId || workspaceId,
      visibility: 'PRIVATE', publishMode: 'MANUAL',
    }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['knowledge-bases', workspaceId] }); onClose() },
  })
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="create-kb-title">
        <div className="dialog-head"><div><p className="eyebrow">新建</p><h2 id="create-kb-title">知识库</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭新建知识库"><X size={18} /></button></div>
        <label className="field"><span className="field-label">名称</span><input autoFocus value={name} onChange={(e) => { setName(e.target.value); if (!slug) setSlug(toSlug(e.target.value)) }} placeholder="产品手册" /></label>
        <label className="field"><span className="field-label">路径</span><input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="product-handbook" /></label>
        {teams.length > 0 && <label className="field"><span className="field-label">归属</span><select value={teamId} onChange={(e) => setTeamId(e.target.value)}><option value="">当前空间</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>}
        {mutation.error && <div className="form-error">{messageOf(mutation.error)}</div>}
        <div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" onClick={() => mutation.mutate()} disabled={!name || !slug || mutation.isPending}>创建知识库</button></div>
      </div>
    </div>
  )
}

function KnowledgeBaseHome() {
  const { knowledgeBaseId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false)
  const [transferOpen, setTransferOpen] = useState<'IMPORT' | 'EXPORT' | null>(null)
  const [createPageOpen, setCreatePageOpen] = useState(false)
  const [catalogManagerOpen, setCatalogManagerOpen] = useState(false)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [knowledgeView, setKnowledgeView] = useState<'CATALOG' | 'ALL'>('CATALOG')
  const [pageSearch, setPageSearch] = useState('')
  const knowledgeBase = useQuery({ queryKey: ['knowledge-base', knowledgeBaseId], queryFn: () => post<KnowledgeBase>('/api/v1/knowledge-bases/get', { knowledgeBaseId }) })
  const pages = useQuery({ queryKey: ['pages', knowledgeBaseId], queryFn: () => post<Page[]>('/api/v1/pages/list', { knowledgeBaseId }) })
  const catalog = useQuery({ queryKey: ['catalog', knowledgeBaseId], queryFn: () => post<CatalogTree>('/api/v1/catalog/list', { knowledgeBaseId }) })
  const appearance = useMemo(() => parseKnowledgeBaseAppearance(knowledgeBase.data?.appearanceConfig), [knowledgeBase.data?.appearanceConfig])
  const knowledgeBaseIcon = safePresentationUrl(knowledgeBase.data?.icon)
  const catalogDisplay = useMemo(() => parseKnowledgeBaseCatalogDisplay(knowledgeBase.data?.catalogConfig), [knowledgeBase.data?.catalogConfig])
  const visiblePages = useMemo(() => (pages.data ?? []).filter((page) => !pageSearch.trim() || `${page.title} ${page.path}`.toLowerCase().includes(pageSearch.trim().toLowerCase())).sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()), [pages.data, pageSearch])
  const listedPageIds = useMemo(() => new Set((catalog.data?.nodes ?? []).flatMap((node) => node.pageId ? [node.pageId] : [])), [catalog.data?.nodes])
  const createPage = useMutation({
    mutationFn: (contentType: Page['contentType']) => post<Page>('/api/v1/pages/create', { knowledgeBaseId, title: ({ DOCUMENT: '无标题文稿', WHITEBOARD: '无标题画板', SPREADSHEET: '无标题电子表格', DATABASE: '无标题数据表' })[contentType], path: `untitled-${contentType.toLowerCase()}-${Date.now()}`, contentType }),
    onSuccess: async (page) => { setCreatePageOpen(false); await queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }); navigate(`/app/kb/${knowledgeBaseId}/pages/${page.id}`) },
  })
  return (
    <div className={`kb-layout kb-theme-${appearance.theme.toLowerCase()} kb-width-${appearance.contentWidth.toLowerCase()}`} style={{ '--kb-accent': appearance.accentColor, '--kb-background': appearance.backgroundColor } as React.CSSProperties}>
      <aside className="catalog-panel">
        <div className="catalog-head"><Link to="/app" className="back-link">工作台</Link><span className="catalog-head-actions"><button className="icon-button" onClick={() => setAnalyticsOpen(true)} title="知识库统计" aria-label="知识库统计"><BarChart3 size={17} /></button><Link className="icon-button" to={`/app/kb/${knowledgeBaseId}/settings`} title="知识库设置" aria-label="知识库设置"><Settings size={17} /></Link><button className="icon-button" onClick={() => setTransferOpen('IMPORT')} title="导入与导出" aria-label="知识库导入与导出"><ArrowUpDown size={17} /></button><button className="icon-button" onClick={() => setTemplateSaveOpen(true)} title="保存为模板" aria-label="将知识库保存为模板"><LayoutTemplate size={17} /></button></span></div>
        <button className="new-page-button" onClick={() => setCreatePageOpen(true)}><Plus size={16} />新建内容</button>
        <div className="kb-content-switch"><button className={knowledgeView === 'CATALOG' ? 'active' : ''} onClick={() => setKnowledgeView('CATALOG')}>目录</button><button className={knowledgeView === 'ALL' ? 'active' : ''} onClick={() => setKnowledgeView('ALL')}>全部文稿 <small>{pages.data?.length ?? 0}</small></button>{knowledgeView === 'CATALOG' && <button className="kb-catalog-manage" onClick={() => setCatalogManagerOpen(true)} title="编排目录" aria-label="编排目录"><Plus size={14} /></button>}</div>
        {knowledgeView === 'CATALOG' ? <CatalogList tree={catalog.data} pages={pages.data ?? []} knowledgeBaseId={knowledgeBaseId} display={catalogDisplay} onManage={() => setCatalogManagerOpen(true)} /> : <div className="kb-all-pages"><label><Search /><input value={pageSearch} onChange={(event) => setPageSearch(event.target.value)} placeholder="搜索文稿" /></label><nav>{visiblePages.map((page) => <Link key={page.id} to={`/app/kb/${knowledgeBaseId}/pages/${page.id}`}><span><FileText /></span><div><strong>{page.title}</strong><small>{contentTypeName(page.contentType)} · {listedPageIds.has(page.id) ? '已入目录' : '未入目录'}</small></div></Link>)}{!pages.isPending && !visiblePages.length && <p>没有匹配的文稿</p>}</nav></div>}
      </aside>
      {knowledgeView === 'CATALOG' ? <section className="kb-welcome" style={{ backgroundColor: appearance.backgroundColor, backgroundImage: appearance.coverUrl ? `linear-gradient(rgba(19,25,21,.48),rgba(19,25,21,.48)),url("${appearance.coverUrl}")` : undefined }}>
        <div className="kb-hero-icon">{knowledgeBaseIcon ? <img src={knowledgeBaseIcon} alt="" referrerPolicy="no-referrer" /> : knowledgeBase.data?.icon || <BookOpen size={28} />}</div>
        <p className="eyebrow">知识库</p>
        <h1>{knowledgeBase.data?.name || '正在加载知识库'}</h1>
        <p>{knowledgeBase.data?.description || '目录会随着团队的认知一起生长。你可以先写，再慢慢整理。'}</p>
        <div className="kb-hero-actions"><button className="button primary" onClick={() => setCreatePageOpen(true)}><Plus size={17} />新建内容</button><button className="button secondary" onClick={() => setTransferOpen('IMPORT')}><ArrowUpDown size={17} />导入与导出</button><button className="button quiet" onClick={() => setAnalyticsOpen(true)}><BarChart3 size={17} />知识库统计</button></div>
      </section> : <section className="kb-page-index"><header><div><p className="eyebrow">{knowledgeBase.data?.name || '知识库内容'}</p><h1>全部文稿</h1><p>包含已入目录和尚未编排的内容，按最近更新排列。</p></div><button className="button primary small" onClick={() => setCreatePageOpen(true)}><Plus />新建内容</button></header><div className="kb-page-index-grid">{visiblePages.map((page) => <Link key={page.id} to={`/app/kb/${knowledgeBaseId}/pages/${page.id}`}><span className={`kb-page-type ${page.contentType.toLowerCase()}`}><FileText /></span><div><h2>{page.title}</h2><p>/{page.path}</p><footer><span>{contentTypeName(page.contentType)}</span><span>{listedPageIds.has(page.id) ? '目录内' : '未入目录'}</span><time>{relativeDocumentTime(page.updatedAt)}</time></footer></div></Link>)}{!pages.isPending && !visiblePages.length && <div className="kb-page-index-empty"><FileText /><h2>没有找到文稿</h2><p>试试更换搜索词，或创建第一篇内容。</p></div>}</div></section>}
      {templateSaveOpen && <SaveTemplateDialog sourceType="KNOWLEDGE_BASE" sourceId={knowledgeBaseId} onClose={() => setTemplateSaveOpen(false)} />}
      {transferOpen && <KnowledgeBaseTransferDialog knowledgeBaseId={knowledgeBaseId} initialTab={transferOpen} onClose={() => setTransferOpen(null)} />}
      {createPageOpen && <CreatePageTypeDialog pending={createPage.isPending} error={createPage.error} onClose={() => setCreatePageOpen(false)} onCreate={(type) => createPage.mutate(type)} />}
      {catalogManagerOpen && <CatalogManager knowledgeBaseId={knowledgeBaseId} pages={pages.data ?? []} onClose={() => setCatalogManagerOpen(false)} />}
      {analyticsOpen && <AnalyticsPanel knowledgeBaseId={knowledgeBaseId} onClose={() => setAnalyticsOpen(false)} />}
    </div>
  )
}

type CatalogInlineAction = { kind: 'RENAME' | 'DOCUMENT' | 'GROUP' | 'LINK' | 'COPY'; node: CatalogNode; page?: Page }

export function CatalogList({ tree, pages, knowledgeBaseId, display, onManage }: { tree?: CatalogTree; pages: Page[]; knowledgeBaseId: string; display: ReturnType<typeof parseKnowledgeBaseCatalogDisplay>; onManage: () => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirmation = useConfirmDialog()
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [action, setAction] = useState<CatalogInlineAction | null>(null)
  const [exporting, setExporting] = useState<Page | null>(null)
  const [actionWarning, setActionWarning] = useState('')
  const [focusedNodeId, setFocusedNodeId] = useState('')
  const nodes = tree?.nodes ?? []
  const byParent = useMemo(() => {
    const map = new Map<string | null, CatalogNode[]>()
    for (const node of nodes) map.set(node.parentId, [...(map.get(node.parentId) ?? []), node])
    return map
  }, [nodes])
  useEffect(() => {
    const next = new Set<string>()
    const visit = (parentId: string | null, depth: number) => { for (const node of byParent.get(parentId) ?? []) { if (node.nodeType === 'GROUP' && depth < display.defaultExpandDepth) next.add(node.id); visit(node.id, depth + 1) } }
    visit(null, 0)
    setExpanded(next)
  }, [byParent, display.defaultExpandDepth])
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const firstTreeItemId = (byParent.get(null) ?? []).find((node) => node.nodeType !== 'DOCUMENT' || Boolean(node.pageId && pageById.has(node.pageId)))?.id ?? ''
  const focusTreeItem = (item: HTMLElement | undefined) => {
    if (!item) return
    setFocusedNodeId(item.dataset.treeNodeId ?? '')
    window.requestAnimationFrame(() => item.focus())
  }
  const onTreeKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return
    const current = (event.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]')
    if (!current || event.target !== current || !event.currentTarget.contains(current)) return
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="treeitem"]'))
    const index = items.indexOf(current)
    const node = nodes.find((value) => value.id === current.dataset.treeNodeId)
    if (index < 0 || !node) return
    event.preventDefault()
    if (event.key === 'Home') focusTreeItem(items[0])
    else if (event.key === 'End') focusTreeItem(items.at(-1))
    else if (event.key === 'ArrowDown') focusTreeItem(items[index + 1] ?? items[index])
    else if (event.key === 'ArrowUp') focusTreeItem(items[index - 1] ?? items[index])
    else if (event.key === 'Enter' || event.key === ' ') {
      if (node.nodeType === 'GROUP') setExpanded((currentExpanded) => { const next = new Set(currentExpanded); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })
      else if (node.nodeType === 'DOCUMENT' && node.pageId && pageById.has(node.pageId)) navigate(`/app/kb/${knowledgeBaseId}/pages/${node.pageId}`)
      else if (node.nodeType === 'LINK') {
        const externalUrl = safeExternalNavigationUrl(node.url)
        if (externalUrl) window.open(externalUrl, '_blank', 'noopener,noreferrer')
      }
    }
    else if (event.key === 'ArrowRight' && node.nodeType === 'GROUP') {
      if (!expanded.has(node.id)) setExpanded((currentExpanded) => new Set(currentExpanded).add(node.id))
      else {
        const child = items[index + 1]
        if (child?.dataset.treeParentId === node.id) focusTreeItem(child)
      }
    } else if (event.key === 'ArrowLeft') {
      if (node.nodeType === 'GROUP' && expanded.has(node.id)) setExpanded((currentExpanded) => { const next = new Set(currentExpanded); next.delete(node.id); return next })
      else if (node.parentId) focusTreeItem(items.find((item) => item.dataset.treeNodeId === node.parentId))
    }
  }
  const apply = async (value: CatalogTree) => {
    queryClient.setQueryData(['catalog', knowledgeBaseId], value)
    await queryClient.invalidateQueries({ queryKey: ['catalog-history', knowledgeBaseId] })
  }
  const remove = useMutation({ mutationFn: (node: CatalogNode) => post<CatalogTree>('/api/v1/catalog/remove', { nodeId: node.id, expectedRevision: tree?.revision ?? 0 }), onSuccess: apply })
  const trash = useMutation({ mutationFn: (page: Page) => post<void>('/api/v1/pages/trash', { pageId: page.id }), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }), queryClient.invalidateQueries({ queryKey: ['global-trash'] }), queryClient.invalidateQueries({ queryKey: ['workbench'] })]) } })
  const error = remove.error ?? trash.error
  const openAction = (event: React.MouseEvent<HTMLButtonElement>, value: CatalogInlineAction) => { event.currentTarget.closest('details')?.removeAttribute('open'); setAction(value) }
  const render = (parentId: string | null, depth: number) => (byParent.get(parentId) ?? []).map((node) => {
    const page = node.pageId ? pageById.get(node.pageId) : undefined
    if (node.nodeType === 'DOCUMENT' && !page) return null
    const label = node.titleOverride || page?.title || '未命名'
    const externalUrl = node.nodeType === 'LINK' ? safeExternalNavigationUrl(node.url) : null
    const treeItemProps = {
      role: 'treeitem' as const,
      'aria-level': depth + 1,
      'aria-label': label,
      ...(node.nodeType === 'GROUP' ? { 'aria-expanded': expanded.has(node.id) } : {}),
      'data-tree-node-id': node.id,
      'data-tree-parent-id': node.parentId ?? '',
      tabIndex: focusedNodeId === node.id || (!focusedNodeId && node.id === firstTreeItemId) ? 0 : -1,
      onFocus: () => setFocusedNodeId(node.id),
    }
    const row = node.nodeType === 'DOCUMENT' && page ? (
      <Link tabIndex={-1} className="catalog-row" style={{ paddingLeft: 12 + depth * 16 }} to={`/app/kb/${knowledgeBaseId}/pages/${page.id}`}><FileText size={15} /><span>{label}{(display.showPath || display.showUpdatedAt) && <small>{[display.showPath ? `/${page.path}` : '', display.showUpdatedAt ? relativeDocumentTime(page.updatedAt) : ''].filter(Boolean).join(' · ')}</small>}</span><i className={`catalog-publication-dot ${catalogPublicationStatus(page).toLowerCase()}`} title={catalogPublicationLabel(page)} aria-label={catalogPublicationLabel(page)} /></Link>
    ) : node.nodeType === 'LINK' && externalUrl ? (
      <a tabIndex={-1} className="catalog-row" style={{ paddingLeft: 12 + depth * 16 }} href={externalUrl} target="_blank" rel="noopener noreferrer"><FileText size={15} /><span>{label}</span></a>
    ) : node.nodeType === 'GROUP' ? (
      <button tabIndex={-1} className="catalog-row catalog-group-row" style={{ paddingLeft: 12 + depth * 16 }} onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next })}><ChevronDown className={expanded.has(node.id) ? '' : 'collapsed'} size={13} /><Folder size={15} /><span>{label}</span></button>
    ) : (
      <div className="catalog-row" style={{ paddingLeft: 12 + depth * 16 }}><FileText size={15} /><span>{label}</span></div>
    )
    return <div key={node.id} className="catalog-node" {...treeItemProps}>
      <div className="catalog-row-shell" role="none">{row}<details className="catalog-inline-menu"><summary aria-label={`${label} 更多操作`} title="更多操作"><MoreHorizontal /></summary><div>
        {node.nodeType === 'GROUP' && <>
          <button aria-label={`${label} 新建下级文稿`} onClick={(event) => openAction(event, { kind: 'DOCUMENT', node })}><FileText />新建下级文稿</button>
          <button aria-label={`${label} 新建下级分组`} onClick={(event) => openAction(event, { kind: 'GROUP', node })}><FolderPlus />新建下级分组</button>
          <button aria-label={`${label} 新建下级链接`} onClick={(event) => openAction(event, { kind: 'LINK', node })}><Link2 />新建下级链接</button>
        </>}
        <button aria-label={`${label} 重命名展示项`} onClick={(event) => openAction(event, { kind: 'RENAME', node, page })}><Pencil />重命名展示项</button>
        {page && <button aria-label={`${label} 复制文稿`} onClick={(event) => openAction(event, { kind: 'COPY', node, page })}><Copy />复制文稿</button>}
        <button aria-label={`${label} 移动与编排`} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); onManage() }}><ArrowUpDown />移动与编排</button>
        {page && <button aria-label={`${label} 分享`} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); navigate(`/app/kb/${knowledgeBaseId}/pages/${page.id}?manage=SHARE`) }}><Share2 />分享</button>}
        {page && <button aria-label={`${label} 导出`} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); setExporting(page) }}><Download />导出</button>}
        <button aria-label={`${label} 从目录移除`} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); confirmation.confirm({ title: `从目录移除“${label}”`, description: page ? '文稿仍会保留在全部文稿中。' : '下级目录项会一并移出，但其中的文稿不会删除。', confirmLabel: '从目录移除' }, () => remove.mutate(node)) }}><Unlink />从目录移除</button>
        {page && <button className="danger" aria-label={`${label} 删除文稿`} onClick={(event) => { event.currentTarget.closest('details')?.removeAttribute('open'); confirmation.confirm({ title: `删除文稿“${page.title}”`, description: '文稿会进入回收站，恢复后仍回到当前目录位置。', confirmLabel: '删除文稿' }, () => trash.mutate(page)) }}><Trash2 />删除文稿</button>}
      </div></details></div>
      {(node.nodeType !== 'GROUP' || expanded.has(node.id)) && <div role="group">{render(node.id, depth + 1)}</div>}
    </div>
  })
  if (!nodes.length) return <p className="catalog-empty">暂无目录，文稿仍可在“全部文稿”中找到。</p>
  return <><nav className="catalog-tree" role="tree" aria-label="知识库目录" onKeyDown={onTreeKeyDown}>{render(null, 0)}</nav>{error && <div className="catalog-inline-error" role="alert">{messageOf(error)}</div>}{actionWarning && <div className="catalog-inline-warning" role="status"><span>{actionWarning}</span><button type="button" aria-label="关闭目录操作提示" onClick={() => setActionWarning('')}><X /></button></div>}{action && <CatalogInlineActionDialog action={action} knowledgeBaseId={knowledgeBaseId} revision={tree?.revision ?? 0} onClose={() => setAction(null)} onApplied={async (value, page, warning) => { if (value) await apply(value); await queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }); setAction(null); setActionWarning(warning ?? ''); if (page) navigate(`/app/kb/${knowledgeBaseId}/pages/${page.id}`) }} />}{exporting && <PageExportDialog pageId={exporting.id} contentType={exporting.contentType} canUsePublished={Boolean(exporting.publishedRevisionId)} onClose={() => setExporting(null)} />}{confirmation.dialog}</>
}

function CatalogInlineActionDialog({ action, knowledgeBaseId, revision, onClose, onApplied }: { action: CatalogInlineAction; knowledgeBaseId: string; revision: number; onClose: () => void; onApplied: (tree: CatalogTree | null, page: Page | null, warning?: string) => Promise<void> }) {
  const sourceTitle = action.node.titleOverride || action.page?.title || (action.node.nodeType === 'GROUP' ? '未命名分组' : '未命名链接')
  const [title, setTitle] = useState(action.kind === 'COPY' ? `${sourceTitle}（副本）` : action.kind === 'RENAME' ? sourceTitle : '')
  const [path, setPath] = useState(action.kind === 'COPY' && action.page ? `${action.page.path}-copy` : `untitled-${Date.now()}`)
  const [url, setUrl] = useState(action.node.url ?? 'https://')
  const secureLinkUrl = safeExternalNavigationUrl(url)
  const mutation = useMutation({
    mutationFn: async () => {
      if (action.kind === 'RENAME') return { tree: await post<CatalogTree>('/api/v1/catalog/rename', { nodeId: action.node.id, title: title.trim(), expectedRevision: revision }), page: null as Page | null }
      if (action.kind === 'GROUP' || action.kind === 'LINK') return { tree: await post<CatalogTree>('/api/v1/catalog/create', { knowledgeBaseId, nodeType: action.kind, pageId: null, parentId: action.node.id, beforeNodeId: null, afterNodeId: null, titleOverride: title.trim(), url: action.kind === 'LINK' ? secureLinkUrl : null, metadata: {}, expectedRevision: revision }), page: null as Page | null }
      if (action.kind === 'DOCUMENT') {
        const page = await post<Page>('/api/v1/pages/create', { knowledgeBaseId, title: title.trim(), path: path.trim(), contentType: 'DOCUMENT' })
        try { return { tree: await post<CatalogTree>('/api/v1/catalog/create', { knowledgeBaseId, nodeType: 'DOCUMENT', pageId: page.id, parentId: action.node.id, beforeNodeId: null, afterNodeId: null, titleOverride: null, url: null, metadata: {}, expectedRevision: revision }), page } }
        catch { return { tree: null, page, warning: '文稿已创建，但目录在此期间发生变化。文稿保留在“全部文稿”中，可稍后重新加入目录。' } }
      }
      const page = await post<Page>('/api/v1/pages/copy', { pageId: action.page!.id, targetKnowledgeBaseId: knowledgeBaseId, title: title.trim(), path: path.trim() })
      try { return { tree: await post<CatalogTree>('/api/v1/catalog/create', { knowledgeBaseId, nodeType: 'DOCUMENT', pageId: page.id, parentId: action.node.parentId, beforeNodeId: null, afterNodeId: action.node.id, titleOverride: null, url: null, metadata: {}, expectedRevision: revision }), page } }
      catch { return { tree: null, page, warning: '副本已创建，但目录位置发生冲突。副本保留在“全部文稿”中。' } }
    },
    onSuccess: (value) => onApplied(value.tree, value.page, value.warning),
  })
  const needsPath = action.kind === 'DOCUMENT' || action.kind === 'COPY'
  const submitLabel = ({ RENAME: '保存名称', DOCUMENT: '创建文稿', GROUP: '创建分组', LINK: '创建链接', COPY: '创建副本' } as const)[action.kind]
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog catalog-inline-dialog" role="dialog" aria-modal="true" aria-label={`${submitLabel} ${sourceTitle}`} onSubmit={(event) => { event.preventDefault(); mutation.mutate() }}><div className="dialog-head"><div><p className="eyebrow">目录快捷操作</p><h2>{submitLabel}</h2><p>{action.kind === 'RENAME' ? '只修改目录展示名，不会改写文稿标题。' : action.kind === 'COPY' ? '复制当前草稿和标签，不复制分享、权限与发布对象。' : '保存后目录会立即更新，与文稿发布互不影响。'}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label={`关闭${submitLabel}`}><X /></button></div><label className="field"><span className="field-label">{action.kind === 'LINK' ? '链接名称' : '名称'}</span><input autoFocus value={title} maxLength={240} onChange={(event) => setTitle(event.target.value)} /></label>{needsPath && <label className="field"><span className="field-label">访问路径</span><input value={path} onChange={(event) => setPath(event.target.value)} /></label>}{action.kind === 'LINK' && <label className="field"><span className="field-label">链接地址</span><input value={url} type="url" onChange={(event) => setUrl(event.target.value)} />{url && !secureLinkUrl && <span className="form-error" role="alert">请输入不含账号凭据的 HTTPS 地址</span>}</label>}{mutation.error && <div className="form-error">{messageOf(mutation.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || (needsPath && !path.trim()) || (action.kind === 'LINK' && !secureLinkUrl) || mutation.isPending}>{mutation.isPending ? '处理中…' : submitLabel}</button></div></form></div>
}

function catalogPublicationStatus(page: Page) { if (!page.publishedRevisionId) return 'UNPUBLISHED'; return page.publishedAt && new Date(page.updatedAt) > new Date(page.publishedAt) ? 'CHANGED' : 'PUBLISHED' }
function catalogPublicationLabel(page: Page) { return ({ UNPUBLISHED: '未发布', PUBLISHED: '已发布', CHANGED: '草稿有更新' } as const)[catalogPublicationStatus(page)] }

export function catalogBreadcrumb(nodes: CatalogNode[], page: Page) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const document = nodes.find((node) => node.nodeType === 'DOCUMENT' && node.pageId === page.id)
  if (!document) return [page.title || '无标题']
  const ancestors: string[] = []
  const visited = new Set<string>([document.id])
  let parentId = document.parentId
  while (parentId) {
    if (visited.has(parentId)) break
    visited.add(parentId)
    const parent = byId.get(parentId)
    if (!parent) break
    ancestors.unshift(parent.titleOverride || (parent.nodeType === 'LINK' ? parent.url : null) || '未命名分组')
    parentId = parent.parentId
  }
  return [...ancestors, document.titleOverride || page.title || '无标题']
}

function contentTypeName(value: Page['contentType']) { return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[value] }
function relativeDocumentTime(value: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return '刚刚更新'; if (minutes < 60) return `${minutes} 分钟前`; if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`; return new Date(value).toLocaleDateString('zh-CN') }

export function PageViewTracker({ pageId }: { pageId: string }) {
  const queryClient = useQueryClient()
  useEffect(() => {
    if (!pageId) return
    void post<void>('/api/v1/activities/page-view', { pageId })
      .then(() => queryClient.invalidateQueries({ queryKey: ['workbench'] }))
      .catch(() => undefined)
  }, [pageId, queryClient])
  return null
}

function PageEditor({ currentUser }: { currentUser: CurrentUser }) {
  const { knowledgeBaseId = '', pageId = '' } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const pageQuery = useQuery({
    queryKey: ['page', pageId],
    queryFn: async () => {
      try {
        const loaded = await post<Page>('/api/v1/pages/get', { pageId })
        void cachePage(currentUser.userId, loaded).catch(() => undefined)
        return loaded
      } catch (reason) {
        if (!isNetworkFailure(reason)) throw reason
        const cached = await readCachedPage(currentUser.userId, pageId)
        if (!cached) throw reason
        return cached
      }
    },
  })
  const [titleDraft, setTitleDraft] = useState<{ id: string; title: string } | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [referencesOpen, setReferencesOpen] = useState(false)
  const [referenceInsertOpen, setReferenceInsertOpen] = useState(false)
  const [cardMenuOpen, setCardMenuOpen] = useState(false)
  const [editingCard, setEditingCard] = useState<ParsedContentCard | null>(null)
  const [analyticsOpen, setAnalyticsOpen] = useState(false)
  const [templateSaveOpen, setTemplateSaveOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [managementTab, setManagementTab] = useState<PageManagementTab | null>(null)
  const [pendingManagementTab, setPendingManagementTab] = useState<PageManagementTab | null>(null)
  const editorRef = useRef<BlockDocumentEditorHandle>(null)
  const page = pageQuery.data
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('manage')
    if (page && ['PROPERTIES', 'PERMISSIONS', 'ATTACHMENTS', 'HISTORY', 'PUBLISH', 'SHARE'].includes(requested ?? '')) setManagementTab(requested as PageManagementTab)
  }, [location.search, page?.id])
  const pagesQuery = useQuery({ queryKey: ['pages', knowledgeBaseId], queryFn: () => post<Page[]>('/api/v1/pages/list', { knowledgeBaseId }), enabled: Boolean(knowledgeBaseId) })
  const knowledgeBaseQuery = useQuery({ queryKey: ['knowledge-base', knowledgeBaseId], queryFn: () => post<KnowledgeBase>('/api/v1/knowledge-bases/get', { knowledgeBaseId }), enabled: Boolean(knowledgeBaseId) })
  const catalogQuery = useQuery({ queryKey: ['catalog', knowledgeBaseId], queryFn: () => post<CatalogTree>('/api/v1/catalog/list', { knowledgeBaseId }), enabled: Boolean(knowledgeBaseId) })
  const title = titleDraft?.id === pageId ? titleDraft.title : page?.title ?? ''
  const breadcrumbs = useMemo(() => page ? catalogBreadcrumb(catalogQuery.data?.nodes ?? [], { ...page, title }) : [], [catalogQuery.data?.nodes, page, title])
  const collaboration = usePageCollaboration({
    pageId,
    initialBody: page ? pageContentBody(page) : '',
    enabled: Boolean(page),
    userId: currentUser.userId,
    email: currentUser.email,
  })
  const save = useMutation({
    mutationFn: async (draft: { title: string; body: string }) => {
      if (!page) throw new Error('文稿尚未加载')
      const pending = toPendingPageUpdate(currentUser.userId, page, draft)
      if (!navigator.onLine) {
        const queued = await queuePageUpdate(pending)
        return { updated: optimisticPage(page, queued), queued: true }
      }
      try {
        return { updated: await sendPendingUpdate(pending), queued: false }
      } catch (reason) {
        if (isNetworkFailure(reason)) {
          const queued = await queuePageUpdate(pending)
          return { updated: optimisticPage(page, queued), queued: true }
        }
        if (reason instanceof ApiError && reason.problem.code === 'PAGE_REVISION_CONFLICT') {
          try {
            const refreshed = await post<Page>('/api/v1/pages/get', { pageId })
            if (pageDraftMatches(refreshed, draft)) return { updated: refreshed, queued: false }
          } catch (refreshReason) {
            if (isNetworkFailure(refreshReason)) {
              const queued = await queuePageUpdate(pending)
              return { updated: optimisticPage(page, queued), queued: true }
            }
          }
        }
        throw reason
      }
    },
    onSuccess: async ({ updated, queued }) => {
      setTitleDraft({ id: pageId, title: updated.title })
      queryClient.setQueryData(['page', pageId], updated)
      void cachePage(currentUser.userId, updated).catch(() => undefined)
      if (!queued) {
        await queryClient.invalidateQueries({ queryKey: ['page', pageId] })
        await queryClient.invalidateQueries({ queryKey: ['page-references'] })
        await queryClient.invalidateQueries({ queryKey: ['content-card'] })
      }
    },
    onError: (reason) => {
      if (reason instanceof ApiError && reason.problem.code === 'PAGE_REVISION_CONFLICT') void pageQuery.refetch()
    },
  })
  const openManagement = (tab: PageManagementTab) => {
    if (!page) return
    save.reset()
    setPendingManagementTab(tab)
  }
  useEffect(() => {
    if (!pendingManagementTab || !page || save.isPending) return
    if (save.isError) {
      setPendingManagementTab(null)
      return
    }
    if (title !== page.title || collaboration.body !== pageContentBody(page)) {
      save.mutate({ title, body: collaboration.body })
      return
    }
    setManagementTab(pendingManagementTab)
    setPendingManagementTab(null)
  }, [pendingManagementTab, page?.draftRevision, page?.plainText, page?.title, collaboration.body, title, save.isPending, save.isError])
  useEffect(() => {
    if (!page || collaboration.body === pageContentBody(page) || save.isPending) return
    const timer = window.setTimeout(() => save.mutate({ title, body: collaboration.body }), 1_500)
    return () => window.clearTimeout(timer)
  }, [page?.draftRevision, page?.plainText, collaboration.body, title, save.isPending])
  if (!page) return <div className="editor-loading"><span className="loading-pulse" /></div>
  const documentSettings = normalizeDocumentSettings(page.documentSettings)
  const pageCover = safePresentationUrl(page.cover)
  const saveNow = () => {
    if (!save.isPending) save.mutate({ title, body: collaboration.body })
  }
  const insertToken = (token: string, replaceSlash = false) => {
    editorRef.current?.insertText(token, replaceSlash)
  }
  const insertReference = (token: string) => insertToken(token)
  const uploadEditorImages = async (files: File[]) => {
    const tokens: string[] = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) throw new Error(`${file.name || '所选文件'} 不是图片`)
      if (file.size <= 0) throw new Error('不能上传空图片')
      if (file.size > 50 * 1024 * 1024) throw new Error(`${file.name || '图片'} 超过 50 MB`)
      const form = new FormData()
      form.append('pageId', pageId)
      form.append('file', file)
      const attachment = await upload<{ id: string; originalName: string; mediaType: string; sizeBytes: number; contentUrl: string }>('/api/v1/attachments/upload', form)
      tokens.push(encodeContentCardToken('image', 1, {
        attachmentId: attachment.id,
        url: attachment.contentUrl,
        alt: attachment.originalName,
        mediaType: attachment.mediaType,
        sizeBytes: attachment.sizeBytes,
        width: 'LARGE',
      }))
    }
    if (tokens.length) void post<void>('/api/v1/content-cards/use', { pageId, cardId: 'image' })
    return tokens
  }
  const collaborationLabel = collaboration.status === 'connected'
    ? collaboration.lastAcknowledgedSequence ? `协作已同步 · ${collaboration.lastAcknowledgedSequence}` : '实时协作'
    : collaboration.status === 'syncing' ? '正在同步…'
      : collaboration.status === 'reconnecting' ? '正在重连…'
        : collaboration.status === 'unavailable' ? '普通保存模式' : '正在连接…'
  return (
    <div className="editor-shell">
      <PageViewTracker pageId={page.id} />
      <header className="editor-topbar">
        <div className="breadcrumbs"><Link to={`/app/kb/${knowledgeBaseId}`}>{knowledgeBaseQuery.data?.name || '知识库'}</Link>{breadcrumbs.map((value, index) => <span className={index === breadcrumbs.length - 1 ? 'current' : ''} key={`${index}-${value}`}><ChevronRight size={14} />{value}</span>)}</div>
        <div className="editor-actions">
          <span className={`save-state collaboration-state ${collaboration.status}`} role="status" aria-live="polite" aria-atomic="true">{save.isPending ? '保存中…' : save.data?.queued ? '已离线保存 · 待同步' : collaborationLabel}</span>
          <div className="presence-list" role="group" aria-label="在线协作者">
            {collaboration.peers.slice(0, 4).map((peer) => <span key={peer.sessionId} style={{ background: peer.color }} title={peer.email}>{peer.email.slice(0, 1).toUpperCase()}</span>)}
            {collaboration.peers.length > 4 && <small>+{collaboration.peers.length - 4}</small>}
          </div>
          {page.contentType === 'DOCUMENT' && <><button className="button quiet small card-insert-button" onClick={() => { setEditingCard(null); setCardMenuOpen(true) }}><Palette size={16} />卡片</button><button className="button quiet small reference-insert-button" onClick={() => setReferenceInsertOpen(true)}><Network size={16} />引用</button></>}<button className={`icon-button ${referencesOpen ? 'selected' : ''}`} onClick={() => { setCommentsOpen(false); setAnalyticsOpen(false); setReferencesOpen((value) => !value) }} aria-label="知识网络"><Network size={18} /></button><FavoriteButton pageId={pageId} /><button className={`icon-button ${commentsOpen ? 'selected' : ''}`} onClick={() => { setReferencesOpen(false); setAnalyticsOpen(false); setCommentsOpen((value) => !value) }} aria-label="评论"><Bell size={18} /></button><button className={`icon-button ${analyticsOpen ? 'selected' : ''}`} onClick={() => { setReferencesOpen(false); setCommentsOpen(false); setAnalyticsOpen((value) => !value) }} aria-label="统计"><BarChart3 size={18} /></button><button className="icon-button" onClick={() => setTemplateSaveOpen(true)} title="保存为模板" aria-label="将文稿保存为模板"><LayoutTemplate size={18} /></button><button className="icon-button" onClick={() => setExportOpen(true)} title="导出" aria-label="导出文稿"><Download size={18} /></button><button className="button secondary small" onClick={() => openManagement('PUBLISH')} disabled={Boolean(pendingManagementTab)}>{page.publishedRevisionId ? '更新发布' : '发布'}</button><button className="icon-button" onClick={() => openManagement('PROPERTIES')} disabled={Boolean(pendingManagementTab)} title="文稿管理" aria-label="打开文稿管理"><MoreHorizontal size={18} /></button>
        </div>
      </header>
      <main className={`editor-canvas ${page.contentType !== 'DOCUMENT' ? 'structured-canvas' : documentSettingsClassNames(page.documentSettings)}`}>
        {pageCover && <button className="editor-page-cover" style={{ backgroundImage: `linear-gradient(90deg,rgba(18,26,21,.08),rgba(18,26,21,.02)),url("${pageCover}")` }} onClick={() => void openManagement('PROPERTIES')} aria-label="修改文稿封面" />}
        <button className="page-icon-button" onClick={() => void openManagement('PROPERTIES')} aria-label={page.icon ? '修改文稿图标' : '添加文稿图标'}>{safePresentationUrl(page.icon) ? <img src={safePresentationUrl(page.icon)!} alt="" /> : page.icon || contentTypeIcon(page.contentType)}</button>
        <input className="editor-title" value={title} onChange={(event) => setTitleDraft({ id: pageId, title: event.target.value })} onBlur={saveNow} aria-label="文稿标题" />
        <div className="editor-meta"><span>{page.contentType.toLowerCase()}</span><span>版本 {page.draftRevision}</span></div>
        {page.contentType === 'DOCUMENT' ? <BlockDocumentEditor
          ref={editorRef}
          value={collaboration.body}
          onChange={collaboration.setBody}
          onSlash={() => { setEditingCard(null); setCardMenuOpen(true) }}
          onSelection={collaboration.broadcastSelection}
          onImageFiles={uploadEditorImages}
          onEditCard={(card) => { setEditingCard(card); setCardMenuOpen(true) }}
          onBlur={saveNow}
          showOutline={documentSettings.showOutline}
        /> : <FirstClassEditor page={page} value={collaboration.body} onChange={collaboration.setBody} />}
        {page.contentType === 'DOCUMENT' && <DocumentCardPreview pageId={pageId} body={collaboration.body} />}
        {(save.error || collaboration.error) && <div className="inline-error" role="alert">{collaboration.error ?? messageOf(save.error)}</div>}
      </main>
      {commentsOpen && <CommentDrawer pageId={pageId} workspaceId={page.workspaceId} currentUserId={currentUser.userId} onClose={() => setCommentsOpen(false)} />}
      {referencesOpen && <ReferenceDrawer pageId={pageId} onClose={() => setReferencesOpen(false)} />}
      {analyticsOpen && <AnalyticsPanel pageId={pageId} onClose={() => setAnalyticsOpen(false)} />}
      {referenceInsertOpen && <ReferenceInsertDialog currentPageId={pageId} pages={pagesQuery.data ?? []} onInsert={insertReference} onClose={() => setReferenceInsertOpen(false)} />}
      {cardMenuOpen && <ContentCardMenu pageId={pageId} workspaceId={page.workspaceId} initialCard={editingCard} onInsert={(token) => { if (editingCard) editorRef.current?.replaceCard(editingCard.instanceId, token); else insertToken(token, true) }} onClose={() => { setCardMenuOpen(false); setEditingCard(null) }} />}
      {templateSaveOpen && <SaveTemplateDialog sourceType="DOCUMENT" sourceId={pageId} onClose={() => setTemplateSaveOpen(false)} />}
      {exportOpen && <PageExportDialog pageId={pageId} contentType={page.contentType} canUsePublished={Boolean(page.publishedRevisionId)} onClose={() => setExportOpen(false)} />}
      {managementTab && <PageManagement page={page} initialTab={managementTab} onClose={() => setManagementTab(null)} onUpdated={(updated, resetEditorBody) => { queryClient.setQueryData(['page', pageId], updated); setTitleDraft({ id: pageId, title: updated.title }); if (resetEditorBody) collaboration.setBody(pageContentBody(updated)); void cachePage(currentUser.userId, updated).catch(() => undefined) }} onTrashed={() => { setManagementTab(null); void queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }); void queryClient.invalidateQueries({ queryKey: ['catalog', knowledgeBaseId] }); navigate(`/app/kb/${knowledgeBaseId}`) }} />}
    </div>
  )
}

function PageHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

function safePresentationUrl(value: string | null | undefined) { const safe = safeMediaUrl(value); return safe?.startsWith('https://') ? safe : null }
function contentTypeIcon(value: Page['contentType']) { return ({ DOCUMENT: '📄', WHITEBOARD: '🎨', SPREADSHEET: '📊', DATABASE: '🗂️' })[value] }

function EmptyState({ icon, title, description, action }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{description}</p>{action}</div>
}

function CreatePageTypeDialog({ pending, error, onClose, onCreate }: { pending: boolean; error: unknown; onClose: () => void; onCreate: (type: Page['contentType']) => void }) {
  const types: Array<{ type: Page['contentType']; icon: React.ReactNode; title: string; description: string }> = [
    { type: 'DOCUMENT', icon: <FileText />, title: '文档', description: '块式写作、卡片、引用与多人协作' },
    { type: 'WHITEBOARD', icon: <Palette />, title: '画板', description: '无限画布、图形、便签、文本与连线' },
    { type: 'SPREADSHEET', icon: <BarChart3 />, title: '电子表格', description: '公式、格式、筛选、冻结与图表' },
    { type: 'DATABASE', icon: <LayoutGrid />, title: '数据表', description: '类型化字段、表格、看板、画廊与日历' },
  ]
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog create-type-dialog"><div className="dialog-head"><div><p className="eyebrow">新建</p><h2>选择内容类型</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭选择内容类型"><X size={18} /></button></div><div className="create-type-grid">{types.map((item) => <button key={item.type} disabled={pending} onClick={() => onCreate(item.type)}><span>{item.icon}</span><div><strong>{item.title}</strong><p>{item.description}</p></div><ChevronRight /></button>)}</div>{Boolean(error) && <div className="form-error">{messageOf(error)}</div>}</div></div>
}

function pageContentBody(page: Page): string {
  return page.contentType === 'DOCUMENT' ? page.plainText : JSON.stringify(page.content)
}

export function pageDraftMatches(page: Page, draft: { title: string; body: string }): boolean {
  return page.title === draft.title && pageContentBody(page) === draft.body
}

function toSlug(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '')
}
