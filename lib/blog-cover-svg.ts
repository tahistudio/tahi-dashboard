/**
 * SVG blog cover generator — Phase I · Slice 9 (prototype).
 *
 * Replicates the look of Tahi's hand-designed reference covers
 * (864x500, deep-forest base, brand-green diamond gradient, abstract
 * motif scene, NO text) but composes each one uniquely from a topical
 * motif library so it doesn't feel templated.
 *
 * Output is a standalone SVG string — editable in Figma, never glitches
 * text (there is none), always on-brand by construction.
 *
 * Uniqueness comes from: a deterministic seed (hash of the title) that
 * drives motif selection, placement, scale, rotation, and palette-shift
 * within the brand range. Two articles never get the same composition.
 *
 * This is a prototype to evaluate the approach before committing to the
 * full motif library.
 */

const W = 864
const H = 500

// Brand palette pulled from the reference SVGs.
const BASE = '#2A3626'
const GREENS = ['#7aab6b', '#5A824E', '#425F39', '#354D2E', '#223E1C']
const SAGE = '#BAD1B3'
const CREAM = '#E3E6E2'
const GOLD = '#D2A838'
const WEBFLOW_BLUE = '#146EF5'
const BLUE_SOFT = '#A0C5FB'

export type MotifKey =
  | 'browser' | 'cards' | 'shield' | 'leaf' | 'grid' | 'chart'
  | 'shards' | 'orbit' | 'blocks' | 'wave'

/** Deterministic PRNG seeded from a string, so the same title always
 *  produces the same cover. Mulberry32. */
function makeRng(seedStr: string): () => number {
  let h = 1779033703 ^ seedStr.length
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  let a = h >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Map a cluster/topic to a weighted motif preference, so the cover
 *  relates to the article. Falls back to a general mix. */
function motifsForTopic(topic: string): MotifKey[] {
  const t = topic.toLowerCase()
  if (/secur|enterprise|safe|trust|compliance/.test(t)) return ['shield', 'grid', 'blocks', 'orbit']
  if (/vs|versus|compar|headless|wordpress|shopify|framer/.test(t)) return ['cards', 'blocks', 'shards', 'chart']
  if (/pric|cost|budget|roi|subscription|retainer/.test(t)) return ['cards', 'chart', 'blocks', 'grid']
  if (/design|figma|handoff|feedback|ui|ux/.test(t)) return ['browser', 'cards', 'shards', 'leaf']
  if (/seo|aeo|rank|traffic|search|content/.test(t)) return ['chart', 'orbit', 'grid', 'browser']
  if (/sustain|carbon|green|eco/.test(t)) return ['leaf', 'wave', 'orbit', 'grid']
  if (/agenc|partner|team|scale|grow/.test(t)) return ['blocks', 'orbit', 'cards', 'browser']
  if (/calculator|interactive|web app|build|develop/.test(t)) return ['browser', 'grid', 'chart', 'blocks']
  return ['leaf', 'cards', 'browser', 'orbit', 'shards', 'grid']
}

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)]
}

// ── Motif renderers. Each returns an SVG fragment positioned via a
//    transform the caller supplies. Kept simple + flat to match the refs.

function motifBrowser(rng: () => number): string {
  const fill = pick([CREAM, SAGE], rng)
  const bar = pick([GREENS[2], GREENS[3]], rng)
  return `<g>
    <rect x="-90" y="-60" width="180" height="120" rx="10" fill="${fill}"/>
    <rect x="-90" y="-60" width="180" height="26" rx="10" fill="${bar}"/>
    <rect x="-90" y="-47" width="180" height="13" fill="${bar}"/>
    <circle cx="-76" cy="-47" r="4" fill="${GOLD}"/>
    <circle cx="-62" cy="-47" r="4" fill="${SAGE}"/>
    <circle cx="-48" cy="-47" r="4" fill="${WEBFLOW_BLUE}"/>
    <rect x="-74" y="-20" width="100" height="10" rx="5" fill="${GREENS[1]}" opacity="0.6"/>
    <rect x="-74" y="2" width="130" height="10" rx="5" fill="${GREENS[1]}" opacity="0.4"/>
    <rect x="-74" y="24" width="70" height="10" rx="5" fill="${GREENS[1]}" opacity="0.4"/>
  </g>`
}

