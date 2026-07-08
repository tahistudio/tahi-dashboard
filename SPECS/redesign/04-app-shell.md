# App shell and navigation - design brief

> Research-backed brief for Claude design. Prepend `_studio-ledger-theme.md` when prompting.
> Same template and depth as `01-auth.md`. This is the frame every authenticated screen
> lives in: the sidebar, the top bar, the command palette, the mobile tabs, and the cream
> canvas they wrap. It is the foundation for 05-permissions, 06-home, 07-requests, 08-tasks,
> 09-settings and every surface after, and the first place the three audiences (owner,
> teammate, client) visibly diverge, because the navigation they see is different.

## As built (today's shell, the starting point)

The shell is built and live; this brief redesigns it to the Studio Ledger bar and, critically,
**reconciles the navigation with the app's real feature surface** so nothing is orphaned and
the IA can absorb what is coming. It is a reskin + IA pass, not a rebuild.

- `app/(dashboard)/layout.tsx` resolves auth + permissions server-side and wraps children in `SidebarProvider`, `PermissionsProvider`, `DisplayCurrencyProvider`, `PrivateModeProvider`, `ToastProvider`, plus `AppSidebar`, `AppTopNav`, `MobileBottomNav`, `ImpersonationBanner`, `ProductTour`, `KeyboardShortcuts`, `SkipToContent`.
- `components/tahi/app-sidebar.tsx` is a cream (light) rail today, grouped nav with collapsible groups, count badges, collapse-to-icon, and role flags (`adminOnly`, `clientVisible`, `clientOnly`, `requiresManage`, `emailAllowlist`). Active item already uses the rare leaf radius + `--color-brand-100` tint. **Note:** the spec target is the always-dark forest rail (CLAUDE.md sidebar palette), so this is a recolour as well as an IA pass.
- `components/tahi/app-top-nav.tsx`, `mobile-bottom-nav.tsx`, `sidebar-user-card.tsx`, `sidebar-card.tsx`, `sidebar-context.tsx`, `tooltip.tsx`, `keyboard-shortcuts.tsx` (command palette) all exist.
- Nav visibility is resolved server-side from `lib/permissions.ts` and `lib/feature-tree.ts` (`featureKeyForRoute` hides a nav item when its feature is off). Role model: `super_admin`, `admin`, `team_member`, `client`.
- **The reconciliation job:** the live sidebar omits several real routes (`/affiliates`, `/tracks`, client-visible `/schedules` `/contracts` `/proposals`), still shows `/permissions` as a top-level Operations item (it should live in Settings, see 09), and never surfaces the deep client surfaces. This brief makes the nav a faithful, future-proofed map of the whole app.

The job here is consistency and polish: make the shell unmistakably Studio Ledger (always-dark rail), make the three audience views feel intentionally designed rather than the same chrome with rows hidden, build the global command palette into a true "jump to anything", and reconcile the IA with every feature the app actually has.

---

## The complete feature map (the app, enumerated)

This is the load-bearing section for the shell: **the nav must be a faithful map of everything the
app can do, today and tomorrow.** Below is the full feature surface, drawn from `lib/feature-tree.ts`
(the gateable-feature source of truth), the 51 live page routes, and the planned surfaces. Each is
tagged with its audience (T = team/internal, C = client portal, or both) and its home in the IA. The
design must place every T/C feature somewhere reachable in two interactions, and leave obvious room
for the "planned / near" rows so adding them later is a row, not a re-architecture.

### Workspace (the daily core, both audiences where marked)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Overview / Home | `/overview` | T+C | Role-aware home (spec 06). |
| Requests | `/requests` (+`/[id]`) | T+C | The core product surface (spec 07). Board sub-view, bulk actions (T). |
| Tasks | `/tasks` (+`/[id]`) | T | Internal execution (spec 08). Never client-visible. |
| Messages | `/messages` | T+C | Conversations (direct / group / org channel / request thread). |

