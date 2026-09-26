# Port plan: settings

Written 2026-09-26. Status on landing: ported, unchecked (Liam has not reviewed the designs; existing app primitives and patterns win wherever the prototype differs). Nothing in this plan touches the Docs Hub: AI context only reads the Docs Hub list through the existing GET /api/admin/docs, and no Docs Hub file or route is edited.

## Sources read

- The settings section of docs/superpowers/plans/2026-09-14-design-review-for-liam.md: 70 page keys, first verdict FIX, final verdict SHIP. The revision pass resolved both FIX items (forms:error and the shared toast failure channel) and the critic left no still-open FIX items for this module. Seven questions for Liam.
- docs/superpowers/design/requirements/studio-settings.md (sections 1 to 8, five open questions, ten acceptance items) and docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md.
- The Claude Design files, fetched live from project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66 with the claude-design MCP: settings.jsx (frame and page key map, full), settings-kit.jsx (full), settings-sections-a.jsx (full), settings-sections-b.jsx (full), settings-sections-c.jsx (full), settings-data.jsx (full), settings-extra.css (full), settings-extra-mobile.css (full), previews/settings-preview.html (full), and permissions.jsx lines 1 to 60 and 560 to 807 (the TeamAccessPane states). settings.css and settings-extra-focus.css were not read line by line: settings.css is the base layer already ported into app/(dashboard)/settings/settings.css.
- Live code: app/(dashboard)/settings/page.tsx, settings.css, the three legacy shims, components/tahi/settings/settings-shell.tsx, primitives.tsx, every studio section under components/tahi/settings/sections/, team-access/pane.tsx, and the shared primitives components/tahi/data-state.tsx, empty-state.tsx, callout.tsx, confirm-dialog.tsx, skeletons.tsx, segmented-control.tsx, relative-time.tsx, tahi-button.tsx.
- APIs, for data only: admin/settings, admin/kanban-columns (seed and clone semantics), admin/pipeline/stages (historical probability fields), admin/forms and forms/resolve (resolution order, isDefault), admin/webhooks plus lib/webhooks.ts and lib/events.ts (event vocabulary), admin/automations, automations/[id], automations/log plus lib/automation-executor.ts, admin/integrations/status, integrations/google/status and google/start (scopes), integrations/mailerlite, integrations/zapier, lib/swr-fetcher.ts (ApiError.status), lib/status-config.ts (REQUEST_STATUSES).
- The other port plans, for file ownership: portal-account.md (slice B owns primitives.tsx, profile.tsx, notifications.tsx, appearance.tsx; slice C owns people.tsx) and ops.md (slice 4 owns components/tahi/settings/team-access/* and says the settings module owns settings.css).

## Routes and audience

- /settings, studio branch (the 26 studio-visible sections). The client branch of the same route belongs to portal-account and portal-money; the only thing here that reaches it is the section icon beside each title (slice A).
- /settings/audit, /settings/automations, /settings/crons: redirect shims, no change.
- /permissions mounts the same Team & access pane; nothing here edits it (ops slice 4 owns it).

## The shape of the port

The live settings surface already has the design's information architecture: the same eight studio groups, the same section ids, the super admin gates, the mobile picker and the deep link. Most sections are richer than the prototype (inline question editor on Request forms, the Stripe sync chip on Client plans, the full Email delivery gate, the five-currency Getting paid strip with Entered and Still empty lines). So the port is not a redraw. It is four things the design adds and the live code lacks:

1. Honest states on every list section: the canonical leaf empty state instead of the faint EmptyRow line, and an error state with Try again instead of falling through to "No X yet" when the read fails. Today not one list section reads the useResource error, so a failed read tells you the list is empty.
2. Data safety on sections that write whole blobs: Studio details and Email delivery render blank forms when their read fails, and Save then writes blanks over every key (fourteen keys on Studio details, including both bank blobs and the client exemptions on Email delivery). Client plans renders the hardcoded defaults before and after a failed read, and any edit then overwrites the real catalogue. Booking links has the same blob shape.
3. Honesty fixes the design calls out or that fall out of reading the backend: Slack chips that save a preference for a channel nothing sends on, a Danger zone button labelled "Delete" whose dialog says the request is recorded when nothing records it, Webhooks that default new endpoints to an event name (request.created) the dashboard never emits (it emits request_created), Automations whose Assign and Change status actions can never run because the dialog never stores a target, and Integrations chips that say Connected when all that is known is that an environment key exists.
4. The frame details the requirement's acceptance list asks for: the section icon beside the section title, the header action wrapping cleanly at 375, 44px buttons at 375, toasts that clear the bottom tab bar, and a tablet layout that does not stack all 26 rail items above the pane.

## Page key by page key

| Page key | Live today | Differs from design | Port action |
|---|---|---|---|
| (frame) | Rail at md and up, native select picker below md, registry gates, deep link, scroll to top | No icon beside the section title. At 768 to 840px the one-column rule stacks the whole 26-item rail above the pane. Header action does not wrap at 375. btn1 and btn2 are 38px and 36px at 375. Toasts sit at 20px from the bottom, under the tab bar | Slice A: title icon from the registry through context, rail from lg with the picker below lg, 375 CSS |
| profile | ProfileSkeleton, AvatarUpload, fields, Save | Design edits email and shows a disabled Studio field | No work here. Owned by portal-account slice B (card foot, dirty tracking). Email stays disabled (sign-in is Clerk's) |
| appearance | Three localStorage toggles | Design uses a Light and Dark segmented control for theme | No work. Live toggles are the app pattern |
| notifications | Team events with Email, In-app and Slack chips, quiet hours, weekly digest row | Design disables Slack with a reason and says the digest job is not built | Slice D (after portal-account slice B): Slack as a muted non-interactive pill, honest digest line, honest foot copy |
| booking | List with Copy, EditDialog, EmptyRow, EmptyRow on error | Leaf empty state, per-link "where it appears" | Slice C: empty and error states, a chip on the top row saying it is the portal's Schedule a call link, lede without the spaced hyphen. The per-link placement select is skipped (only the top link is read anywhere) |
| booking:empty | EmptyRow "No booking links yet." | Leaf empty state with Add a link | Slice C |
| branding, branding:loading | Logo, two favicons, portal name, colour presets, SkeletonCard | None of substance (live is a superset) | Slice C: lede copy and a read-failure error block |
| modules | Three scopes, per module toggles | None of substance | Slice C: read-failure error block only |
| announce | Composer, live preview, publish or draft, fan-out toggle, past announcements list | Design is composer only, with an honest fan-out line | Slice C: honest fan-out copy, leaf empty state and error on the past list |
| studio | Full form, PM overrides, Getting paid strip with Entered and Still empty, save error line, Email delivery card at the foot | Design adds trading name, company number, next number, kickoff host, a Note about the all at once save, "Also on this page", currency dots | Slice C: the Note, the sub label, currency dots, okline icon, copy fix. The four extra fields are skipped (no keys, nothing reads them) |
| studio:loading | 13-box skeleton | Equivalent | No work |
| studio:error | Validator sentence in a role alert line | Equivalent for a save error. A READ failure is not handled at all: blank form, Save wipes fourteen keys | Slice C: read-failure block replaces the form and the Save button |
| forms | Global and per client lists, meta EditDialog plus inline question editor, ConfirmDialog | Design has a question builder dialog, a Default chip, a resolution Note | Slice A: Default chip, a Global default field for global General forms, the resolution Note (verified against api/admin/forms/resolve). The builder dialog is skipped (live inline editor wins) |
| forms:loading | Skeleton rows | Equivalent | No work |
| forms:empty | EmptyRow "No forms yet - add one to get started." | Leaf empty state, per mode copy | Slice A |
| forms:error | Not handled (shows the empty line) | LoadError block plus toast | Slice A |
| forms:dialog | Meta EditDialog (name, category, description, audience, SLA) | Different fields | No work beyond the Global default field |
| kanban | Drag reorder, colour dot, Global or Override chip, EditDialog, copy on write | Status subline, explicit Clone for client, Seed always visible | Slice A: status subline, explicit clone button when the client inherits |
| kanban:empty | EmptyRow plus "Install the default board" row (global only) | Leaf empty state with Seed the defaults | Slice A: leaf empty state, CTA keeps the live action and wording |
| kanban:error | Not handled | LoadError | Slice A |
| kanban:dialog | Name and colour | Design also edits the status value | No work (status is slugged server side) |
| kanban:seed | Not present | Seed that replaces the current board, behind a confirm | Skipped: the API seed is a no-op when columns exist, so the confirm copy would be false |
| tasktpl, tasktpl:dialog | List, priority chip, EditDialog | Richer subline | Slice A: subline with type, estimate and checklist count |
| tasktpl:empty, tasktpl:error | EmptyRow, not handled | Leaf empty state, LoadError | Slice A |
| pipedef, pipedef:loading | Per-field instant saves, skeleton | Design has a save bar and extra fields (default stage, stale after days, stale reminder) | Slice B: read-failure block only. Design-only fields skipped |
| stages | Drag reorder, colour dot, EditDialog (name, colour) | Chance of closing subline and editable probability | Slice B: read-only historical close rate subline (the API already returns it), Won and Lost chips, delete confirm. Editing probability is skipped |
| stages:empty, stages:error, stages:dialog | EmptyRow, not handled, EditDialog | Leaf empty, LoadError, dialog with probability | Slice B: empty and error. Dialog unchanged |
| leadauto | Toggles and scoring model select | Minor wording | Slice B: read-failure block only |
| integrations | Six rows, Connected or Connect chip | Cards with icon, honest body, state chip, Reconnect for Google, Slack warning | Slice B: card rebuild with honest chips (Key set rather than Connected for env-only services), Google Reconnect when a calendar scope is missing, the Slack note |
| integrations:loading | Skeleton rows | Skeleton cards | Slice B keeps the live skeleton, adds a body line |
| integrations:error | Not handled (shows Not connected) | No cards, LoadError | Slice B |
| webhooks, webhooks:dialog | List, toggle, EditDialog (URL, events), delete confirm, no failure toasts | Events help, last delivery, Zapier note | Slice B: event vocabulary in the help, default event fixed, "Never fires" chip for unknown events, failure toasts, Zapier note. Last delivery skipped (needs a backend join) |
| webhooks:empty, webhooks:error | EmptyRow, not handled | Leaf empty, LoadError | Slice B |
| automations, automations:dialog | Trigger to action rows, runs count, toggle, two-select EditDialog | Full builder, run history, templates, band | Slice B: run history slide-over from the existing log route, last run time, honest chips, a rule dialog with the action detail the executor reads. Builder conditions, several actions, per client scope, templates and the band are skipped |
| automations:empty, automations:error | EmptyRow, not handled | Leaf empty, LoadError | Slice B |
| crons | Schedule, last run, chip, Run now | Design note about Run now and the weekly digest | Slice B: lede and note |
| crons:empty | EmptyRow | Leaf empty, no CTA | Slice B, plus a read-failure block |
| aicontext, aicontext:picker | Six slots, ChangeDocDialog | "Link a page" when empty, updated date | Slice B: Link a page label, honest "Linked page not found", error states. Picker unchanged |
| emaildelivery, emaildelivery:log, emaildelivery:widen | Reference implementation: mode select, four validated lists, confirm on widening, held-back log with a confirmed Clear | Restyle (segmented mode, separate log card, waiting client row, exempt orgs named in the confirm) | Slice C: read-failure block (data safety) and log read-failure copy only. Restyle skipped |
| teamaccess, teamaccess:loading, teamaccess:empty, teamaccess:error | Pane with list skeleton, no error branch | PaneEmpty, PaneError, a "Nothing is granted by default" banner | No work here. ops slice 4 owns components/tahi/settings/team-access/*. The banner claim is false today (T1.15), so it should not be built there either |
| subscription | Plan row, seats, Edit plan details, Manage in Stripe | Renews row, honest lede | Slice C: honest lede, read-failure block, placeholder copy fix. Renews skipped (no key) |
| plans, plans:dialog | Rows with Stripe sync chip, EditDialog, no loading state (defaults flash), delete without confirm | Plan cards grid | Slice C: skeleton until the catalogue loads, read-failure block with writes hidden, delete confirm, copy fix. Card grid skipped (live rows carry the Stripe chip) |
| plans:empty | EmptyRow | Leaf empty | Slice C |
| reserves, reserves:dialog | Rows, EditDialog, remove without a word | Deactivate wording, note | Slice C: Deactivate label, honest toast and note |
| reserves:empty, reserves:error | EmptyRow, not handled | Leaf empty, LoadError | Slice C |
| audit, audit:loading | Search, prefix select, table, skeleton rows, footer | Clear search button, footer always shown | Slice C: clear button, footer at 0 |
| audit:empty, audit:error | Text row in the table, not handled | Leaf empty, LoadError | Slice C |
| danger, danger:confirm | Export (honest cap toast), Delete... button, type DELETE dialog, toast "noted" | Request deletion wording, honest copy | Slice C: button reads Request deletion, honest subline, dialog and toast that do not claim anything is recorded |
| seat:member | Shell drops the ten super admin sections | Design adds a dashed seat banner to explain the preview | No work. The banner is a preview annotation; absent means denied |

## The critic's still-open FIX items

None. The review lists no still-open items for settings after the revision pass. The two FIX items it resolved (forms:error showing a stale list or the empty state, and the failure channel for list sections) are carried into the port as the error rule in slice A: a failed read renders DataState's error branch with Try again in place of rows, never the empty state, and fires one error toast. The persistence of that toast is Liam question 2 and stays as today (fades).

## Slices

Four slices. A goes first. B and C start after A has merged (they import slice A's section-states.tsx and the RowActions label props) and can run in parallel. D is independent of A, B and C but starts only after portal-account slice B has merged, because both edit notifications.tsx. None needs a backend change or a migration.

### Slice A: frame, list states and Intake & boards (about 1.75 days)

Owned files: components/tahi/settings/section-context.tsx (new), components/tahi/settings/section-states.tsx (new), components/tahi/settings/primitives.tsx (SectionShell and RowActions only), components/tahi/settings/settings-shell.tsx, app/(dashboard)/settings/settings.css, components/tahi/settings/sections/request-forms.tsx, kanban.tsx, task-templates.tsx.

### Slice B: Sales & pipeline, Automations & integrations (about 2.5 days)

Owned files: components/tahi/settings/sections/pipeline-stages.tsx, pipeline-defaults.tsx, lead-automations.tsx, integrations.tsx, webhooks.tsx, automations.tsx, scheduled-jobs.tsx, ai-context.tsx.

### Slice C: Workspace, Billing and Advanced (about 2 days)

Owned files: components/tahi/settings/sections/booking.tsx, branding.tsx, modules.tsx, announcements.tsx, studio-details.tsx, email-delivery.tsx, subscription.tsx, plans-retainers.tsx, reserves.tsx, audit-log.tsx, danger-zone.tsx.

### Slice D: Notifications, studio reading (about 0.25 day, after portal-account slice B)

Owned files: components/tahi/settings/sections/notifications.tsx.

The four briefs follow in full.

---

### Brief A: frame, list states and Intake & boards

Design to follow: settings.jsx (SettingsFrame, the title icon), settings-kit.jsx (SectionShell with icon, EmptyState, LoadError, useErrorToast), settings-sections-b.jsx (Forms, Kanban, TaskTemplates), settings-extra.css and settings-extra-mobile.css (the 375 rules). Page keys: forms, forms:loading, forms:empty, forms:error, forms:dialog, kanban, kanban:empty, kanban:error, kanban:dialog, tasktpl, tasktpl:empty, tasktpl:error, tasktpl:dialog, plus the frame on every key. Use the app's primitives, not the prototype's: DataState (components/tahi/data-state.tsx) for the loading, error, empty and populated switch, EmptyState (components/tahi/empty-state.tsx) for the empty block, the settings Toasts and useToasts for toasts, lucide-react icons.

1. New components/tahi/settings/section-context.tsx. A React context holding the active section's LucideIcon (null by default), exported as SectionIconProvider, and a SectionTitleIcon component that renders nothing when the context is null and otherwise a span with className set-h2-ic and aria-hidden true wrapping the icon at size 20, strokeWidth 1.9. Export both so ops slice 4 can render SectionTitleIcon beside the Team & access pane's own h2 later (not this slice's job).
2. settings-shell.tsx. Wrap the active component in SectionIconProvider with value active.icon, so the icon beside the title is always the registry's rail icon (acceptance 1). Move the rail from md to lg: the nav gets hidden lg:flex, the mobile picker wrapper gets lg:hidden. Nothing else changes: registry, gates, deep link, replaceState, scroll to top.
3. primitives.tsx, additive only, two functions. SectionShell: give the header row className set-head, change its inline gap from 16 to '1rem', render SectionTitleIcon inside the h2 before the title text. RowActions: optional editLabel (default 'Edit') and deleteLabel (default 'Delete') used as the two buttons' aria-label. Do not touch Toggle or EditDialog (portal-account slice B adds props there); whichever slice lands second rebases, the changes are in different functions.
4. settings.css, inside the existing @layer components block, rem and tokens only in new rules. Add .set-h2-ic (inline-flex, vertical-align -0.15em, margin-right 0.5rem, color var(--brand)). Change the narrow-desktop one-column rule from max-width 840px to max-width 1023px so the grid is one column exactly when the picker shows. In the max-width 767px block add: .set-head wraps as a column with align-items stretch and gap 0.75rem, and .set-head .btn1 and .set-head .btn2 get justify-content center; .btn1 and .btn2 get min-height 2.75rem; .btn-ghost gets display inline-flex, align-items center, min-height 2.75rem; .set-row .sr-t gets flex 1 1 10rem so a sentence never collapses beside a wide control; .toast-wrap gets left 0.75rem, right 0.75rem, align-items stretch and a bottom that clears the mobile tab bar (measure .mtabs at 375, about 4rem, and set bottom to calc of that plus 0.75rem plus env(safe-area-inset-bottom)).
5. New components/tahi/settings/section-states.tsx (client component):
   - readFailureTitle(error: unknown, what: string): string. When error is an ApiError (lib/swr-fetcher.ts) with status 403: "You do not have access to " + what + ". Nothing was changed." Otherwise: what + " could not be loaded. Nothing has changed, this page just could not read it."
   - useReadFailureToast(error: unknown, toast: (msg: string, type?: 'ok' | 'err') => void, message: string). Fires one 'err' toast the first time error becomes truthy, re-arms when error clears. Uses a ref, not state.
   - SettingsEmpty({ icon: LucideIcon, title, description, ctaLabel?, onCtaClick? }). Renders EmptyState variant full with style padding '2.75rem 1.5rem 2.5rem', the icon at className w-6 h-6, and the CTA only when both ctaLabel and onCtaClick are given.
6. The list rule, for all three sections here and reused by B and C. Destructure error from every useResource the list depends on. Inside the existing set-card lrow-wrap, render DataState with loading = the section's existing waiting flag, hasData = Boolean(data), error, isEmpty, onRetry = () => void mutate() (that section only), errorTitle = readFailureTitle(error, "<Section name>"), skeleton = the section's existing SkeletonRows, empty = a SettingsEmpty. Call useReadFailureToast with the section's toast and a one sentence message. The header primary action is hidden when the list has loaded and is empty (the empty state's CTA is the way in); it stays visible while loading and on error (live behaviour; Liam question 3).
7. request-forms.tsx.
   - Lede: "The questions a client answers when they open a request. Ask for the thing you always end up asking for."
   - Empty, global mode: FileText icon, title "No intake form yet", description "Without one, a request is a title and a paragraph. Add the questions you always end up asking.", CTA "New form" calling createForm. Client mode: description "[client name] uses the global forms. Add one here to give them their own.", same CTA. No clients at all (client mode): title "No clients yet", description "Add a client first, then you can give them their own forms.", no CTA. This replaces both EmptyRow lines (one of which carries a spaced hyphen).
   - Toast on read failure: "Request forms could not be loaded. Nothing a client sees has changed."
   - Rows: a brand Chip "Default" when isDefault is 1, before the Global or Override chip. RowActions editLabel "Edit [name]", deleteLabel "Delete [name]".
   - Meta dialog: when the form being edited is global (orgId null) and its category is General, add a field key def, label "Global default", type select, options No and Yes, help "Used when a client has no form of their own and the category has none. Only one form is the default." On save with Yes: PATCH this form with isDefault true (and only if the saved category is still General), then PATCH isDefault false on every other global form currently flagged, then mutate. On No for a form that was the default: PATCH isDefault false. Toast "Could not save the form" on any failure. The PATCH route already accepts isDefault.
   - Under the card, a paragraph with className set-lede and the same inline margin the other foot notes use: "Most specific wins: a form for this client and this category, then this client, then this category, then the global default." (Matches app/api/admin/forms/resolve.)
8. kanban.tsx.
   - Lede: "The columns the Requests board draws, left to right. Global by default, with an override per client."
   - Empty, global mode: Columns3 icon, title "No columns set", description "The board has nothing to draw. Install the seven Tahi defaults, or add your own one at a time.", CTA "Install the default board" calling seedDefaults. Client mode, loaded and empty: description "This client follows the global board, and the global board has no columns yet. Switch to All clients to install the defaults.", no CTA. No clients: as in forms. Remove the separate install row.
   - Toast on read failure: "Board columns could not be loaded. The Requests board is unchanged."
   - Row subline under the label: "Requests with status " + (REQUEST_STATUS_LABELS[statusValue] from lib/status-config.ts, or the raw statusValue).
   - When mode is client and the client inherits a non-empty global set, a right-aligned row under the card with a btn2 "Give [client] their own columns" that calls the existing cloneForClient, then mutate, then toasts "Global columns copied for [client]." Busy state disables it.
   - RowActions labels as in forms. Drag behaviour unchanged.
9. task-templates.tsx.
   - Lede: "The jobs you run over and over, written down once. New from template on the Tasks page reads this list."
   - Empty: ClipboardCheck icon, title "No templates yet", description "Write down one job you do every month and it stops being retyped. The Tasks page picks it up straight away.", CTA "New template". Client and no-clients variants as in forms.
   - Toast on read failure: "Task templates could not be loaded. Tasks already made from one keep their checklists."
   - Subline: type label, then " · " and estimateLabel(estimatedHours) when set, then " · " and the parseChecklist(subtasks).length with "checklist item" or "checklist items" when above zero. Reuse the file's existing helpers.

States to verify, per section: loading, empty (global, client, no clients), error with Try again (block the endpoint in devtools), populated, create, edit, delete, drag (kanban), clone (kanban), default toggle (forms), toast on read failure. Frame: every section shows its rail icon beside the title at 1440; the picker (not the rail) shows at 768 and at 1023; the rail shows at 1024. 375: header action wraps under the title at full width, every button 44px, toasts sit above the tab bar, no horizontal scroll. Dark mode: title icon, EmptyState gradient tile, DataState error block, Default chip. No hex in new code (data colours such as a column colour are data, not styling).

Do not build: the prototype's LoadError, SkelList, EmptyState or Toasts components (use DataState, EmptyState and the settings Toasts); persistent error toasts with a close control (Liam question 2); the seed-and-replace confirm (kanban:seed, backend refuses); the FormBuilder dialog (the live inline question editor wins); question type relabels; a keyboard reorder handle; any change to Toggle, EditDialog, profile.tsx, notifications.tsx, appearance.tsx or people.tsx (portal-account); anything under team-access/ (ops slice 4).

---

### Brief B: Sales & pipeline, Automations & integrations

Starts after slice A has merged. Design to follow: settings-sections-b.jsx (PipelineDefaults, PipelineStages, LeadAutomations) and settings-sections-c.jsx (Integrations, Webhooks, Automations with RuleBuilder and RunHistory, Crons, AiContext), settings-data.jsx for sample shapes. Page keys: pipedef, pipedef:loading, stages, stages:empty, stages:error, stages:dialog, leadauto, integrations, integrations:loading, integrations:error, webhooks, webhooks:empty, webhooks:error, webhooks:dialog, automations, automations:empty, automations:error, automations:dialog, crons, crons:empty, aicontext, aicontext:picker. Use slice A's section-states.tsx (readFailureTitle, useReadFailureToast, SettingsEmpty), DataState, EmptyState, Callout (components/tahi/callout.tsx), ConfirmDialog (components/tahi/confirm-dialog.tsx), SlideOverShell and RowActions (settings primitives), RelativeTime (components/tahi/relative-time.tsx). Follow slice A's list rule (item 6 of brief A): DataState in the card, SettingsEmpty for empty, one error toast, header action hidden only when loaded and empty. Do not edit settings.css or primitives.tsx; new styling is inline with tokens and rem.

1. pipeline-stages.tsx.
   - Lede: "The columns on the Deals board, left to right."
   - Extend ApiStage with probability, historicalProbability (0 to 100 or null), dealsSampled, wonSampled, probabilitySource. Subline: when historicalProbability is not null, historicalProbability + "% of deals that reached this stage were won (" + wonSampled + " of " + dealsSampled + ")"; otherwise probability + "% until enough deals have passed through".
   - Chips: success "Won" when isClosedWon, neutral "Lost" when isClosedLost.
   - Empty: GitBranch icon, "No stages yet", "The Deals board needs at least one stage to put a deal in.", CTA "Add the first stage".
   - Delete now asks first: ConfirmDialog variant danger, title "Delete [name]?", description "If a deal is still in this stage the delete is refused and nothing changes.", confirmLabel "Delete stage". The existing refusal toast stays.
   - Toast on read failure: "Deal stages could not be loaded. No deal has moved."
2. pipeline-defaults.tsx and lead-automations.tsx: when the settings read (or pipeline defaults' team read) fails with no data, render DataState's error block in place of the form (readFailureTitle(error, 'Pipeline defaults') or 'Lead automations'), with Try again. No other change.
3. integrations.tsx, rebuilt as honest cards inside the existing card-grid2.
   - Each card: a set-card whose inner div is a flex column (gap 0.75rem, padding 1.125rem, flex 1). Head row: lrow-ic leaf tile with the service icon (CreditCard Stripe, Receipt Xero, CalendarDays Google Workspace, MessageSquare Slack, Mail MailerLite, Building2 HubSpot), the name in 600 weight, the state Chip on the right. Body: a paragraph at 0.8125rem, line-height 1.55, color var(--text-muted). Foot: the action or a set-field-note.
   - Env-only services never say Connected. Stripe: chip brand "Key set" or outline "No key"; body "Card payments and the customer portal. The billing flows live on the Billing page; this card only reports whether the key is in the worker environment."; foot note "Webhook secret set." or "Webhook secret not set, so Stripe events do not reach the dashboard." from webhookConfigured. Xero: chip "Keys set" or "No keys"; body "Invoice sync and payment reconciliation. The payment account code and the email mode are in Studio details."; when keys are set, a btn2 link "Reconnect" to apiPath('/api/admin/integrations/xero/connect') with foot note "The connection itself is not checked here."; when not set, note "Add the Xero client id and secret to the worker environment." Slack: chip "Token set" or "No token"; body "The bot token can be set while nothing sends: no part of the app calls Slack yet.". MailerLite: chip "Key set" or "No key"; body "Status only. Nothing in the dashboard sends to MailerLite yet." HubSpot: chip outline "No sync"; body "There is no HubSpot sync. Leads, deals and contacts live in this dashboard's own pipeline."
   - Google Workspace reads the google status payload (connected, email, scopes, errorMessage, configured). Not configured: chip outline "Not set up", note "Add the Google client id to the worker environment." Connected and scopes include both https://www.googleapis.com/auth/calendar.events and https://www.googleapis.com/auth/calendar.freebusy: chip success "Connected", body "Calendar reads and writes for scheduled calls, as [email].", btn2 link "Reconnect". Connected but a scope is missing: chip warning "Needs a reconnect", body "The grant on file predates the calendar write scope, so a booked call can go through without landing in the calendar. Reconnect to pick the new scope up.", btn1 link "Reconnect". Not connected: chip outline "Not connected", btn1 link "Connect". Links go to apiPath('/api/admin/integrations/google/start'). When errorMessage is set, show it as a set-field-note in the danger ink.
   - Under the grid: Callout tone warning, title "Key set is not the same as working", body "It means the credential is in the worker environment, not that anything is sending. Slack is the live example."
   - States: loading keeps the live skeleton cards and adds one body line. Status read failure: DataState error in place of the grid (readFailureTitle(error, 'Integration statuses')) and toast "Integration statuses could not be read. No connection has changed." Google read failure alone: that card's chip neutral "Could not read" with a btn2 "Try again" calling the google mutate.
4. webhooks.tsx.
   - Lede: "Outbound events, each one signed with the endpoint's own secret in an X-Tahi-Signature header."
   - A constant WEBHOOK_EVENTS with the eight values emitted today (request_created, request_status_changed, request_overdue, invoice_created, invoice_paid, invoice_overdue, client_onboarded, client_inactive) plus '*', with a comment pointing at DomainEventType in lib/events.ts (do not import that server module). Both dialogs: Events field help "Comma separated. Available: " + the list joined with ", " + ". Use * for every event." The add dialog defaults to request_created (today it defaults to request.created, which no event matches, so a new endpoint never fires).
   - On save, if any entered event is not in the list, keep the dialog open and toast "[event] is not an event the dashboard sends. Use a name from the list under the field." (err).
   - Rows: for an existing endpoint with any unknown event, a warning Chip "Never fires" with title "[event] is not an event the dashboard sends".
   - Every write checks res.ok and toasts on failure: create "Could not add the endpoint", save "Could not save the endpoint", toggle "Could not change the endpoint" (the optimistic flip reverts through the existing mutate), delete "Could not remove the endpoint". Add useToasts and Toasts to the file.
   - Empty: Webhook icon, "No endpoint registered", "Point one at your own service and requests, invoices and client changes arrive there as they happen.", CTA "Add endpoint". Toast on read failure: "Endpoints could not be loaded. Deliveries are unaffected."
   - Under the card, set-lede: "There is no Zapier setup here yet. A Zapier catch hook is just another endpoint on this list."
   - RowActions labels "Edit [url]" and "Remove [url]".
5. automations.tsx.
   - Lede: "When something happens in the workspace, do one thing. Each rule is a trigger and an action."
   - Row subline: executionCount + " runs, last " + RelativeTime(lastExecutedAt) when lastExecutedAt is set, otherwise "Never run". When executionCount is above zero the runs text is a btn-ghost that opens Run history.
   - Paused rule (enabled false): title and subline in var(--text-muted), leaf tile with background var(--bg-secondary) and color var(--text-faint).
   - Honesty chips: every action is send_email, post_to_slack or send_slack: warning Chip "Never sends" with title "Automations never send email or Slack on their own. The run is logged as skipped." First action is assign or assign_pm without config.assigneeId, or change_status or update_status without config.status: warning Chip "Needs a target" with title "Edit the rule and choose who or which status, or this action does nothing."
   - Rule dialog replaces the EditDialog. Section-local, following the portal and .dlg markup of the local ConfirmDialog in webhooks.tsx (createPortal to document.body, dlg-backdrop, dlg, Escape closes, focus the first control). Fields: When (trigger select, the existing TRIGGERS), Do (action select, the existing ACTIONS), then a detail control that depends on Do: Assign to on-call PM shows "Who" (team member select from GET /api/admin/team items, stored as config.assigneeId); Change status shows "To status" (REQUEST_STATUSES from lib/status-config.ts without archived, stored as config.status); Send notification shows "Who hears it" (Team or The client's contacts, stored as config.audience 'team' or 'client'); Create kickoff task shows "Task title" (text, stored as config.title, placeholder "Follow up: [rule name]"); Send email and Post to Slack show a set-field-note "Held for a person. Automations never send email or Slack on their own, so this rule logs a skipped run." Save builds actions as [{ type, config }] followed by any trailing actions already stored, keeping the first action's config when its type is unchanged. Footer: btn2 Cancel, btn1 "Save rule".
   - Run history: SlideOverShell with a Zap icon, title the rule's label, sub "Newest first", footNote "Read from the automation log.", body reading GET /api/admin/automations/log?ruleId=[id]&limit=50 with useResource. Each entry: an 8px round dot (var(--brand) for success, var(--danger) for error), RelativeTime(executedAt), and below it the parsed actionsExecuted strings one per line, or errorMessage for an error run. Loading: three pulse rows. Empty: "This rule has not fired yet." Error: "The run log could not be read." with a btn2 Try again.
   - Every write checks res.ok and toasts on failure (today create, save, toggle and delete swallow errors).
   - Empty: Zap icon, "No rules yet", "Start with the one you do by hand every week.", CTA "New rule". Toast on read failure: "Rules could not be loaded. Anything switched on keeps running."
   - Under the card, set-lede: "Rules run on the server when the event happens. Request overdue and Client inactive run on the sweep in Scheduled jobs."
6. scheduled-jobs.tsx. Lede "Every background job, when it last ran, and a way to run it now without waiting for the schedule." Empty: Clock icon, "No jobs registered", "Nothing is scheduled in this environment.", no CTA. Read failure: DataState error, toast "The job list could not be read. Every job still runs on its own schedule." Under the card, set-lede: "Run now posts to the job from here, so it works whether or not the external scheduler is firing. The weekly digest job does not exist yet, so it is not listed."
7. ai-context.tsx. Lede "The pages that ground what the studio AI writes. Each slot points at one Docs Hub page, and the AI reads that page when it writes." Button reads "Link a page" when the slot has no id, "Change" otherwise. When a slot has an id but the docs list loaded and has no such page: subline "Linked page not found" in var(--danger) ink. Settings read failure: DataState error in place of the grid. Docs read failure: every slot's subline "Could not read the Docs Hub list", Change disabled with that title, and one toast. Do not change ChangeDocDialog beyond the label, and never touch Docs Hub code or routes.

States to verify, per section: loading, empty, error with Try again, populated, and every write's success and failure toast. Automations: create, change action and detail, save, toggle, delete, open run history (success run, error run, empty, log read failure). Webhooks: unknown event refused in the dialog, Never fires chip on an old endpoint. Integrations: each Google state (fake the payload in devtools), status read failure. 375: cards stack, the rule dialog and slide-over fit the width, detail controls stack, targets 44px (slice A's CSS), no horizontal scroll. 768 and 1024. Dark mode on every chip, the Callout, the status dots and danger inks. No hex in new code.

Do not build: the prototype's RuleBuilder conditions, several actions, per-client scope, the Templates dialog and the three-tile automations band (backend vocabulary and columns needed; see skipped list); a last delivery column on Webhooks (backend); editing stage probability; the design's extra pipeline default fields; Xero "OAuth refreshed" or Manage; any edit to settings.css, primitives.tsx, section-states.tsx, or the Docs Hub.

---

### Brief C: Workspace, Billing and Advanced

Starts after slice A has merged. Design to follow: settings-sections-a.jsx (Booking, Branding, Modules, Announcements, Studio, GettingPaid) and settings-sections-c.jsx (EmailDelivery, Subscription, Plans, Reserves, Audit, Danger). Page keys: booking, booking:empty, branding, branding:loading, modules, announce, studio, studio:loading, studio:error, emaildelivery, emaildelivery:log, emaildelivery:widen, subscription, plans, plans:empty, plans:dialog, reserves, reserves:empty, reserves:error, reserves:dialog, audit, audit:empty, audit:loading, audit:error, danger, danger:confirm. Use slice A's section-states.tsx, DataState, EmptyState, ConfirmDialog (components/tahi/confirm-dialog.tsx), SegmentedControl (already used by Studio details), lucide icons. Follow slice A's list rule for list sections. The data-safety rule for this slice: where a write replaces a whole stored blob or a whole form (Booking links, Client plans, Studio details, Email delivery), a failed first read hides every write control, not just the list. Do not edit settings.css or primitives.tsx.

1. booking.tsx. LEDE "Your calendar links. The top one is the link behind the portal's Schedule a call button." The first row gets a brand Chip "On the portal". Empty: CalendarClock icon, "No booking link yet", "Add one and the portal's Schedule a call button points at your calendar.", CTA "Add a link" (the existing handleAdd); header New link hidden when empty. Error: replace the EmptyRow error branch with DataState's error (readFailureTitle(error, 'Booking links')) and hide New link (the list saves as one blob).
2. branding.tsx. LEDE "How the client portal looks: the logo, the name and the accent colour." When the settings read fails with no data, DataState error in place of the editors. Nothing else.
3. modules.tsx. Settings read failure with no data: DataState error in place of the module list. Overrides read failure in role or client scope: the same error block inside that card. Nothing else.
4. announcements.tsx. Fan-out row description: "Every contact who would see the banner gets one email, through the email delivery allowlist, so nothing reaches a client while the gate is closed. The fan out has not been checked against a real send yet." Past announcements: SettingsEmpty with Megaphone icon, "No announcements yet", "Write one above. It shows as a banner across the portal once published.", no CTA; read failure: DataState error with Try again and the toast "Announcements could not be loaded. Nothing on the portal has changed." The client picker's inner "No clients to choose from yet." stays.
5. studio-details.tsx.
   - Read failure (settings error and no data): DataState error, errorTitle "Studio details could not be loaded, so the form is hidden. Saving a blank form would overwrite every field.", Try again, and no Save button. The Email delivery card below still mounts (it handles its own read).
   - Team read failure: the three project manager selects are disabled and show a set-field-note "The team list could not be read, so the current choice is kept." Save still writes the stored ids unchanged.
   - Above the save row, inside the card, a set-field-note paragraph: "Save writes every field on this card at once. The checks run before anything is sent; if the server still refuses a field, the others may already be saved, so reload before trusting what is shown."
   - The saved line becomes a Check icon (size 15) plus "Details saved".
   - Currency tabs: each SegmentedControl option gets an icon, a 0.375rem round span, background var(--color-brand) when accountIsSet for that currency and var(--color-border) otherwise, aria-hidden. Keep the existing title.
   - The foot paragraph becomes "Invoices pick these details up when they are generated. Xero synced invoices keep Xero's own numbering." (no spaced hyphen).
   - A set-sub-label "Also on this page" above EmailDeliveryCard.
6. email-delivery.tsx. When the settings read fails with no data: the header row's small text reads "The current setting could not be read." and the form grid and Save row are replaced by DataState's error (readFailureTitle(error, 'Email delivery')) with Try again; the log button stays. When the log read fails: the table body reads "The held-back log could not be read. Nothing was cleared." and Clear log is disabled. Nothing else changes; this is the reference implementation.
7. subscription.tsx. Lede "What the studio pays for Tahi. It is not billed through the Stripe integration your clients use, so the plan details here are typed in by hand." Settings read failure: DataState error in place of the rows; keep Manage in Stripe, hide Edit plan details. Billing note placeholder "Billed monthly, next charge 1 Aug".
8. plans-retainers.tsx. While the settings read is loading with no data, render three skeleton rows (animate-pulse in the lrow chrome, like reserves) instead of the default catalogue. Read failure: DataState error, errorTitle "The plan catalogue could not be loaded. Editing now would overwrite what every client is offered.", hide Add plan and RowActions. Empty: Coins icon, "No plans in the catalogue", "The client Plan page and Services have nothing to show until there is one plan here.", CTA "Add plan". Delete asks first: ConfirmDialog variant danger, title "Remove [name] from the catalogue?", description "Clients stop being offered it on Plan & billing and Services. Existing subscriptions are not changed.", confirmLabel "Remove plan". Foot paragraph "Extra tracks let a client run more work in parallel, priced per plan above."
9. reserves.tsx. Lede "Money set aside before anything counts as spendable. Financial reports takes these off the bank balance to work out what is free." Empty: PiggyBank icon, "No reserve pots", "Without a tax pot, disposable cash is the whole bank balance. Add the tax pot first.", CTA "New pot". RowActions deleteLabel "Deactivate [name]"; a successful deactivate toasts "Pot deactivated. Its balance and history are kept." Under the card, set-lede: "Removing a pot deactivates it rather than deleting it, so its accrued balance and history stay on the record." Toast on read failure: "Reserve pots could not be loaded. Disposable cash on the reports page is unchanged."
10. audit-log.tsx. Placeholder "Filter by person, action or target", aria-label "Filter the audit log", and a ta-search-x clear button (X icon, aria-label "Clear the filter") when the query is non-empty, as the Team & access search has. Empty: the tbody row's cell holds SettingsEmpty with ScrollText icon; filtered: "Nothing matches this filter", "Widen it, or clear the search.", CTA "Clear the filter" resetting query and prefix; unfiltered: "No actions logged yet", "The first change anyone makes appears here.", no CTA. The footer always shows, reading "0 actions" when empty. Read failure: DataState error in place of the table, toast "The audit log could not be read. Nothing has been lost, the record is written on the server."
11. danger-zone.tsx. Export row: "Export all data", subline "One JSON archive of every table this workspace owns. Large tables are capped, and the download says which ones were shortened." Delete row: title "Delete workspace" in var(--danger), subline "Automated deletion is not switched on. Nothing is removed from here; deleting the workspace is a manual job for the Tahi team.", button label "Request deletion" (never "Delete"). Dialog body: "Deleting the workspace would remove every client, request, invoice, file and message. Automated deletion is not switched on, and this button does not record or send anything: nothing is removed until the Tahi team does it by hand." Keep the type DELETE input (case-insensitive, as today) and the confirm label "Request deletion". Toast on confirm: "Nothing was removed. Deleting the workspace is a manual job for the Tahi team." Under the card, set-lede: "This is the whole workspace. Deleting a single client lives on that client's own page."

States to verify: every section's loading, empty, error with Try again, populated; the data-safety cases (block /api/admin/settings in devtools on Studio details, Email delivery, Client plans and Booking links and confirm no Save, Add or edit control remains); plan delete confirm; reserve deactivate toast; audit filtered and unfiltered empty; danger dialog arming on DELETE. 375: Studio details grid stacks and the currency strip fits, Email delivery log scrolls inside its wrapper, audit table scrolls inside hist-wrap, every target 44px, no horizontal scroll. 768 and 1024. Dark mode on the currency dots, danger ink, EmptyState tiles and error blocks. No hex in new code.

Do not build: trading name, company number, next invoice number, a separate kickoff host (no settings keys and nothing reads them); the Email delivery restyle, the waiting client row or naming exempt orgs in the confirm (Liam question 7); the plan card grid; a Renews row on Subscription; a "request recorded, team told" Danger zone flow (needs backend, Liam question 8); per-link placement on Booking; any edit to settings.css, primitives.tsx or section-states.tsx.

---

### Brief D: Notifications, studio reading

Starts after portal-account slice B has merged (it restructures this file: moves quiet hours into the events card and rewrites the client foot). Design to follow: settings-sections-a.jsx, the Notifications function, studio branch (page key notifications with audience owner). Change the studio branch (isAdmin true) only; the client branch is portal-account's.

1. Slack channel: for the team events, render Slack as a non-interactive span shaped like .ntf-ch but muted (background var(--bg-secondary), color var(--text-faint), the subtle border), no role switch, title "Slack sending is not wired up yet", aria-label "[event] via Slack, not available yet". Reuse the muted pill portal-account slice B introduced for Studio notes if it landed as a shared style in this file.
2. Weekly digest row description: "A Monday summary of the studio. The digest job is not built yet, so nothing sends." Keep its switches (they store a real preference).
3. Studio foot paragraph: "In-app preferences apply immediately; email preferences apply as each alert adopts them. Slack does not send yet. Receipts and contracts always send."

States: loading, toggle success, toggle failure revert (unchanged), the Slack pill in light and dark, 375 (pills wrap full width at 44px as settings.css already does). No hex.

Do not build: any client-branch change, a Slack connect flow, a digest cron.

---

## Skipped proposals and design-only elements (live behaviour kept)

- Automations: the full rule builder (conditions, several actions per rule, per client scope), the Templates dialog and the three-tile band (running, fired this month, needs a look). Conditions need a per-trigger field vocabulary the events do not publish, scope needs a column, the band needs aggregation, and several template actions (email, Slack, webhook, comment, priority, flag) are not executable. The port keeps one trigger and one action and adds the detail the executor already reads.
- Kanban seed that replaces an existing board, behind a confirm (kanban:seed). The API seed is a no-op when columns exist.
- Webhooks: last delivery time and status code per endpoint. The data exists in webhook_deliveries but the GET does not join it.
- Studio details: trading name, company number, next invoice number note, separate kickoff host select.
- Email delivery restyle: segmented mode switch, a separate Held messages card, the "client is waiting on this" row, and naming exempt organisations in the Everyone confirm (requirement question 4).
- Danger zone: "records the request, notes who asked and tells the Tahi team". Nothing records it today; needs backend (requirement question 5).
- Integrations: Xero "OAuth, refreshed" state and a Manage action (no Xero OAuth status route).
- Client plans as a plan card grid (live rows keep the Stripe sync chip).
- Pipeline defaults: default stage, deal goes stale after N days, stale reminder toggle. Lead automations: the "what a high score rewards" select. Not live keys.
- Pipeline stages: editing the chance of closing (the forecast uses the historical rate once enough deals exist).
- Booking: per-link "where it appears" select (only the top link is read anywhere).
- Request forms: the FormBuilder dialog and its question type labels (the live inline question editor wins).
- Reserves: the free-text "How it fills" field (live stores a rate).
- Profile studio reading: editable email and a disabled Studio field (portal-account owns the file; sign-in email stays disabled).
- Appearance: a Light and Dark segmented control instead of the toggle.
- Team & access loading, empty and error states and the "Nothing is granted by default" banner: owned by ops slice 4; the banner would be false today (T1.15).
- The member seat band (seat:member): a preview annotation, not product UI.
- Error toasts that persist until dismissed (review question 2); hiding the primary action on a failed read for CRUD lists (review question 3); Try again refetching the whole pane (review question 4); splitting Studio details into per-group saves (requirement question 1); Zapier config (requirement question 2).

## Questions for Liam

1. The list sections now use the leaf empty state (requirement question 3). CLAUDE.md asks for it on every list view, so the port does it. Confirm, or say the word and each section swaps back to a text row.
2. Error toasts fade after about 3.4 seconds, like the success ones. Should a failure stay until dismissed?
3. On a failed read, list sections with their own create endpoint keep the New button visible (today's behaviour). Only the blob sections (Booking links, Client plans, Studio details, Email delivery) hide their write controls, because a write there would overwrite everything. Want the New buttons hidden too?
4. Try again refetches only that section. Should it refetch the whole pane?
5. Studio details stays one Save across fourteen keys, with a note about partial writes. Split it into studio identity, getting paid and project managers?
6. Zapier config: inside Webhooks, or its own section?
7. Should the Everyone confirm on Email delivery name the exempted organisations?
8. Delete workspace records nothing today; the port now says so. Should a request write an audit row and email business@tahi.studio, or stay a manual conversation? And manual forever, or self-service one day?
9. Webhooks: add last delivery per endpoint (a small backend join, no migration)? Show and copy each endpoint's signing secret, so a receiver can actually verify the signature?
10. Automations: build the full rule builder (conditions, several actions, templates)? And should Send email and Post to Slack stay selectable, given they are always skipped?
11. HubSpot: there is no HubSpot sync. Keep the card as "No sync", or remove it?
12. The settings rail now starts at 1024px; below that the section picker shows (at 768 today the whole rail stacks above the pane). Happy with that?
13. Kanban: want a real "reset to the Tahi defaults" for an existing board (backend change)?

## Risks

- primitives.tsx is edited by portal-account slice B (Toggle, EditDialog) and by slice A here (SectionShell, RowActions). Additive, different functions; the second to land rebases.
- notifications.tsx is portal-account slice B's until it merges; slice D waits for it.
- The Team & access pane renders its own h2, so it shows no title icon until ops slice 4 adds SectionTitleIcon beside it (one line; the export is ready).
- The section icon also appears on the client branch's titles (Profile, Organization, People, Brand, Plan & billing). Intended (it is the frame), but it is a visible change to the client settings.
- Moving the rail to lg changes the 768 to 1023 layout for every section. Check a laptop at 1024 with the app sidebar expanded.
- Webhooks: endpoints saved earlier with dotted names (request.created) have never fired. The Never fires chip will say so on production; they need re-saving with the underscore names.
- Automations: once a target is picked, Assign and Change status rules start doing real work on the next matching event. Intended, but it is the first time these rules act.
- Client plans no longer shows the default catalogue while loading; a slow read now shows a skeleton.
- The data-safety blocks hide Save on a failed read; a flaky settings endpoint now shows an error instead of an editable form. That is the point, but it will be noticed.
- Callout's warning tone uses the shared primitive's own colours; check its contrast in dark.
- Live smoke, 375 and dark screenshots are owed per slice under the Definition of Done; this plan is ported, unchecked.

## Shared files

- components/tahi/settings/primitives.tsx (slice A here; portal-account slice B too)
- components/tahi/settings/settings-shell.tsx (slice A; portal-account question 1 would touch it)
- app/(dashboard)/settings/settings.css (slice A; ops slice 4 reads it and adds its own team-access.css)
- components/tahi/settings/sections/notifications.tsx (portal-account slice B, then slice D)
- components/tahi/settings/sections/profile.tsx, appearance.tsx, people.tsx (portal-account; not edited here)
- components/tahi/settings/team-access/* (ops slice 4; not edited here)
- components/tahi/data-state.tsx, empty-state.tsx, callout.tsx, confirm-dialog.tsx, segmented-control.tsx, relative-time.tsx, skeletons.tsx (consumed, not edited)
- lib/status-config.ts (read)
- app/(dashboard)/app-shell.css and app/globals.css (not edited)
