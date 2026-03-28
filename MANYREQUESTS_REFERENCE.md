# ManyRequests — Full Feature and Design Reference

Documented from 29 live screenshots of dashboard.tahi.studio (Liam's white-labelled
ManyRequests instance). Use this as the primary reference when building tahi-dashboard
as a replacement. Everything described here was observed directly from the screenshots.

---

## Navigation Structure (Left Sidebar)

The sidebar is always visible on desktop. It uses a very dark background (near-black,
with a slight green tint matching the Tahi brand). The Tahi logo sits at the top left.
Active items are highlighted with a green accent. Some items expand to reveal sub-items.

```
Dashboard
Requests
Users
  Clients
  Team
Services
  All services
  Top-up options
  Add-ons
  Order Forms
  Discount coupons
  Catalog
Messages
Invoices
Reports
  Requests
  Reviews
  Avg Response Time
  Timesheets
Settings
  Integrations
  Modules and Extensions
  Onboarding
  Portal
  Profile and account
```

The logged-in user's name and avatar appear at the very bottom of the sidebar (e.g.
"Liam Miller" with a small avatar and a three-dot menu).

A notification bell icon sits in the top right of the main content area (not in the
sidebar). A refresh/sync icon also appears top right on most pages.

---

## Dashboard

### URL: /dashboard

The landing page after login. Greets the user by name ("Welcome, Liam").

**KPI Stats Row (top):**
Four stat cards displayed horizontally:
- Revenue — shows total (e.g. $1,500.00) with a trend indicator (e.g. — flat)
- Clients — count with trend (e.g. 1, with +50%)
- Requests — count with trend (e.g. 24, with -27% in red)
- Reviews — count with trend (e.g. 0, with -100% in red)

Each stat has a label, a large number, and a percentage change indicator that is
green for positive and red for negative.

A date range picker in the top right of the stats row lets the user change the period
(e.g. "25 Feb to 25 Mar" with prev/next arrows).

**Request Volume Chart:**
A line chart spanning the full width below the stats. Shows request volume over time.
The line is blue/purple, area fill is a very light lavender. X-axis shows dates.
Y-axis shows count. No legend — it is a single series.

**Request List (below chart):**
The bottom half of the dashboard is a condensed request list (same as the full
Requests page, list view). Includes search bar, Filters button, and view toggle.

**Tabs above the list:**
- Assigned to me
- Open (default active)
- All
- Unassigned
- Completed

**List columns:**
Title, Number, Client, Status, Assigned To, Priority, Updated, Due Date, CR (credits)


---

## Requests

### URL: /requests

The core working page. Three view modes selectable from a dropdown in the top right:
List, Kanban, Workload.

### List View

