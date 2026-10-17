// private fork (voice v4 P1, owner 2026-10): a figure's 声音. The figure page keeps one compact 「声音」 property — the
// voice's name (⚠ when it cannot speak), ▶ and the way into the voice page. The voice page replaces the figure column
// (desktop: the preview card stays pinned beside it; phone: a full-screen sub-page with its own top bar).
// Ways to give a voice, simplest first and each folded until asked for: Fish 声音 (recommended picks + paste an ID or search) ·
// 在线 TTS · 参考音频 · 本地引擎; first of all 声音预设 (the pack's voices × tunings, flat; my templates; per-emotion presets).
// Contract: docs/fork/voice-contract.md (P0 data + P1 RPC). Choosing a ready-made voice gives this figure a new pack voice
// (the old one stays in the pack); editing a voice that other figures share asks first (copy for this figure, or all).
// Opening, choosing or saving never synthesizes; ▶ does, and a paid or unknown-cost preview asks first (billing confirm).
// Missing service / key / model → ⚠ chip, the figure stays silent (不配音); nothing silently switches service.
const VOICE_TTS_ROOT='/api/dsh-tts/v1/';
const VOICE_PROVIDERS={'fish-audio':'Fish Audio',qwen:'通义千问',azure:'Azure',volcengine:'火山引擎',local:'本地引擎','openai-compatible':'自定义语音服务','reference-api':'参考音频服务'};
const FIGURE_VOICE_LANGUAGES=[['ja','日语'],['zh','中文'],['en','英语'],['ko','韩语'],['yue','粤语']];
const VOICE_SAMPLES={ja:'こんにちは。今日もよろしくお願いします。',zh:'你好，今天也请多关照。',en:'Hello. It is good to see you today.',ko:'안녕하세요. 오늘도 잘 부탁해요.',yue:'你好，今日都請多多指教。'};
const VOICE_GENDERS={female:'女声',male:'男声',neutral:'中性'};
const VOICE_LANGUAGE_TAG=/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const VOICE_CLIP_ACCEPT='.wav,.mp3,audio/wav,audio/x-wav,audio/mpeg';
// Tunable parameters per provider (native parameter names, docs/fork/voice-contract.md 「方案示例」). Ranges follow the
// adapters' own validators (providers/params.js); Fish and the local engine have no pitch.
const VOICE_TUNING={
  'fish-audio':[{key:'speed',label:'语速',min:0.5,max:2,step:0.05,base:1,unit:'x'}],
  local:[{key:'speed_factor',label:'语速',min:0.5,max:2,step:0.05,base:1,unit:'x'}],
  azure:[{key:'rate',label:'语速',min:-50,max:100,step:5,base:0,unit:'%'},{key:'pitch',label:'音高',min:-50,max:50,step:5,base:0,unit:'%'},{key:'style',label:'风格',kind:'style'}],
  qwen:[{key:'instructions',label:'风格指令',kind:'text'}]};
const voiceFailure=code=>Object.assign(new Error(code),{code});
const voiceCode=e=>e?.code||(/^[A-Z][A-Z0-9_]+$/.test(e?.message||'')?e.message:'');
const VOICE_ERRORS={TTS_DISABLED:'配音插件未启用',PLUGIN_UNAVAILABLE:'配音插件未启用',SERVICE_REQUIRED:'还没有可用的语音服务',CREDENTIALS_REQUIRED:'语音服务缺少密钥',
  QWEN_MODEL_NOT_FOUND:'当前服务上次合成无法访问此模型（404），请核对模型开通状态与区域',QWEN_VOICE_UNSUPPORTED:'上次合成返回此模型不支持该音色，请重新选择音色',
  MODEL_REQUIRED:'这台电脑没有这个本地模型',MISSING_REFERENCE:'还没有参考音频',PREVIEW_CONFIRMATION_REQUIRED:'付费确认已过期，请重新试听',PAID_PREVIEW_DISABLED:'这个服务不能免费试听',
  FISH_AUTH_FAILED:'Fish Audio 密钥无效',FISH_BILLING_REQUIRED:'Fish Audio 额度不足，没有改用付费型号',FISH_RATE_LIMITED:'Fish Audio 请求太频繁，请稍后再试',FISH_REQUEST_FAILED:'Fish Audio 请求失败，请稍后再试',
  VOICE_NOT_FOUND:'找不到这个声音',VOICE_VARIANT_IN_USE:'还有别的人物在用这个预设，先给他们换一个预设',SHARED_VOICE_CONFIRMATION_REQUIRED:'这个声音还有别的人物在用，请重新确认',
  REFERENCE_LIMIT_EXCEEDED:'参考音频超过了服务的限制',LIMIT_EXCEEDED:'素材包空间不够了',QUEUE_FULL:'试听太多，请稍后再试',TIMEOUT:'试听超时，请稍后再试',AUDIO_GONE:'试听音频已失效，请重新试听',
  REVISION_CONFLICT:'内容已被修改，请重新载入',INVALID_INPUT:'内容不符合格式，没有保存',REQUEST_FAILED:'请求失败，请稍后再试',FORBIDDEN:'没有权限'};
function voiceErrorText(e){const code=voiceCode(e);return VOICE_ERRORS[code]||(code?'操作失败，请稍后再试':errorText(e));}
const providerName=kind=>VOICE_PROVIDERS[kind]||'语音服务';
// The one line that says why a voice is silent (⚠ chips, the 声音 property's tooltip).
// A Latin service name gets spaces around it inside a Chinese sentence (缺少 Fish Audio 密钥 / 缺少通义千问密钥).
const spacedName=name=>/^[A-Za-z]/.test(name)?' '+name+' ':name;
function voiceIssueText(code,source){
  const name=spacedName(providerName(source?.provider));
  if(code==='SERVICE_REQUIRED')return source?.provider==='local'?'这台电脑没有本地引擎':'还没有配置'+name+'服务';
  if(code==='CREDENTIALS_REQUIRED')return '缺少'+name+'密钥';
  return VOICE_ERRORS[code]||'暂时不能发声';
}
const voiceLanguageName=tag=>FIGURE_VOICE_LANGUAGES.find(([id])=>id===tag||id===String(tag).split('-')[0])?.[1]||tag;
// private fork (voice language, owner 2026-10): which languages a voice source can speak, from the provider and the voice
// itself (the adapters' own lists in dsh-tts core.js / providers). null = not known here (no ⚠ is shown).
const VOICE_SOURCE_LANGUAGES={'fish-audio':['ja','zh','en','ko','fr','de','ru','it','es','pt','ar','nl','pl'],qwen:['zh','en','fr','de','ru','it','es','pt','ja','ko'],
  local:['ja','zh','en','ko','yue'],'reference-api':['ja','zh','en','ko','yue'],'openai-compatible':['ja','zh','en','ko','yue']};
const primaryLanguage=tag=>{const p=String(tag||'').split('-')[0].toLowerCase();return p==='all_ja'?'ja':p;};
function voiceSourceLanguages(source){
  if(!source)return null;
  if(source.provider==='azure'){const name=String(source.voiceName||'');if(/multilingual/i.test(name))return null;const locale=name.split('-').slice(0,2).join('-');
    return /^(zh-HK|yue-)/i.test(locale)?['yue']:locale?[primaryLanguage(locale)]:null;}
  return VOICE_SOURCE_LANGUAGES[source.provider]||null;
}
const voiceSpeaks=(source,language)=>{const list=voiceSourceLanguages(source);return !list||list.includes(primaryLanguage(language));};
const VOICE_LANGUAGE_HELP='和正文语言不同时，AI 会额外写一句这门语言的台词用来配音，画面上仍显示正文。';
const pickVoiceLanguage=(list,fallback='ja')=>(list||[]).map(l=>String(l).toLowerCase()).find(l=>VOICE_LANGUAGE_TAG.test(l))||fallback;
const figureVoiceSpec=(pack,figure)=>figure.voice?pack.manifest.voiceLibrary?.voices?.[figure.voice.voice]||null:null;
const voiceSourceId=(spec,binding)=>binding?.source===null?null:binding?.source??spec.defaultSource;
const voiceUsers=(pack,voiceId)=>Object.values(pack.figures||{}).filter(f=>f.voice?.voice===voiceId);
const voiceSourceLabel=source=>source.kind==='voice-id'?'Fish 声音':source.kind==='reference-list'?'参考音频':source.kind==='emotion-references'?'本地引擎':'在线 TTS · '+providerName(source.provider);
const voiceSourceShort=source=>source.kind==='voice-id'?'Fish 编号':source.kind==='reference-list'?'参考音频':source.kind==='emotion-references'?'本地引擎':providerName(source.provider);
const sampleText=language=>VOICE_SAMPLES[String(language).split('-')[0]]||VOICE_SAMPLES.en;
const freeSourceId=(spec,...names)=>{for(const n of names)if(!spec.sources[n])return n;let i=2;while(spec.sources[names[0]+i])i++;return names[0]+i;};
const voiceBytes=n=>!Number.isFinite(n)?'':n<1024*1024?Math.max(1,Math.round(n/1024))+' KB':(n/1024/1024).toFixed(n<10*1024*1024?1:0)+' MB';
const voiceSeconds=s=>!Number.isFinite(s)?'':s<60?(Math.round(s*10)/10)+' 秒':Math.floor(s/60)+' 分 '+Math.round(s%60)+' 秒';
const tuneText=(def,v)=>def.unit==='x'?Number(v).toFixed(2)+'×':(v>0?'+':'')+v+'%';
// private fork (voice page r2): a 声音预设 is one pack voice × one of its variants (原声 = the implicit 'normal'). The UI lists
// them flat; the data stays voice v4 (voiceLibrary voices + variants, the figure binding's voice / variant).
const voicePresets=spec=>{const v=spec.variants||{};return {normal:{name:'原声',...(v.normal||{})},...Object.fromEntries(Object.entries(v).filter(([k])=>k!=='normal'))};};
const presetName=(spec,id)=>id==='normal'?(spec.variants?.normal?.name||'原声'):spec.variants?.[id]?.name||'未命名预设';
const cleanBinding=b=>{const next={...b};for(const k of Object.keys(next))if(next[k]===undefined)delete next[k];return next;};
const fishVoiceSpec=(v,fallbackName)=>({name:v?.name||fallbackName,language:pickVoiceLanguage(v?.languages),defaultSource:'fish',sources:{fish:{kind:'voice-id',provider:'fish-audio',voiceId:v.voiceId}}});
const modelLabel=(model,i,all)=>{const base=(model.engine==='gpt-sovits'?'GPT-SoVITS':model.engine)+' '+model.modelVersion;return all.filter(m=>m.engine===model.engine&&m.modelVersion===model.modelVersion).length>1?base+' · 模型 '+(i+1):base;};
const sameVoiceModel=(a,b)=>!!a&&!!b&&a.engine===b.engine&&a.modelVersion===b.modelVersion&&['gpt','sovits','sv','lora'].every(k=>(a[k]?.sha256||'')===(b[k]?.sha256||''));

