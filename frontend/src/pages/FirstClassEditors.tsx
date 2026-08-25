import { useMemo, useRef, useState } from 'react'
import {
  ArrowDownAZ, ArrowRight, BarChart3, Bold, CalendarDays, CheckSquare, Circle, ClipboardList, Columns3, Eye, EyeOff, Filter, GalleryHorizontal,
  Hand, Italic, LayoutGrid, ListChecks, ListPlus, LockKeyhole, MousePointer2, Palette, Plus, Redo2, Rows3, Settings2, Sigma, Square,
  StickyNote, Table2, Trash2, Type, Underline, Undo2, ZoomIn, ZoomOut,
} from 'lucide-react'
import type { Page } from '../types'
import { databaseFieldValue, displaySpreadsheetCell, formatSpreadsheetValue } from '../lib/structuredCalculations'
import { TextEntryDialog } from '../components/TextEntryDialog'

export function FirstClassEditor({ page, value, onChange }: { page: Page; value: string; onChange: (value: string) => void }) {
  if (page.contentType === 'WHITEBOARD') return <WhiteboardEditor value={value} fallback={page.content} onChange={onChange} />
  if (page.contentType === 'SPREADSHEET') return <SpreadsheetEditor value={value} fallback={page.content} onChange={onChange} />
  if (page.contentType === 'DATABASE') return <DatabaseEditor value={value} fallback={page.content} onChange={onChange} />
  return null
}

export function EmbeddedDatabaseEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  return <div className="embedded-database-editor"><DatabaseEditor value={JSON.stringify(data)} fallback={data} onChange={(value) => { try { const parsed = JSON.parse(value) as unknown; if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed as Record<string, unknown>) } catch { /* Keep the last valid structured value. */ } }} /></div>
}

type BoardElement = { id: string; kind: 'RECT' | 'ELLIPSE' | 'STICKY' | 'TEXT' | 'ARROW'; x: number; y: number; width: number; height: number; text: string; color: string }
type BoardModel = { type: 'whiteboard'; viewport: { x: number; y: number; zoom: number }; elements: BoardElement[] }

