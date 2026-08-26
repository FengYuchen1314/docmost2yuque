<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import type { QuickNote, QuickNotePage, QuickNoteTag } from '../../../src/types'
import { messageOf, post } from '../../services/api'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'
import { createUuid } from '../../utils/uuid'

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
      clientRequestId: createUuid(),
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
  <div class="quick-notes-page">
    <header class="notes-header"><div><h1>小记</h1><p>随手记录，稍后再整理。</p></div><v-btn icon="mdi-refresh" size="small" variant="text" :loading="loading" aria-label="刷新小记" @click="loadNotes(true)" /></header>

    <div class="notes-shell">
      <aside class="notes-sidebar">
        <nav class="status-nav" aria-label="小记状态">
          <button v-for="item in statusOptions" :key="item.value" type="button" :class="{ active: status === item.value }" @click="status = item.value"><v-icon size="18">{{ item.icon }}</v-icon><span>{{ item.value === 'DELETED' ? '回收站' : item.title }}</span></button>
        </nav>
        <div class="sidebar-divider" />
        <div class="tags-heading"><span>标签</span><button type="button" aria-label="新建标签" title="新建标签" @click="openCreateTag"><v-icon size="17">mdi-plus</v-icon></button></div>
        <div class="tag-nav">
          <button type="button" :class="{ active: tagId === null }" @click="tagId = null"><v-icon size="16">mdi-tag-multiple-outline</v-icon><span>全部标签</span></button>
          <div v-for="tag in tags" :key="tag.id" class="tag-nav-row" :class="{ active: tagId === tag.id }">
            <button type="button" @click="tagId = tag.id"><span class="tag-dot" :style="{ backgroundColor: colorOf(tag.color) }" /><span>{{ tag.name }}</span></button>
            <v-menu location="bottom end"><template #activator="{ props }"><button v-bind="props" type="button" class="tag-more" :aria-label="`管理标签 ${tag.name}`"><v-icon size="15">mdi-dots-horizontal</v-icon></button></template><v-list density="compact" min-width="140"><v-list-item title="编辑标签" prepend-icon="mdi-pencil-outline" @click="openEditTag(tag)" /><v-list-item title="删除标签" prepend-icon="mdi-delete-outline" base-color="error" @click="tagDeleteTarget = tag" /></v-list></v-menu>
          </div>
          <p v-if="!tags.length" class="no-tags">还没有标签</p>
        </div>
      </aside>

      <main class="notes-main">
        <section class="capture-panel">
          <textarea v-model="capture" rows="3" maxlength="20000" placeholder="写下此刻的想法…" aria-label="快速记录小记" @keydown.ctrl.enter.prevent="createNote" @keydown.meta.enter.prevent="createNote" />
          <footer><span><v-icon size="15">mdi-lightning-bolt-outline</v-icon> Ctrl / Cmd + Enter 保存</span><v-btn color="primary" size="small" :loading="creating" :disabled="!capture.trim() || !workspaceId" @click="createNote">记一笔</v-btn></footer>
        </section>

        <v-alert v-if="error" type="error" variant="tonal" density="compact" closable class="notes-error" @click:close="error = ''">{{ error }}</v-alert>

        <div class="notes-toolbar">
          <form class="notes-search" role="search" @submit.prevent="applySearch"><v-icon size="17">mdi-magnify</v-icon><input v-model="searchInput" aria-label="搜索小记" placeholder="搜索小记"><button v-if="searchInput" type="button" aria-label="清除搜索" @click="clearSearch"><v-icon size="15">mdi-close</v-icon></button></form>
          <button v-if="notes.length" type="button" class="select-all" @click="toggleAll"><v-icon size="17">{{ allSelected ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}</v-icon><span>{{ allSelected ? '取消全选' : '选择全部' }}</span></button>
          <span class="note-count">{{ notes.length }}{{ hasMore ? '+' : '' }} 条</span>
        </div>

        <div v-if="selectedCount" class="batch-bar">
          <strong>已选 {{ selectedCount }} 条</strong>
          <v-btn v-if="status === 'ACTIVE'" size="small" variant="text" prepend-icon="mdi-archive-outline" :loading="working" @click="runBatch('ARCHIVE')">归档</v-btn>
          <v-btn v-if="status === 'ARCHIVED'" size="small" variant="text" prepend-icon="mdi-archive-arrow-up-outline" :loading="working" @click="runBatch('UNARCHIVE')">取消归档</v-btn>
          <v-btn v-if="status !== 'DELETED'" size="small" variant="text" prepend-icon="mdi-delete-outline" @click="batchDeleteOpen = true">删除</v-btn>
          <v-btn v-else size="small" variant="text" prepend-icon="mdi-restore" :loading="working" @click="runBatch('RESTORE')">恢复</v-btn>
          <v-select v-model="batchTagId" :items="tags" item-title="name" item-value="id" placeholder="选择标签" density="compact" variant="outlined" hide-details class="batch-tag-select" />
          <v-btn size="small" variant="text" :disabled="!batchTagId" @click="runBatchTag('ADD_TAG')">添加标签</v-btn>
          <v-btn size="small" variant="text" :disabled="!batchTagId" @click="runBatchTag('REMOVE_TAG')">移除标签</v-btn>
          <button type="button" class="batch-cancel" @click="selectedIds = []">取消</button>
        </div>

        <v-progress-linear v-if="loading" indeterminate color="primary" height="2" class="notes-progress" />
        <div v-if="notes.length" class="notes-flow">
          <article v-for="note in notes" :key="note.id" class="note-card" :class="{ selected: selectedIds.includes(note.id), deleted: note.status === 'DELETED' }">
            <header class="note-card-header">
              <button type="button" class="note-check" :class="{ checked: selectedIds.includes(note.id) }" :aria-label="`选择小记 ${note.id}`" @click="toggleSelected(note.id)"><v-icon size="17">{{ selectedIds.includes(note.id) ? 'mdi-checkbox-marked' : 'mdi-checkbox-blank-outline' }}</v-icon></button>
              <span>{{ relativeTime(note.updatedAt) }}</span>
              <v-menu location="bottom end">
                <template #activator="{ props }"><button v-bind="props" type="button" class="note-more" :aria-label="`小记操作 ${note.id}`"><v-icon size="17">mdi-dots-horizontal</v-icon></button></template>
                <v-list density="compact" min-width="156">
                  <v-list-item v-if="note.status !== 'DELETED'" title="编辑" prepend-icon="mdi-pencil-outline" @click="openEditor(note)" />
                  <v-list-item v-if="note.status !== 'DELETED'" :title="note.status === 'ARCHIVED' ? '取消归档' : '归档'" :prepend-icon="note.status === 'ARCHIVED' ? 'mdi-archive-arrow-up-outline' : 'mdi-archive-outline'" @click="setArchived(note)" />
                  <v-list-item v-if="note.status !== 'DELETED'" title="移入回收站" prepend-icon="mdi-delete-outline" base-color="error" @click="noteDeleteTarget = note" />
                  <v-list-item v-else title="恢复" prepend-icon="mdi-restore" @click="restoreNote(note)" />
                </v-list>
              </v-menu>
            </header>
            <button class="note-content" :disabled="note.status === 'DELETED'" @click="openEditor(note)">{{ note.plainText || '空白小记' }}</button>
            <div v-if="note.tags.length" class="note-tags"><span v-for="tag in note.tags" :key="tag.id"><i :style="{ backgroundColor: colorOf(tag.color) }" />{{ tag.name }}</span></div>
            <footer class="note-footer"><span>v{{ note.revision }}</span><button v-if="note.status !== 'DELETED'" type="button" @click="openEditor(note)">编辑</button><button v-else type="button" @click="restoreNote(note)"><v-icon size="14">mdi-restore</v-icon>恢复</button></footer>
          </article>
        </div>

        <div v-else-if="!loading" class="notes-empty">
          <v-icon size="38">mdi-note-text-outline</v-icon>
          <h3>{{ appliedQuery ? '没有匹配的小记' : status === 'ACTIVE' ? '还没有小记' : status === 'ARCHIVED' ? '归档是空的' : '小记回收站是空的' }}</h3>
          <p>{{ appliedQuery ? '换个关键词再试试。' : status === 'ACTIVE' ? '从上面的输入框记下第一条想法。' : '这里暂时没有内容。' }}</p>
        </div>
        <div v-if="hasMore" class="load-more"><v-btn variant="text" size="small" :loading="loadingMore" @click="loadNotes(false)">加载更多</v-btn></div>
      </main>
    </div>

    <v-navigation-drawer v-model="editorOpen" location="right" temporary width="480" class="note-editor-drawer">
      <div class="drawer-header"><div><strong>编辑小记</strong><span>版本 {{ editingNote?.revision }}</span></div><v-btn icon="mdi-close" variant="text" size="small" aria-label="关闭编辑器" :disabled="savingEdit" @click="editorOpen = false" /></div>
      <div class="drawer-body">
        <textarea v-model="editBody" rows="14" maxlength="20000" placeholder="继续记录…" aria-label="小记正文" />
        <v-select v-model="editTagIds" :items="tags" item-title="name" item-value="id" label="标签" density="comfortable" variant="outlined" multiple chips closable-chips hide-details />
        <v-alert v-if="error" type="error" variant="tonal" density="compact">{{ error }}</v-alert>
      </div>
      <div class="drawer-actions"><v-btn variant="text" :disabled="savingEdit" @click="editorOpen = false">取消</v-btn><v-btn color="primary" :loading="savingEdit" :disabled="!editBody.trim()" @click="saveEditor">保存</v-btn></div>
    </v-navigation-drawer>

    <v-dialog v-model="tagDialogOpen" max-width="420">
      <v-card rounded="lg"><v-card-title class="dialog-title">{{ editingTag ? '编辑标签' : '新建标签' }}</v-card-title><v-card-text class="dialog-body"><v-text-field v-model="tagName" label="标签名称" maxlength="80" counter density="comfortable" variant="outlined" autofocus /><v-select v-model="tagColor" :items="tagColors" item-title="title" item-value="value" label="颜色" density="comfortable" variant="outlined" hide-details><template #item="{ props, item }"><v-list-item v-bind="props"><template #prepend><span class="color-preview" :style="{ backgroundColor: item.raw.color }" /></template></v-list-item></template></v-select></v-card-text><v-card-actions class="dialog-actions"><v-spacer /><v-btn variant="text" @click="tagDialogOpen = false">取消</v-btn><v-btn color="primary" :loading="tagBusy" :disabled="!tagName.trim()" @click="saveTag">保存</v-btn></v-card-actions></v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(noteDeleteTarget)" max-width="420" @update:model-value="value => { if (!value) noteDeleteTarget = null }"><v-card rounded="lg"><v-card-title class="dialog-title">删除这条小记？</v-card-title><v-card-text class="dialog-body">小记会进入小记回收站，可随时恢复。</v-card-text><v-card-actions class="dialog-actions"><v-spacer /><v-btn variant="text" @click="noteDeleteTarget = null">取消</v-btn><v-btn color="error" :loading="working" @click="deleteNote">移入回收站</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog v-model="batchDeleteOpen" max-width="420"><v-card rounded="lg"><v-card-title class="dialog-title">删除 {{ selectedCount }} 条小记？</v-card-title><v-card-text class="dialog-body">所选小记会进入小记回收站，可从“回收站”中批量恢复。</v-card-text><v-card-actions class="dialog-actions"><v-spacer /><v-btn variant="text" @click="batchDeleteOpen = false">取消</v-btn><v-btn color="error" :loading="working" @click="runBatch('DELETE')">确认删除</v-btn></v-card-actions></v-card></v-dialog>
    <v-dialog :model-value="Boolean(tagDeleteTarget)" max-width="420" @update:model-value="value => { if (!value) tagDeleteTarget = null }"><v-card rounded="lg"><v-card-title class="dialog-title">删除标签“{{ tagDeleteTarget?.name }}”？</v-card-title><v-card-text class="dialog-body">标签会从所有小记中移除，小记本身不会删除。</v-card-text><v-card-actions class="dialog-actions"><v-spacer /><v-btn variant="text" @click="tagDeleteTarget = null">取消</v-btn><v-btn color="error" :loading="tagBusy" @click="deleteTag">删除标签</v-btn></v-card-actions></v-card></v-dialog>
  </div>
</template>

<style scoped>
.quick-notes-page { min-height: 100vh; margin: -24px; background: #fff; color: #262626; }
.quick-notes-page :deep(.v-btn) { text-transform: none; letter-spacing: 0; }
.notes-header { height: 64px; padding: 0 24px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; background: rgba(255, 255, 255, .96); }
.notes-header h1 { margin: 0; font-size: 19px; font-weight: 650; line-height: 1.35; }
.notes-header p { margin: 2px 0 0; color: #8a918e; font-size: 12px; }
.notes-shell { display: grid; grid-template-columns: 218px minmax(0, 1fr); height: calc(100vh - 64px); overflow: hidden; }
.notes-sidebar { padding: 14px 10px 24px; overflow-y: auto; border-right: 1px solid #eceeed; background: #fafbfa; }
.status-nav { display: grid; gap: 3px; }
.status-nav button, .tag-nav > button, .tag-nav-row > button { width: 100%; height: 34px; border: 0; border-radius: 7px; padding: 0 10px; display: flex; align-items: center; gap: 9px; background: transparent; color: #4d5451; font-size: 14px; text-align: left; cursor: pointer; }
.status-nav button:hover, .tag-nav > button:hover, .tag-nav-row:hover { background: #f0f2f1; }
.status-nav button.active, .tag-nav > button.active, .tag-nav-row.active { background: #e9efec; color: #222725; font-weight: 600; }
.sidebar-divider { height: 1px; margin: 14px 8px 12px; background: #e7e9e8; }
.tags-heading { height: 30px; padding: 0 8px 0 10px; display: flex; align-items: center; justify-content: space-between; color: #8b918e; font-size: 12px; font-weight: 600; }
.tags-heading button, .tag-more { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 5px; display: inline-grid; place-items: center; background: transparent; color: #747b78; cursor: pointer; }
.tags-heading button:hover, .tag-more:hover { background: #e7eae8; color: #252a28; }
.tag-nav { display: grid; gap: 2px; }
.tag-nav-row { min-width: 0; border-radius: 7px; display: grid; grid-template-columns: minmax(0, 1fr) 28px; align-items: center; }
.tag-nav-row > button { min-width: 0; }
.tag-nav-row > button span:last-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tag-more { opacity: 0; }
.tag-nav-row:hover .tag-more, .tag-more:focus-visible { opacity: 1; }
.tag-dot { width: 8px; height: 8px; flex: none; border-radius: 50%; }
.no-tags { margin: 8px 10px; color: #a3a9a6; font-size: 12px; }
.notes-main { min-width: 0; overflow-y: auto; padding: 24px 32px 64px; }
.capture-panel, .notes-toolbar, .notes-error, .batch-bar, .notes-progress { width: min(100%, 900px); }
.capture-panel { border: 1px solid #dfe3e1; border-radius: 9px; background: #fff; box-shadow: 0 1px 4px rgba(27, 39, 33, .04); transition: border-color .15s, box-shadow .15s; }
.capture-panel:focus-within { border-color: #9aaca4; box-shadow: 0 0 0 3px rgba(72, 104, 89, .07); }
.capture-panel textarea { width: 100%; min-height: 82px; padding: 14px 16px 8px; border: 0; outline: 0; resize: vertical; background: transparent; color: #252a28; font: inherit; font-size: 14px; line-height: 1.7; }
.capture-panel textarea::placeholder { color: #a4aaa7; }
.capture-panel footer { min-height: 43px; padding: 6px 9px 6px 14px; border-top: 1px solid #f0f2f1; display: flex; align-items: center; justify-content: space-between; }
.capture-panel footer > span { display: inline-flex; align-items: center; gap: 4px; color: #a0a6a3; font-size: 11px; }
.notes-error { margin-top: 12px; }
.notes-toolbar { min-height: 54px; display: flex; align-items: center; gap: 12px; }
.notes-search { width: 232px; height: 32px; padding: 0 9px; border: 1px solid #e0e3e2; border-radius: 7px; display: flex; align-items: center; gap: 7px; background: #fafbfa; color: #868d89; transition: width .18s, border-color .15s; }
.notes-search:focus-within { width: 280px; border-color: #adb7b2; background: #fff; }
.notes-search input { min-width: 0; flex: 1; border: 0; outline: 0; background: transparent; color: #303633; font-size: 13px; }
.notes-search button { width: 20px; height: 20px; padding: 0; border: 0; display: grid; place-items: center; background: transparent; color: #89908d; cursor: pointer; }
.select-all, .batch-cancel { padding: 0; border: 0; display: inline-flex; align-items: center; gap: 5px; background: transparent; color: #6f7773; font-size: 12px; cursor: pointer; }
.select-all:hover, .batch-cancel:hover { color: #2867d8; }
.note-count { margin-left: auto; color: #9ba19e; font-size: 12px; }
.batch-bar { position: sticky; top: -1px; z-index: 4; min-height: 48px; margin: 0 0 12px; padding: 6px 9px 6px 13px; border: 1px solid #ccdcf7; border-radius: 8px; display: flex; align-items: center; gap: 4px; background: #f5f8ff; box-shadow: 0 5px 12px rgba(33, 78, 145, .06); }
.batch-bar strong { margin-right: 4px; color: #315681; font-size: 13px; white-space: nowrap; }
.batch-tag-select { max-width: 178px; margin-left: 4px; }
.batch-tag-select :deep(.v-field) { min-height: 32px; }
.batch-cancel { margin-left: auto; padding: 7px; }
.notes-progress { margin-bottom: 10px; }
.notes-flow { width: min(100%, 1100px); display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; align-items: start; }
.note-card { min-width: 0; padding: 10px 12px 8px; border: 1px solid #e5e8e6; border-radius: 8px; background: #fff; transition: border-color .15s, box-shadow .15s, transform .15s; }
.note-card:hover { border-color: #ced4d1; box-shadow: 0 4px 13px rgba(37, 48, 42, .055); transform: translateY(-1px); }
.note-card.selected { border-color: #7da6e9; box-shadow: 0 0 0 2px rgba(43, 105, 211, .08); background: #fbfdff; }
.note-card.deleted { background: #fafafa; }
.note-card-header { height: 25px; display: flex; align-items: center; gap: 5px; color: #9aa09d; font-size: 11px; }
.note-check, .note-more { width: 24px; height: 24px; padding: 0; border: 0; display: grid; place-items: center; background: transparent; color: #abb1ae; cursor: pointer; }
.note-check { margin-left: -4px; }
.note-check.checked { color: #2868d8; }
.note-more { margin-left: auto; border-radius: 5px; opacity: 0; }
.note-card:hover .note-more, .note-more:focus-visible { opacity: 1; }
.note-more:hover { background: #f0f2f1; color: #555d59; }
.note-content { width: 100%; min-height: 46px; max-height: 218px; margin: 5px 0 8px; padding: 0; border: 0; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 8; background: transparent; color: #343936; text-align: left; white-space: pre-wrap; line-height: 1.68; cursor: pointer; font: inherit; font-size: 14px; overflow-wrap: anywhere; }
.note-content:hover { color: #111413; }
.note-content:disabled { cursor: default; opacity: .65; }
.note-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; margin: 3px 0 8px; }
.note-tags span { height: 21px; padding: 0 7px; border-radius: 4px; display: inline-flex; align-items: center; gap: 5px; background: #f3f5f4; color: #68706c; font-size: 11px; }
.note-tags i { width: 6px; height: 6px; border-radius: 50%; }
.note-footer { height: 27px; border-top: 1px solid #f1f2f1; display: flex; align-items: end; color: #a3a8a5; font-size: 10px; }
.note-footer button { margin-left: auto; padding: 4px 0 0 8px; border: 0; display: inline-flex; align-items: center; gap: 3px; background: transparent; color: #7b827f; font-size: 11px; cursor: pointer; opacity: 0; }
.note-card:hover .note-footer button, .note-footer button:focus-visible { opacity: 1; }
.note-footer button:hover { color: #2868d8; }
.notes-empty { width: min(100%, 900px); min-height: 280px; display: grid; place-content: center; justify-items: center; color: #abb1ae; text-align: center; }
.notes-empty h3 { margin: 12px 0 4px; color: #606763; font-size: 15px; font-weight: 550; }
.notes-empty p { margin: 0; font-size: 12px; }
.load-more { width: min(100%, 1100px); padding-top: 22px; text-align: center; }
.note-editor-drawer :deep(.v-navigation-drawer__content) { display: flex; flex-direction: column; background: #fff; }
.drawer-header { min-height: 64px; padding: 0 14px 0 20px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.drawer-header > div { display: flex; align-items: baseline; gap: 9px; }
.drawer-header strong { font-size: 16px; }
.drawer-header span { color: #979d9a; font-size: 11px; }
.drawer-body { min-height: 0; padding: 18px 20px; display: flex; flex: 1; flex-direction: column; gap: 18px; overflow-y: auto; }
.drawer-body textarea { width: 100%; min-height: 330px; padding: 14px; border: 1px solid #e0e3e2; border-radius: 8px; outline: 0; resize: vertical; color: #303633; font: inherit; font-size: 14px; line-height: 1.75; }
.drawer-body textarea:focus { border-color: #9ba9a2; box-shadow: 0 0 0 3px rgba(72, 104, 89, .07); }
.drawer-actions { min-height: 66px; padding: 10px 16px; border-top: 1px solid #eceeed; display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
.dialog-title { padding: 22px 22px 8px; font-size: 17px; font-weight: 650; }
.dialog-body { padding: 12px 22px 6px; color: #626966; font-size: 14px; }
.dialog-actions { padding: 12px 16px 16px; }
.color-preview { width: 14px; height: 14px; border-radius: 50%; margin-right: 12px; }

@media (max-width: 820px) {
  .quick-notes-page { margin: -16px; }
  .notes-header { height: 58px; padding: 0 16px; }
  .notes-shell { height: auto; grid-template-columns: 1fr; overflow: visible; }
  .notes-sidebar { padding: 8px 12px; border-right: 0; border-bottom: 1px solid #eceeed; overflow-x: auto; }
  .status-nav { display: flex; }
  .status-nav button { width: auto; white-space: nowrap; }
  .sidebar-divider, .tags-heading, .tag-nav { display: none; }
  .notes-main { padding: 18px 16px 48px; overflow: visible; }
  .batch-bar { overflow-x: auto; flex-wrap: nowrap; }
  .batch-tag-select { min-width: 160px; }
}
@media (max-width: 540px) {
  .notes-header p, .capture-panel footer > span { display: none; }
  .capture-panel footer { justify-content: flex-end; }
  .notes-toolbar { gap: 8px; }
  .notes-search, .notes-search:focus-within { width: min(100%, 210px); }
  .select-all span { display: none; }
  .notes-flow { grid-template-columns: 1fr; }
  .note-editor-drawer { width: 100% !important; }
}
</style>
