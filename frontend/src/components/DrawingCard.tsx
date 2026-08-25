import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ArrowRight, BringToFront, Circle, Copy, Diamond, Download, Hand, MousePointer2, Pencil,
  Redo2, SendToBack, Square, StickyNote, Trash2, Type, Undo2, Upload, ZoomIn, ZoomOut,
} from 'lucide-react'

type CardId = 'whiteboard' | 'drawio' | 'excalidraw'
type DrawingKind = 'RECT' | 'ELLIPSE' | 'DIAMOND' | 'STICKY' | 'TEXT' | 'ARROW' | 'FREEDRAW'
type Point = [number, number]
type Viewport = { x: number; y: number; zoom: number }
type DrawingElement = {
  id: string
  kind: DrawingKind
  x: number
  y: number
  width: number
  height: number
  text: string
  color: string
  points?: Point[]
}
type DrawioEdge = { id: string; source: string; target: string; label: string }
type DrawingModel = { viewport: Viewport; elements: DrawingElement[]; edges: DrawioEdge[] }

const colors = ['#ffffff', '#fff1a8', '#dff3e6', '#dcecff', '#f2e1ff', '#ffe1dd']

export function DrawingCardEditor({ cardId, data, onChange }: { cardId: CardId; data: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const model = useMemo(() => normalizeModel(cardId, data), [cardId, data])
  const [selected, setSelected] = useState<string | null>(null)
  const [tool, setTool] = useState<'SELECT' | 'HAND' | 'CONNECT' | 'FREEDRAW'>('SELECT')
  const [connectionStart, setConnectionStart] = useState<string | null>(null)
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [future, setFuture] = useState<Record<string, unknown>[]>([])
  const [xmlDraft, setXmlDraft] = useState(() => typeof data.xml === 'string' ? data.xml : '')
  const [xmlError, setXmlError] = useState('')
  const drag = useRef<{ id: string; clientX: number; clientY: number; x: number; y: number; before: Record<string, unknown> } | null>(null)
  const stroke = useRef<{ id: string; startX: number; startY: number; points: Point[]; before: Record<string, unknown> } | null>(null)

  useEffect(() => { if (typeof data.xml === 'string') setXmlDraft(data.xml) }, [data.xml])

  const emit = (next: DrawingModel, remember = true) => {
    if (remember) {
      setHistory((items) => [...items.slice(-79), structuredClone(data)])
      setFuture([])
    }
    onChange(modelData(cardId, next))
  }
  const add = (kind: DrawingKind) => {
    if (model.elements.length >= 500) return
    const index = model.elements.length
    const size = kind === 'ARROW' ? [190, 28] : kind === 'TEXT' ? [190, 54] : kind === 'STICKY' ? [180, 145] : [170, 100]
    const element: DrawingElement = {
      id: crypto.randomUUID(), kind, x: 70 + index % 5 * 32, y: 70 + index % 4 * 28,
      width: size[0]!, height: size[1]!, text: defaultText(kind), color: kind === 'STICKY' ? '#fff1a8' : '#ffffff',
    }
    emit({ ...model, elements: [...model.elements, element] })
    setSelected(element.id)
    setTool('SELECT')
  }
  const patchElement = (id: string, patch: Partial<DrawingElement>, remember = true) => emit({ ...model, elements: model.elements.map((element) => element.id === id ? { ...element, ...patch } : element) }, remember)
  const removeSelected = () => {
    if (!selected) return
    emit({ ...model, elements: model.elements.filter((element) => element.id !== selected), edges: model.edges.filter((edge) => edge.source !== selected && edge.target !== selected) })
    setSelected(null)
    setConnectionStart(null)
  }
  const reorder = (front: boolean) => {
    if (!selected) return
    const element = model.elements.find((item) => item.id === selected)
    if (!element) return
    const rest = model.elements.filter((item) => item.id !== selected)
    emit({ ...model, elements: front ? [...rest, element] : [element, ...rest] })
  }
  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setFuture((items) => [structuredClone(data), ...items].slice(0, 80))
    setHistory((items) => items.slice(0, -1))
    onChange(previous)
    setSelected(null)
  }
  const redo = () => {
    const next = future[0]
    if (!next) return
    setHistory((items) => [...items.slice(-79), structuredClone(data)])
    setFuture((items) => items.slice(1))
    onChange(next)
    setSelected(null)
  }
  const connect = (nodeId: string) => {
    if (cardId !== 'drawio' || tool !== 'CONNECT') return false
    if (!connectionStart) { setConnectionStart(nodeId); setSelected(nodeId); return true }
    if (connectionStart !== nodeId && model.edges.length < 1_000) {
      emit({ ...model, edges: [...model.edges, { id: crypto.randomUUID(), source: connectionStart, target: nodeId, label: '' }] })
      setConnectionStart(null)
      setTool('SELECT')
      setSelected(nodeId)
    }
    return true
  }
  const beginDrag = (event: ReactPointerEvent, element: DrawingElement) => {
    if (connect(element.id)) return
    if (tool !== 'SELECT') return
    event.stopPropagation()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    setSelected(element.id)
    drag.current = { id: element.id, clientX: event.clientX, clientY: event.clientY, x: element.x, y: element.y, before: structuredClone(data) }
  }
  const pointerMove = (event: ReactPointerEvent) => {
    const currentDrag = drag.current
    if (currentDrag) {
      patchElement(currentDrag.id, { x: currentDrag.x + (event.clientX - currentDrag.clientX) / model.viewport.zoom, y: currentDrag.y + (event.clientY - currentDrag.clientY) / model.viewport.zoom }, false)
      return
    }
    const currentStroke = stroke.current
    if (!currentStroke) return
    const box = event.currentTarget.getBoundingClientRect()
    const point: Point = [(event.clientX - box.left) / model.viewport.zoom - currentStroke.startX, (event.clientY - box.top) / model.viewport.zoom - currentStroke.startY]
    const previous = currentStroke.points.at(-1)
    if (previous && Math.hypot(point[0] - previous[0], point[1] - previous[1]) < 3) return
    currentStroke.points.push(point)
    const bounds = pointBounds(currentStroke.points)
    const element = model.elements.find((item) => item.id === currentStroke.id)
    if (!element) return
    const absolute = currentStroke.points.map(([x, y]) => [x - bounds.minX, y - bounds.minY] as Point)
    patchElement(currentStroke.id, { x: currentStroke.startX + bounds.minX, y: currentStroke.startY + bounds.minY, width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), points: absolute }, false)
  }
  const pointerUp = () => {
    const before = drag.current?.before ?? stroke.current?.before
    if (before) { setHistory((items) => [...items.slice(-79), before]); setFuture([]) }
    drag.current = null
    stroke.current = null
  }
  const beginStroke = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return
    setSelected(null)
    if (tool !== 'FREEDRAW' || cardId !== 'excalidraw' || model.elements.length >= 500) return
    const box = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - box.left) / model.viewport.zoom
    const y = (event.clientY - box.top) / model.viewport.zoom
    const element: DrawingElement = { id: crypto.randomUUID(), kind: 'FREEDRAW', x, y, width: 1, height: 1, text: '', color: '#4b6354', points: [[0, 0], [1, 1]] }
    stroke.current = { id: element.id, startX: x, startY: y, points: [[0, 0]], before: structuredClone(data) }
    emit({ ...model, elements: [...model.elements, element] }, false)
    setSelected(element.id)
  }
  const importXml = () => {
    try {
      const imported = parseDrawioXml(xmlDraft)
      if (!imported) throw new Error('没有找到可导入的 mxGraphModel 节点')
      emit({ ...model, elements: imported.elements, edges: imported.edges })
      setXmlError('')
    } catch (reason) {
      setXmlError(reason instanceof Error ? reason.message : 'XML 导入失败')
    }
  }
  const selectedElement = model.elements.find((element) => element.id === selected)
  const zoom = model.viewport.zoom
  return <div className={`drawing-card-editor drawing-${cardId}`} tabIndex={0} onKeyDown={(event) => { if ((event.key === 'Delete' || event.key === 'Backspace') && !(event.target instanceof HTMLInputElement) && !(event.target instanceof HTMLTextAreaElement)) { event.preventDefault(); removeSelected() } }}>
    <div className="drawing-toolbar" role="toolbar" aria-label={`${drawingTitle(cardId)}工具栏`}>
      <ToolButton title="选择" active={tool === 'SELECT'} onClick={() => { setTool('SELECT'); setConnectionStart(null) }}><MousePointer2 /></ToolButton>
      <ToolButton title="平移" active={tool === 'HAND'} onClick={() => setTool('HAND')}><Hand /></ToolButton><i />
      <ToolButton title="矩形" onClick={() => add('RECT')}><Square /></ToolButton>
      <ToolButton title="椭圆" onClick={() => add('ELLIPSE')}><Circle /></ToolButton>
      {(cardId === 'drawio' || cardId === 'excalidraw') && <ToolButton title="菱形" onClick={() => add('DIAMOND')}><Diamond /></ToolButton>}
      {cardId === 'whiteboard' && <ToolButton title="便签" onClick={() => add('STICKY')}><StickyNote /></ToolButton>}
      <ToolButton title="文本" onClick={() => add('TEXT')}><Type /></ToolButton>
      {cardId === 'drawio'
        ? <ToolButton title={connectionStart ? '请选择目标节点' : '连接节点'} active={tool === 'CONNECT'} onClick={() => { setTool('CONNECT'); setConnectionStart(null) }}><ArrowRight /></ToolButton>
        : <ToolButton title="箭头" onClick={() => add('ARROW')}><ArrowRight /></ToolButton>}
      {cardId === 'excalidraw' && <ToolButton title="自由绘制" active={tool === 'FREEDRAW'} onClick={() => setTool('FREEDRAW')}><Pencil /></ToolButton>}
      <i /><ToolButton title="撤销" disabled={!history.length} onClick={undo}><Undo2 /></ToolButton><ToolButton title="重做" disabled={!future.length} onClick={redo}><Redo2 /></ToolButton>
      {selectedElement && <><i /><ToolButton title="置于顶层" onClick={() => reorder(true)}><BringToFront /></ToolButton><ToolButton title="置于底层" onClick={() => reorder(false)}><SendToBack /></ToolButton><ToolButton title="复制" onClick={() => { const clone = { ...selectedElement, id: crypto.randomUUID(), x: selectedElement.x + 24, y: selectedElement.y + 24 }; emit({ ...model, elements: [...model.elements, clone] }); setSelected(clone.id) }}><Copy /></ToolButton><ToolButton title="删除" danger onClick={removeSelected}><Trash2 /></ToolButton></>}
    </div>
    {connectionStart && <div className="drawing-connect-hint">已选择起点，请点击另一个节点完成连线</div>}
    <div className="drawing-canvas" onPointerDown={beginStroke} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <div className="drawing-surface" style={{ transform: `translate(${model.viewport.x}px,${model.viewport.y}px) scale(${zoom})` }}>
        <DrawingSvg model={model} cardId={cardId} />
        {model.elements.filter((element) => !['ARROW', 'FREEDRAW'].includes(element.kind)).map((element) => <div key={element.id} className={`drawing-element kind-${element.kind.toLowerCase()} ${selected === element.id ? 'selected' : ''} ${connectionStart === element.id ? 'connection-start' : ''}`} style={{ left: element.x, top: element.y, width: element.width, height: element.height, background: element.color } as CSSProperties} onPointerDown={(event) => beginDrag(event, element)} onClick={() => connect(element.id)}><textarea aria-label={`${drawingKindLabel(element.kind)}文字`} value={element.text} maxLength={4_000} onPointerDown={(event) => { if (tool === 'CONNECT') { event.preventDefault(); connect(element.id) } else event.stopPropagation() }} onChange={(event) => patchElement(element.id, { text: event.target.value })} placeholder="输入文字" /></div>)}
        {!model.elements.length && <div className="drawing-empty"><Pencil /><strong>从一个图形开始</strong><p>{cardId === 'excalidraw' ? '添加图形，或选择自由绘制后在画布上书写。' : cardId === 'drawio' ? '添加两个节点，再用连接工具建立关系。' : '添加图形、便签、文字和箭头并自由排列。'}</p></div>}
      </div>
      <div className="drawing-zoom"><button type="button" title="缩小" onClick={() => emit({ ...model, viewport: { ...model.viewport, zoom: clamp(zoom - .1, .25, 3) } }, false)}><ZoomOut /></button><span>{Math.round(zoom * 100)}%</span><button type="button" title="放大" onClick={() => emit({ ...model, viewport: { ...model.viewport, zoom: clamp(zoom + .1, .25, 3) } }, false)}><ZoomIn /></button></div>
    </div>
    {selectedElement && !['ARROW', 'FREEDRAW'].includes(selectedElement.kind) && <div className="drawing-inspector"><label><span>宽</span><input aria-label="图形宽度" type="number" min="20" max="2000" value={Math.round(selectedElement.width)} onChange={(event) => patchElement(selectedElement.id, { width: clamp(Number(event.target.value), 20, 2_000) })} /></label><label><span>高</span><input aria-label="图形高度" type="number" min="20" max="2000" value={Math.round(selectedElement.height)} onChange={(event) => patchElement(selectedElement.id, { height: clamp(Number(event.target.value), 20, 2_000) })} /></label><label><span>填充</span><input aria-label="图形填充色" type="color" value={selectedElement.color} onChange={(event) => patchElement(selectedElement.id, { color: event.target.value })} /></label><button type="button" onClick={() => patchElement(selectedElement.id, { color: colors[(colors.indexOf(selectedElement.color) + 1) % colors.length] })}>换一组颜色</button></div>}
    {cardId === 'drawio' && <details className="drawio-xml"><summary><Download />mxGraph XML 导入与导出</summary><textarea aria-label="Draw.io XML" value={xmlDraft} maxLength={250_000} onChange={(event) => setXmlDraft(event.target.value)} /><footer><small>支持未压缩的 mxGraph XML；导入时只读取节点、连线、位置、尺寸和安全文本。</small><button type="button" className="button secondary small" onClick={importXml}><Upload />导入 XML</button></footer>{xmlError && <div className="inline-error" role="alert">{xmlError}</div>}</details>}
  </div>
}

