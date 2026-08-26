import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import DocumentEditor from './DocumentEditor.vue'

const mounted: VueWrapper[] = []

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DocumentEditor', () => {
  it('initializes and edits a document when randomUUID is unavailable on HTTP', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(7) })
    const wrapper = mountEditor('')

    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    expect(input.attributes('placeholder')).toContain('输入 / 唤起命令')
    await input.setValue('HTTP 下也可以编辑')

    expect(lastUpdate(wrapper)).toBe('HTTP 下也可以编辑')
  })

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

  it('keeps the 42px toolbar and an empty outline mounted as stable editor geometry', async () => {
    const wrapper = mountEditor('', { title: '空文稿', showOutline: true })

    const toolbar = wrapper.findComponent({ name: 'VToolbar' })
    expect(toolbar.exists()).toBe(true)
    expect(Number(toolbar.props('height'))).toBe(42)

    const outline = wrapper.get('aside[aria-label="文稿大纲"]')
    expect(outline.text()).toContain('暂无标题')

    await wrapper.setProps({ modelValue: '# 第一节' })
    await nextTick()
    expect(wrapper.get('aside[aria-label="文稿大纲"]').text()).toContain('第一节')

    await wrapper.setProps({ modelValue: '' })
    await nextTick()
    expect(wrapper.get('aside[aria-label="文稿大纲"]').text()).toContain('暂无标题')
  })

  it('synchronizes the in-document title in both directions without coupling it to body Markdown', async () => {
    const wrapper = mountEditor('正文', { title: '父级标题' })
    const title = wrapper.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]')

    expect(title.element.value).toBe('父级标题')
    await title.setValue('正文内标题')
    expect(wrapper.emitted('update:title')?.at(-1)?.[0]).toBe('正文内标题')
    expect(lastUpdate(wrapper)).toBeUndefined()

    await wrapper.setProps({ title: '服务端标题' })
    await nextTick()
    expect(wrapper.get<HTMLTextAreaElement>('textarea[aria-label="文稿标题"]').element.value).toBe('服务端标题')
    expect(wrapper.get<HTMLTextAreaElement>('textarea.block-input').element.value).toBe('正文')
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
      'onUpdate:title': (value: string) => { void wrapper.setProps({ title: value }) },
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
