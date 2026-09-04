# Tahi Dashboard MCP worker

The MCP server Claude connects to. It speaks MCP JSON-RPC over HTTP and proxies
tool calls to the dashboard API at `https://portal.tahi.studio` using the
worker's own `TAHI_API_TOKEN`, which is a full admin token. Anyone holding a
valid access token for this worker can read and write every client's data, so
the front door matters more than usual.

Deploy from this directory:

```bash
npx wrangler deploy
```

## Secrets

Nothing here carries a committed credential. Set each secret once, from this
directory:

```bash
npx wrangler secret put TAHI_API_TOKEN
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put OAUTH_APPROVAL_KEY        # optional, see below
npx wrangler secret put MANYREQUESTS_API_TOKEN
```

Optional, only if you need them:

- `OAUTH_REDIRECT_HOSTS`: extra callback hosts, comma separated. `claude.ai`,
  `claude.com`, their subdomains, and loopback are always allowed.
- `MANYREQUESTS_BASE_URL`: overrides the default ManyRequests API base URL.

`wrangler secret list` shows what is set. Values are write only after that.

### ManyRequests token

`MANYREQUESTS_API_TOKEN` is the bearer token for the live ManyRequests API,
which still holds real client data. It used to be a literal in `src/index.ts`,
so it is in git history and must be treated as burned: rotate it in
ManyRequests, then set the new value as the secret above.

When the secret is unset, the `manyrequests_*` tools fail with
"ManyRequests is not configured on this worker" and every other tool keeps
working. `GET /` reports `manyRequestsConfigured` so you can check without
touching a tool.

## The authorize flow

OAuth 2.1 authorization code with PKCE, plus a human approval step. The
endpoint used to auto-approve on client id alone, which meant anyone who knew
the client id could mint a full admin token.

1. Claude reads `/.well-known/oauth-protected-resource` and
   `/.well-known/oauth-authorization-server`.
2. Claude opens `GET /authorize?...` in the browser. The worker validates
   `response_type=code`, the client id, `code_challenge_method=S256`, and that
   `redirect_uri` is on the allowlist, then renders a consent page. No
   authorization code is minted here.
3. A Tahi admin reads the callback host on that page and types the approval
   key. The page posts back to `POST /authorize`.
4. On a matching key the worker mints a short lived authorization code (10
   minutes, bound to the PKCE challenge and the redirect URI) and 302s to the
   callback. A wrong key re-renders the page with a 401 and no code.
5. Claude exchanges the code at `POST /oauth/token` with its PKCE verifier and
   receives an access token (24 hours) plus a refresh token (30 days), exactly
   as before.

Nothing changes in the Claude connector configuration. The only visible
difference is the consent screen in step 3.

The approval key is `OAUTH_APPROVAL_KEY` when set, otherwise
`OAUTH_CLIENT_SECRET`. Setting the dedicated secret is better: it can be
rotated without invalidating every issued token, since `OAUTH_CLIENT_SECRET`
also signs them.

Refreshing an existing session does not show the consent screen. Claude keeps
using the refresh token until it expires or is rejected.

## Tests

`workers/**` is excluded from the app's Vitest run, so the pure helpers used by
the consent step live in `src/oauth-approval.ts` and are tested from
`app/api/__tests__/mcp-oauth-approval.test.ts`. Type-check this worker on its
own config:

```bash
npx tsc --noEmit -p workers/mcp-server/tsconfig.json
```
