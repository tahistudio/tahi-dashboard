'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { apiPath } from '@/lib/api'
import { SlideOver } from '@/components/tahi/slide-over'
import { Input, Select, Textarea } from '@/components/tahi/input'
import { SegmentedControl } from '@/components/tahi/segmented-control'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { QaTarget } from '@/lib/qa/types'
import {
  CRAWL_MAX_PAGES_DEFAULT,
  CRAWL_MAX_PAGES_LIMIT,
  PAGE_PATH_LIMIT,
  countNonEmptyLines,
  isHttpsUrl,
  isPathListWithinLimit,
  parseMaxPages,
  parsePathList,
} from './add-pages-helpers'

type PagesTab = 'paste' | 'crawl' | 'sitemap'

interface PathsResponse {
  added: number
  restored: number
  skipped: number
  invalid: string[]
}

interface CrawlResponse {
  found: number
  added: number
  restored: number
  truncated: boolean
  canonicalOrigin?: string
}

interface SitemapResponse {
  added: number
  updated: number
  removed: number
  total: number
}

type DialogResult =
  | { tab: 'paste'; data: PathsResponse }
  | { tab: 'crawl'; data: CrawlResponse }
  | { tab: 'sitemap'; data: SitemapResponse }

const TAB_OPTIONS: ReadonlyArray<{ value: PagesTab; label: string }> = [
  { value: 'paste', label: 'Paste paths' },
  { value: 'crawl', label: 'Crawl' },
  { value: 'sitemap', label: 'Sitemap URL' },
]

const FIELD_LABEL_CLASS = 'text-[var(--color-text)]'
const HELP_CLASS = 'text-[var(--color-text-muted)]'
const ERROR_CLASS = 'text-[var(--color-danger)]'
const STATUS_CLASS = 'rounded-[var(--radius-leaf-sm)] bg-[var(--color-brand-50)] px-3 py-2 text-[var(--color-text)]'

