# Design requirements: studio-settings

Group: `studio-settings`. Audience: studio (Tahi team). Route: `/settings` (one route, `SettingsShell` composes 30 registry entries, 26 of them studio-visible, behind a sub-nav), plus three legacy URL shims (`/settings/audit`, `/settings/automations`, `/settings/crons`) that redirect into it. This document covers the 23 sections whose `audience` is `'admin'` in the section registry (`components/tahi/settings/settings-shell.tsx`; numbered items 4 to 26 in section 2 below, one item per registry row, including Email delivery as both its own row and a second card mounted at the foot of Studio details), the 3 sections whose `audience` is `'both'` read from the studio side (Profile, Appearance, Notifications), and the deep `Team & access` pane. It does not re-document the client branch of `/settings` (Organization, People, Brand, Plan & billing) or the client reading of Profile/Appearance/Notifications: those are `client-account-notifications.md` and `client-billing-services.md`, separate design-requirements groups. Where a studio section is functionally identical for both audiences (Profile, Appearance, Notifications), this document states that plainly and does not repeat the client doc's detail. Task templates is also documented in full here even though `studio-tasks.md` references it, because the CRUD lives entirely on this route.

Sources read: CLAUDE.md (design system, mobile, dark mode, no em/en dash rule), STATUS.md "Since the last update" and the triage snapshot ("Settings rebuild" is listed under "Trusted 100%: verified locally + promoted; client-session QA of portal sections still pending"), `docs/superpowers/plans/2026-09-13-page-catalogue.md` (the `/settings`, `/permissions`, `/settings/audit`, `/settings/automations`, `/settings/crons` rows in section 2, and the Zapier/Xero-override/quiet-hours/weekly-digest rows in section 3), `docs/superpowers/plans/2026-09-13-design-review-checklist.md` (the "Settings (studio)" row: ported, no critic verdict recorded), every TASKS.md line naming these routes or their features (LW.3, LW.8, PM.1, T1.6, T1.15, T1.16, T1.18, T570, T667, T698-699, T682-693, MC.0, MC.4, MC.9), the live code (`app/(dashboard)/settings/**`, `components/tahi/settings/**` including every file under `sections/` and `team-access/`, `app/api/admin/settings/route.ts` and the other API routes named per section below), and the Claude Design project (`Tahi Settings.html`, `settings-app.jsx`, `settings.css`), read directly with the claude-design MCP.

One correction up front: the checklist and catalogue both say "not critic-covered" for this surface, which is accurate, but STATUS.md's "Trusted 100%" line is the stronger and more current signal — this is one of the few surfaces the team already treats as done pending a formal design critique, not a build task.

---

## 1. Purpose and audiences

`/settings` is the one place every knob in the workspace lives: legal and billing identity, how a client gets paid, what a client is allowed to see, what fires automatically, what the studio's own team can reach, and the irreversible actions kept behind glass. It is also, for both audiences, the personal preferences page (who you are, how the product looks, what reaches you).

Who opens it: any signed-in user, studio or client. `app/(dashboard)/settings/page.tsx` computes `studio = isAdmin && !isPreviewingClient` server-side and passes one boolean into `<SettingsContent isAdmin={studio}>`; everything downstream branches on that single flag. A Tahi team member whose role denies the `settings` FEATURE_TREE key is redirected server-side before the page renders (`requirePageFeature('settings')`) — the sidebar hiding the link is cosmetic, this redirect is the real gate. A client impersonation session (the `tahi-impersonate-org` cookie) always renders the client branch, never the studio one, regardless of who is doing the impersonating.

