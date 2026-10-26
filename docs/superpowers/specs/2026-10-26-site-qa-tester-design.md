# Site QA tester (admin): design

Status: approved by Liam in conversation, 2026-10-26. Build next.
Task id: SQA (replaces the admin half of WQA.0; the client review-link half stays WQA.0 and gets its own spec).

## Goal

A dashboard feature for the Tahi team to QA the client websites we build (mostly Webflow, staging or live). Add a site to a client, import its pages, then work through a checklist page by page, viewing each page live at five screen sizes side by side, with automatic checks for broken links, accessibility, SEO basics, launch leftovers and page weight.

Not for the dashboard itself. Not client-facing in v1 (review links for clients and reviewers are the next spec, and reuse the viewer and scanner built here).

## Users

Admins only (Liam, Staci). Gated by a new FEATURE_TREE key `qa_tester` (appliesTo team, route `/qa`), plus the standard `isTahiAdmin` org gate on every route.

## Core concepts

- **Site**: belongs to one client org. Name, staging URL, live URL (either may be empty, at least one required), notes.
- **Page**: a path on a site (`/`, `/about`, `/blog/post-a`). Imported from `sitemap.xml` or added by hand. Re-import adds new paths and flags vanished ones (`removedAt`), never deletes.
- **Template group**: when 6 or more pages share a first path segment with a second segment (`/blog/*`), they form a group. A round includes the first 3 of the group as samples; the group header shows the total; more samples can be added.
- **Round**: a named QA pass on one site against one target (`staging` or `live`). Starting a round snapshots the page list into round pages. Rounds are never wiped; closing a round freezes it.
- **Round page**: per page in a round. Five viewport ticks, status (`untested` | `pass` | `fail`), note, who and when.

Viewports (fixed): XL 1920, Desktop 1440, Tablet 768, Mobile L 425, Mobile P 375.

## Architecture

```
Dashboard /qa (Next.js, portal.tahi.studio)
  checklist + 5 scaled iframes  ──src──>  qa-view worker (separate origin, no cookies)
            ^                                   │ validates signed token
            └──── postMessage (scan results) ───┤ fetches upstream page
                                                │ HTMLRewriter: <base>, link rewrite,
                                                │ inject /__qa/scanner.js, strip CSP/XFO/Set-Cookie
                                                ▼
                                        client-site.webflow.io / client.com
Dashboard API (server): link checker, site checks, PageSpeed, persistence (D1)
```

### qa-view worker (`workers/qa-view`)

- Own Cloudflare Worker on its own origin: the workers.dev URL, or a domain on a separate registrable domain (never a tahi.studio subdomain). It must never share an origin or a site with the dashboard: client-site JS runs on this origin, and a `*.tahi.studio` host is same-site with portal.tahi.studio, so SameSite=Lax dashboard cookies would ride along on that JS's requests to admin APIs (a CSRF route) and any `.tahi.studio` cookie would be readable.
- URL shape: `/v/<token>/<path>?<query>`. The token is `base64url(payload).base64url(hmac)` with HMAC-SHA256 over the payload using `QA_VIEW_SECRET` (shared with the dashboard). Payload: `{ o: upstreamOrigin, p: parentOrigin, exp: unixSeconds }`. Lifetime 12 hours.
- Rejects: bad or expired token (403), non-http(s) upstream, upstream host that is an IP literal, `localhost`, or a private range (SSRF guard).
- Fetches `upstreamOrigin + path + query` with GET only, `redirect: 'manual'`. An upstream redirect to the same origin is rewritten to the proxy URL; to another origin it is passed through as a 302 to a small "left the site" page.
- HTML responses go through HTMLRewriter:
  - insert `<base href="{upstreamOrigin}{dirOfPath}">` first in `<head>`
  - rewrite `a[href]` that resolve to the upstream origin into proxy URLs (same token), keeping the hash
  - remove `meta[http-equiv=Content-Security-Policy]`
  - append `<script src="/__qa/scanner.js?t=<token>" defer>` to `<head>`
- Response headers: drop `content-security-policy`, `x-frame-options`, `set-cookie`, `strict-transport-security`; set `content-security-policy: frame-ancestors {parentOrigin}`, `cache-control: no-store`, `x-robots-tag: noindex`.
- Non-HTML responses (rare, since `<base>` sends assets straight to the upstream) are streamed through with the same header scrub.
- `GET /__qa/scanner.js` serves the bundled scanner (includes axe-core).

