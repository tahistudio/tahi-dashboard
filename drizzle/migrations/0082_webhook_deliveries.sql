-- Migration 0082: Event engine — webhook_deliveries log
--
-- All statements use IF NOT EXISTS so this is safe to re-run. The runtime
-- runner (app/api/admin/db/migrate) also swallows "already exists" so the
-- CREATEs are re-run-safe.

-- webhook_deliveries: one row per attempted delivery of a domain event
-- (request / invoice / client lifecycle) to a registered outgoing webhook
-- endpoint. Written best-effort by lib/webhooks.ts fireWebhook, which is
-- called by lib/events.ts emitDomainEvent. endpoint_id is the opaque id from
-- the settings key/value store (key prefix `webhook_endpoint_`), NOT a foreign
-- key. status is 'delivered' | 'failed'. Powers a delivery history in
-- settings > integrations.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id text PRIMARY KEY NOT NULL,
  endpoint_id text,
  event text NOT NULL,
  url text NOT NULL,
  status text NOT NULL,
  status_code integer,
  error_message text,
  attempted_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_event ON webhook_deliveries(event);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_endpoint ON webhook_deliveries(endpoint_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_attempted ON webhook_deliveries(attempted_at);
