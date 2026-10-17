import path from 'node:path'
import {mkdir, open, readFile, rename, unlink} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import {checkedAssetPath} from './fork-card-storage.js'
import {createModRegistry} from './domain/mods/registry.js'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
const {modCheck:check, modFreeze} = contract
const emptyLocal = () => ({schemaVersion:1,revision:'0',mods:{}})
const queues = new Map()

// One host owns a profile. Serialize service instances too, including recovery after reload.
function serial(root, task) {
  const work = (queues.get(root) || Promise.resolve()).then(task), tail = work.catch(() => {})
  queues.set(root, tail)
  tail.finally(() => { if (queues.get(root) === tail) queues.delete(root) })
  return work
}

// Ports own native settings and Card Preparation raw; the private file owns only releases/packs.
// read -> {revision,value}; cards.list -> [{cardId,revision,value}], where value is modBindings or null.
// compareAndSwap({expectedRevision,expectedValue,value,cardId?}) is the owner's atomic writer.
export async function createModPersistence({root, settings, cards}) {
  root = path.resolve(root)
  const locate = relative => checkedAssetPath(root, relative)
  async function read(name) {
    try { return JSON.parse(await readFile(await locate(name), 'utf8')) }
    catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
  async function write(name, value) {
    const target = await locate(name), temporary = await locate(name + '.' + randomUUID() + '.tmp')
    await mkdir(path.dirname(target), {recursive:true})
    const file = await open(temporary, 'wx')
    try { await file.writeFile(JSON.stringify(value)); await file.sync() }
    finally { await file.close() }
    try { await rename(temporary, target) }
    catch (error) { await unlink(temporary).catch(() => {}); throw error }
  }
  const port = change => change.owner === 'settings' ? settings : cards
  const request = change => change.owner === 'settings' ? {} : {cardId:change.cardId}
  const conflict = message => check(false, '$.expectedRevision', message, 'MOD_REVISION_CONFLICT')
  let baseline, blocked = false
  async function snapshot() {
    const local = await read('state.json') || emptyLocal(), native = await settings.read(), rows = await cards.list()
    check(local.schemaVersion === 1, '$.schemaVersion', 'Unsupported mod library version', 'MOD_API_UNSUPPORTED')
    const bindings = Object.fromEntries(rows.filter(row => row.value !== null).map(row => [row.cardId,row.value]))
    baseline = {local, native, cards:new Map(rows.map(row => [row.cardId,row]))}
    return modFreeze(structuredClone({revision:local.revision,mods:local.mods,global:native.value.global,grants:native.value.grants,cards:bindings}))
  }
  async function finish(journal) {
    const local = await read('state.json') || emptyLocal()
    check(journal.version === 1 && local.schemaVersion === 1, '$.schemaVersion', 'Unsupported mod transaction version', 'MOD_API_UNSUPPORTED')
    if (![journal.beforeRevision,journal.next.revision].includes(local.revision)) conflict('Mod recovery conflicts with private library state')
    for (const change of journal.changes) {
      const owner = port(change), args = request(change), current = await owner.read(args)
      // A crash may occur after an owner commits but before its caller gets the receipt.
      if (equal(current.value,change.value)) continue
      if (current.revision !== change.before.revision || !equal(current.value,change.before.value)) conflict('Mod recovery conflicts with an independently edited owner')
      const receipt = await owner.compareAndSwap({...args,expectedRevision:current.revision,expectedValue:current.value,value:change.value})
      check(receipt !== false, '$.expectedRevision', 'Mod owner rejected publication', 'MOD_REVISION_CONFLICT')
    }
    if (local.revision !== journal.next.revision) await write('state.json',journal.next)
    await unlink(await locate('journal.json'))
  }
  await serial(root, async () => {
    const journal = await read('journal.json')
    if (journal) { await cards.list(); await finish(journal) }
    await snapshot()
  })
  return Object.freeze({
    load:() => serial(root, async () => {
      check(!blocked, '$', 'Mod transaction needs recovery before reading', 'MOD_RESOURCE_UNAVAILABLE')
      return snapshot()
    }),
    assertReady() { check(!blocked, '$', 'Mod transaction needs recovery before reading', 'MOD_RESOURCE_UNAVAILABLE') },
    publish(next, expectedRevision) { return serial(root, async () => {
      check(!blocked, '$', 'Mod transaction needs recovery', 'MOD_RESOURCE_UNAVAILABLE')
      const local = await read('state.json') || emptyLocal()
      if (local.revision !== expectedRevision || baseline.local.revision !== expectedRevision) conflict('Mod library changed')
      const nativeNow = await settings.read(), cardRows = await cards.list()
      if (nativeNow.revision !== baseline.native.revision || !equal(nativeNow.value,baseline.native.value)) conflict('Native mod settings changed; reload the library')
      const currentBindings = Object.fromEntries(cardRows.filter(row => row.value !== null).map(row => [row.cardId,row.value]))
      const previousBindings = Object.fromEntries([...baseline.cards].filter(([,row]) => row.value !== null).map(([id,row]) => [id,row.value]))
      if (!equal(currentBindings,previousBindings)) conflict('Card mod bindings changed; reload the library')
      const changes = [], native = {global:next.global,grants:next.grants}
      if (!equal(native,baseline.native.value)) changes.push({owner:'settings',before:baseline.native,value:native})
      for (const cardId of new Set([...baseline.cards.keys(),...Object.keys(next.cards)])) {
        const before = baseline.cards.get(cardId)
        const value = next.cards[cardId] ?? null
        if (equal(before?.value ?? null,value)) continue
        check(before, '$.cardId', 'Card must be resolved before editing mod bindings', 'MOD_RESOURCE_UNAVAILABLE')
        changes.push({owner:'card',cardId,before:{revision:before.revision,value:before.value},value})
      }
      // Preflight every owner before creating a durable intent; no side effects on stale requests.
      for (const change of changes) {
        const current = await port(change).read(request(change))
        if (current.revision !== change.before.revision || !equal(current.value,change.before.value)) conflict('Mod owner changed after the snapshot')
      }
      const journal = {version:1,beforeRevision:expectedRevision,next:{schemaVersion:1,revision:next.revision,mods:next.mods},changes}
      blocked = true
      try {
        await write('journal.json',journal)
        await finish(journal)
        check(equal(await snapshot(),next), '$.expectedRevision', 'Mod owners changed during publication; reopen the library', 'MOD_REVISION_CONFLICT')
        blocked = false
        return true
      } catch (error) {
        // Never roll back over an independent card/settings edit. Reopen to recover the exact intent.
        if (!await read('journal.json') && (await read('state.json') || emptyLocal()).revision === expectedRevision) blocked = false
        throw error
      }
    }) },
  })
}

export async function createModLibrary({root, settings, cards, ...registryOptions}) {
  const persistence = await createModPersistence({root,settings,cards})
  const registry = createModRegistry({...registryOptions,initial:await persistence.load(),publish:persistence.publish})
  return Object.freeze(Object.fromEntries(Object.entries(registry).map(([name,method]) => [name,(...args) => {
    persistence.assertReady()
    return method(...args)
  }])))
}
