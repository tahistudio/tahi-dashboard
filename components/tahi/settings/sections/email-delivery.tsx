'use client'

/**
 * EmailDeliveryCard - the studio-facing half of the email delivery allowlist.
 *
 * Liam, 2026-09-06: no real client and no teammate may receive any email from
 * this system until he has verified it himself. lib/email-delivery.ts enforces
 * that on the way out; this card is where the rule is read and changed, and it
 * lives in Studio details next to the other things that decide what a client
 * receives.
 *
 * Five controls and a log:
 *   - the mode. Switching it to "Everyone" is the one change here that can put
 *     mail in a stranger's inbox, so it goes through the design system
 *     <ConfirmDialog> with the consequence written out. Switching BACK is
 *     immediate: closing a gate never needs a confirmation.
 *   - the allowed domains, entered as a comma-separated list and stored as
 *     JSON. Validated with the same pure validator the API route runs
 *     (lib/email-allowlist.ts), so the form and the server cannot disagree.
 *   - the allowed addresses, exact mailboxes, which narrow the domain rule to
 *     named people. Default: business@tahi.studio and nobody else.
 *   - the never list, checked ahead of everything including "Everyone" mode.
 *   - the allowed organisation ids, the per-client exemption for a dummy or
 *     verified client on an outside domain, scoped to that client's contacts.
 *   - the suppression log: the last 100 addresses the gate held back, revealed
 *     by the link on the row, with a Clear button behind its own confirm
 *     (clearing destroys the only evidence a send was withheld).
 *
 * Every value comes from GET /api/admin/settings, which fills all five keys in
 * with their RESOLVED defaults, so an absent row reads as "Allowlist only,
 * business@tahi.studio" rather than as an empty box that looks like no
 * restriction.
 *
 * SAVING IS SUPER ADMIN unless the write closes the gate. The route enforces
 * that (see app/api/admin/settings), and a lesser seat gets the 403's sentence
 * in the error line rather than a silent no-op.
 */

import { useEffect, useState } from 'react'
import { MailWarning } from 'lucide-react'
import { useResource } from '@/lib/use-resource'
import { apiPath } from '@/lib/api'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import {
  ALLOWED_ADDRESSES_SETTING_KEY,
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  BLOCKED_ADDRESSES_SETTING_KEY,
  DEFAULT_DELIVERY_MODE,
  DELIVERY_MODE_SETTING_KEY,
  SUPPRESSION_REASON_BLOCKED,
  SUPPRESSION_REASON_NOT_ALLOWED,
  SUPPRESSION_REASON_UNPARSEABLE,
  resolveAllowedAddresses,
  resolveAllowedDomains,
  resolveAllowedOrgIds,
  resolveBlockedAddresses,
  resolveDeliveryMode,
  validateAllowedAddresses,
  validateAllowedDomains,
  validateAllowedOrgIds,
  validateBlockedAddresses,
  type DeliveryMode,
  type EmailSuppressionRow,
} from '@/lib/email-allowlist'

type SettingsMap = Record<string, string | null>

interface SuppressionsResponse {
  items: EmailSuppressionRow[]
  limit: number
  unavailable?: boolean
}

/**
 * The two modes in the words the person choosing needs, not the words the API
 * error message uses. "Everyone" is deliberately blunt.
 */
const MODE_OPTIONS: ReadonlyArray<{ value: DeliveryMode; label: string }> = [
  { value: 'allowlist', label: 'Allowlist only' },
  { value: 'all', label: 'Everyone (no allowlist)' },
]

/** A JSON array of strings, from a comma-separated box. '' clears the key. */
function listToJson(raw: string): string {
  const items = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '')
  return items.length === 0 ? '' : JSON.stringify(items)
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const date = new Intl.DateTimeFormat('en-NZ', { day: 'numeric', month: 'short' }).format(d)
  const time = new Intl.DateTimeFormat('en-NZ', { hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d)
    .replace(/\s/g, '')
    .toLowerCase()
  return `${date} ${time}`
}

/** A stored reason reads as a sentence, not as a database value. */
function reasonLabel(reason: string): string {
  if (reason === SUPPRESSION_REASON_NOT_ALLOWED) return 'Not on the allowlist'
  if (reason === SUPPRESSION_REASON_BLOCKED) return 'On the never list'
  if (reason === SUPPRESSION_REASON_UNPARSEABLE) return 'Not a single address'
  return reason.replace(/[._]/g, ' ')
}

