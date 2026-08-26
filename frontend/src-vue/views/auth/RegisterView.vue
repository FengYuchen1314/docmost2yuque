<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { RegistrationStatus } from '../../../src/types'
import AuthLayout from '../../layouts/AuthLayout.vue'
import { get, messageOf, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'

const router = useRouter()
const session = useSessionStore()
const form = reactive({ email: '', password: '', passwordConfirmation: '', challengeId: '', code: '' })
const step = ref<'account' | 'verify'>('account')
const loading = ref(false)
const error = ref('')
onMounted(async () => { const status = await get<RegistrationStatus>('/api/v1/auth/registration-status'); if (!status.publicRegistrationEnabled) await router.replace('/login') })
async function submit() {
  loading.value = true; error.value = ''
  try {
    if (step.value === 'account') {
      const result = await post<{ challengeId: string }>('/api/v1/auth/register/start', { email: form.email, password: form.password, passwordConfirmation: form.passwordConfirmation }, false)
      form.challengeId = result.challengeId; step.value = 'verify'
    } else {
      await post('/api/v1/auth/register/verify', { challengeId: form.challengeId, code: form.code }, false)
      resetCsrf()
      await session.loadUser(); await router.replace('/app')
    }
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
</script>

<template>
  <AuthLayout :eyebrow="step === 'account' ? '公开注册' : '邮箱验证'" :title="step === 'account' ? '创建知序账号' : '验证邮箱'" :description="step === 'account' ? '邮箱是唯一账号名称，注册后会创建个人工作区' : '输入邮件中的验证码完成注册'">
    <v-form class="auth-form-stack" @submit.prevent="submit">
      <template v-if="step === 'account'">
        <v-text-field v-model="form.email" class="auth-field" type="email" label="邮箱" autocomplete="email" variant="outlined" density="compact" required />
        <v-text-field v-model="form.password" class="auth-field" type="password" label="密码" autocomplete="new-password" hint="至少 12 位" persistent-hint variant="outlined" density="compact" required />
        <v-text-field v-model="form.passwordConfirmation" class="auth-field" type="password" label="确认密码" autocomplete="new-password" variant="outlined" density="compact" required />
      </template>
      <template v-else>
        <div class="auth-sent-tip"><span>验证码已发送至 {{ form.email }}</span><button type="button" @click="step = 'account'; form.code = ''">修改邮箱</button></div>
        <v-text-field v-model="form.code" class="auth-field" label="6 位验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code" variant="outlined" density="compact" required />
      </template>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="auth-alert">{{ error }}</v-alert>
      <v-btn type="submit" class="auth-primary" size="large" block :loading="loading" :disabled="step === 'account' ? form.password.length < 12 || form.password !== form.passwordConfirmation : form.code.length !== 6">{{ step === 'account' ? '发送验证邮件' : '验证并进入' }}</v-btn>
    </v-form>
    <template #footer>已有账号？ <router-link to="/login">返回登录</router-link></template>
  </AuthLayout>
</template>
