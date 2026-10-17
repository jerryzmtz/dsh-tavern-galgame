import {viewerNickname} from '../fork/mods/danmaku/nicknames.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {parseComments,commentAmount,SC_AMOUNTS} from '../fork/mods/danmaku/contract.js'
import {createAudiencePresets,presetExamples} from '../fork/mods/danmaku/presets.js'
import {validateAudienceContent} from '../fork/mods/danmaku/audience.js'

const group={ref:{packId:'pack',kind:'audience',assetId:'canonical'},name:'Audience',
  content:{persona:'Fans',tone:'Friendly',catchphrases:[],examples:[]}}

test('SC amounts validate once, default by weighted tier, and normal comments carry null',()=>{
  const parse=row=>parseComments({comments:[{group:group.ref,author:'Fan',text:'Encore',kind:'highlight',...row}]},[group],[],{id:'id',offsetMs:0,random:()=>0})[0]
  for(const amount of SC_AMOUNTS)assert.equal(parse({amount}).amount,amount)
  for(const amount of [0,31,30.5,'30',Infinity])assert.throws(()=>parse({amount}),{code:'MOD_RESOURCE_UNAVAILABLE'})
  assert.equal(parse({}).amount,30)
  assert.equal(parse({kind:'comment',amount:100}).amount,null)
  assert.deepEqual([0,0.6,0.8,0.92,0.97,0.99].map(draw=>commentAmount('highlight',null,()=>draw)),SC_AMOUNTS)
  const custom=structuredClone(group)
  custom.content.triggers=[{id:'sc',keywords:['encore'],lines:[{text:'Great show',kind:'highlight',amount:500}]}]
  validateAudienceContent(custom.content)
  assert.deepEqual(presetExamples(custom.content),['Great show'])
  const engine=createAudiencePresets({now:()=>0,random:()=>0,id:()=> 'sc'})
  engine.trigger({id:'reveal',text:'encore'},[custom],0,[])
  const [row]=engine.take([custom],0,[])
  assert.equal(row.kind,'highlight');assert.equal(row.amount,500)
  engine.restore([row]);engine.observe([row],[custom],1000,[row])
  assert.deepEqual(engine.take([custom],1000,[row]),[])
  custom.content.triggers[0].lines[0].amount=99
  assert.throws(()=>validateAudienceContent(custom.content))
})

test('relay reaches depth five, preserves parent pointers and blocks repeated rules across groups',()=>{
  let serial=0
  const custom=structuredClone(group)
  custom.content.chains=Array.from({length:7},(_,i)=>({id:'step-'+i,match:'step '+i,replies:['step '+(i+1)],probability:1}))
  const engine=createAudiencePresets({now:()=>0,random:()=>0,id:()=>String(++serial)})
  let parent={id:'root',text:'step 0',depth:0,offsetMs:0},clock=0
  const rows=[parent]
  for(let i=1;i<=6;i++) {
    engine.observe([parent],[custom],clock,rows)
    clock+=600
    const children=engine.take([custom],clock,rows)
    if(i===6){assert.deepEqual(children,[]);break}
    assert.equal(children.length,1)
    assert.notEqual(children[0].author,parent.author);assert.notEqual(children[0].author,custom.name)
    assert.equal(children[0].depth,i);assert.equal(children[0].replyTo,parent.id)
    parent=children[0];rows.push(parent)
  }
  const other={...custom,ref:{...custom.ref,assetId:'other'},content:{...custom.content,
    chains:[{id:'step-0',match:'step 1',replies:['new text'],probability:1}]}}
  const cycle=createAudiencePresets({now:()=>0,random:()=>0,id:()=>String(++serial)})
  cycle.observe([rows[0]],[custom],0,[])
  const [child]=cycle.take([custom],600,[])
  cycle.observe([child],[other],600,[])
  assert.deepEqual(cycle.take([other],1200,[]),[])
  // Another rule cannot cycle back to an ancestor's normalized text, even without recent history.
  other.content.chains=[{id:'different',match:'step 1',replies:['STEP 0'],probability:1}]
  const textCycle=createAudiencePresets({now:()=>0,random:()=>0,id:()=>String(++serial)})
  textCycle.observe([rows[0]],[custom],0,[])
  const [first]=textCycle.take([custom],600,[])
  textCycle.observe([first],[other],600,[])
  assert.deepEqual(textCycle.take([other],1200,[]),[])
})


test('fictional viewer names vary, are chat/comment stable, and ignore model account names',()=>{
  const names=Array.from({length:32},(_,i)=>viewerNickname('chat',String(i),group))
  assert.ok(new Set(names).size>24)
  assert.deepEqual(names,Array.from({length:32},(_,i)=>viewerNickname('chat',String(i),group)))
  assert.notEqual(names[0],viewerNickname('other-chat','0',group))
  assert.notEqual(names[0],viewerNickname('chat','0',group,names[0]))
  assert.ok(names.every(name=>name!==group.name && [...name].length<=24))
  const custom=structuredClone(group);custom.content.nicknamePool=['FictionalFan']
  validateAudienceContent(custom.content)
  const pooled=Array.from({length:64},(_,i)=>viewerNickname('chat',String(i),custom))
  assert.ok(pooled.includes('FictionalFan'));assert.ok(pooled.some(name=>name!=='FictionalFan'))
  assert.ok(!pooled.some(name=>name.startsWith('FictionalFan_')))
  for(let i=0;i<64;i++)assert.notEqual(viewerNickname('chat',String(i),custom,pooled[i]),pooled[i])
  const parse=author=>parseComments({comments:[{group:custom.ref,author,text:'hello',kind:'comment'}]},[custom],[],{id:'batch',offsetMs:0,chatId:'chat'})[0]
  assert.deepEqual(parse('external-account'),parse(undefined))
  assert.notEqual(parse('external-account').author,'external-account')
  for(const pool of [[],Array(33).fill('name'),['x'.repeat(25)],[1]])
    assert.throws(()=>validateAudienceContent({...custom.content,nicknamePool:pool}))
})


test('consecutive comments visibly mix nickname shapes and stems without numbered-stem formatting',()=>{
  const shape=name=>/^bili_/.test(name)?'default':/[・の]/u.test(name)?'separator':
    /^[a-z]+_[a-z]+$/.test(name)?'latin-separated':/^[a-z]+$/.test(name)?'latin':
    /[0-9]$/.test(name)?'chinese-number':'chinese'
  for(const chat of ['chat','stream-two','session-123']) {
    const names=Array.from({length:32},(_,i)=>viewerNickname(chat,String(i),group))
    assert.ok(new Set(names.map(shape)).size>=5,chat+': shapes')
    assert.ok(new Set(names.map(name=>name.replace(/[0-9_]/g,''))).size>=24,chat+': stems')
    assert.ok(names.every(name=>!/[\u{1f300}-\u{1faff}]/u.test(name) && [...name].length<=24))
  }
  const custom=structuredClone(group)
  custom.content.nicknamePool=Array.from({length:32},(_,i)=>'InventedHandle'+i)
  validateAudienceContent(custom.content)
  const names=Array.from({length:320},(_,i)=>viewerNickname('pool-stream',String(i),custom))
  const authored=names.filter(name=>custom.content.nicknamePool.includes(name))
  assert.ok(authored.length>=35 && authored.length<=95)
  assert.ok(new Set(authored).size>=20)
})
