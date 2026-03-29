# Spec: CRM Pipeline (HubSpot Replacement)

## What it is

A built-in CRM that replaces HubSpot for tracking sales deals, contact activities, meeting notes, and revenue forecasting. Tahi admins use it to manage leads through a pipeline, log interactions with contacts and companies, and forecast revenue. This feature extends the existing organisations and contacts tables rather than duplicating them. It also introduces proper multi-currency support and expands the brand/org management model.

## User stories

- As an admin, I want to see all my deals on a Kanban board so I can track where each prospect sits in the pipeline.
- As an admin, I want to drag a deal between pipeline stages so I can update its status quickly.
- As an admin, I want to open a deal detail page so I can see its full history, contacts, notes, and associated requests.
- As an admin, I want to log calls, meetings, emails, and notes against a contact so I have a complete activity timeline.
- As an admin, I want to see revenue forecasts based on deal values and stage probabilities so I can plan cash flow.
- As an admin, I want to view a contact's full history (deals, activities, messages, requests) on one page.
- As an admin, I want to add custom fields to companies and contacts so I can track industry, size, and other metadata.
- As an admin, I want all monetary values to respect each client's preferred currency so invoices and deals show the correct currency.
- As an admin, I want to convert exchange rates using the existing exchangeRates table so I can view consolidated reports in my base currency.
- As an admin, I want to manage brands as proper entities (not just JSON arrays) so each brand can own requests, files, and contacts independently.
- As an admin, I want to see current team capacity (hours used vs available) so I can tell prospects when work can start.
- As an admin, I want to see forecasted capacity impact from pipeline deals so I can plan hiring and timelines.
- As an admin, I want a "Can we start this project?" calculator so I can answer prospects during sales calls.
- As an admin, I want to track close rates, stage conversion, and average deal cycle time so I can improve my sales process.

## Scope

### Pages

- `app/(dashboard)/pipeline/page.tsx` : Deal pipeline Kanban board and list view
- `app/(dashboard)/pipeline/[id]/page.tsx` : Deal detail page
- `app/(dashboard)/clients/[id]/page.tsx` : Enhanced client detail (company view) with deals tab, activities tab, revenue tab
- `app/(dashboard)/clients/contacts/[id]/page.tsx` : Contact detail page with activity timeline
- `app/(dashboard)/reports/page.tsx` : Enhanced reports with sales metrics section
- `app/(dashboard)/settings/page.tsx` : Enhanced settings with CRM configuration (pipeline stages, custom fields, default currency)
- `app/(dashboard)/capacity/page.tsx` : Capacity dashboard (current utilization, projected, forecasted from pipeline)
- `app/(dashboard)/team/org-chart/page.tsx` : Visual org chart with filled and planned roles

### API routes

- `app/api/admin/deals/route.ts` : GET (list, filter, search), POST (create)
- `app/api/admin/deals/[id]/route.ts` : GET (detail), PATCH (update), DELETE
- `app/api/admin/deals/[id]/activities/route.ts` : GET, POST
- `app/api/admin/pipeline-stages/route.ts` : GET, PUT (reorder)
- `app/api/admin/activities/route.ts` : GET (list, filter by contact/org/deal), POST
- `app/api/admin/activities/[id]/route.ts` : PATCH, DELETE
- `app/api/admin/contacts/[id]/route.ts` : GET (detail with timeline), PATCH
- `app/api/admin/reports/sales/route.ts` : GET (pipeline value, win rate, forecast)
- `app/api/admin/brands/route.ts` : GET, POST
- `app/api/admin/brands/[id]/route.ts` : GET, PATCH, DELETE
- `app/api/admin/exchange-rates/route.ts` : GET, POST (refresh rates)
- `app/api/admin/capacity/route.ts` : GET (current utilization, projected, forecasted)
- `app/api/admin/capacity/start-date/route.ts` : POST (calculate earliest start date given hours/week input)
- `app/api/admin/reports/close-rates/route.ts` : GET (win rate, stage conversion, avg cycle time)

### Data operations

