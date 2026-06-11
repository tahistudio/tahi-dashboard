# CLAUDE.md — Tahi Dashboard

This file is read automatically by every Claude Code session in this repo.
Read it fully before writing any code.

---

## What This Project Is

A custom client dashboard built to replace ManyRequests, with task management depth that rivals a lightweight ClickUp. It serves two audiences:

- **Tahi team (admin):** Manage clients, requests, invoices, billing, time, team, capacity, reports, automations, contracts, scheduling, and messaging.
- **Clients (portal):** Submit requests, track progress, view invoices, upload files, message the team, and see only what is relevant to them.

Target: production-ready launch within 6 to 12 months. Quality bar is high. The UI must feel premium at every screen size, including mobile.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router, Turbopack) |
| Deployment | Cloudflare Workers via `@opennextjs/cloudflare` |
| Database | Cloudflare D1 (SQLite) |
| ORM | Drizzle ORM |
| Auth | Clerk (multi-org) |
| Styling | Tailwind CSS v4 + CSS custom properties |
| Payments | Stripe |
| Email | Resend + React Email |
| Rich text | Tiptap |
| File storage | Cloudflare R2 |
| Charts | Recharts |
| Testing | Vitest (unit), Playwright (e2e) |

---

## Auth Model

Clerk handles all authentication. Two roles exist:

- **Admin:** `orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID` (Tahi Studio internal team)
- **Client:** Any other Clerk org ID

Always check auth at the server component or API route level. Never trust the client for role decisions.

```ts
// In server components:
import { getServerAuth } from '@/lib/server-auth'
const { userId, orgId } = await getServerAuth()
const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID

// In API routes:
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
const { orgId, userId } = await getRequestAuth(req)
if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
```

---

## Database

All core tables are defined in `db/schema.ts`. Additional tables listed in "Planned Schema Additions" are approved and must be created via Drizzle migrations before building the features that depend on them. Do not build UI for a feature until its schema is in place.

```ts
// Get a Drizzle instance in any API route:
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

const database = await db()
const results = await database.select().from(schema.requests).where(...)
```

All primary keys are UUID strings via `crypto.randomUUID()`. Timestamps are ISO strings stored as text. Booleans are integers (0/1) in SQLite.

### Existing table overview

`organisations` — client companies (includes `healthStatus`, `onboardingState`, `onboardingLoomUrl`)
`contacts` — people at client orgs
`teamMembers` — Tahi internal team
`projects` — one-off engagements
`subscriptions` — retainer engagements (maintain, scale plans)
`tracks` — capacity slots per subscription (small/large)
`requests` — all work items (includes `formResponses` JSON for intake form answers)
`messages` — message content (to be migrated to conversation model, see below)
`messageReactions` — emoji reactions on messages
`files` — uploaded file references (stored in R2)
`voiceNotes` — audio attached to messages
`invoices` + `invoiceItems` — billing records
`timeEntries` — hours logged by team members
`tasks` + `taskSubtasks` — three-level task system (client-external, internal-client, tahi-internal)
`tags` — coloured labels for requests, orgs, invoices, tasks
`announcements` + `announcementDismissals` — broadcast banners (all clients, by plan type, by specific org list)
`automationRules` + `automationLog` — trigger/action automation engine
`notifications` — in-app notifications for both team and clients
`exchangeRates` — cached FX rates
`caseStudySubmissions` + `caseStudies` — client testimonial and review pipeline
`docPages` + `docVersions` — Tahi knowledge hub
`integrations` — connected service tokens and config
`auditLog` — immutable action log
`settings` — key/value store

---

## Planned Schema Additions

All of these are approved. The BE agent must add them to `db/schema.ts` and create a Drizzle migration before any dependent feature is built. Add them in logical batches to avoid migration conflicts.

### Batch 1: Messaging overhaul

```ts
conversations: {
  id: uuid pk,
  type: 'direct' | 'group' | 'org_channel' | 'request_thread',
  name: text nullable,
  orgId: text nullable,         // null = Tahi-internal only
  requestId: text nullable,     // set for request_thread type
  visibility: 'internal' | 'external',
  createdById: text,
  createdAt, updatedAt
}

conversationParticipants: {
  id: uuid pk,
  conversationId: text -> conversations,
  participantId: text,
  participantType: 'team_member' | 'contact',
  role: 'admin' | 'member',
  joinedAt: text,
  lastReadAt: text nullable
}

// Add conversationId column to existing messages table
```

Conversation types: `direct` (1:1), `group` (named group chat), `org_channel` (all contacts at an org + assigned team), `request_thread` (attached to a specific request).
Visibility: `internal` = Tahi team only, `external` = client-visible.

