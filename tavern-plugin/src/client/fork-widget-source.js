// @include fork-widget-source.cjs
// @include fork-widget-presentation.cjs
// @include fork-widget-thread.cjs
// @include fork-widget-setting-images.js
// private fork: where the reader dragged a widget, per card and per view (open / compact). A browser UI preference only —
// never the chat, the card or the director — kept as fractions of the free stage so a resize always clamps it inside.
const FORK_WIDGET_PLACE_PAD=8;
const forkWidgetPlaces=(()=>{
    const KEY='fork-widget-places',CARDS=48;let cache=null;
    const load=()=>{
        if (cache) return cache;
        try {const value=JSON.parse(localStorage.getItem(KEY) || 'null');cache=value && typeof value==='object' && !Array.isArray(value) ? value : {};} catch (_) {cache={};}
        return cache;
    };
    const valid=value=>Array.isArray(value) && value.length===2 && value.every(n=>Number.isFinite(n) && n>=0 && n<=1);
    return {
        get(scope,key,view) {const value=load()[scope]?.[key]?.[view];return valid(value) ? value : null;},
        // A null view forgets every view of that widget (reset); the most recently touched cards are kept.
        set(scope,key,view,value) {
            const all=load(),card={...(all[scope] || {})};
            if (view && value) card[key]={...(card[key] || {}),[view]:value}; else delete card[key];
            delete all[scope];if (Object.keys(card).length) all[scope]=card;
            for (const old of Object.keys(all).slice(0,Math.max(0,Object.keys(all).length-CARDS))) delete all[old];
            try {localStorage.setItem(KEY,JSON.stringify(all));} catch (_) {}
        }};
})();
function forkWidgetPlaceFraction(viewport,size,point) {
    const free=[viewport.width-size.width,viewport.height-size.height].map(n=>n-2*FORK_WIDGET_PLACE_PAD);
    return [point.x-viewport.x,point.y-viewport.y].map((n,i)=>free[i]>0 ? Math.min(1,Math.max(0,(n-FORK_WIDGET_PLACE_PAD)/free[i])) : .5);
}
function forkWidgetPlacePoint(viewport,size,fraction) {
    return {x:viewport.x+FORK_WIDGET_PLACE_PAD+Math.max(0,viewport.width-size.width-2*FORK_WIDGET_PLACE_PAD)*fraction[0],
        y:viewport.y+FORK_WIDGET_PLACE_PAD+Math.max(0,viewport.height-size.height-2*FORK_WIDGET_PLACE_PAD)*fraction[1]};
}
// private fork (owner 2026-10): the phone is centred in the band between the top bar and the dialogue box, at its declared
// size scaled with the stage; the incoming banner is exactly as wide as that phone's screen. The view zooms to match.
const FORK_PHONE_KEY=JSON.stringify(['dsh.phone','source']),FORK_PHONE_BANNER_MS=3500,FORK_PHONE_GAP=12,FORK_PHONE_MIN_WIDTH=160;
const FORK_PHONE_BEZEL=15,FORK_PHONE_SCREEN=265,FORK_PHONE_BANNER_HEIGHT=78;
const forkPhoneStageScale=viewport=>Math.min(1.5,Math.max(.85,viewport.height/1080));
function forkPhoneStageSize(geometry,box) {
    const v=geometry.viewport,band=geometry.band || {top:v.y,bottom:v.y+v.height},ratio=box.aspectRatio || box.width/box.height;
    const top=Math.max(v.y,band.top)+FORK_PHONE_GAP,bottom=Math.min(v.y+v.height,band.bottom)-FORK_PHONE_GAP;
    let height=Math.min(box.height*forkPhoneStageScale(v),bottom-top),width=height*ratio;
    if (width>v.width-24) {width=v.width-24;height=width/ratio;}
    if (!(width>=FORK_PHONE_MIN_WIDTH)) return null;
    return {x:v.x+(v.width-width)/2,y:top+(bottom-top-height)/2,width,height,zoom:Math.min(1.6,Math.max(.7,width/box.width))};
}
// One stage owner measures and allocates all state/source/performance instances.
function useForkWidgetStage(props) {
    const local=React.useRef({state:null,refs:new Map()}), context=props.context || (typeof forkStageSessions!=='undefined' && forkStageSessions.owner?.getWidgetContext(props.sessionId)) || local.current;
    context.transcripts ||= new Set();
    const [,redraw]=React.useState(0), [geometry,setGeometry]=React.useState(null), [ready,setReady]=React.useState({}), [failed,setFailed]=React.useState({});
    const [visible,setVisible]=React.useState({key:'',text:''}), [grants,setGrants]=React.useState({key:'',items:[]}), [history,setHistory]=React.useState(null), [sheet,setSheet]=React.useState(null);
    const [avatars,setAvatars]=React.useState({key:'',values:{}}),[wallpaper,setWallpaper]=React.useState(null);
    const wallpaperEpoch=React.useRef('');
    const [foreground,setForeground]=React.useState(!document.hidden);
    const motionQuery=React.useMemo(()=>matchMedia('(prefers-reduced-motion: reduce)'),[]);
    React.useEffect(()=>{const change=()=>redraw(n=>n+1);motionQuery.addEventListener?.('change',change);return()=>motionQuery.removeEventListener?.('change',change);},[motionQuery]);
    const audioEvents=React.useRef(new Map());
    const lastPositions=React.useRef(new Map()), previousInput=React.useRef(''), focusReturn=React.useRef(null), enabledBefore=React.useRef(props.enabled);
    React.useEffect(()=>{const wake=()=>setForeground(!document.hidden);document.addEventListener('visibilitychange',wake);return()=>document.removeEventListener('visibilitychange',wake);},[]);
    const paused=props.paused || !foreground, cursor={turn:props.turn,page:props.page,para:props.pages[props.page]?.para || 0,generation:JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation])};
    // private fork (owner 2026-10): the phone stays in hand across a mixed run of narration and phone lines.
    const phoneRun=props.enabled && props.record?.token?.bindingKey && typeof forkPhoneRun==='function' ? forkPhoneRun(props.record,cursor.para) : null;
    if (phoneRun) cursor.holdRef=FORK_PHONE_KEY;
    const phoneClosed=React.useRef(null);
    const readingKey=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.card]);
    const text=visible.key===readingKey ? visible.text : '';
    const currentRow={turn:props.turn,sourceKey:props.record?.binding?.stream?.operationId || props.record?.token?.sourceKey,record:props.record,pages:props.pages};
    const scope=JSON.stringify([props.sessionId,props.source?.authorityEpoch,props.source?.branchId,props.source?.generation]), held=React.useRef({scope,items:new Map()});
    if (held.current.scope!==scope || !props.enabled) held.current={scope,items:new Map()};
    const currentRefs=new Set((props.record?.token?.bindingKey && ['partial','done'].includes(props.record.phase) ? props.record.entries : []).filter(entry=>entry.at<=Math.min(cursor.para,props.record.through)).flatMap(entry=>entry.ops.filter(op=>op.op==='widget.source').map(op=>forkWidgetRefKey(op.ref))));
    const available=(props.enabled ? props.widgets : []).filter(item=>item.definition?.document?.presentation && (item.modSource ? props.record?.entries?.some(entry=>entry.at<=Math.min(cursor.para,props.record.through) && entry.ops.some(op=>forkSourceMark(op,item.ref))) : item.ref?.kind==='widgets' && (!item.sourceOnly || currentRefs.has(forkWidgetRefKey(item.ref)))));
    for (const widget of available) if (widget.sourceOnly) {const key=forkWidgetRefKey(widget.ref);context.refs.set(key,widget.ref);held.current.items.set(key,widget);}
    while (context.refs.size>64) context.refs.delete(context.refs.keys().next().value);
    for (const key of held.current.items.keys()) if (!context.refs.has(key)) held.current.items.delete(key);
    const known=[...context.refs.values()];
    const grantKey=JSON.stringify([scope,props.source,props.record?.token,props.record?.assetRevision,props.assetRevision,cursor.para,props.enabled,known,history?.key]);
    React.useEffect(()=>{
        let live=true;
        const missing=known.filter(ref=>!available.some(item=>forkWidgetRefKey(item.ref)===forkWidgetRefKey(ref)) || history?.scope===scope && history.rows.some(row=>row.turn<props.turn));
        if (!props.enabled || !props.record?.token || !missing.length) return;
        (async()=>{
            const items=[];
            for (const ref of missing) {
                const result=await (props.readWindow || ((args)=>rpc(ref.modId==='dsh.phone'?'getStagePhonePresentation':'getAssetPackPresentation',args,props.sessionId)))({sessionId:props.sessionId,turn:props.turn,at:cursor.para,expectedDirectionToken:props.record.token,...(ref.modId?{}:{widgetWindow:{ref}})}).catch(()=>null);
                if (!live) return;
                if (result?.status==='ready') items.push(...result.widgets);
            }
            if (live) {
                for (const ref of missing) held.current.items.delete(forkWidgetRefKey(ref));
                for (const widget of items) held.current.items.set(forkWidgetRefKey(widget.ref),widget);
                setGrants({key:grantKey,scope,items});
            }
        })();
        return()=>{live=false;};
    },[grantKey]);
    const wallpaperKey=JSON.stringify([scope,props.turn,props.assetRevision]);wallpaperEpoch.current=wallpaperKey;
    const byRef=new Map();
    // Keep only the mounted descriptor while checking a new window; it cannot authorize actions, claims or media.
    const checked=grants.scope===scope && grants.key===grantKey;
    const historical=props.enabled ? (checked ? grants.items : [...held.current.items.values()].map(item=>({...item,checking:true}))) : [];
    for (let widget of [...available,...historical]) {if(widget.modSource && wallpaper?.key===wallpaperKey)widget={...widget,...wallpaper.item};if (!byRef.has(forkWidgetRefKey(widget.ref))) byRef.set(forkWidgetRefKey(widget.ref),{...widget,historyAvatars:checked?grants.items.find(item=>forkWidgetRefKey(item.ref)===forkWidgetRefKey(widget.ref))?.historyAvatars:{}});}
    const rows=[...(history?.scope===scope ? history.rows.filter(row=>row.turn<props.turn) : []),currentRow];
    const items=[...byRef].slice(0,64).map(([key,value])=>{
        const source=value.sourceOnly ? forkWidgetThread({rows,ref:value.ref,cursor,visibleText:text,revealed:props.revealed,limited:history?.limited,unavailable:history?.unavailable}) : null;
        if (source && context.state?.entries.get(key)?.requestedState==='open' && history?.key!==JSON.stringify([scope,props.source,key])) source.historyStatus='loading';
        const voiceHandles=new Map();
        if (source) source.messages=source.messages.map(row=>{
            const line=(row.turn===props.turn ? props.pages : rows.find(value=>value.turn===row.turn)?.pages)?.find(line=>line.para===row.para);
            const voice=(!value.modSource || row.form==='voice') && row.revealed
                ? row.turn===props.turn ? line?.voice : value.modSource && row.form==='voice' && line ? props.historyVoice?.(line) : null
                : null;
            const handle=voice ? 'voice:'+row.turn+':'+row.para : null;
            if (handle) voiceHandles.set(handle,()=>{props.onPause?.();voice.click?.();});
            return {...row,...(handle?{voice:handle}:{}),...(value.modSource?{transcript:context.transcripts.has(row.id)}:{})};
        });
        const mark=props.record?.entries?.find(entry=>entry.at===cursor.para)?.ops.map(op=>forkSourceMark(op,value.ref)).find(Boolean);
        const token=mark ? JSON.stringify([currentRow.sourceKey,props.record.token.generation,props.turn,cursor.para]) : value.eventToken;
        return {...value,key,source,voiceHandles,onTranscript:id=>{if(!source?.messages.some(row=>row.id===id && row.form==='voice'))return;if(context.transcripts.has(id))context.transcripts.delete(id);else context.transcripts.add(id);redraw(n=>n+1);},event:token ? {token,para:mark?cursor.para:value.eventAt,side:mark?.side} : null,
            identity:props.sessionId+':'+(props.source?.authorityEpoch || 0)+':'+(props.source?.branchId || '')+':'+key+':'+value.definition.contentIdentity,notifications:value.definition.document.presentation.notifications,
            fingerprint:JSON.stringify(value.state),performance:Boolean(value.performance)};
    });
    const avatarInputs=[...new Map(items.flatMap(item=>item.source?.messages.map(row=>{
        const id=row.turn+':'+row.para, avatar=item.historyAvatars?.[id];
        const line=row.turn===props.turn ? props.pages.find(line=>line.para===row.para) : null;
        const character=line && forkBubbleCharacter(props.config,line);
        const mood=character && forkBubbleMood(line.mood,forkBubbleMoodList(props.config,character.alias))?.id;
        return [id,[id,character?{alias:character.alias,mood}:null,avatar]];
    }) || [])).values()];
    const avatarKey=JSON.stringify([scope,props.source,props.assetRevision,avatarInputs]);
    React.useEffect(()=>{
        let live=true;const inputs=avatarInputs.map(([id,current,history])=>{const face=current?props.avatarOf?.(current.alias,current.mood):history;const url=current?face?.src:face?.url;return [id,url?JSON.stringify([url,face?.crop || null]):null];}),urls=[...new Set(inputs.map(([,url])=>url).filter(Boolean))].slice(0,8);
        const rows=Object.fromEntries(inputs.map(([id,url])=>[id,'a'+urls.indexOf(url)]));
        // Independent image budget: eight 64px thumbnails, <=16KiB each; missing decoration never delays reading.
        const load=encoded=>new Promise(resolve=>{
            const [url,crop]=JSON.parse(encoded);
            const image=new Image();image.onerror=()=>resolve(null);
            image.onload=()=>{try {
                const canvas=document.createElement('canvas');canvas.width=canvas.height=64;
                const c=forkWidgetAvatarSquare(image.naturalWidth,image.naturalHeight,crop || undefined);
                // Cover the square thumbnail before transfer; CSS cannot undo a stretched canvas.
                canvas.getContext('2d').drawImage(image,c.x,c.y,c.width,c.height,0,0,64,64);const value=canvas.toDataURL();
                resolve(new TextEncoder().encode(value).length<=16384?value:null);
            } catch {resolve(null);}};
            image.src=url;
        });
        Promise.all(urls.map(load)).then(values=>{if(live)setAvatars({key:avatarKey,rows,values:Object.fromEntries(values.map((value,i)=>['a'+i,value]).filter(([,value])=>value))});});
        return()=>{live=false;};
    },[avatarKey]);
    for (const item of items) if (item.source) {
        item.source.avatars={};
        item.source.messages=item.source.messages.map(row=>{
            const key=avatars.key===avatarKey?avatars.rows[row.turn+':'+row.para]:null,value=avatars.values[key];
            if (!value) return row;
            item.source.avatars[key]=value;return {...row,avatar:key};
        });
    }
    cursor.currentRef=items.find(item=>item.source?.current)?.key || null;
    const mountedIdentities=items.map(item=>item.identity).sort().join('|');
    React.useEffect(()=>{
        const active=new Set(items.map(item=>item.identity)),keep=values=>Object.fromEntries(Object.entries(values).filter(([identity])=>active.has(identity)));
        setReady(keep);setFailed(keep);
        for (const map of [audioEvents.current,lastPositions.current]) for (const key of map.keys()) if (!byRef.has(key)) map.delete(key);
    },[mountedIdentities]);
    const signature=JSON.stringify([cursor,items.map(item=>[item.key,item.identity,item.event,item.fingerprint]),props.enabled,paused,props.skipping,props.mode]);
    // The session owner can clear this state before the mounted hook unmounts.
    if (!context.state) {context.state=forkWidgetPresentationState();previousInput.current='';}
    for (const [key,event] of audioEvents.current) if (!byRef.has(key) || paused || props.mode!=='live' || props.skipping) event.fresh=false;
    if (previousInput.current!==signature) {
        context.state=forkReduceWidgetPresentation(context.state,{type:'content',cursor,items:items.map(item=>({...item,source:item.sourceOnly})),live:props.mode==='live',suspended:paused,skipping:props.skipping,restoring:!enabledBefore.current && props.enabled});
        enabledBefore.current=props.enabled;
        previousInput.current=signature;
    }
    // private fork: a portrait phone reads the widget as the phone itself, so opening goes straight to the full-bleed sheet.
    const portrait=Boolean(geometry && geometry.viewport.width<700 && geometry.viewport.height>geometry.viewport.width);
    const action=(key,type)=>{
        if (key===FORK_PHONE_KEY) phoneClosed.current=['collapse','hide'].includes(type) && phoneRun ? phoneRun.key : null;
        if (type==='open' && portrait) type='sheet';
        if (['open','sheet'].includes(type)) {focusReturn.current=document.activeElement;props.onPause?.();}
        if (['collapse','hide'].includes(type)) requestAnimationFrame(()=>{const panel=[...(props.rootRef.current?.querySelectorAll('.fork-widget-panel') || [])].find(node=>node.dataset.widgetRef===key && node.dataset.presentation!=='hidden');const target=focusReturn.current?.isConnected && focusReturn.current!==document.body ? focusReturn.current : (type==='collapse'?panel:null) || props.rootRef.current?.querySelector('.fork-widget-menu>button');target?.focus();});
        if (type==='sheet') {setSheet(key);type='open';} else if (['collapse','hide','open'].includes(type)) setSheet(null);
        context.state=forkReduceWidgetPresentation(context.state,{type,key});redraw(n=>n+1);
    };
    const opened=items.find(item=>item.sourceOnly && context.state.entries.get(item.key)?.requestedState==='open');
    const historyKey=opened ? JSON.stringify([scope,props.source,opened.key]) : '';
    React.useEffect(()=>{
        if (!opened) return;
        let live=true;
        (props.readHistory || ((source)=>forkStageSessions.owner?.readWidgetHistory(props.sessionId,source)))(props.source)?.then(value=>{if (live && value) setHistory({...value,scope,key:historyKey});});
        return()=>{live=false;};
    },[historyKey]);
    React.useLayoutEffect(()=>{
        const root=props.rootRef.current;if (!root) return;
        const measure=()=>{
            const frame=root.getBoundingClientRect(),rect=node=>{const r=node.getBoundingClientRect();return {x:r.left-frame.left,y:r.top-frame.top,width:r.width,height:r.height};};
            const blocked=[],caption=[],band={top:0,bottom:frame.height};
            for (const node of root.querySelectorAll('.fork-gal-topbar,.fork-gal-letterbox i,.fork-gal-box,.fork-gal-side,.fork-gal-controls')) {
                const r=rect(node);if (!r.width || !r.height) continue;
                if (node.matches('.fork-gal-box')) caption.push(r);else blocked.push(r);
                // The free reading band: below the top bar / upper letterbox, above the dialogue box / lower letterbox.
                if (node.matches('.fork-gal-topbar,.fork-gal-letterbox i') && r.y+r.height/2<frame.height/2) band.top=Math.max(band.top,r.y+r.height);
                else if (node.matches('.fork-gal-box,.fork-gal-letterbox i')) band.bottom=Math.min(band.bottom,r.y);
            }
            const visual=window.visualViewport,x=Math.max(0,(visual?.offsetLeft || 0)-frame.left),y=Math.max(0,(visual?.offsetTop || 0)-frame.top);
            const width=Math.max(0,Math.min(frame.width,(visual?.offsetLeft || 0)+(visual?.width || innerWidth)-frame.left)),height=Math.max(0,Math.min(frame.height,(visual?.offsetTop || 0)+(visual?.height || innerHeight)-frame.top));
            if (x) blocked.push({x:0,y:0,width:x,height});if (y) blocked.push({x:0,y:0,width,height:y});
            blocked.push({x:0,y:height-64,width,height:64});
            const figures=typeof forkGalFigureSources!=='undefined' ? forkGalFigureSources.get(root)?.() || [] : [];
            const next={width,height,viewport:{x,y,width:Math.max(0,width-x),height:Math.max(0,height-y)},blocked,caption,figures,band};
            setGeometry(old=>JSON.stringify(old)===JSON.stringify(next) ? old : next);
        };
        measure();const observer=new ResizeObserver(measure);observer.observe(root);
        const timer=forkForeground.setInterval(measure,100);window.visualViewport?.addEventListener('resize',measure);
        return()=>{observer.disconnect();forkForeground.clearInterval(timer);window.visualViewport?.removeEventListener('resize',measure);};
    },[props.rootRef,props.film]);
    const phone=items.find(item=>item.ref.modId==='dsh.phone'),notice=phone?.source?.messages.find(row=>row.id===phone.source.current?.id && row.side==='in');
    const phoneEntry=phone && context.state.entries.get(phone.key),userClosed=Boolean(phoneRun && phoneClosed.current===phoneRun.key);
    // private fork (owner 2026-10): a real phone's banner — only for an incoming message that reaches a closed phone (the
    // first line of a run, or after the reader put the phone away). It slides down, stays ~3.5 s, slides back up and then
    // the phone is taken out; skip never shows it. Every other line of a run goes straight into the open phone.
    const noticeId=notice && phoneEntry?.requestedState==='compact' && !props.skipping && (!phoneRun || userClosed || phoneRun.start===cursor.para) ? notice.id : null;
    const [noticeClock,setNoticeClock]=React.useState({id:null,phase:null});
    const noticePhase=noticeClock.id===noticeId ? noticeClock.phase : null;
    const calmBanner=Boolean(props.reducedMotion);
    React.useEffect(()=>{
        if(!noticeId || paused || noticePhase==='done')return;
        const leave=setTimeout(()=>setNoticeClock({id:noticeId,phase:'leaving'}),noticePhase==='leaving'?0:FORK_PHONE_BANNER_MS);
        const done=setTimeout(()=>setNoticeClock({id:noticeId,phase:'done'}),(noticePhase==='leaving'?0:FORK_PHONE_BANNER_MS)+(calmBanner?140:300));
        return()=>{clearTimeout(leave);clearTimeout(done);};
    },[noticeId,paused]);
    // Taking the phone out never pauses AUTO or moves focus; only the reader's own open/close does. A sent line always
    // takes it out again (it has no banner), even after the reader put the phone away.
    const outgoing=phone?.source?.messages.some(row=>row.id===phone.source.current?.id && row.side==='out');
    // Leaving the run (or a sent line taking the phone out) forgets that the reader put it away.
    if (!phoneRun) phoneClosed.current=null;
    if (phone && phoneRun && phoneEntry?.requestedState==='compact' && (!userClosed || outgoing) && (!noticeId || noticePhase==='done') && phone.source?.messages.length) {
        context.state=forkReduceWidgetPresentation(context.state,{type:'open',key:phone.key});
        if (outgoing) phoneClosed.current=null;
    }
    const ordered=items.slice().sort((a,b)=>(context.state.entries.get(b.key)?.requestedState==='open')-(context.state.entries.get(a.key)?.requestedState==='open') || a.key.localeCompare(b.key));
    const placeScope=String(props.placeKey || props.sessionId || '');
    const occupied=[],layouts=new Map();let compacts=0;
    for (const item of ordered) {
        const entry=context.state.entries.get(item.key),declaration=item.definition.document.presentation;
        let state=entry.requestedState,bounds=null,surface='stage',fill=false,placed=false,phoneZoom=null;
        const headsUp=item.ref.modId==='dsh.phone' && state==='compact';
        if(headsUp && (!noticeId || noticePhase==='done'))state='hidden';
        if (geometry && state!=='hidden') {
            const viewport=geometry.viewport;
            if (state==='open' && sheet===item.key) {
                surface='sheet';const box=declaration.open;
                // Portrait phone: the view fills the reading area edge to edge (the bundle paints screen only). Elsewhere the
                // sheet keeps the declared proportions, centred on the dimmed stage.
                if (portrait) {fill=true;bounds={x:viewport.x,y:viewport.y,width:Math.max(box.minWidth,viewport.width),height:Math.max(box.minHeight,viewport.height)};}
                else {
                    let width=Math.max(box.minWidth,Math.min(box.width,viewport.width-16)),height=Math.max(box.minHeight,Math.min(box.height,viewport.height-72));
                    if (box.aspectRatio) {width=Math.max(box.minWidth,box.minHeight*box.aspectRatio,Math.min(width,height*box.aspectRatio));height=width/box.aspectRatio;}
                    bounds={x:viewport.x+Math.max(8,(viewport.width-width)/2),y:viewport.y+Math.max(8,(viewport.height-height)/2),width,height};
                }
            }
            if(headsUp){
                // As wide as the phone's own screen at this stage size, at the top centre.
                const size=forkPhoneStageSize(geometry,declaration.open),zoom=size?.zoom || forkPhoneStageScale(viewport);
                const width=Math.min(viewport.width-24,size ? size.width-FORK_PHONE_BEZEL*zoom : FORK_PHONE_SCREEN*zoom),height=FORK_PHONE_BANNER_HEIGHT*zoom;
                bounds={x:viewport.x+(viewport.width-width)/2,y:viewport.y+10*zoom,width,height};phoneZoom=zoom;
            } else if (item.ref.modId==='dsh.phone' && state==='open' && !bounds) {
                // Centred between the top bar and the dialogue box, which stays readable underneath.
                const size=forkPhoneStageSize(geometry,declaration.open);
                if (size) {bounds={x:size.x,y:size.y,width:size.width,height:size.height};phoneZoom=size.zoom;}
            }
            for (const candidate of state==='open' && !bounds ? (item.ref.modId==='dsh.phone' ? ['compact'] : ['open','compact']) : !bounds ? ['compact'] : []) {
                const box=declaration[candidate] || {width:220,height:44,minWidth:120,minHeight:44,anchor:'corner-right'};
                if (candidate==='compact' && compacts>=(viewport.width<700?1:3)) continue;
                const sizes=[false,true].map(small=>{
                    let width=small?box.minWidth:box.width,height=small?box.minHeight:box.height;
                    if (box.aspectRatio) {height=Math.max(height,width/box.aspectRatio);width=height*box.aspectRatio;}
                    return {width,height};
                });
                // The reader's own spot wins over automatic avoidance; it is only kept inside the stage.
                const saved=forkWidgetPlaces.get(placeScope,item.key,candidate),fits=sizes.find(size=>size.width+2*FORK_WIDGET_PLACE_PAD<=viewport.width && size.height+2*FORK_WIDGET_PLACE_PAD<=viewport.height);
                if (saved && fits) {bounds={...forkWidgetPlacePoint(viewport,fits,saved),...fits};state=candidate;placed=true;break;}
                const obstacles=[...geometry.blocked,...(candidate==='open' && item.source?.current ? [] : geometry.caption),...occupied];
                for (const size of sizes) {
                    bounds=forkWidgetSourcePlace({...geometry,blocked:obstacles,size,previous:lastPositions.current.get(item.key),anchor:box.anchor});
                    if (bounds) {state=candidate;break;}
                }
                if (bounds) break;
            }
            if (!bounds) state='hidden';
        } else state='hidden';
        const banner=headsUp && state==='compact' ? noticePhase==='leaving' ? 'leaving' : 'in' : null;
        if (state==='compact') compacts++;
        if (bounds) {if (surface==='stage') lastPositions.current.set(item.key,bounds);occupied.push({...bounds,height:bounds.height+8});}
        const suspended=paused || item.checking || state==='hidden' || state==='compact' && !declaration.compact;
        const reducedMotion=props.reducedMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
        const presentation={state,bounds:{width:bounds?.width || declaration.open.width,height:bounds?.height || declaration.open.height},surface,pinned:entry.pinned,attention:forkWidgetAttention(entry,cursor),suspended,
            reducedMotion,transitionMs:props.mode!=='live' || props.skipping || paused || state!==entry.requestedState ? 0 : reducedMotion ? 100 : 160};
        const isReady=ready[item.identity]===true && !failed[item.identity];
        let audio=audioEvents.current.get(item.key);
        if (!audio || audio.token!==item.event?.token) {audio={token:item.event?.token,identity:item.identity,fresh:Boolean(!suspended && entry.pending.some(event=>event.token===item.event?.token))};audioEvents.current.set(item.key,audio);}
        if (suspended || audio.identity!==item.identity) audio.fresh=false;
        const playback={mode:props.mode,skipping:props.skipping,paused:suspended,eventToken:item.event?.token,fresh:audio.fresh};
        layouts.set(item.key,{...item,presentation,bounds,fill,placed,isReady,failed:failed[item.identity],requestedState:entry.requestedState,playback,banner,phoneZoom});
    }
    // A drag or arrow key stores the reader's spot for this view; a null point forgets the widget's spots (reset).
    const place=(key,view,point)=>{
        const layout=layouts.get(key);
        if (!point) {forkWidgetPlaces.set(placeScope,key,null,null);lastPositions.current.delete(key);}
        else if (geometry && layout?.bounds && layout.presentation.surface==='stage') forkWidgetPlaces.set(placeScope,key,view,forkWidgetPlaceFraction(geometry.viewport,layout.bounds,point));
        else return;
        redraw(n=>n+1);
    };
    const clampPlace=(key,point)=>{const box=layouts.get(key)?.bounds;return geometry && box ? forkWidgetPlacePoint(geometry.viewport,box,forkWidgetPlaceFraction(geometry.viewport,box,point)) : point;};
    // Moving an existing iframe DOM node reloads its browsing context; allocation priority must not reorder mounts.
    const projected=[...layouts.values()].sort((a,b)=>a.key.localeCompare(b.key));
    useForkWidgetVariables(props,projected);
    useForkWidgetSettingImages(projected);
    useForkWidgetSettingsFeedback(props,projected,context);
    const phoneBeat=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current);
    // private fork (owner 2026-10): phone lines are read in the phone (or its banner) while the dialogue box stays up with
    // the last line from outside the phone; only a failed phone gives its line back to the box.
    const phoneLine=projected.some(item=>item.ref.modId==='dsh.phone' && item.source?.current && !item.failed);
    const phoneOpen=!paused && projected.some(item=>item.ref.modId==='dsh.phone' && item.presentation.state==='open' && item.presentation.surface==='stage' && !item.failed);
    const claimed=projected.find(item=>item.source?.current && item.ref.modId!=='dsh.phone' && item.presentation.state==='open' && !item.presentation.suspended && item.isReady && !item.checking);
    React.useLayoutEffect(()=>{
        let changed=false;
        for (const item of projected) {
            if (!item.isReady || item.presentation.suspended || item.presentation.state!=='open') continue;
            const entry=context.state.entries.get(item.key);
            const tokens=item.source ? entry.pending.filter(event=>item.source.messages.some(row=>row.turn===event.turn && row.para===event.para && row.revealed)).map(event=>event.token) : [];
            if (!tokens.length && (!entry.changed || entry.changed!==item.event?.token)) continue;
            context.state=forkReduceWidgetPresentation(context.state,{type:'presented',key:item.key,ready:true,effectiveState:'open',tokens,version:item.event?.token});changed=true;
        }
        if (changed) redraw(n=>n+1);
    });
    return {items:projected,readingKey,claim:Boolean(claimed),phoneBeat,phoneLine,phoneOpen,paused,viewport:geometry?.viewport,narrow:geometry?.viewport.width<700,portrait,action,place,clampPlace,openKey:projected.find(item=>item.requestedState==='open')?.key,
        canSelectWallpaper:props.mode==='live' && props.record?.phase==='done' && !props.skipping,
        async selectWallpaper(choice) {
            const result=await (props.wallpaperRpc || ((args)=>rpc('selectStagePhoneWallpaper',args,props.sessionId)))({sessionId:props.sessionId,turn:props.turn,at:cursor.para,expectedDirectionToken:wallpaper?.key===wallpaperKey && wallpaper.token || props.record.token,choice});
            if(wallpaperEpoch.current!==wallpaperKey)throw new Error('舞台已变化，请重新选择');
            if(result?.status!=='ready' || !result.widgets?.[0])throw new Error('壁纸不可用，请重新选择');
            setWallpaper({key:wallpaperKey,token:result.token,item:result.widgets[0]});
        },
        onVisible:value=>setVisible(old=>old.key===readingKey && old.text===value ? old : {key:readingKey,text:value}),
        onReady:(identity,value)=>setReady(old=>old[identity]===value?old:{...old,[identity]:value}),onFailure:identity=>setFailed(old=>({...old,[identity]:true}))};
}

