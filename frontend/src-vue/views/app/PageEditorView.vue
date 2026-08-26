<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import type { CatalogNode, CatalogTree, Comment, Page } from '../../../src/types'
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
interface EditorCatalogEntry { id:string; pageId:string|null; title:string; nodeType:CatalogNode['nodeType']; depth:number }
const route=useRoute();const router=useRouter();const session=useSessionStore();const ui=useUiStore()
const collaboration=usePageCollaboration()
const pageId=computed(()=>String(route.params.pageId));const page=ref<Page|null>(null)
const operationErrors=reactive({load:'',save:''});const error=computed(()=>editorErrorMessage(operationErrors))
const title=ref('');const body=ref('');const loading=ref(true);const status=ref<'saved'|'dirty'|'saving'|'offline'|'conflict'>('saved')
const sidePanel=ref<'comments'|'references'|null>(null);const comments=ref<Comment[]>([]);const commentText=ref('');const publication=ref<PublicationState|null>(null)
const managementOpen=ref(false);const managementTab=ref<PageManagementTab>('PROPERTIES');const analyticsOpen=ref(false);const siblingPages=ref<Page[]>([])
const catalogOpen=ref(false);const catalogQuery=ref('');const catalogTree=ref<CatalogTree|null>(null);const collapsedCatalogIds=ref<string[]>([])
const contentCardOpen=ref(false)
const documentEditor=ref<{focus:()=>void;insertText:(text:string,replaceSlash?:boolean)=>void}|null>(null)
let saveTimer=0;let hydrated=false;let saveInFlight:Promise<void>|null=null;let saveRequested=false;let changeVersion=0;let savedVersion=0;let loadSequence=0
const statusLabel=computed(()=>({saved:'已加载最新版本',dirty:'等待保存',saving:'保存中…',offline:'离线，等待同步',conflict:'版本冲突'}[status.value]))
const collaborationLabel=computed(()=>collaboration.peers.value.length
  ? `${collaboration.peers.value.length + 1} 人`
  : ({idle:'未连接',connecting:'连接中',syncing:'同步中',connected:'在线',reconnecting:'重连中',unavailable:'协作不可用'}[collaboration.status.value]))
