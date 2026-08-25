<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { DocumentSettings, Page } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import type { PageLabels } from './types'
import { normalizeDocumentSettings, safeHttpsUrl, slugify } from './utils'

interface PropertyDraft {
  title: string
  path: string
  icon: string
  cover: string
  publishMode: string
  visibilityOverride: string
  documentSettings: DocumentSettings
}

const props = defineProps<{ page: Page }>()
const emit = defineEmits<{ updated: [page: Page]; deleted: [] }>()
const ui = useUiStore()

const draft = ref<PropertyDraft>(propertyDraft(props.page))
const saving = ref(false)
const saved = ref(false)
const error = ref('')
const trashOpen = ref(false)
const trashing = ref(false)
let savedTimer = 0

const labels = ref<Array<{ name: string; color: string }>>([])
const labelsRevision = ref(0)
const labelsLoading = ref(false)
const labelsSaving = ref(false)
const labelsError = ref('')
const labelName = ref('')
const labelColor = ref('#5A8F6B')

const parsedCover = computed(() => safeHttpsUrl(draft.value.cover))
const coverInvalid = computed(() => Boolean(draft.value.cover.trim()) && parsedCover.value === null)

watch(() => [props.page.id, props.page.draftRevision] as const, () => {
  draft.value = propertyDraft(props.page)
}, { immediate: true })
watch(() => props.page.id, () => void loadLabels(), { immediate: true })
onBeforeUnmount(() => window.clearTimeout(savedTimer))

function propertyDraft(page: Page): PropertyDraft {
  return {
    title: page.title,
    path: page.path,
    icon: page.icon ?? '',
    cover: page.cover ?? '',
    publishMode: page.publishMode,
    visibilityOverride: page.visibilityOverride,
    documentSettings: normalizeDocumentSettings(page.documentSettings),
  }
}

async function saveProperties() {
  if (saving.value || !draft.value.title.trim() || !draft.value.path || coverInvalid.value) return
  saving.value = true
  error.value = ''
  try {
    const page = await post<Page>('/api/v1/pages/update', {
      pageId: props.page.id,
      expectedRevision: props.page.draftRevision,
      title: draft.value.title.trim(),
      path: draft.value.path,
      icon: draft.value.icon,
      cover: parsedCover.value ?? '',
      publishMode: draft.value.publishMode,
      visibilityOverride: draft.value.visibilityOverride,
      documentSettings: draft.value.documentSettings,
      revisionKind: 'MANUAL',
      revisionDescription: '更新文稿设置',
    })
    emit('updated', page)
    saved.value = true
    window.clearTimeout(savedTimer)
    savedTimer = window.setTimeout(() => { saved.value = false }, 2_000)
    ui.notify('文稿设置已保存')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    saving.value = false
  }
}

async function loadLabels() {
  labelsLoading.value = true
  labelsError.value = ''
  try {
    const value = await post<PageLabels>('/api/v1/pages/labels', { pageId: props.page.id })
    labelsRevision.value = value.revision
    labels.value = value.labels.map((label) => ({ name: label.name, color: label.color }))
  } catch (value) {
    labelsError.value = messageOf(value)
  } finally {
    labelsLoading.value = false
  }
}

function addLabel() {
  const name = labelName.value.trim().slice(0, 50)
  if (!name || labels.value.length >= 20) return
  if (labels.value.some((label) => label.name.localeCompare(name, 'zh-CN', { sensitivity: 'accent' }) === 0)) {
    labelsError.value = '同名标签已经存在'
    return
  }
  labels.value.push({ name, color: labelColor.value.toUpperCase() })
  labelName.value = ''
  labelsError.value = ''
}

async function saveLabels() {
  if (labelsSaving.value) return
  labelsSaving.value = true
  labelsError.value = ''
  try {
    const value = await post<PageLabels>('/api/v1/pages/labels/update', {
      pageId: props.page.id,
      expectedRevision: labelsRevision.value,
      labels: labels.value,
    })
    labelsRevision.value = value.revision
    labels.value = value.labels.map((label) => ({ name: label.name, color: label.color }))
    ui.notify('文稿标签已保存')
  } catch (value) {
    labelsError.value = messageOf(value)
  } finally {
    labelsSaving.value = false
  }
}

