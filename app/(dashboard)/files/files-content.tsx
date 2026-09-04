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
 * state with the upload CTA, and the populated table.
 */

import { useCallback, useRef, useState } from 'react'
import { Download, FolderOpen, Upload } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useResource } from '@/lib/use-resource'
import { Card } from '@/components/tahi/card'
import { DataTable } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { PageHeader } from '@/components/tahi/page-header'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Badge } from '@/components/tahi/badge'
import { useToast } from '@/components/tahi/toast'

// The portal list route caps `limit`; ask for a browser-sized page.
const LIST_URL = '/api/portal/files?limit=100'

export interface PortalFile {
  id: string
  name: string
  type: string
  uploadedBy: string
  ago: string
  url: string
}

interface PresignResponse {
  uploadUrl: string
  storageKey: string
  fileId: string
}

/** Below md the five-column table becomes a card list (CLAUDE.md rules out a
 *  sideways-scrolling table on a 375px phone). The whole card is the download
 *  target, so the touch area is the row rather than a small trailing button. */
function FileMobileCard({ file }: { file: PortalFile }) {
  return (
    <a
      href={file.url}
      download
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        minHeight: '2.75rem',
        padding: 'var(--space-3)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-leaf-sm)',
        background: 'var(--color-bg)',
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
  )
}

export function FilesContent() {
  const { showToast } = useToast()
  const { data, error, isLoading, mutate } = useResource<{ items: PortalFile[] }>(LIST_URL)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const files = data?.items ?? []
  const failed = !!error

  const uploadOne = useCallback(async (file: File) => {
    const mime = file.type || 'application/octet-stream'
    const presignRes = await fetch(apiPath('/api/uploads/presign'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: file.name, mimeType: mime }),
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
      }),
    })
    if (!confirmRes.ok) throw new Error('confirm failed')
  }, [])

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
        await mutate()
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

      <Card padding="none">
        {failed ? (
          <EmptyState
            icon={<FolderOpen className="w-7 h-7" aria-hidden="true" />}
            title="We could not load your files"
            description="Something went wrong reaching your library. Try again in a moment."
            action={
              <TahiButton variant="secondary" size="sm" onClick={() => { void mutate() }}>
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
                    href={r.url}
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
                    href={r.url}
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
            ]}
            rows={files}
            getRowId={r => r.id}
            loading={isLoading}
            ariaLabel="Your files"
            mobileCard={r => <FileMobileCard file={r} />}
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
    </div>
  )
}
