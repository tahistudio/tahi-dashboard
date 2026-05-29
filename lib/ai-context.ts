/**
 * AI context loader — hooks Docs Hub pages into the AI prompts so the
 * same doc Liam edits in the dashboard is what the AI reads when
 * scoring, enriching, or drafting replies.
 *
 * Setting keys (seeded by migration 0048):
 *   ai.icpDocId           — Ideal Client Profile (drives scoring + enrichment fit)
 *   ai.brandDnaDocId      — Brand DNA (drives reply tone, value-prop framing)
 *   ai.toneDocId          — Tone of Voice (drives reply phrasing)
 *   ai.liamVoiceDocId     — Liam Personal Voice (drives reply tone for personal outreach)
 *   ai.servicesDocId      — Services + Pricing (so the AI knows what we sell)
 *
 * A simple in-memory cache keeps doc lookups cheap when the cron fires
 * every 30s. Cache TTL is 5 minutes — long enough to amortise reads
 * across a cron tick, short enough that doc edits propagate quickly.
 */

import { db } from '@/lib/db'
import { schema } from '@/db/d1'
import { eq, inArray } from 'drizzle-orm'

export type AiContextKey =
  | 'icp'
  | 'brandDna'
  | 'tone'
  | 'liamVoice'
  | 'staciVoice'
  | 'aiTells'
  | 'services'

const SETTING_KEY_BY_CONTEXT: Record<AiContextKey, string> = {
  icp: 'ai.icpDocId',
  brandDna: 'ai.brandDnaDocId',
  tone: 'ai.toneDocId',
  liamVoice: 'ai.liamVoiceDocId',
  staciVoice: 'ai.staciVoiceDocId',
  aiTells: 'ai.aiTellsDocId',
  services: 'ai.servicesDocId',
}

const SECTION_LABEL_BY_CONTEXT: Record<AiContextKey, string> = {
  icp: 'IDEAL CLIENT PROFILE',
  brandDna: 'BRAND DNA',
  tone: 'TONE OF VOICE',
  liamVoice: 'LIAM\'S PERSONAL VOICE',
  staciVoice: 'STACI\'S PERSONAL VOICE',
  aiTells: 'AI WRITING TELLS (to AVOID)',
  services: 'SERVICES + PRICING',
}

interface CacheEntry {
  text: string
  expiresAt: number
}

const CACHE_TTL_MS = 5 * 60_000
const cache = new Map<string, CacheEntry>()

/** Load and cache the resolved text content for a list of context keys.
 *  Returns the formatted block ready to prepend to a system prompt.
 *  Missing settings or unresolved docs are silently skipped — the AI
 *  just proceeds without that context (it's additive, not required). */
export async function loadAiContext(keys: AiContextKey[]): Promise<string> {
  if (keys.length === 0) return ''

  // Resolve doc IDs for each requested context key via settings table
  // (or cached resolution if we've done it recently).
  const database = await db()
  const settingKeys = keys.map(k => SETTING_KEY_BY_CONTEXT[k])

  // Try cache first per-doc-id to avoid the docs join when fully warm.
  // Cache key is `doc:${docId}`.
  const settingRows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, settingKeys))

  const docIdByContext = new Map<AiContextKey, string>()
  for (const row of settingRows) {
    const contextKey = keys.find(k => SETTING_KEY_BY_CONTEXT[k] === row.key)
    if (contextKey && row.value?.trim()) {
      docIdByContext.set(contextKey, row.value.trim())
    }
  }

  if (docIdByContext.size === 0) return ''

  // Pull doc text — check cache, then fetch any cold ones in one query.
  const now = Date.now()
  const docIds = Array.from(docIdByContext.values())
  const cold = docIds.filter(id => {
    const c = cache.get(`doc:${id}`)
    return !c || c.expiresAt < now
  })

  if (cold.length > 0) {
    const docs = await database
      .select({ id: schema.docPages.id, contentText: schema.docPages.contentText })
      .from(schema.docPages)
      .where(inArray(schema.docPages.id, cold))
    for (const d of docs) {
      if (d.contentText) {
        cache.set(`doc:${d.id}`, { text: d.contentText, expiresAt: now + CACHE_TTL_MS })
      }
    }
    // Mark missing docs in cache too so we don't re-query for 5min.
    for (const id of cold) {
      if (!cache.has(`doc:${id}`) || cache.get(`doc:${id}`)!.expiresAt < now) {
        cache.set(`doc:${id}`, { text: '', expiresAt: now + CACHE_TTL_MS })
      }
    }
  }

  // Assemble the formatted block. One section per context key with a
  // clear label so the model can reason about which context is which.
  const sections: string[] = []
  for (const key of keys) {
    const docId = docIdByContext.get(key)
    if (!docId) continue
    const cached = cache.get(`doc:${docId}`)
    if (!cached?.text) continue
    const label = SECTION_LABEL_BY_CONTEXT[key]
    sections.push(`=== ${label} ===\n${cached.text}\n=== END ${label} ===`)
  }

  if (sections.length === 0) return ''

  return [
    '# TAHI CONTEXT (always-on)',
    'The following is canonical Tahi Studio context loaded from the Docs Hub. Use it to inform scoring, recommendations, and any client-facing writing. Do not quote or paraphrase the framing language directly to clients.',
    '',
    sections.join('\n\n'),
  ].join('\n')
}

