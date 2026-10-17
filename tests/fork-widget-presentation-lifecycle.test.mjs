// private fork: presentation is host-owned, ephemeral and independent of semantic state.
import test from 'node:test'
import assert from 'node:assert/strict'
import {forkWidgetPresentationState as initial,forkReduceWidgetPresentation as reduce,forkWidgetAttention as attention} from '../tavern-plugin/src/client/fork-widget-presentation.cjs'
const cursor=(page,turn=1)=>({turn,page,para:page+1,generation:'branch-1',currentRef:'a'})
const item=(key='a',token='one',side='in')=>({key,source:true,notifications:'changes',event:{token,side,para:2}})
const content=(state,page,items=[item()],extra={})=>reduce(state,{type:'content',cursor:cursor(page),live:true,items,...extra})
test('first content is compact; updates never override open/hidden, and collapse never removes content',()=>{
 let state=content(initial(),0)
 assert.equal(state.entries.get('a').requestedState,'compact')
 state=reduce(state,{type:'open',key:'a'});state=content(state,1,[item('a','two')])
 assert.equal(state.entries.get('a').requestedState,'open')
 state=reduce(state,{type:'hide',key:'a'});state=content(state,2,[item('a','three')])
 assert.equal(state.entries.get('a').requestedState,'hidden');assert.equal(state.entries.get('a').active,true)
 assert.equal(initial().entries.size,0)
})
test('pin survives page boundaries but not a second open or explicit collapse; expiry is never delayed',()=>{
 let state=content(initial(),0,[item(),item('b')]);state=reduce(state,{type:'open',key:'a'});state=reduce(state,{type:'pin',key:'a'})
 state=content(state,1,[item(),item('b')],{cursor:{...cursor(1),currentRef:null}})
 assert.equal(state.entries.get('a').requestedState,'open')
 state=reduce(state,{type:'open',key:'b'});assert.equal(state.entries.get('a').pinned,false);assert.equal(state.entries.get('a').requestedState,'compact')
 state=reduce(state,{type:'pin',key:'b'});state=content(state,2,[]);assert.equal(state.entries.get('b').active,false)
 state=content(state,3,[item('b')]);assert.equal(state.entries.get('b').requestedState,'compact');assert.equal(state.entries.get('b').pinned,false)
})
test('source deduplicates glyphs/pages, separates out/history/skip/background, and clears only revealed events',()=>{
 let state=content(initial(),0);state=content(state,1,[item('a','two')]);state=content(state,1,[item('a','two')])
 assert.equal(attention(state.entries.get('a'),cursor(1)).count,1)
 state=content(state,2,[item('a','out','out')]);state=content(state,3,[item('a','history')],{live:false})
 state=content(state,4,[item('a','skip')],{skipping:true});state=content(state,5,[item('a','background')],{suspended:true})
 assert.equal(state.entries.get('a').pending.length,1)
 state=reduce(state,{type:'open',key:'a'})
 state=reduce(state,{type:'presented',key:'a',effectiveState:'open',ready:false,tokens:['two']})
 assert.equal(state.entries.get('a').pending.length,1)
 state=reduce(state,{type:'presented',key:'a',effectiveState:'open',ready:true,tokens:['other']})
 assert.equal(state.entries.get('a').pending.length,1)
 state=reduce(state,{type:'presented',key:'a',effectiveState:'open',ready:true,tokens:['two']})
 assert.equal(state.entries.get('a').pending.length,0)
})
test('state changes use accepted event identity and actual content; performance and ticks never notify',()=>{
 const value=(token,fingerprint,extra={})=>({key:'a',notifications:'changes',fingerprint,event:{token},...extra})
 let state=content(initial(),0,[value('e1','a')]);state=content(state,1,[value('e2','a')]);assert.equal(state.entries.get('a').changed,null)
 state=content(state,2,[value('e3','b')]);assert.equal(state.entries.get('a').changed,'e3')
 state=reduce(state,{type:'open',key:'a'});state=reduce(state,{type:'presented',key:'a',ready:true,effectiveState:'open',version:'e3'})
 state=content(state,3,[value('e4','c',{performance:true})]);assert.equal(state.entries.get('a').changed,null)
})
test('page interruption collapses unpinned open; generation invalidation and live turn boundaries clear attention',()=>{
 let state=content(initial(),0);state=reduce(state,{type:'open',key:'a'});state=content(state,1,[item('a','two')])
 state=content(state,2,[item('a','two')],{cursor:{...cursor(2),currentRef:null}})
 assert.equal(state.entries.get('a').requestedState,'compact')
 state=content(state,0,[item('a','three')],{cursor:{...cursor(0),generation:'replacement'}})
 assert.equal(state.entries.get('a').pending.length,0)
})
test('restoring content is static, hidden survives expiry, and historical attention cannot expose future pages',()=>{
 let state=content(initial(),0);state=reduce(state,{type:'hide',key:'a'})
 state=content(state,1,[item('a','new')]);assert.equal(attention(state.entries.get('a'),cursor(0)).count,0)
 state=content(state,2,[]);state=content(state,3,[item('a','new')],{restoring:true})
 assert.equal(state.entries.get('a').requestedState,'hidden');assert.equal(state.entries.get('a').pending.length,0)
 state=content(state,4,[item('a','while-disabled')],{restoring:true})
 assert.equal(state.entries.get('a').pending.length,0)
 const before=state.entries.get('a').requestedState
 state=content(state,0,[item('a','next-turn')],{cursor:cursor(0,2)})
 assert.equal(state.entries.get('a').requestedState,before)
 assert.equal(state.entries.get('a').pending.some(event=>event.turn===1),false)
})
test('first forward state set has a dot, but initial hydration and notifications none do not',()=>{
 const value={key:'clock',fingerprint:'state',notifications:'changes',event:{token:'set-1'}}
 let state=content(initial(),0,[]);state=content(state,1,[value])
 assert.equal(state.entries.get('clock').changed,'set-1')
 assert.equal(content(initial(),1,[value]).entries.get('clock').changed,null)
 assert.equal(content(content(initial(),0,[]),1,[{...value,notifications:'none'}]).entries.get('clock').changed,null)
})
test('the preference map evicts inactive LRU entries at 64 without modifying previous state',()=>{
 let state=initial()
 for(let i=0;i<100;i++)state=content(state,i,[item(String(i),'token'+i)])
 assert.equal(state.entries.size,64);assert.equal(state.entries.has('0'),false)
 const before=state;const next=reduce(state,{type:'hide',key:'99'})
 assert.equal(before.entries.get('99').requestedState,'compact');assert.equal(next.entries.get('99').requestedState,'hidden')
})

