import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {createRequire} from 'node:module'
const {createStageRuntimeStore} = createRequire(import.meta.url)('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
import {readFile} from 'node:fs/promises'
const read = name => readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const cacheSource = await read('fork-avatar-cache.cjs'), playback = await read('fork-pack-playback.cjs')
const descriptor = {sessionId:'s',ref:{packId:'p',figureId:'f'},revision:'r1',outfitKey:'day',stateId:'calm',identity:'p:f:hash',crop:{x:0.25,y:0,w:0.5,h:0.25}}
function browser({deferBlob = false, failBlob = false} = {}) {
  const revoked = [], draws = [], canvases = [], callbacks = [], effects = []
  let serial = 0
  const React = {useRef:current=>({current}),useState:value=>[value,()=>{}],useEffect:fn=>effects.push(fn),
    useSyncExternalStore:(_subscribe,get)=>get(),createElement:(type,props,...children)=>({type,props,children})}
  const ctx = {React,devicePixelRatio:2,URL:{createObjectURL:()=>`blob:crop-${++serial}`,revokeObjectURL:url=>revoked.push(url)},
    Image:class {naturalWidth=1024;naturalHeight=1536;set src(value){this.url=value;queueMicrotask(()=>this.onload())}},
    document:{createElement:()=>{const canvas={getContext:()=>({drawImage:(...args)=>draws.push(args)}),toBlob(fn){if(deferBlob)callbacks.push(fn);else fn(failBlob ? null : {})}};canvases.push(canvas);return canvas}}}
  vm.runInNewContext(cacheSource+'\n'+playback+'\nthis.cache=forkAvatarCache;',ctx)
  ctx.cache.select('s');ctx.cache.revision('p','r1')
  return {ctx,cache:ctx.cache,revoked,draws,canvases,callbacks,effects}
}
const tick = () => new Promise(resolve=>setImmediate(resolve))
test('second mount synchronously renders a plain visible cached image without onLoad gating',async()=>{
  const b=browser(), props={identity:descriptor.identity,src:'blob:source',crop:descriptor.crop,avatar:descriptor,alt:''}
  const first=b.ctx.ForkPackImage(props)
  assert.equal(first.type,'span');assert.equal(first.children[0].props.style.visibility,'hidden')
  first.children[0].props.onLoad({currentTarget:{naturalWidth:1024,naturalHeight:1536}})
  await tick()
  const second=b.ctx.ForkPackImage(props)
  assert.equal(second.type,'img');assert.equal(second.props.src,'blob:crop-1')
  assert.equal(second.props.onLoad,undefined);assert.equal(second.props.style,undefined)
  assert.equal(second.props.avatar,undefined)
  assert.equal(b.canvases[0].width,128);assert.equal(b.canvases[0].height,128)
  assert.deepEqual(b.draws[0].slice(1),[256,0,512,384,0,16,128,96])
  assert.equal(await b.cache.prepare(descriptor,'blob:renewed'),second.props.src)
  assert.equal(b.draws.length,1,'renewed transport and repeated mounts do not recrop')
})
test('keys separate revision, figure, outfit, state, resolved crop, and physical display size',async()=>{
  const b=browser();await b.cache.prepare(descriptor,'source',64,2)
  for(const change of [{revision:'r2'},{ref:{packId:'p',figureId:'other'}},{outfitKey:'night'},{stateId:'crying'},{crop:{x:0,y:0,w:1,h:1}}]) {
    assert.equal(b.cache.get({...descriptor,...change},64,2),null)
  }
  assert.equal(b.cache.get(descriptor,64,1),null)
  assert.equal(b.cache.get(descriptor,128,1),'blob:crop-1')
  await b.cache.prepare(descriptor,'source',64,1)
  assert.equal(b.draws.length,2)
})
// private fork (stage perf 2026-10): a chat switch keeps content-keyed bitmaps (returning re-encoded every avatar);
// only the selected session reads them, and pack revision changes still revoke.
test('pack revision changes revoke all ready URLs; session switches keep them for the selected session only',async()=>{
  const b=browser();await b.cache.prepare(descriptor,'source')
  b.cache.select('s');b.cache.revision('p','r1');assert.deepEqual(b.revoked,[])
  b.cache.revision('p','r2');assert.deepEqual(b.revoked,['blob:crop-1'])
  assert.equal(b.cache.ready(descriptor),null)
  const next={...descriptor,revision:'r2'};await b.cache.prepare(next,'source')
  b.cache.select('other');assert.deepEqual(b.revoked,['blob:crop-1'],'switching chats does not revoke')
  assert.equal(b.cache.ready(next),null,'another session cannot read it')
  assert.equal(await b.cache.prepare(next,'old-session'),null)
  b.cache.revision('p','r2');assert.equal(b.cache.ready({...next,sessionId:'other'}),'blob:crop-2','same content is shared, not re-encoded')
  b.cache.select('s');b.cache.revision('p','r2');assert.equal(b.cache.ready(next),'blob:crop-2')
  assert.equal(b.canvases.length,2)
  b.cache.revision('p','r3');assert.deepEqual(b.revoked,['blob:crop-1','blob:crop-2'])
})
test('late toBlob completion cannot repopulate an evicted session or revision',async()=>{
  for(const evict of [cache=>cache.select('next'),cache=>cache.revision('p','r2')]) {
    const b=browser({deferBlob:true}), pending=b.cache.prepare(descriptor,'source')
    assert.equal(b.cache.prepare(descriptor,'another-source'),pending)
    await tick();assert.equal(b.callbacks.length,1)
    evict(b.cache);b.callbacks[0]({});assert.equal(await pending,null)
    assert.equal(b.cache.ready(descriptor),null);assert.deepEqual(b.revoked,[])
  }
})
test('failed canvas encoding retains the uncached crop fallback and can retry',async()=>{
  const b=browser({failBlob:true})
  assert.equal(await b.cache.prepare(descriptor,'source'),null)
  assert.equal(await b.cache.prepare(descriptor,'source'),null)
  assert.equal(b.canvases.length,2);assert.equal(b.cache.ready(descriptor),null)
})
test('transcript remount uses a ready bitmap before visibility observation or an async source pin',async()=>{
  const b=browser();await b.cache.prepare(descriptor,'source')
  const source=await read('fork-bubbles.js')
  Object.assign(b.ctx,{forkBubbleMood:()=>({id:'calm'}),forkPackListeners:new Set(),useForkPackRevision:()=>0,
    forkGalActive:{subscribe(){},get:()=>null},forkStageSessions:{resourceOwner:{},get:()=>({subscribe(){},getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})})}})
  vm.runInNewContext(source.slice(source.indexOf('function forkBubbleMediaDescriptor'),source.indexOf('function ForkBubbleAvatar')),b.ctx)
  const media=b.ctx.useForkBubbleMedia('s',{avatarMedia:{default:descriptor}},'calm',[],false)
  assert.equal(media.src,'blob:crop-1')
  const image=b.ctx.ForkPackImage({...media})
  assert.equal(image.type,'img');assert.equal(image.props.src,'blob:crop-1');assert.equal(image.props.onLoad,undefined)
})
test('session-open prefetch uses only bound default avatars and releases source pins',async()=>{
  const b=browser(), binding=await read('fork-stage-session-binding.js'), requests=[], releases=[]
  const selected={current:'s'}, listeners=[], stores=new Map(), disposed=[]
  for (const id of ['s','other']) {
    const store=createStageRuntimeStore({initialState:{source:{sessionId:id,authorityEpoch:1}}})
    const select=store.select
    store.select=(...args)=>{
      const selector=select(...args), dispose=selector.dispose
      selector.dispose=()=>{disposed.push(id);dispose()}
      return selector
    }
    stores.set(id,store)
  }
  Object.assign(b.ctx,{ctx:{sessions:{list:{getSnapshot:()=>selected,subscribe:fn=>{listeners.push(fn);return ()=>{}}}}},
    owner:{get:id=>stores.get(id)},
    forkBubbleStore:{get:()=>({config:{characters:[{avatarMedia:{default:descriptor,moods:{crying:{...descriptor,stateId:'crying'}}}},{alias:'unbound'}]}}),subscribe:()=>()=>{}},
    resourceOwner:{async acquire(value,authority){requests.push({value,authority});return {handle:{url:'source'},release:()=>releases.push(value)}}}})
  const start=binding.indexOf('        const prefetches ='),end=binding.indexOf('        // private fork: deletion',start)
  vm.runInNewContext(binding.slice(start,end),b.ctx)
  await tick();assert.equal(requests.length,1);assert.equal(requests[0].value.stateId,'calm');assert.equal(releases.length,1)
  assert.equal(b.cache.ready(descriptor),'blob:crop-1')
  listeners[0]();await tick();assert.equal(requests.length,1)
  selected.current='other';listeners[0]();await tick()
  // private fork (stage perf 2026-10): the same pack content is already encoded; a chat switch neither revokes nor re-acquires it.
  assert.deepEqual(b.revoked,[]);assert.equal(requests.length,1);assert.equal(releases.length,1)
  assert.equal(b.cache.ready({...descriptor,sessionId:'other'}),'blob:crop-1')
  assert.deepEqual(disposed,['s'],'session switch disposes the previous source selector')
  selected.current=null;listeners[0]()
  assert.deepEqual(disposed,['s','other'],'clearing the session disposes the current source selector')
})

