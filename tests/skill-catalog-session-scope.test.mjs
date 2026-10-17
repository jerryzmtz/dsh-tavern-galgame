import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { installSkillCatalogSessionScope } from '../tavern-plugin/lib/domain/skill-catalog-session-scope.js'
import { createTavernSkillProvider } from '../tavern-plugin/lib/domain/tavern-skill-provider.js'
const pluginRequire = createRequire(new URL('../tavern-plugin/package.json', import.meta.url))
const hostRequire = createRequire(pluginRequire.resolve('@deepseek-ai/dsh-tools'))
const { SessionSkillCatalog } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-api-session-controller')))
const { scopeChainOf } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-scope')))

test('native skills/list works for concurrent cold card and story sessions and reuses separate keys', async () => {
  const standing = {}, keys = new Map()
  const catalog = Object.create(SessionSkillCatalog.prototype)
  const skill = { name: 'debug-card', path: '/skills/debug-card/SKILL.md', agents: ['card'], userInvocable: true, modelInvocable: true }
  const provider = createTavernSkillProvider({ providers: [{ list: async () => [skill] }], library: { read: async () => skill }, roleFor: async scope => scope?.session?.id === 'card' ? 'card' : 'foreground' })
  const skills = { list: async lookup => {
    keys.set(lookup.scope.session.id, lookup.scope)
    return (await provider.list(lookup)).candidates
  } }
  Object.defineProperty(catalog, 'ctx', { value: {
    agents: { get: () => undefined },
    sessionQuery: { observeSession: async () => ({ header: { cwd: '/workspace' }, projections: { values: { agentPreset: 'tavern' } }, [Symbol.dispose]() {} }) },
    get: name => name === 'skills' ? skills : { standingKeyFor: async () => standing }
  } })
  const restore = installSkillCatalogSessionScope(catalog)
  const [card, story] = await Promise.all([catalog.list({ sessionId: 'card' }), catalog.list({ sessionId: 'story' })])
  assert.deepEqual(card.skills.map(s => s.name), ['debug-card'])
  assert.deepEqual(story.skills, [])
  assert.notEqual(keys.get('card'), keys.get('story'))
  const before = keys.get('card')
  await catalog.list({ sessionId: 'card' })
  assert.equal(keys.get('card'), before)
  restore()
})
