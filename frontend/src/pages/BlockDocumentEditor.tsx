import {
  forwardRef, useEffect, useImperativeHandle, useRef, useState,
} from 'react'
import {
  ArrowDown, ArrowUp, Bold, CheckSquare, Code2, Columns3, GripVertical, Heading1, Heading2, Italic, Link2,
  List, ListOrdered, ListTree, Palette, Pencil, Pilcrow, Quote, Redo2, Trash2, Undo2, Ungroup,
} from 'lucide-react'
import { encodeContentCardToken, parseContentCardTokens, safeMediaUrl, type ParsedContentCard } from '../lib/contentCards'
import { TextEntryDialog } from '../components/TextEntryDialog'

export interface BlockDocumentEditorHandle {
  focus: () => void
  insertText: (text: string, replaceSlash?: boolean) => void
  replaceCard: (instanceId: string, token: string) => boolean
}

interface BlockDocumentEditorProps {
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  onSlash: () => void
  onSelection: (start: number, end: number) => void
  onImageFiles?: (files: File[]) => Promise<string[]>
  onEditCard?: (card: ParsedContentCard) => void
  showOutline?: boolean
}

type BlockKind = 'PARAGRAPH' | 'H1' | 'H2' | 'QUOTE' | 'BULLET' | 'NUMBERED' | 'TODO' | 'CODE'

const blockKinds: Array<{ kind: BlockKind; label: string; icon: React.ReactNode }> = [
  { kind: 'PARAGRAPH', label: '正文', icon: <Pilcrow /> },
  { kind: 'H1', label: '标题 1', icon: <Heading1 /> },
  { kind: 'H2', label: '标题 2', icon: <Heading2 /> },
  { kind: 'QUOTE', label: '引用', icon: <Quote /> },
  { kind: 'BULLET', label: '无序列表', icon: <List /> },
  { kind: 'NUMBERED', label: '有序列表', icon: <ListOrdered /> },
  { kind: 'TODO', label: '待办', icon: <CheckSquare /> },
  { kind: 'CODE', label: '代码', icon: <Code2 /> },
]

