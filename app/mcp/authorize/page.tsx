import type { Metadata } from 'next'
import { getServerAuth } from '@/lib/server-auth'
import { db } from '@/lib/db'
import { isUsableIdentitySecret, verifyIdentityEnvelope, type McpProfile } from '@/lib/mcp-identity'
import {
  parseConsentCallback,
  resolveMcpConsentEligibility,
  type McpConsentIneligibleReason,
} from '@/lib/mcp-profile-server'

export const metadata: Metadata = {
  title: 'Connect Claude to Tahi Dashboard',
  robots: { index: false, follow: false },
}

export const dynamic = 'force-dynamic'

const PROFILE_LABELS: Record<McpProfile, string> = {
  full: 'Full access',
  designer: 'Designer access',
}

const PROFILE_DESCRIPTIONS: Record<McpProfile, string> = {
  full: 'Full access. Claude can do everything you can do in the dashboard, including billing, clients and settings.',
  designer:
    'Designer access. Claude can read everything, and work on tasks, time and requests. Billing, clients, contracts, sales, team and settings stay read only. Anything a client would see or receive, such as a message, a status change, a step or a deleted file, needs your confirmation in chat first.',
}

const INELIGIBLE_COPY: Record<McpConsentIneligibleReason, string> = {
  not_signed_in: 'Sign in with your Tahi Studio account to connect Claude.',
  not_studio: 'Sign in with your Tahi Studio account to connect Claude. This account is not part of the studio workspace.',
  service_token: 'A service token cannot approve a Claude connection. Sign in as a person.',
  no_team_member: 'Your login is not linked to a team member record yet, so Claude cannot be connected.',
  no_profile: 'Your team member record has no Claude connector access yet. Ask Liam to turn it on.',
}

const CARD =
  'w-full max-w-[32rem] rounded-[var(--radius-md,0.5rem)] border border-[var(--color-border)] bg-[var(--color-bg)] p-6 sm:p-8'
const PRIMARY_BUTTON =
  'inline-flex min-h-[2.75rem] flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-leaf)] bg-[var(--color-brand-dark)] px-5 py-2 text-sm font-semibold text-white transition-colors hover:underline hover:underline-offset-4 hover:shadow-[0_0_0_0.1875rem_var(--color-brand-100)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]'
const SECONDARY_BUTTON =
  'inline-flex min-h-[2.75rem] flex-1 cursor-pointer items-center justify-center rounded-[var(--radius-md,0.5rem)] border border-[var(--color-border)] bg-transparent px-5 py-2 text-sm font-semibold text-[var(--color-text)] transition-colors hover:border-[var(--color-brand)] hover:bg-[var(--color-bg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]'

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-bg-cream)] px-4 py-8 text-[var(--color-text)]">
      <div className={CARD}>{children}</div>
    </main>
  )
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]">{body}</p>
    </Shell>
  )
}

function hostOf(uri: string): string {
  try {
    return new URL(uri).host
  } catch {
    return uri
  }
}

export default async function McpAuthorizePage({
  searchParams,
}: {
  searchParams: Promise<{ req?: string | string[] }>
}) {
  const params = await searchParams
  const reqToken = Array.isArray(params.req) ? params.req[0] : params.req

  if (!isUsableIdentitySecret(process.env.MCP_IDENTITY_SECRET)) {
    return (
      <Message
        title="Claude connections are not set up"
        body="Claude connections are not set up on the dashboard yet. Ask Liam to finish the setup."
      />
    )
  }

  const claims = await verifyIdentityEnvelope(reqToken, process.env.MCP_IDENTITY_SECRET, 'mcp_consent_request')
  if (!claims || !reqToken || !parseConsentCallback(claims.cb)) {
    return (
      <Message
        title="Connection link not valid"
        body="This connection link has expired or is not valid. Start connecting again from Claude."
      />
    )
  }

  const { userId, orgId } = await getServerAuth()
  const eligibility = await resolveMcpConsentEligibility(await db(), { userId, orgId })
  if (!eligibility.ok) {
    return <Message title="Cannot connect Claude" body={INELIGIBLE_COPY[eligibility.reason]} />
  }

  const { member, profile } = eligibility

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Connect Claude</h1>
      <p className="mt-2 text-sm text-[var(--color-text-muted)]">
        Signed in as {member.name} ({member.email})
      </p>

      <section className="mt-6 rounded-[var(--radius-md,0.5rem)] bg-[var(--color-bg-secondary)] p-4">
        <h2 className="text-sm font-semibold">{PROFILE_LABELS[profile]}</h2>
        <p className="mt-1 text-sm leading-relaxed text-[var(--color-text-muted)]">{PROFILE_DESCRIPTIONS[profile]}</p>
      </section>

      <section className="mt-6 text-sm">
        <p className="text-[var(--color-text-muted)]">Claude will receive its access at:</p>
        <p className="mt-1 font-bold">{hostOf(claims.ruri)}</p>
        <p className="mt-1 break-all text-xs text-[var(--color-text-muted)]">{claims.ruri}</p>
        <p className="mt-3 break-all text-xs text-[var(--color-text-muted)]">Client id: {claims.cid}</p>
      </section>

      <form method="post" action="/api/mcp/consent" className="mt-8 flex flex-col gap-3 sm:flex-row-reverse">
        <input type="hidden" name="req" value={reqToken} />
        <button type="submit" name="decision" value="approve" className={PRIMARY_BUTTON}>
          Approve
        </button>
        <button type="submit" name="decision" value="deny" className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </form>

      <p className="mt-6 text-xs leading-relaxed text-[var(--color-text-muted)]">
        Claude keeps this access until you disconnect the connector or Liam changes your access.
      </p>
    </Shell>
  )
}
