import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArchiveX, Check, Clipboard, Clock3, ExternalLink, FileClock, FileKey2, Globe2, History,
  KeyRound, Link2, LoaderCircle, LockKeyhole, Paperclip, Plus, RefreshCw, Rocket, Save, Settings2,
  ShieldCheck, Tag, Trash2, Unlink, UploadCloud, Users, X,
} from 'lucide-react'
import { messageOf, post, upload } from '../lib/api'
import { documentSettingsClassNames, normalizeDocumentSettings } from '../lib/documentSettings'
import { safeMediaUrl } from '../lib/contentCards'
import type { Page, Team } from '../types'
import { PublicContentBody } from './SocialPages'
import type { UserGroup } from './WorkspaceSettings'
import { useConfirmDialog } from '../components/ConfirmDialog'

export type PageManagementTab = 'PROPERTIES' | 'PERMISSIONS' | 'ATTACHMENTS' | 'HISTORY' | 'PUBLISH' | 'SHARE'

interface PageHistory {
  id: string
  pageId: string
  revisionNo: number
  revisionKind: string
  description: string | null
  title: string
  content: unknown
  plainText: string
  schemaVersion: number
  createdBy: string
  createdAt: string
}

interface PageHistoryPage {
  items: PageHistory[]
  nextOffset: number
  hasMore: boolean
}

interface PublicationState {
  pageId: string
  draftRevision: number
  publicationId: string | null
  publishedDraftRevision: number | null
  published: boolean
  upToDate: boolean
  effectivePublishMode: 'MANUAL' | 'AUTO'
  automaticJobStatus: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null
}

interface PagePublication {
  id: string
  workspaceId: string
  knowledgeBaseId: string
  pageId: string
  sourceDraftRevision: number
  contentType: Page['contentType']
  title: string
  content: unknown
  plainText: string
  metadata: unknown
  schemaVersion: number
  publishedBy: string
  publishedAt: string
  supersededAt: string | null
}

interface PublicationHistoryPage {
  items: PagePublication[]
  nextOffset: number
  hasMore: boolean
}

