# Site QA v1.1: wide mode, page discovery, element comments (SQA.1, SQA.2, SQA.3)

Liam, 2026-10-27: "i have the 57 inch dual 4k samsung monitor ... i'd love to
put this on maybe 2/3 of the screen and have 1/3 for the figma" (wide mode);
"i don't have the sitemap on webflow.io links, so there needs to be a way that
ai can upload this for us with mcp" (page discovery); "i can add comments
directly onto elements in the page while auditing" (comments).

Builds on docs/superpowers/plans/2026-10-26-site-qa-tester.md. Every rule in
CLAUDE.md and AGENTS.md applies: no `any`, no console.log, no em or en dashes,
no single-side borders, CSS vars and rem units, 44px touch targets, guard
order getRequestAuth > isTahiAdmin > requireFeature('qa_tester') >
requireAdmin on every route, D1 at most 100 bound params per statement,
never export non-route symbols from route.ts.

Shared contracts are ALREADY written in lib/qa/types.ts (QaComment,
QaPin, QaPickMessage, QaPinClickMessage, QaCommentModeMessage,
QaPinsMessage, QaFocusPinMessage, QA_COMMENT_BODY_MAX). Do not change them;
ask the orchestrator if one is wrong.

## SQA.1 Wide mode (UI only)

- A "Wide" toggle in the zoom row of viewport-strip.tsx (aria-pressed). On:
  the workspace section renders as `position: fixed; inset: 0` above the
  dashboard chrome (z-index above sidebar and top nav, below dialogs and
  toasts; use the overlay-stack z conventions already in the repo), with
  bg var(--color-bg-cream) and 1rem padding. Toolbar stays on top. The page
  rail and the issues panel become slide-over drawers (buttons "Pages" and
  "Issues" in the toolbar); the strip takes the full width.
- Esc leaves wide mode unless a dialog, drawer or expanded frame used it.
  Persist on/off in localStorage `tahi-qa-wide`. Restored after mount.
- Zoom options gain "Fit width" (all five frames scaled to fill the width
  exactly, the existing "fit" binary search, now with no 40rem ceiling in wide
  mode) and "Actual size" (scale 1). Actual size is only offered when the
  measured width fits all five at scale 1 (sum of widths + gaps); when the
  window shrinks below that it falls back to Fit width without losing the
  saved choice.
- In wide mode the row height is also capped so frames fit the window height
  below the toolbar (no vertical page scroll to reach the bottom of a frame).
- Mobile/single-frame layout is unchanged; the Wide toggle is hidden there.

## SQA.3 Page discovery (API, MCP, UI)

- POST /api/admin/qa/sites/[id]/pages accepts `{ paths: string[] }` (1 to 500,
  each normalised with normalisePath, invalid ones reported back) as well as
  the existing `{ path }`. Response for the bulk form:
  `{ added: number, restored: number, skipped: number, invalid: string[] }`.
  Inserts batched (qa_pages has 9 columns, so at most 10 rows per insert),
  source 'manual'. Group keys recomputed with computeGroups as the sitemap
  import does.
- POST /api/admin/qa/sites/[id]/import-sitemap accepts an optional
  `sitemapUrl` (absolute https URL, isSafePublicUrl). When set it is read
  instead of `${origin}/sitemap.xml`, for staging sites whose sitemap is off:
  import the live domain's sitemap and QA those paths on staging. Removal
  flagging is skipped when sitemapUrl is used.
- POST /api/admin/qa/sites/[id]/crawl `{ target, maxPages? }` (default 100,
  max 150): breadth first from '/', same origin only, reading HTML with
  fetchText, extracting a[href] with a pure helper `lib/qa/crawl.ts`
  (`extractLinks(html, pageUrl, origin): string[]` returning normalised
  same-origin paths, skipping mailto, tel, javascript, hashes, and asset
  extensions). Stops at maxPages or a 140 fetch budget. Response
  `{ found: number, added: number, restored: number, truncated: boolean }`.
  Adds pages with source 'crawl'.
- MCP tools in workers/mcp-server (qa-tools.ts call mapping, index.ts tool
  definitions): `add_qa_pages` (site_id, paths: string[]), `crawl_qa_site`
  (site_id, target, max_pages?), `import_qa_sitemap` gains optional
  `sitemap_url`. Tool descriptions tell the assistant it can pass the page
  list it read from the client's Webflow MCP (static pages plus CMS item
  slugs under their collection path).
- UI: site page "Add pages" dialog with three tabs: Paste paths (textarea,
  one per line, full URLs accepted and reduced to paths), Crawl (target
  select, max pages), Sitemap URL. Shows the result counts.

## SQA.2 Element comments

### Data (migration 0116, additive, IF NOT EXISTS)

