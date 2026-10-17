  // private fork (packs-v3): pack entries in the shared two-column pack modal (proposal §9) — left rows (EntryItem),
  // right detail (EntryDetail) with autosaved rows. Every write goes through PackModal's serialized commit() (patchPack, CAS).
  const ENTRY_TIMES={day:'白天',dusk:'黄昏',night:'夜晚'};
  const AUDIO_KINDS=['music','sfx','ambience'];
  const NOTE_HELP={
    backgrounds:'会和名称一起发给导演，用来判断这一幕用哪个背景。只写适用情景，最多 300 字。',
    music:'会和名称一起发给导演，用来判断什么时候放这首曲子。只写适用情景，最多 300 字。',
    sfx:'会和名称一起发给导演，用来判断什么时候触发这个音效。只写适用情景，最多 300 字。',
    ambience:'会和名称一起发给导演，用来判断什么时候播放这个环境音。只写适用情景，最多 300 字。',
    looks:'会和名称一起发给导演，用来判断什么时候用这个滤镜。最多 300 字。',
    skins:'精选舞台皮肤，只在相关剧情出现；填写一句适用场景。',
    widgets:'会和名称一起发给导演，用来判断什么时候放这个模组。最多 300 字。',
    props:'会和名称一起发给导演，用来选择要展示的物品。最多 300 字。',
    items:'作者自己的备注，不发给导演。'
  };
  // private fork (owner 2026-10): SillyTavern World Info wording — 「触发策略」 with 🔵 / 🟢, shown as just 蓝灯 / 绿灯.
  // private fork (owner 2026-10): the vector / semantic recall is removed — the help no longer promises a semantic fill.
