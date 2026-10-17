// private fork: enlarged transcript avatars retain only the exact full-resolution crop.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source = await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js',import.meta.url),'utf8')
const crop = {x:0.3,y:0.02,w:0.4,h:0.2}
const media = {src:'blob:padded-thumbnail',crop,avatar:{ref:{packId:'pack'},hash:'sprite',revision:'r1'}}
function fixture({revision='r1',fail,delay}={}) {
  const urls=new Set(),revoked=[],leases=[],released=[],draws=[],canvases=[],images=[],nodes=[],keys=new Map()
  let serial=0
  const context={AbortController,URL:{createObjectURL(){const url='blob:zoom-'+ ++serial;urls.add(url);return url},revokeObjectURL(url){urls.delete(url);revoked.push(url)}},
    forkPackTransport:{service:{async leaseMedia(args){leases.push(args);return {url:'/original',ticket:leases.length,revision}},releaseLease(ticket){released.push(ticket)}}},
    fetch:async(url,options)=>{assert.equal(url,'/original');assert.equal(options.credentials,'same-origin');await delay?.();if(fail==='fetch')throw Error('offline');return {ok:true,blob:async()=>({})}},
    Image:class {constructor(){this.naturalWidth=2000;this.naturalHeight=4000;images.push(this)}set src(value){this.url=value;if(value)queueMicrotask(()=>fail==='decode'?this.onerror(Error('decode')):this.onload())}},
    document:{createElement(tag){
      if(tag==='canvas'){const canvas={getContext:()=>({drawImage:(...args)=>draws.push(args)}),toBlob:fn=>fn(fail==='encode'?null:{})};canvases.push(canvas);return canvas}
      const node={tag,children:[],events:{},append(child){this.children.push(child)},setAttribute(){},removeAttribute(name){delete this[name]},addEventListener(name,fn){this.events[name]=fn},remove(){this.removed=true}}
      nodes.push(node);return node
    },body:{append(node){node.mounted=true}},addEventListener(name,fn){keys.set(name,fn)},removeEventListener(name){keys.delete(name)}}}
  vm.runInNewContext(source.slice(source.indexOf('// private fork: zoom uses'),source.indexOf('function forkBubbleMediaDescriptor')),context)
  return {context,urls,revoked,leases,released,draws,canvases,images,nodes,keys}
}
test('zoom draws exact original crop at native resolution and never retains/cache-reuses it',async()=>{
  const h=fixture()
  for(let i=0;i<2;i++) {
    const value=await h.context.forkPortraitSource(media,new AbortController().signal)
    assert.deepEqual(h.draws[i].slice(1),[600,80,800,800,0,0,800,800])
    assert.equal(h.images[i].url,'');assert.equal(h.canvases[i].width,0)
    assert.equal(h.urls.size,1);assert.notEqual(value.src,media.src)
    value.release();assert.equal(h.urls.size,0)
  }
  assert.equal(h.leases.length,2);assert.deepEqual(h.released,[1,2])
  assert.match(source,/forkShowPortrait\(props\.media,/)
})
test('non-square crop preserves its aspect and dedicated avatar stays as-is',async()=>{
  const h=fixture()
  const value=await h.context.forkPortraitSource({...media,crop:{x:0.1,y:0.1,w:0.5,h:0.1}},new AbortController().signal)
  assert.deepEqual(h.draws[0].slice(1),[200,400,1000,400,0,0,1000,400]);value.release()
  const dedicated=await h.context.forkPortraitSource({...media,crop:null},new AbortController().signal)
  assert.equal(h.draws.length,1);assert.equal(h.images.length,1)
  dedicated.release();assert.equal(h.urls.size,0)
})
test('stale revisions and fetch/decode/encode failures release leases and temporary resources',async()=>{
  for(const options of [{revision:'r2'},{fail:'fetch'},{fail:'decode'},{fail:'encode'}]) {
    const h=fixture(options)
    await assert.rejects(h.context.forkPortraitSource(media,new AbortController().signal))
    assert.deepEqual(h.released,[1]);assert.equal(h.urls.size,0)
    for(const canvas of h.canvases)assert.equal(canvas.width,0)
  }
})
test('lightbox closes on click/Escape and retains its decoded session crop',async()=>{
  for(const method of ['click','Escape']) {
    const h=fixture();await h.context.forkShowPortrait(media,'Actor')
    assert.equal(h.urls.size,1)
    if(method==='click')h.nodes[0].events.click()
    else h.keys.get('keydown')({key:'Escape',preventDefault(){},stopPropagation(){}})
    assert.equal(h.urls.size,1);assert.equal(h.keys.size,0);assert.equal(h.nodes[0].removed,true)
  }
})
test('closing during loading prevents late publication and cleans the original',async()=>{
  let finish
  const h=fixture({delay:()=>new Promise(resolve=>finish=resolve)})
  const pending=h.context.forkShowPortrait(media,'Actor')
  await new Promise(resolve=>setImmediate(resolve))
  h.nodes[0].events.click();finish();await pending
  assert.equal(h.urls.size,0);assert.deepEqual(h.released,[1]);assert.equal(h.draws.length,0)
})

// private fork: delayed originals must never publish an empty or broken image.
test('preview is synchronous, final geometry is fixed, and reopening reuses the zoom', async()=>{
  let finish
  const h=fixture({delay:()=>new Promise(resolve=>finish=resolve)})
  const pending=h.context.forkShowPortrait(media,'Actor','data:image/png;base64,preview')
  const preview=h.nodes.find(node=>node.tag==='img')
  assert.equal(preview.src,'data:image/png;base64,preview');assert.equal(preview.alt,'')
  const frame=h.nodes.find(node=>node.className==='fork-portrait-frame')
  assert.deepEqual(frame.children,[preview])
  await new Promise(resolve=>setImmediate(resolve));finish();await pending
  assert.equal(frame.children.length,2);assert.equal(frame.children[1].className,'fork-portrait-sharp')
  h.nodes[0].events.click()
  await h.context.forkShowPortrait(media,'Actor')
  assert.equal(h.leases.length,1)
  assert.equal(h.nodes.filter(node=>node.tag==='img').at(-1).src,frame.children[1].url)
})
test('failed high-resolution fetch or decode keeps the preview and dialog', async()=>{
  for(const fail of ['fetch','decode','encode']) {
    const h=fixture({fail});await h.context.forkShowPortrait(media,'Actor')
    assert.equal(h.nodes[0].removed,undefined)
    assert.equal(h.nodes.find(node=>node.tag==='img').src,media.src)
    assert.equal(h.urls.size,0)
  }
})
test('session zoom cache evicts and revokes least recently used entries at sixteen',async()=>{
  const h=fixture()
  for(let i=0;i<17;i++) await h.context.forkShowPortrait({...media,identity:String(i)},'Actor')
  assert.equal(h.urls.size,16)
  await h.context.forkShowPortrait({...media,identity:'1'},'Actor')
  assert.equal(h.leases.length,17)
  await h.context.forkShowPortrait({...media,identity:'0'},'Actor')
  assert.equal(h.leases.length,18);assert.equal(h.urls.size,16)
})

// private fork: snapshot both cached squares and uncached CSS crops from actual displayed pixels.
test('preview snapshots the displayed avatar rather than the descriptor source',()=>{
  const h=fixture()
  h.context.document.createElement = () => ({getContext:()=>({drawImage:(...args)=>h.draws.push(args)}),toDataURL:()=> 'data:image/png;base64,snapshot'})
  const image={complete:true,naturalWidth:2000,naturalHeight:4000,parentElement:{dataset:{avatarCrop:JSON.stringify(crop)}}}
  assert.equal(h.context.forkPortraitPreview(media,{querySelector:()=>image}),'data:image/png;base64,snapshot')
  assert.deepEqual(h.draws[0].slice(1),[600,80,800,800,0,0,256,256])
  delete image.parentElement.dataset.avatarCrop
  image.naturalWidth=image.naturalHeight=128
  h.context.forkPortraitPreview(media,{querySelector:()=>image})
  assert.deepEqual(h.draws[1].slice(1),[0,0,128,128,0,0,256,256])
  image.complete=false
  assert.equal(h.context.forkPortraitPreview(media,{querySelector:()=>image}),null)
})
