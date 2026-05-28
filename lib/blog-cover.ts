/**
 * Blog cover generator.
 *
 * Produces 864x500 SVG covers in Tahi's locked visual style. Every cover
 * shares the same dark base (#2A3626) + Figma diamond gradient overlay
 * (#77A569 -> #5A824E -> #425F39 at 50% opacity). No text is rendered in
 * the SVG itself; Webflow overlays the title client-side.
 *
 * Five templates span the reference pattern space:
 *   shield          - centred shield with optional brand mark
 *   stacked-cards   - two stylised content cards side by side
 *   agency-list     - 5-6 horizontal stripe rows (list / ranking)
 *   pricing-compare - 2-column feature comparison
 *   abstract-flow   - organic overlapping rounded shapes
 *
 * Pure functions. No DB writes here. R2 upload + Simple Icons mirror are
 * separate helpers (uploadCoverToR2, getMirroredBrandSvg).
 */

export type CoverTemplate =
  | 'shield'
  | 'stacked-cards'
  | 'agency-list'
  | 'pricing-compare'
  | 'abstract-flow'

export interface CoverInput {
  title: string
  template?: CoverTemplate
  brandLogoSvg?: string
  accentColour?: string
}

export interface CoverOutput {
  svg: string
  template: CoverTemplate
  filename: string
}

// Brand palette - hard-locked across every template.
const BASE_FILL = '#2A3626'
const DARK_NAVY = '#10202D'
const BRAND_GREEN = '#5A824E'
const BRAND_GREEN_LIGHT = '#77A569'
const BRAND_GREEN_DARK = '#425F39'
const SOFT_LIGHT = '#DCE8D9'
const MUTED_CARD = '#1E1428'

const VIEW_W = 864
const VIEW_H = 500

// ---------- Public API ---------------------------------------------------

export function buildBlogCover(input: CoverInput): CoverOutput {
  const accent = normaliseHex(input.accentColour) ?? BRAND_GREEN_LIGHT
  const template = input.template ?? pickTemplate(input.title)
  const id = stableId(`${input.title}:${template}`)

  const foreground = renderForeground(template, {
    accent,
    brandLogoSvg: input.brandLogoSvg,
    id,
  })

  const svg = buildShell(id, foreground)

  return {
    svg,
    template,
    filename: `${slugify(input.title)}.svg`,
  }
}

export function pickTemplate(title: string): CoverTemplate {
  const t = title.toLowerCase()
  if (/\b(vs\.?|versus|compare|comparison|alternatives?)\b/.test(t)) {
    return 'pricing-compare'
  }
  if (/\b(secure|security|compliance|safe|enterprise|trust|protect)\b/.test(t)) {
    return 'shield'
  }
  if (/\b(best|top|ranking|list of|favourite|favorites?)\b/.test(t) || /\btop\s+\d+/.test(t)) {
    return 'agency-list'
  }
  if (/\b(how to|guide|checklist|steps?|tutorial|walkthrough)\b/.test(t)) {
    return 'stacked-cards'
  }
  return 'abstract-flow'
}

// ---------- Simple Icons -------------------------------------------------

/**
 * Fetch a brand mark SVG from the Simple Icons CDN.
 * Returns the SVG body string or null on 404 / network error.
 *
 * Slug is the Simple Icons canonical slug (e.g. 'shopify', 'webflow',
 * 'figma'). Colour is a hex without the leading '#'.
 */
export async function fetchBrandSvg(
  slug: string,
  colourHex?: string,
): Promise<string | null> {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!clean) return null
  const colour = (colourHex ?? BRAND_GREEN_LIGHT).replace(/^#/, '')
  const url = `https://cdn.simpleicons.org/${clean}/${colour}`
  try {
    const res = await fetch(url, { method: 'GET' })
    if (!res.ok) return null
    const body = await res.text()
    if (!body.includes('<svg')) return null
    return body
  } catch {
    return null
  }
}

/**
 * Get a brand SVG, mirrored to R2 so we don't hit the Simple Icons CDN
 * on every cover render. R2 key: `simpleicons-mirror/{slug}-{colour}.svg`.
 *
 * Cache forever - Simple Icons are versioned implicitly via slug + colour
 * and we don't care about minor visual changes mid-cycle.
 */
