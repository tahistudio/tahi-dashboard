/**
 * lib/acting-as.ts is the ONLY thing that can let a portal write through Client
 * view, so its default has to be refusal and its opt-in has to be explicit.
 *
 * The two failures this file is watching for:
 *   1. A route that forgets `allowActing` starts writing anyway, which would
 *      quietly open checkout, invites and the Clerk-mailing people routes.
 *   2. A partially built auth object (a stale test factory, a half-migrated
 *      caller, a forged cookie that got as far as the handler) reads as a
 *      grant because only one of the two flags was checked.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  ACTING_AUDIT_PREFIX,
  READ_ONLY_MESSAGE,
  actingByline,
  actingIdentity,
  authorFor,
  recordActingWrite,
  refusePreviewWrite,
} from '@/lib/acting-as'
import type { ActingAsIdentity } from '@/lib/server-auth'
import type { DB } from '@/db/d1'

const ACTING: ActingAsIdentity = {
  adminUserId: 'user_liam',
  adminTeamMemberId: 'tm_liam',
  adminName: 'Liam Miller',
  orgId: 'org_acme',
  contactId: 'contact_primary',
}

function auth(overrides: Record<string, unknown> = {}) {
  return {
    impersonating: false,
    canWriteAsClient: undefined,
    actingAs: undefined,
    ...overrides,
  } as Parameters<typeof refusePreviewWrite>[0]
}

describe('refusePreviewWrite', () => {
  it('lets an ordinary client session straight through', () => {
    expect(refusePreviewWrite(auth())).toBeNull()
    expect(refusePreviewWrite(auth(), { allowActing: true })).toBeNull()
  })

  it('refuses a read-only preview, opted in or not', async () => {
    for (const options of [undefined, { allowActing: false }, { allowActing: true }]) {
      const res = refusePreviewWrite(auth({ impersonating: true }), options)
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
      expect(await res!.json()).toEqual({ error: READ_ONLY_MESSAGE })
    }
  })

  it('keeps refusing a proven acting session on a route that did not opt in', async () => {
    // The whole safety property. `impersonating` stays true in act mode
    // precisely so that ~21 unopened routes go on refusing until each is
    // reviewed. A route that has not asked must not benefit from the mode.
    const res = refusePreviewWrite(
      auth({ impersonating: true, canWriteAsClient: true, actingAs: ACTING }),
    )
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('lets a proven acting session through an opted-in route', () => {
    expect(
      refusePreviewWrite(
        auth({ impersonating: true, canWriteAsClient: true, actingAs: ACTING }),
        { allowActing: true },
      ),
    ).toBeNull()
  })

  it('refuses when only one half of the grant is present', async () => {
    // A flag without an identity would attribute a row to nobody; an identity
    // without the flag never went through getPortalAuth's super-admin check.
    for (const half of [
      { canWriteAsClient: true, actingAs: null },
      { canWriteAsClient: true },
      { canWriteAsClient: false, actingAs: ACTING },
      { actingAs: ACTING },
    ]) {
      const res = refusePreviewWrite(auth({ impersonating: true, ...half }), {
        allowActing: true,
      })
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
    }
  })

  it('speaks the exact string the portal already answers with', () => {
    // Roughly fifteen route suites and the portal UI assert this wording. It
    // is a contract, not a message.
    expect(READ_ONLY_MESSAGE).toBe('Read-only in client view')
  })
})

describe('actingIdentity', () => {
  it('is null for a client and for a read-only preview', () => {
    expect(actingIdentity({ canWriteAsClient: undefined, actingAs: undefined })).toBeNull()
    expect(actingIdentity({ canWriteAsClient: false, actingAs: ACTING })).toBeNull()
    expect(actingIdentity({ canWriteAsClient: true, actingAs: null })).toBeNull()
  })

  it('is the studio identity when both halves are present', () => {
    expect(actingIdentity({ canWriteAsClient: true, actingAs: ACTING })).toBe(ACTING)
  })
})

describe('authorFor', () => {
  it('keeps a client writing as themselves', () => {
    expect(authorFor(null, 'contact_bob')).toEqual({ id: 'contact_bob', type: 'contact' })
  })

  it('writes the studio member, never the client contact', () => {
    // The contact id is carried on the identity for the audit metadata. If it
    // ever reached an author column, a row would claim a named client person
    // said something they did not say.
    const result = authorFor(ACTING, 'contact_bob')
    expect(result).toEqual({ id: 'tm_liam', type: 'team_member' })
    expect(result.id).not.toBe(ACTING.contactId)
  })
})

describe('actingByline', () => {
  it('is empty for a client, so callers can concatenate blind', () => {
    expect(actingByline(null)).toBe('')
    expect(`From Acme${actingByline(null)}`).toBe('From Acme')
  })

  it('names the human and the studio', () => {
    expect(actingByline(ACTING, 'filed')).toBe(' (filed by Liam Miller at Tahi Studio)')
    expect(actingByline(ACTING, 'sent')).toBe(' (sent by Liam Miller at Tahi Studio)')
  })
})

describe('recordActingWrite', () => {
  function fakeDb() {
    const rows: Record<string, unknown>[] = []
    const database = {
      insert: () => ({
        values: (row: Record<string, unknown>) => {
          rows.push(row)
          return Promise.resolve(undefined)
        },
      }),
    } as unknown as DB
    return { database, rows }
  }

  it('writes nothing at all on the ordinary client path', async () => {
    const { database, rows } = fakeDb()
    await recordActingWrite(database, null, {
      verb: 'request.created',
      entityType: 'request',
      entityId: 'r1',
      route: 'POST /api/portal/requests',
    })
    expect(rows).toEqual([])
  })

  it('prefixes the ACTION, not the entity type', async () => {
    // Both questions have to stay answerable off the existing indexes:
    // idx_audit_entity answers "everything that happened to this request", and
    // the action prefix answers "everything the studio did in a client's seat".
    const { database, rows } = fakeDb()
    await recordActingWrite(database, ACTING, {
      verb: 'request.created',
      entityType: 'request',
      entityId: 'r1',
      route: 'POST /api/portal/requests',
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe(`${ACTING_AUDIT_PREFIX}request.created`)
    expect(rows[0].entityType).toBe('request')
    expect(rows[0].entityId).toBe('r1')
  })

  it('records the actor as a CLERK user id, which is what the audit viewer resolves', async () => {
    // GET /api/admin/audit?resolveNames=1 joins team_members.clerk_user_id to
    // put a name on a row. A team_members id here would render as unnamed, so
    // that id rides in the metadata instead.
    const { database, rows } = fakeDb()
    await recordActingWrite(database, ACTING, {
      verb: 'message.posted',
      entityType: 'request',
      entityId: 'r1',
      route: 'POST /api/portal/requests/[id]/messages',
    })
    expect(rows[0].actorId).toBe('user_liam')
    expect(rows[0].actorType).toBe('team_member')
    const meta = JSON.parse(rows[0].metadata as string) as Record<string, unknown>
    expect(meta.adminTeamMemberId).toBe('tm_liam')
    expect(meta.orgId).toBe('org_acme')
    expect(meta.contactId).toBe('contact_primary')
    expect(meta.mode).toBe('act')
    expect(meta.route).toBe('POST /api/portal/requests/[id]/messages')
  })

  it('merges the route extras without letting them overwrite who did it', async () => {
    const { database, rows } = fakeDb()
    await recordActingWrite(database, ACTING, {
      verb: 'review.submitted',
      entityType: 'request',
      entityId: 'r1',
      route: 'POST /api/portal/requests/[id]/review',
      extra: { decision: 'approve', nextStatus: 'delivered' },
    })
    const meta = JSON.parse(rows[0].metadata as string) as Record<string, unknown>
    expect(meta.decision).toBe('approve')
    expect(meta.nextStatus).toBe('delivered')
    expect(meta.adminName).toBe('Liam Miller')
  })

  it('THROWS when the insert fails, unlike every other audit call site', async () => {
    // logAudit swallows, because almost every audit row is a nice-to-have
    // beside a write that already happened. Here the row IS the safety story:
    // an acting write that lands unrecorded is the failure the mode exists to
    // prevent, so the route must be able to fail the request.
    const database = {
      insert: () => ({
        values: () => Promise.reject(new Error('D1 unavailable')),
      }),
    } as unknown as DB
    await expect(
      recordActingWrite(database, ACTING, {
        verb: 'request.created',
        entityType: 'request',
        entityId: 'r1',
        route: 'POST /api/portal/requests',
      }),
    ).rejects.toThrow('D1 unavailable')
  })

  it('does not throw for a client, even against a broken database', async () => {
    const database = {
      insert: vi.fn(() => {
        throw new Error('should never be reached')
      }),
    } as unknown as DB
    await expect(
      recordActingWrite(database, null, {
        verb: 'request.created',
        entityType: 'request',
        entityId: 'r1',
        route: 'POST /api/portal/requests',
      }),
    ).resolves.toBeUndefined()
  })
})
