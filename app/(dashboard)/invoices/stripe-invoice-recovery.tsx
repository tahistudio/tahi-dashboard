'use client'

import { useEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Select } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { apiPath } from '@/lib/api'
import { formatCurrency } from '@/lib/currency'
import { usePermissions } from '@/components/tahi/permissions-context'

interface RecoveryPreview {
  previewKey: string
  canApply: boolean
  conflicts: string[]
  client: { name: string }
  invoice: { number: string | null; customerEmail: string | null; total: number; currency: string; paidAt: string | null }
  existingInvoiceId: string | null
  result?: { localInvoiceId: string }
  error?: string
}

export function StripeInvoiceRecovery({ onImported }: { onImported: () => void }) {
  const { isSuperAdmin } = usePermissions()
  const [open, setOpen] = useState(false)
  const [orgId, setOrgId] = useState('')
  const [invoiceId, setInvoiceId] = useState('')
  const [preview, setPreview] = useState<RecoveryPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [recoveredId, setRecoveredId] = useState('')
  const resultRef = useRef<HTMLDivElement>(null)
  useEffect(() => { if (preview) resultRef.current?.focus() }, [preview])
  const { data, error: clientError, isLoading, mutate: retryClients } = useSWR(open ? '/api/admin/clients/recovery-options' : null, async () => {
    const clients: Array<{ id: string; name: string }> = []
    for (let page = 1; ; page++) {
      const res = await fetch(apiPath(`/api/admin/clients?page=${page}`))
      if (!res.ok) throw new Error('Clients could not load.')
      const result = await res.json() as { organisations: Array<{ id: string; name: string }>; limit: number }
      clients.push(...result.organisations)
      if (result.organisations.length < result.limit) return clients
    }
  })
  const recover = async (dryRun: boolean) => {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(apiPath('/api/admin/integrations/stripe/recover-invoice'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, stripeInvoiceId: invoiceId.trim(), dryRun, previewKey: preview?.previewKey }),
      })
      const result = await res.json() as RecoveryPreview
      if (!res.ok) throw new Error(result.error ?? 'Recovery failed. Preview again before retrying.')
      setPreview(result)
      if (result.result) {
        setRecoveredId(result.result.localInvoiceId)
        onImported()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Recovery failed.')
      if (!dryRun) setPreview(null)
    } finally { setBusy(false) }
  }
  const resetPreview = () => { setPreview(null); setError(''); setRecoveredId('') }
  if (!isSuperAdmin) return null
  return <>
    <TahiButton variant="secondary" size="sm" style={{ minHeight: '2.75rem' }} onClick={() => setOpen(true)}>Recover paid Stripe invoice</TahiButton>
    <SlideOver open={open} onClose={() => { if (!busy) setOpen(false) }} title="Recover a paid Stripe invoice" subtitle="Match a paid live invoice to an existing client.">
      <SlideOver.Body>
        <div className="flex flex-col gap-5">
          <p className="text-sm text-[var(--text-muted)]">Preview the customer and duplicate checks, then import. This sends no email and makes no changes in Stripe.</p>
          <label className="flex min-w-0 flex-col gap-2 text-sm">Client
            <Select className="min-w-0 w-full" style={{ width: '100%', minWidth: 0, height: '2.75rem' }} value={orgId} disabled={busy || isLoading} onChange={e => { setOrgId(e.target.value); resetPreview() }} options={[
              { value: '', label: isLoading ? 'Loading clients...' : 'Choose an existing client' },
              ...(data?.map(org => ({ value: org.id, label: org.name })) ?? []),
            ]} />
          </label>
          {clientError && <div><p role="alert" className="text-sm text-[var(--color-danger-ink)]">Clients could not load.</p><TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} onClick={() => retryClients()}>Retry loading clients</TahiButton></div>}
          <label className="flex flex-col gap-2 text-sm">Stripe invoice id
            <Input style={{ minWidth: 0, height: '2.75rem' }} value={invoiceId} disabled={busy} placeholder="in_..." onChange={e => { setInvoiceId(e.target.value); resetPreview() }} />
          </label>
          {error && <p role="alert" className="text-sm text-[var(--color-danger-ink)]">{error}</p>}
          {preview && <div ref={resultRef} tabIndex={-1} role="status" aria-live="polite" className="rounded-xl border border-[var(--color-border)] p-4 text-sm flex flex-col gap-3 break-words min-w-0" style={{ overflowWrap: 'anywhere' }}>
            <strong data-private>{preview.invoice.number ?? invoiceId} for {preview.client.name}</strong>
            <span data-private>{formatCurrency(preview.invoice.total, preview.invoice.currency)}, paid</span>
            <span data-private>{preview.invoice.customerEmail}</span>
            <span>{preview.invoice.paidAt ? `Paid ${new Date(preview.invoice.paidAt).toLocaleString('en-NZ', { timeZone: 'Pacific/Auckland' })}` : 'Stripe has not supplied a paid date.'}</span>
            {preview.conflicts.map(conflict => <p key={conflict} role="alert" className="text-[var(--color-danger-ink)]">{conflict}</p>)}
            {preview.canApply && !recoveredId && <p>Identity matches. {preview.existingInvoiceId ? 'The existing invoice will be refreshed.' : 'A paid invoice will be added to this client.'}</p>}
            {recoveredId && <a className="underline min-h-11 flex items-center" href={`/invoices/${recoveredId}`}>Recovered. Open invoice</a>}
          </div>}
        </div>
      </SlideOver.Body>
      <SlideOver.Footer>
        <TahiButton variant="secondary" style={{ minHeight: '2.75rem' }} disabled={busy} onClick={() => setOpen(false)}>Close</TahiButton>
        {!recoveredId && <TahiButton style={{ minHeight: '2.75rem' }} disabled={busy || !orgId || !invoiceId.trim() || !!clientError || (preview !== null && !preview.canApply)} onClick={() => recover(preview === null)}>
          {busy ? preview ? 'Importing...' : 'Checking...' : preview ? 'Import paid invoice' : 'Preview recovery'}
        </TahiButton>}
      </SlideOver.Footer>
    </SlideOver>
  </>
}
