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
    <v-alert v-if="error" type="error" variant="tonal" class="ma-6">{{ error }}</v-alert>
    <main v-if="reader" class="reader-page" :style="pageStyle">
      <div class="reader-breadcrumb"><router-link :to="`/u/${reader.metadata.authorSlug}`">{{ reader.metadata.authorName }}</router-link><span>/</span><span>{{ reader.metadata.knowledgeBaseName }}</span></div>
      <article :class="articleClasses" :style="{ '--reader-accent': appearance.accentColor }">
        <div v-if="watermark.enabled" class="reader-watermark" :class="`position-${watermark.position.toLowerCase()}`" :style="{ opacity: watermark.opacity }" aria-hidden="true">{{ watermarkText }}</div>
        <div v-if="pageCover" class="reader-cover" :style="pageCoverStyle" />
        <header>
          <span class="reader-icon">{{ reader.pageMetadata?.icon || '📄' }}</span>
          <v-chip size="small" variant="tonal">{{ reader.metadata.contentType }}</v-chip>
          <h1>{{ reader.metadata.title }}</h1>
          <div class="d-flex align-center mt-5"><v-avatar color="primary" class="mr-3">{{ reader.metadata.authorName.slice(0, 1) }}</v-avatar><div><strong>{{ reader.metadata.authorName }}</strong><p class="muted mb-0 text-body-2">{{ new Date(reader.metadata.publishedAt).toLocaleString('zh-CN') }}</p></div></div>
        </header>
        <PublicContentRenderer :content-type="reader.metadata.contentType" :content="reader.content" :plain-text="reader.plainText" />
        <footer>
          <h3>这篇内容对你有帮助吗？</h3>
          <v-alert v-if="reactionError" type="error" variant="tonal" class="mt-3">{{ reactionError }}</v-alert>
          <div class="reaction-row mt-4"><v-btn v-for="reaction in reactionOptions" :key="reaction.value" :color="reader.metadata.viewerReactions.includes(reaction.value) ? 'primary' : undefined" variant="tonal" :prepend-icon="reaction.icon" :loading="reactionBusy === reaction.value" :disabled="Boolean(reactionBusy)" @click="react(reaction.value)">{{ reaction.label }} · {{ reader.metadata.reactions[reaction.value] || 0 }}</v-btn></div>
        </footer>
      </article>
    </main>
  </PublicLayout>
</template>

<style scoped>
.reader-page{min-height:100vh;padding:40px 20px 100px;background-color:var(--reader-background,#f8fafc);background-position:center top;background-size:cover}.reader-breadcrumb,article{width:min(860px,100%);margin:auto}.reader-breadcrumb{display:flex;gap:10px;margin-bottom:20px;color:#64748b}.reader-breadcrumb a{color:var(--reader-accent,#2563eb)}article{position:relative;overflow:hidden;border:1px solid #e2e8f0;border-radius:24px;padding:clamp(28px,7vw,72px);background:white;box-shadow:0 24px 60px #0f172a0d}article.reader-width-wide{width:min(1120px,100%)}article.reader-width-full{width:min(1480px,100%)}article.reader-theme-minimal{border-color:transparent;box-shadow:none}article.reader-theme-magazine h1{font-size:clamp(44px,7vw,70px)}article.reader-theme-dark{border-color:#334155;background:#111827;color:#e5e7eb}.reader-cover{height:280px;margin:clamp(-72px,-7vw,-28px) clamp(-72px,-7vw,-28px) 48px;background-position:center;background-size:cover;border-radius:24px 24px 0 0}.reader-icon{display:block;margin-bottom:18px;font-size:46px}header h1{margin:18px 0 0;font-size:clamp(38px,6vw,62px);line-height:1.08;letter-spacing:-.055em}header{position:relative;z-index:1;margin-bottom:54px}footer{position:relative;z-index:1;margin-top:60px;border-top:1px solid #e2e8f0;padding-top:30px}.reaction-row{display:flex;flex-wrap:wrap;gap:8px}.reader-watermark{position:absolute;z-index:0;color:var(--reader-accent,#64748b);font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;user-select:none;transform:rotate(-24deg)}.reader-watermark.position-center{inset:48% auto auto 50%;font-size:18px;transform:translate(-50%,-50%) rotate(-24deg)}.reader-watermark.position-footer{inset:auto 24px 18px auto;transform:none}.reader-watermark.position-tiled{inset:40% auto auto 45%;text-shadow:-250px -220px currentColor,0 -220px currentColor,250px -220px currentColor,-250px -80px currentColor,250px -80px currentColor,-250px 80px currentColor,250px 80px currentColor,-250px 220px currentColor,0 220px currentColor,250px 220px currentColor}:deep(.public-content-renderer){position:relative;z-index:1;font-family:ui-serif,Georgia,"Noto Serif SC",serif}article.document-font-sans :deep(.public-content-renderer){font-family:Inter,ui-sans-serif,system-ui,"Microsoft YaHei",sans-serif}article.document-size-small :deep(.public-content-renderer){font-size:15px}article.document-size-large :deep(.public-content-renderer){font-size:19px}article.document-spacing-compact :deep(.reader-paragraph){margin-bottom:.65em}article.document-spacing-relaxed :deep(.reader-paragraph){margin-bottom:1.7em}article.reader-theme-dark :deep(.public-content-renderer),article.reader-theme-dark .muted{color:#d1d5db}@media(max-width:700px){.reader-page{padding:20px 10px 60px}article{border-radius:16px}.reader-cover{height:190px}.reaction-row .v-btn{flex:1 1 calc(50% - 8px)}}
</style>
