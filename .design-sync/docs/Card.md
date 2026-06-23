---
category: primitives
---

<Card>. The foundational surface primitive.

Webflow-style compound API with named slots. Use this instead of raw
`<div className="border rounded-xl ...">` everywhere so the card look
(border, radius, hover, padding) stays locked in one place.

  <Card variant="default" padding="md">
    <Card.Header>
      <Card.Title>Title</Card.Title>
      <Card.Subtitle>Meta</Card.Subtitle>
      <Card.Action><Button>Refresh</Button></Card.Action>
    </Card.Header>
    <Card.Body>...</Card.Body>
    <Card.Divider />
    <Card.Section label="DETAILS">...</Card.Section>
    <Card.Footer>...</Card.Footer>
  </Card>

Variants:
  default   1px border, radius-lg, no resting shadow, hover: darker border + shadow-sm
  flat      no border, no hover
  grouped   no internal padding (children manage their own), used for KPI
            strips and any "many cells, internal dividers" pattern
  elevated  shadow-md, used for popovers / tooltips / floating UI

Padding:
  none | sm (12px) | md (20px, default) | lg (32px)

interactive = true OR href set → adds cursor: pointer + hover state
href → renders as <Link>
