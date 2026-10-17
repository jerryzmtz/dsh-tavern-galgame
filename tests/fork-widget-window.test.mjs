// private fork: narrow read-only access shares the existing resource owner, never a playback writer.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readWidgetWindowProjection as read} from '../tavern-plugin/lib/domain/widget-window-projection.js'
const ref={packId:'p',kind:'widgets',assetId:'phone'}
function fixture() {
 let revision=1,current=true,available=true,grants=0;const reads=[]
 const direction=turn=>({phase:'done',through:3,token:{turn,generation:1},record:{entries:turn===29?[{at:2,ops:[{op:'widget.testphone.mark',ref,contact:'a',side:'in'}]}]:[]}})
 const args={turn:30,at:1,expectedDirectionToken:direction(30).token,widgetWindow:{ref},readTurns:async()=>Array.from({length:30},(_,i)=>i+1),readDirection:async n=>{reads.push(n);return direction(n)},revision:()=>revision,readSettings:()=>({revision,values:{}}),isCurrent:()=>current,readConsumer:async()=>({presentation:{available:()=>available,widgets:async(state,options)=>{grants++;assert.equal(options.isCurrent(),true);assert.deepEqual(options.sourceRefs,[ref]);return [{ref}]}}}),writePlayback(){throw Error('must never write')}}
 return {args,reads,get grants(){return grants},invalidate(){revision++},unbind(){current=false},disable(){available=false}}
}
test('unmarked current turn can obtain only a verified historical full-ref grant without projecting or writing history',async()=>{
 const f=fixture();assert.equal((await read(f.args)).status,'ready');assert.equal(f.grants,1);assert.ok(f.reads.includes(29))
 assert.equal((await read({...f.args,widgetWindow:{ref:{...ref,packId:'other'}}})).status,'revoked')
})
test('current token, cursor and closed request shape are mandatory',async()=>{
 const f=fixture()
 assert.equal((await read({...f.args,expectedDirectionToken:{turn:1}})).status,'stale')
 assert.equal((await read({...f.args,at:4})).status,'stale')
 assert.equal((await read({...f.args,widgetWindow:{ref,allChats:true}})).status,'failed');assert.equal(f.grants,0)
})
test('window never scans more than 20 story turns and does not authorize future marks',async()=>{
 const f=fixture();f.args.readDirection=async turn=>{f.reads.push(turn);return {phase:'done',through:3,token:{turn,generation:1},record:{entries:[{at:2,ops:turn===30 || turn===1?[{op:'widget.testphone.mark',ref,contact:'a',side:'in'}]:[]}]}}}
 assert.equal((await read(f.args)).status,'revoked');assert.ok(!f.reads.includes(1));assert.ok(new Set(f.reads).size<=20);assert.equal(f.grants,0)
})
test('availability is checked on every grant; async revision/source replacement rejects late results',async()=>{
 const f=fixture();await read(f.args);f.disable();assert.equal((await read(f.args)).status,'revoked');assert.equal(f.grants,1)
 const g=fixture(),before=g.args.readConsumer;g.args.readConsumer=async()=>{const result=await before();const widgets=result.presentation.widgets;result.presentation.widgets=async(...args)=>{const rows=await widgets(...args);g.invalidate();return rows};return result}
 assert.equal((await read(g.args)).status,'stale')
 const h=fixture();h.unbind();assert.equal((await read(h.args)).status,'revoked')
})

test('issued resource authorizers re-read both current and historical tokens and fail closed',async()=>{
 const f=fixture();let auth;const consumer=f.args.readConsumer
 f.args.readConsumer=async()=>{const result=await consumer(),widgets=result.presentation.widgets;result.presentation.widgets=async(state,options)=>{auth=options.authorizeSource;return widgets(state,options)};return result}
 await read(f.args);assert.equal(await auth(),true)
 f.unbind();assert.equal(await auth(),false)
 const g=fixture();let revoked=false,changedTurn=0,check;const readDirection=g.args.readDirection,getConsumer=g.args.readConsumer
 g.args.readDirection=async turn=>{if(revoked)throw Error('missing source');const value=await readDirection(turn);return turn===changedTurn ? {...value,token:{turn,generation:2}} : value}
 g.args.readConsumer=async()=>{const result=await getConsumer(),widgets=result.presentation.widgets;result.presentation.widgets=async(state,options)=>{check=options.authorizeSource;return widgets(state,options)};return result}
 await read(g.args);changedTurn=29;assert.equal(await check(),false);changedTurn=30;assert.equal(await check(),false);changedTurn=0;assert.equal(await check(),true);revoked=true;assert.equal(await check(),false)
})
