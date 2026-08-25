import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, Building2, ChevronRight, Clock3, FileText, Plus, RotateCcw, Settings, Shield, Trash2, UserMinus, UserPlus, Users, X } from 'lucide-react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { messageOf, post, request } from '../lib/api'
import type { CurrentUser, Page, Team, Workspace } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

interface WorkspaceMember { userId: string; email: string; displayName: string | null; role: 'OWNER' | 'ADMIN' | 'MEMBER' | 'EXTERNAL'; createdAt: string; updatedAt: string }
interface TeamMember { userId: string; email: string; displayName: string | null; role: 'MANAGER' | 'MEMBER'; createdAt: string; updatedAt: string }
export interface UserGroup { id: string; workspaceId: string; name: string; description: string | null; memberCount: number; createdBy: string; createdAt: string; updatedAt: string }
interface UserGroupMember { userId: string; email: string; displayName: string | null; workspaceRole: WorkspaceMember['role']; addedBy: string; createdAt: string }
interface AuditEvent { id: string; workspaceId: string; actorId: string | null; action: string; resourceType: string; resourceId: string | null; outcome: string; details: string | null; occurredAt: string }
interface AuditEventPage { items: AuditEvent[]; nextOffset: number; hasMore: boolean }
type WorkspaceTab = 'general' | 'members' | 'groups' | 'teams' | 'trash' | 'audit'

export function WorkspaceSettingsPage() {
  const { workspaceId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const workspaces = useQuery({ queryKey: ['workspaces'], queryFn: () => request<Workspace[]>('/api/v1/workspaces') })
  const me = useQuery({ queryKey: ['me'], queryFn: () => request<CurrentUser>('/api/v1/auth/me') })
  const workspace = workspaces.data?.find((value) => value.id === workspaceId)
  const organization = workspace?.workspaceType === 'ORGANIZATION'
  const requestedTab = searchParams.get('tab')
  const tab: WorkspaceTab = isWorkspaceTab(requestedTab) && (organization || !['members', 'groups', 'teams'].includes(requestedTab)) ? requestedTab : 'general'
  const selectTab = (nextTab: WorkspaceTab) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', nextTab)
    if (nextTab !== 'teams') next.delete('team')
    setSearchParams(next, { replace: true })
  }
  const selectTeam = (teamId: string) => {
    const next = new URLSearchParams(searchParams)
    next.set('tab', 'teams')
    if (teamId) next.set('team', teamId)
    else next.delete('team')
    setSearchParams(next, { replace: true })
  }
  if (!workspaces.isPending && !workspace) return <Navigate to="/app" replace />
  if (workspace && !['OWNER', 'ADMIN'].includes(workspace.membershipRole)) return <Navigate to={`/app/w/${workspaceId}`} replace />
  return <div className="content-page workspace-settings-page">
    <header className="page-header"><div><p className="eyebrow">空间设置</p><h1>{workspace?.name ?? '正在加载空间'}</h1><p>{organization ? '管理空间资料、成员角色、团队、回收站与审计记录。' : '管理个人空间资料、内容回收站与审计记录。'}</p></div><Link className="button secondary small" to={`/app/w/${workspaceId}`}><X />退出设置</Link></header>
    <div className="settings-layout">
      <nav className="settings-nav">
        <button className={tab === 'general' ? 'active' : ''} onClick={() => selectTab('general')}><Settings />基本信息</button>
        {organization && <button className={tab === 'members' ? 'active' : ''} onClick={() => selectTab('members')}><Users />成员与角色</button>}
        {organization && <button className={tab === 'groups' ? 'active' : ''} onClick={() => selectTab('groups')}><Users />用户组</button>}
        {organization && <button className={tab === 'teams' ? 'active' : ''} onClick={() => selectTab('teams')}><Building2 />团队</button>}
        <button className={tab === 'trash' ? 'active' : ''} onClick={() => selectTab('trash')}><Trash2 />回收站</button>
        <button className={tab === 'audit' ? 'active' : ''} onClick={() => selectTab('audit')}><Activity />审计日志</button>
      </nav>
      <main className="settings-content">
        {workspace && tab === 'general' && <WorkspaceGeneral workspace={workspace} />}
        {organization && tab === 'members' && workspace && <WorkspaceMembers workspace={workspace} currentUserId={me.data?.userId ?? ''} />}
        {organization && tab === 'groups' && <UserGroupManagement workspaceId={workspaceId} />}
        {organization && tab === 'teams' && <TeamManagement workspaceId={workspaceId} selectedId={searchParams.get('team') ?? ''} onSelectedIdChange={selectTeam} />}
        {tab === 'trash' && <WorkspaceTrash workspaceId={workspaceId} />}
        {tab === 'audit' && <WorkspaceAudit workspaceId={workspaceId} />}
      </main>
    </div>
  </div>
}