test('stage face and backlog carry the same session/revision/outfit/state cache identity',async()=>{
  const b=browser(), figure={alias:'actor',ref:descriptor.ref,revision:'r1',outfitKey:'day',state:{id:'calm'},
    media:{avatar:{identity:descriptor.identity}},avatarUrl:'source',avatarCrop:descriptor.crop,offstage:true}
  const face=b.ctx.packFigureRenderInputs(figure,{sessionId:'s'}).face
  await b.cache.prepare(descriptor,'source')
  assert.equal(b.cache.get(face.avatar),'blob:crop-1')
  const stage=await read('fork-gal-stage.js'),backlog=await read('fork-gal-backlog.js')
  assert.match(stage,/className: "fork-gal-face-img", src: face.src, crop:face.crop, avatar:face.avatar/)
  assert.match(backlog,/crop: avatar.crop, avatar:avatar.avatar/)
})

test('source decode errors leave no stuck cache entry',async()=>{
  const b=browser()
  b.ctx.Image=class {set src(_value){queueMicrotask(()=>this.onerror(new Error('decode failed')))}}
  assert.equal(await b.cache.prepare(descriptor,'broken'),null)
  assert.equal(b.cache.ready(descriptor),null)
  assert.equal(await b.cache.prepare(descriptor,'recovered',64,2,{naturalWidth:1024,naturalHeight:1536}),'blob:crop-1')
})

