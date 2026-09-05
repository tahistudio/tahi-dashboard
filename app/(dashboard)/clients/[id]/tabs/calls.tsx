'use client'

/**
 * The client Calls tab: book the next one at the top, then every call this
 * client has had or is about to have.
 *
 * The list and the per-call record (transcript, summary, outcome, scope,
 * budget, the AI extraction) are the shipped <DiscoveryCallsCard>, which owns
 * that whole surface across leads, deals, requests, tasks and orgs. This tab
 * adds the booking form the hero's "Book a call" opens straight into, because
 * the card cannot be told to open its own form from outside. A successful
 * booking bumps `reloadKey`, which remounts the card so it picks the new call
 * up rather than showing a stale list.
 */

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { CalendarDays, Loader2, Phone, Video } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DiscoveryCallsCard } from '@/components/tahi/discovery-calls'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import { CountText, Grow, SectionTitle, SubBar } from '../_kit/chrome'
import type { Contact } from '../_kit/types'

export interface ClientCallRow {
  id: string
  title: string
  scheduledAt: string
  durationMinutes: number
  googleMeetUrl: string | null
  status: string
}

export const CLIENT_CALLS_KEY = (clientId: string) => `/api/admin/clients/${clientId}/calls`

const LENGTHS = [15, 30, 45, 60]

