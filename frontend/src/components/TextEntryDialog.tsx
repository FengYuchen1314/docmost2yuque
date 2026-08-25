import { useState } from 'react'
import { X } from 'lucide-react'

export function TextEntryDialog({
  title,
  label,
  initialValue = '',
  placeholder,
  description,
  confirmLabel = '保存',
  allowEmpty = false,
  maxLength = 2_000,
  inputType = 'text',
  validate,
  onSubmit,
  onClose,
}: {
  title: string
  label: string
  initialValue?: string
  placeholder?: string
  description?: string
  confirmLabel?: string
  allowEmpty?: boolean
  maxLength?: number
  inputType?: React.HTMLInputTypeAttribute
  validate?: (value: string) => string | null
  onSubmit: (value: string) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(initialValue)
  const normalized = value.trim()
  const error = validate?.(normalized) ?? null
  return <div className="dialog-backdrop nested-dialog-backdrop text-entry-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <form className="dialog text-entry-dialog" role="dialog" aria-modal="true" aria-label={title} onSubmit={(event) => { event.preventDefault(); if ((!normalized && !allowEmpty) || error) return; onSubmit(normalized) }}>
      <div className="dialog-head"><div><p className="eyebrow">快捷编辑</p><h2>{title}</h2>{description && <p>{description}</p>}</div><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X /></button></div>
      <label className="field"><span className="field-label">{label}</span><input autoFocus type={inputType} value={value} maxLength={maxLength} placeholder={placeholder} onChange={(event) => setValue(event.target.value)} /></label>
      {error && normalized && <div className="form-error" role="alert">{error}</div>}
      <div className="dialog-actions"><button type="button" className="button quiet" onClick={onClose}>取消</button><button className="button primary" disabled={(!normalized && !allowEmpty) || Boolean(error)}>{confirmLabel}</button></div>
    </form>
  </div>
}
