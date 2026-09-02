'use client'

/**
 * <RequestActionsMenu> — the "..." in the request detail header.
 *
 * Studio audiences only. Five actions:
 *
 *   Nest under another request  a searchable picker of the top-level
 *                               requests at the same client, POSTed to the
 *                               existing /nest endpoint
 *   Make top-level              the same endpoint with parentRequestId null
 *   Duplicate                   POST /duplicate, then open the copy
 *   Archive                     PATCH status archived, behind a confirm
 *   Delete                      DELETE, behind a confirm
 *
 * The picker is a second page inside the same popover rather than a nested
 * menu, so one Escape closes whatever is open and nothing is clipped.
 *
 * Note on Delete: the admin DELETE route is a soft delete that archives the
 * row rather than destroying it, so the confirm copy says exactly that
 * instead of promising something irreversible.
 */

import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import {
  ArrowUpRight, Copy, Inbox, Layers, Loader2, MoreHorizontal, Search, Trash2,
} from 'lucide-react'
import { Popover } from '@/components/tahi/popover'
import { Menu } from '@/components/tahi/menu'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

interface NestCandidate {
  id: string
  title: string
  requestNumber: number | null
  parentRequestId: string | null
}

interface RequestActionsMenuProps {
  requestId: string
  orgId: string
  /** True when this request already sits under a parent. */
  hasParent: boolean
  /** Called after a nest / un-nest / archive so the parent can revalidate. */
  onChanged: () => void
}

type Pending = 'archive' | 'delete' | null

