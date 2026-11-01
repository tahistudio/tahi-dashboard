'use client'

/**
 * Pre-call brief for a call with an existing client (LP.4), shown inside the
 * /calls call-detail slide-over. Read only. The data comes from
 * GET /api/admin/discovery-calls/[id]/brief, which already left out every
 * section the viewer may not see, so this component renders what arrives and
 * never decides access itself. The finance block renders only when the API
 * sent it.
 */

import useSWR from 'swr'
import Link from 'next/link'
import { apiPath } from '@/lib/api'
import type { ClientCallBrief } from '@/lib/client-call-brief'

const sectionTitle: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
}

const rowLink: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.125rem',
  padding: '0.5rem 0.625rem',
  minHeight: '2.75rem',
  justifyContent: 'center',
  borderRadius: 'var(--radius-md)',
  border: '1px solid var(--color-border-subtle)',
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  fontSize: '0.8125rem',
  textDecoration: 'none',
}

const metaText: React.CSSProperties = { fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }

async function fetchBrief(url: string): Promise<ClientCallBrief> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(res.status === 403 ? 'You do not have access to this brief.' : 'Could not load the brief.')
  const json = await res.json() as { brief: ClientCallBrief }
  return json.brief
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function Section({ title, count, total, children }: { title: string; count: number; total: number; children: React.ReactNode }) {
  if (count === 0) return null
  return (
    <section className="flex flex-col" style={{ gap: '0.375rem' }}>
      <h4 style={sectionTitle}>{title}</h4>
      <div className="flex flex-col" style={{ gap: '0.375rem' }}>{children}</div>
      {total > count && <span style={metaText}>and {total - count} more</span>}
    </section>
  )
}

function Row({ href, title, meta }: { href: string; title: string; meta?: string }) {
  return (
    <Link href={href} className="tahi-focus-ring tahi-brief-row" style={rowLink}>
      <span style={{ fontWeight: 600 }}>{title}</span>
      {meta && <span style={metaText}>{meta}</span>}
    </Link>
  )
}

export function ClientCallBriefPanel({ callId }: { callId: string }) {
  const { data, error, isLoading } = useSWR<ClientCallBrief>(
    apiPath(`/api/admin/discovery-calls/${encodeURIComponent(callId)}/brief`),
    fetchBrief,
    { revalidateOnFocus: false },
  )

  if (isLoading) {
    return <div className="animate-pulse" style={{ height: '6rem', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-tertiary)' }} aria-label="Loading brief" />
  }
  if (error || !data) {
    return <p role="alert" style={{ fontSize: '0.75rem', color: 'var(--color-danger)' }}>{error instanceof Error ? error.message : 'Could not load the brief.'}</p>
  }
  if (data.state === 'no_org' || !data.org) {
    return <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>Link this call to a client to see its pre-call brief.</p>
  }

  const t = data.totals
  const nothing = data.pastCalls.length + data.openRequests.length + data.openTasks.length === 0 && !data.finance?.lastInvoice
  return (
    <div className="flex flex-col" style={{ gap: '0.875rem' }} data-private>
      <div className="flex items-center justify-between" style={{ gap: '0.5rem' }}>
        <h3 style={{ fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Pre-call brief</h3>
        <Link href={data.org.href} className="tahi-focus-ring" style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-link)', minHeight: '2.75rem', display: 'inline-flex', alignItems: 'center' }}>
          {data.org.name}
        </Link>
      </div>

      {data.raise.length > 0 && (
        <section className="flex flex-col" style={{ gap: '0.375rem' }}>
          <h4 style={sectionTitle}>What to raise</h4>
          <ul className="flex flex-col" style={{ gap: '0.25rem', paddingLeft: '1rem', listStyle: 'disc', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
            {data.raise.map(line => <li key={line}>{line}</li>)}
          </ul>
        </section>
      )}

      {nothing && <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)' }}>{data.sectionsHidden ? 'Some sections are hidden by your permissions.' : 'Nothing on record yet for this client.'}</p>}
      {!nothing && data.sectionsHidden && <p style={metaText}>Some sections are hidden by your permissions.</p>}

      <Section title="Past calls" count={data.pastCalls.length} total={t.pastCalls}>
        {data.pastCalls.map(c => (
          <Link key={c.id} href={c.href} className="tahi-focus-ring tahi-brief-row" style={rowLink}>
            <span style={{ fontWeight: 600 }}>{c.title}</span>
            <span style={metaText}>{shortDate(c.scheduledAt)}</span>
            {c.summary && <span style={{ color: 'var(--color-text-muted)' }}>{c.summary}</span>}
            {c.decisions && <span style={{ color: 'var(--color-text-muted)' }}>Decided: {c.decisions}</span>}
          </Link>
        ))}
      </Section>

      <Section title="Waiting on the client" count={data.handoffs.length} total={t.handoffs}>
        {data.handoffs.map(h => (
          <Row key={h.requestId} href={h.href} title={`${h.ref ? `${h.ref} ` : ''}${h.title}`} meta={`${h.contactName ?? 'Client'}: ${h.reason}, ${h.daysWaiting}d`} />
        ))}
      </Section>

      <Section title="Open requests" count={data.openRequests.length} total={t.requests}>
        {data.openRequests.map(r => (
          <Row key={r.id} href={r.href} title={`${r.ref ? `${r.ref} ` : ''}${r.title}`} meta={`${r.status.replace(/_/g, ' ')}${r.dueDate ? `, due ${shortDate(r.dueDate)}` : ''}${r.overdue ? ' (overdue)' : ''}`} />
        ))}
      </Section>

      <Section title="Open tasks" count={data.openTasks.length} total={t.tasks}>
        {data.openTasks.map(k => (
          <Row key={k.id} href={k.href} title={k.title} meta={`${k.status.replace(/_/g, ' ')}${k.dueDate ? `, due ${shortDate(k.dueDate)}` : ''}${k.overdue ? ' (overdue)' : ''}`} />
        ))}
      </Section>

      <Section title="Blockers" count={data.blockers.length} total={t.blockers}>
        {data.blockers.map(b => (
          <Row key={`${b.blockedType}-${b.blockedId}-${b.blockerTitle}`} href={b.href} title={b.blockedTitle} meta={`Blocked by ${b.blockerTitle}`} />
        ))}
      </Section>

      <Section title="Scope flags" count={data.scopeFlags.length} total={t.scopeFlags}>
        {data.scopeFlags.map(f => (
          <Row key={f.requestId} href={f.href} title={`${f.ref ? `${f.ref} ` : ''}${f.title}`} meta={[f.reason, f.revisions].filter(Boolean).join(', ') || 'Flagged for scope creep'} />
        ))}
      </Section>

      {data.finance && (
        <Section title="Invoices" count={(data.finance.lastInvoice ? 1 : 0) + data.finance.overdue.length} total={(data.finance.lastInvoice ? 1 : 0) + data.finance.overdue.length}>
          {data.finance.lastInvoice && (
            <Row href={data.finance.lastInvoice.href} title={`Last invoice ${data.finance.lastInvoice.reference}`} meta={`${data.finance.lastInvoice.status}, ${data.finance.lastInvoice.currency} ${data.finance.lastInvoice.total.toFixed(2)}`} />
          )}
          {data.finance.overdue.map(i => (
            <Row key={i.id} href={i.href} title={`Overdue ${i.reference}`} meta={`${i.currency} ${i.total.toFixed(2)}${i.dueDate ? `, due ${shortDate(i.dueDate)}` : ''}`} />
          ))}
        </Section>
      )}
    </div>
  )
}
