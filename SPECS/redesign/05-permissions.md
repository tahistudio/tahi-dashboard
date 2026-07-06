# Roles and granular permissions - design brief (Settings > Team & access)

> Who sees what, why, and how much. This is the second foundation (after 04-app-shell):
> it decides the navigation a person sees, the surfaces they can open, and the rows
> a query returns. Owner can never be locked out; teammates are scoped; clients see
> only their own, client-safe world.

> Home: the permissions builder lives **inside Settings > Team & access** (see
> 09-settings.md), not as a top-level page. The old `/permissions` route redirects
> there. 09 owns the settings frame (left sub-nav, section title as bare ink); this
> brief specs the entire content pane to the right of that sub-nav, plus its overlays:
> the feature slide-over, the roles matrix, the preview-as bar, and the change history.

> The app shell (04) is built and live: always-dark forest rail, hairline top bar,
> cream canvas. Never re-spec it; this pane renders inside it.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

A real, tested permissions engine is already live (in-app migrations `0077`/`0078` in `app/api/admin/db/migrate/route.ts`; the earlier RBAC tables ship in `drizzle/migrations/0039_permissions.sql`). This brief documents it, redesigns the management surface, and names the seams to close. It does not start from scratch.

- `lib/feature-tree.ts` - the single source of truth. `FEATURE_TREE` is a flat array of **37** dotted-key `FeatureNode`s (30 top-level pages + 7 children such as `requests.board`, `requests.bulk_actions`, `deals.engagement_health`, `clients.billing_card`, `clients.engagement_health`, `settings.integrations`, `settings.permissions`), each with `label`, `description` (the "why", surfaced in the builder), `parent`, `appliesTo: ('team'|'client')[]`, optional `route`. Team audience = 34 nodes (27 top-level); client audience = 11 nodes (10 top-level: `overview`, `requests`, `messages`, `files`, `invoices`, `services`, `tracks`, `schedules`, `contracts`, `proposals`, plus `requests.board`). Helpers: `featureAncestry` (leaf-first, so denying a parent cascades), `featureChildren`, `featurePages(audience)`, `featureKeyForRoute`.
- `lib/permissions.ts` - the resolver. `AccessLevel = 'super_admin' | 'admin' | 'team_member' | 'client'`; `Effect = 'allow' | 'deny'`. `decideFeature(access, key)` is **pure and unit-tested**: unknown key allow; wrong audience deny; super_admin always allow; explicit overrides walked leaf-first (own rule beats ancestor, denied ancestor cascades); then admin/client default allow; team_member gated by their role's `.view` baseline via the `FEATURE_RESOURCE` map (18 mapped resources; unmapped features such as `content_studio` default to visible for team members). `featureMap()` precomputes every key for the client; `resolvePermissions(drizzle, {userId, orgId})` loads from the DB (audience = team if `orgId === NEXT_PUBLIC_TAHI_ORG_ID`, else client). Role-level overrides merge deny-wins; a team_member-specific row beats a role row.
- `components/tahi/permissions-context.tsx` - `PermissionsProvider` (fed server-side, no flash), `usePermissions()`, `useFeature(key)`, and `<Gate feature=... fallback>`. Client-side is **fail-open** (the comment says "server routes are the real gate").
- `app/(dashboard)/permissions/permissions-content.tsx` (~1,060 lines) - the current builder. Three tabs (Team members / Clients / Roles); per subject a one-role assign (`SearchableSelect`, sentinel `__none__` = "No role (default admin)") + a "Configure features" `SlideOver` (`maxWidth: 34rem`) with a three-way `[Inherit | Allow | Deny]` control per feature node + an optional free-text **reason** (committed on blur/Enter). Optimistic writes with toast + revert. Role chips already tone-mapped: super_admin purple, admin brand, project_manager info, task_handler teal, viewer neutral.
- APIs under `app/api/admin/permissions/`: `me`, `subjects` (team members with active roles, orgs, role catalogue - **no override counts, no scope, no avatars**), `assign-role` (ends all active `teamMemberRoles` rows, inserts at most one - one level role per member), `feature-visibility` (GET per subject; PUT upsert, `inherit` deletes the row). All guarded by `requireManagePermissions` (admin+). Guards: `lib/require-permission.ts` (`requireFeature`, `requireManagePermissions`), `lib/page-guard.ts` (**fail-open on resolver error**; only an explicit deny redirects).
- Schema (`db/schema.ts`): `roles` (system roles `super_admin` / `admin` / `project_manager` / `task_handler` / `viewer`, `isSystem` locked), `permissions` (~126 resource x action rows), `rolePermissions` (rich `scopeType`: all/own/team/specific_orgs/plan_type/track_type/status - **read by no runtime code except the `.view` baseline**), `teamMemberRoles` (time-bounded, many-per-member by design), `fieldRestrictions` (per-field hide - **inert**), `featureVisibility` (the live override table: `subjectType` role/team_member/organisation, unique per subject + featureKey, `reason`, `createdById`).
- `lib/access-scoping.ts` - `resolveAccessScoping(db, userId)` reads `teamMemberAccess` + `teamMemberAccessOrgs` and returns `null` (unrestricted) or an org-id allowlist (empty = deny all). This is the **only row-level data scoping actually enforced**, wired into ~30 `/api/admin/*` routes. It keys off the legacy `teamMembers.role` string ('admin' bypasses), not the resolver's levels. The editing UI today is the "Access rules" slide-over on `/team` (`AccessPanel` in `team-content.tsx`, writing `PUT /api/admin/team/[id]/access`), disconnected from the permissions builder.
- Migration `0078` seeds Liam + Staci as `super_admin` (deterministic ids, idempotent), so flipping defaults can never lock the owners out.
- Impersonation ("Client view", super-admin only, `tahi-impersonate-org` cookie, portal GETs only, server-enforced read-only) already exists; `settings/audit` exists as an audit-log viewer shell, but **nothing writes permission changes to `auditLog` today**.

## The two axes (the key mental model)

Permissions are two orthogonal things, both required, and conflating them is the main source of confusion:

1. **Feature visibility** (page / tab / card): can you *see and open* this surface. Resolved by `decideFeature` + `feature_visibility`. v1, shipped.
2. **Data scope** (which rows): of the surfaces you can open, *which records* you get. Resolved by `access-scoping.ts` + `teamMemberAccess` (all clients / by plan / specific clients). v1, shipped but parallel.

A teammate can have a feature visible yet see zero rows (scope denies all), or vice versa. The redesign must present these as one coherent story - one detail panel per person showing role, scope, and overrides together - even though they are two systems underneath. The design never invents a third axis; it makes the two legible.

