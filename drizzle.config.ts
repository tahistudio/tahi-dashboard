import type { Config } from 'drizzle-kit'

export default {
  schema: './db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'sqlite',
  // For local development : uses local SQLite file
  dbCredentials: {
    url: 'file:./dev.db',
  },
} satisfies Config
