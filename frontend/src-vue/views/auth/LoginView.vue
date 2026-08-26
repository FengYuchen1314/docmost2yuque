<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { RegistrationStatus } from '../../../src/types'
import AuthLayout from '../../layouts/AuthLayout.vue'
import { get, messageOf, post, resetCsrf } from '../../services/api'
import { useSessionStore } from '../../stores/session'

const router = useRouter()
const route = useRoute()
const session = useSessionStore()
const registration = ref<RegistrationStatus | null>(null)
const mode = ref<'password' | 'code'>('password')
const form = reactive({ email: '', password: '', code: '' })
const codeSent = ref(false)
const loading = ref(false)
const error = ref('')
onMounted(async () => { registration.value = await get('/api/v1/auth/registration-status') })

function switchMode(value: 'password' | 'code') {
  mode.value = value
  codeSent.value = false
  form.code = ''
  error.value = ''
}

async function finish() {
  resetCsrf()
  await session.loadUser()
  const returnTo = typeof route.query.returnTo === 'string' && route.query.returnTo.startsWith('/') && !route.query.returnTo.startsWith('//') ? route.query.returnTo : '/app'
  await router.replace(returnTo)
}
async function login() {
  loading.value = true; error.value = ''
  try {
    if (mode.value === 'password') await post('/api/v1/auth/login/password', { email: form.email, password: form.password }, false)
    else if (!codeSent.value) { await post('/api/v1/auth/login/email-code/request', { email: form.email }, false); codeSent.value = true; return }
    else await post('/api/v1/auth/login/email-code/verify', { email: form.email, code: form.code }, false)
    await finish()
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
</script>

<template>
  <AuthLayout eyebrow="欢迎回来" title="登录知序" description="使用邮箱继续访问你的知识空间">
    <div v-if="registration?.emailCodeLoginAvailable" class="auth-mode-tabs" role="tablist" aria-label="登录方式">
      <button type="button" role="tab" :aria-selected="mode === 'password'" :class="{ 'is-active': mode === 'password' }" @click="switchMode('password')">密码登录</button>
      <button type="button" role="tab" :aria-selected="mode === 'code'" :class="{ 'is-active': mode === 'code' }" @click="switchMode('code')">验证码登录</button>
    </div>
    <v-form class="auth-form-stack" @submit.prevent="login">
      <v-text-field v-model="form.email" class="auth-field" label="邮箱" type="email" autocomplete="email" variant="outlined" density="compact" :disabled="codeSent" required />
      <v-text-field v-if="mode === 'password'" v-model="form.password" class="auth-field" label="密码" type="password" autocomplete="current-password" variant="outlined" density="compact" required />
      <template v-else-if="codeSent">
        <div class="auth-sent-tip"><span>验证码已发送至 {{ form.email }}</span><button type="button" @click="codeSent = false; form.code = ''">更换邮箱</button></div>
        <v-text-field v-model="form.code" class="auth-field" label="6 位验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code" variant="outlined" density="compact" required />
      </template>
      <div v-if="mode === 'password'" class="auth-form-meta"><span /><router-link to="/forgot-password">忘记密码？</router-link></div>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="auth-alert">{{ error }}</v-alert>
      <v-btn type="submit" class="auth-primary" size="large" block :loading="loading">{{ mode === 'code' ? codeSent ? '验证并登录' : '获取验证码' : '登录' }}</v-btn>
    </v-form>
    <template #footer>
      <span v-if="registration?.publicRegistrationEnabled">没有账号？ <router-link to="/register">立即注册</router-link></span>
      <span v-else>没有账号？请联系管理员获取邀请</span>
    </template>
  </AuthLayout>
</template>