export function DrawingCardView({ cardId, data }: { cardId: CardId; data: Record<string, unknown> }) {
  const model = normalizeModel(cardId, data)
  const bounds = drawingBounds(model.elements)
  return <article className={`content-card drawing-card-view drawing-${cardId}`}><header><Pencil /><strong>{drawingTitle(cardId)}</strong><small>{model.elements.length} 个图形{model.edges.length ? ` · ${model.edges.length} 条连线` : ''}</small></header><div><div className="drawing-view-surface" style={{ width: bounds.width, height: bounds.height, transform: `scale(${bounds.scale})`, transformOrigin: '0 0' }}><DrawingSvg model={{ ...model, elements: model.elements.map((element) => ({ ...element, x: element.x - bounds.minX, y: element.y - bounds.minY })) }} cardId={cardId} />{model.elements.filter((element) => !['ARROW', 'FREEDRAW'].includes(element.kind)).map((element) => <div key={element.id} className={`drawing-element kind-${element.kind.toLowerCase()}`} style={{ left: element.x - bounds.minX, top: element.y - bounds.minY, width: element.width, height: element.height, background: element.color } as CSSProperties}><span>{element.text}</span></div>)}</div></div></article>
}

function DrawingSvg({ model, cardId }: { model: DrawingModel; cardId: CardId }) {
  const byId = new Map(model.elements.map((element) => [element.id, element]))
  return <svg className="drawing-svg" width="3000" height="2200" aria-hidden="true"><defs><marker id={`drawing-arrow-${cardId}`} markerWidth="9" markerHeight="9" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" /></marker></defs>{model.edges.map((edge) => { const source = byId.get(edge.source); const target = byId.get(edge.target); if (!source || !target) return null; return <g key={edge.id}><line x1={source.x + source.width / 2} y1={source.y + source.height / 2} x2={target.x + target.width / 2} y2={target.y + target.height / 2} markerEnd={`url(#drawing-arrow-${cardId})`} />{edge.label && <text x={(source.x + source.width / 2 + target.x + target.width / 2) / 2} y={(source.y + source.height / 2 + target.y + target.height / 2) / 2}>{edge.label}</text>}</g> })}{model.elements.filter((element) => element.kind === 'ARROW').map((element) => <line key={element.id} x1={element.x} y1={element.y + element.height / 2} x2={element.x + element.width} y2={element.y + element.height / 2} markerEnd={`url(#drawing-arrow-${cardId})`} />)}{model.elements.filter((element) => element.kind === 'FREEDRAW').map((element) => <polyline key={element.id} points={(element.points ?? []).map(([x, y]) => `${element.x + x},${element.y + y}`).join(' ')} />)}</svg>
}

