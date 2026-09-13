/**
 * <SeatInviteEmail>: the "you have been added" email for a second seat.
 *
 * Sent whenever an existing workspace admin invites a colleague to join
 * alongside them, either a client admin adding a teammate to their own
 * organisation (audience 'client') or a Tahi admin adding a new hire to the
 * Tahi Studio workspace (audience 'team').
 *
 * WHY THIS TEMPLATE EXISTS RATHER THAN CLERK'S OWN. Clerk's
 * `organizations.createOrganizationInvitation` sends its own email from
 * Clerk's systems the moment it is called, with no way to suppress it (the
 * Backend API's org-invitation params carry no `notify` flag, unlike the
 * plain, non-org Invitation API). The only way to keep a seat invite in the
 * Studio Ledger kit and off Clerk's transport is to never call that endpoint:
 * mint an app-side onboardingInvites token instead (lib/onboarding-invites.ts)
 * and email THIS template through lib/email-delivery.ts. The accept link
 * carries the token; Clerk never emails.
 *
 * The link is bound to the recipient's email address server side (see
 * app/api/portal/accept-invite/route.ts for the client audience and
 * app/api/admin/team/accept-invite/route.ts for the team audience), which is
 * why the copy says so plainly and why forwarding it is useless.
 */
import { STUDIO_TIME_ZONE } from '@/lib/kickoff-slot'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailKicker,
  EmailHeading,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  PrimaryButton,
} from './_components'

export type SeatInviteAudience = 'client' | 'team'

interface SeatInviteEmailProps {
  /** The person being invited. Falls back to their email's local part. */
  contactName: string
  /** Who sent the invite, e.g. "Liam Miller". */
  inviterName: string
  /** The workspace they are joining: a client org name, or "Tahi Studio". */
  orgName: string
  inviteUrl: string
  /** The address the link is bound to. Shown so a mismatch is self-diagnosing. */
  boundEmail: string
  /** ISO timestamp. Rendered as a plain date when present. */
  expiresAt?: string | null
  /** Client teammate joining a workspace, or a Tahi hire joining the studio. */
  audience: SeatInviteAudience
}

function formatExpiry(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  return new Date(ms).toLocaleDateString('en-NZ', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    // The recipient reads this in New Zealand. UTC understated the last
    // valid day by one for every expiry after 12:00 UTC.
    timeZone: STUDIO_TIME_ZONE,
  })
}

const WHAT_YOULL_SEE: Record<SeatInviteAudience, string> = {
  client: 'requests, invoices, files and messages, the same portal the rest of your team already uses',
  team: 'the Tahi Studio dashboard: clients, requests, tasks and time, the same as the rest of the team',
}

const KICKER: Record<SeatInviteAudience, string> = {
  client: 'You are invited',
  team: 'Joining the studio',
}

export function SeatInviteEmail({
  contactName,
  inviterName,
  orgName,
  inviteUrl,
  boundEmail,
  expiresAt,
  audience,
}: SeatInviteEmailProps) {
  const firstName = contactName.split(' ')[0] ?? contactName
  const expiry = formatExpiry(expiresAt)

  return (
    <EmailDocument preview={`${inviterName} invited you to ${orgName} on Tahi`}>
      <EmailCard>
        <EmailNav label="Invitation" />
        <EmailHero>
          <EmailKicker>{KICKER[audience]}</EmailKicker>
          <EmailHeading>You have been added to {orgName}.</EmailHeading>
          <EmailParagraph>
            Hi {firstName}, {inviterName} invited you to join {orgName} on Tahi. Use the button below to
            accept. Once you are in you will see {WHAT_YOULL_SEE[audience]}.
          </EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Invited by" value={inviterName} />
            <LedgerRow label="Joining" value={orgName} />
            <LedgerRow label="Invite sent to" value={boundEmail} />
            {expiry ? <LedgerRow label="Link valid until" value={expiry} /> : null}
          </LedgerRows>

          <Buttons>
            <PrimaryButton href={inviteUrl}>Accept invitation</PrimaryButton>
          </Buttons>

          <EmailParagraph variant="small">
            This link only works for {boundEmail}, so forwarding it will not give anyone else
            access. Not expecting this, or need it sent to a different address? Just reply to
            this email and we will sort it out.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience={audience === 'team' ? 'team' : 'client'} recipientEmail={boundEmail} />
    </EmailDocument>
  )
}

export default SeatInviteEmail