## Page purpose

Let the owner say, for any person or client org, exactly what they can see, why, and how much, down to a tab or a card, and trust that the answer is enforced on the server. Make least-privilege the easy default, make every grant explainable ("why can X see Y" always has a written answer), and make the whole access model auditable at a glance from one pane inside Settings.

## Why we are on this page

This surface is opened rarely and matters enormously. The owner arrives here at three moments: the day before a contractor starts ("give them exactly their two clients and nothing financial"), the day something looks wrong ("why can this person see Financial reports?"), and the day a client asks for less ("hide invoices from our marketing person's portal"). Each visit is short, high-stakes, and slightly anxious - a wrong toggle either leaks the studio's finances or breaks someone's morning. The design's job is to replace that anxiety with legibility: every subject shows its whole truth on one screen (role, scope, overrides, history), every change is one deliberate control with a written why, and nothing here can silently lie because the server enforces what the pane displays.

It is also the foundation the rest of the redesign stands on. 04's nav visibility, 06's role-aware home, 07's request board, 08's fail-closed My Work, and 09's server-gated settings sections all assume the decisions made here. Deny-by-default is decided in this document and consumed downstream.

**The single experiential throughline, which every element must serve or be cut:**

> Every door in the studio is deliberate - each grant has a name, a reason, and a record.

## Personas and jobs-to-be-done

**1. The owner as architect (super_admin: Liam / Staci).** Setting up access before a person needs it.
- *Mindset:* deliberate, slightly wary; touching the one surface where a mistake has teeth.
- *JTBD:* "Grant exactly the right access to each teammate and client, see at a glance who can do what, preview it before it goes live, and never lock myself out."
- *Must see:* the whole truth per subject on one screen (role + scope + overrides + recent changes), a live "will see N clients" count, the lockout guard, a safe preview.
- *Must feel:* in control and un-lockout-able. Like signing a considered document, not flipping breakers in the dark.

**2. The owner as auditor (the same person, six months later).** Answering "why can X see Y?"
- *Mindset:* investigative, low patience for archaeology.
- *JTBD:* "Show me who changed what, when, and the reason they wrote down at the time."
- *Must see:* the change history (When / Who / Change / Target / Reason), the reason echoed on the override itself, the override-count badge that flags subjects with exceptions.
- *Must feel:* that the system kept the receipts.

**3. The scoped teammate (team_member).** Tahi is two people today; this persona is the first contractor or hire, and the surface is built ahead of them.
- *Mindset:* lives inside their grant; never opens this pane.
- *JTBD:* "See my work and the clients I am on, without tools or clients that are not mine, and understand why if something is hidden."
- *Must see:* nothing here (the pane is admin+ only); they experience its output as a complete-feeling nav (04) and a fail-closed My Work (08).
- *Must feel:* that their scoped view was built for them, never that rows were hidden from them.

**4. The client (client).** Never manages permissions.
- *Mindset:* unaware this surface exists, and that is the point.
- *JTBD (implicit):* "Only ever see my own organisation's client-safe world."
- *Must see:* a portal where a denied feature is simply absent - no locked rows, no upgrade nags.
- *Must feel:* nothing. The model serves them by being airtight and invisible.

## What others do (and what we take)

- **Linear** - a tiny workspace role set (Admin / Member / Guest, Owner on Enterprise) with scoping layered on top; Guests are team-restricted. Lesson: keep top-level roles few; push granularity into scoping, not role proliferation. We keep four levels.
- **Slack** - workspace roles separate from per-channel permissions; Single/Multi-Channel Guests + Shared Channels are the canonical agency-to-client external pattern. This is exactly our per-org client gating.
- **Notion** - inheritance-with-override: sensible defaults cascade, overrides are the exception. This is our `inherit/allow/deny` + ancestor cascade, validated.
- **Figma** - an IAM-style permissions DSL (action, effect, resource, optional condition), composable and non-hierarchical. Points to our eventual per-action / conditional (ABAC) layer - explicitly v2, never implied by v1 UI.
- **GitHub** - ~5 built-in fine-grained roles plus enterprise-authored custom roles from a catalogue. Mirrors our system roles + custom roles.
- **Vanta / Stytch** - roles as named bundles of permission sets organized by product area, each area set independently. We borrow the **matrix-by-product-area** read view, grouped by the 04 nav groups.
- **RBAC best practice (Oso, Frontegg)** - implicit deny; a roles x permissions matrix as the canonical edit/audit surface; least privilege; and **audit-log every permission change**. "Preview as role" is recommended though rarely shipped - an easy win for us given impersonation already exists and is server-enforced read-only.

## Experience principles

1. **Deny by default for team data, on by default for client-safe features.** A new teammate sees nothing until granted; a client sees their client-safe world until something is turned off. Consequence: the "No role" state must read as "no access", never as a silent admin grant (open decision 3).
2. **Every grant has a why.** The free-text reason on each override is first-class and echoed in the change history. Consequence: the reason field is revealed the moment Allow or Deny is chosen, never buried behind a second click.
3. **Inherit is the resting state.** Most nodes stay Inherit; allow/deny are the deliberate exceptions. Consequence: Inherit renders visually quiet (neutral fill) while Allow and Deny carry the only colour on the row, so a subject's exceptions are scannable in one pass.
4. **Visibility is not authorization.** The UI hides denied surfaces, but the server is the gate. Consequence: no copy anywhere implies that a toggle here is the security boundary; the spec treats client-side gating as courtesy.
5. **Preview before you commit, safely.** The owner can view the app as a role or client before trusting a change, building on impersonation. The client lens is read-only at the server (every portal write rejects an impersonating session), so preview-as is a lens, not a session you can act in. Consequence: the preview bar reuses 04's banner pattern exactly, with an always-visible exit.
6. **One coherent story over two systems.** Feature visibility and data scope are presented together per subject, even though they persist separately (`feature_visibility` vs `teamMemberAccess`). Consequence: the team-member detail shows Role, Data scope, and Feature overrides as three ledger-labelled blocks in one column, one scroll, no second page.
7. **Reading is free, writing is deliberate.** The list, detail, matrix, and history are all read-first; every write is a distinct control with instant optimistic feedback and a toast. Consequence: nothing edits on hover, nothing saves without a visible state change.

## Anatomy

The Team & access content pane, top to bottom (09 renders the settings frame and the bare-ink section title "Team & access" above all of this):

