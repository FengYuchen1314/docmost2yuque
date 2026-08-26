<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import type {
  ContentCardCreateEvent,
  ContentCardDefinition,
  ContentCardError,
  ContentCardInput,
  ContentCardKind,
  ContentCardUploadCompleteEvent,
  ContentCardUploadEvent,
  ContentCardUploadHandler,
} from '../../types/content-card'
import {
  CONTENT_CARD_DEFINITIONS,
  createContentCardNode,
  encodeContentCardToken,
  normalizeContentCard,
  safeResourceUrl,
} from './contentCardModel'
import {
  encryptSensitiveCard,
  isSensitiveCardCryptoAvailable,
  isSensitiveCardEnvelope,
  SENSITIVE_CARD_HTTPS_MESSAGE,
} from './sensitiveCardCrypto'

type PaletteKind = Exclude<ContentCardKind, 'unknown'>

interface PaletteForm {
  kind: PaletteKind
  title: string
  url: string
  description: string
  siteName: string
  language: string
  code: string
  name: string
  size: number | null
  mimeType: string
  alt: string
  caption: string
  width: 'SMALL' | 'MEDIUM' | 'LARGE' | 'FULL'
  poster: string
  height: number
  tone: 'INFO' | 'SUCCESS' | 'WARNING' | 'DANGER'
  text: string
  status: 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'DONE' | 'CANCELLED'
  label: string
  hint: string
  plaintext: string
  password: string
  passwordConfirm: string
}

const props = withDefaults(defineProps<{
  modelValue: boolean
  initialCard?: ContentCardInput | null
  definitions?: ContentCardDefinition[]
  allowedKinds?: PaletteKind[]
  uploadHandler?: ContentCardUploadHandler
  busy?: boolean
  closeOnInsert?: boolean
}>(), {
  initialCard: null,
  definitions: () => CONTENT_CARD_DEFINITIONS,
  allowedKinds: () => [],
  uploadHandler: undefined,
  busy: false,
  closeOnInsert: true,
})

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  insert: [payload: ContentCardCreateEvent]
  cancel: []
  error: [payload: ContentCardError]
  'upload-start': [payload: ContentCardUploadEvent]
  'upload-complete': [payload: ContentCardUploadCompleteEvent]
}>()

const form = reactive<PaletteForm>(blankForm())
const submitting = ref(false)
const uploading = ref(false)
const touched = ref(false)
const operationError = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const existingSensitiveData = ref<Record<string, unknown> | null>(null)
const originalIdentity = ref<{ instanceId: string; version: number } | null>(null)
let formContextVersion = 0
let uploadSequence = 0
let submitSequence = 0

const availableDefinitions = computed(() => {
  if (!props.allowedKinds.length) return props.definitions
  const allowed = new Set(props.allowedKinds)
  return props.definitions.filter((definition) => allowed.has(definition.kind))
})
const selectedDefinition = computed(() =>
  availableDefinitions.value.find((definition) => definition.kind === form.kind)
  ?? availableDefinitions.value[0]
  ?? CONTENT_CARD_DEFINITIONS[0]!,
)
const uploadable = computed(() => ['attachment', 'image', 'video'].includes(form.kind))
const uploadAccept = computed(() => form.kind === 'image' ? 'image/*' : form.kind === 'video' ? 'video/*' : undefined)
const hasExistingSensitive = computed(() => Boolean(existingSensitiveData.value))
const sensitiveCryptoAvailable = computed(() => isSensitiveCardCryptoAvailable())
const sensitiveEncryptionRequired = computed(() => form.kind === 'sensitive-text'
  && (!hasExistingSensitive.value || Boolean(form.plaintext)))
const sensitiveEncryptionUnavailable = computed(() => sensitiveEncryptionRequired.value && !sensitiveCryptoAvailable.value)
const validationMessage = computed(() => validateForm())
const pending = computed(() => props.busy || submitting.value || uploading.value)
const initialCardIdentity = computed(() => {
  if (props.initialCard == null) return 'new-card'
  const card = normalizeContentCard(props.initialCard)
  return stableIdentity({ cardId: card.cardId, instanceId: card.instanceId, version: card.version, data: card.data })
})

