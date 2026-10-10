# Loopsii teardown, website QA and call recordings: ideas to pinch

Liam, 2026-10-09: "one day i want a QA tester (so that clients can add comments
to websites we're working on, maybe even suggest copy tweaks etc). and also
recordings for calls, mainly just the transcript (beyond google gemini, it
should work on meets, teams, zooms, etc). and make recordings directly. research
what they have in features that we dont. and then we can pinch a few."

This is an ideas log, not a scope. Nothing here is scheduled. The ids live in
TASKS.md under "(f) North star and the long pool", "Ideas pool, 2026-10-09":
WQA.0 (section 2), REC.0 (section 3) and LP.1 to LP.12 (section 4).

**Scope correction, Liam, 2026-10-10 (Decision #068):** "i do not care about
video recording, just detecting meetings in my calendar, recording the pc
audio, and transcribing really well, and really cheap." Calendar detection,
PC audio capture, transcript accuracy and very low cost are the requirements.
The original screen recorder and Loom replacement recommendation is withdrawn.

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
| Loom-style screen recordings with share link, transcript, summary, timecoded comments | Absent; **out of scope per Liam, 2026-10-10** |
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

## 3. Calendar-aware meeting audio and transcription

### Liam's requirements, 2026-10-10

- Detect meetings in Liam's calendar and associate transcripts with the meeting
  and, where known, the client.
- Capture PC system audio plus microphone so both sides are transcribed.
  Windows PC support is required, across Google Meet, Microsoft Teams and Zoom,
  including browser and desktop apps.
- Transcribe really well and really cheaply. Transcript quality and very low
  total cost are the selection criteria. Transcript is the primary output.
- No video capture, screen recorder, Loom replacement, video playback or video
  sharing in this scope.
- Calendar detection is required. Automatic recording versus a prompt, and
  audio retention after transcription, remain scope choices. No provider,
  desktop SDK or transcription model has been selected.

### Today

Only Google Meet calls that Gemini took notes on, pulled from Drive
(lib/gemini-transcript-parser.ts, call_transcripts). No audio or video is
stored. Whisper on Workers AI is already bound for Slack voice notes
(lib/slack/voice.ts, @cf/openai/whisper). It is a candidate to evaluate, not
proof that it meets long-call accuracy requirements.

### Direction for the next scope

1. Use the existing calendar integration for meeting detection. Scope a local
   Windows desktop helper for system audio and mic capture across meeting
   providers and desktop apps. A Mac-only app does not meet the PC requirement.
2. Compare local transcription with inexpensive hosted models using the same
   real meeting samples. Check names, accents, technical terms, overlapping
   speech and missing words. Report accuracy alongside total cost per audio
   hour and expected monthly usage, including capture/SDK fees, processing and
   storage. Re-check pricing at scope time; the 2026-10-09 research estimates
   are not an approved budget or a reason to sacrifice accuracy.
3. Save into call_transcripts and reuse meeting/client linking, summaries, MCP
   access and the existing human-approved suggestions flow. Audio upload may
   help as a fallback or evaluation tool; it does not replace calendar
   detection and PC audio capture.

The original research considered Recall.ai's bot and desktop SDK, Granola,
Loopsii, Workers AI Whisper, AssemblyAI, ElevenLabs and Deepgram. These remain
candidates to assess against the requirements above, not selected solutions.
Local transcription belongs in the comparison, with hardware, accuracy and
processing time checked rather than assumed. A bot route is an alternative
from the original research, not the chosen capture approach.

The original browser screen recorder, Cloudflare Stream playback and video
feedback recommendation is withdrawn. Website QA pins and copy suggestions in
section 2 remain a separate idea and do not require a video recorder.

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
9. **Share links for anything** (notes, transcripts, audio recordings, files), public
   or invite-only, with the view analytics we already have for proposals.
10. **Client-scoped MCP** modelled on Loopsii's: OAuth consent, short-lived
    tokens, no delete, a Connected apps revoke screen.
11. **Chapters** on call transcripts (cheap once the summariser runs).
12. **Per-meeting audio controls**: skip a meeting or start/stop capture,
    with transcript as the primary output. Recording automation remains for
    scoping; no video or bot-selection UI (Liam, 2026-10-10).

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
