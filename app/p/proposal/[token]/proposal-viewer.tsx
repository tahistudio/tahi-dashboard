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

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
  coverTheme?: CoverTheme | null
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

/**
 * Cover themes — four distinct moods for slide 1. Persisted as `cover_theme`.
 *
 *  - brand_glass : brand-green base with translucent glass cards (suggested)
 *  - toned_light : warm off-white, brand-tinted accents
 *  - light       : pure white, brand text (the legacy default)
 *  - dark        : deep brand-dark green, white text
 *
 * Per-section themes still live on section.data.theme. This is metadata for
 * the cover only.
 */
export type CoverTheme = 'brand_glass' | 'toned_light' | 'light' | 'dark'

export interface CoverPalette {
  background: string
  text: string
  textSubtle: string
  textMuted: string
  ringColor: string
  ringOpacity: number
  cardBg: string
  cardBorder: string
  cardBackdrop: string
  eyebrow: string
  isDarkMode: boolean
}

export function coverPalette(theme: CoverTheme | null | undefined): CoverPalette {
  switch (theme) {
    case 'brand_glass':
      return {
        background: 'linear-gradient(135deg, #5A824E 0%, #425F39 100%)',
        text: '#FFFFFF',
        textSubtle: '#dcefd8',
        textMuted: '#a8c89e',
        ringColor: '#FFFFFF',
        ringOpacity: 0.18,
        cardBg: 'rgba(255,255,255,0.10)',
        cardBorder: 'rgba(255,255,255,0.22)',
        cardBackdrop: 'blur(12px)',
        eyebrow: '#dcefd8',
        isDarkMode: true,
      }
    case 'dark':
      return {
        background: '#1f2c1a',
        text: '#FFFFFF',
        textSubtle: '#dcefd8',
        textMuted: '#a8c89e',
        ringColor: '#93c98a',
        ringOpacity: 0.18,
        cardBg: 'rgba(255,255,255,0.06)',
        cardBorder: 'rgba(220,239,216,0.2)',
        cardBackdrop: 'none',
        eyebrow: '#a8c89e',
        isDarkMode: true,
      }
    case 'toned_light':
      return {
        background: 'linear-gradient(135deg, #f5f3ed 0%, #eef3ec 100%)',
        text: '#121A0F',
        textSubtle: '#3d5034',
        textMuted: '#5a6657',
        ringColor: '#5A824E',
        ringOpacity: 0.18,
        cardBg: 'rgba(255,255,255,0.7)',
        cardBorder: '#e8e3d6',
        cardBackdrop: 'blur(6px)',
        eyebrow: '#5A824E',
        isDarkMode: false,
      }
    case 'light':
    default:
      return {
        background: '#FFFFFF',
        text: '#121A0F',
        textSubtle: '#3d5034',
        textMuted: '#5a6657',
        ringColor: '#5A824E',
        ringOpacity: 0.14,
        cardBg: 'rgba(255,255,255,0.65)',
        cardBorder: '#e8f0e6',
        cardBackdrop: 'none',
        eyebrow: '#8a9987',
        isDarkMode: false,
      }
  }
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

/**
 * Two ways to call this viewer:
 *   <ProposalViewer token="..." />                  // public mode, fetches via token
 *   <ProposalViewer previewProposalId="..." />      // admin preview, fetches live data
 *
 * Preview mode disables accept/decline/question — those require a real
 * public token + token-validation on the server. Preview is read-only.
 */
type ProposalViewerProps =
  | { token: string; previewProposalId?: undefined }
  | { token?: undefined; previewProposalId: string }

export function ProposalViewer(props: ProposalViewerProps) {
  const { token, previewProposalId } = props
  const isPreview = !!previewProposalId
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

  // ── Slide navigation (desktop) ─────────────────────────────────────────
  // Horizontal slide deck on desktop, natural long-scroll on mobile. Track
  // the active slide index and advance via side arrows, keyboard arrows,
  // or the dot indicator. Mobile bypasses this entirely (CSS overrides
  // the track transform to none and switches to flow layout).
  const [activeSlide, setActiveSlide] = useState(0)
  const totalSlides = useMemo(() => {
    let n = 1 // cover
    n += sections.length
    if (variants.length > 0) n += 1 // variants slide
    if (submitted === 'accepted') n += 1 // post-accept timeline
    return n
  }, [sections.length, variants.length, submitted])

  // Clamp activeSlide if total shrinks (e.g. data refresh).
  useEffect(() => {
    if (activeSlide >= totalSlides) setActiveSlide(Math.max(0, totalSlides - 1))
  }, [activeSlide, totalSlides])

  // Keyboard navigation. Skip when the user is interacting with form
  // fields (decision modal etc.) — checking document.activeElement avoids
  // hijacking arrow keys inside text inputs.
  useEffect(() => {
    function isTypingTarget(): boolean {
      const el = document.activeElement
      if (!el) return false
      const tag = el.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true
      return (el as HTMLElement).isContentEditable === true
    }
    function onKey(e: KeyboardEvent) {
      if (decisionMode) return // modal owns keyboard while open
      if (isTypingTarget()) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        setActiveSlide(s => Math.min(s + 1, totalSlides - 1))
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        setActiveSlide(s => Math.max(s - 1, 0))
      } else if (e.key === 'Home') {
        e.preventDefault()
        setActiveSlide(0)
      } else if (e.key === 'End') {
        e.preventDefault()
        setActiveSlide(totalSlides - 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [totalSlides, decisionMode])

  const reload = useCallback(async () => {
    try {
      const url = isPreview
        ? apiPath(`/api/admin/proposals/${encodeURIComponent(previewProposalId!)}/preview-data`)
        : apiPath(`/api/public/proposals/${encodeURIComponent(token!)}`)
      const res = await fetch(url)
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
  }, [token, previewProposalId, isPreview])

  useEffect(() => { void reload() }, [reload])

  useShareViewTracking({
    resourceType: 'proposal',
    resourceId: analyticsResourceId,
    // No token in preview mode — share tracking endpoint requires a token.
    shareToken: isPreview ? null : token,
  })

  async function submitDecision() {
    if (!decisionMode) return
    if (!token) return // Preview mode — accept/decline disabled, buttons are hidden
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
      {/* Horizontal slide deck on desktop, natural long-scroll on mobile.
          Track translates by viewport-widths for slide advance; vertical
          scroll within a slide is preserved when content overflows.
          Mobile (<768px) bypasses the track entirely — slides stack and
          flow naturally so the experience doesn't fight the touch model. */}
      <style>{`
        @media (min-width: 768px) {
          html, body { overflow: hidden; height: 100%; }
          .proposal-track {
            display: flex;
            flex-direction: row;
            height: 100vh;
            transition: transform 480ms cubic-bezier(0.22, 1, 0.36, 1);
          }
          .proposal-slide {
            width: 100vw;
            flex-shrink: 0;
            min-height: 100vh;
            overflow-y: auto;
            border-top: none !important;
          }
        }
        @media (max-width: 767px) {
          .proposal-track { display: block; transform: none !important; height: auto; }
          .proposal-slide { min-height: auto !important; border-top: none !important; padding: 2rem 1rem !important; width: 100% !important; }
          .proposal-cover { min-height: auto !important; }
        }
      `}</style>

      {/* Preview-mode pill — floats at the top so admin knows they're
          looking at unpublished, live state and not what the client sees. */}
      {isPreview && (
        <div
          style={{
            position: 'fixed',
            top: '1rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            padding: '0.5rem 1rem',
            background: '#1f2c1a',
            color: '#FFFFFF',
            borderRadius: '999px',
            fontSize: '0.75rem',
            fontWeight: 600,
            letterSpacing: '0.04em',
            boxShadow: '0 8px 24px rgba(31, 44, 26, 0.25)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: '#93c98a' }} />
          Admin preview · live, unpublished state
        </div>
      )}

      {/* Already-decided banner — fixed at top so it's visible regardless
          of which slide the prospect is on. */}
      {submitted && (
        <div style={{ ...decidedBanner(submitted), position: 'fixed', top: '1rem', left: '1rem', right: '1rem', zIndex: 40, maxWidth: 'calc(100% - 2rem)' }}>
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

      {/* Side arrows + slide counter — desktop only via media query. */}
      <SlideNav active={activeSlide} total={totalSlides} onChange={setActiveSlide} />

      {/* Slide track. Each direct child is one slide; CSS lays them out as
          a horizontal row on desktop and stacks them vertically on mobile. */}
      <div
        className="proposal-track"
        style={{ transform: `translateX(-${activeSlide * 100}vw)` }}
      >
        {/* Cover slide — palette comes from proposal.coverTheme. */}
        {(() => {
          const palette = coverPalette(proposal.coverTheme)
          return (
            <section
              style={{ ...coverShell, background: palette.background, color: palette.text }}
              className="proposal-slide proposal-cover"
            >
              <BrandCircleBackdrop palette={palette} />
              <div style={coverInner}>
                <BrandMark dark={palette.isDarkMode} />
                <CoverHeroStats palette={palette} />
                <div style={{ marginTop: 'auto' }}>
                  {proposal.subtitle && (
                    <div style={{ ...coverEyebrow, color: palette.eyebrow }}>{proposal.subtitle}</div>
                  )}
                  <h1 style={{ ...coverTitle, color: palette.text }}>{proposal.title}</h1>
                </div>
                <CoverMetaGrid proposal={proposal} palette={palette} />
              </div>
            </section>
          )
        })()}

        {/* Shared sections in order */}
        {sections.map(s => <ProposalSectionBlock key={s.id} section={s} />)}

      {/* Variants picker + active variant detail */}
      {variants.length > 0 && (
        <VariantsSlide
          variants={variants}
          activeVariantId={activeVariantId}
          activeVariant={activeVariant ?? null}
          onSelect={setActiveVariantId}
          onDecision={kind => setDecisionMode({
            kind,
            variantId: kind === 'declined' ? null : (activeVariant?.id ?? null),
          })}
          submitted={submitted}
          isPreview={isPreview}
          questionAcked={questionAcked}
        />
      )}

        {/* Post-accept timeline — included as the final slide once accepted */}
        {submitted === 'accepted' && (
          <PostAcceptTimeline variantName={decidedVariant?.name ?? null} />
        )}
      </div>{/* /proposal-track */}

      {/* Footer — fixed to the bottom-left so it stays visible across slides */}
      <footer
        style={{
          position: 'fixed',
          bottom: '1rem',
          left: '1rem',
          zIndex: 30,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.625rem',
          padding: '0.5rem 0.875rem',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #e8f0e6',
          borderRadius: '999px',
          fontSize: '0.6875rem',
          color: '#5a6657',
        }}
      >
        <BrandMark size="sm" />
        <span style={{ color: '#8a9987' }}>
          Confidential · {formatDate(proposal.effectiveDate) ?? 'this period'}
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

function CoverMetaGrid({ proposal, palette }: { proposal: PublicProposal; palette: CoverPalette }) {
  const cells: { label: string; value: string }[] = []
  if (proposal.preparedFor) cells.push({ label: 'Prepared for', value: proposal.preparedFor })
  if (proposal.preparedBy) cells.push({ label: 'Prepared by', value: proposal.preparedBy })
  if (proposal.effectiveDate) cells.push({ label: 'Effective', value: formatDate(proposal.effectiveDate) ?? proposal.effectiveDate })
  if (proposal.expiresAt) cells.push({ label: 'Expires', value: formatDate(proposal.expiresAt) ?? proposal.expiresAt })
  if (cells.length === 0) return null
  return (
    <div style={{ ...coverMetaGrid, position: 'relative', zIndex: 1 }}>
      {cells.map(c => (
        <div key={c.label} style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.625rem', fontWeight: 600, color: palette.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
            {c.label}
          </div>
          <div style={{ fontSize: '0.9375rem', fontWeight: 600, color: palette.text, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
            {c.value}
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Cover hero — credibility row above the title ─────────────────────────

/**
 * <SlideNav> — desktop-only side arrows + bottom-centre slide counter.
 *
 * Hidden under the 768px breakpoint via media query (mobile uses natural
 * vertical scroll). Disabled state on the prev/next buttons at the ends
 * of the deck. The dot row doubles as direct-jump nav.
 */
function SlideNav({ active, total, onChange }: {
  active: number
  total: number
  onChange: (i: number) => void
}) {
  return (
    <>
      <style>{`
        @media (max-width: 767px) { .proposal-nav-arrow, .proposal-nav-counter { display: none !important; } }
      `}</style>
      <button
        type="button"
        aria-label="Previous slide"
        disabled={active === 0}
        onClick={() => onChange(Math.max(0, active - 1))}
        className="proposal-nav-arrow"
        style={{
          position: 'fixed',
          left: '1.25rem',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 35,
          width: '3rem',
          height: '3rem',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #e8f0e6',
          color: '#1f2c1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: active === 0 ? 'default' : 'pointer',
          opacity: active === 0 ? 0.35 : 1,
          boxShadow: '0 4px 16px rgba(31, 44, 26, 0.08)',
          transition: 'opacity 200ms ease, transform 200ms ease',
        }}
      >
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        aria-label="Next slide"
        disabled={active >= total - 1}
        onClick={() => onChange(Math.min(total - 1, active + 1))}
        className="proposal-nav-arrow"
        style={{
          position: 'fixed',
          right: '1.25rem',
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 35,
          width: '3rem',
          height: '3rem',
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #e8f0e6',
          color: '#1f2c1a',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: active >= total - 1 ? 'default' : 'pointer',
          opacity: active >= total - 1 ? 0.35 : 1,
          boxShadow: '0 4px 16px rgba(31, 44, 26, 0.08)',
          transition: 'opacity 200ms ease',
        }}
      >
        <ChevronRight size={20} />
      </button>
      {/* Counter + dots */}
      <div
        className="proposal-nav-counter"
        style={{
          position: 'fixed',
          bottom: '1rem',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 30,
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.875rem',
          padding: '0.5rem 1rem',
          background: 'rgba(255,255,255,0.85)',
          backdropFilter: 'blur(8px)',
          border: '1px solid #e8f0e6',
          borderRadius: '999px',
          fontSize: '0.75rem',
          color: '#5a6657',
        }}
      >
        <span style={{ fontWeight: 700, color: '#1f2c1a', fontVariantNumeric: 'tabular-nums' }}>
          {active + 1} <span style={{ color: '#8a9987', fontWeight: 500 }}>/ {total}</span>
        </span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3125rem' }}>
          {Array.from({ length: total }).map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => onChange(i)}
              style={{
                width: i === active ? '1.25rem' : '0.5rem',
                height: '0.5rem',
                borderRadius: '999px',
                background: i === active ? '#5A824E' : '#d4e0d0',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                transition: 'width 200ms ease, background 200ms ease',
              }}
            />
          ))}
        </div>
      </div>
    </>
  )
}

/**
 * <BrandCircleBackdrop> — the brand circle ring used as atmospheric depth
 * on the cover slide. Per Brand Guidelines §"Circle Background Element":
 * 20–60% opacity, partial-cropped at the canvas edge, in Brand Green.
 * Replaces the off-brand radial gradient that used to sit on covers.
 */
function BrandCircleBackdrop({ palette }: { palette: CoverPalette }) {
  // CSS-rendered full ring. Colour and opacity come from the active cover
  // palette so the circle reads correctly on any background.
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: '-18rem',
        right: '-18rem',
        width: '52rem',
        height: '52rem',
        borderRadius: '50%',
        border: `6rem solid ${palette.ringColor}`,
        opacity: palette.ringOpacity,
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  )
}

function CoverHeroStats({ palette }: { palette: CoverPalette }) {
  const stats: { value: string; label: string }[] = [
    { value: '12 days', label: 'median project, signed to live' },
    { value: 'Premium', label: 'Webflow Partner' },
    { value: 'Carbon', label: 'negative since 2024' },
    { value: 'Founder-led', label: 'by Liam and Staci' },
  ]
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.625rem', marginTop: '0.875rem', position: 'relative', zIndex: 1 }}>
      {stats.map(s => (
        <div
          key={s.label}
          style={{
            background: palette.cardBg,
            border: `1px solid ${palette.cardBorder}`,
            backdropFilter: palette.cardBackdrop,
            WebkitBackdropFilter: palette.cardBackdrop,
            borderRadius: '0 12px 0 12px',
            padding: '0.625rem 0.875rem',
            minWidth: 0,
          }}
        >
          <div style={{ fontSize: '0.875rem', fontWeight: 800, color: palette.text, letterSpacing: '-0.01em' }}>{s.value}</div>
          <div style={{ fontSize: '0.6875rem', color: palette.textMuted }}>{s.label}</div>
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

// ─── Variants slide — premium tabbed reveal with motion ──────────────────

/**
 * <VariantsSlide> — the package-picker slide.
 *
 * Replaces the old grid-of-cards with a pill-shaped tab strip on top, an
 * animated indicator that slides between tabs, and a content area that
 * cross-fades on switch. The price cells count up from the previous value
 * to the new one so the buyer sees the change rather than just reading it.
 *
 * The compare-table view is opt-in via the "Compare side-by-side" toggle
 * underneath the tabs. Default is the cinematic single-variant reveal.
 */
function VariantsSlide({
  variants, activeVariantId, activeVariant, onSelect, onDecision,
  submitted, isPreview, questionAcked,
}: {
  variants: PublicVariant[]
  activeVariantId: string | null
  activeVariant: PublicVariant | null
  onSelect: (id: string) => void
  onDecision: (kind: 'accepted' | 'declined' | 'question') => void
  submitted: 'accepted' | 'declined' | null
  isPreview: boolean
  questionAcked: boolean
}) {
  const [showCompare, setShowCompare] = useState(false)
  const featured = variants.find(v => v.isFeatured)

  return (
    <section style={slideShell} className="proposal-slide">
      <style>{`
        @keyframes variantFadeIn {
          from { opacity: 0; transform: translateY(0.5rem); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes compareFadeIn {
          from { opacity: 0; transform: translateY(-0.25rem); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>

      <div style={slideEyebrow}>Choose your package</div>
      <h2 style={slideTitle}>
        {variants.length === 1 ? activeVariant?.name : 'Pick the one that fits.'}
      </h2>
      {variants.length > 1 && (
        <p style={slideSub}>
          {variants.length} options. Same team, same approach, different scope and investment.
        </p>
      )}

      {/* Tab strip — only when N>1 */}
      {variants.length > 1 && (
        <>
          {featured && (
            <div style={{ marginTop: '1.5rem', marginBottom: '0.5rem' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.625rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: '#5A824E',
              }}>
                <span style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: '#5A824E' }} />
                Most clients pick {featured.name}
              </span>
            </div>
          )}

          <VariantTabStrip
            variants={variants}
            activeVariantId={activeVariantId}
            onSelect={onSelect}
          />

          <div style={{ marginTop: '0.625rem' }}>
            <button
              type="button"
              onClick={() => setShowCompare(s => !s)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#5A824E',
                cursor: 'pointer',
                textDecoration: 'underline',
                textDecorationThickness: '1px',
                textUnderlineOffset: '0.25rem',
              }}
            >
              {showCompare ? 'Hide side-by-side' : 'Compare side-by-side'}
            </button>
          </div>

          {showCompare && (
            <div style={{ animation: 'compareFadeIn 280ms ease-out' }}>
              <VariantCompareTable variants={variants} activeVariantId={activeVariantId} onSelect={onSelect} />
            </div>
          )}
        </>
      )}

      {/* Active variant content — keyed so it cross-fades on switch */}
      {activeVariant && (
        <div
          key={activeVariant.id}
          style={{
            marginTop: '1.5rem',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '1.5rem',
            animation: 'variantFadeIn 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {activeVariant.tagline && (
            <p style={{ fontSize: '1rem', color: '#5a6657', margin: 0, fontStyle: 'italic' }}>
              {activeVariant.tagline}
            </p>
          )}

          {activeVariant.scopeHtml && (
            <div>
              <h3 style={subSlideHeader}>What&apos;s included</h3>
              <VariantScopeBody html={activeVariant.scopeHtml} />
            </div>
          )}

          <div style={pricingCard}>
            <h3 style={{ ...subSlideHeader, marginTop: 0 }}>Investment</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'baseline' }}>
              {activeVariant.oneOffAmount > 0 && (
                <AnimatedPriceCell
                  label="One-off"
                  value={activeVariant.oneOffAmount}
                  currency={activeVariant.currency}
                  sub="paid as scheduled in the SoW"
                />
              )}
              {activeVariant.monthlyAmount > 0 && (
                <AnimatedPriceCell
                  label="Monthly"
                  value={activeVariant.monthlyAmount}
                  currency={activeVariant.currency}
                  suffix="/mo"
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

          {activeVariant.timelineScheduleId && (
            <div style={{ fontSize: '0.875rem', color: '#5a6657' }}>
              <strong style={{ color: '#1f2c1a' }}>Project schedule</strong> attached separately. Ask
              the sender for the timeline link if you haven&apos;t already received it.
            </div>
          )}

          {!submitted && !isPreview && (
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
                <button onClick={() => onDecision('accepted')} style={primaryBtn}>
                  {activeVariant.ctaLabel?.trim() || `Accept ${activeVariant.name}`}
                </button>
                <button onClick={() => onDecision('question')} style={tertiaryBtn}>
                  Ask a question or request a tweak
                </button>
                <button onClick={() => onDecision('declined')} style={secondaryBtn}>
                  Decline
                </button>
              </div>
              <p style={{ fontSize: '0.75rem', color: '#8a9987', marginTop: '0.5rem', marginBottom: 0 }}>
                Not sure? Ask anything. We&apos;d rather refine than push.
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * <VariantTabStrip> — pill-shaped tab strip with a sliding indicator.
 *
 * The indicator's left and width come from measuring each tab's bounding
 * box on mount and on resize. CSS transitions on transform and width
 * give the indicator the smooth slide-and-stretch motion.
 */
function VariantTabStrip({
  variants, activeVariantId, onSelect,
}: {
  variants: PublicVariant[]
  activeVariantId: string | null
  onSelect: (id: string) => void
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  const [indicator, setIndicator] = useState<{ left: number; width: number } | null>(null)

  // Measure the active tab's bounding box relative to the container. Re-run
  // whenever the active variant changes or the container resizes. Falls
  // back to no indicator on the first render before refs are populated.
  useEffect(() => {
    function measure() {
      const container = containerRef.current
      const activeId = activeVariantId
      if (!container || !activeId) return
      const tab = tabRefs.current.get(activeId)
      if (!tab) return
      const containerRect = container.getBoundingClientRect()
      const tabRect = tab.getBoundingClientRect()
      setIndicator({
        left: tabRect.left - containerRect.left,
        width: tabRect.width,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    if (containerRef.current) ro.observe(containerRef.current)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [activeVariantId, variants.length])

  return (
    <div
      ref={containerRef}
      role="tablist"
      style={{
        position: 'relative',
        display: 'inline-flex',
        background: '#f7f9f6',
        border: '1px solid #e8f0e6',
        borderRadius: '999px',
        padding: '0.25rem',
        boxShadow: 'inset 0 1px 2px rgba(31,44,26,0.04)',
        overflow: 'hidden',
        maxWidth: '100%',
        flexWrap: 'nowrap',
      }}
    >
      {indicator && (
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            top: '0.25rem',
            bottom: '0.25rem',
            left: 0,
            width: indicator.width,
            transform: `translateX(${indicator.left}px)`,
            background: '#1f2c1a',
            borderRadius: '999px',
            transition: 'transform 320ms cubic-bezier(0.32, 0.72, 0.16, 1.02), width 320ms cubic-bezier(0.32, 0.72, 0.16, 1.02)',
            boxShadow: '0 4px 14px -2px rgba(31,44,26,0.35)',
            zIndex: 0,
          }}
        />
      )}
      {variants.map(v => {
        const isActive = v.id === activeVariantId
        return (
          <button
            key={v.id}
            ref={el => { if (el) tabRefs.current.set(v.id, el); else tabRefs.current.delete(v.id) }}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(v.id)}
            style={{
              position: 'relative',
              zIndex: 1,
              padding: '0.625rem 1.125rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'transparent',
              color: isActive ? '#ffffff' : '#1f2c1a',
              border: 'none',
              borderRadius: '999px',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'color 240ms ease',
            }}
          >
            {v.name}
          </button>
        )
      })}
    </div>
  )
}

/**
 * <AnimatedPriceCell> — money cell that counts from the previous value to
 * the new one when the active variant changes. Cubic ease-out, ~620ms.
 * Falls back to the static value if `prefers-reduced-motion` is set.
 */
function AnimatedPriceCell({
  label, value, currency, suffix, sub,
}: {
  label: string
  value: number
  currency: string
  suffix?: string
  sub: string
}) {
  const [display, setDisplay] = useState(value)
  const prevRef = useRef(value)

  useEffect(() => {
    const start = prevRef.current
    const end = value
    if (start === end) {
      setDisplay(end)
      return
    }
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setDisplay(end)
      prevRef.current = end
      return
    }
    const duration = 620
    const t0 = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / duration)
      const eased = 1 - Math.pow(1 - p, 3)
      setDisplay(start + (end - start) * eased)
      if (p < 1) raf = requestAnimationFrame(tick)
      else prevRef.current = end
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])

  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 600, color: '#8a9987', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#1f2c1a', letterSpacing: '-0.02em', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {formatMoney(Math.round(display), currency)}{suffix}
      </div>
      <div style={{ fontSize: '0.75rem', color: '#8a9987', marginTop: '0.25rem' }}>{sub}</div>
    </div>
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

function BrandMark({ size = 'md', dark = false }: { size?: 'sm' | 'md'; dark?: boolean }) {
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
        color: dark ? '#FFFFFF' : '#1f2c1a',
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

// Note: coverBackdrop (the off-brand radial gradient) was retired in Phase 9
// round 2 in favour of the on-brand <BrandCircleBackdrop> SVG. Kept the
// const removed entirely so nothing reaches for the old gradient.

const coverInner: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
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
  // Each section is one slide. On desktop the track lays them out in a
  // row and translates between them; on mobile they stack vertically.
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
