// private fork: themes never enter director admission; saved normalized ops remain readable.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {syntheticPack,cardExtension,PACK_ID} from './fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {prepareAssetPackDirector,buildAssetPackRequest,createAssetPackTransaction,assetPackStateAt,readAssetPackRecord} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
const ref = id => ({packId:PACK_ID,kind:'skins',assetId:id})
const legacy = JSON.parse(await readFile(new URL('./fixtures/stage-skins/legacy-record.json',import.meta.url)))
async function fixture() {
 const pack=await syntheticPack()
 pack.manifest.assets.push({kind:'skins',id:'paper',name:'Paper',recall:{mode:'constant',keywords:['dream']},directorNote:'A dream on paper.',bundleKey:'paper',entry:'skin.json'})
 const input={raw:{extensions:{dsh_tavern:cardExtension()}},snapshots:[{...pack,revision:'r1'}],assetStatus:Object.fromEntries(pack.manifest.assets.map(a=>[assetRefKey({packId:PACK_ID,kind:a.kind,assetId:a.id}),{available:true}])),cardRevision:'c1',engine:{},target:{sourceKey:'s1',branchId:'b1',revision:1},units:['A dream.','Another page.','The last page.']}
 return {input,prepare:()=>prepareAssetPackDirector(input)}
}
function transaction(prepared){return createAssetPackTransaction({prepared,getCurrentBinding:()=>prepared.binding})}
const batch=ops=>({sequence:1,through:3,done:true,beats:ops.length?[{at:1,ops}]:[]})
test('historical normalized skin levels and off replay without rewriting operations or digests',()=>{
 const before=JSON.stringify(legacy)
 assert.doesNotThrow(()=>readAssetPackRecord(legacy))
 assert.deepEqual(assetPackStateAt(legacy,1).skin,{ref:ref('paper'),level:2})
 assert.deepEqual(assetPackStateAt(legacy,2).skin,{ref:ref('paper'),level:3})
 assert.deepEqual(assetPackStateAt(legacy,3).skin,{ref:null})
 assert.equal(JSON.stringify(legacy),before)
})
test('skin commands cannot be submitted, including off for a carried legacy skin',async()=>{
 const f=await fixture()
 for(const op of [{op:'skin.set',ref:ref('paper')},{op:'skin.off'},{op:'performance.set',ref:ref('paper')}]) {
  const tx=transaction(f.prepare()), result=tx.submit(batch([op]))
  assert.equal(result.ok,false);assert.equal(result.accepted,0)
 }
 f.input.record=legacy
 const tx=transaction(f.prepare());assert.equal(tx.submit(batch([])).ok,true)
 assert.deepEqual(tx.effect().end.skin,{ref:null})
})
test('constant, hard-triggered, carried and fill skins never become recall rows or catalogue entries',async()=>{
 const f=await fixture(),asset=f.input.snapshots[0].manifest.assets.find(a=>a.kind==='skins')
 for(let i=0;i<10;i++) {
  f.input.snapshots[0].manifest.assets.push({...asset,id:'extra-'+i})
  f.input.assetStatus[assetRefKey(ref('extra-'+i))]={available:true}
 }
 f.input.record=legacy
 const p=f.prepare(),request=buildAssetPackRequest(p,true,undefined,'',true)
 assert.deepEqual(p.context.catalogue.candidates.skins,[])
 assert.ok(p.context.catalogue.rows.every(row=>row.ref.kind!=='skins'))
 assert.ok(request.sections.every(s=>s.key!=='skins'))
 assert.doesNotMatch(JSON.stringify(request.tools),/skin\.set|skin\.off|"skins"/)
 assert.doesNotMatch(JSON.stringify(request.messages),/skin\.set|skin\.off/)
})
test('skin-free grammar shrinks and theme inventory costs zero prompt bytes',async()=>{
 const f=await fixture(), relevant=buildAssetPackRequest(f.prepare(),true,undefined,'',true)
 f.input.snapshots[0].manifest.assets=f.input.snapshots[0].manifest.assets.filter(a=>a.kind!=='skins')
 const absent=buildAssetPackRequest(f.prepare(),true,undefined,'',true)
 assert.deepEqual(absent.tools,relevant.tools)
 assert.equal(absent.inputBytes,relevant.inputBytes)
 // Skin inventory remains free, and moving performance into its mod must not grow the core grammar.
 assert.doesNotMatch(JSON.stringify(relevant.tools),/performance\.(?:set|clear)/)
 assert.ok(Buffer.byteLength(JSON.stringify(relevant.tools)) < 8666,'core tools stay below the pre-P5 schema budget')
 console.log('theme-free toolSchemaBytes:',Buffer.byteLength(JSON.stringify(relevant.tools)))
})