### Sales (studio-internal pipeline, team)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Leads | `/leads` (+`/[id]`) | T | Intake + AI scoring/enrichment. |
| Calls | `/calls` | T | Discovery + client calls, transcripts, insights. |
| Deals | `/deals` (+`/[id]`) | T | Pipeline. Engagement-health card. |
| Proposals | `/proposals` (+`/[id]`, `/templates`) | T+C | Builder (T) + shared viewer (C). |
| Schedules | `/schedules` (+`/[id]`, `/templates`) | T+C | Gantt / delivery spine; shared read for clients. |
| Contracts | `/contracts` (+`/[id]`, `/templates`) | T+C | Tracking + signing; client signs/views. |
| Calculator | `/calculator` | T | Internal pricing (cost-of-services + capacity + pipeline). |
| Sales analytics | `/sales-analytics` | T | Pipeline + sales reporting. |
| Affiliates | `/affiliates` | T | Referral / affiliate program (currently orphaned from nav). |

### Clients (relationship management, team)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Clients | `/clients` (+`/[id]`) | T | Org management. Billing card + engagement-health card (gateable). |
| Brands | `/clients/brands/[id]` | T | Per-brand detail under a client. |
| Contacts | `/clients/contacts/[id]` | T | Per-contact detail. |

### Marketing (studio's own growth, team)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Content studio | `/content-studio` (+ round-table) | T | Blog / content engine. |
| Sitemap | `/sitemap` | T | Sitemap planning (owner-allowlisted today). |
| Social | `/social` | T | Buffer scheduling. |
| Reviews | `/reviews` | T | Case-study + testimonial pipeline. |
| Announcements | `/announcements` | T | Broadcast banners to clients. |

### Finance (money, mostly team; invoices shared)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Invoices | `/invoices` (+`/[id]`) | T+C | Billing records; client sees their own. |
| Billing | `/billing` | T | Subscription billing admin (Stripe). |
| Time | `/time` | T | Time tracking + Xero export. |
| Financial reports | `/financial-reports` | T | Cash, MRR, runway, reserves. |
| Reports | `/reports` | T | Operational reports. |

### Operations (running the studio, team)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Capacity | `/capacity` | T | Team capacity planning. |
| Team | `/team` | T | Team members + access rules. |

### Knowledge (team)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Docs Hub | `/docs` | T | Internal knowledge hub. |

### Client portal (the client's whole world, client)
| Feature | Route | Aud | Notes |
|---|---|---|---|
| Overview | `/overview` | C | Calm project home. |
| Requests | `/requests` | C | Submit + track, read-only status. |
| Messages | `/messages` | C | Talk to the studio. |
| Schedules | `/schedules` | C | Shared delivery spine (read). |
| Tracks | `/tracks` | C | Retainer capacity + queue position. |
| Files | `/files` | C | R2 file browser. |
| Services | `/services` | C | Service catalogue / order more. |
| Invoices | `/invoices` | C | Their billing. |
| Contracts | `/contracts` | C | Sign / view their contracts. |
| Proposals | `/proposals` | C | View proposals they were sent. |

### Settings and its builders (team, owner-heavy; Account for all) - full IA in spec 09
Settings is the foot-of-rail home for all configuration and owns the builders the surfaces consume:
Account (Profile, Appearance, Notifications, Booking link), Workspace (Branding, Modules, Studio details),
Intake & boards (Request forms, Kanban columns, Task templates), Sales & pipeline (defaults, stages,
lead automations), Automations & integrations (Stripe, Xero, Google, Slack, HubSpot, Mailerlite, Buffer;
Webhooks; Automations; Scheduled jobs / crons; AI cost + context docs), **Team & access (Team members,
Roles, Permissions builder, data scope)**, Billing (subscription, reserves), Advanced (Audit log, danger zone).
Sub-routes today: `/settings/audit`, `/settings/automations`, `/settings/crons`.

### Excluded from nav by design
- `/design-system` is a developer reference, not a user destination (reachable by direct URL / a dev affordance only).
- `/permissions` as a top-level route is **retired into Settings > Team & access** (redirect preserved). Remove the Operations nav item.

### Planned / near (leave the IA room for these)
Voice notes UI (in Messages/Requests), CSV exports (Time/Invoices/Requests), client onboarding checklist
(Overview), HubSpot/Slack/Mailerlite/Xero deepening (Settings), Zapier/outgoing webhooks (Settings),
automation rule builder (Settings), the contract calculator's Sales home, the Gmail/Chrome CRM extension
(external). None need a new top-level group; each is a row inside an existing group or a card inside a page.

