# Design pass brief (2026-09-13 overnight)

Every designer and every critic in the pass reads this first. It is the contract that keeps 27 page groups consistent with each other and with the pages already live.

## What the pass is

Liam (the founder): "have Claude design mockup every page that we need for the full suite. One at a time. Page, sub page, variants. All features thought out. All states. UX reviewed. Consistent design with the rest of the pages on repo." Designs are held for Liam's review; nothing is ported tonight.

Source of truth per group: docs/superpowers/design/requirements/<group>.md (sections 2 pages, 3 states, 4 features, 6 design system contract, 7 open questions, 8 acceptance). Where a requirement doc leaves Liam a question, design the option that keeps today's live behaviour and list the question in your report; never invent a feature the backlog does not contain (proposals are marked "proposal" in the docs).

## The Claude Design project

Project id 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66 ("Tahi dashboard"). Load the tools with ToolSearch "select:mcp__claude-design__list_files,mcp__claude-design__read_file,mcp__claude-design__write_files,mcp__claude-design__render_preview". Always list_files first, read a file in full before rewriting it, pass the etag as if_match on every write, and re-read if a write is refused for a stale etag.

Files that define the look, read them before drawing anything:
- _ds/tahi-studio-ds-components-5d0df77c-458f-4199-bfc0-36d3290ddb48/README.md and _ds_manifest.json (the design system components and tokens)
- app-shell.jsx and app-shell.css (the shell: sidebar, top bar, mobile tab bar, Tweaks pill, command palette, audience nav groups)
- head-band.css (the shared headline band and left rail, the standard every list page follows)
- requests-kit.jsx, requests-listview.jsx, requests-detail.jsx (the reference pages: band, rail, DataTable, SlideOver, detail composition)
- overview-kit.jsx and portal-home-kit.jsx (card and tile vocabulary)
- app-mount.jsx (how a module registers with the shell: window.TahiX exports and props)

Design rules (from CLAUDE.md and the critic verdicts):
- Manrope; tokens only (--color-*, --radius-leaf*, spacing in rem); the leaf radius on icon tiles, avatars, primary buttons and feature callouts, not on every card; no single-side borders; every interactive element has hover and focus states; 44px touch targets; 375px with no horizontal scroll; dark mode through the .dark class with no contrast loss; no em or en dashes in any copy or comment.
- Every list page: PageHeader plus the headline band from head-band.css (label ramp, figure size and tile count exactly as requests uses them) and the left rail for views and filters; never a horizontal filter toolbar.
- Every detail page: the requests-detail composition (main column minmax(0,1fr), fixed rail that stacks under 1024px, rail cards without their own scroll).
- Every page shows all states from requirement section 3: loading skeleton, empty state (leaf icon, title, description, one CTA), error, read-only Client view where the audience is a client, member versus admin seat, phone and tablet, dark.
- Honest surfaces only: no control that the backend cannot do; requirement section 5 lists what must stay honest.

## Files and size

- Keep every file you write under 90 KB. Split a module into <module>.jsx (pages), <module>-kit.jsx (components), <module>-data.jsx (sample data), <module>.css. If an existing file is already over 90 KB (sales-artifacts.jsx, sales-artifacts.css, sales-artifacts-kit.jsx, sales-pipeline.jsx), split it first into two or three files with the same window export, then edit.
- Do not edit "Tahi App Shell.html" or app-mount.jsx. A single wiring step at the end adds new modules to the shell. Instead, ship a standalone preview page previews/<module>-preview.html that loads the DS bundle, app-shell.css, head-band.css, your module files and React through the same script tags the shell uses, mounts your pages inside the shell chrome (window.TahiShell.App with your content props, audience set through the initial props), and honours query parameters: ?page=<page key> to pick the page, ?theme=dark for dark, ?device=phone for a 375px viewport layout (set the shell device state), ?audience=client|owner|teammate. The critic renders that page.
- Sample data must be plausible Tahi data (clients like Giant Group, Mahana Orchards, Glasswall; NZD and GBP amounts; New Zealand dates), never lorem ipsum, and never a real client's private detail beyond the names already in the project.

## What the critic checks (SHIP, FIX or REDO per page)

Rendered at 1440 light, 1440 dark, 375 light, and 768 where a rail exists. Measured issues, not impressions: overflow past the viewport, clipped titles, rail width and truncation, band label and figure sizes against requests, tile counts, touch target heights, contrast in dark, missing states from section 3, missing pages from section 2, controls that section 5 calls dishonest. SHIP = nothing blocking; FIX = a bounded list the designer resolves in one revision; REDO = the page does not follow the contract and starts again.

## Report format

Each designer returns: the files written (paths and sizes), the page keys the preview supports, the pages and states covered, the requirement items intentionally left out and why, and the open questions for Liam. Each critic returns per page: verdict, measured issues with the width and theme, and the screenshot paths. The lead compiles docs/superpowers/plans/2026-09-14-design-review-for-liam.md from these.
