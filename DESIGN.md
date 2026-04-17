# DESIGN.md — Tahi Dashboard Design System Overhaul

Living doc for the ongoing design system overhaul. Updated as we go.

---

## How We Work

### Process per page
Each page we redesign follows this flow:

1. **Persona + purpose analysis** — Who opens this page? What are they trying to accomplish in 3 minutes vs 30 minutes? What's the #1/2/3 action on this page?
2. **Information architecture** — What's essential vs contextual vs tertiary vs redundant vs missing?
3. **Layout sketch** — Hero, primary content, secondary, actions, mobile fallback
4. **Navigation map** — What links to this, what this links to, no dead ends
5. **Interaction details** — Hover, empty, loading, error, mobile touch targets
6. **Design doc review** — User approves direction before code is written
7. **Implementation** — Code + commit + push to live deploy
8. **Live test + iterate** — User reviews on deployed site, iterate if needed

### Commit rhythm
- Every batch of changes: `npm run type-check && npm run lint` pass clean before committing
- Push to `main` → auto-deploys to Webflow Cloud → user reviews live
- Zero functionality changes unless explicitly flagged and approved

### Scope rule
- No touching pages outside the current focus unless user requests it
- If we notice something broken on an adjacent page, note it here in "Flagged issues" below — don't fix inline

---

## Design System Principles

These are the patterns every page must follow so the system compounds (each new page reinforces the design language).

### Spacing scale (rem-based, accessibility friendly)
| Token | Value | Use |
|---|---|---|
| `--space-1` | 4px | Tight inline gaps |
| `--space-2` | 8px | Default gap between icon + text |
| `--space-3` | 12px | Card inner row gap |
| `--space-4` | 16px | Small card padding |
| `--space-5` | 20px | Standard card padding |
| `--space-6` | 24px | Between content groups |
| `--space-8` | 32px | Between major page sections |

### Typography
| Token | Size | Weight | Use |
|---|---|---|---|
| `--text-xs` | 12px | 500 | Labels, meta, badges |
| `--text-sm` | 13px | 500 | Secondary text, nav, table cells |
| `--text-base` | 14px | 400 | Body text, card content |
| `--text-md` | 16px | 600 | Card titles, section headings |
| `--text-lg` | 18px | 600 | Sub-page titles |
| `--text-xl` | 20px | 700 | Page titles (letter-spacing -0.01em) |
| `--text-2xl` | 24px | 700 | Hero numbers (KPI values) |

### Card pattern
- Border-defined at rest: `1px solid var(--color-border-subtle)`, no shadow
- Hover: border darkens to `--color-border`, `var(--shadow-sm)` appears
- Radius: `var(--radius-lg)` (12px)
- Padding: `var(--space-5)` (20px)

### KPI strip rule
**Multiple stats = one grouped panel with internal dividers, NOT separate cards.** Applies to overview, pipeline, reports, financial health, any page with >2 related stats.

### Sidebar rule (deal detail, client detail, etc.)
**Related metadata lives in ONE card with horizontal dividers between sections**, not as separate cards per field. Each section gets a small uppercase label.

### Button pattern
| Variant | Radius | Hover |
|---|---|---|
| Primary | `--radius-leaf-sm` | Lift -1px + brand shadow glow + darker bg |
| Secondary | `--radius-md` | Border darkens + bg-secondary |
| Ghost | `--radius-md` | bg-secondary |
| Danger | `--radius-md` | Lift -1px + red shadow glow |

Default height: **2.25rem** (was 2.75rem which felt chunky).

### Interactive states (enforced via globals.css)
- Every clickable element: `cursor: pointer`
- Every disabled: `cursor: not-allowed` + opacity 0.5
- Every focusable: `:focus-visible` ring via `--shadow-ring`
- Transitions: 150ms ease

