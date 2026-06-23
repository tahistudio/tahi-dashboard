---
category: primitives
---

<Callout>. Quiet inline banner for contextual page-level info.

When to use which surface:
  <Toast>             transient confirmation after a user action
                      ("Saved", "Couldn't start timer").
  <Callout>           static info that lives inside a page section
                      ("This client's retainer is almost out",
                       "Stripe is disconnected", a one-off tip).
  <AnnouncementBanner> admin-configured, full-width, persisted
                      dismissal. Top-of-app announcements only.
  <EmptyState>        when a list / section is empty.

Example:

  <Callout tone="warning" title="Retainer hours nearly out"
           action={{ label: 'Review usage', onClick }}>
    Physitrack has used 38 of 40 hours this month.
  </Callout>

Look:
  - Borderless. The faint tone-tinted background carries the
    semantic colour without shouting.
  - 14px icon in the tone colour, no tile wrapper. Conversational.
  - Title in 13px medium; body in 12px muted. Same paragraph.
  - Action is a text link (with arrow) by default, or a chip button
    when emphasis is needed via variant="solid".
