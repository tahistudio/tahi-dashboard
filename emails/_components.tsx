/**
 * Shared building blocks for every Tahi email template: the "Studio Ledger"
 * email system.
 *
 * Every email reads, top to bottom:
 *
 *   EmailShell            cream page, one centred 560px column
 *     EmailCard           white card, hairline border, leaf radius, clipped
 *       EmailNav          forest band: white wordmark left, green label right
 *       EmailHero         kicker, H1, opening paragraph
 *       EmailBody         ledger rows, note boxes, facts, quotes, steps, code,
 *                         buttons
 *       SignOff           closing, bold name, "Tahi Studio"
 *   EmailFooter           outside the card: wordmark, studio line, audience
 *                         line, links
 *
 * Email clients are unforgiving, so everything that matters is inline: table
 * layout through the React Email primitives (Section, Row, Column), px values,
 * a web-safe font stack with Manrope first, no CSS variables, no flexbox. The
 * one <style> block (EMAIL_RESPONSIVE_CSS) only carries the mobile reflow, and
 * a client that drops it still gets a correct desktop email.
 *
 * The leaf radius (0 12px 0 12px) appears once per email, on the primary
 * button, and the card carries the larger leaf (0 20px 0 20px). Clients that
 * ignore border-radius degrade to square corners, which still reads fine.
 *
 * Legacy names (EmailHeader, EmailEyebrow, DetailCard, DetailRow, MessageBlock,
 * EmailBanner, EmailFootnote) are kept as thin wrappers over the new primitives
 * so every template compiles while it is ported.
 */
import { Children, isValidElement, type ReactNode } from 'react'
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Html,
  Img,
  Link,
  Preview,
  Row,
  Section,
  Text,
} from '@react-email/components'
import { publicUrl } from '@/lib/app-url'
import type { InvoiceHowToPay } from '@/lib/invoice-how-to-pay'

// Studio Ledger tokens. Verbatim from the design; the legacy keys at the bottom
// of the object are aliases so un-ported templates keep compiling.
export const EMAIL_TOKENS = {
  page: '#F7F6F3',
  surface: '#ffffff',
  ink: '#121A0F',
  body: '#3B3A34',
  muted: '#5D5B55',
  subtle: '#8C8A83',
  hairline: '#E8E7E3',
  hairlineSoft: '#F0EFEB',
  brand: '#5A824E',
  brandDark: '#425F39',
  brand50: '#F0F7EE',
  brand100: '#dcefd8',
  brandLight: '#7aab6b',
  brandGlow: '#93C98A',
  forest: '#1E2A1B',
  forestHeading: '#FDFDFC',
  forestBody: '#C9D6C3',
  forestLabel: '#93C98A',
  // Kicker tints on the forest band. Amber for an operational heads-up,
  // a soft blue for plain information; both keep AA contrast on #1E2A1B.
  forestAmber: '#E6C27A',
  forestInfo: '#A9C4E0',
  neutralBg: '#F4F3EF',
  danger: '#B5473F',
  dangerBg: '#FBF0EE',
  amber: '#9A6A1C',
  amberBg: '#FBF4E6',
  fontStack: 'Manrope, Helvetica, Arial, sans-serif',
  monoStack: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, monospace',
  cardRadius: '0 20px 0 20px',
  buttonRadius: '0 12px 0 12px',
  quietRadius: '8px',
  noteRadius: '8px',
  leafRadius: '0 16px 0 16px',
  leafRadiusSm: '0 10px 0 10px',
  leafRadiusLg: '0 24px 0 24px',
  maxWidth: 560,
  // Legacy aliases. Kept so the un-ported templates compile; new work should
  // use the names above.
  bg: '#F7F6F3',
  text: '#121A0F',
  textMuted: '#5D5B55',
  textSubtle: '#8C8A83',
  brandDeep: '#425F39',
  brandHaze: '#F0F7EE',
  border: '#E8E7E3',
  borderSubtle: '#F0EFEB',
  success: '#425F39',
  successBg: '#F0F7EE',
  successBorder: '#F0F7EE',
  warning: '#9A6A1C',
  warningBg: '#FBF4E6',
  warningBorder: '#FBF4E6',
  info: '#5D5B55',
  infoBg: '#F4F3EF',
  infoBorder: '#F4F3EF',
} as const

/** The white "Tahi" mark with the green leaf. Transparent, so it needs a dark band. */
export const EMAIL_WORDMARK_URL = publicUrl('/tahi-logo.png')