export interface ShareView {
  id: string
  workspaceId: string
  resourceType: 'PAGE' | 'KNOWLEDGE_BASE' | 'QUICK_NOTE'
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
interface ShareAccessRequest { id: string; shareId: string; requesterId: string; requesterEmail: string; requesterDisplayName: string | null; policyVersion: number; message: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reviewedBy: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string }
interface AttachmentView { id: string; workspaceId: string; pageId: string | null; originalName: string; mediaType: string; sizeBytes: number; checksumSha256: string; uploadedBy: string; extractionStatus: 'EXTRACTED' | 'EMPTY' | 'UNSUPPORTED' | 'TOO_LARGE' | 'FAILED' | 'METADATA_ONLY'; extractedAt: string | null; createdAt: string; contentUrl: string }
interface PageLabel { id: string; name: string; color: string; position: number; createdBy: string; createdAt: string }
interface PageLabels { pageId: string; revision: number; labels: PageLabel[] }

export function PageManagement({
  page, initialTab = 'PROPERTIES', onClose, onUpdated, onTrashed,
}: {
  page: Page
  initialTab?: PageManagementTab
  onClose: () => void
  onUpdated: (page: Page, resetEditorBody?: boolean) => void
  onTrashed: () => void
}) {
  const [tab, setTab] = useState<PageManagementTab>(initialTab)
  const tabs: Array<{ id: PageManagementTab; label: string; icon: React.ReactNode }> = [
    { id: 'PROPERTIES', label: '文稿设置', icon: <Settings2 /> },
    { id: 'PERMISSIONS', label: '协作者权限', icon: <Users /> },
    { id: 'ATTACHMENTS', label: '附件管理', icon: <Paperclip /> },
    { id: 'HISTORY', label: '版本历史', icon: <History /> },
    { id: 'PUBLISH', label: '发布管理', icon: <Rocket /> },
    { id: 'SHARE', label: '分享链接', icon: <Link2 /> },
  ]
  return <div className="dialog-backdrop page-management-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="page-management" role="dialog" aria-modal="true" aria-label="文稿管理">
      <header><div><p className="eyebrow">文稿管理</p><h2>{page.icon || '📄'} {page.title}</h2><span>草稿版本 {page.draftRevision} · {contentTypeLabel(page.contentType)}</span></div><button className="icon-button" onClick={onClose} aria-label="关闭"><X /></button></header>
      <div className="page-management-layout">
        <nav>{tabs.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
        <main>
          {tab === 'PROPERTIES' && <PropertiesPanel page={page} onUpdated={onUpdated} onTrashed={onTrashed} />}
          {tab === 'PERMISSIONS' && <PermissionsPanel page={page} />}
          {tab === 'ATTACHMENTS' && <AttachmentsPanel page={page} />}
          {tab === 'HISTORY' && <HistoryPanel page={page} onUpdated={onUpdated} />}
          {tab === 'PUBLISH' && <PublicationPanel page={page} />}
          {tab === 'SHARE' && <SharesPanel page={page} />}
        </main>
      </div>
    </section>
  </div>
}

function AttachmentsPanel({ page }: { page: Page }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const targetId = new URLSearchParams(window.location.search).get('attachment')
  const targetRef = useRef<HTMLElement>(null)
  const attachments = useQuery({ queryKey: ['attachments', page.id], queryFn: () => post<AttachmentView[]>('/api/v1/attachments/list', { pageId: page.id }) })
  useEffect(() => { if (targetId && attachments.data?.some((item) => item.id === targetId)) window.requestAnimationFrame(() => targetRef.current?.scrollIntoView?.({ block: 'center' })) }, [attachments.data, targetId])
  const uploadAttachment = useMutation({
    mutationFn: async (file: File) => {
      if (!file.size) throw new Error('不能上传空文件')
      if (file.size > 50 * 1024 * 1024) throw new Error('单个附件不能超过 50 MB')
      const form = new FormData()
      form.append('pageId', page.id)
      form.append('file', file)
      return upload<AttachmentView>('/api/v1/attachments/upload', form)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', page.id] }),
  })
  const remove = useMutation({
    mutationFn: (attachmentId: string) => post<void>('/api/v1/attachments/delete', { attachmentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['attachments', page.id] }),
  })
  return <Panel title="附件管理" description="集中上传、下载和清理本页文件；图片、音频和视频也可从内容卡片直接上传。" icon={<Paperclip />}>
    <label className="attachment-upload-box">
      {uploadAttachment.isPending ? <LoaderCircle className="spin" /> : <UploadCloud />}
      <div><strong>{uploadAttachment.isPending ? '正在上传并校验…' : '上传附件'}</strong><p>选择任意文件，单个最大 50 MB。文件名会净化，内容会计算 SHA-256。</p></div>
      <span className="button secondary small">选择文件</span>
      <input type="file" disabled={uploadAttachment.isPending} onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadAttachment.mutate(file); event.currentTarget.value = '' }} />
    </label>
    <div className="attachment-list">{(attachments.data ?? []).map((attachment) => <article key={attachment.id} ref={attachment.id === targetId ? targetRef : undefined} className={attachment.id === targetId ? 'search-target' : ''}>
      <span className="attachment-type">{attachmentGlyph(attachment.mediaType)}</span>
      <div><strong>{attachment.originalName}</strong><small>{attachment.mediaType} · {formatBytes(attachment.sizeBytes)} · {formatDateTime(attachment.createdAt)} · {extractionLabel(attachment.extractionStatus)}</small><code title={attachment.checksumSha256}>SHA-256 {attachment.checksumSha256.slice(0, 16)}…</code></div>
      <a className="button quiet small" href={`${attachment.contentUrl}?download=true`}><ExternalLink />下载</a>
      <button className="icon-button danger" title="删除附件" aria-label={`删除附件 ${attachment.originalName}`} disabled={remove.isPending} onClick={() => confirmation.confirm({ title: `永久删除附件「${attachment.originalName}」`, description: '此操作无法恢复，文稿中现有的附件引用会失效。', confirmLabel: '永久删除' }, () => remove.mutate(attachment.id))}><Trash2 /></button>
    </article>)}{!attachments.isPending && !attachments.data?.length && <Empty icon={<Paperclip />} text="本页还没有附件" />}</div>
    {(attachments.error || uploadAttachment.error || remove.error) && <div className="form-error">{messageOf(attachments.error ?? uploadAttachment.error ?? remove.error)}</div>}
    {confirmation.dialog}
  </Panel>
}

type Capability = 'READ' | 'EDIT' | 'MANAGE' | 'COMMENT' | 'PUBLISH' | 'SHARE' | 'COPY' | 'DOWNLOAD' | 'EXPORT' | 'DELETE' | 'RESTORE' | 'MANAGE_PERMISSIONS' | 'VIEW_ANALYTICS'
interface AuthorizationDecision { workspaceId: string; resourceType: string; resourceId: string; capabilities: Capability[]; visibility: string; permissionVersion: number; sources: string[] }
interface AclEntry { id: string; workspaceId: string; resourceType: string; resourceId: string; subjectType: 'USER' | 'GROUP' | 'TEAM' | 'PUBLIC' | 'INVITE' | 'API_CLIENT'; subjectId: string | null; role: string | null; effect: 'ALLOW' | 'DENY'; capabilities: Capability[]; createdBy: string; createdAt: string; updatedAt: string }
interface WorkspaceMember { userId: string; email: string; displayName: string | null; role: string }

function PermissionsPanel({ page }: { page: Page }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const decision = useQuery({ queryKey: ['authorization-decision', 'PAGE', page.id], queryFn: () => post<AuthorizationDecision>('/api/v1/authorization/resolve', { resourceType: 'PAGE', resourceId: page.id }) })
  const canManage = decision.data?.capabilities.includes('MANAGE_PERMISSIONS') ?? false
  const entries = useQuery({ queryKey: ['authorization-entries', 'PAGE', page.id], queryFn: () => post<AclEntry[]>('/api/v1/authorization/list', { resourceType: 'PAGE', resourceId: page.id }), enabled: canManage })
  const members = useQuery({ queryKey: ['workspace-members', page.workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId: page.workspaceId }), enabled: canManage })
  const groups = useQuery({ queryKey: ['user-groups', page.workspaceId], queryFn: () => post<UserGroup[]>('/api/v1/user-groups/list', { workspaceId: page.workspaceId }), enabled: canManage })
  const teams = useQuery({ queryKey: ['teams', page.workspaceId], queryFn: () => post<Team[]>('/api/v1/teams/list', { workspaceId: page.workspaceId }), enabled: canManage })
  const [subjectType, setSubjectType] = useState<'USER' | 'GROUP' | 'TEAM' | 'PUBLIC'>('USER')
  const [subjectId, setSubjectId] = useState('')
  const [role, setRole] = useState<'READER' | 'EDITOR' | 'MANAGER'>('READER')
  const [effect, setEffect] = useState<'ALLOW' | 'DENY'>('ALLOW')
  const refresh = async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: ['authorization-decision', 'PAGE', page.id] }), queryClient.invalidateQueries({ queryKey: ['authorization-entries', 'PAGE', page.id] })]) }
  const grant = useMutation({
    mutationFn: () => post<AclEntry>('/api/v1/authorization/grant', { resourceType: 'PAGE', resourceId: page.id, subjectType, subjectId: subjectType === 'PUBLIC' ? null : subjectId, role, effect, capabilities: [] }),
    onSuccess: async () => { setSubjectId(''); await refresh() },
  })
  const revoke = useMutation({ mutationFn: (aclEntryId: string) => post<void>('/api/v1/authorization/revoke', { aclEntryId }), onSuccess: refresh })
  const memberById = new Map((members.data ?? []).map((member) => [member.userId, member]))
  const groupById = new Map((groups.data ?? []).map((group) => [group.id, group]))
  const teamById = new Map((teams.data ?? []).map((team) => [team.id, team]))
  const principalName = (entry: AclEntry) => entry.subjectType === 'PUBLIC' ? '任何人' : entry.subjectType === 'USER' ? memberById.get(entry.subjectId ?? '')?.displayName || memberById.get(entry.subjectId ?? '')?.email || '已离开空间的用户' : entry.subjectType === 'GROUP' ? groupById.get(entry.subjectId ?? '')?.name || '已删除的用户组' : entry.subjectType === 'TEAM' ? teamById.get(entry.subjectId ?? '')?.name || '已删除的团队' : `${entry.subjectType} · ${entry.subjectId}`
  return <Panel title="协作者权限" description="查看继承来源和最终能力，并为用户、用户组、团队或所有人设置文稿级覆盖。" icon={<Users />}>
    <div className="permission-explain"><div><strong>当前访问能力</strong><span className="status-pill success">权限版本 {decision.data?.permissionVersion ?? '—'}</span></div><div className="capability-cloud">{(decision.data?.capabilities ?? []).map((capability) => <span key={capability}>{capabilityLabel(capability)}</span>)}{!decision.isPending && !decision.data?.capabilities.length && <small>无有效能力</small>}</div><div className="permission-sources"><strong>计算来源</strong>{(decision.data?.sources ?? []).map((source) => <code key={source}>{sourceLabel(source)}</code>)}</div></div>
    {canManage ? <>
      <div className="acl-grant-row"><select value={subjectType} onChange={(event) => { setSubjectType(event.target.value as typeof subjectType); setSubjectId('') }}><option value="USER">指定用户</option><option value="GROUP">指定用户组</option><option value="TEAM">指定团队</option><option value="PUBLIC">任何人</option></select>{subjectType === 'USER' && <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">选择空间成员…</option>{(members.data ?? []).map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email} · {member.role}</option>)}</select>}{subjectType === 'GROUP' && <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">选择用户组…</option>{(groups.data ?? []).map((group) => <option key={group.id} value={group.id}>{group.name} · {group.memberCount} 人</option>)}</select>}{subjectType === 'TEAM' && <select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}><option value="">选择团队…</option>{(teams.data ?? []).map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select>}{subjectType === 'PUBLIC' && <div className="acl-public-subject"><Globe2 />所有访问者</div>}<select value={role} onChange={(event) => setRole(event.target.value as typeof role)}><option value="READER">只读</option><option value="EDITOR">可编辑</option><option value="MANAGER">管理者</option></select><select className={effect === 'DENY' ? 'danger' : ''} value={effect} onChange={(event) => setEffect(event.target.value as typeof effect)}><option value="ALLOW">允许</option><option value="DENY">拒绝</option></select><button className="button primary small" disabled={grant.isPending || (subjectType !== 'PUBLIC' && !subjectId)} onClick={() => { const highRisk = subjectType === 'PUBLIC' || effect === 'DENY' || role === 'MANAGER'; if (!highRisk) grant.mutate(); else confirmation.confirm({ title: '保存高影响文稿权限', description: '这项设置会明显改变文稿的访问或管理范围，保存后立即生效。', confirmLabel: '保存权限', tone: 'primary' }, () => grant.mutate()) }}><ShieldCheck />保存</button></div>
      <div className="acl-entry-list">{(entries.data ?? []).map((entry) => <article key={entry.id}><span className={`acl-effect ${entry.effect.toLowerCase()}`}>{entry.effect === 'ALLOW' ? <Check /> : <ArchiveX />}</span><div><strong>{principalName(entry)}</strong><small>{subjectTypeLabel(entry.subjectType)} · {entry.effect === 'ALLOW' ? '允许' : '拒绝'} {roleLabel(entry.role)}{entry.capabilities.length ? ` · ${entry.capabilities.map(capabilityLabel).join('、')}` : ''}</small></div><time>{formatDateTime(entry.updatedAt)}</time><button className="icon-button danger" disabled={revoke.isPending} onClick={() => confirmation.confirm({ title: `移除「${principalName(entry)}」的文稿级权限`, description: '移除后会立即回到空间、团队和知识库继承权限的计算结果。', confirmLabel: '移除权限' }, () => revoke.mutate(entry.id))} title="移除覆盖" aria-label={`移除 ${principalName(entry)} 的文稿级权限`}><Trash2 /></button></article>)}{!entries.isPending && !entries.data?.length && <Empty icon={<Users />} text="没有文稿级覆盖，当前完全继承上级权限。" />}</div>
    </> : !decision.isPending && <div className="permission-readonly"><LockKeyhole /><div><strong>你可以查看最终权限，但不能修改</strong><p>需要“管理权限”能力才能新增或撤销文稿级协作者。</p></div></div>}
    {(decision.error || entries.error || members.error || groups.error || teams.error || grant.error || revoke.error) && <div className="form-error">{messageOf(decision.error ?? entries.error ?? members.error ?? groups.error ?? teams.error ?? grant.error ?? revoke.error)}</div>}
    {confirmation.dialog}
  </Panel>
}

