# Design requirements: client-messages

Group: client-messages. Audience: client. Route: `/messages` (client, hidden today).
Written 2026-09-13 ahead of a Claude Design pass. Source: `CLAUDE.md`, `STATUS.md` ("Since the last update"), `docs/superpowers/plans/2026-09-13-page-catalogue.md`, `docs/superpowers/plans/2026-09-13-design-review-checklist.md`, `TASKS.md`, and the live code under `app/(dashboard)/messages`, `components/tahi/messages/**`, `app/api/portal/messages/**`, `lib/permissions.ts`, `lib/feature-tree.ts`, `lib/org-channel.ts`, `lib/messages-store.ts`.

## 1. Purpose and audiences

`/messages` is the client's inbox: one standing line to the studio ("your studio line") plus one thread per request they can see, all in a single two-pane surface. It exists so a client never has to hunt across request detail pages to find "what did we say to each other" and so the studio has one place client conversation and internal notes about a client both live, filtered by audience.

Who opens it: a signed-in Clerk contact at a client organisation, on desktop or a phone, when the feature is turned on for their org or their seat. Nobody else on the client side reaches it; there is no separate "member" restriction beyond the org-level feature gate (see below), so a member seat and an admin seat see an identical page.

What it must never show, to a client:
- **The Messages surface at all, by default.** `CLIENT_DEFAULT_DENY` in `lib/permissions.ts` turns `messages` OFF for every client org unless an explicit per-organisation or per-contact `feature_visibility` ALLOW override exists (Liam's decision, 2026-09-13: "the request thread is the client channel"). A denied client hitting `/messages` is redirected to `/requests`, not `/overview`, with no flash of the page underneath (`requirePageFeature('messages', '/requests')` runs before render). This is the single most important fact this group has to design around: for the group's own scope, the default rendered state for almost every real client today IS the redirect, not the inbox.
- **Internal notes.** `is_internal` messages are excluded at the query layer (`lib/messages-store.ts`), not just hidden in the UI: they never leave the server for a client session. The composer's "Internal note" tab (`canInternal`) is resolved server-side per thread and never shown to the client audience.
- **Deleted messages**, on either side, and any request outside the client's own org or (when the client has brand links) outside their brand.
- **A Tahi-internal request's thread.** Only requests the client's own portal already exposes are addressable here.
- **Another organisation's channel or threads.** The org channel and every request thread are resolved and scoped to the authenticated caller's `orgId`; there is no cross-org selector on the client side (the client switcher in the header is studio-only).
- **Anything a Tahi admin does while genuinely impersonating.** In "Client view" / "Act as client" preview, the page renders the CLIENT branch and goes read-only: the composer is replaced by a fixed banner ("You are reading this as the client. Replies are read-only in client view.") and every write route independently refuses the preview cookie, so a design cannot rely on the client-only hiding of controls as the only guard.

Job to be done, phrased as the client would: "Show me my line to Tahi Studio and the conversation on each of my requests, tell me what's new, and let me reply or attach something, from my phone or my laptop."

## 2. Pages, sub pages and entry points

There is exactly one route in this group and no sub-routes, dialogs or slide-overs. The whole surface is one component tree rendered by that route.

- **`/messages`** (`app/(dashboard)/messages/page.tsx`). Server component: resolves audience via `getViewAudience()`, gates on the `messages` feature key, then renders `<MessagesContent audience="client" readOnly={isPreviewingClient} />` (or the studio branch, out of this group's scope but sharing the same file). Reached by: the sidebar nav item "Messages" (only present when the feature map allows it), the mobile bottom tab bar's 3rd primary slot (only present under the same condition), and any deep link a notification resolves to `/messages` (see below). There is no "New message" entry point live today: a client cannot start a new conversation from anywhere; every room the client can open already exists (the org channel, auto-vivified on first studio write) or is a request thread hydrated from a request they already have.
- **Two "sub pages" inside the one route, both client-state rather than URL-state** (there is no `?thread=` query param today, unlike Tasks' `?task=`):
  - **The rail (left pane).** A filtered, searchable list of rooms: the studio line pinned first, then a request thread per visible request. Three lenses: All, Unread, Requests (`INBOX_LENSES` = `all | unread | requests`; there is no lens that isolates just the studio line). A search box filters by room name / request number.
  - **The thread pane (right pane).** One open room: header (title, status dot for a request room, people-stack avatars, "Open the request" link on a request room), the message stream (day dividers, one "New" divider at the earliest unseen message, bubbles, voice notes, file chips), and the composer.
- **At <64rem (1024px) the rail IS the page**; opening a room replaces it and a Back arrow in the thread header returns to the rail. There is no independent URL for "room open on phone", so a phone reload always lands back on the rail.
- **No dialog, slide-over or bulk-action surface exists on this page for either audience.** No "New conversation" composer is reachable from the client route (it exists only on the studio's `/api/admin/conversations` surface, out of this group).
- **Deep links into this route:** `lib/notification-links.ts` resolves a `message` notification to `/messages` for a client contact even though the page itself may bounce them straight back to `/requests` on arrival if their org is denied - a DELIBERATE, tested decision (`lib/notification-links.test.ts`) so the deep link never dead-ends, it just reads as "took me to my requests instead."

## 3. States and variants

One line per state. "The page" below means the client-audience render of `/messages`.

- **Denied (today's default for almost every client).** No page renders at all: `requirePageFeature` redirects server-side to `/requests` before paint. No nav item, no mobile tab. This is the state a design pass must treat as real, not edge-case.
- **Allowed, rail loading.** Skeleton rows (five, icon-square + two text bars) in the rail while the inbox fetches; the thread pane shows its own idle empty state simultaneously if nothing is auto-opened yet.
- **Allowed, rail error.** Alert-triangle icon, "We could not load your messages" / "Something went wrong reaching the studio. Try again in a moment.", a Try again button that retries the same fetch.
- **Allowed, rail empty (true empty, no filter active).** Message-circle icon, "No conversations yet", body: "Your line to the studio opens the moment your first request lands. Every request also has its own thread." No CTA button (the client cannot start a room).
- **Allowed, rail empty because of an active filter/search.** Search icon, "No conversations match", "Try a different word, or clear the filter.", a Clear filters button.
- **Allowed, rail populated, nothing selected (idle thread pane, desktop only).** Thread pane shows "Pick a conversation" / "Your studio line sits at the top. Every request you have open also has its own thread." On a phone this state cannot be seen at all in practice: `openThread` auto-selects the first room the instant the rail is ready except when `narrow` is true, and even on phone the rail is what's shown by default, not this empty pane.
- **Thread loading.** Skeleton rows inside the thread body while a room's messages fetch.
- **Thread error.** "We could not open that conversation" / "It may have moved, or the connection dropped. Try again in a moment.", Try again button.
- **Thread ready, truly empty room (a request whose thread nobody has written in yet).** "Nothing here yet" / "Ask a question or leave a note, and it stays attached to this piece of work." (the channel variant of this same empty state, "This is the line for anything that is not about one particular request. Say hello.", is studio-facing copy only because the client's own channel is provisioned before the client ever sees it empty in practice - still worth having a client-facing empty-channel design in case it occurs).
- **Thread ready, populated.** Day dividers, a single "New" divider at the first unseen message (never drawn on the reader's own messages), bubbles with avatar, author name, time, optional file chips and an inline audio player for voice notes.
- **Composer, normal (client can post).** Plain textarea, placeholder "Message the studio" on the channel / "Add a comment or question" on a request thread, hint "The Tahi team will see this", paperclip + mic + Send. No internal-note tab ever renders for a client (`canInternal` is hard-gated to `audience === 'studio'`).
- **Composer, attachment in flight.** A chip per file reading "Uploading" while the presign/upload/confirm cycle runs, replaced by size or an error ("Did not upload") on completion; Send is disabled while anything is busy or broken.
- **Composer, recording a voice note.** Mic button pulses (`recording` class + a dot), stops on a second tap, then uploads through the same R2 flow and sends automatically.
- **Composer, read-only (impersonation preview).** No textarea at all: a single row, eye icon, "You are reading this as the client. Replies are read-only in client view." Same read-only note reused as the page-level banner under the header.
- **Member seat vs admin seat (client side).** No distinct behaviour. `lib/permissions.ts`'s `portalRole` (`admin` | `member`) gates financial surfaces elsewhere in the app but is not consulted anywhere in the Messages code path today; a member contact sees exactly what an admin contact at the same org sees, once the org-level feature is allowed.
- **375px.** The rail fills the viewport; selecting a room replaces it with the thread pane and a Back arrow. Composer sits pinned at the bottom above the mobile tab bar. Touch targets (lens buttons, row buttons, send, mic, paperclip) need to be checked against the 44px rule; nothing in the code enforces a minimum today.
- **768px.** Per the component's own breakpoint (`64rem` = 1024px, not 768px) a 768px viewport is still in the STACKED ("narrow") layout, not the two-pane layout the file assumes kicks in at desktop widths. A design pass should confirm this is the intended breakpoint for tablet, since CLAUDE.md's stated test widths are 375 and 768 specifically.
- **Dark mode.** No dedicated dark-mode escape hatches found in `messages.css` beyond the shared token system; nothing hardcodes a light hex outside the small inline `STATUS_DOT` maps, which already read CSS custom properties. Not yet visually verified live (see section 6).
- **Print / public.** Not applicable; there is no public or printable variant of this page.

## 4. Features and actions

### What works today (client side, from the code)

- One inbox, two stores: the standing org channel (`conversations` row, type `org_channel`) and a per-request thread (still keyed on `messages.request_id`, not copied), read through one shared `lib/messages-store.ts`.
- Search across room name/request number, three lenses (All / Unread / Requests), unread badge per row and a rail-wide unread total on the Unread lens pill.
- Mark-as-read on open (`POST .../read`), with a "New" divider drawn from the cursor captured before the read fires, so it survives the reader's own visit.
- Composer: plain text with `Cmd/Ctrl+Enter` to send, file attachments through the existing R2 presign/confirm flow, voice notes recorded in-browser and sent through the same upload path, all sanitised server-side.
- Files and voice notes render inline (file chip linking to `/api/uploads/serve`, an `<audio>` player with duration).
- "Open the request" link on a request thread's header, to the full request detail.
- Tab-refocus refresh: returning to the browser tab (focus or `visibilitychange`) quietly re-fetches the rail and the open room; there is no live polling or socket otherwise.
- Read-only rendering under Client view / Act-as-client impersonation, independently enforced by every write route.
- Feature-gated end to end: nav, mobile tab, page and both APIs all key off the single `messages` FEATURE_TREE node, so visible only ever means permitted.

### What exists but is wrong, half built, or explicitly flagged in the backlog (client-relevant subset)

- **T2.6 / C3.5b - "Messages polish."** PageHeader instead of the bespoke `<h1>Messages</h1>`, and a general thread-UX pass. The page today has no `PageHeader`, no headline band, no left-rail toolbar pattern the rest of the app uses (catalogue verdict: "Legacy, bespoke h1, no PageHeader").
- **V1-QA.2.** `mobile.spec.ts` and `portal-flow.spec.ts` still assert a visible Messages tab from before the 2026-09-13 default-deny change; they need updating to the new default, not a design concern but relevant context for QA acceptance.
- **T2.6 dependency: no design file has ever existed for this surface as its own critic-reviewed page.** A `Messages` component was found buried inside `portal-files.jsx` in the Claude Design project (see section 6) - undiscovered by the checklist's own bookkeeping, never critiqued, never listed as "not designed yet" either. It is real prior art, not a blank page, but it carries no SHIP/FIX/REDO verdict and predates the 2026-09-13 client-default-deny decision (its mock still shows a "New message" primary button and an offline banner that do not exist in the live client build).
- **"Message edit/delete with permissions, edited/removed indicators"** (T677-T681, "Comments & messages polish") - not built on this surface; a client cannot edit or retract a sent message today.
- **`messageReactions`** - schema exists, zero references anywhere in the app, including here. Batch I (catalogue) frames this as "build or delete," Liam's call, not yet made.
- **Revision counter / request-level activity log gaps** live on the request detail page, not this route, but they touch the same conversation data; noted here only so a design pass does not assume the request thread view here and the one on `/requests/[id]` are perfectly reconciled today (per the "One inbox over two stores" comment, they read the same rows, but the detail page's own comment/checklist affordances are a separate, unfinished surface).
- **No SSE or polling.** The catalogue and TASKS both call out "no polling or SSE" as a known gap (Batch E, E2 adjacent): today's "live" feel is entirely the tab-refocus quiet refresh, so a message a client sends can sit unseen by Tahi (and vice versa) until somebody looks back at the tab.

### What is planned or missing (not built at all; do not design past what's listed here)

- **Batch E, "Messages, unhidden"** (catalogue, `docs/superpowers/plans/2026-09-13-page-catalogue.md` section 4): E1 the new-conversation participant shape fix and auto-adding the assigned team to a client-initiated thread (studio-side work, but its acceptance line names a client sending from a phone and a reply landing in their thread AND their inbox - i.e., email notification parity is part of "unhidden," not just the UI); E2 an org_channel provisioning rule plus polling or SSE; E3 this very design/port pass; E4 the MCP `send_message` / `create_conversation` body-shape fix (CT.17, studio/MCP only); E5 the QA spec updates.
- **A client-initiated "New conversation" affordance.** Nothing in TASKS.md commits to building this for the client audience; the only evidence it was ever considered is the abandoned mock's "New message" button. Treat any client-side compose-a-new-room button as a **proposal**, not a requirement, unless Liam says otherwise in section 7.
- **Notification-preference-aware delivery** for messages (quiet hours, weekly digest, per-channel toggles) is a `/settings` and cron item (T682-699), not a `/messages` UI item, but it is the reason "you sent it and heard nothing back" can currently persist for a while.
- **The GI.1 WhatsApp/Slack chat bot** turning an external message into a request is an adjacent, unbuilt intake channel, not part of this route.

## 5. Data and integrations

- **APIs (client side):** `GET/POST /api/portal/messages`, `GET/POST /api/portal/messages/[source]/[id]`, `POST /api/portal/messages/[source]/[id]/read`, all gated through `app/api/portal/messages/_shared.ts`'s `gatePortalMessages` (org-scoped `getPortalAuth`, the shared `messages` feature key, a hard refusal of any write while impersonating).
- **Tables:** `conversations` (org_channel and request_thread rows), `conversationParticipants`, `messages` (existing table, `conversationId`/`requestId`/`isInternal`/`deletedAt`), `voiceNotes`, `files` (for message attachments), `contacts` (identity + brand scoping), `teamMembers` and `teamMemberAccess`/`teamMemberAccessOrgs` (who is "the studio side" of a client's standing line), `requests` (thread status, brand, assignee), `brandContacts` (brand narrowing).
- **Uploads:** the shared `/api/uploads/presign` -> R2 PUT -> `/api/uploads/confirm` -> `/api/uploads/serve` pipeline, identical to every other attachment surface in the app; a message attachment is not a special upload kind.
- **Third parties:** Cloudflare R2 (files, voice notes). No Resend/email integration wired to this page directly today beyond the general `lib/notification-email.ts` dispatcher's message-related events (CT.4), which fire from the write path, not from this component.
- **Nothing on this page is a fake number or a dead button today**, per the code read: every list, badge, and send action hits a real route; the one thing to watch in a redesign is not to reintroduce the abandoned mock's "New message" button or offline banner without a real write path behind them (both would be dead affordances per CLAUDE.md's honesty rule if added decoratively).

## 6. Design system contract

- **Primitives that should apply and currently do not:** `PageHeader` (the page uses a bespoke `<h1>` + `<p>` pair styled by `messages.css`'s own `.pfm-head` classes, not the shared header component every v3 page uses); the shared left-rail/toolbar idiom other list pages use for filters (Messages built its own `.pfm-left-head` search + lens bar instead of reusing the Requests/Tasks rail toolbar pattern, per T2.6).
- **Leaf radius:** not currently applied anywhere on this page (no icon-background, avatar-wrapper, or primary-CTA leaf shape spotted in `messages.css`); a redesign should apply it per CLAUDE.md's rule ("icon backgrounds, avatar wrappers, primary CTA buttons, feature callouts. Not for every card") - candidates are the studio-mark/request-mark icon badges on each rail row and the Send button.
- **Tokens:** the component already reads CSS custom properties for its status dots and focuses (`tahi-focus-ring` class used throughout), which is the right pattern; a redesign should keep 100% token references, no hardcoded hex, so dark mode keeps working.
- **What the existing (undocumented) design file gets right:** the `Messages` function inside `portal-files.jsx` in the Claude Design project (class prefix `pfm-`, exactly matching the live CSS prefix) already establishes: the same two-lens-plus-search rail, the same day-divider/new-divider/bubble anatomy, the same reply-vs-internal-note composer tab concept (there shown for both audiences; the client build correctly hard-gates it out), a `FileDrawer` for opening an attached file with comment/share/delete affordances that the live build does not have (it just opens the raw file in a new tab), and an "offline" banner state the live build does not implement. Because the live CSS prefix (`pfm-`) already matches this mock's prefix, it is likely the source the current implementation was informally built against, even though no critic ever reviewed it and it is absent from the design-review checklist's own inventory of "designed" and "not designed yet" surfaces.
- **What must change from that file, not be ported as-is:** its header is the same bespoke `pfl-head` markup as the Files page, not `PageHeader` - do not carry that forward. Its "New message" primary button and its offline banner should not be ported unless section 7's question is answered "yes" and a real write path is designed alongside them; today they would be dead or aspirational affordances. Its FileDrawer (comment/share/delete on an attached file) duplicates ground the actual `/files` redesign (CL.1, "small Google Drive with threads") is already targeting - a design pass should decide whether Messages ever needs its own file-preview drawer or should simply deep-link to the eventual Files drawer instead of building two.
- **No critic verdict exists for this surface** (SHIP/FIX/REDO), on either audience, and it is missing from the checklist's own "Not designed yet" bookkeeping list - so this is effectively an undiscovered gap the checklist should also be corrected to name once a real design file is produced.

## 7. Open questions for Liam

1. Should a client be able to start a brand-new conversation (a "New message" button), or does the standing studio line plus one thread per request stay the client's entire compose surface forever? (A or B: A = build a client-facing "New message" entry point; B = never - the request thread and the standing line are the only rooms a client ever needs.)
2. When Messages is allowed for a client org, should the mobile bottom tab bar keep 4 primary tabs by swapping one out, or is 3 primary tabs + "More" acceptable for that org? (Yes/No: does the tab bar need a 5th fallback slot so an allowed client still gets 4 primary tabs?)
3. Is 768px meant to render the two-pane desktop layout, or is the current 1024px breakpoint (stacked below it) the intended tablet behaviour? (A or B: A = lower the breakpoint so 768px gets two panes; B = keep 1024px and treat 768px as phone-style stacked.)
4. Should an attached file open in a preview drawer (with comment/share/delete, echoing the abandoned mock and the planned Files redesign) instead of opening the raw file in a new tab? (Yes/No.)
5. Does the client-facing empty studio-line state ever need its own distinct copy, or is today's shared "No conversations yet" wording (written for both audiences) sufficient? (Yes/No: is a client-specific first-run empty state worth writing.)

## 8. Acceptance for the design review

1. At 1440px light and dark, the header uses the shared `PageHeader` pattern (or an explicit, justified deviation), not a bespoke `<h1>`.
2. At 1440px, the rail and thread pane sit side by side with a visible divider, and the internal-note tab never appears anywhere in the client-audience mock.
3. At 375px light and dark, the rail fills the screen, selecting a room replaces it with a visible Back control, and the composer sits above the mobile tab bar with no horizontal scroll anywhere on the page.
4. Every interactive control in the mock (lens buttons, search, row buttons, paperclip, mic, Send, Back) is at least 44px tall at 375px and has a visible focus ring at 1440px keyboard focus.
5. All five states from section 3 that a real client can actually reach - loading, error, true-empty, filtered-empty, populated - are represented in the mock, using the exact copy quoted in section 3 (or a deliberate, called-out rewrite).
6. The read-only impersonation banner and composer replacement are shown as their own frame, not merged into the normal composer mock.
7. Dark mode swaps every surface, border, and status-dot color via tokens with no hardcoded hex remaining and no contrast regression against the light frame.
8. No control in the mock claims a capability this document's section 4 lists as "planned or missing" (a New message button, an offline banner, message edit/delete, reactions) unless section 7's corresponding question was answered "yes."