watch(() => props.modelValue, (open) => {
  if (open) resetFromInitial()
})
watch(() => props.initialCard, () => {
  if (props.modelValue) resetFromInitial()
})

function blankForm(): PaletteForm {
  return {
    kind: 'bookmark', title: '', url: '', description: '', siteName: '', language: 'text', code: '',
    name: '', size: null, mimeType: '', alt: '', caption: '', width: 'LARGE', poster: '', height: 420,
    tone: 'INFO', text: '', status: 'TODO', label: '', hint: '', plaintext: '', password: '', passwordConfirm: '',
  }
}

function resetFromInitial() {
  formContextVersion += 1
  Object.assign(form, blankForm())
  operationError.value = ''
  touched.value = false
  existingSensitiveData.value = null
  originalIdentity.value = null

  if (props.initialCard == null) {
    form.kind = availableDefinitions.value[0]?.kind ?? 'bookmark'
    return
  }
  const card = normalizeContentCard(props.initialCard)
  const supported = availableDefinitions.value.some((definition) => definition.kind === card.kind)
  form.kind = supported && card.kind !== 'unknown' ? card.kind : (availableDefinitions.value[0]?.kind ?? 'bookmark')
  originalIdentity.value = { instanceId: card.instanceId, version: card.version }
  const value = card.data
  form.title = field(value, 'title')
  form.url = field(value, 'url')
  form.description = field(value, 'description')
  form.siteName = field(value, 'siteName')
  form.language = field(value, 'language') || 'text'
  form.code = field(value, 'code')
  form.name = field(value, 'name')
  form.size = typeof value.size === 'number' ? value.size : null
  form.mimeType = field(value, 'mimeType')
  form.alt = field(value, 'alt')
  form.caption = field(value, 'caption')
  form.width = imageWidth(value.width)
  form.poster = field(value, 'poster')
  form.height = typeof value.height === 'number' ? value.height : 420
  form.tone = calloutTone(value.tone)
  form.text = field(value, 'text')
  form.status = statusValue(value.value)
  form.label = field(value, 'label')
  form.hint = field(value, 'hint')
  if (card.kind === 'sensitive-text' && isSensitiveCardEnvelope(value)) existingSensitiveData.value = { ...value }
}

function chooseKind(kind: PaletteKind) {
  if (pending.value) return
  formContextVersion += 1
  form.kind = kind
  operationError.value = ''
  touched.value = false
}

function requestClose() {
  if (pending.value) return
  emit('update:modelValue', false)
  emit('cancel')
}

function updateOpen(value: boolean) {
  if (!value) requestClose()
}

function chooseFile() {
  if (!props.uploadHandler) {
    operationError.value = '当前页面未配置文件上传；可先上传文件，再粘贴 HTTPS 或本站附件地址。'
    return
  }
  fileInput.value?.click()
}

async function handleFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !props.uploadHandler || !uploadable.value || uploading.value) return
  const kind = form.kind as 'attachment' | 'image' | 'video'
  const uploadHandler = props.uploadHandler
  const contextVersion = formContextVersion
  const sourceIdentity = initialCardIdentity.value
  const sequence = ++uploadSequence
  const uploadEvent = { kind, file }
  uploading.value = true
  operationError.value = ''
  emit('upload-start', uploadEvent)
  try {
    const asset = await uploadHandler(file, kind)
    if (!isCurrentUpload(sequence, contextVersion, sourceIdentity, kind, uploadHandler)) return
    if (!safeResourceUrl(asset.url)) throw new Error('上传接口返回了不安全的文件地址')
    form.url = asset.url
    if (kind === 'attachment') {
      form.name = asset.name || file.name
      form.size = typeof asset.size === 'number' ? asset.size : file.size
      form.mimeType = asset.mimeType || file.type
    } else if (kind === 'image' && !form.alt) {
      form.alt = asset.name || file.name
    } else if (kind === 'video' && asset.poster) {
      form.poster = asset.poster
    }
    emit('upload-complete', { ...uploadEvent, asset })
  } catch (reason) {
    if (!isCurrentUpload(sequence, contextVersion, sourceIdentity, kind, uploadHandler)) return
    operationError.value = reason instanceof Error ? reason.message : '文件上传失败'
    emitError('upload', reason, operationError.value)
  } finally {
    if (sequence === uploadSequence) uploading.value = false
  }
}

