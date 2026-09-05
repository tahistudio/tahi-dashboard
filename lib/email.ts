/**
 * lib/email.ts
 * Resend email send helper.
 * Only sends if RESEND_API_KEY is set in the environment.
 */
import { Resend } from 'resend'
import type { ReactElement } from 'react'

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

let _resend: Resend | null = null

function getResend(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY)
  }
  return _resend
}

export async function sendEmail(
  to: string | string[],
  subject: string,
  react: ReactElement,
  /**
   * The plain text alternative for the same message.
   *
   * An HTML-only email is scored as one by every spam filter worth naming, and
   * it is unreadable in a text-only client or a screen reader that refuses the
   * HTML part. Optional rather than required because a caller that has no text
   * form should still send: a missing alternative costs deliverability, an
   * exception costs the whole message.
   */
  text?: string,
): Promise<{ success: boolean; error?: string }> {
  const resend = getResend()
  if (!resend) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const from = emailFromAddress()

  try {
    const { error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
      ...(text && text.trim() ? { text } : {}),
    })

    if (error) {
      console.error('[email] Resend error:', error)
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (err) {
    console.error('[email] Send failed:', err)
    return { success: false, error: 'Failed to send email' }
  }
}
