<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { DocumentSettings } from '../../../src/types'

type BlockKind = 'PARAGRAPH' | 'H1' | 'H2' | 'QUOTE' | 'BULLET' | 'NUMBERED' | 'TODO' | 'CODE'
type CodeStyle = 'FENCED' | 'INLINE' | null

interface EditorBlock {
  kind: BlockKind
  content: string
  indent: string
  marker: string
  checked: boolean
  codeStyle: CodeStyle
  codeLanguage: string
  codeClosed: boolean
}

interface FocusRequest {
  index: number
  position: number
}

interface SlashState {
  index: number
  start: number
  end: number
  query: string
}

interface LinkRequest {
  index: number
  start: number
  end: number
  label: string
}

interface CommandDefinition {
  kind: BlockKind
  title: string
  description: string
  icon: string
  keywords: string
}

const props = withDefaults(defineProps<{
  modelValue: string
  documentSettings?: DocumentSettings | Record<string, unknown> | null
  readonly?: boolean
  placeholder?: string
  showOutline?: boolean
  title?: string
}>(), {
  documentSettings: undefined,
  readonly: false,
  placeholder: '输入 / 唤起命令，或直接开始写作…',
  showOutline: undefined,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:title': [value: string]
  blur: []
  slash: [context: { blockIndex: number; query: string }]
  'selection-change': [start: number, end: number]
}>()

const commands: CommandDefinition[] = [
  { kind: 'PARAGRAPH', title: '正文', description: '普通文本段落', icon: 'mdi-format-paragraph', keywords: 'paragraph text zhengwen duanluo' },
  { kind: 'H1', title: '标题 1', description: '页面内的主标题', icon: 'mdi-format-header-1', keywords: 'heading title h1 biaoti' },
  { kind: 'H2', title: '标题 2', description: '页面内的二级标题', icon: 'mdi-format-header-2', keywords: 'heading title h2 biaoti' },
  { kind: 'QUOTE', title: '引用', description: '突出显示引用内容', icon: 'mdi-format-quote-close', keywords: 'quote yinyong' },
  { kind: 'BULLET', title: '无序列表', description: '创建项目符号列表', icon: 'mdi-format-list-bulleted', keywords: 'bullet list unordered liebiao' },
  { kind: 'NUMBERED', title: '有序列表', description: '创建编号列表', icon: 'mdi-format-list-numbered', keywords: 'number ordered list youxu liebiao' },
  { kind: 'TODO', title: '待办', description: '创建可勾选的任务', icon: 'mdi-checkbox-marked-outline', keywords: 'todo task checkbox daiban' },
  { kind: 'CODE', title: '代码块', description: '保留缩进与换行', icon: 'mdi-code-braces-box', keywords: 'code daima' },
]

const source = ref(props.modelValue)
const activeIndex = ref(0)
const selectedIndices = ref<number[]>([])
const selectionAnchor = ref<number | null>(null)
const draggingIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const slashState = ref<SlashState | null>(null)
const slashSelection = ref(0)
const outlineOpen = ref(true)
const linkRequest = ref<LinkRequest | null>(null)
const linkLabel = ref('')
const linkUrl = ref('')
const linkError = ref('')
const editorRefs = ref<Array<HTMLTextAreaElement | null>>([])
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
let lastHistory: { key: string; at: number } | null = null

const blocks = computed(() => parseMarkdown(source.value))
const activeBlock = computed(() => blocks.value[clampIndex(activeIndex.value, blocks.value.length)] ?? emptyBlock())
const targetIndices = computed(() => {
  const sourceIndices = selectedIndices.value.length ? selectedIndices.value : [clampIndex(activeIndex.value, blocks.value.length)]
  return [...new Set(sourceIndices)].filter((index) => index >= 0 && index < blocks.value.length).sort((left, right) => left - right)
})
const headings = computed(() => blocks.value.flatMap((block, index) => {
  if ((block.kind !== 'H1' && block.kind !== 'H2') || !block.content.trim()) return []
  return [{ index, kind: block.kind, text: stripInlineMarkdown(block.content.trim()) }]
}))
const settings = computed(() => normalizeSettings(props.documentSettings))
const outlineEnabled = computed(() => props.showOutline ?? settings.value.showOutline)
const editorClasses = computed(() => [
  `document-width-${settings.value.pageWidth.toLowerCase()}`,
  `document-font-${settings.value.fontFamily.toLowerCase()}`,
  `document-size-${settings.value.fontSize.toLowerCase()}`,
  `document-spacing-${settings.value.paragraphSpacing.toLowerCase()}`,
])
const kindItems = computed(() => commands.map(({ kind, title, icon }) => ({ value: kind, title, prependIcon: icon })))
const filteredCommands = computed(() => {
  const query = slashState.value?.query.trim().toLocaleLowerCase() ?? ''
  if (!query) return commands
  return commands.filter((command) => `${command.title} ${command.description} ${command.keywords}`.toLocaleLowerCase().includes(query))
})
const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

watch(() => props.modelValue, (value) => {
  if (value === source.value) return
  source.value = value
  undoStack.value = []
  redoStack.value = []
  lastHistory = null
  closeSlash()
  nextTick(() => {
    activeIndex.value = clampIndex(activeIndex.value, blocks.value.length)
    selectedIndices.value = selectedIndices.value.filter((index) => index < blocks.value.length)
    resizeAll()
  })
})

watch(source, () => nextTick(resizeAll))
watch(filteredCommands, (items) => {
  slashSelection.value = Math.min(slashSelection.value, Math.max(0, items.length - 1))
})

onMounted(resizeAll)

function cloneBlocks() {
  return blocks.value.map((block) => ({ ...block }))
}

function commit(nextBlocks: EditorBlock[], focus?: FocusRequest, historyKey = 'structure') {
  if (props.readonly) return
  const serialized = serializeMarkdown(nextBlocks)
  const current = source.value
  if (serialized === current) {
    if (focus) scheduleFocus(focus)
    return
  }
  const now = Date.now()
  if (historyKey === 'structure' || lastHistory?.key !== historyKey || now - lastHistory.at > 700) {
    undoStack.value = [...undoStack.value, current].slice(-100)
  }
  redoStack.value = []
  lastHistory = { key: historyKey, at: now }
  source.value = serialized
  emit('update:modelValue', serialized)
  if (focus) scheduleFocus(focus)
}

function restoreHistory(value: string, destination: 'UNDO' | 'REDO') {
  const current = source.value
  source.value = value
  emit('update:modelValue', value)
  lastHistory = null
  closeSlash()
  selectedIndices.value = []
  if (destination === 'UNDO') redoStack.value = [...redoStack.value, current].slice(-100)
  else undoStack.value = [...undoStack.value, current].slice(-100)
  scheduleFocus({ index: clampIndex(activeIndex.value, parseMarkdown(value).length), position: 0 })
}

function undo() {
  if (props.readonly) return
  const previous = undoStack.value.at(-1)
  if (previous == null) return
  undoStack.value = undoStack.value.slice(0, -1)
  restoreHistory(previous, 'UNDO')
}

function redo() {
  if (props.readonly) return
  const next = redoStack.value.at(-1)
  if (next == null) return
  redoStack.value = redoStack.value.slice(0, -1)
  restoreHistory(next, 'REDO')
}

function setKindFromValue(value: unknown) {
  if (isBlockKind(value)) setKind(value)
}

function onTitleInput(event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  const value = textarea.value.replace(/[\r\n]+/g, ' ')
  if (textarea.value !== value) textarea.value = value
  emit('update:title', value)
}

function onTitleKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter') return
  event.preventDefault()
  scheduleFocus({ index: 0, position: 0 })
}

