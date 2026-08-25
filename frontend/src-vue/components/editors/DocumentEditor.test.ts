import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import DocumentEditor from './DocumentEditor.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

describe('DocumentEditor', () => {
  it('edits typed Markdown blocks without changing the string serialization format', async () => {
    const wrapper = mountEditor('# 标题\n正文')
    const inputs = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')

    expect(inputs).toHaveLength(2)
    expect(inputs[0]!.element.value).toBe('标题')
    expect(wrapper.find('.kind-h1').exists()).toBe(true)

    await inputs[0]!.setValue('新标题')
    expect(lastUpdate(wrapper)).toBe('# 新标题\n正文')
  })

  it('splits, merges, indents and moves blocks with keyboard-compatible operations', async () => {
    const wrapper = mountEditor('第一段\n第二段')
    const first = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[0]!
    first.element.focus()
    first.element.setSelectionRange(2, 2)
    await first.trigger('keydown', { key: 'Enter' })
    await nextTick()

    expect(lastUpdate(wrapper)).toBe('第一\n段\n第二段')
    const splitMiddle = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[1]!
    splitMiddle.element.setSelectionRange(0, 0)
    await splitMiddle.trigger('keydown', { key: 'Backspace' })
    expect(lastUpdate(wrapper)).toBe('第一段\n第二段')

    const second = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[1]!
    second.element.focus()
    await second.trigger('keydown', { key: 'Tab' })
    expect(lastUpdate(wrapper)).toBe('第一段\n  第二段')
    await second.trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(lastUpdate(wrapper)).toBe('  第二段\n第一段')
  })

  it('supports inline formatting and grouped undo/redo', async () => {
    const wrapper = mountEditor('正文')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(0, 2)

    await input.trigger('keydown', { key: 'b', ctrlKey: true })
    expect(lastUpdate(wrapper)).toBe('**正文**')

    await wrapper.get('button[aria-label="撤销"]').trigger('click')
    expect(lastUpdate(wrapper)).toBe('正文')
    await wrapper.get('button[aria-label="重做"]').trigger('click')
    expect(lastUpdate(wrapper)).toBe('**正文**')
  })

  it('opens a filtered slash menu and applies the selected block command', async () => {
    const wrapper = mountEditor('')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('/h1')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    const command = wrapper.get('[data-command="H1"]')
    expect(command.text()).toContain('标题 1')
    await command.trigger('click')

    expect(lastUpdate(wrapper)).toBe('# ')
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
  })

  it('pastes multiple Markdown lines as independently editable blocks', async () => {
    const wrapper = mountEditor('开头结尾')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(2, 2)

    await input.trigger('paste', {
      clipboardData: { getData: () => '甲\n## 乙' },
    })
    await nextTick()

    expect(lastUpdate(wrapper)).toBe('开头甲\n## 乙结尾')
    expect(wrapper.findAll('textarea.block-input')).toHaveLength(2)
    expect(wrapper.find('.kind-h2').exists()).toBe(true)
  })

  it('keeps fenced code blocks valid and displays an outline using document settings', async () => {
    const markdown = '# 接口说明\n```ts\nconst one = 1\nconst two = 2\n```'
    const wrapper = mountEditor(markdown, {
      documentSettings: { pageWidth: 'WIDE', fontFamily: 'SERIF', fontSize: 'LARGE', paragraphSpacing: 'RELAXED', showOutline: true },
    })

    expect(wrapper.classes()).toContain('document-width-wide')
    expect(wrapper.find('aside[aria-label="文稿大纲"]').text()).toContain('接口说明')
    const code = wrapper.get<HTMLTextAreaElement>('textarea.code-input')
    expect(code.element.value).toBe('const one = 1\nconst two = 2')

    await code.setValue('const answer = 42')
    expect(lastUpdate(wrapper)).toBe('# 接口说明\n```ts\nconst answer = 42\n```')
  })

  it('exposes focus and slash-replacing insertion for reference and content-card integrations', async () => {
    const wrapper = mountEditor('段落/')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(3, 3)

    const editor = wrapper.vm as unknown as { insertText: (text: string, replaceSlash?: boolean) => void; focus: () => void }
    editor.insertText('{{card:test}}', true)
    await nextTick()

    expect(lastUpdate(wrapper)).toBe('段落\n{{card:test}}\n')
    editor.focus()
    expect(document.activeElement).toBe(wrapper.findAll('textarea.block-input').at(-1)!.element)
  })

  it('reorders selected blocks through drag and drop', async () => {
    const wrapper = mountEditor('甲\n乙\n丙')
    const transfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    const firstHandle = wrapper.get('button[aria-label="选择并拖动第 1 块"]')
    await firstHandle.trigger('dragstart', { dataTransfer: transfer })
    const lastBlock = wrapper.findAll('.document-block')[2]!
    await lastBlock.trigger('dragover', { dataTransfer: transfer, clientY: 1 })
    await lastBlock.trigger('drop', { dataTransfer: transfer, clientY: 1 })

    expect(lastUpdate(wrapper)).toBe('乙\n丙\n甲')
  })
})

function mountEditor(modelValue: string, extraProps: Record<string, unknown> = {}) {
  let wrapper!: VueWrapper
  wrapper = mount(DocumentEditor, {
    props: {
      modelValue,
      ...extraProps,
      'onUpdate:modelValue': (value: string) => { void wrapper.setProps({ modelValue: value }) },
    },
    global: { plugins: [vuetify] },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

function lastUpdate(wrapper: VueWrapper) {
  return wrapper.emitted('update:modelValue')?.at(-1)?.[0]
}
