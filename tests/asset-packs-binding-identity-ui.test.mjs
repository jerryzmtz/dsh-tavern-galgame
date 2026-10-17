// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
// private fork: object insertion order is not figure identity or the selected option value.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
let source=await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-ui.js',import.meta.url),'utf8')
// private fork: production shared colour contract.
source=source.split('// @include-shared figure-auto-color.cjs').join(await readFile(new URL('../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8'));
source=source.split('// @include-shared asset-image-publication.cjs').join(await readFile(new URL('../tavern-plugin/shared/asset-image-publication.cjs',import.meta.url),'utf8'));
// private fork: UI and transcript evaluate the same pure avatar resolver.
source=source.split('// @include-protocol director-commands.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8'));
source=source.split('// @include-domain pack-avatar.cjs').join(withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs',import.meta.url),'utf8')));
// private fork (voice v4 P1): the figure voice page is its own included module.
for(const name of ['figure','spine','import','voice','card','opening','character','engine','entry','gen','catalogue','setup']) source=source.split('// @include fork-asset-pack-'+name+'-ui.js').join(await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-'+name+'-ui.js',import.meta.url),'utf8'))
// private fork: the shared ForkSpinner is bundled before the asset views (main.js).
// private fork: new settings controls use the same production declaration validator.
for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */){const included=await readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8');source=source.replace('// @include '+name,()=>included)}
source=forkSpinnerSource+'\n'+source

// private fork: card binding selectors are retired, not renamed. Unknown story names are silent placeholders.
function noCardBindings(tree) {
  const labels=walk(tree).flatMap(node=>[node.props.title,node.props['aria-label']]).filter(Boolean).join(' ')
  assert.doesNotMatch(text(tree)+' '+labels,/尚未绑定人物|绑定的人物已缺失|人物缺失|本卡角色|创建并编辑|新建「路人」/)
  assert.equal(walk(tree).some(node=>node.props.className==='ap-cast-warning'||/ap-cast-badge.*is-warning/.test(node.props.className||'')),false)
  for(const row of walk(tree).filter(node=>node.props.className==='ap-cast-row'))assert.doesNotMatch(text(row),/⚠/)
}
for(const ready of [false,true]) test('stage settings have no unbound-role warnings or create-and-bind footer; ready='+ready,async t=>{
  const r=assetRenderer();t.after(()=>r.dispose())
  const context={React:r.React,document:{activeElement:null},setInterval,clearInterval,setTimeout,clearTimeout}
  vm.runInNewContext(source+';this.views=createForkAssetPackUI;',context)
  const calls=[],figure={id:'figure',name:'Figure',enabled:true,appearance:'live2d',recall:{mode:'keyword',keywords:[]},outfits:[]}
  const card={revision:'r1',raw:{first_mes:'@bubble:passerby|路人|calm|Hello'},extension:{schemaVersion:1,assetBindings:{boundPackIds:['pack']}}}
  const binding={rpc:async method=>{calls.push(method);return method==='getAssetEngineSettings'?{values:{},revision:'e1'}:card},service:{listPackSummaries:async()=>[{manifest:{id:'pack',name:'Pack',assets:[],figures:['figure']},figures:{figure},sprites:{}}]}}
  r.render(context.views(r.React).StagePage,{binding,ready,path:'card.json',cardName:'Card'})
  const tree=await r.settle();noCardBindings(tree)
  assert.equal(walk(tree).some(node=>node.props['aria-label']==='打开角色 路人'),false)
  assert.equal(calls.some(method=>/searchCardFigures|createCardFigure/.test(method)),false)
  // private fork (stage setup wizard, owner 2026-10-15): 舞台设置 has no 人物 section; library figures stay reachable through the pack row.
  if(ready)assert.ok(walk(tree).some(node=>node.props.className==='ap-pack-name'&&text(node)==='Pack'),'library figures remain reachable without a card cast')
})
for(const narrow of [false,true]) test('figure properties expose lamps/aliases/appearance, never 本卡角色; narrow='+narrow,async t=>{
  const r=assetRenderer();t.after(()=>r.dispose())
  const context={React:r.React,document:{activeElement:null},setInterval,clearInterval,setTimeout,clearTimeout}
  vm.runInNewContext(source+';this.views=createForkAssetPackUI;',context)
  const figure={id:'figure',name:'Figure',enabled:true,appearance:'live2d',recall:{mode:'keyword',keywords:[]},outfits:[]}
  const pack={manifest:{id:'pack',name:'Pack'},revision:'p1',figures:{figure},sprites:{}}
  r.render(context.views(r.React).FigureDetail,{binding:{service:{}},pack,figure,narrow,commitFigure:async()=>{}})
  const tree=await r.settle();noCardBindings(tree)
  // private fork (figure-editor r4): the figure's names are one chip list (its inline ＋ field), the old separate list merged in.
  // private fork (alias-label, owner 2026-10): that one list (data `aliases`) is labelled 「触发词」, named 人物触发词; no 别名 label.
  assert.equal(walk(tree).filter(node=>node.props['aria-label']==='添加人物触发词').length,1)
  assert.equal(walk(tree).some(node=>node.props['aria-label']==='添加别名'||node.props['aria-label']==='人物别名'),false)
  assert.ok(walk(tree).some(node=>(node.props['aria-label']||'').startsWith('人物灯：'))) // private fork (UI standard phase 2 batch 6): the 人物灯 is the one LampMenu
  assert.equal(walk(tree).some(node=>node.props.role==='switch' && /启用/.test(node.props['aria-label']||'')),false)
})
test('retired cast popovers and binding property labels are absent from production source',()=>{
  assert.doesNotMatch(source,/尚未绑定人物|本卡角色|创建并编辑|function CastEntrySheet|function FigurePicker|function StageCreateFigure/)
})
