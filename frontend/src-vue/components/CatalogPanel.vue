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
const createOpen = ref(false)
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
let copyKnowledgeBaseId = ''
let copyContextSequence = 0

const confirmation = ref<Confirmation>(null)
const confirmationPending = ref(false)
const confirmationError = ref('')
let confirmationKnowledgeBaseId = ''
let confirmationContextSequence = 0

let contextSequence = 0
let loadSequence = 0
let historyLoadSequence = 0
let mutationSequence = 0
let copyRequestSequence = 0
let confirmationActionSequence = 0

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

watch(() => props.knowledgeBaseId, (knowledgeBaseId) => void resetAndLoad(knowledgeBaseId), { immediate: true })

async function resetAndLoad(knowledgeBaseId: string) {
  const context = ++contextSequence
  ++loadSequence
  ++historyLoadSequence
  ++mutationSequence
  ++copyRequestSequence
  ++confirmationActionSequence

  tree.value = null
  loading.value = false
  refreshing.value = false
  operationPending.value = false
  error.value = ''
  conflictNotice.value = ''
  announcement.value = ''

  createKind.value = 'GROUP'
  createOpen.value = false
  createTitle.value = ''
  createUrl.value = ''
  createPageId.value = ''
  createParentId.value = ''

  revisions.value = []
  historyOffset.value = 0
  historyHasMore.value = false
  historyLoading.value = false
  historyLoadingMore.value = false
  historyError.value = ''

  selectedIds.value = []
  collapsedIds.value = []
  batchTargetId.value = ''
  draggingId.value = ''

  renamingNode.value = null
  renameTitle.value = ''
  renameOpen.value = false

  copyingNode.value = null
  copyingPage.value = null
  copyTitle.value = ''
  copyPathValue.value = ''
  copyOpen.value = false
  copyPending.value = false
  copyError.value = ''
  copyKnowledgeBaseId = ''
  copyContextSequence = 0
  locallyCreatedPages.value = []

  confirmation.value = null
  confirmationPending.value = false
  confirmationError.value = ''
  confirmationKnowledgeBaseId = ''
  confirmationContextSequence = 0

  if (!knowledgeBaseId) return
  await Promise.all([
    loadCatalog(false, knowledgeBaseId, context),
    props.showHistory ? loadHistory(true, knowledgeBaseId, context) : Promise.resolve(),
  ])
}

function isCurrentContext(knowledgeBaseId: string, context: number) {
  return Boolean(knowledgeBaseId) && knowledgeBaseId === props.knowledgeBaseId && context === contextSequence
}

async function loadCatalog(manual: boolean, knowledgeBaseId = props.knowledgeBaseId, context = contextSequence) {
  if (!isCurrentContext(knowledgeBaseId, context)) return
  const sequence = ++loadSequence
  if (manual) refreshing.value = true
  else loading.value = true
  error.value = ''
  try {
    const value = await post<CatalogTree>('/api/v1/catalog/list', { knowledgeBaseId })
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== loadSequence) return
    if (value.knowledgeBaseId !== knowledgeBaseId) throw new Error('目录响应不属于当前知识库')
    tree.value = value
    selectedIds.value = selectedIds.value.filter((id) => value.nodes.some((node) => node.id === id))
  } catch (value) {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === loadSequence) error.value = messageOf(value)
  } finally {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === loadSequence) {
      loading.value = false
      refreshing.value = false
    }
  }
}

async function loadHistory(reset: boolean, knowledgeBaseId = props.knowledgeBaseId, context = contextSequence) {
  if (!props.showHistory || !isCurrentContext(knowledgeBaseId, context)) return
  const sequence = ++historyLoadSequence
  const offset = reset ? 0 : historyOffset.value
  if (reset) historyLoading.value = true
  else historyLoadingMore.value = true
  historyError.value = ''
  try {
    const page = await post<CatalogRevisionPage>('/api/v1/catalog/history/page', {
      knowledgeBaseId,
      limit: 30,
      offset,
    })
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== historyLoadSequence) return
    revisions.value = reset ? page.items : mergeRevisions(revisions.value, page.items)
    historyOffset.value = page.nextOffset
    historyHasMore.value = page.hasMore
  } catch (value) {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === historyLoadSequence) historyError.value = messageOf(value)
  } finally {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === historyLoadSequence) {
      historyLoading.value = false
      historyLoadingMore.value = false
    }
  }
}