// ---------- data + preview plumbing ----------
function useVoiceLoad(loader,deps){
  const [state,setState]=React.useState({value:null,error:''}),seq=React.useRef(0);
  const load=()=>{const n=++seq.current;setState(s=>({value:s.value,error:''}));Promise.resolve().then(loader).then(value=>{if(n===seq.current)setState({value,error:''});},e=>{if(n===seq.current)setState({value:null,error:voiceErrorText(e)});});};
  React.useEffect(()=>{setState({value:null,error:''});load();return()=>{seq.current++;};},deps);
  return {...state,reload:load};
}
function voiceTts(binding){if(!binding.tts?.call)throw voiceFailure('TTS_DISABLED');return binding.tts;}
function useVoiceServices(binding){
  const state=useVoiceLoad(()=>binding.rpc('getAssetVoiceServices').then(r=>r.services||[]),[binding]),list=state.value||[];
  return {list,loaded:!!state.value,first:kind=>list.find(s=>s.kind===kind),local:list.filter(s=>s.capabilities?.localEngine)};
}
// private fork (owner 2026-10 voice-row): re-read a useVoiceLoad in place (value kept until the new one arrives) after any
// TTS event (a synthesis finished, presets changed) or when `deps` change after mount — a refresh never blanks the ⚠.
function useVoiceRefresh(binding,reload,deps){
  const latest=React.useRef(reload),mounted=React.useRef(false);latest.current=reload;
  React.useEffect(()=>binding?.tts?.subscribe?.(()=>latest.current()),[binding]);
  React.useEffect(()=>{if(mounted.current)latest.current();mounted.current=true;},deps||[]);
}
function useVoiceModelStatus(binding,source,version) {
  const state=useVoiceLoad(()=>binding.tts?.call('voiceModelStatus',{provider:source?.provider,model:source?.model,voiceName:source?.voiceName})||null,
    [binding,source?.provider,source?.model,source?.voiceName]);
  useVoiceRefresh(binding,state.reload,[version]);
  return state;
}
function VoiceConfirmedWarning({issues,field}) {
  const issue=issues?.find(i=>(!field||i.field===field)&&['QWEN_MODEL_NOT_FOUND','QWEN_VOICE_UNSUPPORTED'].includes(i.code));
  if(!issue)return null;
  const text=voiceIssueText(issue.code);
  return h('span',{className:'ap-hint-line is-compact'},h('span',{className:'ap-hint-mark',role:'img','aria-label':text},'⚠'),h(Help,{text,label:'配音警告说明'}));
}
// The saved figure's effective state (⚠ issues) from getFigureVoiceEditor; never synthesizes or calls a provider.
function useFigureVoiceStatus(binding,pack,figure){
  const [status,setStatus]=React.useState(null),[tick,setTick]=React.useState(0),key=pack.manifest.id+'/'+figure.id+'@'+pack.revision+'#'+tick;
  React.useEffect(()=>binding.tts?.subscribe?.(()=>setTick(n=>n+1)),[binding]);
  React.useEffect(()=>{
    let live=true;if(!figure.voice||!binding.rpc){setStatus(null);return;}
    binding.rpc('getFigureVoiceEditor',{packId:pack.manifest.id,figureId:figure.id}).then(r=>{if(live)setStatus({key,effective:r.effective||null,issues:r.issues||[]});},()=>{if(live)setStatus(null);});
    return()=>{live=false;};
  },[binding,key]);
  return status;
}
// A preview job already submitted by previewFigureVoice: poll the TTS job, then fetch through its audio ticket.
async function voiceJobWait(requestId,timeoutMs,live){
  const deadline=Date.now()+(timeoutMs||125000);
  while(live()&&Date.now()<deadline){
    const response=await fetch(VOICE_TTS_ROOT+'synthesis/status?requestId='+encodeURIComponent(requestId),{credentials:'same-origin'}),status=await response.json();
    if(!response.ok)throw voiceFailure(status.error||'REQUEST_FAILED');
    if(status.state==='ready')return status.result;
    if(status.state==='error')throw voiceFailure(status.error);
    if(status.state==='cancelled')throw voiceFailure('ABORTED');
    await new Promise(r=>setTimeout(r,200));
  }
  throw voiceFailure(live()?'TIMEOUT':'ABORTED');
}
const voiceJobCancel=requestId=>{if(typeof fetch==='function')fetch(VOICE_TTS_ROOT+'synthesis/status?requestId='+encodeURIComponent(requestId),{method:'DELETE',credentials:'same-origin'}).catch(()=>{});};
// One voice preview at a time per figure editor. A paid / unknown-cost service answers `confirmation-required`: the
// billing dialog asks once; only then the same request is resent with its one-time token. Cancel never resends.
function useVoicePreview(binding){
  const [state,setState]=React.useState(null),[ask,setAsk]=React.useState(null),current=React.useRef(null),kinds=React.useRef(null);
  const finish=run=>{if(run.requestId&&!run.done)voiceJobCancel(run.requestId);if(run.scope){const scope=run.scope;run.scope=null;binding.rpc('closeFigureVoicePreview',{scope}).catch(()=>{});}};
  function stop(){const run=current.current;current.current=null;if(run){run.cancelled=true;run.resolve?.(false);try{run.audio?.pause?.();}catch(_){}finish(run);}setAsk(null);setState(null);}
  React.useEffect(()=>stop,[binding]);
  async function serviceName(id){
    try{kinds.current||=binding.rpc('getAssetVoiceServices').then(r=>r.services||[]);const s=(await kinds.current).find(x=>x.id===id);return s?providerName(s.kind):'付费语音服务';}catch(_){return '付费语音服务';}
  }
  async function play(key,request,{label=''}={}){
    if(current.current?.key===key){stop();return;}
    stop();
    const run={key};current.current=run;setState({key,phase:'loading'});
    const live=()=>current.current===run&&!run.cancelled;
    try{
      if(!binding.tts)throw voiceFailure('TTS_DISABLED');
      let result=await binding.rpc('previewFigureVoice',request);
      if(result.status==='confirmation-required'){
        if(!live())return;
        const service=await serviceName(result.billing?.serviceId);
        const ok=live()&&await new Promise(resolve=>{run.resolve=resolve;setAsk({label,service,resolve});});
        run.resolve=null;setAsk(null);
        if(!ok||!live()){if(current.current===run){current.current=null;setState(null);}return;}
        result=await binding.rpc('previewFigureVoice',{...request,confirmToken:result.confirmToken});
        if(result.status!=='submitted')throw voiceFailure('PREVIEW_CONFIRMATION_REQUIRED');
      }
      run.scope=result.scope;run.requestId=result.requestId;
      if(!live()){finish(run);return;}
      const done=await voiceJobWait(result.requestId,result.timeoutMs,live);run.done=true;
      if(!live())return;
      if(typeof Audio==='undefined')throw voiceFailure('AUDIO_GONE');
      const audio=new Audio(binding.tts.audioUrl?binding.tts.audioUrl(done.ticket):VOICE_TTS_ROOT+'audio?ticket='+encodeURIComponent(done.ticket));
      run.audio=typeof forkForeground!=='undefined'?forkForeground.media(audio):audio;
      audio.onended=()=>{if(current.current===run)stop();};
      await run.audio.play();
      if(live())setState({key,phase:'playing'});
    }catch(e){if(current.current===run){current.current=null;finish(run);setAsk(null);setState({key,phase:'error',error:voiceErrorText(e)});}}
  }
  const dialog=ask&&h(VoiceBillingDialog,{...ask,onCancel:()=>ask.resolve(false),onConfirm:()=>ask.resolve(true)});
  return {state,play,stop,dialog,of:key=>state?.key===key?state:null};
}
function VoiceBillingDialog({label,service,onConfirm,onCancel}) {
  return h(Modal,{title:'付费试听',onClose:onCancel,closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,'试听'+(label?'「'+label+'」':'')+'会用'+spacedName(service)+'合成一句短句，按服务价格计费一次。'),
    h(Actions,null,h(Button,{onClick:onCancel},'取消'),h(Button,{primary:true,onClick:onConfirm},'确认试听')));
}
function VoiceSharedDialog({figure,others,onPick}) {
  const names=others.map(f=>f.name).join('、');
  return h(Modal,{title:'这个声音还有别的人物在用',onClose:()=>onPick(null),closable:false,className:'ap-confirm ap-voice-dialog'},
    h('p',null,'「'+names+'」也在用这个声音。只改「'+figure.name+'」会复制一份给它单独用；一起修改会影响所有在用的人物。'),
    h(Actions,null,h(Button,{onClick:()=>onPick(null)},'取消'),h(Button,{onClick:()=>onPick('all')},'一起修改'),h(Button,{primary:true,onClick:()=>onPick('copy')},'只改「'+figure.name+'」')));
}
// Reference clips are WAV / MP3 only (the TTS reference contract); the bytes are checked here once, the pack checks again.
async function prepareVoiceClip(file,limit){
  const bytes=new Uint8Array(await file.arrayBuffer()),ext=audioExt(bytes);
  if(ext!=='wav'&&ext!=='mp3')throw new Error('参考音频只能是 WAV 或 MP3');
  if(bytes.length>(limit||60*1024*1024))throw new Error(limit?'这里的单段参考音频不能超过 '+voiceBytes(limit):'音频过大（上限 60 MB）');
  return {bytes,descriptor:{ext,mime:AUDIO_MIME[ext],size:bytes.length}};
}
// Every pack write of the page goes through the modal's serialized CAS queue (commitVoice). An edit of the figure's
// voice: only this figure uses it → write it; other figures too → ask (copy for this figure, or everyone).
function useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared}) {
  const svc=binding.service,packId=pack.manifest.id,figureId=figure.id,everyone=React.useRef(null),[busy,setBusy]=React.useState(0);
  React.useEffect(()=>{everyone.current=null;},[figure.voice?.voice]);
  const run=async job=>{setBusy(n=>n+1);setError('');try{return await commitVoice(job);}catch(e){setError(voiceErrorText(e));return null;}finally{setBusy(n=>n-1);}};
  const setBinding=next=>run(c=>svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:next}));
  const patchBinding=patch=>run(c=>svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:c.revision,binding:cleanBinding({...c.figures[figureId].voice,...patch})}));
  const createVoice=spec=>run(c=>svc.createAndAssignPackVoice({packId,figureId,expectedRevision:c.revision,voiceSpec:spec}));
  async function scope(){
    const id=figure.voice?.voice,others=voiceUsers(pack,id).filter(f=>f.id!==figureId);
    if(!others.length)return 'own';
    if(everyone.current===id)return 'all';
    const pick=await askShared(others);if(pick==='all')everyone.current=id;return pick;
  }
  const copyFor=async(c,spec,b)=>{const made=await svc.createAndAssignPackVoice({packId,figureId,expectedRevision:c.revision,voiceSpec:spec});return svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:made.snapshot.revision,binding:{...b,voice:made.voiceId}});};
  // `variant`: {id} saves one tuning through savePackVoiceVariant; otherwise the whole voice through savePackVoice.
  const apply=(how,make,variant)=>run(async c=>{
    const b=c.figures[figureId].voice,id=b.voice,spec=make(structuredClone(c.manifest.voiceLibrary.voices[id])),used=voiceUsers(c,id).some(f=>f.id!==figureId);
    if(how==='copy')return copyFor(c,spec,b);
    if(variant)return svc.savePackVoiceVariant({packId,figureId,expectedRevision:c.revision,voiceId:id,variantId:variant.id,variant:spec.variants[variant.id],...(used?{confirmShared:true}:{})});
    return svc.savePackVoice({packId,figureId,expectedRevision:c.revision,voiceId:id,voiceSpec:spec,...(used?{confirmShared:true}:{})});
  });
  const editVoice=async(make,variant)=>{const how=await scope();return how?apply(how,make,variant):null;};
  async function deleteVariant(variantId){
    const how=await scope();if(!how)return null;
    return run(async c=>{
      const b=c.figures[figureId].voice,id=b.voice,spec=structuredClone(c.manifest.voiceLibrary.voices[id]),clean={...b};
      if(clean.variant===variantId)delete clean.variant;
      if(clean.emotionVariants){const map=Object.fromEntries(Object.entries(clean.emotionVariants).filter(([,v])=>v!==variantId));if(Object.keys(map).length)clean.emotionVariants=map;else delete clean.emotionVariants;}
      if(spec.variants){delete spec.variants[variantId];if(!Object.keys(spec.variants).length)delete spec.variants;}
      if(how==='copy')return copyFor(c,spec,clean);
      let s=c;if(JSON.stringify(clean)!==JSON.stringify(b))s=(await svc.saveFigureVoiceBinding({packId,figureId,expectedRevision:s.revision,binding:clean})).snapshot;
      return svc.deletePackVoiceVariant({packId,figureId,expectedRevision:s.revision,voiceId:id,variantId,...(voiceUsers(s,id).some(f=>f.id!==figureId)?{confirmShared:true}:{})});
    });
  }
  async function upload(files,language,limit){
    const refs=[];
    for(const file of files){
      let media;try{media=await prepareVoiceClip(file,limit);}catch(e){setError(errorText(e));return null;}
      const blob=await run(c=>svc.putBlob({packId,expectedRevision:c.revision,bytes:media.bytes,descriptor:media.descriptor}));
      if(!blob)return null;refs.push({media:blob.hash,text:'',language});
    }
    return refs;
  }
  // New clips for a source: the figure's voice gains them (a missing source is added); a figure without a voice gets a new one.
  async function addClips(files,{language,limit,create,place}){
    if(!figure.voice){const refs=await upload(files,language,limit);return refs&&createVoice(create(refs));}
    const how=await scope();if(!how)return null;
    const refs=await upload(files,language,limit);if(!refs)return null;
    return apply(how,spec=>{place(spec,refs);return spec;});
  }
  const assignTemplate=t=>run(c=>svc.assignVoiceTemplate({templateId:t.templateId,templateRevision:t.revision,packId,figureId,expectedRevision:c.revision}));
  const saveTemplate=()=>run(c=>svc.saveVoiceTemplate({expectedRevision:null,packId,packRevision:c.revision,voiceId:c.figures[figureId].voice.voice,binding:c.figures[figureId].voice}));
  return {busy,setBinding,patchBinding,createVoice,editVoice,deleteVariant,addClips,assignTemplate,saveTemplate};
}

