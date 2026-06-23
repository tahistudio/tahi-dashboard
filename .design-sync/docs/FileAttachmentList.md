---
category: messaging
---

<FileAttachmentList>. The shared file list. Used in request threads,
messages, contracts, proposals, anywhere we attach files.

  <FileAttachmentList
    items={[
      { id: '1', name: 'brief.pdf',      sizeBytes: 184_000, url: '/files/1' },
      { id: '2', name: 'hero.png',       sizeBytes: 412_000, url: '/files/2', thumbnailUrl: '/thumbs/2' },
      { id: '3', name: 'logo.svg',       sizeBytes:   3_400, url: '/files/3', mime: 'image/svg+xml' },
    ]}
    onPreview={item => openPreview(item)}
    onRemove={item => deleteFile(item.id)}
  />

  <FileAttachmentList variant="grid" items={imageFiles} />

Variants:
  list (default)   compact rows with icon, name, size, actions
  grid             square thumbnails for image-heavy attachments

Items with `thumbnailUrl` or an image mime show a thumbnail; others
show a tone-coded icon (pdf/doc/sheet/zip/audio/video/code/image).
