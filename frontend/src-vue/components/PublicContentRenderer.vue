<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Page } from '../../src/types'
import ContentCardRenderer from './content-cards/ContentCardRenderer.vue'
import { normalizeContentCard } from './content-cards/contentCardModel'
import {
  activeDatabaseView,
  databaseDisplayValue,
  databaseRowsForView,
  databaseViewLabel,
  normalizeBoard,
  normalizeDatabase,
  normalizeWorkbook,
  type DatabaseField,
  type DatabaseRow,
} from '../utils/structuredContent'

interface TextListItem { text: string; checked?: boolean }
type DocumentItem =
  | { key: string; kind: 'card'; card: unknown }
  | { key: string; kind: 'heading'; text: string; level: number }
  | { key: string; kind: 'quote' | 'paragraph'; text: string }
  | { key: string; kind: 'code'; text: string; language: string }
  | { key: string; kind: 'unordered-list' | 'ordered-list' | 'task-list'; items: TextListItem[] }
  | { key: string; kind: 'blank' }

const props = defineProps<{
  contentType: Page['contentType']
  content: unknown
  plainText: string
}>()

const publicBoard = computed(() => normalizeBoard(props.content))
const publicWorkbook = computed(() => normalizeWorkbook(props.content))
const selectedSheetId = ref('')
watch(publicWorkbook, (value) => {
  if (!value.sheets.some((sheet) => sheet.id === selectedSheetId.value)) selectedSheetId.value = value.activeSheetId
}, { immediate: true })
const publicSheet = computed(() => publicWorkbook.value.sheets.find((sheet) => sheet.id === selectedSheetId.value) ?? publicWorkbook.value.sheets[0]!)
const publicSheetRows = computed(() => {
  const query = publicSheet.value.filter.trim().toLocaleLowerCase()
  return publicSheet.value.rows.map((row, index) => ({ row, index })).filter(({ row, index }) =>
    !publicSheet.value.hiddenRows.includes(index) && (!query || row.some((cell) => cell.toLocaleLowerCase().includes(query))),
  )
})
const publicSheetColumns = computed(() => {
  const width = Math.max(1, ...publicSheet.value.rows.map((row) => row.length))
  return Array.from({ length: width }, (_, column) => column).filter((column) => !publicSheet.value.hiddenColumns.includes(column))
})

const publicDatabase = computed(() => normalizeDatabase(props.content))
const publicDatabaseView = computed(() => activeDatabaseView(publicDatabase.value))
const publicDatabaseFields = computed(() => {
  const ids = publicDatabaseView.value.visibleFieldIds
  if (!ids.length) return publicDatabase.value.fields
  return ids.map((id) => publicDatabase.value.fields.find((field) => field.id === id)).filter((field): field is DatabaseField => Boolean(field))
})
const publicDatabaseRows = computed(() => databaseRowsForView(publicDatabase.value, publicDatabaseView.value))
const publicDatabaseTitleField = computed(() => publicDatabaseFields.value[0] ?? publicDatabase.value.fields[0])
const publicKanbanField = computed(() => publicDatabase.value.fields.find((field) => field.id === publicDatabaseView.value.groupFieldId)
  ?? publicDatabase.value.fields.find((field) => field.type === 'SELECT'))
const publicKanbanGroups = computed(() => {
  const groups = new Map<string, DatabaseRow[]>()
  for (const option of publicKanbanField.value?.options ?? []) groups.set(option, [])
  for (const row of publicDatabaseRows.value) {
    const name = publicKanbanField.value
      ? databaseDisplayValue(row.values[publicKanbanField.value.id]).trim() || '未分组'
      : '未分组'
    groups.set(name, [...(groups.get(name) ?? []), row])
  }
  if (!groups.has('未分组')) groups.set('未分组', [])
  return [...groups.entries()].map(([name, rows]) => ({ name, rows }))
})
const publicCalendarField = computed(() => publicDatabase.value.fields.find((field) => field.id === publicDatabaseView.value.groupFieldId && field.type === 'DATE')
  ?? publicDatabase.value.fields.find((field) => field.type === 'DATE'))
const publicCalendarGroups = computed(() => {
  const groups = new Map<string, DatabaseRow[]>()
  for (const row of publicDatabaseRows.value) {
    const day = publicCalendarField.value
      ? databaseDisplayValue(row.values[publicCalendarField.value.id]).trim() || '未安排日期'
      : '未配置日期字段'
    groups.set(day, [...(groups.get(day) ?? []), row])
  }
  return [...groups.entries()].sort(([left], [right]) => left.localeCompare(right, 'zh-CN')).map(([day, rows]) => ({ day, rows }))
})

