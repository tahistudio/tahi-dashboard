/**
 * components/tahi/shell-icons.tsx - the app shell's icon set.
 *
 * These are the EXACT icons from the "Tahi App Shell" Claude Design prototype
 * (not Lucide substitutes), so the shell renders pixel-identical to the design.
 * 24x24 viewBox, stroke = currentColor, 2px round stroke. Multi-subpath glyphs
 * are stored as a single string with subpaths separated by " M" and split on
 * render (matching the prototype's Icon component).
 *
 * Usage: <ShellIcon n="requests" s={18} />  (s = pixel size, default 18)
 * Solid glyphs (play, square) override stroke with fill in their own paths via
 * the `solid` set.
 */

import * as React from 'react'

export type ShellIconName =
  | 'overview' | 'requests' | 'tasks' | 'messages' | 'leads' | 'calls' | 'deals'
  | 'proposals' | 'schedules' | 'contracts' | 'calculator' | 'salesanalytics'
  | 'affiliates' | 'clients' | 'content' | 'sitemap' | 'social' | 'reviews'
  | 'announcements' | 'invoices' | 'billing' | 'time' | 'financialreports'
  | 'reports' | 'capacity' | 'team' | 'docs' | 'files' | 'services' | 'settings'
  | 'search' | 'bell' | 'currency' | 'private' | 'theme' | 'sun' | 'impersonate'
  | 'chevron' | 'collapse' | 'expand' | 'plus' | 'lock' | 'dots' | 'arrow'
  | 'check' | 'checks' | 'more' | 'close' | 'clock' | 'play' | 'pause' | 'square'

const P: Record<ShellIconName, string> = {
  overview: 'M3 11l9-8 9 8 M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10',
  requests: 'M22 12h-6l-2 3h-4l-2-3H2 M5.5 5.5h13l3 6.5v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-5z',
  tasks: 'M9 11l3 3L22 4 M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  messages: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  leads: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6',
  calls: 'M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z',
  deals: 'M3 3v18h18 M7 14l4-4 3 3 5-6',
  proposals: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M9 13h6 M9 17h4',
  schedules: 'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  contracts: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8.5 15c1-1.2 2-1.2 3 0s2 1.2 3 0',
  calculator: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M8 6h8 M8 11h.01 M12 11h.01 M16 11h.01 M8 15h.01 M12 15h.01 M16 15h.01',
  salesanalytics: 'M3 3v18h18 M7 16v-5 M12 16V8 M17 16v-3',
  affiliates: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M8.6 13.5l6.8 4 M15.4 6.5l-6.8 4',
  clients: 'M3 21h18 M5 21V7l8-4v18 M19 21V11l-6-4 M9 9v.01 M9 13v.01 M9 17v.01',
  content: 'M12 20h9 M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z',
  sitemap: 'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M15 6a9 9 0 0 1-9 9',
  social: 'M3 11l18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6',
  reviews: 'M12 2l2.9 6.3 6.9.6-5.2 4.6 1.6 6.8L12 17.3 5.8 20.9l1.6-6.8L2.2 9.5l6.9-.6z',
  announcements: 'M3 11l18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6 M21 8v4',
  invoices: 'M5 2v20l2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1z M9 7h6 M9 11h6 M9 15h4',
  billing: 'M2 7h20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z M1 11h22',
  time: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  financialreports: 'M21.2 12A9 9 0 1 1 12 2.8 M12 12V3a9 9 0 0 1 9 9z',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M8 13v4 M12 11v6 M16 14v3',
  capacity: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 12l4-2 M12 12V7',
  team: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
  docs: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z',
  files: 'M3 7a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  services: 'M3 3h7v7H3z M14 3h7v7h-7z M14 14h7v7h-7z M3 14h7v7H3z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z M21 21l-4.3-4.3',
  bell: 'M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9 M13.73 21a2 2 0 0 1-3.46 0',
  currency: 'M12 1v22 M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6',
  private: 'M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19 M6.61 6.61A18.5 18.5 0 0 0 1 12s4 8 11 8a9.12 9.12 0 0 0 5.39-1.61 M1 1l22 22 M14.12 14.12a3 3 0 1 1-4.24-4.24',
  theme: 'M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10z M12 1v2 M12 21v2 M4.2 4.2l1.4 1.4 M18.4 18.4l1.4 1.4 M1 12h2 M21 12h2 M4.2 19.8l1.4-1.4 M18.4 5.6l1.4-1.4',
  impersonate: 'M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  chevron: 'M6 9l6 6 6-6',
  collapse: 'M11 17l-5-5 5-5 M18 17l-5-5 5-5',
  expand: 'M13 17l5-5-5-5 M6 17l5-5-5-5',
  plus: 'M12 5v14 M5 12h14',
  lock: 'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',
  dots: 'M12 6.5v.01 M12 12v.01 M12 17.5v.01',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  check: 'M20 6L9 17l-5-5',
  checks: 'M2 12L5.5 15.5L12 8 M9 12L12.5 15.5L19 8',
  more: 'M4 12h16 M4 6h16 M4 18h16',
  close: 'M18 6L6 18 M6 6l12 12',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z M12 7.5V12l3 1.8',
  play: 'M7 5.4l12 6.6-12 6.6z',
  pause: 'M9 5v14 M15 5v14',
  square: 'M6.5 6.5h11v11h-11z',
}

// Glyphs that are filled shapes rather than strokes.
const SOLID = new Set<ShellIconName>(['play', 'square'])

export function ShellIcon({ n, s = 18, className }: { n: ShellIconName; s?: number; className?: string }) {
  const d = P[n]
  const solid = SOLID.has(n)
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill={solid ? 'currentColor' : 'none'}
      stroke={solid ? 'none' : 'currentColor'}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {d.split(' M').map((seg, i) => (
        <path key={i} d={i ? 'M' + seg : seg} />
      ))}
    </svg>
  )
}
