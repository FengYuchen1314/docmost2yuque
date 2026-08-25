import { type CSSProperties, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, GitBranch, Plus, Sigma, Trash2, Workflow } from 'lucide-react'

type MindNode = { id: string; parentId: string | null; text: string }
type DiagramKind = 'flowchart' | 'mermaid' | 'uml'
type GraphNode = { id: string; label: string; shape: 'RECT' | 'ELLIPSE' | 'DIAMOND' }
type GraphEdge = { source: string; target: string; label: string }

export function MindMapEditor({ data, onChange }: { data: Record<string, unknown>; onChange: (value: Record<string, unknown>) => void }) {
  const root = stringOf(data.root, '中心主题')
  const nodes = normalizeMindNodes(data.nodes)
  const update = (next: MindNode[]) => onChange({ ...data, root, nodes: next })
  const descendants = (id: string) => { const result = new Set([id]); let changed = true; while (changed) { changed = false; for (const node of nodes) if (node.parentId && result.has(node.parentId) && !result.has(node.id)) { result.add(node.id); changed = true } } return result }
  const add = (parentId: string | null) => update([...nodes, { id: crypto.randomUUID(), parentId, text: parentId ? '新分支' : `主题 ${nodes.filter((node) => node.parentId === null).length + 1}` }])
  const move = (id: string, delta: number) => { const node = nodes.find((item) => item.id === id); if (!node) return; const siblings = nodes.filter((item) => item.parentId === node.parentId); const siblingIndex = siblings.findIndex((item) => item.id === id); const target = siblings[siblingIndex + delta]; if (!target) return; const from = nodes.findIndex((item) => item.id === id); const to = nodes.findIndex((item) => item.id === target.id); const next = [...nodes]; [next[from], next[to]] = [next[to]!, next[from]!]; update(next) }
  return <div className="mind-map-editor"><label className="field"><span className="field-label">中心主题</span><input aria-label="思维导图中心主题" value={root} maxLength={300} onChange={(event) => onChange({ ...data, root: event.target.value, nodes })} /></label><header><div><GitBranch /><span><strong>分支结构</strong><small>支持无限层级；最多 500 个节点</small></span></div><button type="button" className="button quiet small" disabled={nodes.length >= 500} onClick={() => add(null)}><Plus />添加主分支</button></header><div className="mind-map-node-list">{nodes.map((node, index) => { const depth = mindDepth(node, nodes); const siblings = nodes.filter((item) => item.parentId === node.parentId); const siblingIndex = siblings.findIndex((item) => item.id === node.id); return <div key={node.id} style={{ '--mind-depth': depth } as CSSProperties}><i /><input aria-label={`思维导图节点 ${index + 1}`} value={node.text} maxLength={300} onChange={(event) => update(nodes.map((item) => item.id === node.id ? { ...item, text: event.target.value } : item))} /><button type="button" title="上移" disabled={siblingIndex <= 0} onClick={() => move(node.id, -1)}><ArrowUp /></button><button type="button" title="下移" disabled={siblingIndex === siblings.length - 1} onClick={() => move(node.id, 1)}><ArrowDown /></button><button type="button" title="添加子分支" disabled={nodes.length >= 500} onClick={() => add(node.id)}><Plus /></button><button type="button" title="删除分支" className="danger" onClick={() => { const remove = descendants(node.id); update(nodes.filter((item) => !remove.has(item.id))) }}><Trash2 /></button></div> })}{!nodes.length && <p>还没有分支。添加主分支后，可以继续添加任意层级的子分支。</p>}</div><MindMapCardView data={{ ...data, root, nodes }} compact /></div>
}

