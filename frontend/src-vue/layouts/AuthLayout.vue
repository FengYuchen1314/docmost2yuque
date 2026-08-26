<script setup lang="ts">
defineProps<{ eyebrow: string; title: string; description: string }>()
</script>

<template>
  <main class="auth-page">
    <header class="auth-brand-header">
      <router-link to="/" class="auth-brand" aria-label="知序首页">
        <span class="auth-brand-mark">知</span>
        <span class="auth-brand-name">知序</span>
      </router-link>
    </header>

    <section class="auth-stage" aria-labelledby="auth-page-title">
      <div class="auth-card">
        <div class="auth-heading">
          <span v-if="eyebrow" class="auth-eyebrow">{{ eyebrow }}</span>
          <h1 id="auth-page-title">{{ title }}</h1>
          <p>{{ description }}</p>
        </div>
        <slot />
        <footer v-if="$slots.footer" class="auth-footer"><slot name="footer" /></footer>
      </div>
    </section>
  </main>
</template>

<style scoped>
.auth-page {
  min-height: 100dvh;
  overflow-x: hidden;
  background: #fff;
  color: #262626;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
}
.auth-brand-header {
  display: flex;
  height: 56px;
  align-items: center;
  border-bottom: 1px solid #f0f0f0;
  background: rgba(255, 255, 255, .96);
  padding: 0 24px;
}
.auth-brand { display: inline-flex; height: 36px; align-items: center; gap: 9px; color: #262626; text-decoration: none; }
.auth-brand-mark {
  display: inline-flex;
  width: 28px;
  height: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  background: #00b96b;
  color: #fff;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}
.auth-brand-name { font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
.auth-stage { display: grid; min-height: calc(100dvh - 56px); place-items: center; padding: 44px 24px 84px; }
.auth-card { width: min(400px, 100%); }
.auth-heading { margin-bottom: 28px; text-align: center; }
.auth-eyebrow { display: block; margin-bottom: 9px; color: #8a8f8d; font-size: 13px; line-height: 20px; }
.auth-heading h1 { margin: 0; color: #262626; font-size: 28px; font-weight: 650; letter-spacing: -.45px; line-height: 40px; }
.auth-heading p { margin: 8px auto 0; color: #8a8f8d; font-size: 14px; line-height: 22px; }
.auth-footer { margin-top: 25px; color: #8a8f8d; font-size: 13px; line-height: 22px; text-align: center; }
.auth-card :deep(a) { color: #00a870; font-weight: 500; text-decoration: none; }
.auth-card :deep(a:hover) { color: #008f5d; text-decoration: underline; }
.auth-card :deep(.auth-form-stack) { display: flex; flex-direction: column; gap: 16px; }
.auth-card :deep(.auth-field) { margin: 0 !important; }
.auth-card :deep(.auth-field .v-field) { min-height: 44px; border-radius: 6px; background: #fff; box-shadow: none; }
.auth-card :deep(.auth-field .v-field__outline) { --v-field-border-opacity: 1; color: #d8dad9; }
.auth-card :deep(.auth-field .v-field--focused .v-field__outline) { color: #00b96b; }
.auth-card :deep(.auth-field .v-field__input) { min-height: 44px; padding-top: 10px; padding-bottom: 8px; font-size: 14px; }
.auth-card :deep(.auth-field .v-label) { color: #8a8f8d; font-size: 14px; }
.auth-card :deep(.auth-field .v-messages) { padding-inline: 1px; color: #8a8f8d; font-size: 12px; }
.auth-card :deep(.auth-primary) {
  height: 44px !important;
  border-radius: 6px !important;
  background: #00b96b !important;
  color: #fff !important;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: 0 !important;
  text-transform: none !important;
}
.auth-card :deep(.auth-primary:hover) { background: #00a870 !important; }
.auth-card :deep(.auth-primary.v-btn--disabled) { background: #b8e9d2 !important; color: #fff !important; opacity: 1; }
.auth-card :deep(.auth-secondary) { min-height: 34px; color: #646a67; font-size: 13px; letter-spacing: 0; text-transform: none; }
.auth-card :deep(.auth-alert) { border-radius: 6px; font-size: 13px; line-height: 20px; }
.auth-card :deep(.auth-mode-tabs) { display: grid; grid-template-columns: 1fr 1fr; margin-bottom: 22px; border-bottom: 1px solid #e7e9e8; }
.auth-card :deep(.auth-mode-tabs button) {
  position: relative;
  height: 38px;
  border: 0;
  background: transparent;
  color: #8a8f8d;
  cursor: pointer;
  font: 14px/38px inherit;
}
.auth-card :deep(.auth-mode-tabs button::after) {
  position: absolute;
  right: 24px;
  bottom: -1px;
  left: 24px;
  height: 2px;
  border-radius: 999px;
  background: transparent;
  content: "";
}
.auth-card :deep(.auth-mode-tabs button.is-active) { color: #262626; font-weight: 600; }
.auth-card :deep(.auth-mode-tabs button.is-active::after) { background: #00b96b; }
.auth-card :deep(.auth-form-meta) { display: flex; min-height: 22px; align-items: center; justify-content: space-between; margin-top: -5px; font-size: 13px; }
.auth-card :deep(.auth-sent-tip), .auth-card :deep(.auth-notice), .auth-card :deep(.auth-invitation-summary) {
  border: 1px solid #dff3e9;
  border-radius: 6px;
  background: #f4fbf7;
  color: #567066;
  padding: 10px 12px;
  font-size: 13px;
  line-height: 20px;
}
.auth-card :deep(.auth-sent-tip) { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.auth-card :deep(.auth-sent-tip button) { border: 0; background: transparent; color: #00a870; cursor: pointer; font: 13px/20px inherit; white-space: nowrap; }
.auth-card :deep(.auth-progress) { margin: 22px auto; }
.auth-card :deep(.auth-done) { display: grid; justify-items: center; gap: 14px; text-align: center; }
.auth-card :deep(.auth-done-icon) { color: #00b96b; }
@media (max-width: 600px) {
  .auth-brand-header { padding: 0 18px; }
  .auth-stage { align-items: start; padding: 48px 22px 60px; }
  .auth-card { width: 100%; }
  .auth-heading { margin-bottom: 24px; }
  .auth-heading h1 { font-size: 26px; }
}
</style>
