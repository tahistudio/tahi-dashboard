import { describe, it, expect } from 'vitest'
import {
  REQUEST_STATUSES,
  TASK_STATUSES,
  REQUEST_STATUS_TONE,
  TASK_STATUS_TONE,
  REQUEST_STATUS_LABELS,
  TASK_STATUS_LABELS,
  REQUEST_STATUS_CONFIG,
} from './status-config'

describe('REQUEST_STATUSES canonical vocabulary', () => {
  it('is ordered by lifecycle and includes on_hold + cancelled', () => {
    expect(REQUEST_STATUSES.map((s) => s.value)).toEqual([
      'submitted',
      'in_review',
      'in_progress',
      'client_review',
      'on_hold',
      'delivered',
      'cancelled',
      'archived',
    ])
  })

  it('gives every entry a label and a tone', () => {
    for (const s of REQUEST_STATUSES) {
      expect(s.label.length).toBeGreaterThan(0)
      expect(typeof s.tone).toBe('string')
    }
  })

  it('has no duplicate values', () => {
    const values = REQUEST_STATUSES.map((s) => s.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('styles on_hold and cancelled in REQUEST_STATUS_CONFIG (no snake_case fallthrough)', () => {
    expect(REQUEST_STATUS_CONFIG.on_hold?.label).toBe('On Hold')
    expect(REQUEST_STATUS_CONFIG.cancelled?.label).toBe('Cancelled')
    // Every request status option must have a config entry to render from.
    for (const s of REQUEST_STATUSES) {
      expect(REQUEST_STATUS_CONFIG[s.value]).toBeDefined()
    }
  })
})

describe('TASK_STATUSES canonical vocabulary', () => {
  it('is ordered todo -> in_progress -> blocked -> done', () => {
    expect(TASK_STATUSES.map((s) => s.value)).toEqual([
      'todo',
      'in_progress',
      'blocked',
      'done',
    ])
  })

  it('settles the one canonical tone map (blocked = danger)', () => {
    expect(TASK_STATUS_TONE).toEqual({
      todo: 'neutral',
      in_progress: 'info',
      blocked: 'danger',
      done: 'positive',
    })
  })

  it('has no duplicate values', () => {
    const values = TASK_STATUSES.map((s) => s.value)
    expect(new Set(values).size).toBe(values.length)
  })
})

describe('derived lookups stay in lockstep with the arrays', () => {
  it('REQUEST tone + label maps match the array', () => {
    for (const s of REQUEST_STATUSES) {
      expect(REQUEST_STATUS_TONE[s.value]).toBe(s.tone)
      expect(REQUEST_STATUS_LABELS[s.value]).toBe(s.label)
    }
  })

  it('TASK tone + label maps match the array', () => {
    for (const s of TASK_STATUSES) {
      expect(TASK_STATUS_TONE[s.value]).toBe(s.tone)
      expect(TASK_STATUS_LABELS[s.value]).toBe(s.label)
    }
  })
})
