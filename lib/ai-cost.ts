/**
 * AI cost tracking helpers — Phase I · Slice 9.
 *
 * Every AI call in the content pipeline should be wrapped via `recordCost`
 * so we can enforce the per-article $10 cap and aggregate spend by stage,
 * reviewer, provider, or post. The estimator uses public per-model rate
 * cards as of 2026-05; bump the constants below if pricing changes.
 *
 * All amounts are stored as USD cents (integer) so we don't carry floats
 * through D1. 1 cent = 0.01 USD.
 */

import { schema } from '@/db/d1'
import { db } from '@/lib/db'
import { and, eq } from 'drizzle-orm'

type Database = Awaited<ReturnType<typeof db>>

// Rate cards in USD per 1M tokens (input / output). Last verified 2026-05.
// Replicate / Originality / Embedding rates are per-call or per-unit.
export const RATE_CARD = {
  anthropic: {
    'claude-opus-4-7':       { in: 15.00, out: 75.00 },
    'claude-sonnet-4-6':     { in: 3.00,  out: 15.00 },
    'claude-haiku-4-5':      { in: 1.00,  out: 5.00 },
  } as const,
  openai: {
    'text-embedding-3-small': { perMillionTokens: 0.02 },
    'gpt-5':                  { in: 5.00, out: 25.00 },   // placeholder until GA pricing confirmed
  } as const,
  perplexity: {
    'sonar-pro':              { in: 3.00, out: 15.00 },
    'sonar':                  { in: 1.00, out: 1.00 },
  } as const,
  replicate: {
    // Flux 1.1 Pro: $0.04 per image as of 2026-05.
    'black-forest-labs/flux-1.1-pro': { perCall: 0.04 },
    // Flux schnell (cheap fallback)
    'black-forest-labs/flux-schnell': { perCall: 0.003 },
  } as const,
} as const

export type Provider = keyof typeof RATE_CARD
export type Scope = 'draft' | 'ideation' | 'backfill' | 'links' | 'health'

export interface CostInput {
  scope: Scope
  scopeId?: string | null
  stage: string
  provider: Provider
  model: string
  inputTokens?: number
  outputTokens?: number
  callUnits?: number
  note?: string
}

/** Pure-function cost estimator. Returns cents (integer, rounded up). */
export function estimateCostCents(input: Pick<CostInput, 'provider' | 'model' | 'inputTokens' | 'outputTokens' | 'callUnits'>): number {
  const { provider, model, inputTokens = 0, outputTokens = 0, callUnits = 0 } = input
  const card = (RATE_CARD as Record<string, Record<string, unknown>>)[provider]?.[model] as
    | { in?: number; out?: number; perCall?: number; perMillionTokens?: number }
    | undefined
  if (!card) return 0
  let usd = 0
  if (card.in != null) usd += (inputTokens / 1_000_000) * card.in
  if (card.out != null) usd += (outputTokens / 1_000_000) * card.out
  if (card.perMillionTokens != null) usd += (inputTokens / 1_000_000) * card.perMillionTokens
  if (card.perCall != null) usd += callUnits * card.perCall
  return Math.ceil(usd * 100)
}

/** Persist a cost log row. Use the wrapper functions in `recordedCall`
 *  helpers below for the common case where the same data feeds both the
 *  log row and the cost estimate. */
export async function recordCost(database: Database, input: CostInput): Promise<number> {
  const cents = estimateCostCents(input)
  await database.insert(schema.aiCostLog).values({
    id: crypto.randomUUID(),
    scope: input.scope,
    scopeId: input.scopeId ?? null,
    stage: input.stage,
    provider: input.provider,
    model: input.model,
    inputTokens: input.inputTokens ?? null,
    outputTokens: input.outputTokens ?? null,
    callUnits: input.callUnits ?? null,
    estimatedUsdCents: cents,
    note: input.note ?? null,
  })
  return cents
}

/** Sum the running cost for a draft. Used by the orchestrator to enforce
 *  the per-article cap before kicking off another stage. */
export async function getDraftSpendCents(database: Database, draftId: string): Promise<number> {
  const rows = await database
    .select({ cents: schema.aiCostLog.estimatedUsdCents })
    .from(schema.aiCostLog)
    .where(and(
      eq(schema.aiCostLog.scope, 'draft'),
      eq(schema.aiCostLog.scopeId, draftId),
    ))
  return rows.reduce((sum, r) => sum + (r.cents ?? 0), 0)
}

/** Per-article cap in USD cents. Hard ceiling — orchestrator halts if
 *  the next stage would push past this. */
export const DRAFT_COST_CAP_CENTS = 1000  // $10

/** When the cap is hit, estimate what the unfinished stages would have
 *  cost so we can surface "this draft was halted at $9.42 — the
 *  remaining 4 reviewers would have added ~$0.18" in the UI. */
export const ESTIMATED_STAGE_COSTS_CENTS: Record<string, number> = {
  // Research
  serp_analyst: 10,
  perplexity_research: 40,
  // Strategy
  strategist: 27,
  headline_lab: 8,
  // Drafting
  writer: 10,
  // Each reviewer (Sonnet, ~5k in + 1k out)
  reviewer_default: 3,
  // Editor (Opus, weighs all critiques)
  editor: 80,
  // Sign-off (Opus, lighter)
  signoff: 10,
  // Cover
  flux_cover: 4,
  // Embedding (negligible)
  embedding: 0,
}
