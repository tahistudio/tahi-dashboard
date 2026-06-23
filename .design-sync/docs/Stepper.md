---
category: primitives
---

<Stepper>. Horizontal multi-step indicator. Used for onboarding,
proposal builders, schedule templates, anything with a known set
of phases and a clear current step.

  <Stepper
    steps={[
      { id: 'discovery', label: 'Discovery' },
      { id: 'design',    label: 'Design',  sub: 'Tahi' },
      { id: 'build',     label: 'Build' },
      { id: 'launch',    label: 'Launch' },
    ]}
    current="design"
    onStepClick={(id) => navigate(id)} // optional, enables back-nav
  />

  - Steps before `current` render as done (filled brand circle + tick).
  - The `current` step renders highlighted with a brand ring.
  - Steps after `current` render as upcoming (muted outline).
  - Pass `onStepClick` to make completed steps clickable (back-nav).
    Upcoming steps stay inert.

Compact variant: pass `size="sm"` for tighter footprints.
