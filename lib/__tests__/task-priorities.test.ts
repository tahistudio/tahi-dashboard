import { describe, it, expect } from 'vitest'
import {
  TASK_PRIORITIES,
  isTaskPriority,
  taskPriorityLabel,
} from '@/lib/task-priorities'

describe('TASK_PRIORITIES', () => {
  it('is exactly standard/high/urgent, in order', () => {
    expect([...TASK_PRIORITIES]).toEqual(['standard', 'high', 'urgent'])
  })

  it('does not include the retired "low" value', () => {
    expect((TASK_PRIORITIES as readonly string[]).includes('low')).toBe(false)
  })
})

describe('isTaskPriority', () => {
  it('accepts every canonical value', () => {
    for (const p of TASK_PRIORITIES) expect(isTaskPriority(p)).toBe(true)
  })

  it('rejects low, medium, and non-strings', () => {
    expect(isTaskPriority('low')).toBe(false)
    expect(isTaskPriority('medium')).toBe(false)
    expect(isTaskPriority('')).toBe(false)
    expect(isTaskPriority(null)).toBe(false)
    expect(isTaskPriority(3)).toBe(false)
  })
})

describe('taskPriorityLabel', () => {
  it('humanises canonical values', () => {
    expect(taskPriorityLabel('standard')).toBe('Standard')
    expect(taskPriorityLabel('high')).toBe('High')
    expect(taskPriorityLabel('urgent')).toBe('Urgent')
  })

  it('falls back to the raw value for unknowns', () => {
    expect(taskPriorityLabel('low')).toBe('low')
  })
})
