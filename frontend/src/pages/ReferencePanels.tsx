import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ExternalLink, FileText, GitFork, Link2, Network, Search, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { messageOf, post } from '../lib/api'
import type {
  EmbeddedPageView,
  KnowledgeGraph,
  Page,
  PageEmbedMode,
  PageReferenceSummary,
} from '../types'

export function ReferenceDrawer({ pageId, onClose }: { pageId: string; onClose: () => void }) {
  const [tab, setTab] = useState<'outgoing' | 'backlinks' | 'graph'>('outgoing')
  const outgoing = useQuery({
    queryKey: ['page-references', 'outgoing', pageId],
    queryFn: () => post<PageReferenceSummary[]>('/api/v1/page-references/outgoing', { pageId }),
  })
  const backlinks = useQuery({
    queryKey: ['page-references', 'backlinks', pageId],
    queryFn: () => post<PageReferenceSummary[]>('/api/v1/page-references/backlinks', { pageId }),
  })
  const graph = useQuery({
    queryKey: ['page-references', 'graph', pageId],
    queryFn: () => post<KnowledgeGraph>('/api/v1/page-references/graph', { pageId, depth: 3, limit: 100 }),
    enabled: tab === 'graph',
  })
  const error = outgoing.error ?? backlinks.error ?? graph.error
  return (
    <aside className="reference-drawer" aria-label="知识网络">
      <header className="drawer-head">
        <div><p className="eyebrow">知识网络</p><h2>页面关系</h2></div>
        <button className="icon-button" onClick={onClose} aria-label="关闭知识网络"><X size={18} /></button>
      </header>
      <div className="reference-tabs" role="tablist">
        <button className={tab === 'outgoing' ? 'active' : ''} onClick={() => setTab('outgoing')}>引用 {outgoing.data?.length ?? 0}</button>
        <button className={tab === 'backlinks' ? 'active' : ''} onClick={() => setTab('backlinks')}>反向链接 {backlinks.data?.length ?? 0}</button>
        <button className={tab === 'graph' ? 'active' : ''} onClick={() => setTab('graph')}>图谱</button>
      </div>
      {error && <div className="inline-error">{messageOf(error)}</div>}
      {tab === 'outgoing' && <ReferenceList values={outgoing.data ?? []} outgoing />}
      {tab === 'backlinks' && <ReferenceList values={backlinks.data ?? []} />}
      {tab === 'graph' && graph.data && <GraphCanvas value={graph.data} />}
      {tab === 'graph' && graph.isPending && <div className="drawer-loading">正在构建图谱…</div>}
    </aside>
  )
}

function ReferenceList({ values, outgoing = false }: { values: PageReferenceSummary[]; outgoing?: boolean }) {
  if (!values.length) {
    return <div className="drawer-empty"><GitFork size={24} /><strong>{outgoing ? '还没有引用其他页面' : '还没有页面引用这里'}</strong><p>{outgoing ? '使用编辑器顶部的“引用”按钮建立知识连接。' : '其他可见页面引用这里后会自动出现。'}</p></div>
  }
  return <div className="reference-list">{values.map((value) => <ReferenceRow key={value.referenceId} value={value} resolve={outgoing} />)}</div>
}

function ReferenceRow({ value, resolve }: { value: PageReferenceSummary; resolve: boolean }) {
  const preview = useQuery({
    queryKey: ['page-references', 'resolve', value.referenceId],
    queryFn: () => post<EmbeddedPageView>('/api/v1/page-references/resolve', { referenceId: value.referenceId }),
    enabled: resolve && value.accessible && ['CARD', 'LIVE', 'FIXED'].includes(value.mode),
  })
  if (!value.accessible || !value.pageId || !value.knowledgeBaseId) {
    return <article className="reference-row unavailable"><span className="reference-glyph"><FileText size={16} /></span><div><strong>无权查看的页面</strong><small>来源信息已隐藏</small></div></article>
  }
  return (
    <Link className="reference-row" to={`/app/kb/${value.knowledgeBaseId}/pages/${value.pageId}`}>
      <span className="reference-glyph"><Link2 size={16} /></span>
      <div><strong>{value.title}</strong><small>{modeLabel(value.mode)} · {value.sourceScope === 'PUBLISHED' ? '发布内容' : '草稿'}</small>{preview.data?.plainText && <p>{preview.data.plainText}</p>}</div>
      <ExternalLink size={14} />
    </Link>
  )
}

