<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Page, Team } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useUiStore } from '../../stores/ui'
import type { AclEntry, AuthorizationDecision, UserGroup, WorkspaceMember } from './types'
import { capabilityLabel, formatDateTime, roleLabel } from './utils'

type SubjectType = 'USER' | 'GROUP' | 'TEAM' | 'PUBLIC'
type Effect = 'ALLOW' | 'DENY'

const props = defineProps<{ page: Page }>()
const ui = useUiStore()
const decision = ref<AuthorizationDecision | null>(null)
const entries = ref<AclEntry[]>([])
const members = ref<WorkspaceMember[]>([])
const groups = ref<UserGroup[]>([])
const teams = ref<Team[]>([])
const loading = ref(false)
const working = ref(false)
const error = ref('')
const loadFailed = ref(false)

const subjectType = ref<SubjectType>('USER')
const subjectId = ref<string | null>(null)
const role = ref<'READER' | 'EDITOR' | 'MANAGER'>('READER')
const effect = ref<Effect>('ALLOW')
const grantConfirmOpen = ref(false)
const revokeTarget = ref<AclEntry | null>(null)
let permissionsRequestVersion = 0

const canManage = computed(() => decision.value?.capabilities.includes('MANAGE_PERMISSIONS') ?? false)
const subjectItems = computed(() => {
  if (subjectType.value === 'USER') return members.value.map((item) => ({ title: `${item.displayName || item.email} · ${item.role}`, value: item.userId }))
  if (subjectType.value === 'GROUP') return groups.value.map((item) => ({ title: `${item.name} · ${item.memberCount} 人`, value: item.id }))
  if (subjectType.value === 'TEAM') return teams.value.map((item) => ({ title: item.name, value: item.id }))
  return []
})
const highImpactGrant = computed(() => subjectType.value === 'PUBLIC' || effect.value === 'DENY' || role.value === 'MANAGER')

watch(() => props.page.id, () => {
  grantConfirmOpen.value = false
  revokeTarget.value = null
  subjectId.value = null
  void loadAll()
}, { immediate: true })

async function loadAll() {
  const pageId = props.page.id
  const workspaceId = props.page.workspaceId
  const version = ++permissionsRequestVersion
  loading.value = true
  error.value = ''
  loadFailed.value = false
  decision.value = null
  entries.value = []
  members.value = []
  groups.value = []
  teams.value = []
  grantConfirmOpen.value = false
  revokeTarget.value = null
  try {
    const resolved = await post<AuthorizationDecision>('/api/v1/authorization/resolve', { resourceType: 'PAGE', resourceId: pageId })
    if (version !== permissionsRequestVersion || pageId !== props.page.id) return
    if (resolved.capabilities.includes('MANAGE_PERMISSIONS')) {
      const [acl, workspaceMembers, userGroups, workspaceTeams] = await Promise.all([
        post<AclEntry[]>('/api/v1/authorization/list', { resourceType: 'PAGE', resourceId: pageId }),
        post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId }),
        post<UserGroup[]>('/api/v1/user-groups/list', { workspaceId }),
        post<Team[]>('/api/v1/teams/list', { workspaceId }),
      ])
      if (version !== permissionsRequestVersion || pageId !== props.page.id) return
      entries.value = Array.isArray(acl) ? acl : []
      members.value = Array.isArray(workspaceMembers) ? workspaceMembers : []
      groups.value = Array.isArray(userGroups) ? userGroups : []
      teams.value = Array.isArray(workspaceTeams) ? workspaceTeams : []
    } else {
      entries.value = []
      members.value = []
      groups.value = []
      teams.value = []
    }
    decision.value = resolved
  } catch (value) {
    if (version === permissionsRequestVersion && pageId === props.page.id) { error.value = messageOf(value); loadFailed.value = true }
  } finally {
    if (version === permissionsRequestVersion && pageId === props.page.id) loading.value = false
  }
}

