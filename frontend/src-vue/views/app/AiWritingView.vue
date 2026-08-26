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
    <h1>AI 写作</h1>
    <section class="ai-stage" aria-labelledby="ai-stage-title">
      <div class="ai-heading">
        <span class="ai-mark"><v-icon size="25">mdi-creation-outline</v-icon></span>
        <div><h2 id="ai-stage-title">今天想写点什么？</h2><p>描述主题、受众和目标，开始你的创作。</p></div>
      </div>
      <div class="mode-list" role="radiogroup" aria-label="写作方式">
        <button v-for="mode in modes" :key="mode.title" type="button" role="radio" :aria-checked="activeMode === mode.title" :class="{ active: activeMode === mode.title }" @click="activeMode = mode.title">
          <v-icon size="20">{{ mode.icon }}</v-icon><span><strong>{{ mode.title }}</strong><small>{{ mode.subtitle }}</small></span>
        </button>
      </div>
      <div class="prompt-box">
        <textarea v-model="prompt" rows="5" maxlength="2000" placeholder="例如：写一份面向新成员的项目介绍，语气简洁、包含目标和使用方法" @keydown.ctrl.enter="startWriting" @keydown.meta.enter="startWriting" />
        <div class="prompt-footer"><span>{{ prompt.length }} / 2000</span><button type="button" :disabled="!canStart" @click="startWriting"><v-icon size="17">mdi-arrow-up</v-icon><span>开始创作</span></button></div>
      </div>
    </section>
  </main>
</template>

<style scoped>
.ai-page { min-height: 100vh; padding: 26px 36px 56px; color: #262626; background: #fff; }
.ai-page > h1 { height: 28px; margin: 0; font-size: 18px; font-weight: 500; line-height: 28px; }
.ai-stage { width: min(760px, 100%); margin: 92px auto 0; }
.ai-heading { display: flex; align-items: center; gap: 14px; }
.ai-mark { display: grid; width: 44px; height: 44px; flex: 0 0 44px; place-items: center; border-radius: 12px; color: #16a36a; background: #edfaf4; }
.ai-heading h2 { margin: 0; font-size: 22px; font-weight: 600; line-height: 30px; }
.ai-heading p { margin: 3px 0 0; color: #8a8f8d; font-size: 14px; }
.mode-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 28px; }
.mode-list button { display: flex; min-height: 76px; align-items: flex-start; gap: 9px; padding: 13px; border: 1px solid #e7e9e8; border-radius: 8px; color: #595959; background: #fff; font: inherit; text-align: left; cursor: pointer; }
.mode-list button.active { border-color: #7ccfae; background: #f4fbf7; color: #167653; }
.mode-list button:focus-visible, .prompt-footer button:focus-visible { outline: 2px solid #1677ff; outline-offset: 2px; }
.mode-list span { display: flex; min-width: 0; flex-direction: column; }
.mode-list strong { color: #262626; font-size: 14px; font-weight: 500; line-height: 20px; }
.mode-list small { margin-top: 3px; color: #8a8f8d; font-size: 12px; line-height: 17px; }
.prompt-box { margin-top: 18px; overflow: hidden; border: 1px solid #dfe2e1; border-radius: 10px; background: #fff; box-shadow: 0 6px 24px rgba(31, 35, 41, .05); }
.prompt-box:focus-within { border-color: #8eb4ff; box-shadow: 0 0 0 3px rgba(22, 119, 255, .08); }
.prompt-box textarea { display: block; width: 100%; min-height: 130px; resize: vertical; padding: 16px; border: 0; outline: 0; color: #262626; background: transparent; font: inherit; font-size: 14px; line-height: 1.7; }
.prompt-box textarea::placeholder { color: #a7aaa9; }
.prompt-footer { display: flex; min-height: 48px; align-items: center; justify-content: space-between; padding: 7px 9px 9px 16px; }
.prompt-footer > span { color: #a7aaa9; font-size: 12px; }
.prompt-footer button { display: inline-flex; height: 34px; align-items: center; gap: 5px; padding: 0 13px; border: 0; border-radius: 7px; color: #fff; background: #1677ff; font: inherit; font-size: 13px; cursor: pointer; }
.prompt-footer button:disabled { cursor: default; opacity: .38; }
@media (max-width: 760px) { .ai-page { padding: 22px 20px 48px; } .ai-stage { margin-top: 44px; } .mode-list { grid-template-columns: 1fr; } }
</style>
