# UI/UX backlog

Anything deferred during the page-by-page polish overhaul lives here. Add freely, drain in priority order between sprints.

Format: one bullet per item, prefix with the page name it belongs to, end with a date the note was added.

## Pending

- **A4 / icons** — Animated icons are built (`components/tahi/animated-icons.tsx`). Decide where each one ships: refresh-cw on sync buttons, bell on notification badge, settings on the cog nav item, sparkles on AI moments, check-circle on save success, search on top-nav, trash on row delete-confirm hover. Static Lucide elsewhere. Added 2026-05-22.
- **A4 / chips** — `components/tahi/status-badge.tsx` currently has no leading glyph. Add `<LeafIcon size={11} />` tinted to the chip's text colour, matching the design-system status palette demo. Submitted token colours already updated to indigo. Added 2026-05-22.
- **A4 / icons grid polish** done. Hand-coded hover transforms retired. Static grid is plain hover-tint; animated grid uses `<AnimatedXxx>` components. 2026-05-22.
- **Codebase / em-dash purge** Full sweep of remaining em-dashes across `components/tahi/**`, `app/**`, `lib/**`, `BACKLOG-UIUX.md`, `STATUS.md`, `DESIGN.md`, commit message templates. Approx. 120 occurrences left across 30+ files. Added 2026-05-22.
- **Phase B inspiration / sidebar** New design pack (`I2Sm0FQojdoyB1ZY9EpSUg`) ships a cream sidebar with workspace/sales/marketing/studio groups, active-card treatment, and an AI promo card at the bottom. Lift these patterns when we redesign `app-sidebar.tsx`. Added 2026-05-22.
- **Phase B inspiration / topnav** Search pill with ⌘K hint, time tracker pill (dark green when active), currency switcher, bell with lime dot, avatar. Lift when redesigning `app-top-nav.tsx`. Added 2026-05-22.
- **Phase B inspiration / kanban** Deal cards with hover lift + 1px brand border + bottom-right "Xd in stage" meta. Lift when refreshing the pipeline page. Added 2026-05-22.
- **Phase B inspiration / homepage** KPI strip with internal dividers + delta colour, AI Daily Briefing card with forest gradient + lime accent, side-by-side recent requests + upcoming calls SectionCard. Lift when refreshing `overview-content.tsx`. Added 2026-05-22.

## Done
