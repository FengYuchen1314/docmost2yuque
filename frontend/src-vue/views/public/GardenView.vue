<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { Garden, PublicContent, SocialPage } from '../../../src/types'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { messageOf, post } from '../../services/api'
const route=useRoute();const slug=String(route.params.slug);const garden=ref<Garden|null>(null);const items=ref<PublicContent[]>([]);const selected=ref('');const loading=ref(true);const error=ref('')
const selectedKnowledgeBase=computed(()=>garden.value?.knowledgeBases.find(item=>item.id===selected.value)??null)
onMounted(async()=>{try{garden.value=await post('/api/public/v1/social/garden',{slug},false);await loadContent()}catch(value){error.value=messageOf(value)}finally{loading.value=false}});watch(selected,loadContent)
async function loadContent(){items.value=(await post<SocialPage<PublicContent>>('/api/public/v1/social/garden/content/page',{slug,knowledgeBaseId:selected.value||null,offset:0,limit:48},false)).items}
</script>
<template>
  <PublicLayout>
    <div class="garden-page">
      <div v-if="loading" class="garden-state"><v-progress-circular indeterminate color="#00b96b" size="36" width="3" /><p>正在加载知识花园…</p></div>
      <div v-else-if="!garden" class="garden-state" role="alert">
        <span class="state-icon"><v-icon size="24">mdi-flower-outline</v-icon></span>
        <h1>没有找到这个知识花园</h1>
        <p>{{ error || '该花园可能不存在，或尚未公开。' }}</p>
        <v-btn to="/explore" variant="outlined" class="state-action">返回发现</v-btn>
      </div>

      <template v-else>
        <header class="garden-header">
          <span class="garden-icon">{{ garden.icon || '🌿' }}</span>
          <div class="garden-heading-copy">
            <router-link :to="`/u/${garden.ownerSlug}`" class="garden-owner">{{ garden.ownerName }} 的知识花园</router-link>
            <h1>{{ garden.title }}</h1>
            <p>{{ garden.description || '把知识整理成一座可以漫游的花园。' }}</p>
            <div class="garden-meta"><span>{{ garden.knowledgeBases.length }} 个知识库</span><span>{{ garden.followerCount }} 位关注者</span></div>
            <nav v-if="garden.navigation.length" class="garden-links" aria-label="知识花园外部链接">
              <a v-for="link in garden.navigation" :key="`${link.label}-${link.url}`" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}<v-icon size="13">mdi-open-in-new</v-icon></a>
            </nav>
          </div>
        </header>

        <nav class="knowledge-nav" role="tablist" aria-label="知识库筛选">
          <button type="button" role="tab" :aria-selected="!selected" :class="{ active: !selected }" @click="selected = ''">全部</button>
          <button v-for="kb in garden.knowledgeBases" :key="kb.id" type="button" role="tab" :aria-selected="selected === kb.id" :class="{ active: selected === kb.id }" @click="selected = kb.id"><span>{{ kb.icon || '📘' }}</span>{{ kb.name }}</button>
        </nav>

        <section class="garden-content">
          <header class="garden-content-heading"><div><h2>{{ selectedKnowledgeBase?.name || '全部内容' }}</h2><p>{{ selectedKnowledgeBase?.description || '浏览花园中公开发布的内容' }}</p></div><span>{{ items.length }} 篇</span></header>
          <div v-if="items.length" class="garden-content-list">
            <router-link v-for="item in items" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="garden-content-row">
              <span class="document-mark"><v-icon size="19">mdi-file-document-outline</v-icon></span>
              <span class="document-copy"><strong>{{ item.title }}</strong><small>{{ item.preview || '暂无摘要' }}</small><em>{{ item.knowledgeBaseName }}</em></span>
              <time>{{ new Date(item.publishedAt).toLocaleDateString('zh-CN') }}</time>
            </router-link>
          </div>
          <div v-else class="garden-empty"><v-icon size="30">mdi-file-outline</v-icon><strong>这个分区还没有内容</strong><p>公开发布的内容会出现在这里。</p></div>
        </section>
      </template>
    </div>
  </PublicLayout>
</template>

