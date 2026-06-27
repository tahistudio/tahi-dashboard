'use client'

/**
 * Inline retainer payment for the onboarding "pay" step. Creates an incomplete
 * subscription via /api/portal/checkout, then confirms the first payment with a
 * Stripe PaymentElement (PCI-safe, no raw card data touches our code). On
 * success the flow continues; the Stripe webhook flips the subscription active.
 *
 * Degrades gracefully when Stripe is not configured (empty publishable key) or
 * the plan prices have not been set up yet: it shows the invoice fallback so
 * onboarding is never hard-blocked on payment.
 */

import * as React from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
let _stripePromise: Promise<Stripe | null> | null = null
function stripePromise(): Promise<Stripe | null> | null {
  if (!PK) return null
  if (!_stripePromise) _stripePromise = loadStripe(PK)
  return _stripePromise
}

export interface PaymentProps {
  plan: 'maintain' | 'scale'
  addon: boolean
  planName: string
  baseLabel: string
  trackLabel: string
  totalLabel: string
  onPaid: () => void
  onInvoiced: () => void
  onBack: () => void
}

function Summary({ planName, baseLabel, addon, trackLabel, totalLabel }: Pick<PaymentProps, 'planName' | 'baseLabel' | 'addon' | 'trackLabel' | 'totalLabel'>) {
  return (
    <div className="ob-summary" style={{ marginBottom: '16px' }}>
      <div className="ob-srow">{planName} plan <b>{baseLabel}/mo</b></div>
      {addon && <div className="ob-srow">Priority Support, extra track <b>+{trackLabel}/mo</b></div>}
      <div className="ob-srow total">Monthly total <b>{totalLabel}/mo</b></div>
    </div>
  )
}

function PayForm({ totalLabel, onPaid, onBack }: { totalLabel: string; onPaid: () => void; onBack: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const pay = async () => {
    if (!stripe || !elements) return
    setBusy(true)
    setError(null)
    const { error: err } = await stripe.confirmPayment({
      elements,
      confirmParams: { return_url: window.location.href },
      redirect: 'if_required',
    })
    if (err) {
      setError(err.message ?? 'Your bank declined this. Try another card, or contact them.')
      setBusy(false)
      return
    }
    onPaid()
  }

  return (
    <>
      {error && (
        <div className="ob-decline">
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4M12 16h.01" /></svg>
          {error}
        </div>
      )}
      <div className="ob-pe"><PaymentElement /></div>
      <div className="ob-trust">
        <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
        Secured by Stripe.
      </div>
      <div className="ob-footer">
        <button className="ob-back" onClick={onBack} disabled={busy}>Back</button>
        <button className="ob-next" onClick={pay} disabled={busy || !stripe}>
          {busy ? <span className="ob-spin" /> : `Pay ${totalLabel}/mo`}
        </button>
      </div>
    </>
  )
}

export function OnboardingPayment(props: PaymentProps) {
  const { plan, addon, onInvoiced } = props
  const [clientSecret, setClientSecret] = React.useState<string | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'unavailable'>('loading')
  const sp = stripePromise()

  React.useEffect(() => {
    if (!sp) { setState('unavailable'); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/portal/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, addon }),
        })
        const json = (await res.json()) as { clientSecret?: string }
        if (cancelled) return
        if (res.ok && json.clientSecret) { setClientSecret(json.clientSecret); setState('ready') }
        else setState('unavailable')
      } catch {
        if (!cancelled) setState('unavailable')
      }
    })()
    return () => { cancelled = true }
  }, [plan, addon, sp])

  if (state === 'loading') {
    return <div className="ob-success"><div className="ob-spin" /><p style={{ marginTop: 14 }}>Getting your retainer ready.</p></div>
  }

  if (state === 'unavailable' || !sp || !clientSecret) {
    // Stripe not configured / prices not set up: offer the invoice path so the
    // client is never stuck. (Net terms is a first-class option anyway.)
    return (
      <>
        <Summary {...props} />
        <p className="ob-sub" style={{ margin: '0 0 4px' }}>Card payment isn&apos;t available right now.</p>
        <div className="ob-footer">
          <button className="ob-back" onClick={props.onBack}>Back</button>
          <button className="ob-next" onClick={onInvoiced}>Continue, invoice me</button>
        </div>
        <div className="ob-fallback">We&apos;ll set up net terms and email your first invoice.</div>
      </>
    )
  }

  return (
    <>
      <Summary {...props} />
      <Elements stripe={sp} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#425F39', fontFamily: 'Manrope, sans-serif', borderRadius: '8px' } } }}>
        <PayForm totalLabel={props.totalLabel} onPaid={props.onPaid} onBack={props.onBack} />
      </Elements>
      <div className="ob-fallback">Prefer to be invoiced? <a onClick={onInvoiced}>We&apos;ll set up net terms.</a></div>
    </>
  )
}
