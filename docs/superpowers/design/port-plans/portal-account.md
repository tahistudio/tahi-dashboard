# Port plan: portal-account

Written 2026-09-26. Status on landing: ported, unchecked (Liam has not reviewed the designs; existing app primitives and patterns win wherever the prototype differs). Nothing in this plan touches the Docs Hub.

## Sources read

- The portal-account section of docs/superpowers/plans/2026-09-14-design-review-for-liam.md (32 page keys, critic verdict FIX, still-open FIX items, six questions for Liam).
- docs/superpowers/design/requirements/client-account-notifications.md and docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md.
- The Claude Design files, fetched live from project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66: portal-account.jsx (read in full, all 937 lines), portal-account-rooms.css (full), portal-account-data.jsx (full), previews/portal-account-preview.html (full, for the page key map). portal-account-kit.jsx and portal-account.css were not read line by line; their classes were already ported into app/(dashboard)/notifications/notifications.css by AR.1, and the kit primitives they define are replaced by app primitives in every brief below.
- Live code: app/(dashboard)/notifications/page.tsx, components/tahi/notifications/notifications-content.tsx, components/tahi/notifications/notifications-rail.tsx, app/(dashboard)/notifications/notifications.css (head), app/(dashboard)/settings/page.tsx, components/tahi/settings/settings-shell.tsx, components/tahi/settings/sections/profile.tsx, appearance.tsx, notifications.tsx, people.tsx, components/tahi/settings/primitives.tsx, components/tahi/rail/rail-layout.tsx, components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx, components/tahi/empty-state.tsx, components/tahi/callout.tsx, components/tahi/impersonation-banner.tsx (useImpersonation), components/tahi/shell-icons.tsx.
- APIs, for data only: app/api/notifications/route.ts (GET facets, PATCH), app/api/portal/profile/route.ts, app/api/portal/notifications/route.ts, app/api/portal/people/route.ts, lib/onboarding-invites.ts (INVITE_EXPIRY_DAYS = 14), lib/server-auth.ts (preview identity), and the admin gates in app/api/portal/invoices, billing/session, checkout, subscription/change-request.

## Routes and audience

- /notifications: both audiences (client reading is this module; the team reading shares the component and gets the same band).
- /settings, client branch: the Account group sections Profile, Appearance, Notifications, and the People section under Organization.

## The one decision that shapes the port

The design draws the client's /settings as a single "Account" page with five rooms behind a segmented slider (You, Sign-in, Appearance, What reaches you, Your team). Whether that IA replaces the flat SettingsShell sub-nav is requirement question 1, still open. Per the port rule, the flat SettingsShell stays: no change to components/tahi/settings/settings-shell.tsx, no Account page head, no segmented tabs, no per-room icon heads. What the port does take is the content of each room, poured into the existing section it maps to: You into Profile, What reaches you into Notifications, Appearance into Appearance, Your team into People. Sign-in has no live section and is skipped (question 2).

## Page key by page key

### /notifications (12 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| notifications | PageHeader, RailLayout with Views and Kinds rails and server facet counts, day groups, Load older, endcap, Email preferences in the rail foot and as a card below lg | No headline band. Mark all title does not name the kinds. On a phone the Mark all button is a text button. | Slice A adds the four tile band, names the kinds in the Mark all title, icon only Mark all under 40rem. |
| notifications-unread | Unread view, rows stay in place once read | Kinds plus Unread empty copy is generic | Slice A adds the unread variant copy. |
| notifications-past | Month groups, endcap | Endcap says "That is everything we have kept. Older than that, ask us". Design says "We keep twelve months". Neither is true: nothing prunes the notifications table. | Slice A: honest endcap, no retention claim. |
| notifications-kinds | Multi-select kinds, chips, Filters badge count, greyed empty kinds | None of substance | No work. The critic's first-paint race does not exist live (see FIX items). |
| notifications-filters | RailLayout SlideOver sheet titled Filters with Clear all and Show N | Design has its own bottom sheet at 34rem | No work. RailLayout sheet wins. |
| notifications-loading | Six row skeleton plus "Loading your notifications" status | No band skeleton | Slice A: band renders labels with skeleton values. |
| notifications-error | Error card with Try again; facets cleared so no stale counts | No band; error icon is the bell | Slice A: band renders "Not loaded" values; error icon becomes a warning glyph. |
| notifications-empty | Leaf, "You are all caught up.", audience copy, primary CTA | CTA label and style differ slightly | No work. Live CTA kept. |
| notifications-empty-past | Reuses "You are all caught up." with a Past body and an overview CTA | Design and requirement doc: distinct clock state, "Nothing older than thirty days yet.", no CTA | Slice A. |
| notifications-empty-unread | "Nothing unread." with Show everything | None | No work. |
| notifications-empty-kinds | "Nothing matches those kinds." with Clear filters | Unread variant copy | Slice A (same item as notifications-unread). |
| notifications-readonly | pa-ro banner naming the admin's own history, mark as read controls disabled with titles | Design banner names the org | No work. Live wording is the more accurate one. |