### Scanner (`workers/qa-view/src/scanner/`, bundled into the worker)

Runs in each frame after `load` plus 1.5 seconds (lets Webflow interactions settle). Posts one message to `window.parent` with `targetOrigin = parentOrigin` from the token:

```ts
{ type: 'qa:scan', version: 1, url, viewportWidth, result: ScanResult }
```

`ScanResult` (shared type in `lib/qa/types.ts`; the worker imports pure modules from `lib/qa/` by relative path, the same way `workers/mcp-server` imports `lib/mcp-identity`, so nothing under `lib/qa/` may import Next.js, D1 or Node APIs):

- `a11y`: axe-core run, tags `wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa`. Per violation: id, impact, help, helpUrl, nodes (selector, html snippet capped 300 chars), max 20 nodes per rule.
- `links`: every `a[href]`, resolved absolute URL (upstream form, not proxy form), text (120 chars), selector. Also `missingAnchors`: same-page `#ids` that do not exist.
- `seo`: title, metaDescription, canonical, robotsMeta, og (title, description, image, url), h1Count, headingOutline (level + text, first 50), headingSkips (e.g. h2 then h4), jsonLd (count, parseErrors), lang attribute, favicon href.
- `content`: imagesMissingAlt (selector, src), stagingLeftovers (occurrences of `webflow.io`, `lorem ipsum` case-insensitive, Webflow placeholder image URLs containing `placeholder` on `uploads-ssl.webflow.com` or `cdn.prod.website-files.com`), forms (action, method, field count, selector).
- `layout`: horizontalOverflow (documentElement.scrollWidth > innerWidth) plus the up to 5 widest offending elements.
- `perf`: images (src, natural size, rendered size, oversized when natural width > 2 x rendered width x devicePixelRatio, format from extension), resource transfer sizes where `performance.getEntriesByType('resource')` exposes them (0 means unknown).

It also listens for `{ type: 'qa:highlight', selector }` from the parent and outlines that element (scrolls it into view), and `{ type: 'qa:rescan' }`.

Viewport-specific results (`layout`, `perf.images`) are stored per viewport. Everything else is taken from the Desktop frame.

### Dashboard server (Next.js API, all admin + `qa_tester` feature gated)

- `POST /api/admin/qa/view-token` `{ siteId, target }` returns `{ token, baseUrl }`. Origin comes from the site row, never the body.
- Sites CRUD: `GET/POST /api/admin/qa/sites`, `GET/PATCH/DELETE /api/admin/qa/sites/[id]` (delete = archive). `GET` supports `?orgId=`.
- `POST /api/admin/qa/sites/[id]/import-sitemap` `{ target }`: fetch `/sitemap.xml` (and nested sitemap indexes, max 5, max 2000 URLs), upsert pages, flag removed, compute groups. Manual pages: `POST /api/admin/qa/sites/[id]/pages`, `DELETE /api/admin/qa/pages/[id]`.
- Rounds: `GET/POST /api/admin/qa/sites/[id]/rounds`, `GET/PATCH /api/admin/qa/rounds/[id]` (rename, close), `PATCH /api/admin/qa/round-pages/[id]` (ticks, status, note), `POST /api/admin/qa/rounds/[id]/samples` (add more group samples).
- Scan results: `POST /api/admin/qa/round-pages/[id]/scan` `{ viewport, result }` stores the latest per viewport (validated shape, size cap 512 KB).
- Link check: `POST /api/admin/qa/rounds/[id]/check-links` `{ urls: string[] }` (max 300 per call). Server fetch with `HEAD`, fallback `GET` on 405/501, `redirect: 'manual'`, follow up to 5 hops, 8 second timeout, concurrency 6, SSRF guard as above. Per URL: final status, hop chain, flags `broken` (4xx/5xx/timeout/DNS), `redirectChain` (2+ hops), `stagingOnLive` (round target live and URL host ends `webflow.io`). Cached per round in `qa_link_results` so a link shared by 40 pages is checked once.
- Site checks: `POST /api/admin/qa/rounds/[id]/site-checks`: robots.txt present and whether it disallows everything; sitemap.xml present; http to https redirect (live only); www and apex resolve to one host (live only); favicon reachable; each check pass/warn/fail with detail. Stored on the round.
- Redirect map: `POST /api/admin/qa/rounds/[id]/redirect-map` `{ urls: string[] }` (old site URLs, max 500): follow each against the live host (path mapped onto the live origin), report final status and destination. Stored on the round.
- PageSpeed: `POST /api/admin/qa/round-pages/[id]/pagespeed` `{ strategy: 'mobile' | 'desktop' }` calls the Google PageSpeed Insights v5 API (optional `GOOGLE_PSI_API_KEY`), stores performance score, LCP, CLS, INP (field data when present, lab TBT otherwise). Live target only, since PSI cannot reach a password-gated staging site.
- Issue to request: `POST /api/admin/qa/round-pages/[id]/create-request` `{ title, description, viewport? }` creates a request on the site's org via the existing request-creation code path, with the page URL, viewport and issue text in the description; stores the request id on the round page (`requestIds` JSON array). No screenshot in v1.
- Report: `GET /api/admin/qa/rounds/[id]/report` aggregate JSON; page `/qa/rounds/[id]/report` renders a printable summary (print to PDF from the browser).

