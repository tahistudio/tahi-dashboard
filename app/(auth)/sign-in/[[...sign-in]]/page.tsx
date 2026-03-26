import { ClerkSignIn } from '@/components/tahi/clerk-mount'

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--color-bg-secondary)]">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 mb-4">
            <div
              className="w-10 h-10 brand-gradient flex items-center justify-center"
              style={{ borderRadius: 'var(--radius-leaf-sm)' }}
            >
              <span className="text-white font-bold text-lg">T</span>
            </div>
            <span className="text-xl font-bold text-[var(--color-text)]">Tahi Studio</span>
          </div>
          <p className="text-[var(--color-text-muted)] text-sm">Sign in to your dashboard</p>
        </div>
        <ClerkSignIn
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'shadow-lg border border-[var(--color-border)] rounded-[var(--radius-card)]',
              headerTitle: 'hidden',
              headerSubtitle: 'hidden',
            },
          }}
        />
      </div>
    </div>
  )
}