function WhiteboardEditor({ value, fallback, onChange }: StructuredProps) {
  const model = normalizeBoard(structured<Partial<BoardModel>>(value, fallback, { type: 'whiteboard', viewport: { x: 0, y: 0, zoom: 1 }, elements: [] }))
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<'SELECT' | 'HAND' | BoardElement['kind']>('SELECT')
  const [history, setHistory] = useState<string[]>([])
  const [future, setFuture] = useState<string[]>([])
  const drag = useRef<{ id: string; startX: number; startY: number; x: number; y: number } | null>(null)
  const commit = (next: BoardModel, remember = true) => {
    if (remember) { setHistory((items) => [...items.slice(-49), JSON.stringify(model)]); setFuture([]) }
    onChange(JSON.stringify(next))
  }
  const patchElement = (id: string, patch: Partial<BoardElement>, remember = true) => commit({ ...model, elements: model.elements.map((item) => item.id === id ? { ...item, ...patch } : item) }, remember)
  const add = (kind: BoardElement['kind'], x = 260, y = 170) => {
    const sizes = kind === 'ARROW' ? [180, 3] : kind === 'TEXT' ? [190, 56] : kind === 'STICKY' ? [180, 150] : [180, 110]
    const element: BoardElement = { id: crypto.randomUUID(), kind, x, y, width: sizes[0]!, height: sizes[1]!, text: kind === 'STICKY' ? '双击或直接输入便签内容' : kind === 'TEXT' ? '文本' : '', color: kind === 'STICKY' ? '#fff1a8' : '#ffffff' }
    commit({ ...model, elements: [...model.elements, element] }); setSelected(element.id); setTool('SELECT')
  }
  const undo = () => { const previous = history.at(-1); if (!previous) return; setFuture((items) => [JSON.stringify(model), ...items]); setHistory((items) => items.slice(0, -1)); onChange(previous) }
  const redo = () => { const next = future[0]; if (!next) return; setHistory((items) => [...items, JSON.stringify(model)]); setFuture((items) => items.slice(1)); onChange(next) }
  const zoom = Math.max(.25, Math.min(3, model.viewport?.zoom || 1))
  return <div className="first-class-editor board-editor">
    <div className="fc-toolbar board-toolbar">
      <Tool icon={<MousePointer2 />} label="选择" active={tool === 'SELECT'} onClick={() => setTool('SELECT')} /><Tool icon={<Hand />} label="平移" active={tool === 'HAND'} onClick={() => setTool('HAND')} />
      <i /><Tool icon={<Square />} label="矩形" active={tool === 'RECT'} onClick={() => setTool('RECT')} /><Tool icon={<Circle />} label="椭圆" active={tool === 'ELLIPSE'} onClick={() => setTool('ELLIPSE')} /><Tool icon={<StickyNote />} label="便签" active={tool === 'STICKY'} onClick={() => setTool('STICKY')} /><Tool icon={<Type />} label="文本" active={tool === 'TEXT'} onClick={() => setTool('TEXT')} /><Tool icon={<ArrowRight />} label="连线" active={tool === 'ARROW'} onClick={() => setTool('ARROW')} />
      <i /><Tool icon={<Undo2 />} label="撤销" disabled={!history.length} onClick={undo} /><Tool icon={<Redo2 />} label="重做" disabled={!future.length} onClick={redo} />
      {selected && <><i /><Tool icon={<Palette />} label="换色" onClick={() => patchElement(selected, { color: nextColor(model.elements.find((item) => item.id === selected)?.color) })} /><Tool icon={<Trash2 />} label="删除" danger onClick={() => { commit({ ...model, elements: model.elements.filter((item) => item.id !== selected) }); setSelected(null) }} /></>}
    </div>
    <div className="board-viewport" onPointerMove={(event) => { const current = drag.current; if (!current) return; patchElement(current.id, { x: current.x + (event.clientX - current.startX) / zoom, y: current.y + (event.clientY - current.startY) / zoom }, false) }} onPointerUp={() => { if (drag.current) { setHistory((items) => [...items.slice(-49), JSON.stringify(model)]); drag.current = null } }} onDoubleClick={(event) => { if (event.target !== event.currentTarget || tool === 'SELECT' || tool === 'HAND') return; const box = event.currentTarget.getBoundingClientRect(); add(tool, (event.clientX - box.left) / zoom, (event.clientY - box.top) / zoom) }}>
      <div className="board-surface" style={{ transform: `translate(${model.viewport?.x || 0}px,${model.viewport?.y || 0}px) scale(${zoom})` }}>
        {model.elements.map((element) => element.kind === 'ARROW' ? <svg key={element.id} className={`board-arrow ${selected === element.id ? 'selected' : ''}`} style={{ left: element.x, top: element.y, width: element.width, height: 24 }} onPointerDown={(event) => { event.stopPropagation(); setSelected(element.id); drag.current = { id: element.id, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y } }}><defs><marker id={`arrow-${element.id}`} markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" fill="#5d7567" /></marker></defs><line x1="2" y1="12" x2={Math.max(2, element.width - 9)} y2="12" markerEnd={`url(#arrow-${element.id})`} /></svg> : <div key={element.id} className={`board-element kind-${element.kind.toLowerCase()} ${selected === element.id ? 'selected' : ''}`} style={{ left: element.x, top: element.y, width: element.width, height: element.height, background: element.color }} onPointerDown={(event) => { if ((event.target as HTMLElement).matches('textarea')) return; event.stopPropagation(); setSelected(element.id); drag.current = { id: element.id, startX: event.clientX, startY: event.clientY, x: element.x, y: element.y } }}><textarea aria-label={`画板元素内容：${element.text || element.kind}`} value={element.text} onChange={(event) => patchElement(element.id, { text: event.target.value })} placeholder={element.kind === 'RECT' || element.kind === 'ELLIPSE' ? '输入文字' : ''} /></div>)}
      </div>
      {!model.elements.length && <div className="board-empty"><LayoutGrid /><strong>无限画布</strong><p>选择工具后双击画布，或使用下方快捷创建。</p><button className="button primary small" onClick={() => add('STICKY')}><Plus size={15} />添加便签</button></div>}
      <div className="board-zoom"><button aria-label="缩小画板" onClick={() => commit({ ...model, viewport: { ...model.viewport, zoom: zoom - .1 } }, false)}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button aria-label="放大画板" onClick={() => commit({ ...model, viewport: { ...model.viewport, zoom: zoom + .1 } }, false)}><ZoomIn /></button></div>
    </div>
  </div>
}

type CellStyle = { bold?: boolean; italic?: boolean; underline?: boolean; color?: string; background?: string; align?: 'LEFT' | 'CENTER' | 'RIGHT'; numberFormat?: 'GENERAL' | 'NUMBER' | 'CURRENCY' | 'PERCENT' | 'DATE' }
type Sheet = { id: string; name: string; rows: string[][]; styles: Record<string, CellStyle>; frozenRows: number; frozenColumns: number; hiddenRows: number[]; hiddenColumns: number[]; protectedCells: string[]; dropdowns: Record<string, string[]>; filter: string }
type Workbook = { type: 'workbook'; activeSheetId: string; sheets: Sheet[] }

function SpreadsheetEditor({ value, fallback, onChange }: StructuredProps) {
  const initial = emptyWorkbook()
  const raw = structured<Partial<Workbook>>(value, fallback, initial)
  const model = normalizeWorkbook(raw)
  const active = model.sheets.find((sheet) => sheet.id === model.activeSheetId) ?? model.sheets[0]!
  const [selected, setSelected] = useState({ row: 0, column: 0 })
  const [chartOpen, setChartOpen] = useState(false)
  const [dropdownDialog, setDropdownDialog] = useState<{ sheetId: string; cellKey: string; initialValue: string } | null>(null)
  const [filterDialog, setFilterDialog] = useState<{ sheetId: string; initialValue: string } | null>(null)
  const [sheetNameDialog, setSheetNameDialog] = useState<{ sheetId: string; initialValue: string } | null>(null)
  const commit = (next: Workbook) => onChange(JSON.stringify(next))
  const updateSheet = (next: Sheet) => commit({ ...model, sheets: model.sheets.map((sheet) => sheet.id === next.id ? next : sheet) })
  const updateCell = (row: number, column: number, text: string) => {
    const rows = active.rows.map((cells) => [...cells]); while (rows.length <= row) rows.push([]); while (rows[row]!.length <= column) rows[row]!.push(''); rows[row]![column] = text; updateSheet({ ...active, rows })
  }
  const rowIndexes = Array.from({ length: Math.max(30, active.rows.length + 5) }, (_, index) => index).filter((row) => !active.hiddenRows.includes(row) && (!active.filter || (active.rows[row] ?? []).some((cell) => String(cell).toLowerCase().includes(active.filter.toLowerCase()))))
  const columns = Math.max(16, ...active.rows.map((row) => row.length + 3))
  const columnIndexes = Array.from({ length: columns }, (_, index) => index).filter((column) => !active.hiddenColumns.includes(column))
  const selectedKey = cellKey(selected.row, selected.column)
  const selectedStyle = active.styles[selectedKey] ?? {}
  const patchStyle = (patch: Partial<CellStyle>) => updateSheet({ ...active, styles: { ...active.styles, [selectedKey]: { ...selectedStyle, ...patch } } })
  const sort = () => { const fixed = active.rows.slice(0, active.frozenRows); const rows = active.rows.slice(active.frozenRows).sort((left, right) => String(left[selected.column] ?? '').localeCompare(String(right[selected.column] ?? ''), 'zh-CN', { numeric: true })); updateSheet({ ...active, rows: [...fixed, ...rows] }) }
  const dropdown = () => setDropdownDialog({ sheetId: active.id, cellKey: selectedKey, initialValue: (active.dropdowns[selectedKey] ?? []).join(', ') })
  const addSheet = () => { const sheet = emptySheet(`工作表 ${model.sheets.length + 1}`); commit({ ...model, activeSheetId: sheet.id, sheets: [...model.sheets, sheet] }) }
  return <div className="first-class-editor sheet-editor">
    <div className="fc-toolbar sheet-toolbar">
      <Tool icon={<Bold />} label="加粗" active={Boolean(selectedStyle.bold)} onClick={() => patchStyle({ bold: !selectedStyle.bold })} />
      <Tool icon={<Italic />} label="斜体" active={Boolean(selectedStyle.italic)} onClick={() => patchStyle({ italic: !selectedStyle.italic })} />
      <Tool icon={<Underline />} label="下划线" active={Boolean(selectedStyle.underline)} onClick={() => patchStyle({ underline: !selectedStyle.underline })} />
      <label className="sheet-color" title="文字颜色"><input aria-label="文字颜色" type="color" value={selectedStyle.color || '#202226'} onChange={(event) => patchStyle({ color: event.target.value })} /></label>
      <label className="sheet-color background" title="填充颜色"><input aria-label="填充颜色" type="color" value={selectedStyle.background || '#ffffff'} onChange={(event) => patchStyle({ background: event.target.value })} /></label>
      <select aria-label="对齐方式" value={selectedStyle.align || 'LEFT'} onChange={(event) => patchStyle({ align: event.target.value as CellStyle['align'] })}><option value="LEFT">左对齐</option><option value="CENTER">居中</option><option value="RIGHT">右对齐</option></select>
      <select aria-label="数字格式" value={selectedStyle.numberFormat || 'GENERAL'} onChange={(event) => patchStyle({ numberFormat: event.target.value as CellStyle['numberFormat'] })}><option value="GENERAL">常规</option><option value="NUMBER">数字</option><option value="CURRENCY">人民币</option><option value="PERCENT">百分比</option><option value="DATE">日期</option></select>
      <Tool icon={<Filter />} label="筛选" active={Boolean(active.filter)} onClick={() => setFilterDialog({ sheetId: active.id, initialValue: active.filter })} />
      <Tool icon={<Rows3 />} label="冻结首行" active={active.frozenRows > 0} onClick={() => updateSheet({ ...active, frozenRows: active.frozenRows ? 0 : 1 })} />
      <Tool icon={<Columns3 />} label="冻结首列" active={active.frozenColumns > 0} onClick={() => updateSheet({ ...active, frozenColumns: active.frozenColumns ? 0 : 1 })} />
      <Tool icon={<ArrowDownAZ />} label="按列排序" onClick={sort} />
      <Tool icon={<EyeOff />} label="隐藏当前行" onClick={() => updateSheet({ ...active, hiddenRows: [...new Set([...active.hiddenRows, selected.row])].sort((a, b) => a - b) })} />
      <Tool icon={<EyeOff />} label="隐藏当前列" onClick={() => updateSheet({ ...active, hiddenColumns: [...new Set([...active.hiddenColumns, selected.column])].sort((a, b) => a - b) })} />
      <Tool icon={<Eye />} label="显示全部行列" disabled={!active.hiddenRows.length && !active.hiddenColumns.length} onClick={() => updateSheet({ ...active, hiddenRows: [], hiddenColumns: [] })} />
      <Tool icon={<LockKeyhole />} label="保护单元格" active={active.protectedCells.includes(selectedKey)} onClick={() => updateSheet({ ...active, protectedCells: active.protectedCells.includes(selectedKey) ? active.protectedCells.filter((key) => key !== selectedKey) : [...active.protectedCells, selectedKey] })} />
      <Tool icon={<ListChecks />} label="下拉选项" active={Boolean(active.dropdowns[selectedKey]?.length)} onClick={dropdown} />
      <Tool icon={<BarChart3 />} label="图表" active={chartOpen} onClick={() => setChartOpen((open) => !open)} />
      <span className="sheet-selection">{columnName(selected.column)}{selected.row + 1}</span>
    </div>
    <div className="formula-bar"><Sigma size={15} /><span>{columnName(selected.column)}{selected.row + 1}</span><input aria-label="公式栏" value={active.rows[selected.row]?.[selected.column] ?? ''} disabled={active.protectedCells.includes(selectedKey)} onChange={(event) => updateCell(selected.row, selected.column, event.target.value)} placeholder={active.protectedCells.includes(selectedKey) ? '此单元格已保护' : '输入值或 =SUM(A1:A5)'} /></div>
    <div className="sheet-grid-wrap"><table className="sheet-grid"><thead><tr><th className="sheet-corner" />{columnIndexes.map((column, visibleColumn) => <th key={column} className={column < active.frozenColumns ? 'frozen-column' : ''} style={column < active.frozenColumns ? { left: 42 + visibleColumn * 90 } : undefined}>{columnName(column)}</th>)}</tr></thead><tbody>{rowIndexes.map((row) => <tr key={row} className={row < active.frozenRows ? 'frozen' : ''}><th>{row + 1}</th>{columnIndexes.map((column, visibleColumn) => { const key = cellKey(row, column); const coordinate = `${columnName(column)}${row + 1}`; const rawValue = active.rows[row]?.[column] ?? ''; const style = active.styles[key] ?? {}; const options = active.dropdowns[key]; const frozen = column < active.frozenColumns; const formatted = formatSpreadsheetValue(displaySpreadsheetCell(active, row, column), style.numberFormat); return <td key={column} className={`${selected.row === row && selected.column === column ? 'selected ' : ''}${frozen ? 'frozen-column ' : ''}${active.protectedCells.includes(key) ? 'protected' : ''}`} style={{ fontWeight: style.bold ? 700 : undefined, fontStyle: style.italic ? 'italic' : undefined, textDecoration: style.underline ? 'underline' : undefined, textAlign: style.align?.toLowerCase() as React.CSSProperties['textAlign'], color: style.color, background: style.background, left: frozen ? 42 + visibleColumn * 90 : undefined }}>{options?.length ? <select aria-label={`单元格 ${coordinate} 下拉值`} value={rawValue} disabled={active.protectedCells.includes(key)} onFocus={() => setSelected({ row, column })} onChange={(event) => updateCell(row, column, event.target.value)}><option value="" />{!options.includes(rawValue) && rawValue && <option value={rawValue}>{rawValue}</option>}{options.map((option) => <option key={option}>{option}</option>)}</select> : <input aria-label={`单元格 ${coordinate}`} value={rawValue} disabled={active.protectedCells.includes(key)} onFocus={() => setSelected({ row, column })} onChange={(event) => updateCell(row, column, event.target.value)} title={rawValue.startsWith('=') ? rawValue : undefined} />}<span>{formatted}</span></td> })}</tr>)}</tbody></table></div>
    {chartOpen && <SheetChart sheet={active} />}
    <footer className="sheet-tabs">{model.sheets.map((sheet) => <button key={sheet.id} className={sheet.id === active.id ? 'active' : ''} onClick={() => commit({ ...model, activeSheetId: sheet.id })} onDoubleClick={() => setSheetNameDialog({ sheetId: sheet.id, initialValue: sheet.name })}>{sheet.name}</button>)}<button onClick={addSheet} title="新增工作表" aria-label="新增工作表"><Plus size={14} /></button></footer>
    {filterDialog && <TextEntryDialog title="筛选工作表" label="包含条件" initialValue={filterDialog.initialValue} allowEmpty maxLength={500} description="留空保存即可清除筛选。" confirmLabel="应用筛选" onSubmit={(filter) => { commit({ ...model, sheets: model.sheets.map((sheet) => sheet.id === filterDialog.sheetId ? { ...sheet, filter } : sheet) }); setFilterDialog(null) }} onClose={() => setFilterDialog(null)} />}
    {dropdownDialog && <TextEntryDialog title="设置单元格下拉选项" label="选项" initialValue={dropdownDialog.initialValue} allowEmpty maxLength={4_000} description="使用逗号分隔，最多保留 100 项；留空保存可移除下拉选项。" confirmLabel="保存选项" onSubmit={(input) => { const options = input.split(/[,，]/).map((item) => item.trim()).filter(Boolean).slice(0, 100); commit({ ...model, sheets: model.sheets.map((sheet) => { if (sheet.id !== dropdownDialog.sheetId) return sheet; const dropdowns = { ...sheet.dropdowns }; if (options.length) dropdowns[dropdownDialog.cellKey] = options; else delete dropdowns[dropdownDialog.cellKey]; return { ...sheet, dropdowns } }) }); setDropdownDialog(null) }} onClose={() => setDropdownDialog(null)} />}
    {sheetNameDialog && <TextEntryDialog title="重命名工作表" label="工作表名称" initialValue={sheetNameDialog.initialValue} maxLength={120} confirmLabel="保存名称" onSubmit={(name) => { commit({ ...model, sheets: model.sheets.map((sheet) => sheet.id === sheetNameDialog.sheetId ? { ...sheet, name } : sheet) }); setSheetNameDialog(null) }} onClose={() => setSheetNameDialog(null)} />}
  </div>
}

function SheetChart({ sheet }: { sheet: Sheet }) {
  const points = sheet.rows.slice(0, 12).map((row, index) => ({ label: row[0] || `${index + 1}`, value: Number(displaySpreadsheetCell(sheet, index, 1)) || 0 }))
  const maximum = Math.max(1, ...points.map((point) => Math.abs(point.value)))
  return <aside className="sheet-chart"><header><BarChart3 /><strong>前两列数据预览</strong></header><div>{points.map((point) => <span key={point.label}><i style={{ height: `${Math.max(2, Math.abs(point.value) / maximum * 100)}%` }} /><small>{point.label}</small></span>)}</div></aside>
}

type FieldType = 'TEXT' | 'NUMBER' | 'SELECT' | 'MULTI_SELECT' | 'DATE' | 'PERSON' | 'CHECKBOX' | 'URL' | 'EMAIL' | 'FILE' | 'FORMULA' | 'RELATION' | 'ROLLUP'
type DatabaseField = { id: string; name: string; type: FieldType; options?: string[]; formula?: string }
type DatabaseRow = { id: string; values: Record<string, unknown>; createdAt: string }
type DatabaseFormConfig = { enabled: boolean; title: string; description: string; submitLabel: string; successMessage: string; fieldIds: string[]; requiredFieldIds: string[] }
type DatabaseViewType = 'TABLE' | 'KANBAN' | 'GALLERY' | 'CALENDAR'
type DatabaseView = { id: string; name: string; type: DatabaseViewType; filter: string; sortFieldId: string | null; groupFieldId: string | null; visibleFieldIds: string[] }
type DatabaseModel = { type: 'database'; fields: DatabaseField[]; rows: DatabaseRow[]; view: DatabaseViewType; filter: string; sortFieldId: string | null; views: DatabaseView[]; activeViewId: string; form: DatabaseFormConfig }

function DatabaseEditor({ value, fallback, onChange }: StructuredProps) {
  const model = normalizeDatabase(structured<Partial<DatabaseModel>>(value, fallback, emptyDatabase()))
  const [fieldDialog, setFieldDialog] = useState(false)
  const [formOpen, setFormOpen] = useState(false)
  const [formSettingsOpen, setFormSettingsOpen] = useState(false)
  const [viewDialog, setViewDialog] = useState<'ADD' | 'EDIT' | null>(null)
  const activeView = model.views.find((view) => view.id === model.activeViewId) ?? model.views[0]!
  const commit = (next: DatabaseModel) => onChange(JSON.stringify(syncLegacyDatabaseView(next)))
  const updateView = (patch: Partial<DatabaseView>) => commit({ ...model, views: model.views.map((view) => view.id === activeView.id ? { ...view, ...patch } : view) })
  const updateRow = (rowId: string, fieldId: string, value: unknown) => commit({ ...model, rows: model.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [fieldId]: value } } : row) })
  const visibleFields = activeView.visibleFieldIds.length ? activeView.visibleFieldIds.map((id) => model.fields.find((field) => field.id === id)).filter((field): field is DatabaseField => Boolean(field)) : model.fields
  const sortField = model.fields.find((field) => field.id === activeView.sortFieldId)
  const rows = model.rows.filter((row) => !activeView.filter || model.fields.some((field) => String(databaseValue(model, row, field)).toLowerCase().includes(activeView.filter.toLowerCase()))).sort((left, right) => sortField ? String(databaseValue(model, left, sortField) ?? '').localeCompare(String(databaseValue(model, right, sortField) ?? ''), 'zh-CN', { numeric: true }) : 0)
  return <div className="first-class-editor database-editor">
    <div className="database-top"><div className="database-views">{model.views.map((view) => <ViewButton key={view.id} icon={databaseViewIcon(view.type)} label={view.name} active={view.id === activeView.id} onClick={() => commit({ ...model, activeViewId: view.id })} />)}<button className="database-view-add" onClick={() => setViewDialog('ADD')} title="新增视图"><Plus /></button></div><div className="database-actions"><label><Filter size={14} /><input aria-label="筛选当前数据表视图" value={activeView.filter} onChange={(event) => updateView({ filter: event.target.value })} placeholder="筛选当前视图" /></label><select aria-label="数据表排序字段" value={activeView.sortFieldId ?? ''} onChange={(event) => updateView({ sortFieldId: event.target.value || null })}><option value="">默认排序</option>{model.fields.map((field) => <option key={field.id} value={field.id}>按 {field.name}</option>)}</select><select aria-label="数据表分组字段" value={activeView.groupFieldId ?? ''} onChange={(event) => updateView({ groupFieldId: event.target.value || null })}><option value="">不分组</option>{model.fields.filter((field) => ['SELECT', 'MULTI_SELECT', 'PERSON', 'CHECKBOX', 'DATE'].includes(field.type)).map((field) => <option key={field.id} value={field.id}>按 {field.name} 分组</option>)}</select><button className="icon-button" title="配置当前视图" aria-label="配置当前数据表视图" onClick={() => setViewDialog('EDIT')}><Settings2 /></button><button className={`button secondary small ${model.form.enabled ? 'active' : ''}`} onClick={() => setFormSettingsOpen(true)}><ClipboardList size={15} />表单{model.form.enabled ? '已开放' : ''}</button><button className="button secondary small" onClick={() => setFieldDialog(true)}><ListPlus size={15} />字段</button><button className="button primary small" onClick={() => setFormOpen(true)}><Plus size={15} />新记录</button></div></div>
    {activeView.type === 'TABLE' && <DatabaseTable model={model} fields={visibleFields} rows={rows} updateRow={updateRow} commit={commit} />}
    {activeView.type === 'KANBAN' && <DatabaseKanban model={model} view={activeView} fields={visibleFields} rows={rows} updateRow={updateRow} />}
    {activeView.type === 'GALLERY' && <DatabaseGallery model={model} fields={visibleFields} rows={rows} />}
    {activeView.type === 'CALENDAR' && <DatabaseCalendar model={model} view={activeView} fields={visibleFields} rows={rows} />}
    {!rows.length && <div className="database-empty"><CheckSquare /><strong>还没有符合条件的记录</strong><button className="button primary small" onClick={() => setFormOpen(true)}>添加第一条</button></div>}
    {fieldDialog && <AddFieldDialog onClose={() => setFieldDialog(false)} onAdd={(field) => { commit({ ...model, fields: [...model.fields, field] }); setFieldDialog(false) }} />}
    {viewDialog && <DatabaseViewDialog fields={model.fields} value={viewDialog === 'EDIT' ? activeView : undefined} canDelete={viewDialog === 'EDIT' && model.views.length > 1} onClose={() => setViewDialog(null)} onDelete={() => { const remaining = model.views.filter((view) => view.id !== activeView.id); commit({ ...model, views: remaining, activeViewId: remaining[0]!.id }); setViewDialog(null) }} onSave={(view) => { if (viewDialog === 'ADD') commit({ ...model, views: [...model.views, view], activeViewId: view.id }); else commit({ ...model, views: model.views.map((item) => item.id === view.id ? view : item) }); setViewDialog(null) }} />}
    {formSettingsOpen && <FormSettingsDialog fields={model.fields} value={model.form} onClose={() => setFormSettingsOpen(false)} onSave={(form) => { commit({ ...model, form }); setFormSettingsOpen(false) }} />}
    {formOpen && <RecordForm fields={model.fields} onClose={() => setFormOpen(false)} onSave={(values) => { commit({ ...model, rows: [...model.rows, { id: crypto.randomUUID(), values, createdAt: new Date().toISOString() }] }); setFormOpen(false) }} />}
  </div>
}

