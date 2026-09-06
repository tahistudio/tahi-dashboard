/**
 * MCP parity for the services catalogue (CLAUDE.md rule 14).
 *
 * The catalogue gained an audience (migration 0097): a row is global or
 * private to one client, and separately public or hidden. A tool that could
 * create a service without saying which of those it is would mint global rows
 * by omission, which is the exact failure CT.11 exists to close, so the schema
 * is asserted here rather than trusted.
 *
 * The relative import is deliberate: the `@/` alias resolves from the repo
 * root and the worker sits outside the Next app, and vitest.config.ts excludes
 * `workers/**` from collection while still resolving an import into it.
 */
import { describe, it, expect } from 'vitest'
import { TOOLS } from '../../../workers/mcp-server/src/index'

function toolNamed(name: string) {
  const found = TOOLS.find((t) => t.name === name)
  if (!found) throw new Error(`${name} is not registered`)
  return found
}

describe('services catalogue tools', () => {
  it('exposes the list, create and update the dashboard has', () => {
    expect(toolNamed('list_services').inputSchema.properties).toHaveProperty('orgId')
    expect(toolNamed('create_service')).toBeTruthy()
    expect(toolNamed('update_service')).toBeTruthy()
  })

  it.each(['create_service', 'update_service'])(
    '%s takes both halves of the audience decision',
    (name) => {
      const props = toolNamed(name).inputSchema.properties
      expect(props).toHaveProperty('orgId')
      expect(props).toHaveProperty('visibility')
    },
  )

  it.each(['create_service', 'update_service'])(
    '%s constrains visibility to the vocabulary the route accepts',
    (name) => {
      const visibility = toolNamed(name).inputSchema.properties.visibility as { enum?: string[] }
      // The route 400s anything else rather than guessing, so an unconstrained
      // free-text field here would only ever produce failed calls.
      expect(visibility.enum).toEqual(['public', 'hidden'])
    },
  )

  it('requires the id on update and the name on create, and nothing more', () => {
    expect(toolNamed('create_service').inputSchema.required).toEqual(['name'])
    expect(toolNamed('update_service').inputSchema.required).toEqual(['serviceId'])
    // orgId stays optional on create: omitting it means a global row, which is
    // the right default for the studio's own catalogue.
    expect(toolNamed('create_service').inputSchema.required).not.toContain('orgId')
  })
})
