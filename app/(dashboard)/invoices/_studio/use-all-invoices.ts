'use client'

import useSWR from 'swr'
import { ApiError, swrFetcher } from '@/lib/swr-fetcher'
import type { StudioInvoice } from './invoice-views'

export const INVOICE_LEDGER_KEY = '/api/admin/invoices?status=all&allPages=1'
export const MAX_INVOICE_PAGES = 40
export interface InvoicePage { items: StudioInvoice[]; page: number; limit: number; scope?: string }
export interface InvoiceLedger {
  items: StudioInvoice[]
  complete: boolean
  scopeNone: boolean
  capped: boolean
  error: Error | null
}
type ReadPage = (path: string) => Promise<InvoicePage>

/** Each refresh starts at page one, including pages added or removed since the last read. */
export async function loadAllInvoices(read: ReadPage = swrFetcher, maxPages = MAX_INVOICE_PAGES): Promise<InvoiceLedger> {
  const items: StudioInvoice[] = []
  const ids = new Set<string>()
  try {
    for (let page = 1; page <= maxPages; page++) {
      const response = await read(`/api/admin/invoices?status=all&page=${page}`)
      if (!Array.isArray(response.items) || response.page !== page || response.limit !== 50 || response.items.length > response.limit) {
        throw new Error('The ledger returned an invalid page. Retry to read it again.')
      }
      if (response.scope === 'none') {
        if (page !== 1 || response.items.length !== 0) throw new Error('Client scope changed during the read. Retry the ledger.')
        return { items: [], complete: true, scopeNone: true, capped: false, error: null }
      }
      for (const item of response.items) {
        if (!item || typeof item.id !== 'string' || ids.has(item.id)) {
          throw new Error('The ledger changed while paging. Retry before using its totals.')
        }
        ids.add(item.id)
        items.push(item)
      }
      if (response.items.length < response.limit) return { items, complete: true, scopeNone: false, capped: false, error: null }
    }
    return { items, complete: false, scopeNone: false, capped: true, error: null }
  } catch (error) {
    return {
      // A denial on any page removes cached business data from this read.
      items: error instanceof ApiError && error.status === 403 ? [] : items,
      complete: false, scopeNone: false, capped: false,
      error: error instanceof Error ? error : new Error('The ledger could not load.'),
    }
  }
}
export function useAllInvoices() {
  const { data, isLoading, isValidating, error, mutate } = useSWR<InvoiceLedger>(INVOICE_LEDGER_KEY, () => loadAllInvoices())
  const loading = isLoading || isValidating
  return {
    items: data?.items ?? [], loading, error: data?.error ?? error as Error | undefined,
    scopeNone: data?.scopeNone ?? false, capped: data?.capped ?? false,
    complete: !!data?.complete && !loading && !error,
    // The aggregate fetcher deliberately has no page cache to leave stale after an import.
    mutate,
  }
}
