import {judgeEnabled} from './engine-judge.js'
import {judgeMaterial,selectJudgeRecall} from './stage-judge-recall.js'
import { assetPackDigest } from './stage-asset-pack-catalogue.js'
import { captureStageTarget } from './stage-incremental.js'
import { createStageHistoryCache } from './stage-history-cache.js'
import { isImmutableJson } from './freeze-json.js'
import { sceneTarget } from './scene-illustration.js'
import { stageParagraphs } from './stage-paragraphs.js'
import { cleanDirectorUnits } from './stage-director-text.js'
import { stagePageIndex } from '../../src/client/fork-stage-page-index.cjs'
import { prepareStageItems, finalizeStageItems } from './stage-items.js'
import { prepareAssetPackDirector, buildAssetPackRequest, nameModSections, nameModCommands, runAssetPackDirector, readAssetPackRecord, readAssetPackPreview, ASSET_PACK_RECORD_FIELD as RECORD, ASSET_PACK_DRAFT_FIELD as DRAFT } from './stage-asset-pack-director.js'
import { createStreamingPackDirector } from './stage-streaming-pack.js'
import { cardGreetings, messageOpeningId, resolveOpeningScene } from './stage-opening-scene.js'
import { ASSET_PACK_FORMAT } from '../../packages/dsh-presentation-protocol/src/asset-packs.js'
import {modCorrectionSourceMatches} from './mods/stage-corrections.js'
import modProjection from '../../src/client/fork-mod-projection.cjs'
export { stageParagraphs } from './stage-paragraphs.js'

const latestTurn = chat => Math.max(0, ...chat.messages.filter(m => m.role === 'assistant').map(m => Number(m.turn || (m.greeting ? 1 : 0))))
const messageIndex = (chat, turn) => chat.messages.findIndex(m => m.role === 'assistant' && Number(m.turn || (m.greeting ? 1 : 0)) === turn)
const expired = () => Object.assign(new Error('Director task expired; retry explicitly'), {code:'REVISION_CONFLICT'})
const FAILURE = 'stageDirectionAssetPacksFailure'

