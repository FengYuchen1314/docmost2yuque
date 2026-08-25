<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import AuthLayout from '../../layouts/AuthLayout.vue'
import { get, messageOf, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'

interface Invitation { invitationId: string; workspaceId: string; workspaceName: string; maskedEmail: string; workspaceRole: string; accountExists: boolean; expiresAt: string }
const route = useRoute(); const router = useRouter(); const session = useSessionStore()
const token = computed(() => String(route.query.token ?? ''))
const invitation = ref<Invitation | null>(null)
const form = reactive({ password: '', passwordConfirmation: '' })
const loading = ref(true); const accepting = ref(false); const error = ref('')
onMounted(async () => {
  try { invitation.value = await get(`/api/v1/invitations/resolve?token=${encodeURIComponent(token.value)}`) }
  catch (value) { error.value = messageOf(value) } finally { loading.value = false }
})
async function accept() {
  if (!invitation.value) return
  accepting.value = true; error.value = ''
  try {
    const result = await post<{ workspaceId: string }>('/api/v1/invitations/accept', { token: token.value, password: invitation.value.accountExists ? null : form.password, passwordConfirmation: invitation.value.accountExists ? null : form.passwordConfirmation }, false)
    resetCsrf()
    await session.loadUser(); await router.replace(`/app/w/${result.workspaceId}`)
  } catch (value) { error.value = messageOf(value) } finally { accepting.value = false }
}
</script>

<template>
  <AuthLayout eyebrow="成员邀请" :title="invitation ? `加入「${invitation.workspaceName}」` : '验证邀请'" :description="invitation ? `邀请绑定 ${invitation.maskedEmail}，接受后将直接进入工作区。` : '正在确认邀请状态。'">
    <v-progress-linear v-if="loading" indeterminate color="primary" />
    <v-alert v-else-if="!invitation" type="error" variant="tonal">{{ error || '邀请无效、已过期或已使用。' }}</v-alert>
    <v-form v-else @submit.prevent="accept">
      <v-alert type="info" variant="tonal" class="mb-4">空间角色：{{ invitation.workspaceRole }} · 到期时间：{{ new Date(invitation.expiresAt).toLocaleString('zh-CN') }}</v-alert>
      <template v-if="!invitation.accountExists">
        <v-text-field v-model="form.password" type="password" label="为受邀邮箱设置密码" hint="至少 12 位" persistent-hint required class="mb-4" />
        <v-text-field v-model="form.passwordConfirmation" type="password" label="确认密码" required class="mb-4" />
      </template>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
      <v-btn type="submit" color="primary" size="large" block :loading="accepting" :disabled="!invitation.accountExists && (form.password.length < 12 || form.password !== form.passwordConfirmation)">接受邀请并进入</v-btn>
    </v-form>
  </AuthLayout>
</template>
