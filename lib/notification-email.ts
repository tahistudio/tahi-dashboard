/**
 * lib/notification-email.ts
 *
 * The email sibling of lib/notifications.ts.
 *
 * The bell and the inbox are the same event told twice, so they are built the
 * same way: a call site names typed recipients once, the bell path resolves
 * them to Clerk user ids and inserts rows, and this module resolves the very
 * same recipients to addresses and sends. `createNotifications` takes an
 * optional `email` plan for exactly that reason, so a call site can never
 * update one channel and forget the other.
 *
 * Two differences from the bell, both deliberate:
 *
 *   1. A person with no Clerk login still gets email. The bell can only key on
 *      a Clerk user id, so an invited-but-never-signed-in contact is invisible
 *      to it. Their email address exists from the moment the contact row does,
 *      and email is the only way to reach them, which is exactly the audience
 *      a studio replying to a new client is talking to.
 *   2. The channel preference read is per person, per event, per channel
 *      (lib/notification-preferences), on the 'email' channel, resolved for the
 *      whole audience in ONE query the way the bell path does it. Someone with
 *      no Clerk id has no preference row and no way to have written one, so the
 *      channel default applies (email on).
 *
 * Sending happens OFF the response path. One Resend call per recipient, awaited
 * inline, meant an admin marking thirty requests delivered sat through a
 * hundred sequential round trips before their fetch resolved, so the fan-out is
 * handed to `ctx.waitUntil` exactly as lib/events.ts does with the webhook
 * fan-out. Where there is no Cloudflare context (vitest, plain node) it is
 * awaited instead, so tests stay deterministic.
 *
 * Failure is a logged warning, never an exception: a Resend outage must not
 * fail the client's submit or the studio's reply. Everything here returns a
 * count and swallows its own errors. A rate limited send (Resend allows two a
 * second by default) is retried with backoff rather than counted as lost.
 */

import { createElement, type ReactElement } from 'react'
import { and, eq, inArray } from 'drizzle-orm'
import { schema } from '@/db/d1'
import { sendEmail } from '@/lib/email'
import { DEFAULT_ENABLED } from '@/lib/notification-preferences'
import { appOrigin } from '@/lib/app-url'
import {
  notificationHref,
  type NotificationAudience,
  type NotificationEventType,
} from '@/lib/notification-links'
import type { NotificationRecipient, NotificationUserType } from '@/lib/notifications'
import NewRequestEmail from '@/emails/new-request'
import RequestDeliveredEmail from '@/emails/request-delivered'
import RequestClientReviewEmail from '@/emails/request-client-review'
import NewMessageEmail from '@/emails/new-message'

type DrizzleDB = ReturnType<typeof import('drizzle-orm/d1').drizzle>

/**
 * Who an email is written for. Mirrors NotificationAudience, named in the
 * studio's own words: 'team' is the bell's route-map audience, 'studio' is the
 * voice a client-facing template writes against.
 */
export type EmailAudience = 'client' | 'studio'

function routeAudience(audience: EmailAudience): NotificationAudience {
  return audience === 'client' ? 'client' : 'team'
}

/** A person we can actually put an email in front of. */
export interface EmailTarget {
  email: string
  name: string | null
  userType: NotificationUserType
  /** Null for someone who has been invited but never signed in. */
  clerkUserId: string | null
}

/** The teamMembers / contacts columns an email needs, and nothing else. */
export interface PersonRow {
  name?: string | null
  email?: string | null
  clerkUserId?: string | null
}

/**
 * One event, rendered per recipient. The subject is shared (it names the
 * request, not the person); the body may greet the recipient by name.
 */
export interface NotificationEmailPlan {
  subject: string
  render: (target: EmailTarget) => ReactElement
}

export interface EmailDispatchResult {
  /** Addresses Resend accepted. */
  sent: number
  /** Recipients dropped by their own email preference. */
  muted: number
  /** Addresses Resend refused, or that threw, after retries. */
  failed: number
  /**
   * True when the send was handed to `ctx.waitUntil` and the counts above are
   * therefore not yet known. The caller has already returned by the time the
   * last address is attempted, which is the point.
   */
  deferred: boolean
}

const NO_DISPATCH: EmailDispatchResult = { sent: 0, muted: 0, failed: 0, deferred: false }
const DEFERRED: EmailDispatchResult = { sent: 0, muted: 0, failed: 0, deferred: true }