export async function getMirroredBrandSvg(
  env: { STORAGE: R2Bucket },
  slug: string,
  colourHex?: string,
): Promise<string | null> {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
  if (!clean) return null
  const colour = (colourHex ?? BRAND_GREEN_LIGHT).replace(/^#/, '').toLowerCase()
  const key = `simpleicons-mirror/${clean}-${colour}.svg`

  try {
    const hit = await env.STORAGE.get(key)
    if (hit) {
      return await hit.text()
    }
  } catch {
    // R2 read failure - fall through to CDN fetch.
  }

  const fresh = await fetchBrandSvg(clean, colour)
  if (!fresh) return null

  try {
    await env.STORAGE.put(key, fresh, {
      httpMetadata: { contentType: 'image/svg+xml' },
    })
  } catch {
    // Mirror failure is non-fatal - we still return the fetched SVG.
  }
  return fresh
}

// ---------- R2 upload ----------------------------------------------------

/**
 * Upload an SVG cover to R2. Key pattern:
 *   blog-covers/{slug-from-key}-{hash8}.svg
 * where hash8 is the first 8 hex chars of SHA-256 of the SVG body. This
 * gives us cache-bust safety: same content -> same URL, content change ->
 * new URL.
 *
 * The `key` param is the slug portion only; the hash is appended here.
 * Returns the URL the dashboard uses to serve the file.
 */
export async function uploadCoverToR2(
  env: { STORAGE: R2Bucket },
  key: string,
  svg: string,
): Promise<{ storageKey: string; url: string }> {
  const hash8 = await sha256Hex8(svg)
  const cleanKey = key
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.svg$/i, '')
    .replace(/[^a-zA-Z0-9._/-]/g, '_')
  const storageKey = `blog-covers/${cleanKey}-${hash8}.svg`

  await env.STORAGE.put(storageKey, svg, {
    httpMetadata: { contentType: 'image/svg+xml' },
  })

  // Files are served through the dashboard proxy (R2 is private). The
  // serve endpoint enforces auth + scoping. For blog covers the caller
  // will typically copy the SVG body into Webflow directly, but we still
  // return a stable URL pointing at the dashboard serve route.
  const basePath = process.env.NEXT_PUBLIC_BASEPATH ?? ''
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? ''
  const origin = appUrl.replace(/\/dashboard\/?$/, '').replace(/\/$/, '')
  const url = origin
    ? `${origin}${basePath}/api/uploads/serve?key=${encodeURIComponent(storageKey)}`
    : `${basePath}/api/uploads/serve?key=${encodeURIComponent(storageKey)}`

  return { storageKey, url }
}

// ---------- Internals ----------------------------------------------------

function buildShell(id: string, foreground: string): string {
  // The diamond gradient transform is lifted verbatim from the reference
  // SVGs - same matrix, same opacity, same three colour stops. Do not
  // tweak: this is the locked Tahi cover backdrop.
  const grad = `paint0_diamond_${id}`
  const clip = `clip0_${id}`
  return [
    `<svg width="${VIEW_W}" height="${VIEW_H}" viewBox="0 0 ${VIEW_W} ${VIEW_H}" fill="none" xmlns="http://www.w3.org/2000/svg">`,
    `<g clip-path="url(#${clip})">`,
    `<rect width="${VIEW_W}" height="${VIEW_H}" fill="${BASE_FILL}"/>`,
    `<g clip-path="url(#${grad}_clip_path)">`,
    `<g transform="matrix(0.657 -0.461538 0.0498008 0.281953 151.714 432.501)">`,
    `<rect x="0" y="0" width="1071.1" height="1802.5" fill="url(#${grad})" opacity="0.5" shape-rendering="crispEdges"/>`,
    `<rect x="0" y="0" width="1071.1" height="1802.5" transform="scale(1 -1)" fill="url(#${grad})" opacity="0.5" shape-rendering="crispEdges"/>`,
    `<rect x="0" y="0" width="1071.1" height="1802.5" transform="scale(-1 1)" fill="url(#${grad})" opacity="0.5" shape-rendering="crispEdges"/>`,
    `<rect x="0" y="0" width="1071.1" height="1802.5" transform="scale(-1)" fill="url(#${grad})" opacity="0.5" shape-rendering="crispEdges"/>`,
    `</g></g>`,
    // Faint top-right radial highlight for depth - subtler than a noise
    // pattern and renders crisp at any size.
    `<circle cx="780" cy="60" r="220" fill="url(#${grad}_highlight)" opacity="0.18"/>`,
    foreground,
    `</g>`,
    `<defs>`,
    `<clipPath id="${grad}_clip_path"><rect width="${VIEW_W}" height="${VIEW_H}"/></clipPath>`,
    `<linearGradient id="${grad}" x1="0" y1="0" x2="500" y2="500" gradientUnits="userSpaceOnUse">`,
    `<stop offset="0.229299" stop-color="${BRAND_GREEN_LIGHT}"/>`,
    `<stop offset="0.64236" stop-color="${BRAND_GREEN}"/>`,
    `<stop offset="1" stop-color="${BRAND_GREEN_DARK}"/>`,
    `</linearGradient>`,
    `<radialGradient id="${grad}_highlight" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(780 60) rotate(90) scale(220)">`,
    `<stop stop-color="#DCE8D9"/>`,
    `<stop offset="1" stop-color="#DCE8D9" stop-opacity="0"/>`,
    `</radialGradient>`,
    `<clipPath id="${clip}"><rect width="${VIEW_W}" height="${VIEW_H}" fill="white"/></clipPath>`,
    `</defs>`,
    `</svg>`,
  ].join('')
}

