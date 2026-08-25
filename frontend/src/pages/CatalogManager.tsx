import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Check, Copy, FilePlus2, FileText, Folder, GripVertical, History, Link2, LoaderCircle, Pencil, Plus, RotateCcw, Trash2, Unlink, X } from 'lucide-react'
import { messageOf, post } from '../lib/api'
import type { CatalogNode, CatalogTree, Page } from '../types'
import { TextEntryDialog } from '../components/TextEntryDialog'
import { useConfirmDialog } from '../components/ConfirmDialog'
import { safeExternalNavigationUrl } from '../lib/publicNavigation'

interface CatalogRevision { id: string; knowledgeBaseId: string; revisionNo: number; operation: string; actorId: string; snapshot: unknown; createdAt: string }
interface CatalogRevisionPage { items: CatalogRevision[]; nextOffset: number; hasMore: boolean }
type CreateKind = 'GROUP' | 'LINK' | 'DOCUMENT'
type CatalogOperation = { path: string; body: Record<string, unknown>; announcement?: string }

export function CatalogManager({ knowledgeBaseId, pages, onClose }: { knowledgeBaseId: string; pages: Page[]; onClose: () => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const catalog = useQuery({ queryKey: ['catalog', knowledgeBaseId], queryFn: () => post<CatalogTree>('/api/v1/catalog/list', { knowledgeBaseId }) })
  const history = useInfiniteQuery({ queryKey: ['catalog-history', knowledgeBaseId], initialPageParam: 0, queryFn: ({ pageParam }) => post<CatalogRevisionPage>('/api/v1/catalog/history/page', { knowledgeBaseId, limit: 30, offset: pageParam }), getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined })
  const [createKind, setCreateKind] = useState<CreateKind>('GROUP')
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [pageId, setPageId] = useState('')
  const [parentId, setParentId] = useState('')
  const [draggingId, setDraggingId] = useState('')
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchTargetId, setBatchTargetId] = useState('')
  const [copying, setCopying] = useState<{ node: CatalogNode; page: Page } | null>(null)
  const [renaming, setRenaming] = useState<{ node: CatalogNode; label: string } | null>(null)
  const [operationAnnouncement, setOperationAnnouncement] = useState('')
  const secureLinkUrl = safeExternalNavigationUrl(url)
  const tree = catalog.data
  const historyValues = history.data?.pages.flatMap((value) => value.items) ?? []
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages])
  const visibleNodes = useMemo(() => (tree?.nodes ?? []).filter((node) => node.nodeType !== 'DOCUMENT' || Boolean(node.pageId && pageById.has(node.pageId))), [tree?.nodes, pageById])
  const flat = useMemo(() => flatten(visibleNodes), [visibleNodes])
  const unlisted = useMemo(() => pages.filter((page) => !tree?.nodes.some((node) => node.pageId === page.id)), [pages, tree?.nodes])
  const groups = flat.filter((value) => value.node.nodeType === 'GROUP')
  const apply = (value: CatalogTree) => {
    queryClient.setQueryData(['catalog', knowledgeBaseId], value)
    setSelectedIds((items) => items.filter((id) => value.nodes.some((node) => node.id === id)))
    void queryClient.invalidateQueries({ queryKey: ['catalog-history', knowledgeBaseId] })
  }
  const operation = useMutation({
    mutationFn: ({ path, body }: CatalogOperation) => post<CatalogTree>(`/api/v1/catalog/${path}`, { ...body, expectedRevision: tree?.revision ?? 0 }),
    onSuccess: (value, variables) => { apply(value); if (variables.announcement) setOperationAnnouncement(`${variables.announcement}，目录已更新`) },
    onError: (_, variables) => { if (variables.announcement) setOperationAnnouncement(`${variables.announcement}失败，目录已重新载入`); void catalog.refetch() },
  })
  const create = useMutation({
    mutationFn: () => post<CatalogTree>('/api/v1/catalog/create', {
      knowledgeBaseId, nodeType: createKind, pageId: createKind === 'DOCUMENT' ? pageId : null,
      parentId: parentId || null, beforeNodeId: null, afterNodeId: null,
      titleOverride: createKind === 'DOCUMENT' ? null : title, url: createKind === 'LINK' ? secureLinkUrl : null,
      metadata: {}, expectedRevision: tree?.revision ?? 0,
    }),
    onSuccess: (value) => { apply(value); setTitle(''); setUrl(''); setPageId('') },
    onError: () => void catalog.refetch(),
  })
  const restore = useMutation({
    mutationFn: (revisionNo: number) => post<CatalogTree>('/api/v1/catalog/restore', { knowledgeBaseId, revisionNo, expectedRevision: tree?.revision ?? 0 }),
    onSuccess: apply,
    onError: () => void catalog.refetch(),
  })
  const batch = useMutation({
    mutationFn: (operationName: 'MOVE' | 'REMOVE') => post<CatalogTree>('/api/v1/catalog/batch', {
      knowledgeBaseId, nodeIds: selectedIds, operation: operationName,
      targetParentId: operationName === 'MOVE' ? batchTargetId || null : null,
      expectedRevision: tree?.revision ?? 0,
    }),
    onSuccess: (value) => { apply(value); setSelectedIds([]); setBatchTargetId('') },
    onError: () => void catalog.refetch(),
  })
  const trashPage = useMutation({
    mutationFn: (page: Page) => post<void>('/api/v1/pages/trash', { pageId: page.id }),
    onSuccess: async (_, page) => {
      setSelectedIds((items) => items.filter((id) => tree?.nodes.find((node) => node.id === id)?.pageId !== page.id))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }),
        queryClient.invalidateQueries({ queryKey: ['global-trash'] }),
        queryClient.invalidateQueries({ queryKey: ['workbench'] }),
      ])
    },
  })
  const siblings = (node: CatalogNode) => (tree?.nodes ?? []).filter((value) => value.parentId === node.parentId).sort(positionSort)
  const moveRelative = (node: CatalogNode, direction: -1 | 1, announcement?: string) => {
    const values = siblings(node)
    const index = values.findIndex((value) => value.id === node.id)
    const target = values[index + direction]
    if (!target) return
    operation.mutate({ path: 'move', body: { nodeId: node.id, targetParentId: node.parentId, beforeNodeId: direction < 0 ? target.id : null, afterNodeId: direction > 0 ? target.id : null }, announcement })
  }
  const indent = (node: CatalogNode, announcement?: string) => {
    const values = siblings(node)
    const previous = values[values.findIndex((value) => value.id === node.id) - 1]
    if (previous?.nodeType === 'GROUP') operation.mutate({ path: 'move', body: { nodeId: node.id, targetParentId: previous.id, beforeNodeId: null, afterNodeId: null }, announcement })
  }
  const outdent = (node: CatalogNode, announcement?: string) => {
    const parent = tree?.nodes.find((value) => value.id === node.parentId)
    if (parent) operation.mutate({ path: 'move', body: { nodeId: node.id, targetParentId: parent.parentId, beforeNodeId: null, afterNodeId: parent.id }, announcement })
  }
  const keyboardMove = (event: React.KeyboardEvent<HTMLElement>, node: CatalogNode, label: string) => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (operation.isPending) { setOperationAnnouncement('目录正在更新，请稍候'); return }
    const values = siblings(node)
    const index = values.findIndex((value) => value.id === node.id)
    const previous = values[index - 1]
    if (event.key === 'ArrowUp') {
      if (index === 0) setOperationAnnouncement(`${label} 已经是同级第一项`)
      else moveRelative(node, -1, `${label} 上移`)
    } else if (event.key === 'ArrowDown') {
      if (index === values.length - 1) setOperationAnnouncement(`${label} 已经是同级最后一项`)
      else moveRelative(node, 1, `${label} 下移`)
    } else if (event.key === 'ArrowRight') {
      if (previous?.nodeType !== 'GROUP') setOperationAnnouncement(`${label} 的上一项不是分组，无法增加层级`)
      else indent(node, `${label} 已移入分组 ${previous.titleOverride || '未命名分组'}`)
    } else if (!node.parentId) setOperationAnnouncement(`${label} 已经位于目录根级`)
    else outdent(node, `${label} 减少一级`)
  }
  const dropOn = (target: CatalogNode) => {
    const dragged = tree?.nodes.find((value) => value.id === draggingId)
    setDraggingId('')
    if (!dragged || dragged.id === target.id) return
    const descendants = descendantsOf(tree?.nodes ?? [], dragged.id)
    if (descendants.has(target.id)) return
    operation.mutate({ path: 'move', body: target.nodeType === 'GROUP'
      ? { nodeId: dragged.id, targetParentId: target.id, beforeNodeId: null, afterNodeId: null }
      : { nodeId: dragged.id, targetParentId: target.parentId, beforeNodeId: target.id, afterNodeId: null } })
  }
  const selected = new Set(selectedIds)
  const toggleSelected = (id: string) => setSelectedIds((items) => items.includes(id) ? items.filter((value) => value !== id) : [...items, id])
  const targetGroups = groups.filter(({ node }) => !selected.has(node.id) && !selectedIds.some((id) => descendantsOf(tree?.nodes ?? [], id).has(node.id)))
  const allSelected = flat.length > 0 && flat.every(({ node }) => selected.has(node.id))
  return <div className="dialog-backdrop catalog-manager-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="catalog-manager" role="dialog" aria-modal="true" aria-label="目录编排">
    <header><div><p className="eyebrow">知识库</p><h2>目录编排</h2><span>当前版本 {tree?.revision ?? 0} · 文稿可以不进入目录</span></div><button className="icon-button" onClick={onClose} aria-label="关闭目录编排"><X /></button></header>
    <div className="catalog-manager-layout"><main><section className="catalog-create"><div className="segmented">{(['GROUP', 'LINK', 'DOCUMENT'] as const).map((value) => <button key={value} className={createKind === value ? 'active' : ''} onClick={() => setCreateKind(value)}>{value === 'GROUP' ? <Folder /> : value === 'LINK' ? <Link2 /> : <FilePlus2 />}{value === 'GROUP' ? '分组' : value === 'LINK' ? '外部链接' : '已有文稿'}</button>)}</div>{createKind === 'DOCUMENT' ? <select value={pageId} onChange={(event) => setPageId(event.target.value)}><option value="">选择未入目录文稿…</option>{unlisted.map((page) => <option key={page.id} value={page.id}>{page.title}</option>)}</select> : <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={createKind === 'GROUP' ? '分组名称' : '链接标题'} />}{createKind === 'LINK' && <><input type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com" />{url && !secureLinkUrl && <span className="inline-error" role="alert">请输入不含账号凭据的 HTTPS 地址</span>}</>}<select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">目录根级</option>{groups.map(({ node, depth }) => <option key={node.id} value={node.id}>{'　'.repeat(depth)}{node.titleOverride || '未命名分组'}</option>)}</select><button className="button primary small" disabled={create.isPending || (createKind === 'DOCUMENT' ? !pageId : !title.trim()) || (createKind === 'LINK' && !secureLinkUrl)} onClick={() => create.mutate()}><Plus />添加</button></section>
      <section className={`catalog-batch-toolbar ${selectedIds.length ? 'active' : ''}`}><label><input type="checkbox" aria-label="全选目录项" checked={allSelected} disabled={!flat.length || catalog.isPending} onChange={() => setSelectedIds(allSelected ? [] : flat.map(({ node }) => node.id))} /><span>{selectedIds.length ? `已选择 ${selectedIds.length} 项` : '批量选择'}</span></label>{selectedIds.length > 0 && <><select aria-label="批量移动目标" value={batchTargetId} onChange={(event) => setBatchTargetId(event.target.value)}><option value="">移动到目录根级</option>{targetGroups.map(({ node, depth }) => <option key={node.id} value={node.id}>{'　'.repeat(depth)}{node.titleOverride || '未命名分组'}</option>)}</select><button className="button secondary small" disabled={batch.isPending} onClick={() => batch.mutate('MOVE')}><ArrowRight />批量移动</button><button className="button danger small" disabled={batch.isPending} onClick={() => confirmation.confirm({ title: `移出选中的 ${selectedIds.length} 项目录内容`, description: '选中项及其子项会从目录中移出，文稿本身仍会保留。', confirmLabel: '批量移出' }, () => batch.mutate('REMOVE'))}><Unlink />批量移出</button><button className="button quiet small" disabled={batch.isPending} onClick={() => { setSelectedIds([]); setBatchTargetId('') }}><X />取消</button></>}</section>
      <p id="catalog-keyboard-instructions" className="sr-only">目录项支持键盘编排：按 Alt 加上方向键上移、下移、增加层级或减少层级。每个操作完成后都会播报结果。</p>
      <div className={`catalog-manage-list ${draggingId ? 'dragging' : ''}`} role="list" aria-label="目录项编排" aria-describedby="catalog-keyboard-instructions">{flat.map(({ node, depth }) => {
        const page = node.pageId ? pageById.get(node.pageId) : undefined
        const label = node.titleOverride || page?.title || node.url || '未命名'
        const values = siblings(node); const index = values.findIndex((value) => value.id === node.id)
        const previous = values[index - 1]
        return <article key={node.id} role="listitem" draggable={!selectedIds.length} onKeyDown={(event) => keyboardMove(event, node, label)} onDragStart={() => setDraggingId(node.id)} onDragEnd={() => setDraggingId('')} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); dropOn(node) }} className={`${draggingId === node.id ? 'drag-source ' : ''}${selected.has(node.id) ? 'selected' : ''}`} style={{ paddingLeft: 12 + depth * 22 }}>
          <input className="catalog-select-box" aria-label={`选择 ${label}`} type="checkbox" checked={selected.has(node.id)} onChange={() => toggleSelected(node.id)} onClick={(event) => event.stopPropagation()} />
          <GripVertical className="catalog-grip" />
          <span className={`catalog-node-icon ${node.nodeType.toLowerCase()}`}>{node.nodeType === 'GROUP' ? <Folder /> : node.nodeType === 'LINK' ? <Link2 /> : <FileText />}</span>
          <div><strong>{label}</strong><small>{node.nodeType === 'LINK' ? node.url : node.nodeType === 'DOCUMENT' ? page?.path : `${(tree?.nodes ?? []).filter((value) => value.parentId === node.id).length} 个子项`}</small></div>
          <div className="catalog-row-actions">
            <button disabled={index === 0 || operation.isPending} onClick={() => moveRelative(node, -1)} title="上移" aria-label={`上移 ${label}`}><ArrowUp /></button>
            <button disabled={index === values.length - 1 || operation.isPending} onClick={() => moveRelative(node, 1)} title="下移" aria-label={`下移 ${label}`}><ArrowDown /></button>
            <button disabled={previous?.nodeType !== 'GROUP' || operation.isPending} onClick={() => indent(node)} title="缩进到上一分组" aria-label={`缩进 ${label}`}><ArrowRight /></button>
            <button disabled={!node.parentId || operation.isPending} onClick={() => outdent(node)} title="减少层级" aria-label={`减少 ${label} 的层级`}><ArrowLeft /></button>
            <button onClick={() => setRenaming({ node, label })} title="重命名" aria-label={`重命名 ${label}`}><Pencil /></button>
            {page && <button onClick={() => setCopying({ node, page })} title="复制文稿" aria-label={`复制文稿 ${label}`}><Copy /></button>}
            <button className="danger" onClick={() => confirmation.confirm({ title: `从目录移出「${label}」`, description: '文稿会保留在“全部文稿”中；移出分组时，其下级目录项也会一并移出。', confirmLabel: '移出目录' }, () => operation.mutate({ path: 'remove', body: { nodeId: node.id } }))} title="移出目录" aria-label={`移出目录 ${label}`}><Unlink /></button>
            {page && <button className="danger" disabled={trashPage.isPending} onClick={() => confirmation.confirm({ title: `删除文稿「${page.title}」`, description: '文稿会进入回收站，恢复后仍回到当前目录位置。', confirmLabel: '删除文稿' }, () => trashPage.mutate(page))} title="删除文稿" aria-label={`删除文稿 ${label}`}><Trash2 /></button>}
          </div>
        </article>
      })}{!catalog.isPending && !flat.length && <div className="catalog-manage-empty"><Folder /><p>目录还是空的。先添加分组、链接或已有文稿。</p></div>}</div><div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{operationAnnouncement}</div>{(operation.error || create.error || restore.error || batch.error || trashPage.error) && <div className="form-error" role="alert">{messageOf(operation.error ?? create.error ?? restore.error ?? batch.error ?? trashPage.error)}；目录已重新载入。</div>}</main><aside><header><History /><strong>目录历史</strong></header><div>{historyValues.map((revision) => <article key={revision.id}><span>{revision.revisionNo}</span><div><strong>{operationLabel(revision.operation)}</strong><time>{formatTime(revision.createdAt)}</time></div><button className="icon-button" disabled={restore.isPending || revision.revisionNo === tree?.revision} title={`恢复到版本 ${revision.revisionNo}`} aria-label={`恢复目录到版本 ${revision.revisionNo}`} onClick={() => confirmation.confirm({ title: `恢复目录到版本 ${revision.revisionNo}`, description: '当前目录会先保留为一个新的历史版本，之后可以再次恢复。', confirmLabel: '恢复此版本', tone: 'primary' }, () => restore.mutate(revision.revisionNo))}><RotateCcw /></button></article>)}{!history.isPending && !historyValues.length && <p className="catalog-history-empty">尚无变更记录</p>}</div>{history.hasNextPage && <button className="catalog-history-more" disabled={history.isFetchingNextPage} onClick={() => history.fetchNextPage()}>{history.isFetchingNextPage ? '加载中…' : '加载更多目录历史'}</button>}</aside></div>
    {copying && tree && <CatalogCopyDialog knowledgeBaseId={knowledgeBaseId} catalogRevision={tree.revision} node={copying.node} page={copying.page} onClose={() => setCopying(null)} onCatalogChanged={apply} />}
    {renaming && <TextEntryDialog title="重命名目录项" label="新标题" initialValue={renaming.label} maxLength={500} confirmLabel="保存标题" onSubmit={(nextTitle) => { operation.mutate({ path: 'rename', body: { nodeId: renaming.node.id, title: nextTitle } }); setRenaming(null) }} onClose={() => setRenaming(null)} />}
    {confirmation.dialog}
  </div></div>
}