function motifCards(rng: () => number): string {
  const c1 = pick(GREENS, rng), c2 = pick([CREAM, SAGE, GOLD], rng)
  return `<g>
    <rect x="-70" y="-50" width="120" height="150" rx="14" fill="${c1}" opacity="0.85" transform="rotate(-8)"/>
    <rect x="-40" y="-60" width="120" height="150" rx="14" fill="${c2}" transform="rotate(6)"/>
    <circle cx="0" cy="-20" r="16" fill="${WEBFLOW_BLUE}"/>
    <rect x="-30" y="6" width="80" height="9" rx="4.5" fill="${BASE}" opacity="0.5"/>
    <rect x="-30" y="24" width="56" height="9" rx="4.5" fill="${BASE}" opacity="0.3"/>
  </g>`
}

function motifShield(rng: () => number): string {
  const fill = pick([SAGE, CREAM], rng)
  return `<g>
    <path d="M0 -80 L70 -52 V8 C70 56 38 84 0 100 C-38 84 -70 56 -70 8 V-52 Z" fill="${fill}"/>
    <path d="M0 -80 L70 -52 V8 C70 56 38 84 0 100 C-38 84 -70 56 -70 8 V-52 Z" fill="${GREENS[0]}" opacity="0.25"/>
    <path d="M-26 4 L-6 26 L34 -22" stroke="${GREENS[2]}" stroke-width="12" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`
}

function motifLeaf(rng: () => number): string {
  const fill = pick([GREENS[0], SAGE, GOLD], rng)
  // Tahi leaf radius shape: 0 16px 0 16px equivalent rounded blob.
  return `<g>
    <path d="M-80 80 Q-80 -80 80 -80 Q80 80 -80 80 Z" fill="${fill}"/>
    <path d="M-80 80 Q0 0 80 -80" stroke="${BASE}" stroke-width="6" fill="none" opacity="0.4"/>
  </g>`
}

function motifGrid(rng: () => number): string {
  const dot = pick([SAGE, GOLD, BLUE_SOFT], rng)
  let cells = ''
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    const o = 0.25 + rng() * 0.6
    cells += `<circle cx="${c * 32 - 64}" cy="${r * 32 - 64}" r="${5 + rng() * 4}" fill="${dot}" opacity="${o.toFixed(2)}"/>`
  }
  return `<g>${cells}</g>`
}

function motifChart(rng: () => number): string {
  const bar = pick(GREENS, rng), accent = pick([GOLD, WEBFLOW_BLUE], rng)
  let bars = ''
  const heights = [40, 70, 55, 95, 120, 80]
  heights.forEach((ht, i) => {
    const fill = i === heights.length - 1 ? accent : bar
    bars += `<rect x="${i * 28 - 84}" y="${60 - ht}" width="18" height="${ht}" rx="6" fill="${fill}" opacity="${i === heights.length - 1 ? 1 : 0.8}"/>`
  })
  return `<g>${bars}</g>`
}

function motifShards(rng: () => number): string {
  let s = ''
  for (let i = 0; i < 5; i++) {
    const c = pick([...GREENS, GOLD, SAGE], rng)
    const x = rng() * 120 - 60, y = rng() * 120 - 60
    const sz = 24 + rng() * 50
    const rot = rng() * 360
    s += `<rect x="${x}" y="${y}" width="${sz}" height="${sz}" rx="6" fill="${c}" opacity="${(0.4 + rng() * 0.5).toFixed(2)}" transform="rotate(${rot} ${x + sz / 2} ${y + sz / 2})"/>`
  }
  return `<g>${s}</g>`
}

function motifOrbit(rng: () => number): string {
  const ring = pick([SAGE, GOLD, BLUE_SOFT], rng)
  return `<g fill="none">
    <circle cx="0" cy="0" r="90" stroke="${ring}" stroke-width="2" opacity="0.5"/>
    <circle cx="0" cy="0" r="60" stroke="${ring}" stroke-width="2" opacity="0.35"/>
    <circle cx="0" cy="-90" r="12" fill="${GOLD}"/>
    <circle cx="52" cy="30" r="9" fill="${WEBFLOW_BLUE}"/>
    <circle cx="-52" cy="42" r="7" fill="${CREAM}"/>
    <circle cx="0" cy="0" r="20" fill="${GREENS[0]}"/>
  </g>`
}

