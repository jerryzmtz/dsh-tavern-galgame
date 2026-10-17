// private fork (figure-editor r6, owner 2026-10): the 「更多」 kind menu, the figure view's ⋯ (设为默认外观) and the
// shared ForkInlineField (fork-inline-field.js) — keyboard / commit contract and the factory's declaration hygiene.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import * as acorn from 'acorn'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'

const read=name=>readFile(new URL('../tavern-plugin/'+name,import.meta.url),'utf8')
let source=await read('src/client/fork-asset-pack-ui.js')
source=source.replace('// @include-shared figure-auto-color.cjs',await read('shared/figure-auto-color.cjs'))
source=source.replace('// @include-shared asset-image-publication.cjs',await read('shared/asset-image-publication.cjs'))
source=source.split('// @include-protocol director-commands.cjs').join(await read('packages/dsh-presentation-protocol/src/director-commands.cjs'))
source=source.replace('// @include-domain pack-avatar.cjs',await read('lib/domain/pack-avatar.cjs'))
for(const name of ['figure','spine','import','voice','card','opening','character','engine','entry','gen','catalogue','setup','cg'])source=source.replace('// @include fork-asset-pack-'+name+'-ui.js',await read('src/client/fork-asset-pack-'+name+'-ui.js'))
for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */){const included=await read('src/client/'+name);source=source.replace('// @include '+name,()=>included)}
const inlineSource=await read('src/client/fork-inline-field.js')

test('the asset factory declares every function name once (a later declaration silently replaced 「更多」\'s KindMenu)',()=>{
  const ast=acorn.parse(source,{ecmaVersion:'latest',sourceType:'script'})
  const factory=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='createForkAssetPackUI')
  assert.ok(factory,'createForkAssetPackUI')
  const names=factory.body.body.filter(n=>n.type==='FunctionDeclaration').map(n=>n.id.name),seen=new Set(),dup=names.filter(n=>seen.has(n)||!seen.add(n))
  assert.deepEqual(dup,[],'duplicate function declarations in the factory scope')
  assert.ok(names.includes('KindMenu')&&names.includes('FigureViewMenu'))
})

function load(t){
  const r=assetRenderer();t.after(()=>r.dispose())
  const context={React:r.React,TextEncoder,AbortController,setTimeout,clearTimeout,setInterval,clearInterval,forkForeground:{media:node=>node},
    document:{activeElement:null,addEventListener(){},removeEventListener(){}},localStorage:{getItem:()=>null,setItem(){}}}
  vm.runInNewContext(forkSpinnerSource+'\n'+source.replace('return {App,Home','return {KindMenu,FigureViewMenu,App,Home')+';this.views=createForkAssetPackUI;this.ForkInlineField=ForkInlineField;',context)
  return {r,context,views:context.views(r.React,{})}
}

test('「更多」 lists the hidden kinds by name (no counts) and picks one',async t=>{
  const {r,views}=load(t),picked=[]
  r.render(views.KindMenu,{list:['music','skins'],label:k=>({music:'音乐',skins:'舞台皮肤'})[k],onPick:k=>picked.push(k)})
  const tree=await r.settle(),items=walk(tree).filter(n=>n.props.role==='menuitem')
  assert.deepEqual(items.map(n=>text(n)),['音乐','舞台皮肤'])
  items[1].props.onClick();assert.deepEqual(picked,['skins'])
})

test('the view ⋯: 设为默认外观 (checked for the default) and the view extras only',async t=>{
  const {r,views}=load(t),calls=[]
  const open=async props=>{r.render(views.FigureViewMenu,props);let tree=await r.settle();walk(tree).find(n=>n.props['aria-label']===({sprite:'立绘',live2d:'模型',avatar:'头像'})[props.kind]+' 操作' /* private fork (model tab) */).props.onClick();return r.settle()}
  let tree=await open({kind:'sprite',isDefault:false,onDefault:()=>calls.push('default'),extras:[]})
  let items=walk(tree).filter(n=>/^menuitem/.test(n.props.role||''))
  assert.deepEqual(items.map(n=>text(n)),['设为默认外观']);assert.equal(items[0].props['aria-checked'],false)
  items[0].props.onClick();assert.deepEqual(calls,['default'])
  tree=await open({kind:'avatar',isDefault:true,onDefault:()=>calls.push('again'),extras:[{icon:'remove',label:'删除差分…',danger:true,onClick:()=>calls.push('clear')}]}) // private fork (avatar-actions): 清除上传的头像 left the ⋯
  items=walk(tree).filter(n=>/^menuitem/.test(n.props.role||''))
  assert.deepEqual(items.map(n=>text(n)),['设为默认外观','删除差分…']);assert.equal(items[0].props['aria-checked'],true)
  assert.ok(walk(tree).some(n=>n.props.role==='separator'),'a destructive extra sits after a separator')
  items[0].props.onClick();assert.deepEqual(calls,['default'],'choosing the current default writes nothing')
  items[1].props.onClick();assert.deepEqual(calls,['default','clear'])
  assert.doesNotMatch(text(tree),/上传头像|裁切|生成|导入|替换/,'no preview-card actions in the ⋯')
})

// ---------- ForkInlineField ----------
function inline(t){
  const r=assetRenderer();t.after(()=>r.dispose())
  const context={React:r.React,document:{activeElement:null,addEventListener(){},removeEventListener(){}}}
  vm.runInNewContext(inlineSource+';this.ForkInlineField=ForkInlineField;this.ForkInlineGrid=ForkInlineGrid;',context)
  return {r,Field:context.ForkInlineField,Grid:context.ForkInlineGrid}
}
const byLabel=(tree,label)=>walk(tree).find(n=>n.props['aria-label']===label)
const key=(k,extra={})=>({key:k,preventDefault(){},stopPropagation(){this.stopped=true},currentTarget:{blur(){}},...extra})