### Batch 2: Team member access scoping

```ts
teamMemberAccess: {
  id: uuid pk,
  teamMemberId: text -> teamMembers,
  role: 'project_manager' | 'task_handler' | 'viewer',
  scopeType: 'all_clients' | 'plan_type' | 'specific_clients',
  planType: text nullable,      // set when scopeType = 'plan_type'
  trackType: 'all' | 'small' | 'large',
  createdAt, updatedAt
}

teamMemberAccessOrgs: {
  accessId: text -> teamMemberAccess,
  orgId: text -> organisations
}
```

Deny by default. Admins (NEXT_PUBLIC_TAHI_ORG_ID) bypass all scoping. All other team members see nothing unless granted a rule.

### Batch 3: Contracts

```ts
contracts: {
  id: uuid pk,
  orgId: text -> organisations,
  type: 'nda' | 'sla' | 'msa' | 'sow' | 'other',
  name: text,
  status: 'draft' | 'sent' | 'signed' | 'expired' | 'cancelled',
  storageKey: text,             // R2 key for the unsigned file
  signedStorageKey: text nullable,
  startDate: text nullable,
  expiryDate: text nullable,
  signatoryName: text nullable,
  signatoryEmail: text nullable,
  signedAt: text nullable,
  createdById: text,
  createdAt, updatedAt
}
```

### Batch 4: Scheduled calls

```ts
scheduledCalls: {
  id: uuid pk,
  orgId: text -> organisations,
  title: text,
  description: text nullable,
  scheduledAt: text,
  durationMinutes: integer default 30,
  meetingUrl: text nullable,    // Zoom / Meet / Teams link
  attendees: text,              // JSON: [{id, type, name, email}]
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show',
  notes: text nullable,
  recordingUrl: text nullable,
  createdById: text,
  createdAt, updatedAt
}
```

### Batch 5: Request intake forms

```ts
requestForms: {
  id: uuid pk,
  name: text,
  category: text nullable,     // 'design' | 'development' | etc — null = global default
  orgId: text nullable,        // specific client override — null = applies to all
  questions: text,             // JSON: [{id, type, label, required, options?}]
  isDefault: boolean default false,
  createdAt, updatedAt
}
```

Resolution priority (most specific wins): org-specific form for this category > org-specific global form > category global form > global default form.

Question types: `text`, `textarea`, `url`, `select`, `multiselect`, `checkbox`, `file`.

### Batch 6: Custom Kanban columns

```ts
kanbanColumns: {
  id: uuid pk,
  orgId: text nullable,        // null = global default, set = client-specific override
  label: text,                 // "Requested", "In Progress" etc
  statusValue: text,           // maps to a requests.status value
  colour: text nullable,       // hex
  position: integer,           // display order
  isDefault: boolean default false,
  createdAt, updatedAt
}
```

Default columns: Submitted, In Review, In Progress, Client Review, On Hold, Delivered, Cancelled.
Per-client overrides replace the global default for that client's board view.

### Batch 7: Review and testimonial outreach

Add to `caseStudySubmissions`:
```ts
outreachStatus: 'not_sent' | 'asked' | 'declined' | 'deferred' | 'in_progress' | 'completed'
nextAskAt: text nullable       // ISO timestamp for deferred follow-up
neverAsk: integer (boolean)    // true = client said "no", never trigger again
```

---

## File Structure

```
app/
  (auth)/
  (dashboard)/
    overview/
    requests/
    clients/
    invoices/
    billing/
    messages/           — all conversation types
    files/              — client portal file browser
    tasks/              — three-level task management
    reports/
    time/
    team/               — team members and access rules
    docs/               — knowledge hub
    settings/           — account, integrations, webhooks, dark mode, forms, kanban defaults
    services/           — client portal service catalogue
    announcements/      — admin announcement builder
    contracts/          — contract tracking per client (accessible from client detail)
    calls/              — scheduled calls (accessible from client detail and overview)
  api/
    admin/
    portal/
    notifications/
    uploads/
    webhooks/
components/
  tahi/
  ui/
db/
  schema.ts
  d1.ts
lib/
  db.ts
  server-auth.ts
  utils.ts
emails/
drizzle/
SPECS/                — per-feature design specs (north-star, CRM, AI task wizard, etc)
STATUS.md             — live snapshot: trusted features, known bugs, current sprint
TASKS.md              — full backlog (~1,200 lines; Phase 11 at the bottom is the active block)
DECISIONS.md          — numbered architectural decisions with rationale
AGENTS.md
```

Read `STATUS.md` at the start of any session — it tells you what surfaces the user actually trusts on production today, what's broken, and what's currently being worked on. The `CLAUDE.md` you're reading now is the bible; `STATUS.md` is the heartbeat.

