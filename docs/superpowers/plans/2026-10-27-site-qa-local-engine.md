# Site QA step 4: the local engine helper and the Engine switch (SQA.4)

Revision 4, 2026-10-27, after the third fresh Opus review (changelog at the end).

Liam, 2026-10-27: "any way for me to make it work with the 3 big browsers?
chrome, firefox, safari?" and "is there not a way to switch the loaded site from
firefox to chrome in the dashboard? since i use it as a web app, it always is in
chromium. i do have a macbook that i can run QA passes on if we can't find a way
to have it all on my windows pc".

Approved direction: a local engine helper on his Windows PC runs Playwright
Firefox and WebKit, the workspace gets an Engine switch (Your browser, Firefox
engine, WebKit engine), clicks on an engine frame map to real elements through
the helper so comments keep exact selectors and element context, and scans run
in that engine and are recorded under that browser. The MacBook stays the real
Safari sign-off: Playwright WebKit on Windows is not Safari, and the UI says so.

Builds on docs/superpowers/plans/2026-10-26-site-qa-tester.md,
docs/superpowers/plans/2026-10-27-site-qa-wide-pages-comments.md and step 3
(browsers per round, migration 0118, HEAD 1f2773a1). Every rule in CLAUDE.md
and AGENTS.md applies: no `any`, no console.log, no em or en dashes and no
double hyphens in copy or comments, no single-side borders, CSS vars and rem
units, 44px touch targets, guard order on routes unchanged, never export
non-route symbols from route.ts.

The dashboard is https://portal.tahi.studio (appOrigin() in lib/app-url.ts).
dashboard.tahi.studio is the old ManyRequests app and is never an allowed
origin anywhere in this plan.

## 0. Goal, constraints, done, risks

Goal: on his Windows PC, inside the Chromium web app, Liam flips the Engine
switch to Firefox or WebKit and gets the same five-frame workspace (XL 1920,
Desktop 1440, Tablet 768, Mobile L 425, Mobile P 375) rendered by that engine:
synced scrolling, hover outline, comment mode with pins, ticks, Rescan and Scan
all, everything recorded against firefox or webkit through the existing routes.

Constraints:
- The helper listens on 127.0.0.1 only and accepts only the paired dashboard
  origin. Nothing else on the web, and nothing inside the pages it renders, can
  drive it or reach the PC or the LAN through it.
- The helper holds no dashboard credentials and never calls dashboard APIs.
  Every write still goes from the signed-in dashboard tab through the existing
  guarded routes.
- The same scanner bundle (workers/qa-view/src/scanner) runs in every engine,
  so selectors, element context, scan results and scroll anchors come from one
  code path.
- Every tick, scan and comment is attributed to the engine that produced the
  observation, never to whatever the switch says at the moment the write
  happens (section 1.8).
- Chromium iframe mode behaves exactly as it does today when the switch is on
  "Your browser".

Done: phases 1 to 8 shipped and live, Liam has run one real round on a client
staging site in Firefox engine and WebKit engine on his PC, opus-reviewer
passed, STATUS.md, AGENTS.md, TASKS.md and DECISIONS.md updated.

Risks, highest first:
1. Chrome Local Network Access. Since Chrome 142 a public https site needs a
   one-time user grant before it may reach loopback ("Apps on device" since
   Chrome 145), and recent Chrome versions are reported to apply it to
   WebSockets too. fetch and WebSocket share the one permission, so neither is
   a fallback for the other. The deterministic fallback is a Chrome policy
   (section 1.2). Phase 0 proves the prompt path and the policy path on his
   actual Chrome and web app before anything else is built.
2. Frame rate and latency. Firefox and WebKit have no public screencast API in
   Playwright, so frames are screenshots. Phase 0 has hard go or no-go
   thresholds measured with five live pages (section 8, phase 0) and a defined
   degrade path.
3. Fidelity of WebKit on Windows. Playwright's Windows WebKit uses a different
   graphics and font stack from Safari. It catches flexbox, grid, gap, sticky,
   :has(), backdrop and form control layout differences, not font
   rasterisation, momentum scrolling or Apple-only behaviour. Copy says so;
   the MacBook stays the sign-off.
4. Playwright's patched browsers are not hardened like stable releases, and
   client-site JavaScript runs in them on Liam's PC. Section 3 bounds what that
   JavaScript can reach (a refusing proxy, viewer-only navigation, scheduled
   Playwright bumps).
5. The workspace frame plumbing is spread over four message listeners and
   several iframe-typed helpers. Phase 5 replaces them with a frame handle and
   one bus without changing behaviour, before engine mode is added.

Irreversible: only the additive migration 0119 (phase 7a). It ships before any
engine write can reach production (phase 6c depends on 7a), so no engine-era
row is ever stamped 'native' by the column default, and the unconditional scan
upsert (app/api/admin/qa/round-pages/[id]/scan/route.ts, the
onConflictDoUpdate on qaScanResults) is made conditional before an engine
WebKit scan could overwrite a real Safari one.

## 1. Architecture

```
Chromium web app (https://portal.tahi.studio)
  RoundWorkspace
    frame bus: (viewport, data, browser)
      <- iframe transport (today's qa-view iframes, postMessage), tags the detected browser
      <- engine transport (WebSocket to the helper), tags its engine
        |
        | ws://127.0.0.1:47615/v1/session        (JSON control + binary JPEG frames)
        | http://127.0.0.1:47615/v1/health, /v1/pair   (CORS, origin pinned)
        v
Local engine helper (apps/qa-engine, Node 20+, TypeScript, Playwright 1.58.2)
  refusing CONNECT proxy on 127.0.0.1:47616 (all engine traffic goes through it)
  one Browser per engine (firefox, webkit), launched on demand, headless
  five BrowserContexts per session, one Page each, viewport = QA_VIEWPORTS
  Page loads https://<qa-view>/v/<token><path>   (same proxy worker, same scanner)
  scanner <-> helper through a Playwright binding, main frame only
```

### 1.1 Helper process

- Node 20+ and TypeScript, in a new package apps/qa-engine with its own
  package.json, tsconfig and vitest config, built with esbuild to
  apps/qa-engine/dist/main.mjs. Chosen over a .NET host (the REC.0 precedent)
  because Playwright's primary binding is Node, the helper imports the pure
  lib/qa/types.ts and lib/qa/engine-protocol.ts directly, and the same agents
  and test runner cover it. No tray icon: the dashboard is the UI; the helper is
  a console process logging to %LOCALAPPDATA%/TahiQaEngine/logs.
- Dependencies, pinned: playwright 1.58.2 (the version the root resolves, so
  browser downloads in %LOCALAPPDATA%/ms-playwright are shared; webkit-2227 is
  already there, Firefox is not) and ws 8.17.1 or later (earlier 8.x has a
  header-flood DoS), with `maxPayload` about 1 MB. Nothing else at runtime.
- Install once from the repo: `cd apps/qa-engine`, `npm ci`,
  `npx playwright install firefox webkit`, `npm run build`.
- Start: `npm start` (prints port, version, and a pairing code when unpaired).
  Optional `npm run startup:install` writes a Startup folder shortcut that runs
  the built helper minimised at sign-in; `npm run startup:remove` deletes it.
  Browsers launch only when a session opens an engine and close after 10
  minutes without a session.
- Ports: 47615 (API and session) and 47616 (the refusing proxy, section 3),
  127.0.0.1 only, never 0.0.0.0 or ::. If a port is taken the helper exits with
  a clear message; `QA_ENGINE_PORT` overrides the API port (proxy = port + 1)
  and the dashboard reads the same override from localStorage
  `tahi-qa-engine-port`. No discovery scan.
- Config: %APPDATA%/TahiQaEngine/config.json holds the pinned dashboard origin,
  the pinned viewer origin and SHA-256 hashes of paired tokens (never the
  tokens). `npm run unpair` clears them.
- Windows only is supported and tested. On the MacBook Liam opens the dashboard
  in real Safari (detection already records webkit).

### 1.2 How the dashboard talks to it (Chromium rules)

- Mixed content: http://127.0.0.1 is a potentially trustworthy origin, so the
  https dashboard may fetch it and open ws:// to it.
- Local Network Access: one permission covers fetch and WebSocket. The
  dashboard never contacts 127.0.0.1 until Liam picks an engine for the first
  time, and first shows: "Chrome will ask to let this site connect to apps on
  this device. Choose Allow so the dashboard can reach the QA engine helper."
  The Connect button makes the first request, so the prompt has context. The
  helper also answers legacy Private Network Access preflights with
  `Access-Control-Allow-Private-Network: true`.