const CONTACT_EMAIL = 'business@tahi.studio'

// Padding tokens (desktop). The mobile reflow below overrides the side
// paddings to 22px through the .tahi-pad hook.
const PAD_X = 32
const HERO_PADDING = `34px ${PAD_X}px 6px`
const BODY_PADDING = `6px ${PAD_X}px 10px`
const SIGNOFF_PADDING = `10px ${PAD_X}px 30px`
const NAV_PADDING = `20px ${PAD_X}px`

// Mobile reflow: paddings 22px, H1 21px, facts single column, buttons stacked
// full width, code 26px. Also asks for Manrope where the client will fetch it.
export const EMAIL_RESPONSIVE_CSS = [
  "@import url('https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700&display=swap');",
  '@media only screen and (max-width: 600px) {',
  '  .tahi-pad { padding-left: 22px !important; padding-right: 22px !important; }',
  '  .tahi-h1 { font-size: 21px !important; }',
  '  .tahi-fact { display: block !important; width: 100% !important; padding-right: 0 !important; padding-bottom: 14px !important; }',
  '  .tahi-btn { display: block !important; width: 100% !important; box-sizing: border-box !important; margin-right: 0 !important; text-align: center !important; }',
  '  .tahi-code { font-size: 26px !important; }',
  '}',
].join('\n')

/** The one <style> block. Place inside <Head>. */
export function EmailStyles() {
  return <style dangerouslySetInnerHTML={{ __html: EMAIL_RESPONSIVE_CSS }} />
}

// Page-level wrappers

export const emailBodyStyle = {
  backgroundColor: EMAIL_TOKENS.page,
  fontFamily: EMAIL_TOKENS.fontStack,
  margin: 0,
  padding: 0,
  WebkitFontSmoothing: 'antialiased' as const,
  MozOsxFontSmoothing: 'grayscale' as const,
} as const

export const emailContainerStyle = {
  maxWidth: `${EMAIL_TOKENS.maxWidth}px`,
  margin: '0 auto',
  padding: '32px 16px 36px',
} as const

/**
 * <EmailDocument>: Html, Head (with the responsive styles), Preview, Body and
 * the shell, in one wrapper. A template then only writes the card and footer.
 */
export function EmailDocument({ preview, children }: { preview: string; children: ReactNode }) {
  return (
    <Html lang="en">
      <Head>
        <EmailStyles />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={emailBodyStyle}>
        <EmailShell>{children}</EmailShell>
      </Body>
    </Html>
  )
}

/** <EmailShell>: the cream page column, 560px wide, centred. */
export function EmailShell({ children }: { children: ReactNode }) {
  return <Container style={emailContainerStyle}>{children}</Container>
}

// The card

const cardStyle = {
  backgroundColor: EMAIL_TOKENS.surface,
  border: `1px solid ${EMAIL_TOKENS.hairline}`,
  borderRadius: EMAIL_TOKENS.cardRadius,
  overflow: 'hidden' as const,
  width: '100%',
} as const

// Blocks that bring their own padding. A card whose children are all
// self-padded gets no inner padding; a legacy card with loose content gets a
// comfortable default so nothing sits flush against the border.
const SELF_PADDED = new Set<unknown>()

function hasSelfPaddedChild(children: ReactNode): boolean {
  return Children.toArray(children).some((child) => isValidElement(child) && SELF_PADDED.has(child.type))
}

/**
 * <EmailCard>: white, hairline border, leaf radius, clipped. Children are
 * EmailNav, EmailHero, EmailBody, DarkBand and SignOff, in that order.
 */
export function EmailCard({ children }: { children: ReactNode }) {
  const padded = !hasSelfPaddedChild(children)
  return (
    <Section style={cardStyle}>
      {padded ? <Pad padding={`28px ${PAD_X}px`}>{children}</Pad> : children}
    </Section>
  )
}

/** A padded table cell, with the mobile hook. Internal. */
function Pad({ padding, children, style }: { padding: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <Row>
      <Column className="tahi-pad" style={{ padding, ...style }}>
        {children}
      </Column>
    </Row>
  )
}

// Nav band

const navLabelStyle = {
  color: EMAIL_TOKENS.forestLabel,
  fontSize: '11.5px',
  fontWeight: 600,
  letterSpacing: '0.02em',
  lineHeight: '20px',
  margin: 0,
  textAlign: 'right' as const,
  whiteSpace: 'nowrap' as const,
} as const

