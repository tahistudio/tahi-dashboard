/** Deterministic enrichment of Slack proposals. No model calls or item writes. */
import { asRecord } from '@/lib/suggestion-summary'

export interface OrgNameOption {
  id: string
  name: string
  aliases?: readonly string[]
  contactNames?: readonly string[]
}

export interface SlackClientChoice {
  id: string
  name: string
}

/** Leaves room for the proposal and controls inside Slack's 50-block limit. */
export const MAX_CLIENT_CHOICES = 20

function normalise(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Existing CRM custom fields may hold aliases; arbitrary values are not names. */
export function orgAliases(customFields: unknown, brands: unknown): string[] {
  const fields = asRecord(customFields)
  const aliases: string[] = []
  for (const key of ['alias', 'aliases', 'shortName', 'short_name', 'tradingName', 'trading_name']) {
    const value = fields[key]
    if (typeof value === 'string') aliases.push(value)
    if (Array.isArray(value)) aliases.push(...value.filter((item): item is string => typeof item === 'string'))
  }
  let names: unknown = brands
  if (typeof names === 'string') {
    try { names = JSON.parse(names) as unknown } catch { names = [] }
  }
  if (Array.isArray(names)) aliases.push(...names.filter((item): item is string => typeof item === 'string'))
  return aliases.map(name => name.trim()).filter(Boolean)
}

/** Names match whole words. A contained name loses only to an explicit longer mention. */
export function matchOrgsFromText(text: string, orgs: readonly OrgNameOption[]): SlackClientChoice[] {
  const haystack = ` ${normalise(text)} `
  const mentions = orgs.flatMap(org => {
    const [legalName, tradingName] = org.name.split(/\btrading\s+as\s+/i).map(part => part.trim())
    const contactNames = (org.contactNames ?? []).filter(name => normalise(name).split(' ').length >= 2)
    const names = [org.name, legalName, tradingName, ...(org.aliases ?? []), ...contactNames]
      .filter((name): name is string => typeof name === 'string')
      .map(normalise).filter(name => name.length >= 2)
    return [...new Set(names)].flatMap(name => {
      const spans: Array<{ org: OrgNameOption; name: string; start: number; end: number }> = []
      let start = haystack.indexOf(` ${name} `)
      while (start >= 0) {
        spans.push({ org, name, start: start + 1, end: start + 1 + name.length })
        start = haystack.indexOf(` ${name} `, start + 1)
      }
      return spans
    })
  })
  const explicit = mentions.filter(mention => !mentions.some(other => (
    other.name !== mention.name && other.start <= mention.start && other.end >= mention.end
  )))
  const choices = new Map<string, SlackClientChoice>()
  for (const { org } of explicit) choices.set(org.id, { id: org.id, name: org.name })
  return [...choices.values()]
}

/** Server-derived candidate metadata, kept in proposal JSON so no schema is needed. */
export function clientChoicesFromProposal(proposal: unknown): SlackClientChoice[] {
  const value = asRecord(proposal).slackClientChoices
  if (!Array.isArray(value)) return []
  const choices = new Map<string, SlackClientChoice>()
  for (const entry of value) {
    const item = asRecord(entry)
    if (typeof item.id !== 'string' || !item.id || typeof item.name !== 'string' || !item.name.trim()) continue
    choices.set(item.id, { id: item.id, name: item.name })
  }
  return [...choices.values()]
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const RELATIVE_DATE = /\b(?:(?:by|on|due)\s+)?(?:tomorrow|today|next\s+week|(?:the\s+)?end\s+of\s+(?:the\s+)?month|(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi

export function studioDate(at: Date): string {
  const parts = new Intl.DateTimeFormat('en-NZ', {
    timeZone: 'Pacific/Auckland', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)
  const part = (type: string): string => parts.find(value => value.type === type)?.value ?? ''
  return `${part('year')}-${part('month')}-${part('day')}`
}

/** Calendar arithmetic on date-only values avoids DST or the worker's timezone. */
export function relativeDueDate(text: string, at: Date): string | null {
  const matches = text.match(RELATIVE_DATE) ?? []
  const dates = new Set<string>()
  for (const match of matches) {
    const phrase = match.toLowerCase().replace(/\s+/g, ' ').replace(/^(?:by|on|due)\s+/, '')
    const day = new Date(`${studioDate(at)}T00:00:00Z`)
    if (phrase === 'tomorrow') day.setUTCDate(day.getUTCDate() + 1)
    else if (phrase === 'next week') day.setUTCDate(day.getUTCDate() + ((8 - day.getUTCDay()) % 7 || 7))
    else if (/end\s+of\s+(?:the\s+)?month/.test(phrase)) day.setUTCMonth(day.getUTCMonth() + 1, 0)
    else if (phrase !== 'today') {
      const weekday = WEEKDAYS.indexOf(phrase.replace(/^next\s+/, ''))
      if (weekday < 0) continue
      let offset = (weekday - day.getUTCDay() + 7) % 7
      // The studio week starts on Monday. "Next" always means next week's day.
      const currentWeekday = (day.getUTCDay() + 6) % 7
      const targetWeekday = (weekday + 6) % 7
      if (phrase.startsWith('next ') && targetWeekday >= currentWeekday) offset += 7
      day.setUTCDate(day.getUTCDate() + offset)
    }
    dates.add(day.toISOString().slice(0, 10))
  }
  // Two conflicting dates in one quote need human clarification.
  return dates.size === 1 ? [...dates][0] : null
}

const FILLER_WORDS = new Set(['a', 'an', 'the', 'their', 'our', 'my', 'your', 'its', 'please', 'to', 'for', 'me', 'task'])

function contentWords(text: string): string[] {
  return normalise(text.replace(RELATIVE_DATE, '')).split(' ').filter(word => word && !FILLER_WORDS.has(word))
}

/** Remove repeated opening sentences while preserving details beyond the title. */
export function descriptionBeyondTitle(title: string, description: unknown): string {
  if (typeof description !== 'string') return ''
  const titleWords = contentWords(title)
  if (titleWords.length === 0) return description.trim()
  const titleSet = new Set(titleWords)
  return description.trim().split(/(?<=[.!?])\s+|\n+/).flatMap(sentence => {
    const words = contentWords(sentence)
    if (words.length > 0 && words.every(word => titleSet.has(word))) return []
    // A literal title followed by additional detail can be kept as just the detail.
    if (sentence.toLowerCase().startsWith(title.trim().toLowerCase())) {
      const tail = sentence.slice(title.trim().length).replace(/^[\s:,.\-]+/, '').trim()
      return tail ? [tail] : []
    }
    return sentence.trim() ? [sentence.trim()] : []
  }).join(' ')
}

export function enrichNoteProposal(input: {
  kind: string
  proposal: unknown
  quote: string
  /** Whole note only when it proposed one item, otherwise this item's quote. */
  dueDateText?: string
  at: Date
  orgId: string | null
  choices: readonly SlackClientChoice[]
}): Record<string, unknown> {
  const proposal = { ...asRecord(input.proposal) }
  // The model never chooses a client, a candidate list, or a resolved selection.
  delete proposal.slackClientChoices
  delete proposal.slackClientSelectedId
  const dueDateText = input.dueDateText ?? input.quote
  const dueDate = relativeDueDate(dueDateText, input.at)
  const hasRelativeDate = (dueDateText.match(RELATIVE_DATE) ?? []).length > 0
  if (input.kind === 'update_task' || input.kind === 'update_request') {
    const fields = { ...asRecord(proposal.fields) }
    if (dueDate) fields.dueDate = dueDate
    else if (hasRelativeDate) delete fields.dueDate
    proposal.fields = fields
    return proposal
  }
  if (input.kind !== 'create_task' && input.kind !== 'create_request') return proposal
  proposal.orgId = input.orgId
  if (input.kind === 'create_task') {
    if (!input.orgId) proposal.type = 'tahi_internal'
    else if (proposal.type !== 'client_task') proposal.type = 'internal_client_task'
  }
  if (!input.orgId && input.choices.length > 0) proposal.slackClientChoices = [...input.choices]
  if (dueDate) proposal.dueDate = dueDate
  else if (hasRelativeDate) delete proposal.dueDate
  proposal.description = descriptionBeyondTitle(typeof proposal.title === 'string' ? proposal.title : '', proposal.description)
  return proposal
}
