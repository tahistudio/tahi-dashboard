'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import {
  SectionShell,
  Toggle,
  Seg,
  Chip,
  EmptyRow,
  RowActions,
  type ChipTone,
} from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

/**
 * Announcements settings section (admin only).
 *
 * Compose a portal banner (title, body, emoji, tone, cta label + link,
 * audience, expiry, active), preview it with the real .ann-bar markup, then
 * publish it. Everything persists through the announcements API:
 *
 *   GET    /api/admin/announcements        -> { announcements: AnnouncementRow[] }
 *   POST   /api/admin/announcements        -> create (+ optional email fan-out)
 *   PATCH  /api/admin/announcements/[id]   -> edit fields, publish/unpublish
 *   DELETE /api/admin/announcements/[id]   -> remove
 *   POST   /api/admin/announcements/[id]/send -> publish a draft (+ guarded email)
 *
 * emoji / ctaLabel / ctaUrl are real columns (migration 0084) and flow through
 * to the live portal banner (components/tahi/announcement-banner.tsx), which
 * renders the CTA only when both label and link are present - hence the
 * link validation before publishing.
 */

interface AnnouncementRow {
  id: string
  title: string
  body: string
  type: string
  targetType: string
  targetValue: string | null
  targetIds: string | null
  publishedAt: string | null
  createdAt: string
  expiresAt: string | null
  emoji: string | null
  ctaLabel: string | null
  ctaUrl: string | null
}

interface Org {
  id: string
  name: string
  planType?: string | null
}

const EMOJI = ['\u{1F4E3}', '\u{1F389}', '\u{1F680}', '\u{1F6E0}\u{FE0F}', '✨', '⚠\u{FE0F}', '\u{1F33F}', '\u{1F44B}']

// Design tones map onto the persisted announcement `type` values.
const TONE_OPTS: [string, string][] = [
  ['info', 'Info'],
  ['success', 'Success'],
  ['maintenance', 'Maintenance'],
]

// Audience maps onto the real targeting model (targetType all | plan_type | org).
const AUDIENCE_OPTS: [string, string][] = [
  ['all', 'All clients'],
  ['plan_type', 'By plan type'],
  ['org', 'Specific clients'],
]

const PLAN_OPTS = ['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom']

function toneToChip(type: string): ChipTone {
  if (type === 'success') return 'success'
  if (type === 'maintenance' || type === 'warning') return 'warning'
  return 'info'
}

function audienceLabel(row: AnnouncementRow): string {
  if (row.targetType === 'plan_type') return 'Plan: ' + (row.targetValue ?? 'any')
  if (row.targetType === 'org') return 'Specific clients'
  return 'All clients'
}

function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

/** ISO timestamp -> value for <input type="datetime-local"> in local time. */
function isoToLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local value (local time) -> ISO timestamp, or null when unset/invalid. */
function localInputToIso(value: string): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString()
}

