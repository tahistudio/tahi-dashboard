# ManyRequests import report (living document, started 01:45 NZST 7 Sep 2026)

Status: the importer is built, reviewed and merged to main locally; migration 0093 (the manyrequests_id spine) is applied to both D1 databases; the deploy and the first dry run are pending. The import itself has NOT run. No email, invite or notification path has been exercised at any point; the email delivery allowlist is live on production and reads closed (allowlist mode, business@tahi.studio only, Staci and Nathan blocked, no client org exempt).

## What blocks the first run

One operator step only Liam can do: the dashboard worker has no MANYREQUESTS_API_TOKEN secret (the token lives on the MCP worker). Until it is set, POST /api/admin/import/manyrequests answers 400 "ManyRequests is not configured". Commands, from the repo root, pasting the value of MANYREQUESTS_DEFAULT_TOKEN in workers/mcp-server/src/index.ts:

```
npx wrangler secret put MANYREQUESTS_API_TOKEN --env staging
npx wrangler secret put MANYREQUESTS_API_TOKEN
```

Then GET /api/admin/import/manyrequests (super admin only) reports tokenConfigured true.

## The run, in order (from the importer runbook)

STEP 0, NEW AND BLOCKING: MANYREQUESTS_API_TOKEN is set on the MCP worker, not on the dashboard worker this route runs in, so without it the first dry run answers 400 "ManyRequests is not configured". Run `wrangler secret put MANYREQUESTS_API_TOKEN --env staging`, then `wrangler secret put MANYREQUESTS_API_TOKEN` for production, and add one MANYREQUESTS_API_TOKEN line to .dev.vars locally. GET /api/admin/import/manyrequests reports tokenConfigured; that GET is now super-admin only.
STEP 1: apply migration 0093 to staging D1 with wrangler (its header carries the exact command), deploy, then POST {"dryRun":true}.
STEP 2, READ THE DRY RUN IN THIS ORDER before trusting any count. (a) samples.requests[0].values.description is non-empty and formResponses._manyrequests.fields carries the intake answers; if the briefs and comments are missing the detail reads are not landing and a named warning will say which request and what shape came back. (b) skipped.organisations holds no "the name map expects a D1 organisation" refusal; all 15 hand-mapped names must resolve. (c) skipped.invoices, for the possible-duplicate refusals against the Xero and Stripe rows already in D1: settle those against Xero by hand and stamp manyrequests_id on the survivor before running the invoices entity at all. (d) warnings, for read failures and the mail probe. Expect a MAIL PROBE DEGRADED warning until migration 0094 (email_suppressions, sibling slice) lands; mailSilent then rests on the notification count alone and mailWitnesses says so.
STEP 3: apply staging, then repeat 1 to 3 on production behind the manual GitHub environment approval.
STEP 4, WALK REQUESTS AND MESSAGES IN WINDOWS: 329 sequential upstream GETs does not fit Cloudflare's ~100s edge budget. Run {"entities":["requests"],"requestDetailOffset":0,"requestDetailLimit":100}, then offset 100, 200, 300, then the same four for ["messages"]. Every window is idempotent, so a repeated or overlapping window updates rather than duplicates, and a window that times out is re-runnable as-is.
STEP 5, AFTER CUTOVER: the import is ONE WAY. A second apply overwrites title, status, priority, assignee, due date, description and contact email from ManyRequests. Once the studio starts working requests in the dashboard, run only with entities limited to messages.
CLEANUP runs after the import has landed and been eyeballed, never before. Its GET is now super-admin only too. A hard delete is refused if the organisation holds a single row in any protected table, and the dry run lists every table still holding rows so the residue is visible before anyone says yes.
BOTH MCP TOOLS ANSWER 403 under the service token, by design; drive both endpoints from the dashboard as a super admin.

## What the dry run must show before anyone trusts a count

1. samples.requests[0].values.description is non-empty and formResponses._manyrequests.fields carries the intake answers; otherwise the detail reads are not landing and a named warning says which request and what shape came back.
2. skipped.organisations holds no "the name map expects a D1 organisation" refusal; all 15 hand-mapped names resolve.
3. skipped.invoices lists the possible-duplicate refusals against the Xero and Stripe rows already in D1; settle those by hand and stamp manyrequests_id on the survivor before running the invoices entity at all.
4. warnings: read failures and the mail probe. mailSilent must be true with zero email_suppressions rows attributable to the run.

## Cleanup, after the import has landed and been eyeballed

SEQUENCING: archive first, hard-delete only after the import has landed and been eyeballed. Nothing in this plan should run before the import, because several of the rows being cleaned up are the merge targets for imported data.

PHASE A, ARCHIVE THE DUMMY LIST (reversible, do this first). UPDATE organisations SET status='archived' for the 10 dummy orgs, and add a marker so they can be found again: they are Acme Corp (d753f180), Beta Labs (b4e26e39), Gamma Design (9ee08285), Lifecycle Test Co (b160a626), Pp (2d97e532), Tahi Studio (4150d15f), Tahi Studio (77da2c11), and the three zero-invoice Evan Kwan rows (c4ed4811, 2859abca, fbab8478). Seven of these are already archived, so this is mostly a labelling pass. Do NOT archive Tahi Test Client (d468fd7e, the QA org, explicitly keep) or Tahi Studio (internal) (org_tahi, the studio marker).

PHASE B, HARD-DELETE ONLY UNAMBIGUOUS E2E FIXTURES. The only rows that meet "unambiguous" are the ones whose contact emails are on reserved example domains or whose titles are self-labelled test artifacts, AND which have zero external links and zero invoices:
- Acme Corp (d753f180): 8 requests, 2 messages, 2 contacts @acme.example.com. Delete children then the org.
- Beta Labs (b4e26e39): 3 requests, 2 contacts @betalabs.example.com.
- Gamma Design (9ee08285): 1 request, 2 contacts @gammadesign.example.com.
- Lifecycle Test Co (b160a626): 1 'retret' request, 1 contact.
- Pp (2d97e532): 1 'retret' request, 1 message, 1 contact.
- Tahi Studio (4150d15f) and Tahi Studio (77da2c11): 2 junk requests, 6 messages, 2 duplicate business@tahi.studio contacts.
- The three zero-invoice Evan Kwan orgs (c4ed4811, 2859abca, fbab8478).
- The two archived Giant Group requests titled 'ZZ spine-test request (delete me)' and 'ZZ qa-spine engagement test (delete me)': delete the requests, KEEP the org (real client, 4 Xero invoices, 2000 MRR).
- The junk requests on real orgs: Physitrack's 'test' (b92b9f2f) and St Stephen's 'dsfsd' (2f1cefe1). Delete the requests, keep the orgs.
- The TWO orphaned requests whose org_id joins to no organisation. Identify them by id first, then delete.
That is 8 orgs and roughly 20 requests. Delete children in order (messages, request_participants, request_reads, time_entries, tasks, then requests, then contacts, then the org) because there are no cascading foreign keys.

PHASE C, DO NOT DELETE, MERGE INSTEAD. Every row in the uncertain list holds a real Stripe or Xero invoice, and the memory rule is explicit that clients, contacts, invoices and finance are always real. Re-point invoices.org_id and then archive the shell:
- Evan Kwan bf63ad35 (1 inv), b6fcb882 (1 inv), c79a6dcf (9 inv) -> Physitrack (b92b9f2f). 11 invoices moved.
- Ali Okumusoglu 49e55e59 (1), 76805cff (1), 80bc115a (5) -> DANTE MEDIA OU (731322e6). 7 invoices moved.
- Steve Stuart 73b0729f (1) -> Greyhive (ad862c09).
- Christian Burton fae58d04 (2) -> The Longevity Edit (22feff3e).
- Charles Bilash (DUPLICATE, do not use) 30eb921b (1 Xero inv) -> Charles Bilash (fa38bb6a).
- The three invoice-number-named orgs INV-2025000008 (2 inv), INV-2025000015 (2 inv), INV-2026000027 (4 inv): resolve each Stripe customer id to the human it belongs to, re-point the 8 invoices, then delete the shells. cus_SU7Kgl4TPhaSZG, cus_SinCtgIC8Zk4F3 and cus_U69NtPKIj60U0K need a Stripe lookup Liam should sanity-check.
- Tara Winery 22f584a1 (prospect, 2 contacts) + 2c4d26bd (active, 0 contacts): keep the active one, move the contacts, archive the other.
- Tevalis 4dc141a7 (prospect, 7 contacts with the rich hand-written stakeholder notes) + cd29d3e5 (archived, 2 contacts): keep 4dc141a7, it holds the real CRM prose. Move anything from cd29d3e5, then archive.
- Acme Widgets Test (ee8e83b6, 6 Stripe invoices) and 'test manual' (6f4a0ece, 1 Stripe invoice): PARK. Both names say test, both hold Stripe invoices. Ask Liam whether these are Stripe test-mode customers before deleting; if they are test-mode, the invoices are fake and the whole row goes, which would also mean the Stripe importer is pulling from the wrong mode.
- Emusio (22c7b584): park, no evidence either way.