test('a genuine state update at the current live page notifies, but no-op and restored updates do not',()=>{
 const update=(token,value)=>({key:'a',source:false,notifications:'changes',fingerprint:value,event:{token,para:1}})
 const hydrated=content(content(initial(),0,[]),0,[update('hydrated','one')]);assert.equal(hydrated.entries.get('a').changed,null)
 let state=content(initial(),0,[update('initial','one')]);state=content(state,0,[update('current','two')])
 assert.equal(state.entries.get('a').changed,'current')
 state=reduce(state,{type:'open',key:'a'});state=reduce(state,{type:'presented',key:'a',effectiveState:'open',ready:true,version:'current'})
 state=content(state,0,[update('no-op','two')]);assert.equal(state.entries.get('a').changed,null)
 state=content(state,0,[update('restored','three')],{restoring:true});assert.equal(state.entries.get('a').changed,null)
})

// private fork: a live visit, not the render that happened to turn the page, owns source freshness.
test('same-page late source notifies once after forward live navigation',()=>{
 let state=content(initial(),0,[{...item(),event:null}]);state=content(state,1,[{...item(),event:null}])
 state=content(state,1,[item('a','accepted-late')]);assert.equal(attention(state.entries.get('a'),cursor(1)).count,1)
 state=content(state,1,[item('a','accepted-late')]);assert.equal(state.entries.get('a').pending.length,1)
})
test('late source never notifies after hydration, history, skip, pause, restore or generation change',()=>{
 const empty=[{...item(),event:null}]
 for(const stop of [{live:false},{skipping:true},{suspended:true},{restoring:true},{cursor:{...cursor(1),generation:'replacement'}}]){
  let state=content(content(initial(),0,empty),1,empty);state=content(state,1,empty,stop)
  state=content(state,1,[item('a','late')]);assert.equal(state.entries.get('a').pending.length,0,JSON.stringify(stop))
 }
 const hydrated=content(content(initial(),1,empty),1,[item('a','late')]);assert.equal(hydrated.entries.get('a').pending.length,0)
})