function isCurrentUpload(
  sequence: number,
  contextVersion: number,
  sourceIdentity: string,
  kind: 'attachment' | 'image' | 'video',
  uploadHandler: ContentCardUploadHandler,
) {
  return sequence === uploadSequence
    && contextVersion === formContextVersion
    && sourceIdentity === initialCardIdentity.value
    && form.kind === kind
    && props.modelValue
    && props.uploadHandler === uploadHandler
}

async function submit() {
  touched.value = true
  operationError.value = ''
  if (validationMessage.value || pending.value) return
  const sequence = ++submitSequence
  const contextVersion = formContextVersion
  const sourceIdentity = initialCardIdentity.value
  const kind = form.kind
  const definition = { ...selectedDefinition.value }
  const definitionIdentity = stableIdentity(definition)
  const identity = originalIdentity.value ? { ...originalIdentity.value } : null
  const formSnapshot = { ...form }
  const existingSensitiveSnapshot = existingSensitiveData.value ? { ...existingSensitiveData.value } : null
  const closeOnInsert = props.closeOnInsert
  submitting.value = true
  try {
    const data = await createData(formSnapshot, existingSensitiveSnapshot)
    if (!isCurrentSubmit(sequence, contextVersion, sourceIdentity, kind, definitionIdentity, identity)) return
    const node = createContentCardNode(definition.cardId, data, identity ?? undefined)
    const card = normalizeContentCard(node)
    const payload: ContentCardCreateEvent = {
      kind,
      card,
      node,
      token: encodeContentCardToken(node),
    }
    emit('insert', payload)
    form.password = ''
    form.passwordConfirm = ''
    form.plaintext = ''
    if (closeOnInsert) emit('update:modelValue', false)
  } catch (reason) {
    if (!isCurrentSubmit(sequence, contextVersion, sourceIdentity, kind, definitionIdentity, identity)) return
    operationError.value = reason instanceof Error ? reason.message : '无法创建内容卡'
    emitError('create', reason, operationError.value)
  } finally {
    if (sequence === submitSequence) submitting.value = false
  }
}

function isCurrentSubmit(
  sequence: number,
  contextVersion: number,
  sourceIdentity: string,
  kind: PaletteKind,
  definitionIdentity: string,
  identity: { instanceId: string; version: number } | null,
) {
  const currentIdentity = originalIdentity.value
  const sameOriginalIdentity = identity === null
    ? currentIdentity === null
    : Boolean(currentIdentity && currentIdentity.instanceId === identity.instanceId && currentIdentity.version === identity.version)
  return sequence === submitSequence
    && contextVersion === formContextVersion
    && sourceIdentity === initialCardIdentity.value
    && form.kind === kind
    && definitionIdentity === stableIdentity(selectedDefinition.value)
    && sameOriginalIdentity
    && props.modelValue
}

async function createData(
  snapshot: PaletteForm,
  existingSensitive: Record<string, unknown> | null,
): Promise<Record<string, unknown>> {
  if (snapshot.kind === 'bookmark') return clean({ url: snapshot.url, title: snapshot.title, description: snapshot.description, siteName: snapshot.siteName })
  if (snapshot.kind === 'code') return clean({ language: snapshot.language, code: snapshot.code, title: snapshot.title })
  if (snapshot.kind === 'attachment') return clean({ url: snapshot.url, name: snapshot.name, size: snapshot.size, mimeType: snapshot.mimeType, description: snapshot.description })
  if (snapshot.kind === 'image') return clean({ url: snapshot.url, alt: snapshot.alt, caption: snapshot.caption, width: snapshot.width })
  if (snapshot.kind === 'video') return clean({ url: snapshot.url, poster: snapshot.poster, title: snapshot.title, caption: snapshot.caption })
  if (snapshot.kind === 'iframe') return clean({ url: snapshot.url, title: snapshot.title, height: snapshot.height })
  if (snapshot.kind === 'callout') return clean({ tone: snapshot.tone, title: snapshot.title, text: snapshot.text })
  if (snapshot.kind === 'status') return clean({ value: snapshot.status, label: snapshot.label, description: snapshot.description })
  if (existingSensitive && !snapshot.plaintext) return { ...existingSensitive, hint: snapshot.hint }
  return encryptSensitiveCard(snapshot.plaintext, snapshot.password, snapshot.hint)
}