A full-width table with the following columns:
- Title (request name, with service name in smaller text below)
- Number (e.g. #130, #132)
- Client (client name + org name)
- Status (coloured pill — see Status section below)
- Assigned To (avatar stack, up to 2 visible)
- Priority (coloured dot + label)
- Updated (relative or absolute date)
- Due Date (with "Due Date" label and date)
- CR (credits consumed, numeric)

A "Create Request" button sits in the top right.
Rows per page selector (15, 100) and pagination controls at the bottom.
"Showing X to Y of Z results" label.

### Kanban View

Columns from left to right:
- Submitted (count badge)
- In Progress (count badge)
- Pending Response (count badge)
- Completed (count badge, e.g. 204)
- On Hold (count badge)

Each column has an "Add request" button at the bottom.

Each card shows:
- Request number (#xxx)
- Request title
- Client/org name in smaller text
- Priority badge (Low, Medium, High — coloured dot)
- Due date with calendar icon (shown in amber/red if overdue)
- Assignee avatar stack (up to 2 avatars)
- A checkbox/complete toggle

### Workload View

A calendar-style grid view. Rows are team members (e.g. Liam Miller, Staci Bonnie).
Columns are days. Shows hours capacity per person per day as coloured bars.
Date range is selectable (the screenshot shows a month view).
Each member row shows their avatar, name, and a "0/25h" style capacity indicator.

### Filters Panel

A slide-out or dropdown panel with these filter fields:
- Client (dropdown)
- Organization (dropdown)
- Assigned To (dropdown)
- Number (text input, search by request number)
- Priority (dropdown: None, Low, Medium, High)
- Due Date (dropdown with date range options)

### Status Values and Colours
- Submitted — blue pill
- In Progress — blue/purple pill
- Pending Response — amber/orange pill
- Completed — green pill
- On Hold — red/dark pill

### Priority Values
- None (grey, no dot)
- Low (green dot)
- Medium (yellow/amber dot)
- High (red dot)


---

## Request Detail

### URL: /requests/[id]

A two-column layout. The left column is the main content area (wide). The right
column is a fixed Summary panel (narrow, ~220px).

**Header:**
- "Back to Requests" breadcrumb link
- Request title as a large heading (e.g. "Core Build")
- Play/media icon button, edit icon button, three-dot menu in the top right of the header

**Tabs (left column):**
- Activity
- Details
- Files
- Checklists
- Timesheets

### Activity Tab

The default tab. Shows a chronological activity feed:
- Submission events ("Staci Bonnie submitted the request Mar 12, 12:14 PM")
- Assignment events ("Staci Bonnie assigned Liam Miller Mar 12, 12:14 PM")
- Status change events ("Viachaslau Karatkhou has changed the status to Submitted Mar 16, 8:38 PM")
- Comments (with avatar, name, timestamp, and rich text body)

Each activity item has an avatar on the left and content on the right.
Status changes and system events are visually distinct from user comments
(lighter styling, smaller text).

A rich text comment editor sits at the bottom of the activity tab.
Editor toolbar includes: Bold, Italic, Underline, Strikethrough, Link, Code block,
Bullet list, Ordered list, Blockquote, and more.
Below the editor: file attachment button, voice note/audio button, emoji button,
and a "Send" button (green).

A "Description and supporting links/information" placeholder is shown at the top
of the activity when no description has been written yet.

### Details Tab

Shows request metadata in a structured layout:
- Status (with dropdown to change)
- Assigned To (avatar + name)
- Dates (start date to end date with arrows, e.g. "10 Mar to End")
- Priority (dropdown)
- Following (avatar of watchers)
- Credits Consumed
- Created (date and time)
- Description (rich text)
- Priority dropdown (repeated for inline editing)

### Files Tab

File browser for this request. Shows:
- "New" button (upload files)
- "Download all files" button
- List/Grid view toggle
- Search bar
- Breadcrumb navigation: Storage > Requests > [Request Name]
- Empty state: "This folder is empty" with an icon

### Checklists Tab

Allows adding checklists to a request.
- "Add Checklist title" input with confirm (tick) and cancel (x) buttons
- Checklists appear as titled sections with checkbox items below

### Timesheets Tab

Time tracking per request.
- Header shows: "Total time tracked: 00:00:00 = 00:00:00"
- "Add manual time" button in top right
- Empty state: "No time entries yet" with CTA "Get started by adding a new time entry on this request"
- "Add manual time" button shown in the empty state as well

### Summary Panel (right column, persistent across all tabs)

A fixed sidebar panel always visible on the right. Contains:
- Request number (#130)
- Request name (e.g. "Core Build")
- Created (date and time, e.g. "March 12, 2020, 12:14 PM")
- Service (e.g. "Custom Project")
- Client (avatar + client name + org name)
- Status (with inline dropdown)
- Brand (dropdown, defaults to "None")
- Priority (dropdown with colour dot)
- Assigned To (avatar picker)
- Dates (start date, end date with edit controls)
- Time Estimate (editable)
- Tags (with add button)


---

## Users: Clients

### URL: /users/clients

A flat list of individual client contacts (not organisations). Very long — 50+ rows
visible in the screenshot.

**Columns:**
- Name (avatar + full name)
- Email
- Organization
- Last Login (date)
- Created At (date)
- Actions (three-dot menu)

Tabs at the top of the Users section: Clients, Organizations, Brands.
Search bar, Filters button, rows per page, pagination.

---

## Users: Organizations

### URL: /users/organizations

A list of client organisations (companies). Each row shows:
- Name (small avatar/logo circle + org name)
- Owner (email address in smaller text)
- Members (avatar stack showing member count)
- Account Managers (avatar stack)
- Face (another avatar column — unclear purpose, may be primary contact)
- Subscription (badge: "Unsubscribed" in grey, "Subscribed" in green)
- Active Requests (number)
- Created At (date)
- Tag/plan label (e.g. "Design" shown as a small badge on some rows)
- Expand arrow (chevron on right)

"Create client" button top right.
"Announcements" button also top right (triggers announcement creation).

---

## Users: Brands

### URL: /users/brands

A list of brands associated with client organisations. Brands appear to be
sub-identities under an organisation (e.g. "Champion Health Nordics" and
"Champion Health" both under "Physitrack Group").

**Columns:**
- Brand Name (initial circle + name)
- Organization
- Last Updated
- Created At
- Actions (three-dot menu)

"Create brand" button top right.
Filters, rows per page, pagination.

---

## Organisation Detail

### URL: /users/organizations/[id]

A detailed view of a single client organisation. Two-panel layout: main content
left, contact info panel right.

**Header:**
- Organisation name (e.g. "Physitrack Group")
- Owner email
- Created date
- Three-dot menu (actions)

**Tabs:**
- Services and Subscriptions
- Requests
- Invoices
- Files
- Members
- Messages
- Reviews
- Time Entries
- Credits
- Brands

**Members tab (visible in screenshot):**
Table of all members in this org:
- Name (avatar + name + email)
- Last Login
- Created At
- Three-dot actions menu

"Add members" button top right within the tab.

**Right panel:**
Shows a selected contact's details:
- Name (large heading)
- Email (with mailto link)


---

## Team

### URL: /users/team

A list of internal team members (admins and portal admins).

**Columns:**
- Name (avatar + name + email)
- Role (e.g. "Portal Admin", "Admin")
- Status (green "Active" badge)
- Managed Organizations (number, e.g. 12, 1)
- Created At
- Three-dot actions menu

"Create team member" button top right.
Filters, rows per page, pagination.

Team members are distinct from client-side users. They have admin access to the
dashboard. "Portal Admin" appears to be a lower-privilege role (can access the
portal on behalf of clients), while "Admin" is a full internal admin.

---

## Services

### URL: /services

A catalogue of services offered by Tahi. Very long list (50+ services visible).

**Left sub-navigation (expands under Services in sidebar):**
- All services
- Top-up options
- Add-ons
- Order Forms
- Discount coupons
- Catalog

**Columns (All services list):**
- Name
- Price (with currency — NZD, USD, GBP, EUR; some recurring "per month")
- Sales (numeric)
- Show in Catalog (toggle switch — on/off)
- Created (date)
- Updated (date)
- Three-dot menu

"Create Service" button top right.
Search bar, rows per page, pagination.

Services visible include:
- Single Custom Lottie Animation — $600.00 USD
- Comprehensive Brand Identity Co... — $2,400.00 USD
- Essential Brand Identity Refresh — $1,150.00 USD
- Web & Graphic Design Plan — NZ$4,650.00 NZD per month (recurring)
- Total Webflow Plan (Design & Dev) — NZ$1,500.00 NZD per month (recurring)
- Workflow Development Plan — NZ$1,500.00 NZD per month (recurring)
- Free Site Audit — $0.00 USD
- Custom Project — $100.00 USD
- Various hourly/flexible workflow packages (50, 75, 100 hours)
- Web & Graphic Design — $2,000.00 USD per month (recurring, "Show in Catalog" = ON)
- Physitrack Custom Retainer
- Dante Media Custom Retainer — €100.00 EUR per month (recurring)

---

## Messages

### URL: /messages

A two-column messaging UI. Left panel is the conversation list. Right panel is the
active conversation thread.

**Left panel — conversation list:**
Two sections:
- Organisation Channels (labelled header with expand arrow)
  - BCS Consultancy
  - Equipz
  - Elevate
- Direct Messages (labelled header with expand arrow)
  - Ella Wilde
  - Drake
  - Kevin Kaminyar
  - Anna Rantala
  - paul

Each item shows: avatar, name, and a preview of the last message with truncation.

**Right panel — active conversation:**
Header shows the contact name and a three-dot menu.
Messages are displayed in a chat-style thread with:
- Sender avatar (left for others, implied right for self)
- Sender name + role label (e.g. "Ella Wilde 4:11 PM")
- Message body (rich text, can include hyperlinks)
- A "This message has been removed" indicator for deleted messages
- Reaction/emoji option (small icon below messages)
- Date separators between message groups (e.g. "January 27, 2026")

Messages can contain inline URLs (e.g. Loom video links, Google Doc links).

Rich text editor at the bottom:
Full formatting toolbar: Bold, Italic, Underline, Strikethrough, Link, Inline code,
Code block, Lists, Blockquotes, and more.
Below toolbar: attachment icon, voice/audio icon, emoji icon. Send button on the far right (arrow icon).


---

## Invoices

### URL: /invoices

A list of all invoices across all organisations.

**Columns:**
- Number (e.g. INV-2025000021)
- Organization
- Payment Method (e.g. "Stripe")
- Status (green "Paid" badge, amber "Pending" badge)
- Creator (team member who created it)
- Total (amount with currency — NZD, USD, GBP, EUR — mixed currencies across clients)
- Three-dot menu

"Create Invoice" button top right.
Filters button, rows per page, pagination.
"Showing X to Y of Z results" label.

Invoice numbers visible: INV-2025000021 through INV-2025000011 (descending order).
Organisations include: Florat, Greybox, Axis Creative, Physitrack Group, Dante Media, Blank Space Inc.

---

## Reports

Reports has four sub-pages accessible from the sidebar:

### Requests Report (/reports/requests)

The most detailed report page.

**Controls:**
- Date range picker (e.g. "25 Feb to 25 Aug")
- Filters: Team Member, Organization, Client, Services (each a button/dropdown)

**Charts:**
1. Line chart — Requests over time (volume)
2. Donut chart — Requests per status (Closed, Completed, On Hold, In Progress, Pending Response, Submitted — each a colour slice with legend)
3. Donut chart — Requests per service (Custom Lottie, Custom Project, Datamove Custom Retainer — colour-coded with legend)

**KPI Stats below the charts:**
- Avg Number of Comments: 2 (-20%)
- Avg Number of Status Changes: 2 (-15%)
- Avg Time to Completed: 3d 4h (-84%)
- Avg Time to First Reply: 12m (-54%)
- Avg Rating: 0 of 5 (-100%)
- Completed Requests: 16 (-48%)
- Pending Requests: 7

### Reviews Report (/reports/reviews)

Shows client review/rating data. In the screenshot this is empty ("No reviews for the
selected period"). Controls mirror the Requests report (date range, same filter buttons).

### Avg Response Time (/reports/avg-response-time)

A simple table showing average response time per team member:
- Name (avatar + name + email)
- Role
- Messages (count, e.g. 35)
- Avg Response Time (formatted as H:MM:SS, e.g. 1:32:12)

"Export CSV" button in top right.
Date range picker.

### Timesheet Reports (/reports/timesheets)

The most visually complex report.

**Two tabs:** Summary, Timesheet

**Controls:**
- Date range picker
- Filters: Team Member, Organization, Client, Services, Tags

**Charts (Summary tab):**
1. Bar chart — Hours logged per day over the date range (blue bars)
2. Donut chart — By Team Member (Liam Miller vs Staci Bonnie)
3. Donut chart — By Organizations (top client orgs)
4. Donut chart — By Services (billable vs not billable colour split)

"Group by Request" toggle and "Avg Time totals" toggle at top of table.

**Table below charts:**
Columns: Title (request name + client), Estimated (hours), Time (logged), % (of estimate)
Shows all time entries grouped by request with percentage utilisation.

"Download PDF" button top right.


---

## Settings: Integrations

### URL: /settings/integrations

**Tabs:** Integrations, Webhooks

**Available integrations (visible in screenshots):**

| Integration | Status | Description shown |
|---|---|---|
| Slack | Available | Receive notifications directly in your Slack workspace |
| Live Chat | Available | Accelerate your digital transformation and scale the power of your team |
| Rewardful | Available | Instant affiliate & referral programs for Stripe |
| Loom | Available | A work communication tool that helps you get your message across through instantly shareable video |
| Mailchimp | Soon | (greyed out) |
| Zapier | Available | Connect the apps you use everyday with ManyRequests |
| Active Campaign | Soon | (greyed out) |

Each integration card shows: icon, name, description, and a connect/enable button.

---

## Settings: Modules and Extensions

### URL: /settings/modules

**Tabs:** Modules, Extensions

**Modules tab** — Core platform modules with toggle switches:
- Requests — "Receive orders and client requests. Keep communication and collaboration with your team in context."
- Users — "Manage user roles and permissions for your team members and clients."
- Billing — "Process payments by configuring your Stripe account. Create invoices, manage sales taxes and discount coupons."
- Messaging — "Receive messages and chat with your team and clients. Keep communication and collaboration in context."

Each module has a settings cog icon (links to config for that module).
Toggle switches on the right enable/disable each module.

**Extensions tab** — Optional add-on features:
- Webflow Progressive Profiling (Global extension) — Disabled
- Book a Meeting (Global extension) — Enabled — "Add a custom iframe to your client portal"
- Become a Partner (Global extension) — Enabled — "Add an external link to your client portal"
- SEO/AEO Dashboard (Beta extension) — Disabled — "Embed SEO Automated Client Reports within ManyRequests with SE Ranking"

"Add extensions" button top right.
Each extension shows: name, type badge (Global/Beta), status badge (Enabled/Disabled), description, info icon.

---

## Settings: Onboarding

### URL: /settings/onboarding

Allows creating a custom onboarding page that clients see when they first log in.

Three template options displayed as cards with thumbnail previews:
1. Template step — A step-by-step getting started guide
2. Template document — A document-style onboarding page
3. Template download — A download-focused onboarding page

Each card has a "Use template" button.
A "Custom code" toggle in the top right allows entering raw HTML instead of using a template.

---

## Settings: Portal

### URL: /settings/portal

**Tabs:** Portal, Advanced

**Portal tab — Branding and configuration:**

Portal name field (e.g. "Tahi Studio")

Logo and favicon section:
- Logo for light background (upload, recommended 1500px, transparent PNG)
- Logo for dark background (separate upload)
- Favicon (upload, 96x96px, transparent PNG)

Region section:
- Language (dropdown, e.g. "English")
- Timezone (dropdown, e.g. "New Zealand - Pacific/Auckland")

Preferences section (all toggleable):
- Primary color — colour picker (applies to buttons and links)
- Sidebar Dark Mode — toggle (dark vs light sidebar)
- Sidebar color — colour picker (applies in dark sidebar mode)
- Sidebar logo always dark — toggle (if enabled, the sidebar always shows the dark logo regardless of mode)
- Sidebar text color — colour picker

"Save" button at the bottom right.


---

## Settings: Profile and Account

### URL: /settings/profile

**Tabs:** Profile Information, Notification Preferences, Subscription

**Profile Information tab:**
- Profile picture (upload button)
- Name (text field)
- Email (text field)
- Update password section (with a "Follow the recovery process to change your password" note and an "Update password" link/button)
- Personal Language (dropdown, e.g. "English")
- "Save" button

---

## Notifications

Accessible via the bell icon in the top right of any page.

A dropdown panel appears with a list of recent notifications:
- "Unread comment on Request" — e.g. "Viachaslau Karatkhou has commented on Full design... March 29, 2026, 10:25 am"
- "Request status changed" — e.g. "Staci Bonnie has commented on Full design... March 27, 2026, 11:52 pm"
- "Unread comment on Request" — e.g. "Sara Sortino has commented on 404 fix Nergi... March 25, 2026, 3:38 am"

Each notification shows: avatar, type label in bold, description text, and timestamp.
"All Notifications" link at the bottom opens a full notifications page.

---

## Complete Feature List

### Core Request Management
- Create requests with title, description (rich text), service type, client/org assignment
- Request number system (sequential, e.g. #130)
- Three view modes: List, Kanban, Workload
- Filter requests by: client, organisation, assigned team member, number, priority, due date
- Status workflow: Submitted, In Progress, Pending Response, Completed, On Hold
- Priority levels: None, Low, Medium, High
- Assign requests to team members (multiple assignees supported)
- Start and end date per request
- Time estimate per request
- Tags on requests
- Brand association per request
- Credits consumed tracking per request
- Activity log on every request (submissions, assignments, status changes, comments)
- Rich text comments with full formatting toolbar
- File attachments per request (R2/cloud storage, folder browser, download all)
- Voice note/audio recording on requests
- Checklists per request (multiple titled checklists with checkbox items)
- Time tracking per request (manual time entry, total time display)
- "Following" — watch a request and receive notifications

### Client and Organisation Management
- Individual client contact list (with org association, email, last login)
- Organisation list (company-level grouping of clients)
- Organisation detail page with tabs: Services/Subscriptions, Requests, Invoices, Files, Members, Messages, Reviews, Time Entries, Credits, Brands
- Add members to an organisation
- Brands — sub-identities under an organisation (e.g. separate brand names for one client group)
- Subscription status per organisation (Subscribed / Unsubscribed)
- Active request count per organisation
- Account manager assignment per organisation

### Team Management
- Internal team member list with roles (Admin, Portal Admin)
- Create and invite team members
- Managed organisations count per team member
- Active/inactive status per team member

### Services and Catalogue
- Service list with name, price (multi-currency: NZD, USD, GBP, EUR), recurring or one-off
- "Show in Catalog" toggle per service
- Sales count per service
- Sub-categories: Top-up options, Add-ons, Order Forms, Discount coupons
- Public-facing Catalog

### Messaging
- Organisation Channels (one channel per client org — all members of that org can read/write)
- Direct Messages (1:1 between any two users)
- Rich text message editor (full formatting toolbar)
- File and voice note attachments in messages
- Message deletion (shows "This message has been removed" indicator)
- Unread message notifications

### Invoicing and Billing
- Invoice list across all clients (multi-currency)
- Invoice statuses: Paid, Pending
- Stripe as payment method
- Create invoice manually
- Filter invoices by org, status, date

### Reporting
- Requests Report: line chart over time, donut by status, donut by service, KPI stats (avg comments, status changes, time to complete, first reply, rating, completed/pending counts)
- Reviews Report: client rating/review data
- Avg Response Time Report: per team member, exportable to CSV
- Timesheet Reports: bar chart by day, donut by team member/org/service, time table grouped by request, downloadable as PDF

### Integrations
- Slack (notifications into workspace)
- Live Chat (in-app chat widget)
- Rewardful (affiliate and referral tracking)
- Loom (video messaging, shareable links)
- Mailchimp (email marketing — marked "Soon")
- Zapier (automation with third-party apps)
- Active Campaign (CRM/email — marked "Soon")
- Webhooks tab (outgoing webhooks configuration)

### Modules (toggleable)
- Requests module
- Users module
- Billing module
- Messaging module

### Extensions (installable)
- Webflow Progressive Profiling
- Book a Meeting (iframe embed in client portal)
- Become a Partner (external link in client portal)
- SEO/AEO Dashboard (SE Ranking embed)

### Onboarding
- Custom onboarding page for clients (shown on first login)
- Three templates: step-by-step, document, download
- Custom HTML/code option

### Portal Settings (white-label)
- Custom portal name
- Logo upload (light + dark versions)
- Favicon upload
- Primary colour picker (buttons and links)
- Sidebar dark mode toggle
- Sidebar colour picker
- Sidebar text colour picker
- Sidebar logo always dark toggle
- Language and timezone settings

### Profile and Account
- Profile picture
- Name and email
- Password update
- Personal language preference
- Notification preferences (separate tab)
- Subscription management (separate tab)

### Announcements
- "Announcements" button visible on the Organisations list page (top right)
- Implies ability to broadcast messages to clients

### Notifications
- In-app notification dropdown (bell icon)
- Notification types: unread comment, status change, new comment
- Full notifications page


---

## Design Language

### Colours
- Sidebar background: very dark (near-black with a slight green tint, approximately #1a1f1a)
- Sidebar active item: green highlight (approximately #5A824E, matching Tahi brand)
- Sidebar text: light grey/white
- Main content background: white (#FFFFFF)
- Table row hover: very light grey
- Primary button: green (matches brand, white text)
- Status pills — each has a distinct background and text colour:
  - Submitted: blue
  - In Progress: blue/indigo
  - Pending Response: amber/orange
  - Completed: green
  - On Hold: red/rose
- Priority dots:
  - Low: green
  - Medium: amber/yellow
  - High: red
- KPI trend up: green
- KPI trend down: red
- Chart line/area: blue/indigo with lavender fill
- Badge "Subscribed": green
- Badge "Unsubscribed": grey
- Badge "Active": green
- Badge "Paid": green
- Badge "Pending": amber

### Typography
- Sans-serif throughout (appears to be Inter or similar system font)
- Page titles: ~20-24px, medium-bold weight
- Table column headers: small, uppercase or slightly bold, grey
- Body/table content: 14px
- Small metadata (dates, emails below names): 12px, grey

### Layout Patterns
- Sidebar always visible on desktop, fixed width (~85px icon-only or ~200px expanded)
- Main content area takes remaining width with padding (~32px)
- Page title in header row, action buttons (Create X) always top right
- Search bar always top left of content lists
- Filters button beside search
- View toggle (list/kanban/grid) beside filters
- Table pagination and rows-per-page always at the bottom
- Two-column detail pages: wide left content, narrow right summary panel (~220px)
- Tab bars immediately below the page header (not inside cards)
- Empty states centred with icon and descriptive text + CTA button

### Component Patterns
- Pills/badges: rounded, small padding, coloured background with matching text
- Avatars: circular, show initials if no photo, stack up to 2-3 with overlap
- Three-dot menus: appear on row hover for actions (edit, delete, etc.)
- Toggle switches: rounded, green when on
- Dropdowns: standard select style with chevron, white background, thin border
- Date range picker: shows "X Feb to Y Mar" format with prev/next arrow buttons
- Breadcrumb navigation: used in file browser (Storage > Requests > [Name])
- Intercom-style chat bubble: bottom right corner of every page (customer support)

### Spacing and Density
- Tables are relatively dense (compact row height, ~40-44px rows)
- Cards in Kanban are slightly more spacious
- Consistent ~16-24px padding inside panels and cards
- Column gaps in tables are tight but readable

---

## Gaps Between ManyRequests and Tahi Dashboard (What We Need to Build Beyond MR)

These are features in the planned tahi-dashboard scope that ManyRequests does NOT have:

- Three-tier task system (client external, client internal, Tahi internal)
- Team member access scoping (deny-by-default, per client, per plan type)
- Admin impersonation ("View as client" to simulate the portal)
- 1:many announcements with email delivery and targeting by plan type or client list
- Group chat conversations (MR only has org channels + 1:1 DMs)
- Internal vs external visibility on conversations and comments
- Custom Kanban columns per client (MR columns are fixed)
- Request intake forms configurable per category/service/client
- Automated client health scoring
- Google Cal booking link embed for call scheduling
- Case study and testimonial outreach pipeline (state machine)
- Contract file upload and tracking (NDAs, SLAs)
- Bulk request creation across clients/plans
- CSV export for time entries and invoices
- Dark mode toggle
- PWA and full mobile responsiveness
- Rewardful deep integration (affiliate dashboard with charts)
- HubSpot sync (MR has no CRM integration)
- Xero (MR has no accounting integration)
- Mailerlite (MR has Mailchimp — different tool)
- Zapier is listed in MR but may be limited; tahi needs outgoing webhooks too
- Automated Stripe retainer invoicing on client provisioning

