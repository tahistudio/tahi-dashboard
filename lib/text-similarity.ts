/**
 * lib/text-similarity.ts
 *
 * "Do we already have this?", as a number.
 *
 * The duplicate guard on call suggestions (CN.1d) needs to recognise one
 * piece of work described twice in two different months by two different
 * people. Exact matching cannot: a dedupe key catches the same transcript
 * read twice, and nothing else. "Add LinkedIn insight tag to global footer"
 * and "LinkedIn Insight Tag in the footer" share no key, no id and no exact
 * string, and they are the same request.
 *
 * TWO MEASURES, AVERAGED, because each one alone is wrong in a way the other
 * is not. Token-set Jaccard sees the words and is blind to their order, which
 * is what makes a reworded title match, but it scores two short titles
 * sharing one common word far too high. Character-trigram Dice sees the
 * spelling and holds up on plurals, tenses and a word split in two, but it
 * also scores any two English sentences somewhat alike. The mean of the two
 * is high only when the words AND the spelling agree.
 *
 * PURE AND CLIENT SAFE. No database, no Next, no imports at all: the inbox
 * component renders the same number the server computed, and the test suite
 * can exercise the judgement without a fixture.
 */

/** At or above this, the inbox warns the human. */
export const SIMILAR_WARN = 0.5

/** At or above this, an approve is refused unless it carries force. */
export const SIMILAR_BLOCK = 0.8

/** Never hand back more than this many matches, however many scored. */
export const MAX_SIMILAR = 5

/**
 * The words that carry no meaning in a work title.
 *
 * Articles and prepositions are the obvious half. The other half is the
 * vocabulary every second title in this dashboard already has: "update",
 * "new", "add", "fix", "page", "site", "website". Left in, they make any two
 * requests look half alike, which is exactly the false positive that trains a
 * founder to press Approve without reading.
 */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'on', 'in', 'with',
  'page', 'site', 'website', 'update', 'new', 'add', 'fix',
])

/**
 * Lower case, punctuation and markdown gone, whitespace collapsed.
 *
 * One pass over everything that is not a letter, a digit or a space covers
 * the markdown a pasted proposal arrives wrapped in (asterisks, backticks,
 * brackets, hashes) and ordinary punctuation together, because for this
 * purpose they are the same thing: noise between words.
 */
function stripped(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The comparable form of a title: stripped, with the stopwords dropped. */
export function normaliseTitle(text: string): string {
  return stripped(text)
    .split(' ')
    .filter(word => word.length > 0 && !STOPWORDS.has(word))
    .join(' ')
}

function tokens(text: string): Set<string> {
  return new Set(text.length > 0 ? text.split(' ') : [])
}

function trigrams(text: string): Set<string> {
  const out = new Set<string>()
  for (let index = 0; index + 3 <= text.length; index++) out.add(text.slice(index, index + 3))
  return out
}

function overlap(a: Set<string>, b: Set<string>): number {
  let shared = 0
  for (const value of a) if (b.has(value)) shared++
  return shared
}

/** Shared over total. 0 when either side is empty. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  const shared = overlap(a, b)
  return shared / (a.size + b.size - shared)
}

/** Twice the shared over the sum. 0 when either side is empty. */
function dice(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  return (2 * overlap(a, b)) / (a.size + b.size)
}

/** Four decimal places, so a score is stable across a JSON round trip. */
function round(value: number): number {
  return Math.round(value * 10_000) / 10_000
}

/**
 * How alike two titles are, 0 to 1. Identical titles score exactly 1.
 *
 * THE STOPWORD FALLBACK is the subtle part. "Update the website page" and
 * "Fix the site" both normalise to the empty string, and two empty strings
 * are trivially identical, which would be a perfect score for two unrelated
 * titles. So when either side loses everything to the stopword list, both
 * sides are compared in their stripped form instead, where "update website"
 * and "fix site" are correctly far apart.
 */
export function similarityScore(a: string, b: string): number {
  const normalisedA = normaliseTitle(a)
  const normalisedB = normaliseTitle(b)
  const both = normalisedA.length > 0 && normalisedB.length > 0
  const left = both ? normalisedA : stripped(a)
  const right = both ? normalisedB : stripped(b)

  if (left.length === 0 || right.length === 0) return 0
  if (left === right) return 1

  return round((jaccard(tokens(left), tokens(right)) + dice(trigrams(left), trigrams(right))) / 2)
}

/** Anything with an id and a title can be matched against. */
export interface SimilarityCandidate {
  id: string
  title: string
}

/**
 * The candidates a title is close to, best first, at most five.
 *
 * The candidate is carried through rather than reduced to an id, so a caller
 * can put the number, the status and the kind it already knows straight onto
 * the line it renders without a second lookup.
 */
export function findSimilar<T extends SimilarityCandidate>(
  title: string,
  candidates: readonly T[],
  threshold: number = SIMILAR_WARN,
): Array<T & { score: number }> {
  if (normaliseTitle(title).length === 0 && stripped(title).length === 0) return []

  return candidates
    .map(candidate => ({ ...candidate, score: similarityScore(title, candidate.title) }))
    .filter(candidate => candidate.score >= threshold)
    // Ties broken on the id, so the same inputs always produce the same order
    // rather than whatever the source query happened to return.
    .sort((first, second) => (second.score - first.score) || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0))
    .slice(0, MAX_SIMILAR)
}
