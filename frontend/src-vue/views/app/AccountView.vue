<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { get, messageOf, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

interface AccountProfile {
  userId: string
  email: string
  displayName: string | null
  status: string
  emailVerifiedAt: string | null
  emailVerificationSource: string | null
  createdAt: string
  updatedAt: string
}

interface AccountSession {
  id: string
  current: boolean
  userAgent: string
  ipAddress: string
  lastSeenAt: string
  createdAt: string
}

type Confirmation =
  | { kind: 'SESSION'; session: AccountSession }
  | { kind: 'OTHERS' }
  | { kind: 'ALL' }
  | null

const session = useSessionStore()
const ui = useUiStore()
const router = useRouter()

const account = ref<AccountProfile | null>(null)
const sessions = ref<AccountSession[]>([])
const accountLoading = ref(false)
const sessionsLoading = ref(false)
const profileError = ref('')
const sessionsError = ref('')

const displayName = ref('')
const savingProfile = ref(false)

const currentPassword = ref('')
const newPassword = ref('')
const passwordConfirmation = ref('')
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showPasswordConfirmation = ref(false)
const changingPassword = ref(false)
const passwordError = ref('')
const passwordChanged = ref(false)

const confirmation = ref<Confirmation>(null)
const revoking = ref(false)
const revokeError = ref('')

const profileDirty = computed(() => displayName.value.trim() !== (account.value?.displayName ?? ''))
const passwordMismatch = computed(() => Boolean(newPassword.value && passwordConfirmation.value && newPassword.value !== passwordConfirmation.value))
const passwordValid = computed(() => Boolean(currentPassword.value && newPassword.value.length >= 12 && !passwordMismatch.value && passwordConfirmation.value.length >= 12))
const otherSessionCount = computed(() => sessions.value.filter((value) => !value.current).length)
const confirmationTitle = computed(() => {
  if (confirmation.value?.kind === 'SESSION') {
    const client = sessionClient(confirmation.value.session.userAgent)
    return `退出 ${client.browser} · ${client.device}？`
  }
  return confirmation.value?.kind === 'OTHERS' ? '退出其他所有设备？' : '退出全部设备？'
})
const confirmationDescription = computed(() => {
  if (confirmation.value?.kind === 'SESSION') return '该设备的会话将立即失效，下次访问时需要重新登录。'
  if (confirmation.value?.kind === 'OTHERS') return '当前设备保持登录，其他所有浏览器和客户端的会话将立即失效。'
  return '包括当前设备在内的全部会话会立即失效，完成后将返回登录页。'
})

onMounted(() => {
  void Promise.all([loadAccount(), loadSessions()])
})

async function loadAccount() {
  accountLoading.value = true
  profileError.value = ''
  try {
    const value = await get<AccountProfile>('/api/v1/account')
    account.value = value
    displayName.value = value.displayName ?? ''
  } catch (value) {
    profileError.value = messageOf(value)
  } finally {
    accountLoading.value = false
  }
}

async function loadSessions() {
  sessionsLoading.value = true
  sessionsError.value = ''
  try {
    const values = await get<AccountSession[]>('/api/v1/account/sessions')
    sessions.value = [...values].sort((left, right) => Number(right.current) - Number(left.current) || new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime())
  } catch (value) {
    sessionsError.value = messageOf(value)
  } finally {
    sessionsLoading.value = false
  }
}

async function saveProfile() {
  if (!account.value || displayName.value.length > 200) return
  savingProfile.value = true
  profileError.value = ''
  try {
    const value = await post<AccountProfile>('/api/v1/account/profile', {
      displayName: displayName.value.trim() || null,
    })
    account.value = value
    displayName.value = value.displayName ?? ''
    if (session.user) session.user = { ...session.user, displayName: value.displayName }
    ui.notify('个人资料已保存')
  } catch (value) {
    profileError.value = messageOf(value)
  } finally {
    savingProfile.value = false
  }
}

function passwordInputChanged() {
  passwordChanged.value = false
  passwordError.value = ''
}

async function changePassword() {
  if (!passwordValid.value) return
  changingPassword.value = true
  passwordError.value = ''
  passwordChanged.value = false
  try {
    await post<void>('/api/v1/account/password', {
      currentPassword: currentPassword.value,
      newPassword: newPassword.value,
      passwordConfirmation: passwordConfirmation.value,
    })
    currentPassword.value = ''
    newPassword.value = ''
    passwordConfirmation.value = ''
    passwordChanged.value = true
    await loadSessions()
    ui.notify('密码已更新，其他设备已退出登录')
  } catch (value) {
    passwordError.value = messageOf(value)
  } finally {
    changingPassword.value = false
  }
}

function askToRevoke(value: Exclude<Confirmation, null>) {
  revokeError.value = ''
  confirmation.value = value
}

async function revokeConfirmed() {
  const target = confirmation.value
  if (!target) return
  revoking.value = true
  revokeError.value = ''
  try {
    if (target.kind === 'SESSION') {
      await post<void>(`/api/v1/account/sessions/${encodeURIComponent(target.session.id)}/revoke`, {})
      sessions.value = sessions.value.filter((value) => value.id !== target.session.id)
      confirmation.value = null
      ui.notify('该设备已退出登录')
      return
    }
    if (target.kind === 'OTHERS') {
      await post<void>('/api/v1/account/sessions/revoke-others', {})
      sessions.value = sessions.value.filter((value) => value.current)
      confirmation.value = null
      ui.notify('其他设备已全部退出登录')
      return
    }

    await post<void>('/api/v1/account/sessions/revoke-all', {})
    confirmation.value = null
    resetCsrf()
    session.user = null
    session.workspaces = []
    session.knowledgeBases = []
    await router.replace('/login')
  } catch (value) {
    revokeError.value = messageOf(value)
  } finally {
    revoking.value = false
  }
}

function sessionClient(userAgent: string): { browser: string; device: string; mobile: boolean; icon: string } {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent)
  const browser = /Edg\//.test(userAgent)
    ? 'Microsoft Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /Chrome\//.test(userAgent)
        ? 'Chrome'
        : /Safari\//.test(userAgent)
          ? 'Safari'
          : /curl\//i.test(userAgent)
            ? '命令行客户端'
            : '未知浏览器'
  const device = /iPhone|iPad/.test(userAgent)
    ? 'iPhone / iPad'
    : /Android/.test(userAgent)
      ? 'Android 设备'
      : /Windows/.test(userAgent)
        ? 'Windows 设备'
        : /Macintosh|Mac OS/.test(userAgent)
          ? 'Mac 设备'
          : /Linux/.test(userAgent)
            ? 'Linux 设备'
            : mobile
              ? '移动设备'
              : '桌面设备'
  return { browser, device, mobile, icon: mobile ? 'mdi-cellphone' : 'mdi-laptop' }
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}
</script>

