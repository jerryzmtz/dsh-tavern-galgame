// private fork: opaque shop -> production subscription/bridge -> native Chat -> official MVU -> next writer.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,mkdir} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {chromium} from 'playwright'
import {browserReactScript} from './fixtures/browser-react.mjs'
import {widgetChatFixture,declarations,nextWidgetTurn} from './fixtures/widget-variable-chat.mjs'
import {projectTavernHelperContext} from '../tavern-plugin/lib/domain/tavern-helper-context.js'
import {TAVERN_RUNTIME_ASSET_PREFIX,readTavernRuntimeAsset} from '../tavern-plugin/lib/domain/tavern-runtime-assets.js'
const root=new URL('../',import.meta.url)
const read=name=>readFile(new URL('tavern-plugin/src/client/'+name,root),'utf8')

test('offline two-turn purchase, deletion and rewind through real native Chat and MVU', {timeout:60000},async t=>{
  let page,finishChatInitialization,variableReads=0
  const chatInitialized=new Promise(resolve=>{finishChatInitialization=resolve})
  const h=await widgetChatFixture(t,{committed:async()=>{if(page)await page.evaluate(()=>window.wake?.())},dispatch:async({name,args,context,work})=>page.evaluate(async input=>{
    const diagnostics=[]
    try {await runtime.emit(input.name,input.args,input.context,diagnostics,input.eventId);return {handled:true,diagnostics}}
    catch(error){return {handled:false,error:error.message,diagnostics}}
  },{name,args,context,eventId:work.eventId})})
  const client=await readFile(new URL('tavern-plugin/lib/client.js',root)),mvu=await readFile(new URL('tavern-plugin/lib/vendor/magvarupdate/host-build/artifact/bundle.js',root))
  const server=createServer(async(req,res)=>{
    const path=new URL(req.url,'http://localhost').pathname
    try {
      if(path==='/client.js'||path==='/mvu.js'){res.writeHead(200,{'content-type':'text/javascript'}).end(path==='/client.js'?client:mvu);return}
      if(path.startsWith(TAVERN_RUNTIME_ASSET_PREFIX)){const asset=await readTavernRuntimeAsset(path);res.writeHead(200,{'content-type':asset.mediaType}).end(asset.body);return}
      if(path==='/version'){res.end('{"pkgVersion":"1.12.14"}');return}
      res.setHeader('content-type','text/html; charset=utf-8')
      if(path==='/shop'){res.end(`<!doctype html><p id="balance">loading</p><p id="bag"></p><button id="buy">Buy seed</button><button id="remove">Remove seed</button><p id="result"></p><script>
        let token,view,count=0;window.receipts=[];
        const send=(type,data)=>parent.postMessage({channel:'dsh-widget',version:2,token,type,...data},'*');
        addEventListener('message',event=>{if(event.source!==parent)return;const m=event.data;
          if(m.type==='init'){token=m.token;send('ready',{});}
          if(m.variables || m.type==='variables'){view=m.variables || m;document.querySelector('#balance').textContent=view.values.balance.status==='ready'?view.values.balance.value:view.values.balance.status;document.querySelector('#bag').textContent=JSON.stringify(view.values.bag.value);}
          if(m.type==='variables.result'){receipts.push(m);document.querySelector('#result').textContent=m.status;}
        });
        const propose=operations=>send('variables.propose',{requestId:'r'+(++count),contextKey:view.contextKey,revision:view.revision,operations});
        document.querySelector('#buy').onclick=()=>propose([{writeId:'balance',op:'delta',value:-5},{writeId:'bag',suffix:'/seed',op:'insert',value:1}]);
        document.querySelector('#remove').onclick=()=>propose([{writeId:'bag',suffix:'/seed',op:'remove'}]);
      </script>`);return}
      res.end('<!doctype html><div id="root"></div><script>window.__ModuleLoader__={load(d){window.client=d.factory(()=>({}));}};</script><script src="/client.js"></script>')
    }catch(error){res.writeHead(500).end(error.message)}
  })
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)))
  const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true,args:['--explicitly-allowed-ports='+server.address().port]});t.after(()=>browser.close())
  page=await browser.newPage({viewport:{width:375,height:740}})
  await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort())
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  await page.exposeFunction('hostRpc',async(method,args)=>{
    if(method==='readWidgetVariables'){const result=await h.service.read(args);await page.evaluate(count=>window.variableReadCount=count,++variableReads);return result}
    if(method==='proposeWidgetVariables'){const result=await h.service.propose(args);if(result.status!=='committed')t.diagnostic(JSON.stringify({result,diagnostics:h.diagnostics}));return result}
    if(method==='widgetVariableStatus')return h.service.status(args)
    if(method==='invalidateWidgetVariables')return h.service.invalidate(args)
    if(method==='updateTavernHelperVariables'){
      const result=args.option?.type==='global'?{updated:true}:await h.adapter.updateVariables('fixture',args.option,args.variables,0,args.eventId)
      if(args.option?.type==='chat' && !args.eventId)finishChatInitialization()
      return result
    }
    if(method==='updateTavernHelperMessages')return h.adapter.updateMessages('fixture',args.messages,0,args.eventId)
    if(method==='getTavernHelperContext')return {context:await h.adapter.context('fixture')}
    if(method==='getTavernHelperWorldbook')return {worldbook:{name:'Synthetic',entries:[]}}
    return {}
  })
  await page.goto(origin)
  const chat=await h.db.read('fixture')
  const view={chatId:'fixture',card:{name:'Synthetic shop card'},tavernHelper:projectTavernHelperContext(chat),tavernHelperWorldbook:{name:'Synthetic',entries:[]},tavernRuntimePolicy:{trustedCardMode:true},tavernMvuRuntime:{owner:'official',assetUrl:'/mvu.js'},
    tavernHelperScripts:[{id:'guard',name:'Synthetic validation',data:{},buttons:[],content:`await waitGlobalInitialized('Mvu');window.received=0;window.validated=0;eventOn('MESSAGE_RECEIVED',()=>window.received++);eventOn(Mvu.events.VARIABLE_UPDATE_ENDED,next=>{window.validated++;next.stat_data.balance=z.number().min(0).parse(next.stat_data.balance);});`}]}
  await page.evaluate(view=>{window.runtime=client.createTavernHelperScriptRuntime({rpc:hostRpc,onMutation(){},resolveError(){},reportError(_source,error){console.error(error)},async onReady(){await runtime.emit('CHAT_CHANGED',['fixture'],view.tavernHelper);window.initialized=true}});runtime.sync('fixture',view)},view)
  await page.waitForFunction(()=>window.initialized)
  await chatInitialized
  await page.addScriptTag({content:await browserReactScript()})
  await page.addScriptTag({content:`const React=modules.react, forkWidgetCount=()=>{},forkStageAudio={bind(){},release(){}};
    ${await read('fork-widget-contracts.cjs')}
    ${await read('fork-widget-media.cjs')}
    ${await read('fork-widget-theme.cjs')}
    ${await read('fork-widget-theme.js')}
    ${await read('fork-widget-setting-images.js')}
    ${await read('fork-widget-sandbox.js')}
    ${await read('fork-widget-source.js')}
    const listeners=new Set(),tavernSessionSignals={subscribe(_id,_kind,fn){listeners.add(fn);return()=>listeners.delete(fn)}};
    window.wake=()=>listeners.forEach(fn=>fn());window.turn=1;window.pageIndex=1;window.epoch=1;window.live=true;
    const root=modules['react-dom/client'].createRoot(document.querySelector('#root'));
    function Shop(){
      const widget={identity:'shop',ref:${JSON.stringify(h.input.ref)},scopeKey:'shop',definition:{contentIdentity:'shop-v1',url:'/shop',title:'Synthetic shop',document:{variables:${JSON.stringify(declarations)},presentation:{open:{width:280,height:200}}}},presentation:{state:'open',bounds:{width:280,height:200},suspended:false}};
      useForkWidgetVariables({sessionId:'fixture',source:{generation:epoch},turn,page:pageIndex,revealed:true,mode:live?'live':'history',pages:[{para:1},{para:2}],record:{pageIndex:{pages:[{page:0,para:1,offset:0},{page:1,para:2,offset:0}]}},variableRpc:hostRpc},[widget]);
      return React.createElement(ForkWidgetSandbox,{widget});
    }
    window.show=()=>root.render(React.createElement(Shop));show();`})
  const frame=()=>page.frames().find(frame=>frame.url().endsWith('/shop'))
  await page.frameLocator('iframe[title="Synthetic shop"]').locator('#buy').waitFor()
  await frame().waitForFunction(()=>document.querySelector('#balance').textContent==='20')
  await page.evaluate(()=>window.original=document.querySelector('iframe[title="Synthetic shop"]').contentWindow)
  // The fixture also exercises a late committed Helper initialization notification.
  await page.evaluate(()=>wake())
  await page.waitForFunction(()=>window.variableReadCount>=2)
  await frame().click('#buy')
  await frame().waitForFunction(()=>document.querySelector('#result').textContent!=='')
  assert.equal(await frame().evaluate(()=>document.querySelector('#result').textContent),'committed',JSON.stringify(await frame().evaluate(()=>receipts)))
  await frame().waitForFunction(()=>document.querySelector('#balance').textContent==='15')
  assert.deepEqual((await h.db.read('fixture')).messages[0].variables[0].stat_data,{balance:15,bag:{seed:1}})
  assert.equal(await page.evaluate(()=>original===document.querySelector('iframe[title="Synthetic shop"]').contentWindow),true)
  const shots=new URL('output/widget-settings/browser/',root);await mkdir(shots,{recursive:true})
  await page.screenshot({path:fileURLToPath(new URL('variables-closed-loop-375.png',shots))})
  assert.doesNotMatch(JSON.stringify(await frame().evaluate(()=>receipts)),/schema|currentVariables|diagnostics/)
  const next=await nextWidgetTurn(h)
  assert.equal(next.writer.messages[0].variables[0].stat_data.balance,15)
  assert.deepEqual(next.chat.messages.at(-1).variables[0].stat_data.bag,{seed:1})
  // A settled second turn has a deliberately different state: before its last page still show turn one.
  await h.mutate(chat=>{chat.messages.at(-1).variables[0].stat_data.balance=50;chat.messages.at(-1).mvu={receipt:{status:'updated'}};chat.messages.at(-1).mvuBaseline={swipeId:0};for(const op of Object.values(chat.timeline.operations))if(op.background)op.background.phase='completed'})
  await page.evaluate(()=>{turn=2;pageIndex=0;epoch++;show()})
  await frame().waitForFunction(()=>document.querySelector('#balance').textContent==='15')
  await page.evaluate(()=>{pageIndex=1;epoch++;show()})
  await frame().waitForFunction(()=>document.querySelector('#balance').textContent==='50')
  await frame().click('#remove')
  await frame().waitForFunction(()=>receipts.length===2 && receipts[1].status==='committed')
  assert.deepEqual((await h.db.read('fixture')).messages.at(-1).variables[0].stat_data.bag,{})
  const current=await h.db.read('fixture'),checkpoint=h.timeline.rollbackTarget({chat:current}),before=await h.db.readRevision('fixture',checkpoint.beforeRevision)
  await h.db.update('fixture',chat=>h.timeline.apply({chat,intent:{kind:'turn.rollback',beforeChat:before}}).chat)
  const rolled=await h.db.read('fixture')
  assert.equal(rolled.messages.length,1);assert.deepEqual(rolled.messages[0].variables[0].stat_data,{balance:15,bag:{seed:1}})
  await page.evaluate(()=>{turn=1;pageIndex=1;epoch++;show()})
  await frame().waitForFunction(()=>document.querySelector('#balance').textContent==='15')
  assert.deepEqual(errors,[])
  // The runtime's companion hook lives in its separate trusted frame, not in the shop.
  const counters=await Promise.all(page.frames().filter(child=>child!==page.mainFrame() && child!==frame()).map(child=>child.evaluate(()=>({received:window.received,validated:window.validated}))))
  assert.ok(counters.some(value=>value.received===0 && value.validated>=2))
  await page.evaluate(()=>runtime.dispose())
})
