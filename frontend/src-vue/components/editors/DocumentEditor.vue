<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { DocumentSettings } from '../../../src/types'
import {
  blockCommandFor,
  DOCUMENT_EDITOR_COMMANDS,
  filterDocumentEditorCommands,
  groupDocumentEditorCommands,
  type DocumentBlockKind,
  type DocumentContentCardKind,
  type DocumentEditorCommand,
} from './documentEditorCommands'

type BlockKind = DocumentBlockKind
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

interface PendingInsert {
  source: string
  index: number
  start: number
  end: number
}

interface LinkRequest {
  index: number
  start: number
  end: number
  label: string
}

interface SelectionContext {
  text: string
  blockIndex: number
  blockKind: BlockKind
  blockStart: number
  blockEnd: number
  selectionStart: number
  selectionEnd: number
}

type TemplateFocusable = HTMLElement | { $el?: HTMLElement } | null

const props = withDefaults(defineProps<{
  modelValue: string
  documentSettings?: DocumentSettings | Record<string, unknown> | null
  readonly?: boolean
  placeholder?: string
  showOutline?: boolean
  forceOutlineClosed?: boolean
  title?: string
  titleReadonly?: boolean
}>(), {
  documentSettings: undefined,
  readonly: false,
  placeholder: '输入 / 唤起命令，或直接开始写作…',
  showOutline: undefined,
  forceOutlineClosed: false,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'update:title': [value: string]
  blur: []
  slash: [context: { blockIndex: number; query: string }]
  'request-content-card': [payload: { commandId: string | null; kind: DocumentContentCardKind | null }]
  'request-reference': [payload: { commandId: string | null }]
  'selection-change': [start: number, end: number, context: SelectionContext]
  'outline-open-change': [open: boolean]
}>()

const source = ref(props.modelValue)
const activeIndex = ref(0)
const selectedIndices = ref<number[]>([])
const selectionAnchor = ref<number | null>(null)
const draggingIndex = ref<number | null>(null)
const dropIndex = ref<number | null>(null)
const slashState = ref<SlashState | null>(null)
const slashSelection = ref(0)
const slashPlacement = ref<'above' | 'below'>('below')
const selectionRange = ref({ index: 0, start: 0, end: 0 })
const pendingInsert = ref<PendingInsert | null>(null)
const compactOutline = ref(isCompactOutlineViewport())
const outlineOpen = ref(!compactOutline.value)
const insertMenuOpen = ref(false)
const insertQuery = ref('')
const insertSelection = ref(0)
const linkRequest = ref<LinkRequest | null>(null)
const linkLabel = ref('')
const linkUrl = ref('')
const linkError = ref('')
const insertSearchRef = ref<HTMLInputElement | null>(null)
const outlineCloseRef = ref<TemplateFocusable>(null)
const editorRefs = ref<Array<HTMLTextAreaElement | null>>([])
const undoStack = ref<string[]>([])
const redoStack = ref<string[]>([])
let lastHistory: { key: string; at: number } | null = null
let outlineMediaQuery: MediaQueryList | null = null
let outlineReturnFocus: HTMLElement | null = null

const blocks = computed(() => parseMarkdown(source.value))
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
const resolvedTitleReadonly = computed(() => props.titleReadonly ?? props.readonly)
const editorClasses = computed(() => [
  `document-width-${settings.value.pageWidth.toLowerCase()}`,
  `document-font-${settings.value.fontFamily.toLowerCase()}`,
  `document-size-${settings.value.fontSize.toLowerCase()}`,
  `document-spacing-${settings.value.paragraphSpacing.toLowerCase()}`,
])
const selectedBlockKind = computed<BlockKind | 'MIXED'>(() => {
  const kinds = new Set(targetIndices.value.map((index) => blocks.value[index]?.kind).filter(Boolean))
  return kinds.size === 1 ? [...kinds][0] as BlockKind : 'MIXED'
})
const kindItems = computed(() => {
  const items = DOCUMENT_EDITOR_COMMANDS.flatMap((command) => command.action === 'BLOCK'
    ? [{ value: command.blockKind, title: command.title, prependIcon: command.icon }]
    : [])
  return selectedBlockKind.value === 'MIXED'
    ? [{ value: 'MIXED', title: '多种格式', disabled: true }, ...items]
    : items
})
const filteredCommands = computed(() => {
  return filterDocumentEditorCommands(slashState.value?.query ?? '')
})
const filteredInsertCommands = computed(() => {
  return filterDocumentEditorCommands(insertQuery.value)
})
const slashCommandGroups = computed(() => groupDocumentEditorCommands(filteredCommands.value))
const insertCommandGroups = computed(() => groupDocumentEditorCommands(filteredInsertCommands.value))
const canIndentSelection = computed(() => targetIndices.value.length > 0 && targetIndices.value.every((index) => {
  const block = blocks.value[index]
  return Boolean(block && isListBlock(block) && canChangeIndent(block, 1))
}))
const canOutdentSelection = computed(() => targetIndices.value.length > 0 && targetIndices.value.every((index) => {
  const block = blocks.value[index]
  return Boolean(block && isListBlock(block) && canChangeIndent(block, -1))
}))
const canUndo = computed(() => undoStack.value.length > 0)
const canRedo = computed(() => redoStack.value.length > 0)

function isBlockKindActive(kind: BlockKind) {
  return targetIndices.value.length > 0 && targetIndices.value.every((index) => blocks.value[index]?.kind === kind)
}

function inlineFormatActive(marker: string) {
  const range = selectionRange.value
  const block = blocks.value[range.index]
  if (!block) return false
  const start = Math.min(range.start, range.end, block.content.length)
  const end = Math.min(Math.max(range.start, range.end), block.content.length)
  if (marker === '*') {
    let leftRun = 0
    let rightRun = 0
    while (start - leftRun - 1 >= 0 && block.content[start - leftRun - 1] === '*') leftRun += 1
    while (end + rightRun < block.content.length && block.content[end + rightRun] === '*') rightRun += 1
    return leftRun % 2 === 1 && rightRun % 2 === 1
  }
  return start >= marker.length
    && block.content.slice(start - marker.length, start) === marker
    && block.content.slice(end, end + marker.length) === marker
}

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
watch(filteredInsertCommands, (items) => {
  insertSelection.value = Math.min(insertSelection.value, Math.max(0, items.length - 1))
})
watch(insertMenuOpen, (open) => {
  if (!open) return
  insertQuery.value = ''
  insertSelection.value = 0
  nextTick(() => insertSearchRef.value?.focus())
})
watch(() => props.forceOutlineClosed, (forced) => { if (forced) closeOutline(false) }, { immediate: true })

onMounted(() => {
  resizeAll()
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    outlineMediaQuery = window.matchMedia('(max-width: 1100px)')
    compactOutline.value = outlineMediaQuery.matches
    outlineMediaQuery.addEventListener('change', handleOutlineViewportChange)
  }
  if (compactOutline.value) setOutlineOpen(false)
  else emit('outline-open-change', outlineOpen.value)
  window.addEventListener('keydown', closeCompactOutlineOnEscape)
})
onBeforeUnmount(() => {
  outlineMediaQuery?.removeEventListener('change', handleOutlineViewportChange)
  window.removeEventListener('keydown', closeCompactOutlineOnEscape)
})

