// Stable display identities, admitted through a request-local table. Records remain canonical.
import {createHash} from 'node:crypto'
import {assetRefKey} from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {check} from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import {codepointCompare} from './asset-pack-lexical.js'
import {parseModDsl} from './mods/dsl.js'
import {assertModCommandAdmission} from './mods/commands.js'
import {frozenDirectorTool} from './stage-director-schema.js'
import figureResolution from '../../packages/dsh-presentation-protocol/src/figure-resolution.cjs'

const prefixes = {backgrounds:'bg',music:'m',sfx:'sfx',ambience:'amb',looks:'l',widgets:'w',performances:'p',cg:'cg'}
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const handleStem = name => figureResolution.promptHandleStem(name, '-', 12)
const handleOf = (name,identity,fallback) => (handleStem(name || fallback) || fallback) + '~' + BigInt('0x'+createHash('sha256').update(identity).digest('hex').slice(0,10)).toString(36)
// Decode display stems with the same normalizer as creation; the identity suffix stays exact.
const normalizeHandle = value => {
  if (typeof value !== 'string' || !value.includes('~')) return value
  const at = value.lastIndexOf('~')
  return handleStem(value.slice(0,at)) + value.slice(at)
}
const put = (forward,reverse,id,handle,value=id) => {
  check(!reverse.has(handle),'$.handles','Display handle collision; rename one item.','HANDLE_COLLISION')
  forward.set(id,handle);reverse.set(handle,value)
}
const tables = new WeakMap()
export function createDirectorHandles(context) {
  if (tables.has(context)) return tables.get(context)
  const actors = new Map(), actorIds = new Map(), refs = new Map(), refIds = new Map(), outfits = new Map()
  const actorKeys = [...new Set([...Object.keys(context.actors),...(context.phone?.aliases || [])])].sort(codepointCompare)
  actorKeys.forEach(id => {
    const row=context.figureRows?.find(row => row.actorKey === id) || context.phone?.characters.find(row => row.alias === id)
    put(actors,actorIds,id,handleOf(row?.aliases?.[0] || row?.name || context.actors[id]?.name,id,'actor'))
  })
  for (const [kind,prefix] of Object.entries(prefixes)) {
    const rows = [...context.catalogue.candidates[kind] || []].sort((a,b) => codepointCompare(assetRefKey(a.ref),assetRefKey(b.ref)))
    rows.forEach(row => {const id=assetRefKey(row.ref);put(refs,refIds,id,handleOf(row.asset.name,id,prefix),row.ref)})
  }
  for (const [id,actor] of Object.entries(context.actors)) {
    const keys=[...new Set(actor.outfits.map(row => row.key))].sort(codepointCompare)
    outfits.set(id,new Map(keys.map(key => [key,/^[a-z][a-z0-9_-]{0,20}$/.test(key) ? key : handleOf(key,key,'outfit')])))
  }
  const actor = id => id === null ? null : actors.get(id)
  const ref = value => value === null ? null : refs.get(assetRefKey(value))
  const outfit = (id,key) => outfits.get(id)?.get(key)
  const requireHandle = (valid,path,message,choices,code='REF_UNAVAILABLE') => {
    if (!valid) throw Object.assign(new Error(message),{path,code,handleChoices:choices})
  }
  const readActor = (handle,path) => {handle=normalizeHandle(handle);requireHandle(actorIds.has(handle),path,'Copy a listed actor handle exactly, including punctuation and suffix.',[...actorIds.keys()],'ARG_INVALID');return actorIds.get(handle)}
  const readRef = (handle,kind,path) => {handle=normalizeHandle(handle);requireHandle(refIds.has(handle) && refIds.get(handle).kind === kind,path,'Copy a listed '+kind+' handle exactly, including punctuation and suffix.',[...refIds].filter(([,ref]) => ref.kind === kind).map(([handle]) => handle));return structuredClone(refIds.get(handle))}
  const definitions = [...directorCommands.definitions,...directorCommands.selected(context).filter(def => !directorCommands.byName[def.name])]
  function definition(op) {return definitions.find(item => item.name === op?.op && (!item.ref || ref(item.ref) === normalizeHandle(op.ref) || assetRefKey(item.ref) === (object(op.ref) ? assetRefKey(op.ref) : '')))}
  const actorBindings = def => def?.command?.admission?.source === 'phone.message' ? {contact:'actor'} : def?.command?.bindings || {}
  function operation(value,decode = false) {
    if (decode && typeof value === 'string') {
      // Active aliases take precedence; installed syntax only identifies unavailable calls for repair.
      value=parseModDsl(value,[...context.modCommands || [],...context.schemaModCommands || []],{validate:false})
    }
    if (!object(value)) return value
    if (decode)assertModCommandAdmission(value,context)
    const op=structuredClone(value), def=definition(op), id=decode ? actorIds.get(normalizeHandle(op.actor)) : op.actor
    const installed=context.schemaModCommands?.find(command => command.op === op.op)
    if (decode && (installed || typeof op.op === 'string' && op.op.startsWith('mod.'))) {
      requireHandle(context.modCommands?.some(command => command.op === op.op),'$.op',op.op+': mod '+(installed?.modId || '(unknown)')+' is not selected or available this turn. Use only allowedCommands.',[],'DISABLED')
    }
    const mapActor=(v,path) => decode ? readActor(v,path) : actor(v)
    for (const field of ['actor','after']) if (Object.hasOwn(op,field)) op[field]=mapActor(op[field],'$.'+field)
    if (op.op === 'cast.set' && Array.isArray(op.actors)) op.actors=op.actors.map((id,i) => mapActor(id,'$.actors['+i+']'))
    if (op.op === 'actor.gaze.set' && object(op.target) && Object.hasOwn(op.target,'actor')) op.target.actor=mapActor(op.target.actor,'$.target.actor')
    if (Object.hasOwn(op,'outfit') && op.op === 'actor.outfit.set') {
      if (decode) {const found=[...outfits.get(id) || []].find(([,handle]) => handle === normalizeHandle(op.outfit));requireHandle(found,'$.outfit','Copy a listed outfit handle for this actor exactly.',[...outfits.get(id)?.values() || []]);op.outfit=found[0]}
      else op.outfit=outfit(id,op.outfit)
    }
    for (const [field,kind] of Object.entries(def?.refs || {})) if (Object.hasOwn(op,field)) {
      const map=(value,path) => decode ? readRef(value,kind,path) : ref(value)
      op[field]=Array.isArray(op[field]) ? op[field].map((value,i)=>map(value,'$.'+field+'['+i+']')) : map(op[field],'$.'+field)
    }
    for (const field of Object.keys(actorBindings(def))) if (Object.hasOwn(op,field)) op[field]=mapActor(op[field],'$.'+field)
    return op
  }
  const tool = canonical => frozenDirectorTool(canonical,context)
  function carried(state) {
    const next=structuredClone(state)
    const retained = value => ref(value) ?? '(kept; no current choice)'
    if (next.actors) next.actors=Object.fromEntries(Object.entries(next.actors).map(([id,value]) => [actor(id),{
      ...(context.dimensions.outfit ? {outfit:outfit(id,value.outfitKey)} : {}),
      ...(context.dimensions.gaze ? {gaze:['viewer','away'].includes(value.gaze) ? value.gaze : {actor:actor(value.gaze)}} : {}),
      ...(context.dimensions.actorLight ? {light:value.figureLight} : {})
    }]))
    if (next.cast) next.cast=next.cast.map(actor)
    if (next.scene) next.scene={background:retained(next.scene.background),time:next.scene.timeOfDay,...(next.scene.variant ? {variant:next.scene.variant} : {})}
    if (next.music) next.music=retained(next.music)
    if (next.soundscape) next.soundscape=Object.values(next.soundscape).map(retained)
    if (next.lighting) next.lighting={...(context.dimensions['lighting.mood'] ? {mood:next.lighting.mood ? retained(next.lighting.mood) : null} : {})}
    if (next.camera?.actor) next.camera.actor=actor(next.camera.actor)
    if (next.dof) next.dof=actor(next.dof)
    if (next.cg) {next.cg.ref=retained(next.cg.ref);if(next.cg.resumeCast)next.cg.resumeCast=next.cg.resumeCast.map(actor)}
    if (next.performance) next.performance.ref=retained(next.performance.ref)
    if (next.widgets) next.widgets=Object.fromEntries(Object.values(next.widgets).map(widget => {
      const row=context.catalogue.candidates.widgets.find(row => assetRefKey(row.ref) === assetRefKey(widget.ref))
      const state=structuredClone(widget.state)
      for (const field of new Set((row?.widget.commands || []).flatMap(command => Object.keys(command.bindings || {})))) if (Object.hasOwn(state,field)) state[field]=actor(state[field])
      return [ref(widget.ref),{state,...(widget.lifetime?.durationSeconds !== undefined ? {remainingSeconds:Math.max(0,widget.bornStoryTime+widget.lifetime.durationSeconds-next.widgetTime)} : {})}]
    }))
    return next
  }
  function catalogue(row) {return {...row,ref:ref(row.ref)}}
  // Feedback is a transport DTO, not story prose. Convert exact identity values and schema choices only.
  function feedback(value) {
    if (typeof value === 'string') return actors.get(value) || refs.get(value) || [...outfits.values()].map(map => map.get(value)).find(Boolean) || value
    if (Array.isArray(value)) return value.map(feedback)
    if (!object(value)) return value
    // Rejected input may look like a reference without being valid; feedback must not re-admit it.
    if (value.packId && value.kind && value.assetId) return refs.get(`${value.packId}/${value.kind}/${value.assetId}`) ?? '(unavailable)'
    if (value.properties?.packId && value.properties?.assetId) return {enum:[...refIds.keys()]}
    return Object.fromEntries(Object.entries(value).map(([key,item]) => [key,feedback(item)]))
  }
  const table = {actor,ref,outfit,operation,tool,carried,catalogue,feedback,actors:actorKeys.map(id => ({id:actor(id),name:context.actors[id]?.name || context.figureRows?.find(row => row.actorKey === id)?.name || context.phone?.characters.find(row => row.alias === id)?.name || actor(id)}))}
  // Production preparation is deeply frozen. Reuse its table for prompt, entry and correction feedback.
  if (Object.isFrozen(context)) tables.set(context,table)
  return table
}
