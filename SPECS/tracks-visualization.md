# Client Track Visualization — per-track mini-kanban

Status: 2026-06-11 — DESIGN approved (forks locked), spec for review. Not built.
Task #189. The biggest client-facing UI/UX surface: tracks are how clients
interact with Tahi daily and understand what they pay for.

See [[project_tracks_visualization]] and [[project_portal_readiness_arc]].

## Goal

Replace the current "one active task + flat queue list" track card with a
**per-track mini-kanban** so a client can, at a glance: see where each piece of
work is in the flow, see what's been delivered (value made visible), and
understand their retainer capacity (one active slot per track). Portal/client
surface only; the admin `/capacity` view is unchanged in v1.

## Current state (grounded)

- `app/(dashboard)/requests/track-view.tsx` fetches `/api/portal/capacity` (client)
  or `/api/admin/capacity` (admin) and renders `components/tahi/track-queue-view.tsx`.
- `TrackQueueView` -> per-track `TrackCard`: header (Large/Small + Priority badge +
  Active/Open), ONE active task, a flat drag-to-reorder Queue, an upsell banner at
  queue >= 3, a priority-bump confirm modal, empty state.
- `GET /api/portal/capacity` returns `{ subscription, entitlements, summary,
  tracks: [{id,type,isPriorityTrack,currentRequestId,currentRequest}], queue }`.
  It already filters `isInternal=false` and EXCLUDES delivered/archived.
- Tracks: `tracks` table (type small|large, isPriorityTrack, currentRequestId);
  belong to a `subscriptions` row. Requests carry status, priority, queueOrder,
  dueDate, createdAt, deliveredAt, assignee.

## Design (approved forks)

**Structure:** per-track mini-kanban. Each track is its own card; lanes are
columns on wide screens, stacked sections on mobile (clients are on phones, so
mobile-first). Large tracks first, then small.

**Lanes (per track):**
1. **Up next** — queued requests (status submitted | queued) for this track.
   The ONLY interactive lane: drag-to-reorder (reuse existing logic) + the
   existing high-priority "move to top" confirm modal. Shows a count.
2. **In progress** — the single active slot (status in_progress | in_review).
   WIP = 1, framed as "your active slot" so the capacity story is visual.
   Read-only.
3. **Review** — status client_review. Highlighted as "needs your input" with a
   subtle CTA (tap -> request detail). Read-only.
4. **Delivered** — requests delivered in the last 30 days. Recent completions so
   value is visible. Read-only, tap -> detail. A "view all" link to the
   completed requests list if there are more than shown (~5).

Clients never move work across lanes (Tahi controls status); only Up next is
reorderable. Tapping any card opens the request detail. 44px touch targets.

**Track header (the "what you're paying for" story):**
- Track type (Large / Small) + Priority badge (existing).
- Slot status: ● Active / ○ Open.
- "{n} delivered (30d)" + "~{d}d avg turnaround" — computed from
  `deliveredAt - createdAt` over the delivered-in-window requests for the track.
- Gentle upsell when Up next depth >= 3 (reuse `UpsellBanner`).

**Delivered lane window:** last 30 days, with a "View all delivered" link to the
completed-requests list (so older completions are reachable without bloating the
lane).

## Ghost tracks (the upsell, first-class)

Alongside the client's REAL tracks, render greyed-out "ghost" track cards for the
tracks they'd gain by upgrading — making the upgrade path visual and showing what
Tahi can do better (more throughput, bigger work, faster delivery). Lead with the
CAPABILITY, then the plan (the Tahi sales doc: "lead with what they get, stack it,
then name the price").

Plan ladder (from `lib/plan-utils.getTrackEntitlements`):
- maintain (1 small) -> +1 small (Priority support) AND +1 large (Scale)
- maintain + priority (2 small) -> +1 large (Scale)
- scale (1 large + 1 small) -> +1 large (Priority support)
- scale + priority (2 large + 1 small) -> top tier, no ghost (subtle "You're on our top plan")

Ghost card: same kanban card SHAPE so it reads as "another lane you could have",
but visually muted (dashed border, reduced opacity, lock/sparkle icon), no live
data. Content = a capability headline + subline + CTA:
- +1 small: "Run two projects at once" / "A second track means two pieces of work
  in flight." -> "Add priority support"
- +1 large (from maintain): "Take on bigger builds" / "A large track handles full
  pages + complex work, not just small tasks." -> "Upgrade to Scale"
- +1 large (from scale): "Two big projects in parallel" / "Double your large-build
  throughput." -> "Add priority support"
CTA -> the existing upgrade path (`onUpgradeClick` -> /billing) or a "Talk to us"
contact. Hover lifts the muted card slightly (affordance).

A new pure helper `getUpgradeGhostTracks(planType, hasPrioritySupport)` in
`lib/plan-utils.ts` returns the ghost specs `[{ type, headline, subline, cta }]`;
unit-tested for every plan state. Ghost tracks render after the real tracks in the
same grid.

## Data / backend

One additive backend change: `/api/portal/capacity` (and `/api/admin/capacity`
for parity) must also return **recently-delivered** requests:
- new `delivered` array: status = 'delivered', `deliveredAt` within the last 30
  days, `isInternal = false`, scoped to the org; include deliveredAt + createdAt
  (for turnaround) + trackId/type so the client can bucket them by track.
- Keep the existing `isInternal=false` filter on every query (portal leak rule).
- The redesigned component buckets `queue` + `tracks[].currentRequest` +
  `delivered` into per-track lanes and computes header stats. Turnaround +
  delivered-count are pure functions -> unit-testable.

Untracked-but-eligible queued requests still distribute to the first eligible
track (existing `trackCanHandle` logic), unchanged.

## Components / files

- `components/tahi/track-queue-view.tsx` — rebuild `TrackCard` as the mini-kanban
  (4 lanes). Keep the `TrackQueueView` shell, the reorder plumbing, the priority
  modal, and the upsell. Do NOT use the heavy admin `KanbanBoard` (clients only
  reorder one lane and never move across columns) — a focused lane layout reusing
  the existing drag logic is lighter and correct. Reuse design tokens, leaf radii,
  Badge, Avatar.
- `app/(dashboard)/requests/track-view.tsx` — map the new `delivered` array into
  `track.delivered[]`; compute header stats; pass to `TrackQueueView`.
- `app/api/portal/capacity/route.ts` (+ admin parity) — add the `delivered` query.
- A small pure helper (e.g. `lib/track-stats.ts`) for delivered-count + avg
  turnaround, with unit tests.
- `lib/plan-utils.ts` — add `getUpgradeGhostTracks(planType, hasPrioritySupport)`
  (pure, unit-tested) returning the ghost-track upsell specs.

## Scope boundaries (YAGNI)

- Client/portal only; admin `/capacity` visual unchanged (it just gets the extra
  `delivered` data for parity, no UI change required in v1).
- No new statuses, no client-driven status changes, no cross-lane drag.
- Delivered window fixed at 30 days (not per-billing-cycle) for v1 simplicity.
- Reuse existing reorder + priority-bump + upsell. No new primitives.

## Verification

- Unit tests for the stats helper (turnaround, delivered count, windowing).
- type-check + lint + build + tests.
- Live Chrome QA on prod incl. **375px mobile** (lanes stack, no horizontal
  scroll, 44px targets) and **dark mode**. Validate as a client (Client view /
  impersonation) that internal requests never appear and the lanes bucket
  correctly.

## Decisions locked

- Delivered window = **last 30 days** + a "View all delivered" link. (Liam, 2026-06-11.)
- Ghost-track upsell is in scope and first-class (Liam, 2026-06-11).
