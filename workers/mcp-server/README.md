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

## Cutover gate: merging this branch does not close the hole

Two of the three Tier 1 security items only take effect once someone runs the
commands below. Until all four steps are done, treat items 14 and 15 as open,
whatever the branch says.

1. **Rotate `MANYREQUESTS_API_TOKEN` in ManyRequests**, then
   `npx wrangler secret put MANYREQUESTS_API_TOKEN` with the new value. The old
   one is in git history and is live until it is rotated at the source.
2. **Rotate `OAUTH_CLIENT_SECRET`** (`npx wrangler secret put
   OAUTH_CLIENT_SECRET`). It signs every token, so a new value invalidates
   everything issued under the old one.
3. **Set `OAUTH_APPROVAL_KEY`** to a long random value (`openssl rand -base64
   32`), not a reused secret.
4. **Set `OAUTH_TOKEN_EPOCH` to now** (`date +%s`), then `npx wrangler deploy`.
   Every token minted before that instant is refused from the next request on.

Step 4 is what actually retires the tokens the old auto-approving endpoint
handed out. Without it, a refresh token grabbed back then keeps minting fresh
24 hour admin tokens over every client's data for up to 30 days, and each
refresh extends the window by another 30 days.

## Secrets

Nothing here carries a committed credential. Set each secret once, from this
directory:

```bash
npx wrangler secret put TAHI_API_TOKEN
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_CLIENT_SECRET
npx wrangler secret put OAUTH_APPROVAL_KEY        # long and random, see below
npx wrangler secret put OAUTH_TOKEN_EPOCH         # `date +%s` at deploy time
npx wrangler secret put MANYREQUESTS_API_TOKEN
```

Optional, only if you need them:

- `OAUTH_REDIRECT_HOSTS`: extra callback hosts, comma separated. `claude.ai`,
  `claude.com`, their subdomains, and loopback are always allowed.
- `MANYREQUESTS_BASE_URL`: overrides the default ManyRequests API base URL.

`wrangler secret list` shows what is set. Values are write only after that.

### Revoking issued tokens

Access tokens (24 hours) and refresh tokens (30 days) are self contained
signed blobs. There is no server side session table to delete a row from, and
the refresh grant issues a fresh 30 day refresh token on every use, so an
unrevoked leak does not age out on its own.

`OAUTH_TOKEN_EPOCH` is the lever. Every token carries an `iat` (issued at) in
unix seconds, and the worker refuses any token whose `iat` is below the epoch,
including old tokens that predate the claim and carry no `iat` at all. To kill
every live session:

```bash
date +%s | npx wrangler secret put OAUTH_TOKEN_EPOCH
npx wrangler deploy
```

Claude then walks the consent screen again on its next connection. Leave the
secret unset only if you accept that nothing issued so far can be withdrawn.
`GET /` reports `tokenEpochSet` (a boolean, never the value) so you can
confirm the deploy picked it up.

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
3. A Tahi admin reads the full callback address on that page (host and path,
   because `https://claude.ai/anything-else` looks identical at host level)
   and types the approval key. The page posts back to `POST /authorize`.
4. On a matching key the worker mints a short lived authorization code (10
   minutes, bound to the PKCE challenge and the redirect URI) and 302s to the
   callback. A wrong key re-renders the page with a 401 and no code.
5. Claude exchanges the code at `POST /oauth/token` with its PKCE verifier and
   receives an access token (24 hours) plus a refresh token (30 days), exactly
   as before.

Nothing changes in the Claude connector configuration. The only visible
difference is the consent screen in step 3.

The approval key is `OAUTH_APPROVAL_KEY` when set, otherwise
`OAUTH_CLIENT_SECRET`. Set the dedicated secret, long and random: it can be
rotated without invalidating every issued token (since `OAUTH_CLIENT_SECRET`
also signs them), and it is the value a guesser gets to grind against.

`POST /authorize` is public, so it is throttled: eight rejected keys from one
address inside ten minutes and the endpoint answers 429 until the window
lapses. The counter lives in the worker isolate, which makes it a speed bump
rather than a lock, so the real defence is key length. Every rejection is
logged with the source address, and worker observability is on, so a grinding
attempt is visible in `npx wrangler tail`.

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