### Icons
- Leaf-radius icon wrappers: `2rem` square, `--color-brand-50` bg, `--color-brand` fg
- Inline icons in buttons: 14-15px (Lucide `size={14}` or 15)
- Standalone icons next to text: 15-16px

### Color language (semantic)
| Color | Meaning |
|---|---|
| Gray | Inactive, draft, archived |
| Blue | New, submitted, incoming |
| Amber | Needs attention, in review, paused |
| Teal/Cyan | **Active, in progress, working on it** |
| Green | **Complete, delivered, paid, done** |
| Purple | Client action needed |
| Red | High priority, overdue, danger |
| Rose | Urgent priority |

One color = one meaning across the entire app.

### One red across the system
All danger / overdue / high-priority / lost / negative-delta UI uses the same red. Primary text red is `--color-danger` (#dc2626). Small indicator dots use `--color-danger-dot` (#ef4444). `--priority-high-text`, `--color-overdue-text`, and `CHART.negative` all alias `--color-danger`. Never introduce a new red hex — use the token.

### Dropdowns: prefer native
Use a native `<select>` for single-value filters and pickers (sort, category, currency, status). Custom dropdown menus have inconsistent focus/keyboard/hover behaviour across browsers. Reserve custom combobox UI for multi-select or search-in-list cases where native can't do the job.

### Layout shell: no padding-top on `.dashboard-main`
`.dashboard-main` is the scroll container. It deliberately carries **no `padding-top`** so `position: sticky; top: 0` descendants (section navs, table headers) can sit flush against the top nav with no visible bg-secondary gap. Per-page top spacing lives on the inner `.dashboard-page-inner` wrapper (max-w-7xl) in `app/(dashboard)/layout.tsx`. Pages must NOT put `className="dashboard-main"` on their own wrapper — that doubles the padding.

Pages with a sticky section nav that needs to sit directly below the top nav add `.page-flush-top` to cancel the inner wrapper's padding-top and re-add it on the first child (the page title). Example: Reports.

### Shared chart colours: `@/lib/chart-colors`
All chart fills/strokes, stage badges, and source indicators go through **one** module so the same "Discovery" stage or "Webflow Partner" source is the same colour in every chart on every page (Deals by Stage, Sales Funnel, Stage Velocity, Pipeline kanban, Close Rate by Source, etc). Never import the local constants — always `import { CHART, stageColour, sourceColour, STATUS_COLORS } from '@/lib/chart-colors'`.

Standard stages (lead, discovery, proposal, negotiation, verbal_commit, stalled, closed_won, closed_lost) have fixed colours. Custom stages fall back to the categorical palette indexed by stage position.

### Micro-interactions
- `.view-link` class: underline slides in from left, arrow translates 3px right
- `.hover-lift` class: translateY(-1px) on hover
- `.row-arrow` class: fade in + translate on group hover

### Mobile rules
- Test every page at 375px (iPhone SE) and 768px (tablet)
- Touch targets min 44px
- Bottom padding on main content: 5rem+ to clear bottom nav
- Sidebars collapse to bottom sheets
- Tables → wrap in `.h-scroll` (horizontal scroll, never wrap text)
- Multi-column grids → single column
- Modals → full-screen takeover
- Headers with multiple actions: stack on mobile if cramped

### Table / list overflow rule
**Never let cells wrap awkwardly** (e.g. "Closed Won" or "Webflow Partner" splitting mid-word). Wrap the table in `.h-scroll` which forces `min-width: max-content` on the child and adds `overflow-x: auto`. Works for both `<table>` and custom grid-row layouts.

### Sticky section nav
Pages with many vertical sections (Reports, Settings) get a sticky tab bar right below the top nav:
- Use the `.sticky-section-nav` class
- Auto-bleeds to the edges of `.dashboard-main` padding at each breakpoint
- Sticks at `top: 0` of the scroll container so it's flush with the top nav
- Tab scroller uses `md:justify-center` so tabs center on desktop but scroll on mobile
- If the page has a currency/filter control, **nest it inside the sticky nav on the right** instead of in the page header — stays visible while scrolling.

### Chart colour rule
All chart fills/strokes go through a single `CHART` constant (hex values — Recharts SVG doesn't resolve CSS vars):
- `CHART.positive` = brand green (revenue, net profit, won, on-time)
- `CHART.negative` = muted red (expenses, lost, overdue)
- `CHART.neutral` = muted slate
- `CHART.grid` / `CHART.axis` = subtle border + muted text
- `CHART.categorical` = 8-colour palette for sources / stages / arbitrary groupings — **the first categorical colour is always brand green**, so "stage 1" matches the positive colour
- `CHART.aging` = green → amber → orange → red gradient for past-due buckets

One colour = one meaning across every chart. "Projected revenue" and "MRR" and "Net profit" should all use the same green.

---

## Current Focus

**Pre-redesign batch** (cross-cutting fixes before per-page work) — **COMPLETE**:
- [x] Color language established
- [x] Design tokens in globals.css
- [x] AI briefing card
- [x] Overview page
- [x] Pipeline main page
- [x] Pipeline deal detail (pass 1 - token alignment)
- [x] Reports (pass 1 - restructure + KPI strips + chart colors)
- [x] Mobile bottom padding (6rem + safe-area-inset on `.dashboard-main`)
- [x] Mobile AI briefing header (stacks on mobile)
- [x] Mobile activity timeline header (stacks on mobile)
- [x] Mobile search overlay polish (shorter placeholder, X button, keyboard hints desktop-only)
- [x] Mobile "More" nav drawer (bottom sheet with full grouped nav)
- [x] Deal detail sidebar consolidation (1 card, 14 sections with dividers)
- [x] Pagination pattern (`<Pagination>` + `usePagination` hook, applied to Pipeline list)
- [x] Skeleton primitives (`SkeletonKPIStrip`, `SkeletonTable`, `SkeletonChart`, `SkeletonList`, `SkeletonProgressList`)
- [x] Skeleton audit: 6 Reports blobs replaced with shape-matching skeletons
- [x] Reports sticky section nav: full-bleed, flush below top nav, centered, with built-in currency dropdown
- [x] `.h-scroll` utility: horizontal scroll with `min-width: max-content` on child (stops "Webflow Partner" / "Closed Won" wrapping)
- [x] `CHART` constant: unified chart colour system (positive / negative / neutral / categorical / aging)
- [x] Invoice aging: mobile-friendly bucket rows + scrollable expanded table + wrapping legend

**Foundation is done. Next session begins per-page redesigns.**

**Next up: per-page redesigns**, in order:
1. Overview polish (already shipped, may need tweaks)
2. Pipeline polish (already shipped, sidebar needs work)
3. Reports polish (already shipped, may need tweaks)
4. **Request detail** — Tier 1, multi-persona (admin + team + client)
5. **Tasks detail** — Tier 1, team daily driver
6. Client detail
7. Invoice detail
8. Messages
9. List pages (requests, clients, invoices, tasks, time)
10. Admin tools (team, capacity, tracks, settings)
11. Content pages (services, docs, contracts, etc.)

---

## Flagged Issues (from user feedback, ongoing)

Things noticed but not currently being worked on. Fix during the right page's redesign.

- [x] Mobile nav has only 4 items, Docs/Settings unreachable on mobile → "More" drawer added
- [x] Pagination needed on pipeline list → `<Pagination>` added, Pipeline done
- [ ] Pagination rollout to invoices, reports tables, requests list, clients list
- [ ] Request list badges not aligned consistently (width varies)
- [ ] Request rows don't sort by recency consistently
- [ ] Admin billing view is a partial stub
- [x] Deal detail sidebar is 14 separate cards → consolidated into 1 card with dividers
- [ ] 9 remaining skeleton mismatches in Reports (smaller, lower priority)
- [ ] Pipeline loading skeleton always shows 4 cols regardless of stage count

### Site-wide colour sweep (#1 priority, in progress)
User requested colour consistency as the top priority before more spacing work. Progress:
- [x] One red across the system (`--color-danger`, `--color-danger-dot`)
- [x] Unified stage colours: Deals by Stage, Sales Funnel, Stage Velocity, Pipeline board, Pipeline list
- [x] Unified source colours: Sources by Revenue, Deals by Source, Close Rate by Source
- [x] Shared `lib/chart-colors.ts` module
- [ ] Sweep Overview KPI badges and status dots
- [ ] Sweep Tasks page (priority dots, category chips)
- [ ] Sweep Clients list (health status, plan badges)
- [ ] Sweep Invoices (status colours, aging)
- [ ] Sweep Team + Capacity (utilization bars)
- [ ] Audit every `#` hex literal in `components/` and `app/(dashboard)/` → move to tokens or `chart-colors`

---

## Completed Log

### 2026-04-17
- Design system foundation: spacing/type/shadow/radius tokens in `globals.css`
- Color language established (teal/green swap, priority-high tokens)
- Micro-interactions: `view-link`, `hover-lift`, `row-arrow`
- Overview page: AI briefing, KPI strip with dividers, request+calls side-by-side
- Pipeline: KPI strip with dividers, currency dropdown, deal cards, kanban column headers readable
- Deal detail: bug fixes (stageEnteredAt, removed "Liam" hardcode), activity colors to CSS vars
- Reports: 228 lines of dead code removed, tab nav (was floating chip bar), Financial Health as grouped panel, pie chart uses status colors, invoice aging uses semantic palette
- Sidebar hex brand color consolidation across 18 files
- Mobile batch: `.dashboard-main` 6rem bottom padding, AI briefing + activity timeline headers stack on mobile, search overlay polished, full-nav drawer via new "More" button on MobileBottomNav
- Deal detail: 14-SidebarCard stack consolidated into one outer card with section dividers
- New: `components/tahi/pagination.tsx` (`<Pagination>` + `usePagination` hook), applied to Pipeline list view
- New: `components/tahi/skeletons.tsx` (SkeletonBar/Card/KPIStrip/Table/Chart/List/ProgressList)
- Reports: 6 blob skeletons replaced with structure-matching skeletons (Retainer Health, Cash Flow, Team Utilisation, Xero P&L, Client Profitability, Fixed Costs)
- `DESIGN.md` created as living working doc
- Reports jump nav: refactored to `.sticky-section-nav` utility (full-bleed at each dashboard-main breakpoint, flush `top: 0` below top nav, tabs center on md+, currency dropdown nested on right). Currency selector removed from page header.
- `CHART` constant: one source of truth for every Recharts colour on Reports (positive / negative / neutral / grid / axis / categorical / aging). FUNNEL_COLORS, SOURCE_CHART_COLORS, VELOCITY_COLORS now alias `CHART.categorical` so a given stage/source is the same colour in every chart.
- Projected revenue, Xero revenue, and net profit now all use brand green instead of the too-bright `--color-success` (#4ade80).
- `.h-scroll` utility added: wraps any table or wide row so it scrolls horizontally on mobile instead of wrapping cells ("Webflow Partner Source" no longer breaks mid-cell). Applied across Reports (7 tables) and Pipeline list view.
- Invoice Aging mobile polish: bucket row uses tabular-nums + hides "invoices" word on sm, expanded table wrapped in `.h-scroll` with minWidth, legend wraps instead of `justify-between`.

---

## Working Agreements

- **User may request new features or feature removal** mid-redesign. That's expected.
- **User reviews on live deploy**, not dev server.
- **Agent flags issues found during work** to this doc rather than fixing inline (avoid scope creep).
- **Mobile is primary**, not an afterthought. Test every page at 375px.
- **Every entity mentioned should be clickable** (client name → client page, task title → task detail, invoice # → invoice detail).
