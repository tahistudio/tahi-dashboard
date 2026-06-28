# App shell and navigation - design brief

> The frame every authenticated screen lives in: the always-dark sidebar, the top
> bar, the mobile bottom tabs, and the cream canvas they wrap. This is the
> foundation for 06-home, 07-requests, 08-tasks and every surface after. It is
> also the first place the three audiences (owner, teammate, client) visibly
> diverge, because the navigation they see is different.

> Prepend `_studio-ledger-theme.md` before this brief in Claude design.

## What exists today (as built)

The shell is built and live; this brief redesigns it to the Studio Ledger bar, it does not start from nothing.

- `app/(dashboard)/layout.tsx` - resolves auth + permissions server-side, wraps children in `SidebarProvider`, `PermissionsProvider`, `DisplayCurrencyProvider`, `PrivateModeProvider`, `ToastProvider`, plus `AppSidebar`, `AppTopNav`, `MobileBottomNav`, `ImpersonationBanner`, `ProductTour`, `KeyboardShortcuts`, `SkipToContent`.
- `components/tahi/app-sidebar.tsx` - grouped nav with collapsible groups, count badges, collapse-to-icon, role flags (`adminOnly`, `clientVisible`, `clientOnly`, `requiresManage`, `emailAllowlist`).
- `components/tahi/app-top-nav.tsx`, `mobile-bottom-nav.tsx`, `sidebar-user-card.tsx`, `sidebar-card.tsx`, `sidebar-context.tsx`.
- Role model (`lib/permissions.ts`): `super_admin`, `admin`, `team_member`, `client`. Nav is filtered by resolved permissions, never by the client.

The job here is consistency and polish: make the shell unmistakably Studio Ledger, make the three audience views feel intentionally designed (not the same chrome with rows hidden), and fix the rough edges (group density, collapsed state, mobile portal).

## Page purpose

Give every user a calm, legible, role-appropriate frame: know where you are, reach anything in two interactions, and never see a door you cannot open. The shell should disappear into the work, the content is the hero, the chrome is quiet.

## Why this is the foundation

Every other redesign spec renders inside this frame, so its tokens, spacing, nav model, and responsive behaviour set the rules everything inherits. Getting the audience split right here means 06-08 can assume "the right person is looking at the right nav" and focus on their own content. It is also where the always-dark sidebar (a deliberate brand surface, like the auth scene) anchors the whole product.

## Personas and jobs-to-be-done

- **Owner (super_admin, Liam / Staci).** Runs the studio. Needs the full map: sales, clients, finance, operations, permissions. Can impersonate a client to see their portal. Can never be locked out. Job: "see everything, jump anywhere, switch lenses."
- **Teammate (team_member).** A designer, developer, or PM with scoped access. Sees only the groups their role grants. Job: "get to my work (requests, tasks, messages) without wading through tools that are not mine."
- **Client (client).** A contact at a client org. Sees the portal only: their project, files, services, invoices. Job: "find my stuff, submit a request, see where things stand, without ever feeling like I am in someone else's admin tool."

The shell must make a teammate's scoped view and a client's portal feel like first-class, finished products, not the admin shell with permissions subtracted.

## Experience principles (on top of Studio Ledger)

1. **The sidebar is the one always-dark surface.** Like the auth scene and the leaf, it is a fixed brand object: forest ink regardless of light or dark mode. It frames the cream canvas.
2. **Audience-shaped, not audience-filtered.** The client portal nav is its own short, warm list ("Your project", "Library", "Billing"), not the team nav with most rows removed. A teammate sees a focused subset that still reads as complete.
3. **Two interactions to anything.** Group then item, or search. No third level of nesting in the rail.
4. **The active state is the rare leaf.** The current nav item carries the leaf radius and the one accent; everything else is quiet ink. At most one leaf in the rail at a time.
5. **Quiet chrome, loud content.** The top bar is a hairline, not a slab. Counts are small ledger badges, not loud pills.
6. **Collapse is for power users, not the default.** Expanded rail with group labels is the resting state; icon-only collapse is a deliberate choice the shell remembers.

## Anatomy of the shell

Five regions, consistent across every internal page:

1. **Sidebar (left, always dark).** Wordmark, grouped nav, collapse control, and the user card pinned to the bottom.
2. **Top bar (hairline).** Page context / breadcrumb, global search, notifications, display-currency switch, private-mode and dark-mode toggles, owner-only impersonation control.
3. **Impersonation banner (owner only, when active).** A thin sticky strip making "you are viewing as <client>" unmissable, with a one-click exit. The client lens is **read-only**: a previewing owner sees the client's portal exactly but cannot mutate their data (no send, no submit, no reorder, no pay). Design the banner to communicate this calmly ("Viewing as <Client>, read-only") so the owner is never surprised that a write is disabled.
4. **Page frame (cream canvas).** The content region: generous gutters, a max content width, the page title as bare ink, content below. This is where 06-08 live.
5. **Mobile bottom tabs.** On small screens the sidebar collapses to a bottom tab bar (the client portal especially), with the overflow nav in a sheet.