function isCompactOutlineViewport() {
  if (typeof window === 'undefined') return false
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(max-width: 1100px)').matches
    : window.innerWidth <= 1100
}

function setOutlineOpen(open: boolean) {
  const next = open && !props.forceOutlineClosed
  if (outlineOpen.value === next) return
  outlineOpen.value = next
  emit('outline-open-change', next)
}

function openOutline(event?: Event) {
  if (props.forceOutlineClosed) return
  if (compactOutline.value) {
    const trigger = event?.currentTarget
    outlineReturnFocus = trigger instanceof HTMLElement
      ? trigger
      : document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  setOutlineOpen(true)
  if (compactOutline.value) void nextTick(() => {
    if (outlineOpen.value && compactOutline.value) focusTemplateRef(outlineCloseRef.value)
  })
}

function closeOutline(restoreFocus = true) {
  const returnFocus = compactOutline.value && restoreFocus ? outlineReturnFocus : null
  outlineReturnFocus = null
  setOutlineOpen(false)
  if (returnFocus) void nextTick(() => {
    if (returnFocus.isConnected) returnFocus.focus()
  })
}

function toggleOutline(event: Event) {
  if (outlineOpen.value) closeOutline()
  else openOutline(event)
}

function focusTemplateRef(value: TemplateFocusable) {
  const element = value instanceof HTMLElement ? value : value?.$el
  element?.focus()
}

function handleOutlineViewportChange(event: MediaQueryListEvent) {
  compactOutline.value = event.matches
  if (event.matches) closeOutline(false)
}

function closeCompactOutlineOnEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !compactOutline.value || !outlineOpen.value) return
  event.preventDefault()
  closeOutline()
}

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
  if (props.readonly) return
  if (event.isComposing || event.keyCode === 229) return

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
      if (command) chooseSlashCommand(command)
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
    const direction = event.shiftKey ? -1 : 1
    if (isListBlock(current) && canChangeIndent(current, direction)) {
      event.preventDefault()
      indentSelected(direction, { index, position: textarea.selectionStart })
    }
    return
  }
  if (event.key === 'Enter' && current.kind !== 'CODE') {
    event.preventDefault()
    if (event.shiftKey) insertSoftBreak(index, textarea.selectionStart, textarea.selectionEnd)
    else splitBlock(index, textarea.selectionStart, textarea.selectionEnd)
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

function insertSoftBreak(index: number, start: number, end: number) {
  const current = blocks.value[index]
  if (!current) return
  const next = cloneBlocks()
  next[index] = { ...current, content: `${current.content.slice(0, start)}\u2028${current.content.slice(end)}` }
  commit(next, { index, position: start + 1 }, `typing-${index}`)
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

function chooseInsertCommand(command: DocumentEditorCommand) {
  insertMenuOpen.value = false
  if (command.action === 'BLOCK') addBlockAfter(activeIndex.value, command.blockKind)
  else requestExternalCommand(command)
}

function onInsertMenuKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (filteredInsertCommands.value.length) insertSelection.value = (insertSelection.value + 1) % filteredInsertCommands.value.length
    return
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (filteredInsertCommands.value.length) insertSelection.value = (insertSelection.value - 1 + filteredInsertCommands.value.length) % filteredInsertCommands.value.length
    return
  }
  if (event.key === 'Enter') {
    event.preventDefault()
    const command = filteredInsertCommands.value[insertSelection.value]
    if (command) chooseInsertCommand(command)
    return
  }
  if (event.key === 'Escape') {
    event.preventDefault()
    insertMenuOpen.value = false
  }
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
    if (!current || !isListBlock(current)) continue
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
    linkError.value = '请输入站内相对地址，或不包含账号凭据的 HTTP/HTTPS 地址。'
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
  slashPlacement.value = resolveSlashPlacement(editorRefs.value[index])
  slashSelection.value = 0
  emit('slash', { blockIndex: index, query })
}

