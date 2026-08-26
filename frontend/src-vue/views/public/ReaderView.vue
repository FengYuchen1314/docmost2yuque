<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { PublicContent, PublicReader, SocialPage } from '../../../src/types'
import PublicContentRenderer from '../../components/PublicContentRenderer.vue'
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
const publicationId = computed(() => String(route.params.publicationId ?? ''))
const reader = ref<PublicReader | null>(null)
const error = ref('')
const loading = ref(true)
const catalogItems = ref<PublicContent[]>([])
const catalogLoading = ref(false)
const catalogError = ref('')
const catalogQuery = ref('')
const catalogOpen = ref(false)
const catalogSearchInput = ref<HTMLInputElement | null>(null)
const catalogToggleButton = ref<HTMLButtonElement | null>(null)
const feedbackSection = ref<HTMLElement | null>(null)
const reactionError = ref('')
const reactionBusy = ref<ReactionType | null>(null)
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
const filteredCatalogItems = computed(() => {
  const query = catalogQuery.value.trim().toLocaleLowerCase('zh-CN')
  if (!query) return catalogItems.value
  return catalogItems.value.filter((item) => item.title.toLocaleLowerCase('zh-CN').includes(query))
})
const likeCount = computed(() => reader.value?.metadata.reactions.LIKE ?? 0)
const liked = computed(() => reader.value?.metadata.viewerReactions.includes('LIKE') ?? false)
const accountTarget = computed(() => session.user
  ? '/app'
  : { path: '/login', query: { returnTo: route.fullPath } })

let loadSequence = 0
let sessionRequest: ReturnType<typeof session.loadUser> | null = null

function cssUrl(value: string) { return `url(${JSON.stringify(value)})` }

function ensureSession() {
  if (session.ready) return Promise.resolve(session.user)
  if (!sessionRequest) sessionRequest = session.loadUser().finally(() => { sessionRequest = null })
  return sessionRequest
}

function requestIsCurrent(sequence: number, requestedPublicationId: string) {
  return sequence === loadSequence && publicationId.value === requestedPublicationId
}

async function loadPublication(requestedPublicationId: string) {
  const sequence = ++loadSequence
  reader.value = null
  error.value = ''
  loading.value = true
  catalogItems.value = []
  catalogLoading.value = false
  catalogError.value = ''
  catalogQuery.value = ''
  catalogOpen.value = false
  reactionError.value = ''
  reactionBusy.value = null
  try {
    const [value] = await Promise.all([
      post<PublicReader>('/api/public/v1/social/publication', { publicationId: requestedPublicationId }, false),
      ensureSession(),
    ])
    if (!requestIsCurrent(sequence, requestedPublicationId)) return
    reader.value = value
    document.title = `${value.metadata.title} · 知序`
    void loadCatalog(value, sequence, requestedPublicationId)
  } catch (value) {
    if (requestIsCurrent(sequence, requestedPublicationId)) error.value = messageOf(value)
  } finally {
    if (requestIsCurrent(sequence, requestedPublicationId)) loading.value = false
  }
}

async function loadCatalog(currentReader: PublicReader, sequence: number, requestedPublicationId: string) {
  catalogLoading.value = true
  catalogError.value = ''
  try {
    const page = await post<SocialPage<PublicContent>>('/api/public/v1/social/profile/content/page', {
      slug: currentReader.metadata.authorSlug,
      offset: 0,
      limit: 50,
    }, false)
    if (!requestIsCurrent(sequence, requestedPublicationId)) return
    const items = Array.isArray(page?.items) ? page.items : []
    const matchingItems = items.filter((item) =>
      item.knowledgeBaseId === currentReader.metadata.knowledgeBaseId
      && item.authorSlug === currentReader.metadata.authorSlug)
    const uniqueItems = new Map(matchingItems.map((item) => [item.publicationId, item]))
    if (!uniqueItems.has(currentReader.metadata.publicationId)) {
      uniqueItems.set(currentReader.metadata.publicationId, currentReader.metadata)
    }
    catalogItems.value = [...uniqueItems.values()]
  } catch (value) {
    if (requestIsCurrent(sequence, requestedPublicationId)) {
      catalogItems.value = [currentReader.metadata]
      catalogError.value = messageOf(value)
    }
  } finally {
    if (requestIsCurrent(sequence, requestedPublicationId)) catalogLoading.value = false
  }
}