<template>
  <div class="page-shell account-view">
    <header class="page-heading">
      <div>
        <div class="text-overline text-primary">账号与安全</div>
        <h1>账号设置</h1>
        <p>管理公开身份、邮箱账号、登录密码和当前仍可访问账号的设备。</p>
      </div>
      <v-btn to="/app/profile" variant="outlined" prepend-icon="mdi-account-box-outline">公开主页</v-btn>
    </header>

    <div class="account-grid">
      <v-card class="section-card" rounded="xl">
        <v-card-title class="card-heading pa-5 pa-md-6 pb-3">
          <v-avatar color="primary" variant="tonal"><v-icon>mdi-account-outline</v-icon></v-avatar>
          <div><h2>个人资料</h2><p>显示名会出现在空间成员、团队和协作记录中。</p></div>
        </v-card-title>
        <v-progress-linear v-if="accountLoading" indeterminate color="primary" />
        <v-card-text class="pa-5 pa-md-6 pt-3">
          <v-form @submit.prevent="saveProfile">
            <v-text-field v-model="displayName" label="显示名" placeholder="例如：林静" maxlength="200" counter prepend-inner-icon="mdi-card-account-details-outline" hint="可以留空；留空时使用邮箱识别你。" persistent-hint />

            <div class="email-panel mt-5">
              <v-avatar color="primary" variant="tonal"><v-icon>mdi-email-outline</v-icon></v-avatar>
              <div><small>登录邮箱</small><strong>{{ account?.email || '正在读取…' }}</strong><span>邮箱是唯一账号名称，当前不允许自助更换。</span></div>
              <v-chip v-if="account" :color="account.emailVerifiedAt ? 'success' : 'warning'" size="small" variant="tonal" :prepend-icon="account.emailVerifiedAt ? 'mdi-check-decagram-outline' : 'mdi-clock-outline'">
                {{ account.emailVerifiedAt ? '已验证' : '待验证' }}
              </v-chip>
            </div>

            <v-alert v-if="profileError" type="error" variant="tonal" class="mt-5">{{ profileError }}</v-alert>
            <div class="form-actions mt-5">
              <small v-if="account">加入于 {{ formatTime(account.createdAt) }}</small>
              <v-spacer />
              <v-btn color="primary" type="submit" :loading="savingProfile" :disabled="accountLoading || !account || !profileDirty || displayName.length > 200">保存资料</v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>

      <v-card class="section-card" rounded="xl">
        <v-card-title class="card-heading pa-5 pa-md-6 pb-3">
          <v-avatar color="primary" variant="tonal"><v-icon>mdi-shield-key-outline</v-icon></v-avatar>
          <div><h2>修改密码</h2><p>验证当前密码后，为账号设置一个新的登录密码。</p></div>
        </v-card-title>
        <v-card-text class="pa-5 pa-md-6 pt-3">
          <v-form @submit.prevent="changePassword">
            <v-text-field
              v-model="currentPassword"
              :type="showCurrentPassword ? 'text' : 'password'"
              label="当前密码"
              autocomplete="current-password"
              prepend-inner-icon="mdi-lock-outline"
              :append-inner-icon="showCurrentPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
              @click:append-inner="showCurrentPassword = !showCurrentPassword"
              @update:model-value="passwordInputChanged"
            />
            <div class="password-grid">
              <v-text-field
                v-model="newPassword"
                :type="showNewPassword ? 'text' : 'password'"
                label="新密码"
                autocomplete="new-password"
                minlength="12"
                maxlength="128"
                counter
                hint="至少 12 位"
                persistent-hint
                :append-inner-icon="showNewPassword ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
                @click:append-inner="showNewPassword = !showNewPassword"
                @update:model-value="passwordInputChanged"
              />
              <v-text-field
                v-model="passwordConfirmation"
                :type="showPasswordConfirmation ? 'text' : 'password'"
                label="确认新密码"
                autocomplete="new-password"
                minlength="12"
                maxlength="128"
                :error="passwordMismatch"
                :error-messages="passwordMismatch ? ['两次输入的新密码不一致'] : []"
                :append-inner-icon="showPasswordConfirmation ? 'mdi-eye-off-outline' : 'mdi-eye-outline'"
                @click:append-inner="showPasswordConfirmation = !showPasswordConfirmation"
                @update:model-value="passwordInputChanged"
              />
            </div>
            <v-alert v-if="passwordError" type="error" variant="tonal" class="mt-2">{{ passwordError }}</v-alert>
            <v-alert v-if="passwordChanged" type="success" variant="tonal" class="mt-2">密码已更新。出于安全考虑，其他设备已退出登录。</v-alert>
            <div class="form-actions mt-5">
              <small><v-icon size="16">mdi-help-circle-outline</v-icon>忘记当前密码时，请退出后使用邮箱验证码重置。</small>
              <v-spacer />
              <v-btn color="primary" type="submit" :loading="changingPassword" :disabled="!passwordValid">更新密码</v-btn>
            </div>
          </v-form>
        </v-card-text>
      </v-card>

      <v-card class="section-card sessions-card" rounded="xl">
        <v-card-title class="sessions-heading pa-5 pa-md-6 pb-4">
          <div class="card-heading">
            <v-avatar color="primary" variant="tonal"><v-icon>mdi-monitor-cellphone</v-icon></v-avatar>
            <div><h2>登录设备</h2><p>发现不认识的设备时，可以立即撤销它的访问权限。</p></div>
          </div>
          <v-spacer />
          <v-btn variant="outlined" prepend-icon="mdi-refresh" :loading="sessionsLoading" @click="loadSessions">刷新</v-btn>
          <v-btn color="primary" variant="tonal" prepend-icon="mdi-logout-variant" :disabled="otherSessionCount === 0" @click="askToRevoke({ kind: 'OTHERS' })">退出其他设备</v-btn>
        </v-card-title>
        <v-divider />
        <v-progress-linear v-if="sessionsLoading" indeterminate color="primary" />
        <v-alert v-if="sessionsError" type="error" variant="tonal" class="ma-5">{{ sessionsError }}</v-alert>

        <v-list v-if="sessions.length" lines="three" class="session-list pa-2 pa-md-4">
          <template v-for="item in sessions" :key="item.id">
            <v-list-item class="session-row" rounded="lg">
              <template #prepend><v-avatar :color="item.current ? 'success' : 'primary'" variant="tonal"><v-icon>{{ sessionClient(item.userAgent).icon }}</v-icon></v-avatar></template>
              <v-list-item-title class="session-title">
                <strong>{{ sessionClient(item.userAgent).browser }} · {{ sessionClient(item.userAgent).device }}</strong>
                <v-chip v-if="item.current" color="success" variant="tonal" size="x-small">当前设备</v-chip>
              </v-list-item-title>
              <v-list-item-subtitle>
                <span>{{ item.ipAddress }} · 最近活动于 {{ formatTime(item.lastSeenAt) }}</span>
                <small :title="item.userAgent">登录于 {{ formatTime(item.createdAt) }}</small>
              </v-list-item-subtitle>
              <template #append>
                <v-chip v-if="item.current" color="success" variant="text" prepend-icon="mdi-shield-check-outline">使用中</v-chip>
                <v-btn v-else color="error" variant="text" prepend-icon="mdi-logout" @click="askToRevoke({ kind: 'SESSION', session: item })">退出</v-btn>
              </template>
            </v-list-item>
            <v-divider />
          </template>
        </v-list>
        <div v-else-if="!sessionsLoading && !sessionsError" class="empty-state"><div><v-icon size="48">mdi-laptop-off</v-icon><h3>暂无活动设备</h3><p>成功登录的浏览器和客户端会显示在这里。</p></div></div>

        <v-divider />
        <div class="danger-footer pa-5 pa-md-6">
          <div><strong>退出全部设备</strong><p>包括当前设备在内的所有会话会立即失效，需要重新登录。</p></div>
          <v-btn color="error" variant="outlined" prepend-icon="mdi-logout" @click="askToRevoke({ kind: 'ALL' })">退出全部设备</v-btn>
        </div>
      </v-card>
    </div>

    <v-dialog :model-value="Boolean(confirmation)" max-width="520" :persistent="revoking" @update:model-value="value => { if (!value && !revoking) confirmation = null }">
      <v-card rounded="xl">
        <v-card-title class="pa-6 pb-2">{{ confirmationTitle }}</v-card-title>
        <v-card-text class="px-6 pb-3">
          {{ confirmationDescription }}
          <v-alert v-if="revokeError" type="error" variant="tonal" class="mt-4">{{ revokeError }}</v-alert>
        </v-card-text>
        <v-card-actions class="pa-6 pt-3">
          <v-spacer />
          <v-btn variant="text" :disabled="revoking" @click="confirmation = null">取消</v-btn>
          <v-btn color="error" variant="flat" :loading="revoking" @click="revokeConfirmed">确认退出</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.account-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; align-items: start; }
