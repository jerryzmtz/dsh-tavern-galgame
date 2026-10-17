// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: include source literally, without String.replace replacement-token expansion.
// private fork: obsolete v1 editor assertions migrate to fork-asset-packs-ui.test.mjs.
import bubbleLine from '../tavern-plugin/src/client/fork-bubble-line.cjs' // private fork: native identity resolution.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with { type: 'json' }
import { normalizeBubbleConfig } from '../tavern-plugin/lib/domain/dialogue-bubbles.js'

const presets = await readFile(new URL('../tavern-plugin/src/client/fork-bubble-presets.js', import.meta.url), 'utf8')
const voices = await readFile(new URL('../tavern-plugin/src/client/fork-voice.js', import.meta.url), 'utf8')
const azure = '' // private fork: provider UI belongs to dsh-tts
const bubbles = (await readFile(new URL('../tavern-plugin/src/client/fork-bubbles.js', import.meta.url), 'utf8')).split('// @include-protocol figure-resolution.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/figure-resolution.cjs', import.meta.url), 'utf8')).split('// @include fork-bubble-line.cjs').join(await readFile(new URL('../tavern-plugin/src/client/fork-bubble-line.cjs', import.meta.url), 'utf8')).replace('__TAVERN_BUBBLE_MOODS__', JSON.stringify(moods))
const assets = '' // private fork: v1 source editor removed
const assetHelpers = assets.slice(0, assets.indexOf('// ---------- Stores'))
const modes = await readFile(new URL('../tavern-plugin/src/client/fork-bubble-modes.js', import.meta.url), 'utf8')
const modesHelpers = modes.slice(0, modes.indexOf('// ---------- Components'))
const bubblesHead = bubbles.slice(0, bubbles.indexOf('// Per-session bubble settings'))
const tick = () => new Promise(resolve => setImmediate(resolve))
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }

test('save queue serializes, merges latest pending, retires old card results, and recovers after failure', async () => {
  const context = {}
  vm.runInNewContext(presets + ';this.queue = forkBubbleSaveQueue;', context)
  const calls = [], published = [], failed = [], pending = []
  const queue = context.queue(value => { calls.push(value); const item = deferred(); pending.push(item); return item.promise }, value => published.push(value), error => failed.push(error.message))
  queue.push('a'); queue.push('b'); queue.push('c')
  assert.deepEqual(calls, ['a'])
  pending[0].resolve('saved-a'); await tick()
  assert.deepEqual(calls, ['a', 'c'])
  assert.deepEqual(published, [])
  queue.retire(); queue.push('new-card')
  pending[1].resolve('old-card'); await tick()
  assert.deepEqual(published, [])
  assert.deepEqual(calls, ['a', 'c', 'new-card'])
  pending[2].reject(new Error('worldbook failed')); await tick()
  assert.deepEqual(failed, ['worldbook failed'])
  queue.push('retry'); pending[3].resolve('done'); await tick()
  assert.deepEqual(published, ['done'])
})

function renderer() {
  let slots = [], cursor = 0
  const effects = []
  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity).filter(item => item != null && item !== false) }),
    useState(value) { const index = cursor++; if (!(index in slots)) slots[index] = typeof value === 'function' ? value() : value; return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(value) { const index = cursor++; if (!(index in slots)) slots[index] = { current: value }; return slots[index] },
    useEffect(fn) { effects.push(fn) },
    useSyncExternalStore(_, get) { return get() }
  }
  return { React, effects, render(fn, props) { cursor = 0; return fn(props) } }
}
function walk(tree) { return tree && typeof tree === 'object' ? [tree, ...tree.children.flatMap(walk)] : [] }
function text(tree) { return tree && typeof tree === 'object' ? tree.children.map(text).join(' ') : String(tree || '') }

// private fork: builtin voice chips and audition overrides belonged to the deleted
// card registry. CardPage/listVoices picker behavior lives in fork-asset-packs-ui.
test('native speech routing requires explicit CARD binding and complete language input', () => {
  const context = {}
  vm.runInNewContext(bubblesHead + voices.slice(voices.indexOf('function forkPackSpeechInput'),voices.indexOf('// private fork: native handles')), context)
  const segment={kind:'bubble',alias:'actor',text:'display',singleVoiceText:true,mood:'joy'}
  const config={characters:[{alias:'actor',voice:'work/actor',voiceLanguage:'en'}],stage:{textLanguage:'en'}}
  const spec=(line,cfg=config)=>context.forkPackSpeechInput(line,cfg)
  assert.equal(spec(segment).text,'display')
  for(const characters of [[],[{alias:'actor',voice:''}],[{alias:'other',voice:'work/actor'}]])assert.equal(spec(segment,{...config,characters}),null)
  assert.equal(spec({...segment,streaming:true}),null)
  assert.equal(spec(segment,{...config,stage:{textLanguage:'zh'}}),null)
  assert.equal(spec({...segment,singleVoiceText:false,speech:'translation'},{...config,stage:{textLanguage:'zh'}}).text,'translation')
  for(const mood of moods)assert.equal(spec({...segment,mood:mood.id}).mood,mood.id)
  assert.equal(spec(segment,{...config,characters:[{alias:'actor',voice:'unlisted-id'}]}).text,'display','native host, not a browser registry, checks backend availability')
})

