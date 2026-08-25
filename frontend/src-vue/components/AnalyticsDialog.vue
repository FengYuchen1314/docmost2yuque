<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AnalyticsReport, DailyMetric } from '../../src/types'
import { download, messageOf, post } from '../services/api'

type Preset = 7 | 30 | 90 | 365 | 'CUSTOM'
type MetricKey = Exclude<keyof DailyMetric, 'date'>

interface MetricDefinition {
  key: MetricKey
  label: string
  icon: string
  color: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  pageId?: string
  knowledgeBaseId?: string
  title?: string
}>(), {
  pageId: '',
  knowledgeBaseId: '',
  title: '',
})

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  exported: [report: AnalyticsReport]
}>()

const metrics: MetricDefinition[] = [
  { key: 'views', label: '浏览', icon: 'mdi-eye-outline', color: 'primary' },
  { key: 'uniqueViews', label: '访客', icon: 'mdi-account-multiple-outline', color: 'indigo' },
  { key: 'edits', label: '编辑', icon: 'mdi-pencil-outline', color: 'teal' },
  { key: 'comments', label: '评论', icon: 'mdi-comment-text-outline', color: 'cyan' },
  { key: 'shares', label: '分享', icon: 'mdi-share-variant-outline', color: 'deep-purple' },
  { key: 'exports', label: '导出', icon: 'mdi-download-outline', color: 'orange' },
  { key: 'reactions', label: '互动', icon: 'mdi-heart-outline', color: 'pink' },
]

const today = utcToday()
const preset = ref<Preset>(30)
const from = ref(subtractDays(today, 29))
const to = ref(today)
const report = ref<AnalyticsReport | null>(null)
const selectedMetric = ref<MetricKey>('views')
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const exportError = ref('')
let requestSequence = 0

const isKnowledgeBase = computed(() => Boolean(props.knowledgeBaseId))
const resourceId = computed(() => props.knowledgeBaseId || props.pageId)
const endpoint = computed(() => isKnowledgeBase.value ? 'knowledge-base' : 'page')
const resourceKey = computed(() => isKnowledgeBase.value ? 'knowledgeBaseId' : 'pageId')
const panelTitle = computed(() => props.title || (isKnowledgeBase.value ? '知识库统计' : '文档统计'))
const resourceConfigurationError = computed(() => {
  if (props.pageId && props.knowledgeBaseId) return 'AnalyticsDialog 一次只能统计一个页面或一个知识库。'
  if (!resourceId.value) return '缺少页面或知识库 ID。'
  return ''
})
const dateRangeError = computed(() => validateRange(from.value, to.value))
const activeMetric = computed(() => metrics.find((metric) => metric.key === selectedMetric.value) ?? metrics[0]!)
const maxMetricValue = computed(() => Math.max(1, ...(report.value?.daily.map((item) => Number(item[selectedMetric.value]) || 0) ?? [1])))
const totalDays = computed(() => report.value?.daily.length ?? 0)

watch(
  [() => props.modelValue, resourceId, endpoint],
  ([open]) => {
    if (open) void loadReport()
  },
  { immediate: true },
)

watch(preset, (value) => {
  if (value === 'CUSTOM') return
  to.value = today
  from.value = subtractDays(to.value, value - 1)
  if (props.modelValue) void loadReport()
})

