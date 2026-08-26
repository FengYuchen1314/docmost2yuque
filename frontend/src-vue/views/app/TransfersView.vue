<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { KnowledgeBase, TransferTask, TransferTaskPage, Workspace } from '../../../src/types'
import { get, messageOf, post, upload } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

type TransferFilter = 'ALL' | 'IMPORT' | 'EXPORT' | 'FAILED' | 'CANCELLED'
type OperationTab = 'IMPORT' | 'EXPORT'
type ImportFormat = 'AUTO' | 'MARKDOWN' | 'HTML' | 'TXT' | 'ZIP' | 'DOCX' | 'XLSX' | 'NOTION' | 'CONFLUENCE'

const PAGE_SIZE = 30
const MAX_FILE_SIZE = 50 * 1024 * 1024
const importFormats: Array<{ title: string; value: ImportFormat }> = [
  { title: '自动识别', value: 'AUTO' },
  { title: 'Markdown', value: 'MARKDOWN' },
  { title: 'HTML', value: 'HTML' },
  { title: '纯文本', value: 'TXT' },
  { title: 'ZIP 压缩包', value: 'ZIP' },
  { title: 'Word DOCX', value: 'DOCX' },
  { title: 'Excel XLSX', value: 'XLSX' },
  { title: 'Notion 导出包', value: 'NOTION' },
  { title: 'Confluence 导出包', value: 'CONFLUENCE' },
]

const session = useSessionStore()
const ui = useUiStore()

const tasks = ref<TransferTask[]>([])
const filter = ref<TransferFilter>('ALL')
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const refreshing = ref(false)
const polling = ref(false)
const error = ref('')
const expandedTaskId = ref('')

const workspaces = ref<Workspace[]>([])
const knowledgeBases = ref<KnowledgeBase[]>([])
const operationOpen = ref(false)
const operationTab = ref<OperationTab>('IMPORT')
const operationWorkspaceId = ref('')
const operationKnowledgeBaseId = ref('')
const knowledgeBasesLoading = ref(false)
const importFormat = ref<ImportFormat>('AUTO')
const importFile = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const starting = ref(false)
const operationError = ref('')

const cancelTarget = ref<TransferTask | null>(null)
const cancelling = ref(false)
const cancelError = ref('')

let pollTimer: number | undefined

const visibleTasks = computed(() => tasks.value.filter((task) => {
  if (filter.value === 'ALL') return true
  if (filter.value === 'FAILED' || filter.value === 'CANCELLED') return task.status === filter.value
  return task.taskType === filter.value
}))

const activeTasks = computed(() => tasks.value.filter((task) => task.status === 'PENDING' || task.status === 'RUNNING'))
const summary = computed(() => ({
  imports: tasks.value.filter((task) => task.taskType === 'IMPORT').length,
  exports: tasks.value.filter((task) => task.taskType === 'EXPORT').length,
  active: activeTasks.value.length,
  failed: tasks.value.filter((task) => task.status === 'FAILED').length,
}))
const selectedKnowledgeBase = computed(() => knowledgeBases.value.find((item) => item.id === operationKnowledgeBaseId.value) ?? null)

onMounted(async () => {
  await Promise.all([loadWorkspaces(), loadTasks(true)])
  pollTimer = window.setInterval(() => void pollActiveTasks(), 2_000)
})

onBeforeUnmount(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer)
})

watch(operationTab, () => {
  operationError.value = ''
})

async function loadWorkspaces() {
  try {
    workspaces.value = session.workspaces.length
      ? [...session.workspaces]
      : await get<Workspace[]>('/api/v1/workspaces')
  } catch (value) {
    operationError.value = messageOf(value)
  }
}

async function loadTasks(reset: boolean, manual = false) {
  if (reset) {
    if (manual) refreshing.value = true
    else loading.value = true
  } else {
    loadingMore.value = true
  }
  error.value = ''

  try {
    const page = await post<TransferTaskPage>('/api/v1/content-transfers/page', {
      limit: PAGE_SIZE,
      offset: reset ? 0 : nextOffset.value,
    })
    tasks.value = reset ? page.items : mergeTasks(tasks.value, page.items)
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
    loadingMore.value = false
    refreshing.value = false
  }
}

