# Spec: website QA comments and suggested copy

Status: scoped for a technical/design spike, not implemented. WQA.0 owns this
work. Research and competitor observations are recorded in
docs/superpowers/plans/2026-10-09-loopsii-qa-recording-ideas.md.

## What it is

Clients review a website Tahi is building, pin feedback to an element and
suggest a copy change with before/after text. The studio can discuss, resolve
or turn the feedback into a client-facing request without losing its source.

## User stories

- As a client reviewer, I want to click the part of a website I mean and leave
  a comment, so the studio can find it without a separate explanation.
- As a reviewer, I want to suggest replacement copy while keeping the original
  text visible, so the studio can assess the exact change.
- As the studio, I want feedback linked to its client, page and review round,
  with a clear open/resolved state and a route into requests.

## Initial scope

1. Deliberately registered client websites and staging hosts. Establish which
   client/project owns a review before accepting comments.
2. Pins with page URL, element anchor, nearby text, viewport, screenshot where
   supported, reviewer identity and creation time. Reuse lessons from the
   dashboard feedback anchor/screenshot code; do not mix client website
   comments into the dashboard's own beta-feedback queue.
3. A comment thread with replies, open/resolved state and a link back to the
   reviewed page. When an anchor no longer matches, say it moved and retain
   the screenshot/text context instead of placing the pin on a guessed target.
4. A copy suggestion stores original text and proposed text as separate
   values. Show both, allow copy-out, and preserve discussion and resolution.
   Accepting a suggestion does not edit the website automatically.
5. Studio review with client/project filters. Manual conversion to a request
   keeps the original pin/thread link and blocks accidental duplicate
   conversion. Clients never see studio-internal tasks.

## Access and implementation spike

Compare an embed on authorised staging sites with an extension or review-link
fallback. Prove the chosen approach on a representative Webflow staging site
and a second application with client-side navigation. Test layout isolation,
responsive anchors, page changes, site security policy and protected previews.
Do not promise that an arbitrary third-party site can be embedded or proxied.

Reviewer access must be bounded to the registered site and client. Test two
clients, two sites and a revoked reviewer. A shared link must not grant studio
access or reveal another client's comments. Recommend the guest identity and
link expiry model before implementing it. Existing portal users should reuse
the established client/brand permission model and getPortalAuth.

Any generated rewriting is a suggestion for a human to approve. Do not publish
copy, change site code or create AI-proposed work outside the existing human
gate. Manual reviewer comments can be saved by the person submitting them.

## UI reference and data

Use the existing Tahi comment, request and shared panel patterns in the
dashboard. Client-site controls need their own isolation and responsive proof.
Every list has loading, error, empty and populated states; commenting and
resolution must work with keyboard and touch at 375px and 768px.

The spike should propose the site/review/comment/copy-suggestion shape and API
contracts. No new table or migration is selected here. Keep reviewer identity,
source URL, anchor and original/proposed copy available through every step.

## Out of scope

Automatic website edits, video/session recording, automated browser testing,
console/network replay, a full issue tracker and public review galleries.
This feature lets clients give QA feedback; it is separate from the studio's
automated regression testing and the meeting audio feature.

## Done criteria

The spike proves stable pins and stale-anchor handling, before/after copy,
isolated access, responsive/keyboard controls and a request conversion round
trip in QA. It supplies a reviewable design and data/API recommendation.
A later implementation requires the repository gates and signed-in live QA.
