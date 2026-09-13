/**
 * lib/chat-markdown.ts
 *
 * A deliberately small markdown parser for AI wizard replies. The wizards'
 * assistant turns used to render as raw prose, so a numbered list came back
 * as literal text: "1. **What does your current site do badly?** Is it...".
 *
 * This parses only what the system prompts are told to produce: paragraphs,
 * **bold**, numbered lists, bullet lists, and line breaks. Everything else
 * (headings, tables, code fences, single-asterisk italics, links) is left as
 * plain text on purpose. There is no HTML parsing at all: the output is a
 * plain data tree, never a string of markup, so there is nothing here that
 * could inject an element. The caller (components/tahi/chat-markdown.tsx)
 * turns the tree into React text nodes, which escapes automatically.
 *
 * Pure and dependency-free so it can be unit tested without React.
 */

export interface TextNode {
  type: 'text'
  value: string
}

export interface BoldNode {
  type: 'bold'
  children: TextNode[]
}

export type InlineNode = TextNode | BoldNode

export interface ParagraphBlock {
  type: 'paragraph'
  /** One entry per source line. Consecutive lines within a paragraph render
   *  with a line break between them, matching the single-newline-as-<br>
   *  convention the rest of the app already uses for a brief's body. */
  lines: InlineNode[][]
}

export interface OrderedListBlock {
  type: 'ordered-list'
  items: InlineNode[][]
}

export interface BulletListBlock {
  type: 'bullet-list'
  items: InlineNode[][]
}

export type BlockNode = ParagraphBlock | OrderedListBlock | BulletListBlock

const ORDERED_ITEM = /^\d+\.\s+(.+)$/
const BULLET_ITEM = /^[-*]\s+(.+)$/
/** Non-greedy, no nested bold, and `.` does not span lines by construction
 *  (parseInline runs once per source line). A stray single `*` never
 *  matches this and is left as plain text. */
const BOLD = /\*\*(.+?)\*\*/g

/** Bold spans within one line. Anything that is not `**bold**` is a plain
 *  text run, verbatim, including any HTML-looking text: it is never
 *  interpreted, only carried as a string. */
export function parseInline(line: string): InlineNode[] {
  const nodes: InlineNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  BOLD.lastIndex = 0
  while ((match = BOLD.exec(line)) !== null) {
    if (match.index > lastIndex) {
      nodes.push({ type: 'text', value: line.slice(lastIndex, match.index) })
    }
    nodes.push({ type: 'bold', children: [{ type: 'text', value: match[1] }] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < line.length) {
    nodes.push({ type: 'text', value: line.slice(lastIndex) })
  }
  return nodes.length > 0 ? nodes : [{ type: 'text', value: line }]
}

/**
 * Parse a full reply into block nodes: paragraphs, ordered lists, bullet
 * lists. A blank line always ends whatever block is open. A numbered or
 * bulleted line joins a run of the same list type; switching types (or
 * hitting plain text) flushes the one in progress.
 */
export function parseChatMarkdown(text: string): BlockNode[] {
  const blocks: BlockNode[] = []
  let paragraphLines: InlineNode[][] = []
  let listItems: InlineNode[][] = []
  let listType: 'ordered-list' | 'bullet-list' | null = null

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({ type: 'paragraph', lines: paragraphLines })
      paragraphLines = []
    }
  }
  const flushList = () => {
    if (listItems.length > 0 && listType) {
      blocks.push({ type: listType, items: listItems } as BlockNode)
    }
    listItems = []
    listType = null
  }

  for (const rawLine of text.split('\n')) {
    if (rawLine.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }

    const ordered = rawLine.match(ORDERED_ITEM)
    if (ordered) {
      flushParagraph()
      if (listType !== 'ordered-list') flushList()
      listType = 'ordered-list'
      listItems.push(parseInline(ordered[1]))
      continue
    }

    const bulleted = rawLine.match(BULLET_ITEM)
    if (bulleted) {
      flushParagraph()
      if (listType !== 'bullet-list') flushList()
      listType = 'bullet-list'
      listItems.push(parseInline(bulleted[1]))
      continue
    }

    flushList()
    paragraphLines.push(parseInline(rawLine))
  }

  flushParagraph()
  flushList()
  return blocks
}
