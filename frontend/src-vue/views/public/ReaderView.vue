<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { PublicReader } from '../../../src/types'
import PublicContentRenderer from '../../components/PublicContentRenderer.vue'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { normalizeDocumentSettings, parseKnowledgeBaseAppearance, parseKnowledgeBaseWatermark, safePresentationUrl } from '../../utils/presentation'

type ReactionType = 'LIKE' | 'CLAP' | 'HEART' | 'INSIGHTFUL'
const reactionOptions: Array<{ value: ReactionType; label: string; icon: string }> = [
  { value: 'LIKE', label: '赞', icon: 'mdi-thumb-up-outline' },
  { value: 'CLAP', label: '鼓掌', icon: 'mdi-hands-clap' },
  { value: 'HEART', label: '喜欢', icon: 'mdi-heart-outline' },
  { value: 'INSIGHTFUL', label: '有启发', icon: 'mdi-lightbulb-on-outline' },
]

const route = useRoute()
const session = useSessionStore()
const publicationId = computed(() => String(route.params.publicationId))
const reader = ref<PublicReader | null>(null)
const error = ref('')
const reactionError = ref('')
const reactionBusy = ref<ReactionType | null>(null)
const loading = ref(true)
const appearance = computed(() => parseKnowledgeBaseAppearance(reader.value?.appearanceConfig))
const watermark = computed(() => parseKnowledgeBaseWatermark(reader.value?.watermarkConfig))
const documentSettings = computed(() => normalizeDocumentSettings(reader.value?.documentSettings))
const pageCover = computed(() => safePresentationUrl(reader.value?.pageMetadata?.cover))
const pageCoverStyle = computed(() => pageCover.value ? { backgroundImage: cssUrl(pageCover.value) } : {})
const pageStyle = computed<Record<string, string>>(() => ({
  '--reader-background': appearance.value.backgroundColor,
  '--reader-accent': appearance.value.accentColor,
  ...(appearance.value.coverUrl ? { backgroundImage: `linear-gradient(rgba(255,255,255,.72),rgba(255,255,255,.9)),${cssUrl(appearance.value.coverUrl)}` } : {}),
}))
const articleClasses = computed(() => [
  `reader-width-${appearance.value.contentWidth.toLowerCase()}`,
  `reader-theme-${appearance.value.theme.toLowerCase()}`,
  `document-font-${documentSettings.value.fontFamily.toLowerCase()}`,
  `document-size-${documentSettings.value.fontSize.toLowerCase()}`,
  `document-spacing-${documentSettings.value.paragraphSpacing.toLowerCase()}`,
])
const watermarkText = computed(() => watermark.value.text.replaceAll('{{email}}', session.user?.email || '公开访客'))
function cssUrl(value: string) { return `url(${JSON.stringify(value)})` }

