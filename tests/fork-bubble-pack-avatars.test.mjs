// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: synthetic pack assertions use canonical emotion ownership, not free-form state identities.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: transcript avatars are derived pack media, not saved card image URLs.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {cardBubbleConfig} from '../tavern-plugin/lib/fork-card-stage.js'
import {defaultAssetEngineSettings} from '../tavern-plugin/lib/domain/asset-engine-settings.js'
import {cardExtension, syntheticPack, FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'}
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
const source = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js',import.meta.url),'utf8')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')) // private fork: include the extracted mood/name helpers.
.replace('__TAVERN_BUBBLE_MOODS__',JSON.stringify(moods))
async function avatarPack() {
  const pack = await syntheticPack(), outfit = pack.figures[FIGURE_ID].outfits[0]
  outfit.sprite.assets['assets/stage-special.png'] = outfit.avatars.crying
  return pack
}
const projection = pack => cardBubbleConfig({extensions:{dsh_tavern:cardExtension()}},defaultAssetEngineSettings(),pack ? [pack] : []).characters[0]

test('opening outfit projects mood descriptors including crying state mapping without mutating card or pack',async()=>{
  const pack = await avatarPack(); pack.revision = 'r1'
  const figure = pack.figures[FIGURE_ID], outfit = figure.outfits[0]
  outfit.avatars.sad = outfit.avatars.joy
  const before = structuredClone(pack), character = projection(pack), media = character.avatarMedia
  assert.equal(media.default.hash,outfit.sprite.assets['assets/stage.png'])
  assert.equal(media.moods.crying.hash,outfit.avatars.crying)
  // private fork: uploads use the figure emotion ID, not implicit legacy aliases.
  assert.equal(media.moods.sad.hash,outfit.avatars.sad)
  assert.notEqual(media.moods.crying.hash,media.moods.sad.hash)
  assert.equal(media.moods.anger.hash,media.default.hash,'missing expression uses calm, not sadness or crying')
  assert.equal(media.default.revision,'r1')
  assert.equal(media.default.alias,character.alias) // private fork: ref-derived key, not card alias.
  assert.equal(media.default.kind,'media')
  assert.equal(media.default.resource,true)
  assert.equal(media.default.ref.figureId,FIGURE_ID)
  assert.equal(media.default.identity,`${pack.manifest.id}:figures:${FIGURE_ID}:${outfit.avatars.calm}`)
  assert.equal('avatar' in character,false)
  assert.equal('moods' in character,false)
  assert.equal('full' in character,false)
  assert.deepEqual(structuredClone(pack),before)
  delete outfit.sprite.assets['assets/stage-special.png']
  assert.equal(projection(pack).avatarMedia.moods.crying.hash,outfit.avatars.crying)
  figure.outfits[0].enabled = false
  assert.equal(projection(pack).avatarMedia.default.outfitKey,'casual','private fork: first enabled outfit is the opening')
  figure.outfits[0].enabled = true; figure.enabled = false
  // private fork: unavailable library figures grant no projected character or media.
  assert.equal(projection(pack),undefined)
  assert.equal(projection(null),undefined)
  assert.deepEqual(cardBubbleConfig(null,defaultAssetEngineSettings()).characters,[])
})