function motifBlocks(rng: () => number): string {
  let b = ''
  const cols = [GREENS[0], SAGE, GOLD, CREAM]
  for (let i = 0; i < 4; i++) {
    const c = cols[i % cols.length]
    b += `<rect x="${i * 40 - 80}" y="${-40 + (i % 2) * 30}" width="34" height="${60 + rng() * 50}" rx="8" fill="${c}" opacity="${(0.6 + rng() * 0.4).toFixed(2)}"/>`
  }
  return `<g>${b}</g>`
}

function motifWave(rng: () => number): string {
  const c = pick([GREENS[0], SAGE], rng)
  return `<g fill="none" stroke="${c}" stroke-width="6" opacity="0.6">
    <path d="M-120 0 Q-60 -50 0 0 T120 0"/>
    <path d="M-120 30 Q-60 -20 0 30 T120 30" opacity="0.6"/>
    <path d="M-120 -30 Q-60 -80 0 -30 T120 -30" opacity="0.4"/>
  </g>`
}

const MOTIF_FN: Record<MotifKey, (rng: () => number) => string> = {
  browser: motifBrowser, cards: motifCards, shield: motifShield, leaf: motifLeaf,
  grid: motifGrid, chart: motifChart, shards: motifShards, orbit: motifOrbit,
  blocks: motifBlocks, wave: motifWave,
}

export interface CoverInput {
  title: string
  topic?: string   // cluster name or target keyword — drives motif choice
}

/** Generate a unique on-brand SVG cover. Returns the SVG string. */
export function generateCoverSvg(input: CoverInput): string {
  const seed = `${input.title}|${input.topic ?? ''}`
  const rng = makeRng(seed)
  const palette = motifsForTopic(input.topic ?? input.title)

  // Diamond-ish gradient glow approximating the reference (a rotated
  // radial reads close enough to Figma's GRADIENT_DIAMOND).
  const gx = 20 + rng() * 60   // glow centre %
  const gy = 30 + rng() * 50
  const gradId = 'g' + Math.floor(rng() * 1e6)

  // Hero motif (large, back) + 1-2 foreground motifs, all from the topic set.
  const heroKey = pick(palette, rng)
  const fgCount = 1 + Math.floor(rng() * 2)
  const fgKeys: MotifKey[] = []
  for (let i = 0; i < fgCount; i++) fgKeys.push(pick(palette, rng))

  // Placement: hero offset to one side, foreground motifs scattered.
  const heroX = rng() > 0.5 ? 250 + rng() * 120 : 430 + rng() * 250
  const heroY = 150 + rng() * 200
  const heroScale = 1.6 + rng() * 0.8
  const heroRot = -20 + rng() * 40

  const fg = fgKeys.map((k) => {
    const x = 120 + rng() * 620
    const y = 110 + rng() * 280
    const sc = 0.7 + rng() * 0.7
    const rot = -25 + rng() * 50
    return `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${rot.toFixed(0)}) scale(${sc.toFixed(2)})">${MOTIF_FN[k](rng)}</g>`
  }).join('\n')

  // A couple of faint background accents for depth.
  const bgAccents = `
    <circle cx="${(rng() * W).toFixed(0)}" cy="${(rng() * H).toFixed(0)}" r="${(120 + rng() * 120).toFixed(0)}" fill="${GREENS[0]}" opacity="0.06"/>
    <circle cx="${(rng() * W).toFixed(0)}" cy="${(rng() * H).toFixed(0)}" r="${(80 + rng() * 100).toFixed(0)}" fill="${GOLD}" opacity="0.05"/>`

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="${gradId}" cx="${gx.toFixed(0)}%" cy="${gy.toFixed(0)}%" r="85%" gradientTransform="rotate(28)">
      <stop offset="0%" stop-color="${GREENS[0]}" stop-opacity="0.55"/>
      <stop offset="45%" stop-color="${GREENS[1]}" stop-opacity="0.4"/>
      <stop offset="100%" stop-color="${GREENS[2]}" stop-opacity="0.1"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${BASE}"/>
  <rect width="${W}" height="${H}" fill="url(#${gradId})"/>
  ${bgAccents}
  <g transform="translate(${heroX.toFixed(0)} ${heroY.toFixed(0)}) rotate(${heroRot.toFixed(0)}) scale(${heroScale.toFixed(2)})" opacity="0.9">${MOTIF_FN[heroKey](rng)}</g>
  ${fg}
  <rect x="0" y="0" width="${W}" height="${H}" fill="none"/>
</svg>`
}
