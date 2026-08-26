<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Page, Team, WorkspaceMember } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { displayOptions, publishModeLabel, resourceTypeLabel, roleLabel, visibilityLabel } from '../../utils/displayLabels'

interface Group {id:string;workspaceId:string;name:string;description:string|null;memberCount?:number}
interface Audit {id:string;action:string;resourceType:string;resourceId:string;actorEmail:string;createdAt:string;payload?:unknown}
interface AuditPage {items:Audit[];nextOffset:number;hasMore:boolean}
const route=useRoute();const router=useRouter();const session=useSessionStore();const ui=useUiStore();const id=String(route.params.workspaceId)
const workspace=computed(()=>session.workspaces.find(item=>item.id===id));const tab=ref(String(route.query.tab??'general'));const loading=ref(false);const error=ref('');const members=ref<WorkspaceMember[]>([]);const groups=ref<Group[]>([]);const teams=ref<Team[]>([]);const trash=ref<Page[]>([]);const audit=ref<Audit[]>([])
const form=reactive({name:'',defaultVisibility:'PRIVATE',defaultPublishMode:'MANUAL'});const dialog=ref<'group'|'team'|'transfer'|'delete'|null>(null);const draft=reactive({name:'',slug:'',description:'',visibility:'WORKSPACE',targetUserId:'',confirmation:''})
const visibilityOptions=displayOptions(['PRIVATE','WORKSPACE','PUBLIC'] as const,visibilityLabel);const publishModeOptions=displayOptions(['MANUAL','AUTO'] as const,publishModeLabel);const workspaceRoleOptions=displayOptions(['ADMIN','MEMBER','EXTERNAL'] as const,roleLabel)
const organization=computed(()=>workspace.value?.workspaceType==='ORGANIZATION');const canManage=computed(()=>['OWNER','ADMIN'].includes(workspace.value?.membershipRole??''));const isOwner=computed(()=>workspace.value?.membershipRole==='OWNER')
onMounted(async()=>{if(!tabAllowed(tab.value))tab.value='general';if(workspace.value)Object.assign(form,{name:workspace.value.name,defaultVisibility:workspace.value.defaultVisibility,defaultPublishMode:workspace.value.defaultPublishMode});await loadTab()})
async function loadTab(){loading.value=true;error.value='';try{if(tab.value==='members')members.value=await post('/api/v1/workspaces/members',{workspaceId:id});if(tab.value==='groups')groups.value=await post('/api/v1/user-groups/list',{workspaceId:id});if(tab.value==='teams')teams.value=await post('/api/v1/teams/list',{workspaceId:id});if(tab.value==='trash')trash.value=await post('/api/v1/pages/trash/list',{workspaceId:id});if(tab.value==='audit')audit.value=(await post<AuditPage>('/api/v1/audit/page',{workspaceId:id,limit:50,offset:0})).items}catch(value){error.value=messageOf(value)}finally{loading.value=false}}
async function saveGeneral(){await post('/api/v1/workspaces/update',{workspaceId:id,...form});await session.loadNavigation();ui.notify('工作区设置已保存')}
async function memberRole(member:WorkspaceMember,role:string){members.value=await post('/api/v1/workspaces/members/update',{workspaceId:id,userId:member.userId,role})}
async function removeMember(member:WorkspaceMember){if(!confirm(`移除 ${member.email}？`))return;await post('/api/v1/workspaces/members/remove',{workspaceId:id,userId:member.userId,role:null});await loadTab()}
async function createGroup(){await post('/api/v1/user-groups/create',{workspaceId:id,name:draft.name,description:draft.description||null});dialog.value=null;resetDraft();await loadTab()}
async function deleteGroup(group:Group){if(confirm(`删除用户组「${group.name}」？`)){await post('/api/v1/user-groups/delete',{groupId:group.id});await loadTab()}}
async function createTeam(){await post('/api/v1/teams/create',{workspaceId:id,name:draft.name,slug:draft.slug,description:draft.description,avatar:null,visibility:draft.visibility});dialog.value=null;resetDraft();await loadTab()}
async function deleteTeam(team:Team){if(confirm(`删除团队「${team.name}」？`)){await post('/api/v1/teams/delete',{teamId:team.id});await loadTab()}}
async function restorePage(page:Page){await post('/api/v1/pages/restore',{pageId:page.id});await loadTab()}
async function transfer(){await post('/api/v1/workspaces/ownership/transfer',{workspaceId:id,targetUserId:draft.targetUserId,confirmationName:draft.confirmation});dialog.value=null;await session.loadNavigation();ui.notify('所有权已转移')}
async function removeWorkspace(){await post('/api/v1/workspaces/delete',{workspaceId:id,confirmationName:draft.confirmation});await session.loadNavigation();await router.replace('/app')}
function resetDraft(){Object.assign(draft,{name:'',slug:'',description:'',visibility:'WORKSPACE',targetUserId:'',confirmation:''})}
async function selectTab(value:string){tab.value=value;await router.replace({query:{...route.query,tab:value}});await loadTab()}
function tabAllowed(value:string){return ['general','trash','audit'].includes(value)||(organization.value&&['members','groups','teams'].includes(value))||(organization.value&&isOwner.value&&value==='advanced')}
async function openDialog(kind:'group'|'team'|'transfer'|'delete'){
  resetDraft();dialog.value=kind
  if(kind==='transfer'&&!members.value.length){loading.value=true;try{members.value=await post('/api/v1/workspaces/members',{workspaceId:id})}catch(value){error.value=messageOf(value);dialog.value=null}finally{loading.value=false}}
}
function closeDialog(){dialog.value=null;resetDraft()}
</script>
<template>
  <main class="settings-page page-shell">
    <header class="settings-head">
      <v-btn :to="`/app/w/${id}`" icon="mdi-arrow-left" variant="text" size="small" aria-label="返回空间" />
      <div><span>{{ organization ? '团队空间' : '个人空间' }}</span><h1>{{ workspace?.name || '空间' }} · 设置</h1><p>管理空间信息、协作成员和内容安全</p></div>
    </header>

    <v-alert v-if="!canManage" type="warning" variant="tonal" density="compact" class="settings-alert">你可以查看设置，但只有空间所有者或管理员可以修改。</v-alert>
    <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="settings-alert" @click:close="error=''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" height="2" class="settings-progress" />

    <div class="settings-layout">
      <nav class="settings-nav" aria-label="空间设置">
        <span class="nav-group">空间</span>
        <button :class="{active:tab==='general'}" type="button" @click="selectTab('general')"><v-icon size="17">mdi-tune-variant</v-icon>基本设置</button>
        <template v-if="organization">
          <span class="nav-group">协作</span>
          <button :class="{active:tab==='members'}" type="button" @click="selectTab('members')"><v-icon size="17">mdi-account-multiple-outline</v-icon>成员</button>
          <button :class="{active:tab==='groups'}" type="button" @click="selectTab('groups')"><v-icon size="17">mdi-account-group-outline</v-icon>用户组</button>
          <button :class="{active:tab==='teams'}" type="button" @click="selectTab('teams')"><v-icon size="17">mdi-source-branch</v-icon>团队</button>
        </template>
        <span class="nav-group">内容与安全</span>
        <button :class="{active:tab==='trash'}" type="button" @click="selectTab('trash')"><v-icon size="17">mdi-trash-can-outline</v-icon>回收站</button>
        <button :class="{active:tab==='audit'}" type="button" @click="selectTab('audit')"><v-icon size="17">mdi-shield-search-outline</v-icon>审计日志</button>
        <button v-if="organization&&isOwner" :class="{active:tab==='advanced'}" type="button" @click="selectTab('advanced')"><v-icon size="17">mdi-cog-outline</v-icon>高级</button>
      </nav>

      <section class="settings-content">
        <template v-if="tab === 'general'">
          <header class="content-heading"><h2>基本设置</h2><p>空间名称和新内容的默认策略</p></header>
          <div class="settings-form">
            <label class="field-intro"><strong>空间名称</strong><span>显示在空间切换和首页中</span></label>
            <v-text-field v-model="form.name" density="compact" hide-details :disabled="!canManage" />
            <div class="form-divider" />
            <div class="form-grid">
              <div><label class="field-intro"><strong>默认可见性</strong><span>新知识库与内容的初始访问范围</span></label><v-select v-model="form.defaultVisibility" density="compact" hide-details :items="visibilityOptions" :disabled="!canManage" /></div>
              <div><label class="field-intro"><strong>默认发布方式</strong><span>内容保存后是否自动更新发布版本</span></label><v-select v-model="form.defaultPublishMode" density="compact" hide-details :items="publishModeOptions" :disabled="!canManage" /></div>
            </div>
            <div class="form-actions"><v-btn color="primary" size="small" :disabled="!canManage" @click="saveGeneral">保存更改</v-btn></div>
          </div>
        </template>

        <template v-else-if="tab === 'members'">
          <header class="content-heading"><h2>空间成员</h2><p>管理成员在空间中的权限，共 {{ members.length }} 人</p></header>
          <div class="list-panel">
            <div v-for="member in members" :key="member.userId" class="member-row">
              <span class="member-avatar">{{ (member.displayName || member.email).slice(0,1).toUpperCase() }}</span>
              <span class="member-copy"><strong>{{ member.displayName || member.email }}</strong><small>{{ member.email }}</small></span>
              <span v-if="member.role === 'OWNER'" class="role-label">{{ roleLabel(member.role) }}</span>
              <v-select v-else :model-value="member.role" :items="workspaceRoleOptions" density="compact" hide-details class="role-select" :disabled="!canManage" @update:model-value="memberRole(member,$event)" />
              <v-btn icon="mdi-close" variant="text" size="x-small" color="grey-darken-1" aria-label="移除成员" :disabled="!canManage||member.role==='OWNER'" @click="removeMember(member)" />
            </div>
            <div v-if="!members.length&&!loading" class="empty-line">暂无空间成员</div>
          </div>
        </template>

        <template v-else-if="tab === 'groups'">
          <header class="content-heading action-heading"><div><h2>用户组</h2><p>批量组织成员并分配权限</p></div><v-btn color="primary" variant="tonal" size="small" prepend-icon="mdi-plus" :disabled="!canManage" @click="openDialog('group')">新建用户组</v-btn></header>
          <div class="list-panel">
            <div v-for="group in groups" :key="group.id" class="organization-row">
              <span class="organization-icon"><v-icon size="18">mdi-account-multiple-outline</v-icon></span>
              <span class="organization-copy"><strong>{{ group.name }}</strong><small>{{ group.description || `${group.memberCount ?? 0} 名成员` }}</small></span>
              <v-btn icon="mdi-delete-outline" variant="text" size="small" color="grey-darken-1" aria-label="删除用户组" :disabled="!canManage" @click="deleteGroup(group)" />
            </div>
            <div v-if="!groups.length&&!loading" class="empty-line">还没有用户组</div>
          </div>
        </template>

        <template v-else-if="tab === 'teams'">
          <header class="content-heading action-heading"><div><h2>团队</h2><p>按项目或部门划分协作范围</p></div><v-btn color="primary" variant="tonal" size="small" prepend-icon="mdi-plus" :disabled="!canManage" @click="openDialog('team')">新建团队</v-btn></header>
          <div class="list-panel">
            <div v-for="team in teams" :key="team.id" class="organization-row">
              <span class="organization-icon team-icon">{{ team.name.slice(0,1) }}</span>
              <span class="organization-copy"><strong>{{ team.name }}</strong><small>{{ visibilityLabel(team.visibility) }}</small></span>
              <v-btn :to="`/app/w/${id}/teams/${team.id}`" icon="mdi-chevron-right" variant="text" size="small" aria-label="打开团队" />
              <v-btn icon="mdi-delete-outline" variant="text" size="small" color="grey-darken-1" aria-label="删除团队" :disabled="!canManage" @click="deleteTeam(team)" />
            </div>
            <div v-if="!teams.length&&!loading" class="empty-line">还没有团队</div>
          </div>
        </template>

        <template v-else-if="tab === 'trash'">
          <header class="content-heading"><h2>回收站</h2><p>恢复已删除的页面</p></header>
          <div class="list-panel">
            <div v-for="page in trash" :key="page.id" class="trash-row"><span class="organization-icon"><v-icon size="18">mdi-file-remove-outline</v-icon></span><span class="organization-copy"><strong>{{ page.title || '无标题' }}</strong><small>删除于 {{ new Date(page.updatedAt).toLocaleString('zh-CN') }}</small></span><v-btn variant="text" size="small" prepend-icon="mdi-restore" @click="restorePage(page)">恢复</v-btn></div>
            <div v-if="!trash.length&&!loading" class="empty-box"><v-icon size="25">mdi-trash-can-outline</v-icon><strong>回收站为空</strong><span>删除的页面会暂时保留在这里</span></div>
          </div>
        </template>

        <template v-else-if="tab === 'audit'">
          <header class="content-heading"><h2>审计日志</h2><p>查看空间内最近的管理和内容操作</p></header>
          <div class="list-panel audit-list">
            <div v-for="event in audit" :key="event.id" class="audit-row"><span class="audit-dot" /><span class="organization-copy"><strong>{{ event.action }}</strong><small>{{ event.actorEmail }} · {{ resourceTypeLabel(event.resourceType) }}</small></span><time>{{ new Date(event.createdAt).toLocaleString('zh-CN') }}</time></div>
            <div v-if="!audit.length&&!loading" class="empty-line">暂无审计记录</div>
          </div>
        </template>

        <template v-else-if="tab==='advanced'&&organization&&isOwner">
          <header class="content-heading"><h2>高级设置</h2><p>所有权与空间生命周期</p></header>
          <div class="advanced-panel">
            <div class="advanced-row"><span><strong>转移空间所有权</strong><small>将所有者权限交给另一位空间成员，你会变为管理员。</small></span><v-btn variant="outlined" size="small" @click="openDialog('transfer')">转移所有权</v-btn></div>
            <div class="advanced-row danger-row"><span><strong>删除空间</strong><small>空间、知识库和协作数据将被删除，此操作不可撤销。</small></span><v-btn color="error" variant="outlined" size="small" @click="openDialog('delete')">删除空间</v-btn></div>
          </div>
        </template>
      </section>
    </div>

    <v-dialog :model-value="Boolean(dialog)" max-width="440" @update:model-value="value=>{if(!value)closeDialog()}">
      <v-card class="settings-dialog" rounded="lg">
        <v-card-title>{{ dialog==='group'?'新建用户组':dialog==='team'?'新建团队':dialog==='transfer'?'转移空间所有权':'删除空间' }}</v-card-title>
        <v-card-subtitle v-if="dialog==='transfer'">选择新所有者，并输入空间名称完成确认。</v-card-subtitle>
        <v-card-subtitle v-else-if="dialog==='delete'">此操作不可撤销，请输入空间名称确认。</v-card-subtitle>
        <v-card-text>
          <template v-if="dialog==='group'||dialog==='team'">
            <v-text-field v-model="draft.name" label="名称" density="compact" autofocus class="mb-2" />
            <v-text-field v-if="dialog==='team'" v-model="draft.slug" label="访问路径" prefix="/teams/" density="compact" class="mb-2" />
            <v-textarea v-model="draft.description" label="说明" density="compact" rows="2" auto-grow class="mb-2" />
            <v-select v-if="dialog==='team'" v-model="draft.visibility" label="可见范围" density="compact" :items="[{title:'空间内可见',value:'WORKSPACE'},{title:'仅团队成员',value:'PRIVATE'}]" />
          </template>
          <template v-else>
            <v-select v-if="dialog==='transfer'" v-model="draft.targetUserId" :items="members.filter(member=>member.role!=='OWNER')" item-title="email" item-value="userId" label="新所有者" density="compact" no-data-text="没有可转移的成员" />
            <v-text-field v-model="draft.confirmation" :label="`输入 ${workspace?.name} 确认`" density="compact" class="mt-2" />
          </template>
        </v-card-text>
        <v-card-actions><v-spacer /><v-btn size="small" @click="closeDialog">取消</v-btn><v-btn :color="dialog==='delete'?'error':'primary'" size="small" :disabled="(dialog==='delete'&&draft.confirmation!==workspace?.name)||(dialog==='transfer'&&(!draft.targetUserId||draft.confirmation!==workspace?.name))||(dialog==='group'&&!draft.name)||(dialog==='team'&&(!draft.name||!draft.slug))" @click="dialog==='group'?createGroup():dialog==='team'?createTeam():dialog==='transfer'?transfer():removeWorkspace()">{{ dialog==='delete'?'确认删除':'确认' }}</v-btn></v-card-actions>
      </v-card>
    </v-dialog>
  </main>