<style scoped>
.garden-page{width:min(960px,calc(100% - 48px));min-height:calc(100dvh - 56px);margin:0 auto;padding-bottom:80px}.garden-header{display:grid;grid-template-columns:54px minmax(0,1fr);gap:18px;padding:48px 0 34px}.garden-icon{display:grid;width:54px;height:54px;place-items:center;border:1px solid #e7e9e8;border-radius:9px;background:#fafafa;font-size:27px}.garden-heading-copy{min-width:0}.garden-owner{color:#00a870;font-size:12px;text-decoration:none}.garden-owner:hover{text-decoration:underline}.garden-heading-copy h1{margin:5px 0 0;color:#262626;font-size:30px;font-weight:650;letter-spacing:-.5px;line-height:40px}.garden-heading-copy>p{max-width:680px;margin:7px 0 0;color:#646a67;font-size:14px;line-height:22px}.garden-meta{display:flex;gap:20px;margin-top:11px;color:#8a8f8d;font-size:12px}.garden-links{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:11px}.garden-links a{display:inline-flex;align-items:center;gap:3px;color:#00a870;font-size:12px;text-decoration:none}.garden-links a:hover{text-decoration:underline}.knowledge-nav{display:flex;min-height:45px;gap:26px;overflow-x:auto;border-bottom:1px solid #e7e9e8}.knowledge-nav button{position:relative;display:inline-flex;height:44px;align-items:center;gap:6px;border:0;background:transparent;color:#646a67;cursor:pointer;font:13px/44px inherit;white-space:nowrap}.knowledge-nav button::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:999px;background:transparent;content:""}.knowledge-nav button.active{color:#262626;font-weight:600}.knowledge-nav button.active::after{background:#00b96b}.garden-content{padding-top:30px}.garden-content-heading{display:flex;align-items:flex-end;justify-content:space-between;margin-bottom:12px}.garden-content-heading h2{margin:0;color:#262626;font-size:20px;font-weight:650}.garden-content-heading p{margin:3px 0 0;color:#8a8f8d;font-size:12px}.garden-content-heading>span{color:#a3a7a5;font-size:12px}.garden-content-list{border-top:1px solid #e7e9e8}.garden-content-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:start;gap:12px;padding:17px 4px;border-bottom:1px solid #f0f0f0;color:#262626;text-decoration:none}.garden-content-row:hover{background:#fafafa}.document-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:6px;background:#f2f8f5;color:#00a870}.document-copy{display:flex;min-width:0;flex-direction:column}.document-copy strong{overflow:hidden;font-size:14px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}.garden-content-row:hover .document-copy strong{color:#00a870}.document-copy small{display:-webkit-box;margin-top:3px;overflow:hidden;color:#8a8f8d;font-size:12px;line-height:19px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.document-copy em{margin-top:6px;color:#a3a7a5;font-size:11px;font-style:normal}.garden-content-row time{padding-top:3px;color:#a3a7a5;font-size:11px;white-space:nowrap}.garden-empty,.garden-state{display:grid;min-height:280px;place-items:center;align-content:center;color:#8a8f8d;text-align:center}.garden-empty strong,.garden-state h1{margin:12px 0 0;color:#4f5552;font-size:15px;font-weight:600}.garden-empty p,.garden-state p{margin:6px 0 0;font-size:12px}.garden-state{min-height:calc(100dvh - 136px)}.garden-state h1{font-size:20px}.state-icon{display:grid;width:48px;height:48px;place-items:center;border-radius:50%;background:#f3f5f4;color:#8a8f8d}.state-action{height:34px!important;margin-top:20px;border-color:#d8dad9!important;border-radius:5px!important;letter-spacing:0;text-transform:none}
@media(max-width:640px){.garden-page{width:calc(100% - 32px);padding-bottom:56px}.garden-header{grid-template-columns:46px minmax(0,1fr);gap:13px;padding:36px 0 26px}.garden-icon{width:46px;height:46px;font-size:23px}.garden-heading-copy h1{font-size:25px;line-height:34px}.knowledge-nav{gap:22px}.garden-content-row{grid-template-columns:32px minmax(0,1fr)}.garden-content-row time{display:none}.document-mark{width:32px;height:32px}}
</style>
