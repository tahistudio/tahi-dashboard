# Client data hygiene audit (7 Sep 2026, production D1, read-only)

Scope: the 39 non-archived organisations plus the archived rows that are merge targets. Method: SELECT statements only, run through `npx wrangler d1 execute tahi-db --remote --json`, tabulated with Python; nothing was written, no email, invite or notification path was touched, no browser. Companion file with every row: `docs/superpowers/audits/2026-09-07-client-data-hygiene.json`. Raw query results are kept outside the repo (`%TEMP%\hygiene\*.json`, 83 result sets).

Headline counts at the time of the run: organisations 58, contacts 78, requests 333, messages 577, invoices 137. Organisations by status: 39 non-archived (active, churned, prospect, internal) and 19 archived.

Rules applied: the memory rule that pipeline (leads, deals, activities, discovery_calls), clients, contacts, invoices and finance are always real, while tasks, requests without a ManyRequests key, messages, time and calls are demo; the import report's Phase C list (merge, never delete, anything holding an invoice or an external id); and the founder's own test for plans (REAL = subscription with invoices, ManyRequests subscription, Giant Group's scale retainer, or the Tahi Test Client QA org; TEST = prospect with no invoice, or plan_type with no subscription and no retainer billing).

No migration is needed for any item below (data only); the next free migration number is still 0098.

## What the audit found, in one screen

- 11 duplicate contact pairs (22 rows), every one created by the same two-step pattern (primary admin row, then a member row with a job title 6 to 17 seconds later). Only 3 of the 22 rows are referenced anywhere: Charles Bilash's member row carries 4 imported requests and 1 deal contact, and the Happy Monday and SafeRec member rows carry 1 deal contact each. All references re-point cleanly.
- 8 organisations carry plan_type 'launch' or 'scale' with no subscription or with a subscription that has never been invoiced: Alumni Capital, Assertio, Avery Cox, Emusio, IKON VAULT, ProfitableLO, Tara Winery (both rows) on 'launch'; ISO Certification Experts and Tevalis on 'scale' with an empty subscription and two empty tracks each, both created in the same millisecond as the organisation (the new-client dialog's signature).
- 6 orphan tracks whose subscription no longer exists, and the archived seed org Acme Corp still holding a seed subscription and two tracks.
- Acme Widgets Test is a Stripe TEST-MODE customer: three of its six invoices store a hosted-invoice URL on Stripe's `/test_` path, the line item is '1 x Tahi Scale (at 3,029.00 / month)', and it was auto-created by the Stripe importer on 5 Sep. 'test manual' (archived) is the same. No other organisation carries a test-mode URL. The importer has no livemode guard.
- Tara Winery: the 'active' row is an empty shell (zero rows in every child table); the 'prospect' row holds the contacts and the kanban columns. Proposed direction reverses the import report's guess.
- Tevalis: the archived duplicate holds the LATER deal (Closed Lost 27 May with the reopened notes) and 7 activities; merge them into the surviving prospect, do not delete them.
- Leftover test artefacts on real or internal organisations: 4 demo tasks (one on Stride), 2 orphan subtasks, 2 blockers (one blocks a real Stride request by a deleted test request), 3 timer smoke entries on the internal org, 8 test conversations with 9 participants (5 pointing at deleted requests, one on Physitrack), 4 notifications about deleted 'retret' requests, and 1 file row keyed by a Clerk org id.
- Clean: zero contacts without an organisation, zero invoices without an organisation, zero request_participants, zero messages outside the import, zero scheduled calls, zero active timers, no example.com contacts on any non-archived organisation, no test-named leads or deals (the single 'Attest' hit is a real company name).

## 1. Duplicate contacts (same organisation, same email, case-insensitive)

Query: self-join of `contacts` on `org_id` and `lower(trim(email))`. Result: 22 rows in 11 pairs. `clerk_user_id` is NULL on all 22 rows (no one has ever logged in as any of them). Reference scan: each of the 22 ids was counted in 31 columns (subscriptions.billed_contact_id, requests.submitted_by_id, request_participants.participant_id, request_participants.added_by_id, conversation_participants.participant_id, conversations.created_by_id, messages.author_id, message_reactions.user_id, files.uploaded_by_id, tasks.assignee_id, tasks.created_by_id, request_steps.created_by_id, request_reads.user_id, active_timers.user_id, work_blockers.created_by_id, mentions.mentioned_id, mentions.mentioned_by_id, notifications.user_id, notification_preferences.user_id, doc_pages.author_id, audit_log.actor_id, deal_contacts.contact_id, activities.contact_id, brand_contacts.contact_id, deals.owner_id, leads.owner_id, onboarding_invites.used_by_user_id, announcement_dismissals.user_id, time_entries.team_member_id, scheduled_calls.attendees, people.id); columns that do not exist in production and were skipped: contract_signers.contact_id, email_suppressions.contact_id, proposals.contact_id, invoices.contact_id. scheduled_calls.attendees was searched as JSON text.

Survivor rule used: keep the `is_primary = 1` / `portal_role = 'admin'` row, which is the older row in every pair; copy the member row's `role` (job title) onto it; re-point any reference; delete the member row. This keeps the one-primary-per-org and admin-owner invariants the portal relies on (the People tab, brands and invites all require an admin contact).

| Organisation | Email | Survivor (keep) | Delete | Refs on survivor | Refs on delete row | clerk_user_id |
|---|---|---|---|---|---|---|
| Alumni Capital | team@alumnicapital.com | d1de0979-1d35-4630-a70b-32493ade3dda (primary=1, admin, role=null, created 2026-04-30T00:15:23, MR id null) | 97ec2d80-befd-41ca-8e77-a3216edd5f84 (primary=0, member, role=Executive Assistant, created 2026-04-30T00:15:31) | 0 | 0 | null |
| Assertio | bharat@assertio.co.nz | 1b573c9f-617f-4577-b21b-7ddedfa9619f (primary=1, admin, role=null, created 2026-04-24T09:09:31, MR id null) | 0aee6c97-8886-4f84-89fb-524fdfc9fb1e (primary=0, member, role=Director, created 2026-04-24T09:09:41) | 0 | 0 | null |
| Avery Cox (Tattoo Expo Platform) | coxavery63@gmail.com | c3492efc-c59d-4915-8c34-3bd8b835a580 (primary=1, admin, role=null, created 2026-04-29T07:53:05, MR id null) | 381acce5-4808-4567-a93c-a79cdcfb6917 (primary=0, member, role=Founder, created 2026-04-29T07:53:12) | 0 | 0 | null |
| Charles Bilash | charles@charlesbilash.com | 5d98f8a1-6bfc-48a7-af28-17b93ca53efc (primary=1, admin, role=null, created 2026-06-12T03:28:49, MR id 88) | 9cb67733-9785-4054-b7cc-4ffd6853ee8f (primary=0, member, role=Owner and decision-maker, created 2026-06-12T03:28:55) | 0 | requests.submitted_by_id=4, deal_contacts.contact_id=1 | null |
| Happy Monday | anj@happymonday.co.nz | d7e3e4c9-30ea-4af0-af67-400469ef6047 (primary=1, admin, role=null, created 2026-06-12T02:51:06, MR id null) | 558e914c-7bfc-4d94-87c6-994b30be099b (primary=0, member, role=Primary contact, created 2026-06-12T02:51:11) | 0 | deal_contacts.contact_id=1 | null |
| IKON VAULT | samdeluca@theikonvault.com | e9d9c826-cf1e-48e8-b83f-ac2fb0b297a0 (primary=1, admin, role=null, created 2026-04-22T00:02:23, MR id null) | 5ad1bf53-ad4c-467c-b4d4-128b2b99607e (primary=0, member, role=Founder, created 2026-04-22T00:02:42) | 0 | 0 | null |
| ProfitableLO | hello@profitablelo.com | 88ee1ab2-7132-40e7-a6ff-a9310a23e0b5 (primary=1, admin, role=null, created 2026-04-24T06:03:35, MR id null) | 2aec3d9a-b86f-49c1-a2f3-0952740c525e (primary=0, member, role=Cofounder, created 2026-04-24T06:03:42) | 0 | 0 | null |
| SafeRec | holly.spiers@saferec.co.uk | 556da0fa-6f35-4cd7-a92c-3a31742a5aee (primary=1, admin, role=null, created 2026-06-14T23:37:49, MR id null) | 6fde276c-9ea1-4d3c-b65a-e20b43450148 (primary=0, member, role=Director of Marketing, created 2026-06-14T23:37:55) | 0 | deal_contacts.contact_id=1 | null |
| Tara Winery | tarawinery@gmail.com | 007cc919-0e57-41e0-b87c-b768467750b0 (primary=1, admin, role=null, created 2026-04-29T07:52:16, MR id null) | f8b95372-6e5c-4eb4-9fcd-a3f402f3bf94 (primary=0, member, role=Owner, created 2026-04-29T07:52:32) | 0 | 0 | null |
| Tevalis (archived org) | j.degoey@tevalis.com | 2da9aaa2-7625-4941-bf44-3df28f404c73 (primary=1, admin, role=null, created 2026-05-12T08:53:41, MR id null) | 95c3ffb0-b7f4-488f-b0e3-cc97d5ad547d (primary=0, member, role=Director of Marketing, created 2026-05-12T08:54:48) | 0 | 0 | null |
| Tevalis | j.degoey@tevalis.com | 1ff778bc-8721-4811-9d38-eff00b1fd27e (primary=1, admin, role=null, created 2026-05-12T08:58:08, MR id null) | ec7ea572-eccb-464a-956a-a66862c9ed4c (primary=0, member, role=Director of Marketing (current decision-maker, joined May 2026), created 2026-05-12T08:58:16) | 0 | 0 | null |

Per-pair steps (P01 to P04 in the proposal list):

- Alumni Capital / team@alumnicapital.com:
  - `UPDATE contacts SET role = 'Executive Assistant' WHERE id = 'd1de0979-1d35-4630-a70b-32493ade3dda'`
  - `DELETE FROM contacts WHERE id = '97ec2d80-befd-41ca-8e77-a3216edd5f84'`
- Assertio / bharat@assertio.co.nz:
  - `UPDATE contacts SET role = 'Director' WHERE id = '1b573c9f-617f-4577-b21b-7ddedfa9619f'`
  - `DELETE FROM contacts WHERE id = '0aee6c97-8886-4f84-89fb-524fdfc9fb1e'`
- Avery Cox (Tattoo Expo Platform) / coxavery63@gmail.com:
  - `UPDATE contacts SET role = 'Founder' WHERE id = 'c3492efc-c59d-4915-8c34-3bd8b835a580'`
  - `DELETE FROM contacts WHERE id = '381acce5-4808-4567-a93c-a79cdcfb6917'`
- Charles Bilash / charles@charlesbilash.com:
  - `UPDATE contacts SET role = 'Owner and decision-maker' WHERE id = '5d98f8a1-6bfc-48a7-af28-17b93ca53efc'`
  - `UPDATE requests SET submitted_by_id = '5d98f8a1-6bfc-48a7-af28-17b93ca53efc' WHERE submitted_by_id = '9cb67733-9785-4054-b7cc-4ffd6853ee8f'  (4 rows)`
  - `UPDATE deal_contacts SET contact_id = '5d98f8a1-6bfc-48a7-af28-17b93ca53efc' WHERE contact_id = '9cb67733-9785-4054-b7cc-4ffd6853ee8f'  (1 row)`
  - `DELETE FROM contacts WHERE id = '9cb67733-9785-4054-b7cc-4ffd6853ee8f'`
- Happy Monday / anj@happymonday.co.nz:
  - `UPDATE contacts SET role = 'Primary contact' WHERE id = 'd7e3e4c9-30ea-4af0-af67-400469ef6047'`
  - `UPDATE deal_contacts SET contact_id = 'd7e3e4c9-30ea-4af0-af67-400469ef6047' WHERE contact_id = '558e914c-7bfc-4d94-87c6-994b30be099b'  (1 row)`
  - `DELETE FROM contacts WHERE id = '558e914c-7bfc-4d94-87c6-994b30be099b'`
- IKON VAULT / samdeluca@theikonvault.com:
  - `UPDATE contacts SET role = 'Founder' WHERE id = 'e9d9c826-cf1e-48e8-b83f-ac2fb0b297a0'`
  - `DELETE FROM contacts WHERE id = '5ad1bf53-ad4c-467c-b4d4-128b2b99607e'`
- ProfitableLO / hello@profitablelo.com:
  - `UPDATE contacts SET role = 'Cofounder' WHERE id = '88ee1ab2-7132-40e7-a6ff-a9310a23e0b5'`
  - `DELETE FROM contacts WHERE id = '2aec3d9a-b86f-49c1-a2f3-0952740c525e'`
- SafeRec / holly.spiers@saferec.co.uk:
  - `UPDATE contacts SET role = 'Director of Marketing' WHERE id = '556da0fa-6f35-4cd7-a92c-3a31742a5aee'`
  - `UPDATE deal_contacts SET contact_id = '556da0fa-6f35-4cd7-a92c-3a31742a5aee' WHERE contact_id = '6fde276c-9ea1-4d3c-b65a-e20b43450148'  (1 row)`
  - `DELETE FROM contacts WHERE id = '6fde276c-9ea1-4d3c-b65a-e20b43450148'`
- Tara Winery / tarawinery@gmail.com:
  - `UPDATE contacts SET role = 'Owner' WHERE id = '007cc919-0e57-41e0-b87c-b768467750b0'`
  - `DELETE FROM contacts WHERE id = 'f8b95372-6e5c-4eb4-9fcd-a3f402f3bf94'`
- Tevalis (archived org, see P15) / j.degoey@tevalis.com:
  - `UPDATE contacts SET role = 'Director of Marketing' WHERE id = '2da9aaa2-7625-4941-bf44-3df28f404c73'`
  - `DELETE FROM contacts WHERE id = '95c3ffb0-b7f4-488f-b0e3-cc97d5ad547d'`
- Tevalis / j.degoey@tevalis.com:
  - `UPDATE contacts SET role = 'Director of Marketing (current decision-maker, joined May 2026)' WHERE id = '1ff778bc-8721-4811-9d38-eff00b1fd27e'`
  - `DELETE FROM contacts WHERE id = 'ec7ea572-eccb-464a-956a-a66862c9ed4c'`

Charles Bilash detail: the survivor 5d98f8a1 already carries `manyrequests_id` 88 (unique index, the import's idempotency key), and the member row 9cb67733 is the `submitted_by_id` on the four imported requests below, so the re-point goes towards the stamped row.

| Request id | Title | Status | ManyRequests id | submitted_by_id |
|---|---|---|---|---|
| 3a61f5dc-b745-4d1b-b864-4837ac53f08c | Sitemap | delivered | 315 | 9cb67733-9785-4054-b7cc-4ffd6853ee8f |
| f858fc01-4f04-47d2-a833-a06634f37d0c | Moodboards | delivered | 316 | 9cb67733-9785-4054-b7cc-4ffd6853ee8f |
| 0c1340bb-d68f-473f-8520-ef88ba760b53 | Design directions | in_progress | 317 | 9cb67733-9785-4054-b7cc-4ffd6853ee8f |
| e561a88a-7a55-4d7c-b366-451d68fbe627 | Wireframes | in_progress | 318 | 9cb67733-9785-4054-b7cc-4ffd6853ee8f |

| deal_contacts id | Deal | contact_id | Role on deal |
|---|---|---|---|
| 666a89c9-2ad9-465d-a883-3df0ced13037 | Happy Monday intro | 558e914c-7bfc-4d94-87c6-994b30be099b | Primary contact |
| e6d6ad6e-053c-4c54-a15a-3ea0f150a4a1 | Charles Bilash - Costa Rica Luxury Real Estate Platform | 9cb67733-9785-4054-b7cc-4ffd6853ee8f | Decision-maker |
| a9851a52-04c0-499a-8a62-57c3b2f757aa | SafeRec intro | 6fde276c-9ea1-4d3c-b65a-e20b43450148 | Primary contact |

Cross-organisation duplicates (same email on two organisations): only `j.degoey@tevalis.com`, four rows across the two Tevalis organisations (handled by P04 and P15). No other email appears on more than one organisation.

## 2. Plans and subscriptions on the 39 non-archived organisations

Every non-archived organisation with `plan_type` other than none/NULL, or with at least one `subscriptions` row. MR = the subscription carries a ManyRequests id. 'reqs_on_tracks' counts requests whose track_id belongs to that subscription (all zero everywhere).

| Organisation | Status | plan_type | billing_model | custom_mrr | Subscriptions | Invoices | Xero | Stripe | MR org | Deals | Verdict | Action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alumni Capital | active | launch | none |  | 0 | 0 |  |  |  | 0 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Assertio | active | launch | project |  | 0 | 8 | Xero |  |  | 4 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Avery Cox (Tattoo Expo Platform) | active | launch | none |  | 0 | 0 |  |  |  | 0 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| DANTE MEDIA OÜ | active | none | none |  | bf83136a hourly/cancelled MR tracks=0 reqs_on_tracks=0; b73f10a6 hourly/cancelled MR tracks=0 reqs_on_tracks=0; 2bb14905 hourly/active MR tracks=0 reqs_on_tracks=0 | 7 | Xero |  | 6 | 0 | REAL (ManyRequests subscription) | keep; plan_type mismatch noted (P11) |
| Emusio | active | launch | none |  | 0 | 0 |  |  |  | 1 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Giant Group | active | scale | retainer | 2000 | 0c1cc177 scale/active tracks=1 reqs_on_tracks=0 | 4 | Xero |  | 54 | 1 | REAL (Giant Group scale retainer, custom_mrr 2000, 4 Xero invoices) | keep |
| Glasswall Solutions Ltd | active | none | retainer | 1250 | 6da8f7ba hourly/active MR tracks=0 reqs_on_tracks=0 | 14 | Xero |  | 3 | 0 | REAL (ManyRequests subscription) | keep; plan_type mismatch noted (P11) |
| Greyhive | active |  | none |  | 62d15f7e hourly/cancelled MR tracks=0 reqs_on_tracks=0; 115747f0 hourly/active MR tracks=0 reqs_on_tracks=0 | 1 |  |  | 4 | 0 | REAL (ManyRequests subscription) | keep; plan_type mismatch noted (P11) |
| IKON VAULT | active | launch | none |  | 0 | 0 |  |  |  | 1 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| ISO Certification Experts | prospect | scale | none |  | bfd69fe4 scale/active tracks=2 reqs_on_tracks=0 | 0 |  |  |  | 1 | TEST (subscription with no invoice) | delete subscription + tracks, clear plan_type |
| Physitrack | churned | none | retainer | 3125 | 2faf98ee hourly/cancelled MR tracks=0 reqs_on_tracks=0; ce234ca5 hourly/cancelled MR tracks=0 reqs_on_tracks=0; af41ff32 hourly/cancelled MR tracks=0 reqs_on_tracks=0 | 10 | Xero | Stripe | 5 | 0 | REAL (ManyRequests subscription) | keep; plan_type mismatch noted (P11) |
| ProfitableLO | active | launch | none |  | 0 | 0 |  |  |  | 1 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Tahi Test Client | active | scale | retainer |  | 916aa930 scale/active tracks=2 reqs_on_tracks=0 | 1 |  |  |  | 0 | REAL (QA org, keep) | keep |
| Tara Winery | active | launch | none |  | 0 | 0 |  |  |  | 0 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Tara Winery | prospect | launch | none |  | 0 | 0 |  |  |  | 0 | TEST (plan_type with no subscription and no retainer billing) | clear plan_type |
| Telcom Networks Limited trading as Elevate | active | none | retainer | 1000 | 5e85e448 hourly/active MR tracks=0 reqs_on_tracks=0 | 14 | Xero |  | 7 | 0 | REAL (ManyRequests subscription) | keep; plan_type mismatch noted (P11) |
| Tevalis | prospect | scale | none |  | f50dce70 scale/active tracks=2 reqs_on_tracks=0 | 0 |  |  |  | 1 | TEST (subscription with no invoice) | delete subscription + tracks, clear plan_type |

Archived rows that still carry a subscription: Acme Corp d753f180 (seed, subscription 449d1bf2, plan maintain, 2 tracks, 0 invoices) and Tevalis cd29d3e5 (subscription 83863302, plan scale, 2 tracks, 0 invoices). Both go with P10 and P15.

Orphan tracks (subscription_id joins to nothing, 0 requests, 0 tasks):

| Track id | subscription_id (missing) | Type | Created |
|---|---|---|---|
| 32ba75e8-0eb6-494e-850a-62890dd84be4 | d9a9038f-5a0c-4f1e-b654-35156467f4e0 | small | 2026-03-29T05:09:38.992Z |
| a1c8e818-a13d-499b-aa82-776328b8e886 | d9a9038f-5a0c-4f1e-b654-35156467f4e0 | large | 2026-03-29T05:09:38.992Z |
| 0b079d6d-7a40-485e-b6b9-5c2aa6bd3793 | fd59e3b8-339e-49a4-af88-3a5699b0551e | small | 2026-04-03T08:08:52.770Z |
| f8726fc7-4b30-4652-a9bd-c84553502a7a | fd59e3b8-339e-49a4-af88-3a5699b0551e | large | 2026-04-03T08:08:52.770Z |
| dd5c0ead-789a-4a9d-a8b3-7db6fd095c74 | be008549-acc7-4f69-890f-d1ad9d873961 | small | 2026-04-04T06:58:54.558Z |
| f5eb7fd5-ccd4-4c81-ae04-2771e3e90073 | be008549-acc7-4f69-890f-d1ad9d873961 | large | 2026-04-04T06:58:54.558Z |

Signature of the test subscriptions: `subscriptions.created_at` equals `organisations.created_at` to the millisecond for ISO Certification Experts (2026-05-11T01:50:05.210Z), Tevalis 4dc141a7 (2026-05-12T08:58:08.873Z), Tevalis cd29d3e5 (2026-05-12T08:53:41.287Z), Tahi Test Client (2026-09-05T07:15:35.745Z) and Giant Group (2026-04-30T00:12:10.232Z). That is POST /api/admin/clients with planType 'scale' (route.ts:260-289), which inserts the subscription and two tracks in the same tick. Giant Group is kept on the founder's word (custom_mrr 2000, 4 Xero invoices, ManyRequests org 54).

Inverse mismatch, for information: Dante Media, Glasswall, Greyhive, Physitrack and Elevate hold ManyRequests 'hourly' subscriptions while their `plan_type` reads none or NULL (the importer never touches D1-native columns). See P11.

## 3. Duplicate and test organisations

### 3a. Tara Winery x2

| id | Status | plan_type | Industry | Contacts | Kanban cols | Invites | Subs | Invoices | Deals | Created | Updated |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe | active | launch | Hospitality / Wine | 0 | 0 | 0 | 0 | 0 | 0 | 2026-04-29T07:51:39.654Z | 2026-04-29T07:51:39.654Z |
| 22f584a1-8f10-4acd-a9cd-32c2b15020a1 | prospect | launch | Hospitality | 2 | 6 | 0 | 0 | 0 | 0 | 2026-04-29T07:52:16.403Z | 2026-05-21T03:24:55.673Z |

Linked pipeline: people row 0cb4140a-a79d-44a2-ab76-81630465303d (Tara Winery, tarawinery@gmail.com) and lead 5bc4dac1-e747-41b4-b78e-ff8d19661d70 (status new, promoted_deal_id None); deals referencing either organisation or the name: 0. Both contacts on 22f584a1 carry that person_id. Proposed direction: keep 22f584a1, delete the empty 2c4d26bd (P12).

### 3b. Acme Widgets Test ee8e83b6 (active, 6 Stripe invoices, 0 contacts, created 2026-09-05T00:03:10Z)

| Invoice id | Stripe id | Status | Amount | Paid at | Notes | Line items | Mode evidence |
|---|---|---|---|---|---|---|---|
| 8890e89f-b042-4d22-b59b-ec00cb9a9af2 | in_1Tn7zN2MOtshRPkAfN5R6ST6 | paid | GBP 3029 | 2026-06-28T01:58:49.000Z | Imported from Stripe: DXILI4NG-0011 | 1 × Tahi Scale (at £3,029.00 / month) | TEST MODE (/test_ in hosted URL) |
| c929f08a-baeb-440d-8354-e5f30a63c4aa | ch_3Tn7zO2MOtshRPkA07dqdxC4 | paid | GBP 3029 | 2026-06-28T01:58:48.000Z | Stripe payment: Subscription creation | Subscription creation | no hosted URL |
| fef1f091-65ee-4ecb-9595-9399e4dcbb02 | in_1Ty0Ht2MOtshRPkAZ7aUxC0W | paid | GBP 3029 | 2026-07-28T02:58:49.000Z | Imported from Stripe: DXILI4NG-0012 | 1 × Tahi Scale (at £3,029.00 / month) | TEST MODE (/test_ in hosted URL) |
| 0e690ebc-7c2a-4258-84c1-df7d019b144d | ch_3Ty1EE2MOtshRPkA0esmjXAE | paid | GBP 3029 | 2026-07-28T02:58:51.000Z | Stripe payment: Subscription update | Subscription update | no hosted URL |
| 084510c6-902e-4073-b7e7-0ffe25e06f0f | in_1U9F4i2MOtshRPkAUGPTOX7B | paid | GBP 3029 | 2026-08-28T02:59:38.000Z | Imported from Stripe: DXILI4NG-0013 | 1 × Tahi Scale (at £3,029.00 / month) | TEST MODE (/test_ in hosted URL) |
| 422bfeae-b43d-485d-8540-d6109e1c57cd | ch_3U9G112MOtshRPkA0dlmFEOS | paid | GBP 3029 | 2026-08-28T02:59:41.000Z | Stripe payment: Subscription update | Subscription update | no hosted URL |

Reading: the `in_` rows are Stripe invoices numbered DXILI4NG-0011 to 0013 for a 'Tahi Scale' subscription at 3,029.00 per month, each paired with a `ch_` charge row ('Subscription creation', 'Subscription update') on the 28th of June, July and August 2026; the three invoice rows store `https://invoice.stripe.com/i/acct_1TF61F2MOtshRPkA/test_...`, which is the hosted-invoice path Stripe issues only in test mode. The organisation was auto-created by lib/stripe-import.ts on 5 Sep with the customer's display name. Verdict: Stripe test-mode fixture; deletion is P13 and stays judgement because invoices are finance rows by the standing rule and only the Stripe dashboard can confirm the mode. Consequence if confirmed: the Stripe importer is reading test-mode objects (P25).

### 3c. test manual 6f4a0ece (archived, 1 Stripe invoice)

| Invoice id | Stripe id | Status | Amount | Paid at | Notes | Line items | Mode evidence |
|---|---|---|---|---|---|---|---|
| cb8c4f47-aca4-4d71-bc7c-f855f5ef4473 | in_1TGQaE2MOtshRPkATn4r8ByV | sent | NZD 350 |  | Imported from Stripe: QMZ9F50W-0001 | test manual stripe add | TEST MODE (/test_ in hosted URL) |

### 3d. Stripe-mode scan across every Stripe-sourced invoice

| Organisation | Status | Stripe customer | Invoices | test-mode URLs | live URLs | no URL stored | Total | Currencies |
|---|---|---|---|---|---|---|---|---|
| Acme Widgets Test | active | cus_Umg4sMjWGzkulh | 6 | 3 | 0 | 3 | 18174 | GBP |
| test manual | archived | cus_UEuPbDrBqygNwg | 1 | 1 | 0 | 0 | 350 | NZD |
| Axis Creative | churned | cus_T0maTvBsYzsAK7 | 2 | 0 | 0 | 2 | 3000 | USD |
| Christian Burton | active | cus_UMAPooq7WKMRl7 | 2 | 0 | 0 | 2 | 5000 | USD |
| Evan Kwan | archived | cus_Sm4dmnkwzZp2Zn | 1 | 0 | 0 | 1 | 3125 | GBP |
| Evan Kwan | archived | cus_Sm4dmnkwzZp2Zn | 1 | 0 | 0 | 1 | 3125 | GBP |
| Evan Kwan | archived | cus_Sm4dmnkwzZp2Zn | 9 | 0 | 0 | 9 | 28125 | GBP |
| Fluvial | active |  | 3 | 0 | 0 | 3 | 1500 | USD |
| INV-2025000008 | archived | cus_SU7Kgl4TPhaSZG | 2 | 0 | 0 | 2 | 8280 | USD |
| INV-2025000015 | archived | cus_SinCtgIC8Zk4F3 | 2 | 0 | 0 | 2 | 750 | USD |
| INV-2026000027 | archived | cus_U69NtPKIj60U0K | 4 | 0 | 0 | 4 | 1750 | USD |
| Mike Kentz | archived | cus_UJOjgVRkapnzZI | 5 | 0 | 0 | 5 | 10500 | USD |
| Steve Stuart | archived | cus_SdrM21yV5cfbKd | 1 | 0 | 0 | 1 | 1000 | GBP |
| Âli Okumuşoğlu | archived | cus_SbyMQu8xA643N5 | 1 | 0 | 0 | 1 | 500 | EUR |
| Âli Okumuşoğlu | archived | cus_SbyMQu8xA643N5 | 1 | 0 | 0 | 1 | 500 | EUR |
| Âli Okumuşoğlu | archived | cus_SbyMQu8xA643N5 | 5 | 0 | 0 | 5 | 2500 | EUR |

Only the two test-named organisations carry a test-mode URL. Every other Stripe invoice has no hosted URL stored at all, so the database cannot prove their mode; their customer names (Evan Kwan, Ali Okumusoglu, Steve Stuart, Mike Kentz) and amounts match the ManyRequests ledger, which is why the import report treats them as real and merge-only.

### 3e. Name and address scans

| Organisation | id | Status | plan_type | Stripe | Xero | Invoices | Contacts | Reading |
|---|---|---|---|---|---|---|---|---|
| Acme Widgets Test | ee8e83b6-71a6-4e8c-8d79-3e6a0d30ee6e | active | none | cus_Umg4sMjWGzkulh |  | 6 | 0 | P13 |
| Tahi Test Client | d468fd7e-5bb2-4b3b-ae81-4973927d2435 | active | scale |  |  | 1 | 1 | KEEP, QA org (protected in cleanup.ts) |
| Acme Corp | d753f180-f484-498d-80cb-7e9e36b2dcbd | archived | maintain |  |  | 0 | 2 | seed, archived, refused by cleanup (case_study_submissions row) |
| INV-2025000008 | 26bdb305-927b-4ebc-a264-52573193a6b7 | archived | none | cus_SU7Kgl4TPhaSZG |  | 2 | 0 | Stripe-import shell named after a ManyRequests invoice number; merge per import report Phase C |
| INV-2025000015 | aaa7e396-cca0-4ba3-8b57-e5767f52604c | archived | none | cus_SinCtgIC8Zk4F3 |  | 2 | 0 | Stripe-import shell named after a ManyRequests invoice number; merge per import report Phase C |
| INV-2026000027 | f8b5f588-f9d7-4772-9617-7ce99a1e4206 | archived | none | cus_U69NtPKIj60U0K |  | 4 | 0 | Stripe-import shell named after a ManyRequests invoice number; merge per import report Phase C |
| test manual | 6f4a0ece-a81c-46b8-bca9-ef7072d00f36 | archived | none | cus_UEuPbDrBqygNwg |  | 1 | 0 | P14 |

| Contact id | Organisation | Org status | Name | Email | Reading |
|---|---|---|---|---|---|
| c5973358-9e97-4cb4-bcb7-a3b99bdcdbcd | Tahi Test Client | active | Liam (client test) | business+client@tahi.studio | QA login alias, keep |
| 9dfe4ed6-7784-4a30-b91f-da8bcfa1e37e | Acme Corp | archived | Alice Johnson | alice@acme.example.com | seed, goes with the org |
| 3e3d5c07-416b-4614-aace-fe6a57edab8e | Acme Corp | archived | Bob Smith | bob@acme.example.com | seed, goes with the org |
| d6e42751-2238-43ea-8c54-b7439ba67572 | Tahi Studio | archived | Liam Miller | business@tahi.studio | scratch org, goes with the org |
| 7463b364-10a2-4d5f-9e6d-f7eac89d8572 | Tahi Studio (internal) | internal | Tahi Studio | tasks@tahi.studio | ManyRequests client 73, the studio's own account, keep |

No contact on a non-archived organisation uses example.com, test.com, mailinator or a plus-alias other than the QA org's. Lead and deal title scans for test, demo, acme, lorem, smoke: 0 deals; 1 lead ('Attest', a real company name, keep). St Stephen's Anglican Church (2f1cefe1) has 0 contacts but 1 deal and 2 activities, so it is a real prospect whose only junk request was already wiped. Emusio (22c7b584) likewise has 1 deal and 4 activities. Christian Burton (fae58d04) is a Stripe shell for The Longevity Edit and is still status active (P16).

### 3f. Status 'active' without any money or external id

| Organisation | id | plan_type | Contacts | Deals | Activities | Created |
|---|---|---|---|---|---|---|
| Alumni Capital | e26d7d30-bc1b-4048-83fa-7f3defb2aa7a | launch | 2 | 0 | 0 | 2026-04-30T00:15:23.930Z |
| Avery Cox (Tattoo Expo Platform) | 8cc95f41-b010-44e9-accb-bcd7c8c83a37 | launch | 2 | 0 | 0 | 2026-04-29T07:53:05.141Z |
| Emusio | 22c7b584-2608-449a-b570-af746f0611b2 | launch | 0 | 1 | 4 | 2026-05-05T10:18:01.880Z |
| Happy Monday | 0b69a8bf-68ce-4177-9ca2-ff0564365018 | none | 2 | 1 | 2 | 2026-06-12T02:51:06.541Z |
| IKON VAULT | e078dc55-3045-429b-bee3-2d0a386cba41 | launch | 2 | 1 | 8 | 2026-04-22T00:02:23.175Z |
| ILFP Legal Partners LLC | 785aef20-c1ea-4bb8-b5a6-d2288ee9a42a |  | 1 | 0 | 0 | 2026-04-20T23:11:44.298Z |
| ProfitableLO | 9c03db37-444a-4c59-a475-f107dba92093 | launch | 2 | 1 | 7 | 2026-04-24T06:03:35.263Z |
| SafeRec | be245c1a-78c4-4b82-9430-59a120b660d5 | none | 2 | 1 | 2 | 2026-06-14T23:37:49.442Z |
| St Stephen's Anglican Church | 2f1cefe1-5d91-405b-a6df-f3d8008aae37 | none | 0 | 1 | 2 | 2026-07-03T07:56:14.685Z |
| Tara Winery | 2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe | launch | 0 | 0 | 0 | 2026-04-29T07:51:39.654Z |
| iTANZ / Integration Xperts ANZ | 24c6d477-7df7-446d-b076-d3c1403a6dc1 |  | 1 | 0 | 0 | 2026-04-20T23:11:46.095Z |

These read as prospects that the new-client dialog stamped 'active' (route.ts:180). Judgement item P17.

## 4. Test artefacts on real or internal organisations that survived the wipe

### 4a. Requests without a ManyRequests key (all 6 in the table)

| Request id | Organisation | Title | Status | submitted_by_id | Created | Msgs | Time | Reading |
|---|---|---|---|---|---|---|---|---|
| e2c25e72-ea55-405e-a337-26e5e49fe59d | Stride | Visible "Updated on" dates on case studies | submitted | api-service | 2026-08-15T21:38:44.841Z | 0 | 0 | Stride hand-typed row with no ManyRequests twin (import report), keep |
| e60522ce-2c2a-46ef-8010-32694def77fa | Stride | Site hygiene: robots, sitemap, AI crawlers, /services/services redirect | delivered | api-service | 2026-08-15T21:38:59.992Z | 0 | 0 | Stride hand-typed row with no ManyRequests twin (import report), keep |
| a7f1a9f8-3127-484c-be4b-217e5e862a34 | Stride | Schema + internal linking for incoming pricing article and pillar page | in_review | api-service | 2026-08-15T21:39:01.900Z | 0 | 0 | Stride hand-typed row with no ManyRequests twin (import report), keep |
| 90317217-ccbf-41ea-a77b-f734cb933fed | Tahi Test Client | Homepage hero refresh | submitted | user_3FIxghTGGdoGhO5MjRYHFgtzvd5 | 2026-09-05T07:16:49.804Z | 0 | 0 | QA org fixture, keep |
| 4f76fbc9-b3a7-440e-923c-b39bd660a74f | Tahi Test Client | Contact form spam filtering | client_review | user_3FIxghTGGdoGhO5MjRYHFgtzvd5 | 2026-09-05T07:16:49.985Z | 0 | 0 | QA org fixture, keep |
| 4d5d39a0-558b-41cb-99c5-29d698395bc0 | Tahi Test Client | Act-as-client smoke: please ignore | archived | b3025c04-6cdd-4154-822c-5d4fbfb95b76 | 2026-09-06T12:49:01.600Z | 0 | 0 | QA smoke, archived, submitted by Liam's team_member id (P23) |

Title scan (test, retret, smoke, zz, lorem, dsfsd, asdf, qwer, fgfdh, dummy, delete me, please ignore, or shorter than 4 characters) over all 333 requests: 14 hits. 13 of them carry a ManyRequests id (real client requests such as 'QA test' at ISG, 'Chat Deployment Test' at Elevate, 'Testing results' at The Longevity Edit) and stay; the only non-import hit is the QA smoke request above.

### 4b. Tasks, subtasks and blockers (tasks are demo data per the standing rule)

| Task id | Type | Organisation | Title | Status | request_id | Created by | Created |
|---|---|---|---|---|---|---|---|
| efa2daf2-329b-4087-ab5a-dbafe5cc8aab | client_task | Stride | Get moneys | todo | 7aa2657e-94b5-4ca3-a0a7-0ff7c82bb378 | user_3BUxI1ofUJFOqt6AujKPVjfE7wN | 2026-03-30T02:39:29Z |
| 776055e7-ff78-4cf9-bf89-9440187ef48a | tahi_internal |  | Get moneys | todo |  | user_3BUxI1ofUJFOqt6AujKPVjfE7wN | 2026-03-30T02:39:50Z |
| 6e8e0fe0-c81d-4fc5-b2d6-e048b26623b6 | tahi_internal |  | Update 18 product pages: copy, images, and sections | todo |  | user_3BUxI1ofUJFOqt6AujKPVjfE7wN | 2026-04-03T21:43:18Z |
| d8dbfc14-24a8-48e7-a14d-12960acdbe65 | tahi_internal |  | Get moneysd | blocked |  | user_3BUxI1ofUJFOqt6AujKPVjfE7wN | 2026-04-04T06:54:26Z |

| Subtask id | task_id | Task exists | Title |
|---|---|---|---|
| ad8161b7-6d7a-4a54-acca-58fe1cf25efa | c4409924-dbee-4e5d-b0d9-6e8806817734 | no | One |
| b53ab058-2042-4a89-956b-fc0600624500 | c4409924-dbee-4e5d-b0d9-6e8806817734 | no | Two |

| Blocker id | Blocked | Blocker | Reading |
|---|---|---|---|
| f49e4ab9-816b-467f-ae47-b6593076589c | task efa2daf2-329b-4087-ab5a-dbafe5cc8aab | task d8dbfc14-24a8-48e7-a14d-12960acdbe65 | demo task blocked by demo task |
| a05e04f1-3e83-4c06-8197-624c85120a81 | request 7aa2657e-94b5-4ca3-a0a7-0ff7c82bb378 | request 79866e68-95d2-4eeb-943d-b7153575f49f | real Stride request (ManyRequests 344, 'Contact page hours/SLA block + schema') blocked by deleted test request 79866e68 ('second test') |

### 4c. Time entries (all 3 rows in the table)

| Time entry id | Organisation | Hours | Source | Notes | task_id | Started | Ended |
|---|---|---|---|---|---|---|---|
| 60858e75-7f05-4b63-ad11-18fa9356c3d8 | Tahi Studio (internal) | 0.0053 | live_timer | General requests time |  | 2026-09-02T01:05:47.917Z | 2026-09-02T01:06:07.138Z |
| e4798e41-3cf6-4406-8857-ad12c13f8c32 | Tahi Studio (internal) | 0.0003 | live_timer |  | efa2daf2-329b-4087-ab5a-dbafe5cc8aab | 2026-09-05T03:21:01.316Z | 2026-09-05T03:21:02.867Z |
| 7002cf74-70df-46cd-bf52-7064ea6cf976 | Tahi Studio (internal) | 0.0017 | live_timer | General client time |  | 2026-09-05T07:26:06.829Z | 2026-09-05T07:26:15.355Z |

### 4d. Files (the only row in the table)

| File id | org_id | Uploaded by | Filename | Storage key | Created |
|---|---|---|---|---|---|
| 27180da0-0431-429e-9c70-030a28f3133c | org_3FIxgmUSh2RnooQvZBLUPrl8VGV | team_member b3025c04-6cdd-4154-822c-5d4fbfb95b76 | Verandela_Accreditation_Guide__1_.pdf | org_3FIxgmUSh2RnooQvZBLUPrl8VGV/general/1788594064112-Verandela_Accreditation_Guide__1_.pdf | 2026-09-05T07:41:05Z |

### 4e. Conversations and participants (all rows in both tables)

| Conversation id | Type | Name | Organisation | request_id | Request exists | Participants | Messages |
|---|---|---|---|---|---|---|---|
| 2ee90ded-57e0-4b87-9dac-233795f99e57 | group | Test |  |  |  | 1 | 0 |
| c71a9357-e7b8-4262-a3b1-14d3a998c267 | request_thread | retret | Tahi Studio | 14df3a67-b49f-4edf-9604-a8dd8c8c4a08 | no | 1 | 0 |
| b10af089-85af-4c56-adae-007467bfc449 | direct | Alice Johnson | Acme Corp |  |  | 2 | 0 |
| 14fab59c-eff2-4abf-96e8-efe514787cb7 | group | Test |  |  |  | 1 | 0 |
| fd3149b9-ea87-4ee7-a9fe-5273e609b4a8 | request_thread | second test | Tahi Studio | 79866e68-95d2-4eeb-943d-b7153575f49f | no | 1 | 0 |
| d72a946c-62a4-4f2b-a8fa-33dc1715f78e | request_thread | Test | Acme Corp | 578c21ea-c38a-4e63-bbfd-81cfb0e13ec2 | no | 1 | 0 |
| 1743cb7e-3f61-43f9-8ae2-6470318d6b50 | request_thread | test | Physitrack | 84d18980-5648-4608-9e5f-200fe5dac264 | no | 1 | 0 |
| 3bac8845-6f45-4fa3-a1c6-42302630b453 | request_thread | QA Test: Homepage redesign | Acme Corp | 0ffd930d-e5bb-42c9-8aa2-18edfc52ad87 | no | 1 | 0 |

### 4f. Notifications referencing deleted requests or deleted contacts

| Notification id | Recipient | Type | Title | entity_id | Created |
|---|---|---|---|---|---|
| 6e07cd0a-8c9e-4c05-8e86-e49d0de6708c | contact 60826be2-5223-4a4c-babe-76ca0014e36c | request_status_changed | Request "retret" status changed to in progress | a3cf20b5-7bd3-47dd-a080-aba22d4b2f04 | 2026-04-04T07:00:49.207Z |
| fc0ff3d9-3515-4de9-a15f-70543e845715 | team_member b3025c04-6cdd-4154-822c-5d4fbfb95b76 | request_status_changed | Request "retret" status changed to in progress | 27209702-f6b9-43fb-b335-d328be7c3783 | 2026-04-12T09:34:15.802Z |
| 91425e36-3ef6-4a33-9d16-8d147d4ecd98 | contact d2e18bc8-e472-44d9-8543-4f61c74197fa | request_status_changed | Request "retret" status changed to in progress | 27209702-f6b9-43fb-b335-d328be7c3783 | 2026-04-12T09:34:15.802Z |
| a7159dd2-5265-4732-a3e9-4d96a8fd0799 | contact d6e42751-2238-43ea-8c54-b7439ba67572 | new_message | New message on your request | 79866e68-95d2-4eeb-943d-b7153575f49f | 2026-04-16T10:15:37.435Z |
| 7874bc66-b9cd-4897-90c5-6a86f77c88f0 | team_member user_3FIxghTGGdoGhO5MjRYHFgtzvd5 | request_created | New request REQ-3: Act-as-client smoke: please ignore | 4d5d39a0-558b-41cb-99c5-29d698395bc0 | 2026-09-06T12:49:01.841Z |

The remaining 25 notifications are finance anomalies, cron failures, invoice_paid and daily summaries addressed to Liam; keep.

### 4g. Tables checked and found clean

messages without a ManyRequests key: 0. scheduled_calls: 0. active_timers: 0. request_participants: 0. mentions: 0. request_steps: 0. request_reads: 5, all on existing Stride and QA requests. onboarding_invites: 1, the QA org's unused invite (business+client@tahi.studio, expires 2026-09-19). email_suppressions: 3, all evidence rows for the QA smoke request on 2026-09-06 (james@, staci@, sarah@tahi.studio withheld). Orphan check across 20 reference paths (requests.org, contacts.org, invoices.org, subscriptions.org, requests.track, messages.request, messages.org, tasks.org, time_entries.org, kanban_columns.org, deal_contacts.contact, deals.org, subscriptions.billed_contact, request_participants.request and .contact, conversation_participants.conversation): all 0 except tracks.subscription 6 (P09), conversations.request 5 (P20), files.org 1 (P22), and one request whose submitted_by_id is a team_member id rather than a contact (the QA smoke, P23).

## 5. Where the code puts a plan on an organisation that has no subscription

- `app/api/admin/clients/route.ts:184` writes `planType: planType || null` on the organisation for every plan value; `:260-289` creates a subscription and tracks only for maintain and scale, so launch, tune, hourly and custom land as a bare `plan_type`; `:180` hardcodes `status: 'active'` for every organisation the dialog creates, whether or not anything is billed.
- `app/(dashboard)/clients/_list/new-client-panel.tsx:54-61` offers Launch (NZ$2,500 one-off), Tune, Hourly and Custom in the create dialog; this is where the seven 'launch' flags and both 'scale' subscriptions came from (the subscription timestamps match the organisation timestamps to the millisecond).
- `app/api/admin/clients/[id]/route.ts:290-296` PATCH accepts `planType` free-form with no subscription check; `app/(dashboard)/clients/[id]/_kit/subscription-card.tsx:32-52` dual-writes org.planType and subscription.planType and lists launch/tune/hourly/custom as valid subscription plans; `app/api/admin/subscriptions/[id]/route.ts:165-166` PATCH accepts any planType on the subscription.
- `app/api/admin/deals/[id]/convert-to-client/route.ts:138-152` maps engagement 'retainer' to 'maintain' and creates a subscription (consistent), but `:150` also hardcodes `status: 'active'` and `:75/:119` flip an existing organisation to active on conversion.
- `app/api/admin/leads/[id]/promote/route.ts:92-99` creates the organisation as 'prospect' with no plan (correct).
- `app/api/admin/seed/route.ts:71-102` seeds Acme Corp (maintain), Beta Labs (scale) and Gamma Design (launch), `:138-155` their subscriptions; the only guard is `isTahiAdmin` (`:14`), so the seed is callable on production by any Tahi admin.
- `app/api/portal/checkout/route.ts:176-195` sets plan_type after a Stripe checkout (legitimate, paired with a subscription). `app/api/portal/provision/route.ts:102,165` and `lib/internal-org.ts:33` write 'none' (fine).
- `workers/mcp-server/src/index.ts:300` (create_client) and `:310` (update_client) forward `planType` to the two routes above, so MCP has the same hole.
- Related, not plan but the same hygiene: `lib/stripe-import.ts:120-133` and `lib/stripe-sync.ts:134-146` auto-create an organisation from any Stripe customer and there is no `livemode` check anywhere in app, lib or workers (grep: 0 hits); `app/api/admin/clients/[id]/contacts/route.ts:76` inserts a contact without checking (org_id, lower(email)), which is the duplicate-contact factory; `app/api/uploads/confirm/route.ts:108` documents the legacy Clerk-id org_id that the one orphan file row still carries.

## 6. Proposal list

MECHANICAL = safe to apply now (exact duplicate with zero references, all references re-pointable, or the founder's own rule applied verbatim to a reversible column). JUDGEMENT = Liam decides. Apply in id order; P01 before P12, P04 before P15, P06 before P12. Take a D1 export first (the last one is .claude/backups/tahi-db-20260906T2036Z.sql, from before this morning's import).

1. **P01 [MECHANICAL] duplicate-contact**  
   Target: Alumni Capital: delete 97ec2d80-befd-41ca-8e77-a3216edd5f84, keep d1de0979-1d35-4630-a70b-32493ade3dda; Assertio: delete 0aee6c97-8886-4f84-89fb-524fdfc9fb1e, keep 1b573c9f-617f-4577-b21b-7ddedfa9619f; Avery Cox (Tattoo Expo Platform): delete 381acce5-4808-4567-a93c-a79cdcfb6917, keep c3492efc-c59d-4915-8c34-3bd8b835a580; IKON VAULT: delete 5ad1bf53-ad4c-467c-b4d4-128b2b99607e, keep e9d9c826-cf1e-48e8-b83f-ac2fb0b297a0; ProfitableLO: delete 2aec3d9a-b86f-49c1-a2f3-0952740c525e, keep 88ee1ab2-7132-40e7-a6ff-a9310a23e0b5; Tara Winery: delete f8b95372-6e5c-4eb4-9fcd-a3f402f3bf94, keep 007cc919-0e57-41e0-b87c-b768467750b0; Tevalis: delete ec7ea572-eccb-464a-956a-a66862c9ed4c, keep 1ff778bc-8721-4811-9d38-eff00b1fd27e  
   Action: For each pair: UPDATE contacts SET role = <member row role> WHERE id = <survivor> AND role IS NULL; then DELETE FROM contacts WHERE id = <member row id>. Survivor is the is_primary=1 / portal_role='admin' row (the older row in every pair).  
   Evidence: 7 same-org same-email pairs where the row to delete has 0 references across 31 scanned columns (dup_refs), clerk_user_id NULL on all rows, no manyrequests_id on the deleted row.

2. **P02 [MECHANICAL] duplicate-contact**  
   Target: Happy Monday: delete 558e914c-7bfc-4d94-87c6-994b30be099b, keep d7e3e4c9-30ea-4af0-af67-400469ef6047, re-point deal_contacts.contact_id=1; SafeRec: delete 6fde276c-9ea1-4d3c-b65a-e20b43450148, keep 556da0fa-6f35-4cd7-a92c-3a31742a5aee, re-point deal_contacts.contact_id=1  
   Action: UPDATE deal_contacts SET contact_id = <survivor> WHERE contact_id = <member row> (deal_contacts 666a89c9 Happy Monday intro; a9851a52 SafeRec intro); copy role to survivor; DELETE the member row.  
   Evidence: deal_contacts.contact_id is the only reference (1 row each, dc_rows); survivor has 0 deal_contacts rows so no unique collision; every other scanned column is 0.

3. **P03 [MECHANICAL] duplicate-contact**  
   Target: Charles Bilash: delete 9cb67733-9785-4054-b7cc-4ffd6853ee8f, keep 5d98f8a1-6bfc-48a7-af28-17b93ca53efc (manyrequests_id 88)  
   Action: UPDATE requests SET submitted_by_id = '5d98f8a1-6bfc-48a7-af28-17b93ca53efc' WHERE submitted_by_id = '9cb67733-9785-4054-b7cc-4ffd6853ee8f' (4 rows: 3a61f5dc, f858fc01, 0c1340bb, e561a88a = ManyRequests 315 to 318); UPDATE deal_contacts SET contact_id = '5d98f8a1-...' WHERE id = 'e6d6ad6e-053c-4c54-a15a-3ea0f150a4a1'; UPDATE contacts SET role = 'Owner and decision-maker' WHERE id = '5d98f8a1-...'; DELETE FROM contacts WHERE id = '9cb67733-...'.  
   Evidence: Survivor carries manyrequests_id 88 (unique index idx_contacts_manyrequests, the import's idempotency key). Member row holds requests.submitted_by_id x4 (cb_requests) and deal_contacts x1 (dc_rows); both columns are plain text, re-pointable.

4. **P04 [MECHANICAL] duplicate-contact**  
   Target: Tevalis archived shell cd29d3e5: delete contacts 2da9aaa2-7625-4941-bf44-3df28f404c73 and 95c3ffb0-b7f4-488f-b0e3-cc97d5ad547d  
   Action: DELETE FROM contacts WHERE id IN ('2da9aaa2-...','95c3ffb0-...'). Same email (j.degoey@tevalis.com, case variant) already lives on the surviving Tevalis 4dc141a7 as 1ff778bc.  
   Evidence: 0 references on both rows (dup_refs); xorg_contacts shows j.degoey@tevalis.com is the only email present on two organisations, both named Tevalis.

5. **P05 [MECHANICAL] plan-type**  
   Target: Assertio 7a745594-0def-4c6f-889b-322b29256e20: plan_type 'launch' -> 'none'  
   Action: UPDATE organisations SET plan_type = 'none' WHERE id = '7a745594-0def-4c6f-889b-322b29256e20'. Leave billing_model 'project', xero_contact_id and the 8 Xero invoices untouched.  
   Evidence: 0 subscription rows, billing_model 'project', custom_mrr null; the founder named Assertio as a plan it never bought. 8 Xero invoices and 4 deals stay.

6. **P06 [MECHANICAL] plan-type**  
   Target: Alumni Capital e26d7d30; Avery Cox (Tattoo Expo Platform) 8cc95f41; Emusio 22c7b584; IKON VAULT e078dc55; ProfitableLO 9c03db37; Tara Winery 2c4d26bd; Tara Winery 22f584a1  
   Action: UPDATE organisations SET plan_type = 'none' WHERE id IN ('e26d7d30-bc1b-4048-83fa-7f3defb2aa7a', '8cc95f41-b010-44e9-accb-bcd7c8c83a37', '22c7b584-2608-449a-b570-af746f0611b2', 'e078dc55-3045-429b-bee3-2d0a386cba41', '9c03db37-444a-4c59-a475-f107dba92093', '2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe', '22f584a1-8f10-4acd-a9cd-32c2b15020a1'). Reversible single-column change; prior values recorded in this file.  
   Evidence: Each has plan_type 'launch', 0 subscriptions, 0 invoices, no Xero contact, no Stripe customer, no ManyRequests id (orgs). Meets the founder's TEST rule: a plan_type with no subscription and no retainer billing.

7. **P07 [MECHANICAL] test-subscription**  
   Target: ISO Certification Experts a98728b6: subscription bfd69fe4-8e04-44a3-8744-476e32218ab7 + tracks 858ce43d-1827-44a9-b4dc-cca3df01b9d2, 2b33ce80-48cd-4898-9c02-2aceea68a0d9  
   Action: DELETE FROM tracks WHERE subscription_id = 'bfd69fe4-8e04-44a3-8744-476e32218ab7'; DELETE FROM subscriptions WHERE id = 'bfd69fe4-8e04-44a3-8744-476e32218ab7'; UPDATE organisations SET plan_type = 'none' WHERE id = 'a98728b6-98c9-48ab-804c-526885641267'.  
   Evidence: Prospect, 0 invoices, subscription created at the same instant as the org (2026-05-11T01:50:05.210Z = org created_at), 0 requests and 0 tasks on both tracks, no stripe_subscription_id, no ManyRequests id.

8. **P08 [MECHANICAL] test-subscription**  
   Target: Tevalis 4dc141a7: subscription f50dce70-38b3-4023-8086-ed7b5b861683 + tracks fe310fb7-906f-4850-97c5-bb0c6462c65b, 2c3829e4-9db1-46e8-937d-1e38e17b4950  
   Action: DELETE FROM tracks WHERE subscription_id = 'f50dce70-38b3-4023-8086-ed7b5b861683'; DELETE FROM subscriptions WHERE id = 'f50dce70-38b3-4023-8086-ed7b5b861683'; UPDATE organisations SET plan_type = 'none' WHERE id = '4dc141a7-68e7-4143-91fc-ab54006ea9d9'.  
   Evidence: Prospect, 0 invoices, subscription created with the org (2026-05-12T08:58:08.873Z), 0 requests on tracks; its only deal bd0bb8b1 is archived (close_reason 'archived') and the sister deal 341faf67 is Closed Lost.

9. **P09 [MECHANICAL] orphan-tracks**  
   Target: 6 tracks whose subscription_id joins to no subscription: 32ba75e8-0eb6-494e-850a-62890dd84be4, a1c8e818-a13d-499b-aa82-776328b8e886, 0b079d6d-7a40-485e-b6b9-5c2aa6bd3793, f8726fc7-4b30-4652-a9bd-c84553502a7a, dd5c0ead-789a-4a9d-a8b3-7db6fd095c74, f5eb7fd5-ccd4-4c81-ae04-2771e3e90073  
   Action: DELETE FROM tracks WHERE id IN ('32ba75e8-0eb6-494e-850a-62890dd84be4', 'a1c8e818-a13d-499b-aa82-776328b8e886', '0b079d6d-7a40-485e-b6b9-5c2aa6bd3793', 'f8726fc7-4b30-4652-a9bd-c84553502a7a', 'dd5c0ead-789a-4a9d-a8b3-7db6fd095c74', 'f5eb7fd5-ccd4-4c81-ae04-2771e3e90073').  
   Evidence: orphans1 tracks.subscription = 6; each has 0 requests and 0 tasks (tracks_nonmr); parents were d9a9038f, fd59e3b8, be008549 which no longer exist.

10. **P10 [MECHANICAL] test-subscription**  
   Target: Acme Corp (archived seed org d753f180): subscription 449d1bf2-89bd-4f88-a46f-9eeef36a16a7 + tracks e579b5e1-f10d-4905-b966-ace108e21125, 15df647c-0389-4545-bdda-d14f7b1e352b  
   Action: DELETE FROM tracks WHERE subscription_id = '449d1bf2-89bd-4f88-a46f-9eeef36a16a7'; DELETE FROM subscriptions WHERE id = '449d1bf2-89bd-4f88-a46f-9eeef36a16a7'. The org itself stays until its case_study_submissions row is handled (cleanup refused it).  
   Evidence: Seed row from app/api/admin/seed/route.ts:138 (planType maintain, period 2026-03-01 to 2026-03-31), org archived, 0 invoices, 0 requests on tracks.

11. **P11 [JUDGEMENT] plan-type**  
   Target: Dante Media 731322e6, Glasswall ea4903bc, Greyhive ad862c09, Elevate 5d139669: plan_type 'none'/NULL while an ACTIVE ManyRequests 'hourly' subscription exists  
   Action: Optionally UPDATE organisations SET plan_type = 'hourly' for those four so list filters and the portal plan badge agree with the subscription. Physitrack (all three subscriptions cancelled, org churned) stays 'none'.  
   Evidence: subs: Dante 2bb14905 active, Glasswall 6da8f7ba active, Greyhive 115747f0 active, Elevate 5e85e448 active, all with manyrequests_id and hours_per_period; the importer deliberately left D1-native plan_type untouched.

12. **P12 [JUDGEMENT] duplicate-organisation**  
   Target: Tara Winery: keep 22f584a1-8f10-4acd-a9cd-32c2b15020a1 (prospect, 2 contacts, 6 kanban columns), delete 2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe (active, 0 rows in every child table)  
   Action: After P01 (contact dedupe) and P06 (plan clear): DELETE FROM organisations WHERE id = '2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe'. If Liam prefers the 'active' row instead: UPDATE contacts SET org_id = '2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe' WHERE org_id = '22f584a1-8f10-4acd-a9cd-32c2b15020a1', UPDATE kanban_columns likewise, then delete 22f584a1-8f10-4acd-a9cd-32c2b15020a1. Consider status 'prospect' either way (P17).  
   Evidence: tara: 2c4d26bd-12c2-4a53-9326-f4d4ee5d0efe has contacts 0, kanban 0, invites 0, subs 0, invoices 0, deals 0, activities 0, never updated since creation; 22f584a1-8f10-4acd-a9cd-32c2b15020a1 holds the contacts (person_id 0cb4140a, lead 5bc4dac1 status new, not promoted), 6 kanban columns and a 2026-05-21 edit. Neither has Xero, Stripe or an invoice, so 'active' is unsupported. Direction reverses the import report's suggestion, hence judgement.

13. **P13 [JUDGEMENT] stripe-test-mode**  
   Target: Acme Widgets Test ee8e83b6-71a6-4e8c-8d79-3e6a0d30ee6e: 6 invoices, 6 invoice_items, org  
   Action: Confirm in Stripe with Test mode ON that customer cus_Umg4sMjWGzkulh exists there (and not in Live). Then DELETE FROM invoice_items WHERE invoice_id IN (6 ids); DELETE FROM invoices WHERE org_id = 'ee8e83b6-...'; DELETE FROM organisations WHERE id = 'ee8e83b6-...'. Also apply the code fix in P25 so the importer cannot re-create it.  
   Evidence: test_invoices: 3 of 6 rows carry stripe_hosted_invoice_url containing '/test_' (Stripe's test-mode hosted-invoice path); numbers DXILI4NG-0011/0012/0013; line items '1 x Tahi Scale (at 3,029.00 / month)' plus 'Subscription creation/update' charges on 28 Jun, 28 Jul, 28 Aug 2026; org auto-created 2026-09-05 by lib/stripe-import.ts:120 with 0 contacts, no Xero, no ManyRequests id. stripe_mode: no other organisation has a '/test_' URL.

14. **P14 [JUDGEMENT] stripe-test-mode**  
   Target: test manual 6f4a0ece-a81c-46b8-bca9-ef7072d00f36 (archived): invoice cb8c4f47-aca4-4d71-bc7c-f855f5ef4473, item 27916864, org  
   Action: Same confirmation as P13 for customer cus_UEuPbDrBqygNwg, then delete the item, the invoice and the org.  
   Evidence: Hosted URL contains '/test_'; item description 'test manual stripe add', NZD 350, status sent, never paid, created 2026-03-29 during development.

15. **P15 [JUDGEMENT] duplicate-organisation**  
   Target: Tevalis: merge archived cd29d3e5-1e93-462a-9a0f-736c5c03892e into 4dc141a7-68e7-4143-91fc-ab54006ea9d9  
   Action: UPDATE deals SET org_id = '4dc141a7-...' WHERE id = '341faf67-dcaf-4bd6-8025-a7698ac40e29'; UPDATE activities SET org_id = '4dc141a7-...' WHERE org_id = 'cd29d3e5-...' (7 rows); DELETE FROM tracks WHERE subscription_id = '83863302-4c04-4239-9d71-dda2963b410d'; DELETE FROM subscriptions WHERE id = '83863302-...'; DELETE FROM kanban_columns WHERE org_id = 'cd29d3e5-...' (6); P04 for its 2 contacts; DELETE FROM organisations WHERE id = 'cd29d3e5-...'. cleanup.ts will refuse this (deals and activities are 'refuse' tables), so it is a hand-run statement list.  
   Evidence: orgs_archived: cd29d3e5 holds deals 1, activities 7, contacts 2, subs 1, tracks 2, kanban 6, invoices 0. Its deal 341faf67 (Closed Lost 2026-05-27, notes 'Reopened by new Director of Marketing Jocelyn de Goey') is the later record; 4dc141a7 holds the 7 rich contacts, 2 discovery_calls and the archived deal bd0bb8b1. Pipeline rows are always real, so they move rather than die.

16. **P16 [JUDGEMENT] duplicate-organisation**  
   Target: Christian Burton fae58d04-5dd1-483b-9e0b-707be70eb9e0 (active, among the 39) -> The Longevity Edit 22feff3e-aef2-479d-a96c-f785ff61d393  
   Action: UPDATE invoices SET org_id = '22feff3e-...' WHERE org_id = 'fae58d04-...' (2 rows); UPDATE organisations SET stripe_customer_id = 'cus_UMAPooq7WKMRl7' WHERE id = '22feff3e-...'; then archive or delete fae58d04. Already Phase C of the import report; repeated here because the shell is still status 'active'.  
   Evidence: orgs: Christian Burton has 2 Stripe invoices (USD 5,000 total, stripe_mode), 0 contacts, 0 requests; The Longevity Edit is ManyRequests org 53 (Christian B, CEB@cebcam.com) with 7 requests and 22 messages and no Stripe id.

17. **P17 [JUDGEMENT] org-status**  
   Target: status 'active' with no invoice, no Xero, no Stripe, no ManyRequests id: Alumni Capital e26d7d30, Avery Cox (Tattoo Expo Platform) 8cc95f41, Emusio 22c7b584, Happy Monday 0b69a8bf, IKON VAULT e078dc55, ILFP Legal Partners LLC 785aef20, ProfitableLO 9c03db37, SafeRec be245c1a, St Stephen's Anglican Church 2f1cefe1, Tara Winery 2c4d26bd, iTANZ / Integration Xperts ANZ 24c6d477  
   Action: UPDATE organisations SET status = 'prospect' WHERE id IN (...) for whichever of these Liam does not consider a paying client. Ties into P12 (Tara Winery) and P06.  
   Evidence: orgs: 11 non-archived rows with status 'active', invs 0, xero_contact_id null, stripe_customer_id null, manyrequests_id null. POST /api/admin/clients hardcodes status 'active' (route.ts:180) so every dialog-created prospect reads as a client.

18. **P18 [MECHANICAL] demo-tasks**  
   Target: 4 tasks, 2 orphan task_subtasks, 2 work_blockers, 1 time entry  
   Action: DELETE FROM work_blockers WHERE id IN ('f49e4ab9-816b-467f-ae47-b6593076589c','a05e04f1-3e83-4c06-8197-624c85120a81'); DELETE FROM task_subtasks WHERE id IN ('ad8161b7-6d7a-4a54-acca-58fe1cf25efa','b53ab058-2042-4a89-956b-fc0600624500'); DELETE FROM time_entries WHERE id = 'e4798e41-3cf6-4406-8857-ad12c13f8c32'; DELETE FROM tasks WHERE id IN ('efa2daf2-329b-4087-ab5a-dbafe5cc8aab', '776055e7-ff78-4cf9-bf89-9440187ef48a', '6e8e0fe0-c81d-4fc5-b2d6-e048b26623b6', 'd8dbfc14-24a8-48e7-a14d-12960acdbe65').  
   Evidence: tasks_all: 'Get moneys' x2, 'Get moneysd', 'Update 18 product pages' (AI wizard demo), created Mar/Apr 2026 by the dev Clerk user, one on Stride (real org) pointing at ManyRequests request 344; subtasks 'One'/'Two' point at task c4409924 which no longer exists; blocker a05e04f1 blocks Stride request 7aa2657e by deleted request 79866e68; blocker f49e4ab9 links two demo tasks. Tasks and time are demo data per the standing rule.

19. **P19 [MECHANICAL] timer-smoke**  
   Target: 3 time_entries on Tahi Studio (internal): 60858e75-7f05-4b63-ad11-18fa9356c3d8 (0.0053 h), e4798e41-3cf6-4406-8857-ad12c13f8c32 (0.0003 h), 7002cf74-70df-46cd-bf52-7064ea6cf976 (0.0017 h)  
   Action: DELETE FROM time_entries WHERE id IN (the three ids). e4798e41 is also in P18.  
   Evidence: time_all: all three are source 'live_timer' by Liam's team_member id b3025c04 on 2 and 5 Sep 2026, durations 19 s, 1.5 s and 8.5 s, billable=1 against the studio's own marker org.

20. **P20 [MECHANICAL] test-conversations**  
   Target: 8 conversations + 9 conversation_participants  
   Action: DELETE FROM conversation_participants WHERE conversation_id IN (8 ids); DELETE FROM conversations WHERE id IN ('2ee90ded-57e0-4b87-9dac-233795f99e57', 'c71a9357-e7b8-4262-a3b1-14d3a998c267', 'b10af089-85af-4c56-adae-007467bfc449', '14fab59c-eff2-4abf-96e8-efe514787cb7', 'fd3149b9-ea87-4ee7-a9fe-5273e609b4a8', 'd72a946c-62a4-4f2b-a8fa-33dc1715f78e', '1743cb7e-3f61-43f9-8ae2-6470318d6b50', '3bac8845-6f45-4fa3-a1c6-42302630b453').  
   Evidence: convos: names are 'Test' x3, 'retret', 'second test', 'test', 'QA Test: Homepage redesign', 'Alice Johnson' (Acme Corp seed contact); 5 request_thread rows point at requests that no longer exist (orphans4 conversations.request_missing = 5); 0 messages on any of them; one sits on Physitrack (real org) for the wiped 'test' request.

21. **P21 [MECHANICAL] orphan-notifications**  
   Target: 4 notifications: 6e07cd0a-8c9e-4c05-8e86-e49d0de6708c, fc0ff3d9-3515-4de9-a15f-70543e845715, 91425e36-3ef6-4a33-9d16-8d147d4ecd98, a7159dd2-5265-4732-a3e9-4d96a8fd0799  
   Action: DELETE FROM notifications WHERE id IN (the four ids). Optionally also 7874bc66-b9cd-4897-90c5-6a86f77c88f0 (the QA smoke request notification, already read).  
   Evidence: notifs: the four reference requests a3cf20b5, 27209702, 79866e68 ('retret', 'second test') that were wiped, and recipients 60826be2, d2e18bc8, d6e42751 that are deleted or scratch-org contacts. The other 25 rows are real finance anomaly, cron and invoice_paid notifications for Liam.

22. **P22 [JUDGEMENT] orphan-file**  
   Target: files 27180da0-0431-429e-9c70-030a28f3133c Verandela_Accreditation_Guide__1_.pdf (org_id = Clerk id org_3FIxgmUSh2RnooQvZBLUPrl8VGV)  
   Action: Decide: re-point files.org_id to the right D1 organisation (none named Verandela exists in organisations, leads or deals: verandela query = 0 rows) or delete the row and the R2 object org_3FIxgmUSh2RnooQvZBLUPrl8VGV/general/1788594064112-Verandela_Accreditation_Guide__1_.pdf.  
   Evidence: files_all: the only files row; org_id is a Clerk org id, not a D1 id (orphans4 files.org = 1); uploaded 2026-09-05 by Liam (team_member b3025c04) into the admin 'general' area before the confirm route started normalising legacy Clerk ids (app/api/uploads/confirm/route.ts:108).

23. **P23 [JUDGEMENT] qa-org-rows**  
   Target: Tahi Test Client d468fd7e: archived request 4d5d39a0-558b-41cb-99c5-29d698395bc0 'Act-as-client smoke: please ignore', notification 7874bc66, 3 email_suppressions rows  
   Action: Keep as is (QA org is protected in cleanup.ts), or delete only the archived smoke request and its notification. The 3 email_suppressions rows are evidence that the allowlist held on 2026-09-06 12:49 and should stay.  
   Evidence: requests_nonmr: submitted_by_id b3025c04 is Liam's team_member id (req_sub_orphan); suppressions: james@, staci@, sarah@tahi.studio blocked for that request.

24. **P24 [JUDGEMENT] code**  
   Target: app/api/admin/clients/route.ts:184 (planType written with no subscription for launch/tune/hourly/custom), :180 (status 'active' hardcoded), :260-289 (only maintain/scale get a subscription and tracks); app/(dashboard)/clients/_list/new-client-panel.tsx:54-61 (dialog offers launch/tune/hourly/custom); app/api/admin/clients/[id]/route.ts:290-296 (PATCH accepts any planType with no subscription check); app/(dashboard)/clients/[id]/_kit/subscription-card.tsx:32-52 (dual write org.planType + subscription.planType); app/api/admin/subscriptions/[id]/route.ts:165-166; app/api/admin/deals/[id]/convert-to-client/route.ts:138-152 and :150 (status 'active'); app/api/admin/seed/route.ts:71-102 and :138-155 (seeds Acme/Beta/Gamma with maintain/scale/launch, guarded only by isTahiAdmin so it is callable on production); workers/mcp-server/src/index.ts:300 and :310 (create_client / update_client forward planType)  
   Action: Builders: derive organisations.plan_type from the subscription row (or drop the column from writes) so a plan can only exist with a subscription; default status to 'prospect' until an invoice or subscription exists; gate the seed route to NODE_ENV !== 'production'.  
   Evidence: Section 5 of the report; ISO Certification Experts and both Tevalis subscriptions carry created_at identical to their organisation's created_at, which is the clients POST signature (subs vs orgs).

25. **P25 [JUDGEMENT] code**  
   Target: lib/stripe-import.ts:120-133 and lib/stripe-sync.ts:134-146 auto-create an organisation for any Stripe customer; grep for 'livemode' across app, lib and workers returns 0 hits  
   Action: Builders: skip invoices and charges where livemode === false and refuse to auto-create an organisation from them; that is how Acme Widgets Test (P13) and test manual (P14) got in.  
   Evidence: stripe_mode: only those two organisations carry '/test_' hosted URLs; every other Stripe-sourced invoice has no hosted URL stored, so the DB cannot prove their mode either way and the guard must live in code.

26. **P26 [JUDGEMENT] code**  
   Target: app/api/admin/clients/[id]/contacts/route.ts:76 inserts a contact with no (org_id, lower(email)) check and portal_role defaulting to 'member'; app/api/admin/clients/route.ts:209 creates the primary admin row  
   Action: Builders: upsert on (org_id, lower(email)) in the contacts POST (and in lib/import/manyrequests when it resolves a submitter) so the second save of the same person updates the role instead of adding a row.  
   Evidence: dup_contacts: in all 11 pairs the admin row is created first and the member row with a job title 6 to 17 seconds later (created_at deltas), which is the new-client dialog followed by the People tab POST (app/(dashboard)/clients/[id]/tabs/people.tsx:151).

## Appendix: queries run

All statements are SELECTs against production `tahi-db` on 7 Sep 2026 (NZST evening), one per wrangler invocation, results saved as JSON and read back by the tabulation script. Names in parentheses are the saved result sets: dup_contacts (self-join on org_id + lower(trim(email))), dup_refs (one COUNT per candidate column for the 22 ids), orgs (39 non-archived rows with 22 child counts each), orgs_archived (19 rows), subs (every subscription with track, request-on-track and invoice counts), tracks_nonmr (every track with its subscription and organisation), test_invoices and test_invoice_items (Acme Widgets Test, test manual, Tahi Test Client), stripe_mode (per-organisation test-mode URL tally), tara, tara_people, tara_leads, tara_deals, testnames_orgs, testnames_contacts, contacts_live, xorg_contacts, requests_nonmr, req_titles, cb_requests, dc_rows, tevalis_deals, tevalis_acts, stages, tasks_all, subtasks, blockers, time_all, files_all, msgs_nonmr, convos, convo_parts, sched_calls, timers, notifs, reads, invites, suppressions, orphans1 to orphans4, counts, counts2, leads_testnames, deals_testnames, verandela, req_7aa, req_sub_orphan, summary_counts.