function chooseSlashCommand(command: DocumentEditorCommand) {
  const state = slashState.value
  const current = state ? blocks.value[state.index] : null
  if (!state || !current) return
  const withoutQuery = current.content.slice(0, state.start) + current.content.slice(state.end)
  const next = cloneBlocks()
  next[state.index] = command.action === 'BLOCK'
    ? convertKind({ ...current, content: withoutQuery }, command.blockKind, state.index)
    : { ...current, content: withoutQuery }
  const focusRequest = { index: state.index, position: state.start }
  activeIndex.value = state.index
  closeSlash()
  commit(next, focusRequest)
  if (command.action !== 'BLOCK') {
    pendingInsert.value = { source: source.value, index: state.index, start: state.start, end: state.start }
    emitExternalCommand(command)
  }
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
  const selectionStart = Math.min(textarea.selectionStart, textarea.selectionEnd, block.content.length)
  const selectionEnd = Math.min(Math.max(textarea.selectionStart, textarea.selectionEnd), block.content.length)
  selectionRange.value = { index, start: selectionStart, end: selectionEnd }
  const blockStart = blocks.value.slice(0, index).reduce((sum, item) => sum + serializeBlock(item).length + 1, 0) + contentSourceOffset(block)
  const blockEnd = blockStart + block.content.length
  emit('selection-change', blockStart + selectionStart, blockStart + selectionEnd, {
    text: textarea.value.slice(selectionStart, selectionEnd),
    blockIndex: index,
    blockKind: block.kind,
    blockStart,
    blockEnd,
    selectionStart,
    selectionEnd,
  })
}

function focusBlock(index: number, event: FocusEvent) {
  activeIndex.value = index
  selectedIndices.value = []
  selectionAnchor.value = null
  onSelection(index, event)
}

function focusHeading(index: number) {
  activeIndex.value = index
  selectedIndices.value = []
  selectionAnchor.value = null
  if (compactOutline.value) {
    closeOutline(false)
    void nextTick(() => focusAt(index, 0))
  } else {
    focusAt(index, 0)
  }
}

function insertText(text: string, replaceSlash = false) {
  if (props.readonly) return false
  const index = clampIndex(activeIndex.value, blocks.value.length)
  const current = blocks.value[index]
  if (!current) return false
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

  insertTextAt(index, start, end, text)
  return true
}

function insertTextAt(index: number, start: number, end: number, text: string) {
  const current = blocks.value[index]
  if (!current) return false
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
    return true
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
  return true
}

function requestExternalCommand(command: Exclude<DocumentEditorCommand, { action: 'BLOCK' }>) {
  if (!capturePendingInsert()) return
  emitExternalCommand(command)
}

function capturePendingInsert() {
  if (props.readonly) return false
  const index = clampIndex(activeIndex.value, blocks.value.length)
  const current = blocks.value[index]
  if (!current) return false
  const textarea = editorRefs.value[index]
  const rememberedRange = selectionRange.value.index === index ? selectionRange.value : null
  const start = Math.min(textarea?.selectionStart ?? rememberedRange?.start ?? current.content.length, current.content.length)
  const end = Math.min(textarea?.selectionEnd ?? rememberedRange?.end ?? start, current.content.length)
  pendingInsert.value = { source: source.value, index, start: Math.min(start, end), end: Math.max(start, end) }
  return true
}

function emitExternalCommand(command: Exclude<DocumentEditorCommand, { action: 'BLOCK' }>) {
  if (command.action === 'CONTENT_CARD') emit('request-content-card', { commandId: command.id, kind: command.cardKind })
  else emit('request-reference', { commandId: command.id })
}

