/**
 * <NewMessageEmail>: a reply landed on a request thread.
 *
 * One template, two audiences, because it is one event: the studio replied to
 * a client, or a client replied to the studio. The wording either side of the
 * quote changes; the quote itself is always the single message that was just
 * posted, handed in as plain text by the caller.
 *
 * It can never carry an internal note. The studio-facing send is only built
 * from a client message (always external), and the client-facing send is gated
 * on the message not being internal before this template is ever constructed.
 */
import { Body, Head, Html, Preview } from '@react-email/components'
import {
  DetailCard,
  DetailRow,
  EmailCard,
  EmailEyebrow,
  EmailFooter,
  EmailFootnote,
  EmailHeader,
  EmailHeading,
  EmailParagraph,
  EmailShell,
  MessageBlock,
  PrimaryButton,
  emailBodyStyle,
} from './_components'

interface NewMessageEmailProps {
  /** 'client' = the studio replied to them. 'studio' = a client replied to us. */
  audience: 'client' | 'studio'
  recipientName: string
  requestTitle: string
  requestNumber: number | null
  fromName: string
  /** Plain text. Never composer HTML. */
  message: string
  requestUrl: string
}

export function NewMessageEmail({
  audience,
  recipientName,
  requestTitle,
  requestNumber,
  fromName,
  message,
  requestUrl,
}: NewMessageEmailProps) {
  const toClient = audience === 'client'
  const reference = requestNumber ? `REQ-${requestNumber}` : null

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} replied on ${requestTitle}`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow={toClient ? 'A reply on your request' : 'A client replied'} />

          <EmailCard>
            <EmailEyebrow>{toClient ? 'Request thread' : 'Inbox'}</EmailEyebrow>
            <EmailHeading>
              {fromName} <span style={{ color: '#5A824E' }}>replied</span>
            </EmailHeading>

            <EmailParagraph>
              {toClient
                ? `Hi ${recipientName}, there is a new message on your request. Everything about this piece of work lives on one thread, so replying there keeps the whole story in one place.`
                : `Hi ${recipientName}, ${fromName} has posted on a request thread and is waiting on the studio.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label="Request" value={requestTitle} hero />
              {reference && <DetailRow label="Reference" value={reference} mono />}
              <DetailRow label="From" value={fromName} />
            </DetailCard>

            {message && <MessageBlock fromName={fromName} message={message} />}

            <PrimaryButton href={requestUrl}>
              {toClient ? 'Open the thread' : 'Open the request'}
            </PrimaryButton>

            <EmailFootnote>
              {toClient
                ? 'Reply on the thread rather than by email if you can. Files, feedback and approvals all stay attached to the request.'
                : 'Replying on the thread marks the request as answered for the client.'}
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default NewMessageEmail