function DatabaseTable({ model, fields, rows, updateRow, commit }: { model: DatabaseModel; fields: DatabaseField[]; rows: DatabaseRow[]; updateRow: (rowId: string, fieldId: string, value: unknown) => void; commit: (next: DatabaseModel) => void }) {
  return <div className="database-table-wrap"><table className="database-table"><thead><tr>{fields.map((field) => <th key={field.id}><span>{fieldIcon(field.type)} {field.name}</span><button type="button" aria-label={`删除字段 ${field.name}`} onClick={() => commit(removeDatabaseField(model, field.id))}><Trash2 size={12} /></button></th>)}<th /></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{fields.map((field) => <td key={field.id}><DatabaseInput field={field} value={databaseValue(model, row, field)} onChange={(next) => updateRow(row.id, field.id, next)} /></td>)}<td><button type="button" className="icon-button" aria-label="删除记录" onClick={() => commit({ ...model, rows: model.rows.filter((item) => item.id !== row.id) })}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
}

function DatabaseKanban({ model, view, fields, rows, updateRow }: { model: DatabaseModel; view: DatabaseView; fields: DatabaseField[]; rows: DatabaseRow[]; updateRow: (rowId: string, fieldId: string, value: unknown) => void }) {
  const groupField = model.fields.find((field) => field.id === view.groupFieldId) ?? model.fields.find((field) => field.type === 'SELECT')
  const rowGroup = (row: DatabaseRow) => groupField ? String(databaseValue(model, row, groupField) || '未分类') : '全部记录'
  const groups = groupField?.options?.length ? [...groupField.options, '未分类'] : [...new Set(rows.map(rowGroup)), '未分类'].filter((group, index, all) => all.indexOf(group) === index)
  const titleField = fields[0] ?? model.fields[0]!
  return <div className="database-kanban">{groups.map((group) => <section key={group}><header><strong>{group}</strong><span>{rows.filter((row) => rowGroup(row) === group).length}</span></header>{rows.filter((row) => rowGroup(row) === group).map((row) => <article key={row.id}><strong>{String(databaseValue(model, row, titleField) || '无标题')}</strong>{fields.filter((field) => field.id !== titleField.id && field.id !== groupField?.id).slice(0, 3).map((field) => <small key={field.id}>{field.name} · {String(databaseValue(model, row, field) ?? '')}</small>)}{groupField?.type === 'SELECT' && <select aria-label={`${String(databaseValue(model, row, titleField) || '无标题')} 的${groupField.name}`} value={String(row.values[groupField.id] ?? '')} onChange={(event) => updateRow(row.id, groupField.id, event.target.value)}><option value="">未分类</option>{groupField.options?.map((option) => <option key={option}>{option}</option>)}</select>}</article>)}</section>)}</div>
}

