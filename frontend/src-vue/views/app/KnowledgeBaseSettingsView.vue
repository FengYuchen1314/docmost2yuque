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

interface Member {
  userId: string
  email: string
  displayName: string | null
  role: 'READER' | 'EDITOR' | 'MANAGER'
}
interface TeamMember { userId: string; role: 'MEMBER' | 'MANAGER' }
interface MergePlan { fingerprint: string; pageCount: number; catalogNodeCount: number; pathConflicts: Array<unknown>; warnings: string[] }
interface OwnerTarget { value: string; title: string; subtitle: string; icon: string }
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
const teamRoles = ref<Record<string, TeamMember['role'] | undefined>>({})
const allKbs = ref<KnowledgeBase[]>([])
const tab = ref('general')
const loading = ref(false)
const saving = ref(false)
const transferring = ref(false)
const lifecycleWorking = ref<'' | 'plan' | 'merge' | 'archive'>('')
const error = ref('')
const candidate = ref('')
const memberRole = ref<Member['role']>('READER')
const targetOwner = ref('')
const transferDialog = ref(false)
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
const workspaceCanManage = computed(() => ['OWNER', 'ADMIN'].includes(workspace.value?.membershipRole ?? ''))
const currentOwnerValue = computed(() => kb.value ? `${kb.value.ownerType}:${kb.value.ownerId}` : '')
const currentOwnerTeam = computed(() => teams.value.find((team) => team.id === kb.value?.ownerId) ?? null)
const currentOwnerPerson = computed(() => workspaceMembers.value.find((person) => person.userId === kb.value?.ownerId) ?? null)
const currentOwnerTitle = computed(() => {
  if (!kb.value) return '正在读取归属信息'
  if (kb.value.ownerType === 'PERSONAL') {
    if (kb.value.ownerId === session.user?.userId) return '归你个人管理'
    return `个人 · ${currentOwnerPerson.value?.displayName || currentOwnerPerson.value?.email || '空间成员'}`
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
  if (!kb.value) return []
  const values: OwnerTarget[] = []
  if (session.user && currentOwnerValue.value !== `PERSONAL:${session.user.userId}`) {
    values.push({
      value: `PERSONAL:${session.user.userId}`,
      title: '归我个人管理',
      subtitle: `由 ${session.user.email} 管理；知识库仍保留在当前空间`,
      icon: 'mdi-account-outline',
    })
  }
  if (workspaceCanManage.value && currentOwnerValue.value !== `WORKSPACE:${kb.value.workspaceId}`) {
    values.push({
      value: `WORKSPACE:${kb.value.workspaceId}`,
      title: `空间 · ${workspace.value?.name ?? '当前空间'}`,
      subtitle: '由空间管理员管理，并按空间权限规则继承',
      icon: 'mdi-domain',
    })
  }
  for (const team of teams.value) {
    if ((workspaceCanManage.value || teamRoles.value[team.id] === 'MANAGER') && currentOwnerValue.value !== `TEAM:${team.id}`) {
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
  if (loading.value) return '正在检查你可管理的目标…'
  if (!session.user) return '无法读取当前账号，暂时不能转移归属。请刷新页面后重试。'
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

onMounted(load)
watch(knowledgeBaseId, () => load())
watch(mergeTarget, () => { mergePlan.value = null; confirmName.value = '' })

async function load() {
  if (!knowledgeBaseId.value) return
  loading.value = true
  error.value = ''
  try {
    const knowledgeBase = await post<KnowledgeBase>('/api/v1/knowledge-bases/get', { knowledgeBaseId: knowledgeBaseId.value })
    kb.value = knowledgeBase
    const [pageValues, memberValues, workspaceMemberValues, teamValues, knowledgeBaseValues] = await Promise.all([
      post<Page[]>('/api/v1/pages/list', { knowledgeBaseId: knowledgeBaseId.value }),
      post<Member[]>('/api/v1/knowledge-bases/members', { knowledgeBaseId: knowledgeBaseId.value }),
      post<WorkspaceMember[]>('/api/v1/workspaces/members', { workspaceId: knowledgeBase.workspaceId }),
      post<Team[]>('/api/v1/teams/list', { workspaceId: knowledgeBase.workspaceId }),
      post<KnowledgeBase[]>('/api/v1/knowledge-bases/list', { workspaceId: knowledgeBase.workspaceId }),
    ])
    pages.value = pageValues
    members.value = memberValues
    workspaceMembers.value = workspaceMemberValues
    teams.value = teamValues
    allKbs.value = knowledgeBaseValues
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
    hydrateAppearance()
    targetOwner.value = ''
    transferDialog.value = false
    mergeTarget.value = ''
    mergePlan.value = null
    confirmName.value = ''
    await loadTeamRoles(teamValues)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    loading.value = false
  }
}

async function loadTeamRoles(teamValues: Team[]) {
  if (!session.user || workspaceCanManage.value) {
    teamRoles.value = {}
    return
  }
  const results = await Promise.allSettled(teamValues.map(async (team) => {
    const teamMembers = await post<TeamMember[]>('/api/v1/teams/members', { teamId: team.id })
    return [team.id, teamMembers.find((member) => member.userId === session.user?.userId)?.role] as const
  }))
  teamRoles.value = Object.fromEntries(
    results
      .filter((result): result is PromiseFulfilledResult<readonly [string, TeamMember['role'] | undefined]> => result.status === 'fulfilled')
      .map((result) => result.value),
  )
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
  if (!kb.value) return
  saving.value = true
  error.value = ''
  try {
    if (form.visibility !== 'PUBLIC') form.allowPublicIndex = false
    kb.value = await post<KnowledgeBase>('/api/v1/knowledge-bases/update', {
      knowledgeBaseId: knowledgeBaseId.value,
      ...form,
      description: form.description || null,
      icon: form.icon || null,
      homepagePageId: form.homepagePageId || null,
      allowPublicIndex: form.allowPublicIndex,
    })
    await session.loadNavigation()
    ui.notify(successMessage)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    saving.value = false
  }
}

async function saveAppearance() {
  if (appearanceInvalid.value) return
  form.appearanceConfig = mergeKnowledgeBaseConfig(form.appearanceConfig, { ...appearance, coverUrl: safeCoverUrl.value })
  form.watermarkConfig = mergeKnowledgeBaseConfig(form.watermarkConfig, { ...watermark, text: watermark.text.trim() })
  form.catalogConfig = mergeKnowledgeBaseConfig(form.catalogConfig, { ...catalog })
  await save('外观与阅读设置已保存')
  if (!error.value) configWarnings.value = []
}

async function addMember() {
  try {
    await post('/api/v1/knowledge-bases/members/upsert', { knowledgeBaseId: knowledgeBaseId.value, userId: candidate.value, role: memberRole.value })
    candidate.value = ''
    await load()
  } catch (value) { error.value = messageOf(value) }
}

async function removeMember(userId: string) {
  try {
    await post('/api/v1/knowledge-bases/members/remove', { knowledgeBaseId: knowledgeBaseId.value, userId, role: null })
    await load()
  } catch (value) { error.value = messageOf(value) }
}

function confirmTransfer() {
  if (!selectedOwnerTarget.value || targetOwner.value === currentOwnerValue.value) return
  transferDialog.value = true
}

async function transfer() {
  if (!selectedOwnerTarget.value || targetOwner.value === currentOwnerValue.value) return
  const separator = targetOwner.value.indexOf(':')
  const ownerType = targetOwner.value.slice(0, separator)
  const ownerId = targetOwner.value.slice(separator + 1)
  transferring.value = true
  error.value = ''
  try {
    await post('/api/v1/knowledge-bases/transfer', { knowledgeBaseId: knowledgeBaseId.value, ownerType, ownerId })
    transferDialog.value = false
    await session.loadNavigation()
    await load()
    ui.notify('知识库归属已转移')
  } catch (value) {
    error.value = messageOf(value)
    transferDialog.value = false
  } finally { transferring.value = false }
}

async function planMerge() {
  if (!mergeTarget.value || lifecycleWorking.value) return
  lifecycleWorking.value = 'plan'
  error.value = ''
  try {
    mergePlan.value = await post('/api/v1/knowledge-bases/merge/plan', { sourceKnowledgeBaseId: knowledgeBaseId.value, targetKnowledgeBaseId: mergeTarget.value })
  } catch (value) {
    error.value = messageOf(value)
  } finally { lifecycleWorking.value = '' }
}

async function executeMerge() {
  if (!mergePlan.value || confirmName.value !== kb.value?.name || lifecycleWorking.value) return
  lifecycleWorking.value = 'merge'
  error.value = ''
  try {
    await post('/api/v1/knowledge-bases/merge/execute', {
      sourceKnowledgeBaseId: knowledgeBaseId.value,
      targetKnowledgeBaseId: mergeTarget.value,
      planFingerprint: mergePlan.value.fingerprint,
      idempotencyKey: createUuid(),
    })
    await session.loadNavigation()
    await router.replace(`/app/kb/${mergeTarget.value}`)
  } catch (value) {
    error.value = messageOf(value)
  } finally { lifecycleWorking.value = '' }
}

async function archive() {
  if (confirmName.value !== kb.value?.name || lifecycleWorking.value) return
  lifecycleWorking.value = 'archive'
  error.value = ''
  try {
    await post('/api/v1/knowledge-bases/archive', { knowledgeBaseId: knowledgeBaseId.value })
    await session.loadNavigation()
    await router.replace(`/app/w/${kb.value?.workspaceId}`)
  } catch (value) {
    error.value = messageOf(value)
  } finally { lifecycleWorking.value = '' }
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
  <div class="page-shell kb-settings-page">
    <header class="page-heading">
      <div>
        <v-btn :to="`/app/kb/${knowledgeBaseId}`" variant="text" prepend-icon="mdi-arrow-left" class="mb-2">返回知识库</v-btn>
        <h1>{{ kb?.name }} · 设置</h1>
        <p>管理基础信息、外观、成员、分享访问、归属和生命周期。</p>
      </div>
    </header>
    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-4" @click:close="error=''">{{ error }}</v-alert>
    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-3" />
    <v-tabs v-model="tab" color="primary" show-arrows class="mb-5">
      <v-tab value="general">基础</v-tab><v-tab value="appearance">外观与阅读</v-tab><v-tab value="members">成员</v-tab>
      <v-tab value="sharing">分享与访问</v-tab><v-tab value="ownership">归属</v-tab><v-tab value="danger">高级</v-tab>
    </v-tabs>

    <v-card v-if="tab==='general'" class="section-card pa-6" rounded="xl">
      <div class="surface-grid">
        <v-text-field v-model="form.name" label="名称" maxlength="160" counter />
        <v-text-field v-model="form.slug" label="访问路径" prefix="/" hint="可使用中文、字母、数字和连字符" persistent-hint />
        <v-text-field v-model="form.icon" label="图标" hint="可填写 Emoji 或图片地址" persistent-hint />
        <v-select v-model="form.visibility" label="可见范围" :items="visibilityItems" />
        <v-select v-model="form.publishMode" label="发布方式" :items="publishModeItems" />
        <v-select v-model="form.homepagePageId" label="知识库首页" :items="pages" item-title="title" item-value="id" clearable placeholder="使用默认封面" />
      </div>
      <v-textarea v-model="form.description" label="知识库介绍" maxlength="8000" rows="4" auto-grow class="mt-4" />
      <v-switch v-model="form.allowPublicIndex" color="primary" inset label="允许搜索引擎收录" :disabled="form.visibility!=='PUBLIC'" hint="仅在公开访问时生效；关闭后公开地址仍可访问，但搜索引擎会收到 noindex。" persistent-hint class="mb-5" />
      <v-btn color="primary" :loading="saving" :disabled="!form.name.trim()||!form.slug.trim()" @click="save()">保存基础信息</v-btn>
    </v-card>

    <v-card v-else-if="tab==='appearance'" class="section-card appearance-card pa-6" rounded="xl">
      <div class="appearance-layout">
        <section class="appearance-form">
          <div class="section-title">
            <v-avatar color="primary" variant="tonal"><v-icon>mdi-palette-outline</v-icon></v-avatar>
            <div><h2>外观与阅读体验</h2><p>这些设置会应用到公开阅读页和受控分享页。</p></div>
          </div>
          <v-alert v-for="warning in configWarnings" :key="warning" type="warning" variant="tonal" density="comfortable" class="mt-4">{{ warning }}</v-alert>

          <div class="config-section">
            <h3>主题</h3><p class="muted">选择与内容风格匹配的阅读主题。</p>
            <v-item-group v-model="appearance.theme" mandatory class="theme-grid">
              <v-item v-for="item in themeItems" :key="item.value" v-slot="{ isSelected, toggle }" :value="item.value">
                <v-card :color="isSelected ? 'primary' : undefined" :variant="isSelected ? 'tonal' : 'outlined'" class="theme-option pa-4" rounded="lg" @click="toggle">
                  <v-icon :color="isSelected ? 'primary' : undefined">{{ item.icon }}</v-icon><strong>{{ item.title }}</strong><small>{{ item.subtitle }}</small>
                </v-card>
              </v-item>
            </v-item-group>
            <v-text-field v-model="appearance.coverUrl" label="封面图片地址" placeholder="https://example.com/cover.jpg" prepend-inner-icon="mdi-image-outline" :error-messages="coverError ? [coverError] : []" clearable hint="仅支持不含账号凭据的 HTTPS 地址" persistent-hint class="mt-5" />
            <div class="color-grid mt-3"><v-text-field v-model="appearance.backgroundColor" type="color" label="页面背景色" /><v-text-field v-model="appearance.accentColor" type="color" label="品牌强调色" /></div>
            <v-select v-model="appearance.contentWidth" label="正文宽度" :items="widthItems" class="mt-1" />
          </div>

          <v-divider />
          <div class="config-section">
            <div class="setting-heading"><div><h3>阅读水印</h3><p class="muted">在公开阅读和受控分享内容上显示。</p></div><v-switch v-model="watermark.enabled" color="primary" inset hide-details aria-label="启用阅读水印" /></div>
            <template v-if="watermark.enabled">
              <v-text-field v-model="watermark.text" label="水印文字" maxlength="120" counter :error-messages="watermarkTextError ? [watermarkTextError] : []" hint="可使用 {{email}}，阅读时会替换为当前账号邮箱" persistent-hint />
              <v-select v-model="watermark.position" label="显示位置" :items="watermarkPositionItems" class="mt-3" />
              <div class="slider-label"><span>透明度</span><strong>{{ Math.round(watermark.opacity * 100) }}%</strong></div>
              <v-slider v-model="watermark.opacity" :min="0.05" :max="0.4" :step="0.01" color="primary" hide-details />
            </template>
            <v-alert v-else type="info" variant="tonal" density="compact">水印当前关闭。已有水印内容会保留，重新开启即可使用。</v-alert>
          </div>

          <v-divider />
          <div class="config-section">
            <h3>目录显示</h3><p class="muted">控制读者首次打开知识库时看到的目录信息。</p>
            <div class="slider-label"><span>默认展开层级</span><strong>{{ catalog.defaultExpandDepth }} 层</strong></div>
            <v-slider v-model="catalog.defaultExpandDepth" :min="1" :max="6" :step="1" color="primary" thumb-label hide-details />
            <v-switch v-model="catalog.showPath" color="primary" inset label="显示文稿访问路径" hide-details class="mt-4" />
            <v-switch v-model="catalog.showUpdatedAt" color="primary" inset label="显示最近更新时间" hide-details class="mt-2" />
          </div>
          <v-alert type="info" variant="tonal" density="comfortable" class="mb-5">系统会保留现有配置中的扩展字段，可视化编辑不会清空其他兼容设置。</v-alert>
          <v-btn color="primary" prepend-icon="mdi-content-save-outline" :loading="saving" :disabled="appearanceInvalid" @click="saveAppearance">保存外观与阅读设置</v-btn>
        </section>

        <aside class="preview-column">
          <div class="preview-sticky">
            <div class="preview-heading"><span>即时预览</span><v-chip size="small" variant="tonal">公开阅读页</v-chip></div>
            <div class="reader-preview" :class="`theme-${appearance.theme.toLowerCase()}`" :style="previewStyle">
              <div class="preview-document" :style="{ maxWidth: previewWidth }">
                <span class="preview-icon">{{ form.icon || '📘' }}</span><small>知识库</small>
                <h2>{{ form.name || kb?.name || '知识库名称' }}</h2><p>{{ form.description || '在这里持续沉淀和分享团队知识。' }}</p>
                <div class="preview-rule" /><h3>开始阅读</h3><p>这是正文排版和强调色的预览。真实页面会显示你的文稿内容。</p><a>查看下一篇文稿 →</a>
                <span v-if="watermark.enabled" class="preview-watermark" :class="`position-${watermark.position.toLowerCase()}`" :style="{ opacity: watermark.opacity }">{{ previewWatermark }}</span>
              </div>
            </div>
            <v-card variant="outlined" rounded="lg" class="catalog-preview pa-4 mt-4">
              <div class="d-flex align-center mb-3"><v-icon class="mr-2">mdi-file-tree-outline</v-icon><strong>目录预览</strong><v-spacer /><v-chip size="x-small">展开 {{ catalog.defaultExpandDepth }} 层</v-chip></div>
              <div class="catalog-row"><v-icon size="18">mdi-chevron-down</v-icon><span>快速开始</span></div>
              <div class="catalog-row nested"><v-icon size="18">mdi-file-document-outline</v-icon><span><b>欢迎使用</b><small v-if="catalog.showPath">/welcome</small><small v-if="catalog.showUpdatedAt">今天更新</small></span></div>
              <div v-if="catalog.defaultExpandDepth > 1" class="catalog-row nested"><v-icon size="18">mdi-file-document-outline</v-icon><span><b>使用指南</b><small v-if="catalog.showPath">/guide</small><small v-if="catalog.showUpdatedAt">昨天更新</small></span></div>
            </v-card>
          </div>
        </aside>
      </div>
    </v-card>

    <v-card v-else-if="tab==='members'" class="section-card" rounded="xl">
      <div class="member-toolbar pa-5"><v-select v-model="candidate" :items="workspaceMembers.filter(person=>!members.some(m=>m.userId===person.userId))" item-title="email" item-value="userId" label="选择空间成员" hide-details /><v-select v-model="memberRole" :items="memberRoleItems" label="授予权限" hide-details max-width="180" /><v-btn color="primary" :disabled="!candidate" @click="addMember">添加成员</v-btn></div>
      <v-divider /><v-list lines="two" class="pa-3"><v-list-item v-for="member in members" :key="member.userId" prepend-icon="mdi-account-circle-outline" :title="member.displayName||member.email" :subtitle="member.email" rounded="lg"><template #append><v-chip>{{ memberRoleItems.find(item=>item.value===member.role)?.title }}</v-chip><v-btn icon="mdi-account-remove-outline" variant="text" color="error" @click="removeMember(member.userId)" /></template></v-list-item></v-list>
    </v-card>

    <KnowledgeBaseSharesPanel v-else-if="tab==='sharing'&&kb" :knowledge-base="kb" />

    <v-card v-else-if="tab==='ownership'" class="section-card ownership-card pa-6" rounded="xl">
      <div class="section-title mb-6"><v-avatar color="primary" variant="tonal"><v-icon>mdi-shield-account-outline</v-icon></v-avatar><div><h2>知识库归属</h2><p>归属决定由谁管理知识库，以及继承哪一层权限。</p></div></div>
      <div class="current-owner">
        <v-avatar color="primary" variant="tonal" size="52"><v-icon>{{ kb?.ownerType==='TEAM' ? 'mdi-account-group-outline' : kb?.ownerType==='PERSONAL' ? 'mdi-account-outline' : 'mdi-domain' }}</v-icon></v-avatar>
        <div><small>当前归属</small><h3>{{ currentOwnerTitle }}</h3><p>{{ currentOwnerDescription }}</p></div><v-chip color="success" variant="tonal" prepend-icon="mdi-check-circle-outline">当前</v-chip>
      </div>
      <v-divider class="my-6" />
      <template v-if="ownerTargets.length">
        <h3 class="mb-1">转移到</h3><p class="muted mb-4">这里只显示你当前具备管理权限的目标，不包含当前归属。</p>
        <v-select v-model="targetOwner" :items="ownerTargets" item-title="title" item-value="value" label="选择新归属" clearable>
          <template #item="{ props, item }"><v-list-item v-bind="props" :prepend-icon="item.raw.icon" :subtitle="item.raw.subtitle" /></template>
          <template #selection="{ item }"><div class="owner-selection"><v-icon class="mr-2">{{ item.raw.icon }}</v-icon><span>{{ item.raw.title }}</span></div></template>
        </v-select>
        <v-alert v-if="selectedOwnerTarget" type="warning" variant="tonal" density="comfortable" class="mb-4">转移后将改由“{{ selectedOwnerTarget.title }}”管理。文稿 ID、访问路径和公开链接不会改变。</v-alert>
        <v-btn color="primary" prepend-icon="mdi-swap-horizontal" :disabled="!selectedOwnerTarget" @click="confirmTransfer">确认转移归属</v-btn>
      </template>
      <v-alert v-else type="info" variant="tonal" icon="mdi-information-outline"><strong>当前没有可转移目标</strong><div class="mt-1">{{ noTransferReason }}</div></v-alert>
      <p class="muted text-body-2 mt-5 mb-0">归属转移需要同时具备当前知识库和目标位置的管理权限，服务端会在提交时再次校验。</p>
    </v-card>

    <v-card v-else class="section-card pa-6" rounded="xl">
      <h3>合并到其他知识库</h3><p class="muted">先预检页面、目录和路径冲突，再执行不可逆合并。</p>
      <div class="d-flex ga-3 mt-4"><v-select v-model="mergeTarget" :items="allKbs.filter(item=>item.id!==knowledgeBaseId)" item-title="name" item-value="id" label="目标知识库" /><v-btn variant="outlined" :loading="lifecycleWorking==='plan'" :disabled="!mergeTarget||Boolean(lifecycleWorking)" @click="planMerge">预检</v-btn></div>
      <v-alert v-if="mergePlan" type="warning" variant="tonal" class="my-4">将移动 {{ mergePlan.pageCount }} 篇内容和 {{ mergePlan.catalogNodeCount }} 个目录项；检测到 {{ mergePlan.pathConflicts.length }} 个路径冲突。</v-alert>
      <v-divider class="my-6" /><h3 class="text-error">危险操作</h3><v-text-field v-model="confirmName" :label="`输入 ${kb?.name} 确认`" class="mt-4" />
      <div class="d-flex ga-3"><v-btn v-if="mergePlan" color="error" :loading="lifecycleWorking==='merge'" :disabled="confirmName!==kb?.name||Boolean(lifecycleWorking)" @click="executeMerge">执行合并</v-btn><v-btn color="error" variant="outlined" :loading="lifecycleWorking==='archive'" :disabled="confirmName!==kb?.name||Boolean(lifecycleWorking)" @click="archive">归档知识库</v-btn></div>
    </v-card>

    <v-dialog v-model="transferDialog" max-width="540">
      <v-card rounded="xl"><v-card-title class="pa-6 pb-2">确认转移知识库归属？</v-card-title><v-card-text class="px-6"><p>“{{ kb?.name }}”将从“{{ currentOwnerTitle }}”转移到“{{ selectedOwnerTarget?.title }}”。</p><v-alert type="warning" variant="tonal" density="comfortable">转移会立即改变权限继承关系，但不会改变内容、文稿 ID 和公开链接。</v-alert></v-card-text><v-card-actions class="pa-6 pt-3"><v-spacer /><v-btn :disabled="transferring" @click="transferDialog=false">取消</v-btn><v-btn color="primary" :loading="transferring" @click="transfer">确认转移</v-btn></v-card-actions></v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.appearance-card { overflow: visible; }
.appearance-layout { display: grid; grid-template-columns: minmax(0, 1.12fr) minmax(360px, .88fr); gap: 34px; }
.appearance-form { min-width: 0; }
.section-title { display: flex; align-items: center; gap: 14px; }
.section-title h2 { margin: 0; font-size: 1.3rem; }
.section-title p { margin: 3px 0 0; color: #64748b; }
.config-section { padding: 26px 0; }
.config-section h3 { margin: 0 0 4px; }
.theme-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }
.theme-option { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; cursor: pointer; }
.theme-option .v-icon { grid-row: span 2; align-self: center; }
.theme-option small { color: #64748b; }
.color-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.setting-heading { display: flex; align-items: center; justify-content: space-between; gap: 20px; margin-bottom: 16px; }
.setting-heading p { margin: 4px 0 0; }
.slider-label { display: flex; justify-content: space-between; margin: 16px 0 5px; font-size: .92rem; }
.preview-sticky { position: sticky; top: 88px; }
.preview-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; color: #475569; font-size: .9rem; font-weight: 650; }
.reader-preview { min-height: 470px; display: flex; align-items: center; justify-content: center; overflow: hidden; border: 1px solid rgba(15,23,42,.1); border-radius: 18px; padding: 24px; background-position: center; background-size: cover; transition: background .2s ease; }
.preview-document { position: relative; width: 100%; min-height: 360px; overflow: hidden; border-radius: 14px; padding: 36px; background: rgba(255,255,255,.96); color: #1e293b; box-shadow: 0 18px 55px rgba(15,23,42,.16); transition: max-width .2s ease; }
.theme-minimal .preview-document { border-radius: 2px; box-shadow: none; }
.theme-magazine .preview-document h2 { font-family: Georgia, 'Noto Serif SC', serif; font-size: 2rem; letter-spacing: -.04em; }
.theme-dark .preview-document { background: rgba(17,24,39,.96); color: #e5e7eb; }
.preview-document small { color: var(--preview-accent); font-weight: 700; }
.preview-document h2 { margin: 8px 0; font-size: 1.75rem; }
.preview-document h3 { margin: 22px 0 8px; }
.preview-document p { color: #64748b; line-height: 1.7; }
.theme-dark .preview-document p { color: #94a3b8; }
.preview-document a { color: var(--preview-accent); font-weight: 650; }
.preview-icon { display: block; margin-bottom: 14px; font-size: 2rem; }
.preview-rule { height: 3px; width: 52px; margin-top: 24px; border-radius: 99px; background: var(--preview-accent); }
.preview-watermark { position: absolute; z-index: 0; color: var(--preview-accent); font-size: 12px; font-weight: 700; pointer-events: none; white-space: nowrap; }
.preview-watermark.position-center { inset: 50% auto auto 50%; transform: translate(-50%,-50%) rotate(-22deg); }
.preview-watermark.position-footer { inset: auto 18px 14px auto; }
.preview-watermark.position-tiled { inset: 48% auto auto 42%; transform: rotate(-22deg); text-shadow: -150px -120px currentColor, 150px -120px currentColor, -150px 120px currentColor, 150px 120px currentColor; }
.catalog-preview { background: rgba(248,250,252,.75); }
.catalog-row { display: flex; align-items: center; gap: 8px; min-height: 34px; color: #475569; }
.catalog-row.nested { padding-left: 25px; }
.catalog-row span { display: flex; align-items: center; gap: 8px; min-width: 0; }
.catalog-row small { color: #94a3b8; }
.member-toolbar { display: grid; grid-template-columns: minmax(240px, 1fr) 180px auto; align-items: center; gap: 12px; }
.current-owner { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: center; gap: 16px; border: 1px solid rgba(15,23,42,.09); border-radius: 16px; padding: 18px; background: #f8fafc; }
.current-owner small { color: #64748b; }
.current-owner h3 { margin: 2px 0 3px; }
.current-owner p { margin: 0; color: #64748b; }
.owner-selection { display: flex; align-items: center; }
@media (max-width: 1050px) { .appearance-layout { grid-template-columns: 1fr; } .preview-sticky { position: static; } }
@media (max-width: 700px) {
  .appearance-card { padding: 18px !important; }
  .theme-grid, .color-grid { grid-template-columns: 1fr; }
  .member-toolbar { grid-template-columns: 1fr; }
  .current-owner { grid-template-columns: auto 1fr; }
  .current-owner .v-chip { grid-column: 2; justify-self: start; }
  .catalog-row span { align-items: flex-start; flex-direction: column; gap: 0; }
}
</style>
