<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { PublicContent, PublicProfile, SocialPage } from '../../../src/types'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { contentTypeLabel } from '../../utils/displayLabels'
const route=useRoute();const session=useSessionStore();const slug=String(route.params.slug);const profile=ref<PublicProfile|null>(null);const items=ref<PublicContent[]>([]);const error=ref('');const loading=ref(true)
const self=computed(()=>session.user?.userId===profile.value?.userId)
onMounted(async()=>{try{[profile.value,items.value]=await Promise.all([post('/api/public/v1/social/profile',{slug},false),post<SocialPage<PublicContent>>('/api/public/v1/social/profile/content/page',{slug,offset:0,limit:48},false).then(v=>v.items)])}catch(value){error.value=messageOf(value)}finally{loading.value=false}})
async function follow(){if(!profile.value)return;if(!session.user){location.href=`/login?returnTo=${encodeURIComponent(location.pathname)}`;return}await post(profile.value.followed?'/api/v1/social/unfollow':'/api/v1/social/follow',{targetType:'USER',targetId:profile.value.userId,notificationsEnabled:true});profile.value.followed=!profile.value.followed;profile.value.followerCount+=profile.value.followed?1:-1}
</script>
<template>
  <PublicLayout>
    <div class="profile-page">
      <div v-if="loading" class="public-state"><v-progress-circular indeterminate color="#00b96b" size="36" width="3" /><p>正在加载个人主页…</p></div>
      <div v-else-if="error || !profile" class="public-state" role="alert">
        <span class="state-icon"><v-icon size="24">mdi-account-question-outline</v-icon></span>
        <h1>没有找到这个个人主页</h1>
        <p>{{ error || '该用户可能不存在，或尚未开放个人主页。' }}</p>
        <v-btn to="/explore" variant="outlined" class="state-action">返回发现</v-btn>
      </div>

      <template v-else>
        <header class="profile-header">
          <v-avatar class="profile-avatar" size="64" color="#eaf8f1">
            <v-img v-if="profile.avatarUrl" :src="profile.avatarUrl" />
            <span v-else>{{ profile.displayName.slice(0, 1) }}</span>
          </v-avatar>
          <div class="profile-copy">
            <div class="profile-title-line"><div><h1>{{ profile.displayName }}</h1><span>@{{ profile.slug }}</span></div>
              <v-btn v-if="self" to="/app/profile" variant="outlined" class="profile-action">编辑主页</v-btn>
              <v-btn v-else :variant="profile.followed ? 'outlined' : 'flat'" :class="['profile-action', { 'followed': profile.followed }]" @click="follow">{{ profile.followed ? '已关注' : '关注' }}</v-btn>
            </div>
            <p class="profile-bio">{{ profile.bio || '正在持续整理和分享知识。' }}</p>
            <div class="profile-meta"><span><strong>{{ profile.followerCount }}</strong> 关注者</span><span><strong>{{ profile.followingCount }}</strong> 正在关注</span></div>
            <nav v-if="profile.navigation.length" class="profile-links" aria-label="个人主页链接">
              <a v-for="link in profile.navigation" :key="`${link.label}-${link.url}`" :href="link.url" target="_blank" rel="noopener noreferrer">{{ link.label }}<v-icon size="13">mdi-open-in-new</v-icon></a>
            </nav>
          </div>
        </header>

        <section class="profile-content">
          <header class="content-heading"><h2>公开内容</h2><span>{{ items.length }} 篇</span></header>
          <div v-if="items.length" class="profile-content-list">
            <router-link v-for="item in items" :key="item.publicationId" :to="`/p/${item.publicationId}`" class="profile-content-row">
              <span class="document-mark"><v-icon size="19">mdi-file-document-outline</v-icon></span>
              <span class="document-copy"><strong>{{ item.title }}</strong><small>{{ item.preview || '暂无摘要' }}</small><em>{{ item.knowledgeBaseName }} · {{ contentTypeLabel(item.contentType) }}</em></span>
              <time>{{ new Date(item.publishedAt).toLocaleDateString('zh-CN') }}</time>
            </router-link>
          </div>
          <div v-else class="profile-empty"><v-icon size="30">mdi-file-eye-outline</v-icon><strong>暂无公开内容</strong><p>公开发布的内容会出现在这里。</p></div>
        </section>
      </template>
    </div>
  </PublicLayout>
