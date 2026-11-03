/**
 * Site QA viewport registry and every rule derived from it.
 *
 * Pure and dependency free on purpose: this file has NO import statements, because the MCP worker
 * imports it by relative path. lib/qa/types.ts re-exports everything below.
 *
 * Key rules:
 * - A key matches QA_VIEWPORT_KEY_PATTERN (lower case snake case, at most 24 characters).
 * - A key is never renamed, never reused for another device and never removed.
 * - A key's width and height never change once shipped. A different size is a new key, because
 *   comments store element boxes at that size and a tick means "checked at this size".
 * - Legacy keys are frozen: only rounds made before the viewport set use them.
 * - Array order is display order: legacy first (largest first), then core and niche (smallest first).
 */

export type QaViewportTier = 'core' | 'niche' | 'legacy'
export type QaViewportKind = 'phone' | 'tablet' | 'laptop' | 'desktop'

/** Shape check for the literal below; key is a plain string here because QaViewportKey derives from it. */
interface QaViewportDefInput {
  key: string
  label: string
  shortLabel: string
  width: number
  height: number
  dpr: number
  tier: QaViewportTier
  kind: QaViewportKind
  overview: boolean
}

export const QA_VIEWPORT_REGISTRY = [
  { key: 'xl', label: 'XL', shortLabel: 'XL', width: 1920, height: 1080, dpr: 1, tier: 'legacy', kind: 'desktop', overview: true },
  { key: 'desktop', label: 'Desktop', shortLabel: 'Desk', width: 1440, height: 900, dpr: 1, tier: 'legacy', kind: 'desktop', overview: true },
  { key: 'tablet', label: 'Tablet', shortLabel: 'Tab', width: 768, height: 1024, dpr: 1, tier: 'legacy', kind: 'tablet', overview: true },
  { key: 'mobile_l', label: 'Mobile L', shortLabel: 'ML', width: 425, height: 860, dpr: 1, tier: 'legacy', kind: 'phone', overview: true },
  { key: 'mobile_p', label: 'Mobile P', shortLabel: 'MP', width: 375, height: 812, dpr: 1, tier: 'legacy', kind: 'phone', overview: true },
  { key: 'phone_s', label: 'Phone S', shortLabel: 'PS', width: 360, height: 800, dpr: 3, tier: 'core', kind: 'phone', overview: false },
  { key: 'phone_m', label: 'Phone M', shortLabel: 'PM', width: 393, height: 852, dpr: 3, tier: 'core', kind: 'phone', overview: true },
  { key: 'phone_l', label: 'Phone L', shortLabel: 'PL', width: 430, height: 932, dpr: 3, tier: 'core', kind: 'phone', overview: false },
  { key: 'phone_landscape', label: 'Phone landscape', shortLabel: 'PLand', width: 852, height: 393, dpr: 3, tier: 'core', kind: 'phone', overview: false },
  { key: 'tablet_s', label: 'Small tablet', shortLabel: 'TS', width: 600, height: 960, dpr: 2, tier: 'core', kind: 'tablet', overview: false },
  { key: 'tablet_portrait', label: 'Tablet portrait', shortLabel: 'TP', width: 768, height: 1024, dpr: 2, tier: 'core', kind: 'tablet', overview: true },
  { key: 'tablet_landscape', label: 'Tablet landscape', shortLabel: 'TL', width: 1024, height: 768, dpr: 2, tier: 'core', kind: 'tablet', overview: false },
  { key: 'laptop_s', label: 'Laptop S', shortLabel: 'LS', width: 1366, height: 650, dpr: 1, tier: 'core', kind: 'laptop', overview: false },
  { key: 'laptop_m', label: 'Laptop M', shortLabel: 'LM', width: 1440, height: 780, dpr: 2, tier: 'core', kind: 'laptop', overview: true },
  { key: 'laptop_l', label: 'Laptop L', shortLabel: 'LL', width: 1536, height: 730, dpr: 1.25, tier: 'core', kind: 'laptop', overview: false },
  { key: 'desktop_fhd', label: 'Desktop', shortLabel: 'D', width: 1920, height: 950, dpr: 1, tier: 'core', kind: 'desktop', overview: true },
  { key: 'phone_compact', label: 'Small phone', shortLabel: 'PC', width: 375, height: 667, dpr: 2, tier: 'niche', kind: 'phone', overview: false },
  { key: 'fold_narrow', label: 'Narrow foldable', shortLabel: 'F', width: 344, height: 882, dpr: 2.625, tier: 'niche', kind: 'phone', overview: false },
  { key: 'tablet_pro', label: 'iPad Pro tall', shortLabel: 'TPro', width: 1032, height: 1376, dpr: 2, tier: 'niche', kind: 'tablet', overview: false },
  { key: 'desktop_qhd', label: 'QHD', shortLabel: 'QHD', width: 2560, height: 1300, dpr: 1, tier: 'niche', kind: 'desktop', overview: false },
  { key: 'desktop_ultrawide', label: 'Ultrawide', shortLabel: 'UW', width: 3440, height: 1300, dpr: 1, tier: 'niche', kind: 'desktop', overview: false },
] as const satisfies readonly QaViewportDefInput[]

