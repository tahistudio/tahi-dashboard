#!/usr/bin/env node
/*
 * design-capture.mjs — headless screenshotter for the Claude Design project's
 * "Tahi App Shell.html" (app-mount.jsx + app-shell.jsx + the per-surface bundles).
 *
 * SHELL MECHANICS (read from app-shell.jsx / app-mount.jsx / Tahi App Shell.html
 * on 2026-09-13 — re-check this comment against the live files if captures start
 * failing, the shell is hand-edited often):
 *
 * 1. Initial destination. The HTML has an inline script that unconditionally runs
 *    `window.__TAHI_INITIAL = 'requests'` before app-shell.jsx and the other
 *    text/babel bundles load. app-mount.jsx reads it exactly once, at mount, into
 *    `initialActive`, which becomes the shell's `active` (page) state. Because the
 *    HTML's own inline script always wins a plain reassignment, this script locks
 *    the value first with `Object.defineProperty(window, '__TAHI_INITIAL', {
 *    writable:false })` inside `page.addInitScript` — the inline script's later
 *    `window.__TAHI_INITIAL = 'requests'` then silently no-ops (non-strict sloppy
 *    mode assignment to a non-writable data property). We lock it to 'overview',
 *    a destination valid for every audience, purely as a stable baseline — see
 *    point 2 for why you cannot use this lock to jump straight to an arbitrary
 *    destination.
 *
 * 2. On mount (and again whenever the audience or the Tweaks "Home state" changes),
 *    an effect validates `active` against the current audience's nav groups:
 *    `ok = active === 'settings' || groups.some(g => g.items.some(it => it.id ===
 *    active))`. If `active` fails that check it snaps back to the first nav item.
 *    Since the shell always mounts with audience 'owner', locking __TAHI_INITIAL to
 *    anything that is not valid for 'owner' gets silently reset before you can even
 *    switch audience. So __TAHI_INITIAL is not a general "go to any destination"
 *    hook — real navigation happens after mount, through the UI (see point 4).
 *
 * 3. Audience / rail / theme / device are plain React state with hardcoded
 *    defaults (owner / expanded / light / desktop). None of them are read from a
 *    URL param, a window global, or localStorage — the real app's `tahi-theme`
 *    localStorage key and `.dark` class do not exist in this prototype. The only
 *    way to change them is the "Tweaks" pill fixed to the bottom-right corner:
 *    collapsed it is `.tw-pill`; open it is `.tweaks`, containing one `.tw-group`
 *    per setting with a `<label>` (exact text: "Audience", "Rail", "Theme",
 *    "Device", "View as client", "Client branding", "Announcement", "Demo state",
 *    "Home state", "Client type") and a `.tw-seg` of buttons whose text is the
 *    exact option label ("Owner"/"Teammate"/"Client", "Light"/"Dark",
 *    "Desktop"/"Mobile", etc). Click the pill, click the matching option button,
 *    `.tw-close` collapses it again. `data-theme="light"|"dark"` lands on the
 *    shell's root `.ash`/`.ash-bare` element.
 *
 * 4. Destinations. Rather than fight the Sidebar (desktop) vs MobileTabs/MoreSheet
 *    (mobile) DOM, which differ by device, this script drives every ordinary
 *    destination through the command palette: Ctrl+K (the shell checks
 *    `e.metaKey || e.ctrlKey`, so Ctrl+K works cross-platform) opens `.cmd-overlay`
 *    with an autofocused `.cmd-input input`; typing the destination's exact nav
 *    label and pressing Enter always opens the first result, which — because the
 *    palette's own ranking gives an exact/prefix label match rank 0 — is reliably
 *    the destination you typed, even though the palette also indexes Settings
 *    sub-pages (Account, Appearance, ...) whose *crumb* is "Settings" and would
 *    otherwise collide with a literal "Settings" search. "Settings" itself is
 *    always in the palette index regardless of audience or nav visibility.
 *    A destination is only reachable this way if it is present in the CURRENT
 *    audience's nav groups (see NAV_MAP below) or is the universal 'settings'.
 *    'welcome' (client-only) is not normally indexed, but setting the Tweaks
 *    "Home state" to "First-run" adds a "Get started" nav item (and palette
 *    entry) for the client audience, which then opens it normally.
 *
 * 5. The three "viewer stage" ids — view-proposal, view-contract, view-schedule —
 *    are bare, chrome-less pages (no rail, no top bar) and are NEVER added to the
 *    command palette index under any Tweaks combination. app-mount.jsx's comment
 *    explains why: they are the token-link pages a client opens from an email, and
 *    inside the shell they are only reachable by opening a specific proposal /
 *    contract / schedule from its list into its editor, then clicking a "preview"
 *    button there (`onPreview` calls `ctx.go('view-<kind>')`). The editor's list
 *    row is only reliably clickable through its mobile card markup
 *    (`button.sa-mc-hit[aria-label^="Open "]`) — the desktop `<Table>` row has no
 *    comparably stable selector in this codebase — so this script temporarily
 *    flips the Tweaks Device to Mobile to open the document, clicks the preview
 *    button (exact text "Full preview" for proposals, "Preview" for contracts and
 *    schedules), and then restores whatever Device was actually requested. Since
 *    switching Device does not change the audience/home nav groups, the point-2
 *    validity effect never re-fires and the viewer stage id sticks.
 *
 * USAGE
 *   node scripts/design-capture.mjs \
 *     --url "<short-lived serve_url from render_preview, NEVER hardcode/commit this>" \
 *     --audience owner|teammate|client \
 *     --dest <nav id, see NAV_MAP below, or view-proposal|view-contract|view-schedule> \
 *     --device desktop|phone \
 *     --theme light|dark \
 *     [--out path/to/file.png]
 *
 *   Default --out is .qa-screens/design/<audience>-<dest>-<device>-<theme>.png
 *
 * SECURITY: --url is a token-bearing link. Never hardcode a default for it here,
 * never log it, never write it to a file. Callers must pass their own each run.
 */

