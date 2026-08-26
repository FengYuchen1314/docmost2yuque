<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Explore, PublicContent, SearchResponse } from '../../../src/types'
import { messageOf, post } from '../../services/api'

const data = ref<Explore | null>(null)
const query = ref('')
const searchedQuery = ref('')
const results = ref<PublicContent[]>([])
const loading = ref(true)
const searching = ref(false)
const error = ref('')

onMounted(() => void loadExplore())

async function loadExplore() {
  loading.value = true
  error.value = ''
  try { data.value = await post('/api/public/v1/social/explore', { limit: 18 }, false) }
  catch (value) { error.value = messageOf(value) }
  finally { loading.value = false }
}

async function search() {
  const value = query.value.trim()
  if (!value) { clearSearch(); return }
  searching.value = true
  searchedQuery.value = value
  results.value = []
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

function clearSearch() {
  query.value = ''
  searchedQuery.value = ''
  results.value = []
  error.value = ''
}

function icon(type: string) {
  return ({ DOCUMENT: 'mdi-file-document-outline', WHITEBOARD: 'mdi-drawing-box', SPREADSHEET: 'mdi-table-large', DATABASE: 'mdi-database-outline' } as Record<string, string>)[type] ?? 'mdi-file-outline'
}
</script>

<template>
  <main class="explore-page">
    <header class="explore-header"><div><h1>逛逛</h1><p>发现公开发布的优质知识。</p></div></header>
    <div class="explore-body">
      <section class="explore-head">
        <div><h2>发现好内容</h2><p>看看大家最近发布和分享的知识。</p></div>
        <form class="explore-search" role="search" @submit.prevent="search"><v-icon size="17">mdi-magnify</v-icon><input v-model="query" aria-label="搜索公开内容" placeholder="搜索公开内容"><button v-if="query" type="button" class="clear-search" aria-label="清空搜索" @click="clearSearch"><v-icon size="15">mdi-close</v-icon></button><button type="submit" class="search-submit" :disabled="searching || !query.trim()"><v-progress-circular v-if="searching" indeterminate size="14" width="2" /><template v-else>搜索</template></button></form>
      </section>
      <div v-if="error" class="explore-error" role="alert"><span>{{ error }}</span><button type="button" @click="searchedQuery ? search() : loadExplore()">重试</button></div>

      <div v-if="loading" class="content-grid loading-grid" aria-label="正在加载公开内容"><v-skeleton-loader v-for="index in 8" :key="index" type="article" /></div>

      <section v-else-if="searchedQuery" class="content-section search-results">
        <div class="section-title"><h2>“{{ searchedQuery }}”的搜索结果</h2><span>{{ results.length }} 条</span><button type="button" @click="clearSearch">返回推荐</button></div>
        <div v-if="results.length" class="content-grid"><router-link v-for="item in results" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="20">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p></router-link></div>
        <div v-else-if="!searching && !error" class="explore-empty"><v-icon size="38">mdi-text-search-variant</v-icon><h3>没有找到相关内容</h3><p>换一个关键词，或返回看看推荐内容。</p><v-btn variant="tonal" size="small" @click="clearSearch">返回推荐</v-btn></div>
      </section>

      <template v-else-if="data">
        <section v-if="data.trending.length" class="content-section"><div class="section-title"><h2>正在流行</h2><span>{{ data.trending.length }} 篇</span></div><div class="content-grid"><router-link v-for="item in data.trending" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="20">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p><small>{{ item.authorName }}</small></router-link></div></section>
        <section v-if="data.latest.length" class="content-section"><div class="section-title"><h2>刚刚发布</h2><span>{{ data.latest.length }} 篇</span></div><div class="content-grid"><router-link v-for="item in data.latest" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-card"><v-icon size="20">{{ icon(item.contentType) }}</v-icon><strong>{{ item.title }}</strong><p>{{ item.preview }}</p></router-link></div></section>
        <div v-if="!data.trending.length && !data.latest.length && !error" class="explore-empty"><v-icon size="38">mdi-compass-off-outline</v-icon><h3>暂时没有公开内容</h3><p>新发布的公开知识会出现在这里。</p></div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.explore-page { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.explore-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; }
.explore-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.explore-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.explore-body { width: min(1120px, calc(100% - 48px)); margin: 0 auto 64px; }
.explore-head { min-height: 105px; display: flex; align-items: center; justify-content: space-between; gap: 28px; border-bottom: 1px solid #eff0f0; }
.explore-head h2 { margin: 0; font-size: 22px; font-weight: 650; }
.explore-head p { margin: 4px 0 0; color: #8a8f8d; font-size: 13px; }
.explore-search { display: flex; width: min(410px, 46%); height: 36px; align-items: center; gap: 7px; padding: 0 4px 0 10px; border: 1px solid #dfe2e1; border-radius: 7px; }
.explore-search:focus-within { border-color: #8eb4ff; box-shadow: 0 0 0 3px rgba(22, 119, 255, .08); }
.explore-search input { min-width: 0; flex: 1; border: 0; outline: 0; color: #262626; background: transparent; font: inherit; font-size: 13px; }
.explore-search button { border: 0; font: inherit; cursor: pointer; }
.clear-search { width: 22px; height: 22px; padding: 0; border-radius: 4px; display: grid; place-items: center; color: #929895; background: transparent; }
.search-submit { min-width: 52px; height: 28px; padding: 0 10px; border-radius: 6px; color: #fff; background: #1677ff; font-size: 12px; }
.search-submit:disabled { cursor: default; opacity: .45; }
.explore-error { margin-top: 14px; padding: 9px 11px; border-radius: 6px; display: flex; align-items: center; justify-content: space-between; gap: 10px; color: #c83c3c; background: #fff2f1; font-size: 12px; }
.explore-error button { padding: 0; border: 0; color: #a82c2c; background: transparent; font: inherit; cursor: pointer; }
.content-section { margin-top: 26px; }
.section-title { min-height: 32px; margin-bottom: 10px; display: flex; align-items: center; gap: 9px; }
.section-title h2 { margin: 0; font-size: 16px; font-weight: 600; }
.section-title span { color: #9aa09d; font-size: 11px; }
.section-title button { margin-left: auto; padding: 0; border: 0; color: #65706a; background: transparent; font-size: 12px; cursor: pointer; }
.section-title button:hover { color: #2169d7; }
.content-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; }
.loading-grid { margin-top: 24px; }
.loading-grid :deep(.v-skeleton-loader) { min-height: 126px; border: 1px solid #eceeed; border-radius: 8px; }
.content-card { display: flex; min-height: 126px; flex-direction: column; padding: 14px; border: 1px solid #e7e9e8; border-radius: 8px; color: #262626; background: #fff; text-decoration: none; transition: border-color .14s, box-shadow .14s; }
.content-card:hover { border-color: #c9cecb; box-shadow: 0 4px 12px rgba(33, 42, 37, .045); }
.content-card:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.content-card > .v-icon { color: #3978f6; }
.content-card strong { margin-top: 10px; overflow: hidden; font-size: 14px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.content-card p { display: -webkit-box; overflow: hidden; margin: 5px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.content-card small { margin-top: auto; padding-top: 7px; color: #9ba19e; font-size: 11px; }
.explore-empty { min-height: 310px; display: grid; place-content: center; justify-items: center; color: #acb1ae; text-align: center; }
.explore-empty h3 { margin: 12px 0 4px; color: #606763; font-size: 15px; font-weight: 600; }
.explore-empty p { margin: 0 0 15px; color: #999f9c; font-size: 12px; }
@media (max-width: 760px) { .explore-page { margin: -16px; } .explore-header { padding: 0 18px; } .explore-body { width: calc(100% - 28px); } .explore-head { align-items: stretch; flex-direction: column; justify-content: center; gap: 14px; padding: 18px 0; } .explore-search { width: 100%; } .content-grid { grid-template-columns: 1fr; } }
</style>
