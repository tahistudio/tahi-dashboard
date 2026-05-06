/**
 * <ProposalViewer> — public 16:9 slide-deck viewer for client proposals.
 *
 * Layout flow:
 *   1. Cover slide       — title, subtitle, prepared-for, prepared-by
 *   2. Shared sections   — overview, terms, about, testimonials, etc.
 *      (rendered in `position` order via the section dispatcher)
 *   3. Variants section  — picker (tabs) for 1-N packages. Each variant
 *      shows scope HTML + pricing block + accept/decline CTA.
 *   4. Footer            — brand mark + confidential note
 *
 * Decision flow:
 *   - User clicks Accept on a variant → modal asks for name/email/role/comment
 *   - Submit POSTs to /api/public/proposals/[token]/accept
 *   - On success the whole viewer flips to a "Thank you — you accepted X" state
 *   - Same path for decline (no variant required)
 *
 * Analytics: re-uses useShareViewTracking with resourceType='proposal'.
 * pagesViewed tracks which slide IDs have been scrolled into view.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { apiPath } from '@/lib/api'
import { useShareViewTracking } from '@/components/tahi/use-share-view-tracking'

interface PublicProposal {
  title: string
  subtitle: string | null
  preparedFor: string | null
  preparedBy: string | null
  effectiveDate: string | null
  expiresAt: string | null
  status: string
  decidedAt: string | null
  decidedVariantId: string | null
  orgName: string | null
}

interface PublicSection {
  id: string
  type: string
  title: string | null
  subtitle: string | null
  data: string | null
  position: number
}

interface PublicVariant {
  id: string
  name: string
  tagline: string | null
  oneOffAmount: number
  monthlyAmount: number
  currency: string
  scopeHtml: string | null
  pricingNotesHtml: string | null
  timelineScheduleId: string | null
  ctaLabel: string | null
  isFeatured: number
  position: number
}

function safeParse<T>(json: string | null): T | null {
  if (!json) return null
  try { return JSON.parse(json) as T } catch { return null }
}

function formatMoney(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
  } catch {
    return `${currency} ${n.toLocaleString()}`
  }
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

export function ProposalViewer({ token }: { token: string }) {
  const [proposal, setProposal] = useState<PublicProposal | null>(null)
  const [sections, setSections] = useState<PublicSection[]>([])
  const [variants, setVariants] = useState<PublicVariant[]>([])
  const [analyticsResourceId, setAnalyticsResourceId] = useState<string | null>(null)
  const [state, setState] = useState<'loading' | 'ok' | 'not_found'>('loading')
  const [activeVariantId, setActiveVariantId] = useState<string | null>(null)
  // Accept modal state.
  const [decisionMode, setDecisionMode] = useState<null | { kind: 'accepted' | 'declined'; variantId: string | null }>(null)
  const [decisionForm, setDecisionForm] = useState({ name: '', email: '', role: '', comment: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<null | 'accepted' | 'declined'>(null)

  const reload = useCallback(async () => {
    try {
      const res = await fetch(apiPath(`/api/public/proposals/${encodeURIComponent(token)}`))
      if (!res.ok) {
        setState('not_found')
        return
      }
      const data = await res.json() as {
        proposal: PublicProposal
        sections: PublicSection[]
        variants: PublicVariant[]
        analyticsResourceId?: string
      }
      setProposal(data.proposal)
      setSections(data.sections ?? [])
      setVariants(data.variants ?? [])
      setAnalyticsResourceId(data.analyticsResourceId ?? null)
      // Default to the featured variant or the first one.
      const featured = data.variants?.find(v => v.isFeatured) ?? data.variants?.[0]
      if (featured) setActiveVariantId(featured.id)
      // If proposal already decided, lock the viewer into the result state.
      if (data.proposal?.status === 'accepted') setSubmitted('accepted')
      else if (data.proposal?.status === 'declined') setSubmitted('declined')
      setState('ok')
    } catch {
      setState('not_found')
    }
  }, [token])

  useEffect(() => { void reload() }, [reload])

  useShareViewTracking({
    resourceType: 'proposal',
    resourceId: analyticsResourceId,
    shareToken: token,
  })

  async function submitDecision() {
    if (!decisionMode) return
    setSubmitting(true)
    try {
      const res = await fetch(apiPath(`/api/public/proposals/${encodeURIComponent(token)}/accept`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: decisionMode.kind,
          variantId: decisionMode.variantId,
          acceptorName: decisionForm.name.trim() || undefined,
          acceptorEmail: decisionForm.email.trim() || undefined,
          acceptorRole: decisionForm.role.trim() || undefined,
          comment: decisionForm.comment.trim() || undefined,
        }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        alert(errData.error ?? 'Failed to submit. Please try again.')
        return
      }
      setSubmitted(decisionMode.kind)
      setDecisionMode(null)
      // Refresh to pick up any server-side changes.
      void reload()
    } catch {
      alert('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'loading') {
    return (
      <div style={pageWrap}>
        <div className="animate-pulse" style={{ width: '100%', maxWidth: '60rem', height: '20rem', background: 'rgba(255,255,255,0.5)', borderRadius: '1rem', margin: '0 auto' }} />
      </div>
    )
  }

  if (state === 'not_found' || !proposal) {
    return (
      <div style={{ ...pageWrap, alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2c1a', marginTop: '1rem', marginBottom: '0.5rem' }}>
            This proposal isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.5 }}>
            The link may have been revoked or copied incorrectly. Reach out to the sender if you were
            expecting to see a proposal.
          </p>
        </div>
      </div>
    )
  }

  const activeVariant = variants.find(v => v.id === activeVariantId) ?? variants[0]
  const decidedVariant = proposal.decidedVariantId
    ? variants.find(v => v.id === proposal.decidedVariantId)
    : null

  return (
    <div style={pageWrap}>
      {/* Cover slide */}
      <section style={coverShell}>
        <div style={coverBackdrop} aria-hidden="true" />
        <div style={coverInner}>
          <BrandMark />
          <div style={{ marginTop: 'auto' }}>
            {proposal.subtitle && <div style={coverEyebrow}>{proposal.subtitle}</div>}
            <h1 style={coverTitle}>{proposal.title}</h1>
          </div>
          <CoverMetaGrid proposal={proposal} />
        </div>
      </section>

      {/* Already-decided banner */}
      {submitted && (
        <div style={decidedBanner(submitted)}>
          {submitted === 'accepted' ? (
            <>
              <strong>Accepted{decidedVariant ? ` · ${decidedVariant.name}` : ''}</strong>
              {proposal.decidedAt && <span style={{ marginLeft: '0.625rem', fontWeight: 500, opacity: 0.85 }}>on {formatDate(proposal.decidedAt)}</span>}
            </>
          ) : (
            <>
              <strong>Declined</strong>
              {proposal.decidedAt && <span style={{ marginLeft: '0.625rem', fontWeight: 500, opacity: 0.85 }}>on {formatDate(proposal.decidedAt)}</span>}
            </>
          )}
        </div>
      )}

      {/* Shared sections in order */}
      {sections.map(s => <ProposalSectionRender key={s.id} section={s} />)}

      {/* Variants picker + active variant detail */}
      {variants.length > 0 && (
        <section style={slideShell}>
          <div style={slideEyebrow}>Choose your package</div>
          <h2 style={slideTitle}>{variants.length === 1 ? activeVariant?.name : 'Pick the package that fits.'}</h2>
          {variants.length > 1 && (
            <p style={slideSub}>
              {variants.length} options · same team, same approach, different scope and investment
            </p>
          )}

          {/* Tabs (only when >1 variant) */}
          {variants.length > 1 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginTop: '1.25rem' }}>
              {variants.map(v => {
                const isActive = v.id === activeVariantId
                return (
                  <button
                    key={v.id}
                    onClick={() => setActiveVariantId(v.id)}
                    style={{
                      padding: '0.625rem 1rem',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      background: isActive ? '#1f2c1a' : '#ffffff',
                      color: isActive ? '#ffffff' : '#1f2c1a',
                      border: `1px solid ${isActive ? '#1f2c1a' : '#d4e0d0'}`,
                      borderRadius: 'var(--radius-md, 0.5rem)',
                      cursor: 'pointer',
                      position: 'relative',
                    }}
                  >
                    {v.name}
                    {v.isFeatured ? (
                      <span style={{
                        marginLeft: '0.5rem',
                        padding: '0.125rem 0.4375rem',
                        fontSize: '0.625rem',
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.06em',
                        background: '#5A824E',
                        color: '#ffffff',
                        borderRadius: '999px',
                      }}>
                        Recommended
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          )}

          {/* Active variant content */}
          {activeVariant && (
            <div style={{ marginTop: '1.5rem', display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: '1.5rem' }}>
              {activeVariant.tagline && (
                <p style={{ fontSize: '1rem', color: '#5a6657', margin: 0, fontStyle: 'italic' }}>
                  {activeVariant.tagline}
                </p>
              )}

              {/* Scope */}
              {activeVariant.scopeHtml && (
                <div>
                  <h3 style={subSlideHeader}>What&apos;s included</h3>
                  <div style={proseStyle} dangerouslySetInnerHTML={{ __html: activeVariant.scopeHtml }} />
                </div>
              )}

              {/* Pricing */}
              <div style={pricingCard}>
                <h3 style={{ ...subSlideHeader, marginTop: 0 }}>Investment</h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'baseline' }}>
                  {activeVariant.oneOffAmount > 0 && (
                    <PriceCell
                      label="One-off"
                      amount={formatMoney(activeVariant.oneOffAmount, activeVariant.currency)}
                      sub="paid as scheduled in the SoW"
                    />
                  )}
                  {activeVariant.monthlyAmount > 0 && (
                    <PriceCell
                      label="Monthly"
                      amount={`${formatMoney(activeVariant.monthlyAmount, activeVariant.currency)}/mo`}
                      sub="ongoing retainer"
                    />
                  )}
                  {activeVariant.oneOffAmount === 0 && activeVariant.monthlyAmount === 0 && (
                    <span style={{ fontSize: '0.875rem', color: '#5a6657' }}>Pricing to be confirmed.</span>
                  )}
                </div>
                {activeVariant.pricingNotesHtml && (
                  <div style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: '#5a6657' }} dangerouslySetInnerHTML={{ __html: activeVariant.pricingNotesHtml }} />
                )}
              </div>

              {/* Timeline link (if attached) */}
              {activeVariant.timelineScheduleId && (
                <div style={{ fontSize: '0.875rem', color: '#5a6657' }}>
                  <strong style={{ color: '#1f2c1a' }}>Project schedule</strong> attached separately. Ask
                  the sender for the timeline link if you haven&apos;t already received it.
                </div>
              )}

              {/* CTA */}
              {!submitted && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', marginTop: '0.5rem' }}>
                  <button
                    onClick={() => setDecisionMode({ kind: 'accepted', variantId: activeVariant.id })}
                    style={primaryBtn}
                  >
                    {activeVariant.ctaLabel?.trim() || `Accept ${activeVariant.name}`}
                  </button>
                  <button
                    onClick={() => setDecisionMode({ kind: 'declined', variantId: null })}
                    style={secondaryBtn}
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Footer */}
      <footer style={footer}>
        <BrandMark size="sm" />
        <span style={{ fontSize: '0.6875rem', color: '#8a9987' }}>
          Confidential proposal · {formatDate(proposal.effectiveDate) ?? 'this period'}
          {proposal.expiresAt ? ` · expires ${formatDate(proposal.expiresAt)}` : ''}
        </span>
      </footer>

      {/* Decision modal */}
      {decisionMode && (
        <div style={modalBackdrop} role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setDecisionMode(null) }}>
          <div style={modalShell}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: '#1f2c1a', margin: 0, marginBottom: '0.375rem' }}>
              {decisionMode.kind === 'accepted'
                ? `Accept ${variants.find(v => v.id === decisionMode.variantId)?.name ?? 'package'}`
                : 'Decline this proposal'}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#5a6657', margin: 0, marginBottom: '1.25rem' }}>
              {decisionMode.kind === 'accepted'
                ? 'Confirm your name + email so we have a record. We\'ll be in touch within one business day to start the engagement.'
                : 'Help us improve future proposals by sharing what didn\'t fit. Optional but appreciated.'}
            </p>

            <div style={{ display: 'grid', gap: '0.75rem' }}>
              <Field label="Your name">
                <input
                  type="text"
                  value={decisionForm.name}
                  onChange={(e) => setDecisionForm(f => ({ ...f, name: e.target.value }))}
                  style={inputStyle}
                  placeholder="Jane Smith"
                />
              </Field>
              <Field label="Email">
                <input
                  type="email"
                  value={decisionForm.email}
                  onChange={(e) => setDecisionForm(f => ({ ...f, email: e.target.value }))}
                  style={inputStyle}
                  placeholder="jane@company.com"
                />
              </Field>
              <Field label="Role / title (optional)">
                <input
                  type="text"
                  value={decisionForm.role}
                  onChange={(e) => setDecisionForm(f => ({ ...f, role: e.target.value }))}
                  style={inputStyle}
                  placeholder="Head of Marketing"
                />
              </Field>
              <Field label={decisionMode.kind === 'accepted' ? 'Anything to flag? (optional)' : 'Reason for declining (optional)'}>
                <textarea
                  rows={3}
                  value={decisionForm.comment}
                  onChange={(e) => setDecisionForm(f => ({ ...f, comment: e.target.value }))}
                  style={{ ...inputStyle, fontFamily: 'inherit', resize: 'vertical' }}
                />
              </Field>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.25rem' }}>
              <button onClick={() => setDecisionMode(null)} style={secondaryBtn}>
                Cancel
              </button>
              <button
                onClick={() => { void submitDecision() }}
                disabled={submitting}
                style={{ ...primaryBtn, opacity: submitting ? 0.6 : 1, cursor: submitting ? 'wait' : 'pointer' }}
              >
                {submitting ? 'Submitting…' : (decisionMode.kind === 'accepted' ? 'Confirm acceptance' : 'Submit decline')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Subcomponents ───────────────────────────────────────────────────────

function CoverMetaGrid({ proposal }: { proposal: PublicProposal }) {
  const cells: { label: string; value: string }[] = []
  if (proposal.preparedFor) cells.push({ label: 'Prepared for', value: proposal.preparedFor })
  if (proposal.preparedBy) cells.push({ label: 'Prepared by', value: proposal.preparedBy })
  if (proposal.effectiveDate) cells.push({ label: 'Effective', value: formatDate(proposal.effectiveDate) ?? proposal.effectiveDate })
  if (proposal.expiresAt) cells.push({ label: 'Expires', value: formatDate(proposal.expiresAt) ?? proposal.expiresAt })
  if (cells.length === 0) return null
  return (
    <div style={coverMetaGrid}>
      {cells.map(c => (
        <div key={c.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 600, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
            {c.label}
          </div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: '#1f2c1a', overflowWrap: 'break-word', wordBreak: 'break-word' }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

function ProposalSectionRender({ section }: { section: PublicSection }) {
  const data = safeParse<{ html?: string; quote?: string; author?: string; role?: string }>(section.data)
  // testimonial is the one structured type; everything else is HTML.
  if (section.type === 'testimonial') {
    return (
      <section style={slideShell}>
        {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
        {section.title && <h2 style={slideTitle}>{section.title}</h2>}
        <blockquote style={{ fontSize: '1.25rem', lineHeight: 1.5, color: '#1f2c1a', margin: '1.5rem 0 1rem 0', fontStyle: 'italic' }}>
          “{data?.quote ?? ''}”
        </blockquote>
        <div style={{ fontSize: '0.875rem', color: '#5a6657' }}>
          <strong style={{ color: '#1f2c1a' }}>{data?.author ?? ''}</strong>
          {data?.role ? ` · ${data.role}` : ''}
        </div>
      </section>
    )
  }
  // Default: render HTML content slide.
  const html = data?.html ?? ''
  return (
    <section style={slideShell}>
      {section.subtitle && <div style={slideEyebrow}>{section.subtitle}</div>}
      {section.title && <h2 style={slideTitle}>{section.title}</h2>}
      <div style={proseStyle} dangerouslySetInnerHTML={{ __html: html }} />
    </section>
  )
}

function PriceCell({ label, amount, sub }: { label: string; amount: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 600, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#1f2c1a', letterSpacing: '-0.02em', lineHeight: 1 }}>
        {amount}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#8a9987', marginTop: '0.25rem' }}>{sub}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: '#5a6657', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

function BrandMark({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const dim = size === 'sm' ? '1.25rem' : '1.625rem'
  return (
    <div className="inline-flex items-center" style={{ gap: '0.5rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/dashboard/favicon.png"
        alt=""
        aria-hidden="true"
        style={{ width: dim, height: dim, display: 'block', flexShrink: 0 }}
      />
      <span style={{
        fontSize: size === 'sm' ? '0.8125rem' : '0.9375rem',
        fontWeight: 700,
        color: '#1f2c1a',
        letterSpacing: '-0.01em',
      }}>
        Tahi Studio
      </span>
    </div>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: '#f5f7f5',
  fontFamily: 'var(--font-manrope, system-ui)',
  color: '#1f2c1a',
  padding: 'clamp(1rem, 4vw, 2.5rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(1.25rem, 3vw, 2rem)',
}

const coverShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '1rem',
  overflow: 'hidden',
  boxShadow: '0 8px 32px rgba(31, 44, 26, 0.08)',
}

const coverBackdrop: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  background:
    'radial-gradient(circle at 92% 8%, rgba(122, 170, 107, 0.22) 0, transparent 38%),' +
    'radial-gradient(circle at 4% 96%, rgba(220, 239, 216, 0.7) 0, transparent 32%)',
}

const coverInner: React.CSSProperties = {
  position: 'relative',
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'clamp(20rem, 48vh, 32rem)',
  padding: 'clamp(1.25rem, 4vw, 3rem)',
  gap: '1.25rem',
}

const coverEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '0.625rem',
}

const coverTitle: React.CSSProperties = {
  fontSize: 'clamp(1.5rem, 5vw, 3rem)',
  fontWeight: 800,
  lineHeight: 1.05,
  color: '#1f2c1a',
  margin: 0,
  letterSpacing: '-0.015em',
  overflowWrap: 'break-word',
}

const coverMetaGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: '1.25rem',
  paddingTop: '1.25rem',
  borderTop: '1px solid #e8f0e6',
  marginTop: 'auto',
}

const slideShell: React.CSSProperties = {
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '1rem',
  boxShadow: '0 4px 16px rgba(31, 44, 26, 0.05)',
  padding: 'clamp(1.25rem, 3vw, 2rem)',
}

const slideEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '0.375rem',
}

const slideTitle: React.CSSProperties = {
  fontSize: 'clamp(1.25rem, 3vw, 1.875rem)',
  fontWeight: 800,
  color: '#1f2c1a',
  margin: 0,
  letterSpacing: '-0.015em',
}

const slideSub: React.CSSProperties = {
  fontSize: '0.875rem',
  color: '#5a6657',
  marginTop: '0.375rem',
}

const subSlideHeader: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  margin: '0 0 0.5rem 0',
}

const proseStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: '#1f2c1a',
}

const pricingCard: React.CSSProperties = {
  padding: '1.25rem',
  background: '#f0f7ee',
  border: '1px solid #dcefd8',
  borderRadius: '0.75rem',
}

const primaryBtn: React.CSSProperties = {
  padding: '0.75rem 1.5rem',
  fontSize: '0.9375rem',
  fontWeight: 700,
  background: '#5A824E',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  letterSpacing: '-0.005em',
}

const secondaryBtn: React.CSSProperties = {
  padding: '0.75rem 1.25rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  background: '#ffffff',
  color: '#1f2c1a',
  border: '1px solid #d4e0d0',
  borderRadius: '0.5rem',
  cursor: 'pointer',
}

const footer: React.CSSProperties = {
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '0.75rem',
  padding: '1rem 0.5rem',
  borderTop: '1px solid #e8f0e6',
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.625rem 0.75rem',
  fontSize: '0.875rem',
  border: '1px solid #d4e0d0',
  borderRadius: '0.5rem',
  background: '#ffffff',
  color: '#1f2c1a',
  outline: 'none',
}

const modalBackdrop: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 50,
  background: 'rgba(31, 44, 26, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 'clamp(1rem, 4vw, 2rem)',
}

const modalShell: React.CSSProperties = {
  width: '100%',
  maxWidth: '32rem',
  background: '#ffffff',
  borderRadius: '1rem',
  padding: 'clamp(1.25rem, 3vw, 2rem)',
  boxShadow: '0 16px 48px rgba(31, 44, 26, 0.25)',
}

function decidedBanner(kind: 'accepted' | 'declined'): React.CSSProperties {
  return {
    width: '100%',
    maxWidth: '76rem',
    margin: '0 auto',
    padding: '0.875rem 1.25rem',
    background: kind === 'accepted' ? '#f0fdf4' : '#fef2f2',
    color: kind === 'accepted' ? '#15803d' : '#dc2626',
    border: `1px solid ${kind === 'accepted' ? '#bbf7d0' : '#fecaca'}`,
    borderRadius: '0.75rem',
    fontSize: '0.875rem',
  }
}
