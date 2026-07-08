'use client'

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Plus, Trash2, Share2, Copy, Star, ExternalLink, Mail, BookmarkPlus, Eye, ChevronUp, ChevronDown, MessageSquare, BarChart3, MoreHorizontal, Check, FileText } from 'lucide-react'
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
  coverTheme: 'brand_glass' | 'toned_light' | 'light' | 'dark' | null
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
  themeMode?: string | null
  position: number
}

type SlideTheme = 'light' | 'dark' | 'feature'
function normaliseSlideTheme(v: string | null | undefined): SlideTheme {
  if (v === 'dark' || v === 'feature') return v
  return 'light'
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
      { value: 'testimonial_stack', label: 'Testimonials (carousel)' },
      { value: 'founders', label: 'Founders' },
      { value: 'partner_badges', label: 'Partner badges' },
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
  'testimonial_stack', 'faq', 'guarantee', 'retainer_offer', 'founders',
  'partner_badges',
])

export function ProposalDetail({ proposalId }: { proposalId: string }) {
  const router = useRouter()
  const { showToast } = useToast()
  const [proposal, setProposal] = useState<Proposal | null>(null)
  const [sections, setSections] = useState<Section[]>([])
  const [variants, setVariants] = useState<Variant[]>([])
  const [acceptances, setAcceptances] = useState<Acceptance[]>([])
  const [sharing, setSharing] = useState(false)
  const [showEmail, setShowEmail] = useState(false)
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; email: string; isPrimary: number }>>([])

  // Active view drives the right pane:
  //   'cover'              → cover meta editor
  //   `section:${id}`      → that section's editor
  //   `variant:${id}`      → that variant's editor
  //   'settings' | 'decisions' | 'analytics' → admin panels
  const [activeView, setActiveView] = useState<string>('cover')
  const [moreMenuOpen, setMoreMenuOpen] = useState(false)
  const [showAddSlideMenu, setShowAddSlideMenu] = useState(false)

  // Save indicator — counts saves over the lifetime of the page; the timestamp
  // of the most recent save lets the header show "saved 3s ago".
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null)
  const [savingCount, setSavingCount] = useState(0)
  const trackSave = useCallback((promise: Promise<unknown>) => {
    setSavingCount(c => c + 1)
    void promise.finally(() => {
      setSavingCount(c => Math.max(0, c - 1))
      setLastSavedAt(Date.now())
    })
  }, [])

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

  const { data: swrData, isLoading: loading, mutate } = useSWR<{
    proposal: Proposal
    sections: Section[]
    variants: Variant[]
    acceptances: Acceptance[]
  }>(`/api/admin/proposals/${proposalId}`)
  useEffect(() => {
    if (!swrData) return
    setProposal(swrData.proposal)
    setSections(swrData.sections ?? [])
    setVariants(swrData.variants ?? [])
    setAcceptances(swrData.acceptances ?? [])
  }, [swrData])

  // If the active view points to a section or variant that's been deleted
  // or hasn't loaded, fall back to the cover.
  useEffect(() => {
    if (activeView.startsWith('section:')) {
      const id = activeView.slice('section:'.length)
      if (sections.length > 0 && !sections.some(s => s.id === id)) setActiveView('cover')
    } else if (activeView.startsWith('variant:')) {
      const id = activeView.slice('variant:'.length)
      if (variants.length > 0 && !variants.some(v => v.id === id)) setActiveView('cover')
    }
  }, [activeView, sections, variants])

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
      await mutate()
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
      if (changes.themeMode !== undefined) next.themeMode = changes.themeMode
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
      await mutate()
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
      await mutate()
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
      await mutate()
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
      await mutate()
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
      const url = `${window.location.origin}/p/proposal/${data.token}`
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
    ? `${typeof window !== 'undefined' ? window.location.origin : ''}/p/proposal/${proposal.publicShareToken}`
    : null

  // Sorted sections drive the navigator order and slide numbering.
  const sortedSections = [...sections].sort((a, b) => a.position - b.position)

  // Has unpublished edits since the last publish?
  const hasUnpublished =
    !proposal.publishedAt ||
    (proposal.updatedAt && new Date(proposal.updatedAt).getTime() > new Date(proposal.publishedAt).getTime() + 1000)

  // Section type → friendly label for the navigator (falls back to type code).
  const sectionLabel = (type: string) =>
    SECTION_TYPES.find(t => t.value === type)?.label ?? type

  return (
    <div style={builderShell} className="proposal-builder">
      <style>{`
        @media (max-width: 1024px) {
          .proposal-builder-grid {
            grid-template-columns: 1fr !important;
          }
          .proposal-builder-rail {
            position: static !important;
            height: auto !important;
            border-left: none !important;
            border-top: 1px solid var(--color-border-subtle) !important;
            padding: 1.125rem clamp(1rem, 3vw, 2.5rem) !important;
          }
        }
        @keyframes editorFadeIn {
          from { opacity: 0; transform: translateY(0.375rem); }
          to { opacity: 1; transform: translateY(0); }
        }
        .nav-item-hover:hover { background: var(--color-bg-secondary) !important; }
        .nav-item-active {
          background: linear-gradient(135deg, var(--color-brand-50) 0%, transparent 100%) !important;
          color: var(--color-text) !important;
        }
        .nav-item-active::before {
          content: '';
          position: absolute;
          left: 0; top: 0.625rem; bottom: 0.625rem;
          width: 0.1875rem;
          background: var(--color-brand);
          border-radius: 0 0.1875rem 0.1875rem 0;
        }
      `}</style>

      {/* Sticky top band — wraps a rounded toolbar surface so it reads as an
          intentional control panel rather than a flush nav strip. */}
      <header style={builderHeader}>
        <div style={builderHeaderToolbar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', minWidth: 0, flex: 1 }}>
            <Link href="/proposals" aria-label="All proposals" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2rem', height: '2rem', borderRadius: '0.5rem', color: 'var(--color-text-muted)', flexShrink: 0 }} className="nav-item-hover">
              <ArrowLeft size={16} />
            </Link>
            <div style={{ minWidth: 0, flex: 1 }}>
              <input
                data-private
                type="text"
                value={proposal.title}
                onChange={e => setProposal(p => p ? { ...p, title: e.target.value } : p)}
                onBlur={e => trackSave(patchProposal({ title: e.currentTarget.value || 'Untitled' }))}
                placeholder="Untitled proposal"
                style={builderTitleInput}
              />
            </div>
            <span style={statusPill(proposal.status)}>{proposal.status}</span>
            <SaveIndicator savingCount={savingCount} lastSavedAt={lastSavedAt} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
            {hasUnpublished && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: '0.375rem',
                padding: '0.25rem 0.625rem',
                fontSize: '0.625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                background: '#fff7ed', color: '#9a3412',
                border: '1px solid #fed7aa', borderRadius: '999px',
              }} title="Edits are not yet on the public link">
                <span aria-hidden="true" style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: '#fb923c' }} />
                Unpublished
              </span>
            )}
            {hasUnpublished && (
              <button
                onClick={() => trackSave(handlePublish())}
                disabled={publishing}
                style={toolbarPrimary}
                title="Push the latest edits to the public viewer"
              >
                {publishing ? 'Publishing...' : 'Publish'}
              </button>
            )}
            <Link href={`/preview/proposal/${proposalId}`} target="_blank" rel="noreferrer" className="inline-flex items-center" style={toolbarBtn}>
              <Eye size={13} />
              Preview
            </Link>
            <BuilderMoreMenu
              open={moreMenuOpen}
              onToggle={() => setMoreMenuOpen(v => !v)}
              onClose={() => setMoreMenuOpen(false)}
              items={[
                { icon: <BookmarkPlus size={13} />, label: 'Save as template', onClick: () => setShowSaveTemplate(true) },
                { icon: <Trash2 size={13} />, label: 'Delete proposal', danger: true, onClick: () => setShowDeleteConfirm(true) },
              ]}
            />
          </div>
        </div>
      </header>

      {/* Two-column main: editor on the left, combined navigator + metadata rail on the right.
          The editor occupies the full remaining width (capped at 72rem inside `slideBuilderColumn`)
          so there's no surrounding empty rail. */}
      <div style={builderGrid} className="proposal-builder-grid">
        {/* Active editor */}
        <main style={builderMain} key={activeView}>
          <div style={slideBuilderColumn}>
          {activeView === 'cover' && (
            <CoverEditor
              proposal={proposal}
              onPatch={(p) => trackSave(patchProposal(p))}
              setProposal={setProposal}
            />
          )}

          {activeView.startsWith('section:') && (() => {
            const id = activeView.slice('section:'.length)
            const section = sortedSections.find(s => s.id === id)
            if (!section) return null
            const idx = sortedSections.findIndex(s => s.id === id)
            const number = idx + 2
            return (
              <SlideEditorShell
                eyebrow={`Slide ${number}`}
                kicker={sectionLabel(section.type)}
                onMoveUp={idx > 0 ? () => trackSave(moveSection(section.id, -1)) : undefined}
                onMoveDown={idx < sortedSections.length - 1 ? () => trackSave(moveSection(section.id, 1)) : undefined}
                onDelete={() => trackSave(deleteSection(section.id))}
              >
                <SectionEditor
                  section={section}
                  isFirst={idx === 0}
                  isLast={idx === sortedSections.length - 1}
                  hideHeader
                  onChange={changes => trackSave(patchSection(section.id, changes))}
                  onDelete={() => trackSave(deleteSection(section.id))}
                  onMoveUp={() => trackSave(moveSection(section.id, -1))}
                  onMoveDown={() => trackSave(moveSection(section.id, 1))}
                />
              </SlideEditorShell>
            )
          })()}

          {activeView.startsWith('variant:') && (() => {
            const id = activeView.slice('variant:'.length)
            const variant = variants.find(v => v.id === id)
            if (!variant) return null
            return (
              <SlideEditorShell
                eyebrow="Package"
                kicker={variant.name || 'Untitled'}
                onDelete={() => trackSave(deleteVariant(variant.id))}
              >
                <VariantEditor
                  variant={variant}
                  hideHeader
                  onChange={changes => trackSave(patchVariant(variant.id, changes))}
                  onDelete={() => trackSave(deleteVariant(variant.id))}
                />
              </SlideEditorShell>
            )
          })()}

          {activeView === 'decisions' && (
            <DecisionsPanel acceptances={acceptances} variants={variants} proposalTitle={proposal.title} />
          )}

          {activeView === 'analytics' && proposal.publicShareToken && (
            <SlideEditorShell eyebrow="Analytics" kicker="View activity">
              <ShareAnalyticsCard resourceType="proposal" resourceId={proposalId} />
            </SlideEditorShell>
          )}
          </div>
        </main>

        {/* Right rail — slide navigator + proposal-level settings combined */}
        <aside style={builderRail} className="proposal-builder-rail">
          <BuilderNavGroup label="Slides" count={1 + sortedSections.length}>
            <BuilderNavItem
              active={activeView === 'cover'}
              onClick={() => setActiveView('cover')}
              number={1}
              icon={<FileText size={12} />}
              label="Cover"
              hint={proposal.subtitle || 'Hero slide'}
            />
            {sortedSections.map((s, i) => (
              <BuilderNavItem
                key={s.id}
                active={activeView === `section:${s.id}`}
                onClick={() => setActiveView(`section:${s.id}`)}
                number={i + 2}
                label={s.title || sectionLabel(s.type)}
                hint={sectionLabel(s.type)}
              />
            ))}
            <BuilderAddSlide
              open={showAddSlideMenu}
              onToggle={() => setShowAddSlideMenu(v => !v)}
              onClose={() => setShowAddSlideMenu(false)}
              onPick={(type) => {
                setShowAddSlideMenu(false)
                trackSave(addSection(type))
              }}
            />
          </BuilderNavGroup>

          <BuilderNavGroup label="Packages" count={variants.length}>
            {variants.map(v => (
              <BuilderNavItem
                key={v.id}
                active={activeView === `variant:${v.id}`}
                onClick={() => setActiveView(`variant:${v.id}`)}
                label={v.name || 'Untitled package'}
                hint={`${v.currency} ${v.oneOffAmount > 0 ? v.oneOffAmount.toLocaleString() : `${v.monthlyAmount}/mo`}`}
                badge={v.isFeatured ? 'Featured' : undefined}
              />
            ))}
            <button onClick={() => trackSave(addVariant())} style={navAddBtn} className="nav-item-hover">
              <Plus size={12} />
              Add package
            </button>
          </BuilderNavGroup>

          {(acceptances.length > 0 || proposal.publicShareToken) && (
            <BuilderNavGroup label="More">
              {acceptances.length > 0 && (
                <BuilderNavItem
                  active={activeView === 'decisions'}
                  onClick={() => setActiveView('decisions')}
                  icon={<MessageSquare size={12} />}
                  label="Decisions"
                  hint={`${acceptances.length} response${acceptances.length === 1 ? '' : 's'}`}
                />
              )}
              {proposal.publicShareToken && (
                <BuilderNavItem
                  active={activeView === 'analytics'}
                  onClick={() => setActiveView('analytics')}
                  icon={<BarChart3 size={12} />}
                  label="Analytics"
                  hint="View, time on page"
                />
              )}
            </BuilderNavGroup>
          )}

          <div style={{ height: '1px', background: 'var(--color-border-subtle)', margin: '0.5rem 0' }} aria-hidden="true" />

          <BuilderRail
            proposal={proposal}
            setProposal={setProposal}
            onPatch={(p) => trackSave(patchProposal(p))}
            proposalId={proposalId}
            onLinkChanged={() => void mutate()}
            publicUrl={publicUrl}
            sharing={sharing}
            onShare={() => trackSave(handleShare())}
            onUnshare={() => trackSave(handleUnshare())}
            onCopy={(url) => navigator.clipboard.writeText(url).then(() => showToast('Public link copied', 'success'))}
            onEmail={() => { void ensureContacts(); setShowEmail(true) }}
          />
        </aside>
      </div>

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

