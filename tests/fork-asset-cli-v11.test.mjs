import {fixtureCli,fixtureImport} from './helpers/generated-image-fixture.mjs'
const rawRunCli=fixtureCli(generationFixtureRunCli)
const importImage=fixtureImport(generationFixtureImport)
// private fork: legacy projects carry explicit declaration fixtures.
import {declaredProduction,legacyFixtureCli,legacyFixtureInit} from './helpers/legacy-production-fixture.mjs'
const initProject=(root,input,...args)=>legacyFixtureInit(rawInitProject,root,input,...args)
const runCli=legacyFixtureCli(rawRunCli)
// private fork: v1.1 contracts and commands, entirely offline synthetic fixtures.
import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import os from 'node:os'
import {mkdtemp,mkdir,writeFile,readFile,readdir,stat} from 'node:fs/promises'
import {randomBytes} from 'node:crypto'
import {runCli as generationFixtureRunCli} from '../bin/dsh-assets.mjs'
import {syntheticImage,dryRun} from '../tools/dsh-assets/dry-run.mjs'
import {buildBoard} from '../tools/dsh-assets/board.mjs'
import {exchangePack,exchangeReceive,exchangeCleanup} from '../tools/dsh-assets/exchange.mjs'
import {buildReviewData,renderReview} from '../tools/dsh-assets/review-data.mjs'
import {installProduction,assertNoRemovedStates} from '../tools/dsh-assets/install.mjs'
import {importLegacy,legacyEmotion} from '../tools/dsh-assets/legacy.mjs'
import {validateProjectSchema,validateAgainst} from '../tavern-plugin/lib/domain/asset-production-schema.js'
import {loadProject,preparePrompt,importImage as generationFixtureImport,acceptProduction,initProject as rawInitProject,projectStatus,hash,transaction} from '../tavern-plugin/lib/domain/asset-production-project.js'
import {descendants} from '../tavern-plugin/lib/domain/asset-production-graph.js'
import {decodeAssetRgba} from '../tavern-plugin/lib/domain/asset-image-processing.js'
import schema from '../viewer/review-data.schema.json' with {type:'json'}
const temp=()=>mkdtemp(path.join(os.tmpdir(),'dsh-assets-v11-'))
const writeJson=(file,value)=>writeFile(file,JSON.stringify(value,null,2)+'\n')

test('project schema rejects bad versions, evidence, palette and ltrb confusion',async()=>{
  const root=await temp();await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']}]}]});const p=await loadProject(root)
  assert.equal(validateProjectSchema(p),p)
  for(const apply of [p=>p.schemaVersion=1,p=>p.revision=-1,p=>p.slots['hero/identity-settei'].palette=[{role:'base',zone:'skin',hex:'red'}],p=>p.slots['hero/identity-settei'].settei={blocks:[{source_id:'x',source_hash:'a'.repeat(64),crop_ltrb:[10,10,5,5],layout_xywh:[0,0,5,5],native_size:[20,20],reference_role:'eye',evidence_kind:'observed'}]}]){const bad=structuredClone(p);apply(bad);assert.throws(()=>validateProjectSchema(bad),{code:'INVALID_ARGUMENT'})}
})

