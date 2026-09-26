/**
 * lib/slack/dispatch-actions.ts
 *
 * What happens when somebody presses a button on a suggestion card in a DM
 * (CN.2 contract section 3, and CN.3 section 6 for who that somebody may be).
 *
 * The button is the whole authorisation. Nothing here decides anything
 * itself: it reads who pressed, checks that person against the ROW, and hands
 * the same decideSuggestion the dashboard calls the same decision with via
 * 'slack'. One gate, one apply, one audit entry, whichever surface the human
 * was looking at.
 *
 * Who may press is decided per row, not per level. A call's suggestion is the
 * founders' to decide; a note somebody sent the bot is theirs (and any
 * founder's, because the dashboard lets any admin decide any row and Slack
 * stays in step); a client's "Is this the request?" card is that client's
 * alone. CN.2 checked the level only, so a member pressing Approve on their
 * own note, and a client confirming their own request, both got the refusal.
 *
 * Every answer is either a rewritten message or one plain sentence. A refusal
 * says nothing about what exists, because the person asking is not allowed to
 * know (contract section 1). That includes a row that is not there: a studio
 * person is told it is gone, anybody else gets the same refusal as for a row
 * that is somebody else's.
 *
 * Registered with the interactive route through the S1 hook in
 * lib/slack/action-registry.ts, by prefix, so the route never learns the
 * verbs: importing this module is enough to claim `sugg:*`, and the Monday
 * digest's `digest:*` url button with it.
 */

import {
  registerBlockActionHandler,
  type SlackBlockActionContext,
  type SlackBlockActionResult,
} from '@/lib/slack/action-registry'
import {
  DIGEST_ACTION_PREFIX,
  SUGGESTION_ACTION_PREFIX,
  parseSuggestionActionId,
  type SuggestionActionName,
} from '@/lib/slack/blocks'
import { findSlackIdentity, isStudioLevel, SLACK_DENIED_LINE, type SlackIdentity } from '@/lib/slack/identity'
import {
  mirrorSuggestionDecision,
  recordSuggestionMessage,
  rewriteSuggestionMessage,
  type DecidedSuggestionRow,
} from '@/lib/slack/mirror'
import {
  CONTACT_REQUIRED,
  POSSIBLE_DUPLICATE,
  decideSuggestion,
  loadDecoratedSuggestion,
  loadSuggestion,
  snoozePreset,
  type AttachTarget,
  type DecisionInput,
} from '@/lib/task-suggestions'

/** The lines the bot says back. Plain sentences, no jargon, no dashes. */
export const DISPATCH_LINES = {
  unknownActor: 'I could not tell which team member you are, so nothing changed.',
  gone: 'That suggestion is not there any more.',
  alreadyDecided: 'That one was already decided.',
  contactRequired: 'Pick who it is waiting on first, on Tweak.',
  attachUnreadable: 'I could not tell what to attach that to.',
} as const

/**
 * Whether this person may press a decision button on this row (CN.3 contract
 * section 6).
 *
 *   founders  a founder
 *   member    that member (a founder's own note counts too), or any founder
 *   contact   that contact, at the row's own client, and nobody else
 *
 * Anything else, including an approver type this code has never heard of and
 * a person the app has never resolved, is false: deny by default.
 */
export function canDecideSuggestion(
  identity: Pick<SlackIdentity, 'level' | 'teamMemberId' | 'contactId' | 'orgId'> | null,
  row: { approverType: string; approverId: string | null; orgId: string | null },
): boolean {
  if (!identity) return false
  switch (row.approverType) {
    case 'founders':
      return identity.level === 'founder'
    case 'member':
      if (identity.level === 'founder') return true
      return identity.level === 'member'
        && !!identity.teamMemberId
        && identity.teamMemberId === row.approverId
    case 'contact':
      return identity.level === 'client'
        && !!identity.contactId
        && identity.contactId === row.approverId
        && !!identity.orgId
        && identity.orgId === row.orgId
    default:
      return false
  }
}