function WorkspaceGeneral({ workspace }: { workspace: Workspace }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState(workspace.name)
  const [visibility, setVisibility] = useState(workspace.defaultVisibility)
  const [publishMode, setPublishMode] = useState(workspace.defaultPublishMode)
  useEffect(() => { setName(workspace.name); setVisibility(workspace.defaultVisibility); setPublishMode(workspace.defaultPublishMode) }, [workspace])
  const save = useMutation({
    mutationFn: () => post<Workspace>('/api/v1/workspaces/update', { workspaceId: workspace.id, name, defaultVisibility: visibility, defaultPublishMode: publishMode }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspaces'] }),
  })
  return <SettingsSection icon={<Settings />} title="基本信息" description="这些默认值会应用到新建知识库，已存在内容不会被批量改写。">
    <form className="settings-form" onSubmit={(event) => submit(event, save.mutate)}>
      <label className="field"><span className="field-label">空间名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label>
      <div className="settings-form-row"><label className="field"><span className="field-label">默认可见性</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="PRIVATE">私密</option><option value="WORKSPACE">空间成员可见</option><option value="PUBLIC">公开</option></select></label><label className="field"><span className="field-label">默认发布方式</span><select value={publishMode} onChange={(event) => setPublishMode(event.target.value)}><option value="MANUAL">手动发布</option><option value="AUTO">自动发布</option></select></label></div>
      <div className="settings-readonly"><span>空间类型</span><strong>{workspace.workspaceType === 'PERSONAL' ? '个人空间' : '组织空间'}</strong></div>
      {save.error && <div className="form-error">{messageOf(save.error)}</div>}
      <div className="settings-actions"><small>你在此空间中的角色：{workspace.membershipRole}</small><button className="button primary" disabled={!name.trim() || save.isPending}>{save.isPending ? '正在保存…' : '保存修改'}</button></div>
    </form>
    {workspace.workspaceType === 'ORGANIZATION' && workspace.membershipRole === 'OWNER' && <div className="danger-zone workspace-danger-zone"><div><strong>删除组织空间</strong><p>空间会立即从所有成员的列表中消失，发布内容和分享链接同步下线；底层数据采用软删除保留。</p></div><button className="button danger small" onClick={() => setDeleteOpen(true)}><Trash2 />删除空间</button></div>}
    {workspace.workspaceType === 'PERSONAL' && <div className="settings-protected-note"><Shield /><div><strong>个人空间受保护</strong><p>每个邮箱账号始终保留一个个人空间，不能删除。</p></div></div>}
    {deleteOpen && <WorkspaceDeleteDialog workspace={workspace} onClose={() => setDeleteOpen(false)} onDeleted={async () => { await queryClient.invalidateQueries({ queryKey: ['workspaces'] }); navigate('/app', { replace: true }) }} />}
  </SettingsSection>
}

function WorkspaceDeleteDialog({ workspace, onClose, onDeleted }: { workspace: Workspace; onClose: () => void; onDeleted: () => Promise<void> }) {
  const [confirmation, setConfirmation] = useState('')
  const remove = useMutation({ mutationFn: () => post<void>('/api/v1/workspaces/delete', { workspaceId: workspace.id, confirmationName: confirmation }), onSuccess: onDeleted })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog workspace-delete-dialog" onSubmit={(event) => submit(event, remove.mutate)}><div className="dialog-head"><div><p className="eyebrow">危险操作</p><h2>删除「{workspace.name}」</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><div className="workspace-delete-warning"><Trash2 /><p>所有成员会立即失去访问权限，公开发布、分享链接和搜索索引会同步下线。该操作不能在网页端自行恢复。</p></div><label className="field"><span className="field-label">输入空间名称以确认</span><input autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={workspace.name} autoComplete="off" /></label>{remove.error && <div className="form-error">{messageOf(remove.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button danger" disabled={confirmation !== workspace.name || remove.isPending}><Trash2 />{remove.isPending ? '正在删除…' : '永久移出工作台'}</button></div></form></div>
}

export function WorkspaceMembers({ workspace, currentUserId }: { workspace: Workspace; currentUserId: string }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const workspaceId = workspace.id
  const [transferOpen, setTransferOpen] = useState(false)
  const members = useQuery({ queryKey: ['workspace-members', workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }) })
  const update = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: WorkspaceMember['role'] }) => post<WorkspaceMember[]>('/api/v1/workspaces/members/update', { workspaceId, userId, role }),
    onSuccess: (values) => queryClient.setQueryData(['workspace-members', workspaceId], values),
  })
  const remove = useMutation({
    mutationFn: (userId: string) => post<void>('/api/v1/workspaces/members/remove', { workspaceId, userId, role: null }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-members', workspaceId] }),
  })
  const transferCandidates = (members.data ?? []).filter((member) => member.userId !== currentUserId)
  return <SettingsSection icon={<Users />} title="成员与角色" description="成员通过管理员发送的邮箱邀请加入；Owner 不会在普通操作中被移除。" action={workspace.membershipRole === 'OWNER' ? <button className="button secondary small" disabled={!currentUserId || !transferCandidates.length} onClick={() => setTransferOpen(true)}><Shield />转让所有权</button> : undefined}>
    {(update.error || remove.error) && <div className="form-error settings-inline-error">{messageOf(update.error ?? remove.error)}</div>}
    <div className="member-table">
      {(members.data ?? []).map((member) => <article key={member.userId}><span className="member-avatar">{member.email.slice(0, 1).toUpperCase()}</span><div><strong>{member.displayName || member.email}</strong><p>{member.displayName ? member.email : `加入于 ${formatTime(member.createdAt)}`}</p></div><select aria-label={`${member.email} 的空间角色`} value={member.role} disabled={member.role === 'OWNER' || update.isPending} onChange={(event) => update.mutate({ userId: member.userId, role: event.target.value as WorkspaceMember['role'] })}><option value="OWNER" disabled>所有者</option><option value="ADMIN">管理员</option><option value="MEMBER">成员</option><option value="EXTERNAL">外部联系人</option></select><button className="icon-button danger" aria-label={`移除空间成员 ${member.email}`} disabled={member.role === 'OWNER' || remove.isPending} onClick={() => confirmation.confirm({ title: `移除空间成员 ${member.email}`, description: '该用户会立即失去通过此空间获得的成员、团队和资源权限。', confirmLabel: '移除成员' }, () => remove.mutate(member.userId))}><UserMinus /></button></article>)}
      {!members.isPending && !members.data?.length && <SettingsEmpty icon={<Users />} text="空间中还没有成员" />}
    </div>
    {transferOpen && <WorkspaceOwnershipTransferDialog workspace={workspace} candidates={transferCandidates} onClose={() => setTransferOpen(false)} onTransferred={async (values) => { queryClient.setQueryData(['workspace-members', workspaceId], values); setTransferOpen(false); await queryClient.invalidateQueries({ queryKey: ['workspaces'] }) }} />}
    {confirmation.dialog}
  </SettingsSection>
}

