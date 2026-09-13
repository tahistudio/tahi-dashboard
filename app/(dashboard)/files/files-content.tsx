'use client'

/**
 * <FilesContent>. The client portal file browser.
 *
 * Reads the org-scoped list from GET /api/portal/files (the route already
 * excludes anything attached to an internal request or an internal note), and
 * writes through the existing three-step R2 upload: presign, PUT the bytes to
 * the proxy, then confirm the metadata. Nothing here picks an org: the upload
 * resolver forces a client's files under their own org prefix.
 *
 * Three states, per the list-view contract: loading skeleton, honest empty
 * state with the upload CTA, and the populated table. A fetch failure only
 * takes over the surface when there is no list to show; a failed revalidation
 * on top of a good list is a banner, so an upload never blanks the table.
 */

import { useCallback, useRef, useState } from 'react'
import { Download, FolderOpen, Trash2, Upload } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { Callout } from '@/components/tahi/callout'
import { Card } from '@/components/tahi/card'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { DataTable } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge } from '@/components/tahi/badge'
import { useToast } from '@/components/tahi/toast'
import { useImpersonation } from '@/components/tahi/impersonation-banner'

// The portal list route caps `limit`; ask for a browser-sized page.
const LIST_URL = '/api/portal/files?limit=100'

export interface PortalFile {
  id: string
  name: string
  type: string
  uploadedBy: string
  ago: string
  url: string
  /** From the route: your own upload, not attached to a message. Only files
   *  meeting both are deletable from this list; a studio deliverable or a
   *  message attachment is not, whatever the client's org otherwise sees. */
  deletable: boolean
}

interface PresignResponse {
  uploadUrl: string
  storageKey: string
  fileId: string
}

/** Below md the five-column table becomes a card list (CLAUDE.md rules out a
 *  sideways-scrolling table on a 375px phone). Download stays a full-width
 *  anchor target; Delete, when this file is deletable, is its own 44px
 *  button beside it rather than nested inside the anchor. */
