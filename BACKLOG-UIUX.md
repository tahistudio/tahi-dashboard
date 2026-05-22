# UI/UX backlog

Anything deferred during the page-by-page polish overhaul lives here. Add freely, drain in priority order between sprints.

Format: one bullet per item, prefix with the page name it belongs to, end with a date the note was added.

## Pending

- **Phase B inspiration / Donezo dashboard** (image attached 2026-05-23) concrete patterns to lift when we hit each surface:
  - **KPI strip:** 4 across, first card featured (dark forest gradient). Others white. Each card has an `arrow-up-right` top-right + a small delta chip ("5↑") at the bottom (not just inline text). We already have most of this. Delta chip pattern is the missing detail to add to KPICard.
  - **Bar chart (Project Analytics):** pill-shaped bars (rounded both ends), some solid brand-green, others striped / hatched for inactive periods. Active bar has a value callout ("74%"). Build a `BarChart` primitive with pill-bar + striped-bar variants when we do the charts batch.
  - **Gauge / Project Progress:** large circular progress with percent in the middle, brand-green fill, hatched gray for incomplete, legend below (Completed / In Progress / Pending dots). Build `<Gauge>` or `<ProgressRing>` primitive when we do charts.
  - **Reminders card:** compact white card with title + time + lime CTA with leading icon ("Join Meet Now"). Will compose from Card + Button when we wire the overview page.
  - **Project list card:** white card with item rows, each row: small coloured shape on the left, title + due date, "+ New" outlined pill top-right. Standard list-card pattern, compose from Card + Avatar.
  - **Team Collaboration list:** avatar + name + sub-line + status pill on the right. Compose from Avatar + Badge.
  - **Promo card at sidebar bottom:** dark photo-backed card with lime CTA. Already covered by FeatureCard variant='photo'. Drop it at the bottom of the sidebar nav region when we revisit the sidebar.
  - **Sidebar active rail:** Donezo uses a vertical green rail on the left of the active item. We currently use brand-100 fill + leaf-radius. User banned side borders, so the rail is out. Keep the leaf-radius pill we have.
  - **Count badges:** small chip with the count (12+) on the right of nav items. We have the `count` prop on NavItem but no items use it yet. Wire up real counts when each page lands.
  Added 2026-05-23.



- **Codebase / leaf-to-rounded sweep** Switched core primitives to symmetric rounded (Card, KPICard, TahiButton primary, Toast, Tooltip, sidebar items, bottom-nav items, bottom-sheet corners, skip-to-content) on 2026-05-23. Hero / brand surfaces keep leaf (FeatureCard, leaf-logo, leaf-glyph, marketing site, brand wordmarks). Still using leaf in: `ai-briefing-card.tsx`, `booking-widget.tsx`, `client-card.tsx`, `kpi-strip.tsx` (legacy, KPICard supersedes), `ai-request-wizard.tsx`, `activity-timeline.tsx`, `empty-state.tsx`, `org-chart.tsx`, `prompt-dialog.tsx`, `skeletons.tsx`, `slide-over.tsx`, `dialogs/new-client-dialog.tsx`, `onboarding-checklist.tsx`. Sweep these to `--radius-lg` or `--radius-md` when each page is polished in Phase B.

- **A4 / icons** — Animated icons are built (`components/tahi/animated-icons.tsx`). Decide where each one ships: refresh-cw on sync buttons, bell on notification badge, settings on the cog nav item, sparkles on AI moments, check-circle on save success, search on top-nav, trash on row delete-confirm hover. Static Lucide elsewhere. Added 2026-05-22.
- **A4 / chips** — `components/tahi/status-badge.tsx` currently has no leading glyph. Add `<LeafIcon size={11} />` tinted to the chip's text colour, matching the design-system status palette demo. Submitted token colours already updated to indigo. Added 2026-05-22.
- **A4 / icons grid polish** done. Hand-coded hover transforms retired. Static grid is plain hover-tint; animated grid uses `<AnimatedXxx>` components. 2026-05-22.
- **Codebase / em-dash purge** Full sweep of remaining em-dashes across `components/tahi/**`, `app/**`, `lib/**`, `BACKLOG-UIUX.md`, `STATUS.md`, `DESIGN.md`, commit message templates. Approx. 120 occurrences left across 30+ files. Added 2026-05-22.
- **Phase B inspiration / sidebar** New design pack (`I2Sm0FQojdoyB1ZY9EpSUg`) ships a cream sidebar with workspace/sales/marketing/studio groups, active-card treatment, and an AI promo card at the bottom. Lift these patterns when we redesign `app-sidebar.tsx`. Added 2026-05-22.
- **Phase B inspiration / topnav** Search pill with ⌘K hint, time tracker pill (dark green when active), currency switcher, bell with lime dot, avatar. Lift when redesigning `app-top-nav.tsx`. Added 2026-05-22.
- **Phase B inspiration / kanban** Deal cards with hover lift + 1px brand border + bottom-right "Xd in stage" meta. Lift when refreshing the pipeline page. Added 2026-05-22.
- **Phase B inspiration / homepage** KPI strip with internal dividers + delta colour, AI Daily Briefing card with forest gradient + lime accent, side-by-side recent requests + upcoming calls SectionCard. Lift when refreshing `overview-content.tsx`. Added 2026-05-22.

## Done
