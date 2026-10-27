'use client'

import { useState } from 'react'
import { apiPath } from '@/lib/api'
import { Menu } from '@/components/tahi/menu'
import { Badge, type BadgeTone } from '@/components/tahi/badge'
import { SlideOver } from '@/components/tahi/slide-over'
import { Textarea } from '@/components/tahi/input'
import { TahiButton } from '@/components/tahi/tahi-button'
import { ConfirmDialog } from '@/components/tahi/confirm-dialog'
import { useToast } from '@/components/tahi/toast'
import type { QaLinkResult } from '@/lib/qa/types'
import type { QaSiteCheck } from '@/lib/qa/site-checks'
import type { QaRoundRow } from './qa-types'

const CHECK_TONE: Record<QaSiteCheck['result'], BadgeTone> = { pass: 'positive', warn: 'warning', fail: 'danger' }
const CHECK_LABEL: Record<QaSiteCheck['code'], string> = {
  robots: 'robots.txt',
  sitemap: 'sitemap.xml',
  https_redirect: 'HTTP to HTTPS',
  www_canonical: 'www and apex',
  favicon: 'Favicon',
}

export interface RedirectMapRow extends QaLinkResult {
  oldUrl: string
  mappedUrl: string | null
}

async function readError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => null)) as { error?: unknown } | null
  return typeof body?.error === 'string' ? body.error : `Request failed (${res.status})`
}

/** Parses one URL per line. Blank lines are dropped, duplicates removed. */
export function parseUrlLines(text: string): string[] {
  return [...new Set(text.split(/\r?\n/).map(l => l.trim()).filter(Boolean))]
}

export interface RoundActionsProps {
  round: QaRoundRow
  readOnly: boolean
  scanRunning: boolean
  /** Scan all is off, for example when the browser being tested is not part of the round. */
  scanAllDisabled?: boolean
  onScanAll: () => void
  onRoundChanged: () => Promise<void>
  onCloseRound: () => void
  onReopenRound: () => void
}

