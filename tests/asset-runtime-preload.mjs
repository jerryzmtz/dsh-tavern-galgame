// Read-only fallback for native asset-plugin tests in dependency-free worktrees.
// The installed runtime is an explicit test input; no links or package installation.
import Module, { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

if (process.env.DSH_TEST_BROWSER_DEPENDENCIES) {
  // Browser fixtures use the repository's React 19 dev dependency, not runtime React 18.
  const require = createRequire(process.env.DSH_TEST_BROWSER_DEPENDENCIES)
  const files = new Map(['react', 'scheduler', 'react-dom', 'react-dom/client'].map(name => [name, require.resolve(name)]))
  const original = Module._resolveFilename
  Module._resolveFilename = function (request, parent, ...args) {
    if (parent?.filename?.replaceAll('\\', '/').endsWith('/tests/fixtures/browser-react.mjs') && files.has(request)) return files.get(request)
    return original.call(this, request, parent, ...args)
  }
}

if (process.env.DSH_BOOT_MODULE) {
  const parentURL = pathToFileURL(process.env.DSH_BOOT_MODULE).href
  registerHooks({resolve(specifier, context, next) {
    try { return next(specifier, context) }
    catch (error) {
      if (!specifier.startsWith('@deepseek-ai/') || !['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error
      return next(specifier, {...context, parentURL})
    }
  }})
}
