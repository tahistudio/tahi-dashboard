'use client'

/**
 * DangerZoneSection - irreversible workspace actions kept behind glass.
 *
 * Two actions, matching the design mock:
 *   - Export all data: downloads a JSON archive of the core business tables
 *     (super-admin only, POST /api/admin/danger/export).
 *   - Delete workspace: permanently remove this workspace and all data. Still an
 *     honest "Not available yet" - there is no delete endpoint by design.
 *
 * Admin-only. Rendered inside the settings shell which already gates on
 * admin, so the isAdmin prop is accepted for parity but not required.
 */

import { useState } from 'react'
import { apiPath } from '@/lib/api'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'

export function DangerZoneSection(_props: { isAdmin?: boolean } = {}) {
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [exporting, setExporting] = useState(false)

  async function handleExport() {
    if (exporting) return
    setExporting(true)
    try {
      const res = await fetch(apiPath('/api/admin/danger/export'), { method: 'POST' })
      if (res.status === 403) {
        showToast('Only super-admins can export workspace data', 'error')
        return
      }
      if (!res.ok) {
        showToast('Export failed. Please try again.', 'error')
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `tahi-export-${new Date().toISOString().slice(0, 10)}.json`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      showToast('Export downloaded', 'success')
    } catch {
      showToast('Export failed. Please try again.', 'error')
    } finally {
      setExporting(false)
    }
  }

  function handleDeleteConfirmed() {
    setConfirmOpen(false)
    showToast('Not available yet', 'info')
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
            {exporting ? 'Exporting...' : 'Export'}
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
            Delete...
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        variant="danger"
        title="Delete this workspace?"
        description="This permanently removes the workspace and all of its data. This action cannot be undone."
        confirmLabel="Delete workspace"
        onConfirm={handleDeleteConfirmed}
        onCancel={() => setConfirmOpen(false)}
      />
    </SectionShell>
  )
}