test('inline number: label and value on one row; Enter or blur commits once, validation keeps the draft, Esc cancels',async t=>{
  const {r,Field}=inline(t),commits=[]
  let props={kind:'number',label:'身高',unit:'cm',min:1,max:400,value:120,onCommit:v=>{commits.push(v)}}
  r.render(Field,props);let tree=await r.settle()
  const field=walk(tree).find(n=>/fork-inline-field/.test(n.props.className||''))
  assert.deepEqual(field.children.map(n=>n.props.className),['fork-inline-label','fork-inline-value'],'label then value, one grid row')
  assert.equal(byLabel(tree,'身高').type,'input');assert.match(text(field),/cm/)
  byLabel(tree,'身高').props.onChange({target:{value:'130'}});tree=await r.settle()
  byLabel(tree,'身高').props.onKeyDown(key('Enter'));tree=await r.settle();byLabel(tree,'身高').props.onBlur();tree=await r.settle()
  assert.deepEqual(commits,[130],'Enter commits, the blur that follows does not repeat it')
  byLabel(tree,'身高').props.onChange({target:{value:'999'}});tree=await r.settle();byLabel(tree,'身高').props.onBlur();tree=await r.settle()
  assert.deepEqual(commits,[130]);assert.equal(byLabel(tree,'身高').props['aria-invalid'],true)
  assert.match(text(walk(tree).find(n=>n.props.role==='alert')),/1–400/)
  const esc=key('Escape');byLabel(tree,'身高').props.onKeyDown(esc);tree=await r.settle()
  assert.equal(esc.stopped,true,'Esc with a pending edit stays in the field');assert.equal(byLabel(tree,'身高').props.value,'130');assert.equal(walk(tree).some(n=>n.props.role==='alert'),false)
  byLabel(tree,'身高').props.onBlur();tree=await r.settle();assert.deepEqual(commits,[130],'blur after Esc commits nothing')
  const idle=key('Escape');byLabel(tree,'身高').props.onKeyDown(idle);assert.notEqual(idle.stopped,true,'Esc without an edit reaches the dialog')
})

test('inline menu, colour, chips and link',async t=>{
  const {r,Field,Grid}=inline(t),commits=[]
  r.render(()=>r.React.createElement(Grid,{label:'资料'},
    r.React.createElement(Field,{kind:'menu',label:'语言',value:'ja',options:[{value:'ja',label:'日语'},{value:'zh',label:'中文'}],onCommit:v=>commits.push(['menu',v])}),
    r.React.createElement(Field,{kind:'color',label:'形象色',value:'',auto:'#336699',palette:['#E0707C'],onCommit:v=>commits.push(['color',v])}),
    r.React.createElement(Field,{kind:'chips',label:'别名',value:['小鱼'],validate:list=>list.length>3?'最多 3 个':'',onCommit:v=>commits.push(['chips',v])}),
    r.React.createElement(Field,{kind:'link',label:'声音',value:'',placeholder:'选择声音',onOpen:()=>commits.push(['open'])})),{})
  let tree=await r.settle()
  assert.equal(walk(tree).find(n=>n.props.role==='group').props['aria-label'],'资料')
  const menu=byLabel(tree,'语言：日语');assert.equal(menu.props['aria-haspopup'],'menu');menu.props.onClick();tree=await r.settle()
  walk(tree).find(n=>n.props.role==='menuitemradio'&&text(n)==='中文').props.onClick();tree=await r.settle()
  byLabel(tree,'形象色：自动').props.onClick();tree=await r.settle();byLabel(tree,'形象色 #E0707C').props.onClick();tree=await r.settle()
  byLabel(tree,'添加别名').props.onChange({target:{value:'鱼鱼、阿鱼'}});tree=await r.settle();byLabel(tree,'添加别名').props.onKeyDown(key('Enter'));tree=await r.settle()
  byLabel(tree,'删除别名 小鱼').props.onClick();tree=await r.settle()
  byLabel(tree,'添加别名').props.onChange({target:{value:'a,b,c,d'}});tree=await r.settle();byLabel(tree,'添加别名').props.onBlur();tree=await r.settle()
  assert.match(text(walk(tree).find(n=>n.props.role==='alert')),/最多 3 个/)
  assert.equal(byLabel(tree,'声音：选择声音').props['data-empty'],true);byLabel(tree,'声音：选择声音').props.onClick()
  assert.deepEqual(JSON.parse(JSON.stringify(commits)),[['menu','zh'],['color','#E0707C'],['chips',['小鱼','鱼鱼','阿鱼']],['chips',[]],['open']])
})

test('the inline field module stands alone: React only, bundled at the outer level before the asset views',async()=>{
  const main=await read('src/client/main.js'),at=name=>main.indexOf('// @include '+name)
  assert.ok(at('fork-spinner.js')>0&&at('fork-inline-field.js')>at('fork-spinner.js')&&at('fork-inline-field.js')<at('fork-asset-pack-ui.js'))
  const context={React:{createElement:()=>null}};vm.runInNewContext(inlineSource,context)
  assert.equal(typeof context.ForkInlineField,'function');assert.equal(typeof context.ForkInlineGrid,'function')
  assert.doesNotMatch(inlineSource,/\bGlyph\(|\bPopover\b|\bh\(Help/,'no asset-library closure helpers')
})