// ─── Pure helpers ────────────────────────────────────────────────────────────

/**
 * Is this string worth handing to Resend? Deliberately strict about the
 * shapes that show up in a migrated contacts table (empty strings, a name
 * pasted into the email column, two addresses in one field) and deliberately
 * uninterested in full RFC validity, which no regex wins.
 */
export function isSendableEmail(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  const trimmed = value.trim()
  if (trimmed.length < 6) return false
  if (/\s/.test(trimmed)) return false
  const at = trimmed.indexOf('@')
  if (at < 1) return false
  if (trimmed.indexOf('@', at + 1) !== -1) return false
  const domain = trimmed.slice(at + 1)
  if (domain.length < 3) return false
  if (domain.startsWith('.') || domain.endsWith('.')) return false
  return domain.includes('.')
}

/**
 * Turn rows straight out of teamMembers / contacts into targets: unsendable
 * addresses dropped, addresses deduped case-insensitively (one person, one
 * email, however many rows reach them).
 */
export function toEmailTargets(
  rows: readonly PersonRow[],
  userType: NotificationUserType,
): EmailTarget[] {
  const out: EmailTarget[] = []
  for (const row of rows) {
    if (!isSendableEmail(row.email)) continue
    out.push({
      email: (row.email as string).trim(),
      name: row.name?.trim() ? row.name.trim() : null,
      userType,
      clerkUserId: row.clerkUserId ?? null,
    })
  }
  return dedupeEmailTargets(out)
}

/**
 * Collapse a mixed target list to one entry per address. The first entry wins,
 * so a caller listing the specific person before the studio-wide fallback keeps
 * the specific name.
 */
export function dedupeEmailTargets(targets: readonly EmailTarget[]): EmailTarget[] {
  const seen = new Set<string>()
  const out: EmailTarget[] = []
  for (const t of targets) {
    const key = t.email.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out
}

/**
 * The subject prefix every request email carries, so a reply thread in Gmail
 * groups by request and a human can scan an inbox by number.
 *
 * The number is the PER-ORG request number (requests.request_number), which is
 * the only number a client has ever been shown. A row filed before numbering
 * landed has none, and gets the bare subject rather than "[REQ-null]".
 */
export function requestEmailSubject(
  requestNumber: number | null | undefined,
  subject: string,
): string {
  const n =
    typeof requestNumber === 'number' && Number.isFinite(requestNumber) && requestNumber > 0
      ? Math.trunc(requestNumber)
      : null
  return n === null ? subject : `[REQ-${n}] ${subject}`
}

const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/g, ' '],
  [/&amp;/g, '&'],
  [/&lt;/g, '<'],
  [/&gt;/g, '>'],
  [/&quot;/g, '"'],
  [/&#0?39;/g, "'"],
  [/&apos;/g, "'"],
]

/**
 * Rich text from the composer is HTML. An email quote and a bell body are both
 * plain text, so strip to text here rather than shipping tag soup into either.
 * Block boundaries become newlines so a two paragraph reply still reads as two
 * paragraphs.
 */
export function toPlainText(html: string | null | undefined): string {
  if (!html) return ''
  let text = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]*>/g, '')
  for (const [pattern, replacement] of ENTITIES) text = text.replace(pattern, replacement)
  return text
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Cut to a character budget on a word boundary where one is close enough. */
export function truncate(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  if (text.length <= maxChars) return text
  const hard = text.slice(0, maxChars)
  const lastSpace = hard.lastIndexOf(' ')
  const body = lastSpace > maxChars * 0.6 ? hard.slice(0, lastSpace) : hard
  return `${body.trimEnd()}...`
}

/** A one line version of a message, for a notification title or body. */
export function messageSummary(html: string | null | undefined, maxChars = 200): string {
  return truncate(toPlainText(html).replace(/\s+/g, ' '), maxChars)
}

/** The greeting name, with a fallback that never renders an empty sentence. */
export function greetingName(name: string | null | undefined, fallback: string): string {
  const trimmed = name?.trim()
  if (!trimmed) return fallback
  const first = trimmed.split(/\s+/)[0]
  return first || fallback
}

/**
 * The absolute URL for an entity, for the audience clicking it. Built from the
 * same resolver the bell uses, so an email CTA and a bell click can never point
 * at different pages.
 */
export function notificationEmailUrl(
  entityId: string,
  audience: NotificationAudience,
): string {
  return `${appOrigin()}${notificationHref('request', entityId, audience) ?? '/requests'}`
}

