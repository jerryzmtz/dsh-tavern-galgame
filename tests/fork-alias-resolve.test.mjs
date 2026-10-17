// private fork: historical vocabulary is fixture data, not a runtime default.
// private fork: every source name differs from its canonical figure id.
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import {readFile} from 'node:fs/promises'
import {forkWidgetAvatarSquare} from '../tavern-plugin/src/client/fork-widget-source.cjs' // private fork: production aspect-preserving thumbnail crop.
import bubbleLine from '../tavern-plugin/src/client/fork-bubble-line.cjs'
import {packFigureRenderInputs} from '../tavern-plugin/src/client/fork-pack-playback.cjs'
import moods from '../tests/fixtures/legacy-dialogue-moods.json' with {type:'json'}
const read=name=>readFile(new URL('../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
const stage=await read('fork-gal-stage.js'), bubbles=await read('fork-bubbles.js'), widget=await read('fork-widget-source.js'), voice=await read('fork-voice.js')
const character={alias:'f_madoka',aliases:['madoka'],name:'鹿目圆',ref:{packId:'pack',figureId:'madoka'},color:'#da6080',voice:'voice',voiceLanguage:'zh',emotions:[{id:'proud',label:'得意'}],avatarMedia:{moods:{proud:{hash:'proud-face'}}}}
const config={characters:[character],stage:{textLanguage:'zh'},spriteDialogue:[{alias:'f_madoka',states:[{id:'pose',emotion:'proud'}]}]}
const segment={kind:'bubble',alias:'madoka',name:'鹿目圆',mood:'得意',text:'Hello'}
const helpers=bubbles.slice(bubbles.indexOf('const FORK_BUBBLE_MOODS'),bubbles.indexOf('// Per-session bubble settings')).replace('__TAVERN_BUBBLE_MOODS__',JSON.stringify(moods))
const context=()=>{const ctx={...bubbleLine,config};vm.runInNewContext(helpers,ctx);return ctx}
const between=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)))

