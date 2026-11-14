import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Ic } from './Icon'

function useEscape(onClose: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
}

/** Centered modal dialog (prototype .dialog). `footer` is the right-aligned button row. */
export function Dialog({
  title,
  sub,
  onClose,
  children,
  footer,
  wide,
}: {
  title: ReactNode
  sub?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEscape(onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="dialog overlay flex flex-col max-h-[76vh]" style={wide ? { width: 'min(640px, calc(100vw - 32px))' } : undefined} role="dialog" aria-modal="true">
        <div className="px-5 pt-5 pb-1 flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-semibold tracking-tight">{title}</h2>
            {sub && <p className="mt-1 text-[13.5px] text-muted-foreground">{sub}</p>}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm -mr-1.5 -mt-1" onClick={onClose} aria-label="Close">
            <Ic n="x" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto scroll min-h-0">{children}</div>
        {footer && <div className="px-5 py-3.5 border-t flex justify-end gap-2">{footer}</div>}
      </div>
    </>
  )
}

/** Right side drawer (prototype .drawer). */
export function Drawer({ onClose, children, label }: { onClose: () => void; children: ReactNode; label?: string }) {
  useEscape(onClose)
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <aside className="drawer overlay" role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </aside>
    </>
  )
}

/**
 * Popover menu anchored to a trigger. Render `.menu-item` buttons, `.menu-label`, `.menu-sep` inside.
 * `trigger` receives the toggle handler; the menu closes on outside click, Escape, or any item click.
 */
export function Menu({
  trigger,
  children,
  align = 'left',
}: {
  trigger: (toggle: () => void, open: boolean) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLSpanElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor.current || !menu.current) return
    const r = anchor.current.getBoundingClientRect()
    const w = menu.current.offsetWidth
    const h = menu.current.offsetHeight
    let left = align === 'right' ? r.right - w : r.left
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left))
    let top = r.bottom + 6
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6)
    setPos({ left, top })
  }, [open, align])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      if (menu.current?.contains(e.target as Node) || anchor.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
    }
  }, [open])

  const close = () => setOpen(false)
  return (
    <>
      <span ref={anchor} className="contents">
        {trigger(() => setOpen((o) => !o), open)}
      </span>
      {open && (
        <div
          ref={menu}
          className="menu overlay"
          role="menu"
          style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999 }}
          onClick={(e) => {
            if ((e.target as HTMLElement).closest('.menu-item')) close()
          }}
        >
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </>
  )
}

/** Global tooltip: any element with a `data-tip` attribute shows it on hover (prototype behaviour). */
export function Tips() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const tip = ref.current
    if (!tip) return
    const over = (e: MouseEvent) => {
      const t = (e.target as HTMLElement).closest?.('[data-tip]') as HTMLElement | null
      if (!t || !t.dataset.tip) {
        tip.classList.remove('show')
        return
      }
      tip.textContent = t.dataset.tip
      const r = t.getBoundingClientRect()
      tip.style.left = '0px'
      tip.style.top = '0px'
      tip.classList.add('show')
      const w = tip.offsetWidth
      const h = tip.offsetHeight
      const x = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))
      let y = r.top - h - 8
      if (y < 8) y = r.bottom + 8
      tip.style.left = x + 'px'
      tip.style.top = y + 'px'
    }
    const hide = () => tip.classList.remove('show')
    document.addEventListener('mouseover', over)
    document.addEventListener('scroll', hide, true)
    document.addEventListener('mousedown', hide)
    return () => {
      document.removeEventListener('mouseover', over)
      document.removeEventListener('scroll', hide, true)
      document.removeEventListener('mousedown', hide)
    }
  }, [])
  return <div ref={ref} className="tip" role="tooltip" />
}

/** Loading placeholder rows. */
export function Skeleton({ rows = 3, className = 'h-10' }: { rows?: number; className?: string }) {
  return (
    <div className="space-y-2" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={`skel ${className}`} />
      ))}
    </div>
  )
}

/** Empty or error state inside a card or page. */
export function Empty({ icon = 'inbox', title, children }: { icon?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <div className="mx-auto w-9 h-9 rounded-full bg-muted grid place-items-center text-muted-foreground">
        <Ic n={icon} />
      </div>
      <div className="mt-3 text-[14.5px] font-medium">{title}</div>
      {children && <div className="mt-1 text-[13.5px] text-muted-foreground max-w-[420px] mx-auto">{children}</div>}
    </div>
  )
}
