/**
 * The site QA tools, as a pure map from tool call to dashboard API call.
 *
 * Same shape as ./feedback-tools and ./task-comment-tools: the mapping is a
 * plain function, covered by a spec in
 * app/api/__tests__/mcp-qa-tool-parity.test.ts (vitest excludes workers/**,
 * so the spec lives inside app/ where the root run already sweeps it). This
 * module knows nothing about fetch, tokens or the Workers runtime.
 *
 * Admin only: the tools are in the full profile (every tool is) and every one
 * is listed in DESIGNER_BLOCKED_TOOLS in tool-profiles.ts, so the designer
 * profile hides and refuses them.
 *
 * Not mapped on purpose: POST round-pages/[id]/scan (the in-browser scanner
 * posts its own result) and /api/admin/qa/view-token (mints a token for the
 * browser-only QA viewer). Neither has a use outside a browser.
 */

import { coerceBoolean } from './coerce'
import { assertSafeIdArgs } from './path-safety'

export type McpMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE'

export interface McpApiCall {
  path: string
  method: McpMethod
  /** Present on writes only. */
  body?: Record<string, unknown>
}

/** The five viewport ticks on a round page, in the order the route stores them. */
const VIEWPORT_KEYS = ['xl', 'desktop', 'tablet', 'mobile_l', 'mobile_p'] as const

/** The rendering engines a round can cover, as the routes name them (Chrome, Firefox, Safari). */
const BROWSER_KEYS = ['chromium', 'firefox', 'webkit'] as const

/** An optional browser argument. Undefined when absent, an error when it is not a known engine. */
function optionalBrowser(args: Record<string, unknown>, key: string): string | undefined {
  const value = str(args, key)
  if (value === undefined) return undefined
  if (!(BROWSER_KEYS as readonly string[]).includes(value)) throw new Error(`${key} must be one of chromium, firefox, webkit`)
  return value
}

