import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'

// private fork: exercise the production backdrop tick, including the initial scene.clear.
const source = await readFile(new URL('../tavern-plugin/src/client/fork-gal-scene.js',import.meta.url),'utf8')
const tick = source.slice(source.indexOf('    function tickBackdrop(now)'),source.indexOf('    // The figures\' time grade blends'))
function fixture(background = null) {
  let description = {background,snap:false,grade:''}, reads = 0, resolve
  const state = {bg:{target:null,pending:''},layers:[],grade:{name:'',version0:1}}
  const empty = {}, context = {state,generated:{empty},FORK_GAL_ZOOM_MS:800,
    describe:()=>description,registryOf:()=>({version:1}),setGrade(){},setStandIn(){},
    loadTexture:()=>{reads++;return new Promise(done=>{resolve=done})},
    startLayer:(url,texture)=>state.layers.push({url,texture,identity:description.background?.identity}),
    paintLayer:()=>null,cover:{},app:{screen:{width:1280,height:800}},vignette:{position:{set(){}}}}
  vm.runInNewContext(tick+';this.tick=tickBackdrop',context)
  return {state,empty,tick:context.tick,set:value=>{description={...description,background:value}},get reads(){return reads},ready:()=>resolve({})}
}

test('live-mode scene.clear initializes one empty backdrop so loaded figures can enter',()=>{
  const f=fixture()
  assert.equal(f.state.layers.length,0)
  f.tick(0)
  assert.equal(f.state.layers.length,1,'figure startup must not wait forever for a nonexistent image')
  assert.equal(f.state.layers[0].texture,f.empty)
  assert.equal(f.state.layers[0].url,'')
  assert.equal(f.state.bg.target,'')
  for(let i=1;i<=120;i++) f.tick(i*1000)
  assert.equal(f.state.layers.length,1,'null identities do not restart the empty transition every frame')
  assert.equal(f.reads,0,'an authored clear never selects or fetches a substitute asset')
})

test('initial image still waits for its texture and later scene.clear uses the empty backdrop',async()=>{
  const f=fixture({identity:'background-a',url:'fixture-a',transition:'cut'})
  f.tick(0);f.tick(1)
  assert.equal(f.reads,1)
  assert.equal(f.state.bg.pending,'fixture-a')
  assert.equal(f.state.layers.length,0,'do not release figure entry before a requested image arrives')
  f.ready();await Promise.resolve()
  assert.equal(f.state.layers[0].url,'fixture-a')
  f.set(null);f.tick(2)
  assert.equal(f.state.layers.at(-1).texture,f.empty)
  f.tick(3)
  assert.equal(f.state.layers.length,2)
  assert.equal(f.reads,1)
})
