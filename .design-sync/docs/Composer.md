---
category: messaging
---

<Composer>. The rich-text + voice + files composer primitive.

Self-contained for design-system demos; pass `onUploadFile` to
plug in real R2 / Stripe / whatever upload pipeline for production.

  <Composer
    placeholder="Reply to Anna…"
    canBeInternal
    onSend={({ html, json, files, voiceNote, visibility }) => post(...)}
  />

Features:
  - Tiptap with StarterKit (bold, italic, lists, code, code blocks),
    links, placeholder.
  - Slim formatting toolbar above the editor (toggle marks +
    blocks via icon buttons). Hidden on mobile by default.
  - File attach (paperclip) + image attach buttons + drag/drop
    anywhere on the composer surface.
  - Voice recorder using MediaRecorder. Click mic → recording UI
    with timer + stop button. Stop → inline audio preview with
    delete.
  - Visibility segmented control (Public / Internal) when
    canBeInternal is true. Internal style adds a soft orange tint.
  - Cmd/Ctrl+Enter sends. Plain Enter is a new line.
  - Staged files render as chips below the editor with name + size
    + remove X. Images preview as thumbnail tiles instead of chips.

No tracking of upload progress per file — for the production
version we'll add that on top.
