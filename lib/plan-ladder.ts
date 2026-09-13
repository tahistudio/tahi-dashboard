/**
 * lib/plan-ladder.ts
 *
 * The client Services plan ladder: what they have, what is one step lower and
 * what is one step higher, plus the one rule that decides whether an upsell is
 * allowed to appear at all.
 *
 * Liam, 2026-09-06: "let them see what they have, what is lower, what is
 * higher. If they are coming up against limits, then the upsell can begin.
 * Before that, it's just like suggestions for each plan: this is best if this."
 *
 * ONE RULE, and every function here obeys it:
 *
 *   A RUNG ONLY CARRIES A NUMBER IF THE NUMBER IS THE CLIENT'S OWN.
 *
 * The rung the client is standing on prints their real track entitlement and
 * their real measured turnaround. The two either side are described in words,
 * because the studio cannot source a figure for them, and an invented figure
 * on a page about somebody's bill is a lie. The same rule is what stops three
 * cards in a row from reading as a pricing table, which is the failure mode
 * the brief guards against. No price is exported from this file, on purpose.
 *
 * Hourly and custom are deliberately NOT rungs. Hourly is a way of working
 * rather than a step up or down, and a client whose plan was written for them
 * should not be shown a row of standard steps they are not standing on:
 * `ladder()` answers null for both, and the component renders nothing.
 *
 * Pure: no React, no db, no fetch. Runs in the browser and is unit tested in
 * lib/plan-ladder.test.ts.
 */

/** The four plans that form a ladder, lowest first. */
export const LADDER_ORDER = ['tune', 'maintain', 'scale', 'launch'] as const

export type LadderPlanKey = (typeof LADDER_ORDER)[number]

/** Studio written copy for one rung. Never a number, never a price. */
export interface RungCopy {
  name: string
  bestIf: string
  tracks: string
  turnaround: string
  services: string
}

/**
 * The rung copy, reviewed by Liam 2026-09-06 (.claude/qa/svc_data_block.txt).
 * That review flagged its own Tune and Launch entries as the biggest thing to
 * land before this ports: db/schema.ts settles it. `subscriptions.planType`
 * (the only table with a `tracks` row) is maintain or scale only. Tune and
 * Launch are `projects.type` values, the same one-off table Hourly and
 * Custom live in: a single scoped engagement with a price, a start date and
 * an expected delivery, never a track. Tune and Launch still stand as rungs
 * (that is Liam's call, not this file's to revisit), but their tracks and
 * services copy now says so rather than borrowing Maintain and Scale's
 * capacity language.
 *
 * This belongs beside `feats[]` in the `plan_catalog` settings key, edited in
 * Settings > Client plans. It lives here until those columns exist, and
 * `ladder()` already takes name overrides so a plan renamed in settings
 * renames on the ladder today.
 */
export const RUNGS: Readonly<Record<LadderPlanKey, RungCopy>> = {
  tune: {
    name: 'Tune',
    bestIf: 'Best if the site mostly does its job and you want someone to keep it tidy a few times a year.',
    tracks: 'Not an open ended slot: each Tune is its own booked project, scoped and delivered on its own rather than kept running.',
    turnaround: 'You book a window. Between windows, nothing of yours is running.',
    services: 'Fixes, small changes, and a check that nothing has quietly broken.',
  },
  maintain: {
    name: 'Maintain',
    bestIf: 'Best if there is usually one thing on your list, and you would rather it was always moving than finished in a hurry.',
    tracks: 'One track, always moving.',
    turnaround: 'A second request waits for the first one to be delivered.',
    services: 'Your queue, your revisions, and a monthly read on the site.',
  },
  scale: {
    name: 'Scale',
    bestIf: 'Best if you always have a next thing, and you want it started before you have to ask.',
    tracks: 'Two tracks, a large and a small, building at the same time.',
    turnaround: 'When one is delivered, the next in your queue pulls in on its own.',
    services: 'Everything in Maintain, three rounds of revisions, and season work alongside the day to day.',
  },
  launch: {
    name: 'Launch',
    bestIf: 'Best if you are putting something new into the world on a date, and the season is riding on it.',
    tracks: 'Not an open ended slot either: Launch is a single scoped build, planned to your date rather than kept running.',
    turnaround: 'Work is planned back from your launch date instead of pulled off a queue.',
    services: 'A written schedule with the date on it, a team held against it, and a support window once it ships.',
  },
}

