'use client'

/**
 * DangerZoneSection - irreversible workspace actions kept behind glass.
 *
 * Two actions, matching the design mock:
 *   - Export all data: download a full archive of the workspace.
 *   - Delete workspace: permanently remove this workspace and all data.
 *
 * Scaffold only. Neither endpoint exists yet, so the actions surface a
 * "Not available yet" toast rather than calling the API. The destructive
 * "Delete workspace" flow is gated behind a ConfirmDialog first, so the
 * confirmation UX is already wired for when the endpoint lands.
 *
 * Admin-only. Rendered inside the settings shell which already gates on
 * admin, so the isAdmin prop is accepted for parity but not required.
 */

import { useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'

export function DangerZoneSection(_props: { isAdmin?: boolean } = {}) {
  const { showToast } = useToast()
  const [confirmOpen, setConfirmOpen] = useState(false)

  function handleExport() {
    showToast('Not available yet', 'info')
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
          <button type="button" className="btn2" onClick={handleExport}>
            Export
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
