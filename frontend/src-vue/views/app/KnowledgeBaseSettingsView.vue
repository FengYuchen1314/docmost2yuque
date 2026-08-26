<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { KnowledgeBase, Page, Team, WorkspaceMember } from '../../../src/types'
import KnowledgeBaseSharesPanel from '../../components/knowledge-base-settings/KnowledgeBaseSharesPanel.vue'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import {
  mergeKnowledgeBaseConfig,
  parseKnowledgeBaseAppearance,
  parseKnowledgeBaseCatalogDisplay,
  parseKnowledgeBaseWatermark,
  type KnowledgeBaseAppearance,
  type KnowledgeBaseCatalogDisplay,
  type KnowledgeBaseWatermark,
} from '../../utils/presentation'
import { createUuid } from '../../utils/uuid'
import {
  acquireKnowledgeBaseMutation,
  knowledgeBaseLifecycleMutation,
  knowledgeBaseMutationInFlight,
  releaseKnowledgeBaseMutation,
} from '../../utils/knowledgeBaseMutationLocks'

interface Member {
  userId: string
  email: string
  displayName: string | null
  role: 'READER' | 'EDITOR' | 'MANAGER'
}
interface AuthorizationDecision { capabilities: string[] }
interface MergePath { pageId: string; title: string; originalPath: string; resolvedPath: string; renamed: boolean }
interface MergePlan {
  sourceKnowledgeBaseId: string
  targetKnowledgeBaseId: string
  fingerprint: string
  pageCount: number
  catalogNodeCount: number
  paths: MergePath[]
  warnings: string[]
}
interface OwnerTarget { value: string; title: string; subtitle: string; icon: string }
type SettingsTab = 'general' | 'appearance' | 'members' | 'sharing' | 'ownership' | 'danger'
interface SettingsForm {
  name: string
  slug: string
  description: string
  icon: string
  visibility: string
  allowPublicIndex: boolean
  publishMode: string
  homepagePageId: string
  appearanceConfig: string
  watermarkConfig: string
  catalogConfig: string
}

const visibilityItems = [
  { title: '仅指定成员', value: 'PRIVATE' },
  { title: '空间成员可见', value: 'WORKSPACE' },
  { title: '公开访问', value: 'PUBLIC' },
]
const publishModeItems = [
  { title: '手动发布', value: 'MANUAL' },
  { title: '自动发布', value: 'AUTO' },
]
const memberRoleItems = [
  { title: '可阅读', value: 'READER' },
  { title: '可编辑', value: 'EDITOR' },
  { title: '可管理', value: 'MANAGER' },
]
const themeItems: Array<{ value: KnowledgeBaseAppearance['theme']; title: string; subtitle: string; icon: string }> = [
  { value: 'PAPER', title: '纸张', subtitle: '温和、适合长文', icon: 'mdi-book-open-page-variant-outline' },
  { value: 'MINIMAL', title: '极简', subtitle: '轻量、减少装饰', icon: 'mdi-format-paint' },
  { value: 'MAGAZINE', title: '杂志', subtitle: '突出封面与标题', icon: 'mdi-newspaper-variant-outline' },
  { value: 'DARK', title: '深色', subtitle: '低亮度阅读', icon: 'mdi-weather-night' },
]
const widthItems = [
  { title: '标准 · 适合文章阅读', value: 'STANDARD' },
  { title: '宽版 · 适合图表与代码', value: 'WIDE' },
  { title: '全宽 · 适合数据内容', value: 'FULL' },
]
const watermarkPositionItems = [
  { title: '内容平铺', value: 'TILED' },
  { title: '页面中央', value: 'CENTER' },
  { title: '页面底部', value: 'FOOTER' },
]

const route = useRoute()
const router = useRouter()
const session = useSessionStore()
const ui = useUiStore()
const knowledgeBaseId = computed(() => String(route.params.knowledgeBaseId ?? ''))

const kb = ref<KnowledgeBase | null>(null)
const pages = ref<Page[]>([])
const members = ref<Member[]>([])
const workspaceMembers = ref<WorkspaceMember[]>([])
const teams = ref<Team[]>([])
const allKbs = ref<KnowledgeBase[]>([])
const tab = ref<SettingsTab>('general')
const loading = ref(false)
const saving = ref(false)
const memberWorking = ref(false)
const transferring = ref(false)
const ownershipPermissionsLoading = ref(false)
const canTransferKnowledgeBase = ref(false)
const manageableOwnerValues = ref<Set<string>>(new Set())
const lifecycleWorking = ref<'' | 'plan' | 'merge' | 'archive'>('')
const error = ref('')
const candidate = ref('')
const memberRole = ref<Member['role']>('READER')
const targetOwner = ref('')
const transferDialog = ref(false)
const pendingTransferTarget = ref<OwnerTarget | null>(null)
const transferError = ref('')
const mergeTarget = ref('')
const mergePlan = ref<MergePlan | null>(null)
const confirmName = ref('')
const configWarnings = ref<string[]>([])

const form = reactive<SettingsForm>({
  name: '', slug: '', description: '', icon: '', visibility: 'PRIVATE', allowPublicIndex: false,
  publishMode: 'MANUAL', homepagePageId: '', appearanceConfig: '{}', watermarkConfig: '{}', catalogConfig: '{}',
})
const appearance = reactive<KnowledgeBaseAppearance>(parseKnowledgeBaseAppearance('{}'))
const watermark = reactive<KnowledgeBaseWatermark>(parseKnowledgeBaseWatermark('{}'))
const catalog = reactive<KnowledgeBaseCatalogDisplay>(parseKnowledgeBaseCatalogDisplay('{}'))

