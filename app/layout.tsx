import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Tahi Dashboard',
    template: '%s | Tahi Dashboard',
  },
  description: 'Tahi Studio client portal and operations dashboard.',
  manifest: '/manifest.json',
  icons: {
    icon: '/favicon.png',
    apple: '/favicon.png',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Tahi',
  },
  formatDetection: {
    telephone: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#5A824E',
  colorScheme: 'light dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    // Both Clerk fallbacks route through /choose-workspace rather than straight
    // to a destination. A session that has just been created has no ACTIVE
    // Clerk organisation, even for someone who already accepted an organisation
    // invitation, so landing on /overview or /onboarding decided the person's
    // audience before anyone had looked at their memberships (a teammate was
    // being sent into client onboarding). The chooser looks, calls setActive,
    // then forwards. Mirrored in next.config.ts
    // NEXT_PUBLIC_CLERK_SIGN_*_FALLBACK_REDIRECT_URL.
    <ClerkProvider
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      signInFallbackRedirectUrl="/choose-workspace?next=%2Foverview"
      signUpFallbackRedirectUrl="/choose-workspace?next=%2Foverview"
      localization={{
        signUp: {
          start: {
            title: 'Create your workspace',
            subtitle: 'Takes about a minute.',
          },
          emailCode: {
            title: 'Check your email',
            subtitle: 'Enter the 6-digit code we just sent you.',
          },
        },
        signIn: {
          start: {
            title: 'Welcome back',
            subtitle: 'Sign in to pick up where you left off.',
          },
        },
      }}
    >
      <html lang="en" suppressHydrationWarning>
        <head>
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <meta name="apple-mobile-web-app-title" content="Tahi Dashboard" />
          <link rel="apple-touch-icon" href="/favicon.png" />
          <script
            dangerouslySetInnerHTML={{
              __html: `try{if(localStorage.getItem('tahi-theme')==='dark'){document.documentElement.classList.add('dark')}if(localStorage.getItem('tahi-reduce-motion')==='true'){document.documentElement.classList.add('reduce-motion')}}catch(e){}`,
            }}
          />
          {/* Sidebar collapsed-state persistence. Runs before body
              parses so the data attribute is set on <html> before the
              sidebar is even in the DOM. Mirrors the theme script
              above. Setting an unused attribute on sign-in routes is
              harmless. The 'tahi-sidebar-start-collapsed' preference
              (Settings > Appearance) seeds each new browser session
              collapsed exactly once (sessionStorage guard), so the
              user's in-session chevron toggle is never overridden. */}
          <script
            dangerouslySetInnerHTML={{
              __html: `try{if(localStorage.getItem('tahi-sidebar-start-collapsed')==='true'&&!sessionStorage.getItem('tahi-sidebar-seeded')){sessionStorage.setItem('tahi-sidebar-seeded','1');localStorage.setItem('tahi-sidebar','collapsed')}if(localStorage.getItem('tahi-sidebar')==='collapsed'){document.documentElement.setAttribute('data-sidebar','collapsed')}}catch(e){}`,
            }}
          />
          <script
            dangerouslySetInnerHTML={{
              __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){})}`,
            }}
          />
        </head>
        <body className="min-h-screen bg-[var(--color-bg)] text-[var(--color-text)] antialiased">
          {children}
        </body>
      </html>
    </ClerkProvider>
  )
}