async function pollActiveTasks() {
  if (polling.value || !activeTasks.value.length) return
  polling.value = true
  const before = new Map(activeTasks.value.map((task) => [task.id, task.status]))

  try {
    const results = await Promise.allSettled(activeTasks.value.map((task) => post<TransferTask>('/api/v1/content-transfers/get', { taskId: task.id })))
    const updates = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : [])
    if (updates.length) {
      const byId = new Map(updates.map((task) => [task.id, task]))
      tasks.value = tasks.value.map((task) => byId.get(task.id) ?? task)
      const completed = updates.filter((task) => before.has(task.id) && !isActive(task))
      if (completed.some((task) => task.status === 'SUCCEEDED')) ui.notify('内容迁移任务已完成')
    }
  } finally {
    polling.value = false
  }
}

async function openOperation(tab: OperationTab) {
  operationTab.value = tab
  operationOpen.value = true
  operationError.value = ''
  importFile.value = null
  importFormat.value = 'AUTO'
  if (!workspaces.value.length) await loadWorkspaces()
  operationWorkspaceId.value = session.activeWorkspace?.id ?? workspaces.value[0]?.id ?? ''
  await loadKnowledgeBases()
}

async function loadKnowledgeBases() {
  if (!operationWorkspaceId.value) {
    knowledgeBases.value = []
    operationKnowledgeBaseId.value = ''
    return
  }
  knowledgeBasesLoading.value = true
  operationError.value = ''
  const requestedWorkspace = operationWorkspaceId.value
  try {
    const values = await post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: requestedWorkspace })
    if (operationWorkspaceId.value !== requestedWorkspace) return
    knowledgeBases.value = values
    operationKnowledgeBaseId.value = values.some((item) => item.id === operationKnowledgeBaseId.value)
      ? operationKnowledgeBaseId.value
      : values[0]?.id ?? ''
  } catch (value) {
    knowledgeBases.value = []
    operationKnowledgeBaseId.value = ''
    operationError.value = messageOf(value)
  } finally {
    knowledgeBasesLoading.value = false
  }
}

function chooseFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  operationError.value = ''
  if (!file) {
    importFile.value = null
    return
  }
  if (file.size <= 0) {
    operationError.value = '不能导入空文件'
    input.value = ''
    return
  }
  if (file.size > MAX_FILE_SIZE) {
    operationError.value = '文件不能超过 50 MiB'
    input.value = ''
    return
  }
  importFile.value = file
}

function clearFile() {
  importFile.value = null
  if (fileInput.value) fileInput.value.value = ''
}

async function startOperation() {
  if (!operationKnowledgeBaseId.value) return
  starting.value = true
  operationError.value = ''

  try {
    let task: TransferTask
    if (operationTab.value === 'IMPORT') {
      if (!importFile.value) throw new Error('请选择要导入的文件')
      const form = new FormData()
      form.append('knowledgeBaseId', operationKnowledgeBaseId.value)
      if (importFormat.value !== 'AUTO') form.append('format', importFormat.value)
      form.append('file', importFile.value)
      task = await upload<TransferTask>('/api/v1/content-transfers/imports/upload', form)
    } else {
      task = await post<TransferTask>('/api/v1/content-transfers/exports/knowledge-base', {
        knowledgeBaseId: operationKnowledgeBaseId.value,
      })
    }

    tasks.value = mergeTasks([task], tasks.value)
    operationOpen.value = false
    ui.notify(operationTab.value === 'IMPORT' ? '文件已加入导入队列' : '知识库导出任务已创建')
    await pollActiveTasks()
  } catch (value) {
    operationError.value = messageOf(value)
  } finally {
    starting.value = false
  }
}