export function RequestActionsMenu({ requestId, orgId, hasParent, onChanged }: RequestActionsMenuProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const router = useRouter()
  const { showToast } = useToast()

  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<Pending>(null)

  // Candidates load only once the picker is opened.
  const { data: candidateData, isLoading: candidatesLoading } = useSWR<{ requests: NestCandidate[] }>(
    picking ? `/api/admin/requests?orgId=${orgId}&status=all&limit=200` : null,
  )
  const candidates = (candidateData?.requests ?? [])
    .filter(r => r.id !== requestId && !r.parentRequestId)

  const q = query.trim().toLowerCase()
  const filtered = q
    ? candidates.filter(r =>
        r.title.toLowerCase().includes(q) ||
        String(r.requestNumber ?? '').includes(q))
    : candidates

  function close() {
    setOpen(false)
    setPicking(false)
    setQuery('')
  }

  async function post(url: string, body?: unknown): Promise<Response | null> {
    try {
      return await fetch(apiPath(url), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      showToast('Network error - try again')
      return null
    }
  }

  async function nestUnder(parent: NestCandidate) {
    close()
    setBusy(true)
    const res = await post(`/api/admin/requests/${requestId}/nest`, { parentRequestId: parent.id })
    setBusy(false)
    if (!res) return
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      showToast(j.error ?? 'Could not nest this request')
      return
    }
    const label = parent.requestNumber != null
      ? `#${String(parent.requestNumber).padStart(3, '0')}`
      : parent.title
    showToast(`Nested under ${label}`)
    onChanged()
  }

  async function makeTopLevel() {
    close()
    setBusy(true)
    const res = await post(`/api/admin/requests/${requestId}/nest`, { parentRequestId: null })
    setBusy(false)
    if (!res) return
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      showToast(j.error ?? 'Could not make this top-level')
      return
    }
    showToast('Made top-level')
    onChanged()
  }

  async function duplicate() {
    close()
    setBusy(true)
    const res = await post(`/api/admin/requests/${requestId}/duplicate`)
    setBusy(false)
    if (!res) return
    if (!res.ok) {
      const j = await res.json().catch(() => ({})) as { error?: string }
      showToast(j.error ?? 'Could not duplicate this request')
      return
    }
    const j = await res.json().catch(() => ({})) as { id?: string }
    showToast('Request duplicated')
    if (j.id) router.push(`/requests/${j.id}`)
  }

  async function archive() {
    setPending(null)
    setBusy(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'archived' }),
      })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Could not archive this request')
        return
      }
      showToast('Request archived')
      onChanged()
    } catch {
      showToast('Network error - try again')
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setPending(null)
    setBusy(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}`), { method: 'DELETE' })
      if (!res.ok) {
        const j = await res.json().catch(() => ({})) as { error?: string }
        showToast(j.error ?? 'Could not delete this request')
        return
      }
      showToast('Request deleted')
      router.push('/requests')
    } catch {
      showToast('Network error - try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Request actions"
        title="Request actions"
        disabled={busy}
        onClick={() => { setPicking(false); setOpen(o => !o) }}
        className="tahi-focus-ring flex items-center justify-center flex-shrink-0 w-11 h-11 md:w-8 md:h-8"
        style={{
          marginLeft: 'auto',
          border: '1px solid var(--color-border-subtle)',
          borderRadius: 'var(--radius-button)',
          background: 'var(--color-bg)',
          color: 'var(--color-text-muted)',
          cursor: busy ? 'not-allowed' : 'pointer',
          transition: 'background-color 150ms ease, border-color 150ms ease, color 150ms ease',
        }}
        onMouseEnter={e => {
          if (busy) return
          e.currentTarget.style.background = 'var(--color-bg-secondary)'
          e.currentTarget.style.borderColor = 'var(--color-border)'
          e.currentTarget.style.color = 'var(--color-text)'
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = 'var(--color-bg)'
          e.currentTarget.style.borderColor = 'var(--color-border-subtle)'
          e.currentTarget.style.color = 'var(--color-text-muted)'
        }}
      >
        {busy
          ? <Loader2 size={15} className="animate-spin" aria-hidden="true" />
          : <MoreHorizontal size={16} aria-hidden="true" />}
      </button>

      <Popover anchorRef={triggerRef} open={open} onClose={close} align="end" width="17rem" maxHeight="22rem">
        {picking ? (
          <>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.375rem',
                padding: '0.5rem 0.625rem',
                borderBottom: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
                flexShrink: 0,
              }}
            >
              <Search size={12} aria-hidden="true" style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search this client's requests…"
                aria-label="Search requests to nest under"
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.25rem 0',
                  fontSize: '0.75rem',
                  background: 'transparent',
                  border: 'none',
                  color: 'var(--color-text)',
                  outline: 'none',
                }}
              />
            </div>
            <div
              role="menu"
              aria-label="Nest under"
              style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0.25rem' }}
            >
              {candidatesLoading ? (
                <p style={{ margin: 0, padding: '0.75rem 0.625rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                  Loading requests…
                </p>
              ) : filtered.length === 0 ? (
                <p style={{ margin: 0, padding: '0.75rem 0.625rem', fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                  No other top-level request at this client.
                </p>
              ) : filtered.map(r => (
                <Menu.Item
                  key={r.id}
                  onClick={() => { void nestUnder(r) }}
                  trailing={r.requestNumber != null ? `#${String(r.requestNumber).padStart(3, '0')}` : undefined}
                >
                  {r.title}
                </Menu.Item>
              ))}
            </div>
            <div style={{ borderTop: '1px solid var(--color-border-subtle)', padding: '0.25rem', flexShrink: 0 }}>
              <Menu.Item onClick={() => { setPicking(false); setQuery('') }}>
                Back to actions
              </Menu.Item>
            </div>
          </>
        ) : (
          <div role="menu" aria-label="Request actions" style={{ padding: '0.25rem' }}>
            <Menu.Item icon={<Layers size={14} />} onClick={() => setPicking(true)}>
              Nest under another request
            </Menu.Item>
            <Menu.Item
              icon={<ArrowUpRight size={14} />}
              disabled={!hasParent}
              onClick={() => { if (hasParent) void makeTopLevel() }}
            >
              Make top-level
            </Menu.Item>
            <Menu.Item icon={<Copy size={14} />} onClick={() => { void duplicate() }}>
              Duplicate
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item icon={<Inbox size={14} />} onClick={() => { close(); setPending('archive') }}>
              Archive
            </Menu.Item>
            <Menu.Item icon={<Trash2 size={14} />} tone="danger" onClick={() => { close(); setPending('delete') }}>
              Delete
            </Menu.Item>
          </div>
        )}
      </Popover>

      <ConfirmDialog
        open={pending === 'archive'}
        title="Archive this request?"
        description="It moves off the delivery spine and out of the active boards, and stays searchable. You can bring it back by setting its status again."
        confirmLabel="Archive"
        variant="warning"
        onConfirm={archive}
        onCancel={() => setPending(null)}
      />

      <ConfirmDialog
        open={pending === 'delete'}
        title="Delete this request?"
        description="It disappears from every board and list, along with its thread and files. The row is kept for the audit trail, so the studio can still find and restore it."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={remove}
        onCancel={() => setPending(null)}
      />
    </>
  )
}
