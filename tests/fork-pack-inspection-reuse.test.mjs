import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectPackScripts, sealPack, verifyBytes} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/validation.js'
import {validatePerformancePack} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/performance-bundle.js'
import {validatePackDocuments} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/index.js'
import {syntheticPack, PACK_ID, OTHER_PACK_ID} from './fixtures/asset-packs/pack.mjs'

test('document validation preserves manifest, identity and figure closure gates', async () => {
  const pack = await syntheticPack()
  assert.deepEqual(validatePackDocuments(pack),{manifest:pack.manifest,figures:pack.figures,sprites:pack.sprites})
  assert.throws(() => validatePackDocuments({...pack,manifest:{...pack.manifest,unknown:true}}),{code:'UNKNOWN_FIELD'})
  assert.throws(() => validatePackDocuments({...pack,manifest:{...pack.manifest,figures:[...pack.manifest.figures,...pack.manifest.figures]}}),{code:'DUPLICATE_ID'})
  assert.throws(() => validatePackDocuments({...pack,figures:{}}),{code:'FILE_CLOSURE_MISMATCH'})
})

test('script inspection keeps file and asset order, exact bundle ownership and variable consent', () => {
  const asset = (id, bundleKey) => ({kind:'widgets', id, name:id, bundleKey, entry:'widget.json'})
  const assets = [asset('first','clock'), asset('adjacent','clock-copy'), asset('shared','clock'), {kind:'music',id:'not-widget',bundleKey:'clock'}]
  const variables = {reads:{state:{path:'/state'}}, writes:{value:{path:'/value',scope:'value'},tree:{path:'/tree',scope:'subtree'}}}
  const pack = {manifest:{id:PACK_ID,name:'Pack',assets},files:new Map([
    ['bundles/clock/code.js',Buffer.from('run()')],
    ['bundles/clock-copy/index.html',Buffer.from('<p onclick="run()">Click</p>')],
    ['bundles/clock-other/code.js',Buffer.from('run()')],
    ['credits/code.ts',Buffer.from('run()')],
    ['bundles/clock/safe.css',Buffer.from('p{color:red}')]
  ]),widgets:Object.fromEntries(assets.filter(a => a.kind === 'widgets').map(a => [a.id,{variables}]))}
  const row = (path, widget) => ({packId:PACK_ID,packName:'Pack',path,...(widget ? {widgetId:widget.id,widgetName:widget.name} : {})})
  assert.deepEqual(inspectPackScripts(pack),[
    row('bundles/clock/code.js',assets[0]),row('bundles/clock/code.js',assets[2]),
    row('bundles/clock-copy/index.html',assets[1]),row('bundles/clock-other/code.js'),row('credits/code.ts'),
    ...assets.slice(0,3).map(a => ({...row('bundles/'+a.bundleKey+'/widget.json',a),variables:{
      reads:[{id:'state',path:'/state',includesChildren:true}],
      writes:[{id:'value',path:'/value',scope:'value',includesChildren:false},{id:'tree',path:'/tree',scope:'subtree',includesChildren:true}]
    }}))
  ])
})

test('unchanged credits are decoded once at ingress; replacements and external bytes are validated', async t => {
  const pack = await syntheticPack(), name = 'credits/reference.txt', original = pack.files.get(name)
  const decode = TextDecoder.prototype.decode
  let creditDecodes = 0
  t.mock.method(TextDecoder.prototype, 'decode', function (bytes, ...options) {
    if (bytes === original) creditDecodes++
    return decode.call(this, bytes, ...options)
  })
  const previous = await verifyBytes(pack.manifest,pack.files)
  assert.equal(creditDecodes,1)
  const reused = await verifyBytes(pack.manifest,pack.files,{previous,sealed:true})
  assert.deepEqual(reused,previous)
  assert.equal(creditDecodes,1,'Local edits reuse the validated Buffer')
  await verifyBytes(pack.manifest,pack.files)
  assert.equal(creditDecodes,2,'An external entry without previous still decodes')

  const manifest = structuredClone(pack.manifest), files = new Map(pack.files)
  files.set(name,Buffer.from([0xff]))
  await sealPack(manifest,files,previous)
  await assert.rejects(verifyBytes(manifest,files,{previous,sealed:true}),/encoded data was not valid/)
  await assert.rejects(verifyBytes(manifest,files),/encoded data was not valid/)
  files.set(name,Buffer.from('Valid replacement'))
  await sealPack(manifest,files,previous)
  assert.equal((await verifyBytes(manifest,files,{previous,sealed:true})).files.get(name),files.get(name))
})

test('performance dependency lookup keeps kinds, local aliases and external boundaries distinct', () => {
  const performance = {schema:'dsh.performance/1',id:'show',label:'Show',license:{privateUse:false},packs:{local:PACK_ID,external:OTHER_PACK_ID},levels:{default:2,1:{},2:{},3:{}},sfxMap:{bell:'local:bell',remote:'external:remote'},timeline:{entry:{events:[]},exit:{events:[]}}}
  const manifest = {id:PACK_ID,assets:[{kind:'music',id:'bell'},{kind:'performances',id:'show'}]}
  assert.throws(() => validatePerformancePack(manifest,{show:performance},{}),{code:'MISSING_DEPENDENCY'})
  manifest.assets.push({kind:'sfx',id:'bell'})
  assert.equal(validatePerformancePack(manifest,{show:performance},{}).show,performance)
  performance.sfxMap.bell = 'self:bell'
  assert.equal(validatePerformancePack(manifest,{show:performance},{}).show,performance)
  performance.sfxMap.bell = 'self:missing'
  assert.throws(() => validatePerformancePack(manifest,{show:performance},{}),{code:'MISSING_DEPENDENCY'})
})
