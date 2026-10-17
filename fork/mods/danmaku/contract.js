import {viewerNickname} from './nicknames.js'
import {SC_AMOUNTS} from './audience.js'
export {SC_AMOUNTS} from './audience.js'

export const MOD_ID = 'dsh.danmaku'
export const CADENCE = Object.freeze({minIntervalMs:3000,maxPerMinute:20,maxInFlight:1})
export const sourceOf = context => Object.fromEntries(['sessionId','branchId','sourceKey','generation','textVersion'].map(key => [key,context[key]]))
export const sourceKey = source => JSON.stringify(['sessionId','branchId','sourceKey','generation','textVersion'].map(key => source[key]))
export const anchorKey = anchor => JSON.stringify([anchor.sourceKey,anchor.part,anchor.paragraph,anchor.charOffset])
export const refKey = ref => JSON.stringify([ref.packId,ref.kind,ref.assetId])
export const shortText = (text,max) => [...text].slice(0,max).join('')
export const defaultModel = () => ({selection:'follow-foreground',provider:null,model:null,label:'Follow foreground',available:false})
const invalid = message => { throw Object.assign(new Error(message),{code:'MOD_RESOURCE_UNAVAILABLE'}) }

export function commentAmount(kind,amount,random=Math.random) {
  if (kind !== 'highlight') return null
  if (amount != null) {
    if (!SC_AMOUNTS.includes(amount)) invalid('SC amount must be an integer CNY tier: 30, 50, 100, 500, 1000 or 2000; correct amount and resubmit')
    return amount
  }
  const draw=random()
  return SC_AMOUNTS[[0.6,0.8,0.92,0.97,0.99,1].findIndex(limit=>draw<limit)]
}

// Model output is untrusted. Persist only the small, typed display projection.
export function parseComments(output, groups, recent, {id,offsetMs,density,random=Math.random,chatId=''}) {
  const value = typeof output === 'string' ? JSON.parse(output) : output
  if (!Array.isArray(value?.comments) || value.comments.length > 6) invalid('Expected a batch of at most six comments')
  const admitted = new Map(groups.map(group => [refKey(group.ref),group]))
  const seen = new Set(recent.map(row => row.text))
  let highlighted = false
  const comments = []
  for (const row of value.comments) {
    const group = row?.group && admitted.get(refKey(row.group))
    if (!group || typeof row.text !== 'string' || !row.text.trim() || [...row.text].length > 160 ||
        !['comment','highlight'].includes(row.kind)) invalid('Use a recalled group, short text and comment/highlight kind')
    if (row.mode !== undefined && !['scroll','top','bottom'].includes(row.mode) ||
        row.color !== undefined && row.color !== null && !/^#[0-9a-f]{6}$/i.test(row.color) ||
        row.size !== undefined && !['small','standard','large'].includes(row.size)) invalid('Invalid comment display hint')
    if (seen.has(row.text)) continue
    seen.add(row.text)
    const kind = row.kind === 'highlight' && !highlighted ? 'highlight' : 'comment'
    highlighted ||= kind === 'highlight'
    comments.push({id:id+':'+comments.length,group:structuredClone(group.ref),author:viewerNickname(chatId,id+':'+comments.length,group),text:row.text,kind,
      amount:commentAmount(kind,row.amount,random),source:'model',depth:0,ruleId:null,replyTo:null,revealId:null,
      mode:row.mode || 'scroll',color:row.color || null,size:row.size || 'standard',
      offsetMs:offsetMs+comments.length*(density === 'low' ? 2200 : 1200),durationMs:kind === 'highlight' ? 9000 : 6500})
  }
  return comments
}

export function parseMemory(output) {
  const value = typeof output === 'string' ? JSON.parse(output) : output
  if (typeof value?.memory !== 'string') invalid('Expected a short audience memory')
  return shortText(value.memory.trim(),300)
}

export function projectView({context,anchor,records=[],activeTimeMs=0,heat=0,online=0,active=false,silent=true,
  waiting=false,error=null,settings={},model=defaultModel(),viewport={width:0,height:0},safeRegions=[]}) {
  const view = ['sidebar','off'].includes(settings.view) ? settings.view : 'overlay'
  if(view==='off')active=false
  const batches = silent || view==='off' || !anchor ? [] : records.filter(row => row.record.type === 'batch' &&
    sourceKey(row.record.batch.source) === sourceKey(sourceOf(context)) && anchorKey(row.anchor) === anchorKey(anchor))
    .map(row => row.record.batch).filter(batch => batch.offsetMs <= activeTimeMs).slice(-20)
  const items = batches.flatMap(batch => batch.comments).filter(row => row.offsetMs <= activeTimeMs)
    .sort((a,b) => a.offsetMs-b.offsetMs || a.id.localeCompare(b.id)).slice(-32)
  const last = batches.at(-1)
  if (!last) {heat=0;online=0}
  if (context.mode === 'history') {
    const remaining=last ? last.heatExpiresAtMs-last.offsetMs : 0
    heat=remaining>0 ? Math.round(last.heat*Math.max(0,(last.heatExpiresAtMs-activeTimeMs)/remaining)) : 0
    online=last ? Math.max(12,Math.round(last.online-(last.heat-heat)*2.4)) : 0
  }
  return {version:1,modId:MOD_ID,mode:context.mode,active,silent,view,anchor,activeTimeMs,batches,
    highlights:items.filter(row => row.kind === 'highlight'),
    heat:silent?0:heat,online:silent?0:online,viewport,safeRegions,
    sidebar:{title:'模拟观众',items,limit:32},
    settings:{view,density:settings.density === 'low' ? 'low' : 'standard',
      area:settings.area ?? 'three-quarter',opacity:settings.opacity ?? 90,fontScale:settings.fontScale ?? 100,reducedMotion:!!settings.reducedMotion,
      model,cadence:{...CADENCE},modelSettingsTarget:{modId:MOD_ID,slotId:'audience'}},
    status:silent?'silent':context.mode === 'history'?'history':!active?'paused':error?'error':waiting?'waiting':'ready',error}
}
