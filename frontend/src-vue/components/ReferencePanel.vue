<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { EmbeddedPageView, KnowledgeGraph, Page, PageEmbedMode, PageReferenceSummary } from '../../src/types'
import { messageOf, post } from '../services/api'

type ReferenceTab = 'OUTGOING' | 'BACKLINKS' | 'GRAPH' | 'INSERT'

interface ReferenceInsertResult {
  token: string
  targetPageId: string
  knowledgeBaseId: string
  mode: PageEmbedMode
  blockId: string | null
  fixedPublicationId: string | null
}

interface GraphNodeLayout {
  pageId: string
  knowledgeBaseId: string
  title: string
  x: number
  y: number
  root: boolean
}

interface GraphEdgeLayout {
  referenceId: string
  mode: PageEmbedMode
  x1: number
  y1: number
  x2: number
  y2: number
}

const props = withDefaults(defineProps<{
  pageId: string
  pages?: Page[]
  allowInsert?: boolean
  initialTab?: ReferenceTab
  graphDepth?: number
  graphLimit?: number
  closable?: boolean
  navigateOnOpen?: boolean
}>(), {
  pages: () => [],
  allowInsert: false,
  initialTab: 'OUTGOING',
  graphDepth: 3,
  graphLimit: 100,
  closable: false,
  navigateOnOpen: true,
})

const emit = defineEmits<{
  close: []
  insert: [result: ReferenceInsertResult]
  'open-page': [target: { pageId: string; knowledgeBaseId: string }]
}>()

const router = useRouter()
const tab = ref<ReferenceTab>(props.initialTab === 'INSERT' && !props.allowInsert ? 'OUTGOING' : props.initialTab)
const outgoing = ref<PageReferenceSummary[]>([])
const backlinks = ref<PageReferenceSummary[]>([])
const graph = ref<KnowledgeGraph | null>(null)
const previews = ref<Record<string, EmbeddedPageView>>({})
const previewLoadingIds = ref<string[]>([])
const loading = ref(false)
const graphLoading = ref(false)
const error = ref('')
const graphError = ref('')
let relationSequence = 0
let graphSequence = 0
let previewSequence = 0

const search = ref('')
const selectedPageId = ref('')
const insertMode = ref<PageEmbedMode>('LINK')
const blockId = ref('')
const insertMessage = ref('')

const candidates = computed(() => {
  const normalized = search.value.trim().toLocaleLowerCase('zh-CN')
  return props.pages
    .filter((page) => !page.deletedAt && page.id !== props.pageId)
    .filter((page) => !normalized || `${page.title} ${page.path}`.toLocaleLowerCase('zh-CN').includes(normalized))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
})
const visibleCandidates = computed(() => candidates.value.slice(0, 200))
const selectedPage = computed(() => props.pages.find((page) => page.id === selectedPageId.value) ?? null)
const fixedUnavailable = computed(() => insertMode.value === 'FIXED' && !selectedPage.value?.publishedRevisionId)
const sanitizedBlockId = computed(() => blockId.value.trim().replace(/[^\p{L}\p{N}_.:-]/gu, '-').slice(0, 160))
const canInsert = computed(() => Boolean(selectedPage.value && !fixedUnavailable.value))
const graphLayout = computed(() => layoutGraph(graph.value))

watch(() => props.pageId, () => void refresh(), { immediate: true })
watch(tab, (value) => {
  if (value === 'GRAPH' && !graph.value) void loadGraph()
})
watch(() => props.pages, (values) => {
  if (selectedPageId.value && !values.some((page) => page.id === selectedPageId.value)) selectedPageId.value = ''
})
watch(() => props.allowInsert, (allowed) => {
  if (!allowed && tab.value === 'INSERT') tab.value = 'OUTGOING'
})

defineExpose({ refresh })

async function refresh() {
  if (!props.pageId) return
  graph.value = null
  previews.value = {}
  await loadRelations()
  if (tab.value === 'GRAPH') await loadGraph()
}