function requestContentCard(kind: DocumentContentCardKind | null = null) {
  const command = kind
    ? DOCUMENT_EDITOR_COMMANDS.find((value) => value.action === 'CONTENT_CARD' && value.cardKind === kind)
    : null
  if (command?.action === 'CONTENT_CARD') requestExternalCommand(command)
  else if (capturePendingInsert()) emit('request-content-card', { commandId: null, kind: null })
}

function requestReference() {
  const command = DOCUMENT_EDITOR_COMMANDS.find((value) => value.action === 'REFERENCE')
  if (command?.action === 'REFERENCE') requestExternalCommand(command)
}

function insertPendingText(text: string) {
  const pending = pendingInsert.value
  if (!pending) return false
  if (props.readonly || pending.source !== source.value) {
    pendingInsert.value = null
    return false
  }
  pendingInsert.value = null
  return insertTextAt(pending.index, pending.start, pending.end, text)
}

function cancelPendingInsert(restore = true) {
  const pending = pendingInsert.value
  pendingInsert.value = null
  if (restore && pending) scheduleFocus({ index: clampIndex(pending.index, blocks.value.length), position: pending.start })
}

function focus() {
  const index = clampIndex(activeIndex.value, blocks.value.length)
  focusAt(index, editorRefs.value[index]?.selectionStart ?? 0)
}

defineExpose({ insertText, insertPendingText, cancelPendingInsert, capturePendingInsert, requestContentCard, requestReference, focus, undo, redo, closeOutline })

function isListBlock(block: EditorBlock) {
  return block.kind === 'BULLET' || block.kind === 'NUMBERED' || block.kind === 'TODO'
}

function canChangeIndent(block: EditorBlock, direction: -1 | 1) {
  return direction > 0 ? block.indent.length < 12 : block.indent.length > 0
}

