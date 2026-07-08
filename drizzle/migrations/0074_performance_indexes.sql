-- Migration 0074: Performance indexes on hot FK + WHERE/ORDER-BY columns
--
-- All statements use IF NOT EXISTS so this is safe to re-run and safe
-- against any prod index that may already have been created manually.
-- Drift indexes (idx_client_costs_*, idx_team_members_person) are NOT
-- included here because they already exist in prod via migrations 0012
-- and 0038; they are declared in schema.ts only to prevent a future
-- drizzle-kit generate from emitting DROP INDEX.

-- HIGH: tracks
CREATE INDEX IF NOT EXISTS idx_tracks_subscription ON tracks (subscription_id);

-- HIGH: invoices
CREATE INDEX IF NOT EXISTS idx_invoices_stripe ON invoices (stripe_invoice_id);

-- HIGH: subscriptions
CREATE INDEX IF NOT EXISTS idx_subs_stripe ON subscriptions (stripe_subscription_id);

-- HIGH: organisations
CREATE INDEX IF NOT EXISTS idx_orgs_stripe_customer ON organisations (stripe_customer_id);

-- HIGH: deal_contacts
CREATE INDEX IF NOT EXISTS idx_deal_contacts_deal ON deal_contacts (deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_contacts_contact ON deal_contacts (contact_id);

-- HIGH: invoice_items
CREATE INDEX IF NOT EXISTS idx_invoice_items_invoice ON invoice_items (invoice_id);

-- HIGH: team_members
CREATE INDEX IF NOT EXISTS idx_team_members_clerk ON team_members (clerk_user_id);

-- HIGH: conversation_participants composite
CREATE INDEX IF NOT EXISTS idx_conv_participants_participant ON conversation_participants (participant_id, participant_type);

-- MEDIUM: conversations
CREATE INDEX IF NOT EXISTS idx_conversations_org ON conversations (org_id);
CREATE INDEX IF NOT EXISTS idx_conversations_request ON conversations (request_id);

-- MEDIUM: task_subtasks
CREATE INDEX IF NOT EXISTS idx_task_subtasks_task ON task_subtasks (task_id);

-- MEDIUM: request_forms
CREATE INDEX IF NOT EXISTS idx_request_forms_org_cat ON request_forms (org_id, category);
CREATE INDEX IF NOT EXISTS idx_request_forms_default ON request_forms (is_default);

-- MEDIUM: kanban_columns
CREATE INDEX IF NOT EXISTS idx_kanban_org ON kanban_columns (org_id);

-- MEDIUM: contacts
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email);

-- MEDIUM: announcement_dismissals
CREATE INDEX IF NOT EXISTS idx_announcement_dismissals_user ON announcement_dismissals (user_id);

-- MEDIUM: doc_versions
CREATE INDEX IF NOT EXISTS idx_doc_versions_page ON doc_versions (page_id);

-- MEDIUM: case_study_submissions
CREATE INDEX IF NOT EXISTS idx_case_submissions_org ON case_study_submissions (org_id);

-- MEDIUM: automation_log
CREATE INDEX IF NOT EXISTS idx_auto_log_rule ON automation_log (rule_id);
CREATE INDEX IF NOT EXISTS idx_auto_log_executed ON automation_log (executed_at);
