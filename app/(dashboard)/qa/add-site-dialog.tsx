'use client'

/**
 * <AddSiteDialog>. Create or edit a QA site. Built on the shared <SlideOver>
 * centred variant (focus trap, Escape, scroll lock), <SearchableSelect> for
 * the client picker and the shared <Input>, <Textarea> primitives.
 *
 * Create mode (no `site`): POSTs /api/admin/qa/sites. On success it closes and
 * either calls `onSaved` or routes to /qa/<id>.
 * Edit mode (`site` given): PATCHes /api/admin/qa/sites/<id>. The client picker
 * is locked. On success it closes and calls `onSaved` when provided.
 *
 * Pass a stable `site` object (from state), not an inline literal, so the
 * form is not reset on every parent render.
 */

import { useEffect, useId, useState, type CSSProperties } from 'react'
import { useRouter } from 'next/navigation'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Textarea } from '@/components/tahi/input'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { TahiButton } from '@/components/tahi/tahi-button'

export interface QaSiteFormValue {
  id: string
  orgId: string
  name: string
  stagingUrl: string | null
  liveUrl: string | null
  notes: string | null
}

interface AddSiteDialogProps {
  open: boolean
  onClose: () => void
  onSaved?: (site: QaSiteFormValue) => void
  defaultOrgId?: string
  site?: QaSiteFormValue
}

interface ClientOption {
  id: string
  name: string
}

const LABEL_STYLE: CSSProperties = {
  display: 'block',
  fontSize: 'var(--text-sm)',
  fontWeight: 600,
  color: 'var(--color-text)',
  marginBottom: 'var(--space-1-5)',
}

const HINT_STYLE: CSSProperties = {
  fontSize: 'var(--text-xs)',
  color: 'var(--color-text-muted)',
  marginTop: 'var(--space-1)',
}

const ERROR_STYLE: CSSProperties = {
  fontSize: 'var(--text-sm)',
  color: 'var(--color-danger)',
  marginTop: 'var(--space-3)',
}

const FIELD_STACK_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-4)',
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
}

function readErrorText(json: unknown, fallback: string): string {
  const message = readRecord(json)?.error
  return typeof message === 'string' && message.length > 0 ? message : fallback
}

function readSavedSite(json: unknown): QaSiteFormValue | null {
  const item = readRecord(readRecord(json)?.item)
  if (!item) return null
  if (typeof item.id !== 'string' || typeof item.orgId !== 'string' || typeof item.name !== 'string') return null
  return {
    id: item.id,
    orgId: item.orgId,
    name: item.name,
    stagingUrl: typeof item.stagingUrl === 'string' ? item.stagingUrl : null,
    liveUrl: typeof item.liveUrl === 'string' ? item.liveUrl : null,
    notes: typeof item.notes === 'string' ? item.notes : null,
  }
}

function readClients(json: unknown): ClientOption[] {
  const list = readRecord(json)?.organisations
  if (!Array.isArray(list)) return []
  const clients: ClientOption[] = []
  for (const entry of list) {
    const row = readRecord(entry)
    if (row && typeof row.id === 'string' && typeof row.name === 'string') {
      clients.push({ id: row.id, name: row.name })
    }
  }
  return clients
}