const documentItems = computed<DocumentItem[]>(() => {
  const structured = structuredDocument(props.content)
  return structured ?? parseTextDocument(props.plainText)
})

function structuredDocument(input: unknown): DocumentItem[] | null {
  const decoded = parseJsonValue(input)
  if (!containsCanonicalCard(decoded)) return null
  const keys = keyFactory()
  if (Array.isArray(decoded)) return decoded.flatMap((node) => structuredNode(node, keys))
  return structuredNode(decoded, keys)
}

function structuredNode(input: unknown, nextKey: (kind: string) => string): DocumentItem[] {
  if (!isRecord(input)) return []
  if (input.type === 'contentCard') return [{ key: nextKey('card'), kind: 'card', card: input }]

  const type = typeof input.type === 'string' ? input.type : ''
  const children = Array.isArray(input.content) ? input.content : []
  if (type === 'doc') return children.flatMap((child) => structuredNode(child, nextKey))

  if (type === 'heading') {
    const levelValue = isRecord(input.attrs) && typeof input.attrs.level === 'number' ? input.attrs.level : 2
    return [{ key: nextKey('heading'), kind: 'heading', text: nodeText(input), level: Math.min(6, Math.max(1, levelValue)) }]
  }
  if (type === 'blockquote') return [{ key: nextKey('quote'), kind: 'quote', text: nodeText(input) }]
  if (['codeBlock', 'code_block', 'code-block'].includes(type)) {
    const language = isRecord(input.attrs) && typeof input.attrs.language === 'string' ? input.attrs.language : ''
    return [{ key: nextKey('code'), kind: 'code', text: nodeText(input), language }]
  }
  if (['bulletList', 'bullet_list', 'orderedList', 'ordered_list', 'taskList', 'task_list'].includes(type)) {
    const task = type.toLowerCase().includes('task')
    const ordered = type.toLowerCase().includes('ordered')
    const items = children.map((child) => ({
      text: nodeText(child),
      ...(task ? { checked: isRecord(child) && isRecord(child.attrs) && child.attrs.checked === true } : {}),
    })).filter((item) => item.text)
    const cards = children.flatMap((child) => nestedCards(child, nextKey))
    const list: DocumentItem[] = items.length ? [{
      key: nextKey('list'),
      kind: task ? 'task-list' : ordered ? 'ordered-list' : 'unordered-list',
      items,
    }] : []
    return [...list, ...cards]
  }

  if (type === 'paragraph' || type === '') {
    if (containsCanonicalCard(children)) {
      const result: DocumentItem[] = []
      let buffered = ''
      const flush = () => {
        if (buffered) result.push(...parseTextDocument(buffered, nextKey))
        buffered = ''
      }
      for (const child of children) {
        if (isRecord(child) && child.type === 'contentCard') {
          flush()
          result.push({ key: nextKey('card'), kind: 'card', card: child })
        } else buffered += nodeText(child)
      }
      flush()
      return result.length ? result : [{ key: nextKey('blank'), kind: 'blank' }]
    }
    const text = nodeText(input)
    return text ? parseTextDocument(text, nextKey) : [{ key: nextKey('blank'), kind: 'blank' }]
  }

  const nested = children.flatMap((child) => structuredNode(child, nextKey))
  if (nested.length) return nested
  const text = nodeText(input)
  return text ? parseTextDocument(text, nextKey) : []
}

function nestedCards(input: unknown, nextKey: (kind: string) => string): DocumentItem[] {
  if (!isRecord(input)) return []
  if (input.type === 'contentCard') return [{ key: nextKey('card'), kind: 'card', card: input }]
  return Array.isArray(input.content) ? input.content.flatMap((child) => nestedCards(child, nextKey)) : []
}

