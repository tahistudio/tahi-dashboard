---
category: primitives
---

<Badge>. Every pill / chip / status label in the app.

One component, two ways to drive colour:
  1. Semantic tone: <Badge tone="danger">Overdue</Badge>
  2. Categorical  : <Badge stage="discovery">Discovery</Badge>
                    <Badge source="webflow_partner">Webflow Partner</Badge>

This replaces:
  - 50+ inline <span className="inline-flex rounded-full ..."> chips
  - <StatusBadge> / <PlanBadge> / <HealthDot> (we'll alias those in this file)
  - Priority badges, source badges, stage badges across Pipeline / Tasks / Requests

  <Badge tone="positive">Delivered</Badge>
  <Badge tone="warning" dot>In review</Badge>
  <Badge tone="danger" size="sm">High</Badge>
  <Badge variant="outline" tone="neutral">Draft</Badge>
  <Badge variant="count">12</Badge>
  <Badge stage="Closed Won">Closed Won</Badge>
  <Badge source="webflow_partner">Webflow Partner</Badge>

Tones (one meaning per colour. Matches DESIGN.md color language):
  brand     green (complete / done / positive)
  positive  green (alias for brand, reads clearer in tests)
  warning   amber (needs attention, in review, paused)
  danger    red (high priority, overdue. Reserved per DESIGN.md)
  info      blue (new, submitted, incoming)
  teal      teal (active, in progress)
  purple    purple (client action needed)
  rose      rose (urgent priority only)
  neutral   gray (inactive, draft, archived)

Variants:
  soft     tinted bg + solid text (default. Most of the app)
  solid    full colour bg + white text (loud callouts)
  outline  transparent bg + coloured border + coloured text
  count    circular pill for numeric counts