function validateForm(): string {
  if (!availableDefinitions.value.length) return '没有可用的内容卡类型'
  if (['bookmark', 'attachment', 'image', 'video', 'iframe'].includes(form.kind) && !safeResourceUrl(form.url)) {
    return '请输入本站相对路径，或不含账号凭据的 HTTP/HTTPS 地址'
  }
  if (form.kind === 'code' && !form.code.trim()) return '请输入代码内容'
  if (form.kind === 'callout' && !form.text.trim()) return '请输入提示内容'
  if (sensitiveEncryptionUnavailable.value) return SENSITIVE_CARD_HTTPS_MESSAGE
  if (form.kind === 'sensitive-text' && !hasExistingSensitive.value && !form.plaintext) return '请输入需要加密的敏感内容'
  if (form.kind === 'sensitive-text' && form.plaintext) {
    if (form.password.length < 8 || form.password.length > 200) return '查看密码必须为 8–200 个字符'
    if (form.password !== form.passwordConfirm) return '两次输入的查看密码不一致'
  }
  return ''
}

function emitError(operation: ContentCardError['operation'], reason: unknown, fallback: string) {
  const card = normalizeContentCard({ cardId: form.kind, data: draftDataForError() })
  emit('error', { card, operation, message: reason instanceof Error ? reason.message : fallback })
}

function draftDataForError(): Record<string, unknown> {
  return clean({ url: form.url, title: form.title, name: form.name, hint: form.hint })
}

function clean(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== '' && item !== null && typeof item !== 'undefined'))
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

function field(value: Record<string, unknown>, key: string): string {
  const item = value[key]
  return typeof item === 'string' ? item : ''
}

function imageWidth(value: unknown): PaletteForm['width'] {
  return typeof value === 'string' && ['SMALL', 'MEDIUM', 'LARGE', 'FULL'].includes(value.toUpperCase())
    ? value.toUpperCase() as PaletteForm['width'] : 'LARGE'
}

function calloutTone(value: unknown): PaletteForm['tone'] {
  return typeof value === 'string' && ['INFO', 'SUCCESS', 'WARNING', 'DANGER'].includes(value.toUpperCase())
    ? value.toUpperCase() as PaletteForm['tone'] : 'INFO'
}

