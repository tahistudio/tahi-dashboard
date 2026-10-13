'use client'

import Link from 'next/link'

export interface XeroSyncResult {
  success?: boolean
  failed?: number
  error?: string
  message?: string
  results?: { invoiceId: string; status: string; error?: string; message?: string }[]
}

export function xeroSyncError(result: XeroSyncResult, responseOk: boolean): string | null {
  const failedInvoice = result.results?.find(invoice => invoice.status === 'error')
  if (failedInvoice || (result.failed ?? 0) > 0 || result.success === false || !responseOk) {
    return failedInvoice?.error || failedInvoice?.message || result.error || result.message || 'Xero sync failed. Check the client billing link and Xero connection.'
  }
  return null
}

export function ClientBillingLink({ orgId }: { orgId: string }) {
  return (
    <Link
      href={`/clients/${encodeURIComponent(orgId)}?tab=money`}
      className="tahi-focus-ring inline-flex items-center hover:underline"
      style={{ minHeight: '2.75rem', color: 'var(--color-link)', fontWeight: 600, borderRadius: 'var(--radius-sm)' }}
    >
      Open client billing
    </Link>
  )
}
