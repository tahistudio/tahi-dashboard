# Settings - design brief (the control room)

> The single home for all configuration. Today it is a ~4,343-line flat list of
> ~20 sections with no information architecture, and Permissions lives separately
> as a top-level page. This spec gives Settings real IA, folds Permissions in
> fully (no top-level nav item), and makes Settings the canonical home for the
> builders that 06-08 consume (request forms, kanban columns, task templates,
> permissions).

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.
> The app shell (04-app-shell.md) is built and live: always-dark forest rail,
> hairline top bar with breadcrumb, Cmd/Ctrl-K palette, mobile bottom tabs, cream
> canvas. This brief designs ONLY the canvas content of `/settings/*` plus its
> page-owned overlays (save bar, slide-overs, confirm dialogs). Never re-spec the shell.

## What exists today (as built)

Verified against the code on 2026-07-04.

- `app/(dashboard)/settings/page.tsx` (server, `getServerAuth` + `isAdmin = orgId === NEXT_PUBLIC_TAHI_ORG_ID`) renders `settings-content.tsx`, a **4,343-line monolith** (previously quoted at ~4,817; it has since slimmed slightly) rendering ~20 sections in one flat vertical scroll, gated inline by `isAdmin`. In as-built render order:
  - `ProfileSection` (client only): Name, Email (disabled, "Email is managed through your login provider."), Role / Title, "Save Profile" button, "Profile updated" confirmation. Reads and PATCHes `/api/portal/profile`.
  - **Appearance** (everyone, inline): a single "Dark Mode" switch writing `tahi-theme` to `localStorage` and toggling `.dark` on `<html>`.
  - **Integrations** (admin, inline): a 2-column card grid from the `INTEGRATIONS` const: Stripe, Xero, Slack, HubSpot (rendered `disabled` with a "Built-in" badge, "CRM is built-in, no external integration needed"), MailerLite. Status chip "Connected" / "Not Connected" from `/api/admin/integrations/status` merged with `integration.<key>.status` settings keys. Icon tiles already use `--radius-leaf-sm`.
  - **Notifications** (everyone; Slack row admin only): "Email Notifications" + "Slack Notifications" switches writing `notifications.email` / `notifications.slack` via the admin key/value endpoint.
  - `ReservesSection` (admin): cash reserve pots (name, category tax/buffer/deposits/other, currency NZD/USD/GBP/EUR/AUD, target, accrued, accrual rate, notes, active) via `/api/admin/reserves` (+`/[id]`), soft delete, drives the disposable-cash math on `/financial-reports`. Empty copy: "No reserves configured. Tahi recommends at minimum a tax pot (28% accrual rate, NZD)."
  - `BrandingSection` (admin, "Portal Branding"): Portal Name (`portal_name`), Primary Color (`portal_primary_color`, preset swatches + custom picker + live preview), logo + favicon URLs (`portal_logo_url`, `favicon_light_url`, `favicon_dark_url`).
  - `ModulesSection` (admin): five switches (Requests, Messaging, Billing, Time Tracking, Reports) writing `module_<key>_enabled`; "Disabled modules will be hidden from the sidebar navigation."
  - `FormsSection` + `FormEditor` (admin, "Request Forms"): form templates with `name`, `category` (All (global) / Design / Development / Content / Strategy / Admin / Bug), `questions` JSON. Question types: Short Text, Long Text, URL, Dropdown, Multi-Select, Checkbox, File Upload (`text | textarea | url | select | multiselect | checkbox | file`). API `/api/admin/forms` (+`/[id]`).
  - `WebhooksSection` (admin): endpoints with URL, secret (entered in a plain field today), and event checkboxes (`request.created`, `request.updated`, `request.completed`, `client.created`, `invoice.created`, `invoice.paid`, `message.sent`). API `/api/admin/webhooks`.
  - `KanbanColumnsSection` (admin): a Global / Per-client mode toggle, client picker with search, columns (`label`, `statusValue`, `colour`, `position`) with up/down reorder, add/edit/delete; shows a "global fallback" hint when a client has no overrides. API `/api/admin/kanban-columns` (+`/[id]`).
  - `TaskTemplatesSection` (admin): templates with `name`, `type` (Client External / Internal Client / Tahi Internal), `category`, `defaultPriority` (None / Low / Medium / High / Urgent), `description`. API `/api/admin/task-templates`.
  - `PipelineDefaultsSection` (admin): default deal owner + nudge signature settings keys.
  - `PipelineStagesSection` (admin): pipeline stage CRUD.
  - `LeadAutomationsSection` (admin, "Lead AI & Automations"): lead scoring / enrichment automation settings.
  - `ScheduledJobsLinkSection` (admin): a link card to `/settings/crons` listing the seven crons in prose.
  - `AiContextDocsSection` (admin, "AI context docs"): six Docs-Hub doc slots wired into AI prompts (`ai.icpDocId` Ideal Client Profile, `ai.brandDnaDocId` Brand DNA, `ai.toneDocId` Tone of Voice, `ai.liamVoiceDocId` Liam Personal Voice, `ai.aiTellsDocId` AI Writing Tells, `ai.servicesDocId` Services + Pricing).
  - `GoogleIntegrationSection` (admin, "Google Workspace"): Calendar + Drive connection.
  - `BufferIntegrationSection` (admin, "Buffer (personal social)").
  - `AiCostSection` (admin, "AI cost"): spend dashboard.
  - `ContentEngineSignalsSection` (admin, "Content engine signals").
  - `BookingLinkSection` (admin, "Call Scheduling"): Google Calendar Booking URL (`booking.google_cal_url`).
  - **Team** (admin, inline): a link card to `/team` ("Go to Team Management").
  - **Billing** (admin, inline): a stub card ("Manage your Stripe subscription and billing settings.").
  - **Account** (admin, inline): a static org card ("Tahi Studio / Organisation workspace").
- **Save model as built:** `saveSetting(key, value)` PATCHes `/api/admin/settings` per key with a `savingKey` spinner and a "Setting saved" toast; several sections add their own per-field "Save" buttons; switches persist instantly. Three patterns coexist.
- **Sub-routes:** `/settings/audit` (audit-log viewer: filters Action (Created / Updated / Deleted / Login / Impersonated / Status Changed), Entity (Requests / Clients / Invoices / Tasks / Team Members / Conversations / Contracts / Automations), date from/to, paginated, via `/api/admin/audit`), `/settings/automations` (automation rules: trigger (Request Created / Request Status Changed / Request Overdue / Invoice Overdue / Client Inactive / Client Onboarded), conditions, actions (Assign Request / Change Status / Send Notification / Send Email / Post to Slack / Create Internal Task), enable toggle, execution count, last run), `/settings/crons` (each cron: label, schedule, last-run relative time, status chip Success / Error / Skipped, summary, "Run now" button, last-10-runs disclosure, via `/api/admin/crons`).
- **Gating today:** inline `isAdmin` ternaries only. `lib/feature-tree.ts` already has `settings`, `settings.integrations`, and `settings.permissions` keys but the page does not consume them.
- **Permissions** is a separate top-level page (`/permissions`, `requiresManage`) - see 05-permissions.md. **Decision: it moves fully into Settings here; the top-level nav item is removed.**
- **Confirmed audit findings (new in this pass):**
  - The client-visible "Email Notifications" switch calls `saveSetting`, which PATCHes the admin-gated `/api/admin/settings`; a client toggling it receives a silent 403 and an error toast, and the key is workspace-global, not per-user. Notification preferences need a per-user portal endpoint.
  - `ModulesSection` (`module_*_enabled` settings keys, consumed by the sidebar) and the permissions engine (`FEATURE_TREE` + `featureVisibility`, spec 05) are two parallel gating systems for the same question. They must be reconciled (see Open decisions).
  - Secrets: the webhook secret is typed into a plain visible input; integration keys otherwise correctly live in the Worker env and are never rendered.

