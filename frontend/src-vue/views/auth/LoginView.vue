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
  <AuthLayout eyebrow="欢迎回来" title="登录工作区" description="使用邮箱继续你的工作。">
    <v-btn-toggle v-if="registration?.emailCodeLoginAvailable" v-model="mode" mandatory color="primary" variant="outlined" divided class="mb-6 w-100">
      <v-btn value="password" class="flex-grow-1">密码</v-btn><v-btn value="code" class="flex-grow-1">邮箱验证码</v-btn>
    </v-btn-toggle>
    <v-form @submit.prevent="login">
      <v-text-field v-model="form.email" label="邮箱" type="email" autocomplete="email" prepend-inner-icon="mdi-email-outline" :disabled="codeSent" required class="mb-4" />
      <v-text-field v-if="mode === 'password'" v-model="form.password" label="密码" type="password" autocomplete="current-password" prepend-inner-icon="mdi-lock-outline" required class="mb-2" />
      <v-text-field v-else-if="codeSent" v-model="form.code" label="6 位验证码" maxlength="6" inputmode="numeric" prepend-inner-icon="mdi-shield-key-outline" required class="mb-4" />
      <div v-if="mode === 'password'" class="text-right mb-4"><router-link to="/forgot-password">忘记密码？</router-link></div>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
      <v-btn type="submit" color="primary" size="large" block :loading="loading">{{ mode === 'code' && !codeSent ? '发送验证码' : '登录' }}</v-btn>
      <v-btn v-if="codeSent" variant="text" block class="mt-2" @click="codeSent = false">更换邮箱</v-btn>
    </v-form>
    <template #footer>
      <span v-if="registration?.publicRegistrationEnabled">没有账号？ <router-link to="/register">立即注册</router-link></span>
      <span v-else>没有账号？请联系管理员获取邀请。</span>
    </template>
  </AuthLayout>
</template>
