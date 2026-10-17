import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
const read = path => readFile(new URL('../' + path, import.meta.url), 'utf8')
let definitions = await read('tavern-plugin/src/client/fork-widget-definitions.cjs')
for (const match of [...definitions.matchAll(/require\('\.\/widgets\/([a-z][a-z0-9-]*)\.cjs'\)/g)].reverse()) definitions = definitions.slice(0, match.index) + (await read('tavern-plugin/src/client/widgets/' + match[1] + '.cjs')).trim() + definitions.slice(match.index + match[0].length)
const shared = definitions + '\n' + await read('tavern-plugin/src/client/fork-widget-contracts.cjs') + '\n' + await read('tavern-plugin/src/client/fork-stage-widgets.cjs')
const client = await read('tavern-plugin/src/client/fork-gal-widgets.js')
const css = await read('tavern-plugin/lib/client-assets/fork-theme.css')
const stage = await read('tavern-plugin/src/client/fork-gal-stage.js')
const ctx = vm.createContext({ window: {}, TextEncoder, React, document: { hidden: false } })
// private fork: the component receives projected widgets, not legacy director commands.
vm.runInContext(shared + '\n' + client + `
this.renderWidget = json => {
  const {type,data} = JSON.parse(json), definition = forkWidgetBuiltins.find(value => value.id === type);
  const props = forkWidgetProps(type,data);
  const widgets = props ? [{type,props,definition,widgetId:'prop',originKey:'fixture',bornAt:0,order:0,slot:'top-center',remainingSeconds:props.remainingSeconds}] : [];
  return React.createElement(ForkGalWidgets,{owner:{items:[]}});
};`, ctx)
const props = (type, data) => ({type,data})

test('widget client: unknown types and malformed projected props never mount a card', () => {
  for (const p of [props('html',{body:'x'}),props('countdown',null)]) {
    assert.doesNotMatch(renderToStaticMarkup(ctx.renderWidget(JSON.stringify(p))), /<article/)
  }
})

test('widget client: colour/font surfaces use only stage tokens, with no component theme branches', () => {
  const block = css.split('/* ==== stage widgets:')[1].split('/* ==== end stage widgets ==== */')[0]
  assert.doesNotMatch(block, /data-theme|--gal-base-|#[0-9a-f]{3,8}\b|\b(?:rgb|rgba|hsl)\(/i)
  for (const [, name] of block.matchAll(/var\((--[a-z-]+)/g)) assert.ok(name.startsWith('--gal-ui-'), name)
  assert.match(block, /\.fork-widget-reader article[^}]+background: var\(--gal-ui-surface-2\)/)
  assert.match(block, /\.fork-widget-layer\.is-reading \{ z-index: 6;/)
})

test('widget client: narrow stage seam suppresses overlays/choices/waiting and isolates text identity', () => {
  // private fork: admitted phone/mod surfaces are independent of the retired card-level widget gate.
  assert.doesNotMatch(stage.match(/const sourceWidget = useForkWidgetStage\([\s\S]*?\}\);/)[0], /stageConfig\.widgets/)
  assert.match(stage, /paused:hidden \|\| backlog \|\| configOpen/)
  // private fork: text identity is session-owned rather than a direction-hook digest.
  assert.match(stage, /const runtime = useForkStageRuntime\(sessionId\)/)
  // private fork: suspend an existing instance, never transfer it to a second reader.
  assert.match(client, /inert:!shown/)
  assert.match(client, /key:item.identity/)
  assert.doesNotMatch(client, /localStorage|rpc\(|new Audio|fetch\(|innerHTML|dangerouslySetInnerHTML/)
})

test('widget client: the real stage seam admits phone-mod surfaces with legacy card widgets off', () => {
  // private fork: global/native admission supplies the surfaces; the shared stage only pauses their presentation.
  const call = stage.match(/const sourceWidget = (useForkWidgetStage\([\s\S]*?\}\));/)[1]
  const phone = {widgetId:'dsh.phone',modId:'dsh.phone',type:'source'}, legacy = {widgetId:'clock'}
  const input = {sessionId:'fixture',config:{stage:{widgets:false}},stageConfig:{widgets:false},props:{data:{cardPath:'cards/fixture.json'}},
    runtime:{source:{},cursor:{mode:'live'}},turn:1,pages:[],page:0,card:0,receivedDirection:{},pack:{widgets:[phone]},
    performanceLayer:{widgets:[legacy]},accepted:{presentationRevision:'native'},rootRef:{},avatarOf:null,film:false,
    typed:true,lastCard:true,current:{pending:false},reading:{reducedMotion:false},hidden:false,backlog:false,configOpen:false,
    galleryOpen:false,menuOpen:false,transitioning:false,awaiting:false,sceneHolding:false,atEnd:false,skipping:false}
  const seam = vm.createContext({...input,useForkWidgetStage:value=>value,setAuto(){},setSkipping(){}})
  const admitted = vm.runInContext(call,seam)
  assert.equal(admitted.enabled,true)
  assert.deepEqual(JSON.parse(JSON.stringify(admitted.widgets)),[phone,{...legacy,performance:true}])
  assert.equal(admitted.paused,false)
  seam.stageConfig.widgets = true
  assert.deepEqual(JSON.parse(JSON.stringify(vm.runInContext(call,seam).widgets)),JSON.parse(JSON.stringify(admitted.widgets)))
  for (const flag of ['hidden','backlog','configOpen','galleryOpen','menuOpen','transitioning','awaiting','sceneHolding']) {
    seam[flag] = true
    assert.equal(vm.runInContext(call,seam).paused,true,flag)
    seam[flag] = false
  }
  seam.atEnd = true; seam.props.Choices = true
  assert.equal(vm.runInContext(call,seam).paused,true,'choices pause the same admitted phone surface')
})
