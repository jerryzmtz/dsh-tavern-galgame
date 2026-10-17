// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {createDirectorHandles} from '../tavern-plugin/lib/domain/stage-director-handles.js'
import {fixture as hostFixture} from './helpers/stage-director-harness.mjs'
import {directorPromptData} from './fixtures/asset-packs/prompt.mjs'
import {createFirstPartyMods} from '../tavern-plugin/lib/fork-mod-builtins.js'
import {compileModPrompts} from '../tavern-plugin/lib/domain/mods/prompts.js'

const phone=JSON.parse(await readFile(new URL('../fork/mods/phone/manifest.json',import.meta.url),'utf8'))
const textcard=JSON.parse(await readFile(new URL('../fork/mods/textcard/manifest.json',import.meta.url),'utf8'))
const schemaCommands=[phone,textcard].flatMap(mod=>mod.commands.map(command=>({...command,modId:mod.id})))
const phoneMark=schemaCommands.find(command=>command.id==='mark')
const selected=choices=>({...structuredClone(phoneMark),params:{...phoneMark.params,properties:{...phoneMark.params.properties,contact:{type:'string',enum:choices}}}})
const mods=commands=>({revision:'installed-1',commands,schemaCommands})
const batch=ops=>({sequence:1,through:8,done:true,beats:[{at:1,ops}]})

test('final provider tools are byte-identical across turns, chats, gates and candidate changes',async()=>{
  const f=await performanceFixture()
  const first=f.prepare({mods:mods([selected(['paper-one'])])})
  const second=f.prepare({mods:mods([]),units:Array(8).fill('A different scene'),target:{turn:2,sourceKey:'other-turn',branchId:'b',revision:2}})
  const third=f.prepare({mods:mods([selected(['paper-two','paper-three'])]),units:Array(8).fill('A different chat'),target:{turn:1,sourceKey:'other-chat',branchId:'elsewhere',revision:1},engine:{dimensions:{scene:false,camera:false}}})
  for (const incremental of [true,false]) {
    const requests=[first,second,third].map(prepared=>buildAssetPackRequest(prepared,incremental))
    assert.equal(JSON.stringify(requests[0].tools),JSON.stringify(requests[1].tools))
    assert.equal(JSON.stringify(requests[0].tools),JSON.stringify(requests[2].tools))
    assert.match(JSON.stringify(requests[0].tools),/mod\.dsh\.phone\.mark/)
    assert.doesNotMatch(JSON.stringify(requests[0].tools),/paper-one|paper-two|paper-three|~[a-z0-9]+/)
    assert.notEqual(JSON.stringify(requests[0].messages),JSON.stringify(requests[1].messages))
  }
})

test('native boundary reports current candidates and rejects JSON and DSL calls to gated mods',async()=>{
  const f=await performanceFixture(),p=f.prepare({mods:mods([selected(['paper-two','paper-three'])])}),h=createDirectorHandles(p.context)
  const id=Object.keys(p.context.actors)[0]
  for (const [op,path,choices] of [
    [{op:'scene.set',background:'missing',time:null},'.background',p.context.catalogue.candidates.backgrounds.map(row=>h.ref(row.ref))],
    [{op:'cast.add',actor:'missing'},'.actor',h.actors.map(row=>row.id)],
    [{op:'actor.outfit.set',actor:h.actor(id),outfit:'missing'},'.outfit',p.context.actors[id].outfits.map(row=>h.outfit(id,row.key))],
    [{op:phoneMark.op,contact:'paper-one',side:'in',form:'text'},'.contact',['paper-two','paper-three']]
  ]) {
    const result=f.transaction(p).submitModel(batch([op]))
    assert.equal(result.ok,false)
    assert.ok(result.errors[0].path.endsWith(path))
    assert.deepEqual([...result.errors[0].choices].sort(),[...choices].sort())
    assert.equal(result.errors[0].retryable,true)
  }
  const gated=f.prepare({mods:mods([])})
  for (const op of [{op:phoneMark.op,contact:'paper-two',side:'in',form:'text'},'phone-mark mark contact="paper-two" side=in form=text',{op:'text.show',style:'narrator',text:['No gate']},'text show style="narrator" text=["No gate"]']) {
    const result=f.transaction(gated).submitModel(batch([op]))
    assert.equal(result.ok,false)
    assert.equal(result.errors[0].code,'NOT_FOUND')
    assert.match(result.errors[0].message,/not admitted this turn/)
    assert.equal(result.errors[0].retryable,true)
    assert.ok(result.errors[0].choices.length)
    assert.equal(result.accepted,0)
  }
})

