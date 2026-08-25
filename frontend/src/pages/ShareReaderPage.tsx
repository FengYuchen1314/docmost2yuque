import { useEffect, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArchiveX, BookOpen, Check, ChevronRight, Clock3, Download, ExternalLink, FileJson2, KeyRound, LoaderCircle, LockKeyhole, MessageSquare, RefreshCw, Reply, Send, ShieldCheck, StickyNote, Trash2, Users } from 'lucide-react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { downloadPost, messageOf, post, request, type DownloadedFile } from '../lib/api'
import { parseKnowledgeBaseAppearance, parseKnowledgeBaseWatermark } from '../lib/knowledgeBaseAppearance'
import { sharedMediaUrl } from '../lib/sharedMedia'
import { safeMediaUrl } from '../lib/contentCards'
import { safeExternalNavigationUrl } from '../lib/publicNavigation'
import type { Comment, CurrentUser, Page } from '../types'
import type { ShareView } from './PageManagement'
import { PublicContentBody, ReaderLabels } from './SocialPages'
import { useConfirmDialog } from '../components/ConfirmDialog'

interface CommentPage { items: Comment[]; nextOffset: number; hasMore: boolean }

interface PagePublication {
  id: string
  pageId: string
  contentType: Page['contentType']
  title: string
  content: unknown
  plainText: string
  schemaVersion: number
  metadata?: { icon?: string | null; cover?: string | null; labels?: string[] }
  publishedAt: string
}

interface ShareResolution {
  share: ShareView
  passwordRequired: boolean
  approvalRequired: boolean
  approvalStatus: 'AUTHENTICATION_REQUIRED' | 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | null
  publication: PagePublication | null
  appearanceConfig?: unknown
  watermarkConfig?: unknown
  knowledgeBase?: SharedKnowledgeBase | null
  quickNote?: SharedQuickNote | null
  acceptanceRequired?: boolean
  destinationKnowledgeBaseId?: string | null
}

interface SharedKnowledgeBasePage { pageId: string; publicationId: string; title: string; path: string; contentType: Page['contentType']; icon: string | null; publishedAt: string }
interface SharedKnowledgeBaseNode { id: string; nodeType: 'DOCUMENT' | 'GROUP' | 'LINK'; pageId: string | null; parentId: string | null; position: string; title: string | null; url: string | null }
interface SharedKnowledgeBase { id: string; name: string; slug: string; description: string | null; icon: string | null; homepagePageId: string | null; catalogRevision: number; catalog: SharedKnowledgeBaseNode[]; pages: SharedKnowledgeBasePage[]; selectedPageId: string | null }
interface SharedQuickNote { id: string; sourceRevision: number; content: unknown; plainText: string; capturedAt: string }

interface ShareAccessToken { accessToken: string; expiresAt: string }
interface ShareAcceptance { resourceType: 'PAGE' | 'KNOWLEDGE_BASE'; resourceId: string; knowledgeBaseId: string; role: 'READER' | 'COMMENTER' | 'EDITOR'; alreadyAccepted: boolean }

