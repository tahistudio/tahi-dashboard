/**
 * lib/email.ts
 * The React-element send helper.
 *
 * It no longer talks to Resend. Every send now goes through the one door in
 * lib/email-delivery.ts, which applies the tahi.studio allowlist, records what
 * it withheld, and owns the only Resend client in the tree. This module is
 * what it always was from a caller's point of view: "render this element and
 * mail it", with the same signature it has had all along so the dozen call
 * sites and their tests did not have to move.
 */
import type { ReactElement } from 'react'
import { deliverEmail } from '@/lib/email-delivery'
import type { DeliveryPolicy } from '@/lib/email-allowlist'

export { emailFromAddress } from '@/lib/email-from'

/**
 * What this send is and who it belongs to, for the suppression log.
 *
 * Optional because lib/notification-email.ts is owned by another slice and
 * cannot be edited here; a send with no context is logged under 'unspecified'
 * rather than refused.
 */
export interface SendEmailContext {
  /** Kebab-case template name, e.g. 'invoice-sent'. */
  template?: string
  /** The client this send belongs to, when there is one. */
  orgId?: string | null
  /**
   * An already-resolved delivery policy, for a caller sending in a loop.
   *
   * The announcement fan-out mails one contact at a time in batches, so
   * without this it paid a settings read per recipient. Read it once above the
   * loop and hand it down.
   */
  policy?: DeliveryPolicy
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
  context?: SendEmailContext,
): Promise<{ success: boolean; error?: string; suppressedCount?: number }> {
  const result = await deliverEmail({
    to,
    subject,
    react,
    text,
    template: context?.template ?? 'unspecified',
    orgId: context?.orgId ?? null,
    ...(context?.policy ? { policy: context.policy } : {}),
  })

  return {
    success: result.success,
    ...(result.error ? { error: result.error } : {}),
    ...(result.suppressedCount > 0 ? { suppressedCount: result.suppressedCount } : {}),
  }
}
