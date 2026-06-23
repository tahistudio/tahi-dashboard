---
category: primitives
---

<KPICard>. A single big-number tile. Use inside a KPI strip, on the
Overview page, anywhere a metric needs to read at a glance.

Composition:

  <KPICard
    label="Total revenue"
    value="$689,372"
    icon={<DollarSign />}
    delta={{ value: '+15%', direction: 'up' }}
    trailing="vs last month"
  >
    <Sparkline data={...} />
  </KPICard>

Variants:

  default   White card with strong border. Calm, used for most tiles.
  featured  Lime fill (--color-accent), near-black text. Marks the
            single most important metric in a strip. One per strip.

Delta direction colours follow the design pack:
  up    -> positive green (#176B3D)
  down  -> danger red (#B42318)
  flat  -> muted gray

Mode-aware via tokens. Works in light + dark without changes.