- Deterministic fallback: the Chrome policy `LocalNetworkAccessAllowedForUrls`
  with the single entry https://portal.tahi.studio, set once under
  HKCU/Software/Policies/Google/Chrome/LocalNetworkAccessAllowedForUrls (value
  "1"). This is a browser policy change on his machine, so Liam applies it
  himself; the panel shows the exact registry lines and says to confirm it at
  chrome://policy. Phase 0 confirms Chrome honours it from HKCU on his
  unmanaged PC (HKLM is the alternative if not). The panel warns that any
  Chrome policy makes Chrome show "Managed by your organisation" in its menu and
  settings; that is cosmetic, and deleting the registry value removes it.
- Telling "blocked by Chrome" from "helper not running": inside try, call
  `navigator.permissions.query` with the loopback permission name, then the
  older combined name (`loopback-network`, then `local-network-access`). A
  result of `denied` means blocked by Chrome: show how to allow Apps on device
  in site settings, plus the policy fallback. If the query throws (unknown name)
  and the health fetch fails, show one combined message with both remedies:
  "Either the helper is not running, or Chrome is blocking this site from apps
  on this device." A fetch that fails while the permission reads `granted`
  means the helper is not running.
- CORS: `GET /v1/health` and `POST /v1/pair` answer only when Origin equals an
  allowed origin, with `Access-Control-Allow-Origin` set to exactly that origin,
  `Vary: Origin`, methods GET and POST, headers content-type. Any other origin
  gets 403 with no CORS headers.
- Allowed origins: https://portal.tahi.studio only. Dev origins
  (http://localhost:3000, http://localhost:3179) only when the helper runs with
  `npm run dev`. The origin that pairs is pinned.
- Session: `new WebSocket('ws://127.0.0.1:47615/v1/session')`. The upgrade is
  refused unless Origin is the pinned origin and Host is `127.0.0.1:47615` or
  `localhost:47615` (DNS rebinding guard). The first message must be
  `{ type: 'hello', protocol: 1, token }` within 3 seconds or the socket closes
  with 4401. One live session per token. A second hello with the same token
  does not take over silently: the new socket closes with 4409. The dashboard
  shows "The engine is in use in another tab" with a "Use here" button, which
  sends `hello` with `takeover: true`; the helper then closes the old socket
  with 4409 and the old tab shows the same message. No automatic retry on 4409
  in either tab.

### 1.3 Pairing

Mirrors the REC.0 eight-character code, in the other direction.
1. With no paired token, or on `npm run pair`, the helper prints an
   eight-character code (Crockford base32, about 40 bits), valid 10 minutes.
2. The Engine panel asks for the code and POSTs `{ code, viewerOrigin }` to
   `/v1/pair`; viewerOrigin is the origin of the view-token baseUrl the
   dashboard already holds.
3. Constant-time compare, 5 attempts per code (then it is burned and a new one
   printed). On success the helper pins the Origin and viewerOrigin and returns
   a 32-byte random token (base64url); it stores only the SHA-256.
4. The dashboard keeps the token in localStorage `tahi-qa-engine-token`. A 4401
   close or 401 clears it and shows the pairing step.

A changed viewer origin needs a re-pair; the helper refuses navigation to
anything else, so a stolen token can only ever load qa-view pages.

### 1.4 How pages load

Through the qa-view sandbox, not direct. The dashboard sends the same baseUrl
it gives the iframes (`<viewer>/v/<HMAC token>`) plus the path:
- one scanner, injected by the worker, in all three engines;
- the worker fetches only the token's origin through lib/qa/ssrf.ts;
- same stripped CSP, cookies and link rewriting as the Chromium frames.

frame-ancestors does not apply to a top-level page, so the worker's headers do
not change. When the view token refreshes (useViewToken, about every 11.8
hours) the dashboard sends the new baseUrl and the helper renavigates.

Context settings per viewport: viewport width and height from QA_VIEWPORTS;
`deviceScaleFactor` = the dashboard's `window.devicePixelRatio`, sent in `open`
(clamped 1 to 3). The contexts are recreated only on a real monitor DPR change
(the window moved to another screen): the dashboard watches a matchMedia
resolution query, debounces 1 second, and ignores changes caused by browser
zoom (devicePixelRatio moved while `window.outerWidth` stayed the same and
`window.innerWidth` moved by the inverse factor). Phase 0 checks the heuristic
in the web app window. No isMobile,
no hasTouch, default engine user agent; `acceptDownloads: false`; no
permissions; `serviceWorkers: 'block'`; fresh non-persistent contexts per
session; JavaScript dialogs (alert, confirm, prompt, beforeunload) dismissed
automatically and reported as `blocked`. This matches the Chromium iframes (a
width-constrained desktop render), not device emulation.

### 1.5 Scanner engine channel (workers/qa-view/src/scanner)

Today the scanner posts to `window.parent` with targetOrigin payload.p. In a
top-level Playwright page `window.parent === window` and the origin does not
match, so those posts are dropped. Add one seam:

- New `scanner/host.ts`: `createHostChannel(win, payload)` returns
  `{ post(msg), onCommand(handler) }`. Engine mode is chosen only when
  `win.top === win` AND `typeof win.__tahiQaEngine === 'function'` (a binding
  the helper exposes before navigation). In engine mode `post` calls the
  binding and commands arrive through `win.__tahiQaEngineCommand(data)`, which
  the scanner defines only in engine mode. Otherwise it is exactly today's
  postMessage path.
- scanner/index.ts: the body of the message listener becomes
  `handleCommand(data: unknown)`, used by the postMessage listener (its payload.p
  origin check unchanged) and by the engine channel. createCommentLayer and
  createScrollSync get `post: host.post`.
- Trust: this gives the page no more power than today. The scanner is a defer
  script, so the site's own scripts run first and can wrap or call the binding
  and the command function, exactly as they can already forge postMessages to
  the parent from inside the iframe. Protection comes from the receiving side,
  not from the scanner: the helper accepts binding calls only from
  `source.frame === page.mainFrame()` (embedded third-party iframes cannot
  reach it), caps each message at 1 MB and each page at 50 messages per second
  (over the cap, qa:scroll reports are coalesced to the latest one per page and
  sent when the window reopens, so synced scrolling never loses its final
  position; other types over the cap are dropped), and drops anything that is
  not a known frame-to-dashboard type; the dashboard
  re-parses every message with the existing parsers, ties it to the page the
  helper tagged (never a claimed viewport), checks the path matches the page on
  screen, and never writes a comment without a human Save.

### 1.6 Snapshot transport

Live viewport screenshots plus forwarded input; the workflow depends on hover
outline, synced scrolling and click to comment.

- Capture: `page.screenshot({ type: 'jpeg', quality: 70, scale: 'css',
  animations: 'allow', caret: 'initial' })` of the viewport only. scale 'css'
  keeps one image pixel per CSS pixel whatever deviceScaleFactor is, so the
  canvas maths stays simple; if phase 0 shows text too soft at Actual size on a
  high-DPR screen, switch to scale 'device' for the focused frame only.
- Demand driven, per page:
  - after input or a command for that page: capture now, then every 100 ms
    until 700 ms after the last input or scroll event;
  - after a load, a highlight or a scroll-to: a 1.5 second burst;
  - idle refresh every 2 seconds for visible pages;
  - one frame in flight per page: the next capture waits for the dashboard's
    `ack` of the previous one. The ack carries the frame's epoch, and an ack
    whose epoch is not the current open's is ignored. Every `open` and
    `navigate` resets each page's in-flight state, so a frame lost across a
    switch never stalls capture;
  - a global cap of 30 frames per second across pages, the focused or hovered
    frame first, the rest round robin;
  - pages not visible in the strip are not captured (`visible`);
  - all capture pauses while the dashboard tab is hidden.
- Degrade path (used when phase 0 misses a threshold, or automatically when
  measured aggregate fps drops below the floor for 3 seconds): only the hovered
  or focused frame bursts; the other four refresh at 1 fps and once after each
  relayed scroll settles.
- Wire format: binary WebSocket message = 16-byte header (magic 'QAF1',
  viewport index u8, epoch u8 (the low 8 bits of the current openId, section
  1.9), seq u16, width u16, height u16, capturedAt u32 ms offset) plus JPEG
  bytes. Control messages are JSON text frames. The transport drops any frame
  whose epoch is not the current open's.
- Display: a `<canvas>` per frame with intrinsic size = viewport width x height,
  drawn with `createImageBitmap`, scaled with the same transform the iframe uses
  (frameScale), so Fit width, Actual size, Medium, Large, Wide and Expand work
  unchanged. A frame older than 3 seconds while live shows a "Reconnecting" chip.
- Full-page scroll: the frame is the live viewport and scrolling is forwarded,
  so the whole page is reachable as in an iframe. Static full-page capture is a
  follow-up, not v1.
- Synced scrolling: unchanged logic. The scanner's scroll-sync reports user
  scrolls (phase 0 confirms Playwright's mouse.wheel counts as user input for
  USER_INPUT_WINDOW_MS), the helper relays qa:scroll tagged with the page's
  viewport, and the dashboard's existing relay (relayTargets, scrollToFor,
  createRelayQueue) sends qa:scroll-to to the other four through the bus.
