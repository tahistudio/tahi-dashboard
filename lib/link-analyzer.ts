/**
 * Internal link analyzer — Phase I · Slice 6.
 *
 * Pure function. Given a "new" blog post that needs inbound links and a
 * pool of "old" candidate posts, find phrases in the old bodies that
 * could naturally be anchored into a link to the new post.
 *
 * No DB, no fetch, no IO. Callers (the scan API route + cron) assemble
 * the input and persist the output to `link_suggestions`.
 *
 * Algorithm (see WORKFLOWS.md Phase I Slice 6 spec):
 *   1. For each old post body:
 *      - Skip if its webflowId is already in existingInboundLinkSources.
 *      - Plaintext from bodyHtml (strip tags).
 *      - For each candidate phrase (topics + keywords + title variants
 *        + lowercased + simple plural), find ALL occurrences in the body
 *        case-insensitively.
 *      - Skip occurrences where the immediate surrounding 30 chars
 *        already contain a `<a ` (don't double-link).
 *      - Capture matchPhrase + contextBefore (last 100 chars before) +
 *        contextAfter (next 100 chars after).
 *      - Score confidence with the bonuses / penalties from the spec.
 *   2. Cap at 2 suggestions per old source (don't over-link one page).
 *   3. Cap at 8 total suggestions per target post (sweet spot for the
 *      first-week link velocity Google wants for fresh content).
 *   4. Sort by confidence desc.
 */

export interface LinkAnalyzeInput {
  /** The new post that needs inbound links. */
  newPost: {
    url: string
    title: string
    publishedAt: string
    topics: string[]
    keywords: string[]
    /** Optional — used to apply the same-cluster confidence bonus. */
    clusterSlug?: string | null
  }
  /** The candidate "old" posts to scan. */
  oldPosts: Array<{
    webflowId: string
    url: string
    title: string
    bodyHtml: string
    /** ISO publish timestamp — drives the fresh-content penalty. */
    publishedAt?: string | null
    /** Optional cluster slug — drives the same-cluster bonus. */
    clusterSlug?: string | null
  }>
  /**
   * webflowIds of posts that ALREADY link to newPost.url. Skipped to avoid
   * double-linking and to surface only fresh patches.
   */
  existingInboundLinkSources: Set<string>
}

export interface LinkSuggestion {
  sourceWebflowId: string
  sourceUrl: string
  sourceTitle: string
  matchPhrase: string
  contextBefore: string
  contextAfter: string
  proposedAnchorText: string
  justification: string
  /** 0-100 */
  confidence: number
}

// ── helpers ────────────────────────────────────────────────────────────────

/** Strip HTML tags down to plaintext, collapsing whitespace runs. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

/** Lowercase-collapse for case-insensitive comparison. */
function norm(s: string): string {
  return s.toLowerCase().trim()
}

/** Simple plural variant of a phrase — cheap heuristic, no library. */
function pluralOf(phrase: string): string | null {
  const trimmed = phrase.trim()
  if (trimmed.length < 3) return null
  if (/s$/i.test(trimmed)) return null
  if (/(ch|sh|x|z)$/i.test(trimmed)) return `${trimmed}es`
  if (/[^aeiou]y$/i.test(trimmed)) return `${trimmed.slice(0, -1)}ies`
  return `${trimmed}s`
}

/**
 * Detect whether the 30 chars around position `idx` in `body` already
 * contain part of an anchor tag. We look at a 60-char window centred on
 * the match to avoid splicing into existing `<a>` markup.
 */
function inAnchorContext(body: string, idx: number, len: number): boolean {
  const start = Math.max(0, idx - 30)
  const end = Math.min(body.length, idx + len + 30)
  const window = body.slice(start, end)
  if (window.includes('<a ') || window.includes('</a>')) return true
  // Also catch the case where the phrase sits inside a wider anchor —
  // look backward for the nearest `<a ` and forward for the nearest
  // `</a>` and check whether they bracket the match.
  const before = body.lastIndexOf('<a ', idx)
  const after = body.indexOf('</a>', idx + len)
  if (before === -1 || after === -1) return false
  const closeBetween = body.indexOf('</a>', before)
  return closeBetween > idx
}

