<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { QuickNote, QuickNotePage, QuickNoteTag } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

type NoteStatus = QuickNote['status']
type BatchOperation = 'ARCHIVE' | 'UNARCHIVE' | 'DELETE' | 'RESTORE' | 'ADD_TAG' | 'REMOVE_TAG'

const session = useSessionStore()
const ui = useUiStore()
const status = ref<NoteStatus>('ACTIVE')
const tagId = ref<string | null>(null)
const searchInput = ref('')
const appliedQuery = ref('')
const notes = ref<QuickNote[]>([])
const tags = ref<QuickNoteTag[]>([])
const nextOffset = ref(0)
const hasMore = ref(false)
const loading = ref(false)
const loadingMore = ref(false)
const working = ref(false)
const error = ref('')
const selectedIds = ref<string[]>([])
const capture = ref('')
const creating = ref(false)
const batchTagId = ref<string | null>(null)

const editorOpen = ref(false)
const editingNote = ref<QuickNote | null>(null)
const editBody = ref('')
const editTagIds = ref<string[]>([])
const savingEdit = ref(false)

const tagDialogOpen = ref(false)
const tagName = ref('')
const tagColor = ref('GRAY')
const editingTag = ref<QuickNoteTag | null>(null)
const tagBusy = ref(false)
const tagDeleteTarget = ref<QuickNoteTag | null>(null)

const noteDeleteTarget = ref<QuickNote | null>(null)
const batchDeleteOpen = ref(false)
let notesRequestVersion = 0

const workspaceId = computed(() => session.activeWorkspace?.id ?? '')
const allSelected = computed(() => notes.value.length > 0 && notes.value.every((note) => selectedIds.value.includes(note.id)))
const selectedCount = computed(() => selectedIds.value.length)

const statusOptions: Array<{ title: string; value: NoteStatus; icon: string }> = [
  { title: '活跃', value: 'ACTIVE', icon: 'mdi-note-text-outline' },
  { title: '已归档', value: 'ARCHIVED', icon: 'mdi-archive-outline' },
  { title: '已删除', value: 'DELETED', icon: 'mdi-delete-outline' },
]
const tagColors = [
  { title: '灰色', value: 'GRAY', color: '#64748b' },
  { title: '红色', value: 'RED', color: '#dc2626' },
  { title: '橙色', value: 'ORANGE', color: '#ea580c' },
  { title: '黄色', value: 'YELLOW', color: '#ca8a04' },
  { title: '绿色', value: 'GREEN', color: '#16a34a' },
  { title: '蓝色', value: 'BLUE', color: '#2563eb' },
  { title: '紫色', value: 'PURPLE', color: '#7c3aed' },
  { title: '粉色', value: 'PINK', color: '#db2777' },
]

onMounted(async () => {
  await Promise.all([loadTags(), loadNotes(true)])
})

watch([status, tagId], () => void loadNotes(true))
watch(workspaceId, (current, previous) => {
  if (current && current !== previous && !notes.value.length) void loadNotes(true)
})

async function loadNotes(reset = false) {
  const requestVersion = reset ? ++notesRequestVersion : notesRequestVersion
  if (reset) {
    loading.value = true
    selectedIds.value = []
  } else {
    if (loading.value || !hasMore.value || loadingMore.value) return
    loadingMore.value = true
  }
  error.value = ''
  const offset = reset ? 0 : nextOffset.value
  try {
    const page = await post<QuickNotePage>('/api/v1/quick-notes/page', {
      status: status.value,
      tagId: tagId.value,
      query: appliedQuery.value || null,
      limit: 30,
      offset,
    })
    if (requestVersion !== notesRequestVersion) return
    notes.value = reset ? page.items : deduplicate([...notes.value, ...page.items])
    nextOffset.value = page.nextOffset
    hasMore.value = page.hasMore
  } catch (value) {
    if (requestVersion === notesRequestVersion) error.value = messageOf(value)
  } finally {
    if (requestVersion === notesRequestVersion) {
      loading.value = false
      loadingMore.value = false
    }
  }
}

async function loadTags() {
  try {
    tags.value = await post<QuickNoteTag[]>('/api/v1/quick-notes/tags/list', {})
  } catch (value) {
    error.value = messageOf(value)
  }
}

function applySearch() {
  appliedQuery.value = searchInput.value.trim().slice(0, 200)
  void loadNotes(true)
}

function clearSearch() {
  searchInput.value = ''
  if (appliedQuery.value) {
    appliedQuery.value = ''
    void loadNotes(true)
  }
}

