// private fork: browser ingress writes derived colour, never a manual override or a read-time cache.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const read=name=>readFile(new URL('../'+name,import.meta.url),'utf8')
const shared=await read('tavern-plugin/shared/figure-auto-color.cjs')
const source=await read('tavern-plugin/src/client/fork-asset-pack-character-ui.js')
function harness({type='image/png',width=800,height=1000,pixels=[120,40,60,255],fail=false}={}) {
  let closed=0
  const file={type,name:'image',size:4,arrayBuffer:async()=>new Uint8Array([1,2,3,4]).buffer}
  const context={Uint8Array,TextEncoder,Map,createImageBitmap:async()=>({width,height,close(){closed++}}),document:{createElement:()=>({getContext:()=>({drawImage(){},getImageData(x,y,width,height){if(fail)throw new Error('decode failed');return {width,height,data:Uint8Array.from(Array.from({length:width*height},()=>pixels).flat())}}}),toBlob:cb=>cb({...file,type:'image/webp'})})}}
  vm.runInNewContext(shared+'\n'+source.slice(0,source.indexOf('const newResourceKey')),context)
  return {context,file,closed:()=>closed}
}
const clone=value=>JSON.parse(JSON.stringify(value))
for(const type of ['image/png','image/webp','image/jpeg'])test(type+' intake samples derived colour and closes its decoded bitmap',async()=>{
  const h=harness({type}),image=await h.context.browserPrepareImage(h.file,'sprite')
  assert.equal(image.autoColor,'#78283c');assert.equal(Object.hasOwn(image,'imageColor'),false)
  assert.equal(image.width,800);assert.equal(image.height,1000);assert.equal(h.closed(),type==='image/jpeg'?2:1)
  assert.equal(image.descriptor.ext,type==='image/jpeg'?'webp':type.slice(6))
})
test('failed sampling and dimension rejection release the bitmap',async()=>{
  for(const options of [{fail:true},{width:8193},{width:8192,height:8192}]) {
    const h=harness(options);await assert.rejects(h.context.browserPrepareImage(h.file,'sprite'));assert.equal(h.closed(),1)
  }
})
test('only a changed default calm source updates autoColor, including when manually overridden',async()=>{
  const {context:c}=harness(),pack={sprites:{}},before={imageColor:'#abcdef',outfits:[{key:'daily',enabled:true,avatars:{calm:'old'}}]}
  const changed={...before,outfits:[{key:'daily',enabled:true,avatars:{calm:'new'}}]},imported={hash:'new',sprite:false,autoColor:'#78283c'}
  assert.deepEqual(clone(await c.figureAutoPatch({},pack,before,changed,imported)),{autoColor:'#78283c'})
  assert.equal(changed.imageColor,'#abcdef')
  for(const next of [{...before,name:'new'}, {...before,imageColor:null}, {...before,outfits:[{...before.outfits[0],avatars:{calm:'old',joy:'new'}}]}, {...before,outfits:[...before.outfits,{key:'other',enabled:true,avatars:{calm:'new'}}]}])assert.deepEqual(clone(await c.figureAutoPatch({},pack,before,next)),{})
  assert.deepEqual(clone(await c.figureAutoPatch({},pack,before,{outfits:[]})),{autoColor:'#78808c'})
})
test('import fills only missing derived values in one CAS metadata write, preserving manual colours',async()=>{
  const {context:c}=harness(),calls=[],pack={manifest:{id:'pack'},revision:'r1',sprites:{},figures:{a:{id:'a',imageColor:'#abcdef',outfits:[]},b:{id:'b',autoColor:'#123456',outfits:[]}}}
  const binding={service:{patchPack:async input=>{calls.push(input);return {snapshot:pack}}}}
  await c.fillImportedFigureColors(binding,pack)
  assert.equal(calls.length,1);assert.equal(calls[0].expectedRevision,'r1');assert.equal(calls[0].fileUpdates.size,1)
  const saved=JSON.parse(new TextDecoder().decode(calls[0].fileUpdates.get('figures/a.json')))
  assert.equal(saved.autoColor,'#78808c');assert.equal(saved.imageColor,'#abcdef')
  assert.equal(Object.hasOwn(pack.figures.a,'autoColor'),false)
  await c.fillImportedFigureColors(binding,{...pack,figures:{b:pack.figures.b}});assert.equal(calls.length,1)
})

test('non-source replacement does not invoke the signature sampler during image preparation',async()=>{
  const h=harness();h.context.figureBitmapAutoColor=()=>{throw Error('unexpected sampling')}
  const image=await h.context.browserPrepareImage(h.file,'sprite',false)
  assert.equal(image.autoColor,undefined);assert.equal(h.closed(),1)
})
test('failed imported source decode releases its lease and publishes no partial batch',async()=>{
  const {context:c}=harness(),pack={manifest:{id:'pack'},revision:'r1',sprites:{},figures:{a:{id:'a',outfits:[{enabled:true,avatars:{calm:'hash'}}]}}}
  let released=0,writes=0
  c.fetch=async()=>({ok:false});const binding={previewMedia:async()=>({url:'local',release(){released++}}),service:{patchPack(){writes++}}}
  await assert.rejects(c.fillImportedFigureColors(binding,pack),/自动取色图片/);assert.equal(released,1);assert.equal(writes,0)
})
