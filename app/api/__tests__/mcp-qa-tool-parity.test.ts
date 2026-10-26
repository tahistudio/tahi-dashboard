/**
 * The worker MCP site QA tools, against the dashboard routes they call.
 *
 * Same reason app/api/__tests__/mcp-feedback-tool-parity.test.ts exists: the
 * mapping is a pure function (workers/mcp-server/src/qa-tools.ts) and the
 * spec lives here, inside app/, which the root vitest run already sweeps
 * (vitest.config.ts excludes workers/**).
 *
 * This spec asserts paths and methods only. It does not check that the
 * app/api/admin/qa route files exist, because those are written alongside
 * this module.
 */
import { describe, it, expect } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'
import { qaToolCall } from '../../../workers/mcp-server/src/qa-tools'
import { toolsForProfile } from '../../../workers/mcp-server/src/tool-profiles'

const QA_TOOL_NAMES = [
  'list_qa_sites',
  'create_qa_site',
  'import_qa_sitemap',
  'list_qa_rounds',
  'start_qa_round',
  'get_qa_round',
  'update_qa_round_page',
  'check_qa_round_links',
  'run_qa_site_checks',
  'get_qa_round_report',
  'update_qa_site',
  'archive_qa_site',
  'add_qa_page',
  'remove_qa_page',
  'update_qa_round',
  'add_qa_round_samples',
  'get_qa_round_page',
  'create_qa_request',
  'run_qa_pagespeed',
  'check_qa_redirect_map',
  'add_qa_pages',
  'crawl_qa_site',
  'list_qa_comments',
  'add_qa_comment',
  'update_qa_comment',
  'delete_qa_comment',
  'list_qa_round_comments',
  'get_qa_comment',
] as const

function call(name: string, args: Record<string, unknown> = {}) {
  const mapped = qaToolCall(name, args)
  if (!mapped) throw new Error(`${name} is not mapped`)
  return mapped
}

describe('list_qa_sites', () => {
  it('lists every site without a filter', () => {
    const mapped = call('list_qa_sites')
    expect(mapped.path).toBe('/api/admin/qa/sites')
    expect(mapped.method).toBe('GET')
  })

  it('narrows to one client with orgId', () => {
    const mapped = call('list_qa_sites', { org_id: 'org_1' })
    expect(mapped.path).toBe('/api/admin/qa/sites?orgId=org_1')
    expect(mapped.method).toBe('GET')
  })
})

describe('create_qa_site', () => {
  it('posts the site with camel case body keys', () => {
    const mapped = call('create_qa_site', {
      org_id: 'org_1',
      name: 'Acme',
      staging_url: 'https://stage.acme.test',
      live_url: 'https://acme.test',
      notes: 'Webflow build',
    })
    expect(mapped.path).toBe('/api/admin/qa/sites')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({
      orgId: 'org_1',
      name: 'Acme',
      stagingUrl: 'https://stage.acme.test',
      liveUrl: 'https://acme.test',
      notes: 'Webflow build',
    })
  })

  it('omits the optional URLs and notes when not given', () => {
    const mapped = call('create_qa_site', { org_id: 'org_1', name: 'Acme', live_url: 'https://acme.test' })
    expect(mapped.body).toEqual({ orgId: 'org_1', name: 'Acme', liveUrl: 'https://acme.test' })
  })

  it('requires org_id and name', () => {
    expect(() => call('create_qa_site', { name: 'Acme' })).toThrow('org_id is required')
    expect(() => call('create_qa_site', { org_id: 'org_1' })).toThrow('name is required')
  })
})

