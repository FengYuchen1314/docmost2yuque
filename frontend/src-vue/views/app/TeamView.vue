<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Team, WorkspaceMember } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { displayOptions, roleLabel, visibilityLabel } from '../../utils/displayLabels'

interface TeamMember extends WorkspaceMember { teamId:string; role:'MANAGER'|'MEMBER'; joinedAt:string }
interface AuditPage {items:Array<{id:string;action:string;actorEmail:string;createdAt:string}>;nextOffset:number;hasMore:boolean}
const route=useRoute();const router=useRouter();const session=useSessionStore();const workspaceId=String(route.params.workspaceId);const teamId=String(route.params.teamId)
const team=ref<Team|null>(null);const members=ref<TeamMember[]>([]);const workspaceMembers=ref<WorkspaceMember[]>([]);const kbs=ref<KnowledgeBase[]>([]);const activity=ref<AuditPage['items']>([]);const tab=ref('knowledge');const error=ref('');const loading=ref(false);const candidate=ref('');const leaveDialog=ref(false)
const form=reactive({name:'',slug:'',description:'',avatar:'',visibility:'WORKSPACE'})
const teamRoleOptions=displayOptions(['MANAGER','MEMBER'] as const,roleLabel);const teamVisibilityOptions=displayOptions(['WORKSPACE','PRIVATE'] as const,visibilityLabel)
const me=computed(()=>members.value.find(item=>item.userId===session.user?.userId));const canManage=computed(()=>me.value?.role==='MANAGER'||['OWNER','ADMIN'].includes(session.workspaces.find(item=>item.id===workspaceId)?.membershipRole??''));const availableMembers=computed(()=>workspaceMembers.value.filter(person=>!members.value.some(member=>member.userId===person.userId)))
onMounted(load)
async function load(){loading.value=true;try{const [teams,memberValues,kbValues,workspaceMemberValues]=await Promise.all([post<Team[]>('/api/v1/teams/list',{workspaceId}),post<TeamMember[]>('/api/v1/teams/members',{teamId}),post<KnowledgeBase[]>('/api/v1/knowledge-bases/list',{workspaceId}),post<WorkspaceMember[]>('/api/v1/workspaces/members',{workspaceId})]);team.value=teams.find(item=>item.id===teamId)??null;members.value=memberValues;kbs.value=kbValues.filter(item=>item.teamId===teamId||item.ownerId===teamId);workspaceMembers.value=workspaceMemberValues;if(team.value)Object.assign(form,{name:team.value.name,slug:team.value.slug,description:team.value.description??'',avatar:team.value.avatar??'',visibility:team.value.visibility})}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
async function addMember(){if(!candidate.value)return;await post('/api/v1/teams/members/add',{teamId,userId:candidate.value,role:'MEMBER'});candidate.value='';await load()}
async function updateMember(member:TeamMember,role:string){await post('/api/v1/teams/members/update',{teamId,userId:member.userId,role});await load()}
async function removeMember(member:TeamMember){if(!confirm(`移除 ${member.email}？`))return;await post('/api/v1/teams/members/remove',{teamId,userId:member.userId,role:member.role});await load()}
async function save(){team.value=await post('/api/v1/teams/update',{teamId,...form,avatar:form.avatar||null});await load()}
async function loadActivity(){activity.value=(await post<AuditPage>('/api/v1/teams/activity/page',{teamId,limit:50,offset:0})).items}
async function leave(){await post('/api/v1/teams/members/leave',{teamId});await router.replace(`/app/w/${workspaceId}`)}
function selectTab(value:string){tab.value=value;if(value==='activity')void loadActivity()}
</script>
<template>
  <main class="team-page page-shell">
    <header class="team-head">
      <button class="back-link" type="button" aria-label="返回空间" @click="router.push(`/app/w/${workspaceId}`)"><v-icon size="19">mdi-arrow-left</v-icon></button>
      <span class="team-avatar">{{ team?.name.slice(0,1) || '团' }}</span>
      <div class="team-copy"><span>团队</span><h1>{{ team?.name || '团队' }}</h1><p>{{ team?.description || '团队知识和成员协作' }}</p></div>
    </header>

    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="team-alert" @click:close="error=''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" height="2" />

    <nav class="team-tabs" aria-label="团队内容">
      <button :class="{active:tab==='knowledge'}" type="button" @click="selectTab('knowledge')">知识库 <span>{{ kbs.length }}</span></button>
      <button :class="{active:tab==='members'}" type="button" @click="selectTab('members')">成员 <span>{{ members.length }}</span></button>
      <button :class="{active:tab==='activity'}" type="button" @click="selectTab('activity')">动态</button>
      <button v-if="canManage" :class="{active:tab==='settings'}" type="button" @click="selectTab('settings')">设置</button>
    </nav>

    <section v-if="tab === 'knowledge'" class="team-section">
      <header class="section-heading"><div><h2>团队知识库</h2><p>团队成员共同维护的内容</p></div></header>
      <div class="resource-list">
        <button v-for="kb in kbs" :key="kb.id" class="resource-row" type="button" @click="router.push(`/app/kb/${kb.id}`)">
          <span class="resource-icon">{{ kb.icon || '📘' }}</span>
          <span class="resource-copy"><strong>{{ kb.name }}</strong><small>{{ kb.description || '团队知识库' }}</small></span>
          <span class="resource-meta">{{ visibilityLabel(kb.visibility) }}</span><v-icon size="18">mdi-chevron-right</v-icon>
        </button>
        <div v-if="!kbs.length" class="empty-note"><v-icon size="22">mdi-book-open-blank-variant-outline</v-icon><strong>还没有团队知识库</strong><span>可在知识库设置中将其归属到当前团队</span></div>
      </div>
    </section>

    <section v-else-if="tab === 'members'" class="team-section">
      <header class="section-heading"><div><h2>团队成员</h2><p>成员可访问团队内的知识库和内容</p></div></header>
      <div class="plain-panel member-panel">
        <div v-if="canManage" class="member-add">
          <v-select v-model="candidate" :items="availableMembers" item-title="email" item-value="userId" label="选择空间成员" density="compact" hide-details no-data-text="没有可添加的成员" />
          <v-btn color="primary" size="small" :disabled="!candidate" @click="addMember">添加成员</v-btn>
        </div>
        <div class="member-list">
          <div v-for="member in members" :key="member.userId" class="member-row">
            <span class="member-avatar">{{ (member.displayName || member.email).slice(0,1).toUpperCase() }}</span>
            <span class="member-copy"><strong>{{ member.displayName || member.email }}</strong><small>{{ member.email }}</small></span>
            <v-select v-if="canManage" :model-value="member.role" :items="teamRoleOptions" density="compact" hide-details class="role-select" @update:model-value="updateMember(member,$event)" />
            <span v-else class="role-label">{{ roleLabel(member.role) }}</span>
            <v-btn v-if="canManage" icon="mdi-close" size="x-small" variant="text" color="grey-darken-1" aria-label="移除成员" @click="removeMember(member)" />
          </div>
          <div v-if="!members.length" class="empty-line">团队还没有成员</div>
        </div>
      </div>
    </section>

    <section v-else-if="tab === 'activity'" class="team-section">
      <header class="section-heading"><div><h2>团队动态</h2><p>最近的成员与内容变更</p></div><v-btn variant="text" size="small" prepend-icon="mdi-refresh" @click="loadActivity">刷新</v-btn></header>
      <div class="plain-panel activity-list">
        <div v-for="event in activity" :key="event.id" class="activity-row"><span class="activity-dot" /><span><strong>{{ event.action }}</strong><small>{{ event.actorEmail }} · {{ new Date(event.createdAt).toLocaleString('zh-CN') }}</small></span></div>
        <div v-if="!activity.length" class="empty-line">暂无团队动态</div>
      </div>
    </section>

    <section v-else class="team-section settings-section">
      <header class="section-heading"><div><h2>团队设置</h2><p>修改团队名称、路径和可见范围</p></div></header>
      <div class="settings-form">
        <div class="form-grid"><v-text-field v-model="form.name" label="团队名称" density="compact" /><v-text-field v-model="form.slug" label="访问路径" density="compact" prefix="/teams/" /></div>
        <v-textarea v-model="form.description" label="团队介绍" density="compact" rows="3" auto-grow />
        <v-select v-model="form.visibility" :items="teamVisibilityOptions" label="可见范围" density="compact" />
        <div class="form-actions"><v-btn color="primary" size="small" :loading="loading" @click="save">保存设置</v-btn></div>
      </div>
    </section>

    <footer class="team-danger"><div><strong>退出团队</strong><span>退出后将失去团队内私密内容的访问权限。</span></div><v-btn color="error" variant="text" size="small" @click="leaveDialog=true">退出</v-btn></footer>

    <v-dialog v-model="leaveDialog" max-width="400">
      <v-card class="leave-dialog" rounded="lg"><v-card-title>退出当前团队？</v-card-title><v-card-text>退出后，你将无法继续访问仅团队成员可见的内容。</v-card-text><v-card-actions><v-spacer /><v-btn size="small" @click="leaveDialog=false">取消</v-btn><v-btn color="error" size="small" @click="leave">确认退出</v-btn></v-card-actions></v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.team-page{max-width:980px;padding-top:26px}.team-head{display:flex;align-items:center;min-height:52px;padding-bottom:20px;border-bottom:1px solid #e7e9ed}.back-link{display:grid;flex:none;place-items:center;width:30px;height:30px;margin-right:10px;border:0;border-radius:6px;color:#626975;background:transparent;cursor:pointer}.back-link:hover{background:#f3f4f6}.team-avatar{display:grid;flex:none;place-items:center;width:40px;height:40px;margin-right:12px;border-radius:9px;color:#2468f2;background:#edf3ff;font-size:15px;font-weight:700}.team-copy{min-width:0}.team-copy>span{display:block;color:#9299a4;font-size:11px;line-height:14px}.team-copy h1{overflow:hidden;margin:0;color:#292d33;font-size:20px;font-weight:650;line-height:26px;text-overflow:ellipsis;white-space:nowrap}.team-copy p{margin:1px 0 0;color:#8c939e;font-size:12px}.team-alert{margin-top:14px}.team-tabs{display:flex;height:45px;gap:25px;border-bottom:1px solid #eaecf0}.team-tabs button{position:relative;padding:0 2px;border:0;color:#656c76;background:none;font-size:14px;cursor:pointer}.team-tabs button span{margin-left:2px;color:#a4a9b1;font-size:11px}.team-tabs button.active{color:#25292f;font-weight:600}.team-tabs button.active::after{position:absolute;right:1px;bottom:-1px;left:1px;height:2px;border-radius:2px;background:#2468f2;content:""}.team-section{margin-top:25px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;padding:0 4px}.section-heading h2{margin:0;color:#30343b;font-size:16px;font-weight:650}.section-heading p{margin:3px 0 0;color:#959ba5;font-size:12px}.resource-list,.plain-panel{overflow:hidden;border:1px solid #e6e8ec;border-radius:8px;background:#fff}.resource-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto 20px;align-items:center;width:100%;min-height:62px;padding:9px 14px;border:0;border-bottom:1px solid #eef0f3;background:#fff;text-align:left;cursor:pointer}.resource-row:last-child{border-bottom:0}.resource-row:hover{background:#fafbfc}.resource-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:7px;background:#f5f7fa;font-size:18px}.resource-copy{display:flex;min-width:0;flex-direction:column}.resource-copy strong{overflow:hidden;color:#30343b;font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.resource-copy small,.activity-row small{overflow:hidden;margin-top:2px;color:#9299a3;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.resource-meta{margin-right:8px;color:#9aa0aa;font-size:12px}.empty-note{display:flex;align-items:center;justify-content:center;min-height:150px;flex-direction:column;color:#9299a4}.empty-note strong{margin-top:8px;color:#555c67;font-size:14px}.empty-note span{margin-top:4px;font-size:12px}.member-add{display:grid;grid-template-columns:minmax(220px,430px) auto;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid #eceef1}.member-list{padding:0}.member-row{display:grid;grid-template-columns:34px minmax(0,1fr) 126px 30px;align-items:center;min-height:58px;padding:7px 12px;border-bottom:1px solid #eef0f3}.member-row:last-child{border-bottom:0}.member-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#5c6778;background:#eef1f5;font-size:12px;font-weight:600}.member-copy{display:flex;min-width:0;flex-direction:column}.member-copy strong{overflow:hidden;color:#34383e;font-size:13px;font-weight:550;text-overflow:ellipsis;white-space:nowrap}.member-copy small{overflow:hidden;color:#949aa4;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.role-select{width:126px}.role-label{color:#707782;font-size:12px}.empty-line{padding:28px;color:#999fa8;font-size:13px;text-align:center}.activity-row{display:flex;align-items:center;min-height:56px;gap:12px;padding:9px 16px;border-bottom:1px solid #eef0f3}.activity-row:last-child{border-bottom:0}.activity-dot{width:7px;height:7px;border:2px solid #85a9f7;border-radius:50%}.activity-row>span:last-child{display:flex;min-width:0;flex-direction:column}.activity-row strong{color:#41464e;font-size:13px;font-weight:550}.settings-section{max-width:720px}.settings-form{padding:20px 2px}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.form-actions{display:flex;justify-content:flex-end}.team-danger{display:flex;align-items:center;justify-content:space-between;margin-top:44px;padding:18px 4px 0;border-top:1px solid #eceef1}.team-danger>div{display:flex;flex-direction:column}.team-danger strong{color:#525861;font-size:13px;font-weight:600}.team-danger span{margin-top:2px;color:#999fa9;font-size:11px}.leave-dialog :deep(.v-card-title){padding:20px 20px 8px;font-size:17px;font-weight:650}.leave-dialog :deep(.v-card-text){padding:0 20px 18px;color:#747b86;font-size:13px}.leave-dialog :deep(.v-card-actions){padding:8px 14px 14px}@media(max-width:700px){.team-page{padding:18px 16px 38px}.team-tabs{overflow-x:auto}.member-add{grid-template-columns:1fr}.member-row{grid-template-columns:34px minmax(0,1fr) 110px 28px}.form-grid{grid-template-columns:1fr}.resource-meta{display:none}.resource-row{grid-template-columns:38px minmax(0,1fr) 20px}.team-danger{align-items:flex-start;gap:12px}.team-danger span{max-width:240px}}
</style>