export interface Rung extends RungCopy {
  key: LadderPlanKey
}

/** Down, here, up. A missing neighbour is null, never a filler rung. */
export interface LadderView {
  down: Rung | null
  here: Rung
  up: Rung | null
}

/** Plan id to display name, as the studio renamed it in Settings > Client plans. */
export type PlanNameOverrides = Readonly<Record<string, string>>

function isLadderPlanKey(value: unknown): value is LadderPlanKey {
  return typeof value === 'string' && (LADDER_ORDER as readonly string[]).includes(value)
}

function rungAt(index: number, names?: PlanNameOverrides): Rung | null {
  const key = LADDER_ORDER[index]
  if (!key) return null
  const copy = RUNGS[key]
  const override = names?.[key]?.trim()
  return { key, ...copy, name: override && override.length > 0 ? override : copy.name }
}

/**
 * The three rungs around the client's own plan, or null when there is no
 * ladder to stand on (no plan, hourly, custom, or an id nobody has heard of).
 *
 * A Tune client sees two rungs and a Launch client sees two, because neither
 * should be shown a step that does not exist.
 */
export function ladder(
  planKey: string | null | undefined,
  names?: PlanNameOverrides,
): LadderView | null {
  if (!isLadderPlanKey(planKey)) return null
  const index = LADDER_ORDER.indexOf(planKey)
  const here = rungAt(index, names)
  if (!here) return null
  return { down: rungAt(index - 1, names), here, up: rungAt(index + 1, names) }
}

/** The display names every ladder plan carries, lowest rung first. */
export function ladderPlanNames(names?: PlanNameOverrides): string[] {
  return LADDER_ORDER.map((_, i) => rungAt(i, names)?.name ?? '').filter(n => n.length > 0)
}

/**
 * Is this catalogue row one of the rungs actually drawn on THIS client's own
 * ladder, rather than any plan the studio happens to sell?
 *
 * The studio's Maintain and Scale rows (and, for whoever is standing next to
 * them, Tune or Launch) live in the `services` table so they can carry copy,
 * which means the client catalogue would otherwise print them twice: once as
 * a rung and once as a card. Only the plans this client's own `view` actually
 * renders as down/here/up are dropped. Checking a card against all four
 * ladder names unconditionally would strip a Maintain client's real one-off
 * Launch service card too, even though Launch never rendered as one of their
 * three rungs. Passing the view fixes that: Launch stays a card for everyone
 * except the client standing on it.
 */
export function isLadderPlanName(name: string | null | undefined, view: LadderView | null): boolean {
  const candidate = (name ?? '').trim().toLowerCase()
  if (!candidate || !view) return false
  return [view.down, view.here, view.up].some(
    rung => rung !== null && rung.name.toLowerCase() === candidate,
  )
}

// ── The client's own figures ─────────────────────────────────────────────────

/** The two facts the portal can actually source for the rung they stand on. */
export interface LiveFacts {
  /** Track entitlement from /api/portal/subscription, not a row count. */
  trackCount?: number | null
  /** Average delivered turnaround over their own work (lib/track-stats.ts). */
  avgTurnaroundDays?: number | null
}

/**
 * The live overrides for the rung the client is standing on.
 *
 * A null field means the portal has no figure, so the rung keeps its studio
 * written sentence rather than printing a blank or a guess. There is no
 * `services` override because nothing measures what is included: that row is
 * always the rung's own words.
 */
export interface RungLive {
  tracks: string | null
  turnaround: string | null
}

