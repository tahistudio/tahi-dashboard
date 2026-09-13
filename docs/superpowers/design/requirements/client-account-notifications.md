# Design requirements: client-account-notifications

Group: client-account-notifications. Audience: client. Routes: `/settings` (client branch only) and `/notifications` (shared route, client-audience behaviour documented here; the team-audience rendering of the same page is out of scope). Within `/settings` this document covers the "Account" group of sections precisely: Profile ("You"), Appearance, Notifications ("What reaches you"), and the "Your team" surface (the People section, which the registry files under a different nav group but which is functionally the fourth of the four rooms Liam named). "Sign-in" is documented as a room the design specifies and the product has not built at all; there is no dedicated `/settings?section=signin` today. This document does not cover Organization, Brand, or Plan & billing (separate `/settings` sections, a different design-requirements group), and it does not cover the standalone `/sign-in` Clerk auth page (a different route entirely, catalogued under "Public and auth").

Source read for this document: CLAUDE.md (design system, mobile and dark mode rules, no em/en dashes), STATUS.md "Since the last update" and the triage snapshot, `docs/superpowers/plans/2026-09-13-page-catalogue.md` (the `/notifications` and `/settings` rows in section 2a, and the notification-capability rows in section 3), `docs/superpowers/plans/2026-09-13-design-review-checklist.md` (the "Account" and "Notifications" rows under Client portal), every `TASKS.md` line naming these routes or their features (T1.14, AR.1, AR.7, AR.8, MR.2, PP.4, CT.9, CT.F, and the "Notifications overhaul remainder" post-launch block T682 to T699), the live code (`components/tahi/settings/settings-shell.tsx`, `components/tahi/settings/sections/profile.tsx`, `appearance.tsx`, `notifications.tsx`, `people.tsx`, `components/tahi/settings/primitives.tsx`, `app/(dashboard)/notifications/page.tsx`, `components/tahi/notifications/notifications-content.tsx` and `notifications-rail.tsx`, `lib/notification-links.ts`, `lib/notification-preferences.ts`, `app/api/portal/team/route.ts`, `app/api/portal/people/route.ts`, `app/api/portal/invites/route.ts`, `app/api/portal/notifications/route.ts`, `app/api/notifications/route.ts`, `app/api/portal/profile/route.ts`), and the Claude Design project (`portal-account.jsx`, `portal-account-kit.jsx`, `portal-account-data.jsx`, `portal-account-sections.html`), read directly with the claude-design MCP.

## 1. Purpose and audiences

