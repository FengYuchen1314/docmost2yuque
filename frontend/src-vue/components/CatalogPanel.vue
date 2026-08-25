<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { CatalogNode, CatalogTree, Page } from '../../src/types'
import { ApiError, messageOf, post } from '../services/api'

interface CatalogRevision {
  id: string
  knowledgeBaseId: string
  revisionNo: number
  operation: string
  actorId: string
  snapshot: unknown
  createdAt: string
}

interface CatalogRevisionPage {
  items: CatalogRevision[]
  nextOffset: number
  hasMore: boolean
}

interface FlatNode {
  node: CatalogNode
  depth: number
}

type CreateKind = 'GROUP' | 'LINK' | 'DOCUMENT'
type Confirmation =
  | { kind: 'REMOVE'; node: CatalogNode }
  | { kind: 'BATCH_REMOVE' }
  | { kind: 'RESTORE'; revision: CatalogRevision }
  | { kind: 'TRASH'; page: Page }
  | null

const props = withDefaults(defineProps<{
  knowledgeBaseId: string
  pages: Page[]
  readonly?: boolean
  showHistory?: boolean
}>(), {
  readonly: false,
  showHistory: true,
})

const emit = defineEmits<{
  'catalog-change': [tree: CatalogTree]
  'page-created': [page: Page]
  'page-trashed': [page: Page]
  conflict: [currentRevision: number]
  'open-page': [page: Page]
}>()

const tree = ref<CatalogTree | null>(null)
const loading = ref(false)
const refreshing = ref(false)
const operationPending = ref(false)
const error = ref('')
const conflictNotice = ref('')
const announcement = ref('')

const createKind = ref<CreateKind>('GROUP')
const createTitle = ref('')
const createUrl = ref('')
const createPageId = ref('')
const createParentId = ref('')

const collapsedIds = ref<string[]>([])
const selectedIds = ref<string[]>([])
const batchTargetId = ref('')
const draggingId = ref('')

const revisions = ref<CatalogRevision[]>([])
const historyOffset = ref(0)
const historyHasMore = ref(false)
const historyLoading = ref(false)
const historyLoadingMore = ref(false)
const historyError = ref('')

const renamingNode = ref<CatalogNode | null>(null)
const renameTitle = ref('')
const renameOpen = ref(false)

const copyingNode = ref<CatalogNode | null>(null)
const copyingPage = ref<Page | null>(null)
const copyTitle = ref('')
const copyPathValue = ref('')
const copyOpen = ref(false)
const copyPending = ref(false)
const copyError = ref('')
const locallyCreatedPages = ref<Page[]>([])

const confirmation = ref<Confirmation>(null)
const confirmationPending = ref(false)
const confirmationError = ref('')

let loadSequence = 0

const allPages = computed(() => {
  const values = [...props.pages, ...locallyCreatedPages.value]
  return [...new Map(values.map((page) => [page.id, page])).values()]
})
const pageById = computed(() => new Map(allPages.value.map((page) => [page.id, page])))
const flatAll = computed(() => flattenCatalog(tree.value?.nodes ?? []))
const flatVisible = computed(() => flattenCatalog(tree.value?.nodes ?? [], new Set(collapsedIds.value)))
const groupRows = computed(() => flatAll.value.filter(({ node }) => node.nodeType === 'GROUP'))
const unlistedPages = computed(() => {
  const mounted = new Set((tree.value?.nodes ?? []).flatMap((node) => node.pageId ? [node.pageId] : []))
  return allPages.value.filter((page) => !page.deletedAt && !mounted.has(page.id))
})
const selectedSet = computed(() => new Set(selectedIds.value))
const allSelected = computed(() => flatAll.value.length > 0 && flatAll.value.length <= 500 && flatAll.value.every(({ node }) => selectedSet.value.has(node.id)))
const batchTargetGroups = computed(() => {
  const nodes = tree.value?.nodes ?? []
  return groupRows.value.filter(({ node }) => {
    if (selectedSet.value.has(node.id)) return false
    return !selectedIds.value.some((selectedId) => descendantsOf(nodes, selectedId).has(node.id))
  })
})
const secureCreateUrl = computed(() => safeExternalUrl(createUrl.value))
const createDisabled = computed(() => {
  if (props.readonly || operationPending.value || !tree.value) return true
  if (createKind.value === 'DOCUMENT') return !createPageId.value
  if (!createTitle.value.trim()) return true
  return createKind.value === 'LINK' && !secureCreateUrl.value
})
const confirmationTitle = computed(() => {
  const value = confirmation.value
  if (!value) return ''
  if (value.kind === 'BATCH_REMOVE') return `移出选中的 ${selectedIds.value.length} 项？`
  if (value.kind === 'RESTORE') return `恢复目录到版本 ${value.revision.revisionNo}？`
  if (value.kind === 'TRASH') return `删除文档“${value.page.title}”？`
  return `从目录移出“${nodeLabel(value.node)}”？`
})
const confirmationDescription = computed(() => {
  const value = confirmation.value
  if (!value) return ''
  if (value.kind === 'RESTORE') return '当前目录会先保留为新的历史版本，之后仍可恢复回来。'
  if (value.kind === 'TRASH') return '文档会进入回收站。目录挂载与文档删除是两个不同操作。'
  if (value.kind === 'BATCH_REMOVE') return '选中项及其所有下级会从目录移出，文档本身仍保留在“全部文档”中。'
  return value.node.nodeType === 'GROUP' && childCount(value.node.id) > 0
    ? '该分组及其所有下级会从目录移出，文档本身仍会保留。'
    : '此操作只移除目录挂载，不会删除对应文档。'
})