import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const NAV_MAP = {
  owner: {
    overview: 'Overview', requests: 'Requests', tasks: 'Tasks', messages: 'Messages', notifications: 'Notifications',
    leads: 'Leads', calls: 'Calls', deals: 'Deals', proposals: 'Proposals', schedules: 'Schedules', contracts: 'Contracts',
    'artifact-templates': 'Templates', calculator: 'Calculator', 'sales-analytics': 'Sales analytics', affiliates: 'Affiliates',
    clients: 'Clients', files: 'Files',
    'content-studio': 'Content studio', sitemap: 'Sitemap', social: 'Social', reviews: 'Reviews', announcements: 'Announcements',
    invoices: 'Invoices', billing: 'Billing', time: 'Time', 'financial-reports': 'Financial reports', reports: 'Reports',
    capacity: 'Capacity', tracks: 'Tracks', automations: 'Automations', team: 'Team',
    docs: 'Docs Hub',
    settings: 'Settings'
  },
  teammate: {
    overview: 'Overview', requests: 'Requests', tasks: 'Tasks', messages: 'Messages', notifications: 'Notifications',
    docs: 'Docs Hub',
    settings: 'Settings'
  },
  client: {
    overview: 'Overview', requests: 'Requests', tracks: 'Your tracks', schedules: 'Schedule', notifications: 'Notifications', messages: 'Messages',
    files: 'Files', services: 'Services',
    invoices: 'Invoices', proposals: 'Proposals', contracts: 'Contracts',
    account: 'Account',
    settings: 'Settings',
    welcome: 'Get started'
  }
};

const VIEWER_STAGES = {
  'view-proposal': { list: 'proposals', previewText: 'Full preview' },
  'view-contract': { list: 'contracts', previewText: 'Preview' },
  'view-schedule': { list: 'schedules', previewText: 'Preview' }
};

const DEVICE_MAP = {
  desktop: { viewport: { width: 1440, height: 900 }, tweak: 'Desktop' },
  phone: { viewport: { width: 375, height: 812 }, tweak: 'Mobile' }
};