Who opens it: every signed-in client contact opens their own Profile, Appearance and Notifications preferences and their own `/notifications` history; only a workspace admin (a contact whose `portalRole` is `admin`, or the org's primary contact under the same predicate `isOrgAdmin`/`isPortalAdminContact` in `lib/portal-access.ts`) can invite, edit or remove a teammate on the "Your team" (People) surface. A Tahi admin previewing "Client view" reaches the same pages read-only: `getPortalAuth` resolves their identity to the org's primary seat for reads (`lib/portal-identity.ts`, AR.8), so the preview shows exactly what that seat would see, but every write is refused server-side (`refusePreviewWrite`), and the People section additionally hides entirely for a preview because the resolved seat carries no real permission to manage anyone's roster on this admin's behalf. A Tahi team member (studio side) reaches a parallel but separately-scoped `/settings` (Profile/Appearance/Notifications rendered for `isAdmin: true`) and their own `/notifications`; this document is scoped to the client reading of both, and the admin/team reading is mentioned only where the same component is genuinely shared.

What this surface's job is: it is the client's one place to say who they are, how the product looks and feels on their device, what reaches them and where, and who else at their company can get in. `/notifications` is the honest, complete record behind the bell: every notification ever sent to this specific person, not scoped by org (`app/api/notifications/route.ts` keys rows on the caller's own Clerk user id), because a person who moves organisations should not inherit somebody else's bell.

What it must never show:
- Any other organisation's people, invites or notification rows. `/api/portal/people`, `/api/portal/invites` and `/api/portal/team` all resolve `orgId` from `getPortalAuth` and filter every query by it; the Tahi admin org id itself is explicitly rejected on all three (`orgId === NEXT_PUBLIC_TAHI_ORG_ID` returns 403), so a client session can never read the studio's own team-member roster through these routes.
- Studio-internal team management. `/settings` team-only sections (Team & access, the granular permissions builder, Studio details, Integrations, Webhooks, Danger zone, and the rest of the Admin/Workspace groups) are `audience: 'admin'` in the section registry and are never reachable in the client branch of `SettingsShell` regardless of what a client types into the URL, because `groupOrder`, `visibleSections` and the rendered component are all derived from the same `isAdmin` boolean the server-rendered page passes down.
- Super-admin-only areas. None of this group's client-facing sections carry a `superAdminOnly` flag (that flag only fires inside the admin branch, gating Modules, Studio details, Integrations, Webhooks, Scheduled jobs, Team & access, Subscription, Client plans, Reserves and Danger zone from a non-super-admin teammate). The client branch has exactly one internal gate worth naming here: `clientAdminOnly` on the People section, which hides "Your team" management controls (not the roster itself) from a client member seat.
- The Messages-hidden rule for clients: Messages is hidden from every client organisation's nav (Giant Group readiness Batch A, STATUS 2026-09-13). Nothing on this surface should imply a client can message the studio through a Messages tab; the "Ask" affordances used elsewhere in the portal (Ask sheets, `mailto:`, or filing a request) are the load-bearing substitute, and this group carries none of them today (see section 4, People has no "ask the studio" escalation beyond a static sentence).
- A client's password, email or two-factor status pulled from Clerk into a workspace-owned field. The one field this group edits directly (`contacts.email` via `/api/portal/profile`) is read-only in the UI on purpose: "This is also your sign-in, so it changes with your login provider, not here" (`profile.tsx`).
- Slack as a client channel. `NotificationsSection` explicitly narrows the client's channel set to `in_app`/`email` only; Slack is a shared team channel and never rendered for `isAdmin: false`.

## 2. Pages, sub pages and entry points

- **`/settings`** (client branch). Reached from the sidebar "Settings" nav item and from in-app links that append `?section=<id>` (for example the Notifications room's own "See everything" link, and `/notifications`' "Email preferences" card, both of which point at `/settings?section=notifications`). `SettingsShell` renders a desktop sub-nav (`hidden md:flex`) grouped as `Account` (Profile, Appearance, Notifications) then `Organization` (Organization, People, Brand) then `Plan & billing` (Plan & billing); below `md` the sub-nav collapses to a single native `<select>` "Settings section" picker grouped by the same `optgroup` labels. Deep-linking is one-way on load only: `?section=` is read once on mount to pick the initial tab, and every subsequent tab switch rewrites the URL via `history.replaceState`, so a bookmarked or shared link into a specific room works, but the URL is not treated as the single source of truth on every render (switching sections after load never re-reads the query string).
- **Profile ("You")**: `?section=profile`. One card: avatar upload (Clerk `setProfileImage`, mirrored nowhere for a contact row since only `teamMembers` carries an `avatarUrl` column), Full name, Email (disabled, with the sign-in note), Role/title, Phone, one Save row. No sub-tabs, no panels.
- **Appearance**: `?section=appearance`. One card, three toggles (Dark mode, Reduce motion, Start with sidebar collapsed), all persisted to `localStorage` only (`tahi-theme`, `tahi-reduce-motion`, `tahi-sidebar-start-collapsed`), never to the server. Shared verbatim between admin and client (`audience: 'both'`); nothing client-specific renders here. Not one of the four "rooms" the Claude Design file names, and has no corresponding design file of its own.
- **Notifications ("What reaches you")**: `?section=notifications`. One card of per-event rows with channel pill toggles (In app / Email for a client; In app / Email / Slack for the studio), keyed against real rows in `notification_preferences`; a second card below it for the "Hold non-urgent email overnight" (quiet hours) toggle; a footer link "See everything that has reached you" to `/notifications`.
- **"Your team" (People)**: `?section=people`, nav label "People", grouped under "Organization" in the registry rather than "Account". Reached only by a workspace admin or member who opens Settings and picks People from the sub-nav or mobile picker; hidden entirely from the sub-nav for a member seat (`clientAdminOnly: true`), though the route itself still renders an (empty-of-actions) read view for a member who deep-links `?section=people` directly, since the gate is cosmetic in the nav and the component itself checks `isClientAdmin` again before showing any action.
  - **Invite teammate dialog**: opened by the "Invite teammate" button (admin/primary contact only), an `EditDialog` with Full name, Email address, Permission level (Admin/Member select, with inline help text). Submits to `POST /api/portal/people`.
  - **Edit teammate dialog**: opened via the row's edit action (`RowActions`), same `EditDialog` shape; the primary contact's own row hides the Permission level field entirely (their level cannot be changed from here). Submits to `PATCH /api/portal/people`.
  - **Remove teammate**: a native `window.confirm`, then `DELETE /api/portal/people?id=`. No slide-over, no dedicated confirm dialog component.
- **`/notifications`** (both audiences; documented here as the client reading). Reached from the bell icon in the top nav, from the Notifications settings room's "See everything" link, from any notification's own click-through once read, and directly by URL. Not gated by any feature flag on purpose (rows are keyed to the caller's own Clerk user id, so there is nothing an org-level toggle could hide). Renders `NotificationsContent` inside the shared `RailLayout` frame (the same frame Requests, Tasks and Clients use).
  - **Views** (mutually exclusive, not tabs plus a second lens): All (last 30 days), Unread (a view, not a filter chip), Past (everything older than 30 days). A desktop rail row on the left; a `ViewTrack` segmented control at the top of the page on a phone.
  - **Kinds** filter (multi-select rail rows below Views on desktop; folds into the same "Filters" bottom sheet as Views on a phone, `variant="sheet"`), by human kind (Requests, Invoices, and so on), never by the roughly 30 internal event-type strings.
  - **"Mark all as read"**: a header action, narrowed to the active kind filter and/or the Past boundary when either is set, otherwise clears the caller's entire inbox including everything under Past (the button's own title text says so before it is clicked).
  - **Row to destination**: clicking a row with a resolvable destination (`lib/notification-links.ts` `notificationDestination`) marks it read and navigates; a row with no client-safe destination (documents, tasks, calls, deals) renders as a flat, unclickable statement, "Nothing to open yet," with its own explicit mark-as-read button.
  - **"Email preferences" card**: at the foot of the desktop rail, and as a card at the end of the feed on a phone (the rail has folded into the sheet there); links to `/settings?section=notifications`.
  - **Read-only banner**: shown only when a Tahi admin is previewing this client's portal; states plainly that this is the admin's own notification history and it is read-only here (not the client's).

## 3. States and variants

**`/settings` shell (client)**
- Loading: the shell itself has no loading state (it is a client component that mounts synchronously); each section owns its own skeleton (see below). The sub-nav and mobile picker render immediately from a static registry, before `usePermissions`/`useResource` resolve, so the list of visible sections can very briefly include or omit People before the client-admin fetch (`/api/portal/profile`) lands, with no explicit loading guard on the nav itself.
- Empty: not applicable to the shell; each section states its own empty condition.
- Error: not applicable to the shell; delegated to each section's own fetch.
- Read-only Client view (admin previewing): `isClientAdmin` resolves to whatever the previewed org's *primary contact* would see (AR.8), so People renders its management controls exactly as that seat would, not as blank or disabled; there is no shell-level "you are previewing" banner on `/settings` itself (unlike `/notifications`, which does carry one).
- Member seat vs admin seat: identical for Profile, Appearance and Notifications (both are `audience: 'both'`, no per-seat branching); People differs sharply (see the People rows below).
- 375px: the desktop sub-nav (`hidden md:flex`) is replaced by the `set-mobilepick` native select; every section's own card layout (see below) is the thing actually tested at this width.
- 768px: still below the `md` breakpoint used by the sub-nav in most Tailwind configs at this project's content width, so a tablet in portrait likely still sees the mobile picker rather than the desktop rail; not verified live per STATUS ("client-session QA of portal sections still pending" under "Settings rebuild").
- Dark mode: the shell and every section here render through `--color-*` tokens (`set-card`, `set-input`, `set-field-note`, and so on in `settings.css`); no page-specific dark-mode note exists in the code comments the way `/invoices` calls out badge-token exceptions, so a reviewer should check for the same class of near-white-on-near-black regression rather than assume it is already handled.
- Print: not implemented, not required.

**Profile ("You")**
- Loading: `ProfileSkeleton`, an avatar circle plus four field-shaped bars, `animate-pulse`.
- Empty: not applicable (a contact always has a name; the form seeds from Clerk if the contact record has not loaded).
- Error: a toast only ("Could not save your profile"); no distinct error page, since the section always has *something* to show once Clerk itself has loaded.
- Read-only Client view: the admin edits *their own* previewed identity fields exactly as a real seat would (Profile has no read-only branch coded at all; nothing in `profile.tsx` checks `impersonating`). This is a gap worth flagging: unlike People and the money surfaces, Profile does not visibly disable Save while previewing, and the write route it calls (`/api/portal/profile` PATCH) may or may not itself refuse the write server-side; not verified in this pass and worth a direct question (see section 7).
- Member seat vs admin seat: identical; every contact edits their own row regardless of `portalRole`.
- 375px/768px: `set-grid2` collapses via CSS Grid `auto-fit`/media query in `settings.css`; not separately pinned by a Playwright mobile spec the way `/invoices` is.
- Dark mode: token-driven; no known contrast bug on record.

**Appearance**
- Loading: none; reads `document.documentElement` synchronously on mount, so there is a real (if brief) flash before the `useEffect` runs, mitigated only by the pre-hydration script in `app/layout.tsx` already having applied the class before React mounts.
- Empty/Error: not applicable, this section has no network fetch at all.
- Read-only Client view: not applicable; these are device-local preferences with no concept of "whose device."
- Member vs admin seat: identical, `audience: 'both'`.
- 375/768: single card, three rows; no layout variance coded.
- Dark mode: this *is* the dark-mode control; verifying it here is closing the loop on the same toggle.

**Notifications ("What reaches you")**
- Loading: a `set-card` skeleton with pulse bars sized to the number of client events (four rows) plus channel-pill placeholders.
- Empty: not a distinct empty state; an unpopulated `notification_preferences` table reads as "everything at default" (`DEFAULTS` in the component), so the row list is never blank, only unconfirmed.
- Error: per-toggle only ("Could not save that change"), with an optimistic UI revert on failure; no page-level error state.
- Read-only Client view: not explicitly handled; a preview session could in principle toggle another client's preferences (no visible disabled state coded here, unlike the money and People surfaces). Worth confirming server-side behaviour directly rather than assuming parity with the other previews.
- Member vs admin seat: same component, different `events`/`channels` arrays (`NTF_CLIENT` vs `NTF_TEAM`); a client never sees Slack, never sees the team-only events (new request, mentions, weekly digest, and so on).
- 375/768: pill chips (`ntf-ch`) and rows wrap via CSS; not independently verified per the design review checklist (no ticked row for it there).
- Dark mode: token-driven; no specific note on record.

**"Your team" (People)**
- Loading: `LoadingShell`, three pulsing rows shaped like the real list.
- Empty: `EmptyRow` "No teammates yet. Invite someone to get started." (shown only when the fetch succeeded and returned zero rows, which in practice should not happen since the caller's own contact row always exists; a true empty state here would itself be a bug worth flagging live).
- Error: `EmptyRow` "Could not load your teammates. Try again shortly." in place of the list.
- Read-only / member seat (`!canManage`): the roster still renders in full (every teammate's name, email, pending state and level chip is visible to a member), but the "Invite teammate" button is absent and no row carries `RowActions`; a static line replaces the actions column area: "Only workspace admins can invite or manage teammates."
- Admin/primary-contact seat (`canManage`): full CRUD as described in section 2.
- Client view (Tahi admin previewing): section 1 already notes the seat this resolves to is the org's real primary contact for reads, so an admin previewing an org where the primary contact is itself an admin sees full management controls rendered, but every write route (`POST`/`PATCH`/`DELETE /api/portal/people`) explicitly checks `impersonating` and refuses with 400/403 before touching the database, so the controls are visually live but functionally inert in preview. This is a real UX gap: nothing in the UI itself disables or explains this (contrast with the money surfaces, which grey out the button and add a title tooltip).
- 375px: `lrow` (list row) layout; not covered by a dedicated mobile Playwright spec the way `/invoices` is.
- 768px: same as 375 presumably (no distinct breakpoint styling called out in the component).
- Dark mode: token-driven (`--bg-tertiary`, `--border-subtle`); no known bug on record.

**`/notifications`**
- Loading: `Skeleton` (six pulsing rows) plus a status-role "Loading your notifications" line.
- Empty (`state === 'ready'`, zero rows in the window): "You are all caught up." with copy that differs by audience and by view (see the exact strings quoted in section 4), and a CTA back to the client's Overview or, on Past, no CTA at all ("Nothing older than thirty days yet...").
- Empty, filtered to a kind with nothing behind it: "Nothing matches those kinds." with a "Clear filters" action.
- Empty, Unread view with nothing unread: "Nothing unread." with a "Show everything" action back to All.
- Error: a full-width error card, "We could not load your notifications." / "Nothing is lost. Try again in a moment." with a retry button; the rail's own counts are deliberately dropped (`setFacets(null)`) rather than left showing stale numbers beside the error.
- Read-only Client view (admin previewing): a `pa-ro` banner above the page header stating this is the admin's own history and it is read-only here; every "mark as read" affordance (row button and "Mark all as read") is disabled with a `title` explaining why.
- Member seat vs admin seat: identical mechanics; only the empty-state copy and the kind vocabulary differ by `audience`.
- 375px: the rail (Views + Kinds) moves into the shared `RailLayout` "Filters" bottom sheet; the segmented `ViewTrack` renders above the feed in its place; render-checked at 1380 and 375 per AR.1's own note, though that note predates the day's later work and should be re-verified after any further change to this file.
- 768px: not separately called out; assume the same rail/sheet breakpoint the other rail-based surfaces (Requests, Tasks) use.
- Dark mode: token-driven throughout (`.pa-*` classes in `notifications.css`); no specific contrast note on record for this page.
- Print: not implemented, not required.

## 4. Features and actions

### `/settings`: Profile ("You")

**What works today**
- Full name, role/title and phone are real, persisted fields: `GET`/`PATCH /api/portal/profile` for a client, backed by the `contacts` table.
- Avatar photo upload/remove goes through Clerk (`user.setProfileImage`), which also updates the shared top-nav avatar immediately.
- Best-effort Clerk first/last name sync alongside the workspace save, so the two names do not visibly drift.
- Honest static copy explaining that email, password and two-step verification "live with your sign-in provider rather than here."

**What exists but is wrong or half built**
- The design's "You" room is one room inside a segmented four-tab "Account" page (`portal-account.jsx`, `Account` component, `SECTIONS` = you/signin/alerts/team, rendered with a measured sliding pill control). The shipped product instead spreads the same four ideas across the ordinary flat `SettingsShell` sub-nav, with three of the four ("You," "What reaches you," Appearance which is not one of the four rooms at all) living under an "Account" nav group and the fourth ("Your team") living under a separate "Organization" nav group. TASKS.md marks MR.2 done as a `[Design]` item ("Account rebuilt as four rooms... 375 verified") and the catalogue/checklist both list it as "ported, live," but no component in the live tree implements the segmented four-room page itself; what shipped is the pre-existing flat settings nav wearing the same four ideas, not the design's single unified surface.
- No read-only handling for an admin previewing a client: unlike People, `profile.tsx` never checks `impersonating`; Save appears fully live during a preview. Whether the underlying `PATCH /api/portal/profile` itself blocks a preview write is not confirmed in this pass.

**What is planned or missing**
- The "Sign-in" room entirely: Change email, Change password, and a Two-step verification row are all drawn in the Claude Design file (`roomSignin` in `portal-account.jsx`, with a `Change email` panel and a `Change password` panel, both staged in `portal-account-sections.html`'s state gallery) and none of it exists in the product. Today the only trace of "sign-in" anywhere in this group is the one static sentence on the Profile card pointing the reader at "your sign-in provider." TASKS.md does carry one loose thread against it: PP.4's own follow-up line names "sign-in card" alongside "welcome page" and "list_notifications MCP tool" as work left over from the Account/Notifications/Offline port, but that follow-up was never promoted to its own numbered item and nothing in the live tree implements it; flagged here as a design-and-build item still to scope, not a "proposal" invented for this document, since the design file already specifies it in full.
- A Sign out action (the design's `roomSignin` foot card, "Signs you out of Tahi on this device only") does not exist anywhere in this settings surface (the product's sign-out lives elsewhere, in the user menu).

### `/settings`: Appearance

**What works today**
- Dark mode, reduce motion and start-with-sidebar-collapsed all genuinely persist to `localStorage` and take effect immediately, including cross-tab sync via the `storage` event and same-tab sync via a `MutationObserver` (so an in-page theme toggle elsewhere stays in step with this section without a reload).

**What exists but is wrong or half built**
- Nothing on record; this section has no open backlog item and no design-file counterpart to compare against, since the four-room Account design does not include an Appearance room at all.

**What is planned or missing**
- Nothing named in TASKS.md or the catalogue for this section specifically.

### `/settings`: Notifications ("What reaches you")

**What works today**
- Per-event, per-channel toggles backed by real `notification_preferences` rows (`GET`/`PATCH /api/portal/notifications`), with an honest default-state fallback (`DEFAULTS`) so an empty table reads exactly as what the send paths will actually do.
- The client event list (`NTF_CLIENT`) is deliberately pruned to events with a real send path: Request updates, Replies, Invoices, and Studio notes (email-only, since the announcement send path writes no in-app row today). Two previously-listed events (`delivery_ready`, `weekly_summary`) were removed from the *label list* because nothing resolves them yet, though the API still accepts and stores them under `EXTRA_CLIENT_EVENT_TYPES` ahead of their eventual send paths.
- Quiet hours (a client reads it as "Hold non-urgent email overnight," 7pm-8am) persists as a real per-user row (`eventType: 'quiet_hours', channel: '*'`), defaulting on.
- A working link out to the full history at `/notifications`.

**What exists but is wrong or half built**
- Quiet hours is stored but not yet consumed: the copy already says "we are wiring this into each alert as it adopts your preferences" (admin copy is blunter: "Mentions and overdue invoices still come through," which is aspirational, not yet true for every send path). The catalogue's "Since the last update" line and TASKS.md's carry-over both confirm: "a reader for the quiet-hours value nothing consumes" is still open (S23/T698-9 territory).
- The design's "What reaches you" room (`roomAlerts` in `portal-account.jsx`) uses richer per-event copy and a `Chan` control pairing In app/Email visually per row inside one list (via `D.PREFS`), plus the same quiet-hours switch; broadly matched by the shipped `NotificationsSection`, but the design's copy set and the shipped `NTF_CLIENT` labels have diverged independently (design-first work was done before the send-path audit trimmed the shipped list), so a design critic comparing the two files directly will find real differences that are not bugs, just two versions maintained separately.

**What is planned or missing**
- A dedicated, richer notification-preferences page/schema (`notificationPreferences` table proper, `S23`) with rich content and per-kind granularity beyond the current flat event/channel matrix (T682-3, T684-5).
- Weekly digest send path plus the quiet-hours consumer (T698-9).
- Zapier/Slack/Web Push are cross-cutting, not client-facing controls that belong on this page, but are worth naming since a reviewer may otherwise wonder why no "connect Slack" affordance exists here: Slack is deliberately studio-only (T570 config surface, Web Push T694-697, both post-launch per STATUS's "Stubs / not functional").

### "Your team" (People)

**What works today**
- Real roster read from `contacts` (`GET /api/portal/people`), showing every teammate's name, email, permission level (Owner/Admin/Member, correctly derived: Owner = the primary contact, never a fourth "Viewer" level since the design's Viewer has no `portalRole` backing and is intentionally not offered) and a "Pending invite" chip for anyone with no `clerkUserId` yet.
- Real invite send (`POST /api/portal/people`, admin/primary-contact only): mints the product's own invite token (not a Clerk organization invitation, deliberately, to keep every recipient inside the email allowlist gate, see `lib/email-delivery.ts`), emails the Studio Ledger `SeatInviteEmail`, and only writes the pending `contacts` row once the email actually sends, so a "Pending" chip always corresponds to a real, deliverable invite.
- Real edit (`PATCH`) and remove (`DELETE`) with a genuine last-admin guard: demoting the sole admin (counted by the same `isPortalAdminContact` predicate the gate itself uses, not a bare `portalRole = 'admin'` count) is refused with a named reason, and removing a teammate correctly detaches them from Clerk first (revokes a pending invitation, or removes an active org membership) before deleting the roster row, so nobody is ever shown as "removed" while still able to sign in.
- Read-only enforcement for a client member seat is real end to end: the nav hides the section cosmetically, the component hides its own action affordances, and every write route re-checks `isOrgAdmin` server-side regardless of what the client renders.

**What exists but is wrong or half built**
- No "Resend" action for a pending invite. The design's `PersonRow` explicitly offers Resend and Revoke for a pending seat; the shipped `PeopleSection` only offers Remove (which the API back end treats as a full revoke/removal, not a resend) via the generic `RowActions` (`onEdit`/`onDelete` only, no `onResend` prop exists on the primitive at all). A studio admin who mistypes an email or whose invite email lands in spam has no in-product way to resend without deleting and re-adding the row.
- A second, parallel bulk-invite path exists at `POST /api/portal/invites` (accepts an array of emails, same token-mint-and-email mechanism), used today only by the client onboarding flow's own team-invite step (`components/tahi/onboarding-content.tsx`), not by this settings page. The two routes are not a bug (different call sites, same underlying mechanism) but are worth naming so nobody "fixes" one assuming it is dead code, or builds a second bulk-invite affordance here without noticing one already exists a few files away.
- Admin previewing a client (Client view): the roster and its management controls render fully live (see section 3), but every write is refused server-side with no visible explanation in the UI itself, with no disabled state and no tooltip, unlike the equivalent read-only handling on the money surfaces. A reviewer should treat this as a design gap on this specific room, not assume it inherits the money surface's polish.

**What is planned or missing**
- Nothing further is named in TASKS.md specifically against this surface beyond the read-path work already covered by T1.14/AR.7/AR.8 (the broader "portal write scoping" effort, not specific to People).

### `/notifications`

**What works today**
- The full All/Unread/Past architecture with server-computed facet counts (`?facets=true`), never counted off the loaded page, so a rail number is always true even before every row has loaded.
- Kind filtering by human category, not the roughly 30 internal event-type strings, plus a kind with genuinely nothing behind it in the window rendering greyed-and-disabled rather than hidden (so the filter's existence stays discoverable and keeps its place in the tab order).
- Honest deep links (`lib/notification-links.ts`): a client-unsafe destination (documents, tasks, calls, deals) renders as a flat, unclickable "Nothing to open yet" row rather than a link that would bounce them.
- Opening a row marks it read before navigating, closing the historical hole where only the request detail page cleared the bell and an invoice or announcement notification stayed unread forever (CT.9's read-state work, extended here).
- "Mark all as read," correctly scoped to the active kind filter and/or the Past boundary, with its own title text stating exactly what it is about to clear before the click.
- A genuine 30-day/Past split with month-grouped headers under Past and day-grouped headers ("Today," "Yesterday," weekday, or a bare date) under All/Unread.

**What exists but is wrong or half built**
- The catalogue (2026-09-13) still lists this page's "what is left" as "Design: TP.4 All/Past history treatment" and "Functionality: preferences page, rich content, sidebar badges (T682-693)," and the design-review checklist marks it merely "no named verdict." Reading the live code against both documents shows TP.4 and the All/Unread/Past half of T691-2 are already shipped in full (AR.1, 2026-09-06) and STATUS's own "Corrections to previous STATUS claims" section separately confirms the SSE stream (T687's dependency) is real, not a stub. Treat the catalogue's TP.4 line and the SSE half of T682-699 as stale bookkeeping, not open work; the genuinely open pieces of that block are named below.

**What is planned or missing**
- A richer `notificationPreferences` schema and preferences page beyond the flat settings toggle (S23, T682-3, T684-5).
- Rich content in notification rows (T684-5): today every row is a title, an optional body string, and a kind icon; no attachments, no inline previews.
- Sidebar/nav badges (T693): no nav item anywhere in the product (not the Notifications page itself, not Settings, nothing) carries an unread-count badge; the only unread indicator in the whole product is the top-nav bell's own number.
- Web Push (T694-697): confirmed by STATUS as a stub with zero service-worker handler.
- Weekly digest cron (T698-9), the other half of the still-unconsumed quiet-hours value noted under the Notifications settings section above.

## 5. Data and integrations

- **`contacts` table**: the backbone of Profile, People and the identity half of Notifications. Columns touched here: `name`, `email` (read-only in the UI), `role`, `phone`, `portalRole` (`admin`/`member`), `isPrimary`, `clerkUserId` (null = pending invite).
- **`teamMembers` table**: read (never written) by `/api/portal/team` to populate the client home's "Your team" card (the studio-side people assigned to this org), which is a *different* surface from the "Your team" (People) room documented above. `team_member_access` / `team_member_access_orgs` supply the assigned project manager; `settings['studio.projectManagerId']` and `settings['leads.defaultLeadOwnerId']` supply the studio-wide override and the last-resort fallback respectively.
- **`notification_preferences` table**: the Notifications settings section and the send paths it eventually gates both read/write here, keyed `(eventType, channel)` per caller.
- **`notifications` table**: `/notifications` and the bell both read/write here, keyed to the caller's own Clerk user id (never an org id).
- **`onboardingInvites` table** (via `lib/onboarding-invites.ts` `ensureClientInvite`): the token both `POST /api/portal/people` and `POST /api/portal/invites` mint or reuse; `DELETE /api/portal/people` expires a pending row's token here so an old email link cannot rejoin the workspace after removal.
- **Clerk**: organisation membership itself (never a Clerk organization invitation for a client colleague, by deliberate design: Clerk's org-invitation API has no way to suppress its own email, which would bypass `lib/email-delivery.ts`'s allowlist entirely). `POST /api/portal/accept-invite` is the route that actually joins the *existing* Clerk org via `createOrganizationMembership`, sending no Clerk mail. `DELETE /api/portal/people` calls Clerk directly to revoke a pending invitation or remove an active membership before the D1 row is deleted.
- **Resend, through `lib/email-delivery.ts`**: the one door every invite email and every notification email goes through; enforces the allowlist policy (`email.deliveryMode`, `email.allowedAddresses`, `email.allowedDomains`, `email.allowedOrgIds`, `email.blockedAddresses`) and logs a withheld send to `email_suppressions` rather than silently dropping it. Both invite routes correctly surface a distinct 409 ("Held back by the email allowlist") rather than a generic failure when this is why nothing sent.
- **Must be honest, no fake numbers, no dead buttons, specifically on this group:**
  - The People "Resend" gap (section 4) means there is currently no button that claims to resend and does not; the gap is an absence, not a lie, but a reviewer proposing a Resend button must wire it to a real re-send of the existing `onboardingInvites` token, not merely re-run the invite POST (which would 409 on "already on your roster").
  - Quiet hours' copy already hedges honestly ("we are wiring this into each alert as it adopts your preferences") rather than promising a behaviour that does not exist yet; any redesign of this copy must preserve that honesty rather than overstate it.
  - `/notifications`' empty and error states never show a stale count beside a failure (facets are explicitly cleared on error); any redesign must preserve this rather than "simplify" it into always showing the last-known numbers.

## 6. Design system contract

- **Primitives that apply:** `PageHeader` (used on `/notifications`, absent from `/settings`, which uses its own `SectionShell`/`set-*` card system instead, and the two surfaces do not currently share a header component, which a design pass should either reconcile or explicitly justify keeping distinct); `RailLayout` plus `RailViewItem`/`RailGroupLabel` (the same rail primitive Requests, Tasks and Clients use, correctly reused on `/notifications`); the settings-specific primitives in `components/tahi/settings/primitives.tsx` (`SectionShell`, `AvatarUpload`, `Toggle`, `Chip`, `EditDialog`, `RowActions`, `EmptyRow`, `Toasts`); leaf radius is not visibly applied anywhere in this group's own markup beyond whatever the shared button/icon primitives already carry (no bespoke leaf-radius callouts in `settings.css` or `notifications.css` comments); tokens are used consistently via CSS var references throughout both stylesheets, which is the one rule this group's code comments repeatedly call out by name (see the `--color-link` vs `--color-brand-dark` contrast note preserved verbatim in `notifications.tsx`).
- **What the existing design file gets right:** `portal-account.jsx`'s four-room "Account" page is a materially better information architecture than the shipped flat sub-nav split across two nav groups: one page, one segmented control, one mental model of "everything about me and my colleagues," rather than three unrelated-looking items under "Account" and a fourth item exiled to "Organization." The design's Sign-in room is a real, needed surface the product has never built. The design's People room (`roomTeam`) correctly includes Resend for a pending invite, which the shipped version lacks. The design's read-only preview state (`ctx.inPreview`/`ReadOnlyBar`) is a pattern the shipped People section should adopt visibly rather than only enforcing invisibly server-side.
- **What the design must change:** the design file has not been critic-reviewed at all for this group; neither the catalogue's "Design and verdict" column nor the checklist carries a named verdict (SHIP/FIX/REDO) for "Account" or "Notifications," only "not critic-covered" and "no named verdict" respectively. Before any port work is scoped, this group needs its first formal critic pass, specifically checking: whether the four-room segmented-slider pattern is still the intended target now that the shipped product has lived inside the flat sub-nav for some time (a genuine "keep the design" vs. "the shipped IA won and the design should follow it" decision, not a default); whether the design's `NTF_CLIENT`-equivalent event copy (`D.PREFS`) should be reconciled word-for-word with the shipped, send-path-audited event list rather than maintained as two independently drifting copies; and whether Appearance (which the design does not model as a room at all) gets folded into "You" or stays a standalone settings entry outside the four-room pattern.

## 7. Open questions for Liam

1. Is the four-room segmented "Account" page (`portal-account.jsx`) still the target design, or has the flat `SettingsShell` sub-nav (which is what actually shipped and is what MR.2 was ticked against) superseded it as the real information architecture going forward?
2. Should "Sign-in" (change email, change password, two-step verification) be built as a genuinely new room inside Account, given none of it exists in the product today and Clerk's own hosted account pages are the only current way a client can do any of those three things?
3. Should Appearance move inside the "You" room to match the design's three-room-plus-Appearance-elsewhere split, or stay a separate top-level settings entry the way it is today?
4. Should the People section gain a one-click "Resend" for a pending invite (matching the design), or is delete-and-reinvite the intended permanent behaviour?
5. Should a Tahi admin previewing a client see People's invite/edit/remove controls rendered disabled with an explanation (matching the money surfaces' pattern), or is the current silent-server-side-refusal acceptable?
6. Is the second, parallel `POST /api/portal/invites` bulk-email path (onboarding-only today) meant to ever surface inside this settings People section as a "bulk invite" option, or should it stay onboarding-exclusive permanently?

## 8. Acceptance for the design review

1. At 1440 and at 375, the Account group (Profile, Appearance, Notifications) and the People section are each reachable from the settings nav (desktop sub-nav at 1440, the native select picker at 375) with no horizontal scroll and every control at least 44px tall at 375.
2. Profile's avatar upload, name, role and phone fields render and the disabled Email field visibly reads as non-editable (not merely non-functional) at both widths, light and dark.
3. Notifications ("What reaches you") shows exactly the client's four events (Request updates, Replies, Invoices, Studio notes) with the correct channel set (In app/Email only, no Slack), and the quiet-hours toggle renders with its client-audience copy, not the admin copy, at both widths, light and dark.
4. People renders the roster with correct level chips (Owner/Admin/Member, never a fourth level) and a Pending-invite chip on any unclaimed row; a member-seat screenshot shows no Invite button and no per-row actions, only the "ask a workspace admin" sentence.
5. `/notifications` at 1440 shows the rail (Views with counts, Kinds with counts, a greyed empty kind) alongside the feed; at 375 the same controls appear inside the Filters sheet and the Views track renders as a segmented control above the feed, with no horizontal scroll.
6. `/notifications`' three empty-state variants (all caught up, nothing unread, nothing matches those kinds) each render their correct icon, headline and single action, distinguishable from one another in a screenshot.
7. Dark mode on both `/settings` (any client section) and `/notifications` shows no near-white-on-near-black text and no unreadable pill/chip combination (the unread dot, the kind icons, and every `pa-*`/`set-*` badge specifically).
8. A read-only Client-view screenshot of `/notifications` shows the "You are previewing the portal" banner and every mark-as-read control visibly disabled with a tooltip; the equivalent People screenshot (if the design changes to add one per question 5) shows the same pattern rather than silently-inert live-looking buttons.
