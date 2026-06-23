---
category: primitives
---

<ToastProvider> + useToast(). Lightweight transient feedback. Dark
forest surface (matches the dashboard tooltip), tone-coloured leading
word, off-cream body, leaf-sm radius. No icons (per design rule), no
side rails. Slide up from the bottom-right; auto-dismiss after 3.5s.

  const { showToast } = useToast()
  showToast('Client saved', 'success')
  showToast("Couldn't save", 'error')
  showToast('Heads up', 'warning')
  showToast('Syncing with Xero', 'info')

  // With an action button (for "Undo", "View", etc.):
  showToast('Deal moved to Won', 'success', {
    action: { label: 'Undo', onClick: () => revert() }
  })
