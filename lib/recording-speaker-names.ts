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
        || email.endsWith('@tahi.studio')
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

/** Keys of the per-recording rename map: the mic track, a single system voice, or one diarized voice. */
export const SPEAKER_KEY_PATTERN = /^(mic|system|system:\d{1,3})$/
export const MAX_SPEAKER_NAME_LENGTH = 80
export const MAX_SPEAKER_OVERRIDES = 24

export type RecordingSpeakerOverrides = Record<string, string>

/** One line, no control characters, bounded. A name can never forge a transcript line break. */
export function cleanSpeakerName(value: unknown): string {
  if (typeof value !== 'string') return ''
  const printable = Array.from(value, character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || code === 0x2028 || code === 0x2029 ? ' ' : character
  }).join('')
  return printable.replace(/\s+/g, ' ').trim().slice(0, MAX_SPEAKER_NAME_LENGTH).trim()
}

/** Lenient read of a stored map: drops anything malformed rather than failing a render. */
export function readSpeakerOverrides(value: unknown): RecordingSpeakerOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: RecordingSpeakerOverrides = {}
  for (const [key, name] of Object.entries(value as Record<string, unknown>)) {
    const cleaned = cleanSpeakerName(name)
    if (SPEAKER_KEY_PATTERN.test(key) && cleaned && !cleaned.includes(':') && Object.keys(result).length < MAX_SPEAKER_OVERRIDES) result[key] = cleaned
  }
  return result
}

export type SpeakerRenameResult =
  | { ok: true; value: Record<string, string | null> }
  | { ok: false; error: string }

/** Strict parse of a rename request. A null or empty name resets that speaker to its default label. */
export function parseSpeakerRenames(value: unknown): SpeakerRenameResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'speakerNames must be an object of speaker key to name.' }
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (!entries.length) return { ok: false, error: 'Provide at least one speaker to rename.' }
  if (entries.length > MAX_SPEAKER_OVERRIDES) return { ok: false, error: 'Too many speakers in one rename.' }
  const result: Record<string, string | null> = {}
  for (const [key, name] of entries) {
    if (!SPEAKER_KEY_PATTERN.test(key)) return { ok: false, error: `Unknown speaker key "${key.slice(0, 40)}".` }
    if (name === null) { result[key] = null; continue }
    if (typeof name !== 'string') return { ok: false, error: 'Speaker names must be text, or null to reset.' }
    if (name.includes(':')) return { ok: false, error: 'Speaker names cannot contain a colon.' }
    if (name.length > 500) return { ok: false, error: `Speaker names are limited to ${MAX_SPEAKER_NAME_LENGTH} characters.` }
    const cleaned = cleanSpeakerName(name)
    if (name.trim() && !cleaned) return { ok: false, error: 'Speaker names must contain readable text.' }
    result[key] = cleaned || null
  }
  return { ok: true, value: result }
}

/** Merge a rename request into the stored map. Null removes an override. */
export function applySpeakerRenames(
  current: RecordingSpeakerOverrides, renames: Record<string, string | null>,
): { ok: true; value: RecordingSpeakerOverrides } | { ok: false; error: string } {
  const next: RecordingSpeakerOverrides = { ...current }
  for (const [key, name] of Object.entries(renames)) {
    if (name === null) delete next[key]
    else next[key] = name
  }
  if (Object.keys(next).length > MAX_SPEAKER_OVERRIDES) return { ok: false, error: 'Too many renamed speakers on this recording.' }
  return { ok: true, value: next }
}
