import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  QA_CORE_VIEWPORT_KEYS,
  QA_LEGACY_VIEWPORT_KEYS,
  QA_NICHE_VIEWPORT_KEYS,
  QA_SELECTABLE_VIEWPORT_KEYS,
  QA_VIEWPORT_KEY_PATTERN,
  QA_VIEWPORT_REGISTRY,
  isLegacyRoundViewports,
  isLegacyViewportKey,
  isQaViewportKey,
  legacyTickColumn,
  overviewViewportsFor,
  parseRoundViewports,
  parseViewportInput,
  primaryViewportFor,
  scanAllViewportsFor,
  serialiseRoundViewports,
  tickStoreFor,
  viewportDef,
  viewportDefsFor,
  viewportLabel,
  webflowBreakpointFor,
  type QaViewportKey,
} from '../viewports'

const ALL_KEYS = QA_VIEWPORT_REGISTRY.map(v => v.key)

describe('registry shape', () => {
  it('has 21 unique keys that all match the key pattern', () => {
    expect(ALL_KEYS).toHaveLength(21)
    expect(new Set(ALL_KEYS).size).toBe(21)
    for (const key of ALL_KEYS) expect(QA_VIEWPORT_KEY_PATTERN.test(key)).toBe(true)
  })

  it('has 5 legacy, 11 core and 5 niche keys in the table order', () => {
    expect(QA_LEGACY_VIEWPORT_KEYS).toEqual(['xl', 'desktop', 'tablet', 'mobile_l', 'mobile_p'])
    expect(QA_CORE_VIEWPORT_KEYS).toEqual([
      'phone_s', 'phone_m', 'phone_l', 'phone_landscape', 'tablet_s', 'tablet_portrait',
      'tablet_landscape', 'laptop_s', 'laptop_m', 'laptop_l', 'desktop_fhd',
    ])
    expect(QA_NICHE_VIEWPORT_KEYS).toEqual(['phone_compact', 'fold_narrow', 'tablet_pro', 'desktop_qhd', 'desktop_ultrawide'])
    expect(QA_SELECTABLE_VIEWPORT_KEYS).toEqual([...QA_CORE_VIEWPORT_KEYS, ...QA_NICHE_VIEWPORT_KEYS])
    expect(QA_SELECTABLE_VIEWPORT_KEYS).toHaveLength(16)
    expect(ALL_KEYS).toEqual([...QA_LEGACY_VIEWPORT_KEYS, ...QA_CORE_VIEWPORT_KEYS, ...QA_NICHE_VIEWPORT_KEYS])
  })

  it('freezes the legacy five exactly', () => {
    const legacy = viewportDefsFor(QA_LEGACY_VIEWPORT_KEYS).map(v => [v.key, v.label, v.shortLabel, v.width, v.height, v.dpr])
    expect(legacy).toEqual([
      ['xl', 'XL', 'XL', 1920, 1080, 1],
      ['desktop', 'Desktop', 'Desk', 1440, 900, 1],
      ['tablet', 'Tablet', 'Tab', 768, 1024, 1],
      ['mobile_l', 'Mobile L', 'ML', 425, 860, 1],
      ['mobile_p', 'Mobile P', 'MP', 375, 812, 1],
    ])
    for (const v of viewportDefsFor(QA_LEGACY_VIEWPORT_KEYS)) expect(v.tier).toBe('legacy')
  })

  it('pins every core and niche device', () => {
    const rows = [...QA_CORE_VIEWPORT_KEYS, ...QA_NICHE_VIEWPORT_KEYS]
      .map(k => viewportDef(k))
      .map(v => [v?.key, v?.label, v?.width, v?.height, v?.dpr, v?.tier])
    expect(rows).toEqual([
      ['phone_s', 'Phone S', 360, 800, 3, 'core'],
      ['phone_m', 'Phone M', 393, 852, 3, 'core'],
      ['phone_l', 'Phone L', 430, 932, 3, 'core'],
      ['phone_landscape', 'Phone landscape', 852, 393, 3, 'core'],
      ['tablet_s', 'Small tablet', 600, 960, 2, 'core'],
      ['tablet_portrait', 'Tablet portrait', 768, 1024, 2, 'core'],
      ['tablet_landscape', 'Tablet landscape', 1024, 768, 2, 'core'],
      ['laptop_s', 'Laptop S', 1366, 650, 1, 'core'],
      ['laptop_m', 'Laptop M', 1440, 780, 2, 'core'],
      ['laptop_l', 'Laptop L', 1536, 730, 1.25, 'core'],
      ['desktop_fhd', 'Desktop', 1920, 950, 1, 'core'],
      ['phone_compact', 'Small phone', 375, 667, 2, 'niche'],
      ['fold_narrow', 'Narrow foldable', 344, 882, 2.625, 'niche'],
      ['tablet_pro', 'iPad Pro tall', 1032, 1376, 2, 'niche'],
      ['desktop_qhd', 'QHD', 2560, 1300, 1, 'niche'],
      ['desktop_ultrawide', 'Ultrawide', 3440, 1300, 1, 'niche'],
    ])
  })

  it('keeps widths and labels unique inside the legacy set and inside core plus niche', () => {
    for (const set of [QA_LEGACY_VIEWPORT_KEYS, QA_SELECTABLE_VIEWPORT_KEYS]) {
      const defs = viewportDefsFor(set)
      expect(new Set(defs.map(d => d.width)).size).toBe(defs.length)
      expect(new Set(defs.map(d => d.label)).size).toBe(defs.length)
    }
  })

  it('flags the Overview frames', () => {
    const flagged = QA_VIEWPORT_REGISTRY.filter(v => v.overview && v.tier !== 'legacy').map(v => v.key)
    expect(flagged).toEqual(['phone_m', 'tablet_portrait', 'laptop_m', 'desktop_fhd'])
    for (const v of viewportDefsFor(QA_LEGACY_VIEWPORT_KEYS)) expect(v.overview).toBe(true)
  })
})