1. **Subject switcher row** - a three-tab segmented control (Team members / Clients / Roles) left, a search input right, and a quiet "Change history" text link at the far right.
2. **Subject list** (left column, Team members and Clients tabs) - avatar rows with role/plan chip, "Sees N clients" micro-line, and an override-count ledger badge; selectable.
3. **Subject detail** (right column) - identity header, role assignment, data-scope control with live count, feature-overrides summary + "Configure features", change-history teaser.
4. **Roles matrix** (Roles tab, replaces the master-detail) - sticky-first-column features x roles grid, read-first, click-to-edit.
5. **Feature slide-over** (overlay) - the per-subject three-way editor with reasons and cascade locks.
6. **Preview-as bar** (overlay strip) - the read-only lens over the live app, reusing 04's banner.
7. **Change history** (view) - the audit table: When / Who / Change / Target / Reason.

## Layout and composition - desktop

The pane fills the settings content area to the right of 09's sub-nav (~14rem). Pane max width **64rem**, on the cream canvas, hairlines over cards throughout. The master-detail split: subject list **20rem** fixed, **1.5rem** gutter, detail fills the remainder (min 32rem). Vertical order: switcher row (2.75rem controls), 1.5rem gap, then list + detail side by side.

```
| 09 sub-nav | Team & access                                  (bare ink, owned by 09) |
| (14rem)    |                                                                        |
| Account    | [ Team members | Clients | Roles ]   [ Search people    ] Change history
| Workspace  |                                                                        |
| Intake &   | +-- SUBJECT LIST (20rem) --+ 1.5rem +-- DETAIL (fills, min 32rem) ---+ |
|  boards    | | (o) Liam Miller  [Super ]|        | (oo) Alex Rivera   [Task     ] | |
| Sales &    | |     Sees all clients     |        |      alex@example.com handler ] | |
|  pipeline  | | (o) Staci Bonnie [Super ]|        |                                | |
| Automations| |     Sees all clients     |        | ROLE                           | |
|>Team &     | |+------------------------+|        | [ Task handler             v ] | |
|  access   <| || (o) Alex Rivera [Task ]||        |                                | |
| Billing    | ||     Sees 2 clients  (3)|| <- sel | DATA SCOPE                     | |
| Advanced   | |+------------------------+|        | [ All clients | By plan | Spe- | |
|            | |                          |        |   cific clients ]              | |
|            | |                          |        | Will see 2 of 14 clients       | |
|            | |                          |        |                                | |
|            | |                          |        | FEATURE OVERRIDES          (3) | |
|            | |                          |        | Financial reports - denied     | |
|            | |                          |        | Time - denied                  | |
|            | |                          |        | Requests bulk actions - allowed| |
|            | |                          |        | [ Configure features ]         | |
|            | |                          |        |                                | |
|            | |                          |        | CHANGE HISTORY        View all | |
|            | |                          |        | 12 Jun - Liam denied Financial | |
|            | |                          |        |   reports - "contractor"       | |
|            | +--------------------------+        +--------------------------------+ |
```

(Alex Rivera is an **example subject** for mocks only: the real workspace has exactly two team members, Liam Miller and Staci Bonnie, both Super admin. Never invent additional real staff; label sample rows as examples.)

- The feature slide-over overlays from the right at **34rem** wide, full height, dimmed backdrop, above the whole shell.
- The Roles tab swaps the master-detail for the full-width matrix (below).
- Ledger labels (ROLE, DATA SCOPE, FEATURE OVERRIDES, CHANGE HISTORY): `--text-2xs`, weight 600, uppercase, letter-spacing 0.08em, `--color-text-subtle`, with `1rem` space above each block and `0.5rem` below the label.
- No hero figure competes here: the pane's one large element is the selected subject's name in the identity header. At most one border-trace and zero leaf radii outside the primary CTA and avatar wrappers.

Roles matrix (Roles tab, read-first; A = allow, D = deny, . = level default, * = override dot):

```
| FEATURE (16rem, sticky)   | Super adm | Admin   | Proj mgr | Task hnd | Viewer  |
| WORKSPACE                 |  (group header row, sand fill, spans all columns)   |
|  Overview                 |    A      |   A     |    A     |    A     |   A     |
|  Requests                 |    A      |   A     |    A     |    A     |   A     |
|    Requests board         |    A      |   A     |    A     |    A     |   A     |
|    Requests bulk actions  |    A      |   A     |    A     |    D     |   D     |
|  Tasks                    |    A      |   A     |    A     |    A     |   D     |
| FINANCE                   |                                                     |
|  Invoices                 |    A      |   A     |    A     |    D     |   D     |
|  Financial reports        |    A      |   A     |    D *   |    D     |   D     |
```

## Layout and composition - mobile

At 375px (23.4375rem) the master-detail becomes a two-screen push. Stacking order: section title (09), switcher (horizontally scrollable segmented, no wrap), search input full-width below it, "Change history" as a full-width quiet row beneath the search, then the subject list full-width. Tapping a row pushes the detail full-width with a back affordance; "Configure features" opens the slide-over as a full-screen sheet. The matrix scrolls horizontally with the feature column sticky at **11rem**; role columns stay 7.5rem. All rows and controls >= 44px tall; no horizontal scroll except inside the matrix scroller.

```
+---------------------------+     +---------------------------+
| Team & access             |     | <- Back                   |
| [Team members|Clients|Ro> |     | (oo) Alex Rivera          |
| [ Search people         ] |     |      alex@example.com     |
| Change history          > |     | [Task handler]            |
+---------------------------+     | ROLE                      |
| (o) Liam Miller   [Super] |     | [ Task handler        v ] |
|     Sees all clients      |     | DATA SCOPE                |
| (o) Staci Bonnie  [Super] |     | [All|By plan|Specific]    |
|     Sees all clients      |     | Will see 2 of 14 clients  |
| (o) Alex Rivera   [Task ] |     | FEATURE OVERRIDES     (3) |
|     Sees 2 clients    (3) |     | [ Configure features ]    |
+---------------------------+     | CHANGE HISTORY   View all |
   rows 3.5rem, 44px+ touch       +---------------------------+
```

- The three-way control inside the full-screen sheet grows to 2.75rem-tall segments (44px) and sits below the feature description instead of beside it.
- The preview-as / impersonation strip renders above the content exactly as 04 specs it on mobile.
- The change-history table collapses to stacked two-line rows: line 1 = Change (ink) + When (right-aligned, subtle); line 2 = Who + Target + Reason in muted micro-text.

## Component spec

