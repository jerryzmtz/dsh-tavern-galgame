// private fork: only accepted marked canonical text before the current reading cursor is shared.
import test from 'node:test'
import assert from 'node:assert/strict'
import {forkWidgetThread as select} from '../tavern-plugin/src/client/fork-widget-thread.cjs'
const ref={packId:'one',kind:'widgets',assetId:'phone'}
const row=(turn,count=1,text='hello')=>({turn,sourceKey:'source-'+turn,pages:Array.from({length:count},(_,i)=>({para:i+1,kind:'line',alias:'a',text})),record:{token:{bindingKey:'binding-'+turn,generation:1},phase:'done',through:count,entries:Array.from({length:count},(_,i)=>({at:i+1,ops:[{op:'widget.source',ref,contact:'a',side:'in'}]}))}})
const cursor=(turn=2,page=0)=>({turn,page,para:page+1})
test('cross-turn paragraph IDs are distinct; current page is revealed only and later turns are never included',()=>{
 const rows=[row(1),row(2,3),row(3)]
 const result=select({rows,ref,cursor:cursor(),visibleText:'he'})
 assert.deepEqual(result.messages.map(m=>[m.turn,m.para,m.text]),[[1,1,'hello'],[2,1,'he']])
 assert.equal(new Set(result.messages.map(m=>m.id)).size,2);assert.equal(result.current.revealed,false)
 assert.deepEqual(select({rows,ref,cursor:cursor(1),visibleText:'h'}).messages.map(m=>m.text),['h'])
})
test('latest frozen contact chooses the thread, full refs isolate identical namespaces, and drafts have no text',()=>{
 const rows=[row(1,2),row(2)];rows[1].record.entries[0].ops[0].contact='b'
 assert.deepEqual(select({rows,ref,cursor:cursor(),visibleText:'B'}).messages.map(m=>m.contact),['b'])
 rows[1].record.phase='running'
 assert.equal(select({rows,ref,cursor:cursor()}).messages.length,2)
 assert.equal(select({rows,ref:{...ref,packId:'other'},cursor:cursor()}).messages.length,0)
})
test('same-paragraph pages coalesce and preserve current cursor clipping',()=>{
 const a=row(1);a.pages=[{para:1,kind:'line',alias:'a',text:'First',anchor:{offset:0}},{para:1,kind:'line',alias:'a',text:'Second SECRET',anchor:{offset:5}}]
 const result=select({rows:[a],ref,cursor:{turn:1,page:1,para:1},visibleText:'Sec',revealed:true})
 assert.equal(result.messages.length,1);assert.equal(result.messages[0].text,'FirstSec');assert.equal(result.current.revealed,true)
})
test('20 turns, 80 messages, 64 KiB aggregate and 8 KiB Unicode-safe per line bounds',()=>{
 const rows=Array.from({length:25},(_,i)=>row(i+1))
 const recent=select({rows,ref,cursor:cursor(25),visibleText:'hello',limited:true})
 assert.equal(recent.messages.length,20);assert.equal(recent.messages[0].turn,6);assert.equal(recent.hasEarlier,false);assert.equal(recent.historyStatus,'limited')
 const many=select({rows:[row(1,90)],ref,cursor:cursor(1,89),visibleText:'hello'})
 assert.equal(many.messages.length,80);assert.equal(many.hasEarlier,true)
 const large=select({rows:[row(1,40,'😀'.repeat(3000))],ref,cursor:cursor(1,39),visibleText:'😀'.repeat(3000)})
 assert.ok(large.messages.length<8);assert.ok(Buffer.byteLength(JSON.stringify(large.messages))<=65536)
 assert.ok(large.messages.every(m=>Buffer.byteLength(m.text)===8192 && m.truncated && !/[\uD800-\uDBFF]$/.test(m.text)))
})

test('a completed display page does not acknowledge a still-future part of the same paragraph',()=>{
 const a=row(1);a.pages=[{para:1,kind:'line',alias:'a',text:'First',anchor:{offset:0}},{para:1,kind:'line',alias:'a',text:'Future',anchor:{offset:5}}]
 const result=select({rows:[a],ref,cursor:{turn:1,page:0,para:1},visibleText:'First',revealed:true})
 assert.equal(result.current.revealed,false);assert.equal(result.messages[0].text,'First')
})
