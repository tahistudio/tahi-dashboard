import type { Metadata, Viewport } from 'next'
import { ClerkProvider } from '@clerk/nextjs'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Tahi Dashboard',
    template: '%s | Tahi Dashboard',
  },
  description: 'Tahi Studio client portal and operations dashboard.',
  manifest: '/dashboard/manifest.json',
  icons: {
    icon: '/dashboard/favicon.png',
    apple: '/dashboard/favicon.png',
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
    <ClerkProvider>
      <html lang="en" suppressHydrationWarning>
        <head>
          <meta name="apple-mobile-web-app-capable" content="yes" />
          <meta name="apple-mobile-web-app-status-bar-style" content="default" />
          <meta name="apple-mobile-web-app-title" content="Tahi Dashboard" />
          <link rel="apple-touch-icon" href="/dashboard/favicon.png" />
          <script
            dangerouslySetInnerHTML={{
              __html: `try{if(localStorage.getItem('tahi-theme')==='dark'){document.documentElement.classList.add('dark')}}catch(e){}`,
            }}
          />
          <script
            dangerouslySetInnerHTML={{
              __html: `if('serviceWorker' in navigator){navigator.serviceWorker.register('/dashboard/sw.js').catch(function(){})}`,
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