function WorkspaceOwnershipTransferDialog({ workspace, candidates, onClose, onTransferred }: { workspace: Workspace; candidates: WorkspaceMember[]; onClose: () => void; onTransferred: (members: WorkspaceMember[]) => Promise<void> }) {
  const [targetUserId, setTargetUserId] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const transfer = useMutation({
    mutationFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/ownership/transfer', { workspaceId: workspace.id, targetUserId, confirmationName: confirmation }),
    onSuccess: onTransferred,
  })
  const target = candidates.find((member) => member.userId === targetUserId)
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog workspace-transfer-dialog" onSubmit={(event) => submit(event, transfer.mutate)}><div className="dialog-head"><div><p className="eyebrow">组织治理</p><h2>转让「{workspace.name}」</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><div className="workspace-transfer-warning"><Shield /><div><strong>这是一次原子化交接</strong><p>目标成员会成为 Owner，你会自动变为管理员；内容、成员和公开链接不会中断。</p></div></div><label className="field"><span className="field-label">新所有者</span><select aria-label="新所有者" value={targetUserId} onChange={(event) => setTargetUserId(event.target.value)}><option value="">选择另一位空间成员…</option>{candidates.map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email} · {workspaceRoleLabel(member.role)}</option>)}</select></label>{target && <div className="ownership-target-preview"><span>{target.email.slice(0, 1).toUpperCase()}</span><div><strong>{target.displayName || target.email}</strong><small>{target.email} · 当前为{workspaceRoleLabel(target.role)}</small></div></div>}<label className="field"><span className="field-label">输入空间名称以确认</span><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder={workspace.name} autoComplete="off" /></label>{transfer.error && <div className="form-error">{messageOf(transfer.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button danger" disabled={!targetUserId || confirmation !== workspace.name || transfer.isPending}><Shield />{transfer.isPending ? '正在交接…' : '确认转让所有权'}</button></div></form></div>
}

