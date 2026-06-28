# Roles and granular permissions - design brief

> Who sees what, why, and how much. This is the second foundation (after 04-app-shell):
> it decides the navigation a person sees, the surfaces they can open, and the rows
> a query returns. Owner can never be locked out; teammates are scoped; clients see
> only their own, client-safe world.

> Home: the permissions builder lives **inside Settings > Team & access** (see
> 09-settings.md), not as a top-level page. The old `/permissions` route redirects
> there. This brief specs the builder itself; 09 specs where it sits.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

A real, tested permissions engine is already live (migrations 0077/0078). This brief documents it, redesigns the management surface, and names the seams to close. It does not start from scratch.

- `lib/feature-tree.ts` - the single source of truth. `FEATURE_TREE` is a flat array of ~38 dotted-key `FeatureNode`s (`requests`, `requests.board`, `clients.billing_card`, `settings.permissions`), each with `label`, `description` (the "why", surfaced in the builder), `parent`, `appliesTo: ('team'|'client')[]`, optional `route`. Helpers: `featureAncestry` (leaf-first, so denying a parent cascades), `featurePages(audience)`, `featureKeyForRoute`.
- `lib/permissions.ts` - the resolver. `AccessLevel = 'super_admin' | 'admin' | 'team_member' | 'client'`; `Effect = 'allow' | 'deny'`. `decideFeature(access, key)` is **pure and unit-tested**: unknown key allow; wrong audience deny; super_admin always allow; explicit overrides walked leaf-first (own rule beats ancestor, denied ancestor cascades); then admin/client default allow; team_member gated by their role's `.view` baseline. `featureMap()` precomputes every key for the client; `resolvePermissions(drizzle, {userId, orgId})` loads from the DB (audience = team if `orgId === NEXT_PUBLIC_TAHI_ORG_ID`, else client).
- `components/tahi/permissions-context.tsx` - `PermissionsProvider` (fed server-side, no flash), `usePermissions()`, `useFeature(key)`, and `<Gate feature=... fallback>`. Client-side is **fail-open** (the comment says "server routes are the real gate").
- `app/(dashboard)/permissions/permissions-content.tsx` (~1080 lines) - the builder. Three tabs (Team members / Clients / Roles); per subject a one-role assign + a "Configure features" slide-over with a three-way `[Inherit | Allow | Deny]` control per feature node + an optional free-text **reason**. Optimistic writes.
- APIs under `app/api/admin/permissions/`: `me`, `subjects`, `assign-role`, `feature-visibility` (PUT upsert; `inherit` deletes the row). Guards: `lib/require-permission.ts`, `lib/page-guard.ts` (**fail-open on resolver error**; only an explicit deny redirects).
- Schema: `roles`, `permissions` (~126 resource x action rows), `rolePermissions` (rich `scopeType`: all/own/team/specific_orgs/plan_type/track_type/status - **read by no runtime code yet**), `teamMemberRoles` (time-bounded, many-per-member), `fieldRestrictions` (per-field hide - **inert**), `featureVisibility` (the live override table).
- `lib/access-scoping.ts` - `resolveAccessScoping(db, userId)` reads `teamMemberAccess` + `teamMemberAccessOrgs` and returns `null` (unrestricted) or an org-id allowlist (empty = deny all). This is the **only row-level data scoping actually enforced**, wired into ~30 `/api/admin/*` routes. It keys off the legacy `teamMembers.role` string, not the resolver's levels.
- Impersonation ("Client view", super-admin only) already exists.

## The two axes (key mental model)

Permissions are two orthogonal things, both required, and conflating them is the main source of confusion:

1. **Feature visibility** (page / tab / card): can you *see and open* this surface. Resolved by `decideFeature` + `feature_visibility`. v1, shipped.
2. **Data scope** (which rows): of the surfaces you can open, *which records* you get. Resolved by `access-scoping.ts` + `teamMemberAccess` (all clients / by plan / specific clients). v1, shipped but parallel.

A teammate can have a feature visible yet see zero rows (scope denies all), or vice versa. The redesign must present these as one coherent story even though they are two systems underneath.

## Page purpose

Let the owner say, for any person or client org, exactly what they can see, why, and how much, down to a tab or a card, and trust that the answer is enforced on the server. Make least-privilege the easy default and make every grant explainable.

## Why this is a foundation

It governs 04 (the nav), 06-08 (what each page shows and returns), and client trust (a client must never see another client, or any internal surface). Specifying it now means every later page can assume "the right person is looking at the right data" and lean on `<Gate>` + scoped queries rather than re-inventing access logic.

