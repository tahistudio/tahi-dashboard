'use client'

/**
 * The New client slide-over. Same endpoint and same body shape as before
 * (POST /api/admin/clients), with three things the prototype asked for and
 * the old form did not have: a line under the plan select that says what the
 * plan actually buys, a switch that decides whether the invite goes out now,
 * and an address check before anything is written.
 *
 * The invite outcome is the caller's business: this panel only collects, and
 * <ClientList> reports what really happened to the email.
 *
 * The contact is collected as First name and Last name and sent as one
 * joined string, because that is all the endpoint and the contacts table
 * hold, and because every client email greets on the first word of it.
 *
 * The panel deliberately stops at the organisation. The prototype also
 * offered custom pricing, add-ons, a billing channel and an account owner;
 * the create endpoint accepts none of those, and a control that quietly drops
 * its value on save is worse than no control.
 */

import * as React from 'react'
import { Building2, Globe, Mail, RefreshCw, Save, User as UserIcon } from 'lucide-react'
import { SlideOver } from '@/components/tahi/slide-over'
import { TahiButton } from '@/components/tahi/tahi-button'
import { Input, Select } from '@/components/tahi/input'

export interface NewClientDraft {
  name: string
  website: string
  industry: string
  planType: string
  /** Collected apart, sent joined. See draftContactName(). */
  primaryContactFirstName: string
  primaryContactLastName: string
  primaryContactEmail: string
  sendInvite: boolean
}

export const EMPTY_CLIENT_DRAFT: NewClientDraft = {
  name: '',
  website: '',
  industry: '',
  planType: '',
  primaryContactFirstName: '',
  primaryContactLastName: '',
  primaryContactEmail: '',
  sendInvite: true,
}

/** Plan values map one to one with the create endpoint's slugs: Maintain and
 *  Scale are the two that spin up a subscription and provision tracks. */
const PLAN_OPTIONS = [
  { value: '', label: 'No plan yet' },
  { value: 'maintain', label: 'Maintain (NZ$1,500/mo)' },
  { value: 'scale', label: 'Scale (NZ$4,000/mo)' },
  { value: 'tune', label: 'Tune (NZ$750 one-off)' },
  { value: 'launch', label: 'Launch (NZ$2,500 one-off)' },
  { value: 'hourly', label: 'Hourly' },
  { value: 'custom', label: 'Custom project' },
] as const

const PLAN_HINTS: Record<string, string> = {
  '': 'Nothing is billed on a cycle. You can set a plan later from the client page.',
  maintain: 'One small track. Retainer, invoiced monthly.',
  scale: 'One large and one small track. Retainer, invoiced monthly.',
  tune: 'A one-off. No tracks.',
  launch: 'A one-off build. No tracks.',
  hourly: 'Logged time, invoiced at the end of the month.',
  custom: 'A bespoke engagement. Set the price and the tracks on the client page.',
}

const INDUSTRY_OPTIONS = [
  { value: '', label: 'Select industry...' },
  { value: 'Technology', label: 'Technology' },
  { value: 'E-commerce', label: 'E-commerce' },
  { value: 'Healthcare', label: 'Healthcare' },
  { value: 'Finance', label: 'Finance' },
  { value: 'Education', label: 'Education' },
  { value: 'Hospitality', label: 'Hospitality' },
  { value: 'Real estate', label: 'Real estate' },
  { value: 'Professional services', label: 'Professional services' },
  { value: 'Non-profit', label: 'Non-profit' },
  { value: 'Other', label: 'Other' },
] as const

/**
 * Every field in this panel is 44px on a phone and the app's own 2.25rem from
 * md up.
 *
 * <Input> and <Select> both fix their height inline at inputSize md, which is
 * 2.25rem, and this panel stacks to one column on a 375px screen, so all of it
 * is thumbed. min-height clamps a fixed height, which is why a class beats the
 * primitive's inline style without touching the primitive. The same pair of
 * classes is on the contact form in clients/[id]/tabs/people.tsx.
 */
const FIELD_HEIGHT = 'min-h-[2.75rem] md:min-h-[2.25rem]'

/** <Select> hands its className to the positioning wrapper and not to the
 *  native control inside it, so the target has to be named through the child.
 *  The wrapper grows with it. */
const SELECT_HEIGHT = '[&>select]:min-h-[2.75rem] md:[&>select]:min-h-[2.25rem]'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isDraftEmailValid(draft: NewClientDraft): boolean {
  const email = draft.primaryContactEmail.trim()
  return email.length === 0 || EMAIL_RE.test(email)
}

/**
 * The one name POST /api/admin/clients takes, built from the two fields the
 * panel asks for.
 *
 * The contacts table holds a single `name` column, so the split lives in the
 * form and not in D1. It is worth having there anyway: every client email
 * greets on the first word of that name (emails/client-invite.tsx does
 * `contactName.split(' ')[0]`), and one "Full name" box is where "Smith,
 * Jane" and "Dr Jane Smith" came from. Empty on both sides returns an empty
 * string, which is what makes the endpoint fall back to the address.
 */
