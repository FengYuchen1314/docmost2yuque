import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { BookOpen, FileText, LoaderCircle, Paperclip, Search, StickyNote, Users, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { messageOf, post } from '../lib/api'
import type { KnowledgeBase, SearchResponse, SearchResult, Workspace, WorkspaceMember } from '../types'

const resourceTypes = [
  ['PAGE', '文稿'],
  ['QUICK_NOTE', '小记'],
  ['KNOWLEDGE_BASE', '知识库'],
  ['TEAM', '团队'],
  ['USER', '成员'],
  ['TEMPLATE', '模板'],
  ['ATTACHMENT', '附件'],
] as const

export function SearchOverlay({ workspaces, open, onClose }: { workspaces: Workspace[]; open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [workspaceId, setWorkspaceId] = useState(() => workspaces[0]?.id ?? '')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<string[]>(resourceTypes.map(([value]) => value))
  const [activeIndex, setActiveIndex] = useState(0)
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const [creatorId, setCreatorId] = useState('')
  const [updatedWithin, setUpdatedWithin] = useState<'ANY' | 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'>('ANY')

  useEffect(() => {
    if (!workspaceId || !workspaces.some((item) => item.id === workspaceId)) {
      setWorkspaceId(workspaces[0]?.id ?? '')
      setKnowledgeBaseId('')
      setCreatorId('')
    }
  }, [workspaceId, workspaces])
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 180)
    return () => window.clearTimeout(timer)
  }, [query])
  useEffect(() => {
    if (!open) return
    setActiveIndex(0)
    window.requestAnimationFrame(() => inputRef.current?.focus())
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [open, onClose])

  const knowledgeBases = useQuery({ queryKey: ['knowledge-bases', workspaceId], queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }), enabled: open && Boolean(workspaceId) })
  const members = useQuery({ queryKey: ['workspace-members', workspaceId], queryFn: () => post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }), enabled: open && Boolean(workspaceId) })
  const updatedFrom = useMemo(() => {
    const days = ({ DAY: 1, WEEK: 7, MONTH: 30, YEAR: 365 } as Record<string, number>)[updatedWithin]
    return days ? new Date(Date.now() - days * 86_400_000).toISOString() : null
  }, [updatedWithin])
  const results = useInfiniteQuery({
    queryKey: ['global-search', workspaceId, debounced, selectedTypes, knowledgeBaseId, creatorId, updatedFrom],
    queryFn: ({ pageParam }) => post<SearchResponse>('/api/v1/search', {
      workspaceId,
      query: debounced,
      resourceTypes: selectedTypes,
      knowledgeBaseId: knowledgeBaseId || null,
      creatorId: creatorId || null,
      updatedFrom,
      updatedTo: null,
      offset: pageParam,
      limit: 25,
    }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
    enabled: open && Boolean(workspaceId) && Boolean(debounced) && selectedTypes.length > 0,
    staleTime: 10_000,
  })
  const rawItems = results.data?.pages.flatMap((page) => page.results) ?? []
  const groups = resourceTypes.flatMap(([type, label]) => {
    const values = rawItems.filter((item) => item.resourceType === type)
    return values.length ? [{ type, label, values }] : []
  })
  const items = groups.flatMap((group) => group.values)
  const history = useMemo(() => {
    try { return JSON.parse(localStorage.getItem('knowledge-search-history') ?? '[]') as string[] } catch { return [] }
  }, [open])

  if (!open) return null
  const choose = (result: SearchResult) => {
    const nextHistory = [query.trim(), ...history.filter((item) => item !== query.trim())].filter(Boolean).slice(0, 8)
    localStorage.setItem('knowledge-search-history', JSON.stringify(nextHistory))
    onClose()
    if (result.resourceType === 'PAGE' && result.knowledgeBaseId) navigate(`/app/kb/${result.knowledgeBaseId}/pages/${result.resourceId}`)
    else if (result.resourceType === 'QUICK_NOTE') navigate(`/app/notes?open=${result.resourceId}`)
    else if (result.resourceType === 'KNOWLEDGE_BASE') navigate(`/app/kb/${result.resourceId}`)
    else if (result.resourceType === 'TEAM') navigate(canManageWorkspace(workspaces, workspaceId) ? `/app/w/${workspaceId}/settings?tab=teams&team=${result.resourceId}` : `/app/w/${workspaceId}`)
    else if (result.resourceType === 'USER') navigate(canManageWorkspace(workspaces, workspaceId) ? `/app/w/${workspaceId}/settings?tab=members` : `/app/w/${workspaceId}`)
    else if (result.resourceType === 'TEMPLATE') navigate('/app/templates')
    else if (result.resourceType === 'ATTACHMENT' && result.knowledgeBaseId && result.path) navigate(`/app/kb/${result.knowledgeBaseId}/pages/${result.path}?manage=ATTACHMENTS&attachment=${result.resourceId}`)
    else navigate(`/app/w/${workspaceId}`)
  }
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((value) => Math.min(value + 1, Math.max(0, items.length - 1))) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((value) => Math.max(0, value - 1)) }
    if (event.key === 'Enter' && items[activeIndex]) { event.preventDefault(); choose(items[activeIndex]) }
  }
  return (
    <div className="search-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="search-palette" role="dialog" aria-modal="true" aria-label="全局搜索">
        <header className="search-palette-head">
          <Search size={20} />
          <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }} onKeyDown={onKeyDown} placeholder="搜索文稿、小记、知识库、成员或附件…" aria-label="搜索关键词" />
          <select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setKnowledgeBaseId(''); setCreatorId(''); setActiveIndex(0) }} aria-label="搜索空间">
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
          <button className="icon-button" onClick={onClose} aria-label="关闭搜索"><X size={18} /></button>
        </header>
        <div className="search-filters" aria-label="结果类型">
          {resourceTypes.map(([value, label]) => <button key={value} className={selectedTypes.includes(value) ? 'active' : ''} onClick={() => setSelectedTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])}>{label}</button>)}
        </div>
        <div className="search-advanced-filters" aria-label="高级搜索筛选"><select aria-label="筛选知识库" value={knowledgeBaseId} onChange={(event) => { setKnowledgeBaseId(event.target.value); setActiveIndex(0) }}><option value="">全部知识库</option>{(knowledgeBases.data ?? []).map((knowledgeBase) => <option key={knowledgeBase.id} value={knowledgeBase.id}>{knowledgeBase.name}</option>)}</select><select aria-label="筛选创建者" value={creatorId} onChange={(event) => { setCreatorId(event.target.value); setActiveIndex(0) }}><option value="">全部创建者</option>{(members.data ?? []).map((member) => <option key={member.userId} value={member.userId}>{member.displayName || member.email}</option>)}</select><select aria-label="筛选更新时间" value={updatedWithin} onChange={(event) => { setUpdatedWithin(event.target.value as typeof updatedWithin); setActiveIndex(0) }}><option value="ANY">不限更新时间</option><option value="DAY">最近 24 小时</option><option value="WEEK">最近 7 天</option><option value="MONTH">最近 30 天</option><option value="YEAR">最近一年</option></select>{(knowledgeBaseId || creatorId || updatedWithin !== 'ANY') && <button onClick={() => { setKnowledgeBaseId(''); setCreatorId(''); setUpdatedWithin('ANY') }}>清除筛选</button>}</div>
        <div className="search-results" role="listbox">
          {!debounced && <div className="search-idle"><strong>搜索整个工作空间</strong><p>支持中文、英文、代码片段和模糊标题。</p>{history.length > 0 && <div className="search-history"><span>最近搜索</span>{history.map((item) => <button key={item} onClick={() => setQuery(item)}>{item}</button>)}</div>}</div>}
          {debounced && results.isPending && <div className="search-state"><span className="loading-pulse" />正在检索</div>}
          {results.error && <div className="search-state error">{messageOf(results.error)}</div>}
          {debounced && !results.isPending && !results.error && items.length === 0 && <div className="search-state">没有找到有权限查看的内容</div>}
          {groups.map((group) => <section className="search-result-group" aria-label={`${group.label}结果`} key={group.type}><h2>{group.label}<span>{group.values.length}</span></h2>{group.values.map((result) => { const index = items.findIndex((item) => item.documentId === result.documentId); return <button key={result.documentId} className={`search-result ${index === activeIndex ? 'active' : ''}`} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => choose(result)}>
            <span className={`search-result-icon ${result.resourceType.toLowerCase()}`}>{resultIcon(result.resourceType)}</span>
            <span className="search-result-copy"><strong>{result.title}</strong><small>{searchResultMeta(result, knowledgeBases.data ?? [])}</small><p>{result.snippet || '无正文摘要'}</p></span>
            <kbd>↵</kbd>
          </button>})}</section>)}
          {results.hasNextPage && <button className="search-load-more" onClick={() => results.fetchNextPage()} disabled={results.isFetchingNextPage}>{results.isFetchingNextPage && <LoaderCircle className="spin" />}{results.isFetchingNextPage ? '正在加载更多结果' : '加载更多结果'}</button>}
        </div>
        <footer className="search-palette-foot"><span><kbd>↑</kbd><kbd>↓</kbd> 选择</span><span><kbd>Enter</kbd> 打开</span><span><kbd>Esc</kbd> 关闭</span>{items.length > 0 && <span>{items.length}{results.hasNextPage ? '+' : ''} 条</span>}<span className="search-security">结果已按当前账号权限过滤</span></footer>
      </section>
    </div>
  )
}

