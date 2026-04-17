/**
 * Form input primitives : <Input>, <Select>, <Textarea>, <InputGroup>.
 *
 * One set of tokenised styles (height, focus ring, radius, font) so every
 * form field in the app looks identical. Per DESIGN.md "Dropdowns: prefer
 * native" rule, <Select> wraps a native <select> element.
 *
 *   <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" />
 *
 *   <Input.Group>
 *     <Input.Icon><Search /></Input.Icon>
 *     <Input value={q} onChange={e => setQ(e.target.value)} />
 *     <Input.Addon><kbd>⌘K</kbd></Input.Addon>
 *   </Input.Group>
 *
 *   <Select value={v} onChange={e => setV(e.target.value)} options={[
 *     { value: 'all', label: 'All statuses' },
 *     { value: 'open', label: 'Open' },
 *   ]} />
 *
 *   <Textarea rows={3} value={body} onChange={e => setBody(e.target.value)} />
 *
 * Sizes: sm (2rem) · md (2.25rem default) · lg (2.5rem)
 * Tones: default · danger (error) · success
 */

import React from 'react'
import { ChevronDown } from 'lucide-react'

// ── Types ───────────────────────────────────────────────────────────────────

type Size = 'sm' | 'md' | 'lg'
type Tone = 'default' | 'danger' | 'success'

const SIZE_HEIGHT: Record<Size, string> = {
  sm: '2rem',
  md: '2.25rem',
  lg: '2.5rem',
}

const SIZE_PADDING: Record<Size, string> = {
  sm: 'var(--space-1) var(--space-2-5, 0.625rem)',
  md: 'var(--space-1-5) var(--space-3)',
  lg: 'var(--space-2) var(--space-4)',
}

const SIZE_FONT: Record<Size, string> = {
  sm: 'var(--text-xs)',
  md: 'var(--text-sm)',
  lg: 'var(--text-base)',
}

function toneBorderColor(tone: Tone, hasValue: boolean) {
  if (tone === 'danger') return 'var(--color-danger)'
  if (tone === 'success') return 'var(--color-brand)'
  return hasValue ? 'var(--color-border)' : 'var(--color-border-subtle)'
}

// ── Input ───────────────────────────────────────────────────────────────────

interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> {
  inputSize?: Size
  tone?: Tone
  leadingIcon?: React.ReactNode
  trailingIcon?: React.ReactNode
}

function InputRoot({
  inputSize = 'md',
  tone = 'default',
  leadingIcon,
  trailingIcon,
  className,
  style,
  value,
  ...rest
}: InputProps) {
  const hasValue = Boolean(value)

  if (leadingIcon || trailingIcon) {
    // When icons are set, render in group-style automatically
    return (
      <div
        className={className}
        style={{
          display: 'flex',
          alignItems: 'center',
          height: SIZE_HEIGHT[inputSize],
          padding: '0 var(--space-2)',
          gap: 'var(--space-2)',
          background: 'var(--color-bg)',
          border: `1px solid ${toneBorderColor(tone, hasValue)}`,
          borderRadius: 'var(--radius-md)',
          transition: 'border-color 150ms ease, box-shadow 150ms ease',
          ...style,
        }}
      >
        {leadingIcon && <span style={{ color: 'var(--color-text-subtle)', display: 'flex', flexShrink: 0 }}>{leadingIcon}</span>}
        <input
          {...rest}
          value={value}
          style={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            fontSize: SIZE_FONT[inputSize],
            color: 'var(--color-text)',
          }}
        />
        {trailingIcon && <span style={{ color: 'var(--color-text-subtle)', display: 'flex', flexShrink: 0 }}>{trailingIcon}</span>}
      </div>
    )
  }

  return (
    <input
      {...rest}
      value={value}
      className={className}
      style={{
        height: SIZE_HEIGHT[inputSize],
        padding: SIZE_PADDING[inputSize],
        fontSize: SIZE_FONT[inputSize],
        background: 'var(--color-bg)',
        border: `1px solid ${toneBorderColor(tone, hasValue)}`,
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text)',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        outline: 'none',
        ...style,
      }}
    />
  )
}

// ── Input.Group / Icon / Addon ──────────────────────────────────────────────

