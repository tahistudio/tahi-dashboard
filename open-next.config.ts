import type { OpenNextConfig } from '@opennextjs/cloudflare'

const config: OpenNextConfig = {
  default: {
    override: {
      wrapper: 'cloudflare-node',
      converter: 'edge',
      proxyExternalRequest: 'fetch',
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy',
    },
  },
  edgeExternals: ['node:crypto'],
  // @opennextjs/cloudflare REQUIRES middleware.external: true (its config
  // validator rejects the build otherwise) — this is an OpenNext-on-Cloudflare
  // requirement, not a Webflow one. Because middleware runs in a separate edge
  // function, Clerk's auth() may not receive the middleware-injected headers,
  // so all server-side auth goes through lib/server-auth.ts, which falls back
  // to @clerk/backend direct cookie validation (authorizedParties must list
  // every host the app is served from).
  middleware: {
    external: true,
    override: {
      wrapper: 'cloudflare-edge',
      converter: 'edge',
      proxyExternalRequest: 'fetch',
      incrementalCache: 'dummy',
      tagCache: 'dummy',
      queue: 'dummy',
    },
  },
}

export default config
