/**
 * <ProposalViewer>: public, no-auth viewer for a client proposal.
 *
 * Slice 2 of the deliverable rebuild (after the schedule viewer).
 * Restructured 2026-05-27 so the proposal reads as a paginated agency
 * document, mirroring the schedule viewer's visual rhythm: dark cover
 * hero from <CoverPage>, sectioned page-by-page flow with <PageChrome>
 * around every section, cream surface, brand-green accent words via
 * the {{...}} title syntax.
 *
 * Sections still dispatch through `section-blocks.tsx` (one renderer per
 * type); we just wrap each renderer's output in <PageChrome> so the
 * deliverable feels like a single document rather than a slide deck.
 *
 * Decision flow (unchanged):
 *   - User clicks Accept on a variant, modal asks for name/email/role/comment.
 *   - Submit POSTs to /api/public/proposals/[token]/accept.
 *   - On success the viewer flips into "accepted" or "declined" state.
 *
 * Analytics (unchanged):
 *   - useShareViewTracking records the session.
 *   - useSectionDwellTracking records per-section dwell so the admin
 *     ShareAnalyticsCard can show which slides the prospect lingered on.
 */
'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { apiPath } from '@/lib/api'
import { useShareViewTracking } from '@/components/tahi/use-share-view-tracking'
import { useSectionDwellTracking } from '@/components/tahi/use-section-dwell-tracking'
import {
  BrandMark, CoverPage, PageChrome, AccentTitle, BRAND,
  type MetadataCell, type PageChromeTheme,
} from '@/components/tahi/deliverable'
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
  themeMode?: string | null
  position: number
}

