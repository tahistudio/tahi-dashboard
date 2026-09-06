'use client'

/**
 * The two irreversible client operations: merge one client into another, and
 * delete one outright.
 *
 * SUPER ADMIN ONLY. `usePermissions().isSuperAdmin` is the same signal the
 * sidebar user card and the Act-as-client banner gate on, and the routes gate
 * on `resolvePermissions(...).isSuperAdmin` server-side, so hiding here is a
 * courtesy rather than the boundary.
 *
 * Both flows are DRY RUN FIRST, always. Nothing is written until the operator
 * has read the plan the server built and then confirmed a second time: the
 * merge names what moves, the delete names what goes, and both print every
 * refusal in the server's own words rather than a generic failure.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, GitMerge, Loader2, Trash2 } from 'lucide-react'
import { Callout } from '@/components/tahi/callout'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { Input } from '@/components/tahi/input'
import { usePermissions } from '@/components/tahi/permissions-context'
import { SearchableSelect } from '@/components/tahi/searchable-select'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import { useToast } from '@/components/tahi/toast'
import type { Organisation } from './types'

// ── server shapes ────────────────────────────────────────────────────────────

interface MergePlan {
  shell: { id: string; name: string }
  survivor: { id: string; name: string }
  tables: Record<string, number>
  externalIds: Array<{ field: string; shellValue: string | null; survivorValue: string | null; carried: boolean; note: string }>
  columns: Array<{ field: string; value: string; note: string }>
  contacts: {
    moved: Array<{ id: string; name: string; email: string }>
    folded: Array<{ id: string; name: string; email: string; intoContactId: string }>
    references: Record<string, number>
  }
  warnings: string[]
}

interface DeletePlan {
  org: { id: string; name: string }
  tables: Record<string, number>
  invoices: Array<{
    id: string
    number: string | null
    status: string | null
    totalUsd: number | null
    currency: string | null
    createdAt: string | null
    stripeInvoiceId: string | null
    xeroInvoiceId: string | null
  }>
  stripeCustomerId: string | null
  warnings: string[]
}

interface ErrorPayload {
  error?: string
  refusals?: string[]
}

interface ClientOption {
  id: string
  name: string
  status: string
  planType: string | null
}

// ── small presentational pieces ──────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ gap: '0.75rem', paddingBlock: '0.1875rem' }}
    >
      <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', minWidth: 0, wordBreak: 'break-word' }}>{label}</span>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text)', flexShrink: 0 }}>{value}</span>
    </div>
  )
}

function PlanBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col" style={{ gap: '0.25rem' }}>
      <h4 style={{ margin: 0, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--color-text-subtle)' }}>
        {title}
      </h4>
      {children}
    </div>
  )
}

function TableCounts({ tables }: { tables: Record<string, number> }) {
  const rows = Object.entries(tables).sort((a, b) => b[1] - a[1])
  if (rows.length === 0) {
    return <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>No rows anywhere. This client is empty.</p>
  }
  return (
    <div className="flex flex-col">
      {rows.map(([table, count]) => (
        <Row key={table} label={table} value={String(count)} />
      ))}
    </div>
  )
}

function Refusals({ error, refusals }: { error: string | null; refusals: string[] }) {
  if (!error && refusals.length === 0) return null
  const lines = refusals.length > 0 ? refusals : [error as string]
  return (
    <Callout tone="danger" title="Refused">
      <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {lines.map((line, index) => (
          <li key={index} style={{ fontSize: '0.75rem' }}>{line}</li>
        ))}
      </ul>
    </Callout>
  )
}

// ── merge ────────────────────────────────────────────────────────────────────

function MergeDrawer({ open, org, onClose }: { open: boolean; org: Organisation; onClose: () => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [options, setOptions] = useState<ClientOption[]>([])
  const [survivorId, setSurvivorId] = useState<string | null>(null)
  const [plan, setPlan] = useState<MergePlan | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusals, setRefusals] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/admin/clients?status=all&includeProspects=1')
        if (!res.ok) throw new Error('Failed')
        const json = await res.json() as { organisations?: ClientOption[] }
        if (!cancelled) setOptions((json.organisations ?? []).filter(row => row.id !== org.id))
      } catch {
        if (!cancelled) setOptions([])
      }
    }
    void load()
    return () => { cancelled = true }
  }, [open, org.id])

  useEffect(() => {
    if (open) return
    setSurvivorId(null)
    setPlan(null)
    setError(null)
    setRefusals([])
  }, [open])

  const selectOptions = useMemo(
    () => options.map(row => ({
      value: row.id,
      label: row.name,
      subtitle: [row.status, row.planType ?? undefined].filter(Boolean).join(' · '),
    })),
    [options],
  )

  const survivorName = options.find(row => row.id === survivorId)?.name ?? 'the surviving client'

  const call = useCallback(async (dryRun: boolean) => {
    if (!survivorId) return
    setBusy(true)
    setError(null)
    setRefusals([])
    try {
      const res = await fetch(`/api/admin/clients/${org.id}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ into: survivorId, dryRun }),
      })
      const json = await res.json() as MergePlan & ErrorPayload
      if (!res.ok) {
        setError(json.error ?? 'The merge was refused.')
        setRefusals(json.refusals ?? [])
        setPlan(null)
        return
      }
      if (dryRun) {
        setPlan(json)
      } else {
        showToast(`${org.name} merged into ${json.survivor.name}`, 'success')
        onClose()
        router.push(`/clients/${survivorId}`)
      }
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }, [survivorId, org.id, org.name, showToast, onClose, router])

  const carried = plan?.externalIds.filter(row => row.carried) ?? []

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        icon={<GitMerge className="w-4 h-4" />}
        title={`Merge ${org.name} into another client`}
        subtitle="Every row moves. Nothing is deleted except this shell record."
        maxWidth="34rem"
      >
        <SlideOver.Body>
          <div className="flex flex-col" style={{ gap: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
              Requests, messages, files, invoices, time, tasks and contacts all move onto the client you pick.
              A contact whose email already exists over there is folded into that person, so their history follows
              them. External ids (Xero, Stripe, ManyRequests, Clerk) are only carried into an empty field: if both
              clients hold a different one, the merge stops and names it.
            </p>

            <PlanBlock title="Merge into">
              <SearchableSelect
                options={selectOptions}
                value={survivorId}
                onChange={value => { setSurvivorId(value); setPlan(null) }}
                placeholder="Pick the client that survives"
                searchPlaceholder="Search clients..."
                emptyMessage="No other clients found."
                allowClear
              />
            </PlanBlock>

            <Refusals error={error} refusals={refusals} />

            {plan && (
              <div className="flex flex-col" style={{ gap: '0.875rem' }}>
                <Callout tone="info" title={`${plan.shell.name} moves into ${plan.survivor.name}`}>
                  Read this before you confirm. It is exactly what the merge will do.
                </Callout>

                <PlanBlock title="Rows that move">
                  <TableCounts tables={plan.tables} />
                </PlanBlock>

                <PlanBlock title="External ids">
                  {carried.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>None carried across.</p>
                  ) : (
                    <div className="flex flex-col">
                      {carried.map(row => <Row key={row.field} label={row.field} value={row.shellValue ?? ''} />)}
                    </div>
                  )}
                </PlanBlock>

                <PlanBlock title="Fields filled on the survivor">
                  {plan.columns.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>Nothing. The survivor already has its own.</p>
                  ) : (
                    <div className="flex flex-col">
                      {plan.columns.map(row => <Row key={row.field} label={row.field} value={row.note} />)}
                    </div>
                  )}
                </PlanBlock>

                <PlanBlock title="People">
                  <div className="flex flex-col">
                    <Row label="Contacts moved across" value={String(plan.contacts.moved.length)} />
                    <Row label="Contacts folded into a matching email" value={String(plan.contacts.folded.length)} />
                    {Object.entries(plan.contacts.references).map(([key, count]) => (
                      <Row key={key} label={`re-pointed: ${key}`} value={String(count)} />
                    ))}
                  </div>
                </PlanBlock>

                {plan.warnings.length > 0 && (
                  <Callout tone="warning" title="Worth knowing">
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {plan.warnings.map((line, index) => <li key={index} style={{ fontSize: '0.75rem' }}>{line}</li>)}
                    </ul>
                  </Callout>
                )}
              </div>
            )}
          </div>
        </SlideOver.Body>

        <SlideOver.Footer>
          <TahiButton variant="ghost" size="sm" onClick={onClose}>Cancel</TahiButton>
          {plan ? (
            <TahiButton variant="danger" size="sm" disabled={busy} onClick={() => setConfirming(true)}>
              Merge into {survivorName}
            </TahiButton>
          ) : (
            <TahiButton
              variant="primary"
              size="sm"
              loading={busy}
              disabled={!survivorId}
              iconLeft={busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : undefined}
              onClick={() => void call(true)}
            >
              Preview the merge
            </TahiButton>
          )}
        </SlideOver.Footer>
      </SlideOver>

      <ConfirmDialog
        open={confirming}
        variant="danger"
        title={`Merge ${org.name} into ${survivorName}?`}
        description={`Every row listed in the preview moves across and the ${org.name} record is removed. This cannot be undone from the dashboard.`}
        confirmLabel="Merge them"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          await call(false)
        }}
      />
    </>
  )
}

// ── delete ───────────────────────────────────────────────────────────────────

function DeleteDrawer({ open, org, onClose }: { open: boolean; org: Organisation; onClose: () => void }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [plan, setPlan] = useState<DeletePlan | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [refusals, setRefusals] = useState<string[]>([])
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (open) return
    setPlan(null)
    setTyped('')
    setError(null)
    setRefusals([])
  }, [open])

  const call = useCallback(async (dryRun: boolean) => {
    setBusy(true)
    setError(null)
    setRefusals([])
    try {
      const res = await fetch(`/api/admin/clients/${org.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        // The dry run uses the real name so the operator only has to type it
        // for the write. The write sends what they actually typed.
        body: JSON.stringify({ confirmName: dryRun ? org.name : typed, dryRun }),
      })
      const json = await res.json() as DeletePlan & ErrorPayload
      if (!res.ok) {
        setError(json.error ?? 'The delete was refused.')
        setRefusals(json.refusals ?? [])
        if (dryRun) setPlan(null)
        return
      }
      if (dryRun) {
        setPlan(json)
      } else {
        showToast(`${org.name} deleted`, 'success')
        onClose()
        router.push('/clients')
      }
    } catch {
      setError('Could not reach the server. Nothing was changed.')
    } finally {
      setBusy(false)
    }
  }, [org.id, org.name, typed, showToast, onClose, router])

  const nameMatches = typed === org.name

  return (
    <>
      <SlideOver
        open={open}
        onClose={onClose}
        icon={<Trash2 className="w-4 h-4" />}
        title={`Delete ${org.name}`}
        subtitle="Irreversible. Archive is the reversible answer."
        maxWidth="34rem"
      >
        <SlideOver.Body>
          <div className="flex flex-col" style={{ gap: '1rem' }}>
            <p style={{ margin: 0, fontSize: '0.8125rem', color: 'var(--color-text-muted)', lineHeight: 1.55 }}>
              This removes the client and everything under it, including its invoices, invoice items,
              subscriptions and tracks. It is refused outright for an imported client, one with a real login,
              one whose contacts can sign in, one carrying pipeline or sales rows, and one with a paid invoice
              on a live rail. If you get a refusal, merge is what you want instead.
            </p>

            <Refusals error={error} refusals={refusals} />

            {plan && (
              <div className="flex flex-col" style={{ gap: '0.875rem' }}>
                <PlanBlock title="Rows that go">
                  <TableCounts tables={plan.tables} />
                </PlanBlock>

                <PlanBlock title="Invoices removed">
                  {plan.invoices.length === 0 ? (
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>None.</p>
                  ) : (
                    <div className="flex flex-col">
                      {plan.invoices.map(invoice => (
                        <Row
                          key={invoice.id}
                          label={[
                            invoice.number ?? invoice.id.slice(0, 8),
                            invoice.status,
                            invoice.createdAt?.slice(0, 10),
                            invoice.stripeInvoiceId ?? invoice.xeroInvoiceId ?? 'no rail id',
                          ].filter(Boolean).join(' · ')}
                          value={`${invoice.currency ?? 'USD'} ${invoice.totalUsd ?? 0}`}
                        />
                      ))}
                    </div>
                  )}
                </PlanBlock>

                {plan.warnings.length > 0 && (
                  <Callout tone="warning" title="Before you confirm">
                    <ul style={{ margin: 0, paddingLeft: '1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {plan.warnings.map((line, index) => <li key={index} style={{ fontSize: '0.75rem' }}>{line}</li>)}
                    </ul>
                  </Callout>
                )}

                <PlanBlock title={`Type "${org.name}" to enable the delete`}>
                  <Input
                    value={typed}
                    onChange={event => setTyped(event.target.value)}
                    placeholder={org.name}
                    aria-label={`Type ${org.name} to confirm the delete`}
                    autoComplete="off"
                    spellCheck={false}
                    // The gate on an irreversible write, so it gets a full
                    // 2.75rem tap target at every width rather than the
                    // primitive's default form height.
                    style={{ height: '2.75rem' }}
                  />
                </PlanBlock>
              </div>
            )}
          </div>
        </SlideOver.Body>

        <SlideOver.Footer>
          <TahiButton variant="ghost" size="sm" onClick={onClose}>Cancel</TahiButton>
          {plan ? (
            <TahiButton variant="danger" size="sm" disabled={busy || !nameMatches} onClick={() => setConfirming(true)}>
              Delete this client
            </TahiButton>
          ) : (
            <TahiButton variant="primary" size="sm" loading={busy} onClick={() => void call(true)}>
              Check what would be deleted
            </TahiButton>
          )}
        </SlideOver.Footer>
      </SlideOver>

      <ConfirmDialog
        open={confirming}
        variant="danger"
        title={`Delete ${org.name}?`}
        description="Everything listed in the preview goes, including the invoices. There is no undo from the dashboard."
        confirmLabel="Delete it"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          setConfirming(false)
          await call(false)
        }}
      />
    </>
  )
}

// ── the section ──────────────────────────────────────────────────────────────

export function LifecycleDangerZone({ org }: { org: Organisation }) {
  const { isSuperAdmin } = usePermissions()
  const [drawer, setDrawer] = useState<'merge' | 'delete' | null>(null)

  if (!isSuperAdmin) return null

  return (
    <div className="flex flex-col" style={{ gap: '0.875rem' }}>
      <div
        aria-hidden="true"
        style={{ height: '1px', background: 'var(--color-border-subtle)', width: '100%' }}
      />

      <div className="flex items-start" style={{ gap: '0.5rem' }}>
        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" style={{ color: 'var(--color-danger)', flexShrink: 0, marginTop: '0.125rem' }} />
        <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-muted)', lineHeight: 1.5 }}>
          Super admin only. Both of these show you exactly what would change before anything is written,
          and neither sends any email.
        </p>
      </div>

      <div className="flex items-start justify-between flex-wrap" style={{ gap: '0.75rem' }}>
        <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: '12rem', flex: 1 }}>
          <strong style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>Merge into another client</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Moves every request, message, file, invoice, contact and hour onto the client you pick, then removes
            this record. Use it on a duplicate or an import shell.
          </span>
        </div>
        <TahiButton variant="secondary" size="sm" onClick={() => setDrawer('merge')} iconLeft={<GitMerge className="w-3.5 h-3.5" />}>
          Merge
        </TahiButton>
      </div>

      <div className="flex items-start justify-between flex-wrap" style={{ gap: '0.75rem' }}>
        <div className="flex flex-col" style={{ gap: '0.125rem', minWidth: '12rem', flex: 1 }}>
          <strong style={{ fontSize: '0.8125rem', color: 'var(--color-text)' }}>Delete this client</strong>
          <span style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
            Removes {org.name} and everything under it, invoices included. Refused for anything that looks like a
            real client: an import, a live login, a linked contact, a deal or a paid invoice on a live rail.
          </span>
        </div>
        <TahiButton variant="danger" size="sm" onClick={() => setDrawer('delete')} iconLeft={<Trash2 className="w-3.5 h-3.5" />}>
          Delete
        </TahiButton>
      </div>

      <MergeDrawer open={drawer === 'merge'} org={org} onClose={() => setDrawer(null)} />
      <DeleteDrawer open={drawer === 'delete'} org={org} onClose={() => setDrawer(null)} />
    </div>
  )
}