function DatabaseGallery({ model, fields, rows }: { model: DatabaseModel; fields: DatabaseField[]; rows: DatabaseRow[] }) {
  const titleField = fields[0] ?? model.fields[0]!
  return <div className="database-gallery">{rows.map((row) => <article key={row.id}><div>{String(databaseValue(model, row, fields.find((field) => field.type === 'FILE') ?? titleField) || '◫')}</div><strong>{String(databaseValue(model, row, titleField) || '无标题')}</strong>{fields.filter((field) => field.id !== titleField.id).slice(0, 3).map((field) => <small key={field.id}>{field.name} · {String(databaseValue(model, row, field) ?? '')}</small>)}</article>)}</div>
}

function DatabaseCalendar({ model, view, fields, rows }: { model: DatabaseModel; view: DatabaseView; fields: DatabaseField[]; rows: DatabaseRow[] }) {
  const dateField = model.fields.find((field) => field.id === view.groupFieldId && field.type === 'DATE') ?? model.fields.find((field) => field.type === 'DATE')
  const titleField = fields[0] ?? model.fields[0]!
  const grouped = new Map<string, DatabaseRow[]>(); for (const row of rows) { const day = dateField ? String(row.values[dateField.id] || '未安排') : '未安排'; grouped.set(day, [...(grouped.get(day) ?? []), row]) }
  return <div className="database-calendar">{[...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([day, items]) => <section key={day}><header><CalendarDays /><strong>{day}</strong><span>{items.length}</span></header>{items.map((row) => <div key={row.id}>{String(databaseValue(model, row, titleField) || '无标题')}</div>)}</section>)}</div>
}