- Headless background throttling: phase 0 checks whether headless Firefox or
  WebKit throttle requestAnimationFrame or timers in pages that are not
  "focused" (scroll-sync and late layout rely on them). If they do, the helper
  sets the engine's no-throttle switches (Firefox prefs such as
  dom.min_background_timeout_value, or bringToFront rotation) and the
  integration test covers it.

### 1.7 Input forwarding and element mapping

On the engine canvas:
- pointermove, coalesced to one per animation frame, sends
  `{ type: 'input', viewport, kind: 'move', x, y, mods }` with
  x = (clientX - rect.left) / rect.width x viewport.width (same for y), clamped.
  The helper keeps only the latest pending move per page and calls
  `page.mouse.move`, so hover styles and the comment-mode outline render in the
  engine.
- pointerdown and pointerup send `kind: 'down' | 'up'` with the button; the
  helper calls mouse.down and mouse.up at the point, so links, buttons and the
  scanner's capture-phase comment click see real engine events.
- wheel sends accumulated deltaX and deltaY once per animation frame
  (`page.mouse.wheel`), with preventDefault on the canvas.
- keyboard: the canvas is focusable (tabIndex 0, visible focus ring). While it
  has focus, keys are forwarded as `{ type: 'key', viewport, key, mods }` with
  mods `{ alt, ctrl, meta, shift }` (the helper presses the modifiers around the
  key), and printable runs as `insertText`. Escape is never forwarded: with a
  dashboard layer open (composer, comment mode, expanded frame, wide mode) it
  runs today's Escape ladder; with none open it blurs the canvas. Shift+F6 also
  blurs the canvas, as a documented way out when Tab is being forwarded.

Element mapping is the scanner's: in comment mode a forwarded click lands on the
real element, createCommentLayer computes uniqueSelector (selector.ts) and
buildElementContext (context.ts) in that engine, and posts qa:pick. Pins are
drawn inside the engine page (closed shadow root), so they appear in frames; a
click on a pin becomes qa:pin-click. qa:highlight and qa:focus-pin unchanged.

Fidelity limits, stated in the README and the engine note's tooltip: native
pickers (select dropdowns, date pickers, file dialogs) are drawn outside the
page and do not appear in screenshots; no IME or clipboard paste; a site's own
Escape handling cannot be tested in engine mode.

### 1.8 Attribution, comment mode, ticks and scans in engine mode

Attribution comes from the source of each observation, not from the global
active browser:
- The frame bus delivers `(viewport, data, browser, via)`. The iframe transport
  tags `detected` (the browser the dashboard runs in) and via 'native'; the
  engine transport tags its engine and via 'engine'. Every engine write (tick,
  scan, comment, scan-batch submit) sends via 'engine'; the server (phase 7a)
  validates it.
- Every open is numbered: the dashboard allocates a new `openId` (a counter)
  for each `open` and each `navigate`, and the helper echoes it on every message that belongs to that open
  (loaded, frame-message, blocked, state, scan-batch-result,
  scan-batch-progress, scan-batch-end) and in the frame header's epoch byte. The
  engine transport drops anything whose openId is not the current one, so a
  message Firefox produced can never arrive tagged as WebKit after a switch.
- handleScan stores a scan under the tag that came with it, not activeBrowser,
  and its gates use that tag too: the readOnly check and the browserInRound
  check are computed for the message's browser, not the active one.
- A scan the server keeps out (an engine scan where a native one is stored,
  rule in 7.1) comes back as `{ ok: true, stored: false }`; the frame's scan
  state shows "Kept the real Safari scan" (built with browserLabel), not
  "Scanned".
- The composer captures `browser` (and `via`) from the qa:pick that opened it,
  and saveComment passes it explicitly (AddCommentInput.browser already exists;
  today use-comments.ts falls back to browserRef, so a pick made in Firefox and
  saved after a drop would be stored as chromium). saveComment must always pass
  it, and the fallback in use-comments.ts is kept only for callers without a
  pick.
- If the switch changes or the engine disconnects while the composer is open,
  the composer and its draft stay open, re-anchored to the strip, and Save
  stores the comment under the captured engine (the round must still include
  that browser; otherwise the existing 400 is shown and the draft is kept).
- Scan all captures its driver, browser, via and (for an engine run) openId
  when the run starts. An iframe run keeps going under the detected browser even
  if the switch moves to an engine (its hidden iframes are unaffected). An
  engine run carries its engine in `scan-batch`; the helper ends it with a
  terminal `scan-batch-end` (reason 'superseded') on any new `open`, and the
  dashboard submits only while the run's openId is the current one. It is also
  cancelled at once when the session drops (no further submits), with a toast
  giving how many pages were stored.
- Ticks are a human action on the strip on screen: they are tagged with the
  strip's transport browser and via. The tick PATCH keeps `item` and adds
  `ticks`, the stored per-viewport tick state (ticked and via) for that
  browser, and the UI settles to that, so a write the server refused (7.1) is
  never shown as applied.
- Until phase 6d, the phase 5 predicate `engineWritesEnabled` is false and every
  engine-sourced write (handleScan, tick, composer Save) is a no-op, so the
  scanner's automatic scan on load cannot write engine data early. While a
  session is connecting, ticks, comment mode and Rescan are disabled with the
  reason "Waiting for the Firefox engine".
- activeBrowser (use-active-browser.ts) still drives display: the "Testing in"
  chip, pinsFor, the tick checkboxes shown and the not-in-round banner.
  `setOverride(E)` when the session is ready for engine E, `setOverride(null)`
  otherwise.
- Comment mode: one frame at a time, as today; qa:comment-mode goes through the
  bus.
- Rescan: qa:rescan through the bus to all five pages.
- Scan all driver: `scanPath(path, viewport): Promise<QaScanResult | null>`. The
  iframe driver is today's hidden frames. The engine driver sends
  `{ type: 'scan-batch', id, openId, engine, items: [{ roundPageId, path }] }`;
  the helper refuses a batch whose engine or openId is not the current open's,
  walks the items in two hidden pages (Desktop and Mobile P, their own
  contexts, never captured), streaming `scan-batch-result`; the dashboard checks
  the openId and the path and submits under the batch's captured engine with
  via 'engine'. Cancel sends `scan-batch-cancel`; every batch ends with exactly
  one `scan-batch-end`. 25 second timeout per page.
- Not-in-round: the existing banner and "Add Firefox to this round" button.

### 1.9 Shared protocol (lib/qa/engine-protocol.ts and lib/qa/types.ts)

Phase 1 moves the dashboard-to-frame union out of round-workspace.tsx (today a
local `type FrameMessage` at line 115) into lib/qa/types.ts as
`QaFrameCommand = QaRescanMessage | QaHighlightMessage | QaCommentModeMessage |
QaPinsMessage | QaFocusPinMessage | QaScrollToMessage | QaScrollSyncMessage`,
and adds `QaFrameReport` for the frame-to-dashboard union (scan, pick,
pin-click, comment-mode-changed, escape, scroll). lib/qa/engine-protocol.ts is
pure and imported by both sides:

