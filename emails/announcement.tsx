/**
 * <AnnouncementEmail> - the email half of a portal announcement.
 *
 * Mirrors the in-portal banner: a forest header band, a type-tinted eyebrow
 * (Info / Success / Warning / Maintenance), the announcement title, one or
 * more body paragraphs, an optional CTA button, and the quiet studio footer.
 *
 * The `type` maps onto the same four tones the announcements composer offers.
 * `maintenance` shares the warning palette (amber) since it is an operational
 * heads-up, but keeps its own eyebrow label so the intent stays clear.
 */
import { Body, Head, Html, Preview, Text } from '@react-email/components'
import {
  EMAIL_TOKENS,
  EmailCard,
  EmailFooter,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

export type AnnouncementEmailType = 'info' | 'success' | 'warning' | 'maintenance'

interface AnnouncementEmailProps {
  title: string
  body: string
  type?: AnnouncementEmailType
  ctaLabel?: string | null
  ctaUrl?: string | null
}

const EYEBROW: Record<AnnouncementEmailType, { label: string; color: string }> = {
  info: { label: 'Info', color: EMAIL_TOKENS.info },
  success: { label: 'Success', color: EMAIL_TOKENS.success },
  warning: { label: 'Warning', color: EMAIL_TOKENS.warning },
  maintenance: { label: 'Maintenance', color: EMAIL_TOKENS.warning },
}

// Map the announcement tone onto a PrimaryButton variant. Success reuses the
// brand leaf gradient; warning/maintenance get the amber button.
function buttonVariant(type: AnnouncementEmailType): 'brand' | 'warning' {
  return type === 'warning' || type === 'maintenance' ? 'warning' : 'brand'
}

const eyebrowStyle = {
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.16em',
  textTransform: 'uppercase' as const,
  margin: '0 0 0.625rem',
} as const

export function AnnouncementEmail({
  title,
  body,
  type = 'info',
  ctaLabel,
  ctaUrl,
}: AnnouncementEmailProps) {
  const tone = EYEBROW[type] ?? EYEBROW.info
  // Split the body into paragraphs on blank lines so multi-paragraph
  // announcements keep their spacing in the email.
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const showCta = Boolean(ctaLabel && ctaLabel.trim() && ctaUrl && ctaUrl.trim())

  return (
    <Html>
      <Head />
      <Preview>{title}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow="Announcement" />

          <EmailCard>
            <Text style={{ ...eyebrowStyle, color: tone.color }}>{tone.label}</Text>
            <EmailHeading>{title}</EmailHeading>

            {paragraphs.length ? (
              paragraphs.map((p, i) => <EmailParagraph key={i}>{p}</EmailParagraph>)
            ) : (
              <EmailParagraph>{body}</EmailParagraph>
            )}

            {showCta && (
              <PrimaryButton href={ctaUrl as string} variant={buttonVariant(type)}>
                {ctaLabel}
              </PrimaryButton>
            )}
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default AnnouncementEmail
