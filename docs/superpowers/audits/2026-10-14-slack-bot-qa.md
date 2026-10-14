# Slack bot QA, batch E (2026-10-14)

## Scope and contract

Liam's first live test found that greetings and work questions entered the note-to-proposal pipeline. An Elevate invoice note also lost the client and Friday due date, and repeated its title in its description.

This batch keeps the verified Slack team/user mapping as the actor. A message naming another person never changes whose data is read. Members read their own permitted work and approval queue. Founders additionally read work waiting on the studio. The CN.2 contract permits client DMs for their own requests only; no studio tasks or suggestions may reach a client or stranger. Questions and greetings never draft suggestions and never need a paid classification call.

Decisions #063 and #064 remain in force: client hand-offs retain the Tahi owner, and proposed changes still pass through task_suggestions and the shared apply function. Tweak must make an ambiguous client explicit before approval. This batch requires no schema migration, email, commit, push or deployment. TASKS.md and STATUS.md are outside its edit scope.

## Slack Agents experience: verified findings

Research checked Slack's official documentation on 2026-10-14. The banner matches Slack's transition from the Assistant messaging experience to the Agent messaging experience. This diagnosis is an inference from the banner and this repository's assistant_view manifest, not an inspection of the installed app.

- Slack introduced agent_view on 2026-06-30. Conversations move into the app's ordinary Messages tab, with replies in threads, replacing the separate Chat and History tabs. Existing assistant_view apps continue for now. [June announcement](https://docs.slack.dev/changelog/2026/06/30/agent-messages-tab/)
- Slack's 2026-08-20 announcement gives February 2027 as the assistant_view deprecation date. The Agent Sessions API replaces legacy status and title methods; a compatibility bridge currently keeps those calls working. The update also adds session navigation and a native stop experience. [August announcement](https://docs.slack.dev/changelog/2026/08/20/agent-updates/)
- The manifest changes from features.assistant_view to features.agent_view, and assistant_description becomes agent_description. Switching is irreversible and users must hard refresh Slack afterwards. Existing distributed apps require Marketplace review. Deploy support for both event shapes before Liam changes the installed app. [Migration guide](https://docs.slack.dev/ai/migrating-to-agent-messaging/)
- app_home_opened with tab equal to messages indicates a user opened the app DM. It needs no additional scopes. Opening the Home tab must not enter the DM draft path. [Event reference](https://docs.slack.dev/reference/events/app_home_opened/)
- assistant_thread_started remains a legacy thread-opening event, not the DM-open signal for agent_view. User messages continue to arrive through message.im. Status calls on a user message can automatically open its thread, so reply placement needs a live check when migrating. [Developing an agent](https://docs.slack.dev/ai/developing-agents/)
- Keep assistant:write. It still supports agent features including suggested prompts. There is no scope rename to agent:write in the migration. [Scope reference](https://docs.slack.dev/reference/scopes/assistant.write/)
- Suggested prompts belong at the top of Messages for agent_view. Omit thread_ts entirely for those calls; including it can silently fail. Remove static suggested_prompts from the manifest when using dynamic, role-specific prompts, otherwise Slack returns static_prompts_configured. Legacy thread prompts still use thread_ts. [Prompt method reference](https://docs.slack.dev/reference/methods/assistant.threads.setSuggestedPrompts/)
- assistant_thread_context_changed tracks the legacy side pane's channel context. New context is available through app_context_changed and its ordered context.entities, which requires agent_view and assistant:write. Tahi currently ignores context, so enabling this event is unnecessary for this batch. Context must never replace verified dashboard identity or access checks. [Legacy context event](https://docs.slack.dev/reference/events/assistant_thread_context_changed/), [Agent context event](https://docs.slack.dev/reference/events/app_context_changed/)

## Recommended migration sequence

1. Prepare backward-compatible dispatch: retain assistant_thread_started support, accept app_home_opened only for tab messages, resolve identity normally, and set dynamic prompts without thread_ts on that path. Do not post a new greeting every time the tab opens. Explicit greetings and help remain available in the conversation. Keep current status calls through Slack's bridge for this batch.
2. After these changes have been reviewed, deployed and smoke tested in the existing experience, Liam applies the manifest patch below in the existing app. The switch affects all users and cannot be undone. Do not create a second Slack app.
3. Hard refresh Slack, then test founder, member, client and stranger DMs: opening Messages shows the appropriate prompts; question/help generates no suggestions; a typed note and voice note still show approval cards; approval, Tweak, snooze, reject and mirror updates work. Verify both a top-level message and an existing thread, including where status and replies appear.
4. Follow with explicit Agent Sessions lifecycle support. Replace non-empty assistant.threads.setStatus with agents.sessions.setStatus processing, and clearing status with active. Use agents.sessions.rename if titles are needed. Always leave processing in a finally path: posting a message does not clear it under the new API. chat:write is the required bot scope for the status method and is already granted. [Status method reference](https://docs.slack.dev/reference/methods/agents.sessions.setStatus/)
5. Implement actual cancellation before subscribing to agent_session_stopped. The handler must stop work for that channel/thread, release resources, confirm the stop and transition away from processing. Add the event subscription in that follow-up. Without the subscription, Slack shows a non-interactive loading indicator. Session titles and app context are optional until Tahi uses them. [Agent sessions](https://docs.slack.dev/ai/agent-sessions/)

## Exact manifest changes for Liam

Apply these changes in the browser after compatible code is deployed. The source manifest document is intentionally unchanged in this batch.

Delete features.assistant_view. Add the following sibling under features. Its required field is agent_description, limited to 300 characters. Deliberately omit suggested_prompts because dispatch supplies prompts for each verified role. [Manifest reference](https://docs.slack.dev/reference/app-manifest/)

```json
"agent_view": {
  "agent_description": "Tasks, requests and call notes. Tell me what happened and approve what I propose. Ask what is waiting on you."
}
```

Replace settings.event_subscriptions.bot_events with this array:

```json
[
  "message.im",
  "app_mention",
  "file_shared",
  "app_home_opened"
]
```

The removal of assistant_thread_started and assistant_thread_context_changed from the migrated manifest reflects the new DM-open path; their server handlers remain compatible with old deliveries. Retain all existing OAuth scopes, including assistant:write, chat:write and im:history. Retain app_home.messages_tab_enabled true and messages_tab_read_only_enabled false, the bot user, event URL, interactivity URL and existing credentials. No new OAuth scope is required for this first migration stage.

Do not add app_context_changed, agent_session_stopped or agent_session_title_changed in this first stage. For the later lifecycle follow-up, append agent_session_stopped only after its cancellation handler and lifecycle tests exist. Add the other events only alongside features that consume them. The recommendation to stage these optional events is specific to Tahi's current note-and-approval pipeline.

## Implementation and verification

The branch began clean at ef009dd2 on feat/slack-bot-qa. All changes are left uncommitted. No manifest, schema, migration, production data, email, TASKS.md or STATUS.md changes were made.

| Area | Implementation |
| --- | --- |
| Intent and help | lib/slack/intents.ts recognises the requested questions and greetings without a model call. Unrecognised questions return help. lib/slack/dispatch-dm.ts routes both typed and transcribed questions before note drafting. |
| Personal work reads | lib/slack/questions.ts reads the mapped sender's open tasks, actionable assigned requests and pending approvals. It rechecks current roles, features and organisation scope. Founders also receive open requests waiting on the studio and founder approval items. The combined result is ordered by due date, capped at eight, and links to the dashboard. It provides an inbox view rather than AI prioritisation. |
| Client status | Only the contact's submitted requests, requests currently handed to them, or their approved Slack request drafts qualify, with the portal's Requests and brand restrictions. No studio tasks, colleague requests or approval proposals are disclosed. Strangers receive the existing denial. |
| Client resolution | lib/slack/note-quality.ts matches whole legal names, trading-as suffixes, existing custom-field aliases/short names, brand names and contact names. lib/slack/notes.ts rechecks candidate access before context or cards. Multiple matches remain unresolved and require Tweak in Slack, client selection, then a separate Approve. |
| Safe selection | lib/slack/dispatch-actions.ts restricts a choice to the note's approver in their private DM, verifies the stored candidate still exists and is permitted, then conditionally updates only the unchanged pending suggestion. Global proposal org overrides remain forbidden. lib/task-suggestions.ts also blocks unresolved choices at the shared decision and apply gates. |
| Due dates | Relative dates use Pacific/Auckland calendar days. A bare weekday includes today and otherwise uses the next occurrence; next week starts on the next Monday; end of month uses the last calendar day. Conflicting relative dates remove a guessed model date. A single-item note uses the full note for deadline parsing while keeping the original quote. Multi-item notes use each item's quote. |
| Card copy | lib/slack/blocks.ts shows Due Fri 16 Oct for 2026-10-16. Proposal descriptions omit repeated title content and preserve extra detail. The source quote remains intact. Unresolved clients show Client? and do not offer Approve. |
| Agent compatibility | lib/slack/dispatch.ts keeps legacy assistant-thread welcome handling and supports Messages-only app_home_opened without repeated greeting posts. lib/slack/api.ts can omit thread_ts for channel prompts. Role-specific client prompts advertise requests only. Existing status calls remain unchanged and clear in the existing finally path. |

Regression coverage includes real SQLite execution for every question intent's member/client/stranger scope, current permission changes, brand restrictions, linked Slack-created requests, due ordering and the eight-item cap. Intent and DM tests prove greetings and typed/spoken questions never call note drafting. Card tests cover trading names, aliases, contacts, ambiguity, Auckland dates and DST boundaries, description de-duplication, due labels and approval preserving client/date. Client-choice action tests cover ownership, private DM, stale proposal and candidate access.

Independent source QA reviewed the query fences, client-choice update conditions, approval guards and both agent event paths. A second source UX review checked copy, linked lists and Slack's native controls. Live Slack rendering, 375/768 layouts and dark mode remain unverified because this batch explicitly does not deploy. After the main session deploys, rerun the supplied greeting, question and Elevate invoice examples as Liam, then a scoped member, a client and a stranger; exercise ambiguous client Tweak and approval in both a new message and an existing thread.

Final fail-closed gate passed with CI=true, native exit 0:

```text
npm run type-check
tsc --noEmit: zero errors

npm run lint
next lint: zero errors, existing warnings outside the changed files

npm run test -- --run --config .wrangler/vitest-sandbox.config.mjs --configLoader native
Test Files  13 passed (13)
Tests       551 passed (551)
Duration    4.37s
```

Those commands ran in one && chain. The test filters were lib/slack/__tests__/{api,dispatch,dispatch-dm,intents,questions,notes,note-quality,client-choice,client-dm-safety,recipient-permissions-sqlite}.test.ts and lib/__tests__/{slack-blocks,slack-dispatch-actions,task-suggestions}.test.ts. The final raw log is .wrangler/slack-bot-qa-final-gate-2.log. No route or page changed, so no build was required by this batch's gate. git diff --check passes, HEAD remains ef009dd2, and TASKS.md, STATUS.md, db/schema.ts and the source manifest document have no diff.

Standard Vitest could not start esbuild in the sandbox (spawn EPERM). The ignored native-loader config uses TypeScript transpilation, a single thread, symlink preservation to avoid Vite's Windows net-use process, and runtime environment values instead of Vite's esbuild define transform. It runs the actual Vitest assertions, including real SQLite fixtures.

The first combined run had 550 passed and one failed assertion: `expected 'New task: Send invoice' to contain 'Chosen Client'`. The added retry-card regression inspected the notification fallback, while the client name is shown in the card's header blocks. The test was corrected to inspect those blocks; no product code changed for that correction. The complete gate above then passed. The earlier raw log remains .wrangler/slack-bot-qa-final-gate.log.

Both source review findings are resolved: long legal names now render in full beside short numbered client-choice buttons, and My tasks links See all to the permitted Tasks page. The selected-client retry also rechecks the stored row's current client access before returning a name or card. Live Slack verification remains the main session's next step after deployment.