export function EmailDeliveryCard({ isAdmin }: { isAdmin?: boolean } = {}) {
  const skip = isAdmin === false
  const { data, isLoading, mutate } = useResource<{ settings: SettingsMap }>(
    skip ? null : '/api/admin/settings',
  )

  const [mode, setMode] = useState<DeliveryMode>(DEFAULT_DELIVERY_MODE)
  const [domains, setDomains] = useState('')
  const [orgIds, setOrgIds] = useState('')
  const [addresses, setAddresses] = useState('')
  const [blocked, setBlocked] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)

  // The log is only fetched once someone opens it. It is evidence, not a
  // headline, and the card above it must render on a database that has not had
  // migration 0094 applied yet.
  const { data: log, isLoading: logLoading, mutate: mutateLog } =
    useResource<SuppressionsResponse>(skip || !logOpen ? null : '/api/admin/email-suppressions')

  useEffect(() => {
    if (!data?.settings) return
    setMode(resolveDeliveryMode(data.settings[DELIVERY_MODE_SETTING_KEY]))
    setDomains(resolveAllowedDomains(data.settings[ALLOWED_DOMAINS_SETTING_KEY]).join(', '))
    setOrgIds(resolveAllowedOrgIds(data.settings[ALLOWED_ORG_IDS_SETTING_KEY]).join(', '))
    setAddresses(resolveAllowedAddresses(data.settings[ALLOWED_ADDRESSES_SETTING_KEY]).join(', '))
    setBlocked(resolveBlockedAddresses(data.settings[BLOCKED_ADDRESSES_SETTING_KEY]).join(', '))
  }, [data])

  async function saveKey(key: string, value: string) {
    const res = await fetch(apiPath('/api/admin/settings'), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value }),
    })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `Could not save ${key}.`)
    }
  }

  /**
   * Save all three. The two lists are checked with the API's own validators
   * BEFORE anything is written, for the same reason the invoice pay keys are:
   * three parallel PATCHes mean a 400 on one lands after the others have
   * already stored, and the form would then show an error over a card that was
   * half saved.
   */
  async function persist(nextMode: DeliveryMode) {
    const domainsJson = listToJson(domains)
    const orgIdsJson = listToJson(orgIds)
    const addressesJson = listToJson(addresses)
    const blockedJson = listToJson(blocked)
    const preflight = [
      validateAllowedDomains(domainsJson),
      validateAllowedOrgIds(orgIdsJson),
      validateAllowedAddresses(addressesJson),
      validateBlockedAddresses(blockedJson),
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
        saveKey(DELIVERY_MODE_SETTING_KEY, nextMode),
        saveKey(ALLOWED_DOMAINS_SETTING_KEY, domainsJson),
        saveKey(ALLOWED_ORG_IDS_SETTING_KEY, orgIdsJson),
        saveKey(ALLOWED_ADDRESSES_SETTING_KEY, addressesJson),
        saveKey(BLOCKED_ADDRESSES_SETTING_KEY, blockedJson),
      ])
      setMode(nextMode)
      setSaved(true)
      await mutate()
      setTimeout(() => setSaved(false), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Could not save the delivery settings.')
    } finally {
      setSaving(false)
    }
  }

  function handleSave() {
    // Opening the gate is the only change that needs asking about. Closing it,
    // or editing the lists while it stays closed, does not.
    if (mode === 'all' && resolveDeliveryMode(data?.settings?.[DELIVERY_MODE_SETTING_KEY]) !== 'all') {
      setConfirmOpen(true)
      return
    }
    void persist(mode)
  }

  async function clearLog() {
    setClearError(null)
    const res = await fetch(apiPath('/api/admin/email-suppressions'), { method: 'DELETE' })
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string }
      setClearError(body.error ?? 'Could not clear the log.')
      return
    }
    await mutateLog()
  }

  if (skip) return null

  const storedMode = resolveDeliveryMode(data?.settings?.[DELIVERY_MODE_SETTING_KEY])
  const storedDomains = resolveAllowedDomains(data?.settings?.[ALLOWED_DOMAINS_SETTING_KEY])
  const storedAddresses = resolveAllowedAddresses(data?.settings?.[ALLOWED_ADDRESSES_SETTING_KEY])
  const storedBlocked = resolveBlockedAddresses(data?.settings?.[BLOCKED_ADDRESSES_SETTING_KEY])
  const items = log?.items ?? []

  return (
    <div className="set-card" style={{ marginTop: 16 }}>
      <div className="set-row">
        <div
          aria-hidden="true"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 34,
            height: 34,
            flexShrink: 0,
            // The leaf radius this page uses, same as .so-icon in settings.css.
            borderRadius: 'var(--radius-leaf-shell)',
            // --warn-bg and --danger are both defined for light and dark in
            // settings.css; there is no --danger-bg in this scope, and a
            // hardcoded red would not survive the dark theme.
            background: storedMode === 'all' ? 'var(--warn-bg)' : 'var(--brand-100)',
            color: storedMode === 'all' ? 'var(--danger)' : 'var(--brand-strong)',
          }}
        >
          <MailWarning size={17} />
        </div>
        <div className="sr-t">
          <b>Email delivery</b>
          <small>
            {isLoading
              ? 'Reading the current setting...'
              : storedMode === 'all'
                ? `Everyone. This system can email any address, including real clients. Only the never list still applies${storedBlocked.length > 0 ? ` (${storedBlocked.join(', ')})` : ''}.`
                : storedAddresses.length > 0
                  ? `Allowlist only. Mail goes to ${storedAddresses.join(', ')}, and to the contacts of any client you have exempted by id. Everything else is held back and logged.`
                  : `Allowlist only. Mail goes to ${storedDomains.join(', ')} and to the contacts of any client you have exempted by id. Everything else is held back and logged.`}
          </small>
        </div>
        <button
          type="button"
          className="btn2 sm"
          onClick={() => setLogOpen((v) => !v)}
          aria-expanded={logOpen}
          aria-controls="email-suppression-log"
        >
          {logOpen ? 'Hide held-back mail' : 'View held-back mail'}
        </button>
      </div>

      <div className="set-grid2">
        <div className="set-field">
          <label htmlFor="email-delivery-mode">Delivery mode</label>
          <select
            id="email-delivery-mode"
            className="set-input"
            value={mode}
            onChange={(e) => setMode(e.target.value as DeliveryMode)}
            aria-describedby="email-delivery-mode-help"
          >
            {MODE_OPTIONS.map((m) => (
              <option key={m.value} value={m.value}>
                {m.label}
              </option>
            ))}
          </select>
          <small
            id="email-delivery-mode-help"
            style={{
              display: 'block',
              marginTop: 5,
              color: 'var(--text-faint)',
              font: '500 12px Manrope',
            }}
          >
            Clearing this setting turns the allowlist on. The default is closed.
          </small>
        </div>

        <div className="set-field">
          <label htmlFor="email-allowed-domains">Allowed domains</label>
          <input
            id="email-allowed-domains"
            className="set-input"
            value={domains}
            onChange={(e) => setDomains(e.target.value)}
            placeholder="tahi.studio"
            aria-describedby="email-allowed-domains-help"
          />
          <small
            id="email-allowed-domains-help"
            style={{
              display: 'block',
              marginTop: 5,
              color: 'var(--text-faint)',
              font: '500 12px Manrope',
            }}
          >
            Comma separated, bare domains. A plus alias such as business+dummy@tahi.studio
            passes on its domain.
          </small>
        </div>

        <div className="set-field">
          <label htmlFor="email-allowed-addresses">Allowed addresses</label>
          <input
            id="email-allowed-addresses"
            className="set-input"
            value={addresses}
            onChange={(e) => setAddresses(e.target.value)}
            placeholder="business@tahi.studio"
            aria-describedby="email-allowed-addresses-help"
          />
          <small
            id="email-allowed-addresses-help"
            style={{
              display: 'block',
              marginTop: 5,
              color: 'var(--text-faint)',
              font: '500 12px Manrope',
            }}
          >
            Comma separated mailboxes. While this holds anything, an address must be on it
            AND on an allowed domain. Empty it to fall back to the domain list alone.
          </small>
        </div>

        <div className="set-field">
          <label htmlFor="email-blocked-addresses">Never email</label>
          <input
            id="email-blocked-addresses"
            className="set-input"
            value={blocked}
            onChange={(e) => setBlocked(e.target.value)}
            placeholder="staci@tahi.studio, nathan@tahi.studio"
            aria-describedby="email-blocked-addresses-help"
          />
          <small
            id="email-blocked-addresses-help"
            style={{
              display: 'block',
              marginTop: 5,
              color: 'var(--text-faint)',
              font: '500 12px Manrope',
            }}
          >
            Checked before every other rule, including Everyone mode. A plus alias of a
            listed mailbox is the same mailbox and is blocked too.
          </small>
        </div>

        <div className="set-field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="email-allowed-orgs">Exempt client ids</label>
          <input
            id="email-allowed-orgs"
            className="set-input"
            value={orgIds}
            onChange={(e) => setOrgIds(e.target.value)}
            placeholder="Leave empty until a client has been verified"
            aria-describedby="email-allowed-orgs-help"
          />
          <small
            id="email-allowed-orgs-help"
            style={{
              display: 'block',
              marginTop: 5,
              color: 'var(--text-faint)',
              font: '500 12px Manrope',
            }}
          >
            Comma separated organisation ids. Mail reaches THAT CLIENT&apos;S OWN CONTACTS
            whatever their domain, and nobody else: a cc to an outside address on the same
            send is still held back. Add an id only once you have checked what they will
            receive.
          </small>
        </div>
      </div>

      <div
        className="set-row"
        style={{ justifyContent: 'flex-end', gap: 14, borderTop: '1px solid var(--border-subtle)' }}
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
            Delivery saved
          </span>
        )}
        <button type="button" className="btn1" onClick={handleSave} disabled={saving || isLoading}>
          {saving ? 'Saving...' : 'Save delivery'}
        </button>
      </div>

      {logOpen && (
        <div id="email-suppression-log" style={{ padding: '0 18px 18px' }}>
          <div className="hist-wrap">
            <table className="hist">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Held back from</th>
                  <th>Which email</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {logLoading ? (
                  <tr>
                    <td colSpan={4} style={{ padding: '28px 14px', color: 'var(--text-faint)' }}>
                      Reading the log...
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      style={{ textAlign: 'center', padding: '28px 14px', color: 'var(--text-faint)' }}
                    >
                      {log?.unavailable
                        ? 'The suppression table is not on this database yet. Apply migration 0094.'
                        : 'Nothing has been held back.'}
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr key={r.id}>
                      <td className="h-when">{formatWhen(r.createdAt)}</td>
                      {/*
                        h-addr, not h-who. The audit log hides h-who under 768px
                        because there it is a redundant avatar; here the address
                        is the only reason the table exists, and hiding it left a
                        phone showing When / template / Why and nothing else.
                        .hist-wrap already scrolls at 760px, so the column has
                        somewhere to go.
                      */}
                      <td className="h-addr" style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12.5 }}>
                        {r.to}
                      </td>
                      <td className="h-change">
                        {r.template ?? 'unspecified'}
                        {r.subject && (
                          <span
                            style={{
                              display: 'block',
                              marginTop: 2,
                              font: '500 11px Manrope,sans-serif',
                              color: 'var(--text-faint)',
                              whiteSpace: 'normal',
                            }}
                          >
                            {r.subject}
                          </span>
                        )}
                      </td>
                      <td className="h-reason">{reasonLabel(r.reason)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div
              className="hist-foot"
              style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                {clearError ?? `Showing the last ${items.length} of up to ${log?.limit ?? 100} held-back recipients.`}
              </span>
              <button
                type="button"
                className="btn2 sm"
                onClick={() => setClearOpen(true)}
                disabled={items.length === 0}
              >
                Clear log
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Let this system email anyone?"
        description={
          'On "Everyone" the allowlist stops applying and every email this dashboard sends goes to its real recipient: clients, prospects, contract signers and teammates. Nothing is held back and nothing is logged as held back, except the addresses on the never list, which are still refused. Leave it on "Allowlist only" until you have checked what each of those people would receive.'
        }
        confirmLabel="Email everyone"
        variant="danger"
        onConfirm={async () => {
          setConfirmOpen(false)
          await persist('all')
        }}
        onCancel={() => {
          setConfirmOpen(false)
          setMode(storedMode)
        }}
      />

      <ConfirmDialog
        open={clearOpen}
        title="Clear the held-back log?"
        description="This is the only record that those emails were withheld. Once it is cleared there is no way to tell which recipients were held back or when. The delivery setting itself does not change."
        confirmLabel="Clear log"
        variant="danger"
        onConfirm={async () => {
          setClearOpen(false)
          await clearLog()
        }}
        onCancel={() => setClearOpen(false)}
      />
    </div>
  )
}