Not ported on purpose: the design's count line tail ("37 notifications · 4 unread") would mean changing the shared RailLayout count slot; the Unread view already carries that number. The design's useNarrow measurement and RAIL_MIN fold are replaced by RailLayout's CSS lg fold, the one Requests and Tasks use.

### /settings, client Account (20 keys)

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| account-you | Profile section: AvatarUpload, Full name, Email (disabled, sign-in note), Role / title, Phone, Save profile | No dirty tracking, no Discard, no saved state line, Save live even when nothing changed | Slice B: card foot with state line, Discard, Save changes enabled only when dirty. Room chrome skipped (question 1). |
| account-you-loading | ProfileSkeleton | Equivalent | No work beyond the lede copy fix. |
| account-you-readonly | Nothing disabled. Worse: in Client view the Clerk user is the operator's, so Save renames the operator's own Clerk name before the portal PATCH is refused (403), the photo control uploads to the operator's own Clerk avatar, and the operator's photo is shown on the client's profile | Design disables every field and action with a reason | Slice B: read-only in preview, no Clerk writes, contact initials instead of the operator's photo. Not question 5 (that one is People only); the server already refuses this write in both view and act mode. |
| account-signin, account-signin-email, account-signin-password | Nothing (only the static sign-in sentence under Profile) | Whole room | Skipped, question 2. |
| account-appearance | Appearance section, three localStorage toggles with cross-tab sync | Room framing and client copy | Slice B ports the client copy only. The room itself is question 3. |
| account-alerts | Notifications section: exactly the four client events, In app and Email only, Studio notes email only, quiet hours in a second card, See everything link | Studio notes shows In app as a plainly-off pill; quiet hours is the last row of the same card; card foot copy; preview read-only | Slice B. |
| account-team | People: roster, Owner/Admin/Member chips, Pending invite chip, RowActions edit and delete, ConfirmDialog | No You tag, no role in the subline, no level explanations, delete offered on the owner row and on your own row although the API refuses both (409), invite dialog button reads Save | Slice C. Resend is question 4. RowMenu replaced by the live RowActions. |
| account-team-member | Roster, no actions, sentence under the card | Sentence names the owner and sits above the list | Slice C. |
| account-team-invite | EditDialog: Full name, Email address, Permission level select | Optional name, link lifetime, one-email promise, level descriptions, Send invite label | Slice C, using EditDialog (radio cards and slide-over panel not built). Design says the link lasts seven days; the real value is fourteen. |
| account-team-invite-held | Toast with the API error "Held back by the email allowlist" | Inline error card in the panel | Slice C: honest held copy in the toast, dialog stays open (EditDialog has no error slot). |
| account-team-edit | EditDialog name plus level | Design also edits email | Slice C keeps name plus level. Email edit needs PATCH support, skipped. |
| account-team-edit-owner | Level field hidden for the primary contact | Owner note | Slice C adds the note as field help. |
| account-team-remove | ConfirmDialog "Remove X from your workspace?", "They lose access straight away." | Fuller, sign-in detach copy | Slice C. |
| account-team-revoke | Same dialog as remove | Distinct revoke title, body and label | Slice C. |
| account-team-readonly | Delete disabled with "Read-only in Client view"; invite and edit look live but the server refuses them | Design disables all three with a NoteBar | Skipped, question 5. Live behaviour kept. |
| account-team-loading | LoadingShell, bars painted with --bg-secondary (barely visible) | Equivalent | Slice C switches the bars to the visible --bg-tertiary alias. |
| account-team-empty | EmptyRow text | Leaf empty state with an Invite CTA for admins | Slice C. |
| account-team-error | EmptyRow text, no retry | Error card with Try again | Slice C. |