// ---------- small pieces ----------
function VoicePlay({state,label,onClick,disabled,title,className=''}) {
  const on=!!state&&state.phase!=='error';
  return h('button',{type:'button',className:'ap-icon-button ap-voice-play'+(className?' '+className:''),'aria-label':on?'停止试听':label,'aria-pressed':on,'data-state':state?.phase,
      title:state?.phase==='error'?state.error:on?'停止试听':title||label,disabled:!!disabled&&!on,onClick},
    state?.phase==='loading'?h(ForkSpinner,{key:'voice'}):h(Glyph,{name:state?.phase==='error'?'warning':on?'stop':'play'}));
}
function VoiceWarn({children,action}) { return h('span',{className:'ap-voice-warn',role:'status'},h(Glyph,{name:'warning'}),h('span',null,children),action||null); }
function VoiceLoading() { return h('div',{className:'ap-voice-loading'},h(ForkSpinner,{label:'正在载入'})); }
function VoiceLoadError({error,retry}) { return h('p',{className:'ap-voice-line-warn',role:'alert'},h(VoiceWarn,null,error),retry&&h(Button,{className:'ap-link',onClick:retry},'重试')); }
// The 声音 pill's disc: the figure's colour, a still waveform that moves while this voice is speaking.
function VoiceDisc({playing,empty}) {
  return h('span',{className:'ap-voice-disc','data-playing':playing||undefined,'data-empty':empty||undefined,'aria-hidden':true},[0,1,2,3,4].map(i=>h('i',{key:i})));
}
function VoiceLanguagePick({value,label,onPick,className='',defaultValue}) {
  const [other,setOther]=React.useState(false);
  return h(Popover,{label,className:'ap-voice-lang-anchor'+(className?' '+className:''),trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-lang','aria-label':label+'：'+voiceLanguageName(value),'aria-expanded':open,onClick:()=>{setOther(false);toggle();}},h('span',null,voiceLanguageName(value)),h(Glyph,{name:'chevDown'})),
    content:close=>h(React.Fragment,null,FIGURE_VOICE_LANGUAGES.map(([id,name])=>h('button',{key:id,type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',onClick:()=>{close();if(value!==id)onPick(id);}},h('span',null,name),defaultValue===id&&h('span',{className:'ap-voice-lang-default'},'声音默认'),value===id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'})))),
      other?h('div',{className:'ap-voice-lang-other'},h(CommitInput,{className:'ap-voice-lang-input','aria-label':'其他语言代码',autoFocus:true,value:FIGURE_VOICE_LANGUAGES.some(([id])=>id===value)?'':value,placeholder:'例：de-DE',maxLength:35,validate:v=>VOICE_LANGUAGE_TAG.test(v.trim())?'':'请填写语言代码，如 de 或 pt-BR',onCommit:v=>{close();onPick(v.trim());}})):
        h('button',{type:'button',className:'ap-menu-item',onClick:()=>setOther(true)},'其他语言…'))});
}
function VoiceMoodPick({rows,value,onPick}) {
  const row=rows.find(r=>r.id===value)||rows[0];
  if(!row)return null;
  return h(Popover,{label:'试听差分',className:'ap-voice-mood-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick ap-voice-mood','aria-label':'试听差分：'+row.label,'aria-expanded':open,onClick:toggle},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,row.label),h(Glyph,{name:'chevDown'})),
    content:close=>rows.map(r=>h('button',{key:r.id,type:'button',role:'menuitemradio','aria-checked':r.id===row.id,className:'ap-menu-item',onClick:()=>{close();onPick(r.id);}},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,r.label),r.id===row.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))});
}
// A folded way of giving the voice: one hairline row (title · 使用中 · summary · chevron) that opens in place.
function VoiceWay({id,title,summary,current,open,onToggle,help,children}) {
  const body='ap-voice-way-'+id;
  // With a (?) the row reads title · (?) · 使用中 … summary · chevron: the head button's hit area spans the row (CSS), the (?) sits above it.
  return h('section',{className:'ap-voice-way','data-open':open||undefined,'aria-label':title},
    help?h('div',{className:'ap-voice-way-heading has-help'},
      h('button',{type:'button',className:'ap-voice-way-head','aria-expanded':open,'aria-controls':body,'aria-label':current?title+'，使用中':undefined,onClick:onToggle},h('span',{className:'ap-voice-way-title'},title)),
      h(Help,{text:help,label:title+' 说明'}),current&&h('span',{className:'ap-voice-current'},'使用中'),
      h('span',{className:'ap-voice-way-sum'},summary||''),h(Glyph,{name:'chevDown'})):
    h('div',{className:'ap-voice-way-heading'},
      h('button',{type:'button',className:'ap-voice-way-head','aria-expanded':open,'aria-controls':body,onClick:onToggle},
        h('span',{className:'ap-voice-way-title'},title),current&&h('span',{className:'ap-voice-current'},'使用中'),
        h('span',{className:'ap-voice-way-sum'},summary||''),h(Glyph,{name:'chevDown'}))),
    open&&h('div',{id:body,className:'ap-voice-way-body'},children));
}
// A chosen-from-a-list row (search results, online voices, pack voices, templates): name · meta · ▶ · 使用.
function VoiceRow({name,meta,tags,current,play,onUse,useLabel='使用',menu,warn,title}) {
  return h('li',{className:'ap-voice-row','data-current':current||undefined,title},
    h('div',{className:'ap-voice-row-main'},h('span',{className:'ap-voice-row-name'},name,current&&h('span',{className:'ap-voice-current'},'使用中')),
      (meta||tags)&&h('span',{className:'ap-voice-row-meta'},[meta,tags].filter(Boolean).join(' · ')),warn),
    play||null,
    onUse&&h(Button,{className:'ap-chip-button ap-voice-use','aria-label':(current?'正在使用 ':useLabel+' ')+name,disabled:current,onClick:onUse},current?'使用中':useLabel),menu||null);
}

