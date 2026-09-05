/**
 * lib/portal-service-view.ts
 *
 * Turning the studio's thin `services` row into a card a client can read.
 *
 * The table holds name, description, price, currency, isRecurring,
 * recurringInterval, showInCatalog and category. It has no outcome column, no
 * inclusions, no timeline and no org scoping, and none of that can land
 * tonight (no schema change, no migration). So the showcase reads the one
 * free-text field the studio already has and gives it a shape:
 *
 *   the first paragraph            the outcome, the sentence that says what
 *                                  the client ends up with
 *   lines starting - or * or the   what is included
 *   bullet character
 *   a line starting "Timeline:"    the typical timeline
 *
 * Every part is optional and everything degrades: a description with no
 * bullets is simply an outcome, and a service with no description is a name
 * and an ask. Nothing is invented, so a card can never promise something the
 * studio did not write.
 *
 * Delivery mode replaces price on the catalogue. Liam owes the upsell brief,
 * so the card says HOW a thing would be delivered (ongoing, an add on, a top
 * up, or a scoped project) and never what it costs. The only money on the
 * Services page is the client's own plan, which is a fact of their own bill.
 *
 * Pure: it runs in the browser and is unit tested.
 */

/** How a service reaches the client. Derived, never stored. */
export type ServiceDelivery = 'ongoing' | 'addon' | 'topup' | 'project'

export interface ServiceDeliveryCopy {
  label: string
  /** Badge tone token. No component hardcodes a colour. */
  tone: 'brand' | 'info' | 'teal' | 'neutral'
  /** The consequence, repeated under the ask so the CTA cannot overpromise. */
  hint: string
}

export const SERVICE_DELIVERY_COPY: Record<ServiceDelivery, ServiceDeliveryCopy> = {
  ongoing: {
    label: 'Ongoing',
    tone: 'brand',
    hint: 'Runs month to month alongside your plan.',
  },
  addon: {
    label: 'Add on',
    tone: 'info',
    hint: 'Sits alongside your retainer as its own line.',
  },
  topup: {
    label: 'Top up',
    tone: 'teal',
    hint: 'A one off addition to the work already running.',
  },
  project: {
    label: 'Project',
    tone: 'neutral',
    hint: 'Scoped and quoted on its own before anything starts.',
  },
}

/** The `services` columns this view reads. */
export interface ServiceRow {
  id: string
  name: string
  description?: string | null
  category?: string | null
  isRecurring?: number | boolean | null
  recurringInterval?: string | null
}

export interface ServiceCardView {
  id: string
  name: string
  /** The sentence that says what the client ends up with. May be empty. */
  outcome: string
  /** What is included. Empty when the studio wrote no bullets. */
  includes: string[]
  /** Typical timeline. Null when the studio wrote none. */
  timeline: string | null
  delivery: ServiceDelivery
}

const BULLET = /^\s*[-*•]\s+/
const TIMELINE = /^\s*timeline\s*:\s*/i

/**
 * Split a studio description into outcome, inclusions and a timeline.
 *
 * Deliberately forgiving: an unformatted paragraph comes back as the outcome
 * and nothing else, which is exactly what every catalogue row looks like
 * today.
 */
export function parseServiceDescription(description: string | null | undefined): {
  outcome: string
  includes: string[]
  timeline: string | null
} {
  const text = (description ?? '').trim()
  if (!text) return { outcome: '', includes: [], timeline: null }

  const outcome: string[] = []
  const includes: string[] = []
  let timeline: string | null = null

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    if (TIMELINE.test(line)) {
      const value = line.replace(TIMELINE, '').trim()
      if (value && !timeline) timeline = value
      continue
    }
    if (BULLET.test(line)) {
      const value = line.replace(BULLET, '').trim()
      if (value) includes.push(value)
      continue
    }
    // Prose after the bullets have started is a closing note, not a second
    // headline, so it is dropped rather than pushed above the list.
    if (includes.length === 0) outcome.push(line)
  }

  return { outcome: outcome.join(' ').trim(), includes, timeline }
}

/**
 * How this service would be delivered.
 *
 * `category` is the studio's own vocabulary (service | topup | addon) and
 * `isRecurring` says whether it bills every month, so between them the card
 * can be honest about the shape of the commitment without quoting a number.
 */
export function serviceDelivery(service: ServiceRow): ServiceDelivery {
  const category = (service.category ?? '').trim().toLowerCase()
  if (category === 'addon') return 'addon'
  if (category === 'topup') return 'topup'
  const recurring = service.isRecurring === true || service.isRecurring === 1
  return recurring ? 'ongoing' : 'project'
}

/** One catalogue row as the card renders it. */
export function toServiceCard(service: ServiceRow): ServiceCardView {
  const parsed = parseServiceDescription(service.description)
  return {
    id: service.id,
    name: service.name,
    outcome: parsed.outcome,
    includes: parsed.includes,
    timeline: parsed.timeline,
    delivery: serviceDelivery(service),
  }
}

/**
 * The filter chips, built from what is actually in the catalogue.
 *
 * A studio that only sells projects gets no chips at all rather than four
 * that all say the same thing.
 */
export function deliveryFilters(
  cards: readonly ServiceCardView[],
): Array<{ value: ServiceDelivery; label: string }> {
  const order: ServiceDelivery[] = ['ongoing', 'addon', 'topup', 'project']
  const present = new Set(cards.map(c => c.delivery))
  return order
    .filter(key => present.has(key))
    .map(key => ({ value: key, label: SERVICE_DELIVERY_COPY[key].label }))
}