function PropertiesPanel({ page, onUpdated, onTrashed }: { page: Page; onUpdated: (page: Page) => void; onTrashed: () => void }) {
  const confirmation = useConfirmDialog()
  const initialDocumentSettings = normalizeDocumentSettings(page.documentSettings)
  const [draft, setDraft] = useState(() => ({
    title: page.title,
    path: page.path,
    icon: page.icon ?? '',
    cover: page.cover ?? '',
    publishMode: page.publishMode,
    visibilityOverride: page.visibilityOverride,
    documentSettings: initialDocumentSettings,
  }))
  const parsedCover = safeMediaUrl(draft.cover)
  const safeCover = parsedCover?.startsWith('https://') ? parsedCover : ''
  const coverInvalid = Boolean(draft.cover && !safeCover)
  const [saved, setSaved] = useState(false)
  const update = useMutation({
    mutationFn: () => post<Page>('/api/v1/pages/update', {
      pageId: page.id,
      expectedRevision: page.draftRevision,
      title: draft.title,
      path: draft.path,
      icon: draft.icon,
      cover: safeCover,
      publishMode: draft.publishMode,
      visibilityOverride: draft.visibilityOverride,
      documentSettings: draft.documentSettings,
      revisionKind: 'MANUAL',
      revisionDescription: '更新文稿设置',
    }),
    onSuccess: (value) => { setSaved(true); onUpdated(value); window.setTimeout(() => setSaved(false), 2_000) },
  })
  const trash = useMutation({
    mutationFn: () => post<void>('/api/v1/pages/trash', { pageId: page.id }),
    onSuccess: onTrashed,
  })
  return <Panel title="文稿设置" description="控制路径、标签、封面、发布方式和本页可见范围。" icon={<Settings2 />}>
    <div className="page-settings-grid">
      <Field label="标题"><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></Field>
      <Field label="访问路径"><span className="prefixed-input"><i>/</i><input value={draft.path} onChange={(event) => setDraft({ ...draft, path: slugify(event.target.value) })} /></span></Field>
      <Field label="图标"><input maxLength={2_000} value={draft.icon} onChange={(event) => setDraft({ ...draft, icon: event.target.value })} placeholder="📄 或图片 URL" /></Field>
      <Field label="封面"><input type="url" maxLength={2_000} value={draft.cover} onChange={(event) => setDraft({ ...draft, cover: event.target.value })} placeholder="https://example.com/cover.jpg" />{coverInvalid && <span className="form-error" role="alert">请输入不含账号凭据的 HTTPS 图片地址</span>}</Field>
      <Field label="发布方式"><select value={draft.publishMode} onChange={(event) => setDraft({ ...draft, publishMode: event.target.value })}><option value="INHERIT">继承知识库</option><option value="MANUAL">手动发布</option><option value="AUTO">自动发布</option></select></Field>
      <Field label="可见范围"><select value={draft.visibilityOverride} onChange={(event) => setDraft({ ...draft, visibilityOverride: event.target.value })}><option value="INHERIT">继承知识库</option><option value="PRIVATE">私密</option><option value="WORKSPACE">空间成员</option><option value="PUBLIC">公开</option></select></Field>
      <Field label="页面宽度"><select value={draft.documentSettings.pageWidth} onChange={(event) => setDraft({ ...draft, documentSettings: { ...draft.documentSettings, pageWidth: event.target.value as typeof draft.documentSettings.pageWidth } })}><option value="STANDARD">标准版 · 聚焦阅读</option><option value="WIDE">宽版 · 展示更多内容</option></select></Field>
      <Field label="正文字体"><select value={draft.documentSettings.fontFamily} onChange={(event) => setDraft({ ...draft, documentSettings: { ...draft.documentSettings, fontFamily: event.target.value as typeof draft.documentSettings.fontFamily } })}><option value="SERIF">衬线 · 适合长文</option><option value="SANS">无衬线 · 清晰现代</option></select></Field>
      <Field label="字体大小"><select value={draft.documentSettings.fontSize} onChange={(event) => setDraft({ ...draft, documentSettings: { ...draft.documentSettings, fontSize: event.target.value as typeof draft.documentSettings.fontSize } })}><option value="SMALL">小</option><option value="MEDIUM">标准</option><option value="LARGE">大</option></select></Field>
      <Field label="段落间距"><select value={draft.documentSettings.paragraphSpacing} onChange={(event) => setDraft({ ...draft, documentSettings: { ...draft.documentSettings, paragraphSpacing: event.target.value as typeof draft.documentSettings.paragraphSpacing } })}><option value="COMPACT">紧凑</option><option value="NORMAL">标准</option><option value="RELAXED">宽松</option></select></Field>
      <label className="document-outline-setting"><input type="checkbox" checked={draft.documentSettings.showOutline} onChange={(event) => setDraft({ ...draft, documentSettings: { ...draft.documentSettings, showOutline: event.target.checked } })} /><span><strong>显示文稿大纲</strong><small>文稿包含两个以上标题时，在编辑页与发布阅读页显示可折叠大纲。</small></span><i /></label>
      <div className={`document-style-preview ${documentSettingsClassNames(draft.documentSettings)}`}><small>阅读效果预览</small><strong>让知识自然地生长</strong><p>字体、字号、段落间距和页面宽度会同时作用于编辑器与发布后的阅读页。</p></div>
    </div>
    <PageLabelsEditor pageId={page.id} />
    {update.error && <div className="form-error">{messageOf(update.error)}</div>}
    <div className="panel-actions"><button className="button primary" disabled={!draft.title.trim() || !draft.path || coverInvalid || update.isPending} onClick={() => update.mutate()}>{update.isPending ? <LoaderCircle className="spin" /> : saved ? <Check /> : <Save />}{saved ? '已保存' : '保存设置'}</button></div>
    <div className="page-danger-zone"><div><strong>移入回收站</strong><p>文稿会从目录和搜索结果中隐藏，之后仍可由空间管理员恢复。</p></div><button className="button danger" disabled={trash.isPending} onClick={() => confirmation.confirm({ title: `将「${page.title}」移入回收站`, description: '文稿会从目录和搜索结果中隐藏，空间管理员之后可以恢复。', confirmLabel: '移入回收站' }, () => trash.mutate())}><Trash2 />移入回收站</button></div>
    {trash.error && <div className="form-error">{messageOf(trash.error)}</div>}
    {confirmation.dialog}
  </Panel>
}

