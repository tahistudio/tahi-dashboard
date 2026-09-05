/**
 * lib/email.ts: what actually reaches Resend.
 *
 * Two things are pinned here because both are invisible until a real inbox
 * shows them: the plain text alternative (an HTML-only message is scored as
 * spam and is unreadable in a text-only client) and the single from address
 * every send inherits.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createElement } from 'react'

const send = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

import { emailFromAddress, sendEmail } from '@/lib/email'

type SentPayload = {
  from: string
  to: string[]
  subject: string
  text?: string
}

function lastPayload(): SentPayload {
  return send.mock.calls[send.mock.calls.length - 1][0] as SentPayload
}

const body = createElement('p', null, 'Your request is ready for your review.')

beforeEach(() => {
  vi.clearAllMocks()
  send.mockResolvedValue({ error: null })
  vi.stubEnv('RESEND_API_KEY', 'test_key')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('sendEmail, the plain text alternative', () => {
  it('sends the text part alongside the HTML when it is given one', async () => {
    const res = await sendEmail('jo@acme.com', 'Delivered', body, 'Delivered: read it in the portal.')
    expect(res.success).toBe(true)
    expect(lastPayload().text).toBe('Delivered: read it in the portal.')
  })

  it('still sends when there is no text form, rather than refusing', async () => {
    const res = await sendEmail('jo@acme.com', 'Delivered', body)
    expect(res.success).toBe(true)
    expect('text' in lastPayload()).toBe(false)
  })

  it('treats a blank text part as no text part', async () => {
    await sendEmail('jo@acme.com', 'Delivered', body, '   \n  ')
    expect('text' in lastPayload()).toBe(false)
  })
})

describe('emailFromAddress', () => {
  it('falls back to a branded lockup, not a bare mailbox', () => {
    vi.stubEnv('RESEND_FROM_EMAIL', '')
    expect(emailFromAddress()).toBe('Tahi Studio <business@tahi.studio>')
  })

  it('lets the operator override it', () => {
    vi.stubEnv('RESEND_FROM_EMAIL', 'Tahi Studio <notifications@tahi.studio>')
    expect(emailFromAddress()).toBe('Tahi Studio <notifications@tahi.studio>')
  })

  it('re-labels the same mailbox for an email written in one voice', () => {
    vi.stubEnv('RESEND_FROM_EMAIL', 'Tahi Studio <notifications@tahi.studio>')
    // Not "Liam <Tahi Studio <notifications@tahi.studio>>", which is what
    // concatenating the configured value produced.
    expect(emailFromAddress('Liam from Tahi Studio'))
      .toBe('Liam from Tahi Studio <notifications@tahi.studio>')
  })

  it('re-labels a bare configured address too', () => {
    vi.stubEnv('RESEND_FROM_EMAIL', 'hello@tahi.studio')
    expect(emailFromAddress('Liam')).toBe('Liam <hello@tahi.studio>')
  })

  it('is what every send inherits', async () => {
    vi.stubEnv('RESEND_FROM_EMAIL', 'Tahi Studio <notifications@tahi.studio>')
    await sendEmail('jo@acme.com', 'Delivered', body)
    expect(lastPayload().from).toBe('Tahi Studio <notifications@tahi.studio>')
  })
})

describe('sendEmail, the recipients and the failure paths', () => {
  it('accepts one address or many', async () => {
    await sendEmail('jo@acme.com', 'One', body)
    expect(lastPayload().to).toEqual(['jo@acme.com'])
    await sendEmail(['jo@acme.com', 'sam@acme.com'], 'Two', body)
    expect(lastPayload().to).toEqual(['jo@acme.com', 'sam@acme.com'])
  })

  it('does not send at all without an API key', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    const res = await sendEmail('jo@acme.com', 'Delivered', body)
    expect(res.success).toBe(false)
    expect(send).not.toHaveBeenCalled()
  })

  it('reports a refusal rather than throwing', async () => {
    send.mockResolvedValue({ error: { message: 'Too many requests' } })
    const res = await sendEmail('jo@acme.com', 'Delivered', body)
    expect(res).toEqual({ success: false, error: 'Too many requests' })
  })
})
