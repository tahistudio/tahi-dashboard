# Tahi Dashboard — UI/UX Reference Document

> Compiled from screenshots of the live Tahi Studio dashboard (March 2026).
> Use this as the ground truth for feature parity, design language, and behaviour.

---

## 1. Global Layout & Shell

### Sidebar
- **Width:** ~170px, fixed left, full height
- **Background:** Very dark forest green (`#1a2d17` approx) — nearly black-green
- **Logo:** "Tahi" wordmark (white) with a small green leaf glyph top-left
- **Nav items:** Icon + label, white text, no background on inactive
- **Active item:** Slightly lighter green background fill, white text — full-width highlight
- **Expandable items:** Arrow chevron on right (Users, Services, Reports, Settings)
- **Bottom:** Avatar + "Liam Miller" name + three-dot menu (`⋮`)
- **No collapse toggle visible** in these screenshots (sidebar is always open)

### Top Nav Bar
- Minimal — just a page title/icon on the left, action button(s) on the right
- Notification bell icon (top-right corner, always visible)
- "Create Request" button — solid green, rounded, top-right
- Refresh/sync icon next to Create Request button

### Main Content Area
- White background
- Generous padding around content
- No visible page-level card wrapper — content sits directly on white

---

## 2. Dashboard (Overview)

### Header
```
Welcome, Liam                            [28 Feb → 28 Mar]  [<]  [>]
```
- Personalised greeting, large bold heading
- Date range picker with calendar icon and prev/next arrows (top-right)

### KPI Stats Bar
Four inline metrics, no card boxes — just text on white:

| Metric    | Value      | Change indicator |
|-----------|------------|-----------------|
| REVENUE   | $1,500.00  | — (dash, neutral) |
| CLIENTS   | 1          | ↓ -50% (red)    |
| REQUESTS  | 24         | ↓ -27% (red)    |
| REVIEWS   | 0          | ↓ -100% (red)   |

- Label: ALL CAPS, small, grey
- Value: Large, bold, black
- Change: Arrow icon + percentage, red for negative, no positive shown
- Horizontal divider `—` used as a separator between metrics

### Revenue Chart
- Full-width line chart below the KPI bar
- Blue line, purple/blue area fill below
- Y-axis: 0, 500, 1,000, 1,500
- X-axis: dates (27 Feb, 03 Mar, 06 Mar, 08 Mar, 11 Mar, 14 Mar, 17 Mar, 20 Mar, 23 Mar, 26 Mar)
- Subtle grid lines, no border on chart area
- Chart is contained in a white card/section that spans full width

### Requests Section (embedded below chart)
- Same search + filters + view selector as the Requests page
- Same tab navigation (Assigned to me, Open, All, Unassigned, Completed)
- Pagination at the bottom: "Showing 1 to 10 of 10 results" | "Rows per page: 15"

---

## 3. Requests Page

### Page Header
```
[grid icon]  Requests                    [Create Request]  [refresh icon]
```

### Controls Bar
```
[🔍 Search...]              [Filters ▾]  [|||]  [≡ List ▾]
```
- Search: Left-aligned, full rounded input with magnifier icon
- Filters: Button with filter funnel icon + dropdown arrow
- Column density toggle: `|||` icon (compact/comfortable/spacious)
- View switcher: Dropdown with three options — **List**, **Kanban**, **Workload**

### Tab Navigation
```
Assigned to me   Open   All   Unassigned   Completed
                  ───
```
- Active tab: underlined with green, slightly darker text
- Inactive: grey text, no underline
- No background fill on tabs

---

## 4. List View

### Table Columns (left → right)
| Column | Notes |
|--------|-------|
| ☐ Checkbox | Bulk select, left-most |
| TITLE | Bold title + subtitle (request type/project) |
| NUMBER | `#161` — grey, smaller text |
| CLIENT | Name (bold) + Company (grey, smaller) |
| STATUS | Coloured badge with dropdown arrow |
| ASSIGNED TO | Overlapping circular avatars (up to 2 visible) |
| PRIORITY | Dot + "None" label |
| UPDATED | Date (e.g. "Mar 27, 2026") |
| DUE DATE | Date or "Due Date" placeholder |
| CRE[ATED] | Truncated — date |
| ˅ | Expand row chevron, right-most |

### Status Badges (inline dropdown)
Each status is a pill badge with a dropdown arrow to change status directly:

| Status | Background | Text colour |
|--------|-----------|-------------|
| Submitted | White/light grey | Dark grey |
| In progress | Light blue | Blue |
| Pending response | Light pink/salmon | Pink/rose |
| On hold | Light amber/yellow | Amber |
| Completed | Light green | Green |