export function PageLabelsEditor({ pageId }: { pageId: string }) {
  const labels = useQuery({ queryKey: ['page-labels', pageId], queryFn: () => post<PageLabels>('/api/v1/pages/labels', { pageId }) })
  if (labels.isPending) return <div className="page-labels-loading"><LoaderCircle className="spin" />正在读取标签…</div>
  if (labels.error || !labels.data) return <div className="form-error">{messageOf(labels.error)}</div>
  return <PageLabelsForm key={labels.data.revision} value={labels.data} />
}

function PageLabelsForm({ value }: { value: PageLabels }) {
  const queryClient = useQueryClient()
  const [items, setItems] = useState(() => value.labels.map((label) => ({ name: label.name, color: label.color })))
  const [name, setName] = useState('')
  const [color, setColor] = useState('#5A8F6B')
  const save = useMutation({
    mutationFn: () => post<PageLabels>('/api/v1/pages/labels/update', { pageId: value.pageId, expectedRevision: value.revision, labels: items }),
    onSuccess: (next) => queryClient.setQueryData(['page-labels', value.pageId], next),
  })
  const add = () => {
    const label = name.trim()
    if (!label || items.length >= 20 || items.some((item) => item.name.localeCompare(label, 'zh-CN', { sensitivity: 'accent' }) === 0)) return
    setItems((current) => [...current, { name: label.slice(0, 50), color }])
    setName('')
  }
  return <section className="page-label-editor" aria-label="文稿标签">
    <header><div><Tag /><span><strong>文稿标签</strong><small>标签参与内部与公开搜索；最多 20 个。</small></span></div><i>{items.length}/20</i></header>
    <div className="page-label-list">{items.map((label, index) => <span key={`${label.name}-${index}`} style={{ '--label-color': label.color } as React.CSSProperties}><i />{label.name}<button type="button" aria-label={`移除标签 ${label.name}`} onClick={() => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></button></span>)}{!items.length && <small>还没有标签</small>}</div>
    <div className="page-label-create"><input type="color" aria-label="标签颜色" value={color} onChange={(event) => setColor(event.target.value.toUpperCase())} /><input aria-label="新标签名称" value={name} maxLength={50} placeholder="输入标签名称" onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); add() } }} /><button type="button" className="button secondary small" disabled={!name.trim() || items.length >= 20} onClick={add}><Plus />添加</button><button type="button" className="button primary small" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? <LoaderCircle className="spin" /> : <Save />}{save.isSuccess ? '已保存' : '保存标签'}</button></div>
    {save.error && <div className="form-error">{messageOf(save.error)}</div>}
  </section>
}