export function ShareReaderPage() {
  const { token = '' } = useParams()
  const location = useLocation()
  const requestedPageId = new URLSearchParams(location.search).get('page')
  const storageKey = `share-access:${token}`
  const [accessToken, setAccessToken] = useState(() => sessionStorage.getItem(storageKey) ?? '')
  const [password, setPassword] = useState('')
  const [requestMessage, setRequestMessage] = useState('')
  const [acceptance, setAcceptance] = useState<ShareAcceptance | null>(null)
  const [copyBlocked, setCopyBlocked] = useState(false)
  const resolution = useQuery({
    queryKey: ['share-resolution', token, accessToken, requestedPageId],
    queryFn: () => post<ShareResolution>('/api/v1/shares/resolve', { token, accessToken: accessToken || null, pageId: requestedPageId }, false),
    enabled: token.length >= 32,
    retry: false,
    refetchInterval: (query) => query.state.data?.approvalStatus === 'PENDING' ? 15_000 : false,
  })
  const viewer = useQuery({ queryKey: ['me'], queryFn: () => request<CurrentUser>('/api/v1/auth/me'), retry: false })
  const verify = useMutation({
    mutationFn: () => post<ShareAccessToken>('/api/v1/shares/verify-password', { token, password }, false),
    onSuccess: (value) => { sessionStorage.setItem(storageKey, value.accessToken); setAccessToken(value.accessToken); setPassword('') },
  })
  const requestAccess = useMutation({
    mutationFn: () => post('/api/v1/shares/request-join', { token, accessToken: accessToken || null, message: requestMessage || null }),
    onSuccess: () => { setRequestMessage(''); void resolution.refetch() },
  })
  const acceptInvite = useMutation({
    mutationFn: () => post<ShareAcceptance>('/api/v1/shares/accept-invite', { token, accessToken: accessToken || null }),
    onSuccess: async (accepted) => { setAcceptance(accepted); await resolution.refetch() },
  })
  const downloadText = useMutation({
    mutationFn: () => downloadPost('/api/v1/shares/download', { token, accessToken: accessToken || null, pageId: requestedPageId }, false),
    onSuccess: (file) => saveFile(file, resolution.data?.knowledgeBase ? 'shared-knowledge-base.txt' : resolution.data?.quickNote ? 'shared-quick-note.txt' : 'shared-page.txt'),
  })
  const exportJson = useMutation({
    mutationFn: () => downloadPost('/api/v1/shares/export', { token, accessToken: accessToken || null, pageId: requestedPageId }, false),
    onSuccess: (file) => saveFile(file, resolution.data?.knowledgeBase ? 'shared-knowledge-base.json' : resolution.data?.quickNote ? 'shared-quick-note.json' : 'shared-page.json'),
  })
  const value = resolution.data
  const publication = value?.publication
  const knowledgeBase = value?.knowledgeBase
  const quickNote = value?.quickNote
  useEffect(() => {
    if (!publication && !knowledgeBase && !quickNote) return
    const previous = document.title
    document.title = `${publication?.title ?? knowledgeBase?.name ?? '共享小记'} · 知序分享`
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]')
    const existed = Boolean(robots)
    if (!robots) { robots = document.createElement('meta'); robots.name = 'robots'; document.head.append(robots) }
    const old = robots.content
    robots.content = value.share.allowSearchIndex ? 'index,follow' : 'noindex,nofollow'
    return () => { document.title = previous; if (!robots) return; if (!existed) robots.remove(); else robots.content = old }
  }, [publication, knowledgeBase, quickNote, value?.share.allowSearchIndex])

  if (resolution.isPending) return <ShareShell><ShareState icon={<LoaderCircle className="spin" />} title="正在验证分享链接" text="请稍候，正在读取最新发布快照。" /></ShareShell>
  if (resolution.error || !value) return <ShareShell><ShareState icon={<ArchiveX />} title="分享链接不可用" text={messageOf(resolution.error)} action={<Link className="button secondary" to="/">返回首页</Link>} /></ShareShell>
  if (value.passwordRequired) return <ShareShell><main className="share-password-card"><span><LockKeyhole /></span><p className="eyebrow">受保护的分享</p><h1>输入访问密码</h1><p>密码验证结果仅在当前浏览器中短期保存。</p><form onSubmit={(event) => { event.preventDefault(); verify.mutate() }}><label className="field"><span className="field-label">访问密码</span><div className="password-field"><KeyRound /><input autoFocus type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></div></label>{verify.error && <div className="form-error">{messageOf(verify.error)}</div>}<button className="button primary" disabled={!password || verify.isPending}>{verify.isPending ? <LoaderCircle className="spin" /> : <ShieldCheck />}验证并阅读</button></form></main></ShareShell>
  if (value.approvalRequired) {
    if (!viewer.data || value.approvalStatus === 'AUTHENTICATION_REQUIRED') return <ShareShell><ShareState icon={<ShieldCheck />} title="登录后申请访问" text="链接所有者开启了访问审批。登录后提交申请，批准后即可阅读。" action={<Link className="button primary" to="/login" state={{ from: `${location.pathname}${location.search}` }}>登录并继续</Link>} /></ShareShell>
    if (value.approvalStatus === 'PENDING') return <ShareShell><ShareState icon={<Clock3 />} title="申请正在等待审批" text="所有者批准后，此页面会自动开放；你也可以稍后通过消息返回。" action={<button className="button secondary" onClick={() => void resolution.refetch()}><RefreshCw />刷新状态</button>} /></ShareShell>
    return <ShareShell><main className="share-approval-card"><span><ShieldCheck /></span><p className="eyebrow">受控分享</p><h1>{value.approvalStatus === 'REJECTED' ? '访问申请未通过' : '申请访问'}</h1><p>{value.approvalStatus === 'REJECTED' ? '你可以补充说明后再次提交，所有者会收到新的申请。' : '向链接所有者说明你的访问用途。'}</p><form onSubmit={(event) => { event.preventDefault(); requestAccess.mutate() }}><label className="field"><span className="field-label">申请说明（可选）</span><textarea value={requestMessage} onChange={(event) => setRequestMessage(event.target.value.slice(0, 500))} rows={4} placeholder="例如：我需要阅读这份文档以参与项目评审" /></label>{requestAccess.error && <div className="form-error">{messageOf(requestAccess.error)}</div>}<button className="button primary" disabled={requestAccess.isPending}>{requestAccess.isPending ? <LoaderCircle className="spin" /> : <ShieldCheck />}提交申请</button></form></main></ShareShell>
  }
  if (!publication && !knowledgeBase && !quickNote && value.share.shareType === 'INVITE_LINK') return <ShareShell><InviteAcceptance value={acceptance} destination={{ resourceType: value.share.resourceType as ShareAcceptance['resourceType'], resourceId: value.share.resourceId, knowledgeBaseId: value.destinationKnowledgeBaseId || value.share.resourceId, role: value.share.role }} accepted={!value.acceptanceRequired} pending={acceptInvite.isPending} error={acceptInvite.error} onAccept={() => acceptInvite.mutate()} /></ShareShell>
  if (!publication && !knowledgeBase && !quickNote) return <ShareShell><ShareState icon={<ArchiveX />} title="分享内容不可用" text="这个分享暂时没有可阅读的安全快照。" /></ShareShell>
  const appearance = parseKnowledgeBaseAppearance(value.appearanceConfig)
  const watermark = parseKnowledgeBaseWatermark(value.watermarkConfig)
  const pageCover = safePresentationUrl(publication?.metadata?.cover)
  const readerStyle = { '--reader-accent': appearance.accentColor } as React.CSSProperties
  const pageStyle = { backgroundColor: appearance.backgroundColor, backgroundImage: appearance.coverUrl ? `linear-gradient(rgba(247,249,247,.88),rgba(247,249,247,.88)),url("${appearance.coverUrl}")` : undefined }
  const accessLabel = value.share.role === 'EDITOR' ? '可编辑邀请' : value.share.role === 'COMMENTER' ? '可评论' : '只读'
  return <ShareShell>
    <main className={`public-reader-page shared-reader-page ${knowledgeBase ? 'shared-kb-reader-page' : ''} ${quickNote ? 'shared-quick-note-page' : ''} kb-reader-theme-${appearance.theme.toLowerCase()}`} style={pageStyle}>
      <div className="shared-reader-bar"><div><ShieldCheck /><span>安全分享 · {accessLabel}</span>{knowledgeBase && <small>{knowledgeBase.pages.length} 篇已发布文稿</small>}{quickNote && <small>小记版本 {quickNote.sourceRevision} · 固定快照</small>}{value.share.expiresAt && <small>{formatDateTime(value.share.expiresAt)} 失效</small>}</div><div>{value.share.allowDownload && <button className="button quiet small" disabled={downloadText.isPending} onClick={() => downloadText.mutate()}><Download />{downloadText.isPending ? '生成中…' : knowledgeBase ? '下载整库文本' : quickNote ? '下载小记文本' : '下载文本'}</button>}{value.share.allowExport && <button className="button quiet small" disabled={exportJson.isPending} onClick={() => exportJson.mutate()}><FileJson2 />{exportJson.isPending ? '生成中…' : knowledgeBase ? '导出整库 JSON' : quickNote ? '导出小记 JSON' : '导出 JSON'}</button>}</div></div>
      {(value.acceptanceRequired || acceptance) && <div className="share-invite-banner"><Users /><div><strong>{acceptance ? '邀请已接受' : '这是一个协作邀请'}</strong><p>{acceptance ? '权限已经写入你的账号，可以从工作区持续访问。' : `接受后将获得${accessLabel}权限，之后无需保留此链接。`}</p></div>{acceptance ? <Link className="button primary small" to={acceptance.resourceType === 'KNOWLEDGE_BASE' ? `/app/kb/${acceptance.resourceId}` : `/app/kb/${acceptance.knowledgeBaseId}/pages/${acceptance.resourceId}`}>打开工作区</Link> : <button className="button primary small" disabled={acceptInvite.isPending} onClick={() => acceptInvite.mutate()}>{acceptInvite.isPending ? <LoaderCircle className="spin" /> : <Check />}接受邀请</button>}{acceptInvite.error && <span className="form-error">{messageOf(acceptInvite.error)}</span>}</div>}
      {(downloadText.error || exportJson.error) && <div className="shared-reader-operation-error form-error">{messageOf(downloadText.error || exportJson.error)}</div>}
      <div className={`shared-reader-layout ${knowledgeBase ? 'with-catalog' : ''}`}>
        {knowledgeBase && <SharedKnowledgeBaseCatalog value={knowledgeBase} token={token} />}
        <section className="shared-reader-content">
          {publication ? <article className={`public-reader kb-reader-width-${appearance.contentWidth.toLowerCase()} ${value.share.allowCopy ? '' : 'copy-protected'}`} style={readerStyle} onCopy={(event) => { if (!value.share.allowCopy) { event.preventDefault(); setCopyBlocked(true); window.setTimeout(() => setCopyBlocked(false), 2_000) } }}>
            {watermark.enabled && <div className={`reader-watermark position-${watermark.position.toLowerCase()}`} style={{ opacity: watermark.opacity }} aria-hidden="true">{watermark.text.replaceAll('{{email}}', viewer.data?.email || '公开访客')}</div>}
            {pageCover && <div className="reader-page-cover" style={{ backgroundImage: `url("${pageCover}")` }} />}
            <header>{publication.metadata?.icon && <span className="reader-page-icon">{safePresentationUrl(publication.metadata.icon) ? <img src={safePresentationUrl(publication.metadata.icon)!} alt="" /> : publication.metadata.icon}</span>}<span className="content-type-chip">{contentTypeLabel(publication.contentType)}</span><h1>{publication.title}</h1><div className="shared-publication-meta"><span>发布于 {formatDateTime(publication.publishedAt)}</span><span>快照版本 {publication.schemaVersion}</span>{!value.share.allowCopy && <span><LockKeyhole />已限制复制</span>}</div></header>
            <ReaderLabels labels={publication.metadata?.labels} />
            <PublicContentBody reader={{ content: publication.content, plainText: publication.plainText, metadata: { contentType: publication.contentType } }} resolveMediaUrl={(url) => sharedMediaUrl(url, token, accessToken, publication.pageId)} />
          </article> : quickNote ? <article className={`public-reader shared-quick-note-reader ${value.share.allowCopy ? '' : 'copy-protected'}`} onCopy={(event) => { if (!value.share.allowCopy) { event.preventDefault(); setCopyBlocked(true); window.setTimeout(() => setCopyBlocked(false), 2_000) } }}>
            <header><span className="reader-page-icon quick-note"><StickyNote /></span><span className="content-type-chip">小记快照</span><h1>共享小记</h1><div className="shared-publication-meta"><span>捕获于 {formatDateTime(quickNote.capturedAt)}</span><span>来源版本 {quickNote.sourceRevision}</span><span><LockKeyhole />后续编辑不会改变此快照</span>{!value.share.allowCopy && <span><LockKeyhole />已限制复制</span>}</div></header>
            <PublicContentBody reader={{ content: quickNote.content, plainText: quickNote.plainText, metadata: { contentType: 'DOCUMENT' } }} />
          </article> : <div className="shared-kb-empty"><BookOpen /><h1>还没有可阅读的发布内容</h1><p>未发布草稿、目录外文稿以及明确限制为私密或仅空间可见的文稿不会出现在这里。</p></div>}
          {publication && value.share.allowComment && <ShareComments token={token} accessToken={accessToken} pageId={publication.pageId} viewer={viewer.data} returnTo={`${location.pathname}${location.search}`} />}
        </section>
      </div>
      {copyBlocked && <div className="copy-blocked-toast"><LockKeyhole />链接所有者已关闭复制</div>}
    </main>
  </ShareShell>
}

