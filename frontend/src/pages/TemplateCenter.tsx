import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FileText, LayoutTemplate, LoaderCircle, Plus, Search, Sparkles, Trash2, X } from 'lucide-react'
import { messageOf, post } from '../lib/api'
import { safeMediaUrl } from '../lib/contentCards'
import type { KnowledgeBase, Template, TemplateInstance, TemplatePage, Workspace } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

export function TemplateCenter({ workspaces }: { workspaces: Workspace[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '')
  const [type, setType] = useState<'' | Template['templateType']>('')
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Template | null>(null)
  const workspace = workspaceId || workspaces[0]?.id || ''
  const templates = useInfiniteQuery({ queryKey: ['templates', workspace, type, query], queryFn: ({ pageParam }) => post<TemplatePage>('/api/v1/templates/page', { workspaceId: workspace, templateType: type || null, query, limit: 24, offset: pageParam }), initialPageParam: 0, getNextPageParam: (page) => page.hasMore ? page.nextOffset : undefined, enabled: Boolean(workspace) })
  const items=templates.data?.pages.flatMap((page)=>page.items)??[]
  return <div className="content-page template-page">
    <header className="page-header"><div><p className="eyebrow">创作资产</p><h1>模板中心</h1><p>从成熟的文稿或完整知识库结构开始，内部引用会自动重映射。</p></div><select className="compact-select" aria-label="模板所属空间" value={workspace} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></header>
    <div className="template-toolbar"><label><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模板与分类" /></label><div className="segmented"><button className={type === '' ? 'active' : ''} onClick={() => setType('')}>全部</button><button className={type === 'DOCUMENT' ? 'active' : ''} onClick={() => setType('DOCUMENT')}>文稿</button><button className={type === 'KNOWLEDGE_BASE' ? 'active' : ''} onClick={() => setType('KNOWLEDGE_BASE')}>知识库</button></div></div>
    <div className="template-grid">
      {items.map((item) => { const thumbnail = safeMediaUrl(item.thumbnail); return <button className="template-card" key={item.id} onClick={() => setSelected(item)}><span className="template-cover">{thumbnail ? <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" /> : item.templateType === 'DOCUMENT' ? <FileText /> : <BookOpen />}</span><span><small>{item.category || (item.templateType === 'DOCUMENT' ? '文稿模板' : '知识库模板')}</small><strong>{item.name}</strong><p>{item.description || '一个可复用的内容起点'}</p><em>已使用 {item.useCount} 次</em></span></button> })}
      {!templates.isPending && !items.length && <div className="template-empty"><LayoutTemplate size={34} /><strong>还没有匹配的模板</strong><p>可在文稿或知识库页面保存第一个模板。</p></div>}
      {templates.hasNextPage && <button className="button secondary template-load-more" onClick={() => templates.fetchNextPage()} disabled={templates.isFetchingNextPage}>{templates.isFetchingNextPage && <LoaderCircle className="spin" />}{templates.isFetchingNextPage ? '正在加载更多模板' : '加载更多模板'}</button>}
    </div>
    {templates.error && <div className="inline-error">{messageOf(templates.error)}</div>}
    {selected && <InstantiateTemplateDialog template={selected} workspaceId={workspace} onClose={() => setSelected(null)} />}
  </div>
}

function InstantiateTemplateDialog({ template, workspaceId, onClose }: { template: Template; workspaceId: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const detail = useQuery({ queryKey: ['template', template.id], queryFn: () => post<Template>('/api/v1/templates/get', { templateId: template.id }), initialData: template })
  const value = detail.data
  const [name, setName] = useState(template.name)
  const [slug, setSlug] = useState(`${slugify(template.name)}-${Date.now().toString().slice(-5)}`)
  const knowledgeBases = useQuery({ queryKey: ['knowledge-bases', workspaceId], queryFn: () => post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId }) })
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const effectiveKb = knowledgeBaseId || knowledgeBases.data?.[0]?.id || ''
  const create = useMutation({ mutationFn: () => value.templateType === 'DOCUMENT'
    ? post<TemplateInstance>('/api/v1/templates/instantiate-document', { templateId: value.id, knowledgeBaseId: effectiveKb, title: name, path: slug })
    : post<TemplateInstance>('/api/v1/templates/instantiate-knowledge-base', { templateId: value.id, workspaceId, name, slug }),
    onSuccess: (instance) => { onClose(); window.location.assign(instance.targetResourceType === 'PAGE' ? `/app/kb/${effectiveKb}/pages/${instance.targetResourceId}` : `/app/kb/${instance.targetResourceId}`) },
  })
  const remove = useMutation({ mutationFn: () => post<void>('/api/v1/templates/delete', { templateId: value.id }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['templates'] }); onClose() } })
  const operationError = detail.error ?? create.error ?? remove.error
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog template-detail-dialog"><div className="dialog-head"><div><p className="eyebrow">使用模板</p><h2>{value.name}</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><div className="template-detail-summary"><span>{value.templateType === 'DOCUMENT' ? <FileText /> : <BookOpen />}</span><div><strong>{value.category || (value.templateType === 'DOCUMENT' ? '文稿模板' : '知识库模板')}</strong><p>{value.description || '这个模板没有补充说明。'}</p><small>{value.visibility === 'PRIVATE' ? '仅创建者可见' : '空间成员可见'} · 已使用 {value.useCount} 次 · 更新于 {formatTemplateTime(value.updatedAt)}</small></div></div>{value.templateType === 'DOCUMENT' && <label className="field"><span className="field-label">目标知识库</span><select value={effectiveKb} onChange={(event) => setKnowledgeBaseId(event.target.value)}>{(knowledgeBases.data ?? []).map((kb) => <option key={kb.id} value={kb.id}>{kb.name}</option>)}</select></label>}<label className="field"><span className="field-label">{value.templateType === 'DOCUMENT' ? '文稿标题' : '知识库名称'}</span><input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">路径</span><input value={slug} onChange={(event) => setSlug(slugify(event.target.value))} /></label>{Boolean(operationError) && <div className="form-error">{messageOf(operationError)}</div>}<div className="dialog-actions template-dialog-actions"><button className="button danger" disabled={remove.isPending || create.isPending} onClick={() => confirmation.confirm({ title: `删除模板「${value.name}」`, description: '模板会从模板中心永久删除，已使用它创建的内容不会受影响。', confirmLabel: '删除模板' }, () => remove.mutate())}><Trash2 size={15} />删除模板</button><span /><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name || !slug || (value.templateType === 'DOCUMENT' && !effectiveKb) || create.isPending || remove.isPending} onClick={() => create.mutate()}><Sparkles size={15} />创建</button></div>{confirmation.dialog}</div></div>
}

export function SaveTemplateDialog({ sourceType, sourceId, onClose }: { sourceType: 'DOCUMENT' | 'KNOWLEDGE_BASE'; sourceId: string; onClose: () => void }) {
  const queryClient = useQueryClient(); const [name, setName] = useState(''); const [description, setDescription] = useState(''); const [category, setCategory] = useState(''); const [thumbnail, setThumbnail] = useState(''); const [visibility, setVisibility] = useState<'PRIVATE' | 'WORKSPACE'>('PRIVATE')
  const parsedThumbnail = safeMediaUrl(thumbnail)
  const safeThumbnail = parsedThumbnail?.startsWith('https://') ? parsedThumbnail : ''
  const thumbnailInvalid = Boolean(thumbnail && !safeThumbnail)
  const save = useMutation({ mutationFn: () => post<Template>(sourceType === 'DOCUMENT' ? '/api/v1/templates/save-document' : '/api/v1/templates/save-knowledge-base', { [sourceType === 'DOCUMENT' ? 'pageId' : 'knowledgeBaseId']: sourceId, name, description, category, thumbnail: safeThumbnail || null, visibility }), onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ['templates'] }); onClose() } })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog"><div className="dialog-head"><div><p className="eyebrow">保存资产</p><h2>保存为模板</h2></div><button className="icon-button" onClick={onClose}><X size={18} /></button></div><label className="field"><span className="field-label">模板名称</span><input autoFocus value={name} maxLength={160} onChange={(event) => setName(event.target.value)} placeholder="研发周报" /></label><label className="field"><span className="field-label">说明</span><input value={description} maxLength={4_000} onChange={(event) => setDescription(event.target.value)} placeholder="适用范围与使用方式" /></label><label className="field"><span className="field-label">分类</span><input value={category} maxLength={80} onChange={(event) => setCategory(event.target.value)} placeholder="工程、项目、个人…" /></label><label className="field"><span className="field-label">模板封面（可选）</span><input type="url" value={thumbnail} maxLength={2_000} onChange={(event) => setThumbnail(event.target.value)} placeholder="https://example.com/template-cover.jpg" />{thumbnailInvalid && <span className="form-error" role="alert">请输入不含账号凭据的 HTTPS 图片地址</span>}</label><label className="field"><span className="field-label">可见范围</span><select value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="PRIVATE">仅自己</option><option value="WORKSPACE">空间成员</option></select></label>{save.error && <div className="form-error">{messageOf(save.error)}</div>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim() || thumbnailInvalid || save.isPending} onClick={() => save.mutate()}><Plus size={15} />保存模板</button></div></div></div>
}

function slugify(value: string) { return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '') }
function formatTemplateTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) }