/** The button's `value`, which only the attach button carries. */
function parseAttachTarget(value: string | null): AttachTarget | null {
  if (!value) return null
  try {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object') return null
    const kind = (parsed as { kind?: unknown }).kind
    const id = (parsed as { id?: unknown }).id
    if ((kind !== 'request' && kind !== 'task') || typeof id !== 'string' || !id) return null
    return { kind, id }
  } catch {
    return null
  }
}

/** The decision one button stands for, or null when the button decides
 *  nothing (Tweak) or carries an unusable target. */
function decisionFor(action: SuggestionActionName, value: string | null): DecisionInput | null {
  switch (action) {
    case 'approve':
      return { action: 'approve' }
    case 'approve_anyway':
      // The human looked at the duplicate line and wants it anyway, which is
      // exactly what force means on the gate (CN.1d section 3).
      return { action: 'approve', force: true }
    case 'reject':
      return { action: 'reject' }
    case 'snooze_tonight':
      return { action: 'snooze', until: snoozePreset('tonight') }
    case 'snooze_week':
      return { action: 'snooze', until: snoozePreset('this_week') }
    case 'attach': {
      const target = parseAttachTarget(value)
      return target ? { action: 'attach', target } : null
    }
    case 'tweak':
      return null
  }
}

/**
 * A client's press, as the decision the gate is sent.
 *
 * Approve goes with force: the client's DM IS the request (CN.2 section 4),
 * the studio triages duplicates on its own side, and the duplicate answer
 * must never reach a client because its match list names the studio's
 * internal task titles. The two buttons that only exist on the duplicate
 * answer, attach and approve anyway, are therefore never a client's to
 * press, and answer null here, which the caller turns into the refusal.
 */
function clientDecisionFor(action: SuggestionActionName, value: string | null): DecisionInput | null {
  if (action === 'attach' || action === 'approve_anyway') return null
  if (action === 'approve') return { action: 'approve', force: true }
  return decisionFor(action, value)
}

function answer(reply: string | null): SlackBlockActionResult {
  return { handled: true, reply }
}

/**
 * One press of one button on one suggestion.
 *
 * Returns `handled: false` for an action id this module does not own, so the
 * route can try the next handler rather than apologising for a button it
 * knows nothing about.
 */
