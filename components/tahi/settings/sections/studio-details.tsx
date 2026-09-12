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
  BANK_ACCOUNT_FIELD_LABELS,
  BANK_DETAILS_BY_CURRENCY_SETTING_KEY,
  BANK_DETAILS_SETTING_KEY,
  CURRENCY_ACCOUNT_FIELDS,
  DEFAULT_XERO_EMAIL_MODE,
  INVOICE_CURRENCIES,
  XERO_EMAIL_MODE_SETTING_KEY,
  XERO_PAYMENT_ACCOUNT_CODE_SETTING_KEY,
  parseBankDetails,
  parseBankDetailsByCurrency,
  resolveXeroEmailMode,
  validateBankDetails,
  validateBankDetailsByCurrency,
  validateXeroEmailMode,
  validateXeroPaymentAccountCode,
  type BankAccountField,
  type InvoiceBankAccount,
  type InvoiceBankAccountsByCurrency,
  type InvoiceBankDetails,
  type InvoiceCurrency,
} from '@/lib/invoice-pay-settings'
import { SegmentedControl } from '@/components/tahi/segmented-control'

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
 * What each account field is FOR, in the words a bookkeeper filling in a
 * transfer form would use, plus an example of the shape.
 *
 * The labels themselves live in lib/invoice-pay-settings so the box here and
 * the row on the client's invoice cannot drift apart. These are the extra
 * sentences that only the person TYPING the account needs. Every example is a
 * made-up number: nothing in this file is the studio's real account.
 */
const ACCOUNT_FIELD_HELP: Partial<Record<BankAccountField, string>> = {
  accountNumber: 'Digits, dashes and spaces only.',
  iban: 'Letters, digits and spaces only.',
  achRouting: 'The 9-digit number for a domestic US transfer.',
  fedwireRouting: 'The 9-digit number for a US wire. Often different from the ACH one.',
  swift: 'Needed for an international transfer into this account.',
  location: 'The country the account is held in, as the sending bank asks for it.',
  referenceHint: 'The sentence under the details. Leave empty for the standard one.',
}

const ACCOUNT_FIELD_PLACEHOLDER: Partial<Record<BankAccountField, string>> = {
  bankName: 'Airwallex',
  accountName: 'Tahi Studio Ltd',
  accountNumber: '12-3456-7890123-00',
  iban: 'EE00 0000 0000 0000 0000',
  sortCode: '12-34-56',
  bsb: '123-456',
  bankCode: '12',
  branchCode: '3456',
  achRouting: '123456789',
  fedwireRouting: '123456789',
  swift: 'AAAABB0CXXX',
  referenceHint: 'Please use the invoice number as the reference.',
}

/** Where the account is held, per currency, as the tab's one-line caption. */
const CURRENCY_CAPTION: Record<InvoiceCurrency, string> = {
  NZD: 'New Zealand: account number, bank code and branch code.',
  GBP: 'United Kingdom: account number, sort code and SWIFT/BIC.',
  USD: 'United States: account number, ACH routing, Fedwire routing and SWIFT/BIC.',
  AUD: 'Australia: account number and BSB.',
  EUR: 'Estonia: IBAN and SWIFT/BIC.',
}

/** The fields that get a row of their own rather than half the grid. */
const FULL_WIDTH_FIELDS: readonly BankAccountField[] = ['location', 'iban', 'referenceHint']

/**
 * Is there somewhere to send the money? The same test the server applies: an
 * account with neither an account number nor an IBAN is rejected on save, so
 * the strip must not call it configured.
 */
function accountIsSet(account: InvoiceBankAccount | undefined): boolean {
  if (!account) return false
  return !!(account.accountNumber?.trim() || account.iban?.trim())
}

