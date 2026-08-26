import type { ContentCardNode } from '../types/content-card'
import { createContentCardNode, encodeContentCardToken, normalizeContentCard } from '../components/content-cards/contentCardModel'

type JsonRecord = Record<string, unknown>

const EDITABLE_NODE_TYPES = new Set([
  'doc', 'paragraph', 'text', 'hardBreak', 'heading', 'blockquote',
  'codeBlock', 'code_block', 'code-block', 'bulletList', 'bullet_list',
  'orderedList', 'ordered_list', 'taskList', 'task_list', 'listItem',
  'list_item', 'taskItem', 'task_item', 'contentCard',
])
const EDITABLE_MARK_TYPES = new Set(['bold', 'strong', 'italic', 'em', 'strike', 'code', 'link'])

export function documentToMarkdown(content: unknown, fallback = ''): string {
  const decoded = parseJsonValue(content)
  if (!isRecord(decoded) || decoded.type !== 'doc' || !Array.isArray(decoded.content)) return fallback
  return decoded.content.map(blockToMarkdown).join('\n')
}

export function markdownToDocument(source: string): JsonRecord {
  const lines = source.replace(/\r\n?/g, '\n').split('\n')
  const content: JsonRecord[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const fence = /^\s*```\s*([^\s`]*)\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      index += 1
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      content.push({ type: 'codeBlock', attrs: { language: fence[1] ?? '' }, text: body.join('\n') })
      continue
    }

    const card = contentCardFromLine(line)
    if (card) {
      content.push(card)
      index += 1
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      content.push(textBlock('heading', heading[2] ?? '', { level: heading[1]?.length ?? 2 }))
      index += 1
      continue
    }

    const quote = /^\s*>\s?(.*)$/.exec(line)
    if (quote) {
      content.push({ type: 'blockquote', content: [textBlock('paragraph', quote[1] ?? '')] })
      index += 1
      continue
    }

    const task = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      appendList(content, 'taskList', {
        type: 'taskItem',
        attrs: { checked: task[1]?.toLocaleLowerCase() === 'x' },
        content: [textBlock('paragraph', task[2] ?? '')],
      })
      index += 1
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      appendList(content, 'bulletList', { type: 'listItem', content: [textBlock('paragraph', bullet[1] ?? '')] })
      index += 1
      continue
    }

    const ordered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (ordered) {
      appendList(content, 'orderedList', { type: 'listItem', content: [textBlock('paragraph', ordered[1] ?? '')] })
      index += 1
      continue
    }

    content.push(textBlock('paragraph', line))
    index += 1
  }
  return { type: 'doc', content: content.length ? content : [textBlock('paragraph', '')] }
}

export function isPlainTextDocument(content: unknown): boolean {
  const decoded = parseJsonValue(content)
  if (!isRecord(decoded) || decoded.type !== 'doc' || !Array.isArray(decoded.content)) return false
  if (decoded.content.length === 0) return true
  if (decoded.content.length !== 1) return false
  const paragraph = decoded.content[0]
  if (!isRecord(paragraph) || paragraph.type !== 'paragraph') return false
  if (typeof paragraph.text === 'string') return true
  if (!Array.isArray(paragraph.content)) return false
  return paragraph.content.every((child) => isRecord(child)
    && child.type === 'text'
    && typeof child.text === 'string'
    && (!Array.isArray(child.marks) || child.marks.length === 0))
}

export function isEditableDocument(content: unknown): boolean {
  const decoded = parseJsonValue(content)
  if (!isRecord(decoded) || decoded.type !== 'doc' || !editableNode(decoded)) return false
  try {
    return structurallyEqual(decoded, markdownToDocument(documentToMarkdown(decoded)))
  } catch {
    return false
  }
}

function editableNode(node: unknown): boolean {
  if (!isRecord(node)) return false
  if (!Object.keys(node).every((key) => ['type', 'attrs', 'content', 'text', 'marks'].includes(key))) return false
  const type = typeof node.type === 'string' ? node.type : ''
  if (!EDITABLE_NODE_TYPES.has(type)) return false
  if (!editableNodeAttributes(type, node.attrs)) return false
  if (!editableNodeShape(type, node)) return false
  if (type !== 'text' && Array.isArray(node.marks) && node.marks.length > 0) return false
  if (Array.isArray(node.marks) && node.marks.some((mark) => !editableMark(mark))) return false
  return !Array.isArray(node.content) || node.content.every(editableNode)
}