PHASE D, DEMO CONTENT ON REAL ORGS. Per the standing rule that pipeline, clients, contacts, invoices, finance and docs are real while tasks, requests, messages, time and calls are demo and free to wipe: wipe the 6 tasks and 2 task_subtasks, the 11 time_entries, the 14 conversations, the 27 notifications, the 1 file row, the 1 scheduled_call, and the 27 request_participants rows that hang off deleted requests. Keep all 269 leads, 31 deals, 66 discovery_calls, 376 people, 4 proposals, 5 project_schedules, 124 invoices and 139 invoice_items: that is the pipeline and finance data the rule protects. Keep the 17 tracks only if they are attached to a surviving org. Note the 11 D1 messages are all on dummy orgs (Acme Corp 2, Pp 1, Physitrack 2, Tahi Studio 6) so the messages table effectively empties, which is fine because the import refills it from ManyRequests.

PHASE E, TEAM ROSTER. Delete the two invented team_members rows, Sarah Chen <sarah@tahi.studio> (has an already-ended viewer role assignment to remove first) and James Park <james@tahi.studio> (no role rows). Both violate the standing rule against inventing team members. Rename 'Staci Orchard' to 'Staci Bonnie'. Neither deletion touches Clerk, because neither row has a clerk_user_id.

PHASE F, VERIFY. Re-count organisations (expect 59 minus 8 hard-deleted minus roughly 12 merged-and-archived, plus 4 new from the import), confirm no invoice lost its org_id, confirm every surviving invoice's org still exists, and confirm zero contacts gained a clerk_user_id. Take a D1 export before Phase B and keep it until Liam has looked at the result.

## Reconciliation (read-only, 6 Sep 2026)

### Summary

Read-only reconciliation complete. Nothing was written to D1 or ManyRequests, no email or invite was sent, no browser was used. ManyRequests holds 20 organizations, 44 active client users (plus at least one soft-deleted one still referenced by requests: "Suzy Toth" at Glasswall), 329 requests, 20 invoices, 18 services and 3 brands (all on Physitrack Group). D1 holds 59 organisations, 43 contacts, 35 requests, 11 messages, 124 invoices, 139 invoice items, 9 subscriptions and 4 team members. The two systems barely overlap: D1's 124 invoices all came from the Xero and Stripe importers, not from ManyRequests, and D1's 35 requests are almost entirely seed/junk (Acme Corp, Beta Labs, Gamma Design, "retret", "dsfsd", "ZZ ... delete me") except an 11-row Stride set that was hand-entered and now duplicates 11 real ManyRequests requests. There is NO external-id column anywhere in D1 (no manyrequestsId, externalId or sourceId on any of the 114 tables), so the import has no idempotency key today and must add one before it runs. The biggest safety finding: POST /api/admin/clients emails a portal invite by default (body.sendInvite !== false), and three routes call the Resend REST endpoint directly rather than through lib/email.ts, so an importer that goes through the API layer would mail real clients and a "stub out lib/email.ts" mitigation would not catch all of them. The importer must write rows directly to D1 and touch no route. Team roster: D1 has Liam Miller (super_admin, Clerk-linked) and "Staci Orchard" (super_admin, no Clerk link) plus two invented members (Sarah Chen, James Park) that violate the "don't invent team members" rule; Nathan Day is missing from D1 entirely even though he is a ManyRequests team member and the author of most recent client-facing comments. Staci's name is wrong in D1 (should be Staci Bonnie per the naming decision).

### ManyRequests side

**orgs**

20

**clients**

44

**requests**

329

**invoices**

20

**services**

18

**brands**

3

**notes**

Fully paginated, every list returned has_more=false at the end.

