# Port plan: messages

Written 2026-09-26. Status: plan only, nothing built. Ships as "ported, unchecked" (Liam has not reviewed the designs).

- Module: messages (Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66)
- Route: `/messages`, one route, both audiences (studio inbox and the client's line to the studio). No sub-routes.
- Audience: both. The client branch is default-denied (CLIENT_DEFAULT_DENY), so almost every real client is redirected to `/requests` and never sees it.
- Backlog ids: T2.6 (C3.5b) "Messages polish", catalogue Batch E item E3.
- Design files read (fetched through the claude-design MCP, not from memory): `messages.jsx`, `messages-kit.jsx`, `messages.css`, `messages-data.jsx`, and the band and rail sections of `head-band.css`.
- Also read: the messages section of `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, `docs/superpowers/design/requirements/client-messages.md`, `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`, the live code (`app/(dashboard)/messages/*`, `components/tahi/messages/*`, `lib/messages-inbox.ts`) and the routes it reads (`app/api/portal/messages/**`, `app/api/admin/messages/**`, `app/api/admin/conversations/route.ts`).
- Preview: `previews/messages-preview.html?page=<key>`, plus `&audience=client`, `&theme=dark`, `&device=phone`.

## 1. The short version

The live page was built informally against the older `pfm-` mock, so the data flow, the gating, every state and nearly every piece of copy already match the new design. The port is a presentation pass on the frame and a tidy-up of the thread and composer, not a rebuild. Nothing needs a new API route or a migration.

What changes: the bespoke `<h1>` becomes `PageHeader`; a four-tile headline band goes under it; the rail's lens pills become the house rail (Views with counts, and for the studio a Filters section holding the client picker that sits in the header today); rows, bubbles, chips and the composer pick up the design's details; phones get a document-flow list and a full-height thread; the last hardcoded hex goes.

What does not ship: anything that needs studio direct or group rooms projected into the inbox (the New conversation dialog, the Internal view, the Internal rooms tile), the "Not in their portal" chip and banner, the custom voice-note waveform player, and every item the design already leaves out (client New message, offline banner, edit or delete, reactions, a file preview drawer).

Two slices. Slice B (thread and composer) merges first, slice A (frame, band, rail) second. The order is deliberate: see section 6.

## 2. What the live code already matches (no work)

- One component tree for both audiences: `MessagesContent` with `audience` and `readOnly` props, the endpoint prefix switching between `/api/portal/messages` and `/api/admin/messages`.
- The gate: `requirePageFeature('messages', isClientAudience ? '/requests' : '/overview')` runs before render. A denied client never sees a flash of the page. The design's `client-denied` key is a documentation frame of exactly this behaviour.
- Two panes at 64rem and up, stacked below it (the design's 800px-of-page stack point is today's 64rem viewport breakpoint seen through a sidebar). Desktop auto-opens the first room through `openThread`; a phone never auto-opens.
- Every rail state with the requirement's exact copy: skeleton rows, "We could not load your messages" plus Try again, "No conversations yet" with both audience bodies, "No conversations match" plus Clear filters.
- Row anatomy: leaf studio mark on the channel, status dot on a request, `TR-<n> <title>`, relative time, `Author: snippet` preview (Voice note fallback), a tag pill (Your studio line, Client line, or the status label), the client-name pill on the studio's unfiltered inbox, an unread count badge.
- Thread head: title, status dot and label (plus org name for the studio), the studio side of the client's line read from the room's people, a people stack, Open the request, a Back button on phones.
- Stream: local-day dividers, one New divider drawn from the cursor captured before the read fires and never on the reader's own message, own and other and internal bubbles, sanitised HTML bodies, file chips that open the raw file in a new tab (open question 7.4 answered by keeping this), a live region that announces arrivals only.
- Composer: plain textarea with Cmd or Ctrl plus Enter, placeholders and hints per room and audience, the studio-only Reply to the client and Internal note tabs resolved server-side (`thread.canInternal`), mode owned by the page so the mic honours it, the attachment tray with Uploading and Did not upload, Send held while anything is busy or broken, mic recording through the same R2 flow, the read-only composer in Client view.
- The read-only page banner in Client view, and every write route refusing the preview cookie independently.
- Tab-refocus refresh, the channel placeholder re-pointing after the first send, mark-as-read on open.
- Pane idle copy ("Pick a conversation") and thread empty copy for both a request and a channel.

None of that is touched except where a slice below restyles it.

## 3. Page key by page key

| Key | Live today | Port |
|---|---|---|
| client-inbox | Channel open, populated | Slice A: PageHeader, band, rail views, row restyle. Slice B: own bubbles read "You", file icon on chips, New divider styling, avatar stack from the primitive. |
| client-thread | Request open | Slice B: status dot and label from `REQUEST_STATUS_CONFIG` tokens; Open the request as a TahiButton that goes icon-only on a phone. |
| client-loading | Rail skeleton, idle pane | Slice A: add the band in its loading form (same four tiles, bars in place of figures) so nothing jumps; rail skeleton via `SkeletonList`. |
| client-error | Rail error, idle pane | Slice A: restyle the error block. The band is hidden on error rather than drawn with zeros (deviation, see 4.4). |
| client-empty | True empty, copy matches | Slice A: `EmptyState` with the leaf glyph; band reads zeros with the empty sub-lines. In practice the portal always returns the synthetic channel row, so this is rare. |
| client-filtered | Filtered empty, copy matches | Slice A: `EmptyState` with the search icon and Clear filters, which also resets the studio's client filter. |
| client-idle | Pick a conversation | Slice B: `EmptyState`, copy unchanged. Reachable on desktop only for the instant before auto-open. |
| client-thread-loading | Pane skeleton | Slice B: `SkeletonList rows={4}` inside the pane body. |
| client-thread-error | Pane error, copy matches | Slice B: icon plus TahiButton Try again, copy unchanged. |
| client-thread-empty | "Nothing here yet", copy matches | Slice B: `EmptyState` with the leaf glyph. |
| client-composer | Gallery of five composer states | Slice B builds every state into the real composer: resting (Send held), typed, attachment in flight (spinner in the chip), attachment failed (alert chip plus the warn line), recording (pulse plus the status line). The gallery page itself is preview-only. |
| client-readonly | Banner plus read-only composer | Slice A: banner as `Callout`. Slice B: fix the composer note, which reads "You are reading this as Tahi Studio" today because `clientName` is 'Tahi Studio' on the client branch. |
| client-denied | Server redirect to /requests | No work. The frame documents live behaviour. |
| studio-inbox | Rail with three lenses, client switcher in the header | Slice A: Views All, Unread, Client lines, Requests; Filters section with a searchable Client picker (moved out of the header); band with Request threads in place of Internal rooms. The "Not in their portal" chip is skipped. |
| studio-internal | Group room with the Internal note tab on | The group room is skipped (needs E1). Slice B ports the amber internal composer, bubbles and chips on badge-warning tokens, and gives a Tahi-internal request thread the design's internal-room note and hint, which fixes a live hint that tells the studio "the client will see this reply" on a request no client can see. |
| studio-quiet | Client line nobody has written on | Already matches (channel empty copy). The permissions banner is skipped. |
| studio-empty | Studio true empty, copy matches | Slice A as client-empty. |
| studio-new | New conversation dialog | Skipped. A direct or group room created here would never appear in this inbox, because `lib/messages-inbox.ts` projects channels and request threads only. |

## 4. Where live patterns win over the prototype

Liam's rule for this pass: existing primitives and patterns win where they differ. These are the deliberate deviations; builders must not "fix" them back to the prototype.

1. **Header:** `PageHeader` (components/tahi/page-header.tsx), not the design's `.msg-head`. The same wrapper the requests list uses: a column with `padding: 1.25rem 0` and a `0.875rem` gap; `.dashboard-main` owns the side gutters, so the design's own page padding is dropped.
2. **Band:** the app has no port of `head-band.css` yet. The band is built from `KPIStrip` and `KPICell` (components/tahi/kpi-strip.tsx). The design's lead-tile accent fill and meter do not exist in KPIStrip and are not added; the lead tile is approximated with `tone="brand"` on the first cell and `tone="neutral"` on the rest, `tone="warning"` on a Waiting tile when its count is above zero. If another module's port lands a shared headline band primitive first, use that instead and do not write a second one here.
3. **Rail controls:** `RailGroupLabel`, `RailViewItem` and `RailSelect` from components/tahi/rail/rail-controls.tsx, not the design's `.lrail-*` classes. Below 64rem the views become a `SegmentedControl` (fill variant) and the studio's client picker a `RailSelect` with `touch`, the way Notifications folds its rail on a phone, instead of the design's "Views and filters" disclosure.
4. **Band on error:** hidden. The design's preview draws the band beside the rail error from static data; live, a failed read has no honest figures, and the rail error is the one message.
5. **Empty and loading:** `EmptyState` and `SkeletonList` (components/tahi/empty-state.tsx, components/tahi/skeletons.tsx) instead of the bespoke `.pfm-empty` and `.pfm-skel` blocks. Error blocks stay bespoke (no shared primitive carries a title, a body and a retry), restyled to the design's centred block.
6. **Buttons:** `TahiButton` (secondary, size sm) for Try again, Clear filters and Open the request; it already raises itself to 2.75rem on phones. Send stays the page's own brand-green button with the leaf radius, which is what the request composer's Send is too (TahiButton primary is the lime accent and would not match either).
7. **Avatars:** the `Avatar` primitive and `Avatar.Stack`, circular. The design's leaf-shaped initials avatars are not ported.
8. **Bubbles:** the page keeps its own light bubble. `MessageBubble` (components/tahi/message-bubble.tsx) is not adopted: it loads Tiptap and carries reactions, edit, delete and reply actions this surface deliberately does not have.
9. **Breakpoint:** stays the `(max-width: 63.9375rem)` media query already in `messages-content.tsx` and the `64rem` rules in CSS, not the design's ResizeObserver on page width (open question 7.3 kept at today's behaviour).
10. **Pill radius, status wording:** tag pills use the `Badge` primitive (`tone="neutral"`, `size="sm"`); request status dots come from `REQUEST_STATUS_CONFIG` tokens (lib/status-config.ts) instead of the two duplicated `STATUS_DOT` maps; the client keeps "Your review" and the studio reads "Client review" for `client_review` (today the studio also reads "Your review", which is the client's wording).
11. **Read-only copy:** "You are reading this as the client. Replies are read-only in client view." on both the page banner and the composer note, exactly the requirement's copy.

## 5. Token mapping for anything carried over from messages.css

The design's variables are the prototype's names. Use the app's tokens from app/globals.css:

- `--text` to `--color-text`; `--text-muted` to `--color-text-muted`; `--text-faint` to `--color-text-subtle`.
- `--bg`, `--bg-secondary`, `--bg-tertiary` to `--color-bg`, `--color-bg-secondary`, `--color-bg-tertiary`.
- `--border`, `--border-subtle` to `--color-border`, `--color-border-subtle`.
- `--brand` to `--color-brand`; `--brand-100` to `--color-brand-100`.
- `--brand-strong` as ink on text or icons to `--color-link` (brand-dark has no dark override and reads about 2.2:1 on the dark card); as a hover fill to `--color-brand-dark`; on a brand-50 tint use `--color-brand-on-tint`.
- `--msg-warn` (amber, internal notes) to `--badge-warning-text` for ink, `--badge-warning-bg` for fills, `--badge-warning-border` for borders. This replaces the live `--pfm-warn: #9A6714` and its dark twin, the last hardcoded hex on the page.
- `--msg-danger` to `--color-danger-ink` for ink and `--color-danger-tint` for fills.
- `#fff` on a brand fill to `--color-text-on-dark`.
- `--radius-leaf` to `--radius-leaf-sm` on the small icon tiles and on Send; `--ease` to `--ease-out`; transitions use `--motion-quick`.
- Any `color-mix(... var(--brand) N%, var(--bg))` from the design is fine to keep with the mapped names; it follows dark mode.

No hex anywhere in either slice's files, no `rgba()` literals, no single-side borders (dividers are the grid's 1px gap or a 1px pseudo-element hairline), rem units only, no em or en dashes in copy or comments.

## 6. Slices

Two slices with disjoint files. Build them in parallel; **merge slice B first, then slice A**. Slice A imports `components/tahi/messages/status.ts` (created by B) and deletes the old thread and composer rules from `messages.css` that become dead once B has renamed its classes. The `ThreadPane` and `MessageBox` prop interfaces are frozen: neither slice changes them, so the parent (A) and the children (B) never have to be edited together.

### Slice B: thread pane and composer (merge first)

Owned files: `components/tahi/messages/thread-pane.tsx`, `components/tahi/messages/message-box.tsx`, `components/tahi/messages/status.ts` (new), `app/(dashboard)/messages/messages-thread.css` (new). Size: 1 day. No backend, no migration.

Brief:

Follow `messages-kit.jsx` (PeopleStack, EmptyBlock, ErrorBlock, DayDivider, NewDivider, FileChip, Bubble, Stream, Composer), `messages.jsx` (PaneHead, Pane) and the thread-pane, stream, composer and narrow sections of `messages.css`, page keys client-thread, client-inbox, client-thread-loading, client-thread-error, client-thread-empty, client-idle, client-composer, client-readonly and studio-internal.

1. Create `components/tahi/messages/status.ts` exporting `inboxStatusLabel(status: string | null, audience: 'client' | 'studio'): string` (sentence case; `client_review` reads "Your review" for the client and "Client review" for the studio; everything else from `REQUEST_STATUS_LABEL` in lib/messages-inbox.ts, falling back to "Request") and `inboxStatusDot(status: string | null): string` returning the `dot` token from `REQUEST_STATUS_CONFIG` in lib/status-config.ts, falling back to `var(--color-text-subtle)`. Delete the local `STATUS_DOT` map in thread-pane.tsx and use these.
2. Create `app/(dashboard)/messages/messages-thread.css` and import it at the top of thread-pane.tsx with `import '@/app/(dashboard)/messages/messages-thread.css'` (the settings shell already imports route CSS this way). Every class this slice renders uses a new `pmt-` prefix; after this slice, thread-pane.tsx and message-box.tsx must reference no `pfm-` class at all (slice A deletes those rules). The file owns: the pane (flex column, `min-height: 0`, `min-width: 0`, `flex: 1`, background `--color-bg`), head, body scroller, stream, dividers, bubbles, chips, voice wrapper, composer, tray, icon buttons, error block, and their 64rem and narrow rules.
3. Head: title (ellipsis), subtitle (keep today's copy: the studio side of the client's line for the client, "The standing line with <org>" for the studio, status dot and `inboxStatusLabel` plus ", <org>" for a studio request), `Avatar.Stack` with `max={4}` of the room's people (replaces `.pfm-stack` and `.pfm-face`), and Open the request as `TahiButton variant="secondary" size="sm"` wrapping a next/link to `thread.href` with an ExternalLink icon; below 64rem the label is visually hidden (keep the accessible name) and the button is a 2.75rem square. Back button (narrow only): a 2.75rem `pmt-icon-btn` with ArrowLeft and `aria-label="Back to conversations"`. At narrow hide the people stack so the title keeps its width. The hairline under the head is a pseudo-element, not a border.
4. Tahi-internal request threads, studio only: when `audience === 'studio' && thread.source === 'request' && !thread.canInternal` (the admin route sets canInternal false only for `requests.isInternal`), render the design's internal note under the head (lock icon, "Internal request. Every message here is Tahi only and never leaves the studio.", badge-warning tint, all-sides border, inset 0.75rem 1rem 0), use the placeholder "Message the team" and the hint "Only the Tahi team can see this room". Today this case tells the studio the client will see the reply. Put a one-line comment on the derivation naming the admin route's rule it depends on.
5. States inside the body: loading is `SkeletonList rows={4}`; error is the centred block (AlertTriangle in `--color-danger-ink`, bold title, muted body, `TahiButton` secondary sm with RefreshCw "Try again", `role="alert"`) with today's copy; empty is `EmptyState` with `LeafGlyph` (components/tahi/tahi-glyphs.tsx) and today's two bodies; idle (no room) is `EmptyState` with MessageCircle, "Pick a conversation" and today's two bodies. Keep the live region: the `role="log" aria-live="polite" aria-relevant="additions"` wrapper stays mounted with its messages exactly as now.
6. Stream: day dividers and the New divider keep today's logic. Style per design: uppercase 0.625rem label in `--color-text-subtle` between two hairlines; the New divider in `--color-link` on a brand tint pill with brand hairlines. Parking at the newest message: keep the effect on state, count and key, and add one `requestAnimationFrame` re-park and one re-park on `document.fonts.ready` (the design's Stream), cancelled on cleanup.
7. Bubble: author avatar (`Avatar size={32}`), meta line with the author name, or "You" when `m.isOwn`, the local time, and for an internal note the app's internal marker (`Badge tone="warning" variant="soft" size="sm"` with a Lock icon, as message-thread.tsx does). Own bubbles right-aligned on a brand tint, internal bubbles on the badge-warning tint, max width `min(34rem, 82%)` (88% at narrow). File chips gain a FileText icon, keep opening `apiPath('/api/uploads/serve?key=...')` in a new tab, and are at least 2.75rem tall below 64rem.
8. Voice note: keep the native `<audio controls preload="none">` with its duration label, restyled inside the design's `.msg-voice` wrapper (bordered, `--color-bg-secondary`). Do not build the design's play button and waveform bars: the bars are decorative, not read from the audio, and playback has not been verified since the 2026-05-21 QA note. The live smoke (below) must record a voice note on Chrome desktop and on iOS Safari and play it back; if either fails, file it in STATUS.md and TASKS.md and leave the player as is.
9. Composer (message-box.tsx, props unchanged): tabs, textarea, tray and foot as in the design's Composer. Tray chips show a small spinner while busy (the design's `.msg-spin`, respecting reduced motion), an alert icon and danger tint on error, a file icon when ready, and a 2.75rem remove button at narrow. Add the two status lines: "One file did not upload. Remove it or try again before you send." when any chip is broken, and "Recording. Tap the mic again to send." while recording, both `role="status"`. Mic while recording: danger border and ink with the pulse animation, `animation: none` under `prefers-reduced-motion`. Send: brand fill, `--color-text-on-dark` text, `--radius-leaf-sm`, 2.75rem at narrow, disabled look on `--color-bg-secondary`; in internal mode the fill is `--badge-warning-solid` and the label "Add note". Textarea font size is 1rem below 64rem so iOS does not zoom on focus. Read-only note: "You are reading this as the client. Replies are read-only in client view." for both audiences (fixes the "as Tahi Studio" bug); do not read `clientName` for it.
10. States to cover and check: loading, error, empty (request and channel copy), idle, populated with day and New dividers, own, other and internal bubbles, files, voice note, composer resting, typed, uploading, failed, recording, internal mode, read-only, Tahi-internal request. Every one at 1440 and 375, light and dark (`.dark` on html). 44px targets at 375 on Back, Open the request, paperclip, mic, Send, tabs, chip remove, file chips. Visible focus ring (`tahi-focus-ring`) on every control. No hex, no rgba literals, no single-side borders.
11. Do NOT build: reactions, edit or delete, reply-to quoting, a file preview drawer, the custom voice player, the direct or group room head variants, the "Not in their portal" banner and its Open permissions button, the plan name in the studio channel subtitle, a client New message control. Do not change `ThreadPane` or `MessageBox` props, `types.ts`, the page, the rail or any API route.

### Slice A: frame, headline band and rail (merge second)

Owned files: `components/tahi/messages/messages-content.tsx`, `components/tahi/messages/conversation-rail.tsx`, `components/tahi/messages/messages-band.tsx` (new), `app/(dashboard)/messages/messages.css`, `lib/messages-inbox.ts`, `lib/__tests__/messages-inbox.test.ts`. Size: 1.5 days. No backend, no migration.

Brief:

Follow `messages.jsx` (Head, Rail, the band cells in Messages, the narrow rules) and `messages-kit.jsx` (RoomIcon, RoomRow, Band), the page head, box, rail and narrow sections of `messages.css`, page keys client-inbox, client-loading, client-error, client-empty, client-filtered, client-readonly, studio-inbox, studio-quiet and studio-empty.

1. lib/messages-inbox.ts (pure, with tests): add `'channels'` to `InboxLens`; split the lens list into `CLIENT_INBOX_LENSES` (All, Unread, Requests) and `STUDIO_INBOX_LENSES` (All, Unread, Client lines, Requests), keeping `INBOX_LENSES` as the client list if anything still imports it; `filterInboxThreads` handles `channels` as `source === 'channel'`; `isInboxLens` accepts it. Add `inboxBandCounts(threads)` returning `{ rooms, unread, unreadRooms, requests, channels, waitingOnClient, waitingOnStudio, studioLine }` where `waitingOnClient` counts request rows with status `client_review`, `waitingOnStudio` counts rows whose `lastMessage` exists, is not internal and has `authorType === 'contact'`, and `studioLine` is the first channel row's `lastMessage` (`at` and `authorName`) or null. Unit tests for every field including empty input.
2. Frame (messages-content.tsx): replace the bespoke header with `PageHeader title="Messages"` and today's two subtitles, no header actions for either audience. Wrapper as the requests list: a column, `padding: 1.25rem 0`, gap 0.875rem. When `readOnly`, a `Callout` (components/tahi/callout.tsx, `tone="neutral"`) reading "You are reading this as the client. Replies are read-only in client view." Then the band, then the two-pane box. Keep every data function (loadInbox, loadThread, openThread, uploads, voice, send, refresh) untouched.
3. Band (messages-band.tsx): `MessagesBand({ audience, threads, state })` built on `KPIStrip` and `KPICell` with lucide icons, values from `inboxBandCounts`. Client tiles: Unread (sub "in N of your M conversations", "you are up to date", or "nothing to read yet"), Waiting on you (warning tone above zero; "a request is sitting on your call" or "nothing needs you"), Request threads ("one for every request you can see" or "a thread opens with your first request"), Last reply (`RelativeTime` of the studio line's last message, sub "<author>, on your studio line"; value "None" and "your studio line has not opened yet" when empty). Studio tiles: Unread ("across N rooms", "every room is read", "no rooms yet"), Waiting on us (warning above zero; "the client wrote last" or "nobody is waiting"), Client lines ("one standing line per client" or "no client line yet"), Request threads ("one per request in your scope" or "no request threads yet"). Loading: the same KPIStrip with a `SkeletonBar` in place of each value and sub, inside `animate-pulse`, so the band does not change height. Error: render nothing. The band reads the whole payload (after the studio's client filter, before lens and search), so it and the list never disagree.
4. Rail (conversation-rail.tsx), desktop (64rem and up): search field on top (1px border all sides, focus ring, clear button when there is a query), then `RailGroupLabel` "Views" and one `RailViewItem` per lens with the count of rows in that lens (the audience's lens list), then for the studio `RailGroupLabel` "Filters" and a searchable `RailSelect` "Client" with "Every client" plus the clients list (the unread count may go in the option label), `active` when set, `onClear` resetting it; then `RailGroupLabel` "Conversations" when there are rows, and the scrolling list. The client picker leaves the header. Cache the full clients list from the unfiltered load in state so choosing a client does not shrink the picker to one option (today's switcher does). Changing the client keeps today's behaviour: refetch with `?orgId`, clear the selection.
5. Rail, narrow (below 64rem): search field (1rem font so iOS does not zoom, 2.75rem tall, 2.75rem clear button), a `SegmentedControl` fill variant with the audience's lens labels, and for the studio a `RailSelect touch` for the client. No inner scroll: the rail list flows in the page, so the band, the views and the rows scroll as one document.
6. Rows: the design's RoomRow. A 2.125rem leaf-radius icon tile (`--radius-leaf-sm`) for every row: brand tint with `LeafGlyph` on a channel, `--color-bg-secondary` with the status dot (`inboxStatusDot` from components/tahi/messages/status.ts) on a request. Title with `inboxRowTitle`, `RelativeTime`, one-line preview, tags row with a `Badge` tone neutral size sm (Your studio line, Client line, or `inboxStatusLabel(status, audience)`) and the org name badge on the studio's unfiltered inbox. Unread rows bold the title and darken the preview (no tinted background); the selected row is the brand-100 mix; unread count badge in `--color-brand` with `--color-text-on-dark`. Row min height 3.75rem, 4.125rem at narrow. When the selection changes, scroll the selected row into view with `block: 'nearest'` (instant under reduced motion); this closes the critic's port-time note.
7. Rail states: loading `SkeletonList rows={5}`; error as the centred block with today's copy and a `TahiButton` Try again; true empty `EmptyState` with `LeafGlyph` and today's audience bodies, no CTA; filtered empty `EmptyState` with Search, "No conversations match", "Try a different word, or clear the filter.", `ctaLabel="Clear filters"` resetting query, lens and the studio client filter.
8. Box (messages.css): desktop is a grid `19rem minmax(0, 1fr)` with a 1px gap on `--color-border-subtle`, 1px border `--color-border` all sides, radius 0.875rem, overflow hidden, height from the viewport as today (re-derive the `calc()` so header, band and box fit a 1440 by 900 window without the page scrolling; keep a min height of 30rem). Narrow with no room open: one column, height auto, no inner scroll. Narrow with a room open: hide PageHeader, the read-only Callout and the band (the design's pane-only mode), keep the rail mounted but hidden so Back returns to the same scroll position, one column, and a height that fills the viewport above the mobile tab bar so the composer sits above it with no page scroll (measure at 375 by 812 in Chrome against `.dashboard-main`'s phone bottom padding). Remove `.pfm-vhair`.
9. CSS cleanup (after slice B is on main): delete from messages.css every rule for the thread pane, one message, voice note, composer, `.pfm-empty`, `.pfm-skel`, `.pfm-lens*`, `.pfm-ro`, `.pfm-face`, `.pfm-stack` and their 64rem overrides; before deleting each selector, grep components/tahi/messages for it and keep any that are still referenced. Remove `--pfm-warn` and its `.dark` twin, the `#fff` and the rgba shadow. Keep the `pfm-` prefix for what remains.
10. States to cover and check: loading, error, true empty, filtered empty, populated, a selected row, unread rows, the studio client filter set and cleared, read-only preview, both audiences, 1440 and 375 (and 768, which is stacked), light and dark. 44px targets at 375 on search, clear, segments, client picker, rows. Focus ring on every control. No hex, rgba literals or single-side borders.
11. Do NOT build: a New conversation button or dialog, an Internal view, an Internal rooms tile, direct or group rows, the "Not in their portal" chip, a client New message control, an offline banner, the design's "Views and filters" disclosure, the design's lead-tile meter, a new shared headline-band primitive. Do not touch the thread pane or composer files, `types.ts`, the page, the API routes, lib/messages-store.ts, the nav, the mobile tab bar, or the e2e specs.

### Definition of done for both slices (CLAUDE.md rule 8)

- `npm run type-check`, `npm run lint`, `npm run test` (messages-inbox and messages-composer tests), and `npm run build` before pushing.
- Live smoke on the deployed URL as the studio (Liam) at 1440 and 375, light and dark: open a client line, open a request thread, send a reply, attach a file, record and play a voice note, add an internal note, filter by client, search, clear.
- Client audience: Messages is default-denied, so the smoke needs a `feature_visibility` ALLOW override on **Tahi Test Client only** (organisation subject, feature key `messages`), removed afterwards. Never on Giant Group or any real client: a studio post on a client line fires the message notification emails and Giant Group is on the email allowlist. Use Client view on Tahi Test Client to check the read-only banner and composer.
- Commit body notes the smoke, 375 and dark results. The work is "ported, unchecked" until Liam reviews it.

## 7. Critic items

The critic's final verdict for this module is SHIP (first pass FIX, resolved in the design's revision), so no FIX list is open. Two port-time notes from the review are resolved inside the slices:

- The rail does not scroll a selected room into view: slice A step 6.
- The voice note player must not ship looking ready while playback is unverified: slice B step 8 keeps the native player and makes playback part of the live smoke.

Two live bugs found while planning are fixed on the way: the read-only composer note reading "as Tahi Studio" (slice B step 9) and the studio hint on a Tahi-internal request claiming the client will see the reply (slice B step 4). A third, the studio reading the client's "Your review" wording, is slice B step 1 plus slice A step 6.

## 8. Skipped (keeps today's live behaviour)

- Studio New conversation button and dialog (studio-new): a direct or group room created there never appears in this inbox until E1 projects conversations of type direct and group into `lib/messages-inbox.ts`.
- Studio direct and group rooms as rail rows, the Internal view, the Internal rooms band tile (replaced by Request threads), the internal-room banner on those rooms. Same E1 question.
- The "Not in their portal" chip on a client line and the thread banner with Open permissions: needs Liam's yes and a per-org feature flag in the admin inbox payload.
- The plan name in the studio channel subtitle ("Client line, Giant Group, Scale plan"): not in the thread payload.
- A "Tahi only" chip on studio rows for Tahi-internal request threads: `InboxThread` carries no internal flag.
- The custom voice-note player (play button and waveform bars).
- The client-denied frame (documentation only) and the client-composer gallery (preview only).
- The head-band lead-tile accent fill and meter, the design's container-query stack point, the "Views and filters" disclosure at narrow (live patterns win, section 4).
- Everything the design already leaves out: client New message, offline banner, message edit and delete, reactions, a file preview drawer.

## 9. Questions for Liam

1. E1: the first port ships client lines and request threads only. Should studio direct and group rooms (and with them the New conversation button, the Internal view and the Internal rooms tile) come in a follow-up that projects them into the inbox?
2. The band is built on the app's existing KPIStrip because no list page has the design's headline band yet. Should every list page move to one shared port of head-band.css (one primitive, decided once), or is KPIStrip the band from now on?
3. Waiting on us and Waiting on you are computed in the browser from the inbox rows (the last message's author type, and request status client_review). The payload already carries the author type, so no backend is needed. Honest enough?
4. Do you want the "Not in their portal" marker on a client line whose org has Messages off, and the thread banner that sends you to permissions? It needs one small admin route addition.
5. Voice notes: STATUS.md says the recorder no longer exists, but /messages records and plays them today. Once playback is verified on a phone, do you want the custom waveform player, or is the native audio control fine?
6. Carried from the design review and still open: 7.1 (client never starts a new room; kept), 7.2 (mobile tab bar when Messages is allowed for an org), 7.3 (1024px stack point; kept), 7.4 (attachments open the file; kept), 7.5 (shared empty copy; kept).

## 10. Risks

- Merge order: B then A. If A merges first, the CSS cleanup in A step 9 would unstyle the old thread markup, and A's import of `status.ts` would not resolve.
- A later module port may introduce a shared headline band or a different rail fold on phones; this page would then need a small follow-up to match.
- The narrow thread height depends on the shell's top bar and `.dashboard-main` phone bottom padding; if either changes, the composer can slip under the tab bar.
- The Tahi-internal request treatment is derived from `canInternal`, which is only false for internal requests today; if the admin route ever sets it false for another reason, the internal note would claim something untrue.
- Voice notes on iOS: the recorder names every upload `.webm` and `/api/uploads/serve` maps `.webm` to `video/webm`; Safari may not play what it records. The smoke checks it; a fix would be a separate backend item.
- The client audience can only be smoke-tested behind an allow override; forgetting to remove it leaves Messages visible to Tahi Test Client.
- `SegmentedControl` is 2.25rem tall from 48rem to 64rem, where this page is still stacked; a tablet gets 36px segments.
- V1-QA.2 (e2e specs still asserting a Messages tab) is separate and untouched here.

## 11. Shared files other modules may also touch

Used, not edited, by this port: components/tahi/page-header.tsx, components/tahi/kpi-strip.tsx, components/tahi/rail/rail-controls.tsx, components/tahi/segmented-control.tsx, components/tahi/empty-state.tsx, components/tahi/skeletons.tsx, components/tahi/callout.tsx, components/tahi/tahi-button.tsx, components/tahi/avatar.tsx, components/tahi/badge.tsx, components/tahi/relative-time.tsx, components/tahi/tahi-glyphs.tsx, lib/status-config.ts, app/globals.css (tokens only). Not touched but adjacent: components/tahi/mobile-bottom-nav.tsx and components/tahi/nav-model.tsx (question 7.2), app/(dashboard)/app-shell.css, lib/messages-store.ts, the messages API routes.
