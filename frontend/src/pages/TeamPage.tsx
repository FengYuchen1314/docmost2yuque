import { useMemo, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, BookOpen, Building2, ChevronRight, Clock3, Plus, Save, Settings, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { messageOf, post, request } from '../lib/api'
import type { CurrentUser, KnowledgeBase, Team, Workspace } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

interface TeamMember { userId: string; email: string; displayName: string | null; role: 'MANAGER' | 'MEMBER'; createdAt: string; updatedAt: string }
interface WorkspaceMember { userId: string; email: string; displayName: string | null; role: string; createdAt: string; updatedAt: string }
interface AuditEvent { id: string; actorId: string | null; action: string; outcome: string; occurredAt: string }
interface AuditPage { items: AuditEvent[]; nextOffset: number; hasMore: boolean }
type TeamTab = 'KNOWLEDGE' | 'MEMBERS' | 'ACTIVITY' | 'SETTINGS'

export function TeamPage({ currentUser }: { currentUser: CurrentUser }) {
  const { workspaceId = '', teamId = '' } = useParams()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const confirmation = useConfirmDialog()
  const [tab, setTab] = useState<TeamTab>('KNOWLEDGE')
  const [createOpen, setCreateOpen] = useState(false)
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => request<Workspace[]>('/api/v1/workspaces') })
  const teams = useQuery({ queryKey: ['teams', workspaceId], queryFn: () => post<Team[]>('/api/v1/teams/list', { workspaceId }), enabled: Boolean(workspaceId) })
  const members = useQuery({ queryKey: ['team-members', teamId], queryFn: () => post<TeamMember[]>('/api/v1/teams/members', { teamId }), enabled: Boolean(teamId) })
  const knowledgeBases = useQuery({ queryKey: ['knowledge-bases', workspaceId], queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }), enabled: Boolean(workspaceId) })
  const activity = useInfiniteQuery({ queryKey: ['team-activity', teamId], initialPageParam: 0, queryFn: ({ pageParam }) => post<AuditPage>('/api/v1/teams/activity/page', { teamId, limit: 25, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined, enabled: Boolean(teamId) && tab === 'ACTIVITY' })
  const workspace = workspaces.data?.find((value) => value.id === workspaceId)
  const team = teams.data?.find((value) => value.id === teamId)
  const membership = members.data?.find((value) => value.userId === currentUser.userId)
  const canManage = membership?.role === 'MANAGER' || ['OWNER', 'ADMIN'].includes(workspace?.membershipRole ?? '')
  const teamKnowledgeBases = useMemo(() => (knowledgeBases.data ?? []).filter((value) => value.teamId === teamId || value.ownerType === 'TEAM' && value.ownerId === teamId), [knowledgeBases.data, teamId])
  const managerCount = (members.data ?? []).filter((value) => value.role === 'MANAGER').length
  const leaveBlocked = membership?.role === 'MANAGER' && managerCount <= 1
  const leave = useMutation({
    mutationFn: () => post<void>('/api/v1/teams/members/leave', { teamId }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['teams', workspaceId] }); navigate(`/app/w/${workspaceId}`) },
  })
  if (!teams.isPending && !team) return <Navigate to={`/app/w/${workspaceId}`} replace />
  return <div className="content-page team-page">
    <header className="team-page-hero"><Link to={`/app/w/${workspaceId}`}>{workspace?.name || '空间'}</Link><div className="team-page-title"><span>{team?.avatar || team?.name.slice(0, 1) || <Building2 />}</span><div><p className="eyebrow">团队</p><h1>{team?.name || '正在加载团队'}</h1><p>{team?.description || '共同维护团队知识与协作关系。'}</p></div></div><div className="team-page-actions">{membership && <button className="button secondary small" title={leaveBlocked ? '团队必须保留至少一位管理者，请先指定另一位管理者' : '退出后会立即失去团队授权'} disabled={leaveBlocked || leave.isPending} onClick={() => confirmation.confirm({ title: `退出团队「${team?.name}」`, description: '退出后会立即失去通过该团队获得的知识库和文稿权限。', confirmLabel: '退出团队' }, () => leave.mutate())}><UserMinus />{leave.isPending ? '正在退出…' : '退出团队'}</button>}{canManage && <button className="button primary small" onClick={() => setTab('SETTINGS')}><Settings />团队设置</button>}</div></header>
    <nav className="team-page-tabs" aria-label="团队页面"><button className={tab === 'KNOWLEDGE' ? 'active' : ''} onClick={() => setTab('KNOWLEDGE')}><BookOpen />知识库</button><button className={tab === 'MEMBERS' ? 'active' : ''} onClick={() => setTab('MEMBERS')}><Users />成员 <small>{members.data?.length ?? 0}</small></button><button className={tab === 'ACTIVITY' ? 'active' : ''} onClick={() => setTab('ACTIVITY')}><Activity />动态</button>{canManage && <button className={tab === 'SETTINGS' ? 'active' : ''} onClick={() => setTab('SETTINGS')}><Settings />设置</button>}</nav>
    {tab === 'KNOWLEDGE' && <section className="team-page-section"><header><div><h2>团队知识库</h2><p>由团队持有的知识库会在这里集中展示。</p></div>{canManage && <button className="button primary small" onClick={() => setCreateOpen(true)}><Plus />新建知识库</button>}</header><div className="resource-grid">{teamKnowledgeBases.map((value) => <Link className="resource-card" to={`/app/kb/${value.id}`} key={value.id}><span className="resource-icon">{value.icon || <BookOpen />}</span><div><h3>{value.name}</h3><p>{value.description || '团队知识与工作沉淀'}</p><small>{visibilityLabel(value.visibility)} · {value.publishMode === 'AUTO' ? '自动发布' : '手动发布'}</small></div><ChevronRight /></Link>)}{!knowledgeBases.isPending && !teamKnowledgeBases.length && <TeamEmpty icon={<BookOpen />} title="还没有团队知识库" description={canManage ? '创建知识库后，团队成员会按角色获得对应访问能力。' : '团队管理者创建的知识库会显示在这里。'} />}</div></section>}
    {tab === 'MEMBERS' && team && <TeamMembersPanel team={team} currentUser={currentUser} values={members.data ?? []} canManage={canManage} managerCount={managerCount} />}
    {tab === 'ACTIVITY' && <section className="team-page-section"><header><div><h2>团队动态</h2><p>成员变化与团队设置调整按发生时间记录。</p></div></header><div className="team-activity-list">{(activity.data?.pages.flatMap((value) => value.items) ?? []).map((event) => <article key={event.id}><span><Clock3 /></span><div><strong>{teamActionLabel(event.action)}</strong><small>操作者 {event.actorId?.slice(0, 8) || '系统'} · {event.outcome === 'SUCCESS' ? '已完成' : event.outcome}</small></div><time>{formatTime(event.occurredAt)}</time></article>)}{!activity.isPending && !activity.data?.pages[0]?.items.length && <TeamEmpty icon={<Activity />} title="还没有团队动态" description="成员、资料和团队生命周期操作会出现在这里。" />}</div>{activity.hasNextPage && <button className="button secondary team-page-more" disabled={activity.isFetchingNextPage} onClick={() => activity.fetchNextPage()}>{activity.isFetchingNextPage ? '加载中…' : '加载更多动态'}</button>}{activity.error && <div className="form-error">{messageOf(activity.error)}</div>}</section>}
    {tab === 'SETTINGS' && team && canManage && <TeamSettingsPanel team={team} knowledgeBaseCount={teamKnowledgeBases.length} onDeleted={() => navigate(`/app/w/${workspaceId}`)} />}
    {leave.error && <div className="form-error team-page-error">{messageOf(leave.error)}</div>}
    {createOpen && team && <CreateTeamKnowledgeBaseDialog team={team} onClose={() => setCreateOpen(false)} onCreated={async () => { setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: ['knowledge-bases', workspaceId] }) }} />}
    {confirmation.dialog}
  </div>
}