What it must never show:
- **A client, ever, any studio-only section.** `SettingsShell`'s `groupOrder`, `visibleSections` and the mounted component are all derived from the one `isAdmin` boolean the server passed down; there is no client-reachable path to Studio details, Integrations, Webhooks, Team & access, Danger zone or any other `audience: 'admin'` section, regardless of URL manipulation (`?section=studio` on a client session renders nothing, because the section is filtered out of `visibleSections` before the deep-link effect runs).
- **A non-super-admin teammate, ten sensitive sections.** Modules, Studio details, Integrations, Webhooks, Scheduled jobs, Email delivery, Team & access, Subscription, Client plans and Reserves all carry `superAdminOnly: true` in the registry. This is the cosmetic layer only; the API routes behind each one re-check independently (mostly `isTahiAdmin` plus a `resolvePermissions().isSuperAdmin` check, documented per section below). A scoped teammate who is not super admin never sees these ten in the sub-nav even though `isAdmin` is true for them.
- **A scoped teammate, Integrations or Team & access, via the granular feature gate.** `SECTION_FEATURE_KEYS` maps `integrations` to `settings.integrations` and `teamaccess` to `settings.permissions`; if `resolvePermissions` resolves either key to `false` for the caller, the section drops out of the sub-nav on top of the super-admin check. This is the one place in the registry where a role/org override, not just the super-admin flag, can hide a section — see Decision `project_permissions_vision.md` (visible = permitted, absent = denied) for why that distinction matters to a reviewer.
- **A client member (non-admin contact), the People section of their own org.** Out of scope for this document (see `client-account-notifications.md`), named here only because it is the mirror-image rule of the studio gates above and a reviewer should recognise the same pattern.
- **Messages.** Not a `/settings` concern directly, but relevant tenancy context for anyone reviewing this surface: the 2026-09-13 decision that Messages stays hidden for a client org with no explicit override (`lib/permissions.test.ts`) is enforced through the same `resolvePermissions`/FEATURE_TREE machinery that gates Integrations and Team & access here. A reviewer checking one should understand the other exists.
- **Permission decisions with only cosmetic teeth.** T1.6 (client `feature_visibility` denies are nav-cosmetic only, not enforced at the route) and T1.15 (deny-by-default is still "in progress": an unset `teamMemberAccess` row currently defaults to unrestricted, not denied) are both open. A design review should not assume every "hidden" section is also "denied" server-side yet; today most are, a few named ones are not.

## 2. Pages, sub pages and entry points

