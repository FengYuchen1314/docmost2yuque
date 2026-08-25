import { afterEach, describe, expect, it, vi } from 'vitest'
import { copyText } from './utils'

const originalExecCommand = Object.getOwnPropertyDescriptor(document, 'execCommand')

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  if (originalExecCommand) Object.defineProperty(document, 'execCommand', originalExecCommand)
  else Reflect.deleteProperty(document, 'execCommand')
})

describe('copyText', () => {
  it('falls back to a selected textarea when Clipboard API rejects an HTTP origin', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('NotAllowedError'))
    const execCommand = vi.fn(() => true)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand })

    await copyText('需要复制的内容')

    expect(writeText).toHaveBeenCalledWith('需要复制的内容')
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.querySelector('textarea')).toBeNull()
  })
})
