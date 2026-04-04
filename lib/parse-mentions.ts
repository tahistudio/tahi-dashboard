/**
 * lib/parse-mentions.ts
 *
 * Extracts @mention references from Tiptap HTML output.
 * The Tiptap Mention extension renders mentions as:
 *   <span data-type="mention" data-id="<id>" data-label="<name>">@Name</span>
 *
 * This utility parses those elements and returns a deduplicated
 * array of mentioned IDs with their type.
 */

export interface ParsedMention {
  id: string
  type: 'team_member' | 'contact'
}

/**
 * Parse Tiptap HTML for @mention nodes.
 * Returns deduplicated mention entries.
 *
 * The Tiptap Mention extension stores the ID in data-id attribute.
 * We default mentionedType to 'team_member' since the current
 * autocomplete only suggests team members.
 */
export function parseMentions(html: string): ParsedMention[] {
  if (!html) return []

  const mentions: ParsedMention[] = []
  const seen = new Set<string>()

  // Match data-id attributes within mention spans
  // Tiptap outputs: <span data-type="mention" data-id="uuid" ...>
  const regex = /data-type="mention"[^>]*data-id="([^"]+)"/g
  let match: RegExpExecArray | null

  match = regex.exec(html)
  while (match !== null) {
    const id = match[1]
    if (id && !seen.has(id)) {
      seen.add(id)
      mentions.push({ id, type: 'team_member' })
    }
    match = regex.exec(html)
  }

  // Also handle reverse attribute order: data-id before data-type
  const reverseRegex = /data-id="([^"]+)"[^>]*data-type="mention"/g
  match = reverseRegex.exec(html)
  while (match !== null) {
    const id = match[1]
    if (id && !seen.has(id)) {
      seen.add(id)
      mentions.push({ id, type: 'team_member' })
    }
    match = reverseRegex.exec(html)
  }

  return mentions
}
