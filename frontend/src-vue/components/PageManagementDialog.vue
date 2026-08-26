<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
const settingsTabs: Array<{ value: PageManagementTab; title: string; icon: string }> = [
  { value: 'PROPERTIES', title: '设置', icon: 'mdi-tune-variant' },
  { value: 'PERMISSIONS', title: '权限', icon: 'mdi-account-lock-outline' },
  { value: 'ATTACHMENTS', title: '附件', icon: 'mdi-paperclip' },
  { value: 'HISTORY', title: '版本历史', icon: 'mdi-history' },
]
const compactMode = computed(() => tab.value === 'SHARE' || tab.value === 'PUBLISH')
const compactTitle = computed(() => tab.value === 'SHARE' ? '分享文档' : '发布文档')

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
    v-if="compactMode"
    :model-value="modelValue"
    :max-width="tab === 'SHARE' ? 760 : 720"
    scrollable
    @update:model-value="value => { if (!value) close() }"
  >
    <v-card class="compact-management-dialog">
      <header class="compact-dialog-header">
        <div><strong>{{ compactTitle }}</strong><span>{{ currentPage.title }}</span></div>
        <v-spacer />
        <v-btn icon="mdi-close" variant="text" size="small" :aria-label="`关闭${compactTitle}`" @click="close" />
      </header>
      <v-divider />
      <v-card-text class="compact-management-content">
        <PublicationPanel v-if="tab === 'PUBLISH'" :page="currentPage" />
        <SharesPanel v-else :page="currentPage" />
      </v-card-text>
    </v-card>
  </v-dialog>

  <v-navigation-drawer
    v-else
    :model-value="modelValue"
    location="right"
    temporary
    width="620"
    class="page-settings-drawer"
    @update:model-value="value => { if (!value) close() }"
  >
    <header class="settings-drawer-header">
      <div class="management-title"><strong>文档设置</strong><small>{{ currentPage.title }} · 草稿 v{{ currentPage.draftRevision }} · {{ contentTypeLabel(currentPage.contentType) }}</small></div>
      <v-spacer />
      <v-btn icon="mdi-close" variant="text" size="small" aria-label="关闭文档设置" @click="close" />
    </header>
    <nav class="settings-tabs" aria-label="文档设置功能">
      <button v-for="item in settingsTabs" :key="item.value" type="button" :class="{active:tab===item.value}" @click="tab=item.value"><v-icon :icon="item.icon" size="17" /><span>{{item.title}}</span></button>
    </nav>
    <div class="settings-drawer-content">
      <PropertiesPanel v-if="tab === 'PROPERTIES'" :page="currentPage" @updated="updated" @deleted="deleted" />
      <PermissionsPanel v-else-if="tab === 'PERMISSIONS'" :page="currentPage" />
      <AttachmentsPanel v-else-if="tab === 'ATTACHMENTS'" :page="currentPage" />
      <HistoryPanel v-else :page="currentPage" @updated="updated" />
    </div>
  </v-navigation-drawer>
</template>

<style scoped>
.compact-management-dialog { max-height: min(84vh, 760px); overflow: hidden; border: 1px solid #e7e9e8; border-radius: 8px !important; box-shadow: 0 16px 44px rgba(0,0,0,.12) !important; }
.compact-dialog-header { display: flex; min-height: 58px; align-items: center; padding: 0 16px 0 20px; }
.compact-dialog-header>div { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.compact-dialog-header strong { font-size: 16px; font-weight: 650; }
.compact-dialog-header span { overflow: hidden; max-width: 560px; color: #8a8f8d; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.compact-management-content { overflow-y: auto; padding: 18px 20px 28px; }
.page-settings-drawer { border-left: 1px solid #e7e9e8 !important; background: #fff !important; }
.settings-drawer-header { display: flex; min-height: 60px; align-items: center; border-bottom: 1px solid #f0f0f0; padding: 0 14px 0 20px; }
.management-title { display: flex; min-width: 0; flex-direction: column; line-height: 1.25; }
.management-title strong { overflow: hidden; max-width: 480px; font-size: 16px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.management-title small { overflow: hidden; max-width: 480px; margin-top: 4px; color: #8a8f8d; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.settings-tabs { display: flex; height: 43px; align-items: stretch; gap: 16px; border-bottom: 1px solid #f0f0f0; padding: 0 20px; }
.settings-tabs button { position: relative; display: flex; align-items: center; gap: 5px; border: 0; background: transparent; color: #585a59; font: 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; cursor: pointer; }
.settings-tabs button::after { position: absolute; right: 0; bottom: -1px; left: 0; height: 2px; border-radius: 2px 2px 0 0; background: transparent; content: ''; }
.settings-tabs button:hover { color: #262626; }
.settings-tabs button.active { color: #2f6feb; font-weight: 600; }
.settings-tabs button.active::after { background: #2f6feb; }
.settings-drawer-content { height: calc(100% - 103px); overflow-y: auto; padding: 20px 22px 42px; }
.compact-management-content :deep(.v-card),
.settings-drawer-content :deep(.v-card) { border-radius: 6px !important; box-shadow: none !important; }
.compact-management-content :deep(.v-alert),
.settings-drawer-content :deep(.v-alert) { border-radius: 5px !important; }

@media (max-width: 800px) {
  .compact-management-dialog { height: 100vh; max-height: 100vh; border-radius: 0 !important; }
  .page-settings-drawer { width: 100% !important; }
  .settings-tabs { gap: 10px; overflow-x: auto; padding: 0 14px; }
  .settings-tabs button { min-width: max-content; }
  .settings-drawer-content { padding: 18px 14px 36px; }
}
</style>
