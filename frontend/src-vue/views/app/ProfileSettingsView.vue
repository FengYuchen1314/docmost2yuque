<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { Garden, KnowledgeBase, PublicProfile } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { displayOptions, themeLabel } from '../../utils/displayLabels'
const session=useSessionStore();const ui=useUiStore();const profile=ref<PublicProfile|null>(null);const gardens=ref<Garden[]>([]);const publicKbs=ref<KnowledgeBase[]>([]);const loading=ref(false);const error=ref('');const tab=ref('profile');const dialog=ref(false)
const form=reactive({slug:'',displayName:'',bio:'',avatarUrl:'',coverUrl:'',theme:'MINIMAL',navigation:[] as Array<{label:string;url:string}>,seoTitle:'',seoDescription:'',discoverable:true,rssEnabled:true})
const garden=reactive({id:'',slug:'',title:'',description:'',icon:'🌿',coverUrl:'',theme:'MINIMAL',navigation:[] as Array<{label:string;url:string}>,seoTitle:'',seoDescription:'',discoverable:true,rssEnabled:true,knowledgeBaseIds:[] as string[]})
const themeOptions=displayOptions(['PAPER','MINIMAL','MAGAZINE','DARK'] as const,themeLabel)
onMounted(load)
async function load(){loading.value=true;try{[profile.value,gardens.value]=await Promise.all([post('/api/v1/social/profile/me',{}),post('/api/v1/social/gardens/mine',{})]);publicKbs.value=session.knowledgeBases.filter(kb=>kb.visibility==='PUBLIC');if(profile.value)Object.assign(form,{...profile.value,bio:profile.value.bio??'',avatarUrl:profile.value.avatarUrl??'',coverUrl:profile.value.coverUrl??'',seoTitle:profile.value.seoTitle??'',seoDescription:profile.value.seoDescription??''})}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
async function saveProfile(){loading.value=true;try{profile.value=await post('/api/v1/social/profile/save',{...form,bio:form.bio||null,avatarUrl:form.avatarUrl||null,coverUrl:form.coverUrl||null,seoTitle:form.seoTitle||null,seoDescription:form.seoDescription||null});ui.notify('公开主页已保存')}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
function editGarden(value?:Garden){Object.assign(garden,{id:value?.id??'',slug:value?.slug??'',title:value?.title??'',description:value?.description??'',icon:value?.icon??'🌿',coverUrl:value?.coverUrl??'',theme:value?.theme??'MINIMAL',navigation:value?.navigation??[],seoTitle:value?.seoTitle??'',seoDescription:value?.seoDescription??'',discoverable:value?.discoverable??true,rssEnabled:value?.rssEnabled??true,knowledgeBaseIds:value?.knowledgeBases.map(kb=>kb.id)??[]});dialog.value=true}
async function saveGarden(){await post(garden.id?'/api/v1/social/gardens/update':'/api/v1/social/gardens/create',{...garden,gardenId:garden.id||undefined,description:garden.description||null,coverUrl:garden.coverUrl||null,seoTitle:garden.seoTitle||null,seoDescription:garden.seoDescription||null});dialog.value=false;await load()}
async function removeGarden(value:Garden){if(confirm(`删除花园「${value.title}」？`)){await post('/api/v1/social/gardens/delete',{gardenId:value.id});await load()}}
</script>
<template>
  <div class="page-shell profile-settings-page">
    <header class="page-heading">
      <div><h1>公开主页</h1><p>设置公开身份，并用知识花园聚合公开知识库。</p></div>
      <v-btn v-if="profile" :to="`/u/${profile.slug}`" target="_blank" prepend-icon="mdi-open-in-new" variant="outlined">查看主页</v-btn>
    </header>

    <div class="settings-tabs"><v-tabs v-model="tab" color="#00b96b"><v-tab value="profile">主页资料</v-tab><v-tab value="gardens">知识花园</v-tab></v-tabs></div>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" class="settings-alert">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="#00b96b" height="2" />

    <section v-if="tab === 'profile'" class="settings-panel">
      <header class="panel-heading"><h2>基本资料</h2><p>这些信息会显示在你的公开主页。</p></header>
      <div class="settings-form-grid">
        <v-text-field v-model="form.displayName" label="显示名称" variant="outlined" density="compact" />
        <v-text-field v-model="form.slug" label="主页路径" prefix="/u/" variant="outlined" density="compact" />
        <v-select v-model="form.theme" label="主题" :items="themeOptions" variant="outlined" density="compact" />
        <v-text-field v-model="form.avatarUrl" label="头像 URL" variant="outlined" density="compact" />
        <v-text-field v-model="form.coverUrl" label="封面 URL" variant="outlined" density="compact" />
        <v-textarea v-model="form.bio" label="个人简介" rows="3" variant="outlined" density="compact" class="full-field" />
      </div>

      <div class="setting-switches">
        <div class="setting-row"><div><strong>允许被发现</strong><p>允许其他人在发现页和搜索中找到你的主页。</p></div><v-switch v-model="form.discoverable" color="#00b96b" hide-details /></div>
        <div class="setting-row"><div><strong>启用 RSS</strong><p>为公开发布的内容生成 RSS 订阅。</p></div><v-switch v-model="form.rssEnabled" color="#00b96b" hide-details /></div>
      </div>

      <header class="panel-heading sub-heading"><h2>搜索展示</h2><p>留空时使用主页名称与个人简介。</p></header>
      <div class="settings-form-grid">
        <v-text-field v-model="form.seoTitle" label="SEO 标题" variant="outlined" density="compact" />
        <v-textarea v-model="form.seoDescription" label="SEO 描述" rows="3" variant="outlined" density="compact" class="full-field" />
      </div>
      <div class="panel-actions"><v-btn class="primary-action" :loading="loading" @click="saveProfile">保存主页</v-btn></div>
    </section>

    <section v-else class="settings-panel gardens-panel">
      <header class="panel-heading garden-panel-heading"><div><h2>知识花园</h2><p>把多个公开知识库整理成一个主题入口。</p></div><v-btn class="primary-action" prepend-icon="mdi-plus" @click="editGarden()">创建花园</v-btn></header>
      <div v-if="gardens.length" class="garden-settings-list">
        <div v-for="value in gardens" :key="value.id" class="garden-settings-row">
          <span class="garden-mark">{{ value.icon || '🌿' }}</span>
          <div><strong>{{ value.title }}</strong><small>/{{ value.slug }} · {{ value.knowledgeBases.length }} 个知识库</small></div>
          <v-btn size="small" variant="text" prepend-icon="mdi-pencil-outline" @click="editGarden(value)">编辑</v-btn>
          <v-btn size="small" variant="text" color="error" prepend-icon="mdi-delete-outline" @click="removeGarden(value)">删除</v-btn>
        </div>
      </div>
      <div v-else-if="!loading" class="garden-empty"><v-icon size="30">mdi-flower-outline</v-icon><strong>还没有知识花园</strong><p>创建花园后，可以将公开知识库聚合展示。</p></div>
    </section>

    <v-dialog v-model="dialog" max-width="660"><v-card class="garden-dialog"><v-card-title>{{ garden.id ? '编辑花园' : '创建花园' }}</v-card-title><v-card-text>
      <div class="dialog-grid"><v-text-field v-model="garden.title" label="名称" variant="outlined" density="compact" /><v-text-field v-model="garden.slug" label="路径" prefix="/garden/" variant="outlined" density="compact" /><v-text-field v-model="garden.icon" label="图标" variant="outlined" density="compact" /><v-select v-model="garden.theme" :items="themeOptions" label="主题" variant="outlined" density="compact" /><v-textarea v-model="garden.description" label="介绍" rows="3" variant="outlined" density="compact" class="full-field" /><v-text-field v-model="garden.coverUrl" label="封面 URL" variant="outlined" density="compact" class="full-field" /><v-select v-model="garden.knowledgeBaseIds" :items="publicKbs" item-title="name" item-value="id" label="公开知识库" multiple chips variant="outlined" density="compact" class="full-field" /></div>
      <div class="setting-switches dialog-switches"><div class="setting-row"><div><strong>允许被发现</strong><p>允许花园出现在发现页。</p></div><v-switch v-model="garden.discoverable" color="#00b96b" hide-details /></div><div class="setting-row"><div><strong>启用 RSS</strong><p>生成花园内容订阅。</p></div><v-switch v-model="garden.rssEnabled" color="#00b96b" hide-details /></div></div>
    </v-card-text><v-card-actions><v-spacer /><v-btn variant="text" @click="dialog = false">取消</v-btn><v-btn class="primary-action" :disabled="!garden.title || !garden.slug" @click="saveGarden">保存</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.profile-settings-page{max-width:960px;padding-top:32px}.profile-settings-page :deep(.page-heading){margin-bottom:18px}.profile-settings-page :deep(.page-heading h1){font-size:26px}.profile-settings-page :deep(.page-heading>.v-btn){height:34px;border-color:#d8dad9;border-radius:5px;letter-spacing:0;text-transform:none}.settings-tabs{height:44px;border-bottom:1px solid #e7e9e8}.settings-tabs :deep(.v-tab){height:44px;min-width:auto;margin-right:28px;padding:0;color:#646a67;font-size:13px;letter-spacing:0;text-transform:none}.settings-alert{margin:18px 0 0;border-radius:6px}.settings-panel{padding:28px 0 40px}.panel-heading{margin-bottom:16px}.panel-heading h2{margin:0;color:#262626;font-size:17px;font-weight:650}.panel-heading p{margin:3px 0 0;color:#8a8f8d;font-size:12px}.sub-heading{margin-top:30px;padding-top:25px;border-top:1px solid #e7e9e8}.settings-form-grid,.dialog-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.settings-form-grid :deep(.v-field),.dialog-grid :deep(.v-field){min-height:40px;border-radius:6px}.settings-form-grid :deep(.v-field__input),.dialog-grid :deep(.v-field__input){font-size:13px}.full-field{grid-column:1/-1}.setting-switches{margin-top:18px;border-top:1px solid #f0f0f0}.setting-row{display:flex;min-height:64px;align-items:center;justify-content:space-between;gap:24px;border-bottom:1px solid #f0f0f0}.setting-row strong{color:#4f5552;font-size:13px;font-weight:600}.setting-row p{margin:3px 0 0;color:#8a8f8d;font-size:11px}.panel-actions{display:flex;justify-content:flex-end;margin-top:20px}.primary-action{height:34px!important;border-radius:5px!important;background:#00b96b!important;color:#fff!important;font-size:13px;letter-spacing:0;text-transform:none}.garden-panel-heading{display:flex;align-items:center;justify-content:space-between}.garden-settings-list{border-top:1px solid #e7e9e8}.garden-settings-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:14px 4px;border-bottom:1px solid #f0f0f0}.garden-mark{display:grid;width:40px;height:40px;place-items:center;border-radius:7px;background:#f5f6f5;font-size:20px}.garden-settings-row>div{display:flex;min-width:0;flex-direction:column}.garden-settings-row strong{overflow:hidden;color:#4f5552;font-size:13px;text-overflow:ellipsis;white-space:nowrap}.garden-settings-row small{margin-top:3px;color:#8a8f8d;font-size:11px}.garden-settings-row :deep(.v-btn){height:30px;border-radius:5px;font-size:12px;letter-spacing:0;text-transform:none}.garden-empty{display:grid;min-height:260px;place-items:center;align-content:center;color:#8a8f8d;text-align:center}.garden-empty strong{margin-top:10px;color:#4f5552;font-size:13px}.garden-empty p{margin:5px 0 0;font-size:11px}.garden-dialog{border-radius:8px!important}.garden-dialog :deep(.v-card-title){padding:20px 22px 12px;font-size:17px;font-weight:650}.garden-dialog :deep(.v-card-text){padding:8px 22px 4px}.garden-dialog :deep(.v-card-actions){padding:14px 22px 20px}.dialog-switches{margin-top:5px}
@media(max-width:700px){.profile-settings-page{padding-top:24px}.settings-form-grid,.dialog-grid{grid-template-columns:1fr}.full-field{grid-column:auto}.garden-panel-heading{align-items:flex-start;gap:16px}.garden-settings-row{grid-template-columns:36px minmax(0,1fr) auto}.garden-settings-row>.v-btn:last-child{grid-column:2/4;justify-self:end}.garden-mark{width:36px;height:36px}.setting-row{align-items:flex-start;padding:10px 0}}
</style>