watch(() => props.knowledgeBaseId, () => void resetAndLoad(), { immediate: true })

async function resetAndLoad() {
  tree.value = null
  revisions.value = []
  selectedIds.value = []
  collapsedIds.value = []
  locallyCreatedPages.value = []
  await Promise.all([loadCatalog(false), props.showHistory ? loadHistory(true) : Promise.resolve()])
}

async function loadCatalog(manual: boolean) {
  if (!props.knowledgeBaseId) return
  const sequence = ++loadSequence
  if (manual) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    const value = await post<CatalogTree>('/api/v1/catalog/list', { knowledgeBaseId: props.knowledgeBaseId })
    if (sequence !== loadSequence) return
    tree.value = value
    selectedIds.value = selectedIds.value.filter((id) => value.nodes.some((node) => node.id === id))
  } catch (value) {
    if (sequence === loadSequence) error.value = messageOf(value)
  } finally {
    if (sequence === loadSequence) {
      loading.value = false
      refreshing.value = false
    }
  }
}

async function loadHistory(reset: boolean) {
  if (!props.knowledgeBaseId || !props.showHistory) return
  if (reset) historyLoading.value = true
  else historyLoadingMore.value = true
  historyError.value = ''
  try {
    const page = await post<CatalogRevisionPage>('/api/v1/catalog/history/page', {
      knowledgeBaseId: props.knowledgeBaseId,
      limit: 30,
      offset: reset ? 0 : historyOffset.value,
    })
    revisions.value = reset ? page.items : mergeRevisions(revisions.value, page.items)
    historyOffset.value = page.nextOffset
    historyHasMore.value = page.hasMore
  } catch (value) {
    historyError.value = messageOf(value)
  } finally {
    historyLoading.value = false
    historyLoadingMore.value = false
  }
}

async function catalogMutation(path: string, body: Record<string, unknown>, successMessage: string) {
  if (!tree.value || operationPending.value) return false
  operationPending.value = true
  error.value = ''
  conflictNotice.value = ''
  try {
    const value = await post<CatalogTree>(`/api/v1/catalog/${path}`, {
      ...body,
      expectedRevision: tree.value.revision,
    })
    applyTree(value)
    announcement.value = `${successMessage}，目录版本更新为 ${value.revision}`
    return true
  } catch (value) {
    const revisionConflict = value instanceof ApiError && value.problem.code === 'CATALOG_REVISION_CONFLICT'
    error.value = messageOf(value)
    await loadCatalog(false)
    if (revisionConflict) {
      conflictNotice.value = '其他协作者刚刚修改了目录。已载入最新版本，请检查后重试刚才的操作。'
      emit('conflict', tree.value?.revision ?? 0)
    }
    announcement.value = `${successMessage}失败，目录已重新载入`
    return false
  } finally {
    operationPending.value = false
  }
}

function applyTree(value: CatalogTree) {
  tree.value = value
  selectedIds.value = selectedIds.value.filter((id) => value.nodes.some((node) => node.id === id))
  emit('catalog-change', value)
  if (props.showHistory) void loadHistory(true)
}

async function createNode() {
  if (createDisabled.value || !tree.value) return
  const created = await catalogMutation('create', {
    knowledgeBaseId: props.knowledgeBaseId,
    nodeType: createKind.value,
    pageId: createKind.value === 'DOCUMENT' ? createPageId.value : null,
    parentId: createParentId.value || null,
    beforeNodeId: null,
    afterNodeId: null,
    titleOverride: createKind.value === 'DOCUMENT' ? null : createTitle.value.trim(),
    url: createKind.value === 'LINK' ? secureCreateUrl.value : null,
    metadata: {},
  }, '目录项已添加')
  if (created) {
    createTitle.value = ''
    createUrl.value = ''
    createPageId.value = ''
  }
}

function siblings(node: CatalogNode) {
  return (tree.value?.nodes ?? []).filter((value) => value.parentId === node.parentId).sort(positionSort)
}

function siblingIndex(node: CatalogNode) {
  return siblings(node).findIndex((value) => value.id === node.id)
}

function previousSibling(node: CatalogNode) {
  return siblings(node)[siblingIndex(node) - 1]
}

function canMoveUp(node: CatalogNode) {
  return siblingIndex(node) > 0
}

function canMoveDown(node: CatalogNode) {
  const values = siblings(node)
  return siblingIndex(node) >= 0 && siblingIndex(node) < values.length - 1
}

