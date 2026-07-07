'use client'

import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import {
  SectionShell,
  Toggle,
  Seg,
  Chip,
  EmptyRow,
  type ChipTone,
} from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'

/**
 * Announcements settings section (admin only).
 *
 * Compose a portal banner (title, body, emoji, tone, cta, audience, active),
 * then publish it to the workspace. Instead of localStorage, this posts to
 * `/api/admin/announcements` and lists past announcements from the same GET.
 *
 * Endpoint contract (confirmed in app/api/admin/announcements/route.ts):
 *   GET  -> { announcements: AnnouncementRow[] }
 *   POST -> body { title, content, type, targetType, targetValue?, targetIds?,
 *                  publish? } -> { id }
 *
 * Notes on the mock-vs-data gap:
 *   - `emoji` and `cta` (button label) drive the live preview but are NOT
 *     persisted by the current POST (no columns / body keys). The live banner
 *     falls back to a per-type emoji.
 *   - The "also send email" toggle now drives a real email fan-out: when on and
 *     the announcement is published, the POST carries `sendEmail: true` and the
 *     route emails the targeted contacts, returning how many were reached.
 */

interface AnnouncementRow {
  id: string
  title: string
  body: string
  type: string
  targetType: string
  targetValue: string | null
  publishedAt: string | null
  createdAt: string
  expiresAt: string | null
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

export function AnnouncementsSection() {
  const [title, setTitle] = useState('Client portal, refreshed')
  const [body, setBody] = useState(
    "We have rebuilt how your projects are presented: calmer, clearer, and faster to scan.",
  )
  const [emoji, setEmoji] = useState(EMOJI[0])
  const [tone, setTone] = useState('info')
  const [cta, setCta] = useState('See what is new')
  const [targetType, setTargetType] = useState('all')
  const [plan, setPlan] = useState(PLAN_OPTS[0])
  const [orgIds, setOrgIds] = useState<string[]>([])
  const [active, setActive] = useState(true)
  const [sendEmail, setSendEmail] = useState(false)

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

  async function publish() {
    if (!title.trim()) {
      setError('Add a title before publishing.')
      return
    }
    if (!body.trim()) {
      setError('Add a message before publishing.')
      return
    }
    setError(null)
    setSaving(true)
    try {
      const payload: {
        title: string
        content: string
        type: string
        targetType: string
        targetValue?: string
        targetIds?: string[]
        publish: boolean
        sendEmail?: boolean
      } = {
        title: title.trim(),
        content: body.trim(),
        type: tone,
        targetType,
        publish: active,
      }
      if (targetType === 'plan_type') payload.targetValue = plan
      if (targetType === 'org') payload.targetIds = orgIds
      // Email only fans out for a published announcement; a draft stays silent.
      if (sendEmail && active) payload.sendEmail = true

      const res = await fetch(apiPath('/api/admin/announcements'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => null)) as { error?: string } | null
        throw new Error(j?.error ?? 'Failed to publish')
      }
      const result = (await res.json().catch(() => null)) as { emailed?: number } | null
      const emailed = result?.emailed ?? 0
      if (!active) {
        setFlash('Saved as a draft.')
      } else if (sendEmail) {
        setFlash(
          emailed > 0
            ? `Published to the workspace and emailed ${emailed} ${emailed === 1 ? 'client' : 'clients'}.`
            : 'Published to the workspace. No clients were emailed.',
        )
      } else {
        setFlash('Published to the workspace.')
      }
      setTimeout(() => setFlash(null), 3600)
      await mutate()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong.')
    } finally {
      setSaving(false)
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
        <button className="btn1" onClick={publish} disabled={saving}>
          <Check size={15} />
          {saving ? 'Publishing...' : active ? 'Publish announcement' : 'Save draft'}
        </button>
      </div>

      <div className="set-sub-label">Past announcements</div>
      <div className="set-card lrow-wrap">
        {isLoading ? (
          <EmptyRow text="Loading announcements..." />
        ) : !announcements.length ? (
          <EmptyRow text="No announcements yet. Compose one above to get started." />
        ) : (
          announcements.map((a, i) => (
            <div
              key={a.id}
              className="lrow"
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
              </div>
            </div>
          ))
        )}
      </div>
    </SectionShell>
  )
}