</template>

<style scoped>
.profile-page{width:min(920px,calc(100% - 48px));min-height:calc(100dvh - 56px);margin:0 auto;padding-bottom:80px}.profile-header{display:grid;grid-template-columns:64px minmax(0,1fr);gap:20px;padding:52px 0 36px;border-bottom:1px solid #e7e9e8}.profile-avatar{color:#00a870;font-size:24px;font-weight:650}.profile-copy{min-width:0}.profile-title-line{display:flex;min-height:36px;align-items:flex-start;justify-content:space-between;gap:24px}.profile-title-line>div{min-width:0}.profile-title-line h1{overflow:hidden;margin:0;color:#262626;font-size:28px;font-weight:650;letter-spacing:-.4px;line-height:36px;text-overflow:ellipsis;white-space:nowrap}.profile-title-line span{display:block;margin-top:1px;color:#a3a7a5;font-size:12px}.profile-action{height:34px!important;min-width:72px!important;border-radius:5px!important;background:#00b96b!important;color:#fff!important;font-size:13px;letter-spacing:0;text-transform:none}.profile-action.followed,.profile-action.v-btn--variant-outlined{border-color:#d8dad9!important;background:#fff!important;color:#646a67!important}.profile-bio{max-width:640px;margin:14px 0 10px;color:#646a67;font-size:14px;line-height:22px}.profile-meta{display:flex;gap:22px;color:#8a8f8d;font-size:12px}.profile-meta strong{color:#4f5552;font-weight:600}.profile-links{display:flex;flex-wrap:wrap;gap:8px 16px;margin-top:12px}.profile-links a{display:inline-flex;align-items:center;gap:3px;color:#00a870;font-size:12px;text-decoration:none}.profile-links a:hover{text-decoration:underline}.profile-content{padding-top:32px}.content-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.content-heading h2{margin:0;color:#262626;font-size:20px;font-weight:650}.content-heading span{color:#a3a7a5;font-size:12px}.profile-content-list{border-top:1px solid #e7e9e8}.profile-content-row{display:grid;grid-template-columns:34px minmax(0,1fr) auto;align-items:start;gap:12px;padding:17px 4px;border-bottom:1px solid #f0f0f0;color:#262626;text-decoration:none}.profile-content-row:hover{background:#fafafa}.document-mark{display:grid;width:34px;height:34px;place-items:center;border-radius:6px;background:#f2f8f5;color:#00a870}.document-copy{display:flex;min-width:0;flex-direction:column}.document-copy strong{overflow:hidden;font-size:14px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}.profile-content-row:hover .document-copy strong{color:#00a870}.document-copy small{display:-webkit-box;margin-top:3px;overflow:hidden;color:#8a8f8d;font-size:12px;line-height:19px;-webkit-box-orient:vertical;-webkit-line-clamp:2}.document-copy em{margin-top:6px;color:#a3a7a5;font-size:11px;font-style:normal}.profile-content-row time{padding-top:3px;color:#a3a7a5;font-size:11px;white-space:nowrap}.profile-empty,.public-state{display:grid;min-height:300px;place-items:center;align-content:center;color:#8a8f8d;text-align:center}.profile-empty strong,.public-state h1{margin:12px 0 0;color:#4f5552;font-size:15px;font-weight:600}.profile-empty p,.public-state p{margin:6px 0 0;font-size:12px}.public-state{min-height:calc(100dvh - 136px)}.public-state h1{font-size:20px}.state-icon{display:grid;width:48px;height:48px;place-items:center;border-radius:50%;background:#f3f5f4;color:#8a8f8d}.state-action{height:34px!important;margin-top:20px;border-color:#d8dad9!important;border-radius:5px!important;letter-spacing:0;text-transform:none}
@media(max-width:640px){.profile-page{width:calc(100% - 32px);padding-bottom:56px}.profile-header{grid-template-columns:52px minmax(0,1fr);gap:14px;padding:36px 0 28px}.profile-avatar{width:52px!important;height:52px!important;font-size:20px}.profile-title-line{gap:12px}.profile-title-line h1{font-size:24px;line-height:32px}.profile-action{min-width:64px!important}.profile-content-row{grid-template-columns:32px minmax(0,1fr)}.profile-content-row time{display:none}.document-mark{width:32px;height:32px}}
</style>