async function catalogMutation(path: string, body: Record<string, unknown>, successMessage: string) {
  const knowledgeBaseId = props.knowledgeBaseId
  const context = contextSequence
  const currentTree = tree.value
  if (!currentTree || currentTree.knowledgeBaseId !== knowledgeBaseId || operationPending.value || !isCurrentContext(knowledgeBaseId, context)) return false
  const sequence = ++mutationSequence
  const requestBody = { ...body }
  if (Object.prototype.hasOwnProperty.call(requestBody, 'knowledgeBaseId')) requestBody.knowledgeBaseId = knowledgeBaseId
  operationPending.value = true
  error.value = ''
  conflictNotice.value = ''
  try {
    const value = await post<CatalogTree>(`/api/v1/catalog/${path}`, {
      ...requestBody,
      expectedRevision: currentTree.revision,
    })
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== mutationSequence) return false
    if (value.knowledgeBaseId !== knowledgeBaseId) throw new Error('目录更新响应不属于当前知识库')
    if (!applyTree(value, knowledgeBaseId, context)) return false
    announcement.value = `${successMessage}，目录版本更新为 ${value.revision}`
    return true
  } catch (value) {
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== mutationSequence) return false
    const revisionConflict = value instanceof ApiError && value.problem.code === 'CATALOG_REVISION_CONFLICT'
    error.value = messageOf(value)
    await loadCatalog(false, knowledgeBaseId, context)
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== mutationSequence) return false
    if (revisionConflict) {
      conflictNotice.value = '其他协作者刚刚修改了目录。已载入最新版本，请检查后重试刚才的操作。'
      emit('conflict', tree.value?.revision ?? 0)
    }
    announcement.value = `${successMessage}失败，目录已重新载入`
    return false
  } finally {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === mutationSequence) operationPending.value = false
  }
}

function applyTree(value: CatalogTree, knowledgeBaseId: string, context: number) {
  if (!isCurrentContext(knowledgeBaseId, context) || value.knowledgeBaseId !== knowledgeBaseId) return false
  tree.value = value
  selectedIds.value = selectedIds.value.filter((id) => value.nodes.some((node) => node.id === id))
  emit('catalog-change', value)
  if (props.showHistory) void loadHistory(true, knowledgeBaseId, context)
  return true
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
    createOpen.value = false
  }
}

function beginCreate(kind: CreateKind) {
  createKind.value = kind
  createTitle.value = ''
  createUrl.value = ''
  createPageId.value = ''
  createOpen.value = true
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
  if (!tree.value || tree.value.knowledgeBaseId !== props.knowledgeBaseId || node.knowledgeBaseId !== props.knowledgeBaseId || page.knowledgeBaseId !== props.knowledgeBaseId) return
  copyingNode.value = node
  copyingPage.value = page
  copyTitle.value = `${page.title}（副本）`.slice(0, 500)
  copyPathValue.value = copyPath(page.path)
  copyError.value = ''
  copyKnowledgeBaseId = props.knowledgeBaseId
  copyContextSequence = contextSequence
  copyOpen.value = true
}

async function copyPage() {
  const knowledgeBaseId = copyKnowledgeBaseId
  const context = copyContextSequence
  const node = copyingNode.value
  const page = copyingPage.value
  const title = copyTitle.value.trim()
  const path = sanitizePath(copyPathValue.value)
  if (!node || !page || !title || !path || !tree.value || tree.value.knowledgeBaseId !== knowledgeBaseId || node.knowledgeBaseId !== knowledgeBaseId || page.knowledgeBaseId !== knowledgeBaseId || !isCurrentContext(knowledgeBaseId, context)) return
  const sequence = ++copyRequestSequence
  copyPending.value = true
  copyError.value = ''
  try {
    const created = await post<Page>('/api/v1/pages/copy', {
      pageId: page.id,
      targetKnowledgeBaseId: knowledgeBaseId,
      title,
      path,
    })
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== copyRequestSequence) return
    if (created.knowledgeBaseId !== knowledgeBaseId) throw new Error('文档副本响应不属于当前知识库')
    locallyCreatedPages.value = [...locallyCreatedPages.value, created]
    emit('page-created', created)
    const mounted = await catalogMutation('create', {
      knowledgeBaseId,
      nodeType: 'DOCUMENT',
      pageId: created.id,
      parentId: node.parentId,
      beforeNodeId: null,
      afterNodeId: node.id,
      titleOverride: null,
      url: null,
      metadata: {},
    }, '文档副本已创建并挂入目录')
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== copyRequestSequence) return
    if (mounted) copyOpen.value = false
    else copyError.value = '副本已创建，但目录在此期间发生变化。副本已保留在“全部文档”中，可重新挂载。'
  } catch (value) {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === copyRequestSequence) copyError.value = messageOf(value)
  } finally {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === copyRequestSequence) copyPending.value = false
  }
}

