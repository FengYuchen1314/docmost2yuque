<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { Explore, PublicContent, SearchResponse } from '../../../src/types'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { messageOf, post } from '../../services/api'
const data=ref<Explore|null>(null);const query=ref('');const results=ref<PublicContent[]>([]);const loading=ref(true);const error=ref('')
onMounted(async()=>{try{data.value=await post('/api/public/v1/social/explore',{limit:18},false)}catch(value){error.value=messageOf(value)}finally{loading.value=false}})
async function search(){if(!query.value.trim()){results.value=[];return}const response=await post<SearchResponse>('/api/public/v1/search',{workspaceId:null,query:query.value.trim(),offset:0,limit:24},false);results.value=response.results.filter(item=>item.publicationId).map(item=>({publicationId:item.publicationId!,pageId:item.resourceId,knowledgeBaseId:item.knowledgeBaseId!,knowledgeBaseName:'公开知识',title:item.title,path:item.path??'',contentType:(item.contentType??'DOCUMENT') as PublicContent['contentType'],preview:item.snippet,authorId:'',authorSlug:'',authorName:'',authorAvatar:null,reactions:{},viewerReactions:[],publishedAt:item.updatedAt}))}
const contentIcon=(type:string)=>({DOCUMENT:'mdi-file-document-outline',WHITEBOARD:'mdi-drawing-box',SPREADSHEET:'mdi-table-large',DATABASE:'mdi-database-outline'} as Record<string,string>)[type]??'mdi-file-outline'
</script>
<template>
  <PublicLayout>
    <div class="explore-page">
      <section class="explore-intro">
        <span class="page-kicker">发现</span>
        <h1>发现好知识</h1>
        <p>浏览公开发布的文档、知识库和创作者。</p>
        <form class="explore-search" role="search" @submit.prevent="search">
          <v-text-field v-model="query" class="search-field" placeholder="搜索公开内容" aria-label="搜索公开内容" prepend-inner-icon="mdi-magnify" variant="outlined" density="compact" hide-details />
          <v-btn type="submit" class="search-button" variant="flat">搜索</v-btn>
        </form>
      </section>

      <v-progress-linear v-if="loading" indeterminate color="#00b96b" height="2" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="public-alert">{{ error }}</v-alert>

      <section v-if="results.length" class="public-section search-results">
        <header class="section-heading"><div><h2>搜索结果</h2><p>找到 {{ results.length }} 条公开内容</p></div></header>
        <div class="content-list">
          <router-link v-for="item in results" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-row">
            <span class="content-icon"><v-icon size="20">{{ contentIcon(item.contentType) }}</v-icon></span>
            <span class="content-copy"><strong>{{ item.title }}</strong><small>{{ item.preview || '暂无摘要' }}</small></span>
            <v-icon class="row-arrow" size="18">mdi-chevron-right</v-icon>
          </router-link>
        </div>
      </section>

      <template v-if="data">
        <section class="public-section">
          <header class="section-heading"><div><h2>热门内容</h2><p>近期阅读和互动较多的公开内容</p></div></header>
          <div class="content-list content-list-columns">
            <router-link v-for="item in data.trending" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="content-row">
              <span class="content-icon"><v-icon size="20">{{ contentIcon(item.contentType) }}</v-icon></span>
              <span class="content-copy"><strong>{{ item.title }}</strong><small>{{ item.preview || '暂无摘要' }}</small><em>{{ item.authorName || item.knowledgeBaseName }}</em></span>
              <v-icon class="row-arrow" size="18">mdi-chevron-right</v-icon>
            </router-link>
          </div>
        </section>

        <section class="public-section two-column-section">
          <div>
            <header class="section-heading"><div><h2>最新发布</h2><p>刚刚加入公开知识网络</p></div></header>
            <div class="compact-list">
              <router-link v-for="item in data.latest" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="compact-row">
                <span><strong>{{ item.title }}</strong><small>{{ item.knowledgeBaseName }}</small></span>
                <time>{{ new Date(item.publishedAt).toLocaleDateString('zh-CN') }}</time>
              </router-link>
            </div>
          </div>
          <div>
            <header class="section-heading"><div><h2>创作者</h2><p>持续分享知识的人</p></div></header>
            <div class="creator-list">
              <router-link v-for="creator in data.creators" :key="creator.userId" :to="`/u/${creator.slug}`" class="creator-row">
                <v-avatar size="36" color="#eaf8f1"><v-img v-if="creator.avatarUrl" :src="creator.avatarUrl" /><span v-else>{{ creator.displayName.slice(0, 1) }}</span></v-avatar>
                <span><strong>{{ creator.displayName }}</strong><small>{{ creator.bio || `@${creator.slug}` }}</small></span>
                <v-icon size="17">mdi-chevron-right</v-icon>
              </router-link>
            </div>
          </div>
        </section>

        <section v-if="data.gardens.length" class="public-section">
          <header class="section-heading"><div><h2>知识花园</h2><p>按主题聚合的公开知识库</p></div></header>
          <div class="garden-list">
            <router-link v-for="garden in data.gardens" :key="garden.id" :to="`/garden/${garden.slug}`" class="garden-row">
              <span class="garden-icon">{{ garden.icon || '🌿' }}</span>
              <span><strong>{{ garden.title }}</strong><small>{{ garden.description || `${garden.ownerName} 的知识花园` }}</small></span>
              <em>{{ garden.knowledgeBases.length }} 个知识库</em>
            </router-link>
          </div>
        </section>
      </template>
    </div>
  </PublicLayout>