async function loadRelations() {
  const sequence = ++relationSequence
  loading.value = true
  error.value = ''
  try {
    const [outgoingValues, backlinkValues] = await Promise.all([
      post<PageReferenceSummary[]>('/api/v1/page-references/outgoing', { pageId: props.pageId }),
      post<PageReferenceSummary[]>('/api/v1/page-references/backlinks', { pageId: props.pageId }),
    ])
    if (sequence !== relationSequence) return
    outgoing.value = outgoingValues
    backlinks.value = backlinkValues
    void loadPreviews(outgoingValues)
  } catch (value) {
    if (sequence === relationSequence) error.value = messageOf(value)
  } finally {
    if (sequence === relationSequence) loading.value = false
  }
}

async function loadPreviews(values: PageReferenceSummary[]) {
  const sequence = ++previewSequence
  const resolvable = values.filter((value) => value.accessible && ['CARD', 'LIVE', 'FIXED'].includes(value.mode))
  previewLoadingIds.value = resolvable.map((value) => value.referenceId)
  const results = await Promise.allSettled(resolvable.map((value) => post<EmbeddedPageView>('/api/v1/page-references/resolve', { referenceId: value.referenceId })))
  if (sequence !== previewSequence) return
  const next = { ...previews.value }
  results.forEach((result, index) => {
    const reference = resolvable[index]
    if (reference && result.status === 'fulfilled') next[reference.referenceId] = result.value
  })
  previews.value = next
  previewLoadingIds.value = []
}

async function loadGraph() {
  if (!props.pageId) return
  const sequence = ++graphSequence
  graphLoading.value = true
  graphError.value = ''
  try {
    const value = await post<KnowledgeGraph>('/api/v1/page-references/graph', {
      pageId: props.pageId,
      depth: Math.min(5, Math.max(1, props.graphDepth)),
      limit: Math.min(500, Math.max(1, props.graphLimit)),
    })
    if (sequence === graphSequence) graph.value = value
  } catch (value) {
    if (sequence === graphSequence) graphError.value = messageOf(value)
  } finally {
    if (sequence === graphSequence) graphLoading.value = false
  }
}

async function openReference(value: PageReferenceSummary) {
  if (!value.accessible || !value.pageId || !value.knowledgeBaseId) return
  await openPage(value.pageId, value.knowledgeBaseId)
}

async function openPage(pageId: string, knowledgeBaseId: string) {
  emit('open-page', { pageId, knowledgeBaseId })
  if (props.navigateOnOpen) await router.push(`/app/kb/${knowledgeBaseId}/pages/${pageId}`)
}

function insertReference() {
  const page = selectedPage.value
  if (!page || !canInsert.value) return
  const block = (insertMode.value === 'LIVE' || insertMode.value === 'FIXED') && sanitizedBlockId.value
    ? `#${sanitizedBlockId.value}`
    : ''
  const token = insertMode.value === 'LIVE'
    ? `{{embed:${page.id}${block}|mode=live}}`
    : insertMode.value === 'FIXED'
      ? `{{embed:${page.id}${block}|mode=fixed|publication=${page.publishedRevisionId}}}`
      : `[[page:${page.id}|mode=${insertMode.value.toLowerCase()}]]`
  emit('insert', {
    token,
    targetPageId: page.id,
    knowledgeBaseId: page.knowledgeBaseId,
    mode: insertMode.value,
    blockId: block ? sanitizedBlockId.value : null,
    fixedPublicationId: insertMode.value === 'FIXED' ? page.publishedRevisionId : null,
  })
  insertMessage.value = `已生成“${page.title}”的${modeLabel(insertMode.value)}`
}

function referenceTitle(value: PageReferenceSummary) {
  return value.accessible ? value.title || '未命名页面' : '无权查看的页面'
}

function referenceSubtitle(value: PageReferenceSummary) {
  if (!value.accessible) return '来源信息已隐藏'
  const source = value.sourceScope === 'PUBLISHED' ? '发布内容' : '草稿'
  const block = value.targetBlockId ? ` · 块 ${value.targetBlockId}` : ''
  return `${modeLabel(value.mode)} · ${source}${block}`
}

