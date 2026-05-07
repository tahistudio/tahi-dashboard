'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, Share2, Copy, Star, ExternalLink, Mail, BookmarkPlus, Eye, ChevronUp, ChevronDown } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { useToast } from '@/components/tahi/toast'
import { ShareAnalyticsCard } from '@/components/tahi/share-analytics-card'
import { EmailShareModal, type EmailRecipientSuggestion } from '@/components/tahi/email-share-modal'
import { TypedSectionFields } from './section-editors'
import { defaultDataForType, type SectionType } from '@/app/p/proposal/[token]/section-blocks'
import { TiptapDocEditor } from '@/components/tahi/tiptap-doc-editor'
import { PromptDialog } from '@/components/tahi/prompt-dialog'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { LinkedToPanel } from '@/components/tahi/linked-to-panel'

interface Proposal {
  id: string
  orgId: string | null
  dealId: string | null
  title: string
  subtitle: string | null
  preparedFor: string | null
  preparedBy: string | null
  effectiveDate: string | null
  expiresAt: string | null
  status: string
  publicShareToken: string | null
  publicSharedAt: string | null
  decidedAt: string | null
  decidedVariantId: string | null
  publishedAt: string | null
  coverTheme: 'light' | 'dark' | null
  orgName: string | null
  dealTitle: string | null
  createdAt: string
  updatedAt: string
}

interface Section {
  id: string
  proposalId: string
  type: string
  title: string | null
  subtitle: string | null
  data: string | null
  position: number
}

interface Variant {
  id: string
  proposalId: string
  name: string
  tagline: string | null
  oneOffAmount: number
  monthlyAmount: number
  currency: string
  scopeHtml: string | null
  pricingNotesHtml: string | null
  timelineScheduleId: string | null
  ctaLabel: string | null
  isFeatured: number
  position: number
}

interface Acceptance {
  id: string
  variantId: string | null
  status: string
  acceptorName: string | null
  acceptorEmail: string | null
  acceptorRole: string | null
  comment: string | null
  acceptorCountry: string | null
  acceptedAt: string
}

// Two groups so the picker leads with the workhorses (sections that show up
// in almost every proposal) and tucks the situational types under "More".
// Testimonials + FAQ stay in the workhorse group because they earn their
// place on $25k+ projects.
const SECTION_TYPE_GROUPS = [
  {
    label: 'Common',
    items: [
      { value: 'overview', label: 'Overview' },
      { value: 'value_anchor', label: 'Value anchor (the math)' },
      { value: 'process', label: 'Our process' },
      { value: 'retainer_offer', label: 'Retainer offer (10% lifetime)' },
      { value: 'case_study', label: 'Case studies' },
      { value: 'testimonial_stack', label: 'Testimonial stack' },
      { value: 'faq', label: 'FAQ' },
      { value: 'terms', label: 'Terms' },
    ],
  },
  {
    label: 'Other',
    items: [
      { value: 'differentiators', label: 'Why us (icon grid)' },
      { value: 'guarantee', label: 'Guarantee / promise' },
      { value: 'testimonial', label: 'Testimonial (single)' },
      { value: 'about', label: 'About Tahi' },
      { value: 'scope_shared', label: 'Shared scope' },
      { value: 'text', label: 'Custom text' },
    ],
  },
] as const

// Flat reference for any legacy code that needs the full list.
const SECTION_TYPES: ReadonlyArray<{ value: string; label: string }> =
  SECTION_TYPE_GROUPS.flatMap(g => [...g.items])

// Section types that have structured editors (handled by TypedSectionFields).
// All others fall back to the legacy HTML/quote inputs.
const STRUCTURED_TYPES = new Set<string>([
  'value_anchor', 'process', 'differentiators', 'case_study',
  'testimonial_stack', 'faq', 'guarantee', 'retainer_offer',
])

