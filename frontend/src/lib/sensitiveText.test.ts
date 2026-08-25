import { describe, expect, it } from 'vitest'
import { decryptSensitiveText, encryptSensitiveText, isSensitiveTextEnvelope } from './sensitiveText'

describe('sensitive text encryption', () => {
  it('round-trips Unicode plaintext and rejects a wrong password', async () => {
    const envelope = await encryptSensitiveText('仅限团队：密钥轮换时间 18:00', 'Strong-Password-2026!')
    expect(isSensitiveTextEnvelope(envelope)).toBe(true)
    expect(JSON.stringify(envelope)).not.toContain('密钥轮换')
    await expect(decryptSensitiveText(envelope, 'Strong-Password-2026!')).resolves.toBe('仅限团队：密钥轮换时间 18:00')
    await expect(decryptSensitiveText(envelope, 'wrong-password')).rejects.toThrow('密码错误或内容已损坏')
  })
})
