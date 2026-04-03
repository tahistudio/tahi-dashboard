'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { apiPath } from '@/lib/api'

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MentionPerson {
  id: string
  name: string
  type: 'team_member' | 'contact'
  role: string | null
  avatarUrl: string | null
  email: string
}

export interface MentionState {
  /** Whether the mention dropdown is currently visible */
  isOpen: boolean
  /** The text typed after the "@" trigger character */
  query: string
  /** Index of the "@" character in the input value */
  triggerIndex: number
  /** Filtered results to display */
  results: MentionPerson[]
  /** Currently keyboard-highlighted index */
  highlightIndex: number
  /** Loading state for fetch */
  loading: boolean
}

interface UseMentionsOptions {
  /** If provided, contacts for this org will also be fetched */
  orgId?: string | null
  /** Whether current user is admin (controls which endpoints to call) */
  isAdmin?: boolean
  /** Called when a mention is selected */
  onMention?: (personId: string, personType: 'team_member' | 'contact') => void
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMentions(options: UseMentionsOptions = {}) {
  const { orgId, isAdmin = false, onMention } = options

  const [people, setPeople] = useState<MentionPerson[]>([])
  const [peopleFetched, setPeopleFetched] = useState(false)
  const [state, setState] = useState<MentionState>({
    isOpen: false,
    query: '',
    triggerIndex: -1,
    results: [],
    highlightIndex: 0,
    loading: false,
  })

  const abortRef = useRef<AbortController | null>(null)

  // Fetch people (team members + optionally contacts)
  const fetchPeople = useCallback(async () => {
    if (peopleFetched) return
    if (abortRef.current) abortRef.current.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setState(s => ({ ...s, loading: true }))

    try {
      const fetches: Promise<MentionPerson[]>[] = []

      if (isAdmin) {
        fetches.push(
          fetch(apiPath('/api/admin/team'), { signal: controller.signal })
            .then(r => (r.ok ? r.json() : { items: [] }) as Promise<{ items?: Array<{ id: string; name: string; role: string | null; avatarUrl: string | null; email: string; title: string | null }> }>)
            .then(data =>
              (data.items ?? []).map(m => ({
                id: m.id,
                name: m.name,
                type: 'team_member' as const,
                role: m.title ?? m.role,
                avatarUrl: m.avatarUrl ?? null,
                email: m.email,
              }))
            )
        )

        if (orgId) {
          fetches.push(
            fetch(apiPath(`/api/admin/clients/${orgId}/contacts`), { signal: controller.signal })
              .then(r => (r.ok ? r.json() : { contacts: [] }) as Promise<{ contacts?: Array<{ id: string; name: string; role: string | null; email: string }> }>)
              .then(data =>
                (data.contacts ?? []).map(c => ({
                  id: c.id,
                  name: c.name,
                  type: 'contact' as const,
                  role: c.role,
                  avatarUrl: null,
                  email: c.email,
                }))
              )
          )
        }
      }

      const results = await Promise.all(fetches)
      const merged = results.flat()
      setPeople(merged)
      setPeopleFetched(true)
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      setPeople([])
    } finally {
      setState(s => ({ ...s, loading: false }))
    }
  }, [isAdmin, orgId, peopleFetched])

  // Clean up abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortRef.current) abortRef.current.abort()
    }
  }, [])

  // Filter people based on query
  const filterPeople = useCallback(
    (query: string): MentionPerson[] => {
      if (!query) return people.slice(0, 10)
      const q = query.toLowerCase()
      return people.filter(
        p =>
          p.name.toLowerCase().includes(q) ||
          (p.role?.toLowerCase().includes(q) ?? false) ||
          p.email.toLowerCase().includes(q)
      ).slice(0, 10)
    },
    [people]
  )

  // Open the mention dropdown
  const openMention = useCallback(
    (triggerIndex: number, query: string) => {
      if (!peopleFetched) {
        void fetchPeople()
      }
      const results = filterPeople(query)
      setState({
        isOpen: true,
        query,
        triggerIndex,
        results,
        highlightIndex: 0,
        loading: !peopleFetched,
      })
    },
    [peopleFetched, fetchPeople, filterPeople]
  )

  // Update the query while dropdown is open
  const updateQuery = useCallback(
    (query: string) => {
      const results = filterPeople(query)
      setState(s => ({
        ...s,
        query,
        results,
        highlightIndex: 0,
      }))
    },
    [filterPeople]
  )

  // Close the mention dropdown
  const closeMention = useCallback(() => {
    setState(s => ({
      ...s,
      isOpen: false,
      query: '',
      triggerIndex: -1,
      results: [],
      highlightIndex: 0,
    }))
  }, [])

  // Select a person from the dropdown
  const selectMention = useCallback(
    (person: MentionPerson) => {
      if (onMention) {
        onMention(person.id, person.type)
      }
      closeMention()
      return person
    },
    [onMention, closeMention]
  )

  // Set highlight index directly (for mouse hover)
  const setHighlightIndex = useCallback((index: number) => {
    setState(s => ({ ...s, highlightIndex: index }))
  }, [])

  // Move highlight up
  const highlightUp = useCallback(() => {
    setState(s => ({
      ...s,
      highlightIndex: Math.max(0, s.highlightIndex - 1),
    }))
  }, [])

  // Move highlight down
  const highlightDown = useCallback(() => {
    setState(s => ({
      ...s,
      highlightIndex: Math.min(s.results.length - 1, s.highlightIndex + 1),
    }))
  }, [])

  // Select the currently highlighted person
  const selectHighlighted = useCallback(() => {
    const person = state.results[state.highlightIndex]
    if (person) return selectMention(person)
    return null
  }, [state.results, state.highlightIndex, selectMention])

  // Re-filter when people load
  useEffect(() => {
    if (state.isOpen && peopleFetched) {
      const results = filterPeople(state.query)
      setState(s => ({ ...s, results, loading: false }))
    }
  }, [peopleFetched, state.isOpen, state.query, filterPeople])

  return {
    state,
    openMention,
    updateQuery,
    closeMention,
    selectMention,
    selectHighlighted,
    setHighlightIndex,
    highlightUp,
    highlightDown,
  }
}
