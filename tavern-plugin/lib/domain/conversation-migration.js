// Long conversions run outside the HTTP request lifetime. The store owns the
// cross-process write lock and atomic cutover; UI state never owns authority.
export function createConversationMigration({store,assertIdle=()=>{},notify=()=>{}}){
 const jobs=new Map(),pending=new Set()
 async function status(id){
  const version=await store.version(id)
  if(!version)throw Error('找不到当前存档')
  const format=version.startsWith('native:')?'native':'legacy'
  return {format,...(jobs.get(id)||{phase:'idle'}),...(format==='native'?{phase:'completed',stage:'completed',error:undefined}:{})}
 }
 function start(id){
  if(jobs.get(id)?.phase==='running')return {phase:'running'}
  for(const [key,job] of jobs)if(jobs.size>=128&&job.phase!=='running')jobs.delete(key)
  const job={phase:'running',stage:'reading',startedAt:Date.now()}
  jobs.set(id,job)
  const task=(async()=>{
   try{
    const result=await store.migrateNative(id,{assertCanMigrate:assertIdle,onProgress:stage=>{job.stage=stage}})
    if(result.status!=='native')throw Error('找不到可迁移的存档')
    Object.assign(job,{phase:'completed',stage:'completed',elapsedMs:Date.now()-job.startedAt})
    notify(id)
   }catch(error){Object.assign(job,{phase:'failed',error:String(error.message||error)})}
  })()
  pending.add(task);task.finally(()=>pending.delete(task))
  return {phase:'running'}
 }
 return {status,start,dispose:()=>Promise.allSettled([...pending])}
}