**The design implication:** the nav model below must hold ~30 team destinations across 7 groups plus a
settings foot, AND a short warm client portal, AND degrade gracefully as permissions hide rows or as new
rows arrive. Groups that empty out vanish; a new feature is a single labelled row, never a redesign.

---

## Page purpose

Give every user a calm, legible, role-appropriate frame: know where you are, reach anything in two
interactions (group then item, or the command palette), and never see a door you cannot open. The shell
is the one piece of chrome present on every authenticated screen, so it sets the tokens, spacing, nav
model, and responsive rules everything in 05-09 inherits. It should disappear into the work: the content
is the hero, the chrome is quiet, and the single always-dark rail anchors the whole product like a spine.

## Why we are on this page

Nobody opens an app to admire its navigation, and that is exactly why the shell is a quality tell. A
client who pays a retainer logs in dozens of times; a teammate lives here all day; the owner runs a
business from it. The shell is judged not in 7 seconds like the auth scene, but in the hundredth small
moment: the rail that never reflows, the active item that is unmistakable at a glance, the search that
finds the thing in one keystroke, the client who never once sees an admin door and so never once feels
like a guest in someone else's tool.

The north-star is **"the right person is looking at the right map, and the map never lies."** A teammate's
scoped view must read as a finished, complete product, not the admin shell with most rows subtracted. A
client's portal must feel like a short, warm, confident place built for them, not a filtered version of an
ops console. The owner must feel they are sitting at a full instrument panel with a one-click lens onto any
client. If the shell is doing its job, no one notices it; they just always know where they are and get
where they are going.

**The single experiential throughline, which every element must serve or be cut:**

> Quiet, oriented, and never lost - the studio's spine, not its furniture.

Premium here is restraint and legibility: one always-dark rail, one rare leaf on the active item, hairlines
over slabs, ledger micro-type on labels, and a command palette that makes the whole 30-surface app feel two
keystrokes wide.

## Personas and jobs-to-be-done

**1. The owner (super_admin: Liam / Staci).** Runs the studio end to end.
- *Mindset:* high-frequency, context-switching all day across sales, delivery, money, and ops; wants density and reach, not minimalism.
- *JTBD:* "See everything, jump anywhere, and switch into any client's shoes in one click."
- *Must see:* the full map (all 7 groups + settings), live count badges where they matter, the command palette, the impersonation control, the money/dark-mode/currency/private toggles.
- *Must feel:* in command. The full instrument panel, calm not cluttered, with the one number and the one next-thing never more than a glance away (that is 06; the shell just frames it).

**2. The teammate (team_member: a designer, developer, or PM).** Scoped access, lives in their work.
- *Mindset:* focused, slightly protective of their attention; resents wading through tools that are not theirs; subconsciously proud of the product they help sell.
- *JTBD:* "Get me to my requests, tasks, and messages without a map of the whole business I do not need."
- *Must see:* Workspace always, plus exactly the groups their role grants (often one or two), each reading as complete; empty groups simply absent.
- *Must feel:* this was built for my role, not handed down with rows hidden. A focused workbench, not a locked filing cabinet.

**3. The client (client: a contact at a client org).** Sees the portal only.
- *Mindset:* a paying customer checking on work they care about; mildly time-pressed; reassured by clarity, unsettled by anything that smells like an internal tool.
- *JTBD:* "Find my project, submit a request, see where things stand, pay what I owe, without ever feeling like I wandered into the back office."
- *Must see:* a short warm list ("Your project", "Library", "Billing"), their stuff only, no internal vocabulary, no admin doors.
- *Must feel:* expected and well looked after. A boutique's private client room, not a ticket queue.

**4. The owner-as-client (impersonation lens).** The owner previewing a specific client's portal.
- *Mindset:* checking what the client actually sees, debugging a support question, QA-ing a release.
- *JTBD:* "Show me exactly this client's portal, and make it impossible for me to accidentally act as them."
- *Must see:* the impersonation banner, the nav swapped to that client's portal, write controls visibly inert.
- *Must feel:* safe. A read-only lens, server-enforced, never a session they can fat-finger a message or payment into.