The requirement doc is stale in two places: People already uses ConfirmDialog (not window.confirm), and already disables delete in Client view.

## The critic's still-open FIX items, resolved

1. notifications-kinds, rail first-paint race (useNarrow starts false before the ResizeObserver fires). Resolved by not porting it. The live page folds through RailLayout's CSS breakpoints (hidden lg:block on the rail, lg:hidden on the Filters button and the segmented track), which are decided by the stylesheet before first paint, so the unfolded layout can never flash. Slice A must not introduce any JS width measurement.
2. notifications-loading and notifications-error, band skeleton invisible under load and marginal contrast. The failure came from a color-mix() custom property (--bg-tertiary) that the prototype defined locally. The port uses KPIStrip with SkeletonBar values, painted with --color-bg-tertiary, a solid token defined in globals.css for both themes, so there is nothing to race. The error state no longer uses skeleton bars at all: each tile shows a muted "Not loaded" word, which also answers the contrast concern for that state. Loading contrast then equals every other skeleton in the app; whether that token should be stronger app-wide is left to Liam (question 9).
3. The prototype's head-band.css --bg-tertiary question (define once in app-shell.css) is moot in the app: nothing in the port reads a prototype token.

## Slices

Three slices, disjoint files. A can run in parallel with B. C starts after B has merged, because it consumes two optional EditDialog props that B adds to primitives.tsx. None needs a backend change or a migration.

### Slice A: notifications band and states (about 1 day)

Owned files: components/tahi/notifications/notifications-content.tsx, app/(dashboard)/notifications/notifications.css.

Brief. Follow portal-account.jsx, the Notifications function, page keys notifications, notifications-loading, notifications-error, notifications-empty-past, notifications-unread, notifications-empty-kinds. Keep everything the live page already does (RailLayout frame, server facets, views, kinds, mark as read, Load older, read-only banner).

1. Headline band. Between the PageHeader and the RailLayout, render a section with aria-label "Your notifications" holding KPIStrip from components/tahi/kpi-strip.tsx with four KPICell children, no href (the band is a summary, not a filter). Icons from lucide-react: Bell, Clock, Inbox, Layers.
   - Unread: value unreadCount (the whole-table number the bell uses). Sub "Waiting in your bell" when above zero, "Your bell is clear" at zero. Tone brand above zero, neutral at zero.
   - Today: value todayCount. Sub "Landed since midnight" or "Nothing yet today". Tone neutral.
   - Last thirty days: value facets.views.all. Sub "Everything the studio sent you" for the client audience, "Everything flagged for you" for team.
   - Older: value facets.views.past. Sub "Under Past". Never claim a retention period: nothing prunes the table.
   - Today comes from the existing API, no backend change: one GET to /api/notifications with limit=1, since set to local midnight as an ISO string, and facets=true; todayCount is facets.views.all from that response. Fire it on mount and again whenever load() is retried after an error. Do not refetch it on view or kind changes.
   - States. Before the first facets land (facets null and state loading), render the same KPIStrip with the four labels and each value as a SkeletonBar (components/tahi/skeletons.tsx, about 2.5rem by 1.5rem) inside an animate-pulse wrapper, so the geometry matches the populated band and nothing jumps. Do not use SkeletonKPIStrip: it is two columns at every width and would jump to four at 64rem. On error (facets null after a failed read) each value is the word "Not loaded" in var(--color-text-subtle) at the small text size, no sub line. Never show a stale number beside the error card. A view switch keeps the last facets, so the band does not flash back to skeletons when changing view. If only the Today read fails, only that tile says "Not loaded".
   - Mark as read and Mark all as read already update unreadCount and refresh facets; the band must follow them with no extra code beyond reading the same state.