/** Load the raw text of each requested context doc as a map keyed by
 *  context key. Missing settings or empty docs map to an empty string.
 *  Used by the blog drafting pipeline which needs each doc as its own
 *  ephemeral system block (rather than the combined block loadAiContext
 *  returns). Same 5-minute cache. */
export async function loadAiContextDocs(
  keys: AiContextKey[],
): Promise<Record<AiContextKey, string>> {
  const result: Record<AiContextKey, string> = {
    icp: '', brandDna: '', tone: '',
    liamVoice: '', staciVoice: '', aiTells: '', services: '',
  }
  if (keys.length === 0) return result

  const database = await db()
  const settingKeys = keys.map(k => SETTING_KEY_BY_CONTEXT[k])
  const settingRows = await database
    .select({ key: schema.settings.key, value: schema.settings.value })
    .from(schema.settings)
    .where(inArray(schema.settings.key, settingKeys))

  const docIdByContext = new Map<AiContextKey, string>()
  for (const row of settingRows) {
    const contextKey = keys.find(k => SETTING_KEY_BY_CONTEXT[k] === row.key)
    if (contextKey && row.value?.trim()) {
      docIdByContext.set(contextKey, row.value.trim())
    }
  }
  if (docIdByContext.size === 0) return result

  const now = Date.now()
  const docIds = Array.from(docIdByContext.values())
  const cold = docIds.filter(id => {
    const c = cache.get(`doc:${id}`)
    return !c || c.expiresAt < now
  })
  if (cold.length > 0) {
    const docs = await database
      .select({ id: schema.docPages.id, contentText: schema.docPages.contentText })
      .from(schema.docPages)
      .where(inArray(schema.docPages.id, cold))
    for (const d of docs) {
      if (d.contentText) {
        cache.set(`doc:${d.id}`, { text: d.contentText, expiresAt: now + CACHE_TTL_MS })
      }
    }
    for (const id of cold) {
      if (!cache.has(`doc:${id}`) || cache.get(`doc:${id}`)!.expiresAt < now) {
        cache.set(`doc:${id}`, { text: '', expiresAt: now + CACHE_TTL_MS })
      }
    }
  }

  for (const key of keys) {
    const docId = docIdByContext.get(key)
    if (!docId) continue
    const cached = cache.get(`doc:${docId}`)
    if (cached?.text) {
      result[key] = cached.text
    }
  }
  return result
}

/** Get the resolved doc id for a single context key, no caching. Used
 *  by the settings UI to render the current selection. */
export async function getAiContextDocId(key: AiContextKey): Promise<string | null> {
  const database = await db()
  const [row] = await database
    .select({ value: schema.settings.value })
    .from(schema.settings)
    .where(eq(schema.settings.key, SETTING_KEY_BY_CONTEXT[key]))
    .limit(1)
  return row?.value?.trim() || null
}

/** Clear the in-memory cache — call after a doc edit if you want the
 *  AI to pick up changes before the 5min TTL expires. */
export function invalidateAiContextCache(docId?: string): void {
  if (docId) {
    cache.delete(`doc:${docId}`)
  } else {
    cache.clear()
  }
}
