/**
 * lib/email.ts
 * Resend email send helper.
 * Only sends if RESEND_API_KEY is set in the environment.
 */
import { Resend } from 'resend'
import type { ReactElement } from 'react'

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
): Promise<{ success: boolean; error?: string }> {
  const resend = getResend()
  if (!resend) {
    return { success: false, error: 'RESEND_API_KEY not configured' }
  }

  const from = process.env.RESEND_FROM_EMAIL ?? 'business@tahi.studio'

  try {
    const { error } = await resend.emails.send({
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      react,
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
