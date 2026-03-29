'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Search, X, ChevronDown, Check } from 'lucide-react'

const BRAND_HEX = '#5A824E'

interface Option {
  value: string
  label: string
  subtitle?: string
}

interface SearchableSelectProps {
  options: Option[]
  value: string | null
  onChange: (value: string | null) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  allowClear?: boolean
  disabled?: boolean
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = 'Select...',
  searchPlaceholder = 'Search...',
  emptyMessage = 'No results found.',
  allowClear = false,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlightIdx, setHighlightIdx] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const filtered = options.filter(o => {
    const q = query.toLowerCase()
    return o.label.toLowerCase().includes(q) || (o.subtitle?.toLowerCase().includes(q) ?? false)
  })

  const selectedOption = options.find(o => o.value === value)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  // Focus search on open
  useEffect(() => {
    if (open) {
      setHighlightIdx(0)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!open || !listRef.current) return
    const items = listRef.current.querySelectorAll('[data-option]')
    const item = items[highlightIdx] as HTMLElement | undefined
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightIdx, open])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightIdx(i => Math.min(i + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setHighlightIdx(i => Math.max(i - 1, 0))
        break
      case 'Enter':
        e.preventDefault()
        if (filtered[highlightIdx]) {
          onChange(filtered[highlightIdx].value)
          setOpen(false)
          setQuery('')
        }
        break
      case 'Escape':
        e.preventDefault()
        setOpen(false)
        setQuery('')
        break
    }
  }, [open, filtered, highlightIdx, onChange])

  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    function checkMobile() {
      setIsMobile(window.innerWidth < 768)
    }
    checkMobile()
    window.addEventListener('resize', checkMobile)
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  const dropdownContent = (
    <>
      {/* Search input */}
      <div style={{ padding: '0.5rem', borderBottom: '1px solid var(--color-border-subtle)' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            padding: '0 0.625rem',
            height: '2.75rem',
            background: 'var(--color-bg-secondary)',
            borderRadius: 'var(--radius-button)',
            border: '1px solid var(--color-border-subtle)',
          }}
        >
          <Search size={14} style={{ color: 'var(--color-text-subtle)', flexShrink: 0 }} />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => { setQuery(e.target.value); setHighlightIdx(0) }}
            placeholder={searchPlaceholder}
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontSize: '0.875rem',
              color: 'var(--color-text)',
            }}
            aria-label="Search options"
          />
          {query && (
            <button
              type="button"
              onClick={() => { setQuery(''); setHighlightIdx(0) }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                display: 'flex', alignItems: 'center',
                color: 'var(--color-text-subtle)',
              }}
              aria-label="Clear search"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Options list */}
      <div
        ref={listRef}
        role="listbox"
        style={{ maxHeight: isMobile ? '50vh' : '12rem', overflowY: 'auto', padding: '0.25rem' }}
      >
        {filtered.length === 0 ? (
          <div
            style={{
              padding: '1.5rem 1rem',
              textAlign: 'center',
              fontSize: '0.8125rem',
              color: 'var(--color-text-subtle)',
            }}
          >
            {emptyMessage}
          </div>
        ) : (
          filtered.map((opt, idx) => {
            const isSelected = opt.value === value
            const isHighlighted = idx === highlightIdx
            return (
              <div
                key={opt.value}
                data-option
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                  setQuery('')
                }}
                onMouseEnter={() => setHighlightIdx(idx)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  padding: '0.75rem 1rem',
                  minHeight: '2.75rem',
                  borderRadius: 'var(--radius-button)',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  color: isSelected ? BRAND_HEX : 'var(--color-text)',
                  background: isHighlighted ? 'var(--color-bg-secondary)' : 'transparent',
                  transition: 'background 0.1s',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="truncate" style={{ fontWeight: isSelected ? 600 : 400 }}>
                    {opt.label}
                  </div>
                  {opt.subtitle && (
                    <div
                      className="truncate"
                      style={{ fontSize: '0.75rem', color: 'var(--color-text-subtle)', marginTop: '0.0625rem' }}
                    >
                      {opt.subtitle}
                    </div>
                  )}
                </div>
                {isSelected && (
                  <Check size={14} style={{ color: BRAND_HEX, flexShrink: 0 }} />
                )}
              </div>
            )
          })
        )}
      </div>
    </>
  )

  return (
    <div ref={containerRef} style={{ position: 'relative' }} onKeyDown={handleKeyDown}>
      {/* Trigger button */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => !disabled && setOpen(!open)}
        style={{
          width: '100%',
          height: '2.625rem',
          padding: '0 0.75rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '0.5rem',
          fontSize: '0.875rem',
          color: selectedOption ? 'var(--color-text)' : 'var(--color-text-subtle)',
          background: disabled ? 'var(--color-bg-secondary)' : 'var(--color-bg)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-input)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          outline: 'none',
          transition: 'border-color 0.15s',
          opacity: disabled ? 0.6 : 1,
        }}
        onFocus={e => {
          if (!disabled) {
            e.currentTarget.style.borderColor = BRAND_HEX
            e.currentTarget.style.boxShadow = '0 0 0 3px rgba(90,130,78,0.12)'
          }
        }}
        onBlur={e => {
          if (!open) {
            e.currentTarget.style.borderColor = 'var(--color-border)'
            e.currentTarget.style.boxShadow = 'none'
          }
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate" style={{ flex: 1, textAlign: 'left' }}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem', flexShrink: 0 }}>
          {allowClear && value && (
            <span
              role="button"
              tabIndex={-1}
              onClick={e => { e.stopPropagation(); onChange(null); setOpen(false) }}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                width: 18, height: 18, borderRadius: '50%',
                color: 'var(--color-text-subtle)',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--color-bg-tertiary)'; e.currentTarget.style.color = 'var(--color-text)' }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--color-text-subtle)' }}
              aria-label="Clear selection"
            >
              <X size={12} />
            </span>
          )}
          <ChevronDown
            size={14}
            style={{
              color: 'var(--color-text-subtle)',
              transition: 'transform 0.15s',
              transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          />
        </span>
      </button>

      {/* Dropdown: bottom sheet on mobile, absolute positioned on desktop */}
      {open && (
        isMobile ? (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 200,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'flex-end',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(0,0,0,0.3)',
              }}
              onClick={() => { setOpen(false); setQuery('') }}
            />
            <div
              style={{
                position: 'relative',
                background: 'var(--color-bg)',
                borderRadius: '1rem 1rem 0 0',
                boxShadow: '0 -4px 24px rgba(0,0,0,0.15)',
                overflow: 'hidden',
                maxHeight: '70vh',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
              }}
            >
              {/* Handle bar */}
              <div style={{ display: 'flex', justifyContent: 'center', padding: '0.5rem 0' }}>
                <div style={{ width: 36, height: 4, borderRadius: 2, background: 'var(--color-border)' }} />
              </div>
              {dropdownContent}
            </div>
          </div>
        ) : (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              zIndex: 100,
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-card)',
              boxShadow: 'var(--shadow-lg)',
              overflow: 'hidden',
            }}
          >
            {dropdownContent}
          </div>
        )
      )}
    </div>
  )
}