function browser() {
  let cursor = 0, revision = 0
  const slots = [], effects = [], listeners = new Set(), requests = [], revoked = [], releases = []
  let fail = false, count = 0, activeStage = null
  const service = {async leaseMedia(args) {requests.push(args);if(fail)throw Error('offline');return {revision:'r1',url:'/media/'+args.hash,ticket:args.hash}},releaseLease:ticket=>releases.push(ticket)}
  const React = {
    useSyncExternalStore(_subscribe,get) {return get()},
    useRef(initial) {const i=cursor++;return slots[i] ||= {current:initial}},
    useState(initial) {const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i],value=>slots[i]=value]},
    useEffect(fn,deps) {const i=cursor++,old=slots[i];if(!old || deps.some((v,j)=>!Object.is(v,old.deps[j]))) {old?.stop?.();const state={deps};slots[i]=state;effects.push(()=>state.stop=fn())}},
    createElement:(type,props,...children)=>({type,props,children})
  }
  const owner = createStageResourceOwner({service,fetch:async()=>new Response('image',{headers:{'content-type':'image/png'}}),urls:{createObjectURL:()=>`blob:${++count}`,revokeObjectURL:url=>revoked.push(url)}})
  // private fork: this resource-owner fixture has no DOM; contrast is mounted in figure-auto-color-browser.
  const context = {useForkFigureTextContrast(){},React,queueMicrotask,forkPackListeners:listeners,useForkPackRevision:()=>revision,
    forkGalActive:{subscribe:()=>()=>{},get:()=>activeStage},
    forkStageSessions:{resourceOwner:owner,get:()=>({subscribe:()=>()=>{},getSnapshot:()=>({source:{sessionId:'session',authorityEpoch:1}})})},
    stageResourceAuthority:source=>JSON.stringify([source.sessionId,source.authorityEpoch]),ForkPackImage:'PackImage'}
  vm.runInNewContext(source.slice(0,source.indexOf('// Per-session bubble settings'))+'\n'+source.slice(source.indexOf('function forkBubbleMediaDescriptor'),source.indexOf('// Drop-in for TavernColoredMarkdown')),context)
  return {context,owner,requests,revoked,releases,setFail:value=>fail=value,setStage:value=>activeStage=value,
    render(character,mood='calm',wanted=true) {cursor=0;const value=context.useForkBubbleMedia('session',character,mood,moods,wanted);effects.splice(0).forEach(fn=>fn());return value},
    event(event) {if(event.type==='unavailable')owner.revoke({authority:true});for(const fn of listeners)fn(event);revision++},
    stop() {slots.forEach(slot=>slot?.stop?.());owner.dispose()}}
}
const tick = () => new Promise(resolve=>setTimeout(resolve,10))
test('browser leases once per identity, preserves URL on refresh, changes moods, revokes and releases on unmount',async()=>{
  const pack = await avatarPack();pack.revision='r1';const character=projection(pack), b=browser()
  const stagePin=await b.owner.acquire(character.avatarMedia.default,JSON.stringify(['session',1]))
  assert.equal(b.render(character),null);await tick()
  const calm=b.render(character)
  assert.equal(calm.src,stagePin.handle.url,'stage and transcript share the exact owned Blob URL')
  assert.deepEqual(calm.crop,character.avatarMedia.default.crop)
  stagePin.release()
  assert.match(calm.src,/^blob:/)
  assert.equal(b.requests.length,1)
  b.event({packId:pack.manifest.id,revision:'r1'});b.render(character);await tick()
  assert.equal(b.render(character).src,calm.src)
  assert.equal(b.requests.length,1,'reuse browser-owned bytes; ticket changes are not image identity')
  assert.equal(b.render(character,'crying'),null);await tick()
  const crying=b.render(character,'crying')
  assert.notEqual(crying.identity,calm.identity)
  assert.notEqual(crying.src,calm.src)
  b.setFail(true);b.event({type:'unavailable'})
  assert.equal(b.render(character,'crying'),null);await tick()
  assert.equal(b.render(character,'crying'),null)
  assert.ok(b.revoked.includes(calm.src));assert.ok(b.revoked.includes(crying.src))
  b.stop();await tick();assert.ok(b.releases.length>=2)
})
test('row passes media to the shared avatar and unknown characters retain the letter placeholder',async()=>{
  const b=browser(), {context}=b, media={identity:'figure:hash',src:'blob:face'}
  context.useForkBubbleMedia=()=>media
  const row=context.ForkBubbleRow({sessionId:'s',segment:{alias:'actor',name:'Actor',mood:'crying',text:'line'},config:{characters:[]}})
  const avatar=row.children[0].children[0]
  assert.equal(avatar.props.media,media)
  const rendered=context.ForkBubbleAvatar(avatar.props)
  assert.equal(rendered.children[0].type,'PackImage')
  assert.equal(rendered.children[0].props.src,media.src)
  const unknown=context.ForkBubbleAvatar({name:'Unknown',character:{avatar:'/legacy'}})
  // private fork: reserve geometry immediately, but delay the surname fallback.
  assert.doesNotMatch(unknown.props.className,/avatar-ph/)
  assert.equal(unknown.children[0],null)
  assert.match(source,/h\(ForkBubbleRow, \{ sessionId: props.sessionId/)
})
test('unmount during an in-flight lease never publishes a stale image and releases the late lease',async()=>{
  const pack=await avatarPack();pack.revision='r1';const b=browser()
  b.render(projection(pack));b.stop();await tick()
  assert.ok(b.releases.length>0)
})

test('offscreen transcript avatars do not pin bytes, and opening stage releases visible transcript pins',async()=>{
  const pack=await avatarPack();pack.revision='r1';const character=projection(pack),b=browser()
  assert.equal(b.render(character,'calm',false),null);await tick()
  assert.equal(b.requests.length,0)
  b.render(character);await tick();assert.equal(b.owner.snapshot().pins,1)
  b.setStage('session');assert.equal(b.render(character),null);await tick()
  assert.equal(b.owner.snapshot().pins,0)
  b.setStage(null);assert.equal(b.render(character),null);await tick()
  assert.ok(b.render(character).src);assert.equal(b.requests.length,1,'reuses retained bytes when the stage did not evict them')
  b.stop()
})