export function MindMapCardView({ data, compact = false }: { data: Record<string, unknown>; compact?: boolean }) {
  const root = stringOf(data.root, '中心主题')
  const nodes = normalizeMindNodes(data.nodes)
  const children = (parentId: string | null) => nodes.filter((node) => node.parentId === parentId)
  const branch = (node: MindNode): ReactNode => <li key={node.id}><span>{node.text || '未命名主题'}</span>{children(node.id).length > 0 && <ul>{children(node.id).map(branch)}</ul>}</li>
  return <article className={`content-card mind-map-visual ${compact ? 'compact' : ''}`}><header><GitBranch /><div><small>思维导图</small><strong>{root}</strong></div><span>{nodes.length} 个分支</span></header>{nodes.length ? <div className="mind-map-tree"><span className="mind-root">{root}</span><ul>{children(null).map(branch)}</ul></div> : <div className="mind-map-empty">围绕「{root}」添加分支</div>}</article>
}

export function DiagramSourceEditor({ cardId, source, onChange }: { cardId: DiagramKind; source: string; onChange: (value: string) => void }) {
  return <div className="diagram-source-editor"><label className="field"><span className="field-label">图表源码</span><textarea className="monospace-input" aria-label="图表源码" rows={8} value={source} maxLength={64_000} onChange={(event) => onChange(event.target.value)} /></label><div><strong>实时预览</strong><small>解析在浏览器本地完成，不执行脚本、HTML 或远程资源。</small></div><TechnicalDiagramCard cardId={cardId} source={source} compact /></div>
}

