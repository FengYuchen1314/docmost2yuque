<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Explore, PublicContent, SearchResponse } from '../../../src/types'
import { messageOf, post } from '../../services/api'

const data = ref<Explore | null>(null)
const query = ref('')
const results = ref<PublicContent[]>([])
const loading = ref(true)
const searching = ref(false)
const error = ref('')

onMounted(async () => {
  try { data.value = await post('/api/public/v1/social/explore', { limit: 18 }, false) }
  catch (value) { error.value = messageOf(value) }
  finally { loading.value = false }
})

async function search() {
  const value = query.value.trim()
  if (!value) { results.value = []; return }
  searching.value = true
  error.value = ''
  try {
    const response = await post<SearchResponse>('/api/public/v1/search', { workspaceId: null, query: value, offset: 0, limit: 24 }, false)
    results.value = response.results.filter((item) => item.publicationId).map((item) => ({
      publicationId: item.publicationId!, pageId: item.resourceId, knowledgeBaseId: item.knowledgeBaseId!, knowledgeBaseName: '公开知识',
      title: item.title, path: item.path ?? '', contentType: (item.contentType ?? 'DOCUMENT') as PublicContent['contentType'], preview: item.snippet,
      authorId: '', authorSlug: '', authorName: '', authorAvatar: null, reactions: {}, viewerReactions: [], publishedAt: item.updatedAt,
    }))
  } catch (value) { error.value = messageOf(value) }
  finally { searching.value = false }
}

function icon(type: string) {
  return ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' } as Record<string, string>)[type] ?? 'mdi-file-outline'
}
</script>

<template>
  <main class="explore-page">
    <h1>逛逛</h1>
    <section class="explore-head">
      <div><h2>发现好内容</h2><p>看看大家最近发布和分享的知识。</p></div>
      <form class="explore-search" role="search" @submit.prevent="search"><v-icon size="18">mdi-magnify</v-icon><input v-model="query" aria-label="搜索公开内容" placeholder="搜索公开内容"><button type="submit" :disabled="searching">搜索</button></form>
    </section>
    <div v-if="error" class="explore-error" role="alert">{{ error }}</div>
    <div v-if="loading" class="explore-loading"><v-progress-circular indeterminate size="24" width="2" /></div>
    <section v-if="results.length" class="content-section"><h2>搜索结果</h2><div class="content-grid"><router-link v-for="item in results" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="22">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p></router-link></div></section>
    <template v-if="data && !results.length">
      <section class="content-section"><h2>正在流行</h2><div class="content-grid"><router-link v-for="item in data.trending" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="22">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p><small>{{ item.authorName }}</small></router-link></div></section>
      <section class="content-section"><h2>刚刚发布</h2><div class="content-grid"><router-link v-for="item in data.latest" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="22">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p></router-link></div></section>
    </template>
  </main>
</template>

<style scoped>
.explore-page { min-height: 100vh; padding: 26px 36px 60px; color: #262626; background: #fff; }
.explore-page > h1 { height: 28px; margin: 0 0 34px; font-size: 18px; font-weight: 500; line-height: 28px; }
.explore-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 28px; padding: 24px 0 28px; border-bottom: 1px solid #eff0f0; }
.explore-head h2 { margin: 0; font-size: 26px; font-weight: 600; }
.explore-head p { margin: 6px 0 0; color: #8a8f8d; font-size: 14px; }
.explore-search { display: flex; width: min(420px, 46%); height: 38px; align-items: center; gap: 8px; padding: 0 5px 0 11px; border: 1px solid #dfe2e1; border-radius: 8px; }
.explore-search:focus-within { border-color: #8eb4ff; box-shadow: 0 0 0 3px rgba(22, 119, 255, .08); }
.explore-search input { min-width: 0; flex: 1; border: 0; outline: 0; color: #262626; background: transparent; font: inherit; font-size: 14px; }
.explore-search button { height: 28px; padding: 0 11px; border: 0; border-radius: 6px; color: #fff; background: #1677ff; font: inherit; font-size: 13px; cursor: pointer; }
.explore-error { margin-top: 18px; padding: 10px 12px; border-radius: 6px; color: #cf1322; background: #fff1f0; font-size: 13px; }
.explore-loading { display: grid; min-height: 220px; place-items: center; color: #8a8f8d; }
.content-section { margin-top: 30px; }
.content-section > h2 { margin: 0 0 15px; font-size: 18px; font-weight: 500; }
.content-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; }
.content-card { display: flex; min-height: 136px; flex-direction: column; padding: 16px; border: 1px solid #e7e9e8; border-radius: 8px; color: #262626; background: #fff; text-decoration: none; }
.content-card:hover { border-color: #c9cecb; background: #fafbfa; }
.content-card:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.content-card > .v-icon { color: #3978f6; }
.content-card strong { margin-top: 12px; overflow: hidden; font-size: 14px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.content-card p { display: -webkit-box; overflow: hidden; margin: 5px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.content-card small { margin-top: auto; padding-top: 8px; color: #8a8f8d; font-size: 12px; }
@media (max-width: 760px) { .explore-page { padding: 22px 20px 48px; } .explore-head { align-items: stretch; flex-direction: column; } .explore-search { width: 100%; } }
</style>