describe('import_qa_sitemap', () => {
  it('posts the target to the site import route', () => {
    const mapped = call('import_qa_sitemap', { site_id: 'site_1', target: 'live' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/import-sitemap')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ target: 'live' })
  })

  it('passes an optional sitemap_url as sitemapUrl', () => {
    const mapped = call('import_qa_sitemap', { site_id: 'site_1', target: 'staging', sitemap_url: 'https://acme.test/sitemap.xml' })
    expect(mapped.body).toEqual({ target: 'staging', sitemapUrl: 'https://acme.test/sitemap.xml' })
    expect(call('import_qa_sitemap', { site_id: 'site_1', target: 'staging', sitemap_url: '' }).body).toEqual({ target: 'staging' })
  })

  it('requires site_id and target', () => {
    expect(() => call('import_qa_sitemap', { target: 'live' })).toThrow('site_id is required')
    expect(() => call('import_qa_sitemap', { site_id: 'site_1' })).toThrow('target is required')
  })
})

describe('list_qa_rounds', () => {
  it('gets the rounds of one site', () => {
    const mapped = call('list_qa_rounds', { site_id: 'site_1' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/rounds')
    expect(mapped.method).toBe('GET')
  })

  it('requires site_id', () => {
    expect(() => call('list_qa_rounds', {})).toThrow('site_id is required')
  })
})

describe('start_qa_round', () => {
  it('posts a new round on the site', () => {
    const mapped = call('start_qa_round', { site_id: 'site_1', name: 'Launch check', target: 'staging' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/rounds')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ name: 'Launch check', target: 'staging' })
  })

  it('requires site_id, name and target', () => {
    expect(() => call('start_qa_round', { name: 'x', target: 'live' })).toThrow('site_id is required')
    expect(() => call('start_qa_round', { site_id: 'site_1', target: 'live' })).toThrow('name is required')
    expect(() => call('start_qa_round', { site_id: 'site_1', name: 'x' })).toThrow('target is required')
  })
})

describe('get_qa_round', () => {
  it('gets one round by id', () => {
    const mapped = call('get_qa_round', { round_id: 'round_1' })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1')
    expect(mapped.method).toBe('GET')
  })

  it('requires round_id', () => {
    expect(() => call('get_qa_round', {})).toThrow('round_id is required')
  })
})

describe('update_qa_round_page', () => {
  it('patches status, note and viewport ticks, mapping viewports to vp', () => {
    const mapped = call('update_qa_round_page', {
      round_page_id: 'rp_1',
      status: 'fail',
      note: 'Hero overflows at 375px',
      viewports: { mobile_p: true, xl: false },
    })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1')
    expect(mapped.method).toBe('PATCH')
    expect(mapped.body).toEqual({
      status: 'fail',
      note: 'Hero overflows at 375px',
      vp: { xl: false, mobile_p: true },
    })
  })

  it('passes a null note through so the route can clear it', () => {
    const mapped = call('update_qa_round_page', { round_page_id: 'rp_1', note: null })
    expect(mapped.body).toEqual({ note: null })
  })

  it('reads viewport ticks sent as strings and drops unknown keys', () => {
    const mapped = call('update_qa_round_page', {
      round_page_id: 'rp_1',
      viewports: { desktop: 'true', tablet: 'maybe', bogus: true },
    })
    expect(mapped.body).toEqual({ vp: { desktop: true } })
  })

  it('sends an empty body when only the id is given', () => {
    expect(call('update_qa_round_page', { round_page_id: 'rp_1' }).body).toEqual({})
  })

  it('requires round_page_id', () => {
    expect(() => call('update_qa_round_page', { status: 'pass' })).toThrow('round_page_id is required')
  })
})

describe('check_qa_round_links', () => {
  it('posts the urls to the round check-links route', () => {
    const mapped = call('check_qa_round_links', { round_id: 'round_1', urls: ['https://acme.test/a', 'https://acme.test/b'] })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1/check-links')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ urls: ['https://acme.test/a', 'https://acme.test/b'] })
  })

  it('requires round_id and at least one url', () => {
    expect(() => call('check_qa_round_links', { urls: ['https://acme.test/a'] })).toThrow('round_id is required')
    expect(() => call('check_qa_round_links', { round_id: 'round_1' })).toThrow('urls is required')
    expect(() => call('check_qa_round_links', { round_id: 'round_1', urls: [] })).toThrow('urls is required')
  })
})

describe('run_qa_site_checks', () => {
  it('posts to the round site-checks route', () => {
    const mapped = call('run_qa_site_checks', { round_id: 'round_1' })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1/site-checks')
    expect(mapped.method).toBe('POST')
  })

  it('requires round_id', () => {
    expect(() => call('run_qa_site_checks', {})).toThrow('round_id is required')
  })
})

describe('get_qa_round_report', () => {
  it('gets the report for one round', () => {
    const mapped = call('get_qa_round_report', { round_id: 'round_1' })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1/report')
    expect(mapped.method).toBe('GET')
  })

  it('requires round_id', () => {
    expect(() => call('get_qa_round_report', {})).toThrow('round_id is required')
  })
})

describe('site and page management tools', () => {
  it('update_qa_site patches only the given fields and passes null through', () => {
    const mapped = call('update_qa_site', { site_id: 'site_1', name: 'Acme 2', live_url: null, notes: 'x' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1')
    expect(mapped.method).toBe('PATCH')
    expect(mapped.body).toEqual({ name: 'Acme 2', liveUrl: null, notes: 'x' })
    expect(() => call('update_qa_site', { site_id: 'site_1' })).toThrow('Nothing to update')
    expect(() => call('update_qa_site', { name: 'x' })).toThrow('site_id is required')
  })

  it('archive_qa_site deletes the site', () => {
    const mapped = call('archive_qa_site', { site_id: 'site_1' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1')
    expect(mapped.method).toBe('DELETE')
    expect(() => call('archive_qa_site', {})).toThrow('site_id is required')
  })

  it('add_qa_page posts the path', () => {
    const mapped = call('add_qa_page', { site_id: 'site_1', path: '/about' })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/pages')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ path: '/about' })
    expect(() => call('add_qa_page', { site_id: 'site_1' })).toThrow('path is required')
  })

  it('remove_qa_page deletes the page', () => {
    const mapped = call('remove_qa_page', { page_id: 'page_1' })
    expect(mapped.path).toBe('/api/admin/qa/pages/page_1')
    expect(mapped.method).toBe('DELETE')
    expect(() => call('remove_qa_page', {})).toThrow('page_id is required')
  })
})

describe('round tools', () => {
  it('update_qa_round patches name and status', () => {
    const mapped = call('update_qa_round', { round_id: 'round_1', name: 'R2', status: 'closed' })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1')
    expect(mapped.method).toBe('PATCH')
    expect(mapped.body).toEqual({ name: 'R2', status: 'closed' })
    expect(() => call('update_qa_round', { round_id: 'round_1' })).toThrow('name or status is required')
  })

  it('add_qa_round_samples posts groupKey and count', () => {
    const mapped = call('add_qa_round_samples', { round_id: 'round_1', group_key: '/blog/*', count: 5 })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1/samples')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ groupKey: '/blog/*', count: 5 })
    expect(call('add_qa_round_samples', { round_id: 'round_1', group_key: 'g' }).body).toEqual({ groupKey: 'g' })
    expect(() => call('add_qa_round_samples', { round_id: 'round_1' })).toThrow('group_key is required')
  })

  it('get_qa_round_page gets one round page', () => {
    const mapped = call('get_qa_round_page', { round_page_id: 'rp_1' })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1')
    expect(mapped.method).toBe('GET')
  })

  it('create_qa_request posts title, description and viewport', () => {
    const mapped = call('create_qa_request', { round_page_id: 'rp_1', title: 'Broken hero', description: 'd', viewport: 'mobile_p' })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1/create-request')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ title: 'Broken hero', description: 'd', viewport: 'mobile_p' })
    expect(() => call('create_qa_request', { round_page_id: 'rp_1' })).toThrow('title is required')
  })

  it('create_qa_request says it is internal', () => {
    const tool = TOOLS.find((t) => t.name === 'create_qa_request')
    expect(tool?.description).toContain('internal')
    expect(tool?.description).toContain('not shown to the client')
  })

  it('run_qa_pagespeed posts the strategy', () => {
    const mapped = call('run_qa_pagespeed', { round_page_id: 'rp_1', strategy: 'mobile' })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1/pagespeed')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ strategy: 'mobile' })
    expect(() => call('run_qa_pagespeed', { round_page_id: 'rp_1' })).toThrow('strategy is required')
  })

  it('check_qa_redirect_map posts the urls', () => {
    const mapped = call('check_qa_redirect_map', { round_id: 'round_1', urls: ['/old', 'https://acme.test/x'] })
    expect(mapped.path).toBe('/api/admin/qa/rounds/round_1/redirect-map')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ urls: ['/old', 'https://acme.test/x'] })
    expect(() => call('check_qa_redirect_map', { round_id: 'round_1', urls: [] })).toThrow('urls is required')
  })
})

describe('URL caps in the tool text', () => {
  it('states 100 for links and 150 for the redirect map and mentions unchecked', () => {
    const links = TOOLS.find((t) => t.name === 'check_qa_round_links')
    const map = TOOLS.find((t) => t.name === 'check_qa_redirect_map')
    expect(links?.description).toContain('100')
    expect(links?.description).toContain('unchecked')
    expect(map?.description).toContain('150')
    expect(map?.description).toContain('unchecked')
  })
})

describe('add_qa_pages', () => {
  it('posts the paths in one bulk call', () => {
    const mapped = call('add_qa_pages', { site_id: 'site_1', paths: ['/about', '/blog/my-post'] })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/pages')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ paths: ['/about', '/blog/my-post'] })
  })

  it('requires a non-empty array of non-empty strings', () => {
    expect(() => call('add_qa_pages', { paths: ['/a'] })).toThrow('site_id is required')
    expect(() => call('add_qa_pages', { site_id: 'site_1' })).toThrow('paths is required')
    expect(() => call('add_qa_pages', { site_id: 'site_1', paths: [] })).toThrow('paths is required')
    expect(() => call('add_qa_pages', { site_id: 'site_1', paths: '/about' })).toThrow('paths is required')
    expect(() => call('add_qa_pages', { site_id: 'site_1', paths: ['/a', 3] })).toThrow('paths must contain only non-empty strings')
    expect(() => call('add_qa_pages', { site_id: 'site_1', paths: ['/a', ''] })).toThrow('paths must contain only non-empty strings')
  })

  it('describes the Webflow page list use and the 500 cap', () => {
    const tool = TOOLS.find((t) => t.name === 'add_qa_pages')
    expect(tool?.description).toContain('many')
    expect(tool?.description).toContain('500')
    expect(tool?.description).toContain('Webflow')
    expect(tool?.description).toContain('/blog/my-post')
  })
})

describe('crawl_qa_site', () => {
  it('posts the target and camel case maxPages', () => {
    const mapped = call('crawl_qa_site', { site_id: 'site_1', target: 'staging', max_pages: 150 })
    expect(mapped.path).toBe('/api/admin/qa/sites/site_1/crawl')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({ target: 'staging', maxPages: 150 })
  })

  it('omits maxPages when not given', () => {
    expect(call('crawl_qa_site', { site_id: 'site_1', target: 'live' }).body).toEqual({ target: 'live' })
  })

  it('requires site_id and target', () => {
    expect(() => call('crawl_qa_site', { target: 'live' })).toThrow('site_id is required')
    expect(() => call('crawl_qa_site', { site_id: 'site_1' })).toThrow('target is required')
  })
})

describe('element comment tools', () => {
  it('list_qa_comments gets the comments of one round page', () => {
    const mapped = call('list_qa_comments', { round_page_id: 'rp_1' })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1/comments')
    expect(mapped.method).toBe('GET')
    expect(() => call('list_qa_comments', {})).toThrow('round_page_id is required')
  })

  it('list_qa_round_comments gets a whole round, open by default, with an optional status', () => {
    const plain = call('list_qa_round_comments', { round_id: 'r_1' })
    expect(plain.path).toBe('/api/admin/qa/rounds/r_1/comments')
    expect(plain.method).toBe('GET')
    expect(call('list_qa_round_comments', { round_id: 'r_1', status: 'all' }).path).toBe('/api/admin/qa/rounds/r_1/comments?status=all')
    expect(call('list_qa_round_comments', { round_id: 'r_1', status: 'resolved' }).path).toContain('?status=resolved')
    expect(() => call('list_qa_round_comments', { round_id: 'r_1', status: 'closed' })).toThrow('status must be one of')
    expect(() => call('list_qa_round_comments', {})).toThrow('round_id is required')
    expect(() => call('list_qa_round_comments', { round_id: '../x' })).toThrow('round_id is not a valid id')
  })

  it('get_qa_comment gets one comment', () => {
    const mapped = call('get_qa_comment', { comment_id: 'qc_1' })
    expect(mapped.path).toBe('/api/admin/qa/comments/qc_1')
    expect(mapped.method).toBe('GET')
    expect(() => call('get_qa_comment', {})).toThrow('comment_id is required')
    expect(() => call('get_qa_comment', { comment_id: 'a/../b' })).toThrow('comment_id is not a valid id')
  })

  it('the detail tool descriptions tell the assistant how to use what it gets', () => {
    for (const name of ['list_qa_round_comments', 'get_qa_comment']) {
      const description = TOOLS.find((t) => t.name === name)?.description ?? ''
      for (const word of ['pageUrl', 'viewportInfo', 'webflowBreakpoint', 'classes', 'selector', 'box', 'update_qa_comment', 'resolved', 'confirm with the user']) {
        expect(description, `${name} mentions ${word}`).toContain(word)
      }
    }
  })

  it('add_qa_comment posts camel case body keys and defaults ox and oy to 0.5', () => {
    const mapped = call('add_qa_comment', {
      round_page_id: 'rp_1',
      viewport: 'mobile_p',
      selector: '#hero h1',
      body: 'Heading wraps badly',
      element_tag: 'h1',
      element_text: 'Welcome',
    })
    expect(mapped.path).toBe('/api/admin/qa/round-pages/rp_1/comments')
    expect(mapped.method).toBe('POST')
    expect(mapped.body).toEqual({
      viewport: 'mobile_p',
      selector: '#hero h1',
      ox: 0.5,
      oy: 0.5,
      body: 'Heading wraps badly',
      elementTag: 'h1',
      elementText: 'Welcome',
    })
  })

  it('add_qa_comment passes ox and oy through and omits the optional element fields', () => {
    const mapped = call('add_qa_comment', { round_page_id: 'rp_1', viewport: 'xl', selector: 'a.cta', body: 'x', ox: 0.25, oy: 0.9 })
    expect(mapped.body).toEqual({ viewport: 'xl', selector: 'a.cta', ox: 0.25, oy: 0.9, body: 'x' })
  })

  it('add_qa_comment accepts only the five viewport keys', () => {
    for (const viewport of ['xl', 'desktop', 'tablet', 'mobile_l', 'mobile_p']) {
      expect(() => call('add_qa_comment', { round_page_id: 'rp_1', viewport, selector: 'a', body: 'x' })).not.toThrow()
    }
    expect(() => call('add_qa_comment', { round_page_id: 'rp_1', viewport: 'phone', selector: 'a', body: 'x' })).toThrow(
      'viewport must be one of',
    )
  })

  it('add_qa_comment requires round_page_id, viewport, selector and body', () => {
    expect(() => call('add_qa_comment', { viewport: 'xl', selector: 'a', body: 'x' })).toThrow('round_page_id is required')
    expect(() => call('add_qa_comment', { round_page_id: 'rp_1', selector: 'a', body: 'x' })).toThrow('viewport is required')
    expect(() => call('add_qa_comment', { round_page_id: 'rp_1', viewport: 'xl', body: 'x' })).toThrow('selector is required')
    expect(() => call('add_qa_comment', { round_page_id: 'rp_1', viewport: 'xl', selector: 'a' })).toThrow('body is required')
  })

  it('update_qa_comment patches only the given fields', () => {
    const mapped = call('update_qa_comment', { comment_id: 'qc_1', status: 'resolved', request_id: 'req_1' })
    expect(mapped.path).toBe('/api/admin/qa/comments/qc_1')
    expect(mapped.method).toBe('PATCH')
    expect(mapped.body).toEqual({ status: 'resolved', requestId: 'req_1' })
    expect(call('update_qa_comment', { comment_id: 'qc_1', body: 'New text' }).body).toEqual({ body: 'New text' })
  })

  it('update_qa_comment refuses an empty update and requires comment_id', () => {
    expect(() => call('update_qa_comment', { comment_id: 'qc_1' })).toThrow('body, status or request_id is required')
    expect(() => call('update_qa_comment', { status: 'open' })).toThrow('comment_id is required')
  })

  it('delete_qa_comment deletes the comment', () => {
    const mapped = call('delete_qa_comment', { comment_id: 'qc_1' })
    expect(mapped.path).toBe('/api/admin/qa/comments/qc_1')
    expect(mapped.method).toBe('DELETE')
    expect(() => call('delete_qa_comment', {})).toThrow('comment_id is required')
  })

  it('delete_qa_comment says to confirm with the user first', () => {
    const tool = TOOLS.find((t) => t.name === 'delete_qa_comment')
    expect(tool?.description).toContain('Confirm with the user')
  })

  it('refuses a comment id that would steer the path', () => {
    expect(() => call('delete_qa_comment', { comment_id: '../invoices/X' })).toThrow('comment_id is not a valid id')
    expect(() => call('update_qa_comment', { comment_id: 'qc_1', request_id: 'a/../b' })).toThrow('request_id is not a valid id')
  })
})

describe('path safety', () => {
  it('refuses an id that would steer the path to another route', () => {
    expect(() => call('get_qa_round', { round_id: '../invoices/X' })).toThrow('round_id is not a valid id')
    expect(() => call('list_qa_rounds', { site_id: 'site_1/../../x' })).toThrow('site_id is not a valid id')
  })
})

describe('qaToolCall', () => {
  it('returns null for a name it does not own', () => {
    expect(qaToolCall('list_feedback_comments', {})).toBeNull()
    expect(qaToolCall('delete_feedback_comment', { id: 'fb_1' })).toBeNull()
  })
})

describe('registration in the worker tool list', () => {
  const names = new Set(TOOLS.map((t) => t.name))

  it('registers every QA tool once', () => {
    for (const name of QA_TOOL_NAMES) {
      expect(names.has(name), name).toBe(true)
      expect(TOOLS.filter((t) => t.name === name)).toHaveLength(1)
    }
  })

  it('keeps every QA tool description free of dashes', () => {
    for (const tool of TOOLS.filter((t) => (QA_TOOL_NAMES as readonly string[]).includes(t.name))) {
      expect(tool.description, tool.name).not.toMatch(new RegExp('[\\u2013\\u2014]|-{2}'))
    }
  })

  it('exposes the QA tools to the full profile only', () => {
    const full = new Set(toolsForProfile(TOOLS, 'full').map((t) => t.name))
    const designer = new Set(toolsForProfile(TOOLS, 'designer').map((t) => t.name))
    for (const name of QA_TOOL_NAMES) {
      expect(full.has(name), name).toBe(true)
      expect(designer.has(name), name).toBe(false)
    }
  })
})
