# New request dialog: repo vs Claude Design prototype

**Date:** 2026-09-03
**Scope:** `components/tahi/new-request-dialog.tsx` (1613 lines) against `.claude/design-drafts/requests-final/requests-dialog.jsx` (304 lines), `requests-dialog.css` (79 lines) and the shared dialog classes in `requests.css` (lines 406 to 453, 546 to 616).
**Method:** read-only. No files edited, no git, no browser.
**Trigger:** Liam looked at the ported dialog as super admin and said "the new request in the repo is wrong", plus "make the repo align more with the claude design".

---

## 1. Section order comparison

### 1a. Team audience

| # | Prototype (`requests-dialog.jsx:207-284`) | Repo (`new-request-dialog.tsx:462-1106`) |
|---|---|---|
| 1 | Centred modal over a blurred backdrop. Head: "New request" / "Create work for a client" | Right-hand slide-over, `maxWidth: 32.5rem`. Head: "Create a request" / "Create a request on behalf of a client." |
| 2 | AI card: "Build with AI" / "Draft the title and brief from a few answers." | AI card, but only when `isSuperAdmin` |
| 3 | Client select (`req-select`) | Sub-request note banner (when `parentRequestId` set) |
| 4 | Category: "What kind of work?" as a 6-tile icon grid, 3 columns | Client select (`SearchableSelect`) |
| 5 | Title: "Title" | Brand select (`SearchableSelect`), when the client has brands |
| 6 | Brief: "Brief" plus AI-draft chip, rich text editor with bold, italic, bullets, link | Title: "Request title" |
| 7 | Size: sliding segmented control, then hint line "Suggested: X, based on the brief.", then an info note when the plan has no large track | Flow indicator banner: "Retainer client (scale) - select task size below" |
| 8 | Row: Priority select (urgent, high, medium, low) beside "Ideal due date" with an info tooltip | Task size: two large bordered tiles with lock icons, only when the client is on maintain or scale, then the hint line |
| 9 | Footer: note "Lands in Triage", Cancel, Create request | Row: Category select beside Priority as two buttons (Standard, High) |
| 10 | Done view: "Request created" / "Request #num landed in Triage. Assign it and it starts moving." | Row: Start date, Due date, Est. hours |
| 11 | | Description: plain textarea plus "You can add files, images, and voice notes after submitting." |
| 12 | | Success block, error block |
| 13 | | Footer: Cancel, Save + another, Create request. No done view; on success it navigates to `/requests/[id]` |

### 1b. Client audience

| # | Prototype (`requests-dialog.jsx:207-284`) | Repo, real client (`isSuperAdmin` false) | Repo, super admin viewing as client |
|---|---|---|---|
| 1 | Head: "New request" / "Tell us what you need, takes a minute" | Head: "Submit a request" / "Tell us what you need and we'll get started." | same |
| 2 | AI card: "Not sure how to word it? I'll ask a few questions." | absent | AI card present |
| 3 | Category tile grid | Title | Title |
| 4 | Title: "Give it a short title" | Task size: two tiles (always shown, `showTrackSelector` is true for portal) | Size: suggestion chip plus quiet Change link |
| 5 | Brief: "Tell us more", rich text | Category select | Category select |
| 6 | Size: suggestion chip, helper line, Change link. When the plan has no large track: a flat "1 day or less" chip plus "Your plan runs a single-day track." | Due date (optional) | Placement: three option cards |
| 7 | Placement: "When would you like it?", three cards (Add to my queue, Bump to the top, Replace what is in progress) | Description textarea | Due date (optional) |
| 8 | "Ideal due date" with info tooltip | Intake form questions when a form resolves | Description textarea, then intake questions |
| 9 | Footer: note "We'll confirm where it sits in your queue", Cancel, Submit request | Footer: Cancel, Save + another, Submit request | same footer |
| 10 | Done view: "Your request is in", request number, queue position card | No done view; navigates to the request | Done view present (`RequestConfirmation`) |

