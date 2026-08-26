<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import type { ApiKeyCredential, OAuthClient, WebhookDelivery, WebhookDeliveryPage, WebhookSubscription } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { copyText } from '../../components/page-management/utils'

type PlatformTab = 'keys' | 'oauth' | 'webhooks' | 'docs'
interface ScopeGroup { title: string; scopes: string[] }

const session = useSessionStore()
const ui = useUiStore()
const tab = ref<PlatformTab>('keys')
const workspaceId = ref(session.activeWorkspace?.id ?? '')
const loading = ref(false)
const busy = ref('')
const error = ref('')
const tabs: Array<{ value: PlatformTab; title: string; icon: string }> = [
  { value: 'keys', title: 'API Keys', icon: 'mdi-key-chain-variant' },
  { value: 'oauth', title: 'OAuth 应用', icon: 'mdi-shield-key-outline' },
  { value: 'webhooks', title: 'Webhooks', icon: 'mdi-webhook' },
  { value: 'docs', title: 'API 与 MCP', icon: 'mdi-code-tags' },
]
const scopeGroups: ScopeGroup[] = [
  { title: '读取', scopes: ['workspaces:read', 'users:read', 'teams:read', 'knowledge-bases:read', 'documents:read', 'catalog:read', 'search:read'] },
  { title: '写入', scopes: ['documents:write', 'webhooks:read', 'webhooks:write'] },
  { title: 'OAuth', scopes: ['offline_access'] },
]
const defaultScopes = ['workspaces:read', 'knowledge-bases:read', 'documents:read', 'documents:write', 'catalog:read', 'search:read']

const apiKeys = ref<ApiKeyCredential[]>([])
const keyDialog = ref(false)
const keyForm = reactive({ name: '自动化', scopes: [...defaultScopes], expiryDays: 0 })

const oauthClients = ref<OAuthClient[]>([])
const oauthDialog = ref(false)
const oauthForm = reactive({ name: '我的应用', redirects: 'https://example.com/oauth/callback', publicClient: true, scopes: [...defaultScopes, 'offline_access'] })

const webhooks = ref<WebhookSubscription[]>([])
const selectedWebhookId = ref('')
const selectedWebhook = computed(() => webhooks.value.find((item) => item.id === selectedWebhookId.value) ?? null)
const webhookDialog = ref(false)
const webhookForm = reactive({ name: '内容变更通知', endpointUrl: 'https://example.com/webhooks/knowledge', events: 'document.*\ncomment.created' })
const deliveries = ref<WebhookDelivery[]>([])
const deliveryOffset = ref(0)
const deliveriesMore = ref(false)

const confirmation = reactive({ open: false, title: '', text: '', confirmText: '确认', color: 'error', loading: false, action: null as null | (() => Promise<void>) })
const secret = reactive({ open: false, title: '', value: '', warning: '', copied: false })
let pollTimer: number | undefined
let pollTick = 0
let pollInFlight = false

const curlExample = computed(() => `curl -H "X-API-Key: $KNOWLEDGE_API_KEY" "${window.location.origin}/api/v2/workspaces"`)
const mcpExample = computed(() => JSON.stringify({ mcpServers: { knowledge: { type: 'http', url: `${window.location.origin}/mcp`, headers: { Authorization: 'Bearer ${KNOWLEDGE_API_KEY}' } } } }, null, 2))

onMounted(() => {
  ensureWorkspace()
  pollTimer = window.setInterval(() => void poll(), 2_000)
  void loadActiveTab()
})
onBeforeUnmount(() => { if (pollTimer !== undefined) window.clearInterval(pollTimer) })

watch(() => session.workspaces.map((workspace) => workspace.id).join(','), () => { ensureWorkspace(); void loadActiveTab() })
watch(workspaceId, () => {
  selectedWebhookId.value = ''; deliveries.value = []; deliveryOffset.value = 0; deliveriesMore.value = false; error.value = ''
  void loadActiveTab()
})
watch(tab, () => { error.value = ''; void loadActiveTab() })
watch(selectedWebhookId, () => { deliveries.value = []; deliveryOffset.value = 0; deliveriesMore.value = false; if (selectedWebhookId.value) void loadDeliveries(true) })

