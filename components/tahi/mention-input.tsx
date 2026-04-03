'use client'

import React, { useRef, useEffect, useCallback, useState } from 'react'
import { useMentions, type MentionPerson } from '@/lib/use-mentions'

// ── Constants ─────────────────────────────────────────────────────────────────

const BRAND_HEX = '#5A824E'
const TEXT_PRIMARY = '#121A0F'
const TEXT_MUTED = '#5a6657'
const TEXT_SUBTLE = '#8a9987'

// ── Types ─────────────────────────────────────────────────────────────────────

interface MentionInputProps {
  /** Current text value (controlled) */
  value: string
  /** Called when text changes */
  onChange: (value: string) => void
  /** Called when a mention is inserted */
  onMention?: (personId: string, personType: 'team_member' | 'contact') => void
  /** Org ID to load contacts for */
  orgId?: string | null
  /** Whether current user is admin */
  isAdmin?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Use textarea instead of input */
  multiline?: boolean
  /** Number of rows for textarea */
  rows?: number
  /** Additional class names */
  className?: string
  /** Whether the input is disabled */
  disabled?: boolean
  /** Autofocus on mount */
  autoFocus?: boolean
  /** Called on blur */
  onBlur?: () => void
  /** Called on key down (after mention handling) */
  onKeyDown?: (e: React.KeyboardEvent) => void
}

// ── Mention chip rendering ────────────────────────────────────────────────────

interface MentionSegment {
  type: 'text' | 'mention'
  value: string
}

function parseMentions(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  const regex = /@(\w[\w\s]*?\w|\w)/g
  let lastIndex = 0
  let match: RegExpExecArray | null = null

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', value: text.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'mention', value: match[0] })
    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', value: text.slice(lastIndex) })
  }

  return segments.length > 0 ? segments : [{ type: 'text', value: text }]
}

// ── Avatar/Initials helper ────────────────────────────────────────────────────

function PersonAvatar({ person }: { person: MentionPerson }) {
  const initials = person.name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  if (person.avatarUrl) {
    return (
      <img
        src={person.avatarUrl}
        alt={person.name}
        style={{
          width: '1.75rem',
          height: '1.75rem',
          borderRadius: '0 0.5rem 0 0.5rem',
          objectFit: 'cover',
          flexShrink: 0,
        }}
      />
    )
  }

  return (
    <div
      style={{
        width: '1.75rem',
        height: '1.75rem',
        borderRadius: '0 0.5rem 0 0.5rem',
        background: person.type === 'team_member'
          ? 'var(--color-brand-50, #f0f7ee)'
          : 'var(--color-bg-tertiary, #eef3ec)',
        color: person.type === 'team_member' ? BRAND_HEX : TEXT_MUTED,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.6875rem',
        fontWeight: 600,
        flexShrink: 0,
        letterSpacing: '0.02em',
      }}
    >
      {initials}
    </div>
  )
}

// ── Type badge ────────────────────────────────────────────────────────────────

function TypeBadge({ type }: { type: 'team_member' | 'contact' }) {
  const isTeam = type === 'team_member'
  return (
    <span
      style={{
        fontSize: '0.625rem',
        fontWeight: 500,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
        padding: '0.0625rem 0.375rem',
        borderRadius: '0.25rem',
        background: isTeam
          ? 'var(--color-brand-50, #f0f7ee)'
          : 'var(--color-bg-tertiary, #eef3ec)',
        color: isTeam ? BRAND_HEX : TEXT_MUTED,
      }}
    >
      {isTeam ? 'Team' : 'Contact'}
    </span>
  )
}

// ── Dropdown item ─────────────────────────────────────────────────────────────

