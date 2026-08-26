import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import DocumentEditor from './DocumentEditor.vue'

const mounted: VueWrapper[] = []

beforeEach(() => {
  stubViewport(1280)
  vi.stubGlobal('visualViewport', {
    width: 1024,
    height: 768,
    offsetLeft: 0,
    offsetTop: 0,
    scale: 1,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DocumentEditor', () => {
  it('focuses the compact outline, makes the editor inert, and restores focus after Escape or external close', async () => {
    stubViewport(768)
    const wrapper = mountEditor('# 平板标题', { showOutline: true })

    expect(wrapper.find('aside[aria-label="文稿大纲"]').exists()).toBe(false)
    const trigger = wrapper.get<HTMLButtonElement>('button[aria-label="文稿大纲"]')
    trigger.element.focus()
    await trigger.trigger('click')
    await nextTick()
    expect(wrapper.get('aside[aria-label="文稿大纲"]').attributes('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(wrapper.get('button[aria-label="收起大纲"]').element)
    expect(wrapper.get('.editor-toolbar').attributes('inert')).toBeDefined()
    expect(wrapper.get('.document-canvas').attributes('inert')).toBeDefined()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await nextTick()
    expect(wrapper.find('aside[aria-label="文稿大纲"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
    expect(wrapper.get('.editor-toolbar').attributes('inert')).toBeUndefined()
    expect(wrapper.get('.document-canvas').attributes('inert')).toBeUndefined()

    await trigger.trigger('click')
    await nextTick()
    ;(wrapper.vm as unknown as { closeOutline: () => void }).closeOutline()
    await nextTick()
    expect(wrapper.find('aside[aria-label="文稿大纲"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

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

  it('emits source offsets, selected text, and block metadata without changing the positional callback contract', async () => {
    const wrapper = mountEditor('# 标题\n- 列表项\n```ts\nconst answer = 42\n```')
    const inputs = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')
    const list = inputs[1]!
    list.element.focus()
    list.element.setSelectionRange(0, 3)
    await list.trigger('select')

    expect(wrapper.emitted('selection-change')?.at(-1)).toEqual([7, 10, {
      text: '列表项',
      blockIndex: 1,
      blockKind: 'BULLET',
      blockStart: 7,
      blockEnd: 10,
      selectionStart: 0,
      selectionEnd: 3,
    }])

    const code = inputs[2]!
    code.element.focus()
    code.element.setSelectionRange(6, 12)
    await code.trigger('select')
    expect(wrapper.emitted('selection-change')?.at(-1)?.slice(0, 3)).toEqual([23, 29, expect.objectContaining({
      text: 'answer',
      blockIndex: 2,
      blockKind: 'CODE',
      blockStart: 17,
      blockEnd: 34,
    })])
  })

  it('splits, merges, indents and moves blocks with keyboard-compatible operations', async () => {
    const wrapper = mountEditor('第一段\n- 第二段')
    const first = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[0]!
    first.element.focus()
    first.element.setSelectionRange(2, 2)
    await first.trigger('keydown', { key: 'Enter' })
    await nextTick()

    expect(lastUpdate(wrapper)).toBe('第一\n段\n- 第二段')
    const splitMiddle = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[1]!
    splitMiddle.element.setSelectionRange(0, 0)
    await splitMiddle.trigger('keydown', { key: 'Backspace' })
    expect(lastUpdate(wrapper)).toBe('第一段\n- 第二段')

    const second = wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[1]!
    second.element.focus()
    await second.trigger('keydown', { key: 'Tab' })
    expect(lastUpdate(wrapper)).toBe('第一段\n  - 第二段')
    await second.trigger('keydown', { key: 'ArrowUp', altKey: true })
    expect(lastUpdate(wrapper)).toBe('  - 第二段\n第一段')
  })

  it('keeps Shift+Enter as a soft break inside the current block', async () => {
    const wrapper = mountEditor('第一段')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(2, 2)
    await input.trigger('keydown', { key: 'Enter', shiftKey: true })
    await nextTick()

    expect(lastUpdate(wrapper)).toBe(`第一\u2028段`)
    expect(wrapper.findAll('textarea.block-input')).toHaveLength(1)
  })

  it('moves block actions to the textarea that receives focus and leaves readonly Tab navigation alone', async () => {
    const wrapper = mountEditor('甲\n乙')
    await wrapper.get('button[aria-label="选择并拖动第 1 块"]').trigger('click')
    expect(wrapper.findAll('.document-block')[0]!.classes()).toContain('selected')

    wrapper.findAll<HTMLTextAreaElement>('textarea.block-input')[1]!.element.focus()
    await nextTick()
    expect(wrapper.findAll('.document-block')[0]!.classes()).not.toContain('selected')
    expect(wrapper.findAll('.document-block')[1]!.classes()).toContain('active')

    const readonly = mountEditor('只读', { readonly: true })
    const input = readonly.get<HTMLTextAreaElement>('textarea.block-input')
    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    expect(input.element.dispatchEvent(event)).toBe(true)
    expect(event.defaultPrevented).toBe(false)
  })

  it('lets paragraph Tab navigation and list indentation boundaries escape the editor', async () => {
    const paragraph = mountEditor('普通段落')
    const paragraphInput = paragraph.get<HTMLTextAreaElement>('textarea.block-input')
    const paragraphTab = dispatchKey(paragraphInput.element, 'Tab')
    const paragraphBackTab = dispatchKey(paragraphInput.element, 'Tab', { shiftKey: true })
    expect(paragraphTab.defaultPrevented).toBe(false)
    expect(paragraphBackTab.defaultPrevented).toBe(false)
    expect(lastUpdate(paragraph)).toBeUndefined()

    const list = mountEditor('- 列表项')
    const listInput = list.get<HTMLTextAreaElement>('textarea.block-input')
    const indent = dispatchKey(listInput.element, 'Tab')
    await nextTick()
    expect(indent.defaultPrevented).toBe(true)
    expect(lastUpdate(list)).toBe('  - 列表项')

    const outdent = dispatchKey(listInput.element, 'Tab', { shiftKey: true })
    await nextTick()
    expect(outdent.defaultPrevented).toBe(true)
    expect(lastUpdate(list)).toBe('- 列表项')

    const outdentBoundary = dispatchKey(listInput.element, 'Tab', { shiftKey: true })
    expect(outdentBoundary.defaultPrevented).toBe(false)

    const maximum = mountEditor(`${' '.repeat(12)}- 最深列表项`)
    const maximumTab = dispatchKey(maximum.get<HTMLTextAreaElement>('textarea.block-input').element, 'Tab')
    expect(maximumTab.defaultPrevented).toBe(false)
    expect(lastUpdate(maximum)).toBeUndefined()
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

  it('supports keyboard navigation and an explicit empty state in the slash menu', async () => {
    const wrapper = mountEditor('')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')

    await input.setValue('/not-a-command')
    expect(wrapper.get('.slash-empty').text()).toContain('没有匹配的命令')
    expect(wrapper.get('.slash-empty').text()).toContain('Esc')

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)

    await input.setValue('/')
    await input.trigger('keydown', { key: 'ArrowDown' })
    expect(wrapper.get('[data-command="H1"]').attributes('aria-selected')).toBe('true')
    await input.trigger('keydown', { key: 'Enter' })
    expect(lastUpdate(wrapper)).toBe('# ')
  })

  it('opens a searchable insert menu and inserts the keyboard-selected block', async () => {
    const wrapper = mountEditor('正文')
    await wrapper.get('button[aria-label="插入内容"]').trigger('click')
    await flushOverlay()

    const menu = document.querySelector<HTMLElement>('.insert-menu')
    expect(menu).not.toBeNull()
    expect(menu?.getAttribute('aria-label')).toBe('插入内容菜单')
    const search = menu?.querySelector<HTMLInputElement>('input[aria-label="搜索插入内容"]')
    expect(document.activeElement).toBe(search)

    if (!search) throw new Error('insert menu search input missing')
    search.value = 'does-not-exist'
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    expect(document.querySelector('.insert-menu-empty')?.textContent).toContain('没有找到相关内容')

    search.value = ''
    search.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))
    await nextTick()
    expect(document.querySelector('[data-insert-command="H1"]')?.getAttribute('aria-selected')).toBe('true')
    search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await nextTick()

    expect(lastUpdate(wrapper)).toBe('正文\n# ')
    expect(wrapper.get('button[aria-label="插入内容"]').attributes('aria-expanded')).toBe('false')
  })

  it('uses the same grouped command registry for the toolbar and slash menus', async () => {
    const wrapper = mountEditor('')
    await wrapper.get('button[aria-label="插入内容"]').trigger('click')
    await flushOverlay()

    const insertMenu = document.querySelector<HTMLElement>('.insert-menu')
    expect(insertMenu?.textContent).toContain('基础')
    expect(insertMenu?.textContent).toContain('媒体')
    expect(insertMenu?.textContent).toContain('内容')
    expect(insertMenu?.textContent).toContain('关联')
    expect(insertMenu?.querySelector('[data-insert-command="image"]')?.textContent).toContain('图片')
    expect(insertMenu?.querySelector('[data-insert-command="page-reference"]')?.textContent).toContain('页面引用')

    await wrapper.get('button[aria-label="插入内容"]').trigger('click')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    await input.setValue('/')
    expect(wrapper.get('.slash-menu').text()).toContain('媒体')
    expect(wrapper.get('[data-command="image"]').text()).toContain('图片')
    expect(wrapper.get('[data-command="page-reference"]').text()).toContain('页面引用')
  })

  it('keeps an exact slash insertion point for external cards and rejects a stale document', async () => {
    const wrapper = mountEditor('开头 /image 结尾')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(9, 9)
    await input.trigger('input')
    await wrapper.get('[data-command="image"]').trigger('click')

    expect(wrapper.emitted('request-content-card')?.at(-1)).toEqual([{ commandId: 'image', kind: 'image' }])
    expect(lastUpdate(wrapper)).toBe('开头  结尾')

    const editor = wrapper.vm as unknown as { insertPendingText: (text: string) => boolean }
    expect(editor.insertPendingText('{{card:test}}')).toBe(true)
    await nextTick()
    expect(lastUpdate(wrapper)).toBe('开头\n{{card:test}}\n结尾')

    const stale = mountEditor('/image')
    await stale.get<HTMLTextAreaElement>('textarea.block-input').setValue('/image')
    await stale.get('[data-command="image"]').trigger('click')
    await stale.setProps({ modelValue: '远端协作内容' })
    expect((stale.vm as unknown as { insertPendingText: (text: string) => boolean }).insertPendingText('{{card:test}}')).toBe(false)
    expect(lastUpdate(stale)).not.toBe('{{card:test}}')
  })

  it('restores focus when an external insertion is cancelled and ignores IME composition commands', async () => {
    const wrapper = mountEditor('正文')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(1, 1)
    const editor = wrapper.vm as unknown as {
      requestReference: () => void
      cancelPendingInsert: () => void
    }

    editor.requestReference()
    expect(wrapper.emitted('request-reference')?.at(-1)).toEqual([{ commandId: 'page-reference' }])
    editor.cancelPendingInsert()
    await nextTick()
    expect(document.activeElement).toBe(input.element)
    expect(input.element.selectionStart).toBe(1)

    await input.setValue('/')
    const composingEnter = dispatchKey(input.element, 'Enter', { isComposing: true })
    expect(composingEnter.defaultPrevented).toBe(false)
    expect(wrapper.find('.slash-menu').exists()).toBe(true)
    expect(lastUpdate(wrapper)).toBe('/')

    await wrapper.get('button[aria-label="插入内容"]').trigger('click')
    await flushOverlay()
    const search = document.querySelector<HTMLInputElement>('input[aria-label="搜索插入内容"]')!
    const composingMenuEnter = dispatchKey(search, 'Enter', { isComposing: true })
    await nextTick()
    expect(composingMenuEnter.defaultPrevented).toBe(false)
    expect(document.querySelector('.insert-menu')).not.toBeNull()
    expect(lastUpdate(wrapper)).toBe('/')
  })

  it('reflects active formatting, blocks paragraph indentation, and flips a low slash menu upward', async () => {
    const wrapper = mountEditor('**粗体**')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(2, 4)
    await input.trigger('select')
    expect(wrapper.get('button[aria-label="粗体"]').attributes('aria-pressed')).toBe('true')
    expect(wrapper.get('button[aria-label="斜体"]').attributes('aria-pressed')).toBe('false')
    expect(wrapper.get('button[aria-label="无序列表"]').attributes('aria-pressed')).toBe('false')

    await wrapper.get('button[aria-label="更多格式"]').trigger('click')
    await flushOverlay()
    const indent = Array.from(document.querySelectorAll<HTMLElement>('.v-list-item')).find((item) => item.textContent?.includes('增加缩进'))
    expect(indent?.classList.contains('v-list-item--disabled')).toBe(true)

    Object.defineProperty(input.element, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ top: 620, bottom: 660, left: 0, right: 400, width: 400, height: 40, x: 0, y: 620, toJSON: () => ({}) }),
    })
    await input.setValue('/')
    expect(wrapper.get('.slash-menu').classes()).toContain('slash-menu--above')
  })

  it('keeps insert and link actions disabled in readonly mode', async () => {
    const wrapper = mountEditor('只读正文', { readonly: true })
    const insert = wrapper.get('button[aria-label="插入内容"]')
    const link = wrapper.get('button[aria-label="插入链接"]')

    expect(insert.attributes('disabled')).toBeDefined()
    expect(link.attributes('disabled')).toBeDefined()
    await insert.trigger('click')
    await flushOverlay()
    expect(document.querySelector('.insert-menu')).toBeNull()
  })

  it('validates and inserts a safe HTTP or HTTPS link without losing the selected label', async () => {
    const wrapper = mountEditor('链接文本')
    const input = wrapper.get<HTMLTextAreaElement>('textarea.block-input')
    input.element.focus()
    input.element.setSelectionRange(0, 4)
    await input.trigger('keydown', { key: 'k', ctrlKey: true })
    await flushOverlay()

    const dialog = document.querySelector<HTMLElement>('.link-dialog')
    expect(dialog).not.toBeNull()
    const label = dialog?.querySelector<HTMLInputElement>('input[aria-label="显示文字"]')
    const url = dialog?.querySelector<HTMLInputElement>('input[aria-label="链接地址"]')
    const submit = Array.from(dialog?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((button) => button.textContent?.includes('插入链接'))
    expect(label?.value).toBe('链接文本')
    expect(submit?.disabled).toBe(true)

    if (!url || !submit) throw new Error('link dialog controls missing')
    url.value = 'javascript:alert(1)'
    url.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    submit.click()
    await nextTick()
    expect(dialog?.textContent).toContain('HTTP/HTTPS')

    url.value = 'http://docs.example.test/path'
    url.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    submit.click()
    await nextTick()
    expect(lastUpdate(wrapper)).toBe('[链接文本](http://docs.example.test/path)')
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

function stubViewport(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  vi.stubGlobal('matchMedia', vi.fn((query: string) => {
    const maximum = /max-width:\s*(\d+)px/.exec(query)?.[1]
    const matches = maximum ? width <= Number(maximum) : false
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  }))
}

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

function dispatchKey(element: HTMLElement, key: string, options: KeyboardEventInit = {}) {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options })
  element.dispatchEvent(event)
  return event
}

async function flushOverlay() {
  await nextTick()
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
