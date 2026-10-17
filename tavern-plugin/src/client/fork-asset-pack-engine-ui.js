// private fork (engine settings redesign, owner 2026-10): 引擎设置 — the settings every card shares.
// private fork (engine ui r2, owner 2026-10): opened from the last row of 舞台设置 › 基础设置 (「引擎设置 ›」, 高级 only); the
// old 全局设置 section is gone. Sections by purpose, most impactful first: 可用演出 → 每轮上限 → 对话主题 (→
// 配音服务选择 when a kind has several services). private fork (owner 2026-10): the vector / semantic recall feature is removed —
// no matching section, status or reindex here, and no recall RPCs. Every first-level heading folds like the stage panel's
// (StageSection: title → count → chevron is one button, 「?」 outside; remembered under 「引擎设置 › <title>」). Explanations live
// in 「?」 only; ⚠ marks a real problem (an error), never a notice.
// 可用演出 (settings polish, owner 2026-10: was 「导演能做什么」) is the one, global director command setting (no card layer, owner 2026-10): one row per group
// reading 全部 / 部分 n/m / 全部关闭 that unfolds to its toggle chips; a chip saves at once. The other fields are a draft saved
// with 「保存」. Stored config shape unchanged.
// private fork (direction styles, owner 2026-10): 演出风格 are 素材库 entries; only the 对话主题 import / export is left here.
// private fork (stage mode entry, owner 2026-10): the page is 「舞台模式」, opened from the 基础设置 row 「舞台模式 ›」 (was the
// separate 「舞台引擎」 row and page). Sections in plain order: 模型 (saves at once) → 智能判断 (part of the page draft, was its own sub-page and row) → 可用演出 → 每轮上限 →
// 对话主题 (→ 配音服务). One 「保存」 for the whole draft; every (?) is one plain sentence without internal terms.
// private fork (engine page r2, owner 2026-10): no 对话主题 — nothing ever applied an imported dialogue theme, the stage's look
// is a 舞台皮肤 entry in the 素材库.
// private fork (global only, owner 2026-10, AGENTS rule 15): 可用演出 is the ONE director command setting — no card
// override (a card's stored stage.dimensions is ignored; per-card differences come from its assets). 提示词 › 导演 › 导演指令
// only shows the text and a ✎ that opens this page at 可用演出 (focus 'commands'). The page is 导演模型 → 智能判断 →
// 可用演出 → 每轮上限 (→ 配音服务). The four visual groups of directorCommands plus CG (audio and widgets have their own
// 基础设置 / 模组 switches): 18 commands.
const ENGINE_DIMENSION_GROUPS=[...directorCommands.dimensionGroups.slice(0,4),['CG',[['cg','CG']]]];
const ENGINE_CAPS=[['beat','画面效果','次'],['act','人物动作','次 / 人']];
// The engine page's folds sit in the stage panel's fold store under their own keys (kept from the old page name, so
// stored folds survive the rename).
const engineFold=title=>'引擎设置 › '+title;
// private fork (settings polish, owner 2026-10): the page is a sub-page of 舞台设置 (SubpageHead: ‹ beside its title).
// private fork (stage mode entry, owner 2026-10): the director model is chosen only in the page's 「导演模型」 section, one
// grouped menu: 跟随前台 (the default: the chat model), then one bold group per provider with its models (getTavernSettings →
// modelCatalog); a chosen model shows its name. Stored as directorModel: null (跟随前台) | {provider, model}; no 跟随后台, so
// the director does not depend on the host's 后台模型 (any other stored value reads as 跟随前台).
const directorModelKey=(provider,model)=>JSON.stringify([provider,model]);
// private fork (director probe, owner 2026-10): `support` is getDirectorToolSupport's models (docs/fork/director-probe.md) —
// a model whose stored test found no tool calling reads 「不支持工具调用」 and cannot be picked; untested models stay open.
const DIRECTOR_NO_TOOLS='不支持工具调用',DIRECTOR_TOOLS_OK='支持工具调用';
function directorModelOptions(catalog,current,support) {
  const models=(catalog||[]).flatMap(group=>(group.models||[]).map(model=>{const value=directorModelKey(group.provider,model.id),off=support?.[value]===false;
    return {value,label:model.name||model.id,group:group.providerName||group.provider,title:(group.providerName||group.provider)+'：'+(model.name||model.id),...(off?{disabled:true,note:DIRECTOR_NO_TOOLS}:{})};}));
  // A stored model missing from the list (provider removed, or the list not read yet) keeps a visible option.
  if(current&&!models.some(o=>o.value===directorModelKey(current.provider,current.model)))models.unshift({value:directorModelKey(current.provider,current.model),label:current.model+(catalog?'（不可用）':''),title:current.provider+'：'+current.model});
  return [{value:'foreground',label:'跟随前台'},...models];
}
const directorRpc=(binding,method,args)=>(binding.engineRpc||binding.rpc)(method,args);
// Stored tool-support results; a failed read leaves every model selectable (nothing is known about them).
function useDirectorToolSupport(binding,skip) {
  return useLoad(binding,async()=>skip?null:(await directorRpc(binding,'getDirectorToolSupport',{}))?.models||{},[]);
}
// `support` (optional): a shared useDirectorToolSupport state, so a test on the page re-reads the menu it sits beside.
function DirectorModelMenu({binding,value,onChange,disabled,support}) {
  const catalog=useLoad(binding,async()=>(await binding.rpc('getTavernSettings')).modelCatalog||[],[]);
  const own=useDirectorToolSupport(binding,!!support);
  const custom=value&&typeof value==='object'?value:null,current=custom?directorModelKey(custom.provider,custom.model):'foreground';
  const options=directorModelOptions(catalog.value,custom,(support||own).value);
  return h(React.Fragment,null,
    h(ForkInlineMenu,{name:'模型',options,value:current,disabled,title:options.find(o=>o.value===current)?.title,
      onCommit:key=>onChange(key==='foreground'?null:(([provider,model])=>({provider,model}))(JSON.parse(key)))}),
    catalog.error&&h(HintLine,{compact:true,text:'读取模型列表失败',action:'重试',onAction:catalog.reload}));
}
// 舞台模式 › 导演模型: the menu and 测试连接 beside it — like 智能判断's test (one line, result after the button), for the
// model in the menu (跟随前台 resolves through this session). The result clears when the model changes; a
// finished test re-reads the stored support, so the menu greys a model that cannot call tools.
const DIRECTOR_TEST_ERRORS={DIRECTOR_CONNECTION_ERROR:'连接失败',MODEL_NOT_SELECTED:'没有可用的模型',SETTINGS_UNAVAILABLE:'设置不可写'};
function DirectorModelSetting({binding,value,onChange,disabled}) {
  const support=useDirectorToolSupport(binding,false),[test,setTest]=React.useState(null),testRun=React.useRef(0);
  const key=value&&typeof value==='object'?directorModelKey(value.provider,value.model):'foreground';
  React.useEffect(()=>{testRun.current++;setTest(null);},[key]);
  async function runTest(){
    const run=++testRun.current;setTest({running:true});
    let result;try{result=await binding.rpc('testDirectorConnection',{selection:value??null});}
    catch(e){const code=e?.code||e?.message,said=errorText(e);result={ok:false,failure:DIRECTOR_TEST_ERRORS[code]||(/[\u4e00-\u9fff]/.test(said)?said:'测试失败')};}
    if(run!==testRun.current)return;
    setTest(result);
    if(typeof result?.supported==='boolean')support.reload();
  }
  // private fork (engine page layout, owner 2026-10): one labelled 「模型」 row like the fields below it — the menu, then the
  // secondary 测试连接 button and its result on the same line (they wrap under the menu on a phone).
  return h(ForkInlineGrid,{label:'导演模型',columns:1},
    h(ForkInlineRow,{label:'模型',className:'ap-engine-model'},
      h(DirectorModelMenu,{binding,value,disabled,onChange,support}),
      h('span',{className:'ap-judge-test'},
        h(Button,{className:'ap-engine-test',disabled:disabled||test?.running,onClick:runTest},'测试连接'),
        h(DirectorTestResult,{result:test}))));
}
function DirectorTestResult({result}) {
  if(!result)return null;
  if(result.running)return h('span',{className:'ap-judge-test-result',role:'status'},h(ForkSpinner),'正在测试…');
  const ms=Number.isFinite(result.latencyMs)?' · '+Math.round(result.latencyMs)+' 毫秒':'';
  if(result.supported===true)return h('span',{className:'ap-judge-test-result is-ok',role:'status'},DIRECTOR_TOOLS_OK,h(Glyph,{name:'check'}),ms.trim());
  const text=result.supported===false?DIRECTOR_NO_TOOLS:result.failure||result.error?.message||DIRECTOR_TEST_ERRORS[result.error?.code]||'连接失败';
  return h('span',{className:'ap-judge-test-result is-error',role:'alert'},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),text+ms);
}
// ---------- 可用演出: one row per group — its name in the label column, 「全部 ⌄」 as the value (underlined on hover like a
// field's value) — unfolding to its chips under the value column. A chip saves at once. ----------
function engineGroupState(on,total) { return on===total?'全部':on===0?'全部关闭':'部分 '+on+'/'+total; }
function EngineCommandGroup({group,items,isOn,disabled,onToggle}) {
  const [open,setOpen]=React.useState(false),bodyId=React.useId();
  const on=items.filter(([key])=>isOn(key)).length,state=engineGroupState(on,items.length);
  return h('div',{className:'ap-engine-group','data-open':open||undefined},
    h('button',{type:'button',className:'ap-engine-group-toggle','aria-expanded':open,'aria-controls':bodyId,onClick:()=>setOpen(!open)},
      h('span',{className:'ap-engine-group-name'},group),
      h('span',{className:'ap-engine-group-value'},
        h('span',{className:'ap-engine-group-state','data-partial':on<items.length||undefined},state),
        h('span',{className:'ap-section-chevron','aria-hidden':true},h(Glyph,{name:'chevDown'})))),
    // The chips stay in the tree while folded (hidden), like a folded section's body.
    h('div',{className:'ap-engine-group-body ap-dimension-list ap-check-list',id:bodyId,role:'group','aria-label':group,hidden:!open||undefined},
      items.map(([key,label])=>{const checked=isOn(key);
        return h('button',{key,type:'button',role:'checkbox','aria-checked':checked,className:'ap-check-row ap-dim-chip',disabled,onClick:()=>onToggle(key,!checked)},
          checked&&h(Glyph,{name:'check'}),h('span',null,label));})));
}