function setKind(kind: BlockKind, explicitIndices = targetIndices.value) {
  if (props.readonly || !explicitIndices.length) return
  const next = cloneBlocks()
  for (const index of explicitIndices) {
    const current = next[index]
    if (!current) continue
    next[index] = convertKind(current, kind, index)
  }
  const focusIndex = clampIndex(activeIndex.value, next.length)
  const focusBlock = next[focusIndex]
  commit(next, explicitIndices.length === 1 ? { index: focusIndex, position: focusBlock?.content.length ?? 0 } : undefined)
}

function onBlockInput(index: number, event: Event) {
  const textarea = event.target as HTMLTextAreaElement
  const text = textarea.value
  const current = blocks.value[index]
  if (!current) return

  if (current.kind !== 'CODE' && text.includes('\n')) {
    replaceWithMultiline(index, text, textarea.selectionStart)
    return
  }

  const shortcut = current.kind === 'PARAGRAPH' ? markdownShortcut(text) : null
  if (shortcut && textarea.selectionStart === text.length) {
    const next = cloneBlocks()
    next[index] = convertKind({ ...current, content: '' }, shortcut, index)
    commit(next, { index, position: 0 })
    return
  }

  const next = cloneBlocks()
  const updated = { ...current, content: text }
  if (updated.kind === 'CODE' && text.includes('\n')) {
    updated.codeStyle = 'FENCED'
    updated.codeClosed = true
  }
  next[index] = updated
  commit(next, undefined, `typing-${index}`)
  resize(textarea)
  updateSlash(index, text, textarea.selectionStart)
}

function replaceWithMultiline(index: number, text: string, caret: number) {
  const current = blocks.value[index]
  if (!current) return
  const normalized = text.replace(/\r\n?/g, '\n')
  const prefix = sourcePrefix(current)
  const parsed = parseMarkdown(`${prefix}${normalized}`)
  const next = cloneBlocks()
  next.splice(index, 1, ...parsed)
  const beforeCaret = normalized.slice(0, caret)
  const relativeIndex = beforeCaret.split('\n').length - 1
  const focusIndex = index + Math.min(relativeIndex, parsed.length - 1)
  const position = beforeCaret.slice(beforeCaret.lastIndexOf('\n') + 1).length
  activeIndex.value = focusIndex
  selectedIndices.value = []
  selectionAnchor.value = null
  closeSlash()
  commit(next, { index: focusIndex, position }, `typing-${index}`)
}

function onPaste(index: number, event: ClipboardEvent) {
  if (props.readonly) return
  const current = blocks.value[index]
  const textarea = event.currentTarget as HTMLTextAreaElement
  const pasted = event.clipboardData?.getData('text/plain')?.replace(/\r\n?/g, '\n') ?? ''
  if (!current || !pasted.includes('\n')) return
  event.preventDefault()

  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  if (current.kind === 'CODE') {
    const next = cloneBlocks()
    next[index] = {
      ...current,
      content: current.content.slice(0, start) + pasted + current.content.slice(end),
      codeStyle: 'FENCED',
      codeClosed: true,
    }
    commit(next, { index, position: start + pasted.length })
    return
  }

  const replacementSource = `${sourcePrefix(current)}${current.content.slice(0, start)}${pasted}${current.content.slice(end)}`
  const replacement = parseMarkdown(replacementSource)
  const next = cloneBlocks()
  next.splice(index, 1, ...replacement)
  const pastedLines = pasted.split('\n')
  const focusIndex = index + replacement.length - 1
  const tailLength = current.content.length - end
  const position = (pastedLines.at(-1)?.length ?? 0) + tailLength
  activeIndex.value = focusIndex
  selectedIndices.value = []
  selectionAnchor.value = null
  closeSlash()
  commit(next, { index: focusIndex, position })
}

function onEditorKeydown(index: number, event: KeyboardEvent) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  const current = blocks.value[index]
  if (!current) return

  if (slashState.value?.index === index) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (filteredCommands.value.length) slashSelection.value = (slashSelection.value + 1) % filteredCommands.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (filteredCommands.value.length) slashSelection.value = (slashSelection.value - 1 + filteredCommands.value.length) % filteredCommands.value.length
      return
    }
    if (event.key === 'Enter' && filteredCommands.value.length) {
      event.preventDefault()
      const command = filteredCommands.value[slashSelection.value]
      if (command) chooseSlashCommand(command.kind)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeSlash()
      return
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'y') {
    event.preventDefault()
    redo()
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'b') {
    event.preventDefault()
    formatSelection('**')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'i') {
    event.preventDefault()
    formatSelection('*')
    return
  }
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault()
    openLinkDialog(index)
    return
  }
  if (event.altKey && event.key === 'ArrowUp') {
    event.preventDefault()
    moveSelected(-1)
    return
  }
  if (event.altKey && event.key === 'ArrowDown') {
    event.preventDefault()
    moveSelected(1)
    return
  }
  if (event.key === 'Tab') {
    event.preventDefault()
    indentSelected(event.shiftKey ? -1 : 1, { index, position: textarea.selectionStart })
    return
  }
  if (event.key === 'Enter' && current.kind !== 'CODE' && !event.shiftKey) {
    event.preventDefault()
    splitBlock(index, textarea.selectionStart, textarea.selectionEnd)
    return
  }
  if (event.key === 'Backspace' && textarea.selectionStart === 0 && textarea.selectionEnd === 0) {
    if (!current.content && current.kind !== 'PARAGRAPH') {
      event.preventDefault()
      setKind('PARAGRAPH', [index])
      return
    }
    if (index > 0) {
      event.preventDefault()
      mergePrevious(index)
    }
  }
}

function splitBlock(index: number, start: number, end: number) {
  const current = blocks.value[index]
  if (!current) return
  if (!current.content && current.kind !== 'PARAGRAPH') {
    setKind('PARAGRAPH', [index])
    return
  }
  const next = cloneBlocks()
  const before = { ...current, content: current.content.slice(0, start) }
  const after = continuationBlock(current, index + 1)
  after.content = current.content.slice(end)
  next.splice(index, 1, before, after)
  activeIndex.value = index + 1
  selectedIndices.value = []
  selectionAnchor.value = null
  closeSlash()
  commit(next, { index: index + 1, position: 0 })
}