// ─── Builder: navigator + active editor shell ─────────────────────────────
//
// Layout contract (matches schedule builder):
//   - The outer shell takes over the dashboard's content area.
//   - The top header is a SEPARATE rounded toolbar that floats inside a
//     padded band (not a flush bar). Liam asked for an "intentional toolbar"
//     rather than an attached strip.
//   - The grid has no fixed heights: editor + rail render at their natural
//     heights. If the rail content exceeds the viewport, the page scrolls.
//     `alignItems: start` keeps the rail anchored to the top instead of
//     stretching to match the editor.

const builderShell: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  minHeight: 'calc(100vh - 4rem)',
  marginTop: 'calc(-1 * var(--space-5))',
  marginLeft: 'calc(-1 * var(--space-5))',
  marginRight: 'calc(-1 * var(--space-5))',
}

// The sticky band that contains the rounded toolbar. Padded so the toolbar
// has breathing room from the page edges and reads as its own surface.
const builderHeader: React.CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 20,
  padding: '0.625rem 1rem',
  background: 'rgba(255,255,255,0.85)',
  backdropFilter: 'blur(12px)',
  WebkitBackdropFilter: 'blur(12px)',
}

// The rounded toolbar surface — the actual visible bar.
const builderHeaderToolbar: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.875rem',
  padding: '0.4375rem 0.75rem',
  background: 'var(--color-bg)',
  border: '1px solid var(--color-border-subtle)',
  borderRadius: 'var(--radius-lg, 0.875rem)',
  boxShadow: '0 4px 12px -6px rgba(31, 44, 26, 0.08)',
}

