// private fork: consumes committed item facts only; no inventory writes or director calls.
function ForkItemImage({image,authority}) {
    const [url,setUrl]=React.useState(null);
    React.useEffect(()=>{
        if(!image)return;let active=true,pin=null;
        forkStageSessions.resourceOwner?.acquire(image,authority).then(value=>{if(!active)value.release();else{pin=value;setUrl(value.handle.url);}},()=>{});
        return()=>{active=false;pin?.release();};
    },[image,authority]);
    return url ? React.createElement('img',{src:url,alt:'',onError:()=>setUrl(null)}) : null;
}
function ForkItemPerformance({sessionId,enabled,turn,para,page,live,skipping,overlay,sourceKey,generation,accent}) {
    const h=React.createElement,[cards,setCards]=React.useState([]),[history,setHistory]=React.useState([]),state=React.useRef(null);
    if (!state.current || state.current.sessionId!==sessionId) state.current={sessionId,initialTurn:turn,branch:null,ledgers:new Map(),seen:new Set(),visits:new Map(),paragraphs:new Map(),cursor:null};
    const owner=state.current,position=React.useRef(null);
    position.current={turn,para,page,live,skipping,overlay,sourceKey,generation};
    function consume() {
        const p=position.current,now=Date.now(),previous=owner.cursor;
        const changed=previous && (previous.turn!==p.turn || previous.page!==p.page);
        const forward=changed && (p.turn>previous.turn || p.turn===previous.turn && p.page>previous.page);
        owner.cursor={turn:p.turn,page:p.page};
        const paragraphKey=p.turn+'/'+p.para;
        if(p.para && !owner.paragraphs.has(paragraphKey))owner.paragraphs.set(paragraphKey,now);
        const shown=[];
        for (const [origin,ledger] of owner.ledgers) for (const row of ledger.records || []) {
            if (owner.seen.has(row.intentId)) continue;
            if (!enabled || !p.live || p.skipping || origin===owner.initialTurn || !['READY','HELD'].includes(row.status)) {owner.seen.add(row.intentId);continue;}
            if (origin===p.turn && (ledger.sourceKey && p.sourceKey && ledger.sourceKey!==p.sourceKey || ledger.generation!==undefined && p.generation!==undefined && ledger.generation!==p.generation)) {owner.seen.add(row.intentId);continue;}
            const atTarget=origin===p.turn && p.para===row.op.at;
            let visit=owner.visits.get(row.intentId);
            if (!visit && (atTarget || origin<p.turn || origin===p.turn && p.para>row.op.at)) {
                visit={deadline:(owner.paragraphs.get(origin+'/'+row.op.at) || now)+500,late:!atTarget};owner.visits.set(row.intentId,visit);
            }
            if (!visit) continue;
            if (!atTarget || now>visit.deadline) visit.late=true;
            if (row.status==='READY' && !p.overlay && p.para && (visit.late ? forward : atTarget)) {
                owner.seen.add(row.intentId);shown.push({...row,origin,late:visit.late});
            }
        }
        if (shown.length) setCards(shown);
        if(!p.live)setHistory(owner.ledgers.get(p.turn)?.records || []);
    }
    React.useEffect(()=>{
        if (!enabled) {owner.ledgers.clear();setCards([]);return;}
        let stopped=false,timer;
        const poll=async()=>{
            const current=position.current.turn;
            const turns=[current,...[...owner.ledgers].filter(([id,value])=>id!==current && value.pending).map(([id])=>id)].slice(0,2);
            for (const id of turns) {
                try {
                    const prior=owner.ledgers.get(id);
                    const value=await rpc('getStageItems',{turn:id,revision:prior?.revision,waiting:prior?.pending},sessionId);
                    if(stopped)return;
                    if(value.unchanged)continue;
                    if(owner.branch && value.branchId && owner.branch!==value.branchId){owner.ledgers.clear();owner.visits.clear();owner.paragraphs.clear();owner.seen.clear();owner.initialTurn=current;setCards([]);}
                    if(value.branchId)owner.branch=value.branchId;
                    if(owner.ledgers.get(id)?.sourceKey && (owner.ledgers.get(id).sourceKey!==value.sourceKey || owner.ledgers.get(id).generation!==value.generation))setCards([]);
                    owner.ledgers.set(id,value);
                    for(const old of owner.ledgers.keys())if(old<current-1){for(const row of owner.ledgers.get(old).records || []){owner.seen.delete(row.intentId);owner.visits.delete(row.intentId);}owner.ledgers.delete(old);}
                } catch (_) { /* Missing facts do not authorize a performance. */ }
            }
            if(!stopped){consume();timer=setTimeout(poll,[...owner.ledgers.values()].some(value=>value.pending)?350:1200);}
        };
        void poll();return()=>{stopped=true;clearTimeout(timer);};
    },[sessionId,enabled,turn,sourceKey,generation]);
    React.useEffect(()=>{setCards([]);},[sessionId,sourceKey,generation]);
    React.useEffect(()=>{consume();if(!live||skipping||!enabled)setCards([]);},[turn,para,page,live,skipping,overlay,enabled,sourceKey,generation]);
    React.useEffect(()=>{if(!cards.length)return;const timer=setTimeout(()=>setCards([]),2800);return()=>clearTimeout(timer);},[cards]);
    if(!live && enabled && !overlay && history.length)return h('details',{className:'fork-item-history',onClick:event=>event.stopPropagation()},h('summary',null,'物品记录'),history.map(row=>h('div',{key:row.intentId},row.bound?.item.name || row.op.name,' · ',row.status==='CORRECTED'?'结算已更正':row.status==='READY'?(row.op.action==='gain'?'获得':row.op.action==='lose'?'失去':'出示'):'未演出')));
    if (!cards.length || overlay || !enabled || !live || skipping) return null;
    return h(ForkItemShowcase,{accent,extra:cards.length>2 ? '另有 '+(cards.length-2)+' 项物品演出' : null,cards:cards.slice(0,2).map(row=>({key:row.intentId,element:h(ForkStageCutinCard,{tone:row.op.action,
        image:row.image && h(ForkItemImage,{image:row.image,authority:sessionId}),iconExpected:!!row.image,label:row.op.action==='gain'?'获得':row.op.action==='lose'?'失去':'出示',
        title:row.bound.item.name,subtitle:row.op.genre || undefined,amount:row.op.action==='show'?undefined:row.bound.item.delta,note:row.late?'来自第 '+row.origin+' 轮':null})}))});
}