function TeamMembersPanel({ team, currentUser, values, canManage, managerCount }: { team: Team; currentUser: CurrentUser; values: TeamMember[]; canManage: boolean; managerCount: number }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [selected, setSelected] = useState('')
  const workspaceMembers = useQuery({ queryKey: ['workspace-members', team.workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId: team.workspaceId }), enabled: canManage })
  const action = useMutation({
    mutationFn: ({ operation, userId, role }: { operation: 'add' | 'update' | 'remove'; userId: string; role?: TeamMember['role'] }) => post(`/api/v1/teams/members/${operation}`, { teamId: team.id, userId, role: role ?? 'MEMBER' }),
    onSuccess: async () => { setSelected(''); await Promise.all([queryClient.invalidateQueries({ queryKey: ['team-members', team.id] }), queryClient.invalidateQueries({ queryKey: ['team-activity', team.id] })]) },
  })
  const available = (workspaceMembers.data ?? []).filter((member) => !values.some((value) => value.userId === member.userId))
  return <section className="team-page-section"><header><div><h2>团队成员</h2><p>管理者可从当前空间添加成员并调整团队角色。</p></div>{currentUser.instanceAdmin && <Link className="button secondary small" to="/app/admin?tab=invitations"><UserPlus />邀请新用户</Link>}</header>{canManage && <div className="team-member-add"><select aria-label="选择要加入团队的空间成员" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择空间成员…</option>{available.map((member) => <option value={member.userId} key={member.userId}>{member.displayName || member.email} · {member.role}</option>)}</select><button className="button primary small" disabled={!selected || action.isPending} onClick={() => action.mutate({ operation: 'add', userId: selected })}><UserPlus />加入团队</button></div>}<div className="team-page-members">{values.map((member) => { const lastManager = member.role === 'MANAGER' && managerCount <= 1; return <article key={member.userId}><span>{(member.displayName || member.email).slice(0, 1).toUpperCase()}</span><div><strong>{member.displayName || member.email}{member.userId === currentUser.userId ? '（我）' : ''}</strong><small>{member.email} · 加入于 {formatTime(member.createdAt)}</small></div>{canManage ? <select aria-label={`${member.email} 的团队角色`} value={member.role} disabled={lastManager || action.isPending} onChange={(event) => action.mutate({ operation: 'update', userId: member.userId, role: event.target.value as TeamMember['role'] })}><option value="MANAGER">管理者</option><option value="MEMBER">成员</option></select> : <i>{member.role === 'MANAGER' ? '管理者' : '成员'}</i>}{canManage && <button className="icon-button danger" aria-label={`移除 ${member.email}`} title={lastManager ? '团队必须保留至少一位管理者' : '移出团队'} disabled={lastManager || action.isPending} onClick={() => confirmation.confirm({ title: `将 ${member.email} 移出团队`, description: '该成员会立即失去通过团队获得的资源权限。', confirmLabel: '移出团队' }, () => action.mutate({ operation: 'remove', userId: member.userId }))}><UserMinus /></button>}</article>})}{!values.length && <TeamEmpty icon={<Users />} title="团队中还没有成员" description="从空间成员中选择人员加入。" />}</div>{(workspaceMembers.error || action.error) && <div className="form-error">{messageOf(workspaceMembers.error ?? action.error)}</div>}{confirmation.dialog}</section>
}

