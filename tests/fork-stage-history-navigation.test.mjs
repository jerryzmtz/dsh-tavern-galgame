// private fork: lazy canonical history shares the native session owner and store.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import vm from 'node:vm'
import {sessionHarness, nativeNode} from './helpers/stage-session-harness.mjs'
const units = turn => [{kind:'narration',text:`Turn ${turn} start`},{kind:'line',alias:'alice',name:'Alice',text:'@bubble:alice|Alice|calm|[Last]|[Voice]'}]
function history(readHistory, count = 40) {
  return sessionHarness({nodes:Array.from({length:count},(_,i) => nativeNode(i+1,'raw '+(i+1))),
    view:{historyWindow:{revision:1},latestAssistantTurn:count},readHistory})
}
// private fork: saving a derived playback frame changes storage revision, not reading intent.
test('private fork: playback metadata/history refresh preserves the current source, cursor and read progress',async () => {
  const h=sessionHarness({nodes:[nativeNode(126,'Opening.\n\nMiddle.\n\nSaved page.')],view:{historyWindow:{revision:1},latestAssistantTurn:126}});
  try {
    await h.owner.navigate('s',126,2,true);
    const before=h.state();
    h.owner.get('s').dispatch({type:'READ_PROGRESS',source:before.source,readThrough:11});
    const cursor=h.state().cursor;
    for(const revision of [2,3,4]) {
      h.view({historyWindow:{revision}});
      assert.equal(h.state().source,before.source,'storage updates are not a new branch');
      assert.deepEqual(h.state().cursor,cursor,'a pack/playback refresh cannot restart page zero');
    }
    h.view({tavernHelper:{lifecycleRevision:1}});
    assert.notEqual(h.state().source.branchId,before.source.branchId,'real lifecycle rollback still resets authority');
  } finally {h.dispose()}
});

test('index does not collapse to latest; back boundary hydrates only the requested turn and enters its last page', async () => {
  const reads = [], h = history(async args => {reads.push(args); return {displayUnits:units(args.turn)}})
  try {
    assert.equal(h.state().textIndex.size,40)
    assert.equal(reads.length,0)
    await h.owner.navigate('s',39,-1,false)
    assert.deepEqual(reads,[{sessionId:'s',turn:39,readOnly:true}])
    assert.equal(h.state().source.turn,39)
    assert.equal(h.state().cursor.anchor.para,2)
    assert.equal(h.state().text.pages[1].voice.speech,'Voice')
    assert.equal(h.state().text.units[1].text,units(39)[1].text)
    assert.ok(h.effects.some(effect => effect.type === 'read-director' && effect.token.source.turn === 39))
  } finally {h.dispose()}
})
test('backlog jumps hydrate distant turns by paragraph; forward return resumes the same latest store', async () => {
  const reads = [], h = history(async args => {reads.push(args.turn);return {displayUnits:units(args.turn)}})
  try {
    const store = h.owner.get('s')
    await h.owner.navigate('s',2,0,false,2)
    assert.equal(h.state().source.turn,2)
    assert.equal(h.state().cursor.anchor.para,2)
    await h.owner.navigate('s',40,0,true)
    assert.equal(h.owner.get('s'),store)
    assert.equal(h.state().source.turn,40)
    assert.equal(h.state().cursor.mode,'live')
    assert.deepEqual(reads,[2])
  } finally {h.dispose()}
})
test('one-time mod consumption survives back/forward, latest return, stage reopen and backlog replay', async () => {
  const h=sessionHarness({nodes:[nativeNode(1,'Older.'),nativeNode(2,'Start.\n\nItem.\n\nNext.')],view:{latestAssistantTurn:2}})
  try {
    const store=h.owner.get('s'), source=h.state().source
    const rows=[{id:'item-a',at:2,kind:'dsh.items.item',payload:{name:'Card'}},{id:'other-a',at:2,kind:'test.other',payload:{text:'Other mod'}}]
    const accept=(revision=1)=>store.dispatch({type:'DIRECTOR_SNAPSHOT',source:h.state().source,envelope:{phase:'done',revision,generation:0,bindingKey:'binding',prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modCorrectionRevision:revision,modPerformances:rows}})
    const shots=type=>h.effects.filter(e=>e.type===type && e.descriptor?.kind==='mod-performance')
    accept()
    await h.owner.navigate('s',2,1,true)
    assert.equal(shots('prepare-one-shot').length,2)
    for(const shot of shots('prepare-one-shot'))store.dispatch({type:'ONE_SHOT_READY',token:shot.token})
    assert.equal(shots('play-one-shot').length,2,'both mod kinds play on their first real playback')
    rows[0]={...rows[0],revision:1,payload:{name:'Card',count:3}}
    accept(2)
    for(const olderTurn of [2,1]) {
      await h.owner.navigate('s',olderTurn,0,false)
      if(olderTurn===2)accept()
      await h.owner.navigate('s',2,0,true)
      accept()
      await h.owner.navigate('s',2,1,true)
    }
    store.dispatch({type:'STAGE_OPEN',opened:false})
    store.dispatch({type:'STAGE_OPEN',opened:true})
    await h.owner.navigate('s',2,0,false,2) // Backlog jump is history, not another playback.
    accept()
    await h.owner.navigate('s',2,1,true)
    accept()
    assert.deepEqual(h.state().source,source)
    assert.equal(shots('prepare-one-shot').length,2,'consumption is independent of the visit')
    assert.equal(shots('play-one-shot').length,2)
    assert.equal(h.state().director.modPerformances[0].payload.count,3,'corrected history remains available')
    rows.push({id:'other-b',at:3,kind:'test.other',payload:{text:'New event'}})
    accept(2)
    await h.owner.navigate('s',2,2,true)
    assert.equal(shots('prepare-one-shot').length,3,'a distinct unconsumed event still plays')
    const pending=shots('prepare-one-shot').at(-1)
    store.dispatch({type:'DIRECTOR_SNAPSHOT',source,envelope:{...h.state().director,revision:3,generation:1,modPerformances:[]}})
    store.dispatch({type:'ONE_SHOT_READY',token:pending.token})
    assert.equal(shots('play-one-shot').length,2,'a director retry still discards obsolete pending work')
  } finally {h.dispose()}
})