/** An optional list of browsers. Undefined when absent, an error when it is empty or holds an unknown engine. */
function optionalBrowserList(args: Record<string, unknown>, key: string): string[] | undefined {
  const value: unknown = args[key]
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${key} must be a non-empty list of chromium, firefox, webkit`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || !(BROWSER_KEYS as readonly string[]).includes(item)) {
      throw new Error(`${key} must be a non-empty list of chromium, firefox, webkit`)
    }
    if (!out.includes(item)) out.push(item)
  }
  return out
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/** A required string argument, named in the error the way the other dispatchers name theirs. */
function required(args: Record<string, unknown>, key: string): string {
  const value = str(args, key)
  if (!value) throw new Error(`${key} is required`)
  return value
}

/**
 * The viewport ticks as the route reads them: each key a boolean, unreadable
 * values dropped, unknown keys ignored. Undefined when nothing usable was sent.
 */
function viewportTicks(value: unknown): Record<string, boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const source = value as Record<string, unknown>
  const out: Record<string, boolean> = {}
  for (const key of VIEWPORT_KEYS) {
    const ticked = coerceBoolean(source[key])
    if (ticked !== undefined) out[key] = ticked
  }
  return Object.keys(out).length ? out : undefined
}

/** A required non-empty array of non-empty strings, named in the error the way required() names its key. */
function requiredStringList(args: Record<string, unknown>, key: string): string[] {
  const value: unknown = args[key]
  if (!Array.isArray(value) || value.length === 0) throw new Error(`${key} is required`)
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '') throw new Error(`${key} must contain only non-empty strings`)
    out.push(item)
  }
  return out
}

/**
 * The dashboard call one QA tool maps to, or null when the name belongs to
 * another block of the switch.
 */
export function qaToolCall(
  name: string,
  args: Record<string, unknown>,
): McpApiCall | null {
  switch (name) {
    case 'list_qa_sites': {
      const orgId = str(args, 'org_id')
      assertSafeIdArgs({ org_id: orgId })
      const path = orgId ? `/api/admin/qa/sites?orgId=${encodeURIComponent(orgId)}` : '/api/admin/qa/sites'
      return { path, method: 'GET' }
    }
    case 'create_qa_site': {
      const orgId = required(args, 'org_id')
      assertSafeIdArgs({ org_id: orgId })
      const body: Record<string, unknown> = { orgId, name: required(args, 'name') }
      const stagingUrl = str(args, 'staging_url')
      const liveUrl = str(args, 'live_url')
      const notes = str(args, 'notes')
      if (stagingUrl) body.stagingUrl = stagingUrl
      if (liveUrl) body.liveUrl = liveUrl
      if (notes) body.notes = notes
      return { path: '/api/admin/qa/sites', method: 'POST', body }
    }
    case 'import_qa_sitemap': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      const body: Record<string, unknown> = { target: required(args, 'target') }
      const sitemapUrl = str(args, 'sitemap_url')
      if (sitemapUrl) body.sitemapUrl = sitemapUrl
      return { path: `/api/admin/qa/sites/${siteId}/import-sitemap`, method: 'POST', body }
    }
    case 'list_qa_rounds': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      return { path: `/api/admin/qa/sites/${siteId}/rounds`, method: 'GET' }
    }
    case 'start_qa_round': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      const body: Record<string, unknown> = { name: required(args, 'name'), target: required(args, 'target') }
      const browsers = optionalBrowserList(args, 'browsers')
      if (browsers) body.browsers = browsers
      return { path: `/api/admin/qa/sites/${siteId}/rounds`, method: 'POST', body }
    }
    case 'get_qa_round': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      return { path: `/api/admin/qa/rounds/${roundId}`, method: 'GET' }
    }
    case 'update_qa_round_page': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      const body: Record<string, unknown> = {}
      const status = str(args, 'status')
      if (status) body.status = status
      // null clears the note, so it is passed through as null rather than dropped.
      if (args.note === null) body.note = null
      else if (typeof args.note === 'string') body.note = args.note
      const vp = viewportTicks(args.viewports)
      if (vp) body.vp = vp
      // The browser the viewport ticks belong to; the route defaults to the round's first browser.
      const browser = optionalBrowser(args, 'browser')
      if (browser) body.browser = browser
      return { path: `/api/admin/qa/round-pages/${roundPageId}`, method: 'PATCH', body }
    }
    case 'check_qa_round_links': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      const urls = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === 'string' && u !== '') : []
      if (urls.length === 0) throw new Error('urls is required')
      return { path: `/api/admin/qa/rounds/${roundId}/check-links`, method: 'POST', body: { urls } }
    }
    case 'run_qa_site_checks': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      return { path: `/api/admin/qa/rounds/${roundId}/site-checks`, method: 'POST', body: {} }
    }
    case 'get_qa_round_report': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      return { path: `/api/admin/qa/rounds/${roundId}/report`, method: 'GET' }
    }
    case 'update_qa_site': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      const body: Record<string, unknown> = {}
      const name = str(args, 'name')
      if (name) body.name = name
      // An empty string or null clears a URL or the notes, so those pass through as given.
      const clearable = [['staging_url', 'stagingUrl'], ['live_url', 'liveUrl'], ['notes', 'notes']] as const
      for (const [arg, key] of clearable) {
        const value = args[arg]
        if (value === null || typeof value === 'string') body[key] = value
      }
      if (Object.keys(body).length === 0) throw new Error('Nothing to update')
      return { path: `/api/admin/qa/sites/${siteId}`, method: 'PATCH', body }
    }
    case 'archive_qa_site': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      return { path: `/api/admin/qa/sites/${siteId}`, method: 'DELETE', body: {} }
    }
    case 'add_qa_page': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      return { path: `/api/admin/qa/sites/${siteId}/pages`, method: 'POST', body: { path: required(args, 'path') } }
    }
    case 'remove_qa_page': {
      const pageId = required(args, 'page_id')
      assertSafeIdArgs({ page_id: pageId })
      return { path: `/api/admin/qa/pages/${pageId}`, method: 'DELETE', body: {} }
    }
    case 'update_qa_round': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      const body: Record<string, unknown> = {}
      const roundName = str(args, 'name')
      const status = str(args, 'status')
      if (roundName) body.name = roundName
      if (status) body.status = status
      const browsers = optionalBrowserList(args, 'browsers')
      if (browsers) body.browsers = browsers
      if (Object.keys(body).length === 0) throw new Error('name, status or browsers is required')
      return { path: `/api/admin/qa/rounds/${roundId}`, method: 'PATCH', body }
    }
    case 'add_qa_round_samples': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      const body: Record<string, unknown> = { groupKey: required(args, 'group_key') }
      if (typeof args.count === 'number') body.count = args.count
      return { path: `/api/admin/qa/rounds/${roundId}/samples`, method: 'POST', body }
    }
    case 'get_qa_round_page': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      return { path: `/api/admin/qa/round-pages/${roundPageId}`, method: 'GET' }
    }
    case 'create_qa_request': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      const body: Record<string, unknown> = { title: required(args, 'title') }
      const description = str(args, 'description')
      const viewport = str(args, 'viewport')
      if (description) body.description = description
      if (viewport) body.viewport = viewport
      const browser = optionalBrowser(args, 'browser')
      if (browser) body.browser = browser
      return { path: `/api/admin/qa/round-pages/${roundPageId}/create-request`, method: 'POST', body }
    }
    case 'run_qa_pagespeed': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      return {
        path: `/api/admin/qa/round-pages/${roundPageId}/pagespeed`,
        method: 'POST',
        body: { strategy: required(args, 'strategy') },
      }
    }
    case 'check_qa_redirect_map': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      const urls = Array.isArray(args.urls) ? args.urls.filter((u): u is string => typeof u === 'string' && u !== '') : []
      if (urls.length === 0) throw new Error('urls is required')
      return { path: `/api/admin/qa/rounds/${roundId}/redirect-map`, method: 'POST', body: { urls } }
    }
    case 'add_qa_pages': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      return { path: `/api/admin/qa/sites/${siteId}/pages`, method: 'POST', body: { paths: requiredStringList(args, 'paths') } }
    }
    case 'crawl_qa_site': {
      const siteId = required(args, 'site_id')
      assertSafeIdArgs({ site_id: siteId })
      const body: Record<string, unknown> = { target: required(args, 'target') }
      if (typeof args.max_pages === 'number') body.maxPages = args.max_pages
      return { path: `/api/admin/qa/sites/${siteId}/crawl`, method: 'POST', body }
    }
    case 'list_qa_comments': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      return { path: `/api/admin/qa/round-pages/${roundPageId}/comments`, method: 'GET' }
    }
    case 'list_qa_round_comments': {
      const roundId = required(args, 'round_id')
      assertSafeIdArgs({ round_id: roundId })
      const status = str(args, 'status')
      if (status && !['open', 'resolved', 'all'].includes(status)) {
        throw new Error('status must be one of open, resolved, all')
      }
      const query = status ? `?status=${status}` : ''
      return { path: `/api/admin/qa/rounds/${roundId}/comments${query}`, method: 'GET' }
    }
    case 'get_qa_comment': {
      const commentId = required(args, 'comment_id')
      assertSafeIdArgs({ comment_id: commentId })
      return { path: `/api/admin/qa/comments/${commentId}`, method: 'GET' }
    }
    case 'add_qa_comment': {
      const roundPageId = required(args, 'round_page_id')
      assertSafeIdArgs({ round_page_id: roundPageId })
      const viewport = required(args, 'viewport')
      if (!(VIEWPORT_KEYS as readonly string[]).includes(viewport)) {
        throw new Error('viewport must be one of xl, desktop, tablet, mobile_l, mobile_p')
      }
      const body: Record<string, unknown> = {
        viewport,
        selector: required(args, 'selector'),
        ox: typeof args.ox === 'number' ? args.ox : 0.5,
        oy: typeof args.oy === 'number' ? args.oy : 0.5,
        body: required(args, 'body'),
      }
      const elementTag = str(args, 'element_tag')
      const elementText = str(args, 'element_text')
      const browser = optionalBrowser(args, 'browser')
      if (browser) body.browser = browser
      if (elementTag) body.elementTag = elementTag
      if (elementText) body.elementText = elementText
      return { path: `/api/admin/qa/round-pages/${roundPageId}/comments`, method: 'POST', body }
    }
    case 'update_qa_comment': {
      const commentId = required(args, 'comment_id')
      const requestId = str(args, 'request_id')
      assertSafeIdArgs({ comment_id: commentId, request_id: requestId })
      const body: Record<string, unknown> = {}
      const text = str(args, 'body')
      const status = str(args, 'status')
      if (text) body.body = text
      if (status) body.status = status
      if (requestId) body.requestId = requestId
      if (Object.keys(body).length === 0) throw new Error('body, status or request_id is required')
      return { path: `/api/admin/qa/comments/${commentId}`, method: 'PATCH', body }
    }
    case 'delete_qa_comment': {
      const commentId = required(args, 'comment_id')
      assertSafeIdArgs({ comment_id: commentId })
      return { path: `/api/admin/qa/comments/${commentId}`, method: 'DELETE', body: {} }
    }
    default:
      return null
  }
}
