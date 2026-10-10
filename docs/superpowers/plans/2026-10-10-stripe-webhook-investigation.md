# Stripe live webhook investigation, 2026-10-10

## Finding

Webhook signing is restored. After Liam explicitly asked the agent to apply
the existing secret from his desktop PC, Wrangler updated the production
Worker's STRIPE_WEBHOOK_SECRET. A real Stripe retry returned HTTP 200 with
{received:true} at 2026-10-10 22:53:17 NZDT (09:53:17 UTC), and Stripe shows
Delivered and Recovered. This confirms a signing-secret configuration issue;
the previous secret's exact value was never exposed or compared.

SW.0 is complete. SW.1 remains open: delivery recovery does not import the
missing Lingorama invoice without resolving its customer mapping.

## Original failure evidence

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

## Completed configuration repair, 2026-10-10

Liam: "can you try and put that in my pc, i'm on my laptop right now."
The tools were running on his desktop PC. This explicitly authorised this
one secret update, overriding the standing operator-only guidance for this
action. It does not change that standing guidance for future secrets.

- Copied the existing signing secret from live destination
  we_1TLwhCRx4rjcHALLRYDFBdan, without rotating it.
- Passed it to Wrangler's stdin and updated STRIPE_WEBHOOK_SECRET on worker
  tahi-dashboard in Cloudflare account ccd4c7a3b9f7abdf566f0628579d3f4b.
  Wrangler reported "Success! Uploaded secret STRIPE_WEBHOOK_SECRET".
- Plaintext stayed in memory and process stdin. The tool boundary carried
  RSA-OAEP ciphertext for a fresh local key held only in memory. No plaintext
  secret was printed, written to a file or committed. Restored the clipboard
  and cleared the temporary browser variable afterwards.
- Retried only invoice.payment_succeeded, evt_1UMuaBRx4rjcHALL3v2Svc0u.
  The current handler ignores it after validation, so this verifies delivery
  without altering invoice/subscription data. Stripe reports HTTP 200,
  {received:true}, Delivered and Recovered, at 22:53:17 NZDT.
- Health: / returns 307 to /sign-in, /sign-in returns 200, signed-out
  /overview returns the branded HTML 404. Signed-in /overview loaded real
  Daily brief and financial data. No application or UI change was required.
- A screenshot capture timed out in the browser backend. The visible Stripe
  delivery status and response above are the recorded live observation.
- Investigation baseline b361968f deployed successfully in GitHub Actions
  run 38042102408. The deployment workflow preserves Worker runtime secrets.

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
