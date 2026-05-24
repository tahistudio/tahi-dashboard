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

## Build order (the lifecycle, in sequence)

The lifecycle-driven roadmap. Each phase compounds on the data captured by the previous one, so order matters — building Proposals before Lead intake means proposals start with no upstream context.

### Phase A · Sales CRM foundation (next up)

1. **Lead intake + qualification** — `leads` table, manual + Webflow form intake, qualifying flow. Pre-pipeline.
2. **Discovery call surface** — notes, signals, transcript upload (from Google Meet), next action. Outcome routes to: promote to deal OR archive.
3. **Calls log** — upcoming + past calls with prep notes, transcripts, attendees.
4. **Pipeline polish** — bring the existing pipeline page through the new design system. Pipeline becomes *post-discovery only* (qualified deals).

### Phase B · CRM depth (right after foundation)

5. **Gmail sync + email tracking** — Google OAuth, pull emails per contact, track opens / clicks on outgoing dashboard mail.
6. **AI deal scoring** — score deals on probability + suggested next action using deal + activity + call signals.
7. **Contact enrichment** — pull LinkedIn / company data when a lead is created (best-effort, via an enrichment API).

### Phase C · Affiliate program (replace Rewardful before ManyRequests cutover)

8. **Affiliates table** — 12 partners today; flat 10% per qualified lead that closes.
9. **Referral codes + tracking links** — `/r/{code}` cookies the visitor for attribution on lead capture.
10. **Attribution + payout tracking** — when a deal closes, credit the cookied affiliate. Manual mark-paid for v1; payment processor integration later (Liam may change Stripe).
11. **Affiliate portal** — small surface where affiliates see their referrals + commissions owed.

### Phase D · Marketing email CRM (Mailerlite replacement, deferred)

Low urgency: 4 campaigns/year + 3.7k subscribers + Mailerlite still works.

12. **Subscriber + list + segment tables** — natively in the dashboard. Sync OUT to Mailerlite (or send via Resend) so the dashboard is the source of truth.
13. **Forms + signup endpoints** — Webflow-form-to-subscriber webhook + unsubscribe page.
14. **Campaign composer + send** — pick a list/segment, write, schedule, send via Resend.
15. **Analytics** — opens / clicks / unsubscribes per campaign, per subscriber.

### Phase E · Productisation (existing surfaces, post-CRM)

Pipeline → Proposal → Schedule → Contract → Onboard → Deliver → Invoice → Upsell. These are mostly built; each gets a design-system polish lap once the lead/discovery flow is feeding them.

16. Proposals polish + AI draft from discovery
17. Schedules polish
18. Contracts polish
19. Onboarding checklist polish
20. Requests / Tasks / Messages / Time (the "Running a project" workflow)
21. Invoicing polish + Stripe + Xero reconciliation
22. Upsell prompts (retainer hours nearly out, etc.)

### Phase F · Messaging & social (much later — only after daily-trusted CRM)

Not a priority. Slated for after the dashboard becomes the daily driver for sales + delivery. Listed here so the architecture decisions land in writing.

23. **Buffer integration for social posts + scheduling** — use Buffer (Essentials tier or Free if 3k requests/month is enough) via their API. Dashboard surfaces a "social pipeline" view: scheduled posts, published posts, engagement rollup. Don't build a scheduler ourselves.
24. **Beeper API + MCP for unified DM inbox** — LinkedIn / WhatsApp / Slack / SMS in one place via Beeper. Three-defence privacy model so personal threads stay private:
    - **Per-account whitelist** in Settings → Inbox. Tick only work Beeper accounts.
    - **CRM-match filter as default** — threads only surface when the counterparty matches a lead / contact / org in the CRM. Friend texting "want a coffee?" never appears.
    - **Explicit opt-in** before any DM gets logged as an activity on a lead/deal. Auto-link suggests; Liam confirms.
    Actual chatting still happens in Beeper Desktop / native apps; the dashboard just tracks threads tied to records.