## Personas and jobs-to-be-done

- **Owner (super_admin).** Designs the access model. Job: "grant exactly the right access to each teammate and client, see at a glance who can do what, preview it before it goes live, and never lock myself out."
- **Teammate (team_member).** Lives inside their grant. Job: "see my work and the clients I am on, without tools or clients that are not mine, and understand why if something is hidden."
- **Client (client).** Never manages permissions. Job (implicit): "only ever see my own organisation's client-safe world." The model serves them by being airtight.

## What others do (and what we take)

- **Linear** - a tiny workspace role set (Admin / Member / Guest, Owner on Enterprise) with scoping layered on top; Guests are team-restricted. Lesson: keep top-level roles few; push granularity into scoping, not role proliferation. We keep four levels.
- **Slack** - workspace roles separate from per-channel permissions; Single/Multi-Channel Guests + Shared Channels are the canonical agency-to-client external pattern. This is exactly our per-org client gating.
- **Notion** - inheritance-with-override: sensible defaults cascade, overrides are the exception. This is our `inherit/allow/deny` + ancestor cascade, validated.
- **Figma** - an IAM-style permissions DSL (action, effect, resource, optional condition), composable and non-hierarchical. Points to our eventual per-action / conditional (ABAC) layer.
- **GitHub** - ~5 built-in fine-grained roles plus enterprise-authored custom roles from a catalogue. Mirrors our system roles + custom roles.
- **Vanta / Stytch** - roles as named bundles of permission sets organized by product area, each area set independently. We borrow the **matrix-by-product-area** read view.
- **RBAC best practice (Oso, Frontegg)** - implicit deny; a roles x permissions matrix as the canonical edit/audit surface; least privilege; and **audit-log every permission change**. "Preview as role" is recommended though rarely shipped, an easy win for us given impersonation already exists.

## Experience principles

1. **Deny by default for team data, on by default for client-safe features.** A new teammate sees nothing until granted; a client sees their client-safe world until something is turned off.
2. **Every grant has a why.** The free-text reason on each override is first-class and shown back in the audit view, so "why can X see Y" always has an answer.
3. **Inherit is the resting state.** Most nodes stay `Inherit`; allow/deny are the deliberate exceptions, visually distinct from the default.
4. **Visibility is not authorization.** The UI hides denied surfaces, but the server is the gate. The spec treats client-side gating as courtesy, never security.
5. **Preview before you commit, safely.** The owner can view the app as a given role or client before saving, building on impersonation. The client lens is now **read-only at the server** (every portal write rejects an impersonating session), so "View as" is a true safe preview that can never accidentally mutate a real client's data. Design preview-as to lean into that: it is a lens, not a session you can act in.
6. **One coherent story over two systems.** Feature visibility and data scope are presented together per subject, even though they persist separately.

## Anatomy of the management surface (Settings > Team & access)

- **Subject switcher:** three tabs - Team members, Clients, Roles - with search.
- **Per team member:** role assignment, the org **data-scope** control (all clients / by plan / specific clients, surfaced here rather than buried in /team/[id]/access), and the feature slide-over (three-way per node + reason).
- **Per client org:** the client-safe feature list, each `Inherit/Allow/Deny` (deny to hide), with the per-org reason.
- **Per role:** a roles x features **matrix** read view (the at-a-glance audit), editable baselines.
- **Preview as:** "View as <role>" / "View as <client>" launches the app in that lens (impersonation), with a clear exit.
- **Change history:** an audit trail of every role assignment and feature-visibility edit (who, what, target, when, reason), written to `auditLog`.

## Component spec

- **Three-way control** `[Inherit | Allow | Deny]`: a segmented control; Inherit is quiet/neutral, Allow is brand, Deny is danger-toned; selecting Allow/Deny reveals the reason field. Parent deny visibly cascades to children (children show "denied by parent").
- **Feature node row:** label + the node `description` (the why) as ledger sub-text + the control. Indented children under parents.
- **Matrix (roles x features):** rows = features (grouped), columns = roles; cells show allow/deny/inherit as small ledger marks; read-first, click a cell to edit the role baseline.
- **Data-scope control:** segmented all clients / by plan (plan picker) / specific clients (multiselect), with a live "this teammate will see N clients" count.
- **Preview-as bar:** a thin info strip ("Previewing as <subject>") with exit, reusing the impersonation banner pattern from 04.

## Motion, accessibility

