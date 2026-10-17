// private fork: consumers compare identities; preparation/retry belongs to the resource owner.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const read=name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const playback=await read('fork-pack-playback.cjs'), scene=await read('fork-gal-scene.js')
function imageOwner() {
  const slots=[];let cursor=0
  const React={useEffect(){},useSyncExternalStore(_subscribe,get){return get()},useRef(initial){return slots[cursor++] ||= {current:initial}},useState(initial){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}]},createElement:(type,props)=>({type,props})}
  const ctx={React};vm.runInNewContext(playback,ctx)
  return input=>{cursor=0;return ctx.ForkPackImage(input).props}
}
test('face/avatar images do not change src on renewal; only a new identity replaces a mounted image',()=>{
  const render=imageOwner(),first={identity:'pack:figure:avatar:hash',src:'/avatar?ticket=one'},next={...first,src:'/avatar?ticket=two'}
  assert.equal(render(first).src,first.src)
  assert.equal(render(next).src,first.src,'DOM receives no new src while the image is loaded')
  assert.equal(render(next).onError,undefined,'ticket recovery belongs to preparation, not the image consumer')
  assert.equal(imageOwner()(next).src,next.src,'a remount must not reuse an expired URL from the projection cache')
  const changed={identity:'new-hash',src:'/other'};assert.equal(render(changed).src,changed.src)
})
test('background owner ignores ticket URLs, including after failure; a new identity transitions once',async()=>{
  let desc={background:{identity:'room:hash',url:'/room?one'},grade:'',snap:false}, loads=[],transitions=[]
  const state={bg:{},layers:[],grade:{name:'',version0:0},clock:0}
  let fail=false
  const ctx={state,describe:()=>desc,FORK_GAL_ZOOM_MS:1200,registryOf:()=>({version:0}),generated:{empty:{}},
    loadTexture:async url=>{loads.push(url);if(fail)throw new Error('expired');return {url}},
    startLayer:(url,texture)=>{transitions.push(url);state.layers.push({url,texture,identity:desc.background?.identity})},
    setGrade(){},setStandIn(){},paintLayer:()=>null,destroyLayer(){},cover:{},app:{screen:{width:100,height:100}},vignette:{position:{set(){}}}}
  vm.runInNewContext(scene.slice(scene.indexOf('    function tickBackdrop('),scene.indexOf('    // The figures\' time grade')),ctx)
  ctx.tickBackdrop(0);await Promise.resolve();assert.deepEqual(loads,['/room?one'])
  desc={...desc,background:{...desc.background,url:'/room?two'}};ctx.tickBackdrop(1);await Promise.resolve()
  assert.deepEqual(loads,['/room?one']);assert.deepEqual(transitions,['/room?one'])
  desc={...desc,background:{identity:'garden:hash',url:'/garden?one'}};ctx.tickBackdrop(2);await Promise.resolve()
  assert.deepEqual(loads,['/room?one','/garden?one'])
  fail=true;desc={...desc,background:{identity:'night:hash',url:'/night?expired'}};ctx.tickBackdrop(3);await Promise.resolve()
  assert.equal(state.bg.failed,true)
  fail=false;desc={...desc,background:{...desc.background,url:'/night?fresh'}};ctx.tickBackdrop(4);await Promise.resolve()
  assert.equal(loads.at(-1),'/night?expired');assert.equal(transitions.at(-1),'/garden?one')
  desc={...desc,background:{identity:'new-night-hash',url:'/night?fresh'}};ctx.tickBackdrop(5);await Promise.resolve()
  assert.equal(transitions.at(-1),'/night?fresh')
})
test('static/layered figure owners keep loaded resources on renewal and use fresh leases when re-entering',()=>{
  const loaded=[],shown=[],state={figures:new Map(),textures:new Map()}
  // private fork: authored blink patches follow the same renewal/re-entry lease rule.
  const ctx={state,plan:{replace:[]},forkSpriteUrls:bundle=>bundle?[bundle.view.src]:[],forkGalMouthUrls:()=>[],forkBlinkUrls:bundle=>bundle?[bundle.closed]:[],
    addFigure:figure=>{const entry={figure,src:'',sprite:null,loading:false};state.figures.set(figure.key,entry);return entry},
    showStatic:(entry,src)=>{if(entry.src!==src)shown.push(src);entry.src=src;entry.sprite={}},loadTexture:url=>{loaded.push(url);state.textures.set(url,{});return Promise.resolve({})},console}
  const from=scene.indexOf('        figures.forEach(function (figure)'),to=scene.indexOf('    // Emote-layer pixels',from)
  vm.runInNewContext('function apply(figures){'+scene.slice(from,scene.lastIndexOf('        });',to)+'        });'.length)+'}',ctx)
  const figure=(identity,ticket)=>({key:'actor',kind:'static',identity,src:'/body?'+ticket,talkSrc:'/talk?'+ticket,spriteBundle:{revision:identity,view:{src:'/layer?'+ticket}},blinkBundle:{key:identity,closed:'/blink?'+ticket,rect:[0,0,1,1]}})
  ctx.apply([figure('hash','one')]);const first=[...loaded]
  ctx.apply([figure('hash','two')]);assert.deepEqual(loaded,first);assert.deepEqual(shown,['/body?one'])
  state.textures.delete('/layer?one') // private fork: consumer transport changes cannot substitute content; the owner prepares dependencies.
  ctx.apply([figure('hash','two')]);assert.equal(shown.length,1);assert.deepEqual(loaded,first)
  ctx.apply([figure('changed','three')]);assert.equal(shown.at(-1),'/body?three');assert.ok(loaded.includes('/layer?three'));assert.ok(loaded.includes('/blink?three'))
  state.figures.clear();ctx.apply([figure('changed','four')]);assert.equal(shown.at(-1),'/body?four')
})
// private fork: asynchronous model replacement retains the old instance until handoff.
test('Live2D replacement keeps last-good while pending/failed and commits one ready model',()=>{
  const original={key:'actor',kind:'live2d',identity:'old',figure:{key:'actor',kind:'live2d',identity:'old'},model:{id:'old'},container:{}}
  const state={figures:new Map([['actor',original]])},created=[],destroyed=[]
  const ctx={state,plan:{replace:['actor']},
    addFigure:(figure,attach)=>{const entry={key:figure.key,kind:figure.kind,identity:figure.identity,figure};created.push(entry);if(attach!==false)state.figures.set(figure.key,entry);return entry},
    destroyFigure:entry=>{destroyed.push(entry);entry.dead=true;if(state.figures.get(entry.key)===entry)state.figures.delete(entry.key)},
    loadLive2d:entry=>{entry.loading=true},showStatic(){assert.fail('not a sprite')}}
  const from=scene.indexOf('        figures.forEach(function (figure)'),to=scene.indexOf('    // Emote-layer pixels',from)
  const commit=scene.slice(scene.indexOf('    function commitFigureReplacement('),scene.indexOf('    function destroyFigure('))
  vm.runInNewContext(commit+'function apply(figures){'+scene.slice(from,scene.lastIndexOf('        });',to)+'        });'.length)+'}',ctx)
  const next={key:'actor',kind:'live2d',identity:'new',url:'blob:model'}
  ctx.apply([next]);ctx.apply([next])
  assert.equal(state.figures.get('actor'),original);assert.equal(created.length,1);assert.equal(destroyed.length,0)
  created[0].loading=false // A loader error leaves the last-good object alive.
  assert.equal(state.figures.get('actor').model.id,'old')
  created[0].model={id:'new'};ctx.commitFigureReplacement(created[0])
  assert.equal(state.figures.get('actor'),created[0]);assert.deepEqual(destroyed,[original])
  const stale={key:'actor',previous:original};ctx.commitFigureReplacement(stale)
  assert.equal(state.figures.get('actor'),created[0]);assert.equal(stale.dead,true)
})

// private fork: outfit changes replace a resource in one actor slot, not retire/add before readiness.
test('figure actor slot survives outfit/ref/form changes but its resource identity does not',async()=>{
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url)
  const {packFigureRenderInputs}=require('../tavern-plugin/src/client/fork-pack-playback.cjs')
  const figure={alias:'actor',ref:{packId:'p',figureId:'f'},outfitKey:'day',form:'live2d',modelUrl:'blob:model',media:{model:{identity:'content'}}}
  const render=value=>packFigureRenderInputs(value).stage
  const first=render(figure)
  assert.equal(render({...figure,modelUrl:'blob:renewal'}).identity,first.identity)
  for(const changed of [{...figure,outfitKey:'night'},{...figure,ref:{packId:'p',figureId:'other'}}]) {
    assert.equal(render(changed).key,first.key)
    assert.notEqual(render(changed).identity,first.identity)
  }
})
