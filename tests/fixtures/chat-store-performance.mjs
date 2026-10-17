// Manual synthetic long-chat benchmark; reports milliseconds, not reporter CPU impact.
import {createChatJournalStore} from '../../tavern-plugin/lib/domain/chat-journal-store.js'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
const root=await mkdtemp(join(tmpdir(),'issue109-bench-'))
try{
 const store=createChatJournalStore({dataRoot:root})
 const chat={id:'large',mode:'story',_storageRevision:1,messages:Array.from({length:463},(_,i)=>({role:'assistant',turn:i+1,text:'剧情'.repeat(1000),variables:[{stat_data:Object.fromEntries(Array.from({length:100},(_,j)=>['字段'+j,{value:'状态'.repeat(30),count:j}]))}]}))}
 await store.update('large',()=>chat)
 const result={bytes:Buffer.byteLength(JSON.stringify(chat))}
 for(const [name,run] of Object.entries({read:()=>store.read('large'),cancelledUpdate:()=>store.update('large',()=>undefined),scene:()=>store.readSceneImageState('large'),coldProjection:()=>createChatJournalStore({dataRoot:root}).readSlice('large',[])})){
  const times=[];for(let i=0;i<6;i++){const t=performance.now();await run();times.push(performance.now()-t)}
  result[name]=Math.round(times.slice(1).sort((a,b)=>a-b)[2]*10)/10
 }
 console.log(JSON.stringify(result))
}finally{await rm(root,{recursive:true,force:true})}
