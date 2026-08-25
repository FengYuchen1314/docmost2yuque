import { useMutation, useQuery } from '@tanstack/react-query'
import { BarChart3, Download, Eye, MessageSquare, Pencil, Share2, Users, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { downloadPost, messageOf, post, type DownloadedFile } from '../lib/api'
import type { AnalyticsReport } from '../types'

type AnalyticsPanelProps = {
  pageId?: string
  knowledgeBaseId?: string
  onClose: () => void
}

export function AnalyticsPanel({ pageId, knowledgeBaseId, onClose }: AnalyticsPanelProps) {
  const [days, setDays] = useState<7 | 30 | 90 | 365>(30)
  const to = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const from = useMemo(() => subtractDays(to, days - 1), [days, to])
  const isKnowledgeBase = Boolean(knowledgeBaseId)
  const resourceId = knowledgeBaseId || pageId || ''
  const resourceKey = isKnowledgeBase ? 'knowledgeBaseId' : 'pageId'
  const endpoint = isKnowledgeBase ? 'knowledge-base' : 'page'
  const requestBody = { [resourceKey]: resourceId, from, to }
  const report = useQuery({
    queryKey: ['analytics', endpoint, resourceId, from, to],
    queryFn: () => post<AnalyticsReport>(`/api/v1/analytics/${endpoint}`, requestBody),
    enabled: Boolean(resourceId),
  })
  const exportFile = useMutation({
    mutationFn: () => downloadPost(`/api/v1/analytics/${endpoint}/export`, requestBody),
    onSuccess: (file) => saveFile(file, `analytics-${resourceId}.csv`),
  })
  const maxViews = Math.max(1, ...(report.data?.daily.map((item) => item.views) ?? [1]))
  const panelTitle = isKnowledgeBase ? '知识库统计' : '文稿统计'
  const operationError = report.error ?? exportFile.error
  return (
    <aside className="side-drawer analytics-drawer" aria-label={panelTitle}>
      <header><div><p className="eyebrow">内容数据</p><h2>{panelTitle}</h2></div><button className="icon-button" onClick={onClose} aria-label={`关闭${panelTitle}`}><X size={18} /></button></header>
      <div className="analytics-range" role="group" aria-label="统计周期">{([7, 30, 90, 365] as const).map((value) => <button key={value} className={days === value ? 'active' : ''} onClick={() => setDays(value)}>{value === 365 ? '近一年' : `${value} 天`}</button>)}</div>
      {report.isPending && <div className="drawer-state"><span className="loading-pulse" />加载统计</div>}
      {Boolean(operationError) && <div className="inline-error">{messageOf(operationError)}</div>}
      {report.data && <>
        <div className="metric-grid">
          <Metric icon={<Eye />} label="浏览" value={report.data.totals.views} />
          <Metric icon={<Users />} label="访客" value={report.data.totals.uniqueViews} />
          <Metric icon={<Pencil />} label="编辑" value={report.data.totals.edits} />
          <Metric icon={<MessageSquare />} label="评论" value={report.data.totals.comments} />
          <Metric icon={<Share2 />} label="分享" value={report.data.totals.shares} />
          <Metric icon={<Download />} label="导出" value={report.data.totals.exports} />
        </div>
        <section className="metric-chart">
          <div className="metric-section-title"><span><BarChart3 size={15} />每日浏览</span><small>{report.data.from} — {report.data.to}</small></div>
          <div className="metric-bars">
            {report.data.daily.length === 0 && <p>这个周期还没有访问数据</p>}
            {report.data.daily.map((item) => <div className="metric-bar-column" key={item.date} title={`${item.date} · ${item.views} 次浏览`}><i style={{ height: `${Math.max(4, item.views / maxViews * 100)}%` }} /><span>{item.date.slice(5)}</span></div>)}
          </div>
        </section>
        <button className="button secondary analytics-export" disabled={exportFile.isPending} onClick={() => exportFile.mutate()}><Download size={15} />{exportFile.isPending ? '正在生成…' : '从服务端导出 CSV'}</button>
      </>}
    </aside>
  )
}

function Metric({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return <article className="metric-card"><span>{icon}</span><strong>{value.toLocaleString('zh-CN')}</strong><small>{label}</small></article>
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}

function saveFile(file: DownloadedFile, fallbackName: string) {
  const url = URL.createObjectURL(file.blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.filename || fallbackName
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