export function HistoryPanel({ page, onUpdated }: { page: Page; onUpdated: (page: Page, resetEditorBody: boolean) => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [preview, setPreview] = useState<PageHistory | null>(null)
  const [comparison, setComparison] = useState<PageHistory | null>(null)
  const [copySource, setCopySource] = useState<PageHistory | null>(null)
  const [manualDescription, setManualDescription] = useState('')
  const history = useInfiniteQuery({
    queryKey: ['page-history', page.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<PageHistoryPage>('/api/v1/pages/history/page', { pageId: page.id, limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
  })
  const revisions = history.data?.pages.flatMap((value) => value.items) ?? []
  const restore = useMutation({
    mutationFn: (revision: PageHistory) => post<Page>('/api/v1/pages/update', {
      pageId: page.id,
      expectedRevision: page.draftRevision,
      title: revision.title,
      content: revision.content,
      schemaVersion: revision.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: `恢复自版本 ${revision.revisionNo}`,
    }),
    onSuccess: async (value) => { onUpdated(value, true); await queryClient.invalidateQueries({ queryKey: ['page-history', page.id] }) },
  })
  const saveManual = useMutation({
    mutationFn: () => post<Page>('/api/v1/pages/update', {
      pageId: page.id,
      expectedRevision: page.draftRevision,
      title: page.title,
      content: page.content,
      schemaVersion: page.schemaVersion,
      revisionKind: 'MANUAL',
      revisionDescription: manualDescription.trim() || '手动保存版本',
    }),
    onSuccess: async (value) => {
      setManualDescription('')
      onUpdated(value, false)
      await queryClient.invalidateQueries({ queryKey: ['page-history', page.id] })
    },
  })
  return <Panel title="版本历史" description="恢复会创建一个新的手工版本，原有历史不会被覆盖。" icon={<FileClock />}>
    <section className="manual-version-save" aria-label="保存手工版本"><div><strong>保存当前版本</strong><p>为当前草稿生成一个不会被自动保存覆盖的版本节点，可填写本次改动说明。</p></div><input aria-label="版本说明" maxLength={500} value={manualDescription} onChange={(event) => setManualDescription(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !saveManual.isPending) { event.preventDefault(); saveManual.mutate() } }} placeholder="例如：评审通过的正式稿（可选）" /><button className="button primary small" disabled={saveManual.isPending} onClick={() => saveManual.mutate()}>{saveManual.isPending ? <LoaderCircle className="spin" /> : <Save />}{saveManual.isPending ? '保存中…' : '保存版本'}</button></section>
    {saveManual.isSuccess && <div className="inline-success"><Check />已保存为手工版本 v{saveManual.data.draftRevision}</div>}
    <div className="page-history-list">{revisions.map((revision) => <article key={revision.id}><span className="revision-number">v{revision.revisionNo}</span><div><strong>{revision.title}</strong><p>{revision.plainText || '空白内容'}</p><small>{revisionKindLabel(revision.revisionKind)} · {formatDateTime(revision.createdAt)}{revision.description ? ` · ${revision.description}` : ''}</small></div><div className="page-history-actions"><button className="button quiet small" aria-label={`预览版本 ${revision.revisionNo}`} onClick={() => setPreview(revision)}><ExternalLink />预览</button><button className="button quiet small" aria-label={`与当前稿对比版本 ${revision.revisionNo}`} onClick={() => setComparison(revision)}><ArchiveX />对比</button><button className="button quiet small" aria-label={`基于版本 ${revision.revisionNo} 创建副本`} onClick={() => setCopySource(revision)}><Clipboard />副本</button><button className="button secondary small" disabled={restore.isPending || revision.revisionNo === page.draftRevision} onClick={() => confirmation.confirm({ title: `恢复到版本 ${revision.revisionNo}`, description: '当前内容会先保留为历史版本，恢复会创建一个新的手工版本。', confirmLabel: '恢复此版本', tone: 'primary' }, () => restore.mutate(revision))}><RefreshCw />恢复</button></div></article>)}{!history.isPending && !revisions.length && <Empty icon={<History />} text="还没有可查看的历史版本" />}</div>
    {history.hasNextPage && <div className="panel-actions"><button className="button secondary" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? '加载中…' : '加载更多历史版本'}</button></div>}
    {history.error && <div className="form-error">{messageOf(history.error)}</div>}{(restore.error || saveManual.error) && <div className="form-error">{messageOf(restore.error ?? saveManual.error)}</div>}
    {preview && <HistoryPreviewDialog page={page} value={preview} onClose={() => setPreview(null)} />}
    {comparison && <HistoryCompareDialog page={page} value={comparison} onClose={() => setComparison(null)} />}
    {copySource && <HistoryCopyDialog page={page} value={copySource} onClose={() => setCopySource(null)} />}
    {confirmation.dialog}
  </Panel>
}

function HistoryPreviewDialog({ page, value, onClose }: { page: Page; value: PageHistory; onClose: () => void }) {
  const cover = safePresentationUrl(page.cover)
  const icon = safePresentationUrl(page.icon)
  return <div className="nested-dialog-backdrop publication-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="publication-preview history-preview" role="dialog" aria-modal="true" aria-label={`预览历史版本 ${value.revisionNo}`}>
    <header><div><p className="eyebrow">不可变草稿快照 · v{value.revisionNo}</p><h2>{value.title}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭历史预览"><X /></button></header>
    <article className={`public-reader ${documentSettingsClassNames(page.documentSettings)}`}><header>{cover && <img src={cover} alt="" referrerPolicy="no-referrer" />}<span className="reader-page-icon">{icon ? <img src={icon} alt="" referrerPolicy="no-referrer" /> : page.icon || '📄'}</span><h1>{value.title}</h1><small>{revisionKindLabel(value.revisionKind)} · {formatDateTime(value.createdAt)}</small></header><PublicContentBody reader={{ content: value.content, plainText: value.plainText, documentSettings: page.documentSettings, metadata: { contentType: page.contentType } }} /></article>
  </section></div>
}

function HistoryCompareDialog({ page, value, onClose }: { page: Page; value: PageHistory; onClose: () => void }) {
  const previous = historyLines(value.plainText)
  const current = historyLines(page.plainText)
  const rows = Array.from({ length: Math.max(previous.length, current.length) }, (_, index) => ({ previous: previous[index] ?? '', current: current[index] ?? '' }))
  const changed = rows.filter((row) => row.previous !== row.current).length
  return <div className="nested-dialog-backdrop publication-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="history-compare" role="dialog" aria-modal="true" aria-label={`对比历史版本 ${value.revisionNo} 与当前稿`}>
    <header><div><p className="eyebrow">版本对比</p><h2>v{value.revisionNo} 与当前草稿 v{page.draftRevision}</h2><small>{changed ? `${changed} 行发生变化` : '正文内容没有变化'}</small></div><button className="icon-button" onClick={onClose} aria-label="关闭版本对比"><X /></button></header>
    <div className="history-compare-head"><strong>历史 v{value.revisionNo} · {value.title}</strong><strong>当前 v{page.draftRevision} · {page.title}</strong></div>
    <div className="history-compare-grid">{rows.map((row, index) => { const same = row.previous === row.current; return <div className={same ? 'same' : 'changed'} key={index}><pre><i>{index + 1}</i>{row.previous || ' '}</pre><pre><i>{index + 1}</i>{row.current || ' '}</pre></div> })}</div>
  </section></div>
}

function HistoryCopyDialog({ page, value, onClose }: { page: Page; value: PageHistory; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(`${value.title}（副本）`.slice(0, 500))
  const [path, setPath] = useState(() => historyCopyPath(page.path, value.revisionNo))
  const copy = useMutation({
    mutationFn: () => post<Page>('/api/v1/pages/history/copy', { pageId: page.id, revisionNo: value.revisionNo, title, path }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pages', page.knowledgeBaseId] }),
  })
  const created = copy.data
  return <div className="nested-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog history-copy-dialog" role="dialog" aria-modal="true" aria-label={`基于版本 ${value.revisionNo} 创建副本`}>
    <div className="dialog-head"><div><p className="eyebrow">历史副本 · v{value.revisionNo}</p><h2>{created ? '副本已经创建' : '创建独立文稿副本'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭创建副本"><X /></button></div>
    {created ? <div className="history-copy-success"><Check /><div><strong>{created.title}</strong><p>副本使用历史快照创建，发布、分享和文稿级权限不会从原文继承。</p><a className="button primary" href={`/app/kb/${created.knowledgeBaseId}/pages/${created.id}`}>打开副本<ExternalLink /></a></div></div> : <><p className="form-note">正文来自不可变历史快照；新文稿会继承知识库权限，但不会复制旧分享链接和发布状态。</p><label className="field"><span className="field-label">副本标题</span><input autoFocus aria-label="副本标题" maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span className="field-label">访问路径</span><span className="prefixed-input"><i>/</i><input aria-label="副本访问路径" maxLength={180} value={path} onChange={(event) => setPath(slugify(event.target.value))} /></span></label>{copy.error && <div className="form-error">{messageOf(copy.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || !path || copy.isPending} onClick={() => copy.mutate()}>{copy.isPending ? <LoaderCircle className="spin" /> : <Clipboard />}{copy.isPending ? '正在创建…' : '创建副本'}</button></div></>}
  </section></div>
}

function historyLines(value: string) { return value ? value.replace(/\r\n?/g, '\n').split('\n') : [''] }
function historyCopyPath(value: string, revisionNo: number) { const suffix = `-v${revisionNo}-copy`; const base = value.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '') || 'page'; return `${base}${suffix}` }

export function PublicationPanel({ page }: { page: Page }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [preview, setPreview] = useState<PagePublication | null>(null)
  const stateKey = ['publication-state', page.id]
  const historyKey = ['publication-history', page.id]
  const state = useQuery({
    queryKey: stateKey,
    queryFn: async () => {
      const previous = queryClient.getQueryData<PublicationState>(stateKey)
      const next = await post<PublicationState>('/api/v1/pages/publication-state', { pageId: page.id })
      if (previous && !previous.upToDate && next.upToDate) void queryClient.invalidateQueries({ queryKey: historyKey })
      return next
    },
    refetchInterval: (query) => automaticPublishing(query.state.data) ? 1_000 : false,
  })
  const history = useInfiniteQuery({
    queryKey: historyKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<PublicationHistoryPage>('/api/v1/pages/publication-history/page', { pageId: page.id, limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
  })
  const publicationHistory = history.data?.pages.flatMap((value) => value.items) ?? []
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['publication-state', page.id] }),
      queryClient.invalidateQueries({ queryKey: ['publication-history', page.id] }),
      queryClient.invalidateQueries({ queryKey: ['page', page.id] }),
    ])
  }
  const publish = useMutation({ mutationFn: () => post<PagePublication>(state.data?.published ? '/api/v1/pages/republish' : '/api/v1/pages/publish', { pageId: page.id, idempotencyKey: `web-${page.id}-${page.draftRevision}-${crypto.randomUUID()}` }), onSuccess: refresh })
  const unpublish = useMutation({ mutationFn: () => post<void>('/api/v1/pages/unpublish', { pageId: page.id }), onSuccess: refresh })
  const value = state.data
  const automaticBusy = automaticPublishing(value)
  const automaticFailed = value?.effectivePublishMode === 'AUTO' && value.automaticJobStatus === 'FAILED'
  const stateTitle = automaticBusy ? value?.automaticJobStatus === 'RUNNING' ? '正在自动发布' : '等待自动发布' : automaticFailed ? '自动发布失败' : value?.published ? value.upToDate ? '线上版本已是最新' : '草稿有尚未发布的更新' : '尚未发布'
  const stateText = automaticBusy ? `系统将在防抖窗口结束后发布草稿版本 ${value?.draftRevision}，连续编辑只保留最新版本。` : automaticFailed ? '后台任务已达到重试上限；可以立即手动发布，或在再次编辑后重新排队。' : value?.published ? `线上来自草稿版本 ${value.publishedDraftRevision}，当前草稿版本 ${value.draftRevision}` : '发布后可用于公开阅读、知识花园和分享链接。'
  return <Panel title="发布管理" description="发布的是不可变快照；后续编辑草稿不会悄悄改变线上内容。" icon={<Rocket />}>
    <div className={`publication-state-card ${value?.published ? 'published' : ''} ${automaticBusy ? 'automatic-pending' : ''} ${automaticFailed ? 'automatic-failed' : ''}`} role="status" aria-live="polite" aria-atomic="true"><span>{automaticBusy ? <LoaderCircle className="spin" /> : automaticFailed ? <ArchiveX /> : value?.published ? <Globe2 /> : <Archive />}</span><div><strong>{stateTitle}</strong><p>{stateText}</p></div>{value?.publicationId && <a className="button secondary small" href={`/p/${value.publicationId}`} target="_blank" rel="noreferrer">查看线上版<ExternalLink /></a>}</div>
    <div className="publication-actions"><button className="button primary" disabled={publish.isPending || automaticBusy || (value?.published && value.upToDate)} onClick={() => publish.mutate()}>{publish.isPending || automaticBusy ? <LoaderCircle className="spin" /> : <Rocket />}{automaticBusy ? '自动发布排队中' : value?.published ? '发布最新草稿' : '立即发布'}</button>{value?.published && <button className="button danger" disabled={unpublish.isPending} onClick={() => confirmation.confirm({ title: '下线当前发布版本', description: '下线后，公开阅读和现有分享链接将不可访问；发布历史仍会保留。', confirmLabel: '确认下线' }, () => unpublish.mutate())}><Unlink />下线</button>}</div>
    {(publish.error || unpublish.error || state.error) && <div className="form-error" role="alert">{messageOf(publish.error ?? unpublish.error ?? state.error)}</div>}
    <h3 className="subsection-title"><Clock3 />发布历史</h3><div className="publication-history">{publicationHistory.map((revision) => <article key={revision.id}><span>{revision.supersededAt ? '历史' : '当前'}</span><div><strong>{revision.title}</strong><small>草稿 v{revision.sourceDraftRevision} · {formatDateTime(revision.publishedAt)}</small></div><button className="icon-button" onClick={() => setPreview(revision)} title={`预览发布版本 ${revision.sourceDraftRevision}`} aria-label={`预览发布版本 ${revision.sourceDraftRevision}`}><ExternalLink /></button></article>)}{!history.isPending && !publicationHistory.length && <Empty icon={<Globe2 />} text="尚无发布记录" />}</div>
    {history.hasNextPage && <div className="panel-actions"><button className="button secondary" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? '加载中…' : '加载更多发布历史'}</button></div>}
    {preview && <PublicationPreview value={preview} onClose={() => setPreview(null)} />}
    {confirmation.dialog}
  </Panel>
}

function automaticPublishing(value: PublicationState | undefined) { return value?.effectivePublishMode === 'AUTO' && (value.automaticJobStatus === 'PENDING' || value.automaticJobStatus === 'RUNNING') }

function PublicationPreview({ value, onClose }: { value: PagePublication; onClose: () => void }) {
  const metadata = asRecord(value.metadata)
  const icon = typeof metadata?.icon === 'string' ? metadata.icon : ''
  const cover = safePresentationUrl(typeof metadata?.cover === 'string' ? metadata.cover : '')
  return <div className="nested-dialog-backdrop publication-preview-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="publication-preview" role="dialog" aria-modal="true" aria-label={`预览 ${value.title}`}>
    <header><div><p className="eyebrow">发布快照 · 草稿 v{value.sourceDraftRevision}</p><h2>历史版本预览</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭预览"><X /></button></header>
    <article className={`public-reader ${documentSettingsClassNames(metadata?.documentSettings)}`}>
      {cover && <div className="reader-page-cover" style={{ backgroundImage: `url("${cover}")` }} />}
      <header>{icon && <span className="reader-page-icon">{safePresentationUrl(icon) ? <img src={safePresentationUrl(icon)!} alt="" /> : icon}</span>}<span className="content-type-chip">{contentTypeLabel(value.contentType)}</span><h1>{value.title}</h1><small>{formatDateTime(value.publishedAt)} 发布 · schema v{value.schemaVersion}</small></header>
      <PublicContentBody reader={{ content: value.content, plainText: value.plainText, metadata: { contentType: value.contentType }, documentSettings: metadata?.documentSettings }} />
    </article>
  </section></div>
}

function SharesPanel({ page }: { page: Page }) {
  return <Panel title="分享链接" description="每个链接可独立设置密码、有效期和访问能力；令牌只会显示一次。" icon={<FileKey2 />}><ShareManager resourceType="PAGE" resourceId={page.id} resourceName={page.title} /></Panel>
}

export function ShareManager({ resourceType, resourceId, resourceName }: { resourceType: ShareView['resourceType']; resourceId: string; resourceName: string }) {
  const queryClient = useQueryClient()
  const [createOpen, setCreateOpen] = useState(false)
  const [issued, setIssued] = useState<string | null>(null)
  const queryKey = ['shares', resourceType, resourceId]
  const shares = useQuery({ queryKey, queryFn: () => post<ShareView[]>('/api/v1/shares/list', { resourceType, resourceId }) })
  const refresh = () => queryClient.invalidateQueries({ queryKey })
  return <div className={`share-manager resource-${resourceType.toLowerCase()}`}>
    <div className="share-toolbar"><div><strong>{shares.data?.length ?? 0} 个有效链接</strong><p>{resourceType === 'KNOWLEDGE_BASE' ? '访问者可浏览目录中的已发布文稿；文稿私密覆盖仍然生效。' : resourceType === 'QUICK_NOTE' ? '每条链接固定保存创建时的小记快照，后续编辑不会改变已分享内容。' : '修改或撤销一个链接不会影响其他链接。'}</p></div><button className="button primary small" onClick={() => setCreateOpen(true)}><Link2 />新建链接</button></div>
    {issued && <IssuedLink value={issued} onClose={() => setIssued(null)} />}
    <div className="managed-share-list">{(shares.data ?? []).map((share) => <ManagedShare key={`${share.id}-${share.policyVersion}`} value={share} onChanged={refresh} onIssued={(token) => setIssued(shareUrl(token))} />)}{!shares.isPending && !shares.data?.length && <Empty icon={<KeyRound />} text={resourceType === 'QUICK_NOTE' ? '还没有分享链接。新链接会保存当前版本的只读快照。' : '还没有分享链接。文稿需先发布，才能创建分享。'} />}</div>
    {shares.error && <div className="form-error">{messageOf(shares.error)}</div>}
    {createOpen && <CreateShareDialog resourceType={resourceType} resourceId={resourceId} resourceName={resourceName} onClose={() => setCreateOpen(false)} onCreated={async (value) => { setIssued(shareUrl(value.token)); setCreateOpen(false); await refresh() }} />}
  </div>
}

function CreateShareDialog({ resourceType, resourceId, resourceName, onClose, onCreated }: { resourceType: ShareView['resourceType']; resourceId: string; resourceName: string; onClose: () => void; onCreated: (value: CreatedShare) => void }) {
  const quickNote = resourceType === 'QUICK_NOTE'
  const [draft, setDraft] = useState({ shareType: 'PUBLIC' as ShareView['shareType'], password: '', role: 'READER' as ShareView['role'], expiresAt: '', requireApproval: false, allowCopy: true, allowDownload: false, allowExport: false, allowSearchIndex: false })
  const create = useMutation({
    mutationFn: () => post<CreatedShare>('/api/v1/shares/create', { resourceType, resourceId, shareType: draft.shareType, password: draft.password || null, role: draft.role, requireApproval: draft.requireApproval, expiresAt: toIso(draft.expiresAt), allowCopy: draft.allowCopy, allowDownload: draft.allowDownload, allowExport: draft.allowExport, allowComment: draft.role === 'COMMENTER' || draft.role === 'EDITOR', allowSearchIndex: draft.shareType === 'PUBLIC' && draft.allowSearchIndex }),
    onSuccess: onCreated,
  })
  return <div className="nested-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog share-create-dialog"><div className="dialog-head"><div><p className="eyebrow">新建 · {resourceType === 'KNOWLEDGE_BASE' ? '知识库' : quickNote ? '小记快照' : '文稿'}</p><h2>分享“{resourceName}”</h2></div><button className="icon-button" onClick={onClose}><X /></button></div><div className={`share-type-tabs ${quickNote ? 'single' : ''}`}><button className={draft.shareType === 'PUBLIC' ? 'active' : ''} onClick={() => setDraft({ ...draft, shareType: 'PUBLIC', role: draft.role === 'EDITOR' || quickNote ? 'READER' : draft.role })}><Globe2 />公开访问<small>{quickNote ? '固定当前版本，可加密码或审批' : '无需登录，可加密码或审批'}</small></button>{!quickNote && <button className={draft.shareType === 'INVITE_LINK' ? 'active' : ''} onClick={() => setDraft({ ...draft, shareType: 'INVITE_LINK', allowSearchIndex: false })}><Users />邀请链接<small>登录后加入并获得持久权限</small></button>}</div><div className="share-form-grid"><Field label="访问角色"><select value={quickNote ? 'READER' : draft.role} disabled={quickNote} onChange={(event) => setDraft({ ...draft, role: event.target.value as ShareView['role'] })}><option value="READER">只读</option>{!quickNote && <option value="COMMENTER">可评论</option>}{!quickNote && draft.shareType === 'INVITE_LINK' && <option value="EDITOR">可编辑</option>}</select></Field><Field label="失效时间（可选）"><input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></Field><Field label="访问密码（可选，至少 8 位）" wide><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder="留空表示无需密码" /></Field><Toggle label="需要所有者审批" checked={draft.requireApproval} onChange={(requireApproval) => setDraft({ ...draft, requireApproval })} /><Toggle label="允许复制" checked={draft.allowCopy} onChange={(allowCopy) => setDraft({ ...draft, allowCopy })} /><Toggle label="允许下载" checked={draft.allowDownload} onChange={(allowDownload) => setDraft({ ...draft, allowDownload })} /><Toggle label="允许导出" checked={draft.allowExport} onChange={(allowExport) => setDraft({ ...draft, allowExport })} />{!quickNote && draft.shareType === 'PUBLIC' && <Toggle label="允许搜索引擎收录" checked={draft.allowSearchIndex} onChange={(allowSearchIndex) => setDraft({ ...draft, allowSearchIndex })} />}</div><p className="form-note">{quickNote ? '创建时会复制一份不可变的当前版本快照。之后继续编辑或归档小记不会改变链接内容；删除小记后链接立即失效。小记链接不会被搜索引擎收录。' : draft.shareType === 'INVITE_LINK' ? '访问者必须先登录；接受后会成为资源协作者，重置或撤销链接不会移除已经加入的成员。' : resourceType === 'KNOWLEDGE_BASE' ? '链接仅展示已有发布快照；目录外文稿和未发布草稿不会意外暴露。' : '分享读取当前发布快照；如果文稿尚未发布，请先在“发布管理”中发布。'}</p>{create.error && <div className="form-error">{messageOf(create.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={create.isPending || (!!draft.password && draft.password.length < 8)} onClick={() => create.mutate()}>{create.isPending && <LoaderCircle className="spin" />}创建链接</button></div></section></div>
}

function ManagedShare({ value, onChanged, onIssued }: { value: ShareView; onChanged: () => Promise<unknown>; onIssued: (token: string) => void }) {
  const quickNote = value.resourceType === 'QUICK_NOTE'
  const confirmation = useConfirmDialog()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(() => ({ role: value.role, expiresAt: toLocalInput(value.expiresAt), requireApproval: value.requireApproval, allowCopy: value.allowCopy, allowDownload: value.allowDownload, allowExport: value.allowExport, allowSearchIndex: value.allowSearchIndex, password: '', clearPassword: false }))
  const update = useMutation({ mutationFn: () => post<ShareView>('/api/v1/shares/update', { shareId: value.id, password: draft.password || null, clearPassword: draft.clearPassword, role: draft.role, requireApproval: draft.requireApproval, expiresAt: toIso(draft.expiresAt), allowCopy: draft.allowCopy, allowDownload: draft.allowDownload, allowExport: draft.allowExport, allowComment: draft.role === 'COMMENTER', allowSearchIndex: draft.allowSearchIndex }), onSuccess: async () => { setEditing(false); await onChanged() } })
  const reset = useMutation({ mutationFn: () => post<CreatedShare>('/api/v1/shares/reset-token', { shareId: value.id }), onSuccess: async (created) => { onIssued(created.token); await onChanged() } })
  const revoke = useMutation({ mutationFn: () => post<void>('/api/v1/shares/revoke', { shareId: value.id }), onSuccess: onChanged })
  const roleLabel = value.role === 'EDITOR' ? '可编辑' : value.role === 'COMMENTER' ? '可评论' : '只读'
  return <article className="managed-share"><header><span className="share-kind-icon">{value.shareType === 'INVITE_LINK' ? <Users /> : value.passwordProtected ? <LockKeyhole /> : <Globe2 />}</span><div><strong>{value.shareType === 'INVITE_LINK' ? '邀请链接' : '公开链接'} · {roleLabel}{quickNote ? ' · 固定快照' : ''}{value.requireApproval ? ' · 需审批' : ''}</strong><small>策略 v{value.policyVersion} · 创建于 {formatDateTime(value.createdAt)}{value.expiresAt ? ` · ${formatDateTime(value.expiresAt)} 失效` : ' · 永久有效'}</small></div><button className="button quiet small" onClick={() => setEditing((open) => !open)}>{editing ? '收起' : '设置'}</button><button className="icon-button" title="重置令牌" aria-label="重置分享令牌" disabled={reset.isPending} onClick={() => confirmation.confirm({ title: '重置分享令牌', description: '旧链接和已存在的审批会立即失效，系统将生成一个新链接。', confirmLabel: '重置令牌' }, () => reset.mutate())}><RefreshCw /></button><button className="icon-button danger" title="撤销" aria-label="撤销分享链接" disabled={revoke.isPending} onClick={() => confirmation.confirm({ title: '撤销分享链接', description: '撤销后链接立即不可访问，且无法恢复。', confirmLabel: '撤销链接' }, () => revoke.mutate())}><Trash2 /></button></header>{editing && <div className="managed-share-editor"><Field label="角色"><select value={quickNote ? 'READER' : draft.role} disabled={quickNote} onChange={(event) => setDraft({ ...draft, role: event.target.value as ShareView['role'] })}><option value="READER">只读</option>{!quickNote && <option value="COMMENTER">可评论</option>}{!quickNote && value.shareType === 'INVITE_LINK' && <option value="EDITOR">可编辑</option>}</select></Field><Field label="失效时间"><input type="datetime-local" value={draft.expiresAt} onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })} /></Field><Field label="设置新密码"><input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value, clearPassword: false })} placeholder="不修改则留空" /></Field><Toggle label="清除现有密码" checked={draft.clearPassword} onChange={(clearPassword) => setDraft({ ...draft, clearPassword, password: '' })} /><Toggle label="需要所有者审批" checked={draft.requireApproval} onChange={(requireApproval) => setDraft({ ...draft, requireApproval })} /><Toggle label="允许复制" checked={draft.allowCopy} onChange={(allowCopy) => setDraft({ ...draft, allowCopy })} /><Toggle label="允许下载" checked={draft.allowDownload} onChange={(allowDownload) => setDraft({ ...draft, allowDownload })} /><Toggle label="允许导出" checked={draft.allowExport} onChange={(allowExport) => setDraft({ ...draft, allowExport })} />{!quickNote && value.shareType === 'PUBLIC' && <Toggle label="搜索引擎收录" checked={draft.allowSearchIndex} onChange={(allowSearchIndex) => setDraft({ ...draft, allowSearchIndex })} />}<div className="managed-share-save"><button className="button primary small" disabled={update.isPending || (!!draft.password && draft.password.length < 8)} onClick={() => update.mutate()}><Save />保存策略</button></div></div>}{value.requireApproval && <ShareRequestReviews shareId={value.id} policyVersion={value.policyVersion} />}{(update.error || reset.error || revoke.error) && <div className="form-error">{messageOf(update.error ?? reset.error ?? revoke.error)}</div>}{confirmation.dialog}</article>
}