ORGANIZATIONS (20, id / name / owner / members / brands / subscriptions):
3 Glasswall / Jake Bussell jbussell@glasswall.com / 2 (Sara Scerbo sscerbo@glasswall.com) / 0 brands / 1 active 'Glasswall Custom Retainer' 15h monthly, billed member 'Suzy Toth' (a client no longer in the roster); balance 15h remaining of 21 purchased.
4 Greyhive / Steve Stuart steve@greyhive.co.uk / 1 / 0 / 1 active + 1 canceled 'Greyhive Custom Retainer' 20h monthly; balance 20h of 102.
5 Physitrack Group / Evan Kwan evan.kwan@physitrack.com / 10 (Michal Ferfecki, Anu Paavilainen ap@, James Haggarty, Katri Malm km@, Andreea Maris, Ann Rapa, Lukasz Oniszczuk, Kevin Kaminyar, Caroline Fredriksson caroline@championhealth.se) / 3 brands (Physitrack, Champion Health, Champion Health Nordics) / 3x canceled 'Physitrack Custom Retainer' 25h monthly; balance -22.65h (overdrawn).
6 Dante Media / Ali Okumusoglu hello@dantemedia.eu / 1 / 0 / 1 active + 2 canceled 'Dante Media Custom Retainer' 10h monthly EUR 500; balance 10h of 48.
7 Elevate / Andrew Stout andrew.stout@elevate.uk / 11 (Rhodri Lloyd rhodri.lloyd@clicky.co.uk, Shannon shannon@clicky.co.uk, Tim Lyons tim.lyons00@gmail.com, Ciara Belt hello@ciarabelt.co.uk, Selina Deeney, Ella Wilde, Alistair Adams a@elevate.uk, Hannah O'Rourke hannah@hannahorourke.com, Jo Yarnall, Gill Marcucci) / 0 brands / 1 active 'Elevate custom hourly' 100h monthly; balance 98.13h remaining, expires 2026-10-01.
10 BCS Consultancy / Anna Rantala anna.rantala@bcsconsultancy.com / 2 (Nathalie Jones) / 0 / no subscription; balance -18.9h.
11 ISG / Hannah Stapleton Hannah.Stapleton@isg-one.com / 1 / 0 / none; balance -1.51h.
17 Axis Creative / Derreck Landon Yourfriends@fivepines.live / 2 (Drake drake@axiscreative.co) / 0 / none.
18 Blank Space Inc / Saif Al-Janabi saif@blankspaceinc.ca / 1 / 0 / none; balance -6.57h.
24 Equip2 / Anthony Capper anthony@equip2.co.nz / 2 (Anneke Evans anneke@equip2.com) / 0 / none.
31 the kreative duo / Stefan Keglic thekreativeduo011@gmail.com / 1 / 0 / none.
46 SA Design's Organization / SA Design sa_design@outlook.de / 0 members / 0 / none. Empty self-signup, junk.
47 Spot Digital / Rose McLeod rose@spotdigital.co.nz / 1 / 0 / none.
48 Stride / Jim Prothe jprothe@stride.build / 2 (Kira Karapetian kkarapetian@stride.build) / 0 / none; balance -10.25h.
49 Tahi Studio / Tahi Studio tasks@tahi.studio / 1 / 0 / none; balance -2h. This is the studio's own client account.
50 Racquet Club / Victoria Hamilton victoria@racquetclub.com.au / 1 / 0 / none.
52 Fluvial / Viachaslau Karatkou slavakaratkov@gmail.com / 1 / 0 / none.
53 The Longevity Edit / Christian B CEB@cebcam.com / 1 / 0 / none.
54 Giant Group / Mickey Day Michael.day@giantgroup.com / 2 (Mark Ramsey mark.ramsey@giantgroup.com) / 0 / none.
55 Real Estate Platform / Charles Bilash charles@charlesbilash.com / 1 / 0 / none.

REQUESTS (329 total, fully paginated over 14 pages). Status vocabulary in use with counts: 15 open (5 Submitted, 5 In progress, 4 Awaiting Approval, 1 On hold) and 314 Completed or Closed (roughly 280 Completed / 34 Closed, approximate: exact split needs a per-row tally the list endpoint does not aggregate). 'Pending response' and 'Queued' exist in the portal vocabulary but no request currently sits in either. 90 of the 329 requests have number=null (the older pre-numbering rows, ids 3 to 91); the rest carry numbers 1 to 257.
The 15 open ones: 348 Form adding to the Managed LAN and Wifi page (Ella Wilde), 346 Schema + internal linking for pricing article and pillar page (Kira Karapetian), 344 Contact page hours/SLA block + schema (Kira), 343 Semantic structure pass (Kira), 334 Create tasks for design + dev (Mickey Day) [all Submitted]; 294 Chewing the Channel podcast landing page (Ciara Belt), 347 Custom Redirects (Jo Yarnall), 327 Downtime calculator landing page (Ella Wilde), 318 Wireframes (Charles Bilash), 317 Design directions (Charles Bilash) [In progress]; 297 Further pages to split out the News page (Ella Wilde), 328 Backup whitepaper gated content page (Ella Wilde), 331 Inconsistent font hierarchy on pages (Ella Wilde), 330 Roll out Salesforce Live Chat (Andrew Stout) [Awaiting Approval]; 332 Footer button with relevant links depending on page (Ella Wilde) [On hold].
Volume is heavily concentrated: Elevate (Andrew Stout, Ella Wilde, Jo Yarnall, Gill Marcucci, Selina Deeney, Tim Lyons, Alistair Adams, Ciara Belt) is roughly half the corpus, then Physitrack Group (Evan Kwan, Kevin Kaminyar, Katri Malm, Andreea Maris, Anu Paavilainen, Lukasz Oniszczuk, Caroline Fredriksson), Glasswall (Suzy Toth, Sara Scerbo), BCS Consultancy (Anna Rantala) and Stride (Jim Prothe, Kira Karapetian).
The list endpoint returns id, number, title, status, priority, client, service, due_date, url only. created_at, assignees, tags, brand, the brief and the comment count come only from get_request per row, so a full field-complete export is 329 get_request calls. Sampled request 347 to confirm the shape: description is null and the actual brief lives in fields[] as a 'Description and supporting links/information' textarea; assignees are NAMES only ('Liam Miller', 'Nathan Day'), never ids or emails; comments carry author name, content (HTML-entity escaped, e.g. That&#039;s), is_internal, created_at and NO id; comments_total is separate and only the 10 most recent are returned, so anything over 10 needs find_activity; hours carries time_estimate_hours, tracked_hours and member_estimates.

INVOICES (20 total, no drafts: a status=draft query returns empty). 19 paid, 1 pending. By org: Fluvial 5 (INV-2026000030/29/27/26/25, USD 500 each, all paid), Physitrack Group 4 (INV-2025000022/20/17/11, GBP 3125 each, paid), Dante Media 4 (INV-2025000021/19/12/03, EUR 500 each, paid), Axis Creative 2 (INV-2025000023/06, USD 1500, paid), Blank Space Inc 2 (INV-2025000015/05, USD 375, paid), ISG 2 (INV-2025000008 USD 4030, INV-2025000002 USD 4250, paid), Greyhive 1 (INV-2025000024, GBP 1279.67, PENDING, raised 2025-12-27, still unpaid). Line items shape confirmed on INV-2025000024: line_items[{name, quantity, unit_price, subtotal}] = 'Webflow services' 1 x 1150 and 'Late Fee' 1 x 129.67; plus taxes[] (empty here), subtotal, discount, taxes_amount. There is no due_date on the MCP invoice shape; the REST v1 endpoint may expose one.

SERVICES (18): recurring plans 2 Webflow Development (USD 3200/8640/30720), 3 Growth Design & Dev (USD 4500/12150/43200), 9 Web & Graphic Design (USD 2800/7560/26880), 30 Webflow Development Plan (NZD 5300/14310/50880), 31 Total Webflow Plan (NZD 7500/20250/72000), 32 Web & Graphic Design Plan (NZD 4650/12555/44640), plus per-client custom retainers 5 Glasswall (GBP 1000/mo, 15h), 7 Dante Media (EUR 500/mo, 10h), 8 Physitrack (GBP, 25h, no priced variation), 14 Elevate custom hourly (USD, no priced variation). One-off: 11 25 Flexible Webflow Hours USD 2500, 12 50 hours USD 4500, 13 100 hours USD 8000, 27 Custom Project USD 0, 28 Free Site Audit USD 0, 33 Essential Brand Identity Refresh USD 1350, 34 Comprehensive Brand Identity Overhaul USD 2400, 35 Single Custom Lottie Animation USD 800. All published, none draft. Only services 2, 3 and 9 are is_for_sale.

BRANDS: 3, all on Physitrack Group (id 1 Physitrack, 2 Champion Health, 3 Champion Health Nordics). Every other organization has 0.

TEAM MEMBERS in the portal: Liam Miller hello@liammiller.dev (id 1), Nathan Day nathan@tahi.studio (id 83), Staci Bonnie Staci@tahi.studio (id 19). No tags are defined in the portal.

REST API surface (from workers/mcp-server/src/index.ts, for the importer): base https://tahistudio.manyrequests.com/api/v1, Bearer MANYREQUESTS_API_TOKEN (worker secret only, NOT in this repo, so a local importer needs it supplied). Endpoints wired: /clients, /clients/{id}, /invoices, /invoices/{uid}, /organizations, /organizations/{id}, /organizations/{id}/brands[/{brandId}], /organizations/{id}/members, /organizations/{id}/services. Pagination is page + per_page with an arbitrary query passthrough.

### D1 side

**orgs**

59

**realOrgs**

- AI Friction Labs (a7bb8f16) : xeroContactId set, 1 Xero invoice. No ManyRequests counterpart.
- Assertio (7a745594) : xeroContactId set, 8 Xero invoices, 2 contacts (bharat@assertio.co.nz, duplicated).
- Axis Creative (ed2ce0d9) : stripeCustomerId cus_T0maTvBsYzsAK7, 2 Stripe invoices, status churned. Matches MR org 17.
- BCS Consultancy (667934d8) : xeroContactId, 8 Xero invoices, customMrr 500, billingModel retainer. Matches MR org 10. Zero contacts in D1: all 2 members must come from MR.
- Charles Bilash (fa38bb6a) : billingModel project, 2 contacts. Matches MR org 55 Real Estate Platform.
- Charles Bilash (DUPLICATE, do not use) (30eb921b) : archived but holds xeroContactId and 1 real Xero invoice. Merge into fa38bb6a, do not delete.
- Christian Burton (fae58d04) : stripeCustomerId cus_UMAPooq7WKMRl7, 2 Stripe invoices. Same human as MR org 53 The Longevity Edit; merge.
- DANTE MEDIA OU (731322e6) : xeroContactId, 5 Xero invoices, archived. Matches MR org 6.
- Fluvial (4668ffd6) : xeroContactId, 6 invoices (3 Xero 3 Stripe). Matches MR org 52.
- Giant Group (aa80a2d6) : xeroContactId, 4 Xero invoices, customMrr 2000, scale/retainer. Matches MR org 54. Carries 2 archived 'ZZ ... (delete me)' spine-test requests.
- Glasswall Solutions Ltd (ea4903bc) : xeroContactId, 14 Xero invoices, customMrr 1250, retainer. Matches MR org 3.
- Greyhive (ad862c09) : archived in D1 with no links, but MR org 4 has an ACTIVE 20h retainer and an unpaid GBP 1279.67 invoice. Status is wrong, re-open on import.
- Physitrack (b92b9f2f) : xeroContactId + stripeCustomerId, 6 Xero invoices, customMrr 3125, churned. Matches MR org 5. Carries 1 'test' request and 2 messages.
- Racquet Club (5298982c) : xeroContactId, 3 Xero invoices. Matches MR org 50.
- Spot Digital (aa973554) : xeroContactId, 2 Xero invoices. Matches MR org 47.
- Stride (b31a11f5) : xeroContactId, 8 Xero invoices, 11 requests. Matches MR org 48. Those 11 requests are hand-typed duplicates of MR requests 335 to 346.
- Telcom Networks Limited trading as Elevate (5d139669) : xeroContactId, 14 Xero invoices, customMrr 1000, retainer. Matches MR org 7 Elevate. Its ONE contact is 'Andrew Stout <andrew@test.com>', a fake address on a real org: must be replaced by the 11 real MR members.
- The Longevity Edit (22feff3e) : matches MR org 53. No external links; the Stripe side is the separate 'Christian Burton' row.
- Mike Kentz (9b9ef64a) : stripeCustomerId cus_UJOjgVRkapnzZI, 5 real Stripe invoices. Real payer with no MR organization.
- Alumni Capital (e26d7d30) : launch, 2 duplicate contacts team@alumnicapital.com. Real prospect.
- Avery Cox (Tattoo Expo Platform) (8cc95f41) : launch, 2 duplicate contacts coxavery63@gmail.com. Real prospect.
- Happy Monday (0b69a8bf) : 2 duplicate contacts anj@happymonday.co.nz. Real prospect.
- IKON VAULT (e078dc55) : launch, 2 duplicate contacts samdeluca@theikonvault.com. Real prospect.
- ILFP Legal Partners LLC (785aef20) : 1 contact cedric.borer@ilfp.ch. Real prospect.
- ISO Certification Experts (a98728b6) : prospect/scale, erica@isocertificationexperts.com.au. Real prospect.
- Lingorama (e7d560e6) : prospect, Frederic@lingorama.com, created 2026-09-05. Real prospect.
- ProfitableLO (9c03db37) : launch, 2 duplicate contacts hello@profitablelo.com. Real prospect.
- SafeRec (be245c1a) : 2 duplicate contacts holly.spiers@saferec.co.uk. Real prospect.
- Tara Winery (2c4d26bd) : active/launch, no contacts. Real prospect, duplicate pair with 22f584a1.
- Tara Winery (22f584a1) : prospect/launch, 2 duplicate contacts tarawinery@gmail.com. Merge with 2c4d26bd.
- Tevalis (cd29d3e5) : archived/scale, 2 contacts. Real lost prospect, duplicate pair with 4dc141a7.
- Tevalis (4dc141a7) : prospect/scale, 7 contacts with rich hand-written role notes (Jocelyn de Goey, James Humble, Mickey Day, Anthony Hill, Hira Cross, N. Steele). Highest-value CRM prose in the table, merge target.
- iTANZ / Integration Xperts ANZ (24c6d477) : 1 contact ahmed.bilal@itanzgroup.com. Real prospect.
- Tahi Studio (internal) (org_tahi) : status 'internal', the studio marker org. Keep.
- Tahi Test Client (d468fd7e) : the QA org, 1 contact business+client@tahi.studio, 2 requests, 1 manual invoice. Keep per instruction.

**dummyOrgs**

- Acme Corp (d753f180) : archived, 8 requests ('fgfdh', 'Ysyhs', 'Test', 2x 'Smoke: hero copy pass'), 2 messages, contacts alice@acme.example.com and bob@acme.example.com. Seed.
- Beta Labs (b4e26e39) : archived, 3 requests, contacts carol@ and david@betalabs.example.com. Seed.
- Gamma Design (9ee08285) : archived, 1 request, contacts eva@ and frank@gammadesign.example.com. Seed.
- Lifecycle Test Co (b160a626) : archived, 1 'retret' request, jane@lifecycletest.com. e2e fixture.
- Pp (2d97e532) : archived/hourly, 1 'retret' request, 1 message, contact liamjmillernz@gmail.com. Junk.
- Tahi Studio (4150d15f) : archived, 2 junk requests ('retret', 'second test'), 6 messages, 1 contact business@tahi.studio. Internal scratch org.
- Tahi Studio (77da2c11) : archived, empty except 1 duplicate business@tahi.studio contact. Internal scratch org.
- Evan Kwan (c4ed4811) : archived, stripeCustomerId cus_Sm4dmnkwzZp2Zn, ZERO invoices. Stripe-import duplicate of Physitrack.
- Evan Kwan (2859abca) : archived, same Stripe customer, ZERO invoices. Stripe-import duplicate.
- Evan Kwan (fbab8478) : archived, same Stripe customer, ZERO invoices. Stripe-import duplicate.

**uncertainOrgs**

- Acme Widgets Test (ee8e83b6) : name says test, created 2026-09-05, but holds stripeCustomerId cus_Umg4sMjWGzkulh and 6 Stripe invoices. Likely a Stripe test-mode customer that the importer treated as live. Needs Liam to confirm the Stripe mode before deleting.
- test manual (6f4a0ece) : archived, stripeCustomerId cus_UEuPbDrBqygNwg, 1 Stripe invoice. Same question.
- INV-2025000008 (26bdb305) : an organisation NAMED after a ManyRequests invoice number, stripeCustomerId cus_SU7Kgl4TPhaSZG, 2 Stripe invoices. Import bug artifact holding real payment rows.
- INV-2025000015 (aaa7e396) : same pattern, cus_SinCtgIC8Zk4F3, 2 Stripe invoices.
- INV-2026000027 (f8b5f588) : same pattern, cus_U69NtPKIj60U0K, 4 Stripe invoices. Note this collides with a real ManyRequests invoice number for Fluvial.
- Evan Kwan (bf63ad35) : 1 Stripe invoice. Merge into Physitrack rather than delete.
- Evan Kwan (b6fcb882) : 1 Stripe invoice. Merge into Physitrack.
- Evan Kwan (c79a6dcf) : 9 Stripe invoices. Merge into Physitrack.
- Ali Okumusoglu (49e55e59) : 1 Stripe invoice, cus_SbyMQu8xA643N5. Merge into DANTE MEDIA OU.
- Ali Okumusoglu (76805cff) : 1 Stripe invoice, same customer. Merge into DANTE MEDIA OU.
- Ali Okumusoglu (80bc115a) : 5 Stripe invoices, same customer. Merge into DANTE MEDIA OU.
- Steve Stuart (73b0729f) : 1 Stripe invoice, cus_SdrM21yV5cfbKd. Merge into Greyhive.
- Emusio (22c7b584) : active/launch, zero contacts, zero invoices, zero links, zero requests. No evidence either way.
- St Stephen's Anglican Church (2f1cefe1) : plausible real client name, zero contacts and zero links, its only content is a junk request titled 'dsfsd'. Org may be real, the request is not.

**notes**

Row counts: organisations 59, contacts 43, requests 35, messages 11, invoices 124, invoice_items 139, subscriptions 9, team_members 4, tasks 6, task_subtasks 2, time_entries 11, conversations 14, notifications 27, files 1, projects 0, tracks 17, deals 31, leads 269, contracts 0, proposals 4, project_schedules 5, announcements 0, automation_rules 0, onboarding_invites 1, scheduled_calls 1, discovery_calls 66, services 0, brands 0, roles 5, team_member_roles 3, request_participants 27, notification_preferences 0, voice_notes 0, people 376, message_reactions 0. 114 tables total.

No organisation has clerkOrgId set (all 59 are null) and no contact has clerkUserId set (all 43 null): nobody has ever been invited into the portal. That is the good news for the import, since createNotifications only writes a bell row when a Clerk id resolves, so a direct-write import cannot surface anything to a real person even by accident.

Invoice sources in D1: 79 xero, 44 stripe, 1 manual (the Tahi Test Client one). Zero from ManyRequests. Status distribution: 81 paid, 7 sent, 13 written_off, 6 draft (all NZD Xero). Currencies present: GBP 61, USD 34, NZD 16, EUR 12, AUD 1, all held in columns literally named amount_usd / total_usd / unit_price_usd alongside a `currency` column.

D1 requests (35) breakdown: 11 real-looking Stride rows that duplicate ManyRequests requests 335-346 by title, 2 Tahi Test Client QA rows, 2 archived Giant Group 'ZZ ... (delete me)' rows, and 20 seed/junk rows across Acme Corp, Beta Labs, Gamma Design, Lifecycle Test Co, Pp, Physitrack ('test'), St Stephen's ('dsfsd') and the two Tahi Studio scratch orgs. TWO requests have an org_id that joins to no organisation at all (orphans).

D1 contacts: 43 rows, but a systematic duplication pattern from the deal-to-client conversion means most real orgs carry the same person twice, once with portal_role='admin' and role=null and once with portal_role='member' and a role string (Alumni Capital, Assertio, Avery Cox, Charles Bilash, Happy Monday, IKON VAULT, ProfitableLO, SafeRec, Tara Winery, Tevalis Jocelyn de Goey x2 with case-differing emails, Tahi Studio x2). Deduplicate before importing more.

TEAM MEMBERS (4 rows, and this needs correcting):
- Liam Miller <business@tahi.studio>, role column 'admin', clerk_user_id user_3FIxghTGGdoGhO5MjRYHFgtzvd5, assigned the super_admin role in team_member_roles (active).
- 'Staci Orchard' <staci@tahi.studio>, role column 'admin', no clerk_user_id, assigned super_admin in team_member_roles (active). NAME IS WRONG: the naming decision is Staci Bonnie as the primary name with Miller as alternateName; 'Orchard' appears nowhere else.
- Sarah Chen <sarah@tahi.studio> 'Senior Designer' and James Park <james@tahi.studio> 'Full Stack Developer' are INVENTED seed rows. Sarah has an ENDED viewer role assignment; James has none. Both violate the standing rule not to invent team members.
- Nathan Day <nathan@tahi.studio> DOES NOT EXIST in D1, even though he is ManyRequests team member 83 and the author of most of the recent client-facing comments (request 347 alone has 4 of his replies). Requests cannot be attributed to him and message import will have nowhere to hang his authorship until he is created.

HOW super_admin IS REPRESENTED (lib/permissions.ts): NOT via team_members.role and NOT via team_members.roles (that column is '[]' for all four). It is a row in team_member_roles joining team_members to roles where roles.name = 'super_admin' and team_member_roles.ended_at IS NULL. The five seeded roles are role-super-admin, role-admin, role-project-manager, role-task-handler, role-viewer. Level resolution at lib/permissions.ts:413 is: super_admin if the role names include 'super_admin', else admin if they include 'admin', else team_member if there is any role at all, else admin for the MCP service token, else (no role anywhere in the workspace) admin as a fresh-install fallback. So Nathan added with no role assignment would land on team_member with an empty viewable-resource set, i.e. deny-all, unless the workspace has zero role assignments (it does not). To give Nathan the 'dev' role he needs a team_member_roles row pointing at role-task-handler (the closest existing role: 'Executes assigned work. Own tasks, comment on requests, log time') or a new 'developer' role; there is no 'dev' role in the roles table today.

### Field map

- ORGANISATIONS. ManyRequests organization -> D1 organisations. id -> NEW COLUMN manyrequests_id (integer or text, UNIQUE) : does not exist, must be added. name -> name. owner.name/owner.email -> the contacts row flagged is_primary=1 and portal_role='admin'. members_count -> derived, no column. created_at -> created_at. subscription_status (subscribed|paused|expiring|unsubscribed) -> status (active|active|active|churned) plus subscriptions.status. balance.hours -> NO COLUMN AT ALL: D1 has no hour-bank concept on organisations; tracks/customSmallTracks/customLargeTracks are a different model. Propose organisations.mr_hours_remaining REAL + mr_hours_purchased REAL, or accept the loss. Existing D1 columns with no ManyRequests source and which must be preserved on merge: clerk_org_id, xero_contact_id, stripe_customer_id, custom_mrr, custom_mrr_currency, billing_model, retainer_start_date, retainer_end_date, invoice_channel, payment_terms, health_status, health_note, onboarding_state, onboarding_loom_url, internal_notes, tags, accent_colour, preferred_currency, default_hourly_rate, tracks_mode.
- CONTACTS. ManyRequests client -> D1 contacts. id -> NEW COLUMN manyrequests_id (UNIQUE). name -> name. email -> email. organization -> org_id (resolved via organisations.manyrequests_id). created_at -> created_at. is_owner -> is_primary (1/0) and portal_role ('admin' for the owner, 'member' otherwise). NOT SET BY THE IMPORT: clerk_user_id must stay NULL (setting it is what makes bell rows resolve and is the one field that could later surface imported content to a real person), role, phone, person_id, last_login_at.
- REQUESTS. ManyRequests request -> D1 requests. id -> NEW COLUMN manyrequests_id (UNIQUE). number -> request_number (INTEGER, already exists; null for the 90 pre-numbering rows, leave null rather than renumbering). title -> title. The brief is NOT in `description`: it is fields[] entry labelled 'Description and supporting links/information' -> description, with the whole fields[] array also written verbatim to form_responses (TEXT JSON) so nothing is lost. due_date -> due_date. created_at -> created_at. service -> NO COLUMN: D1 `services` table exists but is empty and requests has no service_id. Propose requests.mr_service text (name) or seed the services table first. organization -> org_id. client -> submitted_by_id (a contacts.id) with submitted_by_type='contact'. assignees[] (NAMES ONLY) -> assignee_id, a single teamMembers.id: D1 supports ONE assignee, ManyRequests supports many (request 347 has Liam Miller and Nathan Day). Take the first and write the rest into request_participants, or lose them. brand -> brand_id, but D1 has BOTH an empty `brands` table and an organisations.brands TEXT JSON column: pick one before importing Physitrack's 3 brands. tags[] -> tags (TEXT JSON); the portal has zero tags defined so this is empty. rating -> NO COLUMN. hours.time_estimate_hours -> estimated_hours. hours.tracked_hours -> NO COLUMN on requests; belongs in time_entries. attachments -> files table plus an R2 fetch-and-reupload, out of scope for a first pass.
- REQUEST STATUS VOCABULARY. ManyRequests status (portal ids in brackets) -> D1 requests.status. 'Submitted' (1) -> submitted. 'In progress' (2) -> in_progress. 'Awaiting Approval' (9) -> client_review. 'Pending response' (3) -> on_hold (this is 'waiting on the client'; D1 has no waiting-on field yet, the polymorphic blockers / 'Waiting on' feature is still planned, so the reason is lost). 'On hold' (6) -> on_hold. 'Queued' (7) -> submitted with queue_order set (no rows currently). 'Completed' (4, is_completed) -> delivered, and set delivered_at from the last status change. 'Closed' (5, is_closed) -> AMBIGUOUS AND NEEDS LIAM'S RULING: is_closed is not is_completed, but reading the ~34 Closed titles (e.g. 'Partner Marketing Area', 'New Podcast Page', 'Physitrack site cleanup') most look like finished or abandoned work rather than cancellations. Default proposal: Closed -> cancelled, with the ~34 rows written to a review list rather than guessed. D1's 'in_review' status has no ManyRequests source and will simply be unused by the import.
- REQUEST PRIORITY. ManyRequests priority (low|medium|high|null) -> D1 requests.priority (default 'standard'). low -> low, medium -> standard, high -> high, null -> standard. Only 6 of 329 requests carry a priority at all.
- MESSAGES. ManyRequests request comment -> D1 messages. NO ID IS EXPOSED on the MCP comment shape (author, content, is_internal, created_at only), so either the REST v1 comment endpoint must be used to get one, or the idempotency key becomes the composite (request manyrequests_id, created_at, author name) hashed into messages.manyrequests_id : a NEW COLUMN either way. content -> body, after HTML-entity unescaping (the API returns That&#039;s and &quot;). is_internal -> is_internal (1/0), maps directly. created_at -> created_at. author (NAME ONLY) -> author_id + author_type: resolve 'Liam Miller', 'Nathan Day', 'Staci Bonnie' to team_members.id with author_type='team_member', everyone else to the org's contacts by name with author_type='contact'. Nathan has no team_members row yet, so he must be created FIRST or every one of his replies mis-attributes. request -> request_id, org -> org_id. conversation_id stays NULL (request threads do not need a conversations row). Note only the 10 most recent comments come back per request; anything with comments_total > 10 needs find_activity to complete.
- INVOICES. ManyRequests invoice -> D1 invoices. number -> NEW COLUMN manyrequests_id (the number IS the identifier here, e.g. INV-2025000024) UNIQUE. WARNING: three D1 organisations are literally NAMED after ManyRequests invoice numbers (INV-2025000008, INV-2025000015, INV-2026000027) from an earlier bad Stripe import, and INV-2026000027 is also a live Fluvial invoice number : do not key anything on name matching. status (draft|pending|paid|refunded|failed|in progress) -> D1 status (draft|sent|paid|written_off|written_off|sent). amount -> amount_usd AND total_usd (both columns are misnamed: they hold native-currency amounts and D1 already stores GBP/EUR/NZD/AUD in them). currency -> currency. subtotal -> amount_usd. discount -> discount_amount_usd. taxes_amount -> tax_amount_usd. created_at -> created_at. paid_at -> paid_at. payment_url -> NO COLUMN (stripe_hosted_invoice_url and xero_online_invoice_url exist but are rail-specific); propose invoices.mr_payment_url text, or leave it out since those links are bearer URLs anyone can open. source -> needs a NEW ENUM VALUE 'manyrequests' alongside manual|stripe|xero. organization -> org_id. No due_date is exposed by the MCP shape. sent_at, viewed_at, project_id, subscription_id, stripe_invoice_id, xero_invoice_id, airwallex_txn_id, reconciliation_status all stay NULL.
- INVOICE ITEMS. ManyRequests line_items[] -> D1 invoice_items. name -> description. quantity -> quantity. unit_price -> unit_price_usd (native currency, see above). subtotal -> total_usd. There is no per-line tax column in D1 and ManyRequests carries taxes[] at the invoice level, so a taxed invoice loses its line-level breakdown (all 20 current invoices have taxes[] empty, so this is theoretical today). No manyrequests_id needed if items are always deleted-and-reinserted with their parent, but add one for safety.
- SUBSCRIPTIONS / PLANS. ManyRequests organization subscription -> D1 subscriptions. NO ID IS EXPOSED (service name, status, billing_period, member, hours_per_period, credits_per_period, created_at only), so the key is (org manyrequests_id, service name, created_at) -> NEW COLUMN manyrequests_id. status (active|canceled) -> status (active|cancelled). billing_period (Monthly|Quarterly|Annually) -> billing_interval (monthly|quarterly|annually). created_at -> created_at and current_period_start. service name -> plan_type has to be invented: D1's plan_type vocabulary is none|launch|maintain|scale|hourly and ManyRequests sells 'Glasswall Custom Retainer', 'Elevate custom hourly', 'Growth (Design & Dev)' etc. Propose subscriptions.mr_service_name text plus a mapping table, and set plan_type to 'hourly' for the hour-bank retainers and 'scale'/'maintain' for the named plans. hours_per_period and credits_per_period have NO COLUMNS: propose subscriptions.hours_per_period real and credits_per_period real. member (who is billed) -> NO COLUMN: propose subscriptions.billed_contact_id. price and currency have NO COLUMNS on subscriptions at all (D1 keeps money on organisations.custom_mrr / custom_mrr_currency), so per-plan pricing has to be carried on the org or a new column added.
- SERVICES / PRICING. ManyRequests service -> D1 `services` table, which EXISTS but has ZERO rows and is not referenced by requests. Before importing requests that name a service, either seed all 18 services (id -> manyrequests_id, name, description, type one-off|recurring, status, currency, price, hours, credits, and pricing_variations[] into a JSON column or a child table) or accept services as a plain text label on requests. pricing_variations{id, price, billing_period, hours, credits, enabled} have no D1 home at all.
- BRANDS. ManyRequests organization brand -> D1 has TWO competing representations: a `brands` table (0 rows) and organisations.brands TEXT DEFAULT '[]'. requests.brand_id is a text column with no declared foreign key. Only Physitrack Group has brands (3). Pick the `brands` table (it is the one a brand_id can point at), add manyrequests_id to it, and treat organisations.brands as deprecated, or the three Physitrack brands will exist twice.
- MISSING EXTERNAL-ID COLUMNS, ALL OF THEM. A scan of all 114 D1 tables for manyrequest / many_request / external_id / externalId / source_id found NOTHING. Proposed migration (all with IF NOT EXISTS per the standing migration-safety rule): organisations.manyrequests_id integer UNIQUE; contacts.manyrequests_id integer UNIQUE; requests.manyrequests_id integer UNIQUE; messages.manyrequests_id text UNIQUE; invoices.manyrequests_id text UNIQUE; invoice_items.manyrequests_id text; subscriptions.manyrequests_id text UNIQUE; brands.manyrequests_id integer UNIQUE; services.manyrequests_id integer UNIQUE; team_members.manyrequests_id integer UNIQUE. UNIQUE is safe on every one of them because ManyRequests ids are stable and single-tenant; the only one where UNIQUE is risky is invoice_items, whose ids are not exposed.

### Every email or invite trigger the import bypasses

- lib/email.ts sendEmail() : the shared Resend wrapper. Silently no-ops when RESEND_API_KEY is unset and returns {success:false}, which is the ONLY global safety today. There is no EMAIL_ENABLED / DISABLE_EMAIL / DRY_RUN kill switch anywhere in the tree (grepped, zero hits). From address defaults to 'Tahi Studio <business@tahi.studio>' or RESEND_FROM_EMAIL.
- lib/notifications.ts createNotifications() line 213 : inserts bell rows AND, when the payload carries `shared.email`, calls sendNotificationEmails(). The doc comment is explicit that the email is NOT conditional on the bell insert landing, so a client org whose contacts have no Clerk login still gets mail. This is the single most dangerous function for an import. Its siblings createNotification(), createNotificationsForRecipient(), notifyTeamMember(), notifyMentionedPerson(), notifyAllAdmins() and notifyOrgContacts() are bell-only UNLESS an email plan is passed.
- lib/notification-email.ts sendNotificationEmails() / dispatchNotificationEmails() : the fan-out. Four wired event templates: threadReplyEmailPlan (studio replied on a request thread), clientStatusEmailPlan (client_review and delivered only), studioNewRequestEmailPlan (a client filed a request), and the mention path. One message per recipient, with rate-limit backoff.
- lib/request-status-effects.ts emitRequestStatusChanged() : notifies the assignee, then notifyOrgContacts() for every contact at the client org unless the request is internal or the status is in CLIENT_SILENT_STATUSES, and ATTACHES clientStatusEmailPlan when the new status is 'client_review' or 'delivered'. Called from app/api/admin/requests/[id]/route.ts (PATCH), app/api/admin/requests/bulk/route.ts and app/api/admin/tasks/[id]/promote/route.ts. Importing 314 Completed requests through the PATCH route would mail every contact at every client org twice over.
- lib/request-status-effects.ts emitRequestCreated() : no email itself, but fires dispatchDomainEvent('request_created'), which runs automation rules AND outgoing webhooks (lib/events.ts -> lib/webhooks.ts fireWebhook, HMAC-signed POSTs plus a webhook_deliveries row per attempt). automation_rules is currently empty (0 rows) so nothing would fire today, but that is a runtime accident, not a guarantee.
- app/api/admin/requests/[id]/messages/route.ts:301 : POST a studio reply attaches threadReplyEmailPlan and mails the client.
- app/api/portal/requests/[id]/messages/route.ts:127 : POST a client reply attaches threadReplyEmailPlan and mails the studio.
- app/api/portal/requests/route.ts:543 : POST a new portal request attaches studioNewRequestEmailPlan and mails the studio.
- app/api/admin/clients/route.ts:237 : POST /api/admin/clients MINTS AN INVITE TOKEN AND EMAILS IT BY DEFAULT. The gate is `if (body.sendInvite !== false)`, i.e. opt-out not opt-in, subject 'Your <Org> portal is ready'. Creating the four missing ManyRequests orgs through this route would email real clients an invite link.
- app/api/admin/clients/[id]/welcome-email/route.ts:136 : sends the welcome email on demand.
- app/api/admin/onboarding-invites/route.ts:181 : mints an onboarding invite and emails the link.
- app/api/admin/team/[id]/invite/route.ts:123 : clerk.organizations.createOrganizationInvitation() against NEXT_PUBLIC_TAHI_ORG_ID. Adding Nathan through this route would put a real Clerk invitation in his inbox.
- app/api/portal/invites/route.ts:109 : clerk.organizations.createOrganizationInvitation() for a client org.
- app/api/portal/people/route.ts:136 : clerk.organizations.createOrganizationInvitation() when a portal admin adds a colleague.
- app/api/admin/invoices/[id]/send-email/route.ts:274 : sends the invoice to every billing recipient, and on the Xero rail ALSO calls lib/xero-invoice-email.ts emailInvoiceFromXero(), which makes Xero send its own PDF. Two independent send paths on one call.
- lib/xero-invoice-email.ts : Xero's own Email endpoint. Guards on Xero's SentToContact flag plus our sentAt, but has no idempotency key of its own.
- app/api/admin/invoices/[id]/draft-chase/route.ts : AI-drafts a chase email. Drafts only, does not send, but feeds the ai-reply-drafts send route below.
- app/api/admin/contracts/[id]/email/route.ts:137 : resend.emails.send() direct, sends a contract for signature.
- app/api/admin/contracts/[id]/send/route.ts : the send action (delegates, no direct Resend call of its own).
- lib/contract-fully-signed-emails.ts:231 : resend.emails.send() direct, fans the countersigned PDF out to every signer.
- lib/announcement-emails.ts:139 : fans an announcement out to every eligible contact in batches of 20, one email each. Triggered from app/api/admin/announcements/route.ts:153 when body.sendEmail && body.publish are both true.
- app/api/admin/proposals/[id]/email/route.ts:94 : resend.emails.send() direct, sends a proposal link to a prospect.
- app/api/admin/schedules/[id]/email/route.ts:87 : resend.emails.send() direct, sends a project schedule to a client.
- app/api/admin/deals/[id]/nudges/route.ts:103 : BYPASSES lib/email.ts and fetches https://api.resend.com/emails directly. Sends a sales nudge to a lead.
- app/api/admin/billing/monthly-email/route.ts:136 : BYPASSES lib/email.ts, fetches https://api.resend.com/emails directly, monthly billing summary.
- app/api/admin/ai-reply-drafts/[id]/send/route.ts:129 : BYPASSES lib/email.ts, fetches https://api.resend.com/emails directly, sends an AI-drafted reply to a client and stores the Resend message id.
- app/api/admin/emails/preview/route.ts:179 : the template preview cannon. Sends EVERY template in one call. Two guards: the caller must resolve to super_admin (the MCP service token resolves to admin and is deliberately excluded) and the destination must end '@tahi.studio' (ALLOWED_DOMAIN at line 88). This is the one route that is already safe by construction for this session's constraint.
- app/api/portal/calls/route.ts:421 : booking confirmation to the client who booked.
- app/api/portal/enquiry/route.ts:122 : enquiry acknowledgement, plus clerkClient() use at line 45.
- app/api/admin/cron/pre-call-digest/route.ts:256 : resend.emails.send() direct, fires 25 to 35 minutes before each scheduled discovery call. Scheduled every 10 minutes by .github/workflows/dashboard-crons.yml. This one runs UNATTENDED and is the only mailing cron.
- app/api/webhooks/email-intake/route.ts : inbound only, imports mail into the dashboard, does not send.
- app/api/onboarding/complete/route.ts:73 and :354 : clerkClient() calls during self-serve org provisioning (creates orgs and memberships; verify before running anything near it).
- app/api/portal/provision/route.ts:44 and app/api/portal/checkout/route.ts:102 : clerkClient() org provisioning paths.
- lib/cron-runs.ts:73 and the crons at app/api/admin/cron/daily-summary (line 230), delivery-watch (line 43) and affiliate-reactivation (line 143) : these call createNotification WITHOUT an email plan, so they are bell-only. Safe, but only because no plan is attached; adding one later would silently make them mail.
- CRON SCHEDULE (.github/workflows/dashboard-crons.yml, fired by GitHub Actions against vars.TAHI_DASHBOARD_URL with secrets.TAHI_CRON_SECRET, NOT by Cloudflare cron triggers): pre-call-digest every 10 min (MAILS), auto-promote-calls every 15 min, sync-calendar every 15 min, sync-drive-transcripts every 30 min, publish-scheduled every 15 min, leads-ai daily 17:00 UTC, sync-xero + sync-stripe daily 15:00 UTC, daily-summary + ai-briefing + overview-brief 19:00 and 20:00 UTC, sync-airwallex + snapshot-metrics 18:00 UTC, affiliate-reactivation Mondays, finance-anomaly-scan Mondays + 1st, content-auto-backfill / content-gap-hunt / schema-watchdog / indexing-reverser Sundays. Only pre-call-digest sends mail. sync-xero and sync-stripe are the two that would race a running import over the invoices table.

### Risks

- POST /api/admin/clients emails a portal invite BY DEFAULT (app/api/admin/clients/route.ts:237, gate is `body.sendInvite !== false`, opt-out not opt-in). Creating the four missing ManyRequests orgs through the obvious route would put an invite link in a real client's inbox. This is the single highest-risk path and the reason the importer must write SQL directly.
- Three routes call https://api.resend.com/emails directly and do NOT go through lib/email.ts: app/api/admin/deals/[id]/nudges/route.ts:103, app/api/admin/billing/monthly-email/route.ts:136, app/api/admin/ai-reply-drafts/[id]/send/route.ts:129. Any mitigation phrased as 'stub or mock lib/email.ts' would miss all three. Only 'the importer imports nothing from app/' is sound.
- There is NO global email kill switch. Grepped for EMAIL_ENABLED, DISABLE_EMAIL, emailsEnabled and DRY_RUN across lib/ and app/: zero hits. The only accidental brake is that lib/email.ts returns early when RESEND_API_KEY is unset, and that brake does not cover the three direct-fetch routes above, which read process.env.RESEND_API_KEY themselves and would also short-circuit, or Clerk invitations, which do not read it at all.
- pre-call-digest runs UNATTENDED every 10 minutes (.github/workflows/dashboard-crons.yml) and sends real email via resend.emails.send at app/api/admin/cron/pre-call-digest/route.ts:256. It fires 25 to 35 minutes before each scheduled discovery call, deduped by call id. If the import or the cleanup creates or moves a discovery_calls or scheduled_calls row with a near-future time, this cron will mail whoever is on it. discovery_calls has 66 rows today. Do not touch that table during this work.
- PATCHing a request's status through app/api/admin/requests/[id]/route.ts calls emitRequestStatusChanged, which mails every contact at the client org whenever the new status is client_review or delivered. The import has 314 Completed or Closed requests to land. Through the API that is hundreds of emails to real clients; through direct SQL it is zero.
- emitRequestCreated fires dispatchDomainEvent, which runs automation rules and POSTs to every registered outgoing webhook (lib/webhooks.ts fireWebhook, HMAC-signed, one webhook_deliveries row per attempt). automation_rules is empty today (0 rows) so nothing fires, but that is a coincidence of current state, not a guarantee, and outgoing webhooks are a separate registry this reconciliation did not enumerate.
- D1 has NO external-id column on any of its 114 tables. Until the migration in Step 0 lands, the import has no idempotency key and a second run would duplicate all 329 requests, 44 contacts and 20 invoices. Do not let anyone run a 'quick partial import' before the migration.
- ManyRequests comments expose no id on the MCP shape (author name, content, is_internal, created_at only). Without an id from the REST endpoint the dedupe key is a composite hash, which is fragile if a comment is edited upstream. Two identical short replies from the same author in the same second would collide.
- ManyRequests assignees and comment authors are NAMES, not ids or emails. Name resolution is the weakest link in the whole import: 'Liam Miller', 'Nathan Day' and 'Staci Bonnie' are the only team names, everyone else is assumed to be a client contact, and a client whose display name happens to match a team member would be mis-attributed as studio staff on a client-visible thread.
- Nathan Day does not exist in D1 team_members. If messages import before he is created, every one of his client-facing replies (the majority of recent activity, e.g. 4 of the 8 comments on request 347) either fails to resolve or gets attributed to someone else. Team roster must be Step 1.
- D1 has no 'dev' role. roles holds only super_admin, admin, project_manager, task_handler and viewer, and lib/permissions.ts:413 denies by default for anyone with a role that grants no .view. Adding Nathan without a team_member_roles row leaves him on team_member with an empty viewable-resource set, i.e. locked out of everything.
- The 'Closed' status is genuinely ambiguous. ManyRequests marks it is_closed, not is_completed, but the ~34 titles read like finished or abandoned work rather than cancellations. Guessing wrong either shows clients ~34 cancelled requests that were actually delivered, or shows ~34 delivered ones that were dropped. This needs Liam's ruling, not a default.
- Three D1 organisations are literally NAMED after ManyRequests invoice numbers (INV-2025000008, INV-2025000015, INV-2026000027) from an earlier bad Stripe import, and INV-2026000027 is simultaneously a live Fluvial invoice number. Any matching or logging keyed on name will alias these.
- 'Acme Widgets Test' holds 6 Stripe invoices and 'test manual' holds 1. If those are Stripe test-mode customers then the Stripe importer is pulling from the wrong mode and some fraction of the 44 Stripe invoices in D1 are fake revenue feeding MRR and the finance reports. Worth checking regardless of the migration.
- 'Telcom Networks Limited trading as Elevate' (a real client with 14 Xero invoices and 1000 MRR) has exactly one contact whose email is andrew@test.com. If anything ever mails that org's contacts, it goes nowhere; if the address is ever corrected without care, it goes to Elevate's real marketing director.
- sync-xero and sync-stripe both fire at 15:00 UTC daily and both write the invoices table. Running the invoice import in that window risks interleaved writes on rows the reconcilers are also touching.
- D1 has two competing brand representations (an empty `brands` table and an organisations.brands TEXT JSON column) and requests.brand_id has no declared foreign key. Importing Physitrack's 3 brands into the wrong one silently orphans every brand-scoped request and, because notifyOrgContacts scopes by brandId, would change who a status change is shown to.
- The invoice money columns are named amount_usd, total_usd, tax_amount_usd, discount_amount_usd and unit_price_usd but already hold GBP, EUR, NZD and AUD alongside a separate currency column. Anything that reads them as USD is wrong today, and the ManyRequests import adds GBP 3125 and EUR 500 rows to the pile. Worth a separate look at whether the finance reports convert correctly.
- The 20 ManyRequests invoices are a historical ledger, not receivables, with one exception: Greyhive INV-2025000024, GBP 1279.67, pending since 2025-12-27. Importing it as 'sent' will make it appear in invoice aging and could trigger a chase draft. Land it deliberately and tell Liam it is there.
- Hour balances have no D1 home. Elevate's 98.13 remaining hours, Glasswall's 15, Greyhive's 20 and Dante Media's 10, plus the overdrawn Physitrack -22.65, BCS -18.9, Stride -10.25, Blank Space -6.57, ISG -1.51 and Tahi Studio -2, are all real commercial state that will silently vanish unless columns are added or the numbers are parked in internal_notes.
- The ManyRequests API token lives only in the worker's secret store (wrangler secret put MANYREQUESTS_API_TOKEN); it is not in this repo. A local importer needs it supplied out of band, and the standing note is that it is due for rotation.

## Importer review outcome

- BLOCKER upsert.ts:41 INSERT_BATCH vs D1's 100-parameter cap. MAX_BOUND_PARAMS=90 replaces the fixed 20. boundParamsPerRow(table, rows) reads Drizzle's own column map off Symbol(drizzle:Columns) and counts supplied columns plus the default-bearing ones Drizzle still binds (a $defaultFn uuid or a static default is a bound param even when the row omits it); insertBatchSize divides. Deletes chunk at 90. Two tests: synthetic columns in upsert.test.ts, and bound-params-real-schema.test.ts which imports db/schema.ts unmocked so a Drizzle rename fails there rather than in production.
- BLOCKER plan.ts:1220 stored XSS via imported comment bodies. Bodies now go through sanitizeRichText (a pure module, so the static no-mail guard still passes) and unescapeHtmlEntities no longer emits <, > or & in any form, numeric and hex escapes included. Test: an imported comment carrying both an escaped <img onerror> and a live <script> lands with the escape intact and the script gone.
- BLOCKER plan.ts:1367 planInvoices vs the 124 D1 invoices from the Xero and Stripe importers. findLedgerTwin matches a pre-existing key-less D1 invoice on orgId, currency and totalUsd (0.01 tolerance) inside INVOICE_DUPLICATE_WINDOW_DAYS=45, claims it once, and REFUSES the source row with both ids, both sources and the dates named. Line items for a refused invoice are not planned. Two tests: the refusal, and that a lookalike outside the window or at another client still inserts.
- IMPORTANT client.ts:182 single-resource envelope. New getOne unwraps a lone non-array `data` object and asserts the row carries the id or number asked for; a mismatch or a missing identity throws ManyRequestsShapeError, which run.ts's guard turns into a warning plus a fall back to the list summary. getRequest and getInvoice both route through it. Tests cover the unwrap, a wrapped detail read, an unrecognised shape, and a wrong id.
- IMPORTANT run.ts:235 / upsert.ts:340 write-error isolation. Every insert batch, every update and every delete is wrapped: the failure is pushed onto outcome.failures with its row label and the run continues. runImport catches per-entity throws, records a warning and returns the PARTIAL result instead of unwinding, and the route writes the audit row on the error path too. Tests: a failing insert records ten failures and inserts nothing, a failing update records the row, a thrown entity comes back as a partial result, and an apply that dies still writes an audit row.
- IMPORTANT plan.ts:1012 adoption maps consumed once. byOrgAndTitle and byEmail are now deleted on match and the claimant is remembered; a second source row hitting the same D1 row is refused by name instead of running a second UPDATE that silently drops the first. A contact adopted by key also leaves the email index. Tests for both entities.
- IMPORTANT run.ts:88 no way to resume. requestDetailOffset walks the request list in windows alongside requestDetailLimit, plumbed through RunImportOptions, the route body and the MCP tool. The warning names the next offset. The route docstring and migration 0093's runbook document the chunked procedure. Test asserts a window of {offset:4, limit:3} fetches exactly requests 5, 6 and 7.
- IMPORTANT plan.ts:650 CONTACT_EMAIL_REPLACEMENTS never fired. Renamed CONTACT_DEAD_EMAILS and re-keyed on the D1 address, which is where the fake lives. The by-email index registers a D1 row under BOTH its own address and the real ManyRequests one, so the source row finds it; the address written is always the ManyRequests one; and `email` joined CONTACT_UPDATABLE so adopting repairs the dead mailbox. The test at plan.test.ts now feeds the real ManyRequests address against a D1 row holding andrew@test.com and asserts an UPDATE with zero inserts.
- IMPORTANT upsert.ts:107 snapshot vs updatable mismatch. services.description added to the select, plus invoices.createdAt for the overlap check. New snapshot-shape.test.ts runs readImportSnapshot against a double that records the projection keys and fails on ANY updatable field missing from ANY table's select. Verified it catches the original bug by temporarily removing the column.
- IMPORTANT plan.ts:549 stale ORG_NAME_MATCHES silently inserted a second client. It now pushes a skipped row naming the D1 organisation it expected. Test asserts the refusal for a mapped key and that an unmapped org still inserts.
- IMPORTANT cleanup.ts:323 deleteOrgTree covered 8 of 29 org_id tables. ORG_SCOPED_TABLES lists all 29 with a delete/refuse policy; a static test derives the same list from db/schema.ts and fails if one is missing or spurious. The dry run now counts EVERY table holding rows for the org, a single row in any 'refuse' table (finance, pipeline, delivery artefacts, discovery_calls) refuses the delete and names it, and the sweep also clears conversation participants and chunks every inArray at 90.
- IMPORTANT no-mail-imports.test.ts:133 guard root set. walkGraph is parameterised; a second describe block roots it at the two route files with the @clerk and @/app/ prefixes relaxed (a route legitimately reads the session and lives under app/) and replaces them with a symbol scan for createNotifications, sendEmail, createInvitation, invitations. and api.resend.com. The walk is proved non-vacuous by asserting it reaches server-auth, permissions, audit and run.ts.
- IMPORTANT workers/mcp-server/src/index.ts:2784 tools that can only 403. Both descriptions now open with the 403, say it is the design rather than a misconfiguration, tell the model not to retry or report a permissions bug, and hand the operation to a super admin in the dashboard. The executeTool comment records why the tools are kept rather than dropped.
- MINOR route.ts:115 MANYREQUESTS_API_TOKEN runbook. Step 0 added to migration 0093's header and to the route docstring, with the staging and production wrangler commands and the .dev.vars line, and a pointer at GET tokenConfigured.
- MINOR route.ts:174 both GETs disclosed the allowlist and the credential state to any Tahi admin. Both now carry the same resolvePermissions isSuperAdmin gate as their POSTs, with a test each.
- MINOR cleanup.ts:461 applyWipeDemo overstated rowsDeleted. It now re-reads which planned request ids still carry a null manyrequests_id and counts those, so the audit metadata matches the database.
- MINOR run.ts:268 mailSilent read as two witnesses when it is one. New mailWitnesses field on ImportResult reports notifications and suppressions as live or unavailable plus a degraded flag, and the route pushes a MAIL PROBE DEGRADED warning. Test covers the warning.
- MINOR plan.ts:358 Staci's title. 'title' dropped from TEAM_UPDATABLE so her D1 Co-Founder title survives; titles still land on the INSERT path so Nathan gets one.
- MINOR plan.ts:930 the one-way rule. Stated in the route docstring and in the import_manyrequests tool description: ManyRequests is the source of truth until cutover, a second apply overwrites title, status, priority, assignee, due date, description and contact email, so after cutover run with entities limited to messages.
- MINOR cleanup.ts:330 unchunked inArray. ID_CHUNK=90 and chunkIds applied to every inArray in deleteOrgTree, planWipeDemo and applyWipeDemo.

**Skipped by the fixer, with reasons**

- {"id": "Operational halves of the client.ts and plan.ts findings (read the requests samples on the first dry run; verify all 15 ORG_NAME_MATCHES names resolve; assert request 347 carries formResponses._manyrequests.fields)", "reason": "These need a live ManyRequests credential and a real D1, and the brief forbids running against production or starting a dev server. Encoded instead as a four-step ordered checklist in the route docstring (commit 26025079) so the operator reads it in the place they are already looking, and each item is now machine-detectable in the response: a bad envelope raises a named warning, a stale mapping raises a named skip, an invoice overlap raises a named skip."}
- {"id": "Granting the MCP service token access to the import dry run", "reason": "The review offered dropping the tools or documenting the 403 as the alternatives, and widening the permission resolver or adding a service-token bypass to a route that rewrites clients, requests and the ledger is a security change outside a review-fix pass. Documented the 403 instead, which the review named as acceptable."}

**Deviations from the review advice**

- The invoice overlap fix is a REFUSAL, not an adoption. The review offered 'emit it as a possibleDuplicate skip carrying both row ids'; there is no separate possibleDuplicate channel on EntityPlan, so it lands on plan.skipped, which is the existing refusal channel and is already surfaced per entity in the response. The reason string names both ids, both sources, both dates and the remedy. The review's fallback advice (run the apply with entities excluding 'invoices' and settle by hand) is still the right first move and is now printed in the plan itself.
- The 45-day window is deliberately WIDER than a monthly retainer cycle, so adjacent months of the same recurring charge both refuse. That is intentional: a refusal costs one manual reconciliation, a false negative costs a doubled ledger nobody notices. If it proves too eager on the first dry run, INVOICE_DUPLICATE_WINDOW_DAYS is one exported constant.
- deleteOrgTree does not blindly delete all 29 org_id tables. The review offered 'either enumerate every org_id child table or narrow the comment and have the dry run report every table still holding rows'. I did both, split by policy: 17 'delete' tables are swept, 12 'refuse' tables (finance, pipeline, delivery artefacts, discovery_calls) refuse the delete outright and name themselves. discovery_calls in particular must never be touched at all, which a blanket sweep would have violated.
- ORG_SCOPED_TABLES is an explicit list checked by a static test that parses db/schema.ts, rather than runtime Drizzle introspection. getTableColumns cannot run under the existing cleanup test double, which mocks drizzle-orm wholesale; parsing the schema file gives the same 'a new table cannot be forgotten' guarantee without making the mock fragile.
- plan.test.ts's whole-run fixtures now start from seededSnapshot() rather than emptySnapshot(). The org planner refuses a stale ORG_NAME_MATCHES entry, so a fixture with no D1 organisations would refuse Glasswall and cascade into the contacts, requests and messages assertions. Seeding the row is also more faithful: all 15 mapped organisations exist in D1 today.
- 'title' was dropped from TEAM_UPDATABLE rather than changing Staci's seed to Co-Founder. Both were offered; dropping it is the same rule that keeps organisations.name out of ORG_UPDATABLE, so the import cannot rewrite a D1-native title for anyone, not just her.
- Request descriptions are NOT wrapped in sanitizeRichText, only message bodies. rich-brief.tsx sanitizes at render, the review confirmed briefs are safe, and unescapeHtmlEntities no longer produces markup on any path, so the remaining exposure was messages alone. Kept the change to the surface the finding named.
- Two commits rather than one: 0fb49ce9 is the review fixes with the requested subject, 26025079 adds the first-dry-run checklist to the route docstring. Both carry the required trailer.

**Checks**

npm run type-check: zero errors. npm run lint: zero errors (only pre-existing warnings in unrelated files; nothing in lib/import, app/api/admin/import or workers). npx vitest run: 189 files / 3040 tests passing, up from 186 / 2998 (three new test files, 42 new tests). npx tsc --noEmit -p workers/mcp-server/tsconfig.json: clean. npm run build: compiled successfully. All five re-run after the final docstring commit. Not pushed. Nothing was deployed, no route was called, no database was touched, and no mail, invite or notification path was exercised.

**Notes**

The hard rule held throughout: nothing was run, no route was called, no mail, invite or notification path was exercised, and the only credential-bearing work was reading source files. The static guard is now stronger than it was, because it covers the reachable graph of both endpoints rather than the library alone, and it bans the mail and invitation CALLS by name in that graph rather than only the modules they would come from.

Three properties are now pinned by tests that would have caught the original bugs rather than by comment. bound-params-real-schema.test.ts imports db/schema.ts unmocked and asserts a requests-shaped batch stays under 90 bound values, so if Drizzle moves its column map the fallback to row width fails there instead of on the first production apply. snapshot-shape.test.ts runs readImportSnapshot against a recording double and compares the real projection keys against every *_UPDATABLE list, which is a class-level fix rather than a fix to services.description alone; I verified it fails when the column is removed. The org_id completeness test parses db/schema.ts, so a new org-scoped table added later breaks the build rather than silently orphaning rows.

Two things worth a second look before the apply. The invoice overlap window is deliberately eager and may refuse most or all 20 source invoices on a client with a repeating monthly charge; that matches the review's own advice to settle the overlap by hand, and the constant is exported if it needs loosening. And getOne now throws on a detail payload whose id disagrees or is absent, which means that if the ManyRequests detail shape is not what this client expects, the first dry run produces up to 329 warnings and every request falls back to its list summary. That is loud on purpose: it is the difference between "this client has no comments" and "the envelope was never unwrapped", which the review correctly called the least-proven path on the branch.
