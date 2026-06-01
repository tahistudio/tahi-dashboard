-- Migration 0064: sitemap_nodes + sitemap_node_reviews
--
-- Long-lived planning library for the Tahi marketing site redesign.
-- Liam + Staci use /sitemap to draft the dream sitemap, document each
-- page's purpose, run 6 sub-agent critiques (SEO/AEO, ICP, brand voice,
-- CRO, sales, marketing), and export the whole thing as a markdown
-- bundle for downstream tooling.
--
-- Gated to business@tahi.studio + staci@tahi.studio at the route layer.
-- Strictly additive: no existing tables touched. Idempotent via
-- IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS sitemap_nodes (
  id TEXT PRIMARY KEY NOT NULL,
  parent_id TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- 'page' | 'cms_collection' | 'section'
  node_type TEXT NOT NULL DEFAULT 'page',
  title TEXT NOT NULL,
  slug TEXT,
  url TEXT,
  purpose TEXT,
  icp_audience TEXT,
  primary_keyword TEXT,
  aeo_intent TEXT,
  positioning_vertical TEXT,
  success_metric TEXT,
  -- 'idea' | 'spec_done' | 'design_done' | 'webflow_done' | 'live' | 'parked'
  status TEXT NOT NULL DEFAULT 'idea',
  special_features TEXT,
  design_notes TEXT,
  content_notes TEXT,
  target_launch_date TEXT,
  -- Tiptap JSON freeform notes block
  body_tiptap TEXT,
  created_by TEXT,
  last_edited_by TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sitemap_nodes_parent ON sitemap_nodes(parent_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sitemap_nodes_status ON sitemap_nodes(status);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sitemap_node_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  node_id TEXT NOT NULL,
  -- 'seo_aeo' | 'icp' | 'brand_voice' | 'cro' | 'sales' | 'marketing'
  reviewer_key TEXT NOT NULL,
  score INTEGER,
  summary TEXT,
  -- JSON array of suggestion strings or {priority, suggestion} objects
  suggestions TEXT,
  -- JSON — full critique payload from the model
  critique TEXT,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sitemap_node_reviews_node ON sitemap_node_reviews(node_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sitemap_node_reviews_reviewer ON sitemap_node_reviews(reviewer_key);
