'use client'

import { useEffect, useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { EmailDeliveryCard } from '@/components/tahi/settings/sections/email-delivery'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  DEFAULT_INVOICE_CHANNEL,
  INVOICE_CHANNELS,
  INVOICE_CHANNEL_SETTING_KEY,
} from '@/lib/invoice-channel'
import {
  BANK_DETAILS_SETTING_KEY,
  DEFAULT_XERO_EMAIL_MODE,
  XERO_EMAIL_MODE_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  parseBankDetails,
  resolveXeroEmailMode,
  validateBankDetails,
  validateXeroEmailMode,
  validateXeroPaymentAccountCode,
  type InvoiceBankDetails,
} from '@/lib/invoice-pay-settings'

type SettingsMap = Record<string, string | null>

const CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR']
const LEDE =
  'Legal name, address and tax details - shown on the invoices and contracts your clients receive.'

/**
 * How a Xero-rail invoice reaches the client, in plain words.
 *
 * Deliberately not the labels in lib/invoice-pay-settings (which are written
 * for an API error message): the person reading this select is choosing who
 * presses send, so the option says who sends.
 */
const XERO_EMAIL_MODE_OPTIONS = [
  { value: 'dashboard', label: 'Send from the dashboard' },
  { value: 'xero', label: 'Let Xero send its own email' },
  { value: 'both', label: 'Both' },
] as const

/**
 * Studio details (design: `function Studio(){...}` in settings-app.jsx).
 *
 * Legal name, GST number, registered address, billing currency, invoice
 * number prefix, default invoicing channel and invoice footer note, plus the
 * Getting paid group: the bank details a client is shown when there is no pay
 * link, the Xero bank account code a dashboard mark-paid records against, and
 * who emails a Xero-rail invoice.
 *
 * Batch-saved to the settings K/V store (studio_legal_name,
 * studio_gst_number, studio_address, studio_billing_currency,
 * invoice_number_prefix, invoicing.defaultChannel, invoice_footer_note,
 * invoicing.bankDetails, invoicing.xeroPaymentAccountCode,
 * invoicing.xeroEmailMode) via PATCH /api/admin/settings, one call per key.
 *
 * The Email delivery card below the form is a separate concern on the same
 * page (components/tahi/settings/sections/email-delivery.tsx): which addresses
 * this platform is allowed to mail at all, and the log of what it held back.
 * It sits here because Studio details is already the super-admin-only place
 * where "what does a client actually receive" is decided.
 *
 * The three pay keys are validated at the door (lib/invoice-pay-settings.ts):
 * a letter in the account number or a name pasted into the Xero account code
 * is a 400 with a sentence, which is why this form now SURFACES a failed save
 * instead of swallowing it. Getting the Xero code wrong does not fail loudly
 * later; it posts real payments against the wrong account.
 */
