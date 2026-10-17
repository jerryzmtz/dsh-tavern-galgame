// private fork: tool receipts use the CLI v1 envelope; saved record diagnostics are unchanged.
// private fork: canonical CG state, partial validation, per-turn quota and semantic recall.
import test from 'node:test'
import assert from 'node:assert/strict'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {syntheticPack, cardExtension, PACK_ID, FIGURE_ID,distinctMedia} from './fixtures/asset-packs/pack.mjs'
import { assetRefKey } from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import { prepareAssetPackDirector, createAssetPackTransaction, assetPackStateAt, buildAssetPackRequest, readAssetPackRecord } from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import { recallAssetPacks, assetPackDigest } from '../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import directorCommands from '../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs'
import { resolveOpeningScene } from '../tavern-plugin/lib/domain/stage-opening-scene.js'
import { greetingKey } from '../tavern-plugin/lib/domain/card-opening-scenes.js'
import {cgPromptRow} from '../tavern-plugin/lib/domain/stage-cg.js'
import {validateAsset} from '../tavern-plugin/packages/dsh-asset-library/src/asset-packs/manifest.js'
// private fork: the independent four-byte Unicode budget probe is a regression fixture.
test('maximum Unicode CG row stays below 8 KiB without media or focus coordinates',()=>{
  const glyph='\u{1f41f}',key=i=>('v'+i).padEnd(64,'a')
  const asset={kind:'cg',id:'r'.repeat(64),name:glyph.repeat(256),enabled:true,directorNote:glyph.repeat(60),recall:{mode:'constant',keywords:[]},
    variants:{default:key(0),entries:Array.from({length:16},(_,i)=>({id:key(i),name:glyph.repeat(32),content:{description:glyph.repeat(80),media:'a'.repeat(64),focusHints:Array.from({length:8},(_,j)=>({key:key(j),label:glyph.repeat(24),x:0.5,y:0.5,zoom:2}))}}))}}
  validateAsset(asset)
  const row={asset,label:asset.name,ref:{packId:PACK_ID,kind:'cg',assetId:asset.id}} // private fork
  const wire=JSON.stringify(cgPromptRow(row,{}))
  assert.ok(Buffer.byteLength(wire)<=8192);
  assert.equal(JSON.parse(wire).variants.default,key(0));assert.equal(JSON.parse(wire).variants.entries.length,16)
  assert.doesNotMatch(wire,/"media"|"x"|"y"|"zoom"|https?:/)
  asset.name='\u0001'.repeat(256);assert.throws(()=>validateAsset(asset),{code:'INVALID_ASSET_PACK'})
})
test('CG prose truncation keeps complete sentences or words within the existing budget', () => {
  const asset = {directorNote:'Event CG: Dafeiyu eating white rice at the PC. Already contains the character.', variants:{default:'base',entries:[{id:'base',name:'Base',content:{description:'A character eating rice beside a computer desk.',media:'a'.repeat(64)}}]}}
  const row = cgPromptRow({asset,label:'Rice',ref:{packId:PACK_ID,kind:'cg',assetId:'rice'}})
  assert.equal(row.directorNote,'Event CG: Dafeiyu eating white rice at the PC.')
  assert.deepEqual(row.variants,{default:'base',entries:[{id:'base',name:'Base'}]})
  assert.equal(JSON.stringify(row).includes('A character eating'),false)
  assert.equal(asset.directorNote.endsWith('the character.'),true)
  asset.directorNote = 'Short description.'
  assert.equal(cgPromptRow({asset}).directorNote,asset.directorNote)
})
const ref = id => ({packId:PACK_ID,kind:'cg',assetId:id})
async function fixture() {
  const pack = await syntheticPack(), image = Object.keys(pack.manifest.blobs).find(hash=>pack.manifest.blobs[hash].mime==='image/png')
  // private fork: operation fixtures explicitly enable choices, never depend on fill.
  pack.manifest.assets.filter(a => ['music','backgrounds','looks'].includes(a.kind)).forEach(a => a.recall.mode = 'constant')
  for (const id of ['rice','door','third']) pack.manifest.assets.push({kind:'cg',id,name:id,enabled:true,directorNote:'A full illustration.',recall:{mode:'constant',keywords:[]},variants:{default:'base',entries:[{id:'base',name:'Base',content:{description:'Eating.',media:image,focusHints:[{key:'face',label:'Face',x:0.5,y:0.3,zoom:1.5}]}},{id:'turn',name:'Turn',content:{description:'Turning.',media:image,focusHints:[{key:'face',label:'Face',x:0.5,y:0.3,zoom:1.5}]}}]}})
  pack.manifest.assets=pack.manifest.assets.map(asset=>asset.kind==='cg'?distinctMedia(asset,asset.id):asset)
  const extension = cardExtension()
  // private fork: old CG records can contain two actor keys for one ref; preserve both.
  const actor={figure:{packId:PACK_ID,figureId:FIGURE_ID},outfits:[]}
  const baseline=initialAssetPackStage({actor,second:structuredClone(actor)})
  const input = {baseline,raw:{first_mes:'Opening',extensions:{dsh_tavern:extension}},snapshots:[{...pack,revision:'r1'}],assetStatus:Object.fromEntries(pack.manifest.assets.map(a => [assetRefKey({packId:PACK_ID,kind:a.kind,assetId:a.id}),{available:true}])),cardRevision:'r1',engine:{dimensions:{}},target:{sourceKey:'cg-turn',branchId:'b1',revision:1,turn:1},units:['Rice meal.','Door opens.','Third paragraph.','End.']}
  return {input,pack,prepare:() => prepareAssetPackDirector(input)}
}
const transaction = prepared => createAssetPackTransaction({prepared,getCurrentBinding:() => prepared.binding})
const batch = (ops, sequence = 1, through = 4, done = true) => ({sequence,through,done,beats:[{at:sequence,ops}]})
const finish = tx => {tx.finish(); return tx.effect()}

