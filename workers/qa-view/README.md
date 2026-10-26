# Tahi QA view worker

The sandbox proxy for the Site QA tester. It loads a client's public site
through `/v/<token>/...`, rewrites links so navigation stays inside the proxy,
and injects a scanner (`/__qa/scanner.js`) that runs axe-core and collects SEO,
content, layout and performance facts for the dashboard.

## Why a separate origin

The worker is served on its own origin, never the dashboard's. Client site
JavaScript runs inside the proxied page, so it must not be able to read
dashboard cookies or call dashboard APIs. The worker strips the upstream
`Content-Security-Policy`, `X-Frame-Options` and `Set-Cookie` headers and sets
`frame-ancestors` to the dashboard origin only.

## Secrets

Set from this directory. Values never live in git:

```bash
npx wrangler secret put QA_VIEW_SECRET   # same value as the dashboard's QA_VIEW_SECRET
```

`QA_VIEW_SECRET` verifies the HMAC view tokens the dashboard signs. Tokens
expire after 12 hours.

## Build and run

```bash
npm ci
npm run build:scanner   # bundles src/scanner (+ axe-core) into src/generated/scanner.bundle.js
npm run dev             # build:scanner, then wrangler dev
```

`src/generated/` is git-ignored. The bundle is rebuilt by the `build` command in
`wrangler.jsonc` before every deploy.

## Deploy

Deploys run from `.github/workflows/qa-view-deploy.yml` on push to `main` when
this directory or `lib/qa` changes. To deploy by hand, from this directory:

```bash
npx wrangler deploy --config wrangler.jsonc
```

## Shared code

The pure helpers (`lib/qa/token.ts`, `lib/qa/ssrf.ts`, `lib/qa/proxy-rules.ts`,
`lib/qa/types.ts`) live in the root app and are unit tested by the root Vitest
run. This worker imports them by relative path.