function DatabaseInput({ field, value, onChange }: { field: DatabaseField; value: unknown; onChange: (value: unknown) => void }) {
  if (field.type === 'FORMULA' || field.type === 'ROLLUP') return <span className="computed-cell">{String(value ?? '')}</span>
  if (field.type === 'CHECKBOX') return <input aria-label={field.name} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(event.target.checked)} />
  if (field.type === 'SELECT') return <select aria-label={field.name} value={String(value ?? '')} onChange={(event) => onChange(event.target.value)}><option value="" />{field.options?.map((option) => <option key={option}>{option}</option>)}</select>
  if (field.type === 'MULTI_SELECT') return <input aria-label={field.name} value={Array.isArray(value) ? value.join(', ') : String(value ?? '')} onChange={(event) => onChange(event.target.value.split(',').map((item) => item.trim()).filter(Boolean))} placeholder="逗号分隔" />
  return <input aria-label={field.name} type={field.type === 'NUMBER' ? 'number' : field.type === 'DATE' ? 'date' : field.type === 'EMAIL' ? 'email' : field.type === 'URL' ? 'url' : 'text'} value={String(value ?? '')} onChange={(event) => onChange(field.type === 'NUMBER' ? Number(event.target.value) : event.target.value)} />
}

function AddFieldDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (field: DatabaseField) => void }) {
  const [name, setName] = useState('')
  const [type, setType] = useState<FieldType>('TEXT')
  const [options, setOptions] = useState('待处理, 进行中, 已完成')
  const [formula, setFormula] = useState('')
  return <div className="dialog-backdrop"><div className="dialog nested-dialog"><div className="dialog-head"><div><p className="eyebrow">数据表</p><h2>添加字段</h2></div></div><label className="field"><span className="field-label">字段名</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field"><span className="field-label">字段类型</span><select value={type} onChange={(event) => setType(event.target.value as FieldType)}>{fieldTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>{(type === 'SELECT' || type === 'MULTI_SELECT') && <label className="field"><span className="field-label">选项（逗号分隔）</span><input value={options} onChange={(event) => setOptions(event.target.value)} /></label>}{(type === 'FORMULA' || type === 'ROLLUP') && <label className="field"><span className="field-label">公式</span><input value={formula} onChange={(event) => setFormula(event.target.value)} placeholder="{单价} * {数量}" /></label>}<div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!name.trim()} onClick={() => onAdd({ id: crypto.randomUUID(), name: name.trim(), type, options: type.includes('SELECT') ? options.split(',').map((item) => item.trim()).filter(Boolean) : undefined, formula: type === 'FORMULA' || type === 'ROLLUP' ? formula : undefined })}>添加</button></div></div></div>
}

