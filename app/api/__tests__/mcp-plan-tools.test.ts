/**
 * MCP parity for plan and subscription management (CLAUDE.md rule 14).
 *
 * The dashboard can now clear a client's plan and remove a subscription that
 * was never billed, so the worker must be able to do both: update_client has
 * to accept planType null (a strict client refuses to send null against a
 * plain 'string' schema), and delete_subscription has to exist and name the
 * route's two refusals so a caller knows why a delete came back as an error.
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

describe('update_client planType', () => {
  it('accepts null so the plan can be cleared', () => {
    const planType = toolNamed('update_client').inputSchema.properties.planType as { type: unknown; enum?: unknown[] }
    expect(planType.type).toEqual(['string', 'null'])
    expect(planType.enum).toContain(null)
    expect(planType.enum).toContain('none')
  })

  it('constrains the plan to the vocabulary the route accepts', () => {
    const planType = toolNamed('update_client').inputSchema.properties.planType as { enum?: unknown[] }
    for (const slug of ['maintain', 'scale', 'tune', 'launch', 'hourly', 'custom']) {
      expect(planType.enum).toContain(slug)
    }
  })
})

describe('create_client planType', () => {
  it('is optional and lists none as a value', () => {
    const tool = toolNamed('create_client')
    expect(tool.inputSchema.required).toEqual(['name'])
    const planType = tool.inputSchema.properties.planType as { enum?: unknown[] }
    expect(planType.enum).toContain('none')
    expect(planType.enum).toContain('scale')
  })
})

describe('delete_subscription', () => {
  it('is registered and requires only the subscription id', () => {
    const tool = toolNamed('delete_subscription')
    expect(tool.inputSchema.required).toEqual(['subscriptionId'])
    expect(Object.keys(tool.inputSchema.properties)).toEqual(['subscriptionId'])
  })

  it('names both refusals and says it is not cancellation', () => {
    const description = toolNamed('delete_subscription').description
    expect(description).toContain('invoice')
    expect(description).toContain('request')
    expect(description).toContain('track')
    expect(description).toContain('not cancellation')
  })
})
