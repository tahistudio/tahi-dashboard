# North-star: Sales → Onboarding → Delivery, integrated end-to-end

*Captured 2026-05-07 from a Liam voice memo. Not a sprint backlog — a vision document. Pieces of this will land across many phases. Use it as the lens when scoping individual features so each one moves the whole flow forward, not sideways.*

---

## The single thesis

A client's experience with Tahi Studio should feel like one continuous surface from first discovery call to ongoing delivery. No re-keying of information. No "let me find that proposal we sent". No handover gap where context evaporates. Sales work compounds into delivery work compounds into retainer work, and the dashboard is the spine that holds it together.

When this is built right, the overhead between "interested prospect" and "signed-and-onboarded client" drops to almost nothing — and every artifact (notes, proposal, schedule, contract, requests, tasks) is auto-derived from the call before it.

---

## The integrated flow, end-to-end

```
  Inbound lead
        │
        ▼
  Deal created in pipeline
        │
        ▼
  Discovery call
   ├─ Pre-call: AI suggests questions to ask based on deal context
   ├─ Replicable call-prep template ("intake notes")
   ├─ During: notes captured against the deal
   └─ Post-call: AI scores call quality, surfaces what's still missing
        │
        ▼
  Project calculator
   ├─ Reads deal + discovery notes + cost-of-services + capacity + pipeline pressure
   ├─ AI suggests a price band; admin can override or input manually
   └─ Result: variant pricing draft for the proposal
        │
        ▼
  Proposal auto-drafted
   ├─ Sections seeded from discovery notes (what we heard, opportunity, scope)
   ├─ Variants seeded from calculator
   ├─ Schedule auto-attached (timeline auto-generated from variant + capacity)
   └─ Admin reviews, edits, sends
        │
        ▼
  Client accepts proposal + variant
        │
        ▼
  Contract auto-built from accepted proposal
   ├─ Inherits scope, price, dates, signers from the proposal
   └─ One click → sent for signature
        │
        ▼
  Contract fully signed
   ├─ Signed PDF emailed to all parties (audit-trail attachment)
   ├─ On the project's launch date:
   │     ├─ Client added as a real org with portal access
   │     ├─ Onboarding email triggered
   │     ├─ Subscription / track allocation set up from the variant
   │     └─ Internal Tahi tasks generated from the schedule
   └─ Status → 'onboarding'
        │
        ▼
  Onboarding flow
   ├─ Loom welcome video embedded on the portal
   ├─ Guided tour of the portal: how to make requests, how to use AI chatbot for request capture, where to see invoices, where to see schedule progress
   ├─ Pre-seeded request types based on their plan
   └─ "Done" state when the client makes their first real request
        │
        ▼
  Delivery (steady state)
   ├─ Client makes requests via portal or AI chatbot
   ├─ Internal team works through them via the kanban / task system
   ├─ Schedule progress overlay shows "you are here" against the original Gantt
   ├─ Recurring billing fires on cadence
   └─ Health score auto-updates from response time + ticket flow
```

---

## Per-stage detail

### 1. Discovery call workflow

- **Calls tab** in the dashboard. Shows the week's calls in calendar form. Each call linked to its deal.
- **Pre-call AI brief**: button on the call card. Reads the deal's notes, source, value range, prior interactions. Generates 5-10 questions Liam should ask to fill known gaps. Tunable per call ("be more aggressive on budget" / "focus on technical fit").
- **Replicable call-prep template**: structured note template (intro / context / pain / current setup / decision criteria / timeline / budget / next step). Same template every call so notes stay comparable.
- **Live note-taking**: notes saved against the deal, not a separate entity. Markdown supported.
- **Post-call AI quality score**: reads the notes after the call ends. Returns a 0-100 score on call completeness ("you didn't get the timeline budget anchor"), with one specific follow-up suggestion.

### 2. Project calculator

- Lives in the Sales sidebar group (already named in `project_contract_calculator.md` memory — that calculator and this one are the same thing).
- **Inputs**:
  - Discovery notes (parsed by AI for scope size hints)
  - Deal stage + value range
  - Cost-of-services (admin-maintained: what each service line actually costs Tahi to deliver, in dev hours, design hours, contractor cost)
  - Pipeline pressure (how loaded the upcoming weeks are — feeds into urgency premium)
  - Capacity (open track slots for maintain / scale / hourly)
