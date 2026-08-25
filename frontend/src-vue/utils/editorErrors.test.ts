import { describe, expect, it } from 'vitest'
import { clearSuccessfulSaveError, editorErrorMessage, type EditorOperationErrors } from './editorErrors'

describe('editor operation errors', () => {
  it('clears a stale save error after a successful save', () => {
    const errors: EditorOperationErrors = { load: '', save: '保存失败' }
    clearSuccessfulSaveError(errors)
    expect(editorErrorMessage(errors)).toBe('')
  })

  it('never clears an independent load error when a save succeeds', () => {
    const errors: EditorOperationErrors = { load: '文档加载失败', save: '保存失败' }
    clearSuccessfulSaveError(errors)
    expect(errors).toEqual({ load: '文档加载失败', save: '' })
    expect(editorErrorMessage(errors)).toBe('文档加载失败')
  })
})
