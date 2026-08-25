export interface SensitiveTextEnvelope extends Record<string, unknown> {
  ciphertext: string
  salt: string
  iv: string
  kdf: 'PBKDF2-SHA256'
  iterations: number
}

const DEFAULT_ITERATIONS = 210_000

export async function encryptSensitiveText(plaintext: string, password: string): Promise<SensitiveTextEnvelope> {
  if (!plaintext || plaintext.length > 20_000) throw new Error('敏感文字必须为 1–20000 个字符')
  if (password.length < 8 || password.length > 200) throw new Error('查看密码必须为 8–200 个字符')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await deriveKey(password, salt, DEFAULT_ITERATIONS, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { ciphertext: encodeBytes(new Uint8Array(ciphertext)), salt: encodeBytes(salt), iv: encodeBytes(iv), kdf: 'PBKDF2-SHA256', iterations: DEFAULT_ITERATIONS }
}

export async function decryptSensitiveText(envelope: Record<string, unknown>, password: string): Promise<string> {
  const parsed = parseEnvelope(envelope)
  try {
    const salt = decodeBytes(parsed.salt)
    const iv = decodeBytes(parsed.iv)
    const key = await deriveKey(password, salt, parsed.iterations, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, decodeBytes(parsed.ciphertext))
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    throw new Error('密码错误或内容已损坏')
  }
}

export function isSensitiveTextEnvelope(value: Record<string, unknown>): boolean {
  try { parseEnvelope(value); return true } catch { return false }
}

function parseEnvelope(value: Record<string, unknown>): SensitiveTextEnvelope {
  const ciphertext = base64Url(value.ciphertext, 23, 90_000)
  const salt = base64Url(value.salt, 22, 22)
  const iv = base64Url(value.iv, 16, 16)
  const iterations = typeof value.iterations === 'number' ? value.iterations : 0
  if (value.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000) throw new Error('敏感文字加密参数无效')
  const ciphertextBytes = decodeBytes(ciphertext)
  if (ciphertextBytes.length < 17 || ciphertextBytes.length > 65_536 || decodeBytes(salt).length !== 16 || decodeBytes(iv).length !== 12) throw new Error('敏感文字加密参数无效')
  return { ciphertext, salt, iv, kdf: 'PBKDF2-SHA256', iterations }
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, usages: KeyUsage[]) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, usages)
}

function base64Url(value: unknown, minimum: number, maximum: number) {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('敏感文字密文无效')
  return value
}

function encodeBytes(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBytes(value: string) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)
  const binary = atob(padded)
  return Uint8Array.from(binary, (character) => character.charCodeAt(0))
}
