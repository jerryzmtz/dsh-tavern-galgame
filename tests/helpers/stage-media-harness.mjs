// private fork: real media consumers and resource owner with an offline byte/clock port.
import vm from 'node:vm'
import {readFileSync} from 'node:fs'
import {createRequire} from 'node:module'
import {createFakeClock} from './stage-runtime-harness.mjs'
const require = createRequire(import.meta.url)
const {createStageResourceOwner} = require('../../tavern-plugin/src/client/fork-stage-resources.cjs')
const {createPackVoicePlayer,packFigureRenderInputs} = require('../../tavern-plugin/src/client/fork-pack-playback.cjs')
const {forkCreateSoundscapePlayer} = require('../../tavern-plugin/src/client/fork-stage-soundscape-player.cjs')
const contract = require('../../tavern-plugin/src/client/fork-layered-sprite.cjs')
const source = file => readFileSync(new URL('../../tavern-plugin/src/client/'+file,import.meta.url),'utf8')
export function createStageMediaHarness() {
  const clock = createFakeClock(), nodes = [], frameJobs = new Map(), blobs = new Map(), instances = new Map(), replacements = new Map()
  let serial = 0, ticket = 0, byteReads = 0
  const document = {hidden:false,addEventListener(){},removeEventListener(){}}
  class Audio {
    constructor(url = '') {this._src=url; this.srcChanges=url ? 1 : 0; this.currentTime=0; this.plays=0; this.pauses=0; this.paused=true; this.volume=1; this.events=new Map(); nodes.push(this)}
    set src(value) {this._src=value; this.srcChanges++} get src() {return this._src}
    play() {this.plays++;this.paused=false;return Promise.resolve()}
    pause() {this.pauses++;this.paused=true}
    removeAttribute(name) {if(name==='src' && this.src) this.src=''}
    load() {}
    addEventListener(name,fn) {this.events.set(name,fn)} removeEventListener(name) {this.events.delete(name)}
    end() {this.paused=true;this.events.get('ended')?.();this.onended?.()}
  }
  const mixer = {get:() => ({music:1,sfx:1,ambience:1,muted:{}}),bind(node,bus){node.bus=bus},level(node,value){if(value===undefined)return node.volume;node.volume=value},filter(){},release(){},subscribe:() => () => {}}
  const requestFrame = fn => {frameJobs.set(++serial,fn);return serial}, cancelFrame = id => frameJobs.delete(id)
  const context = {Audio,document,window:{addEventListener(){},removeEventListener(){}},forkStageAudio:mixer,forkForeground:{now:() => clock.now,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout},URL,performance:{now:() => clock.now},requestAnimationFrame:requestFrame,cancelAnimationFrame:cancelFrame,setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout}
  vm.runInNewContext(source('fork-stage-music.js')+'\n'+source('fork-stage-sfx.js')+'\nthis.players={music:forkStageMusic,sfx:forkStageSfx};',context)
  const ambience = forkCreateSoundscapePlayer({Audio,mixer,now:() => clock.now,requestFrame:fn=>clock.setTimeout(fn,16),cancelFrame:clock.clearTimeout})
  const urls = {createObjectURL(blob){const url='blob:fixture-'+blobs.size;blobs.set(url,blob);return url},revokeObjectURL(){}}
  const service = {
    async leaseMedia({hash}) {return {ticket:++ticket,revision:1,url:'/ticket/'+ticket+'/'+hash}},
    async leaseBundle() {const root='/ticket/'+(++ticket)+'/';return {ticket,revision:1,url:root+'model.model3.json',resources:[root+'model.model3.json',root+'model.moc3']}},
    releaseLease() {}
  }
  const resources = createStageResourceOwner({service,urls,async fetch(url){byteReads++;return new Response(url.endsWith('.json') ? '{"Version":3,"FileReferences":{"Moc":"model.moc3"}}' : 'media')}})
  const voiceService = {apiVersion:1,available:() => true,subscribe:() => () => {},synthesize:async () => ({ticket:'voice',key:'voice'}),audio:async () => new Blob(['voice'])}
  const voice = createPackVoicePlayer({getClient:() => voiceService,createAudio:url => new Audio(url),urls,prepareAudio:node => {node.bus='voice'}})
  voice.setEnabled(true)
  function reconcile(key,identity,input) {
    if (instances.get(key)?.identity === identity) return
    instances.set(key,{identity,input,instance:{}}); replacements.set(key,(replacements.get(key)||0)+1)
  }
  return {
    clock,nodes,resources,instances,replacements,voice,players:context.players,ambience,
    get byteReads(){return byteReads},
    apply(value) {
      context.players.music.play(value.audio.music.url,true,value.audio.music.identity)
      ambience.apply(value.audio.soundscape,{snap:true})
      reconcile('background',value.scene.backgroundMedia.identity,value.scene.backgroundUrl)
      for(const figure of value.characters) {
        const input=packFigureRenderInputs(figure,{},contract)
        if(input.stage) reconcile(figure.alias,input.stage.identity,input.stage)
        if(input.face) reconcile(figure.alias+':face',input.face.identity,input.face)
      }
    },
    hidden(value){document.hidden=value},
    advance(ms) {for(const node of nodes)if(!node.paused)node.currentTime+=ms/1000;clock.advance(ms);if(!document.hidden){const tasks=[...frameJobs.values()];frameJobs.clear();tasks.forEach(fn=>fn(clock.now))}},
    dispose(){voice.dispose();context.players.music.stop();context.players.sfx.stop();ambience.dispose();resources.dispose()}
  }
}