So: everything works, but there is no IA, the page is unmaintainably long, three save patterns coexist, and configuration is split across a flat settings scroll plus a standalone permissions page.

## Page purpose

One calm, well-organized place to configure everything: your account, the studio's identity, the builders that shape requests and tasks, sales defaults, integrations and automations, billing, team access, and the audit trail. Find any setting in two interactions (group, then section) or zero (search / Cmd-K); never scroll a wall.

## Why we are on this page

Settings is where the studio is actually shaped: the intake forms a client fills (07), the board columns they see (07), the task templates the team runs (08), the permissions that gate every surface (05), and the integrations that move money and data. Giving it IA makes all of that discoverable and turns "a giant scroll" into the studio's control room. It is also where the three audiences differ most sharply: a client sees only a tidy account screen; a teammate sees their account plus whatever their role grants; the owner sees the whole instrument panel. A settings page is where software quietly tells you whether it respects you, and this one must say "designed", not "bolted on".

**The single experiential throughline, which every element must serve or be cut:**

> Every lever in the studio has exactly one home, and you can put your hand on it in two moves.

## Personas and jobs-to-be-done

**1. The client (client: a contact at a client org).**
- *Mindset:* rarely here; came to fix one thing (their name, the theme, an email preference) and leave.
- *JTBD:* "Update my profile and notifications without wandering into someone's admin panel."
- *Must see:* Profile, Appearance, Notifications, and nothing else. No group headers for things they cannot open, no "admin" vocabulary anywhere.
- *Must feel:* this is my account screen, purpose-built. Tidy, obvious, done in under a minute.

**2. The teammate (team_member).**
- *Mindset:* occasionally sent here by a task ("add a task template", "check the intake form"); wants the one section, not the tour.
- *JTBD:* "My account, plus exactly the sections my role lets me configure, and a fast path to the one I need."
- *Must see:* Account always; then only granted groups, each reading as complete. Empty groups absent, never disabled.
- *Must feel:* trusted with what is theirs, unaware of what is not.

**3. The owner (super_admin: Liam / Staci).**
- *Mindset:* configures in bursts - onboarding a client (forms, columns), wiring an integration, tuning the pipeline, auditing an action. Needs recall, not memorisation.
- *JTBD:* "Configure the whole studio, find any lever in two moves, and trust that every change saved and was logged."
- *Must see:* all eight groups, search across everything, save feedback that cannot be missed, the audit trail, the danger zone behind glass.
- *Must feel:* in command of a control room, not lost in a corridor of switches.

**The tension to resolve:** the owner needs a large, complete map; the client needs a three-row account card; the teammate needs a subset that never reads as subtracted. **The call:** one settings frame, server-shaped per audience (deny by default, spec 05): the index renders only the groups the person can open, the sub-nav renders only their sections, and the client's version drops the sub-nav entirely because three sections do not need a map.

## What others do (and what we take)

- **Stripe / Linear / Notion / GitHub settings** - a **left settings sub-nav** (grouped sections) with a content pane on the right; URL-addressable sections (`/settings/<section>`), search across settings, and a clear split between "your account" and "the workspace". We adopt the left-rail + pane, addressable sections, and the personal / studio split as the first fold.
- **Vanta / Stytch** - Team & access (members, roles, permissions) as one coherent area rather than scattered. We fold Permissions + Team + Roles together into one group.
- **Linear** - instant-persist for atomic controls with quiet confirmation; no giant "Save" at the foot of a page of toggles. We adopt the split save rule below.
- **Stripe** - destructive and rarely-needed actions quarantined at the bottom of the IA, never inline with daily settings. We adopt the Advanced group.
- **Timeless ideas** - group by intent not by feature; the most-used settings shallow and findable; every change saves with clear feedback; settings are searchable; secrets never render.

## Experience principles (on top of Studio Ledger)

1. **Group by intent, not by feature.** A person thinks "I want to change intake", not "I want the FormsSection"; every section lives under the question it answers, so recall beats memorisation.
2. **Personal vs studio is the first split.** Account is yours and comes first; everything below it belongs to the studio, so a client's view is simply the top of the map, not a filtered admin panel.
3. **The builders live here, the surfaces consume them.** Settings owns request forms, kanban columns, task templates, and permissions; 06-08 render what these produce, so there is never a second editor to drift out of sync.
4. **Shallow and searchable.** Two interactions to any setting (group, section) and zero via search or Cmd-K; nothing nests a third level, so nothing needs a breadcrumb trail to escape.
5. **Save is obvious and safe.** Atomic controls persist instantly with a whisper; text sections batch behind a dirty-state save bar; the person always knows whether their change is real.
6. **Audience-shaped, server-gated.** A section a person cannot use is absent, never disabled (05 deny-by-default); the server is the gate and the UI never renders a locked door.
7. **Danger behind glass.** Destructive actions live only in Advanced, tinted only there, and always cost a deliberate typed confirmation; nothing on any other section can destroy data.

## Information architecture (all routes, all audiences)

The settings landing is `/settings`. Every section is URL-addressable at `/settings/<group>/<section>`. Audience tags: **all** (client + team + owner), **team** (any team member with the grant), **owner** (super_admin / admin), **manage** (requires the manage-permissions grant per 05). Empty groups vanish per audience.