- **Two modes**:
  - **AI mode**: feeds the inputs through an LLM with a pricing prompt; surfaces 1-3 variants (e.g. Foundation / Lift / Scale) with one-off + monthly figures, scope per variant, and reasoning.
  - **Manual mode**: admin types in line items. AI suggests "you might be missing: …" but doesn't drive.
- **Output**: a draft proposal pre-filled with these variants. Admin reviews and ships.

### 3. Proposal → schedule → contract chain

- **Proposal** picks up: client metadata, variant pricing, sections (auto-drafted from discovery notes via the AI brief).
- **Schedule** auto-attached when the proposal is created. Schedule's variants list mirrors the proposal's variants. Timeline auto-generated from the chosen variant's scope + Tahi's capacity.
- **Contract** auto-built when a variant is accepted. Inherits:
  - Org + deal links
  - Body terms (from the matching template — NDA / SLA / SOW depending on the variant)
  - Signers (Tahi side: Liam; Client side: the contact who accepted)
  - Effective date = today; expiry = end of the contracted period
  - Variable substitution: client name, project name, scope summary, price all auto-filled
- One-click "Send for signature" because every input was already known.

### 4. Auto-onboarding on launch date

- **Trigger**: cron job + contract status = 'signed' + project's launch date hits today.
- **Actions**:
  - Org status flips from 'prospect' to 'active'
  - Contact records get portal access (Clerk org seat created)
  - Onboarding email sent (welcome template — already redesigned recently, just needs the trigger)
  - Subscription/track records created from the accepted variant
  - Internal Tahi-side tasks auto-generated from the schedule's gantt rows (tagged "from schedule {id}")
  - Mailerlite sync — client added to "Active clients" list (until we migrate Mailerlite into the dashboard)
  - HubSpot sync — contact tagged 'client', deal closed-won
- **Onboarding state machine** lives on the org row. States: not_started → email_sent → tour_started → first_request_made → done. Each step gates the next.

### 5. In-portal onboarding tour

- Embedded into the client portal once they first sign in.
- **Loom welcome video** at the top (the existing onboardingLoomUrl on the org gets used here).
- **Guided tour** with overlay tooltips. Steps:
  1. "This is your dashboard. Here's where you'll see everything we work on for you."
  2. "Make a request" — show the request form.
  3. "Or just talk to the AI chatbot" — open the chatbot, demo a sample prompt that ends in a request being created.
  4. "Here's your schedule. Here's where the team is right now in the timeline."
  5. "Invoices live here. So do shared files."
  6. "Done. Make your first real request whenever you're ready."
- Tour can be skipped + replayed from settings.

### 6. Post-onboarding steady state

- Client uses the portal as normal.
- Internal Tahi side sees their requests as inbound work, owned by an assigned PM, queued into kanban.
- The original schedule keeps a live progress overlay — "you are here" line drawn through the Gantt as time passes, status of each row updated based on linked task completion.
- Health score auto-updates from response-time, on-time-delivery, ticket-flow, billing-paid-on-time signals.

### 7. Migrations from external tools

- **Mailerlite → dashboard CRM**. Goal: kill the duplicate contact list. Currently we sync ONE-WAY (dashboard auto-adds clients to a Mailerlite list). One day, the dashboard becomes the source of truth and Mailerlite becomes the email-blast tool that reads FROM us. Implies: a contact-with-tags model, segments, broadcast composer in the dashboard. Probably a Phase 13+ thing.
- **Get Rewardful → custom referral / affiliate program**. Today: every contract has a 10% referral kickback option managed externally. Goal: the dashboard owns the referral relationship. Affiliate signs up as a partner type, gets a referral link / code, dashboard tracks attributions, payouts fire automatically. Implies: partner schema, referral attribution, payout queue, Stripe Connect for partner payouts. Long-term.

---

## Open design questions (need to nail down before building)

### A. Gated content for users

What does a logged-in client see vs. a prospect vs. an internal team member vs. an admin? Today the dashboard is binary — admin or "client of any kind". The flow above implies more nuance:

