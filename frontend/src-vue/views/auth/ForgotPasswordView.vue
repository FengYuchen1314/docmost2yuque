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
  <AuthLayout eyebrow="账号恢复" :title="step === 'done' ? '密码已更新' : '重置密码'" :description="step === 'email' ? '通过账号邮箱找回密码' : step === 'reset' ? '输入验证码并设置新密码' : '现在可以使用新密码登录'">
    <v-form v-if="step !== 'done'" class="auth-form-stack" @submit.prevent="submit">
      <v-text-field v-if="step === 'email'" v-model="form.email" class="auth-field" type="email" label="账号邮箱" autocomplete="email" variant="outlined" density="compact" required />
      <template v-else>
        <div class="auth-sent-tip"><span>验证码已发送至 {{ form.email }}</span><button type="button" @click="step = 'email'; form.code = ''">更换邮箱</button></div>
        <v-text-field v-model="form.code" class="auth-field" label="6 位验证码" maxlength="6" inputmode="numeric" autocomplete="one-time-code" variant="outlined" density="compact" required />
        <v-text-field v-model="form.password" class="auth-field" type="password" label="新密码" autocomplete="new-password" hint="至少 12 位" persistent-hint variant="outlined" density="compact" required />
        <v-text-field v-model="form.passwordConfirmation" class="auth-field" type="password" label="确认新密码" autocomplete="new-password" variant="outlined" density="compact" required />
      </template>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="auth-alert">{{ error }}</v-alert>
      <v-btn type="submit" class="auth-primary" size="large" block :loading="loading" :disabled="step === 'reset' && (form.code.length !== 6 || form.password.length < 12 || form.password !== form.passwordConfirmation)">{{ step === 'email' ? '发送验证码' : '更新密码' }}</v-btn>
    </v-form>
    <div v-else class="auth-done">
      <v-icon class="auth-done-icon" size="48">mdi-check-circle-outline</v-icon>
      <p>新密码已生效，请返回登录。</p>
      <v-btn to="/login" class="auth-primary" size="large" block>返回登录</v-btn>
    </div>
    <template #footer>想起密码了？ <router-link to="/login">返回登录</router-link></template>
  </AuthLayout>
</template>
