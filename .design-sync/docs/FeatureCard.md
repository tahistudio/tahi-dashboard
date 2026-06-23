---
category: primitives
---

<FeatureCard>. The visually loud card for hero moments. Use sparingly:
the one big tile in a KPI strip, the AI briefing card, a launch banner.

Variants:

  lime      Solid lime (--color-accent) background, near-black text.
            Reads as "the most important thing here". Single per strip.

  forest    Deep forest gradient (deepest -> darker) with a radial
            brand-light tint at top-left. Off-cream text + lime accents.
            For AI surfaces and feature callouts.

  photo     Photo background with a forest tint overlay and off-cream
            text. Pass `imageUrl` and we apply the overlay automatically.
            For time tracker, hero panels, brand moments.

  cream     Plain bright surface for contrast inside a dark page (or
            vice versa). Default `bg` token plus a leaf radius.

The Card primitive stays the default for everyday surfaces. Use
FeatureCard only where the surface should announce itself.
