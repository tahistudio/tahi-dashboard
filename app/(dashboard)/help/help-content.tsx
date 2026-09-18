'use client'

/**
 * <HelpContent>. The "How this works" page body: a short, plain-language
 * guide (lib/dashboard-guide.ts), one card per section, rendered through
 * components/tahi/chat-markdown.tsx so bold and lists come through as real
 * markup instead of literal asterisks.
 *
 * Studio sessions get every section (including the MCP tool list); client
 * sessions get only the sections marked 'client' or 'both' - the page.tsx
 * server component already filtered the list before it reaches here.
 */

import { PageHeader } from '@/components/tahi/page-header'
import { Card } from '@/components/tahi/card'
import { ChatMarkdown } from '@/components/tahi/chat-markdown'
import type { GuideSection } from '@/lib/dashboard-guide'

interface HelpContentProps {
  sections: GuideSection[]
  isAdmin: boolean
}

export function HelpContent({ sections, isAdmin }: HelpContentProps) {
  return (
    <div className="flex flex-col" style={{ gap: 'var(--space-6)', padding: 'var(--space-6)' }}>
      <PageHeader
        title="How this works"
        subtitle={
          isAdmin
            ? 'A short guide to requests, tasks, hand-offs, blockers and what the MCP can do.'
            : 'A short guide to how requests and hand-offs work in your portal.'
        }
      />
      <div className="flex flex-col" style={{ gap: 'var(--space-4)', maxWidth: '48rem' }}>
        {sections.map(section => (
          <Card key={section.key} variant="default" padding="md">
            <Card.Header>
              <Card.Title>{section.title}</Card.Title>
            </Card.Header>
            <Card.Body>
              <div
                style={{
                  color: 'var(--color-text-muted)',
                  fontSize: 'var(--text-sm)',
                  lineHeight: 1.6,
                }}
              >
                <ChatMarkdown text={section.body} />
              </div>
            </Card.Body>
          </Card>
        ))}
      </div>
    </div>
  )
}