</template>

<style scoped>
.explore-page{width:min(1120px,calc(100% - 48px));margin:0 auto;padding:0 0 80px}.explore-intro{padding:52px 0 40px;border-bottom:1px solid #f0f0f0}.page-kicker{display:block;margin-bottom:6px;color:#00a870;font-size:13px;font-weight:600}.explore-intro h1{margin:0;color:#262626;font-size:32px;font-weight:650;letter-spacing:-.5px;line-height:44px}.explore-intro>p{margin:5px 0 0;color:#8a8f8d;font-size:14px}.explore-search{display:flex;max-width:640px;gap:10px;margin-top:24px}.search-field{flex:1}.search-field :deep(.v-field){min-height:40px;border-radius:6px;background:#fff}.search-field :deep(.v-field__outline){--v-field-border-opacity:1;color:#d8dad9}.search-field :deep(.v-field--focused .v-field__outline){color:#00b96b}.search-button{height:40px!important;border-radius:6px!important;background:#00b96b!important;color:#fff!important;letter-spacing:0;text-transform:none}.public-alert{margin-top:24px;border-radius:6px}.public-section{padding-top:38px}.section-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:14px}.section-heading h2{margin:0;color:#262626;font-size:20px;font-weight:650;line-height:28px}.section-heading p{margin:3px 0 0;color:#8a8f8d;font-size:12px}.content-list{overflow:hidden;border:1px solid #e7e9e8;border-radius:8px}.content-list-columns{display:grid;grid-template-columns:1fr 1fr}.content-row{display:grid;min-width:0;grid-template-columns:36px minmax(0,1fr) 18px;align-items:start;gap:12px;padding:16px;color:#262626;text-decoration:none;border-top:1px solid #f0f0f0}.content-row:first-child,.content-list-columns .content-row:nth-child(2){border-top:0}.content-list-columns .content-row:nth-child(odd){border-right:1px solid #f0f0f0}.content-row:hover{background:#fafafa}.content-icon{display:grid;width:36px;height:36px;place-items:center;border-radius:6px;background:#f2f8f5;color:#00a870}.content-copy{display:flex;min-width:0;flex-direction:column}.content-copy strong,.compact-row strong,.creator-row strong,.garden-row strong{overflow:hidden;color:#262626;font-size:14px;font-weight:600;line-height:21px;text-overflow:ellipsis;white-space:nowrap}.content-copy small{display:-webkit-box;margin-top:3px;overflow:hidden;color:#8a8f8d;font-size:12px;line-height:19px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.content-copy em{margin-top:7px;color:#a3a7a5;font-size:11px;font-style:normal}.row-arrow{align-self:center;color:#b6bab8}.two-column-section{display:grid;grid-template-columns:1fr 1fr;gap:48px}.compact-list,.creator-list{border-top:1px solid #e7e9e8}.compact-row,.creator-row{display:flex;min-height:58px;align-items:center;gap:12px;border-bottom:1px solid #f0f0f0;color:#262626;text-decoration:none}.compact-row>span,.creator-row>span{display:flex;min-width:0;flex:1;flex-direction:column}.compact-row small,.creator-row small,.garden-row small{overflow:hidden;margin-top:2px;color:#8a8f8d;font-size:12px;line-height:18px;text-overflow:ellipsis;white-space:nowrap}.compact-row time{color:#a3a7a5;font-size:11px;white-space:nowrap}.compact-row:hover strong,.creator-row:hover strong,.garden-row:hover strong{color:#00a870}.creator-row>.v-icon{color:#b6bab8}.creator-row :deep(.v-avatar){color:#00a870;font-size:13px}.garden-list{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.garden-row{display:grid;min-width:0;grid-template-columns:40px minmax(0,1fr);gap:4px 12px;padding:15px;border:1px solid #e7e9e8;border-radius:7px;color:#262626;text-decoration:none}.garden-row:hover{border-color:#c9cccb;background:#fafafa}.garden-icon{grid-row:1/3;display:grid;width:40px;height:40px;place-items:center;border-radius:7px;background:#f5f6f5;font-size:20px}.garden-row>span:nth-child(2){display:flex;min-width:0;flex-direction:column}.garden-row em{grid-column:2;color:#a3a7a5;font-size:11px;font-style:normal}.search-results{padding-top:30px;padding-bottom:6px;border-bottom:1px solid #f0f0f0}
@media(max-width:760px){.explore-page{width:calc(100% - 32px);padding-bottom:56px}.explore-intro{padding:36px 0 30px}.explore-intro h1{font-size:28px}.explore-search{gap:8px}.content-list-columns,.two-column-section{grid-template-columns:1fr}.content-list-columns .content-row:nth-child(2){border-top:1px solid #f0f0f0}.content-list-columns .content-row:nth-child(odd){border-right:0}.two-column-section{gap:34px}.garden-list{grid-template-columns:1fr}.public-section{padding-top:32px}}
</style>
