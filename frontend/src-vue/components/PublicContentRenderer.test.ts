import { defineComponent } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createContentCardNode, encodeContentCardToken } from './content-cards/contentCardModel'

vi.mock('./content-cards/ContentCardRenderer.vue', () => ({
  default: defineComponent({
    name: 'ContentCardRenderer',
    props: {
      card: { type: null, required: true },
      interactive: { type: Boolean, default: true },
      allowIframes: { type: Boolean, default: true },
    },
    template: '<div data-testid="public-card" :data-interactive="String(interactive)" :data-iframes="String(allowIframes)" />',
  }),
}))

import PublicContentRenderer from './PublicContentRenderer.vue'

afterEach(() => vi.unstubAllGlobals())

function mountDocument(plainText: string, content: unknown = {}) {
  return mount(PublicContentRenderer, {
    props: { contentType: 'DOCUMENT', content, plainText },
    global: { stubs: { VIcon: true } },
  })
}

function mountStructured(contentType: 'WHITEBOARD' | 'SPREADSHEET' | 'DATABASE', content: unknown) {
  return mount(PublicContentRenderer, { props: { contentType, content, plainText: '' } })
}

describe('PublicContentRenderer content cards', () => {
  it('routes token, JSON and damaged card lines through the locked-down card renderer', () => {
    const token = encodeContentCardToken(createContentCardNode('status', { value: 'DONE', label: '完成' }))
    const json = JSON.stringify(createContentCardNode('callout', { tone: 'INFO', text: '公告' }))
    const wrapper = mountDocument([token, json, '{{card:damaged-token', '{"cardId":"future-card", broken'].join('\n'))
    const cards = wrapper.findAll('[data-testid="public-card"]')
    expect(cards).toHaveLength(4)
    for (const card of cards) {
      expect(card.attributes('data-interactive')).toBe('false')
      expect(card.attributes('data-iframes')).toBe('false')
    }
  })

  it('preserves canonical card order from structured document JSON', () => {
    const card = createContentCardNode('code', { language: 'ts', code: 'const safe = true' })
    const content = {
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '开始' }] },
        card,
        { type: 'paragraph', content: [{ type: 'text', text: '结束' }] },
      ],
    }
    const wrapper = mountDocument('不应覆盖结构化顺序', content)
    expect(wrapper.get('h2').text()).toBe('开始')
    expect(wrapper.find('[data-testid="public-card"]').exists()).toBe(true)
    expect(wrapper.get('.reader-paragraph').text()).toBe('结束')
  })

  it('renders normal Markdown-like lines as escaped semantic elements', () => {
    const wrapper = mountDocument([
      '# 标题',
      '> 引用',
      '- 列表项',
      '- [x] 已完成',
      '1. 第一步',
      '```ts',
      '<img src=x onerror=alert(1)>',
      '```',
      '<script>alert(1)</script>',
    ].join('\n'))
    expect(wrapper.get('h1').text()).toBe('标题')
    expect(wrapper.get('blockquote').text()).toBe('引用')
    expect(wrapper.get('.public-code code').text()).toContain('<img src=x onerror=alert(1)>')
    expect(wrapper.find('img').exists()).toBe(false)
    expect(wrapper.find('script').exists()).toBe(false)
    expect(wrapper.text()).toContain('<script>alert(1)</script>')
    expect(wrapper.find('.public-task--done').exists()).toBe(true)
    expect(wrapper.find('.public-database').exists()).toBe(false)
  })

  it('copies and collapses Yuque-style code blocks without interpreting their contents', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
    const wrapper = mountDocument(['```js', 'const value = "<unsafe>"', 'return value', '```'].join('\n'))

    expect(wrapper.findAll('.public-code__body li')).toHaveLength(2)
    expect(wrapper.get('.public-code__language').text()).toBe('js')
    await wrapper.get('button[aria-label="复制代码"]').trigger('click')
    expect(writeText).toHaveBeenCalledWith('const value = "<unsafe>"\nreturn value')
    expect(wrapper.get('.public-code__copy').text()).toContain('已复制')

    await wrapper.get('button[aria-label="收起代码块"]').trigger('click')
    expect(wrapper.find('.public-code__body').exists()).toBe(false)
    expect(wrapper.get('button[aria-label="展开代码块"]').attributes('aria-expanded')).toBe('false')
  })
})

