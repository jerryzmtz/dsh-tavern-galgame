// Test-only deterministic LLM boundary. All sessions, tools, HTTP, and persistence are production DSH/Tavern.
import { appendFile, readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
const { LlmAdapter, LlmError, resolveRetryPolicy }=await import(pathToFileURL(process.env.TAVERN_E2E_LLM_MODULE))
export const inject=['llm','sessionController','tavernSessionSignals']
const wait=ms=>new Promise(r=>setTimeout(r,ms))
export async function apply(ctx){
 class Model extends LlmAdapter{
  providerRetryPolicy(){return resolveRetryPolicy({mode:'normal',maxRetries:0},'native-stage-fixture')}
  async resolveModel(provider,id){return {provider,id,name:'Native deterministic validation',context:{contextWindow:128000}}}
  async *stream(input){
   const names=(input.tools||[]).map(x=>x.name), role=names.includes('stage_update')?'director':names.includes('posture_submit')?'settlement':'foreground'
   await appendFile(process.env.NATIVE_AUDIT,JSON.stringify({at:Date.now(),role,input})+'\n')
   const latestPrompt=input.messages.findLastIndex(m=>m.role==='user'&&(m.content||[]).some(b=>b.type==='text'))
   const content=input.messages.flatMap(m=>m.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('\n'), done=new Set(input.messages.slice(latestPrompt+1).flatMap(m=>m.content||[]).filter(b=>b.type==='tool-result').map(b=>b.toolCallId))
   let blocks=[]
   if(role==='director'){
    const tool=input.tools.find(x=>x.name==='stage_update');const units=tool.parameters?.properties?.through?.maximum||2
    if(!done.has('native-stage-1')&&!content.includes('"nextSequence":2'))blocks=[{type:'tool-call',id:'native-stage-1',name:'stage_update',arguments:JSON.stringify({sequence:1,through:1,done:units===1,beats:[{at:1,ops:[{op:'actor.enter',actor:'alice'}]}]})}]
    else {while(JSON.parse(await readFile(process.env.NATIVE_CONTROL,'utf8')).holdDirector)await wait(50);if(JSON.parse(await readFile(process.env.NATIVE_CONTROL,'utf8')).failDirectorAfterPrefix)throw new LlmError('Synthetic HTTP 429: quota_exceeded','QUOTA',{status:429});blocks=[{type:'tool-call',id:'native-stage-2',name:'stage_update',arguments:JSON.stringify({sequence:2,through:units,done:true,beats:[{at:units,ops:[{op:'stage.patch',value:{weather:'rain'}}]}]})}]}
   }else if(role==='settlement'){
    while(JSON.parse(await readFile(process.env.NATIVE_CONTROL,'utf8')).holdSettlement)await wait(50)
    if(!done.has('native-posture'))blocks=[{type:'tool-call',id:'native-posture',name:'posture_submit',arguments:JSON.stringify({posture:'NATIVE_POSTURE_SENTINEL。站在窗边。'})}]
    else blocks=[{type:'text',text:'状态结算完成。'}]
   }else blocks=[{type:'text',text:'第一段测试正文。Alice 走进屋内。\n\n第二段测试正文。窗外下起了雨。'}]
   for(const [index,block]of blocks.entries()){yield {type:'block-start',index,blockType:block.type};yield {type:'block-end',index,block}}
   yield {type:'finish',reason:{kind:blocks.some(x=>x.type==='tool-call')?'tool-calls':'stop'}}
  }
 }
 ctx.llm.registerAdapter(['tavern-e2e'],new Model())
 // Same native activation used when a browser reopens the saved conversation.
 if(process.env.NATIVE_RESUME_SESSION){
  const result=await ctx.sessionController.resolveAgent(process.env.NATIVE_RESUME_SESSION)
  if(result.error)throw result.error
 }
}