function resolveSlashPlacement(textarea: HTMLTextAreaElement | null | undefined): 'above' | 'below' {
  if (!textarea || typeof window === 'undefined') return 'below'
  const bounds = textarea.getBoundingClientRect()
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight
  const spaceBelow = viewportHeight - bounds.bottom
  return spaceBelow < 330 && bounds.top > spaceBelow ? 'above' : 'below'
}

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
  selectionRange.value = { index, start: target, end: target }
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
  return blockCommandFor(block.kind)?.title ?? '正文'
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
  const trimmed = value.trim()
  if (/^(?:#|\/(?!\/))/.test(trimmed)) return trimmed
  try {
    const parsed = new URL(trimmed)
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) return null
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
  return typeof value === 'string' && Boolean(blockCommandFor(value as BlockKind))
}
</script>

<template>
  <section
    class="document-editor"
    :class="editorClasses"
    :aria-readonly="readonly"
    @blur.capture="onRootBlur"
  >
    <v-toolbar class="editor-toolbar" color="surface" density="compact" height="42" flat :inert="compactOutline && outlineOpen ? true : undefined">
      <div class="editor-toolbar-inner">
        <v-menu
          v-model="insertMenuOpen"
          location="bottom start"
          :offset="6"
          :close-on-content-click="false"
          content-class="editor-insert-overlay"
        >
          <template #activator="{ props: insertMenuProps }">
            <v-btn
              v-bind="insertMenuProps"
              :disabled="readonly"
              :aria-expanded="insertMenuOpen"
              color="success"
              icon="mdi-plus-circle"
              size="small"
              title="插入内容"
              aria-label="插入内容"
            />
          </template>
          <section class="insert-menu" role="dialog" aria-label="插入内容菜单">
            <header class="insert-menu-header">
              <strong>插入</strong>
              <span>也可输入 <kbd>/</kbd> 快速插入</span>
            </header>
            <label class="insert-menu-search">
              <v-icon icon="mdi-magnify" size="17" />
              <input
                ref="insertSearchRef"
                v-model="insertQuery"
                type="search"
                autocomplete="off"
                placeholder="搜索内容类型"
                aria-label="搜索插入内容"
                @keydown="onInsertMenuKeydown"
              >
              <kbd>Esc</kbd>
            </label>
            <div v-if="filteredInsertCommands.length" class="insert-menu-groups" role="listbox" aria-label="可插入内容">
              <section v-for="group in insertCommandGroups" :key="group.id" class="insert-menu-section">
                <div class="insert-menu-group">{{ group.label }}</div>
                <button
                  v-for="command in group.commands"
                  :key="command.id"
                  type="button"
                  class="insert-menu-item"
                  :class="{ active: insertSelection === filteredInsertCommands.indexOf(command) }"
                  :aria-selected="insertSelection === filteredInsertCommands.indexOf(command)"
                  :data-insert-command="command.action === 'BLOCK' ? command.blockKind : command.id"
                  role="option"
                  @mouseenter="insertSelection = filteredInsertCommands.indexOf(command)"
                  @mousedown.prevent
                  @click="chooseInsertCommand(command)"
                >
                  <span class="insert-menu-icon"><v-icon :icon="command.icon" size="18" /></span>
                  <span class="insert-menu-copy"><strong>{{ command.title }}</strong><small>{{ command.description }}</small></span>
                </button>
              </section>
            </div>
            <div v-else class="insert-menu-empty" role="status">
              <v-icon icon="mdi-magnify-close" size="22" />
              <span>没有找到相关内容</span>
              <small>换一个关键词试试</small>
            </div>
          </section>
        </v-menu>
        <v-divider class="toolbar-divider" vertical />
        <v-btn :disabled="readonly || !canUndo" icon="mdi-undo" size="small" title="撤销（Ctrl+Z）" aria-label="撤销" @click="undo" />
        <v-btn :disabled="readonly || !canRedo" icon="mdi-redo" size="small" title="重做（Ctrl+Shift+Z）" aria-label="重做" @click="redo" />
        <v-divider class="toolbar-divider" vertical />
        <v-select
          class="kind-select"
          :model-value="selectedBlockKind"
          :items="kindItems"
          :disabled="readonly"
          aria-label="块类型"
          density="compact"
          hide-details
          variant="plain"
          @update:model-value="setKindFromValue"
        />
        <v-divider class="toolbar-divider" vertical />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': inlineFormatActive('**') }" :aria-pressed="inlineFormatActive('**')" icon="mdi-format-bold" size="small" title="粗体（Ctrl+B）" aria-label="粗体" @click="formatSelection('**')" />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': inlineFormatActive('*') }" :aria-pressed="inlineFormatActive('*')" icon="mdi-format-italic" size="small" title="斜体（Ctrl+I）" aria-label="斜体" @click="formatSelection('*')" />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': inlineFormatActive('~~') }" :aria-pressed="inlineFormatActive('~~')" class="d-none d-sm-inline-flex" icon="mdi-format-strikethrough-variant" size="small" title="删除线" aria-label="删除线" @click="formatSelection('~~')" />
        <v-divider class="toolbar-divider d-none d-sm-flex" vertical />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': isBlockKindActive('BULLET') }" :aria-pressed="isBlockKindActive('BULLET')" class="d-none d-md-inline-flex" icon="mdi-format-list-bulleted" size="small" title="无序列表" aria-label="无序列表" @click="setKind('BULLET')" />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': isBlockKindActive('NUMBERED') }" :aria-pressed="isBlockKindActive('NUMBERED')" class="d-none d-md-inline-flex" icon="mdi-format-list-numbered" size="small" title="有序列表" aria-label="有序列表" @click="setKind('NUMBERED')" />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': isBlockKindActive('TODO') }" :aria-pressed="isBlockKindActive('TODO')" class="d-none d-md-inline-flex" icon="mdi-checkbox-marked-outline" size="small" title="待办" aria-label="待办" @click="setKind('TODO')" />
        <v-btn :disabled="readonly" :class="{ 'toolbar-active': isBlockKindActive('QUOTE') }" :aria-pressed="isBlockKindActive('QUOTE')" class="d-none d-md-inline-flex" icon="mdi-format-quote-close" size="small" title="引用" aria-label="引用" @click="setKind('QUOTE')" />
        <v-btn :disabled="readonly" icon="mdi-link-variant" size="small" title="链接（Ctrl+K）" aria-label="插入链接" @click="openLinkDialog()" />
        <v-menu location="bottom end" :offset="6" content-class="editor-more-overlay">
          <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-horizontal" size="small" title="更多格式" aria-label="更多格式" /></template>
          <v-list density="compact" min-width="190">
            <v-list-item prepend-icon="mdi-format-indent-decrease" title="减少缩进" :disabled="readonly || !canOutdentSelection" @click="indentSelected(-1)" />
            <v-list-item prepend-icon="mdi-format-indent-increase" title="增加缩进" :disabled="readonly || !canIndentSelection" @click="indentSelected(1)" />
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
          @click="toggleOutline"
        />
      </div>
    </v-toolbar>

    <div class="editor-shell" :class="{ 'with-outline': outlineEnabled && outlineOpen }">
      <main class="document-canvas" aria-label="块式文稿编辑器" :inert="compactOutline && outlineOpen ? true : undefined">
        <textarea
          v-if="props.title !== undefined"
          class="document-title-input"
          :value="props.title"
          :readonly="resolvedTitleReadonly"
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
            @focus="focusBlock(index, $event)"
            @input="onBlockInput(index, $event)"
            @keydown="onEditorKeydown(index, $event)"
            @paste="onPaste(index, $event)"
            @select="onSelection(index, $event)"
          />

          <v-card
            v-if="slashState?.index === index"
            class="slash-menu"
            :class="`slash-menu--${slashPlacement}`"
            role="listbox"
            aria-label="斜杠命令"
            aria-busy="false"
            elevation="0"
          >
            <div class="slash-heading"><span>插入</span><kbd>↑↓</kbd><kbd>Enter</kbd></div>
            <div v-if="filteredCommands.length" class="slash-options">
              <section v-for="group in slashCommandGroups" :key="group.id" class="slash-section">
                <div class="slash-group">{{ group.label }}</div>
                <button
                  v-for="command in group.commands"
                  :key="command.id"
                  type="button"
                  class="slash-command"
                  :class="{ active: slashSelection === filteredCommands.indexOf(command) }"
                  :aria-selected="slashSelection === filteredCommands.indexOf(command)"
                  :data-command="command.action === 'BLOCK' ? command.blockKind : command.id"
                  role="option"
                  @mousedown.prevent
                  @mouseenter="slashSelection = filteredCommands.indexOf(command)"
                  @click="chooseSlashCommand(command)"
                >
                  <span class="slash-command-icon"><v-icon :icon="command.icon" size="18" /></span>
                  <span class="slash-command-copy"><strong>{{ command.title }}</strong><small>{{ command.description }}</small></span>
                </button>
              </section>
            </div>
            <div v-else class="slash-empty" role="status">
              <v-icon icon="mdi-text-search" size="22" />
              <span>没有匹配的命令</span>
              <small>继续输入或按 Esc 关闭</small>
            </div>
          </v-card>
        </div>

        <button v-if="!readonly" type="button" class="append-block" @click="addBlockAfter(blocks.length - 1)">
          <v-icon icon="mdi-plus" size="18" />
          新增一个块
        </button>
      </main>

      <aside v-if="outlineEnabled && outlineOpen" class="document-outline" aria-label="文稿大纲" :role="compactOutline ? 'dialog' : undefined" :aria-modal="compactOutline ? 'true' : undefined">
        <header>
          <span>大纲</span>
          <v-btn ref="outlineCloseRef" icon="mdi-chevron-right" size="x-small" title="收起大纲" aria-label="收起大纲" @click="closeOutline()" />
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
        @click="openOutline"
      >
        <v-icon icon="mdi-format-list-bulleted-square" size="19" />
      </button>
    </div>

    <v-dialog
      :model-value="Boolean(linkRequest)"
      max-width="480"
      content-class="editor-link-overlay"
      @update:model-value="value => { if (!value) linkRequest = null }"
    >
      <v-card class="link-dialog" rounded="lg" elevation="12">
        <header class="link-dialog-header">
          <strong>插入链接</strong>
          <v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭链接弹窗" title="关闭" @click="linkRequest = null" />
        </header>
        <div class="link-dialog-body">
          <label class="link-field-label" for="document-link-label">显示文字</label>
          <v-text-field
            id="document-link-label"
            v-model="linkLabel"
            class="link-field"
            density="compact"
            variant="outlined"
            hide-details
            autofocus
            placeholder="输入要显示的文字"
            aria-label="显示文字"
          />
          <label class="link-field-label" for="document-link-url">链接地址</label>
          <v-text-field
            id="document-link-url"
            v-model="linkUrl"
            class="link-field"
            density="compact"
            variant="outlined"
            placeholder="https://example.com"
            :error-messages="linkError"
            aria-label="链接地址"
            @update:model-value="linkError = ''"
            @keydown.enter.prevent="submitLink"
          />
          <p class="link-hint"><v-icon icon="mdi-shield-check-outline" size="14" />支持站内相对地址及不含账号凭据的 HTTP/HTTPS 地址</p>
        </div>
        <footer class="link-dialog-actions">
          <v-btn variant="text" @click="linkRequest = null">取消</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!linkUrl.trim()" @click="submitLink">插入链接</v-btn>
        </footer>
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
  height: auto;
  min-height: calc(100dvh - 52px);
  flex-direction: column;
  overflow: visible;
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
  position: sticky;
  top: 52px;
  z-index: 24;
  width: calc(100% - 15px) !important;
  min-height: 42px !important;
  flex: 0 0 42px;
  margin-right: 15px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff !important;
  box-shadow: none !important;
}

