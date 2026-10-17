// private fork: tagged English defaults; retain protocol, payload, cache and budget assertions.
// private fork (prompt view complete, owner 2026-10): 舞台设置 › 提示词 shows every byte the director receives. The rows the
// panel builds from previewStageDirectorPrompt (directorWire) must cover the real request exactly — system, every message
// text, the message envelope and the tools JSON — with every preview section found verbatim; synthetic fixtures only.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {assetRenderer} from './fixtures/asset-editor-renderer.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {syntheticPack,cardExtension,PACK_ID,OTHER_PACK_ID,FIGURE_ID,OTHER_FIGURE_ID} from './fixtures/asset-packs/pack.mjs'
import {assetRefKey} from '../tavern-plugin/packages/dsh-presentation-protocol/src/asset-packs.js'
import {initialAssetPackStage} from '../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {prepareAssetPackDirector,buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {estimateDirectorTokens} from '../tavern-plugin/lib/domain/stage-director-tokens.js'
import {createEngineJudge,validateJudgeConfig} from '../tavern-plugin/lib/domain/engine-judge.js'
import {directorPreview} from './harness/prompt-view-r2.mjs'

// private fork: the new judge group covers serialized HTTP bodies, not a reprinted JSON projection.
test('提示词 智能判断 group covers every sent byte across batches without a preview call', async () => {
  for (const provider of ['jev','openai','openai-compatible']) {
    const config = validateJudgeConfig({provider,...(provider === 'openai-compatible' ? {baseUrl:'https://fake.example/v1'} : {})})
    const sent = []
    const judge = createEngineJudge({getConfig:() => config,credentials:() => ({resolve:async () => ({value:'fake'})}),fetch:async (url,options) => {
      sent.push({url,body:options.body})
      const body = JSON.parse(options.body)
      return {ok:true,json:async () => ({answers:provider === 'jev' ? Object.fromEntries(Object.keys(body.questions).map(id => [id,{type:'noul',noul:.8}])) : body.questions.map(q => ({name:q.name,type:'predicate',probability:.8}))})}
    }})
    const input = {material:'背景说明\n\n本轮正文。',questions:Array.from({length:301},(_,i) => ({id:'q'+i,text:'这条素材适合本轮剧情吗？【背景】车站；使用情景：出发'}))}
    const group = JSON.parse(JSON.stringify(judge.preview(input)))
    assert.equal(group.title,'判断模型') // private fork (judge key, owner 2026-10): renamed
    assert.equal(sent.length,0)
    await judge.judge(input)
    assert.equal(group.requests.length,2)
    assert.deepEqual(group.requests.map(({url,body}) => ({url,body})),sent)
    assert.equal(group.requests.reduce((n,r) => n+r.bytes,0),sent.reduce((n,r) => n+Buffer.byteLength(r.body,'utf8'),0))
    assert.ok(group.requests.every(r => r.bytes === Buffer.byteLength(r.body,'utf8')))
  }
})

