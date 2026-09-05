/** The client detail first-paint skeleton. */

// ── Loading skeleton ───────────────────────────────────────────────────────────

export function LoadingSkeleton() {
  return (
    <div className="p-6 animate-pulse">
      <div className="h-8 bg-[var(--color-bg-tertiary)] rounded-lg w-64 mb-4" />
      <div className="h-4 bg-[var(--color-bg-tertiary)] rounded w-32 mb-6" />
      <div className="grid grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="h-48 bg-[var(--color-bg-tertiary)] rounded-xl" />
          <div className="h-64 bg-[var(--color-bg-tertiary)] rounded-xl" />
        </div>
        <div className="space-y-4">
          <div className="h-40 bg-[var(--color-bg-tertiary)] rounded-xl" />
          <div className="h-32 bg-[var(--color-bg-tertiary)] rounded-xl" />
        </div>
      </div>
    </div>
  )
}