interface ForegroundContext {
  accent: string
  brandLogoSvg?: string
  id: string
}

function renderForeground(template: CoverTemplate, ctx: ForegroundContext): string {
  switch (template) {
    case 'shield':          return renderShield(ctx)
    case 'stacked-cards':   return renderStackedCards(ctx)
    case 'agency-list':     return renderAgencyList(ctx)
    case 'pricing-compare': return renderPricingCompare(ctx)
    case 'abstract-flow':   return renderAbstractFlow(ctx)
  }
}

// Shield - centred shield outline with optional brand mark or tick inside.
function renderShield(ctx: ForegroundContext): string {
  const { accent, brandLogoSvg } = ctx
  // Outer shield path lifted from the reference, scaled + recentred.
  // Original centre was around (442, 300). We keep the same proportions.
  const outer = `<path d="M660.012 327.268C660.012 463.518 564.637 531.643 451.277 571.156C445.341 573.167 438.893 573.071 433.019 570.883C319.387 531.643 224.012 463.518 224.012 327.268V136.518C224.012 129.291 226.883 122.36 231.993 117.249C237.103 112.139 244.035 109.268 251.262 109.268C305.762 109.268 373.887 76.5681 421.302 35.1481C427.075 30.2158 434.419 27.5059 442.012 27.5059C449.605 27.5059 456.949 30.2158 462.722 35.1481C510.409 76.8406 578.262 109.268 632.762 109.268C639.989 109.268 646.92 112.139 652.03 117.249C657.141 122.36 660.012 129.291 660.012 136.518V327.268Z" fill="${DARK_NAVY}" stroke="${accent}" stroke-width="6.2" stroke-linecap="round" stroke-linejoin="round"/>`
  const inner = `<path d="M611.005 320.925C611.005 426.671 536.983 479.544 449.002 510.21C444.395 511.772 439.39 511.697 434.832 509.999C346.64 479.544 272.617 426.671 272.617 320.925V172.88C272.617 167.271 274.845 161.891 278.812 157.925C282.778 153.959 288.157 151.731 293.766 151.731C336.065 151.731 388.938 126.352 425.738 94.2047C430.218 90.3767 435.918 88.2734 441.811 88.2734C447.704 88.2734 453.404 90.3767 457.885 94.2047C494.896 126.563 547.557 151.731 589.856 151.731C595.465 151.731 600.844 153.959 604.811 157.925C608.777 161.891 611.005 167.271 611.005 172.88V320.925Z" fill="${DARK_NAVY}" stroke="${BRAND_GREEN_LIGHT}" stroke-opacity="0.5" stroke-width="4.8" stroke-linecap="round" stroke-linejoin="round"/>`

  let centrepiece: string
  if (brandLogoSvg) {
    // Embed the brand mark, scaled to fit inside the inner shield.
    // The inner shield bbox is roughly (272, 88) to (611, 510). We slot
    // the logo at 160x160 centred at (442, 290).
    const inlined = wrapBrandSvgForEmbed(brandLogoSvg, 362, 210, 160, 160)
    centrepiece = inlined
  } else {
    // Default: large tick mark in soft light, matching the reference.
    centrepiece = `<path d="M498.618 257.434L421.558 334.707L386.531 299.583" stroke="${SOFT_LIGHT}" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`
  }
  return outer + inner + centrepiece
}

