<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { Comment, Page } from '../../../src/types'
import DocumentEditor from '../../components/editors/DocumentEditor.vue'
import StructuredEditor from '../../components/editors/StructuredEditor.vue'
import AnalyticsDialog from '../../components/AnalyticsDialog.vue'
import { ContentCardPalette } from '../../components/content-cards'
import type { ContentCardCreateEvent, ContentCardUploadHandler } from '../../types/content-card'
import PageManagementDialog from '../../components/PageManagementDialog.vue'
import ReferencePanel from '../../components/ReferencePanel.vue'
import type { PageManagementTab } from '../../components/page-management/types'
import { ApiError, messageOf, post, upload } from '../../services/api'
import { usePageCollaboration } from '../../composables/usePageCollaboration'
import { cachePage, flushPageUpdates, isNetworkFailure, optimisticPage, queuePageUpdate, readCachedPage, toPendingPageUpdate, type PendingPageUpdate } from '../../../src/lib/offline'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { clearSuccessfulSaveError, editorErrorMessage } from '../../utils/editorErrors'

interface CommentPage { items: Comment[]; nextOffset: number; hasMore: boolean }
interface PublicationState { published: boolean; changedSincePublication: boolean; publicationId?: string | null }
interface UploadedAttachment { id:string; originalName:string; mediaType:string; sizeBytes:number; contentUrl:string }
const route=useRoute();const router=useRouter();const session=useSessionStore();const ui=useUiStore()
const collaboration=usePageCollaboration()
const pageId=computed(()=>String(route.params.pageId));const page=ref<Page|null>(null)
const operationErrors=reactive({load:'',save:''});const error=computed(()=>editorErrorMessage(operationErrors))
const title=ref('');const body=ref('');const loading=ref(true);const status=ref<'saved'|'dirty'|'saving'|'offline'|'conflict'>('saved')
const sidePanel=ref<'comments'|'references'|null>(null);const comments=ref<Comment[]>([]);const commentText=ref('');const publication=ref<PublicationState|null>(null)
const managementOpen=ref(false);const managementTab=ref<PageManagementTab>('PROPERTIES');const analyticsOpen=ref(false);const siblingPages=ref<Page[]>([])
const contentCardOpen=ref(false)
const documentEditor=ref<{focus:()=>void;insertText:(text:string,replaceSlash?:boolean)=>void}|null>(null)
let saveTimer=0;let hydrated=false;let saveInFlight:Promise<void>|null=null;let saveRequested=false;let changeVersion=0;let savedVersion=0
const statusLabel=computed(()=>({saved:'已保存',dirty:'等待保存',saving:'保存中…',offline:'离线，等待同步',conflict:'版本冲突'}[status.value]))
const collaborationLabel=computed(()=>collaboration.peers.value.length
  ? `${collaboration.peers.value.length + 1} 人`
  : ({idle:'未连接',connecting:'连接中',syncing:'同步中',connected:'在线',reconnecting:'重连中',unavailable:'协作不可用'}[collaboration.status.value]))