// ─── Recipient resolution ────────────────────────────────────────────────────

/**
 * Resolve the same typed recipients the bell takes into addresses.
 *
 * Batched: at most one query per (table, key) pair actually used. Unlike the
 * bell path, a missing Clerk login is not a reason to drop anyone.
 */
export async function resolveEmailTargets(
  database: DrizzleDB,
  recipients: readonly NotificationRecipient[],
): Promise<EmailTarget[]> {
  if (recipients.length === 0) return []

  const teamMemberIds = new Set<string>()
  const contactIds = new Set<string>()
  const teamClerkIds = new Set<string>()
  const contactClerkIds = new Set<string>()

  for (const r of recipients) {
    if ('clerkUserId' in r) {
      if (r.userType === 'team_member') teamClerkIds.add(r.clerkUserId)
      else contactClerkIds.add(r.clerkUserId)
    } else if ('teamMemberId' in r) teamMemberIds.add(r.teamMemberId)
    else if ('contactId' in r) contactIds.add(r.contactId)
    else if ('ownerSettingValue' in r) {
      if (r.ownerSettingValue.startsWith('user_')) teamClerkIds.add(r.ownerSettingValue)
      else teamMemberIds.add(r.ownerSettingValue)
    } else if (r.participantType === 'team_member') teamMemberIds.add(r.participantId)
    else contactIds.add(r.participantId)
  }

  const teamColumns = {
    name: schema.teamMembers.name,
    email: schema.teamMembers.email,
    clerkUserId: schema.teamMembers.clerkUserId,
  }
  const contactColumns = {
    name: schema.contacts.name,
    email: schema.contacts.email,
    clerkUserId: schema.contacts.clerkUserId,
  }

  try {
    const [byTeamId, byContactId, byTeamClerk, byContactClerk] = await Promise.all([
      teamMemberIds.size > 0
        ? database.select(teamColumns).from(schema.teamMembers)
            .where(inArray(schema.teamMembers.id, [...teamMemberIds]))
        : Promise.resolve([] as PersonRow[]),
      contactIds.size > 0
        ? database.select(contactColumns).from(schema.contacts)
            .where(inArray(schema.contacts.id, [...contactIds]))
        : Promise.resolve([] as PersonRow[]),
      teamClerkIds.size > 0
        ? database.select(teamColumns).from(schema.teamMembers)
            .where(inArray(schema.teamMembers.clerkUserId, [...teamClerkIds]))
        : Promise.resolve([] as PersonRow[]),
      contactClerkIds.size > 0
        ? database.select(contactColumns).from(schema.contacts)
            .where(inArray(schema.contacts.clerkUserId, [...contactClerkIds]))
        : Promise.resolve([] as PersonRow[]),
    ])

    return dedupeEmailTargets([
      ...toEmailTargets(byTeamId, 'team_member'),
      ...toEmailTargets(byTeamClerk, 'team_member'),
      ...toEmailTargets(byContactId, 'contact'),
      ...toEmailTargets(byContactClerk, 'contact'),
    ])
  } catch (err) {
    console.warn('[notification-email] failed to resolve recipients:', err)
    return []
  }
}

/**
 * Every Tahi team member as a target. The studio-wide fallback for an event
 * that has nobody specific to reach yet, which is exactly when a client's
 * first message arrives.
 */
export async function allStudioEmailTargets(database: DrizzleDB): Promise<EmailTarget[]> {
  try {
    const rows = await database
      .select({
        name: schema.teamMembers.name,
        email: schema.teamMembers.email,
        clerkUserId: schema.teamMembers.clerkUserId,
      })
      .from(schema.teamMembers)
    return toEmailTargets(rows, 'team_member')
  } catch (err) {
    console.warn('[notification-email] failed to load the studio:', err)
    return []
  }
}

/** What a request email needs about the request that its call site has not read. */
export interface RequestEmailContext {
  /** The per-org number, for the subject prefix. */
  requestNumber: number | null
  /** The client company, for the "Client" line of a client-facing template. */
  orgName: string | null
}

const NO_REQUEST_CONTEXT: RequestEmailContext = { requestNumber: null, orgName: null }

/**
 * The per-org request number and the owning company name, in one read.
 *
 * Both are cosmetic: returns nulls rather than throwing, so a lookup failure
 * costs the subject prefix and a detail row, never the email.
 */
