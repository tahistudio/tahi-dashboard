/**
 * <DealSalesKit> — closing toolkit for a pipeline deal.
 *
 * Lists every proposal / schedule / contract already linked to this deal,
 * with one-click navigation. Three quick-create buttons spin up a new
 * resource pre-filled with the deal's orgId + dealId, then redirect to
 * its editor. Cuts a flow that used to be "navigate away → fill the org
 * dropdown → save → re-link the deal" down to one click.
 */
'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { TrendingUp, FileText, Calendar, FileSignature, Plus, ExternalLink } from 'lucide-react'
import { apiPath } from '@/lib/api'

interface ProposalRow { id: string; title: string; status: string; updatedAt: string }
interface ScheduleRow { id: string; title: string; status: string; updatedAt: string }
interface ContractRow { id: string; name: string; status: string; updatedAt: string; type: string }

interface Props {
  dealId: string
  orgId: string | null
  dealTitle: string
}

interface OrgContact { id: string; name: string; email: string; isPrimary: number }

export function DealSalesKit({ dealId, orgId, dealTitle }: Props) {
  const router = useRouter()
  const [proposals, setProposals] = useState<ProposalRow[]>([])
  const [schedules, setSchedules] = useState<ScheduleRow[]>([])
  const [contracts, setContracts] = useState<ContractRow[]>([])
  const [primaryContact, setPrimaryContact] = useState<OrgContact | null>(null)
  const [creating, setCreating] = useState<null | 'proposal' | 'schedule' | 'contract'>(null)

  const reload = useCallback(async () => {
    try {
      const fetches: Promise<Response>[] = [
        fetch(apiPath(`/api/admin/proposals?dealId=${dealId}`)),
        fetch(apiPath(`/api/admin/schedules?dealId=${dealId}`)),
        fetch(apiPath(`/api/admin/contracts?dealId=${dealId}`)),
      ]
      // Pick the primary contact for auto-fill if we have an org.
      if (orgId) fetches.push(fetch(apiPath(`/api/admin/clients/${orgId}/contacts`)))
      const [pRes, sRes, cRes, kRes] = await Promise.all(fetches)
      if (pRes.ok) {
        const data = await pRes.json() as { items: ProposalRow[] }
        setProposals(data.items ?? [])
      }
      if (sRes.ok) {
        const data = await sRes.json() as { items: ScheduleRow[] }
        setSchedules(data.items ?? [])
      }
      if (cRes.ok) {
        const data = await cRes.json() as { items: ContractRow[] }
        setContracts(data.items ?? [])
      }
      if (kRes && kRes.ok) {
        const data = await kRes.json() as { contacts: OrgContact[] }
        const list = data.contacts ?? []
        const primary = list.find(c => c.isPrimary === 1) ?? list[0] ?? null
        setPrimaryContact(primary)
      }
    } catch { /* silent */ }
  }, [dealId, orgId])

  const primaryContactName = primaryContact?.name ?? null
  const primaryContactEmail = primaryContact?.email ?? null

  useEffect(() => { void reload() }, [reload])

  async function createProposal() {
    setCreating('proposal')
    try {
      const res = await fetch(apiPath('/api/admin/proposals'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: dealTitle,
          subtitle: 'Proposal from Tahi Studio',
          orgId,
          dealId,
          preparedFor: primaryContactName ?? null,
          preparedBy: 'Liam Miller, Tahi Studio',
          effectiveDate: new Date().toISOString(),
          seedDefaults: true,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { id: string }
      router.push(`/proposals/${data.id}`)
    } catch {
      setCreating(null)
    }
  }

  async function createSchedule() {
    setCreating('schedule')
    try {
      const res = await fetch(apiPath('/api/admin/schedules'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: dealTitle,
          subtitle: 'Project schedule',
          orgId,
          dealId,
          preparedFor: primaryContactName ?? null,
          preparedBy: 'Liam Miller, Tahi Studio',
          effectiveDate: new Date().toISOString(),
          numberOfWeeks: 12,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { id: string }
      router.push(`/schedules/${data.id}`)
    } catch {
      setCreating(null)
    }
  }

  async function createContract() {
    setCreating('contract')
    try {
      const signers: Array<Record<string, string>> = [
        { role: 'tahi', name: 'Liam Miller', email: 'business@tahi.studio' },
      ]
      if (primaryContactEmail) {
        signers.push({
          role: 'client',
          name: primaryContactName ?? 'Client signer',
          email: primaryContactEmail,
        })
      }
      const res = await fetch(apiPath('/api/admin/contracts'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: dealTitle,
          type: 'sow',
          orgId,
          dealId,
          bodyHtml: '<h2>Statement of Work</h2><p>Edit this body. Add scope, deliverables, fees and acceptance terms.</p>',
          signers,
        }),
      })
      if (!res.ok) throw new Error('failed')
      const data = await res.json() as { id: string }
      router.push(`/contracts/${data.id}`)
    } catch {
      setCreating(null)
    }
  }

  return (
    <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[var(--color-brand)]" />
          <h3 className="font-semibold text-[var(--color-text)]">Sales kit</h3>
        </div>
      </div>

      <p className="text-xs text-[var(--color-text-muted)] -mt-2">
        Spin up linked proposals, schedules and contracts in one click. Names, org and primary
        contact are pre-filled from this deal.
      </p>

      {/* Existing items */}
      <div className="space-y-3">
        <ResourceList
          label="Proposals"
          icon={<FileText className="w-3.5 h-3.5" />}
          items={proposals.map(p => ({ id: p.id, label: p.title, status: p.status }))}
          basePath="/proposals"
        />
        <ResourceList
          label="Schedules"
          icon={<Calendar className="w-3.5 h-3.5" />}
          items={schedules.map(s => ({ id: s.id, label: s.title, status: s.status }))}
          basePath="/schedules"
        />
        <ResourceList
          label="Contracts"
          icon={<FileSignature className="w-3.5 h-3.5" />}
          items={contracts.map(c => ({ id: c.id, label: c.name, status: c.status }))}
          basePath="/contracts"
        />
      </div>

      {/* Quick-create row */}
      <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[var(--color-border-subtle)]">
        <CreateBtn
          icon={<FileText className="w-3.5 h-3.5" />}
          label="Proposal"
          loading={creating === 'proposal'}
          onClick={createProposal}
        />
        <CreateBtn
          icon={<Calendar className="w-3.5 h-3.5" />}
          label="Schedule"
          loading={creating === 'schedule'}
          onClick={createSchedule}
        />
        <CreateBtn
          icon={<FileSignature className="w-3.5 h-3.5" />}
          label="Contract"
          loading={creating === 'contract'}
          onClick={createContract}
        />
      </div>
    </div>
  )
}

function ResourceList({
  label, icon, items, basePath,
}: {
  label: string
  icon: React.ReactNode
  items: Array<{ id: string; label: string; status: string }>
  basePath: string
}) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[0.6875rem] font-semibold text-[var(--color-text-subtle)] uppercase tracking-wide mb-1.5">
        {icon}
        {label}
      </div>
      <div className="space-y-1">
        {items.map(it => (
          <Link
            key={it.id}
            href={`${basePath}/${it.id}`}
            className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--color-bg-secondary)] transition-colors text-sm"
          >
            <span className="truncate text-[var(--color-text)]">{it.label}</span>
            <span className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[0.6875rem] font-medium text-[var(--color-text-muted)] capitalize">{it.status.replace('_', ' ')}</span>
              <ExternalLink className="w-3 h-3 text-[var(--color-text-subtle)]" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function CreateBtn({
  icon, label, onClick, loading,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  loading: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="flex flex-col items-center gap-1 py-2.5 px-2 rounded-lg border border-dashed border-[var(--color-border)] hover:border-[var(--color-brand)] hover:bg-[var(--color-brand-50)] transition-colors text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-brand-dark)]"
    >
      <span className="flex items-center gap-1">
        {loading ? <span className="w-3.5 h-3.5 inline-block animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Plus className="w-3.5 h-3.5" />}
        {icon}
      </span>
      <span>New {label}</span>
    </button>
  )
}
