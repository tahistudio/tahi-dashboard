'use client'

/**
 * The client Papers tab: the proposals, contracts and delivery schedules that
 * belong to this client, each with its state and the way in.
 *
 * Three fixes over the old Contracts tab, which read fields the route does not
 * return:
 *   - the expiry column read `expiryDate`; the route returns `expiresAt`, so
 *     every contract said "--" no matter when it lapsed;
 *   - the Download link read `storageKey`, which is not on this response, so
 *     it pointed at /api/uploads/serve/undefined;
 *   - proposals and schedules exist for this client and were never shown.
 * Rows now open the real /contracts/[id], /proposals/[id] and /schedules/[id]
 * pages, which own the document and its actions.
 */

import { useMemo } from 'react'
import useSWR from 'swr'
import { useRouter } from 'next/navigation'
import { CalendarRange, FileSignature, Handshake, ScrollText } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { DataTable, type DataTableColumn } from '@/components/tahi/data-table'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import { CountText, Grow, SectionTitle, SubBar } from '../_kit/chrome'

export interface ContractRow {
  id: string
  type: string
  name: string
  status: string
  sentAt: string | null
  signedAt: string | null
  expiresAt: string | null
  createdAt: string
  signedCount?: number
  totalSigners?: number
}

export interface ProposalRow {
  id: string
  title: string
  subtitle: string | null
  status: string
  effectiveDate: string | null
  expiresAt: string | null
  decidedAt: string | null
  createdAt: string
  updatedAt: string
  dealTitle: string | null
}

export interface ScheduleRow {
  id: string
  title: string
  subtitle: string | null
  status: string
  targetLaunchDate: string | null
  numberOfWeeks: number | null
  createdAt: string
  updatedAt: string
}

export const CONTRACT_TYPE_LABELS: Record<string, string> = {
  nda: 'NDA',
  sla: 'SLA',
  msa: 'MSA',
  sow: 'SOW',
  other: 'Other',
}

const PAPER_TONES: Record<string, BadgeTone> = {
  draft: 'neutral',
  sent: 'info',
  viewed: 'info',
  signed: 'positive',
  accepted: 'positive',
  published: 'positive',
  declined: 'danger',
  expired: 'danger',
  cancelled: 'neutral',
  archived: 'neutral',
}

const EXPIRY_WARN_DAYS = 60

function fmt(value: string | null): string {
  if (!value) return '--'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '--'
  return d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
}

function daysUntil(value: string | null): number | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return Math.ceil((d.getTime() - Date.now()) / 86_400_000)
}

