-- Migration 0094: email_suppressions.
--
-- The evidence half of the email delivery allowlist. lib/email-delivery.ts is
-- the one door out of this platform, and it withholds any recipient whose
-- domain is not in the settings key `email.allowedDomains` (default
-- ["tahi.studio"]) unless the send carries an org id listed in
-- `email.allowedOrgIds`. `email.deliveryMode` decides whether the rule applies
-- at all, and defaults to 'allowlist' when the row is missing OR malformed:
-- the gate fails closed, because the failure it exists to prevent is a real
-- client receiving a test email.
--
-- One row per withheld recipient, so "did that reach them?" is answerable.
-- Written BEFORE the Resend API key is looked at, so a worker with no key
-- still produces rows, which is what makes the gate verifiable without putting
-- a message in anyone's inbox.
--
-- COLUMN NAME. The Drizzle property is `to` (it is what the caller passed) but
-- the column is `to_address`: TO is a SQLite keyword and a bare `to text NOT
-- NULL` does not parse in this CREATE TABLE, which the runtime runner in
-- app/api/admin/db/migrate/route.ts executes verbatim.
--
-- org_id is a plain text column with no REFERENCES clause on purpose. A
-- suppression can name an organisation that is later deleted, and losing the
-- evidence of a withheld send to a cascade is exactly the wrong trade.
--
-- Every statement is IF NOT EXISTS and nothing is backfilled, so this is
-- purely additive and re-running the file is safe.
--
-- ORDER. This one is safe either way round, unlike 0089 and 0091: the new
-- table is read by exactly two new surfaces (GET /api/admin/email-suppressions
-- and the Studio details log card) and written best-effort inside a try/catch,
-- so a database without it degrades to "no rows logged" rather than a 500 on
-- an existing page. Apply it before the deploy anyway so the first withheld
-- send is recorded:
--   1. wrangler d1 execute tahi-db-staging --remote --file=drizzle/migrations/0094_email_suppressions.sql
--   2. deploy, then open Settings > Studio details and check the Email
--      delivery row reads "Allowlist only - tahi.studio"
--   3. wrangler d1 execute tahi-db --remote --file=drizzle/migrations/0094_email_suppressions.sql
--   4. approve the production deploy, then check the same row
--
-- POST /api/admin/db/migrate {"name":"0094"} is the after-the-fact fallback,
-- usable once the deploy carrying the entry is live.

CREATE TABLE IF NOT EXISTS email_suppressions (
  id text PRIMARY KEY NOT NULL,
  -- The DEFAULT matches db/schema.ts. Drizzle omits a column from the INSERT
  -- when it believes the database supplies one, so without this a writer that
  -- trusts the declared default hits NOT NULL constraint failed on D1 only.
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  to_address text NOT NULL,
  org_id text,
  template text,
  subject text,
  reason text NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_suppressions_created ON email_suppressions(created_at);
CREATE INDEX IF NOT EXISTS idx_email_suppressions_org ON email_suppressions(org_id);
