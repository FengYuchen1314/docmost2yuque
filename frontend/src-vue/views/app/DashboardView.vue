<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Notification, QuickNote, WorkbenchItem, WorkbenchPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { publicationStatusLabel } from '../../utils/displayLabels'
import { createUuid } from '../../utils/uuid'
import {
  WORKBENCH_REASONS,
  contentTypePresentation,
  deduplicateWorkbenchItems,
  normalizeWorkbenchReason,
  quickNoteDocument,
  relativeTime,
} from '../../utils/workbench'

const session = useSessionStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()

const reason = ref<WorkbenchItem['reason']>(normalizeWorkbenchReason(route.query.filter))
const items = ref<WorkbenchItem[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const workbenchError = ref('')
const favoriteError = ref('')
const favoritePending = ref<Set<string>>(new Set())
const notifications = ref<Notification[]>([])
const notificationsLoading = ref(false)
const notificationsError = ref('')
const capture = ref('')
const captureExpanded = ref(false)
const captureEditor = ref<HTMLTextAreaElement | null>(null)
const saving = ref(false)
const captureError = ref('')
const capturedNote = ref<QuickNote | null>(null)
const undoing = ref(false)
const undoError = ref('')
let workbenchRequestVersion = 0
let capturedTimer: number | null = null

const greeting = computed(() => {
  const hour = new Date().getHours()
  return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
})
const displayName = computed(() => session.user?.displayName || session.user?.email?.split('@')[0] || '你好')
const displayCount = computed(() => `${items.value.length}${hasMore.value ? '+' : ''}`)
const activeTabTitle = computed(() => WORKBENCH_REASONS.find((item) => item.value === reason.value)?.title ?? '最近工作')
const emptyCopy = computed(() => ({
  EDITED: ['还没有编辑记录', '编辑过的文稿会出现在这里。'],
  VIEWED: ['还没有浏览记录', '打开文稿后，可以从这里快速继续。'],
  COLLABORATED: ['还没有协作记录', '参与评论或共同编辑后会出现在这里。'],
  FAVORITE: ['还没有收藏', '点击文稿右侧的星标即可收藏。'],
  CREATED: ['还没有创建内容', '创建第一篇文稿开始沉淀知识。'],
}[reason.value]))

onMounted(() => {
  void loadWorkbench(true)
  void loadNotifications()
})
onBeforeUnmount(() => { if (capturedTimer !== null) window.clearTimeout(capturedTimer) })

watch(reason, (value) => {
  const query = { ...route.query }
  if (value === 'EDITED') delete query.filter
  else query.filter = value
  if (normalizeWorkbenchReason(route.query.filter) !== value || (value === 'EDITED' && 'filter' in route.query)) void router.replace({ query })
  void loadWorkbench(true)
})
watch(() => route.query.filter, (value) => {
  const next = normalizeWorkbenchReason(value)
  if (next !== reason.value) reason.value = next
})

async function loadWorkbench(reset = false) {
  if (!reset && (loading.value || loadingMore.value || !hasMore.value)) return
  const requestVersion = reset ? ++workbenchRequestVersion : workbenchRequestVersion
  const requestedReason = reason.value
  const offset = reset ? 0 : nextOffset.value
  if (reset) {
    loading.value = true
    items.value = []
    hasMore.value = false
    nextOffset.value = 0
  } else loadingMore.value = true
  workbenchError.value = ''
  try {
    const page = await post<WorkbenchPage>('/api/v1/workbench/page', { reason: requestedReason, offset, limit: 25 })
    if (requestVersion !== workbenchRequestVersion || requestedReason !== reason.value) return
    items.value = reset ? page.items : deduplicateWorkbenchItems([...items.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (requestVersion === workbenchRequestVersion && requestedReason === reason.value) workbenchError.value = messageOf(value)
  } finally {
    if (requestVersion === workbenchRequestVersion && requestedReason === reason.value) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function loadNotifications() {
  notificationsLoading.value = true
  notificationsError.value = ''
  try { notifications.value = await post('/api/v1/notifications/list', { unreadOnly: true, limit: 5 }) }
  catch (value) { notificationsError.value = messageOf(value) }
  finally { notificationsLoading.value = false }
}

async function createNote() {
  const plainText = capture.value.trim()
  if (!plainText || !session.activeWorkspace?.id || saving.value) return
  saving.value = true
  captureError.value = ''
  try {
    const note = await post<QuickNote>('/api/v1/quick-notes/create', {
      workspaceId: session.activeWorkspace.id,
      content: quickNoteDocument(plainText),
      plainText,
      source: 'HOME',
      clientRequestId: createUuid(),
      tagIds: [],
    })
    capture.value = ''
    capturedNote.value = note
    undoError.value = ''
    if (capturedTimer !== null) window.clearTimeout(capturedTimer)
    const noteId = note.id
    const timer = window.setTimeout(() => {
      if (capturedNote.value?.id === noteId) capturedNote.value = null
      if (capturedTimer === timer) capturedTimer = null
    }, 5_000)
    capturedTimer = timer
  } catch (value) { captureError.value = `${messageOf(value)}，输入内容已保留。` }
  finally { saving.value = false }
}

async function undoCapture() {
  if (!capturedNote.value || undoing.value) return
  const note = capturedNote.value
  undoing.value = true
  undoError.value = ''
  try {
    await post('/api/v1/quick-notes/delete', { quickNoteId: note.id })
    if (capturedNote.value?.id === note.id) {
      capturedNote.value = null
      if (capturedTimer !== null) window.clearTimeout(capturedTimer)
      capturedTimer = null
    }
    ui.notify('已撤销刚才的小记')
  } catch (value) {
    if (capturedNote.value?.id === note.id) undoError.value = messageOf(value)
  }
  finally { undoing.value = false }
}

async function favorite(item: WorkbenchItem) {
  if (favoritePending.value.has(item.resourceId)) return
  favoriteError.value = ''
  const previous = item.favorite
  const next = !previous
  favoritePending.value = new Set(favoritePending.value).add(item.resourceId)
  item.favorite = next
  try {
    await post('/api/v1/favorites/set', { pageId: item.resourceId, favorite: next })
    if (reason.value === 'FAVORITE' && !next) {
      items.value = items.value.filter((value) => value.resourceId !== item.resourceId)
      nextOffset.value = Math.max(0, nextOffset.value - 1)
    }
  } catch (value) {
    item.favorite = previous
    favoriteError.value = messageOf(value)
  } finally {
    const pending = new Set(favoritePending.value)
    pending.delete(item.resourceId)
    favoritePending.value = pending
  }
}

async function openNotification(notification: Notification) {
  notificationsError.value = ''
  try {
    if (!notification.readAt) await post('/api/v1/notifications/read', { notificationId: notification.id })
    notifications.value = notifications.value.filter((item) => item.id !== notification.id)
    await router.push(notificationDestination(notification) ?? '/app/notifications')
  } catch (value) { notificationsError.value = messageOf(value) }
}

function openWorkbenchCreate() {
  const knowledgeBase = session.activeKnowledgeBases[0]
  if (!knowledgeBase) {
    ui.openCreate({ kind: 'KNOWLEDGE_BASE', workspaceId: session.activeWorkspace?.id, source: 'WORKBENCH' })
    return
  }
  ui.openCreate({ knowledgeBaseId: knowledgeBase.id, workspaceId: knowledgeBase.workspaceId, source: 'WORKBENCH' })
}

function openKnowledgeBaseCreate() {
  ui.openCreate({ kind: 'KNOWLEDGE_BASE', workspaceId: session.activeWorkspace?.id, source: 'WORKBENCH' })
}

function wrapCapture(before: string, after: string, placeholder: string) {
  const editor = captureEditor.value
  const start = editor?.selectionStart ?? capture.value.length
  const end = editor?.selectionEnd ?? start
  const selected = capture.value.slice(start, end) || placeholder
  capture.value = `${capture.value.slice(0, start)}${before}${selected}${after}${capture.value.slice(end)}`
  void nextTick(() => {
    captureEditor.value?.focus()
    captureEditor.value?.setSelectionRange(start + before.length, start + before.length + selected.length)
  })
}

function insertTask() {
  const editor = captureEditor.value
  const start = editor?.selectionStart ?? capture.value.length
  const prefix = start > 0 && capture.value[start - 1] !== '\n' ? '\n' : ''
  const text = '- [ ] 待办事项'
  capture.value = `${capture.value.slice(0, start)}${prefix}${text}${capture.value.slice(start)}`
  void nextTick(() => {
    captureEditor.value?.focus()
    captureEditor.value?.setSelectionRange(start + prefix.length + 6, start + prefix.length + text.length)
  })
}

function notificationLabel(type: string) {
  return ({
    COMMENT_MENTION: '在评论中提到了你', PAGE_MENTION: '在文稿中提到了你', INVITATION: '邀请你加入',
    APPROVAL: '审批结果有更新', PUBLICATION: '关注的内容已发布', SHARE_COMMENT: '分享文稿收到新评论',
    SHARE_APPROVAL_REQUEST: '有人申请访问分享', SHARE_APPROVAL_REVIEWED: '分享访问申请已有结果',
  } as Record<string, string>)[type] ?? '有一条新消息'
}

function notificationDestination(value: Notification) {
  if (value.type === 'PUBLICATION' && value.payload.publicationId) return `/p/${encodeURIComponent(value.payload.publicationId)}`
  if (value.resourceType !== 'PAGE' || value.type === 'SHARE_APPROVAL_REVIEWED') return null
  const suffix = value.type === 'SHARE_APPROVAL_REQUEST' ? '?manage=SHARE' : ''
  if (value.payload.knowledgeBaseId) return `/app/kb/${encodeURIComponent(value.payload.knowledgeBaseId)}/pages/${encodeURIComponent(value.resourceId)}${suffix}`
  return `/app/pages/${encodeURIComponent(value.resourceId)}${suffix}`
}

function notificationIcon(type: string) {
  if (type.includes('MENTION')) return 'mdi-at'
  if (type.includes('COMMENT')) return 'mdi-comment-text-outline'
  if (type.includes('APPROVAL')) return 'mdi-account-check-outline'
  if (type === 'INVITATION') return 'mdi-account-plus-outline'
  if (type === 'PUBLICATION') return 'mdi-publish'
  return 'mdi-bell-outline'
}
</script>

<template>
  <div class="page-shell workbench-page">
    <header class="page-heading workbench-heading">
      <div><h1>{{ greeting }}，{{ displayName }}</h1><p>继续最近工作；快速记录会保存到“{{ session.activeWorkspace?.name || '当前空间' }}”。</p></div>
      <v-btn color="primary" prepend-icon="mdi-plus" @click="openWorkbenchCreate">新建内容</v-btn>
    </header>

    <v-card class="section-card quick-capture mb-6 pa-4" :class="{ expanded: captureExpanded }">
      <div v-if="captureExpanded" class="capture-toolbar" aria-label="小记格式工具">
        <v-btn icon="mdi-format-bold" aria-label="加粗" variant="text" size="small" @click="wrapCapture('**', '**', '重点内容')" />
        <v-btn icon="mdi-format-italic" aria-label="斜体" variant="text" size="small" @click="wrapCapture('*', '*', '强调内容')" />
        <v-btn icon="mdi-checkbox-marked-outline" aria-label="插入任务" variant="text" size="small" @click="insertTask" />
        <v-btn icon="mdi-link-variant" aria-label="插入链接" variant="text" size="small" @click="wrapCapture('[', '](https://example.com)', '链接标题')" />
        <span>支持段落、任务、链接和图片语法</span>
      </div>
      <div class="capture-main">
        <v-avatar color="primary" variant="tonal" size="38"><v-icon>mdi-lightning-bolt-outline</v-icon></v-avatar>
        <textarea ref="captureEditor" v-model="capture" :rows="captureExpanded ? 5 : 1" aria-label="快速记录" placeholder="随手记下想法，按 Ctrl/⌘ + Enter 保存为小记…" @keydown.ctrl.enter.prevent="createNote" @keydown.meta.enter.prevent="createNote" />
        <v-btn :icon="captureExpanded ? 'mdi-arrow-collapse-vertical' : 'mdi-arrow-expand-vertical'" :aria-label="captureExpanded ? '收起快速记录' : '展开快速记录'" variant="text" size="small" @click="captureExpanded = !captureExpanded" />
        <v-btn color="primary" variant="tonal" :loading="saving" :disabled="!capture.trim() || !session.activeWorkspace" @click="createNote">记一笔</v-btn>
      </div>
    </v-card>
    <v-alert v-if="captureError" type="error" variant="tonal" closable class="mb-4" @click:close="captureError = ''">{{ captureError }}</v-alert>
    <v-alert v-if="capturedNote" type="success" variant="tonal" class="mb-4"><div class="capture-success"><span>{{ undoError ? `撤销失败：${undoError}` : '已记下，可在小记中继续整理。' }}</span><v-btn variant="text" size="small" :loading="undoing" @click="undoCapture">撤销</v-btn></div></v-alert>
    <v-alert v-if="favoriteError" type="error" variant="tonal" closable class="mb-4" @click:close="favoriteError = ''">收藏操作失败：{{ favoriteError }}</v-alert>

    <div class="workbench-grid mb-8">
      <v-card class="section-card recent-card">
        <v-card-title class="panel-title px-5 pt-5"><span>{{ activeTabTitle }}</span><v-spacer /><span class="text-caption text-medium-emphasis">{{ displayCount }} 项</span></v-card-title>
        <v-tabs v-model="reason" color="primary" class="px-3" show-arrows><v-tab v-for="tab in WORKBENCH_REASONS" :key="tab.value" :value="tab.value">{{ tab.title }}</v-tab></v-tabs>
        <v-divider />
        <v-progress-linear v-if="loading" indeterminate color="primary" />
        <v-alert v-if="workbenchError" type="error" variant="tonal" class="ma-4"><div class="retry-row"><span>{{ workbenchError }}</span><v-btn size="small" variant="text" @click="loadWorkbench(true)">重试</v-btn></div></v-alert>
        <div v-if="items.length" class="workbench-list">
          <div v-for="item in items" :key="item.resourceId" class="workbench-row">
            <router-link class="workbench-link" :to="`/app/kb/${item.knowledgeBaseId}/pages/${item.resourceId}`">
              <v-avatar :color="contentTypePresentation(item.contentType).color" variant="tonal" rounded="lg" size="38"><v-icon size="20">{{ contentTypePresentation(item.contentType).icon }}</v-icon></v-avatar>
              <div class="workbench-copy"><strong>{{ item.title || `无标题${contentTypePresentation(item.contentType).label}` }}</strong><p>{{ item.knowledgeBaseName }} / {{ item.path }}</p><footer><v-chip size="x-small" variant="tonal">{{ publicationStatusLabel(item.publicationStatus) }}</v-chip><span>{{ contentTypePresentation(item.contentType).label }} · {{ relativeTime(item.activityAt) }}</span><span v-if="item.collaborators.length" class="collaborators" :aria-label="`协作者：${item.collaborators.map(person => person.displayName || person.email).join('、')}`"><v-avatar v-for="person in item.collaborators.slice(0, 3)" :key="person.userId" size="22" color="secondary">{{ (person.displayName || person.email).slice(0, 1).toUpperCase() }}</v-avatar></span></footer></div>
            </router-link>
            <v-btn :icon="item.favorite ? 'mdi-star' : 'mdi-star-outline'" :color="item.favorite ? 'warning' : undefined" :aria-label="item.favorite ? `取消收藏 ${item.title}` : `收藏 ${item.title}`" variant="text" :loading="favoritePending.has(item.resourceId)" @click="favorite(item)" />
          </div>
        </div>
        <div v-else-if="!loading && !workbenchError" class="empty-state compact"><div><v-icon size="42">mdi-file-clock-outline</v-icon><h3>{{ emptyCopy[0] }}</h3><p>{{ emptyCopy[1] }}</p><v-btn v-if="reason === 'CREATED'" color="primary" variant="tonal" @click="openWorkbenchCreate">新建内容</v-btn></div></div>
        <div v-if="hasMore" class="load-more"><v-btn variant="outlined" :loading="loadingMore" @click="loadWorkbench(false)">加载更多</v-btn></div>
      </v-card>

      <v-card class="section-card notifications-card">
        <v-card-title class="panel-title px-5 pt-5"><span>待处理消息</span><v-spacer /><v-btn to="/app/notifications" variant="text" size="small">查看全部</v-btn></v-card-title>
        <v-progress-linear v-if="notificationsLoading" indeterminate color="primary" />
        <v-alert v-if="notificationsError" type="error" variant="tonal" class="ma-4"><div class="retry-row"><span>{{ notificationsError }}</span><v-btn size="small" variant="text" @click="loadNotifications">重试</v-btn></div></v-alert>
        <div v-if="notifications.length" class="notification-list">
          <button v-for="note in notifications" :key="note.id" type="button" class="notification-row" @click="openNotification(note)"><v-avatar color="primary" variant="tonal" size="36"><v-icon size="19">{{ notificationIcon(note.type) }}</v-icon></v-avatar><span><strong>{{ notificationLabel(note.type) }}<small v-if="note.occurrenceCount > 1"> · {{ note.occurrenceCount }} 次</small></strong><p>{{ note.payload.preview || note.payload.title || '有新的协作动态' }}</p><time>{{ relativeTime(note.updatedAt) }}</time></span><v-icon size="18">mdi-chevron-right</v-icon></button>
        </div>
        <div v-else-if="!notificationsLoading && !notificationsError" class="empty-state compact"><div><v-icon size="40">mdi-bell-sleep-outline</v-icon><h3>没有新消息</h3><p>提及、评论和审批会出现在这里。</p></div></div>
      </v-card>
    </div>

    <section class="mb-8">
      <div class="section-heading"><div><h2>知识库</h2><p>{{ session.activeWorkspace?.name || '当前空间' }}中的知识内容</p></div><div><v-btn v-if="session.activeWorkspace" :to="`/app/w/${session.activeWorkspace.id}`" variant="text">查看全部</v-btn><v-btn variant="text" prepend-icon="mdi-plus" @click="openKnowledgeBaseCreate">新建</v-btn></div></div>
      <div v-if="session.activeKnowledgeBases.length" class="knowledge-base-grid"><v-card v-for="kb in session.activeKnowledgeBases" :key="kb.id" :to="`/app/kb/${kb.id}`" class="section-card kb-card pa-5"><div class="d-flex align-center"><v-avatar color="primary" variant="tonal" rounded="lg" class="mr-4">{{ kb.icon || '📘' }}</v-avatar><div class="kb-copy"><strong>{{ kb.name }}</strong><p>{{ kb.description || (kb.ownerType === 'PERSONAL' ? '个人知识库' : '空间知识库') }}</p></div><v-spacer /><v-icon>mdi-chevron-right</v-icon></div></v-card></div>
      <v-card v-else class="section-card empty-state compact"><div><v-icon size="42">mdi-book-plus-outline</v-icon><h3>还没有知识库</h3><p>先创建知识库，再开始添加文档和结构化内容。</p><v-btn color="primary" @click="openKnowledgeBaseCreate">新建知识库</v-btn></div></v-card>
    </section>

    <section>
      <div class="section-heading"><div><h2>我的空间</h2><p>在个人与组织空间之间切换</p></div></div>
      <div class="workspace-grid"><v-card v-for="workspace in session.workspaces" :key="workspace.id" :to="`/app/w/${workspace.id}`" class="section-card workspace-card pa-4"><v-avatar color="secondary" variant="tonal" rounded="lg" class="mr-3">{{ workspace.name.slice(0, 1) }}</v-avatar><div><strong>{{ workspace.name }}</strong><p>{{ workspace.workspaceType === 'PERSONAL' ? '个人空间' : '组织空间' }}</p></div><v-spacer /><v-icon>mdi-chevron-right</v-icon></v-card></div>
    </section>
  </div>
</template>

<style scoped>
.workbench-page { max-width: 1320px; }
.workbench-grid { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); gap: 16px; align-items: start; }
.panel-title, .capture-success, .retry-row, .section-heading, .workspace-card { display: flex; align-items: center; }
.quick-capture { overflow: hidden; }
.capture-main { display: flex; align-items: flex-start; gap: 12px; }
.capture-main textarea { flex: 1; min-width: 0; border: 0; outline: 0; resize: none; padding: 8px 2px; color: rgb(var(--v-theme-on-surface)); background: transparent; font: inherit; line-height: 1.65; }
.capture-toolbar { display: flex; align-items: center; gap: 2px; margin: -4px 0 8px 48px; color: rgba(var(--v-theme-on-surface), .56); }
.capture-toolbar span { margin-left: 8px; font-size: 12px; }
.capture-success, .retry-row { justify-content: space-between; gap: 12px; width: 100%; }
.recent-card, .notifications-card { overflow: hidden; }
.workbench-list { padding: 8px 12px 12px; }
.workbench-row { display: flex; align-items: center; border-radius: 12px; transition: background .15s ease; }
.workbench-row:hover, .workbench-row:focus-within { background: rgba(var(--v-theme-primary), .045); }
.workbench-link { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; padding: 12px; color: inherit; text-decoration: none; }
.workbench-copy { min-width: 0; }
.workbench-copy strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workbench-copy p, .kb-copy p, .workspace-card p, .notification-row p { margin: 3px 0 0; color: rgba(var(--v-theme-on-surface), .58); font-size: 13px; }
.workbench-copy footer { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; margin-top: 7px; color: rgba(var(--v-theme-on-surface), .58); font-size: 12px; }
.collaborators { display: flex; }
.collaborators :deep(.v-avatar + .v-avatar) { margin-left: -6px; border: 2px solid rgb(var(--v-theme-surface)); }
.load-more { display: flex; justify-content: center; padding: 4px 16px 20px; }
.notification-list { padding: 8px 12px 16px; }
.notification-row { width: 100%; display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 10px; padding: 11px; border: 0; border-radius: 12px; color: inherit; background: transparent; text-align: left; cursor: pointer; }
.notification-row:hover, .notification-row:focus-visible { background: rgba(var(--v-theme-primary), .045); outline: none; }
.notification-row strong { display: block; font-size: 14px; }
.notification-row strong small { font-weight: 500; }
.notification-row p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.notification-row time { color: rgba(var(--v-theme-on-surface), .46); font-size: 12px; }
.empty-state.compact { min-height: 210px; padding: 28px; }
.section-heading { justify-content: space-between; gap: 16px; margin-bottom: 14px; }
.section-heading h2 { margin: 0; font-size: 19px; }
.section-heading p { margin: 4px 0 0; color: rgba(var(--v-theme-on-surface), .56); font-size: 13px; }
.knowledge-base-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; }
.kb-card { color: inherit; text-decoration: none; }
.kb-copy { min-width: 0; }
.kb-copy p { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.workspace-card { color: inherit; text-decoration: none; }
.workspace-card p { margin-bottom: 0; }
@media (max-width: 1050px) {
  .workbench-grid { grid-template-columns: 1fr; }
  .workspace-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 700px) {
  .workbench-heading, .section-heading { align-items: flex-start; flex-direction: column; }
  .capture-main { flex-wrap: wrap; }
  .capture-main textarea { flex-basis: calc(100% - 52px); }
  .capture-toolbar { margin-left: 0; overflow-x: auto; }
  .capture-toolbar span { display: none; }
  .knowledge-base-grid, .workspace-grid { grid-template-columns: 1fr; }
  .workbench-copy footer .v-chip { display: none; }
}
</style>
