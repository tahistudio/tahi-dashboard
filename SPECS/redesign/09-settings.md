# Settings - design brief

> The single home for all configuration. Today it is a 4,817-line flat list of
> ~18 sections with no information architecture, and Permissions lives separately
> as a top-level page. This spec gives Settings real IA, folds Permissions in
> fully (no top-level nav item), and makes Settings the canonical home for the
> builders that 06-08 consume (request forms, kanban columns, task templates,
> permissions).

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

- `app/(dashboard)/settings/page.tsx` (server, auth + `isAdmin`) -> `settings-content.tsx`, a **~4,817-line monolith** rendering ~18 sections in a flat vertical scroll, gated inline by `isAdmin`:
  - **Personal:** `ProfileSection` (client portal / self), `BookingLinkSection`.
  - **Workspace:** `BrandingSection`, `ModulesSection` (feature toggles), `ReservesSection` (finance reserves).
  - **Intake & boards (the builders 07/08 consume):** `FormsSection` + `FormEditor` (request intake forms), `KanbanColumnsSection` (per-client columns), `TaskTemplatesSection`.
  - **Sales & pipeline:** `PipelineDefaultsSection`, `PipelineStagesSection`, `LeadAutomationsSection`.
  - **Automations & integrations:** `GoogleIntegrationSection`, `BufferIntegrationSection`, `WebhooksSection`, `ScheduledJobsLinkSection`, `AiCostSection`, `AiContextDocsSection`, `ContentEngineSignalsSection`, plus inline links to Stripe (billing) and `/team`.
  - **Sub-routes:** `settings/audit` (audit-log viewer), `settings/automations`, `settings/crons`.
- APIs: `/api/admin/settings` (key/value store), `/api/admin/kanban-columns`, `/api/admin/task-templates`, `/api/admin/webhooks`, `/api/portal/request-forms`, integration routes under `/api/admin/integrations/*`.
- **Permissions** is a separate top-level page (`/permissions`, `requiresManage`) - see 05-permissions.md. **Decision: it moves fully into Settings here; the top-level nav item is removed.**

So: everything works, but there is no IA, the page is unmaintainably long, and configuration is split across a flat settings scroll plus a standalone permissions page.

## Page purpose

One calm, well-organized place to configure everything: your account, the studio's identity, the builders that shape requests and tasks, integrations and automations, billing, and team access. Find any setting in two interactions; never scroll a wall.

## Why this matters

Settings is where the studio is actually shaped: the intake forms a client fills (07), the board columns they see (07), the task templates the team runs (08), the permissions that gate every surface (05), and the integrations that move money and data. Giving it IA makes all of that discoverable and turns "a giant scroll" into the studio's control room. It is also where the three audiences differ sharply: a client sees only their account; the team and owner see progressively more.

## Personas and jobs-to-be-done

- **Client.** "Update my profile and notifications." That is essentially all a client sees in Settings. It must feel like a tidy account screen, not a hidden admin panel.
- **Teammate (team_member).** "My account, plus whatever my role lets me configure" (often little). Sections gate by permission, empty groups disappear.
- **Owner (super_admin).** "Configure the whole studio": branding, modules, the builders, integrations, automations, billing, team and permissions. This is the control room.

## What others do (and what we take)

- **Stripe / Linear / Notion / GitHub settings** - a **left settings sub-nav** (grouped sections) with a content pane on the right; URL-addressable sections (`/settings/<section>`), search across settings, and a clear split between "your account" and "the workspace/org". We adopt the left-rail + pane, addressable sections, and the personal/workspace split.
- **Vanta / Stytch** - Team & access (roles, members, permissions) as one coherent area rather than scattered. We fold Permissions + Team + Roles together.
- **Timeless ideas** - group by intent not by feature; the most-used settings shallow and findable; destructive/advanced settings quarantined; every change saves with clear feedback; settings are searchable.

## Information architecture (the new structure)

A left settings sub-nav with these groups; sections are URL-addressable (`/settings/<group>/<section>`). Each section gates by audience + permission; empty groups vanish.

1. **Account** (every audience): Profile, Appearance (theme), Notifications, Booking link (team).
2. **Workspace** (owner): Branding, Modules (feature toggles), Studio details.
3. **Intake & boards** (owner/PM): Request forms (builder), Kanban columns, Task templates. These are the canonical builders that 07 and 08 consume.
4. **Sales & pipeline** (owner): Pipeline defaults, Pipeline stages, Lead automations.
5. **Automations & integrations** (owner): Integrations (Stripe, Xero, Google, Slack, HubSpot, Mailerlite, Buffer), Webhooks, Automations, Scheduled jobs, AI (cost, context docs, content-engine signals).
6. **Team & access** (owner / manage-permissions): Team members, Roles, **Permissions** (the full 05 builder lives here), per-team-member data scope.
7. **Billing** (owner): Subscription / Stripe, Reserves.
8. **Advanced** (owner): Audit log, danger zone.

The settings landing is a tidy index of these groups (not an auto-scroll of every section), with search.

## Experience principles (on top of Studio Ledger)

1. **Group by intent, not by feature.** A person thinks "I want to change intake", not "I want the FormsSection".
2. **Personal vs studio is the first split.** Account is yours; everything else is the studio's.
3. **The builders live here, the surfaces consume them.** Settings owns request forms, kanban columns, task templates, and permissions; 06-08 render what these produce. No duplicate editors elsewhere.
4. **Shallow and searchable.** Two interactions to any setting; a search box spans all sections.
5. **Save is obvious and safe.** Each section saves with clear feedback; destructive actions are quarantined in Advanced with confirmation.
6. **Audience-shaped.** A client's Settings is a clean account page, not the admin panel with rows hidden.

