<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type {
  ContentCardAction,
  ContentCardError,
  ContentCardInput,
} from '../../types/content-card'
import {
  displayHostname,
  formatFileSize,
  iframeUrlAllowed,
  normalizeContentCard,
  safeResourceUrl,
} from './contentCardModel'
import {
  decryptSensitiveCard,
  isSensitiveCardCryptoAvailable,
  isSensitiveCardEnvelope,
  SENSITIVE_CARD_HTTPS_MESSAGE,
} from './sensitiveCardCrypto'
import { copyText } from '../page-management/utils'

const props = withDefaults(defineProps<{
  card: ContentCardInput
  compact?: boolean
  interactive?: boolean
  allowIframes?: boolean
  iframeAllowHosts?: string[]
}>(), {
  compact: false,
  interactive: true,
  allowIframes: true,
  iframeAllowHosts: () => [],
})

const emit = defineEmits<{
  open: [payload: ContentCardAction]
  download: [payload: ContentCardAction]
  copy: [payload: ContentCardAction]
  unlock: [payload: ContentCardAction]
  hide: [payload: ContentCardAction]
  error: [payload: ContentCardError]
}>()

const normalized = computed(() => normalizeContentCard(props.card))
const data = computed(() => normalized.value.data)
const password = ref('')
const plaintext = ref<string | null>(null)
const decrypting = ref(false)
const decryptError = ref('')
const copied = ref(false)

watch(() => normalized.value.instanceId, () => {
  password.value = ''
  plaintext.value = null
  decryptError.value = ''
  copied.value = false
})

const primaryUrl = computed(() => safeResourceUrl(data.value.url))
const hasConfiguredUrl = computed(() => Boolean(text('url')))
const iconUrl = computed(() => safeResourceUrl(data.value.icon))
const posterUrl = computed(() => safeResourceUrl(data.value.poster))
const iframeUrl = computed(() => props.allowIframes
  ? iframeUrlAllowed(data.value.url, props.iframeAllowHosts)
  : null)
const iframeHeight = computed(() => {
  const height = number('height')
  return `${Math.min(900, Math.max(240, height || 420))}px`
})
const attachmentMeta = computed(() => [
  text('mimeType'),
  formatFileSize(data.value.size),
].filter(Boolean).join(' · '))
const sensitiveValid = computed(() => isSensitiveCardEnvelope(data.value))
const sensitiveCryptoAvailable = computed(() => isSensitiveCardCryptoAvailable())
const rawPreview = computed(() => {
  const raw = normalized.value.raw || JSON.stringify(data.value, null, 2)
  return raw.length > 600 ? `${raw.slice(0, 600)}…` : raw
})
const imageWidthClass = computed(() => `content-card-image--${text('width', 'LARGE').toLowerCase()}`)

const calloutStyle = computed(() => {
  const tone = text('tone', 'INFO').toUpperCase()
  if (tone === 'SUCCESS') return { color: 'success', icon: 'mdi-check-circle-outline' }
  if (tone === 'WARNING') return { color: 'warning', icon: 'mdi-alert-outline' }
  if (tone === 'DANGER') return { color: 'error', icon: 'mdi-alert-octagon-outline' }
  return { color: 'info', icon: 'mdi-information-outline' }
})

const statusStyle = computed(() => {
  const value = text('value', 'TODO').toUpperCase()
  const styles: Record<string, { label: string; color: string; icon: string }> = {
    TODO: { label: '待处理', color: 'secondary', icon: 'mdi-circle-outline' },
    IN_PROGRESS: { label: '进行中', color: 'info', icon: 'mdi-progress-clock' },
    BLOCKED: { label: '已阻塞', color: 'warning', icon: 'mdi-alert-circle-outline' },
    DONE: { label: '已完成', color: 'success', icon: 'mdi-check-circle-outline' },
    CANCELLED: { label: '已取消', color: 'error', icon: 'mdi-close-circle-outline' },
  }
  return styles[value] ?? styles.TODO!
})

