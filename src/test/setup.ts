import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Vitest runs without globals, so React Testing Library cannot register its own
// automatic cleanup: do it explicitly instead of leaking DOM between tests.
afterEach(() => {
  cleanup()
})
