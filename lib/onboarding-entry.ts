/**
 * Onboarding entry resolution: "here is your link" -> which onboarding is shown.
 *
 * A person always arrives at onboarding via a link, and the link decides the
 * experience. There are three broad cases:
 *
 *   1. Teammate           -> team "Welcome to Tahi" flow (/welcome).
 *   2. Client, self-serve -> client onboarding chooser (retainer or project).
 *   3. Client, invited    -> care-first client onboarding, no payment. When a
 *      project / schedule / contract is already attached to the link, the
 *      engagement is "known" and we skip straight to the right care path
 *      (existing-client kickoff / brief), never asking for payment.
 *
 * The link carries this context through sign-in/sign-up (Clerk redirect_url) so
 * it survives auth and lands the person in the correct flow. For now the
 * context is read from the link's query params; the production upgrade is to
 * issue an opaque invite token and look it up here (see resolveToken seam).
 */

export type OnboardingFlow = 'team' | 'client'

/** Mirrors the persona set from the locked design (Claude design 57bf60cf). */
export type ClientPersona =
  | 'selfserve' // new client, hasn't chosen project vs retainer yet
  | 'retainer' // new client, retainer (self-serve, pays)
  | 'project' // new client, project (invited, proposal/kickoff, no payment)
  | 'existing_project' // existing client opening a new project
  | 'existing_retainer' // existing client opening a new retainer

export interface ClientEntry {
  flow: 'client'
  persona: ClientPersona
  engagement: 'project' | 'retainer'
  clientType: 'new' | 'existing'
  entry: 'selfserve' | 'invited'
  /** True when a project/schedule/contract is already attached to the link. */
  hasEngagement: boolean
  /** Company name when known (invited / existing). */
  companyName?: string
  /** Contact identity for prefill (resolved from the link / Clerk). */
  contactName?: string
  contactEmail?: string
}

export interface TeamEntry {
  flow: 'team'
  firstName?: string
  email?: string
}

type Params = Record<string, string | string[] | undefined>

function one(params: Params, key: string): string | undefined {
  const v = params[key]
  return Array.isArray(v) ? v[0] : v
}

/** Fields an invite token can resolve to (flow-agnostic, all optional). */
interface ResolvedToken {
  persona?: ClientPersona
  companyName?: string
  contactName?: string
  contactEmail?: string
  firstName?: string
  email?: string
}

/**
 * Seam: turn an opaque invite token into entry context. Production should look
 * the token up (an invite / engagement record) and return the resolved fields.
 * Until that table exists, tokens are unresolved and we fall back to query
 * params, so a link like `/onboarding?p=existing_project&company=Acme` works.
 */
function resolveToken(token: string): ResolvedToken | null {
  void token // seam: look up the invite/engagement record here
  return null
}

const CLIENT_PERSONAS: Record<ClientPersona, Omit<ClientEntry, 'flow' | 'companyName' | 'contactName' | 'contactEmail'>> = {
  selfserve: { persona: 'selfserve', engagement: 'project', clientType: 'new', entry: 'selfserve', hasEngagement: false },
  retainer: { persona: 'retainer', engagement: 'retainer', clientType: 'new', entry: 'selfserve', hasEngagement: false },
  project: { persona: 'project', engagement: 'project', clientType: 'new', entry: 'invited', hasEngagement: true },
  existing_project: { persona: 'existing_project', engagement: 'project', clientType: 'existing', entry: 'invited', hasEngagement: true },
  existing_retainer: { persona: 'existing_retainer', engagement: 'retainer', clientType: 'existing', entry: 'invited', hasEngagement: true },
}

/** Build a client entry from a server-trusted persona + prefill values. */
export function clientEntryFromPersona(
  personaKey: ClientPersona,
  extras: { companyName?: string; contactName?: string; contactEmail?: string } = {},
): ClientEntry {
  const base = CLIENT_PERSONAS[personaKey] ?? CLIENT_PERSONAS.selfserve
  return {
    flow: 'client',
    ...base,
    companyName: extras.companyName,
    contactName: extras.contactName,
    contactEmail: extras.contactEmail,
  }
}

/**
 * Resolve the client onboarding entry from the link's query params.
 *
 * Security: the persona may ONLY be chosen via `?p=` in development (so each
 * path can be exercised locally). In production a client's persona comes from a
 * server-resolved invite token (see lib/onboarding-invites.ts + the onboarding
 * page), never a spoofable URL param, so a real visitor with no token always
 * defaults to the self-serve chooser. Prefill values (company / name / email)
 * are display-only and pass through in any environment.
 */
export function resolveClientEntry(params: Params): ClientEntry {
  const devPersona =
    process.env.NODE_ENV !== 'production'
      ? (one(params, 'p') as ClientPersona | undefined)
      : undefined
  const personaKey = (devPersona ?? 'selfserve') as ClientPersona
  return clientEntryFromPersona(personaKey, {
    companyName: one(params, 'company'),
    contactName: one(params, 'name'),
    contactEmail: one(params, 'email'),
  })
}

/** Resolve the teammate onboarding entry from the link's params. */
export function resolveTeamEntry(params: Params): TeamEntry {
  const token = one(params, 'token')
  const fromToken = token ? resolveToken(token) : null
  return {
    flow: 'team',
    firstName: fromToken?.firstName ?? one(params, 'name'),
    email: fromToken?.email ?? one(params, 'email'),
  }
}
