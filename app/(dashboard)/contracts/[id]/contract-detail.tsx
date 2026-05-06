'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Save, Send, Eye, Copy, Trash2, RefreshCw, Plus, ShieldCheck, Globe,
} from 'lucide-react'
import { TahiButton } from '@/components/tahi/tahi-button'
import { LoadingSkeleton } from '@/components/tahi/loading-skeleton'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'

interface ContractDoc {
  id: string
  orgId: string | null
  dealId: string | null
  proposalId: string | null
  templateId: string | null
  type: string
  name: string
  status: 'draft' | 'sent' | 'partially_signed' | 'signed' | 'expired' | 'cancelled'
  bodyHtml: string
  variableValues: string | null
  publicShareToken: string | null
  publicSharedAt: string | null
  sentAt: string | null
  signedAt: string | null
  expiresAt: string | null
  finalHash: string | null
  createdAt: string
  updatedAt: string
}
interface Signer {
  id: string
  contractId: string
  role: string
  name: string
  email: string
  position: number
  status: 'pending' | 'signed' | 'skipped'
  signedAt: string | null
  signatureId: string | null
}
interface Signature {
  id: string
  contractId: string
  signerId: string
  signatureDataUrl: string
  ipHash: string | null
  userAgent: string | null
  country: string | null
  chainHash: string
  signedAt: string
}

