/**
 * The three email delivery settings, at the door.
 *
 * `settings` is untyped TEXT, so the shape has to be enforced here or not at
 * all, and the cost of a bad value is not cosmetic: a typo in
 * `email.allowedDomains` is the difference between a test email landing in a
 * teammate's inbox and landing in a client's.
 *
 * The pairing that matters and is easy to get backwards: the validator is
 * STRICT (a mistake can still be reported to the person making it) while the
 * resolver is TOLERANT and always falls back to the CLOSED default (a
 * hand-edited row must not open the gate, and must not throw inside a send).
 */
import { describe, it, expect } from 'vitest'
import {
  ALLOWED_DOMAINS_SETTING_KEY,
  ALLOWED_ORG_IDS_SETTING_KEY,
  DELIVERY_MODE_SETTING_KEY,
  validateAllowedDomains,
  validateAllowedOrgIds,
  validateDeliveryMode,
  validateEmailDeliverySetting,
} from '@/lib/email-allowlist'

describe('email.deliveryMode', () => {
  it('accepts the two values and the clear', () => {
    expect(validateDeliveryMode('allowlist').ok).toBe(true)
    expect(validateDeliveryMode('all').ok).toBe(true)
    expect(validateDeliveryMode('').ok).toBe(true)
    expect(validateDeliveryMode(null).ok).toBe(true)
  })

  it('rejects anything else, and says what "all" would mean', () => {
    const res = validateDeliveryMode('everyone')
    expect(res.ok).toBe(false)
    if (!res.ok) {
      expect(res.error).toContain(DELIVERY_MODE_SETTING_KEY)
      expect(res.error).toContain('real clients')
    }
    expect(validateDeliveryMode('ALL').ok).toBe(false)
    expect(validateDeliveryMode(true).ok).toBe(false)
  })
})

describe('email.allowedDomains', () => {
  it('accepts a JSON array of bare domains, and the clear', () => {
    expect(validateAllowedDomains('["tahi.studio"]').ok).toBe(true)
    expect(validateAllowedDomains('["tahi.studio","example.co.nz"]').ok).toBe(true)
    expect(validateAllowedDomains('[]').ok).toBe(true)
    expect(validateAllowedDomains('').ok).toBe(true)
  })

  it('rejects an address pasted in where a domain belongs', () => {
    const res = validateAllowedDomains('["business@tahi.studio"]')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain('Drop the local part')
  })

  it('rejects a URL, a bare label and anything with a space', () => {
    for (const bad of ['["https://tahi.studio"]', '["tahistudio"]', '["tahi studio.com"]', '["tahi.studio/x"]']) {
      expect(validateAllowedDomains(bad).ok).toBe(false)
    }
  })

  it('rejects malformed JSON and a non-array', () => {
    expect(validateAllowedDomains('{not json').ok).toBe(false)
    expect(validateAllowedDomains('"tahi.studio"').ok).toBe(false)
    expect(validateAllowedDomains('{"a":1}').ok).toBe(false)
  })

  it('rejects a non-string or empty entry', () => {
    expect(validateAllowedDomains('[7]').ok).toBe(false)
    expect(validateAllowedDomains('["  "]').ok).toBe(false)
  })

  it('names the key in every message, so the settings form can show it as-is', () => {
    const res = validateAllowedDomains('[7]')
    if (!res.ok) expect(res.error).toContain(ALLOWED_DOMAINS_SETTING_KEY)
  })
})

describe('email.allowedOrgIds', () => {
  it('accepts a JSON array of ids and the clear', () => {
    expect(validateAllowedOrgIds('["org-1","org-2"]').ok).toBe(true)
    expect(validateAllowedOrgIds('[]').ok).toBe(true)
    expect(validateAllowedOrgIds(null).ok).toBe(true)
  })

  it('rejects an entry with a space, which is a name and not an id', () => {
    const res = validateAllowedOrgIds('["Acme Orchard"]')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toContain(ALLOWED_ORG_IDS_SETTING_KEY)
  })

  it('rejects malformed JSON and a non-array', () => {
    expect(validateAllowedOrgIds('org-1').ok).toBe(false)
    expect(validateAllowedOrgIds('{"a":1}').ok).toBe(false)
  })
})

describe('the one entry point the settings route calls', () => {
  it('routes each key to its own validator', () => {
    expect(validateEmailDeliverySetting(DELIVERY_MODE_SETTING_KEY, 'nope').ok).toBe(false)
    expect(validateEmailDeliverySetting(ALLOWED_DOMAINS_SETTING_KEY, '["x@y.com"]').ok).toBe(false)
    expect(validateEmailDeliverySetting(ALLOWED_ORG_IDS_SETTING_KEY, '["a b"]').ok).toBe(false)
  })

  it('passes any key it does not own, so the route can call it unconditionally', () => {
    expect(validateEmailDeliverySetting('studio_legal_name', 'Tahi Studio Ltd').ok).toBe(true)
    expect(validateEmailDeliverySetting('invoicing.defaultChannel', 'nonsense').ok).toBe(true)
  })
})
