'use client'

/** <HealthNoteCard>. The saved one-liner about why this client is where it is. */

import { cn } from '@/lib/utils'

export function HealthNoteCard({ note, health }: { note: string; health: string | null }) {
  const colours =
    health === 'red'   ? 'bg-red-50 border-red-100 text-red-700' :
    health === 'amber' ? 'bg-amber-50 border-amber-100 text-amber-700' :
    'bg-emerald-50 border-emerald-100 text-emerald-700'

  return (
    <div className={cn('rounded-xl border p-4 text-sm', colours)}>
      <p className="font-medium mb-0.5">Health note</p>
      <p className="text-xs opacity-80">{note}</p>
    </div>
  )
}
