<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router'
import type { CatalogNode, CatalogTree, Comment, KnowledgeBase, Page } from '../../../src/types'
import DocumentEditor from '../../components/editors/DocumentEditor.vue'
import type { DocumentContentCardKind } from '../../components/editors/documentEditorCommands'
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
import { documentToMarkdown, isEditableDocument, isPlainTextDocument, markdownToDocument } from '../../utils/documentContent'

interface CommentPage { items: Comment[]; nextOffset: number; hasMore: boolean }
interface PublicationState { published: boolean; changedSincePublication: boolean; publicationId?: string | null }
interface FavoriteState { favorite: boolean }
interface UploadedAttachment { id:string; originalName:string; mediaType:string; sizeBytes:number; contentUrl:string }
interface EditorCatalogEntry { id:string; pageId:string|null; title:string; nodeType:CatalogNode['nodeType']; depth:number; url:string|null }
interface DocumentSelectionContext { text:string; blockIndex:number; blockKind:string; blockStart:number; blockEnd:number; selectionStart:number; selectionEnd:number }
interface EditorTextSelection extends DocumentSelectionContext { pageId:string; workspaceId:string; draftRevision:number; source:string; start:number; end:number }
interface TextRangeAnchor { type:'TEXT_RANGE'; start:number; end:number; quote:string; draftRevision:number }
type CommentAnchor = { type:'PAGE' } | TextRangeAnchor
interface CommentComposerContext { pageId:string; workspaceId:string; source:string|null; anchor:CommentAnchor }
interface DocumentEditorHandle {
  focus:()=>void
  insertText:(text:string,replaceSlash?:boolean)=>boolean
  insertPendingText:(text:string)=>boolean
  cancelPendingInsert:(restore?:boolean)=>void
  capturePendingInsert:()=>boolean
  requestContentCard:(kind?:DocumentContentCardKind|null)=>void
  requestReference:()=>void
  closeOutline:()=>void
}
const route=useRoute();const router=useRouter();const session=useSessionStore();const ui=useUiStore()
const collaboration=usePageCollaboration()
const pageId=computed(()=>String(route.params.pageId));const page=ref<Page|null>(null)
const operationErrors=reactive({load:'',save:''});const error=computed(()=>editorErrorMessage(operationErrors))
const title=ref('');const body=ref('');const loading=ref(true);const status=ref<'saved'|'dirty'|'saving'|'offline'|'conflict'>('saved')
const sidePanel=ref<'comments'|'references'|null>(null);const comments=ref<Comment[]>([]);const commentText=ref('');const commentsLoading=ref(false);const commentsError=ref('');const commentSubmitting=ref(false);const commentComposerOpen=ref(false);const commentComposerContext=ref<CommentComposerContext|null>(null);const commentLaunchContext=ref<CommentComposerContext|null>(null);const editorTextSelection=ref<EditorTextSelection|null>(null);const resolvingCommentIds=ref<string[]>([]);const publication=ref<PublicationState|null>(null)
const managementOpen=ref(false);const managementTab=ref<PageManagementTab>('PROPERTIES');const analyticsOpen=ref(false);const siblingPages=ref<Page[]>([])
const compactViewport=ref(isCompactEditorViewport());const catalogOpen=ref(!compactViewport.value&&localStorage.getItem('editor-catalog-open')!=='false');const catalogQuery=ref('');const catalogTree=ref<CatalogTree|null>(null);const collapsedCatalogIds=ref<string[]>([])
const outlinePanelOpen=ref(false)
const catalogSearchInput=ref<HTMLInputElement|null>(null)
const sidePanelCloseButton=ref<unknown>(null)
const knowledgeBaseQuery=ref('');const knowledgeBaseTab=ref<'personal'|'collaborative'>('personal');const knowledgeBaseMenuOpen=ref(false)
const contentCardOpen=ref(false)
const contentCardKinds=ref<DocumentContentCardKind[]>([])
const contentCardPending=ref(false)
const referenceInsertMode=ref(false)
const referencePending=ref(false)
const favoriteActive=ref(false);const favoritePending=ref(false)
const documentProtected=ref(false);const collaborationEnabledForPage=ref(true);const savedDocumentSource=ref('');const savedDocumentContent=ref<unknown>(null)
const documentEditor=ref<DocumentEditorHandle|null>(null)
let saveTimer=0;let hydrated=false;let saveInFlight:Promise<void>|null=null;let saveRequested=false;let changeVersion=0;let savedVersion=0;let loadSequence=0;let commentSequence=0;let commentSubmitSequence=0;let favoriteSequence=0
let compactMediaQuery:MediaQueryList|null=null
let catalogReturnFocus:HTMLElement|null=null
let sidePanelReturnFocus:HTMLElement|null=null
const statusPresentation=computed(()=>({
  saved:{label:'已保存',icon:'mdi-check-circle-outline'},
  dirty:{label:'未保存',icon:'mdi-circle-medium'},
  saving:{label:'保存中…',icon:'mdi-loading'},
  offline:{label:'已离线保存，待同步',icon:'mdi-cloud-off-outline'},
  conflict:{label:'保存冲突',icon:'mdi-alert-circle-outline'},
}[status.value]))
const statusLabel=computed(()=>statusPresentation.value.label)
const collaborationLabel=computed(()=>{
  if(!collaborationEnabledForPage.value)return'结构保护中'
  if(collaboration.status.value==='unavailable')return'协作不可用'
  if(collaboration.status.value==='connected')return collaboration.peers.value.length?`${collaboration.peers.value.length + 1} 人协作`:'已连接'
  return'连接中'
})
const collaborationTone=computed(()=>!collaborationEnabledForPage.value||collaboration.status.value==='unavailable'
  ? 'unavailable'
  : collaboration.status.value==='connected'?'connected':'connecting')
