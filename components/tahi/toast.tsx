'use client'

import { useState, useCallback, createContext, useContext } from 'react'
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react'

type ToastType = 'success' | 'error' | 'info'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
})

export function useToast() {
  return useContext(ToastContext)
}

const ICONS: Record<ToastType, typeof CheckCircle2> = {
  success: CheckCircle2,
  error: AlertTriangle,
  info: Info,
}

const COLOURS: Record<ToastType, { bg: string; border: string; text: string; icon: string }> = {
  success: {
    bg: 'var(--color-success-bg)',
    border: 'var(--color-success)',
    text: 'var(--color-text)',
    icon: 'var(--color-success)',
  },
  error: {
    bg: 'var(--color-danger-bg)',
    border: 'var(--color-danger)',
    text: 'var(--color-text)',
    icon: 'var(--color-danger)',
  },
  info: {
    bg: 'var(--color-info-bg)',
    border: 'var(--color-info)',
    text: 'var(--color-text)',
    icon: 'var(--color-info)',
  },
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = crypto.randomUUID()
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3500)
  }, [])

  const dismiss = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container */}
      {toasts.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: '1.5rem',
            right: '1.5rem',
            zIndex: 50000,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            maxWidth: '22rem',
          }}
        >
          {toasts.map(toast => {
            const Icon = ICONS[toast.type]
            const c = COLOURS[toast.type]
            return (
              <div
                key={toast.id}
                className="animate-slide-up"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.625rem',
                  padding: '0.75rem 1rem',
                  background: c.bg,
                  border: `1px solid ${c.border}`,
                  borderRadius: '0.625rem',
                  boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
                }}
              >
                <Icon size={16} style={{ color: c.icon, flexShrink: 0 }} />
                <p className="text-sm flex-1" style={{ color: c.text, margin: 0 }}>
                  {toast.message}
                </p>
                <button
                  onClick={() => dismiss(toast.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: 'var(--color-text-subtle)',
                    padding: '0.125rem',
                    display: 'flex',
                    flexShrink: 0,
                  }}
                  aria-label="Dismiss"
                >
                  <X size={14} />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </ToastContext.Provider>
  )
}