const workspace = computed(() => session.workspaces.find((item) => item.id === kb.value?.workspaceId) ?? null)
const activeKnowledgeBase = computed(() => kb.value?.id === knowledgeBaseId.value ? kb.value : null)
const currentOwnerValue = computed(() => kb.value ? `${kb.value.ownerType}:${kb.value.ownerId}` : '')
const currentOwnerTeam = computed(() => teams.value.find((team) => team.id === kb.value?.ownerId) ?? null)
const currentOwnerPerson = computed(() => workspaceMembers.value.find((person) => person.userId === kb.value?.ownerId) ?? null)
const currentOwnerTitle = computed(() => {
  if (!kb.value) return '正在读取归属信息'
  if (kb.value.ownerType === 'PERSONAL') {
    const person = kb.value.ownerId === session.user?.userId ? session.user : currentOwnerPerson.value
    return `个人 · ${person?.displayName || person?.email || '空间成员'}`
  }
  if (kb.value.ownerType === 'TEAM') return currentOwnerTeam.value ? `团队 · ${currentOwnerTeam.value.name}` : '团队管理'
  if (kb.value.ownerType === 'WORKSPACE') return `空间 · ${workspace.value?.name ?? '当前空间'}`
  return '未知归属'
})
const currentOwnerDescription = computed(() => {
  if (kb.value?.ownerType === 'PERSONAL') return currentOwnerPerson.value?.email ? `管理人：${currentOwnerPerson.value.email}` : '由指定个人管理'
  if (kb.value?.ownerType === 'TEAM') return '该团队的管理员可管理知识库，团队成员权限会被继承。'
  if (kb.value?.ownerType === 'WORKSPACE') return '该空间的管理员可管理知识库，空间规则会参与权限判定。'
  return '服务端返回了无法识别的归属类型。'
})
const ownerTargets = computed<OwnerTarget[]>(() => {
  if (!kb.value || !canTransferKnowledgeBase.value) return []
  const values: OwnerTarget[] = []
  if (session.user && currentOwnerValue.value !== `PERSONAL:${session.user.userId}`) {
    values.push({
      value: `PERSONAL:${session.user.userId}`,
      title: '归我个人管理',
      subtitle: `由 ${session.user.email} 管理；知识库仍保留在当前空间`,
      icon: 'mdi-account-outline',
    })
  }
  if (manageableOwnerValues.value.has(`WORKSPACE:${kb.value.workspaceId}`) && currentOwnerValue.value !== `WORKSPACE:${kb.value.workspaceId}`) {
    values.push({
      value: `WORKSPACE:${kb.value.workspaceId}`,
      title: `空间 · ${workspace.value?.name ?? '当前空间'}`,
      subtitle: '由空间管理员管理，并按空间权限规则继承',
      icon: 'mdi-domain',
    })
  }
  for (const team of teams.value) {
    if (manageableOwnerValues.value.has(`TEAM:${team.id}`) && currentOwnerValue.value !== `TEAM:${team.id}`) {
      values.push({
        value: `TEAM:${team.id}`,
        title: `团队 · ${team.name}`,
        subtitle: '由团队管理员管理，并继承该团队的成员权限',
        icon: 'mdi-account-group-outline',
      })
    }
  }
  return values
})
const selectedOwnerTarget = computed(() => ownerTargets.value.find((item) => item.value === targetOwner.value) ?? null)
const noTransferReason = computed(() => {
  if (loading.value || ownershipPermissionsLoading.value) return '正在检查你可管理的目标…'
  if (!session.user) return '无法读取当前账号，暂时不能转移归属。请刷新页面后重试。'
  if (!canTransferKnowledgeBase.value) return '你没有管理当前知识库的权限，不能转移归属。'
  return '没有其他你具备管理权限的个人、空间或团队目标。创建团队或取得目标团队的管理员权限后可再转移。'
})

const coverError = computed(() => validateCover(appearance.coverUrl))
const watermarkTextError = computed(() => {
  if (!watermark.enabled) return ''
  if (!watermark.text.trim()) return '开启水印后，请填写水印文字'
  if (watermark.text.length > 120) return '水印文字不能超过 120 个字符'
  return ''
})
const appearanceInvalid = computed(() => Boolean(
  coverError.value || watermarkTextError.value
  || !/^#[0-9a-f]{6}$/i.test(appearance.backgroundColor)
  || !/^#[0-9a-f]{6}$/i.test(appearance.accentColor),
))
const safeCoverUrl = computed(() => coverError.value ? '' : appearance.coverUrl.trim())
const previewStyle = computed<Record<string, string>>(() => {
  const style: Record<string, string> = {
    '--preview-accent': appearance.accentColor,
    backgroundColor: appearance.theme === 'DARK' ? '#111827' : appearance.backgroundColor,
  }
  if (safeCoverUrl.value) style.backgroundImage = `linear-gradient(rgba(15, 23, 42, .38), rgba(15, 23, 42, .64)), url(${JSON.stringify(safeCoverUrl.value)})`
  return style
})
const previewWidth = computed(() => ({ STANDARD: '640px', WIDE: '780px', FULL: '100%' })[appearance.contentWidth])
const previewWatermark = computed(() => watermark.text.replaceAll('{{email}}', session.user?.email ?? 'member@example.com'))
let loadRequestVersion = 0
let settingsContextVersion = 0

onMounted(load)
watch(knowledgeBaseId, () => load())
watch(mergeTarget, () => { mergePlan.value = null; confirmName.value = '' })

async function load() {
  const requestedKnowledgeBaseId = knowledgeBaseId.value
  const requestVersion = ++loadRequestVersion
  settingsContextVersion += 1
  resetLoadedKnowledgeBaseState()
  if (!requestedKnowledgeBaseId) return
  loading.value = true
  try {
    const knowledgeBase = await post<KnowledgeBase>('/api/v1/knowledge-bases/get', { knowledgeBaseId: requestedKnowledgeBaseId })
    assertKnowledgeBase(knowledgeBase, requestedKnowledgeBaseId)
    if (requestVersion !== loadRequestVersion || requestedKnowledgeBaseId !== knowledgeBaseId.value) return
    kb.value = knowledgeBase
    const [pageValues, memberValues, workspaceMemberValues, teamValues, knowledgeBaseValues] = await Promise.all([
      post<Page[]>('/api/v1/pages/list', { knowledgeBaseId: requestedKnowledgeBaseId }),
      post<Member[]>('/api/v1/knowledge-bases/members', { knowledgeBaseId: requestedKnowledgeBaseId }),
      post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId: knowledgeBase.workspaceId }),
      post<Team[]>('/api/v1/teams/list', { workspaceId: knowledgeBase.workspaceId }),
      post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: knowledgeBase.workspaceId }),
    ])
    if (requestVersion !== loadRequestVersion || requestedKnowledgeBaseId !== knowledgeBaseId.value) return
    pages.value = Array.isArray(pageValues) ? pageValues : []
    members.value = Array.isArray(memberValues) ? memberValues : []
    workspaceMembers.value = Array.isArray(workspaceMemberValues) ? workspaceMemberValues : []
    teams.value = Array.isArray(teamValues) ? teamValues : []
    allKbs.value = Array.isArray(knowledgeBaseValues) ? knowledgeBaseValues : []
    hydrateForm(knowledgeBase)
    hydrateAppearance()
    targetOwner.value = ''
    transferDialog.value = false
    pendingTransferTarget.value = null
    transferError.value = ''
    mergeTarget.value = ''
    mergePlan.value = null
    confirmName.value = ''
    await loadOwnershipPermissions(knowledgeBase, teams.value, requestVersion)
  } catch (value) {
    if (requestVersion === loadRequestVersion && requestedKnowledgeBaseId === knowledgeBaseId.value) error.value = messageOf(value)
  } finally {
    if (requestVersion === loadRequestVersion && requestedKnowledgeBaseId === knowledgeBaseId.value) loading.value = false
  }
}

