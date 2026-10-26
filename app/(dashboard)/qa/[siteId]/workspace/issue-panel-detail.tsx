'use client'

import { useState, type ReactNode } from 'react'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { QaSeo, QaTarget } from '@/lib/qa/types'
import type { PsiSummary } from '@/lib/qa/pagespeed'

const TITLE_MAX = 60
const TITLE_MIN = 15
const DESC_MAX = 160
const DESC_MIN = 50

function LengthNote({ length, min, max }: { length: number; min: number; max: number }) {
  const ok = length >= min && length <= max
  return (
    <span style={{ fontSize: '0.75rem', color: ok ? 'var(--color-text-muted)' : 'var(--color-warning)' }}>
      {length} characters (aim for {min} to {max})
    </span>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: '0.25rem' }}>
      <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
        {label}
      </span>
      <div className="text-[var(--color-text)] break-words" style={{ fontSize: '0.8125rem' }}>{children}</div>
    </div>
  )
}

function OgImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) {
    return (
      <div
        className="flex items-center justify-center rounded-[var(--radius-leaf-sm)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]"
        style={{ height: '6rem', fontSize: '0.75rem' }}
      >
        Image did not load
      </div>
    )
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className="w-full rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] object-cover"
      style={{ height: '6rem' }}
    />
  )
}

/** SEO fields summary for the Desktop scan (or the first scanned viewport). */
export function SeoSummary({ seo }: { seo: QaSeo }) {
  const title = seo.title ?? ''
  const desc = seo.metaDescription ?? ''
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Title">
        {seo.title ? (
          <>
            {seo.title}
            <div><LengthNote length={title.length} min={TITLE_MIN} max={TITLE_MAX} /></div>
          </>
        ) : (
          <span className="text-[var(--color-danger)]">Missing</span>
        )}
      </Field>
      <Field label="Meta description">
        {seo.metaDescription ? (
          <>
            {seo.metaDescription}
            <div><LengthNote length={desc.length} min={DESC_MIN} max={DESC_MAX} /></div>
          </>
        ) : (
          <span className="text-[var(--color-danger)]">Missing</span>
        )}
      </Field>
      <Field label="Canonical">{seo.canonical ?? <span className="text-[var(--color-warning)]">Missing</span>}</Field>
      <Field label="Robots meta">{seo.robotsMeta ?? 'None (indexable)'}</Field>
      <Field label="Language">{seo.lang ?? <span className="text-[var(--color-warning)]">Missing</span>}</Field>
      <Field label="Favicon">{seo.favicon ?? 'Not declared'}</Field>
      <div className="md:col-span-2">
        <Field label="Open Graph preview">
          <div
            className="grid gap-3 rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg-secondary)] p-3 sm:grid-cols-[minmax(0,12rem)_1fr]"
          >
            {seo.og.image ? <OgImage src={seo.og.image} /> : (
              <div className="flex h-24 items-center justify-center rounded-[var(--radius-leaf-sm)] bg-[var(--color-bg-tertiary)] text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>
                No og:image
              </div>
            )}
            <div className="flex min-w-0 flex-col" style={{ gap: '0.25rem' }}>
              <span className="truncate" style={{ fontWeight: 600 }}>{seo.og.title ?? <span className="text-[var(--color-warning)]">No og:title</span>}</span>
              <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>{seo.og.description ?? 'No og:description'}</span>
              <span className="truncate text-[var(--color-text-subtle)]" style={{ fontSize: '0.75rem' }}>{seo.og.url ?? ''}</span>
            </div>
          </div>
        </Field>
      </div>
      <div className="md:col-span-2">
        <Field label={`Headings (h1 count ${seo.h1Count})`}>
          {seo.headingOutline.length === 0 ? (
            <span className="text-[var(--color-text-muted)]">No headings found</span>
          ) : (
            <ul className="flex flex-col" style={{ gap: '0.125rem' }}>
              {seo.headingOutline.map((h, i) => (
                <li key={`${h.level}-${i}`} style={{ paddingLeft: `${(h.level - 1) * 0.75}rem` }} className="break-words">
                  <span className="text-[var(--color-text-subtle)]">H{h.level}</span> {h.text}
                </li>
              ))}
            </ul>
          )}
          {seo.headingSkips.length > 0 ? (
            <p className="text-[var(--color-warning)]" style={{ fontSize: '0.75rem' }}>
              Heading skips: {seo.headingSkips.map(s => `H${s.from} to H${s.to}`).join(', ')}
            </p>
          ) : null}
        </Field>
      </div>
    </div>
  )
}

function fmtMs(v: number | null): string {
  return v === null ? 'n/a' : `${Math.round(v)} ms`
}

function fmtCls(v: number | null): string {
  return v === null ? 'n/a' : v.toFixed(2)
}

function PsiRow({ label, summary }: { label: string; summary: PsiSummary }) {
  return (
    <div className="flex flex-wrap items-baseline rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] p-3" style={{ gap: '0.75rem' }}>
      <span style={{ fontWeight: 600 }}>{label}</span>
      <span>Score {summary.score ?? 'n/a'}</span>
      <span>LCP {fmtMs(summary.lcpMs)}</span>
      <span>CLS {fmtCls(summary.cls)}</span>
      <span>{summary.inpMs !== null ? `INP ${fmtMs(summary.inpMs)}` : `TBT ${fmtMs(summary.tbtMs)}`}</span>
      <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.75rem' }}>
        {summary.source === 'field' ? 'field data' : 'lab data'}
      </span>
    </div>
  )
}

export interface PerformancePanelProps {
  /** The stored pagespeed JSON from the round page (may be null). */
  pagespeed: { mobile?: PsiSummary; desktop?: PsiSummary } | null
  target: QaTarget
  readOnly: boolean
  onRun: (strategy: 'mobile' | 'desktop') => Promise<void>
}

export function PerformancePanel({ pagespeed, target, readOnly, onRun }: PerformancePanelProps) {
  const [running, setRunning] = useState<'mobile' | 'desktop' | null>(null)
  const live = target === 'live'

  async function run(strategy: 'mobile' | 'desktop') {
    setRunning(strategy)
    try {
      await onRun(strategy)
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      {live ? (
        <div className="flex flex-wrap" style={{ gap: '0.5rem' }}>
          <TahiButton variant="secondary" size="sm" onClick={() => void run('mobile')} loading={running === 'mobile'} disabled={readOnly || running !== null}>
            Run PageSpeed (mobile)
          </TahiButton>
          <TahiButton variant="secondary" size="sm" onClick={() => void run('desktop')} loading={running === 'desktop'} disabled={readOnly || running !== null}>
            Run PageSpeed (desktop)
          </TahiButton>
        </div>
      ) : (
        <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
          PageSpeed runs on the live site only, because it cannot reach a password-protected staging site.
        </p>
      )}
      {pagespeed?.mobile ? <PsiRow label="Mobile" summary={pagespeed.mobile} /> : null}
      {pagespeed?.desktop ? <PsiRow label="Desktop" summary={pagespeed.desktop} /> : null}
      {!pagespeed?.mobile && !pagespeed?.desktop && live ? (
        <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>No PageSpeed results yet.</p>
      ) : null}
    </div>
  )
}