const publicationLabel=computed(()=>!publication.value?.published?'发布':publication.value.changedSincePublication?'更新':'已发布')
const wordCount=computed(()=>body.value.replace(/\s/g,'').length)
const pageTypeIcon=computed(()=>page.value?.contentType==='WHITEBOARD'?'mdi-drawing-box':page.value?.contentType==='SPREADSHEET'?'mdi-table-large':page.value?.contentType==='DATABASE'?'mdi-database-outline':'mdi-file-document-outline')
const pageMap=computed(()=>new Map(siblingPages.value.map(value=>[value.id,value])))
const catalogEntries=computed<EditorCatalogEntry[]>(()=>{
  const nodes=catalogTree.value?.nodes??[]
  if(!nodes.length){return siblingPages.value.map(value=>({id:value.id,pageId:value.id,title:value.title||'无标题',nodeType:'DOCUMENT' as const,depth:0})).filter(matchesCatalogQuery)}
  const children=new Map<string|null,CatalogNode[]>()
  for(const node of nodes){const values=children.get(node.parentId)??[];values.push(node);children.set(node.parentId,values)}
  for(const values of children.values())values.sort((left,right)=>left.position.localeCompare(right.position))
  const flattened:EditorCatalogEntry[]=[];const visited=new Set<string>()
  const visit=(parentId:string|null,depth:number)=>{for(const node of children.get(parentId)??[]){if(visited.has(node.id))continue;visited.add(node.id);const linked=node.pageId?pageMap.value.get(node.pageId):null;flattened.push({id:node.id,pageId:node.pageId,title:node.titleOverride||linked?.title||node.url||'无标题',nodeType:node.nodeType,depth});if(catalogQuery.value.trim()||!collapsedCatalogIds.value.includes(node.id))visit(node.id,depth+1)}}
  visit(null,0);for(const node of nodes){if(!visited.has(node.id)){const linked=node.pageId?pageMap.value.get(node.pageId):null;flattened.push({id:node.id,pageId:node.pageId,title:node.titleOverride||linked?.title||node.url||'无标题',nodeType:node.nodeType,depth:0})}}
  return flattened.filter(matchesCatalogQuery)
})
function matchesCatalogQuery(value:{title:string}){const query=catalogQuery.value.trim().toLocaleLowerCase();return !query||value.title.toLocaleLowerCase().includes(query)}
onMounted(()=>{void load();window.addEventListener('online',flushOffline);window.addEventListener('beforeunload',protectUnsavedExit);document.addEventListener('visibilitychange',saveWhenHidden)});watch(pageId,load);watch(collaboration.body,value=>{if(hydrated&&value!==body.value)body.value=value});watch([title,body],()=>{if(!hydrated)return;changeVersion+=1;if(body.value!==collaboration.body.value)collaboration.setBody(body.value);status.value='dirty';window.clearTimeout(saveTimer);saveTimer=window.setTimeout(()=>{void save()},1500)})
onBeforeRouteLeave(async()=>{if(!hasUnsavedChanges())return true;await save();return hasUnsavedChanges()?window.confirm('最后的修改尚未安全保存，确定离开吗？'):true})
onBeforeUnmount(()=>{window.clearTimeout(saveTimer);window.removeEventListener('online',flushOffline);window.removeEventListener('beforeunload',protectUnsavedExit);document.removeEventListener('visibilitychange',saveWhenHidden)})
async function load(){const sequence=++loadSequence;const requestedPageId=pageId.value;loading.value=true;operationErrors.load='';operationErrors.save='';hydrated=false;collaboration.disconnect();try{let value:Page;let cachedMode=false;try{value=await post<Page>('/api/v1/pages/get',{pageId:requestedPageId});void cachePage(session.user!.userId,value)}catch(reason){if(!isNetworkFailure(reason))throw reason;const cached=await readCachedPage(session.user!.userId,requestedPageId);if(!cached)throw reason;value=cached;cachedMode=true}if(sequence!==loadSequence)return;applyPage(value);if(cachedMode)status.value='offline';collaboration.connect({pageId:value.id,initialBody:body.value,userId:session.user!.userId,email:session.user!.email});void post('/api/v1/activities/page-view',{pageId:requestedPageId});if(navigator.onLine){void loadPublication(requestedPageId);void post<Page[]>('/api/v1/pages/list',{knowledgeBaseId:value.knowledgeBaseId}).then(values=>{if(sequence===loadSequence)siblingPages.value=values});void post<CatalogTree>('/api/v1/catalog/list',{knowledgeBaseId:value.knowledgeBaseId}).then(value=>{if(sequence===loadSequence)catalogTree.value=value}).catch(()=>{if(sequence===loadSequence)catalogTree.value=null})}}catch(value){if(sequence===loadSequence)operationErrors.load=messageOf(value)}finally{if(sequence===loadSequence){loading.value=false;queueMicrotask(()=>{if(sequence===loadSequence)hydrated=true})}}}
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
async function loadPublication(requestedPageId=pageId.value){const value=await post<PublicationState>('/api/v1/pages/publication-state',{pageId:requestedPageId});if(pageId.value===requestedPageId)publication.value=value}
async function openCatalogEntry(entry:EditorCatalogEntry){if(entry.nodeType==='GROUP'){collapsedCatalogIds.value=collapsedCatalogIds.value.includes(entry.id)?collapsedCatalogIds.value.filter(value=>value!==entry.id):[...collapsedCatalogIds.value,entry.id];return}if(!entry.pageId||!page.value||entry.pageId===pageId.value)return;await router.push(`/app/kb/${page.value.knowledgeBaseId}/pages/${entry.pageId}`)}
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
    <header class="editor-header">
      <div class="editor-header-left">
        <v-btn class="header-icon" icon="mdi-arrow-left" variant="text" size="small" title="返回知识库" aria-label="返回知识库" @click="router.push(`/app/kb/${page?.knowledgeBaseId||route.params.knowledgeBaseId}`)" />
        <v-btn class="header-icon catalog-header-toggle" :icon="catalogOpen?'mdi-menu-open':'mdi-menu'" variant="text" size="small" :title="catalogOpen?'收起目录':'展开目录'" aria-label="知识库目录" @click="catalogOpen=!catalogOpen" />
        <v-icon class="page-type-icon" color="primary" size="23">{{pageTypeIcon}}</v-icon>
        <input v-if="page?.contentType!=='DOCUMENT'" v-model="title" class="structured-title-input" placeholder="无标题" aria-label="文稿标题" />
        <span v-else class="header-document-title" :title="title">{{title||'无标题'}}</span>
        <v-icon class="document-lock" icon="mdi-lock-outline" size="14" title="仅协作者可编辑" />
      </div>

      <div class="editor-header-status" :class="`status-${status}`" :title="statusLabel">
        <v-icon :icon="status==='saved'?'mdi-check-circle-outline':status==='saving'?'mdi-loading':status==='conflict'?'mdi-alert-circle-outline':'mdi-cloud-sync-outline'" :class="{'mdi-spin':status==='saving'}" size="16" />
        <span>{{statusLabel}}</span>
        <v-icon icon="mdi-cloud-check-outline" size="17" />
      </div>

      <div class="editor-header-actions">
        <v-tooltip :text="collaboration.error.value || `实时协作：${collaborationLabel}`">
          <template #activator="{ props: tooltipProps }"><button v-bind="tooltipProps" type="button" class="collaboration-state"><v-icon icon="mdi-account-multiple-outline" size="16" /><span>{{collaborationLabel}}</span></button></template>
        </v-tooltip>
        <v-btn v-if="page?.contentType==='DOCUMENT'" class="header-icon d-none d-sm-inline-flex" icon="mdi-cards-outline" variant="text" size="small" title="插入内容" aria-label="插入内容" @click="contentCardOpen=true" />
        <v-btn class="header-icon" icon="mdi-comment-text-outline" variant="text" size="small" title="评论" aria-label="评论" @click="openComments" />
        <v-btn class="header-icon d-none d-sm-inline-flex" icon="mdi-vector-link" variant="text" size="small" title="引用" aria-label="引用" @click="openReferences" />
        <v-btn class="share-button" prepend-icon="mdi-share-variant-outline" variant="outlined" size="small" @click="openManagement('SHARE')">分享</v-btn>
        <v-btn class="publish-button" color="success" variant="flat" size="small" @click="openManagement('PUBLISH')">{{publicationLabel}}</v-btn>
        <v-menu location="bottom end">
          <template #activator="{props}"><v-btn v-bind="props" class="header-icon" icon="mdi-dots-horizontal" variant="text" size="small" title="更多" aria-label="更多操作" /></template>
          <v-list class="editor-more-menu" density="compact">
            <v-list-item prepend-icon="mdi-tune-variant" title="文档设置" @click="openManagement('PROPERTIES')" />
            <v-list-item prepend-icon="mdi-account-lock-outline" title="协作者权限" @click="openManagement('PERMISSIONS')" />
            <v-list-item prepend-icon="mdi-history" title="版本历史" @click="openManagement('HISTORY')" />
            <v-list-item prepend-icon="mdi-paperclip" title="附件" @click="openManagement('ATTACHMENTS')" />
            <v-list-item prepend-icon="mdi-chart-box-outline" title="内容统计" @click="analyticsOpen=true" />
          </v-list>
        </v-menu>
      </div>
    </header>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="editor-progress"/>
    <div v-if="error" class="editor-error" role="alert"><v-icon icon="mdi-alert-circle" size="20" /><span>{{error}}</span></div>

    <aside v-if="catalogOpen" class="editor-catalog" aria-label="知识库目录">
      <div class="catalog-heading"><strong>目录</strong><span>{{catalogEntries.length}}</span><v-spacer/><v-btn icon="mdi-close" variant="text" size="x-small" aria-label="收起目录" @click="catalogOpen=false" /></div>
      <label class="catalog-search"><v-icon icon="mdi-magnify" size="17"/><input v-model="catalogQuery" placeholder="搜索文档" aria-label="搜索目录"/><kbd>⌘ K</kbd></label>
      <nav class="catalog-list">
        <button
          v-for="entry in catalogEntries"
          :key="entry.id"
          type="button"
          class="catalog-row"
          :class="{active:entry.pageId===pageId,group:entry.nodeType==='GROUP'}"
          :style="{'--catalog-indent':`${Math.min(entry.depth,5)*18}px`}"
          :disabled="entry.nodeType!=='GROUP'&&!entry.pageId"
          @click="openCatalogEntry(entry)"
        >
          <v-icon :icon="entry.nodeType==='GROUP'?(collapsedCatalogIds.includes(entry.id)?'mdi-chevron-right':'mdi-chevron-down'):entry.nodeType==='LINK'?'mdi-link-variant':pageMap.get(entry.pageId||'')?.contentType==='WHITEBOARD'?'mdi-drawing-box':pageMap.get(entry.pageId||'')?.contentType==='SPREADSHEET'?'mdi-table-large':pageMap.get(entry.pageId||'')?.contentType==='DATABASE'?'mdi-database-outline':'mdi-file-document-outline'" size="17" />
          <span>{{entry.title}}</span>
          <v-icon v-if="entry.pageId===pageId" icon="mdi-circle-small" size="18" />
        </button>
        <div v-if="!catalogEntries.length" class="catalog-empty">没有匹配的文档</div>
      </nav>
    </aside>

    <button v-if="!catalogOpen&&!loading" type="button" class="catalog-edge-trigger" aria-label="展开目录" title="展开目录" @click="catalogOpen=true"><v-icon icon="mdi-menu" size="18" /></button>

    <div v-if="page&&!loading" class="editor-content" :class="{ 'editor-content--structured': page.contentType !== 'DOCUMENT' }">
      <DocumentEditor v-if="page.contentType==='DOCUMENT'" ref="documentEditor" v-model="body" :title="title" :document-settings="page.documentSettings" @update:title="title=$event" @blur="save" @selection-change="collaboration.broadcastSelection" />
      <StructuredEditor v-else :type="page.contentType" v-model="body" />
    </div>
    <div v-if="page?.contentType==='DOCUMENT'&&!loading" class="editor-word-count">字数 {{wordCount}}</div>
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
.editor-page{position:relative;display:flex;height:100dvh;min-height:0;flex-direction:column;overflow:hidden;background:#fff;color:#262626}.editor-header{position:relative;z-index:40;display:grid;height:52px;min-height:52px;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;border-bottom:1px solid #f0f0f0;background:#fff;padding:0 14px}.editor-header-left,.editor-header-actions{display:flex;min-width:0;align-items:center}.editor-header-left{justify-self:start;gap:3px}.editor-header-actions{justify-self:end;gap:4px}.header-icon{color:#262626!important}.header-icon :deep(.v-btn__overlay){background:#e7e9e8}.page-type-icon{margin:0 8px 0 4px}.header-document-title{overflow:hidden;max-width:min(360px,28vw);font-size:14px;font-weight:600;text-overflow:ellipsis;white-space:nowrap}.structured-title-input{width:min(360px,28vw);height:32px;border:0;outline:0;background:transparent;color:#262626;font-size:15px;font-weight:600}.document-lock{margin-left:7px;color:#a6aaa8}.editor-header-status{display:flex;height:28px;align-items:center;gap:5px;justify-self:center;color:#00a870;font-size:12px;white-space:nowrap}.editor-header-status.status-dirty,.editor-header-status.status-saving{color:#8a8f8d}.editor-header-status.status-offline{color:#d97904}.editor-header-status.status-conflict{color:#d33b35}.collaboration-state{display:flex;height:30px;align-items:center;gap:4px;border:0;border-radius:4px;background:transparent;color:#8a8f8d;font:12px/1 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;cursor:pointer}.collaboration-state:hover{background:#f0f1f0;color:#262626}.share-button,.publish-button{height:32px!important;min-width:60px!important;border-radius:5px!important;font-weight:500;letter-spacing:0!important;text-transform:none!important}.share-button{border-color:#d8dad9!important;background:#fff!important;color:#262626!important}.publish-button{background:#00b96b!important}.editor-more-menu{min-width:196px!important}.editor-progress{position:absolute!important;top:51px;right:0;left:0;z-index:42}.editor-error{position:absolute;top:106px;right:24px;left:24px;z-index:35;display:flex;min-height:44px;align-items:center;gap:10px;border:1px solid #ffd6d2;border-radius:6px;background:#fff1f0;color:#d33b35;padding:10px 14px;font-size:14px}.editor-content{flex:1 1 auto;min-height:0;overflow:hidden}.editor-content--structured{overflow:hidden}.editor-catalog{position:absolute;top:52px;bottom:0;left:0;z-index:32;display:flex;width:268px;flex-direction:column;border-right:1px solid #e7e9e8;background:#fff;box-shadow:8px 0 22px rgba(0,0,0,.04);padding:12px 8px}.catalog-heading{display:flex;height:34px;align-items:center;padding:0 6px;font-size:14px}.catalog-heading strong{font-weight:650}.catalog-heading>span{margin-left:7px;color:#b0b4b2;font-size:12px}.catalog-search{display:flex;height:32px;align-items:center;gap:7px;margin:7px 4px 10px;border:1px solid #e0e2e1;border-radius:5px;background:#f7f8f8;padding:0 8px;color:#8a8f8d}.catalog-search:focus-within{border-color:#8cb2f3;background:#fff;box-shadow:0 0 0 2px rgba(47,111,235,.08)}.catalog-search input{min-width:0;flex:1;border:0;outline:0;background:transparent;color:#262626;font-size:13px}.catalog-search kbd{color:#b0b4b2;font:11px/1 sans-serif}.catalog-list{min-height:0;flex:1;overflow:auto;padding:2px 0}.catalog-row{display:flex;width:100%;height:34px;align-items:center;gap:7px;border:0;border-radius:4px;background:transparent;color:#585a59;padding:0 7px 0 calc(8px + var(--catalog-indent));font:13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif;text-align:left;cursor:pointer}.catalog-row>span{overflow:hidden;flex:1;text-overflow:ellipsis;white-space:nowrap}.catalog-row:hover{background:#f2f3f3;color:#262626}.catalog-row.active{background:#eaf1ff;color:#245bc3}.catalog-row.group{font-weight:600}.catalog-row:disabled{cursor:default;opacity:1}.catalog-empty{padding:38px 12px;color:#b0b4b2;font-size:13px;text-align:center}.catalog-edge-trigger{position:absolute;top:108px;left:8px;z-index:23;display:grid;width:30px;height:30px;place-items:center;border:0;border-radius:4px;background:#fff;color:#8a8f8d;cursor:pointer}.catalog-edge-trigger:hover{background:#f0f1f0;color:#262626}.editor-word-count{position:fixed;bottom:5px;left:7px;z-index:20;color:#a6aaa8;font-size:12px;pointer-events:none}
@media(max-width:900px){.editor-header{grid-template-columns:minmax(0,1fr) auto}.editor-header-status{display:none}.header-document-title{max-width:22vw}.collaboration-state span{display:none}.editor-catalog{width:min(82vw,300px)}}
@media(max-width:600px){.editor-header{padding:0 5px}.catalog-header-toggle,.document-lock,.share-button :deep(.v-btn__prepend),.collaboration-state{display:none!important}.page-type-icon{margin-right:4px}.header-document-title{max-width:24vw}.share-button,.publish-button{min-width:48px!important;padding:0 8px!important}.editor-header-actions{gap:0}.editor-error{right:10px;left:10px}.catalog-edge-trigger{left:3px}}
</style>
