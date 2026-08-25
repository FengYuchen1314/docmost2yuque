import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Archive, ArrowDown, ArrowUp, Bell, Bold, BookOpen, Check, CheckSquare, ChevronRight, Clock3, FileEdit, FileText,
  History, Image, Inbox, Italic, LayoutGrid, Link2, List, Maximize2, Minimize2, MoreHorizontal, Plus, RotateCcw, Search,
  Sparkles, Star, StickyNote, Tag, Trash2, X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { messageOf, post } from '../lib/api'
import { safeMediaUrl } from '../lib/contentCards'
import type {
  KnowledgeBase, KnowledgeBaseGroup, Notification, NotificationPage, Page, QuickNote, QuickNoteHistoryPage, QuickNotePage, QuickNoteRevision,
  QuickNoteTag, TrashItem, TrashPage, WorkbenchItem, WorkbenchPage, Workspace,
} from '../types'
import { ShareManager } from './PageManagement'
import { TextEntryDialog } from '../components/TextEntryDialog'
import { useConfirmDialog } from '../components/ConfirmDialog'

const workbenchTabs = [
  ['EDITED', '编辑过'], ['VIEWED', '浏览过'], ['COLLABORATED', '协作过'],
  ['FAVORITE', '收藏'], ['CREATED', '我创建的'],
] as const

const notificationCategories = [
  ['ALL', '全部分类'], ['MENTIONS', '提及'], ['COMMENTS', '评论与回复'],
  ['ACCESS', '邀请与审批'], ['UPDATES', '关注更新'],
] as const

export function ProductWorkbench({ workspaces }: { workspaces: Workspace[] }) {
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const requested = params.get('filter')
  const reason = workbenchTabs.some(([value]) => value === requested) ? requested as WorkbenchItem['reason'] : 'EDITED'
  const workspaceId = workspaces[0]?.id ?? ''
  const [capture, setCapture] = useState('')
  const [captureExpanded, setCaptureExpanded] = useState(false)
  const captureEditorRef = useRef<HTMLTextAreaElement>(null)
  const [captured, setCaptured] = useState<QuickNote | null>(null)
  const captureUndoTimer = useRef<number | null>(null)
  useEffect(() => () => {
    if (captureUndoTimer.current !== null) window.clearTimeout(captureUndoTimer.current)
  }, [])
  const items = useInfiniteQuery({
    queryKey: ['workbench', reason],
    queryFn: ({ pageParam }) => post<WorkbenchPage>('/api/v1/workbench/page', { reason, offset: pageParam, limit: 25 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
  })
  const workbenchItems = items.data?.pages.flatMap((page) => page.items) ?? []
  const notifications = useQuery({
    queryKey: ['notifications', 'workbench'],
    queryFn: () => post<Notification[]>('/api/v1/notifications/list', { unreadOnly: true, limit: 5 }),
  })
  const groups = useQuery({
    queryKey: ['knowledge-base-groups', workspaceId],
    queryFn: () => post<KnowledgeBaseGroup[]>('/api/v1/knowledge-base-groups/list', { workspaceId }),
    enabled: Boolean(workspaceId),
  })
  const knowledgeBases = useQuery({
    queryKey: ['knowledge-bases', workspaceId],
    queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }),
    enabled: Boolean(workspaceId),
  })
  const createNote = useMutation({
    mutationFn: () => post<QuickNote>('/api/v1/quick-notes/create', {
      workspaceId,
      content: noteDocument(capture),
      plainText: capture,
      source: 'HOME',
      clientRequestId: crypto.randomUUID(),
      tagIds: [],
    }),
    onSuccess: async (note) => {
      setCapture('')
      setCaptured(note)
      if (captureUndoTimer.current !== null) window.clearTimeout(captureUndoTimer.current)
      captureUndoTimer.current = window.setTimeout(() => {
        setCaptured((current) => current?.id === note.id ? null : current)
        captureUndoTimer.current = null
      }, 5_000)
      await queryClient.invalidateQueries({ queryKey: ['quick-notes'] })
    },
  })
  const undoCapture = useMutation({
    mutationFn: (quickNoteId: string) => post<void>('/api/v1/quick-notes/delete', { quickNoteId }),
    onSuccess: async (_, quickNoteId) => {
      if (captureUndoTimer.current !== null) window.clearTimeout(captureUndoTimer.current)
      captureUndoTimer.current = null
      setCaptured((current) => current?.id === quickNoteId ? null : current)
      await queryClient.invalidateQueries({ queryKey: ['quick-notes'] })
    },
  })
  const favorite = useMutation({
    mutationFn: ({ pageId, selected }: { pageId: string; selected: boolean }) =>
      post('/api/v1/favorites/set', { pageId, favorite: selected }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workbench'] }),
  })
  const submitCapture = () => {
    if (capture.trim() && workspaceId && !createNote.isPending) createNote.mutate()
  }
  return (
    <div className="content-page workbench">
      <ProductHeader
        eyebrow="工作台"
        title="今天想把什么写下来？"
        actions={<Link className="button primary small" to={workspaceId ? `/app/w/${workspaceId}` : '/app'}><Plus size={16} />新建文稿</Link>}
      />
      <section className={`quick-capture ${captureExpanded ? 'expanded' : ''} ${createNote.error ? 'has-error' : ''}`}>
        <div className="capture-icon"><Sparkles size={18} /></div>
        {captureExpanded ? <div className="quick-capture-editor"><QuickNoteFormattingToolbar editorRef={captureEditorRef} value={capture} onChange={setCapture} /><textarea ref={captureEditorRef} aria-label="快速记录" value={capture} onChange={(event) => setCapture(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitCapture() } }} placeholder="写下想法，可加入任务、链接和图片…" /></div> : <input aria-label="快速记录" value={capture} onChange={(event) => setCapture(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submitCapture() } }} placeholder="随手记下一个想法，按 Ctrl/Cmd + Enter 保存为小记…" />}
        <button className="icon-button capture-expand" onClick={() => { setCaptureExpanded((value) => !value); window.requestAnimationFrame(() => captureEditorRef.current?.focus()) }} aria-label={captureExpanded ? '收起快速记录' : '展开快速记录'} title={captureExpanded ? '收起' : '富文本、任务、链接和图片'}>{captureExpanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}</button>
        <button className="button quiet small" onClick={submitCapture} disabled={!capture.trim() || createNote.isPending}>{createNote.isPending ? '保存中' : '记一笔'}</button>
        <span>⌘ ↵</span>
      </section>
      {createNote.error && <div className="inline-error capture-error">{messageOf(createNote.error)}，内容已保留。</div>}
      {captured && <div className={`quick-capture-success ${undoCapture.error ? 'has-error' : ''}`} role="status">
        <span><Check size={15} />{undoCapture.error ? `撤销失败：${messageOf(undoCapture.error)}` : '已记下，可在小记中继续整理'}</span>
        <button onClick={() => undoCapture.mutate(captured.id)} disabled={undoCapture.isPending} aria-label="撤销刚创建的小记">{undoCapture.isPending ? '撤销中…' : '撤销'}</button>
      </div>}
      <div className="workbench-tabs" role="tablist" aria-label="工作台内容筛选">
        {workbenchTabs.map(([value, label]) => <button key={value} role="tab" aria-selected={reason === value} className={reason === value ? 'active' : ''} onClick={() => setParams({ filter: value })}>{label}</button>)}
      </div>
      <section className="dashboard-grid">
        <article className="panel recent-panel">
          <div className="panel-head"><h2>{workbenchTabs.find(([value]) => value === reason)?.[1]}</h2><div className="workbench-panel-meta"><span>{workbenchItems.length}{items.hasNextPage ? '+' : ''} 项</span>{reason === 'VIEWED' && workbenchItems.length > 0 && <WorkbenchHistoryClear />}</div></div>
          <div className="workbench-list">
            {workbenchItems.map((item) => (
              <div className="workbench-row" key={item.resourceId}>
                <Link to={`/app/kb/${item.knowledgeBaseId}/pages/${item.resourceId}`}>
                  <span className="resource-icon compact"><FileText size={16} /></span>
                  <div><strong>{item.title}</strong><p>{item.knowledgeBaseName} / {item.path}</p><footer><span className={`workbench-publication ${item.publicationStatus.toLowerCase()}`}>{workbenchPublicationLabel(item.publicationStatus)}</span><time>{contentTypeName(item.contentType)} · {relativeTime(item.activityAt)}</time>{item.collaborators.length > 0 && <span className="workbench-collaborators" aria-label={`协作者：${item.collaborators.map((person) => person.displayName || person.email).join('、')}`}>{item.collaborators.map((person) => <i key={person.userId} title={person.displayName || person.email}>{(person.displayName || person.email).slice(0, 1).toUpperCase()}</i>)}</span>}</footer></div>
                </Link>
                <button className={`icon-button ${item.favorite ? 'selected' : ''}`} onClick={() => favorite.mutate({ pageId: item.resourceId, selected: !item.favorite })} aria-label={item.favorite ? '取消收藏' : '收藏'}><Star size={16} fill={item.favorite ? 'currentColor' : 'none'} /></button>
              </div>
            ))}
            {items.error && <div className="workbench-state error"><span>{messageOf(items.error)}</span><button className="button secondary small" onClick={() => items.refetch()}>重试</button></div>}
            {!items.isPending && !items.error && !workbenchItems.length && <ProductEmpty icon={<FileText />} title="这里还没有内容" description="真实访问、编辑或收藏后会自动出现在对应分类。" />}
            {items.hasNextPage && <button className="button secondary workbench-more" onClick={() => items.fetchNextPage()} disabled={items.isFetchingNextPage}>{items.isFetchingNextPage ? '加载中…' : '加载更多'}</button>}
          </div>
        </article>
        <article className="panel activity-panel">
          <div className="panel-head"><h2>消息</h2><Link to="/app/notifications">查看全部</Link></div>
          <div className="notification-preview-list">
            {(notifications.data ?? []).map((notification) => <NotificationRow key={notification.id} value={notification} compact />)}
            {!notifications.isPending && !notifications.data?.length && <ProductEmpty icon={<Bell />} title="暂时没有新消息" description="评论提及、邀请和审批结果会出现在这里。" />}
          </div>
        </article>
      </section>
      <KnowledgeBaseGroups
        workspaceId={workspaceId}
        groups={groups.data ?? []}
        knowledgeBases={knowledgeBases.data ?? []}
      />
      <section className="workspace-cards-section">
        <div className="panel-head"><h2>我的空间</h2></div>
        <div className="workspace-cards">
          {workspaces.map((workspace) => (
            <Link className="workspace-card" to={`/app/w/${workspace.id}`} key={workspace.id}>
              <span className="workspace-card-icon">{workspace.name.slice(0, 1)}</span>
              <div><strong>{workspace.name}</strong><p>{workspace.membershipRole.toLowerCase()} · {workspace.workspaceType === 'PERSONAL' ? '个人空间' : '组织空间'}</p></div>
              <ChevronRight size={18} />
            </Link>
          ))}
        </div>
      </section>
    </div>
  )
}

