# Port plan: portal-files (the client file library, /files)

Written 2026-09-26. Status of the design: critic FIX after one revision, not reviewed by Liam, so everything below ships as "ported, unchecked". Nothing here is committed.

- Route: `/files` (client only; a Tahi admin reaches it only through Client View on one org, which is today's behaviour and stays). Data route: `GET /api/portal/files`.
- Audience: client (any portal seat, member or admin; Files has no `requiresOrgAdmin` gate).
- Design files read (Claude Design project 57bf60cf-5e6d-450f-9e2f-e25c8d12fd66): `portal-files.jsx`, `portal-files-kit.jsx`, `portal-files-data.jsx`, `portal-files.css`. Design fetched: yes.
- Other sources: the portal-files section of `docs/superpowers/plans/2026-09-14-design-review-for-liam.md`, `docs/superpowers/design/requirements/client-files.md`, `docs/superpowers/design/DESIGN-BRIEF-2026-09-13.md`, TASKS.md CL.1 (the open files item), and the live code: `app/(dashboard)/files/page.tsx`, `app/(dashboard)/files/files-content.tsx`, `app/api/portal/files/route.ts`, `app/api/uploads/{presign,proxy,confirm,serve,[fileId]}/route.ts`, `lib/upload-access.ts`, `db/schema.ts` (files table), and the primitives in `components/tahi` (rail, kpi-strip, skeletons, slide-over, data-table, menu, empty-state, callout, confirm-dialog, view-toggle, file-attachment-list, portal-status-badge, impersonation-banner).
- Page keys: library, folder, search, file, file-versions, file-details, drop, uploading, upload-failed, new-folder, rename, move, delete, loading, empty, empty-folder, no-match, error, stale, client-view.
- Backend: yes, small and additive (new fields plus a library summary on `GET /api/portal/files`). Migration: none. The design's real folders, per file notes and versions all need a migration and a Liam answer, so they are skipped (section 5).

## The one idea that makes this port honest without a migration

The `files` table has no `folderId`, no version table, and `messages` has no file target. The design's standing folders (Deliverables, Brand, References, Uploads, plus client made ones), its Notes thread and its Versions tab therefore cannot be real yet. What the table does carry is `requestId`, and the design itself says "Per request folders are created under Deliverables when a request gets its first file". So the port builds folders that are derived from real data only:

- All files: every file the client can see.
- Request folders: one folder per request that has files (the request's `#042` reference and title, from `lib/blockers.ts` `requestRef`, never `TR-1047`), opened as folder cards and then as a breadcrumbed folder.
- Not on a request: files with no `requestId` (brand assets and references a client uploaded from this page, studio shares that were not on a request).

Brand, References, Uploads, client made folders, New folder and Move wait for Liam's folder-name answer and a `folderId` migration. The group is named "Request folders", not "Deliverables", because the standing folder names are still Liam's question 2; renaming the label is a one line change once he answers.

## 1. What the live code already matches (no work)

- Auth and routing: `page.tsx` redirects signed-out users to /sign-in and a Tahi admin who is not previewing to /requests, and lets Client View in. The design's StudioNote empty state for a studio viewer is not needed; the redirect stays.
- Tenancy and honesty on the data route: org scoping, the 403 for the Tahi org, the `files` feature gate (`requirePortalFeature`), and the exclusion of files on internal requests and internal messages.
- The stale state, exactly: a failed revalidation over a good list shows the warning Callout "This list may be out of date" with Refresh and keeps the list (SWR keeps the last payload). The design copied this pattern from live.
- The error state with Try again that only takes over when there is no list at all.
- The empty state copy: the design adopted the live wording ("No files yet", "Delivered work shows up here. You can also upload brand assets and references for the team.") with an Upload files action.
- Uploads under Client View stay on and land under the previewed org (`impersonatedOrgId` passed to presign and confirm). The design's revision agrees (requirement question 1 answered the live way).
- Delete: live already lets a client delete a file their own org uploaded that is not a message attachment (`deletable` from the route, `DELETE /api/uploads/[fileId]`), with a ConfirmDialog and optimistic removal plus rollback, and disables it in read-only Client View (`previewIsReadOnly`). The design's delete gate ("Studio file" cannot be deleted, read only in Client View) is the same rule.
- Tokens only (`var(--color-*)`), `data-private` on file names for private mode, 44px targets on the live mobile card, the `DataTable` `mobileCard` pattern below 768px.
- No storage quota, no "New" badge, no seen dot: the design revision already removed all three.

## 2. What differs, page key by page key

**library**
- Live: PageHeader plus one Upload button, then a flat `DataTable` (File, Type, Shared by, Added, Get, Delete). No band, no rail, no search, no filters, no sort control, no grid.
- Design: PageHeader with New folder and Upload files; the shared headline band with four cells (In your library with total size, From the studio, Shared by you, Added this week); the one shared 14.5rem rail (Folders, Filters for Type and Shared by, Sort with direction, a "Contracts live on their own page" foot link); a toolbar of search, count and a grid or list toggle; root folder cards; a grid of file cards with a kebab. Cards carry a version pill and a comment count pill (critic FIX).
- Port: PageHeader (live subtitle) with Upload files only. Band = `KPIStrip` with four `KPICell`s fed by a server summary (the live app's band primitive, as on /team, /deals, /capacity). Rail = `RailLayout` plus a new `FilesRail` built from `RailViewItem`, `RailSelect`, `RailGroupLabel` (the Notifications and Requests rail idiom). Folder section holds the three derived folders above. No Contracts foot link: `/contracts` redirects a client to /requests, so the link would bounce. Grid view by default from 48rem up, list forced below. No version pill and no comment pill anywhere.

**folder**
- Live: no folders.
- Design: breadcrumb All files, Deliverables, TR-1047; list view with a NOTES column counting comments (critic FIX).
- Port: Request folders shows one folder card per request; opening one shows its files under a breadcrumb "All files, Request folders, #042 Title" built from buttons (the shared `Breadcrumb` is link only with small targets). List view has no Notes column.

**search**
- Live: none.
- Design: searches every folder, "2 of 19 files", pills on results (critic FIX).
- Port: the `RailLayout` search box, case-insensitive on the file name over the loaded list, ignoring the open folder while a query is set, with a quiet line "Searching all your files for palette." The count is the RailLayout count row. No pills.

**file**
- Live: none; a row is only a download link.
- Design: a slide-over with a preview stage, tabs Notes (a full sample comment thread), Versions and Details with count badges, and a footer of Download, Share to a request, and a kebab (Rename, Move, Delete) (critic FIX).
- Port: the shared `SlideOver` (full width on a phone rather than the design's bottom sheet; the existing primitive wins). One body, no tab strip: the preview stage and the Details list. Footer: Download, and Delete when the file is deletable. No Notes, no Versions, no Share to a request, no Rename, no Move.

**file-versions**: skipped (no version data; see section 5).

**file-details**
- Design: the honest Details body, but under the tab strip with "Notes 3" and "Versions 3" badges (critic FIX).
- Port: Details is the whole drawer body, so the badges cannot appear. Fields: Type, Size, Added (full New Zealand date), Shared by, Folder (the request link or "Not on a request"), Visible to ("Your team and Tahi Studio", true for every listed file), and for a request file a link to `/requests/[id]` with the reference, title and `PortalStatusBadge`.

**drop**
- Live: no drag and drop.
- Design: a dashed veil over the content, "Drop to upload into {folder}".
- Port: a `FileDropZone` that only reacts to drags carrying files. Label "Drop to upload to your library", or "Drop to add to #042 Title" inside a request folder, where the upload is attached to that request.

**uploading**
- Live: the Upload button goes into a loading state for the whole batch; no per file progress, no cancel.
- Design: a bottom-right tray, one row per file with a percent meter, cancel per row, "N of M added".
- Port: the tray with real progress (XMLHttpRequest upload progress on the proxy PUT), cancel while waiting or uploading, a "Finishing" step while the Worker writes to R2 and confirm runs.

**upload-failed**
- Live: a toast per failed file.
- Design: the failed row stays in the tray with the reason and Retry; no size cap state (the revision removed the 500 MB hard fail).
- Port: same as the design. No size cap anywhere.

**new-folder, rename, move**: skipped (section 5).

**delete**
- Live: exists (see section 1); copy "Delete {name}?" / "This cannot be undone." / Delete.
- Design: same dialog shape with warmer copy.
- Port: keep the live flow and gate; switch to the design copy: title "Delete {name}?", description "It leaves your library and the studio's view of it. We cannot put it back for you.", confirm "Delete file", cancel "Keep it". Reachable from the grid card menu, the list row actions and the drawer footer.

**loading**
- Live: the DataTable skeleton.
- Design: a band skeleton plus a skeleton grid or skeleton rows matching the view; the rail and toolbar stand down.
- Port: `SkeletonKPIStrip` (4 cells) plus skeleton cards (grid) or the DataTable skeleton (list); no rail while there is no data.

**empty**: copy already matches (section 1). Port change: rendered without the band and rail (nothing real to count), inside the same page frame.

**empty-folder**
- Design: "Nothing in here yet" / "Drop a file here, or use Upload files. We see it as soon as it lands."
- Port: that copy for Not on a request, and for a request folder emptied by a delete: "Drop a file here, or use Upload files. It is added to this request and we see it as soon as it lands."

**no-match**
- Port: "No files match" / "Try a different word, or clear the filters and start again." with a Clear filters action.

**error**
- Port: keep the live behaviour; take the design copy: "We could not load your files" / "Something went wrong reaching your library. Nothing is lost, it is just not showing right now." with Try again.

**stale**: matches live (section 1). Kept above the band.

**client-view**
- Live: uploads on, delete disabled in view mode; only the global impersonation strip, which says the preview is read only.
- Design: an info Callout saying uploads still work.
- Port: add the info Callout only when `previewIsReadOnly` (view mode), because that is when this page does something the global strip says it will not: title "You are viewing {impersonatedOrgName} as a client", body "Uploads still work and land in their library, which is how this page has always behaved. Deleting is off." Act mode shows no callout (writes are real there anyway).

## 3. Critic FIX items, and where each is resolved

1. library: version and comment count pills on grid cards. Resolved in slice files-page: the FileCard has no pill slot at all; versions and notes are skipped proposals.
2. folder: the NOTES column. Resolved in slice files-page: list columns are File, Type, Shared by, Added, Size, actions.
3. search: the same pills on result cards. Resolved by 1 (results are the same FileCard).
4. file: the fabricated Notes thread and the "Notes 3" / "Versions 3" tab badges. Resolved in slice files-page: the drawer has no tabs and no Notes.
5. file-versions: fabricated version history. Resolved by skipping the page key.
6. file-details: the tab strip badges above an honest body. Resolved by 4.

The critic's positive checks (shared band, one 14.5rem rail, no horizontal filter toolbar, 44px phone targets, no storage quota) are kept by building on `KPIStrip` and `RailLayout`.

## 4. Slices

Three slices with disjoint files. files-route and files-uploads can run in parallel; files-page needs both merged first.

### Slice files-route: portal files route, fields and an honest summary (0.75 day, backend, no migration)

Owned: `app/api/portal/files/route.ts`, `lib/portal-files.ts` (new), `lib/__tests__/portal-files.test.ts` (new).

Brief:
- Why: the page needs size, date, kind, uploader side and the request a file sits on, and the band must count the whole library, not one loaded page. Figures follow `stats()` in `portal-files-data.jsx` and the band on page key `library` in `portal-files.jsx`.
- Create `lib/portal-files.ts` (pure, no DB imports, so `route.ts` keeps exporting only `GET` and `dynamic`; `next build` rejects other exports from a route file):
  - `type PortalFileKind = 'image' | 'video' | 'audio' | 'pdf' | 'doc' | 'sheet' | 'zip' | 'design' | 'other'` and `portalFileKind(filename, mimeType)`: extension first, then MIME (`fig` is design; `csv`, `xls`, `xlsx`, `numbers` are sheet; `doc`, `docx`, `txt`, `rtf`, `pages`, `md` are doc; `zip`, `rar`, `7z`, `tar`, `gz` are zip; `image/*`, `video/*`, `audio/*` by prefix; `application/pdf` is pdf).
  - Move `rel()` here as `relativeAgo(iso, now)` and `fileType()` as `fileTypeChip(filename, mimeType)` (same outputs as today, so the overview Recent files card reads the same).
  - `interface PortalFile`: every field the route returns today (`id`, `name`, `type`, `uploadedBy`, `ago`, `url`, `deletable`) plus `kind`, `side: 'studio' | 'client'` (from `uploadedByType`), `createdAt` (ISO), `sizeBytes: number | null`, `mimeType: string | null`, `requestId`, `requestRef`, `requestTitle`, `requestStatus` (all `string | null`).
  - `interface PortalFilesSummary { count, bytes, knownSizeCount, studio, client, addedThisWeek, newestAgo: string | null, onRequests, notOnRequest, requestFolders }` and `summarisePortalFiles(rows, now)` over `{ sizeBytes, uploadedByType, createdAt, requestId }[]`: bytes sums known sizes only, knownSizeCount says how many had one, addedThisWeek is createdAt within 7 days of now, requestFolders is the number of distinct requestIds.
  - `interface PortalFilesResponse { items: PortalFile[]; total?: number; summary?: PortalFilesSummary }`.
- Route changes: add `files.requestId`, `files.sizeBytes`, `requests.title`, `requests.requestNumber`, `requests.status` to the existing select (the requests left join is already there). Map the new fields. Fix the two uploader fallbacks: a team member whose name did not resolve reads "Tahi Studio" (today "Your team", which a client reads as their own people) and a contact reads "Your team" (today "You").
- New `?summary=1` mode for the /files browser: one query over all of the org's files (no `.limit`), internals filtered in JS as today, `summary = summarisePortalFiles(visible, now)`, `total = visible.length`, `items = visible.slice(0, limit)` where the ceiling in this mode is 500 (a named constant). Without `summary=1` the route behaves exactly as today (default 8, ceiling 100, 4x overfetch): `components/tahi/overview/homes/client-home.tsx` and `e2e/tenancy-isolation.spec.ts` call it that way.
- Keep `getPortalAuth`, `requirePortalFeature(..., 'files')`, the Tahi org 403, `eq(files.orgId, orgId)` and the internal filter untouched. Do not touch presign, proxy, confirm, serve or `[fileId]`.
- Tests (`lib/__tests__/portal-files.test.ts`, vitest node env): `portalFileKind` for `.fig`, `.pdf`, a PNG with no extension but `image/png`, `.csv`, an unknown extension; `summarisePortalFiles` for empty input (zeros, `newestAgo` null), null sizes counted out of bytes and knownSizeCount, the 7 day boundary, the studio and client split, request versus loose counts, distinct request folders; `relativeAgo` keeps today's strings.
- MCP parity: no new capability (an additive read on a portal route); the worker MCP already has `list_request_files` and `delete_file`. Say so in the commit body.
- Not in this slice: no migration, no `folderId`, no rename or PATCH route, no page changes.
- Done when: type-check, lint, `npm run test`, `npm run build` pass; deployed; in Client View on a seeded client, `GET /api/portal/files?summary=1` returns items with the new fields and a summary whose count matches the file total, and /overview's Recent files card is unchanged; if the tenancy harness is available, `npm run test:e2e:tenancy` still passes. Commit body says "ported, unchecked".

### Slice files-uploads: upload pipeline with progress, retry and drag and drop (1.25 days, frontend only)

Owned: `lib/upload-with-progress.ts` (new), `lib/__tests__/upload-with-progress.test.ts` (new), `app/(dashboard)/files/use-file-uploads.ts` (new), `app/(dashboard)/files/upload-tray.tsx` (new), `app/(dashboard)/files/file-drop-zone.tsx` (new), `app/(dashboard)/files/files-uploads.css` (new).

Brief:
- Follow page keys `drop`, `uploading` and `upload-failed` in `portal-files.jsx` (the `pfl-tray` section, `startUpload`, `retryUpload`, `cancelUpload`, the `pfl-dropveil`) and the "upload tray" and "drop target" blocks of `portal-files.css`. Translate tokens: `--bg` to `--color-bg`, `--bg-secondary` to `--color-bg-secondary`, `--bg-tertiary` to `--color-bg-tertiary`, `--text` to `--color-text`, `--text-muted` to `--color-text-muted`, `--text-faint` to `--color-text-subtle`, `--border` to `--color-border`, `--border-subtle` to `--color-border-subtle`, `--brand` to `--color-brand`, brand ink on text to `--color-link`, `--brand-100` tints to `--color-brand-50` with `--color-brand-on-tint` ink, `--pfl-danger` to `--color-danger-ink` on `--color-danger-tint`, `--ease` to `--ease-out`, `[data-theme="dark"]` to `.dark`. No hex, no raw px for spacing (rem), borders on all sides or none.
- `lib/upload-with-progress.ts`: `uploadFileWithProgress({ file, requestId, orgId, onProgress, signal, createXhr })` returning `{ fileId }`. Presign with `fetch(apiPath('/api/uploads/presign'))`, PUT the body to `uploadUrl` with XMLHttpRequest (`xhr.upload.onprogress` drives `onProgress(fraction)`; `signal` aborts), then confirm with `sizeBytes`. Request bodies exactly as `files-content.tsx` sends them today: `mimeType` falls back to `application/octet-stream`, `orgId` only when previewing, and `requestId` only when given. Throw a typed `UploadError` with `kind: 'aborted' | 'network' | 'rejected' | 'server'` (rejected carries the 4xx status). `createXhr` defaults to `() => new XMLHttpRequest()` so tests inject a fake.
- `use-file-uploads.ts`: `useFileUploads({ impersonatedOrgId, onLanded })` returns `{ rows, add(files, { requestId }), retry(key), cancel(key), clearFinished(), busy }`. Row: `{ key, name, sizeBytes, mime, state: 'queued' | 'uploading' | 'finishing' | 'done' | 'failed', fraction, reason }`. One file at a time (the proxy buffers the whole body inside the Worker, so parallel large uploads risk its memory); queued rows read "Waiting". `finishing` covers the gap between the PUT reaching 100 percent and confirm answering. `onLanded()` runs after each confirmed file (the page revalidates). File objects live in a ref Map keyed by row, never in state. Cancel works while queued (row removed) or uploading (abort, row removed, nothing confirmed); not while finishing. Retry only on failed rows, re-queuing the kept File. Reasons: network or dropped transfer "The upload stopped partway."; 401 or 403 "This upload was refused. Refresh the page and try again."; 5xx "We could not save this file." All failures offer Retry. Abort everything on unmount.
- `upload-tray.tsx`: `<UploadTray rows onRetry onCancel onClearFinished />`, renders nothing when rows is empty. `role="status"`, `aria-label="Uploads"`. Fixed bottom right on desktop, width `min(22rem, calc(100vw - 2rem))`; below 48rem it spans the width with 0.75rem side gaps and sits above the mobile bottom tab bar (`components/tahi/mobile-bottom-nav.tsx`, measure its height, add `env(safe-area-inset-bottom)`), never covering it or the toast. Header: "Uploading" while anything moves, else "Uploads"; "N of M added" in tabular numerals; a 44px close button labelled "Clear finished uploads". Row: a muted glyph tile (lucide by MIME prefix, the same muted treatment as `FileAttachmentList`), the name with `data-private`, a sub line (size plus percent, "Waiting", "Finishing", "size, added", or the failure reason in `--color-danger-ink`), a thin brand meter (a 0.25rem bar; `ProgressBar` turns red at 100 on tone auto, so either pass `tone="positive"` with `height` 4 or draw the bar locally), and one action: Cancel (44px icon button, "Cancel {name}"), Retry (`TahiButton` secondary, 2.75rem tall on a phone), or a done check on `--color-brand-50`. Failed rows tint `--color-danger-tint`. Hover and focus on every control (`tahi-focus-ring`), reduced motion respected.
- `file-drop-zone.tsx`: `<FileDropZone onFiles label disabled>{children}</FileDropZone>`: a relative wrapper with a dragenter and dragleave depth counter, reacting only when `e.dataTransfer.types` includes `Files` (dragging text or a link shows nothing), `preventDefault` on dragover so the browser never opens the file, and on drop `onFiles(Array.from(e.dataTransfer.files))`. The veil is `aria-hidden`, inset -0.375rem, a 2px dashed `--color-brand` border on all sides, a `color-mix(in srgb, var(--color-brand) 10%, var(--color-bg))` wash, a centred upload icon and the label in `--color-link`. Keyboard and touch users use the page's Upload button.
- Styles in `files-uploads.css` (classes `pfl-tray-*`, `pfl-dropveil-*`; the `pfl-` prefix is free in the app), imported by `upload-tray.tsx` and `file-drop-zone.tsx` the way `components/tahi/portal/home/waiting-on-you.tsx` imports its sheet.
- Tests: fake XHR plus mocked fetch; happy path posts confirm with `sizeBytes` and reports progress; abort rejects `aborted` and never calls confirm; a 403 on presign rejects `rejected` with status 403; a PUT network error rejects `network`.
- Not in this slice: no page wiring (files-page does it), no edits to `files-content.tsx`, no size cap, no parallel uploads, no upload route changes, no toast per file.
- Done when: type-check, lint, `npm run test` pass and it is deployed. Nothing mounts these until files-page lands, so the live smoke for uploads runs in that slice; say so in the commit body along with "ported, unchecked".

### Slice files-page: band, rail, request folders, grid and list, file drawer (2.5 days, frontend only; needs files-route and files-uploads merged)

Owned: `app/(dashboard)/files/page.tsx`, `app/(dashboard)/files/files-content.tsx` (rewritten), `app/(dashboard)/files/files.css` (new), `app/(dashboard)/files/files-rail.tsx` (new), `app/(dashboard)/files/file-views.tsx` (new: FileCard, FolderCard, FileMobileCard, list columns, FolderCrumbs), `app/(dashboard)/files/file-drawer.tsx` (new), `app/(dashboard)/files/file-glyph.tsx` (new: kind tile and image thumbnail with fallback).

Brief:
- Follow `portal-files.jsx` page keys library, folder, search, file, file-details, delete, loading, empty, empty-folder, no-match, error, stale, client-view, and `portal-files.css` for the folder card, file card, breadcrumb, stage and details list. Apply the token translation listed in files-uploads. Existing primitives win over the prototype's kit: `PageHeader`, `KPIStrip`, `KPICell`, `SkeletonKPIStrip`, `RailLayout`, `RailViewItem`, `RailSelect`, `RailGroupLabel`, `buildRailChips`, `ViewToggle`, `DataTable` (with `onRowPreview`, `rowActions`, controlled `sort`, `mobileCard`), `Menu`, `SlideOver`, `EmptyState`, `Callout`, `ConfirmDialog`, `TahiButton`, `Badge`, `PortalStatusBadge`, `useToast`, `useImpersonation`, `useResource`, `apiPath`. Do not import or recreate the design's Icon, Pill, Meter, Segmented, SearchBox, Kebab, Modal, Drawer, Toast or Composer.
- `page.tsx`: add `import './files.css'`; keep the auth, redirect and metadata as they are.
- Data: `useResource<PortalFilesResponse>('/api/portal/files?summary=1&limit=500')`. States: failed = error and no data; loading = no data yet; empty = `summary.count === 0`; stale = error with data (existing Callout, unchanged).
- Page order: the Client View info Callout (only when `previewIsReadOnly`, copy in section 2); `PageHeader` title "Files", subtitle "Deliverables from the studio, and anything you share with us.", child = Upload files (`TahiButton` primary with the upload icon, opening the hidden multiple file input); the stale Callout; the band; then the body.
- Band (populated only): `KPIStrip` with four cells from `summary`. In your library: "{count} files", sub "{bytes formatted} in total." (when `knownSizeCount < count`: "{bytes} in total, not counting {n} older files with no size recorded."). From the studio: `studio`, sub "What the studio has shared with you.". Shared by you: `client`, sub "What your team has sent us.". Added this week: `addedThisWeek`, sub "Newest was {newestAgo}." or "Nothing new this week.". Loading shows `SkeletonKPIStrip` with 4 cells; empty and error show no band.
- Body when loading, empty or failed: no rail and no toolbar. Loading: skeleton cards in the grid (or the DataTable skeleton in list). Empty: `EmptyState` with the live copy and Upload files. Failed: `EmptyState` with the error copy and Try again (`mutate()`).
- Body when populated: `RailLayout` with `rail={<FilesRail />}`, `railTouch={<FilesRail touch />}`, `railLabel="Folders, filters and sort"`, `sheetTitle="Folders and filters"`, `switcher` = `ViewToggle` Grid and List (hidden below 48rem, where the list is forced), `chips` from `buildRailChips` for Type and Shared by, search on, `total` = rows shown, `itemNoun="file"`.
- `FilesRail` (built like `components/tahi/notifications/notifications-rail.tsx` and the Sort block of `components/tahi/requests/requests-rail.tsx`): Folders group of `RailViewItem`s All files, Request folders, Not on a request, with counts from the loaded items and "Request folders" lit inside any request folder; Filters group: `RailSelect` Type (Every type, Images, Documents, Video and audio, Archives, mapped from `kind`: documents are pdf, doc, sheet and design) and `RailSelect` Shared by (Anyone, Tahi Studio, Your team, mapped from `side`); Sort group: `RailSelect` Sort by (When it was added, Name, Size) and a reverse button with the design's direction words (Newest first or Oldest first, A to Z or Z to A, Largest first or Smallest first); a foot Clear filters when a filter is set. One `openKey` so only one popover is open. No saved default, no Contracts link.
- Folders (component state, not the URL): `all`, `requests`, `request:{id}`, `loose`. At All files with no query or filter, show a row of up to two FolderCards (Request folders: "{n} folders, one per request"; Not on a request: "{n} files") above the files, only for groups that have files. `requests` shows one FolderCard per request (reference, title with `data-private`, "{n} files"), newest first. `request:{id}` shows that request's files under FolderCrumbs (All files, Request folders, "#042 Title"; buttons, 2.75rem tall below 48rem and 2.25rem above, the current crumb `aria-current="page"`). A search ignores the folder and shows "Searching all your files for {query}." FolderCard: 3.5rem min height, all-sides border, a 2.25rem icon tile on `--radius-leaf-sm` with `--color-brand-50` and `--color-brand-on-tint` (the leaf is right here: icon backgrounds), a trailing caret; one column, two from 46rem, three from 66rem.
- When `total > items.length`, a quiet line above the results: "Showing your newest {items.length} of {total} files. Search, filters and folder counts cover those." The band stays whole-library.
- Grid: `repeat(auto-fill, minmax(11.25rem, 1fr))`, gap 0.75rem. FileCard: an open button (6.5rem stage, then the name on two lines with `data-private`, then "{uploader} · {ago}"), and a `Menu` kebab top right, always visible (never on hover only), 2.75rem below 48rem, 2.25rem above: Open, Download, Delete (only when `deletable`; disabled with trailing "Client view" when `previewIsReadOnly`). No version or comment pills.
- `file-glyph.tsx`: images render `<img src={apiPath(url)} alt="" loading="lazy" decoding="async">` with `object-fit: cover` and an `onError` that swaps to the glyph tile (remote images need a fallback); every other kind is a muted lucide glyph on `--color-bg-secondary`, matching `FileAttachmentList`'s muted icons rather than the design's per kind hex tints.
- List: `DataTable` columns File (2.25rem glyph plus name), Type (`Badge` neutral, the live column; never drop a real field), Shared by, Added (sorts by `createdAt`), Size (tabular, "Not recorded" when null), and the live Get download link. `onRowPreview` opens the drawer; `rowActions` Open, Download, Delete with the same rules. The rail sort drives the table's controlled `sort` and a header click writes back to the rail, so the two never disagree. No Notes column. `mobileCard`: a button covering the card (3.5rem min height; glyph, name, "{type} · {uploader} · {ago}") that opens the drawer, plus a separate 44px Download anchor labelled "Download {name}". Delete on a phone lives in the drawer.
- `file-drawer.tsx`: `SlideOver` with `title` the file name, `subtitle` "{type}, {size}, added {ago}", `maxWidth` 28rem. Body: a 9rem stage (image preview with the same fallback, else the glyph), then the Details list (Type, Size, Added in `en-NZ` long form from `createdAt`, Shared by, Folder, Visible to, and for a request file a link to `/requests/{id}` with the reference, title and `PortalStatusBadge`). Footer: Download (`TahiButton` primary, an anchor to the serve URL with `&download=1`), and Delete (secondary, danger tone) when deletable, disabled with the title "Read-only client view" in view mode. 44px targets on a phone. No tabs, no Notes, no Versions, no Share to a request, no Rename, no Move.
- Delete: keep the live optimistic flow (`mutate` without revalidation, rollback on failure, toast) with the design copy from section 2; close the drawer when its file is deleted.
- Uploads: `useFileUploads({ impersonatedOrgId, onLanded: () => mutate().catch(() => {}) })`; the header button, the empty state action and `FileDropZone` all call `add(files, { requestId })`, where `requestId` is set only inside a request folder. Drop label: "Drop to upload to your library", or "Drop to add to {ref} {title}". Render `UploadTray` at the page root. The tray replaces the live per file toasts.
- `files.css`: classes `pfl-*`, tokens only, no hex, rem spacing, no own horizontal or top padding (the shell's `.dashboard-main` and `.dashboard-page-inner` own the gutters, as `notifications.css` explains), a reduced-motion block.
- Check at 375 (no horizontal scroll, list forced, every tap target at least 44px: folder cards, crumbs, mobile card, its Download, the Filters button, drawer close and footer buttons, tray buttons), 768 (the Filters sheet stands in for the rail below 1024px; that is `RailLayout`'s behaviour and wins over the design's inline rail at 768), and 1440; light and `.dark` (rail active rows, folder icon tiles, glyph tiles, drop veil, tray, drawer).
- Not in this slice: New folder, Move, Rename, Notes, Versions, Share to a request, the Contracts link, a size cap, offline detection, any studio lens or nav change, any change to shared primitives (if a shared `Menu` item measures under 44px on a phone, note it in the commit rather than editing `menu.tsx`).
- Done when: type-check, lint, `npm run build`, `npm run test` pass; deployed; live smoke on the deployed URL in Client View, act mode and view mode, on a seeded client with files on at least two requests and some loose: switch folders, search, filter, sort both ways, grid and list, open the drawer, download, delete an own upload (act mode) and see it refused in view mode, upload three files by button and by drag, cancel one, force a failure (DevTools offline) and retry it, upload inside a request folder and see it land there; switch Client View to a second org and confirm the list changes (requirement acceptance 10); screenshots at 375, 768 and 1440 in light and dark in the commit body; "ported, unchecked"; one line under portal-files in `docs/superpowers/plans/2026-09-14-design-review-for-liam.md` recording the commit (leave the review box empty).

## 5. Skipped proposals (the port keeps today's behaviour)

- Standing folders Deliverables, Brand, References, Uploads, client made folders (Season 2027), the New folder dialog and the Move dialog: need a `folderId` migration and Liam's answer on the folder names (requirement question 2).
- The per file Notes thread, its composer, the "Note added" toast, the comment pills on cards and the Notes column: need `messages.fileId` (a migration and route work) and Liam's answer on first-ship scope (requirement question 3). Critic FIX.
- The Versions tab, version pills and the "Get" button per old version: no version table; Liam called versions optional. Critic FIX.
- Rename: a new write route with an ownership rule (can a client rename a studio deliverable?) and an MCP tool; not in the CL.1 wording.
- Share to a request: a new write path, not in the backlog.
- The "Contracts live on their own page" rail link: `/contracts` is studio only and bounces a client to /requests.
- The design's drawn placeholder artwork: replaced by real image thumbnails from the serve route and muted glyphs.
- A 500 MB (or any) upload size cap: requirement question 4.
- The offline Callout (design only; the stale Callout already covers a failed refresh).
- The StudioNote empty state for a studio viewer: live redirects instead, and stays that way.
- The phone bottom sheet drawer: the shared `SlideOver` goes full width on a phone; the primitive wins.

## 6. Questions for Liam

1. Folder names and folders at all: Deliverables, Brand, References, Uploads (TASKS.md) or the older Brand, Content, Contracts, Deliverables, Shared by you? Either way real folders need a `folderId` migration. Until then the port ships derived "Request folders" and "Not on a request"; should that group be called Deliverables instead?
2. Per file notes and version history: in the first ship of CL.1, or after folders? Both need schema work (a file target on messages; a version table or a `replacesFileId` column).
3. Upload size cap: pick a number, or stay uncapped (today a very large file can 500 in the proxy)?
4. Confirm the Client View rule this port keeps: uploads on in both view and act mode, delete off in view mode.
5. Should a client be able to rename files, and if so only their own uploads?

## 7. Risks

- Truncation: the browser asks for up to 500 files; above that, search, filters and folder counts cover the newest 500, and the page says so in words. The band counts the whole library through the server summary.
- Worker memory: the upload proxy buffers the whole body; the queue runs one file at a time to keep that bounded. Very large files can still fail with no cap in place (existing behaviour).
- Progress honesty: XHR progress measures bytes reaching the proxy; the Worker then writes to R2 and confirm runs. The tray shows "Finishing" for that gap instead of a bar stuck at 100 percent.
- Uploading inside a request folder sends `requestId`, so confirm runs `handBackOnClientAction`: a request waiting on the client hands itself back, the same as uploading on the request page. That is intended; verify it in the smoke.
- The route's new `?summary=1` mode reads every file row for the org in one query. Fine for today's volumes; revisit if an org passes a few thousand files.
- Image thumbnails load the original file (lazy). A very large image in the grid costs bandwidth; the fallback covers failures, not size.
- The route change is shared with the client home Recent files card and the tenancy e2e spec; changes are additive, and the default mode is unchanged.
- `RailLayout` folds the rail into the Filters sheet below 1024px, so 768 differs from the design (which kept the rail inline). Accepted: the existing primitive wins.
- Shared `Menu` items may measure under 44px on a phone; the mobile card avoids the kebab for that reason, and the grid is desktop only.
- No new MCP tool is needed: no new capability is added (additive read fields; uploads and deletes use existing routes that the worker already covers through `list_request_files` and `delete_file`).

## 8. Shared files (read or used, owned by nobody here)

- `app/api/portal/files/route.ts` is owned by files-route but is also read by `components/tahi/overview/homes/client-home.tsx` (portal-home module) and `e2e/tenancy-isolation.spec.ts`.
- `components/tahi/rail/rail-layout.tsx`, `components/tahi/rail/rail-controls.tsx`, `components/tahi/kpi-strip.tsx`, `components/tahi/skeletons.tsx`, `components/tahi/slide-over.tsx`, `components/tahi/data-table.tsx`, `components/tahi/menu.tsx`, `components/tahi/empty-state.tsx`, `components/tahi/callout.tsx`, `components/tahi/confirm-dialog.tsx`, `components/tahi/view-toggle.tsx`, `components/tahi/tahi-button.tsx`, `components/tahi/page-header.tsx`, `components/tahi/toast.tsx`, `components/tahi/impersonation-banner.tsx`, `components/tahi/portal/portal-status-badge.tsx`, `components/tahi/progress-bar.tsx`, `components/tahi/file-attachment-list.tsx` (pattern only): use, do not edit.
- `components/tahi/mobile-bottom-nav.tsx` (the tray sits above it) and `app/(dashboard)/layout.tsx` plus `app/(dashboard)/app-shell.css` (page gutters).
- `app/globals.css` (tokens; no new tokens needed).
- `lib/blockers.ts` (`requestRef`), `lib/upload-access.ts` and the upload routes (reference only).
- `docs/superpowers/plans/2026-09-14-design-review-for-liam.md` and `STATUS.md` (every module's port records a line there).
