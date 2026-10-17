// private fork: migrate the continuity scenarios to strict P3 records and real P4
// materialization. The in-memory lease service is inert; no old browser catalogue runs.
import {createHash} from 'node:crypto'
import {createAssetPackPresentation} from '../../tavern-plugin/lib/domain/asset-pack-presentation.js'
import {initialAssetPackStage,deriveAssetPackFigureScale} from '../../tavern-plugin/lib/domain/stage-asset-pack-tools.js'
import {assetPackStateAt,readAssetPackRecord} from '../../tavern-plugin/lib/domain/stage-asset-pack-director.js'
import {assetPackDigest} from '../../tavern-plugin/lib/domain/stage-asset-pack-catalogue.js'
import {forkFigureDirection} from '../../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs'
const packId = '11111111-1111-4111-8111-111111111111'
const ref = (kind,assetId) => ({packId,kind,assetId})
const sha = value => createHash('sha256').update(value).digest('hex')
const plain = value => JSON.parse(JSON.stringify(value))
const images = new Map(), figures = {}, sprites = {}, characters = {}, bindings = {}, assets = []
function image(url) {const hash=sha(url);images.set(hash,url);return hash}
for (const [i,alias] of ['a','b','c'].entries()) {
  const id = `22222222-2222-4222-8222-22222222222${i}`
  characters[alias] = {name:alias,appearance:'live2d'};bindings[alias] = {figure:{packId,figureId:id}}
  // private fork: continuity fixtures author only the native emotion-owned format.
  sprites[alias] = {version:1,kind:'static-sprites',emotions:Object.fromEntries(['calm','joy'].map(mood=>[mood,{src:mood+'.png'}]))}
  // private fork: figures and outfits must declare differences; sprite files no longer imply a built-in vocabulary.
  figures[id] = {id,name:alias,enabled:true,appearance:'live2d',emotions:[{id:'calm',label:'Calm'},{id:'joy',label:'Joy'}],recall:{mode:'constant',keywords:[]},heightCm:160,outfits:[{key:'uniform',label:'Uniform',enabled:true,emotions:['calm','joy'],sprite:{manifestKey:alias,assets:{'calm.png':image(alias+'.png'),'joy.png':image(alias+'-joy.png')}}}]}
}
for (const [id,url] of [['room-night','room.jpg'],['garden','garden.jpg'],['default','default.jpg']]) assets.push({id,kind:'backgrounds',name:id,enabled:true,media:image(url)})
for (const id of ['quiet','new']) assets.push({id,kind:'music',name:id,enabled:true,media:image(id+'.mp3')})
for (const [id,name,url] of [['amb-rain','Rain','/rain.mp3'],['amb-cafe','Cafe chatter','/cafe.ogg'],['amb-rain-window','Rain on glass','/window.ogg']]) assets.push({id,kind:'ambience',name,enabled:true,media:image(url)})
assets.push({id:'message-notification',kind:'sfx',name:'Message',enabled:true,media:image('/message.ogg')})
assets.push({id:'night',kind:'looks',name:'Night',enabled:true,layer:'time',timeOfDay:'night',params:{exposure:-1}})
assets.push({id:'memory',kind:'looks',name:'Memory',enabled:true,layer:'mood',params:{saturation:0.5}})
const service = {apiVersion:2,subscribe:()=>()=>{},releaseLease(){},
  resolveFigures:async ({refs})=>refs.map(ref=>({ref,revision:'fixture',value:figures[ref.figureId],diagnostics:[]})),
  resolveAssets:async ({refs})=>refs.map(ref=>({ref,revision:'fixture',value:assets.find(asset=>asset.id===ref.assetId&&asset.kind===ref.kind),diagnostics:[]})),
  getPackSnapshot:async()=>({revision:'fixture',manifest:{id:packId,figures:Object.keys(figures),bundles:{}},figures,sprites}),
  leaseMedia:async({hash})=>({ticket:hash,url:images.get(hash),revision:'fixture',expiresAt:Number.MAX_SAFE_INTEGER})}
