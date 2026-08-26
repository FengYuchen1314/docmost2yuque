<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { Page } from '../../../src/types'
import { fieldTypeLabel } from '../../utils/displayLabels'
import {
  DATABASE_VIEW_TYPES,
  activateDatabaseView,
  activeDatabaseView,
  databaseDisplayValue,
  databaseRowsForView,
  defaultDatabaseViews,
  emptySheet,
  normalizeBoard,
  normalizeDatabase,
  normalizeWorkbook,
  type BoardElement,
  type BoardKind,
  type CellStyle,
  type DatabaseField,
  type DatabaseModel,
  type DatabaseRow,
  type DatabaseView,
  type DatabaseViewType,
  type Sheet,
  type Workbook,
} from '../../utils/structuredContent'
import { createUuid } from '../../utils/uuid'

const props = defineProps<{ type: Page['contentType']; modelValue: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

function save(value: unknown) {
  emit('update:modelValue', JSON.stringify(value))
}

// Whiteboard
const selectedElementId = ref('')
const boardTool = ref<'PAN' | BoardKind>('STICKY')
const boardDrag = reactive({ mode: 'NONE' as 'NONE' | 'ELEMENT' | 'PAN', id: '', startX: 0, startY: 0, x: 0, y: 0 })
const board = computed(() => normalizeBoard(props.modelValue))

function addBoard() {
  const kind: BoardKind = boardTool.value === 'PAN' ? 'STICKY' : boardTool.value
  const element: BoardElement = {
    id: createUuid(),
    kind,
    x: 180 + board.value.elements.length * 18,
    y: 120 + board.value.elements.length * 18,
    width: kind === 'ARROW' ? 200 : 180,
    height: kind === 'ARROW' ? 24 : kind === 'STICKY' ? 140 : kind === 'TEXT' ? 60 : 110,
    text: kind === 'STICKY' ? '新便签' : kind === 'TEXT' ? '文本' : '',
    color: kind === 'STICKY' ? '#fef3a7' : '#ffffff',
  }
  save({ ...board.value, elements: [...board.value.elements, element] })
  selectedElementId.value = element.id
}

function patchBoardElement(id: string, patch: Partial<BoardElement>) {
  save({ ...board.value, elements: board.value.elements.map((element) => element.id === id ? { ...element, ...patch } : element) })
}

function startElementDrag(event: PointerEvent, element: BoardElement) {
  selectedElementId.value = element.id
  if (boardTool.value === 'PAN') {
    beginBoardPan(event)
    return
  }
  boardDrag.mode = 'ELEMENT'
  boardDrag.id = element.id
  boardDrag.startX = event.clientX
  boardDrag.startY = event.clientY
  boardDrag.x = element.x
  boardDrag.y = element.y
}

function startCanvasInteraction(event: PointerEvent) {
  if (boardTool.value !== 'PAN') {
    selectedElementId.value = ''
    return
  }
  beginBoardPan(event)
}

function beginBoardPan(event: PointerEvent) {
  boardDrag.mode = 'PAN'
  boardDrag.startX = event.clientX
  boardDrag.startY = event.clientY
  boardDrag.x = board.value.viewport.x
  boardDrag.y = board.value.viewport.y
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
}

function moveBoard(event: PointerEvent) {
  if (boardDrag.mode === 'ELEMENT') {
    patchBoardElement(boardDrag.id, {
      x: boardDrag.x + (event.clientX - boardDrag.startX) / board.value.viewport.zoom,
      y: boardDrag.y + (event.clientY - boardDrag.startY) / board.value.viewport.zoom,
    })
  } else if (boardDrag.mode === 'PAN') {
    save({
      ...board.value,
      viewport: {
        ...board.value.viewport,
        x: boardDrag.x + event.clientX - boardDrag.startX,
        y: boardDrag.y + event.clientY - boardDrag.startY,
      },
    })
  }
}

function finishBoardInteraction() {
  boardDrag.mode = 'NONE'
  boardDrag.id = ''
}

function removeBoardElement() {
  if (!selectedElementId.value) return
  save({ ...board.value, elements: board.value.elements.filter((element) => element.id !== selectedElementId.value) })
  selectedElementId.value = ''
}

function setBoardZoom(next: number) {
  save({ ...board.value, viewport: { ...board.value.viewport, zoom: Math.max(0.25, Math.min(3, next)) } })
}

function zoomBoardWithWheel(event: WheelEvent) {
  if (!event.ctrlKey) return
  event.preventDefault()
  setBoardZoom(board.value.viewport.zoom + (event.deltaY < 0 ? 0.1 : -0.1))
}

// Spreadsheet
const workbook = computed(() => normalizeWorkbook(props.modelValue, () => createUuid()))
const sheet = computed(() => workbook.value.sheets.find((item) => item.id === workbook.value.activeSheetId) ?? workbook.value.sheets[0]!)
const selectedCell = reactive({ row: 0, column: 0 })
const selectedCellKey = computed(() => cellKey(selectedCell.row, selectedCell.column))
const selectedCellStyle = computed(() => sheet.value.styles[selectedCellKey.value] ?? {})
const sheetRows = computed(() => {
  const query = sheet.value.filter.trim().toLocaleLowerCase()
  const count = Math.max(30, sheet.value.rows.length + 5)
  return Array.from({ length: count }, (_, row) => row).filter((row) =>
    !sheet.value.hiddenRows.includes(row)
      && (!query || (sheet.value.rows[row] ?? []).some((cell) => cell.toLocaleLowerCase().includes(query))),
  )
})
const sheetColumns = computed(() => {
  const used = sheet.value.rows.reduce((maximum, row) => Math.max(maximum, row.length), 0)
  const count = Math.max(12, used + 3)
  return Array.from({ length: count }, (_, column) => column).filter((column) => !sheet.value.hiddenColumns.includes(column))
})

function updateWorkbookSheet(next: Sheet) {
  save({ ...workbook.value, sheets: workbook.value.sheets.map((item) => item.id === next.id ? next : item) })
}

function updateCell(row: number, column: number, value: string) {
  const data = sheet.value.rows.map((cells) => [...cells])
  while (data.length <= row) data.push([])
  while (data[row]!.length <= column) data[row]!.push('')
  data[row]![column] = value
  updateWorkbookSheet({ ...sheet.value, rows: data })
}

function patchCellStyle(patch: Partial<CellStyle>) {
  const next = { ...selectedCellStyle.value, ...patch }
  updateWorkbookSheet({ ...sheet.value, styles: { ...sheet.value.styles, [selectedCellKey.value]: next } })
}

function cycleCellAlignment() {
  const current = selectedCellStyle.value.align ?? 'LEFT'
  patchCellStyle({ align: current === 'LEFT' ? 'CENTER' : current === 'CENTER' ? 'RIGHT' : 'LEFT' })
}

function insertSheetRow() {
  const insertAt = selectedCell.row + 1
  const rows = sheet.value.rows.map((row) => [...row])
  while (rows.length < insertAt) rows.push([])
  rows.splice(insertAt, 0, [])
  updateWorkbookSheet({
    ...sheet.value,
    rows,
    styles: shiftCellRecord(sheet.value.styles, insertAt),
    dropdowns: shiftCellRecord(sheet.value.dropdowns, insertAt),
    protectedCells: sheet.value.protectedCells.map((key) => shiftCellKey(key, insertAt)),
    hiddenRows: sheet.value.hiddenRows.map((row) => row >= insertAt ? row + 1 : row),
    frozenRows: insertAt < sheet.value.frozenRows ? sheet.value.frozenRows + 1 : sheet.value.frozenRows,
  })
  selectedCell.row = insertAt
}

function addSheet() {
  const next = emptySheet(`工作表 ${workbook.value.sheets.length + 1}`, createUuid())
  save({ ...workbook.value, activeSheetId: next.id, sheets: [...workbook.value.sheets, next] })
}

function cellKey(row: number, column: number) {
  return `${row}:${column}`
}

function columnName(index: number) {
  let value = ''
  for (let current = index + 1; current > 0; current = Math.floor((current - 1) / 26)) value = String.fromCharCode(65 + (current - 1) % 26) + value
  return value
}

function cellStyle(row: number, column: number): Record<string, string | number | undefined> {
  const style = sheet.value.styles[cellKey(row, column)] ?? {}
  return {
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    textAlign: style.align?.toLowerCase(),
    color: style.color,
    background: style.background,
  }
}

function shiftCellKey(key: string, insertionRow: number) {
  const match = /^(\d+):(\d+)$/.exec(key)
  if (!match) return key
  const row = Number(match[1])
  return `${row >= insertionRow ? row + 1 : row}:${match[2]}`
}

function shiftCellRecord<T>(source: Record<string, T>, insertionRow: number): Record<string, T> {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [shiftCellKey(key, insertionRow), value]))
}

