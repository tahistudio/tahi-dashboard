'use client'

/**
 * The client Files tab.
 *
 * Files are stored against requests, so this stitches the client's list
 * together from every request they own. That is also why there are no folders
 * here yet: the design proposes a small drive per client (four studio folders,
 * upload straight to the client, a comment thread on every file) and none of
 * that has a table behind it. The search, the row and the detail panel port
 * now; folders and threads wait for the schema.
 */

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { Download, File, FileText, Link2, Search } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { SlideOver } from '@/components/tahi/slide-over'
import { CountText, Grow, LinkButton, SectionTitle, SubBar } from '../_kit/chrome'

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

function formatSize(bytes: number | null): string {
  if (!bytes) return '--'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatWhen(value: string): string {
  return new Date(value).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function FilesTab({
  clientId,
  orgName,
  fileId,
  onOpenFile,
}: {
  clientId: string
  orgName: string
  fileId: string | null
  onOpenFile: (id: string | null) => void
}) {
  const [query, setQuery] = useState('')

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return files
    return files.filter(f => f.filename.toLowerCase().includes(q) || (f.requestTitle ?? '').toLowerCase().includes(q))
  }, [files, query])

  const open = files.find(f => f.id === fileId) ?? null

  const columns: DataTableColumn<FileRow>[] = [
    {
      key: 'filename',
      header: 'Name',
      minWidth: '14rem',
      sortable: true,
      sortValue: r => r.filename,
      render: r => (
        <div className="flex items-center" style={{ gap: '0.5rem' }}>
          <FileText className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
          <span data-private className="truncate" style={{ maxWidth: '12.5rem', fontWeight: 500, color: 'var(--color-text)' }}>
            {r.filename}
          </span>
        </div>
      ),
    },
    { key: 'type', header: 'Type', muted: true, render: r => r.mimeType?.split('/').pop() ?? '--' },
    {
      key: 'size',
      header: 'Size',
      muted: true,
      sortable: true,
      sortValue: r => r.sizeBytes ?? 0,
      render: r => formatSize(r.sizeBytes),
    },
    {
      key: 'request',
      header: 'Request',
      muted: true,
      render: r => r.requestTitle
        ? <span data-private className="truncate inline-block" style={{ maxWidth: '10rem' }}>{r.requestTitle}</span>
        : '--',
    },
    {
      key: 'createdAt',
      header: 'Uploaded',
      muted: true,
      sortable: true,
      sortValue: r => r.createdAt,
      render: r => formatWhen(r.createdAt),
    },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <SubBar>
        <SectionTitle>Files</SectionTitle>
        <CountText>
          {files.length === 0 ? 'Nothing shared yet' : `${files.length} ${files.length === 1 ? 'file' : 'files'}`}
        </CountText>
        <Grow />
        <label
          className="flex items-center"
          style={{
            gap: '0.4375rem',
            minHeight: '2.75rem',
            padding: '0 0.625rem',
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            flex: '0 1 16rem',
            minWidth: '10rem',
          }}
        >
          <Search className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-subtle)' }} aria-hidden="true" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search files"
            aria-label="Search files"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              background: 'none',
              outline: 'none',
              fontSize: '0.8125rem',
              color: 'var(--color-text)',
            }}
          />
        </label>
      </SubBar>

      <Card padding="none">
        <DataTable<FileRow>
          ariaLabel="Files"
          columns={columns}
          rows={filtered}
          getRowId={r => r.id}
          loading={loading}
          onRowClick={r => onOpenFile(r.id)}
          mobileCard={r => (
            <button
              type="button"
              onClick={() => onOpenFile(r.id)}
              className="tahi-focus-ring text-left w-full"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.25rem',
                minHeight: '2.75rem',
                padding: '0.75rem',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
              }}
            >
              <span data-private style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                {r.filename}
              </span>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                {formatSize(r.sizeBytes)} · {formatWhen(r.createdAt)}
              </span>
            </button>
          )}
          empty={
            <EmptyState
              variant="inline"
              icon={<File className="w-8 h-8" />}
              title={query ? 'No files match that search' : 'No files yet'}
              description={query
                ? 'Try part of the file name, or the request it came in on.'
                : `Anything uploaded on a ${orgName} request shows up here.`}
            />
          }
        />
      </Card>

      <SlideOver
        open={open != null}
        onClose={() => onOpenFile(null)}
        title={open?.filename ?? 'File'}
        subtitle={open ? `${formatSize(open.sizeBytes)} · uploaded ${formatWhen(open.createdAt)}` : undefined}
      >
        <SlideOver.Body>
          {open && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div
                className="flex items-center justify-center"
                style={{
                  minHeight: '7rem',
                  borderRadius: 'var(--radius-lg)',
                  border: '1px solid var(--color-border-subtle)',
                  background: 'var(--color-bg-secondary)',
                  color: 'var(--color-text-muted)',
                  gap: '0.5rem',
                }}
              >
                <FileText className="w-6 h-6" aria-hidden="true" />
                <span style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                  {open.mimeType ?? 'File'}
                </span>
              </div>

              <dl style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0 }}>
                <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Linked request</dt>
                  <dd data-private style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {open.requestTitle ?? 'Not linked'}
                  </dd>
                </div>
                <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Visible to</dt>
                  <dd style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    Everyone at {orgName}
                  </dd>
                </div>
                <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
                  <dt style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Uploaded</dt>
                  <dd style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
                    {formatWhen(open.createdAt)}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </SlideOver.Body>
        <SlideOver.Footer>
          {open && (
            <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
              <LinkButton
                href={apiPath(`/api/uploads/serve/${open.storageKey}`)}
                tone="primary"
                ariaLabel={`Download ${open.filename}`}
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                Download
              </LinkButton>
              <LinkButton
                href={apiPath(`/api/uploads/serve/${open.storageKey}`)}
                ariaLabel={`Open ${open.filename} in a new tab`}
              >
                <Link2 className="w-3.5 h-3.5" aria-hidden="true" />
                Open in a tab
              </LinkButton>
            </div>
          )}
        </SlideOver.Footer>
      </SlideOver>
    </div>
  )
}
