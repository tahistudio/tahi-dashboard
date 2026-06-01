/**
 * Cost-tracked Anthropic wrapper — Phase I · Slice 9.
 *
 * Every Anthropic call in the content pipeline goes through `claudeJson`
 * so we get a single place that handles:
 *   - JSON parsing (with retry on parse failure)
 *   - cost recording into ai_cost_log
 *   - per-draft cost cap check
 *   - timeout + error wrapping
 *
 * The wrapper is JSON-first because the entire round table is structured:
 * Strategist returns a brief.json, each reviewer returns a critique.json,
 * Editor returns a revision + decision log. Free-form text would make the
 * tie-breaking + scoring impossible to wire up.
 */

import { recordCost, getDraftSpendCents, DRAFT_COST_CAP_CENTS } from '@/lib/ai-cost'
import { db } from '@/lib/db'

type Database = Awaited<ReturnType<typeof db>>

// String, not a literal union — models come from lib/ai-models.ts which
// is env-overridable, so a new published ID must be accepted without a
// type change. Cost estimation degrades gracefully (0) for IDs not in
// the rate card.
export type ClaudeModel = string

export interface ClaudeCallOptions<T> {
  database: Database
  scope: 'draft' | 'ideation' | 'backfill' | 'links' | 'health' | 'site_index' | 'sitemap'
  scopeId?: string | null
  /** Stage name — also written to ai_cost_log.stage. Use snake_case keys
   *  matching draft_reviews.reviewer_key when this call is a reviewer. */
  stage: string
  model: ClaudeModel
  systemPrompt: string
  userPrompt: string
  /** Max output tokens for this call. Default 2000. */
  maxTokens?: number
  /** Validator + parser for the JSON the model returns. If it throws,
   *  we'll retry once with a stricter "JSON only, no preamble" reminder. */
  parse: (raw: string) => T
  /** If true, skip the per-draft cost cap check (use for scoped='ideation'
   *  or 'backfill' which have their own budgets). */
  skipCostCap?: boolean
  /** Static text blocks to prepend to the system prompt and mark for
   *  prompt caching. Use for large, stable context (brand DNA, tone of
   *  voice doc, AI-tells doc, research brief shared across N reviewers).
   *  Each block ≥1024 tokens to qualify for the cache. When set, the
   *  `systemPrompt` field becomes the FINAL system block (also cached
   *  if >1024 tokens — Anthropic caches the longest matching prefix).
   *  Cache TTL is 5min — call cadence must be inside that window for
   *  hits to register. */
  cachedSystemBlocks?: string[]
}

export class CostCapExceededError extends Error {
  constructor(
    public draftId: string,
    public spentCents: number,
    public capCents: number,
    public stage: string,
  ) {
    super(`Draft ${draftId} has spent $${(spentCents / 100).toFixed(2)} (cap: $${(capCents / 100).toFixed(2)}); halted before stage "${stage}"`)
    this.name = 'CostCapExceededError'
  }
}

export class ClaudeJsonParseError extends Error {
  constructor(public stage: string, public rawSnippet: string) {
    super(`Claude returned non-JSON for stage "${stage}": ${rawSnippet.slice(0, 200)}`)
    this.name = 'ClaudeJsonParseError'
  }
}

/** Single typed JSON call. Records cost, enforces draft cap, retries
 *  once on parse failure. Returns the parsed result + the cents spent
 *  on this single call. */
