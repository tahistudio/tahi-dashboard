---
category: primitives
---

<Avatar>. User / contact / team-member portrait.

When `src` is set, renders the image inside a circular crop with a
1px brand-tinted ring. When `src` is missing or fails to load, falls
back to gradient initials (brand-lighter → brand-dark, 135°).

Sizes follow the dashboard ladder. Pass an integer to override.

  <Avatar name="Liam Miller" />
  <Avatar name="Olivia Chen" src="/o.jpg" size="lg" />
  <Avatar name="Bot" status="online" />
  <Avatar.Stack>
    <Avatar name="A" />
    <Avatar name="B" />
    <Avatar name="C" />
    <Avatar.Overflow count={3} />
  </Avatar.Stack>