test('stage mood scans resolve full speakers before matching canonical cast ids',()=>{
 const ctx=context();vm.runInNewContext(between(stage,'function forkGalMoodOf','// A talk frame'),ctx)
 const pages=[{...segment,kind:'line',mood:'喜悦'},{kind:'narration'},{...segment,kind:'line',alias:'unknown',mood:'得意'}]
 assert.equal(ctx.forkGalMoodOf(pages,2,character.alias,config),'得意')
 assert.equal(ctx.forkGalMoodOf(pages,1,character.alias,config),'喜悦')
 assert.equal(ctx.forkGalMoodOf(pages,2,'f_other',config),'')
})
test('stage avatar getter resolves alias and full display name to canonical portrait key',()=>{
 const face={src:'blob:madoka'},ctx={...bubbleLine,config,state:{},portraits:new Map([[character.alias,face]])}
 vm.runInNewContext(between(stage,'    function avatarOf','    function nameOf'),ctx)
 assert.equal(ctx.avatarOf(segment),face);assert.equal(ctx.avatarOf('madoka'),face)
 assert.equal(ctx.avatarOf({...segment,alias:'unknown'}),face)
 assert.equal(ctx.avatarOf('unknown'),null)
})
for (const authored of ['madoka','sayaka','dafeiyu']) test('canonical '+authored+' stage gets speaking audio and its own cropped face',()=>{
 const row={alias:'f_'+authored,aliases:[authored],ref:{packId:'pack',figureId:authored}}
 const figure={alias:row.alias,ref:row.ref,form:'live2d',modelUrl:'blob:model',outfitKey:'uniform',avatarOutfitKey:'uniform',state:{id:'calm'},avatarUrl:'blob:face',avatarCrop:{x:.2,y:0,w:.5,h:.2},media:{avatar:{identity:'image'},model:{identity:'model'}}}
 const pack={avatars:[figure],characters:[figure]},audio={paused:false,ended:false}
 const ctx={...bubbleLine,packFigureRenderInputs,config:{characters:[row]},pack,current:{kind:'line',alias:authored,mood:'平和'},playingHere:true,player:{audio},skipping:false,turn:1,page:0,sessionId:'s'}
 const before=structuredClone(pack)
 vm.runInNewContext(between(stage,'    const speaker = current?','    const shotHere')+between(stage,'    const portraits =','    const portraitFace')+';this.input=renderInputs.get(speaker);this.portrait=portraits.get(speaker)',ctx)
 assert.equal(ctx.input.stage.audio,audio);assert.equal(ctx.input.stage.voiced,true);assert.equal(ctx.input.stage.voiceStarted,true)
 assert.equal(ctx.portrait.src,'blob:face');assert.equal(ctx.portrait.avatar.outfitKey,'uniform')
 assert.equal(ctx.portrait.avatar.stateId,'calm');assert.equal(ctx.portrait.crop,figure.avatarCrop)
 assert.deepEqual(pack,before)
 ctx.current={kind:'line',alias:'unknown'}
 vm.runInNewContext('{'+between(stage,'    const speaker = current?','    const shotHere')+';this.unresolved=[speaker,renderInputs.get('+JSON.stringify(row.alias)+').stage.audio]}',ctx)
 assert.deepEqual(Array.from(ctx.unresolved),['',null],'unknown names never fall back to a raw actor key')
})
test('widget avatars pass canonical speaker ids and normalized Chinese moods to the stage getter',async()=>{
 const calls=[],draws=[],ctx=context()
 Object.assign(ctx,{forkWidgetAvatarSquare,scope:'s',items:[{source:{messages:[{turn:1,para:1,alias:'madoka'}]}}],props:{turn:1,config,pages:[{...segment,para:1}],avatarOf:(...args)=>{calls.push(args);return {src:'blob:face',crop:{x:.2,y:0,w:.5,h:.2}}}},React:{useEffect:fn=>fn()},Image:class{naturalWidth=100;naturalHeight=200;set src(_){this.onload()}},document:{createElement:()=>({getContext:()=>({drawImage:(_,...args)=>draws.push(args)}),toDataURL:()=> 'data:image/png;base64,AA=='})},setAvatars(){},TextEncoder})
 vm.runInNewContext(between(widget,'    const avatarInputs=','    for (const item of items) if (item.source)'),ctx)
 await Promise.resolve()
 assert.deepEqual(calls,[[character.alias,'proud']])
 assert.deepEqual(draws,[[25,0,40,40,0,0,64,64]])
})
test('chat row resolves the same figure for name color, mood vocabulary, state labels and avatar media',()=>{
 const ctx=context(),calls=[]
 Object.assign(ctx,{React:{createElement:(type,props,...children)=>({type,props,children}),useRef:()=>({}),useState:()=>[true,()=>{}],useEffect(){}},ForkBubbleAvatar:'Avatar',useForkBubbleMedia:(...args)=>{calls.push(args);return {src:'blob:proud'}}})
 vm.runInNewContext(between(bubbles,'function ForkBubbleRow','// Drop-in for TavernColoredMarkdown'),ctx)
 const row=ctx.ForkBubbleRow({sessionId:'s',segment:{...segment,alias:'unrecognized'},config})
 assert.equal(row.props.style['--bubble-color'],character.color)
 assert.equal(calls[0][1],character)
 assert.equal(calls[0][3].find(mood=>mood.id==='proud').label,'得意')
 assert.equal(row.children[0].children[0].props.alias,character.alias)
 assert.equal(row.children[1].children[0].children[1].children[0],'得意')
 assert.equal(ctx.forkBubbleMoodLabel('pose',ctx.forkBubbleMoodList(config,character.alias),config,'madoka'),'得意')
})
test('voice uses the resolved figure vocabulary even when only the display name identifies it',()=>{
 const ctx=context();vm.runInNewContext(between(voice,'function forkPackSpeechInput','// private fork: native handles'),ctx)
 assert.deepEqual(JSON.parse(JSON.stringify(ctx.forkPackSpeechInput({...segment,alias:'unknown'},config))),{text:'Hello',mood:'proud'})
})
test('settings refresh matches native figures through the same resolver, retaining unfinished edits',()=>{
 const ctx=context();vm.runInNewContext(between(bubbles,'function forkBubbleRefreshAssets','// private fork: dialogue options'),ctx)
 const draft={characters:[{...segment,name:'Unsaved name',avatarMedia:{default:'old'}}]}
 const result=ctx.forkBubbleRefreshAssets(draft,config,true)
 assert.equal(result.characters.length,1);assert.equal(result.characters[0].avatarMedia,character.avatarMedia)
 assert.equal(result.characters[0].name,'Unsaved name');assert.equal(result.characters[0].assetAlias,character.alias)
 assert.equal(draft.characters[0].avatarMedia.default,'old')
})