async function cancelTask() {
  const target = cancelTarget.value
  if (!target) return
  cancelling.value = true
  cancelError.value = ''
  try {
    const updated = await post<TransferTask>('/api/v1/content-transfers/cancel', { taskId: target.id })
    tasks.value = tasks.value.map((task) => task.id === updated.id ? updated : task)
    cancelTarget.value = null
    ui.notify(updated.status === 'CANCELLED' ? '任务已取消' : '已提交取消请求')
  } catch (value) {
    cancelError.value = messageOf(value)
  } finally {
    cancelling.value = false
  }
}

function mergeTasks(first: TransferTask[], second: TransferTask[]) {
  const result: TransferTask[] = []
  const seen = new Set<string>()
  for (const task of [...first, ...second]) {
    if (!seen.has(task.id)) {
      seen.add(task.id)
      result.push(task)
    }
  }
  return result
}

function isActive(task: TransferTask) {
  return task.status === 'PENDING' || task.status === 'RUNNING'
}

function taskLabel(task: TransferTask) {
  if (task.taskType === 'IMPORT') return task.originalFilename || '导入文件'
  return task.resultFilename || (task.resourceType === 'PAGE' ? '文档导出' : '知识库导出')
}

function taskDescription(task: TransferTask) {
  const action = task.taskType === 'IMPORT' ? '导入到知识库' : task.resourceType === 'PAGE' ? '导出文档' : '导出知识库'
  return `${action} · ${formatTime(task.createdAt)}`
}

function statusLabel(task: TransferTask) {
  if (task.cancelRequested && task.status !== 'CANCELLED') return '正在取消'
  return ({ PENDING: '等待中', RUNNING: '处理中', SUCCEEDED: '已完成', FAILED: '失败', CANCELLED: '已取消' } as const)[task.status]
}

function statusColor(status: TransferTask['status']) {
  return ({ PENDING: 'warning', RUNNING: 'info', SUCCEEDED: 'success', FAILED: 'error', CANCELLED: 'secondary' } as const)[status]
}

function statusIcon(status: TransferTask['status']) {
  return ({
    PENDING: 'mdi-clock-outline',
    RUNNING: 'mdi-progress-clock',
    SUCCEEDED: 'mdi-check-circle-outline',
    FAILED: 'mdi-alert-circle-outline',
    CANCELLED: 'mdi-cancel',
  } as const)[status]
}

function reportSummary(task: TransferTask) {
  if (task.report?.error) return task.report.error
  if (task.status === 'CANCELLED') return '未完成的输入与产物已清理。'
  if (task.taskType === 'IMPORT' && task.status === 'SUCCEEDED') return `成功导入 ${task.report.importedCount ?? 0} 篇，失败 ${task.report.failedCount ?? 0} 篇。`
  if (task.taskType === 'EXPORT' && task.status === 'SUCCEEDED') {
    const count = task.resourceType === 'KNOWLEDGE_BASE' && task.report.pageCount !== undefined ? `，包含 ${task.report.pageCount} 篇内容` : ''
    return `已生成 ${formatBytes(task.artifactSize)}${count}。`
  }
  return task.status === 'PENDING' ? '任务正在等待后台处理。' : `当前进度 ${boundedProgress(task.progress)}%。`
}

function boundedProgress(value: number) {
  return Math.min(100, Math.max(0, value || 0))
}

function canDownload(task: TransferTask) {
  return task.taskType === 'EXPORT' && task.status === 'SUCCEEDED' && (!task.expiresAt || new Date(task.expiresAt).getTime() > Date.now())
}

