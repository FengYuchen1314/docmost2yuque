import { useState } from 'react'
import { Eye, EyeOff, LoaderCircle, LockKeyhole } from 'lucide-react'
import { decryptSensitiveText, isSensitiveTextEnvelope } from '../lib/sensitiveText'

export function SensitiveTextCard({ data }: { data: Record<string, unknown> }) {
  const [password, setPassword] = useState('')
  const [plaintext, setPlaintext] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = isSensitiveTextEnvelope(data)
  const reveal = async () => {
    if (!password || pending || !valid) return
    setPending(true)
    setError(null)
    try { setPlaintext(await decryptSensitiveText(data, password)); setPassword('') }
    catch (reason) { setError(reason instanceof Error ? reason.message : '无法解密') }
    finally { setPending(false) }
  }
  if (plaintext != null) return <article className="content-card sensitive-card revealed"><LockKeyhole /><div><strong>{typeof data.hint === 'string' && data.hint ? data.hint : '敏感内容'}</strong><pre>{plaintext}</pre><button type="button" className="button quiet small" onClick={() => setPlaintext(null)}><EyeOff />重新隐藏</button></div></article>
  return <article className="content-card sensitive-card"><LockKeyhole /><div><strong>受保护的敏感内容</strong><p>{typeof data.hint === 'string' && data.hint ? data.hint : '输入密码后在本机解密'}</p>{valid ? <form onSubmit={(event) => { event.preventDefault(); void reveal() }}><input aria-label="敏感内容查看密码" type="password" value={password} minLength={8} maxLength={200} onChange={(event) => setPassword(event.target.value)} placeholder="查看密码" autoComplete="off" /><button className="button secondary small" disabled={pending || password.length < 8}>{pending ? <LoaderCircle className="spin" /> : <Eye />}查看</button></form> : <div className="inline-error">加密数据无效</div>}{error && <div className="inline-error" role="alert">{error}</div>}</div></article>
}
