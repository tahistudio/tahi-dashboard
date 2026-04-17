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

### Micro-interactions
- `.view-link` class: underline slides in from left, arrow translates 3px right
- `.hover-lift` class: translateY(-1px) on hover
- `.row-arrow` class: fade in + translate on group hover

### Mobile rules
- Test every page at 375px (iPhone SE) and 768px (tablet)
- Touch targets min 44px
- Bottom padding on main content: 5rem+ to clear bottom nav
- Sidebars collapse to bottom sheets
- Tables → card stacks or horizontal scroll with sticky first column
- Multi-column grids → single column
- Modals → full-screen takeover
- Headers with multiple actions: stack on mobile if cramped

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

---

## Working Agreements

- **User may request new features or feature removal** mid-redesign. That's expected.
- **User reviews on live deploy**, not dev server.
- **Agent flags issues found during work** to this doc rather than fixing inline (avoid scope creep).
- **Mobile is primary**, not an afterthought. Test every page at 375px.
- **Every entity mentioned should be clickable** (client name → client page, task title → task detail, invoice # → invoice detail).
