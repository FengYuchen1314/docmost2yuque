import type { SensitiveCardEnvelope } from '../../types/content-card'

const DEFAULT_ITERATIONS = 210_000

export async function encryptSensitiveCard(
  plaintext: string,
  password: string,
  hint = '',
): Promise<SensitiveCardEnvelope> {
  if (!plaintext || plaintext.length > 20_000) throw new Error('敏感内容必须为 1–20000 个字符')
  if (password.length < 8 || password.length > 200) throw new Error('查看密码必须为 8–200 个字符')
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持浏览器本地加密')

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    ciphertext: encodeBytes(new Uint8Array(encrypted)),
    salt: encodeBytes(salt),
    iv: encodeBytes(iv),
    kdf: 'PBKDF2-SHA256',
    iterations: DEFAULT_ITERATIONS,
    ...(hint.trim() ? { hint: hint.trim().slice(0, 200) } : {}),
  }
}

export async function decryptSensitiveCard(
  value: Record<string, unknown>,
  password: string,
): Promise<string> {
  const envelope = parseSensitiveEnvelope(value)
  if (!globalThis.crypto?.subtle) throw new Error('当前环境不支持浏览器本地解密')
  try {
    const salt = decodeBytes(envelope.salt)
    const iv = decodeBytes(envelope.iv)
    const key = await deriveKey(password, salt, envelope.iterations, ['decrypt'])
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      decodeBytes(envelope.ciphertext),
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(decrypted)
  } catch {
    throw new Error('密码错误或内容已损坏')
  }
}

export function isSensitiveCardEnvelope(value: Record<string, unknown>): boolean {
  try { parseSensitiveEnvelope(value); return true } catch { return false }
}

function parseSensitiveEnvelope(value: Record<string, unknown>): SensitiveCardEnvelope {
  const ciphertext = validBase64Url(value.ciphertext, 23, 90_000)
  const salt = validBase64Url(value.salt, 22, 22)
  const iv = validBase64Url(value.iv, 16, 16)
  const iterations = typeof value.iterations === 'number' ? value.iterations : 0
  if (
    value.kdf !== 'PBKDF2-SHA256'
    || !Number.isInteger(iterations)
    || iterations < 100_000
    || iterations > 1_000_000
  ) throw new Error('敏感卡加密参数无效')

  const ciphertextBytes = decodeBytes(ciphertext)
  if (
    ciphertextBytes.length < 17
    || ciphertextBytes.length > 65_536
    || decodeBytes(salt).length !== 16
    || decodeBytes(iv).length !== 12
  ) throw new Error('敏感卡加密参数无效')

  const hint = typeof value.hint === 'string' ? value.hint.slice(0, 200) : undefined
  return { ciphertext, salt, iv, kdf: 'PBKDF2-SHA256', iterations, ...(hint ? { hint } : {}) }
}

async function deriveKey(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usages: KeyUsage[],
) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    usages,
  )
}

function validBase64Url(value: unknown, minimum: number, maximum: number): string {
  if (
    typeof value !== 'string'
    || value.length < minimum
    || value.length > maximum
    || !/^[A-Za-z0-9_-]+$/.test(value)
  ) throw new Error('敏感卡密文无效')
  return value
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