```
qa_comments (
  id text PRIMARY KEY NOT NULL,
  round_page_id text NOT NULL,
  viewport text NOT NULL,          -- QaViewportKey
  selector text NOT NULL,
  ox real NOT NULL DEFAULT 0.5,    -- 0..1 inside the element box
  oy real NOT NULL DEFAULT 0.5,
  element_tag text,
  element_text text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open',   -- 'open' | 'resolved'
  request_id text,
  author_id text,                  -- Clerk user id
  author_name text,                -- team_members.name at write time
  created_at text NOT NULL,
  updated_at text NOT NULL,
  resolved_at text
)
CREATE INDEX IF NOT EXISTS idx_qa_comments_round_page ON qa_comments(round_page_id)
```

Kept generic so WQA.0 (client and reviewer comments) can add an
author_type column later without a rebuild.

### API

- GET /api/admin/qa/round-pages/[id]/comments -> `{ comments: QaComment[] }`
  oldest first.
- POST same path `{ viewport, selector, ox, oy, elementTag?, elementText?,
  body }` -> `{ comment: QaComment }` (201). 409 on a closed round. body
  1..QA_COMMENT_BODY_MAX after trim, selector 1..1000, ox/oy clamped 0..1.
- PATCH /api/admin/qa/comments/[id] `{ body?, status?, requestId? }` ->
  `{ comment }`. Resolving sets resolved_at, reopening clears it. 409 on a
  closed round.
- DELETE same path -> `{ ok: true }`. 409 on a closed round.
- GET /api/admin/qa/rounds/[id]/report adds `comments: { roundPageId, path,
  viewport, n, body, status, elementTag, elementText, authorName, createdAt }[]`
  and `commentCounts: { open: number, resolved: number }`.

Pin numbers `n` are 1-based per round page in created_at order across all
viewports, so the list and the pins agree.

### Scanner (workers/qa-view/src/scanner)

- Listens for QaCommentModeMessage, QaPinsMessage, QaFocusPinMessage from
  payload.p only (same origin check as qa:rescan).
- Comment mode on: crosshair cursor, hover outline (2px brand green
  #5A824E, offset 2px) on the element under the pointer, click (capture
  phase, preventDefault and stopPropagation so links and buttons do not fire)
  posts a QaPickMessage to payload.p with a unique selector, ox/oy from the
  click point inside the element's bounding box, tag and text. Esc turns it
  off locally too.
- Selector: `uniqueSelector(el)` in scanner/selector.ts. #id when the id is
  unique and CSS-safe (CSS.escape), else a path of tag:nth-of-type steps from
  the nearest ancestor with a unique id (or html), shortest that matches
  exactly one element. Unit tested with jsdom.
- Pins: drawn in one fixed-position host element using a closed shadow root
  so site CSS cannot reach them. Each pin is a 1.5rem circle with its number,
  brand green when open, grey when resolved, placed at the element rect plus
  ox/oy, repositioned on scroll, resize and a ResizeObserver on the body.
  Pins whose selector matches nothing are skipped. Clicking a pin posts
  QaPinClickMessage. QaFocusPinMessage scrolls the element into view and
  pulses that pin.

### Workspace UI

- Each frame label bar gets a Comment toggle (aria-pressed, icon
  MessageSquarePlus, 44px). Only one frame in comment mode at a time; turning
  one on turns the others off. Disabled on a closed round.
- A qa:pick from that frame (same origin and source checks as qa:scan, and
  the url path must match the current page) opens a composer popover
  anchored to the frame: element tag and text snippet, textarea, Save and
  Cancel. Save POSTs, then comment mode stays on for the next pick.
- Pins: after load and after every change the dashboard sends each frame the
  QaPinsMessage for its viewport (resent on frame load).
- Issues panel gets a "Comments (n open)" tab: list grouped by viewport,
  number badge, body, element, author, time; actions Show (focus pin, switch
  the mobile viewport if needed), Resolve or Reopen, Edit, Delete (confirm
  dialog), Create request (reuses the create-request dialog, prefilled with
  the comment, then PATCH requestId). A pin click selects its comment in the
  tab.
- Report: a Comments section listing open then resolved comments per page.

## Waves

Wave 1 (Haiku, parallel, disjoint files):
- W1 comments data and API: db/schema.ts, lib/qa-migration.ts,
  drizzle/migrations/0116_qa_comments.sql, migrate route entry 0116, the two
  comment route files, report route additions, tests.
- W2 page discovery API: pages route bulk form, import-sitemap sitemapUrl,
  crawl route, lib/qa/crawl.ts, tests.
- W3 MCP tools for both.
- W4 scanner comment mode, selector, pins, tests.
- W5 wide mode UI (viewport-strip.tsx, round-workspace.tsx, use-workspace-width.ts).
- W6 comments UI components in NEW files only (use-comments.ts,
  comments-tab.tsx, comment-composer.tsx) plus report-content.tsx.
- W7 Add pages dialog (site-content.tsx, add-pages-dialog.tsx).

Wave 2 (Sonnet): wire W6 into round-workspace, viewport-strip,
viewport-frame and issue-panel on top of W5; review all of wave 1.

Wave 3: fresh-context Opus review, fixes, local Chromium run, then Liam
applies 0116 and the push.