function MentionDropdownItem({
  person,
  isHighlighted,
  onSelect,
  onMouseEnter,
}: {
  person: MentionPerson
  isHighlighted: boolean
  onSelect: () => void
  onMouseEnter: () => void
}) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div
      role="option"
      aria-selected={isHighlighted}
      data-mention-option
      onClick={onSelect}
      onMouseEnter={() => {
        setIsHovered(true)
        onMouseEnter()
      }}
      onMouseLeave={() => setIsHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.625rem',
        padding: '0.5rem 0.75rem',
        minHeight: '2.75rem',
        cursor: 'pointer',
        borderRadius: '0.375rem',
        background: isHighlighted || isHovered
          ? 'var(--color-bg-secondary, #f7f9f6)'
          : 'transparent',
        transition: 'background 0.1s',
      }}
    >
      <PersonAvatar person={person} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--color-text, ' + TEXT_PRIMARY + ')',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {person.name}
        </div>
        {person.role && (
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--color-text-subtle, ' + TEXT_SUBTLE + ')',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              marginTop: '0.0625rem',
            }}
          >
            {person.role}
          </div>
        )}
      </div>
      <TypeBadge type={person.type} />
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function MentionInput({
  value,
  onChange,
  onMention,
  orgId,
  isAdmin = false,
  placeholder = 'Type @ to mention someone...',
  multiline = false,
  rows = 3,
  className,
  disabled = false,
  autoFocus = false,
  onBlur,
  onKeyDown: externalKeyDown,
}: MentionInputProps) {
  const inputRef = useRef<HTMLTextAreaElement | HTMLInputElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [isFocused, setIsFocused] = useState(false)

  const {
    state,
    openMention,
    closeMention,
    selectMention,
    selectHighlighted,
    setHighlightIndex,
    highlightUp,
    highlightDown,
  } = useMentions({ orgId, isAdmin, onMention })

  // Scroll highlighted item into view
  useEffect(() => {
    if (!state.isOpen || !dropdownRef.current) return
    const items = dropdownRef.current.querySelectorAll('[data-mention-option]')
    const item = items[state.highlightIndex] as HTMLElement | undefined
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [state.highlightIndex, state.isOpen])

  // Close dropdown on outside click
  useEffect(() => {
    if (!state.isOpen) return
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        closeMention()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [state.isOpen, closeMention])

  // Detect "@" trigger and update query on input change
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      const newValue = e.target.value
      onChange(newValue)

      const cursorPos = e.target.selectionStart ?? newValue.length

      // Find the last "@" before the cursor
      let atIndex = -1
      for (let i = cursorPos - 1; i >= 0; i--) {
        if (newValue[i] === '@') {
          // Check that "@" is at the start or preceded by whitespace
          if (i === 0 || /\s/.test(newValue[i - 1])) {
            atIndex = i
          }
          break
        }
        // Stop searching if we hit whitespace before finding "@"
        // (only for non-alphanumeric chars that are not part of a name)
        if (/\s/.test(newValue[i]) && state.isOpen) {
          // If dropdown is open, whitespace within the query is ok (for multi-word names)
          // but only if we already have a trigger
          continue
        }
        if (/\s/.test(newValue[i]) && !state.isOpen) {
          break
        }
      }

      if (atIndex >= 0) {
        const query = newValue.slice(atIndex + 1, cursorPos)
        // Only open if query does not contain newlines
        if (!query.includes('\n')) {
          openMention(atIndex, query)
        } else {
          closeMention()
        }
      } else {
        if (state.isOpen) {
          closeMention()
        }
      }
    },
    [onChange, openMention, closeMention, state.isOpen]
  )

  // Handle keyboard events for mention navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      if (state.isOpen) {
        switch (e.key) {
          case 'ArrowDown':
            e.preventDefault()
            highlightDown()
            return
          case 'ArrowUp':
            e.preventDefault()
            highlightUp()
            return
          case 'Enter': {
            e.preventDefault()
            const selected = selectHighlighted()
            if (selected && inputRef.current) {
              // Replace the @query with @Name
              const before = value.slice(0, state.triggerIndex)
              const after = value.slice(
                state.triggerIndex + 1 + state.query.length
              )
              const newValue = before + '@' + selected.name + ' ' + after
              onChange(newValue)

              // Set cursor position after the inserted mention
              const newPos = state.triggerIndex + selected.name.length + 2
              requestAnimationFrame(() => {
                inputRef.current?.setSelectionRange(newPos, newPos)
              })
            }
            return
          }
          case 'Escape':
            e.preventDefault()
            closeMention()
            return
          case 'Tab': {
            e.preventDefault()
            const tabSelected = selectHighlighted()
            if (tabSelected && inputRef.current) {
              const before = value.slice(0, state.triggerIndex)
              const after = value.slice(
                state.triggerIndex + 1 + state.query.length
              )
              const newValue = before + '@' + tabSelected.name + ' ' + after
              onChange(newValue)

              const newPos = state.triggerIndex + tabSelected.name.length + 2
              requestAnimationFrame(() => {
                inputRef.current?.setSelectionRange(newPos, newPos)
              })
            }
            return
          }
        }
      }

      if (externalKeyDown) {
        externalKeyDown(e)
      }
    },
    [
      state,
      highlightDown,
      highlightUp,
      selectHighlighted,
      closeMention,
      value,
      onChange,
      externalKeyDown,
    ]
  )

  // Handle selecting a person from dropdown by click
  const handleSelectPerson = useCallback(
    (person: MentionPerson) => {
      const selected = selectMention(person)
      if (selected && inputRef.current) {
        const before = value.slice(0, state.triggerIndex)
        const after = value.slice(state.triggerIndex + 1 + state.query.length)
        const newValue = before + '@' + selected.name + ' ' + after
        onChange(newValue)

        const newPos = state.triggerIndex + selected.name.length + 2
        requestAnimationFrame(() => {
          inputRef.current?.focus()
          inputRef.current?.setSelectionRange(newPos, newPos)
        })
      }
    },
    [selectMention, value, state.triggerIndex, state.query, onChange]
  )

  // ── Render preview with styled mentions ───────────────────────────────────

  const segments = parseMentions(value)
  const hasStyledMentions = segments.some(s => s.type === 'mention')

  // Common input styles
  const inputStyles: React.CSSProperties = {
    width: '100%',
    padding: multiline ? '0.625rem 0.75rem' : '0 0.75rem',
    height: multiline ? 'auto' : '2.625rem',
    fontSize: '0.875rem',
    fontFamily: 'inherit',
    color: hasStyledMentions ? 'transparent' : 'var(--color-text, ' + TEXT_PRIMARY + ')',
    caretColor: 'var(--color-text, ' + TEXT_PRIMARY + ')',
    background: 'transparent',
    border: 'none',
    outline: 'none',
    resize: multiline ? 'vertical' : 'none',
    lineHeight: '1.5',
  }

  const borderColor = isFocused
    ? BRAND_HEX
    : 'var(--color-border, #d4e0d0)'
  const boxShadow = isFocused
    ? '0 0 0 0.1875rem rgba(90, 130, 78, 0.12)'
    : 'none'

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative' }}
      className={className}
    >
      {/* Container with border */}
      <div
        style={{
          position: 'relative',
          border: '1px solid ' + borderColor,
          borderRadius: '0.5rem',
          background: disabled
            ? 'var(--color-bg-secondary, #f7f9f6)'
            : 'var(--color-bg, #ffffff)',
          transition: 'border-color 0.15s, box-shadow 0.15s',
          boxShadow,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {/* Styled text overlay for mention highlighting */}
        {hasStyledMentions && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              padding: multiline ? '0.625rem 0.75rem' : '0 0.75rem',
              fontSize: '0.875rem',
              fontFamily: 'inherit',
              lineHeight: '1.5',
              pointerEvents: 'none',
              whiteSpace: multiline ? 'pre-wrap' : 'pre',
              overflow: 'hidden',
              display: multiline ? 'block' : 'flex',
              alignItems: multiline ? undefined : 'center',
              height: multiline ? 'auto' : '2.625rem',
            }}
          >
            {segments.map((seg, i) =>
              seg.type === 'mention' ? (
                <span
                  key={i}
                  style={{
                    fontWeight: 600,
                    color: BRAND_HEX,
                  }}
                >
                  {seg.value}
                </span>
              ) : (
                <span
                  key={i}
                  style={{
                    color: 'var(--color-text, ' + TEXT_PRIMARY + ')',
                  }}
                >
                  {seg.value}
                </span>
              )
            )}
          </div>
        )}

        {/* Actual input */}
        {multiline ? (
          <textarea
            ref={inputRef as React.RefObject<HTMLTextAreaElement>}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false)
              if (onBlur) onBlur()
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            rows={rows}
            style={inputStyles}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={state.isOpen}
            aria-haspopup="listbox"
          />
        ) : (
          <input
            ref={inputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => setIsFocused(true)}
            onBlur={() => {
              setIsFocused(false)
              if (onBlur) onBlur()
            }}
            placeholder={placeholder}
            disabled={disabled}
            autoFocus={autoFocus}
            style={inputStyles}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={state.isOpen}
            aria-haspopup="listbox"
          />
        )}
      </div>

      {/* Mention dropdown */}
      {state.isOpen && (
        <div
          ref={dropdownRef}
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 0.25rem)',
            left: 0,
            right: 0,
            zIndex: 100,
            background: 'var(--color-bg, #ffffff)',
            border: '1px solid var(--color-border, #d4e0d0)',
            borderRadius: '0.75rem',
            boxShadow: '0 0.5rem 2rem rgba(0, 0, 0, 0.12)',
            overflow: 'hidden',
            maxHeight: '16rem',
          }}
        >
          {state.loading ? (
            <div style={{ padding: '0.75rem' }}>
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.625rem',
                    padding: '0.5rem 0.75rem',
                  }}
                >
                  <div
                    className="animate-pulse"
                    style={{
                      width: '1.75rem',
                      height: '1.75rem',
                      borderRadius: '0 0.5rem 0 0.5rem',
                      background: '#f3f4f6',
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      className="animate-pulse"
                      style={{
                        height: '0.75rem',
                        width: '60%',
                        borderRadius: '0.25rem',
                        background: '#f3f4f6',
                      }}
                    />
                    <div
                      className="animate-pulse"
                      style={{
                        height: '0.5rem',
                        width: '40%',
                        borderRadius: '0.25rem',
                        background: '#f3f4f6',
                        marginTop: '0.375rem',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : state.results.length === 0 ? (
            <div
              style={{
                padding: '1.5rem 1rem',
                textAlign: 'center',
                fontSize: '0.8125rem',
                color: 'var(--color-text-subtle, ' + TEXT_SUBTLE + ')',
              }}
            >
              {state.query
                ? 'No people found matching "' + state.query + '"'
                : 'No team members or contacts available'}
            </div>
          ) : (
            <div style={{ padding: '0.25rem', overflowY: 'auto', maxHeight: '15.5rem' }}>
              {state.results.map((person, idx) => (
                <MentionDropdownItem
                  key={person.id}
                  person={person}
                  isHighlighted={idx === state.highlightIndex}
                  onSelect={() => handleSelectPerson(person)}
                  onMouseEnter={() => setHighlightIndex(idx)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Re-export hook for standalone usage ───────────────────────────────────────

export { useMentions } from '@/lib/use-mentions'
export type { MentionPerson } from '@/lib/use-mentions'