function canIndent(node: CatalogNode) {
  return previousSibling(node)?.nodeType === 'GROUP'
}

async function moveRelative(node: CatalogNode, direction: -1 | 1) {
  const values = siblings(node)
  const index = values.findIndex((value) => value.id === node.id)
  const target = values[index + direction]
  if (!target) return
  await catalogMutation('move', {
    nodeId: node.id,
    targetParentId: node.parentId,
    beforeNodeId: direction < 0 ? target.id : null,
    afterNodeId: direction > 0 ? target.id : null,
  }, `${nodeLabel(node)}已${direction < 0 ? '上移' : '下移'}`)
}

async function indent(node: CatalogNode) {
  const target = previousSibling(node)
  if (!target || target.nodeType !== 'GROUP') return
  await catalogMutation('move', {
    nodeId: node.id,
    targetParentId: target.id,
    beforeNodeId: null,
    afterNodeId: null,
  }, `${nodeLabel(node)}已移入${nodeLabel(target)}`)
}

async function outdent(node: CatalogNode) {
  const parent = tree.value?.nodes.find((value) => value.id === node.parentId)
  if (!parent) return
  await catalogMutation('move', {
    nodeId: node.id,
    targetParentId: parent.parentId,
    beforeNodeId: null,
    afterNodeId: parent.id,
  }, `${nodeLabel(node)}已减少一级`)
}