### Row Details
- Red dot `●` on far left of title = flagged/scope issue (e.g. "Full design & Infrastructure")
- Assignee avatars overlap when multiple — shown as a stack of circles
- `+` button appears on cards where an assignee can be added
- Column headers have sort arrows `↑` indicating sortable

### Pagination
```
Showing 1 to 10 of 10 results          Rows per page [100 ˄]   [⟨⟨] [<] [>] [⟩⟩]
```
- Results count on left
- Rows per page spinner on right (values seen: 15, 100)
- First/prev/next/last pagination controls

---

## 5. Kanban View

### Column Headers
```
SUBMITTED  1     IN PROGRESS  2     PENDING RESPONSE  5     COMPLETED  204     ON HOLD  2
```
- Status label ALL CAPS
- Count badge next to label
- Colour coding matches list view status colours (applied to column header text/accent)

### Kanban Cards
Each card contains:
```
┌─────────────────────────────┐
│ #102                        │
│ Cyber essentials product    │
│ page - new component/design │
│                             │
│ Ella Wilde                  │
│ Elevate                     │
│                             │
│ [priority badge if set]     │
│ [📅 Dec 12 if overdue]      │
│                             │
│ [📅 icon]          [avatar] │
└─────────────────────────────┘
```

- **Request number:** Small, grey (`#102`)
- **Title:** Bold, 2 lines max, truncated
- **Client name:** Regular weight
- **Company:** Grey, smaller
- **Priority badge (optional):**
  - `● Low` — green dot + green pill
  - `● Medium` — amber dot + amber pill
- **Due date (overdue/soon):** Red calendar icon `📅` + date in red (e.g. "Dec 12")
- **Calendar icon (bottom left):** Always present, grey when no date
- **Assignee avatar(s) (bottom right):** Circular, overlapping if multiple
- **`+` button:** Shown on hover or when no assignee, for adding assignee
- **Red dot:** Left of title on flagged requests

### Column Footer
```
+ Add request
```
Each column has an "Add request" link at the bottom in grey

---

## 6. Workload View

### Layout
- Date range header with calendar icon + range (e.g. "04 Apr → 07 Mar") + prev/next arrows + "Days" dropdown
- Two icon toggles (eye / expand icon) — possibly toggle team member detail level
- Month label column: "Mar 2026" with dates below (Sat 28, etc.)
- Team member rows:

```
[avatar]  Liam Miller      0/25h  ˅  │  0 hours  │
[avatar]  Staci Bonnie     0/25h  ˅  │  0 hours  │
```

- Member name + capacity fraction (used/total hours) + chevron to expand
- Calendar grid to the right showing hours per day
- Current day highlighted (green text on date header: "Sat 28")

---

## 7. Notifications

### Bell Icon
- Top-right of screen at all times
- No badge/count visible in screenshots (or very subtle)

### Notification Dropdown Panel
- White card, rounded corners (`border-radius ~12px`), shadow
- Width: ~320px, centred-right aligned under bell
- No header label — jumps straight to items

### Notification Items
Each item:
```
[avatar]   Unread comment on Request
           Viachaslau Karatkou has commented on Full ...
           March 28 2026, 5:42 am
───────────────────────────────────────────────
```
- **Avatar:** 40px circle, photo if available, grey placeholder if not
- **Title:** Bold, e.g. "Unread comment on Request", "Request status changed"
- **Body:** Grey, truncated with ellipsis
- **Timestamp:** Grey, smallest text
- Horizontal divider between items
- **Notification types seen:**
  - Unread comment on Request
  - Request status changed

### Panel Footer
```
           All Notifications
```
- Bold, centred, tappable link to full notifications page

---

## 8. Design Language

### Colour Palette

| Token | Value (approx) | Usage |
|-------|---------------|-------|
| Sidebar bg | `#1a2d17` | Left nav background |
| Active nav | `#243d1f` | Active sidebar item fill |
| Brand green | `#5a824e` | Buttons, active states, accents |
| Brand light | `#7aab6b` | Tahi logo leaf, hover accents |
| White | `#ffffff` | Main content bg, cards |
| Grey-50 | `#f9fafb` | Subtle backgrounds |
| Grey-100 | `#f3f4f6` | Table header bg |
| Grey-400 | `#9ca3af` | Muted labels, col headers |
| Text primary | `#111827` | Body text, titles |
| Text secondary | `#6b7280` | Subtext, dates |
| Blue (In progress) | `#dbeafe` / `#2563eb` | Status badge |
| Pink (Pending) | `#fce7f3` / `#be185d` | Status badge |
| Amber (On hold) | `#fef3c7` / `#b45309` | Status badge, medium priority |
| Green (Completed) | `#d1fae5` / `#065f46` | Status badge, low priority |
| Red | `#dc2626` | Negative delta, overdue dates, flags |

