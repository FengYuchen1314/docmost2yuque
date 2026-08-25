<script setup lang="ts">
import { computed } from 'vue'
import type { Page } from '../../src/types'
import ContentCardRenderer from './content-cards/ContentCardRenderer.vue'
import { normalizeContentCard } from './content-cards/contentCardModel'

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

const record = computed(() => isRecord(props.content) ? props.content : {})
const boardElements = computed(() => Array.isArray(record.value.elements)
  ? record.value.elements.filter(isRecord)
  : [])
const sheet = computed(() => {
  const sheets = Array.isArray(record.value.sheets) ? record.value.sheets.filter(isRecord) : []
  return sheets[0] ?? {}
})
const rows = computed(() => Array.isArray(sheet.value.rows) ? sheet.value.rows as unknown[][] : [])
const fields = computed(() => Array.isArray(record.value.fields) ? record.value.fields.filter(isRecord) : [])
const databaseRows = computed(() => Array.isArray(record.value.rows)
  ? record.value.rows.filter(isDatabaseRow)
  : [])

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isDatabaseRow(value: unknown): value is { id: string; values: Record<string, unknown> } {
  return isRecord(value) && typeof value.id === 'string' && isRecord(value.values)
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

    <div v-else-if="contentType === 'WHITEBOARD'" class="public-board">
      <div
        v-for="element in boardElements"
        :key="String(element.id)"
        class="public-board-item"
        :style="{
          left: `${Number(element.x) || 0}px`, top: `${Number(element.y) || 0}px`,
          width: `${Number(element.width) || 160}px`, height: `${Number(element.height) || 100}px`,
          background: String(element.color || '#fff'),
        }"
      >{{ element.text }}</div>
      <div v-if="!boardElements.length" class="empty-state"><p>空白板</p></div>
    </div>

    <div v-else-if="contentType === 'SPREADSHEET'" class="public-table">
      <table><tbody><tr v-for="(row, r) in rows" :key="r"><td v-for="(cell, c) in row" :key="c">{{ cell }}</td></tr></tbody></table>
      <div v-if="!rows.length" class="empty-state"><p>空电子表格</p></div>
    </div>

    <div v-else class="public-table">
      <table><thead><tr><th v-for="field in fields" :key="String(field.id)">{{ field.name }}</th></tr></thead>
        <tbody><tr v-for="row in databaseRows" :key="row.id"><td v-for="field in fields" :key="String(field.id)">{{ row.values[String(field.id)] }}</td></tr></tbody></table>
      <div v-if="!databaseRows.length" class="empty-state"><p>空数据表</p></div>
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
.public-board { position: relative; height: 520px; overflow: auto; border-radius: 16px; background-color: #f8fafc; background-image: radial-gradient(#cbd5e1 1px, transparent 1px); background-size: 20px 20px; }
.public-board-item { position: absolute; overflow: auto; border: 1px solid #cbd5e1; border-radius: 10px; padding: 14px; }
.public-table { overflow: auto; }
.public-table table { width: 100%; border-collapse: collapse; }
.public-table th, .public-table td { border: 1px solid #e2e8f0; padding: 10px; text-align: left; }
@media (max-width: 600px) {
  .reader-heading--1 { font-size: 1.75rem; }
  .reader-heading--2 { font-size: 1.35rem; }
}
</style>