**The tension to resolve:** the owner needs reach (a big map), the teammate needs focus (a small map that still feels whole), the client needs warmth (a short map that hides the machine). **The call:** one nav model, three *audience-shaped* compositions of it, all resolved server-side, never one chrome with client-side rows hidden. The rail is always dark for all three (a fixed brand spine); only its contents differ.

## Experience principles (on top of Studio Ledger)

1. **The sidebar is the one always-dark surface.** Like the auth forest and the leaf, the rail is a fixed brand object: forest ink regardless of light or dark mode, framing the cream canvas like paper on a desk. It is the product's spine.
2. **Audience-shaped, not audience-filtered.** The client portal nav is its own short, warm list, and a teammate's scoped view reads as a finished subset. Never the team nav with rows removed. Empty groups disappear entirely; they never render as empty headers.
3. **Two interactions to anything, or zero via search.** Group then item, or the command palette (`Cmd/Ctrl-K`) that jumps to any of the ~30 surfaces, any client, any setting. No third level of nesting in the rail; depth lives in the page, not the tree.
4. **The active state is the rare leaf.** The current item carries the leaf radius and the one accent; everything else is quiet ink. At most one leaf in the rail at a time, the way the auth pill is the one leaf on the panel.
5. **Quiet chrome, loud content.** The top bar is a hairline, not a slab (~56-60px). Counts are small ledger badges, not loud pills. The page title is bare ink on cream, not a card.
6. **Collapse is for power users, not the default.** Expanded rail with group labels is the resting state; icon-only collapse is a remembered choice. When collapsed, groups force-open so every icon stays reachable.
7. **The map never lies.** A door you can see is a door you can open; nav visibility equals real access (server-resolved), so a teammate never clicks into a 403 and a client never glimpses an internal word. Visibility is courtesy; the server is the gate (05).

## Anatomy of the shell

Five regions, consistent across every internal page:

1. **Sidebar (left, always dark).** Wordmark / icon mark, grouped nav, collapse control, and the user card pinned to the bottom. The spine.
2. **Top bar (hairline).** Page context / lightweight breadcrumb on the left; on the right a quiet control cluster: command-palette/search affordance, notifications bell with count, display-currency switch, private-mode toggle, dark-mode toggle, owner-only impersonation control, then the avatar.
3. **Command palette (overlay, `Cmd/Ctrl-K`).** The fast path across the whole app: fuzzy-jump to any surface, any client, any setting; recent destinations; quick actions ("New request", "New task"). The "search everything" the owner relies on and the teammate learns to love.
4. **Impersonation banner (owner only, when active).** A thin sticky strip making "Viewing <Client>, read-only" unmissable, with a one-click exit. The lens is read-only and server-enforced; write affordances in the previewed portal render disabled with a tooltip, never as live buttons that fail.
5. **Page frame (cream canvas).** Generous gutters, a max content width, the page title as bare ink, optional right-aligned actions slot, content below. This is the skeleton every page in 05-09 starts from.
6. **Mobile bottom tabs.** On small screens the rail collapses to a bottom tab bar (4-5 tabs, 44px+), with the overflow nav and the command palette in a slide-up sheet.

## Navigation model (the three audiences, future-proofed)

Group labels are tiny uppercase ledger micro-text. Items carry an icon, a label, and an optional count badge.
Resolved server-side from `lib/permissions.ts` + `lib/feature-tree.ts`, never trusted from the client. Order
within a group is stable so muscle memory holds.

**Owner / teammate (team audience)** - groups, with teammates seeing only what their role grants:
- **Workspace:** Overview, Requests, Tasks, Messages
- **Sales:** Leads, Calls, Deals, Proposals, Schedules, Contracts, Calculator, Sales analytics, Affiliates
- **Clients:** Clients (brands + contacts are drill-ins on the client detail, not separate rows)
- **Marketing:** Content studio, Sitemap, Social, Reviews, Announcements
- **Finance:** Invoices, Billing, Time, Financial reports, Reports
- **Operations:** Capacity, Team
- **Knowledge:** Docs Hub

Settings sits at the **foot of the rail**, not in a group (it is the control room, always reachable, its contents
gated per audience). The Permissions builder lives inside Settings > Team & access; the old `/permissions` route
redirects there so existing links survive. Sitemap stays owner-allowlisted until it is generalised.

