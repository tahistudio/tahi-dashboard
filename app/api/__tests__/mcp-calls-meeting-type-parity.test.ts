/**
 * MCP parity for the 'mentoring' / 'other' meetingType vocabulary
 * additions (Decision: MCP tool descriptions must never drift from
 * MEETING_TYPES in lib/calls.ts, see CLAUDE.md rule 14).
 *
 * update_lead_call and list_all_calls both forward straight to the
 * dashboard API with no local validation in the worker (see the
 * 'update_lead_call' / 'list_all_calls' cases in workers/mcp-server/src/
 * index.ts's tool-call switch), so there is no pure mapping function to
 * test here - a description check is the parity contract.
 */
import { describe, expect, it } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'
import { MEETING_TYPES } from '@/lib/calls'

function tool(name: string) {
  const t = TOOLS.find(t => t.name === name)
  if (!t) throw new Error(`${name} not found in TOOLS`)
  return t
}

describe('MCP call tool descriptions name every current meetingType value', () => {
  it('update_lead_call\'s meetingType property lists all six values', () => {
    const meetingTypeProp = tool('update_lead_call').inputSchema.properties?.meetingType as { description: string } | undefined
    expect(meetingTypeProp).toBeDefined()
    for (const value of MEETING_TYPES) {
      expect(meetingTypeProp!.description).toContain(value)
    }
  })

  it('list_all_calls\'s type filter lists all six values', () => {
    const typeProp = tool('list_all_calls').inputSchema.properties?.type as { description: string } | undefined
    expect(typeProp).toBeDefined()
    for (const value of MEETING_TYPES) {
      expect(typeProp!.description).toContain(value)
    }
  })
})