function DatabaseViewDialog({ fields, value, canDelete, onClose, onSave, onDelete }: { fields: DatabaseField[]; value?: DatabaseView; canDelete: boolean; onClose: () => void; onSave: (view: DatabaseView) => void; onDelete: () => void }) {
  const [draft, setDraft] = useState<DatabaseView>(() => value ? { ...value, visibleFieldIds: value.visibleFieldIds.length ? [...value.visibleFieldIds] : fields.map((field) => field.id) } : { id: crypto.randomUUID(), name: '新视图', type: 'TABLE', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: fields.map((field) => field.id) })
  const toggleField = (id: string) => setDraft((current) => ({ ...current, visibleFieldIds: current.visibleFieldIds.includes(id) ? current.visibleFieldIds.filter((fieldId) => fieldId !== id) : [...current.visibleFieldIds, id] }))
  return <div className="dialog-backdrop"><div className="dialog database-view-dialog"><div className="dialog-head"><div><p className="eyebrow">数据表视图</p><h2>{value ? '配置视图' : '新增视图'}</h2><p>筛选、排序、分组和可见字段会独立保存在这个视图中。</p></div></div><div className="settings-form-grid"><label className="field"><span className="field-label">视图名称</span><input autoFocus value={draft.name} maxLength={100} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field"><span className="field-label">视图类型</span><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value as DatabaseViewType })}>{databaseViewTypes.map(([type, label]) => <option key={type} value={type}>{label}</option>)}</select></label><label className="field"><span className="field-label">排序</span><select value={draft.sortFieldId ?? ''} onChange={(event) => setDraft({ ...draft, sortFieldId: event.target.value || null })}><option value="">默认排序</option>{fields.map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label className="field"><span className="field-label">分组</span><select value={draft.groupFieldId ?? ''} onChange={(event) => setDraft({ ...draft, groupFieldId: event.target.value || null })}><option value="">不分组</option>{fields.filter((field) => ['SELECT', 'MULTI_SELECT', 'PERSON', 'CHECKBOX', 'DATE'].includes(field.type)).map((field) => <option key={field.id} value={field.id}>{field.name}</option>)}</select></label><label className="field full"><span className="field-label">筛选文字</span><input value={draft.filter} maxLength={500} onChange={(event) => setDraft({ ...draft, filter: event.target.value })} placeholder="只显示包含该文字的记录" /></label></div><fieldset className="database-view-fields"><legend>可见字段</legend>{fields.map((field) => <label key={field.id}><input type="checkbox" checked={draft.visibleFieldIds.includes(field.id)} onChange={() => toggleField(field.id)} /><span>{fieldIcon(field.type)}</span><strong>{field.name}</strong></label>)}</fieldset><div className="dialog-actions split">{canDelete ? <button className="button danger" onClick={onDelete}><Trash2 />删除视图</button> : <span />}<div><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={!draft.name.trim() || !draft.visibleFieldIds.length} onClick={() => onSave({ ...draft, name: draft.name.trim() })}>{value ? '保存视图' : '创建视图'}</button></div></div></div></div>
}

function RecordForm({ fields, onClose, onSave }: { fields: DatabaseField[]; onClose: () => void; onSave: (values: Record<string, unknown>) => void }) {
  const [values, setValues] = useState<Record<string, unknown>>({})
  return <div className="dialog-backdrop"><div className="dialog nested-dialog"><div className="dialog-head"><div><p className="eyebrow">表单</p><h2>新建记录</h2></div></div><div className="record-form">{fields.filter((field) => field.type !== 'FORMULA' && field.type !== 'ROLLUP').map((field) => <label className="field" key={field.id}><span className="field-label">{field.name}</span><DatabaseInput field={field} value={values[field.id]} onChange={(value) => setValues((current) => ({ ...current, [field.id]: value }))} /></label>)}</div><div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" onClick={() => onSave(values)}>创建记录</button></div></div></div>
}

