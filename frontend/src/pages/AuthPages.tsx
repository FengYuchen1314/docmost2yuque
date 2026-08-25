import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { AuthLayout, Field, FormError } from '../components/AuthLayout'
import { messageOf, post, request, resetCsrf } from '../lib/api'
import type { CurrentUser, RegistrationStatus, SetupStatus } from '../types'

interface SetupResult { userId: string; workspaceId: string; email: string }
interface Challenge { challengeId: string }
interface ResolvedInvitation { invitationId: string; workspaceId: string; workspaceName: string; maskedEmail: string; workspaceRole: string; targetTeamIds?: string[]; targetKnowledgeBaseRoles?: Array<{ knowledgeBaseId: string; role: string }>; accountExists: boolean; expiresAt: string }
interface AcceptedInvitation { invitationId: string; workspaceId: string }

export function SetupPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const status = useQuery({ queryKey: ['setup-status'], queryFn: () => request<SetupStatus>('/api/v1/setup/status') })
  const [email, setEmail] = useState('')
  const [workspaceName, setWorkspaceName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const mutation = useMutation({
    mutationFn: () => post<SetupResult>('/api/v1/setup/initialize', {
      email, workspaceName, password, passwordConfirmation: confirmation,
    }, false),
    onSuccess: async () => {
      resetCsrf()
      await queryClient.invalidateQueries()
      navigate('/app', { replace: true })
    },
  })
  if (status.data?.initialized) return <Navigate to="/" replace />
  return (
    <AuthLayout eyebrow="首次部署" title="创建实例管理员" description="第一个完成注册的邮箱将成为实例所有者，无需邮件验证。">
      <form className="auth-form" onSubmit={(event) => submit(event, mutation.mutate)}>
        <Field label="管理员邮箱" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="空间名称" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder="例如：远山工作室" required />
        <Field label="密码" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} hint="至少 12 位，建议使用密码管理器" required minLength={12} />
        <Field label="确认密码" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
        <FormError message={mutation.error ? messageOf(mutation.error) : null} />
        <button className="button primary" disabled={mutation.isPending}>{mutation.isPending ? '正在创建…' : '创建并进入'}</button>
      </form>
    </AuthLayout>
  )
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const returnTo = safeReturnPath((location.state as { from?: string } | null)?.from)
  const registration = useQuery({ queryKey: ['registration-status'], queryFn: () => request<RegistrationStatus>('/api/v1/auth/registration-status') })
  const [mode, setMode] = useState<'password' | 'code'>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeSent, setCodeSent] = useState(false)
  const passwordLogin = useMutation({
    mutationFn: () => post<void>('/api/v1/auth/login/password', { email, password }, false),
    onSuccess: () => finishLogin(queryClient, navigate, returnTo),
  })
  const requestCode = useMutation({
    mutationFn: () => post<void>('/api/v1/auth/login/email-code/request', { email }, false),
    onSuccess: () => setCodeSent(true),
  })
  const verifyCode = useMutation({
    mutationFn: () => post<void>('/api/v1/auth/login/email-code/verify', { email, code }, false),
    onSuccess: () => finishLogin(queryClient, navigate, returnTo),
  })
  const error = passwordLogin.error ?? requestCode.error ?? verifyCode.error
  return (
    <AuthLayout eyebrow="欢迎回来" title="登录知序" description="使用邮箱继续进入你的知识空间。" aside={registration.data?.publicRegistrationEnabled ? <p>还没有账号？<Link to="/register">创建账号</Link></p> : <p>没有账号？请联系管理员获取邀请。</p>}>
      {registration.data?.emailCodeLoginAvailable && (
        <div className="segmented" role="tablist" aria-label="登录方式">
          <button type="button" className={mode === 'password' ? 'active' : ''} onClick={() => setMode('password')}>密码登录</button>
          <button type="button" className={mode === 'code' ? 'active' : ''} onClick={() => setMode('code')}>邮箱验证码</button>
        </div>
      )}
      {mode === 'password' ? (
        <form className="auth-form" onSubmit={(event) => submit(event, passwordLogin.mutate)}>
          <Field label="邮箱" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Field label="密码" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <div className="auth-form-link"><Link to="/forgot-password">忘记密码？</Link></div>
          <FormError message={error ? messageOf(error) : null} />
          <button className="button primary" disabled={passwordLogin.isPending}>{passwordLogin.isPending ? '正在登录…' : '登录'}</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={(event) => submit(event, codeSent ? verifyCode.mutate : requestCode.mutate)}>
          <Field label="邮箱" type="email" autoComplete="email" value={email} disabled={codeSent} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          {codeSent && <Field label="6 位验证码" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required />}
          <FormError message={error ? messageOf(error) : null} />
          <button className="button primary" disabled={requestCode.isPending || verifyCode.isPending}>{codeSent ? '验证并登录' : '发送验证码'}</button>
          {codeSent && <button className="button quiet" type="button" onClick={() => setCodeSent(false)}>更换邮箱</button>}
        </form>
      )}
    </AuthLayout>
  )
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [complete, setComplete] = useState(false)
  const start = useMutation({
    mutationFn: () => post<Challenge>('/api/v1/auth/password-reset/request', { email }, false),
    onSuccess: (challenge) => setChallengeId(challenge.challengeId),
  })
  const finish = useMutation({
    mutationFn: () => post<void>('/api/v1/auth/password-reset/complete', { challengeId, code, password, passwordConfirmation: confirmation }, false),
    onSuccess: () => setComplete(true),
  })
  if (complete) return <AuthLayout eyebrow="密码已更新" title="现在可以重新登录" description="新密码已生效。如果这不是你的操作，请尽快联系实例管理员。"><Link className="button primary" to="/login">返回登录</Link></AuthLayout>
  return <AuthLayout eyebrow="账号恢复" title={challengeId ? '输入验证码并设置新密码' : '重置密码'} description={challengeId ? `如果 ${email} 是有效账号，验证码已发送。` : '输入你的账号邮箱，我们会发送一枚 10 分钟内有效的验证码。'} aside={<p>想起密码了？<Link to="/login">返回登录</Link></p>}>
    {!challengeId ? <form className="auth-form" onSubmit={(event) => submit(event, start.mutate)}>
      <Field label="账号邮箱" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
      <FormError message={start.error ? messageOf(start.error) : null} />
      <button className="button primary" disabled={!email || start.isPending}>{start.isPending ? '正在发送…' : '发送验证码'}</button>
    </form> : <form className="auth-form" onSubmit={(event) => submit(event, finish.mutate)}>
      <Field label="6 位验证码" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
      <Field label="新密码" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="至少 12 位，建议使用密码管理器" minLength={12} required />
      <Field label="确认新密码" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required />
      <FormError message={finish.error ? messageOf(finish.error) : password && confirmation && password !== confirmation ? '两次输入的密码不一致' : null} />
      <button className="button primary" disabled={code.length !== 6 || password.length < 12 || password !== confirmation || finish.isPending}>{finish.isPending ? '正在更新…' : '更新密码'}</button>
      <button className="button quiet" type="button" onClick={() => { setChallengeId(null); setCode(''); setPassword(''); setConfirmation('') }}>更换邮箱</button>
    </form>}
  </AuthLayout>
}

