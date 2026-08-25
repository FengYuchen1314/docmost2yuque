<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { Comment, Page } from '../../../src/types'
import PublicContentRenderer from '../../components/PublicContentRenderer.vue'
import PublicLayout from '../../layouts/PublicLayout.vue'
import { downloadPublic, messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'

interface Publication {
  id: string; pageId: string; contentType: Page['contentType']; title: string; content: unknown
  plainText: string; schemaVersion: number; metadata?: { icon?: string | null; labels?: string[] }; publishedAt: string
}
interface SharedKbPage { pageId: string; publicationId: string; title: string; path: string; contentType: Page['contentType'] }
interface SharedKb { id: string; name: string; description: string | null; icon: string | null; pages: SharedKbPage[]; selectedPageId: string | null }
interface QuickNote { id: string; sourceRevision: number; content: unknown; plainText: string; capturedAt: string }
interface ShareResolution {
  share: { id: string; resourceType: string; resourceId: string; shareType: string; role: string; allowCopy: boolean; allowDownload: boolean; allowExport: boolean; allowComment: boolean; allowSearchIndex: boolean; expiresAt: string | null }
  passwordRequired: boolean
  approvalRequired: boolean
  approvalStatus: 'AUTHENTICATION_REQUIRED' | 'NOT_REQUESTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | null
  publication: Publication | null
  knowledgeBase?: SharedKb | null
  quickNote?: QuickNote | null
  acceptanceRequired?: boolean
  destinationKnowledgeBaseId?: string | null
}
interface ShareAcceptance { resourceType: 'PAGE' | 'KNOWLEDGE_BASE'; resourceId: string; knowledgeBaseId: string; role: string; alreadyAccepted: boolean }
interface CommentPage { items: Comment[]; nextOffset: number; hasMore: boolean }

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const token = computed(() => typeof route.params.token === 'string' ? route.params.token : '')
const pageId = computed(() => typeof route.query.page === 'string' ? route.query.page : null)
const loginRoute = computed(() => ({ path: '/login', query: { returnTo: route.fullPath } }))
const viewer = computed(() => session.user)
const accessToken = ref('')
const password = ref('')
const requestMessage = ref('')
const resolution = ref<ShareResolution | null>(null)
const acceptance = ref<ShareAcceptance | null>(null)
const loading = ref(true)
const resolveError = ref('')
const passwordError = ref('')
const approvalError = ref('')
const inviteError = ref('')
const verifyBusy = ref(false)
const approvalBusy = ref(false)
const inviteBusy = ref(false)
const operationBusy = ref<'download' | 'export' | null>(null)
const operationError = ref('')
const notice = ref('')
const noticeOpen = ref(false)

const comments = ref<Comment[]>([])
const commentsLoading = ref(false)
const commentsError = ref('')
const commentsOffset = ref(0)
const commentsHasMore = ref(false)
const commentDraft = ref('')
const replyTo = ref<Comment | null>(null)
const commentBusy = ref(false)
const deletingCommentId = ref('')
const pendingDelete = ref<Comment | null>(null)

const commentRoots = computed(() => comments.value.filter(comment => !comment.parentId))
const selectedPageId = computed(() => resolution.value?.knowledgeBase?.selectedPageId ?? pageId.value)
const inviteState = computed(() => {
  const value = resolution.value
  return Boolean(value?.share.shareType === 'INVITE_LINK' && !value.publication && !value.knowledgeBase && !value.quickNote)
})
const inviteAccepted = computed(() => Boolean(acceptance.value || (inviteState.value && !resolution.value?.acceptanceRequired)))
const inviteTarget = computed<ShareAcceptance | null>(() => acceptance.value ?? (resolution.value ? {
  resourceType: resolution.value.share.resourceType as ShareAcceptance['resourceType'],
  resourceId: resolution.value.share.resourceId,
  knowledgeBaseId: resolution.value.destinationKnowledgeBaseId ?? resolution.value.share.resourceId,
  role: resolution.value.share.role,
  alreadyAccepted: inviteAccepted.value,
} : null))
const inviteWorkspaceRoute = computed(() => {
  const target = inviteTarget.value
  if (!target) return '/app'
  return target.resourceType === 'KNOWLEDGE_BASE' ? `/app/kb/${target.resourceId}` : `/app/kb/${target.knowledgeBaseId}/pages/${target.resourceId}`
})

let ready = false
let resolveSequence = 0
let commentSequence = 0
let approvalTimer: number | undefined

onMounted(async () => {
  if (!session.ready) await session.loadUser()
  accessToken.value = storedToken(token.value)
  ready = true
  await resolveShare()
})
watch([token, pageId], ([nextToken], [previousToken]) => {
  if (!ready) return
  if (nextToken !== previousToken) {
    accessToken.value = storedToken(nextToken)
    resolution.value = null
    acceptance.value = null
    password.value = ''
  }
  resetComments()
  void resolveShare()
})
onBeforeUnmount(() => { window.clearTimeout(approvalTimer); commentSequence += 1 })

function storedToken(value: string) { return sessionStorage.getItem(`share-access:${value}`) ?? '' }
function showNotice(value: string) { notice.value = value; noticeOpen.value = false; window.setTimeout(() => { noticeOpen.value = true }, 0) }
function resetComments() {
  commentSequence += 1; comments.value = []; commentsOffset.value = 0; commentsHasMore.value = false
  commentsError.value = ''; commentsLoading.value = false; commentDraft.value = ''; replyTo.value = null
}
function scheduleApprovalRefresh() {
  window.clearTimeout(approvalTimer)
  if (resolution.value?.approvalStatus === 'PENDING') approvalTimer = window.setTimeout(() => void resolveShare(), 15_000)
}

async function resolveShare() {
  const sequence = ++resolveSequence
  loading.value = true; resolveError.value = ''; window.clearTimeout(approvalTimer)
  try {
    const value = await post<ShareResolution>('/api/v1/shares/resolve', { token: token.value, accessToken: accessToken.value || null, pageId: pageId.value }, false)
    if (sequence !== resolveSequence) return
    resolution.value = value
    resetComments()
    if (value.publication && value.share.allowComment) void loadComments(true)
  } catch (value) {
    if (sequence === resolveSequence) resolveError.value = messageOf(value)
  } finally {
    if (sequence === resolveSequence) { loading.value = false; scheduleApprovalRefresh() }
  }
}
async function verifyPassword() {
  if (!password.value || verifyBusy.value) return
  verifyBusy.value = true; passwordError.value = ''
  try {
    const value = await post<{ accessToken: string }>('/api/v1/shares/verify-password', { token: token.value, password: password.value }, false)
    accessToken.value = value.accessToken
    sessionStorage.setItem(`share-access:${token.value}`, value.accessToken)
    password.value = ''
    await resolveShare()
  } catch (value) { passwordError.value = messageOf(value) } finally { verifyBusy.value = false }
}
async function requestAccess() {
  if (approvalBusy.value) return
  approvalBusy.value = true; approvalError.value = ''
  try {
    await post('/api/v1/shares/request-join', { token: token.value, accessToken: accessToken.value || null, message: requestMessage.value.trim() || null })
    requestMessage.value = ''
    await resolveShare()
  } catch (value) { approvalError.value = messageOf(value) } finally { approvalBusy.value = false }
}
async function acceptInvite() {
  if (!viewer.value || inviteBusy.value) return
  inviteBusy.value = true; inviteError.value = ''
  try {
    acceptance.value = await post<ShareAcceptance>('/api/v1/shares/accept-invite', { token: token.value, accessToken: accessToken.value || null })
    await resolveShare()
  } catch (value) { inviteError.value = messageOf(value) } finally { inviteBusy.value = false }
}
async function save(kind: 'download' | 'export') {
  if (operationBusy.value) return
  operationBusy.value = kind; operationError.value = ''
  try {
    await downloadPublic(`/api/v1/shares/${kind}`, { token: token.value, accessToken: accessToken.value || null, pageId: pageId.value })
    showNotice(kind === 'download' ? '下载已开始' : '导出已开始')
  } catch (value) { operationError.value = messageOf(value) } finally { operationBusy.value = null }
}
function handleCopy(event: ClipboardEvent) {
  if (!resolution.value?.share.allowCopy) { event.preventDefault(); showNotice('链接所有者已关闭复制') }
  else showNotice('内容已复制')
}
function pageRoute(value: string) { return { path: route.path, query: { ...route.query, page: value } } }
function selectPage(value: unknown) { if (typeof value === 'string' && value !== pageId.value) void router.push(pageRoute(value)) }

async function loadComments(reset = false) {
  const publicationPageId = resolution.value?.publication?.pageId
  if (!resolution.value?.share.allowComment || !publicationPageId || commentsLoading.value || (!reset && !commentsHasMore.value)) return
  const sequence = reset ? ++commentSequence : commentSequence
  const offset = reset ? 0 : commentsOffset.value
  commentsLoading.value = true; commentsError.value = ''
  try {
    const value = await post<CommentPage>('/api/v1/shares/comments/page', { token: token.value, accessToken: accessToken.value || null, pageId: publicationPageId, limit: 30, offset }, false)
    if (sequence !== commentSequence || publicationPageId !== resolution.value?.publication?.pageId) return
    if (reset) comments.value = value.items
    else {
      const merged = new Map(comments.value.map(comment => [comment.id, comment]))
      value.items.forEach(comment => merged.set(comment.id, comment)); comments.value = [...merged.values()]
    }
    commentsOffset.value = value.nextOffset; commentsHasMore.value = value.hasMore
  } catch (value) { if (sequence === commentSequence) commentsError.value = messageOf(value) }
  finally { if (sequence === commentSequence) commentsLoading.value = false }
}
function repliesFor(id: string) { return comments.value.filter(comment => comment.parentId === id) }
async function createComment() {
  const publicationPageId = resolution.value?.publication?.pageId
  const plainText = commentDraft.value.trim()
  if (!viewer.value || !publicationPageId || !plainText || commentBusy.value) return
  commentBusy.value = true; commentsError.value = ''
  try {
    await post<Comment>('/api/v1/shares/comments/create', {
      token: token.value, accessToken: accessToken.value || null, pageId: publicationPageId,
      parentId: replyTo.value?.id ?? null, anchor: { kind: 'SHARED_PAGE' },
      body: { type: 'doc', content: [{ type: 'paragraph', text: plainText }] }, plainText,
    })
    commentDraft.value = ''; replyTo.value = null; await loadComments(true); showNotice('评论已发送')
  } catch (value) { commentsError.value = messageOf(value) } finally { commentBusy.value = false }
}
async function deleteComment() {
  const comment = pendingDelete.value
  const publicationPageId = resolution.value?.publication?.pageId
  if (!comment || !publicationPageId || deletingCommentId.value) return
  deletingCommentId.value = comment.id; commentsError.value = ''
  try {
    await post('/api/v1/shares/comments/delete', { token: token.value, accessToken: accessToken.value || null, pageId: publicationPageId, commentId: comment.id })
    pendingDelete.value = null; await loadComments(true); showNotice('评论已删除')
  } catch (value) { commentsError.value = messageOf(value) } finally { deletingCommentId.value = '' }
}
function closeDeleteDialog(value: boolean) { if (!value && !deletingCommentId.value) pendingDelete.value = null }
function roleLabel(value: string) { return value === 'EDITOR' ? '可编辑邀请' : value === 'COMMENTER' ? '可评论' : '只读' }
function dateTime(value?: string | null) { if (!value) return ''; const date = new Date(value); return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN') }
function relativeTime(value: string) {
  const time = new Date(value).getTime(); if (Number.isNaN(time)) return value
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000))
  if (minutes < 1) return '刚刚'; if (minutes < 60) return `${minutes} 分钟前`; if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return new Date(time).toLocaleDateString('zh-CN')
}
</script>