test('identity gate, stale plans, idempotency and descendant invalidation preserve unrelated approval',async()=>{
  const root=await temp(),a=path.join(root,'a.png'),b=path.join(root,'b.png');await writeFile(a,syntheticImage());await writeFile(b,syntheticImage(128,192,{blink:true}))
  await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']},{key:'other',emotions:['calm']}]}]})
  await assert.rejects(preparePrompt(root,{slot:'hero/daily/settei'}),{code:'PRECONDITION'})
  const ingest=async slot=>{const plan=await preparePrompt(root,{slot});await importImage(root,{plan:plan.id,file:a});await acceptProduction(root,{slot,reviewer:'Synthetic test'});return plan}
  await ingest('hero/identity-settei');const daily=await ingest('hero/daily/settei');await ingest('hero/other/settei')
  const p=await loadProject(root),revision=p.revision;await importImage(root,{plan:daily.id,file:a});assert.equal((await loadProject(root)).revision,revision)
  const stale=await preparePrompt(root,{slot:'hero/daily/settei'}),fresh=await preparePrompt(root,{slot:'hero/daily/settei'})
  await importImage(root,{plan:fresh.id,file:b,replace:true});await assert.rejects(importImage(root,{plan:stale.id,file:a,replace:true}),{code:'CONFLICT'})
  const current=await loadProject(root);assert.equal(current.slots['hero/other/settei'].accepted,p.slots['hero/other/settei'].accepted)
  assert.ok(descendants(current,'hero/daily/settei').includes('hero/daily/blink/calm'));assert.ok(!descendants(current,'hero/daily/settei').includes('hero/other/settei'))
  const meta=path.join(root,'metadata.json');await writeJson(meta,{character_id:'hero',palette:[{role:'base',zone:'hair',hex:'#123456'}]})
  const args=['metadata','--project',root,'--slot','hero/identity-settei','--file',meta,'--expected-version','1'];const before=await readFile(path.join(root,'project.json'))
  await runCli([...args,'--dry-run']);assert.deepEqual(await readFile(path.join(root,'project.json')),before)
  await runCli(args);assert.equal((await loadProject(root)).slots['hero/other/settei'].stale,true)
  await assert.rejects(runCli(args),{code:'CONFLICT'})
  await acceptProduction(root,{slot:'hero/identity-settei',reviewer:'Synthetic test'})
  const ready=(await projectStatus(root)).nextActions;assert.ok(ready.some(a=>a.slot==='hero/daily/settei'&&a.action==='prompt'));assert.ok(ready.some(a=>a.slot==='hero/other/settei'&&a.action==='prompt'))
})

test('status nextActions advances independent ready slots across pagination without bypassing waits',async()=>{
  const root=await temp(),file=path.join(root,'source.png');await writeFile(file,syntheticImage())
  await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']},{key:'other',emotions:['calm']}]}],backgrounds:[{key:'room',prompt:'Empty room'}]})
  const initial=await projectStatus(root,{limit:1});assert.equal(initial.slots.length,1);assert.deepEqual(initial.nextActions.map(a=>a.slot),['hero/identity-settei','background/room'])
  const ingest=async slot=>{const plan=await preparePrompt(root,{slot});await importImage(root,{plan:plan.id,file});return plan}
  await ingest('hero/identity-settei');let status=await projectStatus(root);assert.deepEqual(status.nextActions.map(a=>a.slot),['background/room']);assert.ok(status.waiting.find(w=>w.slot==='hero/identity-settei').reasons.includes('HUMAN_APPROVAL_REQUIRED'))
  await acceptProduction(root,{slot:'hero/identity-settei',reviewer:'Synthetic test'});await ingest('hero/daily/settei');status=await projectStatus(root);assert.ok(status.nextActions.some(a=>a.slot==='hero/other/settei'));assert.ok(!status.nextActions.some(a=>a.slot.startsWith('hero/daily/')))
  await acceptProduction(root,{slot:'hero/daily/settei',reviewer:'Synthetic test'});const plan=await preparePrompt(root,{slot:'hero/daily/sprite/calm'});status=await projectStatus(root);assert.deepEqual(status.nextActions.find(a=>a.slot===plan.slot),{slot:plan.slot,kind:'sprite',action:'generate-or-import',planId:plan.id})
  await transaction(root,p=>{p.plans[plan.id].status='unknown'});const before=await readFile(path.join(root,'project.json'));status=await projectStatus(root);assert.deepEqual(await readFile(path.join(root,'project.json')),before);assert.ok(!status.nextActions.some(a=>a.slot===plan.slot));assert.equal(status.waiting.find(w=>w.slot===plan.slot).requests[0].id,plan.id);assert.ok(status.nextActions.some(a=>a.slot==='hero/other/settei'))
  await importImage(root,{plan:plan.id,file});status=await projectStatus(root);assert.equal(status.nextActions.find(a=>a.slot===plan.slot).action,'register');assert.ok(!status.nextActions.some(a=>a.kind==='blink'||a.kind==='mouth'))
  const filtered=await projectStatus(root,{slot:'hero/other/settei',offset:1,limit:1});assert.equal(filtered.slots.length,0);assert.equal(filtered.nextActions.length,1)
  const waitArgs=['wait','--project',root,'--slot','hero/other/settei','--waiting-on','tool:1.1.1','--note','Required import fix not shipped']
  await runCli(waitArgs);const revision=(await loadProject(root)).revision;await runCli(waitArgs);assert.equal((await loadProject(root)).revision,revision)
  status=await runCli(['status','--project',root,'--json']);assert.ok(!status.nextActions.some(a=>a.slot==='hero/other/settei'));assert.equal(status.waiting.find(w=>w.slot==='hero/other/settei').external.on,'tool:1.1.1');assert.ok(status.nextActions.some(a=>a.slot==='background/room'))
  await assert.rejects(preparePrompt(root,{slot:'hero/other/settei'}),{code:'PRECONDITION'})
  await runCli(['wait','--project',root,'--slot','hero/other/settei','--clear']);assert.ok((await projectStatus(root)).nextActions.some(a=>a.slot==='hero/other/settei'))
})