**Subject switcher (segmented control)**
- Purpose: choose the subject class (people, client orgs, roles).
- Anatomy: container with `0.25rem` padding, three tabs in order Team members / Clients / Roles; each tab 2.25rem min-height, `0 0.75rem` padding, icon 0.875rem (Users / Building2 / Shield from Lucide) + label `--text-sm` weight 500 (600 active).
- Tokens: container `--color-bg-secondary` fill, 1px `--color-border-subtle` hairline (all sides), `--radius-md`. Active tab: `--color-bg` fill, 1px `--color-border` hairline, `--radius-sm`, ink text, icon in `--color-brand`. Inactive: transparent, `--color-text-muted`.
- States: rest / hover (inactive tab fills `--color-bg-tertiary`, text lifts to ink) / focus-visible (2px `--color-brand-dark` ring) / active. Roles are `role="tablist"` tabs with arrow-key movement.

**Search input**
- Purpose: filter the visible list (people, clients) or matrix rows (features).
- Anatomy: 16rem wide (100% on mobile), 2.25rem tall, leading 0.875rem search glyph, placeholder per tab.
- Tokens: `--color-bg` fill, 1px `--color-border-strong` hairline, `--radius-md`, text `--text-sm` ink; focus = `--color-brand` border + 2px `--color-brand-100` ring.
- States: rest / focus / filled (shows a 1.5rem clear button, named "Clear search") / no matches (list shows the no-matches line).

**Change history link**
- A quiet text link, `--text-sm` weight 500, `--color-link`, right-aligned in the switcher row; hover underline, focus ring. Opens the change-history view in the pane.

**Subject row (list)**
- Purpose: one person or client org; the entry point to their detail.
- Anatomy (left to right, 3.5rem tall, `0.625rem 1rem` padding, hairline divider between rows): a **2rem circle avatar** (initials, never leaf), then a two-line text block: line 1 = name in `--text-base` weight 600 ink + a role chip (people) or plan chip (clients) beside it; line 2 = the scope micro-line ("Sees all clients" / "Sees 2 clients" / "Sees no clients") in `--text-2xs` `--color-text-subtle`. Right-aligned: an **override-count ledger badge** - the count in tabular figures, `--text-2xs` weight 600, `0.125rem 0.5rem` padding, `--color-bg-secondary` fill + 1px `--color-border-subtle` + `--radius-sm`; hidden at zero.
- Sort order: Team members tab ranks Super admin, then Admin, then other roles A-Z by role label, then "No role" last; A-Z by name within each rank. Clients tab: A-Z by organisation name. (Roles have no list; the tab is the matrix.)
- Tokens: avatar `--color-brand-50` fill + `--color-brand-dark` initials; chips per the chip spec below.
- States: rest / hover (`--color-bg-secondary` row fill) / focus-visible ring / **selected** (`--color-brand-50` tint + 1px `--color-border` hairline on all four sides + `--radius-md`, `aria-current="true"`) / loading (skeleton rows: two pulsing bars 40% and 55% wide) / empty (per copy deck).

**Role / plan chip**
- Quiet pill: `--text-2xs` weight 600, `0.125rem 0.5rem`, `--radius-sm`, tinted fill + 1px matching hairline. Role tones as built: Super admin purple, Admin brand, Project manager info, Task handler teal, Viewer neutral; "No role" is outline-only neutral. Plan chips (clients) use the org `planType` label (Maintain / Scale / Tune / Launch / Hourly / Custom) in neutral tint. Colour is never the only signal; the label is always present.

**Identity header (detail)**
- Anatomy: 2.5rem circle avatar, name `--text-lg` weight 600 ink, role or plan chip beside the name, email (people) or "Client portal access" (orgs) in `--text-xs` `--color-text-muted` beneath. Right-aligned: "Preview as <name>" (people) or "View portal as <client>" (orgs) as a secondary button.
- A single hairline divider (full-width rule element, not a one-sided border) separates the header from the blocks below, `1.25rem` clear on both sides.

**Role assignment control (team member detail)**
- Purpose: set the one level role.
- Anatomy: ledger label "ROLE", then a `SearchableSelect` 2.5rem tall, full block width (max 22rem): current role label + chevron; open panel lists "No role (no access)" first, then the role catalogue, each with its description as `--text-xs` subtitle.
- Tokens: input construction per theme (white fill, `--color-border-strong` hairline, `--radius-md`; focus brand ring).
- States: rest / open / optimistic (chip updates instantly, toast "Alex Rivera set to Task handler") / failure (toast "Could not update role", value reverts) / guarded (choosing a role that removes your own manage rights is blocked with the lockout line).

**Data-scope control (team member detail)**
- Purpose: which client rows this person's queries return (`teamMemberAccess`).
- Anatomy: ledger label "DATA SCOPE", then a three-segment control [All clients | By plan | Specific clients] built exactly like the subject switcher (2.25rem segments). Below it, conditionally: By plan reveals a plan multiselect (2.5rem, placeholder "Choose plans"); Specific clients reveals a client multiselect (2.5rem, placeholder "Choose clients", selected orgs as removable chips). Beneath everything, the live count line in `--text-sm` `--color-text-muted`: "Will see all clients" / "Will see 2 of 14 clients", with the numbers in tabular figures.
- States: rest / segment change (reveal animates, see Motion) / **zero-clients warning** (count hits 0: an inline strip on `--color-warning-bg` `#fff7ed` with 1px `--color-border` hairline on all sides, `--radius-md`, a 1rem warning glyph + "This teammate will see no clients." in ink; not a toast, it persists until resolved) / saving / failure-revert.

**Feature-overrides summary (detail)**
- Purpose: the subject's exceptions at a glance without opening the editor.
- Anatomy: ledger label "FEATURE OVERRIDES" + the count badge right-aligned; then up to three summary lines, each `--text-sm`: feature label in weight 500 ink, then "- denied" or "- allowed" in `--color-text-muted` (e.g. "Financial reports - denied"); a fourth line "+2 more" if over three; then the secondary button "Configure features" (2.25rem, hairline border, `--radius-md`, hover `--color-bg-secondary` fill).
- States: zero overrides ("No overrides - inherits the Task handler defaults." in muted text) / some / error (retry line).

