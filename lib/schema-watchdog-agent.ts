/**
 * Schema watchdog agent.
 *
 * Weekly defensive scan across every live blog post + glossary term
 * on tahi.studio. For each:
 *   1. Re-validates the JSON-LD in Webflow's `schema` field against
 *      our schema-validate rules
 *   2. Fetches the live URL and confirms the schema is actually
 *      embedded in the rendered HTML (caught a class of bugs where
 *      Webflow's CMS field was set but the template didn't render it)
 *   3. Checks Webflow's lastUpdated vs lastPublished to flag items
 *      modified-but-not-republished (lost edits)
 *
 * Returns a triage report with: passing, schema-invalid, schema-missing
 * -from-html, stale-publish. Auto-fixes when the issue is a known
 * pattern (schema invalid → run backfill); flags everything else for
 * Liam to review.
 */

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import {
  listCollectionItems, getBlogPostsCollectionId, getGlossaryCollectionId,
} from '@/lib/webflow'
import { validateJsonLd } from '@/lib/schema-validate'
import { backfillGlossaryItem } from '@/lib/glossary-backfill'
import { backfillPost } from '@/lib/post-backfill'

type Database = Awaited<ReturnType<typeof db>>

type IssueType = 'schema_invalid' | 'schema_missing' | 'schema_not_in_html' | 'stale_publish' | 'fetch_failed'

export interface WatchdogIssue {
  type: 'blog' | 'glossary'
  itemId: string
  slug: string
  title: string
  url: string
  issue: IssueType
  detail?: string
  autoFixed: boolean
  autoFixError?: string
}

export interface WatchdogRunResult {
  totalScanned: number
  passing: number
  issues: WatchdogIssue[]
  autoFixed: number
  durationMs: number
}

const STALE_AFTER_MS = 14 * 86400_000   // 14 days = "should have been re-published"

async function fetchLiveSchema(url: string): Promise<{ ok: boolean; schemaCount: number; error?: string }> {
  try {
    // 4s budget per fetch — schema watchdog has 140+ URLs to walk and
    // a 25s Worker budget. 4s × 8 parallel = 4s per batch, easily inside
    // budget for the per-URL HTTP work.
    const res = await fetch(url, { headers: { 'User-Agent': 'TahiSchemaWatchdog/1.0' }, signal: AbortSignal.timeout(4000) })
    if (!res.ok) return { ok: false, schemaCount: 0, error: `HTTP ${res.status}` }
    const html = await res.text()
    const matches = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>/gi) ?? []
    return { ok: true, schemaCount: matches.length }
  } catch (err) {
    return { ok: false, schemaCount: 0, error: err instanceof Error ? err.message.slice(0, 80) : 'fetch error' }
  }
}

export interface RunOptions {
  /** When true, auto-run backfill on items with invalid schema. Default true.
   *  Set false for dry-run / preview. */
  autoFix?: boolean
  /** Max items to scan per call. Default 40 — Worker has 25s budget and
   *  each item is one live HTTP fetch + one schema validate. 40 items
   *  in parallel batches of 8 = 5 batches × 4s = ~20s. */
  maxItems?: number
  /** Hard budget ms. Default 22000 (leaves headroom inside Worker 30s). */
  budgetMs?: number
}

