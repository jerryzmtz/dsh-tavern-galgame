import test from 'node:test'
import assert from 'node:assert/strict'
import {freezeJson} from '../tavern-plugin/lib/domain/freeze-json.js'
import {createSessionViewSync} from '../tavern-plugin/lib/domain/session-view-sync.js'
for(const count of [20,400,10000])test(`unchanged immutable inputs avoid ${count} field reads during real settlement changes`,()=>{
 let reads=0,enumerations=0
 const source=new Proxy(Object.fromEntries(Array.from({length:count},(_,i)=>[String(i),'body'+i])),{
  get(target,key,receiver){if(/^\d+$/.test(String(key)))reads++;return Reflect.get(target,key,receiver)},
  ownKeys(target){enumerations++;return Reflect.ownKeys(target)}
 })
 freezeJson(source)
 const sync=createSessionViewSync(),view={inputSources:source,inputTemplateDisplays:freezeJson({}),activity:{busy:true}}
 const first=sync('s',view);reads=0;enumerations=0
 const next=sync('s',{...view,activity:{busy:false}},first.viewCursor)
 assert.equal(reads,0);assert.equal(enumerations,0)
 assert.deepEqual(next.viewDelta.set,[[['activity'],{busy:false}]])
 assert.equal(sync.peek(first.viewCursor).inputFields.get('inputSources'),sync.peek(next.viewCursor).inputFields.get('inputSources'))
})
