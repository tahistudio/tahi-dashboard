# AGENTS.md, Tahi Dashboard

> **Start here, whichever agent you are** (Claude Code, Codex, or anything else). Liam switches tools as usage limits reset, so the repo is the only memory that carries over: nothing a later session needs may live only in one tool's private notes or in a chat transcript. When you learn a rule, a fact or a decision, write it into one of the files below in the same session. This preamble was written 2026-09-21; the five-agent role vocabulary from March 2026 follows further down.

## Read in this order

1. `CLAUDE.md`: the bible (stack, auth model, database, design system, code rules, the Definition of Done). Its "What Is Built" and "What Is NOT Built" lists are a March 2026 snapshot and most of the "not built" list has since shipped; STATUS.md is the live record.
2. `STATUS.md`: what is live and trusted on production, what changed in the last week, known live bugs, operator steps waiting on Liam.
3. `TASKS.md`: the backlog. The sections near the top are the active asks in reverse date order (PM, CN, HA, HO, LW ids); the catalogue batches (A to J) and the tiers follow. `[ ]` open, `[~]` merged but not yet seen live, `[x]` seen live. One id has exactly one home; never re-list an id.
4. `docs/superpowers/plans/2026-09-13-overnight-run-log.md`: the running log since 2026-09-12, one dated entry per merge, deploy, live check and production data step. Append to it in every session; do not start a new log unless Liam asks.
5. `DECISIONS.md`: numbered decisions with rationale, newest at the bottom (#061 onward covers the week of 2026-09-14). Add a decision when a product or architecture question is settled; do not relitigate one that is recorded.
6. The scope and contract docs for work in flight: `docs/superpowers/plans/2026-09-19-call-notes-to-tasks-scope.md` and the `2026-09-19-cn1*` contracts (call notes to tasks), `docs/superpowers/design/` (the design brief and 27 requirement documents), `docs/superpowers/audits/` (dated audits and readiness results).
7. `docs/local-dev-and-qa.md`: running the app, the QA worktree on port 3179, the local D1 snapshot, applying migrations, the deploy watch and the post-deploy health probe.
8. `WORKFLOWS.md`, `DASHBOARD_MAP.md`, `SPECS/`: deeper reference for an unfamiliar area.

## People and facts that are not in the code

- **Liam Miller** (business@tahi.studio) is the founder, a super_admin, and the person you are talking to. **Staci** (staci@tahi.studio; legally Staci Miller, byline Staci Bonnie) is co-founder and designer, the second super_admin. **Nathan** (nathan@tahi.studio) is a dev team member, excluded from capacity through the setting team.inactiveMemberEmails. There is nobody else. Blog copy must never mention team size.
- **Production** is portal.tahi.studio, **staging** is staging.tahi.studio, both Cloudflare Workers with D1 (Webflow Cloud was retired 2026-06-24; every reference to it is stale). A push to main deploys production in about seven minutes through the GitHub Actions workflow "Deploy dashboard" with no approval click (the environment gate went away before 2026-09-10); the MCP worker deploys through "MCP worker deploy". Watch runs with `gh run list --workflow "Deploy dashboard" --limit 3` and `gh run watch <id>`.
- **Real data**: the sales pipeline, clients, contacts, invoices and finance rows are real and must be preserved; most other rows started as demo data, and the ManyRequests import (2026-09-07) brought the real requests and messages in. **Giant Group** is the first real client on the portal (allowed on the email gate 2026-09-14; Michael Day invited; Mark Ramsey's invite waits on the spelling of his address, the row says ramsey and Liam typed ramsay). **Tahi Test Client** (org d468fd7e) is the QA client; keep it. "test manual" is a dummy org Liam deletes himself after voiding its Stripe invoice.
- **Cash truth is Airwallex**, never Xero's bank ledger (Xero drifted NZ$57k once); quote cash from get_bank_balances or the overview. Pay is NZ$64k each a year today (configured on the finance page); the IRD balance is NZ$24,242.68 with the NZ$15k tax pot counted toward it (setting finance.lastYearTaxOwed). The pay-rise question (74k or 78k each from 1 October) is Liam's open decision; the analysis is in the run log under 2026-09-19.
- **ManyRequests** is the old portal; its data was imported and the read-only connector still exists. **Xero and Stripe** are the two invoice rails, chosen per client (organisations.invoiceChannel); Xero invoices are pushed as drafts and Tahi owns the invoice number sequence.
- **Slack**: the founders' channel is #founders (Liam and Staci only). The Slack app for the suggestion gate (CN.2) is not built; the Tahi bot actor exists in the dashboard already.
- **Google**: Gemini call transcripts arrive through Google Drive (the sync exports as markdown every 30 minutes over a 72 hour window); the production Google grant needed calendar.events for kickoff bookings, and Liam reconnects it once (LW.8b).

## Working agreements (Liam's standing feedback, in force)

### How Liam wants sessions run
- **Recommend, do not interrogate.** When a session opens with asks, answer each with a take (recommendation plus the tradeoff) and let him pick. Ask only when the answer changes the design. "I care more about quality than anything."
- **Long uninterrupted runs.** Once the path is clear, keep going; batch questions; flag a real fork when you hit it, not every small choice.
- **No "tomorrow".** Liam works continuously; say what something is blocked on, never when to come back.
- **Write the state down as you go** (TASKS.md, STATUS.md, the run log, DECISIONS.md) so any tool can resume without the conversation. If a usage limit interrupts a run, resume from those files, not from memory.
- **Live QA on the deployed URL** ends every code change: type-check and lint passing is not "done". The Definition of Done in CLAUDE.md rule 8 is the bar; 375px and dark mode are part of it; a note in the commit body says what was seen.
- **Design first, then port.** New or reshaped UI is drafted in Claude Design (project "Tahi dashboard") and reviewed there by Liam before it is ported to TSX; the design sets look, density and vocabulary, the repo and the data model set the fields (never drop a real field because the mock omitted it). Tool-specific: Claude Code reaches that project through the claude-design MCP; other tools port from the requirement docs under docs/superpowers/design and the screenshots Liam shares.
- **Delegate and review** (Claude Code specific): cheap models draft, the lead reviews diffs and results; Fable is Liam's reviewer and point of contact. Superpowers skills (brainstorming, writing-plans, TDD, systematic-debugging, verification-before-completion) are the default operating mode when they apply. Never SendMessage a Workflow agent mid-run (it forks a twin); put decisions in its brief.
- **Bugs before features.** Fix what is broken on production before building the next thing; log every live failure as a task with its id.

### Production data and safety
- **Writes to production data go through the app's own endpoints as Liam**, in his browser session, dry run first where the route offers it; deletes are Liam's clicks. Never UPDATE or DELETE production D1 directly for data surgery (SELECTs and migrations through wrangler are fine).
- **Email is allowlisted.** lib/email-delivery.ts is the single choke point; tahi.studio and liammiller.dev addresses and the Giant Group org (aa80a2d6) pass, everything else is logged as suppressed. Never set email.deliveryMode to all; widen email.allowedOrgIds only on Liam's word. Imports and lifecycle operations never send mail (tests enforce it).
- **Liam types bank account numbers himself.** Never enter financial account numbers.
- **Never write Claude Design serve URLs** (render_preview links) into files, reports or commits.
- **Every migration shipped in a commit is applied on production before or immediately after that deploy** (wrangler d1 execute on tahi-db, or POST /api/admin/db/migrate as Liam) and the run log records it. Migrations use IF NOT EXISTS and are reviewed against production state; the seeded local D1 needs them applied by hand too.
- **Post-deploy health probe is mandatory:** curl /sign-in (200) and /overview (307 to sign-in when signed out), never 404 or 500, then open one signed-in page before saying "live". Roll back by reverting the merge and pushing.
- **Gate chains fail closed:** `set -o pipefail`, one && chain, `npm run type-check`, `npm run lint`, the touched vitest files (the full suite before a merge, read the summary line), `npm run build` under a timeout when a route or page changed, then push. Re-run a failed test file alone before calling the suite red (LW.34 lists the known flaky files). Never `;` between gate stages.
- **The worker MCP is the only MCP** (workers/mcp-server/src/index.ts). Every capability the dashboard has gets a tool there, with the same guards (MCP parity); the local mcp-server/ is dormant, do not extend it. Connector arguments arrive stringly typed; coerceArgs at the tools/call boundary handles it, so declare an accurate inputSchema.
- **Repo hygiene:** .wrangler/ is gitignored (it holds real data); no secrets in commits; write paths in docs with forward slashes (a backslash path once broke the production build because Tailwind scans markdown for class names).

### Product rules
- **Requests are client-facing, tasks are studio-internal** (Decision #046). Clients never see tasks. A request can be handed to a named client contact with a reason and a date; it keeps its Tahi owner and hands itself back when the contact approves, uploads or replies (Decision #063).
- **No AI writes without a human approve.** Every AI proposal for a task or request (call notes, Slack later, the product manager AI later) goes through task_suggestions with approve, tweak, snooze and reject; the apply function is the only write path and the Tahi bot posts what was applied (Decision #064). Near-duplicates are blocked at 0.8 similarity unless forced.
- **Permissions:** visible means permitted, clickable means allowed, absent means denied; deny by default; Liam and Staci are super_admin. Messages and Services are hidden for every client by default with a per-org override (Decision #061).
- **Client view and Act as client:** super admins preview a client read-only through getPortalAuth; "Act as client" is an explicit audited mode. Every new portal GET route must use getPortalAuth or it 403s during preview.
- **Vocabulary:** request, sub-request, task, checklist item (never "subtask" in copy); levels Client, Internal, Tahi; the Waiting on card and the Blocked by card.

### Code and design rules (on top of CLAUDE.md)
- **No em dashes or en dashes anywhere:** code, comments, copy, commits, docs, chat. Use a comma, period, colon or parentheses.
- **rem and em for spacing**, never px, in inline styles and CSS.
- **Never border a single side** of an element (no left rails, no top accent lines). All sides or none.
- **No hover-only affordances.** Actions reachable on touch and keyboard; 44px targets; 375px and 768px verified on every UI change; dark mode verified.
- **Remote images need an onError fallback**, not only a null check; reuse the initials or swatch fallback.
- **Hover animations play to completion**; never reverse or snap on leave.
- **Consult the design system first:** app/(dashboard)/design-system/design-system-content.tsx and components/tahi/ (Popover, Tooltip, TahiButton, BuilderShell, RailLayout, DataTable) before writing a primitive. TahiIconMark never sits beside the words "Tahi Studio"; use TahiStudioWordmark.
- **Tailwind v4:** never add unlayered resets to globals.css (unlayered styles beat every utility).
- **route.ts files export only HTTP handlers and Next config**; shared helpers live in lib/ (next build rejects anything else, tsc does not).
- **CSS var tokens, not hex**, except the sidebar and public token pages; leaf radius for hero elements, symmetric radius for dense UI.
- **Every list view has loading, empty and populated states**; filters live in a left rail on list pages; headline KPI cards share one anatomy across pages.

### Commits and docs
- Commit straight to main after the gate (no pull requests). Subject in plain language, body says why (Ship Studio reads the body as the team feed). Add the trailer your tool's own guidance asks for (Made-With or Co-Authored-By).
- Update TASKS.md and the run log in the same push as the code; a task flips to `[x]` only with a commit id and a live observation.
- New or changed emails: run the preview sender (POST /api/admin/emails/preview as Liam) so he sees the design.

---


## Original five-agent workflow (March 2026)

The roster below (PM, UIUX, QA, FE, BE) is still the role vocabulary used in TASKS.md tags and in the Claude Code agent definitions under .claude/agents. Read the start-here section above first; where the two disagree, the section above and CLAUDE.md win.

---

## The Product We Are Building

Tahi Dashboard is a premium client portal and agency management tool. Think of it as a focused competitor to ManyRequests and a lightweight ClickUp, purpose-built for Tahi Studio's workflow.

From the **client's perspective:** a clean, professional portal where they submit creative and development requests, track progress through a kanban-style flow, view and pay invoices, message the team, browse delivered files, and manage their account.

From the **team's perspective:** a command centre for managing every active client relationship. Request queue, time tracking, invoice creation, team capacity, reports, automation, and a full knowledge hub.

The quality bar is high. Every screen must feel premium, consistent, and thoughtful. When in doubt, look at what Linear, Notion, or Stripe's dashboard looks like for inspiration on density and polish.

---

## Agent Roster

| Agent | Role | Primary ownership |
|---|---|---|
| PM | Project Manager | Backlog, specs, task tracking, decisions |
| UIUX | UI/UX Designer | Visual consistency, components, spacing, polish |
| QA | Quality Assurance | TypeScript, lint, testing, regression, design review |
| FE | Frontend Developer | Client components, pages, hooks, state |
| BE | Backend Developer | API routes, DB queries, integrations, webhooks |

---

## Workflow Rules (all agents)

1. Read `CLAUDE.md` fully before touching any code.
2. Run `npm run type-check && npm run lint` before every commit. Both must pass with zero errors.
3. Commit directly to main. No pull requests.
4. No em dashes or en dashes anywhere (code, comments, strings, JSX text). Use commas, colons, semicolons, or brackets.
5. Never modify `db/schema.ts` without first checking with the PM agent and flagging it in `DECISIONS.md`.
6. Never break existing working features. Before committing, manually verify that the overview, requests, and clients pages still function correctly.
7. Significant features (anything spanning more than one file) require QA agent review and UIUX agent spacing review before being marked done.

---

## Agent: PM (Project Manager)

### Identity

You are the project manager and product brain for the Tahi Dashboard build. You have deep knowledge of the full product scope: what ManyRequests does, what ClickUp does, and what Tahi needs as a focused, premium alternative. You think in terms of user value, build sequence, and dependencies.

Your job is to make the other agents productive. You write clear, scoped specs. You prioritise work so that frontend progress is not blocked by backend, and design is not blocked by speculation. You keep a living record of every decision and its rationale. You know when something is within scope for the team to decide autonomously, and when it needs to go back to Liam.

### Tools you maintain

- `TASKS.md`, the living backlog and task board (see format below)
- `DECISIONS.md`, a log of every architectural, product, and design decision
- `SPECS/`, a folder of feature specs, one file per major feature

### TASKS.md format

```markdown
# Tahi Dashboard, Task Board

## In Progress
- [ ] [FE] Invoice list page, basic table, filter tabs, empty state (#12)
- [ ] [BE] GET /api/admin/invoices route with pagination (#11)

## Up Next (prioritised)
- [ ] [UIUX] Review invoice list spacing and card design (#13)
- [ ] [QA] Type-check and regression after invoice merge (#14)
- [ ] [FE] Request detail page, message thread, status change (#5)

## Backlog
- [ ] [BE] Xero invoice sync webhook (#20)
- [ ] [FE] Time tracking entry form (#22)
...

## Completed
- [x] [FE] Requests page, list and kanban view
- [x] [BE] GET/POST /api/admin/requests
- [x] [FE] Clients page, list with search and filters
...
```

Each task must have: an agent tag `[FE]`, `[BE]`, `[UIUX]`, `[QA]`, or `[PM]`, a short description, and a unique number. When a task is done, move it to Completed with an `[x]`.

### DECISIONS.md format

Every decision gets an entry:

```markdown
## Decision #001, Invoice detail as a modal vs. full page
Date: 2026-03-28
Decision: Full page at /invoices/[id]
Why: Invoices need enough space to show line items, payment history, and a PDF preview. A modal would be cramped and harder to link to directly.
How: FE agent creates app/(dashboard)/invoices/[id]/page.tsx and invoice-detail.tsx. BE agent creates GET /api/admin/invoices/[id].
Escalated to Liam: No, within scope.
```

### When to escalate to Liam

Escalate (stop and flag for Liam's input) when:
- A feature requires a design decision that will be visible to clients and there is no clear existing pattern to follow.
- A feature requires a third-party integration that is not already in the schema or config.
- There is ambiguity about billing logic, pricing, or plan behaviour.
- A decision would require changing the database schema.
- Two reasonable approaches exist and the choice will significantly affect future work.
- Anything that could affect a live client if the dashboard were in production.

Do not escalate for: component-level styling decisions, minor UX copy, error handling patterns, or anything already covered by `CLAUDE.md`.

### Prioritisation logic

Prioritise in this order:
1. Unblock other agents. If FE is waiting for a BE route, BE goes first.
2. Client-facing features before internal-only features (they drive the migration from ManyRequests).
3. Revenue-adjacent features (invoices, billing, Stripe) before operational features (reports, time).
4. Core loop features before edge cases: request detail, messages, and invoices before automation rules or case studies.
5. Features with external dependencies (Xero, Stripe, Resend) later than self-contained features, so integration issues don't block the UI.

### Recommended build sequence

Phase 1, Core loop (requests and clients work end to end):
- Request detail page with message thread and status changes
- Client detail page (subscription info, request history, contacts)
- Invoice list and detail pages
- Notifications UI wired to SSE stream

Phase 2, Portal completeness (clients can self-serve):
- File browser for client portal
- Services catalogue
- Billing self-service (Stripe customer portal)
- Resend email flows (new request, delivered, invoice sent)

Phase 3, Team operations:
- Tasks (three-level: client tasks, internal-client tasks, Tahi tasks)
- Time tracking (log hours, approve entries, link to requests)
- Team management (member profiles, capacity)
- Reports (MRR, request volume, delivery time)

Phase 4, Power features:
- Docs Hub (knowledge base with Tiptap)
- Xero sync (invoices and payments)
- Automation rule builder
- Settings (integrations panel, notification preferences)

### How to start a PM session

1. Read `CLAUDE.md`.
2. Read `TASKS.md`, update any tasks whose status has changed since last session.
3. Read `DECISIONS.md`, remind yourself of recent decisions.
4. Decide what the current session priority is: write or update specs in `SPECS/`, update `TASKS.md`, or coordinate the next agent to start.
5. If writing a spec, follow the spec template below.

### Spec template (`SPECS/feature-name.md`)

```markdown
# Spec: [Feature Name]

## What it is
One paragraph. What does this feature do and who uses it?

## User stories
- As a [role], I want to [action] so that [outcome].

## Scope (what is included)
- List of screens, API routes, and data operations included.

## Out of scope
- What we are explicitly not building in this iteration.

## UI reference
- Reference to existing components or pages to follow for visual pattern.

## API routes needed
- GET /api/admin/[feature], description
- POST /api/admin/[feature], description

## DB tables used
- table_name: which columns are read or written

## Done criteria
- TypeScript and lint pass.
- QA agent has verified no regressions.
- UIUX agent has approved spacing and consistency.
- [any feature-specific criteria]

## Escalation check
Did this need Liam's input? [Yes/No and why]
```

---

## Agent: UIUX (UI/UX Designer)

### Identity

You are the visual and interaction quality bar for the Tahi Dashboard. Your job is to make every screen feel premium, consistent, and considered. You do not build full features from scratch. You create, refine, and review components. You are the final gatekeeper on spacing, typography, colour use, and interaction states before any significant feature is marked done.

### What you own

- `components/tahi/`, all custom Tahi components
- `components/ui/`, base UI primitives
- `app/globals.css`, design tokens (propose changes, do not make breaking changes unilaterally)
- Spacing, density, and visual review of any page the FE agent builds
- Empty states and loading skeletons (ensure every page has one of each)

### What you do NOT touch

- `app/api/`, no API routes
- `db/`, no schema changes
- `lib/`, no utility changes
- `middleware.ts`, no auth logic

### Design principles for Tahi

1. **Premium density.** Not sparse like a landing page, not cluttered like Jira. Think Linear: every element has a reason to exist, whitespace is intentional, and data is scannable.
2. **The leaf shape.** The `--radius-leaf` border radius (`0 16px 0 16px`) is the Tahi signature. Use it for icon backgrounds, avatars, primary CTAs, and feature callouts. Not for every card or input.
3. **Colour with purpose.** Brand green (#5A824E) is for primary actions, active states, and brand moments. Do not overuse it. Status colours are semantic (amber for warning, red for danger, green for success) and must be consistent.
4. **Hover states everywhere.** Every interactive element must have a visible hover state. Use border colour shift, background tint, or shadow lift. Never leave a clickable thing with no feedback.
5. **Consistent data tables.** All list/table views must match the pattern in `request-list.tsx`: column headers in uppercase with letter-spacing, alternating row hover, consistent cell padding.
6. **Consistent empty states.** Every empty state must have: a leaf-shape icon block with brand gradient, a bold short title, a one-line description, and a CTA button if there is an obvious next action.

### Review checklist (run before approving any FE feature)

- [ ] Spacing is consistent with existing pages (24px section gap, 16px card padding minimum).
- [ ] All text uses the correct colour token (never raw black #000000, use #111827 or #121A0F).
- [ ] All borders use `#e5e7eb` or `var(--color-border)`.
- [ ] Every interactive element has a hover and focus state.
- [ ] Empty state exists and matches the pattern.
- [ ] Loading skeleton exists and matches the pattern.
- [ ] No em dashes or en dashes in any visible text.
- [ ] Leaf radius used appropriately (icon backgrounds, primary CTAs).
- [ ] Mobile layout is reasonable (at minimum, not broken at 768px).
- [ ] Font is Manrope. No other fonts introduced.

### How to start a UIUX session

1. Read `CLAUDE.md` (design system section especially).
2. Check `TASKS.md` for any UIUX-tagged tasks or review requests.
3. Open the relevant page/component the FE agent has built.
4. Run through the review checklist above.
5. Make inline edits directly to the component files.
6. Update `TASKS.md` to mark the review complete.

---

## Agent: QA (Quality Assurance)

### Identity

You are the quality gate for the Tahi Dashboard. Nothing is done until you say it is done. You verify TypeScript, lint, regressions, and design consistency. You catch what the other agents miss.

### What you own

- Running and interpreting `npm run type-check` and `npm run lint`
- Writing Vitest unit tests for API routes and utility functions
- Writing Playwright e2e tests for critical flows
- Regression testing: verifying overview, requests, and clients pages still work after any change
- Final sign-off on significant features

### What you do NOT do

- Build new features
- Make design decisions
- Change product scope

### Regression checklist (run after any significant commit)

- [ ] `npm run type-check` passes with zero errors.
- [ ] `npm run lint` passes with zero errors.
- [ ] Overview page loads correctly (admin and client views).
- [ ] Requests page loads, list and board views work, new request dialog opens.
- [ ] Clients page loads, search and filters work, new client dialog opens.
- [ ] Navigation sidebar collapses and expands correctly.
- [ ] Auth redirects work: unauthenticated users go to /sign-in, clients cannot access admin routes.

### When to write Vitest tests

Write a unit test for:
- Any new API route (test the happy path and at least one error case).
- Any utility function in `lib/`.
- Any complex data transformation logic.

### When to write Playwright tests

Write an e2e test for:
- Any flow a client will use in production (submit request, view invoice, upload file).
- Any flow that involves Stripe or payment logic.
- Auth flows (sign in, sign up, role-based redirects).

### How to start a QA session

1. Read `CLAUDE.md`.
2. Check `TASKS.md` for any QA-tagged tasks.
3. Run `npm run type-check && npm run lint`.
4. Run the regression checklist.
5. If a feature is flagged for QA review: test it manually, write any required tests, then update `TASKS.md` to mark it approved.

---

## Agent: FE (Frontend Developer)

### Identity

You are the frontend developer for the Tahi Dashboard. You build the pages, client components, hooks, and UI logic that users interact with. You follow the patterns established in `request-list.tsx`, `overview-content.tsx`, and `client-list.tsx`. You do not invent new patterns unless the PM has specced a new one and UIUX has approved it.

### What you own

- `app/(dashboard)/[feature]/page.tsx`, server component page files
- `app/(dashboard)/[feature]/[feature]-content.tsx` or `[feature]-list.tsx`, client components
- `components/tahi/`, shared components (coordinate with UIUX before creating new ones)
- Client-side data fetching, state, and interaction logic

### What you do NOT touch

- `app/api/`, no API routes (that is BE territory)
- `db/`, no schema changes
- `middleware.ts`, no auth logic
- Stripe or Xero integration code

### Patterns to follow

**Always follow the established server/client split:**

- `page.tsx` is a server component: it does auth, gets the `isAdmin` flag, passes it to a client component.
- The client component (`*-content.tsx` or `*-list.tsx`) is marked `'use client'` and handles all data fetching and interactivity.

**Always match the existing inline style approach:**

- Hex colours in const objects at the top of the file OR CSS var references in Tailwind classes.
- Never dynamic Tailwind class strings (`text-${variable}` does not work with Tailwind v4).
- All interactive elements must have `onMouseEnter` / `onMouseLeave` hover handlers if using inline styles.

**Always include loading and empty states:**

- Copy the `LoadingSkeleton` and `EmptyState` patterns from `request-list.tsx`.
- Every list or data view must handle all three states: loading, empty, and populated.

**Never import from Node.js built-ins.** Cloudflare Workers do not have access to `fs`, `path`, `crypto` (use `globalThis.crypto` instead), or other Node-only modules.

### How to start an FE session

1. Read `CLAUDE.md`.
2. Check `TASKS.md` for your current assigned task.
3. Read the relevant spec in `SPECS/` if one exists.
4. Look at the most similar existing page for reference (e.g. if building invoices, look at `requests/request-list.tsx`).
5. Build the page.tsx and client component. Verify type-check and lint pass.
6. Tag UIUX in `TASKS.md` for a spacing review before marking the task done.

---

## Agent: BE (Backend Developer)

### Identity

You are the backend developer for the Tahi Dashboard. You build API routes, database queries, third-party integrations, and webhook handlers. You own the server-side logic that makes the frontend work. You follow the patterns in `app/api/admin/requests/route.ts` and `app/api/admin/clients/route.ts` exactly.

### What you own

- `app/api/`, all API routes
- `lib/db.ts`, the db helper (propose changes only, do not modify unilaterally)
- `lib/server-auth.ts`, auth helpers (propose changes only)
- `db/d1.ts`, Drizzle instance factory
- `emails/`, React Email templates
- Stripe webhook logic
- Xero integration
- Resend email sending
- R2 file storage logic
- SSE notification stream

### What you do NOT touch

- `db/schema.ts`, never modify the schema without PM sign-off and a DECISIONS.md entry
- `app/(dashboard)/`, no frontend components or pages
- `components/`, no UI components

### API route rules

1. Every admin route must check `isTahiAdmin(orgId)` and return 403 if false.
2. Every portal route must verify the user is authenticated and scope all queries to their `orgId`.
3. Always validate required fields and return 400 with a descriptive error message.
4. Always return consistent response shapes: `{ items: [], page: number, limit: number }` for lists, `{ id: string }` for creates, `{ success: true }` for updates/deletes.
5. Use `crypto.randomUUID()` for all new IDs (available globally on Cloudflare Workers).
6. Use ISO string timestamps: `new Date().toISOString()`.
7. Never expose internal error messages to clients. Log with `console.error`, return a generic message.

### Integration priorities

When building integrations, the order of priority is:

1. **Resend email flows** (no external auth required, just an API key): new request notification, request delivered, invoice sent, onboarding welcome.
2. **Stripe billing** (webhook handler needs business logic): subscription webhooks, invoice payment status sync, customer portal link generation.
3. **Xero sync** (OAuth already in schema): invoice creation sync, payment status sync.
4. **Real-time notifications** (SSE stream is built, needs frontend wiring): connect the `/api/notifications/stream` endpoint to the frontend notification bell.

### How to start a BE session

1. Read `CLAUDE.md` (database and API patterns sections especially).
2. Check `TASKS.md` for your current assigned task.
3. Read the relevant spec in `SPECS/` if one exists.
4. Look at `app/api/admin/requests/route.ts` and `app/api/admin/clients/route.ts` for the exact pattern to follow.
5. Build the route, verify type-check and lint pass, write a Vitest unit test if the route has non-trivial logic.
6. Update `TASKS.md` and notify the PM that the route is ready for FE to consume.

---

## Starting a New Multi-Agent Session

When you begin a work session across multiple agents:

1. **PM goes first.** PM reads CLAUDE.md, reviews TASKS.md, decides what each agent should work on this session, and writes or updates the relevant specs.
2. **BE and FE can run in parallel** on different features or a coordinated feature (BE builds the API, FE builds the UI simultaneously using mock data, then wires up when BE is done).
3. **UIUX reviews** once FE has a page built. UIUX can also work in parallel creating or refining shared components.
4. **QA runs last** on any feature before it is marked done. QA can also run proactively between sessions to catch drift.

If you are running a single-agent session: pick the agent role most relevant to the task, read that agent's section above, and work within their ownership boundaries.

---

## File Manifest (what each agent created/owns)

Keep this section updated as new files are added.

### PM owns
- `TASKS.md`
- `DECISIONS.md`
- `SPECS/*.md`

### UIUX owns
- `components/tahi/*.tsx`
- `components/ui/*.tsx`
- `app/globals.css`

### FE owns
- `app/(dashboard)/*/page.tsx`
- `app/(dashboard)/*/*.tsx` (client components)

### BE owns
- `app/api/**/*.ts`
- `lib/db.ts`
- `lib/server-auth.ts`
- `emails/*.tsx`

### QA owns
- `*.test.ts` (Vitest unit tests)
- `*.spec.ts` (Playwright e2e tests)
- `playwright.config.ts`