const LAMP_HELP='同 SillyTavern 世界书：蓝灯始终可选，绿灯在名称或触发词命中时才选。';
  // private fork (enable audit, owner 2026-10): one control for 「启用」 and the lamp. 关闭 stores enabled: false and keeps
  // recall.mode, so turning it back on returns to the same lamp (the figure editor's outfit lamp uses the same mapping).
  // Only stage skins stay outside the director's recall catalogue.
  // private fork (direction styles, owner 2026-10): 演出风格 is 启用 / 关闭 as well — its pack's lamp decides where it applies.
  // private fork (skin ui, owner 2026-10): a standalone 舞台皮肤 entry has no 状态 at all — the library only shows which skins
  // are imported (all of them are offered as 默认舞台皮肤) and ⋯ › 删除 removes one. Skins inside a performance are untouched.
  const LAMPLESS_KINDS=['skins','directions'],STATELESS_KINDS=['skins'];
  const LAMPLESS_HELP={directions:'启用的演出风格每次都发给导演，不用触发词。素材包亮蓝灯（全局）时算玩家的，只亮绿灯（本卡）时算卡片作者的；两者是同类条目，可同时启用叠加，冲突由作者和玩家自行管理。导演指令的开关和每轮上限始终优先。关闭：不再发送。'};
  // private fork (skin ui, owner 2026-10): the stored `category` reads as 「标签」 — it only filters the library.
  const CATEGORY_HELP='只用来在舞台素材里筛选、不发给导演，可以用 / 分级。';
  const entryLamp=(asset,onOff)=>asset.enabled===false?'off':onOff?'on':asset.recall?.mode==='constant'?'constant':'keyword';
  const setEntryLamp=(c,mode)=>mode==='off'?{...c,enabled:false}:mode==='on'?{...c,enabled:true}:{...c,enabled:true,recall:{...c.recall,mode}};
  const categoryParts=text=>String(text||'').split(/[\/、,，\n]/).map(s=>s.trim()).filter(Boolean);
  const chars=value=>[...String(value||'')].length;
  // English commas are the documented separator; a full-width comma is tolerated so a pasted list never fuses.
  const splitKeywords=value=>[...new Set(String(value||'').split(/[,，]/).map(word=>word.trim()).filter(Boolean))];
  function keywordProblem(words){
    if(words.length>16)return '触发词最多 16 个';
    const bad=words.find(word=>chars(word)<2||chars(word)>40);
    return bad?`「${bad}」需为 2–40 字`:'';
  }
  // Pure: applies the expanded-editor fields onto the *current* entry so inline edits made meanwhile survive.
  function applyEntryFields(current,fields){
    const next={...current,...fields.top,recall:{...current.recall,...fields.recall}};
    if(fields.recall.keywords){
      const synonyms=Object.fromEntries(Object.entries(current.recall.synonyms||{}).filter(([key,words])=>fields.recall.keywords.includes(key)&&words.length));
      if(Object.keys(synonyms).length)next.recall.synonyms=synonyms;else delete next.recall.synonyms;
    }
    for(const key of ['category','usage'])if(next[key]==='')delete next[key];
    for(const key of Object.keys(fields.top))if(fields.top[key]===undefined)delete next[key];
    return next;
  }
  // Media leases are serialized server-side; bounding concurrency (and retrying once) keeps late requests
  // from hitting the transport timeout, which used to leave placeholder letters instead of images.
  const leaseQueues=new WeakMap();
  function leaseMedia(binding,input){
    if(!binding?.previewMedia)return Promise.reject(new Error('素材预览不可用'));
    let queue=leaseQueues.get(binding);
    if(!queue){queue={active:0,waiting:[]};leaseQueues.set(binding,queue);}
    return new Promise((resolve,reject)=>{
      const run=async()=>{
        queue.active++;
        try{let result;try{result=await binding.previewMedia(input);}catch(_){await new Promise(r=>setTimeout(r,400));result=await binding.previewMedia(input);}resolve(result);}
        catch(error){reject(error);}
        finally{queue.active--;queue.waiting.shift()?.();}
      };
      if(queue.active<3)run();else queue.waiting.push(run);
    });
  }
  // Shared, briefly retained image leases: every thumbnail of the same pack image shares one lease, and the lease outlives
  // its last user by MEDIA_HOLD_MS, so a remount (modal reopened, outfit switched back, list re-rendered) paints the image
  // in its first frame instead of an empty box. dropMedia evicts a lease whose URL stopped loading (pack rewritten).
  const MEDIA_HOLD_MS=30000,mediaShares=new WeakMap();
  const mediaKey=(packId,hash)=>packId+'\n'+hash;
  function peekMedia(binding,packId,hash){return hash&&binding?mediaShares.get(binding)?.get(mediaKey(packId,hash))?.url||null:null;}
  function settleMedia(entry){
    if(entry.refs>0)return;
    const free=()=>{if(entry.refs>0)return;if(entry.map.get(entry.key)===entry)entry.map.delete(entry.key);const release=entry.release;entry.release=null;release?.();};
    clearTimeout(entry.timer);entry.timer=null;
    if(entry.dropped)return free();
    entry.timer=setTimeout(free,MEDIA_HOLD_MS);entry.timer?.unref?.();
  }
  // → Promise<{url, release}>; release() is idempotent.
  function holdMedia(binding,packId,hash){
    let map=mediaShares.get(binding);if(!map){map=new Map();mediaShares.set(binding,map);}
    const key=mediaKey(packId,hash);let entry=map.get(key);
    if(!entry){entry={key,map,url:null,release:null,refs:0,timer:null,dropped:false,promise:null};map.set(key,entry);
      const own=entry;own.promise=leaseMedia(binding,{packId,hash}).then(media=>{own.url=media.url;own.release=media.release;if(own.refs<=0)settleMedia(own);return media.url;},error=>{if(map.get(key)===own)map.delete(key);throw error;});}
    const held=entry;held.refs++;clearTimeout(held.timer);held.timer=null;
    let done=false;const release=()=>{if(done)return;done=true;held.refs--;settleMedia(held);};
    return held.promise.then(url=>({url,release}),error=>{release();throw error;});
  }
  function dropMedia(binding,packId,hash){
    const map=mediaShares.get(binding),entry=map?.get(mediaKey(packId,hash));if(!entry)return;
    map.delete(entry.key);entry.dropped=true;clearTimeout(entry.timer);settleMedia(entry);
  }
  // One preview at a time per pack modal; `time` / `duration` drive the music player's progress line.
  // private fork (audio editor, owner 2026-10): the preview plays at the entry's own 音量 (the gain the stage applies to
  // it), and level() follows the slider while that entry is playing.
  const entryContent=(asset,id)=>asset?.variants?assetVariantRow(asset.variants,id).content:asset;
  const entryView=(asset,id)=>{const {variants,...view}={...asset,...entryContent(asset,id)};return view;};
  const entryVolume=asset=>typeof asset?.volume==='number'?Math.min(1,Math.max(0,asset.volume)):1;
  function useAudioPreview(binding,packId){
    const [state,setState]=React.useState(null),current=React.useRef(null);
    function stop(){const playing=current.current;current.current=null;if(playing){playing.cancelled=true;try{playing.audio?.pause();}catch(_){}playing.release?.();}setState(null);}
    async function toggle(asset){
      asset=entryView(asset);
      const id=asset.kind+'/'+asset.id;
      if(current.current?.id===id){stop();return;}
      stop();
      if(!asset.media)return;
      const playing={id};current.current=playing;setState({id,status:'loading'});
      try{
        if(typeof Audio==='undefined')throw new Error('Audio unavailable');
        const media=await leaseMedia(binding,{packId,hash:asset.media});
        if(playing.cancelled){media.release();return;}
        playing.release=media.release;
        const audio=forkForeground.media(new Audio(media.url));playing.audio=audio;
        audio.volume=entryVolume(asset);
        audio.onended=()=>{if(current.current===playing)stop();};
        audio.ontimeupdate=()=>{if(current.current===playing)setState({id,status:'playing',time:audio.currentTime,duration:audio.duration});};
        await audio.play();
        if(current.current===playing)setState({id,status:'playing',time:audio.currentTime||0,duration:audio.duration});
      }catch(_){if(current.current===playing){stop();setState({id,status:'error'});}}
    }
    function level(asset,value){const playing=current.current;if(playing?.audio&&playing.id===asset.kind+'/'+asset.id)playing.audio.volume=Math.min(1,Math.max(0,value));}
    React.useEffect(()=>stop,[binding,packId]);
    return {state,toggle,stop,level};
  }
  const playTime=s=>Number.isFinite(s)?Math.floor(s/60)+':'+String(Math.floor(s%60)).padStart(2,'0'):'–:––';
  function PlayButton({audio,asset,big}) {
    const id=asset.kind+'/'+asset.id,status=audio.state?.id===id?audio.state.status:null,on=status==='playing'||status==='loading';
    return h('button',{type:'button',className:'ap-play'+(big?' is-big':''),'data-state':status||undefined,'aria-pressed':on,'aria-label':(on?'停止试听 ':'试听 ')+asset.name,title:status==='error'?'无法播放':undefined,disabled:!asset.media,onClick:e=>{e?.stopPropagation?.();audio.toggle(asset);}},
      status==='loading'?h(ForkSpinner,{key:'loading'}):h('svg',{viewBox:'0 0 20 20','aria-hidden':true},status==='playing'?h('path',{d:'M7 5v10M13 5v10',className:'is-stroke'}):h('path',{d:'M7 4.6v10.8L15.6 10z',className:'is-fill'})));
  }
  // private fork (skin ui, owner 2026-10): a 舞台皮肤 entry previews itself — a small stage with the skin's text box, its
  // nameplate and one sample line in the skin's own fonts and colours (dsh.skin/1: textbox.paint / shape, nameplate,
  // font, textStyle, cursor). `compact` is the list thumbnail: the same box with bars instead of text. Fonts register
  // lazily through forkFonts; until a face loads the line reads in the fallback stack.
  const SKIN_SAMPLE_NAME='？？？',SKIN_SAMPLE_LINE=['……你、你还有',"什么事",'。'];
  function useSkinFonts(ids) {
    const api=typeof forkFonts!=='undefined'?forkFonts:null,[,setTick]=React.useState(0),key=ids.filter(Boolean).join('|');
    React.useEffect(()=>{if(!api||!key)return;let live=true;Promise.all(key.split('|').map(id=>api.ensure(id).catch(()=>null))).then(()=>{if(live)setTick(n=>n+1);});return()=>{live=false;};},[api,key]);
    return id=>{const font=id&&api?.get?.(id);return font?JSON.stringify(font.family)+', '+(font.category==='serif'?'serif':'sans-serif'):undefined;};
  }
  function skinSampleStyle(skin) {
    const paint=skin.textbox.paint,shape=skin.textbox.shape||{},plate=skin.nameplate,ts=skin.textStyle||{};
    const rings=(list,base=0)=>{let at=base;return (list||[]).map(r=>{at+=r.width;return '0 0 0 '+at+'px '+r.color;});};
    const border=shape.borderWidth??1,line=paint.border||paint.fgMuted||paint.fg;
    return {box:{background:paint.bg,color:paint.fg,borderRadius:Math.min(shape.radius??10,18)+'px',border:border?border+'px solid '+line:'none',
        boxShadow:[...rings(shape.rings,0),'0 6px 18px rgb(0 0 0 / .28)'].join(', '),fontWeight:ts.weight,letterSpacing:ts.letterSpacing!==undefined?ts.letterSpacing+'em':undefined},
      plate:{background:plate.shape==='plain'?'transparent':plate.paint.bg,color:plate.paint.fg,boxShadow:plate.shape==='plain'?undefined:[...(plate.paint.border?['0 0 0 1px '+plate.paint.border]:[]),...rings(plate.rings,plate.paint.border?1:0)].join(', ')||undefined,
        transform:plate.rotate?'rotate('+plate.rotate+'deg)':undefined,letterSpacing:plate.letterSpacing!==undefined?plate.letterSpacing+'em':undefined},
      emphasis:ts.emphasis||paint.accent||paint.fg,cursor:skin.cursor?.color||paint.accent||paint.fg,muted:paint.fgMuted||paint.fg};
  }
  function SkinSample({skin,label,compact=false,className=''}) {
    const face=useSkinFonts(compact||!skin?[]:[skin.font?.body,skin.font?.name]);
    if(!skin?.textbox?.paint||!skin.nameplate?.paint)return h('span',{className:compact?'ap-item-glyph':'ap-hero-glyph','data-kind':'skins'},h(KindIcon,{kind:'skins'}));
    const s=skinSampleStyle(skin),plain=skin.nameplate.shape==='plain';
    return h('span',{className:'ap-skin-sample'+(compact?' is-compact':'')+(className?' '+className:''),role:compact?undefined:'img','aria-label':compact?undefined:(label||skin.label)+' 预览','aria-hidden':compact||undefined},
      h('span',{className:'ap-skin-sample-box',style:s.box},
        h('span',{className:'ap-skin-sample-plate','data-shape':skin.nameplate.shape,'data-plain':plain||undefined,style:{...s.plate,fontFamily:face(skin.font?.name)}},compact?null:SKIN_SAMPLE_NAME),
        compact?h(React.Fragment,null,h('i',{className:'ap-skin-sample-bar',style:{background:skin.textbox.paint.fg}}),h('i',{className:'ap-skin-sample-bar is-short',style:{background:s.muted}})):
          h('span',{className:'ap-skin-sample-line',style:{fontFamily:face(skin.font?.body),lineHeight:skin.textStyle?.lineHeight}},SKIN_SAMPLE_LINE[0],h('em',{style:{color:s.emphasis}},SKIN_SAMPLE_LINE[1]),SKIN_SAMPLE_LINE[2]),
        h('i',{className:'ap-skin-sample-cursor',style:{borderTopColor:s.cursor}})));
  }
  // private fork (wizard v3, owner 2026-10-16: a pack of 1000 entries made 设置向导 › 挑选素材 crawl): a long entry list —
  // the 素材库 column and the wizard's grids — mounts only what is near view. Up to WINDOW_MIN items it is one plain list;
  // above, the items are cut into blocks of whole grid rows (the columns the CSS grid actually laid out, measured by any
  // block on screen) and a block far from its scroll container's view is an empty box of its height (IntersectionObserver
  // rooted at that container, so the margin counts inside a scrolling panel too). Pictures inside still load lazily on
  // their own (Thumb). `tail`: a last row after the items (the dashed ＋).
  const WINDOW_MIN=24,WINDOW_ROWS=6;
  const scrollRoot=el=>{for(let node=el;node&&node.nodeType===1;node=node.parentElement){const y=getComputedStyle(node).overflowY;if(y==='auto'||y==='scroll')return node;}return null;};
  function WindowedItems({items,render,className,blockClassName=className,label,multi,tail=null}) {
    const big=items.length>WINDOW_MIN&&typeof IntersectionObserver!=='undefined'&&typeof ResizeObserver!=='undefined';
    const box=React.useRef(null),[grid,setGrid]=React.useState(null);
    const onMeasure=({columns,row})=>setGrid(g=>g&&g.columns===columns&&Math.abs(g.row-row)<0.5?g:{columns,row,root:g?.root??scrollRoot(box.current)});
    const list={role:'listbox','aria-multiselectable':multi||undefined,'aria-label':label};
    if(!big)return h('ul',{className,...list},items.map(render),tail);
    // Until a block is measured only the first shows (no zero-height boxes that would all count as near).
    const size=(grid?.columns||1)*WINDOW_ROWS,blocks=[];
    for(let at=0;at<(grid?items.length:1);at+=size)blocks.push(items.slice(at,at+size));
    return h('div',{ref:box,className:className+' ap-windowed',...list},
      blocks.map((block,index)=>h(WindowBlock,{key:index,className:blockClassName,height:grid?Math.ceil(block.length/grid.columns)*grid.row:0,root:grid?.root,ready:!!grid,start:index===0,block,render,onMeasure})),
      tail&&h('ul',{role:'none',className:blockClassName},tail));
  }
  // Whether an element has come near its scroll container's view (once true, it stays): a costly picture (a cast face cut
  // from a full sprite) starts only then, so a long page of faces loads from the top instead of all at once.
  function useNearView(margin='400px') {
    const ref=React.useRef(null),[near,setNear]=React.useState(typeof IntersectionObserver==='undefined');
    React.useEffect(()=>{if(near||!ref.current)return;
      const io=new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){setNear(true);io.disconnect();}},{root:scrollRoot(ref.current),rootMargin:margin});io.observe(ref.current);return()=>io.disconnect();},[near]);
    return [ref,near];
  }
  function WindowBlock({className,height,root,ready,start,block,render,onMeasure}) {
    const ref=React.useRef(null),list=React.useRef(null),[near,setNear]=React.useState(start);
    React.useEffect(()=>{if(!ready||!ref.current)return;
      const io=new IntersectionObserver(entries=>{for(const entry of entries)setNear(entry.isIntersecting);},{root,rootMargin:'800px 0px'});io.observe(ref.current);return()=>io.disconnect();},[ready,root]);
    (React.useLayoutEffect||React.useEffect)(()=>{const el=list.current;if(!near||!el)return;
      const measure=()=>{const columns=Math.max(1,getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length),rows=Math.ceil(el.children.length/columns);if(rows)onMeasure({columns,row:el.offsetHeight/rows});};
      measure();const ro=new ResizeObserver(measure);ro.observe(el);return()=>ro.disconnect();},[near]);
    return h('div',{ref,role:'none',style:near?undefined:{height:height+'px'}},near&&h('ul',{ref:list,role:'none',className},block.map(render)));
  }
  // Left column row of the pack modal: lead (thumbnail / play / avatar / glyph) · name (+ figure meta) · recall dot.
  // `checked` is null outside select mode; in select mode a click toggles the row.
  // private fork (wizard preview): `onPreview` makes the thumbnail its own button that opens the large view (the row's
  // check and name still toggle it).
  function EntryItem({binding,pack,kind,item,focused,checked,audio,ctx,onSelect,onLamp,onPreview}) {
    const packId=pack.manifest.id,figure=kind==='figures';
    // Library thumbnails describe stored art, including disabled figures/outfits.
    const thumbnail=figure?{...item,enabled:true,outfits:item.outfits.map(o=>({...o,enabled:true}))}:null;
    const lead=['backgrounds','cg','items','props'].includes(kind)?h(Thumb,{binding,packId,hash:entryContent(item).media,label:item.name,className:'ap-item-thumb'}):AUDIO_KINDS.includes(kind)?h(PlayButton,{audio,asset:entryView(item)}):
      figure?h(FigureCastFace,{binding,packId,pack,figure:item,sprites:pack.sprites,avatar:figureAvatar(thumbnail,pack.sprites),label:item.name,className:'ap-item-avatar',frame:'face'}):
      kind==='skins'?h(SkinSample,{skin:pack.skins?.[item.id],label:item.name,compact:true}):h('span',{className:'ap-item-glyph'},h(KindIcon,{kind}));
    // private fork (character v3, owner 2026-10): a figure row is one line — face and name; no second meta row. r6 (owner
    // 2026-10): no outfit count either (the figure page lists its outfits).
    return h('li',{role:'option','aria-selected':checked===null?focused:checked,className:'ap-item'+(checked!==null?' is-picking':'')+(figure?' is-figure':''),'data-checked':checked||undefined,'data-disabled':item.enabled===false||undefined,onClick:onSelect},
      checked!==null&&h('span',{className:'ap-check-mark','aria-hidden':true},checked&&h(Glyph,{name:'check'})),
      onPreview?h('button',{type:'button',className:'ap-item-lead','aria-label':'查看大图 '+item.name,title:'查看大图',onClick:e=>{e?.stopPropagation?.();onPreview();}},lead):lead,
      h('button',{type:'button',className:'ap-item-main',onClick:e=>{e?.stopPropagation?.();onSelect();}},h('span',{className:'ap-item-name'},item.name)),
      // private fork (enable audit): the list dot is the same 蓝灯 / 绿灯 / 关闭 (启用 / 关闭 for 演出风格).
      // private fork (entry cleanup, owner 2026-10): the dot is a quick menu (LampMenu) — no need to open the entry.
      !figure&&item.recall&&!STATELESS_KINDS.includes(kind)&&(onLamp?h(LampMenu,{mode:entryLamp(item,LAMPLESS_KINDS.includes(kind)),onOff:LAMPLESS_KINDS.includes(kind),label:item.name+(LAMPLESS_KINDS.includes(kind)?' 的状态':' 的触发策略'),
          anchorClassName:'ap-item-lamp-anchor',className:'ap-item-lamp',onChange:onLamp}):
        (()=>{const lamp=entryLamp(item,LAMPLESS_KINDS.includes(kind)),word=ENTRY_LAMPS[lamp];return h('span',{className:'ap-item-lamp','data-mode':lamp,role:'img','aria-label':word,title:word},h('span',{className:'ap-lamp-dot'}));})()));
  }
  // private fork (UI standard §三.11, phase 2): the one lamp menu — entry rows, the cast faces in 舞台设置, an entry's / a CG's
  // 触发策略 row. A lamp dot that opens the inline-field popup (floats in the top layer, so a list or a tile grid never clips it):
  // 蓝灯 / 绿灯 / 关闭, or 启用 / 关闭 (`onOff`, kinds the director never picks by lamp). `named` (a 「label value」 row) reads
  // 「● 绿灯 ⌄」 like a menu field. Clicks and Enter / Space stay inside the anchor, so choosing a lamp never also selects (or,
  // in 多选, ticks) the row. `onChange` may return a promise (one CAS write per choice); the dot is busy until it settles.
  const ENTRY_LAMPS={constant:'蓝灯',keyword:'绿灯',on:'启用',off:'关闭'};
  function LampMenu({mode,onOff=false,label,onChange,named=false,anchorClassName='',className='',disabled=false}) {
    const pop=useForkInlinePopup(),[busy,setBusy]=React.useState(false),name=ENTRY_LAMPS[mode];
    const pick=value=>{pop.close(true);if(value===mode)return;setBusy(true);Promise.resolve(onChange(value)).finally(()=>setBusy(false));};
    return h('span',{className:anchorClassName||'ap-lamp-anchor',ref:pop.root,onKeyDown:e=>{if(pop.open||e.key!=='Escape')e.stopPropagation();pop.keys(e);},onClick:e=>e.stopPropagation()},
      h('button',{ref:pop.trigger,type:'button',className:named?'fork-inline-trigger ap-lamp-trigger':className||'ap-lamp-button','data-mode':mode,'aria-haspopup':'menu','aria-expanded':pop.open,'aria-busy':busy||undefined,
        'aria-label':label+'：'+name+(named?'':'，更改'),title:named?undefined:name,disabled:busy||disabled,
        onClick:()=>pop.setOpen(!pop.open),onKeyDown:e=>{if(e.key==='ArrowDown'&&!pop.open){e.preventDefault();pop.setOpen(true);}}},
        h('span',{className:'ap-lamp-dot'}),named&&h('span',{className:'fork-inline-text'},name),named&&h(ForkInlineGlyph,{name:'chevDown'})),
      pop.open?pop.layer({className:'fork-inline-pop ap-lamp-pop',role:'menu','aria-label':label,onKeyDown:forkInlineMenuKeys},
        (onOff?['on','off']:['constant','keyword','off']).map(value=>h('button',{key:value,type:'button',role:'menuitemradio','aria-checked':mode===value,className:'fork-inline-option ap-lamp-opt','data-mode':value,onClick:()=>pick(value)},
          h('span',{className:'ap-lamp-dot'}),h('span',{className:'ap-lamp-opt-name'},ENTRY_LAMPS[value]),mode===value?h(Glyph,{name:'check'}):null))):null);
  }
  // private fork (UI standard phase 2 batch 6): the segmented LampSwitch is gone — every lamp is the LampMenu above.
  // Trigger words as removable chips plus an add field (Enter, comma or blur adds). private fork (owner 2026-10 v3.1 r2):
  // one add language — the field is a small dashed ＋ chip that opens into a text field while focused or holding a draft.
  // private fork (figure-editor r4): `split` / `validate` let a figure's 触发词 (aliases) use the same chips with their own rules.
  function KeywordChips({words,onChange,label='触发词',split=splitKeywords,validate=keywordProblem}) {
    const [draft,setDraft]=React.useState(''),[error,setError]=React.useState('');
    function add(){if(!draft.trim())return;const next=[...new Set([...words,...split(draft)])],problem=validate(next);if(problem){setError(problem);return;}setError('');setDraft('');if(next.length!==words.length)onChange(next);}
    return h('div',{className:'ap-keys'},words.map(word=>h('span',{key:word,className:'ap-key'},word,h('button',{type:'button','aria-label':'删除'+label+' '+word,onClick:()=>onChange(words.filter(w=>w!==word))},h(Glyph,{name:'close'})))),
      h('label',{className:'ap-key-add','data-draft':draft?true:undefined,title:'添加'+label},h(Glyph,{name:'plus'}),
        h('input',{className:'ap-key-input','aria-label':'添加'+label,value:draft,'aria-invalid':!!error||undefined,onChange:e=>{setDraft(e.target.value);setError('');},onKeyDown:e=>{if(e.key==='Enter'||e.key===','||e.key==='，'||(e.key==='、'&&split!==splitKeywords)){e.preventDefault();add();}},onBlur:add})),
      error&&h('span',{className:'ap-field-error',role:'alert'},error));
  }
  // Volume slider: the shared ForkSlider (fork-inline-field.js) in percent, 5% steps; saves when the drag ends. `onDraft`
  // follows the drag (live preview).
  function VolumeSlider({value,onCommit,onDraft,label='音量',className=''}) {
    return h(ForkSlider,{className,label,min:0,max:100,step:5,value:Math.round(value*100),valueText:v=>v+'%',output:v=>v+'%',
      onChange:v=>onDraft?.(v/100),onCommit:v=>{if(Math.abs(v/100-value)>0.001)onCommit(v/100);}});
  }
  // private fork (audio editor, owner 2026-10): the entry's 音量 sits in the player card, after the time — a speaker glyph,
  // a short slider and its (?) — instead of a full-width row. It is the gain applied whenever this sound plays in game.
  function PlayerVolume({value,onCommit,onDraft}) {
    return h('span',{className:'ap-player-volume'},h('span',{className:'ap-player-volume-icon','aria-hidden':true},h(Glyph,{name:value>0?'voice':'voiceOff'})),
      h(VolumeSlider,{value,onCommit,onDraft,className:'is-compact'}),
      entryHelp('音量','这条素材在游戏里播放时的响度，试听也按它播放。舞台的总音量和分类音量在它之上生效。'));
  }
  // Right column of the pack modal for an entry: hero (16:9 background with 白天/黄昏/夜晚, music player, glyph tile)
  // and autosaved rows (blur / Enter). No 保存/取消, no internal ID.
  // private fork (asset-gen): the background picture slot. Empty: the dashed ✦ tile (opens the generation sheet — a
  // background needs a description first) and the upload badge. Filled: a quiet ✦ disc in the corner. A request in
  // flight shows on the slot itself (spinner, the candidate with its ring, ⚠); a click opens its sheet.
  function BackgroundSlot({packId,asset,hash,gen,onUpload,picture,timeSwitch}) {
    const target={packId,kind:'background',assetId:asset.id},job=gen.jobFor(target),pend=gen.pending[genKey(target)];
    React.useEffect(()=>{if(!asset.media)gen.open();},[asset.media]);
    const state=pend||job?.status==='running'?'running':['candidate','save_failed'].includes(job?.status)?'candidate':job?.status==='failed'?'failed':null;
    const mark=state==='running'?h(ForkSpinner,{key:'gen',fill:true}):state==='candidate'?h(CandidateArt,{gen,jobId:job.jobId,className:'ap-gen-img'}):state==='failed'?h(Glyph,{name:'warning'}):null;
    const aria={running:'背景图：正在生成',candidate:'背景图：有新图待选',failed:'背景图：生成失败'}[state];
    return h('div',{className:'ap-hero-wrap','data-gen':state||undefined},
      hash?picture:h('button',{type:'button',className:'ap-hero ap-gen-hero','data-state':state||'empty','aria-label':aria||'生成背景图',title:state?(job?.error?.message||undefined):'生成背景图',onClick:()=>gen.openSheet(target)},
        mark||h(Glyph,{name:'spark'}),state==='candidate'&&h('span',{className:'ap-gen-dot','aria-hidden':true})),
      hash&&h('button',{type:'button',className:'ap-hero-gen','data-state':state||undefined,'aria-label':aria||'重新生成背景图',title:state?(job?.error?.message||'点开查看'):'重新生成背景图',onClick:()=>gen.openSheet(target)},
        mark||h(Glyph,{name:'spark'}),state==='candidate'&&h('span',{className:'ap-gen-dot','aria-hidden':true})),
      !hash&&!state&&onUpload&&h(SlotUpload,{label:'上传背景图',onFile:onUpload}),timeSwitch);
  }
  // private fork (variable bindings ui, owner 2026-10): a widget's look is per pack. With a card open, the entry's ⋯ offers
  // 「复制到本卡素材包」 (copyWidgetToCardPack): a pack this card already uses (绿灯) or a new one, which the copy turns on for
  // the card. Success opens the copy. A card that changed meanwhile keeps the copied pack; the user is told to turn it on.
  // The RPC error carries copiedPack; over the wire only its message may survive ("… (copied pack: <id>)").
  function copiedPackOf(error){
    if(error?.copiedPack?.packId)return error.copiedPack;
    const match=/copied pack: ([0-9a-f-]{36})/i.exec(String(error?.message||''));
    return match?{packId:match[1]}:null;
  }
  function WidgetCopyMenu({card,pack,asset,onCopied,onError}) {
    const [copying,setCopying]=React.useState(false),[busy,setBusy]=React.useState(false);
    const bound=card.ext.assetBindings.boundPackIds,targets=(card.packs||[]).filter(p=>p?.manifest&&bound.includes(p.manifest.id)&&p.manifest.id!==pack.manifest.id);
    async function copy(target){
      setBusy(true);onError('');
      const ref={packId:pack.manifest.id,kind:'widgets',assetId:asset.id};
      try{
        const result=await card.writer.cardOp(async revision=>card.binding.rpc('copyWidgetToCardPack',{path:card.path,expectedRevision:revision,ref,
          target:target.packId?{packId:target.packId,expectedRevision:(await card.binding.service.getPackSnapshot({packId:target.packId})).revision}:{newPackName:target.name}}),
          {retry:error=>!copiedPackOf(error)});
        const toId=result?.copy?.copied?.find(row=>row.kind==='widgets'&&row.fromId===asset.id)?.toId||asset.id;
        onCopied(result.copy.packId,toId);
      }catch(error){
        const copied=copiedPackOf(error);
        onError(copied?'已复制到'+(target.name?'「'+target.name+'」':'新素材包')+'，但这张卡刚被别处改过，没能设为本卡使用。请在素材包列表里把它设为本卡（绿灯）。':
          error?.code==='UNBOUND_PACK'?'只能复制到这张卡已在用的素材包':errorText(error),copied?.packId);
      }finally{setBusy(false);}
    }
    return h(Popover,{label:asset.name+' 操作',className:'ap-entry-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'更多操作 '+asset.name,'aria-expanded':open,disabled:busy,onClick:()=>{setCopying(false);toggle();}}),
      content:close=>copying?h(PackTargetMenu,{packs:targets,exclude:pack.manifest.id,close,onPick:copy}):
        h(MenuItem,{onClick:()=>setCopying(true)},h(Glyph,{name:'copy'}),h('span',null,'复制到本卡素材包…'))});
  }
  // private fork (direction styles, owner 2026-10): one 演出风格 — 名称 (the title), 状态 (启用 / 关闭) and 正文 (an inline field
  // that keeps line breaks), each saved as it is committed. No hero, 触发词 or 详情: nothing reads them for a style.
  // `asset` null is a new style: a local draft until its text is written (the pack rejects a style without text), then
  // create({name, text, enabled}) adds it. The ⋯ menu deletes it after a confirmation.
  const STYLE_NEW_NAME='新演出风格';
  const STYLE_TEXT_MAX=2000;
  function newStyleName(pack){
    const taken=new Set(pack.manifest.assets.filter(a=>a.kind==='directions').map(a=>a.name));
    let name=STYLE_NEW_NAME,n=1;while(taken.has(name))name=STYLE_NEW_NAME+' '+(++n);return name;
  }
  // The pack's own rule (manifest.js): trimmed text not empty, at most 2000 code points, no control character but line breaks and tabs.
  const styleTextProblem=value=>!String(value||'').trim()?'请填写正文':chars(value)>STYLE_TEXT_MAX?'正文最多 '+STYLE_TEXT_MAX+' 字':/[\u0000-\u0008\u000b-\u001f\u007f]/.test(value)?'正文不能包含控制字符':'';
  // private fork (settings polish, owner 2026-10): ack ({parent, onBack}, a phone's detail) puts the sub-page ‹ at the start of
  // the name row, which then leads the page (the name is the page title, as on a figure's top bar).
  function StyleDetail({pack,asset,commit,create,remove,busy,back=null}) {
    const draft=!asset,[error,setError]=React.useState(''),[confirm,setConfirm]=React.useState(null);
    const [draftName,setDraftName]=React.useState(()=>newStyleName(pack)),[draftOn,setDraftOn]=React.useState(true),textRef=React.useRef(null);
    const name=draft?draftName:asset.name,on=draft?draftOn:asset.enabled!==false;
    const [variantChoice,setVariant]=React.useState(undefined),selected=asset?.variants&&(assetVariantRow(asset.variants,variantChoice)||assetVariantRow(asset.variants));
    const content=selected?selected.content:asset;
    React.useEffect(()=>{if(draft)textRef.current?.focus?.({preventScroll:true});},[]);
    const write=update=>{setError('');return commit('directions',asset.id,update).catch(e=>setError(errorText(e)));};
    const add=text=>{setError('');return create({name:draftName,text,enabled:draftOn}).catch(e=>setError(errorText(e)));};
    const askRemove=()=>setConfirm({title:'删除演出风格「'+asset.name+'」？',body:'从素材包「'+pack.manifest.name+'」中删除，用到这个素材包的卡都不再发送它。',confirmLabel:'删除',danger:true,onConfirm:()=>remove(asset.id)});
    const menu=!draft&&remove&&h(Popover,{label:asset.name+' 操作',className:'ap-entry-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'更多操作 '+asset.name,'aria-expanded':open,disabled:busy,onClick:toggle}),
      content:close=>h(MenuItem,{danger:true,onClick:()=>{close();askRemove();}},'删除')});
    return h('div',{className:'ap-detail-pane ap-style-detail','data-disabled':!on||undefined},h(ErrorBox,{error}),
      h('div',{className:'ap-detail-title'+(back?' ap-subhead':'')},back&&h(SubpageBack,back),h(CommitInput,{className:'ap-title-input','aria-label':'名称',value:name,validate:v=>!v.trim()?'名称不能为空':chars(v)>256?'名称最多 256 字':'',
        onCommit:v=>draft?setDraftName(v.trim()):write(c=>({...c,name:v.trim()}))}),menu||null),
      h(ForkInlineGrid,{label:name+' 设置',columns:1,className:'ap-entry-fields'},
        h(ForkInlineRow,{label:'状态',help:entryHelp('状态',LAMPLESS_HELP.directions)},
          h(LampMenu,{mode:on?'on':'off',onOff:true,named:true,label:'状态',onChange:mode=>draft?setDraftOn(mode==='on'):write(c=>setEntryLamp(c,mode))})),
        h(ForkInlineField,{kind:'text',multiline:true,lines:true,label:'正文',className:'ap-style-text-field',controlRef:textRef,placeholder:'写给导演的演出要求',value:draft?'':content.text,
          help:entryHelp('正文','原样发给导演。Enter 保存，Shift+Enter 换行，最多 '+STYLE_TEXT_MAX+' 字。'),validate:styleTextProblem,
          onCommit:v=>draft?add(v):write(c=>c.variants?{...c,variants:{...c.variants,entries:c.variants.entries.map(row=>row.id===selected.id?{...row,content:{text:v}}:row)}}:{...c,text:v})})),
      !draft&&h(EntryVariants,{asset,selected,onSelect:setVariant,write,busy,onError:setError}),
      confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)}));
  }
  // private fork (variable bindings ui): `card` (the open card's context, or null) only adds the widget ⋯ copy action;
  // per-card widget settings are gone. `onOpenPack(packId, kind, itemId)` opens another pack at an item.
  const entryHelp=(label,text)=>text?h(Help,{text,label:label+' 说明'}):null;
  function EntryDetail({binding,pack,packs=[],asset,commit,audio,gen,uploadBackground,uploadVariant,card=null,onOpenPack,onCategory,remove,busy,back=null}) {
    const packId=pack.manifest.id,kind=asset.kind,[error,setError]=React.useState(''),lampless=LAMPLESS_KINDS.includes(kind),stateless=STATELESS_KINDS.includes(kind);
    // private fork (skin ui): ⋯ › 删除 for a standalone 舞台皮肤, after a confirmation (remove(kind, id) is one CAS write).
    const [confirm,setConfirm]=React.useState(null);
    const removeMenu=remove&&stateless&&h(Popover,{label:asset.name+' 操作',className:'ap-entry-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'更多操作 '+asset.name,'aria-expanded':open,disabled:busy,onClick:toggle}),
      content:close=>h(MenuItem,{danger:true,onClick:()=>{close();setConfirm({title:'删除舞台皮肤「'+asset.name+'」？',body:'从素材包「'+pack.manifest.name+'」中删除。以它为默认舞台皮肤的卡改回经典皮肤。',confirmLabel:'删除',danger:true,
        onConfirm:()=>Promise.resolve(remove(kind,asset.id)).catch(e=>setError(errorText(e)))});}},'删除')});
    const write=update=>{setError('');return commit(kind,asset.id,update).catch(e=>setError(errorText(e)));};
    const [copyIssue,setCopyIssue]=React.useState(null);
    const copyMenu=kind==='widgets'&&card?.writer?.cardOp&&card.path&&card.ext?.assetBindings&&h(WidgetCopyMenu,{card,pack,asset,
      onCopied:(packId,itemId)=>{setCopyIssue(null);onOpenPack?.(packId,'widgets',itemId);},onError:(text,packId)=>setCopyIssue(text?{text,packId}:null)});
    const [variantChoice,setVariant]=React.useState(undefined),selected=asset.variants&&(assetVariantRow(asset.variants,variantChoice)||assetVariantRow(asset.variants));
    const content=selected?selected.content:asset,view={...asset,...content};delete view.variants;
    const document=selected?pack.variantDocuments?.[kind+'/'+asset.id]?.[selected.id]:pack[kind]?.[asset.id];
    const hash=content.media;
    const writeContent=update=>write(current=>current.variants?{...current,variants:{...current.variants,entries:current.variants.entries.map(row=>row.id===selected.id?{...row,content:update(row.content)}:row)}}:update(current));
    const status=audio.state?.id===kind+'/'+asset.id?audio.state:null,pct=status?.duration?Math.min(100,100*status.time/status.duration):0;
    const timeSwitch=null;
    const picture=hash&&h(Thumb,{key:hash,binding,packId,hash,label:asset.name,className:'ap-hero'});
    const hero=kind==='backgrounds'?(gen&&!asset.variants?h(BackgroundSlot,{packId,asset,hash,gen,picture,timeSwitch,onUpload:uploadBackground&&(file=>{setError('');uploadBackground(asset.id,file).catch(e=>setError(errorText(e)));})}):
        h('div',{className:'ap-hero-wrap'},picture||h('span',{className:'ap-hero','data-empty':true}),timeSwitch)):
      AUDIO_KINDS.includes(kind)?h('div',{className:'ap-player','data-kind':kind,'data-playing':status?.status==='playing'||undefined},h(PlayButton,{audio,asset:view,big:true}),
        // private fork (entry name once, owner 2026-10): the card has no title of its own — the pane's name heading above it is the one name.
        h('div',{className:'ap-player-main'},h('div',{className:'ap-progress',role:'progressbar','aria-label':'播放进度','aria-valuemin':0,'aria-valuemax':100,'aria-valuenow':Math.round(pct)},h('span',{style:{width:pct+'%'}})),
          h('div',{className:'ap-player-foot'},h('span',{className:'ap-player-time'},playTime(status?.time||0)+' / '+playTime(status?.duration)),
            h(PlayerVolume,{value:entryVolume(content),onDraft:v=>audio.level?.(view,v),onCommit:v=>writeContent(c=>({...c,volume:v}))})))):
      kind==='skins'?h(SkinSample,{skin:document,label:asset.name,className:'ap-hero'}):
      // private fork (entry cleanup, owner 2026-10): an 物品 previews its own picture (the list thumbnail's image), whole.
      ['props','items'].includes(kind)?h('div',{className:'ap-hero-wrap'},hash?h(Thumb,{key:hash,binding,packId,hash,label:asset.name,className:'ap-hero ap-item-hero'}):h('span',{className:'ap-hero','data-empty':true})):
      h('div',{className:'ap-hero-glyph','data-kind':kind},h(KindIcon,{kind}));
    const note=asset.directorNote||'';
    // private fork (settings polish, owner 2026-10): on a phone (ack) the name row carries the sub-page ‹ and leads the page.
    const title=h('div',{className:'ap-detail-title'+(back?' ap-subhead':'')},back&&h(SubpageBack,back),h(CommitInput,{className:'ap-title-input','aria-label':'名称',value:asset.name,validate:v=>!v.trim()?'名称不能为空':chars(v)>256?'名称最多 256 字':'',onCommit:v=>write(c=>({...c,name:v.trim()}))}),
        copyMenu||removeMenu||null);
    // private fork (entry name once, owner 2026-10): on every size the name row leads the pane, above the preview / player,
    // and is the only place the name is shown (the player card dropped its own title).
    return h('div',{className:'ap-detail-pane','data-disabled':asset.enabled===false||undefined},title,h(ErrorBox,{error}),hero,
      h(EntryVariants,{asset,selected,onSelect:id=>{audio.stop();setVariant(id);},write,busy,upload:uploadVariant&&(file=>uploadVariant(kind,asset.id,selected?.id,file)),onError:setError}),
      copyIssue&&h('div',{role:'alert',className:'ap-alert ap-hint-chip'},'\u26a0 ',copyIssue.text,copyIssue.packId&&onOpenPack&&h(Button,{onClick:()=>onOpenPack(copyIssue.packId,'widgets')},'打开副本')),
      // private fork (inline-field sweep, owner 2026-10): the settings are one column of inline rows — 「label value」, the
      // value read as text and edited in place (ForkInlineField); switches, the slider and the 详情 text sit in the same rows.
      h(ForkInlineGrid,{label:asset.name+' 设置',columns:1,className:'ap-entry-fields'},
        ...(kind==='audience'?ForkAudienceFields({content:selected?content:asset.content,onCommit:next=>writeContent(c=>selected?next:{...c,content:next}),Help}):[]),
        // private fork (enable audit, owner 2026-10): enabling is part of 触发策略 — 蓝灯 / 绿灯 / 关闭 (关闭 = enabled: false;
        // the lamp keeps its mode underneath), the separate 启用 switch is gone. Kinds the director never picks by lamp get
        // 启用 / 关闭 and no 触发词 (nothing reads them there).
        !stateless&&h(ForkInlineRow,{label:lampless?'状态':'触发策略',help:entryHelp(lampless?'状态':'触发策略',lampless?LAMPLESS_HELP[kind]:LAMP_HELP+' 关闭：这一条不再用于舞台。')},
          h(LampMenu,{mode:entryLamp(asset,lampless),onOff:lampless,named:true,label:lampless?'状态':'触发策略',onChange:mode=>write(c=>setEntryLamp(c,mode))})),
        !lampless&&h(ForkInlineField,{kind:'chips',label:'触发词',help:entryHelp('触发词','名称本身也算触发词。最多 16 个，每个 2–40 字。'),value:asset.recall.keywords,split:splitKeywords,validate:keywordProblem,
          onCommit:keywords=>write(c=>applyEntryFields(c,{recall:{keywords},top:{}}))}),
        // private fork (audio editor, owner 2026-10): 详情 is an inline multi-line field (no underline, no grip, grows with
        // its text, one paragraph like the stored note); no counter — only the over-limit message.
        // private fork (entry cleanup, owner 2026-10): an 物品 is never sent to the director (its picture is found by name), so
        // its note reads as the author's own 备注 — the same stored field, no promise of a 适用情景.
        kind==='items'?h(ForkInlineField,{kind:'text',multiline:true,label:'备注',className:'ap-note-field',help:entryHelp('备注',NOTE_HELP.items),placeholder:'未填写',value:note,
          validate:v=>chars(v)>300?'备注最多 300 字':'',onCommit:v=>write(c=>({...c,directorNote:v}))}):
        h(ForkInlineField,{kind:'text',multiline:true,label:'详情',className:'ap-note-field',help:entryHelp('详情',NOTE_HELP[kind]),placeholder:kind==='ambience'?'备注':'适用情景',value:note,
          validate:v=>chars(v)>300?'详情最多 300 字':'',onCommit:v=>write(c=>({...c,directorNote:v}))}),
        // private fork (audio editor, owner 2026-10): the `usage` field reads as 备注 (an author's own note).
        kind==='music'&&h(ForkInlineField,{kind:'text',label:'备注',help:entryHelp('备注','作者自己的备注，不发给导演。'),placeholder:'未填写',value:content.usage||'',onCommit:v=>writeContent(c=>({...c,usage:v}))}),
        kind==='ambience'&&h(ForkInlineRow,{label:'循环播放'},h('label',{className:'ap-inline-switch'},h(ForkSwitch,{bare:true,label:'循环播放',checked:content.loop!==false,onChange:on=>writeContent(c=>({...c,loop:on}))}))), // private fork (UI standard phase 2 batch 8): the one switch
        // private fork (enable audit): 标签 (stored as `category`) is a path read as one chip per level; a click filters the list by that level.
        h(ForkInlineField,{kind:'chips',label:'标签',className:'ap-category-chips',help:entryHelp('标签',CATEGORY_HELP),addLabel:'添加下一级标签',value:categoryParts(asset.category),
          split:text=>categoryParts(text),validate:list=>chars(list.join('/'))>120?'标签最多 120 字':'',onPick:onCategory&&((word,index)=>onCategory(categoryParts(asset.category).slice(0,index+1).join('/'))),
          onCommit:list=>write(c=>applyEntryFields(c,{recall:{},top:{category:list.join('/')}}))})),
      kind==='audience'&&h(ForkAudienceRuleSections,{content:selected?content:asset.content,onCommit:next=>writeContent(c=>selected?next:{...c,content:next})}),
      kind==='backgrounds'&&h(BackgroundStageTheme,{asset:view,onCommit:writeContent}),
      kind==='widgets'&&h(WidgetSettingsForm,{declaration:document,defaults:content.settingsDefaults,binding,packs:packs.length?packs:[pack],
        onChange:(key,_type,value)=>writeContent(current=>{const settingsDefaults={...current.settingsDefaults};if(_type)settingsDefaults[key]=value;else delete settingsDefaults[key];return {...current,settingsDefaults};}),
        onReset:()=>writeContent(current=>{const next={...current};delete next.settingsDefaults;return next;})}),
      confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)}));
  }

  // A table is an explicit authoring action; preview selection never writes or starts playback.
  function entryVariantTable(asset) {
    if(asset.variants)return asset.variants;
    const identity=new Set(['kind','id','name','enabled','recall','directorNote','description','category','aliases','author','license','credits','extensions']);
    if(asset.kind==='cg')identity.delete('description');
    const content=asset.kind==='audience'?asset.content:Object.fromEntries(Object.entries(asset).filter(([key])=>!identity.has(key)));
    return {default:'base',entries:[{id:'base',name:'原图',content}]};
  }
  function entryWithVariants(asset,variants) {
    const next={...asset};
    if(!asset.variants)for(const key of asset.kind==='audience'?['content']:Object.keys(variants.entries[0].content))delete next[key];
    return {...next,variants};
  }
  function EntryVariants({asset,selected,onSelect,write,busy,upload,onError}) {
    const input=React.useRef(null),[confirm,setConfirm]=React.useState(null);
    const table=asset.variants,media=['backgrounds','props','items','music','sfx','ambience'].includes(asset.kind);
    const save=action=>write(current=>({...current,variants:editAssetVariantTable(current.variants,action)}));
    const add=id=>write(current=>{
      const next=entryVariantTable(current),key=id||'v'+Date.now().toString(36)+(entrySerial++).toString(36);
      const row=selected?assetVariantRow(next,selected.id):assetVariantRow(next);
      const variants={...next,entries:[...next.entries,{id:key,name:ENTRY_TIMES[key]||'新变体',content:clone(row.content)}]};
      onSelect(key);return entryWithVariants(current,variants);
    });
    const menu=h(Popover,{label:'变体操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'变体操作','aria-expanded':open,disabled:busy,onClick:toggle}),content:close=>h(React.Fragment,null,
      ...(asset.kind==='backgrounds'?Object.entries(ENTRY_TIMES).filter(([id])=>!table?.entries.some(row=>row.id===id)).map(([id,name])=>h(MenuItem,{key:id,onClick:()=>{close();add(id);}},'添加'+name)):[]),
      selected&&table.entries.indexOf(selected)>0&&h(MenuItem,{onClick:()=>{close();save({type:'move',id:selected.id,delta:-1});}},'前移'),
      selected&&table.entries.indexOf(selected)<table.entries.length-1&&h(MenuItem,{onClick:()=>{close();save({type:'move',id:selected.id,delta:1});}},'后移'),
      selected&&table.entries.length>1&&h(MenuItem,{danger:true,onClick:()=>{close();setConfirm({title:'删除变体「'+selected.name+'」？',body:'仅删除这个变体，保留条目与其它变体。',confirmLabel:'删除',danger:true,onConfirm:()=>save({type:'remove',id:selected.id})});}},'删除变体…'))});
    return h(StageSection,{title:'变体',meta:table?.entries.length||0,foldKey:'entry-variants:'+asset.kind+'/'+asset.id,action:menu},
      h(ForkInlineGrid,{columns:1,label:'变体设置'},
        table&&h(ForkInlineField,{kind:'menu',label:'预览',value:selected.id,options:table.entries.map(row=>({value:row.id,label:row.name})),onCommit:onSelect}),
        selected&&h(ForkInlineField,{kind:'text',label:'名称',value:selected.name,validate:value=>!value.trim()?'请填写名称':chars(value)>256?'名称最多 256 字':'',onCommit:name=>save({type:'rename',id:selected.id,name})}),
        table&&h(ForkInlineField,{kind:'menu',label:'默认',value:table.default,options:table.entries.map(row=>({value:row.id,label:row.name})),onCommit:id=>save({type:'default',id})})),
      h('div',{className:'ap-cg-chips'},
        h('button',{type:'button',className:'ap-cg-add-chip','aria-label':'添加变体',title:'添加变体',disabled:busy||table?.entries.length>=256,onClick:()=>add()},h(Glyph,{name:'plus'})),
        media&&upload&&h(Button,{disabled:busy,onClick:()=>input.current?.click()},'替换媒体…')),
      media&&h('input',{ref:input,type:'file',hidden:true,tabIndex:-1,accept:AUDIO_KINDS.includes(asset.kind)?'audio/*,.mp3,.ogg,.wav,.m4a,.flac':CG_IMAGE_TYPES,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)Promise.resolve(upload(file)).catch(error=>onError(errorText(error)));}}),
      confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)}));
  }
