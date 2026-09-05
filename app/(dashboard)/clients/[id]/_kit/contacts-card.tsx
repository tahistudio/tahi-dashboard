'use client'

/**
 * <ContactsCard>. The Overview rail read of who is at this client and who
 * already has portal access. Editing lives on the People tab.
 */

import { Mail, Plus, User, Users } from 'lucide-react'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { EmptyState } from '@/components/tahi/empty-state'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Contact } from './types'

// ── Contacts card ──────────────────────────────────────────────────────────────

export function ContactsCard({
  contacts,
  onManage,
}: {
  contacts: Contact[]
  /** Opens the People tab, where adding and inviting actually happen. */
  onManage?: () => void
}) {
  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)' }}>
        <Card.Title style={{ fontSize: 'var(--text-sm)' }}>Contacts</Card.Title>
        {onManage && (
          <Card.Action>
            <TahiButton
              variant="ghost"
              size="sm"
              iconLeft={<Plus className="w-3.5 h-3.5" />}
              aria-label="Add a contact on the People tab"
              onClick={onManage}
            >
              Add
            </TahiButton>
          </Card.Action>
        )}
      </Card.Header>

      {contacts.length === 0 ? (
        <EmptyState
          variant="inline"
          icon={<Users className="w-8 h-8" />}
          title="No contacts yet"
          description="Nobody at this client can sign in until someone is added here."
          ctaLabel={onManage ? 'Add a contact' : undefined}
          onCtaClick={onManage}
        />
      ) : (
        <div className="flex flex-col gap-3">
          {contacts.map(contact => (
            <div key={contact.id} className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-full bg-[var(--color-brand-50)] flex items-center justify-center text-[var(--color-brand)] text-xs font-bold flex-shrink-0">
                {contact.name.charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span data-private className="text-sm font-medium text-[var(--color-text)] truncate">
                    {contact.name}
                  </span>
                  {contact.isPrimary && (
                    <Badge tone="brand" size="sm">Primary</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                  <Mail className="w-3 h-3" />
                  <span data-private className="truncate">{contact.email}</span>
                </div>
                {contact.role && (
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-muted)]">
                    <User className="w-3 h-3" />
                    <span data-private>{contact.role}</span>
                  </div>
                )}
                <div
                  className="mt-0.5 w-1.5 h-1.5 rounded-full inline-block"
                  style={{ background: contact.clerkUserId ? 'var(--color-success)' : 'var(--color-border)' }}
                  title={contact.clerkUserId ? 'Has portal access' : 'No portal access yet'}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}
