# Subscription Billing Tiers

## What It Is

Subscription plans with monthly, quarterly (3-month), and annual (12-month) payment options. Longer commitments include bundled incentives to increase client retention and lifetime value.

## Pricing Structure

### Maintain Plan ($1,500 NZD/month)

| Duration | Monthly Cost | Total | Savings | Included Extras |
|----------|-------------|-------|---------|-----------------|
| Monthly | $1,500 | $1,500/mo | - | Base plan |
| 3-month | $1,500 | $4,500 | $0 (commitment) | + Free SEO Dashboard ($150/mo value) |
| 12-month | $1,500 | $18,000 | $0 (commitment) | + Free SEO Dashboard + Priority Support ($1,000/mo value) |

### Scale Plan ($4,000 NZD/month)

| Duration | Monthly Cost | Total | Savings | Included Extras |
|----------|-------------|-------|---------|-----------------|
| Monthly | $4,000 | $4,000/mo | - | Base plan |
| 3-month | $4,000 | $12,000 | $0 (commitment) | + Free SEO Dashboard ($150/mo value) |
| 12-month | $4,000 | $48,000 | $0 (commitment) | + Free SEO Dashboard + Extra Track + Priority Support ($1,500/mo value) |

Note: No price discount on the plan itself (policy). Value comes from bundled extras.

### Tax
- GST (15%) charged ONLY for NZ-based clients
- No VAT for any other region
- Tax calculated and shown at invoice time based on client's country

## Data Model

### Changes to `subscriptions` table
```ts
billingCycle: 'monthly' | 'quarterly' | 'annual'  // new field
commitmentStartDate: text nullable    // when commitment period started
commitmentEndDate: text nullable      // when commitment period ends
bundledAddOns: text nullable          // JSON: ['seo_dashboard', 'priority_support', 'extra_track']
autoRenew: integer default 1          // boolean: auto-renew at end of commitment
```

### Changes to `organisations` table
```ts
country: text nullable                // for GST determination
taxId: text nullable                  // GST/tax number if applicable
```

## Client Portal Experience

### Plan Selection (Settings or Onboarding)
Show three cards side by side:

```
[ Monthly ]         [ 3-Month ]              [ 12-Month ]
  $X/month           $X/month                  $X/month
  Cancel anytime     3-month commitment        12-month commitment

                     INCLUDES:                 INCLUDES:
                     + SEO Dashboard            + SEO Dashboard
                     + ($150/mo value)          + Extra Track
                                               + Priority Support
                                               + ($X/mo value)

  [Current Plan]     [Switch to 3-Month]       [Switch to Annual]
```

### Renewal Tracking
- Show commitment end date in client portal
- 30 days before end: notification "Your plan renews on [date]"
- If auto-renew off: "Your plan expires on [date]. Renew to keep your tracks."

### Upsell from Track Queue
When track queue is long, show upgrade options with billing tier context:
"Upgrade to Scale and save more with an annual commitment. Get an extra track + priority support included."

## Admin View

### Client Detail - Subscription Tab
- Show current plan, billing cycle, commitment dates
- Show bundled add-ons with their value
- Show renewal status
- Button to adjust plan/cycle
- Revenue impact calculator: "Switching to annual = $X guaranteed revenue"

### Billing Dashboard
- MRR breakdown by billing cycle
- Commitment pipeline: upcoming renewals by month
- Churn risk: clients approaching end of commitment without auto-renew

## Stripe Integration

### For Stripe-billed clients
- Create Stripe subscription with appropriate billing interval
- Map bundled add-ons to Stripe subscription items (price = $0 for included extras)
- Handle subscription lifecycle events

### For Xero-billed clients
- Track billing cycle in dashboard only
- Generate invoice reminders on billing dates
- No Stripe subscription needed

## API Routes

### GET/PUT /api/admin/subscriptions/[id]
- Update billing cycle, add-ons, auto-renew
- Calculate and show commitment dates

### GET /api/portal/subscription
- Client sees their plan, cycle, inclusions, renewal date

### POST /api/admin/subscriptions/[id]/change-cycle
- Switch between monthly/quarterly/annual
- Pro-rate current period
- Add/remove bundled extras based on new cycle

## Done Criteria
- Three billing cycle options visible in portal
- Bundled add-ons shown with value callout
- GST applies only to NZ clients (country-based)
- Commitment dates tracked and shown
- Renewal notifications at 30 days
- Admin can adjust plan/cycle
- Stripe subscriptions created with correct interval
- Upsell messaging contextually shows savings
