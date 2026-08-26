<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { KnowledgeBase, Template, TemplateInstance, TemplatePage, Workspace } from '../../../src/types'
import { get, messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

type TemplateFilter = '' | Template['templateType']

const PAGE_SIZE = 24
const session = useSessionStore()
const ui = useUiStore()
const router = useRouter()

const workspaceId = ref('')
const type = ref<TemplateFilter>('')
const searchInput = ref('')
const query = ref('')
const templates = ref<Template[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const error = ref('')
const workspaces = ref<Workspace[]>([])

const detailOpen = ref(false)
const selected = ref<Template | null>(null)
const detailLoading = ref(false)
const detailError = ref('')
const knowledgeBases = ref<KnowledgeBase[]>([])
const targetKnowledgeBaseId = ref('')
const resourceName = ref('')
const resourceSlug = ref('')
const creating = ref(false)
const deleting = ref(false)
const deleteConfirmationOpen = ref(false)

let searchTimer: number | undefined
let requestSequence = 0
let ready = false

const workspaceOptions = computed(() => workspaces.value)
const currentWorkspaceName = computed(() => workspaceOptions.value.find((item) => item.id === workspaceId.value)?.name ?? '当前工作区')
const canInstantiate = computed(() => {
  if (!selected.value || !resourceName.value.trim() || !resourceSlug.value) return false
  return selected.value.templateType !== 'DOCUMENT' || Boolean(targetKnowledgeBaseId.value)
})

onMounted(async () => {
  try {
    workspaces.value = session.workspaces.length
      ? [...session.workspaces]
      : await get<Workspace[]>('/api/v1/workspaces')
    workspaceId.value = session.activeWorkspace?.id ?? workspaces.value[0]?.id ?? ''
    await loadTemplates(true)
    ready = true
  } catch (value) {
    error.value = messageOf(value)
  }
})

onBeforeUnmount(() => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
})

watch([workspaceId, type], () => {
  if (ready) void loadTemplates(true)
})

watch(searchInput, (value) => {
  if (searchTimer !== undefined) window.clearTimeout(searchTimer)
  searchTimer = window.setTimeout(() => {
    query.value = value.trim()
    if (ready) void loadTemplates(true)
  }, 320)
})

async function loadTemplates(reset: boolean) {
  if (!workspaceId.value) {
    templates.value = []
    hasMore.value = false
    return
  }

  const sequence = ++requestSequence
  if (reset) loading.value = true
  else loadingMore.value = true
  error.value = ''

  try {
    const page = await post<TemplatePage>('/api/v1/templates/page', {
      workspaceId: workspaceId.value,
      templateType: type.value || null,
      query: query.value,
      limit: PAGE_SIZE,
      offset: reset ? 0 : nextOffset.value,
    })
    if (sequence !== requestSequence) return
    templates.value = reset ? page.items : mergeTemplates(templates.value, page.items)
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (sequence === requestSequence) error.value = messageOf(value)
  } finally {
    if (sequence === requestSequence) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function openTemplate(template: Template) {
  selected.value = template
  resourceName.value = template.name
  resourceSlug.value = `${slugify(template.name, template.templateType === 'DOCUMENT' ? 174 : 74) || 'template'}-${Date.now().toString().slice(-5)}`
  targetKnowledgeBaseId.value = ''
  knowledgeBases.value = []
  detailError.value = ''
  deleteConfirmationOpen.value = false
  detailOpen.value = true
  detailLoading.value = true

  try {
    const [detail, availableKnowledgeBases] = await Promise.all([
      post<Template>('/api/v1/templates/get', { templateId: template.id }),
      template.templateType === 'DOCUMENT'
        ? post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: workspaceId.value })
        : Promise.resolve([] as KnowledgeBase[]),
    ])
    if (!detailOpen.value || selected.value?.id !== template.id) return
    selected.value = detail
    resourceName.value = detail.name
    if (detail.templateType === 'DOCUMENT') {
      knowledgeBases.value = availableKnowledgeBases
      targetKnowledgeBaseId.value = knowledgeBases.value[0]?.id ?? ''
    }
  } catch (value) {
    detailError.value = messageOf(value)
  } finally {
    detailLoading.value = false
  }
}

function closeTemplate() {
  if (creating.value || deleting.value) return
  detailOpen.value = false
  deleteConfirmationOpen.value = false
  selected.value = null
}

async function instantiateTemplate() {
  const template = selected.value
  if (!template || !canInstantiate.value) return
  creating.value = true
  detailError.value = ''

  try {
    const instance = template.templateType === 'DOCUMENT'
      ? await post<TemplateInstance>('/api/v1/templates/instantiate-document', {
          templateId: template.id,
          knowledgeBaseId: targetKnowledgeBaseId.value,
          title: resourceName.value.trim(),
          path: resourceSlug.value,
        })
      : await post<TemplateInstance>('/api/v1/templates/instantiate-knowledge-base', {
          templateId: template.id,
          workspaceId: workspaceId.value,
          name: resourceName.value.trim(),
          slug: resourceSlug.value,
        })

    templates.value = templates.value.map((item) => item.id === template.id ? { ...item, useCount: item.useCount + 1 } : item)
    detailOpen.value = false
    ui.notify(template.templateType === 'DOCUMENT' ? '文档已从模板创建' : '知识库已从模板创建')
    if (instance.targetResourceType === 'PAGE') {
      await router.push(`/app/kb/${targetKnowledgeBaseId.value}/pages/${instance.targetResourceId}`)
    } else {
      await router.push(`/app/kb/${instance.targetResourceId}`)
    }
  } catch (value) {
    detailError.value = messageOf(value)
  } finally {
    creating.value = false
  }
}

async function deleteTemplate() {
  const template = selected.value
  if (!template) return
  deleting.value = true
  detailError.value = ''

  try {
    await post<void>('/api/v1/templates/delete', { templateId: template.id })
    templates.value = templates.value.filter((item) => item.id !== template.id)
    deleteConfirmationOpen.value = false
    detailOpen.value = false
    selected.value = null
    ui.notify('模板已删除')
  } catch (value) {
    detailError.value = messageOf(value)
    deleteConfirmationOpen.value = false
  } finally {
    deleting.value = false
  }
}

function mergeTemplates(current: Template[], incoming: Template[]) {
  const seen = new Set(current.map((item) => item.id))
  return [...current, ...incoming.filter((item) => !seen.has(item.id))]
}

function slugify(value: string, limit = selected.value?.templateType === 'DOCUMENT' ? 180 : 80) {
  return value.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}-]/gu, '').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, limit)
}

