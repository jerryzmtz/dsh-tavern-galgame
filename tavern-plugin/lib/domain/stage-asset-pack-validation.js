// private fork: a correction window is durable but unpublished until its anchors are sealed.
import { check, canonicalJson } from '../../packages/dsh-presentation-protocol/src/asset-pack-json.js'
import { validateAssetPackToolValue, reduceAssetPackOperation, deriveAssetPackFigureScale, assetPackCommandDefinition } from './stage-asset-pack-tools.js'
import { paceAssetPackOperation } from './stage-asset-pack-pacing.js'
import directorCommands from '../../packages/dsh-presentation-protocol/src/director-commands.cjs'
import {assetContent} from '../../packages/dsh-presentation-protocol/src/asset-variant-content.js'
// private fork: deep equality compares canonical JSON directly; hashing both sides first adds nothing.
const same = (a, b) => canonicalJson(a) === canonicalJson(b)

const clone = value => structuredClone(value)
// Repair hints describe only this field; nested object/array grammar is already in the tool.
export function assetPackFieldConstraint(schema, defs = {}) {
  if (!schema) return undefined
  if (schema.$ref) return assetPackFieldConstraint(defs[schema.$ref.split('/').at(-1)], defs)
  return Object.fromEntries(Object.entries(schema)
    .filter(([key]) => !['properties','items','$defs','additionalProperties'].includes(key))
    .map(([key, value]) => [key, ['oneOf','anyOf','allOf'].includes(key)
      ? value.map(item => assetPackFieldConstraint(item, defs))
      : key === 'not' ? assetPackFieldConstraint(value, defs) : value]))
}
// private fork: resolve the failing slot, not an unresolved $ref or a whole catalogue.
function slotFeedback(error, definition, context, op, state, at) {
  if (!definition) return {received:op?.op ?? op ?? null, validValues:directorCommands.selected(context).map(item => item.name)}
  if (error.path?.startsWith('$.pacing')) return {received:op}
  const defs = directorCommands.defs(context), resolve = s => s?.$ref ? defs[s.$ref.split('/').at(-1)] : s
  const parts = (error.path || '$').slice(2).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)
  let schema = definition.schema(context), received = op
  for (const part of parts) {
    schema = resolve(schema)
    schema = schema?.properties?.[part] || schema?.items
    received = received?.[part]
  }
  schema = resolve(schema)
  const values = s => {
    s = resolve(s)
    if (!s) return undefined
    if (s.enum) return s.enum
    if (Object.hasOwn(s,'const')) return [s.const]
    if (s.oneOf || s.anyOf) return (s.oneOf || s.anyOf).flatMap(item => values(item) || [])
    if (s.properties?.actor) return (values(s.properties.actor) || []).map(actor => ({actor}))
    return undefined
  }
  if (error.code === 'DISABLED' || error.code === 'CAP_EXCEEDED') return {received:received ?? op,validValues:[]}
  let validValues = values(schema)
  const field = parts[0]
  const kind = definition.refs?.[field]
  if (kind) {
    const layer = definition.lookLayer
    validValues = context.catalogue.candidates[kind].filter(row => !layer || row.asset.layer === layer).map(row => row.ref)
  }
  if (field === 'outfit') validValues = (context.outfits[op.actor] || []).map(row => row.key)
  if (field === 'level' && definition.refs.ref) {
    const row = context.catalogue.candidates[definition.refs.ref].find(row => same(row.ref, op.ref))
    validValues = row?.[op.op === 'skin.set' ? 'skinLevels' : 'performanceLevels'] || []
  }
  const performance = definition.command?.admission?.performance
  if (performance && field === 'ref') validValues = performance.choices.map(row=>row.ref)
  if (performance && field === 'level') validValues = performance.choices.find(row=>same(row.ref,op.ref))?.levels || []
  if (op.op === 'actor.gaze.set' && field === 'target') {
    const actors = Object.keys(context.actors).filter(actor => actor !== op.actor)
    validValues = parts.length > 1 ? actors : ['viewer','away',...actors.map(actor => ({actor}))]
  }
  if (field === 'after' || field === 'actor' && error.code === 'PRECONDITION') validValues = op.op === 'cast.add' && field === 'actor'
    ? Object.keys(context.actors).filter(actor => !(state?.cast || []).includes(actor)) : state?.cast || []
  if (definition.effect === 'source.mark' && field === 'contact') {
    const unit = context.phone.units[at - 1]
    validValues = unit?.kind !== 'line' ? [] : context.phone.aliases.filter(actor => op.side === 'in' ? actor === unit.alias : actor !== unit.alias)
  }
  if (op.op === 'cg.focus.set' && field === 'focus') {
    const asset=context.catalogue.candidates.cg.find(row=>state?.cg && same(row.ref,state.cg.ref))?.asset
    validValues=asset?(assetContent(asset,state.cg.variant ?? undefined).focusHints || []).map(row=>row.key):[]
  }
  if (field === 'variant' && (op.op?.startsWith('cg.') || op.op?.startsWith('scene.'))) {
    const kind=op.op.startsWith('cg.')?'cg':'backgrounds'
    const ref = op.op === 'cg.set' ? op.cg : op.op === 'scene.set' ? op.background : kind==='cg'?state?.cg?.ref:state?.scene?.background
    validValues = (context.catalogue.candidates[kind].find(row => ref && same(row.ref, ref))?.asset.variants?.entries || []).map(row => row.id)
  }
  return {received:received ?? null, ...(schema ? {expected:assetPackFieldConstraint(schema, defs)} : {}), ...(validValues ? {validValues} : {})}
}
export function assetPackDrop(error, context, slot = {}, state) {
  const command = typeof slot.op?.op === 'string' ? slot.op.op : null
  const actor = context.actors?.[slot.op?.actor]
  const field = error.path?.split('.').at(-1)
  if (actor && ['emotion','difference'].includes(field) && !actor.emotions?.some(row=>row.label !== undefined)) {
    error = Object.assign(new Error(actor.name + ' has no variants; omit ' + field + '.'), {code:'UNKNOWN_FIELD',path:error.path})
  }
  const path = command?.startsWith('lighting.') && error.path === '$.light.ref' ? '$.ref' : error.path
  if (path !== error.path) error = Object.assign(new Error(error.message),{code:error.code,path})
  // Name-only matches classify repairability; execution still requires the exact full ref.
  const definition = command ? directorCommands.resolve(slot.op,context) || directorCommands.selected(context).find(item => item.name === command) : null
  const code = error.code === 'INVALID_ASSET_PACK' || error.code === 'INVALID_JSON'
    ? /pacing|paragraphs|music.*change|mood.*turn/i.test(error.message) ? 'PACING'
      : /\b(?:caps?|budget)\b/i.test(error.message) ? 'CAP_EXCEEDED' : 'ARG_INVALID'
    : error.code || 'INTERNAL'
  const usage = definition && directorCommands.describe(context, command, slot.op.ref)[0]
  const suffix = (error.path || '$').startsWith('$.pacing') ? '' : (error.path || '$').slice(1)
  const retryable = error.itemError ? error.itemError.retryable : (Boolean(definition) || Boolean(command) || code === 'ARG_INVALID' && Object.hasOwn(slot, 'op')) && !['PACING','CAP_EXCEEDED','DISABLED','ACCEPTED_CONFLICT'].includes(code)
  return { code, path: slot.path ? slot.path + suffix : error.path || '$', command,
    capability: definition?.toggle || 'unknown', at: slot.at || null, retryable,
    hint: error.message, message: error.message, example: usage?.examples[0] || null,
    ...slotFeedback(error,definition,context,slot.op,state,slot.at),
    ...(error.next_action ? {next_action:error.next_action} : {}),
    ...(error.itemError?.candidates ? {validValues:error.itemError.candidates} : {}),
    ...(error.modError?.candidates ? {validValues:error.modError.candidates} : {}),
    ...(error.musicAt ? {validValues:[{force:true,reason:'Another scene/mood turn'},{omit:true}],next_action:`本轮第${error.musicAt}段已换曲；给此处加 force:true 和非空 reason，否则删除此处 music 操作。`} : {}),
    ...(!definition && command && directorCommands.suggestion(command) ? {didYouMean:directorCommands.suggestion(command)} : {}) }
}

