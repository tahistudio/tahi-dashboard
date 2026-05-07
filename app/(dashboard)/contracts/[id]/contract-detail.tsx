/**
 * <ContractDetail> - admin builder for a single contract document.
 *
 * Mirrors the proposal builder shell pattern (sticky header, left
 * navigator, centre editor, right rail) so the two surfaces feel like
 * siblings. Contracts don't have slides or variants - they have one body
 * + signers + an audit chain - so the navigator only has three sections:
 * Body, Signers, Activity.
 *
 * The right rail is where signing actions live: a "Send for signature"
 * primary, per-signer status, public link controls, link to org/deal,
 * type/status/expiry meta. Email send hits POST /email which auto-mints
 * a token and flips status to 'sent' on first send.
 *
 * Locked states (signed / cancelled / expired) collapse the body editor
 * to a read-only render - the signature chain is sealed and we mustn't
 * let admins re-edit content under signers' feet.
 */
'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Trash2, Eye, Copy, RefreshCw, Plus, ShieldCheck, Globe, Mail,
  ExternalLink, Send, BookmarkPlus, FileText, Users, Activity, Check, X,
  Hourglass, FileSignature,
} from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { PromptDialog } from '@/components/tahi/prompt-dialog'
import { EmailShareModal, type EmailRecipientSuggestion } from '@/components/tahi/email-share-modal'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { LinkedToPanel } from '@/components/tahi/linked-to-panel'
import {
  BuilderShell,
  BuilderEditorShell,
  BuilderMoreMenu,
  BuilderNavGroup,
  BuilderNavItem,
  RailSection,
  SaveIndicator,
  FieldGroup,
  builderHeader,
  builderTitleInput,
  builderGridSingleRail,
  builderRailWide,
  builderMain,
  toolbarBtn,
  toolbarPrimary,
  railBtn,
  metaInputStyle,
  statusPillStyle,
} from '@/components/tahi/builder'

// ─── Types ───────────────────────────────────────────────────────────────

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

// ─── Constants ───────────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  nda: 'NDA',
  sla: 'SLA',
  msa: 'MSA',
  sow: 'SOW',
  mou: 'MOU',
  other: 'Other',
}

const TYPE_OPTIONS: Array<{ value: ContractDoc['type']; label: string }> = [
  { value: 'nda', label: 'NDA - Non-disclosure agreement' },
  { value: 'sla', label: 'SLA - Service-level agreement' },
  { value: 'msa', label: 'MSA - Master services agreement' },
  { value: 'sow', label: 'SOW - Statement of work' },
  { value: 'mou', label: 'MOU - Memorandum of understanding' },
  { value: 'other', label: 'Other' },
]