/** Coerce the raw themeMode column into the strict PageChromeTheme union. */
function normaliseTheme(value: string | null | undefined): PageChromeTheme {
  if (value === 'dark' || value === 'feature') return value
  return 'light'
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
 * Cover themes. Kept as a type export for backward compat with the admin
 * editor (which still writes `cover_theme` into the row). The public viewer
 * no longer branches on cover theme since the rebuilt <CoverPage> is a
 * single brand-consistent dark hero per the deliverable spec.
 */
export type CoverTheme = 'brand_glass' | 'toned_light' | 'light' | 'dark'

/**
 * Legacy palette helper. Retained so external imports keep working but
 * the public viewer itself no longer references it. Kept as a thin
 * wrapper that always returns the dark palette since the rebuilt cover
 * is brand-consistent. Safe to remove when no external readers remain.
 */
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

export function coverPalette(_theme: CoverTheme | null | undefined): CoverPalette {
  void _theme
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
}

function safeFormatMoney(n: number, currency: string): string {
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
 * Compose a cover title with {{accent words}} flagged in brand-green.
 * Tahi's convention from the PDF reference: keep the agency name and
 * scope literal, accent the client name or the value the proposal
 * delivers. Example: "Tahi proposal for {{Giant Group}}".
 */
function composeCoverTitle(proposal: PublicProposal): string {
  const raw = (proposal.title ?? '').trim()
  const org = (proposal.orgName ?? '').trim()
  // If the proposal title already contains accent braces, trust it.
  if (/\{\{[^}]+\}\}/.test(raw)) return raw
  // Otherwise, if the title contains the org name, accent it inline.
  if (org && raw && raw.toLowerCase().includes(org.toLowerCase())) {
    const idx = raw.toLowerCase().indexOf(org.toLowerCase())
    return raw.slice(0, idx) + `{{${raw.slice(idx, idx + org.length)}}}` + raw.slice(idx + org.length)
  }
  // Fall back: accent the whole title so the cover still gets the
  // brand-green typographic moment.
  return raw ? `{{${raw}}}` : 'Tahi {{proposal}}'
}

/**
 * Two ways to call this viewer:
 *   <ProposalViewer token="..." />              public mode, fetches via token
 *   <ProposalViewer previewProposalId="..." />  admin preview, fetches live data
 *
 * Preview mode disables accept / decline / question, since those require a real
 * public token + token validation on the server. Preview is read-only.
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
  // Question state: non-locking. After submit we show a thank-you banner but
  // keep the accept / decline buttons live so the prospect can still proceed.
  const [questionAcked, setQuestionAcked] = useState(false)

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
    // No token in preview mode: share tracking endpoint requires a token.
    shareToken: isPreview ? null : token,
  })

  // Per-section dwell tracking. Returns a ref setter we attach to each
  // section element. Skipped in preview mode so admin previews don't
  // pollute the production heatmap.
  const observeSection = useSectionDwellTracking({
    resourceType: 'proposal',
    resourceId: isPreview ? null : analyticsResourceId,
    shareToken: isPreview ? null : token,
  })

  async function submitDecision() {
    if (!decisionMode) return
    if (!token) return // Preview mode: accept/decline disabled, buttons are hidden
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
        // Non-locking: show a thank-you banner but keep buttons live so the
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
      <div style={loadingWrap}>
        <div
          className="animate-pulse"
          style={{
            height: '8rem',
            width: '100%',
            maxWidth: '60rem',
            background: 'rgba(255,255,255,0.5)',
            borderRadius: '1rem',
          }}
        />
      </div>
    )
  }

  if (state === 'not_found' || !proposal) {
    return (
      <div style={loadingWrap}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: BRAND.ink, marginTop: '1rem', marginBottom: '0.5rem' }}>
            This proposal isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: BRAND.muted, lineHeight: 1.5 }}>
            The link may have been revoked or copied incorrectly. Reach out to the sender if you were
            expecting to see a proposal.
          </p>
        </div>
      </div>
    )
  }

  const activeVariant = variants.find(v => v.id === activeVariantId) ?? variants[0] ?? null
  const decidedVariant = proposal.decidedVariantId
    ? variants.find(v => v.id === proposal.decidedVariantId)
    : null

  // Cover metadata cells, in the PDF order.
  const metadata: MetadataCell[] = []
  if (proposal.preparedFor) metadata.push({ label: 'Prepared for', value: proposal.preparedFor })
  if (proposal.preparedBy) metadata.push({ label: 'Prepared by', value: proposal.preparedBy })
  if (proposal.effectiveDate) metadata.push({ label: 'Effective', value: formatDate(proposal.effectiveDate) ?? proposal.effectiveDate })
  if (proposal.expiresAt) metadata.push({ label: 'Valid until', value: formatDate(proposal.expiresAt) ?? proposal.expiresAt })

  // Project label for page-chrome footers.
  const projectLabel = proposal.orgName
    ? `${proposal.orgName} × Tahi Studio · proposal`
    : 'Tahi Studio · proposal'

  // Cover eyebrow falls back to a sensible default if subtitle is empty.
  const coverEyebrow = proposal.subtitle ?? 'PROPOSAL'
  const coverTitle = composeCoverTitle(proposal)

  // Section numbering. Cover is unnumbered (matches the PDF reference);
  // data-driven sections start at 01. The cursor advances inline as each
  // page is rendered so the variants page and post-accept timeline keep
  // a continuous run of numbers regardless of how many sections precede them.
  let pageCursor = 0

  return (
    <div style={pageWrap}>
      {/* Preview-mode pill: visible to admins viewing the live state.
          Identical pattern + dimensions to the schedule viewer so the
          two surfaces feel like one product. */}
      {isPreview && (
        <div
          style={{
            position: 'fixed',
            top: '0.75rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 50,
            maxWidth: 'calc(100vw - 1rem)',
            padding: '0.4375rem 0.875rem',
            background: BRAND.ink,
            color: BRAND.surface,
            borderRadius: '999px',
            fontSize: 'clamp(0.625rem, 2.5vw, 0.75rem)',
            fontWeight: 600,
            letterSpacing: '0.04em',
            boxShadow: '0 8px 24px rgba(31, 44, 26, 0.25)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4375rem',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          <span style={{ width: '0.4375rem', height: '0.4375rem', borderRadius: '50%', background: '#93c98a', flexShrink: 0 }} />
          Admin preview, live unpublished state
        </div>
      )}

      {/* Already-decided banner: anchored just under any preview pill so
          a returning prospect always sees the result of their decision. */}
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

      {/* Cover page */}
      <div ref={el => observeSection(el, 'cover')}>
        <CoverPage
          eyebrow={coverEyebrow}
          title={coverTitle}
          metadata={metadata}
          projectLabel={projectLabel}
        />
      </div>

      {/* Data-driven sections. Each one renders through the section
          dispatcher; PageChrome supplies the leaf top-left, page number
          top-right and project-label footer per the deliverable system.
          themeMode picks the surface treatment per section — light (default),
          dark (inverted), or feature (cover-grade glassy gradient). */}
      {sections.map((section, i) => {
        pageCursor += 1
        const num = String(pageCursor).padStart(2, '0')
        const name = (section.subtitle ?? section.title ?? defaultSectionName(section.type)).toUpperCase()
        const theme = normaliseTheme(section.themeMode)
        // i used only for stable React key in case position ties.
        return (
          <div key={`${section.id}-${i}`} ref={el => observeSection(el, section.id)}>
            <PageChrome
              sectionNumber={num}
              sectionName={name}
              projectLabel={projectLabel}
              theme={theme}
            >
              <ProposalSectionBlock section={section} />
            </PageChrome>
          </div>
        )
      })}

      {/* Variants picker + active variant detail. Wrapped in PageChrome so
          it sits inside the same paginated rhythm; the variants UI itself
          (tabs, pricing card, CTAs) is unchanged from the previous slide. */}
      {variants.length > 0 && (() => {
        pageCursor += 1
        const num = String(pageCursor).padStart(2, '0')
        return (
          <div ref={el => observeSection(el, 'variants')}>
            <PageChrome
              sectionNumber={num}
              sectionName={variants.length === 1 ? 'YOUR PACKAGE' : 'CHOOSE YOUR PACKAGE'}
              projectLabel={projectLabel}
            >
              <VariantsSection
                variants={variants}
                activeVariantId={activeVariantId}
                activeVariant={activeVariant}
                onSelect={setActiveVariantId}
                onDecision={kind => setDecisionMode({
                  kind,
                  variantId: kind === 'declined' ? null : (activeVariant?.id ?? null),
                })}
                submitted={submitted}
                isPreview={isPreview}
                questionAcked={questionAcked}
              />
            </PageChrome>
          </div>
        )
      })()}

      {/* Post-accept timeline, only shown once the proposal has been
          accepted. Sits as the closing page so the prospect lands on a
          "what happens next" beat after confirming. */}
      {submitted === 'accepted' && (() => {
        pageCursor += 1
        const num = String(pageCursor).padStart(2, '0')
        return (
          <div ref={el => observeSection(el, 'first-48-hours')}>
            <PageChrome
              sectionNumber={num}
              sectionName="WHAT HAPPENS NEXT"
              projectLabel={projectLabel}
            >
              <PostAcceptTimeline variantName={decidedVariant?.name ?? null} />
            </PageChrome>
          </div>
        )
      })()}

      {/* Closing CTA page, only when the proposal is still open. Mirrors
          the schedule viewer's editorial closing beat. */}
      {!submitted && !isPreview && variants.length === 0 && (
        <PageChrome sectionName="NEXT STEP" projectLabel={projectLabel}>
          <ClosingCta />
        </PageChrome>
      )}

      {/* Footer line under the document, matches the schedule viewer. */}
      <footer style={footer}>
        <BrandMark size="sm" layout="icon-only" />
        <span style={{ fontSize: '0.6875rem', color: BRAND.subtle }}>
          Tahi Studio · prepared {formatDate(proposal.effectiveDate) ?? 'this period'}
          {proposal.expiresAt ? ` · valid until ${formatDate(proposal.expiresAt)}` : ''}
        </span>
      </footer>

      {/* Decision modal. Identical contract to the previous build, only
          the styling tokens have shifted to BRAND.* so the modal sits in
          the same visual language as the rest of the deliverable. */}
      {decisionMode && (
        <div style={modalBackdrop} role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) setDecisionMode(null) }}>
          <div style={modalShell}>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 800, color: BRAND.ink, margin: 0, marginBottom: '0.375rem' }}>
              {decisionMode.kind === 'accepted'
                ? `Accept ${variants.find(v => v.id === decisionMode.variantId)?.name ?? 'package'}`
                : decisionMode.kind === 'declined'
                  ? 'Decline this proposal'
                  : 'Ask a question or request a tweak'}
            </h3>
            <p style={{ fontSize: '0.8125rem', color: BRAND.muted, margin: 0, marginBottom: '1.25rem' }}>
              {decisionMode.kind === 'accepted'
                ? 'Confirm your name + email so we have a record. We\'ll be in touch within one business day to start the engagement.'
                : decisionMode.kind === 'declined'
                  ? 'Help us improve future proposals by sharing what didn\'t fit. Optional but appreciated.'
                  : 'Tell us what you\'d like to know or what you\'d like to change. Liam replies within one business day. The proposal stays open. No commitment.'}
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
                    ? "e.g. Can the Premium variant include CRO from month one? What if we ship in two phases instead of three?"
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
                  ? 'Submitting...'
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