function FormSettingsDialog({ fields, value, onClose, onSave }: { fields: DatabaseField[]; value: DatabaseFormConfig; onClose: () => void; onSave: (value: DatabaseFormConfig) => void }) {
  const available = fields.filter((field) => field.type !== 'FORMULA' && field.type !== 'ROLLUP')
  const [draft, setDraft] = useState<DatabaseFormConfig>(() => ({ ...value, fieldIds: value.fieldIds.length ? [...value.fieldIds] : available.map((field) => field.id), requiredFieldIds: [...value.requiredFieldIds] }))
  const toggleField = (id: string) => setDraft((current) => current.fieldIds.includes(id)
    ? { ...current, fieldIds: current.fieldIds.filter((fieldId) => fieldId !== id), requiredFieldIds: current.requiredFieldIds.filter((fieldId) => fieldId !== id) }
    : { ...current, fieldIds: [...current.fieldIds, id] })
  const toggleRequired = (id: string) => setDraft((current) => ({ ...current, requiredFieldIds: current.requiredFieldIds.includes(id) ? current.requiredFieldIds.filter((fieldId) => fieldId !== id) : [...current.requiredFieldIds, id] }))
  return <div className="dialog-backdrop"><div className="dialog database-form-settings"><div className="dialog-head"><div><p className="eyebrow">数据收集</p><h2>公开表单</h2><p>发布后，任何能阅读公开文稿的人都可以提交；每次提交会安全地新增一条草稿记录。</p></div></div><label className="toggle-row"><div><strong>开放公开提交</strong><small>关闭后需重新发布，公开页面上的表单才会消失。</small></div><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /></label><div className="settings-form-grid"><label className="field"><span className="field-label">表单标题</span><input value={draft.title} maxLength={200} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label><label className="field"><span className="field-label">提交按钮</span><input value={draft.submitLabel} maxLength={60} onChange={(event) => setDraft({ ...draft, submitLabel: event.target.value })} /></label><label className="field full"><span className="field-label">说明</span><textarea value={draft.description} rows={3} maxLength={1000} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label className="field full"><span className="field-label">成功提示</span><input value={draft.successMessage} maxLength={500} onChange={(event) => setDraft({ ...draft, successMessage: event.target.value })} /></label></div><fieldset className="database-form-fields"><legend>收集字段</legend>{available.map((field) => { const selected = draft.fieldIds.includes(field.id); return <div key={field.id}><label><input type="checkbox" checked={selected} onChange={() => toggleField(field.id)} /><span>{fieldIcon(field.type)}</span><strong>{field.name}</strong><small>{fieldTypes.find(([type]) => type === field.type)?.[1]}</small></label><label className={selected ? '' : 'disabled'}><input type="checkbox" checked={draft.requiredFieldIds.includes(field.id)} disabled={!selected} onChange={() => toggleRequired(field.id)} />必填</label></div> })}</fieldset><div className="dialog-actions"><button className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={draft.enabled && !draft.fieldIds.length} onClick={() => onSave({ ...draft, title: draft.title.trim() || '提交信息', submitLabel: draft.submitLabel.trim() || '提交', successMessage: draft.successMessage.trim() || '提交成功，感谢你的填写。' })}>保存表单设置</button></div></div></div>
}