function downloadUrl(taskId: string) {
  return `/api/v1/content-transfers/download?taskId=${encodeURIComponent(taskId)}`
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / 1024 / 1024).toFixed(1)} MiB`
}
</script>

<template>
  <main class="transfers-view">
    <header class="transfers-header">
      <div>
        <h1>导入与导出</h1>
        <p>导入外部内容，或将知识库导出为可下载文件。</p>
      </div>
      <div class="heading-actions">
        <v-btn variant="text" size="small" prepend-icon="mdi-refresh" :loading="refreshing" @click="loadTasks(true, true)">刷新</v-btn>
        <v-menu>
          <template #activator="{ props }">
            <v-btn v-bind="props" color="primary" size="small" prepend-icon="mdi-plus">新建任务</v-btn>
          </template>
          <v-list>
            <v-list-item prepend-icon="mdi-file-upload-outline" title="导入到知识库" subtitle="上传 Markdown、Office 或平台导出包" @click="openOperation('IMPORT')" />
            <v-list-item prepend-icon="mdi-folder-download-outline" title="导出知识库" subtitle="生成包含 Markdown 与清单的 ZIP" @click="openOperation('EXPORT')" />
          </v-list>
        </v-menu>
      </div>
    </header>

    <div class="transfers-body">
      <div class="summary-line" aria-label="任务摘要">
        <span><small>导入</small><strong>{{ summary.imports }}</strong></span>
        <span><small>导出</small><strong>{{ summary.exports }}</strong></span>
        <span :class="{ highlighted: summary.active }"><small>处理中</small><strong>{{ summary.active }}</strong></span>
        <span :class="{ failed: summary.failed }"><small>失败</small><strong>{{ summary.failed }}</strong></span>
      </div>

      <section class="transfer-stage">
      <div class="transfer-toolbar">
        <v-tabs v-model="filter" color="primary" density="compact" show-arrows>
          <v-tab value="ALL">全部</v-tab>
          <v-tab value="IMPORT">导入</v-tab>
          <v-tab value="EXPORT">导出</v-tab>
          <v-tab value="FAILED">失败</v-tab>
          <v-tab value="CANCELLED">已取消</v-tab>
        </v-tabs>
        <v-spacer />
        <span v-if="activeTasks.length" class="auto-update"><v-icon size="14">mdi-sync</v-icon>自动更新中</span>
      </div>
      <v-progress-linear v-if="loading" indeterminate color="primary" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="transfer-error">
        {{ error }}
        <template #append><v-btn variant="text" size="small" @click="loadTasks(true)">重试</v-btn></template>
      </v-alert>

      <v-list v-if="visibleTasks.length" class="task-list">
        <template v-for="task in visibleTasks" :key="task.id">
          <v-list-item class="task-row" @click="expandedTaskId = expandedTaskId === task.id ? '' : task.id">
            <template #prepend>
              <v-avatar size="34" :color="statusColor(task.status)" variant="tonal"><v-icon size="18">{{ statusIcon(task.status) }}</v-icon></v-avatar>
            </template>
            <v-list-item-title class="task-title">
              <strong>{{ taskLabel(task) }}</strong>
              <v-chip size="x-small" variant="tonal">{{ task.sourceFormat }}</v-chip>
            </v-list-item-title>
            <v-list-item-subtitle>{{ taskDescription(task) }}</v-list-item-subtitle>
            <template #append>
              <div class="task-actions" @click.stop>
                <div class="task-status">
                  <v-chip :color="statusColor(task.status)" size="x-small" variant="tonal">{{ statusLabel(task) }}</v-chip>
                  <small v-if="task.status === 'SUCCEEDED' && task.taskType === 'IMPORT'">{{ task.report.importedCount ?? 0 }} 篇</small>
                  <small v-else-if="task.status === 'SUCCEEDED' && task.taskType === 'EXPORT'">{{ formatBytes(task.artifactSize) }}</small>
                </div>
                <v-btn v-if="canDownload(task)" :href="downloadUrl(task.id)" icon="mdi-download" size="small" variant="text" color="primary" aria-label="下载导出文件" />
                <v-tooltip v-else-if="task.taskType === 'EXPORT' && task.status === 'SUCCEEDED'" text="导出文件已过期">
                  <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-download-off-outline" size="small" variant="text" disabled aria-label="导出文件已过期" /></template>
                </v-tooltip>
                <v-btn v-if="isActive(task)" icon="mdi-close-circle-outline" size="small" variant="text" color="error" :disabled="task.cancelRequested" aria-label="取消任务" @click="cancelTarget = task; cancelError = ''" />
                <v-btn :icon="expandedTaskId === task.id ? 'mdi-chevron-up' : 'mdi-chevron-down'" size="small" variant="text" aria-label="查看任务详情" @click="expandedTaskId = expandedTaskId === task.id ? '' : task.id" />
              </div>
            </template>
          </v-list-item>
          <v-expand-transition>
            <div v-if="expandedTaskId === task.id" class="task-detail">
              <v-progress-linear v-if="isActive(task)" :model-value="boundedProgress(task.progress)" color="primary" rounded height="7" class="mb-3" />
              <p>{{ reportSummary(task) }}</p>
              <div class="task-detail-grid">
                <span><small>任务编号</small><code>{{ task.id }}</code></span>
                <span><small>资源类型</small><strong>{{ task.resourceType === 'PAGE' ? '文档' : '知识库' }}</strong></span>
                <span v-if="task.startedAt"><small>开始时间</small><strong>{{ formatTime(task.startedAt) }}</strong></span>
                <span v-if="task.completedAt"><small>完成时间</small><strong>{{ formatTime(task.completedAt) }}</strong></span>
                <span v-if="task.expiresAt"><small>文件有效期</small><strong>{{ formatTime(task.expiresAt) }}</strong></span>
              </div>
            </div>
          </v-expand-transition>
          <v-divider />
        </template>
      </v-list>

      <div v-else-if="!loading" class="transfer-empty">
        <div>
          <v-icon size="38">mdi-archive-arrow-down-outline</v-icon>
          <h2>暂无{{ filter === 'ALL' ? '' : '匹配的' }}任务</h2>
          <p>{{ filter === 'ALL' ? '上传文件或导出知识库后，处理进度会出现在这里。' : '切换筛选条件查看其他迁移任务。' }}</p>
          <v-btn v-if="filter === 'ALL'" color="primary" prepend-icon="mdi-file-upload-outline" @click="openOperation('IMPORT')">开始导入</v-btn>
          <v-btn v-else variant="tonal" @click="filter = 'ALL'">查看全部</v-btn>
        </div>
      </div>

      <div v-if="hasMore" class="load-more">
        <v-btn variant="text" size="small" :loading="loadingMore" prepend-icon="mdi-chevron-down" @click="loadTasks(false)">加载更多任务</v-btn>
      </div>
      </section>
    </div>

    <v-dialog v-model="operationOpen" max-width="620" :persistent="starting">
      <v-card rounded="lg">
        <v-card-title class="operation-title">
          <span>新建迁移任务</span>
          <v-spacer /><v-btn icon="mdi-close" size="small" variant="text" aria-label="关闭新建任务" :disabled="starting" @click="operationOpen = false" />
        </v-card-title>
        <v-card-text class="operation-body">
          <v-tabs v-model="operationTab" color="primary" density="compact" grow class="operation-tabs">
            <v-tab value="IMPORT" prepend-icon="mdi-file-upload-outline">导入内容</v-tab>
            <v-tab value="EXPORT" prepend-icon="mdi-folder-download-outline">导出知识库</v-tab>
          </v-tabs>
          <div class="operation-selectors">
            <v-select v-model="operationWorkspaceId" :items="workspaces" item-title="name" item-value="id" label="工作区" density="comfortable" variant="outlined" prepend-inner-icon="mdi-domain" @update:model-value="loadKnowledgeBases" />
            <v-select v-model="operationKnowledgeBaseId" :items="knowledgeBases" item-title="name" item-value="id" label="知识库" density="comfortable" variant="outlined" prepend-inner-icon="mdi-book-open-page-variant-outline" :loading="knowledgeBasesLoading" :disabled="!operationWorkspaceId" />
          </div>

          <template v-if="operationTab === 'IMPORT'">
            <button type="button" class="upload-zone" :disabled="starting" @click="fileInput?.click()">
              <v-icon size="28" color="primary">mdi-cloud-upload-outline</v-icon>
              <strong>{{ importFile?.name || '选择要导入的文件' }}</strong>
              <small v-if="importFile">{{ formatBytes(importFile.size) }} · 点击重新选择</small>
              <small v-else>Markdown、HTML、TXT、ZIP、DOCX、XLSX、Notion 或 Confluence，最大 50 MiB</small>
            </button>
            <input ref="fileInput" class="sr-file-input" type="file" accept=".md,.markdown,.html,.htm,.txt,.zip,.docx,.xlsx" @change="chooseFile">
            <div v-if="importFile" class="selected-file">
              <v-icon>mdi-file-check-outline</v-icon><span>{{ importFile.name }}</span><v-spacer /><v-btn icon="mdi-close" variant="text" size="small" aria-label="移除文件" @click="clearFile" />
            </div>
            <v-select v-model="importFormat" :items="importFormats" item-title="title" item-value="value" label="文件格式" density="comfortable" variant="outlined" hint="自动识别会根据文件扩展名判断；平台导出包请选择对应格式。" persistent-hint />
          </template>
          <v-alert v-else type="info" variant="tonal" icon="mdi-folder-zip-outline">
            将“{{ selectedKnowledgeBase?.name || '所选知识库' }}”中的未删除内容转换为 Markdown，并连同 manifest.json 打包为 ZIP。生成文件保留 7 天。
          </v-alert>
          <v-alert v-if="!knowledgeBasesLoading && operationWorkspaceId && !knowledgeBases.length" type="warning" variant="tonal" class="mt-4">此工作区没有可用知识库。</v-alert>
          <v-alert v-if="operationError" type="error" variant="tonal" class="mt-4">{{ operationError }}</v-alert>
        </v-card-text>
        <v-card-actions class="operation-actions">
          <v-spacer />
          <v-btn variant="text" :disabled="starting" @click="operationOpen = false">取消</v-btn>
          <v-btn
            color="primary"
            :prepend-icon="operationTab === 'IMPORT' ? 'mdi-file-upload-outline' : 'mdi-folder-download-outline'"
            :loading="starting"
            :disabled="!operationKnowledgeBaseId || (operationTab === 'IMPORT' && !importFile)"
            @click="startOperation"
          >{{ operationTab === 'IMPORT' ? '开始导入' : '开始导出' }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(cancelTarget)" max-width="430" :persistent="cancelling" @update:model-value="value => { if (!value && !cancelling) cancelTarget = null }">
      <v-card rounded="lg">
        <v-card-title class="cancel-title">取消任务？</v-card-title>
        <v-card-text class="cancel-body">
          “{{ cancelTarget ? taskLabel(cancelTarget) : '' }}”尚未完成。取消后，未完成的导入不会保留，尚未生成的导出文件会被清理。
          <v-alert v-if="cancelError" type="error" variant="tonal" class="mt-4">{{ cancelError }}</v-alert>
        </v-card-text>
        <v-card-actions class="cancel-actions"><v-spacer /><v-btn variant="text" :disabled="cancelling" @click="cancelTarget = null">返回</v-btn><v-btn color="error" variant="flat" :loading="cancelling" @click="cancelTask">取消任务</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.transfers-view { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.transfers-view :deep(.v-btn), .transfers-view :deep(.v-tab) { text-transform: none; letter-spacing: 0; }
.transfers-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.transfers-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.transfers-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.heading-actions { display: flex; align-items: center; gap: 4px; }
.transfers-body { width: min(1060px, calc(100% - 48px)); margin: 22px auto 64px; }
.summary-line { min-height: 54px; margin-bottom: 18px; border: 1px solid #e7e9e8; border-radius: 8px; display: flex; align-items: stretch; background: #fafbfa; }
.summary-line > span { min-width: 118px; padding: 0 18px; border-right: 1px solid #e7e9e8; display: flex; align-items: center; gap: 9px; }
.summary-line > span:last-child { border-right: 0; }
.summary-line small { color: #858c88; font-size: 12px; }
.summary-line strong { color: #3d4440; font-size: 15px; font-weight: 650; }
.summary-line .highlighted strong { color: #2472d8; }
.summary-line .failed strong { color: #d14343; }
.transfer-stage { border-top: 1px solid #e9ebea; }
.transfer-toolbar { height: 49px; border-bottom: 1px solid #e9ebea; display: flex; align-items: center; gap: 12px; }
.transfer-toolbar :deep(.v-tabs) { height: 49px; }
.transfer-toolbar :deep(.v-tab) { min-width: 68px; padding: 0 12px; font-size: 13px; }
.auto-update { margin-right: 6px; display: inline-flex; align-items: center; gap: 4px; color: #70837a; font-size: 11px; }
.transfer-error { margin: 12px 0; }
.task-list { padding: 0; background: transparent; }
.task-row { min-height: 66px; padding: 6px 4px; border-radius: 0; }
.task-row:hover { background: #fafbfa; }
.task-row :deep(.v-list-item__prepend) { margin-right: 11px; }
.task-title { display: flex; align-items: center; gap: 7px; }
.task-title strong { overflow: hidden; color: #333936; font-size: 13px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.task-row :deep(.v-list-item-subtitle) { margin-top: 3px; color: #969c99; font-size: 11px; opacity: 1; }
.task-actions { display: flex; align-items: center; gap: 1px; }
.task-status { display: grid; min-width: 64px; justify-items: end; gap: 2px; margin-right: 4px; }
.task-status small { color: #969c99; font-size: 10px; }
.task-detail { margin: 0 8px 10px 50px; padding: 11px 14px 13px; border-left: 2px solid #e0e5e2; background: #fafbfa; }
.task-detail > p { margin: 0 0 10px; color: #676e6a; font-size: 12px; }
.task-detail-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 8px 18px; }
.task-detail-grid span { display: grid; min-width: 0; }
.task-detail-grid small { color: #9a9f9d; font-size: 10px; }
.task-detail-grid code, .task-detail-grid strong { overflow: hidden; color: #565d59; font-size: 11px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.transfer-empty { min-height: 310px; display: grid; place-content: center; color: #a9afac; text-align: center; }
.transfer-empty h2 { margin: 12px 0 4px; color: #616864; font-size: 15px; font-weight: 600; }
.transfer-empty p { margin: 0 0 16px; color: #949a97; font-size: 12px; }
.load-more { padding: 18px 0; display: flex; justify-content: center; }
.operation-title { min-height: 60px; padding: 0 12px 0 20px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; font-size: 16px; font-weight: 650; }
.operation-body { padding: 0 22px 4px; }
.operation-tabs { margin: 0 0 18px; }
.operation-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.upload-zone { width: 100%; min-height: 108px; margin-bottom: 12px; padding: 15px; border: 1px dashed #b9cceb; border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; color: #414844; background: #f8faff; cursor: pointer; font: inherit; transition: border-color .16s, background .16s; }
.upload-zone:hover { border-color: #6d9de8; background: #f3f7ff; }
.upload-zone strong { font-size: 13px; font-weight: 600; }
.upload-zone small { color: #8e9692; font-size: 11px; text-align: center; }
.sr-file-input { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.selected-file { min-height: 38px; margin: -4px 0 12px; padding: 2px 3px 2px 10px; border-radius: 7px; display: flex; align-items: center; gap: 8px; color: #565d59; background: #f2f4f3; font-size: 12px; }
.operation-actions { padding: 12px 16px 16px; }
.cancel-title { padding: 21px 22px 8px; font-size: 17px; font-weight: 650; }
.cancel-body { padding: 10px 22px 4px; color: #606763; font-size: 13px; line-height: 1.7; }
.cancel-actions { padding: 12px 16px 16px; }
@media (max-width: 960px) { .task-status { display: none; } }
@media (max-width: 700px) {
  .transfers-view { margin: -16px; }
  .transfers-header { padding: 0 18px; }
  .transfers-body { width: calc(100% - 28px); margin-top: 14px; }
  .summary-line { overflow-x: auto; }
  .summary-line > span { min-width: 100px; padding: 0 13px; }
  .auto-update { display: none; }
  .task-row :deep(.v-list-item__prepend) { display: none; }
  .task-detail { margin-left: 8px; }
  .operation-selectors { grid-template-columns: 1fr; }
}
</style>