async function trashPage() {
  if (trashing.value) return
  trashing.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/pages/trash', { pageId: props.page.id })
    trashOpen.value = false
    emit('deleted')
    ui.notify('文稿已移入回收站')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    trashing.value = false
  }
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-avatar color="primary" variant="tonal"><v-icon>mdi-tune-variant</v-icon></v-avatar>
      <div><h2>属性与标签</h2><p>修改页面身份、阅读样式、发布方式和搜索标签。</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <div class="settings-grid">
      <v-text-field v-model="draft.title" label="标题" variant="outlined" maxlength="500" />
      <v-text-field
        :model-value="draft.path"
        label="访问路径"
        prefix="/"
        variant="outlined"
        maxlength="180"
        @update:model-value="draft.path = slugify(String($event))"
      />
      <v-text-field v-model="draft.icon" label="图标" hint="可使用 emoji 或图片地址" persistent-hint variant="outlined" maxlength="2000" />
      <v-text-field
        v-model="draft.cover"
        label="封面 HTTPS 地址"
        variant="outlined"
        maxlength="2000"
        :error="coverInvalid"
        :error-messages="coverInvalid ? ['请输入不含账号凭据的 HTTPS 地址'] : []"
      />
      <v-select v-model="draft.publishMode" label="发布方式" variant="outlined" :items="[{title:'继承知识库',value:'INHERIT'},{title:'手动发布',value:'MANUAL'},{title:'自动发布',value:'AUTO'}]" />
      <v-select v-model="draft.visibilityOverride" label="可见范围" variant="outlined" :items="[{title:'继承知识库',value:'INHERIT'},{title:'私密',value:'PRIVATE'},{title:'空间成员',value:'WORKSPACE'},{title:'公开',value:'PUBLIC'}]" />
    </div>

    <h3 class="subheading"><v-icon size="18">mdi-format-text-variant</v-icon>阅读样式</h3>
    <div class="settings-grid settings-compact">
      <v-select v-model="draft.documentSettings.pageWidth" label="页面宽度" variant="outlined" :items="[{title:'标准版',value:'STANDARD'},{title:'宽版',value:'WIDE'}]" />
      <v-select v-model="draft.documentSettings.fontFamily" label="正文字体" variant="outlined" :items="[{title:'无衬线',value:'SANS'},{title:'衬线',value:'SERIF'}]" />
      <v-select v-model="draft.documentSettings.fontSize" label="字体大小" variant="outlined" :items="[{title:'小',value:'SMALL'},{title:'标准',value:'MEDIUM'},{title:'大',value:'LARGE'}]" />
      <v-select v-model="draft.documentSettings.paragraphSpacing" label="段落间距" variant="outlined" :items="[{title:'紧凑',value:'COMPACT'},{title:'标准',value:'NORMAL'},{title:'宽松',value:'RELAXED'}]" />
      <v-switch v-model="draft.documentSettings.showOutline" label="标题足够时显示文稿大纲" color="primary" hide-details inset />
    </div>

    <div class="actions-row">
      <v-btn color="primary" prepend-icon="mdi-content-save-outline" :loading="saving" :disabled="!draft.title.trim() || !draft.path || coverInvalid" @click="saveProperties">
        {{ saved ? '已保存' : '保存属性' }}
      </v-btn>
    </div>

    <v-divider class="my-7" />

    <section class="labels-section">
      <div class="section-title-row">
        <div><h3><v-icon size="18">mdi-tag-multiple-outline</v-icon> 文稿标签</h3><p>标签参与内部与公开搜索，最多 20 个；标签版本独立于草稿版本。</p></div>
        <v-chip size="small" variant="tonal">{{ labels.length }}/20 · v{{ labelsRevision }}</v-chip>
      </div>
      <v-progress-linear v-if="labelsLoading" indeterminate color="primary" class="mb-4" />
      <v-alert v-if="labelsError" type="error" variant="tonal" closable class="mb-4" @click:close="labelsError = ''">{{ labelsError }}</v-alert>
      <div class="label-list mb-4">
        <v-chip v-for="(label, index) in labels" :key="`${label.name}-${index}`" closable variant="tonal" @click:close="labels.splice(index, 1)">
          <span class="label-dot" :style="{ backgroundColor: label.color }" />{{ label.name }}
        </v-chip>
        <span v-if="!labelsLoading && !labels.length" class="empty-inline">还没有标签</span>
      </div>
      <div class="label-create-row">
        <input v-model="labelColor" type="color" aria-label="标签颜色" class="color-input">
        <v-text-field v-model="labelName" label="新标签名称" variant="outlined" density="comfortable" maxlength="50" hide-details @keydown.enter.prevent="addLabel" />
        <v-btn variant="tonal" prepend-icon="mdi-plus" :disabled="!labelName.trim() || labels.length >= 20" @click="addLabel">添加</v-btn>
        <v-btn color="primary" variant="tonal" prepend-icon="mdi-content-save-outline" :loading="labelsSaving" @click="saveLabels">保存标签</v-btn>
      </div>
    </section>

    <v-divider class="my-7" />
    <section class="danger-zone">
      <div><strong>移入回收站</strong><p>文稿会从目录和搜索结果中隐藏，空间管理员之后仍可恢复。</p></div>
      <v-btn color="error" variant="tonal" prepend-icon="mdi-delete-outline" @click="trashOpen = true">移入回收站</v-btn>
    </section>

    <v-dialog v-model="trashOpen" max-width="500" persistent>
      <v-card>
        <v-card-title class="px-6 pt-5">将“{{ page.title }}”移入回收站？</v-card-title>
        <v-card-text class="px-6">文稿会从目录、搜索结果和编辑入口隐藏。该操作可由有权限的管理员恢复。<v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert></v-card-text>
        <v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="trashing" @click="trashOpen = false">取消</v-btn><v-btn color="error" :loading="trashing" @click="trashPage">确认移入</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { max-width: 940px; margin: 0 auto; }
