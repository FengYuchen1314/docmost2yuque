<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Notification, QuickNote, WorkbenchItem, WorkbenchPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

const session = useSessionStore(); const ui = useUiStore(); const router = useRouter()
const reason = ref<WorkbenchItem['reason']>('EDITED')
const items = ref<WorkbenchItem[]>([]); const notifications = ref<Notification[]>([])
const capture = ref(''); const loading = ref(false); const saving = ref(false); const error = ref('')
const tabs = [{ title: '最近编辑', value: 'EDITED' }, { title: '最近浏览', value: 'VIEWED' }, { title: '协作过', value: 'COLLABORATED' }, { title: '收藏', value: 'FAVORITE' }, { title: '我创建的', value: 'CREATED' }]
const greeting = computed(() => { const hour = new Date().getHours(); return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好' })
onMounted(async () => { await load(); notifications.value = await post('/api/v1/notifications/list', { unreadOnly: true, limit: 5 }) })
watch(reason, load)
async function load() { loading.value = true; error.value = ''; try { items.value = (await post<WorkbenchPage>('/api/v1/workbench/page', { reason: reason.value, offset: 0, limit: 25 })).items } catch (value) { error.value = messageOf(value) } finally { loading.value = false } }
async function createNote() {
  if (!capture.value.trim() || !session.activeWorkspace?.id) return
  saving.value = true; error.value = ''
  try { await post<QuickNote>('/api/v1/quick-notes/create', { workspaceId: session.activeWorkspace.id, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: capture.value.trim() }] }] }, plainText: capture.value.trim(), source: 'HOME', clientRequestId: crypto.randomUUID(), tagIds: [] }); capture.value = ''; ui.notify('已保存到小记') }
  catch (value) { error.value = messageOf(value) } finally { saving.value = false }
}
async function favorite(item: WorkbenchItem) { await post('/api/v1/favorites/set', { pageId: item.resourceId, favorite: !item.favorite }); item.favorite = !item.favorite }
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div><h1>{{ greeting }}，{{ session.user?.displayName || session.user?.email?.split('@')[0] }}</h1><p>从最近工作继续，或者快速记下一条想法。</p></div><v-btn color="primary" prepend-icon="mdi-plus" @click="ui.createOpen = true">新建内容</v-btn></header>
    <v-card class="section-card mb-6 pa-5"><div class="d-flex align-start ga-3"><v-avatar color="primary" variant="tonal"><v-icon>mdi-lightning-bolt-outline</v-icon></v-avatar><v-textarea v-model="capture" auto-grow rows="1" max-rows="8" placeholder="随手记下想法、任务或链接…" variant="plain" hide-details @keydown.ctrl.enter="createNote" @keydown.meta.enter="createNote" /><v-btn color="primary" variant="tonal" :loading="saving" :disabled="!capture.trim()" @click="createNote">记一笔</v-btn></div></v-card>
    <v-alert v-if="error" type="error" variant="tonal" class="mb-5">{{ error }}</v-alert>
    <div class="surface-grid mb-6">
      <v-card class="section-card" style="grid-column:span 2"><v-card-title class="d-flex align-center px-5 pt-5"><span>我的工作</span><v-spacer /><v-chip size="small" variant="tonal">{{ items.length }} 项</v-chip></v-card-title><v-tabs v-model="reason" color="primary" class="px-3"><v-tab v-for="tab in tabs" :key="tab.value" :value="tab.value">{{ tab.title }}</v-tab></v-tabs><v-divider /><v-progress-linear v-if="loading" indeterminate color="primary" /><v-list v-if="items.length" lines="two" class="pa-3"><v-list-item v-for="item in items" :key="item.resourceId" :title="item.title" :subtitle="`${item.knowledgeBaseName} · ${new Date(item.activityAt).toLocaleString('zh-CN')}`" prepend-icon="mdi-file-document-outline" rounded="lg" @click="router.push(`/app/kb/${item.knowledgeBaseId}/pages/${item.resourceId}`)"><template #append><v-chip size="x-small" variant="tonal" class="mr-2">{{ item.publicationStatus }}</v-chip><v-btn :icon="item.favorite ? 'mdi-star' : 'mdi-star-outline'" :color="item.favorite ? 'warning' : undefined" variant="text" @click.stop="favorite(item)" /></template></v-list-item></v-list><div v-else-if="!loading" class="empty-state"><div><v-icon size="42">mdi-file-clock-outline</v-icon><h3>这里还没有内容</h3><p>创建、浏览或收藏后会自动出现。</p></div></div></v-card>
      <v-card class="section-card"><v-card-title class="d-flex align-center px-5 pt-5"><span>待处理消息</span><v-spacer /><v-btn to="/app/notifications" variant="text" size="small">查看全部</v-btn></v-card-title><v-list v-if="notifications.length" lines="two" class="pa-3"><v-list-item v-for="note in notifications" :key="note.id" prepend-icon="mdi-bell-outline" :title="note.payload.title || note.type" :subtitle="note.payload.preview || new Date(note.createdAt).toLocaleString('zh-CN')" rounded="lg" /></v-list><div v-else class="empty-state"><div><v-icon size="40">mdi-bell-sleep-outline</v-icon><h3>没有新消息</h3><p>提及、评论和审批会出现在这里。</p></div></div></v-card>
    </div>
    <section><div class="d-flex align-center mb-4"><h2 class="text-h6">知识库</h2><v-spacer /><v-btn variant="text" prepend-icon="mdi-plus" @click="ui.createOpen = true">新建</v-btn></div><div class="surface-grid"><v-card v-for="kb in session.activeKnowledgeBases" :key="kb.id" class="section-card clickable pa-5" @click="router.push(`/app/kb/${kb.id}`)"><div class="d-flex align-center"><v-avatar color="primary" variant="tonal" rounded="lg" class="mr-4">{{ kb.icon || '📘' }}</v-avatar><div><strong>{{ kb.name }}</strong><p class="muted text-body-2 mt-1 mb-0">{{ kb.description || '团队知识库' }}</p></div><v-spacer /><v-icon>mdi-chevron-right</v-icon></div></v-card></div></section>
  </div>
</template>