function previewText(referenceId: string) {
  const value = previews.value[referenceId]
  if (!value) return ''
  if (value.status === 'MISSING_BLOCK') return '目标块已不存在'
  if (value.status === 'UNAVAILABLE') return '当前无法预览'
  return value.plainText?.trim().slice(0, 180) ?? ''
}

function pageIcon(contentType: Page['contentType'] | null) {
  return ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' } as Partial<Record<Page['contentType'], string>>)[contentType ?? 'DOCUMENT'] ?? 'mdi-file-question-outline'
}

function modeLabel(mode: PageEmbedMode) {
  return ({ LINK: '普通链接', TITLE: '标题引用', CARD: '卡片引用', LIVE: '实时嵌入', FIXED: '固定版本' } as const)[mode]
}

function modeDescription(mode: PageEmbedMode) {
  return ({ LINK: '点击后打开源页面', TITLE: '标题随源页面更新', CARD: '展示标题与摘要', LIVE: '展示源页面当前内容', FIXED: '锁定已发布版本' } as const)[mode]
}

function modeIcon(mode: PageEmbedMode) {
  return ({ LINK: 'mdi-link-variant', TITLE: 'mdi-format-title', CARD: 'mdi-card-text-outline', LIVE: 'mdi-access-point', FIXED: 'mdi-lock-outline' } as const)[mode]
}

function shortTitle(value: string) {
  return value.length > 10 ? `${value.slice(0, 10)}…` : value
}

function layoutGraph(value: KnowledgeGraph | null) {
  const width = 560
  const height = 390
  if (!value) return { width, height, nodes: [] as GraphNodeLayout[], edges: [] as GraphEdgeLayout[] }
  const centerX = width / 2
  const centerY = height / 2
  const others = value.nodes.filter((node) => node.pageId !== value.rootPageId)
  const positions = new Map<string, { x: number; y: number }>()
  positions.set(value.rootPageId, { x: centerX, y: centerY })
  others.forEach((node, index) => {
    const angle = (Math.PI * 2 * index) / Math.max(others.length, 1) - Math.PI / 2
    const ring = Math.floor(index / 18)
    const radius = Math.min(165, 92 + ring * 42)
    positions.set(node.pageId, { x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius })
  })
  const nodes: GraphNodeLayout[] = value.nodes.flatMap((node) => {
    const position = positions.get(node.pageId)
    return position ? [{ ...node, ...position, root: node.pageId === value.rootPageId }] : []
  })
  const edges: GraphEdgeLayout[] = value.edges.flatMap((edge) => {
    const source = positions.get(edge.sourcePageId)
    const target = positions.get(edge.targetPageId)
    return source && target ? [{ referenceId: edge.referenceId, mode: edge.mode, x1: source.x, y1: source.y, x2: target.x, y2: target.y }] : []
  })
  return { width, height, nodes, edges }
}
</script>