```ts
export const QA_ENGINE_PROTOCOL = 1
export const QA_ENGINE_DEFAULT_PORT = 47615
export type QaEngineKey = Exclude<QaBrowserKey, 'chromium'>   // 'firefox' | 'webkit'
export interface QaKeyMods { alt: boolean; ctrl: boolean; meta: boolean; shift: boolean }
export const QA_ENGINE_CLOSE_UNAUTHORISED = 4401
export const QA_ENGINE_CLOSE_IN_USE = 4409

// dashboard to helper (JSON)
| { type: 'hello'; protocol: 1; token: string; takeover?: boolean }
| { type: 'open'; openId: number; engine: QaEngineKey; baseUrl: string; path: string; deviceScaleFactor: number }
| { type: 'navigate'; openId: number; baseUrl: string; path: string }
| { type: 'visible'; viewports: QaViewportKey[]; focused: QaViewportKey | null }
| { type: 'pause'; paused: boolean }
| { type: 'frame-command'; viewport: QaViewportKey; message: QaFrameCommand }
| { type: 'input'; viewport: QaViewportKey; kind: 'move' | 'down' | 'up'; x: number; y: number; button?: 'left' | 'right'; mods: QaKeyMods }
| { type: 'wheel'; viewport: QaViewportKey; x: number; y: number; dx: number; dy: number; mods: QaKeyMods }
| { type: 'key'; viewport: QaViewportKey; key: string; mods: QaKeyMods }
| { type: 'text'; viewport: QaViewportKey; text: string }
| { type: 'ack'; viewport: QaViewportKey; seq: number; epoch: number }
| { type: 'scan-batch'; id: string; openId: number; engine: QaEngineKey; items: { roundPageId: string; path: string }[] }
| { type: 'scan-batch-cancel'; id: string }
| { type: 'close' }

// helper to dashboard (JSON); every message tied to an open echoes its openId
| { type: 'welcome'; protocol: 1; version: string; engines: Record<QaEngineKey, 'installed' | 'missing'> }
| { type: 'state'; openId: number; engine: QaEngineKey; phase: 'launching' | 'ready' | 'crashed'; error?: string }
| { type: 'loaded'; openId: number; viewport: QaViewportKey; url: string }
| { type: 'frame-message'; openId: number; viewport: QaViewportKey; data: unknown }   // re-parsed by the dashboard
| { type: 'blocked'; openId: number; viewport: QaViewportKey; what: 'navigation' | 'popup' | 'download' | 'dialog' | 'request'; url: string }
| { type: 'scan-batch-result'; openId: number; id: string; roundPageId: string; viewport: QaViewportKey; data: unknown }
| { type: 'scan-batch-progress'; openId: number; id: string; done: number; total: number }
| { type: 'scan-batch-end'; openId: number; id: string; reason: 'done' | 'cancelled' | 'superseded' | 'error' }
| { type: 'error'; code: string; message: string }
```

Plus parsers for both directions, the binary frame header encode and decode,
and `isAllowedViewerUrl(url, pinnedViewerOrigin)` (https, exact origin, path
starts with /v/; the dev carve-out in section 3 is a separate explicit
parameter). Unit tested in the root vitest run.

## 2. UI

All in app/(dashboard)/qa/[siteId]/workspace. Tokens, rem, 44px targets, focus
rings, dark mode through CSS vars only, no single-side borders.

- Engine switch: a SegmentedControl in the toolbar next to the "Testing in"
  chip, label "Engine", options "Chrome (this browser)" (the detected browser's
  label), "Firefox engine", "WebKit engine". The engine matching the detected
  browser is not repeated (in real Firefox: "Firefox (this browser)" and
  "WebKit engine"). The switch works on closed rounds too, for viewing; writes
  stay off there exactly as today. The engine options are shown only when the
  dashboard runs on Windows (`navigator.userAgentData?.platform`, falling back
  to the user agent), since the helper is supported and tested only there; on
  the MacBook the switch is hidden and real Safari is the path.
- Single-frame layout (narrow window or phone): the switch is hidden and the
  workspace drops to Your browser (override cleared), since a phone cannot reach
  the PC's loopback and the engine strip is built for the desktop layout.
  Narrowing the window into the single-frame layout sends `pause` and keeps the
  session open; widening again resumes the engine without a relaunch.