function TeamSettingsPanel({ team, knowledgeBaseCount, onDeleted }: { team: Team; knowledgeBaseCount: number; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [name, setName] = useState(team.name)
  const [slug, setSlug] = useState(team.slug)
  const [description, setDescription] = useState(team.description ?? '')
  const [avatar, setAvatar] = useState(team.avatar ?? '')
  const [visibility, setVisibility] = useState(team.visibility)
  const save = useMutation({ mutationFn: () => post<Team>('/api/v1/teams/update', { teamId: team.id, name, slug, description, avatar: avatar || null, visibility }), onSuccess: (value) => queryClient.setQueryData<Team[]>(['teams', team.workspaceId], (current) => (current ?? []).map((item) => item.id === value.id ? value : item)) })
  const remove = useMutation({ mutationFn: () => post<void>('/api/v1/teams/delete', { teamId: team.id }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['teams', team.workspaceId] }); onDeleted() } })
  return <section className="team-page-section team-settings-panel"><header><div><h2>团队设置</h2><p>维护团队身份、可见范围与生命周期。</p></div></header><form onSubmit={(event) => submit(event, save.mutate)}><div className="team-settings-grid"><label className="field"><span className="field-label">团队名称</span><input value={name} minLength={2} maxLength={120} onChange={(event) => setName(event.target.value)} required /></label><label className="field"><span className="field-label">路径</span><input value={slug} minLength={2} maxLength={80} onChange={(event) => setSlug(toSlug(event.target.value))} required /></label><label className="field wide"><span className="field-label">团队介绍</span><textarea rows={4} maxLength={4000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field"><span className="field-label">图标或图片 URL</span><input value={avatar} maxLength={2000} onChange={(event) => setAvatar(event.target.value)} /></label><label className="field"><span className="field-label">可见性</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="WORKSPACE">空间内可见</option><option value="PRIVATE">仅团队成员</option></select></label></div>{save.error && <div className="form-error">{messageOf(save.error)}</div>}<div className="settings-actions"><small>{save.isSuccess ? '团队资料已保存' : '路径在当前空间内必须唯一'}</small><button className="button primary" disabled={!name.trim() || !slug || save.isPending}><Save />{save.isPending ? '正在保存…' : '保存团队资料'}</button></div></form><div className="danger-zone team-page-danger"><div><strong>删除团队</strong><p>{knowledgeBaseCount ? `请先转移或归档该团队拥有的 ${knowledgeBaseCount} 个知识库。` : '删除后成员关系与团队授权立即失效，操作不可恢复。'}</p></div><button className="button danger" disabled={knowledgeBaseCount > 0 || remove.isPending} onClick={() => confirmation.confirm({ title: `删除团队「${team.name}」`, description: '成员关系和团队授权会立即失效，此操作无法恢复。', confirmLabel: '删除团队' }, () => remove.mutate())}><Trash2 />{remove.isPending ? '正在删除…' : '删除团队'}</button></div>{remove.error && <div className="form-error">{messageOf(remove.error)}</div>}{confirmation.dialog}</section>
}