## Navigation model (the three audiences)

Group labels are tiny uppercase ledger micro-text. Items carry an icon, a label, and an optional count badge. Resolved server-side from permissions, never trusted from the client.

**Owner / teammate (team audience)** - groups, with teammates seeing only what their role grants:
- **Workspace:** Overview, Requests, Tasks, Messages
- **Sales** (owner): Leads, Calls, Deals, Proposals, Schedules, Contracts, Calculator, Sales analytics
- **Clients** (owner): Clients
- **Marketing** (owner): Content studio, Sitemap, Social, Reviews, Announcements
- **Finance:** Invoices, Billing (owner), Time (owner), Financial reports (owner), Reports (owner)
- **Operations** (owner): Capacity, Team
- **Knowledge** (owner): Docs Hub

Settings (and the Permissions builder it now contains) sits at the foot of the rail, not in a group. Permissions is no longer a top-level item: it lives inside Settings > Team & access (see 09-settings.md); the old `/permissions` route redirects there so existing links survive.

**Client (client audience)** - a short, warm, self-contained list:
- **Your project:** Overview, Requests, Messages
- **Library:** Files, Services
- **Billing:** Invoices

Rules: owner sees all groups; teammate sees Workspace plus whatever their role baseline + feature overrides grant (empty groups disappear entirely, never render as empty headers); client sees only the three portal groups. Settings is reachable by every audience (its contents gate per audience: a client sees only Account); the Permissions builder inside it appears only for users who can manage permissions.

## Layout and composition - desktop

- **Sidebar:** fixed left, full height, forest ink. Expanded width comfortable for label + count; collapsed to an icon rail. Wordmark top, scrollable grouped nav, user card pinned bottom. Active item: leaf-radius background wash + brand-light icon + white label. Group labels: uppercase micro-text in muted sidebar ink, with a count badge right-aligned where relevant.
- **Top bar:** spans the content column, hairline bottom border, ~56-60px. Left: page title / lightweight breadcrumb. Right cluster: search (or a search affordance that opens the command palette), notifications bell with count, currency switch, private-mode toggle, dark-mode toggle, then the user/avatar. Owner gets an "impersonate / view as client" entry here.
- **Canvas:** cream page background (`--color-bg-cream`), never hardcoded. Content max-width with generous side gutters; the page title renders as large bare ink at the top of the canvas, not inside a card.

## Layout and composition - mobile

- Sidebar is hidden; primary destinations move to a **bottom tab bar** (4-5 tabs max, 44px+ targets, leaf-radius active state). Client portal tabs: Overview, Requests, Messages, Files, More.
- The top bar condenses: wordmark/avatar + a menu affordance; search becomes a full-screen sheet.
- Overflow nav (everything not in the bottom tabs) opens in a slide-up sheet listing the same groups.
- No horizontal scroll at 375px; content gutters tighten but never disappear.

## Component spec

- **Sidebar group:** label row (uppercase micro-text + optional collapse chevron + count), then items. Collapsible; state persisted to `localStorage` (`tahi-sidebar-groups`). When the rail is icon-collapsed, groups force-open so all icons stay reachable.
- **Nav item:** icon + label + optional count badge; hover wash; active = leaf radius + accent. Keyboard focusable, `aria-current="page"` on the active route.
- **User card (sidebar bottom):** avatar, name, role/org line, and a menu (account, theme, sign out). For clients it shows their org; for owner it can show the active impersonation target.
- **Top bar controls:** each is a quiet icon button with a visible focus ring and a tooltip; counts are small ledger badges. The command palette (existing keyboard shortcuts) is the fast path.
- **Impersonation banner:** sticky, thin, status-info tone (not alarming), "Viewing <Client>, read-only" + "Exit" button. Only ever for owner. Because the lens is read-only, write affordances in the previewed portal render in a disabled/quiet state with a tooltip ("Read-only while viewing as a client"), never as live buttons that fail on click.
- **Page frame:** a consistent wrapper that owns the title slot, optional actions slot (right-aligned), and the content region, so every page in 06-08 starts from the same skeleton.

## Motion and dynamism

- Sidebar collapse/expand: width transition on the Studio Ledger ease, no bounce.
- Group expand/collapse: height ease, content fades.
- Route change: content region does a calm cross-fade; the nav active state slides the leaf to the new item.
- Bottom-sheet (mobile): slide up on ease-out, backdrop fade.
- All of the above respect `prefers-reduced-motion` (no transitions, instant state).

## Accessibility

