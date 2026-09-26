# Port plan: clients (the studio account layer)

Written 2026-09-26. Critic verdict SHIP after one revision (first pass FIX). Liam has not reviewed the design, so everything below ships as "ported, unchecked" (AGENTS.md, Liam 2026-09-26). Existing app primitives and patterns win over the prototype wherever the two differ. Nothing here is committed.

- Routes: `/clients`, `/clients/[id]` (nine `?tab=` doors), `/clients/brands/[id]`, `/clients/contacts/[id]`.
- Audience: studio only. Owner (super admin, Liam or Staci), admin seat with `clients.billing_card`, member seat without it, a scoped team member, and an admin impersonating a teammate. A client never reaches any of these routes.
- Design files read in full (Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): `clients.jsx`, `clients-kit.jsx`, `clients-detail.jsx`, `clients-extra.jsx`, `clients-people.jsx`, `clients-money.jsx`, `clients-settings.jsx`, `previews/clients-preview.html`. Read in part: `clients-extra.css` (the breadcrumb, skeleton, stale, row action, dry run and leaf page rules). Not read: `clients-data.jsx` and `clients-extra-data.jsx` (sample data only) and `clients.css` (class styling; the port maps every class onto app primitives instead). Design fetched: yes.
- Load order matters when reading the design: `clients.jsx` defines its own `Hero`, `ClientDetail`, `VIEWS` and `Rail`, and `clients-people.jsx`, `clients-money.jsx` and `clients-settings.jsx` override the older `PeopleTab`, `ContactPanel` and tab bodies in `clients-detail.jsx`. The current design is the later definition in each case.
- Other sources: the clients section of `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, `docs/superpowers/design/requirements/studio-clients.md`, `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`, the live code under `app/(dashboard)/clients/**`, and the routes under `app/api/admin/clients/**`, `app/api/admin/contacts/**`, `app/api/admin/brands/**`.
- Page keys (40): list, list-cards, list-loading, list-error, list-stale, list-empty, list-empty-filters, list-empty-scope, list-page-end, list-new, list-archived, detail, detail-requests, detail-invoices, detail-files, detail-people, detail-contact, detail-papers, detail-calls, detail-calls-book, detail-money, detail-money-profit, detail-money-time, detail-money-deals, detail-settings, detail-danger, detail-merge, detail-delete, detail-project, detail-paused, detail-loading, brand, brand-fallback, brand-empty, brand-loading, brand-missing, contact, contact-empty, contact-loading, contact-missing.
- Critic items still open for this module: none. The review doc lists no "Still open" block for clients; the three first pass FIX items (the list-page-end preset among them) were resolved inside the design, and the live list already reaches the past-the-end state from `?page=`.
- Backend: one small hardening only (the brand leaf route's missing scope guard, slice 4). Migration: none.

## 1. What the live code already matches (no work)

The live module is already a port of an earlier cut of this design (CR.1 to CR.4, the nine tab rebuild, the People merge work, IC.2, Decision #060). Page for page it matches or exceeds the prototype here:

- `/clients` list: the shared `<RailLayout>` with seven saved views and live counts (All, Active retainers, Projects, At risk, Paused, Completed, Archived), six filter dimensions (status, plan, health, owner, tag, tracks), sort with a direction toggle, Save as default, list and cards views, whole row checkbox selection, the bulk bar (Export CSV, status, add tag, archive or restore with a confirm), per row Open, View as client, Invite, Archive or Restore behind a kebab and inline on the mobile card, server side paging with an honest page bar and counts note, the New client slide-over with the requirement's fields, MRR admin only with an "Unknown" fallback, and every list state: first load skeleton at 9 or 8 columns, hard error with Try again, stale error banner over cached rows, no clients yet, no match, no match on this page, past the end with Back to page 1, and the Archived subtitle.
- `/clients/[id]` shell: the hero (identity, status badge, tags, industry, website, client since, brand chips, Invite, View as client, overflow menu with Edit, Book a call, Invoices, New deal, Refresh, Pause or Resume when a subscription exists, Archive or Unarchive), the five or four cell stat strip with no dead column, owner reassignment, the roving tabindex `<ClientTabs>` with counts, warn tones and auto scroll, `?tab=` URL state, the money tab gate that silently rewrites a stale `?tab=invoices` or `?tab=money`, and the shared SWR keys between hero and tabs.
- Overview: Needs you (five shown, Show N more, a clear state), track mini kanbans through `<TrackQueueView>` and the "Work in flight" project variant (detail-project), recent requests, the Logged and System activity block, and a rail that is a superset of the design's (Account, engagement health, onboarding, AI health check, health note, request mix, contacts, studio notes).
- Requests, Invoices (four tiles, one overdue predicate, row actions), Files (flat list, search, file panel with R2 serve links), People (portal role, last seen, invite with copy link fallback, edit, duplicate badge, contact merge and delete with reference counts, the quick peek slide-over), Papers (MSA summary line, proposals, contracts and schedules with their own icons and empties), Calls (booking form plus `<DiscoveryCallsCard>`, prep notes since migration 0102), Money (segmented control, one section mounted at a time), Settings (nine sections in the design's order, auto derive pills, Brands CRUD, pointer to `/permissions`, collapsible danger zone), Merge and Delete drawers (super admin only, dry run first, the server's refusals verbatim, typed name gate, accidental workspace offer), and the pause and archive confirms.
- detail-danger, detail-merge, detail-delete, detail-paused, detail-requests, detail-papers, detail-calls, detail-money and the People states need no change.

## 2. What differs, page key by page key

**list, list-cards, list-loading**
- No headline band. The design brief puts a band under every list page header (MRR, Active clients, At risk, Onboarding for a money seat; Active clients, Retainers, At risk, Onboarding without). The app's equivalent is `<KPIStrip>` (Deals, Team, Capacity use it). Onboarding cannot be counted honestly from the list read (see skipped), so the fourth cell becomes Open requests, which the list endpoint already returns per row. Slice 1.
- The bulk bar has no Assign owner, which the requirement lists as working today. `PUT /api/admin/clients/[id]/pm` already exists. Slice 1.
- Live keeps its Status and Tags columns (real fields) and has no per row next call (no list level calls read). Keep live.

**list-empty-scope**
- Live shows the scoped copy only while an admin impersonates a teammate. A real signed in team member with no clients in scope sees "No clients yet" and, when not read only, an "Add the first client" CTA. The design shows the scope copy with no CTA, and a teammate subtitle ("The accounts you work on. Money and settings stay with the owners."). Slice 1.

**list-error, list-stale, list-empty, list-empty-filters, list-page-end, list-archived**: match.

**list-new**: matches the requirement's field list. The design's extra fields are skipped (see section 5).

**detail (hero)**
- Invite to portal: live sends straight to the primary contact. The design opens a menu of every contact not yet in the portal (no login), each sending to that contact, a pending count on the button, "Everyone at X is already in the portal" when none are pending, and Manage seats (People tab). The welcome email route already takes `contactId`. Slice 2.
- Book a call: live's overflow item and the Next call stat's "Book a call" only switch to the Calls tab; the requirement and the design (detail-calls-book) open the booking form expanded. Slice 2.
- The overflow "Invoices" item shows for a seat without `clients.billing_card`, advertising a tab that seat does not have. Gate it. Slice 2.
- The Archive item uses a trash icon; archive keeps everything, so use the archive glyph. Slice 2.
- Brand chips open Settings; the design opens the brand leaf page, which is otherwise reachable only from search. Slice 2 (flagged as a question, section 6).
- Next call shows a date only; the design shows date and time. MRR sub line names the billing model; the design names the rail ("per month, via Stripe"). New deal pushes `/pipeline?...`, which redirects to `/deals`; go straight to `/deals?new=1&orgId=`. Slice 2.

**detail (Overview)**
- "New request" switches to the Requests tab instead of opening the new request dialog with the client filled in. Slice 2.
- The design's Recent files block is skipped (section 5).

**detail-loading**
- Live is a generic three column pulse. The requirement and the design want a hero shaped skeleton: avatar and name lines, stat cells (5 with money, 4 without), the tab strip (9 or 7), then a body. Slice 2.

**detail-invoices**: matches, except the design's New invoice slide-over (skipped, section 5).

**detail-files**: matches. Live also has a Delete action (shipped in 0060dbe1 after the design dropped it); keep live pending Liam's answer.

**detail-people, detail-contact**
- No path from a contact row or the quick peek panel to `/clients/contacts/[id]`. The design adds "Open the contact page" to the row actions and "Full page" to the panel footer. Slice 3.

**detail-money-profit**
- Four separate `Card` tiles (DESIGN.md: several stats are one grouped panel), no margin bar and legend, no gross margin caveat, and a failed read renders a bare line in a card. Slice 3.

**detail-money-time**: totals are an inline sentence; the design leads with three figures (Hours logged, Billable, At the client rate). A failed read shows "no entries". Slice 3.

**detail-money, detail-money-deals**: Revenue and Deals swallow a failed read into zeros or an empty state, which reads as a fact about the client. Add error states. Slice 3.

**detail-settings**
- Only three of nine sections carry the icon tile; the design gives every section one.
- The legacy free text brand labels print as a plain sentence in a card; acceptance item 5 wants them visibly read only and distinct from the live Brands list.
- Brand names in the Brands list do not link to the brand page; the Brands list ignores read only and swallows a load failure into "No brands".
- Danger zone subtitle does not change for a super admin. Slice 3.

**brand, brand-fallback, brand-empty, brand-loading, brand-missing** and **contact, contact-empty, contact-loading, contact-missing**
- Both leaf pages are legacy compositions (hand rolled cards, a header with a single side bottom border, "Brand Details" in title case, no rail). The design composes them like the other detail pages: header, main column plus a 20rem rail that stacks under 64rem, rail cards with an icon tile, a proper missing state instead of a silent bounce, and a skeleton that matches. The brand API route also lacks the feature and scope guards its list route has. Slice 4.

## 3. Slices

Four slices, disjoint files, any order (slice 2 and 3 both touch the client detail but never the same file).

| Key | Title | Days | Backend | Migration |
|---|---|---|---|---|
| clients-list | List headline band, bulk owner, scoped empty state | 1 | no | no |
| clients-detail-shell | Hero, shell wiring and hero shaped skeleton | 1 | no | no |
| clients-detail-tabs | Settings, Brands, People links, Money section states | 1.5 | no | no |
| clients-leaf-pages | Brand and contact leaf pages on the detail composition | 1.5 | yes (scope guard only) | no |

The full self-contained briefs are in the structured return of this plan run and repeated below.

### Slice 1: clients-list

Owned files: `app/(dashboard)/clients/client-list.tsx`, new `app/(dashboard)/clients/_list/clients-band.ts`, new `app/(dashboard)/clients/_list/__tests__/clients-band.test.ts`.

Follow `clients.jsx` (the `bandCells` block near the end of `Clients`, the `list-empty-scope` preset and the teammate `sub` line) and `clients-kit.jsx` (`BulkBar`). Read-only references: `components/tahi/kpi-strip.tsx`, `components/tahi/skeletons.tsx` (`SkeletonKPIStrip`), `components/tahi/bulk-action-bar.tsx` (`BulkAction`), `lib/concurrency.ts` (`mapLimit`), `app/(dashboard)/clients/_list/clients-views.ts`, `app/(dashboard)/clients/_list/use-client-owners.ts`.

1. Headline band. Add a pure helper `clientsBandFigures(rows, mrrByOrg, canSeeMoney)` in `_list/clients-band.ts` that takes the scoped `ClientRow[]` and returns: active count (status active), retainer count (active and engagement retainer), at risk count (health red and not archived), open requests (sum of `openRequestCount` over rows that are not archived), and MRR (sum of `mrrByOrg` over active retainers). Unit test it with vitest (archived excluded, at risk only red, MRR only active retainers, empty input). In `client-list.tsx` render `<KPIStrip>` between `<PageHeader>` and `<RailLayout>`: with money, MRR (`<Money nzd sensitive>`, sub "across N active retainers", value "Unknown" and sub "The MRR read did not load" when `mrrUnknown`), Active clients (sub "N of them on a retainer"), At risk (tone danger when above zero, sub "health has slipped" or "every account is healthy"), Open requests (sub "across N clients"); without money, Active clients, Retainers (sub "paying every month"), At risk, Open requests. Lucide icons in the cell's leaf tile. While `firstLoad` render `<SkeletonKPIStrip cells={4} />`; on a hard error render no band. When `countsNote` is set (the roster is partial), render that same sentence as a caption under the band so the band never implies roster totals. Do not add an Onboarding cell.
2. Bulk Assign owner. Read the team roster with SWR on `/api/admin/team-members` (the key the client hero already uses, items `{ id, name }`). Add a `BulkAction` section "Assign owner" with one action per member plus "No owner", each running `mapLimit(selectedRows, 6, row => PUT /api/admin/clients/{id}/pm { pmId })`, returning `{ ok, failed }`, then revalidating the owners index (use SWR's global `mutate` on the key `useClientOwners` reads) and clearing the selection. Hidden when `writeDisabled`.
3. Scoped seat. Treat `isImpersonatingTeamMember || level === 'team_member'` as a scoped seat: the empty title and body become "No clients in scope for this teammate" / "Their access rules do not reach any client, so this list is empty for them." with no CTA, and the subtitle becomes "The accounts you work on. Money and settings stay with the owners." (the Archived subtitle still wins in the archived view).

States: loading (band skeleton plus the existing table skeleton), hard error (existing card, no band), stale (existing banner, band keeps the cached figures), empty (band shows zeros, which is true when the roster is empty), populated. 375: the band is two columns by two rows, nothing scrolls sideways, the bulk menu items are 2.75rem. Dark: tokens only, the at risk tone uses the KPICell danger tone. Do not change the columns, the page bar, the rail, the New client panel or any file under `components/tahi`.

### Slice 2: clients-detail-shell

Owned files: `app/(dashboard)/clients/[id]/client-detail.tsx`, `app/(dashboard)/clients/[id]/_kit/client-hero.tsx`, `app/(dashboard)/clients/[id]/_kit/loading-skeleton.tsx`.

Follow `clients.jsx` (`Hero`, `ClientDetail`) and `clients-extra.jsx` (`DetailSkeleton`). Read-only references: `components/tahi/menu.tsx`, `components/tahi/skeletons.tsx`, `components/tahi/new-request-dialog.tsx`, `app/(dashboard)/clients/[id]/tabs/requests.tsx` (how it mounts `NewRequestDialog`), `app/api/admin/clients/[id]/welcome-email/route.ts` (body `{ contactId }`, per contact `results`).

1. Invite menu. Replace the single Invite button with a `<Menu>` whose trigger is the same secondary `TahiButton` (keep the mail icon, the "Invite to portal" label and the `LABEL_CLIP` truncation, and give the Menu wrapper `min-width: 0` so the 375 no-wrap row still shrinks rather than pushing the kebab off). Pending contacts are those with no `clerkUserId`; show their count as a small tabular badge on the trigger. Menu content: a label "Send the portal invite to", one item per pending contact (name, email as a second line) that POSTs `{ contactId }` to the welcome email route and toasts the per contact result (sent: "Invite sent to email"; not sent: the route's error plus "Copy the link from the People tab"), or the line "Everyone at {name} is already in the portal." when none are pending; a divider; "Manage seats" switching to the People tab. Disabled with the existing title when there are no contacts; a spinner on the trigger while a send is in flight. Keep `handleInvite` in `client-detail.tsx`, now taking a contact id.
2. Book a call. Add an `onBookCall` prop to the hero that sets `bookOpen` and switches to the Calls tab; wire it to the overflow "Book a call" item and to the Next call stat's "Book a call" link (when a call exists, the link keeps opening the Calls tab without the form).
3. Gate the overflow "Invoices" item on `canMoney`. Swap the archive item's `Trash2` for lucide `Archive` (and `ArchiveRestore` when archived).
4. Brand chips become `next/link` anchors to `/clients/brands/{id}` titled "Open the {name} brand page" (same chip styling, 2.75rem below md).
5. Next call value shows date and time (Intl, en-NZ, for example "Tue 30 Sep, 10:00"). MRR sub line: "per month, via Stripe" or "via Xero" from `effectiveInvoiceChannel`, falling back to the billing model when that is empty; the no MRR sub line reads "hourly, invoiced monthly" for an hourly client and "project, by milestone" for a project one, otherwise the current copy. New deal pushes `/deals?new=1&orgId={id}`.
6. New request from Overview. Mount one `NewRequestDialog` in `client-detail.tsx` with `defaultOrgId={clientId}` and `isAdmin`, copying the Requests tab's `canUseLargeTrack` logic; `OverviewTab`'s `onNewRequest` opens it; `onCreated` revalidates `/api/admin/requests?clientId={id}&status=all` and toasts. The Requests tab keeps its own dialog.
7. Skeleton. Rebuild `LoadingSkeleton` to take `canMoney` and draw: a breadcrumb bar, the hero card (leaf radius avatar block, a title and a meta line, two button blocks and a square kebab), the stat grid with 5 or 4 cells using the hero's own grid classes, a tab strip of 9 or 7 rounded bars inside the same bordered strip shape, then two body blocks. `SkeletonBar` only, `animate-pulse`, `--color-bg-tertiary`, no fixed widths that overflow at 375. Pass `canMoney` from `client-detail.tsx` (it is known before the record loads).

States: loading (new skeleton), error (keep the silent bounce to `/clients`, a Liam question), populated, read only is not a mode here. 375: the hero action row stays one line (two truncating buttons plus a 2.75rem kebab), menu items 2.75rem. Dark: tokens only. Do not add `requirePageFeature` to `page.tsx`, a toast for a stale money tab link, a City field, or a New invoice panel. Do not touch any tab file.

### Slice 3: clients-detail-tabs

Owned files: `app/(dashboard)/clients/[id]/tabs/settings.tsx`, `tabs/brands.tsx`, `tabs/people.tsx`, `tabs/money.tsx`, `tabs/revenue.tsx`, `tabs/profitability.tsx`, `tabs/time.tsx`, `tabs/deals.tsx`.

Follow `clients-settings.jsx` (`Section`, the legacy block, the danger zone copy), `clients-people.jsx` (`PeopleTab` row menu, `ContactPanel` footer) and `clients-money.jsx` (`Profit`, `Time`). Read-only references: `_kit/chrome.tsx` (`TileGrid`, `Tile`, `SubBar`), `components/tahi/empty-state.tsx`, `components/tahi/badge.tsx`, `components/tahi/permissions-context.tsx` (`usePermissions().isSuperAdmin`), `app/api/admin/clients/[id]/profitability/route.ts` (field names).

1. Settings: give every `Section` an icon tile (Building2 organisation details, CreditCard subscription, Tag tags, StickyNote studio notes, Sparkles AI health check, Eye portal visibility; Tracks, Brands and Danger already have one). Legacy brand labels: a block on `--color-bg-secondary` with an uppercase subtle label "Legacy labels, read only", each label as a neutral `Badge`, and the hint "Free text typed on the organisation before the brands table existed. Kept so the history reads straight; nothing reads them today." Danger zone subtitle: super admin "Each of these asks first. Archiving keeps everything; merging and deleting do not." and everyone else "Each of these asks first. Nothing here is permanent." Pass `writeDisabled` into `BrandsTab`.
2. Brands: the brand name becomes a `next/link` to `/clients/brands/{id}` (focus ring, 2.75rem below md, chevron icon). Accept `writeDisabled` and hide Add, Edit and Delete when true. A failed load renders an inline `EmptyState` "The brands did not load" with Try again (SWR `mutate`) instead of "No brands".
3. People: add "Open the contact page" to the row actions (desktop and the mobile card) routing to `/clients/contacts/{id}`, and a secondary "Full page" button in the quick peek panel footer doing the same.
4. Money: pass `org.defaultHourlyRate` into `TimeTab`. Revenue: make the inline fetcher throw when either response is not ok, and render an inline `EmptyState` "The revenue figures did not load" with Try again on SWR error (never zeros). Profitability: replace the four `Card` tiles with `TileGrid` and `Tile` (Revenue, Studio time with "{hours} h at {rate} an hour", Costs as the logged costs total, Gross margin with the margin percent in the hint and the positive or danger tone); under it a margin bar (one rounded track, three segments: studio time, costs, what is left, widths as a share of revenue, `role="img"` with an aria label naming the percent, token colours only) with a three item legend, then the caveat "This is a gross margin, not a true one. Studio time is priced at the client's default hourly rate because there are no salary or rate fields on the team yet, so treat the number as a floor, not a promise." Keep the cost breakdown, the cost form fields (description, amount, currency, category) and the confirmed delete. The failed read becomes an inline `EmptyState` with Try again. Time: lead with `TileGrid` (Hours logged, Billable with its share of the total, At the client rate as billable hours times the NZD rate through `<Money nzd>`, or "No rate set" when the org has none), keep the table, add an error state. Deals: add an error state.

States: every section has loading (existing skeletons), empty (existing copy), error (new, above), populated. 375: tiles one column, the margin bar full width, legend wraps, every button and link 2.75rem. Dark: tokens only; the bar segments must hold contrast on `--color-bg`. Do not build per client health rules, a portal visibility grid, a Revenue invoice table or overdue flag, the design's Preferred currency or City fields, or any change to `lifecycle-danger.tsx`, `org-details-card.tsx`, `subscription-card.tsx` or the Files tab.

### Slice 4: clients-leaf-pages

Owned files: `app/(dashboard)/clients/brands/[id]/brand-detail.tsx`, `app/(dashboard)/clients/contacts/[id]/contact-detail.tsx`, `app/api/admin/brands/[id]/route.ts`, new `app/api/admin/brands/__tests__/brand-id-scope.test.ts` (or the folder the repo's other route tests use).

Follow `clients-people.jsx` (`BrandPage`, `ContactPage`) and `clients-extra.jsx` (`LeafSkeleton`, `ErrorState`). Read-only references: `components/tahi/rail/sidebar-card.tsx` (`SidebarCard`, the detail rail card), `components/tahi/breadcrumb.tsx`, `components/tahi/avatar.tsx`, `components/tahi/badge.tsx`, `components/tahi/status-badge.tsx`, `components/tahi/money.tsx`, `components/tahi/activity-timeline.tsx`, `components/tahi/empty-state.tsx`, `components/tahi/skeletons.tsx`, `app/(dashboard)/requests/[id]/request-detail.tsx` (the grid `grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_20rem] gap-6`), `lib/require-feature.ts`, `lib/require-access.ts`.

1. Guard the brand route. In `app/api/admin/brands/[id]/route.ts` GET, PATCH and DELETE, add `requireFeature(auth, 'clients')` and, once the brand's `orgId` is known, `requireAccessToOrg(database, userId, orgId)`, exactly as `/api/admin/contacts/[id]` does. Vitest: a scoped member outside the org gets 403, an admin gets the brand.
2. Brand page. Breadcrumb Clients, org, brand. Header: a 3.5rem leaf radius mark (the logo on `--color-bg-secondary`, or on load error or no logo a swatch in the brand colour carrying a Palette icon in `--color-text-on-dark`, or the brand gradient tokens when there is no colour), the name as h1, a meta line (colour chip with the hex in capitals, the website with an external icon, "Added {date}"), and on a broken logo the note "The stored logo did not load, so the swatch is standing in." Main column: `SidebarCard` "Brand details" (key value rows: primary colour, website, tagged requests, linked contacts, created; the notes or "No notes on this brand yet. They are written from Settings, Brands on the client page."; a hint "Editing a brand happens on the client page, under Settings, Brands." linking to `/clients/{orgId}?tab=settings`), `SidebarCard` "Contacts linked to this brand" with count (rows as links to `/clients/contacts/{id}`: avatar, name, role and email, Primary badge, chevron, 3.25rem rows; empty copy "Nobody is linked to {brand} yet." with no instruction, because nothing in the dashboard writes a brand to contact link today), `SidebarCard` "Tagged requests" (the big count, "requests are filed under this brand", "View client" to `/clients/{orgId}?tab=requests`, the hint "The individual requests are not listed here. They live on the client page, where the filters and the board already are."; zero keeps the live empty copy). Rail: `SidebarCard` "Organisation" (a full width link to `/clients/{orgId}` with the org avatar, name, plan label and industry, plus the health badge, read from the shared SWR key `/api/admin/clients/{orgId}`; if that read fails show the name only) and `SidebarCard` "Other brands here" (from `/api/admin/brands?orgId=`, each a 2.75rem link with a swatch; empty "{org} runs as one brand.").
3. Contact page. Breadcrumb Clients, org, contact. Header: leaf radius initials avatar, h1, meta badges (role, Primary, "In the portal" when `clerkUserId` else "Not in the portal yet", Admin or Member), actions: Email (mailto, secondary) and, when not in the portal, "Invite" POSTing `{ contactId }` to `/api/admin/clients/{orgId}/welcome-email` with the per contact result toasted. Main: `SidebarCard` "Contact information" (email, role, portal role, phone when present, last login or "Never signed in", added; hint "Name, email, role and portal authority are edited on the client page, on the People tab." linking to `/clients/{orgId}?tab=people`); `SidebarCard` "Activity" with count and an Add action opening the inline form (type select, title, optional description, "Log it" and "Cancel", 2.75rem controls; a failed POST shows an inline error, which the live page silently drops), the existing `ActivityTimeline` rows, empty "Nothing logged against {first name} yet.", and when populated the hint "Everything the endpoint returns is on this page. There is no paging or filter on the timeline yet."; `SidebarCard` "Recent messages" (each message in a bordered block on `--color-bg-secondary`: relative time, body clamped to three lines, "View request" to `/requests/{id}` or "Direct message, not on a request"; empty "{first name} has not written to us yet."). Rail: `SidebarCard` "Organisation" (link card as on the brand page, plus the contact count and health badge from `/api/admin/clients/{orgId}`), `SidebarCard` "Linked deals" (title linking to `/deals/{id}`, stage badge, value through `<Money native currency>`, the deal contact role badge; empty "No deals attached to {first name}.").
4. Missing and error. Both pages stop bouncing silently: a 404, 403 or failed read renders an `EmptyState` inside a `Card`, "That brand is not here" or "That contact is not here", body "The link points at a record that has been removed, merged, or is not yours to see.", action "Back to clients". Loading: header shaped skeleton (breadcrumb bar, 3.5rem mark, two lines) plus three card skeletons in the same grid.

States: loading, missing or error, empty (each card's own copy), populated, logo fallback. 375 and 768: the grid is one column below 64rem, header actions go full width at 2.75rem, rows never scroll sideways, long emails truncate. Dark: tokens only; brand and deal colours are data and may be raw values, nothing else. Do not add in place editing of the brand or contact, a list of the brand's requests, paging on the timeline, a brand row on the contact card (the contact read carries no brand), per contact invite ages ("invited 3 days ago"), or a City anywhere.

## 4. Critic items resolved in the slices

None were left open for this module. The requirement's own acceptance items are covered: 1 and 2 by the live list and hero plus slice 1's band, 3 and 8 by the live strip and hero (kept intact by slice 2), 4 by the live danger zone, 5 by slice 3's legacy block, 6 by the live Money container, 7 by the token only rules in every slice, 9 by slice 4's breadcrumbs and organisation cards, 10 by the live Papers tab.

## 5. Skipped (proposals, Design file only, or waiting on Liam)

The port keeps today's live behaviour for each of these.

- Files tab drive: folders, upload straight to the client, a thread per file (proposal; Liam question 1).
- Removing Delete from the file panel: the design dropped it, the app shipped a real delete afterwards (0060dbe1); live keeps it until Liam answers question 2.
- Per client health rules editor and a per client portal visibility picker (Liam question 5); Settings keeps the pointer to `/permissions`.
- `requirePageFeature('clients')` on `/clients/[id]/page.tsx` (Liam question 6).
- A toast or line for a stale `?tab=invoices` or `?tab=money` link (Liam question 8); the silence stays.
- A caveat on Physitrack's MRR and Money tab (MC.10b, Liam question 3).
- Splitting Money back into separate tabs (Liam question 7); the container stays.
- Header overflow "Import from CSV" and "Studio health rules" (no importer, and the health rules text promises per client overrides that do not exist).
- New client panel extras: City, custom monthly price and track count, Priority and SEO add-on switches, billing channel, account owner. Not in the requirement's field list and not accepted by `POST /api/admin/clients`.
- City anywhere (hero meta, Settings, list search): `organisations` has no city column, so it would need a migration.
- The numbered page bar ("1 to 50 of N"): the list endpoint returns no total; the live bar stays honest.
- Next call per row in the list and cards: there is no list level calls read.
- The band's Onboarding cell: the list read carries only the raw onboarding JSON, which every import seeds empty, while the detail page derives onboarding from requests, invoices and the subscription; counting it on the list would disagree with the detail page. Replaced by Open requests.
- Overview "Recent files": files are stitched per request (one read per request), and there is no client level files endpoint.
- Invoices tab "New invoice" slide-over: the invoices page does not read `?new=1&orgId=` and owns the only create path; live keeps "Open invoices".
- Calls tab details that contradict live: the "calendar invite with a Meet link goes to everyone" copy (booking sends nothing), per call Reschedule, and a Recording button.
- Revenue's overdue flag and full invoice table (duplicates the Invoices tab); live keeps its tiles.
- Settings Subscription toggles the design draws that the live `SubscriptionCard` does not back (the auto invoice switch); the live card stays.
- Contact card brand row and per contact invite age or expiry: neither is on the reads.
- A missing state for `/clients/[id]` itself: no page key draws it, so the live bounce stays.

## 6. Questions for Liam

Carried from the review doc:
1. Files tab: build any of the per client drive (folders, upload from here, a thread per file), and in what order?
2. Files tab Delete: it shipped after the design removed it; keep it?
3. MC.10b Physitrack's two Stripe customer ids: ready to decide, or parked?
4. Brand and contact leaf pages: this plan ports them onto the v3 detail composition from the design (clients-people.jsx) without waiting for your review. OK?
5. Per client health rules and portal visibility overrides (new schema): build either, or does studio wide plus `/permissions` stand?
6. `requirePageFeature('clients')` on `/clients/[id]/page.tsx` for consistency?
7. Money as one container tab, or split any section back out?
8. Silent bounce for a stale money tab link, or a neutral line?

New from this plan:
9. Hero brand chips now open the brand page (the design and the brand page's entry point list) instead of Settings (the requirement's hero line). Keep that?
10. The band's fourth cell is Open requests because onboarding cannot be counted honestly from the list. Is that the right stand in, or should the list endpoint learn onboarding (backend)?
11. Nothing in the dashboard links a contact to a brand (only the seed writes `brand_contacts`). Build that (People tab picker plus an API), or drop the linked contacts card from the brand page?
12. The brand and contact pages now show a "not here" message with a way back instead of silently bouncing to `/clients`. OK?

## 7. Risks

- `/api/admin/brands/[id]` has no feature or scope guard on GET, PATCH or DELETE, so a scoped teammate can read or change any brand by id (CLAUDE.md rule 11). Slice 4 fixes it; if the lead prefers a separate security commit, split that step out first.
- The hero invite menu hands out a claimable access token per contact. It must only list contacts without a login, send one contact per click, and report the route's per contact result; the email allowlist in `lib/email-delivery.ts` still gates real delivery.
- Band figures cover only the loaded page once the roster passes 50; the caption must say so or the band lies the same way the rail counts used to.
- Bulk Assign owner rewrites project manager access rules for many clients in one go; it must use the existing PUT route per row with a bounded fan out and report partial failure, never a raw loop.
- The brand chip behaviour change contradicts one line of the requirement doc (question 9).
- Slices 2 and 3 both change the client detail; they own different files, but a builder who needs a new prop across the boundary (for example `onBookCall` into a tab) must stop and ask rather than edit the other slice's file.
- The live Revenue and Time reads are used by two sections; making their fetchers throw changes the SWR cache entry both read, so check both sections after the change.
- Shared primitives (`KPIStrip`, `SidebarCard`, `Menu`, `EmptyState`, `DataTable`) are used across the app; no slice may modify them.

## 8. Shared files

Other modules may touch these; schedule around them or treat them as read only here.

- `components/tahi/kpi-strip.tsx`, `components/tahi/skeletons.tsx`, `components/tahi/rail/sidebar-card.tsx`, `components/tahi/empty-state.tsx`, `components/tahi/menu.tsx`, `components/tahi/breadcrumb.tsx`, `components/tahi/bulk-action-bar.tsx`, `components/tahi/data-table.tsx`, `components/tahi/new-request-dialog.tsx`, `components/tahi/activity-timeline.tsx` (read only for every slice).
- `app/(dashboard)/invoices/invoice-list.tsx` and `app/(dashboard)/invoices/page.tsx` (portal-money or finance; the day they read `?new=1&orgId=`, the client Invoices button can say New invoice).
- `app/(dashboard)/deals/deals-content.tsx` (sales-pipeline; reads `?new=1&orgId=`, which the hero's New deal relies on).
- `app/api/admin/clients/[id]/welcome-email/route.ts`, `app/api/admin/clients/[id]/pm/route.ts`, `lib/require-access.ts`, `lib/require-feature.ts` (read only).
- `app/globals.css` (no slice needs it).
- `docs/superpowers/plans/2026-09-14-design-review-for-liam.md` (the lead records each port commit in the clients section after merge; boxes stay empty).