function text(key: string, fallback = ''): string {
  const value = data.value[key]
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function number(key: string): number {
  const value = data.value[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function actionPayload(action: ContentCardAction['action'], url?: string): ContentCardAction {
  return { action, card: normalized.value, ...(url ? { url } : {}) }
}

function handleOpen(event: MouseEvent, url: string | null) {
  if (!props.interactive || !url) {
    event.preventDefault()
    return
  }
  emit('open', actionPayload('open', url))
}

function handleDownload() {
  if (props.interactive && primaryUrl.value) emit('download', actionPayload('download', primaryUrl.value))
}

async function copyCode() {
  if (!props.interactive) return
  try {
    await copyText(text('code'))
    copied.value = true
    emit('copy', actionPayload('copy'))
    window.setTimeout(() => { copied.value = false }, 1600)
  } catch (reason) {
    emitFailure('copy', reason, '复制失败')
  }
}

async function revealSensitive() {
  if (!props.interactive || decrypting.value || password.value.length < 8 || !sensitiveValid.value || !sensitiveCryptoAvailable.value) return
  decrypting.value = true
  decryptError.value = ''
  try {
    plaintext.value = await decryptSensitiveCard(data.value, password.value)
    password.value = ''
    emit('unlock', actionPayload('unlock'))
  } catch (reason) {
    decryptError.value = reason instanceof Error ? reason.message : '无法解密'
    emitFailure('decrypt', reason, decryptError.value)
  } finally {
    decrypting.value = false
  }
}

function hideSensitive() {
  plaintext.value = null
  password.value = ''
  decryptError.value = ''
  emit('hide', actionPayload('hide'))
}

function emitFailure(operation: ContentCardError['operation'], reason: unknown, fallback: string) {
  emit('error', {
    card: normalized.value,
    operation,
    message: reason instanceof Error ? reason.message : fallback,
  })
}
</script>

<template>
  <v-card
    class="content-card"
    :class="[{ 'content-card--compact': compact }, `content-card--${normalized.kind}`]"
    variant="outlined"
    :data-card-kind="normalized.kind"
    :data-card-id="normalized.cardId"
  >
    <template v-if="normalized.kind === 'bookmark'">
      <a
        class="bookmark-card"
        data-testid="bookmark-card"
        :href="interactive && primaryUrl ? primaryUrl : undefined"
        target="_blank"
        rel="noopener noreferrer nofollow"
        @click="handleOpen($event, primaryUrl)"
      >
        <v-avatar class="bookmark-card__icon" color="surface-variant" rounded="lg" size="44">
          <v-img v-if="iconUrl" :src="iconUrl" :alt="`${text('title', '网页')}图标`" />
          <v-icon v-else icon="mdi-web" color="primary" />
        </v-avatar>
        <div class="content-card__body">
          <div class="content-card__eyebrow">{{ text('siteName') || displayHostname(data.url) }}</div>
          <div class="content-card__title">{{ text('title') || displayHostname(data.url) }}</div>
          <p v-if="text('description')" class="content-card__description">{{ text('description') }}</p>
          <span v-if="primaryUrl" class="content-card__url">{{ primaryUrl }}</span>
        </div>
        <v-icon icon="mdi-open-in-new" size="18" color="secondary" />
      </a>
      <v-alert v-if="hasConfiguredUrl && !primaryUrl" class="ma-3 mt-0" type="warning" variant="tonal" density="compact">
        该链接未通过安全校验，仅支持本站相对路径或 HTTPS 地址。
      </v-alert>
    </template>

    <template v-else-if="normalized.kind === 'code'">
      <div class="code-card__toolbar">
        <div>
          <span class="content-card__eyebrow">{{ text('language', 'text') }}</span>
          <strong v-if="text('title')">{{ text('title') }}</strong>
        </div>
        <v-btn
          :aria-label="copied ? '已复制代码' : '复制代码'"
          :disabled="!interactive || !text('code')"
          :icon="copied ? 'mdi-check' : 'mdi-content-copy'"
          :color="copied ? 'success' : undefined"
          size="small"
          variant="text"
          @click="copyCode"
        />
      </div>
      <pre class="code-card__pre"><code>{{ text('code', '// 暂无代码') }}</code></pre>
    </template>

    <template v-else-if="normalized.kind === 'attachment'">
      <div class="attachment-card">
        <v-avatar color="info" variant="tonal" rounded="lg" size="48">
          <v-icon icon="mdi-file-outline" />
        </v-avatar>
        <div class="content-card__body">
          <div class="content-card__title">{{ text('name', '未命名附件') }}</div>
          <div v-if="attachmentMeta" class="content-card__eyebrow">{{ attachmentMeta }}</div>
          <p v-if="text('description')" class="content-card__description">{{ text('description') }}</p>
        </div>
        <div class="attachment-card__actions">
          <v-btn
            v-if="primaryUrl"
            :href="interactive ? primaryUrl : undefined"
            target="_blank"
            rel="noopener noreferrer"
            icon="mdi-open-in-new"
            aria-label="打开附件"
            size="small"
            variant="text"
            @click="handleOpen($event, primaryUrl)"
          />
          <v-btn
            v-if="primaryUrl"
            :href="interactive ? primaryUrl : undefined"
            download
            icon="mdi-download"
            aria-label="下载附件"
            size="small"
            variant="tonal"
            color="primary"
            @click="handleDownload"
          />
        </div>
      </div>
      <v-alert v-if="!primaryUrl" class="ma-3 mt-0" type="warning" variant="tonal" density="compact">
        附件地址缺失或未通过安全校验。
      </v-alert>
    </template>

    <template v-else-if="normalized.kind === 'image'">
      <figure class="media-card">
        <v-img
          v-if="primaryUrl"
          :class="['content-card-image', imageWidthClass]"
          :src="primaryUrl"
          :alt="text('alt', '内容图片')"
          cover
        >
          <template #error>
            <div class="media-card__empty"><v-icon icon="mdi-image-broken-variant" />图片加载失败</div>
          </template>
        </v-img>
        <div v-else class="media-card__empty"><v-icon icon="mdi-image-off-outline" />图片地址无效</div>
        <figcaption v-if="text('caption')">{{ text('caption') }}</figcaption>
      </figure>
    </template>

    <template v-else-if="normalized.kind === 'video'">
      <figure class="media-card">
        <video
          v-if="primaryUrl"
          class="video-card__player"
          :src="primaryUrl"
          :poster="posterUrl || undefined"
          :aria-label="text('title', '视频')"
          controls
          playsinline
          preload="metadata"
        />
        <div v-else class="media-card__empty"><v-icon icon="mdi-video-off-outline" />视频地址无效</div>
        <figcaption v-if="text('title') || text('caption')">
          <strong>{{ text('title', '视频') }}</strong><span v-if="text('caption')">{{ text('caption') }}</span>
        </figcaption>
      </figure>
    </template>

    <template v-else-if="normalized.kind === 'iframe'">
      <div class="iframe-card__header">
        <div>
          <div class="content-card__eyebrow">安全嵌入</div>
          <div class="content-card__title">{{ text('title', '网页嵌入') }}</div>
        </div>
        <v-btn
          v-if="safeResourceUrl(data.url)"
          :href="interactive ? safeResourceUrl(data.url) || undefined : undefined"
          target="_blank"
          rel="noopener noreferrer nofollow"
          icon="mdi-open-in-new"
          aria-label="在新窗口打开嵌入网页"
          size="small"
          variant="text"
          @click="handleOpen($event, safeResourceUrl(data.url))"
        />
      </div>
      <iframe
        v-if="iframeUrl"
        class="iframe-card__frame"
        :src="iframeUrl"
        :title="text('title', '网页嵌入')"
        :style="{ height: iframeHeight }"
        sandbox="allow-scripts allow-forms allow-popups allow-presentation"
        referrerpolicy="no-referrer"
        loading="lazy"
        allow="fullscreen; picture-in-picture"
      />
      <v-alert v-else type="warning" variant="tonal" class="ma-3 mt-0" density="compact">
        {{ allowIframes ? '嵌入地址未通过安全校验或不在允许域名中。' : '当前页面已禁用 iframe 嵌入。' }}
      </v-alert>
    </template>

    <template v-else-if="normalized.kind === 'callout'">
      <v-alert
        :color="calloutStyle.color"
        :icon="calloutStyle.icon"
        variant="tonal"
        class="callout-card"
      >
        <div v-if="text('title')" class="content-card__title">{{ text('title') }}</div>
        <div>{{ text('text', '提示内容为空') }}</div>
      </v-alert>
    </template>

    <template v-else-if="normalized.kind === 'status'">
      <div class="status-card">
        <v-chip :color="statusStyle.color" :prepend-icon="statusStyle.icon" variant="tonal" label>
          {{ text('label') || statusStyle.label }}
        </v-chip>
        <p v-if="text('description')">{{ text('description') }}</p>
      </div>
    </template>

    <template v-else-if="normalized.kind === 'sensitive-text'">
      <div class="sensitive-card">
        <v-avatar color="error" variant="tonal" rounded="lg" size="48">
          <v-icon icon="mdi-shield-lock-outline" />
        </v-avatar>
        <div class="content-card__body">
          <template v-if="plaintext === null">
            <div class="content-card__title">受保护的敏感内容</div>
            <p class="content-card__description">{{ text('hint', '输入查看密码后在本机解密，密码不会上传。') }}</p>
            <v-alert
              v-if="sensitiveValid && !sensitiveCryptoAvailable"
              class="mt-3"
              type="warning"
              variant="tonal"
              density="compact"
            >
              {{ SENSITIVE_CARD_HTTPS_MESSAGE }}密文仍保持加密状态，未被修改。
            </v-alert>
            <form v-if="sensitiveValid" class="sensitive-card__form" @submit.prevent="revealSensitive">
              <v-text-field
                v-model="password"
                label="查看密码"
                aria-label="敏感内容查看密码"
                type="password"
                autocomplete="off"
                minlength="8"
                maxlength="200"
                density="compact"
                :disabled="!interactive || decrypting || !sensitiveCryptoAvailable"
                :error-messages="decryptError"
              />
              <v-btn
                type="submit"
                color="primary"
                variant="tonal"
                prepend-icon="mdi-eye-outline"
                :loading="decrypting"
                :disabled="!interactive || password.length < 8 || !sensitiveCryptoAvailable"
              >查看</v-btn>
            </form>
            <v-alert v-else type="error" variant="tonal" density="compact">加密数据无效，无法解密。</v-alert>
          </template>
          <template v-else>
            <div class="sensitive-card__revealed-header">
              <div class="content-card__title">{{ text('hint', '敏感内容') }}</div>
              <v-btn prepend-icon="mdi-eye-off-outline" size="small" variant="text" @click="hideSensitive">重新隐藏</v-btn>
            </div>
            <pre class="sensitive-card__plaintext">{{ plaintext }}</pre>
          </template>
        </div>
      </div>
    </template>

    <template v-else>
      <v-alert type="warning" variant="tonal" class="unknown-card" icon="mdi-puzzle-outline">
        <div class="content-card__title">暂不支持此内容卡</div>
        <p>类型：{{ normalized.cardId }}</p>
        <p v-for="warning in normalized.warnings" :key="warning">{{ warning }}</p>
        <details v-if="rawPreview"><summary>查看保留的原始数据</summary><pre>{{ rawPreview }}</pre></details>
      </v-alert>
    </template>
  </v-card>
</template>

<style scoped>
.content-card { max-width: 100%; overflow: hidden; border-color: rgba(var(--v-border-color), .55); background: rgb(var(--v-theme-surface)); }
.content-card__body { min-width: 0; flex: 1; }
.content-card__eyebrow { color: rgb(var(--v-theme-secondary)); font-size: .75rem; font-weight: 650; line-height: 1.35; text-transform: none; }
.content-card__title { color: rgb(var(--v-theme-on-surface)); font-size: .96rem; font-weight: 700; line-height: 1.45; }
.content-card__description { margin: 4px 0 0; color: rgba(var(--v-theme-on-surface), .68); font-size: .86rem; line-height: 1.55; }
.content-card__url { display: block; max-width: 100%; margin-top: 6px; overflow: hidden; color: rgb(var(--v-theme-primary)); font-size: .76rem; text-overflow: ellipsis; white-space: nowrap; }
.bookmark-card { display: flex; align-items: center; gap: 12px; min-height: 84px; padding: 16px; color: inherit; text-decoration: none; transition: background-color .16s ease, border-color .16s ease; }
.bookmark-card:hover { background: rgba(var(--v-theme-primary), .045); }
.bookmark-card__icon { flex: 0 0 auto; }
.code-card__toolbar, .iframe-card__header, .sensitive-card__revealed-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 14px; border-bottom: 1px solid rgba(var(--v-border-color), .45); }
.code-card__toolbar > div { display: flex; align-items: baseline; gap: 10px; }
.code-card__pre { max-height: 520px; margin: 0; overflow: auto; padding: 18px; background: #111827; color: #e5e7eb; font: 13px/1.65 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; tab-size: 2; white-space: pre; }
.attachment-card { display: flex; align-items: center; gap: 12px; min-height: 82px; padding: 16px; }
.attachment-card__actions { display: flex; align-items: center; gap: 4px; }
.media-card { margin: 0; }
.content-card-image { margin-inline: auto; background: rgb(var(--v-theme-surface-variant)); }
.content-card-image--small { max-width: 320px; }
.content-card-image--medium { max-width: 560px; }
.content-card-image--large { max-width: 880px; }
.content-card-image--full { width: 100%; }
.video-card__player { display: block; width: 100%; max-height: 680px; background: #05070a; }
.media-card__empty { display: flex; min-height: 180px; align-items: center; justify-content: center; gap: 8px; background: rgb(var(--v-theme-surface-variant)); color: rgb(var(--v-theme-secondary)); }
.media-card figcaption { display: flex; gap: 10px; padding: 10px 14px; color: rgb(var(--v-theme-secondary)); font-size: .82rem; }
.iframe-card__frame { display: block; width: 100%; border: 0; background: rgb(var(--v-theme-surface-variant)); }
.callout-card { border: 0; border-radius: 0; }
.status-card { display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.status-card p { margin: 0; color: rgb(var(--v-theme-secondary)); font-size: .88rem; }
.sensitive-card { display: flex; align-items: flex-start; gap: 14px; padding: 16px; }
.sensitive-card__form { display: flex; align-items: flex-start; gap: 10px; max-width: 520px; margin-top: 12px; }
.sensitive-card__form :deep(.v-input) { flex: 1; }
.sensitive-card__plaintext, .unknown-card pre { max-height: 360px; margin: 10px 0 0; overflow: auto; border-radius: 8px; padding: 12px; background: rgba(var(--v-theme-on-surface), .055); color: inherit; font: 13px/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.unknown-card p { margin: 4px 0 0; }
.unknown-card details { margin-top: 8px; }
.content-card--compact .content-card__description, .content-card--compact .content-card__url { display: none; }
.content-card--compact .bookmark-card, .content-card--compact .attachment-card, .content-card--compact .sensitive-card { min-height: 62px; padding: 10px 12px; }
@media (max-width: 600px) {
  .attachment-card, .sensitive-card { align-items: flex-start; }
  .attachment-card__actions { flex-direction: column; }
  .sensitive-card__form { align-items: stretch; flex-direction: column; }
}
</style>