function statusValue(value: unknown): PaletteForm['status'] {
  return typeof value === 'string' && ['TODO', 'IN_PROGRESS', 'BLOCKED', 'DONE', 'CANCELLED'].includes(value.toUpperCase())
    ? value.toUpperCase() as PaletteForm['status'] : 'TODO'
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="720" scrollable :persistent="pending" @update:model-value="updateOpen">
    <v-card class="content-card-palette" :aria-busy="pending ? 'true' : undefined" data-testid="content-card-palette">
      <v-card-title class="palette-header">
        <div>
          <div class="palette-header__title">插入内容卡</div>
          <div class="palette-header__subtitle">选择类型并填写内容</div>
        </div>
        <v-btn icon="mdi-close" aria-label="关闭内容卡面板" variant="text" :disabled="pending" @click="requestClose" />
      </v-card-title>

      <v-divider />
      <v-card-text class="palette-content">
        <aside class="palette-types" aria-label="内容卡类型">
          <button
            v-for="definition in availableDefinitions"
            :key="definition.kind"
            type="button"
            class="palette-type"
            :class="{ 'palette-type--active': form.kind === definition.kind }"
            :aria-pressed="form.kind === definition.kind"
            :disabled="pending"
            @click="chooseKind(definition.kind)"
          >
            <v-avatar :color="definition.color" variant="tonal" size="30" rounded="sm">
              <v-icon :icon="definition.icon" size="17" />
            </v-avatar>
            <span><strong>{{ definition.title }}</strong><small>{{ definition.description }}</small></span>
          </button>
        </aside>

        <v-form class="palette-form" @submit.prevent="submit">
          <div class="palette-form__heading">
            <v-avatar :color="selectedDefinition.color" variant="tonal" rounded="sm" size="32">
              <v-icon :icon="selectedDefinition.icon" size="18" />
            </v-avatar>
            <div><strong>{{ selectedDefinition.title }}</strong><p>{{ selectedDefinition.description }}</p></div>
          </div>

          <fieldset class="palette-form__fields" :disabled="pending">
          <template v-if="form.kind === 'bookmark'">
            <v-text-field v-model="form.url" label="网页地址" placeholder="https://example.com/article" autofocus />
            <v-text-field v-model="form.title" label="标题（可选）" />
            <v-text-field v-model="form.siteName" label="来源名称（可选）" />
            <v-textarea v-model="form.description" label="摘要（可选）" rows="3" maxlength="500" counter />
          </template>

          <template v-else-if="form.kind === 'code'">
            <div class="palette-form__row">
              <v-text-field v-model="form.language" label="语言" placeholder="typescript" />
              <v-text-field v-model="form.title" label="标题（可选）" />
            </div>
            <v-textarea v-model="form.code" label="代码" rows="12" class="code-input" spellcheck="false" />
          </template>

          <template v-else-if="form.kind === 'attachment'">
            <div class="palette-form__url-row">
              <v-text-field v-model="form.url" label="附件地址" placeholder="/api/files/... 或 https://..." :disabled="pending" />
              <v-btn prepend-icon="mdi-upload" variant="tonal" :loading="uploading" :disabled="pending" @click="chooseFile">上传</v-btn>
            </div>
            <v-text-field v-model="form.name" label="文件名" :disabled="pending" />
            <div class="palette-form__row">
              <v-text-field v-model.number="form.size" label="文件大小（字节，可选）" type="number" min="0" :disabled="pending" />
              <v-text-field v-model="form.mimeType" label="MIME 类型（可选）" placeholder="application/pdf" :disabled="pending" />
            </div>
            <v-textarea v-model="form.description" label="说明（可选）" rows="2" :disabled="pending" />
          </template>

          <template v-else-if="form.kind === 'image'">
            <div class="palette-form__url-row">
              <v-text-field v-model="form.url" label="图片地址" placeholder="/api/files/... 或 https://..." :disabled="pending" />
              <v-btn prepend-icon="mdi-upload" variant="tonal" :loading="uploading" :disabled="pending" @click="chooseFile">上传</v-btn>
            </div>
            <v-text-field v-model="form.alt" label="替代文字" hint="用于无障碍阅读和图片加载失败时展示" persistent-hint :disabled="pending" />
            <v-text-field v-model="form.caption" label="图片说明（可选）" :disabled="pending" />
            <v-select v-model="form.width" label="显示宽度" :disabled="pending" :items="[
              { title: '小（320px）', value: 'SMALL' }, { title: '中（560px）', value: 'MEDIUM' },
              { title: '大（880px）', value: 'LARGE' }, { title: '铺满容器', value: 'FULL' },
            ]" />
          </template>

          <template v-else-if="form.kind === 'video'">
            <div class="palette-form__url-row">
              <v-text-field v-model="form.url" label="视频直链" placeholder="HTTPS MP4/WebM 地址" :disabled="pending" />
              <v-btn prepend-icon="mdi-upload" variant="tonal" :loading="uploading" :disabled="pending" @click="chooseFile">上传</v-btn>
            </div>
            <v-text-field v-model="form.poster" label="封面地址（可选）" :disabled="pending" />
            <v-text-field v-model="form.title" label="视频标题" :disabled="pending" />
            <v-text-field v-model="form.caption" label="说明（可选）" :disabled="pending" />
          </template>

          <template v-else-if="form.kind === 'iframe'">
            <v-alert type="info" variant="tonal" density="compact">嵌入内容会运行在受限沙箱中；部分要求登录或禁止嵌入的网站可能无法显示。</v-alert>
            <v-text-field v-model="form.url" label="嵌入地址" placeholder="https://..." />
            <v-text-field v-model="form.title" label="无障碍标题" />
            <div class="palette-slider">
              <label>显示高度：{{ form.height }}px</label>
              <v-slider v-model="form.height" min="240" max="900" step="20" thumb-label hide-details />
            </div>
          </template>

          <template v-else-if="form.kind === 'callout'">
            <v-select v-model="form.tone" label="提示级别" :items="[
              { title: '信息', value: 'INFO' }, { title: '成功', value: 'SUCCESS' },
              { title: '警告', value: 'WARNING' }, { title: '危险', value: 'DANGER' },
            ]" />
            <v-text-field v-model="form.title" label="标题（可选）" />
            <v-textarea v-model="form.text" label="提示内容" rows="5" maxlength="2000" counter />
          </template>

          <template v-else-if="form.kind === 'status'">
            <v-select v-model="form.status" label="状态" :items="[
              { title: '待处理', value: 'TODO' }, { title: '进行中', value: 'IN_PROGRESS' },
              { title: '已阻塞', value: 'BLOCKED' }, { title: '已完成', value: 'DONE' },
              { title: '已取消', value: 'CANCELLED' },
            ]" />
            <v-text-field v-model="form.label" label="自定义标签（可选）" />
            <v-textarea v-model="form.description" label="补充说明（可选）" rows="3" />
          </template>

          <template v-else-if="form.kind === 'sensitive-text'">
            <v-alert v-if="sensitiveCryptoAvailable" type="warning" variant="tonal" density="compact">
              内容使用 PBKDF2-SHA256 + AES-GCM 在浏览器本地加密。系统不会保存查看密码，遗失后无法恢复。
            </v-alert>
            <v-alert v-else type="warning" variant="tonal" density="compact">
              {{ SENSITIVE_CARD_HTTPS_MESSAGE }}<template v-if="hasExistingSensitive">你仍可修改内容提示并保存，现有密文不会被解密或改写。</template>
            </v-alert>
            <v-text-field v-model="form.hint" label="内容提示（可选）" maxlength="200" />
            <v-alert v-if="hasExistingSensitive" type="info" variant="tonal" density="compact">
              留空敏感内容可保留现有密文；输入新内容则会使用新密码重新加密。
            </v-alert>
            <v-textarea v-model="form.plaintext" :label="hasExistingSensitive ? '新的敏感内容（可选）' : '敏感内容'" rows="7" maxlength="20000" counter :disabled="!sensitiveCryptoAvailable" />
            <template v-if="form.plaintext || !hasExistingSensitive">
              <div class="palette-form__row">
                <v-text-field v-model="form.password" label="查看密码" type="password" autocomplete="new-password" minlength="8" maxlength="200" :disabled="!sensitiveCryptoAvailable" />
                <v-text-field v-model="form.passwordConfirm" label="再次输入查看密码" type="password" autocomplete="new-password" minlength="8" maxlength="200" :disabled="!sensitiveCryptoAvailable" />
              </div>
            </template>
          </template>

          <input ref="fileInput" class="sr-only" type="file" :accept="uploadAccept" :disabled="pending" tabindex="-1" @change="handleFile">
          <v-alert v-if="operationError" type="error" variant="tonal" density="compact">{{ operationError }}</v-alert>
          <v-alert v-else-if="touched && validationMessage" type="warning" variant="tonal" density="compact">{{ validationMessage }}</v-alert>
          </fieldset>
        </v-form>
      </v-card-text>

      <v-divider />
      <v-card-actions class="palette-actions">
        <span class="palette-actions__hint">插入后可选中卡片继续修改</span>
        <v-spacer />
        <v-btn variant="text" :disabled="pending" @click="requestClose">取消</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" :loading="submitting" :disabled="pending || sensitiveEncryptionUnavailable" @click="submit">
          {{ initialCard ? '保存内容卡' : '插入内容卡' }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.content-card-palette { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 8px !important; background: #fff; box-shadow: 0 12px 36px rgba(0, 0, 0, .14) !important; }
.palette-header { display: flex; min-height: 56px; align-items: center; justify-content: space-between; padding: 8px 12px 8px 16px; }
.palette-header :deep(.v-btn) { width: 32px; height: 32px; color: #595959; }
.palette-header__title { color: #262626; font-size: 16px; font-weight: 600; line-height: 24px; }
.palette-header__subtitle { color: #8c8c8c; font-size: 12px; font-weight: 400; line-height: 18px; }
.palette-content { display: grid; grid-template-columns: 176px minmax(0, 1fr); min-height: 460px; max-height: min(72vh, 620px); padding: 0 !important; }
.palette-types { overflow-y: auto; border-right: 1px solid #ededed; padding: 8px; background: #fafafa; scrollbar-width: thin; }
.palette-type { display: flex; width: 100%; min-height: 46px; align-items: center; gap: 8px; border: 1px solid transparent; border-radius: 6px; padding: 6px 7px; background: transparent; color: #262626; cursor: pointer; text-align: left; transition: background-color 120ms ease, border-color 120ms ease; }
.palette-type + .palette-type { margin-top: 2px; }
.palette-type:hover { background: #f0f0f0; }
.palette-type:disabled { cursor: not-allowed; opacity: .58; }
.palette-type:focus-visible { border-color: #85a5ff; outline: 2px solid rgba(47, 104, 246, .14); outline-offset: 1px; }
.palette-type--active { border-color: #adc6ff; background: #eef3ff; color: #2457d6; }
.palette-type--active:hover { background: #e7efff; }
.palette-type :deep(.v-avatar) { flex: 0 0 auto; border-radius: 6px !important; }
.palette-type > span { display: flex; min-width: 0; flex-direction: column; }
.palette-type strong { overflow: hidden; font-size: 13px; font-weight: 500; line-height: 20px; text-overflow: ellipsis; white-space: nowrap; }
.palette-type small { overflow: hidden; color: #8c8c8c; font-size: 11px; line-height: 16px; text-overflow: ellipsis; white-space: nowrap; }
.palette-form { display: flex; min-width: 0; flex-direction: column; gap: 10px; overflow-y: auto; padding: 14px 16px 16px; scrollbar-width: thin; }
.palette-form__fields { display: flex; min-width: 0; flex-direction: column; gap: 10px; margin: 0; border: 0; padding: 0; }
.palette-form__heading { display: flex; min-height: 40px; align-items: center; gap: 9px; margin-bottom: 2px; }
.palette-form__heading :deep(.v-avatar) { border-radius: 6px !important; }
.palette-form__heading strong { display: block; color: #262626; font-size: 14px; font-weight: 600; line-height: 20px; }
.palette-form__heading p { margin: 0; color: #8c8c8c; font-size: 12px; line-height: 18px; }
.palette-form__row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.palette-form__url-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 8px; }
.palette-form__url-row .v-btn { height: 40px; margin-top: 0; border-radius: 6px; }
.palette-form :deep(.v-field) { border-radius: 6px; font-size: 13px; }
.palette-form :deep(.v-field__input) { min-height: 40px; padding-top: 7px; padding-bottom: 7px; }
.palette-form :deep(.v-input__details) { min-height: 18px; padding-top: 2px; font-size: 11px; }
.palette-form :deep(.v-alert) { border-radius: 6px; font-size: 12px; line-height: 18px; }
.palette-slider label { display: block; margin-bottom: 2px; color: #8c8c8c; font-size: 12px; line-height: 18px; }
.code-input :deep(textarea) { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; line-height: 1.55; }
.palette-actions { min-height: 52px; padding: 7px 10px 7px 16px; }
.palette-actions :deep(.v-btn) { height: 34px; border-radius: 6px; font-size: 13px; letter-spacing: 0; }
.palette-actions__hint { color: #8c8c8c; font-size: 12px; line-height: 18px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; clip-path: inset(50%); }
@media (max-width: 700px) {
  .content-card-palette { border-radius: 0 !important; }
  .palette-header { min-height: 52px; }
  .palette-content { display: block; }
  .palette-types { display: flex; max-width: 100%; overflow-x: auto; border-right: 0; border-bottom: 1px solid #ededed; padding: 6px 8px; }
  .palette-type { min-width: 112px; min-height: 38px; }
  .palette-type small { display: none; }
  .palette-form { max-height: calc(100vh - 154px); padding: 12px; }
  .palette-form__row { grid-template-columns: 1fr; }
  .palette-actions__hint { display: none; }
}
</style>
