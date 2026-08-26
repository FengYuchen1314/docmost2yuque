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
  selected?: boolean
  loading?: boolean
  uploading?: boolean
  errorMessage?: string
}>(), {
  compact: false,
  interactive: true,
  allowIframes: true,
  iframeAllowHosts: () => [],
  selected: false,
  loading: false,
  uploading: false,
  errorMessage: '',
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
let decryptSequence = 0

const cardIdentity = computed(() => stableIdentity({
  cardId: normalized.value.cardId,
  instanceId: normalized.value.instanceId,
  version: normalized.value.version,
  data: normalized.value.data,
}))

watch(cardIdentity, () => {
  decryptSequence += 1
  password.value = ''
  plaintext.value = null
  decrypting.value = false
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
const codeLines = computed(() => text('code', '// 暂无代码').split('\n'))
const pending = computed(() => props.loading || props.uploading)
const stateName = computed(() => {
  if (props.errorMessage) return 'error'
  if (props.uploading) return 'uploading'
  if (props.loading) return 'loading'
  return props.interactive ? 'ready' : 'readonly'
})
const kindLabel = computed(() => ({
  bookmark: '网页书签',
  code: '代码块',
  attachment: '附件',
  image: '图片',
  video: '视频',
  iframe: '网页嵌入',
  callout: '提示块',
  status: '状态',
  'sensitive-text': '加密内容',
  unknown: '未知内容卡',
})[normalized.value.kind])

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
  const sequence = ++decryptSequence
  const identity = cardIdentity.value
  const encryptedData = { ...data.value }
  const submittedPassword = password.value
  decrypting.value = true
  decryptError.value = ''
  try {
    const revealed = await decryptSensitiveCard(encryptedData, submittedPassword)
    if (sequence !== decryptSequence || identity !== cardIdentity.value) return
    plaintext.value = revealed
    password.value = ''
    emit('unlock', actionPayload('unlock'))
  } catch (reason) {
    if (sequence !== decryptSequence || identity !== cardIdentity.value) return
    decryptError.value = reason instanceof Error ? reason.message : '无法解密'
    emitFailure('decrypt', reason, decryptError.value)
  } finally {
    if (sequence === decryptSequence && identity === cardIdentity.value) decrypting.value = false
  }
}

function hideSensitive() {
  decryptSequence += 1
  plaintext.value = null
  password.value = ''
  decryptError.value = ''
  decrypting.value = false
  emit('hide', actionPayload('hide'))
}

function emitFailure(operation: ContentCardError['operation'], reason: unknown, fallback: string) {
  emit('error', {
    card: normalized.value,
    operation,
    message: reason instanceof Error ? reason.message : fallback,
  })
}

function stableIdentity(value: unknown, seen = new WeakSet<object>()): string {
  if (value === null) return 'null'
  if (typeof value === 'string') return `string:${JSON.stringify(value)}`
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return `${typeof value}:${String(value)}`
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value !== 'object') return `${typeof value}:${String(value)}`
  if (seen.has(value)) return '[circular]'
  seen.add(value)
  const result = Array.isArray(value)
    ? `[${value.map((item) => stableIdentity(item, seen)).join(',')}]`
    : `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableIdentity((value as Record<string, unknown>)[key], seen)}`).join(',')}}`
  seen.delete(value)
  return result
}
</script>

<template>
  <v-card
    class="content-card"
    :class="[
      {
        'content-card--compact': compact,
        'content-card--interactive': interactive,
        'content-card--readonly': !interactive,
        'content-card--selected': selected,
        'content-card--pending': pending,
        'content-card--error': Boolean(errorMessage),
      },
      `content-card--${normalized.kind}`,
    ]"
    variant="outlined"
    :tabindex="interactive && !pending && !errorMessage ? 0 : undefined"
    :aria-label="`${kindLabel}内容卡`"
    :aria-busy="pending ? 'true' : undefined"
    :aria-readonly="!interactive ? 'true' : undefined"
    :data-card-kind="normalized.kind"
    :data-card-id="normalized.cardId"
    :data-card-state="stateName"
  >
    <div v-if="pending" class="content-card-state" role="status" data-testid="content-card-pending">
      <span class="content-card-state__spinner" aria-hidden="true" />
      <div>
        <strong>{{ uploading ? '正在上传' : '正在加载' }}</strong>
        <span>{{ uploading ? '文件处理完成后会自动显示' : '正在准备卡片内容' }}</span>
      </div>
    </div>

    <div v-else-if="errorMessage" class="content-card-state content-card-state--error" role="alert" data-testid="content-card-error">
      <v-icon icon="mdi-alert-circle-outline" size="20" />
      <div><strong>内容卡加载失败</strong><span>{{ errorMessage }}</span></div>
    </div>

    <template v-else-if="normalized.kind === 'bookmark'">
      <a
        class="bookmark-card"
        data-testid="bookmark-card"
        :href="interactive && primaryUrl ? primaryUrl : undefined"
        target="_blank"
        rel="noopener noreferrer nofollow"
        @click="handleOpen($event, primaryUrl)"
      >
        <v-avatar class="bookmark-card__icon" color="surface-variant" rounded="sm" size="36">
          <v-img v-if="iconUrl" :src="iconUrl" :alt="`${text('title', '网页')}图标`" />
          <v-icon v-else icon="mdi-web" color="primary" size="20" />
        </v-avatar>
        <div class="content-card__body">
          <div class="content-card__eyebrow">{{ text('siteName') || displayHostname(data.url) }}</div>
          <div class="content-card__title">{{ text('title') || displayHostname(data.url) }}</div>
          <p v-if="text('description')" class="content-card__description">{{ text('description') }}</p>
          <span v-if="primaryUrl" class="content-card__url">{{ primaryUrl }}</span>
        </div>
        <span class="bookmark-card__open" aria-hidden="true"><v-icon icon="mdi-open-in-new" size="17" /></span>
      </a>
      <v-alert v-if="hasConfiguredUrl && !primaryUrl" class="ma-3 mt-0" type="warning" variant="tonal" density="compact">
        该链接未通过安全校验，仅支持本站相对路径或不含账号凭据的 HTTP/HTTPS 地址。
      </v-alert>
    </template>

    <template v-else-if="normalized.kind === 'code'">
      <div class="code-card__toolbar">
        <div class="code-card__title">
          <v-icon icon="mdi-menu-down" size="16" aria-hidden="true" />
          <strong v-if="text('title')">{{ text('title') }}</strong>
        </div>
        <div class="code-card__actions">
          <span class="code-card__language">{{ text('language', 'Plain Text') }}</span>
          <v-btn
            :aria-label="copied ? '已复制代码' : '复制代码'"
            :disabled="!interactive || !text('code')"
            :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'"
            :color="copied ? 'success' : undefined"
            size="x-small"
            variant="text"
            @click="copyCode"
          >{{ copied ? '已复制' : '复制代码' }}</v-btn>
        </div>
      </div>
      <pre class="code-card__pre" aria-label="代码内容"><code><span v-for="(line, index) in codeLines" :key="index" class="code-card__line"><span class="code-card__line-number" aria-hidden="true">{{ index + 1 }}</span><span class="code-card__line-content">{{ line || ' ' }}</span></span></code></pre>
    </template>

    <template v-else-if="normalized.kind === 'attachment'">
      <div class="attachment-card">
        <v-avatar class="attachment-card__icon" color="info" variant="tonal" rounded="sm" size="36">
          <v-icon icon="mdi-file-outline" size="20" />
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
            size="x-small"
            variant="text"
            @click="handleOpen($event, primaryUrl)"
          />
          <v-btn
            v-if="primaryUrl"
            :href="interactive ? primaryUrl : undefined"
            download
            icon="mdi-download"
            aria-label="下载附件"
            size="x-small"
            variant="text"
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
        <div v-if="primaryUrl && interactive" class="media-card__toolbar" aria-label="图片操作">
          <v-btn
            :href="primaryUrl"
            target="_blank"
            rel="noopener noreferrer"
            prepend-icon="mdi-open-in-new"
            size="x-small"
            variant="flat"
            @click="handleOpen($event, primaryUrl)"
          >打开原图</v-btn>
        </div>
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
        <div v-if="primaryUrl && interactive" class="media-card__toolbar" aria-label="视频操作">
          <v-btn
            :href="primaryUrl"
            target="_blank"
            rel="noopener noreferrer"
            prepend-icon="mdi-open-in-new"
            size="x-small"
            variant="flat"
            @click="handleOpen($event, primaryUrl)"
          >新窗口打开</v-btn>
        </div>
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
        <div class="iframe-card__title">
          <v-icon icon="mdi-menu-down" size="16" aria-hidden="true" />
          <span>{{ text('title', '网页嵌入') }}</span>
        </div>
        <v-btn
          v-if="safeResourceUrl(data.url)"
          :href="interactive ? safeResourceUrl(data.url) || undefined : undefined"
          target="_blank"
          rel="noopener noreferrer nofollow"
          icon="mdi-open-in-new"
          aria-label="在新窗口打开嵌入网页"
          size="x-small"
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
        <v-avatar class="sensitive-card__icon" color="error" variant="tonal" rounded="sm" size="36">
          <v-icon icon="mdi-shield-lock-outline" size="20" />
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
      <div class="unknown-card">
        <div class="unknown-card__header">
          <v-icon icon="mdi-puzzle-outline" size="18" />
          <strong>暂不支持此内容卡</strong>
          <span>{{ normalized.cardId }}</span>
        </div>
        <div class="unknown-card__body">
          <p v-for="warning in normalized.warnings" :key="warning">{{ warning }}</p>
          <details v-if="rawPreview"><summary>查看保留的原始数据</summary><pre>{{ rawPreview }}</pre></details>
        </div>
      </div>
    </template>
  </v-card>
</template>

<style scoped>
.content-card {
  position: relative;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid #e7e9e8 !important;
  border-radius: 6px !important;
  background: #fff !important;
  box-shadow: none !important;
  color: #262626;
  outline: none;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}
.content-card--interactive:hover,
.content-card--interactive:focus,
.content-card--interactive:focus-within,
.content-card--selected {
  border-color: #7ba8ff !important;
  box-shadow: 0 0 0 1px #7ba8ff !important;
}
.content-card--error { border-color: #ffccc7 !important; }
.content-card--readonly { cursor: default; }
.content-card__body { min-width: 0; flex: 1; }
.content-card__eyebrow { color: #8c8c8c; font-size: 12px; font-weight: 400; line-height: 18px; }
.content-card__title { overflow: hidden; color: #262626; font-size: 14px; font-weight: 600; line-height: 22px; text-overflow: ellipsis; white-space: nowrap; }
.content-card__description { display: -webkit-box; margin: 2px 0 0; overflow: hidden; color: #8c8c8c; font-size: 13px; line-height: 20px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.content-card__url { display: block; max-width: 100%; margin-top: 2px; overflow: hidden; color: #1677ff; font-size: 12px; line-height: 18px; text-overflow: ellipsis; white-space: nowrap; }
.content-card-state { display: flex; min-height: 66px; align-items: center; gap: 10px; padding: 12px 14px; background: #fafafa; color: #595959; }
.content-card-state > div { display: flex; min-width: 0; flex-direction: column; }
.content-card-state__spinner { width: 18px; height: 18px; flex: 0 0 auto; border: 2px solid #d6e4ff; border-top-color: #2f68f6; border-radius: 50%; animation: content-card-spin 700ms linear infinite; }
.content-card-state strong { color: #262626; font-size: 14px; font-weight: 600; line-height: 22px; }
.content-card-state span { color: #8c8c8c; font-size: 12px; line-height: 18px; }
.content-card-state--error { background: #fff7f6; color: #d4380d; }
.content-card-state--error strong { color: #a8071a; }
.content-card-state--error span { color: #cf1322; }
@keyframes content-card-spin { to { transform: rotate(360deg); } }
.bookmark-card { display: flex; min-height: 68px; align-items: center; gap: 10px; padding: 10px 12px; color: inherit; text-decoration: none; transition: background-color 120ms ease; }
.bookmark-card:hover { background: #fafafa; }
.bookmark-card__icon { flex: 0 0 auto; border-radius: 6px !important; }
.bookmark-card__open { display: grid; width: 28px; height: 28px; flex: 0 0 auto; place-items: center; border-radius: 4px; color: #8c8c8c; opacity: 0; transition: opacity 120ms ease, background-color 120ms ease; }
.content-card--selected .bookmark-card__open,
.content-card:focus-within .bookmark-card__open,
.content-card:hover .bookmark-card__open { opacity: 1; }
.bookmark-card__open:hover { background: #f0f0f0; color: #262626; }
.code-card__toolbar,
.iframe-card__header {
  display: flex;
  height: 38px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 10px;
  border-bottom: 1px solid #ededed;
  background: #f5f5f5;
}
.code-card__title, .iframe-card__title { display: flex; min-width: 0; align-items: center; gap: 7px; color: #595959; font-size: 13px; line-height: 20px; }
.code-card__title strong, .iframe-card__title span { overflow: hidden; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.code-card__actions { display: flex; height: 100%; flex: 0 0 auto; align-items: center; gap: 4px; }
.code-card__language { color: #b3b3b3; font-size: 12px; line-height: 18px; }
.code-card__actions :deep(.v-btn), .iframe-card__header :deep(.v-btn) { min-width: 0; height: 28px; padding: 0 6px; color: #595959; font-size: 12px; letter-spacing: 0; }
.code-card__pre { max-height: 520px; min-height: 38px; margin: 0; overflow: auto; padding: 8px 0 9px; background: #fff; color: #262626; font: 13px/22px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-variant-ligatures: none; tab-size: 2; white-space: pre; }
.code-card__line { display: flex; min-width: max-content; }
.code-card__line-number { width: 40px; flex: 0 0 40px; padding-right: 10px; color: #bfbfbf; text-align: right; user-select: none; }
.code-card__line-content { padding-right: 12px; }
.attachment-card { display: flex; min-height: 64px; align-items: center; gap: 10px; padding: 10px 12px; }
.attachment-card__icon { flex: 0 0 auto; border-radius: 6px !important; }
.attachment-card__actions { display: flex; flex: 0 0 auto; align-items: center; gap: 2px; opacity: 0; transition: opacity 120ms ease; }
.content-card--selected .attachment-card__actions,
.content-card:focus-within .attachment-card__actions,
.content-card:hover .attachment-card__actions { opacity: 1; }
.attachment-card__actions :deep(.v-btn) { width: 28px; height: 28px; color: #595959; }
.media-card { position: relative; margin: 0; }
.media-card__toolbar { position: absolute; z-index: 2; top: 8px; right: 8px; display: flex; align-items: center; opacity: 0; transform: translateY(-2px); transition: opacity 120ms ease, transform 120ms ease; }
.content-card--selected .media-card__toolbar,
.content-card:focus-within .media-card__toolbar,
.content-card:hover .media-card__toolbar { opacity: 1; transform: translateY(0); }
.media-card__toolbar :deep(.v-btn) { height: 28px; border: 1px solid #e7e9e8; border-radius: 4px; background: rgba(255, 255, 255, .96) !important; box-shadow: 0 2px 8px rgba(0, 0, 0, .08); color: #595959; font-size: 12px; letter-spacing: 0; }
.content-card-image { margin-inline: auto; background: #f5f5f5; }
.content-card-image--small { max-width: 320px; }
.content-card-image--medium { max-width: 560px; }
.content-card-image--large { max-width: 880px; }
.content-card-image--full { width: 100%; }
.video-card__player { display: block; width: 100%; max-height: 680px; background: #050505; }
.media-card__empty { display: flex; min-height: 148px; align-items: center; justify-content: center; gap: 8px; background: #fafafa; color: #8c8c8c; font-size: 13px; }
.media-card figcaption { display: flex; gap: 8px; padding: 7px 10px; border-top: 1px solid #f0f0f0; color: #8c8c8c; font-size: 12px; line-height: 20px; }
.iframe-card__frame { display: block; width: 100%; border: 0; background: #fafafa; }
.callout-card { border: 0 !important; border-radius: 0 !important; }
.content-card--bookmark :deep(.v-alert),
.content-card--attachment :deep(.v-alert),
.content-card--iframe :deep(.v-alert),
.content-card--sensitive-text :deep(.v-alert) { margin: 0 !important; border-radius: 0 !important; padding: 8px 10px; border-top: 1px solid #ededed; font-size: 12px; line-height: 18px; }
.content-card--bookmark :deep(.v-alert__prepend),
.content-card--attachment :deep(.v-alert__prepend),
.content-card--iframe :deep(.v-alert__prepend),
.content-card--sensitive-text :deep(.v-alert__prepend) { margin-inline-end: 8px; }
.callout-card :deep(.v-alert__prepend) { margin-inline-end: 10px; }
.callout-card :deep(.v-alert__content) { font-size: 14px; line-height: 22px; }
.status-card { display: flex; min-height: 48px; align-items: center; gap: 10px; padding: 8px 10px; }
.status-card :deep(.v-chip) { height: 26px; border-radius: 4px; font-size: 12px; }
.status-card p { margin: 0; color: #8c8c8c; font-size: 13px; line-height: 20px; }
.sensitive-card { display: flex; min-height: 64px; align-items: flex-start; gap: 10px; padding: 12px; }
.sensitive-card__icon { flex: 0 0 auto; border-radius: 6px !important; }
.sensitive-card__form { display: flex; max-width: 520px; align-items: flex-start; gap: 8px; margin-top: 8px; }
.sensitive-card__form :deep(.v-input) { flex: 1; }
.sensitive-card__form :deep(.v-btn) { height: 40px; }
.sensitive-card__revealed-header { display: flex; min-height: 32px; align-items: center; justify-content: space-between; gap: 8px; }
.sensitive-card__plaintext, .unknown-card pre { max-height: 360px; margin: 8px 0 0; overflow: auto; border-radius: 4px; padding: 9px 10px; background: #f5f5f5; color: #262626; font: 12px/20px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; white-space: pre-wrap; word-break: break-word; }
.unknown-card__header { display: flex; height: 38px; align-items: center; gap: 8px; padding: 0 10px; border-bottom: 1px solid #ededed; background: #f5f5f5; color: #595959; }
.unknown-card__header strong { font-size: 13px; font-weight: 600; }
.unknown-card__header span { overflow: hidden; color: #8c8c8c; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.unknown-card__body { padding: 9px 10px 10px; background: #fffdf5; color: #8c6d1f; font-size: 12px; line-height: 20px; }
.unknown-card p { margin: 0; }
.unknown-card details { margin-top: 4px; }
.unknown-card summary { color: #595959; cursor: pointer; user-select: none; }
.content-card--compact .content-card__description, .content-card--compact .content-card__url { display: none; }
.content-card--compact .bookmark-card, .content-card--compact .attachment-card, .content-card--compact .sensitive-card { min-height: 54px; padding: 7px 9px; }
.content-card--compact .bookmark-card__icon, .content-card--compact .attachment-card__icon, .content-card--compact .sensitive-card__icon { width: 32px !important; height: 32px !important; }
@media (max-width: 600px) {
  .content-card { border-radius: 4px !important; }
  .code-card__toolbar, .iframe-card__header { padding-inline: 8px; }
  .code-card__language { display: none; }
  .bookmark-card { align-items: flex-start; }
  .bookmark-card__open, .attachment-card__actions, .media-card__toolbar { opacity: 1; transform: none; }
  .attachment-card, .sensitive-card { align-items: flex-start; }
  .attachment-card__actions { flex-direction: row; }
  .sensitive-card__form { align-items: stretch; flex-direction: column; }
}
@media (prefers-reduced-motion: reduce) {
  .content-card, .bookmark-card, .bookmark-card__open, .attachment-card__actions, .media-card__toolbar { transition: none; }
  .content-card-state__spinner { animation-duration: 1400ms; }
}
</style>
