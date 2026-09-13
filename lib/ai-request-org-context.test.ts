import { describe, it, expect } from 'vitest'
import { formatRequestOrgContext } from '@/lib/ai-request-org-context'

describe('formatRequestOrgContext', () => {
  it('returns nothing for a brand-new org with no history', () => {
    expect(formatRequestOrgContext({ org: null, brands: [], recentRequests: [] })).toBe('')
  })

  it('names the org, its industry and website', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: 'Hardware retail', website: 'acme.co.nz' },
      brands: [],
      recentRequests: [],
    })
    expect(text).toContain('Name: Acme Hardware')
    expect(text).toContain('Industry: Hardware retail')
    expect(text).toContain('Website: acme.co.nz')
  })

  it('lists recent requests with their category so the model never re-asks about them', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [],
      recentRequests: [
        { title: 'Hardware service page redesign', category: 'design' },
        { title: 'Fix contact form', category: 'development' },
      ],
    })
    expect(text).toContain('Hardware service page redesign (design)')
    expect(text).toContain('Fix contact form (development)')
  })

  it('does not add the which-brand rule for a single brand', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Hardware', industry: null, website: null },
      brands: [{ name: 'Acme Retail', website: 'acme-retail.com' }],
      recentRequests: [],
    })
    expect(text).toContain('Brands on file: Acme Retail (acme-retail.com)')
    expect(text).not.toContain('Ask which one')
  })

  it('triggers the which-brand rule once more than one brand is on file', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Group', industry: null, website: null },
      brands: [
        { name: 'Acme Retail', website: 'acme-retail.com' },
        { name: 'Acme Wholesale', website: 'acme-wholesale.com' },
      ],
      recentRequests: [],
    })
    expect(text).toContain('Brands on file: Acme Retail (acme-retail.com), Acme Wholesale (acme-wholesale.com)')
    expect(text).toContain('Ask which one this request is for before drafting')
  })

  it('never uses an em or en dash', () => {
    const text = formatRequestOrgContext({
      org: { name: 'Acme Group', industry: 'Hardware', website: 'acme.co.nz' },
      brands: [
        { name: 'Acme Retail', website: null },
        { name: 'Acme Wholesale', website: null },
      ],
      recentRequests: [{ title: 'Something', category: 'design' }],
    })
    expect(text.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(text.includes(String.fromCharCode(0x2013))).toBe(false)
  })
})