async function react(type: ReactionType) {
  if (!session.user) {
    location.href = `/login?returnTo=${encodeURIComponent(route.fullPath)}`
    return
  }
  if (reactionBusy.value || !reader.value) return
  const targetReader = reader.value
  const targetPublicationId = publicationId.value
  reactionBusy.value = type
  reactionError.value = ''
  try {
    const updated = await post<{ reactions: PublicReader['metadata']['reactions']; viewerReactions: PublicReader['metadata']['viewerReactions'] }>('/api/v1/social/reactions/toggle', {
      publicationId: targetPublicationId,
      reactionType: type,
    })
    if (reader.value === targetReader && publicationId.value === targetPublicationId) Object.assign(targetReader.metadata, updated)
  } catch (value) {
    if (reader.value === targetReader && publicationId.value === targetPublicationId) reactionError.value = messageOf(value)
  } finally {
    if (reader.value === targetReader && publicationId.value === targetPublicationId) reactionBusy.value = null
  }
}

function openCatalog() {
  catalogOpen.value = true
  void nextTick(() => catalogSearchInput.value?.focus())
}

function closeCatalog(restoreFocus = true) {
  if (!catalogOpen.value) return
  catalogOpen.value = false
  if (restoreFocus) void nextTick(() => catalogToggleButton.value?.focus())
}

function scrollToFeedback() {
  feedbackSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  feedbackSection.value?.focus({ preventScroll: true })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && catalogOpen.value) closeCatalog()
}

watch(publicationId, (value) => { void loadPublication(value) }, { immediate: true })
onMounted(() => document.addEventListener('keydown', handleKeydown))
onBeforeUnmount(() => {
  loadSequence += 1
  document.removeEventListener('keydown', handleKeydown)
})
</script>