function askForConfirmation(value: Exclude<Confirmation, null>) {
  const knowledgeBaseId = props.knowledgeBaseId
  if (!tree.value || tree.value.knowledgeBaseId !== knowledgeBaseId || !confirmationBelongsToKnowledgeBase(value, knowledgeBaseId)) return
  confirmationError.value = ''
  confirmationKnowledgeBaseId = knowledgeBaseId
  confirmationContextSequence = contextSequence
  confirmation.value = value
}

async function runConfirmedAction() {
  const value = confirmation.value
  const knowledgeBaseId = confirmationKnowledgeBaseId
  const context = confirmationContextSequence
  if (!value || !tree.value || tree.value.knowledgeBaseId !== knowledgeBaseId || !isCurrentContext(knowledgeBaseId, context) || !confirmationBelongsToKnowledgeBase(value, knowledgeBaseId)) {
    confirmation.value = null
    return
  }
  const sequence = ++confirmationActionSequence
  confirmationPending.value = true
  confirmationError.value = ''
  let succeeded = false
  try {
    if (value.kind === 'BATCH_REMOVE') {
      succeeded = await catalogMutation('batch', {
        knowledgeBaseId,
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
        ? { knowledgeBaseId, nodeIds: [value.node.id], operation: 'REMOVE', targetParentId: null }
        : { nodeId: value.node.id }, '目录项已移出')
    } else if (value.kind === 'RESTORE') {
      succeeded = await catalogMutation('restore', {
        knowledgeBaseId,
        revisionNo: value.revision.revisionNo,
      }, `目录已恢复到版本${value.revision.revisionNo}`)
    } else {
      await post<void>('/api/v1/pages/trash', { pageId: value.page.id })
      if (!isCurrentContext(knowledgeBaseId, context) || sequence !== confirmationActionSequence) return
      emit('page-trashed', value.page)
      announcement.value = `${value.page.title}已移入回收站`
      succeeded = true
    }
    if (!isCurrentContext(knowledgeBaseId, context) || sequence !== confirmationActionSequence) return
    if (succeeded) confirmation.value = null
    else confirmationError.value = error.value || '操作未完成，请检查最新目录后重试。'
  } catch (reason) {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === confirmationActionSequence) confirmationError.value = messageOf(reason)
  } finally {
    if (isCurrentContext(knowledgeBaseId, context) && sequence === confirmationActionSequence) confirmationPending.value = false
  }
}

function confirmationBelongsToKnowledgeBase(value: Exclude<Confirmation, null>, knowledgeBaseId: string) {
  if (value.kind === 'REMOVE') return value.node.knowledgeBaseId === knowledgeBaseId
  if (value.kind === 'RESTORE') return value.revision.knowledgeBaseId === knowledgeBaseId
  if (value.kind === 'TRASH') return value.page.knowledgeBaseId === knowledgeBaseId
  return selectedIds.value.length > 0 && selectedIds.value.every((id) => tree.value?.nodes.some((node) => node.id === id && node.knowledgeBaseId === knowledgeBaseId))
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
  if (node.nodeType === 'GROUP') return 'mdi-format-title'
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
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password ? url.href : null
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
  // Keep malformed/orphaned nodes visible, but never re-add descendants that
  // were intentionally skipped because one of their ancestors is collapsed.
  const hiddenByCollapse = new Set<string>()
  const hideDescendants = (nodeId: string) => {
    for (const child of children.get(nodeId) ?? []) {
      if (hiddenByCollapse.has(child.id)) continue
      hiddenByCollapse.add(child.id)
      hideDescendants(child.id)
    }
  }
  for (const nodeId of collapsed) hideDescendants(nodeId)
  for (const node of [...nodes].sort(positionSort)) if (!visited.has(node.id) && !hiddenByCollapse.has(node.id)) visit(node, 0, new Set())
  return result
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}
</script>