test('streaming with mods disabled retains the same installed-mod tools as post-commit preview',async t=>{
  const h=await hostFixture(async request=>{
    const data=directorPromptData(request)
    await request.onToolCall({name:'stage_update',arguments:{sequence:1,through:data.reply.at(-1).at,done:true,beats:[]}})
  },{mods:{observe(){},enabled:async()=>false,prepare:async()=>mods([])}})
  t.after(()=>h.dispose())
  const preview=await h.director.preview(h.read(),1)
  h.beginReply(2)
  const stream=await h.director.beginStream(h.read(),2)
  stream.update(Array.from({length:7},(_,i)=>'Paragraph '+i+'.').join('\n\n'))
  await h.director.drain()
  assert.equal(h.calls.length,1)
  assert.deepEqual(h.calls[0].tools,preview.tools)
  assert.match(JSON.stringify(h.calls[0].tools),/text\.show/)
})

test('stable global and gated framework prefixes precede candidate data and final story',async()=>{
  const f=await performanceFixture(),fragment={modId:phone.id,id:'rule',type:'prompt',source:'test',placement:{section:'director.rules.presentation',order:0},text:'TURN_SELECTED_MOD_GUIDANCE'}
  const a=buildAssetPackRequest(f.prepare({mods:mods([])}),true,undefined,'',true)
  const b=buildAssetPackRequest(f.prepare({mods:mods([selected(['paper-two'])]),modPrompts:[fragment],units:Array(8).fill('TURN_STORY_LAST')}),true,undefined,'',true)
  assert.equal(a.system,b.system)
  assert.deepEqual(a.tools,b.tools)
  assert.ok(b.system.indexOf('<director_role>')===0 && b.system.indexOf('<director_role>')<b.system.indexOf('<stage_assets>\n'))
  assert.doesNotMatch(b.system,/TURN_SELECTED_MOD_GUIDANCE|TURN_STORY_LAST|"allowedCommands":/)
  const parts=b.messages[0].content.map(part=>part.text)
  assert.ok(JSON.parse(parts[1]).allowedCommands.includes(phoneMark.op))
  assert.match(parts[0],/TURN_SELECTED_MOD_GUIDANCE/)
  assert.match(parts.at(-1),/TURN_STORY_LAST/)
  const mod=b.sections.find(section=>section.source.kind==='mod')
  assert.equal(Buffer.from(parts[0]).subarray(mod.offset,mod.offset+mod.bytes).toString(),fragment.text)
  const wire=JSON.stringify({system:b.system,messages:b.messages,tools:b.tools})
  assert.equal(b.inputBytes,Buffer.byteLength(wire))
})


