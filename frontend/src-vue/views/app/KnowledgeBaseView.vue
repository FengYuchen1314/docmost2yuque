<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Page } from '../../../src/types'
import AnalyticsDialog from '../../components/AnalyticsDialog.vue'
import CatalogPanel from '../../components/CatalogPanel.vue'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'

const route = useRoute()
const router = useRouter()
const ui = useUiStore()
const id = computed(() => String(route.params.knowledgeBaseId))
const knowledgeBase = ref<KnowledgeBase | null>(null)
const pages = ref<Page[]>([])
const loading = ref(false)
const error = ref('')
const query = ref('')
const displayMode = ref<'list' | 'grid'>('list')
const catalogManage = ref(false)
const analyticsOpen = ref(false)
const deleteTarget = ref<Page | null>(null)
const deleting = ref(false)
const duplicatingId = ref('')

const filtered = computed(() => {
  const normalized = query.value.trim().toLocaleLowerCase()
  if (!normalized) return pages.value
  return pages.value.filter((page) => `${page.title} ${page.path} ${contentTypeLabel(page.contentType)}`.toLocaleLowerCase().includes(normalized))
})
const publishedCount = computed(() => pages.value.filter((page) => page.publishedRevisionId).length)

onMounted(() => void load())
watch(id, () => {
  query.value = ''
  catalogManage.value = false
  void load()
})

async function load() {
  loading.value = true
  error.value = ''
  try {
    ;[knowledgeBase.value, pages.value] = await Promise.all([
      post('/api/v1/knowledge-bases/get', { knowledgeBaseId: id.value }),
      post('/api/v1/pages/list', { knowledgeBaseId: id.value }),
    ])
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
  }
}

function requestRemove(page: Page) {
  deleteTarget.value = page
}

async function remove() {
  const page = deleteTarget.value
  if (!page || deleting.value) return
  deleting.value = true
  error.value = ''
  try {
    await post('/api/v1/pages/trash', { pageId: page.id })
    deleteTarget.value = null
    ui.notify('已移入回收站')
    await load()
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    deleting.value = false
  }
}

async function duplicate(page: Page) {
  if (duplicatingId.value) return
  duplicatingId.value = page.id
  error.value = ''
  try {
    const copy = await post<Page>('/api/v1/pages/copy', {
      pageId: page.id,
      targetKnowledgeBaseId: id.value,
      title: `${page.title} 副本`,
      path: `${page.path.replace(/-copy(?:-\d+)?$/, '')}-copy-${Date.now().toString(36)}`.slice(0, 180),
    })
    await load()
    ui.notify('副本已创建')
    await router.push(`/app/kb/${id.value}/pages/${copy.id}`)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    duplicatingId.value = ''
  }
}

function createContent() {
  ui.openCreate({ knowledgeBaseId: id.value, workspaceId: knowledgeBase.value?.workspaceId, source: 'KNOWLEDGE_BASE' })
}

function openPage(page: Page) {
  void router.push(`/app/kb/${id.value}/pages/${page.id}`)
}

function contentTypeIcon(type: Page['contentType']) {
  return ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' })[type]
}

function contentTypeLabel(type: Page['contentType']) {
  return ({ DOCUMENT: '文档', WHITEBOARD: '画板', SPREADSHEET: '表格', DATABASE: '数据表' })[type]
}

function updatedTime(value: string) {
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (date.getFullYear() === today.getFullYear()) return date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  return date.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })
}
</script>

