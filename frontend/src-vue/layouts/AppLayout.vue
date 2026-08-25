<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import GlobalSearch from '../components/GlobalSearch.vue'
import CreateResourceDialog from '../components/CreateResourceDialog.vue'
import { useSessionStore } from '../stores/session'
import { useUiStore } from '../stores/ui'
import { OFFLINE_QUEUE_EVENT, pendingPageUpdateCount } from '../../src/lib/offline'

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const session = useSessionStore(); const ui = useUiStore(); const router = useRouter(); const route = useRoute()
const online = ref(navigator.onLine)
const pendingChanges = ref(0)
const installPrompt = ref<InstallPromptEvent | null>(null)
const updateReady = ref(false)
const controlledAtMount = Boolean(navigator.serviceWorker?.controller)
const focusMode = computed(() => /^\/app\/kb\/[^/]+\/pages\/[^/]+$/.test(route.path))
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
const initials = computed(() => (session.user?.displayName || session.user?.email || 'U').slice(0, 1).toUpperCase())
onMounted(async () => {
  await session.loadNavigation()
  if (session.user) pendingChanges.value = await pendingPageUpdateCount(session.user.userId).catch(() => 0)
  window.addEventListener('keydown', shortcut)
  window.addEventListener('online', updateConnectivity)
  window.addEventListener('offline', updateConnectivity)
  window.addEventListener('beforeinstallprompt', captureInstallPrompt)
  window.addEventListener(OFFLINE_QUEUE_EVENT, updateQueueCount)
  navigator.serviceWorker?.addEventListener('controllerchange', markUpdateReady)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', shortcut)
  window.removeEventListener('online', updateConnectivity)
  window.removeEventListener('offline', updateConnectivity)
  window.removeEventListener('beforeinstallprompt', captureInstallPrompt)
  window.removeEventListener(OFFLINE_QUEUE_EVENT, updateQueueCount)
  navigator.serviceWorker?.removeEventListener('controllerchange', markUpdateReady)
})
function shortcut(event: KeyboardEvent) { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); ui.searchOpen = true } }
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
    <div class="d-flex align-center px-5 py-4"><span class="auth-mark mr-3">知</span><div><strong>知序</strong><div class="text-caption text-medium-emphasis">知识协作空间</div></div></div>
    <div class="px-3 pb-3"><v-select :model-value="session.activeWorkspaceId" :items="session.workspaces" item-title="name" item-value="id" label="工作区" prepend-inner-icon="mdi-domain" @update:model-value="session.selectWorkspace" /></div>
    <v-list nav density="comfortable" class="px-3"><v-list-item v-for="item in primary" :key="item.to" :to="item.to" :prepend-icon="item.icon" :title="item.title" rounded="lg" /></v-list>
    <div class="px-5 pt-3 pb-1 text-caption font-weight-bold text-medium-emphasis">知识库</div>
    <v-list nav density="compact" class="px-3">
      <v-list-item v-for="kb in session.activeKnowledgeBases" :key="kb.id" :to="`/app/kb/${kb.id}`" :title="kb.name" rounded="lg"><template #prepend><span class="mr-3">{{ kb.icon || '📘' }}</span></template></v-list-item>
      <v-list-item title="新建知识库" prepend-icon="mdi-plus-circle-outline" rounded="lg" @click="ui.createOpen = true" />
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
    <v-app-bar-nav-icon @click="ui.navigationOpen = !ui.navigationOpen" />
    <v-btn variant="tonal" prepend-icon="mdi-magnify" class="ml-2 text-medium-emphasis" @click="ui.searchOpen = true">搜索 <span class="ml-6 text-caption">⌘ K</span></v-btn>
    <v-spacer />
    <v-btn v-if="installPrompt" prepend-icon="mdi-monitor-arrow-down-variant" variant="text" @click="installApp">安装应用</v-btn>
    <v-btn icon="mdi-help-circle-outline" variant="text" /><v-btn to="/app/notifications" icon="mdi-bell-outline" variant="text" />
    <v-btn color="primary" prepend-icon="mdi-plus" class="ml-2 mr-4" @click="ui.createOpen = true">新建</v-btn>
  </v-app-bar>
  <v-main><router-view /></v-main>
  <GlobalSearch />
  <CreateResourceDialog />
  <v-snackbar v-model="updateReady" color="info" location="bottom" :timeout="-1">
    新版本已经就绪，刷新后即可使用。
    <template #actions><v-btn variant="text" @click="reloadApp">立即刷新</v-btn></template>
  </v-snackbar>
</template>