- CRUD on deals, pipeline stages, activities, brands
- Aggregation queries for pipeline value by stage, win rate, average deal size, time in stage
- Currency conversion using exchangeRates table
- Activity timeline assembly (join activities, messages, status changes per entity)

## Out of scope

- Email sending from CRM (use existing Resend integration for announcements; CRM does not send emails on behalf of the user)
- Marketing automation (drip campaigns, sequences)
- Lead scoring AI (may add later)
- Calendar sync with Google Calendar (already handled by Decision #017 for call scheduling)
- HubSpot data import/migration tool
- Contact form or landing page builder

## UI reference

- Pipeline Kanban board: follow the existing requests Kanban board pattern (drag and drop, column headers with counts, card layout)
- Deal detail page: follow the request detail two-column layout (main content left, summary panel right)
- Activity timeline: follow the request activity tab pattern (chronological feed with avatars, timestamps, icons per type)
- Contact detail: follow the client detail page pattern (tabs, cards, right panel)

## API routes needed

- GET /api/admin/deals?stage=X&ownerId=X&orgId=X&search=X&sort=X : list deals with filters
- POST /api/admin/deals : create a deal (title, value, currency, orgId, contactIds, stageId, ownerId, expectedCloseDate, notes)
- GET /api/admin/deals/[id] : deal detail with contacts, activities, associated requests
- PATCH /api/admin/deals/[id] : update deal fields (including stage change via drag)
- DELETE /api/admin/deals/[id] : soft delete (set status to archived)
- GET /api/admin/deals/[id]/activities : activities scoped to a deal
- POST /api/admin/deals/[id]/activities : log activity against a deal
- GET /api/admin/pipeline-stages : list all stages with position ordering
- PUT /api/admin/pipeline-stages : bulk update stage order, names, probabilities
- GET /api/admin/activities?contactId=X&orgId=X&dealId=X&type=X : list activities with filters
- POST /api/admin/activities : create an activity (type, subject, body, contactId, orgId, dealId, date, attendees)
- PATCH /api/admin/activities/[id] : update activity
- DELETE /api/admin/activities/[id] : delete activity
- GET /api/admin/contacts/[id] : contact detail with full activity timeline
- PATCH /api/admin/contacts/[id] : update contact fields (including custom fields JSON)
- GET /api/admin/reports/sales?period=X : pipeline metrics (value by stage, win rate, avg deal size, time in stage, forecast)
- GET /api/admin/brands : list all brands with org info
- POST /api/admin/brands : create a brand under an org
- GET /api/admin/brands/[id] : brand detail
- PATCH /api/admin/brands/[id] : update brand
- DELETE /api/admin/brands/[id] : delete brand
- GET /api/admin/exchange-rates : current rates
- POST /api/admin/exchange-rates : trigger rate refresh from external source

## DB tables used

### Existing tables (read/write)

- `organisations`: read for company list, write to add custom fields JSON column, read preferredCurrency
- `contacts`: read for contact list, write to add custom fields JSON column and phone column
- `exchangeRates`: read for currency conversion, write when refreshing rates
- `requests`: read to link deals to requests
- `invoices`: read to show revenue per company
- `teamMembers`: read for deal owner assignment
- `tags`: read/write for deal tags

### New tables (see schema section below)

- `deals`: core deal records
- `dealContacts`: junction table linking deals to contacts
- `pipelineStages`: configurable pipeline stage definitions
- `activities`: calls, meetings, emails, notes, tasks logged against contacts/deals/orgs
- `brands`: proper brand entities (replaces JSON array on organisations)
- `brandContacts`: junction linking contacts to brands

## New schema additions

### Batch 8: CRM Pipeline

```
deals: {
  id: uuid pk,
  title: text not null,
  orgId: text -> organisations,
  stageId: text -> pipelineStages,
  ownerId: text -> teamMembers (nullable, the team member who owns this deal),
  value: real (deal value in the specified currency),
  currency: text default 'NZD',
  valueNzd: real (deal value converted to NZD for reporting),
  expectedCloseDate: text (nullable, ISO date),
  actualCloseDate: text (nullable, set when won/lost),
  probability: integer (0 to 100, auto-set from stage but can be overridden),
  status: text ('open' | 'won' | 'lost' | 'archived') default 'open',
  lostReason: text (nullable, filled when status = lost),
  wonSource: text (nullable, attribution when status = won, e.g. 'referral' | 'repeat' | 'inbound' | 'outbound'),
  source: text (nullable, e.g. 'referral' | 'webflow' | 'linkedin' | 'website' | 'cold' | 'existing_client' | 'other'),
  notes: text (nullable, rich text),
  customFields: text (nullable, JSON object for arbitrary key/value pairs),
  estimatedHoursPerWeek: real (nullable, how many team hours/week this deal would consume if won),
  estimatedDurationWeeks: integer (nullable, how many weeks the engagement would last),
  createdById: text not null,
  createdAt, updatedAt
}

dealContacts: {
  id: uuid pk,
  dealId: text -> deals,
  contactId: text -> contacts,
  role: text (nullable, e.g. 'decision_maker' | 'influencer' | 'champion' | 'user'),
  createdAt
}

pipelineStages: {
  id: uuid pk,
  name: text not null,
  slug: text not null unique,
  colour: text (hex colour for the Kanban column header),
  probability: integer (default win probability for deals in this stage, 0 to 100),
  position: integer not null (display order),
  isDefault: integer (boolean, one stage is marked as default for new deals),
  isClosed: integer (boolean, marks this as a terminal stage: won or lost),
  closedType: text (nullable, 'won' | 'lost', only set when isClosed = true),
  createdAt, updatedAt
}

activities: {
  id: uuid pk,
  type: text not null ('call' | 'meeting' | 'email' | 'note' | 'task'),
  subject: text not null,
  body: text (nullable, rich text or plain text),
  contactId: text -> contacts (nullable),
  orgId: text -> organisations (nullable),
  dealId: text -> deals (nullable),
  performedById: text -> teamMembers (who performed/logged this activity),
  activityDate: text not null (ISO datetime when the activity happened),
  durationMinutes: integer (nullable, for calls and meetings),
  attendees: text (nullable, JSON array of {id, type, name, email}),
  actionItems: text (nullable, JSON array of {text, completed}),
  isCompleted: integer (boolean, for task-type activities) default 0,
  createdAt, updatedAt
}
```

### Batch 9: Brands (proper entity)

```
brands: {
  id: uuid pk,
  orgId: text -> organisations not null,
  name: text not null,
  logoUrl: text (nullable),
  website: text (nullable),
  primaryColour: text (nullable, hex),
  notes: text (nullable),
  createdAt, updatedAt
}

brandContacts: {
  id: uuid pk,
  brandId: text -> brands,
  contactId: text -> contacts,
  createdAt
}
```

Also add a `brandId` nullable column to the `requests` table so requests can be associated with a specific brand under an org.

### Schema modifications to existing tables

- `contacts`: add `phone` (text, nullable), `customFields` (text, nullable, JSON)
- `organisations`: add `customFields` (text, nullable, JSON), `defaultHourlyRate` (real, nullable), `size` (text, nullable, e.g. '1-10' | '11-50' | '51-200' | '201-500' | '500+'), `annualRevenue` (real, nullable)

### Default pipeline stages (seeded on first migration, based on Tahi's actual sales process)

1. Inquiry (slug: 'inquiry', probability: 5, colour: '#60a5fa', position: 0) : lead came in, not yet responded
2. Contacted (slug: 'contacted', probability: 15, colour: '#a78bfa', position: 1) : responded, they are engaged
3. Discovery (slug: 'discovery', probability: 35, colour: '#fbbf24', position: 2) : discovery call or full email exchange complete
4. Proposal Sent (slug: 'proposal_sent', probability: 60, colour: '#fb923c', position: 3) : quote delivered
5. Won (slug: 'won', probability: 100, colour: '#4ade80', position: 4, isClosed: true, closedType: 'won')
6. Lost (slug: 'lost', probability: 0, colour: '#f87171', position: 5, isClosed: true, closedType: 'lost')
7. Stalled (slug: 'stalled', probability: 0, colour: '#8a9987', position: 6, isClosed: true, closedType: 'lost') : went cold, no response

## Multi-currency support

### How it works

1. Every monetary entity (deal, invoice, service) stores its value in the entity's own currency plus a `valueNzd` (or equivalent base currency) column for reporting.
2. The base reporting currency is NZD (configurable via a `settings` key: `base_currency`).
3. The `exchangeRates` table stores rates relative to USD (existing schema). Conversion formula: `valueNzd = value / rateForEntityCurrency * rateForNzd`.
4. When a deal or invoice is created or updated, the `valueNzd` column is computed automatically by the API using the latest exchange rate.
5. Reports always aggregate in the base currency. A currency selector on reports allows switching the display currency (converting on the fly).
6. Exchange rates are refreshed manually via POST /api/admin/exchange-rates or on a scheduled basis (Cloudflare Cron Trigger, daily).

### Supported currencies

NZD, USD, AUD, GBP, EUR, CAD, SGD, HKD, JPY, CHF. Additional currencies can be added by inserting rows into the exchangeRates table.

### Where currency appears

- Deal value (deal.currency + deal.value)
- Invoice amounts (invoices.currency, already exists)
- Service prices (services.currency, already exists)
- Organisation preferred currency (organisations.preferredCurrency, already exists)
- Reports (selectable display currency with conversion)

## Brand/org management model

### Current state

Brands are stored as a JSON array of strings on the `organisations` table. This is too limited: brands cannot own contacts, requests, or files independently.

### Target state

Brands become a proper entity in the `brands` table. Each brand belongs to one organisation. Contacts can be linked to brands via `brandContacts`. Requests can be tagged with a `brandId`. Files can be filtered by brand.

### Migration path

1. Create the `brands` table.
2. For each organisation that has a non-empty `brands` JSON array, create a `brands` row per entry.
3. The `brands` JSON column on organisations is kept for backward compatibility but is no longer the source of truth. New brand operations use the `brands` table.
4. Add `brandId` column to `requests` table.

### Brand permissions

- Contacts linked to a brand can only see requests tagged with that brand (portal scoping).
- Admins see all brands within an org on the client detail page.
- Brand detail page shows: contacts, requests, files filtered to that brand.

## Capacity tracking and forecasting

### Current capacity

Each team member has `weeklyCapacityHours` (already in schema, default 40). The capacity dashboard computes:

- **Total team hours per week**: sum of all active team members' `weeklyCapacityHours`
- **Hours currently allocated**: sum of hours from active requests (estimated hours) plus hours from time entries in the current week
- **Utilization percentage**: allocated / total, per team member and overall
- **Visual**: horizontal capacity bar per team member showing used vs available hours

### Projected capacity (from current clients)

Each subscription plan type maps to a configurable hours-per-week commitment:

- Maintain: configurable (default 8 hours/week)
- Scale: configurable (default 16 hours/week)
- Launch/Project: based on project scope (use request estimated hours)
- Hourly: actual logged hours (no fixed commitment)

Store these defaults in the `settings` table as `capacity_hours_maintain`, `capacity_hours_scale`, etc.

**Committed hours**: sum of hours/week across all active subscriptions.
**Remaining capacity**: total team hours minus committed hours.
**Timeline view**: capacity bar chart over next 4 to 8 weeks based on known workload and project end dates.

### Forecasted capacity (from sales pipeline)

Each deal has `estimatedHoursPerWeek` and `estimatedDurationWeeks`. Combined with the deal's stage probability:

- **Weighted forecast**: sum of `(deal.estimatedHoursPerWeek * deal.probability / 100)` for all open deals
- **Worst case**: sum of estimatedHoursPerWeek for all qualified+ deals (stage probability >= 25)
- **If-all-close scenario**: sum of estimatedHoursPerWeek for all open deals regardless of stage
- **Capacity impact summary**: "If all qualified+ deals close, capacity drops to X hours/week"
- **Earliest available start date**: find the first week where (total capacity minus committed minus weighted forecast) >= requested hours/week

### Earliest start date calculator

A widget on the capacity page and optionally on the deal detail page:

- **Input**: estimated hours/week for the prospective deal
- **Output**: earliest week where team has enough free capacity, which team members are available, and a confidence level based on pipeline probability
- **Logic**: iterate week by week from today; for each week compute total available = team capacity minus committed (subscriptions) minus weighted pipeline. First week where available >= input hours is the answer.
- **Accounts for**: project end dates freeing up capacity, known team member leave (future: out of scope for now)

### Close rate tracking

- **Deals won / deals created** per period (monthly, quarterly)
- **Average time from Lead to Won** in days
- **Conversion rate between each stage**: what percentage of deals that enter stage N move to stage N+1
- **Revenue per deal stage**: total value sitting in each stage
- **Win/loss reasons**: dropdown on deal close (already in schema as `lostReason`; add `wonSource` field for attribution)
- **Stage velocity**: average days a deal spends in each stage

### Sales enablement view

On the capacity page, a "Sales Call Helper" card shows:

1. Current team utilization (percentage and bar)
2. Free capacity right now (hours/week)
3. When capacity opens up next (based on project end dates)
4. Impact of closing a specific deal on capacity (select a deal from dropdown)

## Done criteria

- TypeScript and lint pass with zero errors.
- QA agent has verified no regressions on existing pages.
- UIUX agent has approved spacing and consistency on all new pages.
- Pipeline Kanban board supports drag and drop between stages.
- Deal detail page shows contacts, activities, notes, and associated requests.
- Activity timeline renders chronologically with correct icons per type.
- Multi-currency conversion works in reports with correct math.
- Brands table is populated from existing JSON data.
- All new API routes enforce admin auth.
- Pipeline metrics (value by stage, win rate, avg deal size, time in stage) compute correctly.
- Contact detail page shows full activity history.
- Capacity dashboard shows current utilization, projected, and forecasted numbers.
- Earliest start date calculator returns correct results based on team capacity and pipeline.
- Close rate metrics compute correctly from deal history.
- Sales call helper card shows real-time capacity data.

## Org chart

### What it is

A visual org chart component showing the Tahi team hierarchy. Each node displays avatar, name, title, and reports-to relationship. Supports both filled positions and planned/vacant roles (for hiring pipeline visibility).

### Schema addition

Add to `teamMembers` table:
- `reportsToId` (text, nullable, references teamMembers.id): who this person reports to
- `department` (text, nullable): e.g. 'engineering', 'design', 'operations', 'sales'

New table:
```
plannedRoles: {
  id: uuid pk,
  title: text not null,
  department: text,
  reportsToId: text -> teamMembers (nullable),
  priority: integer (hiring priority, lower = higher priority),
  status: text ('planned' | 'interviewing' | 'offered' | 'filled') default 'planned',
  notes: text (nullable),
  estimatedStartDate: text (nullable),
  weeklyCapacityHours: real (default 40, for capacity forecasting),
  createdAt, updatedAt
}
```

### Features

- Tree visualization with nodes connected by lines
- Each filled node: avatar, name, title, department badge, capacity bar
- Each vacant node: dotted border, title, department, hiring priority badge
- Draggable to reorganize reporting structure (updates reportsToId)
- Department colour grouping
- Click node to go to team member detail page
- Export as PNG image
- Responsive: horizontal tree on desktop, vertical list on mobile

### API routes

- GET /api/admin/org-chart: return team members with reportsToId and planned roles, structured as a tree
- PATCH /api/admin/team-members/[id]: update reportsToId (for drag reorganization)
- GET /api/admin/planned-roles: list planned/vacant roles
- POST /api/admin/planned-roles: create planned role
- PATCH /api/admin/planned-roles/[id]: update planned role
- DELETE /api/admin/planned-roles/[id]: delete planned role

## Escalation check

Yes. This is a major new feature set that is client-visible (brands affect portal scoping) and involves billing logic (multi-currency on invoices and deals). Flag to Liam:

1. Confirm NZD as the base reporting currency.
2. Confirm the seven default pipeline stages (Inquiry, Contacted, Discovery, Proposal Sent, Won, Lost, Stalled) and their probabilities.
3. Confirm that brands should scope portal visibility (contacts on Brand A only see Brand A requests).
4. Confirm whether the HubSpot API key env var should be removed from CLAUDE.md once CRM is built.
