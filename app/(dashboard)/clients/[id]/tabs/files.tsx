'use client'

/** The client Files tab. Files live against requests, so this stitches the
 *  client's list together from every request they own. */

import useSWR from 'swr'
import { Download, File, FileText } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'

// ── Files tab ─────────────────────────────────────────────────────────────────

export interface FileRow {
  id: string
  filename: string
  mimeType: string | null
  sizeBytes: number | null
  requestId: string | null
  requestTitle?: string | null
  storageKey: string
  createdAt: string
}
export function FilesTab({ clientId }: { clientId: string }) {
  // Files live across many requests; this fetches the client's requests then
  // each request's files and merges them. An inline SWR fetcher keeps that
  // multi-request transform intact while caching the merged result.
  const { data: files = [], isLoading: loading } = useSWR<FileRow[]>(
    `client-files:${clientId}`,
    async () => {
      const r = await fetch(apiPath(`/api/admin/requests?clientId=${clientId}&status=all`))
      const data = await r.json() as { requests: { id: string; title: string }[] }
      const reqs = data.requests ?? []
      const allFiles: FileRow[] = []
      // Fetch files for each request in parallel (batched)
      const results = await Promise.all(
        reqs.map(async req => {
          try {
            const res = await fetch(apiPath(`/api/admin/requests/${req.id}/files`))
            if (!res.ok) return []
            const json = await res.json() as { items: FileRow[] }
            return (json.items ?? []).map(f => ({ ...f, requestTitle: req.title }))
          } catch {
            return []
          }
        })
      )
      for (const batch of results) allFiles.push(...batch)
      allFiles.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      return allFiles
    },
  )

  function formatSize(bytes: number | null): string {
    if (!bytes) return '--'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const columns: DataTableColumn<FileRow>[] = [
    {
      key: 'filename',
      header: 'Name',
      minWidth: '14rem',
      render: r => (
        <div className="flex items-center gap-2">
          <FileText className="w-4 h-4 text-[var(--color-text-muted)] flex-shrink-0" />
          <span data-private className="truncate max-w-[12.5rem]" style={{ fontWeight: 500, color: 'var(--color-text)' }}>
            {r.filename}
          </span>
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      muted: true,
      render: r => r.mimeType?.split('/').pop() ?? '--',
    },
    {
      key: 'size',
      header: 'Size',
      muted: true,
      render: r => formatSize(r.sizeBytes),
    },
    {
      key: 'request',
      header: 'Request',
      muted: true,
      render: r => r.requestTitle
        ? <span data-private className="truncate max-w-[10rem] inline-block">{r.requestTitle}</span>
        : '--',
    },
    {
      key: 'createdAt',
      header: 'Uploaded',
      muted: true,
      render: r => new Date(r.createdAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' }),
    },
    {
      key: 'download',
      header: '',
      align: 'right',
      width: '8rem',
      render: r => (
        <a
          href={apiPath(`/api/uploads/serve/${r.storageKey}`)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-[var(--color-brand)] hover:text-[var(--color-brand-dark)] font-medium"
        >
          <Download className="w-3.5 h-3.5" />
          Download
        </a>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-semibold text-[var(--color-text)]">Files ({files.length})</h2>
      </div>

      <Card padding="none">
        <DataTable<FileRow>
          ariaLabel="Files"
          columns={columns}
          rows={files}
          getRowId={r => r.id}
          loading={loading}
          empty={
            <EmptyState
              variant="inline"
              icon={<File className="w-8 h-8" />}
              title="No files uploaded for this client yet"
            />
          }
        />
      </Card>
    </div>
  )
}
