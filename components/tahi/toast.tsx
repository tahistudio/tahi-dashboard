'use client'

import { createContext, useContext, useState, useCallback } from 'react'
import { CheckCircle2, AlertCircle, X } from 'lucide-react'

// ---- Types ------------------------------------------------------------------

type ToastType = 'success' | 'error'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void
}

// ---- Context ----------------------------------------------------------------

const ToastContext = createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return ctx
}

// ---- Provider ---------------------------------------------------------------

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    const id = ++nextId
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => removeToast(id), 3000)
  }, [removeToast])

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div
        className="fixed z-[100] flex flex-col gap-2 pointer-events-none"
        style={{ top: '1rem', right: '1rem', maxWidth: '22rem' }}
      >
        {toasts.map(toast => (
          <ToastCard
            key={toast.id}
            toast={toast}
            onDismiss={() => removeToast(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

// ---- Toast Card -------------------------------------------------------------

function ToastCard({
  toast,
  onDismiss,
}: {
  toast: ToastItem
  onDismiss: () => void
}) {
  const isSuccess = toast.type === 'success'

  return (
    <div
      role="alert"
      className="pointer-events-auto flex items-start gap-3 shadow-lg animate-in slide-in-from-right"
      style={{
        padding: '0.75rem 1rem',
        borderRadius: '0.5rem',
        background: isSuccess ? 'var(--color-success-bg, #f0fdf4)' : 'var(--color-danger-bg, #fef2f2)',
        border: `1px solid ${isSuccess ? 'var(--color-success, #4ade80)' : 'var(--color-danger, #f87171)'}`,
        color: isSuccess ? '#166534' : '#991b1b',
        fontSize: '0.875rem',
        fontWeight: 500,
        animation: 'slideInRight 0.25s ease-out',
      }}
    >
      {isSuccess ? (
        <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: '0.0625rem' }} />
      ) : (
        <AlertCircle size={16} style={{ flexShrink: 0, marginTop: '0.0625rem' }} />
      )}
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        type="button"
        onClick={onDismiss}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: '0.125rem',
          color: 'inherit',
          opacity: 0.6,
          flexShrink: 0,
        }}
        aria-label="Dismiss"
      >
        <X size={14} />
      </button>
    </div>
  )
}
