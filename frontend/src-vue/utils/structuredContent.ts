export type BoardKind = 'RECT' | 'ELLIPSE' | 'STICKY' | 'TEXT' | 'ARROW'

export interface BoardElement {
  id: string
  kind: BoardKind
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
}

export interface BoardModel {
  type: 'whiteboard'
  viewport: { x: number; y: number; zoom: number }
  elements: BoardElement[]
}

export interface CellStyle {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  color?: string
  background?: string
  align?: 'LEFT' | 'CENTER' | 'RIGHT'
  numberFormat?: 'GENERAL' | 'NUMBER' | 'CURRENCY' | 'PERCENT' | 'DATE'
}

export interface Sheet {
  id: string
  name: string
  rows: string[][]
  styles: Record<string, CellStyle>
  frozenRows: number
  frozenColumns: number
  hiddenRows: number[]
  hiddenColumns: number[]
  protectedCells: string[]
  dropdowns: Record<string, string[]>
  filter: string
}

export interface Workbook {
  type: 'workbook'
  activeSheetId: string
  sheets: Sheet[]
}

export type DatabaseViewType = 'TABLE' | 'KANBAN' | 'GALLERY' | 'CALENDAR'

export interface DatabaseField {
  id: string
  name: string
  type: string
  options?: string[]
  formula?: string
}

export interface DatabaseRow {
  id: string
  values: Record<string, unknown>
  createdAt?: string
}

export interface DatabaseView {
  id: string
  name: string
  type: DatabaseViewType
  filter: string
  sortFieldId: string | null
  groupFieldId: string | null
  visibleFieldIds: string[]
}

export interface DatabaseModel {
  type: 'database'
  fields: DatabaseField[]
  rows: DatabaseRow[]
  view: DatabaseViewType
  filter: string
  sortFieldId: string | null
  views: DatabaseView[]
  activeViewId: string
  form?: unknown
}

export const DATABASE_VIEW_TYPES: DatabaseViewType[] = ['TABLE', 'KANBAN', 'GALLERY', 'CALENDAR']

export function parseStructuredRecord(input: unknown): Record<string, unknown> {
  if (typeof input === 'string') {
    try {
      const parsed: unknown = JSON.parse(input)
      return asRecord(parsed) ?? {}
    } catch {
      return {}
    }
  }
  return asRecord(input) ?? {}
}

export function normalizeBoard(input: unknown): BoardModel {
  const raw = parseStructuredRecord(input)
  const viewport = asRecord(raw.viewport)
  const elements = Array.isArray(raw.elements) ? raw.elements.flatMap((value, index) => {
    const element = asRecord(value)
    if (!element) return []
    const kind = boardKind(element.kind)
    return [{
      ...element,
      id: nonEmptyString(element.id, `element-${index + 1}`),
      kind,
      x: finiteNumber(element.x, 0),
      y: finiteNumber(element.y, 0),
      width: positiveNumber(element.width, kind === 'ARROW' ? 180 : 160),
      height: positiveNumber(element.height, kind === 'ARROW' ? 24 : 100),
      text: typeof element.text === 'string' ? element.text : '',
      color: nonEmptyString(element.color, kind === 'STICKY' ? '#fef3a7' : '#ffffff'),
    } as BoardElement]
  }) : []
  return {
    ...raw,
    type: 'whiteboard',
    viewport: {
      x: finiteNumber(viewport?.x, 0),
      y: finiteNumber(viewport?.y, 0),
      zoom: clamp(finiteNumber(viewport?.zoom, 1), 0.25, 3),
    },
    elements,
  } as BoardModel
}

export function normalizeWorkbook(input: unknown, idFactory: (index: number) => string = (index) => `sheet-${index + 1}`): Workbook {
  const raw = parseStructuredRecord(input)
  const sheets = Array.isArray(raw.sheets) && raw.sheets.length
    ? raw.sheets.flatMap((value, index) => {
      const sheet = asRecord(value)
      return sheet ? [normalizeSheet(sheet, index, idFactory)] : []
    })
    : [emptySheet('工作表 1', idFactory(0))]
  const usableSheets = sheets.length ? sheets : [emptySheet('工作表 1', idFactory(0))]
  const requested = typeof raw.activeSheetId === 'string' ? raw.activeSheetId : ''
  return {
    ...raw,
    type: 'workbook',
    activeSheetId: usableSheets.some((sheet) => sheet.id === requested) ? requested : usableSheets[0]!.id,
    sheets: usableSheets,
  } as Workbook
}