// One ephemeral snapshot on the existing session owner, shared by the card renderer; never persisted.
function useForkWidgetSettingsFeedback(props,items,context) {
    const snapshot={sessionId:props.sessionId,turn:props.turn,page:props.page,items:items.map(item=>({ref:item.ref,
        signature:JSON.stringify([item.definition.settingsDefaults || {},item.definition.settingsOverride?.settings || {},item.definition.settingsOverride?.bindings || {}]),
        fields:item.settingsFeedback, snapshot:item.settingsSnapshot, suspended:item.presentation.suspended}))};
    React.useLayoutEffect(()=>{
        const root=props.rootRef.current;
        const publish=()=>{context.settingsFeedback={...snapshot,theme:typeof forkWidgetThemeOwners==='undefined'?null:forkWidgetThemeOwners.get(root)};document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
        publish();root?.addEventListener('widget-theme',publish);
        return()=>{root?.removeEventListener('widget-theme',publish);context.settingsFeedback=null;document.dispatchEvent(new CustomEvent('widget-settings-feedback',{detail:{sessionId:props.sessionId}}));};
    },[context,props.rootRef,JSON.stringify(snapshot)]);
}
// Committed signals wake bounded reads; navigation clears values synchronously, never by polling.
function useForkWidgetVariables(props,items) {
    const owner=React.useRef(null), [values,setValues]=React.useState({key:'',items:{}});
    if (!owner.current) owner.current={id:crypto.randomUUID(),epoch:0,key:'',busy:new Map(),requests:new Map(),proposals:new Map()};
    const state=owner.current, hasReads=item=>item.definition.document.variables || Object.keys(item.definition.settingsOverride?.bindings || {}).length,
        active=items.filter(item=>hasReads(item) && !item.presentation.suspended);
    const key=JSON.stringify([props.sessionId,props.source,props.turn,props.page,props.revealed,props.mode,props.skipping,active.map(item=>[item.identity,item.presentation.state,item.definition.settingsOverride,item.definition.settingsDefaults])]);
    if (state.key!==key) {state.key=key;state.epoch++;}
    const epoch=state.epoch, view={sessionId:props.sessionId,viewId:state.id,viewEpoch:epoch};
    const call=(method,args)=>(props.variableRpc || rpc)(method,args,args.sessionId || props.sessionId);
    React.useLayoutEffect(()=>{
        if (!active.length) return;
        let live=true,timer=null,dirty=false,last=0;
        const busy=()=>[...state.busy.values()].some(work=>work.sessionId===props.sessionId);
        const refresh=()=>{
            dirty=true;
            if (!live || busy() || timer) return;
            timer=setTimeout(async()=>{
                timer=null;if(!live || busy())return;dirty=false;last=performance.now();
                const next={};
                const coordinate=props.record?.pageIndex?.pages?.[props.page];
                for (const item of active) {
                    const input={...view,turn:props.turn,at:props.pages[props.page]?.para,expectedDirectionToken:props.record?.token,
                        page:coordinate ? {version:1,index:coordinate.page,para:coordinate.para,offset:coordinate.offset} : undefined,
                        ref:item.ref,identity:item.definition.contentIdentity,revealed:props.revealed===true,live:props.mode==='live' && !props.skipping};
                    const result=await call('readWidgetVariables',input).catch(()=>null);
                    if (!live || state.epoch!==epoch)return;
                    next[item.identity]=result || {status:'unavailable',reason:'unavailable'};
                }
                if(live && !busy())setValues({key,items:next});
                if(dirty)refresh();
            },Math.max(0,200-(performance.now()-last)));
        };
        state.refresh=refresh;refresh();
        const stop=typeof tavernSessionSignals!=='undefined' ? tavernSessionSignals.subscribe(props.sessionId,'tavern-state',refresh,refresh,refresh) : ()=>{};
        return()=>{live=false;clearTimeout(timer);stop();if(state.refresh===refresh)state.refresh=null;
            void call('invalidateWidgetVariables',{...view,active:false}).then(async()=>{
                for(const [operationId,input] of state.busy) if(input.sessionId===view.sessionId) {
                    const result=await call('widgetVariableStatus',{...input,operationId}).catch(()=>({status:'unknown'}));
                    if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
                }
            }).catch(()=>{});};
    },[key]);
    for (const item of items) {
        item.settings={...(item.definition.settings || {})};
        item.settingsFeedback={...item.definition.settingsFeedback};
        const response=values.key===key ? values.items[item.identity] : null;
        item.settingsSnapshot=response?.snapshot || {kind:'unavailable',turn:null};
        for (const field of Object.keys(item.definition.settingsOverride?.bindings || {})) {
            if (response?.settings && Object.hasOwn(response.settings,field)) item.settings[field]=response.settings[field];
            item.settingsFeedback[field]=response?.settingsFeedback?.[field] || {value:item.settings[field],source:'binding',status:item.presentation.suspended?'suspended':response?.reason || 'loading'};
        }
        if (!item.definition.document.variables)continue;
        const projection=response?.contextKey && Object.fromEntries(Object.entries(response).filter(([name])=>!['settings','settingsDiagnostics','settingsFeedback'].includes(name)));
        item.variables=projection || {
            contextKey:'loading:'+state.id+':'+epoch,revision:'',sequence:0,position:{turn:props.turn,swipeId:0},snapshot:{kind:'unavailable',turn:null},
            settlement:'idle',writable:{allowed:false,reason:'loading'},values:Object.fromEntries(Object.keys(item.definition.document.variables.reads || {}).map(id=>[id,{status:'unavailable'}]))};
        item.onVariableRequest=async request=>{
            const input={sessionId:props.sessionId,ref:item.ref,identity:item.definition.contentIdentity};
            if(state.epoch!==epoch || item.presentation.suspended)return {status:'cancelled',reason:'position-changed'};
            if(request.type==='variables.status') {
                const previous=state.requests.get(request.operationId);
                if(previous?.mount!==item.identity)return {status:'unknown'};
                const result=await call('widgetVariableStatus',{...previous.input,operationId:request.operationId});
                if(!['running','unknown'].includes(result.status)){state.busy.delete(request.operationId);state.refresh?.();}
                return result;
            }
            const requestKey=item.identity+':'+request.requestId,digest=JSON.stringify([request.contextKey,request.revision,request.operations]),previous=state.proposals.get(requestKey);
            if(previous)return previous.digest===digest ? call('widgetVariableStatus',{...state.requests.get(previous.operationId)?.input,operationId:previous.operationId}) : {status:'rejected',reason:'request-id-reused'};
            if([...state.busy.values()].some(work=>work.sessionId===props.sessionId))return {status:'rejected',reason:'operation-pending'};
            const operationId=crypto.randomUUID(),query={...input,contextKey:request.contextKey,revision:request.revision};
            state.requests.set(operationId,{mount:item.identity,input:query});state.busy.set(operationId,query);
            state.proposals.set(requestKey,{digest,operationId});while(state.proposals.size>16)state.proposals.delete(state.proposals.keys().next().value);
            while(state.requests.size>16)state.requests.delete(state.requests.keys().next().value);
            let result;
            try { result=await call('proposeWidgetVariables',{...input,operationId,contextKey:request.contextKey,revision:request.revision,operations:request.operations}); }
            catch { result=await call('widgetVariableStatus',{...query,operationId}).catch(()=>({status:'unknown',operationId})); }
            if(!['running','unknown'].includes(result.status))state.busy.delete(operationId);
            // Let the bridge publish the receipt before the committed projection replaces its revision.
            setTimeout(()=>state.refresh?.(),0);
            return result;
        };
    }
}