// private fork (owner 2026-10 r3): 舞台设置 › 提示词 edits only the global 对白格式 (engine dialogue.injection): each save reads
// the newest revision, keeps the other dialogue fields (no retired `enabled`), runs one at a time per session and
// republishes the shared store; 恢复默认 clears template and extra but keeps the placement.
test('对白格式 saves replace only engine dialogue.injection, serially, and republish the dialogue store', async () => {
  const requests=[],published=[],engine={revision:'r1',values:{dialogue:{emotions:[{id:'smug',label:'得意'}],injection:{template:'T {{bubble_format}}',extra:'E',placement:{order:5}},textLanguage:'zh'}}}
  const env={React:{},forkBubbleStore:{set(session,data){published.push({session,data})}},rpc(method,args,session){const d=deferred();requests.push({method,args,session,...d});return d.promise},console}
  vm.runInNewContext(bubbles.slice(bubbles.indexOf('const forkDialogueInjectionWrites'))+';this.save=forkSaveDialogueInjection;this.reset=forkResetDialogueInjection;',env)
  const first=env.save('s',()=>({template:'',extra:'new'})),second=env.reset('s')
  await tick();assert.equal(requests.length,1);assert.equal(requests[0].method,'getAssetEngineSettings')
  requests[0].resolve(engine);await tick()
  assert.equal(requests[1].method,'saveAssetEngineSettings');assert.equal(requests[1].args.expectedRevision,'r1')
  assert.deepEqual(JSON.parse(JSON.stringify(requests[1].args.patch)),{dialogue:{emotions:[{id:'smug',label:'得意'}],injection:{template:'',extra:'new'},textLanguage:'zh'}})
  requests[1].resolve({revision:'r2'});await tick();assert.equal(requests[2].method,'getDialogueBubbles');requests[2].resolve({cardPath:'cards/a.json'});await first
  assert.equal(published.length,1);assert.equal(published[0].session,'s')
  await tick();assert.equal(requests[3].method,'getAssetEngineSettings','the reset waits for the first save');requests[3].resolve({...engine,revision:'r2'});await tick()
  assert.deepEqual(JSON.parse(JSON.stringify(requests[4].args.patch.dialogue.injection)),{template:'',extra:'',placement:{order:5}})
  requests[4].resolve({revision:'r3'});await tick();requests[5].resolve({});await second;assert.equal(published.length,2)
})

test('an older host\'s protagonist becomes that character\'s offstage flag in the draft', () => {
  const context = {}
  vm.runInNewContext(assetHelpers + modesHelpers + ';this.incoming=forkBubbleIncoming;this.outgoing=forkStageOutgoing;', context)
  const legacy = { characters: [{ alias: 'me' }, { alias: 'her' }], stage: { protagonist: 'me' } }
  assert.deepEqual(JSON.parse(JSON.stringify(context.incoming(legacy).characters)), [{ alias: 'me', offstage: true }, { alias: 'her' }])
  const explicit = { characters: [{ alias: 'me', offstage: false }, { alias: 'her', offstage: true }], stage: { protagonist: 'me' } }
  assert.deepEqual(JSON.parse(JSON.stringify(context.incoming(explicit).characters)), explicit.characters, 'explicit flags win over a stale protagonist')
  const out = context.outgoing({ protagonist: 'me', worldview: 'school', tags: ['x'], theme: 'gothic' })
  assert.deepEqual(Object.keys(out).sort(), ['theme'])
})

// private fork: native assignment refresh must not overwrite an unfinished settings draft.
test('asset refresh adopts pack avatar projections and new native characters while retaining local character edits', () => {
  const context = {...bubbleLine}
  vm.runInNewContext(bubbles.slice(bubbles.indexOf('function forkBubbleRefreshAssets'),bubbles.indexOf('// Right sidebar tab')),context)
  const draft = {characters:[{alias:'actor',assetAlias:'f_actor',name:'Unsaved name',voice:'voice',avatarMedia:{default:'old'},outfits:[{id:'uniform'}]}],stage:{theme:'magical'}}
  const config = {characters:[{alias:'f_actor',aliases:['actor'],ref:{packId:'pack',figureId:'actor'},name:'Saved name',avatarMedia:{default:'new'}},{alias:'native_new',avatarMedia:{default:'new-character'}}]}
  const merged = context.forkBubbleRefreshAssets(draft,config,true)
  assert.equal(merged.characters[0].alias,'actor'); assert.equal(merged.characters[0].name,'Unsaved name')
  assert.deepEqual(merged.characters[0].avatarMedia,{default:'new'}); assert.equal(merged.characters[0].voice,'voice')
  assert.deepEqual(merged.characters[0].outfits,[{id:'uniform'}]); assert.equal(merged.characters[1].alias,'native_new')
  assert.equal(context.forkBubbleRefreshAssets(draft,config,false).characters.length,1,'pending deletion is not resurrected')
  assert.equal(draft.characters[0].avatarMedia.default,'old'); assert.equal(merged.stage,draft.stage)
})

// private fork: shared native picker keeps missing CARD IDs visible without substituting a voice.
test('native voice picker retains unavailable saved IDs and offers explicit no-voice', () => {
  const r=renderer();r.React.useId=()=> 'voices'
  const context={React:r.React}
  vm.runInNewContext(bubbles.slice(bubbles.indexOf('function ForkBubbleLibraryPicker'),bubbles.indexOf('// Portrait chip')),context)
  const chosen=[],props={searchable:true,value:'retired/voice',entries:[{id:'work/voice',label:'Available'}],noneLabel:'No voice',missingNote:'Unavailable',onChange:value=>chosen.push(value)}
  let tree=r.render(context.ForkBubbleLibraryPicker,props)
  const combo=()=>walk(tree).find(n=>n.props.role==='combobox')
  assert.equal(combo().props.value,'retired/voice');combo().props.onFocus();tree=r.render(context.ForkBubbleLibraryPicker,props)
  const options=walk(tree).filter(n=>n.props.role==='option')
  assert.equal(options.length,3);assert.match(text(options[2]),/retired\/voice/)
  options[0].props.onClick();assert.deepEqual(chosen,[''])
})
