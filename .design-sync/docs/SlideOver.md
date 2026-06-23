---
category: primitives
---

<SlideOver> — the shared right-side drawer primitive.

Use for :
  - AI wizards (task, request)
  - Filter panels
  - Settings side-sheets
  - Notification detail
  - Any "contextual, temporary surface that slides in from the right"

  <SlideOver
    open={open}
    onClose={() => setOpen(false)}
    title="Draft a request with AI"
    icon={<Sparkles size={15} />}
    maxWidth="28rem"
  >
    <SlideOver.Body>...</SlideOver.Body>
    <SlideOver.Footer>
      <TahiButton>Submit</TahiButton>
    </SlideOver.Footer>
  </SlideOver>

Behaviours baked in :
  - Semi-transparent backdrop, click closes
  - Slide-in animation from the right (250ms ease-out)
  - Shadow-lg on the panel for clear elevation
  - `role="dialog"` + `aria-modal` + `aria-labelledby` for screen readers
  - Escape closes
  - Body scroll locked while open
  - Mobile : full-width (max-width cap is desktop-only)
  - Optional header with icon + title + close button

For MODAL dialogs (centered, short-form confirmation), use <ConfirmDialog>.
For full-screen takeovers, use <FullScreenDialog> (not yet built).