function CatalogCopyDialog({ knowledgeBaseId, catalogRevision, node, page, onClose, onCatalogChanged }: { knowledgeBaseId: string; catalogRevision: number; node: CatalogNode; page: Page; onClose: () => void; onCatalogChanged: (tree: CatalogTree) => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(`${page.title}（副本）`.slice(0, 500))
  const [path, setPath] = useState(copyPath(page.path))
  const copy = useMutation({
    mutationFn: async () => {
      const created = await post<Page>('/api/v1/pages/copy', { pageId: page.id, targetKnowledgeBaseId: knowledgeBaseId, title, path })
      try {
        const catalog = await post<CatalogTree>('/api/v1/catalog/create', { knowledgeBaseId, nodeType: 'DOCUMENT', pageId: created.id, parentId: node.parentId, beforeNodeId: null, afterNodeId: node.id, titleOverride: null, url: null, metadata: {}, expectedRevision: catalogRevision })
        return { created, catalog, catalogError: null as unknown }
      } catch (catalogError) {
        return { created, catalog: null, catalogError }
      }
    },
    onSuccess: async (value) => {
      if (value.catalog) onCatalogChanged(value.catalog)
      await queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] })
    },
  })
  return <div className="nested-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="dialog catalog-copy-dialog" role="dialog" aria-modal="true" aria-label={`复制文稿 ${page.title}`}><div className="dialog-head"><div><p className="eyebrow">目录操作</p><h2>{copy.data ? '副本已经创建' : '复制文稿'}</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭复制文稿"><X /></button></div>{copy.data ? <div className="catalog-copy-success"><Check /><div><strong>{copy.data.created.title}</strong><p>{copy.data.catalogError ? `文稿已复制，但目录在此期间发生变化，副本已保留在“全部文稿”中：${messageOf(copy.data.catalogError)}` : '正文、文稿设置和标签已复制，并已放在原文稿之后；发布、分享和独立权限不会复制。'}</p><a className="button primary" href={`/app/kb/${knowledgeBaseId}/pages/${copy.data.created.id}`}>打开副本</a></div></div> : <><p className="form-note">复制当前草稿、文稿设置和标签；不会复制发布状态、分享链接或文稿级权限。</p><label className="field"><span className="field-label">副本标题</span><input autoFocus aria-label="副本标题" maxLength={500} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field"><span className="field-label">访问路径</span><input aria-label="副本访问路径" maxLength={180} value={path} onChange={(event) => setPath(slugPath(event.target.value))} /></label>{copy.error && <div className="form-error">{messageOf(copy.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!title.trim() || !path || copy.isPending} onClick={() => copy.mutate()}>{copy.isPending ? <LoaderCircle className="spin" /> : <Copy />}{copy.isPending ? '正在复制…' : '创建副本'}</button></div></>}</section></div>
}