<template>
  <v-card class="reference-panel section-card" rounded="xl">
    <v-card-title class="panel-header pa-5">
      <div><div class="text-overline text-primary">知识网络</div><h2>页面关系</h2></div>
      <v-spacer />
      <v-btn icon="mdi-refresh" variant="text" :loading="loading || graphLoading" aria-label="刷新页面关系" @click="refresh" />
      <v-btn v-if="closable" icon="mdi-close" variant="text" aria-label="关闭知识网络" @click="emit('close')" />
    </v-card-title>
    <v-tabs v-model="tab" color="primary" grow show-arrows>
      <v-tab value="OUTGOING">引用 <v-chip size="x-small" class="ml-2" variant="tonal">{{ outgoing.length }}</v-chip></v-tab>
      <v-tab value="BACKLINKS">反向链接 <v-chip size="x-small" class="ml-2" variant="tonal">{{ backlinks.length }}</v-chip></v-tab>
      <v-tab value="GRAPH" prepend-icon="mdi-graph-outline">图谱</v-tab>
      <v-tab v-if="allowInsert" value="INSERT" prepend-icon="mdi-link-plus">插入引用</v-tab>
    </v-tabs>
    <v-divider />
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-if="error" type="error" variant="tonal" class="ma-4">{{ error }}<template #append><v-btn variant="text" size="small" @click="loadRelations">重试</v-btn></template></v-alert>

    <div v-if="tab === 'OUTGOING' || tab === 'BACKLINKS'" class="reference-content">
      <template v-if="(tab === 'OUTGOING' ? outgoing : backlinks).length">
        <button
          v-for="reference in (tab === 'OUTGOING' ? outgoing : backlinks)"
          :key="reference.referenceId"
          type="button"
          class="reference-row"
          :class="{ unavailable: !reference.accessible }"
          :disabled="!reference.accessible"
          @click="openReference(reference)"
        >
          <v-avatar :color="reference.accessible ? 'primary' : 'secondary'" variant="tonal" size="38"><v-icon size="20">{{ reference.accessible ? pageIcon(reference.contentType) : 'mdi-lock-outline' }}</v-icon></v-avatar>
          <div>
            <strong>{{ referenceTitle(reference) }}</strong>
            <small>{{ referenceSubtitle(reference) }}</small>
            <v-skeleton-loader v-if="previewLoadingIds.includes(reference.referenceId)" type="text" width="180" />
            <p v-else-if="previewText(reference.referenceId)">{{ previewText(reference.referenceId) }}</p>
          </div>
          <v-chip v-if="reference.accessible" size="x-small" variant="tonal">{{ reference.kind }}</v-chip>
          <v-icon v-if="reference.accessible" size="17">mdi-open-in-new</v-icon>
        </button>
      </template>
      <div v-else-if="!loading" class="panel-empty">
        <v-icon size="44" color="primary">{{ tab === 'OUTGOING' ? 'mdi-source-branch' : 'mdi-link-variant-off' }}</v-icon>
        <strong>{{ tab === 'OUTGOING' ? '还没有引用其他页面' : '还没有页面引用这里' }}</strong>
        <p>{{ tab === 'OUTGOING' ? (allowInsert ? '切换到“插入引用”建立知识连接。' : '在编辑器中插入页面引用后会自动显示。') : '其他可见页面引用这里后会自动出现。' }}</p>
        <v-btn v-if="tab === 'OUTGOING' && allowInsert" color="primary" variant="tonal" prepend-icon="mdi-link-plus" @click="tab = 'INSERT'">插入引用</v-btn>
      </div>
    </div>

    <div v-else-if="tab === 'GRAPH'" class="graph-content">
      <v-alert v-if="graphError" type="error" variant="tonal" class="ma-4">{{ graphError }}<template #append><v-btn variant="text" size="small" @click="loadGraph">重试</v-btn></template></v-alert>
      <div v-if="graphLoading" class="panel-empty"><v-progress-circular indeterminate color="primary" /><strong>正在构建图谱…</strong></div>
      <template v-else-if="graph && graphLayout.nodes.length">
        <div class="graph-scroll">
          <svg :viewBox="`0 0 ${graphLayout.width} ${graphLayout.height}`" role="img" aria-label="页面知识图谱">
            <line v-for="edge in graphLayout.edges" :key="edge.referenceId" :x1="edge.x1" :y1="edge.y1" :x2="edge.x2" :y2="edge.y2" class="graph-edge" :class="edge.mode.toLowerCase()" />
            <a v-for="node in graphLayout.nodes" :key="node.pageId" :href="`/app/kb/${node.knowledgeBaseId}/pages/${node.pageId}`" @click.prevent="openPage(node.pageId, node.knowledgeBaseId)">
              <circle :cx="node.x" :cy="node.y" :r="node.root ? 24 : 17" class="graph-node" :class="{ root: node.root }" />
              <text :x="node.x" :y="node.y + (node.root ? 39 : 31)" text-anchor="middle">{{ shortTitle(node.title) }}</text>
              <title>{{ node.title }}</title>
            </a>
          </svg>
        </div>
        <div class="graph-footer"><div class="graph-legend"><span><i class="live" />实时嵌入</span><span><i class="fixed" />固定版本</span><span><i />普通引用</span></div><v-chip v-if="graph.truncated" color="warning" size="small" variant="tonal">图谱已按深度或数量上限截断</v-chip></div>
      </template>
      <div v-else-if="!graphError" class="panel-empty"><v-icon size="48">mdi-graph-outline</v-icon><strong>暂无可展示的关系图谱</strong></div>
    </div>

    <div v-else-if="tab === 'INSERT' && allowInsert" class="insert-content pa-4 pa-md-5">
      <v-text-field v-model="search" label="搜索可引用页面" placeholder="输入标题或路径" prepend-inner-icon="mdi-magnify" clearable hide-details class="mb-4" />
      <div class="page-picker mb-5" role="listbox" aria-label="选择引用目标">
        <button v-for="page in visibleCandidates" :key="page.id" type="button" class="page-option" :class="{ selected: selectedPageId === page.id }" role="option" :aria-selected="selectedPageId === page.id" @click="selectedPageId = page.id; insertMessage = ''">
          <v-avatar color="primary" variant="tonal" size="36"><v-icon size="19">{{ pageIcon(page.contentType) }}</v-icon></v-avatar>
          <div><strong>{{ page.title }}</strong><small>/{{ page.path }} · {{ page.publishedRevisionId ? '已发布' : '仅草稿' }}</small></div>
          <v-icon v-if="selectedPageId === page.id" color="primary">mdi-check-circle</v-icon>
        </button>
        <div v-if="!visibleCandidates.length" class="picker-empty">没有匹配页面</div>
      </div>
      <v-alert v-if="candidates.length > visibleCandidates.length" type="info" variant="tonal" density="compact" class="mb-4">结果较多，仅显示前 200 项，请继续输入关键词缩小范围。</v-alert>

      <fieldset class="mode-picker mb-4">
        <legend>引用方式</legend>
        <button v-for="mode in (['LINK', 'TITLE', 'CARD', 'LIVE', 'FIXED'] as PageEmbedMode[])" :key="mode" type="button" :class="{ selected: insertMode === mode }" @click="insertMode = mode; insertMessage = ''">
          <v-icon>{{ modeIcon(mode) }}</v-icon><div><strong>{{ modeLabel(mode) }}</strong><small>{{ modeDescription(mode) }}</small></div>
        </button>
      </fieldset>
      <v-text-field v-if="insertMode === 'LIVE' || insertMode === 'FIXED'" v-model="blockId" label="块 ID（可选）" placeholder="留空则嵌入整篇内容" hint="无效字符会在生成引用时替换为连字符。" persistent-hint class="mb-3" />
      <v-alert v-if="fixedUnavailable" type="warning" variant="tonal" class="mb-4">目标页面尚未发布，不能创建固定版本引用。</v-alert>
      <v-alert v-if="insertMessage" type="success" variant="tonal" class="mb-4">{{ insertMessage }}</v-alert>
      <div class="insert-actions"><span v-if="selectedPage" class="text-medium-emphasis">目标：{{ selectedPage.title }}</span><v-spacer /><v-btn color="primary" prepend-icon="mdi-link-plus" :disabled="!canInsert" @click="insertReference">生成并插入引用</v-btn></div>
    </div>
  </v-card>
