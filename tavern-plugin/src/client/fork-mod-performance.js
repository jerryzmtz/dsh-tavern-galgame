// @include fork-mod-stage-surface.cjs
// @include fork-mod-stage-layers.js
// @include fork-danmaku-stage.cjs
// @include fork-item-showcase.cjs
// @include-mod items/presentation.cjs

// private fork (item performance B1, owner 2026-10): items float in front of the figures, no card. The showcase measures
// the stage (figure head/body boxes from the scene, textbox, top chrome) once per set of cards, places them with
// forkItemShowcasePlace and hands each card its slot through context. Shared by the legacy record reader and first-party
// mod presentations; no inventory behaviour here. Nothing in it takes pointer input: clicks reach the stage and advance.
let forkItemPlaceContext=null;
function forkItemPlaceSlot(){return forkItemPlaceContext || (forkItemPlaceContext=React.createContext(null));}
function forkItemStageGeometry(node) {
    const root=node.closest('.fork-gal-stage') || node.parentElement;if(!root)return null;
    const frame=root.getBoundingClientRect(),rel=el=>{const r=el.getBoundingClientRect();return {x:r.left-frame.left,y:r.top-frame.top,width:r.width,height:r.height};};
    const blocked=[...root.querySelectorAll('.fork-gal-topbar,.fork-gal-side,.fork-gal-controls,.fork-gal-name,.fork-gal-letterbox i,.fork-widget-source-controls')].map(rel);
    const boxes=[...root.querySelectorAll('.fork-gal-box')].map(rel).filter(r=>r.width>0 && r.height>0);
    const figures=typeof forkGalFigureSources!=='undefined' ? forkGalFigureSources.get(root)?.() || [] : [];
    return {width:frame.width,height:frame.height,blocked,boxTop:boxes.length ? Math.min(...boxes.map(r=>r.y)) : undefined,figures};
}
// Reads the decoded icon once: an opaque light border means a baked white background (shown on a paper tile), and a
// 失去 card takes its dust colours from the item's own pixels. Owned blob URLs are same-origin; anything else stays plain.
function forkItemImageLook(image,dust) {
    try {
        const n=40,canvas=document.createElement('canvas');canvas.width=canvas.height=n;
        const context=canvas.getContext('2d',{willReadFrequently:true}),k=Math.min(n/image.naturalWidth,n/image.naturalHeight);
        const w=image.naturalWidth*k,h=image.naturalHeight*k,ox=(n-w)/2,oy=(n-h)/2;context.drawImage(image,ox,oy,w,h);
        const data=context.getImageData(0,0,n,n).data,at=(x,y)=>(Math.min(n-1,Math.max(0,Math.round(y)))*n+Math.min(n-1,Math.max(0,Math.round(x))))*4;
        let edge=0,light=0;
        for(let t=0;t<n;t++)for(const [x,y] of [[ox+t*w/n,oy],[ox+t*w/n,oy+h-1],[ox,oy+t*h/n],[ox+w-1,oy+t*h/n]]){const i=at(x,y);edge++;if(data[i+3]>=250 && Math.min(data[i],data[i+1],data[i+2])>=226)light++;}
        const tile=light/edge>0.8,specks=[];
        if(dust)for(let t=0;t<600 && specks.length<36;t++){const x=Math.random()*n,y=Math.random()*n,i=at(x,y);if(data[i+3]>200 && !(tile && Math.min(data[i],data[i+1],data[i+2])>=226))specks.push({x:x/n,y:y/n,color:'rgb('+data[i]+' '+data[i+1]+' '+data[i+2]+')',dx:(0.3+Math.random()*0.6).toFixed(3),dy:(-0.1-Math.random()*0.45).toFixed(3),delay:Math.round(950+x/n*900+Math.random()*120)+'ms'});}
        return {tile,dust:specks.length ? specks : null};
    } catch (_) {return {tile:false,dust:null};}
}
function ForkStageCutinCard({tone,label,title,subtitle,amount,image,note,iconExpected}) {
    const h=React.createElement,slot=React.useContext(forkItemPlaceSlot()),ref=React.useRef(null);
    const place=slot?.place,spot=place?.items?.[slot.index],name=place?.names?.[slot.index],hasIcon=!!image || !!iconExpected;
    const [look,setLook]=React.useState({tile:false,dust:null});
    const sparks=React.useMemo(()=>Array.from({length:10},(_,i)=>{const a=i/10*Math.PI*2+Math.random()*0.4,d=0.5+Math.random()*0.25;
        return {'--fork-item-dx':(Math.cos(a)*d).toFixed(3),'--fork-item-dy':(Math.sin(a)*d*0.8).toFixed(3),'--fork-item-delay':Math.round((tone==='show' ? 900 : 330)+Math.random()*160)+'ms'};}),[tone]);
    React.useEffect(()=>{ // load does not bubble; a capturing listener also sees images that a child component mounts later
        const root=ref.current;if(!root)return undefined;
        let live=true;const read=img=>{if(live && img?.naturalWidth)setLook(forkItemImageLook(img,tone==='lose'));};
        const loaded=event=>{if(event.target.matches?.('.fork-item-ic img'))read(event.target);};
        root.addEventListener('load',loaded,true);
        const img=root.querySelector('.fork-item-ic img');if(img?.complete)read(img);
        return()=>{live=false;root.removeEventListener('load',loaded,true);};
    },[tone]);
    const src=image?.props?.src,count=amount!==undefined && amount!==null ? ' \u00d7'+amount : '';
    return h('div',{ref,className:'fork-item-show fork-item-'+tone+(hasIcon ? '' : ' is-text'),'data-tone':tone,'data-caption':place?.caption || 'above',
        style:spot ? {left:spot.x+'px',top:spot.y+'px','--fork-item-size':place.size+'px'} : undefined},
        hasIcon && h('i',{className:'fork-item-light','aria-hidden':true}),
        hasIcon && tone!=='lose' && h('i',{className:'fork-item-rays','aria-hidden':true}),
        hasIcon && h('div',{className:'fork-item-pic'},
            h('div',{className:'fork-item-bob'},h('div',{className:'fork-item-ic'+(look.tile ? ' is-tile' : '')},image,
                src && !look.tile ? h('i',{className:'fork-item-glint','aria-hidden':true,style:{'--fork-item-mask':'url("'+src+'")'}}) : null)),
            tone==='lose' && look.dust ? look.dust.map((speck,i)=>h('i',{key:i,className:'fork-item-dust','aria-hidden':true,style:{left:speck.x*100+'%',top:speck.y*100+'%','--fork-item-dust':speck.color,
                '--fork-item-dx':speck.dx,'--fork-item-dy':speck.dy,'--fork-item-delay':speck.delay}})) : null),
        hasIcon && tone!=='lose' && h('div',{className:'fork-item-sparks','aria-hidden':true},sparks.map((style,i)=>h('i',{key:i,className:i%3===0 ? 'is-star' : undefined,style}))),
        h('div',{className:'fork-item-cap',style:spot && name && hasIcon ? {left:name.x-spot.x+'px',top:name.y-spot.y+'px'} : undefined},h('strong',null,title),h('small',null,h('b',null,label),subtitle ? ' '+subtitle : '',count),
            note && h('small',null,note),slot?.extra && h('small',null,slot.extra)));
}
// cards: [{key, element}] where element renders ForkStageCutinCard. First pass renders hidden to measure the names.
function ForkItemShowcase({cards,extra,accent}) {
    const h=React.createElement,ref=React.useRef(null),Slot=forkItemPlaceSlot();
    const signature=cards.map(card=>card.key).join('|')+'|'+(extra || '');
    const [state,setState]=React.useState({signature:null,place:null});
    const place=state.signature===signature ? state.place : null;
    React.useLayoutEffect(()=>{
        if(place || !ref.current)return;
        const node=ref.current,geometry=forkItemStageGeometry(node),shows=[...node.querySelectorAll('.fork-item-show')];
        const captions=shows.map(show=>{const r=show.querySelector('.fork-item-cap').getBoundingClientRect();return {width:r.width,height:r.height,textOnly:show.classList.contains('is-text')};});
        setState({signature,place:forkItemShowcasePlace({...(geometry || {width:node.clientWidth,height:node.clientHeight}),captions,show:shows.some(show=>show.dataset.tone==='show')})});
    });
    return h('aside',{ref,className:'fork-item-showcase'+(place ? '' : ' is-measuring'),'aria-live':'polite',style:accent ? {'--fork-item-accent':accent} : undefined},
        place?.dim ? h('i',{className:'fork-item-dim','aria-hidden':true,style:{left:place.dim.x+'px',top:place.dim.y+'px',width:place.dim.width+'px',height:place.dim.height+'px'}}) : null,
        cards.map((card,index)=>h(Slot.Provider,{key:card.key,value:{place,index,extra:index===cards.length-1 ? extra : null}},card.element)));
}
function useForkModPerformances(sessionId,{live,skipping,overlay,sourceKey,generation,assetRevision}) {
    const h=React.createElement,[rows,setRows]=React.useState([]);
    const controller=React.useMemo(()=>createModStageSurface({definitions:[forkItemsStagePresentation()],
        readMedia:args=>rpc('readStageModMedia',args,sessionId),
        createURL:({mime,data})=>URL.createObjectURL(new Blob([Uint8Array.from(atob(data),character=>character.charCodeAt(0))],{type:mime})),
        revokeURL:url=>URL.revokeObjectURL(url),onChange:setRows,
    }),[sessionId]);
    React.useLayoutEffect(()=>{controller.reset(live && !skipping && !overlay);return()=>controller.reset(false);},[controller,live,skipping,overlay,sourceKey,generation,assetRevision]);
    React.useEffect(()=>()=>controller.dispose(),[controller]);
    // The stage passes the speaker's 形象色 as `accent` (React.cloneElement) once it knows who speaks.
    const node=live && !skipping && !overlay && rows.length ? h(ForkItemShowcase,{
        cards:rows.slice(0,2).map(row=>({key:row.id,element:row.definition.render(React,row.performance,row.media,{CutinCard:ForkStageCutinCard})})),
        extra:rows.length>2 ? '\u53e6\u6709 '+(rows.length-2)+' \u9879\u6f14\u51fa' : null}) : null;
    // Cancelling one page releases its cards; it must not disable later eligible events.
    return {play:controller.play,cancel:()=>controller.reset(live && !skipping && !overlay),busy:rows.length>0,node};
}