const TYPE_LABEL: Record<string, string> = {
  nda: 'NDA', sla: 'SLA', msa: 'MSA', sow: 'SOW', mou: 'MOU', other: 'Other',
}
const STATUS_BADGE: Record<ContractDoc['status'], { bg: string; color: string; label: string }> = {
  draft: { bg: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)', label: 'Draft' },
  sent: { bg: '#eff6ff', color: '#1e40af', label: 'Sent' },
  partially_signed: { bg: '#fff7ed', color: '#9a3412', label: 'Partially signed' },
  signed: { bg: '#f0fdf4', color: '#166534', label: 'Signed' },
  expired: { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)', label: 'Expired' },
  cancelled: { bg: '#fef2f2', color: '#991b1b', label: 'Cancelled' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

export function ContractDetail({ id }: { id: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [contract, setContract] = useState<ContractDoc | null>(null)
  const [signers, setSigners] = useState<Signer[]>([])
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [savingMeta, setSavingMeta] = useState(false)
  const [showAddSigner, setShowAddSigner] = useState(false)
  const [showRevoke, setShowRevoke] = useState(false)
  const [signerLinks, setSignerLinks] = useState<Record<string, string>>({})

  const fetchAll = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}`))
      if (!res.ok) throw new Error('not found')
      const data = await res.json() as { contract: ContractDoc; signers: Signer[]; signatures: Signature[] }
      setContract(data.contract)
      setSigners(data.signers ?? [])
      setSignatures(data.signatures ?? [])
      setName(data.contract.name)
      setBodyHtml(data.contract.bodyHtml)
      setExpiresAt(data.contract.expiresAt ?? '')
      // Build per-signer links if a token exists
      if (data.contract.publicShareToken) {
        const links: Record<string, string> = {}
        for (const s of data.signers ?? []) {
          links[s.id] = `${window.location.origin}/dashboard/p/contract/${data.contract.publicShareToken}/sign/${s.id}`
        }
        setSignerLinks(links)
      } else {
        setSignerLinks({})
      }
    } catch {
      setContract(null)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { void fetchAll() }, [fetchAll])

  async function saveMeta() {
    setSavingMeta(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          bodyHtml,
          expiresAt: expiresAt || null,
        }),
      })
      if (!res.ok) throw new Error('save failed')
      showToast('Contract saved.')
      void fetchAll()
    } catch {
      showToast('Could not save.', 'error')
    } finally {
      setSavingMeta(false)
    }
  }

  async function sendContract() {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send`), { method: 'POST' })
      if (!res.ok) throw new Error('send failed')
      showToast('Contract shared. Copy each signer link below.')
      void fetchAll()
    } catch {
      showToast('Could not share contract.', 'error')
    }
  }

  async function rotateToken() {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send?rotate=1`), { method: 'POST' })
      if (!res.ok) throw new Error('rotate failed')
      showToast('Share token rotated.')
      void fetchAll()
    } catch {
      showToast('Could not rotate.', 'error')
    }
  }

  async function revokeShare() {
    setShowRevoke(false)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send`), { method: 'DELETE' })
      if (!res.ok) throw new Error('revoke failed')
      showToast('Share revoked.')
      void fetchAll()
    } catch {
      showToast('Could not revoke.', 'error')
    }
  }

  async function deleteSigner(signerId: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/signers/${signerId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('delete failed')
      void fetchAll()
    } catch {
      showToast('Could not remove signer.', 'error')
    }
  }

  function copyLink(signerId: string) {
    const link = signerLinks[signerId]
    if (!link) return
    navigator.clipboard.writeText(link).then(() => showToast('Link copied.'))
  }

  if (loading) {
    return <div className="space-y-6"><LoadingSkeleton rows={6} /></div>
  }
  if (!contract) {
    return (
      <div className="space-y-4">
        <Link href="/contracts" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="w-4 h-4" /> Back to contracts
        </Link>
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-8 text-center">
          <p className="text-[var(--color-text-muted)]">Contract not found.</p>
        </div>
      </div>
    )
  }

  const sty = STATUS_BADGE[contract.status]
  const isLocked = contract.status === 'signed' || contract.status === 'cancelled' || contract.status === 'expired'
  const sortedSigners = [...signers].sort((a, b) => a.position - b.position)
  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="space-y-6">
      <div>
        <Link href="/contracts" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="w-4 h-4" /> Back to contracts
        </Link>
      </div>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: 'var(--color-bg-tertiary)', color: 'var(--color-text-muted)' }}
            >
              {TYPE_LABEL[contract.type] ?? contract.type}
            </span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ background: sty.bg, color: sty.color }}
            >
              {sty.label}
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[var(--color-text)] mt-2">{contract.name}</h1>
          <div className="text-xs text-[var(--color-text-muted)] mt-1">
            Created {formatDate(contract.createdAt)} · Updated {formatDate(contract.updatedAt)}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {contract.publicShareToken && (
            <a
              href={`/dashboard/p/contract/${contract.publicShareToken}`}
              target="_blank"
              rel="noreferrer"
            >
              <TahiButton variant="secondary" size="sm" iconLeft={<Eye className="w-3.5 h-3.5" />}>
                Preview
              </TahiButton>
            </a>
          )}
          {!contract.publicShareToken && contract.status === 'draft' && (
            <TahiButton size="sm" onClick={sendContract} iconLeft={<Send className="w-3.5 h-3.5" />}>
              Send for signing
            </TahiButton>
          )}
          {contract.publicShareToken && !isLocked && (
            <>
              <TahiButton variant="secondary" size="sm" onClick={rotateToken} iconLeft={<RefreshCw className="w-3.5 h-3.5" />}>
                Rotate token
              </TahiButton>
              <TahiButton variant="secondary" size="sm" onClick={() => setShowRevoke(true)}>
                Revoke
              </TahiButton>
            </>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Left: contract body */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
            <label htmlFor="contract-name" className="block text-sm font-medium text-[var(--color-text)] mb-1.5">Name</label>
            <input
              id="contract-name"
              value={name}
              onChange={e => setName(e.target.value)}
              disabled={isLocked}
              className={inputCn}
            />

            <label htmlFor="contract-expires" className="block text-sm font-medium text-[var(--color-text)] mb-1.5 mt-4">Expires (optional)</label>
            <input
              id="contract-expires"
              type="date"
              value={expiresAt ? expiresAt.slice(0, 10) : ''}
              onChange={e => setExpiresAt(e.target.value ? `${e.target.value}T23:59:59.000Z` : '')}
              disabled={isLocked}
              className={inputCn}
            />

            <label htmlFor="contract-body" className="block text-sm font-medium text-[var(--color-text)] mb-1.5 mt-4">
              Contract body (HTML)
            </label>
            <p className="text-xs text-[var(--color-text-muted)] mb-2">
              Renders inside the public viewer. Variables like <code className="bg-[var(--color-bg-tertiary)] px-1 rounded">&#123;&#123;client_name&#125;&#125;</code> are
              substituted at create time.
            </p>
            <textarea
              id="contract-body"
              rows={20}
              value={bodyHtml}
              onChange={e => setBodyHtml(e.target.value)}
              disabled={isLocked}
              className={`${inputCn} font-mono`}
              style={{ fontSize: '0.8125rem', lineHeight: 1.5 }}
            />
            <div className="flex justify-end mt-3">
              <TahiButton onClick={saveMeta} loading={savingMeta} disabled={isLocked} size="sm" iconLeft={<Save className="w-3.5 h-3.5" />}>
                Save changes
              </TahiButton>
            </div>
          </div>

          {/* Signature audit */}
          {signatures.length > 0 && (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-[var(--color-brand)]" />
                <h3 className="font-semibold text-[var(--color-text)]">Signature audit</h3>
              </div>
              <p className="text-xs text-[var(--color-text-muted)] mb-3">
                Each signature is anchored to a SHA-256 chain. Tampering with any earlier signature
                breaks every later chain hash.
              </p>
              <div className="space-y-3">
                {signatures.map((sig, idx) => {
                  const signer = signers.find(s => s.id === sig.signerId)
                  return (
                    <div key={sig.id} className="border border-[var(--color-border)] rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium text-[var(--color-text)]">
                            {signer?.name ?? 'Unknown signer'}
                            <span className="text-xs font-normal text-[var(--color-text-muted)] ml-2">
                              · #{idx + 1} in chain
                            </span>
                          </div>
                          <div className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {formatDate(sig.signedAt)}
                            {sig.country && <span className="ml-2 inline-flex items-center gap-1"><Globe className="w-3 h-3" />{sig.country}</span>}
                          </div>
                        </div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={sig.signatureDataUrl} alt="signature" style={{ height: '2.25rem', maxWidth: '8rem' }} />
                      </div>
                      <div className="text-[0.6875rem] font-mono text-[var(--color-text-subtle)] mt-2 break-all">
                        chain: {sig.chainHash}
                      </div>
                      {sig.ipHash && (
                        <div className="text-[0.6875rem] font-mono text-[var(--color-text-subtle)] break-all">
                          ip-hash: {sig.ipHash.slice(0, 16)}…
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
              {contract.finalHash && (
                <div className="mt-3 text-[0.6875rem] font-mono text-[var(--color-brand-dark)] break-all border-t border-[var(--color-border-subtle)] pt-3">
                  final-hash: {contract.finalHash}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right: signers */}
        <div className="space-y-4">
          <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-[var(--color-text)]">Signers</h3>
              <TahiButton variant="secondary" size="sm" onClick={() => setShowAddSigner(true)} iconLeft={<Plus className="w-3.5 h-3.5" />}>
                Add
              </TahiButton>
            </div>
            {sortedSigners.length === 0 ? (
              <p className="text-sm text-[var(--color-text-muted)]">No signers yet. Add at least one before sending.</p>
            ) : (
              <div className="space-y-2.5">
                {sortedSigners.map(s => {
                  const link = signerLinks[s.id]
                  const ssty = s.status === 'signed'
                    ? { bg: '#f0fdf4', color: '#166534' }
                    : s.status === 'skipped'
                      ? { bg: 'var(--color-bg-secondary)', color: 'var(--color-text-subtle)' }
                      : { bg: '#fff7ed', color: '#9a3412' }
                  return (
                    <div key={s.id} className="border border-[var(--color-border)] rounded-lg p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-[var(--color-text)] truncate">{s.name}</div>
                          <div className="text-xs text-[var(--color-text-muted)] truncate">{s.email}</div>
                          <div className="text-[0.6875rem] uppercase tracking-wide text-[var(--color-text-subtle)] mt-1">
                            {s.role === 'tahi' ? 'Tahi Studio' : s.role}
                          </div>
                        </div>
                        <span
                          className="text-[0.6875rem] font-medium px-2 py-0.5 rounded-full whitespace-nowrap"
                          style={ssty}
                        >
                          {s.status}
                        </span>
                      </div>
                      {s.signedAt && (
                        <div className="text-[0.6875rem] text-[var(--color-text-muted)] mt-1.5">
                          Signed {formatDate(s.signedAt)}
                        </div>
                      )}
                      {link && s.status === 'pending' && (
                        <div className="mt-2.5 pt-2.5 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
                          <code className="text-[0.6875rem] flex-1 truncate text-[var(--color-text-subtle)]">{link}</code>
                          <button
                            onClick={() => copyLink(s.id)}
                            className="p-1 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                            aria-label="Copy link"
                            title="Copy link"
                          >
                            <Copy className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                      {!isLocked && s.status === 'pending' && (
                        <button
                          onClick={() => deleteSigner(s.id)}
                          className="text-xs text-[var(--color-text-subtle)] hover:text-red-500 mt-2"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {contract.publicShareToken && (
            <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-5">
              <h3 className="font-semibold text-[var(--color-text)] mb-2">Public viewer</h3>
              <p className="text-xs text-[var(--color-text-muted)] mb-2">Read-only viewer for anyone with the link.</p>
              <div className="flex items-center gap-2">
                <code className="text-xs flex-1 truncate text-[var(--color-text-subtle)]">{`${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/p/contract/${contract.publicShareToken}`}</code>
                <button
                  onClick={() => {
                    if (!contract.publicShareToken) return
                    const url = `${window.location.origin}/dashboard/p/contract/${contract.publicShareToken}`
                    navigator.clipboard.writeText(url).then(() => showToast('Link copied.'))
                  }}
                  className="p-1.5 rounded hover:bg-[var(--color-bg-secondary)] text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors"
                  aria-label="Copy"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddSigner && (
        <AddSignerDialog
          contractId={id}
          onClose={() => setShowAddSigner(false)}
          onAdded={() => { setShowAddSigner(false); void fetchAll() }}
        />
      )}

      <ConfirmDialog
        open={showRevoke}
        title="Revoke share token?"
        description="The current share link will stop working. Pending signers will not be able to sign until you re-share."
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={revokeShare}
        onCancel={() => setShowRevoke(false)}
      />
    </div>
  )
}

function AddSignerDialog({
  contractId, onClose, onAdded,
}: {
  contractId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [role, setRole] = useState<'tahi' | 'client' | 'witness' | 'other'>('client')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) { setError('Name and email required'); return }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${contractId}/signers`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role, name: name.trim(), email: email.trim() }),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(data.error ?? 'Failed')
      }
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setSaving(false)
    }
  }

  const inputCn = 'w-full px-3 py-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--color-brand)]'

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-sm mx-4" role="dialog" aria-modal="true">
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">Add signer</h2>
        </div>
        <form onSubmit={submit} className="px-6 pb-6 space-y-3">
          {error && (
            <div className="text-sm px-3 py-2 rounded-lg" role="alert" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
              {error}
            </div>
          )}
          <div>
            <label htmlFor="signer-role" className="block text-xs font-medium text-[var(--color-text)] mb-1">Role</label>
            <select id="signer-role" value={role} onChange={e => setRole(e.target.value as typeof role)} className={inputCn}>
              <option value="tahi">Tahi Studio</option>
              <option value="client">Client</option>
              <option value="witness">Witness</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="signer-name" className="block text-xs font-medium text-[var(--color-text)] mb-1">Name</label>
            <input id="signer-name" type="text" value={name} onChange={e => setName(e.target.value)} className={inputCn} />
          </div>
          <div>
            <label htmlFor="signer-email" className="block text-xs font-medium text-[var(--color-text)] mb-1">Email</label>
            <input id="signer-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCn} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <TahiButton variant="secondary" type="button" onClick={onClose}>Cancel</TahiButton>
            <TahiButton type="submit" loading={saving}>Add signer</TahiButton>
          </div>
        </form>
      </div>
    </div>
  )
}
