import { useEffect, useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, KeyRound, Laptop, LogOut, Mail, MonitorSmartphone, ShieldCheck, Smartphone, UserRound } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { messageOf, post, request, resetCsrf } from '../lib/api'
import type { CurrentUser } from '../types'
import { useConfirmDialog } from '../components/ConfirmDialog'

interface AccountProfile {
  userId: string
  email: string
  displayName: string | null
  status: string
  emailVerifiedAt: string | null
  emailVerificationSource: string | null
  createdAt: string
  updatedAt: string
}

interface AccountSession {
  id: string
  current: boolean
  userAgent: string
  ipAddress: string
  lastSeenAt: string
  createdAt: string
}

function sessionClient(userAgent: string): { browser: string; device: string; mobile: boolean } {
  const mobile = /Android|iPhone|iPad|Mobile/i.test(userAgent)
  const browser = /Edg\//.test(userAgent) ? 'Microsoft Edge' : /Firefox\//.test(userAgent) ? 'Firefox' : /Chrome\//.test(userAgent) ? 'Chrome' : /Safari\//.test(userAgent) ? 'Safari' : /curl\//i.test(userAgent) ? '命令行客户端' : '未知浏览器'
  const device = /iPhone|iPad/.test(userAgent) ? 'iPhone / iPad' : /Android/.test(userAgent) ? 'Android 设备' : /Windows/.test(userAgent) ? 'Windows 设备' : /Macintosh|Mac OS/.test(userAgent) ? 'Mac 设备' : /Linux/.test(userAgent) ? 'Linux 设备' : mobile ? '移动设备' : '桌面设备'
  return { browser, device, mobile }
}

const formatTime = (value: string) => new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value))