test('history without stored display units is skipped without substituting native text', async () => {
  const reads = [], h = history(async args => {reads.push(args.turn);return {displayUnits:args.turn === 39 ? [] : units(args.turn)}})
  try {
    await h.owner.navigate('s',39,-1,false)
    assert.equal(h.state().source.turn,38)
    assert.equal(h.state().cursor.anchor.para,2)
    assert.deepEqual(reads,[39,38])
  } finally {h.dispose()}
})
test('late history reads cannot override a newer navigation or a replaced authority', async () => {
  const pending = [], h = history(args => new Promise(resolve => pending.push({args,resolve})))
  try {
    const old = h.owner.navigate('s',2,0,false)
    await h.owner.navigate('s',40,0,true)
    pending.shift().resolve({displayUnits:units(2)}); await old
    assert.equal(h.state().source.turn,40)
    assert.equal(h.state().textIndex.get(2).unloaded,true)
    const stale = h.owner.navigate('s',3,0,false)
    h.view({card:{path:'replacement'}})
    pending.shift().resolve({displayUnits:units(3)}); await stale
    assert.equal(h.state().source.turn,40)
    assert.equal(h.state().textIndex.get(3).unloaded,true)
  } finally {h.dispose()}
})
test('lazy history page cache stays bounded and evicted identities remain selectable', async () => {
  // private fork: 200 historical turns, plus the current native turn; touches are LRU.
  const h = history(async args => ({displayUnits:units(args.turn)}),210)
  try {
    for (let turn=1;turn<=200;turn++) await h.owner.navigate('s',turn,0,false)
    await h.owner.navigate('s',1,0,false)
    await h.owner.navigate('s',201,0,false)
    assert.equal([...h.state().textIndex.values()].filter(row => !row.unloaded).length,201)
    assert.equal(h.state().textIndex.size,210)
    assert.equal(h.state().textIndex.get(1).unloaded,false)
    assert.equal(h.state().textIndex.get(2).unloaded,true)
    await h.owner.navigate('s',1,0,false)
    assert.equal(h.state().source.turn,1)
  } finally {h.dispose()}
})