export function WorkbenchHistoryClear() {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const clear = useMutation({
    mutationFn: () => post<{ deleted: number }>('/api/v1/activities/page-views/clear', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['workbench', 'VIEWED'] }),
  })
  return <><button className="workbench-clear" onClick={() => confirmation.confirm({ title: '清空全部浏览记录', description: '浏览记录会从你的工作台中清除，不会影响内容阅读统计。', confirmLabel: '清空记录' }, () => clear.mutate())} disabled={clear.isPending}><Trash2 />{clear.isPending ? '清空中' : '清空记录'}</button>{confirmation.dialog}</>
}

export function GlobalTrashPage() {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [deleteTargets, setDeleteTargets] = useState<TrashItem[]>([])
  const trash = useInfiniteQuery({
    queryKey: ['global-trash', query],
    queryFn: ({ pageParam }) => post<TrashPage>('/api/v1/pages/trash/page', { query: query || null, offset: pageParam, limit: 25 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
  })
  const items = trash.data?.pages.flatMap((page) => page.items) ?? []
  const selectedItems = items.filter((item) => selected.includes(item.id))
  const restore = useMutation({
    mutationFn: (pageIds: string[]) => post<Page[]>('/api/v1/pages/restore-batch', { pageIds }),
    onSuccess: async (_, pageIds) => {
      setSelected((current) => current.filter((id) => !pageIds.includes(id)))
      await queryClient.invalidateQueries({ queryKey: ['global-trash'] })
      await queryClient.invalidateQueries({ queryKey: ['pages'] })
    },
  })
  const allSelected = items.length > 0 && items.every((item) => selected.includes(item.id))
  const toggleAll = () => setSelected(allSelected ? selected.filter((id) => !items.some((item) => item.id === id)) : [...new Set([...selected, ...items.map((item) => item.id)])])
  const submitSearch = (event: React.FormEvent) => { event.preventDefault(); setSelected([]); setQuery(input.trim().slice(0, 200)) }
  return <div className="content-page global-trash-page">
    <ProductHeader eyebrow="内容管理" title="全局回收站" description="集中查看你有权管理的已删除文稿；恢复会保留原知识库和路径。" />
    <section className="trash-toolbar">
      <form onSubmit={submitSearch}><Search /><input aria-label="搜索回收站" value={input} maxLength={200} onChange={(event) => setInput(event.target.value)} placeholder="搜索文稿、知识库或空间…" />{input && <button type="button" className="icon-button" aria-label="清空回收站搜索" onClick={() => { setInput(''); setQuery(''); setSelected([]) }}><X /></button>}<button className="button secondary small" type="submit">搜索</button></form>
      <span>{items.length}{trash.hasNextPage ? '+' : ''} 项</span>
    </section>
    {items.length > 0 && <div className="trash-batch-bar"><label><input type="checkbox" checked={allSelected} onChange={toggleAll} />选择当前已加载内容</label><span>{selected.length ? `已选择 ${selected.length} 项` : '可批量恢复或永久删除'}</span><button className="button secondary small" disabled={!selectedItems.length || restore.isPending || selectedItems.some((item) => !item.restoreAllowed)} onClick={() => confirmation.confirm({ title: `恢复选中的 ${selectedItems.length} 项内容`, description: '内容会恢复到原知识库和原路径，如果当前权限不允许，恢复会被服务端拒绝。', confirmLabel: '批量恢复', tone: 'primary' }, () => restore.mutate(selectedItems.map((item) => item.id)))}><RotateCcw />批量恢复</button><button className="button danger small" disabled={!selectedItems.length || selectedItems.some((item) => !item.deleteAllowed)} onClick={() => setDeleteTargets(selectedItems)}><Trash2 />永久删除</button></div>}
    <section className="trash-list">
      {items.map((item) => <article key={item.id} className={selected.includes(item.id) ? 'selected' : ''}>
        <label className="trash-select"><input type="checkbox" aria-label={`选择 ${item.title}`} checked={selected.includes(item.id)} onChange={() => setSelected((current) => current.includes(item.id) ? current.filter((id) => id !== item.id) : [...current, item.id])} /></label>
        <span className="resource-icon">{item.knowledgeBaseIcon || <FileText />}</span>
        <div className="trash-item-main"><header><strong>{item.title}</strong><i>{contentTypeName(item.contentType)}</i></header><p>{item.workspaceName} / {item.knowledgeBaseName} · /{item.path}</p><small>{item.deletedByName}（{item.deletedByEmail}）于 {relativeTime(item.deletedAt)} 删除</small></div>
        <div className="trash-item-actions"><button className="button secondary small" disabled={!item.restoreAllowed || restore.isPending} onClick={() => restore.mutate([item.id])}><RotateCcw />恢复</button><button className="icon-button danger" aria-label={`永久删除 ${item.title}`} disabled={!item.deleteAllowed} onClick={() => setDeleteTargets([item])}><Trash2 /></button></div>
      </article>)}
      {trash.error && <div className="trash-state error"><Trash2 /><strong>无法读取回收站</strong><p>{messageOf(trash.error)}</p><button className="button secondary small" onClick={() => trash.refetch()}>重试</button></div>}
      {!trash.isPending && !trash.error && items.length === 0 && <ProductEmpty icon={<Trash2 />} title={query ? '没有匹配的已删除内容' : '回收站是空的'} description={query ? '换一个关键词，或清空搜索条件。' : '你有权管理的已删除文稿会出现在这里。'} />}
      {trash.hasNextPage && <button className="button secondary trash-more" disabled={trash.isFetchingNextPage} onClick={() => trash.fetchNextPage()}>{trash.isFetchingNextPage ? '加载中…' : '加载更多'}</button>}
    </section>
    {(restore.error) && <div className="form-error">{messageOf(restore.error)}</div>}
    {deleteTargets.length > 0 && <PermanentTrashDeleteDialog items={deleteTargets} onClose={() => setDeleteTargets([])} onDeleted={async (pageIds) => { setDeleteTargets([]); setSelected((current) => current.filter((id) => !pageIds.includes(id))); await queryClient.invalidateQueries({ queryKey: ['global-trash'] }) }} />}
    {confirmation.dialog}
  </div>
}

export function PermanentTrashDeleteDialog({ items, onClose, onDeleted }: { items: TrashItem[]; onClose: () => void; onDeleted: (pageIds: string[]) => void | Promise<unknown> }) {
  const [confirmation, setConfirmation] = useState('')
  const pageIds = items.map((item) => item.id)
  const phrase = items.length === 1 ? items[0]!.title : `永久删除 ${items.length} 项`
  const remove = useMutation({
    mutationFn: () => post<void>('/api/v1/pages/delete-permanently-batch', { pageIds }),
    onSuccess: () => onDeleted(pageIds),
  })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog trash-delete-dialog" role="dialog" aria-label="永久删除回收站内容"><div className="dialog-head"><div><p className="eyebrow">不可撤销</p><h2>{items.length === 1 ? `永久删除“${items[0]!.title}”` : `永久删除 ${items.length} 项内容`}</h2><p>正文、历史版本、发布快照和关联数据将一并删除，且无法恢复。</p></div><button className="icon-button" aria-label="关闭永久删除确认" onClick={onClose}><X /></button></div><div className="trash-delete-preview">{items.slice(0, 5).map((item) => <span key={item.id}>{item.title}<small>{item.knowledgeBaseName}</small></span>)}{items.length > 5 && <span>另有 {items.length - 5} 项</span>}</div><label className="field"><span className="field-label">输入 <strong>{phrase}</strong> 确认</span><input aria-label="永久删除确认文字" autoFocus value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{remove.error && <div className="form-error">{messageOf(remove.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button danger" disabled={confirmation !== phrase || remove.isPending} onClick={() => remove.mutate()}>{remove.isPending ? '正在永久删除…' : '确认永久删除'}</button></div></div></div>
}

export function KnowledgeBaseGroups({ workspaceId, groups, knowledgeBases }: { workspaceId: string; groups: KnowledgeBaseGroup[]; knowledgeBases: KnowledgeBase[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [renamingGroup, setRenamingGroup] = useState<KnowledgeBaseGroup | null>(null)
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['knowledge-base-groups', workspaceId] })
  const create = useMutation({
    mutationFn: () => post('/api/v1/knowledge-base-groups/create', { workspaceId, name }),
    onSuccess: async () => { setName(''); await refresh() },
  })
  const move = useMutation({
    mutationFn: ({ groupId, knowledgeBaseId }: { groupId: string; knowledgeBaseId: string }) => post('/api/v1/knowledge-base-groups/items/move', { groupId, knowledgeBaseId }),
    onSuccess: refresh,
  })
  const remove = useMutation({
    mutationFn: (knowledgeBaseId: string) => post('/api/v1/knowledge-base-groups/items/remove', { knowledgeBaseId }),
    onSuccess: refresh,
  })
  const rename = useMutation({
    mutationFn: ({ groupId, nextName }: { groupId: string; nextName: string }) => post('/api/v1/knowledge-base-groups/rename', { groupId, name: nextName }),
    onSuccess: refresh,
  })
  const removeGroup = useMutation({
    mutationFn: (groupId: string) => post('/api/v1/knowledge-base-groups/delete', { groupId }),
    onSuccess: refresh,
  })
  const reorderGroups = useMutation({
    mutationFn: (orderedGroupIds: string[]) => post('/api/v1/knowledge-base-groups/reorder', { workspaceId, orderedGroupIds }),
    onSuccess: refresh,
  })
  const reorderItems = useMutation({
    mutationFn: ({ groupId, orderedKnowledgeBaseIds }: { groupId: string; orderedKnowledgeBaseIds: string[] }) => post('/api/v1/knowledge-base-groups/items/reorder', { groupId, orderedKnowledgeBaseIds }),
    onSuccess: refresh,
  })
  const assigned = new Set(groups.flatMap((group) => group.items.map((item) => item.knowledgeBaseId)))
  const groupIds = groups.map((group) => group.id)
  const operationError = create.error ?? move.error ?? remove.error ?? rename.error ?? removeGroup.error ?? reorderGroups.error ?? reorderItems.error
  return (
    <section className="kb-groups-section">
      <div className="panel-head"><div><h2>知识库分组</h2><p>仅影响你的工作台，不改变团队结构</p></div><form onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}><input value={name} onChange={(event) => setName(event.target.value)} placeholder="新分组名称" /><button className="button secondary small" disabled={!name.trim() || create.isPending}><Plus size={14} />添加</button></form></div>
      <div className="kb-group-grid">
        {groups.map((group, groupIndex) => (
          <article className="kb-group-card" key={group.id}>
            <header><strong>{group.name}</strong><div><button className="icon-button" disabled={groupIndex === 0 || reorderGroups.isPending} onClick={() => reorderGroups.mutate(reorderIds(groupIds, group.id, -1))} aria-label={`上移分组 ${group.name}`}><ArrowUp size={15} /></button><button className="icon-button" disabled={groupIndex === groups.length - 1 || reorderGroups.isPending} onClick={() => reorderGroups.mutate(reorderIds(groupIds, group.id, 1))} aria-label={`下移分组 ${group.name}`}><ArrowDown size={15} /></button><button className="icon-button" onClick={() => setRenamingGroup(group)} aria-label={`重命名分组 ${group.name}`}><FileEdit size={15} /></button><button className="icon-button" onClick={() => removeGroup.mutate(group.id)} aria-label={`删除分组 ${group.name}`}><Trash2 size={15} /></button></div></header>
            <div className="group-items">
              {group.items.map((item, itemIndex) => <div key={item.knowledgeBaseId}><Link to={`/app/kb/${item.knowledgeBaseId}`}><span>{item.icon || '📚'}</span><strong>{item.name}</strong></Link><span className="group-item-actions"><button disabled={itemIndex === 0 || reorderItems.isPending} onClick={() => reorderItems.mutate({ groupId: group.id, orderedKnowledgeBaseIds: reorderIds(group.items.map((value) => value.knowledgeBaseId), item.knowledgeBaseId, -1) })} aria-label={`上移知识库 ${item.name}`}><ArrowUp size={12} /></button><button disabled={itemIndex === group.items.length - 1 || reorderItems.isPending} onClick={() => reorderItems.mutate({ groupId: group.id, orderedKnowledgeBaseIds: reorderIds(group.items.map((value) => value.knowledgeBaseId), item.knowledgeBaseId, 1) })} aria-label={`下移知识库 ${item.name}`}><ArrowDown size={12} /></button><button onClick={() => remove.mutate(item.knowledgeBaseId)} aria-label={`移出分组 ${item.name}`}><X size={13} /></button></span></div>)}
              {!group.items.length && <p>把知识库移到这里</p>}
            </div>
            <select defaultValue="" onChange={(event) => { if (event.target.value) move.mutate({ groupId: group.id, knowledgeBaseId: event.target.value }); event.target.value = '' }}>
              <option value="">添加知识库…</option>
              {knowledgeBases.filter((kb) => !group.items.some((item) => item.knowledgeBaseId === kb.id)).map((kb) => <option key={kb.id} value={kb.id}>{assigned.has(kb.id) ? `${kb.name}（从其他组移动）` : kb.name}</option>)}
            </select>
          </article>
        ))}
        {!groups.length && <div className="kb-groups-empty"><BookOpen size={22} /><p>创建分组，把常用知识库整理成自己的导航。</p></div>}
      </div>
      {Boolean(operationError) && <div className="inline-error kb-group-error">{messageOf(operationError)}</div>}
      {renamingGroup && <TextEntryDialog title="重命名知识库分组" label="分组名称" initialValue={renamingGroup.name} maxLength={120} confirmLabel="保存名称" onSubmit={(nextName) => { rename.mutate({ groupId: renamingGroup.id, nextName }); setRenamingGroup(null) }} onClose={() => setRenamingGroup(null)} />}
    </section>
  )
}

function reorderIds(values: string[], id: string, direction: -1 | 1) {
  const result = [...values]
  const from = result.indexOf(id)
  const to = from + direction
  if (from < 0 || to < 0 || to >= result.length) return result
  const moving = result[from]!
  result[from] = result[to]!
  result[to] = moving
  return result
}

export function QuickNotesPage({ workspaces }: { workspaces: Workspace[] }) {
  const queryClient = useQueryClient()
  const workspaceId = workspaces[0]?.id ?? ''
  const [params] = useSearchParams()
  const captureRef = useRef<HTMLTextAreaElement>(null)
  const [status, setStatus] = useState<QuickNote['status']>('ACTIVE')
  const [query, setQuery] = useState('')
  const [tagId, setTagId] = useState<string>('')
  const [capture, setCapture] = useState('')
  const [view, setView] = useState<'CARD' | 'LIST'>('CARD')
  const [selected, setSelected] = useState<string[]>([])
  const [editing, setEditing] = useState<QuickNote | null>(null)
  const [converting, setConverting] = useState<string[] | null>(null)
  const [sharing, setSharing] = useState<QuickNote | null>(null)
  const [tagManagerOpen, setTagManagerOpen] = useState(false)
  const notes = useInfiniteQuery({
    queryKey: ['quick-notes', status, tagId, query],
    queryFn: ({ pageParam }) => post<QuickNotePage>('/api/v1/quick-notes/page', { status, tagId: tagId || null, query, limit: 30, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
  })
  const noteItems = notes.data?.pages.flatMap((page) => page.items) ?? []
  const tags = useQuery({ queryKey: ['quick-note-tags'], queryFn: () => post<QuickNoteTag[]>('/api/v1/quick-notes/tags/list', {}) })
  const knowledgeBases = useQuery({
    queryKey: ['knowledge-bases', workspaceId],
    queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }),
    enabled: Boolean(workspaceId),
  })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['quick-notes'] })
  const create = useMutation({
    mutationFn: () => post<QuickNote>('/api/v1/quick-notes/create', { workspaceId, content: noteDocument(capture), plainText: capture, source: 'QUICK_NOTE_PAGE', clientRequestId: crypto.randomUUID(), tagIds: [] }),
    onSuccess: async () => { setCapture(''); await refresh() },
  })
  const state = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => post(`/api/v1/quick-notes/${path}`, body),
    onSuccess: async () => { setSelected([]); await refresh() },
  })
  const batch = (operation: string, tagIds: string[] = []) => state.mutate({ path: 'batch', body: { quickNoteIds: selected, operation, tagIds } })
  const toggleSelected = (id: string) => setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])
  const submit = () => { if (capture.trim() && workspaceId) create.mutate() }
  useEffect(() => {
    if (params.get('capture') === '1') captureRef.current?.focus()
  }, [params])
  return (
    <div className="content-page notes-page">
      <ProductHeader eyebrow="小记" title="把灵感留在它溜走之前" description="默认仅你可见，自动保存并保留每一个版本。" actions={<div className="view-switch" aria-label="小记布局"><button className={view === 'CARD' ? 'active' : ''} aria-label="卡片视图" aria-pressed={view === 'CARD'} title="卡片视图" onClick={() => setView('CARD')}><LayoutGrid size={15} /></button><button className={view === 'LIST' ? 'active' : ''} aria-label="列表视图" aria-pressed={view === 'LIST'} title="列表视图" onClick={() => setView('LIST')}><List size={15} /></button></div>} />
      <section className="note-capture-card">
        <QuickNoteFormattingToolbar editorRef={captureRef} value={capture} onChange={setCapture} />
        <textarea ref={captureRef} value={capture} onChange={(event) => setCapture(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); submit() } }} placeholder="写下此刻的想法、任务或链接…" />
        <footer><span>Ctrl/Cmd + Enter</span><button className="button primary small" onClick={submit} disabled={!capture.trim() || create.isPending}><StickyNote size={15} />记一笔</button></footer>
        {create.error && <div className="inline-error">{messageOf(create.error)}，输入内容不会丢失。</div>}
      </section>
      <div className="notes-toolbar">
        <div className="status-tabs">{(['ACTIVE', 'ARCHIVED', 'DELETED'] as const).map((value) => <button key={value} className={status === value ? 'active' : ''} onClick={() => { setStatus(value); setSelected([]) }}>{value === 'ACTIVE' ? '活跃' : value === 'ARCHIVED' ? '归档' : '回收站'}</button>)}</div>
        <label className="notes-search"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索小记" /></label>
      </div>
      <div className="tag-filter"><button className={!tagId ? 'active' : ''} onClick={() => setTagId('')}>全部</button>{(tags.data ?? []).map((tag) => <button key={tag.id} className={tagId === tag.id ? 'active' : ''} onClick={() => setTagId(tag.id)}><span className={`tag-dot ${tag.color.toLowerCase()}`} />{tag.name}</button>)}<button onClick={() => setTagManagerOpen(true)}><Tag size={13} />管理标签</button></div>
      {selected.length > 0 && <QuickNoteBatchToolbar selectedCount={selected.length} status={status} tags={tags.data ?? []} pending={state.isPending} onBatch={batch} onConvert={() => setConverting(selected)} onCancel={() => setSelected([])} />}
      <div className={`notes-grid ${view.toLowerCase()}`}>
        {noteItems.map((note) => <QuickNoteCard key={note.id} note={note} selected={selected.includes(note.id)} onSelect={() => toggleSelected(note.id)} onEdit={() => setEditing(note)} onShare={() => setSharing(note)} onArchive={() => state.mutate({ path: 'archive', body: { quickNoteId: note.id, archived: note.status !== 'ARCHIVED' } })} onDelete={() => state.mutate({ path: 'delete', body: { quickNoteId: note.id } })} onRestore={() => state.mutate({ path: 'restore', body: { quickNoteId: note.id } })} onConvert={() => setConverting([note.id])} />)}
        {!notes.isPending && !noteItems.length && <ProductEmpty icon={<StickyNote />} title={status === 'ACTIVE' ? '还没有小记' : status === 'ARCHIVED' ? '归档是空的' : '回收站是空的'} description="你在上方写下的内容会立即出现在这里。" />}
        {notes.hasNextPage && <button className="button secondary notes-load-more" onClick={() => notes.fetchNextPage()} disabled={notes.isFetchingNextPage}>{notes.isFetchingNextPage ? <><Clock3 className="spin" />正在加载更多小记</> : '加载更多小记'}</button>}
      </div>
      {editing && <QuickNoteEditor note={editing} tags={tags.data ?? []} onClose={() => setEditing(null)} onUpdated={async () => { await refresh() }} />}
      {converting && <ConvertNotesDialog noteIds={converting} knowledgeBases={knowledgeBases.data ?? []} onClose={() => setConverting(null)} onConverted={async () => { setConverting(null); setSelected([]); await refresh() }} />}
      {sharing && <QuickNoteShareDialog note={sharing} onClose={() => setSharing(null)} />}
      {tagManagerOpen && <QuickNoteTagManager tags={tags.data ?? []} onClose={() => setTagManagerOpen(false)} onDeleted={(deletedTagId) => { if (tagId === deletedTagId) setTagId('') }} />}
    </div>
  )
}