export async function claudeJson<T>(options: ClaudeCallOptions<T>): Promise<{ result: T; costCents: number }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not configured')

  // Cost cap check.
  if (!options.skipCostCap && options.scope === 'draft' && options.scopeId) {
    const alreadySpent = await getDraftSpendCents(options.database, options.scopeId)
    if (alreadySpent >= DRAFT_COST_CAP_CENTS) {
      throw new CostCapExceededError(options.scopeId, alreadySpent, DRAFT_COST_CAP_CENTS, options.stage)
    }
  }

  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey })

  async function callOnce(extraReminder?: string): Promise<{ raw: string; usage: { input: number; output: number } }> {
    const messages = [
      { role: 'user' as const, content: options.userPrompt + (extraReminder ?? '') },
    ]
    // Retry on 429 (org output-tokens-per-minute rate limit) with
    // exponential backoff + jitter. Low Anthropic tiers cap at 8k output
    // TPM, which 20+ parallel reviewers blow through; backoff lets them
    // drain over a couple minutes instead of hard-failing.
    let attempt = 0
    const maxAttempts = 5
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        // Build system as an array of text blocks when caching is on.
        // Each cached block gets cache_control: ephemeral so Anthropic
        // hashes + reuses it across calls in the next 5 minutes.
        const systemValue = options.cachedSystemBlocks && options.cachedSystemBlocks.length > 0
          ? [
              ...options.cachedSystemBlocks.map(text => ({
                type: 'text' as const,
                text,
                cache_control: { type: 'ephemeral' as const },
              })),
              { type: 'text' as const, text: options.systemPrompt },
            ]
          : options.systemPrompt
        const res = await client.messages.create({
          model: options.model,
          max_tokens: options.maxTokens ?? 2000,
          // Sonnet 4.6 + Opus 4.7 deprecate temperature; defaults work fine
          // for our JSON-structured prompts.
          system: systemValue,
          messages,
        })
        const raw = res.content
          .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
          .map(b => b.text)
          .join('')
          .trim()
        // Cache usage tokens come back as separate fields; total them
        // into input so the cost log captures all input bytes Anthropic
        // billed (cache reads are 0.1x, writes are 1.25x of base rate
        // but Anthropic's `usage` already reports the dollar-equivalent
        // counts — we just sum them).
        const cacheCreateTokens = (res.usage as { cache_creation_input_tokens?: number }).cache_creation_input_tokens ?? 0
        const cacheReadTokens = (res.usage as { cache_read_input_tokens?: number }).cache_read_input_tokens ?? 0
        return {
          raw,
          usage: {
            input: res.usage.input_tokens + cacheCreateTokens + cacheReadTokens,
            output: res.usage.output_tokens,
          },
        }
      } catch (err) {
        const status = (err as { status?: number })?.status
        const isRateLimit = status === 429
        const isOverloaded = status === 529
        if ((isRateLimit || isOverloaded) && attempt < maxAttempts) {
          // Honour Retry-After header if present, else exponential backoff.
          const retryAfter = Number((err as { headers?: Record<string, string> })?.headers?.['retry-after'])
          const backoffMs = Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(30_000, 2_000 * 2 ** attempt)
          const jitter = Math.floor(Math.random() * 1_000)
          await new Promise(r => setTimeout(r, backoffMs + jitter))
          attempt++
          continue
        }
        throw err
      }
    }
  }

  // First attempt
  let { raw, usage } = await callOnce()
  // Strip ```json fences if model wrapped its response
  raw = stripCodeFences(raw)
  let parsed: T
  try {
    parsed = options.parse(raw)
  } catch {
    // Retry once with a stricter reminder
    const retry = await callOnce('\n\nIMPORTANT: respond with ONLY the JSON object/array. No prose, no markdown fences, no explanation.')
    const retryUsage = retry.usage
    const retryRaw = stripCodeFences(retry.raw)
    try {
      parsed = options.parse(retryRaw)
      // Record the first failed attempt as cost too
      await recordCost(options.database, {
        scope: options.scope, scopeId: options.scopeId, stage: options.stage + '_retry',
        provider: 'anthropic', model: options.model,
        inputTokens: usage.input, outputTokens: usage.output,
      })
      usage = retryUsage
      raw = retryRaw
    } catch {
      throw new ClaudeJsonParseError(options.stage, retryRaw)
    }
  }

  const costCents = await recordCost(options.database, {
    scope: options.scope, scopeId: options.scopeId, stage: options.stage,
    provider: 'anthropic', model: options.model,
    inputTokens: usage.input, outputTokens: usage.output,
  })

  return { result: parsed, costCents }
}

function stripCodeFences(s: string): string {
  // Handles ```json\n{...}\n``` and ```\n{...}\n```
  const fenceMatch = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (fenceMatch) return fenceMatch[1].trim()
  return s
}

/** Helper for parsers — extracts the first {...} or [...] block from
 *  the response in case the model added stray text around it. */
export function extractJsonBlock(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return trimmed
  const objMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objMatch) return objMatch[0]
  const arrMatch = trimmed.match(/\[[\s\S]*\]/)
  if (arrMatch) return arrMatch[0]
  return trimmed
}