const {source,picker}=await stageSource()
const bytes=text=>Buffer.byteLength(text,'utf8')
function stageHelpers(){
  const r=assetRenderer(),context={TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),emotions:{moods:[],palette:['#111111'],max:8}})
  return {stage:views.stage,dispose:()=>r.dispose()}
}
// The asset-packs director fixture: two packs, widgets on, plain string units.
async function packFixture(){
  const first=await syntheticPack(),second=structuredClone(first)
  first.figures[FIGURE_ID].outfits[0].guidance='在中转站工作时' // private fork (outfit usage): an outfit 使用情景 is shown verbatim too
  second.manifest.id=OTHER_PACK_ID // private fork: no background soundscape dependency.
  second.figures={[OTHER_FIGURE_ID]:{...second.figures[FIGURE_ID],id:OTHER_FIGURE_ID}};second.manifest.figures=[OTHER_FIGURE_ID]
  const snapshots=[first,second].map((p,i)=>({manifest:p.manifest,figures:p.figures,widgets:p.widgets,revision:'r'+i}))
  const assetStatus={},widgetAuthorizations={}
  for(const p of snapshots)for(const asset of p.manifest.assets){const key=assetRefKey({packId:p.manifest.id,kind:asset.kind,assetId:asset.id});assetStatus[key]={available:true,executableDigest:'a'.repeat(64)};widgetAuthorizations[key]='a'.repeat(64)}
  const input={snapshots,assetStatus,raw:{extensions:{dsh_tavern:cardExtension()}},cardRevision:'card-1',engine:{widgetAuthorizations,widgetsEnabled:true},
    target:{sourceKey:'reply-1',branchId:'branch-1',revision:1},units:['Synthetic fixture.','Later at night.','An unchanged paragraph.'],
    baseline:initialAssetPackStage({actor:{figure:{packId:PACK_ID,figureId:FIGURE_ID},outfits:[]}})}
  return extra=>prepareAssetPackDirector({...input,...extra,engine:{...input.engine,...extra?.engine}})
}
async function requests(){
  const perf=await performanceFixture(),pack=await packFixture(),out=[]
  const ruled=prepared=>{const next=structuredClone(prepared);next.styles={card:[{ref:{packId:PACK_ID,kind:'directions',assetId:'main'},name:'本卡风格',text:'告白、重逢用近景。\n日常少换背景。'}],player:[{ref:{packId:OTHER_PACK_ID,kind:'directions',assetId:'twin'},name:'全局风格',text:'告白、重逢用近景。'}]};return next}
  for(const [name,prepared] of [['performance',perf.prepare()],['performance+styles',ruled(perf.prepare())],['packs',pack()],['packs+styles',ruled(pack())],
    ['packs camera/weather off',pack({engine:{dimensions:{camera:false,weather:false,'camera.close':false}}})]])
    for(const incremental of [true,false])for(const guidance of ['','  只这一次：安静一点。  '])
      out.push([name+(incremental?' incremental':' submit')+(guidance?' +guidance':''),buildAssetPackRequest(prepared,incremental,undefined,guidance,true)])
  return out
}
// The places the request carries text, as the panel cuts them.
function places(request){
  return [request.system,...request.messages.flatMap(m=>typeof m.content==='string'?[m.content]:m.content.filter(p=>typeof p.text==='string').map(p=>p.text)),JSON.stringify(request.tools)]
}

// private fork (judge ui, owner 2026-10; prompt panel D′): the panel's 判断模型 rows cut each request body into 剧情 /
// 待判断素材 / 拼接与封装 (every batch in the same rows), a batch's pieces joining back into its body and all adding up to
// every byte sent; a body of another shape stays one row per batch; no `judge` (provider unset) gives no rows.
test('提示词 智能判断 rows cover every request body byte for byte, cut into story, questions and frame', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  assert.equal(stage.judgePromptRows(undefined).length,0)
  assert.equal(stage.judgePromptRows({id:'judge',title:'智能判断',requests:[]}).length,0)
  for(const provider of ['jev','openai','openai-compatible'])for(const count of [3,301]){
    const config=validateJudgeConfig({provider,preamble:'校园日常。',...(provider==='openai-compatible'?{baseUrl:'https://fake.example'}:{})})
    const judge=createEngineJudge({getConfig:()=>config,credentials:()=>null,fetch:async()=>{throw new Error('no network')}})
    const preview=JSON.parse(JSON.stringify(judge.preview({material:'校园日常。\n\n放学后的教室。',questions:Array.from({length:count},(_,i)=>({id:'q'+i,text:'这条素材适合本轮剧情吗？【背景】教室 '+i+'；使用情景：放学'}))})))
    const rows=stage.judgePromptRows(preview),name=provider+' '+count
    assert.equal(rows.map(r=>r.name).join(),'剧情,待判断素材,拼接与封装',name)
    const pieces=rows.flatMap(row=>row.pieces)
    preview.requests.forEach((request,i)=>{const own=pieces.filter(p=>p.batch===i).sort((a,b)=>a.offset-b.offset)
      assert.equal(own.map(p=>p.text).join(''),request.body,name+': body verbatim')
      assert.equal(own.reduce((n,p)=>n+p.bytes,0),request.bytes,name+': bytes')
      assert.ok(own.every(p=>p.method===request.method&&p.url===request.url),name)
      assert.ok(JSON.parse(own.find(p=>p.key==='judge-story').text).includes('放学后的教室。'),name+': the story')})
    assert.equal(rows[1].count,count,name+': every question')
    assert.equal(rows.reduce((n,r)=>n+r.bytes,0),preview.requests.reduce((n,r)=>n+bytes(r.body),0),name+': every sent byte')
    assert.ok(rows.every(r=>!JSON.stringify(r).includes('Bearer')),name+': no authorization')
  }
  const odd=stage.judgePromptRows({requests:[{method:'POST',url:'https://x.test',body:'plain'}]})
  assert.deepEqual([odd.length,odd[0].name,odd[0].pieces[0].text],[1,'判断请求','plain'])
})