const builderTitleInput: React.CSSProperties = {
  display: 'block',
  width: '100%',
  fontSize: '1rem',
  fontWeight: 700,
  color: 'var(--color-text)',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: '0.375rem',
  padding: '0.25rem 0.5rem',
  outline: 'none',
  letterSpacing: '-0.01em',
  transition: 'border-color 200ms ease, background 200ms ease',
}

const builderGrid: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'minmax(0, 1fr) 22rem',
  flex: 1,
  minHeight: 0,
  alignItems: 'start',
}

const builderMain: React.CSSProperties = {
  padding: 'clamp(1rem, 3vw, 2.5rem)',
  animation: 'editorFadeIn 240ms cubic-bezier(0.22, 1, 0.36, 1)',
  minWidth: 0,
}

// The slide builder column inside `builderMain`. Caps width so prose stays
// readable while still using the full remaining viewport width up to that
// cap. (Per Liam: no surrounding empty rails — the editor expands all the
// way to the rail.)
const slideBuilderColumn: React.CSSProperties = {
  width: '100%',
  maxWidth: '72rem',
  margin: '0 auto',
}

// Right rail: sticky, no internal scroll. If the rail grows past the
// viewport, the page scrolls so the bottom of the rail is reachable. This
// removes the visual rail track Liam flagged.
const builderRail: React.CSSProperties = {
  position: 'sticky',
  top: '4.5rem',
  alignSelf: 'start',
  borderLeft: '1px solid var(--color-border-subtle)',
  padding: '1.125rem 1rem',
  display: 'flex',
  flexDirection: 'column',
  gap: '1.25rem',
  background: 'var(--color-bg)',
}

