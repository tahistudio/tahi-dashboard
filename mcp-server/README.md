# Tahi Dashboard MCP Server

An MCP (Model Context Protocol) server that connects AI assistants to the Tahi Dashboard API, enabling natural language interaction with clients, requests, invoices, time tracking, and more.

## Setup

1. Install dependencies:

```bash
cd mcp-server
npm install
```

2. Set environment variables:

```bash
export TAHI_API_URL=http://localhost:3000
export TAHI_API_TOKEN=your-api-token-here
```

3. Start the server:

```bash
npm start
```

## Claude Code Configuration

Add this to your `.claude/settings.local.json`:

```json
{
  "mcpServers": {
    "tahi-dashboard": {
      "command": "npx",
      "args": ["tsx", "mcp-server/index.ts"],
      "env": {
        "TAHI_API_URL": "http://localhost:3000",
        "TAHI_API_TOKEN": "your-api-token-here"
      }
    }
  }
}
```

## Available Resources

| Resource URI | Description |
|---|---|
| `dashboard://overview` | Dashboard KPIs, recent requests, summary stats |
| `dashboard://clients` | List of all client organisations |
| `dashboard://clients/{id}` | Detail for a specific client |
| `dashboard://requests` | List of all requests (work items) |
| `dashboard://requests/{id}` | Detail for a specific request |
| `dashboard://invoices` | List of all invoices |
| `dashboard://time-entries` | Time entries logged by team members |
| `dashboard://reports` | Reports overview with billing summary |
| `dashboard://docs` | Knowledge hub documentation pages |
| `dashboard://docs/{id}` | Detail for a specific doc page |

## Available Tools

| Tool | Description |
|---|---|
| `create_request` | Create a new request for a client |
| `update_request_status` | Change the status of a request |
| `assign_request` | Assign a team member to a request |
| `create_client` | Create a new client organisation |
| `create_invoice` | Create a new invoice |
| `log_time` | Log a time entry |
| `send_message` | Send a message in a conversation |
| `create_announcement` | Create an announcement banner |

## Example Prompts

- "Show me the dashboard overview"
- "List all active clients"
- "Create a new request titled 'Redesign landing page' for client org_abc123"
- "Update request req_xyz to in_progress"
- "Assign request req_xyz to team member tm_456"
- "Create a new client called 'Acme Corp' on the scale plan"
- "Log 2.5 hours for team member tm_456 on request req_xyz"
- "How many hours were logged this week?"
- "Show me all overdue invoices"
- "Send a message to conversation conv_123 saying 'The designs are ready for review'"

## Authentication

The MCP server authenticates to the dashboard API using a bearer token passed via the `TAHI_API_TOKEN` environment variable. This token must have admin-level access. The dashboard API validates this token on every request.

## Architecture

```
Claude Code / AI Assistant
    |
    | (MCP Protocol over stdio)
    |
  MCP Server (this package)
    |
    | (HTTP + Bearer token)
    |
  Tahi Dashboard API (Next.js)
    |
    | (Drizzle ORM)
    |
  Cloudflare D1 Database
```
