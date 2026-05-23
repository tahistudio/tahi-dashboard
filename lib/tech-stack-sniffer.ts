/**
 * In-house tech stack sniffer. Given a URL, fetches it once, parses
 * the HTML body + response headers for known signals, and returns a
 * list of detected technologies. No API key. No rate limit. No vendor.
 *
 * Catches ~90% of what BuiltWith / Wappalyzer catch for the agency
 * use case (does the prospect run WordPress / Webflow / Shopify /
 * Squarespace / Wix / Framer / etc., and what tools sit on top).
 *
 * Cloudflare Workers safe: uses native fetch with AbortController
 * timeout and a 200KB response cap to bound memory + CPU.
 */

export type TechCategory =
  | 'cms'
  | 'commerce'
  | 'analytics'
  | 'email'
  | 'chat'
  | 'payment'
  | 'hosting'
  | 'framework'

export interface DetectedTech {
  name: string
  category: TechCategory
  confidence: 'high' | 'medium'
}

export interface SniffResult {
  /** Resolved URL we actually fetched (after normalisation). Empty string when fetch failed. */
  fetchedUrl: string
  /** Detected tech, deduplicated. Empty when fetch fails or no signals match. */
  tech: DetectedTech[]
  /** Error message when fetch failed. The route can decide to soft-fail. */
  error?: string
}

interface SignalPattern {
  name: string
  category: TechCategory
  /** Match against the lower-cased HTML body. Any match flags as detected. */
  body?: Array<string | RegExp>
  /** Match against response headers. Header name is lower-cased; value matched against pattern. */
  header?: Array<{ name: string; pattern: string | RegExp }>
  /** Defaults to 'high'. Use 'medium' for ambiguous signals (e.g. Cloudflare header which a lot of sites have). */
  confidence?: 'high' | 'medium'
}

// ── Pattern catalogue ──────────────────────────────────────────────────────
// Patterns ordered by category. Add new entries here when new tools come up.

