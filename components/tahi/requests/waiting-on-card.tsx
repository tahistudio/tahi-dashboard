'use client'

/**
 * <WaitingOnCard>. The studio rail's "Waiting on" card (Liam's client
 * hand-off feature): who this request is currently waiting on, why, since
 * when, and the two commands that move it (Hand off, Hand back).
 *
 * Same shape as <RequestBlockersCard> next to it: its own dialog, its own
 * fetches, gated twice the same way (isAdmin renders it at all, canWrite
 * decides whether the commands are live). An empty read-only card is noise
 * on a rail that already runs past the fold, so it renders nothing when
 * there is nothing waiting and no write access to start one.
 *
 * The routes this posts to (`POST` / `DELETE`
 * `/api/admin/requests/[id]/handoff`) are H1's (schema + API) to build; this
 * slice is UI only. Until that route exists the dialog's submit answers 404
 * and the toast says so, same as any other route not deployed yet, which
 * hurts nothing once H1 merges.
 */

import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { Handshake, Loader2, X, ChevronRight } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { SidebarCard, RAIL_ACTION_CLASS, RAIL_ACTION_STYLE } from '@/components/tahi/rail/sidebar-card'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import {
  focusablesIn, isOrphanedFocus, lockBodyScroll, overlayLayers, shouldHandleEscape,
} from '@/components/tahi/overlay-stack'
import {
  WAITING_REASON_OPTIONS,
  daysWaiting,
  waitingReasonSentence,
  type WaitingOnSummary,
  type WaitingReason,
} from '@/lib/request-handoff-types'

export interface ContactOption {
  id: string
  name: string
  email: string | null
}

export interface WaitingOnCardProps {
  requestId: string
  orgId: string
  canWrite: boolean
  waitingOn: WaitingOnSummary | null
  /** Fired after a successful hand off, hand back, or change so the caller
   *  can update the request it holds (and, once H1 ships the field on the
   *  detail payload, drop this in favour of a plain SWR revalidate). */
  onChange: (next: WaitingOnSummary | null) => void
}

