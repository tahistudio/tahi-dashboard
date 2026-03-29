'use client'

import { useEffect, useState, useCallback } from 'react'
import { X, Command } from 'lucide-react'

const SHORTCUTS = [
  { key: 'n', description: 'New request', action: 'new-request' },
  { key: 'c', description: 'New client', action: 'new-client' },
  { key: '/', description: 'Focus search', action: 'focus-search' },
  { key: '?', description: 'Show keyboard shortcuts', action: 'show-help' },
] as const

function isInputFocused(): boolean {
  const el = document.activeElement
  if (!el) return false
  const tag = el.tagName.toLowerCase()
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return true
  if ((el as HTMLElement).isContentEditable) return true
  return false
}

export function KeyboardShortcuts() {
  const [helpOpen, setHelpOpen] = useState(false)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    // Ignore if modifier keys are held (except shift for ?)
    if (e.ctrlKey || e.metaKey || e.altKey) return

    // ? always opens help (shift+/)
    if (e.key === '?') {
      e.preventDefault()
      setHelpOpen(prev => !prev)
      return
    }

    // All other shortcuts require no input focused
    if (isInputFocused()) return

    switch (e.key) {
      case 'n': {
        e.preventDefault()
        // Dispatch custom event for new-request-dialog to listen to
        window.dispatchEvent(new CustomEvent('tahi:shortcut', { detail: 'new-request' }))
        break
      }
      case 'c': {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('tahi:shortcut', { detail: 'new-client' }))
        break
      }
      case '/': {
        e.preventDefault()
        // Try to focus the first search input on the page
        const searchInput = document.querySelector<HTMLInputElement>(
          'input[placeholder*="Search"], input[type="search"]'
        )
        searchInput?.focus()
        break
      }
      case 'Escape': {
        if (helpOpen) {
          e.preventDefault()
          setHelpOpen(false)
        }
        break
      }
    }
  }, [helpOpen])

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  if (!helpOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 backdrop-blur-sm"
        onClick={() => setHelpOpen(false)}
      />

      {/* Dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        className="relative w-full max-w-sm bg-[var(--color-bg)] shadow-2xl overflow-hidden"
        style={{ borderRadius: 'var(--radius-card, 0.75rem)' }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between"
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid var(--color-border)',
          }}
        >
          <div className="flex items-center gap-2">
            <Command size={16} style={{ color: 'var(--color-brand)' }} />
            <h2
              id="shortcuts-title"
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Keyboard Shortcuts
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setHelpOpen(false)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '0.25rem',
              color: 'var(--color-text-subtle)',
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Shortcuts list */}
        <div style={{ padding: '0.75rem 1.25rem' }}>
          {SHORTCUTS.map(shortcut => (
            <div
              key={shortcut.key}
              className="flex items-center justify-between"
              style={{
                padding: '0.5rem 0',
                borderBottom: '1px solid var(--color-border-subtle)',
              }}
            >
              <span
                className="text-sm"
                style={{ color: 'var(--color-text)' }}
              >
                {shortcut.description}
              </span>
              <kbd
                className="inline-flex items-center justify-center font-mono font-medium"
                style={{
                  minWidth: '1.5rem',
                  padding: '0.125rem 0.5rem',
                  fontSize: '0.75rem',
                  background: 'var(--color-bg-tertiary)',
                  border: '1px solid var(--color-border)',
                  borderRadius: '0.25rem',
                  color: 'var(--color-text-muted)',
                }}
              >
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div
          style={{
            padding: '0.625rem 1.25rem',
            borderTop: '1px solid var(--color-border)',
            background: 'var(--color-bg-secondary)',
          }}
        >
          <p className="text-xs" style={{ color: 'var(--color-text-subtle)', textAlign: 'center' }}>
            Press <kbd style={{ fontFamily: 'monospace', fontWeight: 600 }}>?</kbd> to toggle this panel
          </p>
        </div>
      </div>
    </div>
  )
}
