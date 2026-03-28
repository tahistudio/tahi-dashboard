export const metadata = { title: 'Offline - Tahi Dashboard' }

export default function OfflinePage() {
  return (
    <div
      className="flex flex-col items-center justify-center min-h-screen text-center"
      style={{ padding: '2rem', background: 'var(--color-bg)' }}
    >
      <div
        className="flex items-center justify-center brand-gradient mb-6"
        style={{
          width: '4rem',
          height: '4rem',
          borderRadius: 'var(--radius-leaf)',
        }}
      >
        <svg
          width="32"
          height="32"
          viewBox="0 0 24 24"
          fill="none"
          stroke="white"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <line x1="1" y1="1" x2="23" y2="23" />
          <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
          <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
          <path d="M10.71 5.05A16 16 0 0 1 22.56 9" />
          <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
          <line x1="12" y1="20" x2="12.01" y2="20" />
        </svg>
      </div>
      <h1
        className="text-xl font-bold mb-2"
        style={{ color: 'var(--color-text)' }}
      >
        You are offline
      </h1>
      <p
        className="text-sm max-w-xs"
        style={{ color: 'var(--color-text-muted)' }}
      >
        Please check your internet connection and try again. The dashboard requires
        an active connection to load.
      </p>
    </div>
  )
}