export function PapersTab({
  clientId,
  orgName,
  writeDisabled,
}: {
  clientId: string
  orgName: string
  writeDisabled: boolean
}) {
  const router = useRouter()

  const { data: contractData, isLoading: contractsLoading } =
    useSWR<{ items: ContractRow[] }>(`/api/admin/contracts?orgId=${clientId}`)
  const { data: proposalData, isLoading: proposalsLoading } =
    useSWR<{ items: ProposalRow[] }>(`/api/admin/proposals?orgId=${clientId}`)
  const { data: scheduleData, isLoading: schedulesLoading } =
    useSWR<{ items: ScheduleRow[] }>(`/api/admin/schedules?orgId=${clientId}`)

  const contracts = useMemo(() => contractData?.items ?? [], [contractData])
  const proposals = proposalData?.items ?? []
  const schedules = scheduleData?.items ?? []

  const msa = useMemo(
    () => contracts.find(k => k.type === 'msa' && k.status === 'signed') ?? null,
    [contracts],
  )
  const msaOut = contracts.some(k => k.type === 'msa' && k.status === 'sent')
  const msaLeft = msa ? daysUntil(msa.expiresAt) : null

  const contractColumns: DataTableColumn<ContractRow>[] = [
    {
      key: 'name',
      header: 'Contract',
      minWidth: '14rem',
      sortable: true,
      sortValue: r => r.name,
      render: r => (
        <span className="flex items-center" style={{ gap: '0.5rem', fontWeight: 600, color: 'var(--color-text)' }}>
          <ScrollText className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
          <span className="truncate">{r.name}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '6rem',
      render: r => <Badge tone="neutral" size="sm">{CONTRACT_TYPE_LABELS[r.type] ?? r.type}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      render: r => <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>,
    },
    {
      key: 'signers',
      header: 'Signed',
      muted: true,
      width: '7rem',
      render: r => (r.totalSigners ?? 0) > 0
        ? `${r.signedCount ?? 0} of ${r.totalSigners}`
        : (r.signedAt ? fmt(r.signedAt) : '--'),
    },
    {
      key: 'expires',
      header: 'Expires',
      muted: true,
      width: '9rem',
      sortable: true,
      sortValue: r => r.expiresAt ?? '',
      render: r => {
        const left = daysUntil(r.expiresAt)
        if (left == null) return 'No end date'
        const soon = left >= 0 && left <= EXPIRY_WARN_DAYS
        return (
          <span style={{ color: soon ? 'var(--color-danger)' : undefined, fontWeight: soon ? 600 : undefined }}>
            {left < 0 ? `Expired ${fmt(r.expiresAt)}` : `in ${left} ${left === 1 ? 'day' : 'days'}`}
          </span>
        )
      },
    },
  ]

  const proposalColumns: DataTableColumn<ProposalRow>[] = [
    {
      key: 'title',
      header: 'Proposal',
      minWidth: '14rem',
      sortable: true,
      sortValue: r => r.title,
      render: r => (
        <span className="flex flex-col" style={{ minWidth: 0 }}>
          <span className="truncate" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</span>
          {r.dealTitle && (
            <span className="truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
              on {r.dealTitle}
            </span>
          )}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      render: r => <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>,
    },
    {
      key: 'effective',
      header: 'Dated',
      muted: true,
      width: '9rem',
      sortable: true,
      sortValue: r => r.effectiveDate ?? r.createdAt,
      render: r => fmt(r.effectiveDate ?? r.createdAt),
    },
    {
      key: 'decision',
      header: 'Decision',
      muted: true,
      width: '10rem',
      render: r => r.decidedAt
        ? fmt(r.decidedAt)
        : r.expiresAt
          ? `Open until ${fmt(r.expiresAt)}`
          : 'Awaiting a decision',
    },
  ]

  const scheduleColumns: DataTableColumn<ScheduleRow>[] = [
    {
      key: 'title',
      header: 'Schedule',
      minWidth: '14rem',
      sortable: true,
      sortValue: r => r.title,
      render: r => (
        <span className="truncate" style={{ fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '7rem',
      render: r => <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>,
    },
    {
      key: 'weeks',
      header: 'Length',
      muted: true,
      width: '7rem',
      render: r => (r.numberOfWeeks ? `${r.numberOfWeeks} weeks` : '--'),
    },
    {
      key: 'launch',
      header: 'Target launch',
      muted: true,
      width: '10rem',
      sortable: true,
      sortValue: r => r.targetLaunchDate ?? '',
      render: r => fmt(r.targetLaunchDate),
    },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '1rem' }}>
      {/* The one-line answer to "are we covered?" */}
      <Card padding="sm">
        <p
          className="flex items-center flex-wrap"
          style={{ margin: 0, gap: '0.5rem', fontSize: '0.8125rem', lineHeight: 1.45, color: 'var(--color-text-muted)' }}
        >
          <Handshake className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} aria-hidden="true" />
          {msa ? (
            <span>
              <strong style={{ color: 'var(--color-text)', fontWeight: 700 }}>
                Master agreement signed {fmt(msa.signedAt)}.
              </strong>{' '}
              {msaLeft == null
                ? 'No end date.'
                : msaLeft <= EXPIRY_WARN_DAYS
                  ? `Renews in ${msaLeft} days, worth a conversation now.`
                  : `Renews in ${msaLeft} days.`}
            </span>
          ) : (
            <span>
              <strong style={{ color: 'var(--color-text)', fontWeight: 700 }}>No signed master agreement.</strong>{' '}
              {msaOut ? 'One is out for signature.' : 'Send one before the next project starts.'}
            </span>
          )}
        </p>
      </Card>

      {/* Proposals */}
      <div className="flex flex-col" style={{ gap: '0.5rem' }}>
        <SubBar>
          <SectionTitle>Proposals</SectionTitle>
          <CountText>{proposals.length}</CountText>
          <Grow />
          <TahiButton
            variant="secondary"
            size="sm"
            disabled={writeDisabled}
            onClick={() => router.push(`/proposals?orgId=${clientId}`)}
          >
            All proposals
          </TahiButton>
        </SubBar>
        <Card padding="none">
          <DataTable<ProposalRow>
            ariaLabel="Proposals"
            columns={proposalColumns}
            rows={proposals}
            getRowId={r => r.id}
            loading={proposalsLoading}
            onRowClick={r => router.push(`/proposals/${r.id}`)}
            mobileCard={r => (
              <button
                type="button"
                onClick={() => router.push(`/proposals/${r.id}`)}
                className="tahi-focus-ring text-left w-full"
                style={{
                  display: 'flex', flexDirection: 'column', gap: '0.375rem',
                  minHeight: '2.75rem', padding: '0.75rem', border: 'none', background: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</span>
                <span className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                  <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{fmt(r.effectiveDate ?? r.createdAt)}</span>
                </span>
              </button>
            )}
            empty={
              <EmptyState
                variant="inline"
                icon={<FileSignature className="w-8 h-8" />}
                title="No proposals for this client"
                description={`Nothing has been proposed to ${orgName} in writing. Every engagement so far was agreed another way.`}
              />
            }
          />
        </Card>
      </div>

      {/* Contracts */}
      <div className="flex flex-col" style={{ gap: '0.5rem' }}>
        <SubBar>
          <SectionTitle>Contracts</SectionTitle>
          <CountText>{contracts.length}</CountText>
          <Grow />
          <TahiButton
            variant="secondary"
            size="sm"
            disabled={writeDisabled}
            onClick={() => router.push(`/contracts?orgId=${clientId}`)}
          >
            All contracts
          </TahiButton>
        </SubBar>
        <Card padding="none">
          <DataTable<ContractRow>
            ariaLabel="Contracts"
            columns={contractColumns}
            rows={contracts}
            getRowId={r => r.id}
            loading={contractsLoading}
            onRowClick={r => router.push(`/contracts/${r.id}`)}
            mobileCard={r => (
              <button
                type="button"
                onClick={() => router.push(`/contracts/${r.id}`)}
                className="tahi-focus-ring text-left w-full"
                style={{
                  display: 'flex', flexDirection: 'column', gap: '0.375rem',
                  minHeight: '2.75rem', padding: '0.75rem', border: 'none', background: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{r.name}</span>
                <span className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                  <Badge tone="neutral" size="sm">{CONTRACT_TYPE_LABELS[r.type] ?? r.type}</Badge>
                  <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>
                </span>
              </button>
            )}
            empty={
              <EmptyState
                variant="inline"
                icon={<ScrollText className="w-8 h-8" />}
                title="No contracts on file"
                description={`Nothing signed with ${orgName} yet. Contracts are created from a template on the contracts page.`}
              />
            }
          />
        </Card>
      </div>

      {/* Schedules */}
      <div className="flex flex-col" style={{ gap: '0.5rem' }}>
        <SubBar>
          <SectionTitle>Delivery schedules</SectionTitle>
          <CountText>{schedules.length}</CountText>
          <Grow />
          <TahiButton
            variant="secondary"
            size="sm"
            disabled={writeDisabled}
            onClick={() => router.push(`/schedules?orgId=${clientId}`)}
          >
            All schedules
          </TahiButton>
        </SubBar>
        <Card padding="none">
          <DataTable<ScheduleRow>
            ariaLabel="Delivery schedules"
            columns={scheduleColumns}
            rows={schedules}
            getRowId={r => r.id}
            loading={schedulesLoading}
            onRowClick={r => router.push(`/schedules/${r.id}`)}
            mobileCard={r => (
              <button
                type="button"
                onClick={() => router.push(`/schedules/${r.id}`)}
                className="tahi-focus-ring text-left w-full"
                style={{
                  display: 'flex', flexDirection: 'column', gap: '0.375rem',
                  minHeight: '2.75rem', padding: '0.75rem', border: 'none', background: 'none', cursor: 'pointer',
                }}
              >
                <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{r.title}</span>
                <span className="flex items-center flex-wrap" style={{ gap: '0.5rem' }}>
                  <Badge tone={PAPER_TONES[r.status] ?? 'neutral'} size="sm" className="capitalize">{r.status}</Badge>
                  <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{fmt(r.targetLaunchDate)}</span>
                </span>
              </button>
            )}
            empty={
              <EmptyState
                variant="inline"
                icon={<CalendarRange className="w-8 h-8" />}
                title="No delivery schedule yet"
                description="A schedule turns an agreed proposal into weeks of work the client can follow."
              />
            }
          />
        </Card>
      </div>
    </div>
  )
}