const navAddBtn: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4375rem',
  padding: '0.4375rem 0.625rem',
  marginTop: '0.25rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  color: 'var(--color-text-muted)',
  background: 'transparent',
  border: '1px dashed var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  width: '100%',
  justifyContent: 'flex-start',
  transition: 'background 160ms ease, color 160ms ease, border-color 160ms ease',
}

function statusPill(status: string): React.CSSProperties {
  const palette: Record<string, { bg: string; fg: string; bd: string }> = {
    draft:     { bg: '#f7f9f6', fg: '#5a6657', bd: '#e8f0e6' },
    shared:    { bg: '#eff6ff', fg: '#1e40af', bd: '#bfdbfe' },
    accepted:  { bg: '#f0fdf4', fg: '#15803d', bd: '#bbf7d0' },
    declined:  { bg: '#fef2f2', fg: '#dc2626', bd: '#fecaca' },
    withdrawn: { bg: '#f5f5f4', fg: '#525252', bd: '#e7e5e4' },
    expired:   { bg: '#fff7ed', fg: '#9a3412', bd: '#fed7aa' },
  }
  const p = palette[status] ?? palette.draft
  return {
    display: 'inline-flex',
    alignItems: 'center',
    fontSize: '0.625rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.08em',
    padding: '0.25rem 0.625rem',
    borderRadius: '999px',
    background: p.bg,
    color: p.fg,
    border: `1px solid ${p.bd}`,
    flexShrink: 0,
  }
}

function SaveIndicator({ savingCount, lastSavedAt }: { savingCount: number; lastSavedAt: number | null }) {
  const [, setTick] = useState(0)
  // Re-render every 5s so "Saved 12s ago" updates without React having to
  // be told. Cheap enough — one timer per page.
  useEffect(() => {
    const t = setInterval(() => setTick(x => x + 1), 5000)
    return () => clearInterval(t)
  }, [])
  if (savingCount > 0) {
    return (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
        <span aria-hidden="true" style={{ width: '0.375rem', height: '0.375rem', borderRadius: '50%', background: 'var(--color-warning, #fb923c)', animation: 'pulse 1s ease-in-out infinite' }} />
        Saving…
      </span>
    )
  }
  if (!lastSavedAt) return <span style={{ width: '0.5rem' }} aria-hidden="true" />
  const elapsedSec = Math.max(1, Math.round((Date.now() - lastSavedAt) / 1000))
  const label = elapsedSec < 5 ? 'Saved' : elapsedSec < 60 ? `Saved ${elapsedSec}s ago` : `Saved ${Math.round(elapsedSec / 60)}m ago`
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.6875rem', fontWeight: 500, color: 'var(--color-text-subtle)' }}>
      <Check size={11} style={{ color: 'var(--color-brand)' }} />
      {label}
    </span>
  )
}

function BuilderMoreMenu({
  open, onToggle, onClose, items,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  items: Array<{ icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }>
}) {
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-more-menu]')) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose])
  return (
    <div data-more-menu style={{ position: 'relative' }}>
      <button
        onClick={onToggle}
        aria-label="More actions"
        aria-expanded={open}
        style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }}
      >
        <MoreHorizontal size={14} />
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.375rem)',
            right: 0,
            minWidth: '14rem',
            padding: '0.25rem',
            background: 'var(--color-bg)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 16px 40px -12px rgba(31, 44, 26, 0.18)',
            zIndex: 30,
          }}
        >
          {items.map((it, i) => (
            <button
              key={i}
              onClick={() => { onClose(); if (!it.disabled) it.onClick() }}
              disabled={it.disabled}
              role="menuitem"
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.5rem 0.625rem',
                fontSize: '0.8125rem',
                color: it.danger ? 'var(--color-danger)' : 'var(--color-text)',
                background: 'transparent',
                border: 'none',
                borderRadius: 'var(--radius-sm)',
                cursor: it.disabled ? 'not-allowed' : 'pointer',
                opacity: it.disabled ? 0.4 : 1,
                textAlign: 'left',
              }}
              className="nav-item-hover"
            >
              {it.icon}
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function BuilderNavGroup({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '0 0.625rem', marginBottom: '0.4375rem' }}>
        <span style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {label}
        </span>
        {count !== undefined && count > 0 && (
          <span style={{ fontSize: '0.625rem', fontWeight: 600, color: 'var(--color-text-subtle)' }}>{count}</span>
        )}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
        {children}
      </div>
    </div>
  )
}