function GraphCanvas({ value }: { value: KnowledgeGraph }) {
  const layout = useMemo(() => {
    const width = 340
    const height = 260
    const centerX = width / 2
    const centerY = height / 2
    const root = value.nodes.find((node) => node.pageId === value.rootPageId)
    const others = value.nodes.filter((node) => node.pageId !== value.rootPageId)
    const positions = new Map<string, { x: number; y: number }>()
    if (root) positions.set(root.pageId, { x: centerX, y: centerY })
    others.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(others.length, 1) - Math.PI / 2
      const radius = Math.min(105, 55 + others.length * 5)
      positions.set(node.pageId, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius })
    })
    return { width, height, positions }
  }, [value])
  return (
    <div className="knowledge-graph">
      <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="页面知识图谱">
        {value.edges.map((edge) => {
          const source = layout.positions.get(edge.sourcePageId)
          const target = layout.positions.get(edge.targetPageId)
          return source && target ? <line key={edge.referenceId} x1={source.x} y1={source.y} x2={target.x} y2={target.y} className={`graph-edge ${edge.mode.toLowerCase()}`} /> : null
        })}
        {value.nodes.map((node) => {
          const position = layout.positions.get(node.pageId)
          if (!position) return null
          const root = node.pageId === value.rootPageId
          return <a key={node.pageId} href={`/app/kb/${node.knowledgeBaseId}/pages/${node.pageId}`}><circle cx={position.x} cy={position.y} r={root ? 22 : 16} className={root ? 'graph-node root' : 'graph-node'} /><text x={position.x} y={position.y + (root ? 34 : 28)}>{shortTitle(node.title)}</text></a>
        })}
      </svg>
      <div className="graph-legend"><span><i className="live" />实时嵌入</span><span><i />普通引用</span></div>
      {value.truncated && <p className="graph-truncated">图谱已按深度或数量上限截断。</p>}
    </div>
  )
}

export function ReferenceInsertDialog({
  currentPageId,
  pages,
  onInsert,
  onClose,
}: {
  currentPageId: string
  pages: Page[]
  onInsert: (token: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [mode, setMode] = useState<PageEmbedMode>('LINK')
  const [blockId, setBlockId] = useState('')
  const candidates = pages.filter((page) => page.id !== currentPageId && page.title.toLowerCase().includes(query.toLowerCase()))
  const selected = pages.find((page) => page.id === selectedId)
  const fixedUnavailable = mode === 'FIXED' && !selected?.publishedRevisionId
  const insert = () => {
    if (!selected) return
    const block = blockId.trim() ? `#${blockId.trim().replace(/[^\p{L}\p{N}_.:-]/gu, '-')}` : ''
    const token = mode === 'LIVE'
      ? `{{embed:${selected.id}${block}|mode=live}}`
      : mode === 'FIXED'
        ? `{{embed:${selected.id}${block}|mode=fixed|publication=${selected.publishedRevisionId}}}`
        : `[[page:${selected.id}|mode=${mode.toLowerCase()}]]`
    onInsert(token)
    onClose()
  }
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="dialog reference-dialog" role="dialog" aria-modal="true" aria-labelledby="reference-dialog-title">
        <div className="dialog-head"><div><p className="eyebrow">知识网络</p><h2 id="reference-dialog-title">插入页面引用</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div>
        <label className="reference-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前知识库的页面" /></label>
        <div className="reference-page-picker">
          {candidates.map((page) => <button key={page.id} className={selectedId === page.id ? 'selected' : ''} onClick={() => setSelectedId(page.id)}><span><FileText size={16} /></span><div><strong>{page.title}</strong><small>{page.contentType.toLowerCase()} · {page.publishedRevisionId ? '已发布' : '仅草稿'}</small></div></button>)}
          {!candidates.length && <div className="picker-empty">没有匹配页面</div>}
        </div>
        <fieldset className="reference-modes"><legend>引用方式</legend>{(['LINK', 'TITLE', 'CARD', 'LIVE', 'FIXED'] as PageEmbedMode[]).map((value) => <button type="button" key={value} className={mode === value ? 'selected' : ''} onClick={() => setMode(value)}><strong>{modeLabel(value)}</strong><small>{modeDescription(value)}</small></button>)}</fieldset>
        {(mode === 'LIVE' || mode === 'FIXED') && <label className="field"><span className="field-label">块 ID（可选）</span><input value={blockId} onChange={(event) => setBlockId(event.target.value)} placeholder="留空则嵌入整篇内容" /></label>}
        {fixedUnavailable && <div className="form-error">目标页面尚未发布，不能创建固定版本引用。</div>}
        <div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" onClick={insert} disabled={!selected || fixedUnavailable}><Network size={16} />插入引用</button></div>
      </div>
    </div>
  )
}

function modeLabel(mode: PageEmbedMode) {
  return ({ LINK: '普通链接', TITLE: '标题引用', CARD: '卡片引用', LIVE: '实时嵌入', FIXED: '固定版本' } as const)[mode]
}

function modeDescription(mode: PageEmbedMode) {
  return ({ LINK: '点击后打开源页面', TITLE: '随源标题更新', CARD: '展示标题和摘要', LIVE: '展示源的当前内容', FIXED: '永久锁定已发布版本' } as const)[mode]
}

function shortTitle(value: string) {
  return value.length > 8 ? `${value.slice(0, 8)}…` : value
}