## Layout and composition

- **Desktop:** a left settings sub-nav (grouped, the current section highlighted with the rare leaf), a content pane on the right with the section title as bare ink and the section's controls below. Generous gutters, hairlines over cards, Studio Ledger throughout.
- **Mobile (375px):** the sub-nav becomes a top-level list of groups; tapping one opens that section full-width; a back affordance returns to the index. No horizontal scroll; 44px rows.
- **Section content:** form rows with ledger labels, inline save or a sticky save bar per section; the builders (forms, columns, templates, permissions) open as focused editors within the pane (or a slide-over for deep editors like the form builder and the permission matrix).

## Component spec

- **Settings sub-nav:** grouped list, addressable routes, active = leaf; groups collapse on mobile; permission-gated items absent (not disabled).
- **Section frame:** title + description + controls + save feedback; reused by every section.
- **Builders (canonical, moved/anchored here):**
  - **Request forms:** the 07 form builder (question types text/textarea/url/select/multiselect/checkbox/file) with the resolution-priority preview.
  - **Kanban columns:** per-client columns mapping to real `requests.status` values.
  - **Task templates:** the 08 template editor (name, category, default priority, subtasks, estimated hours).
  - **Permissions:** the full 05 builder (three-way Inherit/Allow/Deny + reason, roles matrix, data scope, preview-as, audit) lives in Team & access. No top-level page.
- **Integrations:** one card per service with connect/disconnect + status; secrets are never shown (they live in the Worker env, per the Cloudflare setup).
- **Search:** a single field that filters sections by label + description across all groups.

## Motion, accessibility

- Section transitions: calm cross-fade in the pane; sub-nav active state slides the leaf; reduced motion = instant.
- Accessibility: the sub-nav is a real nav landmark with `aria-current`; each section is a labelled region; save feedback is announced; 44px targets; AA contrast in light and dark; deep editors (form builder, permission matrix) trap focus and are escapable.

## States and flows

- **Client view:** Account only (Profile, Appearance, Notifications) - a tidy account screen.
- **Teammate view:** Account + permitted sections; empty groups absent.
- **Owner view:** everything.
- Saving a setting (inline / sticky bar) with success + failure (revert) feedback.
- Connecting / disconnecting an integration (with the "secrets live in env" note).
- Editing a builder (forms / columns / templates / permissions) in a focused editor.
- Destructive action in Advanced (confirm + audit-logged).
- Deep-linking to a section (`/settings/team-access/permissions`) lands directly there.

## Copy deck

- Group labels: Account, Workspace, Intake & boards, Sales & pipeline, Automations & integrations, Team & access, Billing, Advanced.
- Search placeholder: "Search settings...". Save states: "Saved", "Saving...", "Could not save".
- Integrations status: "Connected", "Not connected". Advanced: "These actions are permanent."

## Tokens and visual reference

- Cream canvas; hairlines over cards; ledger micro-labels on group headers and field labels; the leaf radius only on the active sub-nav item and primary save CTA. One green accent; danger tone only in Advanced. Tokens only (dark mode).

## Deliverables for Claude design

1. **Settings index** (owner) - the grouped landing with search.
2. **A section in the pane** (owner) - e.g. Branding, with the sub-nav showing the active leaf.
3. **Intake & boards** - the request-form builder with resolution preview.
4. **Team & access** - the permissions builder living inside Settings (slide-over / matrix).
5. **Integrations** - the cards grid with statuses.
6. **Client Settings** - Account only (Profile / Appearance / Notifications).
7. **Mobile** (375px) - the groups list and a drilled-in section.
8. **Dark mode** of the above.
9. **State sheet:** save success/failure, permission-gated section absent, integration connected/not, deep-link to a section.

**Integration constraints:**
- Reuse the existing section components in `settings-content.tsx`; this is IA + reskin, plus relocating Permissions in, not a rebuild of every editor. Decompose the monolith into per-section files as part of the work.
- Settings is the **canonical home** for request forms, kanban columns, task templates, and permissions; 06-08 must not ship duplicate editors, they consume these.
- Permissions moves fully in; remove the top-level `/permissions` nav item (update 04-app-shell) and route `/permissions` to the Settings section (or redirect) so existing links survive.
- Sections gate server-side by audience + permission (the real gate); the client never reaches owner sections.
- Secrets stay in the Worker env (Cloudflare), never rendered. Tokens only; reduced motion; 44px; AA.

## Why this is premium

A settings page is where software quietly tells you whether it respects you. A 4,817-line scroll says "we bolted features on"; a calm, grouped control room with a clean account screen for clients and a real builder area for the studio says "this was designed". Folding permissions, forms, columns, and templates into one coherent place means there is exactly one home for every lever, the surfaces stay clean, and the owner can find anything in two clicks. Restraint and order, again, are the premium.

## Open decisions and risks

1. **Permissions relocation** (decided: fully inside Settings, top-level item removed). Must redirect the old `/permissions` route so existing links and the 05 builder keep working.
2. **The 4,817-line monolith** is a real regression risk; decompose into per-section files behind the new IA carefully, preserving each section's save logic.
3. **Builder ownership overlaps** with 07 (forms, columns) and 08 (templates). Settings is canonical; 07/08 link to these editors rather than duplicating them. Keep the specs in sync.
4. **Audience gating** is currently inline `isAdmin` checks; move to the same feature/permission gating as the rest of the app so teammate-visible sections are correct.
5. **Sub-routes** (audit, automations, crons) should fold under the new groups (Advanced / Automations) rather than remain loose routes.
