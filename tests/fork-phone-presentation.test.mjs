// private fork: phone is a pack-owned view of the generic source projection, never an old record decoder.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import vm from 'node:vm'
import {forkWidgetSourcePlace as place} from '../tavern-plugin/src/client/fork-widget-source.cjs'
const ref={packId:'da95db75-cad8-43a9-92e2-ad15cb290b83',kind:'widgets',assetId:'phone'}
import {forkWidgetThread} from '../tavern-plugin/src/client/fork-widget-thread.cjs'
import {forkPhoneMarker, forkPhoneProjection} from '../tavern-plugin/packages/dsh-presentation-protocol/src/fork-stage-phone.cjs'
const voice={owner:'original',click(){}}
const pages=[{kind:'narration',para:1,text:'Opening'},{kind:'line',para:2,alias:'friend',text:'Hello'},
 {kind:'line',para:3,alias:'me',text:'Here'},{kind:'narration',para:4,text:'Rain'},
 {kind:'line',para:5,alias:'friend',text:'Arriving',voice},{kind:'narration',para:6,text:'End'}]
const record={phase:'done',through:6,token:{bindingKey:'turn-one',generation:0},entries:[2,3,5].map(at=>({at,ops:[{op:'widget.source',ref,contact:'f_friend',side:at===3?'out':'in'}]}))}
const project=(at,recordValue=record)=>forkWidgetThread({rows:[{turn:1,sourceKey:'test',pages,record:recordValue}],ref,cursor:{turn:1,page:at,para:pages[at].para},visibleText:pages[at].text,revealed:true})
// private fork: canonical identities must differ from every source alias and display name.
const phoneCharacters=[
 {alias:'f_madoka',name:'鹿目圆',aliases:['madoka','圆'],ref:{packId:'pack',figureId:'madoka'}},
 {alias:'f_player',name:'玩家',aliases:['me'],ref:{packId:'pack',figureId:'player'}}
]
test('phone marker resolves source and contact identities before validating direction',()=>{
 const line={kind:'line',para:1,alias:'madoka',name:'鹿目圆',mood:'喜悦'}
 const mark={op:'phone.message',contact:'f_madoka',side:'in'}
 assert.deepEqual(forkPhoneMarker(mark,line,phoneCharacters),mark)
 assert.deepEqual(forkPhoneMarker({...mark,contact:'圆'},line,phoneCharacters),mark)
 assert.deepEqual(forkPhoneMarker({...mark,side:'out'},{...line,alias:'me',name:'玩家'},phoneCharacters),{...mark,side:'out'})
 assert.equal(forkPhoneMarker({...mark,side:'out'},line,phoneCharacters),null)
 assert.equal(forkPhoneMarker(mark,{...line,alias:'unknown',name:''},phoneCharacters),null)
 assert.equal(forkPhoneMarker(mark,line,[{...phoneCharacters[0],enabled:false}]),null)
 assert.equal(forkPhoneMarker({...mark,contact:null},line,phoneCharacters),null)
})
test('narrated phone marks use explicit contact and direction without parsing or inventing source speakers',()=>{
 const narration={kind:'narration',para:1,text:'A message arrived.'}
 for(const side of ['in','out'])for(const form of ['text','voice']) {
  const raw={op:'phone.message',contact:'圆',side,form}
  assert.deepEqual(forkPhoneMarker(raw,narration,phoneCharacters),{...raw,contact:'f_madoka'})
 }
 for(const contact of ['unknown','',null])assert.equal(forkPhoneMarker({op:'phone.message',contact,side:'in'},narration,phoneCharacters),null)
 for(const kind of ['heading','thought',undefined])assert.equal(forkPhoneMarker({op:'phone.message',contact:'圆',side:'in'},{...narration,kind},phoneCharacters),null)
 assert.equal(forkPhoneMarker({op:'phone.message',contact:'圆',side:'in'},narration,[{...phoneCharacters[0],enabled:false}]),null)
 assert.deepEqual(narration,{kind:'narration',para:1,text:'A message arrived.'})
})
test('browser phone projection uses the same identity resolver and preserves factory exports',async()=>{
 const root=new URL('../tavern-plugin/packages/dsh-presentation-protocol/src/',import.meta.url)
 const source=await readFile(new URL('figure-resolution.cjs',root),'utf8')+'\n'+await readFile(new URL('fork-stage-phone.cjs',root),'utf8')
 const context={window:{},module:{exports:{sentinel:true}},characters:phoneCharacters}
 vm.runInNewContext(source+`;this.mark=forkPhoneMarker({op:'phone.message',contact:'f_madoka',side:'in'},{kind:'line',para:1,alias:'madoka',mood:'喜悦'},characters)`,context)
 assert.equal(context.mark.contact,'f_madoka')
 assert.deepEqual(context.module.exports,{sentinel:true})
})
test('phone projection retains Chinese moods and joins aliases of the same canonical speaker without mutating history',()=>{
 const source=[
  {kind:'line',para:1,alias:'madoka',name:'鹿目圆',mood:'喜悦',text:'Hello'},
  {kind:'line',para:2,alias:'圆',name:'鹿目圆',mood:'悲伤',text:'Again'},
  {kind:'line',para:3,alias:'me',name:'玩家',mood:'平静',text:'Here'}]
 const direction={status:'done',key:'turn',entries:source.map(line=>({at:line.para,commands:[{op:'phone.message',contact:line.para===2?'圆':'f_madoka',side:line.para===3?'out':'in'}]}))}
 const before=structuredClone({source,direction,phoneCharacters})
 const result=forkPhoneProjection(source,2,direction,phoneCharacters)
 assert.equal(result.active,true);assert.equal(result.contact,'f_madoka');assert.equal(result.key,'turn:1:f_madoka')
 assert.deepEqual(result.messages.map(message=>message.continued),[false,true,false])
 assert.deepEqual(result.messages.map(message=>message.line),source)
 assert.deepEqual({source,direction,phoneCharacters},before)
})
test('production thread includes only accepted marked pages and never future text',()=>{
 assert.equal(project(0).messages.length,0)
 for(let at=1;at<pages.length;at++)assert.ok(project(at).messages.every(message=>message.para<=pages[at].para))
 assert.deepEqual(project(1).messages.map(message=>message.para),[2]);assert.equal(project(5).current,null)
 assert.equal(pages[4].voice,voice,'thread does not alter the original voice owner')
})
test('production thread rejects old phone markers, wrong refs and unverified records',()=>{
 assert.equal(project(1,{...record,entries:[{at:2,ops:[{op:'phone.message',contact:'f_friend',side:'in'}]}]}).messages.length,0)
 assert.equal(project(1,{...record,entries:[{at:2,ops:[{op:'widget.source',ref:{...ref,packId:'other'},contact:'f_friend',side:'in'}]}]}).messages.length,0)
 assert.equal(project(1,{...record,phase:'running'}).messages.length,0)
})
test('production placement avoids figures and preserves a safe rectangle',()=>{
 const args={width:1440,height:900,size:{width:280,height:607},figures:[{body:{x:250,y:180,width:360,height:600},head:{x:380,y:130,width:100,height:150}}],blocked:[]}
 const result=place(args);assert.ok(result.x>=628 && result.x<1000)
 assert.deepEqual(place({...args,figures:[],previous:result}),result)
})
test('production placement keeps dialogue untouched and rejects unavailable space',()=>{
 const caption={x:32,y:630,width:1136,height:192},saved=structuredClone(caption)
 assert.equal(place({width:1200,height:900,size:{width:280,height:607},blocked:[caption,{x:0,y:0,width:1200,height:88}]}),null)
 const compact=place({width:1200,height:900,size:{width:220,height:44},blocked:[caption,{x:0,y:0,width:1200,height:88}]})
 assert.ok(compact.y>=100 && compact.y+compact.height<=618);assert.deepEqual(caption,saved)
 assert.equal(place({width:390,height:420,size:{width:280,height:607}}),null)
})
test('production stage has only the shared source mount and leaves reading controls outside the iframe',async()=>{
 const stage=await readFile(new URL('../tavern-plugin/src/client/fork-gal-stage.js',import.meta.url),'utf8')
 assert.match(stage,/useForkWidgetStage/);assert.doesNotMatch(stage,/useForkGalPhone|ForkGalPhone/)
 assert.match(stage,/is-source-widget-line/);assert.match(stage,/fork-widget-source-controls/)
 const css=await readFile(new URL('../tavern-plugin/lib/client-assets/fork-phone.css',import.meta.url),'utf8')
 for(const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g))if(match[1].includes('fork-gal-box'))assert.doesNotMatch(match[2],/width|height|padding|font|left|right|bottom|transform/)
})
