'use strict';

// P3 owns event consumption. This controller only owns the finite surface and its media URLs.
function createModStageSurface({definitions,readMedia,createURL,revokeURL,onChange,clock={setTimeout:(fn,ms)=>setTimeout(fn,ms),clearTimeout:id=>clearTimeout(id)}}) {
    const renderers=new Map(definitions.map(row=>[row.kind,row]));
    let rows=[],epoch=0,active=false;
    const emit=()=>onChange(rows.map(row=>({id:row.id,performance:row.performance,definition:row.definition,media:{...row.media}})));
    const release=row=>{clock.clearTimeout(row.timer);Object.values(row.media).forEach(revokeURL);row.media={};};
    function reset(enabled=false) {epoch++;active=enabled;rows.forEach(release);rows=[];emit();}
    return Object.freeze({reset,
        async play(descriptor,token) {
            const performance=descriptor.performance,definition=renderers.get(performance?.kind);
            if(!active || descriptor.kind!=='mod-performance' || !definition)return;
            const ownEpoch=epoch,row={id:token.id,performance,definition,media:{}};
            rows.push(row);if(rows.length>8)release(rows.shift());
            const current=()=>active && epoch===ownEpoch && rows.includes(row);
            row.timer=clock.setTimeout(()=>{if(current()){rows=rows.filter(value=>value!==row);release(row);emit();}},2800);
            emit();
            await Promise.all(Object.entries(definition.media(performance)).map(async([slot,media])=>{
                try {
                    const result=await readMedia({turn:token.source.turn,source:performance.source,performanceId:performance.id,...media});
                    if(!current())return;
                    row.media[slot]=createURL(result);emit();
                } catch (_) { /* An unavailable or revoked image leaves the already consumed text presentation. */ }
            }));
        },
        dispose:()=>reset(false),
    });
}
// Logical bands stay below host dialogue and controls, including fullscreen presentation.
const MOD_UI_BANDS=Object.freeze({'stage-overlay':2,presentation:4,audience:5});
function modStageViewport(root) {
    const frame=root.getBoundingClientRect(),safeRegions=[...root.querySelectorAll('.fork-gal-box,.fork-gal-topbar,.fork-gal-choices,.fork-widget-source-controls')].map(node=>{
        const rect=node.getBoundingClientRect();return {x:rect.left-frame.left,y:rect.top-frame.top,width:rect.width,height:rect.height};
    }).filter(rect=>rect.width>0 && rect.height>0);
    return {width:frame.width,height:frame.height,safeRegions};
}
function createModStageDock(root) {
    let owner=null, slots=null, original=null;
    function release() {
        if (!slots) return;
        slots.column.remove(); slots.below?.remove();
        for (const [key,value] of Object.entries(original)) root.style[key]=value;
        owner=null; slots=null; original=null;
    }
    return Object.freeze({
        request(key, request) {
            if (!request) { if (owner===key) release(); return null; }
            if (request.side!=='right' || owner && owner!==key || !root.parentElement) return null;
            const frame=root.parentElement.getBoundingClientRect();
            if (frame.width<900) { if (owner===key) release(); return null; }
            const columnWidth=Math.min(380,Math.max(280,frame.width*0.28));
            const width=Math.min(frame.width-columnWidth,frame.height*16/9),height=width*9/16;
            if (!slots) {
                original=Object.fromEntries(['width','height','right','bottom'].map(key=>[key,root.style[key]]));
                const column=root.ownerDocument.createElement('aside');
                slots={column,below:null}; owner=key; root.parentElement.appendChild(column);
            }
            const remaining=frame.height-height;
            if (remaining>=120 && !slots.below) { slots.below=root.ownerDocument.createElement('aside');root.parentElement.appendChild(slots.below); }
            if (remaining<120 && slots.below) { slots.below.remove();slots.below=null; }
            for (const node of [slots.column,slots.below].filter(Boolean)) {
                node.className='fork-gal-theme-scope fork-mod-dock';
                node.dataset.theme=root.dataset.theme;node.dataset.fkContext=root.dataset.fkContext;
                for (const property of root.style) if (property.startsWith('--')) node.style.setProperty(property,root.style.getPropertyValue(property));
                Object.assign(node.style,{position:'absolute',overflow:'hidden',pointerEvents:'auto',zIndex:String(MOD_UI_BANDS.audience)});
            }
            Object.assign(root.style,{width:width+'px',height:height+'px',right:'auto',bottom:'auto'});
            Object.assign(slots.column.style,{left:width+'px',top:'0px',width:(frame.width-width)+'px',height:frame.height+'px'});
            if(slots.below)Object.assign(slots.below.style,{left:'0px',top:height+'px',width:width+'px',height:remaining+'px'});
            return slots;
        },dispose:release,
    });
}
function createModUiLayerHost({root,renderers,geometry=()=>modStageViewport(root),dock=createModStageDock(root)}) {
    const mounted=new Map(),doc=root.ownerDocument;
    let latest=null,refreshing=false;
    const resize=typeof ResizeObserver==='function' ? new ResizeObserver(()=>{if(latest)sync(...latest);}) : null;
    if(root.parentElement)resize?.observe(root.parentElement);
    function remove(key) {const row=mounted.get(key);if(!row)return;row.view.dispose?.();dock.request(key,null);row.node.remove();mounted.delete(key);}
    function sync(layers,context,views={}) {
        latest=[layers,context,views];
        const before=geometry();
        const ordered=[...layers].sort((a,b)=>MOD_UI_BANDS[a.band]-MOD_UI_BANDS[b.band] || a.order-b.order || (a.modId<b.modId?-1:a.modId>b.modId?1:0) || (a.id<b.id?-1:a.id>b.id?1:0));
        const wanted=new Set(ordered.map(row=>row.modId+'/'+row.id));
        for(const key of mounted.keys())if(!wanted.has(key))remove(key);
        for(const layer of ordered) {
            const key=layer.modId+'/'+layer.id,render=renderers[layer.modId+'/'+layer.entry];
            if(!render || !Object.hasOwn(MOD_UI_BANDS,layer.band))continue;
            const signature=JSON.stringify(layer);
            let row=mounted.get(key);
            if(row && row.signature!==signature){remove(key);row=null;}
            if(!row) {
                const node=doc.createElement('div');node.className='fork-mod-ui-layer';node.dataset.band=layer.band;node.dataset.input=layer.input;
                row={node,signature,slots:null};
                const requestDock=request=>{
                    row.slots=layer.input==='regions' ? dock.request(key,request) : null;
                    return row.slots;
                };
                row.view=render({root:node,context,viewport:geometry(),budget:layer.budget,dock:requestDock});
                mounted.set(key,row);
            }
            if(views[layer.modId])row.view.update?.(views[layer.modId]);
            row.view.update?.({context,viewport:geometry()});
            const surfaces=[row.node,...(row.slots?[row.slots.column,row.slots.below].filter(Boolean):[])];
            if(surfaces.reduce((n,node)=>n+node.querySelectorAll('*').length,0)>layer.budget.maxNodes || surfaces.reduce((n,node)=>n+node.children.length,0)>layer.budget.maxVisible){remove(key);continue;}
            // DOM order resolves same-band ties; the mod never receives a global z-index.
            root.appendChild(row.node);
        }
        const after=geometry();
        if(!refreshing && (before.width!==after.width || before.height!==after.height)) {
            refreshing=true;
            try {sync(layers,context,views);} finally {refreshing=false;}
        }
    }
    return Object.freeze({sync,dispose(){latest=null;resize?.disconnect();for(const key of [...mounted.keys()])remove(key);dock.dispose();}});
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createModStageSurface,createModUiLayerHost,createModStageDock,modStageViewport,MOD_UI_BANDS};
