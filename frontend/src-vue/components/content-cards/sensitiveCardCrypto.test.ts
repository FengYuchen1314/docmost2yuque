import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  decryptSensitiveCard,
  encryptSensitiveCard,
  isSensitiveCardCryptoAvailable,
  isSensitiveCardEnvelope,
  SENSITIVE_CARD_HTTPS_MESSAGE,
} from './sensitiveCardCrypto'

const envelope = {
  ciphertext: 'A'.repeat(23),
  salt: 'A'.repeat(22),
  iv: 'A'.repeat(16),
  kdf: 'PBKDF2-SHA256',
  iterations: 210_000,
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('sensitive card crypto capability', () => {
  it('keeps an existing envelope readable as data while refusing insecure crypto operations', async () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes })

    expect(isSensitiveCardCryptoAvailable()).toBe(false)
    expect(isSensitiveCardEnvelope(envelope)).toBe(true)
    await expect(encryptSensitiveCard('机密内容', 'password-123')).rejects.toThrow(SENSITIVE_CARD_HTTPS_MESSAGE)
    await expect(decryptSensitiveCard(envelope, 'password-123')).rejects.toThrow(SENSITIVE_CARD_HTTPS_MESSAGE)
  })
})