export const BlockDocumentEditor = forwardRef<BlockDocumentEditorHandle, BlockDocumentEditorProps>(function BlockDocumentEditor({
  value, onChange, onBlur, onSlash, onSelection, onImageFiles, onEditCard, showOutline = true,
}, forwardedRef) {
  const lines = splitLines(value)
  const valueRef = useRef(value)
  valueRef.current = value
  const textareas = useRef<Array<HTMLTextAreaElement | null>>([])
  const undoStack = useRef<string[]>([])
  const redoStack = useRef<string[]>([])
  const lastHistory = useRef<{ key: string; at: number } | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [selectedIndices, setSelectedIndices] = useState<number[]>([])
  const [selectionAnchor, setSelectionAnchor] = useState<number | null>(null)
  const [outlineOpen, setOutlineOpen] = useState(true)
  const [imageUpload, setImageUpload] = useState<{ pending: boolean; error: string | null }>({ pending: false, error: null })
  const [linkRequest, setLinkRequest] = useState<{ index: number; start: number; end: number } | null>(null)

  const commit = (next: string[], focus?: { index: number; position: number }, historyKey = 'structure') => {
    const serialized = next.join('\n')
    const currentValue = valueRef.current
    if (serialized === currentValue) return
    const now = Date.now()
    if (historyKey === 'structure' || lastHistory.current?.key !== historyKey || now - lastHistory.current.at > 700) {
      undoStack.current.push(currentValue)
      if (undoStack.current.length > 100) undoStack.current.shift()
    }
    lastHistory.current = { key: historyKey, at: now }
    redoStack.current = []
    valueRef.current = serialized
    onChange(serialized)
    if (focus) window.requestAnimationFrame(() => focusAt(textareas.current[focus.index], focus.position))
  }
  const active = describeBlock(lines[Math.min(activeIndex, lines.length - 1)] ?? '')
  const headings = lines.flatMap((line, index) => {
    const block = describeBlock(line)
    return (block.kind === 'H1' || block.kind === 'H2') && block.content.trim()
      ? [{ index, kind: block.kind, text: block.content.trim() }]
      : []
  })

  useImperativeHandle(forwardedRef, () => ({
    focus: () => focusAt(textareas.current[activeIndex] ?? textareas.current[0], 0),
    replaceCard: (instanceId, token) => {
      const latest = splitLines(valueRef.current)
      const index = latest.findIndex((line) => exactCard(line)?.instanceId === instanceId)
      if (index < 0) return false
      latest[index] = token
      setActiveIndex(index)
      setSelectedIndices([index])
      setSelectionAnchor(index)
      commit(latest)
      return true
    },
    insertText: (text, replaceSlash = false) => {
      const index = Math.min(activeIndex, lines.length - 1)
      const current = describeBlock(lines[index] ?? '')
      const editor = textareas.current[index]
      let start = editor?.selectionStart ?? current.content.length
      const end = editor?.selectionEnd ?? start
      if (replaceSlash && start > 0 && current.content[start - 1] === '/') start -= 1
      if (text.startsWith('{{card:')) {
        const before = current.content.slice(0, start).trimEnd()
        const after = current.content.slice(end).trimStart()
        const replacement = [...(before ? [current.prefix + before] : []), text, after]
        const cardIndex = index + (before ? 1 : 0)
        const next = [...lines]
        next.splice(index, 1, ...replacement)
        setActiveIndex(cardIndex + 1)
        commit(next, { index: cardIndex + 1, position: 0 })
        return
      }
      const prefix = start > 0 && !/\s$/.test(current.content.slice(0, start)) ? ' ' : ''
      const suffix = end < current.content.length && !/^\s/.test(current.content.slice(end)) ? ' ' : ''
      const inserted = `${prefix}${text}${suffix}`
      const next = [...lines]
      next[index] = current.prefix + current.content.slice(0, start) + inserted + current.content.slice(end)
      commit(next, { index, position: start + inserted.length })
    },
  }), [activeIndex, value])

  useEffect(() => {
    for (const textarea of textareas.current) resize(textarea)
  }, [value])

  const targetIndices = (selectedIndices.length ? selectedIndices : [Math.min(activeIndex, lines.length - 1)])
    .filter((index) => index >= 0 && index < lines.length)
  const activeCard = exactCard(lines[Math.min(activeIndex, lines.length - 1)] ?? '')
  const canCreateColumns = targetIndices.length >= 2
    && targetIndices.every((index, offset) => offset === 0 || index === targetIndices[offset - 1]! + 1)
    && targetIndices.every((index) => !parseContentCardTokens(lines[index] ?? '').length)
  const setKind = (kind: BlockKind) => {
    const index = Math.min(activeIndex, lines.length - 1)
    const next = [...lines]
    for (const target of targetIndices) {
      const current = describeBlock(lines[target] ?? '')
      next[target] = current.indent + prefixFor(kind, target) + current.content
    }
    const current = describeBlock(next[index] ?? '')
    commit(next, targetIndices.length === 1 ? { index, position: current.content.length } : undefined)
  }
  const format = (before: string, after = before, selection?: { index: number; start: number; end: number }) => {
    const index = Math.min(selection?.index ?? activeIndex, lines.length - 1)
    const current = describeBlock(lines[index] ?? '')
    const editor = textareas.current[index]
    const start = Math.min(selection?.start ?? editor?.selectionStart ?? current.content.length, current.content.length)
    const end = Math.min(selection?.end ?? editor?.selectionEnd ?? start, current.content.length)
    const selected = current.content.slice(start, end)
    const next = [...lines]
    next[index] = current.prefix + current.content.slice(0, start) + before + selected + after + current.content.slice(end)
    commit(next, { index, position: start + before.length + selected.length + after.length })
  }
  const openLinkDialog = (index = Math.min(activeIndex, lines.length - 1)) => {
    const current = describeBlock(lines[index] ?? '')
    const editor = textareas.current[index]
    const start = Math.min(editor?.selectionStart ?? current.content.length, current.content.length)
    const end = Math.min(editor?.selectionEnd ?? start, current.content.length)
    setActiveIndex(index)
    setLinkRequest({ index, start, end })
  }
  const updateLine = (index: number, text: string) => {
    const current = describeBlock(lines[index] ?? '')
    if (!text.includes('\n')) {
      const next = [...lines]
      next[index] = current.prefix + text
      commit(next, undefined, `typing-${index}`)
      if (text.endsWith('/') && /(?:^|\s)\/$/.test(text)) onSlash()
      return
    }
    const pasted = text.split(/\r?\n/)
    const first = pasted.shift() ?? ''
    const next = [...lines]
    next.splice(index, 1, current.prefix + first, ...pasted)
    commit(next, { index: index + pasted.length, position: pasted.at(-1)?.length ?? first.length })
  }
  const insertBlockAfter = (index: number, position: number) => {
    const current = describeBlock(lines[index] ?? '')
    const next = [...lines]
    const before = current.content.slice(0, position)
    const after = current.content.slice(position)
    next.splice(index, 1, current.prefix + before, continuationPrefix(current, index + 1) + after)
    commit(next, { index: index + 1, position: 0 })
  }
  const mergePrevious = (index: number) => {
    if (index <= 0) return
    const previous = describeBlock(lines[index - 1] ?? '')
    const current = describeBlock(lines[index] ?? '')
    const next = [...lines]
    next.splice(index - 1, 2, previous.prefix + previous.content + current.content)
    setActiveIndex(index - 1)
    commit(next, { index: index - 1, position: previous.content.length })
  }
  const removeBlock = (index: number) => {
    const next = [...lines]
    next.splice(index, 1)
    if (!next.length) next.push('')
    const target = Math.min(index, next.length - 1)
    setActiveIndex(target)
    commit(next, { index: target, position: describeBlock(next[target] ?? '').content.length })
  }
  const selectBlock = (index: number, range: boolean, toggle: boolean) => {
    setActiveIndex(index)
    if (range && selectionAnchor != null) {
      const start = Math.min(selectionAnchor, index)
      const end = Math.max(selectionAnchor, index)
      setSelectedIndices(Array.from({ length: end - start + 1 }, (_, offset) => start + offset))
      return
    }
    setSelectionAnchor(index)
    setSelectedIndices((current) => toggle
      ? current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort((left, right) => left - right)
      : [index])
  }
  const removeSelected = () => {
    const targets = new Set(targetIndices)
    const next = lines.filter((_, index) => !targets.has(index))
    if (!next.length) next.push('')
    const focus = Math.min(targetIndices[0] ?? 0, next.length - 1)
    setSelectedIndices([])
    setSelectionAnchor(null)
    setActiveIndex(focus)
    commit(next, { index: focus, position: describeBlock(next[focus] ?? '').content.length })
  }
  const createColumns = () => {
    if (!canCreateColumns) return
    const start = targetIndices[0]!
    const split = Math.ceil(targetIndices.length / 2)
    const selected = targetIndices.map((index) => lines[index] ?? '')
    const token = encodeContentCardToken('columns', 1, {
      count: 2,
      columns: [{ content: selected.slice(0, split).join('\n') }, { content: selected.slice(split).join('\n') }],
      ratios: [1, 1],
    })
    const next = [...lines]
    next.splice(start, targetIndices.length, token)
    setSelectedIndices([start])
    setSelectionAnchor(start)
    setActiveIndex(start)
    commit(next)
  }
  const unwrapColumns = () => {
    if (activeCard?.cardId !== 'columns' || !activeCard.data || !Array.isArray(activeCard.data.columns)) return
    const restored = activeCard.data.columns.flatMap((column, index) => {
      const record = column && typeof column === 'object' && !Array.isArray(column) ? column as Record<string, unknown> : {}
      const content = typeof record.content === 'string' ? record.content.split(/\r?\n/) : ['']
      return index === 0 ? content : ['', ...content]
    })
    const index = Math.min(activeIndex, lines.length - 1)
    const next = [...lines]
    next.splice(index, 1, ...restored)
    setSelectedIndices([])
    setSelectionAnchor(null)
    setActiveIndex(index)
    commit(next, { index, position: describeBlock(restored[0] ?? '').content.length })
  }
  const moveSelected = (direction: -1 | 1) => {
    const targets = new Set(targetIndices)
    const ordered = direction < 0 ? [...targetIndices].sort((a, b) => a - b) : [...targetIndices].sort((a, b) => b - a)
    const next = [...lines]
    let changed = false
    for (const index of ordered) {
      const other = index + direction
      if (other < 0 || other >= next.length || targets.has(other)) continue
      ;[next[index], next[other]] = [next[other] ?? '', next[index] ?? '']
      targets.delete(index)
      targets.add(other)
      changed = true
    }
    if (!changed) return
    const moved = [...targets].sort((a, b) => a - b)
    setSelectedIndices(moved)
    setSelectionAnchor(moved[0] ?? null)
    setActiveIndex(moved[0] ?? 0)
    commit(next)
  }
  const undo = () => {
    const previous = undoStack.current.pop()
    if (previous == null) return
    redoStack.current.push(valueRef.current)
    lastHistory.current = null
    setSelectedIndices([])
    valueRef.current = previous
    onChange(previous)
  }
  const redo = () => {
    const next = redoStack.current.pop()
    if (next == null) return
    undoStack.current.push(valueRef.current)
    lastHistory.current = null
    setSelectedIndices([])
    valueRef.current = next
    onChange(next)
  }
  const dropAt = (target: number) => {
    if (dragIndex == null || dragIndex === target) { setDragIndex(null); return }
    const moving = selectedIndices.includes(dragIndex) ? selectedIndices : [dragIndex]
    if (moving.includes(target)) { setDragIndex(null); return }
    const movingSet = new Set(moving)
    const moved = moving.map((index) => lines[index] ?? '')
    const next = lines.filter((_, index) => !movingSet.has(index))
    const adjustedTarget = Math.max(0, target - moving.filter((index) => index < target).length)
    next.splice(adjustedTarget, 0, ...moved)
    const selected = moved.map((_, offset) => adjustedTarget + offset)
    setSelectedIndices(selected)
    setSelectionAnchor(selected[0] ?? null)
    setActiveIndex(adjustedTarget)
    setDragIndex(null)
    commit(next, { index: adjustedTarget, position: describeBlock(moved[0] ?? '').content.length })
  }
  const insertImages = async (
    files: File[],
    target: { index: number; placement: 'CURSOR' | 'BEFORE'; start?: number; end?: number },
  ) => {
    if (!onImageFiles || !files.length || imageUpload.pending) return
    setImageUpload({ pending: true, error: null })
    try {
      const tokens = await onImageFiles(files)
      if (!tokens.length) {
        setImageUpload({ pending: false, error: '没有可插入的图片' })
        return
      }
      const latest = splitLines(valueRef.current)
      const index = Math.max(0, Math.min(target.index, latest.length - 1))
      let focusIndex: number
      if (target.placement === 'CURSOR') {
        const current = describeBlock(latest[index] ?? '')
        const start = Math.max(0, Math.min(target.start ?? current.content.length, current.content.length))
        const end = Math.max(start, Math.min(target.end ?? start, current.content.length))
        const before = current.content.slice(0, start).trimEnd()
        const after = current.content.slice(end).trimStart()
        const replacement = [...(before ? [current.prefix + before] : []), ...tokens, after]
        latest.splice(index, 1, ...replacement)
        focusIndex = index + replacement.length - 1
      } else if (!(latest[index] ?? '').trim()) {
        latest.splice(index, 1, ...tokens, '')
        focusIndex = index + tokens.length
      } else {
        latest.splice(index, 0, ...tokens)
        focusIndex = index + tokens.length
      }
      setActiveIndex(focusIndex)
      setSelectedIndices([])
      setSelectionAnchor(null)
      commit(latest, { index: focusIndex, position: 0 })
    } catch (reason) {
      setImageUpload({ pending: false, error: reason instanceof Error ? reason.message : '图片上传失败，请稍后重试' })
      return
    }
    setImageUpload({ pending: false, error: null })
  }

  return <section className="block-document-editor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onBlur() }}>
    {showOutline && headings.length > 1 && <aside className={`editor-document-outline ${outlineOpen ? 'open' : ''}`}>
      <button type="button" onClick={() => setOutlineOpen((current) => !current)} aria-expanded={outlineOpen}><ListTree />大纲<span>{headings.length}</span></button>
      {outlineOpen && <nav aria-label="文稿大纲">{headings.map((heading) => <button type="button" className={heading.kind === 'H2' ? 'level-2' : ''} key={heading.index} onClick={() => { setActiveIndex(heading.index); setSelectedIndices([]); focusAt(textareas.current[heading.index], 0) }}>{heading.text}</button>)}</nav>}
    </aside>}
    <div className="block-format-toolbar" role="toolbar" aria-label="块与文字格式">
      <select value={active.kind} onChange={(event) => setKind(event.target.value as BlockKind)} aria-label="块类型">{blockKinds.map((item) => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select>
      <span />
      <button type="button" title="粗体（Ctrl+B）" onClick={() => format('**')}><Bold /></button>
      <button type="button" title="斜体（Ctrl+I）" onClick={() => format('*')}><Italic /></button>
      <button type="button" title="链接（Ctrl+K）" onClick={() => openLinkDialog()}><Link2 /></button>
      <span />
      <button type="button" title="上移所选块" onClick={() => moveSelected(-1)}><ArrowUp /></button>
      <button type="button" title="下移所选块" onClick={() => moveSelected(1)}><ArrowDown /></button>
      <button type="button" title="删除所选块" onClick={removeSelected}><Trash2 /></button>
      <button type="button" title="将所选块分成两栏" disabled={!canCreateColumns} onClick={createColumns}><Columns3 /></button>
      <button type="button" title="解除当前分栏" disabled={activeCard?.cardId !== 'columns'} onClick={unwrapColumns}><Ungroup /></button>
      <button type="button" title="撤销（Ctrl+Z）" onClick={undo}><Undo2 /></button>
      <button type="button" title="重做（Ctrl+Shift+Z）" onClick={redo}><Redo2 /></button>
      <small>{imageUpload.pending ? '正在上传并插入图片…' : selectedIndices.length > 1 ? `已选择 ${selectedIndices.length} 个块 · 可批量转换、移动或删除` : '可直接粘贴或拖入图片 · Shift 连选 · Ctrl/Cmd 多选'}</small>
    </div>
    {imageUpload.error && <div className="inline-error editor-image-upload-error" role="alert">{imageUpload.error}</div>}
    <div className="document-block-list">
      {lines.map((line, index) => {
        const block = describeBlock(line)
        const card = exactCard(line)
        return <div className={`document-block kind-${block.kind.toLowerCase()} ${activeIndex === index ? 'active' : ''} ${selectedIndices.includes(index) ? 'selected' : ''} ${dragIndex === index ? 'dragging' : ''}`} key={index} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = onImageFiles && event.dataTransfer.types.includes('Files') ? 'copy' : 'move' }} onDrop={(event) => { const transferred = transferFiles(event.dataTransfer); if (onImageFiles && event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.stopPropagation(); setDragIndex(null); const images = transferred.filter((file) => file.type.startsWith('image/')); if (!images.length) setImageUpload({ pending: false, error: '这里只能拖入图片文件' }); else void insertImages(images, { index, placement: 'BEFORE' }); return } dropAt(index) }}>
          <button type="button" className="block-handle" draggable onClick={(event) => selectBlock(index, event.shiftKey, event.ctrlKey || event.metaKey)} onDragStart={(event) => { if (!selectedIndices.includes(index)) { setSelectedIndices([index]); setSelectionAnchor(index) } setDragIndex(index); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', String(index)) }} onDragEnd={() => setDragIndex(null)} title="选择或拖动排序" aria-label={`选择并拖动第 ${index + 1} 块`}><GripVertical /></button>
          {card ? <div className="inline-card-block" onClick={() => { setActiveIndex(index); setSelectedIndices([index]); setSelectionAnchor(index) }}>{card.cardId === 'columns' ? <Columns3 /> : <Palette />}<div><strong>{cardLabel(card.cardId)}</strong><small>{card.cardId === 'columns' ? `${Array.isArray(card.data?.columns) ? card.data.columns.length : 2} 栏布局` : `内容卡片 · ${card.instanceId.slice(0, 8)}`}</small></div>{onEditCard && <button className="icon-button" type="button" title="编辑卡片" aria-label={`编辑${cardLabel(card.cardId)}卡片`} onClick={(event) => { event.stopPropagation(); setActiveIndex(index); onEditCard(card) }}><Pencil /></button>}<button className="icon-button danger" type="button" title="删除卡片" aria-label={`删除${cardLabel(card.cardId)}卡片`} onClick={(event) => { event.stopPropagation(); removeBlock(index) }}><Trash2 /></button></div> : <>
            {block.kind === 'TODO' && <button type="button" className={`block-checkbox ${block.checked ? 'checked' : ''}`} aria-label={block.checked ? '标记为未完成' : '标记为已完成'} onClick={() => { const next = [...lines]; next[index] = `${block.indent}- [${block.checked ? ' ' : 'x'}] ${block.content}`; commit(next) }}>{block.checked && '✓'}</button>}
            <span className="block-kind-glyph" title={kindLabel(block.kind)}>{kindGlyph(block.kind, index)}</span>
            <textarea
              ref={(element) => { textareas.current[index] = element }}
              rows={1}
              value={block.content}
              onFocus={() => setActiveIndex(index)}
              onInput={(event) => resize(event.currentTarget)}
              onChange={(event) => updateLine(index, event.target.value)}
              onPaste={(event) => { if (!onImageFiles) return; const transferred = transferFiles(event.clipboardData); const images = transferred.filter((file) => file.type.startsWith('image/')); if (!images.length) return; event.preventDefault(); void insertImages(images, { index, placement: 'CURSOR', start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd }) }}
              onSelect={(event) => {
                setActiveIndex(index)
                const offset = lines.slice(0, index).reduce((sum, item) => sum + item.length + 1, 0) + block.prefix.length
                onSelection(offset + event.currentTarget.selectionStart, offset + event.currentTarget.selectionEnd)
              }}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); return }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
                if (event.key === 'Enter') { event.preventDefault(); insertBlockAfter(index, event.currentTarget.selectionStart); return }
                if (event.key === 'Backspace' && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0 && !block.content && block.kind !== 'PARAGRAPH') { event.preventDefault(); setKind('PARAGRAPH'); return }
                if (event.key === 'Backspace' && event.currentTarget.selectionStart === 0 && event.currentTarget.selectionEnd === 0) { event.preventDefault(); mergePrevious(index); return }
                if (event.key === 'Tab') { event.preventDefault(); const next = [...lines]; next[index] = event.shiftKey ? line.replace(/^ {1,2}/, '') : `  ${line}`; commit(next, { index, position: event.currentTarget.selectionStart }); return }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') { event.preventDefault(); format('**'); return }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') { event.preventDefault(); format('*'); return }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); openLinkDialog(index) }
              }}
              placeholder={index === 0 && !block.content ? '输入 / 唤起命令，或直接开始写作…' : kindLabel(block.kind)}
              aria-label={`文稿块 ${index + 1}`}
            />
          </>}
        </div>
      })}
    </div>
    {linkRequest && <TextEntryDialog title="插入链接" label="链接地址" inputType="url" placeholder="https://example.com" description="仅支持不含账号凭据的 HTTPS 地址。" confirmLabel="插入链接" validate={(input) => { const safe = safeMediaUrl(input); return safe?.startsWith('https://') ? null : '请输入有效的 HTTPS 地址' }} onSubmit={(input) => { const safe = safeMediaUrl(input); if (!safe) return; format('[', `](${safe})`, linkRequest); setLinkRequest(null) }} onClose={() => setLinkRequest(null)} />}
  </section>
})

