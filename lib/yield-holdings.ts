import { eq, like } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { YIELD_HOLDINGS_KEY } from '@/lib/yield-history'
import { callXeroAPIOrThrow } from '@/lib/xero'

type D1 = ReturnType<typeof import('drizzle-orm/d1').drizzle>

const DAY_MS = 86_400_000
const MAX_AGE_DAYS = 30
const YIELD_READ_TIMEOUT_MS = 15_000
export const YIELD_ACCOUNT_IDS_KEY = 'finance.yieldAccountIds'

type YieldCurrency = 'USD' | 'AUD'
type YieldAccountIds = Partial<Record<YieldCurrency, string>>

export interface YieldHolding {
  currency: string
  amount: number
  sourceAccountId: string
  sourceAccountCurrency: 'USD' | 'AUD'
}

export type YieldReadResult =
  | { ok: true; holdings: YieldHolding[]; currencyBasis: string }
  | { ok: false; warning: string }

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function nameKey(value: unknown): string {
  return typeof value === 'string' ? value.trim().toUpperCase().replace(/[ _]+/g, '_') : ''
}

function unreadable(reason: string): YieldReadResult {
  return { ok: false, warning: `Xero AWX Yield accounts could not be refreshed: ${reason}. Saved yield holdings were retained.` }
}

/** Optional pins replace name matching, while account status, type and currency remain mandatory. */
function accountIdsOverride(value: unknown): YieldAccountIds | null {
  if (value === undefined) return {}
  const ids = record(value)
  if (!ids || Object.keys(ids).some(key => key !== 'USD' && key !== 'AUD')) return null
  const result: YieldAccountIds = {}
  for (const currency of ['USD', 'AUD'] as const) {
    if (!(currency in ids)) continue
    const id = ids[currency]
    if (typeof id !== 'string' || !id.trim() || id !== id.trim()) return null
    result[currency] = id
  }
  if (result.USD && result.USD === result.AUD) return null
  return result
}

/**
 * BankSummary's closing balances are in the organisation's BASE currency,
 * even for USD/AUD bank accounts. Keep that currency on the saved amount:
 * never relabel a revalued NZD figure as USD or reverse it with today's FX.
 * Admit the currency-specific yield suffix or an explicitly pinned ID. A partial or
 * ambiguous response must not clear a real holding or refresh its age.
 */
export function parseXeroYieldHoldings(accountsData: unknown, organisationData: unknown, reportData: unknown, pinnedAccountIds?: unknown): YieldReadResult {
  const overrides = accountIdsOverride(pinnedAccountIds)
  if (!overrides) return unreadable('the yield account ID override is invalid')
  const organisations = record(organisationData)?.Organisations
  const baseCurrency = Array.isArray(organisations) && organisations.length === 1
    ? record(organisations[0])?.BaseCurrency
    : null
  if (typeof baseCurrency !== 'string' || !/^[A-Z]{3}$/.test(baseCurrency)) {
    return unreadable('the report base currency is unavailable')
  }
  const accounts = record(accountsData)?.Accounts
  if (!Array.isArray(accounts)) return unreadable('the account list is unavailable')
  const selected: Array<{ id: string; name: string; currency: 'USD' | 'AUD' }> = []
  for (const currency of ['USD', 'AUD'] as const) {
    const pinnedId = overrides[currency]
    const matches = accounts.map(record).filter(a => a?.Status === 'ACTIVE'
      && a.Type === 'BANK' && a.CurrencyCode === currency
      && (pinnedId === undefined || a.AccountID === pinnedId)
      // A pin narrows the choice but never admits a non-yield account.
      && new RegExp(`(^|_)YIELD_${currency}$`).test(nameKey(a.Name)))
    const account = matches[0]
    if (matches.length !== 1 || !account || typeof account.AccountID !== 'string' || !account.AccountID
      || account.CurrencyCode !== currency || typeof account.Name !== 'string') {
      return unreadable(`the ${currency} yield account is missing or ambiguous`)
    }
    selected.push({ id: account.AccountID, name: account.Name, currency })
  }
  if (selected[0].id === selected[1].id) return unreadable('the yield account identities conflict')

  const reports = record(reportData)?.Reports
  const report = Array.isArray(reports) && reports.length === 1 ? record(reports[0]) : null
  const rows = report?.Rows
  if (!Array.isArray(rows)) return unreadable('the bank summary is unavailable')
  const headers = rows.map(record).filter(row => row?.RowType === 'Header')
  const headerCells = headers.length === 1 ? headers[0]?.Cells : null
  if (!Array.isArray(headerCells)) return unreadable('the closing balance column is unavailable')
  const closingIndexes = headerCells.flatMap((cell, index) => {
    const label = record(cell)?.Value
    if (typeof label !== 'string') return []
    const normalized = label.trim().toLowerCase().replace(/\s+/g, ' ')
    return normalized === 'closing balance' || normalized === `closing balance (${baseCurrency.toLowerCase()})`
      ? [index]
      : []
  })
  if (closingIndexes.length !== 1) return unreadable('the closing balance column is ambiguous')
  const closingIndex = closingIndexes[0]
  const reportRows: Record<string, unknown>[] = []
  function visit(values: unknown[]) {
    for (const value of values) {
      const row = record(value)
      if (!row) continue
      if (row.RowType === 'Row') reportRows.push(row)
      if (Array.isArray(row.Rows)) visit(row.Rows)
    }
  }
  visit(rows)

  const holdings: YieldHolding[] = []
  for (const account of selected) {
    const matches = reportRows.filter(row => {
      const cells = row.Cells
      if (!Array.isArray(cells)) return false
      const nameCell = record(cells[0])
      const attributes = nameCell?.Attributes
      const identities = Array.isArray(attributes)
        ? attributes.map(record).filter(a => typeof a?.Id === 'string' && ['account', 'accountid'].includes(a.Id.toLowerCase()))
        : []
      if (identities.length > 0) return identities.length === 1 && identities[0]?.Value === account.id
      return nameKey(nameCell?.Value) === nameKey(account.name)
    })
    if (matches.length !== 1) return unreadable(`the ${account.currency} closing balance is missing or ambiguous`)
    const cells = matches[0].Cells
    const amountValue = Array.isArray(cells) ? record(cells[closingIndex])?.Value : null
    if (typeof amountValue !== 'string'
      || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(amountValue.trim())) {
      return unreadable(`the ${account.currency} closing balance is invalid`)
    }
    const amount = Number(amountValue.replace(/,/g, ''))
    if (!Number.isFinite(amount)) return unreadable(`the ${account.currency} closing balance is invalid`)
    holdings.push({ currency: baseCurrency, amount, sourceAccountId: account.id, sourceAccountCurrency: account.currency })
  }
  return { ok: true, holdings, currencyBasis: baseCurrency }
}

