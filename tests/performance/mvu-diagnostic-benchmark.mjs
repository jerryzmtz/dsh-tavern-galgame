import {mkdtemp,rm,mkdir,writeFile,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {createProfileDataStore} from '../../tavern-plugin/lib/profile-data-store.js'
import {createMvuDiagnosticStore} from '../../tavern-plugin/lib/domain/mvu-diagnostics.js'
const output=resolve(process.argv[2]||'output/mvu-diagnostics/run.json')
const root=await mkdtemp(join(tmpdir(),'mvu-diagnostic-bench-'))
try{
 const storage=createProfileDataStore({dataRoot:root})
 const relative='diagnostics/mvu-'+createHash('sha256').update('s').digest('hex')+'.json'
 await storage.writeJson(relative,{version:1,sessionId:'s',dropped:0,records:Array.from({length:180},(_,n)=>({stage:'benchmark',n,message:'x'.repeat(8000)}))})
 let writes=0
 const store=createMvuDiagnosticStore({...storage,appendText(...args){writes++;return storage.appendText(...args)}},process.argv.includes('--immediate')?{flushDelayMs:0}:{}),samples=[]
 const warmupStart=performance.now();await store.record('s',{stage:'benchmark',n:180,message:'x'.repeat(8000)});await store.flush();const migrationMs=performance.now()-warmupStart
 const startBytes=(await stat(join(root,relative+'l'))).size;writes=0
 for(let n=1;n<11;n++){const start=performance.now();await store.record('s',{stage:'benchmark',n:180+n,message:'x'.repeat(8000)});samples.push(performance.now()-start)}
 const flushStart=performance.now();await store.flush();const flushMs=performance.now()-flushStart
 await store.dispose()
 const result={node:process.version,platform:process.platform,seedRecords:180,recordPayloadBytes:8000,warmup:1,mode:process.argv.includes('--immediate')?'immediate':'buffered',migrationMs,flushMs,writes,appendedBytes:(await stat(join(root,relative+'l'))).size-startBytes,samples,medianMs:samples.slice().sort((a,b)=>a-b)[5],retained:(await store.read('s')).records.length,legacyBytes:(await stat(join(root,relative))).size,journalBytes:await stat(join(root,relative+'l')).then(s=>s.size,()=>null)}
 await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
}finally{await rm(root,{recursive:true,force:true})}