function FileMobileCard({
  file,
  onRequestDelete,
  deleteDisabled,
}: {
  file: PortalFile
  onRequestDelete: (file: PortalFile) => void
  deleteDisabled: boolean
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-leaf-sm)',
        background: 'var(--color-bg)',
      }}
    >
      <a
        href={apiPath(file.url)}
        download
        className="tahi-focus-ring"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          flex: 1,
          minWidth: 0,
          minHeight: '2.75rem',
          textDecoration: 'none',
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span
            data-private
            style={{
              display: 'block',
              color: 'var(--color-text)',
              fontWeight: 600,
              fontSize: 'var(--text-base)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {file.name}
          </span>
          <span style={{ display: 'block', color: 'var(--color-text-muted)', fontSize: 'var(--text-sm)' }}>
            {[file.type, file.uploadedBy, file.ago].filter(Boolean).join(' · ')}
          </span>
        </span>
        <Download className="w-4 h-4" aria-hidden="true" style={{ color: 'var(--color-text-muted)', flexShrink: 0 }} />
      </a>
      {file.deletable && (
        <button
          type="button"
          onClick={() => onRequestDelete(file)}
          disabled={deleteDisabled}
          aria-label={`Delete ${file.name}`}
          title={deleteDisabled ? 'Read-only client view' : 'Delete'}
          className="tahi-focus-ring"
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minHeight: '2.75rem',
            minWidth: '2.75rem',
            borderRadius: 'var(--radius-leaf-sm)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            color: 'var(--color-danger)',
            cursor: deleteDisabled ? 'not-allowed' : 'pointer',
            opacity: deleteDisabled ? 0.5 : 1,
          }}
        >
          <Trash2 className="w-4 h-4" aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export function FilesContent() {
  const { showToast } = useToast()
  const { data, error, isLoading, mutate } = useResource<{ items: PortalFile[] }>(LIST_URL)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // /files is one of the two client-only routes the middleware deliberately
  // lets a preview into, so an admin standing in a client's shoes can land
  // here and upload. Their session is still `isTahiAdmin`, so the upload
  // resolver would file the bytes under the TAHI org: the operator is told
  // everything they do lands in the client's workspace, and the file would
  // quietly not be there. Naming the previewed org is what a studio-side
  // upload to a client already does; the resolver validates and access-scopes
  // it, and ignores it entirely for a real client session.
  const { impersonatedOrgId, previewIsReadOnly } = useImpersonation()

  const files = data?.items ?? []
  // SWR keeps the previous payload across a failed revalidation, so a failure
  // only replaces the surface when there is nothing left to show. A revalidate
  // that fails while a good list is on screen (the mutate() right after an
  // upload is the likely one) gets a banner above the table it still has.
  const failed = !!error && !data
  const staleWarning = !!error && !!data

  const [deleteTarget, setDeleteTarget] = useState<PortalFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    const previous = data
    setDeleting(true)
    // Optimistic removal, no revalidation yet: the row is gone from the list
    // the instant Delete is confirmed, and rolled back if the write fails.
    await mutate(previous ? { items: previous.items.filter(f => f.id !== target.id) } : previous, false)
    try {
      const res = await fetch(apiPath(`/api/uploads/${target.id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      showToast('File deleted', 'success')
      setDeleteTarget(null)
    } catch {
      await mutate(previous, false)
      showToast('Could not delete the file. Please try again.', 'error')
    } finally {
      setDeleting(false)
    }
  }, [deleteTarget, data, mutate, showToast])

  const uploadOne = useCallback(async (file: File) => {
    const mime = file.type || 'application/octet-stream'
    // Same org on both calls, or the confirm would write a files row whose
    // key prefix belongs to a different org and the route would 403 it.
    const target = impersonatedOrgId ? { orgId: impersonatedOrgId } : {}
    const presignRes = await fetch(apiPath('/api/uploads/presign'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: mime, ...target }),
    })
    if (!presignRes.ok) throw new Error('presign failed')
    const { uploadUrl, storageKey, fileId } = (await presignRes.json()) as PresignResponse

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mime },
      body: file,
    })
    if (!putRes.ok) throw new Error('upload failed')

    const confirmRes = await fetch(apiPath('/api/uploads/confirm'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileId,
        storageKey,
        filename: file.name,
        mimeType: mime,
        sizeBytes: file.size,
        ...target,
      }),
    })
    if (!confirmRes.ok) throw new Error('confirm failed')
  }, [impersonatedOrgId])

  const handleFiles = useCallback(async (picked: FileList | null) => {
    if (!picked || picked.length === 0) return
    const list = Array.from(picked)
    setUploading(true)
    let ok = 0
    try {
      for (const file of list) {
        try {
          await uploadOne(file)
          ok += 1
        } catch {
          showToast(`Could not upload ${file.name}. Please try again.`, 'error')
        }
      }
      if (ok > 0) {
        showToast(ok === 1 ? 'File uploaded' : `${ok} files uploaded`, 'success')
        // A failed revalidation is a banner, not an unhandled rejection: the
        // upload already succeeded and the list on screen is still good.
        await mutate().catch(() => {})
      }
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }, [uploadOne, mutate, showToast])

  const pickFiles = useCallback(() => inputRef.current?.click(), [])

  const uploadButton = (
    <TahiButton
      variant="primary"
      size="sm"
      onClick={pickFiles}
      loading={uploading}
      disabled={uploading}
      iconLeft={<Upload className="w-3.5 h-3.5" aria-hidden="true" />}
    >
      {uploading ? 'Uploading' : 'Upload files'}
    </TahiButton>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <PageHeader
        title="Files"
        subtitle="Deliverables from the studio, and anything you share with us."
      >
        {uploadButton}
      </PageHeader>

      <input
        ref={inputRef}
        type="file"
        multiple
        onChange={e => { void handleFiles(e.target.files) }}
        style={{ display: 'none' }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {staleWarning ? (
        <Callout
          tone="warning"
          title="This list may be out of date"
          action={{ label: 'Refresh', onClick: () => { void mutate().catch(() => {}) } }}
        >
          We could not reach your library just now. Anything you uploaded is safe, it may take a moment to appear.
        </Callout>
      ) : null}

      <Card padding="none">
        {failed ? (
          <EmptyState
            icon={<FolderOpen className="w-7 h-7" aria-hidden="true" />}
            title="We could not load your files"
            description="Something went wrong reaching your library. Try again in a moment."
            action={
              <TahiButton variant="secondary" size="sm" onClick={() => { void mutate().catch(() => {}) }}>
                Try again
              </TahiButton>
            }
          />
        ) : (
          <DataTable<PortalFile>
            columns={[
              {
                key: 'name',
                header: 'File',
                sortable: true,
                sortValue: r => r.name.toLowerCase(),
                minWidth: '14rem',
                render: r => (
                  <a
                    href={apiPath(r.url)}
                    className="tahi-focus-ring"
                    download
                    data-private
                    style={{
                      color: 'var(--color-text)',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      minHeight: '2.75rem',
                    }}
                  >
                    {r.name}
                  </a>
                ),
              },
              {
                key: 'type',
                header: 'Type',
                width: '7rem',
                render: r => <Badge tone="neutral">{r.type}</Badge>,
              },
              {
                key: 'uploadedBy',
                header: 'Shared by',
                muted: true,
                accessor: r => r.uploadedBy,
              },
              {
                key: 'ago',
                header: 'Added',
                muted: true,
                width: '8rem',
                accessor: r => r.ago,
              },
              {
                key: 'download',
                header: '',
                align: 'right',
                width: '6rem',
                render: r => (
                  <a
                    href={apiPath(r.url)}
                    download
                    className="tahi-focus-ring"
                    aria-label={`Download ${r.name}`}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.375rem',
                      minHeight: '2.75rem',
                      minWidth: '2.75rem',
                      padding: '0 0.625rem',
                      borderRadius: 'var(--radius-leaf-sm)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text-muted)',
                      fontSize: 'var(--text-sm)',
                      textDecoration: 'none',
                    }}
                  >
                    <Download className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Get</span>
                  </a>
                ),
              },
              {
                key: 'delete',
                header: '',
                align: 'right',
                width: '3.5rem',
                render: r => r.deletable ? (
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(r)}
                    disabled={previewIsReadOnly}
                    aria-label={`Delete ${r.name}`}
                    title={previewIsReadOnly ? 'Read-only client view' : 'Delete'}
                    className="tahi-focus-ring"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      minHeight: '2.75rem',
                      minWidth: '2.75rem',
                      borderRadius: 'var(--radius-leaf-sm)',
                      border: '1px solid var(--color-border)',
                      background: 'var(--color-bg)',
                      color: 'var(--color-danger)',
                      cursor: previewIsReadOnly ? 'not-allowed' : 'pointer',
                      opacity: previewIsReadOnly ? 0.5 : 1,
                    }}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : null,
              },
            ]}
            rows={files}
            getRowId={r => r.id}
            loading={isLoading}
            ariaLabel="Your files"
            mobileCard={r => (
              <FileMobileCard
                file={r}
                onRequestDelete={setDeleteTarget}
                deleteDisabled={previewIsReadOnly}
              />
            )}
            empty={
              <EmptyState
                icon={<FolderOpen className="w-7 h-7" aria-hidden="true" />}
                title="No files yet"
                description="Delivered work shows up here. You can also upload brand assets and references for the team."
                action={uploadButton}
              />
            }
          />
        )}
      </Card>

      <ConfirmDialog
        open={deleteTarget != null}
        title={`Delete ${deleteTarget?.name ?? 'this file'}?`}
        description="This cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => { if (!deleting) setDeleteTarget(null) }}
      />
    </div>
  )
}
