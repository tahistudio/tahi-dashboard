'use client'

/**
 * People (client portal). A read-only roster of the client's teammates.
 *
 * Managing people (invite / edit / remove) is NOT wired yet - it needs a portal
 * contacts endpoint plus Clerk org invitations - so this shows an honest empty
 * state and a "coming soon" note rather than a phantom pending invite that would
 * vanish on refresh. Only a client admin (isClientAdmin) sees the manage note;
 * members see a plain read-only view. The sub-nav also hides this from members
 * (settings-shell clientAdminOnly); this is the second layer.
 */

import { SectionShell, EmptyRow } from '@/components/tahi/settings/primitives'

export function PeopleSection({ isClientAdmin }: { isClientAdmin?: boolean }) {
  const canManage = !!isClientAdmin
  return (
    <SectionShell title="People" lede="Your workspace teammates and what each can do.">
      <div className="set-card lrow-wrap">
        <EmptyRow text="No teammates to show yet." />
      </div>
      <p className="set-lede" style={{ marginTop: 12 }}>
        {canManage
          ? 'Inviting and managing teammates from here is coming soon. For now, ask your Tahi contact to add someone.'
          : 'Only workspace admins can invite or manage teammates.'}
      </p>
    </SectionShell>
  )
}