async function createNote() {
  const body = capture.value.trim()
  if (!body || !workspaceId.value) return
  creating.value = true
  error.value = ''
  try {
    await post<QuickNote>('/api/v1/quick-notes/create', {
      workspaceId: workspaceId.value,
      content: noteDocument(body),
      plainText: body,
      source: 'QUICK_NOTE_PAGE',
      clientRequestId: crypto.randomUUID(),
      tagIds: [],
    })
    capture.value = ''
    status.value = 'ACTIVE'
    await loadNotes(true)
    ui.notify('小记已保存')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    creating.value = false
  }
}

function openEditor(note: QuickNote) {
  editingNote.value = note
  editBody.value = note.plainText
  editTagIds.value = note.tags.map((tag) => tag.id)
  editorOpen.value = true
}

async function saveEditor() {
  const note = editingNote.value
  if (!note || !editBody.value.trim()) return
  savingEdit.value = true
  error.value = ''
  try {
    const saved = await post<QuickNote>('/api/v1/quick-notes/save', {
      quickNoteId: note.id,
      expectedRevision: note.revision,
      content: noteDocument(editBody.value),
      plainText: editBody.value,
      kind: 'COMMIT',
    })
    editingNote.value = saved
    const before = new Set(note.tags.map((tag) => tag.id))
    const after = new Set(editTagIds.value)
    const add = [...after].filter((id) => !before.has(id))
    const remove = [...before].filter((id) => !after.has(id))
    if (add.length) await post('/api/v1/quick-notes/batch', { quickNoteIds: [note.id], operation: 'ADD_TAG', tagIds: add })
    if (remove.length) await post('/api/v1/quick-notes/batch', { quickNoteIds: [note.id], operation: 'REMOVE_TAG', tagIds: remove })
    editorOpen.value = false
    editingNote.value = null
    await loadNotes(true)
    ui.notify('小记已更新')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    savingEdit.value = false
  }
}

async function setArchived(note: QuickNote) {
  await runSingle('/api/v1/quick-notes/archive', { quickNoteId: note.id, archived: note.status !== 'ARCHIVED' }, note.status === 'ARCHIVED' ? '已取消归档' : '已归档')
}

async function restoreNote(note: QuickNote) {
  await runSingle('/api/v1/quick-notes/restore', { quickNoteId: note.id }, '小记已恢复')
}

async function deleteNote() {
  const note = noteDeleteTarget.value
  if (!note) return
  await runSingle('/api/v1/quick-notes/delete', { quickNoteId: note.id }, '小记已移入回收站')
  noteDeleteTarget.value = null
}