export function ProposalDetail({ proposalId }: { proposalId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [loading, setLoading] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; email: string; isPrimary: number }>>([])

  // Lazy-load contacts the first time the email modal opens.
  async function ensureContacts() {
    if (!proposal?.orgId || contacts.length > 0) return
    try {
      const res = await fetch(apiPath(`/api/admin/clients/${proposal.orgId}/contacts`))
      if (!res.ok) return
      const data = await res.json() as { contacts: Array<{ id: string; name: string; email: string; isPrimary: number }> }
      setContacts(data.contacts ?? [])
    } catch { /* silent */ }
  }

  const fetchAll = useCallback(async (opts: { silent?: boolean } = {}) => {
    if (!opts.silent) setLoading(true)
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}`))
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { proposal: Proposal; sections: Section[]; variants: Variant[]; acceptances: Acceptance[] }
      setProposal(data.proposal)
      setSections(data.sections ?? [])
      setVariants(data.variants ?? [])
      setAcceptances(data.acceptances ?? [])
    } catch {
      // silent
    } finally {
      if (!opts.silent) setLoading(false)
    }
  }, [proposalId])

  useEffect(() => { void fetchAll() }, [fetchAll])

  // ── Top-level patch (save on blur) ───────────────────────────────────
  async function patchProposal(changes: Partial<Proposal>) {
    setProposal(prev => prev ? { ...prev, ...changes } : prev)
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    } catch {
      showToast('Failed to save', 'error')
    }
  }

  // ── Section CRUD ─────────────────────────────────────────────────────
  async function addSection(type: string) {
    const meta: Record<string, { title: string; subtitle: string | null }> = {
      overview: { title: 'Executive overview', subtitle: 'How we approach this' },
      value_anchor: { title: 'Why hiring separately costs more', subtitle: 'The math' },
      process: { title: 'How we work', subtitle: 'Our process, end to end' },
      differentiators: { title: 'Why teams pick Tahi', subtitle: 'What sets us apart' },
      case_study: { title: 'Recent work', subtitle: 'Selected case studies' },
      testimonial_stack: { title: 'What clients say', subtitle: 'In their words' },
      testimonial: { title: 'What clients say', subtitle: null },
      faq: { title: 'Common questions', subtitle: 'Things teams ask before signing' },
      guarantee: { title: 'Our promise to you', subtitle: 'No surprises' },
      retainer_offer: { title: 'Your 10% lifetime discount', subtitle: 'Already earned' },
      about: { title: 'About Tahi Studio', subtitle: 'Who we are' },
      terms: { title: 'Terms', subtitle: 'Engagement terms' },
      scope_shared: { title: 'Scope', subtitle: 'What every package includes' },
      text: { title: 'New section', subtitle: null },
    }
    const seed = meta[type] ?? meta.text
    const data = defaultDataForType(type as SectionType)
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}/sections`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, title: seed.title, subtitle: seed.subtitle, data }),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchAll({ silent: true })
    } catch {
      showToast('Failed to add section', 'error')
    }
  }
  async function patchSection(sectionId: string, changes: SectionPatch) {
    setSections(prev => prev.map(s => {
      if (s.id !== sectionId) return s
      const next: Section = { ...s }
      if (changes.type !== undefined) next.type = changes.type
      if (changes.title !== undefined) next.title = changes.title
      if (changes.subtitle !== undefined) next.subtitle = changes.subtitle
      if (changes.position !== undefined) next.position = changes.position
      if (changes.data !== undefined) next.data = JSON.stringify(changes.data)
      return next
    }))
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}/sections/${sectionId}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    } catch {
      showToast('Failed to save section', 'error')
    }
  }
  async function deleteSection(sectionId: string) {
    setSections(prev => prev.filter(s => s.id !== sectionId))
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}/sections/${sectionId}`), { method: 'DELETE' })
    } catch {
      await fetchAll({ silent: true })
      showToast('Failed to delete section', 'error')
    }
  }

  // Reorder by swapping a section with its neighbor. Optimistic UI: we
  // swap locally first, then persist both new positions. A failed write
  // refetches the truth so we never end up out of sync.
  async function moveSection(sectionId: string, dir: -1 | 1) {
    const sorted = [...sections].sort((a, b) => a.position - b.position)
    const idx = sorted.findIndex(s => s.id === sectionId)
    if (idx < 0) return
    const target = idx + dir
    if (target < 0 || target >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[target]
    // Optimistic local swap
    setSections(prev => prev.map(s => {
      if (s.id === a.id) return { ...s, position: b.position }
      if (s.id === b.id) return { ...s, position: a.position }
      return s
    }))
    try {
      await Promise.all([
        fetch(apiPath(`/api/admin/proposals/${proposalId}/sections/${a.id}`), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: b.position }),
        }),
        fetch(apiPath(`/api/admin/proposals/${proposalId}/sections/${b.id}`), {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ position: a.position }),
        }),
      ])
    } catch {
      await fetchAll({ silent: true })
      showToast('Failed to reorder', 'error')
    }
  }

  // ── Variant CRUD ─────────────────────────────────────────────────────
  async function addVariant() {
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}/variants`), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: `Package ${variants.length + 1}`,
          oneOffAmount: 0,
          monthlyAmount: 0,
          currency: 'NZD',
        }),
      })
      if (!res.ok) throw new Error('Failed')
      await fetchAll({ silent: true })
    } catch {
      showToast('Failed to add variant', 'error')
    }
  }
  async function patchVariant(variantId: string, changes: Partial<Variant>) {
    setVariants(prev => prev.map(v => v.id === variantId ? { ...v, ...changes } : v))
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}/variants/${variantId}`), {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(changes),
      })
    } catch {
      showToast('Failed to save variant', 'error')
    }
  }
  async function deleteVariant(variantId: string) {
    setVariants(prev => prev.filter(v => v.id !== variantId))
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}/variants/${variantId}`), { method: 'DELETE' })
    } catch {
      await fetchAll({ silent: true })
      showToast('Failed to delete variant', 'error')
    }
  }

  // ── Publish (draft / publish model — Phase 9) ───────────────────────
  // Admin edits sections/variants live (auto-save). The public viewer
  // reads from the published snapshot, so changes don't leak until the
  // admin clicks Publish.
  const [publishing, setPublishing] = useState(false)
  async function handlePublish() {
    setPublishing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}/publish`), { method: 'POST' })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json() as { publishedAt: string }
      setProposal(prev => prev ? { ...prev, publishedAt: data.publishedAt } : prev)
      showToast('Published. Public viewer now shows the latest version.', 'success')
    } catch {
      showToast('Failed to publish', 'error')
    } finally {
      setPublishing(false)
    }
  }

  // ── Sharing ──────────────────────────────────────────────────────────
  async function handleShare() {
    setSharing(true)
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}/share`), { method: 'POST' })
      const data = await res.json() as { token?: string }
      if (!res.ok || !data.token) throw new Error('Failed')
      setProposal(prev => prev ? { ...prev, status: 'shared', publicShareToken: data.token! } : prev)
      const url = `${window.location.origin}/dashboard/p/proposal/${data.token}`
      try { await navigator.clipboard.writeText(url); showToast('Public link copied', 'success') }
      catch { showToast('Public link ready', 'success') }
    } catch {
      showToast('Failed to share', 'error')
    } finally {
      setSharing(false)
    }
  }
  async function handleUnshare() {
    setSharing(true)
    try {
      await fetch(apiPath(`/api/admin/proposals/${proposalId}/share`), { method: 'DELETE' })
      setProposal(prev => prev ? { ...prev, status: 'draft', publicShareToken: null } : prev)
      showToast('Public link revoked', 'success')
    } catch {
      showToast('Failed to revoke', 'error')
    } finally {
      setSharing(false)
    }
  }

  const [showSaveTemplate, setShowSaveTemplate] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  async function saveAsTemplate(name: string) {
    try {
      const res = await fetch(apiPath('/api/admin/proposals/templates'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          fromProposalId: proposalId,
        }),
      })
      if (!res.ok) throw new Error('Failed')
      showToast('Template saved.', 'success')
      setShowSaveTemplate(false)
    } catch {
      showToast('Could not save template.', 'error')
    }
  }

  async function deleteProposal() {
    try {
      const res = await fetch(apiPath(`/api/admin/proposals/${proposalId}`), { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      showToast('Proposal deleted', 'success')
      router.push('/proposals')
    } catch {
      showToast('Failed to delete', 'error')
    }
  }

  if (loading || !proposal) {
    return (
      <div style={{ padding: '1.5rem' }}>
        <div className="animate-pulse rounded-xl" style={{ height: '8rem', background: 'var(--color-bg-secondary)', marginBottom: '1rem' }} />
        <div className="animate-pulse rounded-xl" style={{ height: '20rem', background: 'var(--color-bg-secondary)' }} />
      </div>
    )
  }

  const publicUrl = proposal.publicShareToken
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/dashboard/p/proposal/${proposal.publicShareToken}`
    : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
      <Link href="/proposals" className="inline-flex items-center" style={{ fontSize: '0.8125rem', color: 'var(--color-text-muted)', textDecoration: 'none', gap: '0.375rem' }}>
        <ArrowLeft size={14} />
        All proposals
      </Link>

      {/* Cover header — editable */}
      <div style={{ padding: '1.5rem 1.75rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <input
          type="text"
          value={proposal.subtitle ?? ''}
          onChange={e => setProposal(p => p ? { ...p, subtitle: e.target.value } : p)}
          onBlur={e => patchProposal({ subtitle: e.currentTarget.value || null })}
          placeholder="PROPOSAL"
          style={{ display: 'block', width: '100%', fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', background: 'transparent', border: 'none', padding: 0, marginBottom: '0.5rem', outline: 'none' }}
        />
        <input
          type="text"
          value={proposal.title}
          onChange={e => setProposal(p => p ? { ...p, title: e.target.value } : p)}
          onBlur={e => patchProposal({ title: e.currentTarget.value || 'Untitled' })}
          style={{ display: 'block', width: '100%', fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text)', background: 'transparent', border: 'none', padding: 0, outline: 'none', marginBottom: '1rem' }}
        />
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '1rem' }}>
          <FieldGroup label="Prepared for">
            <input type="text" value={proposal.preparedFor ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedFor: e.target.value } : p)} onBlur={e => patchProposal({ preparedFor: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Prepared by">
            <input type="text" value={proposal.preparedBy ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedBy: e.target.value } : p)} onBlur={e => patchProposal({ preparedBy: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Effective">
            <input type="date" value={proposal.effectiveDate ?? ''} onChange={e => patchProposal({ effectiveDate: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Expires">
            <input type="date" value={proposal.expiresAt ?? ''} onChange={e => patchProposal({ expiresAt: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Cover theme">
            <div className="flex" style={{ gap: '0.375rem' }}>
              {(['light', 'dark'] as const).map(t => {
                const active = (proposal.coverTheme ?? 'light') === t
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => {
                      setProposal(p => p ? { ...p, coverTheme: t } : p)
                      void patchProposal({ coverTheme: t })
                    }}
                    style={{
                      flex: 1,
                      padding: '0.4375rem 0.625rem',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      background: active ? (t === 'dark' ? '#1f2c1a' : '#FFFFFF') : 'var(--color-bg)',
                      color: active ? (t === 'dark' ? '#FFFFFF' : '#121A0F') : 'var(--color-text-muted)',
                      border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
                      borderRadius: 'var(--radius-sm)',
                      cursor: 'pointer',
                      textTransform: 'capitalize',
                    }}
                  >
                    {t}
                  </button>
                )
              })}
            </div>
          </FieldGroup>
        </div>
      </div>

      {/* Linked to — client + deal cross-link with activity logging */}
      <LinkedToPanel
        resourceType="proposal"
        resourceId={proposalId}
        orgId={proposal.orgId}
        dealId={proposal.dealId}
        orgName={proposal.orgName}
        dealTitle={proposal.dealTitle}
        onChanged={() => void fetchAll({ silent: true })}
      />

      {/* Publish indicator — shows when admin has unpublished edits */}
      {(() => {
        const hasUnpublished =
          !proposal.publishedAt ||
          (proposal.updatedAt && new Date(proposal.updatedAt).getTime() > new Date(proposal.publishedAt).getTime() + 1000)
        if (!hasUnpublished) return null
        return (
          <div className="flex flex-wrap items-center justify-between" style={{
            padding: '0.625rem 0.875rem',
            background: '#fff7ed',
            color: '#9a3412',
            border: '1px solid #fed7aa',
            borderRadius: 'var(--radius-lg)',
            gap: '0.75rem',
          }}>
            <div style={{ fontSize: '0.8125rem', fontWeight: 500 }}>
              <strong>Unpublished changes.</strong> The public viewer is still showing
              {proposal.publishedAt ? ' the last published version' : ' nothing — publish to share with the client'}.
            </div>
            <button
              onClick={handlePublish}
              disabled={publishing}
              className="inline-flex items-center"
              style={{
                padding: '0.4375rem 0.875rem',
                fontSize: '0.8125rem',
                fontWeight: 600,
                background: 'var(--color-brand)',
                color: 'white',
                border: 'none',
                borderRadius: 'var(--radius-leaf-sm)',
                cursor: publishing ? 'wait' : 'pointer',
                opacity: publishing ? 0.7 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              {publishing ? 'Publishing…' : 'Publish'}
            </button>
          </div>
        )
      })()}

      {/* Toolbar — share + delete */}
      <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
        <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', padding: '0.25rem 0.625rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-full)', border: '1px solid var(--color-border-subtle)' }}>
          Status: {proposal.status}
        </span>
        {proposal.publishedAt && (
          <span style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-muted)' }}>
            Published {new Date(proposal.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </span>
        )}
        <div style={{ flex: 1 }} />
        <Link href={`/preview/proposal/${proposalId}`} target="_blank" rel="noreferrer" className="inline-flex items-center" style={toolbarBtn}>
          <Eye size={13} />
          Preview
        </Link>
        {publicUrl ? (
          <>
            <button onClick={() => { void ensureContacts(); setShowEmail(true) }} className="inline-flex items-center" style={toolbarPrimary}>
              <Mail size={13} />
              Email link
            </button>
            <button onClick={() => { navigator.clipboard.writeText(publicUrl).then(() => showToast('Public link copied', 'success')) }} className="inline-flex items-center" style={toolbarBtn} title={publicUrl}>
              <Copy size={13} />
              Copy link
            </button>
            <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center" style={toolbarBtn}>
              <ExternalLink size={13} />
              Open
            </a>
            <button onClick={handleUnshare} disabled={sharing} className="inline-flex items-center" style={{ ...toolbarBtn, color: 'var(--color-danger)' }}>
              Revoke
            </button>
          </>
        ) : (
          <button onClick={handleShare} disabled={sharing} className="inline-flex items-center" style={toolbarPrimary}>
            <Share2 size={13} />
            {sharing ? 'Generating…' : 'Get public link'}
          </button>
        )}
        <button onClick={() => setShowSaveTemplate(true)} className="inline-flex items-center" style={toolbarBtn} title="Save the current sections + variants as a reusable template">
          <BookmarkPlus size={13} />
          Save as template
        </button>
        <button onClick={() => setShowDeleteConfirm(true)} className="inline-flex items-center" style={{ ...toolbarBtn, color: 'var(--color-text-subtle)' }}>
          <Trash2 size={13} />
          Delete
        </button>
      </div>

      {/* Sections */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Shared sections</h2>
          <select
            onChange={e => { if (e.target.value) { addSection(e.target.value); e.target.value = '' } }}
            defaultValue=""
            style={{ ...metaInputStyle, width: 'auto', minWidth: '12rem', cursor: 'pointer' }}
          >
            <option value="" disabled>+ Add section…</option>
            {SECTION_TYPE_GROUPS.map(group => (
              <optgroup key={group.label} label={group.label}>
                {group.items.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
        {sections.length === 0 ? (
          <div style={emptyHint}>No sections yet. Use the dropdown to add one.</div>
        ) : (
          <div className="flex flex-col" style={{ gap: '0.75rem' }}>
            {[...sections].sort((a, b) => a.position - b.position).map((s, i, sorted) => (
              <SectionEditor
                key={s.id}
                section={s}
                isFirst={i === 0}
                isLast={i === sorted.length - 1}
                onChange={changes => patchSection(s.id, changes)}
                onDelete={() => deleteSection(s.id)}
                onMoveUp={() => moveSection(s.id, -1)}
                onMoveDown={() => moveSection(s.id, 1)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Variants */}
      <div>
        <div className="flex items-center justify-between" style={{ marginBottom: '0.75rem' }}>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: 0 }}>Packages (variants)</h2>
          <button onClick={addVariant} className="inline-flex items-center" style={toolbarBtn}>
            <Plus size={13} />
            Add package
          </button>
        </div>
        {variants.length === 0 ? (
          <div style={emptyHint}>No packages yet. Add at least one.</div>
        ) : (
          <div className="flex flex-col" style={{ gap: '0.75rem' }}>
            {variants.map(v => (
              <VariantEditor
                key={v.id}
                variant={v}
                onChange={changes => patchVariant(v.id, changes)}
                onDelete={() => deleteVariant(v.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Decisions + questions log */}
      {acceptances.length > 0 && (
        <div>
          <h2 style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--color-text)', margin: '0 0 0.75rem 0' }}>
            Decisions &amp; questions
          </h2>
          <div className="flex flex-col" style={{ gap: '0.5rem' }}>
            {acceptances.map(a => {
              const variantName = a.variantId ? variants.find(v => v.id === a.variantId)?.name : null
              const palette =
                a.status === 'accepted' ? { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', label: 'Accepted' } :
                a.status === 'declined' ? { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Declined' } :
                a.status === 'question' ? { color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', label: 'Question / tweak request' } :
                { color: 'var(--color-text-muted)', bg: 'var(--color-bg-tertiary)', border: 'var(--color-border-subtle)', label: a.status }
              return (
                <div key={a.id} style={{ padding: '0.75rem 1rem', border: `1px solid ${palette.border}`, background: palette.bg, borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.5rem' }}>
                    <strong style={{ color: palette.color }}>{palette.label}</strong>
                    {variantName && <span style={{ color: 'var(--color-text-muted)' }}>· {variantName}</span>}
                    {a.acceptorName && <span style={{ color: 'var(--color-text-muted)' }}>· {a.acceptorName}</span>}
                    {a.acceptorEmail && <span style={{ color: 'var(--color-text-subtle)' }}>· {a.acceptorEmail}</span>}
                    <span style={{ color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>{new Date(a.acceptedAt).toLocaleString()}</span>
                  </div>
                  {a.comment && (
                    <p style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
                      {a.status === 'question' ? a.comment : `“${a.comment}”`}
                    </p>
                  )}
                  {a.status === 'question' && a.acceptorEmail && (
                    <a
                      href={`mailto:${a.acceptorEmail}?subject=${encodeURIComponent('Re: ' + (proposal?.title ?? 'your proposal'))}`}
                      style={{ display: 'inline-block', marginTop: '0.5rem', fontSize: '0.75rem', fontWeight: 600, color: '#1e40af' }}
                    >
                      Reply via email →
                    </a>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Analytics */}
      {proposal.publicShareToken && (
        <ShareAnalyticsCard resourceType="proposal" resourceId={proposalId} />
      )}

      <EmailShareModal
        open={showEmail}
        onClose={() => setShowEmail(false)}
        resourceLabel="proposal"
        resourceTitle={proposal.title}
        suggestions={contacts.map<EmailRecipientSuggestion>(c => ({
          id: c.id,
          name: c.name,
          email: c.email,
          badge: c.isPrimary ? 'Primary' : undefined,
        }))}
        postUrl={`/api/admin/proposals/${proposalId}/email`}
        mode="recipients"
        onSent={({ sent }) => {
          if (sent > 0) showToast(`Sent ${sent} email${sent === 1 ? '' : 's'}.`)
        }}
      />

      <PromptDialog
        open={showSaveTemplate}
        title="Save as template"
        description="Reusable proposal blueprints — instantiate with one click on the next deal."
        defaultValue={proposal?.title ?? ''}
        placeholder="Template name"
        confirmLabel="Save template"
        onConfirm={saveAsTemplate}
        onCancel={() => setShowSaveTemplate(false)}
      />

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this proposal?"
        description="This permanently removes the proposal, every section, and every variant. Cannot be undone."
        confirmLabel="Delete proposal"
        variant="danger"
        onConfirm={async () => { setShowDeleteConfirm(false); await deleteProposal() }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  )
}

// ─── Section editor (per-type) ───────────────────────────────────────────

interface SectionPatch {
  type?: string
  title?: string | null
  subtitle?: string | null
  position?: number
  data?: unknown
}

function SectionEditor({ section, onChange, onDelete, onMoveUp, onMoveDown, isFirst, isLast }: {
  section: Section
  onChange: (changes: SectionPatch) => void
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  isFirst?: boolean
  isLast?: boolean
}) {
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (!section.data) return {}
    try { return JSON.parse(section.data) as Record<string, unknown> } catch { return {} }
  })

  const setField = (key: string, value: unknown) => {
    setData(prev => ({ ...prev, [key]: value }))
  }
  const flush = () => onChange({ data })

  return (
    <details open style={{ border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}>
      <summary style={{ padding: '0.625rem 0.875rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
        <span>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginRight: '0.5rem' }}>
            {section.type}
          </span>
          {section.title || '(no title)'}
        </span>
        <span className="flex items-center" style={{ gap: '0.25rem' }}>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMoveUp?.() }}
            disabled={isFirst}
            aria-label="Move section up"
            title="Move up"
            style={{ ...toolbarBtn, padding: '0.25rem 0.4375rem', opacity: isFirst ? 0.35 : 1, cursor: isFirst ? 'not-allowed' : 'pointer' }}
          >
            <ChevronUp size={12} />
          </button>
          <button
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMoveDown?.() }}
            disabled={isLast}
            aria-label="Move section down"
            title="Move down"
            style={{ ...toolbarBtn, padding: '0.25rem 0.4375rem', opacity: isLast ? 0.35 : 1, cursor: isLast ? 'not-allowed' : 'pointer' }}
          >
            <ChevronDown size={12} />
          </button>
          <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete() }} style={{ ...toolbarBtn, padding: '0.25rem 0.625rem' }}>
            <Trash2 size={12} />
          </button>
        </span>
      </summary>
      <div style={{ padding: '0.75rem 0.875rem', borderTop: '1px solid var(--color-border-subtle)', display: 'grid', gap: '0.625rem' }}>
        <FieldGroup label="Title">
          <input type="text" value={section.title ?? ''} onChange={e => onChange({ title: e.target.value })} style={metaInputStyle} />
        </FieldGroup>
        <FieldGroup label="Subtitle (eyebrow)">
          <input type="text" value={section.subtitle ?? ''} onChange={e => onChange({ subtitle: e.target.value })} style={metaInputStyle} />
        </FieldGroup>
        {/* Theme toggle — light vs dark slide. Renderer reads section.data.theme. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ fontSize: '0.6875rem', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            Slide theme
          </span>
          {(['light', 'dark'] as const).map(t => {
            const active = (data.theme ?? 'light') === t
            return (
              <button
                key={t}
                type="button"
                onClick={() => { const next = { ...data, theme: t }; setData(next); onChange({ data: next }) }}
                style={{
                  padding: '0.3125rem 0.625rem',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  background: active ? (t === 'dark' ? '#1f2c1a' : '#FFFFFF') : 'var(--color-bg)',
                  color: active ? (t === 'dark' ? '#FFFFFF' : '#121A0F') : 'var(--color-text-muted)',
                  border: `1px solid ${active ? 'var(--color-brand)' : 'var(--color-border)'}`,
                  borderRadius: 'var(--radius-sm)',
                  cursor: 'pointer',
                  textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            )
          })}
        </div>
        {STRUCTURED_TYPES.has(section.type) ? (
          <TypedSectionFields
            type={section.type}
            data={data}
            onChange={(next) => { setData(next); onChange({ data: next }) }}
          />
        ) : section.type === 'testimonial' ? (
          <>
            <FieldGroup label="Quote">
              <textarea value={String(data.quote ?? '')} onChange={e => setField('quote', e.target.value)} onBlur={flush} rows={3} style={{ ...metaInputStyle, fontFamily: 'inherit' }} />
            </FieldGroup>
            <FieldGroup label="Author">
              <input type="text" value={String(data.author ?? '')} onChange={e => setField('author', e.target.value)} onBlur={flush} style={metaInputStyle} />
            </FieldGroup>
            <FieldGroup label="Author role">
              <input type="text" value={String(data.role ?? '')} onChange={e => setField('role', e.target.value)} onBlur={flush} style={metaInputStyle} />
            </FieldGroup>
          </>
        ) : (
          <FieldGroup label="Content">
            <TiptapDocEditor
              content={String(data.html ?? '')}
              onChange={(html) => {
                setData(prev => ({ ...prev, html }))
                onChange({ data: { ...data, html } })
              }}
              placeholder="Start writing your section…"
            />
          </FieldGroup>
        )}
      </div>
    </details>
  )
}

function VariantEditor({ variant, onChange, onDelete }: {
  variant: Variant
  onChange: (changes: Partial<Variant>) => void
  onDelete: () => void
}) {
  return (
    <details open style={{ border: variant.isFeatured ? '2px solid var(--color-brand)' : '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}>
      <summary style={{ padding: '0.625rem 0.875rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
        <span>
          {variant.isFeatured ? <Star size={12} style={{ color: 'var(--color-brand)', marginRight: '0.25rem' }} /> : null}
          {variant.name} · {variant.currency} {variant.oneOffAmount.toLocaleString()}{variant.monthlyAmount > 0 ? ` + ${variant.monthlyAmount.toLocaleString()}/mo` : ''}
        </span>
        <button onClick={(e) => { e.preventDefault(); onDelete() }} style={{ ...toolbarBtn, padding: '0.25rem 0.625rem' }}>
          <Trash2 size={12} />
        </button>
      </summary>
      <div style={{ padding: '0.75rem 0.875rem', borderTop: '1px solid var(--color-border-subtle)', display: 'grid', gap: '0.625rem' }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.625rem' }}>
          <FieldGroup label="Name">
            <input type="text" value={variant.name} onChange={e => onChange({ name: e.target.value })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Tagline">
            <input type="text" value={variant.tagline ?? ''} onChange={e => onChange({ tagline: e.target.value })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="One-off amount">
            <input type="number" value={variant.oneOffAmount} onChange={e => onChange({ oneOffAmount: parseInt(e.target.value, 10) || 0 })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Monthly amount">
            <input type="number" value={variant.monthlyAmount} onChange={e => onChange({ monthlyAmount: parseInt(e.target.value, 10) || 0 })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Currency">
            <select value={variant.currency} onChange={e => onChange({ currency: e.target.value })} style={{ ...metaInputStyle, cursor: 'pointer' }}>
              {['NZD', 'USD', 'AUD', 'GBP', 'EUR'].map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </FieldGroup>
          <FieldGroup label="CTA label">
            <input type="text" value={variant.ctaLabel ?? ''} placeholder="Accept this package" onChange={e => onChange({ ctaLabel: e.target.value })} style={metaInputStyle} />
          </FieldGroup>
        </div>
        <FieldGroup label="Scope — what's included in this package">
          <TiptapDocEditor
            content={variant.scopeHtml ?? ''}
            onChange={(html) => onChange({ scopeHtml: html })}
            placeholder="Use bullet lists for the feature checklist that powers the variant compare table."
          />
        </FieldGroup>
        <FieldGroup label="Pricing notes (optional)">
          <TiptapDocEditor
            content={variant.pricingNotesHtml ?? ''}
            onChange={(html) => onChange({ pricingNotesHtml: html })}
            placeholder="e.g. 50% on signing, 50% on launch."
          />
        </FieldGroup>
        <label className="inline-flex items-center" style={{ gap: '0.5rem', fontSize: '0.8125rem', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={!!variant.isFeatured} onChange={e => onChange({ isFeatured: e.target.checked ? 1 : 0 })} />
          Featured / recommended
        </label>
      </div>
    </details>
  )
}

const metaInputStyle: React.CSSProperties = {
  width: '100%',
  padding: '0.375rem 0.5rem',
  fontSize: '0.8125rem',
  fontWeight: 500,
  background: 'var(--color-bg-secondary)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--color-text)',
}

function FieldGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.25rem' }}>
        {label}
      </div>
      {children}
    </div>
  )
}

const toolbarBtn: React.CSSProperties = {
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 500,
  background: 'var(--color-bg)',
  color: 'var(--color-text-muted)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-md)',
  gap: '0.375rem',
  cursor: 'pointer',
  textDecoration: 'none',
}

const toolbarPrimary: React.CSSProperties = {
  padding: '0.4375rem 0.75rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--color-brand)',
  color: 'white',
  border: 'none',
  borderRadius: 'var(--radius-md)',
  gap: '0.375rem',
  cursor: 'pointer',
}

const emptyHint: React.CSSProperties = {
  padding: '1rem',
  textAlign: 'center',
  background: 'var(--color-bg-secondary)',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-md)',
  fontSize: '0.8125rem',
  color: 'var(--color-text-subtle)',
}
