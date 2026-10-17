// Application-owned renderers; release archives never contribute executable browser code.
const FORK_MOD_STAGE_RENDERERS = {};
function ForkModStageLayers({sessionId,sourceKey,stage}) {
    const marker=React.useRef(null),host=React.useRef(null),rows=React.useRef([]),current=React.useRef({sourceKey,stage});
    current.current={sourceKey,stage};
    const sync=()=>{
        const visible=rows.current.filter(row=>current.current.sourceKey?row.context.sourceKey===current.current.sourceKey:row.context.settledTurn===current.current.stage.turn);
        host.current?.sync(visible.flatMap(row=>(row.manifest.uiLayers||[]).map(layer=>({...layer,modId:row.modId}))),
            {...visible[0]?.context,stage:current.current.stage},Object.fromEntries(visible.map(row=>[row.modId,row.view])));
    };
    React.useEffect(()=>{
        let live=true,ticket=0;
        const root=marker.current.closest('.fork-gal-stage');
        host.current=createModUiLayerHost({root,renderers:FORK_MOD_STAGE_RENDERERS});
        const read=async()=>{const own=++ticket;try{const result=await rpc('getModStageViews',{sessionId},sessionId);if(live&&own===ticket){rows.current=result.views;sync();}}catch(error){if(live&&own===ticket){rows.current=[];sync();console.warn('Mod display read failed',error);}}};
        const activity=()=>{forkStageSessions.notifyMod(sessionId,'activity.changed',forkStageSessions.get(sessionId)?.getSnapshot());void read();};
        const stop=tavernSessionSignals.subscribe(sessionId,'mod-view',read,read,activity);
        window.addEventListener('dsh-tavern-mods-changed',activity);activity();
        return()=>{live=false;ticket++;stop();window.removeEventListener('dsh-tavern-mods-changed',activity);host.current.dispose();host.current=null;rows.current=[];};
    },[sessionId]);
    React.useEffect(sync,[sourceKey,stage.title,stage.turn,stage.latestTurn,stage.scene,stage.bgm]);
    return React.createElement('span',{ref:marker,'aria-hidden':true,style:{display:'none'}});
}