export function UserGroupManagement({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const groups = useQuery({ queryKey: ['user-groups', workspaceId], queryFn: () => post<UserGroup[]>('/api/v1/user-groups/list', { workspaceId }) })
  const workspaceMembers = useQuery({ queryKey: ['workspace-members', workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }) })
  const [selectedId, setSelectedId] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  useEffect(() => {
    if (selectedId && !groups.data?.some((group) => group.id === selectedId)) setSelectedId('')
    else if (!selectedId && groups.data?.[0]) setSelectedId(groups.data[0].id)
  }, [groups.data, selectedId])
  const selected = groups.data?.find((group) => group.id === selectedId)
  return <SettingsSection icon={<Users />} title="用户组" description="把空间成员组成可复用的权限主体；用户组只管理授权，不拥有知识库，也不会替代团队。" action={<button className="button primary small" onClick={() => setCreateOpen(true)}><Plus />新建用户组</button>}>
    <div className="team-settings-layout user-group-settings-layout"><div className="team-settings-list">{(groups.data ?? []).map((group) => <button key={group.id} className={group.id === selectedId ? 'active' : ''} onClick={() => setSelectedId(group.id)}><span>{group.name.slice(0, 1)}</span><div><strong>{group.name}</strong><small>{group.memberCount} 位成员</small></div><ChevronRight /></button>)}{!groups.isPending && !groups.data?.length && <SettingsEmpty icon={<Users />} text="还没有用户组" />}</div>{selected ? <UserGroupEditor group={selected} workspaceMembers={workspaceMembers.data ?? []} onDeleted={() => setSelectedId('')} /> : <div className="team-settings-placeholder">选择或新建一个用户组</div>}</div>
    {(groups.error || workspaceMembers.error) && <div className="form-error settings-inline-error">{messageOf(groups.error ?? workspaceMembers.error)}</div>}
    {createOpen && <CreateUserGroupDialog workspaceId={workspaceId} onClose={() => setCreateOpen(false)} onCreated={async (group) => { setSelectedId(group.id); setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: ['user-groups', workspaceId] }) }} />}
  </SettingsSection>
}

