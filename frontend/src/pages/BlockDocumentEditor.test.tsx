// @vitest-environment jsdom

import { createRef, useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { encodeContentCardToken, parseContentCardTokens } from '../lib/contentCards'
import { BlockDocumentEditor, type BlockDocumentEditorHandle } from './BlockDocumentEditor'

afterEach(cleanup)

describe('block document editor', () => {
  it('maps markdown lines to typed blocks and preserves serialization', () => {
    const onChange = vi.fn()
    render(<BlockDocumentEditor value={'# 标题\n正文'} onChange={onChange} onBlur={() => undefined} onSlash={() => undefined} onSelection={() => undefined} />)
    expect((screen.getByLabelText('块类型') as HTMLSelectElement).value).toBe('H1')
    expect((screen.getByLabelText('文稿块 1') as HTMLTextAreaElement).value).toBe('标题')

    fireEvent.change(screen.getByLabelText('文稿块 1'), { target: { value: '新标题' } })
    expect(onChange).toHaveBeenLastCalledWith('# 新标题\n正文')
  })

  it('inserts a card token at the active cursor through its editor handle', () => {
    const onChange = vi.fn()
    const ref = createRef<BlockDocumentEditorHandle>()
    render(<BlockDocumentEditor ref={ref} value="段落/" onChange={onChange} onBlur={() => undefined} onSlash={() => undefined} onSelection={() => undefined} />)
    const editor = screen.getByLabelText('文稿块 1') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(3, 3)
    ref.current?.insertText('{{card:test}}', true)
    expect(onChange).toHaveBeenLastCalledWith('段落\n{{card:test}}\n')
  })

  it('opens slash commands and supports enter block splitting', () => {
    const onChange = vi.fn()
    const onSlash = vi.fn()
    render(<BlockDocumentEditor value="第一段" onChange={onChange} onBlur={() => undefined} onSlash={onSlash} onSelection={() => undefined} />)
    const editor = screen.getByLabelText('文稿块 1') as HTMLTextAreaElement
    fireEvent.change(editor, { target: { value: '第一段 /' } })
    expect(onSlash).toHaveBeenCalledOnce()
    editor.setSelectionRange(2, 2)
    fireEvent.keyDown(editor, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('第一\n段')
  })

  it('inserts a validated HTTPS link through the site dialog', () => {
    render(<EditorHarness initial="第一段" />)
    const editor = screen.getByLabelText('文稿块 1') as HTMLTextAreaElement
    editor.focus()
    editor.setSelectionRange(0, 2)
    fireEvent.keyDown(editor, { key: 'k', ctrlKey: true })

    expect(screen.getByRole('dialog', { name: '插入链接' })).toBeTruthy()
    const input = screen.getByRole('textbox', { name: '链接地址' })
    fireEvent.change(input, { target: { value: 'https://user@example.com/private' } })
    expect(screen.getByRole('alert').textContent).toContain('有效的 HTTPS')
    fireEvent.change(input, { target: { value: 'https://example.com/docs' } })
    fireEvent.click(screen.getByRole('button', { name: '插入链接' }))

    expect(screen.getByTestId('serialized').textContent).toBe('[第一](https://example.com/docs)段')
  })

  it('selects a continuous range and supports batch conversion, movement, deletion and undo', () => {
    render(<EditorHarness initial={'甲\n乙\n丙'} />)
    const handles = screen.getAllByRole('button', { name: /选择并拖动第/ })
    fireEvent.click(handles[1]!)
    fireEvent.click(handles[2]!, { shiftKey: true })
    expect(screen.getByText('已选择 2 个块 · 可批量转换、移动或删除')).toBeTruthy()

    fireEvent.change(screen.getByLabelText('块类型'), { target: { value: 'QUOTE' } })
    expect(screen.getByTestId('serialized').textContent).toBe('甲\n> 乙\n> 丙')
    fireEvent.click(screen.getByTitle('上移所选块'))
    expect(screen.getByTestId('serialized').textContent).toBe('> 乙\n> 丙\n甲')
    fireEvent.click(screen.getByTitle('撤销（Ctrl+Z）'))
    expect(screen.getByTestId('serialized').textContent).toBe('甲\n> 乙\n> 丙')

    const refreshedHandles = screen.getAllByRole('button', { name: /选择并拖动第/ })
    fireEvent.click(refreshedHandles[1]!)
    fireEvent.click(refreshedHandles[2]!, { shiftKey: true })
    fireEvent.click(screen.getByTitle('删除所选块'))
    expect(screen.getByTestId('serialized').textContent).toBe('甲')
  })

  it('builds a collapsible outline and focuses the selected heading', () => {
    render(<EditorHarness initial={'# 第一章\n正文\n## 第二节'} />)
    expect(screen.getByRole('navigation', { name: '文稿大纲' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '第二节' }))
    expect(document.activeElement).toBe(screen.getByLabelText('文稿块 3'))
    fireEvent.click(screen.getByRole('button', { name: /大纲/ }))
    expect(screen.queryByRole('navigation', { name: '文稿大纲' })).toBeNull()
  })

  it('turns selected blocks into responsive columns and can unwrap them', () => {
    render(<EditorHarness initial={'左栏\n右栏\n后文'} />)
    const handles = screen.getAllByRole('button', { name: /选择并拖动第/ })
    fireEvent.click(handles[0]!)
    fireEvent.click(handles[1]!, { shiftKey: true })
    fireEvent.click(screen.getByTitle('将所选块分成两栏'))

    const serialized = screen.getByTestId('serialized').textContent ?? ''
    const card = parseContentCardTokens(serialized)[0]
    expect(card?.cardId).toBe('columns')
    expect(card?.data?.columns).toEqual([{ content: '左栏' }, { content: '右栏' }])
    expect(serialized.endsWith('\n后文')).toBe(true)

    fireEvent.click(screen.getByText('分栏'))
    fireEvent.click(screen.getByTitle('解除当前分栏'))
    expect(screen.getByTestId('serialized').textContent).toBe('左栏\n\n右栏\n后文')
  })

  it('uploads a pasted image and inserts its card at the cursor', async () => {
    const token = encodeContentCardToken('image', 1, { url: '/api/v1/attachments/0198fbe0-ae3d-7000-8000-000000000099/content', width: 'LARGE' })
    const onImageFiles = vi.fn().mockResolvedValue([token])
    render(<EditorHarness initial="开头结尾" onImageFiles={onImageFiles} />)
    const editor = screen.getByLabelText('文稿块 1') as HTMLTextAreaElement
    editor.setSelectionRange(2, 2)
    const image = new File(['image'], 'diagram.png', { type: 'image/png' })

    fireEvent.paste(editor, { clipboardData: { files: [image], items: [] } })

    await waitFor(() => expect(screen.getByTestId('serialized').textContent).toBe(`开头\n${token}\n结尾`))
    expect(onImageFiles).toHaveBeenCalledWith([image])
  })

  it('uploads a dropped image before the target block', async () => {
    const token = encodeContentCardToken('image', 1, { url: 'https://cdn.example.com/drop.png', width: 'FULL' })
    const onImageFiles = vi.fn().mockResolvedValue([token])
    render(<EditorHarness initial="目标块" onImageFiles={onImageFiles} />)
    const block = screen.getByLabelText('文稿块 1').closest('.document-block') as HTMLElement
    const image = new File(['image'], 'drop.png', { type: 'image/png' })

    fireEvent.drop(block, { dataTransfer: { files: [image], items: [], types: ['Files'] } })

    await waitFor(() => expect(screen.getByTestId('serialized').textContent).toBe(`${token}\n目标块`))
  })

  it('opens an existing card for editing and replaces it in place', () => {
    const instanceId = '0198fbe0-ae3d-7000-8000-000000000123'
    const original = encodeContentCardToken('image', 1, { url: 'https://cdn.example.com/original.png', width: 'SMALL' }, instanceId)
    const replacement = encodeContentCardToken('image', 1, { url: 'https://cdn.example.com/original.png', width: 'FULL' }, instanceId)
    const onEditCard = vi.fn()
    const onChange = vi.fn()
    const ref = createRef<BlockDocumentEditorHandle>()
    render(<BlockDocumentEditor ref={ref} value={original} onChange={onChange} onBlur={() => undefined} onSlash={() => undefined} onSelection={() => undefined} onEditCard={onEditCard} />)

    fireEvent.click(screen.getByTitle('编辑卡片'))
    expect(onEditCard.mock.calls[0]?.[0].instanceId).toBe(instanceId)
    expect(ref.current?.replaceCard(instanceId, replacement)).toBe(true)
    expect(onChange).toHaveBeenLastCalledWith(replacement)
  })
})

function EditorHarness({ initial, onImageFiles }: { initial: string; onImageFiles?: (files: File[]) => Promise<string[]> }) {
  const [value, setValue] = useState(initial)
  return <><BlockDocumentEditor value={value} onChange={setValue} onBlur={() => undefined} onSlash={() => undefined} onSelection={() => undefined} onImageFiles={onImageFiles} /><output data-testid="serialized">{value}</output></>
}
