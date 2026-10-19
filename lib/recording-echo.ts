/**
 * Echo removal for two-track call transcripts.
 *
 * When the person records on desktop speakers, their microphone also hears the
 * remote side. Those words arrive twice: once on the system track (the truth)
 * and once, slightly later and often worded a little differently, on the mic
 * track where they would be labelled as the person. This module removes the mic
 * copy. It is pure and deterministic so every render of a recording gets the
 * same answer, including recordings transcribed before this existed.
 *
 * A mic phrase is only removed where a run of its words repeats a run of system
 * words that were spoken at about the same time. A shared word or two, or the
 * person talking over the remote side with different words, is always kept.
 * Only words that actually matched are removed: a word the person added or
 * changed inside an echoed sentence (for example "not") is never deleted.
 *
 * The filter is gated per recording. A headphone call has almost no bleed, and
 * there a read-back such as "sounds good" right after the remote is genuine
 * speech, so nothing is removed unless MIN_BLEED_RATIO of the mic words match.
 */

export interface EchoLine {
  at: number
  end: number
  track: 'mic' | 'system'
  index: number
  text: string
}

/** Mic words may trail or lead the system words by this much (loopback and Whisper timing drift). */
export const ECHO_WINDOW_MS = 2500
/** A run needs this many matched words with at least MIN_CONTENT_MATCHES non-filler words. */
const MIN_RUN_MATCHES = 3
const MIN_CONTENT_MATCHES = 2
/** A long run is echo whatever its vocabulary. */
const LONG_RUN_MATCHES = 6
/** A short mic line ("That was what was required.") is echo when most of it matches closely in time. */
const SHORT_PHRASE_WORDS = 6
const SHORT_PHRASE_COVERAGE = 0.8
const SHORT_PHRASE_WINDOW_MS = 1500
/** Leftovers of this many words or fewer are dropped once echo has removed most of a line. */
const STUB_WORDS = 2
/** The filter only runs on a recording where more than this share of mic words repeat the system track. */
export const MIN_BLEED_RATIO = 0.15

const NEGATIONS = new Set([
  'not', 'no', 'never', 'nor', 'none', 'nothing', 'cannot', 'cant', 'wont', 'dont', 'doesnt', 'didnt', 'isnt', 'arent',
  'wasnt', 'werent', 'shouldnt', 'couldnt', 'wouldnt', 'havent', 'hasnt', 'hadnt', 'without',
])
/**
 * A negation keeps a scrap only when the scrap still says something (the negation plus at least one other non-filler word).
 * Measured on a real speakers call, lone negations and numbers left behind were always misheard echo.
 */
function carriesMeaning(scrap: string[]): boolean {
  return scrap.some(norm => NEGATIONS.has(norm)) && scrap.filter(norm => NEGATIONS.has(norm) || !FILLER.has(norm)).length >= 2
}

const FILLER = new Set([
  'i', 'a', 'an', 'the', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'it', 'is', 'its', 'are', 'was', 'be',
  'that', 'this', 'we', 'you', 'he', 'she', 'they', 'my', 'your', 'for', 'with', 'as', 'if', 'im', 'ive', 'id', 'ill',
  'thats', 'youre', 'were', 'dont', 'do', 'not', 'no', 'yes', 'yeah', 'yep', 'okay', 'ok', 'um', 'uh', 'hmm', 'mm',
  'like', 'just', 'well', 'right', 'oh', 'have', 'has', 'had', 'can', 'will', 'would', 'there', 'then', 'what', 'me',
])

interface Token {
  norm: string
  time: number
}

function normalise(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  let j = 0
  let edits = 0
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i += 1; j += 1; continue }
    edits += 1
    if (edits > 1) return false
    if (a.length === b.length) { i += 1; j += 1 }
    else if (a.length > b.length) i += 1
    else j += 1
  }
  return edits + (a.length - i) + (b.length - j) <= 1
}

function sameWord(a: string, b: string): boolean {
  if (!a || !b) return false
  if (a === b) return true
  if (a.length >= 4 && b.length >= 4 && Math.abs(a.length - b.length) <= 2 && (a.startsWith(b) || b.startsWith(a))) return true
  return a.length >= 5 && b.length >= 5 && withinOneEdit(a, b)
}

