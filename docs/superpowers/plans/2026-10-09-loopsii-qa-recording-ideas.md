# Loopsii teardown, website QA and call recordings: ideas to pinch

Liam, 2026-10-09: "one day i want a QA tester (so that clients can add comments
to websites we're working on, maybe even suggest copy tweaks etc). and also
recordings for calls, mainly just the transcript (beyond google gemini, it
should work on meets, teams, zooms, etc). and make recordings directly. research
what they have in features that we dont. and then we can pinch a few."

This is an ideas log, not a scope. Nothing here is scheduled. The ids live in
TASKS.md under "(f) North star and the long pool", "Ideas pool, 2026-10-09":
WQA.0 (section 2), REC.0 (section 3) and LP.1 to LP.12 (section 4).

Research by a Sonnet researcher (vendor pages read 2026-10-09, sources at the
bottom); dashboard inventory by a Sonnet explorer against the tree at e69b21f0.
The Loopsii app sits behind a signup, so anything about its in-app UX comes
from its homepage, llms.txt, privacy policy, terms and connect pages, plus the
launch email. Its docs, changelog and pricing URLs all return 404.

---

## 1. Loopsii against the dashboard

Loopsii (Stanislav Bondar, Warsaw, solo; beta live 2026-10-08; $12 a month or
$120 a year) is a freelancer all-in-one: a web app plus a menu-bar Mac app
(macOS 14.4+, Apple silicon; screen recording needs macOS 15+). Only "Loop 01"
is live. Proposals, e-sign, invoices from time, pipeline, client portal,
capacity, change requests and Gantt are all "up next".

| Loopsii feature | Dashboard today |
|---|---|
| Clients and projects by stage (Negotiation, Planning, Working, Closure), list or board, tasks with comments and attachments | Built, deeper (leads, deals, pipeline stages, requests, three-level tasks, task threads) |
| Time: timer, manual entries, PDF and CSV reports | Built: timer, manual entries, CSV export, worklog and utilisation reports |
| Time: calendar view and weekly timesheet grid | **Absent** (list only) |
| Time: PDF report export | **Absent** |
| Time: Toggl import | Absent, not needed (ManyRequests importer covers our history) |
| Effective hourly rate and project profitability | Partial (billing summary at the studio rate; margin columns are post-launch T668 to T676) |
| Record any call with no bot (Zoom, Meet, Teams, Slack huddles); on-device transcription | **Absent.** We only read Gemini transcripts from Google Drive, so only Meet calls Gemini took notes on |
| Notes, chapters and suggested tasks after a call | Built and stronger: CN.1 suggestions inbox with a verbatim-quote rule and an approval gate; no chapters |
| Suggests which project a call belongs to | Partial: the Drive sync matches by time and attendee; unmatched notes park as unlinked with no suggestion |
| Pre-meeting brief (past calls plus open tasks) | Partial: cron_pre_call_digest covers discovery calls (lead context) only, not client calls |
| Loom-style screen recordings with share link, transcript, summary, timecoded comments | **Absent** (no getDisplayMedia anywhere) |
| Share notes or recordings by link, public or invite-only, timecoded comments, no account to watch | Partial: token share links exist for proposals, contracts and schedules only, with view analytics (app/review/[token] is the testimonial form, not a share) |
| "Ask Loopsii" (Cmd+J): answers about any call or project, quoting the transcript with a play-at-timestamp link | **Absent.** Cmd+K is a search palette, not an assistant |
| MCP for Claude, ChatGPT, Codex, Cursor; OAuth consent, one-hour tokens, no delete permission, revoke screen | Built and far larger (about 340 tools), but admin only; per-client scoped MCP is an open idea (Giant Group, 2026-09-13) |
| Kickoff checklist of what the client still owes (brand files, copy, CMS access), each "uploaded" or "waiting" | Partial: portal onboarding steps exist; no per-project "client owes us" asset list |
| "Needs input" tag on feedback items | Partial: hand-offs with a waiting-on type cover the idea |
| Up next: change requests caught on a call, labelled included or billable, cost and days added, with a play link to the moment | Partial: a manual scope-creep flag on a request; nothing from calls, no cost or days |
| Up next: income goal bar (paid, invoiced, unbilled, in conversation, gap) | Partial: cash position, take-home and pipeline cards exist separately |
| Up next: capacity in plain words ("Free about 60 hrs a month, can start Sep 8") | Built underneath (capacity forecast and start-date route); check the wording on the card |
| Read-only on lapse (data kept, sync and integrations paused) | Not applicable to us yet; worth remembering for portal access when a retainer ends |