export function RoundActions({ round, readOnly, scanRunning, scanAllDisabled = false, onScanAll, onRoundChanged, onCloseRound, onReopenRound }: RoundActionsProps) {
  const { showToast } = useToast()
  const [checks, setChecks] = useState<QaSiteCheck[] | null>(round.siteChecks)
  const [checksOpen, setChecksOpen] = useState(false)
  const [checksRunning, setChecksRunning] = useState(false)
  const [mapOpen, setMapOpen] = useState(false)
  const [mapText, setMapText] = useState('')
  const [mapRunning, setMapRunning] = useState(false)
  const [mapRows, setMapRows] = useState<RedirectMapRow[] | null>(null)
  const [mapError, setMapError] = useState<string | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const live = round.target === 'live'

  async function runSiteChecks() {
    setChecksOpen(true)
    setChecksRunning(true)
    try {
      const res = await fetch(apiPath(`/api/admin/qa/rounds/${round.id}/site-checks`), { method: 'POST' })
      if (!res.ok) throw new Error(await readError(res))
      const json = (await res.json()) as { checks?: QaSiteCheck[] }
      setChecks(json.checks ?? [])
      await onRoundChanged()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Site checks failed.', 'error')
    } finally {
      setChecksRunning(false)
    }
  }

  async function runRedirectMap() {
    const urls = parseUrlLines(mapText)
    if (urls.length === 0) {
      setMapError('Paste at least one old URL.')
      return
    }
    if (urls.length > 500) {
      setMapError('Check at most 500 URLs at a time.')
      return
    }
    setMapRunning(true)
    setMapError(null)
    try {
      // The route takes 150 old URLs per call and hands back any its fetch
      // budget did not reach as `unchecked`. Later calls send append: true so
      // the stored map keeps the earlier batches.
      let queue = [...urls]
      let rows: RedirectMapRow[] = []
      for (let call = 0; call < 10 && queue.length > 0; call++) {
        const batch = queue.slice(0, 150)
        const res = await fetch(apiPath(`/api/admin/qa/rounds/${round.id}/redirect-map`), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ urls: batch, append: call > 0 }),
        })
        if (!res.ok) throw new Error(await readError(res))
        const json = (await res.json()) as { results?: RedirectMapRow[]; unchecked?: string[] }
        const fresh = json.results ?? []
        const done = new Set(fresh.map(r => r.oldUrl))
        rows = [...rows.filter(r => !done.has(r.oldUrl)), ...fresh]
        queue = [...(json.unchecked ?? []), ...queue.slice(150)]
      }
      setMapRows(rows)
      await onRoundChanged()
    } catch (err) {
      setMapError(err instanceof Error ? err.message : 'Redirect map check failed.')
    } finally {
      setMapRunning(false)
    }
  }

  return (
    <>
      <Menu
        align="end"
        trigger={
          <TahiButton variant="secondary" size="md" disabled={scanRunning}>
            Round actions
          </TahiButton>
        }
      >
        <Menu.Item onClick={() => void runSiteChecks()} disabled={readOnly}>
          Run site checks
        </Menu.Item>
        <Menu.Item onClick={onScanAll} disabled={readOnly || scanRunning || scanAllDisabled}>
          Scan all pages
        </Menu.Item>
        <Menu.Item onClick={() => setMapOpen(true)} disabled={!live || readOnly}>
          Check redirect map
        </Menu.Item>
        <Menu.Divider />
        <Menu.Item href={`/qa/rounds/${round.id}/report`}>
          Open report
        </Menu.Item>
        <Menu.Divider />
        {round.status === 'open' ? (
          <Menu.Item onClick={() => setConfirmClose(true)} tone="danger">
            Close round
          </Menu.Item>
        ) : (
          <Menu.Item onClick={onReopenRound}>Reopen round</Menu.Item>
        )}
      </Menu>

      <SlideOver open={checksOpen} onClose={() => setChecksOpen(false)} title="Site checks" variant="center" maxWidth="34rem">
        <div className="flex flex-col" style={{ gap: '0.75rem' }}>
          <div className="flex justify-between" style={{ gap: '0.5rem' }}>
            <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
              {round.target === 'live' ? 'Checks the live site.' : 'Checks the staging site.'}
            </span>
            <TahiButton variant="secondary" size="sm" onClick={() => void runSiteChecks()} loading={checksRunning} disabled={checksRunning}>
              Run again
            </TahiButton>
          </div>
          {checksRunning && !checks ? (
            <p role="status" className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>Running checks</p>
          ) : null}
          {checks && checks.length === 0 ? (
            <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>No checks returned.</p>
          ) : null}
          <ul className="flex flex-col" style={{ gap: '0.5rem' }} aria-label="Site check results">
            {(checks ?? []).map(c => (
              <li key={c.code} className="flex flex-col rounded-[var(--radius-leaf-sm)] border border-[var(--color-border)] p-3" style={{ gap: '0.25rem' }}>
                <div className="flex items-center" style={{ gap: '0.5rem' }}>
                  <Badge tone={CHECK_TONE[c.result]} variant="soft" size="sm">{c.result.toUpperCase()}</Badge>
                  <span style={{ fontWeight: 600, fontSize: '0.8125rem' }}>{CHECK_LABEL[c.code]}</span>
                </div>
                <span className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </SlideOver>

      <SlideOver open={mapOpen} onClose={() => setMapOpen(false)} title="Check redirect map" variant="center" maxWidth="44rem">
        <div className="flex flex-col" style={{ gap: '1rem' }}>
          <p className="text-[var(--color-text-muted)]" style={{ fontSize: '0.8125rem' }}>
            Paste old site URLs, one per line. Each is mapped onto the live host and followed.
          </p>
          <Textarea
            value={mapText}
            onChange={e => setMapText(e.target.value)}
            rows={6}
            aria-label="Old URLs, one per line"
            placeholder={'https://old.example.com/about\nhttps://old.example.com/blog/post'}
          />
          {mapError ? <p role="alert" className="text-[var(--color-danger)]" style={{ fontSize: '0.8125rem' }}>{mapError}</p> : null}
          <div className="flex justify-end">
            <TahiButton variant="primary" onClick={() => void runRedirectMap()} loading={mapRunning} disabled={mapRunning}>
              Check redirects
            </TahiButton>
          </div>
          {mapRows ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left" style={{ fontSize: '0.8125rem' }}>
                <caption className="sr-only">Redirect map results</caption>
                <thead>
                  <tr className="text-[var(--color-text-muted)]">
                    <th scope="col" className="bg-[var(--color-bg-tertiary)] px-2 py-2 font-semibold">Old URL</th>
                    <th scope="col" className="bg-[var(--color-bg-tertiary)] px-2 py-2 font-semibold">Mapped URL</th>
                    <th scope="col" className="bg-[var(--color-bg-tertiary)] px-2 py-2 font-semibold">Final status</th>
                    <th scope="col" className="bg-[var(--color-bg-tertiary)] px-2 py-2 font-semibold">Flag</th>
                  </tr>
                </thead>
                <tbody>
                  {mapRows.map((r, i) => {
                    const notChecked = r.error === 'not_checked' || (r.status == null && !r.error)
                    const flag = r.mappedUrl === null
                      ? 'Invalid URL'
                      : notChecked
                        ? 'Not checked'
                        : r.broken ? 'Broken' : r.stagingOnLive ? 'Staging host' : r.redirectChain ? 'Redirect chain' : 'OK'
                    const statusText = r.mappedUrl === null || notChecked ? 'n/a' : (r.status ?? r.error ?? 'n/a')
                    return (
                      <tr key={`${r.oldUrl}-${i}`} className="align-top odd:bg-[var(--color-bg)] even:bg-[var(--color-bg-secondary)]">
                        <td className="px-2 py-2 break-all">{r.oldUrl}</td>
                        <td className="px-2 py-2 break-all">{r.mappedUrl ?? 'Invalid URL'}</td>
                        <td className="px-2 py-2">{statusText}</td>
                        <td className="px-2 py-2">{flag}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </SlideOver>

      <ConfirmDialog
        open={confirmClose}
        title="Close this round?"
        description="A closed round is read-only. Ticks, status and notes can no longer change. You can reopen it later."
        confirmLabel="Close round"
        variant="warning"
        onConfirm={async () => {
          setConfirmClose(false)
          onCloseRound()
        }}
        onCancel={() => setConfirmClose(false)}
      />
    </>
  )
}
