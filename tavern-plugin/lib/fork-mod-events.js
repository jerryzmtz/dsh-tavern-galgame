import {randomUUID} from 'node:crypto'
import {isDeepStrictEqual as equal} from 'node:util'
import contract from '../packages/dsh-presentation-protocol/src/mod-contract.cjs'
import {createModEventBus} from './domain/mods/events.js'
import {createModRuntime} from './domain/mods/runtime.js'
import {createModMessageTransport} from './domain/mods/message-transport.js'
import {modCatalogue,modTurnActive} from './domain/mods/catalogue.js'
import {createModVariables} from './domain/mods/variables.js'
import {createSettledModSource} from './fork-mod-source.js'
import {captureStageTarget} from './domain/stage-incremental.js'
import {latestSettledModTurn} from './domain/mods/settled-source.js'
const {modCheck:check,modShape:shape}=contract
const unwrap=async value=>{const result=await value;if(!result.ok)throw Object.assign(new Error(result.error.message),result.error);return result.value}
const publicContext=(value,epoch)=>({modId:'',sessionId:value.head.sessionId,branchId:value.source.branchId,revision:String(value.head._storageRevision),
  sourceKey:value.source.sourceKey,generation:value.source.generation,textVersion:value.source.textVersion,authorityEpoch:epoch,settledTurn:value.turn,mode:value.mode || 'live'})

