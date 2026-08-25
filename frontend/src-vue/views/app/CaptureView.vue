<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
const route=useRoute();const router=useRouter();const session=useSessionStore();const saving=ref(false);const error=ref('')
const content=computed(()=>[route.query.title,route.query.text,route.query.url].filter(Boolean).join('\n').trim())
onMounted(()=>{if(!content.value)void router.replace('/app/notes')})
async function save(){if(!session.activeWorkspace?.id)return;saving.value=true;try{await post('/api/v1/quick-notes/create',{workspaceId:session.activeWorkspace.id,content:{type:'doc',content:[{type:'paragraph',text:content.value}]},plainText:content.value,source:'HOME',clientRequestId:String(route.query.idempotencyKey??crypto.randomUUID()),tagIds:[]});await router.replace('/app/notes')}catch(value){error.value=messageOf(value)}finally{saving.value=false}}
</script>
<template><div class="page-shell"><header class="page-heading"><div><h1>保存分享内容</h1><p>检查来自浏览器或系统分享菜单的内容。</p></div></header><v-card class="section-card pa-6" max-width="760"><v-textarea :model-value="content" label="待保存内容" rows="10" readonly/><v-alert v-if="error" type="error" variant="tonal" class="my-4">{{error}}</v-alert><div class="d-flex justify-end ga-3 mt-5"><v-btn to="/app/notes" variant="text">取消</v-btn><v-btn color="primary" :loading="saving" @click="save">保存为小记</v-btn></div></v-card></div></template>
