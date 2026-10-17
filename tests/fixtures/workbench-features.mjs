import {mkdir,mkdtemp,rm} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {createAssetPackService} from '../../tavern-plugin/packages/dsh-asset-library/src/pack-v2/service.js'
import {createAssetEngineSettings} from '../../tavern-plugin/lib/fork-asset-engine.js'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {createAssetGeneration} from '../../tavern-plugin/lib/domain/asset-generation.js'
import {createWorkbenchFeatureHost} from '../../tavern-plugin/lib/workbench-feature-host.js'
import {createCardBundleAdapter} from '../../tavern-plugin/lib/fork-card-bundle.js'
import {createCardPreparation} from '../../tavern-plugin/lib/domain/card-preparation.js'
import {registerWorkbenchFeatureTools,featureRequestSchema} from '../../tavern-plugin/lib/tools/workbench-features.js'
import {validateJsonSchemaValue} from '@deepseek-ai/dsh-tools'

export function requestFor(name,input) {
  function fit(schema) {
    if(schema.oneOf) {for(const option of schema.oneOf){const value=fit(option);if(value && !validateJsonSchemaValue(schema,value).length)return value}return null}
    if(schema.properties.action && !schema.properties.action.enum.includes(input.action))return null
    const result={}
    for(const key of Object.keys(schema.properties)) {
      if(key==='operation'){const value=fit(schema.properties[key]);if(!value)return null;result[key]=value}
      else if(Object.hasOwn(input,key))result[key]=input[key]
    }
    return validateJsonSchemaValue(schema,result).length?null:result
  }
  const request=fit(featureRequestSchema(name))
  if(!request)throw new Error('Cannot encode '+name+' '+JSON.stringify(input))
  return {request}
}
export async function workbenchFixture(options={}) {
  const parent=options.root || fileURLToPath(new URL('../../.tmp/workbench-tests/',import.meta.url));await mkdir(parent,{recursive:true})
  const root=await mkdtemp(parent+'/case-'),workspace=root+'/workspace';await mkdir(workspace)
  const preparation=createCardPreparation()
  let card=preparation.create({kind:'import',payload:{name:'Fixture card'}})
  const cardTransactions=createCardBundleAdapter({cardPreparation:preparation,authorizeTarget:async path=>({cardId:path}),readWorkspace:async()=>card,writeWorkspace:async(_path,value)=>{card=value},withCardLock:async(_path,task)=>task()})
  const library=createAssetPackService({assetRoot:root+'/packs',cardTransactions}),store=createProfileDataStore({dataRoot:root+'/data'})
  let engineValues,approvalOutcome='rejected',approvedHook,paidCalls=0
  const native={writable:true,installSection(_ctx,_name,_schema,defaults,hooks){engineValues=structuredClone(defaults);hooks.setSource(()=>engineValues)},async replace(_section,value){engineValues=value}}
  const settingsCtx={get:()=>native,inject:(_names,fn)=>fn(settingsCtx),effect:()=>{}}
  const engine=createAssetEngineSettings(settingsCtx),calls=[],approvals=[]
  const generation=createAssetGeneration({store,getLibrary:()=>library,capture:async()=>({active:{provider:'openai',protocol:'responses-image-tool',model:'fixture-image',baseURL:'http://127.0.0.1:1',ready:true},apiKey:'fixture-no-network'}),imageModule:{request(){paidCalls++;throw new Error('No paid request permitted in fixture')}}})
  let pack=(await library.createPack({name:'Workbench fixture',expectedRevision:null})).snapshot
  const created=await library.createFigure({packId:pack.manifest.id,expectedRevision:pack.revision,figure:{schemaVersion:1,name:'Canonical figure',appearance:'sprite',outfits:[]}})
  pack=created.snapshot
  card=preparation.create({kind:'import',payload:{name:'Fixture card',extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[pack.manifest.id]}}}}})
  const chat={id:'editor',mode:'card',cardPath:'cards/fixture.json',workspace:{mountedResources:[]}}
  const rpc=async(method,args)=>{
    calls.push({method,args})
    if(options.rpc){const result=await options.rpc(method,args);if(result!==undefined)return result}
    if(method==='getAssetPackDependencies')return {available:true,count:0,cards:[]}
    if(method==='getCardAssetBindings')return {path:args.path,revision:(await cardTransactions.snapshot({path:args.path})).revision,extension:card.raw.extensions.dsh_tavern}
    if(method==='getAssetEngineSettings')return engine.read()
    if(method==='saveAssetEngineSettings')return engine.save(args)
    const name={prepareAssetGeneration:'prepare',generateAssetCandidate:'generate',getAssetGenerationJob:'get',listAssetCandidates:'list',readAssetCandidate:'read',cancelAssetGenerationJob:'cancel',rejectAssetCandidate:'reject',retryAssetCandidateSave:'retrySave'}[method]
    if(name)return generation[name](args)
    throw new Error('Unexpected RPC '+method)
  }
  const host=createWorkbenchFeatureHost({chatForSession:async()=>chat,getLibrary:()=>library,getPackSettings:()=>({read:()=>({values:{globalEnabledPackIds:options.globalPack?[pack.manifest.id]:[]}})}),getTtsControl:()=>options.tts,
    approval:()=>options.noApproval?undefined:options.approval || {effectivePolicy:()=>options.policy || 'ask',async request(input){approvals.push(input);await approvedHook?.();return approvalOutcome}},readChat:async()=>undefined,cardIdentity:async()=> 'fixture',rpc})
  const tools=new Map();registerWorkbenchFeatureTools({tools:{register:t=>tools.set(t.name,t)},host})
  const exec={callId:'fixture-call',agent:{session:{id:'fixture-session',header:{cwd:workspace}}},signal:new AbortController().signal}
  return {root,workspace,pack,figureId:created.figureId,library,cardTransactions,engine,generation,chat,host,tools,exec,calls,approvals,
    setApproval(value,hook){approvalOutcome=value;approvedHook=hook},get paidCalls(){return paidCalls},
    invoke:(name,input,execution=exec)=>tools.get('tavern_'+name).execute(requestFor(name,input),execution),
    async close(){host.dispose();await generation.dispose();await library.dispose();if(!options.keep&&!process.env.DSH_KEEP_TEST_DATA)await rm(root,{recursive:true,force:true})}}
}
