// private fork (prompt labels / tool schema view / hit area, owner 2026-10): 舞台设置 › 提示词 names every director section
// (nothing falls back to 其他内容; the turn-local inputs sit in 剧情), says where a piece goes in words (系统 / 本轮消息 /
// 工具) with a (?), reads the op and tool schemas as parameter cards with 「查看原文」 giving the text as sent, and opens a
// row from anywhere on its head except its other controls. Synthetic fixtures only.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer} from './fixtures/asset-editor-renderer.mjs'
import {stageSource} from './harness/card-centric-stage.mjs'
import {performanceFixture} from './helpers/performance-director-fixture.mjs'
import {buildAssetPackRequest} from '../tavern-plugin/lib/domain/stage-asset-pack-director.js'

const {source,picker}=await stageSource()
function helpers(){
  const r=assetRenderer(),context={TextEncoder,setTimeout,clearTimeout,setInterval,clearInterval,Date,
    localStorage:{getItem:()=>null,setItem(){}},sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(source+';this.create=createForkAssetPackUI;',context)
  context.React=r.React;vm.runInNewContext(picker,context)
  const views=context.create(r.React,{VoicePicker:context.ForkBubbleLibraryPicker,AvatarImage:p=>r.React.createElement('img',p),emotions:{moods:[],palette:['#111111'],max:8}})
  return {r,stage:views.stage}
}
const nodes=(node,out=[])=>{if(node&&typeof node==='object'){out.push(node);for(const child of node.children||[])nodes(child,out)}return out}
const text=node=>typeof node==='string'||typeof node==='number'?String(node):(node?.children||[]).map(text).join('')
const byClass=(tree,name)=>nodes(tree).filter(node=>String(node.props?.className||'').split(' ').includes(name))
const wireOf=async stage=>{const perf=await performanceFixture(),request=buildAssetPackRequest(perf.prepare(),true,undefined,'',true);return {request,wire:stage.directorWire(JSON.parse(JSON.stringify(request)))}}

test('every director section tag has a label; turn-local inputs sit in 剧情', async t=>{
  const {r,stage}=helpers();t.after(()=>r.dispose())
  const director=await readFile(new URL('../tavern-plugin/lib/domain/stage-asset-pack-director.js',import.meta.url),'utf8')
  const keys=[...new Set([...director.matchAll(/\bsection\('([a-z][\w.-]*)'/g)].map(m=>m[1]))]
  assert.ok(keys.length>=12&&keys.includes('music-state')&&keys.includes('cue-guidance')&&keys.includes('state-hints'),keys.join())
  for(const key of [...keys.filter(key=>!key.endsWith('.')),'style.lead','command-schema','tool-frame','progress'])assert.notEqual(stage.directorPieceName(key,'',key),'其他内容',key)
  assert.equal(stage.directorPromptRow('admission-command-guidance'),'guidance')
  assert.equal(stage.directorPieceName('admission-command-guidance','',''),'本轮可用指令')
  for(const key of ['music-state','cue-guidance','state-hints'])assert.equal(stage.directorPromptRow(key),'story',key)
  assert.deepEqual(['music-state','cue-guidance','state-hints'].map(key=>stage.directorPieceName(key,'',key)),['音乐状态','场景提示','状态提示'])
  const {wire}=await wireOf(stage),pieces=wire.rows.flatMap(row=>row.pieces)
  assert.ok(!pieces.some(piece=>piece.name==='其他内容'))
  const music=pieces.find(piece=>piece.key==='music-state')
  assert.ok(music,'fixture sends music_state');assert.equal(music.row,'story');assert.equal(music.at,'user')
  assert.ok(!wire.rows.find(row=>row.id==='protocol').pieces.some(piece=>piece.key==='music-state'))
})

test('place tags read 系统 / 本轮消息 / 工具, each with a one-sentence (?)', t=>{
  const {r,stage}=helpers();t.after(()=>r.dispose())
  for(const [at,label] of [['system','系统'],['user','本轮消息'],['tools','工具']]){
    const tree=stage.PromptAt({at})
    assert.equal(text(byClass(tree,'ap-prompt-at')[0]),label)
    const help=nodes(tree).find(node=>typeof node.props?.text==='string'&&node.props.text.startsWith(label+'：'))
    assert.ok(help,label+' (?)')
  }
  assert.match(nodes(stage.PromptAt({at:'user'})).find(node=>typeof node.props?.text==='string').props.text,/缓存前缀之外，不影响缓存命中/)
})

// private fork (prompt panel D′, owner 2026-10): one row per command target, one line per verb carrying its own
// arguments; optional ones in one dashed 「可选」 box, mutually exclusive ones (the registry's `exclusive`) joined by 或;
// `name:` only where the value does not say which argument it is; asset chips count this turn's options.
test('指令参数格式 reads like the commands: target rows, verb lines, own arguments; 查看原文 gives the text as sent', async t=>{
  const {r,stage}=helpers();t.after(()=>r.dispose())
  const {request,wire}=await wireOf(stage)
  const schema=wire.rows.find(row=>row.id==='commands').pieces.find(piece=>piece.key==='command-schema')
  const ops=schema.items.map(item=>JSON.parse(item)),opName=op=>op.properties.op.const??op.properties.op.pattern
  const tree=r.render(stage.PromptOps,{items:schema.items,raw:false,mods:schema.mods,described:schema.described,choices:schema.choices})
  const lines=byClass(tree,'ap-cmd-line'),targets=byClass(tree,'ap-cmd-target').map(text)
  assert.equal(lines.length,schema.items.length,'one line per command')
  assert.deepEqual(targets,[...new Set(targets)],'one row per target')
  assert.deepEqual(new Set(targets),new Set(ops.map(op=>opName(op).split('.').slice(0,-1).join('.'))))
  const lineOf=name=>lines.find(line=>byClass(line,'ap-cmd-verb')[0].props.title.split(/[ \n]/)[0]===name)
  // The verb is the command's last word; its hover is the full command name with the registry's Chinese label and help.
  const weatherOp=ops.find(op=>Array.isArray(op.properties.weather?.enum)),weather=lineOf(opName(weatherOp)),info=stage.commandInfo(opName(weatherOp))
  assert.ok(weather,'weather command')
  assert.ok(/\p{Script=Han}/u.test(info.title)&&/\p{Script=Han}/u.test(info.group),info.title+' / '+info.group)
  const verb=byClass(weather,'ap-cmd-verb')[0]
  assert.equal(text(verb),opName(weatherOp).split('.').at(-1))
  assert.ok(verb.props.title.startsWith(opName(weatherOp)+' · '+info.title)&&verb.props.title.includes(info.help),verb.props.title)
  // A value set is one segmented chip; its name is left out when it repeats a word of the command.
  assert.deepEqual(nodes(byClass(weather,'ap-cmd-set')[0]).slice(1).map(text),weatherOp.properties.weather.enum.map(String))
  assert.equal(byClass(weather,'ap-cmd-key').length,0)
  // An asset reads as its kind with how many this turn offers (a button opening them); a value set beside it is named;
  // null reads 空; the optional arguments sit in one 「可选」 box.
  const sceneOp=ops.find(op=>Array.isArray(op.properties.time?.enum)&&op.properties.time.enum.includes(null)),scene=lineOf(opName(sceneOp))
  const backgrounds=wire.rows.find(row=>row.id==='catalogue').pieces.filter(piece=>/^catalogue\.backgrounds\./.test(piece.key)).length
  assert.ok(backgrounds>0,'fixture lists backgrounds')
  const asset=byClass(scene,'ap-cmd-asset')[0]
  assert.equal(asset.type,'button');assert.equal(text(asset),'背景 '+backgrounds)
  assert.ok(byClass(scene,'ap-cmd-key').map(text).includes('time'))
  assert.ok(nodes(byClass(scene,'ap-cmd-set')[0]).map(text).includes('空'))
  const optional=Object.keys(sceneOp.properties).filter(key=>key!=='op'&&!sceneOp.required.includes(key))
  assert.equal(byClass(scene,'ap-cmd-optional').length,optional.length?1:0)
  if(optional.length)assert.equal(text(byClass(scene,'ap-cmd-optional-label')[0]),'可选')
  assert.equal(byClass(byClass(scene,'ap-cmd-optional')[0],'ap-cmd-arg').length,optional.length)
  // Without this turn's options the chip is just the kind.
  const bare=r.render(stage.PromptOps,{items:[JSON.stringify(sceneOp)]})
  assert.equal(text(byClass(bare,'ap-cmd-asset')[0]),'背景');assert.notEqual(byClass(bare,'ap-cmd-asset')[0].type,'button')
  // The description the model gets is the argument's hover, not main-pane text.
  const described=ops.flatMap(op=>Object.entries(op.properties)).find(([,s])=>s.description)
  assert.ok(described,'fixture has a parameter description')
  assert.ok(byClass(tree,'ap-cmd-arg').some(node=>node.props.title===described[0]+' — '+described[1].description))
  assert.ok(!text(tree).includes(described[1].description),'not as main-pane text')
  // Arguments the registry marks mutually exclusive read 「a 或 b」 inside the optional box; without the mark, each stands alone.
  const pick={type:'object',properties:{op:{const:'zzz.pick'},who:{type:'string'},left:{type:'boolean'},after:{type:'integer',minimum:1}},required:['op','who']}
  const alone=r.render(stage.PromptOps,{items:[JSON.stringify(pick)]})
  assert.equal(byClass(alone,'ap-cmd-or').length,0)
  const either=r.render(stage.PromptOps,{items:[JSON.stringify(pick)],described:[{name:'zzz.pick',exclusive:[['left','after']]}]})
  assert.equal(byClass(either,'ap-cmd-or').length,1);assert.equal(text(byClass(either,'ap-cmd-alt')[0]).replace(/\s/g,''),'lefttrue或after≥1') // the colon after a name is CSS
  // The registry's own declaration (cast.add: position or after) reads the same; a describe() row without it wins.
  const castAdd=ops.find(op=>opName(op)==='cast.add'&&op.properties.position&&op.properties.after)
  assert.ok(castAdd,'fixture offers cast.add with position and after')
  {
    assert.equal(byClass(r.render(stage.PromptOps,{items:[JSON.stringify(castAdd)]}),'ap-cmd-or').length,1)
    assert.equal(byClass(r.render(stage.PromptOps,{items:[JSON.stringify(castAdd)],described:[{name:'cast.add'}]}),'ap-cmd-or').length,0)
  }
  // A mod command groups under 「模组 · <its mod>」 by the registry's ownership (describe() `mod`, named by the preview), even
  // when that mod sent no prompt piece; a mod without a name is still 模组, never 其他.
  {
    const owned=stage.commandInfo('mod.dsh.items',[],[{name:'mod.dsh.items',source:'mod',mod:{id:'dsh.items',commandId:'item',name:'物品演出'}}])
    assert.equal(owned.group,'模组 · 物品演出');assert.equal(owned.title,'物品演出')
    const sent=stage.commandInfo('mod.dsh.items',[{modId:'dsh.items',modName:'物品演出',commands:{}}],[{name:'mod.dsh.items',source:'mod',mod:{id:'dsh.items',commandId:'item'}}])
    assert.equal(sent.group,'模组 · 物品演出')
    assert.equal(stage.commandInfo('mod.dsh.items',[],[{name:'mod.dsh.items',source:'mod',mod:{id:'dsh.items',commandId:'item'}}]).group,'模组')
    const tree=r.render(stage.PromptOps,{items:[JSON.stringify({type:'object',properties:{op:{const:'mod.dsh.items'}},required:['op']})],described:[{name:'mod.dsh.items',source:'mod',mod:{id:'dsh.items',commandId:'item',name:'物品演出'}}]})
    assert.ok(text(tree).includes('模组 · 物品演出')&&!text(tree).includes('其他'),text(tree))
  }
  // An unknown command still reads from its schema alone: its target, its verb, `name:` and the range.
  const unknown=r.render(stage.PromptOps,{items:[JSON.stringify({type:'object',properties:{op:{const:'zzz.frob'},n:{type:'integer',minimum:2}},required:['op','n']})],raw:false})
  assert.deepEqual([text(byClass(unknown,'ap-cmd-target')[0]),text(byClass(unknown,'ap-cmd-verb')[0]),text(byClass(unknown,'ap-cmd-key')[0]),text(byClass(unknown,'ap-cmd-val')[0])],['zzz','frob','n','≥2'])
  assert.ok(!nodes(tree).some(node=>node.type==='pre'),'no raw JSON until asked')
  assert.equal(text(nodes(r.render(stage.PromptOps,{items:schema.items,raw:true})).find(node=>node.type==='pre')),schema.text,'raw view is the text exactly as sent')
  // 查看原文 sits on the piece's header line.
  const piece=r.render(function Pieces(p){return r.React.createElement('div',null,...stage.PromptPieces(p))},{pieces:[schema]})
  const head=byClass(piece,'ap-prompt-piece-head')[0],toggle=nodes(head).find(node=>node.type==='button'&&text(node)==='查看原文')
  assert.ok(toggle,'toggle on the header');assert.equal(toggle.props['aria-pressed'],false)
  toggle.props.onClick({stopPropagation(){}})
  assert.equal(text(nodes(r.render()).find(node=>node.type==='pre')),schema.text)
  // The token count is still the raw text's.
  assert.equal(schema.tokens,stage.promptTokenEstimate(schema.text))
  // Not op schemas → the raw lines.
  assert.ok(nodes(r.render(stage.PromptOps,{items:['{"a":1}']})).some(node=>node.type==='pre'))
  // 工具定义: the tool and its parameters; the op list is a count; raw pieces when asked.
  const tool=wire.rows.find(row=>row.id==='tool'),defs=stage.promptToolDefs(tool)
  assert.deepEqual(defs.map(def=>def.name),request.tools.map(tool=>tool.name))
  const tools=r.render(stage.PromptTools,{row:tool,defs,raw:false})
  assert.equal(text(byClass(tools,'ap-schema-name')[0]),'stage_update')
  assert.ok(nodes(tools).some(node=>node.type==='code'&&text(node)==='beats'))
  assert.ok(text(tools).includes('导演指令 '+schema.items.length+' 条之一'))
  assert.ok(stage.PromptTools({row:tool,defs,raw:true}).props.pieces===tool.pieces,'raw: the pieces as sent')
  assert.equal(stage.promptToolDefs({pieces:[{key:'tools',text:'not json'}]}),null)
  assert.equal(stage.promptToolDefs({tools:[{name:'x'}],pieces:[]}),null)
})

test('素材清单 reads as entries (name, note, variants; the handle only in the raw text); 查看原文 gives each text as sent', async t=>{
  const {r,stage}=helpers();t.after(()=>r.dispose())
  const one=stage.catalogueEntries(JSON.stringify({directorNote:'Event CG.',label:'CG·吃饭',ref:'cg-吃饭~a5t2',variants:{default:'base',entries:[{id:'base',name:'扒饭'}]},focus:[{key:'face',label:'脸部'}]}))
  assert.equal(one.length,1);assert.equal(one[0].label,'CG·吃饭');assert.equal(one[0].ref,'cg-吃饭~a5t2');assert.equal(one[0].note,'Event CG.')
  assert.deepEqual({...one[0].variants[0]},{key:'base',label:'扒饭',note:'',fallback:true})
  assert.equal(one[0].extra[0][1],'脸部')
  for(const variants of [[{key:'base',label:'Old'}],{default:'missing',entries:[{id:'base',name:'Base'}]},{default:'base',entries:[{id:'base',name:'Base',content:{media:'hidden'}}]}])assert.equal(stage.catalogueEntries(JSON.stringify({ref:'hidden~1',label:'Invalid',variants})),null)
  const cast=stage.catalogueEntries(JSON.stringify({'fish~x1':{name:'大肥鱼',outfits:[{guidance:'日常',key:'default',label:'女仆装'}]}}))
  assert.equal(cast[0].ref,'fish~x1');assert.equal(cast[0].label,'大肥鱼');assert.equal(cast[0].variants[0].note,'日常')
  assert.equal(stage.catalogueEntries(JSON.stringify([{id:'a~1',name:'A'},{id:'b~2',name:'B'}])).map(entry=>entry.ref).join(),'a~1,b~2')
  // Shapes this view does not know stay verbatim.
  assert.equal(stage.catalogueEntries('{"ref":"x","extra":{"deep":1}}'),null)
  assert.equal(stage.catalogueEntries('not json'),null)
  const {wire}=await wireOf(stage),row=wire.rows.find(row=>row.id==='catalogue')
  assert.ok(row&&row.pieces.length,'fixture sends a catalogue')
  const ctx={packs:[],binding:{globalEnabledPackIds:[]},ext:{assetBindings:{boundPackIds:[]}},nav:null}
  const tree=r.render(stage.PromptCatalogue,{ctx,pieces:row.pieces,raw:false})
  assert.ok(byClass(tree,'ap-pcat-entry').length>=row.pieces.length)
  assert.ok(!byClass(tree,'ap-prompt-raw-list').length,'no raw lines until asked')
  // The handle is only in the raw text.
  assert.ok(!text(tree).includes('synthetic-ba~'),'no handle line')
  const raw=r.render(stage.PromptCatalogue,{ctx,pieces:row.pieces,raw:true})
  assert.deepEqual(byClass(raw,'ap-prompt-raw').map(text).sort(),[...row.pieces].map(piece=>piece.text).sort(),'raw view is each text exactly as sent')
})

test('the whole row head toggles, except its other controls and portalled popovers', t=>{
  const {r,stage}=helpers();t.after(()=>r.dispose())
  const head={contains:node=>node.inHead===true}
  const el=(closest,inHead=true)=>({inHead,closest:()=>closest})
  const control={inHead:true},outside={inHead:false}
  assert.equal(stage.promptHeadClick({currentTarget:head,target:el(null)}),true,'empty space, name, tokens, scope')
  assert.equal(stage.promptHeadClick({currentTarget:head,target:el(control)}),false,'pencil, (?), the chevron button itself')
  assert.equal(stage.promptHeadClick({currentTarget:head,target:el(null,false)}),false,'a popover portalled out of the head')
  assert.equal(stage.promptHeadClick({currentTarget:head,target:el(outside)}),true,'a control outside the head does not count')
})