export function RegisterPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const registration = useQuery({ queryKey: ['registration-status'], queryFn: () => request<RegistrationStatus>('/api/v1/auth/registration-status') })
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [challengeId, setChallengeId] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const start = useMutation({
    mutationFn: () => post<Challenge>('/api/v1/auth/register/start', { email, password, passwordConfirmation: confirmation }, false),
    onSuccess: (challenge) => setChallengeId(challenge.challengeId),
  })
  const verify = useMutation({
    mutationFn: () => post('/api/v1/auth/register/verify', { challengeId, code }, false),
    onSuccess: () => finishLogin(queryClient, navigate),
  })
  if (registration.data && !registration.data.publicRegistrationEnabled) return <Navigate to="/login" replace />
  return (
    <AuthLayout eyebrow={challengeId ? '验证邮箱' : '公开注册'} title={challengeId ? '输入邮箱验证码' : '创建你的账号'} description={challengeId ? `验证码已发送至 ${email}` : '账号名称只使用邮箱，验证后会创建个人空间。'} aside={<p>已有账号？<Link to="/login">返回登录</Link></p>}>
      {!challengeId ? (
        <form className="auth-form" onSubmit={(event) => submit(event, start.mutate)}>
          <Field label="邮箱" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          <Field label="密码" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={12} />
          <Field label="确认密码" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required />
          <FormError message={start.error ? messageOf(start.error) : null} />
          <button className="button primary" disabled={start.isPending}>发送验证邮件</button>
        </form>
      ) : (
        <form className="auth-form" onSubmit={(event) => submit(event, verify.mutate)}>
          <Field label="6 位验证码" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} required autoFocus />
          <FormError message={verify.error ? messageOf(verify.error) : null} />
          <button className="button primary" disabled={verify.isPending}>验证并进入</button>
          <button className="button quiet" type="button" onClick={() => setChallengeId(null)}>返回修改邮箱</button>
        </form>
      )}
    </AuthLayout>
  )
}