<template>
  <PublicLayout>
    <main class="share-page">
      <div v-if="loading && !resolution" class="initial-loading"><v-progress-circular indeterminate color="primary" size="46"/><p>正在验证分享链接…</p></div>
      <v-card v-else-if="resolveError && !resolution" class="share-state section-card pa-8">
        <v-icon color="error" size="52">mdi-link-off</v-icon><h1>分享链接不可用</h1><p>{{ resolveError }}</p>
        <v-btn variant="outlined" prepend-icon="mdi-refresh" class="mt-5" :loading="loading" @click="resolveShare">重新尝试</v-btn>
      </v-card>
      <v-card v-else-if="resolution?.passwordRequired" class="share-state section-card pa-8">
        <v-icon color="primary" size="52">mdi-lock-outline</v-icon><h1>输入访问密码</h1><p>验证结果只保存在当前浏览器会话。</p>
        <v-form class="mt-5" @submit.prevent="verifyPassword">
          <v-text-field v-model="password" type="password" label="访问密码" autocomplete="current-password" prepend-inner-icon="mdi-key-outline" autofocus/>
          <v-alert v-if="passwordError" type="error" variant="tonal" class="mb-4">{{ passwordError }}</v-alert>
          <v-btn type="submit" color="primary" size="large" block :disabled="!password" :loading="verifyBusy">验证并阅读</v-btn>
        </v-form>
      </v-card>
      <v-card v-else-if="resolution?.approvalRequired" class="share-state section-card pa-8">
        <v-icon color="primary" size="52">mdi-shield-lock-outline</v-icon>
        <template v-if="!viewer || resolution.approvalStatus === 'AUTHENTICATION_REQUIRED'">
          <h1>登录后申请访问</h1><p>链接所有者开启了访问审批，登录后提交申请，批准后即可阅读。</p>
          <v-btn :to="loginRoute" color="primary" size="large" block class="mt-5">登录并继续</v-btn>
        </template>
        <template v-else-if="resolution.approvalStatus === 'PENDING'">
          <h1>申请正在等待审批</h1><p>所有者批准后会自动开放；此页面每 15 秒检查一次。</p>
          <v-btn variant="outlined" prepend-icon="mdi-refresh" block class="mt-5" :loading="loading" @click="resolveShare">立即刷新</v-btn>
        </template>
        <template v-else>
          <h1>{{ resolution.approvalStatus === 'REJECTED' ? '访问申请未通过' : '申请访问' }}</h1>
          <p>{{ resolution.approvalStatus === 'REJECTED' ? '可以补充说明后再次提交。' : '向链接所有者说明你的访问用途。' }}</p>
          <v-form class="mt-5" @submit.prevent="requestAccess">
            <v-textarea v-model="requestMessage" label="申请说明（可选）" maxlength="500" counter rows="4"/>
            <v-alert v-if="approvalError" type="error" variant="tonal" class="mb-4">{{ approvalError }}</v-alert>
            <v-btn type="submit" color="primary" size="large" block :loading="approvalBusy">提交申请</v-btn>
          </v-form>
        </template>
      </v-card>
      <v-card v-else-if="inviteState" class="share-state section-card pa-8">
        <v-icon :color="inviteAccepted ? 'success' : 'primary'" size="52">{{ inviteAccepted ? 'mdi-check-circle-outline' : 'mdi-account-multiple-plus-outline' }}</v-icon>
        <h1>{{ inviteAccepted ? '邀请已接受' : '接受资源邀请' }}</h1>
        <p>{{ inviteAccepted ? '权限已经写入当前邮箱账号，之后无需保留此链接。' : `接受后将获得“${roleLabel(resolution?.share.role ?? '')}”权限，并绑定到当前邮箱账号。` }}</p>
        <v-alert v-if="inviteError" type="error" variant="tonal" class="mt-5">{{ inviteError }}</v-alert>
        <v-btn v-if="inviteAccepted" :to="inviteWorkspaceRoute" color="primary" size="large" block class="mt-5">打开工作区</v-btn>
        <v-btn v-else-if="viewer" color="primary" size="large" block class="mt-5" :loading="inviteBusy" @click="acceptInvite">接受邀请</v-btn>
        <v-btn v-else :to="loginRoute" color="primary" size="large" block class="mt-5">登录并接受</v-btn>
      </v-card>
      <section v-else-if="resolution" class="shared-reader">
        <v-progress-linear v-if="loading" indeterminate color="primary" class="reader-progress"/>
        <div class="shared-bar">
          <div class="summary"><v-icon>mdi-shield-check-outline</v-icon><strong>安全分享</strong><v-chip size="small" variant="tonal">{{ roleLabel(resolution.share.role) }}</v-chip><v-chip size="small" variant="tonal" :color="resolution.share.allowCopy ? 'success' : 'warning'" :prepend-icon="resolution.share.allowCopy ? 'mdi-content-copy' : 'mdi-content-copy-off'">{{ resolution.share.allowCopy ? '允许复制' : '已限制复制' }}</v-chip><small v-if="resolution.share.expiresAt">{{ dateTime(resolution.share.expiresAt) }} 失效</small></div>
          <div class="actions"><v-btn v-if="resolution.share.allowDownload" variant="text" prepend-icon="mdi-download" :loading="operationBusy === 'download'" :disabled="operationBusy !== null" @click="save('download')">{{ resolution.knowledgeBase ? '下载整库文本' : '下载文本' }}</v-btn><v-btn v-if="resolution.share.allowExport" variant="text" prepend-icon="mdi-code-json" :loading="operationBusy === 'export'" :disabled="operationBusy !== null" @click="save('export')">{{ resolution.knowledgeBase ? '导出整库 JSON' : '导出 JSON' }}</v-btn></div>
        </div>
        <v-alert v-if="resolveError" type="error" variant="tonal" class="mb-4"><div class="alert-row"><span>{{ resolveError }}</span><v-btn variant="text" size="small" @click="resolveShare">重试</v-btn></div></v-alert>
        <v-alert v-if="operationError" type="error" variant="tonal" closable class="mb-4" @click:close="operationError = ''">{{ operationError }}</v-alert>
        <v-select v-if="resolution.knowledgeBase" class="mobile-picker" :model-value="selectedPageId" :items="resolution.knowledgeBase.pages" item-title="title" item-value="pageId" label="选择知识库文稿" hide-details @update:model-value="selectPage"/>
        <div class="shared-layout" :class="{ 'with-catalog': resolution.knowledgeBase }">
          <aside v-if="resolution.knowledgeBase">
            <header><span>{{ resolution.knowledgeBase.icon || '📘' }}</span><div><strong>{{ resolution.knowledgeBase.name }}</strong><p>{{ resolution.knowledgeBase.description || '共享知识库' }}</p></div></header>
            <v-list v-if="resolution.knowledgeBase.pages.length" nav><v-list-item v-for="page in resolution.knowledgeBase.pages" :key="page.pageId" :to="pageRoute(page.pageId)" :title="page.title" :subtitle="page.path ? `/${page.path}` : undefined" prepend-icon="mdi-file-document-outline" :active="selectedPageId === page.pageId" rounded="lg"/></v-list>
            <p v-else class="catalog-empty">这个知识库还没有已发布文稿。</p>
          </aside>
          <section class="content-column">
            <article v-if="resolution.publication" class="content-card" :class="{ 'copy-disabled': !resolution.share.allowCopy }" @copy="handleCopy">
              <header><span class="page-icon">{{ resolution.publication.metadata?.icon || '📄' }}</span><h1>{{ resolution.publication.title }}</h1><p>发布于 {{ dateTime(resolution.publication.publishedAt) }} · 快照版本 {{ resolution.publication.schemaVersion }}</p><div class="labels"><v-chip v-for="label in resolution.publication.metadata?.labels" :key="label" size="small" variant="outlined">{{ label }}</v-chip></div></header>
              <PublicContentRenderer :content-type="resolution.publication.contentType" :content="resolution.publication.content" :plain-text="resolution.publication.plainText"/>
            </article>
            <article v-else-if="resolution.quickNote" class="content-card" :class="{ 'copy-disabled': !resolution.share.allowCopy }" @copy="handleCopy">
              <header><span class="page-icon">📝</span><h1>共享小记</h1><p>捕获于 {{ dateTime(resolution.quickNote.capturedAt) }} · 来源版本 {{ resolution.quickNote.sourceRevision }}</p></header>
              <PublicContentRenderer content-type="DOCUMENT" :content="resolution.quickNote.content" :plain-text="resolution.quickNote.plainText"/>
            </article>
            <v-card v-else class="empty-content pa-8" variant="flat"><v-icon size="52">mdi-book-open-page-variant-outline</v-icon><h2>{{ resolution.knowledgeBase?.pages.length ? '所选文稿暂无可阅读快照' : '还没有可阅读的发布内容' }}</h2><p>{{ resolution.knowledgeBase?.pages.length ? '请选择其他已发布文稿。' : '未发布草稿和受限内容不会显示在这里。' }}</p></v-card>

            <v-card v-if="resolution.publication && resolution.share.allowComment" class="comments-card" variant="flat">
              <header class="comments-heading"><div><v-icon color="primary">mdi-comment-text-multiple-outline</v-icon><div><h2>评论</h2><p>通过此分享链接参与讨论。</p></div></div><v-chip size="small" variant="tonal">{{ comments.length }}{{ commentsHasMore ? '+' : '' }}</v-chip></header>
              <v-alert type="info" variant="tonal" density="compact" class="mb-5">已解决状态可查看；分享接口暂不提供解决或重新打开操作，请在工作区处理。</v-alert>
              <v-alert v-if="commentsError" type="error" variant="tonal" class="mb-4"><div class="alert-row"><span>{{ commentsError }}</span><v-btn variant="text" size="small" @click="loadComments(true)">重试</v-btn></div></v-alert>
              <div v-if="commentsLoading && !comments.length" class="comments-state"><v-progress-circular indeterminate color="primary" size="28"/>正在读取评论…</div>
              <div v-else-if="!comments.length && !commentsError" class="comments-state"><v-icon>mdi-comment-outline</v-icon>还没有评论，可以留下第一条。</div>
              <div v-else class="comment-list">
                <article v-for="comment in commentRoots" :key="comment.id" class="thread">
                  <div class="comment"><v-avatar color="primary" variant="tonal" size="34">{{ comment.creatorEmail.slice(0, 1).toUpperCase() }}</v-avatar><div class="comment-body"><header><strong>{{ comment.creatorEmail }}</strong><time>{{ relativeTime(comment.createdAt) }}</time><v-chip v-if="comment.status === 'RESOLVED'" color="success" size="x-small" prepend-icon="mdi-check">已解决</v-chip></header><p>{{ comment.plainText }}</p><footer v-if="viewer"><v-btn variant="text" size="small" prepend-icon="mdi-reply" @click="replyTo = comment">回复</v-btn><v-btn v-if="comment.createdBy === viewer.userId" variant="text" size="small" color="error" prepend-icon="mdi-delete-outline" @click="pendingDelete = comment">删除</v-btn></footer></div></div>
                  <div v-for="reply in repliesFor(comment.id)" :key="reply.id" class="comment reply"><v-avatar color="secondary" variant="tonal" size="30">{{ reply.creatorEmail.slice(0, 1).toUpperCase() }}</v-avatar><div class="comment-body"><header><strong>{{ reply.creatorEmail }}</strong><time>{{ relativeTime(reply.createdAt) }}</time><v-chip v-if="reply.status === 'RESOLVED'" color="success" size="x-small">已解决</v-chip></header><p>{{ reply.plainText }}</p><footer v-if="viewer && reply.createdBy === viewer.userId"><v-btn variant="text" size="small" color="error" prepend-icon="mdi-delete-outline" @click="pendingDelete = reply">删除</v-btn></footer></div></div>
                </article>
              </div>
              <v-btn v-if="commentsHasMore" variant="outlined" block class="mb-5" :loading="commentsLoading" @click="loadComments(false)">加载更多评论</v-btn>
              <v-form v-if="viewer" class="composer" @submit.prevent="createComment">
                <div v-if="replyTo" class="reply-banner"><span>正在回复 {{ replyTo.creatorEmail }}</span><v-btn icon="mdi-close" size="x-small" variant="text" @click="replyTo = null"/></div>
                <v-textarea v-model="commentDraft" :label="replyTo ? '写下回复…' : '写下评论…'" maxlength="20000" counter rows="3" auto-grow hide-details="auto"/>
                <div class="composer-footer"><small>评论会同步到文稿协作区</small><v-btn type="submit" color="primary" prepend-icon="mdi-send" :disabled="!commentDraft.trim()" :loading="commentBusy">发送</v-btn></div>
              </v-form>
              <div v-else class="comments-login"><div><strong>登录后参与讨论</strong><p>阅读评论无需登录，发言需要邮箱账号。</p></div><v-btn :to="loginRoute" variant="outlined" color="primary">登录后评论</v-btn></div>
            </v-card>
          </section>
        </div>
      </section>
      <v-snackbar v-model="noticeOpen" location="bottom" :timeout="2200">{{ notice }}</v-snackbar>
      <v-dialog :model-value="Boolean(pendingDelete)" max-width="460" @update:model-value="closeDeleteDialog"><v-card><v-card-title class="pt-6 px-6">删除这条评论？</v-card-title><v-card-text class="px-6">删除后无法恢复，其他参与者也将不再看到它。</v-card-text><v-card-actions class="px-6 pb-6"><v-spacer/><v-btn variant="text" :disabled="Boolean(deletingCommentId)" @click="pendingDelete = null">取消</v-btn><v-btn color="error" variant="flat" :loading="Boolean(deletingCommentId)" @click="deleteComment">永久删除</v-btn></v-card-actions></v-card></v-dialog>
    </main>
  </PublicLayout>