export function WaitingOnCard({ requestId, orgId, canWrite, waitingOn, onChange }: WaitingOnCardProps) {
  const { showToast } = useToast()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [handingBack, setHandingBack] = useState(false)

  // Nothing waiting and no write access: same rule the Blocked by card uses.
  if (!canWrite && !waitingOn) return null

  async function handBack() {
    setHandingBack(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/handoff`), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('failed')
      onChange(null)
    } catch {
      showToast('Could not hand this back', 'error')
    } finally {
      setHandingBack(false)
    }
  }

  return (
    <SidebarCard title="Waiting on" icon={<Handshake size={14} />}>
      {waitingOn ? (
        <div className="flex flex-col" style={{ gap: '0.5rem' }}>
          <div>
            <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>
              {waitingOn.contactName}
            </p>
            <p style={{ margin: '0.125rem 0 0', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              {waitingReasonSentence(waitingOn.reason)}
            </p>
          </div>
          <div
            className="flex flex-wrap items-center"
            style={{ gap: '0.375rem 0.625rem', fontSize: '0.71875rem', color: 'var(--color-text-subtle)' }}
          >
            <span>{daysWaiting(waitingOn.since)}d waiting</span>
            {waitingOn.dueAt && <span>Due {formatWaitingDate(waitingOn.dueAt)}</span>}
          </div>
          {waitingOn.note && (
            <p
              style={{
                margin: 0,
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
                background: 'var(--color-bg-secondary)',
                borderRadius: 'var(--radius-md)',
                padding: '0.5rem 0.625rem',
                lineHeight: 1.5,
              }}
            >
              {waitingOn.note}
            </p>
          )}
          {canWrite && (
            <div className="flex flex-col" style={{ gap: '0.375rem', marginTop: '0.125rem' }}>
              <button
                type="button"
                onClick={handBack}
                disabled={handingBack}
                className={RAIL_ACTION_CLASS}
                style={{
                  ...RAIL_ACTION_STYLE,
                  border: '1px solid var(--color-border)',
                  background: 'var(--color-bg)',
                  color: 'var(--color-text-muted)',
                  cursor: handingBack ? 'not-allowed' : 'pointer',
                  opacity: handingBack ? 0.6 : 1,
                }}
              >
                {handingBack
                  ? <Loader2 size={13} className="animate-spin" aria-hidden="true" />
                  : <Handshake size={13} aria-hidden="true" />}
                {handingBack ? 'Handing back…' : 'Hand back'}
              </button>
              <button
                type="button"
                onClick={() => setDialogOpen(true)}
                className={RAIL_ACTION_CLASS}
                style={{
                  ...RAIL_ACTION_STYLE,
                  border: '1px solid transparent',
                  background: 'transparent',
                  color: 'var(--color-text-subtle)',
                  cursor: 'pointer',
                }}
              >
                Change
              </button>
            </div>
          )}
        </div>
      ) : (
        canWrite && (
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={RAIL_ACTION_CLASS}
            style={{
              ...RAIL_ACTION_STYLE,
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: 'pointer',
            }}
          >
            <Handshake size={13} aria-hidden="true" />
            Hand off to a client
          </button>
        )
      )}

      {canWrite && (
        <HandoffDialog
          open={dialogOpen}
          orgId={orgId}
          requestId={requestId}
          initial={waitingOn}
          onClose={() => setDialogOpen(false)}
          onSaved={next => {
            onChange(next)
            setDialogOpen(false)
          }}
        />
      )}
    </SidebarCard>
  )
}

function formatWaitingDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ---- Hand off dialog ----------------------------------------------------------

interface HandoffDialogProps {
  open: boolean
  orgId: string
  requestId: string
  initial: WaitingOnSummary | null
  onClose: () => void
  onSaved: (next: WaitingOnSummary) => void
}

/**
 * The contact picker, reason select, note, and optional due date. Modelled
 * on <ConfirmDialog>'s escape / focus-trap / body-lock trio rather than
 * duplicating it wholesale, since this dialog carries a form instead of a
 * single confirm button.
 */
function HandoffDialog({ open, orgId, requestId, initial, onClose, onSaved }: HandoffDialogProps) {
  const { showToast } = useToast()
  const layerId = useId()
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  const [contacts, setContacts] = useState<ContactOption[]>([])
  const [contactId, setContactId] = useState<string | null>(initial?.contactId ?? null)
  const [reason, setReason] = useState<WaitingReason>(initial?.reason ?? 'approval')
  const [note, setNote] = useState(initial?.note ?? '')
  const [dueAt, setDueAt] = useState(initial?.dueAt ? initial.dueAt.slice(0, 10) : '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setContactId(initial?.contactId ?? null)
    setReason(initial?.reason ?? 'approval')
    setNote(initial?.note ?? '')
    setDueAt(initial?.dueAt ? initial.dueAt.slice(0, 10) : '')
  }, [open, initial])

  useEffect(() => {
    if (!open || !orgId) return
    fetch(apiPath(`/api/admin/clients/${orgId}/contacts`))
      .then(r => (r.ok ? r.json() as Promise<{ contacts?: ContactOption[] }> : { contacts: [] }))
      .then(d => setContacts(d.contacts ?? []))
      .catch(() => setContacts([]))
  }, [open, orgId])

  useEffect(() => {
    if (!open) return
    overlayLayers.push(layerId)
    return () => overlayLayers.remove(layerId)
  }, [open, layerId])

  useEffect(() => {
    if (!open) return
    return lockBodyScroll()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (!shouldHandleEscape(e, layerId)) return
      if (saving) return
      e.preventDefault()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose, saving, layerId])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => {
      const el = panelRef.current
      if (!el) return
      const active = document.activeElement
      if (active && active !== el && el.contains(active)) return
      const target = focusablesIn(el)[0]
      if (target) target.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const el = panelRef.current
      if (!el) return
      const items = focusablesIn(el)
      if (items.length === 0) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (isOrphanedFocus(active)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first).focus()
        return
      }
      if (!active || !el.contains(active)) return
      if (e.shiftKey && active === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  const contactOptions = useMemo(
    () => contacts.map(c => ({ value: c.id, label: c.email ? `${c.name} (${c.email})` : c.name })),
    [contacts],
  )
  const reasonOptions = useMemo(
    () => WAITING_REASON_OPTIONS.map(r => ({ value: r.value, label: r.label, subtitle: r.sentence })),
    [],
  )

  if (!open) return null

  const selectedContact = contacts.find(c => c.id === contactId) ?? null

  async function handleSave() {
    if (!contactId) {
      showToast('Pick a contact to hand this off to', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/requests/${requestId}/handoff`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId,
          reason,
          note: note.trim() || undefined,
          dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : undefined,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { error?: string } | null
        throw new Error(body?.error ?? 'Could not hand this off')
      }
      const json = await res.json() as { request?: { waitingOn?: WaitingOnSummary } }
      const next = json.request?.waitingOn ?? {
        contactId,
        contactName: selectedContact?.name ?? 'this contact',
        contactEmail: selectedContact?.email ?? null,
        reason,
        since: new Date().toISOString(),
        dueAt: dueAt ? new Date(`${dueAt}T00:00:00.000Z`).toISOString() : null,
        note: note.trim() || null,
      }
      onSaved(next)
    } catch (err) {
      showToast(err instanceof Error && err.message ? err.message : 'Could not hand this off', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.4)',
        padding: '1rem',
      }}
      onClick={e => {
        if (e.target === e.currentTarget && !saving) onClose()
      }}
    >
      <div
        ref={panelRef}
        style={{
          background: 'var(--color-bg)',
          borderRadius: 'var(--radius-leaf-lg, 0 24px 0 24px)',
          padding: '1.5rem',
          width: '100%',
          maxWidth: '26rem',
          boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.875rem',
        }}
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>
            Hand off to a client
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Close"
            className="tahi-focus-ring flex items-center justify-center"
            style={{
              width: '1.75rem', height: '1.75rem', flexShrink: 0,
              border: 'none', background: 'transparent',
              color: 'var(--color-text-subtle)', cursor: saving ? 'not-allowed' : 'pointer',
              borderRadius: '0.375rem',
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>

        <FieldLabel htmlFor="waiting-on-contact">Contact</FieldLabel>
        <SearchableSelect
          options={contactOptions}
          value={contactId}
          onChange={setContactId}
          placeholder="Pick a contact"
          searchPlaceholder="Search contacts…"
          emptyMessage="No contacts on this org yet"
        />

        <FieldLabel htmlFor="waiting-on-reason">Reason</FieldLabel>
        <SearchableSelect
          options={reasonOptions}
          value={reason}
          onChange={v => { if (v) setReason(v as WaitingReason) }}
          placeholder="Pick a reason"
        />

        <div>
          <FieldLabel htmlFor="waiting-on-note">Note (optional)</FieldLabel>
          <textarea
            id="waiting-on-note"
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder="Anything specific they need to know"
            style={{
              width: '100%',
              marginTop: '0.375rem',
              padding: '0.5625rem 0.6875rem',
              fontSize: '0.8125rem',
              fontFamily: 'inherit',
              color: 'var(--color-text)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              resize: 'vertical',
            }}
          />
        </div>

        <div>
          <FieldLabel htmlFor="waiting-on-due">Due date (optional)</FieldLabel>
          <input
            id="waiting-on-due"
            type="date"
            value={dueAt}
            onChange={e => setDueAt(e.target.value)}
            style={{
              width: '100%',
              marginTop: '0.375rem',
              padding: '0.5625rem 0.6875rem',
              fontSize: '0.8125rem',
              fontFamily: 'inherit',
              color: 'var(--color-text)',
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md)',
              minHeight: '2.75rem',
            }}
          />
        </div>

        <div className="flex items-center justify-end" style={{ gap: '0.5rem', marginTop: '0.25rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="tahi-focus-ring"
            style={{
              minHeight: '2.75rem',
              padding: '0 1rem',
              fontSize: '0.8125rem',
              fontWeight: 500,
              borderRadius: 'var(--radius-button)',
              border: '1px solid var(--color-border)',
              background: 'var(--color-bg)',
              color: 'var(--color-text-muted)',
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !contactId}
            className="tahi-focus-ring inline-flex items-center"
            style={{
              gap: '0.375rem',
              minHeight: '2.75rem',
              padding: '0 1.125rem',
              fontSize: '0.8125rem',
              fontWeight: 600,
              borderRadius: 'var(--radius-leaf, 0 16px 0 16px)',
              border: 'none',
              background: saving || !contactId ? 'var(--color-bg-tertiary)' : 'var(--color-brand)',
              color: saving || !contactId ? 'var(--color-text-subtle)' : '#ffffff',
              cursor: saving || !contactId ? 'not-allowed' : 'pointer',
            }}
          >
            {saving
              ? <Loader2 size={14} className="animate-spin" aria-hidden="true" />
              : <ChevronRight size={14} aria-hidden="true" />}
            {saving ? 'Handing off…' : 'Hand off'}
          </button>
        </div>
      </div>
    </div>
  )
}

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: ReactNode }) {
  return (
    <label
      htmlFor={htmlFor}
      style={{
        display: 'block',
        fontSize: '0.71875rem',
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        marginBottom: '-0.25rem',
      }}
    >
      {children}
    </label>
  )
}