test('提示词 导演 rows cover the real request byte for byte, in order', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  for(const [name,request] of await requests()){
    const wire=stage.directorWire(JSON.parse(JSON.stringify(request)))
    const real=bytes(request.system)+bytes(JSON.stringify(request.messages))+bytes(JSON.stringify(request.tools))
    assert.deepEqual([...wire.unplaced],[],name+': every section is found verbatim')
    assert.equal(wire.bytes.total,real,name+': request size')
    assert.equal(wire.covered,real,name+': rows add up to the request')
    assert.equal(wire.rows.reduce((sum,row)=>sum+row.pieces.reduce((n,piece)=>n+(piece.bytes??bytes(piece.text)),0),0),real,name+': pieces add up')
    // Each place reads back exactly from its pieces in order (the envelope is the messages JSON around the texts).
    const texts=places(request),pieces=wire.rows.flatMap(row=>row.pieces).filter(piece=>piece.key!=='envelope')
    texts.forEach((text,index)=>assert.equal(pieces.filter(piece=>piece.place===index).sort((a,b)=>a.offset-b.offset).map(piece=>piece.text).join(''),text,name+': place '+index))
    const envelope=wire.rows.flatMap(row=>row.pieces).find(piece=>piece.key==='envelope')
    assert.equal(envelope.bytes,bytes(JSON.stringify(request.messages))-texts.slice(1,-1).reduce((sum,text)=>sum+bytes(text),0),name+': envelope bytes')
    // Rows: the order the request first uses them, 结构与分隔 last; each piece says where it goes.
    const ids=wire.rows.map(row=>row.id),first=id=>Math.min(...wire.rows.find(row=>row.id===id).pieces.filter(p=>p.key!=='envelope').map(p=>p.place*1e9+p.offset))
    assert.equal(ids.at(-1),'frame',name)
    for(let i=1;i<ids.length-1;i++)assert.ok(first(ids[i-1])<first(ids[i]),name+': order '+ids.join(','))
    assert.ok(wire.rows.every(row=>row.pieces.every(piece=>['system','user','tools'].includes(piece.at))),name+': at')
    // 导演指令: guidance (system) and op schemas (tools); the role stays intact.
    const commands=wire.rows.find(row=>row.id==='commands')
    assert.deepEqual([...new Set(commands.pieces.map(piece=>piece.at))],['system','tools'],name)
    const schema=commands.pieces.find(piece=>piece.key==='command-schema')
    assert.ok(commands.pieces.every(piece=>['command-guidance','command-schema'].includes(piece.key)),name)
    const role=request.sections.find(s=>s.key==='director').text
    assert.match(role,/^<director_role>[\s\S]*<\/director_role>$/)
    assert.equal(wire.rows.flatMap(row=>row.pieces).find(piece=>piece.key==='director').text,role,name)
    assert.doesNotMatch(request.system,/director_commands|Ops \(noun:verbs\)/,name)
    assert.equal(schema.items.length,request.tools[0].parameters.properties.beats.items.properties.ops.items.anyOf[0].oneOf.length,name+': every installed op schema is shown')
    for(const section of request.sections.filter(s=>!['tools','director'].includes(s.key)))
      assert.ok(wire.rows.some(row=>row.pieces.some(piece=>piece.key===section.key&&piece.text===section.text)),name+': '+section.key+' shown verbatim')
    assert.equal(wire.rows.find(row=>row.id==='tool').pieces.map(p=>p.at).join(),'tools,tools',name+': tool frame around the ops')
  }
})

