import { CalendarDays, Columns3, GalleryHorizontal, Table2 } from 'lucide-react'
import { databaseFieldValue } from '../lib/structuredCalculations'

type Field = { id: string; name: string; type: string; options: string[]; formula?: string }
type Row = { id: string; values: Record<string, unknown> }
type View = { type: string; filter: string; sortFieldId: string | null; groupFieldId: string | null; visibleFieldIds: string[] }

export function DatabaseCardView({ data }: { data: Record<string, unknown> }) {
  const fields = normalizeFields(data.fields)
  const sourceRows = normalizeRows(data.rows)
  const view = activeView(data, fields)
  const visibleFields = view.visibleFieldIds.length ? view.visibleFieldIds.map((id) => fields.find((field) => field.id === id)).filter((field): field is Field => Boolean(field)) : fields
  const filter = view.filter.trim().toLowerCase()
  const sortField = fields.find((field) => field.id === view.sortFieldId)
  const rows = sourceRows
    .filter((row) => !filter || fields.some((field) => display(value(fields, row, field)).toLowerCase().includes(filter)))
    .sort((left, right) => sortField ? display(value(fields, left, sortField)).localeCompare(display(value(fields, right, sortField)), 'zh-CN', { numeric: true }) : 0)
  if (!fields.length) return <article className="content-card database-card-view database-card-empty">数据表字段不可用</article>
  return <article className={`content-card database-card-view view-${view.type.toLowerCase()}`}>
    <header>{view.type === 'KANBAN' ? <Columns3 /> : view.type === 'GALLERY' ? <GalleryHorizontal /> : view.type === 'CALENDAR' ? <CalendarDays /> : <Table2 />}<strong>数据表</strong><small>{visibleFields.length}/{fields.length} 个字段 · {rows.length} 条记录</small></header>
    {view.type === 'TABLE' && <DatabaseTable fields={visibleFields} rows={rows} allFields={fields} />}
    {view.type === 'KANBAN' && <DatabaseKanban fields={visibleFields} allFields={fields} rows={rows} groupFieldId={view.groupFieldId} />}
    {view.type === 'GALLERY' && <DatabaseGallery fields={visibleFields} allFields={fields} rows={rows} />}
    {view.type === 'CALENDAR' && <DatabaseCalendar fields={visibleFields} allFields={fields} rows={rows} groupFieldId={view.groupFieldId} />}
  </article>
}

function DatabaseTable({ fields, allFields, rows }: { fields: Field[]; allFields: Field[]; rows: Row[] }) {
  return <div className="database-card-table"><table><thead><tr>{fields.map((field) => <th key={field.id}>{field.name}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{fields.map((field) => <td key={field.id}>{display(value(allFields, row, field))}</td>)}</tr>)}</tbody></table>{!rows.length && <p>暂无记录</p>}</div>
}

function DatabaseKanban({ fields, allFields, rows, groupFieldId }: { fields: Field[]; allFields: Field[]; rows: Row[]; groupFieldId: string | null }) {
  const group = allFields.find((field) => field.id === groupFieldId) ?? allFields.find((field) => field.type === 'SELECT')
  const rowGroup = (row: Row) => group ? display(value(allFields, row, group)) || '未分类' : '全部记录'
  const names = group?.options.length ? [...group.options, '未分类'] : [...new Set(rows.map(rowGroup)), '未分类'].filter((name, index, all) => all.indexOf(name) === index)
  const title = fields[0] ?? allFields[0]!
  return <div className="database-card-kanban">{names.map((name) => { const items = rows.filter((row) => rowGroup(row) === name); return <section key={name}><header><strong>{name}</strong><span>{items.length}</span></header>{items.map((row) => <div key={row.id}><strong>{display(value(allFields, row, title)) || '无标题'}</strong>{fields.filter((field) => field.id !== title.id && field.id !== group?.id).slice(0, 3).map((field) => <small key={field.id}>{field.name} · {display(value(allFields, row, field))}</small>)}</div>)}</section> })}</div>
}

