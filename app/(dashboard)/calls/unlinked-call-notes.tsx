'use client'

/**
 * "Unlinked call notes" on /calls.
 *
 * The Drive sync refuses to guess which call a set of Gemini notes belongs to
 * when the top two candidates are within 20 points of each other, and it has
 * nowhere to put notes whose call it never found. Rather than drop them, it
 * parks them in call_transcripts. This section is where a human places them.
 *
 * It renders nothing at all when there is nothing parked, so the page it sits
 * above is unchanged on every normal day.
 */

import { useState } from 'react'
import useSWR from 'swr'
import { FileText, Link2, Search } from 'lucide-react'
import { Card } from '@/components/tahi/card'
import { Badge } from '@/components/tahi/badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { SlideOver } from '@/components/tahi/slide-over'
import { useToast } from '@/components/tahi/toast'
import { apiPath } from '@/lib/api'

interface UnlinkedNote {
  id: string
  callKind: string | null
  callId: string | null
  source: string
  title: string | null
  receivedAt: string
  summary: string | null
  unlinkedReason: string | null
  preview: string
  textLength: number
}

interface PickerCall {
  kind: 'discovery' | 'scheduled'
  id: string
  title: string
  scheduledAt: string
  orgId: string | null
  orgName: string | null
}

const REASON_LABEL: Record<string, string> = {
  no_match: 'No matching call',
  ambiguous: 'Too close to call',
}

function formatReceived(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function formatCallWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function UnlinkedCallNotes({ onAttached }: { onAttached?: () => void }) {
  const { data, mutate } = useSWR<{ items: UnlinkedNote[] }>('/api/admin/call-transcripts?unlinked=1&limit=20')
  const [picking, setPicking] = useState<UnlinkedNote | null>(null)

  const items = data?.items ?? []
  if (items.length === 0) return null

  return (
    <>
      <Card padding="md">
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            marginBottom: '0.875rem',
          }}
        >
          <span
            aria-hidden
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '2rem',
              height: '2rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand-100)',
              color: 'var(--color-brand-dark)',
              flexShrink: 0,
            }}
          >
            <FileText size={15} />
          </span>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)', margin: 0 }}>
              Unlinked call notes
            </h2>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0 }}>
              {items.length === 1
                ? 'One set of notes could not be placed on a call. Attach it so it counts.'
                : `${items.length} sets of notes could not be placed on a call. Attach them so they count.`}
            </p>
          </div>
        </div>

        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {items.map(note => (
            <li
              key={note.id}
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-start',
                gap: '0.75rem',
                padding: '0.75rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border-subtle)',
                background: 'var(--color-bg-secondary)',
              }}
            >
              <div style={{ flex: '1 1 16rem', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span
                    data-private
                    style={{
                      fontSize: '0.8125rem',
                      fontWeight: 600,
                      color: 'var(--color-text)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {note.title ?? 'Untitled call notes'}
                  </span>
                  {note.unlinkedReason && (
                    <Badge tone="warning" variant="soft" size="sm">
                      {REASON_LABEL[note.unlinkedReason] ?? note.unlinkedReason}
                    </Badge>
                  )}
                </div>
                <p style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', margin: '0.125rem 0 0' }}>
                  {formatReceived(note.receivedAt)}
                </p>
                <p
                  data-private
                  style={{
                    fontSize: '0.75rem',
                    color: 'var(--color-text-muted)',
                    margin: '0.375rem 0 0',
                    lineHeight: 1.5,
                  }}
                >
                  {note.preview || 'No text in these notes.'}
                </p>
              </div>
              <TahiButton
                variant="secondary"
                size="sm"
                onClick={() => setPicking(note)}
                iconLeft={<Link2 className="w-3.5 h-3.5" />}
              >
                Attach
              </TahiButton>
            </li>
          ))}
        </ul>
      </Card>

      <AttachPicker
        note={picking}
        onClose={() => setPicking(null)}
        onAttached={() => {
          setPicking(null)
          void mutate()
          onAttached?.()
        }}
      />
    </>
  )
}

/**
 * The picker. Searches calls from BOTH tables by title, client and date,
 * because the thing you remember about a call you are placing notes on is
 * roughly when it was and who it was with.
 */
function AttachPicker({
  note,
  onClose,
  onAttached,
}: {
  note: UnlinkedNote | null
  onClose: () => void
  onAttached: () => void
}) {
  const { showToast } = useToast()
  const [query, setQuery] = useState('')
  const [saving, setSaving] = useState<string | null>(null)

  const { data, isLoading } = useSWR<{ items: PickerCall[] }>(
    note ? `/api/admin/call-transcripts/calls?q=${encodeURIComponent(query)}&limit=25` : null,
  )
  const calls = data?.items ?? []

  async function attach(call: PickerCall) {
    if (!note) return
    setSaving(`${call.kind}:${call.id}`)
    try {
      const res = await fetch(apiPath(`/api/admin/call-transcripts/${note.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callKind: call.kind, callId: call.id }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(body.error ?? 'Could not attach these notes.')
      }
      showToast('Notes attached to the call.', 'success')
      setQuery('')
      onAttached()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not attach these notes.', 'error')
    } finally {
      setSaving(null)
    }
  }

  return (
    <SlideOver
      open={!!note}
      onClose={onClose}
      variant="center"
      maxWidth="32rem"
      icon={<Link2 className="w-4 h-4" />}
      title="Attach call notes"
      subtitle={note?.title ?? undefined}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <label style={{ display: 'block' }}>
          <span className="sr-only">Search calls</span>
          <span style={{ position: 'relative', display: 'block' }}>
            <Search
              size={14}
              aria-hidden
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--color-text-subtle)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by call title, client or date"
              style={{
                width: '100%',
                minHeight: '2.75rem',
                padding: '0 0.75rem 0 2.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--color-border)',
                background: 'var(--color-bg)',
                color: 'var(--color-text)',
                fontSize: '0.875rem',
              }}
            />
          </span>
        </label>

        {isLoading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {[0, 1, 2].map(i => (
              <div
                key={i}
                className="animate-pulse"
                style={{
                  height: '3rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-bg-tertiary)',
                }}
              />
            ))}
          </div>
        )}

        {!isLoading && calls.length === 0 && (
          <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0 }}>
            No calls match. Clear the search, or create the call first from the client.
          </p>
        )}

        {!isLoading && calls.length > 0 && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            {calls.map(call => {
              const key = `${call.kind}:${call.id}`
              return (
                <li key={key}>
                  <button
                    type="button"
                    disabled={saving !== null}
                    onClick={() => void attach(call)}
                    className="w-full flex items-center justify-between text-left border border-[var(--color-border-subtle)] bg-[var(--color-bg)] hover:border-[var(--color-brand)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:opacity-60"
                    style={{
                      minHeight: '2.75rem',
                      gap: '0.75rem',
                      padding: '0.5rem 0.75rem',
                      borderRadius: 'var(--radius-md)',
                      color: 'var(--color-text)',
                      cursor: saving ? 'progress' : 'pointer',
                    }}
                  >
                    <span style={{ minWidth: 0 }}>
                      <span
                        data-private
                        style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis' }}
                      >
                        {call.title}
                      </span>
                      <span style={{ display: 'block', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                        {formatCallWhen(call.scheduledAt)}
                        {call.orgName ? ` · ${call.orgName}` : ''}
                      </span>
                    </span>
                    <Badge tone={call.kind === 'scheduled' ? 'info' : 'brand'} variant="soft" size="sm">
                      {call.kind === 'scheduled' ? 'Check-in' : 'Discovery'}
                    </Badge>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SlideOver>
  )
}