function UserGroupEditor({ group, workspaceMembers, onDeleted }: { group: UserGroup; workspaceMembers: WorkspaceMember[]; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [candidate, setCandidate] = useState('')
  useEffect(() => { setName(group.name); setDescription(group.description ?? ''); setCandidate('') }, [group])
  const members = useQuery({ queryKey: ['user-group-members', group.id], queryFn: () => post<UserGroupMember[]>('/api/v1/user-groups/members', { groupId: group.id }) })
  const save = useMutation({ mutationFn: () => post<UserGroup>('/api/v1/user-groups/update', { groupId: group.id, name, description: description || null }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['user-groups', group.workspaceId] }) })
  const remove = useMutation({ mutationFn: () => post<void>('/api/v1/user-groups/delete', { groupId: group.id }), onSuccess: async () => { onDeleted(); await queryClient.invalidateQueries({ queryKey: ['user-groups', group.workspaceId] }) } })
  const memberAction = useMutation({
    mutationFn: ({ operation, userId }: { operation: 'add' | 'remove'; userId: string }) => post<UserGroupMember[]>(`/api/v1/user-groups/members/${operation}`, { groupId: group.id, userId }),
    onSuccess: (values) => { setCandidate(''); queryClient.setQueryData(['user-group-members', group.id], values); void queryClient.invalidateQueries({ queryKey: ['user-groups', group.workspaceId] }) },
  })
  const available = useMemo(() => workspaceMembers.filter((value) => !members.data?.some((member) => member.userId === value.userId)), [members.data, workspaceMembers])
  return <div className="team-editor user-group-editor"><form onSubmit={(event) => submit(event, save.mutate)}><label className="field"><span className="field-label">用户组名称</span><input value={name} onChange={(event) => setName(event.target.value)} minLength={2} maxLength={120} required /></label><label className="field"><span className="field-label">用途说明</span><textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 2000))} rows={3} placeholder="例如：产品评审人、外部顾问或值班团队" /></label>{save.error && <div className="form-error">{messageOf(save.error)}</div>}<div className="settings-actions"><small>改名不会改变已经引用此组的文稿权限。</small><button className="button secondary small" disabled={save.isPending || name.trim().length < 2}>保存用户组</button></div></form><div className="team-members-head"><strong>组成员 · {members.data?.length ?? group.memberCount}</strong><div><select value={candidate} onChange={(event) => setCandidate(event.target.value)}><option value="">选择空间成员…</option>{available.map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email} · {member.role}</option>)}</select><button className="button quiet small" disabled={!candidate || memberAction.isPending} onClick={() => memberAction.mutate({ operation: 'add', userId: candidate })}><UserPlus />添加</button></div></div><div className="compact-member-list">{(members.data ?? []).map((member) => <div key={member.userId}><span>{member.email.slice(0, 1).toUpperCase()}</span><strong>{member.displayName || member.email}</strong><small>{member.workspaceRole === 'EXTERNAL' ? '外部联系人' : member.workspaceRole}</small><button className="icon-button danger" aria-label={`将 ${member.email} 移出用户组`} disabled={memberAction.isPending} onClick={() => confirmation.confirm({ title: `将 ${member.email} 移出用户组`, description: '该用户会立即失去通过此用户组获得的资源权限。', confirmLabel: '移出用户组' }, () => memberAction.mutate({ operation: 'remove', userId: member.userId }))}><UserMinus /></button></div>)}{!members.isPending && !members.data?.length && <SettingsEmpty icon={<Users />} text="组内还没有成员" />}</div>{(members.error || memberAction.error) && <div className="form-error">{messageOf(members.error ?? memberAction.error)}</div>}<div className="danger-zone team-danger-zone"><div><strong>删除用户组</strong><p>引用此组的 ACL 会立即停止生效，但不会删除成员、团队或文稿。</p></div><button className="button danger small" disabled={remove.isPending} onClick={() => confirmation.confirm({ title: `删除用户组「${group.name}」`, description: '引用此组的所有 ACL 会立即停止生效，成员、团队和文稿本身不会被删除。', confirmLabel: '删除用户组' }, () => remove.mutate())}><Trash2 />删除用户组</button></div>{confirmation.dialog}</div>
}

