'use client'

/**
 * <ChatMarkdown>. Renders an AI wizard reply through lib/chat-markdown's
 * pure parser, shared by both the request wizard and the task wizard so a
 * reply reads as prose and a numbered question reads as a list, instead of
 * "1. **What is it?**" showing up as literal characters.
 *
 * Everything renders as text nodes (never dangerouslySetInnerHTML), so React
 * escapes anything markup-looking automatically. There is no autolinking:
 * a URL in a reply stays plain text.
 */

import { Fragment } from 'react'
import { parseChatMarkdown, type InlineNode } from '@/lib/chat-markdown'

function renderInline(nodes: InlineNode[], keyPrefix: string) {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}-${i}`
    if (node.type === 'bold') {
      return <strong key={key}>{node.children.map(c => c.value).join('')}</strong>
    }
    return <Fragment key={key}>{node.value}</Fragment>
  })
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseChatMarkdown(text)
  return (
    <>
      {blocks.map((block, blockIndex) => {
        const key = `block-${blockIndex}`
        if (block.type === 'ordered-list') {
          return (
            <ol key={key} style={{ margin: '0.375rem 0', paddingLeft: '1.25rem', listStyleType: 'decimal' }}>
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`} style={{ marginBottom: '0.125rem' }}>
                  {renderInline(item, `${key}-${i}`)}
                </li>
              ))}
            </ol>
          )
        }
        if (block.type === 'bullet-list') {
          return (
            <ul key={key} style={{ margin: '0.375rem 0', paddingLeft: '1.25rem', listStyleType: 'disc' }}>
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`} style={{ marginBottom: '0.125rem' }}>
                  {renderInline(item, `${key}-${i}`)}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={key} style={{ margin: blockIndex === 0 ? 0 : '0.5rem 0 0' }}>
            {block.lines.map((line, i) => (
              <Fragment key={`${key}-${i}`}>
                {i > 0 && <br />}
                {renderInline(line, `${key}-${i}`)}
              </Fragment>
            ))}
          </p>
        )
      })}
    </>
  )
}
