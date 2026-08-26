<script setup lang="ts">
import { onMounted } from 'vue'
import { useSessionStore } from '../stores/session'

const session = useSessionStore()
onMounted(() => session.loadUser())
</script>

<template>
  <div class="public-shell">
    <header class="public-header">
      <router-link to="/explore" class="public-brand" aria-label="知序首页">
        <span class="public-mark"><v-icon icon="mdi-book-open-page-variant-outline" size="20" /></span>
        <strong>知序</strong>
      </router-link>
      <nav class="public-nav">
        <v-btn to="/explore" variant="text" size="small" prepend-icon="mdi-compass-outline">发现</v-btn>
        <v-btn v-if="session.user" to="/app" variant="outlined" size="small">进入工作区</v-btn>
        <v-btn v-else to="/login" color="success" variant="flat" size="small">登录</v-btn>
      </nav>
    </header>
    <main class="public-main"><slot /></main>
  </div>
</template>

<style scoped>
.public-shell{min-height:100dvh;background:#fff;color:#262626}.public-header{position:sticky;top:0;z-index:50;display:flex;height:56px;align-items:center;border-bottom:1px solid #f0f0f0;background:rgba(255,255,255,.96);padding:0 24px;backdrop-filter:blur(12px)}.public-brand{display:flex;align-items:center;gap:9px;color:#262626;text-decoration:none}.public-brand strong{font-size:16px;font-weight:650}.public-mark{display:grid;width:30px;height:30px;place-items:center;border-radius:6px;background:#00b96b;color:#fff}.public-nav{display:flex;align-items:center;gap:5px;margin-left:auto}.public-nav :deep(.v-btn){height:32px;border-radius:5px;letter-spacing:0;text-transform:none}.public-nav :deep(.v-btn--variant-outlined){border-color:#d8dad9}.public-nav :deep(.bg-success){background:#00b96b!important}.public-main{min-height:calc(100dvh - 56px)}
@media(max-width:600px){.public-header{padding:0 12px}.public-nav .v-btn:first-child{display:none}.public-brand strong{font-size:15px}}
</style>
