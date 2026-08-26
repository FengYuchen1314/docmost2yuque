<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Team } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { ownerTypeLabel, visibilityLabel } from '../../utils/displayLabels'
import { knowledgeBaseDestination } from '../../utils/knowledgeBaseDestination'

const route=useRoute();const router=useRouter();const session=useSessionStore();const ui=useUiStore();const id=computed(()=>String(route.params.workspaceId))
const teams=ref<Team[]>([]);const knowledgeBases=ref<KnowledgeBase[]>([]);const tab=ref('knowledge');const dialog=ref(false);const loading=ref(false);const error=ref('')
const form=reactive({name:'',slug:'',visibility:'WORKSPACE'})
const workspace=computed(()=>session.workspaces.find(item=>item.id===id.value));const canManage=computed(()=>['OWNER','ADMIN'].includes(workspace.value?.membershipRole??''))
onMounted(load);watch(id,load);watch(()=>form.name,value=>form.slug=value.toLowerCase().trim().replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-|-$/g,'').slice(0,80))
async function load(){loading.value=true;try{[teams.value,knowledgeBases.value]=await Promise.all([workspace.value?.workspaceType==='ORGANIZATION'?post('/api/v1/teams/list',{workspaceId:id.value}):Promise.resolve([]),post('/api/v1/knowledge-bases/list',{workspaceId:id.value})]);session.selectWorkspace(id.value)}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
async function createTeam(){loading.value=true;try{await post('/api/v1/teams/create',{workspaceId:id.value,name:form.name,slug:form.slug,description:'',avatar:null,visibility:form.visibility});dialog.value=false;form.name='';await load()}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
</script>
<template>
  <main class="workspace-page page-shell">
    <header class="workspace-head">
      <div class="workspace-identity">
        <span class="workspace-mark" aria-hidden="true">
          <v-icon size="22">{{ workspace?.workspaceType === 'PERSONAL' ? 'mdi-account-outline' : 'mdi-domain' }}</v-icon>
        </span>
        <div class="workspace-copy">
          <span class="workspace-type">{{ workspace?.workspaceType === 'PERSONAL' ? '个人空间' : '团队空间' }}</span>
          <h1>{{ workspace?.name || '工作区' }}</h1>
          <p>{{ workspace?.workspaceType === 'PERSONAL' ? '整理你的知识与内容' : '知识库、团队与成员协作' }}</p>
        </div>
      </div>
      <div class="workspace-actions">
        <v-btn v-if="canManage" :to="`/app/w/${id}/settings`" prepend-icon="mdi-cog-outline" variant="text" size="small">设置</v-btn>
        <v-btn color="primary" prepend-icon="mdi-plus" size="small" @click="ui.openCreate({kind:'KNOWLEDGE_BASE',workspaceId:id,source:'WORKSPACE'})">新建知识库</v-btn>
      </div>
    </header>

    <nav v-if="workspace?.workspaceType === 'ORGANIZATION'" class="workspace-tabs" aria-label="空间内容">
      <button :class="{active:tab==='knowledge'}" type="button" @click="tab='knowledge'">知识库 <span>{{ knowledgeBases.length }}</span></button>
      <button :class="{active:tab==='teams'}" type="button" @click="tab='teams'">团队 <span>{{ teams.length }}</span></button>
    </nav>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="workspace-alert" @click:close="error=''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" height="2" class="workspace-progress" />

    <section v-if="tab === 'knowledge'" class="workspace-section">
      <header class="section-heading">
        <div><h2>知识库</h2><p>{{ knowledgeBases.length ? `共 ${knowledgeBases.length} 个知识库` : '创建知识库来开始整理内容' }}</p></div>
        <v-btn variant="text" size="small" prepend-icon="mdi-plus" @click="ui.openCreate({kind:'KNOWLEDGE_BASE',workspaceId:id,source:'WORKSPACE'})">新建</v-btn>
      </header>
      <div class="resource-list">
        <router-link v-for="kb in knowledgeBases" :key="kb.id" :to="knowledgeBaseDestination(kb)" class="resource-row">
          <span class="resource-icon">{{ kb.icon || '📘' }}</span>
          <span class="resource-copy">
            <strong>{{ kb.name }}</strong>
            <small>{{ kb.description || `${visibilityLabel(kb.visibility)} · ${ownerTypeLabel(kb.ownerType)}` }}</small>
          </span>
          <span class="resource-meta">{{ visibilityLabel(kb.visibility) }}</span>
          <v-icon size="18" class="row-arrow">mdi-chevron-right</v-icon>
        </router-link>
        <button v-if="!knowledgeBases.length" class="empty-action" type="button" @click="ui.openCreate({kind:'KNOWLEDGE_BASE',workspaceId:id,source:'WORKSPACE'})">
          <v-icon size="20">mdi-plus</v-icon><span><strong>新建第一个知识库</strong><small>文档、表格和白板都从这里开始</small></span>
        </button>
      </div>
    </section>

    <section v-else class="workspace-section">
      <header class="section-heading">
        <div><h2>团队</h2><p>按项目或部门组织成员与知识库</p></div>
        <v-btn v-if="canManage" variant="text" size="small" prepend-icon="mdi-plus" @click="dialog=true">新建</v-btn>
      </header>
      <div class="resource-list">
        <button v-for="team in teams" :key="team.id" class="resource-row resource-button" type="button" @click="router.push(`/app/w/${id}/teams/${team.id}`)">
          <span class="resource-icon team-icon">{{ team.name.slice(0,1) }}</span>
          <span class="resource-copy"><strong>{{ team.name }}</strong><small>{{ team.description || visibilityLabel(team.visibility) }}</small></span>
          <span class="resource-meta">{{ visibilityLabel(team.visibility) }}</span>
          <v-icon size="18" class="row-arrow">mdi-chevron-right</v-icon>
        </button>
        <button v-if="!teams.length && canManage" class="empty-action" type="button" @click="dialog=true">
          <v-icon size="20">mdi-plus</v-icon><span><strong>新建第一个团队</strong><small>邀请成员并分配协作空间</small></span>
        </button>
        <div v-else-if="!teams.length" class="empty-note">当前空间还没有团队</div>
      </div>
    </section>

    <v-dialog v-model="dialog" max-width="440">
      <v-card class="team-create-dialog" rounded="lg">
        <v-card-title>新建团队</v-card-title>
        <v-card-subtitle>团队创建后可以继续添加成员和知识库。</v-card-subtitle>
        <v-card-text>
          <v-text-field v-model="form.name" label="团队名称" density="compact" autofocus class="mb-2" />
          <v-text-field v-model="form.slug" label="访问路径" prefix="/teams/" density="compact" class="mb-2" />
          <v-select v-model="form.visibility" label="可见范围" density="compact" :items="[{title:'空间内可见',value:'WORKSPACE'},{title:'仅团队成员',value:'PRIVATE'}]" />
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" @click="dialog=false">取消</v-btn><v-btn color="primary" size="small" :loading="loading" :disabled="!form.name||!form.slug" @click="createTeam">创建团队</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.workspace-page{max-width:980px;padding-top:28px}.workspace-head{display:flex;align-items:center;justify-content:space-between;gap:24px;padding:0 2px 22px;border-bottom:1px solid #e7e9ed}.workspace-identity{display:flex;align-items:center;min-width:0}.workspace-mark{display:grid;place-items:center;width:42px;height:42px;margin-right:13px;border:1px solid #e1e5ec;border-radius:10px;color:#2468f2;background:#f5f8ff}.workspace-copy{min-width:0}.workspace-type{display:block;margin-bottom:1px;color:#8a919f;font-size:11px;line-height:16px}.workspace-copy h1{overflow:hidden;margin:0;color:#262a30;font-size:21px;font-weight:650;line-height:27px;text-overflow:ellipsis;white-space:nowrap}.workspace-copy p{margin:2px 0 0;color:#8a919f;font-size:12px}.workspace-actions{display:flex;flex:none;align-items:center;gap:4px}.workspace-tabs{display:flex;height:45px;gap:24px;border-bottom:1px solid #eaecf0}.workspace-tabs button{position:relative;padding:0 2px;border:0;color:#646b76;background:none;font-size:14px;cursor:pointer}.workspace-tabs button span{margin-left:3px;color:#a3a9b2;font-size:11px}.workspace-tabs button.active{color:#262a30;font-weight:600}.workspace-tabs button.active::after{position:absolute;right:1px;bottom:-1px;left:1px;height:2px;border-radius:2px;background:#2468f2;content:""}.workspace-alert{margin-top:14px}.workspace-progress{margin-top:-2px}.workspace-section{margin-top:26px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 4px}.section-heading h2{margin:0;color:#30343b;font-size:16px;font-weight:650}.section-heading p{margin:3px 0 0;color:#959ba5;font-size:12px}.resource-list{overflow:hidden;border:1px solid #e6e8ec;border-radius:8px;background:#fff}.resource-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto 20px;align-items:center;width:100%;min-height:62px;padding:9px 14px;border:0;border-bottom:1px solid #eef0f3;color:inherit;background:#fff;text-align:left;text-decoration:none;transition:background .15s}.resource-row:last-child{border-bottom:0}.resource-row:hover{background:#fafbfc}.resource-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:7px;background:#f5f7fa;font-size:18px}.team-icon{color:#2468f2;background:#edf3ff;font-size:13px;font-weight:700}.resource-copy{display:flex;min-width:0;flex-direction:column}.resource-copy strong{overflow:hidden;color:#30343b;font-size:14px;font-weight:600;line-height:20px;text-overflow:ellipsis;white-space:nowrap}.resource-copy small{overflow:hidden;margin-top:2px;color:#8f96a1;font-size:12px;line-height:17px;text-overflow:ellipsis;white-space:nowrap}.resource-meta{margin-left:16px;color:#9aa0aa;font-size:12px}.row-arrow{margin-left:4px;color:#b5bac2}.resource-button{font:inherit;cursor:pointer}.empty-action{display:flex;align-items:center;width:100%;gap:12px;padding:18px;border:0;color:#2468f2;background:#fff;text-align:left;cursor:pointer}.empty-action:hover{background:#fafcff}.empty-action span{display:flex;flex-direction:column}.empty-action strong{font-size:13px}.empty-action small{margin-top:2px;color:#969ca6;font-size:12px}.empty-note{padding:26px;color:#9aa0aa;font-size:13px;text-align:center}.team-create-dialog :deep(.v-card-title){padding:20px 20px 4px;font-size:17px;font-weight:650}.team-create-dialog :deep(.v-card-subtitle){padding:0 20px 16px;color:#858c97;font-size:12px}.team-create-dialog :deep(.v-card-text){padding:4px 20px}.team-create-dialog :deep(.v-card-actions){padding:8px 16px 16px}@media(max-width:700px){.workspace-page{padding:20px 16px 40px}.workspace-head{align-items:flex-start;flex-direction:column;gap:14px}.workspace-actions{width:100%;justify-content:flex-end}.resource-meta{display:none}.resource-row{grid-template-columns:38px minmax(0,1fr) 20px}}
</style>
