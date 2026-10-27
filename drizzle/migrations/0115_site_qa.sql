-- Site QA (SQA) migration 0115. Additive only: every statement uses IF NOT EXISTS, so re-running is safe.
-- Apply BEFORE deploying the /qa routes. Mirrors lib/qa-migration.ts.
CREATE TABLE IF NOT EXISTS qa_sites (id text PRIMARY KEY NOT NULL, org_id text NOT NULL, name text NOT NULL, staging_url text, live_url text, notes text, created_by text, created_at text NOT NULL, updated_at text NOT NULL, archived_at text);
CREATE INDEX IF NOT EXISTS idx_qa_sites_org ON qa_sites(org_id);
CREATE TABLE IF NOT EXISTS qa_pages (id text PRIMARY KEY NOT NULL, site_id text NOT NULL, path text NOT NULL, title text, group_key text, source text NOT NULL DEFAULT 'sitemap', removed_at text, created_at text NOT NULL, updated_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_pages_site_path ON qa_pages(site_id, path);
CREATE TABLE IF NOT EXISTS qa_rounds (id text PRIMARY KEY NOT NULL, site_id text NOT NULL, name text NOT NULL, target text NOT NULL, status text NOT NULL DEFAULT 'open', site_checks text, site_checks_at text, redirect_map text, redirect_map_at text, created_by text, created_at text NOT NULL, closed_at text);
CREATE INDEX IF NOT EXISTS idx_qa_rounds_site ON qa_rounds(site_id);
CREATE TABLE IF NOT EXISTS qa_round_pages (id text PRIMARY KEY NOT NULL, round_id text NOT NULL, page_id text NOT NULL, path text NOT NULL, group_key text, sort_order integer NOT NULL DEFAULT 0, vp_xl integer NOT NULL DEFAULT 0, vp_desktop integer NOT NULL DEFAULT 0, vp_tablet integer NOT NULL DEFAULT 0, vp_mobile_l integer NOT NULL DEFAULT 0, vp_mobile_p integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'untested', note text, request_ids text, a11y_critical integer, a11y_serious integer, a11y_moderate integer, a11y_minor integer, broken_links integer, seo_issues integer, launch_issues integer, perf_issues integer, scanned_at text, pagespeed text, pagespeed_at text, updated_by text, updated_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_round_pages_round_page ON qa_round_pages(round_id, page_id);
CREATE INDEX IF NOT EXISTS idx_qa_round_pages_page ON qa_round_pages(page_id);
CREATE TABLE IF NOT EXISTS qa_scan_results (id text PRIMARY KEY NOT NULL, round_page_id text NOT NULL, viewport text NOT NULL, result text NOT NULL, created_at text NOT NULL);
CREATE TABLE IF NOT EXISTS qa_link_results (id text PRIMARY KEY NOT NULL, round_id text NOT NULL, url text NOT NULL, final_url text, status integer, hops text, broken integer NOT NULL DEFAULT 0, redirect_chain integer NOT NULL DEFAULT 0, staging_on_live integer NOT NULL DEFAULT 0, error text, checked_at text NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_qa_link_results_round_url ON qa_link_results(round_id, url);
