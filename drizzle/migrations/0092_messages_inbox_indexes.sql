-- Migration 0092: one room per request, one channel per org, and the two
-- indexes the Messages inbox reads on.
--
-- Messaging ships as ONE inbox over TWO stores, and no message row moves:
--
--   * the org channel is a real `conversations` row per client
--     (type 'org_channel', visibility 'external'), and its messages carry
--     conversation_id with request_id NULL.
--   * a request thread stays keyed on messages.request_id. The
--     `request_thread` conversation row exists so the room has an identity
--     (participants, a name), and it is created lazily by
--     lib/org-channel.ts the first time somebody posts. Reads never depend on
--     it: lib/messages-store.ts reads a request thread by request_id alone,
--     which is why a client message written from the request detail (which
--     sets no conversation_id) is still in the thread.
--
-- Both of those resolvers are find-or-create, and a find-or-create races
-- itself the moment two tabs post at the same second. These indexes are what
-- makes losing that race harmless instead of permanent.
--
--   idx_conversations_request_thread   UNIQUE (request_id) WHERE type = 'request_thread'
--   idx_conversations_org_channel      UNIQUE (org_id)     WHERE type = 'org_channel'
--     Partial on purpose: `direct` and `group` rows legitimately share a NULL
--     request_id and repeat an org_id, so a plain unique index would refuse
--     every one of them.
--
--   idx_messages_request_created       (request_id, created_at)
--   idx_messages_conversation_created  (conversation_id, created_at)
--     Every inbox read is "the newest visible message per thread, newest
--     first". idx_messages_request / idx_messages_conversation alone left
--     SQLite sorting each thread in memory, once per thread in the window.
--
--   idx_conv_participants_unique       UNIQUE (conversation_id, participant_id)
--     One row per person per room. The unread cursor is read with
--     `participants.find(...)`, which picks whichever duplicate comes back
--     first, so a person added twice could carry two different last_read_at
--     values and their unread count would flip between them.
--
-- THE TIDY COMES FIRST, AND IT IS THE REASON THIS FILE IS NOT INDEXES-ONLY.
-- Production still carries duplicate `request_thread` rows from before the
-- detail page hydrated conversationId (it minted a fresh row on the first
-- message after every page load; fixed at request-detail.tsx, and
-- pickThreadConversationId in lib/request-thread.ts has been resolving them at
-- READ time ever since). A UNIQUE index cannot be created over data that
-- already violates it, so statements 1 to 5 collapse the duplicates before
-- statement 6 tries. The collapse follows lib/request-thread.ts:96-108 exactly:
-- make every request thread external, REPOINT messages.conversation_id at the
-- row that is kept rather than only deleting the strays, then delete the
-- strays and their participant rows.
--
-- The kept row is the oldest one (a NULL created_at sorts LAST, matching
-- pickThreadConversationId), so it is the row the existing messages already
-- point at and no request's history ends up split across two ids.
--
-- Statement 5 also sweeps the orphan `direct` conversations left behind by the
-- old Start-DM 500 (POST /api/admin/conversations wrote the conversation row
-- and the creator participant, then threw on the malformed participantIds
-- payload): org-less, one participant, zero messages. They are unreachable
-- from any surface and would otherwise show up in the studio inbox the day it
-- ships.
--
-- Idempotent. Every CREATE is IF NOT EXISTS, and each tidy statement is a
-- no-op on a database it has already run against (the UPDATEs match nothing,
-- the DELETEs find nothing).
--
-- MERGE ORDER, NOT OPTIONAL. Apply this to staging and then production D1
-- BEFORE the code that reads it is deployed. Drizzle expands a bare .select()
-- into an explicit column list from db/schema.ts, but this migration adds no
-- COLUMN, so no existing surface breaks on a database without it. What breaks
-- is the NEW surface: without the unique indexes the lazy resolvers can mint a
-- second room under load, and a second room is a split thread that no later
-- migration can put back together with confidence. Applying it ahead of the
-- deploy is harmless to the running code (the tidy only touches rows that the
-- read-time resolver was already ignoring).
--
-- The runtime runner (POST /api/admin/db/migrate) cannot go first: the "0092"
-- entry lives in app/api/admin/db/migrate/route.ts and does not exist until
-- that deploy lands, so calling it beforehand answers 400 Unknown migration.
-- Apply the file directly with wrangler instead. wrangler.json carries both
-- database ids (staging b91cd27f, production 3bfa4848), so the names below
-- resolve without any extra flags:
--   1. wrangler d1 execute tahi-db-staging --remote --file=drizzle/migrations/0092_messages_inbox_indexes.sql
--   2. deploy, then open /messages as the studio and as Client view of a real
--      client, send one message on each side and reload
--   3. wrangler d1 execute tahi-db --remote --file=drizzle/migrations/0092_messages_inbox_indexes.sql
--   4. approve the production deploy, then smoke the same two
--
-- POST /api/admin/db/migrate {"name":"0092"} is the after-the-fact fallback,
-- usable once the deploy that carries the entry is live.