// private fork (direction styles, owner 2026-10): 演出风格 replace the engine rules — prepared.styles (card first, then player),
// the player's repeating a line of the card's so the panel must place each piece where it really is.
const CARD_STYLE='进入魔女结界时，先换成结界背景并用情绪调色压暗画面，再震屏一次。\n告白、重逢用近景。',PLAYER_STYLE='告白、重逢用近景。'
function styled(prepared){
  const next=structuredClone(prepared)
  next.styles={card:[{ref:{packId:PACK_ID,kind:'directions',assetId:'barrier'},name:'结界演出',text:CARD_STYLE,packName:'Synthetic pack'}],
    player:[{ref:{packId:OTHER_PACK_ID,kind:'directions',assetId:'restrained'},name:'演出风格·克制',text:PLAYER_STYLE,packName:'Other pack'}]}
  return next
}
// private fork (direction styles, owner 2026-10): 提示词 › 导演 › 演出风格 — the lead-in, each entry's name and every style text,
// verbatim and in the order sent (卡片作者 first); with no style enabled there is no such row (the panel adds an empty one).
test('演出风格 row shows the injected styles verbatim, lead-in and entry names included', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const pack=await packFixture()
  for(const incremental of [true,false]){
    const request=buildAssetPackRequest(styled(pack()),incremental,undefined,'',true),wire=stage.directorWire(JSON.parse(JSON.stringify(request)))
    const row=wire.rows.find(r=>r.id==='styles');assert.equal(row.name,'演出风格')
    // private fork: name and text are one verbatim section, without scope labels.
    assert.deepEqual(Array.from(row.pieces,p=>p.text),['Extra staging guidance for this game:','### 结界演出\n'+CARD_STYLE,'### 演出风格·克制\n'+PLAYER_STYLE])
    assert.ok(request.system.includes(row.pieces.map(p=>p.text).join('\n')),'one block in system')
    assert.deepEqual(Array.from(row.pieces,p=>p.at),Array(3).fill('system'))
    assert.deepEqual(Array.from(row.pieces,p=>p.name),['引导语','结界演出','演出风格·克制'])
    assert.deepEqual([row.pieces[1].packIds[0],row.pieces[1].assetId,row.pieces[2].packIds[0],row.pieces[2].assetId],[PACK_ID,'barrier',OTHER_PACK_ID,'restrained'])
    const ids=wire.rows.map(r=>r.id);assert.ok(ids.indexOf('styles')>ids.indexOf('commands'),'after stable rules and command guidance')
  }
  const plain=stage.directorWire(JSON.parse(JSON.stringify(buildAssetPackRequest(pack(),true,undefined,'',true))))
  assert.equal(plain.rows.some(r=>r.id==='styles'),false)
})

test('导演指令 toggles preserve frozen schemas; turn admission is separate', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const pack=await packFixture(),row=prepared=>stage.directorWire(JSON.parse(JSON.stringify(buildAssetPackRequest(prepared,true,undefined,'',true)))).rows.find(r=>r.id==='commands')
  const on=row(pack()),off=row(pack({engine:{dimensions:{camera:false,'camera.close':false,weather:false}}}))
  const text=(r,key)=>r.pieces.find(p=>p.key===key).text
  assert.match(text(on,'command-schema'),/"const":"camera\.set"/);assert.match(text(on,'command-schema'),/"const":"weather\.set"/)
  assert.equal(text(off,'command-schema'),text(on,'command-schema'))
  assert.equal(off.bytes,on.bytes)
})