export function AccountSettingsPage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const sessionConfirmation = useConfirmDialog()
  const account = useQuery({ queryKey: ['account'], queryFn: () => request<AccountProfile>('/api/v1/account') })
  const sessions = useQuery({ queryKey: ['account-sessions'], queryFn: () => request<AccountSession[]>('/api/v1/account/sessions') })
  const [displayName, setDisplayName] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [passwordChanged, setPasswordChanged] = useState(false)
  useEffect(() => { if (account.data) setDisplayName(account.data.displayName ?? '') }, [account.data])
  const saveProfile = useMutation({
    mutationFn: () => post<AccountProfile>('/api/v1/account/profile', { displayName: displayName.trim() || null }),
    onSuccess: (value) => {
      queryClient.setQueryData(['account'], value)
      queryClient.setQueryData<CurrentUser>(['me'], (current) => current ? { ...current, displayName: value.displayName } : current)
    },
  })
  const changePassword = useMutation({
    mutationFn: () => post<void>('/api/v1/account/password', { currentPassword, newPassword, passwordConfirmation: confirmation }),
    onSuccess: () => { setCurrentPassword(''); setNewPassword(''); setConfirmation(''); setPasswordChanged(true) },
  })
  const revokeSession = useMutation({
    mutationFn: (sessionId: string) => post<void>(`/api/v1/account/sessions/${sessionId}/revoke`, {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-sessions'] }),
  })
  const revokeOthers = useMutation({
    mutationFn: () => post<void>('/api/v1/account/sessions/revoke-others', {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['account-sessions'] }),
  })
  const revokeAll = useMutation({
    mutationFn: () => post<void>('/api/v1/account/sessions/revoke-all', {}),
    onSuccess: () => { resetCsrf(); queryClient.clear(); navigate('/login', { replace: true }) },
  })
  const submit = (event: FormEvent, action: () => void) => { event.preventDefault(); action() }
  return <div className="content-page account-settings-page">
    <header className="page-header"><div><p className="eyebrow">账号与安全</p><h1>账号设置</h1><p>管理显示身份与邮箱账号的登录密码。</p></div><Link className="button secondary small" to="/app/profile"><UserRound />公开主页</Link></header>
    <div className="account-settings-grid">
      <section className="settings-section account-card"><header><span><UserRound /></span><div><h2>个人资料</h2><p>显示名用于空间成员、团队和协作记录。</p></div></header>
        <form className="settings-form" onSubmit={(event) => submit(event, saveProfile.mutate)}>
          <label className="field"><span className="field-label">显示名</span><input value={displayName} onChange={(event) => setDisplayName(event.target.value.slice(0, 200))} placeholder="例如：林静" /><small>可留空，留空时系统使用邮箱识别你。</small></label>
          <div className="account-email-row"><span><Mail /></span><div><small>登录邮箱</small><strong>{account.data?.email ?? '正在读取…'}</strong></div><i><CheckCircle2 />{account.data?.emailVerifiedAt ? '已验证' : '待验证'}</i></div>
          {saveProfile.error && <div className="form-error">{messageOf(saveProfile.error)}</div>}
          <div className="settings-actions"><small>邮箱是唯一账号名，当前不允许自助更换。</small><button className="button primary small" disabled={account.isPending || saveProfile.isPending}>{saveProfile.isPending ? '正在保存…' : '保存资料'}</button></div>
        </form>
      </section>
      <section className="settings-section account-card"><header><span><ShieldCheck /></span><div><h2>修改密码</h2><p>先验证当前密码，再为账号设置新密码。</p></div></header>
        <form className="settings-form" onSubmit={(event) => submit(event, changePassword.mutate)} onChange={() => setPasswordChanged(false)}>
          <label className="field"><span className="field-label">当前密码</span><input type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required /></label>
          <div className="settings-form-row"><label className="field"><span className="field-label">新密码</span><input type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} minLength={12} required /><small>至少 12 位</small></label><label className="field"><span className="field-label">确认新密码</span><input type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></label></div>
          {(changePassword.error || newPassword && confirmation && newPassword !== confirmation) && <div className="form-error">{changePassword.error ? messageOf(changePassword.error) : '两次输入的新密码不一致'}</div>}
          {passwordChanged && <div className="account-success"><CheckCircle2 />密码已更新，下次登录请使用新密码。</div>}
          <div className="settings-actions"><small><KeyRound />如果忘记当前密码，请退出后使用邮箱验证码重置。</small><button className="button primary small" disabled={!currentPassword || newPassword.length < 12 || newPassword !== confirmation || changePassword.isPending}>{changePassword.isPending ? '正在更新…' : '更新密码'}</button></div>
        </form>
      </section>
      <section className="settings-section account-card account-session-card"><header><span><MonitorSmartphone /></span><div><h2>登录设备</h2><p>查看仍可访问账号的设备，发现异常时可以立即撤销。</p></div><button className="button secondary small" disabled={(sessions.data?.length ?? 0) < 2 || revokeOthers.isPending} onClick={() => sessionConfirmation.confirm({ title: '退出其他所有设备', description: '当前设备保持登录，其他设备的会话将立即失效。', confirmLabel: '退出其他设备' }, () => revokeOthers.mutate())}>{revokeOthers.isPending ? '正在处理…' : '退出其他设备'}</button></header>
        <div className="account-session-list">
          {sessions.isPending && <div className="settings-empty">正在读取登录设备…</div>}
          {sessions.error && <div className="form-error">{messageOf(sessions.error)}</div>}
          {sessions.data?.map((session) => { const client = sessionClient(session.userAgent); const Icon = client.mobile ? Smartphone : Laptop; return <article className="account-session-row" key={session.id}>
            <span className="account-session-icon"><Icon /></span>
            <div className="account-session-main"><strong>{client.browser} · {client.device}{session.current && <i>当前设备</i>}</strong><p>{session.ipAddress} · 最近活动于 {formatTime(session.lastSeenAt)}</p><small title={session.userAgent}>登录于 {formatTime(session.createdAt)}</small></div>
            {session.current ? <span className="account-session-safe"><ShieldCheck />使用中</span> : <button className="button ghost danger small" disabled={revokeSession.isPending} onClick={() => sessionConfirmation.confirm({ title: `退出 ${client.browser} · ${client.device}`, description: '该设备的会话将立即失效，需要重新登录。', confirmLabel: '退出该设备' }, () => revokeSession.mutate(session.id))}><LogOut />退出</button>}
          </article> })}
          {sessions.data?.length === 0 && <div className="settings-empty">暂无活动登录设备。</div>}
        </div>
        {(revokeSession.error || revokeOthers.error || revokeAll.error) && <div className="form-error account-session-error">{messageOf(revokeSession.error || revokeOthers.error || revokeAll.error)}</div>}
        <footer className="account-session-footer"><div><strong>退出全部设备</strong><p>包括当前设备在内的全部会话会立即失效，需要重新登录。</p></div><button className="button danger small" disabled={revokeAll.isPending} onClick={() => sessionConfirmation.confirm({ title: '退出全部设备', description: '包括当前设备在内的全部会话会立即失效，完成后将返回登录页。', confirmLabel: '退出全部设备' }, () => revokeAll.mutate())}><LogOut />{revokeAll.isPending ? '正在退出…' : '退出全部设备'}</button></footer>
      </section>
    </div>
    {sessionConfirmation.dialog}
  </div>
}