</template>

<style scoped>
.share-page{min-height:calc(100vh - 64px);background:#f8fafc;padding:40px 24px 72px}.initial-loading{min-height:55vh;display:grid;place-content:center;justify-items:center;gap:18px;color:#64748b}.share-state{width:min(520px,100%);margin:7vh auto 0;text-align:center;border-radius:22px}.share-state h1{font-size:clamp(26px,4vw,32px);margin:20px 0 8px}.share-state p{color:#64748b}.shared-reader{width:min(1320px,100%);margin:auto}.reader-progress{position:sticky;top:64px;z-index:5}.shared-bar{min-height:58px;display:flex;align-items:center;justify-content:space-between;gap:14px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:9px 16px;margin-bottom:18px}.summary,.actions{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.summary small{color:#64748b}.alert-row{display:flex;align-items:center;justify-content:space-between;gap:12px}.shared-layout{max-width:920px;margin:auto}.shared-layout.with-catalog{max-width:1260px;display:grid;grid-template-columns:280px minmax(0,1fr);gap:24px}.shared-layout>aside,.content-card,.empty-content,.comments-card{background:#fff;border:1px solid #e2e8f0;border-radius:20px}.shared-layout>aside{padding:18px;height:max-content;position:sticky;top:86px;max-height:calc(100vh - 110px);overflow:auto}.shared-layout>aside>header{display:flex;gap:12px;padding:4px 4px 14px}.shared-layout>aside>header>span{font-size:28px}.shared-layout>aside p{color:#64748b;margin:3px 0}.catalog-empty{text-align:center;padding:22px 8px}.mobile-picker{display:none;background:#fff;padding:12px;border:1px solid #e2e8f0;border-radius:16px;margin-bottom:16px}.content-column{min-width:0}.content-card{padding:clamp(28px,6vw,70px);min-height:420px}.content-card>header{margin-bottom:42px}.page-icon{display:block;font-size:44px;margin-bottom:12px}.content-card h1{font-size:clamp(34px,5vw,48px);line-height:1.12;letter-spacing:-.045em;margin:0 0 12px;overflow-wrap:anywhere}.content-card header p,.empty-content p{color:#64748b}.labels{display:flex;gap:7px;flex-wrap:wrap}.copy-disabled{user-select:none;-webkit-user-select:none}.empty-content{text-align:center}.comments-card{margin-top:24px;padding:clamp(20px,4vw,32px)}.comments-heading{display:flex;justify-content:space-between;gap:14px;margin-bottom:20px}.comments-heading>div{display:flex;gap:11px}.comments-heading h2{margin:0}.comments-heading p{margin:2px 0;color:#64748b}.comments-state{min-height:110px;display:flex;align-items:center;justify-content:center;gap:10px;color:#64748b}.comment-list{display:grid;gap:18px;margin-bottom:20px}.thread{border-bottom:1px solid #eef2f6;padding-bottom:18px}.comment{display:flex;gap:12px;align-items:flex-start}.comment-body{flex:1;min-width:0}.comment-body header{display:flex;align-items:center;gap:9px;flex-wrap:wrap}.comment-body time{font-size:12px;color:#94a3b8}.comment-body p{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.65;margin:7px 0}.reply{margin:14px 0 0 46px;padding:14px;background:#f8fafc;border-radius:14px}.composer{border-top:1px solid #e2e8f0;padding-top:20px}.reply-banner{display:flex;justify-content:space-between;align-items:center;background:#eff6ff;color:#1d4ed8;padding:8px 12px;border-radius:10px;margin-bottom:8px}.composer-footer,.comments-login{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-top:12px}.composer-footer small,.comments-login p{color:#64748b}.comments-login{background:#f8fafc;padding:16px;border-radius:14px}.comments-login p{margin:3px 0 0}
@media(max-width:900px){.share-page{padding:24px 16px 56px}.shared-layout.with-catalog{display:block}.shared-layout>aside{display:none}.mobile-picker{display:block}.shared-bar{align-items:flex-start;flex-direction:column}.actions{width:100%}.content-card{padding:30px 22px}.reply{margin-left:20px}.comments-login,.composer-footer{align-items:stretch;flex-direction:column}}
@media(max-width:520px){.share-page{padding-inline:10px}.share-state{padding:24px!important}.actions{display:grid}.actions :deep(.v-btn){width:100%}.alert-row{align-items:flex-start;flex-direction:column}.content-card h1{font-size:32px}.comments-card{padding:18px}.reply{margin-left:10px}}
</style>