test('the panel token estimate is the director estimate', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  for(const [,request] of (await requests()).slice(0,4))for(const text of [...request.sections.map(s=>s.text),request.system,JSON.stringify(request.tools)])
    assert.equal(stage.promptTokenEstimate(text),estimateDirectorTokens(text))
})

test('正文模型 rows list a bubble entry another card left in the worldbook, as sent', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const story={userName:'阿月',parts:[{key:'format',text:'【对白格式】\n- 新格式 阿月',tokens:9},{key:'figure',figure:'p/f',name:'大肥鱼',constant:true,text:'大肥鱼（ID dafeiyu）',tokens:6}],
    entries:[{comment:'对白格式（由「对话气泡」设置维护）',text:'【对白格式】\n- 新格式 {{user}}',constant:true,own:true,bookName:'大肥鱼'},
      {comment:'对白格式（由「对话气泡」设置维护）',text:'【对白格式】\n- 旧格式 {{user}}',constant:true,own:false,bookName:'大肥鱼'},
      {comment:'人物情绪 · 大肥鱼',text:'大肥鱼\nsmug: 得意',constant:false,own:false,bookName:'大肥鱼'}]}
  const rows=stage.storyPromptRows(story,{packs:[]})
  // private fork: merged variant heading; byte coverage remains verbatim.
  assert.deepEqual(rows.map(r=>r.name),['对白格式','说话人名单','对白格式','人物情绪 · 大肥鱼'])
  assert.deepEqual(rows.map(r=>!!r.leftover),[false,false,true,true])
  assert.equal(rows[2].pieces[0].text,'【对白格式】\n- 旧格式 阿月')
  assert.equal(rows[3].recalled,true);assert.equal(rows[3].tokens,estimateDirectorTokens('大肥鱼\nsmug: 得意'))
})

// private fork: common-roster labels are view-only; all sent bytes and token counts remain intact.
test('正文 common roster names all covered figures without changing the prompt', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const text='以下角色只用通用差分：鹿目圆（ID f_madoka）、店员 C（ID f_clerk）。\n鹿目圆的通用差分用法：\n喜悦：微笑。'
  const story={parts:[{key:'figure',figure:'common-roster',packs:['p','q'],name:'通用差分人物',constant:true,text,tokens:53}]}
  const ctx={packs:[{manifest:{id:'p',name:'通用角色'}},{manifest:{id:'q',name:'大肥鱼'}}],binding:{globalEnabledPackIds:['p']}}
  const original=JSON.stringify(story),row=stage.storyPromptRows(story,ctx)[0]
  assert.equal(row.name,'说话人名单') // private fork
  assert.equal(row.owners,'全局素材包 1，本卡素材包 1') // private fork (prompt sources): pack counts by lamp
  assert.equal(row.ownersTitle,'全局：通用角色　本卡：大肥鱼') // private fork (prompt sources): names only in the tooltip
  assert.equal(row.pieces[0].text,text)
  assert.equal(row.tokens,53)
  assert.equal(JSON.stringify(story),original)
  assert.equal(stage.storyPromptRows({parts:[{...story.parts[0],packs:['q']}]},ctx)[0].owners,'本卡素材包 1') // private fork (prompt sources)
})

