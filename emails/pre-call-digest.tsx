/**
 * <PreCallDigestEmail> — fires ~30 min before each scheduled
 * discovery call. Gives Liam (or the call host) a single-glance
 * primer: who they're talking to, AI fit assessment, the discovery
 * questions to ask, scope/budget signals, sources to skim.
 *
 * Designed to be readable on a phone while walking to the call.
 */
import { Body, Head, Html, Preview, Section, Text } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

export interface PreCallDigestEmailProps {
  callTitle: string
  scheduledAt: string         // ISO timestamp
  meetingUrl: string | null
  durationMinutes: number
  withName: string            // "Tim Lyons" or company
  withSubtitle: string | null // company / role
  parentHref: string          // dashboard URL to the parent record
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

  return (
    <Html>
      <Head />
      <Preview>{`Pre-call brief: ${withName} in ~30 min`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Pre-call brief" />

          <EmailCard>
            <EmailEyebrow>Starting in ~30 min</EmailEyebrow>
            <EmailHeading>
              <span style={{ color: '#5A824E' }}>{withName}</span>
              {withSubtitle ? ` · ${withSubtitle}` : ''}
            </EmailHeading>

            <EmailParagraph>
              {callTitle} · {timeFormatted} · {durationMinutes}min
            </EmailParagraph>

            {meetingUrl && (
              <PrimaryButton href={meetingUrl}>Join the call</PrimaryButton>
            )}
          </EmailCard>

          {/* Lead firmographics */}
          {(industry || employeeCount || revenueBand || cms || country) && (
            <EmailCard>
              <EmailEyebrow>Company</EmailEyebrow>
              <DetailCard>
                {industry && <DetailRow first label="Industry" value={industry} />}
                {employeeCount != null && <DetailRow label="Employees" value={String(employeeCount)} />}
                {revenueBand && <DetailRow label="Revenue" value={revenueBand} />}
                {country && <DetailRow label="Country" value={country} />}
                {cms && <DetailRow label="CMS" value={cms} hero />}
                {techStack && techStack.length > 0 && (
                  <DetailRow label="Tech" value={techStack.slice(0, 6).join(', ')} />
                )}
                {leadEmail && <DetailRow label="Email" value={leadEmail} mono />}
                {leadCompany && !industry && <DetailRow label="Company" value={leadCompany} />}
              </DetailCard>
            </EmailCard>
          )}

          {/* AI briefing */}
          {(aiScore != null || aiSnapshot || aiFit) && (
            <EmailCard>
              <EmailEyebrow>
                AI briefing{aiScore != null ? ` · score ${aiScore}/100` : ''}
              </EmailEyebrow>
              {aiScoreReason && (
                <Text style={{ fontSize: '13px', color: '#5a6657', fontStyle: 'italic', margin: '0 0 12px 0', lineHeight: 1.55 }}>
                  {aiScoreReason}
                </Text>
              )}
              {aiSnapshot && (
                <>
                  <Text style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a9987', margin: '0 0 6px 0' }}>
                    Snapshot
                  </Text>
                  <Text style={{ fontSize: '13px', color: '#121A0F', margin: '0 0 12px 0', lineHeight: 1.55 }}>
                    {aiSnapshot}
                  </Text>
                </>
              )}
              {aiFit && (
                <>
                  <Text style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a9987', margin: '0 0 6px 0' }}>
                    Why they fit
                  </Text>
                  <Text style={{ fontSize: '13px', color: '#121A0F', margin: '0 0 12px 0', lineHeight: 1.55 }}>
                    {aiFit}
                  </Text>
                </>
              )}
              {aiWatchOuts && (
                <>
                  <Text style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#8a9987', margin: '0 0 6px 0' }}>
                    Watch-outs
                  </Text>
                  <Text style={{ fontSize: '13px', color: '#121A0F', margin: 0, lineHeight: 1.55 }}>
                    {aiWatchOuts}
                  </Text>
                </>
              )}
            </EmailCard>
          )}

          {/* Discovery questions */}
          {questions && questions.length > 0 && (
            <EmailCard>
              <EmailEyebrow>Questions to ask</EmailEyebrow>
              <Section>
                {questions.slice(0, 8).map((q, i) => (
                  <Text key={i} style={{ fontSize: '13px', color: '#121A0F', margin: '0 0 8px 0', lineHeight: 1.55 }}>
                    <span style={{ color: '#8a9987', marginRight: '8px', fontVariantNumeric: 'tabular-nums' }}>{i + 1}.</span>
                    {q}
                  </Text>
                ))}
              </Section>
            </EmailCard>
          )}

          {/* Sources */}
          {sources && sources.length > 0 && (
            <EmailCard>
              <EmailEyebrow>Skim before the call</EmailEyebrow>
              {sources.slice(0, 3).map((src, i) => (
                <Text key={i} style={{ fontSize: '12px', margin: '0 0 6px 0', wordBreak: 'break-all' }}>
                  <a href={src} style={{ color: '#5A824E', textDecoration: 'underline' }}>{src}</a>
                </Text>
              ))}
            </EmailCard>
          )}

          <EmailCard>
            <PrimaryButton href={fullParentUrl}>Open the full record</PrimaryButton>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default PreCallDigestEmail
