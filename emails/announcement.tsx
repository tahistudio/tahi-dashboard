/**
 * <AnnouncementEmail> - the email half of a portal announcement.
 *
 * Mirrors the in-portal banner with the dark band: a forest section carrying
 * a type-tinted kicker (Info / Success / Warning / Maintenance), the
 * announcement title, the body copy, an optional CTA button, and the quiet
 * studio footer.
 *
 * The `type` maps onto the same four tones the announcements composer offers.
 * It tints the kicker on the forest band: green for success, amber for
 * warning and maintenance (an operational heads-up), soft blue for info. The
 * button is always the white onDark button, by design: a coloured button on
 * the forest band reads as an alert rather than a note from the studio.
 */
import { Fragment } from 'react'
import { DarkBand, EmailCard, EmailDocument, EmailFooter, EmailNav, type DarkKickerTone } from './_components'

export type AnnouncementEmailType = 'info' | 'success' | 'warning' | 'maintenance'

interface AnnouncementEmailProps {
  title: string
  body: string
  type?: AnnouncementEmailType
  ctaLabel?: string | null
  ctaUrl?: string | null
}

const KICKER: Record<AnnouncementEmailType, string> = {
  info: 'Info',
  success: 'Success',
  warning: 'Warning',
  maintenance: 'Maintenance',
}

const KICKER_TONE: Record<AnnouncementEmailType, DarkKickerTone> = {
  info: 'info',
  success: 'brand',
  warning: 'amber',
  maintenance: 'amber',
}

export function AnnouncementEmail({
  title,
  body,
  type = 'info',
  ctaLabel,
  ctaUrl,
}: AnnouncementEmailProps) {
  const kickerLabel = KICKER[type] ?? KICKER.info
  const kickerTone = KICKER_TONE[type] ?? KICKER_TONE.info
  // Split the body into paragraphs on blank lines so multi-paragraph
  // announcements keep their spacing in the email.
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
  const showCta = Boolean(ctaLabel && ctaLabel.trim() && ctaUrl && ctaUrl.trim())

  return (
    <EmailDocument preview={title}>
      <EmailCard>
        <EmailNav label="Studio update" />
        <DarkBand
          kicker={kickerLabel}
          kickerTone={kickerTone}
          heading={title}
          buttonLabel={showCta ? (ctaLabel as string) : undefined}
          buttonHref={showCta ? (ctaUrl as string) : undefined}
        >
          {paragraphs.length
            ? paragraphs.map((p, i) => (
                <Fragment key={p}>
                  {i > 0 ? (
                    <>
                      <br />
                      <br />
                    </>
                  ) : null}
                  {p}
                </Fragment>
              ))
            : body}
        </DarkBand>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default AnnouncementEmail