function resetLoadedKnowledgeBaseState() {
  kb.value = null
  pages.value = []
  members.value = []
  workspaceMembers.value = []
  teams.value = []
  allKbs.value = []
  Object.assign(form, emptySettingsForm())
  Object.assign(appearance, parseKnowledgeBaseAppearance('{}'))
  Object.assign(watermark, parseKnowledgeBaseWatermark('{}'))
  Object.assign(catalog, parseKnowledgeBaseCatalogDisplay('{}'))
  loading.value = false
  saving.value = knowledgeBaseMutationInFlight(knowledgeBaseId.value, 'settings')
  memberWorking.value = knowledgeBaseMutationInFlight(knowledgeBaseId.value, 'members')
  transferring.value = knowledgeBaseMutationInFlight(knowledgeBaseId.value, 'transfer')
  ownershipPermissionsLoading.value = false
  canTransferKnowledgeBase.value = false
  manageableOwnerValues.value = new Set()
  lifecycleWorking.value = knowledgeBaseLifecycleMutation(knowledgeBaseId.value)
  error.value = ''
  candidate.value = ''
  memberRole.value = 'READER'
  targetOwner.value = ''
  transferDialog.value = false
  pendingTransferTarget.value = null
  transferError.value = ''
  mergeTarget.value = ''
  mergePlan.value = null
  confirmName.value = ''
  configWarnings.value = []
}

function emptySettingsForm(): SettingsForm {
  return {
    name: '', slug: '', description: '', icon: '', visibility: 'PRIVATE', allowPublicIndex: false,
    publishMode: 'MANUAL', homepagePageId: '', appearanceConfig: '{}', watermarkConfig: '{}', catalogConfig: '{}',
  }
}

function hydrateForm(knowledgeBase: KnowledgeBase) {
  Object.assign(form, {
    name: knowledgeBase.name,
    slug: knowledgeBase.slug,
    description: knowledgeBase.description ?? '',
    icon: knowledgeBase.icon ?? '',
    visibility: knowledgeBase.visibility,
    allowPublicIndex: knowledgeBase.allowPublicIndex,
    publishMode: knowledgeBase.publishMode,
    homepagePageId: knowledgeBase.homepagePageId ?? '',
    appearanceConfig: knowledgeBase.appearanceConfig || '{}',
    watermarkConfig: knowledgeBase.watermarkConfig || '{}',
    catalogConfig: knowledgeBase.catalogConfig || '{}',
  })
}

function isActiveSettingsContext(requestedKnowledgeBaseId: string, contextVersion: number) {
  return contextVersion === settingsContextVersion
    && requestedKnowledgeBaseId === knowledgeBaseId.value
    && kb.value?.id === requestedKnowledgeBaseId
}

function assertKnowledgeBase(value: KnowledgeBase, requestedKnowledgeBaseId: string) {
  if (!value || typeof value !== 'object' || value.id !== requestedKnowledgeBaseId || typeof value.workspaceId !== 'string'
    || typeof value.name !== 'string' || typeof value.slug !== 'string') throw new Error('知识库响应格式无效，请重新加载')
}

async function loadOwnershipPermissions(knowledgeBase: KnowledgeBase, teamValues: Team[], requestVersion: number) {
  const checks = [
    { value: 'SOURCE', resourceType: 'KNOWLEDGE_BASE', resourceId: knowledgeBase.id },
    { value: `WORKSPACE:${knowledgeBase.workspaceId}`, resourceType: 'WORKSPACE', resourceId: knowledgeBase.workspaceId },
    ...teamValues.map((team) => ({ value: `TEAM:${team.id}`, resourceType: 'TEAM', resourceId: team.id })),
  ]
  ownershipPermissionsLoading.value = true
  try {
    const results = await Promise.allSettled(checks.map((check) => post<AuthorizationDecision>('/api/v1/authorization/resolve', {
      resourceType: check.resourceType,
      resourceId: check.resourceId,
    })))
    if (requestVersion !== loadRequestVersion || knowledgeBase.id !== knowledgeBaseId.value) return
    const manageable = new Set<string>()
    results.forEach((result, index) => {
      if (result.status !== 'fulfilled' || !result.value.capabilities.includes('MANAGE')) return
      const value = checks[index]?.value
      if (value === 'SOURCE') canTransferKnowledgeBase.value = true
      else if (value) manageable.add(value)
    })
    manageableOwnerValues.value = manageable
  } finally {
    if (requestVersion === loadRequestVersion && knowledgeBase.id === knowledgeBaseId.value) ownershipPermissionsLoading.value = false
  }
}

function hydrateAppearance() {
  Object.assign(appearance, parseKnowledgeBaseAppearance(form.appearanceConfig))
  Object.assign(watermark, parseKnowledgeBaseWatermark(form.watermarkConfig))
  Object.assign(catalog, parseKnowledgeBaseCatalogDisplay(form.catalogConfig))
  configWarnings.value = [
    !isJsonObject(form.appearanceConfig) ? '原外观配置格式无效，将在保存时恢复为安全默认值。' : '',
    !isJsonObject(form.watermarkConfig) ? '原水印配置格式无效，将在保存时恢复为安全默认值。' : '',
    !isJsonObject(form.catalogConfig) ? '原目录配置格式无效，将在保存时恢复为安全默认值。' : '',
  ].filter(Boolean)
}

async function save(successMessage = '知识库设置已保存') {
  const current = activeKnowledgeBase.value
  if (!current || loading.value || saving.value || knowledgeBaseMutationInFlight(current.id, 'settings')) return false
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  const snapshot = { ...form, allowPublicIndex: form.visibility === 'PUBLIC' && form.allowPublicIndex }
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'settings')) return false
  saving.value = true
  error.value = ''
  try {
    const updated = await post<KnowledgeBase>('/api/v1/knowledge-bases/update', {
      knowledgeBaseId: requestedKnowledgeBaseId,
      ...snapshot,
      description: snapshot.description || null,
      icon: snapshot.icon || null,
      homepagePageId: snapshot.homepagePageId || null,
    })
    assertKnowledgeBase(updated, requestedKnowledgeBaseId)
    await session.loadNavigation()
    if (!isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) return false
    kb.value = updated
    if (form.visibility !== 'PUBLIC') form.allowPublicIndex = false
    ui.notify(successMessage)
    return true
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
    return false
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'settings')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) saving.value = false
  }
}

async function saveAppearance() {
  if (appearanceInvalid.value || !activeKnowledgeBase.value || loading.value || saving.value) return
  const requestedKnowledgeBaseId = activeKnowledgeBase.value.id
  const contextVersion = settingsContextVersion
  form.appearanceConfig = mergeKnowledgeBaseConfig(form.appearanceConfig, { ...appearance, coverUrl: safeCoverUrl.value })
  form.watermarkConfig = mergeKnowledgeBaseConfig(form.watermarkConfig, { ...watermark, text: watermark.text.trim() })
  form.catalogConfig = mergeKnowledgeBaseConfig(form.catalogConfig, { ...catalog })
  const succeeded = await save('外观与阅读设置已保存')
  if (succeeded && isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) configWarnings.value = []
}