| Route | Section | Audience | As built today (source) |
|---|---|---|---|
| `/settings` | Settings index | all | new (replaces the flat scroll) |
| `/settings/account/profile` | Profile | all | `ProfileSection` (client); team identity is Clerk-managed, shown read-only |
| `/settings/account/appearance` | Appearance | all | inline Appearance section (dark-mode switch, `tahi-theme`) |
| `/settings/account/notifications` | Notifications | all | inline Notifications section (email / Slack switches; see finding on per-user keys) |
| `/settings/account/booking` | Booking link | owner | `BookingLinkSection` ("Call Scheduling", `booking.google_cal_url`) |
| `/settings/workspace/branding` | Branding | owner | `BrandingSection` ("Portal Branding") |
| `/settings/workspace/modules` | Modules | owner | `ModulesSection` |
| `/settings/workspace/studio` | Studio details | owner | inline "Account" org card (Tahi Studio / Organisation workspace) |
| `/settings/intake/forms` | Request forms | owner, manage | `FormsSection` + `FormEditor` (deep editor specced in 07) |
| `/settings/intake/kanban` | Kanban columns | owner, manage | `KanbanColumnsSection` (deep editor specced in 07) |
| `/settings/intake/task-templates` | Task templates | owner, manage | `TaskTemplatesSection` (deep editor specced in 08) |
| `/settings/sales/defaults` | Pipeline defaults | owner | `PipelineDefaultsSection` |
| `/settings/sales/stages` | Pipeline stages | owner | `PipelineStagesSection` |
| `/settings/sales/lead-ai` | Lead AI and automations | owner | `LeadAutomationsSection` |
| `/settings/integrations/services` | Integrations | owner | `INTEGRATIONS` grid + `GoogleIntegrationSection` + `BufferIntegrationSection` |
| `/settings/integrations/webhooks` | Webhooks | owner | `WebhooksSection` |
| `/settings/integrations/automations` | Automations | owner | `/settings/automations` (folds in) |
| `/settings/integrations/crons` | Scheduled jobs | owner | `/settings/crons` (folds in; retires `ScheduledJobsLinkSection`) |
| `/settings/integrations/ai-cost` | AI cost | owner | `AiCostSection` |
| `/settings/integrations/ai-context` | AI context docs | owner | `AiContextDocsSection` |
| `/settings/integrations/content-signals` | Content engine signals | owner | `ContentEngineSignalsSection` |
| `/settings/team-access/members` | Team members | owner | roster + invite + role assignment (the `/team` link card retires; `/team` stays the operational view) |
| `/settings/team-access/roles` | Roles | owner | the 05 roles x features matrix |
| `/settings/team-access/permissions` | Permissions | owner, manage | the full 05 builder; `/permissions` redirects here |
| `/settings/billing/subscription` | Subscription | owner | inline Billing stub card (Stripe) |
| `/settings/billing/reserves` | Cash reserves | owner | `ReservesSection` |
| `/settings/advanced/audit` | Audit log | owner | `/settings/audit` (folds in) |
| `/settings/advanced/danger` | Danger zone | owner | new (quarantined destructive actions) |

**Redirects (all preserved, permanent):** `/permissions` -> `/settings/team-access/permissions`; `/settings/audit` -> `/settings/advanced/audit`; `/settings/automations` -> `/settings/integrations/automations`; `/settings/crons` -> `/settings/integrations/crons`.

**Group order (fixed, everywhere):** Account, Workspace, Intake & boards, Sales & pipeline, Automations & integrations, Team & access, Billing, Advanced.

## Anatomy

The named regions of the surface, top to bottom:

1. **Page title** - "Settings" as bare ink on the cream canvas (shell page frame; the breadcrumb in the top bar reads Settings / <Group> / <Section> on section routes).
2. **Settings landing index** (`/settings` only) - a search field, then the permitted groups as ledger-labelled row lists in a two-column arrangement. Not an auto-scroll of every section.
3. **Settings sub-nav** (section routes, desktop) - a 15rem left column listing the permitted groups as micro-labels with their section rows; the active section carries the rare leaf.
4. **Section pane** - the reusable section frame: section title as bare ink, one-line description, a hairline, then the section's controls in a single column (max 40rem for forms; data sections may run to 58rem).
5. **Save bar** (page-owned overlay) - appears pinned at the pane's foot only when a batched section is dirty.
6. **Builder slide-overs** (page-owned overlays) - the deep editors for forms / columns / templates / permissions open over the pane; internals owned by 07, 07, 08, and 05 respectively.
7. **Confirm dialogs** - discard-changes and danger-zone confirmations.
8. **Mobile drill** - at small widths the sub-nav disappears; `/settings` is the groups list, a section is a full-width pane with a back affordance.

## Layout and composition - desktop

Inside the shell (04): forest rail left, hairline top bar, cream canvas. The settings frame owns the canvas.

**Proportions:**
- Max settings content width: **60rem**, left-aligned within the canvas gutters (2rem min gutter each side).
- **Sub-nav: 15rem fixed**, sticky (top offset 1.5rem below the top bar), full height of the pane, no background slab (it sits bare on the cream; hairlines and spacing do the work). Gap between sub-nav and pane: **3rem**.
- **Pane: fills the remainder (~42rem at 60rem total)**. Form sections cap their control column at **40rem**. Data sections (Integrations grid, Audit log, Kanban columns, Pipeline stages, Automations, Scheduled jobs) may use the full pane width up to **58rem** (the frame widens; the sub-nav never moves).
- **Landing index:** search field (max 26rem) top-left, 2.5rem below the page title; groups in a **two-column grid** (column width ~28rem, column gap 3rem, row gap 2.5rem) in fixed order filling left-right then down: Account | Workspace, Intake & boards | Sales & pipeline, Automations & integrations | Team & access, Billing | Advanced. Below ~52rem canvas width the grid collapses to one column.

```
+--------------------------------------------------------------------------+
| RAIL | TOP BAR  Settings / Workspace / Branding      [search][bell][av]  |
| (04) +-------------------------------------------------------------------+
|      |  cream canvas                                                     |
|      |  Settings                          <- page title, bare ink        |
|      |                                                                   |
|      |  SUB-NAV (15rem)      |  Branding            <- section title     |
|      |  ACCOUNT              |  How the portal looks to your clients.    |
|      |   Profile             |  ------------------------------------     |
|      |   Appearance          |  PORTAL NAME         <- ledger label      |
|      |   Notifications       |  [ Tahi Studio            ]  (40rem max)  |
|      |   Booking link        |                                           |
|      |  WORKSPACE            |  PRIMARY COLOUR                           |
|      |  [Branding]  <- leaf  |  (o)(o)(o)(o)  [#5A824E]  Preview...      |
|      |   Modules             |                                           |
|      |   Studio details      |  LOGO URL                                 |
|      |  INTAKE & BOARDS      |  [ https://...            ]               |
|      |   Request forms       |                                           |
|      |   Kanban columns      |  +-------------------------------------+  |
|      |   Task templates      |  | Unsaved changes   [Discard][Save    |  |
|      |  ... (5 more groups)  |  |                            changes] |  |
|      |                       |  +-------------------------------------+  |
+--------------------------------------------------------------------------+
                                   ^ save bar, only when dirty
```

```
+--------------------------------------------------------------------------+
|  Settings                                     <- landing index /settings |
|  [ Search settings...        ]  (26rem)                                  |
|                                                                          |
|  ACCOUNT                            WORKSPACE                            |
|  Profile            Your name... >  Branding      Portal name, colour  > |
|  Appearance         Light or da.. > Modules       Turn whole areas on  > |
|  Notifications      What we ema.. > Studio details  Workspace identity > |
|  Booking link       The schedul.. >                                      |
|                                                                          |
|  INTAKE & BOARDS                    SALES & PIPELINE                     |
|  Request forms      What client.. > Pipeline defaults  Deal owner, si. > |
|  Kanban columns     The board c.. > Pipeline stages    The deal stage. > |
|  Task templates     Reusable ta.. > Lead AI and automations  Scoring.. > |
|  ...                                ...                                   |
+--------------------------------------------------------------------------+
```