<template>
  <div class="knowledge-base-page">
    <header class="knowledge-header">
      <div class="knowledge-identity">
        <span class="knowledge-icon">{{ knowledgeBase?.icon || '📘' }}</span>
        <div><h1>{{ knowledgeBase?.name || '知识库' }}</h1><p>{{ knowledgeBase?.description || '集中整理和协作知识内容' }}</p></div>
      </div>
      <div class="header-actions">
        <v-btn icon="mdi-chart-box-outline" size="small" variant="text" aria-label="查看知识库统计" @click="analyticsOpen = true" />
        <v-btn :to="`/app/kb/${id}/settings`" icon="mdi-cog-outline" size="small" variant="text" aria-label="知识库设置" />
        <v-btn color="primary" size="small" prepend-icon="mdi-plus" @click="createContent">新建</v-btn>
      </div>
    </header>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="top-progress" />
    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="page-error" @click:close="error = ''">{{ error }}</v-alert>

    <section v-if="catalogManage" class="catalog-manager-stage">
      <div class="catalog-manager-heading">
        <button type="button" @click="catalogManage = false"><v-icon size="18">mdi-arrow-left</v-icon><span>返回知识库</span></button>
        <div><h2>整理目录</h2><p>添加分组与外部链接、调整层级，或从历史版本恢复目录。</p></div>
      </div>
      <CatalogPanel class="catalog-manager" :knowledge-base-id="id" :pages="pages" show-history @page-created="load" @page-trashed="load" @open-page="openPage" />
    </section>

    <div v-else class="knowledge-layout">
      <aside class="catalog-sidebar">
        <div class="catalog-sidebar-heading">
          <strong>目录</strong>
          <button type="button" title="整理目录" aria-label="整理目录" @click="catalogManage = true"><v-icon size="17">mdi-file-tree-outline</v-icon></button>
        </div>
        <div class="catalog-browser">
          <CatalogPanel :knowledge-base-id="id" :pages="pages" readonly :show-history="false" @open-page="openPage" />
        </div>
      </aside>

      <main class="knowledge-content">
        <div class="content-heading">
          <div><h2>全部内容</h2><p>{{ pages.length }} 篇内容<template v-if="publishedCount"> · {{ publishedCount }} 篇已发布</template></p></div>
          <div class="content-tools">
            <label class="knowledge-search"><v-icon size="17">mdi-magnify</v-icon><input v-model="query" aria-label="搜索此知识库" placeholder="搜索此知识库"><button v-if="query" type="button" aria-label="清除搜索" @click="query = ''"><v-icon size="15">mdi-close</v-icon></button></label>
            <div class="view-switch" aria-label="切换内容视图"><button type="button" :class="{ active: displayMode === 'list' }" title="列表" @click="displayMode = 'list'"><v-icon size="17">mdi-format-list-bulleted</v-icon></button><button type="button" :class="{ active: displayMode === 'grid' }" title="网格" @click="displayMode = 'grid'"><v-icon size="17">mdi-view-grid-outline</v-icon></button></div>
          </div>
        </div>

        <div v-if="filtered.length && displayMode === 'list'" class="content-list">
          <article v-for="page in filtered" :key="page.id" class="content-row" tabindex="0" @click="openPage(page)" @keydown.enter="openPage(page)">
            <span class="content-icon" :class="`type-${page.contentType.toLowerCase()}`"><v-icon size="20">{{ contentTypeIcon(page.contentType) }}</v-icon></span>
            <div class="content-copy"><strong>{{ page.title }}</strong><span>{{ contentTypeLabel(page.contentType) }} · /{{ page.path }}</span></div>
            <span class="publish-state" :class="{ published: page.publishedRevisionId }">{{ page.publishedRevisionId ? '已发布' : '草稿' }}</span>
            <time :datetime="page.updatedAt">{{ updatedTime(page.updatedAt) }}</time>
            <v-menu location="bottom end">
              <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" size="small" variant="text" class="row-menu" aria-label="更多操作" :loading="duplicatingId === page.id" @click.stop /></template>
              <v-list density="compact" min-width="160"><v-list-item prepend-icon="mdi-pencil-outline" title="打开编辑" @click="openPage(page)" /><v-list-item prepend-icon="mdi-content-copy" title="复制" @click="duplicate(page)" /><v-divider /><v-list-item prepend-icon="mdi-trash-can-outline" title="移到回收站" base-color="error" @click="requestRemove(page)" /></v-list>
            </v-menu>
          </article>
        </div>

        <div v-else-if="filtered.length" class="content-grid">
          <article v-for="page in filtered" :key="page.id" class="content-card" tabindex="0" @click="openPage(page)" @keydown.enter="openPage(page)">
            <header><span class="content-icon" :class="`type-${page.contentType.toLowerCase()}`"><v-icon size="20">{{ contentTypeIcon(page.contentType) }}</v-icon></span><v-menu location="bottom end"><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" size="small" variant="text" class="card-menu" aria-label="更多操作" :loading="duplicatingId === page.id" @click.stop /></template><v-list density="compact" min-width="160"><v-list-item prepend-icon="mdi-pencil-outline" title="打开编辑" @click="openPage(page)" /><v-list-item prepend-icon="mdi-content-copy" title="复制" @click="duplicate(page)" /><v-divider /><v-list-item prepend-icon="mdi-trash-can-outline" title="移到回收站" base-color="error" @click="requestRemove(page)" /></v-list></v-menu></header>
            <strong>{{ page.title }}</strong><p>/{{ page.path }}</p><footer><span>{{ page.publishedRevisionId ? '已发布' : contentTypeLabel(page.contentType) }}</span><time :datetime="page.updatedAt">{{ updatedTime(page.updatedAt) }}</time></footer>
          </article>
        </div>

        <div v-else-if="!loading" class="content-empty">
          <span class="empty-illustration"><v-icon size="34">{{ query ? 'mdi-file-search-outline' : 'mdi-file-document-plus-outline' }}</v-icon></span>
          <h3>{{ query ? '没有找到匹配内容' : '从第一篇内容开始' }}</h3>
          <p>{{ query ? '换一个关键词，或清除搜索条件后重试。' : '创建文档、画板、表格或数据表，把知识整理到这里。' }}</p>
          <v-btn v-if="query" variant="text" @click="query = ''">清除搜索</v-btn><v-btn v-else color="primary" size="small" prepend-icon="mdi-plus" @click="createContent">新建内容</v-btn>
        </div>
      </main>
    </div>

    <AnalyticsDialog v-if="knowledgeBase" v-model="analyticsOpen" :knowledge-base-id="knowledgeBase.id" :title="`${knowledgeBase.name} · 数据统计`" />
    <v-dialog :model-value="Boolean(deleteTarget)" max-width="460" @update:model-value="value => { if (!value && !deleting) deleteTarget = null }">
      <v-card rounded="lg"><v-card-title class="px-6 pt-6">将“{{ deleteTarget?.title }}”移到回收站？</v-card-title><v-card-text class="px-6">内容将从知识库中移除，之后可以在回收站恢复。</v-card-text><v-card-actions class="px-6 pb-6"><v-spacer /><v-btn :disabled="deleting" @click="deleteTarget = null">取消</v-btn><v-btn color="error" :loading="deleting" @click="remove">移到回收站</v-btn></v-card-actions></v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.knowledge-base-page{min-height:100vh;background:#fff;color:#262626}.knowledge-header{display:flex;min-height:64px;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #e7e9e8;padding:9px 24px}.knowledge-identity{display:flex;min-width:0;align-items:center;gap:10px}.knowledge-icon{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border-radius:7px;background:#f1f5ff;font-size:18px}.knowledge-identity>div{min-width:0}.knowledge-identity h1{overflow:hidden;margin:0;color:#262626;font-size:16px;font-weight:600;line-height:22px;text-overflow:ellipsis;white-space:nowrap}.knowledge-identity p{overflow:hidden;margin:2px 0 0;color:#8a8f8d;font-size:12px;line-height:17px;text-overflow:ellipsis;white-space:nowrap}.header-actions{display:flex;align-items:center;gap:3px}.top-progress{position:absolute;z-index:5}.page-error{position:fixed;z-index:50;top:74px;right:24px;width:min(520px,calc(100vw - 48px));box-shadow:0 8px 24px rgba(0,0,0,.08)}.knowledge-layout{display:grid;height:calc(100vh - 64px);grid-template-columns:280px minmax(0,1fr);overflow:hidden}.catalog-sidebar{display:flex;min-width:0;flex-direction:column;border-right:1px solid #e7e9e8;background:#fafafa}.catalog-sidebar-heading{display:flex;height:45px;flex:0 0 45px;align-items:center;justify-content:space-between;padding:0 12px 0 16px;color:#595959;font-size:13px}.catalog-sidebar-heading button{display:grid;width:28px;height:28px;place-items:center;border:0;border-radius:6px;color:#8a8f8d;background:transparent;cursor:pointer}.catalog-sidebar-heading button:hover{color:#262626;background:#eff0f0}.catalog-browser{min-height:0;flex:1;overflow:auto;padding:0 7px 12px}.catalog-browser :deep(.catalog-panel){overflow:visible;border:0!important;border-radius:0!important;background:transparent!important;box-shadow:none!important}.catalog-browser :deep(.catalog-header),.catalog-browser :deep(.catalog-panel>.v-divider){display:none}.catalog-browser :deep(.catalog-layout){min-height:0;border:0}.catalog-browser :deep(.catalog-tree-wrap){padding:0}.catalog-browser :deep(.catalog-tree){gap:1px}.catalog-browser :deep(.catalog-node){min-height:34px;gap:4px;padding:2px 5px 2px calc(3px + var(--catalog-depth) * 14px);border:0;border-radius:6px}.catalog-browser :deep(.catalog-node:hover),.catalog-browser :deep(.catalog-node:focus-within){background:#eff0f0}.catalog-browser :deep(.tree-spacer){width:22px}.catalog-browser :deep(.catalog-node .v-avatar){width:23px!important;height:23px!important;border-radius:5px!important}.catalog-browser :deep(.catalog-node .v-avatar .v-icon){font-size:15px!important}.catalog-browser :deep(.node-label){display:block;padding:3px}.catalog-browser :deep(.node-label strong){display:block;color:#3d424a;font-size:13px;font-weight:400}.catalog-browser :deep(.node-label small){display:none}.catalog-browser :deep(.catalog-empty){min-height:240px;padding:24px 12px}.catalog-browser :deep(.catalog-empty .v-icon){font-size:30px!important}.catalog-browser :deep(.catalog-empty h3){font-size:14px}.catalog-browser :deep(.catalog-empty p){font-size:12px}.knowledge-content{min-width:0;overflow:auto;padding:28px 36px 60px}.content-heading{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:18px}.content-heading h2{margin:0;font-size:18px;font-weight:600;line-height:26px}.content-heading p{margin:3px 0 0;color:#8a8f8d;font-size:12px}.content-tools{display:flex;align-items:center;gap:9px}.knowledge-search{display:flex;width:230px;height:34px;align-items:center;gap:7px;padding:0 8px;border:1px solid #dfe2e1;border-radius:7px;color:#8a8f8d;background:#fff}.knowledge-search:focus-within{border-color:#8eb4ff;box-shadow:0 0 0 2px rgba(22,119,255,.07)}.knowledge-search input{min-width:0;flex:1;border:0;outline:0;color:#262626;background:transparent;font:13px inherit}.knowledge-search button{display:grid;width:20px;height:20px;place-items:center;border:0;color:#a1a4a2;background:transparent;cursor:pointer}.view-switch{display:flex;height:32px;align-items:center;border:1px solid #dfe2e1;border-radius:7px;padding:2px}.view-switch button{display:grid;width:29px;height:26px;place-items:center;border:0;border-radius:5px;color:#8a8f8d;background:transparent;cursor:pointer}.view-switch button.active{color:#3978f6;background:#eef3ff}.content-list{border-top:1px solid #eff0f0}.content-row{display:grid;min-height:64px;grid-template-columns:32px minmax(0,1fr) 62px 82px 34px;align-items:center;gap:10px;border-bottom:1px solid #eff0f0;padding:7px 2px;cursor:pointer;outline:0}.content-row:hover,.content-row:focus-visible{background:#fafafa}.content-icon{display:grid;width:30px;height:30px;place-items:center;border-radius:6px;color:#3978f6;background:#eef3ff}.content-icon.type-whiteboard{color:#8b5cf6;background:#f4efff}.content-icon.type-spreadsheet{color:#159b68;background:#ecf9f3}.content-icon.type-database{color:#d97706;background:#fff6e8}.content-copy{display:flex;min-width:0;flex-direction:column}.content-copy strong{overflow:hidden;color:#262626;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.content-copy span{overflow:hidden;margin-top:2px;color:#a1a4a2;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.publish-state{justify-self:start;border-radius:4px;padding:2px 6px;color:#8a8f8d;background:#f3f4f4;font-size:11px}.publish-state.published{color:#16865d;background:#edf8f3}.content-row time{color:#8a8f8d;font-size:11px;text-align:right}.row-menu{opacity:0}.content-row:hover .row-menu,.content-row:focus-within .row-menu{opacity:1}.content-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:10px}.content-card{min-width:0;min-height:134px;border:1px solid #e7e9e8;border-radius:8px;padding:13px;cursor:pointer;outline:0}.content-card:hover,.content-card:focus-visible{border-color:#cfd3d1;background:#fafafa}.content-card header{display:flex;align-items:center;justify-content:space-between}.content-card .card-menu{opacity:0}.content-card:hover .card-menu,.content-card:focus-within .card-menu{opacity:1}.content-card>strong{display:block;overflow:hidden;margin-top:12px;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.content-card>p{overflow:hidden;margin:3px 0 0;color:#a1a4a2;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.content-card footer{display:flex;align-items:center;justify-content:space-between;margin-top:18px;color:#8a8f8d;font-size:11px}.content-empty{display:flex;min-height:360px;align-items:center;justify-content:center;flex-direction:column;color:#8a8f8d;text-align:center}.empty-illustration{display:grid;width:58px;height:58px;place-items:center;border-radius:14px;color:#739cf2;background:#f1f5ff}.content-empty h3{margin:16px 0 4px;color:#3d424a;font-size:15px;font-weight:500}.content-empty p{max-width:380px;margin:0 0 14px;font-size:12px;line-height:19px}.catalog-manager-stage{min-height:calc(100vh - 64px);padding:24px 30px 60px;background:#f7f8fa}.catalog-manager-heading{display:flex;align-items:center;gap:16px;width:min(1180px,100%);margin:0 auto 16px}.catalog-manager-heading>button{display:flex;height:32px;align-items:center;gap:5px;border:0;border-radius:6px;padding:0 8px;color:#595959;background:transparent;font:13px inherit;cursor:pointer}.catalog-manager-heading>button:hover{background:#eceeee}.catalog-manager-heading>div{border-left:1px solid #dfe2e1;padding-left:16px}.catalog-manager-heading h2{margin:0;font-size:17px;font-weight:600}.catalog-manager-heading p{margin:2px 0 0;color:#8a8f8d;font-size:12px}.catalog-manager{display:block;width:min(1180px,100%);margin:0 auto}.catalog-manager :deep(.catalog-panel){border-color:#e7e9e8!important;border-radius:9px!important;box-shadow:none!important}.catalog-manager :deep(.catalog-header){padding:18px 20px!important}.catalog-manager :deep(.catalog-header .text-overline){display:none}.catalog-manager :deep(.catalog-header h2){font-size:16px}.catalog-manager :deep(.create-panel){border-radius:8px;background:#fafcff}.catalog-manager :deep(.batch-toolbar){border-radius:8px}.catalog-manager :deep(.catalog-node){min-height:46px;border-radius:7px}.v-btn{text-transform:none;letter-spacing:0}@media(max-width:820px){.knowledge-header{padding-inline:14px}.knowledge-identity p{display:none}.knowledge-layout{height:auto;min-height:calc(100vh - 64px);grid-template-columns:1fr;overflow:visible}.catalog-sidebar{max-height:300px;border-right:0;border-bottom:1px solid #e7e9e8}.catalog-browser{max-height:255px}.knowledge-content{overflow:visible;padding:24px 18px 48px}.content-heading{align-items:stretch;flex-direction:column}.content-tools{width:100%}.knowledge-search{min-width:0;flex:1}.content-row{grid-template-columns:32px minmax(0,1fr) 65px 34px}.content-row time{display:none}.catalog-manager-stage{padding:20px 14px 48px}}@media(max-width:520px){.knowledge-header{min-height:56px}.knowledge-icon{width:30px;height:30px;flex-basis:30px}.knowledge-identity h1{font-size:14px}.header-actions>.v-btn:first-child{display:none}.knowledge-layout{min-height:calc(100vh - 56px)}.content-row{grid-template-columns:30px minmax(0,1fr) 32px}.publish-state{display:none}.content-grid{grid-template-columns:1fr 1fr}.catalog-manager-heading{align-items:flex-start;flex-direction:column}.catalog-manager-heading>div{border-left:0;padding-left:0}.catalog-manager-stage{min-height:calc(100vh - 56px)}}
</style>
