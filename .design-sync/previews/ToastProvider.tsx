/**
 * ToastProvider renders nothing until showToast() is called.
 * Each cell mounts <ToastProvider> wrapping a child that fires showToast
 * in a useEffect on mount with duration:999999 so the toast stays visible
 * for the screenshot.
 *
 * Toasts render at position:fixed bottom-right (z-index 50000), so they
 * appear OUTSIDE the preview card container. The card cell sets a generous
 * minHeight to help frame them, but the orchestrator should use:
 *   cfg.overrides.ToastProvider = { "cardMode": "single", "viewport": "380x220" }
 * so the bottom-right corner is visible.
 */

import { useEffect } from 'react'
import { ToastProvider, useToast } from 'tahi-dashboard'

const outerFrame = {
  padding: '1.25rem',
  background: 'var(--color-bg-cream)',
  minHeight: '160px',
  display: 'flex',
  flexDirection: 'column' as const,
  justifyContent: 'flex-end',
}

function SuccessTrigger() {
  const { showToast } = useToast()
  useEffect(() => {
    showToast('Client saved', 'success', { duration: 999999 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0 }}>
      Success toast active at viewport bottom-right
    </p>
  )
}

function ErrorTrigger() {
  const { showToast } = useToast()
  useEffect(() => {
    showToast("Couldn't save invoice -- check Xero connection", 'error', { duration: 999999 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0 }}>
      Error toast active at viewport bottom-right
    </p>
  )
}

function InfoTrigger() {
  const { showToast } = useToast()
  useEffect(() => {
    showToast('Syncing retainer invoices with Xero', 'info', { duration: 999999 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0 }}>
      Info toast active at viewport bottom-right
    </p>
  )
}

function ActionTrigger() {
  const { showToast } = useToast()
  useEffect(() => {
    showToast('Request moved to Delivered', 'success', {
      duration: 999999,
      action: { label: 'Undo', onClick: () => {} },
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <p style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-subtle)', margin: 0 }}>
      Success + Undo action toast at viewport bottom-right
    </p>
  )
}

/** Success tone -- "Client saved" */
export const ToastSuccess = () => (
  <div style={outerFrame}>
    <ToastProvider>
      <SuccessTrigger />
    </ToastProvider>
  </div>
)

/** Error tone -- invoice sync failure */
export const ToastError = () => (
  <div style={outerFrame}>
    <ToastProvider>
      <ErrorTrigger />
    </ToastProvider>
  </div>
)

/** Info tone -- Xero sync in progress */
export const ToastInfo = () => (
  <div style={outerFrame}>
    <ToastProvider>
      <InfoTrigger />
    </ToastProvider>
  </div>
)

/** Success with Undo action button */
export const ToastWithAction = () => (
  <div style={outerFrame}>
    <ToastProvider>
      <ActionTrigger />
    </ToastProvider>
  </div>
)
