import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  // Runs clerkSetup() once: loads .env.local and fetches the Clerk testing token
  // so sign-up / sign-in flows bypass bot detection. See e2e/global-setup.ts.
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    // No basePath: the app serves at the domain root on Cloudflare direct
    // (the old Webflow Cloud /dashboard basePath is retired).
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-safari',
      use: { ...devices['iPhone 13'] },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    // CI normally starts its own server so that nothing is reused between
    // runs. The tenancy job is the exception: it has to build the local D1 and
    // replay the runtime migration route against a running server before a
    // single test may start, so it starts the dev server itself and sets
    // PLAYWRIGHT_REUSE_SERVER=1 to have Playwright attach rather than refuse
    // the busy port. See .github/workflows/e2e-tenancy.yml.
    reuseExistingServer: !process.env.CI || process.env.PLAYWRIGHT_REUSE_SERVER === '1',
    timeout: 120_000,
  },
})