function isContent(norm: string): boolean {
  return norm.length > 0 && !FILLER.has(norm)
}

/** Spread a phrase's span across its words by character share. */
function wordTimes(words: readonly string[], at: number, end: number): number[] {
  const total = words.reduce((sum, word) => sum + word.length + 1, 0)
  let seen = 0
  return words.map(word => {
    const centre = seen + (word.length + 1) / 2
    seen += word.length + 1
    return at + (end - at) * (total > 0 ? centre / total : 0)
  })
}

function systemTokens(lines: readonly EchoLine[]): Token[] {
  const tokens: Token[] = []
  for (const line of lines) {
    const words = line.text.split(/\s+/).filter(Boolean)
    const times = wordTimes(words, line.at, line.end)
    words.forEach((word, position) => {
      const norm = normalise(word)
      if (norm) tokens.push({ norm, time: times[position] })
    })
  }
  return tokens.sort((a, b) => a.time - b.time)
}

function lowerBound(tokens: readonly Token[], time: number): number {
  let low = 0
  let high = tokens.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (tokens[mid].time < time) low = mid + 1
    else high = mid
  }
  return low
}

interface Run { end: number; matched: number; content: number; spread: number; matchedAt: number[] }

/** Grow a run of matching words from (start, first), tolerating a rare single-word difference. */
function growRun(mic: readonly string[], pool: readonly Token[], micTimes: readonly number[], start: number, first: number): Run {
  let mi = start
  let pj = first
  let matched = 1
  let content = isContent(mic[start]) ? 1 : 0
  let errors = 0
  let spread = Math.abs(micTimes[start] - pool[first].time)
  let end = start
  const matchedAt = [start]
  for (;;) {
    if (mi + 1 < mic.length && pj + 1 < pool.length && sameWord(mic[mi + 1], pool[pj + 1].norm)) {
      mi += 1; pj += 1; matched += 1; end = mi
      matchedAt.push(mi)
      if (isContent(mic[mi])) content += 1
      spread = Math.max(spread, Math.abs(micTimes[mi] - pool[pj].time))
      continue
    }
    // One word may differ (substituted, dropped or added) once the run has proved itself.
    if (errors + 1 > Math.floor(matched / 2)) break
    let advanced = false
    for (const [di, dj] of [[2, 2], [2, 1], [1, 2]] as const) {
      const a = mi + di
      const b = pj + dj
      if (a < mic.length && b < pool.length && sameWord(mic[a], pool[b].norm)) {
        mi = a; pj = b; matched += 1; errors += 1; end = a
        matchedAt.push(a)
        if (isContent(mic[a])) content += 1
        spread = Math.max(spread, Math.abs(micTimes[a] - pool[b].time))
        advanced = true
        break
      }
    }
    if (!advanced) break
  }
  return { end, matched, content, spread, matchedAt }
}

function qualifies(run: Run, wordCount: number): boolean {
  if (run.matched >= LONG_RUN_MATCHES) return true
  if (run.matched >= MIN_RUN_MATCHES && run.content >= MIN_CONTENT_MATCHES) return true
  return wordCount <= SHORT_PHRASE_WORDS && run.matched >= Math.ceil(wordCount * SHORT_PHRASE_COVERAGE)
    && run.content >= 1 && run.spread <= SHORT_PHRASE_WINDOW_MS
}