export function AddSiteDialog({ open, onClose, onSaved, defaultOrgId, site }: AddSiteDialogProps) {
  const router = useRouter()
  const clientLabelId = useId()
  const nameId = useId()
  const stagingId = useId()
  const liveId = useId()
  const notesId = useId()
  const stagingHintId = useId()
  const liveHintId = useId()

  const [clients, setClients] = useState<ClientOption[]>([])
  const [clientsLoading, setClientsLoading] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [name, setName] = useState('')
  const [stagingUrl, setStagingUrl] = useState('')
  const [liveUrl, setLiveUrl] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setOrgId(site?.orgId ?? defaultOrgId ?? '')
    setName(site?.name ?? '')
    setStagingUrl(site?.stagingUrl ?? '')
    setLiveUrl(site?.liveUrl ?? '')
    setNotes(site?.notes ?? '')
    setError(null)
    setSaving(false)
  }, [open, site, defaultOrgId])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setClientsLoading(true)
    fetch(apiPath('/api/admin/clients?status=active'))
      .then(res => res.json() as Promise<unknown>)
      .then(json => {
        if (!cancelled) setClients(readClients(json))
      })
      .catch(() => {
        if (!cancelled) setClients([])
      })
      .finally(() => {
        if (!cancelled) setClientsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open])

  async function handleSubmit() {
    if (saving) return
    const trimmedName = name.trim()
    const trimmedStaging = stagingUrl.trim()
    const trimmedLive = liveUrl.trim()

    if (!site && !orgId) {
      setError('Choose a client for this site.')
      return
    }
    if (!trimmedName) {
      setError('Add a name for this site.')
      return
    }
    if (!trimmedStaging && !trimmedLive) {
      setError('Add a staging URL, a live URL, or both.')
      return
    }

    setSaving(true)
    setError(null)
    const fields = {
      name: trimmedName,
      stagingUrl: trimmedStaging || null,
      liveUrl: trimmedLive || null,
      notes: notes.trim() || null,
    }

    try {
      const res = site
        ? await fetch(apiPath(`/api/admin/qa/sites/${site.id}`), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(fields),
          })
        : await fetch(apiPath('/api/admin/qa/sites'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orgId, ...fields }),
          })
      const json: unknown = await res.json().catch(() => null)

      if (!res.ok) {
        setError(readErrorText(json, 'The site could not be saved. Try again.'))
        setSaving(false)
        return
      }

      const saved: QaSiteFormValue | null = readSavedSite(json) ?? (site
        ? { ...site, ...fields }
        : null)
      if (!saved) {
        setError('The site was saved, but the response was incomplete. Refresh the page.')
        setSaving(false)
        return
      }

      setSaving(false)
      onClose()
      if (onSaved) {
        onSaved(saved)
      } else if (!site) {
        router.push(`/qa/${saved.id}`)
      }
    } catch {
      setError('Network error. Check your connection and try again.')
      setSaving(false)
    }
  }

  const clientOptions = clients.map(client => ({ value: client.id, label: client.name }))
  const isEdit = Boolean(site)

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit site' : 'Add site'}
      variant="center"
      maxWidth="36rem"
    >
      <SlideOver.Body>
        <form
          noValidate
          id="qa-site-form"
          onSubmit={event => {
            event.preventDefault()
            void handleSubmit()
          }}
          style={FIELD_STACK_STYLE}
        >
          <div>
            <span id={clientLabelId} style={LABEL_STYLE}>Client</span>
            <div role="group" aria-labelledby={clientLabelId}>
              <SearchableSelect
                options={clientOptions}
                value={orgId || null}
                disabled={isEdit || clientsLoading}
                onChange={value => setOrgId(value ?? '')}
                placeholder={clientsLoading ? 'Loading clients...' : 'Select a client...'}
                searchPlaceholder="Search clients..."
              />
            </div>
            {isEdit && (
              <p style={HINT_STYLE}>The client cannot be changed after a site is created.</p>
            )}
          </div>

          <div>
            <label htmlFor={nameId} style={LABEL_STYLE}>Name</label>
            <Input
              id={nameId}
              value={name}
              onChange={event => setName(event.target.value)}
              placeholder="Marketing site"
              autoComplete="off"
              required
              aria-required="true"
            />
          </div>

          <div>
            <label htmlFor={stagingId} style={LABEL_STYLE}>Staging URL</label>
            <Input
              id={stagingId}
              type="url"
              inputMode="url"
              value={stagingUrl}
              onChange={event => setStagingUrl(event.target.value)}
              placeholder="https://client-site.webflow.io"
              autoComplete="off"
              aria-describedby={stagingHintId}
            />
            <p id={stagingHintId} style={HINT_STYLE}>Used for pre-launch rounds. Only the origin is stored.</p>
          </div>

          <div>
            <label htmlFor={liveId} style={LABEL_STYLE}>Live URL</label>
            <Input
              id={liveId}
              type="url"
              inputMode="url"
              value={liveUrl}
              onChange={event => setLiveUrl(event.target.value)}
              placeholder="https://www.client.com"
              autoComplete="off"
              aria-describedby={liveHintId}
            />
            <p id={liveHintId} style={HINT_STYLE}>Used for live checks. Add a staging URL, a live URL, or both.</p>
          </div>

          <div>
            <label htmlFor={notesId} style={LABEL_STYLE}>Notes</label>
            <Textarea
              id={notesId}
              rows={3}
              value={notes}
              onChange={event => setNotes(event.target.value)}
              placeholder="Anything the QA round should know"
            />
          </div>

          {error && (
            <p role="alert" style={ERROR_STYLE}>{error}</p>
          )}
        </form>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </TahiButton>
        <TahiButton type="submit" form="qa-site-form" variant="primary" loading={saving} disabled={saving}>
          {isEdit ? 'Save changes' : 'Add site'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}