Worth knowing before ever using Loopsii itself: its privacy policy names
Anthropic, OpenAI and Z.ai (Zhipu, China) as transcript processors. That matters
for client confidentiality.

---

## 2. Website QA tester (clients comment on sites we are building)

### What the market does

| Tool | How it attaches | Copy suggestions | Guests without accounts | Price a month |
|---|---|---|---|---|
| Marker.io | Snippet, WordPress plugin, extension | No | Yes | $39 to $149 |
| BugHerd | Snippet (recommended), extensions | No | Unlimited reviewers, but they log in | $50 to $150 |
| Pastel | Paste a URL, Pastel's servers load it (proxy, inferred); extension fallback | **Yes**: select text, suggest an edit, saved as a comment with Before and After and a "Copy edited text" button | Name plus email | Free to $119 |
| Ruttl | Proxy links, plugins | **Yes**: edit copy, fonts, images in place | Unlimited, free plan too | $18 a user |
| Feedbucket | One script tag | No | Yes, and reporters see existing pins | $49 to $89 |
| Markup.io | Link or extension | No | Yes | $79 and up |
| Userback | Script, npm, GTM | No | Not confirmed | $29 to $159 |
| Webflow native | Built in. Since 2026-02-03 a guest can share a comment-only link; reviewers give name and email, preview and comment only | No | Yes | Included |

What they capture per pin: screenshot, URL, browser, OS, viewport, sometimes a
DOM selector (BugHerd), console logs, network requests and session replay
(Marker.io, Userback, Feedbucket on higher plans).

### Our head start

The dashboard already has this machinery for itself: the beta feedback ball
(`components/tahi/feedback-ball.tsx`, `lib/feedback-anchor.ts`,
`lib/feedback-screenshot.ts`, table `feedback_comments` with route, viewport,
theme, element anchor and screenshot key). The QA tester is that same idea
pointed at a client's site, plus guest identity and a route into requests.

### Recommended shape

1. **An embed script served by the Worker**, added to the client site's head
   code (or loaded only when the URL carries a review token). Shadow DOM so the
   site's CSS cannot break it. Each pin stores URL, CSS selector plus text
   fingerprint plus XPath fallback, click offset as a percentage of the element,
   scroll, viewport, device pixel ratio, user agent, and optionally recent
   console errors.
2. **Guests by signed review link**: name and email asked on the first comment,
   kept in localStorage. Same tenancy rules as the portal.
3. **Screenshots** drawn in the page and sent to R2 by presigned URL.
4. **Copy suggestions** the Pastel way: select text, edit in place, store before
   and after, show a "Copy edited text" button on our side.
5. **Visibility toggle** per comment: team only or everyone.
6. **Show existing pins** to reviewers so they do not file duplicates.
7. **Pins become requests** (or request notes) through the existing suggestion
   gate, so one human approval turns client feedback into work; MCP tools from
   day one (Pastel and BugHerd already ship MCP).
8. Not a proxy first: proxies break on CSP, logins, cookies and JS-heavy pages,
   and we would own every load failure. Keep it as a fallback for sites where we
   cannot add a script.

**Interim with no build**: Webflow's comment-only guest links already let a
client pin comments in preview. A small step before the full tool is pulling
those Webflow comments into the dashboard as request suggestions (the Webflow
API exposes comments; we already use it through MCP).

Unchecked: whether every client's Webflow plan allows site-wide custom code,
and whether an html2canvas-style screenshot renders Webflow pages faithfully.

---

## 3. Call recordings and direct recordings

### Today

Only Google Meet calls that Gemini took notes on, pulled from Drive
(`lib/gemini-transcript-parser.ts`, `call_transcripts`). No audio or video is
stored. Whisper on Workers AI is already bound and in use for Slack voice notes
(`lib/slack/voice.ts`, `@cf/openai/whisper`), so the transcription half is
already in the stack.

### Options for Meet, Teams and Zoom

| Route | How | Cost | Trade-off |
|---|---|---|---|
| Recall.ai Meeting Bot API | A bot joins Zoom, Meet, Teams, Webex, Slack huddles | $0.50 an hour plus $0.15 transcription (startup rate $0.25) | One integration covers all three; the bot is visible in the call |
| Recall.ai Desktop Recording SDK | No bot; mic plus system audio on Mac and Windows; real speaker names from participant events | Included in tiers, no separate price found | It is an Electron app we would ship to ourselves |
| Our own Mac menu-bar app | Core Audio process taps (macOS 14.4+) plus mic, the way Loopsii and Granola appear to work | Our time | Fully owned, highest effort |
| Buy Granola or Loopsii for the two of us | They record; we pull transcripts in through their MCP or API | $14 or $12 a user | No build; data sits with a third party (Loopsii uses Z.ai) |
| Zoom RTMS | Real-time media API, generally available | Zoom side | Zoom only; Meet's media API is beta-only and Teams has none (vendor blog, medium confidence) |