function parseTextDocument(text: string, suppliedKeyFactory?: (kind: string) => string): DocumentItem[] {
  const nextKey = suppliedKeyFactory ?? keyFactory()
  const sourceLines = text.replace(/\r\n?/g, '\n').split('\n')
  const result: DocumentItem[] = []
  let codeLanguage = ''
  let codeLines: string[] | null = null

  const finishCode = () => {
    if (!codeLines) return
    result.push({ key: nextKey('code'), kind: 'code', text: codeLines.join('\n'), language: codeLanguage })
    codeLines = null
    codeLanguage = ''
  }

  for (const line of sourceLines) {
    const fence = /^\s*```\s*([^\s`]*)\s*$/.exec(line)
    if (codeLines) {
      if (fence) finishCode()
      else codeLines.push(line)
      continue
    }
    if (fence) {
      codeLanguage = fence[1] ?? ''
      codeLines = []
      continue
    }

    const card = cardLineValue(line)
    if (card !== null) {
      result.push({ key: nextKey('card'), kind: 'card', card })
      continue
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line)
    if (heading) {
      result.push({ key: nextKey('heading'), kind: 'heading', text: heading[2] ?? '', level: heading[1]?.length ?? 2 })
      continue
    }
    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      result.push({ key: nextKey('quote'), kind: 'quote', text: quote[1] ?? '' })
      continue
    }
    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      appendList(result, 'task-list', { text: task[2] ?? '', checked: task[1]?.toLowerCase() === 'x' }, nextKey)
      continue
    }
    const unordered = /^\s*[-*+]\s+(.+)$/.exec(line)
    if (unordered) {
      appendList(result, 'unordered-list', { text: unordered[1] ?? '' }, nextKey)
      continue
    }
    const ordered = /^\s*\d+[.)]\s+(.+)$/.exec(line)
    if (ordered) {
      appendList(result, 'ordered-list', { text: ordered[1] ?? '' }, nextKey)
      continue
    }
    result.push(line
      ? { key: nextKey('paragraph'), kind: 'paragraph', text: line }
      : { key: nextKey('blank'), kind: 'blank' })
  }
  finishCode()
  return result
}

function cardLineValue(line: string): unknown | null {
  const value = line.trim()
  if (!value) return null
  if (value.startsWith('{{card:')) return value
  if (!value.startsWith('{')) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!isRecord(parsed)) return null
    const normalized = normalizeContentCard(parsed)
    const explicitCardShape = parsed.type === 'contentCard'
      || typeof parsed.cardId === 'string'
      || typeof parsed.cardType === 'string'
      || typeof parsed.kind === 'string'
    return explicitCardShape || normalized.kind !== 'unknown' ? parsed : null
  } catch {
    const damagedCard = /"type"\s*:\s*"contentCard/i.test(value)
      || /"(?:cardId|cardType)"\s*:\s*"[^"}]*/i.test(value)
      || /"kind"\s*:\s*"(?:bookmark|code|attachment|image|video|iframe|callout|status|sensitive-text)/i.test(value)
    return damagedCard
      ? value
      : null
  }
}

function appendList(
  target: DocumentItem[],
  kind: 'unordered-list' | 'ordered-list' | 'task-list',
  item: TextListItem,
  nextKey: (kind: string) => string,
) {
  const previous = target[target.length - 1]
  if (previous?.kind === kind) previous.items.push(item)
  else target.push({ key: nextKey('list'), kind, items: [item] })
}

function containsCanonicalCard(input: unknown): boolean {
  if (Array.isArray(input)) return input.some(containsCanonicalCard)
  if (!isRecord(input)) return false
  if (input.type === 'contentCard') return true
  return Array.isArray(input.content) && input.content.some(containsCanonicalCard)
}

function nodeText(input: unknown): string {
  if (!isRecord(input) || input.type === 'contentCard') return ''
  if (typeof input.text === 'string') return input.text
  return Array.isArray(input.content) ? input.content.map(nodeText).join('') : ''
}

function parseJsonValue(input: unknown): unknown {
  if (typeof input !== 'string') return input
  const value = input.trim()
  if (!value.startsWith('{') && !value.startsWith('[')) return input
  try { return JSON.parse(value) as unknown } catch { return input }
}

function keyFactory() {
  let value = 0
  return (kind: string) => `${kind}-${value++}`
}

function publicSheetCellStyle(row: number, column: number): Record<string, string | number | undefined> {
  const style = publicSheet.value.styles[`${row}:${column}`] ?? {}
  return {
    fontWeight: style.bold ? 700 : undefined,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    textAlign: style.align?.toLowerCase(),
    color: style.color,
    background: style.background,
  }
}

function publicDatabaseRowTitle(row: DatabaseRow): string {
  const field = publicDatabaseTitleField.value
  return field ? databaseDisplayValue(row.values[field.id]) || '无标题记录' : '无标题记录'
}

