<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SetupStatus } from '../../../src/types'
import AuthLayout from '../../layouts/AuthLayout.vue'
import { get, messageOf, post, resetCsrf } from '../../services/api'

const router = useRouter()
const form = reactive({ email: '', workspaceName: '', password: '', passwordConfirmation: '' })
const loading = ref(false)
const error = ref('')

onMounted(async () => {
  const status = await get<SetupStatus>('/api/v1/setup/status')
  if (status.initialized) await router.replace('/')
})

async function submit() {
  loading.value = true; error.value = ''
  try {
    await post('/api/v1/setup/initialize', form, false)
    resetCsrf()
    await router.replace('/app')
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
</script>

<template>
  <AuthLayout eyebrow="首次部署" title="创建实例管理员" description="第一个邮箱账号将成为实例管理员，无需邮件验证。">
    <v-form class="auth-form-stack" @submit.prevent="submit">
      <div class="auth-notice">首个管理员邮箱无需验证，创建后会直接进入工作区。</div>
      <v-text-field v-model="form.email" class="auth-field" label="管理员邮箱" type="email" autocomplete="email" variant="outlined" density="compact" required />
      <v-text-field v-model="form.workspaceName" class="auth-field" label="首个工作区名称" autocomplete="organization" variant="outlined" density="compact" required />
      <v-text-field v-model="form.password" class="auth-field" label="密码" type="password" autocomplete="new-password" hint="至少 12 位" persistent-hint variant="outlined" density="compact" required />
      <v-text-field v-model="form.passwordConfirmation" class="auth-field" label="确认密码" type="password" autocomplete="new-password" variant="outlined" density="compact" required />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="auth-alert">{{ error }}</v-alert>
      <v-btn type="submit" class="auth-primary" size="large" block :loading="loading" :disabled="form.password.length < 12 || form.password !== form.passwordConfirmation">创建并进入</v-btn>
    </v-form>
  </AuthLayout>
</template>
