<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Page } from '../../../src/types'
import AnalyticsDialog from '../../components/AnalyticsDialog.vue'
import CatalogPanel from '../../components/CatalogPanel.vue'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

const route = useRoute(); const router = useRouter(); const session = useSessionStore(); const ui = useUiStore()
const id = computed(() => String(route.params.knowledgeBaseId))
const knowledgeBase = ref<KnowledgeBase | null>(null); const pages = ref<Page[]>([])
const loading = ref(false); const error = ref(''); const query = ref(''); const view = ref<'catalog' | 'grid' | 'list'>('catalog')
const analyticsOpen = ref(false)
const filtered = computed(() => pages.value.filter((page) => !query.value || `${page.title} ${page.path}`.toLowerCase().includes(query.value.toLowerCase())))
const icon = (type: Page['contentType']) => ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' })[type]
const label = (type: Page['contentType']) => ({ DOCUMENT: '文档', WHITEBOARD: '白板', SPREADSHEET: '电子表格', DATABASE: '数据表' })[type]
onMounted(load); watch(id, load)
async function load() {
  loading.value = true; error.value = ''
  try { [knowledgeBase.value, pages.value] = await Promise.all([post('/api/v1/knowledge-bases/get', { knowledgeBaseId: id.value }), post('/api/v1/pages/list', { knowledgeBaseId: id.value })]) }
  catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function remove(page: Page) {
  if (!confirm(`将「${page.title}」移到回收站？`)) return
  await post('/api/v1/pages/trash', { pageId: page.id }); await load()
}
async function duplicate(page: Page) {
  try {
    const copy = await post<Page>('/api/v1/pages/copy', {
      pageId: page.id,
      targetKnowledgeBaseId: id.value,
      title: `${page.title} 副本`,
      path: `${page.path.replace(/-copy(?:-\d+)?$/, '')}-copy-${Date.now().toString(36)}`.slice(0, 180),
    })
    await load(); ui.notify('副本已创建'); await router.push(`/app/kb/${id.value}/pages/${copy.id}`)
  } catch (value) { error.value = messageOf(value) }
}
function openPage(page: Page) { void router.push(`/app/kb/${id.value}/pages/${page.id}`) }
</script>

<template>
  <div class="page-shell">
    <header class="page-heading"><div class="d-flex align-center"><v-avatar color="primary" variant="tonal" rounded="lg" class="mr-4">{{ knowledgeBase?.icon || '📘' }}</v-avatar><div><h1>{{ knowledgeBase?.name || '知识库' }}</h1><p>{{ knowledgeBase?.description || '集中管理文档、白板和结构化数据。' }}</p></div></div><div class="d-flex ga-2"><v-btn variant="outlined" prepend-icon="mdi-chart-box-outline" @click="analyticsOpen = true">统计</v-btn><v-btn :to="`/app/kb/${id}/settings`" variant="outlined" prepend-icon="mdi-cog-outline">设置</v-btn><v-btn color="primary" prepend-icon="mdi-plus" @click="ui.openCreate({knowledgeBaseId:id,workspaceId:knowledgeBase?.workspaceId,source:'KNOWLEDGE_BASE'})">新建内容</v-btn></div></header>
    <v-card class="section-card">
      <div class="data-toolbar pa-4 mb-0"><v-text-field v-if="view !== 'catalog'" v-model="query" prepend-inner-icon="mdi-magnify" placeholder="搜索此知识库" max-width="380" clearable /><div v-else class="text-body-2 text-medium-emphasis"><v-icon size="18" class="mr-1">mdi-file-tree-outline</v-icon>目录支持分组、外链、拖放排序与历史恢复</div><v-spacer /><v-btn-toggle v-model="view" mandatory density="compact" color="primary"><v-btn value="catalog" icon="mdi-file-tree-outline" title="目录"/><v-btn value="list" icon="mdi-format-list-bulleted" title="列表"/><v-btn value="grid" icon="mdi-view-grid-outline" title="网格"/></v-btn-toggle></div><v-divider />
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <v-alert v-if="error" type="error" variant="tonal" class="ma-4">{{ error }}</v-alert>
      <CatalogPanel v-if="view === 'catalog'" :knowledge-base-id="id" :pages="pages" @page-created="load" @page-trashed="load" @open-page="openPage" />
      <v-list v-else-if="view === 'list' && filtered.length" lines="two" class="pa-3">
        <v-list-item v-for="page in filtered" :key="page.id" :prepend-icon="icon(page.contentType)" :title="page.title" :subtitle="`${label(page.contentType)} · /${page.path} · 更新于 ${new Date(page.updatedAt).toLocaleString('zh-CN')}`" rounded="lg" @click="router.push(`/app/kb/${id}/pages/${page.id}`)"><template #append><v-chip size="x-small" :color="page.publishedRevisionId ? 'success' : undefined" variant="tonal" class="mr-3">{{ page.publishedRevisionId ? '已发布' : '草稿' }}</v-chip><v-menu><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" @click.stop /></template><v-list><v-list-item :to="`/app/kb/${id}/pages/${page.id}`" prepend-icon="mdi-pencil-outline" title="打开编辑" /><v-list-item prepend-icon="mdi-content-copy" title="复制" @click="duplicate(page)"/><v-divider /><v-list-item prepend-icon="mdi-trash-can-outline" title="移到回收站" base-color="error" @click="remove(page)" /></v-list></v-menu></template></v-list-item>
      </v-list>
      <div v-else-if="view === 'grid' && filtered.length" class="surface-grid pa-5"><v-card v-for="page in filtered" :key="page.id" class="section-card clickable pa-5" @click="router.push(`/app/kb/${id}/pages/${page.id}`)"><v-icon color="primary" size="30">{{ icon(page.contentType) }}</v-icon><h3 class="mt-4 mb-1">{{ page.title }}</h3><p class="muted text-body-2">{{ label(page.contentType) }} · {{ new Date(page.updatedAt).toLocaleDateString('zh-CN') }}</p></v-card></div>
      <div v-else-if="!loading" class="empty-state"><div><v-icon size="48">mdi-folder-open-outline</v-icon><h3>{{ query ? '没有匹配的内容' : '知识库还是空的' }}</h3><p>{{ query ? '换一个关键词试试。' : '创建第一篇文档、白板、电子表格或数据表。' }}</p><v-btn v-if="!query" color="primary" prepend-icon="mdi-plus" @click="ui.openCreate({knowledgeBaseId:id,workspaceId:knowledgeBase?.workspaceId,source:'KNOWLEDGE_BASE'})">创建内容</v-btn></div></div>
    </v-card>
    <AnalyticsDialog v-if="knowledgeBase" v-model="analyticsOpen" :knowledge-base-id="knowledgeBase.id" :title="`${knowledgeBase.name} · 数据统计`" />
  </div>
</template>
