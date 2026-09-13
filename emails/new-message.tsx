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
  PersonQuote,
  PrimaryButton,
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
    <EmailDocument preview={`${fromName} replied on ${requestTitle}`}>
      <EmailCard>
        <EmailNav label={reference ?? (toClient ? 'Client portal' : 'Inbox')} />

        <EmailHero>
          <EmailKicker>{toClient ? 'Request thread' : 'Inbox'}</EmailKicker>
          <EmailHeading>{fromName} replied</EmailHeading>
          <EmailParagraph>
            {toClient
              ? `Hi ${recipientName}, there is a new message on your request. Everything about this piece of work lives on one thread, so replying there keeps the whole story in one place.`
              : `Hi ${recipientName}, ${fromName} has posted on a request thread and is waiting on the studio.`}
          </EmailParagraph>
        </EmailHero>

        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Request" value={requestTitle} tone="brand" />
            {reference ? <LedgerRow label="Reference" value={reference} mono /> : null}
          </LedgerRows>

          {message ? <PersonQuote name={fromName} quote={message} /> : null}

          <PrimaryButton href={requestUrl}>{toClient ? 'Open the thread' : 'Open the request'}</PrimaryButton>

          <EmailParagraph variant="small">
            {toClient
              ? 'Replies to this email are not read. Reply on the thread instead, where files, feedback and approvals stay attached to the request.'
              : 'Replying on the thread marks the request as answered for the client.'}
          </EmailParagraph>
        </EmailBody>
      </EmailCard>

      <EmailFooter audience={toClient ? 'client' : 'team'} />
    </EmailDocument>
  )
}

export default NewMessageEmail