// private fork: saved stage keys remain alias-based, but cards select only packages.
const consumer = createAssetPackPresentation({raw:{extensions:{dsh_tavern:{schemaVersion:1,assetBindings:{boundPackIds:[packId]}}}}, getService:()=>service,origin:'http://localhost',scope:'fixture'})
const resolvedCharacters = new Map(), scenes = new Map(), tracks = new Map()
for (const alias of Object.keys(characters)) for (const emotion of ['calm','joy']) resolvedCharacters.set(alias+':'+emotion,await consumer.materialize(await consumer.character(alias,{emotion})))
for (const asset of assets) {
  if (asset.kind==='backgrounds') for(const time of [false,true]) for(const mood of [false,true]) scenes.set([asset.id,time,mood].join(':'),await consumer.scene({scene:{background:ref(asset.kind,asset.id),timeOfDay:time?'night':null,timeLook:null},lighting:{time:{ref:time?ref('looks','night'):null},mood:mood?ref('looks','memory'):null}}))
  else tracks.set(asset.id,(await consumer.audio({music:ref(asset.kind,asset.id)})).music)
}
export function createBoundStageFixture(ctx) {
  let last = null, lastSession
  function record(direction = {}) {
    const rulers = direction.figureCatalog || {}
    const actors = Object.fromEntries(Object.keys(characters).map(alias=>[alias,{figure:bindings[alias].figure,outfits:[{key:'uniform',enabled:true}],ruler:{heightCm:rulers[alias]?.['']?.[0]?.heightCm || 160,headRatio:1,elevationCm:0}}]))
    const catalog = Object.fromEntries(Object.entries(actors).map(([alias,actor])=>[alias,{'':[actor.ruler]}]))
    function stateAt(at) {
      const resolved={...direction,status:'done'}
      const cue=ctx.forkGalCue(resolved,at), stage=ctx.forkGalStaging(resolved,at), state=initialAssetPackStage(actors)
      state.cast=plain(cue.cast || []).filter(id=>actors[id]);state.scene=cue.scenes.length?{background:ref('backgrounds',cue.scenes.at(-1)),timeOfDay:null,timeLook:null}:null
      state.music=cue.music&&cue.music!=='none'?ref('music',cue.music):null
      state.weather=stage.weather || 'none'
      if(stage.lighting.time==='night') {state.lighting.time.ref=ref('looks','night');if(state.scene)state.scene.timeOfDay='night'}
      if(stage.lighting.mood==='memory') state.lighting.mood=ref('looks','memory')
      const camera=stage.camera || {};state.camera={mode:camera.value || 'reset',actor:camera.id || null}
      if (!['reset','wide','push','close','pan-left','pan-right','dutch'].includes(state.camera.mode)) state.camera.mode='reset'
      for(const member of stage.members) if(state.actors[member.id]) state.actors[member.id].gaze=member.look || 'viewer'
      const preset=direction.soundscapeScenes?.find(scene=>scene.name===cue.scenes.at(-1))?.soundscape
      if(preset?.place && preset.place!=='none') state.soundscape.place=ref('ambience',preset.place)
      if(state.weather==='rain') state.soundscape.weather=ref('ambience',preset?.exposure==='indoor'?'amb-rain-window':'amb-rain')
      return state
    }
    const baseline=stateAt(0)
    baseline.figureScale=plain(forkFigureDirection({cast:baseline.cast,figureScale:direction.start?.figureScale},[],catalog,0))
    let before=baseline
    const entries=(direction.entries || []).map(entry=>{
      const state=stateAt(entry.at)
      state.figureScale=deriveAssetPackFigureScale(before,state,entry.at,Boolean(entry.scene || entry.commands?.some(op=>op.op==='trans')))
      before=state
      const ops=(entry.commands || []).filter(op=>['sfx','act','emote','beat','trans','focus','title'].includes(op.op)).map(op=>({op:'event',value:op.op==='sfx'?{...op,value:ref('sfx',op.value)}:plain(op)}))
      return {at:entry.at,ops,state,timeTransitionMs:0}
    })
    const value={format:'asset-packs-v1',complete:true,binding:{},baseline,entries,end:before,diagnostics:[]}
    value.digest=assetPackDigest({binding:value.binding,baseline,entries,end:before})
    return readAssetPackRecord(value)
  }
  function direction(value) { return value ? {...value,record:record(value)} : value }
  function projection(session,turn,at,snap,emotions,value) {
    if(lastSession!==session){last=null;lastSession=session}
    if(!value || ['running','off','error'].includes(value.status)&&!value.entries?.length&&!value.start) return last?{...last,pending:!['off','error'].includes(value?.status)}:{available:false,pending:true,characters:[],state:null,scene:null,widgets:[],audio:null,core:''}
    const state=assetPackStateAt(value.record,at), entry=value.record.entries.filter(entry=>entry.at===at).at(-1)
    const scene=state.scene?scenes.get([state.scene.background.assetId,!!state.lighting.time.ref,!!state.lighting.mood].join(':')):null
    const layers=Object.entries(state.soundscape).map(([slot,ref])=>({...tracks.get(ref.assetId),slot,id:ref.assetId,gain:1,lowpassHz:null}))
    last={available:true,state,scene,widgets:[],core:'',characters:Object.keys(characters).map(alias=>({...resolvedCharacters.get(alias+':'+(emotions[alias]==='joy'?'joy':'calm')),heightCm:state.actors[alias].ruler.heightCm})),
      audio:{music:tracks.get(state.music?.assetId)||null,soundscape:{version:1,layers,warnings:[]},sfx:(entry?.ops || []).filter(op=>op.value.op==='sfx').map(op=>tracks.get(op.value.value.assetId)).filter(Boolean)}}
    return last
  }
  return {direction,projection}
}
