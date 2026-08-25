<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { Notification, NotificationPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'

type NotificationCategory = 'ALL' | 'MENTIONS' | 'COMMENTS' | 'ACCESS' | 'UPDATES'

const router = useRouter()
const ui = useUiStore()
const unreadOnly = ref(false)
const category = ref<NotificationCategory>('ALL')
const notifications = ref<Notification[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const markingAll = ref(false)
const markingIds = ref<Set<string>>(new Set())
const error = ref('')
let notificationsRequestVersion = 0

const categories: Array<{ value: NotificationCategory; title: string; icon: string }> = [
  { value: 'ALL', title: '全部分类', icon: 'mdi-view-grid-outline' },
  { value: 'MENTIONS', title: '提及', icon: 'mdi-at' },
  { value: 'COMMENTS', title: '评论与回复', icon: 'mdi-comment-text-outline' },
  { value: 'ACCESS', title: '邀请与审批', icon: 'mdi-account-key-outline' },
  { value: 'UPDATES', title: '关注更新', icon: 'mdi-rss' },
]

const unreadCount = computed(() => notifications.value.filter((item) => !item.readAt).length)
const displayedCount = computed(() => `${notifications.value.length}${hasMore.value ? '+' : ''}`)

onMounted(() => void loadNotifications(true))
watch([unreadOnly, category], () => void loadNotifications(true))

async function loadNotifications(reset = false) {
  const requestVersion = reset ? ++notificationsRequestVersion : notificationsRequestVersion
  if (reset) {
    loading.value = true
  } else {
    if (loading.value || !hasMore.value || loadingMore.value) return
    loadingMore.value = true
  }
  error.value = ''
  const offset = reset ? 0 : nextOffset.value
  try {
    const page = await post<NotificationPage>('/api/v1/notifications/page', {
      unreadOnly: unreadOnly.value,
      category: category.value,
      offset,
      limit: 25,
    })
    if (requestVersion !== notificationsRequestVersion) return
    notifications.value = reset ? page.items : deduplicate([...notifications.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (requestVersion === notificationsRequestVersion) error.value = messageOf(value)
  } finally {
    if (requestVersion === notificationsRequestVersion) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function markRead(notification: Notification) {
  if (notification.readAt || markingIds.value.has(notification.id)) return true
  const previousReadAt = notification.readAt
  markingIds.value = new Set(markingIds.value).add(notification.id)
  notification.readAt = new Date().toISOString()
  try {
    await post<void>('/api/v1/notifications/read', { notificationId: notification.id })
    if (unreadOnly.value) await loadNotifications(true)
    return true
  } catch (value) {
    notification.readAt = previousReadAt
    error.value = messageOf(value)
    return false
  } finally {
    const next = new Set(markingIds.value)
    next.delete(notification.id)
    markingIds.value = next
  }
}

async function markAllRead() {
  if (markingAll.value) return
  markingAll.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/notifications/read-all', {})
    if (unreadOnly.value) {
      await loadNotifications(true)
    } else {
      const now = new Date().toISOString()
      notifications.value.forEach((item) => { item.readAt = item.readAt || now })
    }
    ui.notify('全部消息已标记为已读')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    markingAll.value = false
  }
}

async function openNotification(notification: Notification) {
  await markRead(notification)
  const destination = notificationDestination(notification)
  if (destination) await router.push(destination)
}

function deduplicate(items: Notification[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}

function notificationLabel(type: string) {
  const names: Record<string, string> = {
    COMMENT_MENTION: '在评论中提到了你',
    PAGE_MENTION: '在文稿中提到了你',
    INVITATION: '邀请你加入',
    APPROVAL: '审批结果有更新',
    PUBLICATION: '关注的内容已发布',
    SHARE_COMMENT: '分享文稿收到新评论',
    SHARE_APPROVAL_REQUEST: '有人申请访问分享',
    SHARE_APPROVAL_REVIEWED: '分享访问申请已有结果',
  }
  return names[type] ?? '有一条新消息'
}

function notificationIcon(type: string) {
  if (type.includes('MENTION')) return 'mdi-at'
  if (type.includes('COMMENT')) return 'mdi-comment-text-outline'
  if (type === 'INVITATION') return 'mdi-account-plus-outline'
  if (type.includes('APPROVAL')) return 'mdi-account-check-outline'
  if (type === 'PUBLICATION') return 'mdi-publish'
  return 'mdi-bell-outline'
}

function notificationColor(type: string) {
  if (type.includes('MENTION')) return 'primary'
  if (type.includes('COMMENT')) return 'indigo'
  if (type === 'INVITATION') return 'teal'
  if (type.includes('APPROVAL')) return 'orange'
  if (type === 'PUBLICATION') return 'success'
  return 'blue-grey'
}

function notificationSummary(value: Notification) {
  return value.payload.preview || value.payload.title || `${value.resourceType} 有新的协作动态`
}

function notificationDestination(value: Notification) {
  if (value.type === 'PUBLICATION' && value.payload.publicationId) {
    return `/p/${encodeURIComponent(value.payload.publicationId)}`
  }
  if (value.resourceType !== 'PAGE' || value.type === 'SHARE_APPROVAL_REVIEWED') return null
  const suffix = value.type === 'SHARE_APPROVAL_REQUEST' ? '?manage=SHARE' : ''
  if (value.payload.knowledgeBaseId) {
    return `/app/kb/${encodeURIComponent(value.payload.knowledgeBaseId)}/pages/${encodeURIComponent(value.resourceId)}${suffix}`
  }
  return `/app/pages/${encodeURIComponent(value.resourceId)}${suffix}`
}

function relativeTime(value: string) {
  const time = new Date(value).getTime()
  if (!Number.isFinite(time)) return ''
  const seconds = Math.max(0, Math.round((Date.now() - time) / 1000))
  if (seconds < 45) return '刚刚'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days} 天前`
  return new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' })
}
</script>

<template>
  <div class="page-shell notifications-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">消息中心</div>
        <h1>与你有关的动态</h1>
        <p>提及、评论、邀请和审批集中在这里。</p>
      </div>
      <v-btn
        color="primary"
        variant="tonal"
        prepend-icon="mdi-check-all"
        :loading="markingAll"
        @click="markAllRead"
      >
        全部已读
      </v-btn>
    </header>

    <v-card class="section-card filter-card mb-5" variant="flat">
      <div class="filter-row">
        <v-btn-toggle v-model="unreadOnly" mandatory density="comfortable" color="primary" variant="tonal">
          <v-btn :value="false">全部</v-btn>
          <v-btn :value="true">未读</v-btn>
        </v-btn-toggle>

        <v-divider vertical class="filter-divider" />

        <v-chip-group v-model="category" mandatory selected-class="text-primary">
          <v-chip
            v-for="item in categories"
            :key="item.value"
            :value="item.value"
            :prepend-icon="item.icon"
            filter
            variant="tonal"
          >
            {{ item.title }}
          </v-chip>
        </v-chip-group>

        <v-spacer />
        <span class="result-count">
          <strong>{{ displayedCount }}</strong> 条
          <template v-if="unreadCount && !unreadOnly"> · {{ unreadCount }} 条未读</template>
        </span>
      </div>
    </v-card>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">
      <div class="d-flex align-center flex-wrap ga-2">
        <span>{{ error }}</span>
        <v-btn size="small" variant="text" @click="loadNotifications(true)">重试</v-btn>
      </div>
    </v-alert>

    <v-card class="section-card notification-card" variant="flat">
      <v-progress-linear v-if="loading" indeterminate color="primary" />

      <div v-if="!loading && notifications.length" class="notification-list">
        <button
          v-for="notification in notifications"
          :key="notification.id"
          type="button"
          class="notification-item"
          :class="{ unread: !notification.readAt }"
          @click="openNotification(notification)"
        >
          <span class="unread-marker" aria-hidden="true" />
          <v-avatar
            :color="notificationColor(notification.type)"
            variant="tonal"
            size="42"
            class="notification-avatar"
          >
            <v-icon size="21">{{ notificationIcon(notification.type) }}</v-icon>
          </v-avatar>

          <span class="notification-copy">
            <span class="notification-title">
              {{ notificationLabel(notification.type) }}
              <v-chip v-if="notification.occurrenceCount > 1" size="x-small" variant="tonal">
                {{ notification.occurrenceCount }} 次
              </v-chip>
            </span>
            <span class="notification-summary">{{ notificationSummary(notification) }}</span>
            <time :datetime="notification.updatedAt">{{ relativeTime(notification.updatedAt) }}</time>
          </span>

          <v-progress-circular
            v-if="markingIds.has(notification.id)"
            indeterminate
            size="18"
            width="2"
            color="primary"
          />
          <v-icon v-else-if="notificationDestination(notification)" size="19" class="notification-chevron">
            mdi-chevron-right
          </v-icon>
        </button>

        <div v-if="hasMore" class="load-more">
          <v-btn
            variant="tonal"
            prepend-icon="mdi-chevron-down"
            :loading="loadingMore"
            @click="loadNotifications(false)"
          >
            加载更多消息
          </v-btn>
        </div>
      </div>

      <div v-else-if="!loading && !error" class="empty-state notification-empty">
        <div>
          <v-avatar color="primary" variant="tonal" size="60" class="mb-4">
            <v-icon size="30">{{ unreadOnly ? 'mdi-email-check-outline' : 'mdi-bell-sleep-outline' }}</v-icon>
          </v-avatar>
          <h3>{{ unreadOnly ? '没有未读消息' : '没有消息' }}</h3>
          <p>{{ unreadOnly ? '当前分类中的消息都已经处理完了。' : '当前分类还没有新的协作动态。' }}</p>
        </div>
      </div>
    </v-card>
  </div>
</template>

<style scoped>
.notifications-page { max-width: 1040px; }
.eyebrow { margin-bottom: 6px; color: rgb(var(--v-theme-primary)); font-size: .74rem; font-weight: 750; letter-spacing: .12em; text-transform: uppercase; }
.filter-card { padding: 12px 16px; }
.filter-row { display: flex; align-items: center; gap: 14px; min-height: 44px; }
.filter-divider { height: 28px; align-self: center; }
.result-count { flex: 0 0 auto; color: rgb(var(--v-theme-on-surface-variant)); font-size: .82rem; white-space: nowrap; }
.result-count strong { color: rgb(var(--v-theme-on-surface)); }
.notification-card { overflow: hidden; min-height: 280px; }
.notification-list { padding: 8px; }
.notification-item { position: relative; display: flex; width: 100%; align-items: center; gap: 14px; border: 0; border-radius: 12px; padding: 15px 14px; background: transparent; color: inherit; text-align: left; cursor: pointer; transition: background-color .16s ease, transform .16s ease; }
.notification-item:hover { background: rgba(var(--v-theme-primary), .055); }
.notification-item:focus-visible { outline: 2px solid rgb(var(--v-theme-primary)); outline-offset: -2px; }
.notification-item + .notification-item::before { position: absolute; top: 0; right: 14px; left: 70px; height: 1px; background: rgba(var(--v-border-color), var(--v-border-opacity)); content: ''; }
.notification-item.unread { background: rgba(var(--v-theme-primary), .035); }
.notification-item.unread .notification-title { font-weight: 750; }
.unread-marker { width: 7px; height: 7px; flex: 0 0 7px; border-radius: 999px; background: transparent; }
.unread .unread-marker { background: rgb(var(--v-theme-primary)); box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), .12); }
.notification-avatar { flex: 0 0 auto; }
.notification-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.notification-title { display: flex; align-items: center; gap: 7px; font-size: .94rem; font-weight: 620; }
.notification-summary { overflow: hidden; color: rgb(var(--v-theme-on-surface-variant)); font-size: .88rem; text-overflow: ellipsis; white-space: nowrap; }
.notification-copy time { color: rgb(var(--v-theme-on-surface-variant)); font-size: .75rem; opacity: .8; }
.notification-chevron { color: rgb(var(--v-theme-on-surface-variant)); opacity: .7; }
.load-more { display: flex; justify-content: center; padding: 18px 12px 14px; }
.notification-empty { min-height: 320px; }

@media (max-width: 800px) {
  .filter-row { align-items: flex-start; flex-wrap: wrap; }
  .filter-divider { display: none; }
  .filter-row :deep(.v-chip-group) { order: 3; width: 100%; }
  .result-count { margin-left: auto; align-self: center; }
}

@media (max-width: 600px) {
  .filter-card { padding: 10px; }
  .notification-list { padding: 4px; }
  .notification-item { gap: 10px; padding: 14px 9px; }
  .notification-avatar { display: none; }
  .notification-item + .notification-item::before { left: 26px; }
  .notification-summary { white-space: normal; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
}
</style>