**Client (client audience)** - a short, warm, self-contained list:
- **Your project:** Overview, Requests, Messages, Schedule
- **Library:** Files, Services
- **Billing:** Invoices, Contracts, Proposals

(Tracks - the retainer queue - surfaces inside the client Overview and Requests board as the "active now / next in
queue" signal rather than as its own rail row, so the portal stays to three calm groups. If a dedicated Tracks
destination is wanted, it joins "Your project".)

**Rules:** owner sees all groups; a teammate sees Workspace plus whatever their role baseline + feature overrides
grant (empty groups vanish, never render as empty headers); a client sees only the portal groups. Settings is
reachable by every audience and gates its own contents (a client sees only Account). The command palette indexes
exactly the destinations the user can actually reach, so search never offers a denied door.

**Future-proofing the model:** the structure is a flat two-level tree (group -> item) plus a global search, chosen
precisely because it scales: a new feature is a new row in an existing group (or a new card inside a page), never a
new nesting level or a re-layout. New groups are possible but discouraged; prefer placing a feature in the nearest
existing group. Counts, badges, and "new" markers are per-item data, so lighting up a feature is a prop, not a build.

## Global search / command palette (search everything)

The palette is the owner's reach multiplier and the answer to "how do I find anything in a 30-surface app". It opens
on `Cmd/Ctrl-K` (and a top-bar search affordance), as a centered overlay over a dimmed canvas.

