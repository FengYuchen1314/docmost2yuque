<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Page, WorkbenchItem, WorkbenchPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import type { ResourceKind } from '../../utils/createResource'
import { knowledgeBaseDestination } from '../../utils/knowledgeBaseDestination'
import { contentTypePresentation, deduplicateWorkbenchItems } from '../../utils/workbench'

type DashboardReason = Extract<WorkbenchItem['reason'], 'EDITED' | 'VIEWED' | 'FAVORITE' | 'COLLABORATED'>
type ContentFilter = 'ALL' | Page['contentType']

const DASHBOARD_REASONS: Array<{ title: string; value: DashboardReason }> = [
  { title: '编辑过', value: 'EDITED' },
  { title: '浏览过', value: 'VIEWED' },
  { title: '我收藏的', value: 'FAVORITE' },
  { title: '我评论过', value: 'COLLABORATED' },
]
const CONTENT_FILTERS: Array<{ title: string; value: ContentFilter }> = [
  { title: '所有', value: 'ALL' },
  { title: '文档', value: 'DOCUMENT' },
  { title: '表格', value: 'SPREADSHEET' },
  { title: '画板', value: 'WHITEBOARD' },
  { title: '数据表', value: 'DATABASE' },
]
const DOCUMENT_KINDS: Array<{ title: string; icon: string; kind?: ResourceKind; to?: string }> = [
  { title: '新建文档', icon: 'mdi-file-document-outline', kind: 'DOCUMENT' },
  { title: '新建表格', icon: 'mdi-table-large', kind: 'SPREADSHEET' },
  { title: '新建画板', icon: 'mdi-drawing-box', kind: 'WHITEBOARD' },
  { title: '新建数据表', icon: 'mdi-database-outline', kind: 'DATABASE' },
  { title: '导入...', icon: 'mdi-import', to: '/app/transfers' },
]

const session = useSessionStore()
const ui = useUiStore()
const route = useRoute()
const router = useRouter()
const reason = ref<DashboardReason>(dashboardReason(route.query.filter))
const items = ref<WorkbenchItem[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const workbenchError = ref('')
const favoriteError = ref('')
const favoritePending = ref<Set<string>>(new Set())
const contentFilter = ref<ContentFilter>('ALL')
const ownerFilter = ref('ALL')
const creatorFilter = ref('ALL')
const createdResourceIds = ref<Set<string> | null>(null)
const creatorLoading = ref(false)
const creatorError = ref('')
const loadMoreSentinel = ref<HTMLElement | null>(null)
const autoLoadSupported = ref(true)
let workbenchRequestVersion = 0
let creatorRequestVersion = 0
let loadMoreObserver: IntersectionObserver | null = null

const ownerOptions = computed(() => [
  { title: '所有', value: 'ALL' },
  ...session.workspaces.map((workspace) => ({ title: workspace.name, value: workspace.id })),
])
const workspaceById = computed(() => new Map(session.workspaces.map((workspace) => [workspace.id, workspace])))
const knowledgeBaseById = computed(() => new Map(session.knowledgeBases.map((knowledgeBase) => [knowledgeBase.id, knowledgeBase])))
const creatorOptions = [
  { title: '所有', value: 'ALL' },
  { title: '我创建的', value: 'ME' },
]
const visibleItems = computed(() => items.value.filter((item) => {
  if (contentFilter.value !== 'ALL' && item.contentType !== contentFilter.value) return false
  if (ownerFilter.value !== 'ALL' && item.workspaceId !== ownerFilter.value) return false
  if (creatorFilter.value === 'ME' && !createdResourceIds.value?.has(item.resourceId)) return false
  return true
}))
const emptyLabel = computed(() => ({
  EDITED: '还没有编辑过的文档',
  VIEWED: '还没有浏览过的文档',
  FAVORITE: '还没有收藏的文档',
  COLLABORATED: '还没有评论过的文档',
})[reason.value])

onMounted(() => {
  setupLoadMoreObserver()
  void loadWorkbench(true)
})

onBeforeUnmount(() => {
  loadMoreObserver?.disconnect()
  loadMoreObserver = null
})

watch(reason, (value) => {
  const query = { ...route.query }
  if (value === 'EDITED') delete query.filter
  else query.filter = value
  if (dashboardReason(route.query.filter) !== value || (value === 'EDITED' && 'filter' in route.query)) {
    void router.replace({ path: route.path, query })
  }
  void loadWorkbench(true)
})
watch(() => route.query.filter, (value) => {
  const next = dashboardReason(value)
  if (next !== reason.value) reason.value = next
})
watch(creatorFilter, (value) => {
  if (value === 'ME' && createdResourceIds.value === null) void loadCreatedResourceIds()
})
watch(loadMoreSentinel, (target, previousTarget) => {
  if (!loadMoreObserver) return
  if (previousTarget) loadMoreObserver.unobserve(previousTarget)
  if (target) loadMoreObserver.observe(target)
})

function setupLoadMoreObserver() {
  if (typeof IntersectionObserver !== 'function') {
    autoLoadSupported.value = false
    return
  }
  loadMoreObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) void loadWorkbench(false)
  }, { rootMargin: '160px 0px' })
}