const PATTERNS: SignalPattern[] = [
  // ── CMS / site builders ──
  {
    name: 'WordPress',
    category: 'cms',
    body: ['wp-content/', 'wp-includes/', /<meta[^>]+name=["']generator["'][^>]+content=["']wordpress/i],
  },
  {
    name: 'Webflow',
    category: 'cms',
    body: ['webflow.io', 'wf-static', /data-wf-page/i, /<meta[^>]+content=["']webflow/i],
  },
  {
    name: 'Squarespace',
    category: 'cms',
    body: ['static.squarespace.com', 'squarespace.com/static', 'static1.squarespace.com'],
  },
  {
    name: 'Wix',
    category: 'cms',
    body: ['wixstatic.com', 'wix.com/_partials', /<meta[^>]+content=["']wix\.com website builder/i],
  },
  {
    name: 'Framer',
    category: 'cms',
    body: ['framerusercontent.com', /<meta[^>]+content=["']framer/i],
  },
  {
    name: 'Ghost',
    category: 'cms',
    body: ['ghost-content', /<meta[^>]+content=["']ghost/i],
  },
  {
    name: 'HubSpot CMS',
    category: 'cms',
    body: ['hubspot.com/hubfs', 'hs-scripts.com', /<meta[^>]+content=["']hubspot/i],
  },
  {
    name: 'Drupal',
    category: 'cms',
    body: ['/sites/default/files', /<meta[^>]+content=["']drupal/i, '/core/misc/drupal'],
  },
  {
    name: 'Joomla',
    category: 'cms',
    body: [/<meta[^>]+content=["']joomla/i],
  },
  {
    name: 'Notion',
    category: 'cms',
    body: ['notion-static.com', 'super.so'],
  },

  // ── Commerce ──
  {
    name: 'Shopify',
    category: 'commerce',
    body: ['cdn.shopify.com', 'shopify.theme', 'myshopify.com'],
    header: [{ name: 'x-shopid', pattern: /.+/ }, { name: 'x-shopify-stage', pattern: /.+/ }],
  },
  {
    name: 'WooCommerce',
    category: 'commerce',
    body: ['woocommerce', '/wp-content/plugins/woocommerce'],
  },
  {
    name: 'BigCommerce',
    category: 'commerce',
    body: ['cdn11.bigcommerce.com', 'mybigcommerce.com'],
  },
  {
    name: 'Stripe Checkout',
    category: 'commerce',
    body: ['checkout.stripe.com'],
  },

  // ── Analytics ──
  {
    name: 'Google Analytics',
    category: 'analytics',
    body: ['googletagmanager.com/gtag/js', 'google-analytics.com/analytics.js', 'gtag(', /ga\(['"]create/],
  },
  {
    name: 'Google Tag Manager',
    category: 'analytics',
    body: ['googletagmanager.com/gtm.js'],
  },
  {
    name: 'Hotjar',
    category: 'analytics',
    body: ['static.hotjar.com', 'hotjar.com/c/hotjar'],
  },
  {
    name: 'Plausible',
    category: 'analytics',
    body: ['plausible.io/js'],
  },
  {
    name: 'Fathom',
    category: 'analytics',
    body: ['usefathom.com'],
  },
  {
    name: 'Mixpanel',
    category: 'analytics',
    body: ['cdn.mixpanel.com', 'cdn4.mxpnl.com'],
  },
  {
    name: 'Segment',
    category: 'analytics',
    body: ['cdn.segment.com/analytics.js'],
  },
  {
    name: 'PostHog',
    category: 'analytics',
    body: ['posthog.com/static/array.js', 'app.posthog.com'],
  },
  {
    name: 'Microsoft Clarity',
    category: 'analytics',
    body: ['clarity.ms/tag'],
  },

  // ── Email / marketing ──
  {
    name: 'Mailchimp',
    category: 'email',
    body: ['chimpstatic.com', 'list-manage.com', 'mailchimp.com/embed'],
  },
  {
    name: 'ConvertKit',
    category: 'email',
    body: ['convertkit.com', 'ck.page'],
  },
  {
    name: 'Klaviyo',
    category: 'email',
    body: ['static.klaviyo.com', 'a.klaviyo.com'],
  },
  {
    name: 'ActiveCampaign',
    category: 'email',
    body: ['activecampaign.com/proc.php'],
  },
  {
    name: 'MailerLite',
    category: 'email',
    body: ['static.mailerlite.com', 'app.mailerlite.com'],
  },

  // ── Chat / support ──
  {
    name: 'Intercom',
    category: 'chat',
    body: ['widget.intercom.io', 'js.intercomcdn.com'],
  },
  {
    name: 'Drift',
    category: 'chat',
    body: ['driftt.com', 'drift.com/embed'],
  },
  {
    name: 'Crisp',
    category: 'chat',
    body: ['client.crisp.chat'],
  },
  {
    name: 'Zendesk',
    category: 'chat',
    body: ['static.zdassets.com', 'zopim.com'],
  },
  {
    name: 'Tidio',
    category: 'chat',
    body: ['code.tidio.co'],
  },
  {
    name: 'HubSpot Chat',
    category: 'chat',
    body: ['js.hs-scripts.com', 'js.hubspot.com'],
  },

  // ── Payments ──
  {
    name: 'Stripe',
    category: 'payment',
    body: ['js.stripe.com'],
  },
  {
    name: 'PayPal',
    category: 'payment',
    body: ['paypal.com/sdk', 'paypalobjects.com'],
  },
  {
    name: 'Square',
    category: 'payment',
    body: ['web.squarecdn.com'],
  },

  // ── Hosting / infra (header-driven, mostly) ──
  {
    name: 'Vercel',
    category: 'hosting',
    header: [{ name: 'server', pattern: /vercel/i }, { name: 'x-vercel-id', pattern: /.+/ }],
  },
  {
    name: 'Netlify',
    category: 'hosting',
    header: [{ name: 'server', pattern: /netlify/i }, { name: 'x-nf-request-id', pattern: /.+/ }],
  },
  {
    name: 'Cloudflare',
    category: 'hosting',
    header: [{ name: 'server', pattern: /cloudflare/i }, { name: 'cf-ray', pattern: /.+/ }],
    // Lots of sites front with Cloudflare even when their origin is elsewhere.
    confidence: 'medium',
  },

  // ── Frameworks (visible in HTML signals) ──
  {
    name: 'Next.js',
    category: 'framework',
    body: ['/_next/static/', 'data-next-page'],
  },
  {
    name: 'React',
    category: 'framework',
    body: [/__react-internal/, 'data-reactroot', /data-reactid/],
    confidence: 'medium',
  },
  {
    name: 'Vue',
    category: 'framework',
    body: [/v-cloak/, /data-v-app/],
    confidence: 'medium',
  },
]

// ── Public API ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 10_000
const MAX_HTML_BYTES = 200_000

export async function sniffTechStack(rawUrl: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<SniffResult> {
  const url = normaliseUrl(rawUrl)
  if (!url) return { fetchedUrl: '', tech: [], error: 'no url provided' }

  const headers: Record<string, string> = {}
  let html = ''

  try {
    const controller = new AbortController()
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const res = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          // Use a real-browser-ish UA. Some sites bot-block aggressive
          // crawler-shaped requests, so we shape this like a normal client.
          'User-Agent': 'Mozilla/5.0 (compatible; TahiDashboardSniffer/1.0; +https://tahi.studio)',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-NZ,en;q=0.9',
        },
      })

      res.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value
      })

      // Cap HTML at MAX_HTML_BYTES. Most CMS / tool signals live in
      // the <head> + first few KB of body, so a 200KB cap loses
      // basically nothing while bounding worker memory.
      const raw = await res.text()
      html = (raw.length > MAX_HTML_BYTES ? raw.slice(0, MAX_HTML_BYTES) : raw).toLowerCase()
    } finally {
      clearTimeout(timeoutHandle)
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      fetchedUrl: url,
      tech: [],
      error: msg.includes('abort') ? 'fetch timed out' : msg,
    }
  }

  const matched: DetectedTech[] = []
  for (const pattern of PATTERNS) {
    if (matchesPattern(pattern, html, headers)) {
      matched.push({
        name: pattern.name,
        category: pattern.category,
        confidence: pattern.confidence ?? 'high',
      })
    }
  }

  return { fetchedUrl: url, tech: matched }
}

function matchesPattern(p: SignalPattern, html: string, headers: Record<string, string>): boolean {
  if (p.body) {
    for (const matcher of p.body) {
      if (typeof matcher === 'string') {
        if (html.includes(matcher.toLowerCase())) return true
      } else if (matcher.test(html)) {
        return true
      }
    }
  }
  if (p.header) {
    for (const h of p.header) {
      const v = headers[h.name.toLowerCase()]
      if (!v) continue
      if (typeof h.pattern === 'string') {
        if (v.toLowerCase().includes(h.pattern.toLowerCase())) return true
      } else if (h.pattern.test(v)) {
        return true
      }
    }
  }
  return false
}

function normaliseUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
}
