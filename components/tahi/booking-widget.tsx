'use client'

import { useState, useEffect } from 'react'
import { Calendar, ExternalLink } from 'lucide-react'
import { apiPath } from '@/lib/api'

export function BookingWidget() {
  const [bookingUrl, setBookingUrl] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [iframeError, setIframeError] = useState(false)

  useEffect(() => {
    fetch(apiPath('/api/portal/settings/booking'))
      .then(r => {
        if (!r.ok) throw new Error('Failed')
        return r.json() as Promise<{ url: string | null }>
      })
      .then(data => setBookingUrl(data.url ?? null))
      .catch(() => setBookingUrl(null))
      .finally(() => setLoaded(true))
  }, [])

  if (!loaded) {
    return (
      <div
        className="rounded-xl animate-pulse"
        style={{
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          height: '12rem',
        }}
      />
    )
  }

  if (!bookingUrl) {
    return (
      <div
        className="rounded-xl"
        style={{
          padding: '2rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          textAlign: 'center',
        }}
      >
        <div
          className="flex items-center justify-center"
          style={{
            width: '3rem',
            height: '3rem',
            margin: '0 auto 0.75rem',
            borderRadius: 'var(--radius-leaf)',
            background: 'var(--color-bg-tertiary)',
            color: 'var(--color-text-subtle)',
          }}
        >
          <Calendar size={20} aria-hidden="true" />
        </div>
        <p
          className="text-sm font-semibold"
          style={{ color: 'var(--color-text)' }}
        >
          Scheduling not available yet
        </p>
        <p
          className="text-xs"
          style={{ color: 'var(--color-text-muted)', marginTop: '0.25rem' }}
        >
          Call booking will be enabled soon.
        </p>
      </div>
    )
  }

  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between"
        style={{
          padding: '1rem 1.25rem',
          borderBottom: '1px solid var(--color-border-subtle)',
        }}
      >
        <div className="flex items-center" style={{ gap: '0.75rem' }}>
          <div
            className="flex items-center justify-center"
            style={{
              width: '2.25rem',
              height: '2.25rem',
              borderRadius: 'var(--radius-leaf-sm)',
              background: 'var(--color-brand-50)',
              color: 'var(--color-brand)',
            }}
          >
            <Calendar size={16} aria-hidden="true" />
          </div>
          <div>
            <p
              className="text-sm font-semibold"
              style={{ color: 'var(--color-text)' }}
            >
              Book a Call
            </p>
            <p
              className="text-xs"
              style={{ color: 'var(--color-text-muted)', marginTop: '0.0625rem' }}
            >
              Pick a time that works for you
            </p>
          </div>
        </div>
        <a
          href={bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center text-xs font-medium transition-opacity hover:opacity-70"
          style={{
            color: 'var(--color-brand)',
            textDecoration: 'none',
            gap: '0.25rem',
          }}
        >
          Open in new tab
          <ExternalLink size={12} aria-hidden="true" />
        </a>
      </div>

      {/* Iframe embed */}
      {!iframeError ? (
        <iframe
          src={bookingUrl}
          title="Book a call with Tahi"
          onError={() => setIframeError(true)}
          style={{
            width: '100%',
            height: '37.5rem',
            border: 'none',
            display: 'block',
          }}
          allow="calendar-access"
          loading="lazy"
        />
      ) : (
        <div
          className="flex flex-col items-center justify-center"
          style={{
            padding: '3rem 1.5rem',
            textAlign: 'center',
          }}
        >
          <p
            className="text-sm font-medium"
            style={{ color: 'var(--color-text)' }}
          >
            Unable to load the booking calendar inline.
          </p>
          <a
            href={bookingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center text-sm font-semibold text-white transition-opacity hover:opacity-90"
            style={{
              marginTop: '1rem',
              padding: '0.5625rem 1.25rem',
              background: 'var(--color-brand)',
              borderRadius: '0 0.5rem 0 0.5rem',
              textDecoration: 'none',
              gap: '0.375rem',
              minHeight: '2.75rem',
            }}
          >
            <Calendar size={14} aria-hidden="true" />
            Open Booking Page
          </a>
        </div>
      )}
    </div>
  )
}
