/**
 * lib/email-from.ts
 *
 * The one from address, in a module of its own.
 *
 * It used to live in lib/email.ts. It moved here when lib/email-delivery.ts
 * became the single door out: `sendEmail` now calls the delivery gate, and the
 * gate needs the from address, so leaving it in lib/email.ts would have made
 * the two modules import each other. One small leaf module, imported by both,
 * is cheaper than a cycle that works until the day a bundler decides it does
 * not.
 *
 * `lib/email.ts` re-exports `emailFromAddress`, so every existing
 * `import { emailFromAddress } from '@/lib/email'` keeps working.
 */

/**
 * The lockup every Tahi email is sent from when the Worker has no
 * RESEND_FROM_EMAIL set.
 *
 * Branded rather than bare on purpose: eight call sites decided a from address
 * for themselves, four values between them, and this module fell back to a
 * fifth, unnamed one, so a client's inbox threaded the studio as several
 * separate senders and the "[REQ-n]" subject prefix could not group anything.
 * Every send in the tree now asks this module, including the two written in
 * one person's voice (they pass a display name, below).
 */
const DEFAULT_FROM = 'Tahi Studio <business@tahi.studio>'

/**
 * The from address for any send, from one place.
 *
 * The operator overrides it with RESEND_FROM_EMAIL, which should hold a
 * verified lockup such as 'Tahi Studio <notifications@tahi.studio>'.
 *
 * `displayName` re-labels the same mailbox for the handful of emails written in
 * one person's voice (a sales nudge is signed by a human, not by a studio).
 * The mailbox is taken out of the configured value rather than concatenated
 * with it, so an operator who sets a full lockup does not end up sending from
 * "Someone <Tahi Studio <notifications@tahi.studio>>".
 */
export function emailFromAddress(displayName?: string): string {
  const configured = process.env.RESEND_FROM_EMAIL?.trim()
  const from = configured && configured.length > 0 ? configured : DEFAULT_FROM
  if (!displayName?.trim()) return from
  const mailbox = from.match(/<([^>]+)>/)?.[1]?.trim() ?? from
  return `${displayName.trim()} <${mailbox}>`
}