function requestGrant() {
  if (loading.value || loadFailed.value || error.value || !canManage.value || (subjectType.value !== 'PUBLIC' && !subjectId.value)) return
  if (highImpactGrant.value) grantConfirmOpen.value = true
  else void grant()
}

async function grant() {
  if (working.value || loading.value || loadFailed.value || error.value || !canManage.value || (subjectType.value !== 'PUBLIC' && !subjectId.value)) return
  const pageId = props.page.id
  working.value = true
  error.value = ''
  try {
    await post<AclEntry>('/api/v1/authorization/grant', {
      resourceType: 'PAGE',
      resourceId: pageId,
      subjectType: subjectType.value,
      subjectId: subjectType.value === 'PUBLIC' ? null : subjectId.value,
      role: role.value,
      effect: effect.value,
      capabilities: [],
    })
    if (pageId !== props.page.id) return
    grantConfirmOpen.value = false
    subjectId.value = null
    await loadAll()
    ui.notify('文稿权限已保存')
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

async function revoke() {
  if (!revokeTarget.value || working.value || loading.value || loadFailed.value || error.value || !canManage.value) return
  const pageId = props.page.id
  const aclEntryId = revokeTarget.value.id
  if (!entries.value.some((entry) => entry.id === aclEntryId)) return
  working.value = true
  error.value = ''
  try {
    await post<void>('/api/v1/authorization/revoke', { aclEntryId })
    if (pageId !== props.page.id) return
    revokeTarget.value = null
    await loadAll()
    ui.notify('文稿级权限覆盖已移除')
  } catch (value) {
    if (pageId === props.page.id) error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

function principalName(entry: AclEntry) {
  if (entry.subjectType === 'PUBLIC') return '任何人'
  if (entry.subjectType === 'USER') {
    const member = members.value.find((item) => item.userId === entry.subjectId)
    return member?.displayName || member?.email || '已离开空间的用户'
  }
  if (entry.subjectType === 'GROUP') return groups.value.find((item) => item.id === entry.subjectId)?.name || '已删除的用户组'
  if (entry.subjectType === 'TEAM') return teams.value.find((item) => item.id === entry.subjectId)?.name || '已删除的团队'
  return `${entry.subjectType} · ${entry.subjectId || '—'}`
}

function subjectTypeLabel(value: AclEntry['subjectType']) {
  return ({ USER: '用户', GROUP: '用户组', TEAM: '团队', PUBLIC: '公开主体', INVITE: '邀请', API_CLIENT: 'API 客户端' })[value]
}

function sourceLabel(value: string) {
  const [scope, detail] = value.split(':')
  const name = ({ workspace: '空间角色', team: '团队角色', 'knowledge-base': '知识库角色', visibility: '公开范围', acl: '文稿覆盖' } as Record<string, string>)[scope ?? ''] ?? scope
  return `${name}${detail ? `：${detail}` : ''}`
}
</script>

<template>
  <section class="panel-shell">
    <header class="panel-heading">
      <v-icon size="18">mdi-account-lock-outline</v-icon>
      <div><h2>协作者权限</h2><p>查看最终能力和继承来源，并配置文稿级访问覆盖。</p></div>
    </header>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-5" />
    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>
    <div v-if="loadFailed && !decision && !loading" class="permission-load-error"><v-icon size="28">mdi-alert-circle-outline</v-icon><strong>权限信息加载失败</strong><span>当前未显示任何权限结论，请重新加载</span><v-btn size="small" variant="tonal" prepend-icon="mdi-refresh" @click="loadAll">重新加载</v-btn></div>

    <v-card v-if="decision" variant="tonal" color="primary" class="decision-card mb-6">
      <v-card-text>
        <div class="decision-head"><strong>当前访问能力</strong><v-chip size="small">权限版本 {{ decision.permissionVersion }}</v-chip><v-chip size="small">{{ decision.visibility }}</v-chip></div>
        <div class="capability-cloud">
          <v-chip v-for="capability in decision.capabilities" :key="capability" size="small" variant="flat">{{ capabilityLabel(capability) }}</v-chip>
          <span v-if="!decision.capabilities.length">无有效能力</span>
        </div>
        <div class="sources"><strong>计算来源</strong><code v-for="source in decision.sources" :key="source">{{ sourceLabel(source) }}</code></div>
      </v-card-text>
    </v-card>

    <template v-if="canManage">
      <h3 class="subheading">新增或更新覆盖</h3>
      <div class="grant-grid">
        <v-select v-model="subjectType" label="主体类型" variant="outlined" density="compact" :items="[{title:'指定用户',value:'USER'},{title:'指定用户组',value:'GROUP'},{title:'指定团队',value:'TEAM'},{title:'任何人',value:'PUBLIC'}]" @update:model-value="subjectId = null" />
        <v-select v-if="subjectType !== 'PUBLIC'" v-model="subjectId" label="选择主体" variant="outlined" density="compact" :items="subjectItems" />
        <v-text-field v-else model-value="所有访问者" label="访问主体" variant="outlined" density="compact" disabled prepend-inner-icon="mdi-earth" />
        <v-select v-model="role" label="角色" variant="outlined" density="compact" :items="[{title:'只读',value:'READER'},{title:'可编辑',value:'EDITOR'},{title:'管理者',value:'MANAGER'}]" />
        <v-select v-model="effect" label="效果" variant="outlined" density="compact" :color="effect === 'DENY' ? 'error' : undefined" :items="[{title:'允许',value:'ALLOW'},{title:'拒绝',value:'DENY'}]" />
      </div>
      <div class="grant-actions"><v-btn color="primary" prepend-icon="mdi-shield-check-outline" :loading="working" :disabled="loading || Boolean(error) || !canManage || (subjectType !== 'PUBLIC' && !subjectId)" @click="requestGrant">保存权限</v-btn></div>

      <v-divider class="my-5" />
      <div class="section-title"><h3>文稿级权限覆盖</h3><v-chip size="small" variant="tonal">{{ entries.length }} 条</v-chip></div>
      <div v-if="entries.length" class="acl-list">
        <article v-for="entry in entries" :key="entry.id">
          <span class="effect-icon" :class="entry.effect.toLowerCase()"><v-icon size="16">{{ entry.effect === 'ALLOW' ? 'mdi-check' : 'mdi-cancel' }}</v-icon></span>
          <div class="acl-copy"><strong>{{ principalName(entry) }}</strong><span>{{ subjectTypeLabel(entry.subjectType) }} · {{ entry.effect === 'ALLOW' ? '允许' : '拒绝' }} {{ roleLabel(entry.role) }}<template v-if="entry.capabilities.length"> · {{ entry.capabilities.map(capabilityLabel).join('、') }}</template></span><small>{{ formatDateTime(entry.updatedAt) }}</small></div>
          <v-btn icon="mdi-delete-outline" variant="text" color="error" :disabled="loading || Boolean(error) || working" :aria-label="`移除 ${principalName(entry)} 的权限`" @click="revokeTarget = entry" />
        </article>
      </div>
      <div v-else-if="!loading && !loadFailed" class="empty-box"><v-icon size="28">mdi-account-group-outline</v-icon><strong>没有文稿级覆盖</strong><span>当前继承空间、团队和知识库权限</span></div>
    </template>

    <v-alert v-else-if="decision && !loading" type="info" variant="tonal" icon="mdi-lock-outline">
      你可以查看最终权限，但需要“管理权限”能力才能新增或撤销文稿级协作者。
    </v-alert>

    <v-dialog v-model="grantConfirmOpen" max-width="480" persistent>
      <v-card><v-card-title class="px-6 pt-5">保存高影响文稿权限？</v-card-title><v-card-text class="px-6">公开主体、拒绝规则或管理者角色会明显改变访问范围，保存后立即生效。<v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="working" @click="grantConfirmOpen = false">取消</v-btn><v-btn color="primary" :loading="working" :disabled="loading || Boolean(error) || !canManage" @click="grant">确认保存</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(revokeTarget)" max-width="480" persistent>
      <v-card><v-card-title class="px-6 pt-5">移除“{{ revokeTarget ? principalName(revokeTarget) : '' }}”的覆盖权限？</v-card-title><v-card-text class="px-6">移除后立即回到空间、团队和知识库继承权限的计算结果。<v-alert v-if="error" type="error" variant="tonal" class="mt-4">{{ error }}</v-alert></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn :disabled="working" @click="revokeTarget = null">取消</v-btn><v-btn color="error" :loading="working" :disabled="loading || Boolean(error) || !canManage" @click="revoke">确认移除</v-btn></v-card-actions></v-card>
    </v-dialog>
  </section>
</template>

<style scoped>
.panel-shell { width: 100%; margin: 0; }
.panel-heading { display: flex; align-items: flex-start; gap: 8px; margin-bottom: 16px; }.panel-heading > .v-icon { margin-top: 2px; color: #737876; }
.panel-heading h2 { margin: 0; font-size: 15px; line-height: 20px; }.panel-heading p { margin: 2px 0 0; color: #8a8f8d; font-size: 12px; line-height: 18px; }
.decision-card { border: 1px solid #dce8e0; border-radius: 6px !important; background: #f7faf8 !important; color: #262626 !important; }.decision-card :deep(.v-card-text) { padding: 12px; }
.decision-head { display: flex; align-items: center; gap: 6px; font-size: 13px; }.decision-head strong { margin-right: auto; }
.capability-cloud { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 10px 0; }
.sources { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; color: #737876; font-size: 11px; }.sources code { border-radius: 4px; padding: 2px 5px; background: #edf0ee; }
.subheading, .section-title h3 { margin: 0 0 12px; font-size: 14px; }
.grant-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0 10px; }.grant-actions { display: flex; justify-content: flex-end; }
.section-title { display: flex; align-items: center; justify-content: space-between; }.section-title h3 { margin: 0; }
.acl-list { overflow: hidden; border: 1px solid #e7e9e8; border-radius: 6px; }
.acl-list article { display: flex; min-height: 54px; align-items: center; gap: 9px; padding: 8px 7px 8px 10px; }.acl-list article:hover { background: #fafbfa; }.acl-list article + article { border-top: 1px solid #eef0ef; }
.effect-icon { display: grid; width: 28px; height: 28px; flex: 0 0 28px; place-items: center; border-radius: 5px; }.effect-icon.allow { background: #eaf7ef; color: #25834b; }.effect-icon.deny { background: #fff0ef; color: #d33b32; }
.acl-copy { display: flex; min-width: 0; flex: 1; flex-direction: column; }.acl-copy strong { font-size: 13px; }.acl-copy span, .acl-copy small { color: #818684; font-size: 11px; }.acl-copy small { margin-top: 1px; font-size: 10px; }
.empty-box { display: grid; min-height: 140px; place-items: center; align-content: center; gap: 5px; border: 1px dashed #e0e3e1; border-radius: 6px; color: #9ba09e; text-align: center; }.empty-box strong { color: #606562; font-size: 13px; }.empty-box span { font-size: 12px; }
.permission-load-error { display: grid; min-height: 150px; place-items: center; align-content: center; gap: 5px; border: 1px dashed #ead4d1; border-radius: 6px; color: #8a8f8d; text-align: center; }.permission-load-error > .v-icon { color: #d84b42; }.permission-load-error strong { color: #606562; font-size: 13px; }.permission-load-error span { font-size: 12px; }
@media (max-width: 650px) { .grant-grid { grid-template-columns: 1fr; } }
</style>