### Data model (migration 0115, additive, IF NOT EXISTS)

```
qa_sites        id, org_id NOT NULL, name, staging_url, live_url, notes,
                created_by, created_at, updated_at, archived_at
qa_pages        id, site_id, path, title, group_key, source ('sitemap'|'manual'),
                removed_at, created_at, updated_at   UNIQUE(site_id, path)
qa_rounds       id, site_id, name, target ('staging'|'live'), status ('open'|'closed'),
                site_checks (JSON), site_checks_at, redirect_map (JSON), redirect_map_at,
                created_by, created_at, closed_at
qa_round_pages  id, round_id, page_id, path, group_key, sort_order,
                vp_xl, vp_desktop, vp_tablet, vp_mobile_l, vp_mobile_p (0/1),
                status ('untested'|'pass'|'fail'), note, request_ids (JSON),
                a11y_critical, a11y_serious, a11y_moderate, a11y_minor,
                broken_links, seo_issues, launch_issues, perf_issues (integer counts, nullable until scanned),
                scanned_at, pagespeed (JSON), pagespeed_at, updated_by, updated_at
                UNIQUE(round_id, page_id)
qa_scan_results id, round_page_id, viewport, result (JSON), created_at
                UNIQUE(round_page_id, viewport)   (upsert: latest wins)
qa_link_results id, round_id, url, final_url, status, hops (JSON), broken, redirect_chain,
                staging_on_live, error, checked_at   UNIQUE(round_id, url)
```

Indexes on every foreign key column. Count columns on `qa_round_pages` are recomputed server-side from the stored scans and link results, so lists never parse JSON.

SEO issue rules (counted into `seo_issues`): missing title; title over 60 or under 15 characters; missing meta description; description over 160 or under 50; duplicate title or description across the round (computed at report time and in the list); missing canonical; canonical host not equal to the target host; `noindex` on a live round; no `noindex` on a staging round (warn only); missing og:title or og:image; h1 count not 1; heading skips; JSON-LD parse errors; missing `lang`.

Launch issue rules (`launch_issues`): staging leftovers; images missing alt (also an a11y item, counted once here); horizontal overflow at any viewport; forms present (an info item, "send a test submission", never submitted by the tool).

Perf issue rules (`perf_issues`): any image over 500 KB where the size is known; oversized images; images not WebP or AVIF (excluding SVG).

## UI

- **Sidebar**: "QA" entry under the same group as Sitemap, adminOnly, feature `qa_tester`.
- **`/qa`**: all sites across clients. Rows: site, client, target URLs, current open round with progress (ticks done / total ticks), issue totals. "Add site" dialog (client picker, name, URLs). Empty state per the canonical pattern.
- **Client detail**: a "Sites" section on the client's overview or settings tab listing that client's QA sites with a link to each, plus "Add site".
- **`/qa/[siteId]`**: site header (URLs, Import pages, Edit), rounds list, "Start round" (name, target). Defaults to the latest open round.
- **Round workspace** (`/qa/[siteId]?round=<id>`), the main screen:
  - Left rail (collapsible, 18rem): progress bar, filters (all / untested / failing / has issues), grouped page list. Each row: path, 5 mini ticks, status dot, issue badge.
  - Main: toolbar (path, prev / next page, target toggle, rescan, PageSpeed, open upstream in a new tab), then the five frames in a horizontal scroll strip. Each frame is the real width, scaled with `transform: scale()` to fit a shared row height, label + tick checkbox above it. Click a frame label to expand it to fit the main area; Escape returns.
  - Bottom panel (resizable, tabs): Accessibility, Links, SEO, Launch, Performance, Notes. Clicking an issue with a selector sends `qa:highlight` to the relevant frame. Each issue has "Create request". Status buttons Pass / Fail and a note field live in the Notes tab and the toolbar.
  - Site-level actions in a round menu: Run site checks, Scan all pages (walks every round page in a hidden Desktop + Mobile P frame pair, sequentially, with progress and cancel; the tab must stay open), Check redirect map, Close round, Report.
