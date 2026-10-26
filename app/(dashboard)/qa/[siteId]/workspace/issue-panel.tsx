'use client'

import { useEffect, useState } from 'react'
import { ExternalLink, Loader2 } from 'lucide-react'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { Textarea } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { QA_VIEWPORTS, type QaIssue, type QaIssueCategory, type QaIssueSeverity, type QaPageStatus, type QaScanResult, type QaTarget, type QaViewportKey } from '@/lib/qa/types'
import type { PsiSummary } from '@/lib/qa/pagespeed'
import type { QaRoundPageDetail } from './qa-types'
import type { QaPagePatch } from './use-round'
import { CreateRequestDialog, type CreateRequestInput } from './create-request-dialog'
import { PerformancePanel, SeoSummary } from './issue-panel-detail'

export type IssuePanelTab = 'a11y' | 'links' | 'seo' | 'launch' | 'perf' | 'notes'

const TABS: { value: IssuePanelTab; label: string; category?: QaIssueCategory }[] = [
  { value: 'a11y', label: 'Accessibility', category: 'a11y' },
  { value: 'links', label: 'Links', category: 'links' },
  { value: 'seo', label: 'SEO', category: 'seo' },
  { value: 'launch', label: 'Launch', category: 'launch' },
  { value: 'perf', label: 'Performance', category: 'perf' },
  { value: 'notes', label: 'Notes' },
]

const SEVERITY_RANK: Record<QaIssueSeverity, number> = { fail: 0, warn: 1, info: 2 }
const SEVERITY_TONE: Record<QaIssueSeverity, BadgeTone> = { fail: 'danger', warn: 'warning', info: 'info' }
const SEVERITY_LABEL: Record<QaIssueSeverity, string> = { fail: 'Fail', warn: 'Warning', info: 'Info' }

export function sortIssues(issues: QaIssue[]): QaIssue[] {
  return [...issues].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

export function viewportLabel(key: QaViewportKey | undefined): string | null {
  if (!key) return null
  return QA_VIEWPORTS.find(v => v.key === key)?.label ?? null
}

/** The scan used for the SEO summary: Desktop when present, otherwise any scanned viewport. */
export function seoScan(scans: QaRoundPageDetail['scans']): QaScanResult | null {
  return scans.desktop ?? Object.values(scans)[0] ?? null
}

function parsePagespeed(raw: string | null): { mobile?: PsiSummary; desktop?: PsiSummary } | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as { mobile?: PsiSummary; desktop?: PsiSummary }
  } catch {
    return null
  }
}

export interface IssuePanelProps {
  detail: QaRoundPageDetail | null
  loading: boolean
  error: string | null
  target: QaTarget
  readOnly: boolean
  pagePath: string
  tab: IssuePanelTab
  onTabChange: (tab: IssuePanelTab) => void
  onShow: (issue: QaIssue) => void
  onCreateRequest: (issue: QaIssue, input: CreateRequestInput) => Promise<string>
  onPatch: (patch: QaPagePatch) => void
  onRunPageSpeed: (strategy: 'mobile' | 'desktop') => Promise<void>
}

export function IssuePanel(props: IssuePanelProps) {
  const { detail, loading, error, tab, onTabChange, readOnly } = props
  const [requestFor, setRequestFor] = useState<QaIssue | null>(null)

  if (error) {
    return <PanelMessage tone="danger" text={`Could not load the issues. ${error}`} />
  }
  if (loading && !detail) {
    return <PanelMessage tone="muted" text="Loading issues" spinner />
  }
  if (!detail) {
    return <PanelMessage tone="muted" text="Select a page to see its issues." />
  }

  const scanned = detail.roundPage.scannedAt !== null || Object.keys(detail.scans).length > 0
  const current = TABS.find(t => t.value === tab) ?? TABS[0]
  const seoSource = seoScan(detail.scans)

  return (
    <div className="flex min-h-0 flex-col" style={{ gap: '0.75rem' }}>
      {/* min-w-max keeps every tab on one line; the wrapper scrolls sideways instead of the labels colliding. */}
      <div className="w-full min-w-0 overflow-x-auto">
        <SegmentedControl<IssuePanelTab>
          value={tab}
          onChange={onTabChange}
          ariaLabel="Issue categories"
          role="tablist"
          size="sm"
          className="min-w-max"
          options={TABS.map(t => ({
            value: t.value,
            label: t.category ? `${t.label} (${detail.issues.filter(i => i.category === t.category).length})` : t.label,
          }))}
        />
      </div>
      <div role="tabpanel" aria-label={current.label} className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'notes' ? (
          <NotesTab
            key={detail.roundPage.id}
            status={detail.roundPage.status}
            note={detail.roundPage.note}
            readOnly={readOnly}
            onPatch={props.onPatch}
          />
        ) : null}
        {tab === 'perf' ? (
          <div className="flex flex-col" style={{ gap: '1rem' }}>
            <IssueList
              issues={detail.issues.filter(i => i.category === 'perf')}
              scanned={scanned}
              onShow={props.onShow}
              onRequest={setRequestFor}
              readOnly={readOnly}
            />
            <PerformancePanel
              pagespeed={parsePagespeed(detail.roundPage.pagespeed)}
              target={props.target}
              readOnly={readOnly}
              onRun={props.onRunPageSpeed}
            />
          </div>
        ) : null}
        {tab === 'seo' ? (
          <div className="flex flex-col" style={{ gap: '1rem' }}>
            <IssueList
              issues={detail.issues.filter(i => i.category === 'seo')}
              scanned={scanned}
              onShow={props.onShow}
              onRequest={setRequestFor}
              readOnly={readOnly}
            />
            {seoSource ? <SeoSummary seo={seoSource.seo} /> : null}
          </div>
        ) : null}
        {tab === 'a11y' || tab === 'links' || tab === 'launch' ? (
          <IssueList
            issues={detail.issues.filter(i => i.category === current.category)}
            scanned={scanned}
            onShow={props.onShow}
            onRequest={setRequestFor}
            readOnly={readOnly}
          />
        ) : null}
      </div>
      <CreateRequestDialog
        open={requestFor !== null}
        onClose={() => setRequestFor(null)}
        issue={requestFor}
        pagePath={props.pagePath}
        viewport={requestFor?.viewport}
        onCreate={async input => {
          if (!requestFor) throw new Error('No issue selected.')
          return props.onCreateRequest(requestFor, input)
        }}
      />
    </div>
  )
}

