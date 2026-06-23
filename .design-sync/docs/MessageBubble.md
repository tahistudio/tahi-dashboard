---
category: messaging
---

<MessageBubble>. One message. Used inside request threads,
conversations, deal activity, doc comments, anywhere we render a
single message.

  <MessageBubble
    author={{ name: 'Liam', avatarUrl, role: 'admin' }}
    timestamp="2026-05-23T10:14:00Z"
    bodyHtml={message.tiptapHtml}
    reactions={[{ emoji: '👍', count: 2, mine: true }]}
    attachments={message.files}
    voiceNote={message.voiceNote}
    visibility="internal"
    replyTo={parentMessage}
    own
    actions={[
      { label: 'Reply', icon: <Reply />, onClick },
      { label: 'Edit', icon: <Pencil />, onClick },
      { label: 'Delete', icon: <Trash />, tone: 'danger', onClick },
    ]}
    onReact={emoji => addReaction(message.id, emoji)}
    onReply={() => setReplyParent(message)}
  />

Layout variants:
  own = true   right-aligned bubble (current user's message).
               Brand-tinted background.
  own = false  left-aligned (default). Neutral bubble.

  visibility = 'internal'  shows a small "Internal" chip in the
                           header so the team knows clients can't
                           see this message.

  replyTo                  shows a quoted parent above the body so
                           threaded context is visible inline.

  compact                  tighter padding for dense activity feeds.
