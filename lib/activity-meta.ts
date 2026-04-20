/**
 * activity-meta.ts — extended metadata for activity types.
 *
 * The base <ActivityItem> component supports 6 types (call, meeting,
 * email, note, task, status). This module extends that set with all the
 * deal-specific types and maps them back to the 6 base types for icon
 * colours, so the rendering layer doesn't need to change.
 */

import type { ActivityType as BaseActivityType } from '@/components/tahi/activity-timeline'
import type { DealActivityType } from '@/lib/deal-activity'

export type AnyActivityType = BaseActivityType | DealActivityType

/** Map any activity type → the base type used for icon + colour. */
export function baseTypeFor(t: string): BaseActivityType {
  switch (t) {
    case 'call':
      return 'call'
    case 'meeting':
      return 'meeting'
    case 'email':
    case 'nudge_sent':
      return 'email'
    case 'note':
    case 'notes_change':
      return 'note'
    case 'task':
    case 'won':
      return 'task'
    // All status-like events collapse to the muted "status" treatment.
    case 'deal_created':
    case 'stage_change':
    case 'value_change':
    case 'currency_change':
    case 'owner_change':
    case 'org_change':
    case 'source_change':
    case 'engagement_change':
    case 'close_date_change':
    case 'lost':
    case 'archived':
    case 'unarchived':
    case 'auto_nudges_toggled':
    case 'contact_added':
    case 'contact_removed':
    case 'status':
    default:
      return 'status'
  }
}

/** Human-readable short label for each activity type — shown as a chip
 *  in the timeline filter. */
export const ACTIVITY_TYPE_LABEL: Record<string, string> = {
  call: 'Call',
  meeting: 'Meeting',
  email: 'Email',
  note: 'Note',
  task: 'Task',
  status: 'Status',
  deal_created: 'Created',
  stage_change: 'Stage',
  value_change: 'Value',
  currency_change: 'Currency',
  owner_change: 'Owner',
  org_change: 'Company',
  source_change: 'Source',
  engagement_change: 'Engagement',
  close_date_change: 'Close date',
  notes_change: 'Notes',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
  unarchived: 'Unarchived',
  auto_nudges_toggled: 'Nudges',
  nudge_sent: 'Nudge',
  contact_added: 'Contact +',
  contact_removed: 'Contact \u2212',
}

/** Categories for grouping in the filter dropdown. */
export const ACTIVITY_CATEGORIES: Array<{ label: string; types: string[] }> = [
  {
    label: 'Conversations',
    types: ['call', 'meeting', 'email', 'nudge_sent'],
  },
  {
    label: 'Deal changes',
    types: [
      'deal_created',
      'stage_change',
      'value_change',
      'currency_change',
      'owner_change',
      'org_change',
      'source_change',
      'engagement_change',
      'close_date_change',
      'won',
      'lost',
      'archived',
      'unarchived',
    ],
  },
  {
    label: 'Notes & tasks',
    types: ['note', 'notes_change', 'task'],
  },
  {
    label: 'Automations',
    types: ['auto_nudges_toggled'],
  },
  {
    label: 'Contacts',
    types: ['contact_added', 'contact_removed'],
  },
]

/** Parse the metadata JSON safely. Returns null if not parseable. */
export function parseActivityMetadata(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}