**`/settings`** — the one canonical route. Reached from the sidebar (studio and client both have a Settings item), and from three legacy shims: `/settings/audit`, `/settings/automations`, `/settings/crons` each `redirect('/settings?section=<id>')` after the same auth/feature gate the main page runs (admin-only, bounces a client-view session to `/overview`). `?section=<id>` deep-links to any section the caller may see (`SettingsShell`'s mount effect); an unreadable or unknown id is silently ignored and the first visible section renders instead. Switching sections writes `?section=<id>` back via `history.replaceState` and scrolls `#main-content` to the top, so a bookmark or a shared link always lands correctly and a section switch never leaves you mid-scroll on the last one.

**Desktop sub-nav** (`md` and up): a left rail, grouped exactly as the registry orders them, group label then items, current item marked `aria-current="page"`. **Mobile** (`<md`): a single "Settings section" native `<select>` with `<optgroup>` per group, opened by tapping a full-width pill that mirrors the current section's icon and label.

The 21 admin sections, grouped as they render (icon, one-line job, entry point beyond the rail/picker):

*Account* (also reachable, same components, by a client — see `client-account-notifications.md`):
1. **Profile** (`?section=profile`) — name, avatar, role/title, phone. Admin fields via `GET`/`PATCH /api/admin/profile`.
2. **Appearance** (`?section=appearance`) — theme, reduce motion, sidebar-start-collapsed. Device-local (`localStorage`), no API.
3. **Notifications** (`?section=notifications`) — per-event channel chips. `GET`/`PATCH /api/admin/notifications`.
4. **Booking link** (`?section=booking`, admin-only) — the team member's own booking URL(s) shown to clients on call CTAs.

*Workspace*:
5. **Branding** (`?section=branding`, admin) — workspace logo/colour, via `/api/admin/settings` plus the R2 upload flow (presign/confirm/serve).
6. **Modules** (`?section=modules`, super-admin) — whole-module on/off, three scopes (workspace, role, single client). Sub-dialogs: none, inline toggles per module per scope tab.
7. **Announcements** (`?section=announce`, admin) — compose/preview/publish portal banners. Full CRUD list with an inline composer and a live `.ann-bar` preview; not a separate dialog.
8. **Studio details** (`?section=studio`, super-admin) — legal identity, invoicing defaults, and the "Getting paid" sub-group (five-currency tab strip plus a default fallback account, Xero payment account code, Xero email mode), with the **Email delivery** card mounted at its foot as a second, independently-headed card on the same pane (it also has its own top-level sub-nav entry, "one control, two doors").

*Intake & boards* (admin):
9. **Request forms** (`?section=forms`) — intake question sets clients fill in when opening a request. Global-vs-per-client toggle (`PerClientHeader`), list plus an edit dialog for form meta and a question builder (6 question types).
10. **Kanban columns** (`?section=kanban`) — the board columns Requests renders. Global-vs-per-client toggle, drag-to-reorder list, add/edit dialog, "seed defaults" and "clone for this client" actions.
11. **Task templates** (`?section=tasktpl`) — reusable task templates (type, priority, description, checklist-becomes-subtasks, estimate, default assignee). Global-vs-per-client toggle, list, edit dialog. Consumed by `/tasks`' "New from template" menu and the New task dialog — see `studio-tasks.md` section 2, which explicitly defers CRUD documentation here.

*Sales & pipeline* (admin):
12. **Pipeline defaults** (`?section=pipedef`) — default deal owner and related pipeline defaults, `/api/admin/settings`.
13. **Pipeline stages** (`?section=stages`) — the deal stage list, `/api/admin/pipeline/stages`, add/edit/reorder/delete.
14. **Lead automations** (`?section=leadauto`) — lead-scoring and enrichment toggles, `/api/admin/settings`.

*Automations & integrations* (mixed super-admin):
15. **Integrations** (`?section=integrations`, super-admin, feature-gated `settings.integrations`) — a card grid: Stripe/Slack/MailerLite/Xero (env-var truth via `/api/admin/integrations/status`), Google Workspace (OAuth truth via `/api/admin/integrations/google/status`, real Connect flow), HubSpot (always "available", built in). "Reconnect" is the entry point named in LW.8/LW.8b for the Google calendar-write scope fix.
16. **Webhooks** (`?section=webhooks`, super-admin) — registered outbound endpoints (URL, event set, active switch). List, add-endpoint dialog, per-row edit and delete. Real delivery via `lib/webhooks.ts`.
17. **Automations** (`?section=automations`, admin) — trigger-to-action rules with an on/off switch and a lifetime run count. List, create/edit dialog, real execution via `lib/automation-executor`.
18. **Scheduled jobs** (`?section=crons`, super-admin) — every background cron, its schedule, last run, and a "Run now" button per row that POSTs the job's own endpoint and toasts the outcome.
19. **AI context** (`?section=aicontext`, admin) — six grounding slots (ICP, Brand DNA, Tone, etc), each pointing at a Docs Hub page id. A card grid, "Change" opens a doc-picker dialog over the Docs Hub list.
20. **Email delivery** (`?section=emaildelivery`, super-admin, also embedded at the foot of Studio details) — the allowlist gate: mode, allowed domains, allowed addresses, never-list, allowed org ids, and a 100-row suppression log behind a "reveal" link with its own confirm-gated Clear button. Switching the mode to "Everyone" routes through a `<ConfirmDialog>` naming the consequence; closing the gate is immediate, no confirm.

*Team & access* (super-admin, feature-gated `settings.permissions`):
21. **Team & access** (`?section=teamaccess`) — the same `TeamAccessPane` the standalone `/permissions` route mounts (one permissions surface, two entry points). Three tabs (Team members / Clients / Roles), search, a master-detail editor (role assignment, data scope: all clients / by plan / specific clients, per-feature overrides), sub-dialogs: the **feature override slide-over** (`FeatureSlideOver`, per-subject Inherit/Allow/Deny grid), the **copy-access dialog** (clone one subject's rules onto another), the **change-history** view (read-only audit of permission edits), and **preview-as** (reuses the existing impersonation machinery — client view sets the portal cookie, team view simulates scoping without a real session swap).

*Billing* (super-admin):
22. **Subscription** (`?section=subscription`) — the studio's own Tahi plan: row/price from settings K/V, seat count from real team members, an external Stripe dashboard link (the studio's own subscription is not itself billed through this system's Stripe integration).
23. **Client plans** (`?section=plans`) — the retainer catalogue (`plan_catalog` K/V) that `/settings` (client side, Plan & billing) and `/services` both render from. List, edit dialog.
24. **Reserves** (`?section=reserves`) — cash reserve pots (category, accrual rate, accrued balance) that ringfence money for `/financial-reports`' disposable-cash math. List, "new pot" opens straight into an edit dialog, remove is a soft-deactivate.

*Advanced* (mixed):
25. **Audit log** (`?section=audit`, admin) — the immutable action log. Toolbar (search pill, action-prefix select), a table (When/Who/Action/Target), a count footer. Read-only, no sub-dialog.
26. **Danger zone** (`?section=danger`, super-admin) — two actions: **Export all data** (real, downloads a JSON archive from `POST /api/admin/danger/export`, warns via toast if any table hit the server's row cap) and **Delete workspace** (a type-DELETE-to-confirm dialog that honestly records the request rather than deleting anything — there is deliberately no destructive endpoint behind it yet).

**`/settings/audit`, `/settings/automations`, `/settings/crons`** — three legacy URL shims, each a server component that re-runs the same admin/feature gate as the main page and then redirects to the matching `?section=` deep link. No UI of their own; nothing to design.

**`/permissions`** — a separate route outside this document's group, but worth naming because it mounts the exact same `TeamAccessPane` as section 21 above. A design pass on Team & access is a design pass on `/permissions` too, and the two must never be allowed to visually diverge since they are the same component.

## 3. States and variants

- **Loading, most sections.** A `useResource` hook against the section's own endpoint; while `isLoading`, the section renders a skeleton shaped like its own form (see Studio details: 13 boxes in field order, one shortened height for the invoice-footer textarea) rather than a generic spinner, so the card never jumps size on load.
- **Loading, Studio details specifically.** Two fetches gate the form (`/api/admin/settings` and `/api/admin/team` for the project-manager select); the skeleton covers the settings fetch only, the team select degrades to an empty option list until its own fetch lands (no separate skeleton state for it).
- **Empty, list-style sections (Webhooks, Automations, Request forms, Kanban columns, Task templates, Reserves, Pipeline stages).** Each uses the shared `EmptyRow` primitive: a single faint-text row inside the list card, not the canonical leaf-icon-title-description-CTA empty state CLAUDE.md specifies for the rest of the app — flag this as a design gap (see section 6).
- **Empty, Audit log.** No rows for the current filter: the table renders with the count footer reading "0 actions", no dedicated empty illustration.
- **Empty, Notifications section.** No stored preference row for an event/channel pair reads as the hard-coded `DEFAULT_ENABLED` fallback (on), never as a blank or unknown chip — a deliberate "show what will actually happen" choice, not a bug.
- **Error, any save.** Studio details is the reference pattern: a failed `PATCH` (malformed bank JSON, a non-numeric Xero account code, a rejected email-delivery write) surfaces the server's own validator sentence in a `role="alert"` line next to the Save button, never a generic "Failed to save" — the same pure validators run client-side before the batch of PATCHes fires, so a 400 can only come from a real server disagreement, and if any of the twelve keys in that batch rejects, the promise-all setup means the others may have already written even though the error line only reports the one that failed (worth a design and product decision, not just a bug — see section 7).
- **Error, list-style sections.** A toast (`useToasts`/`Toasts`), not an inline banner.
- **Read-only, Client view of `/settings`.** Not applicable to this document's sections — a Tahi admin previewing Client view never sees the studio branch at all; `page.tsx` computes `studio = isAdmin && !isPreviewingClient`, so impersonation always renders the client IA regardless of who the previewer is.
- **Member seat vs admin seat (studio side).** A non-super-admin teammate sees 15 of the 21 admin sections (the ten `superAdminOnly` sections drop from the sub-nav, per section 1); within Team & access and Integrations, a further feature-gate can drop those two even for an `isAdmin` caller if `resolvePermissions` resolves the key to `false`. There is no distinct "you can't see this" message anywhere in the flow — the section is simply absent from the rail and the picker, consistent with the product's "absent = denied" rule.
- **Member seat vs admin seat (client side, out of scope detail).** Noted only because the same registry drives it: a client member (not a workspace admin) loses the People tab from their sub-nav (`clientAdminOnly`). Full detail in `client-account-notifications.md`.
- **375px.** Desktop rail disappears entirely (`hidden md:flex`); the mobile section picker (native `<select>` behind a styled pill, 48px min-height) becomes the only navigation. Every section's own form/list/dialog must independently pass the 44px-touch-target and no-horizontal-scroll bar; this has not been verified section-by-section (STATUS.md records the whole surface as "verified locally + promoted," not itemised per section).
- **768px.** The rail switches on at exactly `md` (48rem); nothing named in code narrows further between 768px and the rail's own comfortable width, so this is the boundary most likely to show a cramped rail label if the design review checks only one width.
- **Dark mode.** All section styling reads CSS custom properties (`var(--bg)`, `var(--border)`, `var(--text)` etc, see `settings.css`); STATUS.md does not list a dark-mode-specific known bug for this surface, but also does not record a dark-mode live check, so treat it as unverified rather than trusted.
- **Print/public.** Not applicable anywhere in this group.
- **Super-admin-only sections, cosmetic vs enforced.** Every `superAdminOnly` section's own API route independently re-checks (mostly `resolvePermissions().isSuperAdmin`), so a non-super-admin who somehow deep-links past the hidden nav item (a stale bookmark from before their access was downgraded, for instance) gets a real 403 from the section's own fetch, not just a missing nav entry. Worth confirming this holds for all ten during review, not assuming it from the pattern.

## 4. Features and actions

### Studio details (`studio`) and Getting paid

**Works today:** legal name/GST/address/currency/invoice-prefix/default-channel/footer-note, all batch-saved to the settings K/V store; the five-currency "Getting paid" tab strip (NZD/GBP/USD/AUD/EUR, each with the field shape that currency's bank actually uses) plus a legacy default-account fallback, both driving the client-facing "How to pay" block on every invoice surface and the invoice emails; Xero payment account code and Xero email mode (dashboard/Xero/both); "Project manager shown to every client" override (`LW.3`, ships as a team-member select, empty = per-client assignment, read by the onboarding lead card, kickoff host and portal team card).
**Exists but wrong or half-built:** the reviewer-noted nit that the client "How to pay" card still renders its own heading even when the resolved account has no bank fields at all (the emails already hide themselves in that case; the card doesn't) — small, named in TASKS.md under the bank-details entry, not yet fixed.
**Planned or missing:** Xero category overrides (T667, needs the S25 schema batch, not yet built at all — there is no UI surface for this today, not even a stub).

### Getting paid — LW.8 cross-reference

**Works today:** the account entry flow itself (see above).
**Exists but wrong or half-built:** none specific to this pane; the LW.8/LW.8b item that lives here in spirit ("the call went through, wasn't booked" because the Google grant lacked `calendar.events`/`calendar.freebusy`) is fixed in code (03406711) and needs Liam to reconnect Google from the **Integrations** section and re-verify, not a Studio details change.

### Email delivery (both its own section and the Studio details foot-card)

**Works today:** mode switch (allowlist/all) behind a `<ConfirmDialog>` only when widening; allowed domains/addresses as validated comma lists; a never-list checked ahead of everything, even "Everyone" mode; allowed-org-ids per-client exemption; a 100-row suppression log with a Clear button behind its own confirm. MC.0 shipped this live 2026-09-07: every Resend caller, Clerk org invitations and Stripe customer creation all route through the one gate ahead of the external call.
**Exists but wrong or half-built:** none named against this section specifically; it is the reference implementation the rest of the permission-gate work is compared to.
**Planned or missing:** the allowlist stays closed for Giant Group per Liam's 2026-09-12 decision (MC.4) — a product state to design around (an "allowlist closed" banner exists; whether a design review needs to see it live for a real pending client is worth asking, see section 7).

### Modules

**Works today:** three-scope on/off (workspace K/V, role and client via `feature_visibility` overrides), super admins always bypass so they can always re-enable a module they turned off for themselves.
**Exists but wrong or half-built:** none named in TASKS.md against this section specifically.
**Planned or missing:** none named.

### Announcements

**Works today:** compose (title, body, emoji, tone, CTA label+link, audience, expiry, active), live `.ann-bar` preview, publish/unpublish, delete, optional email fan-out on send.
**Exists but wrong or half-built:** the fan-out itself has never been smoke-tested live (W-QA, shared with the `/announcements` studio page which is the broader builder this settings section's simpler compose flow complements).
**Planned or missing:** none section-specific beyond the shared W-QA live-smoke debt.

### Request forms

**Works today:** global-default and per-client-override intake forms, copy-on-write (editing a global form while in per-client mode clones it rather than mutating the global set), six question types (text/textarea/url/select/multiselect/checkbox/file), full CRUD.
**Exists but wrong or half-built:** none named in TASKS.md; this is one of the more complete Intake & boards sections.
**Planned or missing:** none named.

### Kanban columns

**Works today:** global-default and per-client-override board columns, copy-on-write, real HTML5 drag-and-drop reorder that persists on drop, "seed defaults" and "clone for this client" actions, full CRUD.
**Exists but wrong or half-built:** the cross-cutting **STATUS P3** bug (a card in the same column as the one being dragged still lights as a drop target inside the shared `KanbanBoard`) affects the Requests and Tasks boards that consume these columns, not the settings editor itself, which uses its own drag implementation.
**Planned or missing:** none named against the editor itself.

### Task templates

**Works today:** global-default and per-client-override templates, copy-on-write, full CRUD (type, priority, description, checklist-to-subtasks, estimate, default assignee). Consumed live by `/tasks`.
**Exists but wrong or half-built:** none named.
**Planned or missing:** none named.

### Pipeline defaults, Pipeline stages, Lead automations

**Works today:** default deal owner (`project_default_deal_owner` memory: auto-assigned to Liam, settings-overridable) and other pipeline defaults; the deal stage list with add/edit/reorder/delete; lead-scoring and enrichment toggles.
**Exists but wrong or half-built:** none named against these three sections specifically in TASKS.md; the deal-stage and lead-automation *consumers* (`/deals`, the lead AI cron) carry their own open items (deal nudge engine, T3.8) that are out of this document's scope.
**Planned or missing:** none named against the settings surfaces themselves.

### Integrations

**Works today:** real status reads for Stripe/Slack/MailerLite/Xero (env-var truth) and Google Workspace (OAuth truth, real connect/reconnect flow); HubSpot shown as always-available (built in, no separate connect step).
**Exists but wrong or half-built:** T1.11 — the worker MCP's own `/authorize` endpoint auto-approves on `client_id` alone (a hardening item, approved by Liam, pending a deploy and a one-time reconnect); not a UI bug on this page, but the "Google reconnect" action pattern this section already offers is the template for how that reconnect should surface once built. LW.8b is the near-term real action here: reconnect Google after the calendar-scope fix and re-verify.
**Planned or missing:** Slack notifications are wired nowhere (`lib/slack-notify.ts` has zero call sites despite a built dispatcher) — this section shows Slack's status but nothing downstream fires yet; a design review should not assume the status chip implies working notifications.

### Webhooks

**Works today:** full CRUD over outbound endpoints, real signed delivery via `lib/webhooks.ts` triggered by `emitDomainEvent` from request/invoice/client routes.
**Exists but wrong or half-built:** none named against the settings editor.
**Planned or missing:** the Zapier-branded *config surface* for outgoing webhooks (T570) is separate from this generic webhooks list — the automation *engine* shipped in Wave 2 but there is no Zapier-specific onboarding/config UI yet. Whether Zapier config lives inside this same section or gets its own is an open product question (see section 7).

### Automations

**Works today:** full CRUD over trigger-to-action rules, on/off switch, live execution count, real execution via `lib/automation-executor`, time-based triggers swept by the Scheduled jobs cron or its manual "Run now".
**Exists but wrong or half-built:** the automation *engine's* live smoke (firing, delivery, fan-out) is still owed (W-QA) — a data-honesty question for the execution-count number this section displays, not a UI bug.
**Planned or missing:** none section-specific.

### Scheduled jobs

**Works today:** every registered cron listed with schedule, last-run relative time, status chip, and a working "Run now" per row.
**Exists but wrong or half-built:** T1.13 — verify whether the GitHub Actions cron trigger path (stale `TAHI_DASHBOARD_URL`, header auth mismatch) is actually broken; `sync-airwallex` is known to have fired fine, which contradicts a fully-broken path, so this needs a verify-then-fix pass, not a rebuild. Not a UI issue: the "Run now" button on this page is the honest workaround regardless of the GitHub Actions state.
**Planned or missing:** the weekly-digest cron (T698-699) does not exist yet, so there is nothing here to run it manually until it is built.

### AI context

**Works today:** the six grounding-slot card grid, doc picker over the real Docs Hub list, persists the doc-id mapping.
**Exists but wrong or half-built:** none named.
**Planned or missing:** none named.

### Team & access

**Works today:** the full `TeamAccessPane` (see section 2, item 21) — role assignment, data scope (all/by-plan/specific-clients), per-feature overrides via the slide-over, copy-access, change history, preview-as. This is one of the most built-out sections in the whole group.
**Exists but wrong or half-built:** T1.6 (client `feature_visibility` denies are nav-cosmetic only, not enforced with a 403 at the route level — the memory `project_permissions_vision.md` "visible = permitted, absent = denied" rule is not fully true yet); T1.18 (nav gating: `filterNav` never reads `item.adminOnly` on 20 nav items, and `FEATURE_RESOURCE` has no mapping for `billing`/`capacity`/`content_studio`/`social`/`reviews`/`announcements`, and `/affiliates` has no `FEATURE_TREE` node at all — so a task_handler can currently SEE and OPEN six pages this section's own model says they shouldn't).
**Planned or missing:** T1.15 (deny-by-default flip: an unset `teamMemberAccess` row currently means unrestricted, not denied — actively "in progress" per TASKS.md as of 2026-08-18) and T1.16 (per-org scoping rollout: only 30 of 362 admin route files call a scoping helper today, also "in progress").

### Subscription, Client plans, Reserves

**Works today:** Subscription shows the studio's own honest plan state (K/V-backed, "Not set" rather than fabricated, real seat count, external Stripe link); Client plans edits the shared retainer catalogue every client-facing plan surface reads from; Reserves runs the full pot lifecycle (create, edit, soft-deactivate) feeding the cron that keeps `/financial-reports`' disposable-cash math honest.
**Exists but wrong or half-built:** none named against these three sections specifically.
**Planned or missing:** the broader "Retainer & billing model" post-launch block (T668-676: customMrr/billingModel editors, retainer health filter, MRR forecast end-date awareness, auto-churn, salary/rate fields) needs the S25 schema batch and is explicitly deferred past cutover; none of it is UI that exists today to review.

### Audit log

**Works today:** server-side action-prefix filtering (`permission.*`, `subscription.*`, `contract*`, matching the prefixes the app actually writes), client-side debounced text filter over the loaded page, resolved actor/entity names.
**Exists but wrong or half-built:** none named.
**Planned or missing:** none named; this is a read-only surface with no backlog debt recorded against it.

### Danger zone

**Works today:** Export all data is real (downloads a genuine JSON archive, honestly flags a row-cap truncation instead of pretending completeness).
**Exists but wrong or half-built:** none — Delete workspace is *deliberately* not real yet, and says so in its own dialog copy ("Automated deletion is not switched on yet... nothing is removed until the Tahi team completes it manually"). This is an honest placeholder, not a lying button, and should be reviewed as such rather than flagged as a bug.
**Planned or missing:** an actual destructive delete endpoint, if ever built, is explicitly out of scope until a product decision says otherwise. Note for the reviewer: a *different* danger zone (on the client detail page, org-level hard delete) already exists and was used live for Acme Corp (MC.9) — do not conflate the two when reviewing; this document's Danger zone is the workspace-wide one only.

### Booking link, Profile, Appearance, Notifications (studio reading)

**Works today:** identical component and API behaviour to the client reading documented in `client-account-notifications.md`, mounted here for the studio audience (`isAdmin: true`) instead. Booking link is admin-only and has no client equivalent.
**Exists but wrong or half-built / Planned or missing:** see `client-account-notifications.md`; nothing studio-specific was found beyond what that document already records for the shared components.

## 5. Data and integrations

- **Settings K/V store** (`app/api/admin/settings/route.ts`, `GET`/`PATCH`, one key per call or a batch of parallel PATCHes) backs Studio details, Getting paid, Email delivery, Pipeline defaults, Lead automations, Subscription, Client plans and the module workspace-scope toggles. Every validated key (bank details, bank-details-by-currency, Xero account code, Xero email mode, email-delivery keys, studio project manager) is checked with the *same pure validator* client-side before save and server-side on write, so the two cannot disagree — a reviewer should treat a 400 here as a genuine data problem, not a UI bug.
- **Dedicated CRUD APIs**: `/api/admin/forms` (Request forms), `/api/admin/kanban-columns` (Kanban columns), `/api/admin/task-templates` (Task templates), `/api/admin/pipeline/stages` (Pipeline stages), `/api/admin/webhooks` (Webhooks), `/api/admin/automations` (Automations), `/api/admin/crons` (Scheduled jobs), `/api/admin/reserves` (Reserves), `/api/admin/announcements` + `/[id]` + `/[id]/send` (Announcements), `/api/admin/audit?resolveNames=1` (Audit log), `/api/admin/danger/export` (Danger zone export), `/api/admin/docs` (AI context's doc picker), `/api/admin/profile` (Profile), `/api/admin/notifications` (Notifications), `/api/admin/team` (Studio details' project-manager select, plus Team & access).
- **Third parties**: Stripe (status only, on this page — the real billing flows live on `/billing`), Slack (status only, `lib/slack-notify.ts` has no live call sites despite the dispatcher existing — see section 4), MailerLite (status only), Xero (OAuth status plus the payment-account-code and email-mode settings that steer real Xero-rail invoices), Google Workspace (real OAuth connect/reconnect, gates the calendar write scope LW.8 fixed), HubSpot (status only, built in), Resend (every send in the system routes through the Email delivery allowlist before reaching Resend).
- **Honesty constraints already enforced**: Danger zone's export names its own row cap rather than silently truncating; Danger zone's delete says outright that nothing is removed automatically; Subscription renders "Not set" instead of a fabricated plan; Studio details surfaces a failed save with the validator's real sentence instead of swallowing it (rule: no dead buttons, no fake numbers, per CLAUDE.md rule 8's live-smoke bar).
- **Honesty gaps still open**: Zapier's config surface does not exist even though the trigger engine does (T570) — nothing on this page should claim a working Zapier connection yet; Xero category overrides (T667) has no UI at all, not even a disabled placeholder.

## 6. Design system contract

- **This surface is intentionally NOT on the shared band/rail primitives** that Requests and Tasks use (`PageHeader`, `RailLayout`, `DataTable`, the shared `SlideOver`). It has its own self-contained primitive layer (`components/tahi/settings/primitives.tsx`: `SectionShell`, `Toggle`, `Seg`/`SlideSeg`, `EditDialog`, `EmptyRow`, `Chip`, `AvatarUpload`, `SlideOverShell`, `TaSelect`, `PerClientHeader`, `Toasts`) and its own CSS file (`app/(dashboard)/settings/settings.css`), documented in that file's own header comment as deliberately supplementary to `globals.css`: "the design's leaf radius is `--radius-leaf-shell` (0 .625rem) — globals' `--radius-leaf` is the [app-wide default]." This is a real, named divergence from the one-radius-system rule elsewhere in CLAUDE.md and should be treated as an accepted exception for this surface, not an error to flatten, unless the design review decides otherwise.
- **Leaf radius usage is present and correct where it appears**: `.set-navitem.on` (the active sub-nav pill), `.lrow-ic.leaf` (list-row leaf icon backgrounds), `.btn1` (primary Save buttons) all use `var(--radius-leaf-shell)` or an equivalent literal `0 .625rem 0 .625rem`, matching CLAUDE.md's "icon backgrounds, avatar wrappers, primary CTA buttons" guidance.
- **Tokens are used correctly**: every colour reference in `settings.css` is a `var(--color-*)`/`var(--bg)`/`var(--text)`/`var(--border)` custom property, not a hardcoded hex, so dark mode should work by construction (still unverified live, see section 3).
- **What the design file gets right**: `settings-app.jsx`'s `SETTINGS`/`CLIENT_SETTINGS` arrays are structurally identical to the live `SECTIONS` registry — same eight admin group labels in the same order, same three client groups, same section ids and icon choices. This is the rare case in this codebase where the port and the design have not drifted; a critic re-check should mostly be confirming pixel and interaction fidelity, not re-deriving the information architecture.
- **What the design must change or a reviewer must decide**: (1) the list-style empty states (Webhooks, Automations, Request forms, Kanban columns, Task templates, Reserves, Pipeline stages) use the bare `EmptyRow` text-only primitive instead of the canonical leaf-icon-title-description-CTA `EmptyState` pattern CLAUDE.md specifies for every other list view in the app — either bring these in line or record the divergence as an accepted exception the way the leaf-radius one already is; (2) the Studio details all-or-nothing save (twelve parallel PATCHes, one error line) is a genuine interaction design question, not just a polish item — see section 7; (3) no critic verdict (SHIP/FIX/REDO) exists on record for this surface at all, unlike almost everything else in the checklist, so this review is the first one and should produce that verdict rather than assume a pass.

## 7. Open questions for Liam

1. Should the Studio details / Getting paid save stay one all-or-nothing button across twelve keys, or split into independently-saved groups (studio identity, getting paid, project manager) so a rejected Xero account code cannot leave the address and currency fields showing "saved" while a validated field silently didn't write? (A or B: keep one combined save, or split into per-group saves.)
2. Does the Zapier outgoing-webhook config surface (T570) belong inside the existing **Webhooks** section as a "Zapier" event-set preset, or as its own new sub-nav item? (A or B.)
3. Should the seven `EmptyRow` list sections (Webhooks, Automations, Request forms, Kanban columns, Task templates, Reserves, Pipeline stages) be upgraded to the standard leaf-icon empty state, or is the plain text row an accepted, permanent exception for dense admin lists like this? (Yes upgrade, or no keep as is.)
4. Is the email-allowlist "Everyone" mode confirm-dialog wording still accurate now that Giant Group's own org-id exemption exists (MC.4 says the allowlist stays closed for now) — should the dialog name the currently-exempted org ids explicitly, or keep the generic warning? (Yes name them, or no keep generic.)
5. Danger zone's Delete workspace records an honest "noted, the team will follow up" message today. When a real destructive endpoint eventually exists, should it stay a manual, Tahi-team-completed process, or become fully self-service behind the same type-DELETE confirm? (A manual forever, or B eventually self-service.)

## 8. Acceptance for the design review

1. At 1440 light and dark, the left rail renders all eight group labels in registry order with no truncated section labels, and the active section's icon in the rail matches the icon rendered beside the section title in the pane.
2. At 375 light and dark, the desktop rail is fully gone (not just collapsed) and the mobile section picker is the only navigation, at least 44px tall, with every `<optgroup>` label matching a rail group label exactly.
3. Studio details' five-currency tab strip is legible and each tab's "Entered" / "Still empty" summary line is visible without scrolling at both 1440 and 375.
4. Every list-style section (Webhooks, Automations, Request forms, Kanban columns, Task templates, Reserves, Pipeline stages, Audit log) shows a real empty state when its list is empty (a leaf icon and copy, or the accepted `EmptyRow` text row per the open question above) and never a blank card.
5. The Email delivery "Everyone" mode switch cannot be completed without the `<ConfirmDialog>` appearing first, in both light and dark, and the dialog text names the real consequence rather than a generic warning.
6. Danger zone's Delete workspace dialog requires the literal text `DELETE` (case-insensitive) before the confirm button enables, and the button reads "Request deletion," not "Delete," anywhere the label is visible.
7. A non-super-admin teammate's screenshot of the rail shows exactly 15 of the 21 admin sections (the ten `superAdminOnly` sections absent), with no partial or greyed-out entries standing in for the hidden ones.
8. Team & access's three tabs (Team members / Clients / Roles) and the feature-override slide-over all carry the same leaf-radius and token language as the rest of the pane — no visual seam between the wrapper section and the deep pane it mounts.
9. Every input, select and textarea across the reviewed sections shows a visible focus ring and a distinct hover state at both 1440 and 375, per CLAUDE.md's interactive-element rule.
10. No screenshot from this review contains an em dash or en dash anywhere in rendered copy (labels, help text, empty-state text, dialog copy).
