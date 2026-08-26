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
const { mobile } = useDisplay()
const online = ref(navigator.onLine)
const pendingChanges = ref(0)
const installPrompt = ref<InstallPromptEvent | null>(null)
const updateReady = ref(false)
const controlledAtMount = Boolean(navigator.serviceWorker?.controller)
const focusMode = computed(() => route.meta.shell === 'focus')
const knowledgeBasesExpanded = ref(localStorage.getItem('navigation-kb-expanded') !== 'false')
const shortcutLabel = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'
const primary = [
  { title: '工作台', icon: 'mdi-view-dashboard-outline', to: '/app' },
  { title: '小记', icon: 'mdi-note-text-outline', to: '/app/notes' },
  { title: '消息', icon: 'mdi-bell-outline', to: '/app/notifications' },
  { title: '动态', icon: 'mdi-rss', to: '/app/feed' },
]
const tools = [
  { title: '模板中心', icon: 'mdi-view-grid-plus-outline', to: '/app/templates' },
  { title: '导入与导出', icon: 'mdi-swap-vertical-bold', to: '/app/transfers' },
  { title: '回收站', icon: 'mdi-trash-can-outline', to: '/app/trash' },
]
const quickCreate: Array<{ title: string; subtitle: string; icon: string; kind: ResourceKind }> = [
  { title: '文档', subtitle: '从空白页面开始写作', icon: 'mdi-file-document-outline', kind: 'DOCUMENT' },
  { title: '白板', subtitle: '自由组织想法和关系', icon: 'mdi-drawing-box', kind: 'WHITEBOARD' },
  { title: '电子表格', subtitle: '处理表格与计算数据', icon: 'mdi-table-large', kind: 'SPREADSHEET' },
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); ui.searchOpen = true }
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
async function logout() { await session.logout(); await router.replace('/login') }
</script>