function flatten(nodes: CatalogNode[]) {
  const byParent = new Map<string | null, CatalogNode[]>()
  for (const node of nodes) byParent.set(node.parentId, [...(byParent.get(node.parentId) ?? []), node])
  for (const values of byParent.values()) values.sort(positionSort)
  const result: Array<{ node: CatalogNode; depth: number }> = []
  const visit = (parentId: string | null, depth: number) => { for (const node of byParent.get(parentId) ?? []) { result.push({ node, depth }); visit(node.id, depth + 1) } }
  visit(null, 0)
  return result
}
function descendantsOf(nodes: CatalogNode[], root: string) { const result = new Set<string>(); let changed = true; while (changed) { changed = false; for (const node of nodes) if ((node.parentId === root || (node.parentId && result.has(node.parentId))) && !result.has(node.id)) { result.add(node.id); changed = true } } return result }
function positionSort(left: CatalogNode, right: CatalogNode) { return left.position.localeCompare(right.position) }
function slugPath(value: string) { return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 180) }
function copyPath(value: string) { const suffix = '-copy'; return `${value.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '') || 'page'}${suffix}` }
function operationLabel(value: string) { return ({ CREATE: '创建节点', MOVE: '移动节点', RENAME: '重命名', REMOVE: '移出目录', BATCH_MOVE: '批量移动', BATCH_REMOVE: '批量移出', RESTORE: '恢复历史版本' } as Record<string, string>)[value] ?? value }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