async function runSingle(path: string, body: unknown, success: string) {
  working.value = true
  error.value = ''
  try {
    await post(path, body)
    await loadNotes(true)
    ui.notify(success)
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

async function runBatch(operation: BatchOperation, tagIds: string[] = []) {
  if (!selectedIds.value.length) return
  working.value = true
  error.value = ''
  try {
    await post('/api/v1/quick-notes/batch', { quickNoteIds: selectedIds.value, operation, tagIds })
    selectedIds.value = []
    batchDeleteOpen.value = false
    await loadNotes(true)
    ui.notify('批量操作已完成')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    working.value = false
  }
}

function runBatchTag(operation: 'ADD_TAG' | 'REMOVE_TAG') {
  if (!batchTagId.value) return
  void runBatch(operation, [batchTagId.value])
}

function toggleSelected(id: string) {
  selectedIds.value = selectedIds.value.includes(id)
    ? selectedIds.value.filter((value) => value !== id)
    : [...selectedIds.value, id]
}

function toggleAll() {
  selectedIds.value = allSelected.value ? [] : notes.value.map((note) => note.id)
}

function openCreateTag() {
  editingTag.value = null
  tagName.value = ''
  tagColor.value = 'GRAY'
  tagDialogOpen.value = true
}

function openEditTag(tag: QuickNoteTag) {
  editingTag.value = tag
  tagName.value = tag.name
  tagColor.value = tag.color
  tagDialogOpen.value = true
}

async function saveTag() {
  const name = tagName.value.trim()
  if (!name) return
  tagBusy.value = true
  error.value = ''
  try {
    if (editingTag.value) {
      await post('/api/v1/quick-notes/tags/update', { tagId: editingTag.value.id, name, color: tagColor.value })
    } else {
      await post('/api/v1/quick-notes/tags/create', { name, color: tagColor.value })
    }
    tagDialogOpen.value = false
    await Promise.all([loadTags(), loadNotes(true)])
    ui.notify(editingTag.value ? '标签已更新' : '标签已创建')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    tagBusy.value = false
  }
}

async function deleteTag() {
  const tag = tagDeleteTarget.value
  if (!tag) return
  tagBusy.value = true
  error.value = ''
  try {
    await post('/api/v1/quick-notes/tags/delete', { tagId: tag.id })
    if (tagId.value === tag.id) tagId.value = null
    tagDeleteTarget.value = null
    await Promise.all([loadTags(), loadNotes(true)])
    ui.notify('标签已删除')
  } catch (value) {
    error.value = messageOf(value)
  } finally {
    tagBusy.value = false
  }
}

function noteDocument(text: string) {
  return {
    type: 'doc',
    content: text.split(/\r?\n/).map((line) => ({
      type: 'paragraph',
      content: line ? [{ type: 'text', text: line }] : [],
    })),
  }
}

function deduplicate(values: QuickNote[]) {
  return [...new Map(values.map((value) => [value.id, value])).values()]
}

function relativeTime(value: string) {
  const date = new Date(value)
  const minutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60_000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1_440) return `${Math.floor(minutes / 60)} 小时前`
  return date.toLocaleDateString('zh-CN')
}

function colorOf(value: string) {
  return tagColors.find((item) => item.value === value)?.color ?? '#64748b'
}
</script>

<template>
  <div class="page-shell quick-notes-page">
    <header class="page-heading">
      <div><h1>小记</h1><p>快速记录灵感，并通过状态、搜索与标签保持井然有序。</p></div>
      <v-btn prepend-icon="mdi-tag-multiple-outline" variant="tonal" @click="openCreateTag">新建标签</v-btn>
    </header>

    <v-card class="section-card capture-card pa-5 mb-5">
      <div class="d-flex align-start ga-3">
        <v-avatar color="primary" variant="tonal"><v-icon>mdi-lightning-bolt-outline</v-icon></v-avatar>
        <v-textarea v-model="capture" auto-grow rows="2" max-rows="8" variant="outlined" hide-details placeholder="写下想法、任务或链接…" @keydown.ctrl.enter.prevent="createNote" @keydown.meta.enter.prevent="createNote" />
        <v-btn color="primary" :loading="creating" :disabled="!capture.trim() || !workspaceId" @click="createNote">记一笔</v-btn>
      </div>
      <div class="text-caption text-medium-emphasis mt-2 ml-13">Ctrl / Cmd + Enter 保存到当前工作区</div>
    </v-card>

    <v-alert v-if="error" type="error" variant="tonal" closable class="mb-5" @click:close="error = ''">{{ error }}</v-alert>

    <v-card class="section-card mb-4">
      <div class="notes-toolbar pa-4">
        <v-btn-toggle v-model="status" mandatory color="primary" variant="outlined" divided>
          <v-btn v-for="item in statusOptions" :key="item.value" :value="item.value" :prepend-icon="item.icon">{{ item.title }}</v-btn>
        </v-btn-toggle>
        <v-text-field v-model="searchInput" prepend-inner-icon="mdi-magnify" label="搜索小记" density="compact" variant="outlined" hide-details clearable @click:clear="clearSearch" @keyup.enter="applySearch" />
        <v-select v-model="tagId" :items="tags" item-title="name" item-value="id" label="标签" density="compact" variant="outlined" hide-details clearable />
        <v-btn variant="text" icon="mdi-refresh" :loading="loading" aria-label="刷新" @click="loadNotes(true)" />
      </div>
      <v-divider />
      <div class="tag-row pa-3 px-4">
        <v-chip :variant="tagId === null ? 'flat' : 'tonal'" :color="tagId === null ? 'primary' : undefined" @click="tagId = null">全部标签</v-chip>
        <span v-for="tag in tags" :key="tag.id" class="tag-filter-item">
          <v-chip :variant="tagId === tag.id ? 'flat' : 'tonal'" :color="tagId === tag.id ? 'primary' : undefined" @click="tagId = tag.id">
            <span class="tag-dot" :style="{ backgroundColor: colorOf(tag.color) }" />{{ tag.name }}
          </v-chip>
          <v-menu location="bottom end">
            <template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" size="x-small" variant="text" :aria-label="`管理标签 ${tag.name}`" /></template>
            <v-list density="compact"><v-list-item title="编辑标签" prepend-icon="mdi-pencil-outline" @click="openEditTag(tag)" /><v-list-item title="删除标签" prepend-icon="mdi-delete-outline" base-color="error" @click="tagDeleteTarget = tag" /></v-list>
          </v-menu>
        </span>
      </div>
    </v-card>

    <v-card v-if="selectedCount" class="section-card batch-bar pa-3 mb-4" color="primary" variant="tonal">
      <strong>已选择 {{ selectedCount }} 条</strong>
      <v-btn v-if="status === 'ACTIVE'" size="small" variant="text" prepend-icon="mdi-archive-outline" :loading="working" @click="runBatch('ARCHIVE')">归档</v-btn>
      <v-btn v-if="status === 'ARCHIVED'" size="small" variant="text" prepend-icon="mdi-archive-arrow-up-outline" :loading="working" @click="runBatch('UNARCHIVE')">取消归档</v-btn>
      <v-btn v-if="status !== 'DELETED'" size="small" variant="text" prepend-icon="mdi-delete-outline" @click="batchDeleteOpen = true">删除</v-btn>
      <v-btn v-else size="small" variant="text" prepend-icon="mdi-restore" :loading="working" @click="runBatch('RESTORE')">恢复</v-btn>
      <v-select v-model="batchTagId" :items="tags" item-title="name" item-value="id" label="批量标签" density="compact" variant="outlined" hide-details class="batch-tag-select" />
      <v-btn size="small" variant="text" :disabled="!batchTagId" @click="runBatchTag('ADD_TAG')">添加</v-btn>
      <v-btn size="small" variant="text" :disabled="!batchTagId" @click="runBatchTag('REMOVE_TAG')">移除</v-btn>
      <v-spacer />
      <v-btn size="small" variant="text" @click="selectedIds = []">取消选择</v-btn>
    </v-card>

    <div v-if="notes.length" class="d-flex align-center mb-3 px-1">
      <v-checkbox-btn :model-value="allSelected" label="选择当前已加载的小记" @update:model-value="toggleAll" />
      <v-spacer /><span class="text-caption text-medium-emphasis">已加载 {{ notes.length }} 条{{ hasMore ? '+' : '' }}</span>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />
    <div v-if="notes.length" class="notes-grid">
      <v-card v-for="note in notes" :key="note.id" class="section-card note-card" :class="{ selected: selectedIds.includes(note.id) }">
        <v-card-text>
          <div class="d-flex align-center mb-3">
            <v-checkbox-btn :model-value="selectedIds.includes(note.id)" :aria-label="`选择小记 ${note.id}`" @update:model-value="toggleSelected(note.id)" />
            <span class="text-caption text-medium-emphasis">{{ relativeTime(note.updatedAt) }}</span>
            <v-spacer />
            <v-menu><template #activator="{ props }"><v-btn v-bind="props" icon="mdi-dots-horizontal" variant="text" size="small" /></template><v-list density="compact">
              <v-list-item v-if="note.status !== 'DELETED'" title="编辑" prepend-icon="mdi-pencil-outline" @click="openEditor(note)" />
              <v-list-item v-if="note.status !== 'DELETED'" :title="note.status === 'ARCHIVED' ? '取消归档' : '归档'" :prepend-icon="note.status === 'ARCHIVED' ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'" @click="setArchived(note)" />
              <v-list-item v-if="note.status !== 'DELETED'" title="移入回收站" prepend-icon="mdi-delete-outline" base-color="error" @click="noteDeleteTarget = note" />
              <v-list-item v-else title="恢复" prepend-icon="mdi-restore" @click="restoreNote(note)" />
            </v-list></v-menu>
          </div>
          <button class="note-content" :disabled="note.status === 'DELETED'" @click="openEditor(note)">{{ note.plainText || '空白小记' }}</button>
          <div class="note-tags mt-4"><v-chip v-for="tag in note.tags" :key="tag.id" size="small" variant="tonal"><span class="tag-dot" :style="{ backgroundColor: colorOf(tag.color) }" />{{ tag.name }}</v-chip></div>
        </v-card-text>
        <v-divider />
        <v-card-actions class="px-4"><span class="text-caption text-medium-emphasis">版本 {{ note.revision }}</span><v-spacer /><v-btn v-if="note.status !== 'DELETED'" size="small" variant="text" @click="openEditor(note)">编辑</v-btn><v-btn v-else size="small" variant="text" prepend-icon="mdi-restore" @click="restoreNote(note)">恢复</v-btn></v-card-actions>
      </v-card>
    </div>

    <v-card v-else-if="!loading" class="section-card empty-state"><div><v-icon size="48">mdi-note-off-outline</v-icon><h3>{{ appliedQuery ? '没有匹配的小记' : status === 'ACTIVE' ? '还没有小记' : status === 'ARCHIVED' ? '归档是空的' : '小记回收站是空的' }}</h3><p>你记录的内容会显示在这里。</p></div></v-card>
    <div v-if="hasMore" class="text-center mt-5"><v-btn variant="tonal" :loading="loadingMore" @click="loadNotes(false)">加载更多</v-btn></div>

    <v-dialog v-model="editorOpen" max-width="760" persistent>
      <v-card><v-card-title class="d-flex align-center px-6 pt-5"><span>编辑小记</span><v-spacer /><v-chip size="small" variant="tonal">版本 {{ editingNote?.revision }}</v-chip></v-card-title><v-card-text class="px-6">
        <v-textarea v-model="editBody" label="正文" variant="outlined" auto-grow rows="10" max-rows="20" autofocus />
        <v-select v-model="editTagIds" :items="tags" item-title="name" item-value="id" label="标签" variant="outlined" multiple chips closable-chips />
        <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" :disabled="savingEdit" @click="editorOpen = false">取消</v-btn><v-btn color="primary" :loading="savingEdit" :disabled="!editBody.trim()" @click="saveEditor">保存</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog v-model="tagDialogOpen" max-width="480">
      <v-card><v-card-title class="px-6 pt-5">{{ editingTag ? '编辑标签' : '新建标签' }}</v-card-title><v-card-text class="px-6"><v-text-field v-model="tagName" label="标签名称" maxlength="80" counter variant="outlined" autofocus /><v-select v-model="tagColor" :items="tagColors" item-title="title" item-value="value" label="颜色" variant="outlined"><template #item="{ props, item }"><v-list-item v-bind="props"><template #prepend><span class="color-preview" :style="{ backgroundColor: item.raw.color }" /></template></v-list-item></template></v-select></v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="tagDialogOpen = false">取消</v-btn><v-btn color="primary" :loading="tagBusy" :disabled="!tagName.trim()" @click="saveTag">保存</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(noteDeleteTarget)" max-width="480" @update:model-value="value => { if (!value) noteDeleteTarget = null }"><v-card><v-card-title class="px-6 pt-5">删除这条小记？</v-card-title><v-card-text class="px-6">小记会进入小记回收站，可随时恢复。</v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="noteDeleteTarget = null">取消</v-btn><v-btn color="error" :loading="working" @click="deleteNote">移入回收站</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog v-model="batchDeleteOpen" max-width="480"><v-card><v-card-title class="px-6 pt-5">删除 {{ selectedCount }} 条小记？</v-card-title><v-card-text class="px-6">所选小记会进入小记回收站，可从“已删除”中批量恢复。</v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="batchDeleteOpen = false">取消</v-btn><v-btn color="error" :loading="working" @click="runBatch('DELETE')">确认删除</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(tagDeleteTarget)" max-width="480" @update:model-value="value => { if (!value) tagDeleteTarget = null }"><v-card><v-card-title class="px-6 pt-5">删除标签“{{ tagDeleteTarget?.name }}”？</v-card-title><v-card-text class="px-6">标签会从所有小记中移除，小记本身不会删除。</v-card-text><v-card-actions class="px-6 pb-5"><v-spacer /><v-btn variant="text" @click="tagDeleteTarget = null">取消</v-btn><v-btn color="error" :loading="tagBusy" @click="deleteTag">删除标签</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.quick-notes-page { max-width: 1320px; }
.capture-card { background: linear-gradient(135deg, rgba(var(--v-theme-primary), .07), rgba(var(--v-theme-surface), 1) 55%); }
.notes-toolbar { display: grid; grid-template-columns: auto minmax(220px, 1fr) minmax(180px, 260px) auto; gap: 12px; align-items: center; }
.tag-row, .note-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
.tag-filter-item { display: inline-flex; align-items: center; gap: 1px; }
.tag-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 7px; }
.batch-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; }
.batch-tag-select { flex: 0 1 220px; }
.notes-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }
.note-card { min-height: 235px; transition: border-color .15s ease, box-shadow .15s ease; }
.note-card.selected { border-color: rgb(var(--v-theme-primary)); box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), .25); }
.note-content { width: 100%; min-height: 90px; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; white-space: pre-wrap; line-height: 1.65; cursor: pointer; font: inherit; overflow-wrap: anywhere; }
.note-content:disabled { cursor: default; opacity: .72; }
.color-preview { width: 14px; height: 14px; border-radius: 50%; margin-right: 12px; }
@media (max-width: 900px) { .notes-toolbar { grid-template-columns: 1fr; } .notes-toolbar :deep(.v-btn-toggle) { overflow-x: auto; } }
</style>