export async function runSchemaWatchdog(
  database: Database,
  opts: RunOptions = {},
): Promise<WatchdogRunResult> {
  const t0 = Date.now()
  const autoFix = opts.autoFix !== false
  const maxItems = opts.maxItems ?? 40
  const budgetMs = opts.budgetMs ?? 22_000

  const issues: WatchdogIssue[] = []
  let totalScanned = 0
  let passing = 0
  let autoFixed = 0

  async function scanCollection(collectionId: string, type: 'blog' | 'glossary', urlPath: string) {
    let offset = 0
    while (totalScanned < maxItems && Date.now() - t0 < budgetMs) {
      const page = await listCollectionItems(collectionId, { offset, limit: 50 })
      if (page.items.length === 0) break
      // Parallel-process each page to keep within budget. The work is
      // mostly remote: fetch page HTML + validate schema. 8 concurrent.
      const results = await Promise.allSettled(page.items.map(async item => {
        const f = item.fieldData as Record<string, unknown>
        const slug = (f.slug as string | undefined) ?? ''
        const title = (f.name as string | undefined) ?? '(untitled)'
        const url = `https://www.tahi.studio/${urlPath}/${slug}`
        const schemaStr = (f.schema as string | undefined) ?? ''
        const lastUpdated = item.lastUpdated ?? null
        const lastPublished = item.lastPublished ?? null

        const itemIssues: WatchdogIssue[] = []

        // Check 1: schema field present + valid
        if (!schemaStr) {
          itemIssues.push({ type, itemId: item.id, slug, title, url, issue: 'schema_missing', autoFixed: false })
        } else {
          const v = validateJsonLd(schemaStr)
          if (!v.valid) {
            itemIssues.push({
              type, itemId: item.id, slug, title, url,
              issue: 'schema_invalid',
              detail: `${v.errors.length} errors: ${v.errors.slice(0, 2).map(e => e.message).join('; ')}`,
              autoFixed: false,
            })
          }
        }

        // Check 2: schema embedded in live HTML
        const live = await fetchLiveSchema(url)
        if (!live.ok) {
          itemIssues.push({ type, itemId: item.id, slug, title, url, issue: 'fetch_failed', detail: live.error, autoFixed: false })
        } else if (live.schemaCount === 0 && schemaStr) {
          itemIssues.push({
            type, itemId: item.id, slug, title, url,
            issue: 'schema_not_in_html',
            detail: 'Schema field set in CMS but not rendered on live page (template binding issue?)',
            autoFixed: false,
          })
        }

        // Check 3: modified but not republished
        if (lastUpdated && lastPublished) {
          const editAge = Date.parse(lastUpdated) - Date.parse(lastPublished)
          if (editAge > STALE_AFTER_MS) {
            itemIssues.push({
              type, itemId: item.id, slug, title, url,
              issue: 'stale_publish',
              detail: `Last updated ${new Date(lastUpdated).toISOString().slice(0, 10)} but last published ${new Date(lastPublished).toISOString().slice(0, 10)} — drift > 14 days`,
              autoFixed: false,
            })
          }
        }

        return itemIssues
      }))

      for (const r of results) {
        if (r.status === 'fulfilled') {
          totalScanned++
          if (r.value.length === 0) {
            passing++
          } else {
            for (const i of r.value) issues.push(i)
          }
        } else {
          totalScanned++
        }
      }

      if (page.items.length < 50) break
      offset += page.items.length
    }
  }

  try {
    const blogId = await getBlogPostsCollectionId()
    await scanCollection(blogId, 'blog', 'blog')
  } catch (err) { console.error('watchdog blog scan failed', err) }

  if (Date.now() - t0 < budgetMs && totalScanned < maxItems) {
    try {
      const glossId = await getGlossaryCollectionId()
      await scanCollection(glossId, 'glossary', 'resources/glossary')
    } catch (err) { console.error('watchdog glossary scan failed', err) }
  }

  // Auto-fix loop: for schema_invalid + schema_missing issues, run the
  // appropriate backfill (regenerates schema, patches Webflow). The
  // schema_not_in_html issue isn't auto-fixable (Webflow template
  // binding) — flagged only.
  if (autoFix) {
    for (const issue of issues) {
      if (Date.now() - t0 > budgetMs) break
      if (issue.issue !== 'schema_invalid' && issue.issue !== 'schema_missing') continue
      try {
        if (issue.type === 'glossary') {
          const glossId = await getGlossaryCollectionId()
          await backfillGlossaryItem(glossId, issue.itemId, { dryRun: false })
        } else {
          const blogId = await getBlogPostsCollectionId()
          await backfillPost(blogId, issue.itemId, { dryRun: false })
        }
        issue.autoFixed = true
        autoFixed++
      } catch (err) {
        issue.autoFixError = err instanceof Error ? err.message.slice(0, 100) : 'auto-fix failed'
      }
    }
  }

  return {
    totalScanned,
    passing,
    issues,
    autoFixed,
    durationMs: Date.now() - t0,
  }
}
