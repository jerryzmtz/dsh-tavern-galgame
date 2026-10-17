// private fork: missing artwork stays neutral; only an actual slow load shows a spinner.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {assetRenderer,walk,text} from './fixtures/asset-editor-renderer.mjs'
import {forkSpinnerSource} from './helpers/fork-spinner.mjs'
const read = name => readFileSync(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const source = read('fork-asset-pack-ui.js')
function fixture(t,{cached=null,pending=true}={}) {
  const r=assetRenderer(),timers=new Map();let now=0,id=0,resolve,reject,released=0
  const request=new Promise((yes,no)=>{resolve=yes;reject=no})
  const context={React:r.React,h:r.React.createElement,AvatarImage:null,peekMedia:()=>cached,dropMedia(){},
    holdMedia:()=>pending?request:Promise.resolve({url:'blob:ready',release(){released++}}),
    setTimeout(fn,delay){const key=++id;timers.set(key,{at:now+delay,fn});return key},clearTimeout:key=>timers.delete(key)}
  // private fork: the thumbnail's loading state is the shared ForkSpinner (its 150 ms delay lives in the component).
  vm.runInNewContext(forkSpinnerSource+'\n'+source.slice(source.indexOf('  function forkThumbUrl('),source.indexOf('  function RevealImg('))+';this.Thumb=Thumb;',context)
  const props={binding:{previewMedia(){}},packId:'pack',hash:'hash',label:'Neuro-sama'}
  t.after(()=>r.dispose())
  return {r,props,context,resolve,reject,timers,get released(){return released},
    render:()=>r.render(context.Thumb,props),settle:()=>r.settle(),
    advance(ms){now+=ms;for(const [key,value]of timers)if(value.at<=now){timers.delete(key);value.fn()}}}
}
// private fork: the centred shared spinner (ForkSpinner fill), not a thumbnail-local ring.
const spinner=tree=>walk(tree).some(n=>/^fork-spinner is-fill\b/.test(n.props.className||'')&&n.children.length===1)
test('private fork: thumbnail first, original on failure; delayed spinner ends on decode',async t=>{
  const f=fixture(t);assert.equal(text(f.render()),'');await f.settle()
  f.advance(149);assert.equal(spinner(f.render()),false)
  f.advance(1);assert.equal(spinner(f.render()),true)
  assert.match(walk(f.render()).find(n=>n.type==='img').props.src,/\/v2\/thumbnail\?/)
  walk(f.render()).find(n=>n.type==='img').props.onError();await f.settle()
  f.resolve({url:'blob:image',release(){}});let tree=await f.settle()
  assert.equal(spinner(tree),true,'lease completion alone is not image completion')
  tree.props.onLoad();tree=await f.settle()
  assert.equal(spinner(tree),false);assert.equal(text(tree),'')
})
test('private fork: absent, failed and unavailable images never show initials or endless spinners',async t=>{
  for(const kind of ['missing','unavailable','failed']) {
    const f=fixture(t)
    if(kind==='missing')delete f.props.hash
    if(kind==='unavailable')delete f.props.binding.previewMedia
    f.render();await f.settle()
    if(kind==='failed'){walk(f.render()).find(n=>n.type==='img').props.onError();await f.settle();f.reject(new Error('lease rejected'));await f.settle()}
    f.advance(1000);const tree=f.render()
    assert.equal(spinner(tree),false,kind);assert.equal(text(tree),'',kind)
  }
})
test('private fork: failed plain and cropped image decodes stop the spinner after the existing single retry',async t=>{
  for(const cropped of [false,true]) {
    const f=fixture(t,{pending:false})
    if(cropped){f.props.crop={x:0,y:0,w:1,h:1};f.context.AvatarImage=props=>f.r.React.createElement('img',props)}
    f.render();let tree=await f.settle()
    for(let i=0;i<3;i++){walk(tree).find(n=>n.type==='img').props.onError();tree=await f.settle()}
    f.advance(1000);tree=f.render()
    assert.equal(tree.props['data-failed'],true);assert.equal(spinner(tree),false);assert.equal(text(tree),'')
  }
})
test('private fork: cached decoded images paint immediately; unmount cancels delayed spinner',async t=>{
  // The tier is picked in a layout effect (box × devicePixelRatio), i.e. still before the first paint.
  const f=fixture(t,{cached:'blob:cached',pending:false});f.render();let tree=await f.settle()
  assert.match(walk(tree).find(n=>n.type==='img').props.src,/\/v2\/thumbnail\?/)
  tree.props.ref.current={querySelector:()=>({complete:true,naturalWidth:256})}
  tree=await f.settle();f.advance(200)
  assert.equal(spinner(f.render()),false);assert.equal(tree.props['data-ap-media'],'shown')
  const slow=fixture(t);slow.render();await slow.settle();assert.equal(slow.timers.size,1)
  slow.r.dispose();assert.equal(slow.timers.size,0)
})
test('private fork: changing artwork restarts the delay instead of borrowing the previous spinner',async t=>{
  const f=fixture(t);f.render();await f.settle();f.advance(150);assert.equal(spinner(f.render()),true)
  f.props.hash='another';assert.equal(spinner(f.render()),false);await f.settle()
  f.advance(149);assert.equal(spinner(f.render()),false);f.advance(1);assert.equal(spinner(f.render()),true)
})
test('private fork: pack, voice picker and backlog do not manufacture initial-letter artwork',()=>{
  for(const file of ['fork-asset-pack-ui.js','fork-bubbles.js','fork-gal-backlog.js']) {
    assert.doesNotMatch(read(file),/ap-thumb-initial|Array\.from\((?:name|option\.label)[^\n]*\)\[0\]|\(label\|\|''\)\.slice\(0,1\)/,file)
  }
})
