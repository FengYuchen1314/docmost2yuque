// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TextEntryDialog } from './TextEntryDialog'

afterEach(cleanup)

describe('text entry dialog', () => {
  it('trims and submits a valid value', () => {
    const onSubmit = vi.fn()
    render(<TextEntryDialog title="重命名" label="名称" initialValue=" 旧名称 " onSubmit={onSubmit} onClose={() => undefined} />)

    fireEvent.change(screen.getByRole('textbox', { name: '名称' }), { target: { value: '  新名称  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    expect(onSubmit).toHaveBeenCalledWith('新名称')
  })

  it('shows validation feedback and permits an intentional empty value', () => {
    const onSubmit = vi.fn()
    const { rerender } = render(<TextEntryDialog title="地址" label="链接" validate={(value) => value.startsWith('https://') ? null : '仅支持 HTTPS'} onSubmit={onSubmit} onClose={() => undefined} />)
    fireEvent.change(screen.getByRole('textbox', { name: '链接' }), { target: { value: 'http://example.com' } })
    expect(screen.getByRole('alert').textContent).toBe('仅支持 HTTPS')
    expect((screen.getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true)

    rerender(<TextEntryDialog key="filter" title="筛选" label="关键词" allowEmpty onSubmit={onSubmit} onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSubmit).toHaveBeenCalledWith('')
  })
})