export function InvitationAcceptPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const me = useQuery({ queryKey: ['me', 'invitation'], queryFn: () => request<CurrentUser>('/api/v1/auth/me'), retry: false })
  const invitation = useQuery({
    queryKey: ['invitation', token],
    queryFn: () => request<ResolvedInvitation>(`/api/v1/invitations/resolve?token=${encodeURIComponent(token)}`),
    enabled: token.length >= 32,
    retry: false,
  })
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const accept = useMutation({
    mutationFn: () => post<AcceptedInvitation>('/api/v1/invitations/accept', {
      token,
      password: invitation.data?.accountExists ? null : password,
      passwordConfirmation: invitation.data?.accountExists ? null : confirmation,
    }, false),
    onSuccess: async (accepted) => {
      resetCsrf()
      await queryClient.invalidateQueries()
      navigate(`/app/w/${accepted.workspaceId}`, { replace: true })
    },
  })
  if (!token || invitation.error) return <AuthLayout eyebrow="邀请无效" title="这个邀请已无法使用" description="邀请可能已过期、被撤销或已经接受。"><Link className="button secondary" to="/login">返回登录</Link></AuthLayout>
  if (invitation.isPending || me.isPending) return <AuthLayout eyebrow="成员邀请" title="正在验证邀请" description="请稍候，我们正在确认邀请状态。"><span className="loading-pulse" /></AuthLayout>
  const value = invitation.data
  if (!value) return null
  const requiresPassword = !value.accountExists
  return <AuthLayout eyebrow="成员邀请" title={`加入「${value.workspaceName}」`} description={`管理员邀请 ${value.maskedEmail} 以${invitationRole(value.workspaceRole)}身份加入。邀请将在 ${formatInvitationTime(value.expiresAt)} 失效。`} aside={<p>这封邀请只绑定邮件中的邮箱，接受后邮箱会直接视为已验证。</p>}>
    <form className="auth-form" onSubmit={(event) => submit(event, accept.mutate)}>
      {requiresPassword && <>
        <Field label="设置密码" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} hint="至少 12 位；以后使用受邀邮箱登录" required minLength={12} />
        <Field label="确认密码" type="password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required minLength={12} />
      </>}
      {value.accountExists && <div className="invitation-account-note">该受邀邮箱已有账号，邀请链接同时完成邮箱归属校验。接受后会进入受邀空间{me.data ? '；如果当前登录的是另一账号，将安全切换到受邀邮箱对应的账号。' : '。'}</div>}
      {Boolean(value.targetTeamIds?.length || value.targetKnowledgeBaseRoles?.length) && <div className="invitation-account-note">接受后还会加入 {value.targetTeamIds?.length ?? 0} 个团队和 {value.targetKnowledgeBaseRoles?.length ?? 0} 个知识库，对应权限由管理员在邀请中预先指定。</div>}
      {requiresPassword && me.data && <div className="invitation-account-note">当前登录账号与这封新邮箱邀请无关。请为受邀邮箱设置密码；接受后会切换到新账号并进入目标空间。</div>}
      <FormError message={accept.error ? messageOf(accept.error) : null} />
      <button className="button primary" disabled={accept.isPending || (requiresPassword && (password.length < 12 || password !== confirmation))}>{accept.isPending ? '正在加入…' : '接受邀请并进入'}</button>
    </form>
  </AuthLayout>
}

function submit(event: FormEvent, action: () => void) {
  event.preventDefault()
  action()
}

async function finishLogin(queryClient: ReturnType<typeof useQueryClient>, navigate: ReturnType<typeof useNavigate>, returnTo = '/app') {
  resetCsrf()
  await queryClient.invalidateQueries()
  navigate(returnTo, { replace: true })
}

function safeReturnPath(value?: string) { return value?.startsWith('/') && !value.startsWith('//') ? value : '/app' }
function invitationRole(value: string) { return ({ ADMIN: '空间管理员', MEMBER: '成员', EXTERNAL: '外部联系人' } as Record<string, string>)[value] ?? '成员' }
function formatInvitationTime(value: string) { return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) }
