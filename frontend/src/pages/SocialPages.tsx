import { useEffect, useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft, AtSign, Bell, BellOff, BookOpen, CalendarCheck, CalendarDays, Check, CircleDot, ClipboardList, Code2, Compass,
  Download, ExternalLink, FileQuestion, FileText, Flag, Heart, Lightbulb, ListTree, LoaderCircle,
  MessageCircleMore, Palette, Paperclip, Rss, Search, Send, ShieldBan, Sparkles,
  Tag, ThumbsUp, Trash2, UserPlus, Users, Vote, X,
} from 'lucide-react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { SensitiveTextCard } from '../components/SensitiveTextCard'
import { DatabaseCardView } from '../components/DatabaseCardView'
import { DrawingCardView } from '../components/DrawingCard'
import { FormulaCardView, MindMapCardView, TechnicalDiagramCard } from '../components/DiagramCards'
import { messageOf, post, request } from '../lib/api'
import { allowedProviderUrl, imageWidthClassName, parseContentCardTokens, safeMediaUrl, type ParsedContentCard } from '../lib/contentCards'
import { documentSettingsClassNames, normalizeDocumentSettings } from '../lib/documentSettings'
import { parseKnowledgeBaseAppearance, parseKnowledgeBaseWatermark } from '../lib/knowledgeBaseAppearance'
import { parsePublicNavigation, safePublicNavigationUrl } from '../lib/publicNavigation'
import { displaySpreadsheetCell, formatSpreadsheetValue } from '../lib/structuredCalculations'
import type {
  CurrentUser, Explore, FeedItem, FollowState, Garden, KnowledgeBase, PublicContent, PublicProfile, PublicReader, SearchResponse, SearchResult, SocialPage, Workspace,
} from '../types'

const reactionOptions = [
  { type: 'LIKE', label: '赞', icon: <ThumbsUp /> },
  { type: 'CLAP', label: '鼓掌', icon: <Sparkles /> },
  { type: 'HEART', label: '喜欢', icon: <Heart /> },
  { type: 'INSIGHTFUL', label: '有启发', icon: <Lightbulb /> },
] as const

export function ExplorePage() {
  const viewer = useViewer()
  const explore = useQuery({
    queryKey: ['social-explore', Boolean(viewer.data)],
    queryFn: () => post<Explore>('/api/public/v1/social/explore', { limit: 18 }, false),
  })
  usePageMetadata('发现 · 知序', '发现正在生长的公开知识、创作者与知识花园。')
  return <PublicShell viewer={viewer.data}>
    <main className="public-page explore-page">
      <header className="explore-hero"><span><Compass /></span><p className="eyebrow">发现</p><h1>让好知识彼此抵达</h1><p>关注持续创作的人，也逛逛他们精心整理的知识花园。</p></header>
      <PublicSearch />
      {explore.isPending ? <PublicLoading /> : explore.error ? <PublicError error={explore.error} /> : explore.data && <>
        <PublicSection title="正在流行" description="近期阅读、回应和分享较多的内容"><ContentGrid items={explore.data.trending} viewer={viewer.data} /></PublicSection>
        <PublicSection title="刚刚发布" description="按发布时间发现新鲜知识"><ContentGrid items={explore.data.latest} viewer={viewer.data} /></PublicSection>
        <PublicSection title="值得关注的创作者" description="找到长期更新同一领域的人"><CreatorGrid items={explore.data.creators} /></PublicSection>
        <PublicSection title="知识花园" description="围绕一个主题持续整理的公开知识库"><GardenGrid items={explore.data.gardens} /></PublicSection>
      </>}
    </main>
  </PublicShell>
}

export function PublicSearch() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const results = useInfiniteQuery({
    queryKey: ['public-search', query],
    queryFn: ({ pageParam }) => post<SearchResponse>('/api/public/v1/search', {
      workspaceId: null,
      query,
      offset: pageParam,
      limit: 12,
    }, false),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
    enabled: Boolean(query),
    staleTime: 30_000,
  })
  const items = results.data?.pages.flatMap((page) => page.results) ?? []
  const submit = (event: React.FormEvent) => {
    event.preventDefault()
    const value = input.trim().slice(0, 200)
    setInput(value)
    setQuery(value)
  }
  const clear = () => { setInput(''); setQuery('') }
  return <section className={`public-search ${query ? 'active' : ''}`} aria-label="搜索公开知识">
    <form onSubmit={submit}>
      <Search aria-hidden="true" />
      <input value={input} onChange={(event) => setInput(event.target.value)} maxLength={200} placeholder="搜索公开文章、标题或正文…" aria-label="搜索公开文章" />
      {input && <button className="public-search-clear" type="button" onClick={clear} aria-label="清空搜索"><X /></button>}
      <button className="button primary" type="submit" disabled={!input.trim()}>搜索</button>
    </form>
    {query && <div className="public-search-panel" aria-live="polite">
      <header><div><p className="eyebrow">公开知识搜索</p><h2>“{query}” 的结果</h2></div>{!results.isPending && !results.error && <span>{items.length}{results.hasNextPage ? '+' : ''} 条</span>}</header>
      {results.isPending && <div className="public-search-state"><LoaderCircle className="spin" />正在检索公开内容</div>}
      {results.error && <div className="public-search-state error"><FileQuestion />{messageOf(results.error)}<button className="button secondary small" onClick={() => results.refetch()}>重试</button></div>}
      {!results.isPending && !results.error && items.length === 0 && <PublicEmpty title="没有找到相关公开内容" description="换一个关键词，或浏览下方正在流行的内容。" />}
      {items.length > 0 && <div className="public-search-results">{items.map((result) => <PublicSearchResultCard key={result.documentId} result={result} />)}</div>}
      {results.hasNextPage && <button className="button secondary public-search-more" onClick={() => results.fetchNextPage()} disabled={results.isFetchingNextPage}>{results.isFetchingNextPage && <LoaderCircle className="spin" />}{results.isFetchingNextPage ? '正在加载' : '加载更多结果'}</button>}
    </div>}
  </section>
}

function PublicSearchResultCard({ result }: { result: SearchResult }) {
  return <Link className="public-search-result" to={result.publicationId ? `/p/${result.publicationId}` : '/explore'} aria-disabled={!result.publicationId}>
    <span className="public-search-result-icon">{publicSearchIcon(result.contentType)}</span>
    <span><small>{publicSearchType(result.contentType)} · {formatDate(result.updatedAt)}</small><strong>{result.title}</strong><p>{result.snippet || '打开阅读完整内容'}</p></span>
    <ExternalLink aria-hidden="true" />
  </Link>
}

export function PublicProfilePage() {
  const { slug = '' } = useParams()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const profile = useQuery({ queryKey: ['public-profile', slug], queryFn: () => post<PublicProfile>('/api/public/v1/social/profile', { slug }, false), enabled: Boolean(slug) })
  const content = useInfiniteQuery({
    queryKey: ['public-profile-content', slug],
    queryFn: ({ pageParam }) => post<SocialPage<PublicContent>>('/api/public/v1/social/profile/content/page', { slug, offset: pageParam, limit: 24 }, false),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
    enabled: Boolean(slug),
  })
  usePageMetadata(profile.data?.seoTitle || profile.data?.displayName || '公开主页', profile.data?.seoDescription || profile.data?.bio || '')
  if (profile.isPending) return <PublicShell viewer={viewer.data}><PublicLoading /></PublicShell>
  if (!profile.data) return <PublicShell viewer={viewer.data}><PublicError error={profile.error} /></PublicShell>
  const value = profile.data
  const self = viewer.data?.userId === value.userId
  const items = content.data?.pages.flatMap((page) => page.items) ?? []
  return <PublicShell viewer={viewer.data} theme={value.theme} navigation={value.navigation}>
    <main className={`public-page profile-page theme-${value.theme.toLowerCase()}`}>
      <div className="profile-cover" style={coverStyle(value.coverUrl)} />
      <header className="profile-identity">
        <Avatar src={value.avatarUrl} label={value.displayName} large />
        <div><h1>{value.displayName}</h1><p className="profile-handle">@{value.slug}</p><p className="profile-bio">{value.bio || '这个人正在安静地整理自己的知识。'}</p><div className="profile-counts"><span><strong>{value.followerCount}</strong> 关注者</span><span><strong>{value.followingCount}</strong> 正在关注</span></div></div>
        <div className="profile-actions">
          {self ? <Link className="button secondary" to="/app/profile">编辑主页</Link> : <FollowControl viewer={viewer.data} targetType="USER" targetId={value.userId} initialFollowed={value.followed} label="关注" guestLabel="登录后关注" onChanged={() => queryClient.invalidateQueries({ queryKey: ['public-profile', slug] })} />}
          {value.rssEnabled && <a className="icon-button" href={`/api/public/v1/social/profiles/${value.slug}/rss.xml`} title="订阅 RSS" aria-label={`订阅 ${value.displayName || value.slug} 的 RSS`}><Rss /></a>}
          {!self && viewer.data && <SafetyMenu targetType="USER" targetId={value.userId} canBlock />}
        </div>
      </header>
      <PublicSection title="公开内容" description={`${items.length}${content.hasNextPage ? '+' : ''} 篇已发布内容`}><PagedContent items={items} viewer={viewer.data} pending={content.isPending} error={content.error} hasMore={Boolean(content.hasNextPage)} loadingMore={content.isFetchingNextPage} onLoadMore={() => void content.fetchNextPage()} emptyTitle="暂无公开内容" /></PublicSection>
    </main>
  </PublicShell>
}

