<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { createUuid } from '../../utils/uuid'
const route=useRoute();const router=useRouter();const session=useSessionStore();const saving=ref(false);const error=ref('')
const content=computed(()=>[route.query.title,route.query.text,route.query.url].filter(Boolean).join('\n').trim())
onMounted(()=>{if(!content.value)void router.replace('/app/notes')})
async function save(){if(!session.activeWorkspace?.id)return;saving.value=true;try{await post('/api/v1/quick-notes/create',{workspaceId:session.activeWorkspace.id,content:{type:'doc',content:[{type:'paragraph',text:content.value}]},plainText:content.value,source:'HOME',clientRequestId:String(route.query.idempotencyKey??createUuid()),tagIds:[]});await router.replace('/app/notes')}catch(value){error.value=messageOf(value)}finally{saving.value=false}}
</script>
<template>
  <main class="capture-page">
    <header class="capture-header">
      <div><h1>收集到小记</h1><p>保存来自剪藏工具或系统分享菜单的内容。</p></div>
      <v-btn to="/app/notes" icon="mdi-close" size="small" variant="text" aria-label="取消收集" />
    </header>

    <section class="capture-stage" aria-labelledby="capture-title">
      <div class="source-line"><span><v-icon size="18">{{ route.query.url ? 'mdi-web' : 'mdi-share-variant-outline' }}</v-icon></span><div><strong>{{ route.query.url ? '网页剪藏' : '分享内容' }}</strong><small>将保存到当前工作区的小记</small></div></div>
      <div class="capture-sheet">
        <div class="sheet-label" id="capture-title">待保存内容</div>
        <pre>{{ content }}</pre>
      </div>
      <v-alert v-if="error" type="error" variant="tonal" density="compact" class="capture-error">{{ error }}</v-alert>
      <footer class="capture-actions"><span>保存后可在小记中继续编辑和添加标签。</span><div><v-btn to="/app/notes" variant="text" :disabled="saving">取消</v-btn><v-btn color="primary" :loading="saving" :disabled="!content" @click="save">保存为小记</v-btn></div></footer>
    </section>
  </main>
</template>

<style scoped>
.capture-page { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.capture-page :deep(.v-btn) { text-transform: none; letter-spacing: 0; }
.capture-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.capture-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.capture-header p { margin: 1px 0 0; color: #949a97; font-size: 12px; }
.capture-stage { width: min(720px, calc(100% - 40px)); margin: 42px auto 0; }
.source-line { margin-bottom: 14px; display: flex; align-items: center; gap: 10px; }
.source-line > span { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; color: #2470dc; background: #eef4ff; }
.source-line > div { display: grid; }
.source-line strong { color: #343936; font-size: 14px; font-weight: 600; }
.source-line small { margin-top: 1px; color: #979d9a; font-size: 11px; }
.capture-sheet { overflow: hidden; border: 1px solid #dfe3e1; border-radius: 9px; background: #fff; box-shadow: 0 3px 14px rgba(33, 42, 37, .04); }
.sheet-label { height: 38px; padding: 0 14px; border-bottom: 1px solid #eef0ef; display: flex; align-items: center; color: #7d8581; background: #fafbfa; font-size: 12px; }
.capture-sheet pre { min-height: 210px; max-height: 48vh; margin: 0; padding: 16px; overflow: auto; color: #343936; font: inherit; font-size: 14px; line-height: 1.75; white-space: pre-wrap; overflow-wrap: anywhere; }
.capture-error { margin-top: 12px; }
.capture-actions { min-height: 62px; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.capture-actions > span { color: #999f9c; font-size: 12px; }
.capture-actions > div { display: flex; align-items: center; gap: 5px; }
@media (max-width: 680px) { .capture-page { margin: -16px; } .capture-header { padding: 0 18px; } .capture-stage { margin-top: 24px; } .capture-actions { align-items: flex-end; flex-direction: column; } }
</style>