/** Read through the existing Xero client. The sync materialises both accounts before saving their timestamp. */
export async function readXeroYieldHoldings(nowIso: string, accountIdsSetting?: string | null): Promise<YieldReadResult> {
  let pinnedAccountIds: unknown
  try {
    pinnedAccountIds = accountIdsSetting === undefined ? undefined : JSON.parse(accountIdsSetting ?? 'null') as unknown
  } catch {
    return unreadable('the yield account ID override is invalid')
  }
  if (!accountIdsOverride(pinnedAccountIds)) return unreadable('the yield account ID override is invalid')
  const controller = new AbortController()
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const reason = new DOMException('Xero yield read timed out', 'TimeoutError')
      controller.abort(reason)
      reject(reason)
    }, YIELD_READ_TIMEOUT_MS)
  })
  const checkDeadline = () => {
    if (controller.signal.aborted) throw controller.signal.reason
  }
  try {
    // Sequential requests avoid racing the shared client's token refresh.
    // The total deadline also bounds database waits in token acquisition.
    const read = async () => {
      const options = { signal: controller.signal }
      const accounts = await callXeroAPIOrThrow<unknown>('GET', '/Accounts?where=Type%3D%3D%22BANK%22', undefined, options)
      checkDeadline()
      const organisation = await callXeroAPIOrThrow<unknown>('GET', '/Organisation', undefined, options)
      checkDeadline()
      const report = await callXeroAPIOrThrow<unknown>('GET', `/Reports/BankSummary?fromDate=${nowIso.slice(0, 7)}-01&toDate=${nowIso.slice(0, 10)}`, undefined, options)
      checkDeadline()
      return parseXeroYieldHoldings(accounts, organisation, report, pinnedAccountIds)
    }
    return await Promise.race([read(), deadline])
  } catch {
    return unreadable(controller.signal.aborted ? 'the Xero read timed out' : 'the Xero read failed')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

export interface YieldFreshness {
  updatedAt: string | null
  ageDays: number | null
  stale: boolean
  warning: string | null
}

/** Wallet sync timestamps never establish that a yield holding was re-read. */
export function yieldFreshness(updatedAt: string | null, hasHoldings: boolean, now = new Date()): YieldFreshness {
  const timestamp = updatedAt ? Date.parse(updatedAt) : Number.NaN
  const known = Number.isFinite(timestamp) && timestamp <= now.getTime()
  const ageDays = known ? Math.floor((now.getTime() - timestamp) / DAY_MS) : null
  const stale = hasHoldings && (!known || now.getTime() - timestamp > MAX_AGE_DAYS * DAY_MS)
  const warning = stale
    ? ageDays === null
      ? 'Yield balance freshness is unknown. Cash may be out of date. Sync Airwallex to refresh the Xero AWX Yield accounts.'
      : `Yield balances were last refreshed ${ageDays} days ago. Cash may be out of date. Sync Airwallex to refresh the Xero AWX Yield accounts.`
    : null
  return { updatedAt: known ? updatedAt : null, ageDays, stale, warning }
}

export async function readYieldFreshness(database: D1, now = new Date()): Promise<YieldFreshness> {
  try {
    const [setting] = await database.select({ value: schema.settings.value, updatedAt: schema.settings.updatedAt })
      .from(schema.settings).where(eq(schema.settings.key, YIELD_HOLDINGS_KEY)).limit(1)
    const rows = await database.select({ balance: schema.airwallexBalances.balance })
      .from(schema.airwallexBalances).where(like(schema.airwallexBalances.accountId, 'yield:%'))
    // A recorded setting remains worth checking even if its materialised rows
    // are missing or zero. A missing setting with no rows means no yield data.
    return yieldFreshness(setting?.updatedAt ?? null, Boolean(setting) || rows.length > 0, now)
  } catch {
    return yieldFreshness(null, true, now)
  }
}
