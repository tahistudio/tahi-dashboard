# Studio Ledger - the shared design theme

> Paste this whole block at the TOP of every page redesign prompt in Claude design,
> then add the page-specific brief below it. This is the single source of truth for
> the vibe, so every screen comes out consistent. Tokens are the real values from
> the codebase, so the output drops back into the app cleanly.

## The vibe in one line

Calm, confident, editorial. A printed annual report meets a quiet trading desk.
Numbers are the hero, whitespace does the work, brand-green is the only accent, and
nothing shouts. Premium through restraint, not decoration.

## Core principles (apply to every screen)

1. **Numbers as hero.** The single most important figure on a screen (MRR, balance,
   open count, total) is rendered large and bare on the canvas - no card around it -
   in a light weight with tight tracking. Everything else is supporting cast.
2. **Hairlines over cards.** Prefer 1px dividers and generous spacing to boxed cards.
   When a card is needed, it is a flat white surface with a hairline border, not a
   shadowed float. At most one or two true cards per screen.
3. **One accent.** Brand-green is the only accent colour. Status colours (success /
   warning / danger / info) appear only to signal status, never for decoration.
   Most of the page is ink-on-sand.
4. **One focal point per zone.** Each region answers one question. Resist density;
   let figures breathe.
5. **Ledger labels.** Section and field labels are tiny uppercase micro-text with
   wide tracking in a subtle ink - they read like column headers in a ledger.
6. **The leaf is rare.** The leaf radius is a signature, not a texture. Use it only
   on: the primary CTA, the active nav state, icon / avatar wrappers, and at most one
   hero accent per screen. Everything else uses small square-ish radii.
7. **Calm motion.** Slow fades and gentle eases. No bounce, no parallax, nothing
   springy in the product UI.
8. **Token-only.** Never hardcode hex. Use the CSS variables below so light/dark and
   future retuning just work. Dark mode must be designed, not assumed.

## Tokens (use these exact variables)

### Brand + accent
```
--color-brand        #5A824E   (the single accent)
--color-brand-dark   #425F39   (hover / pressed, AA-safe link colour)
--color-brand-darker #354D2E
--color-brand-deep   #2A3626
--color-brand-deepest#1E3019
--color-brand-light  #7aab6b
--color-brand-50     #f0f7ee   --color-brand-100 #dcefd8   --color-brand-200 #b9deb1
--color-link         #425F39   (inline links + small text, AA on sand)
```

### Surfaces + ink (light; flip to dark tokens for dark mode)
```
--color-bg-cream      #F7F6F3   warm sand = the PAGE canvas (never hardcode it)
--color-bg            #ffffff   raised surface / card / input
--color-bg-secondary  #F4F3EF   hover / secondary fill
--color-bg-tertiary   #EDEBE6   inset / kbd
--color-text          #121A0F   primary ink
--color-text-muted    #5D5B55   secondary ink
--color-text-subtle   #63615B   labels, captions (AA on sand)
--color-border        rgba(26,25,20,0.10)
--color-border-subtle rgba(26,25,20,0.06)
--color-border-strong rgba(26,25,20,0.16)   canonical 1px card border
```

### Dark mode
```
--color-bg-dark           #2A3626   (canvas)   --color-bg-dark-secondary #1f2a1c
--color-bg-dark-tertiary  #354230   --color-border-dark #3d5238
--color-text-dark #ffffff  --color-text-dark-muted #a8c4a0
```

### Status (status only, never decoration)
```
success #4ade80 / bg #f0fdf4   warning #fb923c / bg #fff7ed
danger  #dc2626 / bg #fef2f2   info    #60a5fa / bg #eff6ff
```

### Type - Manrope (weights 200-800)
```
Scale: --text-2xs .6875rem  --text-xs .75  --text-sm .8125  --text-base .875
       --text-md 1  --text-lg 1.125  --text-xl 1.25  --text-2xl 1.5rem
Ledger display (beyond the scale, for hero numbers/headlines):
       2.5rem - 4.5rem, weight 300-400, letter-spacing -0.02em, line-height 1.05-1.15
Ledger label: --text-2xs / --text-xs, weight 600, uppercase, letter-spacing 0.08em,
       colour --color-text-subtle
Body: --text-base, weight 400-500, --color-text / --color-text-muted, line-height 1.5
```

### Radius
```
--radius-leaf-sm 0 .625rem 0 .625rem   (CTA, active state, icon wrappers)
--radius-leaf    0 1rem 0 1rem          --radius-leaf-lg 0 1.5rem 0 1.5rem
--radius-md .5rem (buttons/inputs default)  --radius-lg .75rem (cards)
--radius-sm .375rem (badges)  --radius-full 9999px (avatars, pills)
```

### Spacing (4px base) + shadow + motion
```
--space-1 .25rem ... --space-4 1rem --space-6 1.5rem --space-8 2rem --space-12 3rem
--shadow-sm (rare)  --shadow-floating 0 4px 12px rgba(0,0,0,.12) (overlays only)
--shadow-leaf 0 2px 6px rgba(91,130,78,.18) (brand CTA, sparing)
--motion-base 200ms  --motion-quick 110ms   --ease-out cubic-bezier(.22,1,.36,1)
```

## Component conventions

- **Primary button:** brand-green fill, white text, `--radius-leaf-sm`, weight 600,
  hover deepens to brand-dark, optional `--shadow-leaf`. No uppercase.
- **Secondary button:** hairline border, transparent / white fill, ink text,
  `--radius-md`, hover fills `--color-bg-secondary`.
- **Input:** white fill, `--color-border` hairline, `--radius-md`; focus = brand
  border + 2px `--color-brand-100` ring. Label above in ledger-label style.
- **Chip / badge:** `--radius-sm` or pill; quiet by default (secondary bg + muted
  ink + subtle border); brand or status tint only when meaningful.
- **Table / list:** sand header row (`--color-th-bg`), ledger-label column heads,
  hairline row borders, hover `--color-row-hover`. Right-align numbers.
- **Empty state:** leaf-radius icon wrapper + short title + one line + one CTA.
- **Every interactive element** has a visible hover AND focus state. Touch targets
  >= 44px on mobile.

## Do / Don't

- DO let the canvas be sand and keep big areas empty.
- DO right-align and tabular-figure all numbers.
- DO design the dark variant explicitly with the dark tokens.
- DON'T box everything in cards or add drop shadows for depth - use hairlines + space.
- DON'T introduce new colours, gradients-as-decoration, or a second accent.
- DON'T scatter the leaf radius across every corner - it loses its meaning.
- DON'T use em dashes or en dashes in any copy (house rule); use hyphens.