// Untrusted echoes are diagnostics, not schemas: omit reserved keys and render pointers as inert text.
// Canonical operations and saved diagnostics remain unchanged.
export function assetPackToolFeedback(value) {
  if (typeof value === 'string') return value.replaceAll('#/$defs/', '[schema-definition]/')
    .replaceAll('$ref', '[schema-reference]').replaceAll('$defs', '[schema-definitions]')
  if (Array.isArray(value)) return value.map(assetPackToolFeedback)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['$ref','$defs'].includes(key))
    .map(([key, item]) => [assetPackToolFeedback(key), assetPackToolFeedback(item)]))
}

// private fork: CLI error classes are wire-only; stored diagnostics keep their domain codes.
export function assetPackToolResult(drops, accepted) {
  const errors = drops.map(drop => {
    const code = ({ARG_INVALID:'INVALID_ARGUMENT', REF_UNAVAILABLE:'NOT_FOUND', DISABLED:'UNAVAILABLE',
      PRECONDITION:'CONFLICT', PACING:'CONFLICT', MUSIC_FREQUENCY:'CONFLICT', CAP_EXCEEDED:'CONFLICT', ACCEPTED_CONFLICT:'CONFLICT',
      REVISION_CONFLICT:'CONFLICT', TASK_ENDED:'CONFLICT'})[drop.code] || drop.code
    const next_action = drop.next_action || (['REVISION_CONFLICT','CANCELLED','INTERNAL'].includes(drop.code)
      ? 'Stop this task; inspect the current source before starting a new task.'
      : drop.code === 'TASK_ENDED' ? 'Stop submitting; this task has ended.'
      : drop.code === 'UNKNOWN_FIELD' ? `Remove the unknown field at ${drop.path}; resubmit this slot at the same anchor; keep sequence/through/done.`
      : drop.retryable ? 'Correct this slot using the choices or schema and resubmit at the same anchor; keep sequence/through/done. Accepted ops stay.'
      : `Omit this ${drop.entry ? 'beat' : 'operation'}; keep accepted ops.`)
    return {path:drop.path, code, message:drop.message, received:drop.received ?? null,
      ...(drop.command ? {command:drop.command} : {}),
      ...(drop.validValues?.length ? {choices:drop.validValues} : drop.expected ? {schema:drop.expected} : {}),
      next_action, retryable:drop.retryable}
  })
  return assetPackToolFeedback({schema_version:1, ok:errors.length === 0, outcome:errors.length ? accepted ? 'partial' : 'not_applied' : 'applied', accepted, errors})
}