const collaborationColor=computed(()=>collaboration.status.value==='connected'?'success':collaboration.status.value==='unavailable'?'error':'warning')
onMounted(()=>{void load();window.addEventListener('online',flushOffline);window.addEventListener('beforeunload',protectUnsavedExit);document.addEventListener('visibilitychange',saveWhenHidden)});watch(pageId,load);watch(collaboration.body,value=>{if(hydrated&&value!==body.value)body.value=value});watch([title,body],()=>{if(!hydrated)return;changeVersion+=1;if(body.value!==collaboration.body.value)collaboration.setBody(body.value);status.value='dirty';window.clearTimeout(saveTimer);saveTimer=window.setTimeout(()=>{void save()},1500)})
onBeforeRouteLeave(async()=>{if(!hasUnsavedChanges())return true;await save();return hasUnsavedChanges()?window.confirm('最后的修改尚未安全保存，确定离开吗？'):true})
onBeforeUnmount(()=>{window.clearTimeout(saveTimer);window.removeEventListener('online',flushOffline);window.removeEventListener('beforeunload',protectUnsavedExit);document.removeEventListener('visibilitychange',saveWhenHidden)})
async function load(){loading.value=true;operationErrors.load='';operationErrors.save='';hydrated=false;collaboration.disconnect();try{let value:Page;let cachedMode=false;try{value=await post<Page>('/api/v1/pages/get',{pageId:pageId.value});void cachePage(session.user!.userId,value)}catch(reason){if(!isNetworkFailure(reason))throw reason;const cached=await readCachedPage(session.user!.userId,pageId.value);if(!cached)throw reason;value=cached;cachedMode=true}applyPage(value);if(cachedMode)status.value='offline';collaboration.connect({pageId:value.id,initialBody:body.value,userId:session.user!.userId,email:session.user!.email});void post('/api/v1/activities/page-view',{pageId:pageId.value});if(navigator.onLine){void loadPublication();void post<Page[]>('/api/v1/pages/list',{knowledgeBaseId:value.knowledgeBaseId}).then(values=>{siblingPages.value=values})}}catch(value){operationErrors.load=messageOf(value)}finally{loading.value=false;queueMicrotask(()=>hydrated=true)}}
function applyPage(value:Page){page.value=value;title.value=value.title;body.value=value.contentType==='DOCUMENT'?(value.plainText||documentText(value.content)):JSON.stringify(value.content??{},null,0);changeVersion=0;savedVersion=0;saveRequested=false;status.value='saved'}
function contentPayload(text=body.value){if(page.value?.contentType==='DOCUMENT')return documentContent(text);try{return JSON.parse(text)}catch{return page.value?.content??{}}}
function hasUnsavedChanges(){return status.value==='dirty'||status.value==='saving'||changeVersion>savedVersion}
function protectUnsavedExit(event:BeforeUnloadEvent){if(!hasUnsavedChanges())return;event.preventDefault();event.returnValue=''}
function saveWhenHidden(){if(document.visibilityState==='hidden'&&hasUnsavedChanges())void save()}
function save(){window.clearTimeout(saveTimer);saveRequested=true;if(!saveInFlight)saveInFlight=drainSaves().finally(()=>{saveInFlight=null});return saveInFlight}
async function drainSaves(){while(saveRequested&&page.value){saveRequested=false;const version=changeVersion;await performSave(version);if(status.value==='conflict'||(status.value==='dirty'&&!saveRequested))break;if(changeVersion>version)saveRequested=true}}
async function performSave(version:number){if(!page.value)return;status.value='saving';const snapshot={title:title.value.trim()||'无标题',body:body.value};const pending=toPendingPageUpdate(session.user!.userId,page.value,snapshot);pending.content=contentPayload(snapshot.body);const payload={pageId:pending.pageId,expectedRevision:pending.expectedRevision,title:pending.title,content:pending.content,revisionKind:'AUTO'};if(!navigator.onLine){const queued=await queuePageUpdate(pending);page.value=optimisticPage(page.value,queued);savedVersion=Math.max(savedVersion,version);clearSuccessfulSaveError(operationErrors);status.value='offline';if(changeVersion>version)saveRequested=true;return}try{const saved=await post<Page>('/api/v1/pages/update',payload);page.value=saved;savedVersion=Math.max(savedVersion,version);clearSuccessfulSaveError(operationErrors);void cachePage(session.user!.userId,saved);if(changeVersion>version){status.value='dirty';saveRequested=true}else status.value='saved'}catch(value){if(value instanceof ApiError&&value.problem.code==='PAGE_REVISION_CONFLICT'){status.value='conflict'}else if(isNetworkFailure(value)){const queued=await queuePageUpdate(pending);page.value=optimisticPage(page.value,queued);savedVersion=Math.max(savedVersion,version);clearSuccessfulSaveError(operationErrors);status.value='offline';if(changeVersion>version)saveRequested=true}else{status.value='dirty';operationErrors.save=messageOf(value)}}}
async function flushOffline(){if(!session.user)return;const result=await flushPageUpdates(session.user.userId,sendPending);if(result.conflictPageIds.includes(pageId.value))status.value='conflict';else if(result.remaining===0&&status.value==='offline'){const refreshed=await post<Page>('/api/v1/pages/get',{pageId:pageId.value});applyPage(refreshed)}}
function sendPending(update:PendingPageUpdate){return post<Page>('/api/v1/pages/update',{pageId:update.pageId,expectedRevision:update.expectedRevision,title:update.title,content:update.content,revisionKind:'AUTO'})}
async function reloadRemote(){await load();ui.notify('已加载服务端版本')}
async function overwriteRemote(){if(!page.value)return;const remote=await post<Page>('/api/v1/pages/get',{pageId:page.value.id});page.value={...page.value,draftRevision:remote.draftRevision};status.value='dirty';await save()}
async function loadPublication(){publication.value=await post('/api/v1/pages/publication-state',{pageId:pageId.value})}
async function openComments(){sidePanel.value='comments';await loadComments()}
function openReferences(){sidePanel.value='references'}
async function openManagement(tab:PageManagementTab){if(!page.value)return;if(!navigator.onLine){ui.notify('离线时不能打开管理功能，请联网后重试','warning');return}window.clearTimeout(saveTimer);if(status.value==='dirty'||status.value==='saving')await save();if(status.value!=='saved'){ui.notify('请先解决保存或版本冲突','warning');return}managementTab.value=tab;managementOpen.value=true}
function managementUpdated(updated:Page,resetEditorBody=false){const resume=hydrated;hydrated=false;if(resetEditorBody){applyPage(updated);collaboration.setBody(body.value)}else{page.value=updated;title.value=updated.title;status.value='saved'}void cachePage(session.user!.userId,updated);queueMicrotask(()=>{hydrated=resume})}
async function managementDeleted(){if(page.value)await router.replace(`/app/kb/${page.value.knowledgeBaseId}`)}
function insertReference(value:{token:string}){documentEditor.value?.insertText(value.token);sidePanel.value=null;ui.notify('引用已插入')}
function insertContentCard(value:ContentCardCreateEvent){documentEditor.value?.insertText(value.token);ui.notify('内容卡片已插入')}
const uploadContentCard:ContentCardUploadHandler=async(file)=>{if(!page.value)throw new Error('文稿尚未加载');if(file.size>50*1024*1024)throw new Error('单个文件不能超过 50 MB');const form=new FormData();form.append('pageId',page.value.id);form.append('file',file);const attachment=await upload<UploadedAttachment>('/api/v1/attachments/upload',form);return{url:attachment.contentUrl,name:attachment.originalName,size:attachment.sizeBytes,mimeType:attachment.mediaType}}
async function loadComments(){comments.value=(await post<CommentPage>('/api/v1/comments/page',{pageId:pageId.value,limit:50,offset:0})).items}
async function addComment(){if(!page.value||!commentText.value.trim())return;await post('/api/v1/comments/create',{workspaceId:page.value.workspaceId,pageId:page.value.id,parentId:null,anchor:{type:'PAGE'},body:{type:'doc',content:[{type:'paragraph',text:commentText.value.trim()}]},plainText:commentText.value.trim(),mentions:[]});commentText.value='';await loadComments()}
async function resolveComment(comment:Comment){await post('/api/v1/comments/resolve',{commentId:comment.id,resolved:comment.status!=='RESOLVED'});await loadComments()}
function documentText(content:unknown):string{if(!content||typeof content!=='object')return'';const node=content as {text?:string;content?:unknown[];type?:string};if(node.text)return node.text;return(node.content??[]).map(documentText).join(node.type==='doc'?'\n':'')}
function documentContent(text:string){return{type:'doc',content:[{type:'paragraph',text}]}}
</script>