export function PublicGardenPage() {
  const { slug = '' } = useParams()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const [knowledgeBase, setKnowledgeBase] = useState<string>('ALL')
  const garden = useQuery({ queryKey: ['public-garden', slug], queryFn: () => post<Garden>('/api/public/v1/social/garden', { slug }, false), enabled: Boolean(slug) })
  const content = useInfiniteQuery({
    queryKey: ['public-garden-content', slug, knowledgeBase],
    queryFn: ({ pageParam }) => post<SocialPage<PublicContent>>('/api/public/v1/social/garden/content/page', { slug, knowledgeBaseId: knowledgeBase === 'ALL' ? null : knowledgeBase, offset: pageParam, limit: 24 }, false),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
    enabled: Boolean(slug),
  })
  const items = content.data?.pages.flatMap((page) => page.items) ?? []
  usePageMetadata(garden.data?.seoTitle || garden.data?.title || '知识花园', garden.data?.seoDescription || garden.data?.description || '')
  if (garden.isPending) return <PublicShell viewer={viewer.data}><PublicLoading /></PublicShell>
  if (!garden.data) return <PublicShell viewer={viewer.data}><PublicError error={garden.error} /></PublicShell>
  const value = garden.data
  const self = viewer.data?.userId === value.userId
  return <PublicShell viewer={viewer.data} theme={value.theme} navigation={value.navigation}>
    <main className={`public-page garden-page theme-${value.theme.toLowerCase()}`}>
      <header className="garden-hero" style={coverStyle(value.coverUrl)}>
        <div className="garden-hero-inner"><span className="garden-icon">{value.icon || '🌿'}</span><p className="eyebrow">{value.ownerName} 的知识花园</p><h1>{value.title}</h1><p>{value.description || '把零散的知识种成一座可供漫游的花园。'}</p><div className="garden-actions"><Link to={`/u/${value.ownerSlug}`} className="button quiet"><ArrowLeft />创作者主页</Link>{self ? <Link to="/app/profile" className="button secondary">管理花园</Link> : <FollowControl viewer={viewer.data} targetType="GARDEN" targetId={value.id} initialFollowed={value.followed} label="关注花园" guestLabel="登录后关注" onChanged={() => queryClient.invalidateQueries({ queryKey: ['public-garden', slug] })} />}{!self && viewer.data && <SafetyMenu targetType="GARDEN" targetId={value.id} />}</div><small>{value.followerCount} 位关注者 · {value.knowledgeBases.length} 个知识库</small></div>
      </header>
      <nav className="garden-kb-tabs"><button className={knowledgeBase === 'ALL' ? 'active' : ''} onClick={() => setKnowledgeBase('ALL')}>全部内容</button>{value.knowledgeBases.map((kb) => <button key={kb.id} className={knowledgeBase === kb.id ? 'active' : ''} onClick={() => setKnowledgeBase(kb.id)}>{kb.icon || '📚'} {kb.name}</button>)}</nav>
      <PublicSection title={knowledgeBase === 'ALL' ? '花园内容' : value.knowledgeBases.find((kb) => kb.id === knowledgeBase)?.name || '花园内容'} description={`已加载 ${items.length}${content.hasNextPage ? '+' : ''} 篇`}><PagedContent items={items} viewer={viewer.data} pending={content.isPending} error={content.error} hasMore={Boolean(content.hasNextPage)} loadingMore={content.isFetchingNextPage} onLoadMore={() => void content.fetchNextPage()} emptyTitle="这个分区还没有公开内容" /></PublicSection>
    </main>
  </PublicShell>
}

export function PublicReaderPage() {
  const { publicationId = '' } = useParams()
  const viewer = useViewer()
  const queryClient = useQueryClient()
  const reader = useQuery({ queryKey: ['public-reader', publicationId], queryFn: () => post<PublicReader>('/api/public/v1/social/publication', { publicationId }, false), enabled: Boolean(publicationId) })
  const react = useMutation({
    mutationFn: (reactionType: string) => post<PublicContent>('/api/v1/social/reactions/toggle', { publicationId, reactionType }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['public-reader', publicationId] }),
  })
  usePageMetadata(reader.data?.metadata.title || '公开阅读', reader.data?.metadata.preview || '')
  if (reader.isPending) return <PublicShell viewer={viewer.data}><PublicLoading /></PublicShell>
  if (!reader.data) return <PublicShell viewer={viewer.data}><PublicError error={reader.error} /></PublicShell>
  const { metadata } = reader.data
  const appearance = parseKnowledgeBaseAppearance(reader.data.appearanceConfig)
  const watermark = parseKnowledgeBaseWatermark(reader.data.watermarkConfig)
  const pageCover = safePresentationUrl(reader.data.pageMetadata?.cover)
  const readerStyle = { '--reader-accent': appearance.accentColor } as React.CSSProperties
  const pageStyle = { backgroundColor: appearance.backgroundColor, backgroundImage: appearance.coverUrl ? `linear-gradient(rgba(247,249,247,.88),rgba(247,249,247,.88)),url("${appearance.coverUrl}")` : undefined }
  return <PublicShell viewer={viewer.data}>
    <main className={`public-reader-page kb-reader-theme-${appearance.theme.toLowerCase()}`} style={pageStyle}>
      <div className="reader-breadcrumb"><Link to={`/u/${metadata.authorSlug}`}><ArrowLeft />{metadata.authorName}</Link><span>/</span><span>{metadata.knowledgeBaseName}</span></div>
      <article className={`public-reader kb-reader-width-${appearance.contentWidth.toLowerCase()} ${documentSettingsClassNames(reader.data.documentSettings)}`} style={readerStyle}>
        {watermark.enabled && <div className={`reader-watermark position-${watermark.position.toLowerCase()}`} style={{ opacity: watermark.opacity }} aria-hidden="true">{watermark.text.replaceAll('{{email}}', viewer.data?.email || '公开访客')}</div>}
        {pageCover && <div className="reader-page-cover" style={{ backgroundImage: `url("${pageCover}")` }} />}
        <header>{reader.data.pageMetadata?.icon && <span className="reader-page-icon">{safePresentationUrl(reader.data.pageMetadata.icon) ? <img src={safePresentationUrl(reader.data.pageMetadata.icon)!} alt="" /> : reader.data.pageMetadata.icon}</span>}<span className="content-type-chip">{contentTypeLabel(metadata.contentType)}</span><h1>{metadata.title}</h1><div className="reader-author"><Avatar src={metadata.authorAvatar} label={metadata.authorName} /><div><Link to={`/u/${metadata.authorSlug}`}>{metadata.authorName}</Link><small>{formatDate(metadata.publishedAt)} 发布</small></div></div><KnowledgeBaseFollow viewer={viewer.data} knowledgeBaseId={metadata.knowledgeBaseId} knowledgeBaseName={metadata.knowledgeBaseName} authorId={metadata.authorId} /></header>
        <ReaderLabels labels={reader.data.pageMetadata?.labels} />
        <PublicContentBody reader={reader.data} databaseFormPublicationId={publicationId} />
        <footer className="reader-response"><p>这篇内容对你有帮助吗？</p><ReactionBar item={metadata} viewer={viewer.data} onReact={(type) => react.mutate(type)} pending={react.isPending} /><SafetyMenu targetType="PUBLICATION" targetId={metadata.publicationId} /></footer>
      </article>
    </main>
  </PublicShell>
}

type FollowTargetType = 'USER' | 'KNOWLEDGE_BASE' | 'GARDEN'

export function KnowledgeBaseFollow({ viewer, knowledgeBaseId, knowledgeBaseName, authorId }: {
  viewer?: CurrentUser
  knowledgeBaseId: string
  knowledgeBaseName: string
  authorId: string
}) {
  if (viewer?.userId === authorId) return null
  return <div className="reader-knowledge-base-follow">
    <div><BookOpen /><span><small>所属知识库</small><strong>{knowledgeBaseName}</strong></span></div>
    <FollowControl viewer={viewer} targetType="KNOWLEDGE_BASE" targetId={knowledgeBaseId} label="关注知识库" guestLabel="登录后关注知识库" />
  </div>
}

