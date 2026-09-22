# Tahi Slack app: manifest and setup (2026-09-22)

Create the app at api.slack.com/apps, "From a manifest", paste the JSON below into the Tahi workspace. If the existing Tahi bot app is the one holding SLACK_BOT_TOKEN, update that app's manifest instead of creating a second one, so the token keeps working.

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
    "bot_user": {
      "display_name": "Tahi",
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
        "channels:read"
      ]
    }
  },
  "settings": {
    "event_subscriptions": {
      "request_url": "https://portal.tahi.studio/api/webhooks/slack/events",
      "bot_events": ["message.im", "app_mention", "file_shared"]
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

1. Install the app to the workspace (Install App). Copy the Bot User OAuth Token (starts with xoxb) if it changed.
2. Basic Information, App Credentials: copy the Signing Secret.
3. Set both on the dashboard worker from the repo root: `npx wrangler secret put SLACK_BOT_TOKEN` and `npx wrangler secret put SLACK_SIGNING_SECRET` (or paste them into the Cloudflare dashboard under the worker's variables and secrets). The events URL only verifies after the deploy that carries the routes.
4. Clients: invite each client contact to the Tahi workspace as a Slack Connect guest (or a single-channel guest); the bot maps them by email to their contact and org. Anyone whose email is not on the roster or a client contact gets one polite line and nothing else.