function editableNodeShape(type: string, node: JsonRecord): boolean {
  const children = Array.isArray(node.content) ? node.content : null
  const childTypes = children?.map((child) => isRecord(child) ? String(child.type ?? '') : '') ?? []
  const hasLegacyText = typeof node.text === 'string'
  if (hasLegacyText && children) return false
  if (type === 'doc') {
    return !hasLegacyText && Boolean(children)
      && childTypes.every((childType) => [
        'paragraph', 'heading', 'blockquote', 'codeBlock', 'code_block', 'code-block',
        'bulletList', 'bullet_list', 'orderedList', 'ordered_list', 'taskList', 'task_list',
        'contentCard',
      ].includes(childType))
  }
  if (type === 'paragraph' || type === 'heading') {
    return hasLegacyText || !children || childTypes.every((childType) => ['text', 'hardBreak', 'contentCard'].includes(childType))
  }
  if (type === 'blockquote') return !hasLegacyText && Boolean(children?.length === 1) && childTypes[0] === 'paragraph'
  if (['codeBlock', 'code_block', 'code-block'].includes(type)) {
    return hasLegacyText || !children || childTypes.every((childType) => ['text', 'hardBreak'].includes(childType))
  }
  if (['bulletList', 'bullet_list', 'orderedList', 'ordered_list'].includes(type)) {
    return !hasLegacyText && Boolean(children) && childTypes.every((childType) => ['listItem', 'list_item'].includes(childType))
  }
  if (['taskList', 'task_list'].includes(type)) {
    return !hasLegacyText && Boolean(children) && childTypes.every((childType) => ['taskItem', 'task_item'].includes(childType))
  }
  if (['listItem', 'list_item', 'taskItem', 'task_item'].includes(type)) {
    return !hasLegacyText && Boolean(children?.length === 1) && childTypes[0] === 'paragraph'
  }
  if (type === 'text') return hasLegacyText && !children
  if (type === 'hardBreak' || type === 'contentCard') return !hasLegacyText && !children
  return false
}

function editableNodeAttributes(type: string, value: unknown): boolean {
  if (value == null) return true
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  if (type === 'heading') return keys.every((key) => key === 'level') && typeof value.level === 'number'
  if (['codeBlock', 'code_block', 'code-block'].includes(type)) {
    return keys.every((key) => key === 'language') && (value.language == null || typeof value.language === 'string')
  }
  if (['taskItem', 'task_item'].includes(type)) {
    return keys.every((key) => key === 'checked') && (value.checked == null || typeof value.checked === 'boolean')
  }
  if (type === 'contentCard') {
    return keys.every((key) => ['cardId', 'instanceId', 'version', 'data'].includes(key))
      && normalizeContentCard({ type: 'contentCard', attrs: value }).valid
  }
  return keys.length === 0
}

function editableMark(value: unknown): boolean {
  if (!isRecord(value)) return false
  if (!Object.keys(value).every((key) => key === 'type' || key === 'attrs')) return false
  const type = String(value.type ?? '')
  if (!EDITABLE_MARK_TYPES.has(type)) return false
  if (value.attrs == null) return true
  if (!isRecord(value.attrs)) return false
  const keys = Object.keys(value.attrs)
  return type === 'link'
    && keys.every((key) => key === 'href')
    && typeof value.attrs.href === 'string'
}

function blockToMarkdown(value: unknown): string {
  if (!isRecord(value)) return ''
  const type = String(value.type ?? '')
  if (type === 'contentCard') return contentCardToken(value)
  if (type === 'heading') {
    const level = isRecord(value.attrs) && typeof value.attrs.level === 'number' ? Math.min(6, Math.max(1, value.attrs.level)) : 2
    return `${'#'.repeat(level)} ${inlineMarkdown(value)}`
  }
  if (type === 'blockquote') return inlineMarkdown(value).split('\n').map((line) => `> ${line}`).join('\n')
  if (['codeBlock', 'code_block', 'code-block'].includes(type)) {
    const language = isRecord(value.attrs) && typeof value.attrs.language === 'string' ? value.attrs.language : ''
    return `\`\`\`${language}\n${nodeText(value)}\n\`\`\``
  }
  if (['bulletList', 'bullet_list', 'orderedList', 'ordered_list', 'taskList', 'task_list'].includes(type)) {
    const children = Array.isArray(value.content) ? value.content : []
    const ordered = type.toLocaleLowerCase().includes('ordered')
    const task = type.toLocaleLowerCase().includes('task')
    return children.map((child, index) => {
      const checked = isRecord(child) && isRecord(child.attrs) && child.attrs.checked === true
      const marker = task ? `- [${checked ? 'x' : ' '}] ` : ordered ? `${index + 1}. ` : '- '
      return `${marker}${inlineMarkdown(child)}`
    }).join('\n')
  }
  if (type === 'doc') return (Array.isArray(value.content) ? value.content : []).map(blockToMarkdown).join('\n')
  return inlineMarkdown(value)
}

function inlineMarkdown(value: unknown): string {
  if (!isRecord(value)) return ''
  if (value.type === 'contentCard') return contentCardToken(value)
  if (value.type === 'hardBreak') return '\n'
  if (typeof value.text === 'string') return applyMarks(value.text, Array.isArray(value.marks) ? value.marks : [])
  return (Array.isArray(value.content) ? value.content : []).map(inlineMarkdown).join('')
}

