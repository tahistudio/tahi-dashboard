/**
 * lib/parse-mentions.ts
 *
 * Extract @mention references from message HTML.
 *
 * The composer (components/tahi/composer.tsx) renders mention chips as:
 *   <span class="tahi-mention"
 *         data-mention-type="person|org|request|task"
 *         data-mention-id="<id>"
 *         data-internal-only="true"?>@Name</span>
 *
 * For notification purposes we only care about person mentions — those
 * are the ones tied to a real user (team_member or contact). Org /
 * request / task mentions are entity references, not user pings.
 *
 * Older code paths emitted Tiptap's default Mention shape:
 *   <span data-type="mention" data-id="<id>" ...>
 * We still parse those for backwards compatibility but flag them as
 * team_member since the legacy autocomplete only suggested team members.
 */

export interface ParsedMention {
  id: string
  /** team_member | contact — what notifications need to route the ping.
   *  The composer doesn't know which table the id lives in, so callers
   *  resolve it (typically by trying team_members first, then contacts). */
  type: 'team_member' | 'contact'
}

export function parseMentions(html: string): ParsedMention[] {
  if (!html) return []

  const out: ParsedMention[] = []
  const seen = new Set<string>()

  const push = (id: string | undefined) => {
    if (!id || seen.has(id)) return
    seen.add(id)
    out.push({ id, type: 'team_member' })
  }

  // New composer shape. We restrict to data-mention-type="person" so
  // org / request / task references don't trigger user pings.
  const personRe = /<span[^>]*\bdata-mention-type="person"[^>]*\bdata-mention-id="([^"]+)"[^>]*>/gi
  let m: RegExpExecArray | null
  while ((m = personRe.exec(html)) !== null) push(m[1])

  // Same attributes in reverse order.
  const personReReverse = /<span[^>]*\bdata-mention-id="([^"]+)"[^>]*\bdata-mention-type="person"[^>]*>/gi
  while ((m = personReReverse.exec(html)) !== null) push(m[1])

  // Legacy Tiptap default Mention shape (kept for old data).
  const legacy = /<span[^>]*\bdata-type="mention"[^>]*\bdata-id="([^"]+)"[^>]*>/gi
  while ((m = legacy.exec(html)) !== null) push(m[1])

  const legacyReverse = /<span[^>]*\bdata-id="([^"]+)"[^>]*\bdata-type="mention"[^>]*>/gi
  while ((m = legacyReverse.exec(html)) !== null) push(m[1])

  return out
}