const STATUS_PALETTE: Record<ContractDoc['status'], { bg: string; fg: string; bd: string; label: string }> = {
  draft:            { bg: '#f7f9f6', fg: '#5a6657', bd: '#e8f0e6', label: 'Draft' },
  sent:             { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe', label: 'Sent' },
  partially_signed: { bg: '#fff7ed', fg: '#9a3412', bd: '#fed7aa', label: 'Partial' },
  signed:           { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0', label: 'Signed' },
  expired:          { bg: '#f5f5f4', fg: '#525252', bd: '#e7e5e4', label: 'Expired' },
  cancelled:        { bg: '#fef2f2', fg: '#dc2626', bd: '#fecaca', label: 'Cancelled' },
}

function formatDate(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return iso }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return '-'
  try {
    return new Date(iso).toLocaleDateString('en-NZ', { day: 'numeric', month: 'short', year: 'numeric' })
  } catch { return iso }
}

// ─── Component ───────────────────────────────────────────────────────────

type ActiveView = 'body' | 'signers' | 'activity'

export function ContractDetail({ id }: { id: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [contract, setContract] = useState<ContractDoc | null>(null)
  const [signers, setSigners] = useState<Signer[]>([])
  const [signatures, setSignatures] = useState<Signature[]>([])
  const [loading, setLoading] = useState(true)
  const [activeView, setActiveView] = useState<ActiveView>('body')

  // Controlled fields backed by contract doc (save on blur)
  const [name, setName] = useState('')
  const [bodyHtml, setBodyHtml] = useState('')

  // Save indicator state - every awaited mutation tracks against this so
  // the header pill can show "Saving..." → "Saved 12s ago".
  const [savingCount, setSavingCount] = useState(0)
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const trackSave = useCallback(<T,>(promise: Promise<T>): Promise<T> => {
    setSavingCount(c => c + 1)
    return promise.finally(() => {
      setSavingCount(c => Math.max(0, c - 1))
      setLastSavedAt(Date.now())
    })
  }, [])

  // Per-signer URLs derived from publicShareToken - built client-side so
  // we can include window.location.origin for copy/open.
  const [signerLinks, setSignerLinks] = useState<Record<string, string>>({})

  // Modal flags
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [showAddSigner, setShowAddSigner] = useState(false)
  const [showRevoke, setShowRevoke] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [showSaveTemplate, setShowSaveTemplate] = useState(false)

  // ── Data fetching ────────────────────────────────────────────────────

  const fetchAll = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}`))
      if (!res.ok) throw new Error('not found')
      const data = await res.json() as { contract: ContractDoc; signers: Signer[]; signatures: Signature[] }
      setContract(data.contract)
      setSigners(data.signers ?? [])
      setSignatures(data.signatures ?? [])
      setName(data.contract.name)
      setBodyHtml(data.contract.bodyHtml)
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
      if (!opts.silent) setContract(null)
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [id])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // ── Mutations ────────────────────────────────────────────────────────

  async function patchContract(changes: Partial<ContractDoc>) {
    setContract(prev => prev ? { ...prev, ...changes } : prev)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
      if (!res.ok) throw new Error('save failed')
    } catch {
      showToast('Could not save.', 'error')
    }
  }

  async function emailAllPending(opts: { message?: string } = {}) {
    const pending = signers.filter(s => s.status === 'pending')
    if (pending.length === 0) {
      showToast('No pending signers to email.', 'error')
      return
    }
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/email`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          signerIds: pending.map(s => s.id),
          message: opts.message,
        }),
      })
      const data = await res.json() as { sent?: unknown[]; failed?: Array<{ error: string }> }
      if (!res.ok) {
        showToast('Could not send signing emails.', 'error')
        return
      }
      const sentCount = Array.isArray(data.sent) ? data.sent.length : 0
      const failedCount = Array.isArray(data.failed) ? data.failed.length : 0
      if (sentCount > 0) {
        showToast(`Sent ${sentCount} signing email${sentCount === 1 ? '' : 's'}${failedCount > 0 ? ` (${failedCount} failed)` : ''}.`)
      } else {
        showToast('No emails sent.', 'error')
      }
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not send signing emails.', 'error')
    }
  }

  async function resendSigner(signerId: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/email`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signerIds: [signerId] }),
      })
      if (!res.ok) throw new Error()
      showToast('Signing link emailed.')
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not resend.', 'error')
    }
  }

  async function generateShareLink() {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send`), { method: 'POST' })
      if (!res.ok) throw new Error()
      showToast('Public link ready.')
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not generate link.', 'error')
    }
  }

  async function rotateToken() {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send?rotate=1`), { method: 'POST' })
      if (!res.ok) throw new Error()
      showToast('Share token rotated.')
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not rotate.', 'error')
    }
  }

  async function revokeShare() {
    setShowRevoke(false)
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/send`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showToast('Share revoked.')
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not revoke.', 'error')
    }
  }

  async function deleteContract() {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      showToast('Contract deleted.')
      router.push('/contracts')
    } catch {
      showToast('Could not delete contract.', 'error')
    }
  }

  async function deleteSigner(signerId: string) {
    try {
      const res = await fetch(apiPath(`/api/admin/contracts/${id}/signers/${signerId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error()
      void fetchAll({ silent: true })
    } catch {
      showToast('Could not remove signer.', 'error')
    }
  }

  // Save-as-template - note this calls an endpoint that may not exist yet.
  // The placeholder stays in the More menu so PM/BE can wire it later; if
  // the endpoint 404s we surface a clear toast rather than crashing.
  async function saveAsTemplate(templateName: string) {
    try {
      const res = await fetch(apiPath('/api/admin/contracts/templates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: templateName.trim(),
          fromContractId: id,
        }),
      })
      if (!res.ok) {
        if (res.status === 404) {
          showToast('Save-as-template not yet available for contracts.', 'error')
        } else {
          showToast('Could not save template.', 'error')
        }
        return
      }
      showToast('Template saved.')
      setShowSaveTemplate(false)
    } catch {
      showToast('Could not save template.', 'error')
    }
  }

  function copyLink(url: string) {
    navigator.clipboard.writeText(url).then(() => showToast('Link copied.'))
  }

  // ── Loading / not-found states ───────────────────────────────────────

  if (loading) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div className="animate-pulse rounded-xl" style={{ height: '4rem', background: 'var(--color-bg-secondary)', marginBottom: '1rem' }} />
        <div className="animate-pulse rounded-xl" style={{ height: '20rem', background: 'var(--color-bg-secondary)' }} />
      </div>
    )
  }

  if (!contract) {
    return (
      <div className="space-y-4 p-6">
        <Link href="/contracts" className="inline-flex items-center gap-1.5 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text)]">
          <ArrowLeft className="w-4 h-4" /> Back to contracts
        </Link>
        <div className="bg-[var(--color-bg)] border border-[var(--color-border)] rounded-xl p-8 text-center">
          <p className="text-[var(--color-text-muted)]">Contract not found.</p>
        </div>
      </div>
    )
  }

  // ── Derived state ────────────────────────────────────────────────────

  const isLocked = contract.status === 'signed' || contract.status === 'cancelled' || contract.status === 'expired'
  const sortedSigners = [...signers].sort((a, b) => a.position - b.position)
  const pendingCount = sortedSigners.filter(s => s.status === 'pending').length
  const signedCount = sortedSigners.filter(s => s.status === 'signed').length
  const palette = STATUS_PALETTE[contract.status]
  const publicUrl = contract.publicShareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/p/contract/${contract.publicShareToken}`
    : null

  // ── Render ───────────────────────────────────────────────────────────

  return (
    <BuilderShell>
      {/* Sticky header */}
      <header style={builderHeader}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: 0, flex: 1 }}>
          <Link
            href="/contracts"
            aria-label="All contracts"
            style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2rem', height: '2rem', borderRadius: '0.5rem', color: 'var(--color-text-muted)', flexShrink: 0 }}
            className="nav-item-hover"
          >
            <ArrowLeft size={16} />
          </Link>
          <div style={{ minWidth: 0, flex: 1 }}>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              onBlur={e => trackSave(patchContract({ name: e.currentTarget.value.trim() || 'Untitled contract' }))}
              placeholder="Untitled contract"
              disabled={isLocked}
              style={builderTitleInput}
            />
          </div>
          <span
            style={statusPillStyle({ bg: 'var(--color-bg-secondary)', fg: 'var(--color-text-muted)', bd: 'var(--color-border-subtle)' })}
            title="Contract type"
          >
            {TYPE_LABEL[contract.type] ?? contract.type}
          </span>
          <span style={statusPillStyle(palette)}>{palette.label}</span>
          <SaveIndicator savingCount={savingCount} lastSavedAt={lastSavedAt} />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
          {pendingCount > 0 && !isLocked && (
            <button
              onClick={() => setShowEmail(true)}
              style={toolbarPrimary}
              title="Send signing emails"
            >
              <Mail size={13} />
              {contract.status === 'draft' ? 'Send for signature' : 'Email signers'}
            </button>
          )}
          <Link
            href={`/preview/contract/${id}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center"
            style={toolbarBtn}
          >
            <Eye size={13} />
            Preview
          </Link>
          <BuilderMoreMenu
            open={moreMenuOpen}
            onToggle={() => setMoreMenuOpen(v => !v)}
            onClose={() => setMoreMenuOpen(false)}
            items={[
              {
                icon: <BookmarkPlus size={13} />,
                label: 'Save as template',
                onClick: () => setShowSaveTemplate(true),
                disabled: isLocked,
              },
              {
                icon: <Trash2 size={13} />,
                label: 'Delete contract',
                danger: true,
                onClick: () => setShowDelete(true),
              },
            ]}
          />
        </div>
      </header>

      {/* Main grid: editor on the left, combined navigator + metadata rail on the right */}
      <div style={builderGridSingleRail} className="tahi-builder-grid-single">
        {/* Editor */}
        <main style={builderMain} key={activeView}>
          {activeView === 'body' && (
            <BuilderEditorShell eyebrow="Document" kicker="Contract body">
              <div style={{ display: 'grid', gap: '0.875rem', padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
                <p style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.55 }}>
                  Write the terms that render in the public viewer. Variables like{' '}
                  <code style={{ background: 'var(--color-bg-tertiary)', padding: '0.0625rem 0.25rem', borderRadius: '0.25rem', fontSize: '0.75rem' }}>
                    &#123;&#123;client_name&#125;&#125;
                  </code>{' '}
                  are substituted at create time. Locked once the contract is signed or cancelled.
                </p>
                {isLocked ? (
                  <div
                    style={{
                      padding: '1rem 1.25rem',
                      background: 'var(--color-bg-tertiary)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      minHeight: '24rem',
                      fontSize: '0.9375rem',
                      lineHeight: 1.7,
                      color: 'var(--color-text)',
                    }}
                    dangerouslySetInnerHTML={{ __html: bodyHtml }}
                  />
                ) : (
                  <TiptapDocEditor
                    content={bodyHtml}
                    onChange={(html) => {
                      setBodyHtml(html)
                      trackSave(patchContract({ bodyHtml: html }))
                    }}
                    placeholder="Write the contract body. Headings, lists, links and emphasis all carry through to the public viewer."
                  />
                )}
              </div>
            </BuilderEditorShell>
          )}

          {activeView === 'signers' && (
            <BuilderEditorShell
              eyebrow="Document"
              kicker="Signers"
              actions={
                !isLocked ? (
                  <button
                    onClick={() => setShowAddSigner(true)}
                    style={toolbarBtn}
                    title="Add signer"
                  >
                    <Plus size={13} />
                    Add signer
                  </button>
                ) : null
              }
            >
              <SignersPane
                signers={sortedSigners}
                signerLinks={signerLinks}
                isLocked={isLocked}
                onCopy={copyLink}
                onResend={resendSigner}
                onRemove={deleteSigner}
              />
            </BuilderEditorShell>
          )}

          {activeView === 'activity' && (
            <BuilderEditorShell eyebrow="Document" kicker="Activity">
              <ActivityPane
                contract={contract}
                signers={sortedSigners}
                signatures={signatures}
              />
            </BuilderEditorShell>
          )}
        </main>

        {/* Right rail — navigator + metadata combined */}
        <aside style={builderRailWide} className="tahi-builder-rail-wide">
          <BuilderNavGroup label="Document">
            <BuilderNavItem
              active={activeView === 'body'}
              onClick={() => setActiveView('body')}
              icon={<FileText size={12} />}
              label="Body"
              hint={isLocked ? 'Locked (signed)' : 'Contract terms'}
            />
            <BuilderNavItem
              active={activeView === 'signers'}
              onClick={() => setActiveView('signers')}
              icon={<Users size={12} />}
              label="Signers"
              hint={signers.length === 0 ? 'No signers yet' : `${signedCount} of ${signers.length} signed`}
              badge={pendingCount > 0 ? `${pendingCount} pending` : undefined}
            />
            <BuilderNavItem
              active={activeView === 'activity'}
              onClick={() => setActiveView('activity')}
              icon={<Activity size={12} />}
              label="Activity"
              hint={signatures.length > 0 ? `${signatures.length} signature${signatures.length === 1 ? '' : 's'}` : 'Audit chain'}
            />
          </BuilderNavGroup>

          <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.5rem 0' }} aria-hidden="true" />

          <RailSection title="Send for signature">
            {pendingCount > 0 && !isLocked ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <button
                  onClick={() => emailAllPending()}
                  className="inline-flex items-center"
                  style={{ ...railBtn, background: 'var(--color-brand)', color: '#FFFFFF', borderColor: 'var(--color-brand)', justifyContent: 'center' }}
                  title={`Email all ${pendingCount} pending signer${pendingCount === 1 ? '' : 's'}`}
                >
                  <Send size={12} />
                  Email all pending ({pendingCount})
                </button>
                <button
                  onClick={() => setShowEmail(true)}
                  className="inline-flex items-center"
                  style={{ ...railBtn, justifyContent: 'center' }}
                >
                  <Mail size={12} />
                  Customise + send
                </button>
              </div>
            ) : signers.length === 0 ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                Add at least one signer to enable signing.
              </p>
            ) : isLocked ? (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                {contract.status === 'signed' ? 'Fully signed.' : contract.status === 'cancelled' ? 'Cancelled.' : 'Expired.'} No further signing.
              </p>
            ) : (
              <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                All signers have signed.
              </p>
            )}
          </RailSection>

          <RailSection title="Public link">
            {publicUrl ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div style={{
                  padding: '0.5rem 0.625rem',
                  fontSize: '0.6875rem',
                  color: 'var(--color-text-muted)',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: 'var(--radius-sm)',
                  wordBreak: 'break-all',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                }}>
                  {publicUrl}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                  <button onClick={() => copyLink(publicUrl)} className="inline-flex items-center" style={{ ...railBtn, flex: 1, justifyContent: 'center' }} title="Copy URL">
                    <Copy size={12} />
                    Copy
                  </button>
                  <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center" style={{ ...railBtn, flex: 1, justifyContent: 'center' }} title="Open in new tab">
                    <ExternalLink size={12} />
                    Open
                  </a>
                </div>
                {!isLocked && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
                    <button onClick={rotateToken} className="inline-flex items-center" style={{ ...railBtn, flex: 1, justifyContent: 'center' }} title="Mint a fresh token">
                      <RefreshCw size={12} />
                      Rotate
                    </button>
                    <button onClick={() => setShowRevoke(true)} className="inline-flex items-center" style={{ ...railBtn, flex: 1, color: 'var(--color-danger)', justifyContent: 'center' }}>
                      Revoke
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
                  Generate a public link to share the contract for signing. Emails auto-mint one for you.
                </p>
                <button onClick={generateShareLink} className="inline-flex items-center" style={{ ...railBtn, justifyContent: 'center' }}>
                  <Send size={12} />
                  Generate share link
                </button>
              </div>
            )}
          </RailSection>

          <RailSection title="Linked to">
            <LinkedToPanel
              resourceType="contract"
              resourceId={id}
              orgId={contract.orgId}
              dealId={contract.dealId}
              proposalId={contract.proposalId}
              onChanged={() => void fetchAll({ silent: true })}
            />
          </RailSection>

          <RailSection title="Details">
            <div style={{ display: 'grid', gap: '0.625rem' }}>
              <FieldGroup label="Type">
                <select
                  value={contract.type}
                  onChange={e => trackSave(patchContract({ type: e.target.value }))}
                  disabled={isLocked}
                  style={{ ...metaInputStyle, cursor: isLocked ? 'not-allowed' : 'pointer' }}
                >
                  {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </FieldGroup>
              <FieldGroup label="Expires">
                <input
                  type="date"
                  value={contract.expiresAt ? contract.expiresAt.slice(0, 10) : ''}
                  onChange={e => {
                    const next = e.currentTarget.value ? `${e.currentTarget.value}T23:59:59.000Z` : null
                    trackSave(patchContract({ expiresAt: next }))
                  }}
                  disabled={isLocked}
                  style={metaInputStyle}
                />
              </FieldGroup>
              <FieldGroup label="Created">
                <div style={{ ...metaInputStyle, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                  {formatDateShort(contract.createdAt)}
                </div>
              </FieldGroup>
              {contract.sentAt && (
                <FieldGroup label="Sent">
                  <div style={{ ...metaInputStyle, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                    {formatDateShort(contract.sentAt)}
                  </div>
                </FieldGroup>
              )}
              {contract.signedAt && (
                <FieldGroup label="Signed">
                  <div style={{ ...metaInputStyle, background: 'var(--color-bg)', color: 'var(--color-text-muted)' }}>
                    {formatDateShort(contract.signedAt)}
                  </div>
                </FieldGroup>
              )}
            </div>
          </RailSection>
        </aside>
      </div>

      {/* Modals */}
      {showAddSigner && (
        <AddSignerDialog
          contractId={id}
          onClose={() => setShowAddSigner(false)}
          onAdded={() => { setShowAddSigner(false); void fetchAll({ silent: true }) }}
        />
      )}

      <ConfirmDialog
        open={showRevoke}
        title="Revoke share token?"
        description="The current share link stops working. Pending signers can't sign until you re-share."
        confirmLabel="Revoke"
        variant="danger"
        onConfirm={revokeShare}
        onCancel={() => setShowRevoke(false)}
      />

      <ConfirmDialog
        open={showDelete}
        title="Delete this contract?"
        description="Permanently removes the contract, all signers, and all signature records. Cannot be undone. If signing is in progress, consider Revoke instead."
        confirmLabel="Delete contract"
        variant="danger"
        onConfirm={async () => { setShowDelete(false); await deleteContract() }}
        onCancel={() => setShowDelete(false)}
      />

      <PromptDialog
        open={showSaveTemplate}
        title="Save as template"
        description="Reusable contract blueprints - instantiate with one click on the next deal."
        defaultValue={contract.name}
        placeholder="Template name"
        confirmLabel="Save template"
        onConfirm={saveAsTemplate}
        onCancel={() => setShowSaveTemplate(false)}
      />

      <EmailShareModal
        open={showEmail}
        onClose={() => setShowEmail(false)}
        resourceLabel="contract"
        resourceTitle={contract.name}
        suggestions={signers
          .filter(s => s.status === 'pending')
          .map<EmailRecipientSuggestion>(s => ({
            id: s.id,
            name: s.name,
            email: s.email,
            badge: s.role === 'tahi' ? 'Tahi' : s.role === 'client' ? 'Client' : undefined,
          }))}
        postUrl={`/api/admin/contracts/${id}/email`}
        mode="signers"
        onSent={({ sent }) => {
          if (sent > 0) {
            showToast(`Sent ${sent} signing email${sent === 1 ? '' : 's'}.`)
            void fetchAll({ silent: true })
          }
        }}
      />
    </BuilderShell>
  )
}

// ─── Signers pane ────────────────────────────────────────────────────────

function SignersPane({
  signers, signerLinks, isLocked, onCopy, onResend, onRemove,
}: {
  signers: Signer[]
  signerLinks: Record<string, string>
  isLocked: boolean
  onCopy: (url: string) => void
  onResend: (signerId: string) => void
  onRemove: (signerId: string) => void
}) {
  if (signers.length === 0) {
    return (
      <div style={{
        padding: '2.25rem 1.5rem',
        background: 'var(--color-bg)',
        border: '1px dashed var(--color-border)',
        borderRadius: 'var(--radius-lg)',
        textAlign: 'center',
      }}>
        <div style={{
          margin: '0 auto 0.75rem',
          width: '2.5rem', height: '2.5rem',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--color-brand-50)',
          color: 'var(--color-brand-dark)',
          borderRadius: '0 16px 0 16px',
        }}>
          <FileSignature size={18} />
        </div>
        <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>No signers yet</h3>
        <p style={{ margin: '0.375rem auto 0', fontSize: '0.8125rem', color: 'var(--color-text-muted)', maxWidth: '24rem', lineHeight: 1.5 }}>
          Add at least one signer (Tahi side and client side) before sending the contract for signature.
        </p>
      </div>
    )
  }

  return (
    <div style={{ display: 'grid', gap: '0.625rem' }}>
      {signers.map(s => (
        <SignerCard
          key={s.id}
          signer={s}
          link={signerLinks[s.id] ?? null}
          isLocked={isLocked}
          onCopy={onCopy}
          onResend={onResend}
          onRemove={onRemove}
        />
      ))}
    </div>
  )
}

function SignerCard({
  signer, link, isLocked, onCopy, onResend, onRemove,
}: {
  signer: Signer
  link: string | null
  isLocked: boolean
  onCopy: (url: string) => void
  onResend: (signerId: string) => void
  onRemove: (signerId: string) => void
}) {
  const palette =
    signer.status === 'signed' ? { fg: '#15803d', bg: '#f0fdf4', bd: '#bbf7d0', label: 'Signed', icon: <Check size={12} /> } :
    signer.status === 'skipped' ? { fg: 'var(--color-text-subtle)', bg: 'var(--color-bg-secondary)', bd: 'var(--color-border-subtle)', label: 'Skipped', icon: <X size={12} /> } :
    { fg: '#9a3412', bg: '#fff7ed', bd: '#fed7aa', label: 'Pending', icon: <Hourglass size={12} /> }

  return (
    <div style={{
      padding: '1rem 1.125rem',
      background: 'var(--color-bg)',
      border: '1px solid var(--color-border-subtle)',
      borderRadius: 'var(--radius-md)',
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>{signer.name}</div>
          <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem' }}>{signer.email}</div>
          <div style={{ fontSize: '0.6875rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-subtle)', fontWeight: 600, marginTop: '0.25rem' }}>
            {signer.role === 'tahi' ? 'Tahi Studio' : signer.role === 'client' ? 'Client' : signer.role}
          </div>
        </div>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            fontSize: '0.6875rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            padding: '0.25rem 0.5rem',
            borderRadius: '999px',
            background: palette.bg,
            color: palette.fg,
            border: `1px solid ${palette.bd}`,
            whiteSpace: 'nowrap',
          }}
        >
          {palette.icon}
          {palette.label}
        </span>
      </div>

      {signer.signedAt && (
        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
          Signed {formatDate(signer.signedAt)}
        </div>
      )}

      {/* Per-signer link & resend (pending only, not locked, link minted) */}
      {signer.status === 'pending' && !isLocked && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px dashed var(--color-border-subtle)', display: 'grid', gap: '0.5rem' }}>
          {link && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <code style={{
                flex: 1,
                fontSize: '0.6875rem',
                color: 'var(--color-text-subtle)',
                background: 'var(--color-bg-secondary)',
                padding: '0.25rem 0.5rem',
                borderRadius: 'var(--radius-sm)',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              }}>
                {link}
              </code>
              <button
                onClick={() => onCopy(link)}
                aria-label="Copy signing link"
                title="Copy signing link"
                style={{ ...toolbarBtn, padding: '0.375rem 0.5rem' }}
              >
                <Copy size={12} />
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem' }}>
            <button
              onClick={() => onResend(signer.id)}
              style={{ ...toolbarBtn, padding: '0.375rem 0.625rem', display: 'inline-flex', alignItems: 'center' }}
              title="Email this signer their signing link"
            >
              <Mail size={12} />
              Resend email
            </button>
            <button
              onClick={() => onRemove(signer.id)}
              style={{ ...toolbarBtn, padding: '0.375rem 0.625rem', color: 'var(--color-text-subtle)', display: 'inline-flex', alignItems: 'center', marginLeft: 'auto' }}
              title="Remove signer"
            >
              <Trash2 size={12} />
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Activity / audit pane ───────────────────────────────────────────────

function ActivityPane({
  contract, signers, signatures,
}: {
  contract: ContractDoc
  signers: Signer[]
  signatures: Signature[]
}) {
  // Build a chronological event stream: created -> sent -> per-signature -> finalised.
  // Each event carries an icon, label, sub-line, and timestamp.
  type Event = {
    icon: React.ReactNode
    title: string
    detail: string | null
    timestamp: string
    accent?: 'brand' | 'success' | 'info' | 'muted'
  }
  const events: Event[] = []

  events.push({
    icon: <FileText size={13} />,
    title: 'Contract created',
    detail: 'Draft saved.',
    timestamp: contract.createdAt,
    accent: 'muted',
  })

  if (contract.sentAt) {
    events.push({
      icon: <Send size={13} />,
      title: 'Sent for signature',
      detail: 'Public share link minted.',
      timestamp: contract.sentAt,
      accent: 'info',
    })
  }

  for (const sig of signatures) {
    const signer = signers.find(s => s.id === sig.signerId)
    events.push({
      icon: <FileSignature size={13} />,
      title: `${signer?.name ?? 'Signer'} signed`,
      detail: sig.country ? `From ${sig.country}` : null,
      timestamp: sig.signedAt,
      accent: 'success',
    })
  }

  if (contract.signedAt) {
    events.push({
      icon: <Check size={13} />,
      title: 'Fully signed',
      detail: contract.finalHash ? 'Final chain hash anchored.' : null,
      timestamp: contract.signedAt,
      accent: 'brand',
    })
  }

  // Sort ascending by time.
  events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return (
    <div style={{ display: 'grid', gap: '1.5rem' }}>
      {/* Timeline */}
      <section style={{ padding: '1.25rem 1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
          <Activity size={14} style={{ color: 'var(--color-brand)' }} />
          <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Timeline</h3>
        </div>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: '0.875rem' }}>
          {events.map((e, i) => {
            const accentColor =
              e.accent === 'brand' ? 'var(--color-brand)' :
              e.accent === 'success' ? '#15803d' :
              e.accent === 'info' ? '#1e40af' :
              'var(--color-text-muted)'
            return (
              <li key={i} style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
                <span style={{
                  flexShrink: 0,
                  width: '1.5rem',
                  height: '1.5rem',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'var(--color-bg-secondary)',
                  border: '1px solid var(--color-border-subtle)',
                  borderRadius: '0 8px 0 8px',
                  color: accentColor,
                }}>
                  {e.icon}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--color-text)' }}>{e.title}</div>
                  {e.detail && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>{e.detail}</div>}
                  <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', marginTop: '0.125rem' }}>{formatDate(e.timestamp)}</div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* Signature audit */}
      {signatures.length > 0 && (
        <section style={{ padding: '1.25rem 1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
            <ShieldCheck size={14} style={{ color: 'var(--color-brand)' }} />
            <h3 style={{ margin: 0, fontSize: '0.9375rem', fontWeight: 700, color: 'var(--color-text)' }}>Signature audit</h3>
          </div>
          <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: '0 0 0.875rem 0', lineHeight: 1.55 }}>
            Each signature is anchored to a SHA-256 chain. Tampering with any earlier signature breaks every later chain hash.
          </p>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {signatures.map((sig, idx) => {
              const signer = signers.find(s => s.id === sig.signerId)
              return (
                <div key={sig.id} style={{ padding: '0.875rem 1rem', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <div>
                      <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)' }}>
                        {signer?.name ?? 'Unknown signer'}
                        <span style={{ fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)', marginLeft: '0.5rem' }}>
                          · #{idx + 1} in chain
                        </span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.125rem', display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
                        <span>{formatDate(sig.signedAt)}</span>
                        {sig.country && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                            <Globe size={11} />
                            {sig.country}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={sig.signatureDataUrl} alt="signature" style={{ height: '2.25rem', maxWidth: '8rem' }} />
                  </div>
                  <div style={{ marginTop: '0.5rem', display: 'grid', gap: '0.25rem' }}>
                    <HashRow label="Chain" value={sig.chainHash} />
                    {sig.ipHash && <HashRow label="IP hash" value={sig.ipHash} truncate />}
                  </div>
                </div>
              )
            })}
          </div>
          {contract.finalHash && (
            <div style={{ marginTop: '0.875rem', paddingTop: '0.75rem', borderTop: '1px solid var(--color-border-subtle)' }}>
              <HashRow label="Final hash" value={contract.finalHash} accent />
            </div>
          )}
        </section>
      )}
    </div>
  )
}

// ─── Hash row (collapsed by default, click to expand → click to copy) ───

function HashRow({
  label, value, accent = false, truncate = false,
}: {
  label: string
  value: string
  accent?: boolean
  truncate?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const display = truncate
    ? `${value.slice(0, 12)}...`
    : expanded
      ? value
      : `${value.slice(0, 12)}...${value.slice(-6)}`
  const colour = accent ? 'var(--color-brand-dark)' : 'var(--color-text-subtle)'

  function handleClick() {
    if (truncate) {
      navigator.clipboard.writeText(value).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      return
    }
    if (!expanded) {
      setExpanded(true)
      return
    }
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: '0.5rem',
        maxWidth: '100%',
        padding: 0,
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
        textAlign: 'left',
      }}
      title={truncate ? 'Click to copy' : expanded ? 'Click to copy' : 'Click to expand'}
    >
      <span style={{ fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0, color: colour }}>
        {label}
      </span>
      <span style={{
        fontSize: '0.6875rem',
        fontFamily: 'ui-monospace, SFMono-Regular, monospace',
        minWidth: 0,
        color: colour,
        overflowWrap: 'anywhere',
        wordBreak: 'break-all',
      }}>
        {copied ? 'Copied!' : display}
      </span>
    </button>
  )
}

// ─── Add signer dialog ───────────────────────────────────────────────────

function AddSignerDialog({
  contractId, onClose, onAdded,
}: {
  contractId: string
  onClose: () => void
  onAdded: () => void
}) {
  const [role, setRole] = useState<'tahi' | 'client' | 'other'>('client')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !email.trim()) {
      setError('Name and email required')
      return
    }
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
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-[var(--color-bg)] rounded-xl shadow-xl w-full max-w-sm" role="dialog" aria-modal="true">
        <div className="px-6 pt-6 pb-2">
          <h2 className="text-lg font-bold text-[var(--color-text)]">Add signer</h2>
          <p className="text-sm text-[var(--color-text-muted)] mt-1">Tahi side and client side both need to sign before the contract is fully executed.</p>
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
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="signer-name" className="block text-xs font-medium text-[var(--color-text)] mb-1">Name</label>
            <input id="signer-name" type="text" value={name} onChange={e => setName(e.target.value)} className={inputCn} placeholder="Full legal name" />
          </div>
          <div>
            <label htmlFor="signer-email" className="block text-xs font-medium text-[var(--color-text)] mb-1">Email</label>
            <input id="signer-email" type="email" value={email} onChange={e => setEmail(e.target.value)} className={inputCn} placeholder="signatory@example.com" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium rounded-lg text-[var(--color-text-muted)] hover:bg-[var(--color-bg-secondary)]">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 text-sm font-semibold rounded-lg text-white" style={{ background: 'var(--color-brand)' }}>
              {saving ? 'Adding...' : 'Add signer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