function applyMarks(text: string, marks: unknown[]): string {
  let result = text
  for (const value of marks) {
    if (!isRecord(value)) continue
    const type = String(value.type ?? '')
    if (type === 'bold' || type === 'strong') result = `**${result}**`
    else if (type === 'italic' || type === 'em') result = `*${result}*`
    else if (type === 'strike') result = `~~${result}~~`
    else if (type === 'code') result = `\`${result}\``
    else if (type === 'link' && isRecord(value.attrs) && typeof value.attrs.href === 'string') result = `[${result}](${value.attrs.href})`
  }
  return result
}

function textBlock(type: string, text: string, attrs?: JsonRecord): JsonRecord {
  const inline = inlineNodes(text)
  return {
    type,
    ...(attrs ? { attrs } : {}),
    ...(inline ? { content: inline } : { text }),
  }
}

function inlineNodes(text: string): JsonRecord[] | null {
  const pattern = /(\*\*([^*]+)\*\*|~~([^~]+)~~|`([^`]+)`|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\))/g
  const nodes: JsonRecord[] = []
  let cursor = 0
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push({ type: 'text', text: text.slice(cursor, match.index) })
    const whole = match[0]
    if (match[2] != null) nodes.push(markedText(match[2], 'bold'))
    else if (match[3] != null) nodes.push(markedText(match[3], 'strike'))
    else if (match[4] != null) nodes.push(markedText(match[4], 'code'))
    else if (match[5] != null) nodes.push(markedText(match[5], 'italic'))
    else if (match[6] != null) nodes.push({ type: 'text', text: match[6], marks: [{ type: 'link', attrs: { href: match[7] ?? '' } }] })
    else nodes.push({ type: 'text', text: whole })
    cursor = match.index + whole.length
  }
  if (!nodes.length) return null
  if (cursor < text.length) nodes.push({ type: 'text', text: text.slice(cursor) })
  return nodes
}

function markedText(text: string, type: string): JsonRecord {
  return { type: 'text', text, marks: [{ type }] }
}

function appendList(content: JsonRecord[], type: string, item: JsonRecord) {
  const previous = content.at(-1)
  if (isRecord(previous) && previous.type === type && Array.isArray(previous.content)) previous.content.push(item)
  else content.push({ type, content: [item] })
}

function contentCardFromLine(line: string): JsonRecord | null {
  const value = line.trim()
  if (!value) return null
  if (value.startsWith('{{card:')) {
    const normalized = normalizeContentCard(value)
    if (!normalized.valid || normalized.source !== 'token') return null
    return createContentCardNode(normalized.cardId, normalized.data, {
      instanceId: normalized.instanceId,
      version: normalized.version,
    }) as unknown as JsonRecord
  }
  if (!value.startsWith('{')) return null
  try {
    const decoded: unknown = JSON.parse(value)
    return isRecord(decoded) && decoded.type === 'contentCard' ? decoded : null
  } catch {
    return null
  }
}

function contentCardToken(value: JsonRecord): string {
  try {
    return encodeContentCardToken(value as unknown as ContentCardNode)
  } catch {
    return JSON.stringify(value)
  }
}

function nodeText(value: unknown): string {
  if (!isRecord(value) || value.type === 'contentCard') return ''
  if (typeof value.text === 'string') return value.text
  return (Array.isArray(value.content) ? value.content : []).map(nodeText).join('')
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const source = value.trim()
  if (!source.startsWith('{') && !source.startsWith('[')) return value
  try { return JSON.parse(source) as unknown } catch { return value }
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (isEmptyDocument(left) && isEmptyDocument(right)) return true
  if (isEmptyParagraph(left) && isEmptyParagraph(right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => structurallyEqual(value, right[index]))
  }
  if (!isRecord(left) || !isRecord(right)) return false
  const leftKeys = Object.keys(left).sort()
  const rightKeys = Object.keys(right).sort()
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && structurallyEqual(left[key], right[key]))
}

function isEmptyDocument(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'doc' || !Array.isArray(value.content)) return false
  return value.content.length === 0 || (value.content.length === 1 && isEmptyParagraph(value.content[0]))
}

function isEmptyParagraph(value: unknown): boolean {
  if (!isRecord(value) || value.type !== 'paragraph') return false
  const keys = Object.keys(value)
  if (!keys.every((key) => ['type', 'attrs', 'content', 'text', 'marks'].includes(key))) return false
  if (isRecord(value.attrs) && Object.keys(value.attrs).length > 0) return false
  if (Array.isArray(value.marks) && value.marks.length > 0) return false
  const emptyText = value.text == null || value.text === ''
  const emptyContent = value.content == null || (Array.isArray(value.content) && value.content.length === 0)
  return emptyText && emptyContent
}
