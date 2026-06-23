---
category: primitives
---

<Tooltip>. Wraps any element and shows a small dark label on hover or
keyboard focus. Portaled to <body> so it never clips inside a card.

Usage:

  <Tooltip label="Sync with Stripe">
    <IconButton icon={<RefreshCw />} />
  </Tooltip>

Style: forest-dark surface, white text, 12px, leaf-sm radius, soft
shadow. Calm 220ms fade. 400ms hover delay (Stripe / Linear default)
so the tooltip doesn't pop on every accidental cursor pass. Focus
triggers it immediately for keyboard users.

Sides: top by default. Auto-flips to bottom if there's no room above.

Use it on:
  - icon-only buttons (kebab, bell, gear, etc.)
  - truncated text that needs the full value on hover
  - data that benefits from a hint (a number's source, a status's meaning)

Don't use it on:
  - elements that already have a visible label
  - actions that need long explanation (use a popover instead)
  - touch-only surfaces (tooltips don't trigger on tap)