function BuilderNavItem({
  active, onClick, number, icon, label, hint, badge,
}: {
  active: boolean
  onClick: () => void
  number?: number
  icon?: React.ReactNode
  label: string
  hint?: string
  badge?: string
}) {
  return (
    <button
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={active ? 'nav-item-active' : 'nav-item-hover'}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        width: '100%',
        padding: '0.5rem 0.625rem',
        background: 'transparent',
        border: 'none',
        borderRadius: 'var(--radius-sm)',
        textAlign: 'left',
        cursor: 'pointer',
        color: 'var(--color-text-muted)',
        transition: 'background 160ms ease, color 160ms ease',
      }}
    >
      {number !== undefined && (
        <span style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '0.625rem',
          fontWeight: 700,
          color: active ? '#FFFFFF' : 'var(--color-text-subtle)',
          background: active ? 'var(--color-brand)' : 'var(--color-bg-secondary)',
          border: active ? 'none' : '1px solid var(--color-border-subtle)',
          borderRadius: '0 6px 0 6px',
          letterSpacing: '-0.02em',
        }}>{number}</span>
      )}
      {icon && number === undefined && (
        <span style={{
          flexShrink: 0,
          width: '1.25rem',
          height: '1.25rem',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: active ? 'var(--color-brand)' : 'var(--color-text-subtle)',
        }}>{icon}</span>
      )}
      <span style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '0.8125rem', fontWeight: active ? 700 : 500, color: active ? 'var(--color-text)' : 'var(--color-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {label}
        </div>
        {hint && (
          <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-subtle)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {hint}
          </div>
        )}
      </span>
      {badge && (
        <span style={{ fontSize: '0.5625rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-brand)', flexShrink: 0 }}>
          {badge}
        </span>
      )}
    </button>
  )
}