function DatabaseGallery({ fields, allFields, rows }: { fields: Field[]; allFields: Field[]; rows: Row[] }) {
  const file = fields.find((field) => field.type === 'FILE')
  const title = fields[0] ?? allFields[0]!
  return <div className="database-card-gallery">{rows.map((row) => <section key={row.id}><span>{file ? display(value(allFields, row, file)) || '◫' : '◫'}</span><strong>{display(value(allFields, row, title)) || '无标题'}</strong>{fields.filter((field) => field.id !== title.id).slice(0, 3).map((field) => <small key={field.id}>{field.name} · {display(value(allFields, row, field))}</small>)}</section>)}{!rows.length && <p>暂无记录</p>}</div>
}

function DatabaseCalendar({ fields, allFields, rows, groupFieldId }: { fields: Field[]; allFields: Field[]; rows: Row[]; groupFieldId: string | null }) {
  const date = allFields.find((field) => field.id === groupFieldId && field.type === 'DATE') ?? allFields.find((field) => field.type === 'DATE')
  const title = fields[0] ?? allFields[0]!
  const groups = new Map<string, Row[]>()
  for (const row of rows) { const day = date ? display(value(allFields, row, date)) || '未安排日期' : '未配置日期字段'; groups.set(day, [...(groups.get(day) ?? []), row]) }
  return <div className="database-card-calendar">{[...groups.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, items]) => <section key={day}><header><CalendarDays /><strong>{day}</strong><span>{items.length}</span></header>{items.map((row) => <div key={row.id}>{display(value(allFields, row, title)) || '无标题'}</div>)}</section>)}{!rows.length && <p>暂无记录</p>}</div>
}

function activeView(data: Record<string, unknown>, fields: Field[]): View {
  const views = Array.isArray(data.views) ? data.views.map(record).filter((view): view is Record<string, unknown> => Boolean(view)) : []
  const source = views.find((view) => view.id === data.activeViewId) ?? views[0]
  const type = ['TABLE', 'KANBAN', 'GALLERY', 'CALENDAR'].includes(String(source?.type ?? data.view)) ? String(source?.type ?? data.view) : 'TABLE'
  const ids = new Set(fields.map((field) => field.id))
  return { type, filter: typeof source?.filter === 'string' ? source.filter : typeof data.filter === 'string' ? data.filter : '', sortFieldId: typeof source?.sortFieldId === 'string' && ids.has(source.sortFieldId) ? source.sortFieldId : typeof data.sortFieldId === 'string' && ids.has(data.sortFieldId) ? data.sortFieldId : null, groupFieldId: typeof source?.groupFieldId === 'string' && ids.has(source.groupFieldId) ? source.groupFieldId : null, visibleFieldIds: Array.isArray(source?.visibleFieldIds) ? source.visibleFieldIds.filter((id): id is string => typeof id === 'string' && ids.has(id)) : [] }
}

function normalizeFields(value: unknown): Field[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 50).flatMap((raw, index) => { const field = record(raw); if (!field) return []; return [{ id: string(field.id, `field-${index}`), name: string(field.name, '字段'), type: string(field.type, 'TEXT'), options: Array.isArray(field.options) ? field.options.filter((option): option is string => typeof option === 'string').slice(0, 100) : [], formula: typeof field.formula === 'string' ? field.formula : undefined }] })
}

function normalizeRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 1_000).flatMap((raw, index) => { const row = record(raw); const values = record(row?.values); return row && values ? [{ id: string(row.id, `row-${index}`), values }] : [] })
}

function display(value: unknown): string {
  if (Array.isArray(value)) return value.map(display).filter(Boolean).join(', ')
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

function value(fields: Field[], row: Row, field: Field) { return databaseFieldValue(fields, row, field) }

function record(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function string(value: unknown, fallback: string): string { return typeof value === 'string' && value ? value : fallback }
