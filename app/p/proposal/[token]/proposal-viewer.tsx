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
import { ProposalSectionBlock } from './section-blocks'

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
  // Accept / decline / question modal state.
  const [decisionMode, setDecisionMode] = useState<null | { kind: 'accepted' | 'declined' | 'question'; variantId: string | null }>(null)
  const [decisionForm, setDecisionForm] = useState({ name: '', email: '', role: '', comment: '' })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState<null | 'accepted' | 'declined'>(null)
  // Question state — non-locking. After submit we show a thank-you banner but
  // keep the accept / decline buttons live so the prospect can still proceed.
  const [questionAcked, setQuestionAcked] = useState(false)

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
      if (decisionMode.kind === 'question') {
        // Non-locking — show a thank-you banner but keep buttons live so the
        // prospect can still accept or decline once Liam replies.
        setQuestionAcked(true)
      } else {
        setSubmitted(decisionMode.kind)
      }
      setDecisionMode(null)
      setDecisionForm({ name: '', email: '', role: '', comment: '' })
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
    <div style={pageWrap} className="proposal-deck">
      {/* Slide-deck behaviour: scroll-snap + viewport sizing on desktop,
          natural long-scroll on mobile. Injected as a global stylesheet
          because inline styles can't carry media queries or scroll-snap
          on parent + child together. The deck container is the page body
          itself so the snap works against the document scroll. */}
      <style>{`
        @media (min-width: 768px) {
          html { scroll-snap-type: y mandatory; scroll-behavior: smooth; }
          .proposal-slide { scroll-snap-align: start; scroll-snap-stop: always; }
        }
        @media (max-width: 767px) {
          .proposal-slide { min-height: auto !important; border-top: none !important; padding: 2rem 1rem !important; }
          .proposal-cover { min-height: auto !important; }
        }
      `}</style>

      {/* Cover slide */}
      <section style={coverShell} className="proposal-slide proposal-cover">
        <div style={coverBackdrop} aria-hidden="true" />
        <div style={coverInner}>
          <BrandMark />
          <CoverHeroStats />
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
      {sections.map(s => <ProposalSectionBlock key={s.id} section={s} />)}

      {/* Variants picker + active variant detail */}
      {variants.length > 0 && (
        <section style={slideShell} className="proposal-slide">
          <div style={slideEyebrow}>Choose your package</div>
          <h2 style={slideTitle}>{variants.length === 1 ? activeVariant?.name : 'Pick the package that fits.'}</h2>
          {variants.length > 1 && (
            <p style={slideSub}>
              {variants.length} options · same team, same approach, different scope and investment
            </p>
          )}

          {/* Compare table (only when >1 variant) */}
          {variants.length > 1 && <VariantCompareTable variants={variants} activeVariantId={activeVariantId} onSelect={setActiveVariantId} />}

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
                        Most chosen
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

              {/* Scope — feature checklist (parsed from <li>) + remaining HTML */}
              {activeVariant.scopeHtml && (
                <div>
                  <h3 style={subSlideHeader}>What&apos;s included</h3>
                  <VariantScopeBody html={activeVariant.scopeHtml} />
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
                <>
                  {questionAcked && (
                    <div style={{
                      padding: '0.75rem 1rem',
                      background: '#eff6ff',
                      color: '#1e40af',
                      border: '1px solid #bfdbfe',
                      borderRadius: '0.625rem',
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      lineHeight: 1.5,
                    }}>
                      <strong>Question received.</strong> Liam will reply within one business day. You can still accept or decline below.
                    </div>
                  )}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.625rem', marginTop: '0.5rem' }}>
                    <button
                      onClick={() => setDecisionMode({ kind: 'accepted', variantId: activeVariant.id })}
                      style={primaryBtn}
                    >
                      {activeVariant.ctaLabel?.trim() || `Accept ${activeVariant.name}`}
                    </button>
                    <button
                      onClick={() => setDecisionMode({ kind: 'question', variantId: activeVariant.id })}
                      style={tertiaryBtn}
                    >
                      Ask a question or request a tweak
                    </button>
                    <button
                      onClick={() => setDecisionMode({ kind: 'declined', variantId: null })}
                      style={secondaryBtn}
                    >
                      Decline
                    </button>
                  </div>
                  <p style={{ fontSize: '0.75rem', color: '#8a9987', marginTop: '0.5rem', marginBottom: 0 }}>
                    Not sure? Ask anything — we&apos;d rather refine than push.
                  </p>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* Post-accept timeline — shown once the prospect has accepted */}
      {submitted === 'accepted' && (
        <PostAcceptTimeline variantName={decidedVariant?.name ?? null} />
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
                : decisionMode.kind === 'declined'
                  ? 'Decline this proposal'
                  : 'Ask a question or request a tweak'}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: '#5a6657', margin: 0, marginBottom: '1.25rem' }}>
              {decisionMode.kind === 'accepted'
                ? 'Confirm your name + email so we have a record. We\'ll be in touch within one business day to start the engagement.'
                : decisionMode.kind === 'declined'
                  ? 'Help us improve future proposals by sharing what didn\'t fit. Optional but appreciated.'
                  : 'Tell us what you\'d like to know or what you\'d like to change. Liam replies within one business day. The proposal stays open — no commitment.'}
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
              <Field label={
                decisionMode.kind === 'accepted'
                  ? 'Anything to flag? (optional)'
                  : decisionMode.kind === 'declined'
                    ? 'Reason for declining (optional)'
                    : 'Your question or tweak request'
              }>
                <textarea
                  rows={decisionMode.kind === 'question' ? 5 : 3}
                  value={decisionForm.comment}
                  onChange={(e) => setDecisionForm(f => ({ ...f, comment: e.target.value }))}
                  placeholder={decisionMode.kind === 'question'
                    ? "e.g. Can the Premium variant include CRO from month one? / What if we ship in two phases instead of three?"
                    : ''}
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
                disabled={submitting || (decisionMode.kind === 'question' && !decisionForm.comment.trim())}
                style={{
                  ...primaryBtn,
                  opacity: (submitting || (decisionMode.kind === 'question' && !decisionForm.comment.trim())) ? 0.5 : 1,
                  cursor: submitting ? 'wait' : 'pointer',
                }}
              >
                {submitting
                  ? 'Submitting…'
                  : decisionMode.kind === 'accepted'
                    ? 'Confirm acceptance'
                    : decisionMode.kind === 'declined'
                      ? 'Submit decline'
                      : 'Send to Liam'}
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

// ─── Cover hero — credibility row above the title ─────────────────────────

function CoverHeroStats() {
  const stats: { value: string; label: string }[] = [
    { value: '12 days', label: 'median project → sign' },
    { value: 'Premium', label: 'Webflow Partner' },
    { value: 'Carbon-', label: 'negative since 2024' },
    { value: 'Founder-', label: 'led by Liam + Staci' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.625rem', marginTop: '0.875rem' }}>
      {stats.map(s => (
        <div key={s.label} style={{ background: 'rgba(255,255,255,0.65)', border: '1px solid #e8f0e6', borderRadius: '0 12px 0 12px', padding: '0.625rem 0.875rem', minWidth: 0 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 800, color: '#1f2c1a', letterSpacing: '-0.01em' }}>{s.value}</div>
          <div style={{ fontSize: '0.6875rem', color: '#5a6657' }}>{s.label}</div>
        </div>
      ))}
    </div>
  )
}

// ─── Variant scope body — pulls <li> items out as a check-list ────────────

function VariantScopeBody({ html }: { html: string }) {
  // Extract <li> contents (stripped of nested HTML) from the FIRST <ul>/<ol>
  // and render them as a leaf-radius checklist. Anything outside that list
  // (or all of `html` if no list exists) renders as prose underneath.
  const listMatch = html.match(/<(ul|ol)[\s\S]*?<\/\1>/i)
  const features: string[] = []
  let remainder = html
  if (listMatch) {
    const inner = listMatch[0]
    const items = inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)
    for (const m of items) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      if (text) features.push(text)
    }
    remainder = html.replace(listMatch[0], '').trim()
  }
  return (
    <div>
      {features.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.5rem' }}>
          {features.map((f, i) => (
            <li key={i} style={{ display: 'grid', gridTemplateColumns: '1.25rem 1fr', gap: '0.625rem', alignItems: 'baseline', fontSize: '0.9375rem', color: '#1f2c1a', lineHeight: 1.5 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#5A824E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '0.25rem' }}>
                <polyline points="20 6 9 17 4 12" />
              </svg>
              <span>{f}</span>
            </li>
          ))}
        </ul>
      )}
      {remainder && (
        <div style={{ ...proseStyle, marginTop: features.length > 0 ? '1rem' : 0 }} dangerouslySetInnerHTML={{ __html: remainder }} />
      )}
    </div>
  )
}

// ─── Variant compare table — shown when N≥2 variants ──────────────────────

function VariantCompareTable({
  variants, activeVariantId, onSelect,
}: {
  variants: PublicVariant[]
  activeVariantId: string | null
  onSelect: (id: string) => void
}) {
  // Build a feature matrix: for each variant, parse <li> items from scopeHtml.
  // Union the labels in order of first appearance, then mark each variant
  // as having a feature if its list contained that label.
  const variantFeatures: { id: string; features: Set<string> }[] = variants.map(v => {
    const set = new Set<string>()
    const html = v.scopeHtml ?? ''
    const list = html.match(/<(ul|ol)[\s\S]*?<\/\1>/i)?.[0] ?? ''
    for (const m of list.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)) {
      const text = m[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()
      if (text) set.add(text)
    }
    return { id: v.id, features: set }
  })
  const allFeatures: string[] = []
  for (const vf of variantFeatures) {
    for (const f of vf.features) {
      if (!allFeatures.includes(f)) allFeatures.push(f)
    }
  }
  if (allFeatures.length === 0) return null

  return (
    <div style={{ marginTop: '1.25rem', overflowX: 'auto', border: '1px solid #e8f0e6', borderRadius: '0.875rem' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
        <thead>
          <tr>
            <th style={compareTh}>What&apos;s included</th>
            {variants.map(v => {
              const isActive = v.id === activeVariantId
              return (
                <th
                  key={v.id}
                  onClick={() => onSelect(v.id)}
                  style={{
                    ...compareTh,
                    cursor: 'pointer',
                    textAlign: 'center',
                    color: isActive ? '#ffffff' : '#1f2c1a',
                    background: isActive ? '#1f2c1a' : '#fdfefd',
                    borderLeft: '1px solid #e8f0e6',
                    minWidth: '8rem',
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{v.name}</div>
                  <div style={{ fontWeight: 500, fontSize: '0.75rem', color: isActive ? '#a8c89e' : '#5a6657', marginTop: '0.125rem' }}>
                    {priceLabel(v)}
                  </div>
                  {v.isFeatured ? (
                    <div style={{ marginTop: '0.375rem', fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: isActive ? '#93c98a' : '#5A824E' }}>
                      Most chosen
                    </div>
                  ) : null}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {allFeatures.map((f, i) => (
            <tr key={i} style={{ borderTop: '1px solid #f0f4ee' }}>
              <td style={compareTd}>{f}</td>
              {variantFeatures.map(vf => {
                const has = vf.features.has(f)
                return (
                  <td key={vf.id} style={{ ...compareTd, textAlign: 'center', borderLeft: '1px solid #f0f4ee' }}>
                    {has ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#5A824E" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span style={{ color: '#c8d4c5', fontSize: '0.875rem' }}>—</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function priceLabel(v: PublicVariant): string {
  const oneOff = v.oneOffAmount > 0 ? formatMoney(v.oneOffAmount, v.currency) : ''
  const monthly = v.monthlyAmount > 0 ? `${formatMoney(v.monthlyAmount, v.currency)}/mo` : ''
  return [oneOff, monthly].filter(Boolean).join(' + ') || 'TBC'
}

const compareTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.875rem 1rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: '#1f2c1a',
  background: '#fdfefd',
}
const compareTd: React.CSSProperties = {
  padding: '0.625rem 1rem',
  color: '#1f2c1a',
  verticalAlign: 'middle',
}

// ─── Post-accept timeline ────────────────────────────────────────────────

function PostAcceptTimeline({ variantName }: { variantName?: string | null }) {
  const steps: { title: string; body: string }[] = [
    { title: 'Right now', body: 'Liam gets the email and your dashboard project is created. We confirm receipt within one business day.' },
    { title: 'Tomorrow', body: 'Personal Loom from Liam: a walkthrough of your client portal — how to make requests, what to expect, and the first tasks queued up.' },
    { title: 'This week', body: 'Discovery items kick off. Tracks move through the dashboard, you see progress live and can request changes anytime.' },
    { title: 'Around delivery', body: 'Two to three weeks before handoff we open the retainer conversation — your 10% lifetime discount is already earned.' },
  ]
  return (
    <section style={{ ...slideShell, background: '#1f2c1a', color: '#ffffff', border: 'none' }}>
      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: '#93c98a', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
        What happens next
      </div>
      <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.015em' }}>
        Welcome aboard{variantName ? ` · ${variantName}` : ''}.
      </h2>
      <p style={{ fontSize: '0.9375rem', color: '#dcefd8', maxWidth: '40rem', marginTop: '0.75rem', marginBottom: '1.5rem', lineHeight: 1.6 }}>
        You&rsquo;ve done the hard part. Here&rsquo;s the next 14 days from your side.
      </p>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.625rem' }}>
        {steps.map((s, i) => (
          <li key={i} style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0.875rem', alignItems: 'flex-start', padding: '0.875rem 1rem', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(220,239,216,0.2)', borderRadius: '0.625rem' }}>
            <div style={{ width: '2rem', height: '2rem', borderRadius: '0 10px 0 10px', background: '#5A824E', color: '#ffffff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.75rem', fontWeight: 800 }}>{i + 1}</div>
            <div>
              <div style={{ fontSize: '0.875rem', fontWeight: 700, color: '#ffffff' }}>{s.title}</div>
              <div style={{ fontSize: '0.8125rem', color: '#a8c89e', marginTop: '0.25rem', lineHeight: 1.5 }}>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
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
  // Pure white per Brand Guidelines (`#FFFFFF`). Replaces the off-white
  // we used previously which read as "card on a tray" — the deck should
  // feel like the surface itself, not a card on a surface.
  minHeight: '100vh',
  background: '#FFFFFF',
  fontFamily: 'var(--font-manrope, system-ui)',
  // Brand text — true near-black with a green undertone (Brand Guidelines).
  color: '#121A0F',
  // No outer padding: slides own their own padding so they fill the viewport.
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 0,
}

const coverShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  // Full bleed cover slide. No card border on desktop — the cover IS the
  // surface. Subtle gradient + brand circle motif do the visual work.
  background: '#FFFFFF',
  overflow: 'hidden',
  // Slides are viewport-sized on desktop so the deck genuinely feels like
  // a presentation. svh respects mobile address-bar collapse better than vh.
  minHeight: '100svh',
  display: 'flex',
  flexDirection: 'column',
  // Tailwind snap utility classes are added on the JSX as
  // `md:snap-start md:snap-always`.
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
  minHeight: '100svh',
  // Inner content rail — keeps long titles readable on huge displays.
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  padding: 'clamp(2rem, 6vw, 5rem) clamp(1.25rem, 5vw, 3rem)',
  gap: '2rem',
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
  // Premium hero size — the cover earns the screen.
  fontSize: 'clamp(2.25rem, 7.5vw, 5.5rem)',
  fontWeight: 800,
  lineHeight: 0.98,
  color: '#121A0F',
  margin: 0,
  letterSpacing: '-0.025em',
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
  // Each section is a true slide on desktop: full viewport, no card border,
  // generous padding, content centred horizontally with a max-width band.
  width: '100%',
  background: '#FFFFFF',
  border: 'none',
  borderRadius: 0,
  boxShadow: 'none',
  padding: 'clamp(2rem, 6vw, 5rem) clamp(1.25rem, 5vw, 3rem)',
  minHeight: '100svh',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  // Soft separator between slides on desktop (so the deck doesn't feel
  // entirely seamless). Mobile drops this via a stylesheet override.
  borderTop: '1px solid #e8f0e6',
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

const tertiaryBtn: React.CSSProperties = {
  padding: '0.75rem 1.25rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  background: '#f0f7ee',
  color: '#425F39',
  border: '1px solid #dcefd8',
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
