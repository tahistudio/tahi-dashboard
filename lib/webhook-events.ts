/**
 * Webhook event names are emitted with underscores (request_created, see
 * lib/events.ts). People often type them with dots, so subscriptions are
 * normalised to the emitted form: trimmed, dots to underscores, de-duped.
 * Pure: imported by the API route, the settings UI and fireWebhook.
 */
export function normaliseEvents(events: readonly unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of events) {
    if (typeof e !== 'string') continue
    const name = e.trim().replace(/\./g, '_')
    if (!name || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}
