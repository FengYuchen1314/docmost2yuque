import { useEffect } from 'react'

const backdropSelector = '.dialog-backdrop, .nested-dialog-backdrop'
const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

let titleSequence = 0

export function DialogA11y() {
  useEffect(() => {
    const returnFocus = new Map<HTMLElement, HTMLElement>()
    const lastFocusedInside = new Map<HTMLElement, HTMLElement>()
    let previousDialogs: HTMLElement[] = []
    let lastOutsideFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null

    const dialogs = () => Array.from(document.querySelectorAll<HTMLElement>(backdropSelector))
      .map((backdrop) => Array.from(backdrop.children).find((child): child is HTMLElement => child instanceof HTMLElement))
      .filter((dialog): dialog is HTMLElement => Boolean(dialog))

    const focusable = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      .filter((element) => !element.closest('[hidden], [aria-hidden="true"]'))

    const decorate = (dialog: HTMLElement) => {
      if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog')
      dialog.setAttribute('aria-modal', 'true')
      if (!dialog.hasAttribute('tabindex')) dialog.tabIndex = -1
      const heading = dialog.querySelector<HTMLElement>('h1, h2')
      if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby')) {
        if (heading) {
          if (!heading.id) heading.id = `dialog-title-${++titleSequence}`
          dialog.setAttribute('aria-labelledby', heading.id)
        } else {
          dialog.setAttribute('aria-label', '对话框')
        }
      }
      const close = dialog.querySelector<HTMLButtonElement>('.dialog-head > button.icon-button, header > button.icon-button')
      if (close && !close.getAttribute('aria-label') && !close.getAttribute('title') && !close.textContent?.trim()) {
        close.setAttribute('aria-label', heading?.textContent?.trim() ? `关闭${heading.textContent.trim()}` : '关闭对话框')
      }
    }

    const focusInitial = (dialog: HTMLElement) => {
      queueMicrotask(() => {
        if (!document.contains(dialog)) return
        const active = document.activeElement
        if (active instanceof HTMLElement && dialog.contains(active)) return
        const target = dialog.querySelector<HTMLElement>('[autofocus]') ?? focusable(dialog)[0] ?? dialog
        target.focus()
      })
    }

    const scan = () => {
      const currentDialogs = dialogs()
      currentDialogs.forEach(decorate)
      const previousTop = previousDialogs.at(-1)
      const currentTop = currentDialogs.at(-1)
      const newlyOpened = currentDialogs.filter((dialog) => !previousDialogs.includes(dialog))
      newlyOpened.forEach((dialog) => {
        const target = previousTop ? lastFocusedInside.get(previousTop) : lastOutsideFocus
        if (target) returnFocus.set(dialog, target)
      })
      document.body.classList.toggle('dialog-open', currentDialogs.length > 0)

      if (previousTop && !currentDialogs.includes(previousTop)) {
        const target = returnFocus.get(previousTop)
        returnFocus.delete(previousTop)
        queueMicrotask(() => {
          if (target?.isConnected) target.focus()
          else if (currentTop) focusInitial(currentTop)
        })
      } else if (currentTop && currentTop !== previousTop) {
        focusInitial(currentTop)
      }
      previousDialogs = currentDialogs
    }

    const closeButton = (dialog: HTMLElement) => {
      const explicit = dialog.querySelector<HTMLButtonElement>(
        '[data-dialog-close]:not([disabled]), button[aria-label^="关闭"]:not([disabled]), .dialog-head > button.icon-button:not([disabled]), header > button.icon-button:not([disabled])',
      )
      if (explicit) return explicit
      return Array.from(dialog.querySelectorAll<HTMLButtonElement>('button:not([disabled])'))
        .find((button) => ['取消', '完成', '关闭'].includes(button.textContent?.trim() ?? ''))
    }

    const onKeyDown = (event: KeyboardEvent) => {
      const dialog = dialogs().at(-1)
      if (!dialog) return
      if (event.key === 'Escape') {
        if (dialog.dataset.dialogEscape === 'managed') {
          const back = dialog.querySelector<HTMLButtonElement>('[data-dialog-back]:not([disabled])')
          if (back) {
            event.preventDefault()
            event.stopPropagation()
            back.click()
            return
          }
        }
        const close = closeButton(dialog)
        if (!close) return
        event.preventDefault()
        event.stopPropagation()
        close.click()
        return
      }
      if (event.key !== 'Tab') return
      const values = focusable(dialog)
      if (!values.length) {
        event.preventDefault()
        dialog.focus()
        return
      }
      const first = values[0]!
      const last = values.at(-1)!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !dialog.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !dialog.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    const onFocusIn = (event: FocusEvent) => {
      if (!(event.target instanceof HTMLElement)) return
      const target = event.target
      const currentDialogs = dialogs()
      const top = currentDialogs.at(-1)
      if (top?.contains(target)) lastFocusedInside.set(top, target)
      else if (!currentDialogs.some((dialog) => dialog.contains(target))) lastOutsideFocus = target
    }

    const observer = new MutationObserver(scan)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('keydown', onKeyDown, true)
    document.addEventListener('focusin', onFocusIn, true)
    scan()
    return () => {
      observer.disconnect()
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusin', onFocusIn, true)
      document.body.classList.remove('dialog-open')
    }
  }, [])
  return null
}
