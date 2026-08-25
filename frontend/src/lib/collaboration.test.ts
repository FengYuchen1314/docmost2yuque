import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { encodeFrame, replaceSharedText } from './collaboration'

describe('collaboration protocol', () => {
  it('prefixes binary payloads with the frame kind', () => {
    expect([...encodeFrame(2, new Uint8Array([7, 8]))]).toEqual([2, 7, 8])
  })

  it('applies a minimal shared-text edit that survives Yjs replication', () => {
    const source = new Y.Doc()
    const text = source.getText('content')
    replaceSharedText(source, text, 'hello world')
    replaceSharedText(source, text, 'hello shared world')
    const target = new Y.Doc()
    Y.applyUpdate(target, Y.encodeStateAsUpdate(source))
    expect(target.getText('content').toString()).toBe('hello shared world')
  })
})
