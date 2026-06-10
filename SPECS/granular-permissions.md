# Granular Permissions — design for approval

Status: 2026-06-10 — DESIGN, awaiting Liam's approval. Nothing built yet.
Owner ask: "every user who comes on, every organization/client that comes on, I
can select exactly what they can see, why they can see it, and how much they can
see — turn off entire features or just certain parts of a feature, right down to
the granular level."

See [[project_portal_readiness_arc]]. This is leg 1 of the ManyRequests-parity
trio (permissions + requests/tasks + the proposal/contract/schedule/delivery
spine). The spine is built; requests/tasks are lapped; this is the capstone.

## What exists today (grounded)

Two layers, NOT integrated:

1. **`teamMemberAccess` (the only thing enforced).** `lib/access-scoping.ts`
   `resolveAccessScoping()` returns `null` (unrestricted) or `string[]` of allowed
   orgIds; `lib/require-access.ts` `requireAccessToOrg()` gates a route. Wired into
   ~30 admin routes. **Org-level only** (all_clients / plan_type / specific_clients).
   3 hardcoded roles (project_manager / task_handler / viewer). One rule per member.
2. **#119 RBAC model (fully schema'd + seeded, read by ZERO runtime code).**
   `roles`, `permissions` (resource + action), `role_permissions` (with rich
   scope_type filters), `team_member_roles` (time-bounded, many-per-member),
   `field_restrictions` (per-field hide/deny). Seed creates 5 system roles + ~126
   permissions (27 resources x 4 base actions + 18 verbs). **No `can()` helper, no
   UI.** The Settings "Modules" toggle is global + wired to nothing.

Gap vs the goal: nothing is per-user x per-feature; nothing is sub-feature; no
per-org client-portal feature toggles; the expressive model is inert.

## Proposed architecture — build ON #119, add three things

### 1. A FEATURE_TREE manifest (the vocabulary)
One central, typed manifest (`lib/feature-tree.ts`) describing every gateable
surface as a dotted path: page > tab/section > card/action. Examples:
`requests`, `requests.board`, `requests.bulk_actions`, `clients.billing_card`,
`request_detail.time_tab`, `financial_reports`, `settings.integrations`. Each
node: `{ key, label, description (the "why"), parent, appliesTo: ['team'|'client'] }`.
This is the single source of truth the API, the sidebar, the `<Gate>` component,
and the builder UI all read. Sub-feature granularity = depth in this tree.

### 2. A `feature_visibility` table (per-user AND per-org overrides)
Pure RBAC (roles) can't express "this one user" or "this one client" without a
role explosion. Add:
```
feature_visibility:
  id pk
  subjectType: 'role' | 'team_member' | 'organisation'
  subjectId: text            // roleId | teamMemberId | orgId
  featureKey: text           // dotted path from FEATURE_TREE
  effect: 'allow' | 'deny'
  reason: text nullable      // the "why" Liam wants recorded
  createdById, createdAt, updatedAt
  UNIQUE(subjectType, subjectId, featureKey)
```
Resolution (most specific wins): team_member/org override > role grant > default.
`deny` always beats `allow` at the same specificity (safe default). This is the
one new table; #119 stays the capability backbone, `field_restrictions` stays for
field-level hiding.

### 3. Enforcement in three places, one manifest
- **`lib/permissions.ts`**: `resolvePermissions(userId)` joins active
  `team_member_roles` -> `role_permissions` -> `permissions`, layers
  `feature_visibility`, folds in the existing org-scope from `resolveAccessScoping`
  (so the OLD layer becomes the org-scope special case). Returns a capability set +
  `can(caps, featureKey)` + `getScope(caps, resource, action)`. Cached per request.
- **API routes**: generalise `requireAccessToOrg` into `requirePermission(featureKey)`
  + keep org-scope filtering. Roll out route-by-route (deny-by-default for
  non-admins; NEXT_PUBLIC_TAHI_ORG_ID admins always bypass).
- **Sidebar + UI**: `app-sidebar.tsx` filters nav from the manifest (replaces the
  hardcoded VIEWER_HIDDEN_PAGES + the dead Modules toggle). A `<Gate feature="...">`
  wrapper hides cards/tabs/buttons, fed by a capability set resolved server-side in
  the layout and passed down.

### 4. The builder UI (`/settings/permissions` or `/team/[id]` + `/clients/[id]`)
- **Roles editor**: CRUD roles + a resource x action grid writing `role_permissions`.
- **Per-member tree**: the FEATURE_TREE rendered as an allow/deny/inherit tree for
  one team member, writing `feature_visibility` (subjectType='team_member'), with a
  reason field per override.
- **Per-client tree**: same tree (client-facing nodes only) for an org, writing
  `feature_visibility` (subjectType='organisation') — this is how Liam turns whole
  portal features on/off per client.
Reuse the AccessPanel SlideOver + FilterBar + DataTable patterns already in the
team page; mirror the locked Docs Hub composition.

### 5. MCP parity (CLAUDE.md rule 14)
Expose capability checks + grants as worker MCP tools (e.g. `get_permissions`,
`set_feature_visibility`, `list_roles`).

## Decisions I need from you

1. **Scope of v1.** Everything above is a lot. Recommended v1: FEATURE_TREE +
   `feature_visibility` + `lib/permissions.ts` + sidebar/`<Gate>` enforcement +
   the per-member and per-client tree UIs, enforcing the ~12 biggest surfaces
   first (requests, tasks, invoices/billing, financial-reports, clients,
   contracts, settings, messages). Full route-by-route `requirePermission` rolls
   out incrementally after. OK to phase it this way?
2. **Granularity depth for v1.** Page + tab/card level (e.g. hide the billing card,
   hide the requests board) — OR also action level (e.g. can view requests but not
   bulk-delete)? Action level is more work; page/tab/card covers most of "turn off
   features or parts."
3. **Reason capture.** You said "why they can see it." Store a free-text reason per
   override (recommended), or a structured reason set? Free-text is simplest.
4. **Default posture for new clients/users.** New client org: everything client-safe
   ON by default then you switch off, or OFF by default then you switch on? New team
   member: inherits a chosen role's grants. Recommend ON-by-default for clients
   (less friction) with easy per-feature kill switches.

## Slice plan (once approved)
- S0: FEATURE_TREE manifest + `feature_visibility` migration (idempotent).
- S1: `lib/permissions.ts` resolve/can/getScope + per-request cache + unit tests.
- S2: sidebar nav filtering + `<Gate>` component (visible wins first).
- S3: per-member + per-client builder UIs.
- S4: route enforcement rollout (top surfaces) + MCP tools.
- S5: kill the dead global Modules toggle; migrate any intent into feature_visibility.