// ---------- the 声音 property on the figure page ----------
// private fork (figure-editor r6, owner 2026-10): one inline row 「声音 大肥鱼（萌宝）›」 (ForkInlineField link) that opens the
// voice page; no ▷ beside it (试听 lives on the voice page).
function FigureVoiceField({pack,figure,status,pillRef,onOpen}) {
  const spec=figureVoiceSpec(pack,figure),voice=figure.voice,muted=!!spec&&voice.source===null,source=spec&&!muted?spec.sources[voiceSourceId(spec,voice)]:null;
  const issue=source?status?.issues?.[0]:null,warn=issue&&voiceIssueText(issue.code,source),name=spec?spec.name:'选择声音';
  return h(ForkInlineField,{kind:'link',label:'声音',className:'is-voice',controlRef:pillRef,controlClassName:'ap-voice-pill',value:spec?spec.name:'',placeholder:name,onOpen,
    ariaLabel:'声音：'+name+(muted?'，不配音':'')+(warn?'，'+warn+'，暂不配音':''),title:warn?'⚠ '+warn+'，暂不配音':'声音设置',
    before:warn&&h('span',{className:'ap-hint-mark','aria-hidden':true},h(Glyph,{name:'warning'})),after:muted&&h('span',{className:'ap-voice-pill-muted'},'不配音')});
}