export function FollowControl({ viewer, targetType, targetId, initialFollowed = false, label, guestLabel, onChanged }: {
  viewer?: CurrentUser
  targetType: FollowTargetType
  targetId: string
  initialFollowed?: boolean
  label: string
  guestLabel: string
  onChanged?: () => void | Promise<unknown>
}) {
  const queryClient = useQueryClient()
  const queryKey = ['social-follow-state', targetType, targetId]
  const state = useQuery({
    queryKey,
    queryFn: () => post<FollowState>('/api/v1/social/follow/status', { targetType, targetId }),
    enabled: Boolean(viewer && targetId),
    retry: false,
  })
  const value = state.data ?? { followed: initialFollowed, notificationsEnabled: initialFollowed }
  const update = useMutation({
    mutationFn: async (next: FollowState) => {
      if (next.followed) await post('/api/v1/social/follow', { targetType, targetId, notificationsEnabled: next.notificationsEnabled })
      else await post('/api/v1/social/unfollow', { targetType, targetId })
      return next
    },
    onSuccess: async (next) => {
      queryClient.setQueryData(queryKey, next)
      await onChanged?.()
    },
  })
  if (!viewer) return <Link className="button primary" to="/login">{guestLabel}</Link>
  const pending = state.isPending || update.isPending
  return <span className="follow-control">
    <button className={`button ${value.followed ? 'secondary' : 'primary'}`} onClick={() => update.mutate(value.followed ? { followed: false, notificationsEnabled: false } : { followed: true, notificationsEnabled: true })} disabled={pending}>{value.followed ? <Check /> : <UserPlus />}{value.followed ? '已关注' : label}</button>
    {value.followed && <button className="button secondary follow-notification-button" onClick={() => update.mutate({ followed: true, notificationsEnabled: !value.notificationsEnabled })} disabled={pending} title={value.notificationsEnabled ? '关闭发布通知' : '开启发布通知'} aria-label={value.notificationsEnabled ? '关闭发布通知' : '开启发布通知'}>{value.notificationsEnabled ? <Bell /> : <BellOff />}<span>{value.notificationsEnabled ? '接收更新' : '已静音'}</span></button>}
    {update.error && <small className="follow-control-error">{messageOf(update.error)}</small>}
  </span>
}