function onNameInput() {
  resourceSlug.value = slugify(resourceName.value)
}

function onSlugInput() {
  resourceSlug.value = slugify(resourceSlug.value)
}

function safeImageUrl(value: string | null) {
  if (!value) return null
  if (value.startsWith('/') && !value.startsWith('//')) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null
  } catch {
    return null
  }
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value))
}
</script>

<template>
  <main class="templates-view">
    <header class="templates-header">
      <div>
        <h1>模板中心</h1>
        <p>从模板快速开始创作。</p>
      </div>
      <span class="current-workspace"><v-icon size="15">mdi-domain</v-icon>{{ currentWorkspaceName }}</span>
    </header>

    <div class="templates-body">
    <section class="template-toolbar-panel">
      <div class="template-toolbar">
        <v-select
          v-model="workspaceId"
          :items="workspaceOptions"
          item-title="name"
          item-value="id"
          label="工作区"
          prepend-inner-icon="mdi-domain"
          density="compact"
          variant="outlined"
          hide-details
          class="workspace-filter"
        />
        <v-text-field
          v-model="searchInput"
          label="搜索模板与分类"
          prepend-inner-icon="mdi-magnify"
          density="compact"
          variant="outlined"
          clearable
          hide-details
          class="search-filter"
        />
        <v-btn-toggle v-model="type" mandatory density="compact" color="primary" variant="outlined" divided>
          <v-btn value="">全部</v-btn>
          <v-btn value="DOCUMENT" prepend-icon="mdi-file-document-outline">文档</v-btn>
          <v-btn value="KNOWLEDGE_BASE" prepend-icon="mdi-book-open-page-variant-outline">知识库</v-btn>
        </v-btn-toggle>
      </div>
    </section>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="templates-error" @click:close="error = ''">
      {{ error }}
      <template #append><v-btn variant="text" size="small" @click="loadTemplates(true)">重试</v-btn></template>
    </v-alert>

    <div v-if="loading" class="template-grid" aria-label="正在加载模板">
      <v-skeleton-loader v-for="index in 8" :key="index" type="image, article" class="template-skeleton" />
    </div>

    <div v-else-if="templates.length" class="template-grid">
      <v-card
        v-for="template in templates"
        :key="template.id"
        class="template-card clickable"
        rounded="lg"
        tabindex="0"
        @click="openTemplate(template)"
        @keydown.enter.prevent="openTemplate(template)"
        @keydown.space.prevent="openTemplate(template)"
      >
        <div class="template-cover">
          <v-img v-if="safeImageUrl(template.thumbnail)" :src="safeImageUrl(template.thumbnail) || undefined" height="116" cover>
            <template #error><div class="template-cover-fallback"><v-icon size="44">mdi-image-off-outline</v-icon></div></template>
          </v-img>
          <div v-else class="template-cover-fallback">
            <v-icon size="48">{{ template.templateType === 'DOCUMENT' ? 'mdi-file-document-outline' : 'mdi-bookshelf' }}</v-icon>
          </div>
          <v-chip size="small" color="surface" class="template-type" variant="flat">
            {{ template.templateType === 'DOCUMENT' ? '文档模板' : '知识库模板' }}
          </v-chip>
        </div>
        <v-card-text class="template-card-body">
          <div class="template-category">{{ template.category || '未分类' }}</div>
          <h2 class="template-title">{{ template.name }}</h2>
          <p class="template-description">{{ template.description || '一个可复用的内容起点。' }}</p>
          <div class="template-meta">
            <span><v-icon size="15">mdi-lightning-bolt-outline</v-icon>已使用 {{ template.useCount }} 次</span>
            <span>{{ template.visibility === 'PRIVATE' ? '仅自己' : '工作区可见' }}</span>
          </div>
        </v-card-text>
      </v-card>
    </div>

    <div v-else class="templates-empty">
      <div>
        <v-icon size="38">mdi-view-grid-plus-outline</v-icon>
        <h2>{{ query || type ? '没有匹配的模板' : '还没有模板' }}</h2>
        <p>{{ query || type ? '调整搜索词或模板类型后再试。' : '可在文档或知识库页面把成熟内容保存为模板。' }}</p>
        <v-btn v-if="query || type" variant="tonal" color="primary" @click="searchInput = ''; type = ''">清除筛选</v-btn>
      </div>
    </div>

    <div v-if="hasMore" class="load-more">
      <v-btn variant="text" size="small" :loading="loadingMore" prepend-icon="mdi-chevron-down" @click="loadTemplates(false)">加载更多模板</v-btn>
    </div>
    </div>

    <v-dialog v-model="detailOpen" max-width="620" :persistent="creating || deleting" @after-leave="selected = null">
      <v-card v-if="selected" rounded="lg">
        <v-card-title class="dialog-title">
          <span>{{ selected.name }}</span>
          <v-spacer />
          <v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭模板详情" :disabled="creating || deleting" @click="closeTemplate" />
        </v-card-title>
        <v-progress-linear v-if="detailLoading" indeterminate color="primary" />
        <v-card-text class="detail-body">
          <div class="detail-summary">
            <v-avatar color="primary" variant="tonal" rounded="lg" size="42">
              <v-icon>{{ selected.templateType === 'DOCUMENT' ? 'mdi-file-document-outline' : 'mdi-bookshelf' }}</v-icon>
            </v-avatar>
            <div>
              <strong>{{ selected.category || (selected.templateType === 'DOCUMENT' ? '文档模板' : '知识库模板') }}</strong>
              <p>{{ selected.description || '这个模板没有补充说明。' }}</p>
              <small>{{ selected.visibility === 'PRIVATE' ? '仅创建者可见' : '工作区成员可见' }} · 已使用 {{ selected.useCount }} 次 · 更新于 {{ formatDate(selected.updatedAt) }}</small>
            </div>
          </div>

          <v-alert v-if="detailError" type="error" variant="tonal" density="compact" class="detail-alert">{{ detailError }}</v-alert>
          <v-alert v-if="selected.templateType === 'DOCUMENT' && !detailLoading && !knowledgeBases.length" type="warning" variant="tonal" density="compact" class="detail-alert">
            当前工作区没有可用知识库，请先创建知识库再使用此模板。
          </v-alert>

          <v-select
            v-if="selected.templateType === 'DOCUMENT'"
            v-model="targetKnowledgeBaseId"
            :items="knowledgeBases"
            item-title="name"
            item-value="id"
            label="目标知识库"
            prepend-inner-icon="mdi-book-open-page-variant-outline"
            density="comfortable"
            variant="outlined"
            :loading="detailLoading"
            class="mb-2"
          />
          <v-text-field
            v-model="resourceName"
            :label="selected.templateType === 'DOCUMENT' ? '文档标题' : '知识库名称'"
            :maxlength="selected.templateType === 'DOCUMENT' ? 500 : 160"
            counter
            density="comfortable"
            variant="outlined"
            autofocus
            class="mb-2"
            @update:model-value="onNameInput"
          />
          <v-text-field
            v-model="resourceSlug"
            label="访问路径"
            prefix="/"
            :maxlength="selected.templateType === 'DOCUMENT' ? 180 : 80"
            hint="仅保留文字、数字和连字符"
            persistent-hint
            density="comfortable"
            variant="outlined"
            @blur="onSlugInput"
          />
        </v-card-text>
        <v-card-actions class="detail-actions">
          <v-btn color="error" variant="text" prepend-icon="mdi-trash-can-outline" :disabled="creating || deleting" @click="deleteConfirmationOpen = true">删除模板</v-btn>
          <v-spacer />
          <v-btn variant="text" :disabled="creating || deleting" @click="closeTemplate">取消</v-btn>
          <v-btn color="primary" prepend-icon="mdi-auto-fix" :loading="creating" :disabled="detailLoading || !canInstantiate || deleting" @click="instantiateTemplate">创建</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="deleteConfirmationOpen" max-width="420" :persistent="deleting">
      <v-card rounded="lg">
        <v-card-title class="delete-title">删除模板？</v-card-title>
        <v-card-text class="delete-body">
          模板“{{ selected?.name }}”会被永久删除，已经用它创建的内容不会受到影响。
        </v-card-text>
        <v-card-actions class="delete-actions">
          <v-spacer />
          <v-btn variant="text" :disabled="deleting" @click="deleteConfirmationOpen = false">取消</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="deleteTemplate">删除模板</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.templates-view { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.templates-view :deep(.v-btn), .templates-view :deep(.v-chip) { text-transform: none; letter-spacing: 0; }
.templates-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.templates-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.templates-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.current-workspace { height: 27px; padding: 0 8px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; color: #65706a; background: #f3f5f4; font-size: 11px; }
.templates-body { width: min(1100px, calc(100% - 48px)); margin: 18px auto 64px; }
.template-toolbar-panel { margin-bottom: 18px; padding-bottom: 13px; border-bottom: 1px solid #e7e9e8; }
.template-toolbar { display: flex; align-items: center; gap: 9px; }
.workspace-filter { flex: 0 1 230px; }
.search-filter { flex: 1 1 280px; }
.template-toolbar :deep(.v-field) { border-radius: 6px; }
.template-toolbar :deep(.v-btn) { height: 32px; border-radius: 5px; font-size: 12px; }
.templates-error { margin-bottom: 14px; }
.template-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 11px; }
.template-skeleton { min-height: 260px; border: 1px solid #eceeed; border-radius: 8px; }
.template-card { min-height: 270px; overflow: hidden; border: 1px solid #e7e9e8 !important; border-radius: 8px !important; box-shadow: none !important; transition: border-color .13s, box-shadow .13s, transform .13s; }
.template-card:hover { border-color: #c8cdca !important; box-shadow: 0 5px 15px rgba(33, 42, 37, .055) !important; transform: translateY(-1px); }
.template-card:focus-visible { outline: 2px solid #4382e8; outline-offset: 2px; }
.template-cover { height: 116px; position: relative; background: #f5f7f7; }
.template-cover :deep(.v-img) { height: 116px !important; }
.template-cover-fallback { height: 100%; display: grid; place-items: center; color: #3978f6; }
.template-type { position: absolute; left: 9px; bottom: 8px; height: 23px !important; border-radius: 4px !important; box-shadow: none; font-size: 10px; }
.template-card-body { padding: 14px; }
.template-category { margin-bottom: 6px; color: #3978f6; font-size: 10px; font-weight: 600; }
.template-title { margin: 0; color: #333936; font-size: 14px; font-weight: 600; line-height: 1.4; }
.template-description { min-height: 39px; margin: 6px 0 12px; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; color: #858c88; font-size: 12px; line-height: 1.6; }
.template-meta { display: flex; justify-content: space-between; gap: 9px; color: #a1a7a4; font-size: 10px; }
.template-meta span { min-width: 0; display: inline-flex; align-items: center; gap: 3px; }
.load-more { padding: 22px 0 4px; display: flex; justify-content: center; }
.templates-empty { min-height: 350px; display: grid; place-content: center; color: #adb2af; text-align: center; }
.templates-empty h2 { margin: 12px 0 4px; color: #606763; font-size: 15px; font-weight: 600; }
.templates-empty p { margin: 0 0 16px; color: #979d9a; font-size: 12px; }
.dialog-title { min-height: 60px; padding: 0 12px 0 20px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; font-size: 16px; font-weight: 650; }
.detail-body { padding: 18px 22px 4px; }
.detail-summary { margin-bottom: 18px; display: flex; align-items: flex-start; gap: 12px; }
.detail-summary strong { color: #414844; font-size: 13px; }
.detail-summary p { margin: 3px 0; color: #747b77; font-size: 12px; line-height: 1.55; }
.detail-summary small { color: #a0a6a3; font-size: 10px; }
.detail-alert { margin-bottom: 14px; }
.detail-actions { padding: 12px 16px 16px; border-top: 1px solid #eceeed; }
.delete-title { padding: 21px 22px 8px; font-size: 17px; font-weight: 650; }
.delete-body { padding: 10px 22px 4px; color: #606763; font-size: 13px; line-height: 1.7; }
.delete-actions { padding: 12px 16px 16px; }
@media (max-width: 700px) {
  .templates-view { margin: -16px; }
  .templates-header { padding: 0 18px; }
  .templates-body { width: calc(100% - 28px); margin-top: 12px; }
  .current-workspace { max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .template-toolbar { align-items: stretch; flex-direction: column; }
  .template-toolbar > * { flex-basis: auto; width: 100%; }
  .template-grid { grid-template-columns: 1fr; }
  .template-meta { align-items: flex-start; flex-direction: column; }
  .detail-summary > .v-avatar { display: none; }
  .detail-actions { flex-wrap: wrap; }
}
</style>
