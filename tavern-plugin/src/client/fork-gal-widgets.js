// Read-only widget containers; presentation preferences live in the session owner.
const forkWidgetRuntime = { mounted: 0, mounts: 0, errors: 0, suppressed: 0, navigations: 0, timeouts: 0, floods: 0 };
function forkWidgetCount(name) { forkWidgetRuntime[name] = Math.min(1000000, forkWidgetRuntime[name] + 1); }
let forkWidgetBoundaryType;
function getForkWidgetBoundary() {
    // Non-UI consumers can load the bundle without React's component runtime.
    if (!forkWidgetBoundaryType) forkWidgetBoundaryType = class ForkWidgetBoundary extends React.Component {
        constructor(props) { super(props); this.state = { failed: false }; }
        static getDerivedStateFromError() { return { failed: true }; }
        componentDidCatch() { forkWidgetCount('errors'); if (this.props.onError) this.props.onError(); }
        render() { return this.state.failed ? null : this.props.children; }
    };
    return forkWidgetBoundaryType;
}
function ForkWidgetIcon({ name }) {
    const h = React.createElement;
    // private fork: host chrome glyphs (line icons, currentColor) for the widget windows and their entry chips.
    const paths = { alarm: 'M8 3 4 6m12-3 4 3M7 19l-2 3m12-3 2 3M12 8v5l3 2M20 13a8 8 0 1 1-16 0 8 8 0 0 1 16 0', clock: 'M12 7v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0', message: 'M3 4h18v13H9l-6 4V4z', letter: 'M2 5h20v14H2zM2 5l10 8L22 5',
        widget: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', collapse: 'M6 10l6 6 6-6', open: 'M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7', hide: 'M6 6l12 12M18 6 6 18',
        pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6', reset: 'M12 3v4M12 17v4M3 12h4M17 12h4M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0', sheet: 'M4 5h16v14H4zM8 9h8M8 13h5', history: 'M4 6h12M4 11h16M4 16h9', warning: 'M12 4 21 19H3zM12 10v4M12 16.5v.1' };
    return paths[name] ? h('svg', { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: paths[name] })) : null;
}
function ForkWidgetContent({widget,seconds}) {
    if (!widget.definition?.thirdParty) return null;
    return React.createElement(ForkWidgetSandbox,{key:widget.definition.contentIdentity,widget,seconds});
}
function ForkWidgetCard({widget}) {
    const box=widget.definition.document.presentation.open;
    const presentation=widget.presentation || {state:'open',bounds:{width:box.width,height:box.height},surface:'stage',pinned:false,attention:{count:0,changed:false},suspended:false,reducedMotion:true,transitionMs:0};
    return React.createElement('article',{className:'fork-widget-preview-card'},React.createElement(ForkWidgetContent,{widget:{...widget,presentation}}));
}
// private fork: chromeless widget windows (owner 2026-10, "无感"). A self-drawn view (open device, phone island) and the
// generic entry chip carry no host chrome; the host only adds invisible hit areas that never cover the widget's own
// interactive content — a ring over the device edge (drag to move, double-click resets), a cover over compact views (tap
// opens, drag moves) and, on the full-bleed portrait sheet, a strip over the top edge. Right-click, a touch long-press,
// Shift+F10 or the ContextMenu key open one galgame menu with the presentation actions.
const FORK_WIDGET_HOLD_MS=500,FORK_WIDGET_SLOP=6;
let forkWidgetHintSerial=0;
function forkWidgetMenuEntries(item,owner) {
    const p=item.presentation,open=p.state==='open',entries=[open?{type:'collapse',icon:'collapse',label:'收起'}:{type:'open',icon:'open',label:'打开'}];
    if (open) entries.push({type:'pin',icon:'pin',label:'固定',hint:'翻页后保持打开',checked:p.pinned});
    if (open && p.surface==='stage' && owner.narrow && !owner.portrait) entries.push({type:'sheet',icon:'sheet',label:'阅读面板'});
    if (item.placed && p.surface==='stage') entries.push({type:'reset',icon:'reset',label:'复位位置'});
    entries.push({type:'hide',icon:'hide',label:'关闭',hint:'可从模组列表重新打开',parted:true});
    return entries;
}
function ForkWidgetPanel({item,owner,onBacklog,onMenu,onAdvance,onWheel}) {
    const h=React.createElement,loaded=React.useRef(false),panel=React.useRef(null),previousPresentation=React.useRef(null),gesture=React.useRef(null),hint=React.useRef(null);
    if (!hint.current) hint.current='fork-widget-hint-'+(++forkWidgetHintSerial);
    const p=item.presentation,shown=!owner.paused && p.state!=='hidden',custom=p.state==='open' || p.state==='compact' && item.definition.document.presentation.compact;
    // private fork (owner 2026-10): the phone keeps its centred place and the banner its top-centre slot.
    const movable=p.surface==='stage' && Boolean(item.bounds) && !item.modSource;
    if (custom && shown && !item.failed) loaded.current=true;
    React.useEffect(()=>{
        const previous=previousPresentation.current;previousPresentation.current={state:p.state,surface:p.surface,shown:previous?.shown || shown};
        // private fork: text-bearing windows keep their opaque paint throughout entry; reduced motion snaps.
        if (!previous?.shown || previous.state===p.state && previous.surface===p.surface || !shown || !p.transitionMs || p.reducedMotion) return;
        const animation=panel.current?.animate([{transform:'translateY(4px)'},{transform:'translateY(0)'}],{duration:p.transitionMs,easing:'ease-out'});
        return()=>animation?.cancel();
    },[p.state,p.surface,owner.paused,p.reducedMotion,p.transitionMs]);
    React.useEffect(()=>{
        if (p.state!=='open' || p.surface!=='sheet' || owner.paused) return;
        const before=document.activeElement,root=panel.current?.closest('.fork-gal-stage');
        const masked=[...(root?.children || [])].filter(node=>!node.contains(panel.current)).map(node=>[node,node.inert]);
        for (const [node] of masked) node.inert=true;
        const focus=()=>panel.current?.focus({preventScroll:true}),guard=event=>{if(!panel.current?.parentNode?.contains(event.target))focus();};
        document.addEventListener('focusin',guard);focus();
        return()=>{document.removeEventListener('focusin',guard);for(const [node,inert] of masked)node.inert=inert;if(before?.isConnected)before.focus();};
    },[p.state,p.surface,owner.paused]);
    React.useEffect(()=>()=>{const g=gesture.current;if(g){clearTimeout(g.timer);cancelAnimationFrame(g.frame);}},[]);
    const open=()=>owner.action(item.key,item.requestedState==='open' && p.state!=='open'?'sheet':'open');
    const menu=(x,y,touch)=>onMenu?.({key:item.key,x,y,touch,panel:panel.current});
    const widget={...item,scopeKey:item.identity,
        onAdvance:item.modSource?onAdvance:undefined,onWheel:item.modSource?onWheel:undefined,
        onReady:value=>owner.onReady(item.identity,value),onFailure:()=>owner.onFailure(item.identity),onAction:type=>owner.action(item.key,type)};
    // One pointer at a time: a touch hold opens the menu unless it moves first; past the slop a drag follows the pointer
    // (clamped by the owner) on a paint-only translate and is stored once, on release.
    const down=(event,kind)=>{
        panel.current?.setAttribute('data-pointer','');
        if (event.button!==0 || !shown) return;
        event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);
        const g={id:event.pointerId,kind,touch:event.pointerType!=='mouse',x:event.clientX,y:event.clientY,origin:item.bounds,to:null,moved:false,held:false,cancelled:false,timer:0,frame:0};
        if (g.touch) g.timer=setTimeout(()=>{g.held=true;menu(g.x,g.y,true);},FORK_WIDGET_HOLD_MS);
        gesture.current=g;
    };
    const move=event=>{
        const g=gesture.current;if (!g || g.id!==event.pointerId || g.held || g.cancelled) return;
        const dx=event.clientX-g.x,dy=event.clientY-g.y;
        if (!g.moved && Math.hypot(dx,dy)<FORK_WIDGET_SLOP) return;
        clearTimeout(g.timer);
        if (!movable || g.kind==='edge' || !g.origin) {g.cancelled=true;return;}
        g.moved=true;g.to=owner.clampPlace(item.key,{x:g.origin.x+dx,y:g.origin.y+dy});
        if (!g.frame) g.frame=requestAnimationFrame(()=>{g.frame=0;const node=panel.current;if(node && g.to){node.classList.add('is-dragging');node.style.translate=(g.to.x-g.origin.x)+'px '+(g.to.y-g.origin.y)+'px';}});
    };
    const up=(event,cancelled)=>{
        const g=gesture.current;if (!g || g.id!==event.pointerId) return;
        gesture.current=null;clearTimeout(g.timer);cancelAnimationFrame(g.frame);
        const node=panel.current;
        if (g.moved) {
            node?.classList.remove('is-dragging');
            if (node) {node.style.translate='';if(!cancelled && g.to){node.style.left=g.to.x+'px';node.style.top=g.to.y+'px';}}
            if (!cancelled && g.to) owner.place(item.key,p.state,g.to);
            return;
        }
        if (!cancelled && !g.held && !g.cancelled && g.kind==='cover') open();
    };
    const reset=event=>{event.stopPropagation();if (item.placed) owner.place(item.key,null,null);};
    const grip=(kind,side)=>h('div',{key:kind+(side || ''),className:'fork-widget-grip is-'+kind+(side?' is-'+side:''),'aria-hidden':true,
        onPointerDown:event=>down(event,kind),onPointerMove:move,onPointerUp:event=>up(event,false),onPointerCancel:event=>up(event,true),onDoubleClick:kind==='ring'?reset:undefined});
    const grips=!shown ? null : item.fill ? [grip('edge')] : p.state==='open' ? ['top','right','bottom','left'].map(side=>grip('ring',side)) : [grip('cover')];
    const chip=(text,label,type)=>h('button',{type:'button',className:'fork-widget-chip','aria-label':label,onClick:()=>type==='backlog'?onBacklog?.():owner.action(item.key,type)},h(ForkWidgetIcon,{name:type==='backlog'?'history':'sheet'}),text);
    const caption=item.definition.title,count=p.attention.count,attention=count ? (count>99?'99+':count)+' 待查看' : p.attention.changed?'有更新':'';
    const notes=[
        item.failed?h('p',{key:'failed',role:'status',className:'fork-widget-warning'},h(ForkWidgetIcon,{name:'warning'}),'模组不可用；正文已恢复'):null,
        item.requestedState==='open' && p.state!=='open'?h(React.Fragment,{key:'read'},chip('阅读','空间不足，打开阅读面板','sheet')):null,
        item.sourceOnly && p.state==='open' && (item.source?.historyStatus!=='ready' || item.source?.hasEarlier || item.source?.messages.some(row=>row.truncated))?h(React.Fragment,{key:'backlog'},chip('在履历查看','长消息或更早内容，请在履历查看全文','backlog')):null].filter(Boolean);
    const help=(p.state==='open' ? (movable?'拖动边缘移动，方向键微调；':'')+'Esc 收起' : '回车打开；拖动移动，方向键微调')+'；右键、长按或 Shift+F10 打开菜单';
    return h('section',{ref:panel,tabIndex:shown?0:-1,className:'fork-widget-panel'+(p.surface==='sheet'?' is-sheet':'')+(item.fill?' is-fill':'')+(custom?' is-custom':' is-chip')+(item.banner && shown?' is-banner':''),'data-widget-ref':item.key,'data-presentation':p.state,'data-banner':item.banner && shown?item.banner:undefined,
        role:p.surface==='sheet'?'dialog':'group','aria-modal':p.surface==='sheet'?'true':undefined,'aria-label':caption+(attention?'，'+attention:''),'aria-describedby':hint.current,'aria-haspopup':'menu','aria-keyshortcuts':'Shift+F10 ContextMenu',
        style:{left:item.bounds?.x || 0,top:item.bounds?.y || 0,width:item.fill?owner.viewport.width:p.bounds.width,height:item.fill?owner.viewport.height:undefined,maxHeight:p.surface==='sheet' && !item.fill?Math.max(0,owner.viewport.height-16):undefined,visibility:shown?'visible':'hidden',pointerEvents:shown?'auto':'none','--widget-transition':p.transitionMs+'ms','--phone-zoom':item.phoneZoom || undefined},
        inert:!shown?true:undefined,onClick:e=>{e.stopPropagation();if(item.modSource && !e.target.closest('button,a,input,textarea,select,[role="button"],.fork-widget-grip'))onAdvance?.();},onWheel:e=>{e.stopPropagation();if(item.modSource)onWheel?.(e);},
        onContextMenu:e=>{e.preventDefault();e.stopPropagation();const g=gesture.current;if(!shown || g?.held)return;if(g){clearTimeout(g.timer);g.held=true;}menu(e.clientX,e.clientY,Boolean(g?.touch) || e.nativeEvent.pointerType==='touch');},
        onKeyDown:e=>{
            e.stopPropagation();e.currentTarget.removeAttribute('data-pointer');
            if (e.key==='ContextMenu' || e.key==='F10' && e.shiftKey) {e.preventDefault();const r=e.currentTarget.getBoundingClientRect();menu(r.left+Math.min(24,r.width/2),r.top+Math.min(24,r.height/2),false);return;}
            if (e.key==='Escape') {e.preventDefault();owner.action(item.key,'collapse');return;}
            if(item.modSource && p.state==='open' && e.target===e.currentTarget && (e.key==='Enter' || e.key===' ')){e.preventDefault();onAdvance?.();return;}
            if (e.target===e.currentTarget) {
                if ((e.key==='Enter' || e.key===' ') && p.state!=='open') {e.preventDefault();open();return;}
                const step=e.shiftKey?40:10,delta={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[e.key];
                if (delta && movable) {e.preventDefault();owner.place(item.key,p.state,{x:item.bounds.x+delta[0],y:item.bounds.y+delta[1]});return;}
            }
            if (e.key==='Tab' && p.surface==='sheet') {const nodes=[e.currentTarget,...e.currentTarget.querySelectorAll('button,iframe')];const index=nodes.indexOf(document.activeElement);if(e.shiftKey&&index<=0 || !e.shiftKey&&index===nodes.length-1){e.preventDefault();nodes[e.shiftKey?nodes.length-1:0]?.focus();}}
        }},
        // Only the generic chip paints a caption (its glyph, title and unread bead); self-drawn views explain themselves.
        custom?null:h('span',{className:'fork-widget-caption'},h('span',{className:'fork-widget-glyph'},h(ForkWidgetIcon,{name:item.sourceOnly?'message':'widget'})),h('strong',null,caption),
            attention?h('span',{className:'fork-widget-attention'+(count?'':' is-dot'),role:'status','aria-label':attention},count?(count>99?'99+':String(count)):null):null),
        // A compact view is read through the host cover (tap opens), so its frame takes no focus or pointer of its own.
        h('div',{className:'fork-widget-panel-body',style:{display:custom?'block':'none',minWidth:p.bounds.width,height:p.bounds.height,visibility:item.checking || p.state==='open' && item.source?.current && !item.isReady?'hidden':undefined},inert:p.suspended || p.state==='compact'?true:undefined},loaded.current&&!item.failed?h(ForkWidgetContent,{widget}):null),
        item.modSource && p.state==='open' && item.wallpaperChoices?.length?h('div',{className:'fork-widget-notes'},h(ForkPhoneWallpaperPicker,{item,owner})):null,
        notes.length?h('div',{className:'fork-widget-notes'},notes):null,
        grips,
        h('span',{id:hint.current,hidden:true},help));
}
function ForkPhoneWallpaperPicker({item,owner}) {
    const h=React.createElement,[busy,setBusy]=React.useState(false),[error,setError]=React.useState(false);
    if(!item.modSource || !item.wallpaperChoices?.length)return null;
    return h(React.Fragment,null,h(ForkInlineField,{kind:'menu',label:'换壁纸',value:item.wallpaperSelection || '',
        options:item.wallpaperChoices.map(row=>({value:row.id,label:row.name})),placeholder:'纯底色',
        disabled:busy || !owner.canSelectWallpaper || item.checking || item.presentation.suspended,
        onCommit:async choice=>{setBusy(true);setError(false);try {await owner.selectWallpaper(choice);} catch {setError(true);} finally {setBusy(false);}}}),
        busy?h(ForkSpinner,{label:'正在换壁纸'}):null,
        error?h('p',{className:'fork-widget-warning',role:'alert'},h(ForkWidgetIcon,{name:'warning'}),'壁纸已变化，请重新选择'):null);
}
// The single widget menu: an opaque galgame card at the pointer, or a bottom sheet for touch, with roving focus.
function ForkWidgetContextMenu({item,owner,request,layer,onClose}) {
    const h=React.createElement,list=React.useRef(null),armed=React.useRef(false),[at,setAt]=React.useState(null),entries=forkWidgetMenuEntries(item,owner);
    React.useLayoutEffect(()=>{
        const frame=layer.current?.getBoundingClientRect(),box=list.current?.getBoundingClientRect();
        if (!frame || !box) return;
        if (request.touch) {setAt({});return;}
        const x=Math.max(8,Math.min(request.x,innerWidth-box.width-8)),y=request.y+box.height+8>innerHeight ? Math.max(8,request.y-box.height) : request.y;
        setAt({left:x-frame.left,top:y-frame.top});
    },[request]);
    React.useEffect(()=>{if (at) list.current?.querySelector('[role^=menuitem]')?.focus({preventScroll:true});},[at]);
    React.useEffect(()=>{const away=()=>onClose(false);window.addEventListener('blur',away);window.addEventListener('resize',away);return()=>{window.removeEventListener('blur',away);window.removeEventListener('resize',away);};},[request]);
    const keys=event=>{
        event.stopPropagation();
        const rows=[...list.current.querySelectorAll('[role^=menuitem]')],index=rows.indexOf(document.activeElement);
        const go=next=>{event.preventDefault();rows[(next+rows.length)%rows.length]?.focus();};
        if (['Escape','Tab','ContextMenu'].includes(event.key) || event.key==='F10' && event.shiftKey) {event.preventDefault();onClose(true);}
        else if (event.key==='ArrowDown') go(index+1);
        else if (event.key==='ArrowUp') go(index-1);
        else if (event.key==='Home') go(0);
        else if (event.key==='End') go(rows.length-1);
    };
    // Releasing the long-press that opened the menu can land a click on the veil or a row under the finger; only a press
    // that started inside the menu layer (or a keyboard click, detail 0) acts.
    const arm=event=>{event.stopPropagation();armed.current=true;};
    const run=(event,entry)=>{
        if (event.detail && !armed.current) return;
        onClose(entry.type==='pin' || entry.type==='reset');
        if (entry.type==='reset') owner.place(item.key,null,null);else owner.action(item.key,entry.type);
    };
    return h(React.Fragment,null,
        h('div',{className:'fork-widget-context-veil'+(request.touch?' is-dim':''),'aria-hidden':true,onPointerDown:arm,onClick:()=>{if (armed.current) onClose(false);},onContextMenu:()=>onClose(false)}),
        h('div',{ref:list,role:'menu','aria-label':item.definition.title,className:'fork-widget-context'+(request.touch?' is-sheet':''),style:at || {visibility:'hidden'},onKeyDown:keys,onPointerDown:arm},
            request.touch?h('i',{className:'fork-widget-context-grab','aria-hidden':true}):null,
            entries.map(entry=>h('button',{key:entry.type,type:'button',tabIndex:-1,role:entry.type==='pin'?'menuitemcheckbox':'menuitem','aria-checked':entry.type==='pin'?String(Boolean(entry.checked)):undefined,
                className:'fork-widget-context-row'+(entry.parted?' is-parted':''),onClick:event=>run(event,entry)},
                h(ForkWidgetIcon,{name:entry.icon}),h('span',null,entry.label,entry.hint?h('small',null,entry.hint):null),
                entry.type==='pin'?h('i',{className:'fork-widget-context-check','aria-hidden':true}):null))));
}
function ForkWidgetMenu({owner}) {
    const h=React.createElement,[open,setOpen]=React.useState(false),[bounds,setBounds]=React.useState({}),trigger=React.useRef(null);
    if (!owner.items.length || owner.paused) return null;
    return h('div',{className:'fork-widget-menu',onWheel:e=>e.stopPropagation(),onClick:e=>e.stopPropagation(),onKeyDown:e=>{e.stopPropagation();if(e.key==='Escape'){e.preventDefault();setOpen(false);trigger.current?.focus();}}},
        h('button',{ref:trigger,type:'button',className:'fork-widget-menu-trigger','aria-expanded':open,onClick:()=>{const rect=trigger.current.getBoundingClientRect(),top=rect.bottom+6;setBounds({position:'fixed',left:Math.max(8,Math.min(rect.left,innerWidth-328)),right:'auto',top,maxHeight:'min(60vh, calc(100vh - '+(top+8)+'px))'});setOpen(!open);}},h(ForkWidgetIcon,{name:'widget'}),'模组 '+owner.items.length,
            owner.items.some(item=>item.presentation.attention.count || item.presentation.attention.changed)?h('span',{className:'fork-widget-attention is-dot','aria-hidden':true}):null),
        open?h('div',{className:'fork-widget-menu-list',style:bounds},owner.items.map(item=>{const count=item.presentation.attention.count;
            return h('button',{key:item.key,type:'button','data-state':item.presentation.state,onClick:()=>{owner.action(item.key,item.requestedState==='open' && item.presentation.state!=='open'?'sheet':'open');setOpen(false);}},
                h(ForkWidgetIcon,{name:item.sourceOnly?'message':'widget'}),h('span',null,item.definition.title,count?' · '+Math.min(99,count)+' 待查看':item.presentation.attention.changed?' · 有更新':''),
                item.failed?h('span',{className:'fork-widget-warning'},h(ForkWidgetIcon,{name:'warning'}),'不可用'):count?h('span',{className:'fork-widget-attention','aria-hidden':true},count>99?'99+':String(count)):null);})):null);
}
function ForkGalWidgets({owner,onBacklog,onAdvance,onWheel}) {
    const h=React.createElement,[request,setRequest]=React.useState(null),layer=React.useRef(null);
    const target=request && !owner.paused ? owner.items.find(item=>item.key===request.key && item.presentation.state!=='hidden') : null;
    React.useEffect(()=>{if (request && !target) setRequest(null);},[request,target]);
    const close=refocus=>{const panel=request?.panel;setRequest(null);if (refocus && panel?.isConnected) panel.focus({preventScroll:true});};
    const reading=!owner.paused && owner.items.some(item=>item.presentation.surface==='sheet' && item.presentation.state==='open');
    return h('div',{ref:layer,onClick:event=>{event.stopPropagation();if(event.target===event.currentTarget && !target)onAdvance?.();},onWheel:event=>{event.stopPropagation();if(!target)onWheel?.(event);},onContextMenu:event=>{event.preventDefault();event.stopPropagation();},
        className:'fork-widget-layer'+(reading?' is-reading':'')+(target?' has-menu':''),'aria-label':'剧情模组'},
        owner.items.map(item=>h(getForkWidgetBoundary(),{key:item.identity,onError:()=>owner.onFailure(item.identity)},h(ForkWidgetPanel,{item,owner,onBacklog,onAdvance,onWheel,onMenu:setRequest}))),
        target?h(ForkWidgetContextMenu,{item:target,owner,request,layer,onClose:close}):null);
}
