# Tahi Dashboard - Comprehensive Feature Audit

**Date:** 2026-04-03
**Audited by:** Claude Code (automated + Chrome browser inspection)
**Production URL:** Webflow Cloud deployment
**Task Completion:** 298/406 tasks (73%)

---

## LEGEND

- DONE = Fully implemented and working
- PARTIAL = Code exists but incomplete or has bugs
- STUB = Route/page exists but returns placeholder data or has no real logic
- MISSING = Not built at all
- BUG = Built but broken

---

## 1. CORE PAGES (27 pages total)

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 1 | Overview page (admin KPIs) | DONE | 4 KPI cards, revenue chart, recent requests, team capacity |
| 2 | Overview page (client portal) | DONE | Client-specific view with their requests/invoices |
| 3 | Requests list (table view) | DONE | Search, sort, filter tabs, bulk select, CSV export |
| 4 | Requests list (kanban view) | DONE | 5 columns, drag cards between columns |
| 5 | Requests list (workload view) | DONE | Team workload distribution |
| 6 | Request detail page | DONE | Messages, steps, files, time entries, checklists, status actions |
| 7 | New request dialog | DONE | Title, client, type, category, priority, description, due date, assignee, intake form |
| 8 | Bulk request creation | DONE | Quick-add and cross-client bulk create |
| 9 | Clients list | DONE | Search, filter by plan/status, health scores |
| 10 | Client detail page | DONE | 10 sub-tabs (overview, requests, files, invoices, contracts, contacts, calls, messages, time, activity) |
| 11 | New client dialog | DONE | Name, website, industry, plan type, contacts |
| 12 | Invoices list | DONE | Status filters, date filter, CSV export |
| 13 | Invoice detail | DONE | Line items, status, payment info |
| 14 | Billing page (admin) | PARTIAL | KPI cards and tables show but admin billing dashboard returns early (stub logic) |
| 15 | Billing page (client portal) | DONE | Stripe customer portal session, invoice list |
| 16 | Tasks page | DONE | 3-level task system, status/priority/type filters, date filter |
| 17 | Messages page | DONE | Two-panel conversation list + thread view |
| 18 | Time tracking page | DONE | KPI cards, entries/by-client views, billable filter, date filter, CSV export |
| 19 | Team management page | DONE | Add/edit/remove members, roles, skills, capacity, access rules |
| 20 | Reports page | DONE | Requests by status donut, monthly volume bar, response time table |
| 21 | Docs hub | DONE | Sidebar with folder grouping, markdown rendering, Tiptap editor, version history |
| 22 | Settings page | DONE | Appearance (dark mode), integrations, notifications, portal branding |
| 23 | Announcements page | DONE | Builder with targeting (all/plan/org), scheduling, Resend email |
| 24 | Contracts page | DONE | CRUD, status tracking, type filters, date filter |
| 25 | Pipeline page | DONE | Deal kanban, list view, probability, forecasting |
| 26 | Pipeline deal detail | DONE | Company info, value, probability, owner assignment |
| 27 | Services page (client portal) | DONE | Service catalogue with pricing, recurring options |
| 28 | Reviews/testimonials page | DONE | Outreach management, NPS, status tracking |
| 29 | Affiliates page | PARTIAL | Page exists in routing but limited functionality |
| 30 | Files page (client portal) | STUB | Empty state only, no file browser for deliverables |

---

## 2. API ROUTES (95+ routes)

