/**
 * <ContractViewer> — public viewer for a Tahi contract document.
 *
 * Two modes:
 *  - 'read'   : public token, no signerId. Shows contract + signed-status,
 *                no sign UI. Used at /p/contract/[token].
 *  - 'sign'   : public token + signerId. Same content but with a signature
 *                canvas pad bound to the specified signer. After signing,
 *                flips to a thank-you state.
 *
 * Brand language matches the proposal viewer:
 *   - brand-glass cover with a partial brand-green ring backdrop, not
 *     a flat radial gradient
 *   - leaf radius on the cover, the signer cards, the signature pad,
 *     the assurance block, the primary CTA
 *   - one brand-green accent word per heading
 *   - useInView fade-and-lift on each section as the page scrolls
 *
 * The contract bodyHtml is rendered via dangerouslySetInnerHTML — admin-
 * authored content with variable substitution already escaped on the
 * server. The signature pad mechanics + hash chain are unchanged.
 */
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useShareViewTracking } from '@/components/tahi/use-share-view-tracking'

// ─── Brand tokens — kept local so we never drift from the design system ───

const BRAND = {
  green: '#5A824E',
  greenDark: '#425F39',
  greenLight: '#7aab6b',
  green50: '#f0f7ee',
  green100: '#dcefd8',
  ink: '#121A0F',
  inkDeep: '#1f2c1a',
  textMuted: '#5a6657',
  textSubtle: '#8a9987',
  border: '#d4e0d0',
  borderSubtle: '#e8f0e6',
  surface: '#ffffff',
  surfaceTint: '#fdfefd',
  page: '#f5f7f5',
  warning: '#fb923c',
  warningBg: '#fff7ed',
  warningBorder: '#fed7aa',
  success: '#16a34a',
  successDeep: '#166534',
  successBg: '#f0fdf4',
  successBorder: '#bbf7d0',
  danger: '#991b1b',
  dangerBg: '#fef2f2',
  dangerBorder: '#fecaca',
  info: '#1e40af',
  infoBg: '#eff6ff',
  infoBorder: '#bfdbfe',
} as const

const LEAF       = '0 16px 0 16px'
const LEAF_SM    = '0 10px 0 10px'
const LEAF_LG    = '0 24px 0 24px'

// ─── useInView — fade + lift on scroll, with reduced-motion respect ───────

/**
 * Mirrors the proposal viewer behaviour so the two surfaces feel like
 * siblings. Falls back to immediately-visible on any environment that
 * doesn't support IntersectionObserver or where reduced-motion is set.
 */
function useInView<T extends HTMLElement>(opts?: {
  rootMargin?: string
  threshold?: number
}): [React.RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const node = ref.current
    if (!node) return
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) {
      setInView(true)
      return
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    if (reduced) {
      setInView(true)
      return
    }
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true)
          io.disconnect()
          break
        }
      }
    }, { rootMargin: opts?.rootMargin ?? '0px 0px -8% 0px', threshold: opts?.threshold ?? 0.05 })
    io.observe(node)
    return () => io.disconnect()
  }, [opts?.rootMargin, opts?.threshold])
  return [ref, inView]
}

function FadeSection({ children, style, delay = 0 }: {
  children: React.ReactNode
  style?: React.CSSProperties
  delay?: number
}) {
  const [ref, visible] = useInView<HTMLElement>()
  return (
    <section
      ref={ref}
      style={{
        ...style,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(0.625rem)',
        transition: `opacity 480ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms, transform 480ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms`,
      }}
    >
      {children}
    </section>
  )
}

// ─── Types ────────────────────────────────────────────────────────────────

interface PublicContract {
  id: string
  type: string
  name: string
  status: 'draft' | 'sent' | 'partially_signed' | 'signed' | 'expired' | 'cancelled'
  bodyHtml: string
  sentAt: string | null
  signedAt: string | null
  expiresAt: string | null
}
interface PublicSigner {
  id: string
  role: string
  name: string
  email: string
  position: number
  status: 'pending' | 'signed' | 'skipped'
  signedAt: string | null
}
interface PublicSignature {
  id: string
  signerId: string
  signatureDataUrl: string
  signedAt: string
}

type Mode = 'read' | 'sign'

// ─── Main ────────────────────────────────────────────────────────────────