const publicationLabel=computed(()=>!publication.value?.published?'发布':publication.value.changedSincePublication?'更新':'已发布')
const wordCount=computed(()=>body.value.replace(/\s/g,'').length)
const composerQuote=computed(()=>textRangeQuote(commentComposerContext.value?.anchor))
const currentKnowledgeBase=computed(()=>session.knowledgeBases.find(value=>value.id===page.value?.knowledgeBaseId)??null)
const currentWorkspaceName=computed(()=>session.activeWorkspace?.name||'个人知识库')
const visibleKnowledgeBases=computed(()=>{const query=knowledgeBaseQuery.value.trim().toLocaleLowerCase();return session.knowledgeBases.filter(value=>{const ownerType=value.ownerType.toLocaleUpperCase();const personal=['PERSONAL','USER'].includes(ownerType)&&value.ownerId===session.user?.userId;return (knowledgeBaseTab.value==='personal'?personal:!personal)&&(!query||`${value.name} ${value.slug}`.toLocaleLowerCase().includes(query))})})
const pageMap=computed(()=>new Map(siblingPages.value.map(value=>[value.id,value])))
const catalogEntries=computed<EditorCatalogEntry[]>(()=>{
  const nodes=catalogTree.value?.nodes??[]
  if(!nodes.length){return siblingPages.value.map(value=>({id:value.id,pageId:value.id,title:value.title||'无标题',nodeType:'DOCUMENT' as const,depth:0,url:null})).filter(matchesCatalogQuery)}
  const children=new Map<string|null,CatalogNode[]>()
  for(const node of nodes){const values=children.get(node.parentId)??[];values.push(node);children.set(node.parentId,values)}
  for(const values of children.values())values.sort((left,right)=>left.position.localeCompare(right.position))
  const flattened:EditorCatalogEntry[]=[];const visited=new Set<string>()
  const visit=(parentId:string|null,depth:number)=>{for(const node of children.get(parentId)??[]){if(visited.has(node.id))continue;visited.add(node.id);const linked=node.pageId?pageMap.value.get(node.pageId):null;flattened.push({id:node.id,pageId:node.pageId,title:node.titleOverride||linked?.title||node.url||'无标题',nodeType:node.nodeType,depth,url:node.url});if(catalogQuery.value.trim()||!collapsedCatalogIds.value.includes(node.id))visit(node.id,depth+1)}}
  visit(null,0);for(const node of nodes){if(!visited.has(node.id)){const linked=node.pageId?pageMap.value.get(node.pageId):null;flattened.push({id:node.id,pageId:node.pageId,title:node.titleOverride||linked?.title||node.url||'无标题',nodeType:node.nodeType,depth:0,url:node.url})}}
  return flattened.filter(matchesCatalogQuery)
})
function matchesCatalogQuery(value:{title:string}){const query=catalogQuery.value.trim().toLocaleLowerCase();return !query||value.title.toLocaleLowerCase().includes(query)}
function clearEditorSelection(){editorTextSelection.value=null}
function resetCommentComposer(){commentComposerOpen.value=false;commentComposerContext.value=null;commentText.value=''}
function handleBodyChange(){
  clearEditorSelection()
  const launchContext=commentLaunchContext.value
  if(launchContext?.anchor.type==='TEXT_RANGE'&&launchContext.source!==body.value)commentLaunchContext.value=null
  const context=commentComposerContext.value
  if(context?.anchor.type==='TEXT_RANGE'&&context.source!==body.value)resetCommentComposer()
}
function onDocumentSelection(start:number,end:number,context:DocumentSelectionContext){
  collaboration.broadcastSelection(start,end)
  commentLaunchContext.value=null
  const current=page.value
  const validRange=Number.isInteger(start)&&Number.isInteger(end)&&start>=0&&end>start&&end<=body.value.length
  if(!current||current.contentType!=='DOCUMENT'||!validRange||!context.text||body.value.slice(start,end)!==context.text){clearEditorSelection();return}
  editorTextSelection.value={...context,pageId:current.id,workspaceId:current.workspaceId,draftRevision:current.draftRevision,source:body.value,start,end}
}
function selectionCommentContext():CommentComposerContext|null{
  const current=page.value
  const selection=editorTextSelection.value
  if(!current||!selection||selection.pageId!==current.id||selection.workspaceId!==current.workspaceId||selection.source!==body.value||selection.end<=selection.start||body.value.slice(selection.start,selection.end)!==selection.text){return null}
  return{pageId:selection.pageId,workspaceId:selection.workspaceId,source:selection.source,anchor:{type:'TEXT_RANGE',start:selection.start,end:selection.end,quote:selection.text,draftRevision:selection.draftRevision}}
}
function beginPageComment(){
  const current=page.value
  if(!current)return
  commentLaunchContext.value=null
  commentComposerContext.value={pageId:current.id,workspaceId:current.workspaceId,source:null,anchor:{type:'PAGE'}}
  commentText.value=''
  commentComposerOpen.value=true
}
function captureCommentLaunchContext(){commentLaunchContext.value=selectionCommentContext()}
function cancelComment(){commentLaunchContext.value=null;resetCommentComposer()}
function activeFocusTarget(){
  const target=document.activeElement
  return target instanceof HTMLElement&&target!==document.body?target:null
}
function templateElement(value:unknown){
  if(value instanceof HTMLElement)return value
  const element=(value as {$el?:unknown}|null)?.$el
  return element instanceof HTMLElement?element:null
}
function focusAfterRender(target:()=>unknown){void nextTick(()=>templateElement(target())?.focus())}
function restoreFocus(target:HTMLElement|null,fallbackSelector=''){
  void nextTick(()=>{
    const fallback=fallbackSelector?document.querySelector<HTMLElement>(fallbackSelector):null
    const destination=target?.isConnected?target:fallback
    destination?.focus()
  })
}
function hideSidePanel(restore=true){
  const closingPanel=sidePanel.value
  const closingReferencePending=closingPanel==='references'&&referencePending.value
  sidePanel.value=null;commentLaunchContext.value=null;resetCommentComposer()
  referenceInsertMode.value=false
  referencePending.value=false
  const target=sidePanelReturnFocus
  sidePanelReturnFocus=null
  if(closingReferencePending)documentEditor.value?.cancelPendingInsert(restore&&!target)
  if(restore)restoreFocus(target)
}
function closeSidePanel(){hideSidePanel(true)}
function textRangeQuote(anchor:unknown){
  if(!anchor||typeof anchor!=='object')return''
  const value=anchor as {type?:unknown;kind?:unknown;quote?:unknown}
  return(value.type==='TEXT_RANGE'||value.kind==='TEXT_RANGE')&&typeof value.quote==='string'?value.quote:''
}
function acknowledgeSelectionSave(requestedPageId:string,source:string,draftRevision:number){
  clearEditorSelection()
  const context=commentComposerContext.value
  if(context&&context.pageId===requestedPageId&&context.source===source&&context.anchor.type==='TEXT_RANGE')commentComposerContext.value={...context,anchor:{...context.anchor,draftRevision}}
  const launchContext=commentLaunchContext.value
  if(launchContext&&launchContext.pageId===requestedPageId&&launchContext.source===source&&launchContext.anchor.type==='TEXT_RANGE')commentLaunchContext.value={...launchContext,anchor:{...launchContext.anchor,draftRevision}}
}
onMounted(()=>{setupCompactViewport();void load();window.addEventListener('online',flushOffline);window.addEventListener('keydown',editorShortcut);window.addEventListener('beforeunload',protectUnsavedExit);document.addEventListener('visibilitychange',saveWhenHidden)})
watch(pageId,load)
watch(catalogOpen,value=>{if(!compactViewport.value)localStorage.setItem('editor-catalog-open',String(value))})
watch(collaboration.body,value=>{if(hydrated&&collaborationEnabledForPage.value&&value!==body.value)body.value=value})
watch(body,handleBodyChange)
watch([title,body],()=>{if(!hydrated)return;changeVersion+=1;if(collaborationEnabledForPage.value&&body.value!==collaboration.body.value)collaboration.setBody(body.value);status.value='dirty';window.clearTimeout(saveTimer);saveTimer=window.setTimeout(()=>{void save()},1500)})
onBeforeRouteUpdate(protectDirtyNavigation)
onBeforeRouteLeave(protectDirtyNavigation)
onBeforeUnmount(()=>{documentEditor.value?.cancelPendingInsert(false);window.clearTimeout(saveTimer);compactMediaQuery?.removeEventListener('change',handleCompactViewportChange);window.removeEventListener('online',flushOffline);window.removeEventListener('keydown',editorShortcut);window.removeEventListener('beforeunload',protectUnsavedExit);document.removeEventListener('visibilitychange',saveWhenHidden)})
async function load(){
  const sequence=++loadSequence
  const requestedPageId=pageId.value
  const preserveCatalog=page.value?.knowledgeBaseId===String(route.params.knowledgeBaseId)
  resetPageStateForLoad(preserveCatalog)
  try{
    let value:Page
    let cachedMode=false
    try{
      value=await post<Page>('/api/v1/pages/get',{pageId:requestedPageId})
      assertRequestedPage(value,requestedPageId)
      void cachePage(session.user!.userId,value)
    }catch(reason){
      if(!isNetworkFailure(reason))throw reason
      const cached=await readCachedPage(session.user!.userId,requestedPageId)
      if(!cached)throw reason
      assertRequestedPage(cached,requestedPageId)
      value=cached
      cachedMode=true
    }
    if(sequence!==loadSequence)return
    applyPage(value)
    if(cachedMode)status.value='offline'
    if(collaborationEnabledForPage.value)collaboration.connect({pageId:value.id,initialBody:body.value,userId:session.user!.userId,email:session.user!.email})
    void post('/api/v1/activities/page-view',{pageId:requestedPageId}).catch(()=>undefined)
    if(navigator.onLine){
      void loadPublication(requestedPageId)
      void loadFavorite(requestedPageId)
      void post<Page[]>('/api/v1/pages/list',{knowledgeBaseId:value.knowledgeBaseId}).then(values=>{
        if(sequence===loadSequence&&requestedPageId===pageId.value)siblingPages.value=Array.isArray(values)?values:[]
      }).catch(()=>{if(sequence===loadSequence)siblingPages.value=[]})
      void post<CatalogTree>('/api/v1/catalog/list',{knowledgeBaseId:value.knowledgeBaseId}).then(value=>{
        if(sequence===loadSequence&&requestedPageId===pageId.value)catalogTree.value=isCatalogTree(value)?value:null
      }).catch(()=>{if(sequence===loadSequence)catalogTree.value=null})
    }
  }catch(value){
    if(sequence===loadSequence)operationErrors.load=messageOf(value)
  }finally{
    if(sequence===loadSequence){
      loading.value=false
      queueMicrotask(()=>{if(sequence===loadSequence&&page.value?.id===requestedPageId)hydrated=true})
    }
  }
}
function resetPageStateForLoad(preserveCatalog=false){
  window.clearTimeout(saveTimer)
  saveTimer=0
  documentEditor.value?.cancelPendingInsert(false)
  catalogReturnFocus=null
  sidePanelReturnFocus=null
  loading.value=true
  hydrated=false
  operationErrors.load=''
  operationErrors.save=''
  collaboration.disconnect()
  page.value=null
  title.value=''
  body.value=''
  status.value='saved'
  publication.value=null
  if(!preserveCatalog){siblingPages.value=[];catalogTree.value=null}
  sidePanel.value=null
  comments.value=[]
  commentsError.value=''
  commentsLoading.value=false
  resetCommentComposer()
  clearEditorSelection()
  commentLaunchContext.value=null
  commentSubmitting.value=false
  resolvingCommentIds.value=[]
  commentSequence+=1
  commentSubmitSequence+=1
  favoriteActive.value=false
  favoritePending.value=false
  favoriteSequence+=1
  managementOpen.value=false
  analyticsOpen.value=false
  contentCardOpen.value=false
  contentCardKinds.value=[]
  contentCardPending.value=false
  referenceInsertMode.value=false
  referencePending.value=false
  knowledgeBaseMenuOpen.value=false
  outlinePanelOpen.value=false
  documentProtected.value=false
  collaborationEnabledForPage.value=true
  savedDocumentSource.value=''
  savedDocumentContent.value=null
}
function assertRequestedPage(value:Page,requestedPageId:string){
  if(!value||typeof value!=='object'||value.id!==requestedPageId||typeof value.title!=='string'||typeof value.contentType!=='string'||!Number.isFinite(value.draftRevision)||typeof value.knowledgeBaseId!=='string'||typeof value.workspaceId!=='string')throw new Error('页面响应格式无效，请重新加载')
}
function isCatalogTree(value:CatalogTree){return Boolean(value&&typeof value==='object'&&Array.isArray(value.nodes))}
function applyPage(value:Page){
  clearEditorSelection()
  commentLaunchContext.value=null
  resetCommentComposer()
  page.value=value
  title.value=value.title
  if(value.contentType==='DOCUMENT'){
    const source=documentToMarkdown(value.content,value.plainText||'')
    body.value=source
    savedDocumentSource.value=source
    savedDocumentContent.value=value.content
    documentProtected.value=!isEditableDocument(value.content)
    collaborationEnabledForPage.value=isPlainTextDocument(value.content)
  }else{
    body.value=JSON.stringify(value.content??{},null,0)
    savedDocumentSource.value=''
    savedDocumentContent.value=null
    documentProtected.value=false
    collaborationEnabledForPage.value=true
  }
  changeVersion=0;savedVersion=0;saveRequested=false;status.value='saved'
}
function contentPayload(text=body.value){
  if(page.value?.contentType==='DOCUMENT')return text===savedDocumentSource.value&&savedDocumentContent.value!=null?savedDocumentContent.value:markdownToDocument(text)
  try{return JSON.parse(text)}catch{return page.value?.content??{}}
}
function rememberSavedDocument(value:Page,source:string){
  if(value.contentType!=='DOCUMENT')return
  savedDocumentSource.value=source
  savedDocumentContent.value=value.content
  documentProtected.value=!isEditableDocument(value.content)
}
function hasUnsavedChanges(){return status.value==='dirty'||status.value==='saving'||changeVersion>savedVersion}
async function protectDirtyNavigation(){
  if(!hasUnsavedChanges())return true
  await save()
  return hasUnsavedChanges()?window.confirm('最后的修改尚未安全保存，确定离开吗？'):true
}
function protectUnsavedExit(event:BeforeUnloadEvent){if(!hasUnsavedChanges())return;event.preventDefault();event.returnValue=''}
function saveWhenHidden(){if(document.visibilityState==='hidden'&&hasUnsavedChanges())void save()}
function save(){window.clearTimeout(saveTimer);saveTimer=0;saveRequested=true;if(!saveInFlight)saveInFlight=drainSaves().finally(()=>{saveInFlight=null});return saveInFlight}
async function drainSaves(){while(saveRequested&&page.value){saveRequested=false;const version=changeVersion;await performSave(version);if(status.value==='conflict'||(status.value==='dirty'&&!saveRequested))break;if(changeVersion>version)saveRequested=true}}
async function performSave(version:number){
  const requestedPage=page.value
  if(!requestedPage)return
  const requestedPageId=requestedPage.id
  status.value='saving'
  const snapshot={title:title.value.trim()||'无标题',body:body.value}
  const pending=toPendingPageUpdate(session.user!.userId,requestedPage,snapshot)
  pending.content=contentPayload(snapshot.body)
  const payload={pageId:pending.pageId,expectedRevision:pending.expectedRevision,title:pending.title,content:pending.content,revisionKind:'AUTO'}
  if(!navigator.onLine){
    const queued=await queuePageUpdate(pending)
    if(page.value?.id!==requestedPageId)return
    const optimistic=optimisticPage(page.value,queued)
    page.value=optimistic
    rememberSavedDocument(optimistic,snapshot.body)
    acknowledgeSelectionSave(requestedPageId,snapshot.body,optimistic.draftRevision)
    savedVersion=Math.max(savedVersion,version)
    clearSuccessfulSaveError(operationErrors)
    status.value='offline'
    if(changeVersion>version)saveRequested=true
    return
  }
  try{
    const saved=await post<Page>('/api/v1/pages/update',payload)
    assertRequestedPage(saved,requestedPageId)
    if(page.value?.id!==requestedPageId||pageId.value!==requestedPageId)return
    page.value=saved
    rememberSavedDocument(saved,snapshot.body)
    acknowledgeSelectionSave(requestedPageId,snapshot.body,saved.draftRevision)
    savedVersion=Math.max(savedVersion,version)
    clearSuccessfulSaveError(operationErrors)
    void cachePage(session.user!.userId,saved)
    if(changeVersion>version){status.value='dirty';saveRequested=true}else status.value='saved'
  }catch(value){
    if(page.value?.id!==requestedPageId)return
    if(value instanceof ApiError&&value.problem.code==='PAGE_REVISION_CONFLICT')status.value='conflict'
    else if(isNetworkFailure(value)){
      const queued=await queuePageUpdate(pending)
      if(page.value?.id!==requestedPageId)return
      const optimistic=optimisticPage(page.value,queued)
      page.value=optimistic
      rememberSavedDocument(optimistic,snapshot.body)
      acknowledgeSelectionSave(requestedPageId,snapshot.body,optimistic.draftRevision)
      savedVersion=Math.max(savedVersion,version)
      clearSuccessfulSaveError(operationErrors)
      status.value='offline'
      if(changeVersion>version)saveRequested=true
    }else{status.value='dirty';operationErrors.save=messageOf(value)}
  }
}
async function flushOffline(){
  if(!session.user)return
  const requestedPageId=pageId.value
  const result=await flushPageUpdates(session.user.userId,sendPending)
  if(requestedPageId!==pageId.value)return
  if(result.conflictPageIds.includes(requestedPageId))status.value='conflict'
  else if(result.remaining===0&&status.value==='offline'){
    try{
      const refreshed=await post<Page>('/api/v1/pages/get',{pageId:requestedPageId})
      assertRequestedPage(refreshed,requestedPageId)
      if(requestedPageId===pageId.value)applyPage(refreshed)
    }catch(value){operationErrors.save=messageOf(value);status.value='dirty'}
  }
}
function sendPending(update:PendingPageUpdate){return post<Page>('/api/v1/pages/update',{pageId:update.pageId,expectedRevision:update.expectedRevision,title:update.title,content:update.content,revisionKind:'AUTO'})}
async function reloadRemote(){await load();ui.notify('已加载服务端版本')}
async function overwriteRemote(){
  const requestedPage=page.value
  if(!requestedPage)return
  try{
    const remote=await post<Page>('/api/v1/pages/get',{pageId:requestedPage.id})
    assertRequestedPage(remote,requestedPage.id)
    if(page.value?.id!==requestedPage.id)return
    page.value={...page.value,draftRevision:remote.draftRevision}
    clearEditorSelection()
    commentLaunchContext.value=null
    resetCommentComposer()
    status.value='dirty'
    await save()
  }catch(value){operationErrors.save=messageOf(value);status.value='conflict'}
}
async function loadPublication(requestedPageId=pageId.value){
  try{
    const value=await post<PublicationState>('/api/v1/pages/publication-state',{pageId:requestedPageId})
    if(pageId.value===requestedPageId&&page.value?.id===requestedPageId)publication.value=value&&typeof value==='object'?value:null
  }catch{
    if(pageId.value===requestedPageId)publication.value=null
  }
}
async function loadFavorite(requestedPageId=pageId.value){
  const sequence=++favoriteSequence
  favoritePending.value=true
  favoriteActive.value=false
  try{
    const value=await post<FavoriteState>('/api/v1/favorites/status',{pageId:requestedPageId})
    if(sequence===favoriteSequence&&requestedPageId===pageId.value&&page.value?.id===requestedPageId)favoriteActive.value=Boolean(value?.favorite)
  }catch{
    if(sequence===favoriteSequence&&requestedPageId===pageId.value)favoriteActive.value=false
  }finally{
    if(sequence===favoriteSequence)favoritePending.value=false
  }
}
async function openCatalogEntry(entry:EditorCatalogEntry){if(entry.nodeType==='GROUP'){collapsedCatalogIds.value=collapsedCatalogIds.value.includes(entry.id)?collapsedCatalogIds.value.filter(value=>value!==entry.id):[...collapsedCatalogIds.value,entry.id];return}if(entry.nodeType==='LINK'&&entry.url){try{const value=new URL(entry.url);if(['http:','https:'].includes(value.protocol)&&!value.username&&!value.password)window.open(value.href,'_blank','noopener,noreferrer')}catch{}return}if(!entry.pageId||entry.pageId===pageId.value)return;const requestedKnowledgeBaseId=page.value?.knowledgeBaseId||String(route.params.knowledgeBaseId??catalogTree.value?.knowledgeBaseId??'');if(!requestedKnowledgeBaseId)return;await router.push(`/app/kb/${requestedKnowledgeBaseId}/pages/${entry.pageId}`)}
async function openKnowledgeBase(knowledgeBase:KnowledgeBase){knowledgeBaseMenuOpen.value=false;if(knowledgeBase.homepagePageId)await router.push(`/app/kb/${knowledgeBase.id}/pages/${knowledgeBase.homepagePageId}`);else await router.push(`/app/kb/${knowledgeBase.id}`)}
function isCompactEditorViewport(){if(typeof window==='undefined')return false;return typeof window.matchMedia==='function'?window.matchMedia('(max-width: 1100px)').matches:window.innerWidth<=1100}
function setupCompactViewport(){if(typeof window.matchMedia!=='function')return;compactMediaQuery=window.matchMedia('(max-width: 1100px)');handleCompactViewportChange(compactMediaQuery)}
function handleCompactViewportChange(event:Pick<MediaQueryList,'matches'>){compactViewport.value=event.matches;if(event.matches)hideCatalog(false)}
function openCatalog(){
  if(compactViewport.value&&!catalogOpen.value)catalogReturnFocus=activeFocusTarget()
  if(compactViewport.value&&sidePanel.value)hideSidePanel(false)
  catalogOpen.value=true
  outlinePanelOpen.value=false
  if(compactViewport.value)focusAfterRender(()=>catalogSearchInput.value)
}
function hideCatalog(restore=true){
  catalogOpen.value=false;knowledgeBaseMenuOpen.value=false
  const target=catalogReturnFocus
  catalogReturnFocus=null
  if(restore)restoreFocus(target,'[aria-label="展开目录"]')
}
function closeCatalog(){hideCatalog(true)}
function handleOutlineOpenChange(open:boolean){outlinePanelOpen.value=open;if(open&&compactViewport.value){hideCatalog(false);if(sidePanel.value)hideSidePanel(false)}}
function closeCompactOverlay(){if(catalogOpen.value)closeCatalog();else if(sidePanel.value)closeSidePanel();else documentEditor.value?.closeOutline()}
function editorShortcut(event:KeyboardEvent){
  if(event.key==='Escape'&&compactViewport.value&&(catalogOpen.value||sidePanel.value)){event.preventDefault();closeCompactOverlay();return}
  if(!(event.ctrlKey||event.metaKey)||event.key.toLocaleLowerCase()!=='j')return
  event.preventDefault();openCatalog();void nextTick(()=>catalogSearchInput.value?.focus())
}
async function openComments(){
  const selectionContext=commentLaunchContext.value??selectionCommentContext()
  commentLaunchContext.value=null
  if(sidePanel.value==='references')hideSidePanel(false)
  if(compactViewport.value){sidePanelReturnFocus=activeFocusTarget();hideCatalog(false)}
  sidePanel.value='comments'
  resetCommentComposer()
  if(selectionContext){commentComposerContext.value=selectionContext;commentComposerOpen.value=true}
  if(compactViewport.value)focusAfterRender(()=>sidePanelCloseButton.value)
  await loadComments()
}
function showReferences(insertMode:boolean,hasPending:boolean){if(sidePanel.value==='comments')hideSidePanel(false);referenceInsertMode.value=insertMode;referencePending.value=hasPending;if(compactViewport.value){sidePanelReturnFocus=activeFocusTarget();hideCatalog(false)}sidePanel.value='references';if(compactViewport.value)focusAfterRender(()=>sidePanelCloseButton.value)}
function handleReferenceInsertRequest(payload:{commandId:string|null}){contentCardOpen.value=false;contentCardKinds.value=[];contentCardPending.value=false;showReferences(Boolean(payload.commandId),true)}
function openReferenceBrowser(){if(contentCardPending.value||contentCardOpen.value)documentEditor.value?.cancelPendingInsert(false);contentCardOpen.value=false;contentCardKinds.value=[];contentCardPending.value=false;if(sidePanel.value==='references'&&referencePending.value)documentEditor.value?.cancelPendingInsert(false);const canCapture=page.value?.contentType==='DOCUMENT'&&!documentProtected.value;showReferences(false,Boolean(canCapture&&documentEditor.value?.capturePendingInsert()))}
function requestReferenceInsert(){if(page.value?.contentType==='DOCUMENT'&&!documentProtected.value)documentEditor.value?.requestReference();else openReferenceBrowser()}
function requestContentCard(payload?:{commandId:string|null;kind:DocumentContentCardKind|null}){if(sidePanel.value==='comments')hideSidePanel(false);else if(sidePanel.value==='references'){sidePanel.value=null;referenceInsertMode.value=false;referencePending.value=false;sidePanelReturnFocus=null}contentCardPending.value=true;contentCardKinds.value=payload?.kind?[payload.kind]:[];contentCardOpen.value=true}
function cancelContentCardInsert(){const pending=contentCardPending.value;contentCardPending.value=false;contentCardKinds.value=[];if(pending)documentEditor.value?.cancelPendingInsert(true)}
function handleReferencePageOpen(){hideSidePanel(false)}
async function openManagement(tab:PageManagementTab){if(!page.value)return;if(!navigator.onLine){ui.notify('离线时不能打开管理功能，请联网后重试','warning');return}window.clearTimeout(saveTimer);if(status.value==='dirty'||status.value==='saving')await save();if(status.value!=='saved'){ui.notify('请先解决保存或版本冲突','warning');return}managementTab.value=tab;managementOpen.value=true}
function managementUpdated(updated:Page,resetEditorBody=false){
  const currentPageId=page.value?.id
  if(!currentPageId)return
  try{assertRequestedPage(updated,currentPageId)}catch(value){ui.notify(messageOf(value),'error');return}
  const resume=hydrated
  hydrated=false
  if(resetEditorBody){applyPage(updated);if(collaborationEnabledForPage.value)collaboration.setBody(body.value)}
  else{clearEditorSelection();commentLaunchContext.value=null;resetCommentComposer();page.value=updated;title.value=updated.title;rememberSavedDocument(updated,body.value);status.value='saved'}
  void cachePage(session.user!.userId,updated)
  queueMicrotask(()=>{hydrated=resume})
}
async function managementDeleted(){if(page.value)await router.replace(`/app/kb/${page.value.knowledgeBaseId}`)}
function insertReference(value:{token:string}){
  if(!referencePending.value){ui.notify('请重新选择插入位置','warning');return}
  referencePending.value=false
  if(documentProtected.value){documentEditor.value?.cancelPendingInsert(false);sidePanel.value=null;referenceInsertMode.value=false;sidePanelReturnFocus=null;ui.notify('此文稿包含暂不支持的结构，当前已启用只读保护','warning');return}
  if(!documentEditor.value?.insertPendingText(value.token)){documentEditor.value?.cancelPendingInsert(false);sidePanel.value=null;referenceInsertMode.value=false;sidePanelReturnFocus=null;void nextTick(()=>documentEditor.value?.focus());ui.notify('文稿已变化，请重新选择插入位置','warning');return}
  sidePanel.value=null;referenceInsertMode.value=false;sidePanelReturnFocus=null;ui.notify('引用已插入')
}
function insertContentCard(value:ContentCardCreateEvent){
  if(!contentCardPending.value)return
  contentCardPending.value=false
  if(documentProtected.value){documentEditor.value?.cancelPendingInsert(false);contentCardOpen.value=false;contentCardKinds.value=[];ui.notify('此文稿包含暂不支持的结构，当前已启用只读保护','warning');return}
  if(!documentEditor.value?.insertPendingText(value.token)){documentEditor.value?.cancelPendingInsert(false);contentCardOpen.value=false;contentCardKinds.value=[];void nextTick(()=>documentEditor.value?.focus());ui.notify('文稿已变化，请重新选择插入位置','warning');return}
  contentCardKinds.value=[];ui.notify('内容卡片已插入')
}
const uploadContentCard:ContentCardUploadHandler=async(file)=>{if(!page.value)throw new Error('文稿尚未加载');if(documentProtected.value)throw new Error('此文稿当前处于结构保护状态');if(file.size>50*1024*1024)throw new Error('单个文件不能超过 50 MB');const form=new FormData();form.append('pageId',page.value.id);form.append('file',file);const attachment=await upload<UploadedAttachment>('/api/v1/attachments/upload',form);return{url:attachment.contentUrl,name:attachment.originalName,size:attachment.sizeBytes,mimeType:attachment.mediaType}}
async function loadComments(){
  const sequence=++commentSequence
  const requestedPageId=pageId.value
  comments.value=[]
  commentsLoading.value=true
  commentsError.value=''
  try{
    const value=await post<CommentPage>('/api/v1/comments/page',{pageId:requestedPageId,limit:50,offset:0})
    if(sequence===commentSequence&&requestedPageId===pageId.value&&page.value?.id===requestedPageId)comments.value=Array.isArray(value?.items)?value.items:[]
  }catch(value){
    if(sequence===commentSequence&&requestedPageId===pageId.value)commentsError.value=messageOf(value)
  }finally{
    if(sequence===commentSequence)commentsLoading.value=false
  }
}
async function addComment(){
  const text=commentText.value.trim()
  const initialContext=commentComposerContext.value
  if(!initialContext||!text||commentSubmitting.value)return
  const sequence=++commentSubmitSequence
  let requestedContext:CommentComposerContext={...initialContext,anchor:{...initialContext.anchor}}
  commentSubmitting.value=true
  commentsError.value=''
  try{
    if(requestedContext.anchor.type==='TEXT_RANGE'&&requestedContext.source===body.value&&page.value?.id===requestedContext.pageId&&(hasUnsavedChanges()||saveInFlight)){
      await save()
      if(sequence!==commentSubmitSequence)return
      const refreshed=commentComposerContext.value
      if(status.value!=='saved'||page.value?.id!==requestedContext.pageId||body.value!==requestedContext.source||!refreshed||refreshed.pageId!==requestedContext.pageId||refreshed.source!==requestedContext.source||refreshed.anchor.type!=='TEXT_RANGE')throw new Error('请先保存文稿，再发表划词评论')
      requestedContext={...refreshed,anchor:{...refreshed.anchor}}
    }
    await post('/api/v1/comments/create',{workspaceId:requestedContext.workspaceId,pageId:requestedContext.pageId,parentId:null,anchor:requestedContext.anchor,body:{type:'doc',content:[{type:'paragraph',text}]},plainText:text,mentionedUserIds:[]})
    if(sequence!==commentSubmitSequence||page.value?.id!==requestedContext.pageId||pageId.value!==requestedContext.pageId)return
    resetCommentComposer()
    await loadComments()
  }catch(value){
    if(sequence===commentSubmitSequence&&page.value?.id===requestedContext.pageId)commentsError.value=messageOf(value)
  }finally{
    if(sequence===commentSubmitSequence)commentSubmitting.value=false
  }
}
async function resolveComment(comment:Comment){
  const requestedPageId=page.value?.id
  if(!requestedPageId||resolvingCommentIds.value.includes(comment.id))return
  resolvingCommentIds.value=[...resolvingCommentIds.value,comment.id]
  commentsError.value=''
  try{
    await post('/api/v1/comments/resolve',{commentId:comment.id,resolved:comment.status!=='RESOLVED'})
    if(page.value?.id===requestedPageId&&pageId.value===requestedPageId)await loadComments()
  }catch(value){
    if(page.value?.id===requestedPageId)commentsError.value=messageOf(value)
  }finally{
    resolvingCommentIds.value=resolvingCommentIds.value.filter(value=>value!==comment.id)
  }
}
function commentTime(value:string){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';return new Intl.DateTimeFormat('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}).format(date)}
async function toggleFavorite(){
  const requestedPage=page.value
  if(!requestedPage||favoritePending.value)return
  const sequence=++favoriteSequence
  const previous=favoriteActive.value
  const next=!previous
  favoriteActive.value=next
  favoritePending.value=true
  try{
    const value=await post<FavoriteState>('/api/v1/favorites/set',{pageId:requestedPage.id,favorite:next})
    if(sequence===favoriteSequence&&page.value?.id===requestedPage.id)favoriteActive.value=typeof value?.favorite==='boolean'?value.favorite:next
  }catch(value){
    if(sequence===favoriteSequence&&page.value?.id===requestedPage.id){favoriteActive.value=previous;ui.notify(messageOf(value),'error')}
  }finally{
    if(sequence===favoriteSequence)favoritePending.value=false
  }
}
function documentText(content:unknown):string{if(!content||typeof content!=='object')return'';const node=content as {text?:string;content?:unknown[];type?:string};if(node.text)return node.text;return(node.content??[]).map(documentText).join(node.type==='doc'?'\n':'')}
function documentContent(text:string){return{type:'doc',content:[{type:'paragraph',text}]}}
</script>