/**
 * <EmailNav>: forest band with the white wordmark on the left and a small
 * green label on the right (the request number, "Client portal",
 * "Invitation", "Sign in", "Task", "Studio update", "INV-0231", "Billing").
 */
export function EmailNav({ label, wordmarkUrl = EMAIL_WORDMARK_URL }: { label?: string; wordmarkUrl?: string }) {
  return (
    <Row style={{ backgroundColor: EMAIL_TOKENS.forest }}>
      <Column className="tahi-pad" style={{ padding: NAV_PADDING, verticalAlign: 'middle' }}>
        <Img src={wordmarkUrl} alt="Tahi" height={20} width={52} style={{ display: 'block', height: '20px', width: 'auto' }} />
      </Column>
      {label ? (
        <Column className="tahi-pad" style={{ padding: NAV_PADDING, verticalAlign: 'middle', textAlign: 'right' }}>
          <Text style={navLabelStyle}>{label}</Text>
        </Column>
      ) : null}
    </Row>
  )
}

/** Legacy alias: <EmailHeader eyebrow="..." /> renders <EmailNav label="..." />. */
export function EmailHeader({ eyebrow }: { eyebrow?: string }) {
  return <EmailNav label={eyebrow} />
}

// Hero

/** <EmailHero>: kicker, H1 and the opening paragraph. */
export function EmailHero({ children }: { children: ReactNode }) {
  return <Pad padding={HERO_PADDING}>{children}</Pad>
}

export type KickerTone = 'brand' | 'danger' | 'amber' | 'neutral'

const kickerColour: Record<KickerTone, string> = {
  brand: EMAIL_TOKENS.brandDark,
  danger: EMAIL_TOKENS.danger,
  amber: EMAIL_TOKENS.amber,
  neutral: EMAIL_TOKENS.subtle,
}

/** <EmailKicker>: the small uppercase line above the H1. */
export function EmailKicker({ tone = 'brand', children }: { tone?: KickerTone; children: ReactNode }) {
  return (
    <Text
      style={{
        color: kickerColour[tone],
        fontSize: '10.5px',
        fontWeight: 700,
        letterSpacing: '0.09em',
        lineHeight: '14px',
        textTransform: 'uppercase',
        margin: '0 0 16px',
      }}
    >
      {children}
    </Text>
  )
}

/** Legacy alias for <EmailKicker>. */
export function EmailEyebrow({ children, tone }: { children: ReactNode; tone?: KickerTone }) {
  return <EmailKicker tone={tone}>{children}</EmailKicker>
}

/** <EmailHeading>: the 24px H1. */
export function EmailHeading({ children }: { children: ReactNode }) {
  return (
    <Heading
      as="h1"
      className="tahi-h1"
      style={{
        color: EMAIL_TOKENS.ink,
        fontSize: '24px',
        fontWeight: 600,
        lineHeight: 1.22,
        letterSpacing: '-0.015em',
        margin: '0 0 14px',
      }}
    >
      {children}
    </Heading>
  )
}

export type ParagraphVariant = 'default' | 'muted' | 'small'

const paragraphStyles: Record<ParagraphVariant, React.CSSProperties> = {
  default: { color: EMAIL_TOKENS.body, fontSize: '14.5px', fontWeight: 400, lineHeight: 1.65, margin: '0 0 14px' },
  muted: { color: EMAIL_TOKENS.muted, fontSize: '13.5px', fontWeight: 400, lineHeight: 1.65, margin: '0 0 14px' },
  small: { color: EMAIL_TOKENS.subtle, fontSize: '12.5px', fontWeight: 400, lineHeight: 1.6, margin: '0 0 12px' },
}

/**
 * <EmailParagraph>: body copy. `variant` picks default, muted or small; the
 * legacy `subtle` flag maps to small.
 */
export function EmailParagraph({
  children,
  variant,
  subtle = false,
  style,
}: {
  children: ReactNode
  variant?: ParagraphVariant
  subtle?: boolean
  style?: React.CSSProperties
}) {
  const resolved = variant ?? (subtle ? 'small' : 'default')
  return <Text style={{ ...paragraphStyles[resolved], ...style }}>{children}</Text>
}

// Body

/** <EmailBody>: the padded area under the hero that holds the blocks. */
export function EmailBody({ children }: { children: ReactNode }) {
  return <Pad padding={BODY_PADDING}>{children}</Pad>
}