export async function loadRequestEmailContext(
  database: DrizzleDB,
  requestId: string,
): Promise<RequestEmailContext> {
  try {
    const [row] = await database
      .select({
        requestNumber: schema.requests.requestNumber,
        orgName: schema.organisations.name,
      })
      .from(schema.requests)
      .leftJoin(schema.organisations, eq(schema.organisations.id, schema.requests.orgId))
      .where(eq(schema.requests.id, requestId))
      .limit(1)
    return {
      requestNumber: typeof row?.requestNumber === 'number' ? row.requestNumber : null,
      orgName: typeof row?.orgName === 'string' && row.orgName.trim() ? row.orgName.trim() : null,
    }
  } catch {
    return NO_REQUEST_CONTEXT
  }
}

// ─── Preferences, for the whole audience at once ─────────────────────────────

interface PrefRow {
  userId: string
  userType: string
  eventType: string
  channel: string
  enabled: boolean
}

/**
 * The email half of lib/notification-preferences resolveFromRows: exact row,
 * then the per-user `'*'` default, then the hardcoded channel policy.
 *
 * Duplicated here only because the resolver in that module is private and that
 * module was not in this change's scope. Move this and filterTargetsByEmailPref
 * below into lib/notification-preferences next to filterRecipientsByInAppPref
 * when that file next opens, so one resolver serves both channels.
 */
function emailPrefEnabled(
  rows: readonly PrefRow[],
  target: EmailTarget,
  eventType: NotificationEventType,
): boolean {
  const clerkUserId = target.clerkUserId
  if (!clerkUserId) return DEFAULT_ENABLED.email
  const mine = rows.filter((r) => r.userId === clerkUserId && r.userType === target.userType)
  const exact = mine.find((r) => r.eventType === eventType)
  if (exact) return exact.enabled
  const wildcard = mine.find((r) => r.eventType === '*')
  if (wildcard) return wildcard.enabled
  return DEFAULT_ENABLED.email
}

/**
 * Drop everyone who muted this event's email channel, in ONE query for the
 * whole audience. The per-recipient read this replaces cost an org-wide fan-out
 * N serialised SELECTs on top of N sends; the bell path has resolved the same
 * thing in a single batched query since it was written.
 *
 * Fails open (returns everyone) exactly as filterRecipientsByInAppPref does:
 * better a stray email than a silently swallowed delivery notice.
 */
export async function filterTargetsByEmailPref(
  database: DrizzleDB,
  targets: readonly EmailTarget[],
  eventType: NotificationEventType,
): Promise<{ allowed: EmailTarget[]; muted: number }> {
  const withLogin = targets.filter((t) => t.clerkUserId)
  // Nobody here can have written a preference row, so nobody can have muted.
  if (withLogin.length === 0) return { allowed: [...targets], muted: 0 }

  try {
    const userIds = [...new Set(withLogin.map((t) => t.clerkUserId as string))]
    const rows = await database
      .select({
        userId: schema.notificationPreferences.userId,
        userType: schema.notificationPreferences.userType,
        eventType: schema.notificationPreferences.eventType,
        channel: schema.notificationPreferences.channel,
        enabled: schema.notificationPreferences.enabled,
      })
      .from(schema.notificationPreferences)
      .where(
        and(
          eq(schema.notificationPreferences.channel, 'email'),
          inArray(schema.notificationPreferences.userId, userIds),
          inArray(schema.notificationPreferences.eventType, [eventType, '*']),
        ),
      )
    if (rows.length === 0) return { allowed: [...targets], muted: 0 }
    const allowed = targets.filter((t) => emailPrefEnabled(rows, t, eventType))
    return { allowed, muted: targets.length - allowed.length }
  } catch {
    return { allowed: [...targets], muted: 0 }
  }
}

// ─── Dispatch ────────────────────────────────────────────────────────────────

/** Resend allows two requests a second by default, so a fan-out will hit it. */
const RATE_LIMIT_RETRIES = 2
const RATE_LIMIT_BACKOFF_MS = [600, 1500] as const