<template>
  <div class="editor-page" :class="{ 'catalog-is-open': catalogOpen, 'side-panel-comments': sidePanel==='comments', 'side-panel-references': sidePanel==='references', 'compact-viewport': compactViewport }">
    <button v-if="compactViewport&&(catalogOpen||sidePanel||outlinePanelOpen)" type="button" class="editor-overlay-scrim" :class="catalogOpen?'catalog-overlay':sidePanel?'side-overlay':'outline-overlay'" aria-label="关闭浮层" @click="closeCompactOverlay" />
    <aside v-if="catalogOpen" class="editor-catalog" aria-label="知识库目录" :role="compactViewport?'dialog':undefined" :aria-modal="compactViewport?'true':undefined">
      <button type="button" class="catalog-context-row" @click="router.push('/app')">
        <span class="catalog-context-mark">知</span>
        <v-icon icon="mdi-chevron-right" size="14" />
        <span>{{currentWorkspaceName}}</span>
      </button>
      <div class="catalog-book-row">
        <span class="catalog-book-icon"><span v-if="currentKnowledgeBase?.icon">{{currentKnowledgeBase.icon}}</span><v-icon v-else icon="mdi-folder-outline" size="21" /></span>
        <strong>{{currentKnowledgeBase?.name||'知识库'}}</strong>
        <v-icon v-if="currentKnowledgeBase?.visibility==='PRIVATE'" class="catalog-book-lock" icon="mdi-lock-outline" size="13" />
        <v-menu v-model="knowledgeBaseMenuOpen" location="bottom start" :offset="[7,-8]" :close-on-content-click="false">
          <template #activator="{props}"><v-btn v-bind="props" class="catalog-switcher-button" icon="mdi-chevron-down" variant="text" size="x-small" aria-label="切换知识库" /></template>
          <v-card class="knowledge-base-switcher" elevation="5">
            <div class="knowledge-base-tabs"><button type="button" :class="{active:knowledgeBaseTab==='personal'}" @click="knowledgeBaseTab='personal'">我个人的</button><button type="button" :class="{active:knowledgeBaseTab==='collaborative'}" @click="knowledgeBaseTab='collaborative'">邀请协作的</button></div>
            <label class="knowledge-base-search"><v-icon icon="mdi-magnify" size="16"/><input v-model="knowledgeBaseQuery" placeholder="搜索知识库" aria-label="搜索知识库"/></label>
            <div class="knowledge-base-list">
              <button v-for="knowledgeBase in visibleKnowledgeBases" :key="knowledgeBase.id" type="button" :class="{active:knowledgeBase.id===page?.knowledgeBaseId}" @click="openKnowledgeBase(knowledgeBase)">
                <span class="knowledge-base-icon"><span v-if="knowledgeBase.icon">{{knowledgeBase.icon}}</span><v-icon v-else :icon="knowledgeBase.id===page?.knowledgeBaseId?'mdi-folder-outline':'mdi-book-outline'" size="22"/></span>
                <strong>{{knowledgeBase.name}}</strong><v-icon v-if="knowledgeBase.visibility==='PRIVATE'" icon="mdi-lock-outline" size="13"/>
              </button>
              <p v-if="!visibleKnowledgeBases.length">没有匹配的知识库</p>
            </div>
          </v-card>
        </v-menu>
        <v-btn icon="mdi-dots-horizontal" variant="text" size="x-small" title="收起侧栏" aria-label="收起侧栏" @click="closeCatalog" />
      </div>
      <label class="catalog-search"><v-icon icon="mdi-magnify" size="17"/><input ref="catalogSearchInput" v-model="catalogQuery" placeholder="搜索" aria-label="搜索目录"/><kbd>Ctrl J</kbd></label>
      <nav class="catalog-primary" aria-label="知识库导航">
        <button type="button" @click="router.push(`/app/kb/${page?.knowledgeBaseId}`)"><v-icon icon="mdi-home-outline" size="18"/><span>首页</span></button>
        <button type="button" class="active"><v-icon icon="mdi-format-list-bulleted" size="18"/><span>目录</span><span class="catalog-count">{{catalogEntries.length}}</span></button>
      </nav>
      <nav class="catalog-list">
        <button
          v-for="entry in catalogEntries"
          :key="entry.id"
          type="button"
          class="catalog-row"
          :class="{active:entry.pageId===pageId,group:entry.nodeType==='GROUP'}"
          :style="{'--catalog-indent':`${Math.min(entry.depth,5)*18}px`}"
          :disabled="entry.nodeType!=='GROUP'&&entry.nodeType!=='LINK'&&!entry.pageId"
          @click="openCatalogEntry(entry)"
        >
          <v-icon :icon="entry.nodeType==='GROUP'?(collapsedCatalogIds.includes(entry.id)?'mdi-chevron-right':'mdi-chevron-down'):entry.nodeType==='LINK'?'mdi-link-variant':pageMap.get(entry.pageId||'')?.contentType==='WHITEBOARD'?'mdi-drawing-box':pageMap.get(entry.pageId||'')?.contentType==='SPREADSHEET'?'mdi-table-large':pageMap.get(entry.pageId||'')?.contentType==='DATABASE'?'mdi-database-outline':'mdi-file-document-outline'" size="17" />
          <span>{{entry.title}}</span>
        </button>
        <div v-if="!catalogEntries.length" class="catalog-empty">没有匹配的文档</div>
      </nav>
      <span class="catalog-bottom-count">{{wordCount}} 字</span>
    </aside>
    <header class="editor-header" :inert="compactViewport&&(catalogOpen||Boolean(sidePanel))||undefined">
      <div class="editor-header-left">
        <input v-if="page?.contentType!=='DOCUMENT'" v-model="title" class="structured-title-input" placeholder="无标题" aria-label="文稿标题" />
        <span v-else class="header-document-title" :title="title">{{title||'无标题'}}</span>
        <v-icon v-if="page?.contentType==='DOCUMENT'&&documentProtected" class="document-lock" icon="mdi-shield-lock-outline" size="14" title="正文只读保护" />
        <div class="editor-header-status" :class="`status-${status}`" :title="statusLabel" role="status" aria-live="polite" aria-atomic="true">
          <v-icon :icon="statusPresentation.icon" :class="{'mdi-spin':status==='saving'}" size="14" />
          <span>{{statusLabel}}</span>
        </div>
      </div>

      <div class="editor-header-actions">
        <v-btn class="header-icon d-none d-sm-inline-flex" :icon="favoriteActive?'mdi-star':'mdi-star-outline'" :loading="favoritePending" variant="text" size="small" :title="favoriteActive?'取消收藏':'收藏'" :aria-label="favoriteActive?'取消收藏':'收藏'" @click="toggleFavorite" />
        <v-btn v-if="page?.contentType==='DOCUMENT'" class="header-icon d-none d-sm-inline-flex" icon="mdi-file-code-outline" variant="text" size="small" title="插入内容" aria-label="插入内容" :disabled="documentProtected" @click="documentEditor?.requestContentCard(null)" />
        <v-tooltip :text="collaboration.error.value || `实时协作：${collaborationLabel}`">
          <template #activator="{ props: tooltipProps }"><button v-bind="tooltipProps" type="button" class="collaboration-state" :aria-label="`实时协作：${collaborationLabel}`" @click="openManagement('PERMISSIONS')"><v-icon icon="mdi-account-plus-outline" size="20" /><span class="collaboration-label">{{collaborationLabel}}</span><span class="collaboration-dot" :class="`collaboration-${collaborationTone}`" /></button></template>
        </v-tooltip>
        <v-btn class="header-icon d-none d-sm-inline-flex" icon="mdi-vector-link" variant="text" size="small" title="引用" aria-label="引用" @click="requestReferenceInsert" />
        <v-btn class="share-button" variant="outlined" size="small" @click="openManagement('SHARE')">分享</v-btn>
        <v-btn class="publish-button" color="success" variant="flat" size="small" @click="openManagement('PUBLISH')">{{publicationLabel}}</v-btn>
        <div class="header-action-cluster">
          <v-btn class="header-icon" icon="mdi-comment-text-outline" variant="text" size="small" title="评论" aria-label="评论" @pointerdown="captureCommentLaunchContext" @click="openComments" />
          <v-menu location="bottom end">
            <template #activator="{props}"><v-btn v-bind="props" class="header-icon" icon="mdi-dots-horizontal" variant="text" size="small" title="更多" aria-label="更多操作" /></template>
            <v-list class="editor-more-menu" density="compact">
              <v-list-item class="d-sm-none" :prepend-icon="favoriteActive?'mdi-star':'mdi-star-outline'" :title="favoriteActive?'取消收藏':'收藏'" :disabled="favoritePending" @click="toggleFavorite" />
              <v-list-item v-if="page?.contentType==='DOCUMENT'" class="d-sm-none" prepend-icon="mdi-file-code-outline" title="插入内容" :disabled="documentProtected" @click="documentEditor?.requestContentCard(null)" />
              <v-list-item class="d-sm-none" prepend-icon="mdi-vector-link" title="页面关系" @click="openReferenceBrowser" />
              <v-list-item prepend-icon="mdi-tune-variant" title="文档设置" @click="openManagement('PROPERTIES')" />
              <v-list-item prepend-icon="mdi-account-lock-outline" title="协作者权限" @click="openManagement('PERMISSIONS')" />
              <v-list-item prepend-icon="mdi-history" title="版本历史" @click="openManagement('HISTORY')" />
              <v-list-item prepend-icon="mdi-paperclip" title="附件" @click="openManagement('ATTACHMENTS')" />
              <v-list-item prepend-icon="mdi-chart-box-outline" title="内容统计" @click="analyticsOpen=true" />
            </v-list>
          </v-menu>
        </div>
      </div>
    </header>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="editor-progress"/>
    <div v-if="error" class="editor-error" role="alert"><v-icon icon="mdi-alert-circle" size="20" /><span>{{error}}</span></div>

    <button v-if="!catalogOpen&&!loading" type="button" class="catalog-edge-trigger" aria-label="展开目录" title="展开目录" :inert="compactViewport&&Boolean(sidePanel)||undefined" @click="openCatalog"><v-icon icon="mdi-chevron-right" size="12" /></button>

    <div v-if="page&&!loading" class="editor-content" :class="{ 'editor-content--structured': page.contentType !== 'DOCUMENT' }" :inert="compactViewport&&(catalogOpen||Boolean(sidePanel))||undefined">
      <div v-if="page.contentType==='DOCUMENT'&&documentProtected" class="document-protection-notice" role="status"><v-icon icon="mdi-shield-lock-outline" size="17"/><span>此文稿含有当前编辑器尚未支持的结构，正文已启用只读保护；修改标题不会覆盖原内容。</span></div>
      <DocumentEditor v-if="page.contentType==='DOCUMENT'" ref="documentEditor" v-model="body" :title="title" :readonly="documentProtected" :title-readonly="false" :document-settings="page.documentSettings" :force-outline-closed="Boolean(sidePanel)||(compactViewport&&catalogOpen)" @update:title="title=$event" @blur="save" @selection-change="onDocumentSelection" @outline-open-change="handleOutlineOpenChange" @request-content-card="requestContentCard" @request-reference="handleReferenceInsertRequest" />
      <StructuredEditor v-else :type="page.contentType" v-model="body" />
    </div>
    <div v-if="page?.contentType==='DOCUMENT'&&!loading" class="editor-word-count">字数 {{wordCount}}</div>
    <div class="editor-chrome-rail" aria-hidden="true" />
    <v-snackbar :model-value="status==='conflict'" color="error" :timeout="-1" location="bottom"><span>服务端已有新版本，本地修改尚未覆盖。</span><template #actions><v-btn @click="reloadRemote">加载远端</v-btn><v-btn @click="overwriteRemote">保留本地</v-btn></template></v-snackbar>
    <aside v-if="sidePanel" class="editor-side-panel" :class="`editor-side-panel--${sidePanel}`" :aria-label="sidePanel==='comments'?'划词评论':'页面关系'" :role="compactViewport?'dialog':undefined" :aria-modal="compactViewport?'true':undefined">
      <header class="side-panel-header">
        <strong>{{sidePanel==='comments'?`划词评论（${comments.length}）`:'页面关系'}}</strong>
        <v-btn ref="sidePanelCloseButton" icon="mdi-close" variant="text" size="x-small" aria-label="关闭侧栏" @click="closeSidePanel" />
      </header>
      <template v-if="sidePanel==='comments'">
        <v-progress-linear v-if="commentsLoading" class="comment-progress" indeterminate color="primary" height="2" />
        <div v-if="commentsError" class="comment-notice" role="alert"><v-icon icon="mdi-alert-circle-outline" size="16"/><span>{{commentsError}}</span><button type="button" @click="loadComments">重试</button></div>
        <div v-if="comments.length" class="comment-list">
          <article v-for="comment in comments" :key="comment.id" class="comment-row" :class="{resolved:comment.status==='RESOLVED'}">
            <span class="comment-avatar">{{comment.creatorEmail.slice(0,1).toLocaleUpperCase()}}</span>
            <div class="comment-copy">
              <header><strong>{{comment.creatorEmail}}</strong><time>{{commentTime(comment.createdAt)}}</time></header>
              <blockquote v-if="textRangeQuote(comment.anchor)" class="comment-quote">引用：{{textRangeQuote(comment.anchor)}}</blockquote>
              <p>{{comment.plainText}}</p>
            </div>
            <v-btn :icon="comment.status==='RESOLVED'?'mdi-refresh':'mdi-check'" :loading="resolvingCommentIds.includes(comment.id)" variant="text" size="x-small" :aria-label="comment.status==='RESOLVED'?'重新打开评论':'解决评论'" @click="resolveComment(comment)"/>
          </article>
        </div>
        <p v-else-if="!commentsLoading&&!commentsError" class="comment-empty"><span class="sr-only">暂无划词评论</span></p>
        <button v-if="!commentComposerOpen" type="button" class="comment-compose-trigger" @click="beginPageComment">添加全文评论</button>
        <form v-else class="comment-composer" @submit.prevent="addComment">
          <div v-if="composerQuote" class="comment-selection-summary" aria-label="选中文字"><span>评论选中文字</span><blockquote>{{composerQuote}}</blockquote></div>
          <textarea v-model="commentText" rows="3" maxlength="4000" placeholder="输入评论" aria-label="评论内容" @keydown.esc="cancelComment" />
          <div class="comment-composer-actions"><button type="button" @click="cancelComment">取消</button><button type="submit" class="primary" :disabled="!commentText.trim()||commentSubmitting">{{commentSubmitting?'发表中…':'发表'}}</button></div>
        </form>
      </template>
      <ReferencePanel v-else-if="page" :key="`${page.id}:${referenceInsertMode?'insert':'browse'}`" :page-id="page.id" :pages="siblingPages" :allow-insert="page.contentType==='DOCUMENT'&&!documentProtected&&referencePending" :initial-tab="referenceInsertMode?'INSERT':'OUTGOING'" @insert="insertReference" @open-page="handleReferencePageOpen"/>
    </aside>
    <PageManagementDialog v-if="page" v-model="managementOpen" :page="page" :initial-tab="managementTab" @updated="managementUpdated" @deleted="managementDeleted" @close="loadPublication"/>
    <AnalyticsDialog v-if="page" v-model="analyticsOpen" :page-id="page.id" :title="`${page.title} · 内容统计`"/>
    <ContentCardPalette v-if="page?.contentType==='DOCUMENT'&&!documentProtected" v-model="contentCardOpen" :allowed-kinds="contentCardKinds" :upload-handler="uploadContentCard" @insert="insertContentCard" @cancel="cancelContentCardInsert"/>
  </div>