test('CG show/variant/pan/hide snapshots retain base stage and defer entrances with outfit updates', async () => {
  const f = await fixture(), tx = transaction(f.prepare())
  tx.submit(batch([{op:'cast.add',actor:'actor'},{op:'cg.set',cg:ref('rice')},{op:'cast.add',actor:'second',after:'actor'},{op:'actor.outfit.set',actor:'second',outfit:'casual'}],1,1,false))
  tx.submit(batch([{op:'cg.set',cg:ref('rice'),variant:'turn'},{op:'cg.focus.set',focus:'face'}],2,2,false))
  tx.submit(batch([{op:'cg.clear'}],3,4,true))
  const record = finish(tx), shown = assetPackStateAt(record,1), moved = assetPackStateAt(record,2), end = assetPackStateAt(record,4)
  assert.deepEqual(shown.cast,['actor']); assert.deepEqual(shown.cg.resumeCast,['actor','second'])
  assert.equal(moved.cg.variant,'turn'); assert.equal(moved.cg.focus,'face')
  assert.equal(end.cg,undefined); assert.deepEqual(end.cast,['actor','second']); assert.equal(end.actors.second.outfitKey,'casual')
  assert.equal(record.entries[1].state.scene,record.entries[0].state.scene)
})

test('private fork: CG changes have no count quota across hide, sequences and checkpoint restore', async () => {
  const f = await fixture(), first = transaction(f.prepare())
  first.submit(batch([{op:'cg.set',cg:ref('rice')}]))
  f.input.record = finish(first)
  const p = f.prepare(), tx = transaction(p)
  assert.equal(tx.submit(batch([{op:'cg.clear'},{op:'cg.set',cg:ref('door')}],1,1,false)).ok,true)
  const resumed = createAssetPackTransaction({prepared:p,getCurrentBinding:() => p.binding,checkpoint:tx.savepoint()})
  const result = resumed.submit(batch([{op:'cg.clear'},{op:'cg.set',cg:ref('third')},{op:'music.set',ref:{packId:PACK_ID,kind:'music',assetId:'classroom'}}],2,2,false))
  assert.equal(result.ok,true)
  assert.deepEqual(resumed.preview().entries.at(-1).state.cg.ref,ref('third'))
  resumed.submit(batch([{op:'cg.set',cg:ref('rice')}],3,4,true))
  assert.deepEqual(finish(resumed).end.cg.ref,ref('rice'))
})