describe('PublicContentRenderer structured content', () => {
  it('opens activeSheetId and allows read-only switching between worksheets', async () => {
    const wrapper = mountStructured('SPREADSHEET', {
      type: 'workbook', activeSheetId: 'second', sheets: [
        { id: 'first', name: '第一张', rows: [['甲']], styles: {}, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], protectedCells: [], dropdowns: {}, filter: '' },
        { id: 'second', name: '第二张', rows: [['乙']], styles: { '0:0': { bold: true, italic: true, align: 'RIGHT' } }, frozenRows: 0, frozenColumns: 0, hiddenRows: [], hiddenColumns: [], protectedCells: [], dropdowns: {}, filter: '' },
      ],
    })

    expect(wrapper.get('.public-sheet-header strong').text()).toBe('第二张')
    expect(wrapper.get('.public-sheet-table td').text()).toBe('乙')
    expect(wrapper.get('.public-sheet-table td').attributes('style')).toContain('font-weight: 700')
    expect(wrapper.get('.public-sheet-table td').attributes('style')).toContain('text-align: right')

    await wrapper.get('button[data-sheet-id="first"]').trigger('click')
    expect(wrapper.get('.public-sheet-header strong').text()).toBe('第一张')
    expect(wrapper.get('.public-sheet-table td').text()).toBe('甲')
  })

  it('retains distinct whiteboard semantics for shapes, text, notes, and arrows', () => {
    const kinds = ['RECT', 'ELLIPSE', 'STICKY', 'TEXT', 'ARROW']
    const wrapper = mountStructured('WHITEBOARD', {
      type: 'whiteboard', viewport: { x: 12, y: 18, zoom: 1.2 },
      elements: kinds.map((kind, index) => ({ id: kind, kind, x: index * 20, y: index * 15, width: 160, height: kind === 'ARROW' ? 24 : 90, text: kind, color: '#fff4b8' })),
    })

    for (const kind of kinds) expect(wrapper.find(`[data-kind="${kind}"]`).exists()).toBe(true)
    expect(wrapper.find('.kind-ellipse').exists()).toBe(true)
    expect(wrapper.find('.kind-text').exists()).toBe(true)
    expect(wrapper.find('svg.public-board-arrow line').exists()).toBe(true)
    expect(wrapper.get('.public-board-surface').attributes('style')).toContain('scale(1.2)')
  })

  it('respects the saved database view, visible fields, grouping, and ungrouped records', async () => {
    const fields = [
      { id: 'name', name: '名称', type: 'TEXT' },
      { id: 'status', name: '状态', type: 'SELECT', options: ['待处理', '已完成'] },
      { id: 'date', name: '日期', type: 'DATE' },
    ]
    const views = [
      { id: 'table', name: '表格', type: 'TABLE', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['name'] },
      { id: 'kanban', name: '看板', type: 'KANBAN', filter: '', sortFieldId: null, groupFieldId: 'status', visibleFieldIds: ['name', 'status'] },
      { id: 'gallery', name: '画廊', type: 'GALLERY', filter: '', sortFieldId: null, groupFieldId: null, visibleFieldIds: ['name'] },
      { id: 'calendar', name: '日历', type: 'CALENDAR', filter: '', sortFieldId: null, groupFieldId: 'date', visibleFieldIds: ['name', 'date'] },
    ]
    const content = {
      type: 'database', fields, views, activeViewId: 'kanban', view: 'TABLE', filter: '', sortFieldId: null,
      rows: [
        { id: 'one', values: { name: '未归类', status: '', date: '' } },
        { id: 'two', values: { name: '发布', status: '已完成', date: '2026-08-26' } },
      ],
    }
    const wrapper = mountStructured('DATABASE', content)

    expect(wrapper.find('[data-testid="public-database-kanban"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('未分组')
    expect(wrapper.text()).toContain('未归类')
    expect(wrapper.find('[data-testid="public-database-table"]').exists()).toBe(false)

    await wrapper.setProps({ content: { ...content, activeViewId: 'gallery' } })
    expect(wrapper.find('[data-testid="public-database-gallery"]').exists()).toBe(true)
    await wrapper.setProps({ content: { ...content, activeViewId: 'calendar' } })
    expect(wrapper.find('[data-testid="public-database-calendar"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('未安排日期')
    expect(wrapper.text()).toContain('2026-08-26')
    await wrapper.setProps({ content: { ...content, activeViewId: 'table' } })
    expect(wrapper.find('[data-testid="public-database-table"]').exists()).toBe(true)
    expect(wrapper.findAll('th')).toHaveLength(1)
  })

  it('renders a view-specific empty state instead of falling back to a table', () => {
    const wrapper = mountStructured('DATABASE', {
      type: 'database', view: 'GALLERY', filter: '', sortFieldId: null,
      fields: [{ id: 'title', name: '标题', type: 'TEXT' }], rows: [],
    })
    expect(wrapper.find('[data-testid="public-database-gallery"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="public-database-table"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('暂无记录')
  })
})
