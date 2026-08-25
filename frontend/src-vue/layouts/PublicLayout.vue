<script setup lang="ts">
import { onMounted } from 'vue'
import { useSessionStore } from '../stores/session'
const session=useSessionStore();onMounted(()=>session.loadUser())
</script>
<template><div class="public-shell"><v-app-bar color="surface" flat border="bottom"><router-link to="/explore" class="d-flex align-center text-decoration-none text-high-emphasis ml-5"><span class="auth-mark mr-3">K</span><strong>Knowledge</strong></router-link><v-spacer/><v-btn to="/explore" variant="text" prepend-icon="mdi-compass-outline">发现</v-btn><v-btn v-if="session.user" to="/app" color="primary" variant="tonal" class="mr-5">进入工作区</v-btn><v-btn v-else to="/login" color="primary" class="mr-5">登录</v-btn></v-app-bar><v-main><slot/></v-main></div></template>
