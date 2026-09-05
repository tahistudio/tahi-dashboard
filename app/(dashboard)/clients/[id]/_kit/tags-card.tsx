'use client'

/**
 * <TagsCard>. Studio labels on the org, written to the org.tags JSON column.
 * The client never sees them; the list filter and saved views do.
 */

import { useState } from 'react'
import { Tag } from 'lucide-react'
import { apiPath } from '@/lib/api'
import { Badge } from '@/components/tahi/badge'
import { Card } from '@/components/tahi/card'
import { TahiButton } from '@/components/tahi/tahi-button'
import type { Organisation } from './types'

// ── Tags card ────────────────────────────────────────────────────────────────

export function TagsCard({ org, onUpdated }: { org: Organisation; onUpdated: () => void }) {
  const [tags, setTags] = useState<string[]>(() => {
    try {
      const arr = JSON.parse(org.tags ?? '[]')
      return Array.isArray(arr) ? arr.filter((t): t is string => typeof t === 'string') : []
    } catch {
      return []
    }
  })
  const [newTag, setNewTag] = useState('')
  const [saving, setSaving] = useState(false)

  const saveTags = async (updated: string[]) => {
    setSaving(true)
    try {
      await fetch(apiPath(`/api/admin/clients/${org.id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tags: JSON.stringify(updated) }),
      })
      setTags(updated)
      onUpdated()
    } finally {
      setSaving(false)
    }
  }

  const addTag = () => {
    const name = newTag.trim().toLowerCase()
    if (!name || tags.includes(name)) return
    setNewTag('')
    saveTags([...tags, name])
  }

  const removeTag = (name: string) => {
    saveTags(tags.filter(t => t !== name))
  }

  return (
    <Card>
      <Card.Header style={{ marginBottom: 'var(--space-3)', display: 'block' }}>
        <div className="flex items-center gap-2 mb-1">
          <Tag className="w-4 h-4 text-[var(--color-text-muted)]" aria-hidden="true" />
          <Card.Title style={{ fontSize: 'var(--text-sm)' }}>Tags</Card.Title>
        </div>
        <Card.Subtitle style={{ marginTop: 0 }}>
          Label this client to group and filter their requests.
        </Card.Subtitle>
      </Card.Header>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {tags.map(t => (
            <Badge key={t} tone="neutral" onRemove={saving ? undefined : () => removeTag(t)}>
              {t}
            </Badge>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <input
          type="text"
          value={newTag}
          onChange={e => setNewTag(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTag() }}
          placeholder="Add a tag (e.g. enterprise)..."
          className="flex-1 text-xs text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)]"
          style={{
            padding: '0.375rem 0.5rem',
            borderRadius: 'var(--radius-input)',
            border: '1px solid var(--color-border)',
            background: 'var(--color-bg)',
            minHeight: '2rem',
          }}
        />
        <TahiButton
          variant="primary"
          size="sm"
          onClick={addTag}
          disabled={!newTag.trim() || saving}
          loading={saving}
        >
          Add
        </TahiButton>
      </div>
    </Card>
  )
}