function ShareRequestReviews({ shareId, policyVersion }: { shareId: string; policyVersion: number }) {
  const queryClient = useQueryClient()
  const requests = useQuery({ queryKey: ['share-access-requests', shareId], queryFn: () => post<ShareAccessRequest[]>('/api/v1/shares/requests', { shareId }), refetchInterval: 30_000 })
  const review = useMutation({ mutationFn: ({ requestId, decision }: { requestId: string; decision: 'APPROVE' | 'REJECT' }) => post<ShareAccessRequest>('/api/v1/shares/review-request', { requestId, decision }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['share-access-requests', shareId] }) })
  const current = (requests.data ?? []).filter((request) => request.policyVersion === policyVersion)
  return <section className="share-review-list"><header><Users /><strong>访问申请</strong><span>{current.filter((request) => request.status === 'PENDING').length} 待处理</span></header>{current.map((request) => <article key={request.id}><span>{(request.requesterDisplayName || request.requesterEmail).slice(0, 1).toUpperCase()}</span><div><strong>{request.requesterDisplayName || request.requesterEmail}</strong><small>{request.requesterEmail} · {formatDateTime(request.createdAt)}</small>{request.message && <p>{request.message}</p>}</div><i className={`request-status ${request.status.toLowerCase()}`}>{({ PENDING: '待审批', APPROVED: '已通过', REJECTED: '已拒绝' })[request.status]}</i>{request.status === 'PENDING' && <div className="review-actions"><button className="button quiet small" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, decision: 'REJECT' })}>拒绝</button><button className="button primary small" disabled={review.isPending} onClick={() => review.mutate({ requestId: request.id, decision: 'APPROVE' })}><Check />通过</button></div>}</article>)}{!requests.isPending && !current.length && <p className="share-review-empty">当前策略还没有访问申请</p>}{(requests.error || review.error) && <div className="form-error">{messageOf(requests.error ?? review.error)}</div>}</section>
}

