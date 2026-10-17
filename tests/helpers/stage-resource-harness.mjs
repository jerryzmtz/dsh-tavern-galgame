// private fork: the C host/coordinator/source owns direction; D only extends onEffect.
import {createRequire} from 'node:module'
import {fixture,answer,deferred} from './stage-director-harness.mjs'
import {createFakeClock,runtimeSource,runtimeText,runtimePage} from './stage-runtime-harness.mjs'
import {readStageProjection} from '../../tavern-plugin/lib/domain/stage-projection.js'
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('../../tavern-plugin/src/client/fork-stage-resources.cjs')
const {createStageResourceRunner} = require('../../tavern-plugin/src/client/fork-stage-resource-runner.cjs')
const {createStageDirectorSource} = require('../../tavern-plugin/src/client/fork-stage-director-source.cjs')
const {createStageRuntimeStore} = require('../../tavern-plugin/src/client/fork-stage-runtime-store.cjs')
// private fork: synthetic media candidates now include the mandatory replay-derived P6 ruler.
const fixtureScale = {version:6,scene:0,hMax:150,rescales:0};
const drain = async () => {for(let i=0;i<40;i++)await new Promise(resolve=>setTimeout(resolve,1))}
async function harness(t, direction=answer, visual, resourceOptions={}) {
  const f = await fixture(request=>request.onToolCall({name:'stage_update',arguments:direction})), clock=createFakeClock(),requests=[],presents=[],revoked=[],plays=[]
  let response, pendingBytes, rejectBytes, serial=0
  const owner=createStageResourceOwner({service:f.services.get('assetLibrary'),urls:{createObjectURL:()=> 'blob:'+(++serial),revokeObjectURL:url=>revoked.push(url)},fetch:async url=>{await pendingBytes;if(rejectBytes?.(url))throw Error('byte read failed');return new Response('bytes')}})
  const source=runtimeSource({sessionId:'session'})
  const resources=createStageResourceRunner({...resourceOptions,owner,clock,visual,play:(_id,track,token)=>plays.push({track,token}),present:(_id,intent)=>{presents.push(intent)},read:async args=>{
    requests.push(args)
    if(response) return typeof response==='function' ? response(args) : response
    return readStageProjection({...args,readDirection:()=>f.director.get(f.read(),1,null,{readOnly:true}),readConsumer:()=>f.assets.consumer(f.read(),'http://localhost'),readSettings:()=>f.engineSettings.read(),revision:()=>f.assets.revision})
  }})
  const runner=createStageDirectorSource({clock,onEffect:resources.onEffect,read:args=>f.director.get(f.read(),args.turn,null,args),watch:(source,wake)=>f.signals.subscribe(source.sessionId,'stage-direction',wake)})
  const store=createStageRuntimeStore({runEffect:(...args)=>runner.runEffect('session',...args)})
  const envelope=await f.director.get(f.read(),1,null,{readOnly:true})
  store.dispatch({type:'TURN_CHANGED',source,text:{...runtimeText(1,[runtimePage(1),runtimePage(2)]),units:envelope.displayUnits}})
  await drain()
  t.after(async()=>{store.dispose();runner.dispose();resources.dispose();await f.dispose()})
  return {f,store,source,owner,resources,clock,requests,presents,revoked,plays,rejectBytes:value=>{rejectBytes=value},setResponse:value=>{response=value},blockBytes:value=>{pendingBytes=value},async direct(){await f.director.get(f.read());await f.director.drain();await drain()},refresh(){store.dispatch({type:'REFRESH_BEGIN',source})}}
}

export {harness,drain,fixtureScale};
