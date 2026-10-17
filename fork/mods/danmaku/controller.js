import {randomUUID} from 'node:crypto'
import {compactAudienceInput} from './input.js'
import {createAudiencePresets,paceComments,presetExamples} from './presets.js'
import {CADENCE,sourceOf,sourceKey,anchorKey,parseComments,parseMemory,projectView,defaultModel} from './contract.js'

const coolingMs = 30000
const stimulus = new Map([['page.changed',80],['performance.presented',100],['player.input',90]])

// Host calls exist only during handle(); timers must re-enter through a fresh event lease.
export function createDanmakuController({now=Date.now,id=randomUUID,random=Math.random}={}) {
  const presets=createAudiencePresets({now,id,random,chatId:()=>context?.sessionId ?? ''})
  let context,anchor=null,groups=[],settings={},model=defaultModel(),active=false,disposed=false
  let clock=0,heatPeak=0,heatAt=0,revision='0',records=[],memory='',hydrated=false
  let pending=null,memoryDue=null,memoryDone=false,waiting=false,error=null,lastBatchEnd=0,generating=false
  let starts=[],lastStart=-Infinity,lastInput=null,presented=[],viewport={width:0,height:0},safeRegions=[]
  const seen=new Set()
  const heat=()=>Math.round(heatPeak*Math.max(0,1-(clock-heatAt)/coolingMs))
  const online=()=>groups.length ? Math.round(12+heat()*2.4) : 0
  const displayEnabled=()=>active && !disposed && settings.view!=='off' && context?.mode==='live' && groups.length>0 && hydrated
  const enabled=()=>displayEnabled() && model.available
  const comments=()=>records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments)
  async function call(host,method,args) {
    const reply=await host.request({requestId:id(),method,args})
    if(!reply.result.ok)throw Object.assign(new Error(reply.result.error.message),reply.result.error)
    return reply.result.value
  }
  async function cancel(host,keepMemory=true) {
    const old=pending;pending=null
    if(old?.purpose==='memory' && keepMemory)memoryDue={source:old.source,turn:old.turn}
    if(old?.operationId)await call(host,'host.models.cancel',{operationId:old.operationId})
  }
  async function hydrate(host) {
    const saved=await call(host,'host.presentation.read',{anchor})
    revision=saved.revision;records=saved.records;hydrated=true
    presets.restore(comments())
    const memories=records.filter(row=>row.record.type==='memory')
    memory=memories.at(-1)?.record.memory || ''
    memoryDone=memories.some(row=>sourceKey(row.record.source)===sourceKey(sourceOf(context)))
    const batches=records.filter(row=>row.record.type==='batch' && anchorKey(row.anchor)===anchorKey(anchor) && sourceKey(row.record.batch.source)===sourceKey(sourceOf(context))).map(row=>row.record.batch)
    const last=batches.at(-1)
    if(last) {
      if(context.mode==='live')clock=Math.max(clock,last.offsetMs)
      // A restored batch carries its own remaining cooling duration, not a new stimulus.
      heatAt=last.heatExpiresAtMs-coolingMs
      heatPeak=last.heatExpiresAtMs>last.offsetMs ? last.heat*coolingMs/(last.heatExpiresAtMs-last.offsetMs) : 0
      lastBatchEnd=Math.max(0,...batches.flatMap(batch=>batch.comments.map(row=>row.offsetMs+1200)))
    }
  }
  async function append(host,record,operationId,at=clock) {
    const input={operationId,anchor,offsetMs:at,records:[record],expectedRevision:revision}
    const saved=await call(host,'host.presentation.append',input)
    revision=saved.revision
    records.push({id:saved.recordIds[0],operationId,anchor:structuredClone(anchor),offsetMs:at,record})
  }
  const batch=(batchId,comments=[])=>({id:batchId,source:sourceOf(context),anchor:structuredClone(anchor),offsetMs:clock,
    comments,heat:heat(),online:online(),heatExpiresAtMs:heatAt+coolingMs})
  function modelWakeAfterMs() {
    if(!enabled() || pending || error)return null
    if(!memoryDue && (!generating || !heat()))return null
    const at=now(),recent=starts.filter(time=>time>at-60000)
    const rate=Math.max(0,lastStart+CADENCE.minIntervalMs-at,recent.length>=20?recent[0]+60000-at:0)
    return Math.max(1,rate,memoryDue?0:lastBatchEnd-clock)
  }
  function wakeAfterMs() {
    if(!displayEnabled())return null
    const times=[modelWakeAfterMs(),presets.next(comments(),clock)].filter(value=>value!==null)
    return times.length?Math.min(...times):null
  }
  async function playPresets(host,revealed) {
    if(!displayEnabled())return
    const recent=comments().slice(-40)
    if(revealed)presets.trigger(revealed,groups,clock,recent)
    presets.observe(comments(),groups,clock,recent)
    const due=presets.take(groups,clock,recent)
    if(due.length) {
      const rows=paceComments(due,comments(),clock,settings.density),batchId=id()
      await append(host,{type:'batch',batch:batch(batchId,rows)},batchId)
      lastBatchEnd=Math.max(lastBatchEnd,rows.at(-1).offsetMs+(settings.density==='low'?1100:600))
      presets.observe(comments(),groups,clock,comments().slice(-40))
    }
  }
  function result() {
    const value={view:projectView({context,anchor,records,activeTimeMs:clock,heat:heat(),online:online(),
      active:active&&!disposed,silent:!groups.length,waiting,error,settings,model,viewport,safeRegions}),wakeAfterMs:wakeAfterMs()}
    return structuredClone(value)
  }
  async function request(host) {
    if(!enabled() || pending || error || !memoryDue && (!generating || !heat() || clock<lastBatchEnd))return
    const at=now();starts=starts.filter(time=>time>at-60000)
    if(at-lastStart<3000 || starts.length>=20)return
    const purpose=memoryDue?'memory':'comments',requestId=id()
    const recent=records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments).slice(-24)
    const own={requestId,purpose,source:sourceOf(context),turn:context.settledTurn,anchor:structuredClone(anchor),operationId:null}
    pending=own;starts.push(at);lastStart=at
    if(purpose==='memory')memoryDue=null
    const input={task:purpose,groups:groups.map(({ref,name,content})=>{
      const {persona,tone,catchphrases,examples}=content,samples=presetExamples(content)
      return {ref,name,persona,tone,catchphrases,examples,...(samples.length?{presetExamples:samples}:{})}
    }),memory,
      recent:recent.map(({author,text})=>({author,text})),waiting,acceptedInput:lastInput,presented,heat:heat()}
    try {
      const reply=await call(host,'host.models.request',{requestId,slotId:'audience',purpose,
        input:compactAudienceInput(input),maxOutputTokens:purpose==='memory'?480:1000})
      own.operationId=reply.operationId
    } catch(cause) {pending=null;throw cause}
  }
  async function complete(host,payload) {
    if(!pending || payload.operationId!==pending.operationId)return
    const own=pending;pending=null
    if(!enabled() || sourceKey(own.source)!==sourceKey(sourceOf(context)))return
    if(payload.status!=='completed') {
      error=payload.error || {code:'MOD_RUNTIME_FAILED',message:'Audience model request failed'}
      return
    }
    if(own.purpose==='memory') {
      const next=parseMemory(payload.output)
      await append(host,{type:'memory',source:own.source,turn:own.turn,memory:next},own.requestId)
      memory=next;memoryDone=true
    } else if(generating && heat()>0 && anchorKey(own.anchor)===anchorKey(anchor)) {
      const recent=records.filter(row=>row.record.type==='batch').flatMap(row=>row.record.batch.comments).slice(-40)
      const parsed=parseComments(payload.output,groups,recent,{id:own.requestId,offsetMs:clock,density:settings.density,random,chatId:context.sessionId})
      const rows=paceComments(parsed,comments(),clock,settings.density)
      const record=batch(own.requestId,rows)
      await append(host,{type:'batch',batch:record},own.requestId)
      lastBatchEnd=rows.length?rows.at(-1).offsetMs+(settings.density==='low'?2200:1200):clock+3000
    }
  }
  return Object.freeze({
    async handle(event,host) {
      if(seen.has(event.eventId))return context?result():null
      seen.add(event.eventId);if(seen.size>256)seen.delete(seen.values().next().value)
      const oldContext=context,previousAnchor=anchor,payload=event.payload || {}
      context=event.context
      const changed=oldContext && (sourceKey(sourceOf(oldContext))!==sourceKey(sourceOf(context)) || oldContext.authorityEpoch!==context.authorityEpoch || oldContext.mode!==context.mode)
      const nextAnchor=payload.anchor || payload.to
      if(nextAnchor)anchor={sourceKey:context.sourceKey,part:'body',...nextAnchor}
      if(changed && !nextAnchor)anchor=null
      clock=payload.activeTimeMs ?? (changed?0:clock)
      if(payload.danmaku) {
        groups=payload.danmaku.groups;settings=payload.danmaku.settings || {};model=payload.danmaku.model || defaultModel()
        error=model.available?null:{code:'MOD_RESOURCE_UNAVAILABLE',message:'Choose an available audience model in global model settings'}
      }
      if(payload.viewport)viewport=payload.viewport
      if(payload.safeRegions)safeRegions=payload.safeRegions
      if(typeof payload.active==='boolean')active=payload.active
      if(['stage.left','session.disposed'].includes(event.event))active=false
      if(event.event==='session.disposed')disposed=true
      try {
        const moved=anchor && previousAnchor && anchorKey(anchor)!==anchorKey(previousAnchor)
        if(changed || moved) {
          await cancel(host,!changed);presets.reset();hydrated=false;records=[];heatPeak=0;lastBatchEnd=0;error=null;generating=false
          if(changed){memory='';memoryDone=false;memoryDue=null;lastInput=null;presented=[];waiting=false}
        }
        if(!active || settings.view==='off' || context.mode==='history' || !groups.length) {
          await cancel(host)
          heatPeak=0;lastBatchEnd=clock;generating=false
          if(!groups.length)memoryDue=null
        }
        if(anchor && !hydrated && groups.length)await hydrate(host)
        if(!displayEnabled())presets.pause(comments())
        if(event.event==='player.input')lastInput={inputId:payload.inputId || payload.operationId,text:payload.text || payload.input || ''}
        if(event.event==='performance.presented' && active) {
          presented.push(Object.fromEntries(['performanceId','phase','text','visualType'].filter(key=>payload[key]!==undefined).map(key=>[key,payload[key]])))
          presented=presented.slice(-6)
        }
        if(event.event==='generation.started')waiting=true
        if(event.event==='generation.ended')waiting=false
        if((event.event==='generation.ended' && payload.status==='completed' || event.event==='round.committed' ||
            event.event==='mod.context.changed' && payload.reason==='snapshot' && context.mode==='live') &&
            groups.length>0 && context.settledTurn>0 && !memoryDone && pending?.purpose!=='memory')memoryDue={source:sourceOf(context),turn:context.settledTurn}
        if(event.event==='model.completed')await complete(host,payload)
        const rise=stimulus.get(event.event),heatId='heat:'+event.eventId
        if(rise && displayEnabled() && !records.some(row=>row.operationId===heatId)) {
          const previous={heatPeak,heatAt,generating}
          heatPeak=Math.max(heat(),rise);heatAt=clock;generating=true
          try {await append(host,{type:'batch',batch:batch(heatId)},heatId)}
          catch(cause){({heatPeak,heatAt,generating}=previous);throw cause}
        }
        if(event.event==='mod.context.changed' && payload.reason!=='cadence' && payload.reason!=='snapshot' && model.available)error=null
        await playPresets(host,event.event==='text.revealed'?payload.revealed:null)
        await request(host)
      } catch(cause) {
        error={code:cause.code || 'MOD_RUNTIME_FAILED',message:cause.message}
      }
      return result()
    },
  })
}
