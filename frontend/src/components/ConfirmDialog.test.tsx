// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

function Harness({ action }: { action: () => void }) {
  const confirmation = useConfirmDialog()
  return <><button onClick={() => confirmation.confirm({ title: '删除文稿', description: '文稿将进入回收站。', confirmLabel: '确认删除' }, action)}>打开确认</button>{confirmation.dialog}</>
}

it('runs a destructive action only after explicit in-app confirmation', () => {
  const action = vi.fn()
  render(<Harness action={action} />)
  fireEvent.click(screen.getByRole('button', { name: '打开确认' }))
  const dialog = screen.getByRole('alertdialog', { name: '删除文稿' })
  expect(dialog.textContent).toContain('文稿将进入回收站')
  expect(action).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
  expect(action).toHaveBeenCalledOnce()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

it('cancels without running the pending action', () => {
  const action = vi.fn()
  render(<Harness action={action} />)
  fireEvent.click(screen.getByRole('button', { name: '打开确认' }))
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(action).not.toHaveBeenCalled()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})
