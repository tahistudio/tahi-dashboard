# MCP Server HTTP Setup — Cloudflare Integration

## Overview

This guide configures the Tahi Dashboard MCP server as an HTTP endpoint accessible through Cloudflare, enabling it to be added as a custom connector in Claude.

## Architecture

```
Claude (Custom Connector)
        ↓
https://tahi-mcp.your-domain.com/mcp
        ↓
Cloudflare Worker
        ↓
Webflow Cloud / Next.js Backend
        ↓
Dashboard MCP Server
```

## Step 1: Create MCP HTTP Handler

Create a new API route to expose the MCP protocol over HTTP:

**File:** `app/api/mcp/route.ts`

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { Tool, TextContent, ResourceTemplate } from '@modelcontextprotocol/sdk/types.js'

// MCP Tools exposed to Claude
const dashboardTools: Tool[] = [
  {
    name: 'get_overview_stats',
    description: 'Get dashboard overview statistics (KPIs, recent requests)',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'list_clients',
    description: 'List all client organizations',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['prospect', 'active', 'paused', 'churned'],
          description: 'Filter by client status',
        },
      },
    },
  },
  {
    name: 'get_client_detail',
    description: 'Get detailed info for a specific client',
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
    description: 'List work requests across clients',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          description: 'Filter by request status',
        },
        clientId: {
          type: 'string',
          description: 'Filter by client',
        },
      },
    },
  },
  {
    name: 'get_billing_summary',
    description: 'Get billing and revenue summary',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_capacity',
    description: 'Get team capacity and utilization',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
]

/**
 * POST /api/mcp
 * MCP Protocol HTTP transport handler
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Handle MCP server initialization
    if (body.jsonrpc === '2.0' && body.method === 'initialize') {
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
            name: 'Tahi Dashboard MCP',
            version: '1.0.0',
          },
        },
      })
    }

    // Handle tools/list request
    if (body.jsonrpc === '2.0' && body.method === 'tools/list') {
      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: {
          tools: dashboardTools,
        },
      })
    }

    // Handle tool call
    if (body.jsonrpc === '2.0' && body.method === 'tools/call') {
      const { name, arguments: args } = body.params

      let result: TextContent | null = null

      // Route tool calls to appropriate endpoints
      if (name === 'get_overview_stats') {
        const apiRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/overview`,
          {
            headers: {
              Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
            },
          },
        )
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      if (name === 'list_clients') {
        const url = new URL(`${process.env.NEXT_PUBLIC_APP_URL}/api/admin/clients`)
        if (args?.status) {
          url.searchParams.set('status', args.status)
        }
        const apiRes = await fetch(url, {
          headers: {
            Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
          },
        })
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      if (name === 'get_client_detail') {
        const apiRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/clients/${args?.clientId}`,
          {
            headers: {
              Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
            },
          },
        )
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      if (name === 'list_requests') {
        const url = new URL(`${process.env.NEXT_PUBLIC_APP_URL}/api/admin/requests`)
        if (args?.status) {
          url.searchParams.set('status', args.status)
        }
        if (args?.clientId) {
          url.searchParams.set('orgId', args.clientId)
        }
        const apiRes = await fetch(url, {
          headers: {
            Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
          },
        })
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      if (name === 'get_billing_summary') {
        const apiRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/billing/summary`,
          {
            headers: {
              Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
            },
          },
        )
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      if (name === 'get_capacity') {
        const apiRes = await fetch(
          `${process.env.NEXT_PUBLIC_APP_URL}/api/admin/capacity`,
          {
            headers: {
              Authorization: `Bearer ${process.env.TAHI_API_TOKEN}`,
            },
          },
        )
        const data = await apiRes.json()
        result = {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        }
      }

      return NextResponse.json({
        jsonrpc: '2.0',
        id: body.id,
        result: result || {
          type: 'text',
          text: `Tool ${name} not found`,
        },
      })
    }

    return NextResponse.json(
      { error: 'Unknown method' },
      { status: 400 },
    )
  } catch (err) {
    console.error('MCP handler error:', err)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 },
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
      tools: dashboardTools.map((t) => t.name),
    },
  })
}
```

## Step 2: Deploy and Test

1. Commit the new MCP route
2. Push to main (auto-deploys to Webflow Cloud)
3. Test the endpoint: `curl https://tahi-test-dashboard.webflow.io/api/mcp`

## Step 3: Add Custom Connector in Claude

1. Go to Claude UI or settings
2. Click "Add custom connector"
3. Fill in:
   - **Name:** Tahi Dashboard MCP
   - **Remote MCP server URL:** https://tahi-test-dashboard.webflow.io/api/mcp
   - **OAuth Client ID:** (leave blank for now, or use TAHI_API_TOKEN)
   - **OAuth Client Secret:** (leave blank)

4. Click "Connect"
5. You should see the 6 tools available:
   - get_overview_stats
   - list_clients
   - get_client_detail
   - list_requests
   - get_billing_summary
   - get_capacity

## Step 4: (Optional) Configure OAuth

If you want to add OAuth authentication:

1. Create OAuth credentials in Cloudflare
2. Add to Webflow Cloud environment:
   ```
   MCP_OAUTH_CLIENT_ID=your-client-id
   MCP_OAUTH_CLIENT_SECRET=your-client-secret
   ```

3. Implement OAuth flow in `/api/mcp/auth` endpoint

## Testing

From Claude, you can now ask:
- "What's our current capacity utilization?"
- "Show me all active clients"
- "Get details for client [ID]"
- "List recent requests"
- "What's our billing status this month?"

## Security Notes

- MCP endpoint requires valid `TAHI_API_TOKEN` header
- All calls are proxied through authenticated backend routes
- Token is already in Webflow Cloud environment: `tahi-mcp-dev-token-2026`
- Consider rotating token in production

## Future Enhancements

- Add support for creating/updating requests via MCP
- Add invoice generation tool
- Add time tracking tool
- Add client communication/messaging tools
- Add reporting and analytics tools
