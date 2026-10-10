# Stripe live webhook investigation, 2026-10-10

## Finding

The endpoint is reachable and rejects deliveries at signature verification,
before invoice or subscription handling. The leading cause is a signing secret
that does not match this live endpoint (including possible pasted whitespace).
The exact deployed secret has not been compared, so this is a diagnosis to
verify, not a completed fix. TASKS.md SW.0 tracks restoration; SW.1 tracks
recovery of missing data.

## Evidence

- Stripe live account: acct_1RMmvjRx4rjcHALL. Destination:
  https://dashboard.stripe.com/acct_1RMmvjRx4rjcHALL/workbench/webhooks/we_1TLwhCRx4rjcHALLRYDFBdan
- Destination URL: https://portal.tahi.studio/api/webhooks/stripe. Active,
  listening to eight events, API version 2025-04-30.basil.
- This week's view showed 14 failed delivery attempts, all HTTP 400 with
  "Webhook signature verification failed", before our diagnostic retry.
- Retried invoice.payment_succeeded (evt_1UMuaBRx4rjcHALL3v2Svc0u), which the
  current handler ignores after validation. Worker logs confirmed a signature
  mismatch on the real Stripe request, not a connectivity failure or a crypto
  runtime exception. This diagnostic caused no invoice/subscription writes.
- app/api/webhooks/stripe/route.ts reads the raw request via req.text().
  middleware.ts permits /api/webhooks/. No auth redirect or missing-secret
  response was observed. No signature check was weakened or removed.
- Stripe's email says retries end at 2026-10-13 18:56:25 UTC, which is
  14 October 2026, 07:56:25 NZDT.

## Operator step, Liam

AGENTS.md (Codex specifics) says "Liam sets tokens and secrets". No secret was
changed or copied into a tracked file during the investigation.

1. Open the live Stripe destination above, Overview, Signing secret. Copy that
   endpoint's existing signing secret. Use the live endpoint secret rather
   than an API key, a sandbox endpoint or a Stripe CLI listener secret.
2. From the repo terminal, run:

   npx wrangler secret put STRIPE_WEBHOOK_SECRET --name tahi-dashboard

   Paste the signing secret into Wrangler's interactive prompt. It belongs on
   production worker tahi-dashboard, not tahi-dashboard-staging.
3. Retry the invoice.payment_succeeded event above in Stripe. The current
   handler ignores it, so it verifies delivery without altering billing data.
   Require HTTP 200 before moving on. If it still fails, capture a new Worker
   error and compare the endpoint/secret pairing before changing code.

## Reconcile after delivery is restored

The invoice.paid event evt_1UMuaBRx4rjcHALL9Y4u4u9z contains paid invoice
in_1UMcjRRx4rjcHALL0MTr5BjK (WEBL8VAA-0002, USD 1,000), customer
cus_VFXeA5BxU9jgs7, Lingorama. Production SELECTs found no invoice with that
Stripe id and no matching Stripe customer mapping. Lingorama already exists as
org e7d560e6-2416-4e7c-b610-09aa80c6e23d, with stripe_customer_id null.

The invoice.paid handler calls importStripeInvoice with autoCreateOrg false.
An unknown customer is skipped, so HTTP 200 alone will not prove that the
payment was recovered. Confirm/link the existing organisation through the
app's own endpoint as Liam before replaying/importing the paid invoice; check
for twins so recovery does not duplicate a client or invoice. Use a dry run
where available. Review missed billing events and reconcile final state.

Recent daily sync-stripe runs report success with zero new imports, including
2026-10-09 15:01:26 UTC. The missing invoice shows that this status alone is
insufficient. Inspect account/live-mode configuration and the invoice import
results before assuming the sync has recovered missed events. Wrong API-key
mode is a possibility to check, not a confirmed finding.

No production data changes, new charges, invoice sends or refunds were made.
Application code is unchanged. Type-check and lint passed before the docs
commit, with existing lint warnings.

## Reference

Stripe's signature troubleshooting:
https://docs.stripe.com/webhooks/signature