function InviteAcceptance({ value, destination, accepted, pending, error, onAccept }: { value: ShareAcceptance | null; destination: Omit<ShareAcceptance, 'alreadyAccepted'>; accepted: boolean; pending: boolean; error: unknown; onAccept: () => void }) {
  const target = value ?? destination
  if (value || accepted) return <ShareState icon={<Check />} title="邀请已接受" text="权限已经写入你的账号。" action={<Link className="button primary" to={target.resourceType === 'KNOWLEDGE_BASE' ? `/app/kb/${target.resourceId}` : `/app/kb/${target.knowledgeBaseId}/pages/${target.resourceId}`}>打开工作区</Link>} />
  return <main className="share-approval-card"><span><Users /></span><p className="eyebrow">协作邀请</p><h1>接受资源邀请</h1><p>接受后，阅读、评论或编辑权限会绑定到当前邮箱账号。</p>{Boolean(error) && <div className="form-error">{messageOf(error)}</div>}<button className="button primary" disabled={pending} onClick={onAccept}>{pending ? <LoaderCircle className="spin" /> : <Check />}接受邀请</button></main>
}

function SharedKnowledgeBaseCatalog({ value, token }: { value: SharedKnowledgeBase; token: string }) {
  const pages = new Map(value.pages.map((page) => [page.pageId, page]))
  const nodes = (parentId: string | null) => value.catalog.filter((node) => node.parentId === parentId).sort((left, right) => left.position.localeCompare(right.position))
  const render = (parentId: string | null, depth: number): React.ReactNode => nodes(parentId).map((node) => {
    if (node.nodeType === 'GROUP') return <div className="shared-kb-group" key={node.id} style={{ '--catalog-depth': depth } as React.CSSProperties}><strong><ChevronRight />{node.title || '分组'}</strong>{render(node.id, depth + 1)}</div>
    if (node.nodeType === 'LINK') {
      const externalUrl = safeExternalNavigationUrl(node.url)
      return externalUrl
        ? <a className="shared-kb-catalog-link external" key={node.id} href={externalUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" style={{ '--catalog-depth': depth } as React.CSSProperties}><ExternalLink /><span>{node.title || node.url}</span></a>
        : <span className="shared-kb-catalog-link external disabled" aria-disabled="true" key={node.id} style={{ '--catalog-depth': depth } as React.CSSProperties}><ExternalLink /><span>{node.title || '不可用链接'}</span></span>
    }
    const page = node.pageId ? pages.get(node.pageId) : undefined
    return page ? <Link className={`shared-kb-catalog-link ${value.selectedPageId === page.pageId ? 'active' : ''}`} key={node.id} to={`/s/${encodeURIComponent(token)}?page=${encodeURIComponent(page.pageId)}`} style={{ '--catalog-depth': depth } as React.CSSProperties}><BookOpen /><span><strong>{node.title || page.title}</strong><small>/{page.path}</small></span></Link> : null
  })
  return <aside className="shared-kb-catalog"><header><span>{value.icon || '📚'}</span><div><strong>{value.name}</strong><p>{value.description || '共享知识库'}</p></div></header><nav>{render(null, 0)}</nav><footer><small>目录版本 {value.catalogRevision}</small><span>{value.pages.length} 篇内容</span></footer></aside>
}

function ShareComments({ token, accessToken, pageId, viewer, returnTo }: { token: string; accessToken: string; pageId: string; viewer: CurrentUser | undefined; returnTo: string }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const queryKey = ['share-comments', token, accessToken, pageId]
  const [plainText, setPlainText] = useState('')
  const [parentId, setParentId] = useState<string | null>(null)
  const comments = useInfiniteQuery({
    queryKey,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<CommentPage>('/api/v1/shares/comments/page', { token, accessToken: accessToken || null, pageId, limit: 30, offset: pageParam }, false),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
    retry: false,
  })
  const create = useMutation({
    mutationFn: () => post<Comment>('/api/v1/shares/comments/create', {
      token,
      accessToken: accessToken || null,
      pageId,
      parentId,
      anchor: { kind: 'SHARED_PAGE' },
      body: { type: 'doc', content: [{ type: 'paragraph', text: plainText.trim() }] },
      plainText: plainText.trim(),
    }),
    onSuccess: async () => { setPlainText(''); setParentId(null); await queryClient.invalidateQueries({ queryKey }) },
  })
  const remove = useMutation({
    mutationFn: (commentId: string) => post<void>('/api/v1/shares/comments/delete', { token, accessToken: accessToken || null, pageId, commentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  })
  const values = comments.data?.pages.flatMap((page) => page.items) ?? []
  const roots = values.filter((comment) => !comment.parentId)
  const replies = (parent: string) => values.filter((comment) => comment.parentId === parent)
  const renderComment = (comment: Comment, reply = false) => <article className={`shared-comment ${reply ? 'reply' : ''}`} key={comment.id}>
    <header><span>{comment.creatorEmail.slice(0, 1).toUpperCase()}</span><div><strong>{comment.creatorEmail}</strong><time>{relativeTime(comment.createdAt)}</time></div>{comment.status === 'RESOLVED' && <small><Check />已解决</small>}</header>
    <p>{comment.plainText}</p>
    {viewer && <footer>{!reply && <button onClick={() => setParentId(comment.id)}><Reply />回复</button>}{comment.createdBy === viewer.userId && <button className="danger-link" disabled={remove.isPending} onClick={() => confirmation.confirm({ title: '删除这条评论', description: '评论删除后无法恢复，其它参与者也将不再看到它。', confirmLabel: '删除评论' }, () => remove.mutate(comment.id))}><Trash2 />删除</button>}</footer>}
    {!reply && replies(comment.id).map((child) => renderComment(child, true))}
  </article>
  return <section className="shared-comments">
    <header><div><MessageSquare /><div><h2>评论</h2><p>通过这条分享链接参与讨论。</p></div></div><strong>{values.length}{comments.hasNextPage ? '+' : ''}</strong></header>
    {comments.isPending && <div className="shared-comments-state"><LoaderCircle className="spin" />正在读取评论…</div>}
    {comments.error && <div className="form-error">{messageOf(comments.error)}</div>}
    {!comments.isPending && !comments.error && roots.length === 0 && <div className="shared-comments-state"><MessageSquare />还没有评论，可以留下第一条。</div>}
    <div className="shared-comment-list">{roots.map((comment) => renderComment(comment))}</div>
    {comments.hasNextPage && <button className="button secondary small shared-comments-more" disabled={comments.isFetchingNextPage} onClick={() => comments.fetchNextPage()}>{comments.isFetchingNextPage ? '加载中…' : '加载更多评论'}</button>}
    {viewer ? <form className="shared-comment-composer" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
      {parentId && <div>正在回复 {values.find((comment) => comment.id === parentId)?.creatorEmail}<button type="button" onClick={() => setParentId(null)}>取消</button></div>}
      <textarea value={plainText} onChange={(event) => setPlainText(event.target.value.slice(0, 20_000))} rows={4} placeholder="写下评论…" />
      <footer><small>评论会同步到文稿协作区</small><button className="button primary small" disabled={!plainText.trim() || create.isPending}>{create.isPending ? <LoaderCircle className="spin" /> : <Send />}发送</button></footer>
      {create.error && <div className="form-error">{messageOf(create.error)}</div>}
    </form> : <div className="shared-comments-login"><p>阅读评论无需登录，发言时需要使用邮箱账号。</p><Link className="button secondary small" to="/login" state={{ from: returnTo }}>登录后评论</Link></div>}
    {confirmation.dialog}
  </section>
}

function ShareShell({ children }: { children: React.ReactNode }) { return <div className="public-shell share-shell"><header className="public-topbar"><Link className="brand compact" to="/"><span className="brand-mark">序</span><span>知序</span></Link><nav><span><ShieldCheck />受控分享</span></nav><div><Link to="/login">登录</Link></div></header>{children}<footer className="public-footer"><span><span className="brand-mark">序</span>知序</span><p>此页面通过独立分享策略提供访问。</p><Link to="/">返回首页</Link></footer></div> }
function ShareState({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) { return <main className="share-reader-state"><span>{icon}</span><h1>{title}</h1><p>{text}</p>{action}</main> }
function saveFile(file: DownloadedFile, fallbackName: string) { const url = URL.createObjectURL(file.blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.filename || fallbackName; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 0) }
function safePresentationUrl(value: string | null | undefined) { const safe = safeMediaUrl(value); return safe?.startsWith('https://') ? safe : null }
function contentTypeLabel(value: Page['contentType']) { return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[value] }
function formatDateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function relativeTime(value: string) { const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000)); if (minutes < 1) return '刚刚'; if (minutes < 60) return `${minutes} 分钟前`; if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`; return new Date(value).toLocaleDateString('zh-CN') }