export type QaViewportKey = (typeof QA_VIEWPORT_REGISTRY)[number]['key']

export interface QaViewportDef {
  key: QaViewportKey
  label: string
  shortLabel: string
  width: number
  height: number
  dpr: number
  tier: QaViewportTier
  kind: QaViewportKind
  overview: boolean
}

const REGISTRY: readonly QaViewportDef[] = QA_VIEWPORT_REGISTRY

function keysOfTiers(tiers: readonly QaViewportTier[]): readonly QaViewportKey[] {
  return REGISTRY.filter(v => tiers.includes(v.tier)).map(v => v.key)
}

/** xl, desktop, tablet, mobile_l, mobile_p. */
export const QA_LEGACY_VIEWPORT_KEYS: readonly QaViewportKey[] = keysOfTiers(['legacy'])
/** The 11 devices every new round starts with, registry order. */
export const QA_CORE_VIEWPORT_KEYS: readonly QaViewportKey[] = keysOfTiers(['core'])
/** The 5 opt-in devices, registry order. */
export const QA_NICHE_VIEWPORT_KEYS: readonly QaViewportKey[] = keysOfTiers(['niche'])
/** Core then niche (16): what a new round may choose from. */
export const QA_SELECTABLE_VIEWPORT_KEYS: readonly QaViewportKey[] = [
  ...QA_CORE_VIEWPORT_KEYS,
  ...QA_NICHE_VIEWPORT_KEYS,
]
export const QA_VIEWPORT_KEY_PATTERN = /^[a-z][a-z0-9_]{0,23}$/

const KEY_SET: ReadonlySet<string> = new Set(REGISTRY.map(v => v.key))

export function isQaViewportKey(value: unknown): value is QaViewportKey {
  return typeof value === 'string' && KEY_SET.has(value)
}

export function isLegacyViewportKey(key: string): boolean {
  return QA_LEGACY_VIEWPORT_KEYS.some(k => k === key)
}

export function viewportDef(key: string): QaViewportDef | null {
  return REGISTRY.find(v => v.key === key) ?? null
}

/** Registry label, or the key itself for an unknown key (never throws). */
export function viewportLabel(key: string): string {
  return viewportDef(key)?.label ?? key
}

/** Registry order, unknown keys dropped. */
export function viewportDefsFor(keys: readonly string[]): QaViewportDef[] {
  const wanted = new Set(keys)
  return REGISTRY.filter(v => wanted.has(v.key))
}

/** Known keys of a list, de-duplicated, in registry order, with an optional extra filter. */
function registryOrder(keys: Iterable<unknown>, accept: (def: QaViewportDef) => boolean): QaViewportKey[] {
  const wanted = new Set<unknown>(keys)
  return REGISTRY.filter(v => wanted.has(v.key) && accept(v)).map(v => v.key)
}

/**
 * qa_rounds.viewports. NULL or undefined: the legacy five. A JSON array: its known non-legacy keys in
 * registry order, de-duplicated. Non-null but unreadable, not an array, or no usable key: the core set
 * (only new code writes non-null values, and it only writes non-legacy keys). Never throws.
 */
export function parseRoundViewports(raw: string | null | undefined): QaViewportKey[] {
  if (raw === null || raw === undefined) return [...QA_LEGACY_VIEWPORT_KEYS]
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return [...QA_CORE_VIEWPORT_KEYS]
  }
  if (!Array.isArray(parsed)) return [...QA_CORE_VIEWPORT_KEYS]
  const keys = registryOrder(parsed, v => v.tier !== 'legacy')
  return keys.length > 0 ? keys : [...QA_CORE_VIEWPORT_KEYS]
}

/** True when the round predates the viewport set: its column is NULL. */
export function isLegacyRoundViewports(raw: string | null | undefined): boolean {
  return raw === null || raw === undefined
}

/** JSON for qa_rounds.viewports, registry order. */
export function serialiseRoundViewports(keys: readonly QaViewportKey[]): string {
  return JSON.stringify(registryOrder(keys, () => true))
}

const VIEWPORT_INPUT_MAX = 50

/**
 * A viewports value from a request body. Non-empty array of selectable keys; an array longer than 50
 * items is refused. Errors: not an array or empty; a legacy key ("xl is a legacy viewport: only rounds
 * made before the viewport set use it"); an unknown key (echoed sliced to 40 characters). Returns
 * registry order, de-duplicated.
 */
export function parseViewportInput(
  value: unknown,
): { ok: true; keys: QaViewportKey[] } | { ok: false; error: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'viewports must be a non-empty array of viewport keys' }
  }
  if (value.length > VIEWPORT_INPUT_MAX) {
    return { ok: false, error: `viewports can list at most ${VIEWPORT_INPUT_MAX} keys` }
  }
  const chosen = new Set<string>()
  for (const item of value as unknown[]) {
    if (typeof item !== 'string' || !isQaViewportKey(item)) {
      const echo = typeof item === 'string' ? item.slice(0, 40) : typeof item
      return { ok: false, error: `Unknown viewport ${echo}` }
    }
    if (isLegacyViewportKey(item)) {
      return { ok: false, error: `${item} is a legacy viewport: only rounds made before the viewport set use it` }
    }
    chosen.add(item)
  }
  return { ok: true, keys: registryOrder(chosen, () => true) }
}

