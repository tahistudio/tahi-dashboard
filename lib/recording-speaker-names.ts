export interface RecordingSpeakerNames {
  mic: string
  system: string
}

export interface RecordingTeamMember {
  id: string
  name: string
  email: string
  clerkUserId: string | null
}

function cleaned(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** Resolve names from the chosen call, never by guessing a client from audio. */
export function recordingSpeakerNames(
  createdById: string,
  team: readonly RecordingTeamMember[],
  attendees: unknown,
  clientName?: string | null,
): RecordingSpeakerNames {
  const creator = team.find(member => member.id === createdById || member.clerkUserId === createdById)
  const mic = cleaned(creator?.name) || 'Me'
  let parsed: unknown = attendees
  if (typeof parsed === 'string') {
    try { parsed = JSON.parse(parsed) as unknown } catch { parsed = [] }
  }
  const remote = new Map<string, string>()
  if (Array.isArray(parsed)) {
    for (const value of parsed) {
      if (!value || typeof value !== 'object') continue
      const attendee = value as Record<string, unknown>
      const id = cleaned(attendee.id)
      const email = cleaned(attendee.email).toLowerCase()
      const name = cleaned(attendee.name)
      const onTeam = attendee.type === 'team_member' || attendee.type === 'team'
        || team.some(member => (id && (member.id === id || member.clerkUserId === id))
          || (email && member.email.trim().toLowerCase() === email)
          || (!id && !email && name && member.name.trim().toLowerCase() === name.toLowerCase()))
      if (onTeam || (!id && !email && !name)) continue
      remote.set(email || id || name.toLowerCase(), name)
    }
  }
  const onlyRemote = remote.size === 1 ? [...remote.values()][0] : ''
  const client = cleaned(clientName)
  return { mic, system: onlyRemote || (client ? `Them (${client})` : 'Them') }
}