function mergePrevious(index: number) {
  const current = blocks.value[index]
  const previous = blocks.value[index - 1]
  if (!current || !previous) return
  const next = cloneBlocks()
  const joiner = previous.kind === 'CODE' || current.kind === 'CODE' ? '\n' : ''
  const merged = { ...previous, content: previous.content + joiner + current.content }
  if (merged.kind === 'CODE' && merged.content.includes('\n')) {
    merged.codeStyle = 'FENCED'
    merged.codeClosed = true
  }
  next.splice(index - 1, 2, merged)
  activeIndex.value = index - 1
  selectedIndices.value = []
  selectionAnchor.value = null
  commit(next, { index: index - 1, position: previous.content.length + joiner.length })
}

function addBlockAfter(index = activeIndex.value, kind: BlockKind = 'PARAGRAPH') {
  if (props.readonly) return
  const next = cloneBlocks()
  const target = Math.min(Math.max(index + 1, 0), next.length)
  next.splice(target, 0, convertKind(emptyBlock(), kind, target))
  activeIndex.value = target
  selectedIndices.value = []
  selectionAnchor.value = null
  closeSlash()
  commit(next, { index: target, position: 0 })
}

function removeSelected() {
  if (props.readonly) return
  const targets = new Set(targetIndices.value)
  const next = blocks.value.filter((_, index) => !targets.has(index)).map((block) => ({ ...block }))
  if (!next.length) next.push(emptyBlock())
  const target = Math.min(targetIndices.value[0] ?? 0, next.length - 1)
  activeIndex.value = target
  selectedIndices.value = []
  selectionAnchor.value = null
  closeSlash()
  commit(next, { index: target, position: next[target]?.content.length ?? 0 })
}

function moveSelected(direction: -1 | 1) {
  if (props.readonly) return
  const targets = new Set(targetIndices.value)
  const ordered = direction < 0 ? [...targets].sort((a, b) => a - b) : [...targets].sort((a, b) => b - a)
  const next = cloneBlocks()
  let changed = false
  for (const index of ordered) {
    const other = index + direction
    if (other < 0 || other >= next.length || targets.has(other)) continue
    const moving = next[index]
    const replaced = next[other]
    if (!moving || !replaced) continue
    next[index] = replaced
    next[other] = moving
    targets.delete(index)
    targets.add(other)
    changed = true
  }
  if (!changed) return
  const moved = [...targets].sort((a, b) => a - b)
  selectedIndices.value = moved
  selectionAnchor.value = moved[0] ?? null
  activeIndex.value = moved[0] ?? 0
  closeSlash()
  commit(next)
}

function indentSelected(direction: -1 | 1, focus?: FocusRequest) {
  if (props.readonly) return
  const next = cloneBlocks()
  let changed = false
  for (const index of targetIndices.value) {
    const current = next[index]
    if (!current) continue
    if (direction > 0 && current.indent.length < 12) {
      current.indent += '  '
      changed = true
    } else if (direction < 0 && current.indent.length) {
      current.indent = current.indent.replace(/(?: {1,2}|\t)$/, '')
      changed = true
    }
  }
  if (changed) commit(next, focus)
}

function selectBlock(index: number, event: MouseEvent) {
  activeIndex.value = index
  closeSlash()
  if (event.shiftKey && selectionAnchor.value != null) {
    const start = Math.min(selectionAnchor.value, index)
    const end = Math.max(selectionAnchor.value, index)
    selectedIndices.value = Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
    return
  }
  selectionAnchor.value = index
  if (event.ctrlKey || event.metaKey) {
    selectedIndices.value = selectedIndices.value.includes(index)
      ? selectedIndices.value.filter((value) => value !== index)
      : [...selectedIndices.value, index].sort((left, right) => left - right)
  } else {
    selectedIndices.value = [index]
  }
}