export function foldAssetPackWindow(prepared, base, slots, validateModCommand) {
  const { context, binding } = prepared
  let state = clone(base.state), entries = clone(base.entries), counts = {...base.counts}, totalOps = base.totalOps
  const diagnostics = [], usage = [], result = clone(slots), offset = prepared.baseline.pacing?.paragraph || 0
  for (let index = 0; index < result.length;) {
    const first = result[index], group = []
    while (index < result.length && result[index].beat === first.beat) group.push(result[index++])
    const before = clone(state), ops = [], at = offset + first.at - 1
    let sceneSet = false, cut = false, timeTransitionMs = 0
    if (state.cameraUntil !== undefined && at >= state.cameraUntil) { state.camera = {mode:'reset',actor:null}; delete state.cameraUntil }
    for (const slot of group) {
      if (slot.error && !slot.accepted) continue
      const op = clone(slot.op), nextCounts = {...counts}
      try {
        const definition = assetPackCommandDefinition(op,context)
        check(definition, '$.op', 'Choose a registered command', 'ARG_INVALID')
        // A model's string rationale is inert metadata, not part of AssetRef identity.
        // Only this observed annotation is stripped; all other extra fields still fail.
        const annotations = []
        for (const field of Object.keys(definition.refs || {})) if (typeof op[field]?.reason === 'string') {
          delete op[field].reason
          annotations.push({code:'REF_ANNOTATION_IGNORED',path:slot.path+'.'+field+'.reason',at:slot.at})
        }
        validateAssetPackToolValue(op, definition.schema(context), '$', {$defs:directorCommands.defs(context)})
        if (definition.mod && validateModCommand) {
          const flat=definition.command.paramsStyle==='flat',params=flat?Object.fromEntries(Object.entries(op).filter(([key])=>key!=='op')):op.params
          try {validateModCommand(definition.mod.id,definition.mod.commandId,params)}
          catch(error) {
            if (error.code==='MOD_API_UNSUPPORTED' || error.code==='ARG_INVALID') {
              throw Object.assign(new Error(error.message),{code:'ARG_INVALID',path:flat?(error.path || '$.params').replace(/^\$\.params(?=\.|\[|$)/,'$'):error.path || '$.params'})
            }
            throw error
          }
        }
        if (op.op === 'cast.set') {
          const cast = state.cg?.resumeCast || state.cast
          op.actors = cast.filter(id => op.actors.includes(id)).concat(op.actors.filter(id => !cast.includes(id)))
        }
        const key = definition.capKey && (definition.perActor ? definition.capKey + ':' + op.actor : definition.capKey)
        const safety = op.op === 'screen.play' && !['blur','blackout'].includes(op.effect) || op.op === 'actor.act.play' && ['shake','tremble'].includes(op.motion)
        if (safety && key && context.actionCaps[definition.capKey] !== undefined) {
          nextCounts[key] = (nextCounts[key] || 0) + 1
          check(nextCounts[key] <= context.actionCaps[definition.capKey], '$.budget', `${definition.capKey} safety limit ${context.actionCaps[definition.capKey]} per turn reached; omit this effect`, 'CAP_EXCEEDED')
        }
        if(definition.mod) {
          const {group,perTurn}=definition.command.caps
          const key=group?'mod-group:'+definition.command.modId+':'+group:'mod:'+definition.name
          const limit=group?Math.min(perTurn,...(context.modCommands || []).filter(row=>row.modId===definition.command.modId && row.caps.group===group).map(row=>row.caps.perTurn)):perTurn
          nextCounts[key]=(nextCounts[key] || 0)+1
          check(nextCounts[key]<=limit,'$.budget',`${definition.name}: limit ${limit} per turn reached; omit further calls this turn`,'CAP_EXCEEDED')
        }
        if (op.op === 'item.play') {
          nextCounts.items = (nextCounts.items || 0) + 1
          nextCounts.itemBytes = (nextCounts.itemBytes || 0) + Buffer.byteLength(JSON.stringify(op))
          check(nextCounts.items <= 8 && nextCounts.itemBytes <= 4096,'$.budget','Item performance budget exceeded','CAP_EXCEEDED')
        }
        if (definition.effect === 'source.mark') {
          const key = 'source-at:' + slot.at
          check(!nextCounts[key], '$.source', 'One source marker per paragraph'); nextCounts[key] = 1
        }
        const reduced = reduceAssetPackOperation(state, op, context, {sceneSet, at:slot.at, turn:binding.target.turn,
          page:prepared.pageIndex?.firstPageByPara[slot.at], entryOrdinal:entries.length, opOrdinal:ops.length})
        if (op.op === 'cg.set') op.variant = reduced.state.cg.variant
        const performance = definition.mod?.id === 'dsh.performance'
        if (performance && definition.mod.commandId === 'set') reduced.operation.params.level = reduced.state.performance.level
        const changed = performance ? !same(state.performance || null, reduced.state.performance || null)
          : definition.persistence !== 'state' || state.performance && op.op.startsWith('music.') || !same(state, reduced.state)
        // Turn-local counts survive repair/checkpoint windows, never carry into the next turn.
        if (op.op.startsWith('music.') && !same(state.music, reduced.state.music)) {
          if (counts.musicAt && !(op.force === true && typeof op.reason === 'string' && op.reason.trim())) {
            throw Object.assign(new Error('本轮已换曲一次；如确有第二个场景/气氛转折，加 force:true 和 reason，否则删除这一处'), {code:'MUSIC_FREQUENCY',path:'$',musicAt:counts.musicAt})
          }
          nextCounts.musicAt = slot.at
        }
        paceAssetPackOperation(state, reduced.state, context, at, reduced.locationChanged)
        if (changed || definition.mod && !performance) ops.push(definition.mod ? reduced.operation : op)
        cut ||= reduced.locationChanged || op.op === 'scene.clear' || op.op === 'transition.play'
        state = reduced.state; counts = nextCounts; totalOps++
        if (op.op === 'scene.set' || op.op === 'scene.clear') sceneSet = true
        timeTransitionMs = Math.max(timeTransitionMs, reduced.transitionMs || 0)
        if (op.op === 'closeup.play') state.cameraUntil = at + 4
        else if (state.camera.mode !== 'close') delete state.cameraUntil
        slot.corrections ||= annotations
        diagnostics.push(...slot.corrections, ...reduced.diagnostics.map(item => ({...item,at:slot.at})))
        slot.op = op; slot.accepted = true; delete slot.error
      } catch (error) {
        if (!error.code || error.code === 'REVISION_CONFLICT') throw error
        // A repair may not revoke a command that an earlier attempt already accepted.
        if (slot.accepted) throw Object.assign(new Error('Repair would invalidate an accepted operation: ' + error.message), {code:'ACCEPTED_CONFLICT',path:'$'})
        // A rejected scene cannot satisfy a same-beat transition dependency.
        if (op?.op === 'transition.play' && !sceneSet) {
          const prerequisite = group.slice(0, group.indexOf(slot)).find(item => ['scene.set','scene.clear'].includes(item.op?.op) && item.error)
          if (prerequisite) error.next_action = `Repair ${prerequisite.path} first (${prerequisite.error.message}); resubmit it and this transition at the same anchor; keep sequence/through/done. Accepted ops stay.`
        }
        slot.error = assetPackDrop(error, context, slot, state)
      }
    }
    state.figureScale = deriveAssetPackFigureScale(before, state, first.at, cut)
    if (ops.length) entries.push({at:first.at,ops,state:clone(state),timeTransitionMs})
    // private fork: streaming windows carry accepted caps, including normalized no-ops.
    usage.push({at:first.at,counts:{...counts},totalOps})
  }
  return {state,entries,counts,totalOps,slots:result,diagnostics,usage}
}
