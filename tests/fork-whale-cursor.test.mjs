// private fork: the designer cursor uses the common frame clock and restores compositing before every frame ends.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
const source=await readFile(new URL('../tavern-plugin/src/client/fork-stage-skin-decoration.js',import.meta.url),'utf8')
test('whale draws six phases; reduced motion doubles interval; snap and inactive cursors stay still',()=>{
 for(const [reduced,active,snap,interval] of [[false,true,false,125],[true,true,false,250],[false,true,true,null],[false,false,false,null]]) {
  const timers=[],calls=[],cleanups=[]
  const context=new Proxy({},{get:(o,k)=>o[k] ?? (o[k]=(...args)=>calls.push([k,...args])),set:(o,k,v)=>(o[k]=v,true)})
  const env={React:{useRef:()=>({current:{getContext:()=>context}}),useEffect:fn=>cleanups.push(fn()),createElement:()=>null},forkForeground:{setTimeout:(fn,delay)=>(timers.push({fn,delay}),timers.length),clearTimeout(){}},matchMedia:()=>({matches:reduced,addEventListener(){},removeEventListener(){}})}
  vm.runInNewContext(source+';this.Cursor=ForkStageSkinCursor;',env)
  env.Cursor({cursor:{name:'whale'},active,snap})
  assert.ok(calls.some(([name])=>name==='bezierCurveTo'))
  if(interval===null)assert.equal(timers.length,0)
  else {
   assert.equal(timers[0].delay,interval)
   for(let i=0;i<5;i++)timers[i].fn()
   assert.equal(timers.length,6)
  }
  assert.equal(context.globalCompositeOperation,'source-over')
  cleanups.forEach(fn=>fn())
 }
})