describe('key helpers', () => {
  it('recognises keys, legacy keys, defs and labels', () => {
    expect(isQaViewportKey('laptop_m')).toBe(true)
    expect(isQaViewportKey('Laptop M')).toBe(false)
    expect(isQaViewportKey(5)).toBe(false)
    expect(isLegacyViewportKey('xl')).toBe(true)
    expect(isLegacyViewportKey('phone_m')).toBe(false)
    expect(viewportDef('phone_m')?.label).toBe('Phone M')
    expect(viewportDef('nope')).toBeNull()
    expect(viewportLabel('tablet_pro')).toBe('iPad Pro tall')
    expect(viewportLabel('mystery')).toBe('mystery')
  })

  it('returns defs in registry order and drops unknown keys', () => {
    expect(viewportDefsFor(['laptop_m', 'nope', 'xl', 'phone_s']).map(d => d.key)).toEqual(['xl', 'phone_s', 'laptop_m'])
  })
})

describe('parseRoundViewports', () => {
  it('gives the legacy five for null and undefined', () => {
    expect(parseRoundViewports(null)).toEqual([...QA_LEGACY_VIEWPORT_KEYS])
    expect(parseRoundViewports(undefined)).toEqual([...QA_LEGACY_VIEWPORT_KEYS])
    expect(isLegacyRoundViewports(null)).toBe(true)
    expect(isLegacyRoundViewports(undefined)).toBe(true)
    expect(isLegacyRoundViewports('[]')).toBe(false)
  })

  it('gives the core set for unreadable, empty or legacy-only values', () => {
    for (const raw of ['[]', 'nope', '{}', '["xl"]', '["unknown"]', '', '5', 'null']) {
      expect(parseRoundViewports(raw)).toEqual([...QA_CORE_VIEWPORT_KEYS])
    }
  })

  it('keeps known keys in registry order, de-duplicated', () => {
    expect(parseRoundViewports('["laptop_m","phone_s","phone_s"]')).toEqual(['phone_s', 'laptop_m'])
  })

  it('serialises in registry order', () => {
    expect(serialiseRoundViewports(['laptop_m', 'phone_s'])).toBe('["phone_s","laptop_m"]')
    expect(parseRoundViewports(serialiseRoundViewports(QA_SELECTABLE_VIEWPORT_KEYS))).toEqual([...QA_SELECTABLE_VIEWPORT_KEYS])
  })
})

