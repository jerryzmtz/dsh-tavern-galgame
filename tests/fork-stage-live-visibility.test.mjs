// private fork: reproduce the deployment's hidden Electron window with a turn-126-sized scene.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {createFakeClock,runtimeSource,runtimePage,runtimeText} from './helpers/stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageRuntimeStore} = require('../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
const {createStageDirectorSource} = require('../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageResourceRunner} = require('../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageResourceOwner} = require('../tavern-plugin/src/client/fork-stage-resources.cjs')
// private fork: the browser compares host identities and never recomputes digests, so fixed identity tokens stand in for them.

test('hidden open keeps director data flowing for 173 units / 14 directions / 3 models and avatars', async t => {
  const source = runtimeSource({sessionId:'session',turn:126}), clock = createFakeClock(), calls = [], presents = []
  const units = Array.from({length:173},(_,i) => ({kind:'narration',text:'Fixture paragraph '+(i+1)}))
  const target = {sessionId:'session',turn:126,sourceKey:'fixture-126',sourceDigest:'fixture-text',branchId:'fixture-branch'}
  const binding = {target,unitsDigest:'fixture-units-126'}
  const entries = Array.from({length:14},(_,i) => ({at:1+i*12,ops:[]}))
  const record = {complete:true,binding,baseline:{},entries,end:{}}
  record.digest = 'fixture-record-126'
  const token = {sourceKey:target.sourceKey,branchId:target.branchId,generation:0,bindingKey:'fixture-binding-126',prefixRevision:188,digest:record.digest}
  const envelope = {phase:'done',revision:1,generation:0,target,token,binding,bindingKey:token.bindingKey,prefixRevision:188,
    complete:true,through:173,units,displayUnits:units,record,baseline:record.baseline,entries}
  const resource = (kind,id) => ({resource:true,kind,identity:id,ref:{packId:'fixture'},revision:'r',hash:id,bundleKey:id})
  let serial = 0
  const owner = createStageResourceOwner({urls:{createObjectURL:()=> 'blob:fixture-'+(++serial),revokeObjectURL(){}},
    service:{leaseMedia:async ({hash}) => ({ticket:hash,revision:'r',url:'/media/'+hash}),
      leaseBundle:async ({bundleKey}) => ({ticket:bundleKey,revision:'r',url:'/bundle/'+bundleKey+'/model.json',
        resources:['/bundle/'+bundleKey+'/model.json','/bundle/'+bundleKey+'/texture.png']}),releaseLease(){}},
    fetch:async url => new Response(url.endsWith('.json') ? JSON.stringify({texture:'texture.png'}) : 'fixture-bytes')})
  const resources = createStageResourceRunner({owner,clock,present:(_id,intent)=>presents.push(intent),read:async () => ({status:'ready',directionToken:token,
    value:{state:{figureScale:{version:6,scene:0,hMax:150,rescales:0},lighting:null},scene:{background:resource('media','background')},
      characters:Array.from({length:3},(_,i)=>({form:'live2d',model:resource('bundle','model-'+i)})),
      avatars:Array.from({length:14},(_,i)=>({alias:'actor-'+i,image:resource('media','avatar-'+i)})),audio:{music:null,soundscape:null},widgets:[]}})})
  const director = createStageDirectorSource({clock,onEffect:resources.onEffect,watch:()=>()=>{},read:async args => {calls.push(args);return envelope}})
  const store = createStageRuntimeStore({runEffect:(...args)=>director.runEffect('session',...args)})
  t.after(()=>{store.dispose();director.dispose();resources.dispose()})
  store.dispatch({type:'VISIBILITY',visible:false})
  store.dispatch({type:'TURN_CHANGED',source,text:{...runtimeText(1,units.map((_,i)=>runtimePage(i+1))),units}})
  store.dispatch({type:'STAGE_OPEN',opened:true})
  assert.equal(calls.length,0)
  // private fork: 980b7285a intentionally keeps read-only observation running while hidden.
  assert.deepEqual(store.getSnapshot().pending,{text:false,director:false,projection:false,resources:false,error:null})
  assert.equal(store.getSnapshot().director.phase,'unknown')
  assert.equal(store.getSnapshot().observation.dirty,true)
  assert.ok(store.getSnapshot().observation.flight)
  assert.equal(store.getSnapshot().observation.timer,null)
  for(let i=0;i<200 && !presents.some(value=>value.accepted?.figures?.length===3);i++) await new Promise(resolve=>setImmediate(resolve))
  assert.equal(store.getSnapshot().director.phase,'done')
  assert.equal(store.getSnapshot().director.prefixRevision,188)
  assert.equal(store.getSnapshot().director.bindingKey,token.bindingKey)
  assert.equal(store.getSnapshot().accepted.figures.length,3)
  assert.equal(store.getSnapshot().accepted.avatars.length,14)
  assert.equal(store.getSnapshot().projection,null)
  assert.equal(store.getSnapshot().pending.director,false)
  assert.equal(store.getSnapshot().pending.resources,false)
  assert.equal(owner.debug().resources.filter(value=>value.kind==='bundle' && value.ready).length,3)
  assert.ok(calls.every(args=>args.readOnly===true))
  assert.equal(store.getSnapshot().visible,false,'completion must not depend on a visibility wake')
  assert.ok(clock.size>0,'hidden observation continues polling under the current policy')
  const accepted = store.getSnapshot().accepted
  store.dispatch({type:'VISIBILITY',visible:true})
  assert.equal(store.getSnapshot().accepted,accepted,'visibility wake preserves accepted scene resources')
})