- **Report page**: summary counts, per-page table (status, ticks, issues), site checks, redirect map, failing items with notes. Print stylesheet.
- At 375px the workspace shows one frame at a time with a viewport switcher; the checklist becomes a sheet. Admin tool, so desktop is the main target, but it must not break on a phone.
- All states (loading skeletons, empty, error) per CLAUDE.md. Tokens only, dark mode, rem units, leaf radius on primary CTAs, no single-side borders, 44px touch targets.

## MCP parity (worker MCP only)

Tools in `workers/mcp-server/src/qa-tools.ts`: `list_qa_sites`, `create_qa_site`, `import_qa_sitemap`, `list_qa_rounds`, `start_qa_round`, `get_qa_round` (pages with ticks, status, counts), `update_qa_round_page`, `check_qa_round_links`, `run_qa_site_checks`. They call the dashboard API like the existing tool files do.

## Errors and limits

- Upstream fetch failure in the proxy: a small HTML error page inside the frame with the status and an "Open directly" link; the frame label shows "failed".
- Scanner never posts within 20 seconds: the frame shows "no scan" (page probably navigated off-site via JS or blocked the script); the ticks still work.
- Password-protected Webflow staging: out of scope for v1; the proxy shows the upstream password page. Documented in the UI empty state for that case.
- JS that navigates by `location.href` to a same-origin path leaves the proxy; the frame then shows the upstream directly (if it allows framing) with no scan. Accepted for v1.

## Testing

- Vitest: token sign/verify and expiry; SSRF guard (IP literals, private ranges, localhost); the proxy's rewrite decisions as pure functions in `lib/qa/proxy-rules.ts` (base href for a path, whether and how an href becomes a proxy URL, response header scrub, redirect handling); the HTMLRewriter wiring that calls them is covered by the e2e and the live smoke; sitemap parsing (index, nested, cap); template grouping; issue rule counters from fixture ScanResults; link checker hop following with a mocked fetch; route auth (403 for non-admin, feature gate) for each new route family.
- Scanner: a vitest jsdom test for the SEO/content/layout collectors on a fixture HTML page (axe itself is trusted).
- Playwright: one e2e on the local QA harness: add site pointing at a local fixture server, import sitemap, start round, frames load, a scan arrives, tick a viewport, persists after reload.
- Live smoke on production after deploy: one real client staging site end to end, 375px and dark mode pass, per the Definition of Done.

## Liam actions (cannot be done by agents)

1. `wrangler secret put QA_VIEW_SECRET` on the new worker and the same value as a dashboard secret; `wrangler secret put QA_VIEW_ORIGIN` on the dashboard with the worker URL. Both as secrets, not plain vars: the dashboard deploy runs `wrangler deploy` with no `vars` or `keep_vars` in wrangler.json, so a plain var set in the Cloudflare UI would be dropped on the next deploy.
2. Apply migration 0115 on production (command handed over at deploy time).
3. Optional: a custom domain for the worker on a separate registrable domain (never under tahi.studio, see above); optional `GOOGLE_PSI_API_KEY` (also as a secret).

## Out of scope (v1)

Client and reviewer review links with comment pins (WQA.0, next spec), dashboard self-QA, spell check, visual diffs, scheduled re-scans, screenshots on created requests, password-protected staging, Core Web Vitals in bulk.

## Build model

Liam's call, 2026-10-26: built by Haiku agents (haiku-worker), Sonnet (sonnet-worker) as backup when a Haiku task fails or refuses. Each Haiku task is checked by sonnet-reviewer; the whole feature gets a fresh-context opus-reviewer sign-off before it is reported done.