function onNodeKeydown(event: KeyboardEvent, node: CatalogNode) {
  if (!event.altKey || event.ctrlKey || event.metaKey || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return
  event.preventDefault()
  event.stopPropagation()
  if (operationPending.value) {
    announcement.value = '目录正在更新，请稍候'
    return
  }
  if (event.key === 'ArrowUp') {
    if (canMoveUp(node)) void moveRelative(node, -1)
    else announcement.value = `${nodeLabel(node)}已经是同级第一项`
  } else if (event.key === 'ArrowDown') {
    if (canMoveDown(node)) void moveRelative(node, 1)
    else announcement.value = `${nodeLabel(node)}已经是同级最后一项`
  } else if (event.key === 'ArrowRight') {
    if (canIndent(node)) void indent(node)
    else announcement.value = `${nodeLabel(node)}的上一项不是分组，无法增加层级`
  } else if (node.parentId) void outdent(node)
  else announcement.value = `${nodeLabel(node)}已经位于根级`
}

function startDrag(event: DragEvent, node: CatalogNode) {
  if (props.readonly || selectedIds.value.length) return
  draggingId.value = node.id
  event.dataTransfer?.setData('text/plain', node.id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

function endDrag() {
  draggingId.value = ''
}

async function dropOn(target: CatalogNode) {
  const dragged = tree.value?.nodes.find((node) => node.id === draggingId.value)
  draggingId.value = ''
  if (!dragged || dragged.id === target.id || operationPending.value) return
  if (descendantsOf(tree.value?.nodes ?? [], dragged.id).has(target.id)) {
    announcement.value = '不能把目录项移动到自己的下级中'
    return
  }
  await catalogMutation('move', target.nodeType === 'GROUP'
    ? { nodeId: dragged.id, targetParentId: target.id, beforeNodeId: null, afterNodeId: null }
    : { nodeId: dragged.id, targetParentId: target.parentId, beforeNodeId: target.id, afterNodeId: null },
  `${nodeLabel(dragged)}已移动`)
}

function toggleCollapsed(nodeId: string) {
  collapsedIds.value = collapsedIds.value.includes(nodeId)
    ? collapsedIds.value.filter((id) => id !== nodeId)
    : [...collapsedIds.value, nodeId]
}

function toggleSelected(nodeId: string) {
  if (selectedIds.value.includes(nodeId)) {
    selectedIds.value = selectedIds.value.filter((id) => id !== nodeId)
    return
  }
  if (selectedIds.value.length >= 500) {
    error.value = '一次最多选择 500 个目录项'
    return
  }
  selectedIds.value = [...selectedIds.value, nodeId]
}

function toggleAll() {
  if (allSelected.value) {
    selectedIds.value = []
    return
  }
  selectedIds.value = flatAll.value.slice(0, 500).map(({ node }) => node.id)
  if (flatAll.value.length > 500) error.value = '目录超过 500 项，本次已选择前 500 项'
}

async function batchMove() {
  if (!selectedIds.value.length) return
  const moved = await catalogMutation('batch', {
    knowledgeBaseId: props.knowledgeBaseId,
    nodeIds: selectedIds.value,
    operation: 'MOVE',
    targetParentId: batchTargetId.value || null,
  }, `${selectedIds.value.length}个目录项已移动`)
  if (moved) {
    selectedIds.value = []
    batchTargetId.value = ''
  }
}

function openRename(node: CatalogNode) {
  renamingNode.value = node
  renameTitle.value = nodeLabel(node)
  renameOpen.value = true
}

async function saveRename() {
  if (!renamingNode.value || !renameTitle.value.trim()) return
  const renamed = await catalogMutation('rename', {
    nodeId: renamingNode.value.id,
    title: renameTitle.value.trim(),
  }, '目录标题已保存')
  if (renamed) renameOpen.value = false
}

function openCopy(node: CatalogNode, page: Page) {
  copyingNode.value = node
  copyingPage.value = page
  copyTitle.value = `${page.title}（副本）`.slice(0, 500)
  copyPathValue.value = copyPath(page.path)
  copyError.value = ''
  copyOpen.value = true
}

async function copyPage() {
  if (!copyingNode.value || !copyingPage.value || !copyTitle.value.trim() || !copyPathValue.value || !tree.value) return
  copyPending.value = true
  copyError.value = ''
  try {
    const created = await post<Page>('/api/v1/pages/copy', {
      pageId: copyingPage.value.id,
      targetKnowledgeBaseId: props.knowledgeBaseId,
      title: copyTitle.value.trim(),
      path: sanitizePath(copyPathValue.value),
    })
    locallyCreatedPages.value = [...locallyCreatedPages.value, created]
    emit('page-created', created)
    const mounted = await catalogMutation('create', {
      knowledgeBaseId: props.knowledgeBaseId,
      nodeType: 'DOCUMENT',
      pageId: created.id,
      parentId: copyingNode.value.parentId,
      beforeNodeId: null,
      afterNodeId: copyingNode.value.id,
      titleOverride: null,
      url: null,
      metadata: {},
    }, '文档副本已创建并挂入目录')
    if (mounted) copyOpen.value = false
    else copyError.value = '副本已创建，但目录在此期间发生变化。副本已保留在“全部文档”中，可重新挂载。'
  } catch (value) {
    copyError.value = messageOf(value)
  } finally {
    copyPending.value = false
  }
}

function askForConfirmation(value: Exclude<Confirmation, null>) {
  confirmationError.value = ''
  confirmation.value = value
}

async function runConfirmedAction() {
  const value = confirmation.value
  if (!value || !tree.value) return
  confirmationPending.value = true
  confirmationError.value = ''
  let succeeded = false
  try {
    if (value.kind === 'BATCH_REMOVE') {
      succeeded = await catalogMutation('batch', {
        knowledgeBaseId: props.knowledgeBaseId,
        nodeIds: selectedIds.value,
        operation: 'REMOVE',
        targetParentId: null,
      }, `${selectedIds.value.length}个目录项已移出`)
      if (succeeded) {
        selectedIds.value = []
        batchTargetId.value = ''
      }
    } else if (value.kind === 'REMOVE') {
      const hasChildren = childCount(value.node.id) > 0
      succeeded = await catalogMutation(hasChildren ? 'batch' : 'remove', hasChildren
        ? { knowledgeBaseId: props.knowledgeBaseId, nodeIds: [value.node.id], operation: 'REMOVE', targetParentId: null }
        : { nodeId: value.node.id }, '目录项已移出')
    } else if (value.kind === 'RESTORE') {
      succeeded = await catalogMutation('restore', {
        knowledgeBaseId: props.knowledgeBaseId,
        revisionNo: value.revision.revisionNo,
      }, `目录已恢复到版本${value.revision.revisionNo}`)
    } else {
      await post<void>('/api/v1/pages/trash', { pageId: value.page.id })
      emit('page-trashed', value.page)
      announcement.value = `${value.page.title}已移入回收站`
      succeeded = true
    }
    if (succeeded) confirmation.value = null
    else confirmationError.value = error.value || '操作未完成，请检查最新目录后重试。'
  } catch (reason) {
    confirmationError.value = messageOf(reason)
  } finally {
    confirmationPending.value = false
  }
}

function nodeLabel(node: CatalogNode) {
  return node.titleOverride || (node.pageId ? pageById.value.get(node.pageId)?.title : null) || node.url || '未命名目录项'
}

function nodeSubtitle(node: CatalogNode) {
  if (node.nodeType === 'LINK') return node.url || '未设置链接'
  if (node.nodeType === 'GROUP') return `${childCount(node.id)} 个直接子项`
  const page = node.pageId ? pageById.value.get(node.pageId) : null
  return page ? `/${page.path} · ${contentTypeLabel(page.contentType)}` : '文档已不可用'
}

function activateNode(node: CatalogNode) {
  if (node.nodeType === 'GROUP') {
    toggleCollapsed(node.id)
    return
  }
  if (node.nodeType === 'LINK') {
    const url = safeExternalUrl(node.url ?? '')
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
    return
  }
  if (node.pageId) {
    const page = pageById.value.get(node.pageId)
    if (page) emit('open-page', page)
  }
}

function childCount(nodeId: string) {
  return (tree.value?.nodes ?? []).filter((node) => node.parentId === nodeId).length
}

function contentTypeLabel(value: Page['contentType']) {
  return ({ DOCUMENT: '文档', WHITEBOARD: '白板', SPREADSHEET: '电子表格', DATABASE: '数据表' } as const)[value]
}

function nodeIcon(node: CatalogNode) {
  if (node.nodeType === 'GROUP') return 'mdi-folder-outline'
  if (node.nodeType === 'LINK') return 'mdi-link-variant'
  const page = node.pageId ? pageById.value.get(node.pageId) : null
  return ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' } as Partial<Record<Page['contentType'], string>>)[page?.contentType ?? 'DOCUMENT'] ?? 'mdi-file-question-outline'
}

function operationLabel(value: string) {
  return ({ CREATE: '创建节点', MOVE: '移动节点', RENAME: '重命名', REMOVE: '移出目录', BATCH_MOVE: '批量移动', BATCH_REMOVE: '批量移出', RESTORE: '恢复历史版本' } as Record<string, string>)[value] ?? value
}

function safeExternalUrl(value: string) {
  if (!value.trim()) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function sanitizePath(value: string) {
  return value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 180)
}

function copyPath(value: string) {
  const suffix = '-copy'
  return `${value.slice(0, Math.max(1, 180 - suffix.length)).replace(/-+$/, '') || 'page'}${suffix}`
}

function positionSort(left: CatalogNode, right: CatalogNode) {
  return left.position.localeCompare(right.position)
}

function mergeRevisions(current: CatalogRevision[], incoming: CatalogRevision[]) {
  const seen = new Set(current.map((revision) => revision.id))
  return [...current, ...incoming.filter((revision) => !seen.has(revision.id))]
}

function descendantsOf(nodes: CatalogNode[], rootId: string) {
  const descendants = new Set<string>()
  let changed = true
  while (changed) {
    changed = false
    for (const node of nodes) {
      if ((node.parentId === rootId || (node.parentId && descendants.has(node.parentId))) && !descendants.has(node.id)) {
        descendants.add(node.id)
        changed = true
      }
    }
  }
  return descendants
}

function flattenCatalog(nodes: CatalogNode[], collapsed = new Set<string>()) {
  const result: FlatNode[] = []
  const visited = new Set<string>()
  const children = new Map<string | null, CatalogNode[]>()
  for (const node of nodes) {
    const values = children.get(node.parentId) ?? []
    values.push(node)
    children.set(node.parentId, values)
  }
  for (const values of children.values()) values.sort(positionSort)

  const visit = (node: CatalogNode, depth: number, lineage: Set<string>) => {
    if (visited.has(node.id) || lineage.has(node.id)) return
    visited.add(node.id)
    result.push({ node, depth })
    if (collapsed.has(node.id)) return
    const nextLineage = new Set(lineage).add(node.id)
    for (const child of children.get(node.id) ?? []) visit(child, Math.min(depth + 1, 50), nextLineage)
  }

  for (const node of children.get(null) ?? []) visit(node, 0, new Set())
  for (const node of [...nodes].sort(positionSort)) if (!visited.has(node.id)) visit(node, 0, new Set())
  return result
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
</script>

<template>
  <v-card class="catalog-panel section-card" rounded="xl">
    <v-card-title class="catalog-header pa-5 pa-md-6">
      <div>
        <div class="text-overline text-primary">知识库目录</div>
        <h2>目录编排</h2>
        <p>当前版本 {{ tree?.revision ?? 0 }} · 文档可以不挂入目录</p>
      </div>
      <v-spacer />
      <v-chip v-if="operationPending" color="info" variant="tonal" prepend-icon="mdi-sync">正在保存</v-chip>
      <v-btn icon="mdi-refresh" variant="text" :loading="refreshing" aria-label="刷新目录" @click="loadCatalog(true)" />
    </v-card-title>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-divider />

    <v-alert v-if="conflictNotice" type="warning" variant="tonal" closable class="ma-4 mb-0" @click:close="conflictNotice = ''">{{ conflictNotice }}</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" closable class="ma-4 mb-0" @click:close="error = ''">{{ error }}</v-alert>

    <div v-if="!readonly" class="create-panel ma-4 pa-4">
      <v-btn-toggle v-model="createKind" mandatory color="primary" variant="outlined" divided>
        <v-btn value="GROUP" prepend-icon="mdi-folder-plus-outline">分组</v-btn>
        <v-btn value="LINK" prepend-icon="mdi-link-plus">外部链接</v-btn>
        <v-btn value="DOCUMENT" prepend-icon="mdi-file-plus-outline">已有文档</v-btn>
      </v-btn-toggle>
      <v-select v-if="createKind === 'DOCUMENT'" v-model="createPageId" :items="unlistedPages" item-title="title" item-value="id" label="选择未挂载文档" hide-details />
      <v-text-field v-else v-model="createTitle" :label="createKind === 'GROUP' ? '分组名称' : '链接标题'" maxlength="500" hide-details />
      <v-text-field v-if="createKind === 'LINK'" v-model="createUrl" label="HTTPS 链接" placeholder="https://example.com" hide-details :error="Boolean(createUrl && !secureCreateUrl)" />
      <v-select v-model="createParentId" :items="groupRows" :item-title="item => `${'　'.repeat(item.depth)}${nodeLabel(item.node)}`" :item-value="item => item.node.id" label="父级位置" hide-details clearable placeholder="目录根级" />
      <v-btn color="primary" prepend-icon="mdi-plus" :loading="operationPending" :disabled="createDisabled" @click="createNode">添加</v-btn>
      <div v-if="createKind === 'LINK' && createUrl && !secureCreateUrl" class="create-error">请输入不含账号凭据的 HTTPS 地址</div>
    </div>

    <div v-if="!readonly" class="batch-toolbar mx-4 mb-4" :class="{ active: selectedIds.length }">
      <v-checkbox-btn :model-value="allSelected" :indeterminate="selectedIds.length > 0 && !allSelected" aria-label="全选目录项" @update:model-value="toggleAll" />
      <strong>{{ selectedIds.length ? `已选择 ${selectedIds.length} 项` : '批量选择' }}</strong>
      <template v-if="selectedIds.length">
        <v-select v-model="batchTargetId" :items="batchTargetGroups" :item-title="item => `${'　'.repeat(item.depth)}${nodeLabel(item.node)}`" :item-value="item => item.node.id" label="移动到" density="compact" hide-details clearable placeholder="目录根级" />
        <v-btn variant="tonal" prepend-icon="mdi-folder-move-outline" :disabled="operationPending" @click="batchMove">批量移动</v-btn>
        <v-btn color="error" variant="text" prepend-icon="mdi-link-variant-off" :disabled="operationPending" @click="askForConfirmation({ kind: 'BATCH_REMOVE' })">批量移出</v-btn>
        <v-btn icon="mdi-close" variant="text" aria-label="取消批量选择" @click="selectedIds = []; batchTargetId = ''" />
      </template>
    </div>

    <div class="catalog-layout" :class="{ 'without-history': !showHistory }">
      <main class="catalog-tree-wrap">
        <p id="catalog-keyboard-help" class="sr-only">目录项支持 Alt 加方向键：上移、下移、缩进和减少层级。</p>
        <div v-if="flatVisible.length" class="catalog-tree" role="tree" aria-label="目录树" aria-describedby="catalog-keyboard-help">
          <div
            v-for="({ node, depth }) in flatVisible"
            :key="node.id"
            class="catalog-node"
            :class="{ selected: selectedSet.has(node.id), dragging: draggingId === node.id }"
            :style="{ '--catalog-depth': depth }"
            role="treeitem"
            :aria-level="depth + 1"
            :aria-expanded="node.nodeType === 'GROUP' ? !collapsedIds.includes(node.id) : undefined"
            :draggable="!readonly && !selectedIds.length"
            tabindex="0"
            @keydown="onNodeKeydown($event, node)"
            @dragstart="startDrag($event, node)"
            @dragend="endDrag"
            @dragover.prevent
            @drop.prevent="dropOn(node)"
          >
            <v-checkbox-btn v-if="!readonly" :model-value="selectedSet.has(node.id)" :aria-label="`选择 ${nodeLabel(node)}`" @click.stop @update:model-value="toggleSelected(node.id)" />
            <v-icon v-if="!readonly" class="drag-handle" size="18">mdi-drag-vertical</v-icon>
            <v-btn v-if="node.nodeType === 'GROUP'" :icon="collapsedIds.includes(node.id) ? 'mdi-chevron-right' : 'mdi-chevron-down'" size="x-small" variant="text" :aria-label="`${collapsedIds.includes(node.id) ? '展开' : '折叠'} ${nodeLabel(node)}`" @click.stop="toggleCollapsed(node.id)" />
            <span v-else class="tree-spacer" />
            <v-avatar :color="node.nodeType === 'GROUP' ? 'warning' : node.nodeType === 'LINK' ? 'secondary' : 'primary'" variant="tonal" rounded="lg" size="34"><v-icon size="19">{{ nodeIcon(node) }}</v-icon></v-avatar>
            <button class="node-label" type="button" :disabled="node.nodeType === 'DOCUMENT' && (!node.pageId || !pageById.get(node.pageId))" @click="activateNode(node)">
              <strong>{{ nodeLabel(node) }}</strong><small>{{ nodeSubtitle(node) }}</small>
            </button>
            <div v-if="!readonly" class="node-actions">
              <v-btn icon="mdi-arrow-up" size="x-small" variant="text" :disabled="operationPending || !canMoveUp(node)" :aria-label="`上移 ${nodeLabel(node)}`" @click="moveRelative(node, -1)" />
              <v-btn icon="mdi-arrow-down" size="x-small" variant="text" :disabled="operationPending || !canMoveDown(node)" :aria-label="`下移 ${nodeLabel(node)}`" @click="moveRelative(node, 1)" />
              <v-btn icon="mdi-format-indent-increase" size="x-small" variant="text" :disabled="operationPending || !canIndent(node)" :aria-label="`缩进 ${nodeLabel(node)}`" @click="indent(node)" />
              <v-btn icon="mdi-format-indent-decrease" size="x-small" variant="text" :disabled="operationPending || !node.parentId" :aria-label="`减少 ${nodeLabel(node)} 的层级`" @click="outdent(node)" />
              <v-menu>
                <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-horizontal" size="small" variant="text" :aria-label="`${nodeLabel(node)} 的更多操作`" /></template>
                <v-list density="compact">
                  <v-list-item prepend-icon="mdi-pencil-outline" title="重命名目录显示" @click="openRename(node)" />
                  <v-list-item v-if="node.pageId && pageById.get(node.pageId)" prepend-icon="mdi-content-copy" title="复制文档" @click="openCopy(node, pageById.get(node.pageId)!)" />
                  <v-divider />
                  <v-list-item prepend-icon="mdi-link-variant-off" title="移出目录" base-color="error" @click="askForConfirmation({ kind: 'REMOVE', node })" />
                  <v-list-item v-if="node.pageId && pageById.get(node.pageId)" prepend-icon="mdi-trash-can-outline" title="删除文档" base-color="error" @click="askForConfirmation({ kind: 'TRASH', page: pageById.get(node.pageId)! })" />
                </v-list>
              </v-menu>
            </div>
          </div>
        </div>
        <div v-else-if="!loading" class="empty-state catalog-empty"><div><v-icon size="48" color="primary">mdi-folder-open-outline</v-icon><h3>目录还是空的</h3><p>{{ readonly ? '这里暂时没有目录内容。' : '添加分组、外部链接或挂载已有文档。' }}</p></div></div>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
      </main>

      <aside v-if="showHistory" class="catalog-history">
        <header><div><v-icon>mdi-history</v-icon><strong>目录历史</strong></div><v-chip size="x-small" variant="tonal">{{ revisions.length }}{{ historyHasMore ? '+' : '' }}</v-chip></header>
        <v-progress-linear v-if="historyLoading" indeterminate color="primary" />
        <v-alert v-if="historyError" type="error" variant="tonal" density="compact" class="ma-3">{{ historyError }}</v-alert>
        <div v-if="revisions.length" class="history-list">
          <div v-for="revision in revisions" :key="revision.id" class="history-row">
            <v-avatar size="30" color="primary" variant="tonal">{{ revision.revisionNo }}</v-avatar>
            <div><strong>{{ operationLabel(revision.operation) }}</strong><small>{{ formatTime(revision.createdAt) }}</small></div>
            <v-btn v-if="!readonly" icon="mdi-backup-restore" size="small" variant="text" :disabled="operationPending || revision.revisionNo === tree?.revision" :aria-label="`恢复到目录版本 ${revision.revisionNo}`" @click="askForConfirmation({ kind: 'RESTORE', revision })" />
          </div>
        </div>
        <div v-else-if="!historyLoading" class="history-empty">尚无变更记录</div>
        <v-btn v-if="historyHasMore" block variant="text" :loading="historyLoadingMore" @click="loadHistory(false)">加载更多历史</v-btn>
      </aside>
    </div>

    <v-dialog v-model="renameOpen" max-width="500" :persistent="operationPending">
      <v-card rounded="xl"><v-card-title class="pa-6 pb-2">重命名目录项</v-card-title><v-card-text class="px-6 pb-3"><v-text-field v-model="renameTitle" label="新标题" maxlength="500" counter autofocus @keydown.enter.prevent="saveRename" /></v-card-text><v-card-actions class="pa-6 pt-3"><v-spacer /><v-btn variant="text" :disabled="operationPending" @click="renameOpen = false">取消</v-btn><v-btn color="primary" :loading="operationPending" :disabled="!renameTitle.trim()" @click="saveRename">保存标题</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog v-model="copyOpen" max-width="560" :persistent="copyPending">
      <v-card rounded="xl"><v-card-title class="pa-6 pb-2">复制文档</v-card-title><v-card-text class="px-6 pb-3"><p class="dialog-description">副本会创建在当前知识库，并挂在原文档之后。发布状态与分享策略不会复制。</p><v-text-field v-model="copyTitle" label="副本标题" maxlength="500" counter /><v-text-field v-model="copyPathValue" label="访问路径" prefix="/" maxlength="180" @blur="copyPathValue = sanitizePath(copyPathValue)" /><v-alert v-if="copyError" type="error" variant="tonal">{{ copyError }}</v-alert></v-card-text><v-card-actions class="pa-6 pt-3"><v-spacer /><v-btn variant="text" :disabled="copyPending" @click="copyOpen = false">取消</v-btn><v-btn color="primary" prepend-icon="mdi-content-copy" :loading="copyPending" :disabled="!copyTitle.trim() || !sanitizePath(copyPathValue)" @click="copyPage">创建副本</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(confirmation)" max-width="520" :persistent="confirmationPending" @update:model-value="value => { if (!value && !confirmationPending) confirmation = null }">
      <v-card rounded="xl"><v-card-title class="pa-6 pb-2">{{ confirmationTitle }}</v-card-title><v-card-text class="px-6 pb-3">{{ confirmationDescription }}<v-alert v-if="confirmationError" type="error" variant="tonal" class="mt-4">{{ confirmationError }}</v-alert></v-card-text><v-card-actions class="pa-6 pt-3"><v-spacer /><v-btn variant="text" :disabled="confirmationPending" @click="confirmation = null">取消</v-btn><v-btn :color="confirmation?.kind === 'RESTORE' ? 'primary' : 'error'" variant="flat" :loading="confirmationPending" @click="runConfirmedAction">确认</v-btn></v-card-actions></v-card>
    </v-dialog>
  </v-card>
</template>

<style scoped>
.catalog-header { display: flex; align-items: center; gap: 10px; }
.catalog-header h2 { margin: 0; font-size: 1.2rem; }
.catalog-header p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface), .55); font-size: .8rem; }
.create-panel { position: relative; display: grid; grid-template-columns: auto minmax(180px, 1.3fr) minmax(180px, 1fr) auto; gap: 12px; align-items: center; border: 1px solid rgb(var(--v-theme-primary), .12); border-radius: 14px; background: rgb(var(--v-theme-primary), .035); }
.create-error { position: absolute; left: 16px; bottom: -22px; color: rgb(var(--v-theme-error)); font-size: .75rem; }
.batch-toolbar { min-height: 52px; display: flex; align-items: center; gap: 10px; padding: 6px 12px; border: 1px solid rgb(var(--v-theme-on-surface), .08); border-radius: 12px; transition: .16s ease; }
.batch-toolbar.active { border-color: rgb(var(--v-theme-primary), .25); background: rgb(var(--v-theme-primary), .045); }
.batch-toolbar .v-select { max-width: 260px; margin-left: auto; }
.catalog-layout { display: grid; grid-template-columns: minmax(0, 1fr) 280px; border-top: 1px solid rgb(var(--v-theme-on-surface), .08); min-height: 400px; }
.catalog-layout.without-history { grid-template-columns: 1fr; }
.catalog-tree-wrap { min-width: 0; padding: 12px; }
.catalog-tree { display: grid; gap: 3px; }
.catalog-node { display: flex; align-items: center; gap: 6px; min-height: 54px; padding: 5px 7px 5px calc(7px + var(--catalog-depth) * 22px); border: 1px solid transparent; border-radius: 10px; transition: background .14s ease, border-color .14s ease, opacity .14s ease; }
.catalog-node:hover, .catalog-node:focus-within { background: rgb(var(--v-theme-surface-variant), .35); }
.catalog-node.selected { border-color: rgb(var(--v-theme-primary), .24); background: rgb(var(--v-theme-primary), .055); }
.catalog-node.dragging { opacity: .45; }
.drag-handle { color: rgb(var(--v-theme-on-surface), .35); cursor: grab; }
.tree-spacer { width: 28px; }
.node-label { min-width: 0; flex: 1; display: grid; gap: 2px; border: 0; background: none; padding: 4px; text-align: left; color: inherit; font: inherit; cursor: pointer; }
.node-label:disabled { cursor: default; }
.node-label strong, .node-label small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.node-label small { color: rgb(var(--v-theme-on-surface), .5); }
.node-actions { display: flex; align-items: center; opacity: .42; transition: opacity .14s ease; }
.catalog-node:hover .node-actions, .catalog-node:focus-within .node-actions { opacity: 1; }
.catalog-history { border-left: 1px solid rgb(var(--v-theme-on-surface), .08); background: rgb(var(--v-theme-surface-variant), .18); }
.catalog-history > header { height: 54px; display: flex; align-items: center; justify-content: space-between; padding: 0 14px; border-bottom: 1px solid rgb(var(--v-theme-on-surface), .07); }
.catalog-history > header div { display: flex; align-items: center; gap: 8px; }
.history-list { padding: 8px; display: grid; gap: 3px; }
.history-row { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 5px 6px; border-radius: 9px; }
.history-row:hover { background: rgb(var(--v-theme-surface)); }
.history-row > div { display: grid; min-width: 0; flex: 1; }
.history-row strong { font-size: .82rem; }
.history-row small { color: rgb(var(--v-theme-on-surface), .5); font-size: .72rem; }
.history-empty { padding: 32px 16px; color: rgb(var(--v-theme-on-surface), .5); text-align: center; }
.catalog-empty { min-height: 330px; }
.dialog-description { margin: 0 0 18px; color: rgb(var(--v-theme-on-surface), .62); line-height: 1.6; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (max-width: 1100px) {
  .create-panel { grid-template-columns: 1fr 1fr; }
  .create-panel .v-btn-toggle { grid-column: 1 / -1; }
  .catalog-layout { grid-template-columns: 1fr; }
  .catalog-history { border-left: 0; border-top: 1px solid rgb(var(--v-theme-on-surface), .08); }
  .node-actions > .v-btn:nth-child(-n+4) { display: none; }
}
@media (max-width: 700px) {
  .create-panel { grid-template-columns: 1fr; }
  .create-panel > * { width: 100%; }
  .batch-toolbar { align-items: stretch; flex-wrap: wrap; }
  .batch-toolbar .v-select { flex-basis: 100%; max-width: none; margin-left: 0; }
  .catalog-node { padding-left: calc(3px + var(--catalog-depth) * 12px); }
  .drag-handle { display: none; }
}
</style>
