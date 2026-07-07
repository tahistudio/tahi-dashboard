# Shell Primitives - the repeatable conventions

These are the small, reusable pieces that make the new UI scale. Reach for them
instead of hand-rolling, so a feature added in month 9 behaves exactly like one
from month 2. Each is one import and a few props.

---

## 1. Money -> the sitewide currency toggle

Every monetary figure goes through `<Money>`. It reads the nav-bar display
currency (Decision #042) and converts live. Nothing freezes to one currency by
accident, and no page wires `useDisplayCurrency` by hand.

```tsx
import { Money } from '@/components/tahi/money'

<Money nzd={1500} />                              // base NZD, converted live
<Money native={1200} currency="GBP" />            // preserve the billed currency
<Money native={1200} currency="GBP" withDisplay />// billed GBP + approx display
<Money nzd={invoice.totalNzd} sensitive as="b" /> // also blurs on Private view
```

Rule: if it is money, it is `<Money>`. Never call `formatCurrency()` in a
component - that path ignores the toggle.

---

## 2. Private -> screen-share-safe blur

Private view (account menu) blurs every `[data-private]` node until hover. Tag
anything that identifies a client, a person, or a private figure.

```tsx
import { Private } from '@/components/tahi/private'

<Private>{contact.email}</Private>
<Private as="b">{client.name}</Private>
```

For money, prefer `<Money sensitive />` - it composes the same `data-private`
mechanism. Tag as you build; it is free until Private view is on.

---

## 3. Notifications -> one call, real-time + deep-linked

The SSE stream polls D1, so inserting a row is all that is needed for the bell to
light up. The taxonomy and the click-through route live in
`lib/notification-links.ts` (client-safe), shared by the bell and the server
helper so they never drift.

```ts
import { createNotification, notifyAllAdmins, notifyOrgContacts } from '@/lib/notifications'

// one person
await createNotification(database, {
  userId, userType: 'team_member',
  type: 'invoice_paid',
  title: 'Invoice paid', body: 'Acme paid INV-1042',
  entityType: 'invoice', entityId: invoice.id,   // -> click deep-links to /invoices/:id
})

// the whole team
await notifyAllAdmins(database, { type: 'request_created', title: '...', entityType: 'request', entityId })

// a client's contacts
await notifyOrgContacts(database, orgId, { type: 'request_status_changed', title: '...', entityType: 'request', entityId })
```

To make a NEW thing notifiable: add its `type` and `entityType` to
`lib/notification-links.ts` and one `case` to `notificationHref`. Done - it
renders and deep-links with no other wiring.

---

## 4. Timers - track against request / task / client

`<TimerChip>` already tracks against all three. The picker sends `{ requestId }`,
`{ taskId }`, or `{ orgId }`; the API accepts exactly one and the active-timer
response carries `targetType: 'request' | 'task' | 'org'`.
