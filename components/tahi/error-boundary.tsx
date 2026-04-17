'use client'

import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallbackTitle?: string
  fallbackDescription?: string
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '4rem 2rem',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              width: '3.5rem',
              height: '3.5rem',
              borderRadius: '0 16px 0 16px',
              background: 'var(--color-danger-bg)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '1rem',
            }}
          >
            <AlertTriangle
              style={{ width: '1.5rem', height: '1.5rem', color: 'var(--color-danger)' }}
            />
          </div>
          <h2
            style={{
              fontSize: '1.125rem',
              fontWeight: 600,
              color: 'var(--color-text)',
              marginBottom: '0.5rem',
            }}
          >
            {this.props.fallbackTitle ?? 'Something went wrong'}
          </h2>
          <p
            style={{
              fontSize: '0.875rem',
              color: 'var(--color-text-muted)',
              maxWidth: '24rem',
              marginBottom: '1.5rem',
              lineHeight: 1.5,
            }}
          >
            {this.props.fallbackDescription ?? 'An unexpected error occurred. Please try refreshing the page.'}
          </p>
          <button
            onClick={() => {
              this.setState({ hasError: false, error: null })
              window.location.reload()
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.625rem 1.25rem',
              fontSize: '0.875rem',
              fontWeight: 600,
              color: 'white',
              background: 'var(--color-brand)',
              border: 'none',
              borderRadius: '0 10px 0 10px',
              cursor: 'pointer',
            }}
          >
            <RefreshCw style={{ width: '0.875rem', height: '0.875rem' }} />
            Refresh Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
