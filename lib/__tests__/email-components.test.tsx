/**
 * emails/_components.tsx: the Studio Ledger email kit.
 *
 * Every primitive is rendered to real HTML through @react-email/render, the
 * same path the send routes use, and the things a human would otherwise only
 * catch in an inbox are pinned: the footer names the city and never a street
 * address, team mail says clients never receive it, the primary button is
 * brand dark with the leaf radius, the nav band is forest with the wordmark,
 * and no em or en dash reaches the wire. The legacy names are rendered too so
 * the un-ported templates keep working while they are moved across.
 */
import { describe, it, expect } from 'vitest'
import { render } from '@react-email/render'

import {
  BlockQuote,
  Buttons,
  CodeBox,
  DarkBand,
  DetailCard,
  DetailRow,
  EMAIL_TOKENS,
  EMAIL_WORDMARK_URL,
  EmailBanner,
  EmailBody,
  EmailCard,
  EmailDocument,
  EmailEyebrow,
  EmailFooter,
  EmailFootnote,
  EmailHeader,
  EmailHeading,
  EmailHero,
  EmailKicker,
  EmailNav,
  EmailParagraph,
  EmailShell,
  Fact,
  Facts,
  HowToPayBlock,
  LedgerRow,
  LedgerRows,
  MessageBlock,
  Mono,
  NoteBox,
  PersonQuote,
  PrimaryButton,
  SecondaryLink,
  SignOff,
  Step,
  Steps,
} from '@/emails/_components'

// En dash (U+2013) and em dash (U+2014), built from code points so this file
// never carries one either.
const DASHES = new RegExp(`[${String.fromCharCode(0x2013, 0x2014)}]`)

async function html(node: React.ReactElement): Promise<string> {
  return render(node)
}

function FullEmail() {
  return (
    <EmailDocument preview="Your invoice is ready">
      <EmailCard>
        <EmailNav label="INV-0231" />
        <EmailHero>
          <EmailKicker tone="brand">Invoice</EmailKicker>
          <EmailHeading>Kia ora Ngaire, your invoice is ready</EmailHeading>
          <EmailParagraph>Here is the invoice for the spring campaign work.</EmailParagraph>
          <EmailParagraph variant="muted">Muted line.</EmailParagraph>
          <EmailParagraph variant="small">Small line.</EmailParagraph>
        </EmailHero>
        <EmailBody>
          <LedgerRows>
            <LedgerRow label="Amount due" value="$4,312.50 NZD" tone="brand" />
            <LedgerRow label="Reference" value="INV-2026-0042" mono />
            <LedgerRow label="Overdue by" value="12 days" tone="danger" />
          </LedgerRows>
          <NoteBox tone="amber" title="Heads up">
            The pay link is issued once the invoice is approved.
          </NoteBox>
          <Facts>
            <Fact label="Due" value="12 Sep" sub="Nine days from now" />
            <Fact label="Hours" value="18.5" sub="Across two tracks" />
          </Facts>
          <PersonQuote name="Staci Bonnie" quote="Two things to look at before Friday." />
          <BlockQuote attribution="Ngaire Hutchins">Thanks, that reads much better.</BlockQuote>
          <Steps>
            <Step n={1} title="Open the invoice" detail="It is in your portal." />
            <Step n={2} title="Pay by transfer" detail="Quote the reference." />
          </Steps>
          <CodeBox code="482 913" />
          <Buttons>
            <PrimaryButton href="https://portal.tahi.studio/invoices/1">Pay invoice</PrimaryButton>
            <SecondaryLink href="https://portal.tahi.studio/invoices/1">View in portal</SecondaryLink>
          </Buttons>
          <PrimaryButton href="https://portal.tahi.studio" variant="quiet">
            Not now
          </PrimaryButton>
        </EmailBody>
        <DarkBand kicker="Studio update" heading="A quieter month" buttonLabel="Read the note" buttonHref="https://tahi.studio">
          The studio is closed the first week of October.
        </DarkBand>
        <SignOff name="Liam" />
      </EmailCard>
      <EmailFooter audience="client" recipientEmail="ngaire@mahanaorchards.co.nz" />
    </EmailDocument>
  )
}

