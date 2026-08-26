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
  { key: 'views', label: '浏览', icon: 'mdi-eye-outline' },
  { key: 'uniqueViews', label: '访客', icon: 'mdi-account-multiple-outline' },
  { key: 'edits', label: '编辑', icon: 'mdi-pencil-outline' },
  { key: 'comments', label: '评论', icon: 'mdi-comment-text-outline' },
  { key: 'shares', label: '分享', icon: 'mdi-share-variant-outline' },
  { key: 'exports', label: '导出', icon: 'mdi-download-outline' },
  { key: 'reactions', label: '互动', icon: 'mdi-heart-outline' },
]

const presetItems: Array<{ value: Preset; label: string }> = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 365, label: '近一年' },
  { value: 'CUSTOM', label: '自定义' },
]

const today = localToday()
const preset = ref<Preset>(30)
const from = ref(subtractDays(today, 29))
const to = ref(today)
const report = ref<AnalyticsReport | null>(null)
const selectedMetric = ref<MetricKey>('views')
const loading = ref(false)
const exporting = ref(false)
const error = ref('')
const exportError = ref('')
const reportQueryKey = ref('')
let requestSequence = 0

const isKnowledgeBase = computed(() => Boolean(props.knowledgeBaseId))
const resourceId = computed(() => props.knowledgeBaseId || props.pageId)
const endpoint = computed(() => isKnowledgeBase.value ? 'knowledge-base' : 'page')
const resourceKey = computed(() => isKnowledgeBase.value ? 'knowledgeBaseId' : 'pageId')
const queryKey = computed(() => `${endpoint.value}:${resourceId.value}:${from.value}:${to.value}`)
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
    invalidateReport()
    if (open) void loadReport()
  },
  { immediate: true },
)

watch(preset, (value) => {
  if (value === 'CUSTOM') {
    invalidateReport()
    return
  }
  to.value = today
  from.value = subtractDays(to.value, value - 1)
  if (props.modelValue) void loadReport()
})

watch([from, to], () => {
  if (preset.value === 'CUSTOM') invalidateReport()
})

async function loadReport() {
  if (resourceConfigurationError.value || dateRangeError.value) {
    invalidateReport()
    return
  }
  const sequence = ++requestSequence
  const requestedQueryKey = queryKey.value
  report.value = null
  reportQueryKey.value = ''
  loading.value = true
  error.value = ''
  exportError.value = ''
  try {
    const body = { [resourceKey.value]: resourceId.value, from: from.value, to: to.value }
    const value = await post<AnalyticsReport>(`/api/v1/analytics/${endpoint.value}`, body)
    if (!value || typeof value !== 'object' || !value.totals || !Array.isArray(value.daily)) throw new Error('统计响应格式无效，请重新加载')
    if (sequence === requestSequence && requestedQueryKey === queryKey.value) {
      report.value = value
      reportQueryKey.value = requestedQueryKey
    }
  } catch (value) {
    if (sequence === requestSequence) error.value = messageOf(value)
  } finally {
    if (sequence === requestSequence) loading.value = false
  }
}

async function exportCsv() {
  if (!report.value || reportQueryKey.value !== queryKey.value || resourceConfigurationError.value || dateRangeError.value) return
  const exportedReport = report.value
  const exportedQueryKey = queryKey.value
  const exportedEndpoint = endpoint.value
  const exportedResourceKey = resourceKey.value
  const exportedResourceId = resourceId.value
  const exportedFrom = from.value
  const exportedTo = to.value
  exporting.value = true
  exportError.value = ''
  try {
    await download(`/api/v1/analytics/${exportedEndpoint}/export`, {
      [exportedResourceKey]: exportedResourceId,
      from: exportedFrom,
      to: exportedTo,
    })
    if (exportedQueryKey === queryKey.value) emit('exported', exportedReport)
  } catch (value) {
    exportError.value = messageOf(value)
  } finally {
    exporting.value = false
  }
}

