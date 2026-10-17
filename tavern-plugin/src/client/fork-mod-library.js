// First-party management shares the workbench primitives, not the legacy widget transport.
const modViewListeners=new Set();
const modText=(manifest,text)=>manifest.i18n?.messages?.[manifest.i18n.defaultLocale]?.[text]||text;
const modFailure=error=>({MOD_REVISION_CONFLICT:'\u5185\u5bb9\u5df2\u53d8\u5316\uff0c\u8bf7\u91cd\u8bd5',MOD_PERMISSION_DENIED:'\u9700\u8981\u6388\u6743',MOD_DEPENDENCY_MISSING:'\u6240\u9700\u529f\u80fd\u5c1a\u4e0d\u53ef\u7528',MOD_RESOURCE_UNAVAILABLE:'\u6a21\u7ec4\u4e0d\u53ef\u7528'}[error?.code]||'\u64cd\u4f5c\u5931\u8d25\uff0c\u8bf7\u91cd\u8bd5');
// kind 'packs' reads the mod's own pack scopes (listModPacks); otherwise getMod, or listMods without a modId.
function useModView(rpc,cardId,modId,kind) {
  const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[saving,setSaving]=React.useState(false);
  const queue=React.useRef(Promise.resolve()),life=React.useRef(0),sequence=React.useRef(0);
  const read=async()=>kind==='packs'?await rpc('listModPacks',{modId,...(cardId?{cardId}:{})}):modId?await rpc('getMod',{modId,...(cardId?{cardId}:{})}):await rpc('listMods',cardId?{cardId}:{});
  const reload=async()=>{const own=life.current,ticket=++sequence.current;try{const next=await read();if(own===life.current&&ticket===sequence.current){setData(next);setError('');}return next;}catch(e){if(own===life.current&&ticket===sequence.current)setError(modFailure(e));}};
  React.useEffect(()=>{life.current++;setData(null);setSaving(false);reload();modViewListeners.add(reload);return()=>{life.current++;sequence.current++;modViewListeners.delete(reload);};},[rpc,cardId,modId,kind]);
  function write(operation) {
    const own=life.current;
    const task=queue.current.catch(()=>{}).then(async()=>{
      if(own!==life.current)return;
      setSaving(true);setError('');
      try {
        for(let attempt=0;attempt<2;attempt++) {
          const current=await read();if(own!==life.current)return;
          try{await operation(current);break;}catch(e){if(e.code!=='MOD_REVISION_CONFLICT'||attempt)throw e;}
        }
        for(const notify of [...modViewListeners])notify();
        if(typeof window!=='undefined')window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed'));
      }catch(e){if(own===life.current)setError(modFailure(e));throw e;}
      finally{if(own===life.current)setSaving(false);}
    });
    queue.current=task;return task;
  }
  return {data,error,saving,reload,write};
}
// private fork (mod-ui, owner 2026-10): the mod switch is the panel's one ForkSwitch (bare, drawn by .ap-ui like every SwitchRow);
// the chat-side track skin rendered as a white pill without a knob inside the panels.
function useModScope({rpc,view,row,cardId,packId,modId=row.id}) {
  const [confirm,setConfirm]=React.useState(null);
  const change=next=>{
    const apply=authorize=>view.write(async current=>{
      let revision=current.revision;
      if(authorize)revision=(await rpc('authorizeMod',{modId,allowed:true,expectedRevision:revision})).revision;
      await rpc(packId?'setModPackScope':'setModScope',{modId,...(packId?{packId}:{}),...(packId&&cardId?{cardId}:{}),scope:next,expectedRevision:revision});
    }).catch(()=>{});
    if(!packId&&next!=='off'&&!row.authorized)setConfirm({title:'\u542f\u7528\u6a21\u7ec4',body:'\u5141\u8bb8\u8fd9\u4e2a\u5185\u7f6e\u6a21\u7ec4\u4f7f\u7528\u5176\u58f0\u660e\u7684\u529f\u80fd\u548c\u53d8\u91cf\uff1f',confirmLabel:'\u5141\u8bb8\u5e76\u542f\u7528',onConfirm:()=>apply(true)});
    else apply(false);
  };
  const scope={type:cardId?'card':'global',pending:{[row.id]:view.saving},stateOf:()=>row.scope,users:()=>[],options:()=>cardId?PACK_STATE_ORDER:['global','off'],set:(_,next)=>change(next)};
  return {scope,change,dialog:confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)})};
}
function ModScope(props) {
  const {row,packId}=props,{scope,change,dialog}=useModScope(props);
  return h(React.Fragment,null,packId?h(PackStateTag,{scope,id:row.id,name:row.name}):h(ForkSwitch,{bare:true,label:row.name,checked:row.scope==='global',disabled:props.view.saving,onChange:enabled=>change(enabled?'global':'off')}),dialog);
}
// 舞台设置 › 模组: one row per mod, the same SwitchRow as 基础设置 — icon, name, the quiet 「›」, the global switch; the whole row
// but the switch opens the mod (private fork, settings-ux r2).
function ModSwitchRow({rpc,view,row,cardId,onOpen,takeFocus}) {
  const {change,dialog}=useModScope({rpc,view,row,cardId}),open=()=>onOpen(row.id),jump=React.useRef(null);
  // Back from the mod's page: the focus returns to this row's 「›」.
  React.useEffect(()=>{if(takeFocus?.(row.id))jump.current?.focus?.();},[]);
  return h(React.Fragment,null,h(SwitchRow,{label:row.name,icon:'widgets',checked:row.scope==='global',disabled:view.saving,onChange:enabled=>change(enabled?'global':'off'),onOpen:open,
    status:h('button',{type:'button',ref:jump,className:'ap-kind-jump','aria-label':row.name+' 设置',title:row.name,onClick:open},h(Glyph,{name:'chevRight'}))}),dialog);
}
// private fork (engine row, owner 2026-10): an internal first-party mod (manifest ui.internal: the demo kept for tests) is
// never listed in 舞台设置 › 模组.
// private fork (one mod entry, owner 2026-10): 舞台设置 › 模组 is the only place mods are listed — the separate 模组库 tab
// (its own list look and its own detail page) is gone. A row opens ModDetail in place in 舞台设置 (ctx.openMod).
function ModList({rpc,cardId,onOpen,takeFocus}) {
  const view=useModView(rpc,cardId),rows=view.data?.mods.filter(row=>!row.internal)||[];
  return h(StageSection,{title:'模组',meta:view.data?rows.length:undefined,help:'模组是全局启用的独立功能。点名称进入设置；开关对所有卡生效。',className:'ap-widget-section'},
    h(ErrorBox,{error:view.error,reload:view.reload}),
    !view.data?!view.error&&h(Loading):rows.length?rows.map(row=>h(ModSwitchRow,{key:row.id,rpc,view,row,cardId,onOpen,takeFocus})):h('p',{className:'ap-empty'},'没有安装模组'));
}
// private fork (settings-ux r2, owner 2026-10): a figure's face for the mod pages (the phone's contacts) — the panel's one
// avatar resolver (FigureCastFace + figureAvatar: the calm avatar) over the card's packs the stage settings already read.
const stageModFace=ctx=>(ref,label)=>{const pack=ctx.writer?.pack?.(ref.packId),figure=pack?.figures?.[ref.figureId];
  return figure?h(FigureCastFace,{binding:ctx.binding,packId:ref.packId,pack,figure,sprites:pack.sprites,avatar:figureAvatar(figure,pack.sprites),label:label||figure.name,className:'fork-phone-face',frame:'face'}):null;};
