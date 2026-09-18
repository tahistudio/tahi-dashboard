-- Migration 0104: requests gains the client hand-off pointer.
--
-- Liam: "requests are mainly for us, but occasionally I'll need a client to
-- help with a request (a person on the org), or I'll be blocked by them for
-- something, so I should be able to assign clients to requests."
--
-- A request keeps its Tahi owner. At any moment it can also be HANDED to one
-- named contact at the client, with a reason and an optional date. That is a
-- pointer, not a second owner, which is why it is six nullable columns on the
-- request rather than a table: there is only ever zero or one person a request
-- is waiting on, and the history of who it sat with lives in audit_log
-- ('request.handed_off' / 'request.handed_back') where it cannot be edited.
--
--   waiting_on_contact_id  contacts.id, the one person it is with. NULL = with
--                          the studio, which is every request's normal state.
--   waiting_reason         'approval' | 'content' | 'access' | 'decision' |
--                          'file' | 'other'. Decides the sentence the client
--                          reads and the single action verb they get, and it
--                          decides the participant role written beside it
--                          ('approver' for approval, 'contributor' otherwise).
--   waiting_since          ISO, stamped at hand-off. Drives the "3d" on the
--                          studio chip and the nudge window.
--   waiting_due_at         ISO, nullable. The date the studio asked for.
--   waiting_note           Free text from the studio, nullable.
--   waiting_nudged_at      ISO, nullable. Last time the reminder went out, so
--                          the delivery-watch cron can hold itself to one
--                          nudge per three days.
--
-- No new table, and no work_blockers row: the "Blocked by" card renders a
-- synthetic line off these columns so a hand-off cannot leave a stale blocker
-- behind when the client acts.
--
-- Additive, ALTER TABLE ADD COLUMN. SQLite has no IF NOT EXISTS for ADD
-- COLUMN; the runner in app/api/admin/db/migrate/route.ts swallows "duplicate
-- column name" so re-running is safe. The partial index is what makes "every
-- request waiting on a client" cheap: the studio rail view and the nudge step
-- both ask exactly that question, over a table where the vast majority of rows
-- carry NULL here.
--
-- The READ paths all tolerate a missing column (lib/request-handoff.ts wraps
-- its one query in a try/catch and returns an empty map), so deploying ahead
-- of this migration degrades to "no request is waiting on anyone" rather than
-- 500ing a list. Apply it anyway before the hand-off button is used: the WRITE
-- paths select and set these columns directly.
ALTER TABLE requests ADD COLUMN waiting_on_contact_id text;
ALTER TABLE requests ADD COLUMN waiting_reason text;
ALTER TABLE requests ADD COLUMN waiting_since text;
ALTER TABLE requests ADD COLUMN waiting_due_at text;
ALTER TABLE requests ADD COLUMN waiting_note text;
ALTER TABLE requests ADD COLUMN waiting_nudged_at text;
CREATE INDEX IF NOT EXISTS idx_requests_waiting_on ON requests(waiting_on_contact_id) WHERE waiting_on_contact_id IS NOT NULL;