function CreateTeamKnowledgeBaseDialog({ team, onClose, onCreated }: { team: Team; onClose: () => void; onCreated: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const create = useMutation({ mutationFn: () => post<KnowledgeBase>('/api/v1/knowledge-bases/create', { workspaceId: team.workspaceId, name, slug, ownerType: 'TEAM', ownerId: team.id, visibility: 'PRIVATE', publishMode: 'MANUAL' }), onSuccess: onCreated })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={(event) => submit(event, create.mutate)}><div className="dialog-head"><div><p className="eyebrow">{team.name}</p><h2>新建团队知识库</h2></div><button type="button" className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></div><label className="field"><span className="field-label">知识库名称</span><input autoFocus value={name} onChange={(event) => { setName(event.target.value); if (!slug) setSlug(toSlug(event.target.value)) }} required /></label><label className="field"><span className="field-label">路径</span><input value={slug} onChange={(event) => setSlug(toSlug(event.target.value))} required /></label>{create.error && <div className="form-error">{messageOf(create.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim() || !slug || create.isPending}>{create.isPending ? '正在创建…' : '创建知识库'}</button></div></form></div>
}

function TeamEmpty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) { return <div className="team-empty"><span>{icon}</span><strong>{title}</strong><p>{description}</p></div> }
function submit(event: FormEvent, action: () => void) { event.preventDefault(); action() }
function toSlug(value: string) { return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 80) }
function visibilityLabel(value: string) { return value === 'PUBLIC' ? '公开' : value === 'WORKSPACE' ? '空间可见' : '私密' }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function teamActionLabel(value: string) { return ({ 'team.create': '创建了团队', 'team.update': '更新了团队资料', 'team.member.add': '添加了团队成员', 'team.member.update': '调整了成员角色', 'team.member.remove': '移除了团队成员', 'team.member.leave': '成员退出了团队', 'team.delete': '删除了团队' } as Record<string, string>)[value] ?? value }