export function ContractViewer({
  token,
  mode,
  signerId,
  previewContractId,
}: {
  token?: string
  mode: Mode
  signerId?: string
  /** Admin-only preview mode: load live state from the admin endpoint
   *  instead of the public token endpoint. Sign UI is disabled. */
  previewContractId?: string
}) {
  const isPreview = !!previewContractId
  const [contract, setContract] = useState<PublicContract | null>(null)
  const [signers, setSigners] = useState<PublicSigner[]>([])
  const [signatures, setSignatures] = useState<PublicSignature[]>([])
  const [state, setState] = useState<'loading' | 'ok' | 'not_found'>('loading')
  const [submitting, setSubmitting] = useState(false)
  const [justSigned, setJustSigned] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The boilerplate "things you should know" footnote can be heavy. Hidden
  // by default; user toggles to expand. Most signers do not need to see it
  // every visit.
  const [showFinePrint, setShowFinePrint] = useState(false)

  const reload = useCallback(async () => {
    try {
      const url = isPreview
        ? apiPath(`/api/admin/contracts/${encodeURIComponent(previewContractId!)}/preview-data`)
        : apiPath(`/api/public/contracts/${encodeURIComponent(token!)}`)
      const res = await fetch(url)
      if (!res.ok) {
        setState('not_found')
        return
      }
      const data = await res.json() as {
        contract: PublicContract
        signers: PublicSigner[]
        signatures: PublicSignature[]
      }
      setContract(data.contract)
      setSigners(data.signers ?? [])
      setSignatures(data.signatures ?? [])
      setState('ok')
    } catch {
      setState('not_found')
    }
  }, [token, previewContractId, isPreview])

  useEffect(() => { void reload() }, [reload])

  useShareViewTracking({
    resourceType: 'contract',
    resourceId: contract?.id ?? null,
    // No token in preview - share-view tracking endpoint requires one.
    shareToken: isPreview ? null : token,
  })

  const activeSigner = mode === 'sign' && signerId
    ? signers.find(s => s.id === signerId)
    : undefined

  async function submitSignature(dataUrl: string) {
    if (!signerId || !contract) return
    if (!token) return // preview mode - sign disabled
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(
        apiPath(`/api/public/contracts/${encodeURIComponent(token)}/sign/${encodeURIComponent(signerId)}`),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ signatureDataUrl: dataUrl }),
        },
      )
      if (!res.ok) {
        const errData = await res.json().catch(() => ({})) as { error?: string }
        setError(errData.error ?? 'Could not record signature. Please try again.')
        return
      }
      setJustSigned(true)
      void reload()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  if (state === 'loading') {
    return (
      <div style={pageWrap}>
        <div
          className="animate-pulse"
          style={{ width: '100%', maxWidth: '60rem', height: '20rem', background: 'rgba(255,255,255,0.55)', borderRadius: LEAF_LG, margin: '0 auto' }}
        />
      </div>
    )
  }

  if (state === 'not_found' || !contract) {
    return (
      <div style={{ ...pageWrap, alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: BRAND.inkDeep, marginTop: '1rem', marginBottom: '0.5rem' }}>
            This contract isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: BRAND.textMuted, lineHeight: 1.55 }}>
            The link may have been revoked or copied incorrectly. Reach out to the sender if
            you were expecting to see a contract to sign.
          </p>
        </div>
      </div>
    )
  }

  const allSigned = contract.status === 'signed'
  const signersByPosition = [...signers].sort((a, b) => a.position - b.position)
  const signedCount = signers.filter(s => s.status === 'signed').length

  // Sign-mode guard rails: invalid signer, already signed, etc.
  let signGuardMessage: string | null = null
  if (mode === 'sign') {
    if (!activeSigner) signGuardMessage = 'This sign link is invalid. Ask the sender for a fresh link.'
    else if (activeSigner.status === 'signed') signGuardMessage = `${activeSigner.name}, you have already signed this contract. Thank you.`
    else if (activeSigner.status === 'skipped') signGuardMessage = 'This signer was removed from the contract.'
    else if (allSigned) signGuardMessage = 'This contract is already fully signed.'
  }

  // After-sign confirmation: user just signed in this session, OR the
  // contract is fully signed and we are in read mode and want to celebrate
  // the moment.
  const showSignedHero = justSigned || (mode === 'read' && allSigned)

  return (
    <div style={pageWrap}>
      {/* Preview-mode pill */}
      {isPreview && <PreviewPill />}

      {/* ── Slide 1 : Cover ── */}
      <CoverSlide
        contract={contract}
        signedCount={signedCount}
        totalSigners={signers.length}
      />

      {/* Just-signed hero. Sits above the body so it's the first thing
          the signer sees on the redirect after submitting. */}
      {showSignedHero && (
        <FadeSection style={{ width: '100%', maxWidth: '64rem', margin: '0 auto' }}>
          <SignedHero
            contract={contract}
            justSigned={justSigned}
            activeSignerName={activeSigner?.name ?? null}
            allSigned={allSigned}
          />
        </FadeSection>
      )}

      {/* ── Slide 2 : The agreement body ── */}
      <FadeSection style={slideShell} delay={40}>
        <div style={slideEyebrow}>The agreement</div>
        <h2 style={slideTitle}>
          What you are <span style={{ color: BRAND.green }}>signing</span>
        </h2>
        <p style={slideSub}>
          Read in full below. The full document remains on this page and is bound to your
          signature once you submit.
        </p>
        <div style={proseFrame}>
          <div style={prose} dangerouslySetInnerHTML={{ __html: contract.bodyHtml }} />
        </div>
      </FadeSection>

      {/* ── Slide 3 : Signers grid ── */}
      <FadeSection style={slideShell} delay={80}>
        <div style={slideEyebrow}>Signatories</div>
        <h2 style={slideTitle}>
          Who <span style={{ color: BRAND.green }}>signs</span> this
        </h2>
        <p style={slideSub}>
          {signedCount === signers.length
            ? 'All signatures have been recorded.'
            : `${signedCount} of ${signers.length} signed so far.`}
        </p>
        <div style={signerGrid}>
          {signersByPosition.map(s => {
            const sig = signatures.find(x => x.signerId === s.id)
            const isYou = mode === 'sign' && s.id === signerId
            return (
              <SignerCard
                key={s.id}
                signer={s}
                signature={sig ?? null}
                isYou={isYou}
              />
            )
          })}
        </div>
      </FadeSection>

      {/* ── Slide 4 : Sign UI (sign mode only, when allowed) ── */}
      {mode === 'sign' && (
        <FadeSection style={slideShell} delay={120}>
          {signGuardMessage ? (
            <StatusBanner kind={allSigned ? 'success' : 'info'}>{signGuardMessage}</StatusBanner>
          ) : justSigned ? null /* the SignedHero above already covers this */ : activeSigner ? (
            <SignaturePad
              signerName={activeSigner.name}
              submitting={submitting}
              onSubmit={submitSignature}
              error={error}
            />
          ) : null}
        </FadeSection>
      )}

      {/* Fine-print toggle. Sits inside the same surface tone as the rest
          of the deck and only expands when asked. */}
      <FadeSection style={{ width: '100%', maxWidth: '64rem', margin: '0 auto' }} delay={140}>
        <FinePrintBlock open={showFinePrint} onToggle={() => setShowFinePrint(o => !o)} />
      </FadeSection>

      <footer style={footer}>
        <BrandMark size="sm" />
        <span style={footerNote}>
          Tamper-evident · each signature is anchored to a SHA-256 hash chain. Confidential
          to the named recipient.
        </span>
      </footer>
    </div>
  )
}