export function createModSessionEvents({library,builtins,readCard,config,index,readWindow,source,variables,epoch,connected=()=>true,onError=()=>{},modelTasks,presentation,catalogues,modelStatus,publishView=()=>{}}) {
  const settled=createSettledModSource({index,readWindow,source}),sessions=new Map()
  let live=true,sequence=0
  const clock=row=>row.elapsed+(row.active?Date.now()-row.started:0)
  function clearViews(row) {
    for(const timer of row.timers.values())clearTimeout(timer)
    row.timers.clear();row.views.clear();publishView(row.context.sessionId)
  }
  function accept(row,manifest,context,result,valid) {
    clearTimeout(row.timers.get(manifest.id));row.timers.delete(manifest.id)
    if(!valid() || !result?.view || !row.active)return
    if(Number.isFinite(result.view.activeTimeMs)){row.elapsed=Math.max(clock(row),result.view.activeTimeMs);row.started=Date.now()}
    row.views.set(manifest.id,{modId:manifest.id,manifest,context,view:result.view})
    publishView(context.sessionId)
    if(context.mode!=='live' || result.wakeAfterMs===null || !Number.isFinite(result.wakeAfterMs))return
    const timer=setTimeout(()=>{row.timers.delete(manifest.id);void enqueue(async()=>{
      if(!valid() || !row.active)return
      const fresh=await prepare(context.sessionId)
      if(fresh!==row || !valid())return
      row.bus.publish({modId:manifest.id,event:'mod.context.changed',context:row.context,payload:{reason:'cadence'}})
    })},Math.max(1,result.wakeAfterMs))
    timer.unref?.();row.timers.set(manifest.id,timer)
  }
  const enabled=()=>{const state=library.snapshot();return state.global.enabledModIds.some(id=>state.mods[id]?.manifest.subscriptions?.length)}
  function current(context) {
    return live && context.authorityEpoch===epoch() && library.authority(context.modId,context.cardId)===context.authority
  }
  async function sourceCurrent(context,head) {
    if(!current(context) || head?.timeline.branchId!==context.source.branchId)return false
    const value=await settled.snapshot(context.gameId,{turn:context.turn,mode:context.mode})
    return value.turn===context.turn && equal(value.source,context.source)
  }
  async function deliver(row,manifest,event) {
    const activityVersion=row.activityVersion,value=row.snapshot,card=row.card,mod=library.snapshot().mods[manifest.id]
    const context={modId:manifest.id,modRevision:mod.releaseRevision,cardId:card.meta.id,gameId:value.head.sessionId,turn:value.turn,
      source:value.source,mode:event.context.mode,authorityEpoch:event.context.authorityEpoch,authority:library.authority(manifest.id,card.meta.id),sessionEvent:true}
    const owner=JSON.stringify([context.gameId,manifest.id,context.authorityEpoch])
    const cleanup=event.event==='session.disposed'
    const valid=()=>cleanup || activityVersion===row.activityVersion && !row.closed && row.admitted.has(manifest.id) && current(context) && row.context.branchId===event.context.branchId && row.context.sourceKey===event.context.sourceKey && row.context.generation===event.context.generation && row.context.mode===event.context.mode && row.context.textVersion===event.context.textVersion
    if(config && manifest.variableSlots?.length && value.turn && !cleanup) {
      const turn=await variables().readTurn(context,value.turn)
      context.variableBindings=await config.bindings(manifest,card,value.head,turn.sources)
    }
    const catalogue=row.catalogues?.[manifest.id]
    const settings=library.getMod({modId:manifest.id,cardId:card.meta.id}).settings.values
    const models=await modelStatus?.(manifest,context.gameId) || {}
    const anchor={sourceKey:event.context.sourceKey,part:'body',paragraph:1,charOffset:0,...row.display?.anchor}
    context.anchor=anchor
    const payload={...event.payload,active:row.active,anchor,activeTimeMs:clock(row),host:{
      entries:catalogue?.packs.flatMap(pack=>pack.entries) || [],settings,models}}
    const adapter=builtins.presentation?.(manifest.id)
    let transport
    const runtime=createModRuntime({builtins,current:valid,resolveBuiltin:()=>mod.origin?.builtinId || manifest.id,
      createHost(_context,callCurrent) {
        const host=createModVariables({...variables(),manifest,context,current:callCurrent}),token=randomUUID()
        transport=createModMessageTransport({context:event.context,token,current:()=>!cleanup && callCurrent(),methods:{
          'host.models.request':async args=>{
            check(modelTasks,'$.models','Model service unavailable','MOD_RESOURCE_UNAVAILABLE')
            check(row.active && context.mode==='live','$.activity','Model requests need an active live stage','MOD_SOURCE_STALE')
            return modelTasks.request({manifest,owner,sessionId:context.gameId,
              current:()=>valid() && row.active && context.mode==='live' && connected(context.gameId),
              window:()=>settled.window(context,{}),
              prompts:async slotId=>manifest.prompts.filter(prompt=>prompt.target==='model' && prompt.modelSlot===slotId)
                .sort((a,b)=>a.placement.order-b.placement.order || a.id.localeCompare(b.id)).map(prompt=>({key:'mod.'+manifest.id+'.'+prompt.id,text:builtins.file(mod.origin?.builtinId || manifest.id,prompt.path).toString('utf8')})),
              deliver:payload=>row.bus.publish({event:'model.completed',modId:manifest.id,context:event.context,payload})},args)
          },
          'host.models.cancel':args=>{shape(args,['operationId']);return modelTasks?.cancel(owner,args) || {cancelled:false}},
          ...(adapter && presentation?{
            'host.presentation.read':args=>presentation.read(context,adapter,args),
            'host.presentation.append':args=>{
              check(row.active && context.mode==='live','$.activity','Presentation needs an active live stage','MOD_SOURCE_STALE')
              return presentation.append(context,adapter,args,()=>valid() && row.active && connected(context.gameId))
            },
          }:{}),
          'host.source.window':async args=>{
            check(manifest.permissions.source?.includes('dialogue'),'$.source','Source permission required','MOD_PERMISSION_DENIED')
            return {context:event.context,...await settled.window(context,args)}
          },
          'host.variables.getTurn':args=>unwrap(host.getTurn(args)),
          'host.variables.patch':args=>unwrap(host.patch(args)),
          'host.variables.setVariables':args=>unwrap(host.setVariables(args)),
        }})
        return {request:input=>{shape(input,['requestId','method','args']);return transport.dispatch({channel:'dsh-mod',version:2,token,...input})}}
      }})
    try {
      const result=await runtime.invoke(event.context,'event',{...event,payload})
      if(result.ok && !cleanup)accept(row,manifest,event.context,result.value,valid)
      if(!result.ok && result.error.code!=='MOD_SOURCE_STALE')onError(result.error)
    } finally {transport?.revoke();runtime.dispose()}
  }
  async function prepare(sessionId,display) {
    display ||= sessions.get(sessionId)?.display
    const value=await settled.snapshot(sessionId,display),card=await readCard(value.head.cardPath)
    if(!live || !card)return null
    const manifests=library.active(card.meta.id).filter(manifest=>manifest.subscriptions?.length)
    const views=await catalogues?.(value,manifests)
    const admitted=new Set(manifests.filter(manifest=>modTurnActive(manifest,views?.[manifest.id] || modCatalogue(manifest,library.getMod({modId:manifest.id,cardId:card.meta.id}).packs,library.listModPacks({modId:manifest.id,cardId:card.meta.id}).packs,value.units.map(row=>row.text).join('\n')))).map(row=>row.id))
    if(!manifests.length)return null
    let row=sessions.get(sessionId)
    if(!row || row.closed || row.epoch!==epoch()) {
      row?.bus.dispose(row.context)
      row={bus:createModEventBus({onError,nextSequence:()=>++sequence}),epoch:epoch(),observed:null,active:false,activityVersion:0,elapsed:0,started:Date.now(),timers:new Map(),views:new Map()};sessions.set(sessionId,row)
      for(const manifest of manifests)row.bus.subscribe({modId:manifest.id,subscriptions:[...manifest.subscriptions,...(manifest.modelSlots?.length?[{event:'model.completed',delivery:'active'}]:[])],
        current:dto=>live && !row.closed && row.admitted.has(manifest.id) && row.epoch===epoch() && !!library.authority(manifest.id,card.meta.id) && row.context.branchId===dto.branchId && row.context.sourceKey===dto.sourceKey && row.context.generation===dto.generation && row.context.mode===dto.mode,
        deliver:event=>deliver(row,manifest,event)})
    }
    if(row.context && (row.context.sourceKey!==value.source.sourceKey || row.context.mode!==(display?.mode || 'live') || [...row.admitted].some(id=>!admitted.has(id))))clearViews(row)
    if(row.admitted)for(const id of row.admitted)if(!admitted.has(id))row.bus.publish({modId:id,event:'session.disposed',context:row.context})
    row.catalogues=views
    row.display={...row.display,...display}
    row.admitted=admitted
    row.snapshot={...value,mode:display?.mode || 'live'};row.card=card;row.context=publicContext(row.snapshot,row.epoch)
    modelTasks?.invalidate()
    return row
  }
  let queue=Promise.resolve()
  const enqueue=fn=>{queue=queue.then(()=>live && fn()).catch(onError);return queue}
  return Object.freeze({sourceCurrent,
    views(sessionId){return {views:[...(sessions.get(sessionId)?.views.values() || [])]}},
    refresh() {
      for(const row of sessions.values()){row.activityVersion++;clearViews(row)}
      modelTasks?.invalidate()
      void enqueue(async()=>{for(const id of sessions.keys()){
        const row=await prepare(id)
        if(row)row.bus.activity(row.active,row.context,{},'assets')
      }})
    },
    observe(head) {
      if(!enabled())return
      const prior=sessions.get(head.sessionId)
      if(prior) {
        const turn=prior.context.mode==='history'?prior.snapshot.turn:latestSettledModTurn(head)
        const index=head.messages.findLastIndex(row=>row.role==='assistant' && Number(row.turn || (row.greeting?1:0))===turn)
        const replaced=prior.context.branchId!==head.timeline?.branchId || turn!==prior.snapshot.turn ||
          index>=0 && typeof head.messages[index].text==='string' && captureStageTarget(head,index).sourceKey!==prior.context.sourceKey
        if(replaced){prior.activityVersion++;clearViews(prior);modelTasks?.invalidate()}
      }
      // Capture only committed operation facts. No raw Chat is queued or sent to a mod.
      const fact={sessionId:head.sessionId,branchId:head.timeline?.branchId,revision:head._storageRevision,
        operations:Object.values(head.timeline?.operations || {}).filter(op=>op.kind==='body').map(op=>({id:op.id,status:op.status,turn:op.turn,userText:op.userText || ''}))}
      void enqueue(async()=>{
        const priorContext=sessions.get(fact.sessionId)?.context
        const row=await prepare(fact.sessionId)
        if(!row)return
        const previous=row.observed;row.observed=fact
        const publish=(event,op,payload)=>row.bus.publish({eventId:op.id+':'+event+':'+op.status,event,context:row.context,payload})
        if(priorContext && ['branchId','sourceKey','generation'].some(key=>priorContext[key]!==row.context[key]))
          row.bus.publish({eventId:'timeline:'+fact.revision,event:'timeline.changed',context:row.context,payload:{revision:String(fact.revision)}})
        for(const op of fact.operations) {
          const old=previous?.operations.find(item=>item.id===op.id)
          if(old?.status===op.status)continue
          if(op.status==='running' && !old) {
            publish('player.input',op,{operationId:op.id,turn:op.turn,text:op.userText})
            publish('generation.started',op,{operationId:op.id,turn:op.turn})
          } else if(old && ['completed','failed','cancelled'].includes(op.status)) {
            publish('generation.ended',op,{operationId:op.id,turn:op.turn,status:op.status})
            if(op.status==='completed')publish('round.committed',op,{operationId:op.id,turn:op.turn})
          }
        }
      })
    },
    settlement(sessionId,payload) {
      if(!enabled())return
      void enqueue(async()=>{const row=await prepare(sessionId);if(row)row.bus.publish({eventId:'settlement:'+payload.revision,event:'settlement.completed',context:row.context,payload})})
    },
    presentation(sessionId,input) {
      if(!enabled())return {accepted:true}
      shape(input,['event','active','mode','turn','anchor','performanceId','phase','revealed'],['event','active','mode','turn'])
      check(['stage.entered','stage.left','page.changed','text.revealed','performance.presented','activity.changed','session.disposed'].includes(input.event),'$.event')
      if(input.anchor!==undefined) {shape(input.anchor,['paragraph','charOffset']);check(Number.isSafeInteger(input.anchor.paragraph) && input.anchor.paragraph>=1 && Number.isSafeInteger(input.anchor.charOffset) && input.anchor.charOffset>=0,'$.anchor')}
      if(input.revealed!==undefined) {
        shape(input.revealed,['id','text'])
        check(input.event==='text.revealed' && typeof input.revealed.id==='string' && input.revealed.id.length<=1024 && typeof input.revealed.text==='string' && input.revealed.text.length<=8000,'$.revealed')
      }
      for(const key of ['performanceId','phase'])if(input[key]!==undefined)check(typeof input[key]==='string' && input[key].length<=512,'$.'+key)
      check(typeof input.active==='boolean' && ['live','history'].includes(input.mode) && Number.isSafeInteger(input.turn) && input.turn>=0,'$.context')
      void enqueue(async()=>{
        const row=await prepare(sessionId,input)
        if(!row)return
        if(input.revealed && !row.snapshot.units.some(unit=>unit.turn===row.snapshot.turn && unit.text.includes(input.revealed.text)))return
        if(input.event==='activity.changed' || row.active!==input.active) {
          row.elapsed=clock(row);row.started=Date.now();row.active=input.active && connected(sessionId);row.activityVersion++;
          if(!row.active)clearViews(row);row.bus.activity(row.active,row.context,{units:row.snapshot.units,inputs:row.snapshot.inputs},'presentation');modelTasks?.invalidate()
        }
        if(input.event==='session.disposed'){
          row.closed=true;clearViews(row);row.bus.dispose(row.context)
          void row.bus.idle().then(()=>{if(sessions.get(sessionId)===row)sessions.delete(sessionId)})
          return
        }
        if(input.event!=='activity.changed')row.bus.publish({eventId:randomUUID(),event:input.event,context:row.context,payload:input})
      })
      return {accepted:true}
    },
    disconnected(ids) {
      for(const id of ids) {
        const row=sessions.get(id)
        if(!row || connected(id))continue
        row.elapsed=clock(row);row.active=false;row.activityVersion++;clearViews(row)
        row.bus.activity(false,row.context,{},'transport');modelTasks?.invalidate()
      }
    },
    async idle(){await queue;await Promise.all([...sessions.values()].map(row=>row.bus.idle()))},
    dispose(){live=false;for(const row of sessions.values()){clearViews(row);row.bus.dispose(row.context)}sessions.clear();modelTasks?.invalidate()},
  })
}
