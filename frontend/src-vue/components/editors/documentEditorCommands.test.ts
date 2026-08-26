import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_EDITOR_COMMANDS,
  filterDocumentEditorCommands,
  groupDocumentEditorCommands,
} from './documentEditorCommands'

describe('documentEditorCommands', () => {
  it('keeps command ids unique and exposes the four Yuque-style groups in order', () => {
    expect(new Set(DOCUMENT_EDITOR_COMMANDS.map((command) => command.id)).size).toBe(DOCUMENT_EDITOR_COMMANDS.length)
    expect(groupDocumentEditorCommands(DOCUMENT_EDITOR_COMMANDS).map((group) => group.label)).toEqual([
      '基础', '媒体', '内容', '关联',
    ])
  })

  it('searches titles, descriptions, English aliases, and pinyin aliases', () => {
    expect(filterDocumentEditorCommands('图片').map((command) => command.id)).toEqual(['image'])
    expect(filterDocumentEditorCommands('attachment').map((command) => command.id)).toEqual(['attachment'])
    expect(filterDocumentEditorCommands('guanxi').map((command) => command.id)).toEqual(['page-reference'])
  })
})