function BuilderAddSlide({
  open, onToggle, onClose, onPick,
}: {
  open: boolean
  onToggle: () => void
  onClose: () => void
  onPick: (type: string) => void
}) {
  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      const target = e.target as HTMLElement | null
      if (!target?.closest?.('[data-add-slide]')) onClose()
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open, onClose])
  return (
    <div data-add-slide style={{ position: 'relative' }}>
      <button onClick={onToggle} style={navAddBtn} className="nav-item-hover">
        <Plus size={12} />
        Add slide
      </button>
      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 0.25rem)',
          left: 0,
          right: 0,
          minWidth: '17rem',
          maxHeight: '24rem',
          overflowY: 'auto',
          padding: '0.375rem',
          background: 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-md)',
          boxShadow: '0 16px 40px -12px rgba(31, 44, 26, 0.18)',
          zIndex: 30,
        }}>
          {SECTION_TYPE_GROUPS.map(group => (
            <div key={group.label} style={{ marginBottom: '0.25rem' }}>
              <div style={{ padding: '0.375rem 0.5rem 0.25rem', fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {group.label}
              </div>
              {group.items.map(t => (
                <button
                  key={t.value}
                  onClick={() => onPick(t.value)}
                  style={{
                    width: '100%',
                    padding: '0.4375rem 0.625rem',
                    fontSize: '0.8125rem',
                    fontWeight: 500,
                    color: 'var(--color-text)',
                    background: 'transparent',
                    border: 'none',
                    borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                  className="nav-item-hover"
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SlideEditorShell({
  eyebrow, kicker, children, onMoveUp, onMoveDown, onDelete,
}: {
  eyebrow: string
  kicker: string
  children: React.ReactNode
  onMoveUp?: () => void
  onMoveDown?: () => void
  onDelete?: () => void
}) {
  // The outer slideBuilderColumn already caps width at 72rem and centres.
  // No inner max-width here — let the editor expand to the full column.
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
        <div>
          <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {eyebrow}
          </div>
          <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.25rem', letterSpacing: '-0.01em' }}>
            {kicker}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.375rem' }}>
          {onMoveUp && (
            <button onClick={onMoveUp} aria-label="Move up" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }} title="Move up">
              <ChevronUp size={13} />
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} aria-label="Move down" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem' }} title="Move down">
              <ChevronDown size={13} />
            </button>
          )}
          {onDelete && (
            <button onClick={onDelete} aria-label="Delete" style={{ ...toolbarBtn, padding: '0.4375rem 0.5rem', color: 'var(--color-text-subtle)' }} title="Delete">
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
      {children}
    </div>
  )
}

function CoverEditor({
  proposal, setProposal, onPatch,
}: {
  proposal: Proposal
  setProposal: React.Dispatch<React.SetStateAction<Proposal | null>>
  onPatch: (changes: Partial<Proposal>) => void
}) {
  // The cover is locked to the brand-glass treatment — no theme picker.
  // The `coverTheme` column on `proposals` is retained for back-compat but
  // is no longer surfaced for editing; the viewer always renders the cover
  // with the feature gradient.
  return (
    <div>
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Slide 1</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.25rem', letterSpacing: '-0.01em' }}>Cover</div>
      </div>
      <div style={{ display: 'grid', gap: '1rem', padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        <FieldGroup label="Eyebrow">
          <input
            type="text"
            value={proposal.subtitle ?? ''}
            onChange={e => setProposal(p => p ? { ...p, subtitle: e.target.value } : p)}
            onBlur={e => onPatch({ subtitle: e.currentTarget.value || null })}
            placeholder="PROPOSAL"
            style={metaInputStyle}
          />
        </FieldGroup>
        <FieldGroup label="Title">
          <input
            data-private
            type="text"
            value={proposal.title}
            onChange={e => setProposal(p => p ? { ...p, title: e.target.value } : p)}
            onBlur={e => onPatch({ title: e.currentTarget.value || 'Untitled' })}
            style={{ ...metaInputStyle, fontSize: '1.125rem', fontWeight: 700, padding: '0.5rem 0.625rem' }}
          />
        </FieldGroup>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(11rem, 1fr))', gap: '0.875rem' }}>
          <FieldGroup label="Prepared for">
            <input data-private type="text" value={proposal.preparedFor ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedFor: e.target.value } : p)} onBlur={e => onPatch({ preparedFor: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Prepared by">
            <input type="text" value={proposal.preparedBy ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedBy: e.target.value } : p)} onBlur={e => onPatch({ preparedBy: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Effective">
            <input type="date" value={proposal.effectiveDate ?? ''} onChange={e => onPatch({ effectiveDate: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Expires">
            <input type="date" value={proposal.expiresAt ?? ''} onChange={e => onPatch({ expiresAt: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
        </div>
      </div>
    </div>
  )
}

/**
 * <BuilderRail> — always-visible right rail of proposal-level settings.
 *
 * Mirrors the deal-detail layout pattern (sidebar of metadata next to the
 * working surface). On screens under 1280px the rail moves to a panel
 * below the editor; under 900px the whole grid stacks vertically.
 *
 * Sections, top to bottom: public link controls, cover theme, linked-to
 * (org + deal), cover meta (prepared for, prepared by, dates).
 */
function BuilderRail({
  proposal, setProposal, onPatch, proposalId, onLinkChanged,
  publicUrl, sharing, onShare, onUnshare, onCopy, onEmail,
}: {
  proposal: Proposal
  setProposal: React.Dispatch<React.SetStateAction<Proposal | null>>
  onPatch: (changes: Partial<Proposal>) => void
  proposalId: string
  onLinkChanged: () => void
  publicUrl: string | null
  sharing: boolean
  onShare: () => void
  onUnshare: () => void
  onCopy: (url: string) => void
  onEmail: () => void
}) {
  return (
    <>
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
              <button onClick={onEmail} className="inline-flex items-center" style={{ ...railBtn, background: 'var(--color-brand)', color: '#FFFFFF', borderColor: 'var(--color-brand)', flex: 1, justifyContent: 'center' }}>
                <Mail size={12} />
                Email
              </button>
              <button onClick={() => onCopy(publicUrl)} className="inline-flex items-center" style={{ ...railBtn, justifyContent: 'center' }} title="Copy URL">
                <Copy size={12} />
                Copy
              </button>
              <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex items-center" style={{ ...railBtn, justifyContent: 'center' }} title="Open in new tab">
                <ExternalLink size={12} />
                Open
              </a>
            </div>
            <button onClick={onUnshare} className="inline-flex items-center" style={{ ...railBtn, color: 'var(--color-danger)', justifyContent: 'center' }}>
              Revoke link
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: '0.5rem' }}>
            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', margin: 0, lineHeight: 1.5 }}>
              Generate a public link to send the proposal to the client.
            </p>
            <button onClick={onShare} disabled={sharing} className="inline-flex items-center" style={{ ...railBtn, background: 'var(--color-brand)', color: '#FFFFFF', borderColor: 'var(--color-brand)', justifyContent: 'center' }}>
              <Share2 size={12} />
              {sharing ? 'Generating…' : 'Generate public link'}
            </button>
          </div>
        )}
      </RailSection>

      <RailSection title="Linked to">
        <LinkedToPanel
          resourceType="proposal"
          resourceId={proposalId}
          orgId={proposal.orgId}
          dealId={proposal.dealId}
          orgName={proposal.orgName}
          dealTitle={proposal.dealTitle}
          onChanged={onLinkChanged}
        />
      </RailSection>

      <RailSection title="Cover meta">
        <div style={{ display: 'grid', gap: '0.625rem' }}>
          <FieldGroup label="Prepared for">
            <input data-private type="text" value={proposal.preparedFor ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedFor: e.target.value } : p)} onBlur={e => onPatch({ preparedFor: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Prepared by">
            <input type="text" value={proposal.preparedBy ?? ''} onChange={e => setProposal(p => p ? { ...p, preparedBy: e.target.value } : p)} onBlur={e => onPatch({ preparedBy: e.currentTarget.value || null })} style={metaInputStyle} />
          </FieldGroup>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
            <FieldGroup label="Effective">
              <input type="date" value={proposal.effectiveDate ?? ''} onChange={e => onPatch({ effectiveDate: e.currentTarget.value || null })} style={metaInputStyle} />
            </FieldGroup>
            <FieldGroup label="Expires">
              <input type="date" value={proposal.expiresAt ?? ''} onChange={e => onPatch({ expiresAt: e.currentTarget.value || null })} style={metaInputStyle} />
            </FieldGroup>
          </div>
        </div>
      </RailSection>
    </>
  )
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
        {title}
      </div>
      {children}
    </div>
  )
}

const railBtn: React.CSSProperties = {
  padding: '0.4375rem 0.625rem',
  fontSize: '0.75rem',
  fontWeight: 600,
  background: 'var(--color-bg)',
  color: 'var(--color-text)',
  border: '1px solid var(--color-border)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
  gap: '0.375rem',
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}

function DecisionsPanel({
  acceptances, variants, proposalTitle,
}: {
  acceptances: Acceptance[]
  variants: Variant[]
  proposalTitle: string
}) {
  return (
    <div style={{ maxWidth: '52rem', margin: '0 auto' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.625rem', fontWeight: 700, color: 'var(--color-text-subtle)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Decisions</div>
        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text)', marginTop: '0.25rem', letterSpacing: '-0.01em' }}>Responses from the prospect</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {acceptances.map(a => {
          const variantName = a.variantId ? variants.find(v => v.id === a.variantId)?.name : null
          const palette =
            a.status === 'accepted' ? { color: '#15803d', bg: '#f0fdf4', border: '#bbf7d0', label: 'Accepted' } :
            a.status === 'declined' ? { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', label: 'Declined' } :
            a.status === 'question' ? { color: '#1e40af', bg: '#eff6ff', border: '#bfdbfe', label: 'Question or tweak request' } :
            { color: 'var(--color-text-muted)', bg: 'var(--color-bg-tertiary)', border: 'var(--color-border-subtle)', label: a.status }
          return (
            <div key={a.id} style={{ padding: '0.875rem 1.125rem', border: `1px solid ${palette.border}`, background: palette.bg, borderRadius: 'var(--radius-md)', fontSize: '0.8125rem', color: 'var(--color-text)' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', gap: '0.5rem' }}>
                <strong style={{ color: palette.color }}>{palette.label}</strong>
                {variantName && <span style={{ color: 'var(--color-text-muted)' }}>· {variantName}</span>}
                {a.acceptorName && <span data-private style={{ color: 'var(--color-text-muted)' }}>· {a.acceptorName}</span>}
                {a.acceptorEmail && <span data-private style={{ color: 'var(--color-text-subtle)' }}>· {a.acceptorEmail}</span>}
                <span style={{ color: 'var(--color-text-subtle)', marginLeft: 'auto' }}>{new Date(a.acceptedAt).toLocaleString()}</span>
              </div>
              {a.comment && (
                <p data-private style={{ margin: '0.5rem 0 0 0', color: 'var(--color-text)', whiteSpace: 'pre-wrap' }}>
                  {a.status === 'question' ? a.comment : `“${a.comment}”`}
                </p>
              )}
              {a.status === 'question' && a.acceptorEmail && (
                <a
                  href={`mailto:${a.acceptorEmail}?subject=${encodeURIComponent('Re: ' + (proposalTitle ?? 'your proposal'))}`}
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
  )
}

// ─── Section editor (per-type) ───────────────────────────────────────────

interface SectionPatch {
  type?: string
  title?: string | null
  subtitle?: string | null
  position?: number
  data?: unknown
  themeMode?: SlideTheme
}

function SectionEditor({ section, onChange, onDelete, onMoveUp, onMoveDown, isFirst, isLast, hideHeader = false }: {
  section: Section
  onChange: (changes: SectionPatch) => void
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
  isFirst?: boolean
  isLast?: boolean
  hideHeader?: boolean
}) {
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (!section.data) return {}
    try { return JSON.parse(section.data) as Record<string, unknown> } catch { return {} }
  })
  // Re-sync local data when the section ID changes (different slide selected).
  // Without this the editor renders stale state when switching between slides.
  useEffect(() => {
    if (!section.data) { setData({}); return }
    try { setData(JSON.parse(section.data) as Record<string, unknown>) } catch { setData({}) }
  }, [section.id, section.data])

  const setField = (key: string, value: unknown) => {
    setData(prev => ({ ...prev, [key]: value }))
  }
  const flush = () => onChange({ data })

  const editorBody = (
    <div style={{ display: 'grid', gap: '0.875rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
        <FieldGroup label="Title">
          <input type="text" value={section.title ?? ''} onChange={e => onChange({ title: e.target.value })} style={metaInputStyle} />
        </FieldGroup>
        <FieldGroup label="Eyebrow">
          <input type="text" value={section.subtitle ?? ''} onChange={e => onChange({ subtitle: e.target.value })} style={metaInputStyle} />
        </FieldGroup>
      </div>
      <FieldGroup label="Slide theme">
        <SlideThemeSegmented
          value={normaliseSlideTheme(section.themeMode)}
          onChange={t => onChange({ themeMode: t })}
        />
      </FieldGroup>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.625rem' }}>
            <FieldGroup label="Author">
              <input type="text" value={String(data.author ?? '')} onChange={e => setField('author', e.target.value)} onBlur={flush} style={metaInputStyle} />
            </FieldGroup>
            <FieldGroup label="Author role">
              <input type="text" value={String(data.role ?? '')} onChange={e => setField('role', e.target.value)} onBlur={flush} style={metaInputStyle} />
            </FieldGroup>
          </div>
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
  )

  if (hideHeader) {
    return (
      <div style={{ padding: '1.5rem', background: 'var(--color-bg)', border: '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        {editorBody}
      </div>
    )
  }

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
      <div style={{ padding: '0.75rem 0.875rem', borderTop: '1px solid var(--color-border-subtle)' }}>
        {editorBody}
      </div>
    </details>
  )
}

function VariantEditor({ variant, onChange, onDelete, hideHeader = false }: {
  variant: Variant
  onChange: (changes: Partial<Variant>) => void
  onDelete: () => void
  hideHeader?: boolean
}) {
  const body = (
    <div style={{ padding: hideHeader ? '1.5rem' : '0.75rem 0.875rem', borderTop: hideHeader ? 'none' : '1px solid var(--color-border-subtle)', display: 'grid', gap: '0.875rem' }}>
        <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(8rem, 1fr))', gap: '0.625rem' }}>
          <FieldGroup label="Name">
            <input type="text" value={variant.name} onChange={e => onChange({ name: e.target.value })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Tagline">
            <input type="text" value={variant.tagline ?? ''} onChange={e => onChange({ tagline: e.target.value })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="One-off amount">
            <input data-private type="number" value={variant.oneOffAmount} onChange={e => onChange({ oneOffAmount: parseInt(e.target.value, 10) || 0 })} style={metaInputStyle} />
          </FieldGroup>
          <FieldGroup label="Monthly amount">
            <input data-private type="number" value={variant.monthlyAmount} onChange={e => onChange({ monthlyAmount: parseInt(e.target.value, 10) || 0 })} style={metaInputStyle} />
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
  )

  if (hideHeader) {
    return (
      <div style={{ background: 'var(--color-bg)', border: variant.isFeatured ? '2px solid var(--color-brand)' : '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-lg)' }}>
        {body}
      </div>
    )
  }

  return (
    <details open style={{ border: variant.isFeatured ? '2px solid var(--color-brand)' : '1px solid var(--color-border-subtle)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg)' }}>
      <summary style={{ padding: '0.625rem 0.875rem', cursor: 'pointer', fontSize: '0.8125rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'space-between', listStyle: 'none' }}>
        <span>
          {variant.isFeatured ? <Star size={12} style={{ color: 'var(--color-brand)', marginRight: '0.25rem' }} /> : null}
          <span data-private>{variant.name}</span> · <span data-private>{variant.currency} {variant.oneOffAmount.toLocaleString()}{variant.monthlyAmount > 0 ? ` + ${variant.monthlyAmount.toLocaleString()}/mo` : ''}</span>
        </span>
        <button onClick={(e) => { e.preventDefault(); onDelete() }} style={{ ...toolbarBtn, padding: '0.25rem 0.625rem' }}>
          <Trash2 size={12} />
        </button>
      </summary>
      {body}
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

/**
 * <SlideThemeSegmented> — 3-way segmented control for per-slide surface
 * treatment (Light / Dark / Feature). Bound to `proposal_sections.theme_mode`.
 *
 *   - Light   — default cream surface, ink text. Use for body copy slides.
 *   - Dark    — inverted dark-ink surface with light text. Use for "moments".
 *   - Feature — glassy gradient hero treatment (same vocabulary as the cover).
 *               Reserved for slides that should stand out (e.g. a pricing reveal).
 *
 * The cover slide always renders in the feature treatment regardless of
 * value, so no picker is shown on the cover.
 */
const SLIDE_THEMES: ReadonlyArray<{
  value: SlideTheme
  label: string
  swatch: { background: string; border: string }
}> = [
  {
    value: 'light',
    label: 'Light',
    swatch: { background: '#FFFFFF', border: '#d4e0d0' },
  },
  {
    value: 'dark',
    label: 'Dark',
    swatch: { background: '#1f2c1a', border: '#2d3d2a' },
  },
  {
    value: 'feature',
    label: 'Feature',
    swatch: { background: 'linear-gradient(135deg, #5A824E 0%, #1f2c1a 100%)', border: '#425F39' },
  },
]

function SlideThemeSegmented({
  value,
  onChange,
}: {
  value: SlideTheme
  onChange: (v: SlideTheme) => void
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Slide theme"
      style={{
        display: 'inline-flex',
        padding: '0.1875rem',
        background: 'var(--color-bg-secondary)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: '999px',
        gap: '0.125rem',
      }}
    >
      {SLIDE_THEMES.map(t => {
        const active = t.value === value
        return (
          <button
            key={t.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(t.value)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4375rem',
              padding: '0.3125rem 0.75rem',
              fontSize: '0.75rem',
              fontWeight: active ? 700 : 500,
              color: active ? 'var(--color-text)' : 'var(--color-text-muted)',
              background: active ? 'var(--color-bg)' : 'transparent',
              border: active ? '1px solid var(--color-border-subtle)' : '1px solid transparent',
              borderRadius: '999px',
              cursor: 'pointer',
              transition: 'background 160ms ease, color 160ms ease',
              boxShadow: active ? '0 1px 3px rgba(31, 44, 26, 0.06)' : 'none',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: '0.75rem',
                height: '0.75rem',
                borderRadius: '0 4px 0 4px',
                background: t.swatch.background,
                border: `1px solid ${t.swatch.border}`,
                flexShrink: 0,
              }}
            />
            {t.label}
          </button>
        )
      })}
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