// One task owner and one Story Timeline commit gate, for both new and resumed jobs.
export function createStageDirector(deps) {
  const jobs = new Map(), failures = new Map(), tasks = new Set(), versions = new Map(), listeners = new Set(), openingAssets = new Map()
  const streams = new Map(), judgeResults = new Map(), retryPreparations = new Map()
  const historyCache = createStageHistoryCache({readChanges:deps.readChanges})
  let revision = Date.now()
  let disposed = false
  const key = (chat, turn) => JSON.stringify([chat.id, turn])
  function publish(job) {
    const event = {kind:'stage-direction', sessionId:job.sessionId, turn:job.turn, version:String(++revision)}
    for (const fn of listeners) fn(event)
    deps.publish?.(event)
  }
  // private fork: observation versions identify existing sealed content; they do not authenticate it again.
  function observation(chat, turn, body, displayDigest, unitsDigest, pageDigest, options) {
    const {record, preview, binding, baseline, entries, units, displayUnits, pageIndex, ...identity} = body
    const signature = JSON.stringify([identity, record?.digest, record?.diagnostics, record?.stats, record?.partial,
      preview?.prefixDigest, displayDigest, unitsDigest, pageDigest])
    const id = key(chat,turn)
    let version = versions.get(id)
    if (version?.signature !== signature) {version = {signature,revision:++revision};versions.set(id,version)}
    return options.sinceRevision === version.revision ? {unchanged:true,revision:version.revision} : {...body,revision:version.revision}
  }
  function invalidate(cardPath) {
    if (cardPath) openingAssets.delete(cardPath); else openingAssets.clear()
    for (const job of jobs.values()) if (!cardPath || job.cardPath === cardPath) job.controller.abort()
    for (const job of streams.values()) if (!cardPath || job.cardPath === cardPath) job.pack?.kernel.cancel()
  }
  // private fork: user stop owns both paths; keep jobs so failure/checkpoints prevent auto-restart.
  function activity(chat) {
    const job = [...jobs.values(), ...streams.values()].find(job => job.chatId === chat.id && job.sessionId === chat.sessionId
      && (job.controller ? !job.controller.signal.aborted : job.pack && !['cancelled','failed','settled'].includes(job.pack.kernel.snapshot().phase)))
    return job ? {operationId:job.stopId, busy:true, phase:'running', role:'stage-director'} : null
  }
  function cancel(chat) {
    for (const job of jobs.values()) if (job.chatId === chat.id && job.sessionId === chat.sessionId) {job.controller.abort(); publish(job)}
    for (const job of streams.values()) if (job.chatId === chat.id && job.sessionId === chat.sessionId) job.pack?.kernel.cancel()
  }
  const off = deps.assets.subscribe(invalidate)
  function cancelForNextTurn(chat, job) {
    if (job.cancelledFailure) return
    const index = messageIndex(chat, job.turn)
    const sourceKey = index >= 0 ? captureStageTarget(chat,index).sourceKey : job.committedSourceKey || (job.controller ? job.target.sourceKey : null)
    if (!sourceKey) return
    const failure = {status:'error',sourceKey,
      code:'DIRECTOR_NEXT_TURN_CANCELLED',error:'已开始下一轮，本轮未完成的演出编排已取消；可在本轮手动重新编排。',retryable:true}
    job.cancelledFailure = failure
    job.value = failure
    job.error = failure.error
    failures.set(key(chat,job.turn),failure)
    job.controller?.abort()
    job.pack?.kernel.cancel()
    publish(job)
    job.cancellation = persistFailure(job,failure).then(() => publish(job)).catch(error => {
      deps.log?.({kind:'director-failure-persistence',sessionId:job.sessionId,turn:job.turn,error:String(error.message)})
    })
    tasks.add(job.cancellation)
    job.cancellation.finally(() => tasks.delete(job.cancellation))
  }
  function observe(chat, {metadataOnly = false} = {}) {
    deps.mods?.observe(chat,{metadataOnly})
    // Sending is the cancellation boundary, not the next body's eventual commit.
    for (const job of [...jobs.values(), ...streams.values()]) if (job.chatId === chat.id && job.sessionId === chat.sessionId &&
      Object.values(chat.timeline?.operations || {}).some(op => op.kind === 'body' && op.status === 'running' && Number(op.turn) > job.turn)) cancelForNextTurn(chat,job)
    for (const job of streams.values()) if (job.sessionId === chat.sessionId) {
      const op = chat.timeline?.operations?.[job.operationId]
      if (chat.id !== job.chatId || chat.cardPath !== job.cardPath || chat.timeline?.branchId !== job.branchId || !op || ['cancelled','failed','stale','interrupted'].includes(op.status)) {
        job.pack?.kernel.cancel(); streams.delete(key({id:job.chatId},job.turn))
        if (job.pack) {const stopped=job.pack.kernel.drain();tasks.add(stopped);stopped.finally(() => tasks.delete(stopped))}
      }
    }
    for (const job of jobs.values()) if (job.sessionId === chat.sessionId) {
      try {
        const target = metadataOnly ? {...job.target, branchId:chat.timeline.branchId, revision:chat.timeline.revision} : targetAt(chat, messageIndex(chat, job.turn))
        if (chat.id !== job.chatId || chat.cardPath !== job.cardPath || chat.regenInProgress || JSON.stringify(target) !== JSON.stringify(job.target)) job.controller.abort()
      } catch { job.controller.abort() }
    }
  }
  function recordsThrough(chat, index, history) {
    if (history) return history.at(index)
    let previous = null, current = null
    const records = []
    for (let i = 0; i <= index; i++) {
      current = null
      const raw = chat.messages[i]?.[RECORD]
      if (!raw) continue
      const record = readAssetPackRecord(raw), target = record.binding.target
      if (target.sourceKey !== captureStageTarget(chat,i).sourceKey || target.predecessorDigest !== (previous?.digest || null)) continue
      previous = current = record
      records.push(record)
    }
    return {previous, current, records}
  }
  const recordAt = (chat, index, history) => recordsThrough(chat,index,history).current
  const predecessor = (chat, index, history) => recordsThrough(chat,index - 1,history).previous
  const targetAt = (chat, index) => ({...captureStageTarget(chat,index), predecessorDigest:predecessor(chat,index)?.digest || null})
  const frozenDisplay = async (chat, turn) => {
    const source = sceneTarget(chat, turn)
    const displayUnits = stageParagraphs(source.source, await deps.paragraphParts?.(chat, source))
    return {displayUnits, units:cleanDirectorUnits(displayUnits), pageIndex:stagePageIndex(displayUnits)}
  }
  // private fork: greeting turns are never directed. The opening scene is read-only (cached per asset revision)
  // and reaches the client as an ordinary complete record; it also seeds the first directed turn.
  function openingSnapshot(cardPath) {
    const revision = deps.assets.revision, hit = openingAssets.get(cardPath)
    if (hit?.revision === revision) return hit.value
    const value = deps.assets.snapshot(cardPath)
    openingAssets.set(cardPath, {revision, value})
    value.catch(() => { if (openingAssets.get(cardPath)?.value === value) openingAssets.delete(cardPath) })
    return value
  }
  const openingOf = (assets, message) => resolveOpeningScene(assets, messageOpeningId(message, cardGreetings(assets.raw)))
  async function openingRecord(chat, turn, index) {
    const assets = await openingSnapshot(chat.cardPath)
    if (!assets) return {status:'off'}
    const opening = openingOf(assets, chat.messages[index])
    // Timeline revision is excluded: later turns must not re-key (and re-project) the greeting.
    const {revision:_timeline, ...target} = targetAt(chat, index)
    const frozen = await frozenDisplay(chat, turn)
    const binding = {target, unitsDigest:assetPackDigest(frozen.units), pageDigest:assetPackDigest(frozen.pageIndex),
      opening:{id:opening.id, digest:assetPackDigest({state:opening.state, emotions:opening.emotions})}}
    const value = {format:ASSET_PACK_FORMAT, complete:true, binding, baseline:opening.state, entries:[], end:opening.state, diagnostics:[]}
    const record = readAssetPackRecord({...value, digest:assetPackDigest({binding, baseline:value.baseline, entries:value.entries, end:value.end})})
    return {status:'done', record, ...record, opening:{emotions:opening.emotions}}
  }
  // private fork (stage mode entry, owner 2026-10): the engine's directorModel — {provider, model} as set; anything else
  // (null, the default 跟随前台) is the chat model (deps.foreground). There is no 跟随后台 any more.
  async function directorSelection(choice, chat) {
    return choice && typeof choice === 'object' ? choice : await deps.foreground(chat)
  }
  async function prepare(chat, turn, {signal, preview = true, authorityOnly = false, retryPreparation, capturePreparation} = {}) {
    const assets = await deps.assets.snapshot(chat.cardPath)
    if (!assets) return null
    const index = messageIndex(chat, turn), target = targetAt(chat, index)
    const {units, pageIndex} = await frozenDisplay(chat, turn)
    const record = predecessor(chat, index), greeting = !record && chat.messages.slice(0, index).findLast(m => m.role === 'assistant' && m.greeting === true)
    const engine = structuredClone(assets.engine)
    engine.directorModel = await directorSelection(engine.directorModel, chat)
    if (!engine.directorModel) throw new Error('No director model selected')
    const info = await deps.modelInfo?.(engine.directorModel)
    const judgeConfigured = judgeEnabled(engine.judge)
    let mods=await deps.mods?.prepare(chat,turn,{target,preview:true,isCurrent:assets.current})
    const input = {...assets, stateSource:await deps.stateSource?.(chat,assets.raw), ...(mods ? {mods,modPrompts:mods.fragments} : {}), items:prepareStageItems(assets.raw,chat,index,assets.snapshots,assets.globalEnabledPackIds), engine, target, units, pageIndex, generation:chat.messages[index].stageDirectionGeneration || 0, predecessor:recordsThrough(chat,index - 1).records, modelInfo:info, record, opening:greeting ? openingOf(assets, greeting).state : undefined}
    let prepared = prepareAssetPackDirector(input), judge, judgeResult, judgeRecall
    // Retry keeps decisions, not authority: rebuild bindings/proofs against the current source and assets.
    const scope = JSON.stringify([chat.cardPath,target.branchId,target.sourceKey,prepared.binding.unitsDigest,engine.judge])
    const reused = retryPreparation?.scope === scope ? retryPreparation : null
    if (!authorityOnly && prepared && deps.judge && judgeConfigured) {
      const questions = [...prepared.judgeQuestions,...(mods?.judgeQuestions || [])]
      const request = {material:judgeMaterial(engine.judge.preamble,units),questions:questions.map(({id,text}) => ({id,text}))}
      judge = deps.judge.preview(request,engine.judge)
      const inputKey = assetPackDigest({request,config:engine.judge,target:target.sourceKey,revision:assets.engine.judge,generation:input.generation})
      const saved = chat.messages[index][RECORD]?.stats?.judge
      let hit = judgeResults.get(chat.id)
      if (saved?.inputKey === inputKey) hit = saved
      if (reused?.judgeResult) hit = {...reused.judgeResult,inputKey}
      else if (!preview) {
        const probabilities = await deps.judge.judge(request)
        hit = {inputKey,probabilities:probabilities ? [...probabilities] : null}
        judgeResults.set(chat.id,hit)
      }
      if (hit?.inputKey === inputKey) {
        judgeResult = hit
        judgeRecall = selectJudgeRecall(questions,hit.probabilities ? new Map(hit.probabilities) : null,engine.judge)
      }
    }
    if (reused) judgeRecall = new Set(reused.judgeRecall)
    const preparation = {scope,...(judgeResult ? {judgeResult} : {}),judgeRecall:[...(judgeRecall || [])]}
    capturePreparation?.(preparation)
    if (judgeRecall) prepared=prepareAssetPackDirector({...input,judgeRecall})
    if (mods) mods=await deps.mods.prepare(chat,turn,{target,preview:preview || authorityOnly,isCurrent:assets.current,judgeRecall,
      assetCatalogue:prepared.context.catalogue,stageState:prepared.baseline.modState})
    if (mods?.selection) preparation.modSelection = mods.selection
    capturePreparation?.(preparation)
    if (mods || judgeRecall) prepared=prepareAssetPackDirector({...input,mods,modPrompts:mods?.fragments || [],judgeRecall})
    return {prepared, mods, judge, judgeResult, current:assets.current, index, target}
  }
  // private fork: stream identity is admitted only from a running host body operation.
  async function beginStream(chat, turn) {
    if (disposed || !chat?.cardPath || !['story','script'].includes(chat.mode)) return null
    // A configured judge needs the final body; the unset path keeps streaming exactly as before.
    if (deps.judge?.enabled()) return null
    const operation = Object.values(chat.timeline?.operations || {}).find(op => op.kind === 'body' && op.status === 'running' && Number(op.turn) === turn)
    if (!operation || !await deps.assets.hasBindings(chat.cardPath)) return null
    // First-party preparation uses the frozen body, just like the judge path.
    if(await deps.mods?.enabled(chat.cardPath))return null
    const id = key(chat,turn)
    let job = streams.get(id)
    if (job?.operationId !== operation.id) {
      job?.pack?.kernel.cancel()
      const assets = await deps.assets.snapshot(chat.cardPath)
      if (!assets) return null
      const engine = structuredClone(assets.engine)
      engine.directorModel = await directorSelection(engine.directorModel, chat)
      if (!engine.directorModel) return null
      // private fork: the host stream hook supplies the same immutable persisted read as observers.
      const history = isImmutableJson(chat) ? await historyCache.read(chat) : undefined
      const record = predecessor(chat,chat.messages.length,history), greeting = !record && chat.messages.findLast(m => m.role === 'assistant' && m.greeting)
      const target = {sessionId:chat.sessionId,chatId:chat.id,turn,branchId:chat.timeline.branchId,revision:chat.timeline.revision,
        sourceKey:assetPackDigest([chat.id,operation.id]),sourceDigest:assetPackDigest([]),predecessorDigest:record?.digest || null}
      job = {chatId:chat.id,sessionId:chat.sessionId,cardPath:chat.cardPath,branchId:chat.timeline.branchId,operationId:operation.id,turn,target, stopId:'director:' + (++revision), serial:0,current:assets.current}
      streams.set(id,job)
      // No active mods reach this path, but installed commands still belong to its frozen grammar.
      const mods = await deps.mods?.prepare(chat,turn,{target,preview:true,isCurrent:assets.current,relevance:{status:'skipped'}})
      const input = {...assets,stateSource:await deps.stateSource?.(chat,assets.raw),...(mods ? {mods} : {}),items:prepareStageItems(assets.raw,chat,chat.messages.length,assets.snapshots,assets.globalEnabledPackIds),engine,target,record,predecessor:recordsThrough(chat,chat.messages.length - 1,history).records,
        opening:greeting ? openingOf(assets,greeting).state : undefined,modelInfo:await deps.modelInfo?.(engine.directorModel)}
      job.pack = createStreamingPackDirector({input,identity:{sessionId:chat.sessionId,branchId:job.branchId,bodyOperationId:operation.id,nativeTurn:turn},
        current:() => !disposed && streams.get(id) === job && assets.current(),
        runAgent:request => {
          job.modelCalls = (job.modelCalls || 0) + 1
          const bytes = value => new TextEncoder().encode(value).length
          deps.log?.({kind:'streaming-director-request',sessionId:job.sessionId,turn,operationId:job.operationId,modelCalls:job.modelCalls,
            systemBytes:bytes(request.system),toolSchemaBytes:bytes(JSON.stringify(request.tools)),tailBytes:bytes(JSON.stringify(request.messages))})
          return deps.runAgent({...request,sessionId:chat.sessionId,turn})
        },
        onChange:value => {
          if (value.calls !== job.loggedCalls) {
            job.loggedCalls = value.calls
            deps.log?.({kind:'streaming-director-cost',sessionId:job.sessionId,turn,operationId:operation.id,calls:value.calls,budget:value.budget,paragraphs:value.highWater,phase:value.phase})
          }
          const stamp = JSON.stringify([value.epoch,value.through,value.calls,value.phase])
          if (stamp !== job.published) {job.published=stamp;publish(job)}
        }})
    }
    const serial = ++job.serial
    return {update(text) {if (job.serial === serial) job.pack.kernel.update(stageParagraphs(text))},
      discard() {if (job.serial === serial) job.pack.kernel.update([])},
      cancel() {if (job.serial === serial) job.pack.kernel.cancel()}}
  }
  function streamEnvelope(chat, turn, job) {
    const snapshot = job.pack.kernel.snapshot(), displayUnits = snapshot.paragraphs.slice(0,snapshot.through).map(item => item.unit)
    const units = cleanDirectorUnits(displayUnits), pageIndex = stagePageIndex(displayUnits)
    const generation = snapshot.epoch, target = {...job.target,sourceKey:assetPackDigest([job.operationId,generation]),sourceDigest:assetPackDigest(displayUnits)}
    const binding = {...job.pack.binding,target,stream:{version:1,operationId:job.operationId,epoch:generation},generation,unitsDigest:assetPackDigest(units),pageDigest:assetPackDigest(pageIndex)}
    const body = {binding,sourceKey:target.sourceKey,generation,prefixRevision:snapshot.through,through:snapshot.through,units,baseline:job.pack.baseline,entries:snapshot.entries,complete:false}
    const preview = readAssetPackPreview({...body,prefixDigest:assetPackDigest(body)}), bindingKey = assetPackDigest(binding)
    const failed = (job.error ? {message:job.error} : snapshot.failure) || (snapshot.phase === 'cancelled' ? {message:'Generation stopped'} : null)
    return {streaming:true,status:failed ? 'error' : snapshot.through ? 'partial' : 'running',phase:failed ? 'error' : snapshot.through ? 'partial' : 'running',
      target,generation,token:{sourceKey:target.sourceKey,branchId:target.branchId,generation,bindingKey,prefixRevision:snapshot.through,digest:preview.prefixDigest},
      units,displayUnits,pageIndex,assetRevision:deps.assets.revision || 0,complete:false,through:snapshot.through,binding,bindingKey,prefixRevision:snapshot.through,
      baseline:job.pack.baseline,entries:snapshot.entries,preview,...(failed ? {error:failed.message} : {})}
  }
  async function finishStream(chat, turn, job) {
    if (job.finishing) return job.finishing
    job.committedSourceKey = captureStageTarget(chat,messageIndex(chat,turn)).sourceKey
    job.generation = chat.messages[messageIndex(chat,turn)].stageDirectionGeneration || 0
    job.finishing = (async () => {
      let task
      try {
        task = await deps.beginTask(chat)
        const frozen = await frozenDisplay(task.chat,turn)
        job.pack.kernel.commit(frozen.displayUnits)
        await job.pack.kernel.drain()
        const snapshot = job.pack.kernel.snapshot()
        if (snapshot.phase !== 'settled') throw new Error(snapshot.failure?.message || 'Streaming director cancelled')
        const prepared = await prepare(task.chat,turn,{authorityOnly:true}), index = messageIndex(task.chat,turn)
        if (!prepared || prepared.target.predecessorDigest !== job.target.predecessorDigest || !job.current()) throw expired()
        // The final binding must describe the display actually reconciled, not a later template projection.
        if (prepared.prepared.binding.unitsDigest !== assetPackDigest(frozen.units) || prepared.prepared.binding.pageDigest !== assetPackDigest(frozen.pageIndex)) throw expired()
        const binding = {...prepared.prepared.binding,...(job.pack.binding.items ? {items:job.pack.binding.items} : {}),generation:snapshot.epoch,stream:{version:1,operationId:job.operationId,epoch:snapshot.epoch,committed:true}}
        const effect = job.pack.complete(binding,frozen.units.length)
        const result = await task.commit({stateChanged:false,participant:null,apply(draft) {
          if (disposed || streams.get(key(chat,turn)) !== job || job.pack.kernel.snapshot().phase !== 'settled' || !job.current() || JSON.stringify(targetAt(draft,index)) !== JSON.stringify(prepared.target)) throw expired()
          draft.messages[index][RECORD] = effect
          finalizeStageItems(draft,index)
          draft.messages[index].stageDirectionGeneration = snapshot.epoch
          delete draft.messages[index][DRAFT]; delete draft.messages[index][FAILURE]
        }})
        if (result.status !== 'committed') throw expired()
        streams.delete(key(chat,turn))
      } catch (error) {
        const failure = {status:'error',sourceKey:captureStageTarget(chat,messageIndex(chat,turn)).sourceKey,error:String(error.message),retryable:true}
        const current = () => !disposed && streams.get(key(chat,turn)) === job
        if (current() && !job.cancelledFailure) failures.set(key(chat,turn),failure)
        job.error = String(error.message)
        const saved = await saveFailure(task,job,failure,message => {
          if (!current()) throw expired()
          message.stageDirectionGeneration = job.pack.kernel.snapshot().epoch
        })
        if (saved && streams.get(key(chat,turn)) === job) streams.delete(key(chat,turn))
      } finally {
        const value = job.pack.kernel.snapshot()
        deps.log?.({kind:'streaming-director-cost',sessionId:job.sessionId,turn,operationId:job.operationId,calls:value.calls,modelCalls:job.modelCalls || 0,budget:value.budget,paragraphs:value.highWater,phase:job.error ? 'error':'committed'})
        publish(job)
      }
    })()
    tasks.add(job.finishing); job.finishing.finally(() => tasks.delete(job.finishing))
    return job.finishing
  }
  async function persistFailure(job, failure, apply = () => {}) {
    if (!deps.updateChat || disposed) return false
    let saved = false
    await deps.updateChat(job.chatId, draft => {
      const index = messageIndex(draft,job.turn)
      const message = draft.messages[index]
      if (draft.cardPath !== job.cardPath || index < 0 || draft.timeline?.branchId !== job.target.branchId ||
        captureStageTarget(draft,index).sourceKey !== failure.sourceKey ||
        (message.stageDirectionGeneration || 0) !== (job.generation || 0) || message[RECORD]) return undefined
      message[FAILURE] = failure
      apply(message)
      saved = true
      return draft
    })
    return saved
  }
  async function saveFailure(task, job, failure, apply = () => {}) {
    if (job.cancelledFailure) {
      await job.cancellation
      await task?.commit({status:'failed',stateChanged:false,participant:null})
      return true
    }
    deps.log?.({kind:'director-failure',sessionId:job.sessionId,turn:job.turn,sourceKey:failure.sourceKey,code:failure.code,error:failure.error})
    let saved = false
    if (task && !disposed) {
      try {
        // Failure identity needs the full source prefix; checkpointMessage is a one-row projection.
        if (deps.updateChat) saved = await persistFailure(job,failure,apply)
        else {
          await task.checkpoint(draft => {
            const index = messageIndex(draft,job.turn)
            if (draft.cardPath !== job.cardPath || captureStageTarget(draft,index).sourceKey !== failure.sourceKey) throw expired()
            draft.messages[index][FAILURE] = failure
            apply(draft.messages[index])
          })
          saved = true
        }
      } catch (error) {
        deps.log?.({kind:'director-failure-persistence',sessionId:job.sessionId,turn:job.turn,phase:'checkpoint',error:String(error.message),stack:error.stack})
      }
    }
    try { await task?.commit({status:'failed',stateChanged:false,participant:null}) }
    catch (error) { deps.log?.({kind:'director-failure-persistence',sessionId:job.sessionId,turn:job.turn,phase:'commit',error:String(error.message),stack:error.stack}) }
    return saved
  }
  async function getValue(chat, turn, _config, options = {}) {
    if (disposed || !chat.cardPath) return {status:'off'}
    if (!options.observed) observe(chat)
    turn ||= latestTurn(chat)
    if (!turn) return {status:'off'}
    // No extension means no service lookup, legacy catalogue or automatic generation.
    if (!await deps.assets.hasBindings(chat.cardPath)) return {status:'off', available:false}
    const id = key(chat, turn), index = messageIndex(chat, turn)
    if (index < 0) return {status:'missing'}
    const record = recordAt(chat, index, options.history)
    if (record) return {status:'done', record, ...record}
    if (chat.messages[index].greeting === true) return openingRecord(chat, turn, index)
    const stream = streams.get(id)
    if (stream) {
      if (stream.cancelledFailure) return stream.cancelledFailure
      if (options.generate !== false && !stream.finishing) void finishStream(chat,turn,stream)
      return streamEnvelope(chat,turn,stream)
    }
    // private fork: an undirected turn carries the last accepted end, never its first page.
    const baseline = predecessor(chat,index,options.history)?.end || null
    if (jobs.has(id)) return {...jobs.get(id).value,baseline}
    const failure = chat.messages[index]?.[FAILURE] || failures.get(id)
    if (failure && failure.sourceKey === (options.history ? options.history.target(index,chat) : captureStageTarget(chat,index)).sourceKey) {
      const {preparation, ...visible} = failure
      return {...visible,baseline}
    }
    if (options.generate === false || turn !== latestTurn(chat) && !options.generate) return {status:'missing',baseline}
    const job = {chatId:chat.id, sessionId:chat.sessionId, cardPath:chat.cardPath, turn, target:targetAt(chat,index), stopId:'director:' + (++revision), controller:new AbortController(), value:{status:'running',baseline}}
    jobs.set(id,job)
    publish(job)
    const logMods = phase => deps.log?.({kind:'director-mods',sessionId:job.sessionId,chatId:job.chatId,turn,
      generation:job.generation,phase,selected:job.preparation?.modSelection?.mods.filter(row=>row.selected).map(row=>row.id) || [],
      used:[...new Set((job.value.preview?.entries || []).flatMap(entry=>entry.ops.filter(op=>op.op==='mod.command').map(op=>op.modId)))].sort()})
    const promise = (async () => {
      let task
      try {
        task = await deps.beginTask(chat)
        const basis = task.chat
        job.generation = basis.messages[index].stageDirectionGeneration || 0
        const input = await prepare(basis, turn,{preview:false,signal:job.controller.signal,
          retryPreparation:retryPreparations.get(id),capturePreparation:value => {job.preparation = value}})
        if (!input || job.controller.signal.aborted || disposed) throw expired()
        job.target = input.target
        logMods('selected')
        const getCurrentBinding = () => !disposed && !job.controller.signal.aborted && input.current() ? input.prepared.binding : null
        const oldDraft = basis.messages[input.index][DRAFT]
        const generated = await runAssetPackDirector({prepared:input.prepared, validateModCommand:input.mods?.validateCommand, getCurrentBinding, signal:job.controller.signal,
          checkpoint:oldDraft, generation:basis.messages[input.index].stageDirectionGeneration || 0, guidance:options.guidance,
          publishPreview:preview => { job.value = {status:'partial', preview, baseline:preview.baseline}; publish(job); deps.mods?.applied(input.mods,preview) },
          runAgent:request => deps.runAgent({...request, sessionId:chat.sessionId,turn}),
          saveCheckpoint:checkpoint => task.checkpointMessage(input.index, (_draft, message) => {
            if (!getCurrentBinding()) throw expired()
            message[DRAFT] = checkpoint
          })})
        const committed = await task.commit({stateChanged:false, participant:null, apply(draft) {
          if (!generated.isCurrent() || JSON.stringify(targetAt(draft,input.index)) !== JSON.stringify(input.target)) throw expired()
          draft.messages[input.index][RECORD] = generated.effect
          if (input.judgeResult) draft.messages[input.index][RECORD].stats.judge = input.judgeResult
          if (input.mods?.selection) draft.messages[input.index][RECORD].stats.modSelection = input.mods.selection
          finalizeStageItems(draft,input.index)
          delete draft.messages[input.index][DRAFT]
          delete draft.messages[input.index][FAILURE]
        }})
        if (committed.status !== 'committed') throw expired()
        deps.mods?.applied(input.mods,generated.effect)
        retryPreparations.delete(id)
        logMods('committed')
        publish(job)
      } catch (error) {
        const failure = {status:'error', sourceKey:job.target.sourceKey, code:error.code || 'DIRECTION_FAILED', error:String(error.message), retryable:true, ...(job.value.preview ? {preview:job.value.preview} : {}), ...(job.preparation ? {preparation:job.preparation} : {})}
        logMods('failed')
        if (!job.cancelledFailure) failures.set(id,failure)
        await saveFailure(task,job,failure)
      }
    })().finally(() => { if (jobs.get(id) === job) jobs.delete(id); tasks.delete(promise); publish(job) })
    tasks.add(promise)
    return job.value
  }
  // private fork: observation never starts or resumes a task, including the latest turn.
  async function get(chat, turn, config, options = {}) {
    if (!options.readOnly) return getValue(chat, turn, config, options)
    turn ||= latestTurn(chat)
    observe(chat)
    deps.mods?.recover?.(chat,turn)
    const history = await historyCache.read(chat,messageIndex(chat,turn))
    const stream = streams.get(key(chat,turn))
    if (stream?.pack && !stream.cancelledFailure && !recordAt(chat,messageIndex(chat,turn),history)) {
      const body = streamEnvelope(chat,turn,stream)
      return observation(chat,turn,body,body.target.sourceDigest,body.binding.unitsDigest,body.binding.pageDigest,options)
    }
    const value = await getValue(chat, turn, config, {generate:false,history,observed:true})
    const index = messageIndex(chat, turn)
    const target = index >= 0 ? history.target(index,chat) : null
    const source = target ? sceneTarget(chat,turn) : null
    const displayUnits = source ? stageParagraphs(source.source, await deps.paragraphParts?.(chat,source,{persisted:true})) : []
    const units = cleanDirectorUnits(displayUnits), pageIndex = stagePageIndex(displayUnits)
    const preview = value.preview ? readAssetPackPreview(value.preview) : null, record = value.record
    const binding = record?.binding || preview?.binding || null
    const legacyPlayback = !!record && binding.unitsDigest === undefined
    const unitsDigest = assetPackDigest(units), pageDigest = assetPackDigest(pageIndex)
    if (binding && (binding.target.sourceKey !== target.sourceKey || binding.target.sourceDigest !== target.sourceDigest || !legacyPlayback && binding.unitsDigest !== unitsDigest)) throw expired() // private fork: preview.units are bound by binding.unitsDigest at seal time
    if (binding?.pageDigest && binding.pageDigest !== pageDigest) throw Object.assign(new Error('Frozen stage page index changed'), {code:'STAGE_PAGE_MISMATCH'})
    const generation = chat.messages[index]?.stageDirectionGeneration || 0
    const prefixRevision = preview?.prefixRevision ?? (record ? record.entries.length + units.length + 1 : undefined)
    const token = binding ? {sourceKey:target.sourceKey, branchId:target.branchId, generation,
      bindingKey:assetPackDigest(binding), prefixRevision, digest:record?.digest || preview.prefixDigest} : null
    const body = {status:value.status, phase:value.status === 'missing' ? 'unknown' : value.status,
      target, generation, token, units, displayUnits, pageIndex, legacyPlayback, assetRevision:deps.assets.revision || 0, complete:!!record, through:record ? units.length : preview?.through || 0,
      ...(binding ? {binding, bindingKey:token.bindingKey, prefixRevision, baseline:record?.baseline || preview.baseline,
        entries:record?.entries || preview.entries} : {}),
      ...(record ? {record} : {}), ...(preview ? {preview} : {}), ...(value.opening ? {opening:value.opening} : {}), ...(value.error ? {error:value.error, ...(value.code ? {code:value.code} : {})} : {})}
    const modCorrections=chat.messages[index]?.modCorrections
    if(binding && modCorrectionSourceMatches(modCorrections,{branchId:target.branchId,sourceKey:target.sourceKey,generation,textVersion:target.sourceKey})) {
      body.modPerformances=modProjection.projectModPerformances(modCorrections)
      body.modCorrectionRevision=modCorrections.revision
    }
    const result = observation(chat,turn,body,assetPackDigest(displayUnits),unitsDigest,pageDigest,options)
    return result.unchanged || !options.includePredecessor ? result : {...result,predecessor:recordsThrough(chat,index - 1,history).records}
  }
  async function retry(chat, turn, {regenerate = false} = {}) {
    turn ||= latestTurn(chat)
    const id = key(chat,turn), job = jobs.get(id), stream = streams.get(id)
    stream?.pack?.kernel.cancel(); streams.delete(id)
    job?.controller.abort()
    // Wait until checkpoint writes have stopped before resetting the authoritative draft.
    await stream?.finishing
    if (job) await drain()
    const failure = failures.get(id) || chat.messages[messageIndex(chat,turn)]?.[FAILURE]
    const preparation = failure?.preparation
    if (preparation) retryPreparations.set(id,structuredClone(preparation))
    else retryPreparations.delete(id)
    while (retryPreparations.size > 64) retryPreparations.delete(retryPreparations.keys().next().value)
    failures.delete(id)
    const reset = await deps.resetTask(chat,turn,{regenerate})
    publish({sessionId:chat.sessionId, turn})
    return {ok:true, generation:reset.messages[messageIndex(reset,turn)]?.stageDirectionGeneration || 0, chat:reset}
  }
  async function preview(chat, turn) {
    const input = await prepare(chat,turn || latestTurn(chat))
    if (!input) return {status:'off'}
    const request = buildAssetPackRequest(input.prepared, true, undefined, '', true)
    return {...(input.judge ? {judge:input.judge} : {}),...(input.mods?.selection ? {modSelection:input.mods.selection} : {}),format:input.prepared.format, ...request, sections:nameModSections(request.sections, input.mods?.names), ...(request.commands ? {commands:nameModCommands(request.commands, input.mods?.names)} : {}), selection:input.prepared.selection, recall:input.prepared.context.catalogue.rows.filter(row => row.sent).map(row => ({ref:row.ref,reasons:row.reasons,consumer:row.consumer})), diagnostics:input.prepared.diagnostics}
  }
  async function drain() {await Promise.all([...streams.values()].map(job => job.pack?.kernel.drain())); await Promise.all([...tasks])}
  return {get, preview, retry, observe, drain, beginStream, activity, cancel,
    // Offline migrations use the same input assembler; never run an agent.
    async prepareSnapshot(chat,turn,{authorityOnly = false} = {}) { return (await prepare(chat,turn,{authorityOnly}))?.prepared },
    subscribe(fn) {listeners.add(fn); return () => listeners.delete(fn)},
    async generate(chat,turn,config) {const reset = await retry(chat,turn,{regenerate:true}); return get(reset.chat,turn,config,{generate:true})},
    dispose() {disposed = true; off(); invalidate(); listeners.clear(); versions.clear(); judgeResults.clear(); retryPreparations.clear(); historyCache.clear(); return drain()}}
}
