import { NextRequest, NextResponse } from 'next/server'

interface MCPRequest {
  jsonrpc: string
  id?: string | number
  method: string
  params?: Record<string, unknown>
}

/**
 * POST /api/mcp
 * MCP (Model Context Protocol) HTTP transport handler
 * Exposes Tahi Dashboard tools to Claude via custom connector
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as MCPRequest

    // Validate MCP protocol
    if (!body.jsonrpc || body.jsonrpc !== '2.0') {
      return NextResponse.json(
        { error: 'Invalid MCP protocol version' },
        { status: 400 },
      )
    }

    // Handle initialization
    if (body.method === 'initialize') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {},
            resources: {},
          },
          serverInfo: {
            name: 'Tahi Dashboard MCP Server',
            version: '1.0.0',
          },
        },
      })
    }

    // Handle tools/list
    if (body.method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: [
            {
              name: 'get_overview_stats',
              description: 'Get dashboard overview statistics (KPIs, recent requests, revenue)',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
            {
              name: 'list_clients',
              description: 'List all client organizations with status and health',
              inputSchema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    enum: ['prospect', 'active', 'paused', 'churned', 'archived'],
                    description: 'Filter by client status',
                  },
                  planType: {
                    type: 'string',
                    description: 'Filter by plan type (maintain, scale, tune, launch, hourly)',
                  },
                },
              },
            },
            {
              name: 'get_client_detail',
              description: 'Get detailed information for a specific client including contacts and subscriptions',
              inputSchema: {
                type: 'object',
                properties: {
                  clientId: {
                    type: 'string',
                    description: 'Client organization ID',
                  },
                },
                required: ['clientId'],
              },
            },
            {
              name: 'list_requests',
              description: 'List work requests across clients with filtering',
              inputSchema: {
                type: 'object',
                properties: {
                  status: {
                    type: 'string',
                    description: 'Filter by request status (submitted, in_progress, delivered)',
                  },
                  clientId: {
                    type: 'string',
                    description: 'Filter by client ID',
                  },
                  limit: {
                    type: 'number',
                    description: 'Limit results (default 50, max 100)',
                  },
                },
              },
            },
            {
              name: 'get_billing_summary',
              description: 'Get financial summary including revenue, outstanding invoices, and trends',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
            {
              name: 'get_capacity',
              description: 'Get team capacity utilization, available hours, and forecasted capacity',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
            {
              name: 'get_reports',
              description: 'Get comprehensive reports: client count, billable hours, response times',
              inputSchema: {
                type: 'object',
                properties: {},
                required: [],
              },
            },
          ],
        },
      })
    }

    // Handle tool calls
    if (body.method === 'tools/call') {
      const toolCall = body.params as { name: string; arguments?: Record<string, unknown> }
      const { name, arguments: args } = toolCall

      const token = process.env.TAHI_API_TOKEN
      if (!token) {
        return NextResponse.json(
          { error: 'MCP API token not configured' },
          { status: 500 },
        )
      }

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

      try {
        let result: string

        switch (name) {
          case 'get_overview_stats': {
            const res = await fetch(`${baseUrl}/api/admin/overview`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'list_clients': {
            const url = new URL(`${baseUrl}/api/admin/clients`)
            if (args?.status) url.searchParams.set('status', String(args.status))
            if (args?.planType) url.searchParams.set('planType', String(args.planType))
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'get_client_detail': {
            if (!args?.clientId) {
              return NextResponse.json(
                { error: 'clientId parameter is required' },
                { status: 400 },
              )
            }
            const res = await fetch(`${baseUrl}/api/admin/clients/${args.clientId}`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'list_requests': {
            const url = new URL(`${baseUrl}/api/admin/requests`)
            if (args?.status) url.searchParams.set('status', String(args.status))
            if (args?.clientId) url.searchParams.set('orgId', String(args.clientId))
            if (args?.limit) url.searchParams.set('limit', String(args.limit))
            const res = await fetch(url, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'get_billing_summary': {
            const res = await fetch(`${baseUrl}/api/admin/billing/summary`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'get_capacity': {
            const res = await fetch(`${baseUrl}/api/admin/capacity`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          case 'get_reports': {
            const res = await fetch(`${baseUrl}/api/admin/reports`, {
              headers: { Authorization: `Bearer ${token}` },
            })
            if (!res.ok) throw new Error(`Status ${res.status}`)
            const data = await res.json()
            result = JSON.stringify(data, null, 2)
            break
          }

          default:
            return NextResponse.json(
              { error: `Unknown tool: ${name}` },
              { status: 400 },
            )
        }

        return NextResponse.json({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            type: 'text',
            text: result,
          },
        })
      } catch (err) {
        return NextResponse.json(
          {
            jsonrpc: '2.0',
            id: body.id,
            error: {
              code: -32603,
              message: err instanceof Error ? err.message : 'Tool execution failed',
            },
          },
          { status: 500 },
        )
      }
    }

    return NextResponse.json(
      { error: 'Unknown method' },
      { status: 400 },
    )
  } catch (err) {
    console.error('MCP handler error:', err)
    return NextResponse.json(
      { error: 'Invalid request' },
      { status: 400 },
    )
  }
}

/**
 * GET /api/mcp
 * MCP server info endpoint
 */
export async function GET() {
  return NextResponse.json({
    name: 'Tahi Dashboard MCP Server',
    version: '1.0.0',
    description: 'Access Tahi Dashboard data and operations through Claude',
    capabilities: {
      tools: [
        'get_overview_stats',
        'list_clients',
        'get_client_detail',
        'list_requests',
        'get_billing_summary',
        'get_capacity',
        'get_reports',
      ],
    },
    documentation: 'https://docs.tahi.studio/mcp',
  })
}
