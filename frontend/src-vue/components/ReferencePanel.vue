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
  relationSequence += 1
  graphSequence += 1
  previewSequence += 1
  outgoing.value = []
  backlinks.value = []
  graph.value = null
  previews.value = {}
  previewLoadingIds.value = []
  loading.value = false
  graphLoading.value = false
  error.value = ''
  graphError.value = ''
  if (!props.pageId) return
  await loadRelations()
  if (tab.value === 'GRAPH') await loadGraph()
}

async function loadRelations() {
  const sequence = ++relationSequence
  const requestedPageId = props.pageId
  outgoing.value = []
  backlinks.value = []
  previews.value = {}
  previewLoadingIds.value = []
  previewSequence += 1
  loading.value = true
  error.value = ''
  try {
    const [outgoingValues, backlinkValues] = await Promise.all([
      post<PageReferenceSummary[]>('/api/v1/page-references/outgoing', { pageId: requestedPageId }),
      post<PageReferenceSummary[]>('/api/v1/page-references/backlinks', { pageId: requestedPageId }),
    ])
    if (sequence !== relationSequence || requestedPageId !== props.pageId) return
    const safeOutgoing = Array.isArray(outgoingValues) ? outgoingValues : []
    outgoing.value = safeOutgoing
    backlinks.value = Array.isArray(backlinkValues) ? backlinkValues : []
    void loadPreviews(safeOutgoing, requestedPageId)
  } catch (value) {
    if (sequence === relationSequence && requestedPageId === props.pageId) error.value = messageOf(value)
  } finally {
    if (sequence === relationSequence) loading.value = false
  }
}

async function loadPreviews(values: PageReferenceSummary[], requestedPageId = props.pageId) {
  const sequence = ++previewSequence
  const resolvable = values.filter((value) => value.accessible && ['CARD', 'LIVE', 'FIXED'].includes(value.mode))
  previewLoadingIds.value = resolvable.map((value) => value.referenceId)
  const results = await Promise.allSettled(resolvable.map((value) => post<EmbeddedPageView>('/api/v1/page-references/resolve', { referenceId: value.referenceId })))
  if (sequence !== previewSequence || requestedPageId !== props.pageId) return
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
  const requestedPageId = props.pageId
  graph.value = null
  graphLoading.value = true
  graphError.value = ''
  try {
    const value = await post<KnowledgeGraph>('/api/v1/page-references/graph', {
      pageId: requestedPageId,
      depth: Math.min(5, Math.max(1, props.graphDepth)),
      limit: Math.min(500, Math.max(1, props.graphLimit)),
    })
    if (sequence === graphSequence && requestedPageId === props.pageId) graph.value = normalizeGraph(value, requestedPageId)
  } catch (value) {
    if (sequence === graphSequence && requestedPageId === props.pageId) graphError.value = messageOf(value)
  } finally {
    if (sequence === graphSequence) graphLoading.value = false
  }
}

