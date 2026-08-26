<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import type { CurrentUser, OAuthAuthorizationInfo } from '../../../src/types'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { get, messageOf } from '../../services/api'
const route=useRoute();const info=ref<OAuthAuthorizationInfo|null>(null);const me=ref<CurrentUser|null>(null);const csrf=ref<{parameterName:string;token:string}|null>(null);const loading=ref(true);const error=ref('')
const query=computed(()=>new URLSearchParams(Object.entries(route.query).flatMap(([key,value])=>typeof value==='string'?[[key,value]]:[])).toString())
const redirectHost=computed(()=>{try{return info.value?new URL(info.value.redirectUri).host:''}catch{return''}})
onMounted(async()=>{try{[info.value,me.value]=await Promise.all([get(`/oauth/authorize?${query.value}`),get('/api/v1/auth/me')]);csrf.value=await get('/api/v1/auth/csrf')}catch(value){error.value=messageOf(value)}finally{loading.value=false}})
function deny(){if(!info.value)return;const target=new URL(info.value.redirectUri);target.searchParams.set('error','access_denied');if(route.query.state)target.searchParams.set('state',String(route.query.state));location.assign(target.toString())}
const fields=['client_id','redirect_uri','scope','state','code_challenge','code_challenge_method']
function scopeDescription(scope:string){return ({openid:'确认你的登录身份',profile:'读取你的昵称和基础资料',email:'读取你的邮箱地址','knowledge:read':'读取你有权限访问的知识内容','knowledge:write':'创建或修改你有权限编辑的知识内容','offline_access':'在你离开后继续访问已授权的数据'} as Record<string,string>)[scope]??'按此权限范围访问你的数据'}
</script>
<template>
  <PublicLayout>
    <main class="consent-page">
      <div v-if="loading" class="consent-loading"><v-progress-circular indeterminate color="primary" size="26" width="2" /><span>正在验证授权请求…</span></div>

      <section v-else-if="!me" class="consent-card compact-state">
        <span class="state-icon"><v-icon size="24">mdi-shield-account-outline</v-icon></span>
        <h1>登录后继续授权</h1>
        <p>{{ error || '完成登录后会自动返回当前授权请求。' }}</p>
        <v-btn :to="`/login?returnTo=${encodeURIComponent($route.fullPath)}`" color="primary" size="small" block>登录并继续</v-btn>
      </section>

      <section v-else-if="info&&csrf" class="consent-card">
        <header class="consent-head">
          <span class="app-icon"><v-icon size="25">mdi-application-brackets-outline</v-icon></span>
          <span class="oauth-label">第三方应用授权</span>
          <h1>{{ info.name }} 请求访问</h1>
          <p>你正在使用 <strong>{{ me.email }}</strong> 授权</p>
        </header>

        <div class="permission-intro">允许后，此应用可以：</div>
        <div class="scope-list">
          <div v-for="scope in info.scopes" :key="scope" class="scope-row">
            <span><v-icon size="17">mdi-check</v-icon></span>
            <div><strong>{{ scope }}</strong><small>{{ scopeDescription(scope) }}</small></div>
          </div>
        </div>

        <div class="trust-note">
          <v-icon size="17">mdi-lock-outline</v-icon>
          <span>授权结果仅返回给 <strong>{{ redirectHost }}</strong>。应用仍受你的现有资源权限约束，你可随时撤销授权。</span>
        </div>

        <form method="post" action="/oauth/authorize">
          <input v-for="field in fields" :key="field" type="hidden" :name="field" :value="String($route.query[field]||'')" />
          <input type="hidden" name="consent" value="true" />
          <input type="hidden" :name="csrf.parameterName" :value="csrf.token" />
          <div class="consent-actions"><v-btn block variant="outlined" size="small" type="button" @click="deny">拒绝</v-btn><v-btn block color="primary" size="small" type="submit">允许访问</v-btn></div>
        </form>
        <footer>此授权请求使用 PKCE S256，并校验精确回调地址。</footer>
      </section>

      <section v-else class="consent-card compact-state error-state">
        <span class="state-icon"><v-icon size="24">mdi-alert-circle-outline</v-icon></span>
        <h1>无法完成授权</h1>
        <p>{{ error || '授权请求无效或已经过期。' }}</p>
        <v-btn to="/app" variant="outlined" size="small" block>返回工作台</v-btn>
      </section>
    </main>
  </PublicLayout>
</template>

<style scoped>
.consent-page{display:grid;min-height:calc(100vh - 64px);place-items:center;padding:36px 20px;background:#f7f8fa}.consent-loading{display:flex;align-items:center;gap:10px;color:#7c838e;font-size:12px}.consent-card{width:min(448px,100%);padding:26px 28px 20px;border:1px solid #e2e5ea;border-radius:10px;background:#fff;box-shadow:0 8px 28px rgba(25,35,50,.07)}.consent-head{text-align:center}.app-icon,.state-icon{display:grid;place-items:center;width:46px;height:46px;margin:0 auto 11px;border-radius:11px;color:#2468f2;background:#edf3ff}.oauth-label{display:block;color:#8f96a1;font-size:10px;letter-spacing:.04em}.consent-card h1{margin:5px 0 4px;color:#272b31;font-size:20px;font-weight:650;line-height:28px;letter-spacing:-.015em}.consent-head p,.compact-state p{margin:0;color:#858c97;font-size:12px}.consent-head p strong{color:#555c66;font-weight:550}.permission-intro{margin:22px 0 8px;color:#5c636d;font-size:12px;font-weight:550}.scope-list{overflow:hidden;border:1px solid #e7e9ed;border-radius:7px}.scope-row{display:grid;grid-template-columns:26px minmax(0,1fr);align-items:center;min-height:52px;padding:7px 11px;border-bottom:1px solid #eef0f3}.scope-row:last-child{border-bottom:0}.scope-row>span{display:grid;place-items:center;width:20px;height:20px;border-radius:50%;color:#337b5b;background:#eaf7f0}.scope-row>div{display:flex;min-width:0;flex-direction:column}.scope-row strong{overflow:hidden;color:#3f444b;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:11px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.scope-row small{margin-top:2px;color:#9198a2;font-size:11px}.trust-note{display:flex;align-items:flex-start;gap:8px;margin:14px 0;padding:10px 11px;border-radius:7px;color:#6f7782;background:#f6f8fb;font-size:10px;line-height:16px}.trust-note .v-icon{flex:none;margin-top:1px;color:#6c86b5}.trust-note strong{color:#525b68;font-weight:600}.consent-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:16px}.consent-card>footer{margin-top:13px;color:#a0a6af;font-size:9px;text-align:center}.compact-state{padding-top:30px;text-align:center}.compact-state p{margin:6px 0 20px;line-height:18px}.error-state .state-icon{color:#bd4a4a;background:#fff0f0}@media(max-width:520px){.consent-page{align-items:start;padding:24px 12px}.consent-card{padding:23px 20px 18px;border-radius:9px;box-shadow:none}}
</style>
