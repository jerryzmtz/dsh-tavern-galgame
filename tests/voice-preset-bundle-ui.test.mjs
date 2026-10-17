// private fork: expand the shared emotion dependency in isolated client fragments.
import {withSpriteEmotionSource} from './helpers/sprite-emotion-source.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'

let source = await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-ui.js',import.meta.url),'utf8')
// private fork: production shared colour contract.
source=source.split('// @include-shared figure-auto-color.cjs').join(await readFile(new URL('../tavern-plugin/shared/figure-auto-color.cjs',import.meta.url),'utf8'));
source=source.split('// @include-shared asset-image-publication.cjs').join(await readFile(new URL('../tavern-plugin/shared/asset-image-publication.cjs',import.meta.url),'utf8'));
// private fork: UI and transcript evaluate the same pure avatar resolver.
source=source.split('// @include-protocol director-commands.cjs').join(await readFile(new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8'));
source=source.split('// @include-domain pack-avatar.cjs').join(withSpriteEmotionSource(await readFile(new URL('../tavern-plugin/lib/domain/pack-avatar.cjs',import.meta.url),'utf8')));
// private fork (voice v4 P1): the figure voice page is its own included module.
for (const name of ['figure','spine','import','voice','card','opening','character','engine','entry','gen','catalogue','setup']) source = source.split('// @include fork-asset-pack-'+name+'-ui.js').join(await readFile(new URL('../tavern-plugin/src/client/fork-asset-pack-'+name+'-ui.js',import.meta.url),'utf8'))

// private fork: the shared ForkSpinner is bundled before the asset views (main.js).
// private fork: new settings controls use the same production declaration validator.
for(const name of ['fork-widget-contracts.cjs','fork-widget-settings-ui.js','fork-mod-library.js','fork-mod-config-pages.js','fork-mod-settings.js','fork-mod-assets.js'] /* private fork: mod library lives inside the pack UI closure */){const included=await readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8');source=source.replace('// @include '+name,()=>included)}
source=forkSpinnerSource+'\n'+source
// private fork: import is independent of the global voice registry, including when TTS is absent.
for (const enabled of [true,false]) test('card import keeps figure presets in packs, TTS available: '+enabled,async t => {
  const r = assetRenderer();t.after(() => r.dispose())
  const context = {React:r.React,Uint8Array,document:{activeElement:null},setInterval,clearInterval,setTimeout,clearTimeout}, raw = {name:'Example'}
  vm.runInNewContext(source+';this.views=createForkAssetPackUI;',context)
  const card = {revision:'1',extension:{schemaVersion:1,characters:{},assetBindings:{boundPackIds:[],characters:{}}}}
  let voiceLoads = 0, serviceLoads = 0, applied = false
  const binding = {tts:enabled?{listVoices:async () => {voiceLoads++;return []},subscribe:() => () => {}}:undefined,rpc:async method => {
    if(method==='getAssetVoiceServices'){serviceLoads++;return {services:[{id:'local',kind:'reference-api',capabilities:{voiceKinds:['reference'],paid:false}}]}}
    return card
  },service:{
    listPackSummaries:async () => [],
    inspectCardBundle:async () => ({inspectionId:'preview',expectedRevision:'1',packs:[],raw,currentRaw:raw}),
    previewCardBundleDecisions:async () => ({scriptRisk:[]}),
    applyCardBundle:async input => {if (input.cancel) return {status:'cancelled'};applied=true;return {status:'committed'}},
  }}
  // private fork: rendering the advanced 舞台设置 page must not consult the global voice registry either.
  const views = context.views(r.React)
  r.render(views.StagePage,{binding,ready:true,path:'card.json',cardName:'Example'});let tree = await r.settle()
  // private fork: restored card ZIP picking stays hidden and independent of TTS availability.
  const pickers = walk(tree).filter(n => n.type === 'input' && n.props.type === 'file')
  assert.equal(pickers.length,1)
  assert.equal(pickers[0].props.accept,'.zip')
  assert.equal(pickers[0].props.hidden,true)
  assert.equal(pickers[0].props['aria-label'],'导入卡 ZIP')
  assert.equal(voiceLoads,0,'rendering the ZIP picker must not consult the global voice registry')
  // private fork (card import r3): the picked file opens the 导入卡片 sheet, which reads it; one 「导入」 (no checkbox).
  r.render(views.CardImportSheet,{binding,path:'card.json',cardName:'Example',file:{arrayBuffer:async () => new ArrayBuffer(0)},onPick(){},onClose(){},onDone(){}});tree = await r.settle()
  const dialog = walk(tree).find(n => n.props.role === 'dialog')
  assert.equal(walk(dialog).some(n => n.type === 'input'),false)
  const confirm = walk(tree).find(n => n.type === 'button' && text(n) === '\u5bfc\u5165')
  assert.equal(confirm.props.disabled,false);await confirm.props.onClick();tree = await r.settle()
  assert.equal(applied,true)
  assert.equal(voiceLoads,0,'neither initial rendering nor card import may consult the global voice registry')
  assert.equal(serviceLoads,enabled?1:0,'only machine service availability is loaded')
  assert.doesNotMatch(text(tree),/VOICE_PRESET_CONFLICT|TTS_UNAVAILABLE|Voice presets skipped/)
})