function splitLines(value: string) { return value.length ? value.split('\n') : [''] }

function describeBlock(line: string) {
  const indent = line.match(/^\s*/)?.[0] ?? ''
  const rest = line.slice(indent.length)
  const match = rest.match(/^(###? |# |> |- \[[ xX]\] |- |\d+\. |``` )(.*)$/)
  if (!match) return { kind: 'PARAGRAPH' as BlockKind, prefix: indent, indent, content: rest, checked: false }
  const marker = match[1] ?? ''
  const kind: BlockKind = marker === '# ' ? 'H1' : marker === '## ' || marker === '### ' ? 'H2' : marker === '> ' ? 'QUOTE' : /^- \[[ xX]\] /.test(marker) ? 'TODO' : marker === '- ' ? 'BULLET' : /^\d+\. /.test(marker) ? 'NUMBERED' : marker === '``` ' ? 'CODE' : 'PARAGRAPH'
  return { kind, prefix: indent + marker, indent, content: match[2] ?? '', checked: /- \[[xX]\] /.test(marker) }
}

function prefixFor(kind: BlockKind, index: number) { return ({ PARAGRAPH: '', H1: '# ', H2: '## ', QUOTE: '> ', BULLET: '- ', NUMBERED: `${index + 1}. `, TODO: '- [ ] ', CODE: '``` ' })[kind] }
function continuationPrefix(block: ReturnType<typeof describeBlock>, index: number) { if (block.kind === 'NUMBERED') return `${index + 1}. `; return prefixFor(block.kind, index) }
function focusAt(element: HTMLTextAreaElement | null | undefined, position: number) { if (!element) return; element.focus(); element.setSelectionRange(position, position); resize(element) }
function resize(element: HTMLTextAreaElement | null | undefined) { if (!element) return; element.style.height = '0'; element.style.height = `${Math.max(32, element.scrollHeight)}px` }
function exactCard(line: string) { const trimmed = line.trim(); const cards = parseContentCardTokens(trimmed); const card = cards[0]; return card && card.start === 0 && card.end === trimmed.length ? card : null }
function kindLabel(kind: BlockKind) { return blockKinds.find((item) => item.kind === kind)?.label ?? '正文' }
function kindGlyph(kind: BlockKind, index: number) { return ({ PARAGRAPH: '', H1: 'H1', H2: 'H2', QUOTE: '❞', BULLET: '•', NUMBERED: `${index + 1}.`, TODO: '', CODE: '</>' })[kind] }
function cardLabel(cardId: string) { return ({ image: '图片', attachment: '附件', audio: '音频', video: '视频', 'file-preview': '文件预览', pdf: 'PDF', office: 'Office 文档', poll: '投票', checkin: '打卡', status: '状态', table: '表格', columns: '分栏', quote: '引用', callout: '提示', youtube: 'YouTube', bilibili: '哔哩哔哩', music: '音乐', map: '地图', figma: 'Figma' } as Record<string, string>)[cardId] ?? cardId }
function transferFiles(transfer: DataTransfer) {
  const files = Array.from(transfer.files ?? [])
  if (files.length) return files
  return Array.from(transfer.items ?? []).flatMap((item) => item.kind === 'file' && item.getAsFile() ? [item.getAsFile()!] : [])
}