test('unknown variant and focus return exact choices without defaulting or dropping valid siblings', async () => {
  const f = await fixture(), tx = transaction(f.prepare())
  const result = tx.submit(batch([{op:'cg.set',cg:ref('rice'),variant:'missing'},{op:'cg.set',cg:ref('rice')},{op:'cg.focus.set',focus:'nope'},{op:'cg.set',cg:ref('rice'),variant:'also-missing'},{op:'weather.set',weather:'rain'}]))
  assert.equal(result.ok,false)
  assert.deepEqual(result.errors[0].choices,['base','turn'])
  assert.deepEqual(result.errors[1].choices,['face'])
  assert.deepEqual(result.errors[2].choices,['base','turn'])
  const record = finish(tx)
  assert.equal(record.end.cg.variant,'base'); assert.equal(record.end.cg.focus,'full'); assert.equal(record.end.weather,'rain')
  assert.ok(!record.diagnostics.some(d => d.code === 'CG_VARIANT_DEFAULTED'))
  assert.equal(record.entries[0].ops[0].variant,'base')
})

for (const hints of [undefined, []]) test(`CG without ${hints ? 'nonempty' : 'authored'} focus hints drops cg.focus.set without a dead-end repair`, async () => {
  const f = await fixture()
  const asset = f.pack.manifest.assets.find(row => row.kind === 'cg' && row.id === 'rice')
  for(const row of asset.variants.entries) {
    if (hints) row.content.focusHints = hints
    else delete row.content.focusHints
  }
  const prepared = f.prepare(), tx = transaction(prepared)
  const failed = tx.submit(batch([{op:'cg.set',cg:ref('rice')},{op:'cg.focus.set',focus:'invented-bowl'}]))
  assert.equal(failed.ok,false)
  assert.equal(failed.accepted,1)
  assert.equal(failed.errors[0].choices,undefined)
  assert.equal(failed.errors[0].retryable,false)
  const saved = finish(tx)
  assert.equal(saved.end.cg.focus,'full')
  assert.equal(saved.stats.droppedOps,1)
  assert.deepEqual(readAssetPackRecord(saved),saved)
})