// `focus:'judge'` (提示词 › 智能判断 ✎) opens the page at 智能判断, unfolded, with the focus on its heading; `focus:'commands'`
// (提示词 › 导演指令 / 演出指引 ✎) at 可用演出 the same way.
function EnginePage({binding,onBack,focus}) {
  const services=useLoad(binding,async()=>(await binding.rpc('getAssetVoiceServices')).services,[]);
  const state=useLoad(binding,()=>binding.rpc('getAssetEngineSettings'),[]),[draft,setDraft]=React.useState(null);
  const preserved=React.useRef(null),title=React.useRef(null),page=React.useRef(null),focused=React.useRef(false);
  React.useEffect(()=>{if(state.value){setDraft(preserved.current || clone(state.value.values));preserved.current=null;}},[state.value]);
  React.useEffect(()=>{title.current?.focus?.({preventScroll:true});},[]);
  React.useEffect(()=>{if(!['judge','commands'].includes(focus)||!draft||focused.current)return;focused.current=true;
    const toggle=page.current?.querySelector((focus==='judge'?'.ap-engine-judge':'.ap-engine-commands')+' .ap-section-toggle');toggle?.closest('section')?.scrollIntoView?.({block:'start'});toggle?.focus?.({preventScroll:true});},[draft,focus]);
  const head=h(SubpageHead,{parent:'舞台设置',title:'舞台模式',onBack,titleRef:title,help:h(Help,{label:'舞台模式 说明',text:'这一页的设置所有卡共用。'})});
  // Esc leaves like ‹, but never drops an unsaved draft.
  const keys=e=>{if(!draft||!dirtyOf(draft))subpageKeys(onBack)(e);};
  const dirtyOf=value=>{if(!state.value)return false;const {dimensions:_a,semanticRecall:_b,...saved}=state.value.values,{dimensions:_c,semanticRecall:_d,...mine}=value;return JSON.stringify(saved)!==JSON.stringify(mine);};
  if(!draft)return h('div',{className:'ap-engine',ref:page,onKeyDown:keys},head,state.error?h(ErrorBox,{error:state.error,reload:state.reload}):h(Loading));
  function patch(value){setDraft({...draft,...value});}
  // 智能判断 is part of the draft (engine settings `judge`); a draft problem (a compatible endpoint without its URL …) blocks 保存.
  const judgeProblem=draft.judge?judgeDraftProblem(draft.judge):'';
  // private fork (owner 2026-10): the removed vector recall's stored semanticRecall (until the backend drops it) is neither
  // shown, compared nor sent.
  const dirty=dirtyOf(draft);
  // An immediate write (the model, a 可用演出 chip) keeps the rest of the unsaved draft.
  const keep=(result,key)=>{preserved.current={...draft,[key]:result.values[key]};state.setValue(result);};
  // `dimensions` saves at once (its chips) and the unused dialogue themes are never sent back.
  async function save(){if(judgeProblem||!validDraft())return;const {schemaVersion,semanticRecall:_retired,dimensions:_chips,dialogueThemes:_themes,...values}=draft;const result=await state.task(()=>binding.rpc('saveAssetEngineSettings',{expectedRevision:state.value.revision,patch:values}));if(result)state.setValue(result);}
  // 模型 saves at once.
  // private fork (judge key, owner 2026-10): 判断模型 › API Key saves at once through the host, never through the draft. A
  // variable-name reference also saved the judge's keyName: the page takes it and keeps the rest of the unsaved draft.
  async function saveKey(value){
    const result=await (binding.engineRpc||binding.rpc)('setJudgeKey',{provider:draft.judge.provider,value,expectedRevision:state.value.revision});
    if(result.settings){preserved.current={...draft,judge:{...draft.judge,keyName:result.settings.values.judge.keyName}};state.setValue(result.settings);}
    return result.status;
  }
  async function saveModel(directorModel){const result=await state.task(()=>binding.rpc('saveAssetEngineSettings',{expectedRevision:state.value.revision,patch:{directorModel}}));if(result)keep(result,'directorModel');}
  async function toggleDimension(key,value){const result=await state.task(()=>binding.rpc('saveAssetEngineSettings',{expectedRevision:state.value.revision,patch:{dimensions:{[key]:value}}}));if(result)keep(result,'dimensions');}
  // Every command shows (a missing key reads as on, like the backend default).
  const dims=draft.dimensions||{},groups=ENGINE_DIMENSION_GROUPS;
  const shown=groups.flatMap(([,items])=>items.map(([key])=>key)),onCount=shown.filter(key=>dims[key]!==false).length;
  const serviceKind=s=>s.capabilities?.localEngine?'local':s.kind;
  // private fork (settings polish, owner 2026-10): 配音服务选择 only lists a method that really has a choice. The stored choice is
  // read by dsh-tts chooseService: a chosen service is used (only it); 「自动」 uses the one compatible service when there is exactly
  // one, otherwise none. So with one service 自动 already uses it and the row changes nothing — it shows for ≥ 2 services, or
  // when the stored choice names a service that is not installed (that kind stays silent until it is set back to 自动).
  const installed=services.value||null,ofKind=kind=>(installed||[]).filter(s=>serviceKind(s)===kind);
  const voiceKinds=installed?[...new Set([...installed.map(serviceKind),...Object.keys(draft.voiceServices).filter(k=>k!=='reference'&&k!=='gpt-sovits')])]
    .filter(kind=>{const chosen=draft.voiceServices[kind];return ofKind(kind).length>=2||!!chosen&&!installed.some(s=>s.id===chosen);}):[];
  return h('div',{className:'ap-engine',ref:page,onKeyDown:keys},head,
    h(StageSection,{foldKey:engineFold('模型'),title:'导演模型',className:'ap-engine-model-section',help:'导演模型用于安排演出：默认跟随前台，即和聊天用同一个模型。'},
      h(DirectorModelSetting,{binding,value:draft.directorModel??null,disabled:state.busy||!state.value.writable,onChange:saveModel})),
    // private fork (judge key, owner 2026-10): 「判断模型」 (was 智能判断; the fold key keeps the old name), no provider badge.
    draft.judge&&h(StageSection,{foldKey:engineFold('智能判断'),title:'判断模型',className:'ap-engine-judge',reveal:focus==='judge',
        help:'可选：配置后可减轻导演负担、更精准地挑选素材；未设置时蓝灯与触发词照常生效，可用模组直接交给导演。'},
      h(EngineJudgeFields,{binding,config:draft.judge,busy:state.busy,onSaveKey:saveKey,onPatch:value=>patch({judge:{...draft.judge,...value}})})),
    h(StageSection,{foldKey:engineFold('可用演出'),title:'可用演出',meta:onCount+' / '+shown.length,className:'ap-engine-commands',reveal:focus==='commands',
        help:'导演可以用哪些演出，所有卡通用，点选立即保存。'},
      h('div',{className:'ap-engine-groups'},groups.map(([group,items])=>h(EngineCommandGroup,{key:group,group,items,isOn:key=>dims[key]!==false,disabled:state.busy||!state.value.writable,onToggle:toggleDimension})))),
    // private fork (engine page layout, owner 2026-10): one column, the same label column as every other field here.
    h(StageSection,{foldKey:engineFold('每轮上限'),title:'每轮上限',help:'每轮回复里最多用几次，免得画面一直闪、人物一直动。'},
      h(ForkInlineGrid,{label:'每轮上限',columns:1},ENGINE_CAPS.map(([key,label,unit])=>h(ForkInlineField,{key,kind:'number',label,controlLabel:label+' 每轮上限',unit,integer:true,min:1,max:256,value:draft.actionCaps[key],onCommit:v=>patch({actionCaps:{...draft.actionCaps,[key]:v}})})))),
    (voiceKinds.length>0||services.error)&&h(StageSection,{foldKey:engineFold('配音服务选择'),title:'配音服务',help:'同一种配音装了几个服务时，用哪一个。'},
      h(ForkInlineGrid,{label:'配音服务',columns:1},voiceKinds.map(kind=>{const current=draft.voiceServices[kind]||'',mine=ofKind(kind),name=VOICE_PROVIDERS[kind]||kind;
        return h(ForkInlineField,{key:kind,kind:'menu',label:name,controlLabel:name+' 默认服务',value:current,
          options:[{value:'',label:'自动'},...(current&&!(services.value||[]).some(s=>s.id===current)?[{value:current,label:current+'（不可用）'}]:[]),...mine.map(s=>({value:s.id,label:s.label||s.name||s.id}))],
          onCommit:v=>{const next={...draft.voiceServices};if(v)next[kind]=v;else delete next[kind];patch({voiceServices:next});}});})),
      h(ErrorBox,{error:services.error,reload:services.reload})),
    h(ErrorBox,{error:state.error,reload:state.reload}),
    // Sticky while there is something to save, so 「保存」 is reachable from any section.
    h('div',{className:'ap-engine-foot','data-dirty':dirty||undefined},
      h('span',{className:'ap-save-state',role:'status','data-state':dirty&&judgeProblem?'problem':dirty?'dirty':'idle'},dirty&&judgeProblem?h(React.Fragment,null,h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),judgeProblem):dirty?'有未保存的修改':''),
      h(Button,{primary:true,disabled:state.busy||!state.value.writable||!dirty||!!judgeProblem,onClick:save},'保存')));
}

