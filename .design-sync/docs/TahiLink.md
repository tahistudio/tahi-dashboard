---
category: primitives
---

<TahiButton>. Every button in the app.

Variants:
  primary    Lime (#78C45E) with near-black text and the leaf radius.
             Reserved for the single most important action on a page.
  secondary  Outlined. Transparent bg, --color-border-strong border.
             Symmetric --radius-md.
  ghost      Borderless, muted text. For dense rows, kebab menus.
  link       Inline text with a sliding-underline + animated arrow.
  danger     Red. Same hover lift as primary but no leaf radius.

Icon convention (from the marketing site): the trailing slot is the
default. Pass `icon={<ArrowRight />}` and it renders on the right.
Pass `iconLeft={...}` when you need it on the left (search field,
back button). Loading swaps the leading slot for a spinner.

Motion: --motion-base (420ms) on hover, ease-out. Primary lifts 1px
+ brand glow. Secondary just shifts border colour to brand. No
scale anywhere. Feels cheap.