export function FeedPage() {
  const feed = useInfiniteQuery({
    queryKey: ['social-feed'],
    queryFn: ({ pageParam }) => post<SocialPage<FeedItem>>('/api/v1/social/feed/page', { offset: pageParam, limit: 25 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
  })
  const items = feed.data?.pages.flatMap((page) => page.items) ?? []
  return <div className="content-page social-app-page"><header className="page-header"><div><p className="eyebrow">关注动态</p><h1>你关心的知识更新</h1><p>来自已关注创作者、知识库和花园的最新发布。</p></div><Link className="button secondary" to="/explore"><Compass />发现更多</Link></header>{feed.isPending ? <PublicLoading /> : feed.error ? <PublicError error={feed.error} /> : <div className="feed-list">{items.map((entry) => <div className="feed-entry" key={entry.content.publicationId}><div className="feed-reason"><Users />来自你的关注</div><ContentCard item={entry.content} /></div>)}{!items.length && <PublicEmpty title="关注流还很安静" description="去发现页关注创作者或知识花园，发布后会出现在这里。" action={<Link className="button primary" to="/explore">去发现</Link>} />}{feed.hasNextPage && <PageLoadMore onClick={() => feed.fetchNextPage()} loading={feed.isFetchingNextPage} label="加载更早的动态" />}</div>}</div>
}

export function PublicProfileSettingsPage({ currentUser }: { currentUser: CurrentUser }) {
  const queryClient = useQueryClient()
  const profileQuery = useQuery({ queryKey: ['my-public-profile'], queryFn: () => post<PublicProfile>('/api/v1/social/profile/me', {}), retry: false })
  const gardens = useQuery({ queryKey: ['my-gardens'], queryFn: () => post<Garden[]>('/api/v1/social/gardens/mine', {}) })
  const publicKnowledgeBases = useQuery({ queryKey: ['public-kbs-for-garden'], queryFn: loadPublicKnowledgeBases })
  const [profile, setProfile] = useState<ProfileDraft>(() => defaultProfile(currentUser))
  const [garden, setGarden] = useState<GardenDraft>(() => emptyGarden())
  const [activeGardenId, setActiveGardenId] = useState<string>('NEW')
  const [deleteTarget, setDeleteTarget] = useState<Garden | null>(null)
  useEffect(() => { if (profileQuery.data) setProfile(profileDraft(profileQuery.data)) }, [profileQuery.data])
  useEffect(() => {
    if (activeGardenId === 'NEW') { setGarden(emptyGarden()); return }
    const value = gardens.data?.find((item) => item.id === activeGardenId)
    if (value) setGarden(gardenDraft(value))
  }, [activeGardenId, gardens.data])
  const saveProfile = useMutation({
    mutationFn: () => post<PublicProfile>('/api/v1/social/profile/save', profilePayload(profile)),
    onSuccess: async (value) => { setProfile(profileDraft(value)); await queryClient.invalidateQueries({ queryKey: ['my-public-profile'] }) },
  })
  const saveGarden = useMutation({
    mutationFn: () => post<Garden>(garden.id ? '/api/v1/social/gardens/update' : '/api/v1/social/gardens/create', gardenPayload(garden)),
    onSuccess: async (value) => { setActiveGardenId(value.id); await queryClient.invalidateQueries({ queryKey: ['my-gardens'] }) },
  })
  const savedGarden = gardens.data?.find((item) => item.id === activeGardenId)
  return <div className="content-page social-app-page profile-settings-page">
    <header className="page-header"><div><p className="eyebrow">公开创作</p><h1>个人主页与知识花园</h1><p>配置公开身份、主题、导航、SEO、RSS，并把公开知识库编排为花园。</p></div>{profileQuery.data && <Link className="button secondary" to={`/u/${profileQuery.data.slug}`} target="_blank">查看主页<ExternalLink /></Link>}</header>
    <div className="settings-columns">
      <section className="settings-card"><SettingsHeader index="01" title="公开主页" description="这是读者认识你的第一站。" />
        <div className="settings-form-grid"><TextField label="主页路径" value={profile.slug} onChange={(value) => setProfile({ ...profile, slug: slugify(value) })} prefix="/u/" /><TextField label="显示名称" value={profile.displayName} onChange={(displayName) => setProfile({ ...profile, displayName })} /><TextField label="头像 URL" value={profile.avatarUrl} onChange={(avatarUrl) => setProfile({ ...profile, avatarUrl })} /><TextField label="封面 URL" value={profile.coverUrl} onChange={(coverUrl) => setProfile({ ...profile, coverUrl })} /><label className="field full"><span className="field-label">简介</span><textarea value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} rows={4} maxLength={1000} /></label><ThemeField value={profile.theme} onChange={(theme) => setProfile({ ...profile, theme })} /><label className="field full"><span className="field-label">顶部导航（每行：名称 | 链接）</span><textarea value={profile.navigation} onChange={(event) => setProfile({ ...profile, navigation: event.target.value })} rows={4} placeholder={'关于我 | /u/me\n项目 | https://example.com'} /></label><TextField label="SEO 标题" value={profile.seoTitle} onChange={(seoTitle) => setProfile({ ...profile, seoTitle })} /><TextField label="SEO 描述" value={profile.seoDescription} onChange={(seoDescription) => setProfile({ ...profile, seoDescription })} /><ToggleField label="进入发现页" description="允许内容和主页进入公开发现流" checked={profile.discoverable} onChange={(discoverable) => setProfile({ ...profile, discoverable })} /><ToggleField label="开放 RSS" description="为主页生成可订阅的 RSS 地址" checked={profile.rssEnabled} onChange={(rssEnabled) => setProfile({ ...profile, rssEnabled })} /></div>
        {(saveProfile.error || profileQuery.error && profileQuery.error instanceof Error && !profileQuery.data) && <div className="form-note">{saveProfile.error ? messageOf(saveProfile.error) : '尚未创建公开主页，填写后保存即可。'}</div>}
        <div className="settings-actions"><button className="button primary" onClick={() => saveProfile.mutate()} disabled={!profile.slug || !profile.displayName || saveProfile.isPending}>{saveProfile.isPending && <LoaderCircle className="spin" />}保存公开主页</button></div>
      </section>
      <section className="settings-card"><SettingsHeader index="02" title="知识花园" description="一个主页可以维护多个主题花园。" />
        <div className="garden-switcher"><button className={activeGardenId === 'NEW' ? 'active' : ''} onClick={() => setActiveGardenId('NEW')}>＋ 新花园</button>{(gardens.data ?? []).map((item) => <button key={item.id} className={activeGardenId === item.id ? 'active' : ''} onClick={() => setActiveGardenId(item.id)}>{item.icon || '🌿'} {item.title}</button>)}</div>
        <div className="settings-form-grid"><TextField label="花园路径" value={garden.slug} onChange={(value) => setGarden({ ...garden, slug: slugify(value) })} prefix="/garden/" /><TextField label="花园标题" value={garden.title} onChange={(title) => setGarden({ ...garden, title })} /><TextField label="图标" value={garden.icon} onChange={(icon) => setGarden({ ...garden, icon })} /><TextField label="封面 URL" value={garden.coverUrl} onChange={(coverUrl) => setGarden({ ...garden, coverUrl })} /><label className="field full"><span className="field-label">花园简介</span><textarea value={garden.description} onChange={(event) => setGarden({ ...garden, description: event.target.value })} rows={3} /></label><ThemeField value={garden.theme} onChange={(theme) => setGarden({ ...garden, theme })} /><label className="field full"><span className="field-label">花园导航（每行：名称 | 链接）</span><textarea value={garden.navigation} onChange={(event) => setGarden({ ...garden, navigation: event.target.value })} rows={3} /></label><TextField label="SEO 标题" value={garden.seoTitle} onChange={(seoTitle) => setGarden({ ...garden, seoTitle })} /><TextField label="SEO 描述" value={garden.seoDescription} onChange={(seoDescription) => setGarden({ ...garden, seoDescription })} /><ToggleField label="进入发现页" description="允许花园出现在发现页" checked={garden.discoverable} onChange={(discoverable) => setGarden({ ...garden, discoverable })} /><ToggleField label="开放 RSS" description="保留独立订阅开关" checked={garden.rssEnabled} onChange={(rssEnabled) => setGarden({ ...garden, rssEnabled })} />
          <fieldset className="kb-picker full"><legend>收录公开知识库</legend>{publicKnowledgeBases.isPending ? <small>正在读取知识库…</small> : (publicKnowledgeBases.data ?? []).map((kb) => <label key={kb.id}><input type="checkbox" checked={garden.knowledgeBaseIds.includes(kb.id)} onChange={() => setGarden({ ...garden, knowledgeBaseIds: garden.knowledgeBaseIds.includes(kb.id) ? garden.knowledgeBaseIds.filter((id) => id !== kb.id) : [...garden.knowledgeBaseIds, kb.id] })} /><span>{kb.icon || '📚'}</span><div><strong>{kb.name}</strong><small>{kb.description || kb.slug}</small></div></label>)}{!publicKnowledgeBases.isPending && !publicKnowledgeBases.data?.length && <p>暂无公开知识库。先把知识库可见性设为公开，再加入花园。</p>}</fieldset>
        </div>
        {saveGarden.error && <div className="form-error">{messageOf(saveGarden.error)}</div>}
        <div className="settings-actions">{savedGarden && <button className="button danger" onClick={() => setDeleteTarget(savedGarden)}><Trash2 />删除花园</button>}{garden.id && <Link className="button quiet" to={`/garden/${garden.slug}`} target="_blank">查看花园<ExternalLink /></Link>}<button className="button primary" onClick={() => saveGarden.mutate()} disabled={!profileQuery.data || !garden.slug || !garden.title || saveGarden.isPending}>{saveGarden.isPending && <LoaderCircle className="spin" />}{garden.id ? '保存花园' : '创建花园'}</button></div>
      </section>
    </div>
    {deleteTarget && <GardenDeleteDialog garden={deleteTarget} onClose={() => setDeleteTarget(null)} onDeleted={() => { setDeleteTarget(null); setActiveGardenId('NEW') }} />}
  </div>
}

export function GardenDeleteDialog({ garden, onClose, onDeleted }: { garden: Garden; onClose: () => void; onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const [confirmation, setConfirmation] = useState('')
  const remove = useMutation({
    mutationFn: () => post('/api/v1/social/gardens/delete', { gardenId: garden.id }),
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['my-gardens'] }); onDeleted() },
  })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !remove.isPending && onClose()}><section className="dialog garden-delete-dialog" role="dialog" aria-modal="true" aria-label="删除知识花园"><div className="dialog-head"><div><p className="eyebrow">危险操作</p><h2>永久删除“{garden.title}”</h2></div><button className="icon-button" onClick={onClose} disabled={remove.isPending} aria-label="关闭"><X /></button></div><div className="garden-delete-warning"><Trash2 /><div><strong>公开地址会立即失效</strong><p>花园编排、关注关系会被删除；知识库和其中的文稿不会受到影响。</p></div></div><label className="field"><span className="field-label">输入花园标题以确认</span><input aria-label="花园标题确认" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoFocus autoComplete="off" /><small>请输入：{garden.title}</small></label>{remove.error && <div className="form-error">{messageOf(remove.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose} disabled={remove.isPending}>取消</button><button className="button danger" onClick={() => remove.mutate()} disabled={confirmation !== garden.title || remove.isPending}>{remove.isPending ? <LoaderCircle className="spin" /> : <Trash2 />}{remove.isPending ? '正在删除' : '永久删除花园'}</button></div></section></div>
}

function PublicShell({ children, viewer, theme = 'PAPER', navigation = [] }: { children: React.ReactNode; viewer?: CurrentUser; theme?: PublicProfile['theme']; navigation?: PublicProfile['navigation'] }) {
  const safeNavigation = navigation.flatMap((item) => { const url = safePublicNavigationUrl(item.url); return url && item.label?.trim() ? [{ label: item.label.trim(), url }] : [] })
  return <div className={`public-shell public-theme-${theme.toLowerCase()}`}><header className="public-topbar"><Link className="brand compact" to="/"><span className="brand-mark">序</span><span>知序</span></Link><nav><Link to="/explore"><Compass />发现</Link>{safeNavigation.map((item, index) => <a key={`${item.url}-${index}`} href={item.url}>{item.label}</a>)}</nav><div>{viewer ? <><Link to="/app/feed">关注动态</Link><Link className="public-avatar" to="/app/profile">{viewer.email.slice(0, 1).toUpperCase()}</Link></> : <><Link to="/login">登录</Link><Link className="button primary small" to="/register">开始使用</Link></>}</div></header>{children}<footer className="public-footer"><span><span className="brand-mark">序</span>知序</span><p>让知识安静生长，也让它抵达需要的人。</p><Link to="/explore">继续发现</Link></footer></div>
}

function ContentGrid({ items, viewer }: { items: PublicContent[]; viewer?: CurrentUser }) {
  if (!items.length) return <PublicEmpty title="这里还没有公开内容" description="发布后的内容会按时间出现在这里。" />
  return <div className="public-content-grid">{items.map((item) => <ContentCard item={item} viewer={viewer} key={item.publicationId} />)}</div>
}

function PagedContent({ items, viewer, pending, error, hasMore, loadingMore, onLoadMore, emptyTitle }: { items: PublicContent[]; viewer?: CurrentUser; pending: boolean; error: unknown; hasMore: boolean; loadingMore: boolean; onLoadMore: () => void; emptyTitle: string }) {
  if (pending) return <PublicLoading />
  if (error) return <PublicError error={error} />
  if (!items.length) return <PublicEmpty title={emptyTitle} description="发布后的内容会按时间出现在这里。" />
  return <><ContentGrid items={items} viewer={viewer} />{hasMore && <PageLoadMore onClick={onLoadMore} loading={loadingMore} label="加载更多内容" />}</>
}

function PageLoadMore({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return <button className="button secondary social-page-more" onClick={onClick} disabled={loading}>{loading && <LoaderCircle className="spin" />}{loading ? '正在加载' : label}</button>
}

function ContentCard({ item, viewer }: { item: PublicContent; viewer?: CurrentUser }) {
  const queryClient = useQueryClient()
  const react = useMutation({ mutationFn: (reactionType: string) => post('/api/v1/social/reactions/toggle', { publicationId: item.publicationId, reactionType }), onSuccess: () => queryClient.invalidateQueries({ queryKey: ['social'] }) })
  return <article className="public-content-card"><Link className="content-card-main" to={`/p/${item.publicationId}`}><div className="content-card-meta"><span>{item.knowledgeBaseName}</span><span>{formatDate(item.publishedAt)}</span></div><h3>{item.title}</h3><p>{item.preview || '打开阅读完整内容'}</p><span className="read-more">阅读全文 <ExternalLink /></span></Link><footer><Link to={`/u/${item.authorSlug}`}><Avatar src={item.authorAvatar} label={item.authorName} />{item.authorName}</Link><ReactionBar compact item={item} viewer={viewer} onReact={(type) => react.mutate(type)} pending={react.isPending} /></footer></article>
}

function ReactionBar({ item, viewer, onReact, pending = false, compact = false }: { item: PublicContent; viewer?: CurrentUser; onReact: (type: string) => void; pending?: boolean; compact?: boolean }) {
  const visible = compact ? reactionOptions.slice(0, 2) : reactionOptions
  return <div className={`reaction-bar ${compact ? 'compact' : ''}`}>{visible.map((reaction) => { const active = item.viewerReactions.includes(reaction.type); const count = item.reactions[reaction.type] ?? 0; return viewer ? <button key={reaction.type} className={active ? 'active' : ''} onClick={(event) => { event.preventDefault(); onReact(reaction.type) }} disabled={pending} title={reaction.label}>{reaction.icon}{!compact && <span>{reaction.label}</span>}{count > 0 && <small>{count}</small>}</button> : <Link key={reaction.type} to="/login" title="登录后回应">{reaction.icon}{count > 0 && <small>{count}</small>}</Link> })}</div>
}

function CreatorGrid({ items }: { items: PublicProfile[] }) { return <div className="creator-grid">{items.map((item) => <Link className="creator-card" to={`/u/${item.slug}`} key={item.userId}><Avatar src={item.avatarUrl} label={item.displayName} large /><h3>{item.displayName}</h3><span>@{item.slug}</span><p>{item.bio || '持续整理和分享知识'}</p><small>{item.followerCount} 位关注者</small></Link>)}{!items.length && <PublicEmpty title="暂无推荐创作者" description="公开创作者会出现在这里。" />}</div> }
function GardenGrid({ items }: { items: Garden[] }) { return <div className="garden-grid">{items.map((item) => <Link className="garden-card" to={`/garden/${item.slug}`} key={item.id} style={coverStyle(item.coverUrl)}><span>{item.icon || '🌿'}</span><p className="eyebrow">{item.ownerName}</p><h3>{item.title}</h3><p>{item.description || '一座持续生长的知识花园'}</p><small>{item.knowledgeBases.length} 个知识库 · {item.followerCount} 位关注者</small></Link>)}{!items.length && <PublicEmpty title="暂无知识花园" description="公开花园会出现在这里。" />}</div> }

export function PublicContentBody({ reader, databaseFormPublicationId, resolveMediaUrl }: { reader: Pick<PublicReader, 'content' | 'plainText'> & { documentSettings?: unknown; metadata: Pick<PublicReader['metadata'], 'contentType'> }; databaseFormPublicationId?: string; resolveMediaUrl?: (url: string) => string }) {
  const model = asRecord(reader.content)
  if (reader.metadata.contentType === 'WHITEBOARD') {
    const elements = Array.isArray(model?.elements) ? model.elements.map(asRecord).filter(Boolean) : []
    return <div className="reader-board"><div>{elements.map((element, index) => { const id = String(element?.id || index); const kind = String(element?.kind || '').toUpperCase(); const style = { left: numberOf(element?.x), top: numberOf(element?.y), width: numberOf(element?.width, 160), height: numberOf(element?.height, 80), background: String(element?.color || '#fff') }; return kind === 'ARROW' ? <svg key={id} className="reader-board-arrow" style={style}><defs><marker id={`reader-arrow-${id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker></defs><line x1="2" y1="12" x2={Math.max(2, numberOf(element?.width, 160) - 9)} y2="12" markerEnd={`url(#reader-arrow-${id})`} /></svg> : <div key={id} className={`reader-board-element kind-${kind.toLowerCase()}`} style={style}>{String(element?.text || '')}</div> })}</div>{!elements.length && <PublicEmpty title="空白画板" description="作者尚未在画板中添加内容。" />}</div>
  }
  if (reader.metadata.contentType === 'SPREADSHEET') {
    const sheets = Array.isArray(model?.sheets) ? model.sheets.map(asRecord).filter(Boolean) : []
    return <div className="reader-sheets">{sheets.map((sheet, index) => { const sourceRows = Array.isArray(sheet?.rows) ? sheet.rows : []; const rows = sourceRows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []); const filter = typeof sheet?.filter === 'string' ? sheet.filter.toLowerCase() : ''; const hiddenRows = new Set(Array.isArray(sheet?.hiddenRows) ? sheet.hiddenRows.filter((row): row is number => typeof row === 'number') : []); const hiddenColumns = new Set(Array.isArray(sheet?.hiddenColumns) ? sheet.hiddenColumns.filter((column): column is number => typeof column === 'number') : []); const visible = rows.map((row, rowIndex) => ({ row, rowIndex })).filter(({ row, rowIndex }) => !hiddenRows.has(rowIndex) && (!filter || row.some((cell) => cell.toLowerCase().includes(filter)))); const width = Math.max(1, ...rows.map((row) => row.length)); const columns = Array.from({ length: width }, (_, column) => column).filter((column) => !hiddenColumns.has(column)); const styles = asRecord(sheet?.styles); const frozenRows = numberOf(sheet?.frozenRows); const frozenColumns = numberOf(sheet?.frozenColumns); return <section key={String(sheet?.id || index)}><h2>{String(sheet?.name || `工作表 ${index + 1}`)}</h2><div><table><tbody>{visible.map(({ row, rowIndex }) => <tr key={rowIndex} className={rowIndex < frozenRows ? 'frozen' : ''}>{columns.map((column, visibleColumn) => { const style = asRecord(styles?.[`${rowIndex}:${column}`]); const frozen = column < frozenColumns; const calculated = displaySpreadsheetCell({ rows }, rowIndex, column); return <td key={column} className={frozen ? 'frozen-column' : ''} title={row[column]?.startsWith('=') ? row[column] : undefined} style={{ fontWeight: style?.bold ? 700 : undefined, fontStyle: style?.italic ? 'italic' : undefined, textDecoration: style?.underline ? 'underline' : undefined, textAlign: typeof style?.align === 'string' ? style.align.toLowerCase() as React.CSSProperties['textAlign'] : undefined, color: typeof style?.color === 'string' ? style.color : undefined, background: typeof style?.background === 'string' ? style.background : undefined, left: frozen ? visibleColumn * 110 : undefined }}>{formatSpreadsheetValue(calculated, typeof style?.numberFormat === 'string' ? style.numberFormat : undefined)}</td> })}</tr>)}</tbody></table></div></section>})}{!sheets.length && <PublicEmpty title="空白电子表格" description="作者尚未录入数据。" />}</div>
  }
  if (reader.metadata.contentType === 'DATABASE') {
    return <div className="reader-database"><DatabaseCardView data={model ?? {}} />{databaseFormPublicationId && <PublicDatabaseForm data={model ?? {}} publicationId={databaseFormPublicationId} />}</div>
  }
  return <PublicDocumentBody body={documentText(reader.content, reader.plainText)} showOutline={normalizeDocumentSettings(reader.documentSettings).showOutline} resolveMediaUrl={resolveMediaUrl} />
}

type PublicDatabaseFormField = { id: string; name: string; type: string; options: string[]; required: boolean }
type DatabaseFormSubmission = { rowId: string; duplicate: boolean; submittedAt: string }

function PublicDatabaseForm({ data, publicationId }: { data: Record<string, unknown>; publicationId: string }) {
  const form = asRecord(data.form)
  const configured = Array.isArray(form?.fieldIds) ? form.fieldIds.filter((id): id is string => typeof id === 'string') : []
  const required = new Set(Array.isArray(form?.requiredFieldIds) ? form.requiredFieldIds.filter((id): id is string => typeof id === 'string') : [])
  const fields: PublicDatabaseFormField[] = (Array.isArray(data.fields) ? data.fields : []).flatMap((item) => {
    const field = asRecord(item); if (!field) return []
    const id = typeof field.id === 'string' ? field.id : ''
    const type = typeof field.type === 'string' ? field.type : 'TEXT'
    if (!id || ['FORMULA', 'ROLLUP'].includes(type) || configured.length && !configured.includes(id)) return []
    return [{ id, name: typeof field.name === 'string' && field.name ? field.name : '字段', type, options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string') : [], required: required.has(id) }]
  })
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID())
  const [complete, setComplete] = useState(false)
  const submission = useMutation({
    mutationFn: () => post<DatabaseFormSubmission>('/api/public/v1/database-forms/submit', { publicationId, idempotencyKey, values }, false),
    onSuccess: () => setComplete(true),
  })
  if (!form?.enabled || !fields.length) return null
  const title = typeof form.title === 'string' && form.title.trim() ? form.title : '提交信息'
  const description = typeof form.description === 'string' ? form.description : ''
  const submitLabel = typeof form.submitLabel === 'string' && form.submitLabel.trim() ? form.submitLabel : '提交'
  const successMessage = typeof form.successMessage === 'string' && form.successMessage.trim() ? form.successMessage : '提交成功，感谢你的填写。'
  if (complete) return <section className="public-database-form success"><span><Check /></span><div><h2>{successMessage}</h2><p>你的信息已安全写入作者的数据表。</p><button className="button secondary small" onClick={() => { setValues({}); setIdempotencyKey(crypto.randomUUID()); setComplete(false); submission.reset() }}>再提交一条</button></div></section>
  return <section className="public-database-form"><header><span><ClipboardList /></span><div><p className="eyebrow">公开表单</p><h2>{title}</h2>{description && <p>{description}</p>}</div></header><form onSubmit={(event) => { event.preventDefault(); submission.mutate() }}>{fields.map((field) => <label className="field" key={field.id}><span className="field-label">{field.name}{field.required && <i>必填</i>}</span><PublicDatabaseFormInput field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} /></label>)}{submission.error && <div className="form-error">{messageOf(submission.error)}</div>}<button className="button primary" disabled={submission.isPending}>{submission.isPending ? <LoaderCircle className="spin" /> : <Send />}{submission.isPending ? '正在提交' : submitLabel}</button></form></section>
}

function PublicDatabaseFormInput({ field, value, onChange }: { field: PublicDatabaseFormField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === 'CHECKBOX') return <input type="checkbox" checked={Boolean(value)} required={field.required} onChange={(event) => onChange(event.target.checked)} />
  if (field.type === 'SELECT') return <select value={typeof value === 'string' ? value : ''} required={field.required} onChange={(event) => onChange(event.target.value)}><option value="">请选择</option>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
  if (field.type === 'MULTI_SELECT') return <select multiple value={Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []} required={field.required} onChange={(event) => onChange([...event.target.selectedOptions].map((option) => option.value))}>{field.options.map((option) => <option key={option}>{option}</option>)}</select>
  const inputType = field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : field.type === 'URL' ? 'url' : 'text'
  return <input type={inputType} value={typeof value === 'string' || typeof value === 'number' ? value : ''} required={field.required} maxLength={field.type === 'EMAIL' ? 320 : field.type === 'URL' ? 2000 : 4000} onChange={(event) => onChange(field.type === 'NUMBER' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />
}

export function ReaderLabels({ labels }: { labels: string[] | undefined }) {
  const values = Array.isArray(labels) ? labels.filter((label) => typeof label === 'string' && label.trim()).slice(0, 20) : []
  return values.length ? <div className="reader-labels" aria-label="文稿标签">{values.map((label) => <span key={label}><Tag />{label}</span>)}</div> : null
}

function PublicDocumentBody({ body, showOutline, resolveMediaUrl }: { body: string; showOutline: boolean; resolveMediaUrl?: (url: string) => string }) {
  const headings = publicDocumentHeadings(body)
  const cards = parseContentCardTokens(body)
  let document: React.ReactNode
  if (!cards.length) {
    document = <div className="reader-document">{publicDocumentBlocks(body)}</div>
  } else {
    const content: React.ReactNode[] = []
    let cursor = 0
    for (const card of cards) {
      const before = body.slice(cursor, card.start)
      if (before.trim()) content.push(<div className="reader-prose-segment" key={`text-${cursor}`}>{publicDocumentBlocks(before, cursor)}</div>)
      content.push(<PublicContentCard card={card} resolveMediaUrl={resolveMediaUrl} key={`${card.instanceId}-${card.start}`} />)
      cursor = card.end
    }
    const after = body.slice(cursor)
    if (after.trim()) content.push(<div className="reader-prose-segment" key={`text-${cursor}`}>{publicDocumentBlocks(after, cursor)}</div>)
    document = <div className="reader-document reader-document-rich">{content}</div>
  }
  return <div className="reader-document-layout">{showOutline && headings.length > 1 && <aside className="reader-document-outline"><details open><summary><ListTree />本文大纲<span>{headings.length}</span></summary><nav aria-label="本文大纲">{headings.map((heading) => <a href={`#section-${heading.offset}`} className={heading.kind === 'H2' ? 'level-2' : ''} key={heading.offset}>{publicInlineContent(heading.content)}</a>)}</nav></details></aside>}{document}</div>
}

function PublicContentCard({ card, resolveMediaUrl }: { card: ParsedContentCard; resolveMediaUrl?: (url: string) => string }) {
  const data = card.data
  if (!card.supportedEncoding || !data) return <article className="content-card unknown"><FileQuestion /><div><strong>无法显示的卡片</strong><p>{card.cardId} · schema v{card.version}</p></div></article>
  if (card.cardId === 'image') { const url = resolvedMediaUrl(data.url, resolveMediaUrl); return <article className={`content-card media-card ${imageWidthClassName(data.width)}`}>{url ? <img src={url} alt={cardText(data.alt, '')} loading="lazy" referrerPolicy="no-referrer" /> : <PublicMediaPlaceholder title="图片不可用" />}</article> }
  if (card.cardId === 'audio') { const url = resolvedMediaUrl(data.url, resolveMediaUrl); return <article className="content-card media-card"><strong>{cardText(data.title, '音频')}</strong>{url ? <audio controls preload="metadata" src={url} /> : <PublicMediaPlaceholder title="音频不可用" />}</article> }
  if (card.cardId === 'video') { const url = resolvedMediaUrl(data.url, resolveMediaUrl); return <article className="content-card media-card"><strong>{cardText(data.title, '视频')}</strong>{url ? <video controls preload="metadata" src={url} /> : <PublicMediaPlaceholder title="视频不可用" />}</article> }
  if (['attachment', 'file-preview', 'office'].includes(card.cardId)) { const url = resolvedMediaUrl(data.url, resolveMediaUrl); return <article className="content-card file-content-card"><span><Paperclip /></span><div><small>{publicCardTitle(card.cardId)}</small><strong>{cardText(data.name, '未命名文件')}</strong><p>{cardText(data.mediaType, '')}</p></div>{url ? <a className="button secondary small" href={publicDownloadUrl(url)} referrerPolicy="no-referrer"><Download />下载</a> : <PublicMediaPlaceholder title="文件不可用" />}</article> }
  if (card.cardId === 'pdf') { const url = resolvedMediaUrl(data.url, resolveMediaUrl); const previewUrl = url?.startsWith('/') ? url : null; return <article className="content-card pdf-content-card"><header><FileText /><strong>{cardText(data.name, 'PDF 文档')}</strong>{url && <a href={publicDownloadUrl(url)} referrerPolicy="no-referrer"><Download />下载</a>}</header>{previewUrl ? <iframe src={previewUrl} title={cardText(data.name, 'PDF 文档')} sandbox="" referrerPolicy="no-referrer" loading="lazy" /> : <PublicMediaPlaceholder title={url ? '外部 PDF 请通过下载链接查看' : 'PDF 不可用'} />}</article> }
  if (['youtube', 'bilibili', 'music', 'map', 'figma'].includes(card.cardId)) {
    const url = allowedProviderUrl(card.cardId, data.url)
    const title = publicCardTitle(card.cardId)
    return <article className="content-card provider-card"><header><strong>{title}</strong>{url && <a href={url} target="_blank" rel="noreferrer">打开来源<ExternalLink /></a>}</header>{url ? <iframe src={url} title={title} sandbox="allow-scripts allow-same-origin allow-presentation" referrerPolicy="no-referrer" loading="lazy" /> : <PublicMediaPlaceholder title="嵌入地址不可用" />}</article>
  }
  if (card.cardId === 'quote') return <blockquote className="content-card quote-card"><p>{cardText(data.text, '引用内容')}</p><cite>{cardText(data.source, '')}</cite></blockquote>
  if (card.cardId === 'callout') return <aside className="content-card callout-card"><strong>{cardText(data.tone, 'INFO')}</strong><p>{cardText(data.text, '提示内容')}</p></aside>
  if (card.cardId === 'toggle') return <details className="content-card toggle-card"><summary>{cardText(data.title, '折叠标题')}</summary><p>{cardText(data.content, '')}</p></details>
  if (card.cardId === 'divider') return <div className="content-card-divider" role="separator" />
  if (card.cardId === 'status') return <article className={`content-card status-card status-${cardText(data.value, 'TODO').toLowerCase()}`}><CircleDot /><div><small>状态</small><strong>{cardText(data.label, cardText(data.value, 'TODO'))}</strong></div></article>
  if (card.cardId === 'code' || card.cardId === 'text-diagram') return <article className="content-card code-card"><header><Code2 />{cardText(data.language, card.cardId)}</header><pre>{cardText(data.code ?? data.source, '')}</pre></article>
  if (card.cardId === 'flowchart' || card.cardId === 'mermaid' || card.cardId === 'uml') return <TechnicalDiagramCard cardId={card.cardId} source={cardText(data.source, '')} />
  if (card.cardId === 'formula') return <FormulaCardView latex={cardText(data.latex, '')} />
  if (card.cardId === 'mind-map') return <MindMapCardView data={data} />
  if (card.cardId === 'gallery') return <PublicGalleryCard data={data} resolveMediaUrl={resolveMediaUrl} />
  if (card.cardId === 'table') return <PublicTableCard data={data} />
  if (card.cardId === 'columns') return <PublicColumnsCard data={data} offset={card.start} />
  if (card.cardId === 'calendar') return <PublicCalendarCard data={data} />
  if (card.cardId === 'poll') {
    const options = Array.isArray(data.options) ? data.options.map(asRecord).filter(Boolean) : []
    return <article className="content-card poll-card public-static-card"><header><Vote /><div><small>投票</small><strong>{cardText(data.question, '投票')}</strong></div></header><div className="public-card-options">{options.map((option, index) => <span key={cardText(option?.id, String(index))}>{cardText(option?.label, `选项 ${index + 1}`)}</span>)}</div></article>
  }
  if (card.cardId === 'checkin') return <article className="content-card checkin-card public-static-card"><CalendarCheck /><div><small>打卡</small><strong>{cardText(data.title, '每日打卡')}</strong><p>登录并打开工作区文稿后可参与</p></div></article>
  if (card.cardId === 'sensitive-text') return <SensitiveTextCard data={data} />
  if (card.cardId === 'mention') return <span className="content-card mention-content-card"><AtSign /><strong>{cardText(data.label, '成员')}</strong></span>
  if (card.cardId === 'kanban') return <PublicKanbanCard data={data} />
  if (card.cardId === 'database') return <DatabaseCardView data={data} />
  if (card.cardId === 'whiteboard' || card.cardId === 'drawio' || card.cardId === 'excalidraw') return <DrawingCardView cardId={card.cardId} data={data} />
  return <article className="content-card generic-card"><Palette /><div><small>内容卡片</small><strong>{publicCardTitle(card.cardId)}</strong><p>schema v{card.version}</p></div></article>
}

function PublicTableCard({ data }: { data: Record<string, unknown> }) {
  const rows = Array.isArray(data.rows) ? data.rows.filter(Array.isArray).slice(0, 100) as unknown[][] : []
  return <div className="content-card table-card"><table><tbody>{rows.map((row, rowIndex) => <tr key={rowIndex}>{row.slice(0, 20).map((cell, cellIndex) => <td key={cellIndex}>{cardText(cell, '')}</td>)}</tr>)}</tbody></table></div>
}

function PublicGalleryCard({ data, resolveMediaUrl }: { data: Record<string, unknown>; resolveMediaUrl?: (url: string) => string }) {
  const items = Array.isArray(data.items) ? data.items.map(asRecord).filter(Boolean).slice(0, 100) : []
  return <article className="content-card gallery-content-card">{items.map((item, index) => { const url = resolvedMediaUrl(item?.url, resolveMediaUrl); return <figure key={cardText(item?.id ?? item?.attachmentId, String(index))}>{url ? <img src={url} alt={cardText(item?.alt, '')} loading="lazy" referrerPolicy="no-referrer" /> : <PublicMediaPlaceholder title="图片不可用" />}{cardText(item?.alt, '') && <figcaption>{cardText(item?.alt, '')}</figcaption>}</figure> })}</article>
}

function PublicCalendarCard({ data }: { data: Record<string, unknown> }) {
  const events = Array.isArray(data.events) ? data.events.map(asRecord).filter(Boolean).slice(0, 500) : []
  return <article className="content-card calendar-card"><header><CalendarCheck /><strong>日历</strong><small>{cardText(data.timezone, 'Asia/Shanghai')}</small></header>{events.length ? events.map((event, index) => <div key={cardText(event?.id, String(index))}><time>{publicCalendarDate(event?.start)}</time><span>{cardText(event?.title, '未命名日程')}</span>{Boolean(event?.end) && <small>至 {publicCalendarDate(event?.end)}</small>}</div>) : <p>还没有日程</p>}</article>
}

function PublicColumnsCard({ data, offset }: { data: Record<string, unknown>; offset: number }) {
  const columns = Array.isArray(data.columns) ? data.columns.map(asRecord).filter(Boolean).slice(0, 4) : []
  const ratios = Array.isArray(data.ratios) && data.ratios.length === columns.length
    ? data.ratios.map((value) => typeof value === 'number' && value > 0 ? value : 1)
    : columns.map(() => 1)
  return <article className="content-card columns-content-card public-columns-card" style={{ gridTemplateColumns: ratios.map((ratio) => `${ratio}fr`).join(' ') }}>{columns.map((column, index) => <section key={index}>{publicDocumentBlocks(cardText(column?.content, ''), offset + (index + 1) * 100_000)}</section>)}</article>
}

function PublicKanbanCard({ data }: { data: Record<string, unknown> }) {
  const columns = Array.isArray(data.columns) ? data.columns.map(asRecord).filter(Boolean).slice(0, 20) : []
  return <article className="content-card kanban-content-card">{columns.map((column, index) => { const cards = Array.isArray(column?.cards) ? column.cards.map(asRecord).filter(Boolean).slice(0, 200) : []; const rawColor = cardText(column?.color, ''); const color = /^#[0-9a-fA-F]{6}$/.test(rawColor) ? rawColor : '#6f9c7e'; return <section key={cardText(column?.id, String(index))} style={{ '--kanban-color': color } as React.CSSProperties}><header><i /><strong>{cardText(column?.title, '看板列')}</strong><span>{cards.length}</span></header>{cards.map((card, cardIndex) => <div key={cardText(card?.id, String(cardIndex))}><strong>{cardText(card?.title, '未命名卡片')}</strong>{Boolean(card?.description) && <p>{cardText(card?.description, '')}</p>}</div>)}{!cards.length && <small>暂无卡片</small>}</section> })}</article>
}

function PublicMediaPlaceholder({ title }: { title: string }) { return <div className="media-placeholder"><Palette /><span>{title}</span></div> }

function documentText(content: unknown, fallback: string) {
  const root = asRecord(content)
  const blocks = Array.isArray(root?.content) ? root.content : []
  const values: string[] = []
  const collect = (value: unknown, key = '') => {
    if (typeof value === 'string') { if (key === 'text') values.push(value); return }
    if (Array.isArray(value)) { value.forEach((item) => collect(item, key)); return }
    const record = asRecord(value)
    if (record) Object.entries(record).forEach(([name, item]) => collect(item, name))
  }
  blocks.forEach((block) => collect(block))
  return values.length ? values.join('\n\n') : fallback
}

type PublicBlockKind = 'PARAGRAPH' | 'H1' | 'H2' | 'QUOTE' | 'BULLET' | 'NUMBERED' | 'TODO' | 'CODE'
type PublicBlock = { kind: PublicBlockKind; content: string; checked: boolean; indent: number; order: number; offset: number }

function publicDocumentBlocks(value: string, baseOffset = 0) {
  const blocks = publicDocumentLines(value, baseOffset).map(({ line, offset }) => publicBlock(line, offset))
  const result: React.ReactNode[] = []
  let index = 0
  while (index < blocks.length) {
    const block = blocks[index]!
    if (!block.content && block.kind === 'PARAGRAPH') { index += 1; continue }
    if (block.kind === 'CODE') {
      const group = takePublicBlockGroup(blocks, index, 'CODE')
      result.push(<pre className="reader-code-block" key={`code-${index}`}><code>{group.items.map((item) => item.content).join('\n')}</code></pre>)
      index = group.end
      continue
    }
    if (block.kind === 'QUOTE') {
      const group = takePublicBlockGroup(blocks, index, 'QUOTE')
      result.push(<blockquote className="reader-quote-block" key={`quote-${index}`}>{group.items.map((item, offset) => <p key={offset}>{publicInlineContent(item.content)}</p>)}</blockquote>)
      index = group.end
      continue
    }
    if (block.kind === 'BULLET' || block.kind === 'NUMBERED' || block.kind === 'TODO') {
      const group = takePublicBlockGroup(blocks, index, block.kind)
      const items = group.items.map((item, offset) => <li key={offset} style={{ paddingInlineStart: `${Math.min(item.indent, 6) * 18}px` }} value={block.kind === 'NUMBERED' ? item.order : undefined}>{block.kind === 'TODO' && <input type="checkbox" checked={item.checked} readOnly aria-label={item.checked ? '已完成' : '未完成'} />}{publicInlineContent(item.content)}</li>)
      result.push(block.kind === 'NUMBERED'
        ? <ol className="reader-list reader-numbered-list" start={block.order} key={`list-${index}`}>{items}</ol>
        : <ul className={`reader-list ${block.kind === 'TODO' ? 'reader-todo-list' : ''}`} key={`list-${index}`}>{items}</ul>)
      index = group.end
      continue
    }
    if (block.kind === 'H1') result.push(<h2 className="reader-section-title" id={`section-${block.offset}`} key={index}>{publicInlineContent(block.content)}</h2>)
    else if (block.kind === 'H2') result.push(<h3 className="reader-subsection-title" id={`section-${block.offset}`} key={index}>{publicInlineContent(block.content)}</h3>)
    else result.push(<p key={index}>{publicInlineContent(block.content)}</p>)
    index += 1
  }
  return result
}

function publicBlock(line: string, offset = 0): PublicBlock {
  const indentation = line.match(/^\s*/)?.[0].replace(/\t/g, '  ').length ?? 0
  const rest = line.slice(line.match(/^\s*/)?.[0].length ?? 0)
  const match = rest.match(/^(###? |# |> |- \[[ xX]\] |- |(\d+)\. |``` )(.*)$/)
  if (!match) return { kind: 'PARAGRAPH', content: rest, checked: false, indent: Math.floor(indentation / 2), order: 1, offset }
  const marker = match[1] ?? ''
  const kind: PublicBlockKind = marker === '# ' ? 'H1' : marker === '## ' || marker === '### ' ? 'H2' : marker === '> ' ? 'QUOTE' : /^- \[[ xX]\] /.test(marker) ? 'TODO' : marker === '- ' ? 'BULLET' : /^\d+\. /.test(marker) ? 'NUMBERED' : marker === '``` ' ? 'CODE' : 'PARAGRAPH'
  return { kind, content: match[3] ?? '', checked: /- \[[xX]\] /.test(marker), indent: Math.floor(indentation / 2), order: Number(match[2] ?? 1), offset }
}

function publicDocumentHeadings(value: string) {
  return publicDocumentLines(value, 0)
    .map(({ line, offset }) => publicBlock(line, offset))
    .filter((block) => (block.kind === 'H1' || block.kind === 'H2') && block.content.trim())
}

function publicDocumentLines(value: string, baseOffset: number) {
  let offset = baseOffset
  return value.split(/\r?\n/).map((line) => {
    const result = { line, offset }
    offset += line.length + 1
    return result
  })
}

function takePublicBlockGroup(blocks: PublicBlock[], start: number, kind: PublicBlockKind) {
  let end = start
  while (end < blocks.length && blocks[end]?.kind === kind) end += 1
  return { items: blocks.slice(start, end), end }
}

function publicInlineContent(value: string) {
  const pattern = /(\*\*[^*\n]+\*\*|`[^`\n]+`|\[[^\]\n]+\]\(https:\/\/[^\s)]+\)|\*[^*\n]+\*)/gi
  const result: React.ReactNode[] = []
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const token = match[0]
    const start = match.index
    if (start > cursor) result.push(value.slice(cursor, start))
    if (token.startsWith('**')) result.push(<strong key={start}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('*')) result.push(<em key={start}>{token.slice(1, -1)}</em>)
    else if (token.startsWith('`')) result.push(<code key={start}>{token.slice(1, -1)}</code>)
    else {
      const link = token.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/i)
      result.push(link ? <a href={link[2]} target="_blank" rel="noreferrer nofollow" key={start}>{link[1]}</a> : token)
    }
    cursor = start + token.length
  }
  if (cursor < value.length) result.push(value.slice(cursor))
  return result.length ? result : value
}

function cardText(value: unknown, fallback: string) { return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback }
function resolvedMediaUrl(value: unknown, resolveMediaUrl?: (url: string) => string) { const url = safeMediaUrl(value); return url ? safeMediaUrl(resolveMediaUrl?.(url) ?? url) : null }
function publicCalendarDate(value: unknown) { if (typeof value !== 'string') return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }
function publicCardTitle(cardId: string) { return ({ image: '图片', attachment: '附件', audio: '音频', video: '视频', 'file-preview': '文件预览', pdf: 'PDF', office: 'Office 文档', youtube: 'YouTube', bilibili: '哔哩哔哩', music: '音乐', map: '地图', figma: 'Figma', poll: '投票', checkin: '打卡', status: '状态', table: '表格', formula: '公式' } as Record<string, string>)[cardId] ?? cardId }
function publicDownloadUrl(url: string) { return url.startsWith('/api/v1/attachments/') ? `${url}${url.includes('?') ? '&' : '?'}download=true` : url }

function SafetyMenu({ targetType, targetId, canBlock = false }: { targetType: 'USER' | 'GARDEN' | 'PUBLICATION'; targetId: string; canBlock?: boolean }) {
  const [open, setOpen] = useState(false)
  const [reported, setReported] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const report = useMutation({ mutationFn: () => post('/api/v1/social/reports/create', { targetType, targetId, reason: 'INAPPROPRIATE', details: '由用户从公开页面提交，等待管理员审核。' }), onSuccess: () => { setReported(true); setOpen(false) } })
  const block = useMutation({ mutationFn: () => post(`/api/v1/social/${blocked ? 'unblock' : 'block'}`, { userId: targetId }), onSuccess: () => { setBlocked((value) => !value); setOpen(false) } })
  return <div className="safety-menu"><button className="icon-button" onClick={() => setOpen((value) => !value)} title="更多" aria-label="打开安全与举报菜单" aria-expanded={open}><MessageCircleMore /></button>{open && <div><button onClick={() => report.mutate()} disabled={reported || report.isPending}><Flag />{reported ? '已提交举报' : '举报'}</button>{canBlock && <button onClick={() => block.mutate()} disabled={block.isPending}><ShieldBan />{blocked ? '取消拉黑' : '拉黑用户'}</button>}<button onClick={() => setOpen(false)}><X />关闭</button></div>}</div>
}

function PublicSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) { return <section className="public-section"><header><div><h2>{title}</h2>{description && <p>{description}</p>}</div></header>{children}</section> }
function Avatar({ src, label, large = false }: { src: string | null; label: string; large?: boolean }) { const url = safeMediaUrl(src); return url ? <img className={`profile-avatar ${large ? 'large' : ''}`} src={url} alt="" referrerPolicy="no-referrer" /> : <span className={`profile-avatar fallback ${large ? 'large' : ''}`}>{label.slice(0, 1).toUpperCase()}</span> }
function PublicLoading() { return <div className="public-state"><LoaderCircle className="spin" /><strong>正在载入公开知识</strong></div> }
function PublicError({ error }: { error: unknown }) { return <div className="public-state error"><Search /><strong>没有找到这片知识</strong><p>{messageOf(error)}</p><Link className="button secondary" to="/explore">返回发现</Link></div> }
function PublicEmpty({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) { return <div className="public-empty"><BookOpen /><strong>{title}</strong><p>{description}</p>{action}</div> }
function SettingsHeader({ index, title, description }: { index: string; title: string; description: string }) { return <header className="settings-card-head"><span>{index}</span><div><h2>{title}</h2><p>{description}</p></div></header> }
function TextField({ label, value, onChange, prefix }: { label: string; value: string; onChange: (value: string) => void; prefix?: string }) { return <label className="field"><span className="field-label">{label}</span><span className={prefix ? 'prefixed-input' : ''}>{prefix && <i>{prefix}</i>}<input value={value} onChange={(event) => onChange(event.target.value)} /></span></label> }
function ThemeField({ value, onChange }: { value: PublicProfile['theme']; onChange: (value: PublicProfile['theme']) => void }) { return <fieldset className="theme-picker full"><legend>页面主题</legend>{(['PAPER', 'MINIMAL', 'MAGAZINE', 'DARK'] as const).map((theme) => <button type="button" key={theme} className={`${theme.toLowerCase()} ${value === theme ? 'active' : ''}`} onClick={() => onChange(theme)}><i /><span>{({ PAPER: '纸张', MINIMAL: '极简', MAGAZINE: '杂志', DARK: '深色' })[theme]}</span>{value === theme && <Check />}</button>)}</fieldset> }
function ToggleField({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) { return <label className="toggle-field"><div><strong>{label}</strong><small>{description}</small></div><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} /><i /></label> }

function useViewer() { return useQuery({ queryKey: ['me'], queryFn: () => request<CurrentUser>('/api/v1/auth/me'), retry: false, staleTime: 60_000 }) }
function usePageMetadata(title: string, description: string) { useEffect(() => { const previous = document.title; document.title = title; let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]'); if (!meta) { meta = document.createElement('meta'); meta.name = 'description'; document.head.append(meta) } const old = meta.content; meta.content = description; return () => { document.title = previous; if (meta) meta.content = old } }, [title, description]) }
function coverStyle(value: string | null): React.CSSProperties | undefined { const url = safeMediaUrl(value); return url ? { backgroundImage: `linear-gradient(90deg,rgba(21,32,25,.44),rgba(21,32,25,.08)),url(${JSON.stringify(url).slice(1, -1)})` } : undefined }
function safePresentationUrl(value: string | null | undefined) { const url = safeMediaUrl(value); return url?.startsWith('https:') ? url : null }
function formatDate(value: string) { return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value)) }
function contentTypeLabel(value: PublicContent['contentType']) { return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[value] }
function publicSearchType(value: string | null) { return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' } as Record<string, string>)[value ?? ''] ?? '公开内容' }
function publicSearchIcon(value: string | null) { if (value === 'WHITEBOARD') return <Palette />; if (value === 'SPREADSHEET' || value === 'DATABASE') return <ClipboardList />; return <FileText /> }
function slugify(value: string) { return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) }
function parseNavigation(value: string) { return parsePublicNavigation(value) }
function navigationText(value: PublicProfile['navigation']) { return value.map((item) => `${item.label} | ${item.url}`).join('\n') }
function asRecord(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function numberOf(value: unknown, fallback = 0) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }

type ProfileDraft = { slug: string; displayName: string; bio: string; avatarUrl: string; coverUrl: string; theme: PublicProfile['theme']; navigation: string; seoTitle: string; seoDescription: string; discoverable: boolean; rssEnabled: boolean }
type GardenDraft = { id: string | null; slug: string; title: string; description: string; icon: string; coverUrl: string; theme: PublicProfile['theme']; navigation: string; seoTitle: string; seoDescription: string; discoverable: boolean; rssEnabled: boolean; knowledgeBaseIds: string[] }
function defaultProfile(user: CurrentUser): ProfileDraft { const base = user.email.split('@')[0] || 'author'; return { slug: slugify(base) || 'author', displayName: base, bio: '', avatarUrl: '', coverUrl: '', theme: 'PAPER', navigation: '', seoTitle: '', seoDescription: '', discoverable: true, rssEnabled: true } }
function profileDraft(value: PublicProfile): ProfileDraft { return { slug: value.slug, displayName: value.displayName, bio: value.bio || '', avatarUrl: value.avatarUrl || '', coverUrl: value.coverUrl || '', theme: value.theme, navigation: navigationText(value.navigation), seoTitle: value.seoTitle || '', seoDescription: value.seoDescription || '', discoverable: value.discoverable, rssEnabled: value.rssEnabled } }
function profilePayload(value: ProfileDraft) { return { ...value, navigation: parseNavigation(value.navigation), avatarUrl: value.avatarUrl || null, coverUrl: value.coverUrl || null, bio: value.bio || null, seoTitle: value.seoTitle || null, seoDescription: value.seoDescription || null } }
function emptyGarden(): GardenDraft { return { id: null, slug: '', title: '', description: '', icon: '🌿', coverUrl: '', theme: 'PAPER', navigation: '', seoTitle: '', seoDescription: '', discoverable: true, rssEnabled: true, knowledgeBaseIds: [] } }
function gardenDraft(value: Garden): GardenDraft { return { id: value.id, slug: value.slug, title: value.title, description: value.description || '', icon: value.icon || '', coverUrl: value.coverUrl || '', theme: value.theme, navigation: navigationText(value.navigation), seoTitle: value.seoTitle || '', seoDescription: value.seoDescription || '', discoverable: value.discoverable, rssEnabled: value.rssEnabled, knowledgeBaseIds: value.knowledgeBases.map((kb) => kb.id) } }
function gardenPayload(value: GardenDraft) { return { gardenId: value.id, slug: value.slug, title: value.title, description: value.description || null, icon: value.icon || null, coverUrl: value.coverUrl || null, theme: value.theme, navigation: parseNavigation(value.navigation), seoTitle: value.seoTitle || null, seoDescription: value.seoDescription || null, discoverable: value.discoverable, rssEnabled: value.rssEnabled, knowledgeBaseIds: value.knowledgeBaseIds } }
async function loadPublicKnowledgeBases(): Promise<KnowledgeBase[]> { const workspaces = await request<Workspace[]>('/api/v1/workspaces'); const groups = await Promise.all(workspaces.map((workspace) => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: workspace.id }))); return groups.flat().filter((kb) => kb.visibility === 'PUBLIC') }