// ─── Cover slide ─────────────────────────────────────────────────────────

function CoverSlide({
  contract, signedCount, totalSigners,
}: {
  contract: PublicContract
  signedCount: number
  totalSigners: number
}) {
  return (
    <section style={coverShell}>
      {/* Layered radial glows + brand circle ring : matches the proposal
          cover so the two surfaces feel like a single design language. */}
      <div style={coverBackdrop} aria-hidden="true" />
      <div style={coverRing} aria-hidden="true" />
      <div style={coverInner}>
        <BrandMark dark />
        <div style={{ marginTop: '2rem' }}>
          <div style={coverEyebrow}>{labelForType(contract.type)}</div>
          <h1 style={coverTitle}>{contract.name}</h1>
        </div>
        <div style={{ marginTop: 'auto' }}>
          <div style={coverChips}>
            <CoverChip label={statusLabel(contract.status)} kind={statusChipKind(contract.status)} />
            <CoverChip label={`${signedCount} of ${totalSigners} signed`} kind="neutral" />
          </div>
          <div style={coverMetaGrid}>
            {contract.sentAt && <CoverMeta label="Sent" value={formatDate(contract.sentAt)} />}
            {contract.signedAt && <CoverMeta label="Fully signed" value={formatDate(contract.signedAt)} />}
            {contract.expiresAt && <CoverMeta label="Expires" value={formatDate(contract.expiresAt)} />}
          </div>
        </div>
      </div>
    </section>
  )
}

function CoverMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={coverMetaCell}>
      <div style={coverMetaLabel}>{label}</div>
      <div style={coverMetaValue}>{value}</div>
    </div>
  )
}

function CoverChip({ label, kind }: { label: string; kind: 'success' | 'warning' | 'neutral' | 'info' }) {
  const palette = (
    kind === 'success' ? { bg: 'rgba(187, 247, 208, 0.22)', color: '#dcefd8', border: 'rgba(187, 247, 208, 0.45)' } :
    kind === 'warning' ? { bg: 'rgba(254, 215, 170, 0.18)', color: '#ffe4ca', border: 'rgba(254, 215, 170, 0.4)' } :
    kind === 'info'    ? { bg: 'rgba(191, 219, 254, 0.16)', color: '#dbeafe', border: 'rgba(191, 219, 254, 0.36)' } :
                         { bg: 'rgba(255, 255, 255, 0.12)', color: '#FFFFFF',  border: 'rgba(255, 255, 255, 0.22)' }
  )
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '0.3125rem 0.75rem',
      fontSize: '0.75rem',
      fontWeight: 700,
      letterSpacing: '0.04em',
      textTransform: 'uppercase',
      borderRadius: '999px',
      background: palette.bg,
      color: palette.color,
      border: `1px solid ${palette.border}`,
      backdropFilter: 'blur(8px)',
    }}>
      {label}
    </span>
  )
}

function statusChipKind(s: PublicContract['status']): 'success' | 'warning' | 'neutral' | 'info' {
  if (s === 'signed') return 'success'
  if (s === 'partially_signed') return 'info'
  if (s === 'expired' || s === 'cancelled') return 'warning'
  return 'neutral'
}

// ─── Signer card ────────────────────────────────────────────────────────

function SignerCard({
  signer, signature, isYou,
}: {
  signer: PublicSigner
  signature: PublicSignature | null
  isYou: boolean
}) {
  const initials = initialsFromName(signer.name)
  const cardBg = isYou ? BRAND.green50 : BRAND.surfaceTint
  const borderColour = isYou ? BRAND.green : BRAND.border
  return (
    <div
      style={{
        position: 'relative',
        background: cardBg,
        border: `1px solid ${borderColour}`,
        borderRadius: LEAF,
        padding: '1.25rem 1.25rem 1rem',
        boxShadow: isYou
          ? '0 8px 24px rgba(90, 130, 78, 0.16), 0 1px 0 rgba(255, 255, 255, 0.6) inset'
          : '0 1px 2px rgba(31, 44, 26, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.875rem',
        minHeight: '13rem',
        transition: 'transform 200ms ease, box-shadow 200ms ease',
      }}
    >
      {/* Top: avatar + identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
        <div
          aria-hidden="true"
          style={{
            width: '2.75rem',
            height: '2.75rem',
            borderRadius: LEAF_SM,
            background: `linear-gradient(135deg, ${BRAND.greenLight} 0%, ${BRAND.greenDark} 100%)`,
            color: '#FFFFFF',
            fontSize: '0.875rem',
            fontWeight: 800,
            letterSpacing: '0.02em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(31, 44, 26, 0.16)',
          }}
        >
          {initials}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.9375rem', fontWeight: 700, color: BRAND.inkDeep, lineHeight: 1.25, overflowWrap: 'break-word' }}>
            {signer.name}
          </div>
          <div style={{ fontSize: '0.75rem', color: BRAND.textSubtle, marginTop: '0.125rem', overflowWrap: 'anywhere' }}>
            {signer.email}
          </div>
        </div>
      </div>

      {/* Pills row */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
        <RolePill role={signer.role} />
        <StatusPill status={signer.status} />
        {isYou && <YouPill />}
      </div>

      {/* Footer : signed-on timestamp or awaiting */}
      <div style={{ marginTop: 'auto', paddingTop: '0.625rem', borderTop: `1px dashed ${BRAND.borderSubtle}`, fontSize: '0.75rem', color: BRAND.textMuted }}>
        {signature ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <span style={{ color: BRAND.greenDark, fontWeight: 700 }}>Signed</span>
            <span>on {formatDate(signature.signedAt)}</span>
          </div>
        ) : (
          <span>Awaiting signature</span>
        )}
      </div>

      {/* Signature preview, when present */}
      {signature && (
        <div style={{ marginTop: '-0.5rem' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={signature.signatureDataUrl}
            alt={`${signer.name} signature`}
            style={{ maxWidth: '100%', maxHeight: '4rem', filter: 'contrast(1.1)', display: 'block' }}
          />
        </div>
      )}
    </div>
  )
}

function RolePill({ role }: { role: string }) {
  return (
    <span style={pillBase('neutral')}>{labelForRole(role)}</span>
  )
}

function StatusPill({ status }: { status: PublicSigner['status'] }) {
  const kind: 'success' | 'warning' | 'neutral' = status === 'signed' ? 'success' : status === 'skipped' ? 'neutral' : 'warning'
  return (
    <span style={pillBase(kind)}>
      <span style={{
        width: '0.4375rem',
        height: '0.4375rem',
        borderRadius: '50%',
        background: kind === 'success' ? BRAND.green : kind === 'neutral' ? BRAND.textSubtle : BRAND.warning,
        marginRight: '0.4375rem',
      }} />
      {statusForSigner(status)}
    </span>
  )
}

function YouPill() {
  return (
    <span style={{
      ...pillBase('brand'),
      background: BRAND.greenDark,
      color: '#FFFFFF',
      border: `1px solid ${BRAND.greenDark}`,
    }}>That is you</span>
  )
}

function pillBase(kind: 'success' | 'warning' | 'neutral' | 'brand'): React.CSSProperties {
  const palette = (
    kind === 'success' ? { bg: BRAND.successBg, color: BRAND.successDeep, border: BRAND.successBorder } :
    kind === 'warning' ? { bg: BRAND.warningBg, color: '#9a3412',         border: BRAND.warningBorder } :
    kind === 'brand'   ? { bg: BRAND.green50,   color: BRAND.greenDark,   border: BRAND.green100 } :
                         { bg: '#f3f5f3',       color: BRAND.textMuted,   border: BRAND.border }
  )
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0.1875rem 0.5625rem',
    fontSize: '0.6875rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    borderRadius: '999px',
    background: palette.bg,
    color: palette.color,
    border: `1px solid ${palette.border}`,
    whiteSpace: 'nowrap',
  }
}

// ─── Signed hero (post-sign confirmation) ───────────────────────────────

function SignedHero({
  contract, justSigned, activeSignerName, allSigned,
}: {
  contract: PublicContract
  justSigned: boolean
  activeSignerName: string | null
  allSigned: boolean
}) {
  const headline = justSigned
    ? (allSigned ? 'Fully signed' : 'Your signature is in')
    : 'Fully signed'
  const subline = justSigned
    ? (allSigned
        ? `Thank you${activeSignerName ? `, ${activeSignerName.split(' ')[0]}` : ''}. The contract is now fully executed.`
        : `Thank you${activeSignerName ? `, ${activeSignerName.split(' ')[0]}` : ''}. The other parties will be notified.`)
    : 'Every signatory has signed. The contract is fully executed.'
  const dateString = formatDate(contract.signedAt) || formatDate(new Date().toISOString())

  return (
    <div style={signedHeroShell}>
      <div style={signedHeroBackdrop} aria-hidden="true" />
      <div style={{ position: 'relative', zIndex: 1 }}>
        <div style={signedHeroCheck}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#FFFFFF" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div style={{ ...slideEyebrow, color: BRAND.greenDark, marginBottom: '0.625rem' }}>
          {allSigned ? 'Contract executed' : 'Signature recorded'}
        </div>
        <h2 style={{ ...slideTitle, color: BRAND.inkDeep }}>
          <span>{headline.split(' ').slice(0, -1).join(' ')} </span>
          <span style={{ color: BRAND.green }}>{headline.split(' ').slice(-1)[0]}</span>
        </h2>
        <p style={{ ...slideSub, marginTop: '0.625rem' }}>{subline}</p>

        {/* Assurance / hash-chain proof block. We do not surface the literal
            hash here (it is server-side), but we do show the assurance in
            the same monospace block style so it reads like part of the
            audit trail. */}
        <div style={assuranceBlock}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.625rem' }}>
            <ShieldIcon />
            <span style={{ fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.12em', color: BRAND.greenDark, textTransform: 'uppercase' }}>
              Audit trail
            </span>
          </div>
          <dl style={assuranceList}>
            <AssuranceRow label="Signed on" value={dateString} mono />
            <AssuranceRow label="Hash algorithm" value="SHA-256 chain" mono />
            <AssuranceRow label="IP address" value="Stored as one-way hash" mono />
            <AssuranceRow label="Document fingerprint" value="Locked at signature" mono />
          </dl>
          <div style={{ fontSize: '0.75rem', color: BRAND.textMuted, marginTop: '0.875rem', lineHeight: 1.55 }}>
            Each signature is anchored to a SHA-256 hash chain so no signature can be added,
            removed, or altered after the fact without breaking the chain. A tamper-evident
            record is retained on the Tahi servers for compliance.
          </div>
        </div>
      </div>
    </div>
  )
}

function AssuranceRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'minmax(8rem, 12rem) 1fr',
      gap: '0.875rem',
      alignItems: 'baseline',
      padding: '0.5rem 0',
      borderTop: `1px dashed ${BRAND.borderSubtle}`,
    }}>
      <dt style={{ fontSize: '0.6875rem', color: BRAND.textSubtle, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</dt>
      <dd style={{
        fontSize: '0.8125rem',
        color: BRAND.ink,
        fontWeight: 600,
        margin: 0,
        ...(mono ? { fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace', letterSpacing: '0.02em' } : {}),
      }}>
        {value}
      </dd>
    </div>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke={BRAND.greenDark} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  )
}

// ─── Signature pad ─────────────────────────────────────────────────────────

function SignaturePad({
  signerName,
  submitting,
  onSubmit,
  error,
}: {
  signerName: string
  submitting: boolean
  onSubmit: (dataUrl: string) => void
  error: string | null
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawingRef = useRef(false)
  const lastPoint = useRef<{ x: number; y: number } | null>(null)
  const [hasInk, setHasInk] = useState(false)
  const [agree, setAgree] = useState(false)

  // Set up canvas with high-DPI scaling.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const dpr = window.devicePixelRatio || 1
    const rect = canvas.getBoundingClientRect()
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.lineWidth = 2.4
    ctx.strokeStyle = BRAND.inkDeep
  }, [])

  function pointerPos(e: PointerEvent | React.PointerEvent): { x: number; y: number } | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const rect = canvas.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  function onPointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    e.preventDefault()
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.setPointerCapture(e.pointerId)
    drawingRef.current = true
    const p = pointerPos(e)
    if (!p) return
    lastPoint.current = p
  }

  function onPointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = pointerPos(e)
    if (!p || !lastPoint.current) return
    ctx.beginPath()
    ctx.moveTo(lastPoint.current.x, lastPoint.current.y)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
    lastPoint.current = p
    if (!hasInk) setHasInk(true)
  }

  function onPointerUp(e: React.PointerEvent<HTMLCanvasElement>) {
    drawingRef.current = false
    lastPoint.current = null
    canvasRef.current?.releasePointerCapture(e.pointerId)
  }

  function clear() {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    setHasInk(false)
  }

  function submit() {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!hasInk || !agree) return
    const dataUrl = canvas.toDataURL('image/png')
    onSubmit(dataUrl)
  }

  const firstName = signerName.split(' ')[0] ?? signerName

  return (
    <div>
      <div style={slideEyebrow}>Sign here</div>
      <h2 style={slideTitle}>
        {firstName}, draw your <span style={{ color: BRAND.green }}>signature</span>
      </h2>
      <p style={slideSub}>
        Use a finger on touch screens, or click and drag with a mouse. Your signature is bound
        to the contract via a tamper-evident hash chain.
      </p>

      <div style={padFrame}>
        <div style={padShell}>
          <canvas
            ref={canvasRef}
            style={padCanvas}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          />
          <div style={padBaseline} aria-hidden="true" />
          <div style={padBaselineLabel} aria-hidden="true">x · sign above</div>
        </div>

        <div style={padControls}>
          <label style={agreeLabel}>
            <input
              type="checkbox"
              checked={agree}
              onChange={e => setAgree(e.target.checked)}
              style={{ width: '1.125rem', height: '1.125rem', marginRight: '0.625rem', accentColor: BRAND.green, flexShrink: 0 }}
            />
            <span>I am <strong style={{ color: BRAND.inkDeep }}>{signerName}</strong> and I intend to sign this contract.</span>
          </label>

          <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
            <button type="button" onClick={clear} style={btnGhost}>
              Clear
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || !hasInk || !agree}
              style={{
                ...btnPrimary,
                opacity: (!hasInk || !agree) ? 0.55 : 1,
                cursor: (submitting || !hasInk || !agree) ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (submitting || !hasInk || !agree) return
                e.currentTarget.style.transform = 'translateY(-1px)'
                e.currentTarget.style.boxShadow = '0 10px 24px rgba(90, 130, 78, 0.32)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateY(0)'
                e.currentTarget.style.boxShadow = '0 6px 18px rgba(90, 130, 78, 0.25)'
              }}
            >
              {submitting ? 'Recording…' : 'Sign and submit'}
            </button>
          </div>
        </div>
      </div>

      {error && (
        <StatusBanner kind="danger" style={{ marginTop: '1rem' }}>{error}</StatusBanner>
      )}
    </div>
  )
}

// ─── Status banner ─────────────────────────────────────────────────────────

function StatusBanner({
  kind, children, style,
}: {
  kind: 'success' | 'info' | 'warning' | 'danger'
  children: React.ReactNode
  style?: React.CSSProperties
}) {
  const palette = (
    kind === 'success' ? { bg: BRAND.successBg, color: BRAND.successDeep, border: BRAND.successBorder } :
    kind === 'warning' ? { bg: BRAND.warningBg, color: '#9a3412',         border: BRAND.warningBorder } :
    kind === 'danger'  ? { bg: BRAND.dangerBg,  color: BRAND.danger,      border: BRAND.dangerBorder } :
                         { bg: BRAND.infoBg,    color: BRAND.info,        border: BRAND.infoBorder }
  )
  return (
    <div style={{
      width: '100%',
      maxWidth: '64rem',
      margin: '0 auto',
      padding: '0.875rem 1.125rem',
      borderRadius: LEAF_SM,
      fontSize: '0.875rem',
      fontWeight: 600,
      lineHeight: 1.5,
      background: palette.bg,
      color: palette.color,
      border: `1px solid ${palette.border}`,
      ...style,
    }}>
      {children}
    </div>
  )
}

// ─── Fine print toggle ─────────────────────────────────────────────────

function FinePrintBlock({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <div style={{
      width: '100%',
      maxWidth: '64rem',
      margin: '0 auto',
      background: BRAND.surface,
      border: `1px solid ${BRAND.borderSubtle}`,
      borderRadius: LEAF_SM,
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        style={{
          width: '100%',
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          padding: '0.875rem 1.125rem',
          fontSize: '0.8125rem',
          fontWeight: 600,
          color: BRAND.textMuted,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.75rem',
        }}
      >
        <span>{open ? 'Hide' : 'Read'} the fine print</span>
        <span style={{ fontSize: '0.75rem', color: BRAND.textSubtle, fontWeight: 500 }}>
          {open ? 'Tap to collapse' : 'A few things you should know'}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 1.125rem 1.125rem', fontSize: '0.8125rem', color: BRAND.textMuted, lineHeight: 1.65 }}>
          <p style={{ margin: '0 0 0.75rem' }}>
            Your signature, the time you signed, and a one-way hash of your IP are recorded
            and bound to this contract. We do not store your IP in plain text. The hash chain
            is recomputed on every audit so any tampering would be visible immediately.
          </p>
          <p style={{ margin: 0 }}>
            This page is private to the named recipients. If you forwarded the link by mistake,
            ask the sender to revoke it. The link expires when the contract is fully signed,
            cancelled, or its expiry date passes.
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Brand mark + preview pill ────────────────────────────────────────────

function BrandMark({ size = 'md', dark = false }: { size?: 'sm' | 'md'; dark?: boolean }) {
  const dim = size === 'sm' ? '1.25rem' : '1.625rem'
  return (
    <div className="inline-flex items-center" style={{ gap: '0.5rem' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/favicon.png"
        alt=""
        aria-hidden="true"
        style={{ width: dim, height: dim, display: 'block', flexShrink: 0 }}
      />
      <span style={{
        fontSize: size === 'sm' ? '0.8125rem' : '0.9375rem',
        fontWeight: 700,
        color: dark ? '#FFFFFF' : BRAND.inkDeep,
        letterSpacing: '-0.01em',
      }}>
        Tahi Studio
      </span>
    </div>
  )
}

function PreviewPill() {
  return (
    <div
      style={{
        position: 'fixed',
        top: '1rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 50,
        padding: '0.5rem 1rem',
        background: BRAND.inkDeep,
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
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function labelForType(t: string): string {
  return ({
    nda: 'Non-disclosure agreement',
    sla: 'Service-level agreement',
    msa: 'Master services agreement',
    sow: 'Statement of work',
    mou: 'Memorandum of understanding',
    other: 'Contract',
  } as Record<string, string>)[t] ?? 'Contract'
}

function labelForRole(r: string): string {
  return ({
    tahi: 'Tahi Studio',
    client: 'Client',
    other: 'Signatory',
  } as Record<string, string>)[r] ?? r
}

function statusLabel(s: PublicContract['status']): string {
  return ({
    draft: 'Draft',
    sent: 'Awaiting signatures',
    partially_signed: 'Partially signed',
    signed: 'Fully signed',
    expired: 'Expired',
    cancelled: 'Cancelled',
  } as Record<PublicContract['status'], string>)[s]
}

function statusForSigner(s: PublicSigner['status']): string {
  return ({ pending: 'Pending', signed: 'Signed', skipped: 'Skipped' } as Record<PublicSigner['status'], string>)[s]
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ─── Styles ──────────────────────────────────────────────────────────────

const pageWrap: React.CSSProperties = {
  minHeight: '100vh',
  background: BRAND.page,
  fontFamily: 'var(--font-manrope, system-ui)',
  color: BRAND.inkDeep,
  padding: 'clamp(1rem, 4vw, 2.5rem)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'clamp(1.5rem, 3.5vw, 2.5rem)',
}

// ── Cover ────────────────────────────────────────────────────────────────

const coverShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '76rem',
  margin: '0 auto',
  // The cinematic cover : same brand-glass language as the proposal cover.
  // Layered radial glows are below; the surface itself is brand-dark green
  // so the white type and chips read with confidence.
  background: [
    'radial-gradient(60% 60% at 85% 0%, rgba(255,255,255,0.22) 0%, transparent 55%)',
    'radial-gradient(80% 60% at 0% 110%, rgba(122,170,114,0.45) 0%, transparent 60%)',
    'radial-gradient(120% 100% at 50% 50%, transparent 60%, rgba(0,0,0,0.20) 100%)',
    'linear-gradient(135deg, #5A824E 0%, #3e5a35 100%)',
  ].join(', '),
  border: 'none',
  borderRadius: LEAF_LG,
  overflow: 'hidden',
  boxShadow: '0 18px 48px rgba(31, 44, 26, 0.18), 0 1px 0 rgba(255, 255, 255, 0.1) inset',
  color: '#FFFFFF',
}

const coverBackdrop: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  pointerEvents: 'none',
  zIndex: 0,
}

/** A partial brand-circle ring : same motif as the proposal cover. */
const coverRing: React.CSSProperties = {
  position: 'absolute',
  top: '-14rem',
  right: '-14rem',
  width: '40rem',
  height: '40rem',
  borderRadius: '50%',
  border: '5rem solid rgba(255, 255, 255, 0.16)',
  pointerEvents: 'none',
  zIndex: 0,
}

const coverInner: React.CSSProperties = {
  position: 'relative',
  zIndex: 1,
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'clamp(22rem, 50vh, 32rem)',
  padding: 'clamp(1.5rem, 4vw, 3rem)',
  gap: '0.75rem',
}

const coverEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: '#dcefd8',
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  marginBottom: '0.625rem',
}

const coverTitle: React.CSSProperties = {
  fontSize: 'clamp(1.875rem, 6vw, 4rem)',
  fontWeight: 800,
  lineHeight: 1.02,
  color: '#FFFFFF',
  margin: 0,
  letterSpacing: '-0.02em',
  overflowWrap: 'break-word',
}

const coverChips: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '0.5rem',
  marginTop: '1rem',
  marginBottom: '1.25rem',
}

const coverMetaGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))',
  gap: '0.625rem',
  paddingTop: '1rem',
  borderTop: '1px solid rgba(255, 255, 255, 0.18)',
}

const coverMetaCell: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.10)',
  border: '1px solid rgba(255, 255, 255, 0.22)',
  backdropFilter: 'blur(16px) saturate(140%)',
  WebkitBackdropFilter: 'blur(16px) saturate(140%)',
  borderRadius: '0 12px 0 12px',
  padding: '0.625rem 0.875rem',
  minWidth: 0,
}

const coverMetaLabel: React.CSSProperties = {
  fontSize: '0.625rem',
  fontWeight: 600,
  color: '#a8c89e',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  marginBottom: '0.25rem',
}

const coverMetaValue: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 700,
  color: '#FFFFFF',
  overflowWrap: 'break-word',
  letterSpacing: '-0.005em',
}

// ── Slide shell ─────────────────────────────────────────────────────────

const slideShell: React.CSSProperties = {
  width: '100%',
  maxWidth: '64rem',
  margin: '0 auto',
  background: BRAND.surface,
  border: `1px solid ${BRAND.border}`,
  borderRadius: LEAF_LG,
  padding: 'clamp(1.75rem, 4vw, 3rem)',
  boxShadow: '0 4px 18px rgba(31, 44, 26, 0.04), 0 1px 0 rgba(255, 255, 255, 0.6) inset',
}

const slideEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: BRAND.green,
  textTransform: 'uppercase',
  letterSpacing: '0.14em',
  marginBottom: '0.625rem',
}

const slideTitle: React.CSSProperties = {
  fontSize: 'clamp(1.5rem, 3.4vw, 2.25rem)',
  fontWeight: 800,
  lineHeight: 1.1,
  color: BRAND.inkDeep,
  margin: 0,
  letterSpacing: '-0.02em',
}

const slideSub: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.6,
  color: BRAND.textMuted,
  margin: '0.625rem 0 1.5rem',
  maxWidth: '40rem',
}

// ── Body prose : framed inside a brand-tinted leaf-radius card ──────────

const proseFrame: React.CSSProperties = {
  background: BRAND.green50,
  border: `1px solid ${BRAND.green100}`,
  borderRadius: LEAF,
  padding: 'clamp(1.25rem, 3vw, 2rem)',
  marginTop: '0.5rem',
}

const prose: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.75,
  color: BRAND.ink,
}

// ── Signer grid ────────────────────────────────────────────────────────

const signerGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
  gap: '1rem',
  marginTop: '0.5rem',
}

// ── Signed hero ────────────────────────────────────────────────────────

const signedHeroShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  background: BRAND.surface,
  border: `1px solid ${BRAND.green100}`,
  borderRadius: LEAF_LG,
  padding: 'clamp(1.75rem, 4vw, 3rem)',
  overflow: 'hidden',
  boxShadow: '0 12px 36px rgba(90, 130, 78, 0.14), 0 1px 0 rgba(255, 255, 255, 0.6) inset',
}

const signedHeroBackdrop: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  background: [
    'radial-gradient(60% 60% at 85% 0%, rgba(220,239,216,0.7) 0%, transparent 55%)',
    'radial-gradient(80% 60% at 0% 110%, rgba(122,170,114,0.18) 0%, transparent 60%)',
  ].join(', '),
  pointerEvents: 'none',
  zIndex: 0,
}

const signedHeroCheck: React.CSSProperties = {
  width: '3rem',
  height: '3rem',
  borderRadius: LEAF,
  background: `linear-gradient(135deg, ${BRAND.greenLight} 0%, ${BRAND.greenDark} 100%)`,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxShadow: '0 8px 20px rgba(31, 44, 26, 0.18)',
  marginBottom: '1.25rem',
}

const assuranceBlock: React.CSSProperties = {
  marginTop: '1.5rem',
  padding: '1.25rem 1.375rem',
  background: BRAND.green50,
  border: `1px solid ${BRAND.green100}`,
  borderRadius: LEAF,
}

const assuranceList: React.CSSProperties = {
  display: 'block',
  margin: 0,
}

// ── Signature pad ──────────────────────────────────────────────────────

const padFrame: React.CSSProperties = {
  background: BRAND.green50,
  border: `1px solid ${BRAND.green100}`,
  borderRadius: LEAF,
  padding: 'clamp(1rem, 3vw, 1.5rem)',
}

const padShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  height: 'clamp(11rem, 32vw, 14rem)',
  border: `1px solid ${BRAND.border}`,
  borderRadius: LEAF_SM,
  background: 'linear-gradient(180deg, #ffffff 0%, #fdfefd 60%, #f7f9f6 100%)',
  overflow: 'hidden',
  touchAction: 'none',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.85), 0 1px 2px rgba(31, 44, 26, 0.05)',
}

const padCanvas: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  cursor: 'crosshair',
}

const padBaseline: React.CSSProperties = {
  position: 'absolute',
  left: '1.25rem',
  right: '1.25rem',
  bottom: '2.25rem',
  borderTop: `1px dashed ${BRAND.border}`,
  pointerEvents: 'none',
}

const padBaselineLabel: React.CSSProperties = {
  position: 'absolute',
  left: '1.25rem',
  bottom: '0.625rem',
  fontSize: '0.6875rem',
  color: BRAND.textSubtle,
  letterSpacing: '0.04em',
  pointerEvents: 'none',
  fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
}

const padControls: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '1rem',
  marginTop: '1rem',
}

const btnGhost: React.CSSProperties = {
  background: BRAND.surface,
  border: `1px solid ${BRAND.border}`,
  borderRadius: '0.5rem',
  padding: '0.75rem 1.125rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: BRAND.textMuted,
  cursor: 'pointer',
  // Touch target floor (44px) for mobile signing.
  minHeight: '2.75rem',
  letterSpacing: '-0.005em',
}

const btnPrimary: React.CSSProperties = {
  background: `linear-gradient(135deg, ${BRAND.greenLight} 0%, ${BRAND.greenDark} 100%)`,
  color: '#FFFFFF',
  border: 'none',
  borderRadius: LEAF,
  padding: '0.875rem 1.625rem',
  fontSize: '0.9375rem',
  fontWeight: 700,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  // Touch target floor (44px) for mobile signing.
  minHeight: '2.75rem',
  boxShadow: '0 6px 18px rgba(90, 130, 78, 0.25)',
  transition: 'transform 200ms ease, box-shadow 200ms ease',
}

const agreeLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'flex-start',
  fontSize: '0.8125rem',
  color: BRAND.textMuted,
  flex: '1 1 18rem',
  lineHeight: 1.5,
  cursor: 'pointer',
}

const footer: React.CSSProperties = {
  width: '100%',
  maxWidth: '64rem',
  margin: '0 auto',
  paddingTop: '1rem',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.625rem 1rem',
}

const footerNote: React.CSSProperties = {
  fontSize: '0.75rem',
  color: BRAND.textSubtle,
}