async function loadReport() {
  if (resourceConfigurationError.value || dateRangeError.value) return
  const sequence = ++requestSequence
  loading.value = true
  error.value = ''
  exportError.value = ''
  try {
    const body = { [resourceKey.value]: resourceId.value, from: from.value, to: to.value }
    const value = await post<AnalyticsReport>(`/api/v1/analytics/${endpoint.value}`, body)
    if (sequence === requestSequence) report.value = value
  } catch (value) {
    if (sequence === requestSequence) error.value = messageOf(value)
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

async function exportCsv() {
  if (!report.value || resourceConfigurationError.value || dateRangeError.value) return
  exporting.value = true
  exportError.value = ''
  try {
    await download(`/api/v1/analytics/${endpoint.value}/export`, {
      [resourceKey.value]: resourceId.value,
      from: from.value,
      to: to.value,
    })
    emit('exported', report.value)
  } catch (value) {
    exportError.value = messageOf(value)
  } finally {
    exporting.value = false
  }
}

function close() {
  if (!exporting.value) emit('update:modelValue', false)
}

function applyCustomRange() {
  preset.value = 'CUSTOM'
  void loadReport()
}

function metricValue(item: DailyMetric) {
  return Number(item[selectedMetric.value]) || 0
}

function barHeight(item: DailyMetric) {
  const value = metricValue(item)
  return value === 0 ? 2 : Math.max(5, value / maxMetricValue.value * 100)
}

function showDateLabel(index: number) {
  const count = totalDays.value
  if (count <= 14) return true
  const step = count <= 31 ? 5 : count <= 100 ? 14 : 30
  return index === 0 || index === count - 1 || index % step === 0
}

function metricTotal(metric: MetricKey) {
  return Number(report.value?.totals[metric]) || 0
}

function validateRange(start: string, end: string) {
  if (!start || !end) return '请选择完整的开始和结束日期。'
  const startTime = Date.parse(`${start}T00:00:00Z`)
  const endTime = Date.parse(`${end}T00:00:00Z`)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return '日期格式无效。'
  if (startTime > endTime) return '开始日期不能晚于结束日期。'
  const days = Math.floor((endTime - startTime) / 86_400_000) + 1
  if (days > 366) return '统计范围不能超过 366 天。'
  return ''
}

function utcToday() {
  return new Date().toISOString().slice(0, 10)
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="1040" :persistent="exporting" scrollable @update:model-value="value => { if (!value) close() }">
    <v-card rounded="xl" class="analytics-dialog">
      <v-card-title class="analytics-header pa-5 pa-md-6">
        <div>
          <div class="text-overline text-primary">内容数据</div>
          <h2>{{ panelTitle }}</h2>
          <p v-if="report">{{ report.from }} 至 {{ report.to }} · 共 {{ report.daily.length }} 天</p>
        </div>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" :aria-label="`关闭${panelTitle}`" :disabled="exporting" @click="close" />
      </v-card-title>
      <v-divider />
      <v-card-text class="analytics-body pa-5 pa-md-6">
        <v-alert v-if="resourceConfigurationError" type="error" variant="tonal" class="mb-5">{{ resourceConfigurationError }}</v-alert>

        <div v-else class="range-toolbar mb-5">
          <v-btn-toggle v-model="preset" mandatory color="primary" variant="outlined" divided>
            <v-btn :value="7">7 天</v-btn><v-btn :value="30">30 天</v-btn><v-btn :value="90">90 天</v-btn><v-btn :value="365">近一年</v-btn><v-btn value="CUSTOM">自定义</v-btn>
          </v-btn-toggle>
          <div v-if="preset === 'CUSTOM'" class="custom-range">
            <v-text-field v-model="from" type="date" label="开始日期" density="compact" hide-details />
            <span>至</span>
            <v-text-field v-model="to" type="date" label="结束日期" density="compact" hide-details />
            <v-btn color="primary" variant="tonal" :disabled="Boolean(dateRangeError)" @click="applyCustomRange">应用</v-btn>
          </div>
          <v-spacer />
          <v-btn icon="mdi-refresh" variant="text" :loading="loading" aria-label="刷新统计" @click="loadReport" />
        </div>
        <v-alert v-if="preset === 'CUSTOM' && dateRangeError" type="warning" variant="tonal" density="compact" class="mb-5">{{ dateRangeError }}</v-alert>
        <v-alert v-if="error" type="error" variant="tonal" class="mb-5">{{ error }}<template #append><v-btn variant="text" size="small" @click="loadReport">重试</v-btn></template></v-alert>

        <template v-if="loading && !report && !resourceConfigurationError">
          <div class="metrics-grid mb-6"><v-skeleton-loader v-for="index in 7" :key="index" type="list-item-avatar-two-line" class="metric-skeleton" /></div>
          <v-skeleton-loader type="image" height="290" />
        </template>

        <template v-else-if="report && !resourceConfigurationError">
          <div class="metrics-grid mb-6" role="list" aria-label="统计指标">
            <button v-for="metric in metrics" :key="metric.key" type="button" class="metric-card" :class="{ active: selectedMetric === metric.key }" role="listitem" @click="selectedMetric = metric.key">
              <v-avatar :color="metric.color" variant="tonal" size="38"><v-icon size="20">{{ metric.icon }}</v-icon></v-avatar>
              <div><strong>{{ metricTotal(metric.key).toLocaleString('zh-CN') }}</strong><small>{{ metric.label }}</small></div>
              <v-icon v-if="selectedMetric === metric.key" color="primary" size="18">mdi-chart-bar</v-icon>
            </button>
          </div>

          <v-card class="chart-card" variant="outlined" rounded="xl">
            <v-card-title class="chart-heading pa-5">
              <div><v-icon color="primary" class="mr-2">mdi-chart-timeline-variant</v-icon><strong>每日{{ activeMetric.label }}</strong></div>
              <v-chip size="small" variant="tonal">峰值 {{ maxMetricValue.toLocaleString('zh-CN') }}</v-chip>
            </v-card-title>
            <v-divider />
            <div v-if="report.daily.length" class="chart-scroll">
              <div class="bar-chart" :style="{ minWidth: `${Math.max(640, report.daily.length * 18)}px` }">
                <div v-for="(item, index) in report.daily" :key="item.date" class="bar-column" :title="`${item.date} · ${metricValue(item)} ${activeMetric.label}`">
                  <span class="bar-value">{{ metricValue(item) || '' }}</span>
                  <i :style="{ height: `${barHeight(item)}%` }" />
                  <small>{{ showDateLabel(index) ? item.date.slice(5) : '' }}</small>
                </div>
              </div>
            </div>
            <div v-else class="chart-empty"><v-icon size="42">mdi-chart-bell-curve-cumulative</v-icon><strong>这个周期还没有数据</strong><p>发生浏览、编辑、评论或分享后会显示趋势。</p></div>
          </v-card>
        </template>

        <v-alert v-if="exportError" type="error" variant="tonal" class="mt-5">{{ exportError }}</v-alert>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-5 pa-md-6">
        <small class="text-medium-emphasis">CSV 由服务器生成，包含每天的全部七项指标。</small>
        <v-spacer />
        <v-btn variant="text" :disabled="exporting" @click="close">关闭</v-btn>
        <v-btn color="primary" prepend-icon="mdi-file-delimited-outline" :loading="exporting" :disabled="!report || Boolean(dateRangeError) || Boolean(resourceConfigurationError)" @click="exportCsv">导出 CSV</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.analytics-header { display: flex; align-items: center; }
.analytics-header h2 { margin: 0; font-size: 1.25rem; }
.analytics-header p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface), .55); font-size: .8rem; }
.analytics-body { min-height: 520px; }
.range-toolbar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.custom-range { display: flex; align-items: center; gap: 8px; flex: 1 1 430px; }
.custom-range .v-text-field { max-width: 190px; }
.metrics-grid { display: grid; grid-template-columns: repeat(7, minmax(108px, 1fr)); gap: 10px; }
.metric-card { min-width: 0; min-height: 78px; display: flex; align-items: center; gap: 10px; padding: 12px; border: 1px solid rgb(var(--v-theme-on-surface), .09); border-radius: 14px; background: rgb(var(--v-theme-surface)); color: inherit; text-align: left; font: inherit; cursor: pointer; transition: .15s ease; }
.metric-card:hover { border-color: rgb(var(--v-theme-primary), .32); transform: translateY(-1px); }
.metric-card.active { border-color: rgb(var(--v-theme-primary), .45); background: rgb(var(--v-theme-primary), .045); box-shadow: 0 6px 20px rgba(15, 23, 42, .05); }
.metric-card > div { display: grid; min-width: 0; flex: 1; }
.metric-card strong { overflow: hidden; text-overflow: ellipsis; font-size: 1.15rem; }
.metric-card small { color: rgb(var(--v-theme-on-surface), .52); }
.metric-skeleton { border: 1px solid rgb(var(--v-theme-on-surface), .08); border-radius: 14px; }
.chart-card { overflow: hidden; }
.chart-heading { display: flex; align-items: center; justify-content: space-between; font-size: .95rem; }
.chart-scroll { overflow-x: auto; padding: 22px 18px 8px; }
.bar-chart { height: 270px; display: flex; align-items: flex-end; gap: 3px; padding-top: 24px; }
.bar-column { position: relative; height: 230px; flex: 1 0 12px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 5px; }
.bar-column i { width: min(12px, 80%); min-height: 2px; border-radius: 5px 5px 2px 2px; background: linear-gradient(180deg, rgb(var(--v-theme-primary)), rgb(var(--v-theme-primary), .58)); transition: height .25s ease; }
.bar-column small { height: 16px; color: rgb(var(--v-theme-on-surface), .45); font-size: .64rem; white-space: nowrap; }
.bar-value { position: absolute; bottom: calc(var(--bar-height, 0%) + 20px); color: rgb(var(--v-theme-on-surface), .5); font-size: .62rem; opacity: 0; transition: opacity .12s ease; }
.bar-column:hover .bar-value { opacity: 1; }
.chart-empty { min-height: 290px; display: flex; flex-direction: column; align-items: center; justify-content: center; color: rgb(var(--v-theme-on-surface), .52); }
.chart-empty strong { margin-top: 10px; color: rgb(var(--v-theme-on-surface)); }
.chart-empty p { margin: 5px 0 0; }
@media (max-width: 980px) {
  .metrics-grid { grid-template-columns: repeat(4, minmax(120px, 1fr)); }
}
@media (max-width: 700px) {
  .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .custom-range { align-items: stretch; flex-direction: column; }
  .custom-range .v-text-field { max-width: none; }
  .custom-range > span { display: none; }
}
</style>