export function draftContactName(draft: NewClientDraft): string {
  return [draft.primaryContactFirstName, draft.primaryContactLastName]
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .join(' ')
}

/** The endpoint asks for a non-empty name and nothing more, so this asks for
 *  exactly that. A stricter rule here is a button that sits dead with no copy
 *  saying why: the guard also blocks submit, so the inline error never fires. */
export function canSubmitDraft(draft: NewClientDraft): boolean {
  return draft.name.trim().length > 0 && isDraftEmailValid(draft)
}

export function NewClientPanel({
  open,
  draft,
  saving,
  error,
  onUpdate,
  onClose,
  onSubmit,
}: {
  open: boolean
  draft: NewClientDraft
  saving: boolean
  error: string | null
  onUpdate: <K extends keyof NewClientDraft>(key: K, value: NewClientDraft[K]) => void
  onClose: () => void
  onSubmit: () => void
}) {
  const emailOk = isDraftEmailValid(draft)
  const hasEmail = draft.primaryContactEmail.trim().length > 0
  const canSubmit = canSubmitDraft(draft)
  const emailErrorId = React.useId()

  return (
    <SlideOver
      open={open}
      onClose={onClose}
      icon={<Building2 size={15} />}
      title="Add a client"
      subtitle="The organisation first. Contacts, brands and billing can follow on the client page."
      maxWidth="42rem"
    >
      <SlideOver.Body>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <div aria-live="polite">
            {error && (
              <div
                style={{
                  padding: '0.5rem 0.75rem',
                  borderRadius: 'var(--radius-md)',
                  background: 'var(--color-danger-bg)',
                  border: '1px solid var(--color-danger)',
                  color: 'var(--color-danger)',
                  fontSize: 'var(--text-sm)',
                }}
              >
                {error}
              </div>
            )}
          </div>

          <Field label="Client or company name">
            <Input
              value={draft.name}
              onChange={e => onUpdate('name', e.target.value)}
              placeholder="Kowtow Clothing"
              inputSize="md"
              className={FIELD_HEIGHT}
              leadingIcon={<Building2 size={13} aria-hidden="true" />}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onSubmit() }}
            />
          </Field>

          <Field label="Website">
            <Input
              value={draft.website}
              onChange={e => onUpdate('website', e.target.value)}
              placeholder="kowtowclothing.com"
              inputSize="md"
              type="url"
              className={FIELD_HEIGHT}
              leadingIcon={<Globe size={13} aria-hidden="true" />}
            />
          </Field>

          {/* The two selects sit on one line, and stack under 40rem: the
              breakpoint is Tailwind's own sm, so the class is static and the
              gap stays on the token scale. The plan hint lives inside the
              plan's own cell, which is why the row is aligned to the top and
              not stretched. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 items-start" style={{ gap: '0.75rem' }}>
            <Field label="Industry">
              <Select
                value={draft.industry}
                onChange={e => onUpdate('industry', e.target.value)}
                options={INDUSTRY_OPTIONS}
                selectSize="md"
                className={SELECT_HEIGHT}
                style={{ width: '100%' }}
              />
            </Field>
            <Field label="Plan" hint={PLAN_HINTS[draft.planType] ?? PLAN_HINTS['']}>
              <Select
                value={draft.planType}
                onChange={e => onUpdate('planType', e.target.value)}
                options={PLAN_OPTIONS}
                selectSize="md"
                className={SELECT_HEIGHT}
                style={{ width: '100%' }}
              />
            </Field>
          </div>

          {/* A rule, not a one-sided border: the house rule is borders on
              every side or none, and this is a separator between two halves
              of one form. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            style={{ height: '1px', marginTop: '0.25rem', background: 'var(--color-border-subtle)' }}
          />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.625rem',
            }}
          >
            <div>
              <SectionLabel>Primary contact</SectionLabel>
              <p style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>
                Optional. Whoever should get the portal invite.
              </p>
            </div>

            {/* First and last, not one "Full name" box. Every client email
                greets on the first word of the stored name, and this is the
                only place that word is ever typed.

                Both halves carry the icon. <Input> renders a different box
                depending: with a leading icon it is a padded flex group whose
                text starts past the glyph, without one it is a bare input
                whose text starts at its own padding. One of each side by side
                puts the two placeholders on different left edges, and the
                email below would not line up with either.

                autoComplete is off on all three. These fields describe the
                client's person, not the operator filling the form, and Chrome
                reads given-name / family-name / email as one section: a single
                tap on its suggestion would drop the operator's own name and
                address in, and the invite switch below defaults to on. Same
                call as the invite box in components/tahi/onboarding-content. */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '0.75rem' }}>
              <Input
                value={draft.primaryContactFirstName}
                onChange={e => onUpdate('primaryContactFirstName', e.target.value)}
                placeholder="First name"
                inputSize="md"
                className={FIELD_HEIGHT}
                autoComplete="off"
                aria-label="Primary contact first name"
                leadingIcon={<UserIcon size={13} aria-hidden="true" />}
              />
              <Input
                value={draft.primaryContactLastName}
                onChange={e => onUpdate('primaryContactLastName', e.target.value)}
                placeholder="Last name"
                inputSize="md"
                className={FIELD_HEIGHT}
                autoComplete="off"
                aria-label="Primary contact last name"
                leadingIcon={<UserIcon size={13} aria-hidden="true" />}
              />
            </div>

            <div>
              <Input
                value={draft.primaryContactEmail}
                onChange={e => onUpdate('primaryContactEmail', e.target.value)}
                placeholder="email@company.com"
                inputSize="md"
                type="email"
                className={FIELD_HEIGHT}
                autoComplete="off"
                aria-label="Primary contact email"
                aria-invalid={!emailOk}
                aria-describedby={emailOk ? undefined : emailErrorId}
                leadingIcon={<Mail size={13} aria-hidden="true" />}
              />
              <div aria-live="polite">
                {!emailOk && (
                  <p id={emailErrorId} style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem', color: 'var(--color-danger)' }}>
                    That does not look like an email address.
                  </p>
                )}
              </div>
            </div>

            {hasEmail && (
              <PanelSwitch
                on={draft.sendInvite}
                onChange={next => onUpdate('sendInvite', next)}
                label="Send the portal invite now"
                hint="A welcome email with a sign-in link, bound to that address."
              />
            )}
          </div>
        </div>
      </SlideOver.Body>

      <SlideOver.Footer>
        <TahiButton variant="secondary" size="sm" style={{ minHeight: '2.75rem' }} onClick={onClose} disabled={saving}>
          Cancel
        </TahiButton>
        <span style={{ flex: 1, fontSize: '0.6875rem', color: 'var(--color-text-subtle)', paddingLeft: '0.75rem' }}>
          {hasEmail && draft.sendInvite
            ? 'The invite goes out the moment you create.'
            : 'You can invite people later from the client page.'}
        </span>
        <TahiButton
          size="sm"
          style={{ minHeight: '2.75rem' }}
          onClick={onSubmit}
          disabled={saving || !canSubmit}
          iconLeft={saving
            ? <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            : <Save className="w-3.5 h-3.5" />}
        >
          {saving ? 'Adding...' : 'Add client'}
        </TahiButton>
      </SlideOver.Footer>
    </SlideOver>
  )
}

