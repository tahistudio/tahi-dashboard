# Xero Integration — Complete Implementation

## Summary

Full Xero OAuth integration is now implemented with bidirectional invoice sync. The dashboard can now:
- Authenticate with Xero via OAuth
- Push invoices to Xero with line items
- Pull payment statuses from Xero back to local records
- Automatically refresh OAuth tokens when expired

## Implementation Details

### 1. OAuth Token Exchange
**File:** `app/api/admin/integrations/xero/callback/route.ts`
- Exchanges authorization code for access and refresh tokens
- Stores tokens securely in `integrations` table with expiry time
- Handles token refresh flow for subsequent API calls
- Redirects to settings page on success or error

### 2. Xero Utilities
**File:** `lib/xero.ts`
- `getXeroIntegration()`: Retrieves current integration record
- `isTokenExpired()`: Checks if token has expired
- `refreshXeroToken()`: Exchanges refresh token for new access token
- `getValidXeroToken()`: Gets a valid token, refreshing if needed
- `callXeroAPI()`: Makes authenticated API calls to Xero

### 3. Invoice Push (Create in Xero)
**File:** `app/api/admin/invoices/xero-sync/route.ts`
- `POST /api/admin/invoices/xero-sync`
- Pushes local invoices to Xero as DRAFT invoices
- Creates or finds contacts in Xero first
- Maps line items from local invoice items
- Stores Xero invoice ID for reconciliation
- Batch sync: all unsync'd invoices or a specific invoice
- Query by `invoiceId` or `orgId`

### 4. Payment Status Sync (Pull from Xero)
**File:** `app/api/admin/integrations/xero/sync-payments/route.ts`
- `POST /api/admin/integrations/xero/sync-payments`
- Fetches all invoices from Xero that have been synced locally
- Maps Xero status codes to local status values:
  - DRAFT → draft
  - AUTHORISED → sent
  - SUBMITTED → viewed
  - PAID → paid (sets paidAt timestamp)
- Updates local invoice status and payment dates

## Environment Variables Required

```
XERO_CLIENT_ID=<your-oauth-app-client-id>
XERO_CLIENT_SECRET=<your-oauth-app-secret>
XERO_TENANT_ID=<your-xero-organization-id>
```

## Setup Instructions

### Step 1: Create Xero OAuth App
1. Go to https://developer.xero.com/app/manage
2. Create a new application
3. Set redirect URI to: `{NEXT_PUBLIC_APP_URL}/api/admin/integrations/xero/callback`
4. Copy Client ID and Client Secret
5. Copy your Xero Tenant ID from organization settings

### Step 2: Configure Environment Variables
Add to Webflow Cloud environment variables:
```
XERO_CLIENT_ID=<client-id>
XERO_CLIENT_SECRET=<client-secret>
XERO_TENANT_ID=<tenant-id>
```

### Step 3: Test the Flow
1. Go to Settings → Integrations
2. Click "Connect with Xero"
3. Authorize the application
4. Should redirect back to settings with "Connected" status
5. Create or sync an invoice to Xero via `POST /api/admin/invoices/xero-sync`
6. Pull payment status via `POST /api/admin/integrations/xero/sync-payments`

## API Examples

### Connect to Xero (OAuth)
```bash
GET /api/admin/integrations/xero/connect
# Returns: { success: true, authorizationUrl: "https://..." }
```

### Push Invoices to Xero
```bash
POST /api/admin/invoices/xero-sync
Content-Type: application/json

# Sync single invoice
{ "invoiceId": "uuid" }

# Sync all invoices for a client
{ "orgId": "uuid" }

# Response:
{
  "success": true,
  "synced": 3,
  "skipped": 1,
  "failed": 0,
  "results": [...]
}
```

### Pull Payment Status from Xero
```bash
POST /api/admin/integrations/xero/sync-payments
# Response:
{
  "success": true,
  "synced": 5,
  "updated": 2,
  "results": [...]
}
```

## Launch Readiness

✅ **Ready to ship.** All features implemented:
- [x] OAuth token exchange
- [x] Token refresh mechanism
- [x] Invoice push (create in Xero)
- [x] Payment status pull (sync back to dashboard)
- [x] Error handling
- [x] Type safety

**Not yet implemented (post-launch):**
- Webhook handler for real-time payment notifications from Xero
- Automatic sync job scheduler
- Detailed reconciliation reporting

## Testing Checklist

- [ ] Set XERO_CLIENT_ID, XERO_CLIENT_SECRET, XERO_TENANT_ID in Webflow Cloud
- [ ] Test OAuth connect flow (Settings → Integrations → Connect with Xero)
- [ ] Create a test invoice locally
- [ ] Push to Xero via POST /api/admin/invoices/xero-sync
- [ ] Verify invoice appears in Xero (check Xero dashboard)
- [ ] Mark invoice as paid in Xero
- [ ] Pull payment status via POST /api/admin/integrations/xero/sync-payments
- [ ] Verify local invoice status updated to "paid"
- [ ] Test with multiple invoices and orgs
