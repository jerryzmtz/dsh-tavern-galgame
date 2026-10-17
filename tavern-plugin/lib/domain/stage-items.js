// private fork: item facts are pinned in the director binding and published only by commit seams.
import {analyzeVariableSchema,resolveSlot} from './variable-bindings/index.js'
import {itemVariableProvider} from './item-variable-provider.js'
import {projectItems,diffItems,bindChange,bindShow,validateItemPlay} from './item-binding.js'
import {cardItemWidget} from './item-widget.js'
import {verifiedWidgetSnapshot} from './widget-variable-transaction.js'

const extension = raw => (raw?.data || raw)?.extensions?.dsh_tavern
export function prepareStageItems(raw,chat,index = chat.messages.length,snapshots=[],globalEnabledPackIds=[]) {
  const ext = extension(raw), widget = cardItemWidget(raw,snapshots,globalEnabledPackIds)
  if (!widget.enabled) return undefined
  const previous = chat.messages.slice(0,index).findLast(message => message.role === 'assistant' && verifiedWidgetSnapshot(chat,message))
  const variables = previous?.variables?.[previous.swipeId || 0]?.stat_data
  const slot = itemVariableProvider.slots({itemsEnabled:true})[0]
  const resolved = resolveSlot(slot,ext.variableBindings,analyzeVariableSchema(raw),{mvu:{available:variables !== undefined,value:variables}})
  const mapping = {scopeKey:resolved.variable?.path || 'inventory',ownerMapped:!!resolved.variable?.fields?.owner}
  const mappingKey = JSON.stringify(resolved.variable || null)
  const inventory = projectItems({committed:!!previous,complete:!!previous,revision:chat._storageRevision,mappingKey},resolved,mapping)
  const owners = [...new Set(inventory.items.map(item => item.ownerKey))]
  const scope = {scopeKey:mapping.scopeKey,ownerKey:owners.length === 1 ? owners[0] : null}
  return {enabled:true,s4:widget.s4,inventory,scope,mapping,variable:resolved.variable ?? null,source:resolved.source ?? null}
}
export function validateStageItem(op,context,at) {
  const checked = validateItemPlay(op,context.phone.units.map((_,index) => index+1))
  const result = !checked.ok ? checked : op.at !== at ? {ok:false,error:{code:'INVALID_ANCHOR',message:'item.at must equal beat.at',retryable:true}}
    : op.action === 'show' ? bindShow(op,context.items.inventory,context.items.scope) : {ok:true}
  if (!result.ok) throw Object.assign(new Error(result.error.message),{code:result.error.code,path:'$.name',itemError:result.error})
}

/** Called inside the existing atomic director/MVU commit. Never reads mutable latest state. */
export function invalidateStageItems(message,reason='CORRECTED') {
  for(const row of message.stageItems?.records || []) if(['READY','HELD'].includes(row.status)) {
    row.status=row.status==='READY' ? 'CORRECTED' : 'REFUSED';row.reason=reason
  }
}
export function finalizeStageItems(chat,index,now=Date.now()) {
  const message = chat.messages[index], record = message?.stageDirectionAssetPacks, input = record?.binding?.items
  if (!input || message.stageItems?.directionDigest === record.digest && !message.stageItems.records.some(row => row.status === 'HELD')) return
  const intents = record.entries.flatMap(entry => entry.ops.filter(op => op.op === 'item.play'))
  const pending = message.mvu?.pending || !message.mvu?.receipt
  const settled = !pending && ['updated','unchanged'].includes(message.mvu.receipt.status)
  const snapshot = value => resolveSlot(itemVariableProvider.slots()[0],{entries:input.variable ? [{target:{kind:'items',slot:'inventory'},variable:input.variable}] : []},[],{mvu:{available:value !== undefined,value}})
  const beforeValues = message.mvuBaseline?.swipeId === (message.swipeId || 0) ? message.mvuBaseline.variables?.stat_data : undefined
  const before = projectItems({committed:true,complete:beforeValues !== undefined,revision:input.inventory.revision,mappingKey:input.inventory.mappingKey},snapshot(beforeValues),input.mapping)
  const after = projectItems({committed:settled,complete:settled,revision:chat._storageRevision+1,previousRevision:before.revision,mappingKey:before.mappingKey},snapshot(message.variables?.[message.swipeId || 0]?.stat_data),input.mapping)
  const diff = JSON.stringify(before.items) === JSON.stringify(input.inventory.items) && before.complete === input.inventory.complete
    ? diffItems(before,after) : {ok:false,error:{code:'BASELINE_CHANGED'}}
  const facts = new Set()
  const expiresAt = message.stageItems?.directionDigest === record.digest ? message.stageItems.expiresAt : now+60000
  const records = intents.map((op,ordinal) => {
    const intentId = JSON.stringify([record.binding.target.sourceKey,record.binding.generation,ordinal])
    if (op.action !== 'show' && now >= expiresAt) return {intentId,op,status:'REFUSED',bound:null,reason:'SETTLEMENT_TIMEOUT'}
    if (pending && op.action !== 'show') return {intentId,op,status:'HELD',bound:null,reason:null}
    const result = op.action === 'show' ? bindShow(op,input.inventory,input.scope) : diff.ok ? bindChange(op,diff,input.scope) : diff
    const fact = result.ok && op.action !== 'show' ? JSON.stringify([result.item.itemKey,op.action]) : null
    const duplicate = fact && facts.has(fact)
    if (fact) facts.add(fact)
    return {intentId,op,
      status:!result.ok ? 'REFUSED' : duplicate ? 'DUPLICATE' : 'READY',bound:result.ok ? result : null,
      reason:result.error?.code || (duplicate ? 'FACT_ALREADY_BOUND' : null)}
  })
  message.stageItems = {version:1,expiresAt,directionDigest:record.digest,sourceKey:record.binding.target.sourceKey,generation:record.binding.generation,records}
}