.panel-heading { display: flex; align-items: center; gap: 13px; margin-bottom: 24px; }
.panel-heading h2, .section-title-row h3 { margin: 0; font-size: 1.15rem; }
.panel-heading p, .section-title-row p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .84rem; }
.settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 2px 16px; }
.settings-compact { align-items: center; }
.subheading { display: flex; align-items: center; gap: 7px; margin: 8px 0 16px; font-size: .95rem; }
.actions-row { display: flex; justify-content: flex-end; margin-top: 10px; }
.section-title-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; }
.section-title-row h3 { font-size: 1rem; }
.label-list { display: flex; min-height: 36px; align-items: center; flex-wrap: wrap; gap: 8px; }
.label-dot { width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
.empty-inline { color: rgb(var(--v-theme-on-surface-variant)); font-size: .83rem; }
.label-create-row { display: grid; grid-template-columns: 44px minmax(170px, 1fr) auto auto; align-items: center; gap: 9px; }
.color-input { width: 42px; height: 42px; border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); border-radius: 9px; padding: 4px; background: transparent; }
.danger-zone { display: flex; align-items: center; justify-content: space-between; gap: 20px; border: 1px solid rgba(var(--v-theme-error), .25); border-radius: 12px; padding: 16px; background: rgba(var(--v-theme-error), .035); }
.danger-zone strong { color: rgb(var(--v-theme-error)); }
.danger-zone p { margin: 3px 0 0; color: rgb(var(--v-theme-on-surface-variant)); font-size: .82rem; }
@media (max-width: 680px) { .settings-grid { grid-template-columns: 1fr; } .label-create-row { grid-template-columns: 44px 1fr; } .label-create-row .v-btn { grid-column: span 1; } .danger-zone { align-items: stretch; flex-direction: column; } }
</style>
