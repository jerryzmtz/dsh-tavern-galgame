// private fork: diagnostics show complete pack refs and never perform catalogue reads.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-asset-catalogue.js',import.meta.url),'utf8')
const row=(packId,reasons,sent=true,excluded=null)=>({ref:{packId,kind:'backgrounds',assetId:'classroom'},asset:{name:'教室'},packName:packId,reasons,sent,excluded})
test('blue constant, green keyword/carry/opening and gray excluded use v2 diagnostics',()=>{
  const ctx={};vm.runInNewContext(source,ctx)
  for(const [reasons,sent,excluded,lamp] of [[['constant'],true,null,'blue'],[['keyword'],true,null,'green'],[['carried'],true,null,'green'],[['opening'],true,null,'green'],[['constant'],false,'disabled','off']])assert.equal(ctx.forkCatalogueLamp(row('pack',reasons,sent,excluded)).id,lamp)
  assert.notEqual(ctx.forkCatalogueItemKey(row('one',[])),ctx.forkCatalogueItemKey(row('two',[])))
  // private fork (alias-label, owner 2026-10): the green words hit is called 触发词 everywhere; a judge pick is not a word hit.
  assert.equal(ctx.forkCatalogueLamp(row('pack',['hard-trigger'])).label,'触发词')
  assert.equal(ctx.forkCatalogueLamp(row('pack',['judge'])).label,'判断模型') // private fork (judge key, owner 2026-10): renamed
})
test('director lamp list retains both same-named refs and performs no store fetch',async t=>{
  const r=assetRenderer();t.after(()=>r.dispose());const ctx={React:r.React};vm.runInNewContext(source,ctx)
  r.render(ctx.ForkCatalogueDiagnostics,{state:{result:{catalogueDiagnostics:{rows:[row('one',['constant']),row('two',['keyword'])],diagnostics:[{packId:'missing',code:'pack-missing'}]}}}})
  const tree=await r.settle()
  assert.match(text(tree),/one\/backgrounds\/classroom/);assert.match(text(tree),/two\/backgrounds\/classroom/)
  assert.equal(walk(tree).filter(n=>n.type==='li').length,2)
  assert.match(text(tree),/pack-missing/)
  assert.doesNotMatch(source,/useForkEffectiveAssets|useForkAssetLibraries|ForkRecallEditor|saveStage|rpc\(/)
})