function PanelMessage({ text, tone, spinner = false }: { text: string; tone: 'muted' | 'danger'; spinner?: boolean }) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={[
        'flex items-center rounded-[var(--radius-leaf-sm)] border border-[var(--color-border-subtle)] bg-[var(--color-bg-secondary)] px-4 py-3',
        tone === 'danger' ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]',
      ].join(' ')}
      style={{ gap: '0.5rem', fontSize: '0.8125rem' }}
    >
      {spinner ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}
      {text}
    </div>
  )
}

interface IssueListProps {
  issues: QaIssue[]
  scanned: boolean
  onShow: (issue: QaIssue) => void
  onRequest: (issue: QaIssue) => void
  readOnly: boolean
}

function IssueList({ issues, scanned, onShow, onRequest, readOnly }: IssueListProps) {
  if (!scanned) {
    return <PanelMessage tone="muted" text="Waiting for the scan" spinner />
  }
  if (issues.length === 0) {
    return <p className="px-1 text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>No issues found</p>
  }
  const sorted = sortIssues(issues)
  return (
    <ul className="flex flex-col" style={{ gap: '0.5rem' }} aria-label="Issues">
      {sorted.map((issue, i) => {
        const vp = viewportLabel(issue.viewport)
        return (
          <li
            key={`${issue.code}-${issue.selector ?? ''}-${i}`}
            className="flex flex-col rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3"
            style={{ gap: '0.5rem' }}
          >
            <div className="flex flex-wrap items-center" style={{ gap: '0.375rem' }}>
              <Badge tone={SEVERITY_TONE[issue.severity]} variant="soft" size="sm">{SEVERITY_LABEL[issue.severity]}</Badge>
              {vp ? <Badge tone="neutral" variant="outline" size="sm">{vp}</Badge> : null}
              <span className="text-[var(--color-text-subtle)]" style={{ fontSize: '0.6875rem' }}>{issue.code}</span>
            </div>
            <p className="text-[var(--color-text)] break-words" style={{ fontSize: '0.8125rem' }}>{issue.message}</p>
            <div className="flex flex-wrap items-center" style={{ gap: '0.5rem' }}>
              {issue.selector ? (
                <TahiButton variant="ghost" size="sm" onClick={() => onShow(issue)}>Show</TahiButton>
              ) : null}
              {issue.url ? (
                <a
                  href={issue.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[2.75rem] items-center rounded-[var(--radius-leaf-sm)] px-2 text-[var(--color-brand-dark)] transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
                  style={{ gap: '0.25rem', fontSize: '0.75rem', fontWeight: 600 }}
                >
                  Learn more
                  <ExternalLink className="size-3" aria-hidden="true" />
                </a>
              ) : null}
              <TahiButton variant="secondary" size="sm" onClick={() => onRequest(issue)} disabled={readOnly}>Create request</TahiButton>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

interface NotesTabProps {
  status: QaPageStatus
  note: string | null
  readOnly: boolean
  onPatch: (patch: QaPagePatch) => void
}

function NotesTab({ status, note, readOnly, onPatch }: NotesTabProps) {
  const [draft, setDraft] = useState(note ?? '')
  useEffect(() => {
    setDraft(note ?? '')
  }, [note])

  function saveNote() {
    const next = draft.trim() === '' ? null : draft
    if (next === (note ?? null)) return
    onPatch({ note: next })
  }

  const options: { value: QaPageStatus; label: string }[] = [
    { value: 'pass', label: 'Pass' },
    { value: 'fail', label: 'Fail' },
    { value: 'untested', label: 'Clear' },
  ]

  return (
    <div className="flex flex-col" style={{ gap: '0.75rem' }}>
      <div className="flex flex-wrap" style={{ gap: '0.5rem' }} role="group" aria-label="Page status">
        {options.map(o => {
          const on = status === o.value
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              disabled={readOnly}
              onClick={() => onPatch({ status: o.value })}
              className="min-h-[2.75rem] min-w-[4.5rem] rounded-[var(--radius-leaf-sm)] border px-3 transition-colors hover:bg-[var(--color-bg-tertiary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                fontWeight: 600,
                fontSize: '0.8125rem',
                borderColor: on ? 'var(--color-brand)' : 'var(--color-border)',
                background: on ? 'var(--color-brand-50)' : 'var(--color-bg)',
                color: 'var(--color-text)',
              }}
            >
              {o.label}
            </button>
          )
        })}
      </div>
      <label className="flex flex-col" style={{ gap: '0.375rem' }}>
        <span className="text-[var(--color-text)]" style={{ fontSize: '0.8125rem', fontWeight: 600 }}>Note</span>
        <Textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={saveNote}
          disabled={readOnly}
          rows={4}
          maxLength={4000}
          placeholder="What did you see on this page?"
        />
      </label>
    </div>
  )
}