export function TechnicalDiagramCard({ cardId, source, compact = false }: { cardId: DiagramKind; source: string; compact?: boolean }) {
  if (cardId === 'uml') return <SequenceDiagram source={source} compact={compact} />
  const graph = parseGraph(source)
  const horizontal = /^\s*(?:graph|flowchart)\s+(?:LR|RL)/im.test(source)
  const columns = horizontal ? Math.max(1, graph.nodes.length) : Math.min(4, Math.max(1, graph.nodes.length))
  const width = Math.max(340, columns * 180)
  const rows = horizontal ? 1 : Math.ceil(graph.nodes.length / columns)
  const height = Math.max(180, rows * 125)
  const positions = new Map(graph.nodes.map((node, index) => [node.id, horizontal ? { x: 90 + index * 180, y: 80 } : { x: 90 + index % columns * 180, y: 70 + Math.floor(index / columns) * 125 }]))
  return <article className={`content-card technical-diagram ${compact ? 'compact' : ''}`}><header><Workflow /><strong>{cardId === 'mermaid' ? 'Mermaid' : '流程图'}</strong><small>{graph.nodes.length} 个节点 · {graph.edges.length} 条连线</small></header>{graph.nodes.length ? <div><svg role="img" aria-label={`${cardId === 'mermaid' ? 'Mermaid' : '流程图'}预览`} viewBox={`0 0 ${width} ${height}`}><defs><marker id={`diagram-arrow-${cardId}`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" /></marker></defs>{graph.edges.map((edge, index) => { const from = positions.get(edge.source); const to = positions.get(edge.target); if (!from || !to) return null; return <g key={`${edge.source}-${edge.target}-${index}`}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} markerEnd={`url(#diagram-arrow-${cardId})`} />{edge.label && <text className="edge-label" x={(from.x + to.x) / 2} y={(from.y + to.y) / 2 - 7}>{edge.label}</text>}</g> })}{graph.nodes.map((node) => { const point = positions.get(node.id)!; return <g className={`diagram-node shape-${node.shape.toLowerCase()}`} key={node.id} transform={`translate(${point.x},${point.y})`}>{node.shape === 'ELLIPSE' ? <ellipse rx="67" ry="30" /> : node.shape === 'DIAMOND' ? <polygon points="0,-39 73,0 0,39 -73,0" /> : <rect x="-73" y="-34" width="146" height="68" rx="8" />}<text>{node.label}</text></g>})}</svg></div> : <DiagramEmpty source={source} />}</article>
}

export function FormulaCardView({ latex, compact = false }: { latex: string; compact?: boolean }) {
  const value = latex.trim()
  return <article className={`content-card rendered-formula ${compact ? 'compact' : ''}`}><header><Sigma /><strong>数学公式</strong></header>{value ? <div role="math" aria-label={value}>{formulaNodes(value)}</div> : <p>输入 LaTeX 公式后在这里预览</p>}<code>{value}</code></article>
}

function SequenceDiagram({ source, compact }: { source: string; compact: boolean }) {
  const sequence = parseSequence(source)
  const width = Math.max(360, sequence.actors.length * 170)
  const height = Math.max(190, 95 + sequence.messages.length * 58)
  const x = new Map(sequence.actors.map((actor, index) => [actor, 85 + index * 170]))
  return <article className={`content-card technical-diagram sequence-diagram ${compact ? 'compact' : ''}`}><header><Workflow /><strong>UML 时序图</strong><small>{sequence.actors.length} 个参与者 · {sequence.messages.length} 条消息</small></header>{sequence.actors.length ? <div><svg role="img" aria-label="UML 时序图预览" viewBox={`0 0 ${width} ${height}`}><defs><marker id="uml-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L0,8 L8,4 z" /></marker></defs>{sequence.actors.map((actor) => <g key={actor}><rect x={x.get(actor)! - 58} y="18" width="116" height="38" rx="6" /><text x={x.get(actor)} y="42">{actor}</text><line className="lifeline" x1={x.get(actor)} y1="56" x2={x.get(actor)} y2={height - 18} /></g>)}{sequence.messages.map((message, index) => { const y = 88 + index * 58; return <g key={index}><line x1={x.get(message.source)} y1={y} x2={x.get(message.target)} y2={y} markerEnd="url(#uml-arrow)" /><text className="edge-label" x={(x.get(message.source)! + x.get(message.target)!) / 2} y={y - 8}>{message.label}</text></g> })}</svg></div> : <DiagramEmpty source={source} />}</article>
}

function DiagramEmpty({ source }: { source: string }) { return <div className="diagram-empty"><Workflow /><strong>{source.trim() ? '暂未识别出节点或连线' : '输入图表源码'}</strong><p>支持 Mermaid/流程图的 A[开始] --&gt; B&#123;判断&#125;，以及 UML 的 Alice -&gt; Bob: 消息。</p></div> }

function parseGraph(source: string) {
  const nodes = new Map<string, GraphNode>()
  const edges: GraphEdge[] = []
  for (const raw of source.split(/\r?\n/).slice(0, 2_000)) {
    const line = raw.trim().replace(/;$/, '')
    if (!line || /^(graph|flowchart)\s+(TD|TB|BT|LR|RL)$/i.test(line) || line.startsWith('%%')) continue
    const match = line.match(/^(.+?)\s*(?:-->|==>|---|->)\s*(?:\|([^|]{1,300})\|\s*)?(.+)$/)
    if (!match) { const single = parseNode(matchNodeSource(line)); if (single) nodes.set(single.id, single); continue }
    const sourceNode = parseNode(matchNodeSource(match[1]!)); const targetNode = parseNode(matchNodeSource(match[3]!))
    if (!sourceNode || !targetNode) continue
    nodes.set(sourceNode.id, mergeNode(nodes.get(sourceNode.id), sourceNode)); nodes.set(targetNode.id, mergeNode(nodes.get(targetNode.id), targetNode))
    edges.push({ source: sourceNode.id, target: targetNode.id, label: match[2]?.trim() ?? '' })
    if (nodes.size >= 200 || edges.length >= 500) break
  }
  return { nodes: [...nodes.values()], edges }
}

function parseNode(value: string): GraphNode | null {
  const match = value.trim().match(/^([\p{L}\p{N}_.-]{1,64})(?:\[([^\]]{1,300})\]|\{([^}]{1,300})\}|\(([^)]{1,300})\))?$/u)
  if (!match) return null
  return { id: match[1]!, label: (match[2] ?? match[3] ?? match[4] ?? match[1]!).trim(), shape: match[3] ? 'DIAMOND' : match[4] ? 'ELLIPSE' : 'RECT' }
}

function matchNodeSource(value: string) { return value.trim().replace(/^[-.]+|[-.]+$/g, '').trim() }
function mergeNode(existing: GraphNode | undefined, next: GraphNode) { return existing && existing.label !== existing.id && next.label === next.id ? existing : next }

