import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('viewport card layouts recover from a cached 48px iframe without expanding local scrollers', { timeout: 30000 }, () => {
  execFileSync(process.execPath, ['tests/browser/frame-viewport-height-browser-smoke.mjs'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    timeout: 25000,
    stdio: 'pipe'
  })
})
