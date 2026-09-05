'use client'

import { useEffect, useState } from 'react'
import { SectionShell } from '@/components/tahi/settings/primitives'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import {
  DEFAULT_INVOICE_CHANNEL,
  INVOICE_CHANNELS,
  INVOICE_CHANNEL_SETTING_KEY,
} from '@/lib/invoice-channel'

type SettingsMap = Record<string, string | null>

const CURRENCIES = ['NZD', 'USD', 'AUD', 'GBP', 'EUR']
const LEDE =
  'Legal name, address and tax details - shown on the invoices and contracts your clients receive.'

/**
 * Studio details (design: `function Studio(){...}` in settings-app.jsx).
 *
 * Legal name, GST number, registered address, billing currency, invoice
 * number prefix, default invoicing channel and invoice footer note.
 * Batch-saved to the settings K/V store (studio_legal_name,
 * studio_gst_number, studio_address, studio_billing_currency,
 * invoice_number_prefix, invoicing.defaultChannel, invoice_footer_note) via
 * PATCH /api/admin/settings, one call per key.
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
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

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
    }
  }, [data])

  async function saveKey(key: string, value: string) {
    const res = await fetch(apiPath('/api/admin/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (!res.ok) throw new Error('Failed to save ' + key)
  }

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await Promise.all([
        saveKey('studio_legal_name', legalName.trim()),
        saveKey('studio_gst_number', gstNumber.trim()),
        saveKey('studio_address', address.trim()),
        saveKey('studio_billing_currency', currency),
        saveKey('invoice_number_prefix', invoicePrefix.trim()),
        saveKey(INVOICE_CHANNEL_SETTING_KEY, invoiceChannel),
        saveKey('invoice_footer_note', invoiceFooter.trim()),
      ])
      setSaved(true)
      await mutate()
      setTimeout(() => setSaved(false), 3000)
    } catch {
      // Save failed; leave the form intact so the user can retry.
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
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
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
            >
              {INVOICE_CHANNELS.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
            <small
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
        </div>
        <div
          className="set-row"
          style={{
            justifyContent: 'flex-end',
            gap: 14,
            borderTop: '1px solid var(--border-subtle)',
          }}
        >
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
    </SectionShell>
  )
}