function parseSequence(source: string) {
  const actors: string[] = []
  const messages: Array<{ source: string; target: string; label: string }> = []
  const addActor = (actor: string) => { if (actor && !actors.includes(actor) && actors.length < 30) actors.push(actor) }
  for (const raw of source.split(/\r?\n/).slice(0, 1_000)) {
    const line = raw.trim()
    const declaration = line.match(/^(?:actor|participant)\s+"?([^"\s]+)"?/i)
    if (declaration) { addActor(declaration[1]!); continue }
    const message = line.match(/^([\p{L}\p{N}_.-]{1,64})\s*-+>?\s*([\p{L}\p{N}_.-]{1,64})\s*:\s*(.{1,500})$/u)
    if (!message) continue
    addActor(message[1]!); addActor(message[2]!); messages.push({ source: message[1]!, target: message[2]!, label: message[3]!.trim() })
    if (messages.length >= 300) break
  }
  return { actors, messages }
}

function formulaNodes(source: string): ReactNode[] {
  const output: ReactNode[] = []
  let text = ''
  const flush = () => { if (text) { output.push(text); text = '' } }
  for (let index = 0; index < source.length;) {
    if (source.startsWith('\\frac', index)) {
      const numerator = readGroup(source, index + 5); const denominator = numerator && readGroup(source, numerator.end)
      if (numerator && denominator) { flush(); output.push(<span className="formula-frac" key={index}><span>{formulaNodes(numerator.value)}</span><span>{formulaNodes(denominator.value)}</span></span>); index = denominator.end; continue }
    }
    const command = source.slice(index).match(/^\\([A-Za-z]+)/)
    if (command) { const symbol = formulaSymbols[command[1]!] ?? `\\${command[1]}`; text += symbol; index += command[0].length; continue }
    if (source[index] === '^' || source[index] === '_') {
      const tag = source[index] === '^' ? 'sup' : 'sub'; const group = readGroup(source, index + 1); const raw = group ? group.value : source[index + 1] ?? ''
      flush(); output.push(tag === 'sup' ? <sup key={index}>{formulaNodes(raw)}</sup> : <sub key={index}>{formulaNodes(raw)}</sub>); index = group ? group.end : index + 2; continue
    }
    if (source[index] === '{' || source[index] === '}') { index += 1; continue }
    text += source[index]; index += 1
  }
  flush()
  return output
}

function readGroup(source: string, start: number) { if (source[start] !== '{') return null; let depth = 0; for (let index = start; index < source.length; index += 1) { if (source[index] === '{') depth += 1; else if (source[index] === '}' && --depth === 0) return { value: source.slice(start + 1, index), end: index + 1 } } return null }
function normalizeMindNodes(value: unknown): MindNode[] { if (!Array.isArray(value)) return []; const ids = new Set<string>(); return value.slice(0, 500).flatMap((raw, index) => { const item = record(raw); const id = stringOf(item?.id, `node-${index + 1}`); if (!id || ids.has(id)) return []; ids.add(id); return [{ id, parentId: typeof item?.parentId === 'string' ? item.parentId : null, text: stringOf(item?.text, '').slice(0, 300) }] }).filter((node) => node.parentId === null || ids.has(node.parentId)) }
function mindDepth(node: MindNode, nodes: MindNode[]) { const byId = new Map(nodes.map((item) => [item.id, item])); let depth = 0; let current = node; const seen = new Set([node.id]); while (current.parentId && depth < 12) { if (seen.has(current.parentId)) break; seen.add(current.parentId); const parent = byId.get(current.parentId); if (!parent) break; current = parent; depth += 1 } return depth }
function record(value: unknown): Record<string, unknown> | undefined { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined }
function stringOf(value: unknown, fallback: string) { return typeof value === 'string' ? value : fallback }

const formulaSymbols: Record<string, string> = { alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', theta: 'θ', lambda: 'λ', mu: 'μ', pi: 'π', sigma: 'σ', phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', times: '×', cdot: '·', div: '÷', pm: '±', le: '≤', ge: '≥', ne: '≠', approx: '≈', infty: '∞', sum: '∑', prod: '∏', int: '∫', sqrt: '√', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔' }
