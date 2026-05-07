/**
 * <ContractViewer> - public viewer for a Tahi contract document.
 *
 * Two modes:
 *  - 'read'   : public token, no signerId. Shows contract + signed-status,
 *                no sign UI. Used at /p/contract/[token].
 *  - 'sign'   : public token + signerId. Same content but with a signature
 *                canvas pad bound to the specified signer. After signing,
 *                flips to a thank-you state.
 *
 * Brand language matches the proposal viewer (cover shell, leaf radius, etc).
 * The contract bodyHtml is rendered via dangerouslySetInnerHTML - admin-
 * authored content with variable substitution already escaped on the server.
 */
'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { apiPath } from '@/lib/api'
import { useShareViewTracking } from '@/components/tahi/use-share-view-tracking'

/**
 * Fade-in-on-scroll hook. Mirrors the proposal viewer behaviour so the
 * two surfaces feel like siblings. Respects prefers-reduced-motion and
 * falls back to immediately-visible on any environment that doesn't
 * support IntersectionObserver.
 */
function useInView<T extends HTMLElement>(opts?: { rootMargin?: string; threshold?: number }): [React.RefObject<T | null>, boolean] {
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

/**
 * <FadeSection> - layout-agnostic wrapper that fades + lifts its children
 * into view as they scroll past 8% of the viewport. Keeps each contract
 * slide feeling intentional rather than dropping in instantly.
 */
function FadeSection({ children, style, delay = 0 }: { children: React.ReactNode; style?: React.CSSProperties; delay?: number }) {
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

  // Resolve the active signer for sign mode.
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
        <div className="animate-pulse" style={{ width: '100%', maxWidth: '60rem', height: '20rem', background: 'rgba(255,255,255,0.5)', borderRadius: '1rem', margin: '0 auto' }} />
      </div>
    )
  }

  if (state === 'not_found' || !contract) {
    return (
      <div style={{ ...pageWrap, alignItems: 'center', justifyContent: 'center', display: 'flex' }}>
        <div style={{ textAlign: 'center', maxWidth: '24rem', padding: '2rem' }}>
          <BrandMark />
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1f2c1a', marginTop: '1rem', marginBottom: '0.5rem' }}>
            This contract isn&apos;t available
          </h1>
          <p style={{ fontSize: '0.875rem', color: '#5a6657', lineHeight: 1.5 }}>
            The link may have been revoked or copied incorrectly. Reach out to the sender if you were
            expecting to see a contract to sign.
          </p>
        </div>
      </div>
    )
  }

  const allSigned = contract.status === 'signed'
  const signersByPosition = [...signers].sort((a, b) => a.position - b.position)

  // Sign-mode guard rails: invalid signer, already signed, etc.
  let signGuardMessage: string | null = null
  if (mode === 'sign') {
    if (!activeSigner) signGuardMessage = 'This sign link is invalid. Ask the sender for a fresh link.'
    else if (activeSigner.status === 'signed') signGuardMessage = `${activeSigner.name}, you've already signed this contract. Thank you.`
    else if (activeSigner.status === 'skipped') signGuardMessage = 'This signer was removed from the contract.'
    else if (allSigned) signGuardMessage = 'This contract is already fully signed.'
  }

  return (
    <div style={pageWrap}>
      {/* Preview-mode pill */}
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

      {/* Cover - rendered without FadeSection so it's instantly visible
          on first paint. The fade-in pattern below applies to subsequent
          slides so they scroll into view with a subtle lift. */}
      <section style={coverShell}>
        <div style={coverBackdrop} aria-hidden="true" />
        <div style={coverInner}>
          <BrandMark />
          <div style={{ marginTop: 'auto' }}>
            <div style={coverEyebrow}>{labelForType(contract.type)}</div>
            <h1 style={coverTitle}>{contract.name}</h1>
          </div>
          <div style={coverMetaGrid}>
            <CoverMeta label="Status" value={statusLabel(contract.status)} />
            {contract.sentAt && <CoverMeta label="Sent" value={formatDate(contract.sentAt)} />}
            {contract.expiresAt && <CoverMeta label="Expires" value={formatDate(contract.expiresAt)} />}
            <CoverMeta label="Signers" value={`${signers.filter(s => s.status === 'signed').length} of ${signers.length}`} />
          </div>
        </div>
      </section>

      {/* Status banner */}
      {allSigned && (
        <div style={statusBanner('success')}>
          <strong>Fully signed</strong>
          {contract.signedAt && <span style={{ marginLeft: '0.625rem', fontWeight: 500, opacity: 0.85 }}>on {formatDate(contract.signedAt)}</span>}
        </div>
      )}

      {/* Contract body */}
      <FadeSection style={slideShell}>
        <div style={slideEyebrow}>The agreement</div>
        <div
          style={prose}
          dangerouslySetInnerHTML={{ __html: contract.bodyHtml }}
        />
      </FadeSection>

      {/* Signers list */}
      <FadeSection style={slideShell} delay={60}>
        <div style={slideEyebrow}>Signatories</div>
        <h2 style={slideTitle}>Who signs this</h2>
        <div style={signerList}>
          {signersByPosition.map(s => {
            const sig = signatures.find(x => x.signerId === s.id)
            const isYou = mode === 'sign' && s.id === signerId
            return (
              <div
                key={s.id}
                style={{
                  ...signerCard,
                  borderColor: isYou ? '#5A824E' : '#d4e0d0',
                  boxShadow: isYou ? '0 6px 18px rgba(90, 130, 78, 0.12)' : 'none',
                  background: isYou ? '#f0f7ee' : '#fdfefd',
                }}
              >
                <div style={signerHeader}>
                  <div>
                    <div style={signerName}>
                      {s.name}
                      {isYou && <span style={signerYouBadge}>That&apos;s you</span>}
                    </div>
                    <div style={signerSub}>{labelForRole(s.role)} · {s.email}</div>
                  </div>
                  <div style={signerStatus(s.status)}>{statusDot(s.status)}{statusForSigner(s.status)}</div>
                </div>
                {sig ? (
                  <div style={signaturePreviewWrap}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sig.signatureDataUrl} alt={`${s.name} signature`} style={signaturePreview} />
                    {sig.signedAt && (
                      <div style={signedAtLine}>Signed on {formatDate(sig.signedAt)}</div>
                    )}
                  </div>
                ) : (
                  <div style={{ ...signedAtLine, color: '#8a9987' }}>Awaiting signature</div>
                )}
              </div>
            )
          })}
        </div>
      </FadeSection>

      {/* Sign UI (sign mode only, when allowed) */}
      {mode === 'sign' && (
        <FadeSection style={slideShell} delay={120}>
          {signGuardMessage ? (
            <div style={statusBanner(allSigned ? 'success' : 'info')}>{signGuardMessage}</div>
          ) : justSigned ? (
            <div style={statusBanner('success')}>
              <strong>Thank you, {activeSigner?.name}.</strong>
              <span style={{ marginLeft: '0.625rem', fontWeight: 500, opacity: 0.85 }}>
                {allSigned
                  ? 'Your signature was recorded and the contract is now fully signed.'
                  : 'Your signature was recorded. Other signers will be notified.'}
              </span>
            </div>
          ) : activeSigner ? (
            <SignaturePad
              signerName={activeSigner.name}
              submitting={submitting}
              onSubmit={submitSignature}
              error={error}
            />
          ) : null}
        </FadeSection>
      )}

      <footer style={footer}>
        <BrandMark size="sm" />
        <span style={footerNote}>
          Tamper-evident · each signature is anchored to a SHA-256 chain. Confidential, for the named recipient only.
        </span>
      </footer>
    </div>
  )
}

// ─── Signature pad ────────────────────────────────────────────────────────

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
    ctx.lineWidth = 2.2
    ctx.strokeStyle = '#1f2c1a'
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

  return (
    <div>
      <div style={slideEyebrow}>Sign here</div>
      <h2 style={slideTitle}>{signerName}, draw your signature</h2>
      <p style={slideSub}>
        Use a finger on touch screens, or click and drag with a mouse. Your signature is bound to
        the contract via a tamper-evident hash.
      </p>
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
      </div>
      <div style={padControls}>
        <button type="button" onClick={clear} style={btnGhost}>Clear</button>
        <label style={agreeLabel}>
          <input
            type="checkbox"
            checked={agree}
            onChange={e => setAgree(e.target.checked)}
            style={{ width: '1rem', height: '1rem', marginRight: '0.5rem' }}
          />
          I am {signerName} and I intend to sign this contract.
        </label>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !hasInk || !agree}
          style={{ ...btnPrimary, opacity: (!hasInk || !agree) ? 0.5 : 1 }}
        >
          {submitting ? 'Recording...' : 'Sign contract'}
        </button>
      </div>
      {error && <div style={errorBanner}>{error}</div>}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────

function CoverMeta({ label, value }: { label: string; value: string }) {
  return (
    <div style={coverMetaCell}>
      <div style={coverMetaLabel}>{label}</div>
      <div style={coverMetaValue}>{value}</div>
    </div>
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
    draft: 'Draft', sent: 'Awaiting signatures', partially_signed: 'Partially signed',
    signed: 'Fully signed', expired: 'Expired', cancelled: 'Cancelled',
  } as Record<PublicContract['status'], string>)[s]
}

function statusForSigner(s: PublicSigner['status']): string {
  return ({ pending: 'Pending', signed: 'Signed', skipped: 'Skipped' } as Record<PublicSigner['status'], string>)[s]
}

function statusDot(s: PublicSigner['status']): React.ReactNode {
  const c = s === 'signed' ? '#5A824E' : s === 'skipped' ? '#8a9987' : '#fb923c'
  return <span style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: c, display: 'inline-block', marginRight: '0.5rem' }} />
}

function formatDate(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
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
  // Asymmetric leaf radius - top-right + bottom-left rounded harder,
  // mirrors the brand mark's leaf silhouette.
  borderRadius: '0.75rem 1.5rem 0.75rem 1.5rem',
  overflow: 'hidden',
  boxShadow: '0 10px 36px rgba(31, 44, 26, 0.08), 0 1px 0 rgba(255, 255, 255, 0.6) inset',
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
  gap: '0.75rem',
  marginTop: '1.25rem',
}

const coverMetaCell: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.7)',
  border: '1px solid #e8f0e6',
  borderRadius: '0.5rem',
  padding: '0.75rem 0.875rem',
  minWidth: 0,
}

const coverMetaLabel: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#8a9987',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  marginBottom: '0.25rem',
}

const coverMetaValue: React.CSSProperties = {
  fontSize: '0.875rem',
  fontWeight: 600,
  color: '#1f2c1a',
  overflowWrap: 'break-word',
}

const slideShell: React.CSSProperties = {
  width: '100%',
  maxWidth: '64rem',
  margin: '0 auto',
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '0.75rem 1.25rem 0.75rem 1.25rem',
  padding: 'clamp(1.5rem, 4vw, 2.75rem)',
  boxShadow: '0 4px 18px rgba(31, 44, 26, 0.04)',
}

const slideEyebrow: React.CSSProperties = {
  fontSize: '0.6875rem',
  fontWeight: 600,
  color: '#5A824E',
  textTransform: 'uppercase',
  letterSpacing: '0.12em',
  marginBottom: '0.5rem',
}

const slideTitle: React.CSSProperties = {
  fontSize: 'clamp(1.25rem, 3vw, 1.875rem)',
  fontWeight: 700,
  lineHeight: 1.2,
  color: '#1f2c1a',
  margin: 0,
  marginBottom: '0.5rem',
}

const slideSub: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.55,
  color: '#5a6657',
  margin: 0,
  marginBottom: '1.25rem',
}

const prose: React.CSSProperties = {
  fontSize: '0.9375rem',
  lineHeight: 1.7,
  color: '#1f2c1a',
}

const signerList: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(18rem, 1fr))',
  gap: '0.875rem',
  marginTop: '0.75rem',
}

const signerCard: React.CSSProperties = {
  border: '1px solid #d4e0d0',
  borderRadius: '0 16px 0 16px',
  padding: '1rem',
  background: '#fdfefd',
}

const signerHeader: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: '0.5rem',
  marginBottom: '0.625rem',
}

const signerName: React.CSSProperties = {
  fontSize: '0.9375rem',
  fontWeight: 700,
  color: '#1f2c1a',
}

const signerYouBadge: React.CSSProperties = {
  display: 'inline-block',
  marginLeft: '0.5rem',
  background: '#dcefd8',
  color: '#425F39',
  fontSize: '0.6875rem',
  fontWeight: 700,
  padding: '0.125rem 0.5rem',
  borderRadius: '999px',
}

const signerSub: React.CSSProperties = {
  fontSize: '0.8125rem',
  color: '#5a6657',
  marginTop: '0.125rem',
}

function signerStatus(s: PublicSigner['status']): React.CSSProperties {
  const colorByStatus: Record<PublicSigner['status'], string> = {
    pending: '#fb923c',
    signed: '#5A824E',
    skipped: '#8a9987',
  }
  return {
    fontSize: '0.75rem',
    fontWeight: 600,
    color: colorByStatus[s],
    display: 'inline-flex',
    alignItems: 'center',
    whiteSpace: 'nowrap',
  }
}

const signaturePreviewWrap: React.CSSProperties = {
  marginTop: '0.75rem',
  borderTop: '1px dashed #d4e0d0',
  paddingTop: '0.75rem',
}

const signaturePreview: React.CSSProperties = {
  maxWidth: '100%',
  maxHeight: '5rem',
  filter: 'contrast(1.1)',
}

const signedAtLine: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#5a6657',
  marginTop: '0.375rem',
}

function statusBanner(kind: 'success' | 'info'): React.CSSProperties {
  const map = {
    success: { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' },
    info: { background: '#eff6ff', color: '#1e40af', border: '1px solid #bfdbfe' },
  } as const
  return {
    width: '100%',
    maxWidth: '64rem',
    margin: '0 auto',
    padding: '0.875rem 1rem',
    borderRadius: '0.625rem',
    fontSize: '0.875rem',
    fontWeight: 600,
    ...map[kind],
  }
}

const padShell: React.CSSProperties = {
  position: 'relative',
  width: '100%',
  maxWidth: '40rem',
  height: 'clamp(10rem, 32vw, 13rem)',
  border: '1px solid #d4e0d0',
  borderRadius: '0 16px 0 16px',
  background: 'linear-gradient(180deg, #ffffff 0%, #fdfefd 60%, #f7f9f6 100%)',
  overflow: 'hidden',
  touchAction: 'none',
  boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 2px rgba(31, 44, 26, 0.04)',
}

const padCanvas: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'block',
  cursor: 'crosshair',
}

const padBaseline: React.CSSProperties = {
  position: 'absolute',
  left: '1rem',
  right: '1rem',
  bottom: '2rem',
  borderTop: '1px dashed #d4e0d0',
  pointerEvents: 'none',
}

const padControls: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.75rem',
  marginTop: '1rem',
}

const btnGhost: React.CSSProperties = {
  background: '#ffffff',
  border: '1px solid #d4e0d0',
  borderRadius: '0.5rem',
  padding: '0.625rem 1rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#5a6657',
  cursor: 'pointer',
  // Touch target floor (44px) for mobile signing.
  minHeight: '2.75rem',
}

const btnPrimary: React.CSSProperties = {
  background: '#5A824E',
  color: '#ffffff',
  border: 'none',
  borderRadius: '0 16px 0 16px',
  padding: '0.75rem 1.5rem',
  fontSize: '0.875rem',
  fontWeight: 700,
  letterSpacing: '-0.005em',
  cursor: 'pointer',
  marginLeft: 'auto',
  // Touch target floor (44px) for mobile signing.
  minHeight: '2.75rem',
  boxShadow: '0 6px 18px rgba(90, 130, 78, 0.25)',
  transition: 'transform 160ms ease, box-shadow 160ms ease',
}

const agreeLabel: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  fontSize: '0.8125rem',
  color: '#5a6657',
  flex: '1 1 16rem',
}

const errorBanner: React.CSSProperties = {
  marginTop: '0.75rem',
  padding: '0.75rem 0.875rem',
  background: '#fef2f2',
  color: '#991b1b',
  border: '1px solid #fecaca',
  borderRadius: '0.5rem',
  fontSize: '0.8125rem',
  fontWeight: 600,
}

const footer: React.CSSProperties = {
  width: '100%',
  maxWidth: '64rem',
  margin: '0 auto',
  paddingTop: '0.75rem',
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: '0.625rem 1rem',
}

const footerNote: React.CSSProperties = {
  fontSize: '0.75rem',
  color: '#8a9987',
}