// Database
const database = computed(() => normalizeDatabase(props.modelValue))
const activeView = computed(() => activeDatabaseView(database.value))
const fieldDialogOpen = ref(false)
const fieldName = ref('')
const fieldType = ref('TEXT')
const fieldOptionsText = ref('')
const fieldDialogError = ref('')
const fieldTypeItems = [
  { title: '文本', value: 'TEXT', icon: 'mdi-format-text' },
  { title: '数字', value: 'NUMBER', icon: 'mdi-pound' },
  { title: '单选', value: 'SELECT', icon: 'mdi-form-dropdown' },
  { title: '日期', value: 'DATE', icon: 'mdi-calendar-blank-outline' },
  { title: '复选框', value: 'CHECKBOX', icon: 'mdi-checkbox-marked-outline' },
]
const visibleFields = computed(() => {
  const ids = activeView.value.visibleFieldIds
  if (!ids.length) return database.value.fields
  return ids.map((id) => database.value.fields.find((field) => field.id === id)).filter((field): field is DatabaseField => Boolean(field))
})
const visibleDatabaseRows = computed(() => databaseRowsForView(database.value, activeView.value))
const titleField = computed(() => visibleFields.value[0] ?? database.value.fields[0])
const kanbanField = computed(() => database.value.fields.find((field) => field.id === activeView.value.groupFieldId)
  ?? database.value.fields.find((field) => field.type === 'SELECT'))