**Feature slide-over**
- Purpose: the per-subject three-way editor. One component serves team members (27 top-level features), client orgs (10), and roles (27).
- Anatomy: right-anchored panel, **34rem** wide (100% width full-screen sheet on mobile), full height, on `--color-bg` with a 1px `--color-border` hairline and `--shadow-floating`; dimmed backdrop. Header (4rem): 2.25rem icon wrapper in `--radius-leaf-sm` with a sliders glyph, subject name `--text-md` 600, subtitle "Team member - 27 features" in `--text-xs` muted, close button (2.25rem, named "Close"). Then a legend strip (`--color-bg-secondary` fill, 1px `--color-border-subtle`, `--radius-md`, `0.75rem 1rem` padding): bold line + explainer per copy deck. Body scrolls; footer (3.5rem): "Changes save automatically" left in `--text-xs` muted, "Done" secondary button right.
- Group row (top-level node): `0.75rem 0` padding, label `--text-sm` 600 ink, `description` from FEATURE_TREE as `--text-xs` muted beneath, three-way control right-aligned; a full-width hairline rule below each group block.
- Leaf row (child node, e.g. Requests board under Requests): indented **1.75rem**, `0.5rem 0` padding, label `--text-xs` 600, description `--text-2xs` muted, same control; no rule between leaves. Indentation is spacing only - never a left rail or one-sided border.
- States: loading (five skeleton rows) / loaded / error ("Could not load access" + reopen hint) / empty audience.

**Three-way control [Inherit | Allow | Deny]**
- Purpose: the single write primitive of the whole system.
- Anatomy: a segmented group, container `0.1875rem` padding and `0.1875rem` gaps, `--color-bg-secondary` fill, 1px `--color-border-subtle` hairline, `--radius-md`. Three segments, each **1.875rem** min-height (2.75rem on mobile), `0 0.625rem` padding, `--text-xs`, `--radius-sm`; total control ~2.25rem tall, ~11rem wide desktop.
- Tokens per state: Inherit active = `--color-bg-tertiary` fill + ink text; **Allow active = `--color-brand-dark` `#425F39` fill + white text** (not `--color-brand` - white on `#5A824E` is ~4.0:1 and fails AA at this size; mirrors the 01-auth correction); Deny active = `--color-danger` `#dc2626` fill + white text (~4.6:1, passes). Inactive segments: transparent, `--color-text-muted`, hover `--color-bg-tertiary` + ink.
- Semantics: `role="radiogroup"` named "Access for <feature label>", three radios, arrow keys move, visible focus ring on the focused segment. State is conveyed by the always-present label plus fill, never colour alone.
- States: rest / hover / focus / active per segment / **optimistic** (selection applies instantly; toast "Saved: allowed" / "Saved: denied" / "Saved: inheriting default") / failure (segment snaps back, toast "Could not save change") / **disabled-cascaded** (see next).

**Cascade-locked child row**
- When a parent is denied (e.g. Requests denied), each child row (Requests board, Requests bulk actions) renders its control disabled with Deny visually active at 50% opacity, plus a micro-line under the label: "Denied by a parent feature." in `--text-2xs` `--color-text-subtle`. The disabled control keeps its accessible name and adds `aria-disabled="true"` with the micro-line as its description. Re-allowing the parent restores the children to their own saved states.

**Reason field**
- Revealed beneath a row the moment its control leaves Inherit. Full row width, 2.25rem tall, `--text-xs`, white fill, 1px `--color-border-subtle`, `--radius-md`; placeholder "Why? (shown in the change history)"; labelled "Reason for <feature label> override". Commits on blur or Enter (toast "Reason saved" / "Could not save reason"). Setting the control back to Inherit clears and hides it.

**Roles matrix (Roles tab)**
- Purpose: the at-a-glance audit of every role baseline; read-first, click-to-edit.
- Anatomy: a real `<table>` inside a horizontal scroller. Sticky first column **16rem** ("Feature"); role columns **7.5rem** fixed, in hierarchy order: Super admin, Admin, Project manager, Task handler, Viewer, then custom roles A-Z. Header row sticky, sand `--color-th-bg` fill, ledger-label type. Feature rows 2.5rem, grouped under full-width group header rows (WORKSPACE, SALES, CLIENTS, MARKETING, FINANCE, OPERATIONS, KNOWLEDGE, SETTINGS - the 04 nav groups; this grouping is presentation-only over the flat FEATURE_TREE), each a sand-filled row spanning all columns. Child features indent 1.25rem under their parent row. Client-only nodes (Files, Services, Tracks) do not appear (team audience).
- Cell marks (0.875rem glyphs, centered): check in `--color-brand-dark` = allowed; cross in `--color-danger` = hidden; a small dash in `--color-text-subtle` = level default (feature not gated by the role baseline). A **0.375rem brand dot** in the cell's top-right corner marks a `feature_visibility` override on that role; its reason surfaces in the cell tooltip.
- The Super admin column renders its checks at 40% opacity with a lock glyph in the header and is not editable (super_admin always allows).
- Interaction: every editable cell is a button named "<Feature> for <Role>: <state>. Edit"; click opens a small popover (anchored, `--color-bg`, hairline, `--shadow-floating`, `--radius-md`) containing the same three-way control + reason field; Esc closes, focus returns. Clicking a role column header opens that role's feature slide-over.
- A legend row sits above the table: the three glyphs + "Allowed", "Hidden", "Default", and the dot + "Override".
- States: loading skeleton grid / loaded / cell saving (optimistic mark swap) / failure revert / empty ("No roles defined" per copy deck).

**Preview-as bar**
- Purpose: the safe lens. Reuses 04's impersonation banner pattern exactly: a thin sticky strip, status-info tone (not alarming), above the content.
- Anatomy: 2.5rem strip, `--color-info-bg` `#eff6ff` fill with 1px `--color-border` hairline (all sides), text `--text-sm` ink: "Previewing as Alex Rivera, read-only" (role lens) or 04's "Viewing Physitrack, read-only" (client lens), with an "Exit preview" / "Exit" text button right-aligned (44px touch).
- Behaviour: entering swaps the app to the subject's resolved view; the lens is server-enforced read-only, so write affordances render disabled with 04's tooltip "Read-only while viewing as a client." Exiting returns to Settings > Team & access with the subject still selected.

**Change-history table**
- Purpose: the receipts. Every role assignment and feature-visibility edit, newest first.
- Anatomy: a full-width table under the same switcher row. Columns: **When** (9rem, e.g. "12 Jun, 3:42 pm", tabular figures) / **Who** (11rem, 1.5rem avatar + first name) / **Change** (flexible, e.g. "Denied Financial reports", "Set role to Task handler", "Scope set to Specific clients (2)") / **Target** (12rem, subject name + a 2xs type line "Team member" / "Client" / "Role") / **Reason** (flexible, muted; a dash when empty). Header row sand `--color-th-bg` with ledger labels; body rows 2.75rem with hairline dividers; hover `--color-row-hover`.
- States: loading / populated / empty ("No changes yet." + one muted line) / end-of-list ("Showing the last 100 changes.").

**Toast**
- Per the app-wide pattern: bottom-right, `--color-bg` panel, hairline, `--shadow-floating`, `--radius-md`, `--text-sm`; success shows a brand check, error a danger cross; auto-dismisses at 4s; `role="status"` (success) / `role="alert"` (error).

