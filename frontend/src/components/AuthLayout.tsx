import type { PropsWithChildren, ReactNode } from 'react'

export function AuthLayout({
  eyebrow,
  title,
  description,
  aside,
  children,
}: PropsWithChildren<{
  eyebrow: string
  title: string
  description: string
  aside?: ReactNode
}>) {
  return (
    <main className="auth-page">
      <section className="auth-story" aria-label="产品介绍">
        <a className="brand" href="/" aria-label="知序首页">
          <span className="brand-mark">序</span>
          <span>知序</span>
        </a>
        <div className="auth-story-copy">
          <span className="eyebrow">把散落的信息，写成共同的认知</span>
          <h2>知识不是文件的堆叠，<br />而是持续生长的脉络。</h2>
          <p>团队、知识库、文稿与灵感在同一处沉淀。写作轻盈，组织清楚，分享可靠。</p>
        </div>
        <div className="story-card" aria-hidden="true">
          <div className="story-card-head"><i /><i /><i /></div>
          <div className="story-card-body">
            <span className="story-line wide" />
            <span className="story-line medium" />
            <span className="story-line short" />
            <div className="story-nodes"><i /><i /><i /></div>
          </div>
        </div>
        <p className="auth-footnote">你的数据，由你掌控。</p>
      </section>
      <section className="auth-panel">
        <div className="auth-card">
          <div className="mobile-brand"><span className="brand-mark">序</span><span>知序</span></div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p className="auth-description">{description}</p>
          {children}
          {aside && <div className="auth-aside">{aside}</div>}
        </div>
      </section>
    </main>
  )
}

export function Field({
  label,
  hint,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <input {...props} aria-invalid={Boolean(error)} />
      {error ? <small className="field-error">{error}</small> : hint ? <small>{hint}</small> : null}
    </label>
  )
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null
  return <div className="form-error" role="alert">{message}</div>
}
