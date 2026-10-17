import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {compileTextcard,assertTextcardSemantics,TEXTCARD_COMPOUND_KIND,TEXTCARD_TEMPLATE_IDS} from '../fork/mods/textcard/templates.js'
import {textcardPayload,INTENSITIES} from '../fork/mods/textcard/presets.js'
import {validateModCommand} from '../tavern-plugin/lib/domain/mods/commands.js'
import renderer from '../tavern-plugin/src/client/fork-textcard-presets.cjs'
import {command} from '../fork/mods/textcard/runtime.js'

const manifest=JSON.parse(await readFile(new URL('../fork/mods/textcard/manifest.json',import.meta.url),'utf8'))
const examples=JSON.parse(await readFile(new URL('./fixtures/textcard-templates.json',import.meta.url),'utf8'))

const frames=payload=>payload.frames.reduce((sum,row)=>sum+row.f,0)

test('nine approved inputs compile into one stored compound, defaults are new-input only',()=>{
  assert.deepEqual(manifest.commands.map(row=>row.id),TEXTCARD_TEMPLATE_IDS)
  for(const [id,params] of Object.entries(examples)) {
    const original=JSON.stringify(params),cmd=manifest.commands.find(row=>row.id===id)
    assert.ok(Object.keys(cmd.params.properties).length<=4)
    validateModCommand(cmd,params)
    const payload=compileTextcard(id,params),plan=renderer.planTextcard(JSON.parse(JSON.stringify(payload)))
    assert.equal(payload.version,1);assert.equal(payload.playback,'live-once')
    assert.equal(payload.placement,id==='title'?'before':'after')
    assert.equal(payload.fps,24);assert.equal(payload.minColourFrames,9)
    assert.equal(plan.frames.length,payload.frames.length)
    assert.deepEqual(plan.history,payload.history.parts)
    assert.equal(JSON.stringify(params),original)
    assert.throws(()=>validateModCommand(cmd,{...params,ms:300}),/unknown field/)
  }
  assert.equal(compileTextcard('show',{text:'\u660e'}).frames[0].style,'kanji')
  assert.equal(compileTextcard('sequence',{words:['alone']}).frames[0].style,'word')
  assert.equal(compileTextcard('repeat',{word:'again'}).frames[0].state.fill,'again')
  const legacy=textcardPayload({style:'count',text:['3']})
  const bytes=JSON.stringify(legacy)
  renderer.planTextcard(legacy);renderer.textcardHistory(legacy)
  assert.equal(JSON.stringify(legacy),bytes)
  assert.equal(Object.hasOwn(legacy,'placement'),false)
  assert.deepEqual(legacy.stepFrames,[4,4,4,4])
})

test('template durations preserve the approved phases; count seconds ignore intensity',()=>{
  for(const intensity of Object.keys(INTENSITIES)) {
    const count=compileTextcard('count',{from:60},intensity)
    assert.equal(count.frames.length,61)
    assert.deepEqual(count.frames.map(row=>row.f),[...Array(60).fill(24),12])
    assert.equal(count.frames.at(-1).state.text,'0')
    assert.equal(frames(compileTextcard('count',{from:0},intensity)),12)
    assert.equal(renderer.planTextcard(count,{reduced:true}).frames.length,61)
  }
  assert.equal(frames(compileTextcard('relate',examples.relate)),152)
  assert.equal(frames(compileTextcard('repeat',examples.repeat)),41)
  assert.equal(frames(compileTextcard('read',examples.read)),71)
  const reveal=compileTextcard('reveal',examples.reveal)
  assert.equal(frames(reveal),82+48)
  const build=reveal.frames.filter(row=>row.style==='build')
  assert.ok(build.at(-1).f>=41)
  assert.equal(frames(compileTextcard('reveal',{answer:'\u7b54\u6848'})),82)
  const compare=compileTextcard('compare',examples.compare)
  assert.ok(compare.frames.slice(0,-1).every(row=>row.f>=9))
  assert.equal(compare.frames.at(-1).f,72)
  const three=compileTextcard('compare',{sides:[...examples.compare.sides,{name:'\u4ed6\u60f3',text:'\u518d\u89c1'}]})
  assert.deepEqual(three.frames.map(row=>row.f),[8,8,8,72])
})

