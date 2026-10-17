import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// Resolve the host's scope registry, not a second copy with a different WeakMap.
const hostRequire = createRequire(createRequire(import.meta.url).resolve('@deepseek-ai/dsh-tools'))
const { bindScopeParent } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-scope')).href)

// DSH 0.1.5-rc.2's cold menu lookup only supplies the shared preset scope.
// Preserve its ancestry while giving Tavern a session identity and isolated cache key.
export function installSkillCatalogSessionScope(catalog) {
  if (typeof catalog?.scopeFor !== 'function') throw new Error('Skill catalog scopeFor is unavailable')
  const original = catalog.scopeFor
  const scopes = new Map()
  async function scopeFor(sessionId, preset) {
    const parent = await original.call(this, sessionId, preset)
    if (parent?.session?.id) return parent
    const cached = scopes.get(sessionId)
    if (cached?.parent === parent && cached?.preset === preset) return cached.scope
    const scope = { session: { id: sessionId } }
    bindScopeParent(scope, parent)
    scopes.delete(sessionId)
    scopes.set(sessionId, { parent, preset, scope })
    if (scopes.size > 512) scopes.delete(scopes.keys().next().value)
    return scope
  }
  catalog.scopeFor = scopeFor
  return () => {
    if (catalog.scopeFor === scopeFor) catalog.scopeFor = original
    scopes.clear()
  }
}