function onDragStart(index: number, event: DragEvent) {
  if (props.readonly) return
  if (!selectedIndices.value.includes(index)) {
    selectedIndices.value = [index]
    selectionAnchor.value = index
  }
  activeIndex.value = index
  draggingIndex.value = index
  event.dataTransfer?.setData('text/plain', String(index))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function onDragOver(index: number, event: DragEvent) {
  if (draggingIndex.value == null || props.readonly) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
  const element = event.currentTarget as HTMLElement
  const bounds = element.getBoundingClientRect()
  dropIndex.value = index + (event.clientY > bounds.top + bounds.height / 2 ? 1 : 0)
}

function onDrop(event: DragEvent) {
  if (draggingIndex.value == null || props.readonly) return
  event.preventDefault()
  const insertion = dropIndex.value ?? draggingIndex.value
  const moving = selectedIndices.value.includes(draggingIndex.value) ? [...selectedIndices.value] : [draggingIndex.value]
  const movingSet = new Set(moving)
  if (moving.includes(insertion) || (insertion > 0 && moving.includes(insertion - 1) && moving.length === 1)) {
    finishDrag()
    return
  }
  const movedBlocks = moving.map((index) => blocks.value[index]).filter((block): block is EditorBlock => Boolean(block)).map((block) => ({ ...block }))
  const next = blocks.value.filter((_, index) => !movingSet.has(index)).map((block) => ({ ...block }))
  const adjusted = Math.max(0, Math.min(next.length, insertion - moving.filter((index) => index < insertion).length))
  next.splice(adjusted, 0, ...movedBlocks)
  const selected = movedBlocks.map((_, offset) => adjusted + offset)
  activeIndex.value = adjusted
  selectedIndices.value = selected
  selectionAnchor.value = selected[0] ?? null
  finishDrag()
  commit(next, { index: adjusted, position: movedBlocks[0]?.content.length ?? 0 })
}

function finishDrag() {
  draggingIndex.value = null
  dropIndex.value = null
}

function toggleTodo(index: number) {
  const current = blocks.value[index]
  if (!current || current.kind !== 'TODO' || props.readonly) return
  const next = cloneBlocks()
  next[index] = { ...current, checked: !current.checked, marker: `- [${current.checked ? ' ' : 'x'}] ` }
  commit(next)
}

function formatSelection(before: string, after = before) {
  if (props.readonly) return
  const index = clampIndex(activeIndex.value, blocks.value.length)
  const current = blocks.value[index]
  const textarea = editorRefs.value[index]
  if (!current || !textarea) return
  const start = Math.min(textarea.selectionStart, current.content.length)
  const end = Math.min(textarea.selectionEnd, current.content.length)
  const next = cloneBlocks()
  const hasWrapper = start >= before.length
    && current.content.slice(start - before.length, start) === before
    && current.content.slice(end, end + after.length) === after
  if (hasWrapper) {
    next[index] = {
      ...current,
      content: current.content.slice(0, start - before.length) + current.content.slice(start, end) + current.content.slice(end + after.length),
    }
    commit(next, { index, position: end - before.length })
    return
  }
  const selected = current.content.slice(start, end)
  next[index] = {
    ...current,
    content: current.content.slice(0, start) + before + selected + after + current.content.slice(end),
  }
  const position = selected ? end + before.length + after.length : start + before.length
  commit(next, { index, position })
}

function openLinkDialog(index = activeIndex.value) {
  if (props.readonly) return
  const current = blocks.value[index]
  const textarea = editorRefs.value[index]
  if (!current) return
  const start = Math.min(textarea?.selectionStart ?? current.content.length, current.content.length)
  const end = Math.min(textarea?.selectionEnd ?? start, current.content.length)
  activeIndex.value = index
  linkRequest.value = { index, start, end, label: current.content.slice(start, end) }
  linkLabel.value = current.content.slice(start, end)
  linkUrl.value = ''
  linkError.value = ''
  closeSlash()
}

function submitLink() {
  const request = linkRequest.value
  if (!request) return
  const safe = safeLink(linkUrl.value)
  if (!safe) {
    linkError.value = '请输入不包含账号凭据的 HTTPS 地址。'
    return
  }
  const current = blocks.value[request.index]
  if (!current) return
  const label = linkLabel.value.trim() || request.label || safe
  const token = `[${label.replace(/[\[\]]/g, '')}](${safe})`
  const next = cloneBlocks()
  next[request.index] = {
    ...current,
    content: current.content.slice(0, request.start) + token + current.content.slice(request.end),
  }
  linkRequest.value = null
  commit(next, { index: request.index, position: request.start + token.length })
}

function updateSlash(index: number, content: string, caret: number) {
  const before = content.slice(0, caret)
  const slashAt = before.lastIndexOf('/')
  if (slashAt < 0 || (slashAt > 0 && !/\s/.test(before[slashAt - 1] ?? '')) || /\s/.test(before.slice(slashAt + 1))) {
    if (slashState.value?.index === index) closeSlash()
    return
  }
  const query = before.slice(slashAt + 1)
  slashState.value = { index, start: slashAt, end: caret, query }
  slashSelection.value = 0
  emit('slash', { blockIndex: index, query })
}

function chooseSlashCommand(kind: BlockKind) {
  const state = slashState.value
  const current = state ? blocks.value[state.index] : null
  if (!state || !current) return
  const withoutQuery = current.content.slice(0, state.start) + current.content.slice(state.end)
  const next = cloneBlocks()
  next[state.index] = convertKind({ ...current, content: withoutQuery }, kind, state.index)
  const focusRequest = { index: state.index, position: state.start }
  activeIndex.value = state.index
  closeSlash()
  commit(next, focusRequest)
}

function closeSlash() {
  slashState.value = null
  slashSelection.value = 0
}

function onSelection(index: number, event: Event) {
  const textarea = event.currentTarget as HTMLTextAreaElement
  activeIndex.value = index
  const block = blocks.value[index]
  if (!block) return
  const offset = blocks.value.slice(0, index).reduce((sum, item) => sum + serializeBlock(item).length + 1, 0) + contentSourceOffset(block)
  emit('selection-change', offset + textarea.selectionStart, offset + textarea.selectionEnd)
}

function focusHeading(index: number) {
  activeIndex.value = index
  selectedIndices.value = []
  selectionAnchor.value = null
  focusAt(index, 0)
}

function insertText(text: string, replaceSlash = false) {
  if (props.readonly) return
  const index = clampIndex(activeIndex.value, blocks.value.length)
  const current = blocks.value[index]
  if (!current) return
  const textarea = editorRefs.value[index]
  let start = Math.min(textarea?.selectionStart ?? current.content.length, current.content.length)
  let end = Math.min(textarea?.selectionEnd ?? start, current.content.length)
  if (replaceSlash) {
    const state = slashState.value?.index === index ? slashState.value : slashBefore(current.content, start)
    if (state) {
      start = state.start
      end = Math.max(end, state.end)
    } else if (start > 0 && current.content[start - 1] === '/') {
      start -= 1
    }
  }

  const standalone = /^\{\{(?:card|embed):/.test(text.trim()) && !text.includes('\n')
  const next = cloneBlocks()
  if (standalone && current.kind !== 'CODE') {
    const before = current.content.slice(0, start).trimEnd()
    const after = current.content.slice(end).trimStart()
    const replacement: EditorBlock[] = []
    if (before) replacement.push({ ...current, content: before })
    replacement.push({ ...emptyBlock(), content: text.trim() })
    replacement.push({ ...emptyBlock(), content: after })
    next.splice(index, 1, ...replacement)
    const focusIndex = index + replacement.length - 1
    activeIndex.value = focusIndex
    closeSlash()
    commit(next, { index: focusIndex, position: after.length })
    return
  }

  const needsLeadingSpace = start > 0 && !/\s$/.test(current.content.slice(0, start)) && !/^\s/.test(text)
  const needsTrailingSpace = end < current.content.length && !/\s$/.test(text) && !/^\s/.test(current.content.slice(end))
  const inserted = `${needsLeadingSpace ? ' ' : ''}${text}${needsTrailingSpace ? ' ' : ''}`
  next[index] = {
    ...current,
    content: current.content.slice(0, start) + inserted + current.content.slice(end),
  }
  closeSlash()
  commit(next, { index, position: start + inserted.length })
}

function focus() {
  const index = clampIndex(activeIndex.value, blocks.value.length)
  focusAt(index, editorRefs.value[index]?.selectionStart ?? 0)
}

defineExpose({ insertText, focus, undo, redo })

function setEditorRef(index: number, value: unknown) {
  editorRefs.value[index] = value instanceof HTMLTextAreaElement ? value : null
}

function scheduleFocus(request: FocusRequest) {
  nextTick(() => focusAt(request.index, request.position))
}

function focusAt(index: number, position: number) {
  const textarea = editorRefs.value[index]
  if (!textarea) return
  const target = Math.max(0, Math.min(position, textarea.value.length))
  textarea.focus()
  textarea.setSelectionRange(target, target)
  resize(textarea)
}

function resizeAll() {
  editorRefs.value.length = blocks.value.length
  for (const textarea of editorRefs.value) resize(textarea)
}

function resize(textarea: HTMLTextAreaElement | null | undefined) {
  if (!textarea) return
  textarea.style.height = '0px'
  textarea.style.height = `${Math.max(textarea.scrollHeight, textarea.classList.contains('code-input') ? 90 : 38)}px`
}

function onRootBlur(event: FocusEvent) {
  const root = event.currentTarget as HTMLElement
  if (!root.contains(event.relatedTarget as Node | null)) emit('blur')
}

function blockLabel(block: EditorBlock) {
  return commands.find((command) => command.kind === block.kind)?.title ?? '正文'
}

function blockGlyph(block: EditorBlock, index: number) {
  if (block.kind === 'H1') return 'H1'
  if (block.kind === 'H2') return 'H2'
  if (block.kind === 'QUOTE') return '❞'
  if (block.kind === 'BULLET') return '•'
  if (block.kind === 'NUMBERED') return `${numberFor(block, index)}.`
  if (block.kind === 'CODE') return '</>'
  return ''
}

function parseMarkdown(value: string): EditorBlock[] {
  const lines = value.length ? value.replace(/\r\n?/g, '\n').split('\n') : ['']
  const parsed: EditorBlock[] = []
  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ''
    const indent = line.match(/^\s*/)?.[0] ?? ''
    const rest = line.slice(indent.length)
    const fence = rest.match(/^```([^\s`]*)\s*$/)
    if (fence) {
      let closing = -1
      for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
        if (/^\s*```\s*$/.test(lines[cursor] ?? '')) {
          closing = cursor
          break
        }
      }
      if (closing >= 0) {
        parsed.push({
          kind: 'CODE', content: lines.slice(index + 1, closing).join('\n'), indent, marker: '```', checked: false,
          codeStyle: 'FENCED', codeLanguage: fence[1] ?? '', codeClosed: true,
        })
        index = closing + 1
        continue
      }
      parsed.push({
        kind: 'CODE', content: lines.slice(index + 1).join('\n'), indent, marker: '```', checked: false,
        codeStyle: 'FENCED', codeLanguage: fence[1] ?? '', codeClosed: false,
      })
      break
    }
    const inlineCode = rest.match(/^```\s+(.*)$/)
    if (inlineCode) {
      parsed.push({ kind: 'CODE', content: inlineCode[1] ?? '', indent, marker: '``` ', checked: false, codeStyle: 'INLINE', codeLanguage: '', codeClosed: false })
      index += 1
      continue
    }
    parsed.push(parseLine(line))
    index += 1
  }
  return parsed.length ? parsed : [emptyBlock()]
}