test('relate uses opaque IDs, nodes before directed labelled edges, and holds empty links',()=>{
  const payload=compileTextcard('relate',examples.relate),[first,second,edges,final]=payload.frames
  assert.equal(first.state.visiblePeople,1);assert.equal(first.state.visibleLinks,0)
  assert.equal(first.f+second.f,24);assert.equal(edges.f,24);assert.equal(final.f,104)
  assert.deepEqual(payload.graph.links,examples.relate.links)
  assert.notEqual(payload.graph.people[0].id,payload.graph.people[0].name)
  assert.ok(payload.text.includes('\u6653\u7f8e\u7130 -> \u9e7f\u76ee\u5706: \u53cd\u590d\u62ef\u6551'))
  const empty=compileTextcard('relate',{...examples.relate,links:[]})
  assert.equal(frames(empty),152);assert.ok(empty.frames.every(row=>row.state.visibleLinks===0))
  const reciprocal=compileTextcard('relate',{...examples.relate,links:[...examples.relate.links,{from:'p-01',to:'p-02',label:'\u4fe1\u4efb'}]})
  assert.equal(reciprocal.frames.at(-1).state.visibleLinks,2)
  const before=JSON.stringify(payload)
  const reduced=renderer.planTextcard(payload,{reduced:true})
  assert.equal(reduced.frames.length,1);assert.equal(reduced.frames[0].state.visibleLinks,1)
  assert.equal(JSON.stringify(payload),before)
})

test('repairable semantic errors identify exact paths and never place a partial performance',async()=>{
  const bad={...examples.relate,links:[{from:'p-02',to:'p-03',label:'\u62ef\u6551'}]}
  assert.throws(()=>assertTextcardSemantics('relate',bad),error=>error.path==='$.params.links[0].to' && error.message==='Unknown node p-03; use one of p-01, p-02.')
  assert.throws(()=>compileTextcard('relate',{...examples.relate,people:[examples.relate.people[0],examples.relate.people[0]]}),error=>error.path==='$.params.people[1].id')
  assert.throws(()=>compileTextcard('relate',{...examples.relate,links:[{from:'p-01',to:'p-01',label:'self'}]}),error=>error.path==='$.params.links[0].to')
  assert.throws(()=>compileTextcard('relate',{...examples.relate,links:[{...examples.relate.links[0],label:'  '}]}),error=>error.path==='$.params.links[0].label')
  assert.throws(()=>compileTextcard('show',{preset:'punct',text:'x'.repeat(13)}),error=>error.path==='$.params.text' && /12.*shorten/.test(error.message))
  assert.throws(()=>compileTextcard('sequence',{kind:'signal',words:['\u7ea2'.repeat(25)]}),error=>error.path==='$.params.words[0]' && /24/.test(error.message))
  const placed=[],host={settings:{get:async()=>({values:{intensity:'standard'}})},stage:{place:async value=>{placed.push(value);return value}}}
  await assert.rejects(command({commandId:'relate',params:bad},host),/Unknown node/)
  assert.equal(placed.length,0)
  await command({commandId:'relate',params:examples.relate},host)
  assert.equal(placed.length,1);assert.equal(placed[0].kind,TEXTCARD_COMPOUND_KIND)
})

test('full long text and all intermediate reveal clues survive history; only short repeat crops',()=>{
  const word='\u4e0d\u8981\u56de\u5934'.repeat(8),body='\u8bb0'.repeat(800),answer='\u7b54'.repeat(96)
  const repeat=compileTextcard('repeat',{word})
  assert.equal(repeat.frames.at(-1).style,'word');assert.equal(repeat.frames.at(-1).state.text,word)
  const read=compileTextcard('read',{code:'CASE',body})
  assert.equal(read.frames.at(-1).state.text,body);assert.ok(renderer.textcardHistory(read).parts.includes(body))
  const reveal=compileTextcard('reveal',{answer,clues:['\u65e5','\u6708']})
  assert.deepEqual(reveal.history.parts,['\u65e5','\u6708',answer])
  assert.equal(reveal.frames.at(-1).state.final,answer)
  for(const style of ['show','title'])assert.throws(()=>validateModCommand(manifest.commands.find(row=>row.id===style),{text:['old array']}),/string/)
})