function InputGroup({ children, className, style, inputSize = 'md' as Size, ...rest }: React.HTMLAttributes<HTMLDivElement> & { inputSize?: Size }) {
  return (
    <div
      {...rest}
      className={className}
      style={{
        display: 'flex',
        alignItems: 'center',
        height: SIZE_HEIGHT[inputSize],
        padding: '0 var(--space-2)',
        gap: 'var(--space-2)',
        background: 'var(--color-bg)',
        border: '1px solid var(--color-border-subtle)',
        borderRadius: 'var(--radius-md)',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

function InputIcon({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={className}
      style={{
        color: 'var(--color-text-subtle)',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

function InputAddon({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <span
      className={className}
      style={{
        color: 'var(--color-text-subtle)',
        fontSize: 'var(--text-xs)',
        display: 'flex',
        alignItems: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </span>
  )
}

// ── Inner bare input for InputGroup ────────────────────────────────────────

function InputBare(props: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> & { inputSize?: Size }) {
  const { inputSize = 'md', style, ...rest } = props
  return (
    <input
      {...rest}
      style={{
        flex: 1,
        minWidth: 0,
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontSize: SIZE_FONT[inputSize],
        color: 'var(--color-text)',
        ...style,
      }}
    />
  )
}

// ── Select (native) ─────────────────────────────────────────────────────────

interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  selectSize?: Size
  tone?: Tone
  options: readonly SelectOption[]
  /** Visually highlights the select when a non-default value is picked. */
  highlightActive?: boolean
  /** The "default" value that should NOT look highlighted (usually 'all'). */
  defaultLikeValue?: string
}

export function Select({
  selectSize = 'md',
  tone = 'default',
  options,
  highlightActive = false,
  defaultLikeValue = 'all',
  value,
  className,
  style,
  ...rest
}: SelectProps) {
  const isActive = highlightActive && value !== undefined && value !== defaultLikeValue

  return (
    <div style={{ position: 'relative', display: 'inline-block' }} className={className}>
      <select
        {...rest}
        value={value}
        style={{
          appearance: 'none',
          height: SIZE_HEIGHT[selectSize],
          padding: `0 var(--space-8) 0 var(--space-3)`,
          fontSize: SIZE_FONT[selectSize],
          fontWeight: 500,
          background: isActive ? 'var(--color-brand-50)' : 'var(--color-bg)',
          border: `1px solid ${isActive ? 'var(--color-brand)' : toneBorderColor(tone, false)}`,
          borderRadius: 'var(--radius-md)',
          color: isActive ? 'var(--color-brand-dark)' : 'var(--color-text)',
          cursor: 'pointer',
          outline: 'none',
          transition: 'border-color 150ms ease, background 150ms ease, color 150ms ease',
          ...style,
        }}
      >
        {options.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown
        size={14}
        aria-hidden="true"
        style={{
          position: 'absolute',
          right: 'var(--space-2)',
          top: '50%',
          transform: 'translateY(-50%)',
          color: 'var(--color-text-subtle)',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}

// ── Textarea ────────────────────────────────────────────────────────────────

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  tone?: Tone
}

export function Textarea({
  tone = 'default',
  className,
  style,
  value,
  ...rest
}: TextareaProps) {
  const hasValue = Boolean(value)
  return (
    <textarea
      {...rest}
      value={value}
      className={className}
      style={{
        padding: 'var(--space-3)',
        fontSize: 'var(--text-sm)',
        background: 'var(--color-bg)',
        border: `1px solid ${toneBorderColor(tone, hasValue)}`,
        borderRadius: 'var(--radius-md)',
        color: 'var(--color-text)',
        transition: 'border-color 150ms ease, box-shadow 150ms ease',
        outline: 'none',
        resize: 'vertical',
        fontFamily: 'inherit',
        lineHeight: 1.5,
        width: '100%',
        minHeight: '5rem',
        ...style,
      }}
    />
  )
}

// ── Compound export ─────────────────────────────────────────────────────────

export const Input = Object.assign(InputRoot, {
  Group: InputGroup,
  Icon: InputIcon,
  Addon: InputAddon,
  Bare: InputBare,
})
