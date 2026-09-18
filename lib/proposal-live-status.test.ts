import { describe, it, expect } from 'vitest'
import { isProposalLiveStatus } from '@/lib/proposal-live-status'

describe('isProposalLiveStatus', () => {
  it('treats shared as live', () => {
    expect(isProposalLiveStatus('shared')).toBe(true)
  })

  it('treats accepted as live', () => {
    expect(isProposalLiveStatus('accepted')).toBe(true)
  })

  it('treats published as live, for forward compatibility', () => {
    expect(isProposalLiveStatus('published')).toBe(true)
  })

  it('treats draft as not live', () => {
    expect(isProposalLiveStatus('draft')).toBe(false)
  })

  it('treats declined, withdrawn and expired as not live', () => {
    expect(isProposalLiveStatus('declined')).toBe(false)
    expect(isProposalLiveStatus('withdrawn')).toBe(false)
    expect(isProposalLiveStatus('expired')).toBe(false)
  })

  it('treats null and undefined as not live', () => {
    expect(isProposalLiveStatus(null)).toBe(false)
    expect(isProposalLiveStatus(undefined)).toBe(false)
  })
})