### 1c. AI question flow

| | Prototype (`requests-dialog.jsx:65-126`, `AI_FLOW` and `AiAssist`) | Repo (`ai-request-wizard.tsx`) |
|---|---|---|
| Entry | `setView('ai')` swaps the dialog body in place, same shell, head gains a "Write it myself" button | `setAiOpen(true)` returns a completely different component, a `SlideOver` |
| Script | Per-category opener plus 1 to 3 scripted follow-ups, keyed on the category already chosen in the form | One generic opener, free-form conversation, category inferred by the model |
| Progress | "AI assist" label, progress bar, "2 / 3" counter | none |
| Typing | Typing dots with a 520ms to 640ms delay before each reply | `Loader2` spinner |
| Optional questions | Questions matching /optional|skip/ show a "Skip" chip in place of send | none |
| Output | `buildDraft` composes a title plus a labelled rich-text brief, then hands back to the form and toasts "Draft ready, review below" | `onDraftToForm` exists and the dialog wires it, but the wizard's primary action is still Create; Review in form is secondary |

---

## 2. Findings

18 findings. Severity: P0 = clearly what Liam means by "wrong", P1 = prototype behaviour lost, P2 = polish.

| ID | Sev | Prototype ref | Repo ref | What differs | Proposed fix |
|---|---|---|---|---|---|
| D1 | P0 | `requests-dialog.jsx:129-284` | `new-request-dialog.tsx:293` | `const clientSuggestion = !isAdmin && isSuperAdmin`. Every ported piece except the AI card is gated on super admin **and** the client audience. Consequences: the size suggestion (`:662`), the placement cards (`:862`), the placement field on the POST body (`:356`) and the confirmation screen (`:385`) are all invisible to the team audience. Liam opening it as super admin on `/requests` is on the team path, so he sees the legacy form with one new card on top. Real clients see none of the port either. | Split the two concerns. Audience (`isAdmin`) decides the shape: team gets the segmented size control plus hint line plus priority; client gets the suggestion chip plus placement plus confirmation. `isSuperAdmin` only decides rollout, if a gate is still wanted at all (see open question 2). |
| D2 | P0 | `requests.css:407-409` | `new-request-dialog.tsx:465-492` | Container is a hand-rolled right slide-over at `maxWidth: 32.5rem` with no entry motion and a `rgba(0,0,0,0.4)` backdrop. Prototype is a centred modal, `width: min(38.75rem, 100%)`, 1.125rem radius, `backdrop-filter: blur(3px)`, and a 240ms scale-and-rise entry. | Build a centred modal variant. Either extend `components/tahi/slide-over.tsx` with `variant="center"` or add a small `Modal` beside it. Width `min(38.75rem, 100%)`, `var(--radius-xl)`, `var(--shadow-lg)`, body capped at `60vh` with its own scroll, entry `var(--motion-base) var(--ease-out)`, and a `prefers-reduced-motion` opt-out. Backdrop `var(--color-text)` at low alpha rather than raw black. |
| D3 | P0 | no counterpart in the prototype | `:603-626` (Brand), `:642-659` (flow banner), `:840-857` (Start date, Est. hours), `:1041-1074` (Save + another), `:908-967` (intake questions), `:166` and `:252` (`isInternal`) | Six legacy blocks survive that the prototype does not have. The flow indicator ("Retainer client (scale) - select task size below") is the loudest: it duplicates what the size control and the hint line already say. Start date and Est. hours are planning fields, not intake fields. `Save + another` is shown to clients as well as team. `isInternal` is dead state, always false. | Move Brand, Start date and Est. hours to the request detail rail, which already edits them inline after Slice 6. Delete the flow banner, the hint line carries that information. Hide `Save + another` from the client audience. Delete the `isInternal` state. Keep intake questions but only render them when a form actually resolves, and consider folding them into the AI interview (open question 4). |
| D4 | P0 | `requests-dialog.jsx:223-228`, `requests.css:427-432` | `:783-789` | Category is a native `<select>` inside a two-up row. The prototype makes it the first field after the AI card, as a 3-column grid of tiles, each with a coloured icon tile and a label, 2 columns at 375px. | Rebuild as a tile grid. The colour tokens already exist: `--cat-design-bg`, `--cat-design-text` and siblings at `app/globals.css:249-265`. Use `role="radiogroup"` with `role="radio"` buttons, minimum 2.75rem tile height, all-sides border, hover and focus-visible states. |
| D5 | P0 | `requests-dialog.jsx:48-55`, `requests.css:561-566` | `:672-761` | Size is two large tiles with 2px borders, a lock icon, a check badge and a hint sentence each, roughly 90px tall. The prototype is a compact sliding segmented control: a track, a pill that slides on a 340ms `cubic-bezier(.22,1,.36,1)`, disabled key with a tooltip when the plan has no large track. | Reuse the pattern already in the repo: `.tt-seg` / `.tt-seg-ind` / `.tt-seg-b` at `app/(dashboard)/app-shell.css:499-505`, driven by a `data-i` index, consumed at `components/tahi/timer-chip.tsx:563-578`. Generalise it to N options with a `--i` custom property so it is not hardcoded to three, add a `disabledKeys` prop, and honour `prefers-reduced-motion`. |
| D6 | P0 | `requests-dialog.jsx:27-45`, `requests.css:546-558` | `:894-905` | The brief is a plain `<textarea>`. The prototype is a rich text editor with a toolbar: bold, italic, divider, bulleted list, add link, active states on the tool buttons, ring on `:focus-within`, min 96px and max 240px height. | The repo already runs Tiptap in `components/tahi/composer.tsx` (StarterKit, Link, Placeholder). Extract a small `RichBrief` with only bold, italic, bullet list and link, and store HTML in `description`. `lib/request-size-suggestion.ts:60-68` already strips HTML before counting words, so the suggestion keeps working. |
| D7 | P0 | `requests-dialog.jsx:265-266`, `requests-data.jsx:33-40` | `:791-829` | Team priority is two buttons, Standard and High. The prototype offers four: urgent, high, medium, low, as a select. `db/schema.ts:431` defaults `priority` to `'standard'`, so the two vocabularies do not even overlap. | Resolve the vocabulary first (open question 1), then match. If the prototype set wins, this needs a data migration and a sweep of `Badge` and filter code, so it is the one P0 that is not a pure UI change. |
| D8 | P1 | `requests-dialog.jsx:230-236` | `:894` | The brief sits third from the top in the prototype, directly under the title, because it is the thing the person came to write. In the repo it is last, below the size tiles, the category row, the three date fields and above only the intake questions. | Reorder the body to: AI card, client (team only), category, title, brief, size, priority or placement, ideal due date. |
| D9 | P1 | `requests-dialog.jsx:282`, `requests.css:437` | `:1009-1039` | The footer note is missing. The prototype anchors the footer with an icon plus a line: "Lands in Triage" for team, "We'll confirm where it sits in your queue" for clients. The repo footer is Cancel on the left and two buttons on the right, with nothing in between. | Add the note as the first footer child, `var(--color-text-muted)`, 0.75rem, with a 14px `Inbox` or `Sparkles` icon, and let the buttons sit right with `margin-left: auto`. |
| D10 | P1 | `requests-dialog.jsx:268-269`, `:279`, `requests.css:568-574` | `:845-847`, `:882-891` | The label reads "Due date" for team and "Due date (optional)" for clients, with no explanation. The prototype calls it "Ideal due date" for both audiences and attaches an info tooltip: it is a target, not a guarantee, and the real delivery date gets confirmed. | Rename both, and attach `components/tahi/tooltip.tsx` to a focusable info trigger beside the label so the copy is reachable by keyboard, not hover only. |
| D11 | P1 | `requests-dialog.jsx:154` | `:1043`, `:1078` | The prototype blocks submit for clients until the brief has plain text: `canSubmit = title.trim() && (!client || plainText(brief).length > 0)`. The repo only checks `title.trim()`, so a client can file an empty request. | Add the brief check to the disabled condition on the client path, and surface why on the disabled button via `title` or an inline hint. |
| D12 | P1 | `requests-dialog.jsx:169-185` | `:385-395`, `:407-413` | The team gets no confirmation at all. On success the dialog closes and `router.push` lands on the request. The prototype shows the same done view to both audiences, with team copy: "Request created" and "Request #num landed in Triage. Assign it and it starts moving." | Render the confirmation for both audiences. Team variant: the triage line, plus a primary "Go to request" that does the `router.push`, and a secondary Done that just closes. |
| D13 | P1 | `requests.css:407` (modal semantics) | whole file, no `Escape` or `keydown` handler, no `useRef`, no `autoFocus`, no body scroll lock | The dialog is `role="dialog" aria-modal="true"` but Escape does not close it, focus is not trapped, focus is not moved into the panel on open, focus is not returned to the trigger on close, and the page behind stays scrollable. `components/tahi/slide-over.tsx:30-36` documents all four behaviours as already baked in. | Move onto the shared primitive rather than reimplementing. If the centred variant from D2 lands in `slide-over.tsx`, this fixes itself. Otherwise port the four behaviours explicitly. |
| D14 | P1 | `requests-dialog.jsx:235`, `requests.css:584` | `:894` | The "AI draft" chip beside the Brief label is missing, so a brief the AI wrote is indistinguishable from one the person typed. `aiDrafted` is tracked at `:178` and used only for the size chip label. | Render a small uppercase chip next to the brief label when `aiDrafted` is true: `var(--color-brand-100)` background, `var(--color-brand-dark)` text, `var(--radius-badge)`, with a 10px sparkle icon. |
| D15 | P1 | `requests-dialog.jsx:65-126` | `:425-450`, `ai-request-wizard.tsx` | The AI flow is structurally different: a different component in a different container, no progress bar, no typing indicator, no Skip on optional questions, no per-category opener, and no "Write it myself" escape in the header. The hand-back exists (`onDraftToForm` at `ai-request-wizard.tsx:55`, wired at `new-request-dialog.tsx:436-447`) but is the secondary action. | Keep the live model-backed wizard, it is better than the scripted one. Add the prototype's furniture: render it inside the same dialog shell rather than a separate slide-over, add the progress line and typing indicator, seed the opener from the category already selected in the form, and make hand-back-to-form the primary action so the person always reviews before submitting. |
| D16 | P2 | `requests-dialog.jsx:208` | `:505-512` | Header copy differs on both audiences. Prototype: "New request" for both, with "Create work for a client" and "Tell us what you need, takes a minute". Repo: "Create a request" / "Submit a request" with different sub-lines. | Match the prototype strings. |
| D17 | P2 | `requests-dialog.jsx:141`, `:269`, `:297` | `:168`, `:846`, `:886` | The prototype defaults the due date to today plus seven days and sets `min` to tomorrow. The repo leaves it empty with no floor, so a past date is selectable. | Default to today plus seven, set `min` to tomorrow, both audiences. |
| D18 | P2 | `requests.css:445-453`, `requests-dialog.jsx:182` | `:1372-1460` | Confirmation differences: the prototype centres the content and uses a 60px circular icon; the repo left-aligns inside a slide-over with a leaf-radius square. The plan sentence also differs. Prototype: "Your X plan builds one request at a time". Repo: "Your X plan pulls the next one in as a track frees up." | Centre the confirmation content and settle the plan sentence. The repo wording may be the more accurate one for multi-track plans, so this is a copy decision, not a straight revert. |