const quickNoteTagColors = [
  ['GRAY', '灰色'], ['RED', '红色'], ['ORANGE', '橙色'], ['YELLOW', '黄色'],
  ['GREEN', '绿色'], ['BLUE', '蓝色'], ['PURPLE', '紫色'], ['PINK', '粉色'],
] as const

export function QuickNoteTagManager({ tags, onClose, onDeleted }: { tags: QuickNoteTag[]; onClose: () => void; onDeleted?: (tagId: string) => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const [name, setName] = useState('')
  const [color, setColor] = useState('GRAY')
  const [drafts, setDrafts] = useState<Record<string, { name: string; color: string }>>({})
  useEffect(() => {
    setDrafts(Object.fromEntries(tags.map((tag) => [tag.id, { name: tag.name, color: tag.color }])))
  }, [tags])
  const refreshTags = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['quick-note-tags'] }),
      queryClient.invalidateQueries({ queryKey: ['quick-notes'] }),
    ])
  }
  const create = useMutation({
    mutationFn: () => post<QuickNoteTag>('/api/v1/quick-notes/tags/create', { name: name.trim(), color }),
    onSuccess: async () => { setName(''); setColor('GRAY'); await refreshTags() },
  })
  const update = useMutation({
    mutationFn: ({ tagId, draft }: { tagId: string; draft: { name: string; color: string } }) => post<QuickNoteTag>('/api/v1/quick-notes/tags/update', { tagId, name: draft.name.trim(), color: draft.color }),
    onSuccess: refreshTags,
  })
  const remove = useMutation({
    mutationFn: (tagId: string) => post<void>('/api/v1/quick-notes/tags/delete', { tagId }),
    onSuccess: async (_, tagId) => { onDeleted?.(tagId); await refreshTags() },
  })
  const error = create.error ?? update.error ?? remove.error
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog quick-note-tag-dialog" role="dialog" aria-label="管理小记标签"><div className="dialog-head"><div><p className="eyebrow">小记整理</p><h2>管理标签</h2><p>标签只属于当前邮箱账号；改名和改色会同步到已有小记。</p></div><button className="icon-button" onClick={onClose} aria-label="关闭标签管理"><X /></button></div><form className="tag-manager-create" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}><label className="field"><span className="field-label">新标签名称</span><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">颜色</span><select aria-label="新标签颜色" value={color} onChange={(event) => setColor(event.target.value)}>{quickNoteTagColors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="button primary small" disabled={!name.trim() || create.isPending}><Plus />{create.isPending ? '正在创建…' : '创建标签'}</button></form><div className="tag-manager-list">{tags.map((tag) => { const draft = drafts[tag.id] ?? { name: tag.name, color: tag.color }; const changed = draft.name.trim() !== tag.name || draft.color !== tag.color; const saving = update.isPending && update.variables?.tagId === tag.id; const deleting = remove.isPending && remove.variables === tag.id; return <article key={tag.id}><span className={`tag-color-preview ${draft.color.toLowerCase()}`} /><input aria-label={`标签名称 ${tag.name}`} value={draft.name} maxLength={80} onChange={(event) => setDrafts((current) => ({ ...current, [tag.id]: { ...draft, name: event.target.value } }))} /><select aria-label={`标签颜色 ${tag.name}`} value={draft.color} onChange={(event) => setDrafts((current) => ({ ...current, [tag.id]: { ...draft, color: event.target.value } }))}>{quickNoteTagColors.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button quiet small" aria-label={`保存标签 ${tag.name}`} disabled={!changed || !draft.name.trim() || update.isPending || remove.isPending} onClick={() => update.mutate({ tagId: tag.id, draft })}><Check />{saving ? '保存中…' : '保存'}</button><button className="icon-button danger" aria-label={`删除标签 ${tag.name}`} disabled={update.isPending || remove.isPending} onClick={() => confirmation.confirm({ title: `删除标签“${tag.name}”`, description: '标签会从所有小记中移除，小记本身不会被删除。', confirmLabel: '删除标签' }, () => remove.mutate(tag.id))}>{deleting ? <Clock3 className="spin" /> : <Trash2 />}</button></article> })}{!tags.length && <div className="tag-manager-empty"><Tag /><p>还没有标签，在上方创建第一个标签。</p></div>}</div>{error && <div className="form-error">{messageOf(error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>完成</button></div>{confirmation.dialog}</div></div>
}

export function QuickNoteBatchToolbar({ selectedCount, status, tags, pending, onBatch, onConvert, onCancel }: { selectedCount: number; status: QuickNote['status']; tags: QuickNoteTag[]; pending: boolean; onBatch: (operation: string, tagIds?: string[]) => void; onConvert: () => void; onCancel: () => void }) {
  const applyTag = (operation: 'ADD_TAG' | 'REMOVE_TAG', value: string, select: HTMLSelectElement) => {
    if (value) onBatch(operation, [value])
    select.value = ''
  }
  return <div className="batch-toolbar"><strong>已选择 {selectedCount} 条</strong>{status === 'ACTIVE' && <button disabled={pending} onClick={() => onBatch('ARCHIVE')}><Archive size={14} />归档</button>}{status === 'ARCHIVED' && <button disabled={pending} onClick={() => onBatch('UNARCHIVE')}><RotateCcw size={14} />取消归档</button>}{status !== 'DELETED' && <button disabled={pending} onClick={() => onBatch('DELETE')}><Trash2 size={14} />删除</button>}{status === 'DELETED' && <button disabled={pending} onClick={() => onBatch('RESTORE')}><RotateCcw size={14} />恢复</button>}{status !== 'DELETED' && <button disabled={pending} onClick={onConvert}><FileText size={14} />合并转文稿</button>}<select aria-label="批量添加标签" defaultValue="" disabled={pending || !tags.length} onChange={(event) => applyTag('ADD_TAG', event.target.value, event.currentTarget)}><option value="">添加标签…</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><select aria-label="批量移除标签" defaultValue="" disabled={pending || !tags.length} onChange={(event) => applyTag('REMOVE_TAG', event.target.value, event.currentTarget)}><option value="">移除标签…</option>{tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select><button disabled={pending} onClick={onCancel}><X size={14} />取消</button></div>
}

export function CaptureSharedContent({ workspaces }: { workspaces: Workspace[] }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const requestId = useRef(crypto.randomUUID())
  const workspaceId = workspaces[0]?.id ?? ''
  const content = [params.get('title'), params.get('text'), params.get('url')].filter(Boolean).join('\n').trim()
  const capture = useMutation({
    mutationKey: ['share-target', requestId.current],
    mutationFn: () => post<QuickNote>('/api/v1/quick-notes/create', {
      workspaceId, content: noteDocument(content), plainText: content, source: 'QUICK_NOTE_PAGE',
      clientRequestId: requestId.current, tagIds: [],
    }),
    onSuccess: () => navigate('/app/notes', { replace: true }),
  })
  useEffect(() => {
    if (workspaceId && content && capture.isIdle) capture.mutate()
  }, [workspaceId, content, capture.isIdle])
  if (!content) return <div className="content-page"><ProductHeader eyebrow="分享" title="没有可保存的内容" description="返回小记后可以手动记录。" /><Link className="button primary" to="/app/notes?capture=1">打开小记</Link></div>
  return <div className="capture-route"><span className="loading-pulse" /><h1>{capture.error ? '暂时无法保存' : '正在保存到小记'}</h1><p>{capture.error ? messageOf(capture.error) : content}</p>{capture.error && <button className="button primary" onClick={() => capture.mutate()}>重试</button>}</div>
}

function QuickNoteCard({ note, selected, onSelect, onEdit, onShare, onArchive, onDelete, onRestore, onConvert }: { note: QuickNote; selected: boolean; onSelect: () => void; onEdit: () => void; onShare: () => void; onArchive: () => void; onDelete: () => void; onRestore: () => void; onConvert: () => void }) {
  const rich = quickNoteRichMeta(note)
  const runMenuAction = (action: () => void) => (event: React.MouseEvent<HTMLButtonElement>) => {
    event.currentTarget.closest('details')?.removeAttribute('open')
    action()
  }
  return (
    <article className={`note-card ${selected ? 'selected' : ''}`}>
      <header><label><input type="checkbox" checked={selected} onChange={onSelect} /><span /></label><time>{relativeTime(note.updatedAt)}</time><details className="note-more-menu"><summary className="icon-button" aria-label="更多操作" title="更多操作"><MoreHorizontal size={16} /></summary><div>{note.status !== 'DELETED' && <button onClick={runMenuAction(onEdit)}><FileEdit />编辑</button>}{note.status !== 'DELETED' && <button onClick={runMenuAction(onShare)}><Link2 />分享快照</button>}{note.status !== 'DELETED' && <button onClick={runMenuAction(onArchive)}>{note.status === 'ARCHIVED' ? <RotateCcw /> : <Archive />}{note.status === 'ARCHIVED' ? '取消归档' : '归档'}</button>}{note.status !== 'DELETED' && <button onClick={runMenuAction(onConvert)}><FileText />合并转文稿</button>}{note.status !== 'DELETED' ? <button className="danger" onClick={runMenuAction(onDelete)}><Trash2 />移入回收站</button> : <button onClick={runMenuAction(onRestore)}><RotateCcw />恢复小记</button>}</div></details></header>
      <button className="note-card-body" onClick={note.status === 'DELETED' ? undefined : onEdit} disabled={note.status === 'DELETED'}>{rich.image && <img src={rich.image.src} alt={rich.image.alt} loading="lazy" referrerPolicy="no-referrer" />}<p>{notePreview(note.plainText) || '空白小记'}</p>{rich.tasks.total > 0 && <span className="note-task-progress"><CheckSquare size={13} />{rich.tasks.done}/{rich.tasks.total} 项已完成<i><b style={{ width: `${Math.round(rich.tasks.done / rich.tasks.total * 100)}%` }} /></i></span>}{rich.links > 0 && <span className="note-link-count"><Link2 size={12} />{rich.links} 个链接</span>}</button>
      <div className="note-tags">{note.tags.map((tag) => <span key={tag.id}><i className={`tag-dot ${tag.color.toLowerCase()}`} />{tag.name}</span>)}</div>
      <footer><span>版本 {note.revision}</span><div>{note.status !== 'DELETED' && <button title="分享当前版本快照" aria-label="分享当前版本快照" onClick={onShare}><Link2 size={15} /></button>}{note.status !== 'DELETED' && <button title={note.status === 'ARCHIVED' ? '取消归档' : '归档'} aria-label={note.status === 'ARCHIVED' ? '取消归档' : '归档'} onClick={onArchive}>{note.status === 'ARCHIVED' ? <RotateCcw size={15} /> : <Archive size={15} />}</button>}{note.status !== 'DELETED' && <button title="合并转文稿" aria-label="合并转文稿" onClick={onConvert}><FileText size={15} /></button>}{note.status !== 'DELETED' ? <button title="移入回收站" aria-label="移入回收站" onClick={onDelete}><Trash2 size={15} /></button> : <button title="恢复小记" aria-label="恢复小记" onClick={onRestore}><RotateCcw size={15} /></button>}</div></footer>
    </article>
  )
}

function QuickNoteShareDialog({ note, onClose }: { note: QuickNote; onClose: () => void }) {
  const resourceName = note.plainText.trim().split(/\r?\n/, 1)[0]?.slice(0, 48) || `小记版本 ${note.revision}`
  return <div className="dialog-backdrop quick-note-share-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog quick-note-share-dialog" role="dialog" aria-modal="true" aria-label="分享小记"><div className="dialog-head"><div><p className="eyebrow">小记 · 版本 {note.revision}</p><h2>分享当前快照</h2></div><button className="icon-button" onClick={onClose}><X /></button></div><p className="quick-note-share-summary">{resourceName}</p><ShareManager resourceType="QUICK_NOTE" resourceId={note.id} resourceName={resourceName} /></section></div>
}

export function QuickNoteEditor({ note, tags, onClose, onUpdated }: { note: QuickNote; tags: QuickNoteTag[]; onClose: () => void; onUpdated: () => Promise<unknown> }) {
  const queryClient = useQueryClient()
  const [body, setBody] = useState(note.plainText)
  const [revision, setRevision] = useState(note.revision)
  const [saveState, setSaveState] = useState<'SAVED' | 'SAVING' | 'ERROR'>('SAVED')
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const lastSaved = useRef(note.plainText)
  const history = useInfiniteQuery({
    queryKey: ['quick-note-history', note.id],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<QuickNoteHistoryPage>('/api/v1/quick-notes/history/page', { quickNoteId: note.id, limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
  })
  const revisions = history.data?.pages.flatMap((value) => value.items) ?? []
  useEffect(() => {
    if (body === lastSaved.current) return
    const timer = window.setTimeout(async () => {
      setSaveState('SAVING')
      try {
        const updated = await post<QuickNote>('/api/v1/quick-notes/save', { quickNoteId: note.id, expectedRevision: revision, content: noteDocument(body), plainText: body, kind: 'AUTO_SAVE' })
        lastSaved.current = updated.plainText
        setRevision(updated.revision)
        setSaveState('SAVED')
        setError('')
        await queryClient.invalidateQueries({ queryKey: ['quick-note-history', note.id] })
        await onUpdated()
      } catch (caught) {
        setSaveState('ERROR')
        setError(messageOf(caught))
      }
    }, 900)
    return () => window.clearTimeout(timer)
  }, [body, note.id, onUpdated, queryClient, revision])
  const restore = useMutation({
    mutationFn: (target: number) => post<QuickNote>('/api/v1/quick-notes/history/restore', { quickNoteId: note.id, revision: target }),
    onSuccess: async (updated) => { setBody(updated.plainText); lastSaved.current = updated.plainText; setRevision(updated.revision); await queryClient.invalidateQueries({ queryKey: ['quick-note-history', note.id] }); await onUpdated() },
  })
  const tagMutation = useMutation({
    mutationFn: ({ tagId, selected }: { tagId: string; selected: boolean }) => post('/api/v1/quick-notes/batch', { quickNoteIds: [note.id], operation: selected ? 'ADD_TAG' : 'REMOVE_TAG', tagIds: [tagId] }),
    onSuccess: onUpdated,
  })
  return (
    <div className="dialog-backdrop note-editor-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="note-editor-dialog" role="dialog" aria-modal="true" aria-label="编辑小记">
        <header><div><StickyNote size={18} /><strong>编辑小记</strong><span className={`autosave-state ${saveState.toLowerCase()}`} role="status" aria-live="polite" aria-atomic="true">{saveState === 'SAVING' ? '自动保存中…' : saveState === 'ERROR' ? '保存失败' : '已保存'}</span></div><button className="icon-button" onClick={onClose} aria-label="关闭小记编辑器"><X size={18} /></button></header>
        <div className="note-editor-main">
          <QuickNoteFormattingToolbar editorRef={bodyRef} value={body} onChange={setBody} />
          <textarea ref={bodyRef} autoFocus aria-label="小记正文" value={body} onChange={(event) => setBody(event.target.value)} placeholder="写下想法…" />
          {error && <div className="inline-error" role="alert">{error}。请保留窗口并重试。</div>}
          <div className="editor-tag-list"><Tag size={15} />{tags.map((tag) => { const selected = note.tags.some((current) => current.id === tag.id); return <button className={selected ? 'selected' : ''} key={tag.id} onClick={() => tagMutation.mutate({ tagId: tag.id, selected: !selected })}><i className={`tag-dot ${tag.color.toLowerCase()}`} />{tag.name}{selected && <Check size={12} />}</button> })}</div>
        </div>
        <aside className="note-history" aria-label="小记历史版本"><h3><History size={15} />历史版本</h3>{revisions.map((item) => <button key={item.id} className={item.revision === revision ? 'current' : ''} onClick={() => item.revision !== revision && restore.mutate(item.revision)}><span>版本 {item.revision}</span><small>{saveKindName(item.kind)} · {relativeTime(item.createdAt)}</small><p>{item.plainText || '空白内容'}</p></button>)}{history.hasNextPage && <button className="note-history-more" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? '加载中…' : '加载更多历史版本'}</button>}</aside>
      </div>
    </div>
  )
}

function ConvertNotesDialog({ noteIds, knowledgeBases, onClose, onConverted }: { noteIds: string[]; knowledgeBases: KnowledgeBase[]; onClose: () => void; onConverted: () => Promise<unknown> }) {
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? '')
  const [title, setTitle] = useState(noteIds.length > 1 ? '小记合集' : '小记转文稿')
  const [path, setPath] = useState(`notes-${Date.now()}`)
  const convert = useMutation({
    mutationFn: () => post<Page>('/api/v1/quick-notes/convert', { quickNoteIds: noteIds, knowledgeBaseId, title, path }),
    onSuccess: onConverted,
  })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog" role="dialog" aria-modal="true"><div className="dialog-head"><div><p className="eyebrow">转换</p><h2>{noteIds.length > 1 ? `合并 ${noteIds.length} 条小记` : '转为文稿'}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><label className="field"><span className="field-label">目标知识库</span><select value={knowledgeBaseId} onChange={(event) => setKnowledgeBaseId(event.target.value)}>{knowledgeBases.map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}</select></label><label className="field"><span className="field-label">文稿标题</span><input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span className="field-label">访问路径</span><input value={path} onChange={(event) => setPath(event.target.value)} /></label><p className="conversion-hint">转换成功后，来源小记会自动归档并保留来源关系。</p>{convert.error && <div className="form-error">{messageOf(convert.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!knowledgeBaseId || !title.trim() || !path.trim() || convert.isPending} onClick={() => convert.mutate()}>确认转换</button></div></div></div>
}

export function NotificationsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [category, setCategory] = useState<typeof notificationCategories[number][0]>('ALL')
  const notifications = useInfiniteQuery({
    queryKey: ['notifications', unreadOnly, category],
    queryFn: ({ pageParam }) => post<NotificationPage>('/api/v1/notifications/page', { unreadOnly, category, offset: pageParam, limit: 25 }),
    initialPageParam: 0,
    getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined,
  })
  const notificationItems = notifications.data?.pages.flatMap((page) => page.items) ?? []
  const read = useMutation({
    mutationFn: (notificationId: string) => post('/api/v1/notifications/read', { notificationId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  const readAll = useMutation({
    mutationFn: () => post('/api/v1/notifications/read-all', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
  return (
    <div className="content-page notifications-page">
      <ProductHeader eyebrow="消息" title="与你有关的动态" description="提及、评论、邀请和审批集中在这里。" actions={<button className="button secondary small" onClick={() => readAll.mutate()} disabled={readAll.isPending}><Check size={15} />全部已读</button>} />
      <div className="notification-filters"><div className="tabs"><button className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>全部</button><button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>未读</button></div><div className="notification-categories" aria-label="消息分类">{notificationCategories.map(([value, label]) => <button key={value} className={category === value ? 'active' : ''} onClick={() => setCategory(value)}>{label}</button>)}</div><span>{notificationItems.length}{notifications.hasNextPage ? '+' : ''} 条</span></div>
      <div className="notification-list">
        {notificationItems.map((notification) => <button key={notification.id} className={notification.readAt ? 'read' : 'unread'} onClick={() => { if (!notification.readAt) read.mutate(notification.id); const destination = notificationDestination(notification); if (destination) navigate(destination) }}><NotificationRow value={notification} /><ChevronRight size={17} /></button>)}
        {notifications.error && <div className="notification-state error"><span>{messageOf(notifications.error)}</span><button className="button secondary small" onClick={() => notifications.refetch()}>重试</button></div>}
        {!notifications.isPending && !notifications.error && !notificationItems.length && <ProductEmpty icon={<Inbox />} title="没有消息" description={unreadOnly ? '当前分类中的消息都已读。' : '当前分类还没有新的协作动态。'} />}
        {notifications.hasNextPage && <button className="button secondary notification-more" onClick={() => notifications.fetchNextPage()} disabled={notifications.isFetchingNextPage}>{notifications.isFetchingNextPage ? '加载中…' : '加载更多消息'}</button>}
      </div>
    </div>
  )
}

function NotificationRow({ value, compact = false }: { value: Notification; compact?: boolean }) {
  const label = value.type === 'COMMENT_MENTION' ? '在评论中提到了你' : value.type === 'PAGE_MENTION' ? '在文稿中提到了你' : notificationName(value.type)
  return <div className={`notification-row ${compact ? 'compact' : ''}`}><span className="notification-icon"><Bell size={16} /></span><div><strong>{label}{value.occurrenceCount > 1 && ` · ${value.occurrenceCount} 次`}</strong><p>{value.payload.preview || `${value.resourceType} 有新的协作动态`}</p><time>{relativeTime(value.updatedAt)}</time></div>{!value.readAt && <i />}</div>
}

function ProductHeader({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description?: string; actions?: React.ReactNode }) {
  return <header className="page-header"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</header>
}

function ProductEmpty({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return <div className="empty-state product-empty"><span>{icon}</span><strong>{title}</strong><p>{description}</p></div>
}

function QuickNoteFormattingToolbar({ editorRef, value, onChange }: { editorRef: React.RefObject<HTMLTextAreaElement | null>; value: string; onChange: (value: string) => void }) {
  const wrap = (before: string, after: string, placeholder: string) => editQuickNoteText(editorRef, value, onChange, ({ start, end }) => ({ text: `${before}${value.slice(start, end) || placeholder}${after}`, selectStart: start + before.length, selectEnd: start + before.length + (value.slice(start, end) || placeholder).length }))
  const line = (template: string, selectOffset: number, selectLength: number) => editQuickNoteText(editorRef, value, onChange, ({ start }) => { const prefix = start > 0 && value[start - 1] !== '\n' ? '\n' : ''; return { text: `${prefix}${template}`, selectStart: start + prefix.length + selectOffset, selectEnd: start + prefix.length + selectOffset + selectLength } })
  return <div className="quick-note-format-toolbar" aria-label="小记格式工具"><button type="button" onClick={() => wrap('**', '**', '重点内容')} aria-label="加粗"><Bold /></button><button type="button" onClick={() => wrap('*', '*', '强调内容')} aria-label="斜体"><Italic /></button><button type="button" onClick={() => line('- [ ] 待办事项', 6, 4)} aria-label="插入任务"><CheckSquare /></button><button type="button" onClick={() => wrap('[', '](https://example.com)', '链接标题')} aria-label="插入链接"><Link2 /></button><button type="button" onClick={() => line('![图片说明](https://example.com/image.jpg)', 2, 4)} aria-label="插入图片"><Image /></button><span>支持结构化富文本 · Ctrl/Cmd + Enter 保存</span></div>
}

function editQuickNoteText(editorRef: React.RefObject<HTMLTextAreaElement | null>, value: string, onChange: (value: string) => void, edit: (selection: { start: number; end: number }) => { text: string; selectStart: number; selectEnd: number }) {
  const editor = editorRef.current
  const start = editor?.selectionStart ?? value.length
  const end = editor?.selectionEnd ?? start
  const result = edit({ start, end })
  onChange(value.slice(0, start) + result.text + value.slice(end))
  window.requestAnimationFrame(() => { editorRef.current?.focus(); editorRef.current?.setSelectionRange(result.selectStart, result.selectEnd) })
}

function noteDocument(text: string) {
  const lines = text.split(/\r?\n/)
  const content: Array<Record<string, unknown>> = []
  let tasks: Array<Record<string, unknown>> = []
  const flushTasks = () => { if (tasks.length) { content.push({ type: 'taskList', content: tasks }); tasks = [] } }
  for (const line of lines) {
    const task = /^\s*- \[([ xX])\]\s+(.*)$/.exec(line)
    if (task) { tasks.push({ type: 'taskItem', attrs: { checked: task[1]!.toLowerCase() === 'x' }, content: [{ type: 'paragraph', content: inlineQuickNoteContent(task[2]!) }] }); continue }
    flushTasks()
    const image = /^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/.exec(line)
    if (image) content.push({ type: 'image', attrs: { src: image[2], alt: image[1], title: null } })
    else content.push({ type: 'paragraph', content: inlineQuickNoteContent(line) })
  }
  flushTasks()
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}

function inlineQuickNoteContent(value: string) {
  if (!value) return []
  const nodes: Array<Record<string, unknown>> = []
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push({ type: 'text', text: value.slice(cursor, index) })
    if (match[2]) nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] })
    else if (match[3]) nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] })
    else nodes.push({ type: 'text', text: match[4], marks: [{ type: 'link', attrs: { href: match[5], target: '_blank', rel: 'noopener noreferrer nofollow' } }] })
    cursor = index + match[0].length
  }
  if (cursor < value.length) nodes.push({ type: 'text', text: value.slice(cursor) })
  return nodes
}

function quickNoteRichMeta(note: QuickNote) {
  let image: { src: string; alt: string } | null = null
  let total = 0
  let done = 0
  let links = 0
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    const node = value as { type?: string; attrs?: Record<string, unknown>; marks?: Array<{ type?: string }>; content?: unknown[] }
    if (!image && node.type === 'image') { const src = safeMediaUrl(node.attrs?.src); if (src?.startsWith('https:')) image = { src, alt: typeof node.attrs?.alt === 'string' ? node.attrs.alt : '' } }
    if (node.type === 'taskItem') { total += 1; if (node.attrs?.checked === true) done += 1 }
    links += node.marks?.filter((mark) => mark.type === 'link').length ?? 0
    node.content?.forEach(visit)
  }
  visit(note.content)
  if (!image) { const match = /!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/.exec(note.plainText); const src = safeMediaUrl(match?.[2]); if (src?.startsWith('https:')) image = { src, alt: match?.[1] ?? '' } }
  if (!total) { const matches = [...note.plainText.matchAll(/^\s*- \[([ xX])\]\s+/gm)]; total = matches.length; done = matches.filter((match) => match[1]!.toLowerCase() === 'x').length }
  if (!links) links = [...note.plainText.matchAll(/(?<!!)\[[^\]]+\]\(https?:\/\/[^\s)]+\)/g)].length
  return { image, tasks: { total, done }, links }
}

function notePreview(value: string) {
  return value.replace(/^\s*- \[[ xX]\]\s+/gm, '').replace(/!\[[^\]]*\]\(https?:\/\/[^\s)]+\)/g, '').replace(/\[([^\]]+)\]\(https?:\/\/[^\s)]+\)/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').trim()
}

