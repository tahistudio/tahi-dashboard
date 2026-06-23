---
category: primitives
---

<ProgressBar>. Linear sibling of <Gauge>. Use for "X of Y" displays
(tasks complete, capacity used, retainer hours burnt, etc.) anywhere
the value sits on a single linear scale.

  <ProgressBar value={42} max={100} label="Capacity used" />

  <ProgressBar
    value={hoursLogged}
    max={retainerCap}
    tone="warning"
    label="Hours logged this month"
    trailing={`${hoursLogged}h / ${retainerCap}h`}
  />

  <ProgressBar
    segments={[
      { value: 18, tone: 'positive', label: 'Done' },
      { value: 6,  tone: 'warning',  label: 'In progress' },
      { value: 2,  tone: 'danger',   label: 'Blocked' },
    ]}
    max={32}
  />

Tone behaviour:
  - 'auto'      brand at < 75%, warning at 75-99%, danger at >= 100%
  - 'positive'  brand-green
  - 'warning'   amber
  - 'danger'    red
  - 'neutral'   muted slate

Animates from 0 to target width when scrolled into view; respects
prefers-reduced-motion via the shared useEnteredViewport hook.
