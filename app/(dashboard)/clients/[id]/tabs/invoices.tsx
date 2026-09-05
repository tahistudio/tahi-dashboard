'use client'

/**
 * The client Invoices tab: four numbers the studio actually asks about, the
 * rail this client is billed on, then the invoices themselves with the
 * actions each row's state allows.
 *
 * "New invoice" hands off to /invoices rather than opening a second create
 * form here. The invoice slide-over lives inside invoice-list.tsx and is not
 * exported, and this slice does not own app/(dashboard)/invoices, so building
 * a duplicate here would fork the create path. The link carries ?new=1&orgId=
 * so the invoices page can pick this client up when it learns to read them.
 */

import { useMemo, useState } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import {
  ArrowUpRight,
  Ban,
  Check,
  DollarSign,
  Mail,
  Plus,
  Send,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableAction, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { Money } from '@/components/tahi/money'
import { StatusBadge } from '@/components/tahi/status-badge'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import { invoiceChannelLabel } from '@/lib/invoice-channel'
import { paymentTermsLabel } from '@/lib/invoice-billing'
import { Grow, InlineAction, SubBar, Tile, TileGrid } from '../_kit/chrome'
import type { ClientTabId, Organisation } from '../_kit/types'

export interface InvoiceRow {
  id: string
  orgId: string
  orgName: string | null
  status: string
  totalAmount: number
  currency: string | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
}

const OPEN_STATUSES = ['sent', 'viewed', 'overdue']

function formatTabDate(dateStr: string | null): string {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Sent, unpaid, and past its due date: overdue even if nobody flipped the flag. */
function isOverdue(r: InvoiceRow, now: Date): boolean {
  if (r.status === 'overdue') return true
  if (r.status !== 'sent' && r.status !== 'viewed') return false
  if (!r.dueDate) return false
  const due = new Date(r.dueDate)
  return !Number.isNaN(due.getTime()) && due < now
}

export function InvoicesTab({
  clientId,
  org,
  canMoney,
  writeDisabled,
  onTab,
}: {
  clientId: string
  org: Organisation
  canMoney: boolean
  writeDisabled: boolean
  onTab: (tab: ClientTabId) => void
}) {
  const router = useRouter()
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  const { data, isLoading: loading, mutate: reload } = useSWR<{ items: InvoiceRow[] }>(
    `/api/admin/invoices?orgId=${clientId}`,
  )
  const invoices = useMemo(() => data?.items ?? [], [data])

  const now = new Date()
  const open = invoices.filter(r => OPEN_STATUSES.includes(r.status))
  const overdue = invoices.filter(r => isOverdue(r, now))
  const paid = invoices.filter(r => r.status === 'paid')

  const sum = (rows: InvoiceRow[]) => rows.reduce((s, r) => s + (r.totalAmount ?? 0), 0)
  const channelLabel = invoiceChannelLabel(org.effectiveInvoiceChannel ?? org.invoiceChannel)

  async function patchInvoice(id: string, body: Record<string, unknown>, done: string) {
    setBusyId(id)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        showToast(json?.error ?? 'That did not save. Please try again.', 'error')
        return
      }
      showToast(done, 'success')
      await reload()
    } catch {
      showToast('That did not save. Please try again.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  async function sendEmail(id: string, done: string) {
    setBusyId(id)
    try {
      const res = await fetch(apiPath(`/api/admin/invoices/${id}/send-email`), { method: 'POST' })
      const json = await res.json().catch(() => null) as { error?: string } | null
      if (!res.ok) {
        showToast(json?.error ?? 'The email did not send.', 'error')
        return
      }
      showToast(done, 'success')
      await reload()
    } catch {
      showToast('The email did not send.', 'error')
    } finally {
      setBusyId(null)
    }
  }

  function actionsFor(r: InvoiceRow): DataTableAction[] {
    const out: DataTableAction[] = [
      {
        label: 'Open invoice',
        icon: <ArrowUpRight className="w-3.5 h-3.5" />,
        onClick: () => router.push(`/invoices/${r.id}`),
      },
    ]
    if (writeDisabled) return out
    const busy = busyId === r.id
    if (r.status === 'draft') {
      out.push({
        label: `Send via ${channelLabel}`,
        icon: <Send className="w-3.5 h-3.5" />,
        disabled: busy,
        onClick: () => { void sendEmail(r.id, `Invoice sent via ${channelLabel}`) },
      })
    }
    if (r.status === 'sent' || r.status === 'viewed' || r.status === 'overdue') {
      out.push({
        label: isOverdue(r, now) ? 'Send overdue reminder' : 'Send reminder',
        icon: <Mail className="w-3.5 h-3.5" />,
        disabled: busy,
        onClick: () => { void sendEmail(r.id, 'Reminder sent') },
      })
      out.push({
        label: 'Mark paid',
        icon: <Check className="w-3.5 h-3.5" />,
        disabled: busy,
        onClick: () => { void patchInvoice(r.id, { status: 'paid', paidAt: new Date().toISOString() }, 'Marked paid') },
      })
    }
    if (r.status !== 'paid' && r.status !== 'written_off') {
      out.push({
        label: 'Write off',
        icon: <Ban className="w-3.5 h-3.5" />,
        tone: 'danger',
        disabled: busy,
        onClick: () => { void patchInvoice(r.id, { status: 'written_off' }, 'Written off') },
      })
    }
    return out
  }

  const columns: DataTableColumn<InvoiceRow>[] = [
    {
      key: 'status',
      header: 'Status',
      width: '8rem',
      render: r => <StatusBadge status={isOverdue(r, now) ? 'overdue' : r.status} type="invoice" />,
    },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      width: '10rem',
      sortable: true,
      sortValue: r => r.totalAmount ?? 0,
      render: r => (
        <Money
          native={r.totalAmount ?? 0}
          currency={r.currency ?? 'NZD'}
          sensitive
          style={{ fontWeight: 600, color: 'var(--color-text)' }}
        />
      ),
    },
    {
      key: 'dueDate',
      header: 'Due',
      muted: true,
      sortable: true,
      sortValue: r => r.dueDate ?? '',
      render: r => (
        <span style={{ color: isOverdue(r, now) ? 'var(--color-danger)' : undefined, fontWeight: isOverdue(r, now) ? 600 : undefined }}>
          {formatTabDate(r.dueDate)}
        </span>
      ),
    },
    {
      key: 'createdAt',
      header: 'Raised',
      muted: true,
      sortable: true,
      sortValue: r => r.createdAt,
      render: r => formatTabDate(r.createdAt),
    },
  ]

  if (!canMoney) {
    return (
      <EmptyState
        variant="inline"
        icon={<DollarSign className="w-8 h-8" />}
        title="Invoices are not visible to you"
        description="Ask an owner to turn on the billing card permission if you need to see what this client is billed."
      />
    )
  }

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <TileGrid>
        <Tile
          label="Outstanding"
          value={<Money native={sum(open)} currency={org.preferredCurrency ?? 'NZD'} sensitive />}
          hint={`${open.length} open`}
        />
        <Tile
          label="Overdue"
          tone={overdue.length > 0 ? 'danger' : 'neutral'}
          value={<Money native={sum(overdue)} currency={org.preferredCurrency ?? 'NZD'} sensitive />}
          hint={overdue.length > 0 ? `${overdue.length} ${overdue.length === 1 ? 'invoice' : 'invoices'}` : 'Nothing overdue'}
        />
        <Tile
          label="Paid"
          tone={paid.length > 0 ? 'positive' : 'neutral'}
          value={<Money native={sum(paid)} currency={org.preferredCurrency ?? 'NZD'} sensitive />}
          hint={`${paid.length} settled`}
        />
        <Tile
          label="Terms"
          value={org.paymentTerms ? paymentTermsLabel(org.paymentTerms) : 'Not set'}
          hint={`Raised in ${channelLabel}`}
        />
      </TileGrid>

      <SubBar>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.375rem',
            height: '1.375rem',
            padding: '0 0.5rem',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--color-border-subtle)',
            background: 'var(--color-bg)',
            color: 'var(--color-text-muted)',
            fontSize: '0.6875rem',
            fontWeight: 600,
          }}
        >
          {channelLabel}
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)' }}>
          {org.invoiceChannel ? 'set for this client' : 'the studio default'}
        </span>
        <Grow />
        <InlineAction onClick={() => onTab('settings')}>Billing settings</InlineAction>
        <TahiButton
          variant="primary"
          size="sm"
          disabled={writeDisabled}
          onClick={() => router.push(`/invoices?new=1&orgId=${clientId}`)}
          iconLeft={<Plus className="w-3.5 h-3.5" />}
        >
          New invoice
        </TahiButton>
      </SubBar>

      <Card padding="none">
        <DataTable<InvoiceRow>
          ariaLabel="Invoices"
          columns={columns}
          rows={invoices}
          getRowId={r => r.id}
          loading={loading}
          onRowClick={r => router.push(`/invoices/${r.id}`)}
          rowActions={actionsFor}
          mobileCard={r => (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', padding: '0.75rem' }}>
              <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                <StatusBadge status={isOverdue(r, now) ? 'overdue' : r.status} type="invoice" />
                <Money
                  native={r.totalAmount ?? 0}
                  currency={r.currency ?? 'NZD'}
                  sensitive
                  style={{ marginLeft: 'auto', fontWeight: 700, color: 'var(--color-text)' }}
                />
              </div>
              <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                Raised {formatTabDate(r.createdAt)}, due {formatTabDate(r.dueDate)}
              </span>
              <div className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                <TahiButton variant="secondary" size="sm" onClick={() => router.push(`/invoices/${r.id}`)}>
                  Open
                </TahiButton>
                {!writeDisabled && (r.status === 'sent' || r.status === 'viewed' || r.status === 'overdue') && (
                  <>
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => { void sendEmail(r.id, 'Reminder sent') }}
                    >
                      Remind
                    </TahiButton>
                    <TahiButton
                      variant="secondary"
                      size="sm"
                      disabled={busyId === r.id}
                      onClick={() => { void patchInvoice(r.id, { status: 'paid', paidAt: new Date().toISOString() }, 'Marked paid') }}
                    >
                      Mark paid
                    </TahiButton>
                  </>
                )}
              </div>
            </div>
          )}
          empty={
            <EmptyState
              variant="inline"
              icon={<DollarSign className="w-8 h-8" />}
              title="No invoices for this client yet"
              description={`Nothing has been billed to ${org.name}. Raise the first one on the invoices page.`}
              ctaLabel={writeDisabled ? undefined : 'New invoice'}
              onCtaClick={writeDisabled ? undefined : () => router.push(`/invoices?new=1&orgId=${clientId}`)}
            />
          }
        />
      </Card>
    </div>
  )
}
