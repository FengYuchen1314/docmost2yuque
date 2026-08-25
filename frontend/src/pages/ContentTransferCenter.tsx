import { useMemo, useState } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { Archive, Ban, CheckCircle2, Download, FileArchive, FileInput, FileOutput, LoaderCircle, RefreshCw, Upload, XCircle } from 'lucide-react'
import { messageOf, post, upload } from '../lib/api'
import type { Page, TransferTask, TransferTaskPage } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

const importFormats = ['MARKDOWN', 'HTML', 'TXT', 'ZIP', 'DOCX', 'XLSX', 'NOTION', 'CONFLUENCE'] as const
type ExportFormat = 'MARKDOWN' | 'HTML' | 'DOCX' | 'PDF' | 'JPG' | 'PNG' | 'SVG' | 'XLSX' | 'CSV'
const exportFormats: Record<Page['contentType'], readonly ExportFormat[]> = {
  DOCUMENT: ['MARKDOWN', 'HTML', 'DOCX', 'PDF', 'JPG'],
  WHITEBOARD: ['PNG', 'JPG', 'SVG', 'PDF'],
  SPREADSHEET: ['XLSX', 'PDF'],
  DATABASE: ['XLSX', 'CSV'],
}

export function ContentTransferCenter() {
  const [filter, setFilter] = useState<'ALL' | 'IMPORT' | 'EXPORT' | 'FAILED' | 'CANCELLED'>('ALL')
  const tasks = useInfiniteQuery({
    queryKey: ['content-transfers'],
    initialPageParam: 0,
    queryFn: ({ pageParam }) => post<TransferTaskPage>('/api/v1/content-transfers/page', { limit: 30, offset: pageParam }),
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextOffset : undefined,
    refetchInterval: (query) => query.state.data?.pages.some((page) => page.items.some((task) => task.status === 'PENDING' || task.status === 'RUNNING')) ? 2_000 : false,
  })
  const values = useMemo(() => tasks.data?.pages.flatMap((value) => value.items) ?? [], [tasks.data])
  const visible = useMemo(() => values.filter((task) => filter === 'ALL' || (filter === 'FAILED' || filter === 'CANCELLED' ? task.status === filter : task.taskType === filter)), [filter, values])
  return <div className="content-page transfer-center">
    <header className="page-header"><div><p className="eyebrow">内容迁移</p><h1>导入与导出</h1><p>查看完整任务历史、错误报告和仍在有效期内的导出文件。</p></div><button className="button secondary small" onClick={() => tasks.refetch()} disabled={tasks.isFetching}><RefreshCw size={15} className={tasks.isFetching ? 'spin' : ''} />刷新</button></header>
    <div className="transfer-summary">
      <Summary icon={<FileInput />} label="已加载导入" value={values.filter((task) => task.taskType === 'IMPORT').length} />
      <Summary icon={<FileOutput />} label="已加载导出" value={values.filter((task) => task.taskType === 'EXPORT').length} />
      <Summary icon={<XCircle />} label="已加载失败" value={values.filter((task) => task.status === 'FAILED').length} danger />
      <Summary icon={<Ban />} label="已加载取消" value={values.filter((task) => task.status === 'CANCELLED').length} />
    </div>
    <div className="tabs transfer-tabs">{(['ALL', 'IMPORT', 'EXPORT', 'FAILED', 'CANCELLED'] as const).map((value) => <button key={value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{({ ALL: '全部', IMPORT: '导入', EXPORT: '导出', FAILED: '失败', CANCELLED: '已取消' })[value]}</button>)}</div>
    {tasks.error && <div className="form-error">{messageOf(tasks.error)}</div>}
    <div className="transfer-list">
      {visible.map((task) => <TransferTaskRow key={task.id} task={task} />)}
      {!tasks.isPending && !visible.length && <div className="transfer-empty"><Archive /><strong>暂无任务</strong><p>从知识库或文稿菜单发起导入导出后，任务会出现在这里。</p></div>}
    </div>
    {tasks.hasNextPage && <button className="button secondary transfer-more" disabled={tasks.isFetchingNextPage} onClick={() => tasks.fetchNextPage()}>{tasks.isFetchingNextPage ? '加载中…' : '加载更多任务'}</button>}
  </div>
}

function Summary({ icon, label, value, danger = false }: { icon: React.ReactNode; label: string; value: number; danger?: boolean }) {
  return <div className={`transfer-summary-card ${danger ? 'danger' : ''}`}><span>{icon}</span><div><small>{label}</small><strong>{value}</strong></div></div>
}

function TransferTaskRow({ task }: { task: TransferTask }) {
  const queryClient = useQueryClient()
  const confirmation = useConfirmDialog()
  const cancel = useMutation({
    mutationFn: () => post<TransferTask>('/api/v1/content-transfers/cancel', { taskId: task.id }),
    onSuccess: (value) => {
      queryClient.setQueryData<InfiniteData<TransferTaskPage>>(['content-transfers'], (current) => current && ({ ...current, pages: current.pages.map((page) => ({ ...page, items: page.items.map((item) => item.id === value.id ? value : item) })) }))
    },
  })
  const label = task.taskType === 'IMPORT' ? task.originalFilename || '导入文件' : task.resultFilename || `${task.resourceType} 导出`
  const icon = task.status === 'SUCCEEDED' ? <CheckCircle2 /> : task.status === 'FAILED' ? <XCircle /> : task.status === 'CANCELLED' ? <Ban /> : <LoaderCircle className="spin" />
  return <article className={`transfer-row status-${task.status.toLowerCase()}`}>
    <span className="transfer-status-icon">{icon}</span>
    <div className="transfer-main"><div><strong>{label}</strong><span className="transfer-format">{task.sourceFormat}</span></div><p>{task.taskType === 'IMPORT' ? '导入到知识库' : task.resourceType === 'PAGE' ? '导出文稿' : '导出知识库'} · {formatTime(task.createdAt)}</p>{task.report?.error && <div className="transfer-error">{task.report.error}</div>}</div>
    <div className="transfer-result"><strong>{task.cancelRequested && task.status !== 'CANCELLED' ? '正在取消' : statusLabel(task.status)}</strong>{task.status === 'SUCCEEDED' && task.taskType === 'IMPORT' && <small>成功 {task.report.importedCount ?? 0} 篇</small>}{task.status === 'SUCCEEDED' && task.taskType === 'EXPORT' && <small>{formatBytes(task.artifactSize)}</small>}{task.status === 'CANCELLED' && <small>未完成的输入与产物已清理</small>}</div>
    {task.status === 'SUCCEEDED' && task.taskType === 'EXPORT' && <a className="button secondary small" href={downloadUrl(task.id)}><Download size={15} />下载</a>}
    {(task.status === 'PENDING' || task.status === 'RUNNING') && <button className="button quiet danger small" disabled={task.cancelRequested || cancel.isPending} onClick={() => confirmation.confirm({ title: `取消“${label}”`, description: '未完成的导入不会保留，尚未生成的导出文件会被清理。', confirmLabel: '取消任务' }, () => cancel.mutate())}><Ban size={15} />{task.cancelRequested || cancel.isPending ? '正在取消' : '取消'}</button>}
    {cancel.error && <div className="transfer-row-error">{messageOf(cancel.error)}</div>}
    {confirmation.dialog}
  </article>
}

export function KnowledgeBaseTransferDialog({ knowledgeBaseId, initialTab = 'IMPORT', onClose }: { knowledgeBaseId: string; initialTab?: 'IMPORT' | 'EXPORT'; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(initialTab)
  const [file, setFile] = useState<File | null>(null)
  const [format, setFormat] = useState<'AUTO' | typeof importFormats[number]>('AUTO')
  const [completed, setCompleted] = useState<TransferTask | null>(null)
  const importTask = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('请选择文件')
      const form = new FormData()
      form.append('knowledgeBaseId', knowledgeBaseId)
      if (format !== 'AUTO') form.append('format', format)
      form.append('file', file)
      return waitForTask(await upload<TransferTask>('/api/v1/content-transfers/imports/upload', form))
    },
    onSuccess: async (task) => {
      setCompleted(task)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['content-transfers'] }),
        queryClient.invalidateQueries({ queryKey: ['pages', knowledgeBaseId] }),
        queryClient.invalidateQueries({ queryKey: ['catalog', knowledgeBaseId] }),
      ])
    },
  })
  const exportTask = useMutation({
    mutationFn: async () => waitForTask(await post<TransferTask>('/api/v1/content-transfers/exports/knowledge-base', { knowledgeBaseId })),
    onSuccess: async (task) => {
      setCompleted(task)
      await queryClient.invalidateQueries({ queryKey: ['content-transfers'] })
      startDownload(task)
    },
  })
  const error = importTask.error ?? exportTask.error
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog transfer-dialog" role="dialog" aria-modal="true">
    <div className="dialog-head"><div><p className="eyebrow">知识库</p><h2>导入与导出</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭知识库导入与导出"><XCircle size={18} /></button></div>
    <div className="segmented"><button className={tab === 'IMPORT' ? 'active' : ''} onClick={() => { setTab('IMPORT'); setCompleted(null) }}>导入内容</button><button className={tab === 'EXPORT' ? 'active' : ''} onClick={() => { setTab('EXPORT'); setCompleted(null) }}>导出知识库</button></div>
    {tab === 'IMPORT' ? <>
      <label className="upload-drop"><Upload /><strong>{file?.name ?? '选择要导入的文件'}</strong><small>支持 Markdown、HTML、TXT、ZIP、DOCX、XLSX、Notion 和 Confluence，最大 50 MiB</small><input type="file" accept=".md,.markdown,.html,.htm,.txt,.zip,.docx,.xlsx" onChange={(event) => { setFile(event.target.files?.[0] ?? null); setCompleted(null) }} /></label>
      <label className="field"><span className="field-label">文件格式</span><select value={format} onChange={(event) => setFormat(event.target.value as typeof format)}><option value="AUTO">自动识别</option>{importFormats.map((value) => <option key={value} value={value}>{value}</option>)}</select><small>ZIP 中的目录结构会被安全校验，并导入其中受支持的文稿。</small></label>
    </> : <div className="kb-export-explain"><FileArchive /><div><strong>导出为 ZIP</strong><p>将所有未删除文稿转换为 Markdown，并附带 `manifest.json`。任务文件保留 7 天。</p></div></div>}
    {completed && <TaskOutcome task={completed} />}
    {error && <div className="form-error">{error instanceof Error ? error.message : messageOf(error)}</div>}
    <div className="dialog-actions"><button className="button quiet" onClick={onClose}>关闭</button>{tab === 'IMPORT' ? <button className="button primary" disabled={!file || importTask.isPending} onClick={() => importTask.mutate()}><FileInput size={16} />{importTask.isPending ? '正在导入…' : '开始导入'}</button> : <button className="button primary" disabled={exportTask.isPending} onClick={() => exportTask.mutate()}><FileOutput size={16} />{exportTask.isPending ? '正在打包…' : '导出并下载'}</button>}</div>
  </div></div>
}

