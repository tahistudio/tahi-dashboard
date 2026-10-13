import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '@/db/d1'
import { recordingClientOrgExpression, recordingTranscriptReadyCondition } from './recording-transcript-client'
import { permissionSqlite } from '@/app/api/__tests__/helpers/permission-sqlite'

let fixture: ReturnType<typeof permissionSqlite>
beforeEach(() => {
  fixture = permissionSqlite([schema.callTranscripts, schema.meetingRecordings])
})
afterEach(() => fixture.close())

describe('recorded client suggestion eligibility', () => {
  function seed(state: string, orgId: string | null, source = 'manual', externalId = 'recording:rec-a') {
    fixture.insert(schema.callTranscripts, { id: 'ct-a', source, external_id: externalId, text: 'Words', hash: 'h' })
    fixture.insert(schema.meetingRecordings, { id: 'rec-a', transcript_id: 'ct-a', org_id: orgId, state })
  }
  async function selectedOrg() {
    return (await fixture.database.select({ orgId: recordingClientOrgExpression() }).from(schema.callTranscripts))[0].orgId
  }
  it('uses only an explicitly linked client on the ready recording', async () => {
    seed('ready', 'org-a')
    expect(await selectedOrg()).toBe('org-a')
  })
  it.each(['recording', 'uploading', 'transcribing', 'failed'])('excludes %s recordings', async state => {
    seed(state, 'org-a')
    expect(await selectedOrg()).toBeNull()
  })
  it('leaves recordings without a client in the unlinked flow', async () => {
    seed('ready', null)
    expect(await selectedOrg()).toBeNull()
  })
  it.each([
    ['gemini_drive', 'recording:rec-a'], ['manual', 'recording:rec-b'],
  ])('does not borrow a recording client from unrelated transcript identity', async (source, externalId) => {
    seed('ready', 'org-a', source, externalId)
    expect(await selectedOrg()).toBeNull()
  })
  it('retains the explicit client after deleting audio', async () => {
    seed('ready', 'org-a')
    await fixture.database.update(schema.meetingRecordings).set({ deletedAt: new Date().toISOString() })
    expect(await selectedOrg()).toBe('org-a')
  })
  it.each(['uploading', 'transcribing', 'failed'])('does not publish a call-linked %s recording before parent finalization', async state => {
    seed(state, 'org-a')
    await fixture.database.update(schema.callTranscripts).set({ callKind: 'scheduled', callId: 'call-a' })
    const rows = await fixture.database.select().from(schema.callTranscripts).where(recordingTranscriptReadyCondition())
    expect(rows).toEqual([])
  })
  it('keeps an ordinary manual transcript eligible without recorder metadata', async () => {
    fixture.insert(schema.callTranscripts, { id: 'ct-other', source: 'manual', external_id: 'pasted-notes' })
    const rows = await fixture.database.select().from(schema.callTranscripts).where(recordingTranscriptReadyCondition())
    expect(rows).toHaveLength(1)
  })
})