- **Anonymous viewer** with a token (proposal / schedule / contract sign link). Sees only what the token grants.
- **Prospect contact** (deal in pipeline, no contract yet). Should they have any portal access? Probably not — they only ever see public-share links.
- **Active client primary contact**. Full portal: requests, schedule, invoices, files, messages.
- **Active client secondary contact**. Same as primary minus the billing tab.
- **Internal Tahi team member**. Scoped to their assigned clients (the team-member-access table from CLAUDE.md Planned Schema Additions Batch 2).
- **Tahi admin (Liam, Staci)**. Everything.
- **Affiliate partner**. New role. Sees their referrals, their commissions, their payout queue.

→ **Decide before scaling**: how many roles, what each one sees, whether roles are per-org or global.

### B. Permission levels per user

Per-user overrides on top of the role:
- Can edit proposals: yes/no
- Can send emails on behalf of Tahi: yes/no
- Can see financials: yes/no
- Can publish to the public viewer: yes/no
- Can create deals: yes/no

→ **Decide before scaling**: a flat per-user matrix vs. preset role tiers vs. capability tags.

### C. Interconnected flow — the trigger graph

Every transition above ("contract signed → onboarding email") is a trigger. We have an `automationRules` table already. The question: is this the right primitive for these sales-to-delivery transitions, or do we need a stricter, hand-coded state machine because the chain is too important to leave in user-editable rules?

→ **Probably**: hand-coded for the critical path (contract.signed → org.activate, contract.fully_signed → email_pdf, schedule.launch_date → onboarding_start). Automation rules layer on top for the configurable pieces (welcome email content, which Mailerlite list, etc).

### D. Onboarding state ownership

Where does onboarding state live? On the org row (`onboardingState` exists already as a JSON field per CLAUDE.md). What writes to it: a state machine triggered by external events (contract signed, first request submitted) or polled (cron checks for "tour started >7 days ago, not done")?

→ **Lean toward**: event-driven for known transitions, cron-polled for nudges and reminders.

### E. Contract → schedule attachment

A schedule can be attached to a proposal variant (via `proposal_variants.timelineScheduleId`). Once a contract is signed, does the schedule clone or stay linked? If the timeline shifts mid-project, does the contract reflect the original or the live state?

→ **Lean toward**: contract snapshots the schedule at signing for legal record. Live schedule continues to update for delivery purposes. Two pointers on the contract: `scheduleSnapshot` (immutable) and `scheduleLive` (mutable link).

---

## Why this matters

Every minute saved in the sales-to-onboarding pipeline compounds. A single discovery call that auto-produces a costed proposal + draft schedule + ready-to-send contract turns a 2-hour follow-up into a 15-minute review. That's not just speed — it's posture. Tahi shows up to a sales cycle with the deck already half-built. That posture is what wins high-end clients.

The same logic applies on the delivery side. A contract that auto-spawns the internal task list from the agreed schedule means no "okay so what do we actually need to do this week" meeting. The work is just there.

The risk to manage: each piece has to be GOOD, not fast. A bad auto-drafted proposal is worse than no auto-draft. A wrong onboarding email is worse than no email. Build each transition with the care of a real product feature, not a quick automation.

---

## How this informs the next 6 months of work

Phases already on the roadmap that feed this north-star directly:
- Phase 8b: Project / contract calculator (the AI cost calc)
- Phase 8d: Tasks / requests taxonomy refactor (auto-spawn tasks from schedules)
- Phase 8e: Contract polish (signed-PDF auto-email, auto-renewal flag)
- Phase 10: Operations layer (engagement signals, auto-flow on stage change, in-app question reply)
- Phase 11: Schedule → tasks bridge + live Gantt progress overlay
- Phase 9 (in progress): premium proposal redesign (so the auto-drafted output is worth sending)

New phases this doc surfaces:
- **Phase X**: Discovery call workflow (calls tab, pre-call AI brief, post-call quality score)
- **Phase X+1**: Auto-onboarding state machine + onboarding tour
- **Phase X+2**: Permission roles + gated content layer
- **Phase X+3**: Mailerlite migration (CRM contact + segment + broadcast in-dashboard)
- **Phase X+4**: Custom referral / affiliate program (replaces Get Rewardful)

The order isn't fixed yet. What matters is that each phase, when scoped, gets read against this doc to ask: does this move the integrated flow forward, or sideways?