async function addMember() {
  const current = activeKnowledgeBase.value
  const requestedUserId = candidate.value
  if (!current || loading.value || memberWorking.value || knowledgeBaseMutationInFlight(current.id, 'members') || !requestedUserId) return
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'members')) return
  memberWorking.value = true
  try {
    await post('/api/v1/knowledge-bases/members/upsert', { knowledgeBaseId: requestedKnowledgeBaseId, userId: requestedUserId, role: memberRole.value })
    if (!isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) return
    candidate.value = ''
    await load()
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'members')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) memberWorking.value = false
  }
}

async function removeMember(userId: string) {
  const current = activeKnowledgeBase.value
  if (!current || loading.value || memberWorking.value || knowledgeBaseMutationInFlight(current.id, 'members')) return
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'members')) return
  memberWorking.value = true
  try {
    await post('/api/v1/knowledge-bases/members/remove', { knowledgeBaseId: requestedKnowledgeBaseId, userId, role: null })
    if (!isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) return
    await load()
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'members')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) memberWorking.value = false
  }
}

function confirmTransfer() {
  if (!activeKnowledgeBase.value || loading.value || transferring.value || ownershipPermissionsLoading.value || !selectedOwnerTarget.value || targetOwner.value === currentOwnerValue.value) return
  pendingTransferTarget.value = { ...selectedOwnerTarget.value }
  transferError.value = ''
  transferDialog.value = true
}

function closeTransferDialog() {
  if (transferring.value) return
  transferDialog.value = false
  pendingTransferTarget.value = null
  transferError.value = ''
}

function updateTransferDialog(value: boolean) {
  if (value) transferDialog.value = true
  else closeTransferDialog()
}

async function transfer() {
  const current = activeKnowledgeBase.value
  const transferTarget = pendingTransferTarget.value
  if (!current || loading.value || transferring.value || knowledgeBaseMutationInFlight(current.id, 'transfer') || !transferTarget || transferTarget.value === currentOwnerValue.value) return
  if (!ownerTargets.value.some((item) => item.value === transferTarget.value)) {
    transferError.value = '目标归属已不可用，请关闭确认窗口后重新选择。'
    return
  }
  const separator = transferTarget.value.indexOf(':')
  if (separator < 1 || separator === transferTarget.value.length - 1) return
  const ownerType = transferTarget.value.slice(0, separator)
  const ownerId = transferTarget.value.slice(separator + 1)
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'transfer')) return
  transferring.value = true
  error.value = ''
  transferError.value = ''
  try {
    let transferred: KnowledgeBase
    try {
      transferred = await post<KnowledgeBase>('/api/v1/knowledge-bases/transfer', { knowledgeBaseId: requestedKnowledgeBaseId, ownerType, ownerId })
    } catch (value) {
      if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) transferError.value = messageOf(value)
      return
    }
    assertKnowledgeBase(transferred, requestedKnowledgeBaseId)

    if (!isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) {
      await session.loadNavigation()
      return
    }
    kb.value = transferred
    transferDialog.value = false
    pendingTransferTarget.value = null
    targetOwner.value = ''
    const refreshes: Array<Promise<unknown>> = [session.loadNavigation()]
    refreshes.push(load())
    const refreshResults = await Promise.allSettled(refreshes)
    const refreshFailure = refreshResults.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (refreshFailure && requestedKnowledgeBaseId === knowledgeBaseId.value) {
      error.value = `归属已完成转移，但页面刷新失败：${messageOf(refreshFailure.reason)}`
    }
    ui.notify('知识库归属已转移')
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) transferError.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'transfer')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) transferring.value = false
  }
}

async function planMerge() {
  const current = activeKnowledgeBase.value
  const requestedTargetId = mergeTarget.value
  if (!current || loading.value || !requestedTargetId || lifecycleWorking.value || knowledgeBaseMutationInFlight(current.id, 'lifecycle')) return
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle', 'plan')) return
  lifecycleWorking.value = 'plan'
  error.value = ''
  try {
    const value = await post<MergePlan>('/api/v1/knowledge-bases/merge/plan', { sourceKnowledgeBaseId: requestedKnowledgeBaseId, targetKnowledgeBaseId: requestedTargetId })
    const plan = normalizeMergePlan(value, requestedKnowledgeBaseId, requestedTargetId)
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion) && mergeTarget.value === requestedTargetId) mergePlan.value = plan
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) lifecycleWorking.value = ''
  }
}

async function executeMerge() {
  const current = activeKnowledgeBase.value
  const plan = mergePlan.value
  const requestedTargetId = mergeTarget.value
  if (!current || loading.value || !plan || plan.sourceKnowledgeBaseId !== current.id || plan.targetKnowledgeBaseId !== requestedTargetId || confirmName.value !== current.name || lifecycleWorking.value || knowledgeBaseMutationInFlight(current.id, 'lifecycle')) return
  const requestedKnowledgeBaseId = current.id
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle', 'merge')) return
  lifecycleWorking.value = 'merge'
  error.value = ''
  try {
    await post('/api/v1/knowledge-bases/merge/execute', {
      sourceKnowledgeBaseId: requestedKnowledgeBaseId,
      targetKnowledgeBaseId: requestedTargetId,
      planFingerprint: plan.fingerprint,
      idempotencyKey: createUuid(),
    })
    await session.loadNavigation()
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) await router.replace(`/app/kb/${requestedTargetId}`)
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) lifecycleWorking.value = ''
  }
}

async function archive() {
  const current = activeKnowledgeBase.value
  if (!current || loading.value || confirmName.value !== current.name || lifecycleWorking.value || knowledgeBaseMutationInFlight(current.id, 'lifecycle')) return
  const requestedKnowledgeBaseId = current.id
  const requestedWorkspaceId = current.workspaceId
  const contextVersion = settingsContextVersion
  if (!acquireKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle', 'archive')) return
  lifecycleWorking.value = 'archive'
  error.value = ''
  try {
    await post('/api/v1/knowledge-bases/archive', { knowledgeBaseId: requestedKnowledgeBaseId })
    await session.loadNavigation()
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) await router.replace(`/app/w/${requestedWorkspaceId}`)
  } catch (value) {
    if (isActiveSettingsContext(requestedKnowledgeBaseId, contextVersion)) error.value = messageOf(value)
  } finally {
    releaseKnowledgeBaseMutation(requestedKnowledgeBaseId, 'lifecycle')
    if (knowledgeBaseId.value === requestedKnowledgeBaseId) lifecycleWorking.value = ''
  }
}