function defaultSectionName(type: string): string {
  switch (type) {
    case 'overview':           return 'Overview'
    case 'about':              return 'About Tahi'
    case 'terms':              return 'Terms'
    case 'scope_shared':       return 'Shared scope'
    case 'text':               return 'Notes'
    case 'testimonial':        return 'Testimonial'
    case 'value_anchor':       return 'The math'
    case 'process':            return 'How we work'
    case 'differentiators':    return 'Why Tahi'
    case 'case_study':         return 'Case studies'
    case 'testimonial_stack':  return 'In their words'
    case 'faq':                return 'FAQ'
    case 'guarantee':          return 'Our guarantee'
    case 'retainer_offer':     return 'After the project'
    case 'founders':           return 'The founders'
    case 'partner_badges':     return 'Credentials'
    default:                   return type
  }
}

// ─── VariantsSection: package picker inside PageChrome ───────────────────

/**
 * Same pricing / variants logic as the legacy slide but flattened so it
 * fits naturally inside a <PageChrome> page rather than its own 100svh
 * slide. The tab strip, scope checklist, pricing card and CTAs are
 * unchanged.
 */
function VariantsSection({
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
    <div>
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

      <header style={{ marginBottom: '1.5rem' }}>
        <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: BRAND.subtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.625rem' }}>
          {variants.length === 1 ? 'Your package' : 'Choose your package'}
        </div>
        <AccentTitle
          text={
            variants.length === 1
              ? `What you're {{investing}} in.`
              : `Pick the one that {{fits}}.`
          }
          size="md"
          as="h2"
        />
        {variants.length > 1 && (
          <p style={{ marginTop: '1rem', fontSize: '0.9375rem', lineHeight: 1.6, color: BRAND.body, maxWidth: '36rem' }}>
            {variants.length} options. Same team, same approach, different scope and investment.
          </p>
        )}
      </header>

      {/* Tab strip and compare-table affordance, only when N>1 */}
      {variants.length > 1 && (
        <>
          {featured && (
            <div style={{ marginBottom: '0.5rem' }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.375rem',
                fontSize: '0.625rem',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                color: BRAND.green,
              }}>
                <span style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: BRAND.green }} />
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
                color: BRAND.green,
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

      {/* Active variant content. Keyed so it cross-fades on switch. */}
      {activeVariant && (
        <div
          key={activeVariant.id}
          style={{
            marginTop: '1.75rem',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr)',
            gap: '2rem',
            animation: 'variantFadeIn 320ms cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        >
          {activeVariant.tagline && (
            <p style={{ fontSize: 'clamp(1rem, 1.4vw, 1.125rem)', color: BRAND.muted, margin: 0, lineHeight: 1.55, maxWidth: '36rem' }}>
              {activeVariant.tagline}
            </p>
          )}

          {activeVariant.scopeHtml && (
            <div>
              <h3 style={subSectionHeader}>What&apos;s included</h3>
              <VariantScopeBody html={activeVariant.scopeHtml} />
            </div>
          )}

          <div style={pricingCard}>
            <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: BRAND.green, textTransform: 'uppercase', letterSpacing: '0.16em', marginBottom: '1.5rem' }}>
              Investment
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem 3.5rem', alignItems: 'flex-end' }}>
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
                <span style={{ fontSize: '0.875rem', color: BRAND.muted }}>Pricing to be confirmed.</span>
              )}
            </div>
            {activeVariant.pricingNotesHtml && (
              <div style={{ marginTop: '1.25rem', fontSize: '0.875rem', color: BRAND.muted, lineHeight: 1.55, paddingTop: '1.25rem', borderTop: `1px solid ${BRAND.green100}` }} dangerouslySetInnerHTML={{ __html: activeVariant.pricingNotesHtml }} />
            )}
          </div>

          {activeVariant.timelineScheduleId && (
            <div style={{ fontSize: '0.875rem', color: BRAND.muted }}>
              <strong style={{ color: BRAND.ink }}>Project schedule</strong> attached separately. Ask
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
              <p style={{ fontSize: '0.75rem', color: BRAND.subtle, marginTop: '0.5rem', marginBottom: 0 }}>
                Not sure? Ask anything. We&apos;d rather refine than push.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * VariantTabStrip: pill-shaped tab strip with a sliding indicator.
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
        background: BRAND.band,
        border: `1px solid ${BRAND.borderSubtle}`,
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
            background: BRAND.ink,
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
              minHeight: '2.75rem',
              padding: '0.625rem 1.125rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              background: 'transparent',
              color: isActive ? BRAND.surface : BRAND.ink,
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

// ─── Variant scope body: pulls <li> items into a check-list ──────────────

function VariantScopeBody({ html }: { html: string }) {
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
            <li key={i} style={{ display: 'grid', gridTemplateColumns: '1.25rem 1fr', gap: '0.625rem', alignItems: 'baseline', fontSize: '0.9375rem', color: BRAND.ink, lineHeight: 1.5 }}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={BRAND.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ marginTop: '0.25rem' }}>
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

// ─── Variant compare table: shown when N>=2 variants ─────────────────────

function VariantCompareTable({
  variants, activeVariantId, onSelect,
}: {
  variants: PublicVariant[]
  activeVariantId: string | null
  onSelect: (id: string) => void
}) {
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
    <div style={{ marginTop: '1.25rem', overflowX: 'auto', border: `1px solid ${BRAND.borderSubtle}`, borderRadius: '0.875rem' }}>
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
                    color: isActive ? BRAND.surface : BRAND.ink,
                    background: isActive ? BRAND.ink : BRAND.surface,
                    borderTop: `1px solid ${BRAND.borderSubtle}`,
                    borderBottom: `1px solid ${BRAND.borderSubtle}`,
                    minWidth: '8rem',
                  }}
                >
                  <div style={{ fontWeight: 800 }}>{v.name}</div>
                  <div style={{ fontWeight: 500, fontSize: '0.75rem', color: isActive ? '#a8c89e' : BRAND.muted, marginTop: '0.125rem', fontVariantNumeric: 'tabular-nums' }}>
                    {priceLabel(v)}
                  </div>
                  {v.isFeatured ? (
                    <div style={{ marginTop: '0.375rem', fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: isActive ? '#93c98a' : BRAND.green }}>
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
            <tr key={i} style={{ borderTop: `1px solid ${BRAND.borderSubtle}` }}>
              <td style={compareTd}>{f}</td>
              {variantFeatures.map(vf => {
                const has = vf.features.has(f)
                return (
                  <td key={vf.id} style={{ ...compareTd, textAlign: 'center', borderTop: `1px solid ${BRAND.borderSubtle}` }}>
                    {has ? (
                      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke={BRAND.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    ) : (
                      <span style={{ color: '#c8d4c5', fontSize: '0.875rem' }} aria-label="not included">.</span>
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
  const oneOff = v.oneOffAmount > 0 ? safeFormatMoney(v.oneOffAmount, v.currency) : ''
  const monthly = v.monthlyAmount > 0 ? `${safeFormatMoney(v.monthlyAmount, v.currency)}/mo` : ''
  return [oneOff, monthly].filter(Boolean).join(' + ') || 'TBC'
}

const compareTh: React.CSSProperties = {
  textAlign: 'left',
  padding: '0.875rem 1rem',
  fontSize: '0.75rem',
  fontWeight: 700,
  color: BRAND.ink,
  background: BRAND.surface,
}
const compareTd: React.CSSProperties = {
  padding: '0.625rem 1rem',
  color: BRAND.ink,
  verticalAlign: 'middle',
}

// ─── Closing CTA (used when there are no variants and not yet decided) ──

function ClosingCta() {
  return (
    <div style={{ textAlign: 'center', maxWidth: '36rem', margin: '0 auto', padding: '1rem 0' }}>
      <AccentTitle
        text="Ready to {{move forward}}?"
        size="md"
        as="h2"
        style={{ textAlign: 'center' }}
      />
      <p style={{ marginTop: '1rem', fontSize: '1rem', lineHeight: 1.6, color: BRAND.body }}>
        Reply to the email this proposal came from, or book a call. We typically reply within one business day.
      </p>
    </div>
  )
}

// ─── Post-accept timeline ────────────────────────────────────────────────

function PostAcceptTimeline({ variantName }: { variantName?: string | null }) {
  const steps: { title: string; body: string }[] = [
    { title: 'Right now', body: 'Liam gets the email and your dashboard project is created. We confirm receipt within one business day.' },
    { title: 'This week', body: 'Personal Loom from Liam. A walkthrough of your client portal: how to make requests, what to expect, and the first tasks queued up.' },
    { title: 'During the build', body: 'Discovery items kick off. Tracks move through the dashboard, you see progress live and can request changes anytime.' },
    { title: 'Around delivery', body: 'Two to three weeks before handoff we open the retainer conversation. Your 10% lifetime discount is already earned.' },
  ]
  return (
    <div>
      <header style={{ marginBottom: '1.75rem' }}>
        <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: BRAND.subtle, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.625rem' }}>
          What happens next
        </div>
        <AccentTitle
          text={variantName ? `Welcome aboard, {{${variantName}}}.` : `Welcome {{aboard}}.`}
          size="md"
          as="h2"
        />
        <p style={{ marginTop: '1rem', fontSize: '0.9375rem', color: BRAND.body, maxWidth: '40rem', lineHeight: 1.6 }}>
          You&apos;ve done the hard part. Here&apos;s the next two weeks from your side.
        </p>
      </header>
      <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.625rem' }}>
        {steps.map((s, i) => (
          <li
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '2.5rem 1fr',
              gap: '1rem',
              alignItems: 'flex-start',
              padding: '1rem 1.125rem',
              background: BRAND.surface,
              border: `1px solid ${BRAND.borderSubtle}`,
              borderRadius: '0.75rem',
            }}
          >
            <div
              style={{
                width: '2.5rem',
                height: '2.5rem',
                borderRadius: '0 12px 0 12px',
                background: `linear-gradient(135deg, ${BRAND.greenLight}, ${BRAND.greenDark})`,
                color: BRAND.surface,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '0.875rem',
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {String(i + 1).padStart(2, '0')}
            </div>
            <div>
              <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: BRAND.ink }}>{s.title}</div>
              <div style={{ fontSize: '0.875rem', color: BRAND.muted, marginTop: '0.25rem', lineHeight: 1.55 }}>{s.body}</div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── AnimatedPriceCell: money cell that counts on variant switch ─────────

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
      <div style={{ fontSize: '0.6875rem', fontWeight: 700, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.625rem' }}>
        {label}
      </div>
      <div style={{ fontSize: 'clamp(2.25rem, 5vw, 3.5rem)', fontWeight: 800, color: BRAND.ink, letterSpacing: '-0.025em', lineHeight: 0.98, fontVariantNumeric: 'tabular-nums' }}>
        {safeFormatMoney(Math.round(display), currency)}{suffix && <span style={{ fontSize: '0.5em', fontWeight: 600, color: BRAND.muted, marginLeft: '0.125rem' }}>{suffix}</span>}
      </div>
      <div style={{ fontSize: '0.8125rem', color: BRAND.muted, marginTop: '0.625rem' }}>{sub}</div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: '0.6875rem', fontWeight: 600, color: BRAND.muted, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {label}
      </span>
      {children}
    </label>
  )
}

// ─── Styles ──────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: BRAND.band,
  fontFamily: 'var(--font-manrope, system-ui)',
  color: BRAND.ink,
  padding: 'clamp(1rem, 3vw, 1.5rem) 0',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(1.25rem, 3vw, 2rem)',
}

const subSectionHeader: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: BRAND.green,
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  margin: '0 0 1rem 0',
}

const proseStyle: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: BRAND.ink,
}

/**
 * The pricing card is the cinematic centrepiece of the variants page.
 * Layered radial glow on a soft brand-tinted base, leaf radius, generous
 * breathing room. No flat fill, no top-to-bottom gradient. Depth comes
 * from atmosphere, not gloss.
 */
const pricingCard: React.CSSProperties = {
  position: 'relative',
  padding: 'clamp(1.5rem, 3vw, 2rem)',
  background: [
    'radial-gradient(60% 60% at 80% 0%, rgba(220,239,216,0.55) 0%, transparent 60%)',
    'radial-gradient(80% 60% at 0% 110%, rgba(122,170,114,0.18) 0%, transparent 60%)',
    BRAND.green50,
  ].join(', '),
  border: `1px solid ${BRAND.green100}`,
  borderRadius: '0 20px 0 20px',
  overflow: 'hidden',
}

const primaryBtn: React.CSSProperties = {
  minHeight: '2.75rem',
  padding: '0.75rem 1.5rem',
  fontSize: '0.9375rem',
  fontWeight: 700,
  background: BRAND.green,
  color: BRAND.surface,
  border: 'none',
  borderRadius: '0.5rem',
  cursor: 'pointer',
  letterSpacing: '-0.005em',
}

const secondaryBtn: React.CSSProperties = {
  minHeight: '2.75rem',
  padding: '0.75rem 1.25rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  background: BRAND.surface,
  color: BRAND.ink,
  border: `1px solid ${BRAND.border}`,
  borderRadius: '0.5rem',
  cursor: 'pointer',
}

const tertiaryBtn: React.CSSProperties = {
  minHeight: '2.75rem',
  padding: '0.75rem 1.25rem',
  fontSize: '0.9375rem',
  fontWeight: 600,
  background: BRAND.green50,
  color: BRAND.greenDark,
  border: `1px solid ${BRAND.green100}`,
  borderRadius: '0.5rem',
  cursor: 'pointer',
}

const footer: React.CSSProperties = {
  width: 'calc(100% - clamp(1.5rem, 6vw, 3rem))',
  maxWidth: '76rem',
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: '0.75rem',
  padding: '1rem 1.5rem',
  borderTop: `1px solid ${BRAND.borderSubtle}`,
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  minHeight: '2.75rem',
  padding: '0.625rem 0.75rem',
  fontSize: '0.875rem',
  border: `1px solid ${BRAND.border}`,
  borderRadius: '0.5rem',
  background: BRAND.surface,
  color: BRAND.ink,
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
  background: BRAND.surface,
  borderRadius: '1rem',
  padding: 'clamp(1.25rem, 3vw, 2rem)',
  boxShadow: '0 16px 48px rgba(31, 44, 26, 0.25)',
}

const loadingWrap: React.CSSProperties = {
  minHeight: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: BRAND.band,
  padding: '2rem',
}

function decidedBanner(kind: 'accepted' | 'declined'): React.CSSProperties {
  return {
    width: 'calc(100% - clamp(1.5rem, 6vw, 3rem))',
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
