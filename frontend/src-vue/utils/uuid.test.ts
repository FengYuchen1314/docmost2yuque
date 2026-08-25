import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from './uuid'

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('createUuid', () => {
  it('prefers the native implementation when it is available', () => {
    const nativeUuid = '123e4567-e89b-42d3-a456-426614174000'
    const randomUUID = vi.fn(() => nativeUuid)
    vi.stubGlobal('crypto', { randomUUID })

    expect(createUuid()).toBe(nativeUuid)
    expect(randomUUID).toHaveBeenCalledOnce()
  })

  it('uses getRandomValues on HTTP-style runtimes without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.forEach((_, index) => { bytes[index] = index + 1 })
      return bytes
    })
    vi.stubGlobal('crypto', { getRandomValues })

    const uuid = createUuid()

    expect(uuid).toMatch(UUID_V4)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('falls back if an exposed native method rejects the current context', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => {
      bytes.fill(0xa5)
      return bytes
    })
    vi.stubGlobal('crypto', {
      randomUUID: vi.fn(() => { throw new TypeError('not allowed in this context') }),
      getRandomValues,
    })

    expect(createUuid()).toMatch(UUID_V4)
    expect(getRandomValues).toHaveBeenCalledOnce()
  })

  it('keeps IDs valid and distinct even when Web Crypto is entirely absent', () => {
    vi.stubGlobal('crypto', undefined)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)

    const ids = Array.from({ length: 256 }, () => createUuid())

    expect(ids.every((id) => UUID_V4.test(id))).toBe(true)
    expect(new Set(ids)).toHaveLength(ids.length)
  })
})