describe('parseViewportInput', () => {
  it('refuses a non-array and an empty array', () => {
    for (const value of [undefined, null, 'phone_m', { 0: 'phone_m' }, 5, []]) {
      expect(parseViewportInput(value).ok).toBe(false)
    }
  })

  it('refuses a legacy key and names it as legacy', () => {
    const result = parseViewportInput(['xl'])
    expect(result).toEqual({ ok: false, error: 'xl is a legacy viewport: only rounds made before the viewport set use it' })
  })

  it('refuses an unknown key and echoes at most 40 characters', () => {
    const long = 'x'.repeat(80)
    const result = parseViewportInput([long])
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toContain('x'.repeat(40))
      expect(result.error).not.toContain('x'.repeat(41))
    }
    expect(parseViewportInput(['Phone M']).ok).toBe(false)
    expect(parseViewportInput([42]).ok).toBe(false)
  })

  it('refuses an array of 51 items', () => {
    expect(parseViewportInput(Array.from({ length: 51 }, () => 'phone_m')).ok).toBe(false)
    expect(parseViewportInput(Array.from({ length: 50 }, () => 'phone_m')).ok).toBe(true)
  })

  it('returns registry order, de-duplicated, and accepts every selectable key', () => {
    expect(parseViewportInput(['laptop_m', 'phone_s', 'laptop_m'])).toEqual({ ok: true, keys: ['phone_s', 'laptop_m'] })
    const all = parseViewportInput([...QA_SELECTABLE_VIEWPORT_KEYS].reverse())
    expect(all).toEqual({ ok: true, keys: [...QA_SELECTABLE_VIEWPORT_KEYS] })
  })
})

describe('primaryViewportFor', () => {
  it('picks the preferred key', () => {
    expect(primaryViewportFor(QA_LEGACY_VIEWPORT_KEYS)).toBe('desktop')
    expect(primaryViewportFor(QA_CORE_VIEWPORT_KEYS)).toBe('laptop_m')
    expect(primaryViewportFor(['desktop_fhd', 'phone_s'])).toBe('desktop_fhd')
  })

  it('falls back to the first present key in registry order, then null', () => {
    expect(primaryViewportFor(['phone_s'])).toBe('phone_s')
    expect(primaryViewportFor(['phone_m', 'phone_s'])).toBe('phone_s')
    expect(primaryViewportFor([])).toBeNull()
    expect(primaryViewportFor(['nope'])).toBeNull()
  })
})

describe('scanAllViewportsFor', () => {
  it('pairs the primary with the narrowest key', () => {
    expect(scanAllViewportsFor(QA_LEGACY_VIEWPORT_KEYS)).toEqual(['desktop', 'mobile_p'])
    expect(scanAllViewportsFor(QA_CORE_VIEWPORT_KEYS)).toEqual(['laptop_m', 'phone_s'])
    expect(scanAllViewportsFor(QA_SELECTABLE_VIEWPORT_KEYS)).toEqual(['laptop_m', 'fold_narrow'])
  })

  it('gives a single key once and nothing for an empty set', () => {
    expect(scanAllViewportsFor(['phone_m'])).toEqual(['phone_m'])
    expect(scanAllViewportsFor([])).toEqual([])
  })
})