export function emptySheet(name: string, id: string): Sheet {
  return { id, name, rows: [], styles: {}, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], protectedCells: [], dropdowns: {}, filter: '' }
}

export function normalizeDatabase(input: unknown): DatabaseModel {
  const raw = parseStructuredRecord(input)
  const fallbackFields: DatabaseField[] = [
    { id: 'name', name: '名称', type: 'TEXT' },
    { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '进行中', '已完成'] },
    { id: 'date', name: '日期', type: 'DATE' },
  ]
  const fields = Array.isArray(raw.fields) && raw.fields.length
    ? raw.fields.flatMap((value, index) => {
      const field = asRecord(value)
      if (!field) return []
      return [{
        ...field,
        id: nonEmptyString(field.id, `field-${index + 1}`),
        name: nonEmptyString(field.name, `字段 ${index + 1}`),
        type: nonEmptyString(field.type, 'TEXT').toUpperCase(),
        ...(Array.isArray(field.options) ? { options: field.options.filter((option): option is string => typeof option === 'string').slice(0, 100) } : {}),
        ...(typeof field.formula === 'string' ? { formula: field.formula } : {}),
      } as DatabaseField]
    })
    : fallbackFields
  const usableFields = fields.length ? fields : fallbackFields
  const fieldIds = new Set(usableFields.map((field) => field.id))
  const rows = Array.isArray(raw.rows) ? raw.rows.flatMap((value, index) => {
    const row = asRecord(value)
    const values = asRecord(row?.values)
    return row && values ? [{ ...row, id: nonEmptyString(row.id, `row-${index + 1}`), values } as DatabaseRow] : []
  }) : []
  const legacyType = databaseViewType(raw.view)
  const rawViews = Array.isArray(raw.views) && raw.views.length ? raw.views : defaultDatabaseViews(usableFields, legacyType, stringValue(raw.filter), nullableFieldId(raw.sortFieldId, fieldIds))
  const views = rawViews.slice(0, 50).flatMap((value, index) => {
    const view = asRecord(value)
    if (!view) return []
    const type = databaseViewType(view.type)
    return [{
      ...view,
      id: nonEmptyString(view.id, `view-${type.toLowerCase()}-${index + 1}`),
      name: nonEmptyString(view.name, databaseViewLabel(type)),
      type,
      filter: stringValue(view.filter),
      sortFieldId: nullableFieldId(view.sortFieldId, fieldIds),
      groupFieldId: nullableFieldId(view.groupFieldId, fieldIds),
      visibleFieldIds: Array.isArray(view.visibleFieldIds)
        ? view.visibleFieldIds.filter((id): id is string => typeof id === 'string' && fieldIds.has(id))
        : usableFields.map((field) => field.id),
    } as DatabaseView]
  })
  const usableViews = views.length ? views : defaultDatabaseViews(usableFields)
  const requested = typeof raw.activeViewId === 'string' ? raw.activeViewId : ''
  const active = usableViews.find((view) => view.id === requested)
    ?? usableViews.find((view) => view.type === legacyType)
    ?? usableViews[0]!
  return {
    ...raw,
    type: 'database',
    fields: usableFields,
    rows,
    view: active.type,
    filter: active.filter,
    sortFieldId: active.sortFieldId,
    views: usableViews,
    activeViewId: active.id,
    form: raw.form,
  } as DatabaseModel
}

export function defaultDatabaseViews(
  fields: DatabaseField[],
  activeType: DatabaseViewType = 'TABLE',
  filter = '',
  sortFieldId: string | null = null,
): DatabaseView[] {
  const visibleFieldIds = fields.map((field) => field.id)
  const selectId = fields.find((field) => field.type === 'SELECT')?.id ?? null
  const dateId = fields.find((field) => field.type === 'DATE')?.id ?? null
  return DATABASE_VIEW_TYPES.map((type) => ({
    id: `view-${type.toLowerCase()}`,
    name: databaseViewLabel(type),
    type,
    filter: type === activeType ? filter : '',
    sortFieldId: type === activeType ? sortFieldId : null,
    groupFieldId: type === 'KANBAN' ? selectId : type === 'CALENDAR' ? dateId : null,
    visibleFieldIds: [...visibleFieldIds],
  }))
}

export function activeDatabaseView(model: DatabaseModel): DatabaseView {
  return model.views.find((view) => view.id === model.activeViewId) ?? model.views[0]!
}

