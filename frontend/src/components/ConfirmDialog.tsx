import { useId, useState, type ReactNode } from 'react'
import { AlertTriangle, HelpCircle, X } from 'lucide-react'

export interface ConfirmDialogOptions {
  title: string
  description?: ReactNode
  confirmLabel?: string
  tone?: 'danger' | 'primary'
}

interface PendingConfirmation extends ConfirmDialogOptions {
  onConfirm: () => void
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel = '确认',
  tone = 'danger',
  onConfirm,
  onClose,
}: ConfirmDialogOptions & { onConfirm: () => void; onClose: () => void }) {
  const titleId = useId()
  const descriptionId = useId()
  return <div className="dialog-backdrop nested-dialog-backdrop confirm-dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className={`dialog confirm-dialog ${tone}`} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined}>
      <div className="dialog-head"><div className="confirm-dialog-heading"><span aria-hidden="true">{tone === 'danger' ? <AlertTriangle /> : <HelpCircle />}</span><div><p className="eyebrow">{tone === 'danger' ? '请仔细核对' : '需要确认'}</p><h2 id={titleId}>{title}</h2></div></div><button type="button" className="icon-button" aria-label={`关闭${title}`} onClick={onClose}><X /></button></div>
      {description && <div id={descriptionId} className="confirm-dialog-description">{description}</div>}
      <div className="dialog-actions"><button type="button" className="button quiet" data-dialog-close autoFocus={tone === 'danger'} onClick={onClose}>取消</button><button type="button" className={`button ${tone === 'danger' ? 'danger' : 'primary'}`} autoFocus={tone === 'primary'} onClick={onConfirm}>{confirmLabel}</button></div>
    </section>
  </div>
}

export function useConfirmDialog() {
  const [request, setRequest] = useState<PendingConfirmation | null>(null)
  const confirm = (options: ConfirmDialogOptions, onConfirm: () => void) => setRequest({ ...options, onConfirm })
  const dialog = request ? <ConfirmDialog {...request} onClose={() => setRequest(null)} onConfirm={() => {
    const action = request.onConfirm
    setRequest(null)
    action()
  }} /> : null
  return { confirm, dialog }
}