.editor-toolbar-inner {
  display: flex;
  width: calc(100% - 44px);
  height: 42px;
  min-width: 0;
  align-items: center;
  margin: 0;
  padding-left: 8px;
  overflow: hidden;
}
.editor-toolbar :deep(.v-btn) {
  width: 30px;
  min-width: 30px;
  height: 30px;
  color: #585a59;
  border-radius: 4px;
}
.editor-toolbar :deep(.v-btn--disabled) { opacity: .28; }
.editor-toolbar :deep(.v-btn__overlay) { background: #e7e9e8; }
.editor-toolbar :deep(.v-btn:focus-visible) { outline: 2px solid rgba(47,111,235,.32); outline-offset: -1px; }
.editor-toolbar :deep(.v-btn.toolbar-active) { color: #1677ff; background: #edf3ff; }
.editor-toolbar :deep(.v-btn.toolbar-active .v-btn__overlay) { opacity: 0; }
.editor-toolbar :deep(.v-btn.text-success),
.editor-toolbar :deep(.text-success) { color: #00b96b !important; }
.toolbar-divider { height: 18px; margin: 0 7px; color: #e7e9e8; }
.kind-select { flex: 0 0 94px; max-width: 94px; }
.kind-select :deep(.v-field__input) { min-height: 30px; padding: 0 2px; font-size: 14px; }
.kind-select :deep(.v-field__append-inner) { padding-top: 3px; }
.kind-select :deep(.v-list-item__prepend) { display: none; }
.selection-summary { margin-right: 8px; color: #8a8f8d; font-size: 12px; }

:global(.editor-insert-overlay) {
  width: 316px !important;
  overflow: hidden;
  border: 1px solid #e6e8e7;
  border-radius: 8px !important;
  background: #fff;
  box-shadow: 0 8px 26px rgba(31,35,33,.14) !important;
}
.insert-menu {
  display: block;
  width: 316px;
  padding: 8px;
  background: #fff;
  color: #262626;
}
.insert-menu-header {
  display: flex;
  height: 30px;
  align-items: center;
  padding: 0 6px;
}
.insert-menu-header strong { font-size: 14px; font-weight: 600; }
.insert-menu-header span { margin-left: auto; color: #8a8f8d; font-size: 11px; }
.insert-menu kbd {
  display: inline-grid;
  min-width: 18px;
  height: 18px;
  place-items: center;
  padding: 0 4px;
  border: 1px solid #e1e4e2;
  border-radius: 4px;
  background: #f7f8f7;
  color: #8a8f8d;
  font: 11px/16px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  box-shadow: 0 1px 0 rgba(31,35,33,.04);
}
.insert-menu-search {
  display: flex;
  height: 34px;
  align-items: center;
  gap: 7px;
  margin: 4px 4px 6px;
  padding: 0 9px;
  border: 1px solid #e1e4e2;
  border-radius: 5px;
  background: #fff;
  color: #8a8f8d;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.insert-menu-search:focus-within { border-color: #2f6feb; box-shadow: 0 0 0 2px rgba(47,111,235,.1); }
.insert-menu-search input {
  min-width: 0;
  flex: 1;
  border: 0;
  outline: 0;
  background: transparent;
  color: #262626;
  font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
}
.insert-menu-search input::placeholder { color: #b5b9b7; }
.insert-menu-search input::-webkit-search-cancel-button { display: none; }
.insert-menu-group {
  height: 26px;
  padding: 7px 8px 4px;
  color: #8a8f8d;
  font-size: 11px;
  font-weight: 500;
}
.insert-menu-groups {
  display: flex;
  max-height: min(360px, calc(100dvh - 220px));
  flex-direction: column;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.insert-menu-section { display: contents; }
.insert-menu-item {
  display: grid;
  width: 100%;
  min-height: 44px;
  grid-template-columns: 32px minmax(0,1fr);
  align-items: center;
  gap: 8px;
  padding: 4px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #262626;
  text-align: left;
  cursor: pointer;
}
.insert-menu-item:hover,
.insert-menu-item.active { background: #f1f3f2; }
.insert-menu-item:focus-visible { outline: 2px solid rgba(47,111,235,.32); outline-offset: -2px; }
.insert-menu-icon,
.slash-command-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid #e5e7e6;
  border-radius: 5px;
  background: #fff;
  color: #585a59;
}
.insert-menu-copy,
.slash-command-copy { display: flex; min-width: 0; flex-direction: column; }
.insert-menu-copy strong,
.slash-command-copy strong { font-size: 13px; font-weight: 500; line-height: 18px; }
.insert-menu-copy small,
.slash-command-copy small { overflow: hidden; color: #8a8f8d; font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.insert-menu-empty,
.slash-empty {
  display: flex;
  min-height: 104px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 5px;
  color: #8a8f8d;
  font-size: 13px;
}
.insert-menu-empty small,
.slash-empty small { color: #b0b4b2; font-size: 11px; }
:global(.editor-more-overlay) {
  overflow: hidden;
  border: 1px solid #e6e8e7;
  border-radius: 8px !important;
  box-shadow: 0 8px 24px rgba(31,35,33,.13) !important;
}
:global(.editor-more-overlay .v-list) { padding: 5px; }
:global(.editor-more-overlay .v-list-item) { min-height: 36px; border-radius: 5px; font-size: 13px; }

.editor-shell {
  position: relative;
  display: block;
  width: 100%;
  min-height: calc(100dvh - 94px);
  flex: 0 0 auto;
  overflow-x: hidden;
  overflow-y: visible;
  padding: 52px 0 120px;
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
.editor-shell.with-outline .document-canvas {
  width: min(750px, calc(100% - 445px));
  max-width: calc(100% - 445px);
  margin-right: 0;
  margin-left: 70px;
}
.document-width-wide .editor-shell.with-outline .document-canvas { width: min(900px, calc(100% - 445px)); }
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
.document-block:focus-within .block-rail,
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
.block-handle:focus-visible,
.block-add:focus-visible,
.todo-check:focus-visible,
.append-block:focus-visible { outline: 2px solid rgba(47,111,235,.35); outline-offset: 1px; }

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
  top: calc(100% + 6px);
  left: 0;
  z-index: 42;
  width: min(320px, calc(100vw - 64px));
  max-height: min(404px, calc(100dvh - 160px));
  overflow: hidden;
  padding: 6px;
  border: 1px solid #e6e8e7;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 26px rgba(31,35,33,.14) !important;
}
.slash-menu--above { top: auto; bottom: calc(100% + 6px); }
.slash-heading {
  display: flex;
  height: 28px;
  align-items: center;
  gap: 5px;
  padding: 0 7px;
  color: #8a8f8d;
  font-size: 11px;
  font-weight: 500;
}
.slash-heading kbd { display: inline-grid; min-width: 20px; height: 18px; place-items: center; padding: 0 4px; border: 1px solid #e1e4e2; border-radius: 4px; background: #f7f8f7; color: #8a8f8d; font: 10px/16px inherit; }
.slash-heading kbd:first-of-type { margin-left: auto; }
.slash-options { max-height: 356px; overflow-y: auto; overscroll-behavior: contain; }
.slash-section { display: block; }
.slash-group { height: 25px; padding: 7px 7px 3px; color: #8a8f8d; font-size: 11px; font-weight: 500; }
.slash-command {
  display: grid;
  width: 100%;
  min-height: 44px;
  grid-template-columns: 32px minmax(0,1fr);
  align-items: center;
  gap: 8px;
  padding: 4px 7px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: #262626;
  text-align: left;
  cursor: pointer;
}
.slash-command:hover,
.slash-command.active { background: #f1f3f2; }
.slash-command:focus-visible { outline: 2px solid rgba(47,111,235,.32); outline-offset: -2px; }

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
  right: 61px;
  bottom: 0;
  z-index: 18;
  width: 305px;
  overflow: auto;
  border-left: 0;
  background: rgba(255,255,255,.98);
  padding: 35px 28px 32px;
}
.document-outline header { display: flex; align-items: center; justify-content: flex-start; height: 30px; margin-bottom: 7px; color: #262626; font-size: 14px; font-weight: 600; }
.document-outline header :deep(.v-btn) { margin-left: 8px; }
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
  right: 75px;
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

:global(.editor-link-overlay) { margin: 24px; }
.link-dialog {
  overflow: hidden;
  border: 1px solid #e4e7e5;
  background: #fff;
  box-shadow: 0 16px 44px rgba(31,35,33,.18) !important;
}
.link-dialog-header {
  display: flex;
  height: 52px;
  align-items: center;
  justify-content: space-between;
  padding: 0 16px 0 20px;
  border-bottom: 1px solid #eff0ef;
}
.link-dialog-header strong { color: #262626; font-size: 16px; font-weight: 600; }
.link-dialog-header :deep(.v-btn) { width: 30px; min-width: 30px; height: 30px; color: #8a8f8d; }
.link-dialog-body { padding: 18px 20px 4px; }
.link-field-label { display: block; margin: 0 0 7px; color: #585a59; font-size: 13px; font-weight: 500; }
.link-field { margin-bottom: 14px; }
.link-field :deep(.v-field) { min-height: 36px; border-radius: 5px; font-size: 13px; }
.link-field :deep(.v-field__input) { min-height: 36px; padding-top: 7px; padding-bottom: 7px; }
.link-field :deep(.v-field__outline__start) { border-radius: 5px 0 0 5px; }
.link-field :deep(.v-field__outline__end) { border-radius: 0 5px 5px 0; }
.link-field :deep(.v-messages) { min-height: 18px; padding-top: 3px; font-size: 11px; }
.link-hint { display: flex; align-items: center; gap: 5px; margin: -4px 0 12px; color: #8a8f8d; font-size: 11px; }
.link-dialog-actions {
  display: flex;
  min-height: 58px;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 10px 20px;
  border-top: 1px solid #eff0ef;
}
.link-dialog-actions :deep(.v-btn) { min-width: 64px; height: 32px; border-radius: 5px; font-size: 13px; }
.link-dialog-actions :deep(.v-btn--disabled) { opacity: .42; }

@media (min-width: 1101px) {
  .editor-toolbar-inner { box-sizing: border-box; padding-left: 82px; }
  .editor-toolbar :deep(.v-btn) { width: 26px; min-width: 26px; height: 26px; }
  .kind-select { flex-basis: 71px; max-width: 71px; }
  .editor-shell.with-outline .document-canvas { margin-left: 155px; }
  .document-outline { right: 15px; width: 305px; padding: 35px 28px 32px; }
}

@media (max-width: 1100px) {
  .editor-toolbar { margin-right: 0; }
  .editor-toolbar-inner { width: calc(100% - 8px); }
  .editor-shell.with-outline .document-canvas,
  .document-width-wide .editor-shell.with-outline .document-canvas { width: 750px; max-width: calc(100% - 48px); margin: 0 auto; }
  .document-outline { right: 0; width: min(82vw,305px); box-shadow: -8px 0 30px rgba(0,0,0,.06); }
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