function IssuedLink({ value, onClose }: { value: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [copyError, setCopyError] = useState('')
  return <div className="issued-share"><ShieldCheck /><div><strong>请立即保存分享链接</strong><p>出于安全原因，关闭后无法再次查看；需要时可重置令牌。</p><code>{value}</code>{copyError && <span className="inline-error" role="alert">{copyError}，请手动选择上方链接。</span>}</div><button className="button secondary small" onClick={async () => { try { await copyText(value); setCopied(true); setCopyError('') } catch { setCopied(false); setCopyError('浏览器未允许自动复制') } }}>{copied ? <Check /> : <Clipboard />}{copied ? '已复制' : '复制'}</button><button className="icon-button" onClick={onClose} aria-label="关闭分享链接提示"><X /></button></div>
}

function Panel({ title, description, icon, children }: { title: string; description: string; icon: React.ReactNode; children: React.ReactNode }) { return <section className="page-management-panel"><header><span>{icon}</span><div><h2>{title}</h2><p>{description}</p></div></header>{children}</section> }
function Field({ label, wide = false, children }: { label: string; wide?: boolean; children: React.ReactNode }) { return <label className={`field ${wide ? 'wide' : ''}`}><span className="field-label">{label}</span>{children}</label> }
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) { return <label className="compact-toggle"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /><span>{label}</span></label> }
function Empty({ icon, text }: { icon: React.ReactNode; text: string }) { return <div className="page-management-empty">{icon}<p>{text}</p></div> }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 180) }
function toIso(value: string) { return value ? new Date(value).toISOString() : null }
function toLocalInput(value: string | null) { if (!value) return ''; const date = new Date(value); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16) }
function shareUrl(token: string) { return `${window.location.origin}/s/${encodeURIComponent(token)}` }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function safePresentationUrl(value: string | null | undefined) { const safe = safeMediaUrl(value); return safe?.startsWith('https://') ? safe : null }
async function copyText(value: string) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  try {
    if (!document.execCommand?.('copy')) throw new Error('copy unavailable')
  } finally {
    textarea.remove()
  }
}
function revisionKindLabel(value: string) { return ({ AUTO: '自动保存', MANUAL: '手工版本', MIGRATION: '迁移版本' } as Record<string, string>)[value] ?? value }
function capabilityLabel(value: Capability) { return ({ READ: '读取', EDIT: '编辑', MANAGE: '管理资源', COMMENT: '评论', PUBLISH: '发布', SHARE: '分享', COPY: '复制', DOWNLOAD: '下载', EXPORT: '导出', DELETE: '删除', RESTORE: '恢复', MANAGE_PERMISSIONS: '管理权限', VIEW_ANALYTICS: '查看统计' } as Record<Capability, string>)[value] }
function sourceLabel(value: string) { const [scope, detail] = value.split(':'); return `${({ workspace: '空间角色', team: '团队角色', 'knowledge-base': '知识库角色', visibility: '公开范围', acl: '文稿覆盖' } as Record<string, string>)[scope ?? ''] ?? scope}${detail ? `：${detail}` : ''}` }
function subjectTypeLabel(value: AclEntry['subjectType']) { return ({ USER: '用户', GROUP: '用户组', TEAM: '团队', PUBLIC: '公开主体', INVITE: '邀请', API_CLIENT: 'API 客户端' })[value] }
function roleLabel(value: string | null) { return value ? ({ READER: '只读', VIEWER: '只读', EDITOR: '可编辑', MEMBER: '可编辑', MANAGER: '管理者', ADMIN: '管理者', OWNER: '所有者' } as Record<string, string>)[value] ?? value : '自定义能力' }
function contentTypeLabel(value: Page['contentType']) { return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[value] }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`; return `${(value / 1024 / 1024).toFixed(1)} MB` }
function attachmentGlyph(mediaType: string) { if (mediaType.startsWith('image/')) return '图'; if (mediaType.startsWith('audio/')) return '音'; if (mediaType.startsWith('video/')) return '影'; if (mediaType === 'application/pdf') return 'PDF'; return '件' }
function extractionLabel(status: AttachmentView['extractionStatus']) { return ({ EXTRACTED: '全文已索引', EMPTY: '无可提取文字', UNSUPPORTED: '仅索引文件名', TOO_LARGE: '文件过大，仅索引文件名', FAILED: '提取失败，仅索引文件名', METADATA_ONLY: '等待重建索引' } as const)[status] }
