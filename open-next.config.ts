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
  // Keep middleware internal (not external) so that clerkMiddleware() runs
  // in the same Worker context as the RSC server.
  // External middleware runs in a separate Cloudflare Worker and its
  // injected headers (x-clerk-auth-*) are NOT forwarded to the server Worker,
  // causing auth() to throw "Clerk can't detect usage of clerkMiddleware()".
  middleware: {
    external: false,
  },
}

export default config