<template>
  <v-navigation-drawer v-if="!focusMode" v-model="ui.navigationOpen" width="280" color="surface" border="end">
    <router-link to="/app" class="shell-brand px-5 py-4"><span class="auth-mark mr-3">知</span><div><strong>知序</strong><div class="text-caption text-medium-emphasis">知识协作空间</div></div></router-link>
    <div class="px-3 pb-3"><v-select :model-value="session.activeWorkspaceId" :items="session.workspaces" item-title="name" item-value="id" label="工作区" prepend-inner-icon="mdi-domain" @update:model-value="changeWorkspace" /></div>
    <v-list nav density="comfortable" class="px-3"><v-list-item v-for="item in primary" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" rounded="lg" /></v-list>
    <div class="navigation-section-heading px-3 pt-3 pb-1"><v-btn variant="text" size="small" :prepend-icon="knowledgeBasesExpanded ? 'mdi-chevron-down' : 'mdi-chevron-right'" @click="knowledgeBasesExpanded = !knowledgeBasesExpanded">知识库</v-btn><v-btn icon="mdi-plus" variant="text" size="small" aria-label="新建知识库" @click="openCreate('KNOWLEDGE_BASE', 'SIDEBAR_KB')" /></div>
    <v-list v-show="knowledgeBasesExpanded" nav density="compact" class="px-3">
      <v-list-item v-for="kb in session.activeKnowledgeBases" :key="kb.id" :to="`/app/kb/${kb.id}`" :title="kb.name" rounded="lg"><template #prepend><span class="mr-3">{{ kb.icon || '📘' }}</span></template></v-list-item>
      <v-list-item v-if="!session.activeKnowledgeBases.length" title="还没有知识库" subtitle="创建后会显示在这里" prepend-icon="mdi-book-outline" rounded="lg" />
      <v-list-item title="新建知识库" prepend-icon="mdi-plus-circle-outline" rounded="lg" @click="openCreate('KNOWLEDGE_BASE', 'SIDEBAR_KB')" />
    </v-list>
    <div class="px-5 pt-3 pb-1 text-caption font-weight-bold text-medium-emphasis">工具</div>
    <v-list nav density="compact" class="px-3"><v-list-item v-for="item in tools" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" rounded="lg" /></v-list>
    <template #append>
      <v-divider />
      <div class="px-4 pt-3 d-flex flex-wrap ga-2">
        <v-chip :color="online ? 'success' : 'warning'" :prepend-icon="online ? 'mdi-cloud-check-outline' : 'mdi-cloud-off-outline'" size="small" variant="tonal">
          {{ online ? '已连接' : '离线模式' }}
        </v-chip>
        <v-chip v-if="pendingChanges" color="warning" prepend-icon="mdi-sync-alert" size="small" variant="tonal">{{ pendingChanges }} 项待同步</v-chip>
      </div>
      <v-list nav class="px-3 py-3">
        <v-list-item v-if="session.user?.instanceAdmin" to="/app/admin" prepend-icon="mdi-shield-crown-outline" title="管理后台" rounded="lg" />
        <v-list-item to="/app/account" rounded="lg"><template #prepend><v-avatar color="primary" size="32">{{ initials }}</v-avatar></template><v-list-item-title>{{ session.user?.displayName || session.user?.email }}</v-list-item-title><v-list-item-subtitle>{{ session.user?.email }}</v-list-item-subtitle><template #append><v-menu><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" size="small" /></template><v-list><v-list-item to="/app/profile" prepend-icon="mdi-account-box-outline" title="公开主页" /><v-list-item to="/app/open-platform" prepend-icon="mdi-code-tags" title="开放平台" /><v-divider /><v-list-item prepend-icon="mdi-logout" title="退出登录" base-color="error" @click="logout" /></v-list></v-menu></template></v-list-item>
      </v-list>
    </template>
  </v-navigation-drawer>

  <v-app-bar v-if="!focusMode" color="surface" flat border="bottom" height="64">
    <v-app-bar-nav-icon aria-label="打开或关闭导航" @click="ui.navigationOpen = !ui.navigationOpen" />
    <v-btn variant="tonal" prepend-icon="mdi-magnify" class="shell-search ml-2 text-medium-emphasis" aria-label="搜索工作区" @click="ui.searchOpen = true"><span class="shell-search-label">搜索</span><span class="shell-shortcut ml-6 text-caption">{{ shortcutLabel }}</span></v-btn>
    <v-spacer />
    <v-btn v-if="installPrompt" prepend-icon="mdi-monitor-arrow-down-variant" variant="text" class="shell-install" aria-label="安装应用" @click="installApp"><span>安装应用</span></v-btn>
    <v-menu><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-help-circle-outline" aria-label="帮助与工具" variant="text" /></template><v-list><v-list-item to="/app/templates" prepend-icon="mdi-view-grid-plus-outline" title="模板中心" /><v-list-item to="/app/transfers" prepend-icon="mdi-swap-vertical-bold" title="导入与导出" /><v-divider /><v-list-item prepend-icon="mdi-keyboard-outline" :title="`${shortcutLabel} 打开搜索`" /></v-list></v-menu>
    <v-btn to="/app/notifications" icon="mdi-bell-outline" aria-label="消息" variant="text" />
    <v-menu location="bottom end"><template #activator="{ props }"><v-btn v-bind="props" color="primary" prepend-icon="mdi-plus" class="shell-create ml-2 mr-4"><span>新建</span></v-btn></template><v-list width="320" class="py-2"><v-list-subheader>新建内容</v-list-subheader><v-list-item v-for="item in quickCreate" :key="item.kind" :prepend-icon="item.icon" :title="item.title" :subtitle="item.subtitle" @click="openCreate(item.kind)" /><v-divider class="my-2" /><v-list-item prepend-icon="mdi-book-plus-outline" title="新建知识库" @click="openCreate('KNOWLEDGE_BASE')" /><v-list-item prepend-icon="mdi-domain-plus" title="新建组织空间" @click="openCreate('WORKSPACE')" /></v-list></v-menu>
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
.shell-brand { display: flex; align-items: center; color: inherit; text-decoration: none; }
.shell-brand:hover { background: rgba(var(--v-theme-primary), .045); }
.navigation-section-heading { display: flex; align-items: center; justify-content: space-between; }
.shell-shortcut { opacity: .7; }
@media (max-width: 700px) {
  .shell-search-label, .shell-shortcut, .shell-create span, .shell-install span { display: none; }
  .shell-search { min-width: 40px; padding-inline: 8px; }
  .shell-create, .shell-install { min-width: 40px; padding-inline: 10px; }
}
</style>