export function AnnouncementsSection() {
  const [title, setTitle] = useState('Client portal, refreshed')
  const [body, setBody] = useState(
    'We have rebuilt how your projects are presented: calmer, clearer, and faster to scan.',
  )
  const [emoji, setEmoji] = useState(EMOJI[0])
  const [tone, setTone] = useState('info')
  const [cta, setCta] = useState('See what is new')
  const [ctaUrl, setCtaUrl] = useState('')
  const [expires, setExpires] = useState('')
  const [targetType, setTargetType] = useState('all')
  const [plan, setPlan] = useState(PLAN_OPTS[0])
  const [orgIds, setOrgIds] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [sendEmail, setSendEmail] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [newId, setNewId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [flash, setFlash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { data, isLoading, mutate } = useResource<{ announcements: AnnouncementRow[] }>(
    '/api/admin/announcements',
  )
  const announcements = useMemo(() => data?.announcements ?? [], [data])

  // Only load the client list when targeting specific clients.
  const { data: clientData } = useResource<{ organisations: Org[] }>(
    targetType === 'org' ? '/api/admin/clients?limit=100' : null,
  )
  const orgs = clientData?.organisations ?? []

  function toggleOrg(id: string) {
    setOrgIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]))
  }

  function flashFor(message: string) {
    setFlash(message)
    setTimeout(() => setFlash(null), 3600)
  }

  function beginEdit(a: AnnouncementRow) {
    setEditingId(a.id)
    setTitle(a.title)
    setBody(a.body)
    setEmoji(a.emoji || EMOJI[0])
    setTone(a.type === 'warning' ? 'maintenance' : a.type)
    setCta(a.ctaLabel ?? '')
    setCtaUrl(a.ctaUrl ?? '')
    setExpires(isoToLocalInput(a.expiresAt))
    setTargetType(a.targetType)
    if (a.targetType === 'plan_type') setPlan(a.targetValue ?? PLAN_OPTS[0])
    if (a.targetType === 'org') {
      try {
        const parsed: unknown = a.targetIds ? JSON.parse(a.targetIds) : []
        setOrgIds(
          Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [],
        )
      } catch {
        setOrgIds([])
      }
    }
    setActive(!!a.publishedAt)
    setSendEmail(false)
    setError(null)
    setFlash(null)
  }

  function cancelEdit() {
    setEditingId(null)
    setError(null)
  }

  function validate(): boolean {
    if (!title.trim()) {
      setError('Add a title before publishing.')
      return false
    }
    if (!body.trim()) {
      setError('Add a message before publishing.')
      return false
    }
    if (cta.trim() && !/^https?:\/\//.test(ctaUrl.trim())) {
      setError('Add a button link (https://...) so the button works, or clear the label.')
      return false
    }
    if (targetType === 'org' && orgIds.length === 0) {
      setError('Pick at least one client to show this banner to.')
      return false
    }
    setError(null)
    return true
  }

  async function publish() {
    if (!validate()) return
    setSaving(true)
    try {
      const ctaLabel = cta.trim() || null
      const link = ctaUrl.trim() || null
      const base = {
        title: title.trim(),
        content: body.trim(),
        type: tone,
        targetType,
        targetValue: targetType === 'plan_type' ? plan : null,
        targetIds: targetType === 'org' ? orgIds : null,
        emoji: emoji.trim() || null,
        ctaLabel,
        ctaUrl: link,
        expiresAt: localInputToIso(expires),
        publish: active,
      }

      if (editingId) {
        const res = await fetch(apiPath(`/api/admin/announcements/${editingId}`), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(base),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'Failed to save changes')
        }
        setEditingId(null)
        flashFor(active ? 'Announcement updated.' : 'Draft updated.')
      } else {
        // Email only fans out for a published announcement; a draft stays silent.
        const payload = { ...base, sendEmail: sendEmail && active ? true : undefined }
        const res = await fetch(apiPath('/api/admin/announcements'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const j = (await res.json().catch(() => null)) as { error?: string } | null
          throw new Error(j?.error ?? 'Failed to publish')
        }
        const result = (await res.json().catch(() => null)) as
          | { id?: string; emailed?: number }
          | null
        setNewId(result?.id ?? null)
        const emailed = result?.emailed ?? 0
        if (!active) {
          flashFor('Saved as a draft.')
        } else if (sendEmail) {
          flashFor(
            emailed > 0
              ? `Published to the workspace and emailed ${emailed} ${emailed === 1 ? 'client' : 'clients'}.`
              : 'Published to the workspace. No clients were emailed.',
          )
        } else {
          flashFor('Published to the workspace.')
        }
      }
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSaving(false)
    }
  }

  async function unpublishRow(a: AnnouncementRow) {
    setBusyId(a.id)
    try {
      const res = await fetch(apiPath(`/api/admin/announcements/${a.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ publish: false }),
      })
      if (!res.ok) throw new Error('Failed to unpublish')
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to unpublish.')
    } finally {
      setBusyId(null)
    }
  }

  async function publishRow(a: AnnouncementRow) {
    setBusyId(a.id)
    try {
      // The send route publishes and, when the draft was created with email
      // delivery on, fans the email out once (guarded against double-sends).
      const res = await fetch(apiPath(`/api/admin/announcements/${a.id}/send`), {
        method: 'POST',
      })
      if (!res.ok) throw new Error('Failed to publish')
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to publish.')
    } finally {
      setBusyId(null)
    }
  }

  async function deleteRow(a: AnnouncementRow) {
    setBusyId(a.id)
    try {
      const res = await fetch(apiPath(`/api/admin/announcements/${a.id}`), {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Failed to delete')
      if (editingId === a.id) setEditingId(null)
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete.')
    } finally {
      setBusyId(null)
    }
  }

  const previewTone = tone === 'maintenance' ? 'maintenance' : tone

  return (
    <SectionShell
      title="Announcements"
      lede="Compose a message for your clients, then publish it to show a banner across their portal."
    >
      <div className="set-card">
        <div className="set-grid2" style={{ gridTemplateColumns: '1fr' }}>
          <div className="set-field">
            <label>Title</label>
            <input
              className="set-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="set-field">
            <label>Message</label>
            <textarea
              className="set-input"
              rows={3}
              style={{ resize: 'vertical', lineHeight: 1.5 }}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </div>
        </div>

        <div
          className="set-row"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 12,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div className="sr-t">
            <b>Emoji</b>
            <small>Shown at the start of the banner.</small>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {EMOJI.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setEmoji(e)}
                aria-label={'Use ' + e}
                aria-pressed={emoji === e}
                style={{
                  width: 42,
                  height: 42,
                  fontSize: 20,
                  borderRadius: 10,
                  cursor: 'pointer',
                  background: emoji === e ? 'var(--brand-100)' : 'var(--bg)',
                  border: emoji === e ? '2px solid var(--brand)' : '1px solid var(--border)',
                }}
              >
                {e}
              </button>
            ))}
            <input
              className="set-input"
              value={emoji}
              onChange={(e) => setEmoji(e.target.value.slice(0, 2))}
              aria-label="Custom emoji"
              style={{ width: 66, textAlign: 'center', fontSize: 18 }}
            />
          </div>
        </div>

        <div
          className="set-row"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            gap: 12,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div className="sr-t">
              <b>Tone</b>
              <small>Sets the accent and icon colour.</small>
            </div>
            <Seg aria="Tone" value={tone} onChange={setTone} opts={TONE_OPTS} />
          </div>
        </div>

        <div
          className="set-grid2"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}
        >
          <div className="set-field">
            <label>Button label</label>
            <input
              className="set-input"
              value={cta}
              onChange={(e) => setCta(e.target.value)}
              placeholder="Optional"
            />
          </div>
          <div className="set-field">
            <label>Audience</label>
            <select
              className="set-input"
              value={targetType}
              onChange={(e) => setTargetType(e.target.value)}
            >
              {AUDIENCE_OPTS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div
          className="set-grid2"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}
        >
          <div className="set-field">
            <label>Button link</label>
            <input
              className="set-input"
              value={ctaUrl}
              onChange={(e) => setCtaUrl(e.target.value)}
              placeholder="https://"
              inputMode="url"
            />
          </div>
          <div className="set-field">
            <label>Expires (optional)</label>
            <input
              className="set-input"
              type="datetime-local"
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
              aria-label="Expiry date and time"
            />
          </div>
        </div>

        {targetType === 'plan_type' && (
          <div
            className="set-row"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 8,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div className="sr-t">
              <b>Plan type</b>
              <small>Only clients on this plan see the banner.</small>
            </div>
            <select
              className="set-input"
              style={{ maxWidth: 240, textTransform: 'capitalize' }}
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
            >
              {PLAN_OPTS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </div>
        )}

        {targetType === 'org' && (
          <div
            className="set-row"
            style={{
              flexDirection: 'column',
              alignItems: 'stretch',
              gap: 10,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            <div className="sr-t">
              <b>Clients</b>
              <small>
                {orgIds.length
                  ? orgIds.length + ' selected'
                  : 'Pick the clients who should see this banner.'}
              </small>
            </div>
            {!orgs.length ? (
              <EmptyRow text="No clients to choose from yet." />
            ) : (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  maxHeight: 180,
                  overflowY: 'auto',
                }}
              >
                {orgs.map((o) => {
                  const on = orgIds.includes(o.id)
                  return (
                    <button
                      key={o.id}
                      type="button"
                      onClick={() => toggleOrg(o.id)}
                      aria-pressed={on}
                      style={{
                        font: '600 12.5px Manrope, sans-serif',
                        padding: '7px 12px',
                        borderRadius: 999,
                        cursor: 'pointer',
                        color: on ? 'var(--brand-strong)' : 'var(--text-muted)',
                        background: on ? 'var(--brand-100)' : 'var(--bg)',
                        border: on ? '1px solid var(--brand)' : '1px solid var(--border)',
                      }}
                    >
                      {o.name}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )}

        <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="sr-t">
            <b>Active</b>
            <small>Off saves it as a draft; it will not appear on the portal.</small>
          </div>
          <Toggle on={active} onClick={() => setActive((a) => !a)} ariaLabel="Active" />
        </div>

        {!editingId && (
          <div className="set-row" style={{ borderTop: '1px solid var(--border-subtle)' }}>
            <div className="sr-t">
              <b>Also send email</b>
              <small>Email the announcement to the audience as well when you publish.</small>
            </div>
            <Toggle
              on={sendEmail}
              onClick={() => setSendEmail((s) => !s)}
              ariaLabel="Also send email"
            />
          </div>
        )}
      </div>

      <div className="set-sub-label">Live preview</div>
      <div className="ann-preview">
        <div className={'ann-bar ann-' + previewTone}>
          <span className="ann-emoji" aria-hidden="true">
            {emoji || EMOJI[0]}
          </span>
          <div className="ann-txt">
            <b>{title || 'Untitled announcement'}</b>
            <span>{body}</span>
          </div>
          {cta && <button className="ann-cta">{cta}</button>}
          <button className="ann-x" aria-label="Dismiss">
            {'×'}
          </button>
        </div>
      </div>

      <div className="set-row" style={{ justifyContent: 'flex-end', gap: 14, border: 'none' }}>
        {error && (
          <span style={{ font: '500 12.5px Manrope, sans-serif', color: 'var(--danger)' }}>
            {error}
          </span>
        )}
        {flash && (
          <span style={{ font: '500 12.5px Manrope, sans-serif', color: 'var(--brand-strong)' }}>
            {flash}
          </span>
        )}
        {editingId && (
          <button type="button" className="btn-ghost" onClick={cancelEdit}>
            Cancel edit
          </button>
        )}
        <button className="btn1" onClick={publish} disabled={saving}>
          <Check size={15} />
          {saving
            ? 'Saving...'
            : editingId
              ? 'Save changes'
              : active
                ? 'Publish announcement'
                : 'Save draft'}
        </button>
      </div>

      <div className="set-sub-label">Past announcements</div>
      <div className="set-card lrow-wrap">
        {isLoading ? (
          [0, 1].map((i) => (
            <div
              key={i}
              className="lrow"
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <div className="lrow-t">
                <span
                  className="animate-pulse"
                  style={{
                    display: 'block',
                    width: '38%',
                    height: 13,
                    borderRadius: 6,
                    background: 'var(--bg-tertiary)',
                  }}
                />
                <span
                  className="animate-pulse"
                  style={{
                    display: 'block',
                    width: '22%',
                    height: 10,
                    borderRadius: 6,
                    background: 'var(--bg-tertiary)',
                    marginTop: 7,
                  }}
                />
              </div>
            </div>
          ))
        ) : !announcements.length ? (
          <EmptyRow text="No announcements yet. Compose one above to get started." />
        ) : (
          announcements.map((a, i) => (
            <div
              key={a.id}
              className={'lrow' + (a.id === newId ? ' lrow-enter' : '')}
              style={i ? { borderTop: '1px solid var(--border-subtle)' } : undefined}
            >
              <div className="lrow-t">
                <b>{a.title}</b>
                <small>
                  {audienceLabel(a)} {'·'} {formatDate(a.createdAt)}
                </small>
              </div>
              <div className="lrow-r">
                <Chip tone={toneToChip(a.type)}>{a.type}</Chip>
                <Chip tone={a.publishedAt ? 'brand' : 'neutral'}>
                  {a.publishedAt ? 'Published' : 'Draft'}
                </Chip>
                {a.publishedAt ? (
                  <button
                    type="button"
                    className="btn2 sm"
                    onClick={() => void unpublishRow(a)}
                    disabled={busyId === a.id}
                  >
                    Unpublish
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn2 sm"
                    onClick={() => void publishRow(a)}
                    disabled={busyId === a.id}
                  >
                    Publish
                  </button>
                )}
                <RowActions onEdit={() => beginEdit(a)} onDelete={() => void deleteRow(a)} />
              </div>
            </div>
          ))
        )}
      </div>
    </SectionShell>
  )
}