function rearmLoadMoreObserver() {
  if (!loadMoreObserver || !hasMore.value) return
  void nextTick(() => {
    const target = loadMoreSentinel.value
    if (!target || !loadMoreObserver) return
    loadMoreObserver.unobserve(target)
    loadMoreObserver.observe(target)
  })
}

function dashboardReason(value: unknown): DashboardReason {
  return DASHBOARD_REASONS.some((item) => item.value === value) ? value as DashboardReason : 'EDITED'
}

async function loadWorkbench(reset = false) {
  if (!reset && (loading.value || loadingMore.value || !hasMore.value)) return
  const requestVersion = reset ? ++workbenchRequestVersion : workbenchRequestVersion
  const requestedReason = reason.value
  const offset = reset ? 0 : nextOffset.value
  if (reset) {
    loading.value = true
    items.value = []
    nextOffset.value = 0
    hasMore.value = false
  } else {
    loadingMore.value = true
  }
  workbenchError.value = ''
  try {
    const page = await post<WorkbenchPage>('/api/v1/workbench/page', { reason: requestedReason, offset, limit: 25 })
    if (requestVersion !== workbenchRequestVersion || requestedReason !== reason.value) return
    items.value = reset ? page.items : deduplicateWorkbenchItems([...items.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
    rearmLoadMoreObserver()
  } catch (value) {
    if (requestVersion === workbenchRequestVersion && requestedReason === reason.value) {
      workbenchError.value = messageOf(value)
    }
  } finally {
    if (requestVersion === workbenchRequestVersion && requestedReason === reason.value) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function loadCreatedResourceIds() {
  const requestVersion = ++creatorRequestVersion
  creatorLoading.value = true
  creatorError.value = ''
  try {
    const ids = new Set<string>()
    let offset = 0
    let more = true
    while (more) {
      const page = await post<WorkbenchPage>('/api/v1/workbench/page', { reason: 'CREATED', offset, limit: 100 })
      if (requestVersion !== creatorRequestVersion) return
      for (const item of page.items) ids.add(item.resourceId)
      offset = page.nextOffset
      more = page.hasMore
    }
    createdResourceIds.value = ids
  } catch (value) {
    if (requestVersion === creatorRequestVersion) creatorError.value = messageOf(value)
  } finally {
    if (requestVersion === creatorRequestVersion) creatorLoading.value = false
  }
}

function createPage(kind: ResourceKind = 'DOCUMENT') {
  ui.openCreate({
    kind,
    workspaceId: session.activeWorkspace?.id,
    knowledgeBaseId: session.activeKnowledgeBases[0]?.id,
    source: 'WORKBENCH',
  })
}

function createKnowledgeBase() {
  ui.openCreate({ kind: 'KNOWLEDGE_BASE', workspaceId: session.activeWorkspace?.id, source: 'WORKBENCH' })
}

async function chooseDocumentAction(action: typeof DOCUMENT_KINDS[number]) {
  if (action.to) await router.push(action.to)
  else if (action.kind) createPage(action.kind)
}

async function favorite(item: WorkbenchItem) {
  if (favoritePending.value.has(item.resourceId)) return
  const previous = item.favorite
  const next = !previous
  favoriteError.value = ''
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

function resourceDestination(item: WorkbenchItem) {
  return `/app/kb/${encodeURIComponent(item.knowledgeBaseId)}/pages/${encodeURIComponent(item.resourceId)}`
}

function workspaceDestination(workspaceId: string) {
  return `/app/w/${encodeURIComponent(workspaceId)}`
}

function workbenchKnowledgeBaseDestination(item: WorkbenchItem) {
  return knowledgeBaseDestination(knowledgeBaseById.value.get(item.knowledgeBaseId) ?? {
    id: item.knowledgeBaseId,
    homepagePageId: null,
  })
}

function workspaceName(workspaceId: string) {
  return workspaceById.value.get(workspaceId)?.name ?? '未知空间'
}

function collaboratorName(person: WorkbenchItem['collaborators'][number]) {
  return person.displayName || person.email
}

function collaboratorInitial(person: WorkbenchItem['collaborators'][number]) {
  return collaboratorName(person).trim().slice(0, 1).toUpperCase() || 'U'
}

function contentLabel(type: Page['contentType']) {
  return type === 'SPREADSHEET' ? '表格' : type === 'WHITEBOARD' ? '画板' : contentTypePresentation(type).label
}

function activityTime(value: string) {
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  const pad = (part: number) => String(part).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
</script>

<template>
  <main class="page-shell workbench-page">
    <div class="workbench-content">
      <h1>开始</h1>

      <nav class="quick-actions" aria-label="快捷创建">
        <v-menu location="bottom start" :close-on-content-click="true">
          <template #activator="{ props }">
            <button v-bind="props" type="button" class="quick-action" data-testid="create-document">
              <span class="quick-icon quick-icon-document"><v-icon size="21">mdi-file-document-outline</v-icon></span>
              <span class="quick-copy"><strong>新建文档</strong><small>文档、表格、画板、数据表</small></span>
              <v-icon class="quick-chevron" size="16">mdi-chevron-down</v-icon>
            </button>
          </template>
          <v-list class="create-menu" density="compact" min-width="188">
            <v-list-item v-for="action in DOCUMENT_KINDS" :key="action.title" :prepend-icon="action.icon" :title="action.title" @click="chooseDocumentAction(action)" />
          </v-list>
        </v-menu>
        <button type="button" class="quick-action" data-testid="create-knowledge-base" @click="createKnowledgeBase">
          <span class="quick-icon quick-icon-knowledge"><v-icon size="21">mdi-book-open-page-variant-outline</v-icon></span>
          <span class="quick-copy"><strong>新建知识库</strong><small>使用知识库整理知识</small></span>
        </button>
        <router-link class="quick-action" to="/app/templates">
          <span class="quick-icon quick-icon-template"><v-icon size="21">mdi-view-grid-outline</v-icon></span>
          <span class="quick-copy"><strong>模板中心</strong><small>从模板中获取灵感</small></span>
        </router-link>
        <router-link to="/app/ai" class="quick-action" data-testid="ai-write">
          <span class="quick-icon quick-icon-ai"><v-icon size="21">mdi-creation-outline</v-icon></span>
          <span class="quick-copy"><strong>AI 帮你写</strong><small>AI 助手帮你一键生成文档</small></span>
        </router-link>
      </nav>

      <section class="documents-section" aria-labelledby="documents-title">
        <h2 id="documents-title">文档</h2>
        <div class="documents-toolbar">
          <div class="document-tabs" role="tablist" aria-label="文档动态筛选">
            <button v-for="tab in DASHBOARD_REASONS" :key="tab.value" type="button" role="tab" :aria-selected="reason === tab.value" :class="{ active: reason === tab.value }" @click="reason = tab.value">{{ tab.title }}</button>
          </div>

          <div class="document-filters" aria-label="文档筛选">
            <v-menu location="bottom end">
              <template #activator="{ props }"><button v-bind="props" type="button" class="filter-button">类型<v-icon size="15">mdi-chevron-down</v-icon></button></template>
              <v-list density="compact" min-width="160">
                <v-list-item v-for="option in CONTENT_FILTERS" :key="option.value" :title="option.title" @click="contentFilter = option.value"><template #append><v-icon v-if="contentFilter === option.value" size="17">mdi-check</v-icon></template></v-list-item>
              </v-list>
            </v-menu>
            <v-menu location="bottom end">
              <template #activator="{ props }"><button v-bind="props" type="button" class="filter-button">归属<v-icon size="15">mdi-chevron-down</v-icon></button></template>
              <v-list density="compact" min-width="180">
                <v-list-item v-for="option in ownerOptions" :key="option.value" :title="option.title" @click="ownerFilter = option.value"><template #append><v-icon v-if="ownerFilter === option.value" size="17">mdi-check</v-icon></template></v-list-item>
              </v-list>
            </v-menu>
            <v-menu location="bottom end">
              <template #activator="{ props }"><button v-bind="props" type="button" class="filter-button">创建者<v-icon size="15">mdi-chevron-down</v-icon></button></template>
              <v-list density="compact" min-width="180">
                <v-list-item v-for="option in creatorOptions" :key="option.value" :title="option.title" @click="creatorFilter = option.value"><template #append><v-icon v-if="creatorFilter === option.value" size="17">mdi-check</v-icon></template></v-list-item>
              </v-list>
            </v-menu>
          </div>
        </div>

        <div v-if="workbenchError" class="inline-error" role="alert"><span>文档加载失败：{{ workbenchError }}</span><button type="button" @click="loadWorkbench(true)">重试</button></div>
        <div v-if="favoriteError" class="inline-error" role="alert"><span>收藏操作失败：{{ favoriteError }}</span><button type="button" @click="favoriteError = ''">关闭</button></div>
        <div v-if="creatorError" class="inline-error" role="alert"><span>创建者筛选加载失败：{{ creatorError }}</span><button type="button" @click="loadCreatedResourceIds">重试</button></div>

        <table class="document-list" aria-labelledby="documents-title" :aria-busy="loading || creatorLoading">
          <colgroup>
            <col style="width: 46.2%">
            <col style="width: 32%">
            <col style="width: 17%">
            <col style="width: 4.8%">
          </colgroup>
          <tbody v-if="loading || creatorLoading">
            <tr v-for="index in 4" :key="index" class="document-row skeleton-row" aria-hidden="true">
              <td><span class="skeleton title-skeleton" /></td>
              <td><span class="skeleton owner-skeleton" /></td>
              <td><span class="skeleton time-skeleton" /></td>
              <td><span class="skeleton action-skeleton" /></td>
            </tr>
          </tbody>
          <tbody v-else>
            <tr v-for="item in visibleItems" :key="item.resourceId" class="document-row">
              <td>
                <router-link class="document-primary" :to="resourceDestination(item)">
                  <span class="resource-icon" :class="`type-${item.contentType.toLowerCase()}`"><v-icon size="19">{{ contentTypePresentation(item.contentType).icon }}</v-icon></span>
                  <span class="document-title">
                    <strong>{{ item.title || `无标题${contentLabel(item.contentType)}` }}</strong>
                    <span
                      v-if="item.collaborators.length"
                      class="document-collaborators"
                      role="img"
                      :aria-label="`协作者：${item.collaborators.map(collaboratorName).join('、')}`"
                    >
                      <v-avatar
                        v-for="person in item.collaborators.slice(0, 3)"
                        :key="person.userId"
                        class="collaborator-avatar"
                        color="#eef0f3"
                        size="22"
                        aria-hidden="true"
                      >{{ collaboratorInitial(person) }}</v-avatar>
                      <span v-if="item.collaborators.length > 3" class="collaborator-overflow" aria-hidden="true">+{{ item.collaborators.length - 3 }}</span>
                    </span>
                  </span>
                </router-link>
              </td>
              <td class="document-owner" :title="`${workspaceName(item.workspaceId)} / ${item.knowledgeBaseName}`">
                <router-link v-if="workspaceById.has(item.workspaceId)" :to="workspaceDestination(item.workspaceId)">{{ workspaceName(item.workspaceId) }}</router-link><span v-else>{{ workspaceName(item.workspaceId) }}</span><span> / </span><router-link :to="workbenchKnowledgeBaseDestination(item)">{{ item.knowledgeBaseName }}</router-link>
              </td>
              <td class="document-time"><time :datetime="item.activityAt">{{ activityTime(item.activityAt) }}</time></td>
              <td class="document-actions">
                <v-menu location="bottom end">
                  <template #activator="{ props }">
                    <button v-bind="props" type="button" class="more-button" :aria-label="`${item.title || '无标题文档'}的更多操作`"><v-progress-circular v-if="favoritePending.has(item.resourceId)" indeterminate size="16" width="2" /><v-icon v-else size="19">mdi-dots-horizontal</v-icon></button>
                  </template>
                  <v-list density="compact" min-width="168">
                    <v-list-item prepend-icon="mdi-open-in-new" title="打开" @click="router.push(resourceDestination(item))" />
                    <v-list-item :prepend-icon="item.favorite ? 'mdi-star' : 'mdi-star-outline'" :title="item.favorite ? '取消收藏' : '收藏'" @click="favorite(item)" />
                  </v-list>
                </v-menu>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-if="!loading && !creatorLoading && !workbenchError && !visibleItems.length" class="document-empty"><v-icon size="34">mdi-file-document-outline</v-icon><p>{{ items.length ? '没有符合筛选条件的文档' : emptyLabel }}</p></div>
        <div v-if="hasMore" ref="loadMoreSentinel" class="load-more-sentinel" aria-live="polite">
          <span v-if="loadingMore" class="loading-more-status"><v-progress-circular indeterminate size="15" width="2" />正在加载</span>
          <button v-else-if="!autoLoadSupported" type="button" @click="loadWorkbench(false)">加载更多</button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.workbench-page { width: 100%; max-width: none; min-height: 100vh; margin: 0; padding: 26px 36px 56px; color: #262626; background: #fff; }
.workbench-content { width: 100%; }
h1 { height: 28px; margin: 0 0 22px; font-size: 18px; font-weight: 500; line-height: 28px; letter-spacing: 0; }
.quick-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 28px; }
.quick-action { display: flex; width: 259px; height: 55px; flex: 0 0 259px; align-items: center; gap: 12px; padding: 0 12px; border: 1px solid #e7e9e8; border-radius: 8px; color: #262626; background: #fff; font: inherit; text-align: left; text-decoration: none; cursor: pointer; transition: border-color .16s ease, background-color .16s ease; }
.quick-action:hover { border-color: #c9cecb; background: #fafbfa; }
.quick-action:focus-visible, .document-tabs button:focus-visible, .filter-button:focus-visible, .more-button:focus-visible, .load-more-sentinel button:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.quick-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; border-radius: 7px; }
.quick-icon-document { color: #3978f6; background: #eef4ff; }
.quick-icon-knowledge { color: #2a9f72; background: #edf8f3; }
.quick-icon-template { color: #7c61da; background: #f3f0ff; }
.quick-icon-ai { color: #16a36a; background: #edfaf4; }
.quick-copy { display: flex; min-width: 0; flex-direction: column; }
.quick-copy strong { overflow: hidden; font-size: 14px; font-weight: 500; line-height: 21px; text-overflow: ellipsis; white-space: nowrap; }
.quick-copy small { overflow: hidden; color: #8a8f8d; font-size: 12px; font-weight: 400; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.quick-chevron { margin-left: auto; color: #8c8c8c; }
.create-menu { padding-block: 6px; }
.documents-section h2 { height: 28px; margin: 0 0 20px; font-size: 18px; font-weight: 500; line-height: 28px; }
.documents-toolbar { display: flex; min-height: 36px; align-items: center; justify-content: space-between; gap: 16px; }
.document-tabs { display: inline-flex; height: 36px; align-items: center; padding: 2px; border-radius: 8px; background: rgba(0, 0, 0, .04); }
.document-tabs button { height: 32px; padding: 4px 16px; border: 0; border-radius: 6px; color: #595959; background: transparent; font: inherit; font-size: 14px; line-height: 24px; white-space: nowrap; cursor: pointer; }
.document-tabs button.active { color: #262626; background: #fff; box-shadow: 0 1px 2px rgba(0, 0, 0, .05); }
.document-filters { display: flex; align-items: center; gap: 3px; }
.filter-button { display: inline-flex; height: 32px; align-items: center; gap: 3px; padding: 0 8px; border: 0; border-radius: 6px; color: #595959; background: transparent; font: inherit; font-size: 14px; cursor: pointer; }
.filter-button:hover { color: #262626; background: rgba(0, 0, 0, .035); }
.inline-error { display: flex; min-height: 40px; align-items: center; justify-content: space-between; gap: 16px; margin-top: 12px; padding: 8px 12px; border-radius: 6px; color: #cf1322; background: #fff1f0; font-size: 13px; }
.inline-error button { border: 0; color: inherit; background: transparent; font: inherit; font-weight: 500; cursor: pointer; }
.document-list { width: 100%; margin-top: 17px; border-collapse: collapse; table-layout: fixed; }
.document-row { height: 65px; background: #fafafa; }
.document-row > td { height: 65px; padding: 16px 1px; border-bottom: 1px solid rgba(0, 0, 0, .04); vertical-align: middle; }
.document-primary { display: flex; min-width: 0; align-items: center; gap: 8px; color: inherit; text-decoration: none; }
.resource-icon { display: grid; width: 32px; height: 32px; flex: 0 0 32px; place-items: center; color: #3978f6; }
.resource-icon.type-whiteboard { color: #7c61da; }
.resource-icon.type-spreadsheet { color: #2a9f72; }
.resource-icon.type-database { color: #d46b08; }
.document-title { display: flex; min-width: 0; flex: 1; align-items: center; gap: 9px; }
.document-title strong { min-width: 0; flex: 1; overflow: hidden; color: #262626; font-size: 14px; font-weight: 400; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.document-collaborators { display: inline-flex; flex: 0 0 auto; align-items: center; padding-left: 4px; }
.collaborator-avatar { border: 2px solid #fafafa; color: #646a73; font-size: 10px; font-weight: 600; }
.collaborator-avatar + .collaborator-avatar, .collaborator-overflow { margin-left: -6px; }
.collaborator-overflow { display: grid; width: 22px; height: 22px; place-items: center; border: 2px solid #fafafa; border-radius: 50%; color: #646a73; background: #eef0f3; font-size: 9px; font-weight: 600; }
.document-owner { overflow: hidden; color: #8a8f8d; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; }
.document-owner a { color: inherit; text-decoration: none; }
.document-owner a:hover { color: #595959; text-decoration: underline; text-underline-offset: 2px; }
.document-time time { color: #8a8f8d; font-size: 14px; white-space: nowrap; }
.document-actions { text-align: center; }
.more-button { display: inline-grid; width: 32px; height: 32px; place-items: center; border: 0; border-radius: 6px; color: #8a8f8d; background: transparent; cursor: pointer; opacity: 1; }
.more-button:hover { color: #262626; background: rgba(0, 0, 0, .04); }
.skeleton { display: block; height: 12px; border-radius: 6px; background: linear-gradient(90deg, #f2f3f2 25%, #fafafa 37%, #f2f3f2 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; }
.title-skeleton { width: min(240px, 75%); }
.owner-skeleton { width: 150px; }
.time-skeleton { width: 70px; }
.action-skeleton { width: 22px; margin-inline: auto; }
.document-empty { display: grid; min-height: 196px; place-items: center; align-content: center; gap: 8px; color: #b0b3b1; }
.document-empty p { margin: 0; font-size: 14px; }
.load-more-sentinel { display: flex; min-height: 1px; justify-content: center; padding-top: 1px; }
.loading-more-status { display: inline-flex; height: 32px; align-items: center; gap: 7px; color: #8a8f8d; font-size: 13px; }
.load-more-sentinel button { height: 28px; margin-top: 7px; padding: 0 9px; border: 0; border-radius: 5px; color: #8a8f8d; background: transparent; font: inherit; font-size: 13px; cursor: pointer; }
.load-more-sentinel button:hover { color: #595959; background: rgba(0, 0, 0, .035); }
@keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
@media (hover: hover) and (pointer: fine) { .more-button { opacity: 0; } .document-row:hover .more-button, .more-button:focus-visible, .more-button[aria-expanded="true"] { opacity: 1; } }
@media (max-width: 820px) { .workbench-page { padding: 22px 24px 48px; } .documents-toolbar { align-items: flex-start; flex-direction: column; } .document-filters { align-self: flex-end; } .document-owner { display: none; } .document-list col:nth-child(1) { width: 77% !important; } .document-list col:nth-child(2) { width: 0 !important; } .document-list col:nth-child(3) { width: 18% !important; } .document-list col:nth-child(4) { width: 5% !important; } }
@media (max-width: 560px) { .workbench-page { padding: 20px 16px 40px; } .quick-actions { gap: 8px; } .quick-action { width: 100%; height: 55px; flex-basis: 100%; } .document-tabs { width: 100%; height: auto; overflow-x: auto; } .document-tabs button { flex: 1 0 auto; padding-inline: 12px; } .document-filters { width: 100%; justify-content: flex-end; } .document-time { display: none; } .document-list col:nth-child(1) { width: 92% !important; } .document-list col:nth-child(3) { width: 0 !important; } .document-list col:nth-child(4) { width: 8% !important; } }
@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; } }
</style>
