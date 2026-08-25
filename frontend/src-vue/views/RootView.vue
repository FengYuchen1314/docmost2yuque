<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import type { SetupStatus } from '../../src/types'
import { get } from '../services/api'
import { useSessionStore } from '../stores/session'

const router = useRouter(); const session = useSessionStore(); const failed = ref(false)
onMounted(async () => {
  try {
    const setup = await get<SetupStatus>('/api/v1/setup/status')
    if (!setup.initialized) return void router.replace('/setup')
    await session.loadUser()
    await router.replace(session.user ? '/app' : '/login')
  } catch { failed.value = true }
})
</script>

<template><main class="d-grid align-center justify-center" style="min-height:100vh"><div class="text-center"><v-progress-circular v-if="!failed" indeterminate color="primary" size="42" /><template v-else><v-icon color="error" size="42">mdi-alert-circle-outline</v-icon><h2 class="mt-4">无法连接服务</h2><v-btn class="mt-3" color="primary" @click="$router.go(0)">重新加载</v-btn></template></div></main></template>
