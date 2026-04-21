/**
 * pipeline-probability.ts — historical close rate per stage.
 *
 * Decision #044 (2026-04-21): previous formula used ordinal stage position
 * to decide "did this deal reach stage X?". That breaks for side stages
 * like Stalled (position 5) which sits between Verbal Commit (4) and
 * Closed Won (6) but isn't actually on the happy path. The old math
 * attributed all closed-won deals as having "passed through Stalled"
 * which gave Stalled a 52% win rate and flattened the curve for every
 * other stage to ~25%.
 *
 * New approach: use the actual stage history from the activity log
 * (`stage_change` activities record before/after stageId in metadata,
 * and `deal_created` records the initial stageId). For each deal we
 * can derive the exact set of stages it's been in.
 *
 * Fallback: for deals with no activity history (pre-Decision #041),
 * we use current stage + the linear position assumption, but we treat
 * non-linear stages (`isLinear === false`) as side detours that don't
 * imply "past earlier linear stages".
 */

export interface StageInfo {
  id: string
  slug: string
  position: number
  isClosedWon: boolean | number
  isClosedLost: boolean | number
}

export interface DealJourney {
  dealId: string
  currentStageId: string
  /** All stages this deal has been in (including current). Unioned from
   *  activity log + current position. */
  stagesVisited: Set<string>
  isClosedWon: boolean
  isClosedLost: boolean
}

/** Stages that are "off-path" — being at one of these doesn't imply the
 *  deal has progressed past earlier stages. Matched by slug so user-
 *  customised stage names still work. */
const NON_LINEAR_SLUGS = new Set(['stalled', 'on_hold', 'on-hold', 'paused'])

export function isNonLinearStage(stage: Pick<StageInfo, 'slug'>): boolean {
  return NON_LINEAR_SLUGS.has(stage.slug)
}

export interface ActivityStageEvent {
  dealId: string | null
  type: string
  /** Raw metadata JSON string from the activities table. */
  metadata: string | null
  createdAt: string
}

interface ActivityMeta {
  initial?: { stageId?: string }
  before?: { stageId?: string }
  after?: { stageId?: string }
}

/**
 * Build a per-deal stage-journey map from activity log events.
 *
 * Input is the rows from the activities table (type in
 * ['deal_created', 'stage_change']) plus the list of known stages.
 *
 * Output: `Map<dealId, Set<stageId>>` — the set of stages each deal has
 * been in, based on the activity log alone.
 */
export function buildJourneyMap(events: ActivityStageEvent[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const e of events) {
    if (!e.dealId) continue
    let meta: ActivityMeta = {}
    try {
      meta = e.metadata ? JSON.parse(e.metadata) as ActivityMeta : {}
    } catch {
      meta = {}
    }
    const stageIds: string[] = []
    if (e.type === 'deal_created' && meta.initial?.stageId) {
      stageIds.push(meta.initial.stageId)
    }
    if (e.type === 'stage_change') {
      if (meta.before?.stageId) stageIds.push(meta.before.stageId)
      if (meta.after?.stageId) stageIds.push(meta.after.stageId)
    }
    if (stageIds.length === 0) continue
    const set = map.get(e.dealId) ?? new Set<string>()
    for (const sid of stageIds) set.add(sid)
    map.set(e.dealId, set)
  }
  return map
}

/**
 * Given a deal's current stage + the known journey from activity log,
 * compute the complete set of stages this deal has been in.
 *
 * If the deal has activity history, use it as-is (plus current stage).
 * If the deal has no history (pre-logging), infer from linear order:
 * every stage up to (and including) the current position, EXCLUDING
 * non-linear stages (Stalled, etc.).
 */
export function inferStagesVisited(
  deal: { id: string; stageId: string; stagePosition: number },
  allStages: StageInfo[],
  journeyFromLog: Set<string> | undefined,
): Set<string> {
  if (journeyFromLog && journeyFromLog.size > 0) {
    // We have activity history — trust it, just make sure current stage is included.
    const set = new Set(journeyFromLog)
    set.add(deal.stageId)
    return set
  }
  // Fallback: linear inference, excluding non-linear stages.
  const currentStage = allStages.find(s => s.id === deal.stageId)
  const set = new Set<string>([deal.stageId])
  if (!currentStage) return set
  // If the deal is currently at a non-linear stage (e.g. Stalled), we
  // can't infer anything about what linear stages it passed through.
  // Just record it as having been at the non-linear stage.
  if (isNonLinearStage(currentStage)) return set
  // Deal is at a linear stage — assume it was at every earlier linear stage.
  for (const s of allStages) {
    if (isNonLinearStage(s)) continue
    if (s.position <= currentStage.position) set.add(s.id)
  }
  return set
}

export interface StageProbability {
  stageId: string
  /** "Of deals that were at this stage, how many eventually won?" (0-100). */
  historicalProbability: number | null
  /** How many deals we found that were ever at this stage. Used as a
   *  confidence hint — small samples return null. */
  dealsSampled: number
  /** Of `dealsSampled`, how many are currently at a closed_won stage. */
  wonCount: number
  /** How we got the answer: 'journey' (activity log), 'linear' (fallback),
   *  or 'insufficient' (under minimum sample size). */
  source: 'journey' | 'linear' | 'insufficient'
}

export interface ComputeInput {
  stages: StageInfo[]
  deals: Array<{ id: string; stageId: string; stagePosition: number }>
  /** Activity rows from the activities table where type is
   *  'deal_created' or 'stage_change'. */
  stageEvents: ActivityStageEvent[]
  /** Minimum deals a stage must have been seen by before we'll publish
   *  a probability. Default 3. */
  minSample?: number
}

/**
 * Compute historical probability per stage using journey-based math
 * (see module docstring for the derivation).
 */
export function computeStageProbabilities(input: ComputeInput): Map<string, StageProbability> {
  const { stages, deals, stageEvents, minSample = 3 } = input
  const journey = buildJourneyMap(stageEvents)
  const wonStageIds = new Set(stages.filter(s => s.isClosedWon).map(s => s.id))

  // Build (dealId -> stagesVisited) using journey + fallback.
  const perDealStages = new Map<string, Set<string>>()
  for (const deal of deals) {
    perDealStages.set(deal.id, inferStagesVisited(deal, stages, journey.get(deal.id)))
  }

  const out = new Map<string, StageProbability>()
  for (const stage of stages) {
    // Closed stages don't get a prediction — they're the target.
    if (stage.isClosedWon || stage.isClosedLost) {
      out.set(stage.id, { stageId: stage.id, historicalProbability: null, dealsSampled: 0, wonCount: 0, source: 'journey' })
      continue
    }
    let sampled = 0
    let won = 0
    for (const deal of deals) {
      const visited = perDealStages.get(deal.id)
      if (!visited || !visited.has(stage.id)) continue
      sampled++
      if (wonStageIds.has(deal.stageId)) won++
    }
    const source: StageProbability['source'] =
      sampled < minSample ? 'insufficient' :
      journey.size > 0 ? 'journey' : 'linear'
    const historicalProbability = sampled >= minSample
      ? Math.round((won / sampled) * 100)
      : null
    out.set(stage.id, { stageId: stage.id, historicalProbability, dealsSampled: sampled, wonCount: won, source })
  }
  return out
}