### Typography
- **Font:** Appears to be Inter or similar sans-serif (clean, geometric)
- **Page titles:** ~24px, bold
- **Section headers:** ~16px, semibold
- **Table column headers:** 11–12px, ALL CAPS, letter-spaced, grey
- **Body/row text:** 13–14px, regular
- **Subtext (company, dates):** 12px, grey
- **Status badges:** 12px, medium weight, pill shape

### Spacing & Sizing
- Table row height: ~52–56px
- Kanban card padding: ~12–16px
- Sidebar item height: ~36–40px
- Avatar size (list): ~28–32px overlapping circles
- Avatar size (notifications): ~40px circle
- Border radius on badges: full pill (`999px`)
- Border radius on cards/dropdowns: ~12px
- Status dropdowns: thin border, subtle shadow

### Interactions
- **Status badge:** Clickable dropdown arrow — change status inline without leaving the row
- **Priority:** Clickable (dot + label), likely dropdown
- **Assignee:** Click `+` or avatar to change/add
- **Columns:** Sortable with `↑` arrows
- **Row:** Expandable with `˅` chevron (likely shows description/steps below)
- **Kanban card:** Draggable (implied by the view type)
- **Tabs:** Filter the list in place, no page navigation
- **Search:** Live filter across all visible requests

---

## 9. Feature Inventory

### Requests
- [x] List view with sortable columns
- [x] Kanban view grouped by status
- [x] Workload view (team capacity calendar)
- [x] Status change inline (badge dropdown)
- [x] Multi-assignee (overlapping avatars)
- [x] Priority levels (None, Low, Medium — High implied)
- [x] Due date display with overdue highlighting (red)
- [x] Request numbering (#29, #102, #161...)
- [x] Flag/scope indicator (red dot)
- [x] Search
- [x] Filters
- [x] Tabs: Assigned to me / Open / All / Unassigned / Completed
- [x] Pagination (rows per page, page controls)
- [x] "Add request" per Kanban column
- [x] Bulk select (checkboxes)
- [x] Row expand

### Dashboard
- [x] Personalised welcome
- [x] Date range filter (KPIs + chart)
- [x] Revenue KPI with period comparison
- [x] Clients KPI with % change
- [x] Requests KPI with % change
- [x] Reviews KPI with % change
- [x] Revenue line chart (area fill, date X-axis)
- [x] Embedded requests list with full filtering

### Notifications
- [x] Bell icon in top nav
- [x] Dropdown panel (most recent ~4)
- [x] Comment notifications with author + excerpt
- [x] Status change notifications
- [x] Timestamp per notification
- [x] "All Notifications" link to full page

### Navigation
- [x] Collapsible nav groups (Users, Services, Reports, Settings)
- [x] User profile at bottom of sidebar
- [x] Active page highlighting

---

## 10. Gaps Between Screenshots and Current Tahi Build

| Feature in screenshots | Status in our build |
|------------------------|---------------------|
| Workload view (team capacity) | ❌ Not built |
| Request numbering (`#161`) | ❌ No auto-increment ID shown |
| Inline status change (badge dropdown) | ❌ Status is display-only in list |
| Inline assignee picker | ❌ Not built |
| Revenue chart on dashboard | ❌ Placeholder only |
| KPI % change vs previous period | ❌ Not built |
| Column density toggle (`|||`) | ❌ Not built |
| Row expand (chevron) | ❌ Not built |
| "Add request" per Kanban column | ⚠️ Partial (dialog exists) |
| Bulk select checkboxes | ❌ Not built |
| Multi-assignee avatars | ⚠️ Schema supports it, UI doesn't |
| Pagination with rows-per-page | ⚠️ Backend paginated, UI basic |
| Notifications dropdown | ❌ Bell icon exists but no panel |
| Priority dot + label inline | ⚠️ Schema exists, not shown in list |
| Red flag dot on cards | ⚠️ `scopeFlagged` exists, not shown |

---

## 11. Priority Build Order (based on gaps)

1. **Request numbering** — auto-increment `#ID`, visible in list + cards
2. **Inline status change** — dropdown on badge in both list and kanban
3. **Inline assignee** — avatar picker on list rows + kanban cards
4. **Notifications panel** — bell dropdown with real data
5. **KPI % change** — compare current period vs previous
6. **Row expand** — show description/steps without leaving list
7. **Workload view** — team capacity calendar
8. **Column density toggle**
9. **Bulk select + actions**
