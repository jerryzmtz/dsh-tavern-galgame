// private fork: resolve host-only packages from the explicitly selected runtime, without links.
import Module, { createRequire, registerHooks } from 'node:module'
import { pathToFileURL } from 'node:url'

if (process.env.DSH_BOOT_MODULE) {
  const parentURL = pathToFileURL(process.env.DSH_BOOT_MODULE).href
  const runtime = createRequire(parentURL)
  const bare = name => !/^(?:[./]|[a-z]+:)/i.test(name)
  registerHooks({ resolve(name, context, next) {
    try { return next(name, context) }
    catch (error) {
      if (!bare(name) || !['ERR_MODULE_NOT_FOUND', 'MODULE_NOT_FOUND'].includes(error.code)) throw error
      return next(name, { ...context, parentURL })
    }
  } })
  const original = Module._resolveFilename
  let resolving = false
  Module._resolveFilename = function (name, ...args) {
    try { return original.call(this, name, ...args) }
    catch (error) {
      if (resolving || !bare(name) || error.code !== 'MODULE_NOT_FOUND') throw error
      resolving = true
      try { return runtime.resolve(name) } finally { resolving = false }
    }
  }
}
