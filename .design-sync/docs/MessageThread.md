---
category: messaging
---

<MessageThread>. The shared messaging container.

Renders:
  - Optional thread header (title + participant stack + actions)
  - Day separators ("Today", "Yesterday", date) between messages
    based on the timestamp prop
  - A list of <MessageBubble>s (or any custom renderer per item)
  - Optional reply-to context strip above the composer
  - Optional composer slot at the bottom (typically <MessageComposer>)
  - Optional "Load older" affordance at the top

  <MessageThread
    title="Glasswall · Web redesign"
    visibility="external"
    participants={[
      { id: '1', name: 'Liam', avatarUrl, role: 'admin' },
      { id: '2', name: 'Anna', role: 'client' },
    ]}
    messages={messages}
    renderMessage={msg => <MessageBubble {...msg} />}
    replyTo={replyParent}
    onCancelReply={() => setReply(null)}
    composer={<MessageComposer onSend={send} />}
    onLoadOlder={loadOlder}
    hasMore
  />

Works for 1:1 DMs, group chats, org channels, request comment
threads, deal activity. The thread itself is a generic container;
the caller decides what to render in each row and supplies the
composer.