/** Today at the given time, offset by `days`, as the value a date input wants. */
function dateInDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export function CallsTab({
  clientId,
  orgName,
  contacts,
  writeDisabled,
  bookOpen,
  onBookOpenChange,
}: {
  clientId: string
  orgName: string
  contacts: Contact[]
  writeDisabled: boolean
  bookOpen: boolean
  onBookOpenChange: (open: boolean) => void
}) {
  const { showToast } = useToast()
  const [reloadKey, setReloadKey] = useState(0)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    title: 'Check-in',
    date: dateInDays(7),
    time: '10:00',
    minutes: 30,
    meetingUrl: '',
    attendeeIds: [] as string[],
  })

  const { data, mutate } = useSWR<{ calls: ClientCallRow[] }>(CLIENT_CALLS_KEY(clientId))
  const calls = useMemo(() => data?.calls ?? [], [data])

  const upcoming = calls.filter(
    c => c.status === 'scheduled' && new Date(c.scheduledAt).getTime() >= Date.now(),
  )

  // The primary contact is who a check-in is with unless told otherwise.
  useEffect(() => {
    if (form.attendeeIds.length > 0) return
    const primary = contacts.find(c => c.isPrimary) ?? contacts[0]
    if (primary) setForm(f => ({ ...f, attendeeIds: [primary.id] }))
  }, [contacts, form.attendeeIds.length])

  async function book() {
    if (!form.title.trim()) return
    const scheduledAt = new Date(`${form.date}T${form.time}:00`)
    if (Number.isNaN(scheduledAt.getTime())) {
      showToast('That date and time did not parse. Please check them.', 'error')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${clientId}/calls`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title.trim(),
          scheduledAt: scheduledAt.toISOString(),
          durationMinutes: form.minutes,
          googleMeetUrl: form.meetingUrl.trim() || null,
          attendees: contacts
            .filter(c => form.attendeeIds.includes(c.id))
            .map(c => ({ name: c.name, email: c.email, role: c.role ?? undefined })),
        }),
      })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        showToast(json?.error ?? 'The call was not booked. Please try again.', 'error')
        return
      }
      showToast(`${form.title.trim()} booked with ${orgName}`, 'success')
      onBookOpenChange(false)
      setReloadKey(k => k + 1)
      await mutate()
    } catch {
      showToast('The call was not booked. Please try again.', 'error')
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle: React.CSSProperties = {
    padding: '0 0.625rem',
    borderRadius: 'var(--radius-input)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg)',
    color: 'var(--color-text)',
    fontSize: '0.8125rem',
  }

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <SubBar>
        <SectionTitle>Calls</SectionTitle>
        <CountText>
          {upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'call' : 'calls'} booked`
            : 'Nothing booked'}
        </CountText>
        {upcoming[0] && (
          <Badge tone="info" size="sm">
            Next {new Date(upcoming[0].scheduledAt).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' })}
          </Badge>
        )}
        <Grow />
        <TahiButton
          variant="primary"
          size="sm"
          disabled={writeDisabled}
          aria-expanded={bookOpen}
          onClick={() => onBookOpenChange(!bookOpen)}
          iconLeft={<CalendarDays className="w-3.5 h-3.5" />}
        >
          Book a call
        </TahiButton>
      </SubBar>

      {bookOpen && !writeDisabled && (
        <Card style={{ borderColor: 'var(--color-brand)' }}>
          <div className="flex flex-col" style={{ gap: '0.75rem' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Title</span>
                <input
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={fieldStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Meeting link (optional)
                </span>
                <input
                  value={form.meetingUrl}
                  onChange={e => setForm(f => ({ ...f, meetingUrl: e.target.value }))}
                  placeholder="https://meet.google.com/..."
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={fieldStyle}
                />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: '0.75rem' }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Date</span>
                <input
                  type="date"
                  value={form.date}
                  onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={fieldStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Time</span>
                <input
                  type="time"
                  value={form.time}
                  onChange={e => setForm(f => ({ ...f, time: e.target.value }))}
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={fieldStyle}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>Length</span>
                <select
                  value={form.minutes}
                  onChange={e => setForm(f => ({ ...f, minutes: Number(e.target.value) }))}
                  className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2.25rem]"
                  style={fieldStyle}
                >
                  {LENGTHS.map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </label>
            </div>

            {contacts.length > 0 && (
              <fieldset style={{ border: 'none', padding: 0, margin: 0 }}>
                <legend style={{ padding: 0, fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
                  Who from {orgName}
                </legend>
                <div className="flex items-center flex-wrap" style={{ gap: '0.375rem', marginTop: '0.375rem' }}>
                  {contacts.map(c => {
                    const on = form.attendeeIds.includes(c.id)
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setForm(f => ({
                          ...f,
                          attendeeIds: on ? f.attendeeIds.filter(x => x !== c.id) : [...f.attendeeIds, c.id],
                        }))}
                        className="tahi-focus-ring min-h-[2.75rem] md:min-h-[2rem]"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          padding: '0 0.75rem',
                          borderRadius: '9999px',
                          border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-border-strong)'}`,
                          background: on ? 'var(--color-brand-50)' : 'var(--color-bg)',
                          color: on ? 'var(--color-brand-dark)' : 'var(--color-text-muted)',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <span data-private>{c.name}</span>
                      </button>
                    )
                  })}
                </div>
              </fieldset>
            )}

            <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
                Everyone picked gets the invite.
              </span>
              <Grow />
              <TahiButton variant="secondary" size="sm" onClick={() => onBookOpenChange(false)}>Cancel</TahiButton>
              <TahiButton variant="primary" size="sm" onClick={book} disabled={saving || !form.title.trim()}>
                {saving ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" aria-hidden="true" /> : null}
                Book it
              </TahiButton>
            </div>
          </div>
        </Card>
      )}

      {upcoming.length > 0 && (
        <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
          {upcoming.slice(0, 3).map(c => (
            <span
              key={c.id}
              className="flex items-center"
              style={{
                gap: '0.375rem',
                minHeight: '2rem',
                padding: '0 0.625rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
                fontSize: '0.75rem',
                color: 'var(--color-text-muted)',
              }}
            >
              <Phone className="w-3 h-3" aria-hidden="true" />
              <strong style={{ color: 'var(--color-text)', fontWeight: 600 }}>{c.title}</strong>
              {new Date(c.scheduledAt).toLocaleString('en-NZ', {
                day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
              })}
              {c.googleMeetUrl && (
                <a
                  href={c.googleMeetUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="tahi-focus-ring inline-flex items-center"
                  style={{ gap: '0.25rem', color: 'var(--color-brand-dark)', fontWeight: 600, textDecoration: 'none' }}
                >
                  <Video className="w-3 h-3" aria-hidden="true" />
                  Join
                </a>
              )}
            </span>
          ))}
        </div>
      )}

      <DiscoveryCallsCard key={reloadKey} parentType="org" parentId={clientId} onChanged={() => { void mutate() }} />
    </div>
  )
}