// private fork: exercise the production outgoing-transition decision with lazy navigation.
test('forward crosses the outgoing player-input transition before returning to the next turn', async () => {
  const code = readFileSync(new URL('../tavern-plugin/src/client/fork-gal-history.js',import.meta.url),'utf8')
  const scope = {}
  vm.runInNewContext(code.slice(code.indexOf('function forkGalTurnStep'),code.indexOf('function forkGalHistoryVoiceWindow')),scope)
  const h = history(async args => ({displayUnits:units(args.turn)}))
  try {
    await h.owner.navigate('s',39,-1,false)
    const turns = [...h.state().textIndex.keys()].sort((a,b) => a-b)
    const transition = scope.forkGalTurnStep(turns,39,1,2,1,false)
    assert.equal(transition.turn,39)
    assert.equal(transition.transition,true)
    const next = scope.forkGalTurnStep(turns,39,1,2,1,true)
    await h.owner.navigate('s',next.turn,next.page,true)
    assert.equal(h.state().source.turn,40)
    assert.equal(h.state().cursor.mode,'live')
  } finally {h.dispose()}
})
// private fork (B2b): a storage revision is not a new history authority; a lifecycle change (rollback) is.
test('history lifecycle changes and disposal reject outstanding reads; read failures leave the current turn intact', async () => {
  let finish, fail = false
  const h = history(() => fail ? Promise.reject(Error('offline')) : new Promise(resolve => {finish = resolve}))
  try {
    const pending = h.owner.navigate('s',2,0,false)
    h.view({tavernHelper:{lifecycleRevision:1}})
    finish({displayUnits:units(2)}); await pending
    assert.equal(h.state().source.turn,40)
    fail = true
    await h.owner.navigate('s',2,0,false)
    assert.equal(h.state().source.turn,40)
    fail = false
    const disposed = h.owner.navigate('s',2,0,false)
    h.dispose(); finish({displayUnits:units(2)}); await disposed
    assert.equal(h.owner.get('s'),null)
  } finally {h.dispose()}
})
// private fork: repeated input during cold hydration cannot queue a new expensive RPC each time.
test('held Back coalesces cold history reads while the last navigation retains authority', async () => {
  let finish, reads=0
  const h=history(()=>{reads++;return new Promise(resolve=>{finish=resolve})})
  try {
    const calls=Array.from({length:30},()=>h.owner.navigate('s',39,-1,false))
    assert.equal(reads,1)
    finish({displayUnits:units(39)})
    await Promise.all(calls)
    assert.equal(h.state().source.turn,39)
    assert.equal(h.state().cursor.anchor.para,2)
  } finally {h.dispose()}
})

test('history consumes unseen items without playing them, including forward navigation',async()=>{
  const h=sessionHarness({nodes:[nativeNode(1,'Start.\n\nItem.\n\nEnd.'),nativeNode(2,'Latest.')],view:{latestAssistantTurn:2}})
  try {
    const store=h.owner.get('s');
    await h.owner.navigate('s',1,2,false);
    const accept=()=>store.dispatch({type:'DIRECTOR_SNAPSHOT',source:h.state().source,envelope:{phase:'done',revision:1,generation:0,bindingKey:'saved',prefixRevision:1,through:3,complete:true,baseline:{},entries:[],modPerformances:[{id:'unseen',at:2,kind:'dsh.items.item',payload:{name:'Key'}}]}});
    accept();
    const shots=type=>h.effects.filter(e=>e.type===type&&e.descriptor?.kind==='mod-performance');
    assert.equal(shots('prepare-one-shot').length,0);
    await h.owner.navigate('s',1,0,false);accept();
    await h.owner.navigate('s',1,1,true);
    assert.equal(h.state().cursor.mode,'history');
    assert.equal(shots('prepare-one-shot').length,0);
    assert.equal(shots('play-one-shot').length,0);
    await h.owner.navigate('s',1,0,false);await h.owner.navigate('s',1,1,true);
    assert.equal(shots('play-one-shot').length,0);
  }finally{h.dispose()}
})

// private fork (B2b O10): turns before the native conversation window are paged in for the backlog, read-only.
test('loadOlder pages the native window until an earlier turn is indexed, and stops when history starts', async () => {
  const all = Array.from({length:10},(_,i) => nativeNode(i+1,'raw '+(i+1)))
  const reads = [], h = sessionHarness({nodes:all.slice(7),view:{historyWindow:{revision:1},latestAssistantTurn:10},
    readHistory: async args => {reads.push(args.turn); return {displayUnits:units(args.turn)}}})
  // Native pages: an empty page first (only tool events), then two turns at a time.
  const pages = [[], all.slice(5,7), all.slice(3,5), all.slice(0,3)]
  let loaded = all.slice(7), calls = 0
  const session = h.binding.session
  session.publish({running:false,hasMore:true})
  session.loadOlder = async () => { calls++; loaded = [...pages.shift(), ...loaded]; h.binding.set(loaded); session.publish({running:false,hasMore:pages.length > 0}) }
  try {
    assert.deepEqual([...h.state().textIndex.keys()].sort((a,b)=>a-b),[8,9,10])
    assert.equal(h.owner.hasOlder('s'),true)
    assert.equal(await h.owner.loadOlder('s'),true)
    assert.equal(calls,2,'an empty page is followed by the next one')
    assert.deepEqual([...h.state().textIndex.keys()].sort((a,b)=>a-b),[6,7,8,9,10])
    assert.equal(h.state().textIndex.get(6).unloaded,true,'text still loads lazily, row by row')
    assert.deepEqual(reads,[])
    await h.owner.loadOlder('s'); await h.owner.loadOlder('s')
    assert.equal(Math.min(...h.state().textIndex.keys()),1,'the backlog reaches turn 1')
    assert.equal(h.owner.hasOlder('s'),false)
    assert.equal(await h.owner.loadOlder('s'),false)
    assert.equal(calls,4)
    assert.equal(await h.owner.hydrateText('s',1),true)
    assert.equal(h.state().textIndex.get(1).text.pages[0].text,'Turn 1 start')
  } finally {h.dispose()}
})