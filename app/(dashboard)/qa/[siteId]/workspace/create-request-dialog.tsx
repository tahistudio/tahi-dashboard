'use client'

import { useEffect, useId, useState } from 'react'
import Link from 'next/link'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Textarea } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { QaIssue } from '@/lib/qa/types'

export interface CreateRequestInput {
  title: string
  description: string
  viewport?: string
}

export interface CreateRequestDialogProps {
  open: boolean
  onClose: () => void
  issue: QaIssue | null
  pagePath: string
  /** Viewport key the issue came from, if any. */
  viewport?: string
  /** Resolves with the new request id, or rejects with a readable message. */
  onCreate: (input: CreateRequestInput) => Promise<string>
}

/** Title is the page path plus the first 80 characters of the issue message. */
export function defaultRequestTitle(pagePath: string, message: string): string {
  return `${pagePath}: ${message.slice(0, 80)}`
}

export function CreateRequestDialog({ open, onClose, issue, pagePath, viewport, onCreate }: CreateRequestDialogProps) {
  const titleId = useId()
  const descId = useId()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdId, setCreatedId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !issue) return
    setTitle(defaultRequestTitle(pagePath, issue.message))
    setDescription(issue.message)
    setError(null)
    setCreatedId(null)
    setSaving(false)
  }, [open, issue, pagePath])

  async function submit() {
    if (!title.trim()) {
      setError('Add a title for the request.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const id = await onCreate({ title: title.trim(), description: description.trim(), viewport })
      setCreatedId(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the request.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <SlideOver open={open} onClose={onClose} title="Create request" variant="center" maxWidth="34rem">
      <div className="flex flex-col" style={{ gap: '1rem' }}>
        {createdId ? (
          <div className="flex flex-col" style={{ gap: '0.75rem' }}>
            <p className="text-[var(--color-text)]" style={{ fontSize: '0.875rem' }}>Request created.</p>
            <Link
              href={`/requests/${createdId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[2.75rem] items-center self-start rounded-[var(--radius-leaf-sm)] px-3 text-[var(--color-brand-dark)] underline transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
              style={{ fontWeight: 600 }}
            >
              Open request
            </Link>
            <div className="flex justify-end">
              <TahiButton variant="secondary" onClick={onClose}>Close</TahiButton>
            </div>
          </div>
        ) : (
          <>
            <div className="flex flex-col" style={{ gap: '0.375rem' }}>
              <label htmlFor={titleId} className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Title
              </label>
              <Input id={titleId} value={title} onChange={e => setTitle(e.target.value)} maxLength={200} />
            </div>
            <div className="flex flex-col" style={{ gap: '0.375rem' }}>
              <label htmlFor={descId} className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                Description
              </label>
              <Textarea id={descId} value={description} onChange={e => setDescription(e.target.value)} rows={5} maxLength={4000} />
            </div>
            <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>
              The request is created as internal, so the client is not notified.
            </p>
            {error ? (
              <p role="alert" className="text-[var(--color-danger)]" style={{ fontSize: '0.8125rem' }}>{error}</p>
            ) : null}
            <div className="flex justify-end" style={{ gap: '0.5rem' }}>
              <TahiButton variant="secondary" onClick={onClose} disabled={saving}>Cancel</TahiButton>
              <TahiButton variant="primary" onClick={() => void submit()} loading={saving}>Create request</TahiButton>
            </div>
          </>
        )}
      </div>
    </SlideOver>
  )
}
