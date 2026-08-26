import type { Page, WorkbenchItem } from '../../src/types'

export const WORKBENCH_REASONS: Array<{ title: string; value: WorkbenchItem['reason'] }> = [
  { title: '最近编辑', value: 'EDITED' },
  { title: '最近浏览', value: 'VIEWED' },
  { title: '协作过', value: 'COLLABORATED' },
  { title: '收藏', value: 'FAVORITE' },
  { title: '我创建的', value: 'CREATED' },
]

export function normalizeWorkbenchReason(value: unknown): WorkbenchItem['reason'] {
  return WORKBENCH_REASONS.some((item) => item.value === value) ? value as WorkbenchItem['reason'] : 'EDITED'
}

export function deduplicateWorkbenchItems(items: WorkbenchItem[]) {
  return [...new Map(items.map((item) => [item.resourceId, item])).values()]
}

export function contentTypePresentation(type: Page['contentType']) {
  return ({
    DOCUMENT: { label: '文档', icon: 'mdi-file-document-outline', color: 'primary' },
    WHITEBOARD: { label: '白板', icon: 'mdi-drawing-box', color: 'deep-purple' },
    SPREADSHEET: { label: '电子表格', icon: 'mdi-table-large', color: 'green' },
    DATABASE: { label: '数据表', icon: 'mdi-database-outline', color: 'orange' },
  } as const)[type]
}

export function relativeTime(value: string, now = Date.now()) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.round((now - time) / 1_000))
  if (seconds < 45) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(value).toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}

export function quickNoteDocument(text: string) {
  const content: Array<Record<string, unknown>> = []
  let tasks: Array<Record<string, unknown>> = []
  const flushTasks = () => {
    if (!tasks.length) return
    content.push({ type: 'taskList', content: tasks })
    tasks = []
  }

  for (const line of text.split(/\r?\n/)) {
    const task = /^\s*- \[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      tasks.push({
        type: 'taskItem',
        attrs: { checked: task[1]!.toLowerCase() === 'x' },
        content: [{ type: 'paragraph', content: inlineContent(task[2]!) }],
      })
      continue
    }
    flushTasks()
    const image = /^\s*!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)\s*$/.exec(line)
    if (image) content.push({ type: 'image', attrs: { src: image[2], alt: image[1], title: null } })
    else content.push({ type: 'paragraph', content: inlineContent(line) })
  }
  flushTasks()
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', content: [] }] }
}

function inlineContent(value: string) {
  if (!value) return []
  const nodes: Array<Record<string, unknown>> = []
  const pattern = /(\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g
  let cursor = 0
  for (const match of value.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > cursor) nodes.push({ type: 'text', text: value.slice(cursor, index) })
    if (match[2]) nodes.push({ type: 'text', text: match[2], marks: [{ type: 'bold' }] })
    else if (match[3]) nodes.push({ type: 'text', text: match[3], marks: [{ type: 'italic' }] })
    else nodes.push({ type: 'text', text: match[4], marks: [{ type: 'link', attrs: { href: match[5], target: '_blank', rel: 'noopener noreferrer nofollow' } }] })
    cursor = index + match[0].length
  }
  if (cursor < value.length) nodes.push({ type: 'text', text: value.slice(cursor) })
  return nodes
}