export function activateDatabaseView(model: DatabaseModel, view: DatabaseView): DatabaseModel {
  return { ...model, activeViewId: view.id, view: view.type, filter: view.filter, sortFieldId: view.sortFieldId }
}

export function databaseViewLabel(type: DatabaseViewType): string {
  return ({ TABLE: '表格', KANBAN: '看板', GALLERY: '画廊', CALENDAR: '日历' })[type]
}

export function databaseRowsForView(model: DatabaseModel, view = activeDatabaseView(model)): DatabaseRow[] {
  const query = view.filter.trim().toLocaleLowerCase()
  const sortField = model.fields.find((field) => field.id === view.sortFieldId)
  return model.rows
    .filter((row) => !query || model.fields.some((field) => databaseDisplayValue(row.values[field.id]).toLocaleLowerCase().includes(query)))
    .slice()
    .sort((left, right) => sortField
      ? databaseDisplayValue(left.values[sortField.id]).localeCompare(databaseDisplayValue(right.values[sortField.id]), 'zh-CN', { numeric: true })
      : 0)
}

export function databaseDisplayValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(databaseDisplayValue).filter(Boolean).join('、')
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  return ''
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function normalizeSheet(raw: Record<string, unknown>, index: number, idFactory: (index: number) => string): Sheet {
  const rows = Array.isArray(raw.rows) ? raw.rows.map((row) => Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []) : []
  const styles = Object.fromEntries(Object.entries(asRecord(raw.styles) ?? {}).flatMap(([key, value]) => {
    if (!/^\d+:\d+$/.test(key)) return []
    const style = asRecord(value)
    if (!style) return []
    const align = ['LEFT', 'CENTER', 'RIGHT'].includes(String(style.align)) ? String(style.align) as CellStyle['align'] : undefined
    return [[key, {
      ...(style.bold === true ? { bold: true } : {}),
      ...(style.italic === true ? { italic: true } : {}),
      ...(style.underline === true ? { underline: true } : {}),
      ...(typeof style.color === 'string' ? { color: style.color } : {}),
      ...(typeof style.background === 'string' ? { background: style.background } : {}),
      ...(align ? { align } : {}),
      ...(typeof style.numberFormat === 'string' ? { numberFormat: style.numberFormat as CellStyle['numberFormat'] } : {}),
    } satisfies CellStyle]]
  }))
  const dropdowns = Object.fromEntries(Object.entries(asRecord(raw.dropdowns) ?? {}).flatMap(([key, value]) => /^\d+:\d+$/.test(key) && Array.isArray(value)
    ? [[key, value.filter((option): option is string => typeof option === 'string').slice(0, 100)]]
    : []))
  return {
    ...raw,
    id: nonEmptyString(raw.id, idFactory(index)),
    name: nonEmptyString(raw.name, `工作表 ${index + 1}`),
    rows,
    styles,
    frozenRows: boundedInteger(raw.frozenRows, 0, 100),
    frozenColumns: boundedInteger(raw.frozenColumns, 0, 100),
    hiddenRows: integerList(raw.hiddenRows),
    hiddenColumns: integerList(raw.hiddenColumns),
    protectedCells: Array.isArray(raw.protectedCells) ? raw.protectedCells.filter((key): key is string => typeof key === 'string' && /^\d+:\d+$/.test(key)) : [],
    dropdowns,
    filter: stringValue(raw.filter),
  } as Sheet
}

function boardKind(value: unknown): BoardKind {
  const kind = String(value).toUpperCase()
  return ['RECT', 'ELLIPSE', 'STICKY', 'TEXT', 'ARROW'].includes(kind) ? kind as BoardKind : 'STICKY'
}

function databaseViewType(value: unknown): DatabaseViewType {
  const type = String(value).toUpperCase()
  return DATABASE_VIEW_TYPES.includes(type as DatabaseViewType) ? type as DatabaseViewType : 'TABLE'
}

function nullableFieldId(value: unknown, fieldIds: Set<string>): string | null {
  return typeof value === 'string' && fieldIds.has(value) ? value : null
}

function integerList(value: unknown): number[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is number => Number.isInteger(item) && item >= 0))].sort((left, right) => left - right) : []
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number {
  return clamp(Math.floor(finiteNumber(value, minimum)), minimum, maximum)
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function positiveNumber(value: unknown, fallback: number): number {
  const number = finiteNumber(value, fallback)
  return number > 0 ? number : fallback
}

function nonEmptyString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