// ---------- 判断模型 (智能判断) ----------
// private fork (judge ui, owner 2026-10): kept in this file (every test bundle includes it). The engine's judge config
// (docs/fork/judge.md). private fork (engine row, owner 2026-10): no sub-page or 基础设置 row of its own any more — it is the
// 「智能判断」 section of 舞台模式 (EngineJudgeFields), part of that page's draft (engine settings `judge`, saved
// by its one 「保存」; a compatible endpoint needs its URL before the config is valid). Switching the provider fills in its model
// and default credential name. 测试连接 (testJudgeConnection) sends the unsaved draft.
// private fork (judge key, owner 2026-10): 「API Key」 (JudgeKeyField) replaces 密钥名称 — the key itself or a variable name,
// saved at once by the host (setJudgeKey) and never read back.
const JUDGE_UI_PROVIDERS={jev:{label:'Jev',model:'jev-1.13.0',keyName:'TYPESAFE_API_KEY'},openai:{label:'OpenAI',model:'gpt-6-luna',keyName:'OPENAI_API_KEY'},
  'openai-compatible':{label:'OpenAI 兼容',model:'gpt-6-luna',keyName:'OPENAI_API_KEY'}};
// The host RPC rejects a failed test with the code as its message: map either form, never show the raw code.
const JUDGE_ERRORS={JUDGE_INACTIVE:'未设置提供方',JUDGE_NO_KEY:'没有 API Key',JUDGE_TIMEOUT:'超时',JUDGE_HTTP_ERROR:'服务返回错误',JUDGE_INVALID_RESPONSE:'返回内容不对',JUDGE_ERROR:'连接失败'};
// Picking a provider fills in its model and credential name; only a compatible endpoint keeps a URL. Picking one turns
// the judge on (the stored `enabled` is kept for 未设置).
function judgeWithProvider(config,provider) {
  const preset=JUDGE_UI_PROVIDERS[provider];
  return {...config,provider,enabled:preset?true:config.enabled,model:preset?.model||'',keyName:preset?.keyName||'',baseUrl:provider==='openai-compatible'?config.baseUrl:''};
}
function judgeUrlProblem(text) {
  if(!text)return '请填写接口地址';
  let url=null;try{url=new URL(text);}catch(_){}
  if(!url||!['http:','https:'].includes(url.protocol))return '请填写 http(s) 地址';
  return url.username||url.password||url.search||url.hash?'地址里不能带账号、参数或 #':'';
}
// What keeps the draft from being saved or tested (a field never committed has no inline error yet).
function judgeDraftProblem(config) {
  if(config.provider==='unset')return '';
  if(config.provider==='openai-compatible'&&judgeUrlProblem(config.baseUrl))return judgeUrlProblem(config.baseUrl);
  return config.model.trim()?'':'请填写模型';
}
const JUDGE_KEY_HELP='这里支持两种填法：1. 直接粘贴 API Key，最直观；2. 填环境变量的准确名称，从这个环境变量读取。';
const judgeKeyProblem=value=>/^[\x21-\x7e]{1,4096}$/.test(value)?'':'API Key 不能含空格或中文';
// 「API Key」: one masked box for either form; the host tells them apart. Configured: 「已配置」 (a stored key: 更换 / 清除) or
// 「已配置 · 环境变量 NAME」 (更换). The key never comes back; a failed save keeps the typed draft with its reason. `trail` is
// the row's 测试连接.
function JudgeKeyField({binding,judgeRpc,provider,keyName,disabled,onSave,trail}) {
  const status=useLoad(binding,()=>judgeRpc('getJudgeCredentialStatus',{provider,keyName}),[provider,keyName]);
  const [editing,setEditing]=React.useState(false),[saving,setSaving]=React.useState(false),[error,setError]=React.useState('');
  React.useEffect(()=>{setEditing(false);setError('');},[provider]);
  async function save(value){
    setSaving(true);setError('');
    try{status.setValue(await onSave(value));setEditing(false);}catch(e){setError(JUDGE_ERRORS[e?.code]||'保存失败');}finally{setSaving(false);}
  }
  const value=status.value,help=h(Help,{label:'API Key 说明',text:JUDGE_KEY_HELP});
  const problem=(status.error||error)&&h(HintLine,{compact:true,text:error||'读取 API Key 状态失败'});
  if(!value&&!status.error)return h(ForkInlineRow,{label:'API Key',help},h(ForkSpinner),trail);
  if(value?.configured&&!editing)return h(ForkInlineRow,{label:'API Key',help,className:'ap-judge-key-row'},
    h('span',{className:'ap-judge-key'},value.source==='stored'?'已配置':'已配置 · 环境变量 '+(value.keyName||'')),
    h(Button,{className:'ap-inline-link',disabled:disabled||saving,onClick:()=>setEditing(true)},'更换'),
    value.source==='stored'&&h(Button,{className:'ap-inline-link',disabled:disabled||saving,onClick:()=>save(null)},'清除'),problem,trail);
  return h(ForkInlineField,{kind:'text',secret:true,label:'API Key',help,value:'',placeholder:'粘贴 API Key 或环境变量名',maxLength:4096,disabled:disabled||saving,
    validate:judgeKeyProblem,onCommit:v=>save(v),trail:h(React.Fragment,null,saving&&h(ForkSpinner),problem,
      editing&&h(Button,{className:'ap-inline-link',onClick:()=>{setEditing(false);setError('');}},'取消'),trail)});
}
function JudgeTestResult({result}) {
  if(!result)return null;
  if(result.running)return h('span',{className:'ap-judge-test-result',role:'status'},h(ForkSpinner),'正在测试…');
  const ms=Number.isFinite(result.latencyMs)?' · '+Math.round(result.latencyMs)+' 毫秒':'';
  if(result.ok)return h('span',{className:'ap-judge-test-result is-ok',role:'status'},h(Glyph,{name:'check'}),'连接成功'+ms);
  const text=JUDGE_ERRORS[result.failure]||result.failure||JUDGE_ERRORS[result.error?.code]||'连接失败';
  return h('span',{className:'ap-judge-test-result is-error',role:'alert'},h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),text+ms);
}
// 舞台模式 › 判断模型: the fields of the page draft's `judge` — 提供方 → (接口地址) → 模型 → API Key with 测试连接 and its
// result at the end of that row, then 门槛 / 每类上限 / 超时 / 附加说明. `onPatch(value)` merges into the draft's judge; a
// change clears the last test result. `onSaveKey(value)` saves the API Key at once (EnginePage).
function EngineJudgeFields({binding,config,busy,onPatch,onSaveKey}) {
  // Machine-wide RPCs: sent without the session (binding.engineRpc) where the host provides it.
  const judgeRpc=(method,args)=>(binding.engineRpc||binding.rpc)(method,args);
  const [test,setTest]=React.useState(null),testRun=React.useRef(0);
  const provider=config.provider,set=provider!=='unset',problem=judgeDraftProblem(config);
  const patch=value=>{testRun.current++;setTest(null);onPatch(value);};
  async function runTest(){
    if(problem||!validDraft())return;
    const run=++testRun.current;setTest({running:true});
    let result;try{result=await judgeRpc('testJudgeConnection',{config});}catch(e){result={ok:false,failure:JUDGE_ERRORS[e?.code]||JUDGE_ERRORS[e?.message]||errorText(e)};}
    if(run===testRun.current)setTest(result);
  }
  const options=[{value:'unset',label:'未设置'},...Object.entries(JUDGE_UI_PROVIDERS).map(([value,p])=>({value,label:p.label}))];
  const help=(label,text)=>h(Help,{label:label+' 说明',text});
  return h(React.Fragment,null,
    h(ForkInlineGrid,{label:'判断模型',columns:1},
      h(ForkInlineField,{kind:'menu',label:'提供方',value:provider,options,disabled:busy,help:help('提供方','用哪家的服务；OpenAI 按用量另外计费，不含在 ChatGPT / Codex 订阅里。'),
        onCommit:v=>patch(judgeWithProvider(config,v))}),
      set&&provider==='openai-compatible'&&h(ForkInlineField,{kind:'text',label:'接口地址',value:config.baseUrl,placeholder:'https://…/v1',disabled:busy,validate:judgeUrlProblem,
        help:help('接口地址','服务的网址，填根地址或以 /v1 结尾的地址。'),onCommit:v=>patch({baseUrl:v})}),
      set&&h(ForkInlineField,{kind:'text',label:'模型',value:config.model,disabled:busy,validate:v=>v?'':'请填写模型',onCommit:v=>patch({model:v})}),
      // private fork (judge key, owner 2026-10): 测试连接 sits at the end of the row it tests (like 导演模型's), not on a line of its own.
      set&&h(JudgeKeyField,{key:provider,binding,judgeRpc,provider,keyName:config.keyName,disabled:busy,onSave:onSaveKey,
        trail:h('span',{className:'ap-judge-test'},
          h(Button,{className:'ap-engine-test',disabled:busy||test?.running||!!problem,onClick:runTest},'测试连接'),
          h(JudgeTestResult,{result:test}))})),
    // private fork (engine page r2, owner 2026-10): no 「更多」 fold — 门槛 / 每类上限 / 超时 / 附加说明 are always shown.
    h(ForkInlineGrid,{label:'判断模型 细节',columns:1,className:'ap-judge-details'},
      h(ForkInlineField,{kind:'number',label:'门槛',value:config.threshold,min:0,max:1,step:0.05,disabled:busy,help:help('门槛','判断的把握达到这个值才补进，越高补得越少。'),onCommit:v=>patch({threshold:v})}),
      h(ForkInlineField,{kind:'number',label:'每类上限',unit:'条',integer:true,min:0,max:300,value:config.capPerKind,disabled:busy,help:help('每类上限','每类最多补进几条；蓝灯和触发词命中的不算。'),onCommit:v=>patch({capPerKind:v})}),
      h(ForkInlineField,{kind:'number',label:'超时',unit:'毫秒',integer:true,min:1,max:120000,step:100,value:config.timeoutMs,disabled:busy,help:help('超时','等这么久还没结果，这一轮就只按触发词。'),onCommit:v=>patch({timeoutMs:v})}),
      h(ForkInlineField,{kind:'text',label:'附加说明',multiline:true,lines:true,wide:true,maxLength:4000,placeholder:'无',value:config.preamble,disabled:busy,
        help:help('附加说明','随剧情一起发给判断模型的说明；一般留空效果更好。'),onCommit:v=>patch({preamble:v})})));
}
// 提示词 › 判断模型: previewStageDirectorPrompt `judge` → rows.
// private fork (prompt panel D′, owner 2026-10): each request body is cut into what it carries — 剧情 (the story text the
// judge reads: the body's longest string), 待判断素材 (the questions: its largest list or map) and 拼接与封装 (the rest:
// the model name, the keys and brackets around them) — one row each, every batch in the same three rows; a batch's
// pieces join back into its body byte for byte. A body of another shape is one row per batch (判断请求 / 第 n 批), as sent.
const JUDGE_ROWS=[['judge-story','剧情','本轮'],['judge-questions','待判断素材','本轮'],['judge-frame','拼接与封装','全局']];
function judgeBodyPieces(request,batch) {
  const text=String(request.body??''),tree=promptJson(text);
  if(tree?.type!=='object')return null;
  const size=node=>promptJsonText(node).length,largest=list=>list.sort((a,b)=>size(b[1])-size(a[1]))[0]?.[1];
  const story=largest(tree.entries.filter(([,node])=>node.type==='string')),questions=largest(tree.entries.filter(([,node])=>pjNested(node)));
  if(!story||!questions)return null;
  const pieces=[],method=String(request.method||'POST'),url=String(request.url||'');let offset=0,join='{';
  const push=(key,piece)=>{pieces.push({key,batch,offset,method,url,text:piece,bytes:promptBytes(piece),tokens:promptTokenEstimate(piece)});offset+=piece.length;};
  tree.entries.forEach(([key,node],i)=>{join+=(i?',':'')+JSON.stringify(key)+':';
    if(node===story||node===questions){push('judge-frame',join);join='';push(node===story?'judge-story':'judge-questions',promptJsonText(node));}
    else join+=promptJsonText(node);});
  push('judge-frame',join+'}');
  return pieces;
}
function judgePromptRows(judge) {
  const requests=Array.isArray(judge?.requests)?judge.requests:[],cut=requests.map(judgeBodyPieces);
  if(!requests.length)return [];
  if(cut.some(pieces=>!pieces))return requests.map((request,index)=>{const text=String(request.body??''),bytes=promptBytes(text),tokens=promptTokenEstimate(text);
    return {id:'judge:'+index,name:requests.length>1?'第 '+(index+1)+' 批':'判断请求',owners:'全局、本轮',tokens,bytes,
      pieces:[{key:'judge-body',at:'body',name:'',method:String(request.method||'POST'),url:String(request.url||''),text,bytes,tokens}]};});
  const all=cut.flat(),note=requests.length>1?requests.length+' 批':null;
  return JUDGE_ROWS.map(([id,name,owners])=>{const pieces=all.filter(piece=>piece.key===id);
    return {id,name,owners,note,tokens:promptSum(pieces),bytes:pieces.reduce((sum,piece)=>sum+piece.bytes,0),pieces,
      ...(id==='judge-questions'?{count:pieces.reduce((sum,piece)=>sum+judgeQuestions(piece.text).length,0)}:{})};});
}
// The questions of a 待判断素材 piece → [{id, ask, kind, name, note}]: an id → question map or a list of named questions;
// each question's text (its tags left out) read as 「ask [kind] name; …: note」, else the text is its name.
const JUDGE_KINDS={background:'backgrounds',music:'music','sound effect':'sfx',ambience:'ambience',CG:'cg',lighting:'looks',outfit:'outfits',character:'figures',performance:'performances',widget:'widgets'};
function judgeQuestions(text) {
  const value=promptParse(text),list=Array.isArray(value)?value.map(item=>[item?.name??item?.id,item]):schemaObject(value)?Object.entries(value):[];
  return list.map(([id,item])=>{
    const inner=String(item?.instructions??item?.text??'').replace(/^<([\w-]+)>\n?([\s\S]*?)\n?<\/\1>$/,'$2').trim();
    const m=/^([\s\S]*?)\s*\[([^\]]+)\]\s*([^;]*?)\s*(?:;\s*(?:[^:]*:)?\s*([\s\S]*))?$/.exec(inner);
    const word=m?m[2]:'',kind=JUDGE_KINDS[word];
    return {id:String(id),ask:m?m[1]:'',kind:kind||'',group:kind?commandKinds[kind]||word:word||'其他',name:m?m[3]||String(id):inner||String(id),note:m?m[4]||'':''};
  });
}
// The rows opened: 剧情 by paragraph; 待判断素材 as one line with the question every item is asked, then the items by kind
// (人物, 服装, 背景… then the mods), each a chip with its note in its hover, long groups folded at 60; 拼接与封装 as the
// request's map (`POST url`, then the joins as dashed chips around the two parts). 「查看原文」 gives each piece as sent.
const JUDGE_FOLD=60;
function JudgePromptBody({row,rows,raw}) {
  if(row.pieces[0]?.key==='judge-body')return row.pieces.map((piece,index)=>h('div',{key:index,className:'ap-prompt-piece'},
    h('div',{className:'ap-prompt-piece-head'},h('span',{className:'ap-prompt-at ap-judge-url',title:piece.url},piece.method+' '+piece.url)),
    h(PromptText,{text:piece.text,raw})));
  const batches=new Set(row.pieces.map(piece=>piece.batch)).size;
  if(row.id==='judge-frame')return raw?h('pre',{className:'ap-prompt-outline'},judgeLayout(rows).map(batch=>batch.items.map(item=>item.join??'⟨'+item.name+'⟩').join('')).join('\n')):
    h(PromptMap,{blocks:judgeLayout(rows)});
  if(raw)return row.pieces.map((piece,index)=>h('div',{key:index,className:'ap-prompt-piece'},batches>1&&h('div',{className:'ap-prompt-piece-head'},'第 '+(piece.batch+1)+' 批'),h('pre',null,piece.text)));
  if(row.id==='judge-story'){const story=promptParse(row.pieces[0].text);
    return h('div',{className:'ap-prompt-group ap-judge-story'},String(story??'').split(/\n{2,}/).map((part,i)=>h('span',{key:i,className:'ap-story-text'},part)));}
  return h(JudgeQuestions,{questions:row.pieces.flatMap(piece=>judgeQuestions(piece.text))});
}
function judgeLayout(rows) {
  const all=rows.flatMap(row=>row.pieces).sort((a,b)=>a.batch-b.batch||a.offset-b.offset),out=[];
  for(const piece of all){let batch=out[piece.batch];if(!batch)out[piece.batch]=batch={head:piece.method+' '+piece.url,tokens:0,items:[]};
    batch.tokens+=piece.tokens;batch.items.push(piece.key==='judge-frame'?{join:piece.text}:{name:piece.key==='judge-story'?'剧情':'待判断素材',tokens:piece.tokens});}
  return out.filter(Boolean);
}
function JudgeQuestions({questions}) {
  const [open,setOpen]=React.useState({});
  const asks=[...new Set(questions.map(q=>q.ask))],groups=new Map();
  for(const q of questions){if(!groups.has(q.group))groups.set(q.group,{kind:q.kind,list:[]});groups.get(q.group).list.push(q);}
  const order=['figures','outfits',...KIND_ORDER],rank=kind=>{const at=order.indexOf(kind);return at<0?order.length:at;};
  return h('div',{className:'ap-prompt-groups'},
    asks.length===1&&asks[0]&&h('p',{className:'ap-judge-ask'},h('span',{className:'ap-prompt-at'},'每项都问'),h('span',null,asks[0])),
    [...groups].sort(([,a],[,b])=>rank(a.kind)-rank(b.kind)).map(([group,{list}])=>h('section',{key:group,className:'ap-prompt-group','aria-label':group},
      h('div',{className:'ap-prompt-group-head'},h('span',{className:'ap-prompt-group-name'},group),h('span',{className:'ap-prompt-group-count'},list.length)),
      h('div',{className:'ap-judge-items'},(open[group]?list:list.slice(0,JUDGE_FOLD)).map((q,i)=>h('span',{key:i,className:'ap-cmd-val is-word',title:[q.name,q.note].filter(Boolean).join(' — ')},q.name)),
        list.length>JUDGE_FOLD&&!open[group]&&h('button',{type:'button',className:'ap-schema-toggle',onClick:()=>setOpen(before=>({...before,[group]:true}))},'其余 '+(list.length-JUDGE_FOLD)+' 项')))));
}