- Slide-over and matrix transitions on the Studio Ledger ease; no bounce; respect reduced motion.
- The three-way control is keyboard operable with clear focus; state is conveyed by label + colour, never colour alone (Inherit/Allow/Deny text always present).
- Reason fields are proper labelled inputs; the matrix is a real table with header scope for screen readers.

## States and flows

- Subject with no overrides (all Inherit); subject with a denied parent (children cascade-denied, shown but locked).
- Assigning / changing a role; ending a role.
- Setting data scope to "specific clients" then narrowing the count to zero (warn: "this teammate will see no clients").
- Preview-as enter / exit.
- Optimistic write, reconcile, and failure (toast + revert).
- Owner attempting to deny themselves a manage-permissions capability (blocked: super_admin can never be locked out).

## Copy deck

- Controls: Inherit, Allow, Deny. Reason placeholder: "Why? (shown in the access log)".
- Scope: "All clients", "By plan", "Specific clients", "Sees N clients".
- Preview: "View as <name>", "Exit preview".
- Cascade note: "Denied by a parent feature." Lockout guard: "You cannot remove your own ability to manage permissions."

## Tokens and visual reference

- Allow = `--color-brand` family; Deny = `--color-danger` family (used only to signal, per Studio Ledger); Inherit = neutral ink. Matrix marks and badges are quiet ledger micro-type. The leaf radius appears only on the primary save CTA.

## Deliverables for Claude design

1. **Settings > Team & access, Team member** selected: role + data-scope + feature slide-over open with a mix of Inherit/Allow/Deny and a denied-parent cascade.
2. **Settings > Team & access, Client org** selected: client-safe features with one denied.
3. **Roles matrix** (roles x features) read view.
4. **Preview-as** bar over a sample page.
5. **Change history / audit** view.
6. **Mobile** (375px) of the builder.
7. **Dark mode** of all of the above.
8. **State sheet:** three-way control states, reason revealed, cascade-locked child, zero-client scope warning, optimistic-failure toast.

**Integration constraints:**
- Build on `lib/feature-tree.ts` + `lib/permissions.ts`; the builder edits `feature_visibility` (+ role baselines) and `teamMemberAccess` (data scope). Do not invent a new model.
- Server is the gate: design must not imply client-side hiding equals security.
- Keep the three-way + reason; add the matrix, preview-as, and audit.
- MCP parity (CLAUDE.md rule 14): existing tools `get_feature_visibility`, `set_feature_visibility`, `list_permission_subjects`, `assign_team_role`; any new capability extends the worker MCP server.

## Open decisions and risks (resolve before/while building)

1. **Server enforcement gap (CONFIRMED by the 2026-06 security audit).** Most `/api/admin/*` routes check only `isTahiAdmin(orgId)` + `resolveAccessScoping`, not `requireFeature`. A denied teammate could still hit an API directly. The spec's stance: every data route must enforce the same feature + scope as the UI hides. This is the most important risk, and the audit verified it is live, so the builder must treat per-route enforcement as a hard requirement, not a nicety. (The portal side of this is already done: all client-facing routes now resolve and owner-bind the org via `getPortalAuth`; the gap is the admin/team-member side.)
2. **Two parallel systems** (feature_visibility vs teamMemberAccess; `teamMembers.role` vs `roles`/`teamMemberRoles`). Recommend `teamMemberRoles`/`roles` as canonical identity; have `access-scoping` read from it. Present both axes as one story.
3. **Safe-default = admin (CONFIRMED issue: scoping fails OPEN).** A Tahi-org user with no `teamMembers` row resolves to full admin, and `resolveAccessScoping` returns "unrestricted" for them, so the audit confirmed a contractor added to the Tahi org with no row sees every client. Convenient default, but it is the opposite of least-privilege. The decision this spec now makes: **flip to deny-by-default** (a Tahi user with no explicit role/scope sees nothing until granted). Build the seeding so the owners (Liam/Staci as super_admin) are always granted, so flipping the default can never lock them out.
4. **No audit trail today** despite an `auditLog` table. The spec adds one (write on every assign-role + feature-visibility change). Required for "why can X see Y".
5. **Inert expressive schema** (`rolePermissions.scopeType`, `fieldRestrictions`) implies capabilities the runtime does not honor. Label v1 (page/tab/card visibility + org scope) vs v2 (per-action via `permissions.action`, per-field via `fieldRestrictions`) clearly so we never imply more than we enforce.
6. **One role per member** (assign-role ends active rows) contradicts the many-roles, time-bounded `teamMemberRoles` design. Pick one and state it.