function relativeTime(value: string) {
  const date = new Date(value)
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return date.toLocaleDateString('zh-CN')
}

function contentTypeName(type: Page['contentType']) {
  return { DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '电子表格', DATABASE: '数据表' }[type]
}

function workbenchPublicationLabel(value: WorkbenchItem['publicationStatus']) { return ({ UNPUBLISHED: '未发布', PUBLISHED: '已发布', CHANGED: '草稿有更新' })[value] }

function saveKindName(kind: QuickNoteRevision['kind']) {
  return { CREATE: '创建', AUTO_SAVE: '自动保存', COMMIT: '记一笔', RESTORE: '恢复' }[kind]
}

function notificationName(type: string) {
  return ({ INVITATION: '邀请你加入', APPROVAL: '审批结果有更新', PUBLICATION: '关注的内容已发布', SHARE_COMMENT: '分享文稿收到新评论', SHARE_APPROVAL_REQUEST: '有人申请访问分享', SHARE_APPROVAL_REVIEWED: '分享访问申请已有结果' } as Record<string, string>)[type] ?? '有一条新消息'
}

function notificationDestination(value: Notification) {
  if (value.type === 'PUBLICATION' && value.payload.publicationId) return `/p/${value.payload.publicationId}`
  if (value.resourceType !== 'PAGE' || value.type === 'SHARE_APPROVAL_REVIEWED') return null
  return `/app/pages/${value.resourceId}${value.type === 'SHARE_APPROVAL_REQUEST' ? '?manage=SHARE' : ''}`
}