function invalidateReport() {
  requestSequence += 1
  report.value = null
  reportQueryKey.value = ''
  loading.value = false
  error.value = ''
  exportError.value = ''
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

function localToday() {
  const value = new Date()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${value.getFullYear()}-${month}-${day}`
}

function subtractDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() - days)
  return date.toISOString().slice(0, 10)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="920"
    :persistent="exporting"
    scrollable
    content-class="analytics-dialog-overlay"
    @update:model-value="value => { if (!value) close() }"
  >
    <v-card rounded="lg" class="analytics-dialog" elevation="0">
      <header class="analytics-header">
        <div class="analytics-heading">
          <h2>{{ panelTitle }}</h2>
          <span v-if="report">{{ report.from }} – {{ report.to }} · {{ report.daily.length }} 天</span>
          <span v-else>内容数据</span>
        </div>
        <div class="header-actions">
          <v-btn icon="mdi-refresh" size="small" density="compact" variant="text" :loading="loading" aria-label="刷新统计" @click="loadReport" />
          <v-btn icon="mdi-close" size="small" density="compact" variant="text" :aria-label="`关闭${panelTitle}`" :disabled="exporting" @click="close" />
        </div>
      </header>
      <v-progress-linear v-if="loading" class="dialog-progress" indeterminate color="primary" height="2" />

      <v-card-text class="analytics-body">
        <div v-if="!resourceConfigurationError" class="range-toolbar" aria-label="统计时间范围">
          <div class="preset-picker">
            <button
              v-for="option in presetItems"
              :key="String(option.value)"
              type="button"
              :class="{ active: preset === option.value }"
              :aria-pressed="preset === option.value"
              @click="preset = option.value"
            >
              {{ option.label }}
            </button>
          </div>
          <div v-if="preset === 'CUSTOM'" class="custom-range">
            <v-text-field v-model="from" type="date" label="开始日期" density="compact" variant="outlined" hide-details />
            <span>至</span>
            <v-text-field v-model="to" type="date" label="结束日期" density="compact" variant="outlined" hide-details />
            <v-btn size="small" color="primary" variant="flat" :disabled="Boolean(dateRangeError)" @click="applyCustomRange">应用</v-btn>
          </div>
        </div>

        <div v-if="resourceConfigurationError" class="inline-state error-state" role="alert">
          <v-icon size="18">mdi-alert-circle-outline</v-icon><span>{{ resourceConfigurationError }}</span>
        </div>
        <div v-else-if="preset === 'CUSTOM' && dateRangeError" class="inline-state warning-state" role="alert">
          <v-icon size="18">mdi-alert-outline</v-icon><span>{{ dateRangeError }}</span>
        </div>
        <div v-if="error" class="inline-state error-state" role="alert">
          <v-icon size="18">mdi-alert-circle-outline</v-icon><span>{{ error }}</span><button type="button" @click="loadReport">重试</button>
        </div>

        <template v-if="loading && !report && !resourceConfigurationError">
          <div class="metric-strip metric-strip--loading" aria-label="正在加载统计指标">
            <v-skeleton-loader v-for="index in 7" :key="index" type="text@2" class="metric-skeleton" />
          </div>
          <div class="chart-loading"><v-skeleton-loader type="image" height="250" /></div>
        </template>

        <template v-else-if="report && !resourceConfigurationError">
          <div class="metric-strip" role="tablist" aria-label="统计指标">
            <button
              v-for="metric in metrics"
              :key="metric.key"
              type="button"
              class="metric-tab"
              :class="{ active: selectedMetric === metric.key }"
              role="tab"
              :aria-selected="selectedMetric === metric.key"
              @click="selectedMetric = metric.key"
            >
              <span><v-icon size="15">{{ metric.icon }}</v-icon>{{ metric.label }}</span>
              <strong>{{ metricTotal(metric.key).toLocaleString('zh-CN') }}</strong>
            </button>
          </div>

          <section class="chart-section" :aria-label="`每日${activeMetric.label}趋势`">
            <div class="chart-heading">
              <div>
                <strong>每日{{ activeMetric.label }}</strong>
                <span>数据随选定时间范围更新</span>
              </div>
              <span class="peak-value">峰值 {{ maxMetricValue.toLocaleString('zh-CN') }}</span>
            </div>
            <div v-if="report.daily.length" class="chart-scroll">
              <div class="bar-chart" :style="{ minWidth: `${Math.max(640, report.daily.length * 18)}px` }">
                <div v-for="(item, index) in report.daily" :key="item.date" class="bar-column" :title="`${item.date} · ${metricValue(item)} ${activeMetric.label}`">
                  <span class="bar-value">{{ metricValue(item) || '' }}</span>
                  <i :style="{ height: `${barHeight(item)}%` }" />
                  <small>{{ showDateLabel(index) ? item.date.slice(5) : '' }}</small>
                </div>
              </div>
            </div>
            <div v-else class="chart-empty">
              <v-icon size="30">mdi-chart-bell-curve-cumulative</v-icon>
              <strong>这个周期还没有数据</strong>
              <p>发生浏览、编辑、评论或分享后会显示趋势。</p>
            </div>
          </section>
        </template>

        <div v-if="exportError" class="inline-state error-state export-state" role="alert">
          <v-icon size="18">mdi-alert-circle-outline</v-icon><span>{{ exportError }}</span>
        </div>
      </v-card-text>

      <footer class="analytics-footer">
        <small>CSV 包含时间范围内的全部七项指标</small>
        <div>
          <v-btn size="small" variant="text" :disabled="exporting" @click="close">关闭</v-btn>
          <v-btn size="small" color="primary" variant="flat" prepend-icon="mdi-download-outline" :loading="exporting" :disabled="!report || Boolean(dateRangeError) || Boolean(resourceConfigurationError)" @click="exportCsv">导出 CSV</v-btn>
        </div>
      </footer>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.analytics-dialog { position: relative; overflow: hidden; border: 1px solid #e7e9e8; border-radius: 8px !important; color: #262626; }
.analytics-header { position: relative; display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid #eeeeed; padding: 0 14px 0 18px; background: #fff; }
.analytics-heading { min-width: 0; display: flex; align-items: baseline; gap: 10px; }
.analytics-heading h2 { overflow: hidden; margin: 0; font-size: 16px; font-weight: 650; line-height: 1.4; text-overflow: ellipsis; white-space: nowrap; }
.analytics-heading span { overflow: hidden; color: #8a8f8d; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.header-actions { display: flex; flex: 0 0 auto; gap: 2px; }
.header-actions :deep(.v-btn) { width: 30px; height: 30px; color: #585a59; }
.dialog-progress { position: absolute; top: 51px; right: 0; left: 0; z-index: 2; }
.analytics-body { min-height: 452px; padding: 0 !important; background: #fff; }
.range-toolbar { display: flex; min-height: 42px; align-items: center; gap: 10px; border-bottom: 1px solid #eeeeed; padding: 5px 16px; }
.preset-picker { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 2px; padding: 2px; border-radius: 5px; background: #f3f4f3; }
.preset-picker button { height: 26px; border: 0; border-radius: 4px; background: transparent; color: #585a59; padding: 0 10px; font: 12px/1 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif; cursor: pointer; }
.preset-picker button:hover { color: #262626; background: rgba(255, 255, 255, .72); }
.preset-picker button.active { color: #262626; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .08); }
.preset-picker button:focus-visible, .metric-tab:focus-visible { z-index: 1; outline: 2px solid rgba(47, 111, 235, .28); outline-offset: -2px; }
.custom-range { min-width: 0; display: flex; flex: 1 1 auto; align-items: center; gap: 7px; }
.custom-range .v-text-field { max-width: 156px; }
.custom-range :deep(.v-field) { min-height: 30px; border-radius: 5px; font-size: 12px; }
.custom-range :deep(.v-field__input) { min-height: 30px; padding-top: 0; padding-bottom: 0; }
.custom-range :deep(.v-label) { font-size: 12px; }
.custom-range > span { color: #a6aaa8; font-size: 12px; }
.inline-state { display: flex; min-height: 38px; align-items: center; gap: 8px; margin: 12px 16px 0; border: 1px solid; border-radius: 6px; padding: 8px 10px; font-size: 12px; line-height: 1.5; }
.inline-state span { min-width: 0; flex: 1; }
.inline-state button { border: 0; background: transparent; color: inherit; font: inherit; font-weight: 600; cursor: pointer; }
.error-state { border-color: #ffd6d2; background: #fff7f6; color: #c9362e; }
.warning-state { border-color: #ffe2b8; background: #fffaf2; color: #a85c00; }
.metric-strip { display: grid; grid-template-columns: repeat(7, minmax(78px, 1fr)); border-bottom: 1px solid #eeeeed; padding: 0 16px; }
.metric-tab { position: relative; min-width: 0; height: 68px; display: flex; flex-direction: column; align-items: flex-start; justify-content: center; gap: 4px; border: 0; background: transparent; color: #262626; padding: 0 10px; text-align: left; cursor: pointer; }
.metric-tab::after { position: absolute; right: 10px; bottom: -1px; left: 10px; height: 2px; background: transparent; content: ''; }
.metric-tab:hover { background: #fafafa; }
.metric-tab.active::after { background: #2f6feb; }
.metric-tab span { display: flex; align-items: center; gap: 5px; color: #8a8f8d; font-size: 12px; white-space: nowrap; }
.metric-tab.active span { color: #2f6feb; }
.metric-tab strong { overflow: hidden; max-width: 100%; font-size: 17px; font-weight: 650; line-height: 1.2; text-overflow: ellipsis; }
.metric-strip--loading { min-height: 68px; gap: 14px; align-items: center; }
.metric-skeleton { min-width: 0; background: transparent; }
.chart-loading { padding: 18px 16px; }
.chart-section { overflow: hidden; }
.chart-heading { display: flex; height: 48px; align-items: center; justify-content: space-between; gap: 16px; padding: 0 18px; }
.chart-heading > div { min-width: 0; display: flex; align-items: baseline; gap: 9px; }
.chart-heading strong { font-size: 13px; font-weight: 650; }
.chart-heading span { color: #a6aaa8; font-size: 11px; }
.peak-value { flex: 0 0 auto; border-radius: 4px; background: #f5f6f5; padding: 4px 7px; color: #8a8f8d !important; }
.chart-scroll { overflow-x: auto; border-top: 1px solid #f2f2f1; padding: 16px 16px 6px; }
.bar-chart { height: 258px; display: flex; align-items: flex-end; gap: 3px; padding-top: 22px; }
.bar-column { position: relative; height: 224px; flex: 1 0 12px; display: flex; flex-direction: column; justify-content: flex-end; align-items: center; gap: 5px; border-bottom: 1px solid #eceeed; }
.bar-column i { width: min(10px, 76%); min-height: 2px; border-radius: 3px 3px 0 0; background: #5b8def; transition: height .2s ease; }
.bar-column small { height: 16px; color: #a6aaa8; font-size: 10px; white-space: nowrap; }
.bar-value { position: absolute; top: 0; z-index: 1; border-radius: 3px; background: #262626; color: #fff; padding: 2px 4px; font-size: 10px; opacity: 0; transform: translateY(-3px); transition: opacity .12s ease; }
.bar-column:hover .bar-value { opacity: 1; }
.chart-empty { min-height: 258px; display: flex; flex-direction: column; align-items: center; justify-content: center; border-top: 1px solid #f2f2f1; color: #a6aaa8; padding: 30px; text-align: center; }
.chart-empty strong { margin-top: 8px; color: #585a59; font-size: 13px; font-weight: 600; }
.chart-empty p { margin: 4px 0 0; font-size: 12px; }
.export-state { margin-bottom: 12px; }
.analytics-footer { display: flex; min-height: 52px; align-items: center; justify-content: space-between; gap: 16px; border-top: 1px solid #eeeeed; padding: 8px 14px 8px 18px; background: #fff; }
.analytics-footer small { color: #a6aaa8; font-size: 11px; }
.analytics-footer > div { display: flex; gap: 6px; }
.analytics-footer :deep(.v-btn) { border-radius: 5px; letter-spacing: 0; text-transform: none; }
@media (max-width: 760px) {
  .analytics-heading span, .analytics-footer small { display: none; }
  .range-toolbar { align-items: stretch; flex-direction: column; padding: 8px 12px; }
  .preset-picker { width: 100%; overflow-x: auto; }
  .preset-picker button { min-width: 62px; flex: 1 0 auto; }
  .custom-range { flex-wrap: wrap; }
  .custom-range .v-text-field { max-width: none; flex: 1 1 130px; }
  .metric-strip { grid-template-columns: repeat(4, minmax(70px, 1fr)); overflow-y: hidden; padding: 0 8px; }
  .metric-tab { height: 58px; padding: 0 7px; }
}
@media (max-width: 480px) {
  .analytics-header { padding-left: 14px; }
  .metric-strip { display: flex; overflow-x: auto; }
  .metric-tab { min-width: 78px; flex: 0 0 78px; }
  .chart-heading > div span { display: none; }
  .analytics-footer { justify-content: flex-end; }
}
</style>