.card-heading { display: flex; align-items: center; gap: 14px; white-space: normal; }
.card-heading h2 { margin: 0; font-size: 1.05rem; }
.card-heading p { margin: 3px 0 0; color: rgb(var(--v-theme-on-surface), .58); font-size: .84rem; line-height: 1.45; }
.email-panel { display: flex; align-items: center; gap: 14px; padding: 15px; border: 1px solid rgb(var(--v-theme-on-surface), .08); border-radius: 14px; background: rgb(var(--v-theme-surface-variant), .3); }
.email-panel > div { display: grid; min-width: 0; flex: 1; }
.email-panel small, .email-panel span { color: rgb(var(--v-theme-on-surface), .55); }
.email-panel strong { overflow: hidden; text-overflow: ellipsis; }
.email-panel span { margin-top: 2px; font-size: .74rem; }
.password-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.form-actions { display: flex; align-items: center; gap: 12px; }
.form-actions small { color: rgb(var(--v-theme-on-surface), .55); display: inline-flex; align-items: center; gap: 5px; }
.sessions-card { grid-column: 1 / -1; }
.sessions-heading { display: flex; align-items: center; gap: 10px; }
.session-row { min-height: 82px; }
.session-title { display: flex; align-items: center; gap: 8px; }
.session-row .v-list-item-subtitle { display: grid; gap: 3px; }
.session-row .v-list-item-subtitle small { color: rgb(var(--v-theme-on-surface), .48); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.danger-footer { display: flex; align-items: center; justify-content: space-between; gap: 20px; background: rgb(var(--v-theme-error), .035); }
.danger-footer strong { color: rgb(var(--v-theme-error)); }
.danger-footer p { margin: 4px 0 0; color: rgb(var(--v-theme-on-surface), .58); }
@media (max-width: 960px) {
  .account-grid { grid-template-columns: 1fr; }
  .sessions-card { grid-column: auto; }
  .sessions-heading { align-items: flex-start; flex-wrap: wrap; }
  .sessions-heading > .v-spacer { display: none; }
}
@media (max-width: 700px) {
  .password-grid { grid-template-columns: 1fr; gap: 0; }
  .email-panel { align-items: flex-start; flex-wrap: wrap; }
  .form-actions, .danger-footer { align-items: stretch; flex-direction: column; }
  .session-title { align-items: flex-start; flex-direction: column; }
  .session-row :deep(.v-list-item__append) { align-self: center; }
}
</style>