function ToolButton({ title, active = false, disabled = false, danger = false, onClick, children }: { title: string; active?: boolean; disabled?: boolean; danger?: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" title={title} aria-label={title} className={`${active ? 'active' : ''} ${danger ? 'danger' : ''}`} disabled={disabled} onClick={onClick}>{children}<span>{title}</span></button>
}

function normalizeModel(cardId: CardId, data: Record<string, unknown>): DrawingModel {
  const viewportRecord = record(data.viewport)
  const viewport = { x: finite(viewportRecord?.x, 0), y: finite(viewportRecord?.y, 0), zoom: clamp(finite(viewportRecord?.zoom, 1), .25, 3) }
  if (cardId === 'drawio') {
    const nodes = normalizeElements(data.nodes, false)
    const parsed = !nodes.length && typeof data.xml === 'string' ? parseDrawioXml(data.xml, true) : null
    const elements = nodes.length ? nodes : parsed?.elements ?? []
    return { viewport, elements, edges: normalizeEdges(data.edges, new Set(elements.map((element) => element.id))).length ? normalizeEdges(data.edges, new Set(elements.map((element) => element.id))) : parsed?.edges ?? [] }
  }
  return { viewport, elements: normalizeElements(data.elements, cardId === 'excalidraw'), edges: [] }
}

function normalizeElements(value: unknown, allowFreehand: boolean): DrawingElement[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, 500).flatMap((raw, index) => {
    const item = record(raw)
    const id = stringOf(item?.id, `element-${index + 1}`)
    const kind = stringOf(item?.kind, 'RECT').toUpperCase() as DrawingKind
    if (ids.has(id) || !['RECT', 'ELLIPSE', 'DIAMOND', 'STICKY', 'TEXT', 'ARROW', ...(allowFreehand ? ['FREEDRAW'] : [])].includes(kind)) return []
    ids.add(id)
    const points = kind === 'FREEDRAW' && Array.isArray(item?.points) ? item.points.slice(0, 2_000).flatMap((point) => Array.isArray(point) && point.length === 2 ? [[finite(point[0], 0), finite(point[1], 0)] as Point] : []) : undefined
    return [{ id, kind, x: finite(item?.x, 0), y: finite(item?.y, 0), width: clamp(finite(item?.width, 160), 1, 20_000), height: clamp(finite(item?.height, 90), 1, 20_000), text: stringOf(item?.text, '').slice(0, 4_000), color: /^#[\da-f]{6}$/i.test(stringOf(item?.color, '')) ? stringOf(item?.color, '') : '#ffffff', ...(points ? { points } : {}) }]
  })
}

function normalizeEdges(value: unknown, nodeIds: Set<string>): DrawioEdge[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  return value.slice(0, 1_000).flatMap((raw, index) => { const item = record(raw); const id = stringOf(item?.id, `edge-${index + 1}`); const source = stringOf(item?.source, ''); const target = stringOf(item?.target, ''); if (ids.has(id) || source === target || !nodeIds.has(source) || !nodeIds.has(target)) return []; ids.add(id); return [{ id, source, target, label: stringOf(item?.label, '').slice(0, 1_000) }] })
}

function modelData(cardId: CardId, model: DrawingModel): Record<string, unknown> {
  if (cardId === 'drawio') return { type: 'drawio', viewport: model.viewport, nodes: model.elements.filter((element) => !['ARROW', 'FREEDRAW', 'STICKY'].includes(element.kind)), edges: model.edges, xml: serializeDrawio(model) }
  return { type: cardId, viewport: model.viewport, elements: model.elements }
}

function serializeDrawio(model: DrawingModel) {
  const nodes = model.elements.filter((element) => !['ARROW', 'FREEDRAW', 'STICKY'].includes(element.kind)).map((node) => `<mxCell id="${xml(node.id)}" value="${xml(node.text)}" style="${drawioStyle(node)}" vertex="1" parent="1"><mxGeometry x="${round(node.x)}" y="${round(node.y)}" width="${round(node.width)}" height="${round(node.height)}" as="geometry"/></mxCell>`).join('')
  const edges = model.edges.map((edge) => `<mxCell id="${xml(edge.id)}" value="${xml(edge.label)}" edge="1" parent="1" source="${xml(edge.source)}" target="${xml(edge.target)}"><mxGeometry relative="1" as="geometry"/></mxCell>`).join('')
  return `<mxfile><diagram name="Page-1"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/>${nodes}${edges}</root></mxGraphModel></diagram></mxfile>`
}

function parseDrawioXml(source: string, quiet = false): { elements: DrawingElement[]; edges: DrawioEdge[] } | null {
  if (!source.trim()) return null
  if (/<!DOCTYPE|<!ENTITY/i.test(source)) { if (quiet) return null; throw new Error('不允许包含 DOCTYPE 或 ENTITY') }
  const document = new DOMParser().parseFromString(source, 'application/xml')
  if (document.querySelector('parsererror')) { if (quiet) return null; throw new Error('XML 格式无效') }
  const nodes: DrawingElement[] = []
  const edges: DrawioEdge[] = []
  for (const cell of Array.from(document.querySelectorAll('mxCell'))) {
    const id = cell.getAttribute('id') ?? ''
    if (!id || id === '0' || id === '1') continue
    if (cell.getAttribute('vertex') === '1') {
      const geometry = cell.querySelector('mxGeometry')
      if (!geometry) continue
      const style = cell.getAttribute('style') ?? ''
      const kind: DrawingKind = style.includes('ellipse') ? 'ELLIPSE' : style.includes('rhombus') ? 'DIAMOND' : style.includes('text;') ? 'TEXT' : 'RECT'
      const color = /fillColor=(#[\da-f]{6})/i.exec(style)?.[1] ?? '#ffffff'
      nodes.push({ id: id.slice(0, 64), kind, x: finite(Number(geometry.getAttribute('x')), 0), y: finite(Number(geometry.getAttribute('y')), 0), width: clamp(finite(Number(geometry.getAttribute('width')), 160), 1, 20_000), height: clamp(finite(Number(geometry.getAttribute('height')), 90), 1, 20_000), text: plainLabel(cell.getAttribute('value') ?? '').slice(0, 4_000), color })
    } else if (cell.getAttribute('edge') === '1') {
      edges.push({ id: id.slice(0, 64), source: (cell.getAttribute('source') ?? '').slice(0, 64), target: (cell.getAttribute('target') ?? '').slice(0, 64), label: plainLabel(cell.getAttribute('value') ?? '').slice(0, 1_000) })
    }
  }
  const ids = new Set(nodes.map((node) => node.id))
  return { elements: nodes.slice(0, 500), edges: edges.filter((edge) => edge.source !== edge.target && ids.has(edge.source) && ids.has(edge.target)).slice(0, 1_000) }
}

function drawioStyle(node: DrawingElement) { const shape = node.kind === 'ELLIPSE' ? 'ellipse;' : node.kind === 'DIAMOND' ? 'rhombus;' : node.kind === 'TEXT' ? 'text;html=0;strokeColor=none;' : 'rounded=1;'; return `${shape}whiteSpace=wrap;html=0;fillColor=${node.color};` }
function drawingBounds(elements: DrawingElement[]) { const visible = elements.length ? elements : [{ x: 0, y: 0, width: 600, height: 260 }]; const minX = Math.min(...visible.map((element) => element.x)) - 24; const minY = Math.min(...visible.map((element) => element.y)) - 24; const width = Math.max(320, Math.max(...visible.map((element) => element.x + element.width)) - minX + 24); const height = Math.max(180, Math.max(...visible.map((element) => element.y + element.height)) - minY + 24); return { minX, minY, width, height, scale: Math.min(1, 760 / width, 380 / height) } }
function pointBounds(points: Point[]) { const xs = points.map((point) => point[0]); const ys = points.map((point) => point[1]); const minX = Math.min(...xs); const minY = Math.min(...ys); return { minX, minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY } }
function drawingTitle(cardId: CardId) { return cardId === 'whiteboard' ? '画板' : cardId === 'drawio' ? 'Draw.io 图表' : 'Excalidraw 手绘' }
function drawingKindLabel(kind: DrawingKind) { return ({ RECT: '矩形', ELLIPSE: '椭圆', DIAMOND: '菱形', STICKY: '便签', TEXT: '文本', ARROW: '箭头', FREEDRAW: '自由线' } as Record<DrawingKind, string>)[kind] }
function defaultText(kind: DrawingKind) { return kind === 'STICKY' ? '便签内容' : kind === 'TEXT' ? '文本' : kind === 'ARROW' || kind === 'FREEDRAW' ? '' : '输入文字' }
function plainLabel(value: string) { const element = document.createElement('textarea'); element.innerHTML = value.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]*>/g, ''); return element.value }
function xml(value: string) { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function round(value: number) { return Math.round(value * 100) / 100 }
function clamp(value: number, minimum: number, maximum: number) { return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum)) }
function finite(value: unknown, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? value : fallback }
function stringOf(value: unknown, fallback: string) { return typeof value === 'string' ? value : fallback }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