/** Find the H2 / H3 headings in a markdown OR html body. */
function headingPositions(plain: string, html: string): Set<string> {
  const headings = new Set<string>()
  // Markdown-style H2/H3
  const mdMatches = plain.match(/(^|\n)(##+\s+[^\n]+)/g) ?? []
  for (const m of mdMatches) {
    const text = m.replace(/^[\s#]+/, '').trim().toLowerCase()
    if (text) headings.add(text)
  }
  // HTML-style h2/h3
  const htmlRe = /<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi
  let match: RegExpExecArray | null
  while ((match = htmlRe.exec(html)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase()
    if (text) headings.add(text)
  }
  return headings
}

/** Days between an ISO timestamp and now. Returns Infinity for invalid. */
function daysSince(iso: string | null | undefined): number {
  if (!iso) return Infinity
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return Infinity
  return (Date.now() - t) / 86_400_000
}

// ── main entry ────────────────────────────────────────────────────────────

/** Cap on number of suggestions per old source post. */
const PER_SOURCE_CAP = 2

/** Cap on total suggestions per target post. */
const PER_TARGET_CAP = 8

/** Context window length (chars before / after the match). */
const CONTEXT_LEN = 100

/** Confidence floor — below this, drop the suggestion entirely. */
const MIN_CONFIDENCE = 25

export function analyseLinkOpportunities(input: LinkAnalyzeInput): LinkSuggestion[] {
  const { newPost, oldPosts, existingInboundLinkSources } = input

  // Build the candidate phrase list: topics + keywords + variants.
  // We carry whether the phrase counts as the "exact target keyword" for
  // the +30 bonus — the first keyword wins that bonus.
  const exactKeyword = newPost.keywords[0]?.trim() ?? ''
  const phraseSet = new Map<string, { phrase: string; isExactKeyword: boolean }>()

  function addPhrase(p: string, isExactKeyword = false) {
    const trimmed = p.trim()
    if (trimmed.length < 4) return                    // too short — noise
    const key = norm(trimmed)
    if (phraseSet.has(key)) return
    phraseSet.set(key, { phrase: trimmed, isExactKeyword })
  }

  for (const k of newPost.keywords) addPhrase(k, norm(k) === norm(exactKeyword))
  for (const t of newPost.topics) addPhrase(t)
  if (newPost.title) addPhrase(newPost.title)

  // Variants — title lowercased + plural of each phrase. Iterate over a
  // snapshot so we don't add variants of variants.
  const original = Array.from(phraseSet.values())
  for (const { phrase } of original) {
    const plural = pluralOf(phrase)
    if (plural) addPhrase(plural)
  }

  const phrases = Array.from(phraseSet.values())
  if (phrases.length === 0) return []

  // Build all candidate suggestions.
  const all: LinkSuggestion[] = []

  for (const source of oldPosts) {
    // Skip self-link.
    if (source.url === newPost.url) continue
    // Skip if this source already inbound-links to the target.
    if (existingInboundLinkSources.has(source.webflowId)) continue

    const html = source.bodyHtml ?? ''
    if (!html) continue
    const plain = stripHtml(html)
    if (!plain) continue
    const plainLower = plain.toLowerCase()
    const headings = headingPositions(plain, html)
    const sourceAgeDays = daysSince(source.publishedAt ?? null)
    const sameCluster = !!(
      newPost.clusterSlug &&
      source.clusterSlug &&
      newPost.clusterSlug === source.clusterSlug
    )

    // Per-source picks before the cap.
    const sourceCandidates: LinkSuggestion[] = []

    for (const { phrase, isExactKeyword } of phrases) {
      const needle = norm(phrase)
      let cursor = 0
      // Walk every occurrence. Cap to a few per phrase per source to
      // avoid runaway loops on huge bodies with very common terms.
      let perPhraseHits = 0
      while (perPhraseHits < 5) {
        const idx = plainLower.indexOf(needle, cursor)
        if (idx === -1) break
        cursor = idx + needle.length
        perPhraseHits++

        // Anchor context check on the original (HTML) body, not plain.
        // We map the plain offset back to the HTML offset by searching
        // for the exact match phrase; if not found in HTML (rare — e.g.
        // entity-encoded), we fall back to checking plain.
        const matched = plain.slice(idx, idx + phrase.length)
        const htmlIdx = html.toLowerCase().indexOf(needle)
        const checkIdx = htmlIdx !== -1 ? htmlIdx : idx
        const checkSource = htmlIdx !== -1 ? html : plain
        if (inAnchorContext(checkSource, checkIdx, phrase.length)) continue

        // Capture surrounding plaintext context. Bounded slice on plain.
        const before = plain.slice(Math.max(0, idx - CONTEXT_LEN), idx)
        const after = plain.slice(idx + phrase.length, idx + phrase.length + CONTEXT_LEN)

        // Score.
        let score = 40                                      // base
        if (isExactKeyword) score += 30
        if (headings.has(needle)) score += 20
        if (phrase.split(/\s+/).length > 1) score += 15
        if (sameCluster) score += 10
        if (sourceAgeDays < 30) score -= 20
        if (score < 0) score = 0
        if (score > 100) score = 100
        if (score < MIN_CONFIDENCE) continue

        // Justification line — short, surfaces in the UI under the diff.
        const reasons: string[] = []
        if (isExactKeyword) reasons.push('exact target keyword')
        if (headings.has(needle)) reasons.push('matches a heading')
        if (phrase.split(/\s+/).length > 1) reasons.push('multi-word phrase')
        if (sameCluster) reasons.push('same topical cluster')
        if (sourceAgeDays < 30) reasons.push('source is fresh (penalty)')
        const justification = reasons.length > 0
          ? `${reasons.join(' · ')}.`
          : 'phrase match in body.'

        sourceCandidates.push({
          sourceWebflowId: source.webflowId,
          sourceUrl: source.url,
          sourceTitle: source.title,
          matchPhrase: matched,
          contextBefore: before,
          contextAfter: after,
          proposedAnchorText: matched,
          justification,
          confidence: score,
        })
      }
    }

    // Per-source cap. Keep the highest-confidence picks.
    sourceCandidates.sort((a, b) => b.confidence - a.confidence)
    all.push(...sourceCandidates.slice(0, PER_SOURCE_CAP))
  }

  // Final cap + sort. Highest confidence first across the whole slate.
  all.sort((a, b) => b.confidence - a.confidence)
  return all.slice(0, PER_TARGET_CAP)
}

// ── apply helpers ─────────────────────────────────────────────────────────

/**
 * Verify a suggestion's match phrase + surrounding context still exist
 * in the current source body, and return the offset of the match if so.
 *
 * Returns null when the body has drifted (the apply route uses that
 * signal to return 409).
 *
 * We are intentionally strict here: the body must contain the matchPhrase
 * preceded by the last N chars of contextBefore (whitespace-collapsed)
 * and followed by the first N chars of contextAfter. Loose matching
 * would risk splicing in the wrong place after Liam edits a paragraph.
 */
export function locateSuggestionInBody(
  bodyHtml: string,
  matchPhrase: string,
  contextBefore: string | null,
  contextAfter: string | null,
): { htmlIndex: number; matchedText: string } | null {
  if (!bodyHtml || !matchPhrase) return null

  // Tail of contextBefore + matchPhrase + head of contextAfter, all
  // normalised to single-space whitespace. Then check whether the
  // plaintext of the body (also whitespace-collapsed) contains that
  // composite. If yes, we know the spot exists — then we re-find the
  // matchPhrase in the raw HTML body using anchor-aware lookup.
  const collapse = (s: string) => s.replace(/\s+/g, ' ').trim()
  const beforeTail = collapse(contextBefore ?? '').slice(-30)
  const afterHead = collapse(contextAfter ?? '').slice(0, 30)
  const composite = collapse(`${beforeTail} ${matchPhrase} ${afterHead}`)

  const plain = collapse(bodyHtml.replace(/<[^>]+>/g, ' '))
  if (!plain.toLowerCase().includes(composite.toLowerCase())) return null

  // Find the phrase in the raw HTML, skipping any occurrence that sits
  // inside an existing <a> tag.
  const lower = bodyHtml.toLowerCase()
  const needle = matchPhrase.toLowerCase()
  let cursor = 0
  while (true) {
    const idx = lower.indexOf(needle, cursor)
    if (idx === -1) return null
    cursor = idx + needle.length
    if (!inAnchorContext(bodyHtml, idx, matchPhrase.length)) {
      return { htmlIndex: idx, matchedText: bodyHtml.slice(idx, idx + matchPhrase.length) }
    }
  }
}

/**
 * Splice an `<a href="...">anchor</a>` into the body at htmlIndex,
 * replacing the original phrase. Returns the patched body.
 */
export function spliceAnchor(
  bodyHtml: string,
  htmlIndex: number,
  matchedText: string,
  targetUrl: string,
  anchorText: string,
): string {
  const escapedUrl = targetUrl.replace(/"/g, '&quot;')
  const safeAnchor = (anchorText || matchedText).replace(/<\/?[^>]+>/g, '')
  const replacement = `<a href="${escapedUrl}">${safeAnchor}</a>`
  return (
    bodyHtml.slice(0, htmlIndex) +
    replacement +
    bodyHtml.slice(htmlIndex + matchedText.length)
  )
}

/**
 * Count inbound internal links from a body to a given target URL.
 * Used by the scan route to populate existingInboundLinkSources.
 */
export function bodyLinksTo(bodyHtml: string, targetUrl: string): boolean {
  if (!bodyHtml || !targetUrl) return false
  // Match href="..." with the target URL, allowing for trailing slash
  // variance and protocol-relative forms.
  const variants = [targetUrl]
  if (targetUrl.endsWith('/')) variants.push(targetUrl.slice(0, -1))
  else variants.push(`${targetUrl}/`)
  const lower = bodyHtml.toLowerCase()
  return variants.some(v => {
    const needle = `href="${v.toLowerCase()}"`
    if (lower.includes(needle)) return true
    const needleSingle = `href='${v.toLowerCase()}'`
    return lower.includes(needleSingle)
  })
}

// ── topic / keyword extraction from a target post ─────────────────────────

/**
 * Best-effort topic + keyword extraction from a target post's title +
 * body. Cheap, deterministic, used by the scan route when the caller
 * doesn't supply explicit topics/keywords (most cases — we work off the
 * Webflow post directly).
 *
 * Returns up to 8 candidate phrases, ordered by signal strength:
 *   1. The post title (highest priority, gets the +30 bonus)
 *   2. Each H2 heading
 *   3. The longest noun-phrase-ish bigrams/trigrams from the first 1k
 *      chars of the plaintext body (very rough — good enough for v1).
 */
export function extractTargetPhrases(input: {
  title: string
  bodyHtml: string
  metaTitle?: string | null
  metaDescription?: string | null
}): { topics: string[]; keywords: string[] } {
  const { title, bodyHtml, metaTitle, metaDescription } = input
  const keywords: string[] = []
  const topics: string[] = []

  if (title) keywords.push(title.trim())
  if (metaTitle && norm(metaTitle) !== norm(title)) keywords.push(metaTitle.trim())

  // H2 headings as topics.
  const headingRe = /<h2[^>]*>([\s\S]*?)<\/h2>/gi
  let match: RegExpExecArray | null
  while ((match = headingRe.exec(bodyHtml)) !== null) {
    const text = match[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    if (text && text.length > 4 && text.length < 80) topics.push(text)
    if (topics.length >= 6) break
  }

  // Meta description as a soft topic source. We use the first noun-ish
  // chunk before the first dot.
  if (metaDescription) {
    const firstSentence = metaDescription.split(/[.!?]/)[0].trim()
    if (firstSentence && firstSentence.length > 8 && firstSentence.length < 80) {
      topics.push(firstSentence)
    }
  }

  return { topics, keywords }
}
