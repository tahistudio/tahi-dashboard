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
  primaryContactName: string
  primaryContactEmail: string
  sendInvite: boolean
}

export const EMPTY_CLIENT_DRAFT: NewClientDraft = {
  name: '',
  website: '',
  industry: '',
  planType: '',
  primaryContactName: '',
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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isDraftEmailValid(draft: NewClientDraft): boolean {
  const email = draft.primaryContactEmail.trim()
  return email.length === 0 || EMAIL_RE.test(email)
}

export function canSubmitDraft(draft: NewClientDraft): boolean {
  return draft.name.trim().length > 1 && isDraftEmailValid(draft)
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
              leadingIcon={<Building2 size={13} aria-hidden="true" />}
              autoFocus
              onKeyDown={e => { if (e.key === 'Enter' && canSubmit) onSubmit() }}
            />
          </Field>

          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: '0.75rem' }}>
            <Field label="Website">
              <Input
                value={draft.website}
                onChange={e => onUpdate('website', e.target.value)}
                placeholder="kowtowclothing.com"
                inputSize="md"
                type="url"
                leadingIcon={<Globe size={13} aria-hidden="true" />}
              />
            </Field>
            <Field label="Industry">
              <Select
                value={draft.industry}
                onChange={e => onUpdate('industry', e.target.value)}
                options={INDUSTRY_OPTIONS}
                selectSize="md"
                style={{ width: '100%' }}
              />
            </Field>
          </div>

          <Field label="Plan" hint={PLAN_HINTS[draft.planType] ?? PLAN_HINTS['']}>
            <Select
              value={draft.planType}
              onChange={e => onUpdate('planType', e.target.value)}
              options={PLAN_OPTIONS}
              selectSize="md"
              style={{ width: '100%' }}
            />
          </Field>

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

            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.5fr)', gap: '0.75rem' }}>
              <Input
                value={draft.primaryContactName}
                onChange={e => onUpdate('primaryContactName', e.target.value)}
                placeholder="Full name"
                inputSize="md"
                aria-label="Primary contact name"
                leadingIcon={<UserIcon size={13} aria-hidden="true" />}
              />
              <div>
                <Input
                  value={draft.primaryContactEmail}
                  onChange={e => onUpdate('primaryContactEmail', e.target.value)}
                  placeholder="email@company.com"
                  inputSize="md"
                  type="email"
                  aria-label="Primary contact email"
                  aria-invalid={!emailOk}
                  leadingIcon={<Mail size={13} aria-hidden="true" />}
                />
                <div aria-live="polite">
                  {!emailOk && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.6875rem', color: 'var(--color-danger)' }}>
                      That does not look like an email address.
                    </p>
                  )}
                </div>
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label
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
      {children}
      {hint && (
        <p style={{ margin: '0.3125rem 0 0', fontSize: '0.6875rem', color: 'var(--color-text-subtle)' }}>{hint}</p>
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
