<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Page } from '../../../src/types'
import { messageOf, post } from '../../services/api'
const route=useRoute();const router=useRouter();const error=ref('')
onMounted(async()=>{try{const page=await post<Page>('/api/v1/pages/get',{pageId:String(route.params.pageId)});await router.replace({path:`/app/kb/${page.knowledgeBaseId}/pages/${page.id}`,query:route.query})}catch(value){error.value=messageOf(value)}})
</script>
<template><div class="page-shell"><div v-if="!error" class="empty-state"><v-progress-circular indeterminate color="primary"/></div><v-alert v-else type="error" variant="tonal">{{error}}<v-btn to="/app" variant="text">返回工作台</v-btn></v-alert></div></template>
