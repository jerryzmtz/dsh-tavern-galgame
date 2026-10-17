// private fork: offline runtime/UI performance seam. Real store/cursor/selectors and
// mounted renderer; synthetic projection latency, no live RPC or model generation.
const historyBase = H.scene.debug.description();
const targetUrl = historyBase.background.url.replace(/[a-f0-9]{64}\.webp$/, '481ab48551d047ce37c605e349f781b620307c1ada71750b76d596dd0da394bb.webp');
const forkGalEntry = {sessionId:'history-perf',turn:20,para:2,token:1};
const historyConfig = {characters:['m0','m1'].map(alias => ({alias,name:alias})),stage:{director:true,face:'off'}};
const historyIndex = new Map(Array.from({length:24},(_,i) => {
    const turn=i+1, segments=[{kind:'markdown',text:'Turn '+turn},{kind:'bubble',alias:'m0',name:'Reader',mood:'calm',text:'Target paragraph'},{kind:'markdown',text:'End'}];
    const part={scope:String(turn),turn,index:0,text:segments.map(s=>s.text).join('\n\n'),streaming:false,segments};
    return [turn,{parts:[part],text:{revision:turn,streaming:false,hasReadableText:true,pages:forkGalPages([part]).map(page=>({...page,voice:null,anchor:{paragraphId:turn+':'+page.para,para:page.para,offset:0}}))}}];
}));
const sourceForHistory = turn => ({sessionId:'history-perf',authorityEpoch:1,branchId:'offline',sourceKey:'offline:'+turn,generation:1,turn});
const historyStore = createStageRuntimeStore({runEffect(intent) {
    if (intent.type === 'read-director') {
        window.perfHistoryRpc=(window.perfHistoryRpc || 0)+1;
        setTimeout(()=>historyStore.dispatch({type:'DIRECTOR_READ_RESULT',token:intent.token,envelope:{phase:'done',revision:1,bindingKey:'offline',prefixRevision:1,through:3,complete:true,entries:[]}}),25);
    } else if (intent.type === 'project') {
        const turn=intent.token.source.turn, cast=turn%2 ? ['m0'] : ['m0','m1'];
        const ruler={version:6,scene:0,hMax:170,groundRatio:1,rescales:0};
        const state={cast,actors:Object.fromEntries(cast.map(alias=>[alias,{gaze:'viewer',figureLight:'lit'}])),camera:{mode:'reset'},weather:'none'};
        const figures=cast.map(alias=>{const f=historyBase.figures[Number(alias.slice(1))];return {alias,form:'live2d',ref:{packId:'offline',figureId:alias},geometry:{stage:alias},heightCm:170,modelUrl:f.url,media:{model:{identity:f.url}}};});
        const visual={scene:{state,core:historyBase.core,figureScale:ruler,backgroundUrl:targetUrl,backgroundMedia:{identity:targetUrl},background:{assetId:'target'},time:{params:{exposure:-1}},mood:{params:{}}},figures,ruler,lighting:null};
        // private fork: the performance seam uses the same dynamic group discovery as the runner.
        const groups=Object.fromEntries(figures.map(figure=>['figure:'+figure.alias,{kind:'set',value:figure}]));
        historyStore.dispatch({type:'PROJECTION_GROUPS',token:intent.token,figureKeys:Object.keys(groups),layout:{state,ruler,core:historyBase.core}});
        historyStore.dispatch({type:'PROJECTION_READY',token:intent.token,groups:{background:{kind:'set',value:{scene:visual.scene,ruler,lighting:null}},...groups,music:{kind:'set',value:null},ambience:{kind:'set',value:{version:1,layers:[],warnings:[]}},avatars:{kind:'set',value:[]},widgets:{kind:'set',value:[]}}});
    } else if (intent.type==='present' || intent.type==='playback-policy') forkStageConsumers.get('history-perf')?.present(intent);
    else if (intent.type==='cancel-playback') forkStageConsumers.get('history-perf')?.cancel(intent);
}});
historyStore.dispatch({type:'SESSION_INPUTS',textIndex:historyIndex});
historyStore.dispatch({type:'TURN_CHANGED',source:sourceForHistory(24),text:historyIndex.get(24).text});
const forkStageSessions={get:()=>historyStore,owner:{navigate(_id,turn,index,forward) {
    const row=historyIndex.get(turn); if(!row)return;
    const state=historyStore.getSnapshot(),live=forward&&turn===24;
    if(state.source.turn===turn && state.cursor.mode===(live?'live':'history'))historyStore.dispatch({type:'PAGE',index});
    else historyStore.dispatch({type:live?'RESUME_LIVE':'HISTORY_JUMP',source:sourceForHistory(turn),text:row.text,anchor:row.text.pages[index]?.anchor});
}}};
function useTavernCoordination(){return {};}
function forkBubbleMoodList(){return [];}
function forkBubbleMood(mood){return {id:mood||'calm'};}
function forkBubbleColor(){return '#ddd';}
const forkTtsScope=null;
const forkStageMusic={play(){},stop(){}};
Object.assign(forkStageSfx,{stop(){},setThunder(){}});
Object.assign(forkVoicePlayer,{stop(){},cancelPrefetch(){}});
const actualHistoryBacklog=ForkGalBacklog;
ForkGalBacklog=function(props){window.perfHistoryJump=props.onJump;return React.createElement(actualHistoryBacklog,props);};
// private fork: F has no second history page/decoded-resource cache.
window.perfHistoryCacheMax=0;
window.perfHistoryFrames=[];
let pendingHistoryFrame=null;
H.scene.app.renderer.on('postrender',()=>{
    if(!pendingHistoryFrame || !H.scene.app.stage.children[0].visible)return;
    const stats=H.scene.debug.stats();
    if(stats.layers.length!==1 || stats.layers[0].url!==pendingHistoryFrame.url)return;
    window.perfHistoryFrames.push({visit:pendingHistoryFrame.visit,expected:pendingHistoryFrame.url,layers:stats.layers,figures:stats.figures.map(f=>({key:f.key,alpha:f.alpha})),exposure:stats.grade ? JSON.parse(stats.grade)[0].exposure : null});
    pendingHistoryFrame=null;
});
function ForkGalScene(props){
    React.useLayoutEffect(()=>{
        if(props.scene.snap && !window.perfHistoryFrames.some(frame=>frame.visit===props.scene.visit))pendingHistoryFrame={visit:props.scene.visit,url:targetUrl};
        H.set(props.scene);
        props.onPresented?.(props.scene.presentationRevision);
    });
    return null;
}
function PerfHistory(){return React.createElement(ForkGalStage,{sessionId:'history-perf',data:{config:historyConfig},onExit(){}});}
