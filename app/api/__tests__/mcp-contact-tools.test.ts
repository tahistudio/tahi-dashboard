/**
 * MCP parity for client contact management (CLAUDE.md rule 14).
 *
 * The People tab can now edit, delete and merge contacts. Each of those is a
 * dashboard capability, so each needs a worker tool with the same shape the
 * route accepts: the same required ids, the same portal role vocabulary, and
 * the reassign / merge targets the route can act on. Asserted here rather
 * than trusted, like the services catalogue tools.
 *
 * The relative import is deliberate: `workers/**` is excluded from vitest
 * collection but still resolves as an import.
 */
import { describe, it, expect } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'

function toolNamed(name: string) {
  const found = TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} is not registered`)
  return found
}

describe('client contact management tools', () => {
  it('registers edit, references, delete and merge beside create', () => {
    expect(toolNamed('create_client_contact')).toBeTruthy()
    expect(toolNamed('update_client_contact')).toBeTruthy()
    expect(toolNamed('list_contact_references')).toBeTruthy()
    expect(toolNamed('delete_client_contact')).toBeTruthy()
    expect(toolNamed('merge_client_contacts')).toBeTruthy()
  })

  it('update takes every field the edit form has and only requires the id', () => {
    const t = toolNamed('update_client_contact')
    for (const key of ['name', 'email', 'phone', 'role', 'isPrimary', 'portalRole']) {
      expect(t.inputSchema.properties).toHaveProperty(key)
    }
    expect(t.inputSchema.required).toEqual(['contactId'])
  })

  it('update constrains portalRole to the vocabulary the route accepts', () => {
    const portalRole = toolNamed('update_client_contact').inputSchema.properties.portalRole as { enum?: string[] }
    expect(portalRole.enum).toEqual(['admin', 'member'])
  })

  it('delete requires the id and offers reassignTo, the one thing that unblocks a refusal', () => {
    const t = toolNamed('delete_client_contact')
    expect(t.inputSchema.required).toEqual(['contactId'])
    expect(t.inputSchema.properties).toHaveProperty('reassignTo')
  })

  it('merge requires both the duplicate and the survivor', () => {
    const t = toolNamed('merge_client_contacts')
    expect(t.inputSchema.required).toEqual(['contactId', 'into'])
  })

  it('references only needs the contact', () => {
    expect(toolNamed('list_contact_references').inputSchema.required).toEqual(['contactId'])
  })
})
