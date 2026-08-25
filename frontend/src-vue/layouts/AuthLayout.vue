<script setup lang="ts">
defineProps<{ eyebrow: string; title: string; description: string }>()
</script>

<template>
  <main class="auth-canvas">
    <section class="auth-visual">
      <div class="auth-brand"><span class="auth-mark">K</span><span>Knowledge</span></div>
      <div>
        <h1>把团队知识，变成可持续运转的工作系统。</h1>
        <p>文档、数据表、白板、协作和发布集中在一个清晰、可靠的 SaaS 工作区。</p>
      </div>
      <small>安全、自托管、为真正的工作而设计</small>
    </section>
    <section class="auth-panel">
      <div class="auth-form">
        <v-chip color="primary" variant="tonal" size="small" class="mb-4">{{ eyebrow }}</v-chip>
        <h2>{{ title }}</h2>
        <p>{{ description }}</p>
        <slot />
        <div v-if="$slots.footer" class="mt-6 text-medium-emphasis"><slot name="footer" /></div>
      </div>
    </section>
  </main>
</template>
