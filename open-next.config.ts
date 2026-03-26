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
  // Webflow Cloud's OpenNext validator requires external: true.
  // To work around the Clerk auth() middleware-detection issue, all server-side
  // auth checks use lib/server-auth.ts which falls back to @clerk/backend
  // direct cookie validation when the middleware headers aren't forwarded.
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