function publicDatabaseSecondaryFields(): DatabaseField[] {
  return publicDatabaseFields.value.filter((field) => field.id !== publicDatabaseTitleField.value?.id).slice(0, 3)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
</script>

<template>
  <article class="public-content-renderer">
    <template v-if="contentType === 'DOCUMENT'">
      <template v-for="item in documentItems" :key="item.key">
        <ContentCardRenderer
          v-if="item.kind === 'card'"
          class="public-content-card"
          :card="item.card"
          :interactive="false"
          :allow-iframes="false"
        />
        <component
          :is="`h${item.level}`"
          v-else-if="item.kind === 'heading'"
          class="reader-heading"
          :class="`reader-heading--${item.level}`"
        >{{ item.text }}</component>
        <blockquote v-else-if="item.kind === 'quote'" class="public-quote">{{ item.text }}</blockquote>
        <pre v-else-if="item.kind === 'code'" class="public-code"><span v-if="item.language" class="public-code__language">{{ item.language }}</span><code>{{ item.text }}</code></pre>
        <ul v-else-if="item.kind === 'unordered-list'" class="public-list"><li v-for="(entry, index) in item.items" :key="index">{{ entry.text }}</li></ul>
        <ol v-else-if="item.kind === 'ordered-list'" class="public-list"><li v-for="(entry, index) in item.items" :key="index">{{ entry.text }}</li></ol>
        <ul v-else-if="item.kind === 'task-list'" class="public-list public-task-list">
          <li v-for="(entry, index) in item.items" :key="index" :class="{ 'public-task--done': entry.checked }">
            <span class="public-task__box" aria-hidden="true">{{ entry.checked ? '✓' : '' }}</span><span>{{ entry.text }}</span>
          </li>
        </ul>
        <p v-else-if="item.kind === 'paragraph'" class="reader-paragraph">{{ item.text }}</p>
        <div v-else class="reader-blank" aria-hidden="true" />
      </template>
    </template>

    <div v-else-if="contentType === 'WHITEBOARD'" class="public-board" data-testid="public-whiteboard">
      <div class="public-board-surface" :style="{ transform: `translate(${publicBoard.viewport.x}px, ${publicBoard.viewport.y}px) scale(${publicBoard.viewport.zoom})` }">
        <template v-for="element in publicBoard.elements" :key="element.id">
          <svg
            v-if="element.kind === 'ARROW'"
            class="public-board-item public-board-arrow"
            data-kind="ARROW"
            :style="{ left: `${element.x}px`, top: `${element.y}px`, width: `${element.width}px`, height: `${Math.max(24, element.height)}px` }"
            :aria-label="element.text || '箭头'"
          >
            <defs><marker :id="`public-arrow-${element.id}`" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L0,6 L7,3 z" /></marker></defs>
            <line x1="2" y1="12" :x2="Math.max(2, element.width - 9)" y2="12" :marker-end="`url(#public-arrow-${element.id})`" />
          </svg>
          <div
            v-else
            class="public-board-item"
            :class="`kind-${element.kind.toLowerCase()}`"
            :data-kind="element.kind"
            :style="{
              left: `${element.x}px`, top: `${element.y}px`, width: `${element.width}px`, height: `${element.height}px`,
              background: element.kind === 'TEXT' ? 'transparent' : element.color,
            }"
          >{{ element.text }}</div>
        </template>
      </div>
      <div v-if="!publicBoard.elements.length" class="empty-state"><p>空白板</p></div>
    </div>

    <div v-else-if="contentType === 'SPREADSHEET'" class="public-sheet" data-testid="public-spreadsheet">
      <header class="public-sheet-header"><strong>{{ publicSheet.name }}</strong><span>{{ publicSheetRows.length }} 行</span></header>
      <div v-if="publicSheet.rows.length" class="public-table public-sheet-table"><table><tbody><tr v-for="entry in publicSheetRows" :key="entry.index" :class="{ frozen: entry.index < publicSheet.frozenRows }"><td
        v-for="(column, visibleColumn) in publicSheetColumns"
        :key="column"
        :class="{ 'frozen-column': column < publicSheet.frozenColumns }"
        :style="{ ...publicSheetCellStyle(entry.index, column), left: column < publicSheet.frozenColumns ? `${visibleColumn * 110}px` : undefined }"
      >{{ entry.row[column] ?? '' }}</td></tr></tbody></table></div>
      <div v-else class="empty-state"><p>空电子表格</p></div>
      <nav v-if="publicWorkbook.sheets.length > 1" class="public-sheet-tabs" aria-label="工作表">
        <button v-for="sheetItem in publicWorkbook.sheets" :key="sheetItem.id" type="button" :class="{ active: sheetItem.id === publicSheet.id }" :data-sheet-id="sheetItem.id" @click="selectedSheetId = sheetItem.id">{{ sheetItem.name }}</button>
      </nav>
    </div>

    <div v-else class="public-database" :data-view="publicDatabaseView.type">
      <header class="public-database-header"><strong>{{ databaseViewLabel(publicDatabaseView.type) }}视图</strong><span>{{ publicDatabaseRows.length }} 条记录</span></header>
      <div v-if="publicDatabaseView.type === 'TABLE'" class="public-table" data-testid="public-database-table">
        <table><thead><tr><th v-for="field in publicDatabaseFields" :key="field.id">{{ field.name }}</th></tr></thead>
          <tbody><tr v-for="row in publicDatabaseRows" :key="row.id"><td v-for="field in publicDatabaseFields" :key="field.id">{{ databaseDisplayValue(row.values[field.id]) }}</td></tr></tbody></table>
        <div v-if="!publicDatabaseRows.length" class="empty-state"><p>{{ publicDatabaseView.filter ? '没有符合筛选条件的记录' : '空数据表' }}</p></div>
      </div>
      <div v-else-if="publicDatabaseView.type === 'KANBAN'" class="public-database-kanban" data-testid="public-database-kanban">
        <section v-for="group in publicKanbanGroups" :key="group.name"><header><strong>{{ group.name }}</strong><span>{{ group.rows.length }}</span></header><article v-for="row in group.rows" :key="row.id"><strong>{{ publicDatabaseRowTitle(row) }}</strong><small v-for="field in publicDatabaseSecondaryFields()" :key="field.id">{{ field.name }} · {{ databaseDisplayValue(row.values[field.id]) || '—' }}</small></article><p v-if="!group.rows.length">暂无记录</p></section>
      </div>
      <div v-else-if="publicDatabaseView.type === 'GALLERY'" class="public-database-gallery" data-testid="public-database-gallery">
        <article v-for="row in publicDatabaseRows" :key="row.id"><span aria-hidden="true">▣</span><strong>{{ publicDatabaseRowTitle(row) }}</strong><small v-for="field in publicDatabaseSecondaryFields()" :key="field.id">{{ field.name }} · {{ databaseDisplayValue(row.values[field.id]) || '—' }}</small></article><div v-if="!publicDatabaseRows.length" class="empty-state"><p>{{ publicDatabaseView.filter ? '没有符合筛选条件的记录' : '暂无记录' }}</p></div>
      </div>
      <div v-else class="public-database-calendar" data-testid="public-database-calendar">
        <section v-for="group in publicCalendarGroups" :key="group.day"><header><strong>{{ group.day }}</strong><span>{{ group.rows.length }}</span></header><div v-for="row in group.rows" :key="row.id">{{ publicDatabaseRowTitle(row) }}</div></section><div v-if="!publicDatabaseRows.length" class="empty-state"><p>{{ publicDatabaseView.filter ? '没有符合筛选条件的记录' : '暂无日历记录' }}</p></div>
      </div>
    </div>
  </article>