25. **LinkedIn outreach tracking (manual send, automated tracking)** — at low volume (Liam's scale: 3-10 leads/month), no need for a tool like Heyreach or Expandi. Use LinkedIn Premium directly to send connection requests + InMail, log each as an activity on the lead. Dashboard surfaces "follow up in 4 days" tasks. Auto-send is off the table (LinkedIn rate-limits or bans).
26. **Low-volume cold email outreach** — also manual send. Dashboard tracks sent / replied / no-response per lead so Liam doesn't double-touch. Volume stays under 20 emails / week / domain so the email reputation isn't burned.

### Phase G · Sales conversion levers (2026-05-24, after Phase B)

Decided 2026-05-24 after a "what would actually help" review. Inbound is THIN (Webflow Partner leads dried up when minimum moved from $2.5k → $5k USD; Tahi's own website doesn't generate leads because it needs redesign + SEO). So the lever is NOT volume automation — it's making every inbound count.

27. **AI-drafted first reply on new inbound** — when a lead lands, Sonnet drafts a personalised reply in Liam's voice using the existing enrichment (snapshot + signals + scope). Lands on his phone via push / Resend; he taps Send or Edit. Cuts speed-to-response from hours to ~30 seconds. Industry stat: 9× conversion lift when replying within 5 min vs 1 hour.
28. **Pre-call digest** — 30 min before each Calendar-synced call, the AI briefing + 6 questions + last activity items lands in Liam's inbox / SMS. Never have to remember to open the dashboard for prep. Trivial to build once Calendar OAuth is live.
29. **Discovery → Proposal → Contract → Tasks pipeline** — the big one. After a discovery call, the dashboard generates:
    a. **AI-draft proposal** from transcript + scope notes + enrichment + Tahi's pricing logic + existing proposal templates. Liam edits, then sends within an hour of the call ending.
    b. **Capacity check baked in** — uses live capacity data to propose a realistic timeline ("you're at 65% this month, propose 6-week not 3").
    c. **Accept → auto-generate contract** from the proposal sections + Tahi's template library + the agreed scope. Liam reviews + sends for signature.
    d. **Sign → auto-create tasks + requests** with scope items as the work breakdown. Project kicks off without manual setup.
    Path to "1 hour from discovery to proposal sent, 1 day from accept to project kicked off." Multi-day build in slices.
30. **Affiliate reactivation prompts** — 12 affiliates on the books, most likely 2 active. Monthly cron: "[Affiliate name] hasn't sent a lead in 90 days, draft a check-in email?" with an AI-drafted message. Cheap, real revenue lever (1-2 reactivations a year = thousands in commission flow).
31. **Lead reactivation (DEFERRED)** — re-score archived leads weekly. Deprioritised because thin inbound volume = small archived pool. Revisit when archived > 50 leads.

### Content + presence (low priority but written down)

Liam's stated goal (2026-05-24): 1 newsletter / month + 1 LinkedIn post / day. Real value, not noise. Dashboard can help by surfacing patterns from the lead/customer data (common pain points, tech-stack distribution, etc.) as content prompts. Build as a "Content Studio" surface once the sales loop is locked.

---

## Workflows

### Maintaining the knowledge base (Docs Hub) — **shipped 2026-05-23 ✓**

> Liam captures and finds operating docs, brand notes, services, sales playbooks, team SOPs, and product notes. The dashboard is the source of truth — not Notion, not Google Docs, not Slack threads.

**Steps:**
1. Open `/docs`
2. Filter by category (multi-select chip) or search title + content
3. Click a row → slide-over preview opens
4. Edit inline (or create new) with the Notion-grade editor
5. Review version history; click any version to view its content

**Surfaces:**
- Docs Hub page (`app/(dashboard)/docs/docs-content.tsx`)
- DataTable + FilterBar (multiselect, nonRemovable Categories chip)
- SlideOver (56rem) for view + edit + version history
- TiptapDocEditor (top toolbar, bubble menu on selection, slash commands, task lists, image)
- ConfirmDialog for destructive deletes

**Status:** design ✓ · data ✓ · feature ✓ · live-tested ✓

**Locked.** Do not change without explicit request. Past iterations covered: edit-bug fix, table layout, multi-category support, FilterBar multi-select extension, capped chips, wider slide-over, clickable historical versions, Notion-grade editor rebuild, white-card row surface.

---

### Lead intake & qualification (Phase A · 1-2)

> A new lead arrives — Webflow form, email referral, affiliate link, manual entry. Liam needs to capture it, then decide whether to pursue.

**Steps:**
1. Lead lands as a row in the `leads` table (manual quick-add OR Webflow form webhook OR affiliate referral)
2. Captures: name, email, company, source, brief, deal-size estimate, owner (default Liam)
3. Auto-creates "Schedule discovery call" task with 48h SLA
4. Liam reviews lead list, triages: pursue / nurture / archive
5. On "pursue": schedules the discovery call

**Surfaces:**
- `/leads` index page (DataTable + FilterBar pattern from Docs Hub)
- Lead detail (slide-over with capture form + activity)
- `leads` schema (new)
- Webflow form webhook receiver
- Affiliate referral capture (Phase C)

**Status:** (not started — first build for Phase A)

**Open issues:**
- Webflow form fields not mapped yet
- Decide schema: separate `leads` table OR re-use `deals` with a pre-pipeline stage. Lean: separate table (clean conversion metrics, easy archive)

---

### Discovery call (Phase A · 2)

> Liam jumps on a discovery call with a prospect. The dashboard should remind him what to ask, record what happened, and turn the call into a deal + next steps.

**Steps:**
1. Open the lead's record (search or `/leads`)
2. Review prep: brief, previous emails, source
3. Conduct the call (Google Meet, recorded)
4. Upload Google transcript afterwards (text paste OR file upload)
5. Log signals: budget, timeline, fit, decision-maker, objections
6. Pick outcome:
   - **Promote to deal** → creates a deal in pipeline at "Verbal interest" stage, copies discovery context forward
   - **Nurture** → schedule next-touch task
   - **Archive** → mark lead as dead with reason

**Surfaces:**
- Lead detail slide-over
- Calls log surface (new)
- Discovery notes editor (Tiptap with prompts as placeholder text)
- Transcript upload (file/text paste, stored in R2)
- Pipeline (deals)

**Status:** (not started — Phase A · 2)

**Open issues:**
- Transcript parsing: keep as raw text first, AI summary later (Phase B)

---

### Calls log + meeting prep (Phase A · 3)

> Liam needs to see what calls are coming up today / this week, who they're with, what to prep, and after the call upload the transcript.

**Steps:**
1. Liam opens `/calls` (or sees today's calls on Overview)
2. Each call shows: when, who, lead/deal context, prep notes, agenda
3. After the call: upload transcript, capture outcome, fire follow-up tasks
4. Past calls remain searchable, linked to the lead/deal

**Surfaces:**
- `/calls` index (DataTable, upcoming + past tabs)
- Call detail slide-over (prep notes, attendees, transcript, outcome)
- Existing `scheduled_calls` schema
- Overview integration (today's calls widget)

**Status:** (data partly built — `scheduled_calls` table exists; UI is stub)

**Open issues:**
- Decide: Google Calendar OAuth sync, or manual entry? Lean: manual for v1, calendar sync in Phase B
- Transcript storage: R2 as file OR text in DB? Lean: text in DB for search, file in R2 if too long

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

### Gmail sync + email tracking (Phase B · 5)

> Liam wants every email to/from a contact visible on their record, plus tracking on emails sent from the dashboard.

**Steps:**
1. Connect Gmail via Google OAuth (per-user, stored in `integrations`)
2. Background sync pulls recent inbox + sent items, matches by email address, attaches to contact
3. New emails from contacts surface as activity events
4. Emails sent FROM the dashboard (transactional via Resend) get open/click pixels and link wrapping
5. Per-contact view shows full email thread history

**Surfaces:**
- Settings → Integrations (Google OAuth)
- Contact / lead / deal detail pages (activity timeline)
- New `email_messages` table linking to contacts/leads/deals
- Resend webhook receiver for open/click events

**Status:** (not started — Phase B · 5)

**Open issues:**
- OAuth scope: read-only inbox + sent? Or also send-on-behalf? Lean: read-only first
- Privacy: this surfaces everyone's emails to anyone who can see the contact. Need access scoping
- Volume: 3.7k contacts × ~10 emails each = manageable. Background sync runs nightly + on-demand

---

### AI deal scoring + contact enrichment (Phase B · 6-7)

> Score deals on probability + suggested next action. Enrich new leads with company / role data.

**Steps:**
1. When a lead is created or updated, fire an AI scoring job using: source, signals from discovery, deal value, owner, time-in-stage, last activity recency
2. Show score on lead/deal card (0-100) plus a one-line "next action" suggestion
3. When a lead is created, enrich automatically: company size, industry, LinkedIn URL via an external API (Clearbit / Apollo / People Data Labs)
4. Surface enriched fields on the contact record

**Surfaces:**
- Lead + deal detail pages (score badge, next-action callout)
- Contact detail (enriched fields section)
- New `lead_score` + `enrichment_data` columns OR separate tables
- Settings → AI provider, enrichment provider

**Status:** (not started — Phase B · 6-7)

**Open issues:**
- Which AI provider? Anthropic (already in stack via MCP) is the obvious lean
- Enrichment cost: pick a provider that lets you pay per-lookup, not per-seat
- Privacy + GDPR: enrichment pulls public data but check the provider's terms

---

### Affiliate program (Phase C · 8-11)

> Replace Rewardful before ManyRequests cutover. Simple model: anyone who refers a lead that closes gets 10% of the first invoice. 12 affiliates today.

**Steps:**
1. Liam creates an affiliate record (name, email, referral code, commission rate, payment method)
2. Affiliate gets a unique URL: `tahi.studio/r/{code}` that cookies the visitor
3. When a lead lands (from a cookied visitor), the referral is attributed to the affiliate
4. When the lead converts to a closed deal with paid first invoice, commission is owed
5. Liam reviews owed commissions, marks paid (manual payout v1; payment-system integration later)
6. Affiliate sees their referrals + commissions in a small portal surface

**Surfaces:**
- `/affiliates` admin index (DataTable + FilterBar)
- Affiliate detail (referrals list, commission ledger)
- New `affiliates` + `affiliate_referrals` + `affiliate_commissions` tables
- `/r/{code}` redirect route that sets a cookie
- Lead intake reads the cookie to attribute on capture
- Affiliate portal (small, under `/p/affiliate/{token}`)

**Status:** (existing `/affiliates` page reads from Rewardful; needs full replacement)

**Open issues:**
- Commission model: per-lead flat? Per first invoice? Per recurring monthly? Liam said "10% per lead that closes" — clarify: one-time on first invoice, or recurring on every payment? Lean: one-time on first invoice (Rewardful's "first payment" model)
- Cookie window: 30 days standard
- Payout method: hold off on integration; Liam may change Stripe. Manual PayPal / bank transfer notes for v1

---

### Marketing email CRM (Phase D · 12-15, deferred)

> Eventually replace Mailerlite. Low urgency: 4 campaigns/year. Build the data layer first, keep Mailerlite as the send engine until usage proves the design.

**Steps:**
1. Subscribers + lists + segments live in the dashboard (source of truth)
2. Sync OUT to Mailerlite (push new subs, push unsubscribes) OR send via Resend directly
3. Webflow forms + portal signup add to subscriber list
4. Unsubscribe link in every email points at a dashboard page that flips status
5. Liam composes a campaign, picks list/segment, schedules + sends
6. Analytics roll up opens / clicks / unsubscribes per campaign

**Surfaces:**
- `/subscribers` (DataTable + FilterBar)
- `/lists` + `/segments`
- `/campaigns` (compose, schedule, send)
- New `subscribers`, `email_lists`, `email_list_members`, `email_campaigns`, `email_events` tables
- Unsubscribe endpoint
- Resend integration for sending OR Mailerlite sync-out

**Status:** (not started — Phase D, deferred)

**Open issues:**
- Send infrastructure: Resend handles low-volume (Liam's 4 campaigns/year easily). For higher volume, may need a dedicated transactional/marketing sender
- Deliverability: domain reputation, SPF/DKIM/DMARC already set up for transactional emails — broadcast may need extra checks
- Campaign builder: rich-text via Tiptap is easy; visual block builder is a big lift. Lean: start with rich-text, defer block builder

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
