import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorldBookLibrary } from '../tavern-plugin/lib/domain/worldbook-library.js'
import { createTavernScriptHostAdapter } from '../tavern-plugin/lib/domain/tavern-script-host-adapter.js'

for (const kind of ['standalone', 'embedded', 'multiple', 'opening']) test('模板快照内共享资源解析且下次读取保持新鲜：' + kind, async () => {
  let cardReads = 0, bookReads = 0
  const book = name => ({ name, entries: { 0: { uid: 0, comment: name, key: [], content: '原内容', constant: true } } })
  const documents = { a: book('A'), b: book('B') }
  const card = { name: '角色', character_book: documents.a }
  const chat = { id: 'chat', sessionId: 's', cardPath: 'card', mode: 'story', _storageRevision: 1, messages: [] }
  if (kind === 'opening') chat.openingWorldbookSnapshot = { version: 1, source: { kind: 'standalone', path: 'a' }, document: documents.a }
  let binding = kind === 'multiple' ? { kind, sources: ['a','b'].map(path => ({ kind: 'standalone', path, available: true })) }
    : kind === 'embedded' ? { kind, cardPath: 'card', available: true } : { kind: 'standalone', path: 'a', available: true }
  const readCard = async () => { cardReads++; return structuredClone(card) }
  const worldBooks = createWorldBookLibrary({ normalizePath: value => value, removeStandalone() {}, cards: { read: readCard }, resources: {
    bindingForCard: async () => binding,
    readText: async path => { bookReads++; return JSON.stringify(documents[path]) }
  } })
  const adapter = createTavernScriptHostAdapter({ resolveChat: async () => structuredClone(chat), writeChat() {}, readCard,
    worldBooks, scriptDispatch: {} })
  const first = await adapter.readFullPromptTemplateState('s')
  assert.equal(cardReads, 1)
  assert.equal(bookReads, kind === 'multiple' ? 2 : kind === 'standalone' ? 1 : 0)
  assert.match(JSON.stringify(first.environment.worldbooks), /原内容/)
  documents.a.entries[0].content = '外部更新'
  cardReads = 0; bookReads = 0
  const next = await adapter.readFullPromptTemplateState('s', first.cursor)
  assert.equal(cardReads, 1)
  assert.equal(bookReads, kind === 'multiple' ? 2 : kind === 'standalone' ? 1 : 0)
  assert.match(JSON.stringify(next.delta.environment.set.worldbooks), /外部更新/)
  // Caller edits must not poison a future snapshot.
  const values = Object.values(next.delta.environment.set.worldbooks)
  Object.values(values[0].entries)[0].content = '污染'
  const fresh = await adapter.readFullPromptTemplateState('s')
  assert.doesNotMatch(JSON.stringify(fresh.environment.worldbooks), /污染/)
  if (kind === 'standalone') {
    binding = { kind: 'standalone', path: 'b', available: true }
    const rebound = await adapter.readFullPromptTemplateState('s', fresh.cursor)
    assert.deepEqual(Object.keys(rebound.delta.environment.set.worldbooks), ['B'])
  }
})

test('模板专用快照按实际内容复用，改名、修改、损坏和删除立即可见', async () => {
  let text = JSON.stringify({ name: 'A', entries: { 0: { uid: 0, content: 'original' } } })
  let filename = 'a.json', reads = 0
  const library = createWorldBookLibrary({ normalizePath: x => x, removeStandalone() {}, cards: { read: async () => ({ name: 'C' }) }, resources: {
    bindingForCard: async () => ({ kind: 'standalone', path: filename, available: true }),
    readText: async () => { reads++; return text }
  } })
  const a = await library.templateSnapshot('card')
  const b = await library.templateSnapshot('card')
  assert.equal(a, b, 'unchanged resources reuse the immutable template snapshot')
  assert.equal(reads, 2, 'content freshness must still be checked')
  assert.throws(() => { a.worldbooks.A.entries[0].content = 'poison' }, TypeError)
  text = text.replace('original', 'modified')
  const changed = await library.templateSnapshot('card')
  assert.notEqual(changed, a)
  assert.equal(changed.worldbooks.A.entries[0].content, 'modified')
  assert.equal(a.worldbooks.A.entries[0].content, 'original')
  text = '{"entries":{}}'
  filename = 'renamed.json'
  assert.equal((await library.templateSnapshot('card')).worldName, 'renamed')
  text = '{broken'
  await assert.rejects(library.templateSnapshot('card'), /JSON/)
  text = undefined
  await assert.rejects(library.templateSnapshot('card'), /不存在/)
})

for (const kind of ['standalone', 'embedded', 'multiple', 'opening']) test('模板只读快照与原导出等价且不冻结权威输入：' + kind, async () => {
  const { exportSillyTavernWorldBook } = await import('../tavern-plugin/lib/domain/worldbook-resource.js')
  const embedded = { entries: [{ id: 7, keys: ['word'], content: 'embedded', extensions: { custom: { preserved: true } } }] }
  const native = { entries: { 7: { uid: 7, content: 'native' } } }
  const card = { name: 'Card', character_book: embedded }
  const chat = { id: 'chat' }
  if (kind === 'opening') chat.openingWorldbookSnapshot = { version: 1, source: { kind: 'standalone', path: 'native.json' }, document: native }
  const library = createWorldBookLibrary({ normalizePath: x => x, removeStandalone() {}, cards: { read: async () => card }, resources: {
    readText: async () => JSON.stringify(native),
    bindingForCard: async () => kind === 'multiple' ? { kind, sources: [{ kind: 'embedded', cardPath: 'card', available: true }, { kind: 'standalone', path: 'native.json', available: true }] }
      : kind === 'embedded' ? { kind, cardPath: 'card', available: true } : { kind: 'standalone', path: 'native.json', available: true }
  } })
  const previous = await library.bound('card', card, chat)
  const snapshot = await library.templateSnapshot('card', card, chat)
  assert.equal(snapshot.worldName, previous.view.displayName)
  assert.deepEqual(snapshot.worldbooks[snapshot.worldName], exportSillyTavernWorldBook(previous.document))
  assert.equal(Object.isFrozen(card), false)
  assert.equal(Object.isFrozen(embedded), false)
  assert.equal(Object.isFrozen(native), false)
  if (kind === 'opening') assert.equal(Object.isFrozen(chat.openingWorldbookSnapshot.source), false)
})