function CreateUserGroupDialog({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (group: UserGroup) => Promise<void> }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const create = useMutation({ mutationFn: () => post<UserGroup>('/api/v1/user-groups/create', { workspaceId, name, description: description || null }), onSuccess: onCreated })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={(event) => submit(event, create.mutate)}><div className="dialog-head"><div><p className="eyebrow">权限主体</p><h2>新建用户组</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><label className="field"><span className="field-label">用户组名称</span><input autoFocus value={name} minLength={2} maxLength={120} onChange={(event) => setName(event.target.value)} placeholder="例如：产品评审人" required /></label><label className="field"><span className="field-label">用途说明（可选）</span><textarea value={description} onChange={(event) => setDescription(event.target.value.slice(0, 2000))} rows={3} /></label>{create.error && <div className="form-error">{messageOf(create.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={name.trim().length < 2 || create.isPending}>创建用户组</button></div></form></div>
}

function TeamManagement({ workspaceId, selectedId, onSelectedIdChange }: { workspaceId: string; selectedId: string; onSelectedIdChange: (teamId: string) => void }) {
  const queryClient = useQueryClient()
  const teams = useQuery({ queryKey: ['teams', workspaceId], queryFn: () => post<Team[]>('/api/v1/teams/list', { workspaceId }) })
  const members = useQuery({ queryKey: ['workspace-members', workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }) })
  const [createOpen, setCreateOpen] = useState(false)
  useEffect(() => {
    if (selectedId && !teams.data?.some((team) => team.id === selectedId)) onSelectedIdChange(teams.data?.[0]?.id ?? '')
    else if (!selectedId && teams.data?.[0]) onSelectedIdChange(teams.data[0].id)
  }, [onSelectedIdChange, selectedId, teams.data])
  const selected = teams.data?.find((team) => team.id === selectedId)
  return <SettingsSection icon={<Building2 />} title="团队" description="团队是空间内稳定的协作单元，可作为知识库归属方。" action={<button className="button primary small" onClick={() => setCreateOpen(true)}><Plus />新建团队</button>}>
    <div className="team-settings-layout"><div className="team-settings-list">{(teams.data ?? []).map((team) => <button key={team.id} className={team.id === selectedId ? 'active' : ''} onClick={() => onSelectedIdChange(team.id)}><span>{team.avatar || team.name.slice(0, 1)}</span><div><strong>{team.name}</strong><small>{team.visibility === 'PRIVATE' ? '私密团队' : '空间可见'}</small></div><ChevronRight /></button>)}{!teams.isPending && !teams.data?.length && <SettingsEmpty icon={<Building2 />} text="还没有团队" />}</div>{selected ? <TeamEditor team={selected} workspaceMembers={members.data ?? []} onDeleted={() => onSelectedIdChange('')} /> : <div className="team-settings-placeholder">选择或新建一个团队</div>}</div>
    {createOpen && <CreateTeamDialog workspaceId={workspaceId} onClose={() => setCreateOpen(false)} onCreated={async (team) => { onSelectedIdChange(team.id); setCreateOpen(false); await queryClient.invalidateQueries({ queryKey: ['teams', workspaceId] }) }} />}
  </SettingsSection>
}

function TeamEditor({ team, workspaceMembers, onDeleted }: { team: Team; workspaceMembers: WorkspaceMember[]; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [name, setName] = useState(team.name)
  const [slug, setSlug] = useState(team.slug)
  const [description, setDescription] = useState(team.description ?? '')
  const [avatar, setAvatar] = useState(team.avatar ?? '')
  const [visibility, setVisibility] = useState(team.visibility)
  const [newMember, setNewMember] = useState('')
  useEffect(() => { setName(team.name); setSlug(team.slug); setDescription(team.description ?? ''); setAvatar(team.avatar ?? ''); setVisibility(team.visibility) }, [team])
  const members = useQuery({ queryKey: ['team-members', team.id], queryFn: () => post<TeamMember[]>('/api/v1/teams/members', { teamId: team.id }) })
  const save = useMutation({ mutationFn: () => post<Team>('/api/v1/teams/update', { teamId: team.id, name, slug, description, avatar: avatar || null, visibility }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['teams', team.workspaceId] }) })
  const remove = useMutation({
    mutationFn: () => post<void>('/api/v1/teams/delete', { teamId: team.id }),
    onSuccess: async () => { onDeleted(); await queryClient.invalidateQueries({ queryKey: ['teams', team.workspaceId] }) },
  })
  const memberAction = useMutation({
    mutationFn: ({ operation, userId, role }: { operation: 'add' | 'update' | 'remove'; userId: string; role?: string }) => post(`/api/v1/teams/members/${operation}`, { teamId: team.id, userId, role: role ?? 'MEMBER' }),
    onSuccess: async () => { setNewMember(''); await queryClient.invalidateQueries({ queryKey: ['team-members', team.id] }) },
  })
  const available = useMemo(() => workspaceMembers.filter((value) => !members.data?.some((member) => member.userId === value.userId)), [members.data, workspaceMembers])
  const managerCount = (members.data ?? []).filter((member) => member.role === 'MANAGER').length
  return <div className="team-editor"><form onSubmit={(event) => submit(event, save.mutate)}><div className="settings-form-row"><label className="field"><span className="field-label">团队名称</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="field"><span className="field-label">路径</span><input value={slug} onChange={(event) => setSlug(event.target.value)} required /></label></div><div className="settings-form-row"><label className="field"><span className="field-label">介绍</span><input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label className="field"><span className="field-label">图标</span><input value={avatar} onChange={(event) => setAvatar(event.target.value)} maxLength={2000} placeholder="表情或图片 URL" /></label></div><label className="field"><span className="field-label">可见性</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="WORKSPACE">空间内可见</option><option value="PRIVATE">仅团队成员</option></select></label>{(save.error || remove.error) && <div className="form-error">{messageOf(save.error ?? remove.error)}</div>}<div className="settings-actions"><span /><button className="button secondary small" disabled={save.isPending}>保存团队资料</button></div></form><div className="team-members-head"><strong>团队成员</strong><div><select value={newMember} onChange={(event) => setNewMember(event.target.value)}><option value="">选择空间成员…</option>{available.map((member) => <option key={member.userId} value={member.userId}>{member.email}</option>)}</select><button className="button quiet small" disabled={!newMember || memberAction.isPending} onClick={() => memberAction.mutate({ operation: 'add', userId: newMember })}><UserPlus />添加</button></div></div><div className="compact-member-list">{(members.data ?? []).map((member) => { const protectedManager = member.role === 'MANAGER' && managerCount <= 1; return <div key={member.userId}><span>{member.email.slice(0, 1).toUpperCase()}</span><strong>{member.displayName || member.email}</strong><select aria-label={`${member.email} 的团队角色`} value={member.role} disabled={protectedManager || memberAction.isPending} onChange={(event) => memberAction.mutate({ operation: 'update', userId: member.userId, role: event.target.value })}><option value="MANAGER">管理者</option><option value="MEMBER">成员</option></select><button className="icon-button danger" aria-label={`移除 ${member.email}`} title={protectedManager ? '团队必须保留至少一位管理者' : '移出团队'} disabled={protectedManager || memberAction.isPending} onClick={() => confirmation.confirm({ title: `将 ${member.email} 移出团队`, description: '该成员会立即失去通过团队获得的资源权限。', confirmLabel: '移出团队' }, () => memberAction.mutate({ operation: 'remove', userId: member.userId }))}><UserMinus /></button></div> })}</div>{memberAction.error && <div className="form-error">{messageOf(memberAction.error)}</div>}<div className="danger-zone team-danger-zone"><div><strong>删除团队</strong><p>只能删除不再拥有活跃知识库的团队；成员和权限关系会一并失效。</p></div><button className="button danger small" disabled={remove.isPending} onClick={() => confirmation.confirm({ title: `删除团队「${team.name}」`, description: '成员关系和团队授权会立即失效，此操作无法恢复。', confirmLabel: '删除团队' }, () => remove.mutate())}><Trash2 />{remove.isPending ? '正在删除…' : '删除团队'}</button></div>{confirmation.dialog}</div>
}

function CreateTeamDialog({ workspaceId, onClose, onCreated }: { workspaceId: string; onClose: () => void; onCreated: (team: Team) => Promise<void> }) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [visibility, setVisibility] = useState('WORKSPACE')
  const create = useMutation({ mutationFn: () => post<Team>('/api/v1/teams/create', { workspaceId, name, slug, description: '', avatar: null, visibility }), onSuccess: onCreated })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="dialog" onSubmit={(event) => submit(event, create.mutate)}><div className="dialog-head"><div><p className="eyebrow">空间团队</p><h2>新建团队</h2></div><button type="button" className="icon-button" onClick={onClose}><X /></button></div><label className="field"><span className="field-label">团队名称</span><input autoFocus value={name} onChange={(event) => { setName(event.target.value); if (!slug) setSlug(toSlug(event.target.value)) }} required /></label><label className="field"><span className="field-label">路径</span><input value={slug} onChange={(event) => setSlug(event.target.value)} required /></label><label className="field"><span className="field-label">可见性</span><select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="WORKSPACE">空间内可见</option><option value="PRIVATE">私密</option></select></label>{create.error && <div className="form-error">{messageOf(create.error)}</div>}<div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name || !slug || create.isPending}>创建团队</button></div></form></div>
}