## Motion and dynamism

Calm, singular, all on `--ease-out` `cubic-bezier(.22,1,.36,1)`; no bounce, no spring.

- **Slide-over:** panel translates in from the right (100% -> 0) over `240ms`; backdrop fades over `150ms`. Close reverses. Mobile sheet slides up over `240ms`.
- **Segmented state change** (switcher, scope, three-way): fill and text colour transition over `110ms` (`--motion-quick`). The optimistic mark applies immediately; motion is decoration, never a wait.
- **Reason field reveal:** height + opacity over `200ms` (`--motion-base`); collapse reverses on return to Inherit.
- **Scope picker reveal** (By plan / Specific clients): same `200ms` height + fade.
- **Row selection:** tint fades in over `110ms`; the detail column content cross-fades over `150ms` (no slide).
- **Matrix cell popover:** fades in and rises `0.25rem` over `150ms`.
- **Toast:** rises `0.5rem` + fades over `200ms`.
- **Cascade lock:** when a parent flips to Deny, its children dim to the locked state over `200ms` so the cause-and-effect is visible once; hover-triggered animations (none are load-bearing here) always play to completion, never reverse mid-way.
- **`prefers-reduced-motion: reduce`:** every transition above becomes an instant state change (panel appears in place, reveals snap, popovers appear); nothing is lost but the easing.

## Accessibility (WCAG 2.2 AA)

- **Landmarks and structure:** the pane lives in 04's `<main>`; the section title "Team & access" is the page `<h2>` under the shell's route `<h1>` handling; list, detail, matrix, and history are labelled regions. The matrix and history are real `<table>`s with `scope="col"` / `scope="row"` headers.
- **Switcher:** `role="tablist"` with `aria-selected`, arrow-key movement, and the active tab controlling a named `tabpanel`.
- **Subject list:** an option-list pattern - Up/Down moves, Enter selects, `aria-current` on the selected row; every row is a single 44px+ target on mobile.
- **Three-way control:** `role="radiogroup"` per feature, radios labelled Inherit / Allow / Deny, arrow-key operable, visible 2px focus ring; state is text + fill, never colour alone. Cascade-locked children are `aria-disabled` with "Denied by a parent feature." wired via `aria-describedby`.
- **Slide-over:** `role="dialog" aria-modal="true"`, labelled by the subject name; focus moves to the header on open, is trapped, Esc closes, focus returns to "Configure features". Same for the matrix cell popover.
- **Contrast:** Allow-active uses `--color-brand-dark` on white text (~5.6:1); Deny-active `#dc2626` on white (~4.6:1); ledger labels `--color-text-subtle` `#63615B` clears 4.5:1 on cream and white; warning strip text is ink on `#fff7ed`, never orange-on-orange. Focus rings >= 2px and >= 3:1 against their surface (`--color-brand-dark` on light surfaces).
- **Announcements:** optimistic saves announce via the toast (`role="status"`); failures use `role="alert"`; the live scope count line is `aria-live="polite"` so "Will see 2 of 14 clients" is heard as it changes; the zero-clients warning is `role="status"` and persistent.
- **Target size (2.5.8):** all mobile rows, segments, chips-with-remove, and the Exit button >= 44px; desktop floor 24px everywhere (the override badge is display-only, not a target).
- **Keyboard path (2.4.3, 2.1.2):** switcher -> search -> Change history -> list -> detail controls in visual order; no traps; the matrix supports cell-by-cell arrow navigation as an enhancement with Tab reaching every editable cell regardless.
- **Reduced motion (2.3.3):** per the Motion section, full instant-state fallback.

## States and flows

- **Subject with no overrides** (all Inherit): summary reads "No overrides - inherits the <Role> defaults."; badge hidden.
- **Subject with a denied parent:** children cascade-denied, shown but locked ("Denied by a parent feature."), restored when the parent is re-allowed.
- **Assigning / changing a role:** optimistic chip + toast; the detail's scope and overrides blocks stay put (they are independent axes).
- **Ending a role** ("No role (no access)"): the list chip flips to outline "No role"; under decision 3 the scope line becomes "Sees no clients" until granted.
- **Setting data scope to Specific clients then narrowing to zero:** the persistent warning strip "This teammate will see no clients." appears; saving is allowed (it is a valid deny-all state) but never silent.
- **Preview-as enter / exit:** bar appears over the previewed app; write controls disabled with tooltip; exit returns to the pane with selection intact.
- **Optimistic write, reconcile, failure:** every write applies instantly, toasts on confirm, snaps back + error toast on failure.
- **Owner attempting to deny themselves manage-permissions** (or assign themselves out of admin): blocked before the request with "You cannot remove your own ability to manage permissions." Super admin can never be locked out.
- **Loading:** list and detail show pulsing skeletons (rows: two bars 40% / 55%; detail: block-shaped placeholders); the matrix a skeleton grid.
- **Errors:** subjects fetch failure shows the empty-state card with Retry; slide-over fetch failure shows its inline error.
- **Empty tabs:** no team members / no clients / no roles, per copy deck.
- **Search:** live filter; no hits shows "No matches for '<query>'." with a clear-search affordance.
- **Change history:** populated / empty / end-of-list.
- **Dark mode:** every surface re-tokens (`--color-bg-dark` family); the chips, marks, and warning strip keep their meaning-tints with AA re-checked; the forest rail (04) is unchanged.

## Copy deck

Calm, plain NZ voice. Hyphens only.

