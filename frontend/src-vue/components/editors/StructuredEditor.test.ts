import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { vuetify } from '../../plugins/vuetify'
import StructuredEditor from './StructuredEditor.vue'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const mounted: VueWrapper[] = []

beforeEach(() => {
  let sequence = 0
  vi.stubGlobal('crypto', {
    getRandomValues: (bytes: Uint8Array) => {
      sequence += 1
      bytes.forEach((_, index) => { bytes[index] = (sequence * 31 + index) & 0xff })
      return bytes
    },
  })
})

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('StructuredEditor', () => {
  it('normalizes and opens the legacy empty whiteboard without randomUUID', async () => {
    const wrapper = mountEditor('WHITEBOARD', { type: 'whiteboard', content: [] })
    expect(wrapper.text()).toContain('无限白板')
    await wrapper.get('[data-testid="add-board"]').trigger('click')
    const emitted = lastJson<{ elements: Array<{ id: string }> }>(wrapper)
    expect(emitted.elements[0]?.id).toMatch(UUID_V4)
  })

  it('creates unique sheet IDs for an empty workbook without randomUUID', async () => {
    const wrapper = mountEditor('SPREADSHEET', { type: 'spreadsheet', content: [] })
    expect(wrapper.find('input[aria-label="A1"]').exists()).toBe(true)
    await wrapper.get('[data-testid="add-sheet"]').trigger('click')
    const emitted = lastJson<{ activeSheetId: string; sheets: Array<{ id: string }> }>(wrapper)
    expect(emitted.sheets).toHaveLength(2)
    expect(emitted.sheets.every((sheet) => UUID_V4.test(sheet.id))).toBe(true)
    expect(new Set(emitted.sheets.map((sheet) => sheet.id))).toHaveLength(2)
    expect(emitted.activeSheetId).toBe(emitted.sheets[1]?.id)
  })

  it('initializes database fields and creates field and row IDs without randomUUID', async () => {
    vi.stubGlobal('prompt', vi.fn(() => '负责人'))
    const wrapper = mountEditor('DATABASE', { type: 'database', content: [] })

    expect(wrapper.text()).toContain('名称')
    expect(wrapper.text()).toContain('状态')
    expect(wrapper.text()).toContain('日期')

    await wrapper.get('[data-testid="add-row"]').trigger('click')
    const rowUpdate = lastJson<{ rows: Array<{ id: string }> }>(wrapper)
    expect(rowUpdate.rows[0]?.id).toMatch(UUID_V4)

    await wrapper.get('[data-testid="add-field"]').trigger('click')
    const fieldUpdate = lastJson<{ fields: Array<{ id: string; name: string }> }>(wrapper)
    expect(fieldUpdate.fields.at(-1)).toMatchObject({ name: '负责人' })
    expect(fieldUpdate.fields.at(-1)?.id).toMatch(UUID_V4)
  })

  it('formats the selected cell, inserts a row with metadata reindexing, and covers existing dimensions', async () => {
    const rows = Array.from({ length: 35 }, (_, row) => Array.from({ length: 14 }, (_, column) => `${row}:${column}`))
    const wrapper = mountEditor('SPREADSHEET', {
      type: 'workbook', activeSheetId: 'sheet-main', sheets: [{
        id: 'sheet-main', name: '主表', rows,
        styles: { '2:0': { underline: true } }, dropdowns: { '2:1': ['甲', '乙'] }, protectedCells: ['2:2'],
        frozenRows: 0, frozenColumns: 0, hiddenRows: [4], hiddenColumns: [], filter: '',
      }],
    })

    expect(wrapper.find('input[aria-label="N1"]').exists()).toBe(true)
    expect(wrapper.find('input[aria-label="A35"]').exists()).toBe(true)
    await wrapper.get('input[aria-label="B2"]').trigger('focus')
    await wrapper.get('[data-testid="cell-bold"]').trigger('click')
    let value = lastJson<{ sheets: Array<{ styles: Record<string, Record<string, unknown>> }> }>(wrapper)
    expect(value.sheets[0]?.styles['1:1']).toMatchObject({ bold: true })

    await wrapper.setProps({ modelValue: JSON.stringify(value) })
    await wrapper.get('[data-testid="cell-italic"]').trigger('click')
    value = lastJson(wrapper)
    expect(value.sheets[0]?.styles['1:1']).toMatchObject({ bold: true, italic: true })

    await wrapper.setProps({ modelValue: JSON.stringify(value) })
    await wrapper.get('[data-testid="cell-align"]').trigger('click')
    value = lastJson(wrapper)
    expect(value.sheets[0]?.styles['1:1']).toMatchObject({ align: 'CENTER' })

    await wrapper.setProps({ modelValue: JSON.stringify(value) })
    await wrapper.get('[data-testid="insert-row"]').trigger('click')
    const inserted = lastJson<{ sheets: Array<{ rows: string[][]; styles: Record<string, unknown>; dropdowns: Record<string, unknown>; protectedCells: string[]; hiddenRows: number[] }> }>(wrapper).sheets[0]!
    expect(inserted.rows[2]).toEqual([])
    expect(inserted.rows[3]?.[0]).toBe('2:0')
    expect(inserted.styles['3:0']).toBeTruthy()
    expect(inserted.dropdowns['3:1']).toEqual(['甲', '乙'])
    expect(inserted.protectedCells).toContain('3:2')
    expect(inserted.hiddenRows).toContain(5)
  })

  it('reads, switches, and persists genuinely distinct database views', async () => {
    const fields = [
      { id: 'title', name: '标题', type: 'TEXT' },
      { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '已完成'] },
      { id: 'date', name: '日期', type: 'DATE' },
    ]
    const views = [
      { id: 'table', name: '表格', type: 'TABLE', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['title', 'status', 'date'] },
      { id: 'kanban', name: '看板', type: 'KANBAN', filter: '', sortFieldId: null, groupFieldId: 'status', visibleFieldIds: ['title', 'status'] },
      { id: 'gallery', name: '画廊', type: 'GALLERY', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['title', 'status'] },
      { id: 'calendar', name: '日历', type: 'CALENDAR', filter: '', sortFieldId: null, groupFieldId: 'date', visibleFieldIds: ['title', 'date'] },
    ]
    const wrapper = mountEditor('DATABASE', {
      type: 'database', fields, views, activeViewId: 'kanban', view: 'TABLE', filter: '', sortFieldId: null,
      rows: [
        { id: 'one', values: { title: '未归类事项', status: '', date: '' } },
        { id: 'two', values: { title: '完成事项', status: '已完成', date: '2026-08-26' } },
      ],
    })

    expect(wrapper.find('[data-testid="database-kanban-view"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('未分组')
    expect(wrapper.text()).toContain('未归类事项')

    await buttonWithText(wrapper, '画廊').trigger('click')
    const gallery = lastJson<{ activeViewId: string; view: string }>(wrapper)
    expect(gallery).toMatchObject({ activeViewId: 'gallery', view: 'GALLERY' })
    await wrapper.setProps({ modelValue: JSON.stringify(gallery) })
    await nextTick()
    expect(wrapper.find('[data-testid="database-gallery-view"]').exists()).toBe(true)

    await buttonWithText(wrapper, '日历').trigger('click')
    const calendar = lastJson<{ activeViewId: string; view: string }>(wrapper)
    expect(calendar).toMatchObject({ activeViewId: 'calendar', view: 'CALENDAR' })
    await wrapper.setProps({ modelValue: JSON.stringify(calendar) })
    await nextTick()
    expect(wrapper.find('[data-testid="database-calendar-view"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('未安排日期')
    expect(wrapper.text()).toContain('2026-08-26')

    await wrapper.get('[data-testid="add-row"]').trigger('click')
    const added = lastJson<{ rows: Array<{ values: Record<string, unknown> }> }>(wrapper).rows.at(-1)
    expect(added?.values).toMatchObject({ title: '新记录' })
    expect(added?.values).not.toHaveProperty('name')
  })

  it('pans and zooms the whiteboard while retaining every element kind', async () => {
    const kinds = ['RECT', 'ELLIPSE', 'STICKY', 'TEXT', 'ARROW']
    const wrapper = mountEditor('WHITEBOARD', {
      type: 'whiteboard', viewport: { x: 0, y: 0, zoom: 1 },
      elements: kinds.map((kind, index) => ({ id: kind, kind, x: index * 30, y: index * 20, width: 160, height: kind === 'ARROW' ? 24 : 100, text: kind, color: '#ffffff' })),
    })

    expect(wrapper.findAll('[data-kind]').map((item) => item.attributes('data-kind'))).toEqual(kinds)
    await wrapper.get('[data-testid="zoom-in"]').trigger('click')
    let value = lastJson<{ viewport: { x: number; y: number; zoom: number } }>(wrapper)
    expect(value.viewport.zoom).toBeCloseTo(1.1)

    await wrapper.setProps({ modelValue: JSON.stringify(value) })
    await buttonWithText(wrapper, '平移').trigger('click')
    const canvas = wrapper.get('[data-testid="board-canvas"]')
    canvas.element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: 10, clientY: 20 }))
    canvas.element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 50, clientY: 75 }))
    await nextTick()
    value = lastJson(wrapper)
    expect(value.viewport).toMatchObject({ x: 40, y: 55 })
    expect((value as unknown as { elements: Array<{ kind: string }> }).elements.map((element) => element.kind)).toEqual(kinds)
  })

  it('selects an element from its text area before destructive actions', async () => {
    const wrapper = mountEditor('WHITEBOARD', {
      type: 'whiteboard', viewport: { x: 0, y: 0, zoom: 1 }, elements: [
        { id: 'first', kind: 'STICKY', x: 0, y: 0, width: 160, height: 100, text: '第一项', color: '#fff' },
        { id: 'second', kind: 'TEXT', x: 200, y: 0, width: 160, height: 100, text: '第二项', color: '#fff' },
      ],
    })

    await wrapper.get('textarea[aria-label="白板文本内容"]').trigger('pointerdown')
    await wrapper.get('[data-testid="delete-board"]').trigger('click')
    const value = lastJson<{ elements: Array<{ id: string }> }>(wrapper)
    expect(value.elements.map((element) => element.id)).toEqual(['first'])
  })

  it('shows the correct empty state for a saved non-table database view', () => {
    const wrapper = mountEditor('DATABASE', {
      type: 'database', view: 'GALLERY', fields: [{ id: 'title', name: '标题', type: 'TEXT' }], rows: [], filter: '', sortFieldId: null,
    })
    expect(wrapper.find('[data-testid="database-gallery-view"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('暂无记录')
  })
})

function mountEditor(type: 'WHITEBOARD' | 'SPREADSHEET' | 'DATABASE', value: unknown) {
  const wrapper = mount(StructuredEditor, {
    props: { type, modelValue: JSON.stringify(value) },
    global: { plugins: [vuetify] },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

function lastJson<T>(wrapper: VueWrapper): T {
  const raw = wrapper.emitted('update:modelValue')?.at(-1)?.[0]
  expect(typeof raw).toBe('string')
  return JSON.parse(raw as string) as T
}

function buttonWithText(wrapper: VueWrapper, text: string) {
  const button = wrapper.findAll('button').find((item) => item.text().includes(text))
  expect(button, `button containing ${text}`).toBeTruthy()
  return button!
}