---

## 3. What "wrong" most likely means

Liam opened the dialog as super admin, which puts him on the **team** audience, and the gate at `new-request-dialog.tsx:293` switches off the size suggestion, the placement cards and the confirmation screen for exactly that path. What he actually saw was the pre-existing slide-over: a Brand picker, a flow-indicator banner repeating what the size control says, three date and hours fields, a category dropdown, a two-button priority, a plain textarea, and a "Save + another" button, with a single new AI card bolted to the top. None of those seven things appear anywhere in the prototype. Slice 7 of the plan scoped the work as four additive edits to the existing dialog rather than a rebuild, which is why the legacy form survived intact; that scoping is the root cause, not a mistake in the implementation of the four edits themselves. The four ported pieces are individually faithful. The container, the field set and the field order are not.

---

## 4. Smallest change set that makes it read as the prototype

In dependency order. Items 1 to 5 are the ones that change what Liam sees on first open.

1. **Run the audience off `isAdmin` alone** (D1). One-line change plus removing `isSuperAdmin` from three conditions. Biggest visible effect for the least code.
2. **Centred modal container** (D2, and D13 comes free if it goes through `slide-over.tsx`).
3. **Reorder and strip the body** (D3, D8): AI card, client, category, title, brief, size, priority or placement, ideal due date. Brand, Start date and Est. hours move to the detail rail. Flow banner and `isInternal` deleted.
4. **Category tile grid** (D4) using the existing `--cat-*` tokens.
5. **Sliding segmented size control** (D5) generalising the existing `.tt-seg` pattern.
6. **Rich text brief** (D6) from the Tiptap setup in `composer.tsx`.
7. Footer note, ideal due date label plus tooltip, AI draft chip, client brief validation, team confirmation (D9, D10, D11, D12, D14).