2. Empty Past. When view is past and nothing came back with no kinds set: clock ShellIcon, title "Nothing older than thirty days yet.", body "Once a notification is more than thirty days old it moves here.", no CTA.
3. Kinds plus Unread empty copy. When kinds are set and view is unread: body "Nothing unread under those kinds. Clear the filters, or look at All." with the existing Clear filters action.
4. Past endcap. Replace "That is everything we have kept. Older than that, ask us and we will dig it out." with "That is everything in your history." The All endcap stays.
5. Error card icon. Swap the bell for lucide AlertTriangle at 18. Do not add a glyph to components/tahi/shell-icons.tsx (shared).
6. Mark all title names the kinds. Join the selected kinds' labels from NOTIFICATION_KINDS with commas and a final "and". Past with kinds: "Marks every [kinds] notification older than thirty days as read". All or Unread with kinds: "Marks every unread [kinds] notification as read" (the PATCH narrows by kind across all time on these views, so this is accurate). No kinds: keep the live strings.
7. Phone. Below 40rem (the sm breakpoint) the Mark all button shows only the checks icon: wrap the text in a span with hidden sm:inline, set aria-label "Mark all as read" on the button, keep the title, keep the 2.75rem minimum height and width.

States to verify: loading, populated, each of the four empty variants, error then Try again, read-only Client view (band shows the operator's own numbers, all mark controls disabled), team audience. Widths: 375 (band two by two, segmented track, Filters sheet, icon Mark all, no horizontal scroll, every target 44px), 768 (still sheet mode, band two by two), 1024 and up (rail, band four across). Dark mode: band tiles, "Not loaded", skeleton bars, kind icons, unread dot. Tokens only, no hex; the pre-existing tone hex in notifications.css is not to be extended.

Do not build: the design's own sheet, Seg, FilterSheet, useNarrow or RAIL_MIN; a count line tail in RailLayout; any change to rail-layout.tsx, kpi-strip.tsx, skeletons.tsx or notifications-rail.tsx; any retention promise; a Today count derived from loaded rows.

### Slice B: You, What reaches you, Appearance (about 1 day)

Owned files: components/tahi/settings/sections/profile.tsx, components/tahi/settings/sections/notifications.tsx, components/tahi/settings/sections/appearance.tsx, components/tahi/settings/primitives.tsx.

Brief. Follow portal-account.jsx, the Account function's roomYou, roomAlerts and roomLook blocks, and portal-account-data.jsx PREFS, QUIET and APPEARANCE, page keys account-you, account-you-loading, account-you-readonly, account-alerts, account-appearance. Stay inside the existing SectionShell and set-card system from primitives.tsx and settings.css; do not edit settings.css or settings-shell.tsx. All three sections are shared with the studio reading: change client copy only on the client branch (isAdmin false) and keep the admin copy as it is, except the dash fix in item 1.

1. primitives.tsx, additive only. Toggle gains optional disabled and title props (disabled buttons get inline opacity 0.45 and cursor not-allowed, because .sw has no disabled rule). EditDialog gains optional saveLabel (default "Save") and saving (disables Save and shows the label passed while sending). No other primitive changes.
2. Profile.
   - Client lede: "How you show up to the studio and to your colleagues." Admin lede loses its spaced hyphen: "Your name, photo and role, shown across the workspace." (also in ProfileSkeleton).
   - Dirty tracking against the seeded record (name, role, phone). Replace the single Save row with a card foot: a state line on the left ("Unsaved changes" or "Everything is saved"), a quiet Discard (btn2) only when dirty that resets to the record, and a primary "Save changes" (btn1) enabled only when dirty and the name is not blank, reading "Saving" while in flight.
   - Save order: PATCH the workspace record first, then the best-effort Clerk name sync only on success, so a refused save never renames the sign-in.
   - Client view read-only: read useImpersonation().isImpersonatingClient (the portal profile PATCH refuses in both view and act mode because impersonating stays true). When previewing a client: every input disabled, the state line reads "Read-only in Client view", Save and Discard disabled with that title, no Clerk call of any kind, and AvatarUpload replaced by a static initials avatar of the contact's name (the Clerk user is the operator's, so their photo must not appear on a client's profile) with the note "Photos stay with each person's own sign-in."
   - Keep AvatarUpload, the field set, the email sign-in note and the paragraph about sign-in provider. Keep the phone note wording ("Only the studio sees this"), not the design's named version.
3. Notifications (What reaches you).
   - Studio notes: render In app as a non-interactive span beside the Email switch, shaped like .ntf-ch but muted (var(--bg-secondary) background, var(--text-faint) ink, subtle border) with title "Studio notes do not write a bell row yet", and no role switch. Update the Studio notes description to the design hint: "The occasional notice from Tahi. A few a year, never a newsletter. Email only for now: a studio note does not write a bell row yet."
   - Move quiet hours into the events card as its last row (set-row with the Toggle), for both audiences. Client copy: title "Hold non-urgent email overnight", body "Between 7pm and 8am. Your choice is saved now, and we are wiring it into each alert as it adopts your preferences, so for now email can still arrive overnight." Admin copy unchanged.
   - Client card foot, replacing the two trailing paragraphs for the client branch: "Each switch saves as you turn it. Turning email off only stops the email: with In app on, it still lands in your bell. Receipts and contracts always send." plus the existing See everything link (--color-link ink), right aligned. Do not port the design's "it all still lands in your bell" (false for Studio notes).
   - Client view read-only: every channel chip and the quiet Toggle disabled with title "Read-only in Client view", and a set-lede line above the card: "Read-only while you preview. Preferences belong to each person, so these show the defaults, not this client's own choices." (In preview /api/portal/notifications reads the operator's Clerk id, so the page really is showing defaults.) Admin branch unaffected.
4. Appearance. Accept isAdmin (the shell already passes it). Client lede "Kept on this device. Your colleagues keep their own." Client hints: Dark mode "The whole portal in the dark palette. Other tabs on this device follow along."; Reduce motion "Drops the slides and the fades. Everything still moves between states, just without the travel."; Start with sidebar collapsed "The portal opens with the navigation folded to icons. You can open it again any time." Client foot line under the card: "Saved on this browser as you switch them. Nothing here is sent to the studio." No preview gating (device local). Admin copy unchanged.

States to verify: Profile loading, clean, dirty, saving, save failure toast, Client view (view and act mode); Notifications loading, toggle success, toggle failure revert, Client view; Appearance toggles in light and dark and across two tabs. Widths 375 (fields stack, chips full width at 44px as settings.css already does, foot wraps without overflow), 768, 1440. Dark mode on every new muted pill and state line. No hex, rem spacing in any new inline style.

Do not build: the Account page head, segmented tabs, room icon heads or tone accents; the Sign-in room or Sign out card; changes to settings-shell.tsx or settings.css; the design's Chan pill with icons (keep .ntf-ch); a named-person phone note.

### Slice C: People (about 0.75 day, after slice B)

Owned files: components/tahi/settings/sections/people.tsx.

Brief. Follow portal-account.jsx roomTeam and PersonRow, and portal-account-data.jsx LEVELS, page keys account-team, account-team-member, account-team-invite, account-team-invite-held, account-team-edit, account-team-edit-owner, account-team-remove, account-team-revoke, account-team-loading, account-team-empty, account-team-error. Keep SectionShell, set-card with lrow rows, Chip, RowActions, EditDialog, ConfirmDialog and the existing API calls. No API change.

1. Header. Title stays "People". Lede: "Everyone here can see your workspace's requests in the portal once they have signed in." Invite button label "Invite a colleague", shown to admins only and hidden while the roster errors.
2. Rows. Keep the initials avatar. Name, plus a small "You" chip when the row's id equals the signed-in contact's id, read from useResource('/api/portal/profile') (contact.id; SWR shares the shell's request). Subline: email, then " · " and the role when role is set. Pending chip keeps the text "Pending invite" in warning tone. Level chip wrapped in a span whose title is the level description below.
3. Honest delete. RowActions stays. Primary contact row: deleteDisabled, title "The main contact cannot be removed here. Ask the studio to move it." Your own row: deleteDisabled, title "You cannot remove yourself". Pending rows: delete title "Revoke the invite". Client view keeps today's deleteDisabled and title. The API refuses the first two with a 409 today, so this removes two dead buttons.
4. Level descriptions, used in a "What the levels mean" block under the card (led label plus three short lines) and as the Permission level help in both dialogs, replacing LEVEL_HELP, which is inaccurate:
   - Owner: "The main contact. Everything an admin can do, and cannot be removed from here."
   - Admin: "Can invite and manage people, see invoices and billing, and ask for plan changes."
   - Member: "Can see and submit requests and reply on them. No invoices or billing."
   Checked against the admin gates in app/api/portal/invoices, billing/session, checkout, organisation, brands, people and subscription/change-request. Re-check before shipping if any of those gates move.
5. Member seat. Replace the sentence under the card with a line above the list: "Only workspace admins can invite or manage teammates. Ask [owner name], or ask the studio and we will do it." Owner name is the isPrimary row; with none, "Ask a workspace admin".
6. Invite dialog (EditDialog). Heading "Invite a colleague". Fields: "Their full name" with help "Optional. Leave it blank and we show their email until they set their own name." (the API stores the email as the name); "Their work email" with placeholder name@company.com and help "The link lasts fourteen days. They get one email from Tahi, never marketing." (INVITE_EXPIRY_DAYS in lib/onboarding-invites.ts; hardcode the words with a comment, do not import that server module into a client file); "Permission level" select with the Admin and Member descriptions as help. saveLabel "Send invite", saving while the POST is in flight.
7. Invite errors. 409 with error "Held back by the email allowlist": toast "Held back by the email allowlist. Nothing was sent and nobody was added. Ask the studio to let that address through, then try again." and keep the dialog open. Every other failure keeps the live behaviour (toast the API's error text).
8. Edit dialog. Heading "Edit [name]". Name and level as today, saveLabel "Save changes". For the primary contact, name only, with help "This is the main contact. Their level cannot be changed from here. Ask the studio and we will move it for you." The last-admin 409 keeps toasting the API text.
9. Confirm copy. Pending: title "Revoke this invite?", description "The link sent to [email] stops working straight away. You can invite them again any time.", confirm label "Revoke invite". Active: title "Remove [name]?", description "[name] loses access to your workspace straight away. Their sign-in is detached before they leave the roster.", confirm label "Remove". Do not port the design's claim that their messages and requests stay; it is unverified.
10. States. Loading: keep LoadingShell, paint its bars with var(--bg-tertiary) like ProfileSkeleton. Error: inside the card, Callout tone danger, title "Could not load your teammates.", body "Nobody has been removed. Try again shortly.", action "Try again" calling mutate(). Empty: EmptyState variant inline, title "No teammates yet.", description "Invite the people at your company who should see this work. They get one email from Tahi and nothing else.", CTA "Invite a colleague" for admins only.

States to verify: loading, populated as owner, as admin, as member, pending row, invite success, invite held (set the allowlist to block a test address), roster 409, edit, edit owner, revoke, remove, remove refused, error with Try again, Client view (unchanged behaviour). Widths 375 (rows wrap chips under the name, RowActions at 44px as settings.css already does, dialogs fit), 768, 1440. Dark mode on the You chip, warning Pending chip and legend. No hex.

Do not build: Resend; the RowMenu with inline Make an admin and Make a member; the slide-over Panel and radio cards; an inline error card inside the dialog; email editing; an "Invited N days ago" pill; disabled invite and edit controls or a NoteBar in Client view; bulk invite.

## Skipped proposals (live behaviour kept)

- The five-room segmented Account page (page head, slider tabs, per-room icon heads and tone accents). Question 1.
- The Sign-in room: Change email panel, Change password panel, Two-step verification row. Question 2; also needs Clerk account APIs wired.
- The Sign out card inside Account. Part of the Sign-in room; sign out stays in the user menu.
- Appearance as a room inside Account. Question 3; only its copy is ported.
- Resend for a pending invite. Question 4.
- People invite, edit and remove rendered disabled with a preview NoteBar. Question 5; live keeps delete disabled only.
- A bulk invite on People through POST /api/portal/invites. Question 6.
- Editing a teammate's email in the Edit dialog. PATCH /api/portal/people does not accept email; needs backend.
- "Invited N days ago" on a pending row. contacts.createdAt would misdate imported contacts; the honest version needs a join to onboardingInvites (backend).
- The Notifications fold at 56rem of page width (RAIL_MIN). The review's own question; live keeps the RailLayout 1024px fold shared with Requests and Tasks.
- Welcome (first-run checklist) and Offline, which live in portal-account.jsx but have no page key in this module's review and were never critiqued. Not ported here.

## Questions for Liam

1. Is the five-room segmented Account page still the target, or has the flat settings sub-nav won? The port keeps the flat nav and moves only the room content.
2. Build Sign-in (change email, change password, two-step) as a real room, or keep pointing at the sign-in provider?
3. Does Appearance stay its own settings section, or become a room inside Account?
4. Should People gain one-click Resend for a pending invite (re-sending the existing onboardingInvites token)?
5. In Client view, should People's invite, edit and remove render disabled with an explanation, rather than looking live and being refused?
6. Should the bulk POST /api/portal/invites path ever surface on People, or stay onboarding only?
7. Notifications fold: keep the 1024px viewport fold that Requests and Tasks use, or move this page to the design's 56rem page-width fold?
8. In Client view, What reaches you shows defaults because preferences are read by the operator's Clerk id. Should preview read the previewed seat's own preferences instead (a small backend change)?
9. Skeleton bars across the app use --color-bg-tertiary at roughly 1.2 to 1 against the card. The critic wanted a wider margin. Strengthen the token app-wide?
10. Want an honest "Invited N days ago" on pending rows? It needs the People GET to join the latest unused invite token.

## Risks

- Slice B edits primitives.tsx and three sections shared with the studio settings reading; the settings module port will almost certainly touch the same files. Do not run B or C in parallel with the settings module; merge one, then rebase the other.
- If the requests module port introduces a shared headline band primitive modelled on head-band.css, the Notifications band built here on KPIStrip should be swapped to it for consistency.
- The Today tile costs one extra small GET with two grouped counts per page load.
- Profile in Client view currently writes to the operator's own Clerk profile; after slice B, confirm in a live preview (view and act mode) that no Clerk request fires.
- The level descriptions are claims about route gates; a later change to those gates makes the copy wrong.
- Live smoke of the client reading needs a real client session or act mode; the Definition of Done screenshots at 375 and in dark are still owed per slice.
- notifications.css already defines tone colours as hex custom properties with dark overrides; that predates this plan and is not extended.

## Shared files

- components/tahi/settings/primitives.tsx (slice B, additive props)
- components/tahi/settings/sections/profile.tsx, notifications.tsx, appearance.tsx (studio settings reading shares them)
- components/tahi/settings/settings-shell.tsx and app/(dashboard)/settings/settings.css (not edited here; the settings module and question 1 would edit them)
- components/tahi/rail/rail-layout.tsx, components/tahi/kpi-strip.tsx, components/tahi/skeletons.tsx, components/tahi/empty-state.tsx, components/tahi/callout.tsx (consumed, not edited)
- components/tahi/shell-icons.tsx (deliberately not edited)
- components/tahi/impersonation-banner.tsx (useImpersonation consumed)
- app/globals.css (not edited)