describe('overviewViewportsFor', () => {
  it('gives all five for legacy and the four flagged frames for core', () => {
    expect(overviewViewportsFor(QA_LEGACY_VIEWPORT_KEYS)).toEqual([...QA_LEGACY_VIEWPORT_KEYS])
    expect(overviewViewportsFor(QA_CORE_VIEWPORT_KEYS)).toEqual(['phone_m', 'tablet_portrait', 'laptop_m', 'desktop_fhd'])
  })

  it('falls back to the set itself when fewer than two are flagged', () => {
    expect(overviewViewportsFor(['phone_s', 'laptop_s'])).toEqual(['phone_s', 'laptop_s'])
    const eightUnflagged: QaViewportKey[] = [
      'phone_s', 'phone_l', 'phone_landscape', 'tablet_s', 'tablet_landscape', 'laptop_s', 'laptop_l', 'phone_compact',
    ]
    expect(overviewViewportsFor(eightUnflagged)).toEqual(['phone_s', 'phone_l', 'phone_landscape', 'tablet_s'])
  })
})

describe('webflowBreakpointFor', () => {
  it('keeps the legacy strings byte identical to the ones lib/qa/comments.ts used before the registry', () => {
    expect(webflowBreakpointFor('xl')).toBe('1920px breakpoint if enabled, else 1440px, else 1280px, else Desktop (base)')
    expect(webflowBreakpointFor('desktop')).toBe('1440px breakpoint if enabled, else 1280px, else Desktop (base)')
    expect(webflowBreakpointFor('tablet')).toBe('Tablet (991px and below)')
    expect(webflowBreakpointFor('mobile_l')).toBe('Mobile portrait (479px and below); this frame is 425px wide')
    expect(webflowBreakpointFor('mobile_p')).toBe('Mobile portrait (479px and below); this frame is 375px wide')
  })

  it('maps new keys by width and adds the frame width', () => {
    expect(webflowBreakpointFor('phone_landscape')).toContain('Tablet')
    expect(webflowBreakpointFor('phone_landscape')).toContain('852px wide')
    expect(webflowBreakpointFor('tablet_s')).toContain('Mobile landscape')
    expect(webflowBreakpointFor('tablet_landscape')).toContain('Desktop (base)')
    expect(webflowBreakpointFor('laptop_s')).toContain('1280')
    expect(webflowBreakpointFor('laptop_s')).toContain('1366px wide')
    expect(webflowBreakpointFor('desktop_ultrawide')).toContain('1920')
    expect(webflowBreakpointFor('phone_s')).toBe('Mobile portrait (479px and below); this frame is 360px wide')
    expect(webflowBreakpointFor('laptop_m')).toBe('1440px breakpoint if enabled, else 1280px, else Desktop (base); this frame is 1440px wide')
  })
})

describe('tick storage', () => {
  it('uses the column only for chromium on a legacy key', () => {
    for (const key of QA_LEGACY_VIEWPORT_KEYS) expect(tickStoreFor('chromium', key)).toBe('column')
    expect(tickStoreFor('firefox', 'xl')).toBe('row')
    expect(tickStoreFor('chromium', 'phone_m')).toBe('row')
    expect(tickStoreFor('webkit', 'laptop_m')).toBe('row')
  })

  it('maps legacy keys to their vp_* column and nothing else', () => {
    expect(legacyTickColumn('xl')).toBe('vpXl')
    expect(legacyTickColumn('desktop')).toBe('vpDesktop')
    expect(legacyTickColumn('tablet')).toBe('vpTablet')
    expect(legacyTickColumn('mobile_l')).toBe('vpMobileL')
    expect(legacyTickColumn('mobile_p')).toBe('vpMobileP')
    expect(legacyTickColumn('phone_m')).toBeNull()
    expect(legacyTickColumn('')).toBeNull()
  })
})

describe('module purity', () => {
  it('has no import statement, because the MCP worker imports it by relative path', () => {
    const source = readFileSync(join(__dirname, '..', 'viewports.ts'), 'utf8')
    expect(/^\s*import\s/m.test(source)).toBe(false)
    expect(/\bfrom\s+['"]/.test(source)).toBe(false)
    expect(/\brequire\s*\(/.test(source)).toBe(false)
  })
})
