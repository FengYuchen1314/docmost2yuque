/**
 * Creates an RFC 4122 version 4 UUID in secure and non-secure browser contexts.
 *
 * `Crypto.randomUUID()` is restricted to secure contexts in some browsers, while
 * `Crypto.getRandomValues()` remains available on ordinary HTTP origins. The
 * latter is therefore the primary compatibility path. The final path is only
 * for very old/test runtimes without Web Crypto; it combines per-call random
 * bytes, wall/high-resolution time and a process-local counter to keep IDs
 * collision-resistant, but must not be treated as cryptographic key material.
 */
let fallbackCounter = initialCounter()

export function createUuid(): string {
  const runtimeCrypto = globalThis.crypto

  if (typeof runtimeCrypto?.randomUUID === 'function') {
    try {
      return runtimeCrypto.randomUUID()
    } catch {
      // Some embedded browsers expose the method but reject it on HTTP origins.
    }
  }

  const bytes = new Uint8Array(16)
  if (typeof runtimeCrypto?.getRandomValues === 'function') {
    try {
      runtimeCrypto.getRandomValues(bytes)
      return formatUuidV4(bytes)
    } catch {
      // Continue with the compatibility generator for incomplete WebViews.
    }
  }

  fillCompatibilityEntropy(bytes)
  return formatUuidV4(bytes)
}

function formatUuidV4(bytes: Uint8Array): string {
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function fillCompatibilityEntropy(bytes: Uint8Array) {
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = randomByte()
  }

  fallbackCounter = (fallbackCounter + 1) >>> 0
  mixNumber(bytes, Date.now(), 0, 6)
  mixNumber(bytes, highResolutionTimestamp(), 6, 6)
  mixNumber(bytes, fallbackCounter, 12, 4)
}

function mixNumber(bytes: Uint8Array, value: number, offset: number, length: number) {
  let remaining = Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
  for (let index = 0; index < length; index += 1) {
    const target = (offset + index) % bytes.length
    bytes[target] = bytes[target]! ^ (remaining % 256)
    remaining = Math.floor(remaining / 256)
  }
}

function randomByte(): number {
  try {
    return Math.floor(Math.random() * 256) & 0xff
  } catch {
    return 0
  }
}

function highResolutionTimestamp(): number {
  try {
    const clock = globalThis.performance
    if (clock) return (clock.timeOrigin + clock.now()) * 1_000
  } catch {
    // Date.now() and the counter still provide process-local uniqueness.
  }
  return Date.now() * 1_000
}

function initialCounter(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0x1_0000_0000)) >>> 0
}