function isRateLimited(error: string | undefined): boolean {
  if (!error) return false
  return /rate.?limit|too many requests|\b429\b/i.test(error)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * One address, with a retry on the one failure that is worth retrying. Every
 * other refusal (bad address, unverified domain) is permanent and retrying it
 * just spends the next recipient's budget.
 */
async function sendWithBackoff(
  target: EmailTarget,
  plan: NotificationEmailPlan,
): Promise<{ success: boolean; error?: string }> {
  let last = await sendEmail(target.email, plan.subject, plan.render(target))
  for (let attempt = 0; attempt < RATE_LIMIT_RETRIES; attempt += 1) {
    if (last.success || !isRateLimited(last.error)) return last
    await sleep(RATE_LIMIT_BACKOFF_MS[attempt])
    last = await sendEmail(target.email, plan.subject, plan.render(target))
  }
  return last
}

/**
 * Send one plan to a resolved target list, honouring each person's email
 * preference for this event. One message per person (no shared To header, so
 * no client ever learns who else is on the thread), and one failure never
 * stops the rest.
 *
 * Awaits every send: call `deferNotificationEmails` from a route handler so the
 * response does not wait on it.
 */
export async function dispatchNotificationEmails(
  database: DrizzleDB,
  targets: readonly EmailTarget[],
  eventType: NotificationEventType,
  plan: NotificationEmailPlan,
): Promise<EmailDispatchResult> {
  if (targets.length === 0) return NO_DISPATCH
  // Nothing is configured to send: stay quiet rather than log once per
  // recipient on every local request.
  if (!process.env.RESEND_API_KEY) return NO_DISPATCH

  const { allowed, muted } = await filterTargetsByEmailPref(database, targets, eventType)
  const result: EmailDispatchResult = { sent: 0, muted, failed: 0, deferred: false }

  for (const target of allowed) {
    try {
      const res = await sendWithBackoff(target, plan)
      if (res.success) result.sent += 1
      else {
        result.failed += 1
        console.warn(`[notification-email] ${eventType} send refused: ${res.error ?? 'unknown'}`)
      }
    } catch (err) {
      result.failed += 1
      console.warn(`[notification-email] ${eventType} send failed:`, err)
    }
  }

  // A swallowed failure that nobody can see is how a client quietly stops
  // hearing from us, so the total is stated once even when every send failed
  // for the same reason.
  if (result.failed > 0) {
    console.warn(
      `[notification-email] ${eventType}: ${result.failed} of ${allowed.length} addresses did not send`,
    )
  }

  return result
}

/**
 * Run the fan-out after the response, the way lib/events.ts runs the webhook
 * fan-out. Falls back to awaiting where no Cloudflare execution context exists
 * (vitest, plain node), so a test still sees the counts and nothing is left
 * floating.
 */
async function offResponsePath(
  work: () => Promise<EmailDispatchResult>,
): Promise<EmailDispatchResult> {
  let waitUntil: ((promise: Promise<unknown>) => void) | null = null
  try {
    const { getCloudflareContext } = await import('@opennextjs/cloudflare')
    const cfCtx = await getCloudflareContext({ async: true })
    if (cfCtx?.ctx?.waitUntil) waitUntil = cfCtx.ctx.waitUntil.bind(cfCtx.ctx)
  } catch {
    // No context here. Awaiting is the correct fallback, not an error.
    waitUntil = null
  }
  const promise = work()
  if (!waitUntil) return await promise
  waitUntil(promise)
  return DEFERRED
}

/**
 * Send one plan to an already-resolved target list, off the response path.
 * The entry point a route handler should use.
 */
export async function deferNotificationEmails(
  database: DrizzleDB,
  targets: readonly EmailTarget[],
  eventType: NotificationEventType,
  plan: NotificationEmailPlan,
): Promise<EmailDispatchResult> {
  if (targets.length === 0 || !process.env.RESEND_API_KEY) return NO_DISPATCH
  return offResponsePath(() => dispatchNotificationEmails(database, targets, eventType, plan))
}

/**
 * Resolve typed recipients and send, off the response path. The entry point
 * `createNotifications` calls when a payload carries an email plan, so the bell
 * row and the email are one call site.
 */
export async function sendNotificationEmails(
  database: DrizzleDB,
  recipients: readonly NotificationRecipient[],
  eventType: NotificationEventType,
  plan: NotificationEmailPlan,
): Promise<EmailDispatchResult> {
  // Nothing is configured to send, so do not spend the recipient lookup or the
  // execution-context probe on every local request.
  if (recipients.length === 0 || !process.env.RESEND_API_KEY) return NO_DISPATCH
  return offResponsePath(async () => {
    try {
      const targets = await resolveEmailTargets(database, recipients)
      return await dispatchNotificationEmails(database, targets, eventType, plan)
    } catch (err) {
      console.warn(`[notification-email] ${eventType} dispatch failed:`, err)
      return NO_DISPATCH
    }
  })
}

// ─── The wired events ────────────────────────────────────────────────────────
//
// Four, and only four, for now. Every other notification stays in the bell.
// The copy lives here rather than at the call sites so the studio can read the
// whole client-facing voice in one file.

/**
 * (1) The studio replied on a request thread, and the client should hear about
 * it. Only ever built from a message that is NOT internal: the template quotes
 * the one message it is handed, and an internal note never reaches this call.
 */
export function threadReplyEmailPlan(input: {
  audience: EmailAudience
  requestId: string
  requestTitle: string
  requestNumber: number | null
  fromName: string
  /** Plain text already, via toPlainText. Never raw composer HTML. */
  message: string
}): NotificationEmailPlan {
  const subject = requestEmailSubject(
    input.requestNumber,
    input.audience === 'client'
      ? `${input.fromName} replied on "${input.requestTitle}"`
      : `New client message on "${input.requestTitle}"`,
  )
  const url = notificationEmailUrl(input.requestId, routeAudience(input.audience))
  return {
    subject,
    render: (target) =>
      createElement(NewMessageEmail, {
        audience: input.audience,
        recipientName: greetingName(target.name, 'there'),
        requestTitle: input.requestTitle,
        requestNumber: input.requestNumber,
        fromName: input.fromName,
        message: truncate(input.message, 900),
        requestUrl: url,
      }),
  }
}

/**
 * (2) A status the client has to act on. Wired for client_review and delivered
 * only: in_review and in_progress are studio housekeeping, and mailing them
 * teaches a client to filter us.
 */
export function clientStatusEmailPlan(input: {
  status: 'client_review' | 'delivered'
  requestId: string
  requestTitle: string
  requestNumber: number | null
  /** The client COMPANY, for the delivered template's "Client" row. Never the
   *  recipient: that is a greeting, and the two are different sentences. */
  clientName?: string | null
  /** ISO timestamp for the delivered stamp. */
  deliveredAt?: string | null
}): NotificationEmailPlan {
  const url = notificationEmailUrl(input.requestId, 'client')
  if (input.status === 'client_review') {
    return {
      subject: requestEmailSubject(
        input.requestNumber,
        `Ready for your review: "${input.requestTitle}"`,
      ),
      render: (target) =>
        createElement(RequestClientReviewEmail, {
          recipientName: greetingName(target.name, 'there'),
          requestTitle: input.requestTitle,
          requestNumber: input.requestNumber,
          reviewUrl: url,
        }),
    }
  }
  return {
    subject: requestEmailSubject(input.requestNumber, `Delivered: "${input.requestTitle}"`),
    render: (target) =>
      createElement(RequestDeliveredEmail, {
        requestTitle: input.requestTitle,
        recipientName: greetingName(target.name, 'there'),
        clientName: input.clientName ?? null,
        deliveredAt: formatDeliveredAt(input.deliveredAt),
        // Same resolver the bell click uses, so the button and the bell can
        // never land on different pages if the client route ever moves.
        requestUrl: url,
      }),
  }
}

/** A stable, locale free date for the delivered stamp. */
function formatDeliveredAt(value: string | null | undefined): string {
  const date = value ? new Date(value) : new Date()
  if (Number.isNaN(date.getTime())) return ''
  return date.toISOString().slice(0, 10)
}

/**
 * (3) A client filed a request. Goes to the studio, which is the audience that
 * has to triage it, and carries the client's name because the request number is
 * per org and means nothing on its own.
 */
export function studioNewRequestEmailPlan(input: {
  requestId: string
  requestTitle: string
  requestNumber: number | null
  clientName: string
  category?: string | null
  priority?: string | null
  submittedBy?: string | null
}): NotificationEmailPlan {
  return {
    subject: requestEmailSubject(
      input.requestNumber,
      `New request from ${input.clientName}: ${input.requestTitle}`,
    ),
    render: () =>
      createElement(NewRequestEmail, {
        requestTitle: input.requestTitle,
        clientName: input.clientName,
        category: input.category ?? undefined,
        priority: input.priority ?? undefined,
        submittedBy: input.submittedBy ?? undefined,
        dashboardUrl: appOrigin(),
        requestId: input.requestId,
      }),
  }
}