// Stacked cards - two stylised cards (left smaller, right larger), each
// with placeholder text-line rects and a content block at the bottom.
function renderStackedCards(ctx: ForegroundContext): string {
  const { accent } = ctx
  const lineFill = `fill="${SOFT_LIGHT}" fill-opacity="0.3"`
  const accentRect = `fill="${accent}"`
  const card = MUTED_CARD

  return [
    // Left card (smaller)
    `<rect x="36" y="88" width="334" height="315" rx="18" fill="${card}"/>`,
    `<rect x="60" y="112" width="284" height="35" rx="9" ${lineFill}/>`,
    `<rect x="60" y="156" width="271" height="21" rx="9" ${accentRect}/>`,
    `<rect x="60" y="186" width="210" height="17" rx="8" ${lineFill}/>`,
    `<rect x="60" y="212" width="253" height="16" rx="8" ${lineFill}/>`,
    `<rect x="60" y="238" width="284" height="17" rx="8" ${lineFill}/>`,
    `<rect x="60" y="287" width="128" height="92" rx="9" fill="${BRAND_GREEN_LIGHT}" fill-opacity="0.25"/>`,
    `<rect x="220" y="287" width="124" height="92" rx="9" fill="${SOFT_LIGHT}" fill-opacity="0.2"/>`,
    // Right card (larger)
    `<rect x="404" y="49" width="420" height="396" rx="22" fill="${card}"/>`,
    `<rect x="435" y="78" width="358" height="44" rx="12" ${lineFill}/>`,
    `<rect x="435" y="134" width="341" height="26" rx="12" ${accentRect}/>`,
    `<rect x="435" y="171" width="264" height="22" rx="11" ${lineFill}/>`,
    `<rect x="435" y="205" width="319" height="21" rx="10" ${lineFill}/>`,
    `<rect x="435" y="237" width="357" height="22" rx="11" ${lineFill}/>`,
    `<rect x="436" y="299" width="161" height="116" rx="11" fill="${BRAND_GREEN_LIGHT}" fill-opacity="0.25"/>`,
    `<rect x="636" y="298" width="157" height="117" rx="12" fill="${SOFT_LIGHT}" fill-opacity="0.2"/>`,
    // Tick badge floating top-right (reference detail)
    `<circle cx="773" cy="85" r="59" fill="${BRAND_GREEN_LIGHT}"/>`,
    `<path d="M803.3 64L761.16 106.27L742 87.06" stroke="#BAD1B3" stroke-width="7.7" stroke-linecap="round" stroke-linejoin="round"/>`,
  ].join('')
}

// Agency list - 6 horizontal stripe rows of varying widths, suggesting
// an ordered list / ranking. Number badges on the left edge.
function renderAgencyList(ctx: ForegroundContext): string {
  const { accent } = ctx
  const rows = [
    { y: 60,  w: 700 },
    { y: 122, w: 620 },
    { y: 184, w: 660 },
    { y: 246, w: 540 },
    { y: 308, w: 600 },
    { y: 370, w: 480 },
  ]
  const parts: string[] = []
  rows.forEach((row, i) => {
    const isFeatured = i === 0
    const fill = isFeatured ? `fill="${MUTED_CARD}" stroke="${accent}" stroke-width="2"` : `fill="${MUTED_CARD}"`
    parts.push(
      `<rect x="82" y="${row.y}" width="${row.w}" height="50" rx="14" ${fill}/>`,
    )
    // Number badge
    parts.push(
      `<rect x="96" y="${row.y + 10}" width="30" height="30" rx="8" fill="${isFeatured ? accent : BRAND_GREEN_DARK}"/>`,
    )
    // Stylised content line inside the row
    parts.push(
      `<rect x="140" y="${row.y + 18}" width="${Math.max(120, row.w - 220)}" height="14" rx="7" fill="${SOFT_LIGHT}" fill-opacity="${isFeatured ? '0.6' : '0.35'}"/>`,
    )
    // Trailing meta block
    parts.push(
      `<rect x="${82 + row.w - 70}" y="${row.y + 16}" width="50" height="18" rx="9" fill="${BRAND_GREEN_LIGHT}" fill-opacity="0.5"/>`,
    )
  })
  return parts.join('')
}