/**
 * Studio details (design: `function Studio(){...}` in settings-app.jsx).
 *
 * Legal name, GST number, registered address, billing currency, invoice
 * number prefix, default invoicing channel and invoice footer note, plus the
 * Getting paid group: the bank accounts a client is shown when there is no pay
 * link, the Xero bank account code a dashboard mark-paid records against, and
 * who emails a Xero-rail invoice.
 *
 * Getting paid is ONE ACCOUNT PER CURRENCY, behind a tab strip. The studio
 * invoices in NZD, GBP, USD, AUD and EUR and holds an Airwallex global account
 * for each, and those accounts do not share a field shape: New Zealand wants a
 * bank code and a branch code, the UK a sort code, the US an ACH routing
 * number AND a Fedwire one, Australia a BSB, the euro account an IBAN and no
 * account number at all. One shared set of boxes quoted a GBP client a New
 * Zealand account number, which their bank converts at its own rate or returns.
 * The old single account survives below the tabs as the default: it is the
 * fallback the resolver still reads for a currency with nothing entered, so it
 * has to stay editable or a stored value could never be corrected.
 *
 * Batch-saved to the settings K/V store (studio_legal_name,
 * studio_gst_number, studio_address, studio_billing_currency,
 * invoice_number_prefix, invoicing.defaultChannel, invoice_footer_note,
 * invoicing.bankDetails, invoicing.bankDetailsByCurrency,
 * invoicing.xeroPaymentAccountCode, invoicing.xeroEmailMode) via
 * PATCH /api/admin/settings, one call per key.
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
  // Getting paid: one account per currency, plus the single default account
  // kept for any currency that has no entry of its own.
  const [accounts, setAccounts] = useState<InvoiceBankAccountsByCurrency>({})
  const [currencyTab, setCurrencyTab] = useState<InvoiceCurrency>('NZD')
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
      // One blob, five accounts, and the same tolerance: a hand-edited row
      // that no longer parses reads as "nothing entered yet" rather than
      // throwing, because this form is also the repair tool.
      setAccounts(parseBankDetailsByCurrency(data.settings[BANK_DETAILS_BY_CURRENCY_SETTING_KEY]))
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

  /** Type one field of one currency's account. */
  function setAccountField(currency: InvoiceCurrency, field: BankAccountField, value: string) {
    setAccounts((prev) => {
      const account: InvoiceBankAccount = { ...prev[currency] }
      account[field] = value
      const next: InvoiceBankAccountsByCurrency = { ...prev }
      next[currency] = account
      return next
    })
  }

  /**
   * The per-currency blob, in the shape lib/invoice-pay-settings validates.
   *
   * Only the fields that currency's account actually HAS are written, so a
   * sort code left behind by a hand-edited row cannot ride along under the USD
   * account. Empty boxes are omitted for the same reason the single account
   * omits them: the client-facing block skips a missing field and would print
   * an empty labelled row for a blank one. Nothing anywhere saves the empty
   * value, which is the clear.
   */
  function bankAccountsValue(): string {
    const out: InvoiceBankAccountsByCurrency = {}
    for (const currency of INVOICE_CURRENCIES) {
      const draft = accounts[currency]
      if (!draft) continue
      const account: InvoiceBankAccount = {}
      for (const field of CURRENCY_ACCOUNT_FIELDS[currency]) {
        const value = draft[field]?.trim()
        if (value) account[field] = value
      }
      if (Object.keys(account).length > 0) out[currency] = account
    }
    return Object.keys(out).length === 0 ? '' : JSON.stringify(out)
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
    const accountsBlob = bankAccountsValue()
    const preflight = [
      validateBankDetails(bankBlob),
      validateBankDetailsByCurrency(accountsBlob),
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
        saveKey(BANK_DETAILS_BY_CURRENCY_SETTING_KEY, accountsBlob),
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
            {/* One box per field, in field order: the seven studio details,
                then the currency account on the first tab, then the default
                account and the two Xero ones. A skeleton shorter than the form
                it stands in for makes the card jump on load. */}
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
              mark one paid by hand. The How to pay block on a client invoice quotes the
              account matching that invoice&apos;s currency, and falls back to the default
              account below when the currency has nothing entered.
            </p>
          </div>

          {/* ── The five currency accounts ──────────────────────────────────
              One tab per currency the studio invoices in, because the studio
              holds one Airwallex global account per currency and each has a
              different field shape: a sort code under GBP, two routing numbers
              under USD, an IBAN and no account number at all under EUR. One
              shared set of boxes would either offer a client a number that
              means nothing on their rail, or quote a GBP bill a New Zealand
              account, which the bank converts at its own rate. */}
          <div style={{ gridColumn: '1 / -1' }}>
            <SegmentedControl<InvoiceCurrency>
              value={currencyTab}
              onChange={setCurrencyTab}
              options={INVOICE_CURRENCIES.map((code) => ({
                value: code,
                label: code,
                title: accountIsSet(accounts[code])
                  ? `${code}: account entered`
                  : `${code}: nothing entered yet`,
                panelId: 'studio-bank-panel',
              }))}
              ariaLabel="Currency to edit the bank account for"
              describedBy="studio-bank-currency-help"
              role="tablist"
              size="sm"
              fill
            />
            <p
              id="studio-bank-currency-help"
              className="set-field-note"
              style={{ margin: '0.375rem 0 0' }}
            >
              {CURRENCY_CAPTION[currencyTab]}{' '}
              {accountIsSet(accounts[currencyTab])
                ? 'Entered, so a ' + currencyTab + ' invoice quotes this account.'
                : 'Nothing entered yet, so a ' + currencyTab
                  + ' invoice falls back to the default account below.'}
            </p>
            {/* Which of the five are done, without making the person open
                each tab to find out. A currency counts as entered only when it
                names an account number or an IBAN, the same test the server
                applies on save. */}
            <p className="set-field-note" style={{ margin: '0.25rem 0 0' }}>
              Entered:{' '}
              {INVOICE_CURRENCIES.filter((code) => accountIsSet(accounts[code])).join(', ')
                || 'none yet'}
              . Still empty:{' '}
              {INVOICE_CURRENCIES.filter((code) => !accountIsSet(accounts[code])).join(', ')
                || 'none'}
              .
            </p>
          </div>

          <div
            id="studio-bank-panel"
            role="tabpanel"
            aria-label={`${currencyTab} account`}
            className="set-subgrid2"
            style={{ gridColumn: '1 / -1' }}
          >
            {CURRENCY_ACCOUNT_FIELDS[currencyTab].map((field) => {
              const inputId = `studio-bank-${currencyTab}-${field}`
              const help = ACCOUNT_FIELD_HELP[field]
              return (
                <div
                  key={field}
                  className="set-field"
                  style={FULL_WIDTH_FIELDS.includes(field) ? { gridColumn: '1 / -1' } : undefined}
                >
                  <label htmlFor={inputId}>{BANK_ACCOUNT_FIELD_LABELS[field]}</label>
                  <input
                    id={inputId}
                    className="set-input"
                    value={accounts[currencyTab]?.[field] ?? ''}
                    onChange={(e) => setAccountField(currencyTab, field, e.target.value)}
                    placeholder={ACCOUNT_FIELD_PLACEHOLDER[field]}
                    // No inputMode on the number fields. inputMode="numeric"
                    // opens the iOS digit keypad, which has no dash and no
                    // space key, and the placeholders and the server validator
                    // accept both: these boxes could only be filled on a phone
                    // by pasting.
                    aria-describedby={help ? `${inputId}-help` : undefined}
                  />
                  {help && (
                    <small id={`${inputId}-help`} className="set-field-note">
                      {help}
                    </small>
                  )}
                </div>
              )
            })}
          </div>

          {/* ── The default account ─────────────────────────────────────────
              The original single account, demoted to the fallback rather than
              deleted. It still holds a real account that is right for the
              currency it was typed in, and a client whose currency has no
              entry above is better served by it than by a How to pay block
              with nothing under the heading. It stays editable here because
              the resolver still reads it: removing the boxes would strand
              whatever is stored with no way to correct or clear it. */}
          <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
            <h3
              style={{
                margin: 0,
                font: '600 13.5px Manrope, sans-serif',
                color: 'var(--text)',
              }}
            >
              Default account
            </h3>
            <p
              style={{
                margin: '4px 0 0',
                font: '400 12.5px/1.5 Manrope, sans-serif',
                color: 'var(--text-muted)',
                maxWidth: '52ch',
              }}
            >
              Used for an invoice whose currency has no account above. Leave it empty once
              every currency you bill in is filled in.
            </p>
          </div>

          <div className="set-field">
            <label htmlFor="studio-bank-name">Bank name</label>
            <input
              id="studio-bank-name"
              className="set-input"
              value={bankName}
              onChange={(e) => setBankName(e.target.value)}
              placeholder="Airwallex"
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
            <small id="studio-account-number-help" className="set-field-note">
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
            <small id="studio-reference-hint-help" className="set-field-note">
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