function Tool({ icon, label, active = false, disabled = false, danger = false, onClick }: { icon: React.ReactNode; label: string; active?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void }) { return <button className={`${active ? 'active' : ''} ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick} title={label}>{icon}<span>{label}</span></button> }
function ViewButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) { return <button className={active ? 'active' : ''} onClick={onClick}>{icon}{label}</button> }

interface StructuredProps { value: string; fallback: unknown; onChange: (value: string) => void }
function structured<T>(value: string, fallback: unknown, empty: T): T { try { const parsed = JSON.parse(value) as T; if (parsed && typeof parsed === 'object') return parsed } catch { /* use persisted fallback */ } return fallback && typeof fallback === 'object' ? fallback as T : empty }
function normalizeBoard(value: Partial<BoardModel>): BoardModel {
  const viewport = value.viewport && typeof value.viewport === 'object' ? value.viewport : { x: 0, y: 0, zoom: 1 }
  const kinds = new Set<BoardElement['kind']>(['RECT', 'ELLIPSE', 'STICKY', 'TEXT', 'ARROW'])
  const elements = Array.isArray(value.elements) ? value.elements
    .filter((element) => element && typeof element.id === 'string' && element.id.length > 0 && kinds.has(element.kind))
    .slice(0, 5_000)
    .map((element) => ({
      id: element.id,
      kind: element.kind,
      x: finiteNumber(element.x, 0, -1_000_000, 1_000_000),
      y: finiteNumber(element.y, 0, -1_000_000, 1_000_000),
      width: finiteNumber(element.width, element.kind === 'ARROW' ? 180 : 160, 1, 100_000),
      height: finiteNumber(element.height, element.kind === 'ARROW' ? 3 : 100, 1, 100_000),
      text: typeof element.text === 'string' ? element.text.slice(0, 100_000) : '',
      color: typeof element.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(element.color) ? element.color : '#ffffff',
    })) : []
  return {
    type: 'whiteboard',
    viewport: {
      x: finiteNumber(viewport.x, 0, -1_000_000, 1_000_000),
      y: finiteNumber(viewport.y, 0, -1_000_000, 1_000_000),
      zoom: finiteNumber(viewport.zoom, 1, .25, 3),
    },
    elements,
  }
}
function finiteNumber(value: unknown, fallback: number, minimum: number, maximum: number) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(minimum, Math.min(maximum, value)) : fallback }
function nextColor(current?: string) { const colors = ['#ffffff', '#fff1a8', '#dff3e6', '#dcecff', '#f2e1ff', '#ffe1dd']; const index = colors.indexOf(current ?? ''); return colors[(index + 1) % colors.length]! }
function emptySheet(name: string): Sheet { return { id: crypto.randomUUID(), name, rows: [], styles: {}, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], protectedCells: [], dropdowns: {}, filter: '' } }
function emptyWorkbook(): Workbook { const sheet = emptySheet('工作表 1'); return { type: 'workbook', activeSheetId: sheet.id, sheets: [sheet] } }
function normalizeWorkbook(value: Partial<Workbook>): Workbook { const sheets = Array.isArray(value.sheets) && value.sheets.length ? value.sheets.map((sheet, index) => ({ id: sheet.id || crypto.randomUUID(), name: sheet.name || `工作表 ${index + 1}`, rows: Array.isArray(sheet.rows) ? sheet.rows : [], styles: sheet.styles || {}, frozenRows: boundedInteger(sheet.frozenRows, 0, 100), frozenColumns: boundedInteger(sheet.frozenColumns, 0, 100), hiddenRows: integerList(sheet.hiddenRows), hiddenColumns: integerList(sheet.hiddenColumns), protectedCells: Array.isArray(sheet.protectedCells) ? sheet.protectedCells.filter((key): key is string => typeof key === 'string' && /^\d+:\d+$/.test(key)).slice(0, 100_000) : [], dropdowns: sheet.dropdowns && typeof sheet.dropdowns === 'object' ? Object.fromEntries(Object.entries(sheet.dropdowns).filter(([key, options]) => /^\d+:\d+$/.test(key) && Array.isArray(options)).map(([key, options]) => [key, options.filter((option): option is string => typeof option === 'string').slice(0, 100)])) : {}, filter: sheet.filter || '' })) : emptyWorkbook().sheets; return { type: 'workbook', activeSheetId: sheets.some((sheet) => sheet.id === value.activeSheetId) ? value.activeSheetId! : sheets[0]!.id, sheets } }
function boundedInteger(value: unknown, minimum: number, maximum: number) { return typeof value === 'number' && Number.isInteger(value) ? Math.max(minimum, Math.min(maximum, value)) : minimum }
function integerList(value: unknown) { return Array.isArray(value) ? [...new Set(value.filter((item): item is number => typeof item === 'number' && Number.isInteger(item) && item >= 0 && item < 100_000))].slice(0, 10_000).sort((left, right) => left - right) : [] }
function cellKey(row: number, column: number) { return `${row}:${column}` }
function columnName(column: number) { let value = ''; for (let index = column + 1; index > 0; index = Math.floor((index - 1) / 26)) value = String.fromCharCode(65 + ((index - 1) % 26)) + value; return value }
function emptyDatabase(): DatabaseModel { const fields: DatabaseField[] = [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '进行中', '已完成'] }, { id: 'date', name: '日期', type: 'DATE' }]; const views = defaultDatabaseViews(fields); return { type: 'database', fields, rows: [], view: 'TABLE', filter: '', sortFieldId: null, views, activeViewId: views[0]!.id, form: emptyDatabaseForm() } }
function emptyDatabaseForm(): DatabaseFormConfig { return { enabled: false, title: '提交信息', description: '', submitLabel: '提交', successMessage: '提交成功，感谢你的填写。', fieldIds: [], requiredFieldIds: [] } }
function normalizeDatabase(value: Partial<DatabaseModel>): DatabaseModel { const empty = emptyDatabase(); const fields = Array.isArray(value.fields) && value.fields.length ? value.fields : empty.fields; const fieldIdSet = new Set(fields.map((field) => field.id)); const legacyType = databaseViewType(value.view); const rawViews = Array.isArray(value.views) && value.views.length ? value.views : defaultDatabaseViews(fields, legacyType, value.filter || '', value.sortFieldId || null); const views = rawViews.slice(0, 50).map((view, index) => ({ id: view.id || `view-${index}-${view.type.toLowerCase()}`, name: view.name || databaseViewLabel(databaseViewType(view.type)), type: databaseViewType(view.type), filter: typeof view.filter === 'string' ? view.filter : '', sortFieldId: fieldIdSet.has(view.sortFieldId ?? '') ? view.sortFieldId : null, groupFieldId: fieldIdSet.has(view.groupFieldId ?? '') ? view.groupFieldId : null, visibleFieldIds: Array.isArray(view.visibleFieldIds) ? view.visibleFieldIds.filter((id) => fieldIdSet.has(id)) : [] })); const activeViewId = views.some((view) => view.id === value.activeViewId) ? value.activeViewId! : views.find((view) => view.type === legacyType)?.id ?? views[0]!.id; const formValue = value.form && typeof value.form === 'object' ? value.form : empty.form; const available = new Set(fields.filter((field) => field.type !== 'FORMULA' && field.type !== 'ROLLUP').map((field) => field.id)); const fieldIds = Array.isArray(formValue.fieldIds) ? formValue.fieldIds.filter((id) => available.has(id)) : []; const requiredFieldIds = Array.isArray(formValue.requiredFieldIds) ? formValue.requiredFieldIds.filter((id) => fieldIds.includes(id)) : []; return syncLegacyDatabaseView({ type: 'database', fields, rows: Array.isArray(value.rows) ? value.rows : [], view: legacyType, filter: value.filter || '', sortFieldId: value.sortFieldId || null, views, activeViewId, form: { enabled: Boolean(formValue.enabled), title: formValue.title || empty.form.title, description: formValue.description || '', submitLabel: formValue.submitLabel || empty.form.submitLabel, successMessage: formValue.successMessage || empty.form.successMessage, fieldIds, requiredFieldIds } }) }
function defaultDatabaseViews(fields: DatabaseField[], active: DatabaseViewType = 'TABLE', filter = '', sortFieldId: string | null = null): DatabaseView[] { const visibleFieldIds = fields.map((field) => field.id); const select = fields.find((field) => field.type === 'SELECT')?.id ?? null; const date = fields.find((field) => field.type === 'DATE')?.id ?? null; const views = databaseViewTypes.map(([type, name]) => ({ id: `view-${type.toLowerCase()}`, name, type, filter: type === active ? filter : '', sortFieldId: type === active ? sortFieldId : null, groupFieldId: type === 'KANBAN' ? select : type === 'CALENDAR' ? date : null, visibleFieldIds: [...visibleFieldIds] })); return views }
function syncLegacyDatabaseView(model: DatabaseModel): DatabaseModel { const view = model.views.find((item) => item.id === model.activeViewId) ?? model.views[0]!; return { ...model, activeViewId: view.id, view: view.type, filter: view.filter, sortFieldId: view.sortFieldId } }
function removeDatabaseField(model: DatabaseModel, fieldId: string): DatabaseModel { return { ...model, fields: model.fields.filter((field) => field.id !== fieldId), rows: model.rows.map((row) => ({ ...row, values: Object.fromEntries(Object.entries(row.values).filter(([id]) => id !== fieldId)) })), views: model.views.map((view) => ({ ...view, visibleFieldIds: view.visibleFieldIds.filter((id) => id !== fieldId), sortFieldId: view.sortFieldId === fieldId ? null : view.sortFieldId, groupFieldId: view.groupFieldId === fieldId ? null : view.groupFieldId })), form: { ...model.form, fieldIds: model.form.fieldIds.filter((id) => id !== fieldId), requiredFieldIds: model.form.requiredFieldIds.filter((id) => id !== fieldId) } } }
function databaseViewType(value: unknown): DatabaseViewType { return ['TABLE', 'KANBAN', 'GALLERY', 'CALENDAR'].includes(String(value)) ? value as DatabaseViewType : 'TABLE' }
function databaseViewLabel(type: DatabaseViewType) { return databaseViewTypes.find(([value]) => value === type)?.[1] ?? '表格' }
function databaseViewIcon(type: DatabaseViewType) { return type === 'KANBAN' ? <Columns3 /> : type === 'GALLERY' ? <GalleryHorizontal /> : type === 'CALENDAR' ? <CalendarDays /> : <Table2 /> }
function databaseValue(model: DatabaseModel, row: DatabaseRow, field: DatabaseField): unknown { return databaseFieldValue(model.fields, row, field) }
function fieldIcon(type: FieldType) { return ({ TEXT: 'T', NUMBER: '#', SELECT: '●', MULTI_SELECT: '◉', DATE: '◷', PERSON: '@', CHECKBOX: '☑', URL: '↗', EMAIL: '✉', FILE: '▣', FORMULA: '∑', RELATION: '↔', ROLLUP: '∫' })[type] }
const fieldTypes: Array<[FieldType, string]> = [['TEXT', '文本'], ['NUMBER', '数字'], ['SELECT', '单选'], ['MULTI_SELECT', '多选'], ['DATE', '日期'], ['PERSON', '成员'], ['CHECKBOX', '复选框'], ['URL', '网址'], ['EMAIL', '邮箱'], ['FILE', '附件'], ['FORMULA', '公式'], ['RELATION', '关联'], ['ROLLUP', '汇总']]
const databaseViewTypes: Array<[DatabaseViewType, string]> = [['TABLE', '表格'], ['KANBAN', '看板'], ['GALLERY', '画廊'], ['CALENDAR', '日历']]