</template>

<style scoped>
.editor-page {
  --catalog-width: 0px;
  position: relative;
  display: grid;
  width: 100%;
  height: 100dvh;
  min-height: 0;
  grid-template-columns: var(--catalog-width) minmax(0, 1fr) 31px;
  grid-template-rows: 52px auto;
  overflow-x: hidden;
  overflow-y: auto;
  color: #262626;
  background: #fff;
}
.editor-page.catalog-is-open { --catalog-width: 259px; }
.editor-page:not(.catalog-is-open) .editor-header { padding-left: 28px; }
.editor-overlay-scrim { position: fixed; inset: 0; border: 0; background: rgba(31,35,33,.18); cursor: default; }
.editor-overlay-scrim.catalog-overlay { z-index: 44; }
.editor-overlay-scrim.side-overlay { z-index: 38; }
.editor-overlay-scrim.outline-overlay { z-index: 17; }
.editor-header {
  position: sticky;
  top: 0;
  z-index: 40;
  display: flex;
  height: 52px;
  min-width: 0;
  grid-column: 2;
  grid-row: 1;
  align-items: center;
  justify-content: space-between;
  margin-right: 15px;
  padding: 0 17px 0 15px;
  border-bottom: 1px solid #f0f0f0;
  background: #fff;
}
.editor-header-left,
.editor-header-actions { display: flex; min-width: 0; align-items: center; }
.editor-header-left { gap: 3px; }
.editor-header-actions { flex: 0 0 auto; gap: 4px; }
.header-icon { color: #262626 !important; }
.header-icon :deep(.v-btn__overlay) { background: #e7e9e8; }
.page-type-icon { margin: 0 7px 0 3px; }
.header-document-title {
  overflow: hidden;
  max-width: min(300px, 24vw);
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.structured-title-input { width: min(300px,24vw); height: 32px; border: 0; outline: 0; background: transparent; color: #262626; font-size: 14px; font-weight: 500; }
.document-lock { margin-left: 7px; color: #a6aaa8; }
.editor-header-status { display: flex; height: 28px; align-items: center; gap: 5px; margin-left: 12px; color: #8a8f8d; font-size: 12px; white-space: nowrap; }
.editor-header-status.status-saved { color: #459b72; }
.editor-header-status.status-dirty,
.editor-header-status.status-saving { color: #8a8f8d; }
.editor-header-status.status-offline { color: #d97904; }
.editor-header-status.status-conflict { color: #d33b35; }
.collaboration-state { position: relative; display: flex; width: auto; min-width: 36px; height: 32px; align-items: center; justify-content: center; gap: 5px; padding: 0 10px 0 8px; border: 0; border-radius: 4px; background: transparent; color: #262626; cursor: pointer; }
.collaboration-state:hover { color: #262626; background: #f0f1f0; }
.collaboration-label { max-width: 80px; overflow: hidden; color: #707573; font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.collaboration-dot { position: absolute; right: 5px; bottom: 4px; width: 6px; height: 6px; border: 1px solid #fff; border-radius: 50%; background: #b7bbba; }
.collaboration-dot.collaboration-connected { background: #00b96b; }
.collaboration-dot.collaboration-connecting { background: #f0a020; }
.collaboration-dot.collaboration-unavailable { background: #b7bbba; }
.share-button,
.publish-button { width: 60px; height: 32px !important; min-width: 60px !important; border-radius: 5px !important; font-weight: 500; letter-spacing: 0 !important; text-transform: none !important; }
.share-button { margin-left: 6px; border-color: #d8dad9 !important; color: #262626 !important; background: #fff !important; }
.publish-button { margin-right: 5px; background: #00b96b !important; }
.header-action-cluster { display: flex; width: 70px; height: 36px; flex: 0 0 70px; align-items: center; justify-content: center; padding: 1px 2px; border: 1px solid #e1e3e2; border-radius: 6px; background: #fff; }
.header-action-cluster :deep(.v-btn) { width: 31px; min-width: 31px; height: 31px; }
.editor-more-menu { min-width: 196px !important; }
.editor-progress { position: fixed !important; top: 51px; right: 61px; left: var(--catalog-width); z-index: 42; }
.editor-error { position: fixed; top: 106px; right: 70px; left: calc(var(--catalog-width) + 24px); z-index: 35; display: flex; min-height: 44px; align-items: center; gap: 10px; padding: 10px 14px; border: 1px solid #ffd6d2; border-radius: 6px; color: #d33b35; background: #fff1f0; font-size: 14px; }
.editor-content { min-width: 0; min-height: calc(100dvh - 52px); grid-column: 2; grid-row: 2; overflow: visible; }
.editor-content--structured { overflow: hidden; }
.document-protection-notice { display: flex; width: min(700px,calc(100% - 48px)); min-height: 36px; align-items: center; gap: 8px; margin: 14px auto -4px; padding: 8px 12px; border: 1px solid #f0d8a8; border-radius: 6px; color: #7a5714; background: #fffaf0; font-size: 12px; line-height: 1.5; }
.editor-chrome-rail { position: sticky; top: 0; z-index: 38; height: 100dvh; grid-column: 3; grid-row: 1 / 3; align-self: start; border-left: 0; background: #fff; }
.editor-side-panel {
  position: fixed;
  top: 52px;
  right: 46px;
  z-index: 39;
  display: flex;
  height: calc(100dvh - 52px);
  flex-direction: column;
  overflow: hidden;
  border-left: 1px solid #eeeeed;
  background: #fff;
  box-shadow: none;
}
.editor-side-panel--comments { width: 305px; }
.editor-side-panel--references { width: 420px; }
.side-panel-header { display: flex; width: 100%; height: 52px; flex: 0 0 52px; align-items: center; justify-content: space-between; padding: 0 12px 0 20px; border-bottom: 1px solid #eeeeed; background: #fff; }
.side-panel-header strong { overflow: hidden; min-width: 0; color: #262626; font-size: 14px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.side-panel-header :deep(.v-btn) { width: 28px; min-width: 28px; height: 28px; color: #8a8f8d; }
.comment-progress { position: absolute !important; top: 51px; right: 0; left: 0; z-index: 2; }
.comment-notice { display: flex; min-height: 36px; flex: 0 0 auto; align-items: center; gap: 7px; margin: 10px 12px 0; padding: 7px 9px; border: 1px solid #ffd6d2; border-radius: 5px; color: #c9362e; background: #fff7f6; font-size: 12px; line-height: 1.45; }
.comment-notice span { min-width: 0; flex: 1; }
.comment-notice button { border: 0; color: inherit; background: transparent; font: inherit; font-weight: 600; cursor: pointer; }
.comment-list { min-height: 0; flex: 1 1 auto; overflow-y: auto; }
.comment-row { position: relative; display: grid; min-height: 76px; grid-template-columns: 30px minmax(0,1fr) 28px; align-items: start; gap: 9px; padding: 13px 8px 12px 14px; border-bottom: 1px solid #f0f1f0; }
.comment-row:hover { background: #fafbfa; }
.comment-row.resolved { opacity: .62; }
.comment-avatar { display: grid; width: 28px; height: 28px; place-items: center; border-radius: 50%; color: #245bc3; background: #eaf1ff; font-size: 12px; font-weight: 650; }
.comment-copy { min-width: 0; }
.comment-copy header { display: flex; min-width: 0; align-items: center; gap: 6px; }
.comment-copy header strong { overflow: hidden; min-width: 0; flex: 1; color: #454a48; font-size: 12px; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.comment-copy time { flex: 0 0 auto; color: #a6aaa8; font-size: 10px; }
.comment-quote { display: -webkit-box; margin: 5px 0 0; overflow: hidden; color: #8a8f8d; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
.comment-copy p { margin: 5px 0 0; color: #585a59; font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.comment-row :deep(.v-btn) { width: 28px; min-width: 28px; height: 28px; color: #8a8f8d; }
.comment-empty { min-height: 0; flex: 1 1 auto; margin: 0; }
.comment-compose-trigger { position: absolute; right: 14px; bottom: 14px; height: 30px; padding: 0 12px; border: 1px solid #dfe2e1; border-radius: 5px; opacity: 1; color: #585a59; background: #fff; box-shadow: 0 3px 12px rgba(0,0,0,.08); font-size: 12px; cursor: pointer; transform: translateY(0); transition: opacity .12s ease, transform .12s ease; }
.editor-side-panel--comments:hover .comment-compose-trigger,
.comment-compose-trigger:focus-visible { opacity: 1; transform: translateY(0); }
.comment-composer { flex: 0 0 auto; padding: 10px 12px 12px; border-top: 1px solid #eeeeed; background: #fff; }
.comment-selection-summary { margin: 0 0 8px; padding: 7px 9px; border-left: 3px solid #8eb0ec; color: #585a59; background: #f5f8fe; }
.comment-selection-summary span { display: block; margin-bottom: 3px; color: #7b8581; font-size: 10px; }
.comment-selection-summary blockquote { display: -webkit-box; margin: 0; overflow: hidden; font-size: 11px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
.comment-composer textarea { display: block; width: 100%; min-height: 74px; resize: vertical; padding: 9px 10px; border: 1px solid #dfe2e1; border-radius: 5px; outline: 0; color: #262626; background: #fff; font: 12px/1.55 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; }
.comment-composer textarea:focus { border-color: #83a9ee; box-shadow: 0 0 0 2px rgba(47,111,235,.08); }
.comment-composer-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 8px; }
.comment-composer button { height: 28px; padding: 0 11px; border: 1px solid #dfe2e1; border-radius: 4px; color: #585a59; background: #fff; font-size: 12px; cursor: pointer; }
.comment-composer button.primary { border-color: #2f6feb; color: #fff; background: #2f6feb; }
.comment-composer button:disabled { cursor: default; opacity: .48; }
.sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; border: 0; clip: rect(0,0,0,0); clip-path: inset(50%); white-space: nowrap; }
.editor-side-panel :deep(.reference-panel) { min-height: 0; flex: 1 1 auto; overflow-y: auto; }
.side-panel-comments .editor-content { width: calc(100% - 320px); }
.side-panel-references .editor-content { width: calc(100% - 435px); }

@media (hover: hover) and (pointer: fine) {
  .comment-compose-trigger { opacity: 0; transform: translateY(4px); }
}

.editor-catalog {
  position: sticky;
  top: 0;
  z-index: 45;
  display: flex;
  height: 100dvh;
  min-width: 0;
  grid-column: 1;
  grid-row: 1 / 3;
  flex-direction: column;
  align-self: start;
  overflow: hidden;
  border-right: 1px solid #eceeed;
  background: #fff;
}
.catalog-context-row,
.catalog-primary button,
.catalog-row { appearance: none; border: 0; color: inherit; background: transparent; font: inherit; cursor: pointer; }
.catalog-context-row { display: flex; width: 100%; height: 42px; flex: 0 0 42px; align-items: center; gap: 5px; padding: 0 15px; color: #8a8f8d; font-size: 12px; text-align: left; }
.catalog-context-row:hover { color: #585a59; background: #fafafa; }
.catalog-context-mark { display: grid; width: 18px; height: 18px; place-items: center; border-radius: 4px; color: #fff; background: #42b883; font-size: 10px; font-weight: 700; }
.catalog-context-row > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-book-row { display: flex; height: 58px; flex: 0 0 58px; align-items: center; gap: 8px; padding: 0 12px 0 15px; }
.catalog-book-icon { display: grid; width: 24px; height: 24px; flex: 0 0 24px; place-items: center; color: #c59636; font-size: 18px; }
.catalog-book-row strong { overflow: hidden; min-width: 0; flex: 1; color: #262626; font-size: 16px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.catalog-book-lock { color: #8a8f8d; }
.catalog-book-row :deep(.v-btn) { color: #8a8f8d; }
.catalog-book-row :deep(.catalog-switcher-button) { width: 22px; min-width: 22px; height: 28px; margin-left: -5px; }
.knowledge-base-switcher { width: 310px; max-height: 370px; overflow: hidden; border: 1px solid #e5e7e6; border-radius: 7px !important; color: #262626; background: #fff; }
.knowledge-base-tabs { display: flex; height: 39px; align-items: end; gap: 18px; padding: 0 17px; }
.knowledge-base-tabs button { position: relative; height: 32px; padding: 0 2px; border: 0; color: #8a8f8d; background: transparent; font-size: 12px; cursor: pointer; }
.knowledge-base-tabs button.active { color: #262626; font-weight: 600; }
.knowledge-base-tabs button.active::after { position: absolute; right: 2px; bottom: 0; left: 2px; height: 2px; border-radius: 1px; background: #2f6feb; content: ''; }
.knowledge-base-search { display: flex; height: 42px; align-items: center; gap: 7px; margin: 0 12px; color: #a6aaa8; }
.knowledge-base-search input { min-width: 0; height: 30px; flex: 1; padding: 0 6px; border: 0; outline: 0; color: #262626; background: transparent; font-size: 13px; }
.knowledge-base-search input::placeholder { color: #b0b4b2; }
.knowledge-base-list { max-height: 287px; overflow-y: auto; padding: 0 8px 8px; scrollbar-width: thin; }
.knowledge-base-list button { display: grid; width: 100%; height: 57px; grid-template-columns: 29px minmax(0,1fr) 18px; align-items: center; gap: 9px; padding: 0 10px; border: 0; border-bottom: 1px solid #f1f2f1; border-radius: 4px; color: #454a48; background: #fff; text-align: left; cursor: pointer; }
.knowledge-base-list button:hover,
.knowledge-base-list button.active { background: #f6f7f7; }
.knowledge-base-list button strong { overflow: hidden; min-width: 0; font-size: 13px; font-weight: 500; text-overflow: ellipsis; white-space: nowrap; }
.knowledge-base-list button > .v-icon { color: #8a8f8d; }
.knowledge-base-icon { display: grid; width: 26px; height: 26px; place-items: center; color: #6f91c7; font-size: 18px; }
.knowledge-base-list button.active .knowledge-base-icon { color: #c59636; }
.knowledge-base-list > p { margin: 0; padding: 48px 12px; color: #a6aaa8; font-size: 12px; text-align: center; }
.catalog-search { display: flex; height: 36px; flex: 0 0 36px; align-items: center; gap: 7px; margin: 10px 8px 7px; padding: 0 9px; border: 1px solid transparent; border-radius: 6px; color: #8a8f8d; background: #f4f5f5; }
.catalog-search:focus-within { border-color: #9bbbf0; background: #fff; box-shadow: 0 0 0 2px rgba(47,111,235,.07); }
.catalog-search input { min-width: 0; flex: 1; border: 0; outline: 0; color: #262626; background: transparent; font-size: 13px; }
.catalog-search kbd { color: #b0b4b2; font: 11px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; white-space: nowrap; }
.catalog-primary { display: flex; flex: 0 0 auto; flex-direction: column; padding: 0 8px 5px; }
.catalog-primary button { display: flex; width: 100%; height: 36px; align-items: center; gap: 10px; padding: 0 10px; border-radius: 5px; color: #4f5452; font-size: 14px; text-align: left; }
.catalog-primary button:hover,
.catalog-primary button.active { color: #262626; background: #f1f2f2; }
.catalog-primary button.active { font-weight: 550; }
.catalog-count { margin-left: auto; color: #a6aaa8; font-size: 11px; font-weight: 400; }
.catalog-list { min-height: 0; flex: 1 1 auto; overflow: auto; padding: 2px 8px 26px; scrollbar-width: thin; }
.catalog-row { display: flex; width: 100%; min-height: 34px; align-items: center; gap: 7px; padding: 6px 8px 6px calc(10px + var(--catalog-indent)); border-radius: 5px; color: #585a59; font: 13px/1.3 -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC',sans-serif; text-align: left; }
.catalog-row > span { overflow: hidden; min-width: 0; flex: 1; text-overflow: ellipsis; white-space: nowrap; }
.catalog-row:hover { color: #262626; background: #f2f3f3; }
.catalog-row.active { color: #262626; background: #e9ebea; font-weight: 600; }
.catalog-row.group { margin-top: 5px; color: #454a48; font-weight: 500; }
.catalog-row:disabled { cursor: default; opacity: 1; }
.catalog-empty { padding: 38px 12px; color: #b0b4b2; font-size: 13px; text-align: center; }
.catalog-bottom-count { position: absolute; bottom: 4px; left: 263px; z-index: 47; color: #a6aaa8; font-size: 11px; white-space: nowrap; transform: translateX(-100%); pointer-events: none; }
.catalog-edge-trigger { position: fixed; top: 198px; left: 0; z-index: 46; display: grid; width: 14px; height: 44px; place-items: center; border: 1px solid #e1e3e2; border-left: 0; border-radius: 0 6px 6px 0; color: #8a8f8d; background: #fff; box-shadow: 0 2px 7px rgba(0,0,0,.06); cursor: pointer; }
.catalog-edge-trigger:hover { color: #262626; background: #f0f1f0; }
.editor-word-count { position: fixed; bottom: 5px; left: 7px; z-index: 20; color: #a6aaa8; font-size: 12px; pointer-events: none; }
.catalog-is-open .editor-word-count { display: none; }

@media (min-width: 1101px) {
  .editor-page,
  .editor-page.catalog-is-open { grid-template-columns: minmax(0,1fr) 31px; }
  .editor-header,
  .editor-content { grid-column: 1; }
  .editor-chrome-rail { grid-column: 2; }
  .editor-catalog {
    position: fixed;
    inset: 0 auto 0 0;
    width: 259px;
    height: auto;
    align-self: auto;
  }
}

@media (max-width: 1100px) {
  .editor-page,
  .editor-page.catalog-is-open { --catalog-width: 0px; grid-template-columns: 0 minmax(0,1fr); }
  .editor-header { margin-right: 0; }
  .editor-chrome-rail { display: none; }
  .editor-side-panel { right: 0; }
  .editor-catalog { position: fixed; top: 0; bottom: 0; left: 0; width: min(82vw,300px); box-shadow: 10px 0 34px rgba(0,0,0,.1); }
  .editor-header-status { display: none; }
  .header-document-title { max-width: 22vw; }
  .collaboration-state { width: 36px; padding: 0; }
  .collaboration-state .collaboration-label { display: none; }
  .editor-progress { right: 0; }
  .editor-error { right: 24px; left: 24px; }
  .catalog-bottom-count { left: min(82vw,300px); }
  .side-panel-comments .editor-content,
  .side-panel-references .editor-content { width: 100%; }
}
@media (max-width: 600px) {
  .editor-header { padding: 0 5px; }
  .catalog-header-toggle,
  .document-lock,
  .share-button :deep(.v-btn__prepend),
  .collaboration-state { display: none !important; }
  .page-type-icon { margin-right: 4px; }
  .header-document-title { max-width: 24vw; }
  .share-button,
  .publish-button { min-width: 48px !important; padding: 0 8px !important; }
  .editor-header-actions { gap: 0; }
  .editor-error { right: 10px; left: 10px; }
  .catalog-edge-trigger { left: 0; }
  .editor-side-panel--references { width: min(100vw,420px); }
  .editor-side-panel--comments { width: min(100vw,305px); }
  .comment-compose-trigger { opacity: 1; transform: translateY(0); }
  .document-protection-notice { width: calc(100% - 24px); margin-top: 10px; }
}
</style>
