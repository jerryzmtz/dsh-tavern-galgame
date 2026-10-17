// private fork: cross-pack picker search reads metadata only; no live profiles, model calls or leases.
import test from 'node:test'
import assert from 'node:assert/strict'
import {searchPackFigures} from '../tavern-plugin/lib/domain/figure-search.js'
import {createCardAssetBoundary,cardAssetWorkspaceRevision} from '../tavern-plugin/lib/fork-card-asset-bindings.js'
import {syntheticPack,cardExtension,PACK_ID,FIGURE_ID,OTHER_PACK_ID,OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
const THIRD='55555555-5555-4555-8555-555555555555', FOURTH='66666666-6666-4666-8666-666666666666'
async function packs() {
  const template=await syntheticPack()
  return [PACK_ID,OTHER_PACK_ID,THIRD,FOURTH].map((id,i)=>{
    const pack=structuredClone(template)
    pack.manifest.id=id;pack.manifest.name=['Bound','Global','Closed','Other bound'][i];pack.revision='r'+i
    pack.figures[FIGURE_ID].name=['小雪','御坂美琴','Neuro','Another'][i]
    return pack
  })
}
const search=items=>searchPackFigures({packs:items,query:'',boundPackIds:[FOURTH,PACK_ID],globalEnabledPackIds:[OTHER_PACK_ID]})

test('search groups the current pack first, then bound order, global and closed without excluding disabled or empty figures',async()=>{
  const items=await packs(),empty={schemaVersion:1,id:OTHER_FIGURE_ID,name:'Empty',enabled:false,outfits:[]}
  items[2].manifest.figures.push(OTHER_FIGURE_ID);items[2].figures[OTHER_FIGURE_ID]=empty
  const before=structuredClone(items),result=search(items)
  assert.deepEqual(result.groups.map(g=>[g.packId,g.state]),[[FOURTH,'bound'],[PACK_ID,'bound'],[OTHER_PACK_ID,'global'],[THIRD,'off']])
  assert.equal(result.groups.at(-1).figures.length,2)
  assert.equal(result.groups.at(-1).figures.at(-1).enabled,false)
  assert.deepEqual(result.groups.at(-1).figures.at(-1).forms,[])
  const current=searchPackFigures({packs:items,query:'',boundPackIds:[PACK_ID],globalEnabledPackIds:[OTHER_PACK_ID],current:{packId:THIRD,figureId:OTHER_FIGURE_ID}})
  assert.equal(current.groups[0].packId,THIRD);assert.equal(current.groups[0].figures[0].current,true)
  assert.deepEqual(items,before)
})
test('NFKC name, figure alias and pack name searches include closed packs, but never match internal UUIDs',async()=>{
  const items=await packs()
  items[2].figures[FIGURE_ID].aliases=['Neuro-sama','網絡少女']
  for(const query of ['ｎｅｕｒｏ','NEURO-SAMA','網絡少女','Closed']) {
    const result=searchPackFigures({packs:items,query,boundPackIds:[],globalEnabledPackIds:[]})
    assert.deepEqual(result.groups.map(g=>g.packId),[THIRD])
  }
  assert.equal(searchPackFigures({packs:items,query:FIGURE_ID,boundPackIds:[],globalEnabledPackIds:[]}).groups.length,0)
})
test('search uses first enabled outfit, carries imageColor and avatar metadata, never voices or model source',async()=>{
  const items=await packs(),figure=items[0].figures[FIGURE_ID]
  figure.imageColor='#123456';figure.autoColor='#9ea0d7';figure.outfits[0].enabled=false
  const row=search(items).groups.find(g=>g.packId===PACK_ID).figures[0]
  assert.deepEqual(row.forms,['live2d','sprite']);assert.equal(row.imageColor,'#123456')
  assert.equal(row.avatar.hash,figure.outfits[1].avatars.calm)
  assert.equal(row.autoColor,'#9ea0d7') // private fork: retain both values so auto/manual state is not guessed.
  assert.deepEqual(Object.keys(row).sort(),['autoColor','avatar','current','enabled','forms','imageColor','name','ref'])
})
test('broken packs report diagnostics rather than silently hiding matching available figures',async()=>{
  const result=search([...(await packs()),{packId:'broken',error:{code:'BAD_HASH',message:'private filesystem path'}}])
  assert.equal(result.groups.length,4)
  assert.deepEqual(result.diagnostics,[{code:'PACK_UNAVAILABLE',packId:'broken'}])
})
// private fork: library search remains; the card-scoped binding picker/RPC does not.
test('card boundary exposes neither search nor create-and-bind',()=>{
 const boundary=createCardAssetBoundary({ctx:{get:()=>null}})
 assert.equal(boundary.searchFigures,undefined);assert.equal(boundary.createFigure,undefined)
})
