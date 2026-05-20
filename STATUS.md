# Tahi Dashboard — Live Status

> One-page snapshot of where the platform actually is. Update weekly.
> Last updated: **2026-05-21** by Liam

---

## Daily-trusted surfaces

Features the user actively runs their workday on. Regressions here are P0.

- **Sales pipeline** — deals, kanban, list, nudges, activity timeline, default owner
- **Finance reports** — P&L, cash flow forecast, bank balances, invoice aging, retainer health, MRR forecast, expense dashboard
- **Proposals / contracts / schedules / calculator** — built and premium, but not yet in the user's daily routine (closest to crossing the line)

## Built but not daily-trusted

Features that are coded and routed but haven't earned the user's trust as primary tools yet. Polish target.

- Tasks (three-level system, AI wizard — UX still rough)
- Requests (admin + portal — client privacy gaps, file upload / voice note bugs flagged in March QA)
- Messages / conversations
- Time tracking
- Settings (some toggles broken per March QA — needs re-verification)
- Reviews & case-study pipeline
- Announcements

## Stubs / not functional

- SSE notification stream (`/api/notifications/stream` is a stub — Phase 11 upgrades it)
- Web Push notifications (no service worker handler yet — Phase 11)
- Email-to-Request intake (not yet built — Phase 11)
- Xero payment webhook receiver (not yet built — Phase 11)

---

## Known live bugs (priority order)

Verified 2026-05-21 against current code. Pipeline polish backlog (5 items) all shipped — see `memory/project_pipeline_polish_2026_05.md`. March QA audit largely resolved — see `memory/project_qa_resolved_2026_05.md`.

1. **P1 — Voice note playback is fake.** `app/(dashboard)/messages/messages-content.tsx:95` `VoiceNotePlayer` animates a progress bar instead of decoding and playing the actual audio blob. Recording + R2 upload work; only playback is broken. Fix: swap the fake player for an `<audio>` element pointing at the R2 file URL.
2. **P2 — Needs live verification on production:**
   - R2 STORAGE binding (file upload end-to-end test on Webflow Cloud)
   - Settings page tabs (team / portal branding / modules — March audit said broken; code has no obvious stubs now)
   - Per-member docs access control (March feature request, status unknown)
3. **P3 — Stripe import**: duplicates `in_*` / `ch_*` rows for same payment (T665); pagination caps at 100 (T666)
4. **P3 — Bank balance card**: shows only cash balance; statement balance missing (T706)

---

## Current sprint (2026-05-21 → 2026-06-04)

1. ✅ Doc cleanup pass — STATUS.md, CLAUDE.md Definition of Done, roadmap memory rewrite, QA audit re-verification, pipeline polish memory archived
2. ✅ Pipeline polish backlog — all 5 items already shipped (verified 2026-05-21)
3. Live Chrome verification of pipeline polish items + voice note bug + R2 uploads (awaiting deployed URL)
4. Voice note player fix (P1 — swap fake player for `<audio>` element)
5. Phase 11 quick wins T660–T667 — 8 items
6. Schema migration S23–S25 (notificationPreferences + commentsLocked + xero_category_overrides + teamMembers.salaryAnnual). Note: `editedAt`/`deletedAt` on messages already exist.

Full plan: `C:\Users\Work\.claude\plans\i-d-like-you-to-gentle-neumann.md`

---

## Last shipped (last 10 commits, user-visible)

- `408b333` — Contract PDF: pill wraps label cleanly, redundant hex dropped
- `499f283` — Calc: tolerates old-shape scope on saved calculations
- `0952f83` — Calc overhaul, draft-from-calc, schedule gradient, desktop fade-in, sidebar cleanup
- `e013131` — Contracts/schedules: real PDF attachments, expanded schedule status
- `7527ac8` — Calculator MVP: capacity, benchmarks, retainer pacing
- `64d5225` — Emails: text-only Tahi Studio wordmark in header band
- `8c46bc2` — Emails: kill duplicate wordmark
- `eb00795` — Contracts/fully-signed: graceful fallback when PDF render fails
- `825330d` — Phase 7/contracts: auto-email signed PDF when fully signed
- `870f756` — Phase 7/schedule-templates: save-as-template + create-from-template

---

## Blocked on

- **KV namespace in Webflow Cloud** — proper rate limiter (T628 / T719) blocked; interim WAF rule available
- **Webflow Cloud deploys are slow** — tightens the live-QA loop; mitigated by the Definition of Done check (`CLAUDE.md`)
- **R2 STORAGE binding** in Webflow Cloud may need re-verification (March QA flagged file upload failures)

---

## Definition of Done (enforced)

Per `CLAUDE.md` Code Quality Rules. A task only flips to `[x]` once all seven steps pass — code quality + live browser verification + mobile + dark mode + commit note.

---

## Production-readiness exit criterion

Original plan said: all Phase 11 blocks closed + DoD enforced 4 weeks.

**Revised criterion (per user statement 2026-05-21):** the user trusts enough features to run their full workday inside the dashboard — not just pipeline + finance. Trust-crossover order in `memory/project_trust_state_2026_05.md`.