test('selected first-party examples form a stable module prefix; excluded modules add no prose or schema bytes',async t=>{
  const builtins=await createFirstPartyMods(),f=await performanceFixture()
  const manifests=['dsh.items','dsh.phone','dsh.textcard'].map(id=>builtins.manifest(id))
  const schemaCommands=manifests.flatMap(mod=>mod.commands.map(command=>({...command,modId:mod.id})))
  const request=(active,units=Array(8).fill('First story'))=>{
    const commands=schemaCommands.filter(row=>active.includes(row.modId))
    const modPrompts=compileModPrompts(manifests.filter(row=>active.includes(row.id)),(id,path)=>builtins.file(id,path).toString('utf8'),'director',commands)
    return buildAssetPackRequest(f.prepare({mods:{revision:'1',commands,schemaCommands},modPrompts,units}),true,undefined,'',true)
  }
  const off=request([]),on=request(manifests.map(row=>row.id)),next=request(manifests.map(row=>row.id),Array(8).fill('Different story'))
  assert.equal(on.system,off.system)
  assert.equal(on.system,next.system)
  assert.equal(JSON.stringify(on.tools),JSON.stringify(off.tools))
  assert.equal(JSON.stringify(on.tools),JSON.stringify(next.tools))
  assert.equal(on.messages[0].content[0].text,next.messages[0].content[0].text)
  assert.ok(on.messages[0].content[0].text.includes('title: chapters. sequence: echoes or colour signals.'))
  for(const mod of manifests) {
    const absent=request(manifests.filter(row=>row.id!==mod.id).map(row=>row.id))
    assert.ok(!absent.sections.some(section=>section.source.modId===mod.id))
  }
  const sections=on.sections.filter(section=>section.source.kind==='mod').map(section=>({key:section.key,bytes:Buffer.byteLength(section.text)}))
  t.diagnostic(JSON.stringify({sections,toolSchemaBytes:Buffer.byteLength(JSON.stringify(on.tools[0].parameters)),toolBytes:Buffer.byteLength(JSON.stringify(on.tools)),systemBytes:Buffer.byteLength(on.system)}))
})

test('installed core grammar survives replacements and repairs explicitly select admitted routes',async()=>{
  const f=await performanceFixture()
  const commands=['one','two'].map(id=>({modId:'fixture.'+id,id:'title',op:'mod.fixture.'+id+'.title',mode:'replaces',replaces:'title.play',paramsStyle:'flat',params:{type:'object',properties:{text:{type:'string',minLength:1,maxLength:24}},required:['text'],additionalProperties:false},dsl:{verb:id,syntax:id+' title text=TEXT'},caps:{perTurn:4,bytes:1024},persistence:'event'}))
  const prepared=[[],[commands[0]],commands].map(active=>f.prepare({engine:{dimensions:{titles:true}},mods:{revision:'installed-p1',commands:active,schemaCommands:commands}}))
  const tools=prepared.map(p=>JSON.stringify(buildAssetPackRequest(p,true).tools))
  assert.equal(tools[0],tools[1]);assert.equal(tools[0],tools[2])
  for(const op of ['title.play',...commands.map(row=>row.op)])assert.ok(tools[0].includes(op))
  const operation={op:'title.play',text:'Core title'}
  assert.equal(f.transaction(prepared[0]).submitModel(batch([operation])).ok,true)
  const replaced=f.transaction(prepared[2]),rejected=replaced.submitModel(batch([operation]))
  assert.equal(rejected.ok,false)
  assert.equal(rejected.errors[0].retryable,true)
  assert.deepEqual(rejected.errors[0].choices,commands.map(command=>command.op))
  assert.equal(replaced.submitModel(batch([{op:commands[1].op,text:'Explicit choice'}])).ok,true)
  assert.deepEqual(replaced.effect().entries.flatMap(entry=>entry.ops).map(op=>op.modId),['fixture.two'])
  for(const command of commands)assert.equal(f.transaction(prepared[2]).submitModel(batch([{op:command.op,text:'Independent'}])).ok,true)
  for(const op of [{op:commands[0].op,text:'Disabled'},'one title text="Disabled"']) {
    const fallback=f.transaction(prepared[0]),inactive=fallback.submitModel(batch([op]))
    assert.equal(inactive.ok,false)
    assert.equal(inactive.errors[0].retryable,true)
    assert.deepEqual(inactive.errors[0].choices,['title.play'])
    assert.equal(fallback.submitModel(batch([operation])).ok,true)
    assert.deepEqual(fallback.effect().entries.flatMap(entry=>entry.ops).map(op=>op.op),['title.play'])
  }
  const installed=f.prepare({mods:{commands:[],schemaCommands:commands.slice(0,1)}})
  assert.notEqual(JSON.stringify(buildAssetPackRequest(installed,true).tools),tools[0])
})