test('external project edits abort a transaction without losing the external change',async()=>{
  const root=await temp();await initProject(root,{characters:[]});const file=path.join(root,'project.json')
  await assert.rejects(transaction(root,async p=>{const external=structuredClone(p);external.name='External writer';await writeJson(file,external);p.name='Would overwrite'}),{code:'CONFLICT'})
  assert.equal((await loadProject(root)).name,'External writer')
})

test('refusal records only original facts; migration preserves old outfit acceptance',async()=>{
  const root=await temp();await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm']}]}]})
  const message=path.join(root,'message.txt');await writeFile(message,'Original tool refusal.\n')
  await runCli(['refused','--project',root,'--slot','hero/identity-settei','--file',message]);let p=await loadProject(root)
  assert.equal(p.generationLog[0].message,'Original tool refusal.\n');assert.equal((await projectStatus(root)).slots[0].state,'missing')
  p.schemaVersion=1;delete p.slots['hero/identity-settei'];p.slots['hero/daily/settei'].accepted='a'.repeat(64);await writeJson(path.join(root,'project.json'),p)
  const before=await readFile(path.join(root,'project.json'));await runCli(['migrate','--project',root,'--dry-run']);assert.deepEqual(await readFile(path.join(root,'project.json')),before)
  await runCli(['migrate','--project',root]);p=await loadProject(root);assert.equal(p.slots['hero/daily/settei'].accepted,'a'.repeat(64));assert.equal(p.slots['hero/identity-settei'].artifact,undefined)
  assert.equal((await runCli(['migrate','--project',root])).idempotent,true)
})

test('board crop, palette and reconstruction are deterministic; dry-run never writes',async()=>{
  const root=await temp(),bytes=syntheticImage(192,128,{opaque:true});await writeFile(path.join(root,'source.png'),bytes)
  const c={schema_version:1,canvas:[192,160],sources:[{source_id:'one',path:'source.png'}],blocks:[{source_id:'one',crop_ltrb:[8,8,24,24],layout_xywh:[0,0,16,16],reference_role:'eye',evidence_kind:'observed'}],palette:[{source_id:'one',sample_xy:[10,10],role:'base',zone:'hair',layout_xywh:[0,32,16,16],label_xy:[20,34]}]},config=path.join(root,'config.json');await writeJson(config,c)
  const preview=await buildBoard(root,{config,dryRun:true});assert.equal(preview.palette[0].hex,'#6E82B4');assert.deepEqual((await readdir(root)).sort(),['config.json','source.png'])
  const result=await buildBoard(root,{config});const board=await readFile(path.join(root,result.path));await buildBoard(root,{config});assert.deepEqual(await readFile(path.join(root,result.path)),board);assert.deepEqual(await readFile(path.join(root,'source.png')),bytes)
  const rebuilt=await buildBoard(root,{config:path.join(root,result.path+'.json'),out:'boards/rebuilt.png'});assert.deepEqual(await readFile(path.join(root,rebuilt.path)),board)
  await assert.rejects(buildBoard(root,{config,out:'source.png'}),{code:'INVALID_ARGUMENT'})
  const image=decodeAssetRgba(board);assert.deepEqual([...image.data.subarray(0,4)],[108,128,180,255])
  c.blocks[0].layout_xywh=[0,0,32,32];await writeJson(config,c);await assert.rejects(buildBoard(root,{config}),{code:'INVALID_ARGUMENT'})
  c.blocks[0].resize='nearest';c.blocks[0].crop_ltrb=[24,24,8,8];await writeJson(config,c);await assert.rejects(buildBoard(root,{config}),{code:'INVALID_ARGUMENT'})
})