</template>

<style scoped>
.reference-panel { min-height: 520px; overflow: hidden; }
.panel-header { display: flex; align-items: center; }
.panel-header h2 { margin: 0; font-size: 1.18rem; }
.reference-content { min-height: 430px; padding: 10px; }
.reference-row { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 12px; padding: 12px; border: 1px solid transparent; border-radius: 12px; background: none; color: inherit; text-align: left; font: inherit; cursor: pointer; }
.reference-row:hover { border-color: rgb(var(--v-theme-primary), .18); background: rgb(var(--v-theme-primary), .04); }
.reference-row.unavailable { cursor: default; opacity: .68; }
.reference-row > div { min-width: 0; display: grid; gap: 2px; }
.reference-row strong, .reference-row small, .reference-row p { overflow: hidden; text-overflow: ellipsis; }
.reference-row small { color: rgb(var(--v-theme-on-surface), .52); }
.reference-row p { margin: 5px 0 0; color: rgb(var(--v-theme-on-surface), .66); font-size: .79rem; white-space: nowrap; }
.panel-empty { min-height: 360px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 32px; color: rgb(var(--v-theme-on-surface), .54); text-align: center; }
.panel-empty strong { color: rgb(var(--v-theme-on-surface)); }
.panel-empty p { margin: 0; max-width: 360px; line-height: 1.6; }
.graph-content { min-height: 430px; }
.graph-scroll { overflow: auto; padding: 8px; }
.graph-scroll svg { display: block; width: 100%; min-width: 520px; max-height: 470px; }
.graph-edge { stroke: rgb(var(--v-theme-on-surface), .22); stroke-width: 1.4; }
.graph-edge.live { stroke: rgb(var(--v-theme-success)); stroke-width: 2; stroke-dasharray: 5 3; }
.graph-edge.fixed { stroke: rgb(var(--v-theme-warning)); stroke-width: 2; }
.graph-node { fill: rgb(var(--v-theme-surface)); stroke: rgb(var(--v-theme-primary), .65); stroke-width: 2; transition: .15s ease; }
.graph-node.root { fill: rgb(var(--v-theme-primary)); stroke: rgb(var(--v-theme-primary)); }
.graph-scroll a:hover .graph-node { stroke-width: 4; }
.graph-scroll text { fill: rgb(var(--v-theme-on-surface), .75); font-size: 10px; pointer-events: none; }
.graph-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 18px 18px; }
.graph-legend { display: flex; gap: 14px; color: rgb(var(--v-theme-on-surface), .55); font-size: .75rem; }
.graph-legend span { display: inline-flex; align-items: center; gap: 5px; }
.graph-legend i { width: 18px; border-top: 2px solid rgb(var(--v-theme-on-surface), .28); }
.graph-legend i.live { border-color: rgb(var(--v-theme-success)); border-top-style: dashed; }
.graph-legend i.fixed { border-color: rgb(var(--v-theme-warning)); }
.page-picker { max-height: 230px; overflow: auto; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; padding: 3px; }
.page-option { display: flex; align-items: center; gap: 10px; min-width: 0; padding: 10px; border: 1px solid rgb(var(--v-theme-on-surface), .09); border-radius: 11px; background: rgb(var(--v-theme-surface)); color: inherit; text-align: left; font: inherit; cursor: pointer; }
.page-option:hover, .page-option.selected { border-color: rgb(var(--v-theme-primary), .38); background: rgb(var(--v-theme-primary), .045); }
.page-option > div { min-width: 0; flex: 1; display: grid; }
.page-option strong, .page-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-option small { color: rgb(var(--v-theme-on-surface), .5); }
.picker-empty { grid-column: 1 / -1; padding: 40px; color: rgb(var(--v-theme-on-surface), .5); text-align: center; }
.mode-picker { margin: 0; padding: 0; border: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 8px; }
.mode-picker legend { grid-column: 1 / -1; margin-bottom: 8px; font-weight: 650; }
.mode-picker button { min-height: 102px; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; padding: 12px; border: 1px solid rgb(var(--v-theme-on-surface), .1); border-radius: 12px; background: rgb(var(--v-theme-surface)); color: inherit; text-align: left; cursor: pointer; }
.mode-picker button:hover, .mode-picker button.selected { border-color: rgb(var(--v-theme-primary), .42); background: rgb(var(--v-theme-primary), .045); }
.mode-picker button > div { display: grid; gap: 3px; }
.mode-picker small { color: rgb(var(--v-theme-on-surface), .52); line-height: 1.35; }
.insert-actions { display: flex; align-items: center; gap: 12px; }
@media (max-width: 800px) {
  .mode-picker { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .page-picker { grid-template-columns: 1fr; }
}
@media (max-width: 560px) {
  .reference-row { grid-template-columns: auto minmax(0, 1fr) auto; }
  .reference-row > .v-chip { display: none; }
  .graph-footer, .insert-actions { align-items: stretch; flex-direction: column; }
}
</style>
