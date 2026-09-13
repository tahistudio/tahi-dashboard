import { describe, it, expect } from 'vitest'
import { estimateRequestHours, isLargeWizardType, wizardHourEstimatesPromptBlock } from '@/lib/wizard-hour-estimates'

describe('estimateRequestHours', () => {
  it('never lands anywhere near a single day for a large development request', () => {
    // The bug this exists for: the model agreed to "8 hours" for a 15-20
    // page design plus a Webflow build plus content. A large development
    // request must land in weeks of hours, not a single day.
    expect(estimateRequestHours('development', 'large_task')).toBeGreaterThanOrEqual(40)
  })

  it('maps every category and size to the studio baseline table', () => {
    expect(estimateRequestHours('design', 'small_task')).toBe(8)
    expect(estimateRequestHours('design', 'large_task')).toBe(32)
    expect(estimateRequestHours('development', 'small_task')).toBe(12)
    expect(estimateRequestHours('development', 'large_task')).toBe(46)
    expect(estimateRequestHours('content', 'small_task')).toBe(6)
    expect(estimateRequestHours('content', 'large_task')).toBe(18)
    expect(estimateRequestHours('strategy', 'small_task')).toBe(6)
    expect(estimateRequestHours('strategy', 'large_task')).toBe(23)
  })

  it('maps new_feature onto the large bucket and bug_fix onto the small one', () => {
    expect(estimateRequestHours('development', 'new_feature')).toBe(46)
    expect(estimateRequestHours('development', 'bug_fix')).toBe(12)
  })
})

describe('isLargeWizardType', () => {
  it('treats large_task and new_feature as large, everything else as small', () => {
    expect(isLargeWizardType('large_task')).toBe(true)
    expect(isLargeWizardType('new_feature')).toBe(true)
    expect(isLargeWizardType('small_task')).toBe(false)
    expect(isLargeWizardType('bug_fix')).toBe(false)
  })
})

describe('wizardHourEstimatesPromptBlock', () => {
  it('names every category the table carries, so the prompt cannot drift from the enforced numbers', () => {
    const block = wizardHourEstimatesPromptBlock()
    expect(block).toContain('design small: 8 hours')
    expect(block).toContain('development large: 46 hours')
    expect(block.includes(String.fromCharCode(0x2014))).toBe(false)
    expect(block.includes(String.fromCharCode(0x2013))).toBe(false)
  })
})
