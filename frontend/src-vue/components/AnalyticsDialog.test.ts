import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AnalyticsReport } from '../../src/types'
import { vuetify } from '../plugins/vuetify'
import { download, post } from '../services/api'
import AnalyticsDialog from './AnalyticsDialog.vue'

vi.mock('../services/api', () => ({
  post: vi.fn(),
  download: vi.fn(),
  messageOf: (value: unknown) => value instanceof Error ? value.message : String(value),
}))

let wrapper: VueWrapper | null = null

beforeEach(() => {
  vi.mocked(post).mockReset()
  vi.mocked(download).mockReset()
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
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('AnalyticsDialog', () => {
  it('loads a report, switches the trend metric and exports the complete range', async () => {
    const value = report()
    vi.mocked(post).mockResolvedValue(value)
    vi.mocked(download).mockResolvedValue(undefined)

    wrapper = mount(AnalyticsDialog, {
      attachTo: document.body,
      props: { modelValue: true, pageId: 'page-1', title: '文稿统计' },
      global: { plugins: [vuetify] },
    })
    await flushPromises()

    expect(vi.mocked(post)).toHaveBeenCalledWith('/api/v1/analytics/page', expect.objectContaining({ pageId: 'page-1' }))
    expect(document.body.textContent).toContain('文稿统计')
    expect(document.body.querySelectorAll('.metric-tab')).toHaveLength(7)

    const comments = buttonWithText('评论', '.metric-tab')
    comments.click()
    await flushPromises()
    expect(comments.classList.contains('active')).toBe(true)
    expect(document.body.querySelector('.chart-heading')?.textContent).toContain('每日评论')

    buttonWithText('导出 CSV', '.analytics-footer button').click()
    await flushPromises()

    expect(vi.mocked(download)).toHaveBeenCalledWith('/api/v1/analytics/page/export', expect.objectContaining({ pageId: 'page-1' }))
    expect(wrapper.emitted('exported')?.[0]?.[0]).toEqual(value)
  })

  it('shows a compact retry state when loading fails', async () => {
    vi.mocked(post).mockRejectedValue(new Error('暂时无法读取数据'))

    wrapper = mount(AnalyticsDialog, {
      attachTo: document.body,
      props: { modelValue: true, knowledgeBaseId: 'kb-1' },
      global: { plugins: [vuetify] },
    })
    await flushPromises()

    const state = document.body.querySelector('.inline-state.error-state')
    expect(state?.textContent).toContain('暂时无法读取数据')
    expect(state?.querySelector('button')?.textContent).toContain('重试')
  })

  it('clears the previous report when the resource changes and the new request fails', async () => {
    vi.mocked(post).mockResolvedValueOnce(report()).mockRejectedValueOnce(new Error('新文稿统计失败'))

    wrapper = mount(AnalyticsDialog, {
      attachTo: document.body,
      props: { modelValue: true, pageId: 'page-1', title: '文稿统计' },
      global: { plugins: [vuetify] },
    })
    await flushPromises()
    expect(document.body.textContent).toContain('18')

    await wrapper.setProps({ pageId: 'page-2' })
    await flushPromises()

    expect(document.body.textContent).toContain('新文稿统计失败')
    expect(document.body.querySelector('.metric-strip')).toBeNull()
    expect(buttonWithText('导出 CSV', '.analytics-footer button').disabled).toBe(true)
  })

  it('does not let a slower report overwrite the latest resource', async () => {
    let resolveFirst!: (value: AnalyticsReport) => void
    const first = new Promise<AnalyticsReport>((resolve) => { resolveFirst = resolve })
    const latest = { ...report(), resourceId: 'page-2', totals: { ...report().totals, views: 42 } }
    vi.mocked(post).mockImplementation(async (_path, body) => (body as { pageId?: string }).pageId === 'page-1' ? first : latest)

    wrapper = mount(AnalyticsDialog, {
      attachTo: document.body,
      props: { modelValue: true, pageId: 'page-1' },
      global: { plugins: [vuetify] },
    })
    await wrapper.setProps({ pageId: 'page-2' })
    await flushPromises()
    expect(document.body.textContent).toContain('42')

    resolveFirst(report())
    await flushPromises()
    expect(document.body.querySelector('.metric-tab strong')?.textContent).toBe('42')
  })
})

function buttonWithText(text: string, selector: string) {
  const button = [...document.body.querySelectorAll<HTMLButtonElement>(selector)].find((item) => item.textContent?.includes(text))
  expect(button, `button containing ${text}`).toBeTruthy()
  return button!
}

function report(): AnalyticsReport {
  return {
    resourceType: 'PAGE',
    resourceId: 'page-1',
    from: '2026-08-20',
    to: '2026-08-21',
    totals: { date: '', views: 18, uniqueViews: 12, edits: 5, comments: 3, shares: 2, exports: 1, reactions: 4 },
    daily: [
      { date: '2026-08-20', views: 7, uniqueViews: 5, edits: 2, comments: 1, shares: 1, exports: 0, reactions: 1 },
      { date: '2026-08-21', views: 11, uniqueViews: 7, edits: 3, comments: 2, shares: 1, exports: 1, reactions: 3 },
    ],
  }
}
