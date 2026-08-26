<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'
import GlobalSearch from '../components/GlobalSearch.vue'
import CreateResourceDialog from '../components/CreateResourceDialog.vue'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import type { ResourceKind } from '../utils/createResource'
import { OFFLINE_QUEUE_EVENT, pendingPageUpdateCount } from '../../src/lib/offline'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const session = useSessionStore(); const ui = useUiStore(); const router = useRouter(); const route = useRoute()
const display = useDisplay()
const mobile = computed(() => display.width.value < 720)
const online = ref(navigator.onLine)
const pendingChanges = ref(0)
const installPrompt = ref<InstallPromptEvent | null>(null)
const updateReady = ref(false)
const controlledAtMount = Boolean(navigator.serviceWorker?.controller)
const focusMode = computed(() => route.meta.shell === 'focus')
const knowledgeBasesExpanded = ref(localStorage.getItem('navigation-kb-expanded') !== 'false')
const moreActive = computed(() => route.path === '/app/trash')
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ J' : 'Ctrl J'
const primary = [
  { key: 'start', title: '开始', icon: 'mdi-home-outline', to: '/app' },
  { key: 'ai', title: 'AI 写作', icon: 'mdi-creation-outline', to: '/app/ai' },
  { key: 'notes', title: '小记', icon: 'mdi-note-text-outline', to: '/app/notes' },
  { key: 'favorite', title: '收藏', icon: 'mdi-star-outline', to: '/app?filter=FAVORITE' },
  { key: 'explore', title: '逛逛', icon: 'mdi-compass-outline', to: '/app/explore' },
]
const quickCreate: Array<{ title: string; subtitle: string; icon: string; kind: ResourceKind }> = [
  { title: '文档', subtitle: '从空白页面开始写作', icon: 'mdi-file-document-outline', kind: 'DOCUMENT' },
  { title: '画板', subtitle: '自由组织想法和关系', icon: 'mdi-drawing-box', kind: 'WHITEBOARD' },
  { title: '表格', subtitle: '处理表格与计算数据', icon: 'mdi-table-large', kind: 'SPREADSHEET' },
  { title: '数据表', subtitle: '用多种视图管理记录', icon: 'mdi-database-outline', kind: 'DATABASE' },
]
const pageKinds = new Set<ResourceKind>(['DOCUMENT', 'WHITEBOARD', 'SPREADSHEET', 'DATABASE'])
const initials = computed(() => (session.user?.displayName || session.user?.email || 'U').slice(0, 1).toUpperCase())
watch(mobile, (value) => { if (value) ui.navigationOpen = false }, { immediate: true })
onMounted(async () => {
  window.addEventListener('keydown', shortcut)
  window.addEventListener('online', updateConnectivity)
  window.addEventListener('offline', updateConnectivity)
  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener(OFFLINE_QUEUE_EVENT, updateQueueCount)
  navigator.serviceWorker?.addEventListener('controllerchange', markUpdateReady)
  await session.loadNavigation().catch(() => ui.notify('导航加载失败，请检查网络后重试', 'error'))
  if (session.user) pendingChanges.value = await pendingPageUpdateCount(session.user.userId).catch(() => 0)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('online', updateConnectivity)
  window.removeEventListener('offline', updateConnectivity)
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
  window.removeEventListener(OFFLINE_QUEUE_EVENT, updateQueueCount)
  navigator.serviceWorker?.removeEventListener('controllerchange', markUpdateReady)
})
watch(() => route.fullPath, () => { if (mobile.value) ui.navigationOpen = false })
watch(knowledgeBasesExpanded, (value) => localStorage.setItem('navigation-kb-expanded', String(value)))
function shortcut(event: KeyboardEvent) {
  const target = event.target instanceof HTMLElement ? event.target : null
  const editing = Boolean(target?.closest('input, textarea, [contenteditable="true"]'))
  if (event.defaultPrevented || focusMode.value || editing) return
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'j') { event.preventDefault(); ui.searchOpen = true }
}
function primaryActive(key: string) {
  if (key === 'start') return route.path === '/app' && !route.query.filter
  if (key === 'favorite') return route.path === '/app' && route.query.filter === 'FAVORITE'
  if (key === 'ai') return route.path === '/app/ai'
  if (key === 'notes') return route.path === '/app/notes'
  if (key === 'explore') return route.path === '/app/explore'
  return false
}
async function changeWorkspace(id: string | null) {
  if (!id || id === session.activeWorkspaceId) return
  session.selectWorkspace(id)
  await router.push(`/app/w/${id}`)
}
function openCreate(kind: ResourceKind, source: 'TOP_BAR' | 'SIDEBAR_KB' = 'TOP_BAR') {
  ui.openCreate({
    kind,
    source,
    workspaceId: session.activeWorkspace?.id,
    knowledgeBaseId: pageKinds.has(kind) ? session.activeKnowledgeBases[0]?.id : undefined,
  })
}
function updateConnectivity() { online.value = navigator.onLine }
function captureInstallPrompt(event: Event) { event.preventDefault(); installPrompt.value = event as InstallPromptEvent }
function updateQueueCount(event: Event) { pendingChanges.value = Number((event as CustomEvent<{ count?: number }>).detail?.count ?? 0) }
function markUpdateReady() { if (controlledAtMount) updateReady.value = true }
function reloadApp() { window.location.reload() }
async function installApp() {
  if (!installPrompt.value) return
  await installPrompt.value.prompt()
  await installPrompt.value.userChoice
  installPrompt.value = null
}
function openClientDownload() {
  if (installPrompt.value) void installApp()
  else ui.notify('当前浏览器未提供安装入口，可继续使用网页版', 'info')
}
async function logout() { await session.logout(); await router.replace('/login') }
</script>