- Landmarks: `<nav>` for the rail and bottom tabs, `<header>` for the top bar, `<main>` for the canvas; `SkipToContent` lands on `<main>`.
- `aria-current="page"` on the active item; `aria-expanded` + `aria-controls` on collapsible group buttons.
- Every control has a visible focus ring and an accessible name (icon-only buttons get `aria-label` / tooltip).
- Touch targets >= 44px on mobile tabs and sheet rows.
- Sidebar contrast: white/brand-light on forest meets AA; never rely on colour alone for the active state (the leaf shape + weight also signal it).
- Full keyboard path: tab through groups, arrow within a group, command palette for jump-to.

## States and flows

- **Collapsed vs expanded rail** (persisted).
- **Group collapsed vs expanded** (persisted per group).
- **Owner impersonating a client** (banner + the nav swaps to the client portal view, **read-only**: write controls disabled with a tooltip, never live) and **exit impersonation**.
- **Teammate with a narrow role** (few groups; empty groups absent, never shown empty).
- **Loading** (nav renders immediately from resolved permissions; content region shows the page's own skeleton).
- **Notification count** present / zero (badge hidden at zero).
- **Route not permitted** (item never rendered; a deep link to a denied route returns the page's own forbidden state, the shell does not break).

## Copy deck

- Group labels: Workspace, Sales, Clients, Marketing, Finance, Operations, Knowledge (team); Your project, Library, Billing (client).
- Impersonation banner: "Viewing <Client>, read-only" / "Exit". Disabled-write tooltip: "Read-only while viewing as a client."
- User card menu: Account, Appearance, Sign out.
- Search placeholder: "Search or jump to..." Empty notifications: "You are all caught up."
- Tooltips are verbs ("Search", "Notifications", "Switch currency", "Toggle theme").

## Tokens and visual reference

- **Sidebar (always dark, hardcoded per CLAUDE.md):** bg `#1e2a1b`, border `#2d3d2a`, group label `#4a6145`, text muted `#7aaa72`, text active `#ffffff`, bg hover `#2a3826`, bg active `#2f3f2c`, icon muted `#5f9458`, icon active `#93c98a`.
- **Canvas:** `--color-bg-cream` (warm sand light `#F7F6F3` / dark `#131211`), never hardcoded.
- **Active nav:** leaf radius `--radius-leaf-sm` + brand accent; everything else small square radii.
- **Top bar / content:** standard surface + text tokens so dark mode just works; hairlines use `--color-border` / `--color-border-subtle`.

## Deliverables for Claude design

1. **Owner shell - desktop:** full nav, top bar, cream canvas with a placeholder page title; active state on the leaf.
2. **Teammate shell - desktop:** a deliberately narrow role (Workspace only + one granted group) so the scoped view reads as complete.
3. **Client portal shell - desktop:** the three-group warm nav, no admin tooling visible.
4. **Collapsed icon-rail** variant (owner).
5. **Owner impersonating a client:** banner + portal nav.
6. **Mobile - client portal:** bottom tab bar + overflow sheet (375px).
7. **Mobile - owner/teammate:** condensed top bar + nav sheet.
8. **Dark mode:** the canvas in dark; sidebar unchanged (always dark); prove contrast holds.
9. **State sheet:** count badges, hover/active/focus on a nav item, group collapsed/expanded, notifications empty.

**Integration constraints (so it drops into the codebase):**
- Sidebar colours are the hardcoded const palette above; the rest uses CSS variable tokens, never hardcoded hex.
- Nav visibility is resolved server-side from `lib/permissions.ts`; design the three audience views, do not invent client-side role logic.
- The shell can assume its occupant is a real, entitled user: an unprovisioned or unpaid/un-invited lead is held in onboarding by the access gate and never reaches this frame, so the shell never has to render a "you have no workspace / you have not paid" empty state (that lives in onboarding, spec 02). The client audience is a provisioned client org (Clerk org mapped to a D1 organisation); the read-only client lens is server-enforced, so the disabled write affordances are reflecting a real server rule, not a cosmetic guess.
- Reuse the existing region components (`app-sidebar`, `app-top-nav`, `mobile-bottom-nav`, `sidebar-user-card`); this is a reskin + UX tightening, not a rebuild.
- Leaf radius only on the active item and CTA; everything else square-ish.
- Honour `prefers-reduced-motion`, 44px touch targets, visible focus, AA contrast on the dark rail.

## Why this is premium

Most dashboards betray their three audiences with one chrome and a pile of hidden rows, so a client feels like a guest in an admin tool and a junior teammate feels lost in a map they cannot read. The Studio Ledger shell instead gives each audience a frame that looks finished and made for them: the client gets a short, warm, confident portal; the teammate gets a focused workbench; the owner gets the full instrument panel with a one-click client lens. The always-dark rail is a fixed brand object that makes the cream canvas feel like paper on a desk, the single rare leaf marks where you are without shouting, and the quiet hairline top bar keeps the eye on the work. It is the restraint a template never commits to: the chrome earns its keep by disappearing.