test('review-data schema and opaque injection keep native paths, statuses and source-over semantics',async()=>{
  const root=path.join(await temp(),'project');await dryRun(root);const p=await loadProject(root);p.name='</script><script>bad</script> $&'
  const data=buildReviewData(p);assert.equal(validateAgainst(data,schema),data)
  assert.equal(data.characters[0].outfits[0].states[0].mouth.composite,'source-over-native-then-scale')
  const {html}=await renderReview(root,p);assert.ok(html.includes('id="dsh-review-data"'));assert.ok(!html.includes('<script>bad</script>'));assert.ok(!html.includes('data:image'));assert.ok(html.includes('$\\u0026'));assert.ok(!html.includes('__DSH_REVIEW_DATA__'))
  const missing=p.slots['fixture/daily/avatar/sad'];missing.artifact.path='images/missing.png'
  const rendered=await renderReview(root,p);assert.equal(rendered.data.characters[0].outfits[0].states[1].avatar.status,'missing');assert.equal(rendered.data.characters[0].outfits[0].states[1].avatar.image,undefined)
  const invalid=structuredClone(data);invalid.characters[0].outfits[0].states[0].sprite.status='success';assert.throws(()=>validateAgainst(invalid,schema))
})

test('765 adapter retains real six vowel frames, source names and explicit native rects',async()=>{
  const root=await temp(),src=path.join(root,'src');await mkdir(src);const sprite='sadness.png';await writeFile(path.join(src,sprite),syntheticImage())
  const frames=[];for(const [i,shape]of ['closed','A','I','U','E','O'].entries()){const patch=shape+'.png';await writeFile(path.join(src,patch),syntheticImage(8,8,{opaque:true,shift:i}));frames.push({shape,patch,rect:[50,50,8,8]})}
  const file=path.join(root,'mouth-manifest.json');await writeJson(file,[{sprite,frames}]);const result=await importLegacy(root,{file,sourceRoot:src,sprite})
  assert.equal(result.frames,6);assert.equal(result.sourceState,'sadness');assert.equal(result.emotion,'sad');assert.equal(legacyEmotion('nervous'),'anxious');assert.equal(result.sprite.kind,'layered-static-sprites');assert.deepEqual(Object.keys(result.sprite.emotions.sad.mouthFrames),['closed','a','i','u','e','o'])
  assert.deepEqual(await readFile(path.join(root,'legacy/sample/A.png')),await readFile(path.join(src,'A.png')))
  frames.pop();await writeJson(file,[{sprite,frames}]);const partial=await importLegacy(root,{file,sourceRoot:src,sprite,dryRun:true});assert.deepEqual(partial.missing,['o'])
  frames[0].rect=[50,50,58,58];await writeJson(file,[{sprite,frames}]);await assert.rejects(importLegacy(root,{file,sourceRoot:src,sprite,dryRun:true}),{code:'INVALID_ARGUMENT'})
})

test('exchange full and delta verify one checksum, preserve IDs and resolve explicit base version',async()=>{
  const root=await temp(),out=path.join(root,'transport'),received=path.join(root,'received'),spec=path.join(root,'spec.json');await writeFile(path.join(root,'one.txt'),'one');await writeJson(spec,{version:'v1',files:[{id:'stable-one',path:'one.txt'}],notes:'test'})
  const preview=await exchangePack(root,{manifest:spec,out,dryRun:true});assert.equal(preview.dryRun,true);await assert.rejects(stat(out),{code:'ENOENT'})
  const pack=await exchangePack(root,{manifest:spec,out});const m=JSON.parse(await readFile(pack.manifest));assert.equal(m.files[0].sha256,undefined);assert.equal(m.zip.sha256,hash(await readFile(pack.zip)))
  const first=await exchangeReceive({manifest:pack.manifest,out:received});assert.equal(await readFile(path.join(first.destination,'one.txt'),'utf8'),'one')
  await writeFile(path.join(root,'two.txt'),'two');await writeJson(spec,{version:'v2',base_version:'v1',files:[{id:'stable-one',path:'one.txt',size:3,base_version:'v1'},{id:'stable-two',path:'two.txt'}]});const delta=await exchangePack(root,{manifest:spec,out});await assert.rejects(exchangeReceive({manifest:delta.manifest,out:received}),{code:'INVALID_ARGUMENT'})
  const second=await exchangeReceive({manifest:delta.manifest,out:received,baseFolder:first.destination});assert.equal(await readFile(path.join(second.destination,'one.txt'),'utf8'),'one');assert.equal(await readFile(path.join(second.destination,'two.txt'),'utf8'),'two')
  await assert.rejects(exchangeReceive({manifest:delta.manifest,out:received,baseFolder:first.destination}),{code:'CONFLICT'})
})

