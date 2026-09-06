/**
 * <NewChannelMessageEmail>: somebody posted on the standing line between a
 * client and the studio.
 *
 * The sibling of <NewMessageEmail>, which is the request-thread version. They
 * are two templates rather than one with a nullable request because every
 * sentence in that one hangs off a request: the subject prefix ("[REQ-14]"),
 * the "Request" detail row, the "Open the request" button and the footnote
 * about feedback staying attached to the piece of work. An org channel has no
 * request at all, so all four would have to be conditional and the result
 * would be a template that reads like neither thing.
 *
 * It can never carry an internal note. The studio-facing send is only built
 * from a client message (always external on the portal write path), and the
 * client-facing send is gated on `isInternal` being false before this template
 * is constructed at all.
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

interface NewChannelMessageEmailProps {
  /** 'client' = the studio wrote to them. 'studio' = a client wrote to us. */
  audience: 'client' | 'studio'
  recipientName: string
  /** The client company. Names the room for the studio, and signs it for a client. */
  orgName: string
  fromName: string
  /** Plain text. Never composer HTML. */
  message: string
  messagesUrl: string
}

export function NewChannelMessageEmail({
  audience,
  recipientName,
  orgName,
  fromName,
  message,
  messagesUrl,
}: NewChannelMessageEmailProps) {
  const toClient = audience === 'client'

  return (
    <Html>
      <Head />
      <Preview>{`${fromName} sent you a message`}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>
          <EmailHeader eyebrow={toClient ? 'A message from the studio' : 'A client wrote in'} />

          <EmailCard>
            <EmailEyebrow>{toClient ? 'Your studio line' : 'Inbox'}</EmailEyebrow>
            <EmailHeading>
              {fromName} <span style={{ color: '#5A824E' }}>wrote</span>
            </EmailHeading>

            <EmailParagraph>
              {toClient
                ? `Hi ${recipientName}, there is a new message on your line to the studio. This is the thread for anything that is not about one particular request.`
                : `Hi ${recipientName}, ${fromName} at ${orgName} has posted on their studio line and is waiting on us.`}
            </EmailParagraph>

            <DetailCard>
              <DetailRow first label={toClient ? 'Studio' : 'Client'} value={toClient ? 'Tahi Studio' : orgName} hero />
              <DetailRow label="From" value={fromName} />
            </DetailCard>

            {message && <MessageBlock fromName={fromName} message={message} />}

            <PrimaryButton href={messagesUrl}>Open Messages</PrimaryButton>

            <EmailFootnote>
              {toClient
                ? 'Replying in Messages keeps everything in one place. If it is about a specific piece of work, its own request thread is the better home for it.'
                : 'Replying in Messages marks the line as answered for the client.'}
            </EmailFootnote>
          </EmailCard>

          <EmailFooter />
        </EmailShell>
      </Body>
    </Html>
  )
}

export default NewChannelMessageEmail