describe('email kit', () => {
  it('renders every new primitive without throwing', async () => {
    const out = await html(<FullEmail />)
    expect(out).toContain('Kia ora Ngaire')
    expect(out).toContain('INV-2026-0042')
    expect(out).toContain('482 913')
    expect(out).toContain('A quieter month')
    expect(out).toContain('Staci Bonnie')
  })

  it('never lets an em or en dash reach the wire', async () => {
    const out = await html(<FullEmail />)
    expect(out).not.toMatch(DASHES)
  })

  it('puts the nav band on forest with the wordmark image', async () => {
    const out = await html(<EmailNav label="Client portal" />)
    expect(out).toContain(EMAIL_TOKENS.forest)
    expect(out).toContain(EMAIL_WORDMARK_URL)
    expect(out).toContain('tahi-logo.png')
    expect(out).toContain('Client portal')
    expect(out).toContain(EMAIL_TOKENS.forestLabel)
  })

  it('gives the primary button the brand dark background and the leaf radius', async () => {
    const out = await html(<PrimaryButton href="https://portal.tahi.studio">Open</PrimaryButton>)
    expect(out).toContain(`background-color:${EMAIL_TOKENS.brandDark}`)
    expect(out).toContain('border-radius:0 12px 0 12px')
    expect(out).toContain('href="https://portal.tahi.studio"')
  })

  it('renders the quiet and onDark button variants', async () => {
    const quiet = await html(<PrimaryButton href="#" variant="quiet">Later</PrimaryButton>)
    expect(quiet).toContain('border-radius:8px')
    expect(quiet).toContain(EMAIL_TOKENS.ink)
    const onDark = await html(<PrimaryButton href="#" variant="onDark">Read</PrimaryButton>)
    expect(onDark).toContain('background-color:#ffffff')
    expect(onDark).toContain(EMAIL_TOKENS.forest)
  })

  it('footer carries the city line and never a street address', async () => {
    for (const audience of ['client', 'team', 'auth'] as const) {
      const out = await html(<EmailFooter audience={audience} recipientEmail="jo@acme.com" />)
      expect(out).toContain('Tahi Studio, Whanganui, New Zealand')
      expect(out).not.toMatch(/\b(street|st\.|road|rd\.|avenue|ave\.|drive|dr\.|lane|terrace|\d{4})\b/i)
    }
  })

  it('footer audience lines', async () => {
    const team = await html(<EmailFooter audience="team" />)
    expect(team).toContain('Internal. Clients never receive this email.')
    expect(team).toContain('Notification settings')
    expect(team).toContain('Help')

    const auth = await html(<EmailFooter audience="auth" />)
    expect(auth).toContain('This is an automated message.')
    expect(auth).not.toContain('Notification settings')
    expect(auth).not.toContain('>Help<')

    const client = await html(<EmailFooter audience="client" recipientEmail="jo@acme.com" />)
    expect(client).toContain('Sent to jo@acme.com because you have a Tahi account.')
    expect(client).toContain('Notification settings')

    const bare = await html(<EmailFooter />)
    expect(bare).toContain('Sent to you because you have a Tahi account.')
  })

  it('ships the mobile reflow in the document head, and nothing else depends on it', async () => {
    const out = await html(<FullEmail />)
    expect(out).toContain('@media only screen and (max-width: 600px)')
    expect(out).toContain('.tahi-h1')
    expect(out).toContain('font-size:24px')
    expect(out).toContain(`max-width:${EMAIL_TOKENS.maxWidth}px`)
    expect(out).toContain('Manrope, Helvetica, Arial, sans-serif')
  })

  it('kicker tones', async () => {
    expect(await html(<EmailKicker tone="danger">Overdue</EmailKicker>)).toContain(EMAIL_TOKENS.danger)
    expect(await html(<EmailKicker tone="amber">Heads up</EmailKicker>)).toContain(EMAIL_TOKENS.amber)
    expect(await html(<EmailKicker tone="neutral">Task</EmailKicker>)).toContain(EMAIL_TOKENS.subtle)
    expect(await html(<EmailKicker>Invoice</EmailKicker>)).toContain(EMAIL_TOKENS.brandDark)
  })

  it('note box tones', async () => {
    expect(await html(<NoteBox>brand</NoteBox>)).toContain(EMAIL_TOKENS.brand50)
    expect(await html(<NoteBox tone="neutral">n</NoteBox>)).toContain(EMAIL_TOKENS.neutralBg)
    expect(await html(<NoteBox tone="amber">a</NoteBox>)).toContain(EMAIL_TOKENS.amberBg)
    expect(await html(<NoteBox tone="danger">d</NoteBox>)).toContain(EMAIL_TOKENS.dangerBg)
  })

  it('card pads loose legacy content but stays flush for the new blocks', async () => {
    const legacy = await html(
      <EmailCard>
        <EmailParagraph>Loose</EmailParagraph>
      </EmailCard>,
    )
    expect(legacy).toContain('padding:28px 32px')

    const modern = await html(
      <EmailCard>
        <EmailNav label="Task" />
        <EmailBody>
          <EmailParagraph>Padded by the body</EmailParagraph>
        </EmailBody>
      </EmailCard>,
    )
    expect(modern).not.toContain('padding:28px 32px')
    expect(modern).toContain('padding:6px 32px 10px')
  })

  it('keeps every legacy export rendering', async () => {
    const out = await html(
      <EmailShell>
        <EmailHeader eyebrow="A new invoice is ready" />
        <EmailCard>
          <EmailEyebrow>Invoice INV-2026-0042</EmailEyebrow>
          <EmailHeading>Your invoice is ready</EmailHeading>
          <EmailParagraph subtle>Small copy.</EmailParagraph>
          <EmailBanner kind="success">Delivered</EmailBanner>
          <EmailBanner kind="warning">Maintenance</EmailBanner>
          <EmailBanner kind="danger">Overdue</EmailBanner>
          <EmailBanner kind="info">Note</EmailBanner>
          <DetailCard>
            <DetailRow first label="Amount due" value="$4,312.50 NZD" hero />
            <DetailRow label="Reference" value="INV-2026-0042" mono />
          </DetailCard>
          <MessageBlock fromName="Liam Miller" message={'Line one.\nLine two.'} />
          <HowToPayBlock
            howToPay={{
              bankName: 'ANZ',
              accountName: 'Tahi Studio Ltd',
              accountNumber: '01-0242-0198765-00',
              reference: 'INV-2026-0042',
              amount: 4312.5,
              currency: 'NZD',
              dueDate: '12 September 2026',
              hint: 'Please quote the reference.',
            }}
          />
          <PrimaryButton href="https://portal.tahi.studio" variant="warning">
            Pay now
          </PrimaryButton>
          <PrimaryButton href="https://portal.tahi.studio" variant="danger">
            Pay now
          </PrimaryButton>
          <SecondaryLink href="https://portal.tahi.studio">View</SecondaryLink>
          <EmailFootnote>
            Hash <Mono>SHA-256</Mono>
          </EmailFootnote>
          <EmailFootnote framed>Framed footnote.</EmailFootnote>
        </EmailCard>
        <EmailFooter unsubscribeUrl="https://portal.tahi.studio/unsubscribe" />
      </EmailShell>,
    )
    expect(out).toContain('A new invoice is ready')
    expect(out).toContain(EMAIL_TOKENS.forest)
    expect(out).toContain('Amount due')
    expect(out).toContain('Liam Miller')
    expect(out).toContain('01-0242-0198765-00')
    expect(out).toContain('SHA-256')
    expect(out).toContain('Unsubscribe')
    expect(out).toContain('Tahi Studio, Whanganui, New Zealand')
    expect(out).not.toMatch(DASHES)
    // Legacy warning and danger buttons land on the single brand-dark leaf.
    expect(out).not.toContain('#fb923c')
    expect(out).not.toContain('#dc2626')
  })
})