function normalizeMergePlan(value: MergePlan, sourceKnowledgeBaseId: string, targetKnowledgeBaseId: string): MergePlan {
  if (!value || typeof value !== 'object' || value.sourceKnowledgeBaseId !== sourceKnowledgeBaseId
    || value.targetKnowledgeBaseId !== targetKnowledgeBaseId || typeof value.fingerprint !== 'string' || !value.fingerprint
    || !Number.isFinite(value.pageCount) || !Number.isFinite(value.catalogNodeCount) || !Array.isArray(value.paths)
    || !Array.isArray(value.warnings) || !value.warnings.every((warning) => typeof warning === 'string')
    || !value.paths.every((path) => path && typeof path === 'object' && typeof path.pageId === 'string'
      && typeof path.title === 'string' && typeof path.originalPath === 'string' && typeof path.resolvedPath === 'string'
      && typeof path.renamed === 'boolean')) throw new Error('合并预检响应格式无效，请重新预检')
  return value
}

function validateCover(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length > 2_000) return '封面地址不能超过 2000 个字符'
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return '封面地址包含无效字符'
  try {
    const url = new URL(trimmed)
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) return '请填写不含账号凭据的 HTTPS 图片地址'
    return ''
  } catch { return '请输入完整的 HTTPS 图片地址' }
}

function isJsonObject(value: string) {
  try {
    const parsed: unknown = JSON.parse(value)
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed))
  } catch { return false }
}
</script>

