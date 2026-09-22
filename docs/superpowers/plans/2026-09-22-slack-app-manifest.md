# Tahi Slack app: manifest and setup (2026-09-22)

The workspace already has the app "Tahi Dashboard" with assistant:write (Agents and Apps mode), chat:write, chat:write.public, app_mentions:read, channels:history, groups:read, groups:write and bookmarks:read. Update THAT app (App Manifest page) rather than creating a second one, so the token and its channel wiring survive. The JSON below is the target state: keep the scopes it already has and add the ones listed here.

```json
{
  "display_information": {
    "name": "Tahi",
    "description": "The studio's assistant. Tasks, requests and call notes, with a human pressing every button.",
    "background_color": "#1e2a1b"
  },
  "features": {
    "app_home": {
      "messages_tab_enabled": true,
      "messages_tab_read_only_enabled": false
    },
    "assistant_view": {
      "assistant_description": "Tasks, requests and call notes. Tell me what happened and approve what I propose.",
      "suggested_prompts": [
        { "title": "Log a task", "message": "Task for me: " },
        { "title": "New request for a client", "message": "Request for " },
        { "title": "What is waiting on me", "message": "What is waiting on me?" }
      ]
    },
    "bot_user": {
      "display_name": "Tahi Dashboard",
      "always_online": true
    }
  },
  "oauth_config": {
    "scopes": {
      "bot": [
        "chat:write",
        "im:history",
        "im:read",
        "im:write",
        "users:read",
        "users:read.email",
        "files:read",
        "app_mentions:read",
        "channels:history",
        "channels:read",
        "chat:write.public",
        "groups:read",
        "groups:write",
        "bookmarks:read",
        "assistant:write"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://portal.tahi.studio/api/webhooks/slack/events",
      "bot_events": ["message.im", "app_mention", "file_shared", "assistant_thread_started", "assistant_thread_context_changed"]
    },
    "interactivity": {
      "is_enabled": true,
      "request_url": "https://portal.tahi.studio/api/webhooks/slack/interactive"
    },
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

Then:

1. Reinstall the app to the workspace (adding scopes re-issues the token). Copy the new Bot User OAuth Token (xoxb).
2. Basic Information, App Credentials: copy the Signing Secret.
3. Set both on the dashboard worker from the repo root: `npx wrangler secret put SLACK_BOT_TOKEN` and `npx wrangler secret put SLACK_SIGNING_SECRET` (or paste them into the Cloudflare dashboard under the worker's variables and secrets). The events URL only verifies after the deploy that carries the routes.
4. Clients: invite each client contact to the Tahi workspace as a Slack Connect guest (or a single-channel guest); the bot maps them by email to their contact and org. Anyone whose email is not on the roster or a client contact gets one polite line and nothing else.
