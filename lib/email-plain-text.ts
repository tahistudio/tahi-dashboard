/**
 * lib/email-plain-text.ts
 *
 * The text/plain half of a multipart message, rendered from the same element
 * the HTML half comes from so the two can never say different things.
 *
 * WHY IT IS ITS OWN MODULE. An HTML-only email is scored as one by every spam
 * filter worth naming, and it is unreadable in a text-only client or a screen
 * reader that refuses the HTML part. `sendEmail` takes the text part as its
 * fourth argument (lib/email.ts), so every sender that renders a React template
 * wants this, not just the notification dispatcher that first needed it.
 *
 * Best effort by design: a template that cannot be rendered to text still sends
 * as HTML, because losing a delivery notice is worse than losing an
 * alternative part.
 *
 * NOTE. lib/notification-email.ts carries a private copy of this function,
 * written before this module existed. It should call this one instead the next
 * time that file is opened; it was not changed here because another change was
 * in flight against it.
 */

import type { ReactElement } from 'react'
import { render } from '@react-email/render'

/**
 * The text alternative for `el`, or undefined when there is nothing usable to
 * send (the render threw, or it produced only whitespace).
 */
export async function plainTextAlternative(el: ReactElement): Promise<string | undefined> {
  try {
    const text = await render(el, { plainText: true })
    return text.trim() ? text : undefined
  } catch {
    return undefined
  }
}
