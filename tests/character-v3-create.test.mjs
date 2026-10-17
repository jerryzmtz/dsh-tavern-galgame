// private fork: card create-and-bind is retired; figures are authored in the library only.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdir,mkdtemp} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {createAssetPackService} from '../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
async function fixture(t){
 const base=fileURLToPath(new URL('../.tmp/',import.meta.url));await mkdir(base,{recursive:true})
 const root=await mkdtemp(join(base,'figure-create-')),service=createAssetPackService({assetRoot:join(root,'assets')})
 t.after(()=>service.dispose())
 const pack=(await service.createPack({name:'Figures',expectedRevision:null})).snapshot
 const created=await service.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,name:'Snow',outfits:[{key:'daily',label:'Daily',enabled:true}]}})
 return {service,created:{packId:pack.manifest.id,figureId:created.figureId}}
}
test('new library figures default to green and Live2D without a card transaction',async t=>{
 const f=await fixture(t),pack=await f.service.getPackSnapshot({packId:f.created.packId}),figure=pack.figures[f.created.figureId]
 assert.equal(figure.appearance,'live2d');assert.equal(figure.enabled,true)
 assert.deepEqual(figure.recall,{mode:'keyword'})
 assert.equal(f.service.createFigureWithCard,undefined)
})
// private fork: deletion uses the same CAS, seal and publish path as other figure edits.
test('patchFigure explicitly deletes optional fields and rejects invalid deletes atomically',async t=>{
  const f=await fixture(t)
  const {packId,figureId}=f.created
  let snapshot=await f.service.getPackSnapshot({packId})
  const patch=async value=>{const result=await f.service.patchFigure({packId,figureId,expectedRevision:snapshot.revision,patch:value});snapshot=result.snapshot;return snapshot.figures[figureId]}
  await patch({heightCm:170,imageColor:'#123456',aliases:['Snow']})
  assert.equal((await patch({name:'Snow'})).heightCm,170,'omission preserves')
  for(const value of [{outfits:[]},{name:null},{enabled:null},{outfits:null},{schemaVersion:null},{id:null},{unknown:null}]){
    await assert.rejects(patch(value))
    assert.deepEqual(await f.service.getPackSnapshot({packId}),snapshot,'invalid deletion publishes nothing')
  }
  const stale=snapshot.revision
  const figure=await patch({outfits:[],heightCm:null,aliases:null})
  assert.equal(Object.hasOwn(figure,'heightCm'),false);assert.equal(Object.hasOwn(figure,'aliases'),false)
  assert.equal(figure.imageColor,'#123456');assert.deepEqual(figure.outfits,[])
  await assert.rejects(f.service.patchFigure({packId,figureId,expectedRevision:stale,patch:{imageColor:null}}),error=>error.code==='REVISION_CONFLICT')
  await patch({imageColor:null,voice:null,emotions:null,heightBasis:null,elevationCm:null,extensions:null})
  assert.deepEqual(snapshot.figures[figureId],{schemaVersion:1,id:figureId,name:'Snow',enabled:true,appearance:'live2d',recall:{mode:'keyword'},outfits:[]})
})