// Ledger rows

export type LedgerTone = 'ink' | 'brand' | 'danger'

const ledgerValueColour: Record<LedgerTone, string> = {
  ink: EMAIL_TOKENS.ink,
  brand: EMAIL_TOKENS.brandDark,
  danger: EMAIL_TOKENS.danger,
}

/** <LedgerRows>: wraps <LedgerRow> entries; closes with a hairline. */
export function LedgerRows({ children }: { children: ReactNode }) {
  return (
    <Section style={{ borderBottom: `1px solid ${EMAIL_TOKENS.hairline}`, margin: '6px 0 18px' }}>
      {children}
    </Section>
  )
}

/** <LedgerRow>: label left (muted), value right (ink, bold). */
export function LedgerRow({
  label,
  value,
  tone = 'ink',
  mono = false,
}: {
  label: ReactNode
  value: ReactNode
  tone?: LedgerTone
  mono?: boolean
}) {
  return (
    <Row style={{ borderTop: `1px solid ${EMAIL_TOKENS.hairline}` }}>
      <Column style={{ padding: '11px 12px 11px 0', verticalAlign: 'top', width: '38%' }}>
        <Text style={{ color: EMAIL_TOKENS.muted, fontSize: '13.5px', fontWeight: 500, lineHeight: 1.45, margin: 0 }}>
          {label}
        </Text>
      </Column>
      <Column style={{ padding: '11px 0', verticalAlign: 'top', textAlign: 'right' }}>
        <Text
          style={{
            color: ledgerValueColour[tone],
            fontSize: '13.5px',
            fontWeight: 600,
            lineHeight: 1.45,
            margin: 0,
            ...(mono ? { fontFamily: EMAIL_TOKENS.monoStack, letterSpacing: '0.02em' } : {}),
          }}
        >
          {value}
        </Text>
      </Column>
    </Row>
  )
}

/** Legacy: <DetailCard> is a <LedgerRows>. */
export function DetailCard({ children }: { children: ReactNode }) {
  return <LedgerRows>{children}</LedgerRows>
}

/** Legacy: <DetailRow> is a <LedgerRow>; `hero` lifts the value to brand dark. */
export function DetailRow({
  label,
  value,
  hero = false,
  mono = false,
}: {
  label: string
  value: ReactNode
  hero?: boolean
  first?: boolean
  mono?: boolean
}) {
  return <LedgerRow label={label} value={value} tone={hero ? 'brand' : 'ink'} mono={mono} />
}

// Note box

export type NoteTone = 'brand' | 'neutral' | 'amber' | 'danger'

const noteBg: Record<NoteTone, string> = {
  brand: EMAIL_TOKENS.brand50,
  neutral: EMAIL_TOKENS.neutralBg,
  amber: EMAIL_TOKENS.amberBg,
  danger: EMAIL_TOKENS.dangerBg,
}

const noteTitleColour: Record<NoteTone, string> = {
  brand: EMAIL_TOKENS.brandDark,
  neutral: EMAIL_TOKENS.ink,
  amber: EMAIL_TOKENS.amber,
  danger: EMAIL_TOKENS.danger,
}

/** <NoteBox>: tinted box with an optional bold title and a short paragraph. */
export function NoteBox({ tone = 'brand', title, children }: { tone?: NoteTone; title?: ReactNode; children: ReactNode }) {
  return (
    <Section style={{ backgroundColor: noteBg[tone], borderRadius: EMAIL_TOKENS.noteRadius, margin: '0 0 16px' }}>
      <Row>
        <Column style={{ padding: '14px 18px' }}>
          {title ? (
            <Text style={{ color: noteTitleColour[tone], fontSize: '13.5px', fontWeight: 700, lineHeight: 1.45, margin: '0 0 4px' }}>
              {title}
            </Text>
          ) : null}
          <Text style={{ color: EMAIL_TOKENS.body, fontSize: '13.5px', fontWeight: 400, lineHeight: 1.6, margin: 0 }}>
            {children}
          </Text>
        </Column>
      </Row>
    </Section>
  )
}

const bannerTone: Record<'success' | 'warning' | 'danger' | 'info', NoteTone> = {
  success: 'brand',
  warning: 'amber',
  danger: 'danger',
  info: 'neutral',
}

