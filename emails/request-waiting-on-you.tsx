/**
 * <RequestWaitingOnYouEmail>: the studio has handed a request to one named
 * person at the client, and it will not move until that person acts.
 *
 * Deliberately not the client-review email. Client review says "we finished,
 * look it over"; this one can arrive at any point in a request's life and says
 * "we are stuck on you, here is the one thing to do". So the reason sentence
 * is the heading, the studio's note is quoted under it, and there is exactly
 * ONE button, labelled with the one verb that reason maps to. A person given
 * three choices picks none.
 *
 * The nudge a few days later is this same template with `isNudge`, which only
 * changes the kicker and the opening line: the ask has not changed, so the
 * email should not look like a different ask.
 */
import {
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailFooter,
  EmailHero,
  EmailHeading,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  LedgerRow,
  LedgerRows,
  NoteBox,
  PrimaryButton,
} from './_components'

interface RequestWaitingOnYouEmailProps {
  recipientName: string
  requestTitle: string
  requestNumber: number | null
  /** The reason sentence, e.g. "Needs your approval". From lib/request-handoff. */
  reasonLabel: string
  /** The one verb for that reason, e.g. "Approve" or "Upload or reply". */
  actionVerb: string
  /** Who at the studio handed it over. */
  fromName: string
  /** The studio's note, already plain text. Null when they left it empty. */
  note: string | null
  /** The date they asked for, already formatted for New Zealand. */
  dueDate: string | null
  /** Where the button goes: the request, or the invite link for a new seat. */
  actionUrl: string
  /** True for the reminder a few days later. */
  isNudge?: boolean
}

export function RequestWaitingOnYouEmail({
  recipientName,
  requestTitle,
  requestNumber,
  reasonLabel,
  actionVerb,
  fromName,
  note,
  dueDate,
  actionUrl,
  isNudge = false,
}: RequestWaitingOnYouEmailProps) {
  const reference = requestNumber ? `REQ-${requestNumber}` : null

  return (
    <EmailDocument preview={`${reasonLabel}: ${requestTitle}`}>
      <EmailCard>
        <EmailNav label={reference ?? 'Client portal'} />

        <EmailHero>
          <EmailKicker tone={isNudge ? 'amber' : 'brand'}>
            {isNudge ? 'Still waiting' : 'This one is with you'}
          </EmailKicker>
          <EmailHeading>{reasonLabel}</EmailHeading>
          <EmailParagraph>
            {isNudge
              ? `Hi ${recipientName}, a quick nudge on this one. It is still sitting with you, and we cannot move it on until you have had a look.`
              : `Hi ${recipientName}, ${fromName} has passed this request to you. It stays with you until you act on it, then it comes straight back to us.`}
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Request" value={requestTitle} tone="brand" />
            {reference ? <LedgerRow label="Reference" value={reference} mono /> : null}
            <LedgerRow label="With" value="You" />
            {dueDate ? <LedgerRow label="Needed by" value={dueDate} /> : null}
          </LedgerRows>

          {note ? (
            <NoteBox title={`From ${fromName}`}>{note}</NoteBox>
          ) : null}

          <PrimaryButton href={actionUrl}>{actionVerb}</PrimaryButton>

          <EmailParagraph variant="small">
            If this is not yours to answer, open it and hand it back to us with a note. We would
            rather it came back than sat with the wrong person.
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience="client" />
    </EmailDocument>
  )
}

export default RequestWaitingOnYouEmail