function ensureWorkspace() {
  if (!session.workspaces.some((workspace) => workspace.id === workspaceId.value)) workspaceId.value = session.activeWorkspace?.id ?? session.workspaces[0]?.id ?? ''
}
async function loadActiveTab() {
  if (!workspaceId.value || tab.value === 'docs') return
  if (tab.value === 'keys') await loadApiKeys()
  else if (tab.value === 'oauth') await loadOAuthClients()
  else if (tab.value === 'webhooks') await loadWebhooks(false)
}
async function guarded(key: string, action: () => Promise<void>) {
  busy.value = key; error.value = ''
  try { await action() } catch (value) { error.value = messageOf(value) } finally { busy.value = '' }
}
function ask(title: string, text: string, confirmText: string, action: () => Promise<void>, color = 'error') {
  Object.assign(confirmation, { open: true, title, text, confirmText, color, loading: false, action })
}
async function confirmAction() {
  if (!confirmation.action) return
  confirmation.loading = true; error.value = ''
  try { await confirmation.action(); confirmation.open = false } catch (value) { error.value = messageOf(value) } finally { confirmation.loading = false }
}
function revealSecret(title: string, value: string | null, warning: string) {
  if (!value) return
  Object.assign(secret, { open: true, title, value, warning, copied: false })
}
function closeSecret() { Object.assign(secret, { open: false, title: '', value: '', warning: '', copied: false }) }
async function copy(value: string, label = '内容') {
  try { await copyText(value); ui.notify(`${label}已复制`) } catch { ui.notify('浏览器不允许访问剪贴板，请手动复制', 'error') }
}
function toggleScope(target: string[], scope: string) {
  const index = target.indexOf(scope)
  if (index >= 0) target.splice(index, 1); else target.push(scope)
}

