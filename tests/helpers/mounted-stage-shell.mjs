import fs from 'node:fs'
export const read=name=>fs.readFileSync(new URL('../../tavern-plugin/src/client/'+name,import.meta.url),'utf8')
export const between=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)))
const stage=read('fork-gal-stage.js')
// private fork: the shared ForkSpinner (stage resource / voice loading) precedes the stage, as in main.js; var, since
// pages also mount the transcript (fork-transcript-perf-ui.mjs) with its own copy.
export const shell=`
  // private fork: mount textcard's real dependencies with the stage, as in production.
  ${['fork-textcard-presets.cjs','fork-textcard-vert-ink.cjs','fork-textcard-stage.js'].map(read).join('\n')}
  ${read('fork-spinner.js').replace(/^const /gm,'var ')}
  const forkUiSfx={preload(){},play(){}};
  ${between(read('fork-gal-scene.js'),'// ---------- Scene helpers','// ---------- Scene runtime')}
  ${read('fork-gal-looks.js')}
  ${read('fork-layered-sprite.cjs')}
  ${fs.readFileSync(new URL('../../tavern-plugin/packages/dsh-presentation-protocol/src/fork-figure-scale.cjs',import.meta.url),'utf8')}
  const forkGalEntry=null, forkGalMenuRequest={subscribe:()=>()=>{},get:()=>0};
  function useForkStageFilm(){return false} function useForkStageQuality(){return 'high'}
  function useForkStageReading(){return {textSpeed:0,autoWait:700,autoSpeed:1,voiceRate:1}}
  function useTavernCoordination(){return {}} function useForkGalPlayerInputs(){return {}}
  function forkStageOffstage(){return new Set()}
  // private fork: mount the same unified widget owner as production, not a phone hook stub.
  const FORK_WIDGET_SLOTS=['top-center','corner-left','corner-right','center-card'];
  ${['fork-widget-contracts.cjs','fork-widget-media.cjs','fork-widget-theme.cjs','fork-widget-theme.js','fork-widget-setting-images.js','fork-widget-sandbox.js','fork-gal-widgets.js','fork-widget-source.cjs','fork-widget-presentation.cjs','fork-widget-thread.cjs','fork-widget-source.js'].map(read).join('\n')}
  function forkGalUiApplier(){return ()=>{}}
  ${read('fork-gal-entry.js')}
  const forkStageMusic={play(){},stop(){},ready(){return true}},forkStageSfx={stop(){},stopToken(){},play(){}};
  const ForkGalMixer=()=>null,ForkBgmStage=()=>null,ForkGalBoxFrame=()=>null,ForkIcon=()=>null,ForkGalFace=()=>null,ForkGalSide=()=>null;
  const ForkGalNamePlate=()=>null,ForkGalConfig=()=>null,ForkGalConfigScreen=()=>null,ForkGalTitle=()=>null,ForkGalMenu=()=>null;
  let mounts=0,unmounts=0;
  function ForkGalScene(props){
    React.useEffect(()=>{mounts++;return()=>{unmounts++}},[]);
    React.useLayoutEffect(()=>props.onPresented(props.scene.presentationRevision));
    return React.createElement('div',{'data-scene':props.scene.background?.url || '', 'data-ruler':JSON.stringify(props.scene.figureScale)});
  }
  ${between(stage,'// Film cards','function forkGalTextDigest')}
  ${between(stage,'function forkGalPositionAnchors','function forkGalGaze')}
  ${between(stage,'function forkGalGaze','// Revalidate on every visit')}
  ${between(stage,'function ForkGalTypewriter','function ForkGalBoxFrame')}
  ${between(stage,'function forkGalAutoDelay','const forkStageReading')}
  ${between(stage,'function ForkGalStage(props)','// Name plate of the text box')}
  const forkFonts={subscribe:()=>()=>{},getSnapshot:()=>0,resolve:()=>({family:'serif'}),ensure:async()=>{}};
  ${fs.readFileSync(new URL('../../tavern-plugin/packages/dsh-presentation-protocol/src/stage-skin.cjs',import.meta.url),'utf8')}
  ${['fork-stage-skin.cjs','fork-stage-skin-ui.js','fork-stage-skin-decoration.js','fork-stage-rects.cjs','fork-skin-overlay-loader.cjs','fork-performance-layer.js','../../../fork/mods/performance/state.cjs','../../../fork/mods/performance/timeline.cjs'].map(read).join('\n')}
  ${read('fork-stage-soundscape-player.cjs')}
  ${read('fork-cg-consumer.cjs')}
  ${read('fork-cg-stage.js')} // private fork: real independent CG consumer, as in the feature module
  ${read('fork-mod-stage-surface.cjs')}
  ${fs.readFileSync(new URL('../../fork/mods/items/presentation.cjs',import.meta.url),'utf8')}
  ${read('fork-mod-performance.js')}
  ${read('fork-cg-gallery.js')} // private fork: isolated preview shares the renderer/resource owner
  ${fs.readFileSync(new URL('../../tavern-plugin/packages/dsh-presentation-protocol/src/director-commands.cjs',import.meta.url),'utf8')}
  ${read('fork-stage-director-source.cjs')}
  ${read('fork-stage-resources.cjs')}
  ${read('fork-stage-resource-runner.cjs')}
  // Genuine decoded image bytes are local; transport and model are offline test ports.
  const png=Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aLFcAAAAASUVORK5CYII='),c=>c.charCodeAt(0));
  const resourceOwner=createStageResourceOwner({
    service:{leaseMedia:args=>hostLease(args),releaseLease(){}},fetch:async()=>new Response(png,{headers:{'Content-Type':'image/png'}}),
    async decode(blob,url){const image=new Image();image.src=url;await image.decode();return image;}});
  forkStageSessions.resourceOwner=resourceOwner;
  const resources=createStageResourceRunner({read:args=>hostProjection(args),owner:resourceOwner,
    foreground:forkForeground,performance:(id,intent)=>forkStageConsumers.get(id)?.performance(intent),
    present:(id,intent)=>forkStageConsumers.get(id)?.present(intent),play:(id,value,token)=>forkStageConsumers.get(id)?.play(value,token),cancelPlayback:(id,intent)=>forkStageConsumers.get(id)?.cancel(intent)});
  const wakes=new Set();
  window.stageSourceRunner=createStageDirectorSource({read:args=>hostDirection(args),watch:(_source,wake)=>{wakes.add(wake);return()=>wakes.delete(wake)},onEffect:resources.onEffect});
  window.wakeDirection=()=>wakes.forEach(wake=>wake());
  transcriptProbe.active(true);
  const native=(turn,text,status='closed')=>({id:'turn-'+turn,kind:'assistant-step',anchorSeq:turn,location:{turn:{turn}},data:{status,blocks:[{kind:'text',text}]}});
  transcriptProbe.setNodes([native(1,'Synthetic fixture.\\n\\nSynthetic dusk.')]);
  const target=document.createElement('main');document.body.appendChild(target);const stageRoot=ReactDOM.createRoot(target);
  ReactDOM.flushSync(()=>stageRoot.render(React.createElement(ForkGalStage,{sessionId:'session',data:{config:{characters:[],voice:{enabled:false},stage:{face:'off',music:false}}},onExit(){}})));
  window.stageProbe={native,state:()=>transcriptProbe.runtime.getSnapshot(),stats:()=>({mounts,unmounts}),
    nodes:(nodes,running)=>ReactDOM.flushSync(()=>transcriptProbe.setNodes(nodes,running)),
    page:index=>ReactDOM.flushSync(()=>transcriptProbe.runtime.dispatch({type:'PAGE',index})),
    refresh:()=>transcriptProbe.runtime.dispatch({type:'REFRESH_BEGIN',source:transcriptProbe.runtime.getSnapshot().source}),
    dispose(){ReactDOM.flushSync(()=>stageRoot.unmount());transcriptProbe.dispose();stageSourceRunner.dispose();resources.dispose()}};
`