function printHelp() {
  console.log(`design-capture.mjs — screenshot the Tahi App Shell design preview

Required:
  --url <serve_url>       short-lived render_preview URL for "Tahi App Shell.html"
                          (never hardcode this, never commit it)
  --audience <a>          owner | teammate | client
  --dest <id>             a nav id valid for --audience, or settings, or one of
                          view-proposal | view-contract | view-schedule
  --device <d>            desktop (1440x900) | phone (375x812)
  --theme <t>             light | dark

Optional:
  --out <path>            default: .qa-screens/design/<audience>-<dest>-<device>-<theme>.png
  --help                  show this text

Destination ids per audience:
  owner:    ${Object.keys(NAV_MAP.owner).join(', ')}
  teammate: ${Object.keys(NAV_MAP.teammate).join(', ')}
  client:   ${Object.keys(NAV_MAP.client).join(', ')}
  (any audience also accepts: view-proposal, view-contract, view-schedule,
   provided --dest's underlying list (proposals/contracts/schedules) exists
   for that audience)
`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const val = argv[i + 1];
      out[key] = val;
      i++;
    }
  }
  return out;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function exact(text) {
  return new RegExp('^' + escapeRegExp(text) + '$');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { printHelp(); return; }

  const { url, audience, dest, device, theme } = args;
  const missing = ['url', 'audience', 'dest', 'device', 'theme'].filter((k) => !args[k]);
  if (missing.length) {
    console.error(`Missing required arg(s): ${missing.join(', ')}\n`);
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (!NAV_MAP[audience]) {
    console.error(`Unknown --audience "${audience}". Must be one of: owner, teammate, client.`);
    process.exitCode = 1;
    return;
  }
  if (!DEVICE_MAP[device]) {
    console.error(`Unknown --device "${device}". Must be one of: desktop, phone.`);
    process.exitCode = 1;
    return;
  }
  if (theme !== 'light' && theme !== 'dark') {
    console.error(`Unknown --theme "${theme}". Must be one of: light, dark.`);
    process.exitCode = 1;
    return;
  }

  const isViewerStage = Object.prototype.hasOwnProperty.call(VIEWER_STAGES, dest);
  const isWelcome = dest === 'welcome';
  if (isWelcome && audience !== 'client') {
    console.error(`--dest welcome only exists for --audience client.`);
    process.exitCode = 1;
    return;
  }
  if (isViewerStage) {
    const listId = VIEWER_STAGES[dest].list;
    if (!NAV_MAP[audience][listId]) {
      console.error(`--dest ${dest} needs the "${listId}" nav item, which does not exist for audience "${audience}".`);
      process.exitCode = 1;
      return;
    }
  } else if (!isWelcome && !NAV_MAP[audience][dest]) {
    console.error(`--dest "${dest}" is not a nav id for audience "${audience}".\nValid ids: ${Object.keys(NAV_MAP[audience]).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const outPath = args.out || path.join('.qa-screens', 'design', `${audience}-${dest}-${device}-${theme}.png`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: DEVICE_MAP[device].viewport });
  const page = await context.newPage();

  // Lock the initial destination to a universally-valid baseline before any
  // page script runs — see mechanics note 1/2 above for why this can't jump
  // straight to an arbitrary destination.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, '__TAHI_INITIAL', { value: 'overview', writable: false, configurable: false });
    } catch (e) { /* ignore */ }
  });

  await page.goto(url, { waitUntil: 'load', timeout: 45000 });
  await page.waitForSelector('.tw-pill', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(500);

  async function openTweaks() {
    const visible = await page.locator('.tweaks').isVisible().catch(() => false);
    if (!visible) {
      await page.locator('.tw-pill').click();
      await page.locator('.tweaks').waitFor({ state: 'visible', timeout: 5000 });
    }
  }

  async function closeTweaks() {
    const visible = await page.locator('.tweaks').isVisible().catch(() => false);
    if (visible) {
      await page.locator('.tw-close').click();
      await page.locator('.tweaks').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    }
  }

  async function setTweak(groupLabel, optionLabel) {
    await openTweaks();
    const group = page.locator('.tw-group').filter({ has: page.locator('label', { hasText: exact(groupLabel) }) });
    await group.locator('.tw-seg button', { hasText: exact(optionLabel) }).click();
    await page.waitForTimeout(200);
  }

  async function goToDestination(label) {
    await page.keyboard.press('Control+k');
    const input = page.locator('.cmd-input input');
    await input.waitFor({ state: 'visible', timeout: 5000 });
    await input.fill(label);
    await page.waitForTimeout(350);
    await page.keyboard.press('Enter');
    await page.locator('.cmd-overlay').waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(300);
  }

  if (audience !== 'owner') {
    await setTweak('Audience', audience === 'teammate' ? 'Teammate' : 'Client');
  }
  if (theme !== 'light') {
    await setTweak('Theme', 'Dark');
  }
  const wantsMobileTweak = DEVICE_MAP[device].tweak === 'Mobile';
  if (wantsMobileTweak) {
    await setTweak('Device', 'Mobile');
  }
  await closeTweaks();

  if (isViewerStage) {
    const { list, previewText } = VIEWER_STAGES[dest];
    const listLabel = NAV_MAP[audience][list];
    if (!wantsMobileTweak) {
      await setTweak('Device', 'Mobile');
      await closeTweaks();
    }
    await goToDestination(listLabel);
    await page.waitForSelector('.sa-mc, button[aria-label^="Open "]', { timeout: 15000 });
    const openBtn = page.getByRole('button', { name: /^Open /}).first();
    await openBtn.waitFor({ state: 'visible', timeout: 15000 });
    await openBtn.click();
    await page.waitForTimeout(400);
    const previewBtn = page.getByRole('button', { name: previewText, exact: true }).first();
    await previewBtn.waitFor({ state: 'visible', timeout: 15000 });
    await previewBtn.click();
    await page.waitForTimeout(400);
    if (!wantsMobileTweak) {
      await setTweak('Device', 'Desktop');
      await closeTweaks();
    }
  } else if (isWelcome) {
    await setTweak('Home state', 'First-run');
    await closeTweaks();
    await goToDestination('Get started');
  } else {
    await goToDestination(NAV_MAP[audience][dest]);
  }

  await page.waitForTimeout(400);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