// private fork (one mod entry, owner 2026-10): a mod's page opens in place in 舞台设置 (StagePage, ‹ 舞台设置 and Esc go back),
// from 舞台设置 › 模组 and from 提示词 › 模组 (ctx.openMod).
function StageModPage({ctx,cardId,modId,onBack}) {
  const assetSettings=ctx.nav?.openLibrary?Object.fromEntries(Object.keys(kinds).map(kind=>[kind,{
    count:stageKindPacks(ctx,kind).flatMap(pack=>pack.manifest.assets).filter(asset=>asset.kind===kind&&asset.enabled).length,
    onOpen:()=>ctx.nav.openLibrary({kind})}])):{};
  return h(ModDetail,{key:modId,rpc:ctx.binding.engineRpc,cardId,cardName:ctx.cardName,sessionId:ctx.sessionId,modId,faceOf:stageModFace(ctx),assetSettings,onBack});
}
function StageModSection({ctx,cardId}) {
  return ctx.openMod&&ctx.binding.engineRpc?h(ModList,{rpc:ctx.binding.engineRpc,cardId,onOpen:ctx.openMod,takeFocus:ctx.takeModFocus}):null;
}
// @include fork-mod-config-pages.js
// @include fork-danmaku-pages.js
// @include fork-mod-settings.js
// @include fork-mod-assets.js
