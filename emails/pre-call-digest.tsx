/**
 * <PreCallDigestEmail> — fires ~30 min before each scheduled
 * discovery call. Gives Liam (or the call host) a single-glance
 * primer: who they're talking to, AI fit assessment, the discovery
 * questions to ask, scope/budget signals, sources to skim.
 *
 * Studio Ledger, team mail: quieter than a client email, no sign-off
 * warmth, neutral kicker. Designed to be readable on a phone while
 * walking to the call.
 */
import { Body, Head, Html, Link, Preview } from '@react-email/components'
import {
  Buttons,
  EmailBody,
  EmailCard,
  EmailFooter,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  EmailShell,
  Fact,
  Facts,
  LedgerRow,
  LedgerRows,
  Step,
  Steps,
  PrimaryButton,
  emailBodyStyle,
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
  const startTime = new Date(scheduledAt)
  const timeFormatted = startTime.toLocaleString('en-NZ', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
  const fullParentUrl = `${dashboardUrl}${parentHref}`
  const hasFirmographics = Boolean(industry || employeeCount || revenueBand || cms || country)
  const hasAiBriefing = aiScore != null || Boolean(aiSnapshot) || Boolean(aiFit)

  return (
    <Html lang="en">
      <Head />
      <Preview>{`Pre-call brief: ${withName} in ~30 min`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
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
                      <Link href={src}>{src}</Link>
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
        </EmailShell>
      </Body>
    </Html>
  )
}

export default PreCallDigestEmail