- Persistence: localStorage `tahi-qa-engine`, restored after mount. Restoring
  only reconnects if `tahi-qa-engine-token` is present. If the helper cannot be
  reached on load, the workspace falls back to Your browser with a toast ("The
  QA engine helper is not running. Showing Chrome.") rather than parking Liam on
  an empty panel; the switch keeps the engine option ready for one click.
- Chip: "Testing in Firefox engine" or "Testing in WebKit engine".
- Engine notes (role note, one line under the toolbar while an engine is on):
  - Firefox: "Firefox engine runs on this PC through Playwright's build of
    Firefox. It renders like Firefox."
  - WebKit: "WebKit engine is close to Safari but it is not Safari: fonts,
    scrolling and some form controls differ. Do the Safari sign-off on the
    MacBook."
  - Both carry a tooltip with the fidelity limits in 1.7.
- Panel states in place of the strip (toolbar, rail and issues stay):
  - first use: the Local Network Access explainer and a Connect button;
  - helper not running: "Start the QA engine helper", the install lines and
    `npm start`, "Check again", automatic retry every 3 seconds while visible,
    "Back to Chrome";
  - blocked by Chrome: allow Apps on device in site settings, or the policy
    lines (1.2) for Liam to apply;
  - combined (permission state unknown): both remedies;
  - unpaired: "Enter the pairing code the helper shows", an 8-character input
    (monospace, uppercase, 44px), Pair button, inline errors;
  - in use in another tab (4409): "The engine is in use in another tab", Use
    here button, no automatic retry;
  - engine missing: "Firefox is not installed for the helper. Run npx
    playwright install firefox in apps/qa-engine.";
  - protocol mismatch: "Update the helper: git pull, then npm ci and npm run
    build in apps/qa-engine.";
  - launching: skeleton frames and "Starting Firefox";
  - crashed or disconnected mid-session: toast "The Firefox engine stopped.
    Back to Chrome.", the override is cleared first, an open composer keeps its
    draft and engine (1.8), an engine Scan all is cancelled.
- Frame label bar: unchanged, plus a small engine glyph in the scan state so a
  screenshot of the workspace shows which engine it was.
- Ticks and progress with provenance (phase 7b, option A): see 7.1.

## 3. Security review points (for security-reviewer)

1. Bind: 127.0.0.1 only for both ports; verify with netstat.
2. Origin: exact match against the pinned origin (https://portal.tahi.studio)
   on every HTTP request and on the upgrade; 403 without CORS headers otherwise.
3. Host header: only 127.0.0.1:port or localhost:port.
4. Pairing: 10-minute code, 5 attempts then burned, constant-time compare,
   32-byte token, only its SHA-256 stored, never in a URL or log.
5. Session: hello within 3 seconds or 4401; one live session per token, 4409
   for a second tab, takeover only on an explicit Use here.
6. Navigation allowlist (decided: option (ii), keeps the HTTP cache): the
   helper itself navigates only to isAllowedViewerUrl targets. No route
   interception is used for navigation. On a main-frame `framenavigated` to a
   URL off the allowlist (site JavaScript setting location, a meta refresh), the
   helper calls `page.goto(lastAllowedUrl)` and reports `blocked`. The off-origin
   page does load briefly before that, still entirely behind the refusing proxy
   in point 7, so it can reach only public addresses, exactly as any link the
   site might fetch; its frames are not captured and its binding calls are
   ignored (the main frame URL is checked before relaying).
7. Network guard, preferred design (a): every engine is launched with
   Playwright's `proxy` option pointing at a CONNECT proxy inside the helper
   (127.0.0.1:47616). For each CONNECT or absolute-form HTTP request the proxy
   resolves DNS itself, refuses if any resolved address is loopback, private
   (RFC 1918, CGNAT 100.64/10, ULA fc00::/7), link-local (169.254/16, fe80::/10),
   unspecified, multicast or the helper's own ports, and then connects to the
   exact address it checked (no second lookup, so DNS rebinding cannot slip
   between check and connect). The classifier normalises before checking:
   IPv4-mapped IPv6 (::ffff:a.b.c.d) is checked as the IPv4 address, 0.0.0.0/8
   is refused, NAT64 (64:ff9b::/96 and 64:ff9b:1::/48) is checked as its
   embedded IPv4, and literal hosts in decimal, octal or hex IPv4 forms are
   parsed the way the resolver would. The proxy requires random per-launch
   credentials (Playwright's `proxy.username` and `proxy.password`, generated at
   each browser launch, never logged), so no other local process or page can use
   it. This covers fetch, XHR, images, WebSockets and rebinding hosts, and keeps
   the browsers' HTTP cache (no route interception).
   Firefox needs `network.proxy.allow_hijacking_localhost: true` (otherwise it
   bypasses the proxy for localhost) and `media.peerconnection.enabled: false`
   (WebRTC ICE would otherwise reach local addresses directly). For WebKit, an
   init script removes RTCPeerConnection before page scripts run. Phase 0
   proves proxy support in WebKit on Windows, the Firefox prefs, and that no
   request bypasses the proxy.
   Fallback (b), only if (a) fails in phase 0: context.route for HTTP plus
   context.routeWebSocket for WebSockets, each host checked with dns.lookup
   (all addresses) before continuing, accepting the cache and latency cost. No
   weaker downgrade: either (a) or (b) must pass the integration cases below.
   lib/qa/ssrf.ts treats rebinding as out of scope, so it is not relied on
   alone; its pure range checks may be reused inside the proxy.
8. Integration cases for 7: a page fetch to http://127.0.0.1:47615/v1/health,
   a page WebSocket to ws://127.0.0.1:47615/v1/session, a fetch to
   http://localtest.me:47615 (a public name resolving to 127.0.0.1), a fetch to
   a 192.168 address and to 169.254.169.254, an iframe or image pointing at
   loopback: all refused, reported `blocked`, and never reaching the helper.
9. Binding: main frame only, size and rate capped, shape checked; the dashboard
   re-parses everything and ties messages to the helper-tagged page (1.5).
10. Popups closed on open, downloads refused, dialogs dismissed, permissions
    none, service workers blocked, contexts non-persistent and closed with the
    session.
11. The helper never sees Clerk cookies or calls dashboard APIs; it only holds
    view tokens, which already travel to the browser today.
12. The qa-view rule in AGENTS.md is untouched (never a tahi.studio subdomain).
13. Input forwarding is page-scoped; Escape is never forwarded.
14. Logs: no tokens, no view tokens (redact both `/v/<token>` and `?t=<token>`
    to `***`), no page content.
15. Dev and fixture carve-out: only under `npm run dev` or the integration test
    harness, the pinned fixture viewer origin (an http://127.0.0.1:<fixture
    port> origin chosen at start) is allowed for navigation and by the proxy.
    The helper's own two ports stay refused even then. Production start ignores
    the carve-out flag entirely.
16. Hardening note: Playwright's Firefox and WebKit builds are patched for
    automation and are not hardened or patched on the cadence of stable
    browsers. Mitigations: they load only qa-view pages (6, 7); Playwright is
    bumped together with the root dependency at least monthly and on any
    browser security advisory (a TASKS.md recurring item); the README says not
    to point the helper at untrusted sites and explains why.

## 4. Test strategy

- Root vitest (pure): engine-protocol parsers both ways, frame header round
  trip, isAllowedViewerUrl with and without the dev carve-out; workspace
  helpers: pointer to page coordinates at every zoom, engine session reducer
  (including 4401, 4409, takeover, disconnect), frame bus routing (iframe
  messages still need viewer origin AND the frame's window as source, and carry
  the detected browser; engine messages come only from the session and carry
  its engine), scan-all driver contract with a fake driver (captured browser),
  composer attribution (browser captured at pick).
- Scanner (jsdom, existing pattern): host channel picks engine mode only when
  top === self and the binding is a function; handleCommand behaves the same
  from both channels; existing iframe tests stay green.
- Helper unit (apps/qa-engine vitest): origin and host checks, pairing (expiry,
  attempts, burn, constant time), hello timeout, 4409 and takeover, capture
  scheduler with fake timers (burst, idle, ack gating, global cap, focus
  priority, degrade path, pause, visibility), input coalescing, the proxy's
  address classifier and resolve-then-connect, log redaction of both token
  forms, dialog handling.
- Helper integration (apps/qa-engine `npm run test:engines`, real Firefox and
  WebKit): a local fixture viewer (the built scanner bundle injected into
  fixture pages under /v/<token>/) under the dev carve-out. Asserts: five pages
  at the right sizes and DPR; qa:scan tagged with the right viewport; a click at
  a known button's centre in comment mode yields qa:pick whose selector equals
  uniqueSelector for that button and whose context box matches; a wheel yields
  qa:scroll; qa:pins draws a pin visible in the next frame (pixel check);
  navigation to another origin blocked; every case in section 3 point 8
  refused; disallowed Origin and Host refused; scan-batch returns results for
  every item; background pages are not throttled. Runs on Liam's PC and
  optionally in a GitHub Actions ubuntu job.
- Dashboard e2e (Playwright chromium, the QA worktree recipe on port 3179) with
  a fake helper (a WebSocket stub in the test) that sends welcome, canned JPEG
  frames and canned scanner messages:
  - switch states, pairing, 4409 with Use here, helper down on load falls back
    to Chrome with a toast, single-frame layout drops to Chrome;
  - ticks PATCH with browser firefox; scans submitted under firefox;
  - pick in the fake engine, drop the socket, type, Save: the POST carries
    browser firefox;
  - start an iframe Scan all, switch to Firefox engine mid-run: every submit of
    that run carries chromium;
  - engine Scan all, drop the socket: no submit after the drop;
  - with a Firefox pick open in the composer and a Firefox engine Scan all
    running, switch to WebKit: the fake helper then replays late Firefox
    messages and frames with the old openId; the saved comment carries firefox,
    no scan or tick from the Firefox open is stored as webkit, the batch ends
    'superseded';
  - every engine write (tick, scan, comment) carries via 'engine';
  - an engine scan answered `stored: false` shows "Kept the real Safari scan";
  - narrowing to single-frame sends pause, not close;
  - iframe mode unchanged (comments, pins, sync scroll).
- Unit test (phase 5, root vitest): while `engineWritesEnabled` is false,
  handleScan, tick and composer Save do nothing for an engine-sourced strip or
  message (no submitScan, patchPage or comments.add call), and iframe-sourced
  ones are unaffected.
- Route tests (phase 7a, root vitest):
  - via validation: a malformed via is a 400 at body validation; via 'engine'
    on a resolved chromium browser is a 400 after the closed-round 409, next to
    the not-in-round 400;
  - scans: an engine write against a native row returns `stored: false` and
    leaves result, created_at, scannedAt and counts unchanged; native replaces
    engine; engine replaces engine; after a native scan replaces an engine one
    the row reads via 'native', and a following engine write returns
    `stored: false`;
  - ticks: an engine write keeps a native tick; a native write replaces an
    engine one; any write ticks an unticked box; the PATCH response keeps
    `item` and adds `ticks` with the stored state;
  - tick readers: rounds/[id] and round-pages/[id] return `browserTickVia` next
    to `browserTicks`; sites and sites/[id]/rounds return `ticksNative`;
  - comments and scans readers and the MCP mapping return via; MCP writes
    default to 'native'.
- Manual: Liam on his PC in the web app, one real staging site, both engines,
  375px dashboard layout (switch hidden, Chrome), dark mode.

## 5. MCP parity

No new dashboard capability: the helper is a local display and input device and
every write goes through existing routes the worker MCP already exposes (qa
tools in workers/mcp-server). Phase 7a adds `via` to the qa comment and scan
readers and qa-tools.ts maps it; no new tools, so no tool-profiles change.

## 6. Out of scope

- Real Safari on Windows (it does not exist); the MacBook stays the sign-off.
- Paid cloud real-browser grids (BrowserStack, LambdaTest): real Safari without
  the MacBook at a monthly cost, a separate spend decision if wanted.
- Mobile device emulation (isMobile, touch, device UAs) and real iOS.
- A Chromium engine through the helper.
- Judging animation smoothness or momentum scrolling in engine frames.
- Native pickers, IME, clipboard paste, site Escape handling in engine mode.
- Static full-page capture, video recording, side-by-side engine diffing.
- Tray icon, installer, code signing, auto-update, macOS support, Staci's
  machine (she can pair her own later; nothing is per-person on the server).
- Any change to the qa-view worker's fetching, token format or headers.

## 7. Decisions

Technical defaults (Opus, decided; one line each):
- Node and TypeScript helper in apps/qa-engine: shares types and tests, Playwright's primary binding.
- 127.0.0.1:47615 (API) and 47616 (proxy), fixed, override by env and localStorage.
- WebSocket session plus CORS health and pair endpoints; LNA fallback is the Chrome policy, not another transport.
- Eight-character code exchanged for a 32-byte token; origin and viewer origin pinned at pairing.
- Pages load through qa-view with the existing view token.
- Network guard is a resolve-then-connect refusing proxy with per-launch credentials, with route plus routeWebSocket as the proven fallback.
- Navigation guard is option (ii): no route interception; an off-allowlist main-frame navigation is sent back with page.goto(lastAllowedUrl) and reported, accepting that the off-origin page loads briefly behind the refusing proxy, to keep the HTTP cache.
- Attribution from each observation's source (bus tag, pick capture, run capture, openId), never the live switch.
- Demand-driven JPEG screenshots, ack gated, focus first, with a degrade path.
- deviceScaleFactor follows the dashboard's devicePixelRatio, recreated only on a real monitor change; screenshots at scale 'css'.
- Escape stays in the dashboard and blurs a focused canvas; other keys forwarded with modifiers.
- The helper never calls dashboard APIs.

### 7.1 Engine provenance (option A: the default, Liam can overrule)

This is a QA-process call, not a technical one, so it is Liam's to overrule.
Option A is what gets built unless he says otherwise; the alternatives were (B)
the WebKit engine may scan and comment but never tick Safari, and (C) no
provenance at all. Option A:

Every tick, scan and comment records `via` ('native' or 'engine'), additive
migration 0119 on qa_browser_ticks, qa_scan_results and qa_comments, default
'native'. 0119 ships (phase 7a) before any engine write exists (phase 6d), so
the default only ever stamps rows that really were native. Chromium ticks stay
in the qa_round_pages.vp_* columns and are always native, since there is no
Chromium engine; a write with browser chromium and via 'engine' is a 400.
Rules:
- Ticks, server: qa_browser_ticks upserts with
  `ON CONFLICT DO UPDATE SET ticked = excluded.ticked, via = excluded.via,
  updated_by = excluded.updated_by, updated_at = excluded.updated_at WHERE
  excluded.via = 'native' OR qa_browser_ticks.via = 'engine' OR
  qa_browser_ticks.ticked = 0`. A native write always lands, an engine write
  lands on engine rows and on unticked boxes, and an engine write never changes
  a native tick. The server has no toggle semantics; it stores what it is sent,
  subject to that clause. The PATCH response keeps `item` and adds `ticks`, the
  stored per-viewport state (ticked and via) for that browser, and the client
  settles to it.
- Guard order: a malformed via gets its 400 at body validation; via 'engine' on
  a resolved chromium browser gets its 400 after the closed-round 409, next to
  the not-in-round 400. The same order on the tick, scan and comment routes.
- Ticks, client: in native mode, clicking a box that is ticked by the engine
  sends `ticked: true, via: 'native'` (an upgrade: it stays ticked and changes
  to the native style); a click on a natively ticked box sends `ticked: false`.
  In engine mode a natively ticked box shows ticked in the native style,
  disabled, with the tooltip `Ticked in real ${browserLabel(b)}`; an
  engine-ticked or unticked box toggles as today.
- Scans: qa_scan_results stays unique on (round_page_id, viewport, browser).
  The upsert in app/api/admin/qa/round-pages/[id]/scan/route.ts (today it sets
  only result and createdAt) becomes
  `ON CONFLICT DO UPDATE SET result = excluded.result, created_at =
  excluded.created_at, via = excluded.via WHERE excluded.via = 'native' OR
  qa_scan_results.via = 'engine'`. A native scan always overwrites (and the row
  then reads via 'native'); an engine scan overwrites only an engine scan. A
  skip is detected by `.returning({ id })` coming back empty (or meta.changes
  === 0); the route then returns `{ ok: true, stored: false }` at once, before
  stamping scannedAt and before recomputeCounts, and the UI shows "Kept the real
  Safari scan" (built with browserLabel) and skips the link check. The issues
  panel says which kind of scan it is showing.
- Tick readers return via: lib/qa/browsers.ts gets an additive
  `QaBrowserTickViaMap` (Record<QaViewportKey, QaVia | null>) and
  `mergeBrowserTickVia`; QaBrowserTickMap stays boolean so existing callers
  do not change. The round and round page readers return `browserTickVia` next
  to `browserTicks`; the site list and site rounds readers return `ticksNative`
  next to their tick counts.
- Meaning of 'native': "not from the engine helper". MCP writes and any other
  caller that sends no via are stored as native.
- Comments: stored with `via`; the comments list and report show "WebKit
  engine" (or "Firefox engine") on engine comments.
- Progress: per browser, engine-only ticks are not a sign-off. The ticks counter
  and the report show, for example, "Safari 12/15, 0 native", and the rail dot
  for a page with only engine ticks uses the hollow style. The round is not
  "Safari signed off" until the native count covers the boxes.
- Readers and MCP return `via`.

### 7.2 Deploy procedure (Liam's standing rule: always push for him)

- After each phase's gates pass, Opus pushes to main, watches the "Deploy
  dashboard" workflow and, when workers/qa-view or lib/qa changed, the qa-view
  deploy workflow, both to green.
- Health probe on https://portal.tahi.studio (never dashboard.tahi.studio):
  `/` answers 307 to /sign-in signed out, `/sign-in` 200, `/overview` signed out
  is the branded not-found page with 404; a 500, a Cloudflare error page or a
  plain-text 404 is the alarm. Then one signed-in page, then the /qa workspace.
  Roll back by reverting and pushing.
- Migration 0119 (phase 7a): Opus applies it on production before the push,
  with wrangler d1 execute against tahi-db using the remote flag and the file
  flag; if the file import fails on auth, each statement is run separately
  with the command flag. Verify with `PRAGMA table_info(qa_browser_ticks)`,
  `PRAGMA table_info(qa_scan_results)` and `PRAGMA table_info(qa_comments)`
  showing `via`, record it in the run log, then push. Apply to the seeded local
  D1 too.

Liam's own actions (things only he can do): allow Chrome's Apps on device
prompt, or apply the policy in 1.2 himself. Phase 0 needs about five minutes of
his time, more like 15 if the policy path is needed (registry edit, Chrome
restart, chrome://policy check).

## 8. Phased build order

Gate for every phase (AGENTS.md, fail closed, one && chain): npm run
type-check, npm run lint, the touched vitest files (the full suite before a
merge), npm run build when a page changed; for apps/qa-engine also its own
`npm run check`: tsc, eslint with the package's own config (no-explicit-any as
an error, no-console as an error everywhere except src/log.ts) and vitest
unit. One owner per file per phase. Each phase is reviewed before anything
depends on it.

Ordering: 0, then 1. After 1, 2, 3a and 5 in parallel. 3b needs 3a. 4a needs
2 and 3b; 4b needs 4a. 6a needs 4a and 5; 6b needs 4b and 6a. 7a needs 1 (can
run alongside 3b to 6b). 6c needs 6a, 6b and 7a; 6d needs 6c. 7b needs 6d. 7b
and 6c/6d never run in parallel. 8 last.

Phase 0. Spike (Opus, about half a day; Liam about five minutes, about 15 if
the policy path is needed). Throwaway scripts outside the build. It can fail,
and its result decides the go.
- Chrome: from the portal.tahi.studio devtools console in his Chrome and in the
  installed web app, fetch and WebSocket to a local test server on
  127.0.0.1:47615; record the prompt, the permission names
  navigator.permissions.query accepts, and the result. Then the policy path:
  deny, apply LocalNetworkAccessAllowedForUrls in HKCU, confirm at
  chrome://policy that it works, note the "Managed by your organisation" label.
- Engines: install Playwright Firefox. With five live pages (the real viewport
  sizes) on a heavy Webflow staging page, while wheel-scrolling the focused
  frame for 30 seconds, for Firefox and for WebKit, measure: aggregate fps
  delivered to a dashboard test page, per-frame fps for focused and other
  frames, input-to-visible latency (wheel sent to the frame showing it, via a
  marker element), and createImageBitmap plus draw main-thread time per frame
  in the dashboard.
- Go thresholds: focused frame at least 5 fps, input-to-visible at most 300 ms
  (p90), every other visible frame at least 1 fps, dashboard main-thread cost
  under 8 ms per frame. If missed, retest with the degrade path (focused bursts
  only); if the degrade path also misses, stop and report back with the numbers
  instead of building.
- Also: mouse.wheel triggers the scanner's user scroll report; exposeBinding
  works on a qa-view page; the proxy design (a) with credentials works in
  Firefox (with the prefs) and WebKit on Windows, including WebSockets and
  localtest.me; the framenavigated bounce-back; whether headless pages throttle
  rAF or timers; text sharpness at Actual size; the zoom versus monitor DPR
  heuristic in the web app window.
- Output: the numbers in the appendix, go or no-go, guard design (a) or (b),
  final capture defaults.

Phase 1. Contracts (Opus). lib/qa/engine-protocol.ts (with openId, epoch and
scan-batch-end) with parsers and tests; QaFrameCommand and QaFrameReport moved
into lib/qa/types.ts (round-workspace.tsx switches to the shared type, no
behaviour change); `QaVia = 'native' | 'engine'` in lib/qa/types.ts;
apps/qa-engine added to the root tsconfig, eslint and vitest exclusions the way
apps/recorder-tray is.

Phase 2. Scanner engine channel (sonnet-worker). workers/qa-view/src/scanner/
host.ts (new), scanner/index.ts, scanner tests. Done: iframe behaviour
unchanged in existing tests, engine mode only under the two conditions,
handleCommand shared, bundle builds.

Phase 3a. Helper server and security (sonnet-worker). apps/qa-engine
package.json (ws 8.17.1 or later), package-lock.json (committed), tsconfig.json,
eslint.config.mjs, vitest.config.ts, build.mjs, src/main.ts, src/config.ts,
src/server.ts (health, pair, session, 4401, 4409, takeover), src/security.ts,
src/pairing.ts, src/log.ts, README.md (install, start, pairing, Chrome
permission and policy with the managed-label warning, fidelity limits,
hardening note), scripts start, dev, pair, unpair, check, startup:install,
startup:remove. No Playwright: the session answers welcome with engines
'missing'. Done: unit tests for section 3 points 1 to 5 and 14; `npm run check`
green; package-lock.json committed. security-reviewer reads it before 4a.

Phase 3b. Refusing proxy (sonnet-worker). After 3a. src/proxy.ts (CONNECT and
absolute-form HTTP, resolve then connect to the exact checked address, the
normalising classifier in section 3 point 7, random per-launch credentials,
refusal of the helper's own ports), src/proxy.test.ts. Done: unit tests for
every address class (loopback, RFC 1918, CGNAT, ULA, link-local, 0.0.0.0/8,
multicast, ::ffff: mapped, NAT64, decimal, octal and hex IPv4 literals),
rebinding (a resolver stub that answers public then loopback is refused on the
connect it actually makes), wrong or missing credentials refused, and no
credential in logs. If phase 0 chose fallback (b), this phase builds the
route plus routeWebSocket guard with dns.lookup instead, with the same tests.

Phase 4a. Engines, session, binding (sonnet-worker). Needs 2 and 3b.
src/engines.ts (launch with the proxy and its per-launch credentials, the
Firefox prefs, the WebKit RTCPeerConnection init script, idle close),
src/session.ts (openId on open and navigate, per-page in-flight reset, five
contexts, DPR, framenavigated bounce-back, loaded, visible, pause, dialogs,
popups), src/binding.ts (main frame only, caps, scroll coalescing),
test/fixtures, test/guard.test.ts. Done: section 3 points 6 to 10 and 15
proven by the integration cases, including every case in point 8.

Phase 4b. Capture, input, scan batch (sonnet-worker). src/capture.ts (scheduler,
focus priority, degrade path, frame encoding with epoch, epoch-checked acks),
src/input.ts (mouse, wheel, keys with modifiers, text), src/scan-batch.ts
(engine and openId checks, superseded on a new open, exactly one scan-batch-end
per batch), test/engines.test.ts. Done: the rest of the integration suite in
section 4 passes for Firefox and WebKit on the PC.

Phase 5. Frame handle and bus (sonnet-worker; Opus reviews line by line).
workspace/frame-handle.ts and workspace/frame-bus.ts (new) with tests,
round-workspace.tsx, viewport-strip.tsx, viewport-frame.tsx, scan-all.ts,
comments-helpers.ts. A frame handle `{ post(message), rect(), loaded(),
focused(), browser, via }` replaces the iframe-typed plumbing: framesRef typed
as HTMLIFrameElement and the loadedFrames WeakSet and frameLoaded
(round-workspace.tsx about lines 346 to 349), the postToFrames loop, the rect
reads for composerPlacement and its reposition effect (about 485 and 515), the
`document.activeElement` Escape check (about 459), viewportForSource, and in
viewport-strip.tsx the framesRef prop (about 113) and its own loadedFrames
(about 188). The four message listeners (viewport-strip.tsx scan listener about
267 and scroll relay about 320, round-workspace.tsx comments listener about
505, scan-all.ts about 100) subscribe to the bus instead, which delivers
`(viewport, data, browser, via)`. Iframe transport only. handleScan (including
its readOnly and browserInRound gates) and the composer take the browser from
the bus (1.8).
Phase 5 also adds one predicate, `engineWritesEnabled = false`, exported from
frame-bus.ts. While it is false, handleScan, tick and composer Save do nothing
for engine-sourced strips or messages (via 'engine'): no submitScan, no
patchPage, no comments.add. Iframe-sourced writes are unaffected. Phase 6d flips
it to true. This matters because the scanner scans automatically on load
(scanner/index.ts line 110) and tick() reads activeBrowser, which 6c moves to
the engine, so without the predicate 6c would write engine data before 6d and
7a exist on the client.
Done: no behaviour change in Chromium; existing workspace tests green; the
predicate unit test in section 4; manual check of comments, pins, sync scroll,
Escape ladder and Scan all in Chromium.

Phase 6a. Engine transport and session state (sonnet-worker).
workspace/use-engine-session.ts (reducer: idle, connecting, blocked, combined,
no_helper, unpaired, in_use, missing, mismatch, launching, ready, paused,
crashed), workspace/engine-transport.ts (WebSocket, hello, takeover, a new
openId for every open and navigate, stale openId and epoch dropping, frames in,
acks with epoch, frame handles for the bus), tests for the reducer and
transport. Done: against the real helper, five handles report loaded and
receive frame messages tagged with the engine and the current openId only.

Phase 6b. Engine canvas and input (sonnet-worker). workspace/engine-frame.tsx
(canvas, createImageBitmap, staleness chip, focus ring), input mapping and
coalescing, Escape and Shift+F6 blur, the DPR watcher, viewport-frame.tsx
renders EngineFrame when given an engine handle. Writes from engine frames are
blocked by the phase 5 predicate until 6d. Done: unit tests for coordinate
mapping at every zoom, move and wheel coalescing, key messages with modifiers,
Escape and Shift+F6 blur, and the DPR watcher's zoom versus monitor rule; the
canvas draws a recorded fixture frame in a component test. The manual
interaction check against the real helper is in 6c, where the switch exists.

Phase 6c. Switch, panel states, reducer wiring and the fake helper
(sonnet-worker). workspace/engine-switch.tsx (Windows-only engine options),
workspace/engine-panel.tsx (every state in section 2), round-workspace.tsx
(session reducer wiring, setOverride, connecting guard, load fallback with
toast, single-frame drop with pause), e2e/fixtures/fake-qa-engine.ts (the fake
helper: a WebSocket stub that sends welcome, canned JPEG frames, canned scanner
messages including an automatic qa:scan on load, stale-openId replays and
4409), e2e/qa-engine.spec.ts (panel states). Done: every panel state reachable
against the fake helper and the real one; against the fake helper, an engine
frame's automatic qa:scan, a tick and a Save produce no POST (or PATCH);
manual check against the real helper that hover, click, wheel, keys, sync
scroll, comment pick and pins work in Firefox engine and WebKit engine; dark
mode and 375px checked.

Phase 6d. Writes and the engine scan driver (sonnet-worker). Flips
`engineWritesEnabled` to true. Files: frame-bus.ts (the flip),
round-workspace.tsx (ticks, comments and scans in engine mode with browser and
via from the bus, composer capture and disconnect handling with the draft kept,
stored: false display, settling ticks to the returned state), use-round.ts
(submitScan sends via and returns `stored`, skipping checkLinks when stored is
false, today at about line 244; patchPage sends via and settles to the
returned `ticks`), qa-types.ts (QaPagePatch.via), use-comments.ts
(AddCommentInput.via, sent with the POST), scan-all.ts (engine driver, openId
capture, cancel on drop and on superseded), e2e/qa-engine.spec.ts (the write
cases in section 4). Done: the dashboard e2e in section 4 passes; every engine
write sends via 'engine'.

Phase 7a. Provenance server (sonnet-worker; Opus writes and reviews the
migration and applies it on production per 7.2 before this phase is pushed).
Pushed before 6c. Files:
- drizzle/migrations/0119_qa_via.sql: ALTER TABLE qa_browser_ticks,
  qa_scan_results and qa_comments ADD COLUMN via text NOT NULL DEFAULT 'native'.
- lib/qa-migration.ts: QA_VIA_MIGRATION with the same three statements.
- app/api/admin/db/migrate/route.ts: runner entry name '0119', description
  "Site QA engine provenance: qa_browser_ticks.via, qa_scan_results.via,
  qa_comments.via (ALTER ADD COLUMN; the runner treats "duplicate column name"
  as already applied). Apply BEFORE deploying: db/schema.ts names the
  columns.", statements QA_VIA_MIGRATION, like 0117 and 0118.
- db/schema.ts: `via: text('via').notNull().default('native')` on
  qaBrowserTicks, qaScanResults and qaComments.
- lib/qa/browsers.ts: additive `QaBrowserTickViaMap` and `mergeBrowserTickVia`
  (QaBrowserTickMap stays boolean), with unit tests.
- app/api/admin/qa/round-pages/[id]/route.ts: tick PATCH accepts and validates
  via (guard order in 7.1), the conditional tick upsert in 7.1, the response
  keeps `item` and adds `ticks`; its GET selects via and returns
  `browserTickVia` next to `browserTicks`.
- app/api/admin/qa/rounds/[id]/route.ts (the tick query at about lines 63 to
  74): select via and return `browserTickVia` next to `browserTicks`.
- app/api/admin/qa/sites/route.ts (the tick counts at about lines 85 to 105) and
  app/api/admin/qa/sites/[id]/rounds/route.ts: also return `ticksNative`.
- app/api/admin/qa/round-pages/[id]/scan/route.ts: accept and validate via; the
  upsert `ON CONFLICT DO UPDATE SET result = excluded.result, created_at =
  excluded.created_at, via = excluded.via WHERE excluded.via = 'native' OR
  qa_scan_results.via = 'engine'` with `.returning({ id })` (or meta.changes);
  on a skip return `{ ok: true, stored: false }` before stamping scannedAt and
  before recomputeCounts; otherwise `stored: true` as part of today's response.
- The comments POST route (accept and validate via), the comment, scan and
  report readers (return via), and the workers/mcp-server qa-tools.ts mapping
  (return via; MCP writes send no via and are stored as native).
- Route tests for every case in section 4's route list.
Done: the routes accept via and default to 'native' when it is absent (so the
current client and MCP keep working), and follow the guard order in 7.1.

Phase 7b. Provenance UI (sonnet-worker). After 6d, never in parallel with 6c or
6d (same files). page-rail.tsx (hollow dot for engine-only ticks), the ticks
counter and the checkbox styles in round-workspace.tsx and viewport-frame.tsx
(native versus engine style, the disabled native box and its tooltip, the
upgrade click), comments-tab.tsx, the report (report-content.tsx) engine labels
and "Safari 12/15, 0 native" style counts, and qa-sites-content.tsx (the site
list's tick progress using `ticksNative`). Done: dark mode and 375px checked;
the label rules in 7.1 visible end to end.

Phase 8. Verify and document. qa-tester runs section 4 plus exploratory testing
on the PC; security-reviewer signs off section 3; ui-ux-auditor does a light
pass on the switch and panel at 1920 wide, Wide mode and dark mode; Opus
updates AGENTS.md (a Site QA engine helper bullet with the security,
attribution and provenance rules, saying that via 'native' means "not from the
engine helper" and that MCP writes default to native), STATUS.md, TASKS.md
(SQA.4 items plus the recurring Playwright bump), DECISIONS.md (the helper
architecture); opus-reviewer gives the final fresh-context sign-off against
Liam's original request; Liam's live smoke on a client staging site.

Rough size: phases 2, 3a, 3b, 5, 7a and 7b are about a session each; 4a, 4b,
6a, 6b, 6c and 6d are a session each; about twelve sonnet sessions plus the
Opus spike, contracts, migration, reviews and integration.

## Appendix: phase 0 measurements

To be filled by the spike.

## Changelog

Revision 2, 2026-10-27, after the fresh Opus review:
- Attribution now comes from each observation's source: the bus tags browser
  per message, the composer captures it at pick, Scan all captures it at start,
  disconnect keeps the draft under the captured engine; new e2e cases (P1-1).
- The Liam deploy decision is replaced by the standing push procedure, health
  probe on portal.tahi.studio, and Opus applying 0119 on production with PRAGMA
  checks (P1-2). dashboard.tahi.studio removed as an allowed origin.
- Network guard is a resolve-then-connect refusing proxy with Firefox prefs and
  WebRTC off, route plus routeWebSocket as fallback, no weaker downgrade, new
  rebinding and WebSocket integration cases (P2-1).
- LNA fallback is the Chrome policy, with permission-based detection of blocked
  versus not running (P2-2).
- Phase 0 has five-page concurrent measurements, go thresholds, a degrade path
  and throttling checks, and can stop the build (P2-3).
- deviceScaleFactor follows devicePixelRatio (P2-4).
- Option A provenance rules: native upgrade, no engine downgrade, scan upsert
  rule, native counts in progress (P2-5).
- Keyboard modifiers; Escape blurs a focused canvas; Shift+F6 (P2-6).
- 4409 for a second tab with Use here (P2-7). Engine Scan all cancels on drop
  (P2-8). Hardening note and scheduled Playwright bumps (P2-9).
- Phase 5 introduces a frame handle and names the iframe-typed code and the four
  listeners it replaces (P2-10).
- Phase 4 split into 4a and 4b, phase 6 into 6a, 6b and 6c, parallelism noted
  (P3-1). Dev fixture carve-out (P3-2). Load with helper down falls back with a
  toast (P3-3). Single-frame drops to Your browser (P3-4). QaFrameCommand moved
  into lib/qa/types.ts in phase 1 (P3-5). ws 8.17.1 and maxPayload, both token
  forms redacted, dialogs dismissed, fidelity limits (P3-6). Closed-round
  sentence fixed (P3-7). Scanner trust wording corrected.

Revision 3, 2026-10-27, after the second fresh Opus review:
- Phase 7 split: 7a provenance server (0119 applied by Opus, db/schema.ts via
  columns, lib/qa-migration.ts QA_VIA_MIGRATION, migrate runner entry '0119'
  with "Apply BEFORE deploying", routes validate via, conditional upserts,
  readers and MCP return via, route tests) ships before 6c; 7b provenance UI
  after 6d. New ordering paragraph. 6d Done: every engine write sends via
  'engine' (P1-1, P3-3).
- openId per open, echoed on every open-scoped message and as the frame
  header's epoch byte; stale openIds dropped; scan-batch carries engine and
  openId and ends with scan-batch-end ('superseded' on a new open); new e2e for
  a Firefox to WebKit switch with a pick open and Scan all running (P2-1).
- Navigation guard decided as option (ii): framenavigated bounce-back with
  page.goto(lastAllowedUrl), no route interception, brief off-origin load stated
  (section 3 point 6 and section 7) (P2-2).
- Tick upsert WHERE clause, client-side native upgrade, PATCH returns the
  stored tick state (P2-4). handleScan gates use the message's browser (P3-1).
  Skipped engine scans return stored: false and show "Kept the real Safari
  scan", with a route test (P3-2). Tooltip uses browserLabel (P3-4).
- DPR contexts recreated only on a real monitor change, zoom ignored (P3-5).
  qa:scroll coalesced under the rate cap (P3-6). Proxy classifier normalises
  mapped, 0.0.0.0/8, NAT64 and odd IPv4 literals; per-launch proxy credentials
  (P3-7). apps/qa-engine eslint config in npm run check (P3-8).
- 6c split into 6c (switch, panel, reducer wiring) and 6d (writes, engine scan
  driver, e2e) (P3-9). Single-frame sends pause, keeps the session (P3-10).
  Chrome policy "Managed by your organisation" warning; Liam's phase 0 time is
  about 15 minutes if the policy is needed (P3-11). Option A marked as a
  default Liam can overrule (P3-12).

Revision 4, 2026-10-27, after the third fresh Opus review:
- P2-1: the scan upsert sets result, created_at and via under the WHERE clause
  (7.1 Scans and the 7a scan/route.ts bullet); new route tests for native
  replacing engine then a stored: false engine write.
- P2-2: phase 5 adds `engineWritesEnabled = false` in frame-bus.ts, unit
  tested; 6d flips it; 6b and 6c state the block and its Done check.
- P2-3: tick readers return via (QaBrowserTickViaMap, mergeBrowserTickVia,
  browserTickVia on the round and round page readers, ticksNative on the site
  readers, route tests); qa-sites-content.tsx added to 7b.
- P3: stored: false detected by returning or meta.changes, returned before
  scannedAt and recomputeCounts, checkLinks skipped; in-flight reset on open and
  navigate with epoch on ack; navigate allocates an openId; 6d file list names
  use-round.ts, qa-types.ts and use-comments.ts; the manual engine check and the
  fake helper move to 6c; via guard order and `item` plus `ticks`; the proxy is
  its own phase 3b; package-lock.json committed in 3a; engine options Windows
  only; the AGENTS.md bullet defines 'native' and the MCP default.
