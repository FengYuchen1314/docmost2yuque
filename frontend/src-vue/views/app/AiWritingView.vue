<script setup lang="ts">
import { computed, ref } from 'vue'
import { useSessionStore } from '../../stores/session'
import { useUiStore } from '../../stores/ui'

const session = useSessionStore()
const ui = useUiStore()
const prompt = ref('')
const activeMode = ref('从主题开始')
const modes = [
  { title: '从主题开始', subtitle: '输入主题和要求，快速开始一篇文档', icon: 'mdi-text-box-edit-outline' },
  { title: '整理已有内容', subtitle: '先创建文档，再粘贴和整理已有材料', icon: 'mdi-text-recognition' },
  { title: '从模板开始', subtitle: '从常见写作场景中选择结构', icon: 'mdi-view-grid-outline' },
]
const canStart = computed(() => prompt.value.trim().length > 0)

function startWriting() {
  if (!canStart.value) return
  ui.openCreate({
    kind: 'DOCUMENT',
    workspaceId: session.activeWorkspace?.id,
    knowledgeBaseId: session.activeKnowledgeBases[0]?.id,
    source: 'WORKBENCH',
  })
}
</script>

<template>
  <main class="ai-page">
    <header class="tool-header">
      <div><h1>AI 写作</h1><p>从一个想法开始，快速创建文档。</p></div>
      <span><v-icon size="15">mdi-auto-fix</v-icon> 写作助手</span>
    </header>
    <section class="ai-stage" aria-labelledby="ai-stage-title">
      <div class="ai-heading">
        <span class="ai-mark"><v-icon size="22">mdi-creation-outline</v-icon></span>
        <div><h2 id="ai-stage-title">今天想写点什么？</h2><p>描述主题、受众和目标，AI 会帮你搭好第一版。</p></div>
      </div>
      <div class="mode-list" role="radiogroup" aria-label="写作方式">
        <button v-for="mode in modes" :key="mode.title" type="button" role="radio" :aria-checked="activeMode === mode.title" :class="{ active: activeMode === mode.title }" @click="activeMode = mode.title">
          <v-icon size="20">{{ mode.icon }}</v-icon><span><strong>{{ mode.title }}</strong><small>{{ mode.subtitle }}</small></span>
        </button>
      </div>
      <div class="prompt-box">
        <textarea v-model="prompt" rows="5" maxlength="2000" aria-label="写作要求" placeholder="描述你想写的内容，例如：面向新成员的项目介绍，语气简洁，包含目标和使用方法…" @keydown.ctrl.enter.prevent="startWriting" @keydown.meta.enter.prevent="startWriting" />
        <div class="prompt-footer"><span>Ctrl / Cmd + Enter · {{ prompt.length }} / 2000</span><button type="button" :disabled="!canStart" @click="startWriting"><span>开始创作</span><v-icon size="16">mdi-arrow-right</v-icon></button></div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ai-page { min-height: 100vh; margin: -24px; color: #262626; background: #fff; }
.tool-header { height: 65px; padding: 0 26px; border-bottom: 1px solid #eceeed; display: flex; align-items: center; justify-content: space-between; }
.tool-header h1 { margin: 0; font-size: 18px; font-weight: 650; line-height: 25px; }
.tool-header p { margin: 1px 0 0; color: #959b98; font-size: 12px; }
.tool-header > span { height: 27px; padding: 0 9px; border-radius: 6px; display: inline-flex; align-items: center; gap: 5px; color: #39785d; background: #edf7f2; font-size: 12px; }
.ai-stage { width: min(760px, calc(100% - 40px)); margin: 58px auto 0; }
.ai-heading { display: flex; align-items: center; gap: 14px; }
.ai-mark { display: grid; width: 40px; height: 40px; flex: 0 0 40px; place-items: center; border-radius: 10px; color: #159b65; background: #edf8f3; }
.ai-heading h2 { margin: 0; font-size: 21px; font-weight: 650; line-height: 29px; }
.ai-heading p { margin: 2px 0 0; color: #8d9390; font-size: 13px; }
.mode-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-top: 24px; }
.mode-list button { display: flex; min-height: 68px; align-items: flex-start; gap: 9px; padding: 11px 12px; border: 1px solid #e5e8e6; border-radius: 8px; color: #6d7470; background: #fff; font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, background .15s; }
.mode-list button:hover { border-color: #cbd1ce; background: #fafbfa; }
.mode-list button.active { border-color: #81c8a9; background: #f3faf6; color: #167653; box-shadow: 0 0 0 1px rgba(22, 118, 83, .04); }
.mode-list button:focus-visible, .prompt-footer button:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.mode-list span { display: flex; min-width: 0; flex-direction: column; }
.mode-list strong { color: #303532; font-size: 13px; font-weight: 600; line-height: 19px; }
.mode-list small { margin-top: 3px; color: #8a8f8d; font-size: 12px; line-height: 17px; }
.prompt-box { margin-top: 14px; overflow: hidden; border: 1px solid #dce1de; border-radius: 9px; background: #fff; box-shadow: 0 3px 14px rgba(31, 35, 41, .045); }
.prompt-box:focus-within { border-color: #8eb4ff; box-shadow: 0 0 0 3px rgba(22, 119, 255, .08); }
.prompt-box textarea { display: block; width: 100%; min-height: 126px; resize: vertical; padding: 15px 16px 8px; border: 0; outline: 0; color: #262626; background: transparent; font: inherit; font-size: 14px; line-height: 1.72; }
.prompt-box textarea::placeholder { color: #a7aaa9; }
.prompt-footer { display: flex; min-height: 46px; align-items: center; justify-content: space-between; padding: 6px 8px 8px 16px; border-top: 1px solid #f2f3f2; }
.prompt-footer > span { color: #a7aaa9; font-size: 12px; }
.prompt-footer button { display: inline-flex; height: 34px; align-items: center; gap: 5px; padding: 0 13px; border: 0; border-radius: 7px; color: #fff; background: #1677ff; font: inherit; font-size: 13px; cursor: pointer; }
.prompt-footer button:disabled { cursor: default; opacity: .38; }
@media (max-width: 760px) { .ai-page { margin: -16px; } .tool-header { padding: 0 18px; } .tool-header > span { display: none; } .ai-stage { margin-top: 36px; } .mode-list { grid-template-columns: 1fr; } }
</style>