// Pricing compare - two columns side by side, each with header pill +
// feature rows + price block at the bottom.
function renderPricingCompare(ctx: ForegroundContext): string {
  const { accent } = ctx
  const column = (x: number, highlighted: boolean): string => {
    const header = highlighted ? accent : BRAND_GREEN_DARK
    const cardStroke = highlighted ? `stroke="${accent}" stroke-width="2"` : `stroke="${BRAND_GREEN_DARK}" stroke-width="1"`
    return [
      `<rect x="${x}" y="50" width="380" height="400" rx="20" fill="${MUTED_CARD}" ${cardStroke}/>`,
      // Header pill
      `<rect x="${x + 24}" y="74" width="180" height="32" rx="16" fill="${header}"/>`,
      // Subhead line
      `<rect x="${x + 24}" y="120" width="240" height="14" rx="7" fill="${SOFT_LIGHT}" fill-opacity="0.35"/>`,
      // Feature rows
      ...[160, 198, 236, 274, 312].map((y, idx) => [
        `<circle cx="${x + 36}" cy="${y + 10}" r="8" fill="${BRAND_GREEN_LIGHT}" fill-opacity="${idx % 2 === 0 ? '0.7' : '0.45'}"/>`,
        `<rect x="${x + 56}" y="${y + 3}" width="${280 - idx * 18}" height="14" rx="7" fill="${SOFT_LIGHT}" fill-opacity="0.35"/>`,
      ].join('')),
      // Price block at bottom
      `<rect x="${x + 24}" y="368" width="120" height="40" rx="10" fill="${header}" fill-opacity="0.7"/>`,
      `<rect x="${x + 24}" y="414" width="200" height="14" rx="7" fill="${SOFT_LIGHT}" fill-opacity="0.3"/>`,
    ].join('')
  }
  return column(42, false) + column(442, true)
}

// Abstract flow - 4 overlapping rounded rectangles with brand-green
// gradients at varying opacities. The most organic / default template.
function renderAbstractFlow(ctx: ForegroundContext): string {
  const { accent } = ctx
  return [
    `<rect x="-40" y="320" width="520" height="260" rx="120" fill="${BRAND_GREEN_DARK}" opacity="0.55" transform="rotate(-8 220 450)"/>`,
    `<rect x="120" y="-60" width="560" height="240" rx="120" fill="${BRAND_GREEN}" opacity="0.45" transform="rotate(6 400 60)"/>`,
    `<rect x="380" y="180" width="540" height="260" rx="130" fill="${BRAND_GREEN_LIGHT}" opacity="0.4" transform="rotate(-4 650 310)"/>`,
    `<rect x="240" y="280" width="380" height="200" rx="100" fill="${accent}" opacity="0.55" transform="rotate(10 430 380)"/>`,
    // A subtle dark accent disc for depth
    `<circle cx="120" cy="140" r="60" fill="${DARK_NAVY}" opacity="0.4"/>`,
    `<circle cx="740" cy="420" r="46" fill="${DARK_NAVY}" opacity="0.35"/>`,
  ].join('')
}

// ---------- Utilities ---------------------------------------------------

function normaliseHex(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const withHash = trimmed.startsWith('#') ? trimmed : `#${trimmed}`
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return null
  return withHash
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'blog-cover'
  )
}

function stableId(input: string): string {
  // Tiny deterministic id for SVG defs (so two covers on the same page
  // don't collide on gradient ids). 8 chars of djb2 hash, hex.
  let h = 5381
  for (let i = 0; i < input.length; i += 1) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  const hex = (h >>> 0).toString(16).padStart(8, '0')
  return `tc${hex}`
}

async function sha256Hex8(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', buf)
  const bytes = Array.from(new Uint8Array(digest))
  return bytes
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Inline a Simple Icons SVG body into a parent SVG at the given x/y/w/h.
 * Strips the outer <svg ...> wrapper, wraps inner content in a <g> with
 * a translate + scale transform. Falls back to no-op string if the input
 * isn't parseable.
 *
 * Simple Icons SVGs are 24x24 viewBox by convention. We don't depend on
 * that - we read the viewBox if present, otherwise assume 24x24.
 */
function wrapBrandSvgForEmbed(
  svgBody: string,
  x: number,
  y: number,
  w: number,
  h: number,
): string {
  const viewBoxMatch = svgBody.match(/viewBox="([^"]+)"/)
  let vbW = 24
  let vbH = 24
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1].split(/\s+/).map(Number)
    if (parts.length === 4 && !parts.some(Number.isNaN)) {
      vbW = parts[2]
      vbH = parts[3]
    }
  }
  const inner = svgBody
    .replace(/^[\s\S]*?<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '')
  if (!inner.trim()) return ''
  const sx = w / vbW
  const sy = h / vbH
  return `<g transform="translate(${x} ${y}) scale(${sx} ${sy})">${inner}</g>`
}
