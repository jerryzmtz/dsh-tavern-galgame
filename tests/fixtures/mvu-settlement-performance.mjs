// Production effect/projection seams with synthetic data; excludes model, official MVU parsing and disk I/O.
import { performance } from 'node:perf_hooks'
import { writeFile, mkdir } from 'node:fs/promises'
import { createMvuSettlementEffect, applyMvuSettlementEffect } from '../../tavern-plugin/lib/domain/mvu-settlement-effect.js'
import { projectTavernHelperContext } from '../../tavern-plugin/lib/domain/tavern-helper-context.js'
const rows = []
for (const rounds of [20, 80, 200]) for (const stateKiB of [4, 16, 64, 256]) {
  const before = { id: 'fixture', sessionId: 'fixture', messages: Array.from({length: rounds * 2}, (_, i) => ({role:i%2?'assistant':'user',text:'虚构正文。'.repeat(200),variables: i%2 ? [{stat_data:{value:0,fixture:'测'.repeat(Math.floor(stateKiB*1024/3))}}] : []})) }
  const after = structuredClone(before); after.messages.at(-1).variables[0].stat_data.value = 1
  const samples = []
  for (let run=0;run<4;run++) {
    const current = structuredClone(before)
    const start = performance.now()
    const effect = createMvuSettlementEffect({before,after,operationId:'probe',chatId:'fixture',sessionId:'fixture',messageId:before.messages.length-1,swipeId:0})
    const diffEnd = performance.now()
    applyMvuSettlementEffect(current,effect)
    const applyEnd = performance.now()
    const projection=projectTavernHelperContext(current)
    const projectEnd = performance.now()
    const json=JSON.stringify(projection)
    const end = performance.now()
    if(current.messages.at(-1).variables[0].stat_data.value!==1)throw Error('effect failed')
    samples.push({effectDiffMs:diffEnd-start,effectApplyMs:applyEnd-diffEnd,projectionMs:projectEnd-applyEnd,jsonMs:end-projectEnd,bytes:Buffer.byteLength(json)})
  }
  const median=key=>+samples.slice(1).map(s=>s[key]).sort((a,b)=>a-b)[1].toFixed(1)
  rows.push({rounds,stateKiB,effectDiffMs:median('effectDiffMs'),effectApplyMs:median('effectApplyMs'),projectionMs:median('projectionMs'),jsonMs:median('jsonMs')})
}
await mkdir(new URL('../../output/mvu-performance/',import.meta.url),{recursive:true})
await writeFile(new URL('../../output/mvu-performance/settlement.json',import.meta.url),JSON.stringify(rows,null,2))
console.log(JSON.stringify(rows,null,2))