// private fork: warm square caches must never replace the overflowing stage sprite.
test('stage face bypasses ready square thumbnails and does not prepare new ones',async()=>{
  const b=browser()
  await b.cache.prepare(descriptor,'blob:source',64,2)
  const image=b.ctx.ForkPackImage({identity:descriptor.identity,src:'blob:source',crop:descriptor.crop,avatar:descriptor,cropOverflow:true})
  assert.equal(image.type,'span')
  assert.equal(image.children[0].props.src,'blob:source')
  assert.equal(image.children[0].props.cropOverflow,undefined)
  image.children[0].props.onLoad({currentTarget:{naturalWidth:1024,naturalHeight:1536}})
  b.effects.forEach(fn=>fn())
  await tick()
  assert.equal(b.draws.length,1)
})

// private fork: Live2D-only figures use dedicated per-mood images (crop:null), not sprite crops.
const dedicated = {sessionId:'s',ref:{packId:'p',figureId:'luna'},revision:'r1',outfitKey:'default',stateId:null,identity:'p:luna:happy',crop:null}
test('dedicated crop-less avatars are cached and remount synchronously as a plain image',async()=>{
  const b=browser()
  const url=await b.cache.prepare(dedicated,'blob:owner-bitmap')
  assert.equal(url,'blob:crop-1');assert.equal(b.cache.ready(dedicated),url)
  assert.deepEqual(b.draws[0].slice(1),[0,0,1024,1536,(128-128*1024/1536)/2,0,128*1024/1536,128],'full image, contain-fit')
  const source=await read('fork-bubbles.js')
  Object.assign(b.ctx,{forkBubbleMood:()=>({id:'happy'}),forkPackListeners:new Set(),useForkPackRevision:()=>0,
    forkGalActive:{subscribe(){},get:()=>null},forkStageSessions:{resourceOwner:{},get:()=>({subscribe(){},getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})})}})
  vm.runInNewContext(source.slice(source.indexOf('function forkBubbleMediaDescriptor'),source.indexOf('function ForkBubbleAvatar')),b.ctx)
  const {sessionId,...descriptorOnly}=dedicated
  // Off-screen (not yet observed) rows keep the ready image instead of dropping to a placeholder.
  const media=b.ctx.useForkBubbleMedia('s',{avatarMedia:{default:descriptorOnly,moods:{happy:descriptorOnly}}},'happy',[],false)
  assert.equal(media.src,url)
  const image=b.ctx.ForkPackImage({...media,alt:''})
  assert.equal(image.type,'img');assert.equal(image.props.src,url);assert.equal(image.props.onLoad,undefined)
})
test('a ready URL is published only after a retained display image has loaded it',async()=>{
  const b=browser(), images=[]
  b.ctx.Image=class {naturalWidth=1024;naturalHeight=1536;constructor(){images.push(this)}set src(value){this.url=value;queueMicrotask(()=>{this.loaded=true;this.onload?.()})}}
  let seen=null
  b.cache.subscribe(()=>{const url=b.cache.ready(dedicated);seen=images.find(image=>image.url===url)})
  const url=await b.cache.prepare(dedicated,'blob:source')
  assert.equal(seen?.loaded,true,'display image for the published URL had already loaded')
  assert.equal(images.length,2,'one source decode and one retained display image')
})
test('ready lookup is indexed and falls back to another size of the same avatar on eviction',async()=>{
  const b=browser()
  const ctx=b.ctx;vm.runInNewContext('this.small=createForkAvatarCache({maxEntries:2})',ctx)
  const cache=ctx.small;cache.select('s');cache.revision('p','r1')
  const a=await cache.prepare(dedicated,'src',64,1), c=await cache.prepare(dedicated,'src',32,1)
  assert.equal(cache.ready(dedicated),c)
  cache.get(dedicated,64,1)
  await cache.prepare({...dedicated,identity:'other'},'src',64,1)
  assert.equal(cache.ready(dedicated),a,'evicting the indexed size re-points to the retained size')
})
