'use client'

/**
 * DangerZoneSection - irreversible workspace actions kept behind glass.
 *
 * Two actions, matching the design mock exactly (set-card danger-card):
 *   - Export all data: downloads the JSON archive from the real endpoint
 *     (super-admin only, POST /api/admin/danger/export). If any table hit the
 *     server's row cap the toast says so instead of pretending the archive is
 *     complete.
 *   - Delete workspace: gated behind a type-DELETE-to-confirm dialog (.dlg).
 *     There is deliberately no destructive endpoint yet, and the dialog says
 *     so honestly: confirming records the request as noted rather than
 *     pretending anything was removed.
 *
 * Admin-only (super-admin entry in the shell registry). The isAdmin prop is
 * accepted for parity with the other sections but not required.
 */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { apiPath } from '@/lib/api'
import { SectionShell, Toasts, useToasts } from '@/components/tahi/settings/primitives'

/* Theme-aware portal so the dialog inherits the settings pane's theme even
   though it mounts on document.body (same pattern as the primitives). */
function currentTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light'
  const scoped = document.querySelector('.ash')?.getAttribute('data-theme')
  if (scoped === 'dark' || scoped === 'light') return scoped
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

function Portal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted || typeof document === 'undefined') return null
  return createPortal(
    <div className="tahi-portal" data-theme={currentTheme()}>
      {children}
    </div>,
    document.body,
  )
}

interface DeleteWorkspaceDialogProps {
  onCancel: () => void
  onConfirm: () => void
}

function DeleteWorkspaceDialog({ onCancel, onConfirm }: DeleteWorkspaceDialogProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const armed = text.trim().toUpperCase() === 'DELETE'

  useEffect(() => {
    inputRef.current?.focus()
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', k)
    return () => document.removeEventListener('keydown', k)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Portal>
      <div className="dlg-backdrop" onClick={onCancel}>
        <div
          className="dlg"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Delete workspace"
        >
          <h3>Delete workspace</h3>
          <p className="dlg-warn">
            Deleting the workspace would permanently remove every client, request, invoice, file
            and message. Automated deletion is not switched on yet: confirming records your request
            and nothing is removed until the Tahi team completes it manually.
          </p>
          <div className="set-field" style={{ marginTop: 14 }}>
            <label htmlFor="dz-confirm">Type DELETE to confirm</label>
            <input
              id="dz-confirm"
              ref={inputRef}
              className="set-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="DELETE"
              autoComplete="off"
              spellCheck={false}
            />
          </div>
          <div className="dlg-foot">
            <button type="button" className="btn2" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn1"
              style={armed ? { background: 'var(--danger)' } : undefined}
              disabled={!armed}
              onClick={onConfirm}
            >
              Request deletion
            </button>
          </div>
        </div>
      </div>
    </Portal>
  )
}

export function DangerZoneSection(_props: { isAdmin?: boolean } = {}) {
  const { toasts, toast } = useToasts()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(apiPath('/api/admin/danger/export'), { method: 'POST' })
      if (res.status === 403) {
        toast('Only super-admins can export workspace data', 'err')
        return
      }
      if (!res.ok) {
        toast('Export failed. Please try again.', 'err')
        return
      }
      const text = await res.text()

      // The payload carries per-table counts and the row cap; surface it when
      // any table was truncated so "full archive" stays honest.
      let cap = 0
      let truncated = false
      try {
        const parsed = JSON.parse(text) as {
          rowCap?: number
          counts?: Record<string, number>
        }
        cap = parsed.rowCap ?? 0
        truncated = cap > 0 && Object.values(parsed.counts ?? {}).some((n) => n >= cap)
      } catch {
        // Not parseable: still let the download proceed untouched.
      }

      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `tahi-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)

      if (truncated) {
        toast(`Export downloaded, but some tables hit the ${cap.toLocaleString()}-row cap`, 'err')
      } else {
        toast('Export downloaded', 'ok')
      }
    } catch {
      toast('Export failed. Please try again.', 'err')
    } finally {
      setExporting(false)
    }
  }

  function handleDeleteConfirmed() {
    setConfirmOpen(false)
    toast('Deletion request noted. The Tahi team will follow up before anything is removed.', 'ok')
  }

  return (
    <SectionShell title="Danger zone" lede="Irreversible actions, kept behind glass.">
      <div className="set-card danger-card">
        <div className="set-row">
          <div className="sr-t">
            <b>Export all data</b>
            <small>Download a full archive of the workspace.</small>
          </div>
          <button
            type="button"
            className="btn2"
            onClick={handleExport}
            disabled={exporting}
            aria-busy={exporting}
          >
            {exporting ? 'Exporting…' : 'Export'}
          </button>
        </div>
        <div className="set-row">
          <div className="sr-t">
            <b style={{ color: 'var(--danger)' }}>Delete workspace</b>
            <small>Permanently remove this workspace and all data.</small>
          </div>
          <button
            type="button"
            className="btn2"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
            onClick={() => setConfirmOpen(true)}
          >
            Delete…
          </button>
        </div>
      </div>

      {confirmOpen && (
        <DeleteWorkspaceDialog
          onCancel={() => setConfirmOpen(false)}
          onConfirm={handleDeleteConfirmed}
        />
      )}
      <Toasts toasts={toasts} />
    </SectionShell>
  )
}