<template>
  <div class="editor-page">
    <v-toolbar color="surface" flat border="bottom" height="64" class="editor-header px-2">
      <v-btn icon="mdi-arrow-left" variant="text" @click="router.push(`/app/kb/${page?.knowledgeBaseId||route.params.knowledgeBaseId}`)" />
      <v-icon class="ml-1 mr-2" color="primary">{{page?.contentType==='WHITEBOARD'?'mdi-drawing-box':page?.contentType==='SPREADSHEET'?'mdi-table-large':page?.contentType==='DATABASE'?'mdi-database-outline':'mdi-file-document-outline'}}</v-icon>
      <v-text-field v-model="title" variant="plain" hide-details class="editor-title" placeholder="无标题" />
      <v-chip :color="status==='saved'?'success':status==='conflict'?'error':status==='offline'?'warning':'primary'" variant="tonal" size="small" class="mr-2"><v-icon start size="14">{{status==='saved'?'mdi-check-circle-outline':status==='saving'?'mdi-loading mdi-spin':status==='conflict'?'mdi-alert-outline':'mdi-cloud-sync-outline'}}</v-icon>{{statusLabel}}</v-chip>
      <v-tooltip :text="collaboration.error.value || `实时协作：${collaborationLabel}`"><template #activator="{ props }"><v-chip v-bind="props" :color="collaborationColor" variant="tonal" size="small" class="mr-2"><v-icon start size="14">mdi-account-multiple-outline</v-icon>{{collaborationLabel}}</v-chip></template></v-tooltip>
      <v-btn v-if="page?.contentType==='DOCUMENT'" icon="mdi-cards-outline" variant="text" title="插入内容卡片" @click="contentCardOpen=true"/><v-btn icon="mdi-comment-text-outline" variant="text" title="评论" @click="openComments"/><v-btn icon="mdi-vector-link" variant="text" title="引用与图谱" @click="openReferences"/><v-btn icon="mdi-share-variant-outline" variant="text" title="分享" @click="openManagement('SHARE')"/><v-btn :color="publication?.published?'success':'primary'" variant="tonal" class="ml-1" @click="openManagement('PUBLISH')">{{publication?.published?'已发布':'发布'}}</v-btn>
      <v-menu><template #activator="{props}"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text"/></template><v-list><v-list-item prepend-icon="mdi-tune-variant" title="属性与标签" @click="openManagement('PROPERTIES')"/><v-list-item prepend-icon="mdi-account-lock-outline" title="协作者权限" @click="openManagement('PERMISSIONS')"/><v-list-item prepend-icon="mdi-history" title="版本历史" @click="openManagement('HISTORY')"/><v-list-item prepend-icon="mdi-paperclip" title="附件" @click="openManagement('ATTACHMENTS')"/><v-list-item prepend-icon="mdi-chart-box-outline" title="内容统计" @click="analyticsOpen=true"/></v-list></v-menu>
    </v-toolbar>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="editor-progress"/>
    <v-alert v-if="error" type="error" variant="tonal" class="editor-error ma-4">{{error}}</v-alert>
    <div v-if="page&&!loading" class="editor-content" :class="{ 'editor-content--structured': page.contentType !== 'DOCUMENT' }"><DocumentEditor v-if="page.contentType==='DOCUMENT'" ref="documentEditor" v-model="body" :document-settings="page.documentSettings" @blur="save" @selection-change="collaboration.broadcastSelection"/><StructuredEditor v-else :type="page.contentType" v-model="body"/></div>
    <v-snackbar :model-value="status==='conflict'" color="error" :timeout="-1" location="bottom"><span>服务端已有新版本，本地修改尚未覆盖。</span><template #actions><v-btn @click="reloadRemote">加载远端</v-btn><v-btn @click="overwriteRemote">保留本地</v-btn></template></v-snackbar>
    <v-navigation-drawer :model-value="Boolean(sidePanel)" location="right" temporary width="420" @update:model-value="value => { if (!value) sidePanel = null }">
      <div class="d-flex align-center pa-4"><h3>{{sidePanel==='comments'?'评论':'引用与知识图谱'}}</h3><v-spacer/><v-btn icon="mdi-close" variant="text" @click="sidePanel=null"/></div><v-divider/>
      <div v-if="sidePanel==='comments'" class="pa-4"><v-textarea v-model="commentText" label="添加评论" rows="3"/><v-btn color="primary" block :disabled="!commentText.trim()" @click="addComment">发表评论</v-btn><v-list lines="three" class="mt-4"><v-list-item v-for="comment in comments" :key="comment.id" :title="comment.creatorEmail" :subtitle="comment.plainText" prepend-icon="mdi-account-circle-outline"><template #append><v-btn :icon="comment.status==='RESOLVED'?'mdi-refresh':'mdi-check'" variant="text" @click="resolveComment(comment)"/></template></v-list-item></v-list></div>
      <ReferencePanel v-else-if="page" :page-id="page.id" :pages="siblingPages" :allow-insert="page.contentType==='DOCUMENT'" initial-tab="OUTGOING" @insert="insertReference" @open-page="sidePanel=null"/>
    </v-navigation-drawer>
    <PageManagementDialog v-if="page" v-model="managementOpen" :page="page" :initial-tab="managementTab" @updated="managementUpdated" @deleted="managementDeleted" @close="loadPublication"/>
    <AnalyticsDialog v-if="page" v-model="analyticsOpen" :page-id="page.id" :title="`${page.title} · 内容统计`"/>
    <ContentCardPalette v-if="page?.contentType==='DOCUMENT'" v-model="contentCardOpen" :upload-handler="uploadContentCard" @insert="insertContentCard"/>
  </div>
</template>

<style scoped>
.editor-page{height:100dvh;min-height:0;display:flex;flex-direction:column;overflow:hidden;background:rgb(var(--v-theme-surface))}.editor-header{flex:0 0 auto;position:sticky!important;top:0;z-index:30}.editor-progress,.editor-error{flex:0 0 auto}.editor-content{flex:1 1 auto;min-height:0;overflow:auto}.editor-content--structured{overflow:hidden}.editor-page :deep(.editor-toolbar){top:64px}.editor-title{font-size:16px;font-weight:650;max-width:min(520px,40vw)}
</style>