- **What it searches:** every nav destination the user can reach (fuzzy on label + group), every client / org by name
  (jump to the client detail or impersonate), settings sections, and quick actions ("New request", "New task", "New
  invoice", "Switch currency", "Toggle theme"). Results are grouped (Pages / Clients / Settings / Actions) with the
  most-relevant first; recent destinations show on open before any query.
- **What it never offers:** a destination the user cannot reach (the index is the resolved feature map), so the palette
  can never surface a denied door or leak an internal surface to a client.
- **Behaviour:** type-to-filter, arrow-key navigation, Enter to go, Esc to close, focus returns to the trigger. A
  result row shows an icon, a label, and a faint group/path crumb. Empty query shows recents + top actions; empty
  results shows "No matches" with a calm hint.
- **Why it matters:** it makes the depth invisible. The rail can hold 30 destinations without ever feeling heavy
  because the palette is always the zero-interaction path, the way Linear's Cmd-K makes a large app feel small.

## Layout and composition - desktop

The rail is a fixed always-dark column; the top bar spans the content; the canvas is cream.

**Proportions and grid:**
- **Sidebar:** fixed left, full height, forest ink. Expanded width comfortable for icon + label + count (~`240px`); collapsed to an icon rail (~`64px`). Wordmark top, scrollable grouped nav, user card pinned bottom.
- **Content column:** fills the rest. Top bar `56-60px` with a hairline bottom border; canvas below on `--color-bg-cream` with generous side gutters and a max content width; the page title renders as large bare ink at the top of the canvas, not inside a card.
- **Active item:** leaf-radius (`--radius-leaf-sm`) background wash in the dark-rail active token + brand-light icon + white label. Group labels: uppercase micro-text in muted sidebar ink, count badge right-aligned where relevant.

```
+----------------------------------------------------------------------+ cream canvas
| SIDEBAR (always dark, 240px) | TOP BAR (hairline, 56-60px)           |
| Tahi (wordmark)              | Requests            [search] (bell 3) ($) (eye) (moon) (av)
| .........................    +---------------------------------------+
| WORKSPACE                    |                                       |
|  () Overview                 |  Requests                  [ + New ]   |  <- page title bare ink
|  () Requests        (3)      |  ----------------------------------    |
| [() Tasks ]  <- active leaf  |                                       |
|  () Messages                 |   content region (the page, spec 07)  |
| SALES                        |                                       |
|  () Leads  Calls  Deals ...  |                                       |
| FINANCE                      |                                       |
|  () Invoices  Billing ...    |                                       |
| .........................    |                                       |
|  [collapse]                  |                                       |
|  (av) Liam . Tahi Studio     |                                       |
+----------------------------------------------------------------------+
                ^ command palette (Cmd-K) overlays the whole canvas, centered
```

## Layout and composition - mobile

- The sidebar is hidden; primary destinations move to a **bottom tab bar** (4-5 tabs max, 44px+ targets, leaf-radius active state). Client portal tabs: Overview, Requests, Messages, Files, More. Team tabs: Overview, Requests, Tasks, Messages, More.
- The top bar condenses to the icon mark / avatar + a search affordance; search and the command palette become a full-screen sheet.
- "More" opens a slide-up sheet listing the same groups (the full rail), so nothing in the map is unreachable on mobile.
- No horizontal scroll at 375px; gutters tighten but never disappear; the impersonation banner, when active, sits above the content as a thin strip.

```
+---------------------------+
|  (mark)   Requests  (Q)   |  <- condensed top bar
+---------------------------+
|                           |
|   content (the page)      |
|                           |
+---------------------------+
| (o) (o) [o] (o) (=)       |  <- bottom tabs, active = leaf
|  Ovw  Req  Tsk  Msg  More |
+---------------------------+
```

## Component spec

Tokens follow Studio Ledger; the sidebar uses the hardcoded forest palette (CLAUDE.md), the rest uses CSS variables so dark mode just works.

**Sidebar group**
- Purpose: cluster destinations under a ledger micro-label; collapsible.
- Anatomy: label row (uppercase micro-text + optional collapse chevron + optional count), then items. State persisted to `localStorage` (`tahi-sidebar-groups`). When the rail is icon-collapsed, groups force-open so all icons stay reachable.
- States: expanded / collapsed (chevron rotates on `--ease-out`); empty group not rendered at all.

**Nav item**
- Purpose: one destination.
- Tokens: icon (`--icon-muted` `#5f9458` rest / `--icon-active` `#93c98a` active) + label (`--text-muted` `#7aaa72` rest / `--text-active` `#ffffff` active) + optional count badge. Min height `40px` (44px touch on mobile).
- States: rest (quiet ink); **hover** (`bg-hover` `#2a3826` wash, label lifts to active text); **active** (`bg-active` `#2f3f2c` + leaf radius + brand-light icon + white label + `aria-current="page"`); focus-visible ring. Active is the one leaf in the rail.

**User card (sidebar bottom)**
- Avatar, name, role/org line, and a menu (Account, Appearance/theme, Sign out). For clients it shows their org; for an impersonating owner it shows the active client target. Avatar is a circle (not leaf). Menu is keyboard operable, escapable.

**Top-bar controls**
- Each is a quiet icon button with a visible focus ring and a tooltip (verbs: "Search", "Notifications", "Switch currency", "Private mode", "Toggle theme", "View as client"). Counts are small ledger badges (hidden at zero). The search affordance opens the command palette. Targets `>=44px` on touch.

**Command palette**
- Centered overlay, dimmed backdrop. A single search input at top (placeholder "Search or jump to..."), grouped results below (Pages / Clients / Settings / Actions), each row icon + label + faint crumb. Keyboard: type to filter, up/down to move, Enter to go, Esc to close, focus trap while open, focus returns to trigger on close. Empty query = recents + top actions; empty results = "No matches." Never lists a denied destination.

**Impersonation banner**
- Sticky, thin, status-info tone (not alarming): "Viewing <Client>, read-only" + "Exit" button. Only ever for owner. Because the lens is read-only, write affordances in the previewed portal render disabled with a tooltip ("Read-only while viewing as a client"), never live buttons that fail on click.

**Page frame**
- A consistent wrapper owning the title slot (bare ink `<h1>`), an optional right-aligned actions slot, and the content region, so every page in 05-09 starts from the same skeleton and the title never sits in a card.

**Collapse control + sidebar footer**
- A quiet full-width button (icon + "Collapse" label when expanded; icon + tooltip when collapsed) above the user card, with a hairline divider. Collapse state drives rail width via a `[data-sidebar="collapsed"]` attribute set before hydration (no flash).

## Motion and dynamism

Calm, singular, Studio Ledger ease (`--ease-out cubic-bezier(.22,1,.36,1)`), no bounce, no spring.

- **Sidebar collapse/expand:** width transition (~`320ms`), labels fade with the width; the inline pre-hydration attribute means the first paint is correct with no animation.
- **Group expand/collapse:** height ease (grid `0fr -> 1fr`), content fades.
- **Active state:** the leaf slides to the new item on route change; the content region does a calm cross-fade (no slide-in jank).
- **Command palette:** overlay fades in (~`150ms`), the panel rises `8px`, backdrop dims; close reverses.
- **Bottom sheet (mobile):** slide up on ease-out, backdrop fade.
- **Reduced motion:** `prefers-reduced-motion: reduce` kills all of the above (instant state, no slide/fade), keeping every surface fully usable and on-brand.

## Accessibility (WCAG 2.2 AA)

- **Landmarks:** `<nav aria-label="Primary">` for the rail and `aria-label="Primary"` bottom tabs, `<header>` for the top bar, `<main>` for the canvas; `SkipToContent` lands focus on `<main>`.
- **Current + expanded state:** `aria-current="page"` on the active item; `aria-expanded` + `aria-controls` on collapsible group buttons; the command palette is `role="dialog" aria-modal="true"` with a labelled input and a focus trap.
- **Names + focus:** every control has a visible focus ring and an accessible name; icon-only buttons get `aria-label` + tooltip; never `outline:none` without a `:focus-visible` substitute.
- **Contrast on the dark rail (1.4.3):** white / brand-light on forest must clear AA; the active state never relies on colour alone (the leaf shape + weight + brand icon also signal it). Re-test the muted `#7aaa72` label against `#1e2a1b` for body-size text; promote to a lighter ink if it misses 4.5:1.
- **Target size (2.5.8):** `>=44px` on mobile tabs, sheet rows, and top-bar controls; `>=24px` floor everywhere.
- **Keyboard path:** tab through groups, arrow within a group, `Cmd/Ctrl-K` for jump-to; the palette is fully keyboard-operable and escapable with focus return; no keyboard trap (2.1.2); on route change move focus to the page `<h1>` for screen-reader orientation.
- **Reduced motion (2.2.2):** per the Motion section.
- **Forced colors:** give the dark rail a solid `background-color` fallback so labels survive when gradients/tints are stripped; focus rings use system colours; the active item stays distinguishable by shape.

## States and flows

- **Collapsed vs expanded rail** (persisted, no flash on refresh).
- **Group collapsed vs expanded** (persisted per group); collapsed-rail forces groups open.
- **Owner impersonating a client** (banner + nav swaps to the client portal, read-only: write controls disabled with tooltip) and **exit impersonation** (banner clears, nav returns).
- **Teammate with a narrow role** (few groups; empty groups absent, never shown empty; Workspace always present).
- **Command palette** open / typing / results / empty results / recents-on-open / Esc-close.
- **Notification count** present / zero (badge hidden at zero); bell opens the notifications surface or panel.
- **Loading:** the rail renders immediately from server-resolved permissions; the content region shows the page's own skeleton; the shell never blocks on the page.
- **Route not permitted:** the item is never rendered and the palette never lists it; a deep link to a denied route returns the page's own forbidden state, and the shell stays intact around it.
- **Theme:** light / dark toggle (persisted `tahi-theme`, applied to `<html>` before paint); the rail stays forest in both.

## Copy deck

Calm, plain NZ voice. Hyphens only, no em/en dashes.

- Group labels (team): `Workspace`, `Sales`, `Clients`, `Marketing`, `Finance`, `Operations`, `Knowledge`.
- Group labels (client): `Your project`, `Library`, `Billing`.
- Settings (foot): `Settings`.
- Impersonation banner: `Viewing <Client>, read-only` / `Exit`. Disabled-write tooltip: `Read-only while viewing as a client.`
- User card menu: `Account`, `Appearance`, `Sign out`.
- Command palette placeholder: `Search or jump to...` Result groups: `Pages`, `Clients`, `Settings`, `Actions`. Empty: `No matches.`
- Search / top-bar tooltips (verbs): `Search`, `Notifications`, `Switch currency`, `Private mode`, `Toggle theme`, `View as client`.
- Empty notifications: `You are all caught up.`
- Collapse control: `Collapse` / `Expand`.

## Tokens and visual reference

| Where | Token / value |
|---|---|
| Sidebar background (always dark) | `#1e2a1b` |
| Sidebar border | `#2d3d2a` |
| Sidebar group label | `#4a6145` |
| Sidebar text muted / active | `#7aaa72` / `#ffffff` |
| Sidebar bg hover / active | `#2a3826` / `#2f3f2c` |
| Sidebar icon muted / active | `#5f9458` / `#93c98a` |
| Active nav radius | `--radius-leaf-sm` `0 .625rem 0 .625rem` |
| Inactive nav radius | `--radius-md` `.5rem` |
| Canvas | `--color-bg-cream` (light `#F7F6F3` / dark `#131211`), never hardcoded |
| Top bar / content | standard surface + text tokens (`--color-text`, `--color-text-muted`, `--color-bg`) so dark mode just works |
| Hairlines | `--color-border` / `--color-border-subtle` |
| Count badge (active / rest) | `--color-brand` on white / `--color-bg-secondary` + `--color-border-subtle` |
| Command-palette overlay | dimmed backdrop + surface panel on `--color-bg`, hairline border, `--radius-leaf` on the panel optional |
| Motion | collapse ~`320ms`; palette ~`150ms`; all `--ease-out`; no bounce; full reduced-motion fallback |
| Font | Manrope 400-800; group labels `0.6875rem` 600 uppercase `0.08em`; nav labels `0.8125rem` |
| Leaf radius usage | active nav item + primary CTA only. Not group labels, not the avatar, not badges |

## Deliverables for Claude design

1. **Owner shell - desktop:** full nav (all 7 groups + Settings foot), top bar with the control cluster, cream canvas with a placeholder page title + actions slot; active state on the leaf.
2. **Teammate shell - desktop:** a deliberately narrow role (Workspace only + one granted group) so the scoped view reads as complete, not subtracted.
3. **Client portal shell - desktop:** the three-group warm nav (Your project / Library / Billing), no admin tooling visible anywhere.
4. **Command palette** open: query typed, grouped results (Pages / Clients / Settings / Actions), one row highlighted; plus the empty-query recents state.
5. **Collapsed icon-rail** variant (owner) with tooltips.
6. **Owner impersonating a client:** banner + portal nav, with a write control shown disabled + tooltip.
7. **Mobile - client portal:** bottom tab bar + "More" overflow sheet (375px).
8. **Mobile - owner/teammate:** condensed top bar + nav sheet + bottom tabs.
9. **Dark mode:** the canvas + top bar in dark; sidebar unchanged (always dark); prove contrast holds.
10. **State sheet:** count badges, hover/active/focus on a nav item, group collapsed/expanded, notifications empty, palette empty-results, route-denied forbidden state inside an intact shell.

**Integration constraints (so it drops into the codebase):**
- Sidebar colours are the hardcoded forest palette above; everything else uses CSS variable tokens, never hardcoded hex.
- Nav visibility + the palette index are resolved server-side from `lib/permissions.ts` + `lib/feature-tree.ts`; design the three audience views and the search index, do not invent client-side role logic. The nav must be a faithful map of the feature surface in the section above; do not orphan a real route or invent a fake one.
- Reuse the existing region components (`app-sidebar`, `app-top-nav`, `mobile-bottom-nav`, `sidebar-user-card`, `keyboard-shortcuts` palette); this is a recolour to the dark rail + an IA reconciliation + the palette build-out, not a from-scratch rebuild.
- Retire the top-level `/permissions` nav item into Settings > Team & access (redirect preserved); keep Sitemap owner-allowlisted; exclude `/design-system` from the nav.
- Leaf radius only on the active item and CTA; honour `prefers-reduced-motion`, 44px touch targets, visible focus, AA contrast on the dark rail.

## Why this is premium

Most dashboards betray their three audiences with one chrome and a pile of hidden rows, so a client feels like a
guest in an admin tool and a junior teammate feels lost in a map they cannot read. The Studio Ledger shell gives each
audience a frame that looks finished and made for them: the client gets a short, warm, confident portal; the teammate
gets a focused workbench that still reads as whole; the owner gets the full instrument panel with a one-click,
read-only client lens. The always-dark rail is a fixed brand spine that makes the cream canvas feel like paper on a
desk; the single rare leaf marks where you are without shouting; the hairline top bar keeps the eye on the work; and
the command palette makes a thirty-surface app feel two keystrokes wide, so depth never costs calm. The restraint, one
rail, one leaf, ledger badges, real server-true visibility, is the editorial confidence a template never commits to:
the chrome earns its keep by disappearing, and the map never once lies to the person reading it.
