<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { FeedItem, SocialPage } from '../../../src/types'
import { messageOf, post } from '../../services/api'
const items=ref<FeedItem[]>([]);const loading=ref(true);const error=ref('');const offset=ref(0);const more=ref(false)
onMounted(load)
async function load(){loading.value=true;try{const page=await post<SocialPage<FeedItem>>('/api/v1/social/feed/page',{offset:offset.value,limit:25});items.value=offset.value?[...items.value,...page.items]:page.items;offset.value=page.nextOffset;more.value=page.hasMore}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
async function react(publicationId:string,type:string){await post('/api/v1/social/reactions/toggle',{publicationId,reactionType:type});await load()}
</script>
<template>
  <main class="feed-page">
    <header class="feed-header"><div><h1>关注动态</h1><p>你关注的人和知识库最近发布的内容。</p></div><v-btn to="/explore" prepend-icon="mdi-compass-outline" variant="text" size="small">发现更多</v-btn></header>
    <section class="feed-stage" aria-label="关注动态列表">
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="feed-error">{{ error }}</v-alert>
      <v-progress-linear v-if="loading && !items.length" indeterminate color="primary" height="2" class="feed-progress" />

      <div v-if="items.length" class="feed-stream">
        <article v-for="entry in items" :key="entry.content.publicationId" class="feed-entry">
          <header class="entry-meta">
            <v-avatar size="34" color="primary" variant="tonal">{{ entry.content.authorName.slice(0, 1) }}</v-avatar>
            <div><strong>{{ entry.content.authorName }}</strong><p>{{ entry.reason }} · {{ new Date(entry.content.publishedAt).toLocaleString('zh-CN') }}</p></div>
          </header>
          <router-link :to="`/p/${entry.content.publicationId}`" class="entry-content">
            <h2>{{ entry.content.title }}</h2>
            <p>{{ entry.content.preview }}</p>
            <span>查看内容 <v-icon size="14">mdi-arrow-right</v-icon></span>
          </router-link>
          <footer class="entry-actions">
            <button type="button" @click="react(entry.content.publicationId, 'LIKE')"><v-icon size="17">mdi-thumb-up-outline</v-icon><span>{{ entry.content.reactions.LIKE || 0 }}</span></button>
            <button type="button" @click="react(entry.content.publicationId, 'HEART')"><v-icon size="17">mdi-heart-outline</v-icon><span>{{ entry.content.reactions.HEART || 0 }}</span></button>
          </footer>
        </article>
      </div>

      <div v-else-if="!loading" class="feed-empty"><v-icon size="38">mdi-rss-off</v-icon><h3>关注流还是空的</h3><p>关注创作者或知识库后，最新发布会出现在这里。</p><v-btn to="/explore" color="primary" variant="tonal" size="small">去发现</v-btn></div>
      <div v-if="more" class="feed-more"><v-btn variant="text" size="small" :loading="loading" @click="load">加载更多</v-btn></div>
    </section>
  </main>
</template>

<style scoped>
.feed-page { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.feed-page :deep(.v-btn) { text-transform: none; letter-spacing: 0; }
.feed-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.feed-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.feed-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.feed-stage { width: min(760px, calc(100% - 40px)); margin: 24px auto 60px; }
.feed-error { margin-bottom: 14px; }
.feed-progress { margin-bottom: 12px; }
.feed-stream { border-top: 1px solid #eceeed; }
.feed-entry { padding: 20px 2px 18px; border-bottom: 1px solid #eceeed; }
.entry-meta { display: flex; align-items: center; gap: 10px; }
.entry-meta > div { min-width: 0; }
.entry-meta strong { display: block; color: #3a403d; font-size: 13px; font-weight: 600; }
.entry-meta p { margin: 1px 0 0; overflow: hidden; color: #999f9c; font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.entry-content { display: block; margin: 14px 44px 9px; color: inherit; text-decoration: none; }
.entry-content h2 { margin: 0; color: #262b29; font-size: 17px; font-weight: 650; line-height: 1.55; }
.entry-content > p { margin: 6px 0 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; color: #737a76; font-size: 13px; line-height: 1.72; }
.entry-content > span { margin-top: 7px; display: inline-flex; align-items: center; gap: 3px; color: #8c938f; font-size: 11px; }
.entry-content:hover h2, .entry-content:hover > span { color: #2169d7; }
.entry-actions { margin-left: 38px; display: flex; align-items: center; gap: 2px; }
.entry-actions button { min-width: 42px; height: 28px; padding: 0 8px; border: 0; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; color: #838a86; background: transparent; font: inherit; font-size: 11px; cursor: pointer; }
.entry-actions button:hover { color: #2868d8; background: #f3f6fb; }
.feed-empty { min-height: 360px; display: grid; place-content: center; justify-items: center; color: #adb2af; text-align: center; }
.feed-empty h3 { margin: 12px 0 4px; color: #616864; font-size: 15px; font-weight: 600; }
.feed-empty p { margin: 0 0 16px; color: #999f9c; font-size: 12px; }
.feed-more { padding: 20px 0; text-align: center; }
@media (max-width: 700px) { .feed-page { margin: -16px; } .feed-header { padding: 0 18px; } .feed-stage { margin-top: 16px; } .entry-content { margin-left: 0; margin-right: 0; } .entry-actions { margin-left: -6px; } }
</style>