/** Legacy: <EmailBanner kind> is a <NoteBox tone>. */
export function EmailBanner({ kind, children }: { kind: 'success' | 'warning' | 'danger' | 'info'; children: ReactNode }) {
  return <NoteBox tone={bannerTone[kind]}>{children}</NoteBox>
}

// Facts

/** <Facts>: two columns of <Fact>; single column on mobile. */
export function Facts({ children }: { children: ReactNode }) {
  return <Row style={{ margin: '4px 0 14px' }}>{children}</Row>
}

/** <Fact>: uppercase label, 22px value, small sub line. */
export function Fact({ label, value, sub }: { label: ReactNode; value: ReactNode; sub?: ReactNode }) {
  return (
    <Column className="tahi-fact" style={{ width: '50%', verticalAlign: 'top', paddingRight: '16px' }}>
      <Text style={{ color: EMAIL_TOKENS.subtle, fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.08em', lineHeight: '14px', textTransform: 'uppercase', margin: '0 0 6px' }}>
        {label}
      </Text>
      <Text style={{ color: EMAIL_TOKENS.ink, fontSize: '22px', fontWeight: 600, lineHeight: 1.2, letterSpacing: '-0.01em', margin: '0 0 4px' }}>
        {value}
      </Text>
      {sub ? (
        <Text style={{ color: EMAIL_TOKENS.muted, fontSize: '12.5px', fontWeight: 400, lineHeight: 1.5, margin: 0 }}>{sub}</Text>
      ) : null}
    </Column>
  )
}

// Person plus quote

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

/** <PersonQuote>: 40px avatar (image or initials), bold name, small quote. */
export function PersonQuote({
  name,
  quote,
  avatarUrl,
  initials,
}: {
  name: string
  quote: ReactNode
  avatarUrl?: string | null
  initials?: string
}) {
  const fallback = initials ?? initialsOf(name)
  return (
    <Row style={{ margin: '4px 0 16px' }}>
      <Column style={{ width: '52px', verticalAlign: 'top', paddingRight: '12px' }}>
        {avatarUrl ? (
          <Img src={avatarUrl} alt={name} width={40} height={40} style={{ display: 'block', width: '40px', height: '40px', borderRadius: '50%' }} />
        ) : (
          <span
            style={{
              display: 'inline-block',
              width: '40px',
              height: '40px',
              lineHeight: '40px',
              borderRadius: '50%',
              backgroundColor: EMAIL_TOKENS.brandDark,
              color: '#ffffff',
              fontSize: '13px',
              fontWeight: 700,
              textAlign: 'center',
            }}
          >
            {fallback}
          </span>
        )}
      </Column>
      <Column style={{ verticalAlign: 'top' }}>
        <Text style={{ color: EMAIL_TOKENS.ink, fontSize: '13.5px', fontWeight: 700, lineHeight: 1.4, margin: '0 0 3px' }}>{name}</Text>
        <Text style={{ color: EMAIL_TOKENS.muted, fontSize: '12.5px', fontWeight: 400, lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
          {quote}
        </Text>
      </Column>
    </Row>
  )
}

// Block quote

/** <BlockQuote>: 2px brand rule, body text, small attribution. */
export function BlockQuote({ children, attribution }: { children: ReactNode; attribution?: ReactNode }) {
  return (
    <Row style={{ margin: '4px 0 16px' }}>
      <Column style={{ borderLeft: `2px solid ${EMAIL_TOKENS.brand}`, padding: '2px 0 2px 16px' }}>
        <Text style={{ color: EMAIL_TOKENS.body, fontSize: '14.5px', fontWeight: 400, lineHeight: 1.65, margin: 0, whiteSpace: 'pre-wrap' }}>
          {children}
        </Text>
        {attribution ? (
          <Text style={{ color: EMAIL_TOKENS.subtle, fontSize: '12px', fontWeight: 500, lineHeight: 1.5, margin: '8px 0 0' }}>{attribution}</Text>
        ) : null}
      </Column>
    </Row>
  )
}

/** Legacy: <MessageBlock fromName message> is a <BlockQuote> attributed to the sender. */
export function MessageBlock({ fromName, message }: { fromName: string; message: string }) {
  return <BlockQuote attribution={fromName}>{message}</BlockQuote>
}

// Numbered steps

/** <Steps>: wraps <Step> entries and draws the hairline between them. */
export function Steps({ children }: { children: ReactNode }) {
  const items = Children.toArray(children)
  return (
    <Section style={{ margin: '4px 0 16px' }}>
      {items.map((child, i) =>
        i === 0 ? (
          child
        ) : (
          <Row key={i} style={{ borderTop: `1px solid ${EMAIL_TOKENS.hairline}` }}>
            <Column>{child}</Column>
          </Row>
        ),
      )}
    </Section>
  )
}

/** <Step>: round brand-50 badge with the number, bold title, muted detail. */
export function Step({ n, title, detail }: { n: number | string; title: ReactNode; detail?: ReactNode }) {
  return (
    <Row>
      <Column style={{ width: '34px', verticalAlign: 'top', padding: '12px 12px 12px 0' }}>
        <span
          style={{
            display: 'inline-block',
            width: '22px',
            height: '22px',
            lineHeight: '22px',
            borderRadius: '50%',
            backgroundColor: EMAIL_TOKENS.brand50,
            color: EMAIL_TOKENS.brandDark,
            fontSize: '11.5px',
            fontWeight: 700,
            textAlign: 'center',
          }}
        >
          {n}
        </span>
      </Column>
      <Column style={{ verticalAlign: 'top', padding: '12px 0' }}>
        <Text style={{ color: EMAIL_TOKENS.ink, fontSize: '13.5px', fontWeight: 700, lineHeight: 1.45, margin: '0 0 2px' }}>{title}</Text>
        {detail ? (
          <Text style={{ color: EMAIL_TOKENS.muted, fontSize: '12.5px', fontWeight: 400, lineHeight: 1.55, margin: 0 }}>{detail}</Text>
        ) : null}
      </Column>
    </Row>
  )
}

// Code box

/** <CodeBox>: a one-time code, 30px, tabular, letter-spaced, centred. */
export function CodeBox({ code }: { code: string }) {
  return (
    <Section style={{ border: `1px solid ${EMAIL_TOKENS.hairline}`, borderRadius: '8px', margin: '4px 0 16px' }}>
      <Row>
        <Column style={{ padding: '22px', textAlign: 'center' }}>
          <Text
            className="tahi-code"
            style={{
              color: EMAIL_TOKENS.ink,
              fontSize: '30px',
              fontWeight: 600,
              letterSpacing: '0.3em',
              lineHeight: 1.2,
              fontVariantNumeric: 'tabular-nums',
              margin: 0,
              textAlign: 'center',
              textIndent: '0.3em',
            }}
          >
            {code}
          </Text>
        </Column>
      </Row>
    </Section>
  )
}

// Dark band

export type DarkKickerTone = 'brand' | 'info' | 'amber'

const darkKickerColour: Record<DarkKickerTone, string> = {
  brand: EMAIL_TOKENS.forestLabel,
  info: EMAIL_TOKENS.forestInfo,
  amber: EMAIL_TOKENS.forestAmber,
}

/**
 * <DarkBand>: forest section with kicker, H1, paragraph and a white button.
 * `kickerTone` tints the kicker only; the button is always the white onDark
 * variant, because a coloured button on the forest band reads as an alert
 * rather than a note from the studio.
 */
export function DarkBand({
  kicker,
  kickerTone = 'brand',
  heading,
  children,
  buttonLabel,
  buttonHref,
}: {
  kicker?: ReactNode
  kickerTone?: DarkKickerTone
  heading: ReactNode
  children?: ReactNode
  buttonLabel?: string
  buttonHref?: string
}) {
  return (
    <Row style={{ backgroundColor: EMAIL_TOKENS.forest }}>
      <Column className="tahi-pad" style={{ padding: `28px ${PAD_X}px` }}>
        {kicker ? (
          <Text style={{ color: darkKickerColour[kickerTone], fontSize: '10.5px', fontWeight: 700, letterSpacing: '0.09em', lineHeight: '14px', textTransform: 'uppercase', margin: '0 0 14px' }}>
            {kicker}
          </Text>
        ) : null}
        <Heading
          as="h2"
          className="tahi-h1"
          style={{ color: EMAIL_TOKENS.forestHeading, fontSize: '24px', fontWeight: 600, lineHeight: 1.22, letterSpacing: '-0.015em', margin: '0 0 12px' }}
        >
          {heading}
        </Heading>
        {children ? (
          <Text style={{ color: EMAIL_TOKENS.forestBody, fontSize: '14.5px', fontWeight: 400, lineHeight: 1.65, margin: '0 0 18px' }}>{children}</Text>
        ) : null}
        {buttonLabel && buttonHref ? (
          <PrimaryButton href={buttonHref} variant="onDark">
            {buttonLabel}
          </PrimaryButton>
        ) : null}
      </Column>
    </Row>
  )
}

// Buttons

export type ButtonVariant = 'brand' | 'quiet' | 'onDark' | 'warning' | 'danger'

const buttonBase = {
  display: 'inline-block' as const,
  fontFamily: EMAIL_TOKENS.fontStack,
  fontSize: '13.5px',
  fontWeight: 600,
  lineHeight: '18px',
  padding: '13px 22px',
  textDecoration: 'none',
  textAlign: 'center' as const,
  margin: '4px 14px 10px 0',
  verticalAlign: 'middle' as const,
} as const

const buttonVariants: Record<ButtonVariant, React.CSSProperties> = {
  brand: { backgroundColor: EMAIL_TOKENS.brandDark, color: '#ffffff', borderRadius: EMAIL_TOKENS.buttonRadius },
  // Legacy tones. The design has one primary button, so both land on brand dark.
  warning: { backgroundColor: EMAIL_TOKENS.brandDark, color: '#ffffff', borderRadius: EMAIL_TOKENS.buttonRadius },
  danger: { backgroundColor: EMAIL_TOKENS.brandDark, color: '#ffffff', borderRadius: EMAIL_TOKENS.buttonRadius },
  quiet: {
    backgroundColor: 'transparent',
    color: EMAIL_TOKENS.ink,
    border: `1px solid ${EMAIL_TOKENS.hairline}`,
    borderRadius: EMAIL_TOKENS.quietRadius,
    padding: '12px 21px',
  },
  onDark: { backgroundColor: '#ffffff', color: EMAIL_TOKENS.forest, borderRadius: EMAIL_TOKENS.buttonRadius },
}

/** <Buttons>: the row that holds a <PrimaryButton> and a <SecondaryLink>. */
export function Buttons({ children }: { children: ReactNode }) {
  return (
    <Row style={{ margin: '6px 0 8px' }}>
      <Column style={{ verticalAlign: 'middle' }}>{children}</Column>
    </Row>
  )
}

/**
 * <PrimaryButton>: brand dark, white text, the one leaf on the page. `quiet`
 * is a hairline-bordered text button; `onDark` is the white button for a
 * <DarkBand>.
 */
export function PrimaryButton({ href, children, variant = 'brand' }: { href: string; children: ReactNode; variant?: ButtonVariant }) {
  return (
    <Link href={href} className="tahi-btn" style={{ ...buttonBase, ...buttonVariants[variant] }}>
      {children}
    </Link>
  )
}

/** <SecondaryLink>: brand dark text link that sits beside the button. */
export function SecondaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="tahi-btn"
      style={{
        display: 'inline-block',
        fontFamily: EMAIL_TOKENS.fontStack,
        color: EMAIL_TOKENS.brandDark,
        fontSize: '13.5px',
        fontWeight: 600,
        lineHeight: '18px',
        padding: '13px 0',
        margin: '4px 14px 10px 0',
        textDecoration: 'none',
        verticalAlign: 'middle',
      }}
    >
      {children}
    </Link>
  )
}

// Footnote and mono

/** <EmailFootnote>: small helper text; `framed` puts it in a neutral <NoteBox>. */
export function EmailFootnote({ children, framed = false }: { children: ReactNode; framed?: boolean }) {
  if (framed) return <NoteBox tone="neutral">{children}</NoteBox>
  return <EmailParagraph variant="small">{children}</EmailParagraph>
}

/** Inline monospace span for identifiers and references. */
export function Mono({ children }: { children: ReactNode }) {
  return (
    <span style={{ fontFamily: EMAIL_TOKENS.monoStack, fontSize: '12.5px', letterSpacing: '0.02em', color: EMAIL_TOKENS.brandDark, fontWeight: 600 }}>
      {children}
    </span>
  )
}

// How to pay: bank transfer details, when there is no pay page.
//
// A Xero-rail invoice has no pay link until Liam approves it inside Xero, so
// "no link" is where each of those bills starts. Amount and due date are not
// repeated here: they already sit in the ledger above this block.

export function HowToPayBlock({ howToPay }: { howToPay: InvoiceHowToPay }) {
  const rows: Array<{ label: string; value: string; mono?: boolean }> = []
  if (howToPay.bankName) rows.push({ label: 'Bank', value: howToPay.bankName })
  if (howToPay.accountName) rows.push({ label: 'Account name', value: howToPay.accountName })
  if (howToPay.accountNumber) rows.push({ label: 'Account number', value: howToPay.accountNumber, mono: true })
  rows.push({ label: 'Reference', value: howToPay.reference, mono: true })

  return (
    <>
      <EmailKicker>How to pay</EmailKicker>
      <LedgerRows>
        {rows.map((row) => (
          <LedgerRow key={row.label} label={row.label} value={row.value} mono={row.mono} />
        ))}
      </LedgerRows>
      <EmailParagraph variant="small">{howToPay.hint}</EmailParagraph>
    </>
  )
}

// Sign-off

/** <SignOff>: closing line, bold name, then "Tahi Studio". */
export function SignOff({ closing = 'Ngā mihi', name, studio = 'Tahi Studio' }: { closing?: string; name: string; studio?: string }) {
  return (
    <Pad padding={SIGNOFF_PADDING}>
      <Text style={{ color: EMAIL_TOKENS.body, fontSize: '14.5px', fontWeight: 400, lineHeight: 1.65, margin: 0 }}>
        {closing}
        <br />
        <span style={{ color: EMAIL_TOKENS.ink, fontWeight: 700 }}>{name}</span>
        <br />
        {studio}
      </Text>
    </Pad>
  )
}

// Footer (outside the card)

export type FooterAudience = 'client' | 'team' | 'auth'

const footerLineStyle = {
  color: EMAIL_TOKENS.subtle,
  fontSize: '11.5px',
  fontWeight: 400,
  lineHeight: 1.6,
  margin: '0 0 4px',
  textAlign: 'center' as const,
} as const

const footerLinkStyle = {
  color: EMAIL_TOKENS.muted,
  fontSize: '11.5px',
  fontWeight: 600,
  textDecoration: 'none',
} as const

function audienceLine(audience: FooterAudience, recipientEmail?: string | null): string {
  if (audience === 'team') return 'Internal. Clients never receive this email.'
  if (audience === 'auth') return 'This is an automated message.'
  return recipientEmail
    ? `Sent to ${recipientEmail} because you have a Tahi account.`
    : 'Sent to you because you have a Tahi account.'
}

/**
 * <EmailFooter>: centred on the cream page under the card. Wordmark, the
 * studio line (city and country only, never a street address), the audience
 * line, and the two links (omitted on auth mail).
 *
 * The wordmark image is white on transparent, so on the cream page it is set
 * as text at the same 12px height.
 */
export function EmailFooter({
  audience = 'client',
  recipientEmail,
  settingsUrl = publicUrl('/settings'),
  helpUrl = `mailto:${CONTACT_EMAIL}`,
  unsubscribeUrl,
}: {
  audience?: FooterAudience
  recipientEmail?: string | null
  settingsUrl?: string
  helpUrl?: string
  unsubscribeUrl?: string
}) {
  return (
    <Section style={{ padding: '26px 16px 0' }}>
      <Text style={{ color: EMAIL_TOKENS.subtle, fontSize: '12px', fontWeight: 800, letterSpacing: '-0.01em', lineHeight: '12px', margin: '0 0 10px', textAlign: 'center' }}>
        Tahi Studio
      </Text>
      <Text style={footerLineStyle}>Tahi Studio, Whanganui, New Zealand</Text>
      <Text style={footerLineStyle}>{audienceLine(audience, recipientEmail)}</Text>
      {audience !== 'auth' ? (
        <Text style={{ ...footerLineStyle, margin: '8px 0 0' }}>
          <Link href={settingsUrl} style={footerLinkStyle}>
            Notification settings
          </Link>
          <span style={{ color: EMAIL_TOKENS.subtle, padding: '0 8px' }}>&middot;</span>
          <Link href={helpUrl} style={footerLinkStyle}>
            Help
          </Link>
          {unsubscribeUrl ? (
            <>
              <span style={{ color: EMAIL_TOKENS.subtle, padding: '0 8px' }}>&middot;</span>
              <Link href={unsubscribeUrl} style={footerLinkStyle}>
                Unsubscribe
              </Link>
            </>
          ) : null}
        </Text>
      ) : null}
    </Section>
  )
}

// Register the self-padded blocks so <EmailCard> knows when to stay flush.
for (const block of [EmailNav, EmailHeader, EmailHero, EmailBody, DarkBand, SignOff]) SELF_PADDED.add(block)
