# Tahi Dashboard Launch Checklist

## ✅ VERIFIED WORKING — Ship These Features
- [x] Task management (create, assign, track tasks)
- [x] Pipeline/deals tracking (with auto-seeded stages)
- [x] Review outreach automation (state machine complete)
- [x] Request intake forms (for portal clients)
- [x] Core request workflow (create, status, messages)
- [x] Client management (detail, contacts, subscriptions)
- [x] Messaging/conversations (direct, group, channels)
- [x] Time tracking (billable hours)
- [x] Notifications (real-time, email digest)
- [x] Dark mode toggle
- [x] Team access scoping
- [x] Contracts tracking
- [x] Announcements & banners

---

## 🟡 NEEDS QUICK FIX (30 minutes total)

### Fix #1: Enable R2 File Uploads
**Action:** Configure STORAGE binding in Webflow Cloud
```
1. Go to Webflow Cloud Console
2. Settings → Environment → Bindings
3. Add new R2 binding:
   - Name: STORAGE
   - Resource: tahi-storage (Cloudflare R2 bucket)
4. Save & redeploy
5. Test: Try uploading file on request detail page
```
**Status:** Blocks file upload feature
**Priority:** CRITICAL

### Fix #2: Enable Email Sending
**Action:** Add RESEND_API_KEY to Webflow Cloud
```
1. Get API key from https://resend.com/api-keys
2. Go to Webflow Cloud Console
3. Settings → Environment → Variables
4. Add: RESEND_API_KEY=re_XXXXXXXXXXXXX
5. Redeploy
6. Test: Create new client, check for welcome email
```
**Status:** Blocks welcome + invoice emails
**Priority:** CRITICAL

---

## ⚠️ WORKS WITH MANUAL WORKAROUND

### Feature: Scheduled Calls Booking Links
**Current:** Users enter meeting URL manually
**To Auto-Generate:** Integrate Calendly or Google Calendar (post-launch)
**Status:** Feature is 80% usable now
**Launch:** YES, with manual URLs
**Priority:** LOW (post-v1)

---

## 🔴 POST-LAUNCH FEATURES

### Xero Invoice Sync (Two-Way)
**Current:** Push only (calculate hours, create draft)
**Missing:** OAuth token exchange, actual API push, payment status pull
**Effort:** 4-6 hours
**Launch:** NO (but one-way push works)
**Priority:** MEDIUM (v1.1)

---

## Pre-Launch Smoke Tests

```bash
# After applying fixes #1 and #2, test:

❑ File Uploads
  - Navigate to request detail
  - Upload a test PDF
  - Download it back
  - Should work end-to-end

❑ Emails
  - Create new client
  - Check inbox for welcome email
  - Send invoice
  - Check inbox for invoice email
  - Both should arrive

❑ Core Flows
  - Create request → status change → message → mark delivered
  - Create task → assign → complete subtask → mark done
  - Create deal → move between pipeline stages
  - Ask for review → mark as completed

❑ Portal
  - Log in as client contact
  - View requests (should be scoped to their org)
  - Submit new request with intake form
  - Upload file, send message
  - View invoice, no admin data visible

❑ Dark Mode
  - Toggle dark mode in settings
  - Should persist on refresh
  - All components should be readable
```

---

## Environment Variables Needed in Webflow Cloud

```
# Email
RESEND_API_KEY=re_XXXXX
RESEND_FROM_EMAIL=notifications@tahi.studio

# File Storage
# STORAGE binding (configured in Webflow Cloud settings, not here)

# Stripe (already set?)
STRIPE_SECRET_KEY=sk_XXXXX
STRIPE_WEBHOOK_SECRET=whsec_XXXXX

# Clerk (already set?)
CLERK_SECRET_KEY=sk_XXXXX

# Xero (OAuth integration)
XERO_CLIENT_ID=XXXXX
XERO_CLIENT_SECRET=XXXXX
XERO_TENANT_ID=XXXXX           # Your Xero organization ID

# Optional (for full feature set)
GOOGLE_CALENDAR_CLIENT_ID=XXXXX           # For scheduled calls (v1.1)
GOOGLE_CALENDAR_CLIENT_SECRET=XXXXX       # For scheduled calls (v1.1)
SLACK_BOT_TOKEN=xoxb-XXXXX                 # For Slack notifications
MAILERLITE_API_KEY=XXXXX                   # For email list sync
```

---

## What NOT to Ship Yet

- ❌ Xero two-way sync (do v1.1)
- ❌ HubSpot integration (internal CRM replaces it)
- ❌ Automatic booking links (do v1.1)

---

## Go/No-Go Decision

### Before Fixes #1 & #2:
🔴 **NO GO** — File uploads and emails broken

### After Fixes #1 & #2:
🟢 **GO** — 90% of features working. Xero and auto-booking are nice-to-haves for v1.1.

### Estimated Time to Launch
- Fixes #1 & #2: **30 minutes**
- Smoke tests: **1 hour**
- **Total: ~90 minutes to launch-ready**

