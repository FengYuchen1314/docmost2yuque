// @vitest-environment jsdom

import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { DialogA11y } from './DialogA11y'

function Harness() {
  const [open, setOpen] = useState(false)
  return <><DialogA11y /><button onClick={() => setOpen(true)}>打开设置</button>{open && <div className="dialog-backdrop"><section className="dialog"><div className="dialog-head"><h2>资料设置</h2><button className="icon-button" onClick={() => setOpen(false)} /></div><input autoFocus aria-label="资料名称" /><button>保存</button></section></div>}</>
}

function AlertDialogHarness() {
  return <><DialogA11y /><div className="dialog-backdrop"><section className="dialog" role="alertdialog" aria-label="危险操作"><button>取消</button></section></div></>
}

function ManagedEscapeHarness() {
  const [handled, setHandled] = useState(false)
  return <><DialogA11y /><div className="dialog-backdrop"><section className="dialog" data-dialog-escape="managed"><h2>分级命令</h2><input autoFocus aria-label="命令搜索" />{handled && <span>组件已处理</span>}<button data-dialog-back onClick={() => setHandled(true)}>返回</button><button>关闭</button></section></div></>
}

afterEach(cleanup)

describe('global dialog accessibility', () => {
  it('labels dialogs, traps focus, closes with Escape and restores the trigger', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: '打开设置' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog', { name: '资料设置' })
    const input = screen.getByRole('textbox', { name: '资料名称' })
    const close = screen.getByRole('button', { name: '关闭资料设置' })
    const save = screen.getByRole('button', { name: '保存' })
    await waitFor(() => expect(document.activeElement).toBe(input))
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(document.body.classList.contains('dialog-open')).toBe(true)

    save.focus()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(save)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(trigger))
    expect(document.body.classList.contains('dialog-open')).toBe(false)
  })

  it('preserves an explicit alertdialog role', async () => {
    render(<AlertDialogHarness />)
    const dialog = await screen.findByRole('alertdialog', { name: '危险操作' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('lets a multi-level dialog handle Escape before closing', async () => {
    render(<ManagedEscapeHarness />)
    const input = screen.getByRole('textbox', { name: '命令搜索' })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(await screen.findByText('组件已处理')).toBeTruthy()
    expect(screen.getByRole('dialog', { name: '分级命令' })).toBeTruthy()
  })
})