const kanbanGroups = computed(() => {
  const field = kanbanField.value
  const groups = new Map<string, DatabaseRow[]>()
  for (const option of field?.options ?? []) groups.set(option, [])
  for (const row of visibleDatabaseRows.value) {
    const group = field ? databaseDisplayValue(row.values[field.id]).trim() || '未分组' : '未分组'
    groups.set(group, [...(groups.get(group) ?? []), row])
  }
  if (!groups.has('未分组')) groups.set('未分组', [])
  return [...groups.entries()].map(([name, rows]) => ({ name, rows }))
})
const calendarField = computed(() => database.value.fields.find((field) => field.id === activeView.value.groupFieldId && field.type === 'DATE')
  ?? database.value.fields.find((field) => field.type === 'DATE'))
const calendarGroups = computed(() => {
  const groups = new Map<string, DatabaseRow[]>()
  for (const row of visibleDatabaseRows.value) {
    const day = calendarField.value
      ? databaseDisplayValue(row.values[calendarField.value.id]).trim() || '未安排日期'
      : '未配置日期字段'
    groups.set(day, [...(groups.get(day) ?? []), row])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN')).map(([day, rows]) => ({ day, rows }))
})

function selectDatabaseView(value: unknown) {
  if (!DATABASE_VIEW_TYPES.includes(value as DatabaseViewType)) return
  const type = value as DatabaseViewType
  let view = database.value.views.find((item) => item.type === type)
  let views = database.value.views
  if (!view) {
    const template = defaultDatabaseViews(database.value.fields).find((item) => item.type === type)!
    view = { ...template, id: views.some((item) => item.id === template.id) ? `${template.id}-${createUuid()}` : template.id }
    views = [...views, view]
  }
  save(activateDatabaseView({ ...database.value, views }, view))
}

function updateActiveView(patch: Partial<DatabaseView>) {
  const next = { ...activeView.value, ...patch }
  const model = { ...database.value, views: database.value.views.map((view) => view.id === next.id ? next : view) }
  save(activateDatabaseView(model, next))
}

function addField() {
  fieldName.value = ''
  fieldType.value = 'TEXT'
  fieldOptionsText.value = ''
  fieldDialogError.value = ''
  fieldDialogOpen.value = true
}

function createField() {
  const name = fieldName.value.trim()
  if (!name) {
    fieldDialogError.value = '请输入字段名称'
    return
  }
  if (database.value.fields.some((field) => field.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
    fieldDialogError.value = '已存在同名字段'
    return
  }
  const field: DatabaseField = { id: createUuid(), name, type: fieldType.value }
  if (fieldType.value === 'SELECT') field.options = normalizedFieldOptions(fieldOptionsText.value)
  const model: DatabaseModel = {
    ...database.value,
    fields: [...database.value.fields, field],
    views: database.value.views.map((view) => ({ ...view, visibleFieldIds: view.visibleFieldIds.length ? [...view.visibleFieldIds, field.id] : [] })),
  }
  save(activateDatabaseView(model, model.views.find((view) => view.id === model.activeViewId) ?? model.views[0]!))
  fieldDialogOpen.value = false
}

function normalizedFieldOptions(value: string) {
  const values = value.split(/[\n,，]/).map((item) => item.trim()).filter(Boolean)
  return [...new Set(values)].slice(0, 50)
}

function addRow() {
  const primaryFieldId = titleField.value?.id ?? database.value.fields[0]?.id ?? 'name'
  save({
    ...database.value,
    rows: [...database.value.rows, { id: createUuid(), values: { [primaryFieldId]: '新记录' }, createdAt: new Date().toISOString() }],
  })
}

function updateDatabaseValue(rowId: string, fieldId: string, value: unknown) {
  save({ ...database.value, rows: database.value.rows.map((row) => row.id === rowId ? { ...row, values: { ...row.values, [fieldId]: value } } : row) })
}

function removeRow(rowId: string) {
  save({ ...database.value, rows: database.value.rows.filter((row) => row.id !== rowId) })
}

function rowTitle(row: DatabaseRow) {
  return titleField.value ? databaseDisplayValue(row.values[titleField.value.id]) || '无标题记录' : '无标题记录'
}

function secondaryFields(): DatabaseField[] {
  return visibleFields.value.filter((field) => field.id !== titleField.value?.id).slice(0, 3)
}

</script>

<template>
  <div v-if="type === 'WHITEBOARD'" class="structured-editor board-wrap">
    <v-toolbar height="42" color="surface" flat class="editor-control-bar">
      <v-btn-toggle v-model="boardTool" mandatory color="primary" density="compact" class="tool-segment">
        <v-btn value="PAN" size="small" prepend-icon="mdi-hand-back-right-outline">平移</v-btn>
        <v-btn value="STICKY" size="small" prepend-icon="mdi-note-outline">便签</v-btn>
        <v-btn value="RECT" size="small" prepend-icon="mdi-rectangle-outline">矩形</v-btn>
        <v-btn value="ELLIPSE" size="small" prepend-icon="mdi-circle-outline">椭圆</v-btn>
        <v-btn value="TEXT" size="small" prepend-icon="mdi-format-text">文本</v-btn>
        <v-btn value="ARROW" size="small" prepend-icon="mdi-arrow-right">箭头</v-btn>
      </v-btn-toggle>
      <v-divider vertical class="tool-divider" />
      <v-btn data-testid="add-board" class="tool-button" size="small" variant="text" prepend-icon="mdi-plus" :disabled="boardTool === 'PAN'" @click="addBoard">添加</v-btn>
      <v-btn v-if="selectedElementId" data-testid="delete-board" class="tool-button" size="small" color="error" variant="text" icon="mdi-trash-can-outline" aria-label="删除所选白板元素" title="删除" @click="removeBoardElement" />
      <v-spacer />
      <div class="zoom-control" aria-label="白板缩放">
        <v-btn data-testid="zoom-out" aria-label="缩小白板" icon="mdi-minus" size="small" variant="text" @click="setBoardZoom(board.viewport.zoom - 0.1)" />
        <span>{{ Math.round(board.viewport.zoom * 100) }}%</span>
        <v-btn data-testid="zoom-in" aria-label="放大白板" icon="mdi-plus" size="small" variant="text" @click="setBoardZoom(board.viewport.zoom + 0.1)" />
      </div>
    </v-toolbar>
    <div
      class="board-canvas"
      :class="{ 'is-panning': boardTool === 'PAN' }"
      data-testid="board-canvas"
      @pointerdown="startCanvasInteraction"
      @pointermove="moveBoard"
      @pointerup="finishBoardInteraction"
      @pointercancel="finishBoardInteraction"
      @pointerleave="finishBoardInteraction"
      @wheel="zoomBoardWithWheel"
    >
      <div class="board-surface" :style="{ transform: `translate(${board.viewport.x}px, ${board.viewport.y}px) scale(${board.viewport.zoom})` }">
        <template v-for="item in board.elements" :key="item.id">
          <svg
            v-if="item.kind === 'ARROW'"
            class="board-item board-arrow"
            data-kind="ARROW"
            :class="{ selected: selectedElementId === item.id }"
            :style="{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${Math.max(24, item.height)}px` }"
            :aria-label="item.text || '箭头'"
            @pointerdown.stop="startElementDrag($event, item)"
          >
            <defs><marker :id="`arrow-${item.id}`" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker></defs>
            <line x1="2" y1="12" :x2="Math.max(2, item.width - 9)" y2="12" :marker-end="`url(#arrow-${item.id})`" />
          </svg>
          <div
            v-else
            class="board-item"
            :class="[{ selected: selectedElementId === item.id }, `kind-${item.kind.toLowerCase()}`]"
            :style="{ left: `${item.x}px`, top: `${item.y}px`, width: `${item.width}px`, height: `${item.height}px`, background: item.kind === 'TEXT' ? 'transparent' : item.color }"
            :data-kind="item.kind"
            @pointerdown.stop="startElementDrag($event, item)"
          >
            <textarea
              :aria-label="`白板${item.kind === 'STICKY' ? '便签' : item.kind === 'TEXT' ? '文本' : item.kind === 'ELLIPSE' ? '椭圆' : '矩形'}内容`"
              :value="item.text"
              :placeholder="item.kind === 'RECT' || item.kind === 'ELLIPSE' ? '输入文字' : ''"
              @pointerdown.stop="selectedElementId = item.id"
              @input="patchBoardElement(item.id, { text: ($event.target as HTMLTextAreaElement).value })"
            />
          </div>
        </template>
      </div>
      <div v-if="!board.elements.length" class="empty-state"><div><v-icon size="48">mdi-drawing-box</v-icon><h3>无限白板</h3><p>选择元素类型并添加；切换“平移”可拖动画布。</p><v-btn color="primary" @click="boardTool = 'STICKY'; addBoard()">添加便签</v-btn></div></div>
    </div>
  </div>

  <div v-else-if="type === 'SPREADSHEET'" class="structured-editor sheet-wrap">
    <v-toolbar height="42" color="surface" flat class="editor-control-bar">
      <span class="sheet-selection">{{ columnName(selectedCell.column) }}{{ selectedCell.row + 1 }}</span>
      <v-divider vertical class="tool-divider" />
      <v-btn data-testid="cell-bold" class="tool-button" size="small" variant="text" aria-label="加粗当前单元格" icon="mdi-format-bold" :color="selectedCellStyle.bold ? 'primary' : undefined" @click="patchCellStyle({ bold: !selectedCellStyle.bold })" />
      <v-btn data-testid="cell-italic" class="tool-button" size="small" variant="text" aria-label="斜体当前单元格" icon="mdi-format-italic" :color="selectedCellStyle.italic ? 'primary' : undefined" @click="patchCellStyle({ italic: !selectedCellStyle.italic })" />
      <v-btn data-testid="cell-align" class="tool-button" size="small" variant="text" :aria-label="`切换对齐方式，当前${selectedCellStyle.align || 'LEFT'}`" icon="mdi-format-align-left" :title="`当前对齐：${selectedCellStyle.align || 'LEFT'}`" @click="cycleCellAlignment" />
      <v-divider vertical class="tool-divider" />
      <v-btn data-testid="insert-row" class="tool-button" size="small" variant="text" icon="mdi-table-row-plus-after" aria-label="在下方插入行" title="在下方插入行" @click="insertSheetRow" />
      <v-spacer />
      <span class="sheet-name">{{ sheet.name }}</span>
    </v-toolbar>
    <div class="sheet-scroll">
      <table><thead><tr><th class="corner" /><th v-for="column in sheetColumns" :key="column">{{ columnName(column) }}</th></tr></thead>
        <tbody><tr v-for="row in sheetRows" :key="row"><th>{{ row + 1 }}</th><td
          v-for="column in sheetColumns"
          :key="column"
          :class="{ selected: selectedCell.row === row && selectedCell.column === column }"
          :style="cellStyle(row, column)"
        ><input
          :aria-label="`${columnName(column)}${row + 1}`"
          :value="sheet.rows[row]?.[column] ?? ''"
          :disabled="sheet.protectedCells.includes(cellKey(row, column))"
          @focus="selectedCell.row = row; selectedCell.column = column"
          @input="updateCell(row, column, ($event.target as HTMLInputElement).value)"
        /></td></tr></tbody>
      </table>
    </div>
    <div class="sheet-tabs"><v-btn v-for="item in workbook.sheets" :key="item.id" :data-sheet-id="item.id" :color="item.id === workbook.activeSheetId ? 'primary' : undefined" variant="text" @click="save({ ...workbook, activeSheetId: item.id })">{{ item.name }}</v-btn><v-btn data-testid="add-sheet" aria-label="新增工作表" icon="mdi-plus" variant="text" @click="addSheet" /></div>
  </div>

  <div v-else class="structured-editor database-wrap">
    <v-toolbar height="42" color="surface" flat class="editor-control-bar">
      <v-btn-toggle :model-value="activeView.type" mandatory color="primary" density="compact" class="tool-segment" @update:model-value="selectDatabaseView">
        <v-btn value="TABLE" size="small" prepend-icon="mdi-table">表格</v-btn>
        <v-btn value="KANBAN" size="small" prepend-icon="mdi-view-column-outline">看板</v-btn>
        <v-btn value="GALLERY" size="small" prepend-icon="mdi-view-grid-outline">画廊</v-btn>
        <v-btn value="CALENDAR" size="small" prepend-icon="mdi-calendar-outline">日历</v-btn>
      </v-btn-toggle>
      <v-divider vertical class="tool-divider" />
      <v-text-field class="database-filter" :model-value="activeView.filter" placeholder="筛选记录" prepend-inner-icon="mdi-filter-outline" density="compact" variant="solo-filled" flat hide-details @update:model-value="updateActiveView({ filter: String($event ?? '') })" />
      <v-spacer />
      <v-btn data-testid="add-field" class="tool-button" size="small" variant="text" prepend-icon="mdi-table-column-plus-after" @click="addField">字段</v-btn>
      <v-btn data-testid="add-row" class="record-button" size="small" color="primary" variant="tonal" prepend-icon="mdi-plus" @click="addRow">记录</v-btn>
    </v-toolbar>

    <div v-if="activeView.type === 'TABLE'" class="database-table" data-testid="database-table-view">
      <table><thead><tr><th v-for="field in visibleFields" :key="field.id">{{ field.name }}<small>{{ fieldTypeLabel(field.type) }}</small></th><th /></tr></thead>
        <tbody><tr v-for="row in visibleDatabaseRows" :key="row.id"><td v-for="field in visibleFields" :key="field.id">
          <v-checkbox v-if="field.type === 'CHECKBOX'" :model-value="Boolean(row.values[field.id])" hide-details density="compact" @update:model-value="updateDatabaseValue(row.id, field.id, $event)" />
          <v-select v-else-if="field.type === 'SELECT'" :model-value="row.values[field.id]" :items="field.options ?? []" variant="plain" hide-details @update:model-value="updateDatabaseValue(row.id, field.id, $event)" />
          <input v-else :type="field.type === 'DATE' ? 'date' : field.type === 'NUMBER' ? 'number' : 'text'" :value="databaseDisplayValue(row.values[field.id])" @input="updateDatabaseValue(row.id, field.id, ($event.target as HTMLInputElement).value)" />
        </td><td><v-btn :aria-label="`删除记录 ${rowTitle(row)}`" icon="mdi-delete-outline" variant="text" color="error" size="small" @click="removeRow(row.id)" /></td></tr></tbody>
      </table>
      <div v-if="!visibleDatabaseRows.length" class="database-empty"><v-icon>mdi-table-off</v-icon><p>{{ activeView.filter ? '没有符合筛选条件的记录' : '暂无记录' }}</p></div>
    </div>

    <div v-else-if="activeView.type === 'KANBAN'" class="kanban" data-testid="database-kanban-view">
      <section v-for="group in kanbanGroups" :key="group.name" class="kanban-column"><header><strong>{{ group.name }}</strong><v-chip size="x-small">{{ group.rows.length }}</v-chip></header><v-card v-for="row in group.rows" :key="row.id" class="mt-3 pa-3" variant="tonal"><strong>{{ rowTitle(row) }}</strong><small v-for="field in secondaryFields()" :key="field.id">{{ field.name }} · {{ databaseDisplayValue(row.values[field.id]) || '—' }}</small></v-card><p v-if="!group.rows.length" class="column-empty">暂无记录</p></section>
    </div>

    <div v-else-if="activeView.type === 'GALLERY'" class="database-gallery" data-testid="database-gallery-view">
      <v-card v-for="row in visibleDatabaseRows" :key="row.id" class="gallery-card" variant="outlined"><div class="gallery-cover"><v-icon size="40">mdi-card-text-outline</v-icon></div><div class="pa-4"><strong>{{ rowTitle(row) }}</strong><p v-for="field in secondaryFields()" :key="field.id">{{ field.name }}：{{ databaseDisplayValue(row.values[field.id]) || '—' }}</p></div></v-card>
      <div v-if="!visibleDatabaseRows.length" class="database-empty"><v-icon>mdi-view-grid-outline</v-icon><p>{{ activeView.filter ? '没有符合筛选条件的记录' : '暂无记录' }}</p></div>
    </div>

    <div v-else class="database-calendar" data-testid="database-calendar-view">
      <section v-for="group in calendarGroups" :key="group.day" class="calendar-day"><header><v-icon size="18">mdi-calendar-blank-outline</v-icon><strong>{{ group.day }}</strong><v-chip size="x-small">{{ group.rows.length }}</v-chip></header><div v-for="row in group.rows" :key="row.id" class="calendar-record">{{ rowTitle(row) }}</div></section>
      <div v-if="!visibleDatabaseRows.length" class="database-empty"><v-icon>mdi-calendar-remove-outline</v-icon><p>{{ activeView.filter ? '没有符合筛选条件的记录' : '暂无日历记录' }}</p></div>
    </div>

    <v-dialog v-model="fieldDialogOpen" max-width="420">
      <v-card class="field-dialog" rounded="lg">
        <v-card-title class="field-dialog-title">
          <span>新建字段</span>
          <v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭字段设置" @click="fieldDialogOpen = false" />
        </v-card-title>
        <v-card-text class="field-dialog-body">
          <v-text-field
            v-model="fieldName"
            data-testid="field-name"
            label="字段名称"
            placeholder="例如：负责人"
            maxlength="80"
            autofocus
            variant="outlined"
            density="comfortable"
            hide-details
            @keydown.enter.prevent="createField"
          />
          <v-select
            v-model="fieldType"
            data-testid="field-type"
            :items="fieldTypeItems"
            label="字段类型"
            variant="outlined"
            density="comfortable"
            hide-details
          >
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :prepend-icon="item.raw.icon" />
            </template>
          </v-select>
          <v-textarea
            v-if="fieldType === 'SELECT'"
            v-model="fieldOptionsText"
            data-testid="field-options"
            label="选项"
            placeholder="每行一个选项，也可使用逗号分隔"
            variant="outlined"
            density="comfortable"
            rows="3"
            auto-grow
            hide-details
          />
          <p v-if="fieldDialogError" class="field-dialog-error" role="alert">{{ fieldDialogError }}</p>
        </v-card-text>
        <v-card-actions class="field-dialog-actions">
          <v-spacer />
          <v-btn size="small" variant="text" @click="fieldDialogOpen = false">取消</v-btn>
          <v-btn data-testid="confirm-add-field" size="small" color="primary" variant="flat" :disabled="!fieldName.trim()" @click="createField">创建</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.structured-editor {
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f7f8fa;
  color: #262626;
}

.editor-control-bar {
  height: 42px !important;
  min-height: 42px !important;
  overflow-x: auto;
  overflow-y: hidden;
  border-bottom: 1px solid #e7e9e8;
  background: #fff !important;
  box-shadow: none !important;
  scrollbar-width: none;
}
.editor-control-bar::-webkit-scrollbar { display: none; }
.editor-control-bar :deep(.v-toolbar__content) {
  height: 42px !important;
  min-height: 42px !important;
  gap: 2px;
  padding: 0 8px;
}
.editor-control-bar :deep(.v-btn) {
  height: 30px;
  min-width: 30px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 400;
  letter-spacing: 0;
  text-transform: none;
}
.editor-control-bar :deep(.v-btn--icon) { width: 30px; }
.editor-control-bar :deep(.v-btn__overlay) { opacity: 0; }
.editor-control-bar :deep(.v-btn:hover) { background: #f1f2f2; }
.editor-control-bar :deep(.v-btn--disabled) { opacity: .38; }

.tool-segment {
  height: 32px;
  flex: 0 0 auto;
  gap: 1px;
  padding: 1px;
  border: 0;
  border-radius: 7px;
  background: #f5f5f5;
}
.tool-segment :deep(.v-btn) { padding-inline: 9px; }
.tool-segment :deep(.v-btn--active) {
  color: #2468f2;
  background: #fff;
  box-shadow: 0 1px 3px rgb(31 35 41 / 8%);
}
.tool-divider {
  height: 20px;
  align-self: center;
  margin: 0 6px;
  color: #e7e9e8;
  opacity: 1;
}
.tool-button { flex: 0 0 auto; }
.record-button {
  flex: 0 0 auto;
  margin-left: 2px;
  padding-inline: 10px;
}
.zoom-control {
  display: flex;
  height: 30px;
  align-items: center;
  flex: 0 0 auto;
  border: 1px solid #e7e9e8;
  border-radius: 7px;
  background: #fff;
}
.zoom-control span {
  min-width: 44px;
  color: #646a73;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.zoom-control :deep(.v-btn) { width: 28px; height: 28px; min-width: 28px; }

.board-canvas {
  position: relative;
  height: calc(100% - 42px);
  overflow: hidden;
  background-color: #f7f8fa;
  background-image: radial-gradient(#c9ced6 1px, transparent 1px);
  background-size: 20px 20px;
  touch-action: none;
}
.board-canvas.is-panning { cursor: grab; }
.board-canvas.is-panning:active { cursor: grabbing; }
.board-surface { position: absolute; top: 0; left: 0; width: 4000px; height: 2400px; transform-origin: 0 0; }
.board-item { position: absolute; border: 1px solid #cbd5e1; border-radius: 10px; box-shadow: 0 8px 20px #0f172a12; touch-action: none; }
.board-item.selected { outline: 2px solid #2468f2; outline-offset: 2px; }
.board-item.kind-ellipse { border-radius: 999px; }
.board-item.kind-text { border-color: transparent; box-shadow: none; }
.board-item textarea { width: 100%; height: 100%; border: 0; outline: 0; padding: 14px; resize: none; background: transparent; text-align: inherit; }
.board-arrow { overflow: visible; border: 0; box-shadow: none; }
.board-arrow line { stroke: #475569; stroke-width: 2; }
.board-arrow path { fill: #475569; }

.sheet-selection {
  display: inline-flex;
  width: 54px;
  height: 28px;
  align-items: center;
  justify-content: center;
  flex: 0 0 54px;
  border: 1px solid #e7e9e8;
  border-radius: 6px;
  color: #646a73;
  background: #fff;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.sheet-name {
  overflow: hidden;
  max-width: 180px;
  margin: 0 6px;
  color: #646a73;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-scroll { height: calc(100% - 84px); overflow: auto; }
.sheet-wrap table,
.database-wrap table { min-width: max-content; border-spacing: 0; border-collapse: separate; }
.sheet-wrap th,
.sheet-wrap td,
.database-wrap th,
.database-wrap td { border-right: 1px solid #e7e9e8; border-bottom: 1px solid #e7e9e8; background: #fff; }
.sheet-wrap th { position: sticky; top: 0; z-index: 2; min-width: 96px; height: 32px; color: #8a8f8d; background: #f7f8fa; font-size: 12px; font-weight: 500; }
.sheet-wrap tbody th { position: sticky; left: 0; z-index: 3; min-width: 42px; }
.sheet-wrap td.selected { box-shadow: inset 0 0 0 2px #2468f2; }
.sheet-wrap input { width: 96px; height: 34px; border: 0; outline: 0; padding: 5px 8px; background: transparent; color: inherit; font: inherit; text-align: inherit; }
.sheet-tabs { display: flex; height: 42px; align-items: center; overflow-x: auto; border-top: 1px solid #e7e9e8; padding: 0 8px; background: #fff; }
.sheet-tabs :deep(.v-btn) { height: 30px; border-radius: 6px; font-size: 12px; letter-spacing: 0; text-transform: none; }

.database-filter {
  width: 210px;
  max-width: 210px;
  flex: 0 0 210px;
}
.database-filter :deep(.v-field) {
  min-height: 30px;
  border-radius: 6px;
  background: #f5f5f5;
  box-shadow: none;
}
.database-filter :deep(.v-field__input) { min-height: 30px; padding-block: 0; font-size: 12px; }
.database-filter :deep(.v-field__prepend-inner) { padding-top: 3px; }
.database-table { height: calc(100% - 42px); overflow: auto; }
.database-wrap th { position: sticky; top: 0; z-index: 1; min-width: 180px; height: 46px; padding: 6px 12px; background: #f7f8fa; text-align: left; }
.database-wrap th small { display: block; color: #9aa0a8; font-size: 11px; font-weight: 400; }
.database-wrap td { padding: 0 10px; }
.database-wrap td input { width: 100%; min-height: 42px; border: 0; outline: 0; }
.database-empty { display: grid; min-height: 240px; place-content: center; justify-items: center; grid-column: 1/-1; color: #8a8f8d; }
.database-empty p { margin-top: 10px; }
.kanban { display: grid; height: calc(100% - 42px); grid-auto-columns: 280px; grid-auto-flow: column; gap: 16px; overflow: auto; padding: 20px; }
.kanban-column { border: 1px solid #e7e9e8; border-radius: 10px; padding: 14px; background: #f5f6f7; }
.kanban-column > header { display: flex; align-items: center; justify-content: space-between; }
.kanban-column small { display: block; margin-top: 7px; color: #646a73; }
.column-empty { padding: 28px 0; color: #9aa0a8; font-size: 13px; text-align: center; }
.database-gallery { display: grid; height: calc(100% - 42px); grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; overflow: auto; padding: 20px; }
.gallery-card { overflow: hidden; }
.gallery-cover { display: grid; height: 110px; place-content: center; color: #646a73; background: linear-gradient(135deg, #f1f5ff, #f7f8fa); }
.gallery-card p { margin: 8px 0 0; color: #646a73; font-size: 13px; }
.database-calendar { display: grid; height: calc(100% - 42px); align-content: start; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; overflow: auto; padding: 20px; }
.calendar-day { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 10px; background: #fff; }
.calendar-day > header { display: flex; align-items: center; gap: 8px; padding: 12px 14px; background: #f7f8fa; }
.calendar-day > header .v-chip { margin-left: auto; }
.calendar-record { border-top: 1px solid #eef0f2; padding: 12px 14px; }

.field-dialog { overflow: hidden; border: 1px solid #e7e9e8; box-shadow: 0 16px 48px rgb(31 35 41 / 16%) !important; }
.field-dialog-title { display: flex; height: 50px; align-items: center; justify-content: space-between; border-bottom: 1px solid #eef0f2; padding: 0 12px 0 18px; font-size: 16px; font-weight: 600; }
.field-dialog-body { display: grid; gap: 16px; padding: 20px 18px 14px !important; }
.field-dialog-error { margin: -6px 0 0; color: rgb(var(--v-theme-error)); font-size: 12px; }
.field-dialog-actions { border-top: 1px solid #eef0f2; padding: 10px 14px !important; }

@media (max-width: 800px) {
  .editor-control-bar :deep(.v-toolbar__content) { padding-inline: 4px; }
  .tool-segment :deep(.v-btn) { padding-inline: 7px; }
  .database-filter { width: 150px; max-width: 150px; flex-basis: 150px; }
  .kanban { grid-auto-columns: 240px; }
  .database-gallery,
  .database-calendar { grid-template-columns: 1fr; }
}
</style>
