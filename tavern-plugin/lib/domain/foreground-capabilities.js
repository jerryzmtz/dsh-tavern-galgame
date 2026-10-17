import {bubbleInjection} from './dialogue-bubbles.js'
import {judgeEnabled} from './engine-judge.js'
import {recallFigures} from './figure-recall.js'
import {figureJudgeId,selectJudgeRecall} from './stage-judge-recall.js'
import {sessionEvents} from './session-events.js'
import {estimateDirectorTokens} from './stage-director-tokens.js'

const managed = entry => !!entry.rawEntry?.extensions?.dsh_tavern_helper_extra?.forkDialogueBubbles || entry.foregroundCapability === true
const replace = (book, entries) => ({...book,view:{...book?.view,entries:[...(book?.view?.entries || []).filter(entry=>!managed(entry)),...structuredClone(entries)]}})

// Only a completed native replacement before this turn can change its prefix.
export function foregroundCapabilityEpoch(session) {
  const events=sessionEvents(session),start=events.findLastIndex(event=>event.type==='turn/start')
  const prior=start<0?events:events.slice(0,start)
  const completed=new Set(prior.filter(event=>event.type==='compaction/end' && !event.data?.error).map(event=>event.data.compactionId))
  const replaced=new Set(prior.filter(event=>event.type==='user/message' && event.surfaceOp?.op==='replace').map(event=>event.data?.source?.compactionId))
  return prior.findLast(event=>event.type==='compaction/summary' && completed.has(event.data.compactionId) && replaced.has(event.data.compactionId))?.data.compactionId || ''
}

export function foregroundCapabilityEntries(config,chat,{userText='',judge}={}) {
  const message=(chat.messages || []).findLast(row=>row.role==='assistant')
  const probabilities=message?.stageDirectionAssetPacks?.stats?.judge?.probabilities
  const rows=config.characters.map(character=>({...character,actorKey:character.alias,enabled:true}))
  const judgeRecall=probabilities && judgeEnabled(judge) ? selectJudgeRecall(rows.map(row=>({id:figureJudgeId(row.ref),kind:'figures'})),new Map(probabilities),judge) : undefined
  const selected=recallFigures({rows,units:[message?.sourceText ?? message?.text ?? chat.openingText ?? '',userText],judgeRecall}).rows
  const aliases=new Set(selected.map(row=>row.actorKey))
  const current={...config,characters:config.characters.filter(row=>aliases.has(row.alias)),enabled:config.enabled && selected.length>0}
  return bubbleInjection(current,{userName:chat.macroState?.userName,speakerRows:config.characters}).map(part=>({
    ref:'foreground-capabilities:'+part.key+(part.figure?':'+part.figure:''),enabled:true,constant:true,
    primaryKeys:[],secondaryKeys:[],position:0,...config.injection?.placement,
    // Worldbook prompt order is ascending; define the grammar before its variant roster.
    order:Number(config.injection?.placement?.order ?? 100)+(part.key==='figure'?1:0),
    comment:part.name || 'Dialogue format',content:part.text,foregroundCapability:true,
    capabilityPart:{key:part.key,...(part.figure?{figure:part.figure,name:part.name,packs:part.packs}:{}),...(part.voice?{voice:part.voice}:{})},
  }))
}

export function foregroundCapabilityInjection(snapshot) {
  return snapshot.entries.map(entry=>({...entry.capabilityPart,text:entry.content,tokens:estimateDirectorTokens(entry.content)}))
}

// Persist only capability text; ordinary worldbooks and background requests stay live.
export function createForegroundCapabilities({session,readConfig,render,save,judge=()=>undefined}) {
  const pending=new Map(),accepted=new Map()
  async function capture(chat,epoch,userText) {
    const config=await readConfig(chat.cardPath)
    const entries=foregroundCapabilityEntries(config,chat,{userText,judge:judge()})
    // Author macros/templates resolve once, not again when a later turn consumes the snapshot.
    const rendered=await render(chat,replace(null,entries.map(({foregroundCapability,...entry})=>entry)))
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    return {version:1,sessionId:chat.sessionId,epoch,entries:entries.flatMap(entry=>{
      const output=rendered.renderedEntries.find(row=>row.ref===entry.ref)
      return output?[{...entry,content:output.text}]:[]
    })}
  }
  async function preview(chat,{userText=''}={}) {
    if(!chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return []
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    const key=JSON.stringify([chat.id,chat.sessionId,epoch])
    const snapshot=old?.sessionId===chat.sessionId && old.epoch===epoch ? old :
      accepted.get(key) || (pending.has(key) ? await pending.get(key) : await capture(chat,epoch,userText))
    // Preview never accepts/persists a new epoch. Frozen entries render in the actual body order.
    const rendered=await render(chat,replace(null,snapshot.entries))
    if(rendered.diagnostics?.length)throw new Error('Foreground capability template projection failed')
    const entries=new Map(snapshot.entries.map(entry=>[entry.ref,entry]))
    return rendered.renderedEntries.filter(row=>entries.has(row.ref)).map(row=>({
      ...entries.get(row.ref).capabilityPart,text:row.text,tokens:estimateDirectorTokens(row.text),
    }))
  }
  async function project(chat,book,{persist=true,userText=''}={}) {
    if(!chat.sessionId || !['story','script'].includes(chat.mode || 'story'))return book
    const native=session(chat.sessionId),old=chat.foregroundCapabilities
    const epoch=native ? foregroundCapabilityEpoch(native) : old?.epoch || ''
    if(old?.sessionId===chat.sessionId && old.epoch===epoch)return replace(book,old.entries)
    const key=JSON.stringify([chat.id,chat.sessionId,epoch])
    if(accepted.has(key)) {chat.foregroundCapabilities=structuredClone(accepted.get(key));return replace(book,accepted.get(key).entries)}
    if(!pending.has(key))pending.set(key,(async()=>{
      const snapshot=await capture(chat,epoch,userText)
      if(persist)await save(chat,snapshot)
      accepted.set(key,snapshot)
      while(accepted.size>128)accepted.delete(accepted.keys().next().value)
      return snapshot
    })())
    try {
      chat.foregroundCapabilities=structuredClone(await pending.get(key))
      return replace(book,chat.foregroundCapabilities.entries)
    } finally {pending.delete(key)}
  }
  async function refresh(chat, expectedInjection) {
    const before=structuredClone(chat.foregroundCapabilities)
    if(!before || JSON.stringify(await preview(chat))!==JSON.stringify(expectedInjection))
      throw Object.assign(new Error('Foreground prompt changed; read it again before refreshing'),{code:'REVISION_CONFLICT'})
    const native=session(chat.sessionId),epoch=native ? foregroundCapabilityEpoch(native) : before.epoch
    const snapshot=await capture(chat,epoch,'')
    if(JSON.stringify(snapshot)===JSON.stringify(before))return preview(chat)
    // Explicit author correction only: ordinary turns still retain their frozen prefix.
    await save(chat,snapshot,{expected:before})
    chat.foregroundCapabilities=structuredClone(snapshot)
    accepted.set(JSON.stringify([chat.id,chat.sessionId,epoch]),snapshot)
    return preview(chat)
  }
  return {project,preview,refresh}
}