### Admin Routes
| # | Route | Status | Notes |
|---|-------|--------|-------|
| 31 | GET/POST /api/admin/requests | DONE | List, create, bulk update |
| 32 | GET/PUT/DELETE /api/admin/requests/[id] | DONE | Full CRUD |
| 33 | GET/POST /api/admin/requests/[id]/messages | DONE | Thread messaging |
| 34 | GET/POST /api/admin/requests/[id]/files | DONE | File upload metadata |
| 35 | GET/PUT /api/admin/requests/[id]/steps | DONE | 3-level workflow |
| 36 | GET/POST /api/admin/requests/[id]/time-entries | DONE | Log time |
| 37 | POST /api/admin/requests/[id]/voice-notes | DONE | Voice recording |
| 38 | GET/POST /api/admin/clients | DONE | List, create, search |
| 39 | GET/PUT /api/admin/clients/[id] | DONE | Get, update |
| 40 | PUT /api/admin/clients/[id]/pm | DONE | PM assignment |
| 41 | GET/POST /api/admin/clients/[id]/contacts | DONE | Contact management |
| 42 | GET/POST /api/admin/invoices | DONE | List, create |
| 43 | GET/PUT /api/admin/invoices/[id] | DONE | Get, update |
| 44 | GET/POST /api/admin/deals | DONE | Pipeline deals |
| 45 | GET/PUT /api/admin/deals/[id] | DONE | Deal management |
| 46 | GET/POST /api/admin/tasks | DONE | Task CRUD |
| 47 | GET/POST /api/admin/conversations | DONE | Messaging threads |
| 48 | GET/POST /api/admin/team | DONE | Team member CRUD |
| 49 | PUT/DELETE /api/admin/team/[id] | DONE | Edit, remove |
| 50 | GET/PUT /api/admin/team/[id]/access | DONE | Role-based access rules |
| 51 | GET/PUT /api/admin/kanban-columns | DONE | Custom board columns |
| 52 | GET /api/admin/capacity | DONE | Team utilization metrics |
| 53 | GET /api/admin/overview | DONE | Dashboard KPIs |
| 54 | GET /api/admin/reports/* | DONE | Billing summary, response time, overview |
| 55 | GET /api/admin/export/* | DONE | CSV exports (requests, invoices, time) |
| 56 | GET/POST /api/admin/announcements | DONE | CRUD + targeting |
| 57 | POST /api/admin/announcements/[id]/send | DONE | Resend email delivery |
| 58 | GET/POST /api/admin/contracts | DONE | Contract CRUD |
| 59 | GET/POST /api/admin/automations | DONE | Automation rule engine |
| 60 | GET /api/admin/audit | DONE | Audit log |
| 61 | GET/POST /api/admin/docs | DONE | Knowledge base CRUD |
| 62 | GET/PATCH/DELETE /api/admin/docs/[id] | DONE | Doc updates |
| 63 | POST /api/admin/docs/seed | DONE | CLI seeding endpoint |
| 64 | GET/POST /api/admin/forms | DONE | Intake form builder |
| 65 | GET/POST /api/admin/calls | DONE | Scheduled calls |
| 66 | GET/POST /api/admin/settings | DONE | Settings storage |
| 67 | POST /api/admin/billing/monthly-email | DONE | Monthly billing digest |
| 68 | GET/POST /api/admin/activities | DONE | Activity logging |
| 69 | POST /api/admin/ai/suggest | DONE | AI suggestion endpoint |

### Portal Routes
| # | Route | Status | Notes |
|---|-------|--------|-------|
| 70 | GET/POST /api/portal/requests | DONE | Client request list/create |
| 71 | GET/PUT /api/portal/requests/[id] | DONE | Client request detail |
| 72 | GET/POST /api/portal/requests/[id]/messages | DONE | Client messaging |
| 73 | GET /api/portal/invoices | DONE | Client invoice list |
| 74 | POST /api/portal/billing/session | DONE | Stripe portal session |
| 75 | GET /api/portal/conversations | DONE | Client conversations |
| 76 | GET /api/portal/announcements | DONE | Client announcements |
| 77 | GET /api/portal/services | DONE | Service catalogue |
| 78 | GET /api/portal/onboarding | DONE | Onboarding data |
| 79 | GET/PUT /api/portal/profile | DONE | Client profile |
| 80 | GET /api/portal/request-forms | DONE | Custom intake forms |

### Webhook Routes
| # | Route | Status | Notes |
|---|-------|--------|-------|
| 81 | POST /api/webhooks/stripe | DONE | invoice.paid, invoice.payment_failed, subscription.updated/deleted |

### Upload Routes
| # | Route | Status | Notes |
|---|-------|--------|-------|
| 82 | POST /api/uploads/presign | DONE | R2 presigned upload URL |
| 83 | PUT /api/uploads/proxy | DONE | Stream file to R2 |
| 84 | POST /api/uploads/confirm | DONE | Record file metadata |
| 85 | GET /api/uploads/serve | DONE | Serve files from R2 |

---

## 3. INTEGRATIONS

| # | Integration | Status | Notes |
|---|-------------|--------|-------|
| 86 | Stripe (payments) | PARTIAL | Webhook handler works. Customer creation works. But MRR card shows "Connect Stripe" placeholder. No auto-invoice generation for retainers. |
| 87 | Stripe (customer portal) | DONE | Client can manage billing via Stripe portal session |
| 88 | Resend (email) | DONE | Announcement emails, monthly billing digest, review request emails |
| 89 | Cloudflare R2 (files) | BUG | Code complete but R2 STORAGE binding not configured in Webflow Cloud. File uploads fail in production. |
| 90 | Xero (accounting) | STUB | OAuth callback exists but no data sync. No invoice push. No hourly billing export. |
| 91 | HubSpot (CRM) | STUB | Connection toggle only. Sync marked as stub with comment "would sync in production". No actual API calls. |
| 92 | Slack (notifications) | STUB | Channel config storage works. Message posting code commented out. |
| 93 | MailerLite (email lists) | STUB | Connection status only. Subscribe/unsubscribe marked as stubs. No actual API calls. |
| 94 | Zapier (webhooks) | STUB | Endpoint exists but minimal logic |
| 95 | Rewardful (affiliates) | PARTIAL | Sync endpoint exists but unclear if functional |
| 96 | Loom (video) | MISSING | No embed code. Onboarding video URL field exists on org but no player/embed component |
| 97 | Google Calendar | MISSING | Decision D#017 says embed booking link. No Google Calendar API integration. No calendar sync for overview "upcoming" view |

---

## 4. AUTH & SECURITY

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 98 | Clerk authentication | DONE | Multi-org, sign-in/sign-up flows |
| 99 | Admin vs client role routing | DONE | orgId check against TAHI_ORG_ID |
| 100 | API route auth guards | DONE | getRequestAuth + isTahiAdmin on all admin routes |
| 101 | Portal route scoping | DONE | Queries scoped to authenticated orgId |
| 102 | Team member access scoping | DONE | Deny-by-default, granted via teamMemberAccess rows |
| 103 | Bearer token auth (MCP) | DONE | TAHI_API_TOKEN for programmatic access |
| 104 | Impersonation ("View as Client") | PARTIAL | Button exists, sets impersonation state. But admin nav not hidden during impersonation, shows org name not contact name |
| 105 | Password reset | DONE | Handled by Clerk (not custom) |

---

## 5. UI/UX & DESIGN SYSTEM

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 106 | Sidebar navigation | DONE | Grouped sections, dark theme, all links work |
| 107 | Sidebar collapse | BUG | Clicking collapse button freezes the entire Chrome renderer (infinite loop?) |
| 108 | Dark mode | DONE | Toggle in settings, persisted to localStorage, all surfaces adapt |
| 109 | Mobile responsive | PARTIAL | Bottom tab nav exists. Not tested at 375px across all pages |
| 110 | PWA manifest | DONE | manifest.json + service worker registered |
| 111 | Offline fallback | MISSING | No offline page served when network unavailable |
| 112 | Loading skeletons | DONE | animate-pulse skeletons on all list pages |
| 113 | Empty states | DONE | Leaf icon + title + description + CTA on all empty views |
| 114 | Toast notifications | DONE | Success/error toasts |
| 115 | Breadcrumbs | DONE | On detail pages |
| 116 | Keyboard shortcuts | DONE | Ctrl+K search, other shortcuts |
| 117 | Product tour/onboarding | PARTIAL | Component exists (product-tour.tsx) but unclear if triggered for new users |
| 118 | Date range picker | DONE | Two-month calendar with preset ranges, brand colors |
| 119 | Searchable select | DONE | Dropdown with search/filter for person/client selection |
| 120 | Cursor pointer on clickable elements | PARTIAL | Fixed on docs page but may be missing elsewhere |

---

## 6. MCP SERVER

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 121 | MCP server setup | DONE | StdioServerTransport, env var config |
| 122 | list_docs tool | DONE | But returns 404 because production hasn't deployed latest code |
| 123 | list_clients tool | DONE | |
| 124 | list_requests tool | DONE | |
| 125 | create_request tool | DONE | |
| 126 | update_request_status tool | DONE | |
| 127 | assign_request tool | DONE | |
| 128 | create_client tool | DONE | |
| 129 | create_invoice tool | DONE | |
| 130 | log_time tool | DONE | |
| 131 | send_message tool | DONE | |
| 132 | create_announcement tool | DONE | |
| 133 | get_overview resource | DONE | |
| 134 | get_reports resource | DONE | |
| 135 | get_capacity resource | DONE | |
| 136 | list_team resource | DONE | |

---

## 7. EMAIL TEMPLATES

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 137 | Announcement email | DONE | Via Resend |
| 138 | Monthly billing digest | DONE | Via Resend |
| 139 | Review/testimonial request email | DONE | Token-auth public URL |
| 140 | New request notification email | PARTIAL | Template may exist but unclear if triggered |
| 141 | Invoice email | MISSING | No email sent when invoice created/sent |
| 142 | Welcome/onboarding email | MISSING | No automated welcome email for new clients |
| 143 | Password reset email | DONE | Handled by Clerk |
| 144 | Overdue invoice reminder | MISSING | No automated reminders |

---

## 8. DATA & BUSINESS LOGIC

| # | Feature | Status | Notes |
|---|---------|--------|-------|
| 145 | Request workflow (5-step) | DONE | Submitted > In Review > In Progress > Client Review > Delivered |
| 146 | Track capacity model | DONE | Small/large tracks, plan-conditional display |
| 147 | Client health scoring | DONE | Automated health status (healthy/at_risk/churned) |
| 148 | Automation rule engine | DONE | Trigger/action rules with delay logic |
| 149 | Audit logging | DONE | Immutable action log |
| 150 | Exchange rates | DONE | Table exists, multi-currency support in pipeline |
| 151 | Invoice auto-generation (Stripe retainers) | MISSING | D#011 says Stripe handles this but no code to create Stripe subscriptions from dashboard |
| 152 | Hourly billing monthly export | PARTIAL | Code exists per D#021 but Xero integration is stub |
| 153 | Case study AI draft generation | PARTIAL | AI suggest endpoint exists but unclear if connected to case study flow |

---

## 9. BUGS FOUND IN PRODUCTION

| # | Severity | Page | Bug |
|---|----------|------|-----|
| B1 | CRITICAL | Sidebar | Collapse button freezes entire Chrome renderer (infinite loop) |
| B2 | CRITICAL | File Uploads | R2 STORAGE binding not configured in Webflow Cloud. All uploads fail. |
| B3 | HIGH | Invoices | Inconsistent currency formatting ("$500" vs "US$2,500") |
| B4 | HIGH | Billing vs Invoices | Status mismatch (Beta Labs: "Sent" on billing page, "Overdue" on invoices page) |
| B5 | HIGH | Clients | "Tahi Studio" appears as duplicate entry |
| B6 | MEDIUM | Impersonation | Admin nav not hidden, shows org name not contact name |
| B7 | MEDIUM | Voice Notes | Shows "[voice note: 2s]" text, duplicate send button, no waveform |
| B8 | MEDIUM | Pipeline | "Verbal Com..." column header truncated |
| B9 | LOW | Overview | MRR card shows "Connect Stripe" dash instead of value |
| B10 | LOW | Settings | Team button, portal branding, modules toggle broken |

---

## 10. FEATURE GAPS vs MANYREQUESTS

| # | ManyRequests Feature | Dashboard Status | Notes |
|---|----------------------|-----------------|-------|
| G1 | Client request submission | DONE | New request dialog with intake forms |
| G2 | Request status tracking | DONE | 5-step workflow, kanban board |
| G3 | File delivery to clients | PARTIAL | Upload works (when R2 binding fixed) but no "deliverables" view for portal |
| G4 | Client messaging | DONE | Conversations with internal/external visibility |
| G5 | Invoice management | DONE | List, detail, status tracking |
| G6 | Stripe payment processing | PARTIAL | Webhook handling done, but no auto-invoice from subscriptions |
| G7 | Client portal login | DONE | Clerk multi-org |
| G8 | Service catalogue | DONE | Pricing, descriptions, coupon support |
| G9 | Request library (per plan) | MISSING | No pre-built request templates by plan type |
| G10 | Queue-based task priority | DONE | Track queue visualization |
| G11 | Billing in client's currency | PARTIAL | Multi-currency in schema, but invoice create dialog may not have currency selector |

---

## 11. FEATURE GAPS vs HUBSPOT CRM

| # | HubSpot Feature | Dashboard Status | Notes |
|---|-----------------|-----------------|-------|
| H1 | Contact management | DONE | Via clients/contacts |
| H2 | Deal pipeline (kanban) | DONE | Pipeline page with stages |
| H3 | Activity timeline | DONE | Activities table with types |
| H4 | Email tracking | MISSING | No email open/click tracking |
| H5 | Meeting scheduling | MISSING | No Google Calendar integration |
| H6 | Lead scoring | MISSING | No automated lead scoring |
| H7 | Sales analytics | PARTIAL | Basic pipeline KPIs but no close rates by source |
| H8 | Contact import | MISSING | No CSV/bulk import of contacts |

---

## 12. FEATURE GAPS vs CLICKUP/TRELLO

| # | Feature | Dashboard Status | Notes |
|---|---------|-----------------|-------|
| C1 | Task creation | DONE | |
| C2 | Task assignment | DONE | |
| C3 | Task priority | DONE | |
| C4 | Due dates | DONE | |
| C5 | Subtasks (3-level) | DONE | |
| C6 | Kanban board | DONE | For requests |
| C7 | Time tracking | DONE | |
| C8 | Comments/threads | DONE | Via messaging |
| C9 | File attachments | DONE (when R2 works) | |
| C10 | Custom fields | PARTIAL | formResponses JSON but no custom field builder |
| C11 | Recurring tasks | MISSING | No task recurrence |
| C12 | Task dependencies | MISSING | No dependency chains |
| C13 | Gantt chart view | MISSING | No timeline/gantt view |
| C14 | Sprint/milestone planning | MISSING | No sprint concept |

---

## 13. BUSINESS PROCESS GAPS (from Tahi docs)

| # | Process | Dashboard Status | Notes |
|---|---------|-----------------|-------|
| P1 | Client onboarding checklist | PARTIAL | Onboarding state field exists but no step-by-step checklist UI |
| P2 | Personal onboarding Loom video | PARTIAL | onboardingLoomUrl field exists on org but no embed/player |
| P3 | Project-to-retainer conversion tracking | MISSING | No conversion workflow or 10% loyalty discount tracking |
| P4 | Revenue concentration alerts | MISSING | No alert when client exceeds 25-30% of MRR |
| P5 | Stripe fee analysis | MISSING | No comparison of Stripe vs Xero direct invoicing savings |
| P6 | Lead source ROI tracking | MISSING | No source attribution on deals beyond basic "source" field |
| P7 | StraightIn outreach ROI | MISSING | No way to track LinkedIn outreach campaign results |
| P8 | Content publishing cadence | MISSING | No editorial calendar or content scheduling |
| P9 | Referral programme visibility | PARTIAL | Affiliates page exists but limited functionality |
| P10 | MRR dashboard | PARTIAL | Overview shows MRR card but shows "Connect Stripe" placeholder |

---

## 14. PHASE 6 (CRM PIPELINE) - NOT STARTED

74 tasks planned (T286-T359), 0 complete. Includes:
- Deal pipeline with full CRUD
- Multi-currency support with NZD base
- Brands as proper entities (migrate from JSON)
- Capacity forecasting from pipeline
- Org chart with drag-and-drop
- Close rate analytics
- Sales call helper card
- Earliest start date calculator

---

## PRIORITY RECOMMENDATIONS

### CRITICAL (Fix immediately)
1. **B1**: Fix sidebar collapse infinite loop
2. **B2**: Configure R2 STORAGE binding in Webflow Cloud for file uploads
3. **B5**: Fix duplicate "Tahi Studio" client entry

### HIGH (Before client migration)
4. **Stripe integration**: Wire up subscription creation from dashboard so MRR is tracked
5. **Invoice emails**: Send email when invoice is created/sent/overdue
6. **Loom embed**: Add video player for onboarding videos
7. **File deliverables view**: Portal file browser for delivered files
8. **Currency consistency**: Fix formatting across invoice pages
9. **Impersonation polish**: Hide admin nav, show contact name

### MEDIUM (Quality of life)
10. **Google Calendar sync**: Pull meetings into overview for daily view
11. **Welcome email**: Automated onboarding email via Resend
12. **Request templates**: Pre-built request library by plan type
13. **Offline fallback page**: PWA offline experience
14. **Mobile QA pass**: Test all pages at 375px

### LOWER (Phase 6+)
15. Full CRM pipeline (74 tasks)
16. Xero invoice sync
17. HubSpot contact sync (if keeping HubSpot)
18. Slack notification posting
19. MailerLite subscriber sync
20. Recurring tasks
21. Gantt/timeline view