<template>
  <div class="kb-settings-page">
    <div class="settings-container">
      <header class="settings-header">
        <router-link :to="`/app/kb/${knowledgeBaseId}`" class="back-link">
          <v-icon size="18">mdi-arrow-left</v-icon><span>返回知识库</span>
        </router-link>
        <h1>{{ kb?.name || '知识库' }} · 设置</h1>
        <p>管理知识库的基础信息、阅读外观、成员与访问方式。</p>
      </header>

      <v-alert v-if="error" type="error" variant="tonal" closable density="comfortable" class="page-alert" @click:close="error=''">{{ error }}</v-alert>
      <v-progress-linear v-if="loading" indeterminate color="primary" class="page-progress" />

      <nav class="settings-tabs" aria-label="知识库设置">
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'general' }" @click="tab = 'general'">基础</button>
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'appearance' }" @click="tab = 'appearance'">外观</button>
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'members' }" @click="tab = 'members'">成员</button>
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'sharing' }" @click="tab = 'sharing'">分享与访问</button>
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'ownership' }" @click="tab = 'ownership'">归属</button>
        <button type="button" :disabled="loading || !activeKnowledgeBase || transferring" :class="{ active: tab === 'danger' }" @click="tab = 'danger'">高级</button>
      </nav>

      <main v-if="activeKnowledgeBase" class="settings-stage">
        <section v-if="tab === 'general'" class="settings-panel">
          <div class="panel-heading">
            <div><h2>基础信息</h2><p>设置知识库的名称、地址和默认访问方式。</p></div>
          </div>
          <div class="compact-grid">
            <v-text-field v-model="form.name" label="名称" maxlength="160" counter density="comfortable" variant="outlined" />
            <v-text-field v-model="form.slug" label="访问路径" prefix="/" hint="可使用中文、字母、数字和连字符" persistent-hint density="comfortable" variant="outlined" />
            <v-text-field v-model="form.icon" label="图标" hint="可填写 Emoji 或图片地址" persistent-hint density="comfortable" variant="outlined" />
            <v-select v-model="form.homepagePageId" label="知识库首页" :items="pages" item-title="title" item-value="id" clearable placeholder="使用默认首页" density="comfortable" variant="outlined" />
          </div>
          <v-textarea v-model="form.description" label="知识库介绍" maxlength="8000" rows="3" auto-grow density="comfortable" variant="outlined" class="description-field" />
          <div class="subsection">
            <div class="subsection-heading"><h3>访问与发布</h3><p>这些设置决定知识库默认对谁可见，以及内容如何发布。</p></div>
            <div class="compact-grid">
              <v-select v-model="form.visibility" label="可见范围" :items="visibilityItems" density="comfortable" variant="outlined" />
              <v-select v-model="form.publishMode" label="发布方式" :items="publishModeItems" density="comfortable" variant="outlined" />
            </div>
            <div class="setting-switch">
              <div><strong>允许搜索引擎收录</strong><span>仅在公开访问时生效；关闭后公开地址仍可访问。</span></div>
              <v-switch v-model="form.allowPublicIndex" color="primary" inset hide-details :disabled="form.visibility !== 'PUBLIC'" aria-label="允许搜索引擎收录" />
            </div>
          </div>
          <div class="panel-actions"><v-btn color="primary" :loading="saving" :disabled="loading || saving || !form.name.trim() || !form.slug.trim()" @click="save()">保存设置</v-btn></div>
        </section>

        <section v-else-if="tab === 'appearance'" class="settings-panel appearance-panel">
          <div class="panel-heading">
            <div><h2>外观</h2><p>调整公开阅读页和受控分享页的视觉与目录显示。</p></div>
          </div>
          <v-alert v-for="warning in configWarnings" :key="warning" type="warning" variant="tonal" density="compact" class="mb-3">{{ warning }}</v-alert>
          <div class="appearance-layout">
            <section class="appearance-form">
              <div class="config-section first">
                <div class="subsection-heading"><h3>阅读主题</h3><p>选择一个适合知识库内容的阅读风格。</p></div>
                <v-item-group v-model="appearance.theme" mandatory class="theme-grid">
                  <v-item v-for="item in themeItems" :key="item.value" v-slot="{ isSelected, toggle }" :value="item.value">
                    <button type="button" class="theme-option" :class="{ selected: isSelected }" @click="toggle">
                      <v-icon size="20">{{ item.icon }}</v-icon><span><strong>{{ item.title }}</strong><small>{{ item.subtitle }}</small></span><v-icon v-if="isSelected" size="17" color="primary">mdi-check</v-icon>
                    </button>
                  </v-item>
                </v-item-group>
                <v-text-field v-model="appearance.coverUrl" label="封面图片地址" placeholder="https://example.com/cover.jpg" prepend-inner-icon="mdi-image-outline" :error-messages="coverError ? [coverError] : []" clearable hint="仅支持不含账号凭据的 HTTPS 地址" persistent-hint density="comfortable" variant="outlined" class="mt-4" />
                <div class="color-grid"><v-text-field v-model="appearance.backgroundColor" type="color" label="页面背景色" density="comfortable" variant="outlined" /><v-text-field v-model="appearance.accentColor" type="color" label="强调色" density="comfortable" variant="outlined" /></div>
                <v-select v-model="appearance.contentWidth" label="正文宽度" :items="widthItems" density="comfortable" variant="outlined" />
              </div>

              <div class="config-section">
                <div class="setting-heading"><div class="subsection-heading"><h3>阅读水印</h3><p>在公开阅读和受控分享内容上显示。</p></div><v-switch v-model="watermark.enabled" color="primary" inset hide-details aria-label="启用阅读水印" /></div>
                <template v-if="watermark.enabled">
                  <v-text-field v-model="watermark.text" label="水印文字" maxlength="120" counter :error-messages="watermarkTextError ? [watermarkTextError] : []" hint="可使用 {{email}} 替换当前账号邮箱" persistent-hint density="comfortable" variant="outlined" />
                  <v-select v-model="watermark.position" label="显示位置" :items="watermarkPositionItems" density="comfortable" variant="outlined" />
                  <div class="slider-label"><span>透明度</span><strong>{{ Math.round(watermark.opacity * 100) }}%</strong></div>
                  <v-slider v-model="watermark.opacity" :min="0.05" :max="0.4" :step="0.01" color="primary" hide-details />
                </template>
                <p v-else class="inline-hint">水印当前关闭，已有配置会保留。</p>
              </div>

              <div class="config-section">
                <div class="subsection-heading"><h3>目录显示</h3><p>控制读者首次打开知识库时看到的信息。</p></div>
                <div class="slider-label"><span>默认展开层级</span><strong>{{ catalog.defaultExpandDepth }} 层</strong></div>
                <v-slider v-model="catalog.defaultExpandDepth" :min="1" :max="6" :step="1" color="primary" thumb-label hide-details />
                <div class="setting-switch compact"><span>显示文稿访问路径</span><v-switch v-model="catalog.showPath" color="primary" inset hide-details aria-label="显示文稿访问路径" /></div>
                <div class="setting-switch compact"><span>显示最近更新时间</span><v-switch v-model="catalog.showUpdatedAt" color="primary" inset hide-details aria-label="显示最近更新时间" /></div>
              </div>
              <div class="panel-actions"><v-btn color="primary" :loading="saving" :disabled="loading || saving || appearanceInvalid" @click="saveAppearance">保存外观设置</v-btn></div>
            </section>

            <aside class="preview-column">
              <div class="preview-sticky">
                <div class="preview-heading"><span>阅读页预览</span></div>
                <div class="reader-preview" :class="`theme-${appearance.theme.toLowerCase()}`" :style="previewStyle">
                  <div class="preview-document" :style="{ maxWidth: previewWidth }">
                    <span class="preview-icon">{{ form.icon || '📘' }}</span><small>知识库</small>
                    <h2>{{ form.name || kb?.name || '知识库名称' }}</h2><p>{{ form.description || '在这里持续沉淀和分享团队知识。' }}</p>
                    <div class="preview-rule" /><h3>开始阅读</h3><p>这是正文排版和强调色的预览。</p><a>查看下一篇文稿 →</a>
                    <span v-if="watermark.enabled" class="preview-watermark" :class="`position-${watermark.position.toLowerCase()}`" :style="{ opacity: watermark.opacity }">{{ previewWatermark }}</span>
                  </div>
                </div>
                <div class="catalog-preview">
                  <header><v-icon size="18">mdi-file-tree-outline</v-icon><strong>目录预览</strong><span>展开 {{ catalog.defaultExpandDepth }} 层</span></header>
                  <div class="catalog-row"><v-icon size="17">mdi-chevron-down</v-icon><span>快速开始</span></div>
                  <div class="catalog-row nested"><v-icon size="17">mdi-file-document-outline</v-icon><span><b>欢迎使用</b><small v-if="catalog.showPath">/welcome</small><small v-if="catalog.showUpdatedAt">今天更新</small></span></div>
                  <div v-if="catalog.defaultExpandDepth > 1" class="catalog-row nested"><v-icon size="17">mdi-file-document-outline</v-icon><span><b>使用指南</b><small v-if="catalog.showPath">/guide</small><small v-if="catalog.showUpdatedAt">昨天更新</small></span></div>
                </div>
              </div>
            </aside>
          </div>
        </section>

        <section v-else-if="tab === 'members'" class="settings-panel members-panel">
          <div class="panel-heading"><div><h2>成员</h2><p>邀请空间成员加入知识库并设置访问权限。</p></div><span class="count-label">{{ members.length }} 名成员</span></div>
          <div class="member-toolbar"><v-select v-model="candidate" :items="workspaceMembers.filter(person => !members.some(member => member.userId === person.userId))" item-title="email" item-value="userId" label="选择空间成员" hide-details density="comfortable" variant="outlined" :disabled="loading || memberWorking" /><v-select v-model="memberRole" :items="memberRoleItems" label="授予权限" hide-details density="comfortable" variant="outlined" :disabled="loading || memberWorking" /><v-btn color="primary" :loading="memberWorking" :disabled="loading || memberWorking || !candidate" @click="addMember">添加成员</v-btn></div>
          <div class="member-list">
            <div v-for="member in members" :key="member.userId" class="member-row"><v-avatar size="34" color="#eef3ff"><v-icon size="19" color="#3978f6">mdi-account-outline</v-icon></v-avatar><div><strong>{{ member.displayName || member.email }}</strong><span>{{ member.email }}</span></div><span class="member-role">{{ memberRoleItems.find(item => item.value === member.role)?.title }}</span><v-btn icon="mdi-close" size="small" variant="text" color="error" :disabled="loading || memberWorking" :aria-label="`移除 ${member.email}`" @click="removeMember(member.userId)" /></div>
            <div v-if="!members.length && !loading" class="empty-members">还没有单独添加成员，知识库将使用上层访问规则。</div>
          </div>
        </section>

        <div v-else-if="tab === 'sharing' && kb" class="share-wrap"><KnowledgeBaseSharesPanel :knowledge-base="kb" /></div>

        <section v-else-if="tab === 'ownership'" class="settings-panel ownership-panel">
          <div class="panel-heading"><div><h2>知识库归属</h2><p>查看当前归属，并将知识库转移给你有权管理的个人、空间或团队。</p></div></div>
          <div class="ownership-section">
            <div class="current-owner">
              <v-icon size="20">{{ kb?.ownerType === 'TEAM' ? 'mdi-account-group-outline' : kb?.ownerType === 'PERSONAL' ? 'mdi-account-outline' : 'mdi-domain' }}</v-icon>
              <div><small>当前归属</small><strong>{{ currentOwnerTitle }}</strong><span>{{ currentOwnerDescription }}</span></div>
            </div>
            <v-select
              v-model="targetOwner"
              :items="ownerTargets"
              item-title="title"
              item-value="value"
              label="目标归属"
              no-data-text="暂无可转移的归属"
              clearable
              density="comfortable"
              variant="outlined"
              class="owner-select"
              :disabled="loading || ownershipPermissionsLoading || transferring || !ownerTargets.length"
            >
              <template #item="{ props, item }"><v-list-item v-bind="props" :prepend-icon="item.raw.icon" :subtitle="item.raw.subtitle" /></template>
              <template #selection="{ item }"><div v-if="item?.raw" class="owner-selection"><v-icon size="18" class="mr-2">{{ item.raw.icon }}</v-icon><span>{{ item.raw.title }}</span></div></template>
            </v-select>
            <p class="inline-hint">只显示你具备管理权限的目标；转移不会改变内容、文稿 ID 或公开链接。</p>
            <div v-if="!loading && !ownershipPermissionsLoading && !ownerTargets.length" class="ownership-empty">
              <v-icon size="22">mdi-swap-horizontal</v-icon><div><strong>暂无可转移的归属</strong><p>{{ noTransferReason }}</p></div>
            </div>
            <div class="ownership-actions"><v-btn color="primary" variant="outlined" :disabled="!selectedOwnerTarget || transferring || ownershipPermissionsLoading" @click="confirmTransfer">转移归属</v-btn></div>
          </div>
        </section>

        <div v-else-if="tab === 'danger'" class="advanced-stack">
          <section class="settings-panel">
            <div class="panel-heading"><div><h2>高级设置</h2><p>管理知识库生命周期。普通使用无需调整这些设置。</p></div></div>

            <div class="advanced-section">
              <div class="advanced-heading"><div><h3>合并知识库</h3><p>先预检目录和路径冲突，再将当前知识库合并到目标知识库。</p></div></div>
              <div class="merge-row"><v-select v-model="mergeTarget" :items="allKbs.filter(item => item.id !== knowledgeBaseId)" item-title="name" item-value="id" label="目标知识库" hide-details density="comfortable" variant="outlined" /><v-btn variant="outlined" :loading="lifecycleWorking === 'plan'" :disabled="!mergeTarget || Boolean(lifecycleWorking)" @click="planMerge">开始预检</v-btn></div>
              <v-alert v-if="mergePlan" type="warning" variant="tonal" density="compact" class="mt-4">将移动 {{ mergePlan.pageCount }} 篇内容和 {{ mergePlan.catalogNodeCount }} 个目录项；检测到 {{ mergePlan.paths.filter(path => path.renamed).length }} 个路径冲突。</v-alert>
            </div>

            <div class="advanced-section danger-section">
              <div class="advanced-heading"><div><h3>危险操作</h3><p>合并和归档均会改变知识库的可用状态，请输入知识库名称确认。</p></div></div>
              <v-text-field v-model="confirmName" :label="`输入 ${kb?.name || '知识库名称'} 确认`" density="comfortable" variant="outlined" class="confirm-field" />
              <div class="danger-actions"><v-btn v-if="mergePlan" color="error" :loading="lifecycleWorking === 'merge'" :disabled="confirmName !== kb?.name || Boolean(lifecycleWorking)" @click="executeMerge">执行合并</v-btn><v-btn color="error" variant="outlined" :loading="lifecycleWorking === 'archive'" :disabled="confirmName !== kb?.name || Boolean(lifecycleWorking)" @click="archive">归档知识库</v-btn></div>
            </div>
          </section>
        </div>
      </main>
    </div>

    <v-dialog :model-value="transferDialog" :persistent="transferring" max-width="520" @update:model-value="updateTransferDialog">
      <v-card v-if="transferDialog" rounded="lg"><v-card-title class="pa-6 pb-2">确认转移知识库归属？</v-card-title><v-card-text class="px-6"><p>“{{ kb?.name }}”将从“{{ currentOwnerTitle }}”转移到“{{ pendingTransferTarget?.title }}”。</p><v-alert type="warning" variant="tonal" density="compact">转移会立即改变权限继承关系，但不会改变内容、文稿 ID 和公开链接。</v-alert><v-alert v-if="transferError" type="error" variant="tonal" density="compact" class="mt-3">{{ transferError }}</v-alert></v-card-text><v-card-actions class="pa-6 pt-3"><v-spacer /><v-btn :disabled="transferring" @click="closeTransferDialog">取消</v-btn><v-btn color="primary" :loading="transferring" :disabled="transferring || !pendingTransferTarget" @click="transfer">确认转移</v-btn></v-card-actions></v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.kb-settings-page{min-height:100vh;padding:34px 36px 72px;background:#f7f8fa;color:#262626}.settings-container{width:min(1080px,100%);margin:0 auto}.settings-header{margin-bottom:20px}.back-link{display:inline-flex;height:30px;align-items:center;gap:6px;margin-bottom:13px;color:#595959;font-size:13px;text-decoration:none}.back-link:hover{color:#1677ff}.settings-header h1{margin:0;font-size:24px;font-weight:600;line-height:34px;letter-spacing:-.02em}.settings-header p{margin:6px 0 0;color:#8a8f8d;font-size:14px}.page-alert{margin:0 0 14px}.page-progress{margin-bottom:10px}.settings-tabs{display:flex;height:46px;align-items:flex-end;gap:30px;border-bottom:1px solid #e7e9e8}.settings-tabs button{position:relative;height:46px;padding:0 2px;border:0;color:#595959;background:transparent;font:500 14px/46px inherit;cursor:pointer;white-space:nowrap}.settings-tabs button:hover{color:#262626}.settings-tabs button:disabled{cursor:default;opacity:.55}.settings-tabs button.active{color:#1677ff}.settings-tabs button.active::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px;background:#1677ff;content:""}.settings-stage{padding-top:20px}.settings-panel{overflow:hidden;border:1px solid #e7e9e8;border-radius:10px;padding:26px 30px 30px;background:#fff}.panel-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:24px}.panel-heading h2{margin:0;color:#262626;font-size:18px;font-weight:600;line-height:26px}.panel-heading p,.subsection-heading p,.advanced-heading p{margin:4px 0 0;color:#8a8f8d;font-size:13px;line-height:20px}.compact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:2px 18px}.description-field{margin-top:2px}.subsection{margin-top:8px;border-top:1px solid #eff0f0;padding-top:23px}.subsection-heading h3,.advanced-heading h3{margin:0;font-size:15px;font-weight:600}.setting-switch{display:flex;min-height:56px;align-items:center;justify-content:space-between;gap:18px;border-top:1px solid #eff0f0;padding:8px 2px}.setting-switch>div{display:flex;flex-direction:column}.setting-switch strong{font-size:14px;font-weight:500}.setting-switch span,.inline-hint{color:#8a8f8d;font-size:12px;line-height:18px}.setting-switch.compact{min-height:48px}.panel-actions{display:flex;justify-content:flex-end;margin-top:22px}.appearance-panel{overflow:visible}.appearance-layout{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:32px}.appearance-form{min-width:0}.config-section{border-top:1px solid #eff0f0;padding:23px 0}.config-section.first{border-top:0;padding-top:0}.theme-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:14px}.theme-option{display:grid;min-height:60px;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px 12px;border:1px solid #dfe2e1;border-radius:7px;color:#595959;background:#fff;font:inherit;text-align:left;cursor:pointer}.theme-option:hover{border-color:#b9bdba}.theme-option.selected{border-color:#7ba7f8;background:#f5f8ff;color:#245ec6}.theme-option span{display:flex;min-width:0;flex-direction:column}.theme-option strong{color:#262626;font-size:13px;font-weight:500}.theme-option small{margin-top:1px;color:#8a8f8d;font-size:11px}.color-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.setting-heading{display:flex;align-items:center;justify-content:space-between;gap:20px}.slider-label{display:flex;justify-content:space-between;margin:13px 0 4px;color:#595959;font-size:12px}.inline-hint{margin:8px 0}.preview-sticky{position:sticky;top:24px}.preview-heading{margin-bottom:8px;color:#8a8f8d;font-size:12px}.reader-preview{min-height:370px;display:flex;align-items:center;justify-content:center;overflow:hidden;border:1px solid #e7e9e8;border-radius:8px;padding:18px;background-position:center;background-size:cover}.preview-document{position:relative;width:100%;min-height:300px;overflow:hidden;border-radius:7px;padding:28px;background:rgba(255,255,255,.96);color:#1e293b;box-shadow:0 9px 30px rgba(15,23,42,.1)}.theme-minimal .preview-document{border-radius:1px;box-shadow:none}.theme-magazine .preview-document h2{font-family:Georgia,'Noto Serif SC',serif;font-size:1.65rem}.theme-dark .preview-document{background:rgba(17,24,39,.96);color:#e5e7eb}.preview-document small{color:var(--preview-accent);font-weight:700}.preview-document h2{margin:7px 0;font-size:1.45rem}.preview-document h3{margin:18px 0 6px;font-size:14px}.preview-document p{color:#64748b;font-size:12px;line-height:1.65}.theme-dark .preview-document p{color:#94a3b8}.preview-document a{color:var(--preview-accent);font-size:12px;font-weight:600}.preview-icon{display:block;margin-bottom:11px;font-size:1.65rem}.preview-rule{width:42px;height:2px;margin-top:18px;border-radius:9px;background:var(--preview-accent)}.preview-watermark{position:absolute;color:var(--preview-accent);font-size:11px;font-weight:700;pointer-events:none;white-space:nowrap}.preview-watermark.position-center{inset:50% auto auto 50%;transform:translate(-50%,-50%) rotate(-22deg)}.preview-watermark.position-footer{inset:auto 14px 11px auto}.preview-watermark.position-tiled{inset:48% auto auto 42%;transform:rotate(-22deg);text-shadow:-120px -95px currentColor,120px -95px currentColor,-120px 95px currentColor,120px 95px currentColor}.catalog-preview{margin-top:12px;border:1px solid #e7e9e8;border-radius:8px;padding:13px;background:#fafafa}.catalog-preview header{display:flex;align-items:center;gap:7px;margin-bottom:7px;font-size:12px}.catalog-preview header span{margin-left:auto;color:#8a8f8d;font-size:11px}.catalog-row{display:flex;min-height:30px;align-items:center;gap:7px;color:#595959;font-size:12px}.catalog-row.nested{padding-left:20px}.catalog-row span{display:flex;min-width:0;align-items:center;gap:7px}.catalog-row small{color:#a1a4a2}.count-label,.secondary-badge{border-radius:5px;padding:3px 7px;color:#8a8f8d;background:#f3f4f4;font-size:12px}.member-toolbar{display:grid;grid-template-columns:minmax(260px,1fr) 170px auto;align-items:center;gap:10px;margin-bottom:20px}.member-list{border-top:1px solid #eff0f0}.member-row{display:grid;min-height:58px;grid-template-columns:auto minmax(0,1fr) auto auto;align-items:center;gap:11px;border-bottom:1px solid #f2f3f3}.member-row>div{display:flex;min-width:0;flex-direction:column}.member-row strong{overflow:hidden;font-size:13px;font-weight:500;text-overflow:ellipsis;white-space:nowrap}.member-row span{color:#8a8f8d;font-size:12px}.member-role{padding:3px 7px;border-radius:5px;background:#f3f4f4}.empty-members{padding:52px 20px;color:#8a8f8d;font-size:13px;text-align:center}.share-wrap :deep(.share-panel){border-color:#e7e9e8!important;border-radius:10px!important;box-shadow:none!important}.share-wrap :deep(.panel-title){padding:24px 28px 18px!important}.share-wrap :deep(.v-card-text){padding-right:28px!important;padding-left:28px!important}.ownership-section{max-width:720px}.ownership-actions{display:flex;justify-content:flex-end;margin-top:18px}.ownership-empty{display:flex;align-items:flex-start;gap:10px;margin:16px 0 0;padding:13px 14px;border:1px dashed #d9dcda;border-radius:7px;color:#8a8f8d;background:#fafafa}.ownership-empty strong{color:#595959;font-size:13px;font-weight:500}.ownership-empty p{margin:3px 0 0;font-size:12px;line-height:18px}.advanced-stack{display:grid;gap:16px}.advanced-section{border-top:1px solid #eff0f0;padding:24px 0 2px}.advanced-section:first-of-type{border-top:0;padding-top:0}.advanced-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.current-owner{display:grid;grid-template-columns:auto minmax(0,1fr);align-items:center;gap:12px;margin:15px 0;padding:13px 14px;border:1px solid #e7e9e8;border-radius:7px;background:#fafafa}.current-owner>div{display:flex;min-width:0;flex-direction:column}.current-owner small{color:#8a8f8d;font-size:11px}.current-owner strong{margin:1px 0;color:#262626;font-size:13px;font-weight:500}.current-owner span{color:#8a8f8d;font-size:12px}.owner-select{max-width:620px;margin-top:15px}.owner-selection{display:flex;align-items:center}.merge-row{display:grid;grid-template-columns:minmax(0,620px) auto;align-items:center;gap:10px;margin-top:15px}.danger-section h3{color:#d93026}.confirm-field{max-width:620px;margin-top:15px}.danger-actions{display:flex;gap:10px}.v-btn{text-transform:none;letter-spacing:0}@media(max-width:980px){.appearance-layout{grid-template-columns:1fr}.preview-sticky{position:static}.preview-column{max-width:500px}}@media(max-width:700px){.kb-settings-page{padding:22px 16px 48px}.settings-header h1{font-size:21px}.settings-tabs{gap:22px;overflow-x:auto}.settings-panel{padding:22px 18px}.compact-grid,.theme-grid,.color-grid{grid-template-columns:1fr}.member-toolbar{grid-template-columns:1fr}.member-row{grid-template-columns:auto minmax(0,1fr) auto}.member-role{grid-column:2}.member-row>.v-btn{grid-column:3;grid-row:1/3}.merge-row{grid-template-columns:1fr}.danger-actions{align-items:stretch;flex-direction:column}.share-wrap :deep(.panel-title),.share-wrap :deep(.v-card-text){padding-right:18px!important;padding-left:18px!important}}
</style>