onMounted(async () => {
  try {
    const [value] = await Promise.all([
      post<PublicReader>('/api/public/v1/social/publication', { publicationId: publicationId.value }, false),
      session.ready ? Promise.resolve(session.user) : session.loadUser(),
    ])
    reader.value = value
    document.title = `${value.metadata.title} · 知序`
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
})

async function react(type: ReactionType) {
  if (!session.user) {
    location.href = `/login?returnTo=${encodeURIComponent(route.fullPath)}`
    return
  }
  if (reactionBusy.value) return
  reactionBusy.value = type; reactionError.value = ''
  try {
    const updated = await post<{ reactions: PublicReader['metadata']['reactions']; viewerReactions: PublicReader['metadata']['viewerReactions'] }>('/api/v1/social/reactions/toggle', { publicationId: publicationId.value, reactionType: type })
    if (reader.value) Object.assign(reader.value.metadata, updated)
  } catch (value) { reactionError.value = messageOf(value) } finally { reactionBusy.value = null }
}
</script>

<template>
  <PublicLayout>
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <div v-if="error" class="reader-error"><v-icon icon="mdi-alert-circle-outline" />{{ error }}</div>
    <main v-if="reader" class="reader-page" :style="pageStyle">
      <div class="reader-context">
        <div class="reader-breadcrumb"><v-icon icon="mdi-bookshelf" size="18"/><router-link :to="`/u/${reader.metadata.authorSlug}`">{{ reader.metadata.authorName }}</router-link><v-icon icon="mdi-chevron-right" size="15"/><span>{{ reader.metadata.knowledgeBaseName }}</span></div>
        <span class="reader-publish-state"><v-icon icon="mdi-earth" size="15"/>已发布</span>
      </div>
      <article :class="articleClasses" :style="{ '--reader-accent': appearance.accentColor }">
        <div v-if="watermark.enabled" class="reader-watermark" :class="`position-${watermark.position.toLowerCase()}`" :style="{ opacity: watermark.opacity }" aria-hidden="true">{{ watermarkText }}</div>
        <div v-if="pageCover" class="reader-cover" :style="pageCoverStyle" />
        <header>
          <span v-if="reader.pageMetadata?.icon" class="reader-icon">{{ reader.pageMetadata.icon }}</span>
          <h1>{{ reader.metadata.title }}</h1>
          <div class="reader-meta"><v-avatar color="success" size="26">{{ reader.metadata.authorName.slice(0, 1) }}</v-avatar><strong>{{ reader.metadata.authorName }}</strong><span>发布于 {{ new Date(reader.metadata.publishedAt).toLocaleString('zh-CN') }}</span></div>
        </header>
        <PublicContentRenderer :content-type="reader.metadata.contentType" :content="reader.content" :plain-text="reader.plainText" />
        <footer>
          <h3>觉得有帮助？</h3>
          <v-alert v-if="reactionError" type="error" variant="tonal" class="mt-3">{{ reactionError }}</v-alert>
          <div class="reaction-row"><v-btn v-for="reaction in reactionOptions" :key="reaction.value" :class="{active:reader.metadata.viewerReactions.includes(reaction.value)}" variant="outlined" size="small" :prepend-icon="reaction.icon" :loading="reactionBusy === reaction.value" :disabled="Boolean(reactionBusy)" @click="react(reaction.value)">{{ reaction.label }} {{ reader.metadata.reactions[reaction.value] || 0 }}</v-btn></div>
        </footer>
      </article>
    </main>
  </PublicLayout>
</template>

<style scoped>
.reader-error{display:flex;width:min(760px,calc(100% - 32px));align-items:center;gap:9px;margin:28px auto;border:1px solid #ffd6d2;border-radius:6px;background:#fff1f0;color:#d33b35;padding:12px 14px}.reader-page{min-height:calc(100dvh - 56px);background-color:var(--reader-background,#fff);background-position:center top;background-size:cover}.reader-context{display:flex;height:48px;align-items:center;border-bottom:1px solid #f0f0f0;background:rgba(255,255,255,.92);padding:0 24px}.reader-breadcrumb{display:flex;min-width:0;align-items:center;gap:7px;color:#8a8f8d;font-size:13px}.reader-breadcrumb a{color:#585a59;text-decoration:none}.reader-breadcrumb a:hover{color:var(--reader-accent,#2f6feb)}.reader-breadcrumb span{overflow:hidden;max-width:340px;text-overflow:ellipsis;white-space:nowrap}.reader-publish-state{display:flex;align-items:center;gap:4px;margin-left:auto;color:#8a8f8d;font-size:12px}article{position:relative;width:750px;max-width:calc(100% - 40px);margin:0 auto;padding:64px 0 110px;background:transparent}article.reader-width-wide{width:980px}article.reader-width-full{width:min(1280px,calc(100% - 40px))}article.reader-theme-magazine h1{font-size:48px}article.reader-theme-dark{color:#e5e7eb}.reader-cover{height:300px;margin:0 0 44px;background-position:center;background-size:cover;border-radius:6px}.reader-icon{display:block;margin-bottom:14px;font-size:42px}header{position:relative;z-index:1;margin-bottom:45px}header h1{margin:0;color:inherit;font-size:40px;font-weight:700;line-height:1.3;letter-spacing:-.7px}.reader-meta{display:flex;align-items:center;gap:8px;margin-top:20px;color:#8a8f8d;font-size:12px}.reader-meta strong{color:#585a59;font-size:13px;font-weight:500}.reader-meta span{margin-left:2px}footer{position:relative;z-index:1;margin-top:72px;border-top:1px solid #e7e9e8;padding-top:26px}footer h3{margin:0 0 14px;font-size:14px;font-weight:600}.reaction-row{display:flex;flex-wrap:wrap;gap:7px}.reaction-row :deep(.v-btn){height:31px;border-color:#d8dad9;border-radius:5px;color:#585a59;letter-spacing:0;text-transform:none}.reaction-row :deep(.v-btn.active){border-color:#8cb2f3;background:#edf3ff;color:#2f6feb}.reader-watermark{position:absolute;z-index:0;color:var(--reader-accent,#64748b);font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;user-select:none;transform:rotate(-24deg)}.reader-watermark.position-center{inset:48% auto auto 50%;font-size:18px;transform:translate(-50%,-50%) rotate(-24deg)}.reader-watermark.position-footer{inset:auto 0 18px auto;transform:none}.reader-watermark.position-tiled{inset:40% auto auto 45%;text-shadow:-250px -220px currentColor,0 -220px currentColor,250px -220px currentColor,-250px -80px currentColor,250px -80px currentColor,-250px 80px currentColor,250px 80px currentColor,-250px 220px currentColor,0 220px currentColor,250px 220px currentColor}:deep(.public-content-renderer){position:relative;z-index:1;color:#262626;font-family:ui-serif,Georgia,"Noto Serif SC",serif;font-size:16px;line-height:1.8}article.document-font-sans :deep(.public-content-renderer){font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}article.document-size-small :deep(.public-content-renderer){font-size:14px}article.document-size-large :deep(.public-content-renderer){font-size:18px}article.document-spacing-compact :deep(.reader-paragraph){margin-bottom:.65em}article.document-spacing-relaxed :deep(.reader-paragraph){margin-bottom:1.7em}article.reader-theme-dark :deep(.public-content-renderer),article.reader-theme-dark .muted{color:#d1d5db}@media(max-width:700px){.reader-context{padding:0 12px}.reader-publish-state{display:none}article{max-width:calc(100% - 30px);padding:42px 0 72px}.reader-cover{height:190px;margin-bottom:32px}header h1{font-size:32px}.reader-meta{align-items:flex-start;flex-wrap:wrap}.reader-meta span{width:100%;margin-left:34px}.reaction-row .v-btn{flex:1 1 calc(50% - 8px)}}
</style>