export async function handleSuggestionAction(ctx: SlackBlockActionContext): Promise<SlackBlockActionResult> {
  const parsed = parseSuggestionActionId(ctx.payload.actionId)
  if (!parsed) return { handled: false, reply: null }

  // Tweak is a url button. Slack still sends the interaction, and the honest
  // response is nothing at all: the dashboard is already opening.
  if (parsed.action === 'tweak') return answer(null)

  const identity: SlackIdentity | null = ctx.identity
    ?? await findSlackIdentity(ctx.drizzle, { teamId: ctx.payload.slackTeamId, userId: ctx.payload.slackUserId })

  if (!identity || identity.level === 'unknown') return answer(SLACK_DENIED_LINE)
  const studio = isStudioLevel(identity.level)
  const client = identity.level === 'client'

  // The row decides who may press, so it is read before anything else is
  // said. A row that is not there reads as gone to the studio and as the
  // plain refusal to anybody else: whether a suggestion exists is itself
  // something a client is not told.
  const row = await loadSuggestion(ctx.drizzle, parsed.suggestionId)
  if (!row) return answer(studio ? DISPATCH_LINES.gone : SLACK_DENIED_LINE)
  if (!canDecideSuggestion(identity, row)) return answer(SLACK_DENIED_LINE)

  // A studio person the studio cannot name is a decision that cannot be
  // audited, so it is not made. This is a setup problem, not a refusal, and
  // it reads as one. A client is recorded by their contact id; canDecide
  // already required one, so a missing id here is only ever a refusal.
  const actorId = client ? identity.contactId : identity.teamMemberId
  if (!actorId) return answer(client ? SLACK_DENIED_LINE : DISPATCH_LINES.unknownActor)

  // A client's attach or approve anyway comes back null from
  // clientDecisionFor and is refused here, before anything is recorded.
  const decision = client
    ? clientDecisionFor(parsed.action, ctx.payload.value)
    : decisionFor(parsed.action, ctx.payload.value)
  if (!decision) return answer(client ? SLACK_DENIED_LINE : DISPATCH_LINES.attachUnreadable)

  // File the clicked message as a copy before deciding. The sweep records
  // every copy it posts, but a message the bot posted before the table
  // existed, or one whose record failed, would otherwise keep its buttons
  // after the decision. INSERT OR IGNORE, so this costs nothing when the copy
  // is already known.
  if (ctx.payload.channelId && ctx.payload.messageTs) {
    await recordSuggestionMessage(ctx.drizzle, {
      suggestionId: parsed.suggestionId,
      channelId: ctx.payload.channelId,
      ts: ctx.payload.messageTs,
    })
  }

  const result = await decideSuggestion(ctx.drizzle, parsed.suggestionId, decision, { actorId, via: 'slack' })
  if (!result) return answer(studio ? DISPATCH_LINES.gone : SLACK_DENIED_LINE)

  // The gate refused a create because the client already has the thing. The
  // same message becomes the duplicate answer: "Looks like #226 Design
  // directions", with Use #226 instead beside Approve anyway (contract
  // section 3). Nothing was decided, so nothing is struck through. A client
  // never reaches this: their approve carries force.
  if (result.error === POSSIBLE_DUPLICATE) {
    await rerender(ctx, parsed.suggestionId, true)
    return answer(null)
  }

  if (result.error === CONTACT_REQUIRED) return answer(DISPATCH_LINES.contactRequired)

  // An attach rewrites what the row proposes and leaves it pending: the human
  // still presses the button, so the message keeps its buttons and shows what
  // it now proposes.
  if (parsed.action === 'attach') {
    await rerender(ctx, parsed.suggestionId, false)
    return answer(null)
  }

  // Either the decision just landed, or somebody else landed it first. Both
  // end the same way: every copy of this message loses its buttons and says
  // who decided and when. The second click differs only in that it is worth
  // telling the person their press did nothing.
  await tidy(ctx, result.suggestion)
  return answer(result.changed ? null : DISPATCH_LINES.alreadyDecided)
}

/** Re-render every copy from the row as it now stands. Never fatal: a
 *  message that cannot be rewritten is a stale button, and the gate refuses
 *  the second press anyway. */
async function rerender(ctx: SlackBlockActionContext, suggestionId: string, duplicate: boolean): Promise<void> {
  try {
    const row = await loadDecoratedSuggestion(ctx.drizzle, suggestionId)
    if (!row) return
    await rewriteSuggestionMessage(ctx.drizzle, row, { duplicate })
  } catch {
    // Slack is never the reason a decision is reported as having failed.
  }
}

async function tidy(ctx: SlackBlockActionContext, row: DecidedSuggestionRow): Promise<void> {
  try {
    await mirrorSuggestionDecision(ctx.drizzle, row)
  } catch {
    // Same rule: the row is decided in the database, which is the fact that
    // matters. A message still offering Approve is cosmetic.
  }
}

/**
 * The Monday digest's "Open the inbox" button. A url button: Slack has
 * already opened the dashboard by the time this runs, so the right answer is
 * nothing, to anybody. Claiming the prefix is what stops the dispatcher
 * answering "not switched on yet" under a digest that worked.
 */
export async function handleDigestAction(ctx: SlackBlockActionContext): Promise<SlackBlockActionResult> {
  if (!ctx.payload.actionId.startsWith(`${DIGEST_ACTION_PREFIX}:`)) return { handled: false, reply: null }
  return answer(null)
}

/** Claim every `sugg:*` action id on the interactive route's registry, and the
 *  digest's `digest:*` button beside them. */
export function registerSuggestionActions(): void {
  registerBlockActionHandler(SUGGESTION_ACTION_PREFIX, handleSuggestionAction)
  registerBlockActionHandler(DIGEST_ACTION_PREFIX, handleDigestAction)
}

// Importing this module is the registration: S1's route imports it once and
// never learns the verbs. Idempotent, because the registry is keyed by prefix.
registerSuggestionActions()
