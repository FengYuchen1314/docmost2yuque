// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmbeddedDatabaseEditor, FirstClassEditor } from './FirstClassEditors'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('first-class empty editor compatibility', () => {
  it('normalizes the legacy empty whiteboard returned by the page API', () => {
    const changed = vi.fn()
    const legacy = { type: 'whiteboard', content: [] }

    render(<FirstClassEditor page={{ contentType: 'WHITEBOARD', content: legacy } as never} value={JSON.stringify(legacy)} onChange={changed} />)

    expect(screen.getByText('无限画布')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '添加便签' }))
    const next = JSON.parse(changed.mock.calls.at(-1)?.[0] as string) as { viewport: unknown; elements: unknown[] }
    expect(next.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(next.elements).toHaveLength(1)
  })
})

describe('first-class database form settings', () => {
  it('selects exposed and required fields while excluding computed fields', () => {
    const onChange = vi.fn()
    render(<EmbeddedDatabaseEditor data={{
      type: 'database', view: 'TABLE', filter: '', sortFieldId: null, rows: [],
      fields: [
        { id: 'name', name: '名称', type: 'TEXT' },
        { id: 'email', name: '邮箱', type: 'EMAIL' },
        { id: 'total', name: '合计', type: 'FORMULA', formula: '{名称}' },
      ],
    }} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: '表单' }))
    fireEvent.click(screen.getByRole('checkbox', { name: /开放公开提交/ }))
    fireEvent.change(screen.getByLabelText('表单标题'), { target: { value: '报名登记' } })
    const nameRow = screen.getByText('名称').closest('div')!
    fireEvent.click(nameRow.querySelectorAll('input[type="checkbox"]')[1]!)
    expect(screen.queryByText('合计')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '保存表单设置' }))

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      form: expect.objectContaining({ enabled: true, title: '报名登记', fieldIds: ['name', 'email'], requiredFieldIds: ['name'] }),
    }))
  })

  it('keeps filter, sort, grouping and visible fields independent per saved view', () => {
    const changed = vi.fn()
    render(<DatabaseHarness onChange={changed} />)
    const filter = () => screen.getByPlaceholderText('筛选当前视图') as HTMLInputElement

    expect(filter().value).toBe('首页')
    fireEvent.change(filter(), { target: { value: '登录' } })
    fireEvent.click(screen.getByRole('button', { name: '研发看板' }))
    expect(filter().value).toBe('进行中')
    fireEvent.change(filter(), { target: { value: '已完成' } })
    fireEvent.click(screen.getByRole('button', { name: '任务表格' }))
    expect(filter().value).toBe('登录')

    fireEvent.click(screen.getByTitle('配置当前视图'))
    fireEvent.click(screen.getByRole('checkbox', { name: /状态/ }))
    fireEvent.click(screen.getByRole('button', { name: '保存视图' }))

    const latest = changed.mock.calls.at(-1)?.[0] as { views: Array<Record<string, unknown>>; activeViewId: string; filter: string }
    expect(latest.views).toEqual([
      expect.objectContaining({ id: 'table', filter: '登录', visibleFieldIds: ['name'] }),
      expect.objectContaining({ id: 'kanban', filter: '已完成', groupFieldId: 'status', visibleFieldIds: ['name', 'status'] }),
    ])
    expect(latest.activeViewId).toBe('table')
    expect(latest.filter).toBe('登录')
  })
})

describe('first-class spreadsheet controls', () => {
  it('persists freeze, hide, protection, dropdown and number-format settings', () => {
    const changed = vi.fn()
    render(<SpreadsheetHarness onChange={changed} />)

    fireEvent.click(screen.getByRole('button', { name: '冻结首列' }))
    fireEvent.click(screen.getByRole('button', { name: '保护单元格' }))
    fireEvent.click(screen.getByRole('button', { name: '下拉选项' }))
    fireEvent.change(screen.getByRole('textbox', { name: '选项' }), { target: { value: '待处理, 已完成' } })
    fireEvent.click(screen.getByRole('button', { name: '保存选项' }))
    fireEvent.change(screen.getByLabelText('数字格式'), { target: { value: 'CURRENCY' } })
    fireEvent.click(screen.getByRole('button', { name: '隐藏当前行' }))

    const latest = JSON.parse(changed.mock.calls.at(-1)?.[0] as string) as { sheets: Array<Record<string, unknown>> }
    expect(latest.sheets[0]).toEqual(expect.objectContaining({
      frozenColumns: 1,
      hiddenRows: [0],
      protectedCells: ['0:0'],
      dropdowns: { '0:0': ['待处理', '已完成'] },
      styles: { '0:0': expect.objectContaining({ numberFormat: 'CURRENCY' }) },
    }))
  })

  it('edits filtering and sheet names without native browser prompts', () => {
    const changed = vi.fn()
    render(<SpreadsheetHarness onChange={changed} />)

    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.change(screen.getByRole('textbox', { name: '包含条件' }), { target: { value: '待处理' } })
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    fireEvent.doubleClick(screen.getByRole('button', { name: '计划' }))
    fireEvent.change(screen.getByRole('textbox', { name: '工作表名称' }), { target: { value: '项目计划' } })
    fireEvent.click(screen.getByRole('button', { name: '保存名称' }))

    const latest = JSON.parse(changed.mock.calls.at(-1)?.[0] as string) as { sheets: Array<{ name: string; filter: string }> }
    expect(latest.sheets[0]).toEqual(expect.objectContaining({ name: '项目计划', filter: '待处理' }))
  })
})

function DatabaseHarness({ onChange }: { onChange: (value: Record<string, unknown>) => void }) {
  const [data, setData] = useState<Record<string, unknown>>({
    type: 'database', view: 'TABLE', filter: '首页', sortFieldId: 'name', activeViewId: 'table',
    fields: [{ id: 'name', name: '名称', type: 'TEXT' }, { id: 'status', name: '状态', type: 'SELECT', options: ['进行中', '已完成'] }],
    rows: [{ id: 'row', values: { name: '首页', status: '进行中' }, createdAt: '2026-08-25T00:00:00Z' }],
    views: [
      { id: 'table', name: '任务表格', type: 'TABLE', filter: '首页', sortFieldId: 'name', groupFieldId: null, visibleFieldIds: ['name', 'status'] },
      { id: 'kanban', name: '研发看板', type: 'KANBAN', filter: '进行中', sortFieldId: null, groupFieldId: 'status', visibleFieldIds: ['name', 'status'] },
    ],
  })
  return <EmbeddedDatabaseEditor data={data} onChange={(value) => { setData(value); onChange(value) }} />
}

function SpreadsheetHarness({ onChange }: { onChange: (value: string) => void }) {
  const content = { type: 'workbook', activeSheetId: 'sheet', sheets: [{ id: 'sheet', name: '计划', rows: [['状态', '金额'], ['待处理', '100']], styles: {}, frozenRows: 0, filter: '' }] }
  const [value, setValue] = useState(() => JSON.stringify(content))
  return <FirstClassEditor page={{ contentType: 'SPREADSHEET', content } as never} value={value} onChange={(next) => { setValue(next); onChange(next) }} />
}