export function rungLive(facts: LiveFacts): RungLive {
  const tracks = typeof facts.trackCount === 'number' && facts.trackCount > 0
    ? (facts.trackCount === 1
      ? 'One track, building at a time.'
      : `${facts.trackCount} tracks, building at the same time.`)
    : null
  const days = facts.avgTurnaroundDays
  const turnaround = typeof days === 'number' && Number.isFinite(days) && days > 0
    ? `${days} ${days === 1 ? 'day' : 'days'} from asked to delivered, averaged over your own work.`
    : null
  return { tracks, turnaround }
}

// ── Are they up against the edge of the plan? ────────────────────────────────

/**
 * The upsell affordance is a consequence, not a fixture. It appears only when
 * the client's own usage says the plan is full, and it goes away again when it
 * is not.
 *
 *   queue   the queue is LONGER than the number of things that can build at
 *           once, so some of it keeps waiting even when every track frees up.
 *           A queue exactly at the track count is not pressure: everything in
 *           it already has somewhere to go. The edge starts one past that.
 *           Sourced today from /api/portal/capacity.
 *   tracks  the tracks were occupied for most of the month's available track
 *           days. There is no nightly roll up writing lane days yet, so the
 *           Services page passes no lanes and this never fires there. It is
 *           kept because the signal is defined and tested, and the day the
 *           roll up lands the only change is the caller.
 *   hours   only an hourly plan has a cap to be near. A retainer client has no
 *           hours figure on this page on purpose, so this returns nothing for
 *           them rather than inventing a denominator.
 */
export const PRESSURE_AT = { busy: 0.85, hours: 0.85 } as const

export interface PressureLane {
  /** Track days this lane was worked on. */
  days: number
  /** Track days the studio had available on it. */
  studioDays: number
}

export interface PressureInput {
  /** Track entitlement. No entitlement means no queue signal to measure. */
  trackCount?: number | null
  /** Everything open and client visible: what is on a track plus what waits. */
  openCount?: number | null
  /** Track day usage. Omitted by the portal: nothing writes it yet. */
  lanes?: readonly PressureLane[] | null
  /** "September", printed inside the tracks signal. */
  monthLabel?: string | null
  hoursCap?: number | null
  hoursUsed?: number | null
}

export type PressureKey = 'queue' | 'tracks' | 'hours'

export interface PressureSignal {
  key: PressureKey
  /** One sentence, and every number in it has already been printed elsewhere. */
  body: string
}

export function planPressure(input: PressureInput): PressureSignal[] {
  const out: PressureSignal[] = []

  const tracks = typeof input.trackCount === 'number' ? input.trackCount : 0
  const open = typeof input.openCount === 'number' ? input.openCount : 0
  if (tracks > 0 && open > tracks) {
    const overflow = open - tracks
    const trackWord = tracks === 1 ? 'one track' : `${tracks} tracks`
    const tail = overflow === 1 ? 'one keeps waiting' : `${overflow} keep waiting`
    out.push({
      key: 'queue',
      body: `There are ${open} things waiting and ${trackWord} to pull them onto. Even when every track frees up, ${tail}.`,
    })
  }

  const lanes = input.lanes ?? []
  const monthLabel = (input.monthLabel ?? '').trim()
  if (lanes.length > 0 && monthLabel) {
    const used = lanes.reduce((n, lane) => n + (lane.days || 0), 0)
    const avail = lanes.reduce((n, lane) => n + (lane.studioDays || 0), 0)
    if (avail > 0 && used / avail >= PRESSURE_AT.busy) {
      out.push({
        key: 'tracks',
        body: `Your tracks were worked on ${used} of the ${avail} track days available so far in ${monthLabel}. That is the plan doing its job, and it is also the point where a third thing has nowhere to go.`,
      })
    }
  }

  const cap = input.hoursCap
  const usedHours = input.hoursUsed
  if (typeof cap === 'number' && cap > 0 && typeof usedHours === 'number' && usedHours / cap >= PRESSURE_AT.hours) {
    out.push({
      key: 'hours',
      body: `${usedHours} of the ${cap} hours on this month are used, and there are still working days left in it.`,
    })
  }

  return out
}