<template>
  <div class="reader-shell" :style="reader ? pageStyle : undefined">
    <header class="reader-topbar">
      <div class="reader-book-identity">
        <router-link to="/explore" class="reader-brand" aria-label="返回知序发现页">
          <span class="reader-brand-mark"><v-icon icon="mdi-book-open-page-variant-outline" size="18" /></span>
          <strong>{{ reader?.metadata.knowledgeBaseName || '知序' }}</strong>
        </router-link>
      </div>
      <div class="reader-document-identity">
        <button
          ref="catalogToggleButton"
          class="catalog-toggle"
          type="button"
          aria-controls="public-reader-catalog"
          :aria-expanded="catalogOpen"
          aria-label="打开知识库目录"
          @click="openCatalog"
        ><v-icon icon="mdi-menu" size="20" /></button>
        <v-icon icon="mdi-file-document-outline" size="18" color="primary" />
        <strong>{{ reader?.metadata.title || '公开文稿' }}</strong>
      </div>
      <nav class="reader-top-actions" aria-label="公开阅读导航">
        <router-link v-if="reader" :to="`/u/${reader.metadata.authorSlug}`" class="reader-author-link">{{ reader.metadata.authorName }}</router-link>
        <router-link to="/explore" class="reader-nav-link">发现</router-link>
        <router-link :to="accountTarget" class="reader-account-link">{{ session.user ? '进入工作区' : '登录' }}</router-link>
      </nav>
    </header>

    <v-progress-linear v-if="loading" class="reader-progress" indeterminate color="primary" />
    <div v-if="error" class="reader-error" role="alert"><v-icon icon="mdi-alert-circle-outline" />{{ error }}</div>

    <div v-if="reader" class="reader-body">
      <button v-if="catalogOpen" class="catalog-scrim" type="button" aria-label="关闭知识库目录" @click="closeCatalog()" />
      <aside id="public-reader-catalog" class="reader-catalog" :class="{ 'catalog-open': catalogOpen }" aria-label="知识库目录">
        <div class="catalog-heading">
          <div>
            <span>目录</span>
            <small v-if="!catalogLoading">{{ catalogItems.length }}</small>
          </div>
          <button type="button" aria-label="关闭目录" @click="closeCatalog()"><v-icon icon="mdi-close" size="19" /></button>
        </div>
        <label class="catalog-search">
          <v-icon icon="mdi-magnify" size="18" />
          <input ref="catalogSearchInput" v-model="catalogQuery" type="search" placeholder="搜索当前知识库" autocomplete="off" />
        </label>
        <div v-if="catalogLoading" class="catalog-load-state" role="status">
          <v-progress-circular indeterminate color="primary" size="18" width="2" />
          <span>正在加载目录</span>
        </div>
        <p v-else-if="catalogError" class="catalog-load-state catalog-warning" role="status">
          <v-icon icon="mdi-alert-circle-outline" size="17" />
          <span>目录暂时无法加载，正文仍可正常阅读</span>
        </p>
        <nav v-if="!catalogLoading" class="catalog-list" aria-label="已发布文稿">
          <router-link
            v-for="item in filteredCatalogItems"
            :key="item.publicationId"
            :to="`/p/${item.publicationId}`"
            :aria-current="item.publicationId === publicationId ? 'page' : undefined"
            :class="{ active: item.publicationId === publicationId }"
            @click="closeCatalog(false)"
          >
            <v-icon icon="mdi-file-document-outline" size="17" />
            <span>{{ item.title }}</span>
          </router-link>
          <p v-if="!filteredCatalogItems.length" class="catalog-empty">没有匹配的已发布文稿</p>
        </nav>
        <div class="catalog-owner">
          <v-avatar color="success" size="28">{{ reader.metadata.authorName.slice(0, 1) }}</v-avatar>
          <div><span>{{ reader.metadata.authorName }}</span><small>知识库作者</small></div>
          <router-link :to="`/u/${reader.metadata.authorSlug}`" aria-label="查看作者主页"><v-icon icon="mdi-chevron-right" size="19" /></router-link>
        </div>
      </aside>

      <main class="reader-stage">
        <article :class="articleClasses" :style="{ '--reader-accent': appearance.accentColor }">
          <div v-if="watermark.enabled" class="reader-watermark" :class="`position-${watermark.position.toLowerCase()}`" :style="{ opacity: watermark.opacity }" aria-hidden="true">{{ watermarkText }}</div>
          <div v-if="pageCover" class="reader-cover" :style="pageCoverStyle" />
          <header class="reader-article-header">
            <span v-if="reader.pageMetadata?.icon" class="reader-icon">{{ reader.pageMetadata.icon }}</span>
            <h1>{{ reader.metadata.title }}</h1>
            <div class="reader-meta">
              <v-avatar color="success" size="26">{{ reader.metadata.authorName.slice(0, 1) }}</v-avatar>
              <strong>{{ reader.metadata.authorName }}</strong>
              <span>发布于 {{ new Date(reader.metadata.publishedAt).toLocaleString('zh-CN') }}</span>
              <span class="reader-publish-state"><v-icon icon="mdi-earth" size="14" />已发布</span>
            </div>
          </header>
          <PublicContentRenderer :content-type="reader.metadata.contentType" :content="reader.content" :plain-text="reader.plainText" />
          <footer ref="feedbackSection" class="reader-feedback" tabindex="-1">
            <h3>觉得有帮助？</h3>
            <p>你的反馈会帮助作者持续完善这篇文稿。</p>
            <v-alert v-if="reactionError" type="error" variant="tonal" class="mt-3">{{ reactionError }}</v-alert>
            <div class="reaction-row">
              <v-btn
                v-for="reaction in reactionOptions"
                :key="reaction.value"
                :class="{ active: reader.metadata.viewerReactions.includes(reaction.value) }"
                variant="outlined"
                size="small"
                :prepend-icon="reaction.icon"
                :loading="reactionBusy === reaction.value"
                :disabled="Boolean(reactionBusy)"
                @click="react(reaction.value)"
              >{{ reaction.label }} {{ reader.metadata.reactions[reaction.value] || 0 }}</v-btn>
            </div>
          </footer>
        </article>
      </main>

      <aside class="reader-floating-actions" aria-label="文稿互动">
        <button
          type="button"
          :class="{ active: liked }"
          :disabled="Boolean(reactionBusy)"
          :aria-pressed="liked"
          aria-label="赞这篇文稿"
          @click="react('LIKE')"
        >
          <v-progress-circular v-if="reactionBusy === 'LIKE'" indeterminate size="19" width="2" />
          <v-icon v-else :icon="liked ? 'mdi-thumb-up' : 'mdi-thumb-up-outline'" size="20" />
          <span>{{ likeCount }}</span>
        </button>
        <button type="button" aria-label="查看文稿互动区" @click="scrollToFeedback">
          <v-icon icon="mdi-comment-text-outline" size="20" />
          <span>评论</span>
        </button>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.reader-shell{--catalog-width:259px;--topbar-height:52px;min-height:100dvh;background-color:var(--reader-background,#f7f8f6);background-position:center top;background-size:cover;color:#262626}.reader-topbar{position:sticky;top:0;z-index:70;display:grid;height:var(--topbar-height);grid-template-columns:var(--catalog-width) minmax(0,1fr) auto;align-items:center;border-bottom:1px solid #e9ebea;background:rgba(255,255,255,.97);backdrop-filter:blur(12px)}.reader-book-identity{display:flex;height:100%;align-items:center;border-right:1px solid #e9ebea;padding:0 14px}.reader-brand{display:flex;min-width:0;align-items:center;gap:9px;color:#252726;text-decoration:none}.reader-brand-mark{display:grid;width:29px;height:29px;flex:0 0 auto;place-items:center;border-radius:6px;background:#2f6feb;color:#fff}.reader-brand strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:650}.reader-document-identity{display:flex;min-width:0;align-items:center;gap:8px;padding:0 18px}.reader-document-identity>strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:600}.catalog-toggle{display:none}.reader-top-actions{display:flex;height:100%;align-items:center;gap:4px;padding:0 15px 0 8px}.reader-top-actions a{display:inline-flex;height:30px;align-items:center;border-radius:5px;color:#666b68;font-size:12px;text-decoration:none;padding:0 10px}.reader-top-actions a:hover{background:#f4f5f5;color:#262626}.reader-top-actions .reader-author-link{max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.reader-account-link{border:1px solid #d8dad9}.reader-progress{position:fixed!important;inset:var(--topbar-height) 0 auto;z-index:72}.reader-error{display:flex;width:min(620px,calc(100% - 32px));align-items:center;gap:9px;margin:12vh auto 0;border:1px solid #ffd6d2;border-radius:6px;background:#fff1f0;color:#d33b35;padding:12px 14px}.reader-body{min-height:calc(100dvh - var(--topbar-height))}.reader-catalog{position:fixed;z-index:45;inset:var(--topbar-height) auto 0 0;display:flex;width:var(--catalog-width);flex-direction:column;border-right:1px solid #e7e9e8;background:rgba(250,251,251,.98);padding:14px 10px 10px}.catalog-heading{display:flex;height:30px;align-items:center;justify-content:space-between;padding:0 5px 0 8px}.catalog-heading>div{display:flex;align-items:center;gap:7px}.catalog-heading span{font-size:13px;font-weight:650}.catalog-heading small{display:grid;min-width:20px;height:18px;place-items:center;border-radius:9px;background:#eef0ef;color:#8a8f8d;font-size:10px}.catalog-heading button{display:none;width:28px;height:28px;place-items:center;border:0;border-radius:4px;background:transparent;color:#6f7471}.catalog-search{display:flex;height:32px;align-items:center;gap:6px;margin:9px 4px 10px;border:1px solid #e1e4e2;border-radius:5px;background:#fff;color:#969b98;padding:0 9px}.catalog-search:focus-within{border-color:#91b4ef;box-shadow:0 0 0 2px rgba(47,111,235,.1)}.catalog-search input{width:100%;min-width:0;border:0;outline:0;background:transparent;color:#343735;font:inherit;font-size:12px}.catalog-search input::placeholder{color:#a3a7a5}.catalog-load-state{display:flex;align-items:flex-start;justify-content:center;gap:8px;margin:18px 6px;color:#8a8f8d;font-size:12px;line-height:1.55;text-align:left}.catalog-warning{border-radius:5px;background:#fff8e8;color:#91620d;padding:10px}.catalog-list{min-height:0;overflow:auto;padding:1px 2px}.catalog-list>a{display:flex;min-height:36px;align-items:center;gap:7px;margin:1px 0;border-radius:5px;color:#565b58;font-size:13px;line-height:1.35;text-decoration:none;padding:7px 9px}.catalog-list>a .v-icon{flex:0 0 auto;color:#929794}.catalog-list>a span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.catalog-list>a:hover{background:#f0f2f1;color:#252726}.catalog-list>a.active{background:#eaf1ff;color:#245fc7;font-weight:600}.catalog-list>a.active .v-icon{color:#2f6feb}.catalog-empty{margin:26px 8px;color:#9a9f9c;font-size:12px;text-align:center}.catalog-owner{display:flex;align-items:center;gap:9px;margin-top:auto;border-top:1px solid #e7e9e8;padding:11px 7px 0}.catalog-owner>div{display:flex;min-width:0;flex:1;flex-direction:column}.catalog-owner span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12px;font-weight:600}.catalog-owner small{color:#999e9b;font-size:10px}.catalog-owner>a{display:grid;width:26px;height:26px;place-items:center;border-radius:4px;color:#8a8f8d}.catalog-owner>a:hover{background:#eef0ef}.catalog-scrim{display:none}.reader-stage{min-height:calc(100dvh - var(--topbar-height));margin-left:var(--catalog-width);background-color:var(--reader-background,#fff);background-image:inherit;background-position:center top;background-size:cover}.reader-stage>article{position:relative;width:750px;max-width:calc(100% - 96px);margin:0 auto;padding:56px 0 110px;background:transparent}.reader-stage>article.reader-width-wide{width:900px}.reader-stage>article.reader-width-full{width:min(1040px,calc(100% - 64px));max-width:none}.reader-stage>article.reader-theme-magazine h1{font-size:44px}.reader-stage>article.reader-theme-dark{color:#e5e7eb}.reader-cover{height:300px;margin:0 0 40px;background-position:center;background-size:cover;border-radius:7px}.reader-icon{display:block;margin-bottom:12px;font-size:39px}.reader-article-header{position:relative;z-index:1;margin-bottom:42px}.reader-article-header h1{margin:0;color:inherit;font-size:36px;font-weight:700;line-height:1.32;letter-spacing:-.6px;overflow-wrap:anywhere}.reader-meta{display:flex;align-items:center;gap:8px;margin-top:18px;color:#969b98;font-size:12px}.reader-meta strong{color:#5a5f5c;font-size:12px;font-weight:500}.reader-meta>span{margin-left:2px}.reader-publish-state{display:inline-flex;align-items:center;gap:3px}.reader-feedback{position:relative;z-index:1;margin-top:72px;border-top:1px solid #e7e9e8;outline:0;padding-top:25px}.reader-feedback h3{margin:0;font-size:14px;font-weight:650}.reader-feedback>p{margin:4px 0 14px;color:#939895;font-size:12px}.reaction-row{display:flex;flex-wrap:wrap;gap:7px}.reaction-row :deep(.v-btn){height:31px;border-color:#d8dad9;border-radius:5px;color:#585a59;letter-spacing:0;text-transform:none}.reaction-row :deep(.v-btn.active){border-color:#8cb2f3;background:#edf3ff;color:#2f6feb}.reader-floating-actions{position:fixed;z-index:40;top:205px;right:max(20px,calc((100vw - var(--catalog-width) - 750px)/2 - 62px));display:grid;gap:10px}.reader-floating-actions button{display:flex;width:42px;min-height:48px;flex-direction:column;align-items:center;justify-content:center;gap:2px;border:1px solid #e2e4e3;border-radius:8px;background:rgba(255,255,255,.96);box-shadow:0 3px 12px rgba(20,29,25,.06);color:#767b78;font:inherit;cursor:pointer}.reader-floating-actions button:hover{border-color:#cbd2ce;background:#fff;color:#2f6feb}.reader-floating-actions button.active{border-color:#a9c3f2;background:#edf3ff;color:#2f6feb}.reader-floating-actions button:disabled{cursor:wait;opacity:.65}.reader-floating-actions span{font-size:10px;line-height:1.15}.reader-watermark{position:absolute;z-index:0;color:var(--reader-accent,#64748b);font-size:14px;font-weight:650;white-space:nowrap;pointer-events:none;user-select:none;transform:rotate(-24deg)}.reader-watermark.position-center{inset:48% auto auto 50%;font-size:18px;transform:translate(-50%,-50%) rotate(-24deg)}.reader-watermark.position-footer{inset:auto 0 18px auto;transform:none}.reader-watermark.position-tiled{inset:40% auto auto 45%;text-shadow:-250px -220px currentColor,0 -220px currentColor,250px -220px currentColor,-250px -80px currentColor,250px -80px currentColor,-250px 80px currentColor,250px 80px currentColor,-250px 220px currentColor,0 220px currentColor,250px 220px currentColor}:deep(.public-content-renderer){position:relative;z-index:1;color:#262626;font-family:ui-serif,Georgia,"Noto Serif SC",serif;font-size:16px;line-height:1.8}.reader-stage>article.document-font-sans :deep(.public-content-renderer){font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}.reader-stage>article.document-size-small :deep(.public-content-renderer){font-size:14px}.reader-stage>article.document-size-large :deep(.public-content-renderer){font-size:18px}.reader-stage>article.document-spacing-compact :deep(.reader-paragraph){margin-bottom:.65em}.reader-stage>article.document-spacing-relaxed :deep(.reader-paragraph){margin-bottom:1.7em}.reader-stage>article.reader-theme-dark :deep(.public-content-renderer){color:#d1d5db}
@media(max-width:1040px){.reader-topbar{grid-template-columns:minmax(0,1fr) auto}.reader-book-identity{display:none}.reader-document-identity{padding-left:12px}.catalog-toggle{display:grid;width:30px;height:30px;flex:0 0 auto;place-items:center;border:0;border-radius:5px;background:transparent;color:#565b58}.catalog-toggle:hover{background:#f1f3f2}.reader-catalog{z-index:80;visibility:hidden;transform:translateX(-101%);box-shadow:10px 0 30px rgba(20,29,25,.1);transition:transform .2s ease,visibility 0s linear .2s}.reader-catalog.catalog-open{visibility:visible;transform:none;transition-delay:0s}.catalog-heading button{display:grid}.catalog-scrim{position:fixed;z-index:75;inset:var(--topbar-height) 0 0;display:block;border:0;background:rgba(15,23,20,.28)}.reader-stage{margin-left:0}.reader-floating-actions{right:18px}}
@media(max-width:760px){.reader-topbar{grid-template-columns:minmax(0,1fr) auto}.reader-document-identity{padding-right:8px}.reader-top-actions{padding-right:9px}.reader-author-link,.reader-nav-link{display:none!important}.reader-top-actions .reader-account-link{padding:0 9px}.reader-stage>article,.reader-stage>article.reader-width-wide,.reader-stage>article.reader-width-full{width:auto;max-width:none;margin:0 20px;padding:39px 0 88px}.reader-cover{height:190px;margin-bottom:30px}.reader-article-header{margin-bottom:34px}.reader-article-header h1,.reader-stage>article.reader-theme-magazine h1{font-size:30px}.reader-meta{align-items:flex-start;flex-wrap:wrap}.reader-meta>span:not(.reader-publish-state){width:calc(100% - 36px);margin-left:34px}.reader-publish-state{display:none}.reader-floating-actions{top:auto;right:14px;bottom:14px;display:flex;gap:7px}.reader-floating-actions button{width:auto;min-width:48px;height:42px;min-height:42px;flex-direction:row;border-radius:21px;padding:0 12px}.reader-feedback{margin-top:58px}.reaction-row :deep(.v-btn){flex:1 1 calc(50% - 8px)}}
@media(prefers-reduced-motion:reduce){.reader-catalog{transition:none}}
</style>