// private fork (prompt sources, owner 2026-10): a pack-derived source shows pack counts grouped by lamp (a side with none
// left out), names only in its tooltip; other rows keep their short scope.
test('提示词 source column: pack counts by lamp, names in the tooltip', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const ctx={packs:[{manifest:{id:'a',name:'通用角色'}},{manifest:{id:'b',name:'通用背景（中国）'}},{manifest:{id:'c',name:'大肥鱼'}}],binding:{globalEnabledPackIds:['a','b']}}
  const pick=value=>({owners:value.owners,ownersTitle:value.ownersTitle})
  assert.deepEqual(pick(stage.promptSources(ctx,[{kind:'pack',packIds:['a','c']},{kind:'pack',packIds:['b']},{kind:'turn'}])),{owners:'全局素材包 2，本卡素材包 1',ownersTitle:'全局：通用角色、通用背景（中国）　本卡：大肥鱼'})
  assert.equal(stage.promptSources(ctx,[{kind:'pack',packIds:['a']}]).owners,'全局素材包 1')
  assert.equal(stage.promptSources(ctx,[{kind:'pack',packIds:['c']}]).owners,'本卡素材包 1')
  assert.equal(stage.promptSources(ctx,[{kind:'engine'},{kind:'turn'}]).owners,'全局、本轮')
  assert.equal(stage.storyPromptRows({parts:[{key:'figure',figure:'c/f',name:'大肥鱼',constant:true,text:'x',tokens:1}]},ctx)[0].owners,'本卡素材包 1')
})
// private fork (prompt view r2, owner 2026-10): a mod's parts sit in 模组, each named by its mod's display name and what it
// is (no 其他内容); a JSON text reads structurally only when its tree writes back to the exact bytes (else it stays raw), so
// the structured view, its 「原始」 text and the counts all stand for the same bytes the request sends.
test('提示词 r2: mod parts named by mod and kind; JSON pieces round-trip byte for byte', async t=>{
  const {stage,dispose}=stageHelpers();t.after(dispose)
  const preview=await directorPreview(),wire=stage.directorWire(JSON.parse(JSON.stringify(preview)))
  const real=bytes(preview.system)+bytes(JSON.stringify(preview.messages))+bytes(JSON.stringify(preview.tools))
  assert.deepEqual([...wire.unplaced],[]);assert.equal(wire.covered,real)
  const pieces=wire.rows.flatMap(row=>row.pieces)
  assert.ok(!wire.rows.some(row=>row.name==='其他内容')&&!pieces.some(piece=>piece.name==='其他内容'))
  const mods=wire.rows.find(row=>row.id==='mods')
  assert.equal(mods.name,'模组')
  assert.deepEqual([...new Set(mods.pieces.map(piece=>piece.name))].sort(),['物品 · 上下文','物品 · 使用规则','物品 · 候选素材','物品 · 命令说明','物品 · 当前状态'].sort())
  assert.ok(mods.pieces.every(piece=>piece.modId==='dsh.items'&&piece.at==='user'))
  assert.equal(stage.promptSources({},mods.pieces).owners,'物品')
  // An older host (no name, no role) still names the row's parts by 模组, never 其他内容.
  const old=stage.directorWire(JSON.parse(JSON.stringify({...preview,sections:preview.sections.map(s=>s.source?.kind==='mod'?{...s,source:{kind:'mod',modId:s.source.modId,id:s.source.id}}:s)})))
  assert.ok(old.rows.find(row=>row.id==='mods').pieces.every(piece=>piece.name==='模组'))
  let structured=0
  for(const text of [...pieces.map(piece=>piece.text),...preview.judge.requests.map(request=>request.body)]){const tree=stage.promptJson(text);if(!tree)continue;structured++;assert.equal(stage.promptJsonText(tree),text)}
  assert.ok(structured>=6,'candidates, actors, carried, reply JSON and the judge body read structurally')
  const body=stage.promptJson(preview.judge.requests[0].body)
  assert.deepEqual([...body.entries.map(([key])=>key)],['model','state','questions'])
  assert.equal(body.entries[2][1].entries.length,12)
  // Not the bytes it would write back → raw: spacing, \u escapes; integer-like keys keep their order.
  for(const text of ['{"a":1, "b":2}','{"\\u4e2d":1}','{"a":1}x','[1,]'])assert.equal(stage.promptJson(text),null,text)
  assert.equal(stage.promptJsonText(stage.promptJson('{"2":1,"10":[true,null,-1.5e3,"a\\nb"]}')),'{"2":1,"10":[true,null,-1.5e3,"a\\nb"]}')
})