---

## Design System

### Font

Manrope (Google Fonts). All weights 200 to 800.

### Brand Colours

```css
--color-brand:        #5A824E
--color-brand-dark:   #425F39
--color-brand-light:  #7aab6b
--color-brand-50:     #f0f7ee
--color-brand-100:    #dcefd8
```

### Surface Tokens

```css
--color-bg:               #ffffff
--color-bg-secondary:     #f7f9f6
--color-bg-tertiary:      #eef3ec
--color-text:             #121A0F
--color-text-muted:       #5a6657
--color-text-subtle:      #8a9987
--color-border:           #d4e0d0
--color-border-subtle:    #e8f0e6
```

### Status Colours

```css
--color-success: #4ade80 / bg #f0fdf4
--color-warning: #fb923c / bg #fff7ed
--color-danger:  #f87171 / bg #fef2f2
--color-info:    #60a5fa / bg #eff6ff
```

### Dark Mode

The `.dark` class and all dark surface tokens are fully defined in `globals.css`. Dark mode is opt-in via a toggle in the settings page or top nav. Persist the user's preference to `localStorage` under the key `tahi-theme`. Apply the class to the `<html>` element on load to avoid flash.

When building components, always use CSS var references or tokens from `globals.css` rather than hardcoded hex so that dark mode works without additional overrides. The sidebar is exempt (it is always dark).

### The Leaf Radius

```css
--radius-leaf:    0 16px 0 16px
--radius-leaf-sm: 0 10px 0 10px
--radius-leaf-lg: 0 24px 0 24px
```

Use for: icon backgrounds, avatar wrappers, primary CTA buttons, feature callouts. Not for every card.

### Sidebar Colours (always dark, hardcoded)

```ts
const S = {
  bg: '#1e2a1b', border: '#2d3d2a', groupLabel: '#4a6145',
  textMuted: '#7aaa72', textActive: '#ffffff',
  bgHover: '#2a3826', bgActive: '#2f3f2c',
  iconMuted: '#5f9458', iconActive: '#93c98a',
}
```

### Styling Rules

1. Never use dynamic Tailwind class strings at runtime.
2. Hardcode hex in const objects at the top of the file for inline styles.
3. Use CSS var references in Tailwind classes for dark-mode-compatible styling.
4. Every interactive element must have a hover and focus state.
5. Page background: `var(--color-bg-cream)` (warm sand `#F7F6F3` light / `#131211` dark) in the dashboard layout wrapper. Never hardcode it.

---

## Mobile and PWA

This dashboard must be fully usable on mobile. Priority screens for mobile: client portal overview, requests list, request detail, messages, invoices.

- All layouts must be responsive at 375px (iPhone SE) and 768px (tablet).
- The sidebar collapses to a bottom tab bar on mobile for the client portal.
- `public/manifest.json` exists — verify it is complete and test PWA install on iOS and Android.
- Add an offline fallback page.
- Touch targets must be at minimum 44px tall.

---

## Component Patterns

### Page structure

```tsx
// app/(dashboard)/feature/page.tsx — server component
import { getServerAuth } from '@/lib/server-auth'
import { redirect } from 'next/navigation'

export const metadata = { title: 'Feature — Tahi Dashboard' }

export default async function FeaturePage() {
  const { userId, orgId } = await getServerAuth()
  if (!userId) redirect('/sign-in')
  const isAdmin = orgId === process.env.NEXT_PUBLIC_TAHI_ORG_ID
  return <FeatureContent isAdmin={isAdmin} />
}
```

### Client data component

```tsx
'use client'
import { useState, useEffect, useCallback } from 'react'

export function FeatureContent({ isAdmin }: { isAdmin: boolean }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/feature')
      if (!res.ok) throw new Error('Failed')
      const json = await res.json()
      setData(json.items ?? [])
    } catch { setData([]) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])
}
```

### API route

```ts
import { getRequestAuth, isTahiAdmin } from '@/lib/server-auth'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { schema } from '@/db/d1'

export async function GET(req: NextRequest) {
  const { orgId } = await getRequestAuth(req)
  if (!isTahiAdmin(orgId)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const database = await db()
}
```

### Empty and loading states

Every list view must handle all three states: loading (animate-pulse skeletons), empty (leaf icon + title + description + CTA), and populated. See `request-list.tsx` for the canonical pattern.

---

## What Is Built

