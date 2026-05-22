'use client'

/**
 * <ToastProvider> + useToast(). Lightweight transient feedback. Dark
 * forest surface (matches the dashboard tooltip), tone-coloured leading
 * word, off-cream body, leaf-sm radius. No icons (per design rule), no
 * side rails. Slide up from the bottom-right; auto-dismiss after 3.5s.
 *
 *   const { showToast } = useToast()
 *   showToast('Client saved', 'success')
 *   showToast("Couldn't save", 'error')
 *   showToast('Heads up', 'warning')
 *   showToast('Syncing with Xero', 'info')
 *
 *   // With an action button (for "Undo", "View", etc.):
 *   showToast('Deal moved to Won', 'success', {
 *     action: { label: 'Undo', onClick: () => revert() }
 *   })
 */

import { useState, useCallback, createContext, useContext, useEffect, useRef } from 'react'
import { X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastAction {
  label: string
  onClick: () => void
}

interface ToastOptions {
  /** ms before auto-dismiss. Default 3500. */
  duration?: number
  /** Optional action button shown on the right (Undo, View, etc.). */
  action?: ToastAction
}

interface Toast {
  id: string
  message: string
  type: ToastType
  action?: ToastAction
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

// Tone -> coloured "leading word" + ambient bg tint. The leading word
// is the only colour signal (no icon, no side rail). The bg is a deep
// forest by default with a faint translucent overlay matching tone so
// the toast still reads as success / error / etc. at a glance.
const TONE: Record<ToastType, { word: string, fg: string, overlay: string }> = {
  success: { word: 'Saved',     fg: '#8FD9A8', overlay: 'rgba(34, 197, 94, 0.12)' },
  error:   { word: 'Error',     fg: '#F4A0A0', overlay: 'rgba(220, 38, 38, 0.15)' },
  warning: { word: 'Heads up',  fg: '#F4C77A', overlay: 'rgba(245, 158, 11, 0.13)' },
  info:    { word: 'Tip',       fg: '#98B7F7', overlay: 'rgba(59, 130, 246, 0.12)' },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  // Track per-toast dismiss timers so we can clear them on manual dismiss.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
    setToasts(prev => prev.filter(x => x.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'success', options?: ToastOptions) => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, type, action: options?.action }])
    const duration = options?.duration ?? 3500
    const timer = setTimeout(() => {
      timersRef.current.delete(id)
      setToasts(prev => prev.filter(x => x.id !== id))
    }, duration)
    timersRef.current.set(id, timer)
  }, [])

  // Clean up any in-flight timers on unmount.
  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach(t => clearTimeout(t))
      timers.clear()
    }
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {toasts.length > 0 && (
        <div
          role="region"
          aria-label="Notifications"
          aria-live="polite"
          style={{
            position: 'fixed',
            bottom: '1.25rem',
            right: '1.25rem',
            zIndex: 50000,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            maxWidth: '22rem',
            pointerEvents: 'none',
          }}
        >
          {toasts.map(toast => {
            const tone = TONE[toast.type]
            return (
              <div
                key={toast.id}
                role="status"
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.625rem 0.75rem 0.625rem 0.875rem',
                  background: 'var(--color-brand-deepest)',
                  borderRadius: 'var(--radius-md)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
                  color: 'var(--color-text-on-dark)',
                  fontSize: '0.8125rem',
                  lineHeight: 1.4,
                  pointerEvents: 'auto',
                  overflow: 'hidden',
                  animation: 'slide-up var(--motion-base, 320ms) var(--ease-out, cubic-bezier(0.22,1,0.36,1))',
                }}
              >
                {/* Tone overlay. Faint tint over the dark surface. */}
                <div
                  aria-hidden="true"
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: tone.overlay,
                    pointerEvents: 'none',
                  }}
                />
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '0.5rem', flex: 1, minWidth: 0 }}>
                  <span style={{
                    fontWeight: 700,
                    color: tone.fg,
                    letterSpacing: '-0.005em',
                    whiteSpace: 'nowrap',
                  }}>
                    {tone.word}.
                  </span>
                  <span style={{
                    color: 'var(--color-text-dim-on-dark)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}>
                    {toast.message}
                  </span>
                </div>
                {toast.action && (
                  <button
                    type="button"
                    onClick={() => { toast.action!.onClick(); dismiss(toast.id) }}
                    style={{
                      position: 'relative',
                      background: 'rgba(255, 255, 255, 0.08)',
                      border: 'none',
                      color: 'var(--color-brand-bright)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '0.25rem 0.5rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      flexShrink: 0,
                      transition: 'background var(--motion-quick, 220ms) var(--ease-out)',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)' }}
                  >
                    {toast.action.label}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  aria-label="Dismiss"
                  style={{
                    position: 'relative',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'rgba(220, 232, 217, 0.6)',
                    padding: '0.25rem',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 'var(--radius-sm)',
                    flexShrink: 0,
                    transition: 'color var(--motion-quick, 220ms) var(--ease-out)',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'var(--color-text-on-dark)' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(220, 232, 217, 0.6)' }}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ToastContext.Provider>
  )
}