export function PageExportDialog({ pageId, contentType, canUsePublished, onClose }: { pageId: string; contentType: Page['contentType']; canUsePublished: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const formats = exportFormats[contentType]
  const [format, setFormat] = useState<ExportFormat>(formats[0]!)
  const [published, setPublished] = useState(false)
  const [completed, setCompleted] = useState<TransferTask | null>(null)
  const mutation = useMutation({
    mutationFn: async () => waitForTask(await post<TransferTask>('/api/v1/content-transfers/exports/page', { pageId, format, published })),
    onSuccess: async (task) => { setCompleted(task); await queryClient.invalidateQueries({ queryKey: ['content-transfers'] }); startDownload(task) },
  })
  return <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="dialog transfer-dialog" role="dialog" aria-modal="true">
    <div className="dialog-head"><div><p className="eyebrow">文稿</p><h2>导出</h2></div><button className="icon-button" onClick={onClose} aria-label="关闭文稿导出"><XCircle size={18} /></button></div>
    <label className="field"><span className="field-label">导出格式</span><select value={format} onChange={(event) => { setFormat(event.target.value as ExportFormat); setCompleted(null) }}>{formats.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    <fieldset className="export-scope"><legend>内容版本</legend><label><input type="radio" checked={!published} onChange={() => setPublished(false)} />当前草稿</label><label className={!canUsePublished ? 'disabled' : ''}><input type="radio" checked={published} disabled={!canUsePublished} onChange={() => setPublished(true)} />已发布版本</label></fieldset>
    {completed && <TaskOutcome task={completed} />}
    {mutation.error && <div className="form-error">{messageOf(mutation.error)}</div>}
    <div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" onClick={() => mutation.mutate()} disabled={mutation.isPending}><Download size={16} />{mutation.isPending ? '正在生成…' : '导出并下载'}</button></div>
  </div></div>
}

function TaskOutcome({ task }: { task: TransferTask }) {
  const cancelled = task.status === 'CANCELLED'
  const failed = task.status === 'FAILED'
  return <div className={`task-outcome ${failed || cancelled ? 'failed' : ''}`}>{failed ? <XCircle /> : cancelled ? <Ban /> : <CheckCircle2 />}<div><strong>{failed ? '处理失败' : cancelled ? '任务已取消' : '处理完成'}</strong><p>{cancelled ? '未完成的输入与产物已清理。' : task.report?.error ?? (task.taskType === 'IMPORT' ? `已导入 ${task.report.importedCount ?? 0} 篇文稿` : `${task.resultFilename ?? '文件'} 已开始下载`)}</p></div></div>
}

function startDownload(task: TransferTask) {
  if (task.status !== 'SUCCEEDED' || task.taskType !== 'EXPORT') return
  const link = document.createElement('a')
  link.href = downloadUrl(task.id)
  link.download = task.resultFilename ?? ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

async function waitForTask(initial: TransferTask): Promise<TransferTask> {
  let task = initial
  for (let attempt = 0; attempt < 240 && (task.status === 'PENDING' || task.status === 'RUNNING'); attempt += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 250))
    task = await post<TransferTask>('/api/v1/content-transfers/get', { taskId: task.id })
  }
  if (task.status === 'PENDING' || task.status === 'RUNNING') throw new Error('任务仍在处理中，请稍后到任务中心查看')
  return task
}

function downloadUrl(taskId: string) { return `/api/v1/content-transfers/download?taskId=${encodeURIComponent(taskId)}` }
function statusLabel(status: TransferTask['status']) { return ({ PENDING: '等待中', RUNNING: '处理中', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' })[status] }
function formatTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) }
function formatBytes(value: number) { if (value < 1024) return `${value} B`; if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`; return `${(value / 1024 / 1024).toFixed(1)} MiB` }