-- 1. A request thread is ALWAYS external. Per-message is_internal is what
--    hides a studio note from a client; the room itself is the shared one.
UPDATE conversations
   SET visibility = 'external'
 WHERE type = 'request_thread' AND visibility <> 'external';

-- 2. Repoint every message that points at a stray thread row at the row we
--    are keeping, so no request's history is split across two ids.
UPDATE messages
   SET conversation_id = (
     SELECT k.id FROM conversations k
      WHERE k.type = 'request_thread'
        AND k.request_id = (SELECT c.request_id FROM conversations c WHERE c.id = messages.conversation_id)
      ORDER BY (k.created_at IS NULL), k.created_at ASC, k.id ASC
      LIMIT 1)
 WHERE conversation_id IN (
   SELECT c.id FROM conversations c
    WHERE c.type = 'request_thread'
      AND c.request_id IS NOT NULL
      AND c.id <> (SELECT k.id FROM conversations k
                    WHERE k.type = 'request_thread' AND k.request_id = c.request_id
                    ORDER BY (k.created_at IS NULL), k.created_at ASC, k.id ASC
                    LIMIT 1));

-- 3. The stray rooms' participant rows go with them.
DELETE FROM conversation_participants
 WHERE conversation_id IN (
   SELECT c.id FROM conversations c
    WHERE c.type = 'request_thread'
      AND c.request_id IS NOT NULL
      AND c.id <> (SELECT k.id FROM conversations k
                    WHERE k.type = 'request_thread' AND k.request_id = c.request_id
                    ORDER BY (k.created_at IS NULL), k.created_at ASC, k.id ASC
                    LIMIT 1));

-- 4. The strays themselves.
DELETE FROM conversations
 WHERE type = 'request_thread'
   AND request_id IS NOT NULL
   AND id <> (SELECT k.id FROM conversations k
               WHERE k.type = 'request_thread' AND k.request_id = conversations.request_id
               ORDER BY (k.created_at IS NULL), k.created_at ASC, k.id ASC
               LIMIT 1);

-- 5. The orphans the old Start-DM 500 left: org-less, one participant, no
--    messages, reachable from nothing.
DELETE FROM conversation_participants
 WHERE conversation_id IN (
   SELECT c.id FROM conversations c
    WHERE c.type = 'direct'
      AND c.org_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id)
      AND (SELECT COUNT(*) FROM conversation_participants p WHERE p.conversation_id = c.id) <= 1);

DELETE FROM conversations
 WHERE type = 'direct'
   AND org_id IS NULL
   AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id)
   AND NOT EXISTS (SELECT 1 FROM conversation_participants p WHERE p.conversation_id = conversations.id);

-- 6. One person per room, then the two room identities, then the read paths.
DELETE FROM conversation_participants
 WHERE rowid NOT IN (
   SELECT MIN(rowid) FROM conversation_participants GROUP BY conversation_id, participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conv_participants_unique
  ON conversation_participants(conversation_id, participant_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_request_thread
  ON conversations(request_id) WHERE type = 'request_thread';

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_org_channel
  ON conversations(org_id) WHERE type = 'org_channel';

CREATE INDEX IF NOT EXISTS idx_messages_request_created
  ON messages(request_id, created_at);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON messages(conversation_id, created_at);
