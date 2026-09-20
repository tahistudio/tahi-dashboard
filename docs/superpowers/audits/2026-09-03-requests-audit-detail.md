# Requests detail audit: repo vs Claude Design prototype

Date: 2026-09-03
Scope: the `newUi` (super admin) branch of the request detail page only. Legacy branches ignored.
Method: read the prototype detail view and its CSS in full, then the repo's `newUi` render path and every component it mounts, then diffed block by block.

Prototype sources (all under `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final\`):
`requests-detail.jsx`, `requests-detail.css`, `requests.css`, `requests-kit.jsx`, `requests-focus.css`.

Repo sources: `app\(dashboard)\requests\[id]\request-detail.tsx` and `components\tahi\**`.

---

## 1. Block order comparison

### Main column

| Prototype (`requests-detail.jsx:190-216`) | Repo (`request-detail.tsx:1325-1610`) |
|---|---|
| Brief (description) | Thread and composer |
| Conversation: thread, then composer | Description |
| Sub-requests (team only) | Sub-requests |
| Files, with a proofing viewer | Tasks spawned from this request (repo addition) |
| Activity | Files |
| | Activity |

### Right rail

| Prototype (`requests-detail.jsx:218-224`) | Repo (`request-detail.tsx:1612-1815`) |
|---|---|
| Time (team, not read-only) | Time (admin) |
| Actions (team) | Actions (admin) |
| Discovery calls (team) | Discovery calls (admin) |
| Details | People |
| People | Checklists |
| Checklist (team) | Details |

### Above the grid

| Prototype | Repo |
|---|---|
| Back link "All requests" | Breadcrumb with parent when nested |
| Header: number, status, priority, internal chip, scope chip, revision chip with popover, actions menu | Header card: number, status, priority, scope chip, revision chip with popover, actions menu, people stack beside the title |
| Sub-meta: client, "Opened X", due chip, "Led by X" | Sub-meta: client, "Created X", "Due X" |
| Scope warning strip (team, when flagged) | absent |
| Delivery spine as its own bordered card | Progress strip inside the header card |
| Off-pipeline note for draft and archived | absent |
| Client review bar | Client review bar, then AI triage banner (repo addition) |

---

## 2. Liam's first report: the All / Comments sliding toggle

**The prototype detail page has no All / Comments control at all.** Its Activity block carries only a Show / Hide action (`requests-detail.jsx:211-216`), and the events it lists are activity rows, never thread messages.

The sliding pill Liam is describing is `.req-seg` / `.req-seg-pill`, defined at `requests.css:27-34`:

```css
.req-seg-pill{ position:absolute; top:3px; bottom:3px; left:0; background:var(--bg); border-radius:8px;
  box-shadow:0 1px 2px rgba(26,25,20,.08), inset 0 0 0 1px var(--border-subtle); z-index:0;
  transition:transform .36s cubic-bezier(.22,1,.36,1), width .36s cubic-bezier(.22,1,.36,1); }
@media (prefers-reduced-motion: reduce){ .req-seg-pill{ transition:none; } }
```

It is used only by the list page view switcher (`requests-toolbar.jsx:177-182` and `requests-list.jsx:33-38`), where the pill is positioned by measuring the active button's `offsetLeft` and `offsetWidth`.

So this is a port of a list-page pattern onto the detail page, not a prototype behaviour that was lost. The repo's own toggle (`request-detail.tsx:2313-2350`) is a `role="tablist"` with two buttons that swap `background` and `color` with no indicator element, no transition, and no reduced-motion handling. It also sits inside the Activity card body, so it is invisible until the collapsed card is opened, and its buttons are about 1.75rem tall, under the 44px touch minimum.

There is a working sliding segmented control already in the repo: `.tt-seg` / `.tt-seg-ind` (`app/(dashboard)/app-shell.css:499-505`, consumed at `components/tahi/timer-chip.tsx:556-580`). It is hardcoded to three options (`width: calc((100% - 6px) / 3)` plus `[data-i="1"]` and `[data-i="2"]` rules), uses px units, and has no reduced-motion guard, so it needs generalising before reuse.

---

## 3. Liam's second report: clipped chips in the Details rail

The lead's diagnosis is right about the symptom. The precise mechanism is narrower than "the dd shrink-wraps".

`TRIGGER_STYLE` in `components/tahi/requests/inline-field.tsx:27-46` sets both:

```ts
margin: '-0.1875rem -0.3125rem',
padding: '0.1875rem 0.3125rem',
maxWidth: '100%',
```

and the trigger's children go into a clipping span at `inline-field.tsx:71`:

```tsx
<span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{children}</span>
```

`DetailRow` (`request-detail.tsx:2745-2757`) lays the row out as a flex line with a `flex-shrink-0` dt and a plain dd. The dd sizes itself to the button's **margin** box, which the negative horizontal margins make 0.625rem (10px) narrower than the button's border box. `maxWidth: '100%'` then resolves against that narrower dd and forces the button 10px below its own content width. The chevron is `flexShrink: 0`, so the inner span absorbs the whole 10px and clips the chip's right edge. This is a constant 10px loss that happens even when the rail has room to spare, which is why "Design" and "High" both lose the same sliver.

The prototype never clips. `.rqd-edit` (`requests-detail.css:32`) uses the same negative margin trick but sets no max-width and wraps nothing in an overflow-hidden span:

```css
.rqd-edit{ display:inline-flex; align-items:center; gap:7px; margin:-3px -5px; padding:3px 5px;
  border:none; background:none; border-radius:7px; font:inherit; color:inherit; text-align:right;
  cursor:pointer; transition:background .13s var(--ease); }
```

and its value cell is a plain right-aligned flex cell that can grow (`requests.css:312-315`):

```css
.req-detail-row{ display:flex; align-items:center; gap:10px; padding:7px 0; }
.req-detail-row .dr-k{ font:500 12.5px 'Manrope',sans-serif; color:var(--text-muted); flex-shrink:0; width:78px; }
.req-detail-row .dr-v{ margin-left:auto; font:600 12.5px 'Manrope',sans-serif; color:var(--text);
  display:flex; align-items:center; gap:7px; text-align:right; }
```

The prototype also explicitly forces `overflow: visible` on every detail container (`requests-detail.css:128-130`) so nothing clips a chip or a popover. Long values are handled by ellipsis on the specific text nodes that need it (`.rqd-call-title`, `.pr-name`, `.rqd-mi-title`), never on a wrapper that also holds chips.

The repo's Popover is portaled, so `SidebarCard`'s `overflow: hidden` is not implicated in the menu rendering. Only the chip clipping is in play.

---

## 4. Findings

Severity: P0 = Liam reported it. P1 = prototype behaviour lost or wrong. P2 = polish.

| ID | Sev | Prototype ref | Repo ref | What differs | Proposed fix |
|---|---|---|---|---|---|
| D1 | P0 | `requests.css:27-34`; used at `requests-toolbar.jsx:177-182` | `request-detail.tsx:2313-2350` | The All / Comments toggle swaps colours with no sliding indicator, sits inside the Activity card body so it is invisible until the card is expanded, and its buttons are about 1.75rem tall | Extract `components/tahi/segmented-control.tsx` from the `.tt-seg` pattern (`app-shell.css:499-505`), generalised to N options by measuring the active button's offset and width into an absolutely positioned indicator rather than the hardcoded `/3` and `[data-i]` rules. Rem units, tokens only, `transform` and `width` transitions at `360ms cubic-bezier(.22,1,.36,1)`, disabled under `@media (prefers-reduced-motion: reduce)`, `min-height: 2.75rem` under `md` and `2rem` above. Mount it in the Activity card header row on the right so it reads without expanding. Reuse the same primitive for the list page view switcher |
| D2 | P0 | `requests-detail.css:32`, `requests.css:312-315`, `requests-detail.css:128-130` | `inline-field.tsx:27-46` and `:71`; `request-detail.tsx:2745-2757` | Category and Priority chips clipped 10px on the right in every Details row, caused by `maxWidth: '100%'` resolving against a dd that the trigger's negative margins made 10px narrower | Two edits. In `DetailRow`, make the dd a growable right-aligned cell: `flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end;`. In `InlineTrigger`, change `maxWidth: '100%'` to `maxWidth: 'calc(100% + 0.625rem)'` so the negative margins cancel out. Keep the inner span's ellipsis so long assignee and phase names still truncate cleanly. Verify at 375px and at the `md` rail width of 16rem |
| D3 | P1 | `requests.css:239-252`; `requests-detail.jsx:320-336` | `components/tahi/requests/delivery-spine.tsx:56-190`; mounted at `request-detail.tsx:1064` | The spine is the legacy thin-bar progress strip with buttons bolted on and a hint line added. The prototype spine is a standalone bordered card above the two-column grid with 1.5rem circular nodes, a 2px connector track drawn behind them, a check glyph inside completed nodes, a brand ring on the current node, and labels under the nodes | Rebuild `DeliverySpine` as its own card sitting between the header card and the grid: border on all sides, `--shadow-xs`, header row with an uppercase "Delivery" label and the eta on the right, nodes at `1.5rem` with `border: 0.125rem solid`, the connector as a `::before` bar on each step except the first, `box-shadow: 0 0 0 0.25rem color-mix(in srgb, var(--color-brand) 16%, transparent)` on the current node. Keep the existing `interactive`, `busy`, `onPick` API, the hint line, and `aria-current="step"`. Labels stay `truncate` so 375px still fits five steps |
| D4 | P1 | `requests-detail.jsx:160` (chip), `:573-575` (switch and note line) | absent; the field exists only as a type at `request-detail.tsx:120` | Neither the Internal chip nor the Internal request switch was ported. Nothing on the page shows or sets whether a request is hidden from the client portal. This is a client-visibility control, so its absence is a boundary risk, not just a missing widget | Add an Internal chip to the header meta row beside the scope chip, using `--color-warning-bg` and `--color-warning` with a `Lock` glyph. Add a switch to the Actions card wired to the existing admin PUT, with the prototype's trailing note line that reads "Visible to {client} in their portal." or "Hidden from the client portal." Confirm the portal request payload already excludes internal requests before shipping the control |
| D5 | P1 | `requests.css:277-278` | `components/tahi/request-thread.tsx:104-112` | An internal note you wrote yourself renders in brand green like a client-visible reply. The class ternary tests `isOwn` first, so the internal tint only survives on other people's notes. The prototype declares `.req-msg.internal .req-msg-bubble` after `.req-msg.own` and adds an explicit `.req-msg.internal.own` radius rule, so the tint is intended to win on your own notes too | Reorder the ternary to test internal before own, and adjust the corner radius for the internal-and-own case as the prototype does. While in the file, replace `text-amber-600`, `bg-amber-50`, `border-amber-200`, `text-amber-900` with `--color-warning`, `--color-warning-bg` and `--color-border` so dark mode does not regress and the hardcoded-colour rule is respected |
| D6 | P1 | `requests-detail.jsx:462-487`; the proofing viewer block in `requests.css` | `request-detail.tsx:3214-3455` (`FilesPanel`) | No proofing viewer, no pinned comments on files, no comment count on file rows. The prototype opens image files into a modal with numbered pins on the canvas, a comment sidebar, an active-pin highlight, and an add-comment field with an Enter-to-pin hint. This is the largest single feature not carried over | Needs a schema addition (a file comments table with x and y percentages, author, resolved flag) plus an API and a worker MCP tool, so scope it as its own slice rather than folding it into a polish pass. The Slice 6 brief in the port plan never mentioned it, so it was dropped at planning time rather than during implementation |
| D7 | P1 | `requests-detail.jsx:172-177` | `request-detail.tsx:970-983` (chip only) | Scope flagging shows only as a small header chip. The prototype also renders a full warning card above the spine, for team audiences, with the heading "Scope flagged, check before continuing" and the flag reason underneath | Add the card above the spine when `isAdmin && request.scopeFlagged`, bordered on all sides with `--color-danger`, an alert glyph, the heading, and the stored reason with a fallback line. Keep the header chip as the at-a-glance signal |
| D8 | P2 | `requests.css:305` (`position: sticky; top: 0`) and `:519` (static on mobile) | `request-detail.tsx:1613`; no sticky anywhere in the file | The rail scrolls away on a long thread, so Time, Actions and Details are out of reach exactly when the thread is busiest | Add `position: sticky; top: 0` to the rail column at `md` and up, static below. Verify the sticky context is not broken by an ancestor `overflow` |
| D9 | P2 | `requests-detail.jsx:192-194` | `request-detail.tsx:1325-1570` | The brief sits below the thread and is titled "Description". The prototype leads with it so the reader knows what was asked before reading replies | Move the block above the thread and rename it "Brief". Low risk, purely a reorder in the `newUi` branch |
| D10 | P2 | `requests-detail.jsx:222-224` | `request-detail.tsx:1793-1815` | Details is last in the rail, after People and Checklists. The prototype puts Details above People above Checklist | Reorder to Details, People, Checklists. Keep Time and Actions first so the mobile stack still leads with what the studio touches most |
| D11 | P2 | `requests-detail.jsx:181-182` | absent | Draft and archived requests still render a five-step spine with no current step, which reads as broken rather than deliberate | When the status is off-pipeline, swap the spine for the prototype's single-line note card: "This request is a draft, not yet submitted." or "This request is archived." Use the existing `isPipelineStatus` helper already exported from `delivery-spine.tsx` |
| D12 | P2 | `requests-detail.jsx:170` | `request-detail.tsx:1035-1055` | The sub-meta row drops "Led by {assignee}", so the lead is only discoverable from the rail or the header stack | Add it for admin audiences after the due item, with the name in the emphasised weight the sibling items use |
| D13 | P2 | `requests-detail.jsx:28-35` (local `TimerGlyph`, with a comment explaining why) | `components/tahi/time-card.tsx:363` | The timer uses the Lucide `Pause` glyph, which the prototype deliberately replaced because two heavy closed bars read as a Stop button at 15px | Swap in the prototype's two-stroke glyph: `M9 5v14` and `M15 5v14` at `strokeWidth: 2`, with the solid triangle for play |

**Total findings: 13** (2 P0, 5 P1, 6 P2).

---

## 5. Nothing lost

These are present, and several are better than the prototype:

- **Header actions menu** (`components/tahi/requests/request-actions-menu.tsx`). All five actions with real endpoints, a searchable nest picker rendered as a second page inside the same popover, and confirm dialogs. The delete confirm copy is honest about the admin route being a soft delete, which the prototype's copy was not.
- **Composer** (`components/tahi/message-composer.tsx`). Richer than the prototype: Tiptap with a real mention extension, working attachments, and a public / internal control with per-option tooltips and the boundary hint line. The focus ring is on the container via `.tahi-focus-within`, as the prototype requires.
- **Revision chip** (`request-detail.tsx:2646-2712`). Replaces the prototype's fabricated round-by-round history with an accurate allowance and states plainly that history is not recorded yet, pointing at the thread instead.
- **Inline rail editors** (`components/tahi/requests/inline-field.tsx`). All three shapes present, portaled menus, read-only path renders no affordance at all, search on the assignee and phase pickers, 44px targets under `md`.
- **People panel** with PM locked and cross-role dedupe on the ported path, **Checklists** with add step, **Discovery calls**, **Sub-requests** with the ported empty message, **client review bar**, and the shared focus ring from commit 9fb8234.
- **Repo additions with no prototype equivalent**: the header people stack, the Tasks panel, the AI triage banner and the AI reply draft, all of which keep the human in the loop.

---

## 6. Open questions for the lead

1. **What should Comments filter?** Today it keeps activity rows whose text is "Posted a comment" with no body, which is close to useless. Options: merge thread messages into the feed with an excerpt, or make Comments scroll to the thread rather than filter the activity list. This changes what the D1 control is worth building.
2. **Ship the segmented control as a shared primitive now, or inline first?** Extracting it touches the list page view switcher. Inline is faster but guarantees a second implementation to reconcile later.
3. **Proofing viewer (D6): spec now or defer past the portal cutover?** It needs schema, an API, and a worker MCP tool, so it is a slice of its own.
4. **Is the thread-first block order (D9) a deliberate repo decision?** The code comment predates the port and the Slice 6 brief never covered block order.
