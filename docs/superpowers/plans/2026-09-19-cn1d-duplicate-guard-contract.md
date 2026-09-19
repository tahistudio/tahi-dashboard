# CN.1d build contract: suggestions never duplicate what already exists (2026-09-19)

Extends the CN.1 and CN.1b contracts (both live). Liam: "make sure it checks if there are requests that are close or similar". Today the model sees the org's open requests and tasks and is asked to prefer an update, and nothing enforces it. This phase adds a similarity guard at three points: when suggestions are read (so the inbox warns), when one is approved (so a duplicate cannot be created), and when the sweep inserts (so two calls do not propose the same thing twice).

## 1. Similarity (slice D1)

lib/text-similarity.ts, pure and client-safe:
- `normaliseTitle(text)`: lower case, strip punctuation and markdown, collapse whitespace, drop a short stopword list (the, a, an, and, or, to, for, of, on, in, with, page, site, website, update, new, add, fix).
- `similarityScore(a, b)`: 0 to 1, the mean of token-set Jaccard and character-trigram Dice on the normalised strings; 1 for identical.
- `findSimilar(title, candidates: Array<{ id, title, ...rest }>, threshold = 0.5)`: sorted matches with score, best first, at most 5.
- Thresholds exported: `SIMILAR_WARN = 0.5`, `SIMILAR_BLOCK = 0.8`.
Tests: paraphrases of the same request score above WARN ("Add LinkedIn insight tag to global footer" vs "LinkedIn Insight Tag in the footer"), unrelated titles score below, identical scores 1, stopwords do not inflate.

## 2. Read time: the inbox warns (slice D1 server, slice D2 UI)

listSuggestions decorates every pending or snoozed create_request and create_task row with `similar: Array<{ kind: 'request' | 'task' | 'suggestion', id, number?: number | null, title, status, score }>`:
- requests of the same org, open or delivered in the last 90 days (status and deliveredAt or updatedAt), matched on the proposal title;
- tasks of the same org (or studio tasks when org is null) not done, or done in the last 30 days;
- other pending create suggestions of the same org (a different call proposing the same thing).
Computed on read from live rows, so the warning is always current and no rebuild is needed. Only matches at or above SIMILAR_WARN, best first, at most 3.

The context the model sees (lib/task-suggester.ts buildSuggestionContext) also lists requests delivered in the last 90 days, marked delivered, so a re-mention of finished work is proposed as a request_note or nothing rather than a new request.

## 3. Approval time: a duplicate cannot be created (slice D1)

decideSuggestion approve on create_request or create_task re-runs the same match against live rows. If the best match scores at or above SIMILAR_BLOCK and the decision does not carry `force: true`, nothing is written and the result is `{ changed: false, error: 'possible_duplicate', similar }`. The decide route and decide-bulk pass `force` through; bulk never forces.

New decision action `attach`: `{ action: 'attach', target: { kind: 'request' | 'task', id } }` converts a pending create_request into a request_note on that request (body = the proposal title, then the description on a new paragraph), or a pending create_task into a note on that task, keeping the quote, rationale and confidence; status stays pending so the human still approves. Only from pending or snoozed, only for the two create kinds, only to a target of the same org (or a studio task when org is null). MCP decide_task_suggestion gains `action: 'attach'`, `target_kind`, `target_id` and `force`.

## 4. Insert time: the sweep drops cross-call duplicates (slice D1)

insertSuggestions (or the sweep before it) compares each create draft's title against pending create suggestions of the same org already in the table and against the other drafts in the same batch; a match at or above SIMILAR_BLOCK is dropped and counted in the sweep summary dropReasons as `similar_pending`. Matches against open requests or tasks at or above SIMILAR_BLOCK are NOT dropped at insert time (the human may still want it) but the row is inserted as is and the read-time warning shows it.

## 5. The inbox (slice D2)

Under a create row with matches: a quiet line "Looks like #226 Design directions (open, 71%)" for the best match, with the others behind "and 2 more". Two buttons: "Use #226 instead" (calls decide with action attach; the row re-renders as a request note on that request) and, when the best score is at or above SIMILAR_BLOCK, Approve becomes "Approve anyway" and sends force: true after a confirm line in the row (no browser dialogs). A possible_duplicate error from approve renders the same line with the same two choices. Suggestions-types mirror gains `similar`. lib/dashboard-guide.ts says suggestions are checked against existing requests and tasks. Tests: the line renders with number, status and percentage; attach sends the right body; force is sent only after the confirm.

## 6. Tests every slice leaves green

D1: the similarity cases; decorate attaches similar from requests, tasks and pending suggestions; approve blocked at BLOCK without force and allowed with it; attach converts and refuses a target of another org; insert drops similar_pending and counts it; context includes delivered requests marked delivered. D2: the row line, the attach call, the force gating, the parity test for the new tool arguments, the guide test.