<template>
  <v-navigation-drawer
    v-if="!focusMode"
    v-model="ui.navigationOpen"
    class="yuque-sidebar"
    width="254"
    color="#fafafa"
    :border="false"
    :permanent="!mobile"
    :temporary="mobile"
  >
    <div class="sidebar-frame">
      <div class="sidebar-top">
        <div class="sidebar-identity-row">
          <v-menu location="bottom start">
            <template #activator="{ props }">
              <button v-bind="props" type="button" class="sidebar-brand" aria-label="切换工作区">
                <span class="sidebar-brand-mark">知</span>
                <span class="sidebar-brand-name">知序</span>
                <v-icon size="14">mdi-chevron-down</v-icon>
              </button>
            </template>
            <v-list class="sidebar-popup" density="compact" min-width="236">
              <v-list-subheader>切换空间</v-list-subheader>
              <v-list-item
                v-for="workspace in session.workspaces"
                :key="workspace.id"
                :active="workspace.id === session.activeWorkspaceId"
                :title="workspace.name"
                prepend-icon="mdi-domain"
                @click="changeWorkspace(workspace.id)"
              />
              <v-divider class="my-1" />
              <v-list-item prepend-icon="mdi-domain-plus" title="新建组织" @click="openCreate('WORKSPACE')" />
            </v-list>
          </v-menu>
          <span class="sidebar-flex" />
          <v-btn to="/app/notifications" class="sidebar-icon-button" icon="mdi-bell-outline" size="32" variant="text" aria-label="消息" />
          <v-menu location="bottom end">
            <template #activator="{ props }">
              <v-btn v-bind="props" class="sidebar-avatar-button" icon size="32" variant="text" aria-label="账号菜单">
                <v-avatar class="sidebar-avatar" color="#5c6f91" size="24">{{ initials }}</v-avatar>
              </v-btn>
            </template>
            <v-list class="sidebar-popup account-popup" density="compact" min-width="248">
              <v-list-item :title="session.user?.displayName || session.user?.email" :subtitle="session.user?.email">
                <template #prepend><v-avatar color="#5c6f91" size="32">{{ initials }}</v-avatar></template>
              </v-list-item>
              <v-divider class="my-1" />
              <v-list-item to="/app/account" prepend-icon="mdi-account-cog-outline" title="账号设置" />
              <v-list-item to="/app/profile" prepend-icon="mdi-account-box-outline" title="公开主页" />
              <v-list-item to="/app/feed" prepend-icon="mdi-rss" title="动态" />
              <v-list-item to="/app/templates" prepend-icon="mdi-view-grid-plus-outline" title="模板中心" />
              <v-list-item to="/app/transfers" prepend-icon="mdi-swap-vertical-bold" title="导入与导出" />
              <v-list-item to="/app/open-platform" prepend-icon="mdi-code-tags" title="开放平台" />
              <v-list-item v-if="session.user?.instanceAdmin" to="/app/admin" prepend-icon="mdi-shield-crown-outline" title="管理后台" />
              <v-divider class="my-1" />
              <v-list-item prepend-icon="mdi-logout" title="退出登录" base-color="error" @click="logout" />
            </v-list>
          </v-menu>
        </div>

        <div class="sidebar-search-row">
          <button type="button" class="sidebar-search" aria-label="搜索" @click="ui.searchOpen = true">
            <v-icon size="17">mdi-magnify</v-icon>
            <span>搜索</span>
            <kbd>{{ shortcutLabel }}</kbd>
          </button>
          <v-menu location="bottom end">
            <template #activator="{ props }">
              <v-btn v-bind="props" class="sidebar-create-button" icon="mdi-plus" size="32" variant="text" aria-label="新建" />
            </template>
            <v-list class="sidebar-popup create-popup" density="compact" width="286">
              <v-list-subheader>新建</v-list-subheader>
              <v-list-item v-for="item in quickCreate" :key="item.kind" :prepend-icon="item.icon" :title="item.title" :subtitle="item.subtitle" @click="openCreate(item.kind)" />
              <v-divider class="my-1" />
              <v-list-item to="/app/transfers" prepend-icon="mdi-import" title="导入..." />
              <v-list-item prepend-icon="mdi-book-plus-outline" title="新建知识库" @click="openCreate('KNOWLEDGE_BASE')" />
              <v-list-item prepend-icon="mdi-domain-plus" title="新建组织" @click="openCreate('WORKSPACE')" />
            </v-list>
          </v-menu>
        </div>
      </div>

      <div class="sidebar-scroll">
        <v-list nav density="compact" class="sidebar-list sidebar-main-list">
          <v-list-item
            v-for="item in primary"
            :key="item.key"
            :to="item.to"
            :active="primaryActive(item.key)"
            :prepend-icon="item.icon"
            :title="item.title"
          />
        </v-list>

        <div class="knowledge-heading">
          <button type="button" class="knowledge-toggle" :aria-expanded="knowledgeBasesExpanded" @click="knowledgeBasesExpanded = !knowledgeBasesExpanded">
            <v-icon size="14">{{ knowledgeBasesExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
            <span>知识库</span>
          </button>
          <v-btn v-if="session.activeWorkspace" :to="`/app/w/${session.activeWorkspace.id}`" icon="mdi-chevron-right" class="knowledge-add" variant="text" size="28" aria-label="查看全部知识库" />
          <v-btn v-else icon="mdi-plus" class="knowledge-add" variant="text" size="28" aria-label="新建知识库" @click="openCreate('KNOWLEDGE_BASE', 'SIDEBAR_KB')" />
        </div>
        <v-list v-show="knowledgeBasesExpanded" nav density="compact" class="sidebar-list knowledge-list">
          <v-list-item v-for="kb in session.activeKnowledgeBases" :key="kb.id" :to="`/app/kb/${kb.id}`" :title="kb.name">
            <template #prepend><span class="knowledge-icon"><span v-if="kb.icon">{{ kb.icon }}</span><v-icon v-else size="16">mdi-book-outline</v-icon></span></template>
            <template #append><v-icon v-if="kb.visibility === 'PRIVATE'" class="knowledge-lock" size="13">mdi-lock-outline</v-icon></template>
          </v-list-item>
          <button v-if="!session.activeKnowledgeBases.length" type="button" class="knowledge-empty" @click="openCreate('KNOWLEDGE_BASE', 'SIDEBAR_KB')">
            还没有知识库，点击创建
          </button>
        </v-list>
      </div>

      <div class="sidebar-bottom">
        <v-menu location="top end" :close-on-content-click="true">
          <template #activator="{ props }">
            <button v-bind="props" type="button" class="sidebar-more" :class="{ 'is-active': moreActive }">
              <v-icon size="18">mdi-dots-horizontal-circle-outline</v-icon>
              <span>更多</span>
              <span class="sidebar-flex" />
            </button>
          </template>
          <v-list class="sidebar-popup more-popup" density="compact" min-width="248">
            <v-list-subheader>更多</v-list-subheader>
            <v-list-item to="/app/trash" prepend-icon="mdi-trash-can-outline" title="回收站" subtitle="找回删除的文档与内容" />
            <v-list-item prepend-icon="mdi-devices" title="客户端下载" subtitle="使用移动端、桌面端、插件" @click="openClientDownload" />
            <v-divider class="my-1" />
            <v-list-item prepend-icon="mdi-help-circle-outline" title="帮助" @click="ui.notify('帮助中心正在整理中', 'info')" />
            <v-list-item prepend-icon="mdi-message-alert-outline" title="我要反馈" @click="ui.notify('请在问题页面通过消息或评论提交反馈', 'info')" />
            <v-divider v-if="!online || pendingChanges || updateReady" class="my-1" />
            <v-list-item v-if="!online || pendingChanges" :prepend-icon="online ? 'mdi-sync-alert' : 'mdi-cloud-off-outline'" :title="online ? `${pendingChanges} 项更改待同步` : '离线模式'" />
            <v-list-item v-if="updateReady" prepend-icon="mdi-update" title="刷新并安装新版本" @click="reloadApp" />
          </v-list>
        </v-menu>
      </div>
    </div>
  </v-navigation-drawer>

  <v-app-bar v-if="!focusMode && mobile" color="#fafafa" flat border="bottom" height="48">
    <v-app-bar-nav-icon aria-label="打开或关闭导航" @click="ui.navigationOpen = !ui.navigationOpen" />
    <span class="mobile-brand">知序</span>
    <v-spacer />
    <v-btn icon="mdi-magnify" size="small" variant="text" aria-label="搜索" @click="ui.searchOpen = true" />
    <v-btn icon="mdi-plus" size="small" variant="text" class="mr-1" aria-label="新建文档" @click="openCreate('DOCUMENT')" />
  </v-app-bar>
  <v-main><router-view /></v-main>
  <GlobalSearch />
  <CreateResourceDialog />
  <v-snackbar v-model="updateReady" color="info" location="bottom" :timeout="-1">
    新版本已经就绪，刷新后即可使用。
    <template #actions><v-btn variant="text" @click="reloadApp">立即刷新</v-btn></template>
  </v-snackbar>
</template>

<style scoped>
.yuque-sidebar { border-right: 1px solid #e7e9e8 !important; background: #fafafa !important; }
.yuque-sidebar :deep(.v-navigation-drawer__content) { overflow: hidden; }
.sidebar-frame { display: flex; flex-direction: column; height: 100%; color: #262626; }
.sidebar-top { flex: 0 0 auto; padding: 10px 10px 7px; }
.sidebar-identity-row, .sidebar-search-row { display: flex; align-items: center; min-width: 0; }
.sidebar-identity-row { height: 32px; }
.sidebar-search-row { gap: 12px; margin: 16px 3px 0 2px; }
.sidebar-flex { flex: 1; }
.sidebar-brand, .sidebar-search, .sidebar-more, .knowledge-toggle, .knowledge-empty {
  appearance: none;
  border: 0;
  color: inherit;
  cursor: pointer;
  font: inherit;
  text-align: left;
}
.sidebar-brand { display: flex; align-items: center; gap: 7px; min-width: 0; height: 32px; padding: 3px 5px 3px 2px; border-radius: 6px; background: transparent; }
.sidebar-brand:hover, .sidebar-icon-button:hover, .sidebar-avatar-button:hover, .sidebar-create-button:hover { background: #eff0f0; }
.sidebar-brand-mark { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; flex: 0 0 26px; border-radius: 6px; color: #fff; background: #42b883; font-size: 14px; font-weight: 700; }
.sidebar-brand-name { max-width: 91px; overflow: hidden; color: #1f2329; font-size: 15px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.sidebar-icon-button, .sidebar-avatar-button, .sidebar-create-button { flex: 0 0 32px; color: #646a73; border-radius: 6px; }
.sidebar-avatar-button { margin-left: 1px; }
.sidebar-avatar { color: #fff; font-size: 12px; font-weight: 600; }
.sidebar-search { display: flex; align-items: center; gap: 7px; height: 32px; min-width: 0; flex: 1; padding: 0 8px; border-radius: 6px; color: #646a73; background: #f0f1f1; font-size: 13px; }
.sidebar-search:hover { background: #e9eaea; }
.sidebar-search span { flex: 1; }
.sidebar-search kbd { border: 0; color: #8f959e; background: transparent; box-shadow: none; font: 11px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; white-space: nowrap; }
.sidebar-create-button { background: #f0f1f1; }
.sidebar-scroll { min-height: 0; flex: 1 1 auto; overflow-x: hidden; overflow-y: auto; padding: 4px 10px 10px; scrollbar-width: thin; }
.sidebar-list { padding: 0; background: transparent; }
.sidebar-list :deep(.v-list-item) { --v-list-prepend-gap: 10px; min-height: 32px !important; margin: 1px 0; padding: 0 16px 0 10px !important; border-radius: 6px !important; color: #3d424a; font-size: 14px; }
.sidebar-list :deep(.v-list-item:hover) { background: #f1f2f2; }
.sidebar-list :deep(.v-list-item--active) { color: #1f2329; background: #eff0f0; }
.sidebar-list :deep(.v-list-item--active .v-list-item__overlay) { opacity: 0; }
.sidebar-list :deep(.v-list-item__prepend > .v-icon) { margin-inline-end: 0; color: #646a73; font-size: 18px; opacity: 1; }
.sidebar-list :deep(.v-list-item-title) { font-size: 14px; line-height: 20px; }
.sidebar-main-list { margin-bottom: 13px; }
.knowledge-heading { display: flex; align-items: center; height: 32px; margin: 4px 0 2px; }
.knowledge-toggle { display: flex; align-items: center; gap: 6px; height: 32px; min-width: 0; flex: 1; padding: 0 7px; border-radius: 6px; color: #3d424a; background: transparent; font-size: 14px; font-weight: 400; }
.knowledge-toggle:hover, .knowledge-add:hover { color: #646a73; background: #f1f2f2; }
.knowledge-add { flex: 0 0 28px; border-radius: 6px; color: #8f959e; }
.knowledge-icon { display: inline-flex; width: 18px; align-items: center; justify-content: center; color: #5b8def; font-size: 15px; }
.knowledge-lock { color: #8f959e; }
.knowledge-empty { width: 100%; padding: 8px 10px; border-radius: 6px; color: #8f959e; background: transparent; font-size: 12px; line-height: 18px; }
.knowledge-empty:hover { background: #f1f2f2; }
.sidebar-bottom { flex: 0 0 auto; padding: 6px 10px 10px; }
.sidebar-more { display: flex; align-items: center; gap: 10px; width: 100%; height: 32px; padding: 0 10px; border-radius: 6px; color: #646a73; background: transparent; font-size: 14px; }
.sidebar-more:hover, .sidebar-more.is-active { color: #1f2329; background: #eff0f0; }
.mobile-brand { color: #1f2329; font-size: 15px; font-weight: 600; }
.sidebar-popup { border: 1px solid #e5e6e8; border-radius: 8px; box-shadow: 0 8px 24px rgb(31 35 41 / 12%); }
.sidebar-popup :deep(.v-list-item) { min-height: 34px; border-radius: 5px; font-size: 14px; }
.create-popup :deep(.v-list-item) { min-height: 46px; }
.account-popup :deep(.v-list-item-subtitle) { font-size: 11px; }
</style>