- Auth and role routing (complete)
- Database schema core tables (complete)
- Cloudflare Workers / D1 infrastructure (complete)
- Sidebar navigation with collapse (complete)
- Top navigation bar (complete)
- Overview page: admin KPIs + recent requests, client portal view (complete)
- Requests page: list view, kanban board, search, filter tabs, new request dialog (complete)
- Clients page: list, search, filter chips, new client dialog (complete)
- APIs: requests (GET/POST), clients (GET/POST), overview, portal requests
- File uploads: R2 presign, confirm, proxy, serve (complete)
- Stripe webhook handler (stub)
- SSE notification stream endpoint (stub)

---

## What Is NOT Built

See `TASKS.md` for the full prioritised list. The high-level categories:

- Request detail page and message thread
- Client detail page and impersonation
- Invoices (list, detail, Stripe auto-generation)
- Messaging system (full conversations model)
- Voice notes UI
- Tasks (three-level)
- Reports and charts
- Time tracking
- Team management and access scoping
- Contracts tracking
- Scheduled calls
- Request intake forms per category/client
- Custom Kanban columns per client
- Bulk request creation (quick-add and cross-client)
- Dark mode toggle
- Mobile responsive and PWA
- CSV export (time, invoices, requests)
- Client health scoring (automated)
- Announcements and banners with email delivery
- Review and testimonial outreach pipeline
- Client onboarding checklist
- Admin impersonation
- Docs hub
- Settings page
- HubSpot, Slack, Mailerlite, Xero integrations
- Automation rule builder
- Zapier/outgoing webhooks (Phase 4)
- Audit log viewer

---

## Integration Reference

| Service | Purpose |
|---|---|
| Stripe | Subscription billing, invoice auto-generation for retainer clients, customer portal |
| Xero | Invoice sync, payment reconciliation (retainer invoice auto-generation handled by Xero) |
| Mailerlite | Auto-add clients to onboarding list |
| HubSpot | Auto-create or match contact when client onboards |
| Slack | Team notifications (new request, overdue, status changes) |
| Loom | Embed onboarding video on client portal |
| Zapier | Outgoing webhook triggers for automation rules (Phase 4) |

---

## Code Quality Rules

1. `npm run type-check` must pass with zero errors before every commit.
2. `npm run lint` must pass with zero errors before every commit.
3. No `any` types. Use proper types or `unknown`.
4. No commented-out code in commits.
5. No `console.log` in production code.
6. No em dashes or en dashes anywhere — not in strings, comments, or JSX text.
7. Agents commit directly to main after type-check and lint pass.
8. **Definition of Done.** A task only flips to `[x]` after all of:
   1. `npm run type-check` zero errors
   2. `npm run lint` zero errors
   3. Pushed to main + Webflow Cloud deploy green
   4. **Live browser smoke**: golden-path flow exercised on the deployed URL
   5. **Mobile 375px**: layout verified — no horizontal scroll, touch targets ≥ 44px
   6. **Dark mode**: page rendered with `.dark` class — no contrast regressions
   7. **Screenshot or note** added to the commit body or PR confirming 4–6
   Tasks failing any of 4–7 must stay `[ ]` even if 1–3 pass. See `STATUS.md` for current sprint and known live bugs.
9. Playwright e2e for critical flows. Vitest unit tests for API routes with non-trivial logic.
10. Every new page needs `export const metadata` with a descriptive title.
11. All admin API routes that return requests, clients, or tasks must enforce team member access scoping.
12. All portal API routes must scope queries to the authenticated user's `orgId`.
13. All components using CSS tokens must use CSS var references, not hardcoded hex, so dark mode works correctly.
14. MCP parity: any API capability used in the dashboard must be exposed via MCP tools on the worker server (`workers/mcp-server/src/index.ts`). The local stdio server (`mcp-server/index.ts`) is dormant — do not extend it. See Decision #036 (partly superseded) and memory `feedback_mcp_worker_only.md`.

---

## Environment Variables

```
NEXT_PUBLIC_TAHI_ORG_ID
CLERK_SECRET_KEY
NEXT_PUBLIC_CLERK_*
DATABASE_URL
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
RESEND_API_KEY
CLOUDFLARE_R2_*
XERO_CLIENT_ID / XERO_CLIENT_SECRET
HUBSPOT_API_KEY
SLACK_BOT_TOKEN
MAILERLITE_API_KEY
```

---

## Running Locally

```bash
npm run dev
npm run db:studio
npm run type-check
npm run lint
npm run test
npm run test:e2e
npm run preview
```

---

## Cloudflare Specifics

- Cloudflare Workers runtime only. No Node.js-only APIs.
- Use `getCloudflareContext()` from `@opennextjs/cloudflare` to access D1, R2, and KV.
- Use `lib/db.ts` `db()` helper always.
- No file system access (`fs`, `path`).
- No `export const runtime = 'nodejs'`.