<template>
  <section class="catalog-panel" :class="{ readonly }">
    <header class="catalog-header">
      <div class="catalog-title">
        <strong>{{ readonly ? '目录' : '整理目录' }}</strong>
        <span v-if="tree">版本 {{ tree.revision }}</span>
      </div>
      <span v-if="operationPending" class="saving-indicator"><v-progress-circular indeterminate size="13" width="2" />保存中</span>
      <v-btn icon="mdi-refresh" variant="text" size="small" :loading="refreshing" aria-label="刷新目录" @click="loadCatalog(true)" />
      <v-menu v-if="!readonly" location="bottom end">
        <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" color="primary" variant="flat" size="small" prepend-icon="mdi-plus">新建</v-btn></template>
        <v-list density="compact" min-width="176">
          <v-list-item prepend-icon="mdi-file-document-plus-outline" title="挂载已有文档" @click="beginCreate('DOCUMENT')" />
          <v-list-item prepend-icon="mdi-format-title" title="新建分组标题" @click="beginCreate('GROUP')" />
          <v-list-item prepend-icon="mdi-link-plus" title="添加外部链接" @click="beginCreate('LINK')" />
        </v-list>
      </v-menu>
    </header>
    <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />

    <div v-if="conflictNotice || error" class="catalog-notices">
      <v-alert v-if="conflictNotice" type="warning" variant="tonal" density="compact" closable @click:close="conflictNotice = ''">{{ conflictNotice }}</v-alert>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" closable @click:close="error = ''">{{ error }}</v-alert>
    </div>

    <form v-if="!readonly && createOpen" class="create-panel" @submit.prevent="createNode">
      <div class="create-panel-title"><v-icon size="17">{{ createKind === 'DOCUMENT' ? 'mdi-file-document-plus-outline' : createKind === 'GROUP' ? 'mdi-format-title' : 'mdi-link-plus' }}</v-icon><strong>{{ createKind === 'DOCUMENT' ? '挂载已有文档' : createKind === 'GROUP' ? '新建分组标题' : '添加外部链接' }}</strong><v-spacer /><v-btn icon="mdi-close" size="x-small" variant="text" aria-label="关闭新增目录项" @click="createOpen = false" /></div>
      <v-select v-if="createKind === 'DOCUMENT'" v-model="createPageId" :items="unlistedPages" item-title="title" item-value="id" label="选择未挂载文档" density="compact" variant="outlined" hide-details />
      <v-text-field v-else v-model="createTitle" :label="createKind === 'GROUP' ? '分组名称' : '链接标题'" density="compact" variant="outlined" maxlength="500" hide-details autofocus />
      <v-text-field v-if="createKind === 'LINK'" v-model="createUrl" label="网页链接" density="compact" variant="outlined" placeholder="https://example.com" hide-details :error="Boolean(createUrl && !secureCreateUrl)" />
      <v-select v-model="createParentId" :items="groupRows" :item-title="item => `${'　'.repeat(item.depth)}${nodeLabel(item.node)}`" :item-value="item => item.node.id" label="所在分组" density="compact" variant="outlined" hide-details clearable placeholder="目录根级" />
      <div class="create-actions"><span v-if="createKind === 'LINK' && createUrl && !secureCreateUrl" class="create-error">请输入不含账号凭据的 HTTP/HTTPS 地址</span><v-spacer /><v-btn variant="text" size="small" @click="createOpen = false">取消</v-btn><v-btn type="submit" color="primary" size="small" :loading="operationPending" :disabled="createDisabled">确定</v-btn></div>
    </form>

    <div v-if="!readonly && flatAll.length" class="batch-toolbar" :class="{ active: selectedIds.length }">
      <v-checkbox-btn :model-value="allSelected" :indeterminate="selectedIds.length > 0 && !allSelected" density="compact" aria-label="全选目录项" @update:model-value="toggleAll" />
      <span>{{ selectedIds.length ? `已选择 ${selectedIds.length} 项` : '批量选择' }}</span>
      <template v-if="selectedIds.length">
        <v-select v-model="batchTargetId" :items="batchTargetGroups" :item-title="item => `${'　'.repeat(item.depth)}${nodeLabel(item.node)}`" :item-value="item => item.node.id" density="compact" variant="outlined" hide-details clearable placeholder="移动到根目录" />
        <v-btn variant="text" size="small" :disabled="operationPending" @click="batchMove">移动</v-btn>
        <v-btn color="error" variant="text" size="small" :disabled="operationPending" @click="askForConfirmation({ kind: 'BATCH_REMOVE' })">移出</v-btn>
        <v-btn icon="mdi-close" variant="text" size="x-small" aria-label="取消批量选择" @click="selectedIds = []; batchTargetId = ''" />
      </template>
    </div>

    <div class="catalog-layout" :class="{ 'without-history': !showHistory }">
      <main class="catalog-tree-wrap">
        <p id="catalog-keyboard-help" class="sr-only">目录项支持拖动排序；按住 Alt 并使用方向键可上移、下移、缩进和减少层级。</p>
        <div v-if="loading && !tree" class="catalog-skeleton" aria-label="正在加载目录"><span v-for="index in 7" :key="index" :style="{ width: `${64 + (index % 3) * 9}%` }" /></div>
        <div v-else-if="flatVisible.length" class="catalog-tree" role="tree" aria-label="目录树" aria-describedby="catalog-keyboard-help">
          <div
            v-for="({ node, depth }) in flatVisible"
            :key="node.id"
            class="catalog-node"
            :class="{ selected: selectedSet.has(node.id), dragging: draggingId === node.id, group: node.nodeType === 'GROUP' }"
            :style="{ '--catalog-depth': depth }"
            :data-node-type="node.nodeType"
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
            <v-checkbox-btn v-if="!readonly" class="row-select" :model-value="selectedSet.has(node.id)" density="compact" :aria-label="`选择 ${nodeLabel(node)}`" @click.stop @update:model-value="toggleSelected(node.id)" />
            <v-icon v-if="!readonly" class="drag-handle" size="15">mdi-drag</v-icon>
            <button v-if="node.nodeType === 'GROUP'" class="collapse-button" type="button" :aria-label="`${collapsedIds.includes(node.id) ? '展开' : '折叠'} ${nodeLabel(node)}`" @click.stop="toggleCollapsed(node.id)"><v-icon size="16">{{ collapsedIds.includes(node.id) ? 'mdi-chevron-right' : 'mdi-chevron-down' }}</v-icon></button>
            <span v-else class="tree-spacer" />
            <v-icon class="node-icon" size="16">{{ nodeIcon(node) }}</v-icon>
            <button class="node-label" type="button" :title="nodeSubtitle(node)" :disabled="node.nodeType === 'DOCUMENT' && (!node.pageId || !pageById.get(node.pageId))" @click="activateNode(node)"><span>{{ nodeLabel(node) }}</span></button>
            <v-icon v-if="node.nodeType === 'LINK'" class="external-mark" size="13">mdi-open-in-new</v-icon>
            <div v-if="!readonly" class="node-actions">
              <v-menu location="bottom end">
                <template #activator="{ props: menuProps }"><v-btn v-bind="menuProps" icon="mdi-dots-horizontal" size="x-small" variant="text" :aria-label="`${nodeLabel(node)} 的更多操作`" /></template>
                <v-list density="compact" min-width="190">
                  <v-list-item prepend-icon="mdi-arrow-up" title="上移" :disabled="operationPending || !canMoveUp(node)" @click="moveRelative(node, -1)" />
                  <v-list-item prepend-icon="mdi-arrow-down" title="下移" :disabled="operationPending || !canMoveDown(node)" @click="moveRelative(node, 1)" />
                  <v-list-item prepend-icon="mdi-format-indent-increase" title="增加层级" :disabled="operationPending || !canIndent(node)" @click="indent(node)" />
                  <v-list-item prepend-icon="mdi-format-indent-decrease" title="减少层级" :disabled="operationPending || !node.parentId" @click="outdent(node)" />
                  <v-divider />
                  <v-list-item prepend-icon="mdi-pencil-outline" title="重命名" @click="openRename(node)" />
                  <v-list-item v-if="node.pageId && pageById.get(node.pageId)" prepend-icon="mdi-content-copy" title="复制文档" @click="openCopy(node, pageById.get(node.pageId)!)" />
                  <v-divider />
                  <v-list-item prepend-icon="mdi-link-variant-off" title="移出目录" base-color="error" @click="askForConfirmation({ kind: 'REMOVE', node })" />
                  <v-list-item v-if="node.pageId && pageById.get(node.pageId)" prepend-icon="mdi-trash-can-outline" title="删除文档" base-color="error" @click="askForConfirmation({ kind: 'TRASH', page: pageById.get(node.pageId)! })" />
                </v-list>
              </v-menu>
            </div>
          </div>
        </div>
        <div v-else-if="!loading && error && !tree" class="catalog-empty catalog-load-error"><v-icon size="30">mdi-alert-circle-outline</v-icon><strong>目录加载失败</strong><span>请检查网络后重新加载</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadCatalog(true)">重新加载</v-btn></div>
        <div v-else-if="!loading" class="catalog-empty"><v-icon size="30">mdi-text-box-search-outline</v-icon><strong>目录为空</strong><span>{{ readonly ? '这里暂时没有目录内容' : '从右上角新建分组、外链或挂载文档' }}</span></div>
        <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ announcement }}</div>
      </main>

      <aside v-if="showHistory" class="catalog-history">
        <header><strong>目录历史</strong><span>{{ revisions.length }}{{ historyHasMore ? '+' : '' }}</span></header>
        <v-progress-linear v-if="historyLoading" indeterminate color="primary" height="2" />
        <v-alert v-if="historyError" type="error" variant="tonal" density="compact" class="history-error">{{ historyError }}</v-alert>
        <div v-if="revisions.length" class="history-list">
          <div v-for="revision in revisions" :key="revision.id" class="history-row">
            <span class="revision-number">v{{ revision.revisionNo }}</span>
            <div><strong>{{ operationLabel(revision.operation) }}</strong><small>{{ formatTime(revision.createdAt) }}</small></div>
            <v-btn v-if="!readonly" class="history-action" icon="mdi-backup-restore" size="x-small" variant="text" :disabled="operationPending || revision.revisionNo === tree?.revision" :aria-label="`恢复到目录版本 ${revision.revisionNo}`" @click="askForConfirmation({ kind: 'RESTORE', revision })" />
          </div>
        </div>
        <div v-else-if="!historyLoading && !historyError" class="history-empty">暂无目录变更</div>
        <v-btn v-if="historyHasMore" block variant="text" size="small" :loading="historyLoadingMore" @click="loadHistory(false)">加载更多</v-btn>
      </aside>
    </div>

    <v-dialog v-model="renameOpen" max-width="480" :persistent="operationPending">
      <v-card class="catalog-dialog"><v-card-title>重命名目录项</v-card-title><v-card-text><v-text-field v-model="renameTitle" label="新标题" density="compact" variant="outlined" maxlength="500" autofocus @keydown.enter.prevent="saveRename" /></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" size="small" :disabled="operationPending" @click="renameOpen = false">取消</v-btn><v-btn color="primary" size="small" :loading="operationPending" :disabled="!renameTitle.trim()" @click="saveRename">保存</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog v-model="copyOpen" max-width="520" :persistent="copyPending">
      <v-card class="catalog-dialog"><v-card-title>复制文档</v-card-title><v-card-text><p class="dialog-description">副本会创建在当前知识库并挂在原文档之后；发布和分享设置不会复制。</p><v-text-field v-model="copyTitle" label="副本标题" density="compact" variant="outlined" maxlength="500" /><v-text-field v-model="copyPathValue" label="访问路径" density="compact" variant="outlined" prefix="/" maxlength="180" @blur="copyPathValue = sanitizePath(copyPathValue)" /><v-alert v-if="copyError" type="error" density="compact" variant="tonal">{{ copyError }}</v-alert></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" size="small" :disabled="copyPending" @click="copyOpen = false">取消</v-btn><v-btn color="primary" size="small" :loading="copyPending" :disabled="!copyTitle.trim() || !sanitizePath(copyPathValue)" @click="copyPage">创建副本</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(confirmation)" max-width="480" :persistent="confirmationPending" @update:model-value="value => { if (!value && !confirmationPending) confirmation = null }">
      <v-card class="catalog-dialog"><v-card-title>{{ confirmationTitle }}</v-card-title><v-card-text><p class="confirmation-copy">{{ confirmationDescription }}</p><v-alert v-if="confirmationError" type="error" density="compact" variant="tonal">{{ confirmationError }}</v-alert></v-card-text><v-card-actions><v-spacer /><v-btn variant="text" size="small" :disabled="confirmationPending" @click="confirmation = null">取消</v-btn><v-btn :color="confirmation?.kind === 'RESTORE' ? 'primary' : 'error'" size="small" :loading="confirmationPending" @click="runConfirmedAction">确认</v-btn></v-card-actions></v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.catalog-panel { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 6px; background: #fff; color: #262626; }
.catalog-header { display: flex; height: 48px; align-items: center; gap: 6px; border-bottom: 1px solid #eef0ef; padding: 0 10px 0 14px; }
.catalog-title { display: flex; min-width: 0; flex: 1; align-items: baseline; gap: 8px; }
.catalog-title strong { font-size: 14px; font-weight: 650; }
.catalog-title span, .saving-indicator { color: #8a8f8d; font-size: 12px; }
.saving-indicator { display: inline-flex; align-items: center; gap: 5px; }
.catalog-notices { display: grid; gap: 6px; padding: 8px 10px 0; }
.create-panel { display: grid; grid-template-columns: repeat(2, minmax(150px, 1fr)); gap: 10px; border-bottom: 1px solid #eef0ef; padding: 12px 14px 14px; background: #fafbfa; }
.create-panel-title, .create-actions { display: flex; grid-column: 1 / -1; min-width: 0; align-items: center; gap: 6px; }
.create-panel-title strong { font-size: 13px; font-weight: 650; }
.create-error { color: rgb(var(--v-theme-error)); font-size: 12px; }
.batch-toolbar { display: flex; min-height: 40px; align-items: center; gap: 5px; border-bottom: 1px solid #eef0ef; padding: 3px 10px; color: #737876; font-size: 12px; }
.batch-toolbar.active { background: #f3f7ff; color: #2f6feb; }
.batch-toolbar .v-select { max-width: 220px; margin-left: auto; }
.catalog-layout { display: grid; min-height: 320px; grid-template-columns: minmax(0, 1fr) 248px; }
.catalog-layout.without-history { grid-template-columns: 1fr; }
.catalog-tree-wrap { min-width: 0; padding: 7px 8px 12px; }
.catalog-tree { display: grid; }
.catalog-node { display: flex; height: 36px; min-height: 36px !important; align-items: center; gap: 4px; padding: 1px 4px 1px calc(4px + var(--catalog-depth) * 24px) !important; border-radius: 4px; outline: 0; transition: background .12s ease, opacity .12s ease; }
.catalog-node:hover, .catalog-node:focus-visible, .catalog-node:focus-within { background: #f2f3f2; }
.catalog-node.selected { background: #edf3ff; color: #2f6feb; }
.catalog-node.dragging { opacity: .42; }
.row-select { width: 20px; min-width: 20px; opacity: 1; transition: opacity .12s; }
.row-select :deep(.v-selection-control) { min-height: 28px; }
.row-select :deep(.v-selection-control__input) { width: 20px; height: 28px; }
.row-select :deep(.v-icon) { font-size: 16px; }
.catalog-node:hover .row-select, .catalog-node:focus-within .row-select, .catalog-node.selected .row-select { opacity: 1; }
.drag-handle { width: 14px; min-width: 14px; color: #b4b7b6; cursor: grab; opacity: 1; transition: opacity .12s; }
.catalog-node:hover .drag-handle, .catalog-node:focus-within .drag-handle { opacity: 1; }
.collapse-button { display: grid; width: 20px; height: 28px; flex: 0 0 20px; place-items: center; border: 0; border-radius: 4px; padding: 0; background: transparent; color: #757a78; cursor: pointer; }
.collapse-button:hover { background: #e6e8e7; }
.tree-spacer { width: 20px; flex: 0 0 20px; }
.node-icon { flex: 0 0 16px; color: #68706d; }
.catalog-node.group .node-icon { color: #858a88; }
.node-label { display: block; min-width: 0; flex: 1; overflow: hidden; border: 0; padding: 4px 2px; background: transparent; color: inherit; font: 13px/22px -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; text-align: left; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
.node-label span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-node.group .node-label { font-weight: 600; }
.node-label:disabled { color: #a9adab; cursor: default; }
.external-mark { flex: 0 0 13px; color: #a2a6a4; }
.node-actions, .history-action { opacity: 1; transition: opacity .12s; }
.catalog-node:hover .node-actions, .catalog-node:focus-within .node-actions, .history-row:hover .history-action, .history-row:focus-within .history-action { opacity: 1; }
.catalog-skeleton { display: grid; gap: 11px; padding: 12px 20px; }
.catalog-skeleton span { height: 12px; border-radius: 3px; background: linear-gradient(90deg,#f1f2f1,#fafafa,#f1f2f1); background-size: 220% 100%; animation: catalog-shimmer 1.3s linear infinite; }
@keyframes catalog-shimmer { to { background-position: -220% 0; } }
.catalog-history { border-left: 1px solid #eef0ef; background: #fafbfa; }
.catalog-history > header { display: flex; height: 40px; align-items: center; justify-content: space-between; border-bottom: 1px solid #eef0ef; padding: 0 10px 0 12px; }
.catalog-history > header strong { font-size: 13px; font-weight: 650; }
.catalog-history > header span { color: #979b99; font-size: 11px; }
.history-error { margin: 8px; }
.history-list { display: grid; padding: 4px 6px; }
.history-row { display: flex; min-height: 44px; align-items: center; gap: 8px; border-radius: 4px; padding: 4px 4px 4px 6px; }
.history-row:hover { background: #f0f2f1; }
.revision-number { width: 32px; color: #2f6feb; font: 600 11px/1.2 ui-monospace,SFMono-Regular,Consolas,monospace; }
.history-row > div { display: grid; min-width: 0; flex: 1; }
.history-row strong { overflow: hidden; font-size: 12px; font-weight: 550; text-overflow: ellipsis; white-space: nowrap; }
.history-row small { margin-top: 2px; color: #8a8f8d; font-size: 11px; }
.history-empty { padding: 38px 14px; color: #9ba09e; font-size: 12px; text-align: center; }
.catalog-empty { display: grid; min-height: 190px; place-items: center; align-content: center; gap: 5px; color: #9ba09e; text-align: center; }
.catalog-empty strong { color: #5d625f; font-size: 13px; }
.catalog-empty span { font-size: 12px; }
.catalog-load-error .v-icon { color: #d84b42; }
.catalog-dialog { border: 1px solid #e7e9e8; border-radius: 8px !important; box-shadow: 0 14px 40px rgba(0,0,0,.12) !important; }
.catalog-dialog :deep(.v-card-title) { padding: 18px 20px 8px; font-size: 16px; font-weight: 650; }
.catalog-dialog :deep(.v-card-text) { padding: 10px 20px 4px; color: #5d625f; font-size: 13px; }
.catalog-dialog :deep(.v-card-actions) { min-height: 56px; padding: 8px 14px 12px; }
.dialog-description, .confirmation-copy { margin: 0 0 14px; color: #747977; font-size: 13px; line-height: 1.55; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (hover: hover) and (pointer: fine) {
  .row-select, .drag-handle, .node-actions, .history-action { opacity: 0; }
}
@media (max-width: 1100px) {
  .catalog-layout { grid-template-columns: 1fr; }
  .catalog-history { border-top: 1px solid #eef0ef; border-left: 0; }
}
@media (max-width: 700px) {
  .create-panel { grid-template-columns: 1fr; }
  .create-panel > * { grid-column: 1; width: 100%; }
  .batch-toolbar { align-items: stretch; flex-wrap: wrap; }
  .batch-toolbar .v-select { flex-basis: 100%; max-width: none; margin-left: 0; }
  .catalog-node { padding-left: calc(2px + var(--catalog-depth) * 16px) !important; }
  .drag-handle, .row-select { opacity: 1; }
}
</style>