Items 1 to 6 are all inside `new-request-dialog.tsx` plus one shared primitive, so they can ship as a single slice. D7 (priority vocabulary) should be split out because it touches the database. D15 (AI flow) is its own slice.

Constraints that apply throughout: rem units, CSS variables from `app/globals.css` only, no hardcoded hex, borders on all sides or none, 2.75rem minimum touch targets, hover and `:focus-visible` on every control, no em or en dashes in any string.

---

## 5. Open questions for the lead

1. **Priority vocabulary.** The prototype offers urgent, high, medium and low. `db/schema.ts:431` defaults to `'standard'` and the dialog only exposes Standard and High. Which set is real? If the prototype set wins it needs a migration plus a sweep of every badge and filter that reads `priority`.
2. **Is the super-admin gate still wanted?** The comment at `:132-137` says it exists "while it beds in". Liam has now seen it. Ship the whole dialog to the team and to real clients at once, or keep the gate and just fix the audience split?
3. **Sub-request mode** (`parentRequestId`) has no prototype counterpart and currently suppresses the AI card and forces the client. Keep it inside this dialog, or split it into its own smaller surface so the main dialog can match the prototype exactly?
4. **Intake forms** are a shipped feature with no prototype counterpart. Keep them as a block below the brief, or fold their questions into the AI interview so there is one way to answer questions?
5. **Confirmation plan sentence** (D18). The prototype says "builds one request at a time", the repo says "pulls the next one in as a track frees up". Which is true for a Scale client with two tracks?

---

## Files read

- `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final\requests-dialog.jsx`
- `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final\requests-dialog.css`
- `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final\requests.css`
- `C:\Users\Work\Projects\tahi-dashboard\.claude\design-drafts\requests-final\requests-data.jsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\new-request-dialog.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\ai-request-wizard.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\slide-over.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\confirm-dialog.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\composer.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\components\tahi\timer-chip.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\lib\request-size-suggestion.ts`
- `C:\Users\Work\Projects\tahi-dashboard\app\globals.css`
- `C:\Users\Work\Projects\tahi-dashboard\app\(dashboard)\app-shell.css`
- `C:\Users\Work\Projects\tahi-dashboard\app\(dashboard)\requests\request-list.tsx`
- `C:\Users\Work\Projects\tahi-dashboard\app\api\portal\requests\route.ts`
- `C:\Users\Work\Projects\tahi-dashboard\docs\superpowers\plans\2026-09-02-requests-tsx-port.md`
