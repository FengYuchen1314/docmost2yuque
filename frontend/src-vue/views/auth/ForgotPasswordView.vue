<script setup lang="ts">
import { reactive, ref } from 'vue'
import AuthLayout from '../../layouts/AuthLayout.vue'
import { messageOf, post } from '../../services/api'

const form = reactive({ email: '', challengeId: '', code: '', password: '', passwordConfirmation: '' })
const step = ref<'email' | 'reset' | 'done'>('email')
const loading = ref(false)
const error = ref('')
async function submit() {
  loading.value = true; error.value = ''
  try {
    if (step.value === 'email') {
      const result = await post<{ challengeId: string }>('/api/v1/auth/password-reset/request', { email: form.email }, false)
      form.challengeId = result.challengeId; step.value = 'reset'
    } else {
      await post('/api/v1/auth/password-reset/complete', { challengeId: form.challengeId, code: form.code, password: form.password, passwordConfirmation: form.passwordConfirmation }, false)
      step.value = 'done'
    }
  } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
</script>

<template>
  <AuthLayout eyebrow="账号恢复" :title="step === 'done' ? '密码已更新' : '重置密码'" :description="step === 'email' ? '验证码会发送到账号邮箱。' : step === 'reset' ? `请输入发送至 ${form.email} 的验证码。` : '现在可以使用新密码登录。'">
    <v-form v-if="step !== 'done'" @submit.prevent="submit">
      <v-text-field v-if="step === 'email'" v-model="form.email" type="email" label="账号邮箱" prepend-inner-icon="mdi-email-outline" required class="mb-4" />
      <template v-else>
        <v-text-field v-model="form.code" label="6 位验证码" maxlength="6" inputmode="numeric" prepend-inner-icon="mdi-shield-key-outline" required class="mb-4" />
        <v-text-field v-model="form.password" type="password" label="新密码" hint="至少 12 位" persistent-hint prepend-inner-icon="mdi-lock-outline" required class="mb-4" />
        <v-text-field v-model="form.passwordConfirmation" type="password" label="确认新密码" prepend-inner-icon="mdi-lock-check-outline" required class="mb-4" />
      </template>
      <v-alert v-if="error" type="error" variant="tonal" class="mb-4">{{ error }}</v-alert>
      <v-btn type="submit" color="primary" size="large" block :loading="loading" :disabled="step === 'reset' && (form.code.length !== 6 || form.password.length < 12 || form.password !== form.passwordConfirmation)">{{ step === 'email' ? '发送验证码' : '更新密码' }}</v-btn>
      <v-btn v-if="step === 'reset'" variant="text" block class="mt-2" @click="step = 'email'">更换邮箱</v-btn>
    </v-form>
    <v-btn v-else to="/login" color="primary" size="large" block>返回登录</v-btn>
    <template #footer>想起密码了？ <router-link to="/login">返回登录</router-link></template>
  </AuthLayout>
</template>
