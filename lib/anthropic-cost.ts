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

export type ClaudeModel = 'claude-opus-4-7' | 'claude-sonnet-4-6' | 'claude-haiku-4-5'

export interface ClaudeCallOptions<T> {
  database: Database
  scope: 'draft' | 'ideation' | 'backfill' | 'links' | 'health'
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
    const res = await client.messages.create({
      model: options.model,
      max_tokens: options.maxTokens ?? 2000,
      // Sonnet 4.6 + Opus 4.7 deprecate temperature; defaults work fine
      // for our JSON-structured prompts.
      system: options.systemPrompt,
      messages,
    })
    const raw = res.content
      .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
      .map(b => b.text)
      .join('')
      .trim()
    return {
      raw,
      usage: {
        input: res.usage.input_tokens,
        output: res.usage.output_tokens,
      },
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
