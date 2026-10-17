import assert from 'node:assert/strict'
import {createPluginHost} from './plugin-host.mjs'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {resolveTavernDataRoot} from '../../tavern-plugin/lib/domain/tavern-data.js'
import {installedComposition} from './installed-composition.mjs'
import {readFile} from 'node:fs/promises'
import path from 'node:path'

const withAssets = process.argv.includes('--assets')
const composition = await installedComposition({home:process.env.DSH_HOME, absent:!withAssets})
assert.equal(composition.entries.filter(entry => entry.id === 'dsh-asset-library').length, withAssets ? 1 : 0)
assert.equal(composition.manifest.dshTavern.dataRoot, resolveTavernDataRoot())
const store = createProfileDataStore({dataRoot:composition.manifest.dshTavern.dataRoot})
await store.writeJson('resources/cards/a.json', {meta:{id:'card-a', name:'A'}, raw:{name:'A'}})
await store.writeJson('sessions.json', {session:'chat'})
await store.writeJson('chats/chat.json', {id:'chat', sessionId:'session', cardPath:'cards/a.json', mode:'story', messages:[], backgroundConfigVersion:1, conversationFeaturesVersion:1})
// Deliberately present legacy bytes: neither activation nor v2 CRUD may consume them.
await store.writeJson('card-assets/card-a/backgrounds/index.json', {version:1, backgrounds:[{id:'room', name:'Room', sha:'', description:'retained'}]})
const indexPath = path.join(composition.manifest.dshTavern.dataRoot, 'card-assets/card-a/backgrounds/index.json')
const before = await readFile(indexPath)
const host = await createPluginHost({composition})
try {
  assert.equal(typeof host.services.get('tavernSessionSignals')?.control, 'function')
  if (withAssets) {
    const service = host.services.get('assetLibrary')
    assert.equal(service.apiVersion, 2)
    assert.deepEqual(await service.listPacks(), [], 'seeds/legacy directories never become runtime catalogues')
    assert.equal(service.listLibraries, undefined)
    assert.equal(host.nativeRoutes.has('/api/dsh-asset-library/v1/control'), false)
    const control = host.nativeRoutes.get('/api/dsh-asset-library/v2/control')
    assert.equal(typeof control, 'function')
    const call = (method, args, origin = 'http://localhost') => control(new Request('http://dsh.internal/api/dsh-asset-library/v2/control', {method:'POST', headers:{host:'localhost', origin, 'content-type':'application/json'}, body:JSON.stringify({method,args})}))
    const settingsResponse = await call('settings')
    assert.equal(settingsResponse.status, 200)
    assert.deepEqual((await settingsResponse.json()).values.globalEnabledPackIds, [])
    assert.equal((await call('capabilities', {}, 'https://evil.invalid')).status, 403)
    assert.equal((await call('getPlan', {sessionId:'session'})).status, 400)
    const created = await call('createPack', {name:'Native v2', expectedRevision:null})
    assert.equal(created.status, 200, await created.clone().text())
    const {snapshot} = await created.json()
    assert.equal((await service.listPacks())[0].manifest.name, 'Native v2')
    const manifestPath = path.join(composition.manifest.dshTavern.assetRoot, 'packs', snapshot.manifest.id, 'manifest.json')
    assert.equal(JSON.parse(await readFile(manifestPath, 'utf8')).id, snapshot.manifest.id)
    await host.disableAssets()
    assert.equal(host.nativeRoutes.size, 0)
    assert.equal(host.services.has('assetLibrary'), false)
    assert.equal((await call('capabilities')).status, 503, 'disposed handler cannot reuse the service')
  } else {
    assert.equal(host.nativeRoutes.size, 0)
    assert.equal(host.services.has('assetLibrary'), false)
  }
  assert.deepEqual(await readFile(indexPath), before, 'old asset bytes are not migrated or rewritten')
  console.log('asset composition passed: ' + (withAssets ? 'v2 enabled then disabled' : 'absent'))
} finally { await host.dispose() }