/** Preference for the scan that supplies SEO, links, a11y and duplicate meta. */
export const QA_PRIMARY_PREFERENCE: readonly QaViewportKey[] = [
  'desktop',
  'laptop_m',
  'laptop_l',
  'laptop_s',
  'desktop_fhd',
  'xl',
  'tablet_landscape',
  'tablet_pro',
  'desktop_qhd',
  'desktop_ultrawide',
]

/** First key of the preference list present in keys, else the first present key in registry order, else null. */
export function primaryViewportFor(keys: Iterable<string>): QaViewportKey | null {
  const present = new Set<string>(keys)
  const preferred = QA_PRIMARY_PREFERENCE.find(k => present.has(k))
  if (preferred) return preferred
  return REGISTRY.find(v => present.has(v.key))?.key ?? null
}

/**
 * The hidden Scan all frames: [primary, narrowest key by width] de-duplicated. Legacy gives
 * ['desktop', 'mobile_p'] (today's pair), core gives ['laptop_m', 'phone_s'].
 */
export function scanAllViewportsFor(keys: readonly QaViewportKey[]): QaViewportKey[] {
  const defs = viewportDefsFor(keys)
  const primary = primaryViewportFor(keys)
  if (!primary) return []
  let narrowest = defs[0]
  for (const def of defs) {
    if (def.width < narrowest.width) narrowest = def
  }
  return narrowest.key === primary ? [primary] : [primary, narrowest.key]
}

/**
 * Overview frames: the keys flagged overview, registry order. When fewer than 2 are flagged, the set's
 * own keys in registry order, at most 4. Legacy gives all five.
 */
export function overviewViewportsFor(keys: readonly QaViewportKey[]): QaViewportKey[] {
  const defs = viewportDefsFor(keys)
  const flagged = defs.filter(d => d.overview)
  if (flagged.length >= 2) return flagged.map(d => d.key)
  return defs.slice(0, 4).map(d => d.key)
}

const LEGACY_WEBFLOW_BREAKPOINTS: Partial<Record<QaViewportKey, string>> = {
  xl: '1920px breakpoint if enabled, else 1440px, else 1280px, else Desktop (base)',
  desktop: '1440px breakpoint if enabled, else 1280px, else Desktop (base)',
  tablet: 'Tablet (991px and below)',
  mobile_l: 'Mobile portrait (479px and below); this frame is 425px wide',
  mobile_p: 'Mobile portrait (479px and below); this frame is 375px wide',
}

function webflowBandForWidth(width: number): string {
  if (width >= 1920) return '1920px breakpoint if enabled, else 1440px, else 1280px, else Desktop (base)'
  if (width >= 1440) return '1440px breakpoint if enabled, else 1280px, else Desktop (base)'
  if (width >= 1280) return '1280px breakpoint if enabled, else Desktop (base)'
  if (width >= 992) return 'Desktop (base)'
  if (width >= 768) return 'Tablet (991px and below)'
  if (width >= 480) return 'Mobile landscape (767px and below)'
  return 'Mobile portrait (479px and below)'
}

/**
 * Webflow breakpoint guidance. Legacy keys return the exact strings they always did. Other keys: by
 * width (>= 1920, >= 1440, >= 1280, >= 992 Desktop (base), >= 768 Tablet (991px and below), >= 480
 * Mobile landscape (767px and below), else Mobile portrait (479px and below)) plus "; this frame is
 * <width>px wide".
 */
export function webflowBreakpointFor(key: QaViewportKey): string {
  const legacy = LEGACY_WEBFLOW_BREAKPOINTS[key]
  if (legacy !== undefined) return legacy
  const def = viewportDef(key)
  if (!def) return ''
  return `${webflowBandForWidth(def.width)}; this frame is ${def.width}px wide`
}

/** Where a tick lives: 'column' (qa_round_pages.vp_*) only for chromium on a legacy key, else 'row'. */
export function tickStoreFor(browser: string, key: string): 'column' | 'row' {
  return browser === 'chromium' && legacyTickColumn(key) !== null ? 'column' : 'row'
}

/**
 * The vp_* column of a legacy key (xl: vpXl, desktop: vpDesktop, tablet: vpTablet, mobile_l: vpMobileL,
 * mobile_p: vpMobileP), null for any other key.
 */
export function legacyTickColumn(
  key: string,
): 'vpXl' | 'vpDesktop' | 'vpTablet' | 'vpMobileL' | 'vpMobileP' | null {
  switch (key) {
    case 'xl':
      return 'vpXl'
    case 'desktop':
      return 'vpDesktop'
    case 'tablet':
      return 'vpTablet'
    case 'mobile_l':
      return 'vpMobileL'
    case 'mobile_p':
      return 'vpMobileP'
    default:
      return null
  }
}