Transcription per audio hour: Whisper on Workers AI about $0.03 (no speaker
labels), AssemblyAI $0.15 plus $0.02 diarization, ElevenLabs Scribe $0.22,
Deepgram Nova-3 $0.26. At 40 call hours a month that is about $1 to $10.

Two separate streams (mic is us, system audio is them) give "Me" and "Them"
labels with no diarization at all; Granola does this and upgrades to real names
on Meet, Zoom and Teams.

### Direct recordings (Loom replacement)

Browser `getDisplayMedia` plus mic through `MediaRecorder`, uploaded to R2 in
multipart chunks (5 MiB minimum part), transcribed by Whisper, summarised by
Haiku. A browser gets tab audio and mic reliably but not audio from a desktop
Zoom or Teams app, which is why the call route above is separate. Cloudflare
Stream ($5 per 1,000 minutes stored, $1 per 1,000 delivered) gives adaptive
playback if raw R2 files feel slow. R2 itself is $0.015 per GB-month with free
egress.

### Recommended order

1. Upload a recording, transcribe it, file it like a Gemini transcript (days).
   Every downstream piece (suggestions, unlinked parking, MCP) already works.
2. Browser recorder with a share page and timecoded comments (about a week).
   This doubles as video feedback for the QA tester.
3. Calls: Liam picks one of Recall.ai bot, Recall.ai desktop SDK, or buying
   Granola or Loopsii and syncing transcripts in. Build our own Mac app only if
   the rest proves out.

Recording consent stays with whoever records, in every route.

---

## 4. The pinch list (small ideas, ranked by value for effort)

1. **Scope changes caught on a call** (Loopsii, up next): the suggester proposes
   a change request with the quote, a play link to the moment, included or
   billable, cost and days added. Extends CN.1 and the scope-creep flag.
2. **Ask the dashboard** (Loopsii Cmd+J): a question box that answers from
   calls, requests and projects, quoting the source with a link (and a
   timestamp once recordings exist).
3. **Suggest the client for an unlinked call note** instead of only parking it.
4. **Pre-call brief for client calls**, not just discovery calls: past calls
   plus open requests and hand-offs.
5. **"Client owes us" checklist per project** (brand files, copy, CMS access,
   each uploaded or waiting), visible in the portal.
6. **Weekly timesheet grid and a PDF time report.**
7. **Income goal bar**: paid, invoiced, unbilled, in pipeline, gap to the
   take-home target.
8. **Plain-words capacity line**: "Free about 60 hours a month, can start 8 Sep".
9. **Share links for anything** (notes, transcripts, recordings, files), public
   or invite-only, with the view analytics we already have for proposals.
10. **Client-scoped MCP** modelled on Loopsii's: OAuth consent, short-lived
    tokens, no delete, a Connected apps revoke screen.
11. **Chapters** on call transcripts (cheap once the summariser runs).
12. **Per-call recording choice** (Fathom): bot, bot-free, audio and transcript,
    or transcript only.

---

## Sources

Loopsii: loopsii.com, loopsii.com/llms.txt, loopsii.com/privacy (2026-10-08),
loopsii.com/terms, loopsii.com/connect. QA: marker.io and /pricing,
bugherd.com/features and /pricing, usepastel.com/faq and /plans,
help.usepastel.com (editing text in a canvas), markup.io/pricing,
ruttl.com/pricing, feedbucket.app/pricing, userback.io/pricing,
webflow.com/updates/guests-can-share-comment-only-links. Recording:
recall.ai/pricing, recall.ai/product/desktop-recording-sdk, docs.recall.ai,
docs.granola.ai (transcription), granola.ai/pricing, fathom.ai/pricing and
/whats-new, otter.ai/pricing, meetjamie.ai/pricing,
github.com/insidegui/AudioCap, recall.ai/blog/realtime-transcription-api.
Transcription and storage: developers.cloudflare.com (Workers AI, R2, R2
multipart, Stream pricing), deepgram.com/pricing, assemblyai.com/pricing,
elevenlabs.io/pricing/api, MDN getDisplayMedia. Fireflies and tl;dv prices came
from secondary sources and are left out above.