async function errorText(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

function messageOf(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export interface AddPagesDialogProps {
  open: boolean
  onClose: () => void
  siteId: string
  hasStaging: boolean
  hasLive: boolean
  /** Called after any successful add so the site page reloads its page list. */
  onAdded: () => void
}

export function AddPagesDialog({ open, onClose, siteId, hasStaging, hasLive, onAdded }: AddPagesDialogProps) {
  const base = useId()
  const id = (suffix: string) => `${base}-${suffix}`

  const targets = useMemo<QaTarget[]>(() => {
    const out: QaTarget[] = []
    if (hasStaging) out.push('staging')
    if (hasLive) out.push('live')
    return out
  }, [hasStaging, hasLive])

  const [tab, setTab] = useState<PagesTab>('paste')
  const [pasteText, setPasteText] = useState('')
  const [target, setTarget] = useState<QaTarget | null>(null)
  const [maxPagesText, setMaxPagesText] = useState(String(CRAWL_MAX_PAGES_DEFAULT))
  const [sitemapUrl, setSitemapUrl] = useState('')
  const [busy, setBusy] = useState<PagesTab | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<DialogResult | null>(null)

  // Fall back to the first available target when the stored one no longer exists.
  const activeTarget: QaTarget | null = target && targets.includes(target) ? target : (targets[0] ?? null)

  useEffect(() => {
    if (!open) return
    setTab('paste')
    setPasteText('')
    setTarget(null)
    setMaxPagesText(String(CRAWL_MAX_PAGES_DEFAULT))
    setSitemapUrl('')
    setBusy(null)
    setError(null)
    setResult(null)
  }, [open])

  const parsedPaths = useMemo(() => parsePathList(pasteText), [pasteText])
  const lineCount = countNonEmptyLines(pasteText)
  const pathsOverLimit = parsedPaths.length > PAGE_PATH_LIMIT
  const noTargets = targets.length === 0

  function switchTab(next: PagesTab) {
    if (busy) return
    setTab(next)
    setError(null)
    setResult(null)
  }

  async function send<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(apiPath(`/api/admin/qa/sites/${siteId}/${path}`), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(await errorText(res))
    return (await res.json()) as T
  }

  async function submitPaths() {
    if (parsedPaths.length === 0) {
      setError('Paste at least one path or URL.')
      return
    }
    if (!isPathListWithinLimit(parsedPaths)) {
      setError(`Add up to ${PAGE_PATH_LIMIT} paths at a time.`)
      return
    }
    setBusy('paste')
    setError(null)
    setResult(null)
    try {
      const data = await send<PathsResponse>('pages', { paths: parsedPaths })
      setResult({ tab: 'paste', data })
      onAdded()
    } catch (err) {
      setError(messageOf(err, 'Could not add the pages.'))
    } finally {
      setBusy(null)
    }
  }

  async function submitCrawl() {
    if (!activeTarget) return
    const maxPages = parseMaxPages(maxPagesText)
    if (maxPages === null) {
      setError(`Max pages must be a whole number from 1 to ${CRAWL_MAX_PAGES_LIMIT}.`)
      return
    }
    setBusy('crawl')
    setError(null)
    setResult(null)
    try {
      const data = await send<CrawlResponse>('crawl', { target: activeTarget, maxPages })
      setResult({ tab: 'crawl', data })
      onAdded()
    } catch (err) {
      setError(messageOf(err, 'Could not crawl the site.'))
    } finally {
      setBusy(null)
    }
  }

  async function submitSitemap() {
    const url = sitemapUrl.trim()
    if (!isHttpsUrl(url)) {
      setError('Enter a full https URL, such as https://www.example.com/sitemap.xml.')
      return
    }
    setBusy('sitemap')
    setError(null)
    setResult(null)
    try {
      const data = await send<SitemapResponse>('import-sitemap', { target: activeTarget ?? 'staging', sitemapUrl: url })
      setResult({ tab: 'sitemap', data })
      onAdded()
    } catch (err) {
      setError(messageOf(err, 'Could not import the sitemap.'))
    } finally {
      setBusy(null)
    }
  }

  function submitCurrent() {
    if (busy) return
    if (tab === 'paste') void submitPaths()
    else if (tab === 'crawl') void submitCrawl()
    else void submitSitemap()
  }

  const canSubmit =
    tab === 'paste'
      ? parsedPaths.length > 0 && !pathsOverLimit
      : tab === 'crawl'
        ? activeTarget !== null
        : sitemapUrl.trim().length > 0

  const targetField = (fieldId: string) => {
    if (targets.length === 0) return null
    if (targets.length === 1) {
      return (
        <p className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
          Target: <span style={{ fontWeight: 600, color: 'var(--color-text)' }}>{targets[0] === 'live' ? 'Live' : 'Staging'}</span>
        </p>
      )
    }
    return (
      <div className="flex flex-col" style={{ gap: '0.375rem' }}>
        <label htmlFor={fieldId} className={FIELD_LABEL_CLASS} style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
          Target
        </label>
        <Select
          id={fieldId}
          value={activeTarget ?? targets[0]}
          onChange={e => setTarget(e.target.value === 'live' ? 'live' : 'staging')}
          disabled={busy !== null}
          options={targets.map(t => ({ value: t, label: t === 'live' ? 'Live' : 'Staging' }))}
        />
        <p className={HELP_CLASS} style={{ fontSize: '0.75rem' }}>Which site URL these pages belong to.</p>
      </div>
    )
  }

  function renderResult(r: DialogResult) {
    if (r.tab === 'paste') {
      const { added, restored, skipped, invalid } = r.data
      return (
        <div role="status" className={STATUS_CLASS} style={{ fontSize: '0.8125rem', gap: '0.5rem' }}>
          <p style={{ fontWeight: 600 }}>
            Added {added}, restored {restored}, already there {skipped}.
          </p>
          {invalid.length > 0 ? (
            <div className="flex flex-col" style={{ gap: '0.25rem', marginTop: '0.5rem' }}>
              <p className={ERROR_CLASS}>Not added, these lines were not valid paths:</p>
              <ul className="flex flex-col" style={{ gap: '0.125rem' }} aria-label="Invalid lines">
                {invalid.map((line, i) => (
                  <li key={`${line}-${i}`} className="break-all">{line}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )
    }
    if (r.tab === 'crawl') {
      const { found, added, restored, truncated, canonicalOrigin } = r.data
      let crawledHost: string | null = null
      if (canonicalOrigin) {
        try {
          crawledHost = new URL(canonicalOrigin).host
        } catch {
          crawledHost = null
        }
      }
      return (
        <div role="status" className={STATUS_CLASS} style={{ fontSize: '0.8125rem', gap: '0.5rem' }}>
          <p style={{ fontWeight: 600 }}>
            Found {found} pages, added {added}, restored {restored}.
          </p>
          {crawledHost ? <p style={{ marginTop: '0.5rem' }}>Crawled {crawledHost} (the site redirects there).</p> : null}
          {truncated ? <p className={ERROR_CLASS} style={{ marginTop: '0.5rem' }}>Stopped at the limit, some pages may be missing.</p> : null}
        </div>
      )
    }
    const { added, updated, removed, total } = r.data
    return (
      <div role="status" className={STATUS_CLASS} style={{ fontSize: '0.8125rem' }}>
        <p style={{ fontWeight: 600 }}>
          Added {added}, updated {updated}{removed > 0 ? `, flagged ${removed} as removed` : ''}. {total} pages in the sitemap.
        </p>
      </div>
    )
  }

  const pasteId = id('paste')
  const pasteCountId = id('paste-count')
  const pasteErrorId = id('paste-error')
  const crawlTargetId = id('crawl-target')
  const maxPagesId = id('max-pages')
  const maxPagesHelpId = id('max-pages-help')
  const sitemapId = id('sitemap')
  const panelId = id('panel')

  return (
    <SlideOver open={open} onClose={onClose} title="Add pages" variant="center" maxWidth="34rem">
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={e => {
          e.preventDefault()
          if (result || !canSubmit) return
          submitCurrent()
        }}
      >
        <SlideOver.Body>
          <div className="flex flex-col" style={{ gap: '1rem' }}>
            <p className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
              Add pages to this site so they can be checked in a round. Pages that were removed before are restored.
            </p>

            <SegmentedControl<PagesTab>
              role="tablist"
              value={tab}
              onChange={switchTab}
              ariaLabel="Add pages method"
              fill
              options={TAB_OPTIONS.map(o => ({ ...o, disabled: busy !== null, panelId }))}
            />

            <div id={panelId} role="tabpanel" aria-label={TAB_OPTIONS.find(o => o.value === tab)?.label} className="flex flex-col" style={{ gap: '1rem' }}>
              {tab === 'paste' ? (
                <>
                  <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                    <label htmlFor={pasteId} className={FIELD_LABEL_CLASS} style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                      Page paths
                    </label>
                    <Textarea
                      id={pasteId}
                      rows={8}
                      value={pasteText}
                      placeholder={'/about\n/services/design\nhttps://www.example.com/contact'}
                      disabled={busy !== null}
                      aria-invalid={pathsOverLimit || undefined}
                      aria-describedby={pathsOverLimit ? `${pasteCountId} ${pasteErrorId}` : pasteCountId}
                      onChange={e => {
                        setPasteText(e.target.value)
                        setError(null)
                      }}
                    />
                    <div className="flex flex-wrap justify-between" style={{ gap: '0.25rem' }}>
                      <p id={pasteCountId} className={HELP_CLASS} style={{ fontSize: '0.75rem' }}>
                        One path or full URL per line. {lineCount} {lineCount === 1 ? 'line' : 'lines'}, up to {PAGE_PATH_LIMIT} at a time.
                      </p>
                    </div>
                  </div>
                  {pathsOverLimit ? (
                    <p id={pasteErrorId} role="alert" className={ERROR_CLASS} style={{ fontSize: '0.8125rem' }}>
                      That is {parsedPaths.length} paths. Add up to {PAGE_PATH_LIMIT} at a time, so split the list into smaller batches.
                    </p>
                  ) : null}
                </>
              ) : null}

              {tab === 'crawl' ? (
                <>
                  <p className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
                    Follows links from the homepage on the same site. Usually takes under a minute.
                  </p>
                  {targetField(crawlTargetId)}
                  <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                    <label htmlFor={maxPagesId} className={FIELD_LABEL_CLASS} style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                      Max pages
                    </label>
                    <Input
                      id={maxPagesId}
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={CRAWL_MAX_PAGES_LIMIT}
                      step={1}
                      value={maxPagesText}
                      disabled={busy !== null}
                      aria-describedby={maxPagesHelpId}
                      onChange={e => {
                        setMaxPagesText(e.target.value)
                        setError(null)
                      }}
                    />
                    <p id={maxPagesHelpId} className={HELP_CLASS} style={{ fontSize: '0.75rem' }}>
                      Between 1 and {CRAWL_MAX_PAGES_LIMIT}. The default is {CRAWL_MAX_PAGES_DEFAULT}.
                    </p>
                  </div>
                  {busy === 'crawl' ? (
                    <p role="status" className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
                      Crawling the site. This can take about 30 seconds.
                    </p>
                  ) : null}
                </>
              ) : null}

              {tab === 'sitemap' ? (
                <>
                  <p className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
                    Use this when the staging site has no sitemap, for example the live site&apos;s https://www.example.com/sitemap.xml. Paths are applied to this site.
                  </p>
                  <div className="flex flex-col" style={{ gap: '0.375rem' }}>
                    <label htmlFor={sitemapId} className={FIELD_LABEL_CLASS} style={{ fontSize: '0.8125rem', fontWeight: 600 }}>
                      Sitemap URL
                    </label>
                    <Input
                      id={sitemapId}
                      type="url"
                      inputMode="url"
                      value={sitemapUrl}
                      placeholder="https://www.example.com/sitemap.xml"
                      disabled={busy !== null}
                      onChange={e => {
                        setSitemapUrl(e.target.value)
                        setError(null)
                      }}
                    />
                  </div>
                  {busy === 'sitemap' ? (
                    <p role="status" className={HELP_CLASS} style={{ fontSize: '0.8125rem' }}>
                      Reading the sitemap.
                    </p>
                  ) : null}
                </>
              ) : null}
            </div>

            {tab === 'crawl' && noTargets ? (
              <p role="alert" className={ERROR_CLASS} style={{ fontSize: '0.8125rem' }}>
                Add a staging or live URL to this site before crawling it.
              </p>
            ) : null}
            {error ? (
              <p role="alert" className={ERROR_CLASS} style={{ fontSize: '0.8125rem' }}>
                {error}
              </p>
            ) : null}
            {result ? renderResult(result) : null}
          </div>
        </SlideOver.Body>

        <SlideOver.Footer>
          {result ? (
            <div className="flex w-full justify-end" style={{ gap: '0.5rem' }}>
              <TahiButton type="button" variant="primary" size="md" onClick={onClose}>Done</TahiButton>
            </div>
          ) : (
            <div className="flex w-full justify-end" style={{ gap: '0.5rem' }}>
              <TahiButton type="button" variant="secondary" size="md" onClick={onClose} disabled={busy !== null}>
                Cancel
              </TahiButton>
              <TahiButton
                type="submit"
                variant="primary"
                size="md"
                loading={busy !== null && busy === tab}
                disabled={busy !== null || !canSubmit}
              >
                {tab === 'paste' ? 'Add pages' : tab === 'crawl' ? 'Crawl site' : 'Import'}
              </TahiButton>
            </div>
          )}
        </SlideOver.Footer>
      </form>
    </SlideOver>
  )
}