- Section title (09 renders it): `Team & access`
- Tabs: `Team members` / `Clients` / `Roles`
- Search placeholders: `Search people` (Team members) / `Search clients` (Clients) / `Search features` (Roles)
- Link: `Change history`
- Scope micro-lines: `Sees all clients` / `Sees 2 clients` / `Sees no clients`
- Override badge: the count only, e.g. `3` (tooltip: `3 feature overrides`)
- Role labels: `Super admin`, `Admin`, `Project manager`, `Task handler`, `Viewer`; chip for none: `No role`
- Role select: `No role (no access)` with subtitle `Sees nothing until granted` (today's build reads `No role (default admin)` - changes with open decision 3)
- Detail ledger labels: `ROLE` / `DATA SCOPE` / `FEATURE OVERRIDES` / `CHANGE HISTORY`
- Identity header sub-line (orgs): `Client portal access`
- Scope segments: `All clients` / `By plan` / `Specific clients`
- Scope pickers: `Choose plans` / `Choose clients`
- Scope count: `Will see all clients` / `Will see 2 of 14 clients`
- Zero-scope warning: `This teammate will see no clients.`
- Overrides summary lines: `Financial reports - denied` / `Requests bulk actions - allowed` / `+2 more` / `No overrides - inherits the Task handler defaults.`
- Buttons: `Configure features` / `Preview as Alex Rivera` / `View portal as Physitrack` / `View all` / `Done` / `Retry` / `Exit` / `Exit preview` / `Close` / `Clear search` / `Back`
- Slide-over subtitles: `Team member - 27 features` / `Client - 10 features` / `Role - 27 features`
- Slide-over legend: `Inherit uses the default for this level` + `Set Allow or Deny to override the default for just this subject. Denying a parent also hides its sub-features.`
- Three-way: `Inherit` / `Allow` / `Deny`
- Reason placeholder: `Why? (shown in the change history)`
- Cascade note: `Denied by a parent feature.`
- Slide-over footer: `Changes save automatically`
- Toasts: `Saved: allowed` / `Saved: denied` / `Saved: inheriting default` / `Could not save change` / `Reason saved` / `Could not save reason` / `Alex Rivera set to Task handler` / `Could not update role`
- Lockout guard: `You cannot remove your own ability to manage permissions.`
- Matrix legend: `Allowed` / `Hidden` / `Default` / `Override`; header first column: `Feature`; locked header tooltip: `Super admin always has every feature.`
- Matrix cell name pattern: `Requests for Task handler: allowed. Edit`
- Matrix group headers: `WORKSPACE` / `SALES` / `CLIENTS` / `MARKETING` / `FINANCE` / `OPERATIONS` / `KNOWLEDGE` / `SETTINGS`
- History headers: `When` / `Who` / `Change` / `Target` / `Reason`; empty cell dash: `-`
- History change strings: `Denied Financial reports` / `Allowed Requests bulk actions` / `Set role to Task handler` / `Cleared role` / `Scope set to Specific clients (2)` / `Scope set to All clients`
- History empty: `No changes yet.` + `Role and feature changes will appear here as they happen.`
- History footer: `Showing the last 100 changes.`
- Empty states: `No team members` + `Add team members first, then assign roles and feature access here.` / `No clients yet` + `Once you have client organisations, control their portal feature access here.` / `No roles defined` + `Roles let you set defaults that apply to every team member assigned to them.`
- Load error: `Could not load permissions` + `Something went wrong fetching team members, clients, and roles. Try again.`
- Slide-over error: `Could not load access` + `Try closing and reopening this panel.`
- Search empty: `No matches for 'query'.`
- Preview bars: `Previewing as Alex Rivera, read-only` / `Viewing Physitrack, read-only`; disabled-write tooltip (from 04): `Read-only while viewing as a client.`

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Pane canvas | `--color-bg-cream` (via the shell; never hardcoded) |
| Pane max width / list column / gutter | `64rem` / `20rem` / `1.5rem` |
| Ledger labels | `--text-2xs` 600 uppercase `0.08em` `--color-text-subtle` |
| Subject name / detail name | `--text-base` 600 / `--text-lg` 600 `--color-text` |
| Avatars | 2rem and 2.5rem circles, `--color-brand-50` fill + `--color-brand-dark` initials, `--radius-full` |
| Selected row | `--color-brand-50` tint + 1px `--color-border` (all sides) + `--radius-md` |
| Row hover / dividers | `--color-bg-secondary` / 1px `--color-border-subtle` hairlines |
| Chips and badges | `--radius-sm`, `--text-2xs` 600, tint + matching hairline; count badges `--color-bg-secondary` + `--color-border-subtle` |
| Inputs and selects | white fill, 1px `--color-border-strong`, `--radius-md`; focus `--color-brand` border + 2px `--color-brand-100` ring |
| Three-way container | `--color-bg-secondary` + 1px `--color-border-subtle` + `--radius-md`, `0.1875rem` padding/gap |
| Inherit active | `--color-bg-tertiary` fill + `--color-text` |
| Allow active | `--color-brand-dark` `#425F39` fill + white (NOT `--color-brand`, fails AA at `--text-xs`) |
| Deny active | `--color-danger` `#dc2626` fill + white |
| Cascade-locked | Deny state at 50% opacity + `--color-text-subtle` micro-line |
| Warning strip | `--color-warning-bg` `#fff7ed` fill + 1px `--color-border` + ink text |
| Preview bar | `--color-info-bg` `#eff6ff` fill + 1px `--color-border` + ink text |
| Slide-over | `--color-bg`, 1px `--color-border`, `--shadow-floating`, `34rem` wide |
| Slide-over header icon wrapper | `2.25rem`, `--radius-leaf-sm` (a permitted leaf: icon wrapper) |
| Matrix header / group rows | `--color-th-bg` sand fill, ledger-label type |
| Matrix marks | check `--color-brand-dark` / cross `--color-danger` / dash `--color-text-subtle`; override dot `0.375rem` `--color-brand` |
| Matrix columns / rows | first column `16rem` sticky (11rem mobile), role columns `7.5rem`, rows `2.5rem` |
| History table | header `--color-th-bg`, rows `2.75rem`, hover `--color-row-hover`, numbers/dates tabular right-normal |
| Primary CTA (the only leaf button) | brand fill, white text, `--radius-leaf-sm` (used only if a screen needs one primary action; this pane is mostly auto-save) |
| Motion | slide-over `240ms` / reveals `200ms` / segments `110ms` / popover `150ms`, all `--ease-out`; full reduced-motion fallback |
| Font | Manrope; body `--text-sm`/`--text-base`, controls `--text-xs`, no ledger display figure on this pane |

## Deliverables for Claude design

1. **Settings > Team & access, Team members tab** (desktop): master-detail with Liam Miller and Staci Bonnie (Super admin) plus one example contractor selected, showing role select, data scope on Specific clients with "Will see 2 of 14 clients", a 3-override summary, and the change-history teaser.
2. **Feature slide-over open** (team member): a mix of Inherit/Allow/Deny using real nodes (Requests + Requests board + Requests bulk actions, Financial reports denied with a reason filled, Time denied), including a denied-parent cascade with the locked children.
3. **Clients tab** with a client org selected (use Physitrack as the real example): plan chip, client-safe feature summary with Invoices denied, "View portal as" affordance; slide-over variant showing the 10 client features.
4. **Roles matrix** (Roles tab): all five system-role columns, grouped feature rows, locked Super admin column, one override dot, the legend, and one cell-edit popover open.
5. **Preview-as bar** over a sample page (both variants: role lens and client lens) with a disabled write control + tooltip.
6. **Change history** view: populated table with the real change-string patterns, plus the empty state.
7. **Mobile (375px):** list screen, detail screen (pushed, with Back), the full-screen feature sheet, and the matrix in its horizontal scroller.
8. **Dark mode** of screens 1, 2, and 4 minimum.
9. **State sheet:** three-way control in all states (rest/hover/focus/each active/disabled-cascaded), reason revealed, zero-client warning strip, optimistic-failure toast pair, lockout guard message, list skeleton, load-error card, search no-matches.

**Integration constraints:**
- Build on `lib/feature-tree.ts` + `lib/permissions.ts`; the builder edits `feature_visibility` (+ role assignment via `assign-role`) and `teamMemberAccess` (data scope). Do not invent a new model, new feature keys, or new role names; every feature row in a mock must be a real FEATURE_TREE node with its real `label` and `description`.
- Server is the gate: the design must never imply client-side hiding equals security, and a denied surface downstream is absent, never disabled (cross-doc contract 6).
- Keep the three-way + reason as the write primitive; add the matrix, preview-as, data scope, and change history around it. Reuse the existing `SlideOver`, `SearchableSelect`, `Badge`, `TahiButton`, `EmptyState`, and toast primitives - restyle, do not rebuild.
- The subjects API must grow to feed the list (override counts, scope summary, level rank for sorting); flag this to the implementer rather than mocking data the endpoint cannot yet return.
- The data-scope control replaces the `/team` "Access rules" slide-over as the canonical scope editor; `/team` links here.
- MCP parity (CLAUDE.md rule 14): existing tools `get_feature_visibility`, `set_feature_visibility`, `list_permission_subjects`, `assign_team_role`; any new capability (scope editing, history reads) extends the worker MCP server.
- Tokens only (no hardcoded hex outside the documented corrections); leaf radius only on the slide-over header icon wrapper and any primary CTA; hairlines all-sides or absent, never one-sided; 44px mobile targets; full reduced-motion support.

## Why this is premium

Permissions screens are where most products show their seams: a wall of checkboxes, a jargon matrix, and no answer to "why can this person see that?" This pane treats access like the studio treats contracts - deliberate, written down, and countersigned. One calm master-detail shows a person's whole truth in a single column (role, scope, exceptions, receipts); the only colour on the screen is the meaning (brand for allow, danger for deny, and nothing else); the reason field turns every exception into a sentence a future owner can read; and the change history makes the model auditable without a support ticket. The matrix gives the at-a-glance confidence of an enterprise IAM tool without its vocabulary, and preview-as closes the loop: the owner does not have to trust the toggles, they can look through the lens and see the truth, knowing the server makes the lens read-only. Restraint, receipts, and a map that never lies - that is what makes a two-person studio's access model feel like it was built by a security team.

## Open decisions and risks (resolve before/while building)

1. **Server enforcement gap (CONFIRMED by the 2026-06 security audit).** Most `/api/admin/*` routes check only `isTahiAdmin(orgId)` + `resolveAccessScoping`, not `requireFeature`. A denied teammate could still hit an API directly. The spec's stance: every data route must enforce the same feature + scope as the UI hides. This is the most important risk, and the audit verified it is live, so the builder must treat per-route enforcement as a hard requirement, not a nicety. (The portal side of this is already done: all client-facing routes now resolve and owner-bind the org via `getPortalAuth`; the gap is the admin/team-member side.)
2. **Two parallel systems** (feature_visibility vs teamMemberAccess; `teamMembers.role` vs `roles`/`teamMemberRoles`). Recommend `teamMemberRoles`/`roles` as canonical identity; have `access-scoping` read from it (today it keys off the legacy `teamMembers.role` string, so the two role systems can disagree for the same person). Present both axes as one story, which this design now does in the detail panel.
3. **Safe-default = admin (CONFIRMED issue: scoping fails OPEN).** A Tahi-org user with no `teamMembers` row resolves to full admin, and `resolveAccessScoping` returns "unrestricted" for them, so the audit confirmed a contractor added to the Tahi org with no row sees every client. Convenient default, but it is the opposite of least-privilege. The decision this spec now makes: **flip to deny-by-default** (a Tahi user with no explicit role/scope sees nothing until granted). Migration `0078` already seeds Liam and Staci as super_admin (deterministic ids, idempotent), so flipping the default can never lock the owners out. The copy deck's "No role (no access)" reflects the post-flip world; the current build's "No role (default admin)" label must change with it.
4. **No audit trail today** despite an `auditLog` table. The spec adds one (write on every assign-role + feature-visibility + scope change). Required for "why can X see Y". Deepening finding: `feature_visibility` rows carry `createdById` + `updatedAt`, so a partial v1 history is derivable, but `assign-role` records no actor and ended `teamMemberRoles` rows record no ender - the Who column needs new write paths, not just a read view.
5. **Inert expressive schema** (`rolePermissions.scopeType`, `fieldRestrictions`) implies capabilities the runtime does not honor. Label v1 (page/tab/card visibility + org scope) vs v2 (per-action via `permissions.action`, per-field via `fieldRestrictions`) clearly so we never imply more than we enforce. The matrix must not sprout per-action columns until v2 is real.
6. **One role per member** (assign-role ends active rows) contradicts the many-roles, time-bounded `teamMemberRoles` design. Pick one and state it. This design assumes **one level role per member** (the select, the chip, and the sort order all presume it); if many-roles ever ships, the list chip and matrix semantics need a revisit.
7. **Subjects API shape gap (new).** `/api/admin/permissions/subjects` returns only id/name/email/roles (people) and id/name (orgs) - no override counts, no scope summary, no plan type. The list design needs all three; extend the endpoint (one aggregate query per table) rather than firing per-row fetches.
8. **Matrix cell semantics (new).** A role column blends two layers: the `rolePermissions` `.view` baseline (the inherit default) and role-level `feature_visibility` overrides. The matrix must render the **effective** value with the override dot marking the exception, and a cell edit writes `feature_visibility` (subjectType `role`) only - baseline editing is v2. Without this rule the same cell could mean two different stores.
9. **Allow-segment contrast (new, design correction).** White text on `--color-brand` `#5A824E` is ~4.0:1 and fails AA at `--text-xs`; the active Allow segment (and any brand-filled mark at small sizes) must use `--color-brand-dark` `#425F39`, mirroring the 01-auth primary-button correction. The current build uses `--color-brand` and needs the swap.
10. **History source and retention (new).** Decide whether the change history reads a new `auditLog` write path (recommended, decision 4) or a dedicated permissions log; either way cap the v1 view at the last 100 changes with no filters, and defer search/filter until the volume demands it.