async function loadApiKeys() {
  loading.value = true; error.value = ''
  try { apiKeys.value = await post<ApiKeyCredential[]>('/api/v1/open-platform/api-keys/list', { workspaceId: workspaceId.value }) } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function createApiKey() {
  await guarded('key-create', async () => {
    const expiresAt = keyForm.expiryDays ? new Date(Date.now() + keyForm.expiryDays * 86_400_000).toISOString() : null
    const value = await post<ApiKeyCredential>('/api/v1/open-platform/api-keys/create', { workspaceId: workspaceId.value, name: keyForm.name.trim(), scopes: keyForm.scopes, expiresAt })
    keyDialog.value = false; keyForm.name = '自动化'; keyForm.scopes = [...defaultScopes]; keyForm.expiryDays = 0
    await loadApiKeys(); revealSecret('保存 API Key', value.secret, '密钥关闭后无法再次查看。请立即存入密码管理器或部署环境的 Secret。')
  })
}
function confirmRevokeKey(key: ApiKeyCredential) {
  ask(`撤销 API Key「${key.name}」`, '使用该密钥的脚本、MCP 客户端和自动化会立即失去访问权限，且无法恢复。', '撤销密钥', async () => { await post('/api/v1/open-platform/api-keys/revoke', { workspaceId: workspaceId.value, id: key.id }); await loadApiKeys(); ui.notify('API Key 已撤销') })
}

async function loadOAuthClients() {
  loading.value = true; error.value = ''
  try { oauthClients.value = await post<OAuthClient[]>('/api/v1/open-platform/oauth-clients/list', { workspaceId: workspaceId.value }) } catch (value) { error.value = messageOf(value) } finally { loading.value = false }
}
async function createOAuthClient() {
  await guarded('oauth-create', async () => {
    const value = await post<OAuthClient>('/api/v1/open-platform/oauth-clients/create', { workspaceId: workspaceId.value, name: oauthForm.name.trim(), redirectUris: lines(oauthForm.redirects), scopes: oauthForm.scopes, publicClient: oauthForm.publicClient })
    oauthDialog.value = false; oauthForm.name = '我的应用'; oauthForm.redirects = 'https://example.com/oauth/callback'; oauthForm.publicClient = true; oauthForm.scopes = [...defaultScopes, 'offline_access']
    await loadOAuthClients()
    if (value.clientSecret) revealSecret('保存 Client Secret', value.clientSecret, '机密客户端的 Secret 只显示一次。请在服务端安全保存，切勿写入前端代码。')
    else ui.notify('公开客户端已创建；请始终使用 PKCE S256')
  })
}
async function setOAuthActive(client: OAuthClient, active: boolean) {
  await guarded(`oauth-${client.id}`, async () => { await post('/api/v1/open-platform/oauth-clients/active', { workspaceId: workspaceId.value, id: client.id, active }); await loadOAuthClients(); ui.notify(active ? 'OAuth 应用已启用' : 'OAuth 应用已停用') })
}
function toggleOAuthClient(client: OAuthClient) {
  if (client.active) ask(`停用 OAuth 应用「${client.name}」`, '新的授权和令牌刷新会停止。已接入系统可能立即受到影响。', '停用应用', () => setOAuthActive(client, false))
  else void setOAuthActive(client, true)
}

async function loadWebhooks(preserve: boolean) {
  if (!preserve) { loading.value = true; error.value = '' }
  try {
    const values = await post<WebhookSubscription[]>('/api/v1/open-platform/webhooks/list', { workspaceId: workspaceId.value })
    webhooks.value = values
    if (!values.some((item) => item.id === selectedWebhookId.value)) selectedWebhookId.value = values[0]?.id ?? ''
  } catch (value) { if (!preserve) error.value = messageOf(value) } finally { if (!preserve) loading.value = false }
}
async function createWebhook() {
  await guarded('webhook-create', async () => {
    const value = await post<WebhookSubscription>('/api/v1/open-platform/webhooks/create', { workspaceId: workspaceId.value, name: webhookForm.name.trim(), endpointUrl: webhookForm.endpointUrl.trim(), events: lines(webhookForm.events) })
    webhookDialog.value = false; webhookForm.name = '内容变更通知'; webhookForm.endpointUrl = 'https://example.com/webhooks/knowledge'; webhookForm.events = 'document.*\ncomment.created'
    await loadWebhooks(false); selectedWebhookId.value = value.id
    revealSecret('保存 Webhook Signing Secret', value.signingSecret, '接收端使用此 Secret 验证 X-Knowledge-Signature；关闭后无法再次查看。')
  })
}
async function setWebhookActive(hook: WebhookSubscription, active: boolean) {
  await guarded(`webhook-${hook.id}`, async () => { await post('/api/v1/open-platform/webhooks/active', { workspaceId: workspaceId.value, id: hook.id, active }); await loadWebhooks(false); ui.notify(active ? 'Webhook 已启用' : 'Webhook 已暂停') })
}
function toggleWebhook(hook: WebhookSubscription) {
  if (hook.active) ask(`暂停 Webhook「${hook.name}」`, '新事件将停止投递，恢复后只处理恢复之后产生的事件。', '暂停投递', () => setWebhookActive(hook, false))
  else void setWebhookActive(hook, true)
}
async function sendWebhookTest(hook: WebhookSubscription) {
  await guarded(`webhook-test-${hook.id}`, async () => { await post('/api/v1/open-platform/webhooks/test', { webhookId: hook.id }); await loadDeliveries(true); ui.notify('测试事件已进入投递队列', 'info') })
}
async function loadDeliveries(reset: boolean, preserve = false) {
  if (!selectedWebhookId.value) return
  if (!preserve) loading.value = true
  try {
    const limit = preserve ? Math.min(Math.max(deliveries.value.length, 30), 100) : 30
    const page = await post<WebhookDeliveryPage>('/api/v1/open-platform/webhooks/deliveries/page', { webhookId: selectedWebhookId.value, limit, offset: reset ? 0 : deliveryOffset.value })
    deliveries.value = reset ? page.items : [...deliveries.value, ...page.items]; deliveryOffset.value = page.nextOffset; deliveriesMore.value = page.hasMore
  } catch (value) { if (!preserve) error.value = messageOf(value) } finally { if (!preserve) loading.value = false }
}
function confirmReplay(delivery: WebhookDelivery) {
  ask(`重放 ${delivery.eventType}`, `将为投递 ${delivery.id.slice(0, 8)} 创建一次新的投递尝试。接收端应按 Delivery ID 保证幂等。`, '确认重放', async () => { await post('/api/v1/open-platform/webhooks/replay', { webhookId: selectedWebhookId.value, deliveryId: delivery.id }); await loadDeliveries(true); ui.notify('投递已重新排队') }, 'primary')
}
async function poll() {
  if (tab.value !== 'webhooks' || !workspaceId.value || pollInFlight) return
  pollInFlight = true; pollTick += 1
  try { if (pollTick % 3 === 0) await loadWebhooks(true); if (selectedWebhookId.value) await loadDeliveries(true, true) } finally { pollInFlight = false }
}

function lines(value: string) { return [...new Set(value.split(/\r?\n/).map((item) => item.trim()).filter(Boolean))] }
function date(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(new Date(value)) : '—' }
function dateTime(value: string | null) { return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—' }
function deliveryColor(value: WebhookDelivery['status']) { return value === 'DELIVERED' ? 'success' : value === 'DEAD' ? 'error' : value === 'RETRYING' ? 'warning' : 'info' }
</script>

<template>
  <div class="page-shell platform-page">
    <header class="page-heading">
      <div><h1>开放平台</h1><p>管理 API Key、OAuth、Webhook 与 MCP 接入。</p></div>
      <v-select v-model="workspaceId" :items="session.workspaces" item-title="name" item-value="id" label="当前工作区" hide-details variant="outlined" density="compact" class="workspace-select" />
    </header>

    <div class="platform-nav"><v-tabs v-model="tab" color="#00b96b" show-arrows><v-tab v-for="item in tabs" :key="item.value" :value="item.value" :prepend-icon="item.icon">{{ item.title }}</v-tab></v-tabs></div>
    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-1" />

    <v-window v-model="tab" :touch="false">
      <v-window-item value="keys">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-key-chain-variant</v-icon></v-avatar><div><h2>API Keys</h2><p>适合服务端脚本、自动化和 MCP 客户端。密钥只在创建时显示一次。</p></div><v-spacer /><v-btn color="primary" prepend-icon="mdi-plus" @click="keyDialog = true">创建密钥</v-btn></div><v-divider />
          <v-list lines="three" class="pa-3"><v-list-item v-for="key in apiKeys" :key="key.id" rounded="lg" :class="{ revoked: key.revokedAt }"><template #prepend><v-avatar color="warning" variant="tonal"><v-icon>mdi-key-outline</v-icon></v-avatar></template><v-list-item-title><strong>{{ key.name }}</strong> <code class="ml-2">kp_live_{{ key.prefix }}_••••••••</code></v-list-item-title><v-list-item-subtitle><div class="scope-chips my-1"><v-chip v-for="scope in key.scopes" :key="scope" size="x-small" variant="tonal">{{ scope }}</v-chip></div>创建于 {{ date(key.createdAt) }} · {{ key.lastUsedAt ? `最后使用 ${date(key.lastUsedAt)}` : '尚未使用' }}{{ key.expiresAt ? ` · ${date(key.expiresAt)} 到期` : '' }}</v-list-item-subtitle><template #append><div class="row-actions"><v-chip size="small" :color="key.revokedAt ? 'error' : 'success'" variant="tonal">{{ key.revokedAt ? '已撤销' : '有效' }}</v-chip><v-btn v-if="!key.revokedAt" icon="mdi-delete-outline" color="error" variant="text" title="撤销密钥" @click="confirmRevokeKey(key)" /></div></template></v-list-item></v-list>
          <div v-if="!loading && !apiKeys.length" class="empty-state"><div><v-icon size="46">mdi-key-plus</v-icon><h3>还没有 API Key</h3><p>创建后可通过 X-API-Key 或 Bearer 调用外部 API。</p><v-btn color="primary" prepend-icon="mdi-plus" @click="keyDialog = true">创建第一把密钥</v-btn></div></div>
        </v-card>
      </v-window-item>

      <v-window-item value="oauth">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-shield-key-outline</v-icon></v-avatar><div><h2>OAuth 2.0 应用</h2><p>Authorization Code + PKCE；Redirect URI 必须精确匹配，Refresh Token 每次使用都会轮换。</p></div><v-spacer /><v-btn color="primary" prepend-icon="mdi-plus" @click="oauthDialog = true">注册应用</v-btn></div><v-divider />
          <div class="credential-grid pa-5"><v-card v-for="client in oauthClients" :key="client.id" variant="outlined" class="credential-card pa-5"><div class="d-flex align-start ga-3"><v-avatar color="info" variant="tonal"><v-icon>mdi-shield-key-outline</v-icon></v-avatar><div class="flex-grow-1"><strong>{{ client.name }}</strong><code class="d-block mt-1">{{ client.clientId }}</code></div><v-chip :color="client.active ? 'success' : 'error'" size="small" variant="tonal">{{ client.active ? '启用' : '停用' }}</v-chip></div><p class="endpoint mt-4">{{ client.redirectUris.join(' · ') }}</p><div class="scope-chips"><v-chip v-for="scope in client.scopes" :key="scope" size="x-small" variant="tonal">{{ scope }}</v-chip></div><div class="d-flex align-center mt-4"><span class="text-caption text-medium-emphasis">{{ client.publicClient ? '公开客户端 · 强制 PKCE' : '机密客户端 · Client Secret + PKCE' }} · {{ date(client.createdAt) }}</span><v-spacer /><v-btn variant="text" size="small" :color="client.active ? 'error' : 'primary'" :prepend-icon="client.active ? 'mdi-pause-circle-outline' : 'mdi-play-circle-outline'" :loading="busy === `oauth-${client.id}`" @click="toggleOAuthClient(client)">{{ client.active ? '停用' : '启用' }}</v-btn></div></v-card></div>
          <div v-if="!loading && !oauthClients.length" class="empty-state"><div><v-icon size="46">mdi-application-brackets-outline</v-icon><h3>还没有 OAuth 应用</h3><p>注册第三方应用，让用户明确授权后访问知识。</p><v-btn color="primary" prepend-icon="mdi-plus" @click="oauthDialog = true">注册应用</v-btn></div></div>
        </v-card>
      </v-window-item>

      <v-window-item value="webhooks">
        <v-card class="section-card">
          <div class="panel-heading pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-webhook</v-icon></v-avatar><div><h2>Webhooks</h2><p>HMAC-SHA256 签名、失败指数退避、自动熔断和人工重放。状态每 2 秒刷新。</p></div><v-spacer /><v-btn color="primary" prepend-icon="mdi-plus" @click="webhookDialog = true">新建订阅</v-btn></div><v-divider />
          <div class="webhook-layout"><div class="webhook-sidebar"><v-list nav class="pa-3"><v-list-item v-for="hook in webhooks" :key="hook.id" :active="selectedWebhookId === hook.id" rounded="lg" @click="selectedWebhookId = hook.id"><template #prepend><v-badge dot :color="hook.suspendedAt ? 'error' : hook.active ? 'success' : 'grey'"><v-avatar color="primary" variant="tonal" size="36"><v-icon size="20">mdi-webhook</v-icon></v-avatar></v-badge></template><v-list-item-title>{{ hook.name }}</v-list-item-title><v-list-item-subtitle>{{ hook.endpointUrl }}</v-list-item-subtitle></v-list-item></v-list><div v-if="!webhooks.length" class="empty-side">还没有 Webhook 订阅</div></div><div class="delivery-panel" v-if="selectedWebhook"><div class="delivery-head"><div><h3>{{ selectedWebhook.name }}</h3><p>{{ selectedWebhook.active ? selectedWebhook.suspendedAt ? '失败熔断，需要重新启用或重放' : '正在投递' : '已暂停' }}</p><div class="scope-chips"><v-chip v-for="event in selectedWebhook.events" :key="event" size="x-small" variant="tonal">{{ event }}</v-chip></div></div><div class="row-actions"><v-btn variant="tonal" prepend-icon="mdi-send-outline" :loading="busy === `webhook-test-${selectedWebhook.id}`" @click="sendWebhookTest(selectedWebhook)">发送测试</v-btn><v-btn variant="text" :color="selectedWebhook.active ? 'error' : 'primary'" :prepend-icon="selectedWebhook.active ? 'mdi-pause' : 'mdi-play'" :loading="busy === `webhook-${selectedWebhook.id}`" @click="toggleWebhook(selectedWebhook)">{{ selectedWebhook.active ? '暂停' : '启用' }}</v-btn></div></div><v-divider />
            <v-list lines="three" class="pa-3"><v-list-item v-for="delivery in deliveries" :key="delivery.id" rounded="lg"><template #prepend><v-avatar :color="deliveryColor(delivery.status)" variant="tonal"><v-icon>mdi-truck-delivery-outline</v-icon></v-avatar></template><v-list-item-title><strong>{{ delivery.eventType }}</strong></v-list-item-title><v-list-item-subtitle>{{ dateTime(delivery.createdAt) }} · 第 {{ delivery.attempts }} 次{{ delivery.responseStatus ? ` · HTTP ${delivery.responseStatus}` : '' }}<br><span v-if="delivery.lastError" class="text-error">{{ delivery.lastError }}</span></v-list-item-subtitle><template #append><div class="row-actions"><v-chip :color="deliveryColor(delivery.status)" size="small" variant="tonal">{{ delivery.status }}</v-chip><v-btn v-if="delivery.status !== 'PENDING'" icon="mdi-replay" variant="text" title="重放投递" @click="confirmReplay(delivery)" /></div></template></v-list-item></v-list><div v-if="!loading && !deliveries.length" class="empty-state compact"><div><v-icon size="42">mdi-truck-fast-outline</v-icon><h3>暂无投递记录</h3><p>发送测试事件后可在这里观察投递状态。</p></div></div><div v-if="deliveriesMore" class="load-more"><v-btn variant="tonal" :loading="loading" @click="loadDeliveries(false)">加载更多投递</v-btn></div></div><div v-else class="empty-state"><div><v-icon size="46">mdi-webhook</v-icon><h3>选择或创建订阅</h3><p>投递记录和控制项会显示在这里。</p></div></div></div>
        </v-card>
      </v-window-item>

      <v-window-item value="docs">
        <div class="docs-grid"><v-card class="section-card pa-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-api</v-icon></v-avatar><h2 class="mt-4">REST API v2</h2><p class="text-medium-emphasis">请求返回稳定 JSON，写入要求 Idempotency-Key，并包含请求 ID 与速率限制响应头。</p><div class="code-block"><pre>{{ curlExample }}</pre><v-btn icon="mdi-content-copy" variant="text" title="复制 cURL" @click="copy(curlExample, 'cURL 示例')" /></div><div class="text-caption text-medium-emphasis mt-3">OpenAPI 3.1：contracts/openapi/api-v2.yaml</div></v-card><v-card class="section-card pa-6"><v-avatar color="info" variant="tonal"><v-icon>mdi-robot-outline</v-icon></v-avatar><h2 class="mt-4">MCP Server</h2><p class="text-medium-emphasis">使用同一把 API Key 或 OAuth Token；工具调用不会绕过 Scope 和资源权限。</p><div class="code-block"><pre>{{ mcpExample }}</pre><v-btn icon="mdi-content-copy" variant="text" title="复制 MCP 配置" @click="copy(mcpExample, 'MCP 配置')" /></div></v-card><v-card class="section-card pa-6 docs-wide"><v-avatar color="success" variant="tonal"><v-icon>mdi-shield-check-outline</v-icon></v-avatar><h2 class="mt-4">Webhook 签名验证</h2><p class="text-medium-emphasis">拼接 <code>timestamp + "." + rawBody</code>，使用 Signing Secret 计算 HMAC-SHA256，并与 X-Knowledge-Signature 中的 v1 值做恒定时间比较。拒绝超过 5 分钟的时间戳，并按 Delivery ID 去重。</p><div class="security-flow"><span>审计事件</span><v-icon>mdi-chevron-right</v-icon><span>持久化投递</span><v-icon>mdi-chevron-right</v-icon><span>HMAC 签名</span><v-icon>mdi-chevron-right</v-icon><span>指数退避</span><v-icon>mdi-chevron-right</v-icon><span>熔断 / 重放</span></div></v-card></div>
      </v-window-item>
    </v-window>

    <v-dialog v-model="keyDialog" max-width="720"><v-card><v-card-title class="px-6 pt-6">创建 API Key</v-card-title><v-card-text class="px-6"><v-text-field v-model="keyForm.name" label="密钥名称" autofocus /><v-select v-model="keyForm.expiryDays" label="有效期" :items="[{title:'永不过期',value:0},{title:'30 天',value:30},{title:'90 天',value:90},{title:'1 年',value:365}]" /><div class="scope-picker"><div v-for="group in scopeGroups" :key="group.title"><strong>{{ group.title }}</strong><v-checkbox v-for="scopeName in group.scopes" :key="scopeName" :model-value="keyForm.scopes.includes(scopeName)" :label="scopeName" density="compact" hide-details @update:model-value="toggleScope(keyForm.scopes, scopeName)" /></div></div></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="keyDialog = false">取消</v-btn><v-btn color="primary" :loading="busy === 'key-create'" :disabled="!keyForm.name.trim() || !keyForm.scopes.length" @click="createApiKey">创建密钥</v-btn></v-card-actions></v-card></v-dialog>

    <v-dialog v-model="oauthDialog" max-width="760"><v-card><v-card-title class="px-6 pt-6">注册 OAuth 应用</v-card-title><v-card-text class="px-6"><v-text-field v-model="oauthForm.name" label="应用名称" autofocus /><v-textarea v-model="oauthForm.redirects" label="Redirect URI（每行一个）" rows="3" hint="必须使用 HTTPS；回调时要求精确匹配" persistent-hint /><div class="setting-row my-4"><div><strong>公开客户端</strong><p>桌面、移动端和 SPA 不保存 Client Secret，但始终强制 PKCE S256。</p></div><v-switch v-model="oauthForm.publicClient" color="primary" inset hide-details /></div><div class="scope-picker"><div v-for="group in scopeGroups" :key="group.title"><strong>{{ group.title }}</strong><v-checkbox v-for="scopeName in group.scopes" :key="scopeName" :model-value="oauthForm.scopes.includes(scopeName)" :label="scopeName" density="compact" hide-details @update:model-value="toggleScope(oauthForm.scopes, scopeName)" /></div></div></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="oauthDialog = false">取消</v-btn><v-btn color="primary" :loading="busy === 'oauth-create'" :disabled="!oauthForm.name.trim() || !lines(oauthForm.redirects).length || !oauthForm.scopes.length" @click="createOAuthClient">注册应用</v-btn></v-card-actions></v-card></v-dialog>

    <v-dialog v-model="webhookDialog" max-width="700"><v-card><v-card-title class="px-6 pt-6">新建 Webhook 订阅</v-card-title><v-card-text class="px-6"><v-text-field v-model="webhookForm.name" label="订阅名称" autofocus /><v-text-field v-model="webhookForm.endpointUrl" label="HTTPS 接收地址" placeholder="https://example.com/webhooks/knowledge" /><v-textarea v-model="webhookForm.events" label="事件（每行一个）" rows="5" hint="支持 document.* 或 * 通配符" persistent-hint /></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="webhookDialog = false">取消</v-btn><v-btn color="primary" :loading="busy === 'webhook-create'" :disabled="!webhookForm.name.trim() || !webhookForm.endpointUrl.trim() || !lines(webhookForm.events).length" @click="createWebhook">创建订阅</v-btn></v-card-actions></v-card></v-dialog>

    <v-dialog v-model="secret.open" max-width="680" persistent><v-card><v-card-title class="px-6 pt-6"><v-icon color="warning" class="mr-2">mdi-eye-lock-outline</v-icon>{{ secret.title }}</v-card-title><v-card-text class="px-6"><v-alert type="warning" variant="tonal" class="mb-5">{{ secret.warning }}</v-alert><div class="secret-value"><code>{{ secret.value }}</code><v-btn variant="tonal" prepend-icon="mdi-content-copy" @click="copy(secret.value, 'Secret'); secret.copied = true">{{ secret.copied ? '已复制' : '复制' }}</v-btn></div></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn color="primary" @click="closeSecret">我已安全保存</v-btn></v-card-actions></v-card></v-dialog>

    <v-dialog v-model="confirmation.open" max-width="520" persistent><v-card><v-card-title class="px-6 pt-6">{{ confirmation.title }}</v-card-title><v-card-text class="px-6 text-medium-emphasis">{{ confirmation.text }}</v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" :disabled="confirmation.loading" @click="confirmation.open = false">取消</v-btn><v-btn :color="confirmation.color" :loading="confirmation.loading" @click="confirmAction">{{ confirmation.confirmText }}</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.platform-page{max-width:1080px;padding-top:32px}.platform-page :deep(.page-heading){align-items:center;margin-bottom:18px}.platform-page :deep(.page-heading h1){font-size:26px}.workspace-select{width:240px;flex:0 0 auto}.workspace-select :deep(.v-field){min-height:38px;border-radius:6px}.workspace-select :deep(.v-field__input){min-height:38px;font-size:12px}.platform-nav{height:44px;overflow:hidden;border-bottom:1px solid #e7e9e8}.platform-nav :deep(.v-tab){height:44px;min-width:auto;margin-right:28px;padding:0;color:#646a67;font-size:13px;letter-spacing:0;text-transform:none}.platform-nav :deep(.v-tab .v-icon){font-size:17px}.platform-page>.v-alert{margin:18px 0 0!important;border-radius:6px;font-size:12px}.platform-page :deep(.v-window-item>.section-card){border:0!important;border-radius:0!important;background:#fff!important;box-shadow:none!important}.panel-heading{display:flex;align-items:center;gap:0;padding:26px 0 15px!important}.panel-heading>.v-avatar{display:none}.panel-heading h2{margin:0;color:#262626;font-size:17px;font-weight:650}.panel-heading p,.setting-row p,.delivery-head p{margin:3px 0 0;color:#8a8f8d;font-size:12px;line-height:18px}.panel-heading>.v-btn{height:34px;border-radius:5px;background:#00b96b!important;color:#fff!important;font-size:12px;letter-spacing:0;text-transform:none}.platform-page :deep(.v-window-item>.section-card>.v-divider){border-color:#e7e9e8}.platform-page :deep(.v-list){padding:0!important}.platform-page :deep(.v-list-item){min-height:68px;border-bottom:1px solid #f0f0f0;border-radius:0!important}.platform-page :deep(.v-list-item__prepend .v-avatar){width:34px!important;height:34px!important;border-radius:6px!important}.platform-page :deep(.v-list-item-title){font-size:13px}.platform-page :deep(.v-list-item-subtitle){font-size:11px}.platform-page :deep(.v-btn){border-radius:5px;letter-spacing:0;text-transform:none}.scope-chips{display:flex;flex-wrap:wrap;gap:4px}.scope-chips :deep(.v-chip){height:20px;border-radius:4px;font-size:9px}.row-actions{display:flex;align-items:center;gap:5px}.revoked{opacity:.58}code,pre{font-family:"SFMono-Regular",Consolas,monospace}.credential-grid{display:block;padding:0!important}.credential-card{border:0!important;border-bottom:1px solid #f0f0f0!important;border-radius:0!important;padding:16px 0!important;box-shadow:none!important}.credential-card :deep(.v-avatar){width:34px!important;height:34px!important;border-radius:6px!important}.credential-card .endpoint{overflow-wrap:anywhere;color:#8a8f8d;font-size:11px}.webhook-layout{display:grid;grid-template-columns:260px minmax(0,1fr);min-height:480px;border-top:1px solid #e7e9e8}.webhook-sidebar{border-right:1px solid #e7e9e8}.webhook-sidebar :deep(.v-list){padding:8px!important}.webhook-sidebar :deep(.v-list-item){min-height:58px;padding:6px 8px}.empty-side{padding:40px 16px;color:#8a8f8d;font-size:12px;text-align:center}.delivery-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;padding:18px 20px}.delivery-head h3{margin:0;color:#262626;font-size:15px}.delivery-head .v-btn{height:30px;font-size:11px}.delivery-panel :deep(.v-list){padding:0 20px!important}.empty-state.compact{min-height:220px}.load-more{display:flex;justify-content:center;padding:8px 20px 24px}.docs-grid{display:grid;grid-template-columns:1fr;gap:0}.docs-grid>.section-card{border:0!important;border-bottom:1px solid #e7e9e8!important;border-radius:0!important;padding:25px 0!important;box-shadow:none!important}.docs-grid>.section-card>.v-avatar{display:none}.docs-grid h2{margin-top:0!important;color:#262626;font-size:17px}.docs-grid p{max-width:820px;font-size:12px;line-height:20px}.docs-wide{grid-column:auto}.code-block{position:relative;min-height:104px;margin-top:14px;padding:15px 48px 15px 15px;overflow:auto;border:1px solid #e7e9e8;border-radius:6px;background:#f7f8f7;color:#4f5552}.code-block pre{margin:0;white-space:pre-wrap;font-size:11px;line-height:1.65}.code-block .v-btn{position:absolute;top:6px;right:6px;color:#646a67}.security-flow{display:flex;align-items:center;gap:9px;margin-top:16px;padding:13px 0;border-top:1px solid #f0f0f0;color:#646a67;font-size:11px;font-weight:600}.scope-picker{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;padding:13px;border:1px solid #e7e9e8;border-radius:6px}.scope-picker strong{display:block;margin-bottom:5px;font-size:12px}.setting-row{display:flex;min-height:62px;align-items:center;justify-content:space-between;gap:20px;padding:10px 0;border-top:1px solid #f0f0f0;border-bottom:1px solid #f0f0f0;background:#fff}.secret-value{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;padding:13px;border:1px solid #bfe8d3;border-radius:6px;background:#f4fbf7}.secret-value code{overflow-wrap:anywhere;user-select:all}.platform-page :deep(.empty-state){min-height:240px}.platform-page :deep(.empty-state h3){font-size:14px}.platform-page :deep(.empty-state p){font-size:11px}
@media(max-width:900px){.platform-page{padding-top:24px}.page-heading{flex-direction:column}.workspace-select{width:100%}.platform-nav :deep(.v-tab){margin-right:20px}.panel-heading{align-items:flex-start;flex-wrap:wrap}.panel-heading .v-spacer{display:none}.panel-heading>.v-btn{margin-left:auto}.webhook-layout{grid-template-columns:1fr}.webhook-sidebar{max-height:260px;overflow:auto;border-right:0;border-bottom:1px solid #e7e9e8}.delivery-head{flex-direction:column}.scope-picker{grid-template-columns:1fr}.security-flow{flex-wrap:wrap}}
</style>