test('CG persists through two empty turns, same-ref show preserves focus and location change exits in op order', async () => {
  const f = await fixture(), tx = transaction(f.prepare())
  tx.submit(batch([{op:'scene.set',background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'},time:'day'},{op:'cg.set',cg:ref('rice')},{op:'cg.focus.set',focus:'face'}]))
  let record = finish(tx)
  for (let i=0;i<2;i++) { f.input.record = record; const next = transaction(f.prepare()); next.submit({sequence:1,through:4,done:true,beats:[]}); record = finish(next); assert.equal(record.end.cg.focus,'face') }
  f.input.record = record
  const next = transaction(f.prepare())
  next.submit(batch([{op:'cg.set',cg:ref('rice')},{op:'scene.set',background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'},time:'night'}],1,1,false))
  next.submit(batch([{op:'scene.clear'},{op:'cg.set',cg:ref('rice')}],2,2,false))
  next.submit(batch([{op:'cg.set',cg:ref('rice')},{op:'scene.clear'}],3,4,true))
  const final = finish(next)
  assert.equal(assetPackStateAt(final,1).cg.focus,'face')
  assert.ok(assetPackStateAt(final,2).cg); assert.equal(final.end.cg,undefined)
})

test('CG recall offers only blue and triggered green entries across windows', async () => {
  const f = await fixture()
  f.pack.manifest.assets.filter(a => a.kind === 'cg').forEach(a => a.recall.mode = 'keyword')
  const recall = options => recallAssetPacks({...f.input,boundPackIds:[PACK_ID],...options})
  const a = recall({units:['Rice']})
  assert.deepEqual(a.candidates.cg.map(r=>r.ref.assetId),['rice']) // private fork: no top-up
  const all = recall({units:['Rice door third']})
  assert.equal(all.candidates.cg.length,3)
  f.input.units = ['Nothing']; const one = buildAssetPackRequest(f.prepare())
  f.input.units = ['Rice door third']; const two = buildAssetPackRequest(f.prepare())
  assert.equal(one.system,two.system)
  assert.ok(!JSON.parse(one.messages[0].content[0].text).allowedCommands.includes('cg.set'))
  assert.deepEqual(one.tools,two.tools) // Availability never changes the provider grammar.
  assert.doesNotMatch(two.messages[0].content[0].text,/"media"|"depictNames"/)
  const bytes = x => Buffer.byteLength(JSON.stringify(x))
  const noCg = structuredClone(f.prepare()); noCg.context.dimensions.cg = false
  const disabled = buildAssetPackRequest(noCg)
  assert.ok(bytes(two.tools)-bytes(disabled.tools) <= 800)
  console.log(JSON.stringify({cgSchemaDelta:bytes(two.tools)-bytes(disabled.tools),systemBytes:Buffer.byteLength(two.system),toolsBytes:bytes(two.tools)}))
})

test('opening.cg initializes zero-call state and seeds carry without replacing the background', async () => {
  const f = await fixture()
  f.input.raw.extensions.dsh_tavern.openings = {scenes:{primary:{greeting:greetingKey('Opening'),background:null,timeOfDay:null,music:null,cast:[],cg:{ref:ref('rice'),variant:'turn'}}}}
  const opening = resolveOpeningScene({...f.input,globalEnabledPackIds:[]},'primary')
  assert.equal(opening.state.scene,null); assert.equal(opening.state.cg.variant,'turn'); assert.deepEqual(opening.state.cg.resumeCast,[])
  delete f.input.baseline // private fork: this is a new opening, not historical continuation.
  f.input.opening = opening.state
  assert.equal(f.prepare().baseline.cg.variant,'turn')
})

// private fork: history authenticates stored ops and digest; it does not re-run current tool grammar.
test('CG history retains all four saved operations and the original semantic digest',async()=>{
  const f=await fixture(),tx=transaction(f.prepare());
  tx.submit({sequence:1,through:4,done:true,beats:[
    {at:1,ops:[{op:'cg.set',cg:ref('rice'),transition:'white'}]},
    {at:2,ops:[{op:'cg.set',cg:ref('rice'),variant:'turn'}]},
    {at:3,ops:[{op:'cg.focus.set',focus:'face'}]},
    {at:4,ops:[{op:'cg.clear'}]}
  ]});
  const saved=finish(tx),before=structuredClone(saved),checked=readAssetPackRecord(saved);
  assert.deepEqual(checked.entries.map(e=>e.ops.map(op=>op.op)),[['cg.set'],['cg.set'],['cg.focus.set'],['cg.clear']]);
  assert.deepEqual(checked,saved);assert.equal(checked.digest,saved.digest);assert.deepEqual(saved,before);
  assert.equal(assetPackStateAt(saved,3).cg.focus,'face');assert.equal(assetPackStateAt(saved,4).cg,undefined);
});
test('CG history chain preserves a pre-registry normalized predecessor instead of filtering ops or rehashing',async()=>{
  const f=await fixture(),tx=transaction(f.prepare());
  tx.submit(batch([{op:'scene.set',background:{packId:PACK_ID,kind:'backgrounds',assetId:'classroom'},time:'day'},{op:'cast.add',actor:'actor'},{op:'weather.set',weather:'rain'}]));
  // Construct the authentic older on-disk vocabulary, once, at fixture creation.
  const saved=structuredClone(finish(tx));delete saved.binding.commandSpecVersion;delete saved.binding.registryDigest;
  for(const entry of saved.entries)entry.ops=entry.ops.map(op=>directorCommands.recordOperation(op));
  saved.digest=assetPackDigest({binding:saved.binding,baseline:saved.baseline,entries:saved.entries,end:saved.end});
  const before=structuredClone(saved),checked=readAssetPackRecord(saved);
  assert.deepEqual({ops:checked.entries.map(e=>e.ops),digest:checked.digest},{ops:saved.entries.map(e=>e.ops),digest:saved.digest});
  assert.deepEqual(saved,before,'reading does not mutate the persisted artifact');
  f.input.record=saved;const next=transaction(f.prepare());next.submit(batch([{op:'cg.set',cg:ref('rice')}]));
  const cg=finish(next);assert.equal(assetPackStateAt(cg,1).cg.ref.assetId,'rice');assert.equal(cg.baseline.weather,'rain');
  assert.deepEqual(readAssetPackRecord(saved),before,'reading the CG successor cannot rewrite its predecessor');
});