/** Words of one mic line that repeat the system track, as parallel flags to its whitespace split. */
function echoFlags(line: EchoLine, system: readonly Token[]): { words: string[]; removed: boolean[]; spoken: number; matched: number } | null {
  const words = line.text.split(/\s+/).filter(Boolean)
  const norms = words.map(normalise)
  const spoken = norms.map((norm, position) => ({ norm, position })).filter(item => item.norm)
  if (!spoken.length || !system.length) return null
  const mic = spoken.map(item => item.norm)
  const times = wordTimes(words, line.at, line.end)
  const micTimes = spoken.map(item => times[item.position])
  const from = lowerBound(system, line.at - ECHO_WINDOW_MS)
  const to = lowerBound(system, line.end + ECHO_WINDOW_MS + 1)
  const pool = system.slice(from, to)
  if (!pool.length) return null

  const removedSpoken = new Array<boolean>(mic.length).fill(false)
  let matchedWords = 0
  let position = 0
  while (position < mic.length) {
    let best: Run | null = null
    for (let candidate = 0; candidate < pool.length; candidate += 1) {
      if (!sameWord(mic[position], pool[candidate].norm)) continue
      const run = growRun(mic, pool, micTimes, position, candidate)
      // Every matched word must sit within the window of its system word, however long the line is.
      if (run.spread > ECHO_WINDOW_MS * 2) continue
      if (!best || run.matched > best.matched) best = run
    }
    if (best && qualifies(best, mic.length)) {
      // Only matched words go; a word the person changed or added inside the run stays.
      for (const index of best.matchedAt) { removedSpoken[index] = true; matchedWords += 1 }
      position = best.end + 1
    } else position += 1
  }
  if (!matchedWords) return null

  // When echo took most of the line, scraps of two words or fewer (or filler only) are noise,
  // unless a negation still carries meaning.
  if (matchedWords * 2 >= mic.length) {
    let from = 0
    while (from < mic.length) {
      if (removedSpoken[from]) { from += 1; continue }
      let to = from
      while (to < mic.length && !removedSpoken[to]) to += 1
      const scrap = mic.slice(from, to)
      if ((scrap.length <= STUB_WORDS || scrap.every(norm => FILLER.has(norm))) && !carriesMeaning(scrap)) {
        for (let i = from; i < to; i += 1) removedSpoken[i] = true
      }
      from = to
    }
  }

  const removed = new Array<boolean>(words.length).fill(false)
  spoken.forEach((item, index) => { removed[item.position] = removedSpoken[index] })
  // Punctuation-only tokens follow the word before them (or the one after, at the start).
  for (let i = 0; i < words.length; i += 1) {
    if (norms[i]) continue
    removed[i] = i > 0 ? removed[i - 1] : (removed[i + 1] ?? false)
  }
  return { words, removed, spoken: mic.length, matched: matchedWords }
}

/** Drop or trim mic lines that echo the system track. Other lines are returned unchanged. */
export function removeMicEcho<T extends EchoLine>(lines: readonly T[]): T[] {
  const system = systemTokens(lines.filter(line => line.track === 'system'))
  if (!system.length) return [...lines]
  const analysed = new Map<T, ReturnType<typeof echoFlags>>()
  let micWords = 0
  let matchedWords = 0
  for (const line of lines) {
    if (line.track !== 'mic') continue
    const flags = echoFlags(line, system)
    analysed.set(line, flags)
    micWords += flags?.spoken ?? line.text.split(/\s+/).filter(word => normalise(word)).length
    matchedWords += flags?.matched ?? 0
  }
  // No real bleed on this recording (headphones): leave every mic line alone.
  if (!micWords || matchedWords / micWords <= MIN_BLEED_RATIO) return [...lines]
  const result: T[] = []
  for (const line of lines) {
    if (line.track !== 'mic') { result.push(line); continue }
    const flags = analysed.get(line)
    if (!flags) { result.push(line); continue }
    const span = line.end - line.at
    const total = flags.words.reduce((sum, word) => sum + word.length + 1, 0)
    let offset = 0
    const starts = flags.words.map(word => { const value = offset; offset += word.length + 1; return value })
    let piece = 0
    let first = -1
    const flush = (last: number) => {
      if (first < 0) return
      const words = flags.words.slice(first, last + 1)
      const wordEnd = starts[last] + flags.words[last].length + 1
      result.push({
        ...line,
        at: Math.round(line.at + span * (starts[first] / total)),
        end: Math.round(line.at + span * (wordEnd / total)),
        index: line.index + piece / 1000,
        text: words.join(' '),
      })
      piece += 1
      first = -1
    }
    flags.words.forEach((_, i) => {
      if (flags.removed[i]) flush(i - 1)
      else if (first < 0) first = i
    })
    flush(flags.words.length - 1)
  }
  return result
}
