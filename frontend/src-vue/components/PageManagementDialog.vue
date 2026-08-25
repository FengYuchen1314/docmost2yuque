<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Page } from '../../src/types'
import AttachmentsPanel from './page-management/AttachmentsPanel.vue'
import HistoryPanel from './page-management/HistoryPanel.vue'
import PermissionsPanel from './page-management/PermissionsPanel.vue'
import PropertiesPanel from './page-management/PropertiesPanel.vue'
import PublicationPanel from './page-management/PublicationPanel.vue'
import SharesPanel from './page-management/SharesPanel.vue'
import type { PageManagementTab } from './page-management/types'
import { contentTypeLabel } from './page-management/utils'

const props = withDefaults(defineProps<{
  modelValue: boolean
  page: Page
  initialTab?: PageManagementTab
}>(), { initialTab: 'PROPERTIES' })

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  close: []
  updated: [page: Page, resetEditorBody?: boolean]
  deleted: []
}>()

const tab = ref<PageManagementTab>(props.initialTab)
const currentPage = ref<Page>(props.page)
const tabs: Array<{ value: PageManagementTab; title: string; icon: string }> = [
  { value: 'PROPERTIES', title: '属性与标签', icon: 'mdi-tune-variant' },
  { value: 'PERMISSIONS', title: '协作者权限', icon: 'mdi-account-lock-outline' },
  { value: 'ATTACHMENTS', title: '附件管理', icon: 'mdi-paperclip' },
  { value: 'HISTORY', title: '版本历史', icon: 'mdi-history' },
  { value: 'PUBLISH', title: '发布管理', icon: 'mdi-rocket-launch-outline' },
  { value: 'SHARE', title: '分享链接', icon: 'mdi-link-variant' },
]

watch(() => props.page, (value) => { currentPage.value = value })
watch(() => props.modelValue, (open) => {
  if (open) {
    currentPage.value = props.page
    tab.value = props.initialTab
  }
})

function close() {
  emit('update:modelValue', false)
  emit('close')
}

function updated(page: Page, resetEditorBody = false) {
  currentPage.value = page
  emit('updated', page, resetEditorBody)
}

function deleted() {
  emit('deleted')
  close()
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="1280"
    scrollable
    @update:model-value="value => { if (!value) close() }"
  >
    <v-card class="management-dialog">
      <v-toolbar color="surface" flat border="bottom" height="72" class="px-3">
        <v-avatar color="primary" variant="tonal" rounded="lg" class="mr-3">
          <span class="page-icon">{{ currentPage.icon || '📄' }}</span>
        </v-avatar>
        <div class="management-title">
          <div class="eyebrow">文稿管理</div>
          <strong>{{ currentPage.title }}</strong>
          <small>草稿 v{{ currentPage.draftRevision }} · {{ contentTypeLabel(currentPage.contentType) }}</small>
        </div>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" aria-label="关闭文稿管理" @click="close" />
      </v-toolbar>

      <div class="management-layout">
        <nav class="management-nav" aria-label="文稿管理功能">
          <v-btn
            v-for="item in tabs"
            :key="item.value"
            :color="tab === item.value ? 'primary' : undefined"
            :variant="tab === item.value ? 'tonal' : 'text'"
            :prepend-icon="item.icon"
            block
            class="justify-start"
            @click="tab = item.value"
          >
            {{ item.title }}
          </v-btn>
        </nav>

        <v-card-text class="management-content">
          <PropertiesPanel v-if="tab === 'PROPERTIES'" :page="currentPage" @updated="updated" @deleted="deleted" />
          <PermissionsPanel v-else-if="tab === 'PERMISSIONS'" :page="currentPage" />
          <AttachmentsPanel v-else-if="tab === 'ATTACHMENTS'" :page="currentPage" />
          <HistoryPanel v-else-if="tab === 'HISTORY'" :page="currentPage" @updated="updated" />
          <PublicationPanel v-else-if="tab === 'PUBLISH'" :page="currentPage" />
          <SharesPanel v-else :page="currentPage" />
        </v-card-text>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.management-dialog { height: min(90vh, 900px); overflow: hidden; border-radius: 18px !important; }
.page-icon { font-size: 1.25rem; line-height: 1; }
.management-title { display: flex; min-width: 0; flex-direction: column; line-height: 1.25; }
.management-title strong { overflow: hidden; max-width: min(58vw, 720px); font-size: 1rem; text-overflow: ellipsis; white-space: nowrap; }
.management-title small { margin-top: 3px; color: rgb(var(--v-theme-on-surface-variant)); font-size: .72rem; }
.eyebrow { color: rgb(var(--v-theme-primary)); font-size: .65rem; font-weight: 750; letter-spacing: .1em; text-transform: uppercase; }
.management-layout { display: grid; min-height: 0; flex: 1; grid-template-columns: 210px minmax(0, 1fr); overflow: hidden; }
.management-nav { display: flex; flex-direction: column; gap: 5px; border-right: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding: 16px 12px; background: rgba(var(--v-theme-on-surface), .018); }
.management-content { overflow-y: auto; padding: 26px 30px 48px; }

@media (max-width: 800px) {
  .management-dialog { height: 100vh; max-height: 100vh; border-radius: 0 !important; }
  .management-layout { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); }
  .management-nav { overflow-x: auto; flex-direction: row; border-right: 0; border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity)); padding: 9px; }
  .management-nav .v-btn { min-width: max-content; }
  .management-content { padding: 20px 16px 40px; }
}
</style>