export function StudioDetailsSection({ isAdmin }: { isAdmin?: boolean } = {}) {
  const { data, isLoading, mutate } = useResource<{ settings: SettingsMap }>(
    isAdmin === false ? null : '/api/admin/settings',
  )

  const [legalName, setLegalName] = useState('')
  const [gstNumber, setGstNumber] = useState('')
  const [address, setAddress] = useState('')
  const [currency, setCurrency] = useState('NZD')
  const [invoicePrefix, setInvoicePrefix] = useState('INV-')
  const [invoiceChannel, setInvoiceChannel] = useState<string>(DEFAULT_INVOICE_CHANNEL)
  const [invoiceFooter, setInvoiceFooter] = useState('')
  // Getting paid.
  const [bankName, setBankName] = useState('')
  const [accountName, setAccountName] = useState('')
  const [accountNumber, setAccountNumber] = useState('')
  const [referenceHint, setReferenceHint] = useState('')
  const [xeroAccountCode, setXeroAccountCode] = useState('')
  const [xeroEmailMode, setXeroEmailMode] = useState<string>(DEFAULT_XERO_EMAIL_MODE)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  // Seed the editable fields whenever settings load or refresh.
  useEffect(() => {
    if (data?.settings) {
      setLegalName(data.settings.studio_legal_name ?? '')
      setGstNumber(data.settings.studio_gst_number ?? '')
      setAddress(data.settings.studio_address ?? '')
      setCurrency(data.settings.studio_billing_currency ?? 'NZD')
      setInvoicePrefix(data.settings.invoice_number_prefix ?? 'INV-')
      // The GET fills this key in with the studio default when no row exists.
      setInvoiceChannel(data.settings[INVOICE_CHANNEL_SETTING_KEY] ?? DEFAULT_INVOICE_CHANNEL)
      setInvoiceFooter(data.settings.invoice_footer_note ?? '')
      // One stored JSON blob, four boxes. parseBankDetails is deliberately
      // tolerant (a hand-edited row that no longer parses reads as empty
      // rather than throwing), because this form is also the repair tool.
      const bank = parseBankDetails(data.settings[BANK_DETAILS_SETTING_KEY])
      setBankName(bank.bankName ?? '')
      setAccountName(bank.accountName ?? '')
      setAccountNumber(bank.accountNumber ?? '')
      setReferenceHint(bank.referenceHint ?? '')
      setXeroAccountCode(data.settings[XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY] ?? '')
      // The GET fills this one too, so an absent row still reads as a choice.
      setXeroEmailMode(resolveXeroEmailMode(data.settings[XERO_EMAIL_MODE_SETTING_KEY]))
    }
  }, [data])

  /**
   * The bankDetails blob, in the shape lib/invoice-pay-settings validates.
   *
   * Empty boxes are OMITTED rather than stored as empty strings: the block
   * that renders this on a client invoice skips a missing field and would
   * print an empty row for a blank one. All four empty saves the empty value,
   * which is the clear.
   */
  function bankDetailsValue(): string {
    const blob: InvoiceBankDetails = {}
    if (bankName.trim()) blob.bankName = bankName.trim()
    if (accountName.trim()) blob.accountName = accountName.trim()
    if (accountNumber.trim()) blob.accountNumber = accountNumber.trim()
    if (referenceHint.trim()) blob.referenceHint = referenceHint.trim()
    return Object.keys(blob).length === 0 ? '' : JSON.stringify(blob)
  }

  /**
   * One key, one PATCH. A 400 carries the validator's sentence, and that
   * sentence is the whole value of the check: "may only contain digits, dashes
   * and spaces" tells the person what to fix, where "Failed to save" sends
   * them to the network tab.
   */
  async function saveKey(key: string, value: string) {
    const res = await fetch(apiPath('/api/admin/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({})) as { error?: string }
      throw new Error(body.error ?? `Could not save ${key}.`)
    }
  }

  async function handleSave() {
    // Checked BEFORE anything is written, and with the same pure validators the
    // route runs, so the two can never disagree. The ten PATCHes go in
    // parallel, so a 400 on one of the three validated keys would otherwise
    // land after the other nine had already been stored: the form would show
    // the validator's sentence over a card that was half saved, and the value
    // still on screen would not be the value in the database.
    const bankBlob = bankDetailsValue()
    const preflight = [
      validateBankDetails(bankBlob),
      validateXeroPaymentAccountCode(xeroAccountCode.trim()),
      validateXeroEmailMode(xeroEmailMode),
    ].find((v) => !v.ok)
    if (preflight && !preflight.ok) {
      setSaved(false)
      setSaveError(preflight.error)
      return
    }

    setSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await Promise.all([
        saveKey('studio_legal_name', legalName.trim()),
        saveKey('studio_gst_number', gstNumber.trim()),
        saveKey('studio_address', address.trim()),
        saveKey('studio_billing_currency', currency),
        saveKey('invoice_number_prefix', invoicePrefix.trim()),
        saveKey(INVOICE_CHANNEL_SETTING_KEY, invoiceChannel),
        saveKey('invoice_footer_note', invoiceFooter.trim()),
        saveKey(BANK_DETAILS_SETTING_KEY, bankBlob),
        saveKey(XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY, xeroAccountCode.trim()),
        saveKey(XERO_EMAIL_MODE_SETTING_KEY, xeroEmailMode),
      ])
      setSaved(true)
      await mutate()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      // Surfaced, not swallowed: a rejected account code or a malformed bank
      // blob is a mistake the person can only fix if they are told about it,
      // and the failure mode otherwise is a client invoice with no way to pay.
      setSaveError(err instanceof Error ? err.message : 'Could not save these details.')
    } finally {
      setSaving(false)
    }
  }

  if (isAdmin === false) return null

  if (isLoading) {
    return (
      <SectionShell title="Studio details" lede={LEDE}>
        <div className="set-card">
          <div className="set-grid2">
            {/* One box per field, in field order: the seven studio details and
                then the six Getting paid ones. A skeleton that is shorter than
                the form it stands in for makes the card jump on load. */}
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
              <div
                key={i}
                className="set-field"
                style={i === 2 || i === 6 ? { gridColumn: '1 / -1' } : undefined}
              >
                <div
                  className="animate-pulse"
                  style={{
                    height: 14,
                    width: '40%',
                    borderRadius: 6,
                    marginBottom: 8,
                    background: 'var(--bg-tertiary)',
                  }}
                />
                <div
                  className="animate-pulse"
                  style={{
                    height: i === 6 ? 70 : 40,
                    borderRadius: 9,
                    background: 'var(--bg-tertiary)',
                  }}
                />
              </div>
            ))}
          </div>
        </div>
      </SectionShell>
    )
  }

  return (
    <SectionShell title="Studio details" lede={LEDE}>
      <div className="set-card">
        <div className="set-grid2">
          <div className="set-field">
            <label htmlFor="studio-legal-name">Legal name</label>
            <input
              id="studio-legal-name"
              className="set-input"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              placeholder="Tahi Studio Ltd"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-gst-number">GST number</label>
            <input
              id="studio-gst-number"
              className="set-input"
              value={gstNumber}
              onChange={(e) => setGstNumber(e.target.value)}
              placeholder="123-456-789"
            />
          </div>
          <div className="set-field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="studio-address">Registered address</label>
            <input
              id="studio-address"
              className="set-input"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="12 Vulcan Lane, Auckland 1010, New Zealand"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-currency">Billing currency</label>
            <select
              id="studio-currency"
              className="set-input"
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="set-field">
            <label htmlFor="studio-invoice-prefix">Invoice number prefix</label>
            <input
              id="studio-invoice-prefix"
              className="set-input"
              value={invoicePrefix}
              onChange={(e) => setInvoicePrefix(e.target.value)}
              placeholder="INV-"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-invoice-channel">Default invoicing channel</label>
            <select
              id="studio-invoice-channel"
              className="set-input"
              value={invoiceChannel}
              onChange={(e) => setInvoiceChannel(e.target.value)}
              aria-describedby="studio-invoice-channel-help"
            >
              {INVOICE_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <small
              id="studio-invoice-channel-help"
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-faint)',
                font: '500 12px Manrope',
              }}
            >
              Used for any client without their own channel.
            </small>
          </div>
          <div className="set-field" style={{ gridColumn: '1 / -1' }}>
            <label htmlFor="studio-invoice-footer">Invoice footer note</label>
            <textarea
              id="studio-invoice-footer"
              className="set-input"
              style={{ height: 70, padding: '10px 12px', resize: 'vertical', lineHeight: 1.5 }}
              value={invoiceFooter}
              onChange={(e) => setInvoiceFooter(e.target.value)}
              placeholder="Thank you for working with Tahi Studio. Payment is due within 14 days."
            />
          </div>

          {/* ── Getting paid ────────────────────────────────────────────────
              A group rather than its own card, because it saves with the same
              button: a second Save halfway down the page is a second thing to
              forget. The bank details are what a client is SHOWN when their
              invoice has no pay link, which is where every Xero invoice starts,
              so a blank group here is a client holding a bill with nothing to
              act on. */}
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <h3
              style={{
                margin: 0,
                font: '600 13.5px Manrope, sans-serif',
                color: 'var(--text)',
              }}
            >
              Getting paid
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                font: '400 12.5px/1.5 Manrope, sans-serif',
                color: 'var(--text-muted)',
                maxWidth: '52ch',
              }}
            >
              Shown to a client when their invoice has no pay link yet, and used when you
              mark one paid by hand.
            </p>
          </div>

          <div className="set-field">
            <label htmlFor="studio-bank-name">Bank name</label>
            <input
              id="studio-bank-name"
              className="set-input"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="ANZ"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-account-name">Account name</label>
            <input
              id="studio-account-name"
              className="set-input"
              value={accountName}
              onChange={(e) => setAccountName(e.target.value)}
              placeholder="Tahi Studio Ltd"
            />
          </div>
          <div className="set-field">
            <label htmlFor="studio-account-number">Account number</label>
            <input
              id="studio-account-number"
              className="set-input"
              value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value)}
              placeholder="12-3456-7890123-00"
              // No inputMode. inputMode="numeric" opens the iOS digit keypad,
              // which has no dash and no space key, and the placeholder, the
              // hint below and the server validator all accept both: the studio
              // could only fill this field on a phone by pasting.
              aria-describedby="studio-account-number-help"
            />
            <small
              id="studio-account-number-help"
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-faint)',
                font: '500 12px Manrope',
              }}
            >
              Digits, dashes and spaces only.
            </small>
          </div>
          <div className="set-field">
            <label htmlFor="studio-reference-hint">Reference hint</label>
            <input
              id="studio-reference-hint"
              className="set-input"
              value={referenceHint}
              onChange={(e) => setReferenceHint(e.target.value)}
              placeholder="Please use the invoice number as the reference."
              aria-describedby="studio-reference-hint-help"
            />
            <small
              id="studio-reference-hint-help"
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-faint)',
                font: '500 12px Manrope',
              }}
            >
              The sentence under the bank details. Leave empty for the standard one.
            </small>
          </div>
          <div className="set-field">
            <label htmlFor="studio-xero-account-code">Xero payment account code</label>
            <input
              id="studio-xero-account-code"
              className="set-input"
              value={xeroAccountCode}
              onChange={(e) => setXeroAccountCode(e.target.value)}
              placeholder="090"
              aria-describedby="studio-xero-account-code-help"
            />
            <small
              id="studio-xero-account-code-help"
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-faint)',
                font: '500 12px Manrope',
              }}
            >
              The Xero bank account code payments are recorded against when you mark an
              invoice paid here. Leave empty to record payments in Xero yourself.
            </small>
          </div>
          <div className="set-field">
            <label htmlFor="studio-xero-email-mode">Xero invoice emails</label>
            <select
              id="studio-xero-email-mode"
              className="set-input"
              value={xeroEmailMode}
              onChange={(e) => setXeroEmailMode(e.target.value)}
              aria-describedby="studio-xero-email-mode-help"
            >
              {XERO_EMAIL_MODE_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
            <small
              id="studio-xero-email-mode-help"
              style={{
                display: 'block',
                marginTop: 5,
                color: 'var(--text-faint)',
                font: '500 12px Manrope',
              }}
            >
              Xero cannot email a draft, so we send ours instead until you approve it there.
            </small>
          </div>
        </div>
        <div
          className="set-row"
          style={{
            justifyContent: 'flex-end',
            gap: 14,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
          {saveError && (
            <span
              role="alert"
              style={{
                flex: 1,
                minWidth: 0,
                font: '500 12.5px/1.5 Manrope,sans-serif',
                color: 'var(--danger)',
              }}
            >
              {saveError}
            </span>
          )}
          {saved && (
            <span style={{ font: '500 12.5px Manrope,sans-serif', color: 'var(--brand-strong)' }}>
              Details saved
            </span>
          )}
          <button type="button" className="btn1" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save details'}
          </button>
        </div>
      </div>
      <p className="set-lede" style={{ marginTop: 12, marginBottom: 0 }}>
        Invoices pick these details up when they are generated - Xero-synced invoices keep
        Xero&apos;s own numbering.
      </p>
      <EmailDeliveryCard isAdmin={isAdmin} />
    </SectionShell>
  )
}