</template>

<style scoped>
.settings-page{max-width:1060px;padding-top:25px}.settings-head{display:flex;align-items:center;gap:9px;padding-bottom:19px;border-bottom:1px solid #e8eaee}.settings-head>div{min-width:0}.settings-head span{display:block;color:#969ca6;font-size:11px;line-height:14px}.settings-head h1{overflow:hidden;margin:0;color:#292d33;font-size:20px;font-weight:650;line-height:26px;text-overflow:ellipsis;white-space:nowrap}.settings-head p{margin:1px 0 0;color:#8e959f;font-size:12px}.settings-alert{margin-top:12px}.settings-progress{margin-top:0}.settings-layout{display:grid;grid-template-columns:176px minmax(0,1fr);gap:42px;padding-top:25px}.settings-nav{display:flex;align-self:start;flex-direction:column;position:sticky;top:16px}.nav-group{margin:17px 10px 5px;color:#a0a6af;font-size:10px;font-weight:600;letter-spacing:.04em}.nav-group:first-child{margin-top:0}.settings-nav button{display:flex;align-items:center;width:100%;height:34px;gap:8px;padding:0 10px;border:0;border-radius:6px;color:#656c77;background:transparent;font-size:13px;text-align:left;cursor:pointer}.settings-nav button:hover{background:#f5f6f8}.settings-nav button.active{color:#2468f2;background:#edf3ff;font-weight:600}.settings-content{min-width:0;max-width:760px}.content-heading{margin-bottom:18px}.content-heading h2{margin:0;color:#2e3238;font-size:18px;font-weight:650}.content-heading p{margin:4px 0 0;color:#9299a4;font-size:12px}.action-heading{display:flex;align-items:center;justify-content:space-between;gap:18px}.settings-form{max-width:680px}.field-intro{display:flex;flex-direction:column;margin-bottom:8px}.field-intro strong{color:#43484f;font-size:13px;font-weight:600}.field-intro span{margin-top:2px;color:#969ca6;font-size:11px}.form-divider{height:1px;margin:24px 0;background:#eceef1}.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.form-actions{display:flex;justify-content:flex-end;margin-top:24px;padding-top:16px;border-top:1px solid #eceef1}.list-panel,.advanced-panel{overflow:hidden;border:1px solid #e6e8ec;border-radius:8px;background:#fff}.member-row{display:grid;grid-template-columns:34px minmax(0,1fr) 132px 30px;align-items:center;min-height:59px;padding:7px 12px;border-bottom:1px solid #eef0f3}.member-row:last-child{border-bottom:0}.member-avatar{display:grid;place-items:center;width:28px;height:28px;border-radius:50%;color:#596477;background:#eef1f5;font-size:12px;font-weight:600}.member-copy,.organization-copy{display:flex;min-width:0;flex-direction:column}.member-copy strong,.organization-copy strong{overflow:hidden;color:#363a41;font-size:13px;font-weight:550;text-overflow:ellipsis;white-space:nowrap}.member-copy small,.organization-copy small{overflow:hidden;margin-top:1px;color:#959ba5;font-size:11px;text-overflow:ellipsis;white-space:nowrap}.role-select{width:132px}.role-label{color:#69717d;font-size:12px}.organization-row,.trash-row{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto;align-items:center;min-height:61px;padding:8px 12px;border-bottom:1px solid #eef0f3}.organization-row:last-child,.trash-row:last-child{border-bottom:0}.organization-icon{display:grid;place-items:center;width:30px;height:30px;border-radius:7px;color:#5f6c7f;background:#f1f3f6}.team-icon{color:#2468f2;background:#edf3ff;font-size:12px;font-weight:700}.empty-line{padding:28px;color:#999fa8;font-size:13px;text-align:center}.empty-box{display:flex;align-items:center;justify-content:center;min-height:150px;flex-direction:column;color:#9aa0aa}.empty-box strong{margin-top:7px;color:#5f6670;font-size:13px}.empty-box span{margin-top:3px;font-size:11px}.audit-row{display:grid;grid-template-columns:18px minmax(0,1fr) auto;align-items:center;min-height:58px;padding:8px 14px;border-bottom:1px solid #eef0f3}.audit-row:last-child{border-bottom:0}.audit-dot{width:7px;height:7px;border:2px solid #88aaf4;border-radius:50%}.audit-row time{color:#999fa8;font-size:11px}.advanced-row{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:18px 16px;border-bottom:1px solid #eceef1}.advanced-row:last-child{border-bottom:0}.advanced-row>span{display:flex;flex-direction:column}.advanced-row strong{color:#42474e;font-size:13px;font-weight:600}.advanced-row small{margin-top:3px;color:#969ca6;font-size:11px}.danger-row strong{color:#bd3030}.settings-dialog :deep(.v-card-title){padding:20px 20px 4px;font-size:17px;font-weight:650}.settings-dialog :deep(.v-card-subtitle){padding:0 20px 14px;color:#858c97;font-size:12px}.settings-dialog :deep(.v-card-text){padding:8px 20px 2px}.settings-dialog :deep(.v-card-actions){padding:10px 14px 14px}@media(max-width:780px){.settings-page{padding:18px 16px 40px}.settings-layout{display:block;padding-top:14px}.settings-nav{overflow-x:auto;position:static;flex-direction:row;gap:4px;padding-bottom:10px}.nav-group{display:none}.settings-nav button{flex:none;width:auto}.settings-content{padding-top:16px}.form-grid{grid-template-columns:1fr}.member-row{grid-template-columns:34px minmax(0,1fr) 116px 28px}.audit-row{grid-template-columns:18px minmax(0,1fr)}.audit-row time{display:none}.advanced-row{align-items:flex-start;flex-direction:column}.organization-row{grid-template-columns:38px minmax(0,1fr) auto auto}}
</style>
