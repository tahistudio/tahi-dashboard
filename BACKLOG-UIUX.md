# UI/UX backlog

Anything deferred during the page-by-page polish overhaul lives here. Add freely, drain in priority order between sprints.

Format: one bullet per item, prefix with the page name it belongs to, end with a date the note was added.

## Pending

- **A4 / icons** — Animated icons are built (`components/tahi/animated-icons.tsx`). Decide where each one ships: refresh-cw on sync buttons, bell on notification badge, settings on the cog nav item, sparkles on AI moments, check-circle on save success, search on top-nav, trash on row delete-confirm hover. Static Lucide elsewhere. Added 2026-05-22.
- **A4 / chips** — `components/tahi/status-badge.tsx` currently has no leading glyph. Add `<LeafIcon size={11} />` tinted to the chip's text colour, matching the design-system status palette demo. Submitted token colours already updated to indigo. Added 2026-05-22.
- **A4 / icons grid polish** — Retire the hand-coded hover transforms in the iconography grid (`<IconTile motion=...>`) once the relevant icons have animated equivalents in `animated-icons.tsx`. Added 2026-05-22.

## Done