// ---------- the voice page ----------
function VoicePage({binding,pack,figure,rows,status,preview,commitVoice,ctx,onClose}) {
  const packId=pack.manifest.id,voice=figure.voice||null,spec=figureVoiceSpec(pack,figure),sourceId=spec?voiceSourceId(spec,voice):null;
  const [open,setOpen]=React.useState(()=>spec?null:'fish'),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[shared,setShared]=React.useState(null);
  const head=React.useRef(null),services=useVoiceServices(binding),clips=useAudioPreview(binding,packId);
  const askShared=others=>new Promise(resolve=>setShared({others,resolve}));
  const writer=useVoiceWriter({binding,pack,figure,commitVoice,setError,askShared});
  const player={...preview,play:(...args)=>{clips.stop();return preview.play(...args);}};
  React.useEffect(()=>{head.current?.focus?.({preventScroll:true});const page=head.current?.closest?.('.ap-pack-right');if(page)page.scrollTop=0;},[]);
  React.useEffect(()=>{if(!spec)setOpen(o=>o||'fish');},[!!spec]);
  React.useEffect(()=>{if(!notice)return;const t=setTimeout(()=>setNotice(''),4000);return()=>clearTimeout(t);},[notice]);
  const toggle=id=>setOpen(o=>o===id?null:id);
  const choose=async(make,label)=>{preview.stop();const done=await writer.createVoice(make);if(done)setNotice('已换成「'+label+'」');};
  const candidate=voiceSpec=>({packId,figureId:figure.id,expectedRevision:pack.revision,voiceSpec});
  const active=spec&&spec.sources[sourceId??spec.defaultSource],refEntry=spec&&Object.entries(spec.sources).find(([,s])=>s.kind==='reference-list'),localEntry=spec&&Object.entries(spec.sources).find(([,s])=>s.kind==='emotion-references');
  const recommended=useVoiceLoad(()=>voiceTts(binding).call('listRecommendedFishVoices',{}).then(r=>r.voices||[]),[binding]);
  const currentFishId=active?.kind==='voice-id'?active.voiceId:null;
  const presetCount=Object.values(pack.manifest.voiceLibrary?.voices||{}).reduce((n,s)=>n+Object.keys(voicePresets(s)).length,0);
  const packSummary=spec?presetName(spec,voice.variant||'normal')+' · '+presetCount+' 个预设':presetCount?presetCount+' 个预设':'';
  const common={binding,pack,figure,spec,voice,sourceId,writer,preview:player,services,candidate,choose,setError};
  const refSummary=refEntry?refEntry[1].references.length+' 段':'',local=localEntry?.[1],localSummary=local?'默认 '+local.fallback.length+' 段 · '+Object.values(local.emotions).filter(p=>p.length).length+' 种差分':'';
  return h('div',{className:'ap-voice-page',role:'region','aria-label':figure.name+'的声音',onKeyDown:e=>{if(e.key==='Escape'&&!e.defaultPrevented){e.preventDefault();e.stopPropagation();onClose();}}},
    // private fork (settings polish, owner 2026-10): the shared sub-page header (‹ 「返回人物」 beside 「声音」).
    h(SubpageHead,{parent:'人物',title:'声音',level:3,titleRef:head,onBack:onClose,className:'ap-voice-head',
      tools:writer.busy>0&&h('span',{className:'ap-voice-saving'},h(ForkSpinner,{key:'saving',label:'正在保存'}))}),
    error&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 ',error),
    // A candidate preview (a list's ▶) that failed says why here too; the saved voice's own failure sits under 试听.
    preview.state?.phase==='error'&&preview.state.key!=='saved:'+figure.id&&h('div',{role:'alert',className:'ap-alert ap-hint-chip ap-voice-error'},'\u26a0 试听失败：',preview.state.error),
    h(VoiceHero,{...common,rows,status,notice,ctx,setNotice}),
    h('div',{className:'ap-voice-ways'},
      // private fork (voice page r2, owner 2026-10): 「声音预设」 — the pack's voices × their 调音预设 as one flat list (pick = done).
      h(VoiceWay,{id:'presets',title:'声音预设',summary:packSummary,open:open==='presets',onToggle:()=>toggle('presets')},h(VoicePresets,{...common,rows,active})),
      // private fork (voice page r2, owner 2026-10): the recommended voices are preset Fish IDs — one 「Fish 声音」 section holds
      // the quick picks and the paste-an-ID / search box together.
      h(VoiceWay,{id:'fish',title:'Fish 声音',summary:recommended.value?.length?'推荐 '+recommended.value.length+' 个':'',current:!!currentFishId,open:open==='fish',onToggle:()=>toggle('fish'),
          help:'推荐的是 Fish 上公开的声音，用前请确认作者允许的用途。'},
        h('div',{className:'ap-voice-fish'},h(VoiceRecommended,{...common,state:recommended,currentId:currentFishId}),h(VoiceFishFinder,{...common,currentId:currentFishId}))),
      h(VoiceWay,{id:'online',title:'在线 TTS',current:active?.kind==='preset',summary:active?.kind==='preset'?providerName(active.provider):'',open:open==='online',onToggle:()=>toggle('online')},h(VoiceOnline,{...common,active})),
      h(VoiceWay,{id:'reference',title:'参考音频',current:active?.kind==='reference-list',summary:refSummary,open:open==='reference',onToggle:()=>toggle('reference')},h(VoiceReferences,{...common,entry:refEntry,clips})),
      h(VoiceWay,{id:'local',title:'本地引擎',current:active?.kind==='emotion-references',summary:localSummary,open:open==='local',onToggle:()=>toggle('local')},h(VoiceLocal,{...common,entry:localEntry,clips,rows}))),
    shared&&h(VoiceSharedDialog,{figure,others:shared.others,onPick:pick=>{shared.resolve(pick);setShared(null);}}));
}
// The current voice — one focal point: its name, how it speaks (⚠ when it cannot), 发声方式 / 语言, and the 试听 line.
function VoiceHero({binding,pack,figure,spec,voice,sourceId,status,preview,rows,writer,notice,setNotice,ctx}) {
  const [renaming,setRenaming]=React.useState(false),language=spec?voice.language||spec.language:'ja',[text,setText]=React.useState(null),[mood,setMood]=React.useState('calm');
  if(!spec)return h('div',{className:'ap-voice-hero is-empty'},h(VoiceDisc,{empty:true}),h('div',{className:'ap-voice-id'},h('strong',{className:'ap-voice-name'},'还没有声音')),
    notice&&h('p',{className:'ap-notice',role:'status'},notice));
  const source=sourceId?spec.sources[sourceId]:null,issue=source?status?.issues?.[0]:null,warn=issue&&voiceIssueText(issue.code,source);
  const users=voiceUsers(pack,voice.voice).filter(f=>f.id!==figure.id),key='saved:'+figure.id,state=preview.of(key),sample=sampleText(language),said=text??sample;
  const openSettings=ctx?.nav?.openTab&&(issue?.code==='SERVICE_REQUIRED'||issue?.code==='CREDENTIALS_REQUIRED')?()=>ctx.nav.openTab('dsh-tts:voice'):null;
  const ways=[...Object.entries(spec.sources).map(([id,s])=>[id,voiceSourceShort(s)]),['off','不配音']],picked=sourceId===null?'off':sourceId;
  const play=()=>preview.play(key,{packId:pack.manifest.id,figureId:figure.id,expectedRevision:pack.revision,...(text!==null&&text.trim()&&text!==sample?{text:text.trim()}:{}),mood},{label:spec.name});
  const menu=h(Popover,{label:'声音操作',className:'ap-voice-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'声音操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
    h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
    h(MenuItem,{onClick:async()=>{close();if(await writer.saveTemplate())setNotice('已存为我的模板「'+spec.name+'」');}},'另存为我的模板'),
    h(MenuItem,{danger:true,onClick:()=>{close();preview.stop();writer.setBinding(null);}},'不用这个声音'))});
  return h('div',{className:'ap-voice-hero'},
    h(VoiceDisc,{playing:state?.phase==='playing'}),
    h('div',{className:'ap-voice-id'},
      h('div',{className:'ap-voice-name-row'},renaming?h(CommitInput,{className:'ap-voice-name-input','aria-label':'声音名称',autoFocus:true,value:spec.name,maxLength:60,validate:v=>v.trim()?'':'名称不能为空',
          onCommit:v=>{setRenaming(false);writer.editVoice(s=>({...s,name:v.trim()}));},onBlur:()=>setRenaming(false)}):h('strong',{className:'ap-voice-name'},spec.name),menu),
      // private fork (voice page r2): no source subtitle (发声方式 below says it); only a shared voice says who else uses it.
      users.length>0&&h('span',{className:'ap-voice-line'},users.map(f=>f.name).join('、')+' 也在用'),
      warn&&h(VoiceWarn,{action:openSettings&&h(Button,{className:'ap-link',onClick:openSettings},'去配置')},warn+'，暂不配音')),
    h('div',{className:'ap-fe-props ap-voice-props',role:'group','aria-label':'声音设置'},
      h(Prop,{label:'发声方式',className:'is-ways'},h(Segmented,{className:'ap-voice-ways-switch',label:'发声方式',value:picked,options:ways,
        onChange:id=>{preview.stop();writer.patchBinding({source:id==='off'?null:id===spec.defaultSource?undefined:id});}})),
      h(Prop,{label:h(React.Fragment,null,'配音语言',h(Help,{text:VOICE_LANGUAGE_HELP,label:'配音语言 说明'})),className:'is-language'},
        h(VoiceLanguagePick,{value:language,defaultValue:spec.language,label:'配音语言',onPick:l=>writer.patchBinding({language:l===spec.language?undefined:l})}),
        source&&!voiceSpeaks(source,language)&&h(VoiceWarn,null,'这个声音不会说'+voiceLanguageName(primaryLanguage(language))))),
    h('div',{className:'ap-voice-try',role:'group','aria-label':'试听'},
      h('input',{className:'ap-voice-try-text','aria-label':'试听台词',value:said,maxLength:200,onChange:e=>setText(e.target.value)}),
      h(VoiceMoodPick,{rows,value:mood,onPick:setMood}),
      h('button',{type:'button',className:'ap-voice-go','aria-pressed':!!state&&state.phase!=='error',disabled:(!source||(!!warn&&!issue?.field)||!binding.tts)&&!(state&&state.phase!=='error'),
          title:!binding.tts?'配音插件未启用':!source?'不配音':warn?'⚠ '+warn:undefined,onClick:play},
        state?.phase==='loading'?h(ForkSpinner,{key:'go'}):h(Glyph,{name:state&&state.phase!=='error'?'stop':'play'}),state&&state.phase!=='error'?'停止':'试听')),
    state?.phase==='error'&&h('p',{className:'ap-voice-try-error',role:'alert'},h(VoiceWarn,null,'试听失败：'+state.error)),
    notice&&h('p',{className:'ap-notice',role:'status'},notice));
}
// (1) 推荐声音: a few Fish voices with name / gender / tone; ▶ previews (free model, billing confirm otherwise), a click uses it.
function VoiceRecommended({pack,figure,preview,candidate,choose,state,currentId}) {
  if(state.error)return h(VoiceLoadError,{error:state.error,retry:state.reload});
  if(!state.value)return h(VoiceLoading);
  if(!state.value.length)return h('p',{className:'ap-voice-empty'},'还没有推荐声音');
  return h('ul',{className:'ap-voice-tiles',role:'list','aria-label':'推荐声音'},state.value.map(v=>{
    const on=v.voiceId===currentId,key='fish:'+v.voiceId,spec=fishVoiceSpec(v,'Fish 声音');
    return h('li',{key:v.voiceId,className:'ap-voice-tile','data-current':on||undefined},
      h('button',{type:'button',className:'ap-voice-tile-main','aria-pressed':on,'aria-label':(on?'正在使用 ':'使用 ')+v.name,title:v.licenseNote||undefined,onClick:()=>{if(!on)choose(spec,v.name);}},
        h('span',{className:'ap-voice-tile-name'},v.name),
        h('span',{className:'ap-voice-tile-meta'},[VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).join(' / ')].filter(Boolean).join(' · ')),
        v.toneTags?.length>0&&h('span',{className:'ap-voice-tile-tags'},v.toneTags.slice(0,4).join(' · ')),
        (on||v.verification?.status==='failed')&&h('span',{className:'ap-voice-tile-marks'},on&&h('span',{className:'ap-voice-current'},'使用中'),
          v.verification?.status==='failed'&&h(VoiceWarn,null,'试合成失败'))),
      h(VoicePlay,{state:preview.of(key),label:'试听「'+v.name+'」',className:'ap-voice-tile-play',onClick:()=>preview.play(key,candidate(spec),{label:v.name})}));
  }));
}
// (2) Fish 声音编号: paste an ID (looked up only when asked; private / unlisted IDs can still be used), or search by name.
function VoiceFishFinder({binding,figure,services,preview,candidate,choose,currentId}) {
  const [query,setQuery]=React.useState(''),[result,setResult]=React.useState(null),[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
  const fish=services.first('fish-audio'),q=query.trim(),idLike=/^[A-Za-z0-9_-]{24,160}$/.test(q)&&!/\s/.test(q);
  async function find(page=1){
    if(!q||busy)return;setBusy(true);setError('');
    try{
      if(idLike){
        if(!fish){setResult({kind:'id',voiceId:q,voice:null,unchecked:true});return;}
        try{setResult({kind:'id',voiceId:q,voice:await voiceTts(binding).call('validateFishVoice',{serviceId:fish.id,voiceId:q})});}
        catch(e){if(voiceCode(e)!=='VOICE_NOT_FOUND')throw e;setResult({kind:'id',voiceId:q,voice:null,missing:true});}
      }else{
        if(!fish)throw voiceFailure('SERVICE_REQUIRED');
        const r=await voiceTts(binding).call('searchFishVoices',{serviceId:fish.id,query:q,page});
        setResult(prev=>({kind:'search',query:q,page:r.page,hasMore:!!r.hasMore,windowLimited:!!r.windowLimited,voices:page>1&&prev?.kind==='search'?[...prev.voices,...(r.voices||[])]:r.voices||[]}));
      }
    }catch(e){setError(voiceCode(e)==='SERVICE_REQUIRED'?'还没有配置 Fish Audio 服务，不能搜索':voiceErrorText(e));}finally{setBusy(false);}
  }
  const row=(v,i)=>{const id=v.voiceId,key='fish:'+id,spec=fishVoiceSpec(v,figure.name+'的声音'),on=id===currentId;
    return h(VoiceRow,{key:id+':'+i,name:v.name||'Fish 声音',meta:[VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).join(' / ')].filter(Boolean).join(' · '),tags:(v.toneTags||[]).slice(0,3).join(' · '),current:on,title:v.licenseNote||undefined,
      play:h(VoicePlay,{state:preview.of(key),label:'试听「'+(v.name||'Fish 声音')+'」',onClick:()=>preview.play(key,candidate(spec),{label:v.name||'Fish 声音'})}),onUse:()=>choose(spec,spec.name)});};
  const bare={voiceId:q,name:'',languages:[]};
  return h('div',{className:'ap-voice-finder'},
    h('div',{className:'ap-voice-search',role:'search'},
      h(ForkSearchBox,{bare:true,label:'Fish 声音编号或名字',value:query,placeholder:'粘贴声音编号，或输入名字搜索',spellCheck:false,onChange:v=>{setQuery(v);setError('');},onKeyDown:e=>{if(e.key==='Enter'){e.preventDefault();find();}}}),
      h(Button,{className:'ap-chip-button ap-voice-find',disabled:!q||busy,onClick:()=>find()},busy?h(ForkSpinner,{key:'find'}):h(Glyph,{name:'search'}),idLike?'查找编号':'搜索')),
    !fish&&services.loaded&&h(VoiceWarn,null,'还没有配置 Fish Audio 服务：编号可以直接使用，但不能查找'),
    error&&h(VoiceLoadError,{error}),
    // validateFishVoice already sees the account's private / unlisted voices: not found means this ID cannot speak.
    result?.kind==='id'&&(result.missing?h('p',{className:'ap-voice-line-warn',role:'alert'},h(VoiceWarn,null,'没有找到这个编号，请检查是否复制完整')):
      h('ul',{className:'ap-voice-rows'},result.voice?row(result.voice,0):
        h(VoiceRow,{name:'Fish 声音',meta:'还没有配置 Fish Audio 服务，暂时不能核对这个编号',onUse:()=>choose(fishVoiceSpec({...bare,voiceId:result.voiceId},figure.name+'的声音'),figure.name+'的声音')}))),
    result?.kind==='search'&&(result.voices.length?h(React.Fragment,null,h('ul',{className:'ap-voice-rows'},result.voices.map(row)),
        result.hasMore?h(Button,{className:'ap-link ap-voice-more',disabled:busy,onClick:()=>find(result.page+1)},'更多'):result.windowLimited&&h('p',{className:'ap-voice-empty'},'只能看到前面的结果，换个关键词试试')):
      h('p',{className:'ap-voice-empty'},'没有找到相关声音')));
}
// (3) 在线声音: provider + one of its named voices (built-in catalogue until the service is configured).
function VoiceOnline({binding,figure,services,preview,candidate,choose,active}) {
  const [provider,setProvider]=React.useState(active?.kind==='preset'&&active.provider==='azure'?'azure':'qwen'),[filter,setFilter]=React.useState(''),[lang,setLang]=React.useState('all'),[model,setModel]=React.useState(active?.model||''),[all,setAll]=React.useState(false);
  const service=services.first(provider),name=providerName(provider);
  const [inspectedVoice,setInspectedVoice]=React.useState('');
  const modelStatus=useVoiceModelStatus(binding,{provider,model,voiceName:inspectedVoice||(active?.provider===provider?active.voiceName:'')},preview.state?.phase);
  const state=useVoiceLoad(()=>voiceTts(binding).call('listOnlinePresetVoices',{provider,...(service?{serviceId:service.id}:{})}),[binding,provider,service?.id]);
  const voices=state.value?.voices||[],models=(state.value?.models||[]).map(m=>typeof m==='string'?{id:m,label:m}:{id:m.id,label:m.label||m.id});
  const needle=filter.trim().toLowerCase(),shown=voices.filter(v=>(lang==='all'||(v.languages||[]).some(l=>String(l).split('-')[0]===lang))&&(!needle||[v.label,v.id,...(v.styles||[])].some(x=>String(x||'').toLowerCase().includes(needle))));
  const spec=v=>({name:v.label||v.id,language:pickVoiceLanguage(v.languages,figure.voice?'ja':'zh'),defaultSource:provider,sources:{[provider]:{kind:'preset',provider,voiceName:v.id,...(model?{model}:{})}}});
  const on=v=>active?.kind==='preset'&&active.provider===provider&&active.voiceName===v.id;
  const pick=p=>{setProvider(p);setFilter('');setLang('all');setModel('');setAll(false);};
  return h('div',{className:'ap-voice-online'},
    h('div',{className:'ap-voice-tools'},
      h(Segmented,{label:'在线服务',value:provider,onChange:pick,options:[['qwen','通义千问'],['azure','Azure']]}),
      provider==='qwen'&&models.length>0&&h(Popover,{label:'通义千问型号',className:'ap-voice-model-anchor',trigger:({toggle,open})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick','aria-label':'型号：'+(model||'服务默认'),'aria-expanded':open,onClick:toggle},h('span',null,model?models.find(m=>m.id===model)?.label||model:'服务默认型号'),h(Glyph,{name:'chevDown'})),
        content:close=>[{id:'',label:'服务默认型号'},...models].map(m=>h('button',{key:m.id||'default',type:'button',role:'menuitemradio','aria-checked':model===m.id,className:'ap-menu-item',onClick:()=>{close();setModel(m.id);}},h('span',null,m.label),model===m.id&&h('span',{className:'ap-state-check'},h(Glyph,{name:'check'}))))}),
      h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'model'}),
      voices.length>12&&h(ForkSearchBox,{bare:true,inputClassName:'ap-voice-filter',label:'筛选'+name+'声音',value:filter,placeholder:'筛选',onChange:v=>{setFilter(v);setAll(false);}}),
      voices.length>12&&h(Segmented,{className:'ap-voice-langs',label:'按语言筛选',value:lang,onChange:id=>{setLang(id);setAll(false);},options:[['all','全部'],['zh','中文'],['ja','日语'],['en','英语']]})),
    services.loaded&&!service&&h(VoiceWarn,null,'还没有配置'+spacedName(name)+'服务；选中的声音暂不配音'),
    state.value?.status==='credentials-required'&&service&&h(VoiceWarn,null,'缺少'+spacedName(name)+'密钥；选中的声音暂不配音'),
    state.error?h(VoiceLoadError,{error:state.error,retry:state.reload}):!state.value?h(VoiceLoading):!shown.length?h('p',{className:'ap-voice-empty'},voices.length?'没有符合的声音':'这个服务没有可选的声音'):
      h(React.Fragment,null,h('ul',{className:'ap-voice-rows'},(all?shown:shown.slice(0,30)).map(v=>{const key=provider+':'+v.id+':'+model;
        return h(VoiceRow,{key:v.id,name:v.label||v.id,warn:(inspectedVoice||active?.voiceName)===v.id&&h(VoiceConfirmedWarning,{issues:modelStatus.value?.issues,field:'voice'}),meta:[VOICE_GENDERS[v.gender],(v.languages||[]).map(voiceLanguageName).filter((x,i,a)=>a.indexOf(x)===i).slice(0,3).join(' / ')].filter(Boolean).join(' · '),tags:v.styles?.length?v.styles.length+' 种风格':'',current:on(v),
          play:h(VoicePlay,{state:preview.of(key),label:'试听「'+(v.label||v.id)+'」',onClick:()=>{setInspectedVoice(v.id);preview.play(key,candidate(spec(v)),{label:v.label||v.id});}}),onUse:()=>choose(spec(v),v.label||v.id)});})),
        !all&&shown.length>30&&h(Button,{className:'ap-link ap-voice-more',onClick:()=>setAll(true)},'显示全部 '+shown.length+' 个')));
}
// One reference clip: № · ▶ original · what it says · language · length / size · ⋯ (上移 / 下移 / 删除). Alt+↑/↓ moves it.
function VoiceClipRow({index,count,clip,size,duration,playing,onPlay,onEdit,onMove,onRemove,removable,reorder}) {
  const no=index+1,on=playing==='playing'||playing==='loading';
  return h('li',{className:'ap-clip',onKeyDown:e=>{if(reorder&&e.altKey&&(e.key==='ArrowUp'||e.key==='ArrowDown')){e.preventDefault();onMove(e.key==='ArrowUp'?-1:1);}}},
    h('span',{className:'ap-clip-no','aria-hidden':true},String(no).padStart(2,'0')),
    h('button',{type:'button',className:'ap-icon-button ap-clip-play','aria-label':(on?'停止':'播放')+'第 '+no+' 段原音','aria-pressed':on,'data-state':playing||undefined,onClick:onPlay},playing==='loading'?h(ForkSpinner,{key:'clip'}):h(Glyph,{name:on?'stop':'play'})),
    h(CommitInput,{className:'ap-clip-text','aria-label':'第 '+no+' 段原文',value:clip.text,placeholder:'填写这段音频说的话',maxLength:1500,onCommit:v=>onEdit({text:v.trim()})}),
    h(VoiceLanguagePick,{value:clip.language,label:'第 '+no+' 段语言',className:'ap-clip-lang',onPick:language=>onEdit({language})}),
    h('span',{className:'ap-clip-meta'},[voiceSeconds(duration),voiceBytes(size)].filter(Boolean).join(' · ')),
    h(Popover,{label:'第 '+no+' 段操作',className:'ap-clip-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'第 '+no+' 段操作','aria-expanded':open,onClick:toggle}),content:close=>h(React.Fragment,null,
      reorder&&h(MenuItem,{disabled:index===0,onClick:()=>{close();onMove(-1);}},'上移'),reorder&&h(MenuItem,{disabled:index===count-1,onClick:()=>{close();onMove(1);}},'下移'),
      h(MenuItem,{danger:true,disabled:!removable,title:removable?undefined:'至少保留一段；不需要时可以换一种声音',onClick:()=>{close();onRemove();}},'删除'))}));
}
const clipDurations=new Map();
function useClipDurations(binding,packId,hashes){
  const [,bump]=React.useState(0),key=hashes.join(',');
  React.useEffect(()=>{
    let live=true;if(typeof Audio==='undefined'||!binding.previewMedia)return;
    const todo=[...new Set(hashes)].filter(hash=>!clipDurations.has(packId+'/'+hash)).slice(0,60);
    (async()=>{for(const hash of todo){
      if(!live)return;const k=packId+'/'+hash;clipDurations.set(k,null);
      try{const media=await leaseMedia(binding,{packId,hash});
        try{const seconds=await new Promise((resolve,reject)=>{const a=new Audio(),t=setTimeout(()=>reject(new Error('timeout')),5000);a.preload='metadata';a.onloadedmetadata=()=>{clearTimeout(t);resolve(a.duration);};a.onerror=()=>{clearTimeout(t);reject(new Error('audio'));};a.src=media.url;});
          if(Number.isFinite(seconds))clipDurations.set(k,seconds);}finally{media.release();}}
      catch(_){clipDurations.delete(k);}
      if(live)bump(n=>n+1);}})();
    return()=>{live=false;};
  },[binding,packId,key]);
  return hashes.map(hash=>clipDurations.get(packId+'/'+hash)??null);
}
// An ordered clip list (Fish) or a pool (local) with its dashed ＋ upload tile at the end.
function VoiceClipList({binding,pack,refs,label,clips,preview,onChange,onAdd,reorder=true,minimum=0,disabled}) {
  const packId=pack.manifest.id,durations=useClipDurations(binding,packId,refs.map(r=>r.media)),sizes=refs.map(r=>pack.manifest.blobs?.[r.media]?.size);
  const total=sizes.reduce((n,s)=>n+(s||0),0),seconds=durations.every(Number.isFinite)&&refs.length?durations.reduce((n,s)=>n+s,0):null;
  const edit=(i,patch)=>onChange(refs.map((r,j)=>j===i?{...r,...patch}:r));
  const move=(i,d)=>{const j=i+d;if(j<0||j>=refs.length)return;const next=[...refs];[next[i],next[j]]=[next[j],next[i]];onChange(next);};
  return h('div',{className:'ap-clips-wrap'},
    refs.length>0&&h('p',{className:'ap-clips-sum'},[refs.length+' 段',voiceSeconds(seconds),voiceBytes(total)].filter(Boolean).join(' · ')),
    h('ol',{className:'ap-clips','aria-label':label},
      refs.map((r,i)=>{const id='ref'+i+'/'+r.media,state=clips.state?.id==='voice-ref/'+id?clips.state.status:null;
        return h(VoiceClipRow,{key:i+':'+r.media,index:i,count:refs.length,clip:r,size:sizes[i],duration:durations[i],playing:state,reorder,removable:refs.length>minimum,
          onPlay:()=>{preview.stop();clips.toggle({kind:'voice-ref',id,media:r.media,name:''});},onEdit:patch=>edit(i,patch),onMove:d=>move(i,d),onRemove:()=>onChange(refs.filter((_,j)=>j!==i))});}),
      h('li',{className:'ap-clip-add-row'},h('label',{className:'ap-clip-add','data-disabled':disabled||undefined,title:'添加'+label},h(Glyph,{name:'plus'}),
        h('input',{type:'file',multiple:true,accept:VOICE_CLIP_ACCEPT,'aria-label':'添加'+label,disabled,onChange:e=>{const files=[...(e.target.files||[])];e.target.value='';if(files.length)onAdd(files);}})))));
}
// (4) 参考音频: Fish's ordered reference list — the whole list, in this order, is sent with every line.
function VoiceReferences({binding,pack,figure,spec,voice,sourceId,writer,preview,entry,clips}) {
  const [sid,source]=entry||[],language=voice?.language||spec?.language||'ja',active=!!sid&&sid===sourceId;
  const add=files=>writer.addClips(files,{language,create:refs=>({name:figure.name+'的声音',language,defaultSource:'fish',sources:{fish:{kind:'reference-list',provider:'fish-audio',references:refs}}}),
    place:(s,refs)=>{const found=Object.entries(s.sources).find(([,x])=>x.kind==='reference-list');if(found)found[1].references=[...found[1].references,...refs];else s.sources[freeSourceId(s,'fish','reference')]={kind:'reference-list',provider:'fish-audio',references:refs};}});
  return h('div',{className:'ap-voice-refs'},
    h('div',{className:'ap-voice-tools'},h('span',{className:'ap-voice-tools-label'},'Fish 参考音频',h(Help,{text:'每句台词都会按这个顺序带上全部参考音频，总共 90 秒左右的 WAV 或 MP3 效果最好。',label:'参考音频 说明'})),
      sid&&!active&&h(Button,{className:'ap-chip-button is-accent',onClick:()=>writer.patchBinding({source:sid===spec.defaultSource?undefined:sid})},'用参考音频发声')),
    h(VoiceClipList,{binding,pack,refs:source?.references||[],label:'参考音频',clips,preview,minimum:1,disabled:writer.busy>0,onAdd:add,
      onChange:next=>writer.editVoice(s=>{s.sources[sid].references=next;return s;})}));
}
// (5) 本地引擎: a model of this computer + reference pools — 默认 and one per emotion (one clip = fixed; several = a pool).
function VoiceLocal({binding,pack,figure,spec,voice,sourceId,writer,preview,services,entry,clips,rows}) {
  const [sid,source]=entry||[],[slot,setSlot]=React.useState('default'),language=voice?.language||spec?.language||'ja',active=!!sid&&sid===sourceId;
  const models=services.local.flatMap(s=>(s.capabilities.modelRequirements||[]).map(model=>({model,limit:s.capabilities.referenceLimits?.bytes})));
  const limit=models.find(m=>sameVoiceModel(m.model,source?.model))?.limit||models[0]?.limit||8*1024*1024;
  const useModel=model=>{const local={kind:'emotion-references',provider:'local',engine:model.engine,model,selection:'stable-random',fallback:[],emotions:{}};
    return spec?writer.editVoice(s=>{s.sources[freeSourceId(s,'local')]=local;return s;}):writer.createVoice({name:figure.name+'的声音',language,defaultSource:'local',sources:{local}});};
  if(!source){
    if(!services.loaded)return h(VoiceLoading);
    if(!services.local.length)return h(VoiceWarn,null,'这台电脑没有本地引擎');
    if(!models.length)return h(VoiceWarn,null,'本地引擎里还没有可用的模型');
    return h('div',{className:'ap-voice-local'},h('ul',{className:'ap-voice-rows','aria-label':'本地模型'},models.map((m,i)=>h(VoiceRow,{key:i,name:modelLabel(m.model,i,models.map(x=>x.model)),meta:'已安装',useLabel:'用这个模型',onUse:()=>useModel(m.model)}))));
  }
  const installed=models.some(m=>sameVoiceModel(m.model,source.model)),pools=[{id:'default',label:'默认',color:'var(--fork-ink-2)'},...rows];
  const refs=slot==='default'?source.fallback:source.emotions[slot]||[],row=pools.find(p=>p.id===slot)||pools[0];
  const setPool=next=>writer.editVoice(s=>{const src=s.sources[sid];if(slot==='default')src.fallback=next;else if(next.length)src.emotions[slot]=next;else delete src.emotions[slot];return s;});
  const addToPool=files=>{const target=slot;return writer.addClips(files,{language,limit,place:(s,refs)=>{const src=s.sources[sid];if(target==='default')src.fallback=[...src.fallback,...refs];else src.emotions[target]=[...(src.emotions[target]||[]),...refs];}});};
  return h('div',{className:'ap-voice-local'},
    h('div',{className:'ap-voice-tools'},h('span',{className:'ap-voice-tools-label'},modelLabel(source.model,0,[source.model]),
        h(Help,{text:'每种差分可以放一段或几段参考音频，几段时每句随机选一段，没放的用「默认」。',label:'本地引擎 说明'})),
      installed?h('span',{className:'ap-tag'},'已安装'):h(VoiceWarn,null,'这台电脑没有这个模型'),
      !active&&h(Button,{className:'ap-chip-button is-accent',onClick:()=>writer.patchBinding({source:sid===spec.defaultSource?undefined:sid})},'用本地引擎发声')),
    h('div',{className:'ap-voice-slots',role:'radiogroup','aria-label':'参考音频分组'},pools.map(p=>{const n=(p.id==='default'?source.fallback:source.emotions[p.id]||[]).length;
      return h('button',{key:p.id,type:'button',role:'radio','aria-checked':slot===p.id,className:'ap-voice-slot','data-empty':!n||undefined,
        'aria-label':p.label+(n?' '+n+' 段':p.id==='default'?' 还没有参考音频':' 用默认'),title:n?p.label+' · '+n+' 段':p.id==='default'?'默认：还没有参考音频':p.label+'：没有自己的参考，用默认',onClick:()=>setSlot(p.id)},
        h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',null,p.label),n>0&&h('span',{className:'ap-voice-slot-n'},n+' 段'));})),
    slot==='default'&&!source.fallback.length&&h(VoiceWarn,null,'「默认」还没有参考音频，没有自己参考的差分不能发声'),
    h(VoiceClipList,{key:slot,binding,pack,refs,label:row.label+'参考音频',clips,preview,reorder:false,disabled:writer.busy>0,onAdd:addToPool,onChange:setPool}));
}
// private fork (UI standard §三.8, phase 2 batch 4): the shared ForkSlider; double click returns to the voice's own value.
function TuneSlider({def,value,label,onCommit}) {
  return h(ForkSlider,{className:'ap-tune',label,min:def.min,max:def.max,step:def.step,value,reset:def.base,valueText:v=>tuneText(def,v),output:v=>tuneText(def,v),outputClassName:'ap-tune-value',onCommit});
}
// 声音预设: every voice × 调音预设 of this pack as one flat list of tiles («店员（Azure） · 原声»). A click uses it (same voice:
// only the binding's variant; another voice: the figure shares it). The figure's own preset carries ⋯ (调整参数 / 重命名 /
// 删除); the dashed ＋ saves the current settings as a new preset of the current voice. 按差分调音 maps emotions to presets of
// the same voice (the v4 binding's emotionVariants). 我的模板 (this computer, copied into the pack on use) close the section.
function VoicePresets({binding,pack,figure,spec,voice,sourceId,writer,rows,active,setError}) {
  const library=pack.manifest.voiceLibrary?.voices||{},currentVoice=voice?.voice||null,currentPreset=voice?.variant||'normal';
  const [editing,setEditing]=React.useState(false),[renaming,setRenaming]=React.useState(false),[byMood,setByMood]=React.useState(!!voice?.emotionVariants),[removing,setRemoving]=React.useState(null);
  const templates=useVoiceLoad(()=>binding.service?.listVoiceTemplates?binding.service.listVoiceTemplates({}).then(r=>r.templates||[]):[],[binding]);
  const describe=s=>{const src=s?.sources?.[s.defaultSource];return src?voiceSourceShort(src):'';};
  const entries=[];
  // The figure's own voice first, then the others in library order; inside a voice: 原声, then the author's presets.
  for(const [id,s] of Object.entries(library).sort(([a],[b])=>(b===currentVoice)-(a===currentVoice)))
    for(const pid of Object.keys(voicePresets(s)))entries.push({voiceId:id,presetId:pid,spec:s,name:s.name+' · '+presetName(s,pid),current:id===currentVoice&&pid===currentPreset});
  const pick=e=>{if(e.current)return;setEditing(false);setRenaming(false);
    return e.voiceId===currentVoice?writer.patchBinding({variant:e.presetId==='normal'?undefined:e.presetId}):writer.setBinding({voice:e.voiceId,...(e.presetId==='normal'?{}:{variant:e.presetId})});};
  const save=(id,next)=>writer.editVoice(s=>{s.variants={...(s.variants||{}),[id]:next};return s;},{id});
  const own=spec?voicePresets(spec)[currentPreset]||voicePresets(spec).normal:null;
  const add=async()=>{const id='t'+Date.now().toString(36),n=Object.keys(spec.variants||{}).filter(k=>k!=='normal').length+1;
    if(await save(id,{name:'预设 '+n,...(own.tuning?{tuning:structuredClone(own.tuning)}:{})})){await writer.patchBinding({variant:id});setEditing(true);setRenaming(true);}};
  const rename=v=>{setRenaming(false);const base=currentPreset==='normal'?(spec.variants?.normal||{}):spec.variants[currentPreset];save(currentPreset,{...base,name:v.trim()});};
  const remove=async t=>{try{await binding.service.deleteVoiceTemplate({templateId:t.templateId,expectedRevision:t.revision});templates.reload();}catch(e){setError(voiceErrorText(e));}};
  const presetNames=spec?Object.keys(voicePresets(spec)):[];
  return h('div',{className:'ap-voice-presets-wrap'},
    entries.length?h('ul',{className:'ap-voice-tiles ap-voice-presets',role:'radiogroup','aria-label':'声音预设'},
      entries.map(e=>{const users=voiceUsers(pack,e.voiceId).filter(f=>f.id!==figure.id&&(f.voice.variant||'normal')===e.presetId).map(f=>f.name);
        return h('li',{key:e.voiceId+'/'+e.presetId,className:'ap-voice-tile ap-voice-preset','data-current':e.current||undefined},
          e.current&&renaming?h('div',{className:'ap-voice-preset-rename'},h('span',{className:'ap-voice-tile-name'},e.spec.name+' ·'),
            h(CommitInput,{className:'ap-voice-preset-name-input','aria-label':'预设名称',autoFocus:true,value:presetName(e.spec,e.presetId),maxLength:20,validate:v=>v.trim()?'':'名称不能为空',onCommit:rename,onBlur:()=>setRenaming(false)})):
          h('button',{type:'button',role:'radio','aria-checked':e.current,'aria-label':e.name,className:'ap-voice-tile-main',onClick:()=>pick(e)},
            h('span',{className:'ap-voice-tile-name'},e.name),
            h('span',{className:'ap-voice-tile-meta'},[describe(e.spec),users.length?users.join('、')+' 在用':''].filter(Boolean).join(' · ')),
            e.current&&h('span',{className:'ap-voice-tile-marks'},h('span',{className:'ap-voice-current'},'使用中'))),
          e.current&&!renaming&&h(Popover,{label:'预设操作',className:'ap-voice-tile-menu',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'预设操作 '+e.name,'aria-expanded':open,onClick:toggle}),
            content:close=>h(React.Fragment,null,h(MenuItem,{onClick:()=>{close();setEditing(v=>!v);}},editing?'收起参数':'调整参数'),h(MenuItem,{onClick:()=>{close();setRenaming(true);}},'重命名'),
              h(MenuItem,{danger:true,disabled:e.presetId==='normal',title:e.presetId==='normal'?'原声不能删除':undefined,onClick:()=>{close();setEditing(false);writer.deleteVariant(e.presetId);}},'删除'))}));}),
      spec&&h('li',{className:'ap-voice-preset-add-row'},h('button',{type:'button',className:'ap-voice-preset-add','aria-label':'把当前设置存为新预设',title:'把当前设置存为新预设',onClick:add},h(Glyph,{name:'plus'})))):
      h('p',{className:'ap-voice-empty'},'本包里还没有声音'),
    spec&&editing&&h(VoicePresetParams,{binding,spec,voice,sourceId,active,save,preset:currentPreset}),
    spec&&h('div',{className:'ap-voice-bymood'},
      h('button',{type:'button',className:'ap-voice-subhead','aria-expanded':byMood,onClick:()=>setByMood(v=>!v)},h('span',null,'按差分调音'),h('span',{className:'ap-voice-way-sum'},voice.emotionVariants?Object.keys(voice.emotionVariants).length+' 种差分':''),h(Glyph,{name:'chevDown'})),
      byMood&&h('ul',{className:'ap-voice-moods','aria-label':'按差分调音'},rows.map(r=>{const value=voice.emotionVariants?.[r.id]||'';
        return h('li',{key:r.id,className:'ap-voice-mood-row'},h('span',{className:'ap-voice-dot','aria-hidden':true}),h('span',{className:'ap-voice-mood-name'},r.label),
          h(Popover,{label:r.label+'调音',trigger:({toggle,open:o})=>h('button',{type:'button',className:'ap-pick-pill ap-quiet-pick','aria-label':r.label+'调音：'+(value?presetName(spec,value):'跟随默认'),'aria-expanded':o,onClick:toggle},h('span',null,value?presetName(spec,value):'跟随默认'),h(Glyph,{name:'chevDown'})),
            content:close=>[['','跟随默认'],...presetNames.map(id=>[id,presetName(spec,id)])].map(([id,label])=>h('button',{key:id||'follow',type:'button',role:'menuitemradio','aria-checked':value===id,className:'ap-menu-item',
              onClick:()=>{close();if(value===id)return;const map={...(voice.emotionVariants||{})};if(id)map[r.id]=id;else delete map[r.id];writer.patchBinding({emotionVariants:Object.keys(map).length?map:undefined});}},label))}));}))),
    h('h5',{className:'ap-voice-group'},'我的模板',h(Help,{text:'模板存在这台电脑上，选用时整套复制进素材包，之后改模板不影响素材包。',label:'我的模板 说明'})),
    templates.error&&!templates.value?h(VoiceLoadError,{error:templates.error,retry:templates.reload}):!templates.value?h(VoiceLoading):
      (templates.value||[]).length?h('ul',{className:'ap-voice-rows'},templates.value.map(t=>h(VoiceRow,{key:'t:'+t.templateId,name:t.name,meta:t.voiceSpec?.sources?.[t.voiceSpec.defaultSource]?voiceSourceLabel(t.voiceSpec.sources[t.voiceSpec.defaultSource]):'',useLabel:'复制使用',onUse:()=>writer.assignTemplate(t),
        menu:h(Popover,{label:'模板操作',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'模板操作 '+t.name,'aria-expanded':open,onClick:toggle}),content:close=>h(MenuItem,{danger:true,onClick:()=>{close();setRemoving(t);}},'删除模板')})}))):
      h('p',{className:'ap-voice-empty'},'还没有模板'),
    removing&&h(ConfirmDialog,{title:'删除模板「'+removing.name+'」？',body:'只删除这台电脑上的模板；已经用过它的素材包不受影响。',confirmLabel:'删除',danger:true,onConfirm:()=>remove(removing),onClose:()=>setRemoving(null)}));
}
// The figure's preset parameters (⋯ → 调整参数): the current 发声方式's own (Fish: 语速; Azure: 语速 / 音高 / 风格; Qwen: 风格指令).
function VoicePresetParams({binding,spec,sourceId,active,save,preset}) {
  const sid=sourceId??spec.defaultSource,source=active||spec.sources[sid],variant=voicePresets(spec)[preset]||voicePresets(spec).normal,tuning=variant.tuning?.[sid]||{},name=presetName(spec,preset);
  const defs=VOICE_TUNING[source.provider]||[];
  const azure=useVoiceLoad(()=>source.provider==='azure'&&binding.tts?.call?binding.tts.call('listOnlinePresetVoices',{provider:'azure'}):null,[binding,source.provider]);
  const styles=azure.value?.voices?.find(v=>v.id===source.voiceName)?.styles||[];
  const setParam=(key,value)=>{const t={...(variant.tuning||{})},own={...(t[sid]||{})};if(value===null||value===''||value===undefined)delete own[key];else own[key]=value;if(Object.keys(own).length)t[sid]=own;else delete t[sid];
    const next={...(preset==='normal'?(spec.variants?.normal||{}):spec.variants[preset])};if(Object.keys(t).length)next.tuning=t;else delete next.tuning;if(preset==='normal'&&!next.name)next.name='原声';return save(preset,next);};
  const modelStatus=useVoiceModelStatus(binding,source);
  const instruct=modelStatus.value?.modelInstructions!==false;
  const control=def=>{
    // private fork (inline-field sweep, owner 2026-10): 风格指令 and 风格 are inline fields (value read as text, edited in place).
    if(def.kind==='text')return instruct?h(ForkInlineField,{key:def.key,kind:'text',label:def.label,wide:true,className:'ap-voice-instructions',value:tuning[def.key]||'',placeholder:'例：语气轻快，带一点撒娇',maxLength:200,onCommit:v=>setParam(def.key,v)}):
      h(Prop,{key:def.key,label:def.label,className:'is-wide'},h('span',{className:'ap-voice-na'},'未使用',h(Help,{text:'当前型号不支持风格或情绪指令，已保存的指令不会发送。',label:'风格指令未使用说明'})));
    if(def.kind==='style')return styles.length?h(ForkInlineField,{key:def.key,kind:'menu',label:def.label,controlLabel:'风格',value:tuning.style||'',options:['',...styles].map(st=>({value:st,label:st||'默认'})),onCommit:st=>setParam('style',st||null)}):null;
    return h(Prop,{key:def.key,label:def.label,className:'is-tune'},h(TuneSlider,{def,value:Number.isFinite(tuning[def.key])?tuning[def.key]:def.base,label:name+def.label,onCommit:v=>setParam(def.key,v===def.base?null:v)}));
  };
  return h('div',{className:'ap-fe-props ap-voice-tune-props',role:'group','aria-label':name+'的参数'},
    defs.map(control),
    !defs.some(d=>d.key==='pitch')&&h(Prop,{label:'音高'},h('span',{className:'ap-voice-na',title:voiceSourceShort(source)+' 不能调音高'},'这种发声方式不支持')),
    !defs.length&&h(Prop,{label:'参数'},h('span',{className:'ap-voice-na'},'这种发声方式使用原声参数')));
}