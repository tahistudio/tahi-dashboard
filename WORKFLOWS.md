# Workflows — Tahi Dashboard

The dashboard is the place Liam runs the agency from. Each workflow below is a recurring thing he does that the dashboard should both **help him do** and **record** for later context.

This doc drives feature confidence. Pick a workflow, tighten everything along its path, mark it done.

---

## How to read this doc

Each workflow has:

- **Steps** — what happens, in order
- **Surfaces** — the dashboard pages / components involved
- **Status** — `design ✓` / `data ✓` / `feature ✓` for each surface
- **Open issues** — anything broken or missing today

A workflow is **`shipped`** only when every surface in its path is `design ✓ + data ✓ + feature ✓` AND Liam has used it end-to-end on the deployed site without falling back to email / Slack / spreadsheet.

---

## Workflows

### Discovery call

> Liam jumps on a discovery call with a prospect. The dashboard should remind him what to ask, record what happened, and turn the call into a deal + next steps.

**Steps:**
1. Open the prospect's record (search or pipeline)
2. Skim previous context (emails, notes, last touch)
3. Conduct the call (probably outside the dashboard for now)
4. Log call notes, decisions, next action
5. Capture budget / timeline / fit signals
6. Either: create a deal, schedule follow-up, or archive

**Surfaces:**
- Search palette (find prospect quickly)
- Client / contact detail page
- Activity timeline
- Call detail (`scheduled_calls`)
- Deal create flow
- Tasks (next action)

**Status:** (todo)

**Open issues:** (todo)

---

### Making a deal

> A prospect commits. Liam needs to spin up the proposal, contract, and onboarding.

**Steps:**
1. Move deal to `verbal_commit` / `negotiation` in the pipeline
2. Draft proposal from a template
3. Share proposal with the client
4. Capture acceptance
5. Generate contract
6. Send contract for signing
7. On signing: kick off onboarding (welcome email, mailerlite add, hubspot sync, etc.)

**Surfaces:**
- Pipeline (board + detail)
- Proposals (templates, draft, share)
- Contracts (templates, send, sign)
- Onboarding checklist
- Integrations (Mailerlite, HubSpot, Slack)

**Status:** (todo)

**Open issues:** (todo)

---

### Running a project (PM)

> A live engagement. Liam needs to know what's in flight, what's blocked, what's due, and who's doing what.

**Steps:**
1. Daily glance at active requests + tasks + capacity
2. Triage incoming requests (assign, prioritise, schedule)
3. Update statuses, comment on threads
4. Track time against work
5. Handle scope changes (flag, re-quote, re-schedule)
6. Deliver work, mark complete

**Surfaces:**
- Overview (KPIs, today's focus)
- Requests (board + detail)
- Tasks (three-level)
- Time tracker
- Schedules / Gantt
- Capacity
- Messages

**Status:** (todo)

**Open issues:** (todo)

---

### Sending an invoice / getting paid

> Either a manual one-off invoice or a recurring retainer. Stripe + Xero in the mix.

**Steps:**
1. Decide what to bill (project, retainer, hourly)
2. Generate invoice (manual, Stripe, Xero auto-gen)
3. Send to client
4. Track status (sent → viewed → paid → overdue)
5. Reconcile payments

**Surfaces:**
- Invoices (list + detail)
- Billing
- Stripe + Xero integrations
- Time entries (for hourly billing)

**Status:** (todo)

**Open issues:** (todo)

---

### Daily ops (the morning kick)

> Liam opens the dashboard first thing. What should it tell him?

**Steps:**
1. What needs my attention today
2. What's overdue
3. What's coming up (calls, deadlines)
4. Team workload — is anyone overloaded
5. Any new client requests, replies, or escalations

**Surfaces:**
- Overview / AI briefing
- Notifications
- Upcoming calls
- Recent requests + replies
- Pipeline at-a-glance
- Team capacity

**Status:** (todo)

**Open issues:** (todo)

---

### Onboarding a new client

> A deal closed. The client now needs portal access, project setup, kickoff comms.

**Steps:**
1. Create the org + first contact
2. Set plan, tracks, billing model
3. Send welcome email + portal invite
4. Add to Mailerlite
5. Mirror to HubSpot
6. Set up the first project + schedule
7. Schedule kickoff call

**Surfaces:**
- Clients (create + detail)
- Subscriptions / Tracks
- Integrations (Mailerlite, HubSpot)
- Schedules / Templates
- Calls

**Status:** (todo)

**Open issues:** (todo)

---

### Team management

> Hiring, assigning, reviewing.

**Steps:**
1. Add team member (Clerk + team_members row + access scoping)
2. Assign rights (project_manager / task_handler / viewer)
3. Scope to specific clients or plans
4. Review their utilisation / hours

**Surfaces:**
- Team page
- Team member access (scoping rules)
- Capacity
- Reports (utilisation)

**Status:** (todo)

**Open issues:** (todo)

---

## Adding a workflow

When Liam mentions a new recurring activity, add it here with the template:

```
### <Workflow name>

> One-line description of what he's trying to accomplish.

**Steps:** 1..N

**Surfaces:** which pages / components

**Status:** design ✓ / data ✓ / feature ✓ per surface

**Open issues:** specific things broken today
```

Then pick one workflow per session, tighten it to `shipped`, and check it off.