function normalizeGraph(value: KnowledgeGraph, rootPageId: string): KnowledgeGraph {
  return {
    rootPageId: typeof value?.rootPageId === 'string' ? value.rootPageId : rootPageId,
    nodes: Array.isArray(value?.nodes) ? value.nodes : [],
    edges: Array.isArray(value?.edges) ? value.edges : [],
    truncated: Boolean(value?.truncated),
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

function referenceKindLabel(kind: PageReferenceSummary['kind']) {
  return ({ LINK: '链接', MENTION: '提及', EMBED: '嵌入', BLOCK_REFERENCE: '块引用', RELATION: '关联' } as const)[kind]
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
  <section class="reference-panel">
    <header v-if="closable" class="standalone-header">
      <strong>页面关系</strong>
      <v-btn icon="mdi-close" size="small" density="compact" variant="text" aria-label="关闭知识网络" @click="emit('close')" />
    </header>
    <div class="reference-tabs" role="tablist" aria-label="页面关系">
      <button type="button" role="tab" :class="{ active: tab === 'OUTGOING' }" :aria-selected="tab === 'OUTGOING'" @click="tab = 'OUTGOING'">引用 <span>{{ outgoing.length }}</span></button>
      <button type="button" role="tab" :class="{ active: tab === 'BACKLINKS' }" :aria-selected="tab === 'BACKLINKS'" @click="tab = 'BACKLINKS'">被引用 <span>{{ backlinks.length }}</span></button>
      <button type="button" role="tab" :class="{ active: tab === 'GRAPH' }" :aria-selected="tab === 'GRAPH'" @click="tab = 'GRAPH'">图谱</button>
      <button v-if="allowInsert" type="button" role="tab" :class="{ active: tab === 'INSERT' }" :aria-selected="tab === 'INSERT'" @click="tab = 'INSERT'">插入</button>
      <v-spacer />
      <v-btn icon="mdi-refresh" size="small" density="compact" variant="text" :loading="loading || graphLoading" aria-label="刷新页面关系" @click="refresh" />
    </div>
    <v-progress-linear v-if="loading" class="panel-progress" indeterminate color="primary" height="2" />
    <div v-if="error" class="panel-notice error-notice" role="alert"><v-icon size="17">mdi-alert-circle-outline</v-icon><span>{{ error }}</span><button type="button" @click="loadRelations">重试</button></div>

    <div v-if="tab === 'OUTGOING' || tab === 'BACKLINKS'" class="reference-content">
      <div v-if="loading && !(tab === 'OUTGOING' ? outgoing : backlinks).length" class="reference-skeletons" aria-label="正在加载页面关系">
        <div v-for="index in 4" :key="index" class="reference-skeleton"><v-skeleton-loader type="avatar" /><v-skeleton-loader type="text@2" /></div>
      </div>
      <template v-else-if="(tab === 'OUTGOING' ? outgoing : backlinks).length">
        <button
          v-for="reference in (tab === 'OUTGOING' ? outgoing : backlinks)"
          :key="reference.referenceId"
          type="button"
          class="reference-row"
          :class="{ unavailable: !reference.accessible }"
          :disabled="!reference.accessible"
          @click="openReference(reference)"
        >
          <span class="reference-icon"><v-icon size="17">{{ reference.accessible ? pageIcon(reference.contentType) : 'mdi-lock-outline' }}</v-icon></span>
          <div class="reference-copy">
            <strong>{{ referenceTitle(reference) }}</strong>
            <small>{{ referenceSubtitle(reference) }}</small>
            <v-skeleton-loader v-if="previewLoadingIds.includes(reference.referenceId)" type="text" width="150" />
            <p v-else-if="previewText(reference.referenceId)">{{ previewText(reference.referenceId) }}</p>
          </div>
          <span v-if="reference.accessible" class="reference-kind">{{ referenceKindLabel(reference.kind) }}</span>
          <v-icon v-if="reference.accessible" size="17">mdi-open-in-new</v-icon>
        </button>
      </template>
      <div v-else-if="!loading" class="panel-empty">
        <span class="empty-icon"><v-icon size="24">{{ tab === 'OUTGOING' ? 'mdi-source-branch' : 'mdi-link-variant-off' }}</v-icon></span>
        <strong>{{ tab === 'OUTGOING' ? '还没有引用其他页面' : '还没有页面引用这里' }}</strong>
        <p>{{ tab === 'OUTGOING' ? (allowInsert ? '切换到“插入引用”建立知识连接。' : '在编辑器中插入页面引用后会自动显示。') : '其他可见页面引用这里后会自动出现。' }}</p>
        <v-btn v-if="tab === 'OUTGOING' && allowInsert" size="small" color="primary" variant="flat" prepend-icon="mdi-link-plus" @click="tab = 'INSERT'">插入引用</v-btn>
      </div>
    </div>

    <div v-else-if="tab === 'GRAPH'" class="graph-content">
      <div v-if="graphError" class="panel-notice error-notice" role="alert"><v-icon size="17">mdi-alert-circle-outline</v-icon><span>{{ graphError }}</span><button type="button" @click="loadGraph">重试</button></div>
      <div v-if="graphLoading" class="panel-empty"><v-progress-circular indeterminate color="primary" size="26" width="2" /><strong>正在构建图谱…</strong></div>
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
        <div class="graph-footer"><div class="graph-legend"><span><i class="live" />实时</span><span><i class="fixed" />固定</span><span><i />普通</span></div><span v-if="graph.truncated" class="truncated-note">已按上限截断</span></div>
      </template>
      <div v-else-if="!graphError" class="panel-empty"><span class="empty-icon"><v-icon size="24">mdi-graph-outline</v-icon></span><strong>暂无可展示的关系图谱</strong></div>
    </div>

    <div v-else-if="tab === 'INSERT' && allowInsert" class="insert-content">
      <v-text-field v-model="search" label="搜索可引用页面" placeholder="输入标题或路径" prepend-inner-icon="mdi-magnify" density="compact" variant="outlined" clearable hide-details />
      <div class="page-picker" role="listbox" aria-label="选择引用目标">
        <button v-for="page in visibleCandidates" :key="page.id" type="button" class="page-option" :class="{ selected: selectedPageId === page.id }" role="option" :aria-selected="selectedPageId === page.id" @click="selectedPageId = page.id; insertMessage = ''">
          <span class="reference-icon"><v-icon size="17">{{ pageIcon(page.contentType) }}</v-icon></span>
          <div><strong>{{ page.title }}</strong><small>/{{ page.path }} · {{ page.publishedRevisionId ? '已发布' : '仅草稿' }}</small></div>
          <v-icon v-if="selectedPageId === page.id" color="primary" size="18">mdi-check-circle</v-icon>
        </button>
        <div v-if="!visibleCandidates.length" class="picker-empty">没有匹配页面</div>
      </div>
      <div v-if="candidates.length > visibleCandidates.length" class="panel-notice info-notice"><v-icon size="17">mdi-information-outline</v-icon><span>仅显示前 200 项，请继续输入关键词。</span></div>

      <fieldset class="mode-picker">
        <legend>引用方式</legend>
        <button v-for="mode in (['LINK', 'TITLE', 'CARD', 'LIVE', 'FIXED'] as PageEmbedMode[])" :key="mode" type="button" :class="{ selected: insertMode === mode }" @click="insertMode = mode; insertMessage = ''">
          <v-icon size="17">{{ modeIcon(mode) }}</v-icon><strong>{{ modeLabel(mode) }}</strong>
        </button>
        <p>{{ modeDescription(insertMode) }}</p>
      </fieldset>
      <v-text-field v-if="insertMode === 'LIVE' || insertMode === 'FIXED'" v-model="blockId" label="块 ID（可选）" placeholder="留空则嵌入整篇内容" hint="无效字符会替换为连字符" persistent-hint density="compact" variant="outlined" class="block-field" />
      <div v-if="fixedUnavailable" class="panel-notice warning-notice" role="alert"><v-icon size="17">mdi-alert-outline</v-icon><span>目标页面尚未发布，不能创建固定版本引用。</span></div>
      <div v-if="insertMessage" class="panel-notice success-notice" role="status"><v-icon size="17">mdi-check-circle-outline</v-icon><span>{{ insertMessage }}</span></div>
      <div class="insert-actions"><span v-if="selectedPage">目标：{{ selectedPage.title }}</span><span v-else>请先选择页面</span><v-spacer /><v-btn size="small" color="primary" variant="flat" :disabled="!canInsert" @click="insertReference">插入引用</v-btn></div>
    </div>
  </section>
</template>

<style scoped>
.reference-panel { min-height: 0; overflow: hidden; background: #fff; color: #262626; font-size: 13px; }
.standalone-header { display: flex; height: 52px; align-items: center; justify-content: space-between; border-bottom: 1px solid #eeeeed; padding: 0 10px 0 14px; }
.standalone-header strong { font-size: 15px; font-weight: 650; }
.standalone-header :deep(.v-btn) { width: 30px; height: 30px; }
.reference-tabs { position: relative; display: flex; height: 42px; align-items: center; gap: 2px; border-bottom: 1px solid #eeeeed; padding: 0 6px 0 10px; background: #fff; }
.reference-tabs > button { position: relative; height: 42px; display: inline-flex; flex: 0 0 auto; align-items: center; gap: 4px; border: 0; background: transparent; color: #8a8f8d; padding: 0 8px; font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; cursor: pointer; }
.reference-tabs > button::after { position: absolute; right: 8px; bottom: -1px; left: 8px; height: 2px; background: transparent; content: ''; }
.reference-tabs > button:hover { color: #262626; }
.reference-tabs > button.active { color: #262626; font-weight: 600; }
.reference-tabs > button.active::after { background: #2f6feb; }
.reference-tabs > button span { display: grid; min-width: 17px; height: 17px; place-items: center; border-radius: 9px; background: #f1f2f1; color: #8a8f8d; font-size: 10px; font-weight: 500; }
.reference-tabs :deep(.v-btn) { width: 30px; height: 30px; color: #585a59; }
.panel-progress { z-index: 2; margin-bottom: -2px; }
.panel-notice { display: flex; min-height: 36px; align-items: center; gap: 7px; margin: 10px 12px 0; border: 1px solid; border-radius: 6px; padding: 7px 9px; font-size: 12px; line-height: 1.45; }
.panel-notice span { min-width: 0; flex: 1; }
.panel-notice button { border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.error-notice { border-color: #ffd6d2; background: #fff7f6; color: #c9362e; }
.warning-notice { border-color: #ffe2b8; background: #fffaf2; color: #a85c00; }
.info-notice { border-color: #cfe0ff; background: #f5f8ff; color: #245bc3; }
.success-notice { border-color: #bdebd2; background: #f2fbf6; color: #008951; }
.reference-content { min-height: 330px; }
.reference-row { width: 100%; min-height: 58px; display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; align-items: center; gap: 9px; border: 0; border-bottom: 1px solid #f1f2f1; background: transparent; color: inherit; padding: 8px 12px; text-align: left; font: inherit; cursor: pointer; }
.reference-row:hover { background: #f7f8f8; }
.reference-row.unavailable { cursor: default; opacity: .58; }
.reference-icon { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 5px; background: #f1f4fa; color: #2f6feb; }
.reference-copy { min-width: 0; display: grid; gap: 2px; }
.reference-row strong, .reference-row small, .reference-row p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reference-row strong { font-size: 13px; font-weight: 550; }
.reference-row small { color: #8a8f8d; font-size: 11px; }
.reference-row p { margin: 1px 0 0; color: #585a59; font-size: 11px; }
.reference-kind { border-radius: 3px; background: #f3f4f3; color: #8a8f8d; padding: 2px 5px; font-size: 9px; line-height: 1.4; }
.reference-skeletons { display: grid; }
.reference-skeleton { min-height: 58px; display: grid; grid-template-columns: 28px minmax(0, 1fr); align-items: center; gap: 9px; border-bottom: 1px solid #f1f2f1; padding: 8px 12px; }
.reference-skeleton :deep(.v-skeleton-loader) { background: transparent; }
.reference-skeleton :deep(.v-skeleton-loader__avatar) { width: 28px; height: 28px; }
.panel-empty { min-height: 278px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px; padding: 28px 24px; color: #a6aaa8; text-align: center; }
.empty-icon { display: grid; width: 40px; height: 40px; place-items: center; border-radius: 8px; background: #f4f5f5; color: #8a8f8d; }
.panel-empty strong { margin-top: 3px; color: #585a59; font-size: 13px; font-weight: 600; }
.panel-empty p { margin: 0; max-width: 310px; font-size: 12px; line-height: 1.6; }
.panel-empty :deep(.v-btn) { margin-top: 6px; border-radius: 5px; letter-spacing: 0; }
.graph-content { min-height: 330px; }
.graph-scroll { overflow: auto; border-bottom: 1px solid #f1f2f1; padding: 4px; }
.graph-scroll svg { display: block; width: 100%; min-width: 390px; max-height: 430px; }
.graph-edge { stroke: #c9cccb; stroke-width: 1.2; }
.graph-edge.live { stroke: #00a870; stroke-width: 1.6; stroke-dasharray: 5 3; }
.graph-edge.fixed { stroke: #d97904; stroke-width: 1.6; }
.graph-node { fill: #fff; stroke: #5b8def; stroke-width: 1.5; transition: stroke-width .12s ease; }
.graph-node.root { fill: #2f6feb; stroke: #2f6feb; }
.graph-scroll a:hover .graph-node { stroke-width: 3; }
.graph-scroll text { fill: #585a59; font-size: 10px; pointer-events: none; }
.graph-footer { display: flex; min-height: 38px; align-items: center; justify-content: space-between; gap: 10px; padding: 7px 12px; }
.graph-legend { display: flex; gap: 11px; color: #8a8f8d; font-size: 10px; }
.graph-legend span { display: inline-flex; align-items: center; gap: 4px; }
.graph-legend i { width: 14px; border-top: 2px solid #c9cccb; }
.graph-legend i.live { border-color: #00a870; border-top-style: dashed; }
.graph-legend i.fixed { border-color: #d97904; }
.truncated-note { color: #d97904; font-size: 10px; }
.insert-content { padding: 12px; }
.insert-content > :deep(.v-input) { margin-bottom: 10px; }
.insert-content :deep(.v-field) { border-radius: 5px; font-size: 12px; }
.insert-content :deep(.v-label) { font-size: 12px; }
.page-picker { max-height: 230px; overflow: auto; margin: 0 -12px 12px; border-top: 1px solid #f1f2f1; }
.page-option { width: 100%; min-height: 52px; display: flex; align-items: center; gap: 9px; min-width: 0; border: 0; border-bottom: 1px solid #f1f2f1; background: #fff; color: inherit; padding: 7px 12px; text-align: left; font: inherit; cursor: pointer; }
.page-option:hover { background: #f7f8f8; }
.page-option.selected { background: #edf3ff; }
.page-option > div { min-width: 0; flex: 1; display: grid; gap: 2px; }
.page-option strong, .page-option small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.page-option strong { font-size: 12px; font-weight: 550; }
.page-option small { color: #8a8f8d; font-size: 10px; }
.picker-empty { padding: 32px 12px; color: #a6aaa8; font-size: 12px; text-align: center; }
.mode-picker { margin: 0 0 10px; padding: 0; border: 0; display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 4px; }
.mode-picker legend { grid-column: 1 / -1; margin-bottom: 4px; color: #585a59; font-size: 12px; font-weight: 600; }
.mode-picker button { position: relative; min-width: 0; height: 52px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; border: 1px solid #e2e4e3; border-radius: 5px; background: #fff; color: #8a8f8d; padding: 4px; cursor: pointer; }
.mode-picker button:hover { border-color: #b9c9e8; color: #262626; }
.mode-picker button.selected { border-color: #83a9ee; background: #f2f6ff; color: #245bc3; }
.reference-tabs > button:focus-visible, .reference-row:focus-visible, .page-option:focus-visible, .mode-picker button:focus-visible { outline: 2px solid rgba(47, 111, 235, .28); outline-offset: -2px; }
.mode-picker button strong { overflow: hidden; max-width: 100%; font-size: 10px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.mode-picker > p { grid-column: 1 / -1; margin: 2px 0 0; color: #8a8f8d; font-size: 11px; }
.block-field { margin-bottom: 10px; }
.insert-actions { position: sticky; bottom: -12px; display: flex; min-height: 48px; align-items: center; gap: 8px; margin: 2px -12px -12px; border-top: 1px solid #eeeeed; background: #fff; padding: 8px 12px; }
.insert-actions > span { overflow: hidden; max-width: 210px; color: #8a8f8d; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.insert-actions :deep(.v-btn) { border-radius: 5px; letter-spacing: 0; }
@media (max-width: 390px) {
  .reference-tabs { overflow-x: auto; padding-right: 3px; }
  .reference-tabs .v-spacer { display: none; }
  .reference-tabs :deep(.v-btn) { margin-left: auto; }
  .reference-kind { display: none; }
  .reference-row { grid-template-columns: 28px minmax(0, 1fr) auto; }
  .mode-picker { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
</style>
