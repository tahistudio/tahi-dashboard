/**
 * lib/tasks-quick-add.ts
 *
 * The quick-add grammar: one line of text becomes a task. Ported from the
 * prototype's `parseQuick`, with the priority scale mapped onto the repo's
 * (standard / high / urgent) and one deliberate divergence: a client match
 * produces the Internal level, not Client. A quick-added chaser is normally
 * not client-facing, and this makes the rule agree with the detail panel,
 * where setting a client on a Tahi task also yields Internal.
 *
 * Pure and node-testable. `now` is injected so weekday maths is deterministic.
 * Order of operations is load-bearing: explicit priority, then the implicit
 * "urgent", then the date, then the client. Each rule lifts its own token out
 * of the string before the next one reads it.
 */

import type { TaskLevel } from '@/lib/tasks-views'
import type { TaskPriority } from '@/lib/task-priorities'

export interface QuickAddClient {
  id: string
  name: string
}

export interface QuickAddParse {
  /** What is left after every token has been lifted out. May be empty, in
   *  which case the caller must refuse to submit. */
  title: string
  orgId: string | null
  level: TaskLevel
  /** YYYY-MM-DD, local. */
  dueDate: string | null
  /** Null means "the user said nothing", so the caller falls back to the
   *  column default rather than writing `standard` on purpose. */
  priority: TaskPriority | null
}

/** The prototype offered four priorities. Two of them do not exist in the
 *  repo, so they alias onto standard rather than 400 on the write. */
const PRIORITY_ALIASES: Record<string, TaskPriority> = {
  urgent: 'urgent',
  high: 'high',
  standard: 'standard',
  medium: 'standard',
  normal: 'standard',
  low: 'standard',
}

const DAY_NAMES = [
  'sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday',
] as const

/** Local YYYY-MM-DD `offset` days after `base`. Anchored on the local date
 *  parts rather than epoch maths, so a DST boundary cannot shift the day. */
function offsetToDate(base: Date, offset: number): string {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/** Escape a client name so a name with a dot or a plus in it cannot become a
 *  wildcard. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function parseQuickAdd(
  raw: string,
  clients: readonly QuickAddClient[],
  now: Date = new Date(),
): QuickAddParse {
  // Padded so every rule can anchor on a leading space and treat the start of
  // the string exactly like a word boundary.
  let text = ` ${raw} `

  // 1. Explicit priority.
  let priority: TaskPriority | null = null
  const bang = text.match(/\s!(urgent|high|standard|medium|normal|low)\b/i)
  if (bang) {
    priority = PRIORITY_ALIASES[bang[1].toLowerCase()]
    text = text.replace(bang[0], ' ')
  }

  // 2. Implicit "urgent", only when no bang token won.
  if (!priority) {
    const bare = text.match(/\s(urgent)\b/i)
    if (bare) {
      priority = 'urgent'
      text = text.replace(bare[0], ' ')
    }
  }

  // 3. Date. First matching rule wins and takes its token with it.
  let dueDate: string | null = null
  const todayDow = now.getDay()

  const today = text.match(/\s(today)\b/i)
  const tomorrow = text.match(/\s(tomorrow|tmrw)\b/i)
  const nextWeek = text.match(/\s(next week)\b/i)
  const inDays = text.match(/\sin (\d+) days?\b/i)
  const weekday = text.match(
    /\s(?:by |on |next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tue|tues|wed|thu|thur|thurs|fri|sat)\b/i,
  )

  if (today) {
    dueDate = offsetToDate(now, 0)
    text = text.replace(today[0], ' ')
  } else if (tomorrow) {
    dueDate = offsetToDate(now, 1)
    text = text.replace(tomorrow[0], ' ')
  } else if (nextWeek) {
    // The coming Monday. Never today, never zero.
    dueDate = offsetToDate(now, ((8 - todayDow) % 7) || 7)
    text = text.replace(nextWeek[0], ' ')
  } else if (inDays) {
    dueDate = offsetToDate(now, Number.parseInt(inDays[1], 10))
    text = text.replace(inDays[0], ' ')
  } else if (weekday) {
    const prefix = weekday[1].slice(0, 3).toLowerCase()
    const index = DAY_NAMES.findIndex(d => d.startsWith(prefix))
    if (index >= 0) {
      // "friday" on a Friday means next Friday, so a zero offset becomes 7.
      const delta = (index - todayDow + 7) % 7
      dueDate = offsetToDate(now, delta === 0 ? 7 : delta)
      text = text.replace(weekday[0], ' ')
    }
  }

  // 4. Client, in two passes so explicitness beats array order. An @mention
  //    anywhere in the list wins over a bare name from any other client:
  //    with clients [Design, Kowtow], "Design review @Kowtow" is a Kowtow
  //    task, not a Design one with a stray mention left in its title. Only
  //    when nothing was mentioned does a bare name count, and a bare name
  //    stays in the title, because it is usually doing real work there
  //    ("Kowtow redirect map").
  let orgId: string | null = null
  for (const client of clients) {
    const mention = text.match(new RegExp(`\\s@${escapeRegExp(client.name)}\\b`, 'i'))
    if (mention) {
      orgId = client.id
      text = text.replace(mention[0], ' ')
      break
    }
  }
  if (!orgId) {
    for (const client of clients) {
      if (new RegExp(`\\b${escapeRegExp(client.name)}\\b`, 'i').test(text)) {
        orgId = client.id
        break
      }
    }
  }

  return {
    title: text.replace(/\s+/g, ' ').trim(),
    orgId,
    level: orgId ? 'internal_client_task' : 'tahi_internal',
    dueDate,
    priority,
  }
}
