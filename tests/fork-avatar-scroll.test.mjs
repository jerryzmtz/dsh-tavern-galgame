// private fork: deterministic virtual-row scroll harness, including first-render frames.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {execFileSync} from 'node:child_process'
const read = name => readFileSync(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const current = read('fork-bubbles.js')
// private fork: main.js bundles the shared ForkSpinner before the transcript.
const spinner = read('fork-spinner.js')
const descriptor = {sessionId:'s',ref:{packId:'p',figureId:'f'},revision:'r',identity:'hash',outfitKey:'day',stateId:'calm',crop:{x:0,y:0,w:1,h:1}}
const tick = () => new Promise(resolve=>setImmediate(resolve))
function harness(source=current) {
  let slots=[], cursor=0, effects=[], now=0, serial=0, requests=0, releases=0
  const timers=new Map(), revoked=[]
  const ctx={devicePixelRatio:1, forkPackListeners:new Set(),useForkPackRevision:()=>0,
    forkBubbleMood:()=>null,forkBubbleMoodLabel:()=>'',forkGalActive:{subscribe(){},get:()=>null},
    setTimeout(fn,delay){const id=++serial;timers.set(id,{fn,at:now+delay});return id},clearTimeout:id=>timers.delete(id),
    URL:{createObjectURL:()=>`blob:${++serial}`,revokeObjectURL:url=>revoked.push(url)},
    Image:class {naturalWidth=100;naturalHeight=100;set src(_){queueMicrotask(()=>this.onload())}},
    document:{createElement:()=>({getContext:()=>({drawImage(){}}),toBlob:fn=>fn({})})},
    forkStageSessions:{get:()=>({subscribe(){},getSnapshot:()=>({source:{sessionId:'s',authorityEpoch:1}})}),resourceOwner:{async acquire(){requests++;return {handle:{identity:'hash',url:'source'},release(){releases++}}}}},
    React:{createElement:(type,props,...children)=>({type,props,children}),useRef(value){return slots[cursor++] ||= {current:value}},
      useState(value){const i=cursor++;if(!(i in slots))slots[i]=value;return [slots[i],value=>slots[i]=value]},
      useSyncExternalStore:(_,get)=>get(),useEffect(fn,deps){const i=cursor++,old=slots[i];if(!old || deps.some((x,j)=>x!==old.deps[j])){old?.stop?.();const state={deps};slots[i]=state;effects.push(()=>state.stop=fn())}}}}
  vm.runInNewContext(spinner+'\n'+read('fork-avatar-cache.cjs')+'\n'+read('fork-pack-playback.cjs')+'\n'+source.slice(source.indexOf('function forkBubbleMediaDescriptor'),source.indexOf('function ForkBubbleRow'))+'\nthis.cache=forkAvatarCache',ctx)
  ctx.cache.select('s');ctx.cache.revision('p','r')
  return {ctx,revoked,get requests(){return requests},get releases(){return releases},
    render(fn){cursor=0;return fn()},flush(){effects.splice(0).forEach(fn=>fn())},
    advance(ms){now+=ms;for(const [id,timer] of timers)if(timer.at<=now){timers.delete(id);timer.fn()}},
    unmount(){slots.forEach(slot=>slot?.stop?.());slots=[];effects=[]}}
}
// private fork: the avatar mounts the shared ForkSpinner (centred fill, keyed by the face) while its media loads;
// the spinner itself draws nothing before 150 ms.
test('private fork: loading spinner waits 150ms; missing and failed avatars never show initials',()=>{
  const b=harness(), props={alias:'actor',name:'Actor',media:{loading:true}}, render=()=>b.render(()=>b.ctx.ForkBubbleAvatar(props))
  const element=render().children[0], spin=()=>b.render(()=>element.type(element.props))
  assert.equal(element.type,b.ctx.ForkSpinner);assert.equal(element.props.fill,true);assert.equal(element.key??element.props.key,JSON.stringify(['actor',undefined]))
  assert.equal(spin(),null);b.flush();b.advance(149)
  assert.equal(spin(),null);b.advance(1)
  assert.match(spin().props.className,/^fork-spinner is-fill/);assert.equal(spin().children[0].children.flat().length,12)
  b.unmount()
  props.media=null;assert.equal(render().children[0],null);b.flush();b.advance(200)
  assert.equal(render().children[0],null)
  props.media={src:'ready'};assert.equal(render().children[0].type,b.ctx.ForkPackImage);b.flush();b.unmount()
  delete props.media;assert.equal(render().children[0],null);b.flush();b.unmount();b.advance(200)
  assert.equal(render().children[0],null)
})
test('private fork: lease pending is loading, rejection and stage suspension are empty',async()=>{
  const b=harness(), character={avatarMedia:{default:descriptor}}
  let reject
  b.ctx.forkStageSessions.resourceOwner.acquire=()=>new Promise((_,fail)=>{reject=fail})
  const render=()=>b.render(()=>b.ctx.useForkBubbleMedia('s',character,'calm',[],true))
  assert.equal(render(),null);b.flush()
  assert.equal(render().loading,true)
  reject(new Error('media unavailable'));await tick()
  assert.equal(render(),null)
  b.ctx.forkGalActive.get=()=> 's'
  assert.equal(render(),null);b.flush();b.unmount()
})
test('idle loaded-window mood prefetch releases source and warm remount does not lease',async()=>{
  const b=harness(), character={avatarMedia:{default:descriptor}}, media=wanted=>b.render(()=>b.ctx.useForkBubbleMedia('s',character,'calm',[],wanted))
  assert.equal(media(false),null);b.flush();assert.equal(b.requests,0)
  b.advance(50);await tick();assert.equal(b.requests,1);assert.equal(b.releases,1)
  b.unmount();assert.match(media(false).src,/blob:/);b.flush()
  media(true);b.flush();await tick();assert.equal(b.requests,1)
})
test('cache is bounded at 384 and least recently used entries alone are revoked',async()=>{
  const b=harness(), value=i=>({...descriptor,stateId:String(i)})
  for(let i=0;i<384;i++)await b.ctx.cache.prepare(value(i),'source')
  const first=b.ctx.cache.ready(value(0)), second=b.ctx.cache.ready(value(1))
  b.ctx.cache.ready(value(0))
  await b.ctx.cache.prepare(value(384),'source')
  assert.equal(b.ctx.cache.ready(value(2)),null)
  assert.equal(b.ctx.cache.ready(value(0)),first);assert.equal(b.ctx.cache.ready(value(1)),second)
  assert.equal(b.revoked.length,1)
})
test('unmounted idle work never acquires and pending crops respect the bound',async()=>{
  const b=harness()
  b.render(()=>b.ctx.useForkBubbleMedia('s',{avatarMedia:{default:descriptor}},'calm',[],false))
  b.flush();b.unmount();b.advance(500);await tick();assert.equal(b.requests,0)
  const callbacks=[]
  b.ctx.document.createElement=()=>({getContext:()=>({drawImage(){}}),toBlob:fn=>callbacks.push(fn)})
  const jobs=Array.from({length:400},(_,i)=>b.ctx.cache.prepare({...descriptor,stateId:String(i)},'source'))
  await tick();assert.equal(callbacks.length,384)
  callbacks.forEach(fn=>fn({}));await Promise.all(jobs)
  assert.equal(jobs.length-(await Promise.all(jobs)).filter(Boolean).length,16)
})
test('simulated scroll reports before/after surname frames and warm source requests',async t=>{
  const before=execFileSync('git',['show','eb467787:tavern-plugin/src/client/fork-bubbles.js'],{encoding:'utf8'})
  const results=[]
  for(const source of [before,current]) {
    const b=harness(source);let cold=0,warm=0
    for(let i=0;i<100;i++) {
      const row=b.render(()=>b.ctx.ForkBubbleAvatar({alias:'actor',name:'Actor'}))
      if(row.props.className.includes('avatar-ph'))cold++
      b.flush();b.unmount()
    }
    await b.ctx.cache.prepare(descriptor,'source')
    for(let i=0;i<100;i++) {
      const media=b.render(()=>b.ctx.useForkBubbleMedia('s',{avatarMedia:{default:descriptor}},'calm',[],true))
      b.flush()
      const image=b.ctx.ForkPackImage(media)
      if(image.type!=='img')warm++
      await tick();b.unmount()
    }
    results.push({coldFirstPaintSurnameFrames:cold,warmFirstPaintMissingImages:warm,warmSourceRequests:b.requests})
  }
  t.diagnostic(JSON.stringify({before:results[0],after:results[1],mounts:100}))
  assert.deepEqual(results[0],{coldFirstPaintSurnameFrames:100,warmFirstPaintMissingImages:0,warmSourceRequests:100})
  assert.deepEqual(results[1],{coldFirstPaintSurnameFrames:0,warmFirstPaintMissingImages:0,warmSourceRequests:0})
})
