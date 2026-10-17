import { promptSection } from './prompt-section.js'
// private fork: streaming windows use the production registry/transaction, not a second validator.
import {prepareAssetPackDirector, buildAssetPackRequest, createAssetPackTransaction, readAssetPackRecord, PROMPT_PROSE as DIRECTOR_PROSE} from './stage-asset-pack-director.js'
import {expireAssetPackWidgets} from './stage-asset-pack-tools.js'
import {assetPackDigest} from './stage-asset-pack-catalogue.js'
import {stagePageIndex} from '../../src/client/fork-stage-page-index.cjs'
import {cleanDirectorUnits} from './stage-director-text.js'
import {estimateDirectorTokens} from './stage-director-tokens.js'
import {initialAssetPackPacing} from './stage-asset-pack-pacing.js'
import {createStreamingDirector} from './stage-streaming-director.js'

// Prompt prose source (private fork). Keys are stable; interpolation arguments are data.
export const PROMPT_PROSE = Object.freeze({
  p001: "- In this window, paragraph numbers continue from earlier windows and `sequence` starts at 1. The window's last paragraph counts as the final one: cover it with `through` and set `done`, which closes the window, not the reply.",
  p002: "The story reply comes to you while it is being written, in windows of finished paragraphs, and you stage each window"
})


export function createStreamingPackDirector({input, identity, runAgent, current, onChange}) {
  const first = prepareAssetPackDirector({...input, units:[], generation:0})
  const fixed = buildAssetPackRequest(first)
  const tool = fixed.tools[0]
  const system = fixed.system.replace(DIRECTOR_PROSE.p006,PROMPT_PROSE.p002) + '\n' + STREAMING_WINDOW_PROMPT
  let kernel, attempts = 0, retries = 0
  kernel = createStreamingDirector({identity, baseline:first.baseline, system, tools:[tool], onChange,
    async run({paragraphs, carried, request, signal, epoch}) {
      if (!current()) throw Object.assign(new Error('Streaming source expired'),{code:'REVISION_CONFLICT'})
      const snapshot = kernel.snapshot(), last = paragraphs.at(-1).at
      const displayUnits = snapshot.paragraphs.slice(0,last).map(item => item.unit), units = cleanDirectorUnits(displayUnits)
      const recallUnits = units.slice(paragraphs[0].at - 1)
      const source = {...input, units, recallUnits, pageIndex:stagePageIndex(displayUnits), baseline:carried, record:undefined, generation:epoch, continuation:true}
      const prepared = prepareAssetPackDirector(source)
      const prompt = buildAssetPackRequest({...prepared,baseline:carried,units:units.slice(paragraphs[0].at - 1)},true,undefined,'',false,paragraphs[0].at)
      // Mod framework prose can precede the JSON; window metadata is its own text part.
      prompt.messages[0].content.push({type:'text',text:JSON.stringify({first:paragraphs[0].at})})
      const wire = {...request,system:prompt.system.replace(DIRECTOR_PROSE.p006,PROMPT_PROSE.p002) + '\n' + STREAMING_WINDOW_PROMPT,tools:prompt.tools,messages:prompt.messages,maxTokens:prompt.maxTokens}
      const capacity = prepared.modelInfo?.context?.contextWindow
      if (Number.isFinite(capacity) && estimateDirectorTokens(JSON.stringify(wire)) + wire.maxTokens > capacity) throw Object.assign(new Error('Streaming director request exceeds model context'),{code:'MODEL_CONTEXT_EXCEEDED'})
      const binding = prepared.binding
      const tx = createAssetPackTransaction({prepared:{...prepared,baseline:first.baseline}, validateModCommand:input.mods?.validateCommand, signal,
        getCurrentBinding:() => current() && kernel.snapshot().epoch === epoch ? binding : null,
        window:{request:wire,first:paragraphs[0].at,entries:snapshot.entries,carried,accounting:snapshot.accounting}})
      let lastReply, error, windowAttempts = 0, chain = Promise.resolve()
      await runAgent({...wire, signal, task:'stage-director', selection:first.selection, temperature:0.2,
        persistent:false,webSearchEnabled:false,stopToolsWhen:tx.terminal,acceptWithoutText:() => lastReply !== undefined,
        onToolCall(call) {
          const pending = chain.then(() => {
            attempts++; if (windowAttempts++) retries++
            let args = call.arguments
            if (typeof args === 'string') {try {args=JSON.parse(args)} catch {args=null}}
            lastReply = tx.submitModel(call.name === tool.name ? args : null)
            return JSON.stringify(lastReply)
          })
          chain = pending.catch(cause => {error=cause})
          return pending
        }})
      await chain
      if (error) throw error
      tx.finish()
      if (!tx.completed() && lastReply?.errors.length) throw Object.assign(new Error(lastReply.errors[0].message),{code:'STAGE_DIRECTION_REJECTED',rejection:lastReply.errors[0]})
      const record = tx.effect(), fresh = record.entries.slice(snapshot.entries.length)
      let state = carried, accounting = snapshot.accounting
      const usage = tx.usage()
      return {results:paragraphs.map(paragraph => {
        const entries = fresh.filter(entry => entry.at === paragraph.at)
        if (entries.length) state = entries.at(-1).state
        if (paragraph.at === last) state = record.end
        const used = usage.findLast(item => item.at <= paragraph.at)
        if (used) accounting = {counts:used.counts,totalOps:used.totalOps}
        return {id:paragraph.id,at:paragraph.at,ops:entries.flatMap(entry => entry.ops),entries,state,accounting,diagnostics:record.diagnostics.filter(item => item.at === paragraph.at || !item.at && paragraph === paragraphs[0])}
      })}
    }})
  return {kernel, baseline:first.baseline, binding:first.binding,
    complete(binding, count) {
      const snapshot = kernel.snapshot(), end = structuredClone(snapshot.state)
      if (snapshot.phase !== 'settled') throw new Error('Streaming direction incomplete')
      if (end.figureScale) delete end.figureScale.event
      expireAssetPackWidgets(end,'turn-end')
      if (end.camera.mode === 'close') end.camera = {mode:'reset',actor:null}
      delete end.cameraUntil
      end.pacing ||= initialAssetPackPacing(end)
      end.pacing.paragraph = (first.baseline.pacing?.paragraph || 0) + count
      const drops = snapshot.diagnostics.filter(item => item.dropped)
      const value = {format:first.format,complete:true,binding,baseline:first.baseline,entries:snapshot.entries,end,diagnostics:snapshot.diagnostics,
        partial:drops.length > 0,stats:{calls:snapshot.calls,attempts,submissions:attempts,retries,failures:0,acceptedOps:snapshot.accounting.totalOps,droppedOps:drops.filter(item => !item.entry).length,droppedEntries:drops.filter(item => item.entry).length,
          dropsByCapability:Object.fromEntries([...new Set(drops.map(item => item.capability))].map(key => [key,drops.filter(item => item.capability === key).length]))}}
      return readAssetPackRecord({...value,digest:assetPackDigest({binding,baseline:value.baseline,entries:value.entries,end})})
    }}
}

// Prompt prose source; keep streaming fields verbatim.
const STREAMING_WINDOW_PROMPT = promptSection('director_window', PROMPT_PROSE.p001)