</template>

<style scoped>
.public-content-renderer { font-size: 17px; line-height: 1.85; }
.public-content-card { margin: 18px 0; font-size: 1rem; line-height: 1.5; }
.reader-heading { color: rgb(var(--v-theme-on-surface)); font-weight: 750; line-height: 1.35; }
.reader-heading--1 { margin: 2rem 0 .75rem; font-size: 2.125rem; }
.reader-heading--2 { margin: 1.75rem 0 .75rem; font-size: 1.5rem; }
.reader-heading--3 { margin: 1.5rem 0 .65rem; font-size: 1.25rem; }
.reader-heading--4, .reader-heading--5, .reader-heading--6 { margin: 1.25rem 0 .5rem; font-size: 1.05rem; }
.reader-paragraph { margin: 0 0 1.2em; white-space: pre-wrap; overflow-wrap: anywhere; }
.reader-blank { height: .85em; }
.public-quote { margin: 20px 0; border-left: 4px solid #2563eb; border-radius: 0 12px 12px 0; padding: 14px 20px; background: #eff6ff; white-space: pre-wrap; overflow-wrap: anywhere; }
.public-code { position: relative; max-width: 100%; margin: 20px 0; overflow: auto; border-radius: 12px; padding: 20px; background: #111827; color: #e5e7eb; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre; }
.public-code__language { display: block; margin: -8px 0 8px; color: #93c5fd; font-size: 11px; font-weight: 700; }
.public-list { margin: 0 0 1.15em; padding-left: 1.5em; }
.public-list li { margin: .22em 0; overflow-wrap: anywhere; }
.public-task-list { padding-left: 0; list-style: none; }
.public-task-list li { display: flex; align-items: flex-start; gap: 9px; }
.public-task__box { display: inline-flex; width: 19px; height: 19px; flex: 0 0 19px; align-items: center; justify-content: center; margin-top: 7px; border: 1.5px solid #94a3b8; border-radius: 5px; color: white; font-size: 12px; line-height: 1; }
.public-task--done { color: #64748b; text-decoration: line-through; }
.public-task--done .public-task__box { border-color: #16a34a; background: #16a34a; }
.public-board { position: relative; height: 520px; overflow: hidden; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #f8fafc; background-image: radial-gradient(#cbd5e1 1px, transparent 1px); background-size: 20px 20px; }
.public-board-surface { position: absolute; left: 0; top: 0; width: 4000px; height: 2400px; transform-origin: 0 0; }
.public-board-item { position: absolute; overflow: auto; box-sizing: border-box; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; white-space: pre-wrap; overflow-wrap: anywhere; box-shadow: 0 8px 20px #0f172a12; }
.public-board-item.kind-ellipse { display: grid; place-content: center; border-radius: 999px; text-align: center; }
.public-board-item.kind-rect { display: grid; place-content: center; text-align: center; }
.public-board-item.kind-text { border-color: transparent; padding: 4px; box-shadow: none; }
.public-board-arrow { overflow: visible; border: 0; padding: 0; box-shadow: none; }
.public-board-arrow line { stroke: #475569; stroke-width: 2; }
.public-board-arrow path { fill: #475569; }
.public-sheet, .public-database { overflow: hidden; border: 1px solid #e2e8f0; border-radius: 14px; background: white; }
.public-sheet-header, .public-database-header { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 16px; border-bottom: 1px solid #e2e8f0; background: #f8fafc; }
.public-sheet-header span, .public-database-header span { color: #64748b; font-size: 13px; }
.public-table { overflow: auto; }
.public-table table { width: 100%; border-collapse: collapse; }
.public-table th, .public-table td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
.public-sheet-table td { min-width: 110px; }
.public-sheet-table tr.frozen td { position: sticky; top: 0; z-index: 2; }
.public-sheet-table td.frozen-column { position: sticky; z-index: 1; }
.public-sheet-table tr.frozen td.frozen-column { z-index: 3; }
.public-sheet-tabs { display: flex; gap: 4px; overflow-x: auto; padding: 8px 12px; border-top: 1px solid #e2e8f0; }
.public-sheet-tabs button { border: 0; border-radius: 8px; padding: 7px 12px; background: transparent; color: #475569; cursor: pointer; }
.public-sheet-tabs button.active { background: #dbeafe; color: #1d4ed8; font-weight: 700; }
.public-database-kanban { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(220px, 280px); gap: 14px; overflow-x: auto; padding: 16px; background: #f8fafc; }
.public-database-kanban > section { border: 1px solid #e2e8f0; border-radius: 12px; padding: 12px; background: #f1f5f9; }
.public-database-kanban > section > header, .public-database-calendar section > header { display: flex; justify-content: space-between; gap: 10px; }
.public-database-kanban article { margin-top: 10px; border-radius: 10px; padding: 12px; background: white; box-shadow: 0 2px 8px #0f172a0a; }
.public-database-kanban small, .public-database-gallery small { display: block; margin-top: 5px; color: #64748b; font-size: 12px; }
.public-database-kanban section > p { color: #94a3b8; font-size: 13px; text-align: center; }
.public-database-gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); gap: 14px; padding: 16px; }
.public-database-gallery article { display: grid; gap: 6px; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; }
.public-database-gallery article > span { color: #64748b; font-size: 28px; }
.public-database-calendar { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 14px; padding: 16px; }
.public-database-calendar section { overflow: hidden; border: 1px solid #e2e8f0; border-radius: 12px; }
.public-database-calendar section > header { padding: 10px 12px; background: #f8fafc; }
.public-database-calendar section > div { padding: 10px 12px; border-top: 1px solid #eef2f7; }
.public-database .empty-state, .public-sheet .empty-state { min-height: 180px; display: grid; place-content: center; color: #64748b; }
@media (max-width: 600px) {
  .reader-heading--1 { font-size: 1.75rem; }
  .reader-heading--2 { font-size: 1.35rem; }
  .public-board { height: 420px; }
  .public-database-gallery, .public-database-calendar { grid-template-columns: 1fr; }
}
</style>