function resultIcon(type: string) {
  if (type === 'QUICK_NOTE') return <StickyNote size={18} />
  if (type === 'KNOWLEDGE_BASE') return <BookOpen size={18} />
  if (type === 'TEAM' || type === 'USER') return <Users size={18} />
  if (type === 'ATTACHMENT') return <Paperclip size={18} />
  return <FileText size={18} />
}

function typeName(type: string) {
  return Object.fromEntries(resourceTypes)[type] ?? type.toLowerCase()
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric' }).format(new Date(value))
}

function searchResultMeta(result: SearchResult, knowledgeBases: KnowledgeBase[]) {
  const knowledgeBase = result.knowledgeBaseId ? knowledgeBases.find((value) => value.id === result.knowledgeBaseId)?.name : null
  const path = result.resourceType === 'PAGE' && result.path ? `/${result.path}` : null
  const publication = result.publicationStatus ? ({ UNPUBLISHED: '未发布', PUBLISHED: '已发布', CHANGED: '草稿有更新' } as const)[result.publicationStatus] : result.sourceScope === 'PUBLISHED' ? '已发布' : null
  return [typeName(result.resourceType), knowledgeBase, path, publication, formatDate(result.updatedAt)].filter(Boolean).join(' · ')
}

function canManageWorkspace(workspaces: Workspace[], workspaceId: string) {
  return ['OWNER', 'ADMIN'].includes(workspaces.find((workspace) => workspace.id === workspaceId)?.membershipRole ?? '')
}
