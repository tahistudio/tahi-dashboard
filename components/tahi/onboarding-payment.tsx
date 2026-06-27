'use client'

/**
 * Inline retainer payment for the onboarding "pay" step. Creates an incomplete
 * subscription via /api/portal/checkout, then confirms the first payment with a
 * Stripe PaymentElement (PCI-safe, no raw card data touches our code). On
 * success the flow continues; the Stripe webhook flips the subscription active.
 *
 * Currency: the client can switch presentment currency. Each Stripe price
 * carries currency_options, so switching just recreates the subscription in the
 * chosen currency and re-inits the PaymentElement, keeping the same inline look.
 *
 * Degrades gracefully when Stripe is not configured (empty publishable key) or
 * the plan prices have not been set up yet: it shows the invoice fallback so
 * onboarding is never hard-blocked on payment.
 */

import * as React from 'react'
import { loadStripe, type Stripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import {
  PRESENTMENT_CURRENCIES,
  presentmentAmount,
  type PresentmentCurrency,
} from '@/lib/stripe-plans'

const PK = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? ''
let _stripePromise: Promise<Stripe | null> | null = null
function stripePromise(): Promise<Stripe | null> | null {
  if (!PK) return null
  if (!_stripePromise) _stripePromise = loadStripe(PK)
  return _stripePromise
}

/** Format a minor-unit amount in the given currency (no cents, prices are whole). */
function fmt(minor: number, currency: PresentmentCurrency): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    maximumFractionDigits: 0,
  }).format(minor / 100)
}

export interface PaymentProps {
  plan: 'maintain' | 'scale'
  addon: boolean
  planName: string
  /** Base plan price in USD minor units (cents). */
  baseUsd: number
  /** Parallel-track add-on price in USD minor units (cents). */
  trackUsd: number
  onPaid: () => void
  onInvoiced: () => void
  onBack: () => void
}

function CurrencyPicker({ currency, onChange, disabled }: { currency: PresentmentCurrency; onChange: (c: PresentmentCurrency) => void; disabled?: boolean }) {
  return (
    <div className="ob-ccy">
      <label className="ob-label" htmlFor="ob-ccy-sel">Pay in</label>
      <select
        id="ob-ccy-sel"
        className="ob-select"
        value={currency}
        disabled={disabled}
        onChange={e => onChange(e.target.value as PresentmentCurrency)}
      >
        {PRESENTMENT_CURRENCIES.map(c => <option key={c} value={c}>{c.toUpperCase()}</option>)}
      </select>
    </div>
  )
}

function Summary({ planName, baseUsd, addon, trackUsd, currency }: { planName: string; baseUsd: number; addon: boolean; trackUsd: number; currency: PresentmentCurrency }) {
  const base = presentmentAmount(baseUsd, currency)
  const track = presentmentAmount(trackUsd, currency)
  const total = base + (addon ? track : 0)
  return (
    <div className="ob-summary" style={{ marginBottom: '16px' }}>
      <div className="ob-srow">{planName} plan <b>{fmt(base, currency)}/mo</b></div>
      {addon && <div className="ob-srow">Priority Support, extra track <b>+{fmt(track, currency)}/mo</b></div>}
      <div className="ob-srow total">Monthly total <b>{fmt(total, currency)}/mo</b></div>
    </div>
  )
}

function PayForm({ totalDisplay, onPaid, onBack }: { totalDisplay: string; onPaid: () => void; onBack: () => void }) {
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
          {busy ? <span className="ob-spin" /> : `Pay ${totalDisplay}/mo`}
        </button>
      </div>
    </>
  )
}

export function OnboardingPayment(props: PaymentProps) {
  const { plan, addon, baseUsd, trackUsd, onInvoiced } = props
  const [currency, setCurrency] = React.useState<PresentmentCurrency>('usd')
  const [clientSecret, setClientSecret] = React.useState<string | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'unavailable'>('loading')
  const sp = stripePromise()

  React.useEffect(() => {
    if (!sp) { setState('unavailable'); return }
    let cancelled = false
    setState('loading')
    setClientSecret(null)
    ;(async () => {
      try {
        const res = await fetch('/api/portal/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan, addon, currency }),
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
  }, [plan, addon, currency, sp])

  const total = presentmentAmount(baseUsd, currency) + (addon ? presentmentAmount(trackUsd, currency) : 0)

  if (state === 'unavailable' || !sp) {
    // Stripe not configured / prices not set up: offer the invoice path so the
    // client is never stuck. (Net terms is a first-class option anyway.)
    return (
      <>
        <Summary planName={props.planName} baseUsd={baseUsd} addon={addon} trackUsd={trackUsd} currency={currency} />
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
      <Summary planName={props.planName} baseUsd={baseUsd} addon={addon} trackUsd={trackUsd} currency={currency} />
      <CurrencyPicker currency={currency} onChange={setCurrency} disabled={state === 'loading'} />
      {state === 'loading' || !clientSecret ? (
        <div className="ob-success"><div className="ob-spin" /><p style={{ marginTop: 14 }}>Getting your retainer ready.</p></div>
      ) : (
        <Elements stripe={sp} options={{ clientSecret, appearance: { theme: 'stripe', variables: { colorPrimary: '#425F39', fontFamily: 'Manrope, sans-serif', borderRadius: '8px' } } }}>
          <PayForm totalDisplay={fmt(total, currency)} onPaid={props.onPaid} onBack={props.onBack} />
        </Elements>
      )}
      <div className="ob-fallback">Prefer to be invoiced? <a onClick={onInvoiced}>We&apos;ll set up net terms.</a></div>
    </>
  )
}