function WorkspaceTrash({ workspaceId }: { workspaceId: string }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const pages = useQuery({ queryKey: ['workspace-trash', workspaceId], queryFn: () => post<Page[]>('/api/v1/pages/trash/list', { workspaceId }) })
  const action = useMutation({ mutationFn: ({ path, pageId }: { path: 'restore' | 'delete-permanently'; pageId: string }) => post(`/api/v1/pages/${path}`, { pageId }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workspace-trash', workspaceId] }) })
  return <SettingsSection icon={<Trash2 />} title="回收站" description="恢复会保留原知识库归属；永久删除不可撤销。"><div className="trash-list">{(pages.data ?? []).map((page) => <article key={page.id}><span><FileText /></span><div><strong>{page.title}</strong><p>{page.contentType.toLowerCase()} · 最近更新 {formatTime(page.updatedAt)}</p></div><button className="button quiet small" onClick={() => action.mutate({ path: 'restore', pageId: page.id })}><RotateCcw />恢复</button><button className="button danger small" onClick={() => confirmation.confirm({ title: `永久删除「${page.title}」`, description: '正文、历史版本、发布快照和关联数据将一并删除，此操作无法恢复。', confirmLabel: '永久删除' }, () => action.mutate({ path: 'delete-permanently', pageId: page.id }))}><Trash2 />永久删除</button></article>)}{!pages.isPending && !pages.data?.length && <SettingsEmpty icon={<Trash2 />} text="回收站是空的" />}</div>{action.error && <div className="form-error settings-inline-error">{messageOf(action.error)}</div>}{confirmation.dialog}</SettingsSection>
}

export function WorkspaceAudit({ workspaceId }: { workspaceId: string }) {
  const events = useInfiniteQuery({ queryKey: ['audit', workspaceId], initialPageParam: 0, queryFn: ({ pageParam }) => post<AuditEventPage>('/api/v1/audit/page', { workspaceId, limit: 30, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined })
  const values = events.data?.pages.flatMap((value) => value.items) ?? []
  return <SettingsSection icon={<Activity />} title="审计日志" description="重要管理、内容和安全操作按发生时间倒序保留。"><div className="audit-list">{values.map((event) => <article key={event.id}><span className={event.outcome === 'SUCCESS' ? 'success' : 'failure'}>{event.outcome === 'SUCCESS' ? <Shield /> : <Clock3 />}</span><div><strong>{auditLabel(event.action)}</strong><p>{event.resourceType}{event.resourceId ? ` · ${event.resourceId}` : ''}</p>{event.details && <small>{event.details}</small>}</div><time>{formatTime(event.occurredAt)}</time></article>)}{!events.isPending && !values.length && <SettingsEmpty icon={<Activity />} text="暂无审计事件" />}</div>{events.hasNextPage && <button className="button secondary settings-load-more" disabled={events.isFetchingNextPage} onClick={() => events.fetchNextPage()}>{events.isFetchingNextPage ? '加载中…' : '加载更多审计日志'}</button>}</SettingsSection>
}

function SettingsSection({ icon, title, description, action, children }: { icon: React.ReactNode; title: string; description: string; action?: React.ReactNode; children: React.ReactNode }) { return <section className="settings-section"><header><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div>{action}</header>{children}</section> }
function SettingsEmpty({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="settings-empty">{icon}<p>{text}</p></div> }
function workspaceRoleLabel(value: WorkspaceMember['role']) { return ({ OWNER: '所有者', ADMIN: '管理员', MEMBER: '成员', EXTERNAL: '外部联系人' })[value] }
function auditLabel(value: string) { return value.split('.').map((part) => part.replace(/_/g, ' ')).join(' / ') }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
function toSlug(value: string) { return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '') }
function submit(event: FormEvent, action: () => void) { event.preventDefault(); action() }
function isWorkspaceTab(value: string | null): value is WorkspaceTab { return value !== null && ['general', 'members', 'groups', 'teams', 'trash', 'audit'].includes(value) }
