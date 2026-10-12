# Tahi Dashboard MCP worker

The MCP server Claude connects to. It speaks MCP JSON-RPC over HTTP and proxies
tool calls to the dashboard API at `https://portal.tahi.studio` using the
worker's own `TAHI_API_TOKEN`, which is a full admin token. Every connector
session belongs to one Tahi team member with one MCP profile (Decision #070),
so the front door and the profile table matter more than usual.

Deploy from this directory:

```bash
npx wrangler deploy
```

## Per-person sessions and profiles (Decision #070)

- Consent is a Clerk sign-in on the dashboard, not a shared key. The person
  must be signed in to the Tahi Studio org, have a `team_members` row linked
  to their Clerk login, and have `team_members.mcp_profile` set (migration
  0112). NULL means no connector access.
- Profiles live in `src/tool-profiles.ts`: `full` is every tool, exactly as
  before; `designer` reads everything, writes tasks, time and requests, and
  sends client-visible messages only with `confirmed: true` after the person
  said yes in chat. Anything not listed there is blocked for the designer, so
  new tools are safe by default. tools/list hides what tools/call refuses.
- Every dashboard call carries `TAHI_API_TOKEN` (the authorisation, unchanged)
  plus a signed `x-tahi-mcp-actor` header naming the person, which the
  dashboard uses only for the recorded actor (lib/server-auth.ts,
  lib/mcp-actor.ts).
- Revoke one person: set their `team_members.mcp_profile` to NULL. Their
  next refresh (at most 24 hours later) is refused and nothing else changes.
- Change a profile: update the column; their next refresh is refused and they
  reconnect into the new profile.

## Secrets

Nothing here carries a committed credential. Set each secret once, from this
directory:

```bash
npx wrangler secret put TAHI_API_TOKEN
npx wrangler secret put OAUTH_CLIENT_ID
npx wrangler secret put OAUTH_CLIENT_SECRET       # connector setting only, signs nothing
npx wrangler secret put OAUTH_TOKEN_SIGNING_KEY   # its own value, 32+ chars, signs codes and tokens
npx wrangler secret put MCP_IDENTITY_SECRET       # same value as the dashboard's, 32+ chars
npx wrangler secret put OAUTH_TOKEN_EPOCH         # optional emergency lever, `date +%s`
npx wrangler secret put MANYREQUESTS_API_TOKEN
```

`MCP_IDENTITY_SECRET` must also be set on the dashboard worker with the same
value. Without it, or without `OAUTH_TOKEN_SIGNING_KEY`, `/authorize`
answers 503 and no code is minted. Rotating `OAUTH_TOKEN_SIGNING_KEY` ends
every session. The `client_credentials` grant is gone.
`OAUTH_APPROVAL_KEY` is no longer read and can be deleted
(`npx wrangler secret delete OAUTH_APPROVAL_KEY`) once the cutover is done.

Optional, only if you need them:

- `OAUTH_REDIRECT_HOSTS`: extra callback hosts, comma separated. `claude.ai`,
  `claude.com`, their subdomains, and loopback are always allowed.
- `MANYREQUESTS_BASE_URL`: overrides the default ManyRequests API base URL.

`wrangler secret list` shows what is set. Values are write only after that.

### Revoking issued tokens

Access tokens (24 hours) and refresh tokens (30 days) are self contained
signed blobs carrying the person's team member id and profile. Day to day,
revoke a person by clearing their `mcp_profile`: every refresh asks the
dashboard (`GET /api/admin/mcp/identity`) whether they are still active with
the same profile and Clerk login.

Tokens minted by the retired shared-key flow carry no identity and are
refused outright, so deploying this version ends every old session.

`OAUTH_TOKEN_EPOCH` stays as the emergency lever for a leaked signing secret.
Every token carries an `iat`, and the worker refuses any token whose `iat` is
below the epoch:

```bash
date +%s | npx wrangler secret put OAUTH_TOKEN_EPOCH
npx wrangler deploy
```

`GET /` reports `tokenEpochSet` (a boolean, never the value).

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

OAuth 2.1 authorization code with PKCE. Consent is a Clerk sign-in on the
dashboard.

1. Claude reads `/.well-known/oauth-protected-resource` and
   `/.well-known/oauth-authorization-server`.
2. Claude opens `GET /authorize?...` in the browser. The worker validates
   `response_type=code`, the client id, `code_challenge_method=S256`, and that
   `redirect_uri` is on the allowlist, signs those parameters into a ten
   minute `mcp_consent_request`, and redirects to
   `https://portal.tahi.studio/mcp/authorize?req=...`. Nothing is minted.
3. The dashboard page (signed-out visitors go through /sign-in first) shows
   who is signing in, the profile they will get, and the full callback
   address. Approve posts to `/api/mcp/consent`, which checks the Origin, the
   Clerk session, the team member and the profile, and sends the browser to
   `GET /authorize/callback` with the request and a two minute `mcp_consent`
   assertion. Cancel sends `error=access_denied` instead.
4. The worker verifies both envelopes, checks the nonces match and the
   callback is still allowlisted, mints a two minute code bound to the PKCE
   challenge, the redirect URI and the person, and 302s to the callback.
5. Claude exchanges the code at `POST /oauth/token` with its PKCE verifier and
   receives an access token (24 hours) plus a refresh token (30 days).

The callback also requires the `__Host-tahi_mcp_consent` cookie set at
`GET /authorize`, so an approval only completes in the browser that started
the flow. Codes live two minutes. Failed callbacks are throttled per source
address (eight in ten minutes) and logged. `POST /authorize` (the old key
form) answers 410.

Every id-named tool argument must match `^[A-Za-z0-9_-]{1,128}$` and every
dashboard path must normalise to itself (`src/path-safety.ts`), so an
argument like `../invoices/X` cannot steer a call to another route. The
dashboard adds its own check: a write carrying a designer actor outside
`lib/mcp-designer-routes.ts` is answered as unauthenticated.

Refreshing an existing session does not show the consent screen. Every
refresh rejection is logged with a reason code (`signature_or_expiry`,
`epoch`, `no_identity`, `inactive`, `profile_changed`, `login_changed`;
`inactive` includes leaving the Tahi Clerk org), never
the token, so `npx wrangler tail` shows why a person was asked to reconnect.
Only a 200 with a definite answer revokes. Any other answer from the
identity check (a 404 during a deploy, a 403, a 429, a 5xx) returns 503, so
Claude keeps the refresh token and retries.

## Client view mode over MCP

Three tools cover the Act as client surface, and only two of them do anything
useful from here.

- `get_client_view_mode` reports the caller's own mode (`view` or `act`), which
  client the preview points at, and whether the caller may act at all.
- `set_client_view_mode` arms or disarms it. Arming needs a super admin session
  that is already previewing a client, so over this connector it is expected to
  answer 403: the mode is a browser cookie and this server authenticates with
  the service token, which has no `team_members` row and therefore nobody to
  attribute a client-workspace write to. Disarming (`mode: 'view'`) always
  succeeds, which makes it the safe half.
- `list_acting_as_audit` is the one worth reaching for. It reads the
  `acting_as_client.*` audit trail with actor and target names resolved: what
  the studio filed, replied, approved or reordered inside a client's workspace,
  by whom, and when. It asks `/api/admin/audit?actionPrefix=acting_as_client.`,
  and that endpoint treats underscores as literal characters (it escapes the
  LIKE wildcards rather than deleting them). It briefly did the opposite, which
  turned the prefix into `actingasclient.` and made this tool answer "nothing
  happened" no matter what the studio had done.

The reason `set_client_view_mode` cannot be made to work service-side is worth
stating rather than treating as a gap. An acting write is only safe because it
is attributable to a named person on the roster who agreed to a confirm dialog
naming the client. A service token satisfies neither half, so granting it would
turn "the studio did this" into "something did this".

## Tests

`workers/**` is excluded from the app's Vitest run, so the pure helpers used by
the consent step live in `src/oauth-approval.ts` and are tested from
`app/api/__tests__/mcp-oauth-approval.test.ts`. Type-check this worker on its
own config:

```bash
npx tsc --noEmit -p workers/mcp-server/tsconfig.json
```