/**
 * A labelled control. The label is a real <label htmlFor>, and the id it names
 * is minted here and handed to the child, so the control it labels is the
 * control that gets it. A sibling <label> with no `htmlFor` names nothing: a
 * screen reader reads the field as an unlabelled text box.
 *
 * `hint`, when present, is wired through aria-describedby for the same reason.
 */
function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactElement<{ id?: string; 'aria-describedby'?: string }>
}) {
  const id = React.useId()
  const hintId = `${id}-hint`
  return (
    <div>
      <label
        htmlFor={id}
        style={{
          display: 'block',
          fontSize: '0.625rem',
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--color-text-subtle)',
          marginBottom: '0.3125rem',
        }}
      >
        {label}
      </label>
      {React.cloneElement(children, {
        id,
        'aria-describedby': hint ? hintId : children.props['aria-describedby'],
      })}
      {hint && (
        <p id={hintId} style={{ margin: '0.3125rem 0 0', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{hint}</p>
      )}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'block',
        fontSize: '0.625rem',
        fontWeight: 600,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: 'var(--color-text-subtle)',
      }}
    >
      {children}
    </span>
  )
}

/** A local switch. There is no shared one in components/tahi yet, and this
 *  panel is not the place to mint a primitive; when a second surface needs it,
 *  lift this whole function rather than writing a third. */
function PanelSwitch({
  on,
  onChange,
  label,
  hint,
}: {
  on: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="tahi-focus-ring"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: '0.625rem',
        width: '100%',
        minHeight: '2.75rem',
        padding: '0.5rem 0.625rem',
        border: `1px solid ${on ? 'var(--color-brand)' : 'var(--color-border-subtle)'}`,
        borderRadius: 'var(--radius-md)',
        background: on ? 'var(--color-brand-50)' : 'var(--color-bg-secondary)',
        fontFamily: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'border-color var(--motion-quick) var(--ease-out), background-color var(--motion-quick) var(--ease-out)',
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          marginTop: '0.125rem',
          width: '2rem',
          height: '1.125rem',
          padding: '0.125rem',
          borderRadius: 'var(--radius-full)',
          background: on ? 'var(--color-brand)' : 'var(--color-border)',
          display: 'inline-flex',
          justifyContent: on ? 'flex-end' : 'flex-start',
          transition: 'background-color var(--motion-quick) var(--ease-out)',
        }}
      >
        <span
          style={{
            width: '0.875rem',
            height: '0.875rem',
            borderRadius: 'var(--radius-full)',
            background: 'var(--color-bg)',
          }}
        />
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem', minWidth: 0 }}>
        <span style={{ fontSize: '0.78125rem', fontWeight: 600, color: 'var(--color-text)' }}>{label}</span>
        {hint && <span style={{ fontSize: '0.6875rem', color: 'var(--color-text-muted)' }}>{hint}</span>}
      </span>
    </button>
  )
}