**Vertical order of every zone (index):** page title, 2.5rem, search field, 2.5rem, group grid. **(Section):** page title is carried by the breadcrumb (the pane's section title is the visual h1), sub-nav and pane sit side by side starting 2rem below the top bar's hairline.

## Layout and composition - mobile (375px)

No sub-nav. `/settings` is the drill index; a section route is a full-width pane.

- **Index:** search field full-width (1rem gutters), then the permitted groups stacked in one column, same order. Rows are 44px (2.75rem) minimum.
- **Section:** a back affordance row ("Settings", 44px, chevron-left icon + label) above the section title, then the frame at full width. Data tables scroll horizontally inside their own container; the page never scrolls sideways.
- **Save bar:** full-width, pinned to the viewport bottom above the shell's tab bar, 1rem inset.
- Builders open as full-screen sheets instead of slide-overs.

```
+---------------------------+     +---------------------------+
| (mark)  Settings    (Q)   |     | (mark)  Branding    (Q)   |
+---------------------------+     +---------------------------+
| [ Search settings...    ] |     | < Settings                |
|                           |     |                           |
| ACCOUNT                   |     | Branding                  |
| Profile                 > |     | How the portal looks...   |
| Appearance              > |     | ------------------------  |
| Notifications           > |     | PORTAL NAME               |
|                           |     | [ Tahi Studio          ]  |
| WORKSPACE                 |     | PRIMARY COLOUR            |
| Branding                > |     | (o)(o)(o)(o) [#5A824E]    |
| Modules                 > |     |                           |
| ...                       |     | [Discard] [Save changes]  |
+---------------------------+     +---------------------------+
| (o)  (o)  (o)  (o)  (=)   |     | (o)  (o)  (o)  (o)  (=)   |
+---------------------------+     +---------------------------+
```

A client's mobile index has one group (Account) and no group label (three bare rows); their desktop view likewise drops the sub-nav and centres a single 40rem account column.

## Component spec

**Settings landing index - group block**
- *Purpose:* one group of sections as a scannable ledger list.
- *Anatomy:* ledger group label (0.6875rem, weight 600, uppercase, letter-spacing 0.08em, `--color-text-subtle`), 0.75rem gap, then section rows separated by hairlines (`--color-border-subtle`). Row (3rem tall, 0.75rem horizontal padding): section name (0.875rem, weight 500, `--color-text`), one-line description (0.75rem, `--color-text-muted`, truncates with ellipsis, hidden below ~24rem column width), right-aligned chevron (1rem, `--color-text-subtle`). No cards, no icons in rows: hairlines and space do the work.
- *Tokens:* text tokens above; hover `--color-bg-secondary` wash with `--radius-md`; focus-visible 2px `--color-brand-dark` ring.
- *States:* rest / hover / focus / active (pressed, `--color-bg-tertiary`). No loading state (groups render from server-resolved permissions instantly). A group with zero permitted rows does not render.

**Settings search (index)**
- *Purpose:* zero-interaction path to any permitted section.
- *Anatomy:* input, max 26rem, 2.75rem tall, search icon (1rem) inside left at 0.75rem, placeholder "Search settings...". Filters as you type against section name + description + hidden keyword synonyms (e.g. "theme" matches Appearance, "columns" matches Kanban columns, "keys" matches Integrations). While filtering, the group grid collapses to a single flat result list (same row anatomy, group name shown as a faint crumb after the section name).
- *Tokens:* white fill, `--color-border` hairline, `--radius-md`; focus `--color-brand` border + 2px `--color-brand-100` ring.
- *States:* empty (grid shows), filtering (flat results), no matches ("No settings match your search." in 0.875rem `--color-text-muted`, 2rem padded), cleared (Esc empties and restores the grid). Never lists a section the person cannot open.

**Settings sub-nav (desktop section routes)**
- *Purpose:* the map while inside a section; one leaf marks where you are.
- *Anatomy:* 15rem column. Per group: ledger micro-label (same style as the index), 0.5rem gap, item rows 2.25rem tall (0.8125rem, weight 500, `--color-text-muted`, 0.625rem horizontal padding), 1.25rem gap between groups. No collapse chevrons: groups are always open (the list is short per audience).
- *Tokens:* active row = `--color-brand-50` fill + `--color-brand-dark` text + weight 600 + `--radius-leaf-sm` + `aria-current="page"`; this is the one leaf on the screen. Hover (inactive) = `--color-bg-secondary` wash + `--color-text`. Focus-visible 2px `--color-brand-dark` ring.
- *States:* rest / hover / focus / active. Denied sections and empty groups are absent, never disabled.

**Section frame (reused by every section)**
- *Purpose:* the one skeleton every section starts from.
- *Anatomy:* section title (1.25rem, weight 600, `--color-text`, bare ink), 0.375rem gap, one-line description (0.875rem, `--color-text-muted`), 1.25rem gap, full-width hairline (`--color-border`), 2rem gap, then controls. Form rows stack with 1.5rem gaps in a single column, max 40rem. Each form row: ledger label above the control (0.75rem, weight 600, uppercase, 0.08em, `--color-text-subtle`), 0.375rem gap, control, optional helper line below (0.75rem, `--color-text-muted`).
- *Tokens:* inputs per Studio Ledger (white fill, `--color-border-strong` hairline, `--radius-md`, 2.75rem tall, 1rem text; focus `--color-brand` border + 2px `--color-brand-100` ring).
- *States:* loading = ledger-label + control skeleton rows (animate-pulse, three rows); loaded; section-level error ("Could not load this section." + Retry secondary button, 0.875rem).

**THE SAVE RULE (one rule, two patterns, stated once and applied everywhere):**
A control persists **instantly** when a single interaction expresses the whole change: switches, segmented controls, selects, colour swatches, reorder arrows, enable/disable actions. A section batches behind an **explicit save bar** when it contains free text or multiple coupled fields: Profile, Branding, Booking link, Pipeline defaults, AI context docs. Per-field "Save" buttons (the as-built third pattern) are retired.

**Instant persist + Saved whisper**
- *Anatomy:* on success, "Saved" (0.75rem, weight 600, `--color-brand-dark`) fades in 1rem to the right of the control, holds 2s, fades out. Announced via `aria-live="polite"`.
- *States:* saving (control shows a subtle 1rem spinner replacing the whisper slot, control stays interactive-looking but ignores input), saved (whisper), error (control reverts to its previous value; "Could not save" in 0.75rem `--color-danger` in the whisper slot + inline helper "Your change was not applied. Try again."; never colour alone, an alert icon precedes it).

**Save bar (dirty state)**
- *Purpose:* one obvious commit point for batched sections.
- *Anatomy:* pinned to the pane's foot (sticky, 1rem from the viewport bottom on desktop), width = pane content width. White surface, full hairline `--color-border-strong` (all sides, never one), `--radius-lg`, `--shadow-floating`, 3.5rem tall, 1rem horizontal padding. Left: "Unsaved changes" (0.8125rem, `--color-text-muted`). Right: "Discard" (secondary button, 2.25rem) then "Save changes" (primary, brand fill, white text, `--radius-leaf-sm`, 2.25rem) with 0.75rem gap.
- *States:* hidden (clean), visible (dirty; rises 0.5rem + fades in 200ms), saving ("Saving..." label swap + spinner, both buttons disabled, `aria-busy`), saved (bar drops away + a "Saved" toast), error (bar stays, "Could not save. Your changes are still here." in 0.75rem `--color-danger` replaces "Unsaved changes"). Cmd/Ctrl-S triggers Save while dirty. Navigating away while dirty opens the discard confirm dialog.

**Toggle switch**
- *Anatomy:* 2.75rem x 1.5rem track, 1rem thumb, `--radius-full`. Label + one-line description sit left (label 0.875rem 500 ink; description 0.75rem muted); the switch right-aligns. Row min-height 2.75rem (44px touch).
- *Tokens:* on = `--color-brand` track; off = `--color-border-strong` track; thumb white. Focus-visible 2px `--color-brand-dark` ring. `role="switch"` + `aria-checked`.
- *States:* on / off / hover (track deepens one step) / focus / disabled (0.5 opacity, cursor default) / saving (per instant-persist above).

**Builder launcher row + slide-over frame (forms / columns / templates / permissions)**
- *Purpose:* Settings is the canonical home; the deep editors open as focused overlays. Internals: request-form editor and kanban columns are specced in 07, the task-template editor in 08, the permissions builder (three-way Inherit / Allow / Deny + reason, roles matrix, data scope, preview-as) in 05. **Reference those; do not duplicate their editors here.**
- *Anatomy (launcher list):* hairline-separated rows, 3.25rem tall: item name (0.875rem 500 ink), meta line (0.75rem muted, e.g. "Design - 6 questions (Default)" for a form, "Client External - High" for a template, "7 columns" for a board), right-aligned quiet icon buttons Edit (pencil) + Delete (trash), each 2rem square with `--radius-md` hover wash. Above the list, right-aligned secondary "Add" button. Empty state per Studio Ledger: leaf-radius icon wrapper + one-line title + one line + one CTA.
- *Anatomy (slide-over):* right-anchored panel, **36rem** wide (permissions feature editor may use 40rem per 05), full height, white surface, hairline edge all round, `--shadow-floating`; header = editor title (1.125rem 600) + close button (2.25rem); footer = the same Discard / Save pair as the save bar. Backdrop dims the pane. Focus is trapped, Esc closes (confirming if dirty), focus returns to the launcher row.
- *States:* closed / opening (240ms translate-in) / open / dirty / saving / error / closing.

**Integration card + grid (`/settings/integrations/services`)**
- *Purpose:* one card per service; connect or manage, never enter keys.
- *Anatomy (card):* white surface, full hairline `--color-border-strong`, `--radius-lg`, 1.25rem padding. Top row: **2rem logo tile with `--radius-leaf-sm`** (service glyph on `--color-bg-secondary`; connected tile lifts to `--color-brand-50` with `--color-brand` glyph), 0.75rem gap, service name (0.875rem, weight 600), then the status chip right-aligned: "Connected" (success-tinted chip with dot: `#f0fdf4` fill, success dot, ink text) or "Not connected" (quiet chip: `--color-bg-secondary` fill, `--color-text-muted`). Below: one-line description (0.75rem, `--color-text-muted`, two lines max). Foot row: right-aligned secondary button "Manage" (connected) or "Connect" (not connected), 2.25rem tall. HubSpot renders its chip as "Built-in" (quiet) with no button.
- *Services:* Stripe, Xero, Slack, MailerLite, Google Workspace, Buffer, HubSpot (built-in).
- *Grid:* 3 columns at pane >= 54rem (min column 17rem, 1.25rem gap); 2 columns at >= 36rem; 1 column below. The grid section uses the wide 58rem pane.
- *Secrets rule (hard):* keys and tokens live in the Worker env, set per environment at deploy, **never rendered, never entered in a plain field on this page**. Cards show status + a connect/manage affordance only (OAuth redirect or instructions); the card's fine print reads "Keys live in the deployment environment. They are never shown here." The as-built webhook secret input is replaced by a write-only field that masks on blur and can never re-display its value.
- *States:* connected / not connected / built-in / connecting (button spinner "Connecting...") / error ("Connection failed. Try again." under the foot row, danger ink + icon).

**Webhook row (`/settings/integrations/webhooks`)**
- *Anatomy:* hairline rows, 3.25rem: endpoint URL (0.8125rem, mono, truncating), event-count chip ("3 events", quiet), right-aligned Delete icon button. "Add endpoint" opens an inline form: URL input, write-only Secret input (masked, never re-displayed), event checkboxes in two columns (the seven events listed in as-built), Cancel + Add endpoint buttons.
- *States:* list / empty ("No webhook endpoints yet." + "Add endpoint" CTA) / adding / deleting (row fades, confirm first).

**Scheduled-jobs row (`/settings/integrations/crons`)**
- *Purpose:* visibility + manual triggers for every cron, exactly the as-built data shape (`label`, `description`, `schedule`, `lastRun`, `recentRuns`).
- *Anatomy:* hairline rows, 4rem tall (two text lines): line one = job label (0.875rem 500 ink) + schedule in a quiet chip (0.75rem mono, `--color-bg-secondary`, e.g. "0 7 * * *"); line two = description (0.75rem muted, truncating). Right cluster: last-run status chip (Success = success tint + dot, Error = danger tint + dot, Skipped = warning tint + dot; ink text on all three), last-run relative time (0.75rem muted, exact timestamp on hover title), "Run now" secondary button (2.25rem), and a disclosure chevron (2rem icon button) revealing the last-10-runs list: sub-rows 2.5rem (status chip, duration right-aligned tabular "1.2s", summary truncating, relative time).
- *States:* rest / running ("Run now" swaps to a spinner + "Running...", row ignores further clicks) / success toast / error toast (row's error summary shown in the disclosure) / never-run ("Not run yet" in place of the chip).

**Automation rule row (`/settings/integrations/automations`)**
- *Purpose:* the trigger/action rules, as built (`name`, `enabled`, `triggerEvent`, `actions`, `executionCount`, `lastExecutedAt`).
- *Anatomy:* hairline rows, 3.5rem: enable toggle (left, the standard switch), rule name (0.875rem 500 ink), a quiet trigger chip ("Request Created" etc), action count ("2 actions", 0.75rem muted), right-aligned run stats ("14 runs - last 2h ago", 0.75rem muted, tabular figures) and a Delete icon button. Disabled rules render their name in `--color-text-muted` (the toggle state carries the truth; never opacity alone).
- *States:* enabled / disabled / toggling (instant-persist pattern) / empty ("No automation rules yet." + "Add rule" CTA) / deleting (confirm first).

**Cash reserves row (`/settings/billing/reserves`)**
- *Purpose:* the reserve pots behind `/financial-reports` disposable cash, as built (`name`, `category`, `currency`, `targetAmount`, `accruedAmount`, `accrualRate`, `active`).
- *Anatomy:* hairline rows, 3.25rem: pot name (0.875rem 500 ink) + category chip (Tax / Buffer / Client deposits / Other, quiet), then right-aligned and tabular: accrued amount (0.875rem 600 ink, e.g. "NZD 12,400"), target ("of 20,000", 0.75rem muted, absent when no target), accrual rate chip ("28%", quiet, absent when null), Edit + Delete icon buttons. Inactive pots show an "Inactive" quiet chip and muted name.
- *States:* list / empty (the as-built copy, see deck) / editing (slide-over with the fields above) / delete confirm (soft delete).

**Audit-log viewer (`/settings/advanced/audit`)**
- *Purpose:* the immutable answer to "who did what, when".
- *Anatomy:* filter row (four controls, 2.5rem tall, 0.75rem gaps): Action select (All Actions / Created / Updated / Deleted / Login / Impersonated / Status Changed), Entity select (All Entities / Requests / Clients / Invoices / Tasks / Team Members / Conversations / Contracts / Automations), From date, To date. Below, the table (wide 58rem pane): sand header row (`--color-th-bg`), ledger-label column heads, hairline row borders, row height 3rem. Columns: Time 10rem (relative + exact on hover title), Actor 12rem, Action 7rem (quiet chip; "Deleted" and "Impersonated" get a danger-tinted chip because the status is literally true), Entity 10rem, Details flexible (metadata summary, truncates), IP 7rem right-aligned. Footer: "Prev" / "Next" secondary buttons + page indicator (0.8125rem muted).
- *States:* loading (skeleton rows), populated, filtered-empty ("No entries match these filters."), end of pages (Next disabled).

**Danger zone (`/settings/advanced/danger`)**
- *Purpose:* quarantine for the destructive.
- *Anatomy:* the frame's description reads "These actions are permanent." Each action is a row inside a single card with a full danger-tinted hairline (all four sides) on `--color-danger-bg` `#fef2f2` at low presence: action name (0.875rem 600 ink), consequence line (0.75rem muted), right-aligned danger button (danger fill `#dc2626`, white text, `--radius-md`, 2.25rem). This is the only surface in Settings where danger tone appears outside a literal status.
- *Confirm dialog anatomy:* centred dialog, 26rem, white, hairline, `--shadow-floating`, `--radius-lg`. Title ("Delete all demo data?" pattern), consequence paragraph (0.875rem muted), a type-to-confirm input (ledger label "Type DELETE to confirm"), then Cancel (secondary) + the danger button (disabled until the typed value matches exactly). Focus trapped, Esc cancels, focus returns. Every execution writes to `auditLog`.
- *States:* rest / dialog open / confirming (typed mismatch keeps the button disabled) / executing (spinner) / done (toast "Done. This action was logged.").

**Client account view**
- *Purpose:* the client's whole Settings: Profile, Appearance, Notifications. A tidy account screen, not an admin panel minus rows.
- *Anatomy:* no sub-nav; a single centred column (max 40rem) with the three sections as one page, each using the section frame, separated by 3rem + a hairline. Profile fields exactly as built: Name, Email (disabled, "Email is managed through your login provider."), Role / Title, save via the save bar. Appearance: the one theme switch (instant). Notifications: per-user email preference switches (instant; requires the new portal endpoint, see Open decisions).
- *States:* loading / loaded / profile-missing ("No profile record found. Please contact the Tahi team if you need help setting up your account.").

**Mobile drill (index + back affordance)**
- *Anatomy:* index rows 2.75rem (44px) minimum; the back row on section pages is 2.75rem, chevron-left (1rem) + "Settings" (0.875rem 500), full-width touch target; sits above the section title with a 1rem gap.
- *States:* the back row appears only below the desktop breakpoint; swipe-back (browser) works because sections are real routes.

## Motion and dynamism

All on `--ease-out` `cubic-bezier(.22,1,.36,1)`; no bounce, no spring; hover-triggered animations play to completion, never reverse mid-way.

- **Index row hover:** background wash in 110ms (`--motion-quick`).
- **Section change (sub-nav click):** pane cross-fades 150ms; the sub-nav leaf moves to the new row over 200ms. No slide-in.
- **Save bar:** rises 0.5rem + fades in 200ms on dirty; drops + fades 200ms on save/discard.
- **Saved whisper:** fades in 110ms, holds 2000ms, fades out 300ms.
- **Slide-over:** translates in from the right 240ms + backdrop fades 150ms; close reverses (a close is a state change, not a hover animation, so reversal is correct here).
- **Confirm dialog:** fades + rises 0.5rem over 150ms.
- **Toggle thumb:** 200ms translate.
- **Search filtering:** results swap with a 110ms fade, no layout spring.
- **`prefers-reduced-motion: reduce`:** every transition above becomes instant (state changes still occur; whisper appears and disappears without fades, holding the same 2000ms so it remains readable).

## Accessibility (WCAG 2.2 AA)

- **Landmarks:** the sub-nav is `<nav aria-label="Settings">`; the pane is within the shell's `<main>`; each section route has exactly one visual h1 (the section title; the breadcrumb carries the path). On route change focus moves to the section title (04 rule).
- **Names and state:** `aria-current="page"` on the active sub-nav row; switches are `role="switch"` + `aria-checked` + a real label (never placeholder-only); icon-only Edit/Delete buttons carry `aria-label` + tooltip; the search input has a visible label or `aria-label="Search settings"`.
- **Live feedback:** the Saved whisper and save-bar status are `aria-live="polite"`; save errors are `role="alert"`. The type-to-confirm dialog is `role="dialog" aria-modal="true"` with a labelled heading, focus trap, Esc-to-cancel, and focus return.
- **Keyboard paths:** Tab order is sub-nav top-to-bottom then pane top-to-bottom; Cmd/Ctrl-S saves a dirty section; Esc closes overlays (confirming when dirty); the audit table is navigable as a real `<table>` with `<th scope="col">` heads; no keyboard trap anywhere (2.1.2).
- **Contrast callouts:** ledger labels use `--color-text-subtle` `#63615B` (AA on sand at their size + weight, verify on white cards too); the "Connected" chip must set ink text on the `#f0fdf4` tint (the `#4ade80` success green itself fails as text); primary buttons use white on `--color-brand`/`--color-brand-dark` per the theme's AA-safe pairing (brand-dark for text-critical fills); danger buttons `#dc2626` on white pass. Status is never colour alone: chips carry text, errors carry an icon + words.
- **Target size (2.5.8):** 44px (2.75rem) on all mobile rows, switches' full label rows are tappable, icon buttons are minimum 2rem with 0.25rem spacing (24px floor met, 44px on touch layouts).
- **Reduced motion:** per the Motion section, fully honoured.
- **Forced colors:** hairline-only rows keep a real border so they survive; the active leaf also differs by weight, not colour alone.

## States and flows

- **Client view:** Account only (Profile / Appearance / Notifications), single column, no sub-nav, no group labels beyond the three sections.
- **Teammate view:** Account + only granted groups; empty groups absent (deny by default, 05). A teammate with intake-manage sees Account + Intake & boards and it reads complete.
- **Owner view:** all eight groups.
- **Landing:** default grid / searching / no matches / a client's three-row version.
- **Section lifecycle:** loading skeleton -> loaded -> (instant control: saving -> whisper | error-revert) -> (batched: dirty -> save bar -> saving -> saved | error-stays).
- **Dirty navigation:** sub-nav click, back, or palette jump while dirty opens "Discard unsaved changes?" (Keep editing / Discard).
- **Builder flow:** launcher row -> slide-over (07/08/05 internals) -> save/close -> launcher list refreshes optimistically.
- **Integration connect / disconnect:** Connect -> OAuth or instruction flow -> card flips to Connected; Manage offers Disconnect behind a confirm. Secrets never render at any point.
- **Scheduled job run:** "Run now" -> button spinner -> toast "<Job> ran" or "<Job> failed: <reason>" -> row's last-run refreshes.
- **Danger action:** row button -> typed confirm -> execute -> audit-logged toast.
- **Deep link:** `/settings/team-access/permissions` (or any redirect from the legacy routes) lands directly on the section with the leaf correct and focus on the title.
- **Denied deep link:** server-gated; the person gets the app's forbidden state inside an intact shell (04), and the section never appears in their sub-nav, index, or palette.
- **Dark mode:** every surface here uses tokens; the sub-nav leaf uses `--color-brand-50`-equivalent dark tint; designed explicitly, not assumed.

## Copy deck

Calm plain NZ voice. Hyphens only. Sentence case everywhere except ledger labels (rendered uppercase by style, written here in sentence case).

**Groups:** `Account`, `Workspace`, `Intake & boards`, `Sales & pipeline`, `Automations & integrations`, `Team & access`, `Billing`, `Advanced`.

**Section titles + index descriptions:**
- `Profile` - "Your name, role, and how the studio sees you."
- `Appearance` - "Light or dark, your choice, remembered."
- `Notifications` - "What we email you about, and when."
- `Booking link` - "The scheduling link clients use to book a call."
- `Branding` - "Portal name, colour, logo, and favicons."
- `Modules` - "Turn whole areas of the dashboard on or off."
- `Studio details` - "The workspace's own identity."
- `Request forms` - "What clients answer when they submit a request."
- `Kanban columns` - "The board columns clients and the team see."
- `Task templates` - "Reusable task sets the team runs."
- `Pipeline defaults` - "Default deal owner and nudge signature."
- `Pipeline stages` - "The stages every deal moves through."
- `Lead AI and automations` - "Scoring, enrichment, and lead follow-up."
- `Integrations` - "Stripe, Xero, Slack, Google, and friends."
- `Webhooks` - "Send events to your own endpoints."
- `Automations` - "When this happens, do that."
- `Scheduled jobs` - "Every cron, its last run, and a run-now button."
- `AI cost` - "What the AI features are spending."
- `AI context docs` - "The docs that teach the AI about Tahi."
- `Content engine signals` - "Signals feeding the content studio."
- `Team members` - "Who is on the team and what role they hold."
- `Roles` - "What each role can see and do."
- `Permissions` - "Per-person and per-client feature access."
- `Subscription` - "Your Stripe subscription and billing."
- `Cash reserves` - "The pots behind the disposable-cash math."
- `Audit log` - "Who did what, and when."
- `Danger zone` - "Permanent actions. Tread carefully."

**Search:** placeholder `Search settings...`; empty `No settings match your search.`
**Save:** whisper `Saved`; bar `Unsaved changes` / `Save changes` / `Discard`; saving `Saving...`; bar error `Could not save. Your changes are still here.`; instant error `Could not save` + helper `Your change was not applied. Try again.`; toast on batched success `Saved`.
**Discard confirm:** title `Discard unsaved changes?`; body `Your edits to this section will be lost.`; buttons `Keep editing` / `Discard`.
**Profile:** labels `Name`, `Email`, `Role / title`; helper `Email is managed through your login provider.`; missing `No profile record found. Please contact the Tahi team if you need help setting up your account.`
**Appearance:** `Dark mode` + `Switch between light and dark themes.`
**Notifications:** `Email notifications` + `Receive email alerts for important updates.`; `Slack notifications` + `Post updates to your configured Slack channel.` (owner only).
**Branding field labels:** `Portal name` + helper `Displayed in the client portal header.`; `Primary colour` + helper `Used for buttons, links, and accents in the client portal.`; `Logo URL`; `Favicon (light)` / `Favicon (dark)`; preview caption `Preview`.
**Booking link:** label `Google Calendar booking URL` + helper `Clients will see a "Schedule a call" button linking to this URL.`
**Integrations:** chips `Connected` / `Not connected` / `Built-in`; buttons `Connect` / `Manage`; connecting `Connecting...`; error `Connection failed. Try again.`; fine print `Keys live in the deployment environment. They are never shown here.`; disconnect confirm `Disconnect <Service>?` / `The connection stops immediately. Nothing is deleted.` / `Cancel` / `Disconnect`.
**Webhooks:** empty `No webhook endpoints yet.` + CTA `Add endpoint`; labels `Endpoint URL`, `Secret`, `Events`; secret helper `Write-only. You will not see this value again.`; delete confirm `Remove this endpoint?` / `Events stop sending immediately.` / `Cancel` / `Remove`.
**Builders:** CTAs `Add form`, `Add column`, `Add template`; empties `No request forms yet. The default questions apply until you add one.`, `No custom columns. The default board applies: Submitted, In Review, In Progress, Client Review, On Hold, Delivered, Cancelled.`, `No task templates yet.`; kanban hint `Showing the global default. Add a column to override it for this client.`
**Scheduled jobs:** `Run now`; running `Running...`; `Last run`; never run `Not run yet`; statuses `Success` / `Error` / `Skipped`; toasts `<Job> ran` / `<Job> failed: <reason>`; history `Recent runs`.
**Automations:** empty `No automation rules yet.` + CTA `Add rule`; delete confirm `Delete this rule?` / `It stops running immediately.` / `Cancel` / `Delete`.
**Cash reserves:** inactive chip `Inactive`; delete confirm `Remove this reserve?` / `It is removed from the disposable-cash math. History is kept.` / `Cancel` / `Remove`.
**Audit:** filters `All actions` / `All entities` / `From` / `To`; empty `No entries match these filters.`; pagination `Prev` / `Next`.
**Cash reserves:** empty `No reserves configured. Tahi recommends at minimum a tax pot (28% accrual rate, NZD).`
**Advanced:** description `These actions are permanent.`; confirm input label `Type DELETE to confirm`; done toast `Done. This action was logged.`
**Mobile back:** `Settings`.
**Section load error:** `Could not load this section.` + `Retry`.

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Canvas | `--color-bg-cream` (never hardcoded) |
| Page + section titles | bare ink `--color-text`, 1.25rem-1.5rem, weight 600 |
| Ledger labels (groups, field labels, table heads) | 0.6875rem / 0.75rem, 600, uppercase, 0.08em, `--color-text-subtle` |
| Index / launcher / audit row hairlines | `--color-border-subtle`; section divider `--color-border` |
| Sub-nav active leaf | `--color-brand-50` fill, `--color-brand-dark` text, `--radius-leaf-sm` (the one leaf) |
| Sub-nav width / pane gap | 15rem / 3rem; settings max width 60rem; form column max 40rem; wide pane 58rem |
| Inputs | white fill, `--color-border-strong`, `--radius-md`, 2.75rem tall; focus `--color-brand` + 2px `--color-brand-100` ring |
| Primary buttons (Save changes, Add) | brand fill, white text, `--radius-leaf-sm`, hover `--color-brand-dark` |
| Secondary buttons (Discard, Manage, Prev/Next) | hairline `--color-border-strong`, ink text, `--radius-md`, hover `--color-bg-secondary` |
| Toggle | on `--color-brand` / off `--color-border-strong`; 2.75rem x 1.5rem |
| Save bar / slide-over / dialog | white surface, full hairline `--color-border-strong`, `--radius-lg`, `--shadow-floating` (overlays only) |
| Integration logo tile | 2rem, `--radius-leaf-sm`, `--color-bg-secondary` (connected: `--color-brand-50` + `--color-brand` glyph) |
| Status chips | Connected: `#f0fdf4` fill + success dot + ink text; Not connected / Built-in: `--color-bg-secondary` + `--color-text-muted`; audit Deleted/Impersonated: `#fef2f2` + ink |
| Danger (Advanced only) | button `#dc2626` on white; card tint `#fef2f2`; full borders always |
| Table header | `--color-th-bg` sand, hairline rows, hover `--color-row-hover`, numbers right-aligned tabular |
| Motion | 110ms quick / 150-200ms base / 240ms slide-over, all `--ease-out cubic-bezier(.22,1,.36,1)`; reduced motion = instant |
| Font | Manrope; body 0.875rem 400-500; meta 0.75rem |
| Leaf budget | active sub-nav row + primary CTA + integration logo tiles + empty-state icon wrapper. Nowhere else |

## Deliverables for Claude design

1. **Settings index (owner) - desktop:** search + all eight groups in the two-column grid, exact row anatomy.
2. **Index while searching:** flat result list with group crumbs, plus the no-matches state.
3. **A batched section (owner):** Workspace > Branding with the sub-nav leaf active and the save bar visible in its dirty state.
4. **An instant section (owner):** Workspace > Modules with one switch mid-save and one showing the Saved whisper.
5. **Intake & boards:** the Request forms launcher list + the form-builder slide-over open (internals per 07).
6. **Team & access:** the Permissions section (05 builder living inside the settings frame).
7. **Integrations:** the services grid (Stripe connected, Xero connected, Slack not connected, HubSpot built-in, MailerLite not connected, Google Workspace connected, Buffer connected) with the secrets fine print.
8. **Advanced:** the audit-log viewer (filters + table) and the danger zone with the type-to-confirm dialog open.
9. **Client Settings:** the Account-only single-column view (Profile / Appearance / Notifications).
10. **Mobile (375px):** the drill index and a drilled-in section with back affordance and the pinned save bar.
11. **Dark mode:** index + one section + integrations grid.
12. **State sheet:** save success / save failure (both patterns), discard confirm, section skeleton, section load error, permission-gated group absent (teammate index), integration connecting / error, cron Run now toast, audit filtered-empty.

**Integration constraints:**
- Reuse the existing section components in `settings-content.tsx`; this is IA + reskin plus relocating Permissions in, not a rebuild of every editor. Decompose the monolith into per-section files under `app/(dashboard)/settings/<group>/<section>/` as part of the work, preserving each section's save logic.
- Settings is the **canonical home** for request forms, kanban columns, task templates, and permissions; 06-08 must not ship duplicate editors, they consume and link here. Editor internals stay owned by 07 (forms, columns), 08 (templates), 05 (permissions).
- Permissions moves fully in; remove the top-level `/permissions` nav item (04 already reflects this) and redirect `/permissions` -> `/settings/team-access/permissions`. Also redirect `/settings/audit`, `/settings/automations`, `/settings/crons` to their new homes and update the command-palette index (04) to the new routes.
- Sections gate **server-side** by audience + permission via `lib/permissions.ts` + `FEATURE_TREE` (extend the tree with per-group keys alongside the existing `settings`, `settings.integrations`, `settings.permissions`); the client never reaches owner sections and a denied section is absent, never disabled.
- Implement THE SAVE RULE exactly: instant persist + whisper for atomic controls, dirty save bar for text/multi-field sections; retire per-field Save buttons and the bare "Setting saved" toast-per-key pattern.
- Secrets stay in the Worker env (Cloudflare), never rendered; the webhook secret field becomes write-only.
- Tokens only (dark mode designed); no border on a single side of any element; hyphens only; `prefers-reduced-motion` honoured; 44px touch targets; WCAG 2.2 AA; every interactive element has visible hover and focus states.

## Why this is premium

A settings page is where software quietly tells you whether it respects you. A 4,000-line scroll says "we bolted features on"; a calm, grouped control room with a clean account screen for clients and a real builder area for the studio says "this was designed". Folding permissions, forms, columns, and templates into one coherent place means there is exactly one home for every lever, the surfaces stay clean, and the owner can find anything in two moves or zero. One leaf marks where you are, hairlines and ledger labels do the structure, save feedback is never ambiguous, and the only red in the whole surface lives behind glass in Advanced. Restraint and order, again, are the premium.

## Open decisions and risks

1. **Permissions relocation** (decided: fully inside Settings, top-level item removed). Must redirect the old `/permissions` route so existing links and the 05 builder keep working.
2. **The monolith** (4,343 lines today; previously ~4,817) is a real regression risk; decompose into per-section files behind the new IA carefully, preserving each section's save logic and SWR keys.
3. **Builder ownership overlaps** with 07 (forms, columns) and 08 (templates). Settings is canonical; 07/08 link to these editors rather than duplicating them. Keep the specs in sync.
4. **Audience gating** is currently inline `isAdmin` checks; move to the same feature/permission gating as the rest of the app so teammate-visible sections are correct. Align with spec 05's deny-by-default decision: a teammate sees Account plus only the sections their role explicitly grants, never "admin minus a few rows". Server-gate each section (the real gate); a denied section is absent, not disabled. Requires new `FEATURE_TREE` keys per group.
5. **Sub-routes** (audit, automations, crons) fold under the new groups (Advanced / Automations & integrations) with permanent redirects; bookmarks and the palette index must follow.
6. **Modules vs the feature tree (confirmed finding):** `module_*_enabled` settings keys and `featureVisibility` (05) are two parallel gating systems answering "is this area on". Decide: fold Modules into the permissions engine as workspace-level defaults, or keep it as a distinct kill switch and document the precedence. Do not ship the redesign with both silently coexisting.
7. **Notifications are workspace-global and 403 for clients (confirmed finding):** the client-visible email toggle PATCHes the admin-only `/api/admin/settings`. Ship a per-user portal preferences endpoint before the client Notifications section goes live, or hide the section for clients until it exists.
8. **Save-pattern migration:** replacing per-key `saveSetting` + per-field Save buttons with the save bar changes when writes happen (batched PATCH vs per-key); sections like Branding mix instant swatches with batched text and need a careful split.
9. **Danger zone first occupant** is undecided (candidates: clear demo data, revoke all client sessions). The pattern ships regardless; actions land one by one, each audit-logged.
10. **Team & access vs `/team`:** the roster, roles, and permissions live here; `/team` remains the operational surface (profiles, capacity). The as-built `/team/[id]/access` data-scope editor relocates into the 05 builder. Ensure no third editor survives the move.