function parseLine(line: string): EditorBlock {
  const indent = line.match(/^\s*/)?.[0] ?? ''
  const rest = line.slice(indent.length)
  const patterns: Array<{ expression: RegExp; kind: BlockKind }> = [
    { expression: /^(# )(.*)$/, kind: 'H1' },
    { expression: /^(#{2,3} )(.*)$/, kind: 'H2' },
    { expression: /^(> )(.*)$/, kind: 'QUOTE' },
    { expression: /^([-*+] \[([ xX])\] )(.*)$/, kind: 'TODO' },
    { expression: /^([-*+] )(.*)$/, kind: 'BULLET' },
    { expression: /^(\d+[.)] )(.*)$/, kind: 'NUMBERED' },
  ]
  for (const { expression, kind } of patterns) {
    const match = rest.match(expression)
    if (!match) continue
    const marker = match[1] ?? ''
    const content = kind === 'TODO' ? match[3] ?? '' : match[2] ?? ''
    return {
      kind, content, indent, marker, checked: kind === 'TODO' && /\[[xX]\]/.test(marker),
      codeStyle: null, codeLanguage: '', codeClosed: false,
    }
  }
  return { kind: 'PARAGRAPH', content: rest, indent, marker: '', checked: false, codeStyle: null, codeLanguage: '', codeClosed: false }
}

function serializeMarkdown(items: EditorBlock[]) {
  return (items.length ? items : [emptyBlock()]).map(serializeBlock).join('\n')
}

function serializeBlock(block: EditorBlock) {
  if (block.kind === 'CODE') {
    if (block.codeStyle === 'INLINE' && !block.content.includes('\n')) return `${block.indent}\`\`\` ${block.content}`
    const opener = `${block.indent}\`\`\`${block.codeLanguage}`
    const body = block.content ? `\n${block.content}` : ''
    return block.codeClosed ? `${opener}${body}\n${block.indent}\`\`\`` : `${opener}${body}`
  }
  return `${block.indent}${block.marker}${block.content}`
}

function sourcePrefix(block: EditorBlock) {
  return `${block.indent}${block.marker}`
}

function contentSourceOffset(block: EditorBlock) {
  if (block.kind === 'CODE' && block.codeStyle === 'FENCED') return block.indent.length + 3 + block.codeLanguage.length + 1
  return block.indent.length + block.marker.length
}

function convertKind(block: EditorBlock, kind: BlockKind, index: number): EditorBlock {
  if (kind === 'CODE') {
    return { ...block, kind, marker: '```', checked: false, codeStyle: 'FENCED', codeLanguage: '', codeClosed: true }
  }
  return {
    ...block,
    kind,
    marker: canonicalMarker(kind, index, block.checked),
    checked: kind === 'TODO' ? block.checked : false,
    codeStyle: null,
    codeLanguage: '',
    codeClosed: false,
  }
}

function continuationBlock(block: EditorBlock, index: number): EditorBlock {
  const kind = block.kind === 'H1' || block.kind === 'H2' ? 'PARAGRAPH' : block.kind
  const next = convertKind({ ...emptyBlock(), indent: block.indent }, kind, index)
  if (next.kind === 'TODO') {
    next.checked = false
    next.marker = '- [ ] '
  }
  if (next.kind === 'NUMBERED') next.marker = `${numberFor(block, index - 1) + 1}. `
  return next
}

function canonicalMarker(kind: BlockKind, index: number, checked = false) {
  if (kind === 'H1') return '# '
  if (kind === 'H2') return '## '
  if (kind === 'QUOTE') return '> '
  if (kind === 'BULLET') return '- '
  if (kind === 'NUMBERED') return `${index + 1}. `
  if (kind === 'TODO') return `- [${checked ? 'x' : ' '}] `
  return ''
}

function numberFor(block: EditorBlock, index: number) {
  const parsed = Number.parseInt(block.marker, 10)
  return Number.isFinite(parsed) ? parsed : index + 1
}

function emptyBlock(): EditorBlock {
  return { kind: 'PARAGRAPH', content: '', indent: '', marker: '', checked: false, codeStyle: null, codeLanguage: '', codeClosed: false }
}

function markdownShortcut(text: string): BlockKind | null {
  return ({ '# ': 'H1', '## ': 'H2', '> ': 'QUOTE', '- ': 'BULLET', '* ': 'BULLET', '1. ': 'NUMBERED', '[] ': 'TODO', '[ ] ': 'TODO', '``` ': 'CODE' } as Record<string, BlockKind>)[text] ?? null
}

function slashBefore(content: string, caret: number): SlashState | null {
  const before = content.slice(0, caret)
  const slashAt = before.lastIndexOf('/')
  if (slashAt < 0 || (slashAt > 0 && !/\s/.test(before[slashAt - 1] ?? '')) || /\s/.test(before.slice(slashAt + 1))) return null
  return { index: 0, start: slashAt, end: caret, query: before.slice(slashAt + 1) }
}

function normalizeSettings(value: unknown): DocumentSettings {
  const record = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
  return {
    pageWidth: record.pageWidth === 'WIDE' ? 'WIDE' : 'STANDARD',
    fontFamily: record.fontFamily === 'SERIF' ? 'SERIF' : 'SANS',
    fontSize: record.fontSize === 'SMALL' || record.fontSize === 'LARGE' ? record.fontSize : 'MEDIUM',
    paragraphSpacing: record.paragraphSpacing === 'COMPACT' || record.paragraphSpacing === 'RELAXED' ? record.paragraphSpacing : 'NORMAL',
    showOutline: record.showOutline !== false,
  }
}

function safeLink(value: string) {
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null
    return parsed.toString()
  } catch {
    return null
  }
}

function stripInlineMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~`]/g, '')
}

function clampIndex(index: number, length: number) {
  return Math.max(0, Math.min(index, Math.max(0, length - 1)))
}

function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === 'string' && commands.some((command) => command.kind === value)
}
</script>

<template>
  <section
    class="document-editor"
    :class="editorClasses"
    :aria-readonly="readonly"
    @blur.capture="onRootBlur"
  >
    <v-toolbar class="editor-toolbar" color="surface" density="compact" height="42" flat>
      <div class="editor-toolbar-inner">
        <v-menu location="bottom start" :close-on-content-click="true">
          <template #activator="{ props: insertMenuProps }"><v-btn v-bind="insertMenuProps" :disabled="readonly" color="success" icon="mdi-plus-circle" size="small" title="插入内容" aria-label="插入内容" /></template>
          <v-list class="insert-menu" density="compact" min-width="238">
            <v-list-subheader>插入内容</v-list-subheader>
            <v-list-item v-for="command in commands" :key="command.kind" :prepend-icon="command.icon" :title="command.title" :subtitle="command.description" @click="addBlockAfter(activeIndex, command.kind)" />
          </v-list>
        </v-menu>
        <v-divider class="toolbar-divider" vertical />
        <v-btn :disabled="readonly || !canUndo" icon="mdi-undo" size="small" title="撤销（Ctrl+Z）" aria-label="撤销" @click="undo" />
        <v-btn :disabled="readonly || !canRedo" icon="mdi-redo" size="small" title="重做（Ctrl+Shift+Z）" aria-label="重做" @click="redo" />
        <v-divider class="toolbar-divider" vertical />
        <v-select
          class="kind-select"
          :model-value="activeBlock.kind"
          :items="kindItems"
          :disabled="readonly"
          aria-label="块类型"
          density="compact"
          hide-details
          variant="plain"
          @update:model-value="setKindFromValue"
        />
        <v-divider class="toolbar-divider" vertical />
        <v-btn :disabled="readonly" icon="mdi-format-bold" size="small" title="粗体（Ctrl+B）" aria-label="粗体" @click="formatSelection('**')" />
        <v-btn :disabled="readonly" icon="mdi-format-italic" size="small" title="斜体（Ctrl+I）" aria-label="斜体" @click="formatSelection('*')" />
        <v-btn :disabled="readonly" class="d-none d-sm-inline-flex" icon="mdi-format-strikethrough-variant" size="small" title="删除线" aria-label="删除线" @click="formatSelection('~~')" />
        <v-divider class="toolbar-divider d-none d-sm-flex" vertical />
        <v-btn :disabled="readonly" class="d-none d-md-inline-flex" icon="mdi-format-list-bulleted" size="small" title="无序列表" aria-label="无序列表" @click="setKind('BULLET')" />
        <v-btn :disabled="readonly" class="d-none d-md-inline-flex" icon="mdi-format-list-numbered" size="small" title="有序列表" aria-label="有序列表" @click="setKind('NUMBERED')" />
        <v-btn :disabled="readonly" class="d-none d-md-inline-flex" icon="mdi-checkbox-marked-outline" size="small" title="待办" aria-label="待办" @click="setKind('TODO')" />
        <v-btn :disabled="readonly" class="d-none d-md-inline-flex" icon="mdi-format-quote-close" size="small" title="引用" aria-label="引用" @click="setKind('QUOTE')" />
        <v-btn :disabled="readonly" icon="mdi-link-variant" size="small" title="链接（Ctrl+K）" aria-label="插入链接" @click="openLinkDialog()" />
        <v-menu location="bottom end">
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-horizontal" size="small" title="更多格式" aria-label="更多格式" /></template>
          <v-list density="compact" min-width="190">
            <v-list-item prepend-icon="mdi-format-indent-decrease" title="减少缩进" :disabled="readonly || !targetIndices.length" @click="indentSelected(-1)" />
            <v-list-item prepend-icon="mdi-format-indent-increase" title="增加缩进" :disabled="readonly || !targetIndices.length" @click="indentSelected(1)" />
            <v-list-item prepend-icon="mdi-arrow-up" title="上移所选块" :disabled="readonly || targetIndices[0] === 0" @click="moveSelected(-1)" />
            <v-list-item prepend-icon="mdi-arrow-down" title="下移所选块" :disabled="readonly || targetIndices.at(-1) === blocks.length - 1" @click="moveSelected(1)" />
            <v-divider />
            <v-list-item prepend-icon="mdi-trash-can-outline" title="删除所选块" base-color="error" :disabled="readonly" @click="removeSelected" />
          </v-list>
        </v-menu>
        <v-spacer />
        <span v-if="selectedIndices.length > 1" class="selection-summary d-none d-lg-inline">已选择 {{ selectedIndices.length }} 个块</span>
        <v-btn
          v-if="outlineEnabled"
          class="d-lg-none"
          :icon="outlineOpen ? 'mdi-format-list-bulleted-square' : 'mdi-format-list-bulleted'"
          size="small"
          :title="outlineOpen ? '收起大纲' : '展开大纲'"
          :aria-expanded="outlineOpen"
          aria-label="文稿大纲"
          @click="outlineOpen = !outlineOpen"
        />
      </div>
    </v-toolbar>

    <div class="editor-shell" :class="{ 'with-outline': outlineEnabled && outlineOpen }">
      <main class="document-canvas" aria-label="块式文稿编辑器">
        <textarea
          v-if="props.title !== undefined"
          class="document-title-input"
          :value="props.title"
          :readonly="readonly"
          rows="1"
          maxlength="500"
          placeholder="无标题"
          aria-label="文稿标题"
          @input="onTitleInput"
          @keydown="onTitleKeydown"
        />
        <div
          v-for="(block, index) in blocks"
          :key="index"
          class="document-block"
          :class="[
            `kind-${block.kind.toLowerCase()}`,
            { active: activeIndex === index, selected: selectedIndices.includes(index), dragging: draggingIndex === index, 'drop-before': dropIndex === index, 'drop-after': dropIndex === index + 1 },
          ]"
          :style="{ '--block-indent': `${Math.min(block.indent.length, 12) * 10}px` }"
          @dragover="onDragOver(index, $event)"
          @drop="onDrop"
        >
          <div class="block-rail">
            <button
              type="button"
              class="block-handle"
              :draggable="!readonly"
              :disabled="readonly"
              :aria-label="`选择并拖动第 ${index + 1} 块`"
              title="选择块；Shift 连选，Ctrl/Cmd 多选；拖动排序"
              @click="selectBlock(index, $event)"
              @dragstart="onDragStart(index, $event)"
              @dragend="finishDrag"
            >
              <v-icon icon="mdi-drag-vertical" size="18" />
            </button>
            <button
              type="button"
              class="block-add"
              :disabled="readonly"
              :aria-label="`在第 ${index + 1} 块后新增`"
              title="新增段落"
              @click="addBlockAfter(index)"
            >
              <v-icon icon="mdi-plus" size="16" />
            </button>
          </div>

          <button
            v-if="block.kind === 'TODO'"
            type="button"
            class="todo-check"
            :class="{ checked: block.checked }"
            :disabled="readonly"
            :aria-label="block.checked ? '标记为未完成' : '标记为已完成'"
            @click="toggleTodo(index)"
          >
            <v-icon v-if="block.checked" icon="mdi-check" size="15" />
          </button>
          <span v-else class="block-glyph" :title="blockLabel(block)">{{ blockGlyph(block, index) }}</span>

          <textarea
            :ref="(element) => setEditorRef(index, element)"
            class="block-input"
            :class="{ 'code-input': block.kind === 'CODE', completed: block.kind === 'TODO' && block.checked }"
            :value="block.content"
            :readonly="readonly"
            :rows="block.kind === 'CODE' ? 3 : 1"
            :placeholder="index === 0 && !block.content ? placeholder : blockLabel(block)"
            :aria-label="`文稿块 ${index + 1}`"
            spellcheck="true"
            @focus="activeIndex = index"
            @input="onBlockInput(index, $event)"
            @keydown="onEditorKeydown(index, $event)"
            @paste="onPaste(index, $event)"
            @select="onSelection(index, $event)"
          />

          <v-card
            v-if="slashState?.index === index"
            class="slash-menu"
            role="listbox"
            aria-label="斜杠命令"
            elevation="12"
          >
            <div class="slash-heading">插入块 <kbd>↑↓</kbd><kbd>Enter</kbd></div>
            <v-list v-if="filteredCommands.length" density="compact" nav>
              <v-list-item
                v-for="(command, commandIndex) in filteredCommands"
                :key="command.kind"
                :active="slashSelection === commandIndex"
                :prepend-icon="command.icon"
                :title="command.title"
                :subtitle="command.description"
                :data-command="command.kind"
                role="option"
                @mousedown.prevent
                @click="chooseSlashCommand(command.kind)"
              />
            </v-list>
            <div v-else class="slash-empty">没有匹配的命令</div>
          </v-card>
        </div>

        <button v-if="!readonly" type="button" class="append-block" @click="addBlockAfter(blocks.length - 1)">
          <v-icon icon="mdi-plus" size="18" />
          新增一个块
        </button>
      </main>

      <aside v-if="outlineEnabled && outlineOpen" class="document-outline" aria-label="文稿大纲">
        <header>
          <span>大纲</span>
          <v-btn icon="mdi-chevron-right" size="x-small" title="收起大纲" aria-label="收起大纲" @click="outlineOpen = false" />
        </header>
        <nav>
          <span v-if="!headings.length" class="outline-empty">暂无标题</span>
          <button
            v-for="heading in headings"
            :key="heading.index"
            type="button"
            :class="{ 'level-two': heading.kind === 'H2', active: activeIndex === heading.index }"
            @click="focusHeading(heading.index)"
          >
            {{ heading.text }}
          </button>
        </nav>
      </aside>

      <button
        v-if="outlineEnabled && !outlineOpen"
        type="button"
        class="outline-restore d-none d-lg-flex"
        aria-label="展开大纲"
        title="展开大纲"
        @click="outlineOpen = true"
      >
        <v-icon icon="mdi-format-list-bulleted-square" size="19" />
      </button>
    </div>

    <v-dialog :model-value="Boolean(linkRequest)" max-width="520" @update:model-value="value => { if (!value) linkRequest = null }">
      <v-card>
        <v-card-title>插入链接</v-card-title>
        <v-card-text class="pb-0">
          <v-text-field v-model="linkLabel" label="显示文字" autofocus />
          <v-text-field
            v-model="linkUrl"
            class="mt-3"
            label="链接地址"
            placeholder="https://example.com"
            :error-messages="linkError"
            @keydown.enter.prevent="submitLink"
          />
          <p class="link-hint">仅支持不包含用户名或密码的 HTTPS 地址。</p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="linkRequest = null">取消</v-btn>
          <v-btn color="primary" variant="flat" @click="submitLink">插入链接</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.document-editor {
  --editor-font-size: 15px;
  --editor-line-height: 1.74;
  --editor-block-gap: 2px;
  display: flex;
  width: 100%;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  background: #fff;
  color: #262626;
}

.document-editor.document-size-small { --editor-font-size: 14px; }
.document-editor.document-size-large { --editor-font-size: 17px; }
.document-editor.document-spacing-compact { --editor-block-gap: 0px; --editor-line-height: 1.62; }
.document-editor.document-spacing-relaxed { --editor-block-gap: 12px; --editor-line-height: 1.9; }
.document-editor.document-font-serif .block-input { font-family: ui-serif, Georgia, 'Noto Serif SC', serif; }
.document-editor.document-font-sans .block-input { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }

.editor-toolbar {
  z-index: 24;
  min-height: 42px !important;
  flex: 0 0 42px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff !important;
  box-shadow: none !important;
}

.editor-toolbar-inner {
  display: flex;
  width: min(1240px, calc(100% - 24px));
  height: 42px;
  min-width: 0;
  align-items: center;
  margin: 0 auto;
  overflow: hidden;
}
.editor-toolbar :deep(.v-btn) {
  width: 30px;
  min-width: 30px;
  height: 30px;
  color: #585a59;
}
.editor-toolbar :deep(.v-btn--disabled) { opacity: .28; }
.editor-toolbar :deep(.v-btn__overlay) { background: #e7e9e8; }
.editor-toolbar :deep(.v-btn.text-success),
.editor-toolbar :deep(.text-success) { color: #00b96b !important; }
.toolbar-divider { height: 18px; margin: 0 7px; color: #e7e9e8; }
.kind-select { flex: 0 0 94px; max-width: 94px; }
.kind-select :deep(.v-field__input) { min-height: 30px; padding: 0 2px; font-size: 14px; }
.kind-select :deep(.v-field__append-inner) { padding-top: 3px; }
.kind-select :deep(.v-list-item__prepend) { display: none; }
.selection-summary { margin-right: 8px; color: #8a8f8d; font-size: 12px; }

.editor-shell {
  position: relative;
  display: block;
  width: 100%;
  min-height: 0;
  flex: 1 1 auto;
  overflow-x: hidden;
  overflow-y: auto;
  padding: 52px 0 120px;
  scrollbar-gutter: stable;
}

.document-width-wide .editor-shell { width: 100%; }
.editor-shell.with-outline { display: block; }

.document-canvas {
  width: 750px;
  max-width: calc(100% - 48px);
  min-width: 0;
  margin: 0 auto;
}
.document-width-wide .document-canvas { width: 900px; }
.document-title-input {
  display: block;
  width: 100%;
  min-height: 50px;
  margin: 0 0 4px;
  padding: 0;
  overflow: hidden;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: #262626;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif;
  font-size: 36px;
  font-weight: 650;
  line-height: 50px;
  letter-spacing: -.5px;
  field-sizing: content;
}
.document-title-input::placeholder { color: #c5c7c6; }
.document-block {
  --block-indent: 0px;
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  align-items: flex-start;
  min-height: 34px;
  margin: var(--editor-block-gap) 0 var(--editor-block-gap) min(var(--block-indent), 120px);
  border-radius: 2px;
  transition: background-color 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
}

.document-block:hover,
.document-block.active { background: transparent; }
.document-block.selected { box-shadow: inset 2px 0 #2f6feb; background: #f7f9ff; }
.document-block.dragging { opacity: .4; }
.document-block.drop-before::before,
.document-block.drop-after::after {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 3;
  height: 2px;
  border-radius: 999px;
  background: #2f6feb;
  content: '';
}
.document-block.drop-before::before { top: -6px; }
.document-block.drop-after::after { bottom: -6px; }

.block-rail {
  position: absolute;
  top: 2px;
  right: calc(100% + 3px);
  display: flex;
  width: 54px;
  height: 28px;
  align-items: center;
  justify-content: flex-end;
  padding: 0;
  opacity: 0;
  transition: opacity 100ms ease;
}
.document-block:hover .block-rail,
.document-block.active .block-rail,
.document-block.selected .block-rail { opacity: 1; }
.block-handle,
.block-add,
.todo-check,
.append-block,
.document-outline button,
.outline-restore {
  border: 0;
  font: inherit;
  cursor: pointer;
}
.block-handle,
.block-add {
  display: inline-grid;
  width: 24px;
  height: 26px;
  place-items: center;
  border-radius: 4px;
  background: transparent;
  color: #8a8f8d;
}
.block-handle:hover,
.block-add:hover { background: #f0f1f0; color: #262626; }
.block-handle:disabled,
.block-add:disabled { cursor: default; opacity: .35; }

.block-glyph {
  min-height: 34px;
  padding-top: 6px;
  color: #585a59;
  font: 600 12px/1.4 ui-sans-serif, system-ui, sans-serif;
  text-align: center;
  user-select: none;
}
.kind-paragraph .block-glyph,
.kind-h1 .block-glyph,
.kind-h2 .block-glyph,
.kind-code .block-glyph { display: none; }
.kind-paragraph .block-input,
.kind-h1 .block-input,
.kind-h2 .block-input,
.kind-code .block-input { grid-column: 1 / -1; }
.kind-quote .block-glyph { color: #8a8f8d; font-size: 17px; padding-top: 3px; }
.kind-bullet .block-glyph { font-size: 19px; padding-top: 1px; }
.kind-numbered .block-glyph { font-size: 13px; padding-top: 6px; }

.todo-check {
  display: grid;
  width: 18px;
  height: 18px;
  margin: 5px 5px 0;
  place-items: center;
  border: 1.5px solid #b5b8b7;
  border-radius: 4px;
  background: transparent;
  color: white;
}
.todo-check.checked { border-color: #2f6feb; background: #2f6feb; }

.block-input {
  display: block;
  width: 100%;
  min-height: 34px;
  padding: 3px 0 4px;
  overflow: hidden;
  border: 0;
  outline: 0;
  resize: none;
  background: transparent;
  color: inherit;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  caret-color: #2f6feb;
}
.block-input::placeholder { color: #b7bbba; }
.kind-h1 .block-input { padding-top: 1px; font-size: calc(var(--editor-font-size) * 1.66); font-weight: 700; line-height: 1.42; }
.kind-h2 .block-input { padding-top: 2px; font-size: calc(var(--editor-font-size) * 1.35); font-weight: 700; line-height: 1.48; }
.kind-quote .block-input { padding-left: 12px; border-left: 3px solid #d8dad9; color: #585a59; }
.block-input.completed { color: #a6aaa8; text-decoration: line-through; }
.block-input.code-input {
  min-height: 90px;
  padding: 14px 16px;
  overflow: auto;
  border: 1px solid #e7e9e8;
  border-radius: 4px;
  background: #f6f7f7;
  font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  tab-size: 2;
  white-space: pre;
}

.slash-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 40;
  width: min(360px, calc(100vw - 64px));
  max-height: 410px;
  overflow: auto;
  border: 1px solid #e7e9e8;
  border-radius: 8px;
}
.slash-heading {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 14px 6px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 650;
}
.slash-heading kbd { padding: 1px 4px; border-radius: 4px; background: rgba(var(--v-theme-on-surface), .07); font: inherit; }
.slash-heading kbd:first-of-type { margin-left: auto; }
.slash-empty { padding: 28px 16px; color: rgb(var(--v-theme-on-surface-variant)); text-align: center; }

.append-block {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 20px 0 0;
  padding: 7px 0;
  border-radius: 4px;
  background: transparent;
  color: #b7bbba;
  font-size: 13px;
  opacity: .42;
}
.append-block:hover { color: #2f6feb; opacity: 1; }

.document-outline {
  position: fixed;
  top: 94px;
  right: 0;
  bottom: 0;
  z-index: 18;
  width: 196px;
  overflow: auto;
  border-left: 1px solid #f0f0f0;
  background: rgba(255,255,255,.98);
  padding: 15px 12px 32px;
}
.document-outline header { display: flex; align-items: center; justify-content: space-between; height: 28px; margin-bottom: 7px; color: #585a59; font-size: 13px; font-weight: 600; }
.document-outline nav { display: flex; flex-direction: column; gap: 2px; }
.outline-empty { padding: 7px 8px; color: #b7bbba; font-size: 12px; }
.document-outline nav button {
  overflow: hidden;
  padding: 6px 7px;
  border-radius: 4px;
  background: transparent;
  color: #585a59;
  font-size: 13px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.document-outline nav button.level-two { padding-left: 22px; font-size: 12px; }
.document-outline nav button:hover,
.document-outline nav button.active { background: #f0f1f0; color: #262626; }
.outline-restore {
  position: fixed;
  top: 108px;
  right: 14px;
  z-index: 19;
  width: 34px;
  height: 34px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 4px;
  background: #fff;
  color: #8a8f8d;
  box-shadow: none;
}
.outline-restore:hover { background: #f0f1f0; color: #262626; }

.link-hint { margin: 0 0 12px; color: rgb(var(--v-theme-on-surface-variant)); font-size: 12px; }

@media (max-width: 1024px) {
  .document-outline { width: 184px; box-shadow: -8px 0 30px rgba(0,0,0,.05); }
}

@media (max-width: 600px) {
  .editor-toolbar-inner { width: calc(100% - 8px); }
  .toolbar-divider { margin: 0 3px; }
  .kind-select { flex-basis: 82px; max-width: 82px; }
  .editor-shell { padding: 30px 0 90px; }
  .document-canvas { max-width: calc(100% - 34px); }
  .document-title-input { min-height: 44px; font-size: 30px; line-height: 42px; }
  .document-block { grid-template-columns: 24px minmax(0, 1fr); margin-left: min(var(--block-indent), 44px); }
  .block-rail { opacity: .62; }
  .block-add { display: none; }
  .document-outline { top: 94px; width: min(82vw, 300px); box-shadow: -10px 0 36px rgba(0,0,0,.12); }
  .outline-restore { right: 8px; }
}

@media (prefers-reduced-motion: reduce) {
  .document-block,
  .block-rail { transition: none; }
}
</style>
