/**
 * <PreCallDigestEmail>: fires ~30 min before each scheduled discovery call.
 * Gives Liam (or the call host) a single-glance primer: who they are talking
 * to, AI fit assessment, the discovery questions to ask, scope and budget
 * signals, sources to skim.
 *
 * Studio Ledger, team mail: quieter than a client email, no sign-off
 * warmth, neutral kicker. Designed to be readable on a phone while
 * walking to the call.
 */
import { Link } from '@react-email/components'
import { formatSlotSummary } from '@/lib/kickoff-slot'
import {
  Buttons,
  EMAIL_TOKENS,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  Fact,
  Facts,
  LedgerRow,
  LedgerRows,
  Step,
  Steps,
  PrimaryButton,
} from './_components'

export interface PreCallDigestEmailProps {
  callTitle: string
  scheduledAt: string // ISO timestamp
  meetingUrl: string | null
  durationMinutes: number
  withName: string // "Tim Lyons" or company
  withSubtitle: string | null // company / role
  parentHref: string // dashboard URL to the parent record
  dashboardUrl: string

  // Lead context (when call parent is a lead)
  leadEmail?: string | null
  leadCompany?: string | null
  industry?: string | null
  employeeCount?: number | null
  revenueBand?: string | null
  cms?: string | null
  techStack?: string[]
  country?: string | null

  // AI briefing
  aiScore?: number | null
  aiScoreReason?: string | null
  aiSnapshot?: string | null
  aiFit?: string | null
  aiWatchOuts?: string | null

  // Discovery questions to ask (combined: always-ask + lead-specific)
  questions?: string[]

  // Sources (top 3 for quick skim)
  sources?: string[]
}

// Kit colour for the source links: React Email's default link blue is not
// part of the palette.
const sourceLinkStyle = {
  color: EMAIL_TOKENS.brandDark,
  fontWeight: 600,
  textDecoration: 'underline',
} as const

export function PreCallDigestEmail({
  callTitle,
  scheduledAt,
  meetingUrl,
  durationMinutes,
  withName,
  withSubtitle,
  parentHref,
  dashboardUrl,
  leadEmail,
  leadCompany,
  industry,
  employeeCount,
  revenueBand,
  cms,
  techStack,
  country,
  aiScore,
  aiScoreReason,
  aiSnapshot,
  aiFit,
  aiWatchOuts,
  questions,
  sources,
}: PreCallDigestEmailProps) {
  // Studio zone, not the worker's UTC clock: "Mon 7 Sept, 10:00 am NZST".
  // The zone label is included so a naive-vs-absolute mixup in the data
  // (see lib/call-time.ts) is visible in the email itself, not just
  // invisible in a bare "10:00 am".
  const timeFormatted = formatSlotSummary(scheduledAt, { withZone: true }) || scheduledAt
  const fullParentUrl = `${dashboardUrl}${parentHref}`
  const hasFirmographics = Boolean(industry || employeeCount || revenueBand || cms || country)
  const hasAiBriefing = aiScore != null || Boolean(aiSnapshot) || Boolean(aiFit)

  return (
    <EmailDocument preview={`Pre-call brief: ${withName} in ~30 min`}>
      <EmailCard>
        <EmailNav label="Pre-call brief" />
        <EmailHero>
          <EmailKicker tone="neutral">Starting in ~30 min</EmailKicker>
          <EmailHeading>
            {withName}
            {withSubtitle ? `, ${withSubtitle}` : ''}
          </EmailHeading>
          <EmailParagraph variant="muted">{callTitle}</EmailParagraph>
        </EmailHero>
        <EmailBody>
          <Facts>
            <Fact label="When" value={timeFormatted} />
            <Fact label="Duration" value={`${durationMinutes} min`} />
          </Facts>

          {meetingUrl ? (
            <Buttons>
              <PrimaryButton href={meetingUrl}>Join the call</PrimaryButton>
            </Buttons>
          ) : null}

          {hasFirmographics ? (
            <>
              <EmailKicker tone="neutral">Company</EmailKicker>
              <LedgerRows>
                {industry ? <LedgerRow label="Industry" value={industry} /> : null}
                {employeeCount != null ? <LedgerRow label="Employees" value={String(employeeCount)} /> : null}
                {revenueBand ? <LedgerRow label="Revenue" value={revenueBand} /> : null}
                {country ? <LedgerRow label="Country" value={country} /> : null}
                {cms ? <LedgerRow label="CMS" value={cms} tone="brand" /> : null}
                {techStack && techStack.length > 0 ? (
                  <LedgerRow label="Tech" value={techStack.slice(0, 6).join(', ')} />
                ) : null}
                {leadEmail ? <LedgerRow label="Email" value={leadEmail} mono /> : null}
                {leadCompany && !industry ? <LedgerRow label="Company" value={leadCompany} /> : null}
              </LedgerRows>
            </>
          ) : null}

          {hasAiBriefing ? (
            <>
              <EmailKicker tone="neutral">
                {aiScore != null ? `AI briefing, score ${aiScore}/100` : 'AI briefing'}
              </EmailKicker>
              {aiScoreReason ? <EmailParagraph variant="muted">{aiScoreReason}</EmailParagraph> : null}
              {aiSnapshot ? (
                <>
                  <EmailParagraph variant="small">Snapshot</EmailParagraph>
                  <EmailParagraph>{aiSnapshot}</EmailParagraph>
                </>
              ) : null}
              {aiFit ? (
                <>
                  <EmailParagraph variant="small">Why they fit</EmailParagraph>
                  <EmailParagraph>{aiFit}</EmailParagraph>
                </>
              ) : null}
              {aiWatchOuts ? (
                <>
                  <EmailParagraph variant="small">Watch-outs</EmailParagraph>
                  <EmailParagraph>{aiWatchOuts}</EmailParagraph>
                </>
              ) : null}
            </>
          ) : null}

          {questions && questions.length > 0 ? (
            <>
              <EmailKicker tone="neutral">Questions to ask</EmailKicker>
              <Steps>
                {questions.slice(0, 8).map((q, i) => (
                  <Step key={q} n={i + 1} title={q} />
                ))}
              </Steps>
            </>
          ) : null}

          {sources && sources.length > 0 ? (
            <>
              <EmailKicker tone="neutral">Skim before the call</EmailKicker>
              {sources.slice(0, 3).map((src) => (
                <EmailParagraph key={src} variant="small" style={{ wordBreak: 'break-all' }}>
                  <Link href={src} style={sourceLinkStyle}>
                    {src}
                  </Link>
                </EmailParagraph>
              ))}
            </>
          ) : null}

          <Buttons>
            <PrimaryButton href={fullParentUrl}>Open the full record</PrimaryButton>
          </Buttons>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="team" />
    </EmailDocument>
  )
}

export default PreCallDigestEmail
