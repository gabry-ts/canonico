import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// Dates are formatted in the local time zone: pin it so the expected strings are the same everywhere.
process.env.TZ = 'UTC'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    environmentOptions: { jsdom: { url: 'http://localhost:5173/' } },
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.{ts,tsx}'],
    // The API client reads this once, when it is first imported.
    env: { VITE_API_URL: 'http://api.test' },
    restoreMocks: true,
    unstubGlobals: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/api/schema.ts', 'src/main.tsx', 'src/**/*.d.ts'],
      reporter: ['text', 'html'],
    },
  },
})