test('exchange split volumes are ordered, below 35 MiB, and verified only after reassembly',async()=>{
  const root=await temp(),spec=path.join(root,'spec.json'),bytes=randomBytes(35*1024**2);await writeFile(path.join(root,'payload.png'),bytes);await writeJson(spec,{version:'large',files:[{id:'payload',path:'payload.png'}]})
  const pack=await exchangePack(root,{manifest:spec,out:path.join(root,'out')}),m=JSON.parse(await readFile(pack.manifest));assert.equal(m.volumes.length,2);assert.ok(m.volumes.every(v=>v.size<35*1024**2&&!Object.hasOwn(v,'sha256')))
  const receipt=await exchangeReceive({manifest:pack.manifest,out:path.join(root,'received')});assert.deepEqual(await readFile(path.join(receipt.destination,'payload.png')),bytes)
  m.volumes.reverse();const bad=path.join(root,'out','bad.json');await writeJson(bad,m);await assert.rejects(exchangeReceive({manifest:bad,out:path.join(root,'other')}),{code:'INVALID_ARGUMENT'})
})

test('cleanup only touches explicitly ACKed files in two allowed folders',async()=>{
  if(process.platform!=='win32')return
  const root=await temp(),nas=path.join(root,'nas'),ackLog=path.join(root,'acks.json');await mkdir(path.join(nas,'to-dot'),{recursive:true});await writeFile(path.join(nas,'to-dot/dsh-exchange-v1.zip'),'zip');await writeFile(path.join(nas,'to-dot/unrelated.txt'),'keep')
  await writeJson(ackLog,{schema_version:1,acks:[{version:'v1',direction:'to-dot',acknowledged_at:'2026-10-10T00:00:00Z',thread_ack:'Owner acknowledged receipt',files:[{path:'dsh-exchange-v1.zip',size:3}]}]})
  assert.equal((await exchangeCleanup({nasRoot:nas,ackLog,dryRun:true},nas)).deleted,0);assert.equal((await exchangeCleanup({nasRoot:nas,ackLog},nas)).deleted,1);assert.equal(await readFile(path.join(nas,'to-dot/unrelated.txt'),'utf8'),'keep')
  await assert.rejects(exchangeCleanup({nasRoot:root,ackLog},nas),{code:'INVALID_ARGUMENT'})
})

test('native install checks explicit CAS, current export and retains local extra states',async()=>{
  const root=path.join(await temp(),'project');await dryRun(root);const library=path.join(root,'new-library')
  assert.equal((await installProduction(root,{library,expectedRevision:'null',dryRun:true})).dryRun,true);await assert.rejects(stat(library),{code:'ENOENT'})
  await assert.rejects(installProduction(root,{library,expectedRevision:'null'}),{code:'CONFLICT'})
  const result=await installProduction(root,{library,expectedRevision:'null',confirm:true});assert.equal(result.status,'installed')
  await assert.rejects(installProduction(root,{library,expectedRevision:'null',confirm:true}),{code:'CONFLICT'})
  assert.equal((await installProduction(root,{library,expectedRevision:result.revision,confirm:true})).status,'noop')
  const current={manifest:{assets:[]},figures:{hero:{outfits:[{key:'daily',sprite:{manifestKey:'daily'}}]}},sprites:{daily:{states:[{id:'calm'},{id:'local-fill'}]}}},incoming=structuredClone(current);incoming.sprites.daily.states.pop();assert.throws(()=>assertNoRemovedStates(current,incoming),{code:'CONFLICT'})
})

test('incremental merge rejects stale overwrite and never erases unlisted slots',async()=>{
  const root=await temp();await initProject(root,{characters:[{key:'hero',outfits:[{key:'daily',emotions:['calm','sad']}]}]});const p=await loadProject(root),slot='hero/daily/sprite/calm',value={...p.slots[slot],version:1,provenance:{source_state_id:'calm'}};const file=path.join(root,'delta.json');await writeJson(file,{schema_version:1,project_id:p.id,updates:[{slot,expected_version:0,value}]})
  const args=['merge','--project',root,'--file',file,'--source-root',root];await runCli([...args,'--dry-run']);assert.equal((await loadProject(root)).slots[slot].version,undefined)
  await runCli(args);assert.equal(Object.keys((await loadProject(root)).slots).length,Object.keys(p.slots).length);assert.equal((await runCli(args)).idempotent,true)
  value.version=2;await writeJson(file,{schema_version:1,project_id:p.id,updates:[{slot,expected_version:0,value}]});await assert.rejects(runCli(args),{code:'CONFLICT'})
})
