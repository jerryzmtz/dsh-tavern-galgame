  // private fork (asset-gen, owner 2026-10; gen-ui r12, owner 2026-10-15 — output/gen-ui-mock, DECISIONS U1–U4): in-app
  // asset generation against docs/fork/asset-gen-contract.md; design and copy in docs/fork/asset-gen-ui.md. A picture is
  // made where it goes: a 差分 tile's menu (生成… / 重画… / 改图…) opens the ONE generation dialog (GenDialog; the 生图 page
  // opens the same), and the request then runs in the tile itself (a ring and the time, 排队, 待采用, ⚠). 「生成缺失立绘」
  // sends one request per empty 差分 with that 差分's default prompt and no dialog. Generation draws from the 设定图 or the
  // 设定文字 (外貌 + 服装描述), never from 平和 (平和 only stays the ruler an adopted 立绘 is aligned to). Nothing loops,
  // retries or refills in the background, and nothing here talks about money. The pack modal owns one controller
  // (useAssetGen); nothing is read from the backend until a 生图 surface opens.
  const GEN_POLL_MS=1500,GEN_PARALLEL=4,GEN_REF_LIMIT=4,GEN_REF_BYTES=8*1024*1024;
  // ⚠ chips: a short label per deterministic check; the backend sentence is the tooltip.
  const GEN_WARNINGS={NO_TRANSPARENCY:'没有透明背景',EDGE_CONTACT:'人物碰到边缘',CELL_EDGE_CONTACT:'碰到格子边缘',ASPECT_MISMATCH:'比例不对',LOW_RESOLUTION:'分辨率偏低',
    EMPTY_IMAGE:'图是空的',CHECK_UNAVAILABLE:'无法自动检查',SHEET_UNSLICEABLE:'不能自动切分'};
  // The host has no API that opens a settings section, so the way there is written out once.
  const GEN_PROBLEMS={UNSUPPORTED_CHANNEL:'当前生图渠道不能生成素材 · 设置 → 场景生图 → 接口格式选 Responses image tool',NOT_CONFIGURED:'还没配置生图渠道 · 设置 → 场景生图'};
  // An earlier request of the same slot never answered: the next one asks first (the backend's confirmNewRequestIds gate).
  const GEN_UNCERTAIN='上一次请求没有返回结果，不会自动重试。仍要再生成一张吗？';
  const GEN_POSE_ROLE='User pose reference: borrow only the pose and expression idea, never the face or outfit';
  const GEN_ART_ROLE='User artwork of this character: authority for identity, outfit and style';
  const GEN_CURRENT_ROLE='Current picture of this slot: may keep its composition and pose; the settei stays the authority for identity and outfit';
  const GEN_BASE_ROLE='Base image to edit: keep identity, outfit, pose, framing and background exactly; change only what the user notes ask for';
  const GEN_REASONS={layered:'这个差分是动态立绘（会动嘴、眨眼），不能直接换成生成的图：先在差分格子的菜单里删除它',avatar:'先有这个差分的立绘，才能生成它的头像',
    sheet:'先有首个差分立绘或设定图，才能一次生成八个头像',avatars:'缺头像的差分还没有立绘：先有立绘，才能生成头像',basis:'还没有设定：先写外貌或服装描述，或准备一张设定图',edit:'先写想改哪里',busy:'这一格正在生成'};
  // private fork (owner 2026-10-16 「生成缺失头像」): the eight base faces of the eight-face sheet, in its layout order (key,
  // shared name). The sheet is used only when every one of them is a declared 差分 still missing its 头像.
  const GEN_SHEET_FACES=[['joy','喜悦'],['anger','愤怒'],['sad','悲伤'],['anxious','紧张'],['calm','平和'],['shy','害羞'],['disgust','嫌弃'],['love','爱恋']];
  // The shared confirmation gate (image-billing-confirmation.js, also scene illustration's) words its refusal for that page;
  // here it only means the earlier request needs confirming first (owner 2026-10-15: no money talk in 生图).
  const genError=e=>e?.code==='BILLING_CONFIRMATION_REQUIRED'?'上一次请求没有返回结果，请确认后再生成':errorText(e);
  const genKey=t=>t.kind==='background'?'background/'+(t.assetId||''):[t.kind,t.figureId,t.outfitKey,t.emotionId||''].join('/');
  const genShown=job=>['running','candidate','save_failed','failed'].includes(job?.status);
  const genSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function genBytes(base64){const s=atob(base64),out=new Uint8Array(s.length);for(let i=0;i<s.length;i++)out[i]=s.charCodeAt(i);return out;}
  function genBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));return btoa(s);}
  // The slot a generation writes, by the backend's own rule: the emotion's own sprite state (平和 → default), its own avatar.
  function genOwnSprite(outfit,manifest,id){
    // private fork (figure quick fixes): read through the sprite's view (hybrid / flat / layered alike), as the backend does.
    const state=outfit?.sprite&&manifest?emotionState(outfit,manifest,id):null,src=state?.stage?.src||state?.src;
    return src?outfit.sprite.assets?.[src]||null:null;
  }
  const genDefaultId=(figure,outfit)=>outfit?.defaultEmotion??figure?.emotions?.[0]?.id;
  const genSaid=v=>!!String(v||'').trim();
  // What a generation draws from: a picture (the outfit 设定图 or the figure's identity board), else the 设定文字 (外貌 /
  // 服装描述), else nothing yet — then 生成 waits for one (the tile menu offers the ways to make it).
  function genBasis(figure,outfit){return outfit?.settei||figure?.identitySettei?'image':genSaid(figure?.identityAppearance)||genSaid(outfit?.outfitAppearance)?'text':'';}
  // The prompt a 差分 starts from: its name and 使用情景; a cell's 「存为默认」 (outfit.genPrompts, owner U4) replaces it for
  // that figure × outfit × 差分 only. The shared fixed layer (template) is edited in 设置 → 生图 (GenPromptSettings).
  const genBuiltPrompt=row=>row?row.label+'的表情'+(genSaid(row.guidance)?'，'+row.guidance.trim():'')+'。':'';
  const genPromptFor=(outfit,kind,row)=>outfit?.genPrompts?.[kind]?.[row?.id]||genBuiltPrompt(row);
  // The latest group of a target left an unconfirmed request: the next one goes through the gate.
  function genUncertain(list,target){
    const key=genKey(target),mine=(list||[]).filter(j=>genKey(j.target)===key);if(!mine.length)return false;
    const last=mine.reduce((a,b)=>b.createdAt>a.createdAt?b:a);
    return mine.some(j=>j.groupId===last.groupId&&j.outcome==='unconfirmed'&&j.status!=='running');
  }
  // 「2 分钟前」 / 「昨天 21:40」 / 「10月3日」: when a request was made or a picture adopted.
  function genWhen(at,now=Date.now()){
    if(!Number.isFinite(at))return '';
    const s=Math.max(0,Math.round((now-at)/1000)),d=new Date(at),t=d.getHours()+':'+String(d.getMinutes()).padStart(2,'0'),day=x=>new Date(x).toDateString();
    if(s<60)return '刚刚';if(s<3600)return Math.floor(s/60)+' 分钟前';if(day(at)===day(now))return '今天 '+t;if(day(at)===day(now-86400000))return '昨天 '+t;
    return (d.getMonth()+1)+'月'+d.getDate()+'日';
  }
  // ---------- The controller (one per pack modal) ----------
  // Every pack write still goes through the modal's serialized writer (`enqueue`); sprite / avatar candidates are adopted
  // through the original importFigureImage (receipts kept per job, so a retry never imports a slot twice).
  function useAssetGen({binding,packId,enqueue,importFigureImage,onPacksChanged}) {
    const [jobs,setJobs]=React.useState(null),[pending,setPending]=React.useState({}),[errors,setErrors]=React.useState({}),[problem,setProblem]=React.useState('');
    const [sheet,setSheet]=React.useState(null),[dialog,setDialog]=React.useState(null),[gate,setGate]=React.useState(null),[models,setModels]=React.useState({}),[run,setRun]=React.useState(null);
    const alive=React.useRef(true),active=React.useRef(false),known=React.useRef(null),queue=React.useRef([]),pumping=React.useRef(false),receipts=React.useRef(new Map()),urls=React.useRef(new Map()),sheets=React.useRef(0),epoch=React.useRef(0);
    const dropping=React.useRef(new Set()),progressRef=React.useRef(null);
    React.useEffect(()=>{alive.current=true;return()=>{alive.current=false;queue.current=[];};},[]);
    const call=async(method,args)=>(await binding.rpc(method,args))?.data;
    const settle=()=>enqueue(async c=>({value:c})).then(r=>r.value);
    const show=list=>{known.current=list;if(alive.current)setJobs(list);};
    const merge=list=>{epoch.current++;const map=new Map((known.current||[]).map(j=>[j.jobId,j]));for(const j of list||[])if(j)map.set(j.jobId,j);show([...map.values()]);};
    const mark=(key,value)=>setPending(p=>{const next={...p};if(value)next[key]=value;else delete next[key];return next;});
    const fail=(key,message)=>setErrors(e=>{const next={...e};if(message)next[key]=message;else delete next[key];return next;});
    // A list that left before a newer write came back is stale: it is read again instead of overwriting the write.
    async function refresh(){
      for(let attempt=0;attempt<3;attempt++){
        const seen=epoch.current;
        try{const list=await call('listAssetCandidates',{packId});if(seen!==epoch.current)continue;show(list||[]);}catch(_){if(!known.current)show([]);}
        break;
      }
      return known.current||[];
    }
    const open=()=>{if(active.current)return;active.current=true;refresh();};
    // Polling only while a request of this pack is in flight.
    React.useEffect(()=>{if(!jobs?.some(j=>j.status==='running'))return;const t=setTimeout(refresh,GEN_POLL_MS);return()=>clearTimeout(t);},[jobs]);
    React.useEffect(()=>{
      if(typeof window==='undefined')return;
      const settings=()=>setProblem(''),focus=()=>{if(active.current)refresh();};
      window.addEventListener('dsh-tavern-image-settings-changed',settings);window.addEventListener('focus',focus);
      return()=>{window.removeEventListener('dsh-tavern-image-settings-changed',settings);window.removeEventListener('focus',focus);};
    },[]);
    // One picture waits per slot: when a newer candidate arrives (a 重画 / 改图 of a waiting one), the older one is dropped;
    // until then the older one stays, and it is on show again when the newer request brings nothing.
    React.useEffect(()=>{
      if(!jobs)return;const newest=new Map();
      for(const j of jobs)if(['candidate','save_failed'].includes(j.status)&&j.target.kind!=='background'){const k=genKey(j.target),b=newest.get(k);if(!b||j.createdAt>b.createdAt)newest.set(k,j);}
      for(const j of jobs)if(j.status==='candidate'&&j.target.kind!=='background'&&newest.get(genKey(j.target))!==j&&!dropping.current.has(j.jobId)){dropping.current.add(j.jobId);reject(j).catch(()=>{});}
    },[jobs]);
    const jobFor=target=>{
      const key=genKey(target);let best=null,held=null;
      for(const j of jobs||[]){if(genKey(j.target)!==key)continue;if(!best||j.createdAt>=best.createdAt)best=j;if(['candidate','save_failed'].includes(j.status)&&(!held||j.createdAt>=held.createdAt))held=j;}
      if(held&&best!==held&&!['running','accepted'].includes(best.status))return held;
      return genShown(best)?best:null;
    };
    const ask=count=>new Promise(resolve=>setGate({count,resolve}));
    // prepare → (gate) → generate. The backend retires the original only after a new candidate is saved.
    async function start(target,input={},{approved=false,plan:kept}={}){
      const key=genKey(target);open();mark(key,'starting');fail(key,'');
      try{
        let plan=kept;
        if(!plan){
          const pack=await settle();
          try{plan=await call('prepareAssetGeneration',{target,expectedRevision:pack.revision,...input});}
          catch(e){if(GEN_PROBLEMS[e.code])setProblem(e.code);throw e;}
          if(alive.current)setProblem('');
          const confirm=plan.confirmNewRequestIds||[];
          if(confirm.length&&!approved&&!await ask(confirm.length))return null;
        }
        const confirm=plan.confirmNewRequestIds||[];
        let result;
        try{result=await call('generateAssetCandidate',{planId:plan.planId,consentToken:plan.consentToken,...(confirm.length?{confirmNewRequestIds:confirm}:{})});}
        catch(e){throw Object.assign(e,{plan});}
        if(alive.current)setModels(m=>({...m,...Object.fromEntries(result.jobs.map(j=>[j.jobId,plan.provider?.model||'']))}));
        merge(result.jobs);
        return result.jobs[0];
      }catch(e){fail(key,GEN_PROBLEMS[e.code]?'':genError(e)||'生成失败');throw e;}
      finally{mark(key,'');}
    }
    const openSheet=(target,input,extra)=>{open();setSheet({id:++sheets.current,target,input,...extra});};
    // The 生成背景 / eight-face sheet requests: started at once, their sheet opens on the progress.
    function startSlot(target,input){openSheet(target,input);return start(target,input).catch(()=>null);}
    // 「生成缺失立绘」 / 「生成缺失头像」 (owner U2): one request per item ({target, input}), at most four in flight; the
    // ones not yet sent are dropped by 停止 or when the modal closes. `run` is the batch the heading counts (「生成中 a/b」).
    async function batch(items){
      if(!items.length)return;
      open();const list=await refresh(),uncertain=new Set(items.filter(i=>genUncertain(list,i.target)).map(i=>genKey(i.target)));
      if(uncertain.size&&!await ask(uncertain.size))return;
      const keys=items.map(i=>genKey(i.target)),live=progressRef.current;
      setRun(r=>({keys:[...new Set([...(live&&r?r.keys:[]),...keys])]}));
      for(const item of items){queue.current.push({target:item.target,input:item.input||{},approved:uncertain.has(genKey(item.target))});mark(genKey(item.target),'queued');}
      pump();
    }
    async function pump(){
      if(pumping.current)return;pumping.current=true;
      try{
        while(alive.current&&queue.current.length){
          if((known.current||[]).filter(j=>j.status==='running').length>=GEN_PARALLEL){await genSleep(GEN_POLL_MS);await refresh();continue;}
          const item=queue.current.shift();
          try{await start(item.target,item.input,{approved:item.approved,plan:item.plan});}
          catch(e){
            // Another pack's requests fill the four seats: the same consented plan is sent once a seat frees up.
            if(e.code==='BUSY'&&e.plan&&alive.current){queue.current.push({...item,plan:e.plan});mark(genKey(item.target),'queued');fail(genKey(item.target),'');await genSleep(GEN_POLL_MS*2);await refresh();}
            else if(GEN_PROBLEMS[e.code])for(const rest of queue.current.splice(0))mark(genKey(rest.target),'');
          }
        }
      }finally{pumping.current=false;}
    }
    function dequeue(target){const key=genKey(target);queue.current=queue.current.filter(item=>genKey(item.target)!==key);mark(key,'');}
    // 停止: the batch's requests not yet sent are dropped and the ones in flight cancelled; what came back stays.
    async function stop(){
      const keys=new Set(run?.keys||[]);
      queue.current=queue.current.filter(item=>{const key=genKey(item.target);if(!keys.has(key))return true;mark(key,'');return false;});
      for(const j of known.current||[])if(j.status==='running'&&keys.has(genKey(j.target)))await cancel(j).catch(()=>{});
    }
    const forget=jobId=>{for(const key of [...urls.current.keys()])if(key.startsWith(jobId+'|'))urls.current.delete(key);receipts.current.delete(jobId);};
    async function cancel(job){merge([await call('cancelAssetGenerationJob',{jobId:job.jobId})]);}
    async function reject(job){const done=await call('rejectAssetCandidate',{jobId:job.jobId});forget(job.jobId);merge([done]);return done;}
    async function retrySave(job){merge([await call('retryAssetCandidateSave',{jobId:job.jobId})]);}
    // The background sheet's 「按意见重画」 (a note on the frozen request).
    function redraw(job,note){
      const room=(job.references||[]).filter(ref=>!ref.redraw).length<GEN_REF_LIMIT;
      return start(job.target,{redrawOf:job.jobId,note,useCandidateReference:room});
    }
    // Candidate pixels for previews: one read per job / slice, kept as a data URL while the modal is open.
    function candidateUrl(jobId,emotionId){
      const key=jobId+'|'+(emotionId||'');let entry=urls.current.get(key);
      if(!entry){entry=call('readAssetCandidate',{jobId,...(emotionId?{emotionId}:{})}).then(d=>'data:'+d.mediaType+';base64,'+d.base64);urls.current.set(key,entry);entry.catch(()=>urls.current.delete(key));}
      return entry;
    }
    const candidateData=(job,emotionId)=>call('readAssetCandidate',{jobId:job.jobId,...(emotionId?{emotionId}:{})});
    async function candidateFile(job,emotionId,forImport=false){
      const d=await call('readAssetCandidate',{jobId:job.jobId,...(emotionId?{emotionId}:{}),...(forImport?{forImport:true}:{})});
      return new File([genBytes(d.base64)],(emotionId||job.target.kind)+'.png',{type:d.mediaType});
    }
    const finalize=(job,extra)=>enqueue(async c=>{merge([await call('acceptAssetCandidate',{jobId:job.jobId,expectedRevision:c.revision,...extra})]);return {snapshot:await binding.service.getPackSnapshot({packId})};});
    // 采用. settei / background: the backend writes the original pack (CAS on its slot). sprite / avatar: the candidate goes
    // through importFigureImage (aligned sprite read), then accept with the receipt. A sheet imports slot by slot and
    // resumes after a failure from the first slot without a receipt. Older candidates of the same slot are dropped.
    async function accept(job,{replace=false,file}={}){
      const t=job.target;
      if(t.kind==='settei'||t.kind==='background'){
        await enqueue(async c=>{merge([await call('acceptAssetCandidate',{jobId:job.jobId,expectedRevision:c.revision,...(replace?{replace:true}:{})})]);return {snapshot:await binding.service.getPackSnapshot({packId})};});
      } else {
        const receipt=receipts.current.get(job.jobId)||{hashes:{}};receipts.current.set(job.jobId,receipt);
        const slots=t.kind==='avatar-sheet'?t.emotionIds.filter(Boolean):[t.emotionId];
        // An avatar is imported byte for byte, so a slot that already holds this candidate (an earlier attempt, maybe
        // before the modal was reopened) counts as imported. Sprites are aligned on import; their receipt is the session's.
        const now=(await settle()).figures?.[t.figureId]?.outfits.find(o=>o.key===t.outfitKey);
        for(const id of slots){const want=t.kind==='avatar-sheet'?job.candidate?.slices?.[id]?.hash:t.kind==='avatar'?job.candidate?.hash:null;if(!receipt.hashes[id]&&want&&now?.avatars?.[id]===want)receipt.hashes[id]=want;}
        for(const id of slots){
          if(receipt.hashes[id])continue;
          const image=file||await candidateFile(job,t.kind==='avatar-sheet'?id:null,t.kind==='sprite');
          await importFigureImage(t.figureId,t.outfitKey,id,image,t.kind==='sprite'?'sprite':'avatar',{expectedPackId:packId,expectedRevision:(await settle()).revision,onImported:r=>{receipt.hashes[id]=r.hash;}});
        }
        await finalize(job,t.kind==='avatar-sheet'?{importedHashes:receipt.hashes}:{importedHash:receipt.hashes[t.emotionId]});
      }
      // Adopting settles the slot: other candidates of it are dropped, and a failed request's ⚠ (a redraw that brought
      // nothing) is cleared with it.
      forget(job.jobId);fail(genKey(t),'');
      for(const j of known.current||[])if(j.jobId!==job.jobId&&['candidate','failed'].includes(j.status)&&genKey(j.target)===genKey(t)&&!dropping.current.has(j.jobId)){dropping.current.add(j.jobId);reject(j).catch(()=>{});}
      onPacksChanged?.();
    }
    // 「全部采用」: one after another (each its own CAS write); a slot that fails keeps its candidate and says why.
    async function acceptAll(list){
      let done=0;
      for(const job of list){try{await accept(job);done++;}catch(e){fail(genKey(job.target),errorText(e));}}
      return done;
    }
    const dialogs=gate&&h(ConfirmDialog,{title:'上一次还没有结果',body:gate.count>1?'其中 '+gate.count+' 项上一次请求没有返回结果，不会自动重试。仍要再生成吗？':GEN_UNCERTAIN,confirmLabel:'仍要生成',
      onConfirm:()=>gate.resolve(true),onClose:()=>{gate.resolve(false);setGate(null);}});
    // private fork (figure quick fixes): the exact prompt and references a request would send, built by the backend without
    // a plan, a channel or a request.
    const previewPrompt=async(target,input={})=>{const pack=await settle();return call('prepareAssetGeneration',{target,expectedRevision:pack.revision,...input,preview:true});};
    // The batch the heading counts: done / total while any of it is queued, starting or drawing; else none.
    const progress=run?(()=>{const left=run.keys.filter(key=>{if(pending[key])return true;return (jobs||[]).some(j=>j.status==='running'&&genKey(j.target)===key);}).length;
      return left?{total:run.keys.length,done:run.keys.length-left,keys:run.keys}:null;})():null;
    progressRef.current=progress;
    return {jobs,pending,errors,problem,models,sheet,dialog,progress,open,refresh,jobFor,start,startSlot,previewPrompt,batch,stop,dequeue,cancel,reject,retrySave,redraw,accept,acceptAll,
      candidateUrl,candidateData,candidateFile,dialogs,openSheet,clearError:key=>fail(key,''),
      openDialog:(target,extra={})=>{open();setDialog({id:++sheets.current,target,mode:'gen',...extra});},closeDialog:()=>setDialog(null),
      retarget:(target,extra)=>setSheet(s=>s&&{...s,...extra,target}),closeSheet:()=>setSheet(null),
      waiting:(figureId,kinds)=>(jobs||[]).some(j=>j.target.figureId===figureId&&(!kinds||kinds.includes(j.target.kind))&&['candidate','save_failed'].includes(j.status))};
  }
  // ---------- Pieces ----------
  function useCandidateUrl(gen,jobId,emotionId){
    const key=jobId?jobId+'|'+(emotionId||''):'',[value,setValue]=React.useState(null);
    React.useEffect(()=>{if(!jobId)return;let live=true;gen.candidateUrl(jobId,emotionId).then(url=>{if(live)setValue({key,url});},()=>{});return()=>{live=false;};},[key]);
    return value?.key===key?value.url:null;
  }
  function CandidateArt({gen,jobId,emotionId,className}) {
    const url=useCandidateUrl(gen,jobId,emotionId);
    return url?h(RevealImg,{src:url,alt:'',draggable:false,className}):h(ForkSpinner,{key:jobId+(emotionId||''),fill:true});
  }
  function GenWarnings({warnings}) {
    if(!warnings?.length)return null;
    return h('div',{className:'ap-gen-warns',role:'list','aria-label':'检查结果'},warnings.map((w,i)=>h('span',{key:w.code+i,role:'listitem',className:'ap-gen-warn',title:w.message},h(Glyph,{name:'warning'}),w.label||GEN_WARNINGS[w.code]||w.message)));
  }
  function useElapsed(since,on) {
    const [now,setNow]=React.useState(()=>Date.now());
    React.useEffect(()=>{if(!on)return;const t=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(t);},[on]);
    const s=Math.max(0,Math.floor((now-(since||now))/1000));
    return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');
  }
  // A borderless text area that saves on blur (like CommitInput). It reads as text; a soft ground shows only while it is
  // being edited (gen-tab redesign, owner 2026-10).
  function GenText({value,onCommit,label,placeholder='未填写',rows=2,max=4000}) {
    const [draft,setDraft]=React.useState(value||''),last=React.useRef(value||'');
    React.useEffect(()=>{if((value||'')!==last.current){last.current=value||'';setDraft(value||'');}},[value]);
    return h(ForkTextArea,{className:'ap-gen-text','aria-label':label,placeholder,rows,maxLength:max,value:draft,onChange:setDraft,
      onBlur:()=>{const next=draft.trim();if(next===(value||'').trim())return;last.current=next;onCommit(next);},
      onKeyDown:e=>{if(e.key==='Escape'&&draft!==(value||'')){e.stopPropagation();setDraft(value||'');}}});
  }
  // ↑ ↓ (and ← → in a picture grid) walk a small 生图 menu.
  function genMenuKeys(e) {
    const items=[...e.currentTarget.querySelectorAll('button:not(:disabled),input')],i=items.indexOf(document.activeElement),n=items.length,next={ArrowDown:i+1,ArrowRight:i+1,ArrowUp:i-1,ArrowLeft:i-1,Home:0,End:n-1}[e.key];
    if(next===undefined||!n)return;e.preventDefault();items[(next+n)%n].focus();
  }
  // ---------- One slot as the grid sees it ----------
  // 'queued' / 'running' (with `since`) / 'candidate' / 'failed' / 'idle', and the job behind it. A 头像 counts the latest
  // eight-face sheet request covering it too (then `sheet` is that request's target).
  function genCell(gen,target){
    const key=genKey(target),own=gen.jobFor(target);
    const sheetTarget=target.kind==='avatar'?{packId:target.packId,figureId:target.figureId,outfitKey:target.outfitKey,kind:'avatar-sheet'}:null,cover=sheetTarget&&gen.jobFor(sheetTarget);
    const inSheet=!!cover&&(cover.target.emotionIds||[]).includes(target.emotionId),covering=inSheet&&(!own||cover.createdAt>own.createdAt)?cover:null,job=covering||own;
    const pend=gen.pending[key]||(inSheet&&!own?gen.pending[genKey(sheetTarget)]:'')||'';
    const state=pend==='queued'?'queued':pend||job?.status==='running'?'running':['candidate','save_failed'].includes(job?.status)?'candidate':job?.status==='failed'||(!job&&gen.errors[key])?'failed':'idle';
    const warnings=covering?covering.candidate?.slices?.[target.emotionId]?.checks?.warnings||[]:job?.candidate?.checks?.warnings||[];
    // A waiting candidate's `error` is why its last 采用 failed (「全部采用」 goes on past it; the tile keeps its ⚠).
    return {state,key,target,job:state==='idle'||state==='queued'?null:job,sheet:covering?covering.target:null,since:!pend&&job?.status==='running'?job.createdAt:null,
      error:state==='failed'?job?.error?.message||gen.errors[key]||'':state==='candidate'?gen.errors[key]||'':'',warnings};
  }
  // The candidate in a 差分 tile: a 立绘 is cut to the head and shoulders (a generated 立绘 fills its 2:3 canvas centred,
  // the head in its top fifth), a 头像 shows whole.
  function GenFaceCandidate({gen,cell,kind}) {
    return h('span',{className:'ap-gen-face-art','data-kind':kind},h(CandidateArt,{gen,jobId:cell.job.jobId,emotionId:cell.sheet?cell.target.emotionId:null}));
  }
  // The marks a request leaves on a tile: a turning ring and the time (生成中), 「排队中」, the dot and 「待采用」, ⚠.
  function GenFaceMarks({cell}) {
    const elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    if(cell.state==='queued')return h('span',{className:'ap-gen-queue'},'排队中');
    if(cell.state==='running')return h(React.Fragment,null,h(ForkSpinner,{key:'run'+cell.key,fill:true,delay:0,className:'ap-gen-spin'}),cell.since?h('span',{className:'ap-gen-face-time'},elapsed):null);
    if(cell.state==='candidate')return h(React.Fragment,null,h('span',{className:'ap-gen-dot','aria-hidden':true}),h('span',{className:'ap-gen-badge'},'待采用'),
      (cell.error||cell.warnings.length>0)&&h('span',{className:'ap-gen-flag',title:[cell.error,...cell.warnings.map(w=>w.message)].filter(Boolean).join('\n')},h(Glyph,{name:'warning'})));
    if(cell.state==='failed')return h('span',{className:'ap-gen-flag',title:genFailText(cell.error)},h(Glyph,{name:'warning'}));
    return null;
  }
  // private fork (owner 2026-10-16): status words are plain terms — 排队中 / 生成中 / 待采用 / 生图失败; a failure reads
  // 「生图失败：<the host's reason>」 on the tile's hover and in the records (the reason text is the host's, never mapped here).
  const GEN_CELL_WORDS={queued:'排队中',running:'生成中',candidate:'待采用',failed:'生图失败'};
  const genFailText=reason=>'生图失败'+(reason?'：'+reason:'');
  // The preview card of the picked 差分 while its request runs (the ring, 生成中 / 排队中 and the time) and while a candidate
  // waits (the picture on the checkerboard, 「待采用」, the outfit 设定图 in a corner to compare against — mock E5 / E6).
  function GenStageWait({cell}) {
    const elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    return h('span',{className:'ap-gen-stage-wait',role:'status'},h(ForkSpinner,{key:'wait'+cell.key,delay:0}),
      h('b',null,GEN_CELL_WORDS[cell.state==='queued'?'queued':'running']),cell.since&&cell.state==='running'&&h('small',null,elapsed));
  }
  function GenStageCandidate({gen,binding,packId,cell,kind,emotionId,settei}) {
    return h('span',{className:'ap-stand ap-gen-stand','data-kind':kind},
      h('span',{className:'ap-gen-stand-art'},h(CandidateArt,{gen,jobId:cell.job.jobId,emotionId:cell.sheet?emotionId:null})),
      h('span',{className:'ap-gen-badge is-stage'},'待采用'),
      settei&&h('span',{className:'ap-gen-pip',title:'服装设定图'},h(Thumb,{binding,packId,hash:settei,label:'服装设定图'}),h('small',null,'设定图')));
  }
  // The 差分 detail's request line (UI standard R9: the selected tile's actions under the grid): state, checks, actions.
  function GenCellStatus({gen,cell,outfit,onDialog}) {
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),elapsed=useElapsed(cell.since,cell.state==='running'&&!!cell.since);
    if(cell.state==='idle')return null;
    const run=fn=>{setBusy(true);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));};
    const job=cell.job,basis=job?.references?.some(r=>r.hash&&r.hash===outfit?.settei)?'照服装设定图':'照设定文字';
    const actions=cell.state==='candidate'?(cell.sheet?[h(Button,{key:'view',disabled:busy,onClick:()=>gen.openSheet(cell.sheet)},'查看八个头像')]:[
        h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:()=>run(()=>gen.reject(job))},'不要'),
        h(Button,{key:'redraw',disabled:busy,onClick:()=>onDialog('redraw')},'重画…'),
        h(Button,{key:'yes',disabled:busy,onClick:()=>run(()=>gen.accept(job))},'采用')]):
      cell.state==='failed'?[h(Button,{key:'retry',disabled:busy,onClick:()=>run(()=>gen.start(cell.target,job?.userPrompt?{userPrompt:job.userPrompt}:{}))},h(Glyph,{name:'reset'}),'重试'),
        h(Button,{key:'adjust',disabled:busy,onClick:()=>onDialog('gen')},'调整后重试…')]:
      [h(Button,{key:'stop',disabled:busy||cell.state==='running'&&!job,onClick:()=>run(()=>cell.state==='queued'?gen.dequeue(cell.target):gen.cancel(job))},cell.state==='queued'?'取消排队':'取消')];
    // One row (owner 2026-10-16): the pill, the reason or detail, the actions; it wraps only when the width runs out. A
    // failure's reason is the host's text after the 「生图失败」 pill (no second ⚠).
    const meta=cell.state==='failed'?(cell.error?h('span',{className:'ap-gen-warn-ink'},cell.error):null):cell.error?h('span',{className:'ap-gen-warn-ink'},h(Glyph,{name:'warning'}),'采用失败：'+cell.error):
      cell.state==='candidate'&&!cell.sheet?h('span',null,basis+(job?.userPrompt?' · '+job.userPrompt:'')):cell.state==='running'&&cell.since?h('span',{className:'ap-gen-time'},elapsed):null;
    return h('div',{className:'ap-gen-status','data-state':cell.state,role:'group','aria-label':'生成'},
      h('div',{className:'ap-gen-status-row'},h('span',{className:'ap-gen-pill','data-state':cell.state},GEN_CELL_WORDS[cell.state]),
        cell.state==='candidate'&&h(GenWarnings,{warnings:cell.warnings}),meta&&h('span',{className:'ap-gen-status-meta'},meta),h('span',{className:'ap-gen-status-actions'},actions)),
      error&&h('p',{className:'ap-field-error',role:'alert'},error));
  }
  // The ⚠ line a gated action leaves where it was clicked (for touch, where tooltips do not show). It stays until the next
  // action there (or the picked 差分 / view changes, which remounts its owner) — no timer, so it never vanishes unread.
  function useGenNote() {
    const [note,setNote]=React.useState('');
    return [note,text=>setNote(text||'')];
  }
  function GenGateNote({text,className=''}) {
    if(!text)return null;
    return h('p',{className:('ap-gen-gate '+className).trim(),role:'status'},h(Glyph,{name:'warning'}),h('span',null,text));
  }
  // ---------- The ONE generation dialog (owner 2026-10-15: 生成 / 重画 / 改图 / 设定图; 编辑 and 生图 open the same) ----------
  // Left: what the slot holds now. Right: 画什么 (the 差分 and 立绘 / 头像 — chosen when opened from 生图), 参考图 (the 设定图
  // or the 设定文字 card by default, each can be switched off; ＋ adds a picture of this outfit or an upload, pose only),
  // 提示词 (pre-filled from the 差分's name and 使用情景, or its saved default; ⟲ back to it; 重画 offers quick notes;
  // 「存为默认」 keeps it for this cell only, U4), the fixed requirements in one line with 「查看全文」. Ctrl+Enter sends,
  // Esc closes. The request then runs in the tile; the dialog closes as soon as it is sent.
  const GEN_REDRAW_CHIPS=['再夸张一点','收敛一点','换个姿势','换个手势'];
  const GEN_DIALOG_HELP={refs:'默认照服装设定图画；没有设定图时照设定文字（外貌和服装描述）。点一下就不用它；＋ 可以加这套服装的其他图或上传一张，只借姿势和表情。最多 4 张。',
    settei:'照设定文字画；加一张原画时，长相和画风照原画。点一下就不用它，最多 4 张。',
    prompt:'已按差分名和使用情景填好，可以直接生成；改动只用于这一次，勾选「存为默认」才会记住。',
    edit:'写要改的地方，其余照底图不动。只用于这一次。',
    save:'只存到这一格：这个人物、这套服装的这个差分。以后这一格单独生成和「生成缺失」都先用它。'};
  const GEN_FIXED={sprite:basis=>'全身站姿、透明背景，照'+(basis==='image'?'设定图':'设定文字')+'的长相、服装和画风',avatar:()=>'头像构图、透明背景，照这个差分的立绘和设定的长相',
    settei:()=>'多视图设定图、浅色底，不写名字和标题',edit:()=>'只改写到的地方，长相、服装、构图和透明背景保持原样'};
  function GenRefChip({binding,packId,hash,url,name,on=true,locked=false,wide=false,onToggle,onRemove}) {
    const art=hash?h(Thumb,{binding,packId,hash,label:name,className:'ap-gen-ref-art'}):url?h('img',{src:url,alt:'',draggable:false}):h(Glyph,{name:'note'});
    const chip=locked||!onToggle?h('span',{className:'ap-gen-ref is-static','data-wide':wide||undefined,role:'img','aria-label':name,title:name},art):
      h('button',{type:'button',className:'ap-gen-ref','data-wide':wide||undefined,'aria-pressed':on,'aria-label':'照着画：'+name,title:on?name+'（点一下不用）':name+'（点一下用上）',onClick:onToggle},art,on&&h('span',{className:'ap-gen-ref-check','aria-hidden':true},h(Glyph,{name:'check'})));
    return h('span',{className:'ap-gd-ref'},h('span',{className:'ap-gd-ref-chip'},chip,onRemove&&h('button',{type:'button',className:'ap-gen-ref-x','aria-label':'移除参考图 '+name,title:'移除',onClick:onRemove},h(Glyph,{name:'close'}))),h('small',null,name));
  }
  function GenDialog({gen,binding,pack,commitFigure}) {
    const d=gen.dialog,packId=pack.manifest.id,figure=pack.figures?.[d.target.figureId];
    const raw=figure?.outfits.find(o=>o.key===d.target.outfitKey),outfit=raw&&figureOutfitView(figure,raw),settei=d.target.kind==='settei',mode=d.mode||'gen';
    const rows=figure?figureEditorEmotions(figure):[],manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey];
    const [pick,setPick]=React.useState({kind:d.target.kind,emotionId:d.target.emotionId});
    const kind=settei?'settei':pick.kind,row=settei?null:rows.find(r=>r.id===pick.emotionId)||null;
    const target=settei?{packId,figureId:d.target.figureId,outfitKey:d.target.outfitKey,kind:'settei'}:{packId,figureId:d.target.figureId,outfitKey:d.target.outfitKey,kind,emotionId:pick.emotionId};
    const key=genKey(target),cell=genCell(gen,target),basis=genBasis(figure,outfit),fallback=settei?'':genPromptFor(outfit,kind,row);
    const own=!outfit?null:settei?outfit.settei||null:kind==='sprite'?genOwnSprite(outfit,manifest,pick.emotionId):outfit.avatars?.[pick.emotionId]||null;
    // 重画 / 改图 work on what the slot shows: the waiting candidate, else the adopted picture.
    const waiting=cell.state==='candidate'?cell.job:null,base=mode==='gen'?null:waiting?{job:waiting}:own?{hash:own}:null;
    const [prompt,setPrompt]=React.useState(()=>mode==='edit'?'':mode==='redraw'&&waiting?.userPrompt||fallback);
    const [off,setOff]=React.useState([]),[current,setCurrent]=React.useState(false),[extras,setExtras]=React.useState([]),[save,setSave]=React.useState(false);
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[full,setFull]=React.useState(null);
    const close=()=>{if(!busy)gen.closeDialog();};
    if(!figure||!outfit)return h(Modal,{title:'生成',className:'ap-gen-dialog',onClose:close},h('p',{className:'ap-empty'},'服装已被删除'));
    const view=settei?'设定图':kind==='avatar'?'头像':'立绘',verb={gen:'生成',redraw:'重画',edit:'改图'}[mode],what=settei?'设定图':'「'+(row?.label||'')+'」'+view;
    const changePick=next=>{const r=rows.find(x=>x.id===next.emotionId);if(prompt===fallback)setPrompt(genPromptFor(outfit,next.kind,r));setPick(next);setFull(null);};
    // The pictures the backend attaches by rule (asset-generation.js prepare): the identity board, the 设定图 (both can be
    // switched off: `omit`), and for a 头像 this 差分's 立绘 and the first 差分's 头像 (fixed).
    const identity=figure.identitySettei,stale=!!identity&&!settei&&outfit.setteiParentVersion!==undefined&&outfit.setteiParentVersion!==identity.version;
    const toggles=[],seen=new Set();
    if(identity&&!stale){toggles.push({id:'identity',hash:identity.board,name:'人物设定图'});seen.add(identity.board);}
    if(!settei&&outfit.settei&&!seen.has(outfit.settei)){toggles.push({id:'settei',hash:outfit.settei,name:'服装设定图'});seen.add(outfit.settei);}
    const fixed=[];
    if(kind==='avatar'){const s=genOwnSprite(outfit,manifest,pick.emotionId),first=genDefaultId(figure,outfit);if(s&&!seen.has(s)){fixed.push({hash:s,name:(row?.label||'')+'立绘'});seen.add(s);}
      if(pick.emotionId!==first&&outfit.avatars?.[first]&&!seen.has(outfit.avatars[first]))fixed.push({hash:outfit.avatars[first],name:'首个差分头像'});}
    const withBase=mode==='edit'||mode==='redraw'&&current;
    const used=toggles.filter(t=>!off.includes(t.id)).length+fixed.length+(withBase&&base?1:0)+extras.length,room=GEN_REF_LIMIT-used;
    const layered=kind==='sprite'&&!spriteSlotTakesStill(outfit,manifest,pick.emotionId);
    const reason=layered?GEN_REASONS.layered:kind==='avatar'&&!genOwnSprite(outfit,manifest,pick.emotionId)?GEN_REASONS.avatar:
      mode==='edit'&&!prompt.trim()?GEN_REASONS.edit:mode!=='gen'&&!base?'这一格还没有图':['running','queued'].includes(cell.state)?GEN_REASONS.busy:
      !prompt.trim()&&!basis&&!extras.length&&!(withBase&&base)?GEN_REASONS.basis:'';
    const omit=toggles.filter(t=>off.includes(t.id)).map(t=>t.id);
    const references=async()=>{
      const list=[];
      if(withBase&&base){const role=mode==='edit'?GEN_BASE_ROLE:GEN_CURRENT_ROLE;
        if(base.hash)list.push({hash:base.hash,role});else{const data=await gen.candidateData(base.job,cell.sheet?pick.emotionId:null);list.push({base64:data.base64,mediaType:data.mediaType,role});}}
      for(const x of extras)list.push(x.hash?{hash:x.hash,role:settei?GEN_ART_ROLE:GEN_POSE_ROLE}:{base64:x.base64,mediaType:x.mediaType,role:settei?GEN_ART_ROLE:GEN_POSE_ROLE});
      return list;
    };
    const inputNow=async()=>{const refs=await references();return {...(prompt.trim()?{userPrompt:prompt.trim()}:{}),...(refs.length?{references:refs}:{}),...(omit.length?{omit}:{})};};
    // 「存为默认」: this cell's own prompt (outfit.genPrompts[kind][差分]); the name-and-使用情景 default needs no entry.
    const saveDefault=text=>commitFigure(figure.id,f=>({outfits:f.outfits.map(o=>{
      if(o.key!==outfit.key)return o;const all={...(o.genPrompts||{})},map={...(all[kind]||{})};
      if(!text||text===genBuiltPrompt(row))delete map[row.id];else map[row.id]=text;
      if(Object.keys(map).length)all[kind]=map;else delete all[kind];
      const next={...o};if(Object.keys(all).length)next.genPrompts=all;else delete next.genPrompts;return next;})}));
    // A failed start is said once, from gen.errors (startError below); only what fails before it is this dialog's own error.
    const submit=()=>{if(busy||reason)return;setBusy(true);setError('');let sent=false;
      Promise.resolve().then(async()=>{
        const input=await inputNow();
        if(save&&!settei&&mode!=='edit'&&row)await saveDefault(prompt.trim());
        sent=true;
        const job=await gen.start(target,input);
        if(job)gen.closeDialog();
      }).catch(e=>{if(!sent)setError(errorText(e));}).finally(()=>setBusy(false));};
    const showFull=()=>{if(full){setFull(null);return;}setFull({busy:true});
      inputNow().then(input=>gen.previewPrompt(target,input)).then(plan=>setFull({text:plan.prompt,parts:plan.parts}),e=>setFull({error:errorText(e)}));};
    // ＋: this outfit's own pictures (each 差分's 立绘, then 头像, then the 设定图) or an upload.
    const taken=new Set([...toggles.map(t=>t.hash),...fixed.map(f=>f.hash),...(base?.hash?[base.hash]:[]),...extras.map(x=>x.hash).filter(Boolean)]),choices=[],have=new Set();
    const offer=(hash,name)=>{if(hash&&!taken.has(hash)&&!have.has(hash)){have.add(hash);choices.push({hash,name});}};
    for(const r of rows)offer(genOwnSprite(outfit,manifest,r.id),r.label+'立绘');
    for(const r of rows)offer(outfit.avatars?.[r.id],r.label+'头像');
    offer(outfit.settei,'服装设定图');
    const upload=file=>Promise.resolve().then(async()=>{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw new Error('参考图请选 PNG、JPEG 或 WebP');
      if(file.size>GEN_REF_BYTES)throw new Error('参考图最大 8 MB');
      const base64=genBase64(new Uint8Array(await file.arrayBuffer()));
      setExtras(list=>[...list,{id:file.name+file.size+Date.now(),name:file.name,mediaType:file.type,base64,url:'data:'+file.type+';base64,'+base64}]);
    }).catch(e=>setError(errorText(e)));
    const fileInput=label=>h('input',{type:'file',accept:'image/png,image/jpeg,image/webp','aria-label':label,onChange:e=>{const file=e.target.files?.[0];e.target.value='';if(file)upload(file);}});
    const addLabel='添加参考图';
    const add=room>0&&h('span',{className:'ap-gd-ref'},h('span',{className:'ap-gd-ref-chip'},choices.length?h(Popover,{label:addLabel,className:'ap-gen-ref-pick',limit:360,
        trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gen-ref ap-gen-ref-add','aria-label':addLabel,'aria-haspopup':'menu','aria-expanded':open,title:addLabel,onClick:toggle},h(Glyph,{name:'plus'})),
        content:closeMenu=>h('div',{className:'ap-gen-ref-menu',onKeyDown:genMenuKeys},
          h('p',{className:'ap-gen-ref-menu-meta'},'这套服装已有的图'),
          h('div',{className:'ap-gen-ref-grid'},choices.map(p=>h('button',{key:p.hash,type:'button',role:'menuitem',className:'ap-gen-ref','aria-label':p.name,title:p.name,onClick:()=>{closeMenu();setExtras(list=>[...list,{id:p.hash,hash:p.hash,name:p.name}]);}},
            h(Thumb,{binding,packId,hash:p.hash,label:p.name,className:'ap-gen-ref-art'})))),
          h('label',{className:'ap-menu-item ap-gen-ref-upload',role:'menuitem'},h(Glyph,{name:'upload'}),h('span',null,'上传图片…'),fileInput('上传参考图')))}):
      h('label',{className:'ap-gen-ref ap-gen-ref-add',title:addLabel},h(Glyph,{name:'plus'}),fileInput(addLabel))),h('small',null,'\u00a0'));
    const textCard=(settei||!toggles.length)&&h('span',{className:'ap-gd-ref'},
      h('span',{className:'ap-gen-ref ap-gd-text-card is-static','data-empty':basis?undefined:true,role:'img','aria-label':'设定文字'},
        h('span',{className:'ap-gd-text-icon','aria-hidden':true},h(Glyph,{name:'note'})),
        genSaid(figure.identityAppearance)||genSaid(outfit.outfitAppearance)?h('span',{className:'ap-gd-text-body'},
          genSaid(figure.identityAppearance)&&h('span',null,h('i',null,'外貌'),figure.identityAppearance),genSaid(outfit.outfitAppearance)&&h('span',null,h('i',null,'服装'),outfit.outfitAppearance)):
          h('span',{className:'ap-gd-text-body is-empty'},'还没有外貌和服装描述')),
      h('small',null,'设定文字',d.goBasis&&h(React.Fragment,null,' · ',h('button',{type:'button',className:'ap-inline-link',onClick:()=>{gen.closeDialog();d.goBasis();}},'去改'))));
    const refs=h('div',{className:'ap-gd-refs',role:'group','aria-label':'生成时照着画'},
      mode==='edit'&&base&&h(GenRefChip,{key:'base',binding,packId,hash:base.hash,url:null,name:'底图',locked:true}),
      textCard,
      toggles.map(t=>h(GenRefChip,{key:t.id,binding,packId,hash:t.hash,name:t.name,wide:true,on:!off.includes(t.id),onToggle:()=>setOff(o=>o.includes(t.id)?o.filter(x=>x!==t.id):[...o,t.id])})),
      fixed.map(f=>h(GenRefChip,{key:f.hash,binding,packId,hash:f.hash,name:f.name,locked:true})),
      mode==='redraw'&&base&&h(GenRefChip,{key:'current',binding,packId,hash:base.hash,name:'现在这张',on:current,onToggle:()=>setCurrent(v=>!v)}),
      extras.map(x=>h(GenRefChip,{key:x.id,binding,packId,hash:x.hash,url:x.url,name:x.hash?x.name:'上传的图',onRemove:()=>setExtras(list=>list.filter(y=>y!==x))})),
      add);
    // The base candidate inside the 底图 / 现在这张 chip (a waiting picture has no pack hash yet).
    const nowArt=waiting?h(CandidateArt,{gen,jobId:waiting.jobId,emotionId:cell.sheet?pick.emotionId:null}):own?h(Thumb,{key:own,binding,packId,hash:own,label:what}):h(Glyph,{name:'spark'});
    const caption={gen:waiting?'待采用':own?'现在这张 · 采用新图前不会被换掉':'空位',redraw:'现在这张 · 采用新图前不会被换掉',edit:'底图 · 在这张上改'}[mode];
    const now=h('figure',{className:'ap-gd-now','data-shape':kind},h('span',{className:'ap-gd-art','data-filled':!!(waiting||own)||undefined,'data-checker':kind!=='settei'&&!!(waiting||own)||undefined},nowArt),h('figcaption',null,caption));
    const emotionPicker=h(Popover,{label:'选择差分',className:'ap-gen-emotion-pick',limit:360,
      trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gen-emotion-trigger','aria-haspopup':'menu','aria-expanded':open,'aria-label':'差分：'+(row?.label||''),onClick:toggle},
        h('span',{className:'ap-gen-emotion-dot'}),h('span',null,row?.label||''),h(Glyph,{name:'chevDown'})),
      content:closeMenu=>h('div',{className:'ap-gen-emotion-menu',onKeyDown:genMenuKeys},rows.map(r=>h('button',{key:r.id,type:'button',role:'menuitemradio','aria-checked':r.id===pick.emotionId,className:'ap-menu-item',
        onClick:()=>{closeMenu();if(r.id!==pick.emotionId)changePick({kind,emotionId:r.id});}},h('span',{className:'ap-gen-emotion-dot'}),h('span',null,r.label))))});
    const targetRow=settei?h('span',{className:'ap-gd-target'},h('span',{className:'ap-gd-what'},'服装设定图'),h('span',{className:'ap-gd-meta'},outfit.label)):
      mode==='gen'?h('span',{className:'ap-gd-target'},emotionPicker,h(Segmented,{className:'ap-gen-views',label:'生成哪种素材',value:kind,onChange:k=>changePick({kind:k,emotionId:pick.emotionId}),options:[['sprite','立绘'],['avatar','头像']]}),h('span',{className:'ap-gd-meta'},outfit.label)):
      h('span',{className:'ap-gd-target'},h('span',{className:'ap-gd-what'},(row?.label||'')+' · '+view),h('span',{className:'ap-gd-meta'},outfit.label));
    const edited=mode!=='edit'&&prompt!==fallback,promptLabel=mode==='edit'?'想改哪里':'提示词';
    const appendChip=word=>setPrompt(p=>{const t=p.trim();return t?(/[。！？.!?，,]$/.test(t)?t:t+'，')+word+'。':word+'。';});
    const fixedText=(mode==='edit'?GEN_FIXED.edit:GEN_FIXED[kind])(basis);
    const promptBox=h('div',{className:'ap-gd-prompt-block'},
      h('div',{className:'ap-gd-prompt'},
        h(ForkTextArea,{className:'ap-gd-text',label:promptLabel,rows:3,maxLength:1000,value:prompt,placeholder:mode==='edit'?'例：领巾换成红色，其余不变':settei?'例：领巾打成蝴蝶结':'例：双手叉腰，气鼓鼓地瞪着前方',
          onChange:v=>{setPrompt(v);setFull(null);}}),
        mode!=='edit'&&h('span',{className:'ap-gd-reset'},h(IconButton,{icon:'reset',label:'恢复默认提示词',disabled:!edited,onClick:()=>setPrompt(fallback)}))),
      // The quick notes are about a 差分's acting; a 设定图 is a fixed sheet of views.
      mode==='redraw'&&!settei&&h('div',{className:'ap-gd-chips',role:'group','aria-label':'常用意见'},GEN_REDRAW_CHIPS.map(c=>h('button',{key:c,type:'button',className:'ap-gd-chip',title:'加到提示词末尾',onClick:()=>appendChip(c)},c))),
      !settei&&mode!=='edit'&&row&&h('span',{className:'ap-gd-save'},h('button',{type:'button',role:'checkbox','aria-checked':save,className:'ap-check-row ap-gd-save-box',onClick:()=>setSave(v=>!v)},
        h('span',{className:'ap-check-mark','aria-hidden':true},save&&h(Glyph,{name:'check'})),h('span',null,'存为默认')),h(Help,{text:GEN_DIALOG_HELP.save,label:'存为默认 说明'})),
      h('p',{className:'ap-gd-fixed'},edited&&h('span',{className:'ap-gd-edited'},save?'已改 · 存为这一格的默认':'已改 · 只用于这一次'),edited&&' · ','另附固定要求：'+fixedText+' · ',
        h('button',{type:'button',className:'ap-inline-link',onClick:showFull},full?'收起':'查看全文')),
      full&&(full.busy?h('p',{className:'ap-loading',role:'status'},h(ForkSpinner),'正在读取…'):full.error?h('p',{className:'ap-field-error',role:'alert'},full.error):
        // The lines 设置 → 生图 changed are marked (the backend's `parts`, only when this kind is edited there).
        h(React.Fragment,null,full.parts?.some(p=>p.edited)&&h('p',{className:'ap-gen-prompt-legend'},h('mark',{className:'ap-gen-prompt-edited'},'标出'),'的部分是在「设置 → 生图」里改过的'),
          h('pre',{className:'ap-gen-prompt-text',tabIndex:0,'aria-label':'将发送的提示词'},full.parts?full.parts.map((p,i)=>p.edited?h('mark',{key:i,className:'ap-gen-prompt-edited'},p.text):p.text):full.text))));
    const startError=gen.errors[key]&&!gen.pending[key]?gen.errors[key]:'';
    const fields=h('div',{className:'ap-gd-fields'},
      h(ForkInlineRow,{label:'画什么',className:'ap-gen-row ap-gd-row'},targetRow),
      h(ForkInlineRow,{label:mode==='edit'?'照着':'参考图',help:h(Help,{text:settei?GEN_DIALOG_HELP.settei:GEN_DIALOG_HELP.refs,label:'参考图 说明'}),multiline:true,wide:true,className:'ap-gen-row ap-gd-row is-refs'},refs),
      h(ForkInlineRow,{label:promptLabel,help:h(Help,{text:mode==='edit'?GEN_DIALOG_HELP.edit:GEN_DIALOG_HELP.prompt,label:promptLabel+' 说明'}),multiline:true,wide:true,className:'ap-gen-row ap-gd-row is-prompt'},promptBox),
      gen.problem&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,GEN_PROBLEMS[gen.problem])),
      reason&&reason!==GEN_REASONS.edit&&h('p',{className:'ap-gen-reason'},reason),
      startError&&!gen.problem&&h('p',{className:'ap-alert',role:'alert'},startError),
      error&&h('p',{className:'ap-alert',role:'alert'},error));
    const head=h('header',{className:'ap-gen-sheet-head'},h('h2',null,verb+what),h('span',{className:'ap-gen-sheet-meta'},figure.name+' · '+outfit.label),h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:close}));
    const foot=h('footer',{className:'ap-gen-foot ap-gd-foot'},h('span',{className:'ap-gd-kbd'},'Ctrl+Enter '+verb+' · Esc 关闭'),busy&&h('span',{className:'ap-busy'},h(ForkSpinner),'正在发送…'),
      h(Button,{disabled:busy,onClick:close},'取消'),h(Button,{primary:true,disabled:busy||!!reason,title:reason||undefined,onClick:submit},verb));
    return h(Modal,{title:verb+what+' · '+outfit.label,className:'ap-gen-dialog',frame:{'data-mode':mode},onClose:close,busy,head,foot,initialFocus:'dialog'},
      h('div',{className:'ap-gd-body','data-mode':mode,onKeyDown:e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();submit();}}},now,fields));
  }
  // ---------- The large view (查看大图) and the background / eight-face requests ----------
  // Desktop: the picture large on the left, checks / references beside it, actions at the foot. Phone: a full-screen
  // sheet — picture, then the rest, actions pinned to the bottom. A figure picture's 重画 / 改图 go to the dialog.
  function GenSheet({gen,binding,pack,importSettei}) {
    const {target,input}=gen.sheet,packId=pack.manifest.id,key=genKey(target),kind=target.kind;
    const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[redrawing,setRedrawing]=React.useState(false),[note,setNote]=React.useState('');
    const [changed,setChanged]=React.useState(false),[framing,setFraming]=React.useState(null),[view,setView]=React.useState('slices'),[prompt,setPrompt]=React.useState('');
    const job=gen.jobFor(target),pend=gen.pending[key],startError=!pend&&(gen.errors[key]||gen.sheet.error);
    const state=pend||job?.status==='running'?'running':job?.status==='candidate'?'candidate':job?.status==='save_failed'?'save_failed':job?.status==='failed'?'failed':'idle';
    const elapsed=useElapsed(job?.createdAt,state==='running');
    let title='',meta='',hash=null,figure=null,outfit=null,asset=null,ready=true,reason='';
    if(kind==='background'){asset=target.assetId?pack.manifest.assets.find(a=>a.kind==='backgrounds'&&a.id===target.assetId):null;title=asset?.name||'新背景';hash=asset?.media||null;}
    else{
      figure=pack.figures?.[target.figureId];outfit=figure?.outfits.find(o=>o.key===target.outfitKey);meta=outfit?.label||'';
      const manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey],emotion=figure&&figureEditorEmotions(figure).find(r=>r.id===target.emotionId)?.label||'';
      title=kind==='settei'?'设定图':kind==='avatar-sheet'?'八个表情头像':emotion+(kind==='sprite'?'立绘':'头像');
      hash=kind==='settei'?outfit?.settei:kind==='sprite'?genOwnSprite(outfit,manifest,target.emotionId):kind==='avatar'?outfit?.avatars?.[target.emotionId]:null;
      reason=kind==='avatar-sheet'&&!genOwnSprite(outfit,manifest,genDefaultId(figure,outfit))&&!outfit?.settei?GEN_REASONS.sheet:'';
      ready=!reason;
    }
    const figureKind=['sprite','avatar','settei'].includes(kind),transparent=['sprite','avatar','avatar-sheet'].includes(kind),candidate=job?.candidate,sheetSlices=candidate?.slices||null;
    const run=fn=>{setBusy(true);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));};
    const close=()=>{if(!busy)gen.closeSheet();};
    const dialog=mode=>{gen.closeSheet();gen.openDialog(target,{mode});};
    const accept=opts=>run(async()=>{
      try{await gen.accept(job,opts);gen.closeSheet();}
      catch(e){
        if(e.code==='TARGET_CHANGED'){setChanged(true);return;}
        // The calm ruler could not align this sprite: the original picture goes to the framer instead (manual alignment).
        if(e.code==='ALIGNMENT_REQUIRED'){setFraming(await gen.candidateFile(job,null,false));return;}
        throw e;
      }
    });
    // A failed start is shown from gen.errors (one place), not repeated here.
    const generate=()=>run(async()=>{
      if(figureKind){dialog('gen');return;}
      if(kind!=='background'){await gen.start(target,input).catch(()=>{});return;}
      await gen.start(target,{userPrompt:prompt.trim()}).catch(()=>{});
    });
    const drop=()=>run(async()=>{await gen.reject(job);gen.closeSheet();});
    const references=job?.references||[];
    const first=figure&&genDefaultId(figure,outfit);
    const refName=r=>r.redraw?'上一张':r.hash===figure?.identitySettei?.board?'人物设定图':r.hash===outfit?.settei?'服装设定图':r.hash===outfit?.avatars?.[first]?'首个差分头像':r.purpose==='emotion-sprite'?'同差分立绘':'参考图';
    // The stage: progress, the candidate (a sheet as its eight cut cells or whole), the failure, or the current picture.
    const sliceWarnings=sheetSlices?Object.entries(sheetSlices).flatMap(([id,s])=>(s.checks?.warnings||[]).map(w=>({...w,id}))):[];
    const names=figure?Object.fromEntries(figureEditorEmotions(figure).map(r=>[r.id,r.label])):{};
    const stage=state==='running'?h('div',{className:'ap-gen-wait',role:'status'},h('span',{className:'ap-gen-wait-spin'},h(ForkSpinner,{key:'wait',fill:true})),
        h('strong',null,pend==='queued'?'排队等待':pend?'正在发送':'正在生成'),!pend&&h('span',{className:'ap-gen-time'},elapsed),!pend&&gen.models[job?.jobId]&&h('small',null,gen.models[job.jobId])):
      state==='candidate'?(kind==='avatar-sheet'&&sheetSlices&&view==='slices'?h('div',{className:'ap-gen-slices'},(job.target.emotionIds||[]).map((id,i)=>id?h('figure',{key:id,className:'ap-gen-slice'},
          h('span',{className:'ap-gen-slice-art'},h(CandidateArt,{gen,jobId:job.jobId,emotionId:id}),(sheetSlices[id]?.checks?.warnings||[]).length>0&&h('span',{className:'ap-gen-flag',title:sheetSlices[id].checks.warnings.map(w=>w.message).join('\n')},h(Glyph,{name:'warning'}))),
          h('figcaption',null,names[id]||id)):h('span',{key:'skip'+i,className:'ap-gen-slice is-skip'}))):h(CandidateArt,{gen,jobId:job.jobId,className:'ap-gen-full'})):
      state==='failed'||state==='save_failed'?h('div',{className:'ap-gen-wait is-failed',role:'alert'},h(Glyph,{name:'warning'}),h('p',null,job?.error?.message||'生成失败')):
      hash?h(Thumb,{key:hash,binding,packId,hash,label:title,className:'ap-gen-full'}):h('span',{className:'ap-gen-empty'},h(Glyph,{name:'spark'}));
    const sideWarnings=candidate?[...(candidate.checks?.warnings||[]),...Object.values(sliceWarnings.reduce((acc,w)=>{(acc[w.code]||=({...w,ids:[]})).ids.push(w.id);return acc;},{})).map(w=>({...w,label:(GEN_WARNINGS[w.code]||w.message)+'：'+w.ids.map(id=>names[id]||id).join('、')}))]:[];
    const replaces=kind==='avatar-sheet'&&outfit?(job?.target.emotionIds||[]).filter(id=>id&&outfit.avatars?.[id]).length:0;
    // private fork (settei ui, owner 2026-10): with nothing to say beside it (a picture just being looked at), the picture
    // takes the whole width, so a landscape 设定图 is not letterboxed into a tall empty stage.
    const side=[
      gen.problem&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,GEN_PROBLEMS[gen.problem])),
      state==='candidate'&&h(GenWarnings,{warnings:sideWarnings}),
      state==='candidate'&&['sprite','avatar'].includes(kind)&&h('div',{className:'ap-gen-tones','data-shape':kind},['light','dark'].map(tone=>h('span',{key:tone,className:'ap-gen-tone','data-tone':tone,title:tone==='light'?'浅色底':'深色底'},h(CandidateArt,{gen,jobId:job.jobId})))),
      state==='candidate'&&kind==='avatar-sheet'&&sheetSlices&&h(Segmented,{className:'ap-gen-view',label:'显示',value:view,onChange:setView,options:[['slices','切开'],['whole','原图']]}),
      replaces>0&&state==='candidate'&&h('p',{className:'ap-gen-reason'},'采用会替换已有的 '+replaces+' 个头像。'),
      state==='candidate'&&job?.userPrompt&&h('div',{className:'ap-gen-used'},h('span',{className:'ap-prop-key'},'提示词'),h('p',{className:'ap-gen-used-text'},job.userPrompt)),
      references.length>0&&state!=='idle'&&h('div',{className:'ap-gen-used'},h('span',{className:'ap-prop-key'},'参考'),h('div',{className:'ap-gen-refs'},references.map((r,i)=>h('span',{key:i,className:'ap-gen-ref is-static',title:refName(r)},
        r.hash&&pack.manifest.blobs?.[r.hash]?h(Thumb,{binding,packId,hash:r.hash,label:refName(r),className:'ap-gen-ref-art'}):h(Glyph,{name:'note'}))))),
      kind==='background'&&(state==='idle'||state==='failed')&&h('label',{className:'ap-gen-field'},h('span',{className:'ap-prop-key'},'想要什么样的背景'),
        h(ForkTextArea,{className:'ap-gen-text',rows:4,maxLength:4000,autoFocus:true,value:prompt,placeholder:'例：黄昏的教室，窗外有樱花',onChange:setPrompt})),
      redrawing&&h('label',{className:'ap-gen-field'},h('span',{className:'ap-prop-key'},'想改哪里'),
        h(ForkTextArea,{className:'ap-gen-text',rows:3,maxLength:1000,autoFocus:true,value:note,placeholder:'例：蝴蝶结换成红色，头发再长一点',onChange:setNote})),
      changed&&h('p',{className:'ap-gen-reason'},'这里已经换了一张图。'),
      !ready&&state==='idle'&&h('p',{className:'ap-gen-reason'},reason),
      startError&&h('p',{className:'ap-alert',role:'alert'},startError),
      error&&h('p',{className:'ap-alert',role:'alert'},error)].filter(Boolean);
    const sliced=kind!=='avatar-sheet'||!!sheetSlices;
    const actions=state==='running'?[h(Button,{key:'cancel',disabled:busy||pend==='starting',onClick:()=>run(()=>pend==='queued'?gen.dequeue(target):gen.cancel(job))},pend==='queued'?'取消排队':'取消生成')]:
      state==='candidate'&&redrawing?[h(Button,{key:'back',disabled:busy,onClick:()=>{setRedrawing(false);setNote('');}},'取消'),h(Button,{key:'go',primary:true,disabled:busy||!note.trim(),onClick:()=>run(async()=>{await gen.redraw(job,note.trim());setRedrawing(false);setNote('');})},'重画')]:
      state==='candidate'?[h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:drop},'不要'),
        figureKind?h(Button,{key:'redraw',disabled:busy,onClick:()=>dialog('redraw')},'重画…'):h(Button,{key:'redraw',disabled:busy,onClick:()=>setRedrawing(true)},'按意见重画'),
        changed?h(Button,{key:'replace',primary:true,disabled:busy,onClick:()=>accept({replace:true})},'仍用这张替换'):h(Button,{key:'yes',primary:true,disabled:busy||!sliced,title:sliced?undefined:'这张图不能自动切开',onClick:()=>accept()},kind==='avatar-sheet'?'采用全部':'采用')]:
      state==='save_failed'?[h(Button,{key:'no',className:'ap-gen-no',disabled:busy,onClick:drop},'不要'),h(Button,{key:'save',primary:true,disabled:busy,onClick:()=>run(()=>gen.retrySave(job))},'重试保存')]:
      state==='failed'?[h(Button,{key:'ok',disabled:busy,onClick:()=>run(async()=>{if(job)await gen.reject(job);gen.closeSheet();})},'知道了'),h(Button,{key:'again',primary:true,disabled:busy||kind==='background'&&!prompt.trim(),onClick:generate},figureKind?'调整后重试…':'重新生成')]:
      [kind==='settei'&&h(UploadButton,{key:'upload',label:'上传设定图',text:'上传替换',disabled:busy,onFile:file=>run(()=>importSettei(target.figureId,target.outfitKey,file))}),
        figureKind&&hash?h(Button,{key:'edit',disabled:busy,onClick:()=>dialog('edit')},'改图…'):null,
        h(Button,{key:'go',primary:true,disabled:busy||!ready||kind==='background'&&!prompt.trim(),title:ready?undefined:reason,onClick:figureKind&&hash?()=>dialog('redraw'):generate},h(Glyph,{name:'spark'}),figureKind?(hash?'重画…':'生成…'):hash?'重新生成':'生成')];
    const head=h('header',{className:'ap-gen-sheet-head'},h('h2',null,title),meta&&h('span',{className:'ap-gen-sheet-meta'},meta),h(IconButton,{icon:'close',label:'关闭',disabled:busy,onClick:close}));
    return h(React.Fragment,null,
      h(Modal,{title:title+(meta?' · '+meta:''),className:'ap-gen-sheet'+(side.length?'':' is-wide'),onClose:close,busy,head,initialFocus:'dialog',
          foot:h('footer',{className:'ap-gen-foot'},busy&&h('span',{className:'ap-busy'},h(ForkSpinner),'正在处理…'),actions)},
        h('div',{className:'ap-gen-stage','data-kind':kind,'data-checker':transparent&&(state==='candidate'||state==='idle'&&hash)?true:undefined},stage),
        side.length>0&&h('div',{className:'ap-gen-side'},...side)),
      framing&&h(Modal,{title:'调整立绘',className:'ap-framer-modal',closable:false,onClose:()=>setFraming(null)},
        h(ImageFramer,{file:framing,square:false,onCancel:()=>setFraming(null),onDone:file=>{setFraming(null);accept({file});}})));
  }
  // ---------- The 生图 page (owner 2026-10-15, mock G1–G8) ----------
  // 「设定」: what generation draws from, in two columns — 人物 (外貌 and the identity board, all outfits) and the outfit
  // (picked from a compact menu shared with 编辑: 服装描述 and its 设定图, a tile with the same menu as a 差分's).
  // 「生成 N」: this outfit's requests and records — 待采用, 生成中, 生图失败, 已采用 — with their actions in the row;
  // 「生成…」 opens the dialog. A row picks its 差分 in the preview. Sections are spacing and headings.
  function genOutfitArt(binding,pack,figure,outfit) {
    outfit=figureOutfitView(figure,outfit);
    const packId=pack.manifest.id,manifest=outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey],bust=outfit&&outfitHead(outfit,manifest);
    if(bust)return h(BustArt,{binding,packId,bust,frame:CAST_FACE});
    const face=outfit&&selectPackAvatar({outfit,manifest,defaultEmotion:genDefaultId(figure,outfit)});
    if(face)return h(Thumb,{binding,packId,hash:face.hash,crop:face.crop,label:outfit.label,className:'ap-gen-outfit-thumb'});
    if(outfit?.settei)return h(Thumb,{binding,packId,hash:outfit.settei,label:outfit.label,className:'ap-gen-outfit-thumb'});
    return h(Silhouette,{figure});
  }
  const genOutfitKind=(pack,outfit)=>outfitHead(outfit,outfit?.sprite&&pack.sprites?.[outfit.sprite.manifestKey])?'bust':'thumb';
  // The outfit menu: thumbnails and names, a search box once the list is long, ↑ ↓ to walk it. Picking one selects it
  // for the whole figure page (编辑 shows the same outfit).
  const GEN_OUTFIT_SEARCH=6;
  function GenOutfitMenu({binding,pack,figure,outfit,onOutfit,close}) {
    const [query,setQuery]=React.useState(''),q=query.trim().toLowerCase(),list=figure.outfits.filter(o=>!q||String(o.label||'').toLowerCase().includes(q));
    const keys=e=>{const items=[...e.currentTarget.querySelectorAll('[role=menuitemradio]')],i=items.indexOf(document.activeElement),n=items.length,next={ArrowDown:i+1,ArrowUp:i-1,Home:0,End:n-1}[e.key];
      if(next===undefined||!n)return;e.preventDefault();items[(next+n)%n].focus();};
    return h('div',{className:'ap-gen-outfit-menu',onKeyDown:keys},
      figure.outfits.length>GEN_OUTFIT_SEARCH&&h(SearchBox,{label:'搜索服装',placeholder:'搜索',value:query,onChange:setQuery,className:'is-compact'}),
      h('div',{className:'ap-gen-outfit-list'},list.map(o=>h('button',{key:o.key,type:'button',role:'menuitemradio','aria-checked':o.key===outfit.key,className:'ap-menu-item ap-gen-outfit-item',
          onClick:()=>{close();if(o.key!==outfit.key)onOutfit(o.key);}},
        h('span',{className:'ap-gen-outfit-art','data-kind':genOutfitKind(pack,o)},genOutfitArt(binding,pack,figure,o)),h('span',{className:'ap-gen-outfit-label'},o.label),
        o.settei&&h('span',{className:'ap-gen-outfit-has',title:'已有设定图'},h(Glyph,{name:'check'})))),
        !list.length&&h('p',{className:'ap-gen-outfit-none'},'没有找到')));
  }
  function GenOutfitPicker({binding,pack,figure,outfit,onOutfit}) {
    const face=h('span',{className:'ap-gen-outfit-art','data-kind':genOutfitKind(pack,outfit)},genOutfitArt(binding,pack,figure,outfit)),name=h('span',{className:'ap-gen-outfit-label'},outfit.label);
    if(figure.outfits.length<2)return h('span',{className:'ap-gen-outfit-pick is-single'},h('span',{className:'ap-gen-outfit-trigger'},face,name));
    return h(Popover,{label:'选择服装',className:'ap-gen-outfit-pick',limit:420,
      trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gen-outfit-trigger','aria-haspopup':'menu','aria-expanded':open,'aria-label':'服装：'+outfit.label,title:'换一套服装（与「编辑」同步）',onClick:toggle},face,name,h(Glyph,{name:'chevDown'})),
      content:close=>h(GenOutfitMenu,{binding,pack,figure,outfit,onOutfit,close})});
  }
  const GEN_HELP={
    records:'这套服装的生成记录：生成中、待采用、生图失败和已采用的都在这里，编辑页的格子同步显示。',
    board:'人物所有服装共用的长相母版，生成设定图、立绘和头像时最先照它画。'};
  // ---------- 人物设定图 (identity settei ui, owner 2026-10) ----------
  // The figure's identity board (Figure.identitySettei, asset-gen-contract.md), in 「生图」's 人物 column under 外貌: the
  // picture (a click opens it large) and, in the large view, a pack's own readable version.
  // Upload / 上传替换 is the full resource write (identityBoard.upload); 人物 ⋯ → 「删除人物设定图…」 is its removal (the
  // same write without the field) and asks first. Nothing here generates or accepts it.
  // private fork (settei ui, owner 2026-10): the palette (Figure.identitySettei.palette) is not shown. It is evidence the
  // portable asset CLI samples from the board itself (asset-cli-contract.md); no prompt reads it, it only feeds the version
  // hash, and the board already shows its colours. The data stays as the CLI wrote it.
  // UI standard R2: a content hash (our own SHA-256 version) is not a version a person reads; only a pack's own label shows.
  const humanVersion=v=>typeof v==='string'&&v.trim()&&!/^(sha256[:-])?[0-9a-f]{16,}$/i.test(v.trim())?v.trim():'';
  function IdentitySetteiSheet({binding,pack,figure,busy,onReplace,onClose}) {
    const board=figure.identitySettei,close=()=>{if(!busy)onClose();};
    const head=h('header',{className:'ap-gen-sheet-head'},h('h2',null,'人物设定图'),h('span',{className:'ap-gen-sheet-meta'},figure.name),h(IconButton,{icon:'close',label:'关闭',disabled:!!busy,onClick:close}));
    const version=humanVersion(board.version);
    return h(Modal,{title:'人物设定图 · '+figure.name,className:'ap-gen-sheet ap-identity-sheet'+(version?'':' is-wide'),onClose:close,busy:!!busy,head,initialFocus:'dialog',
        foot:h('footer',{className:'ap-gen-foot'},busy&&h('span',{className:'ap-busy'},h(ForkSpinner),'正在上传…'),
          h(UploadButton,{label:'上传人物设定图',text:'上传替换',disabled:!!busy,onFile:onReplace}))},
      h('div',{className:'ap-gen-stage','data-kind':'settei'},h(Thumb,{key:board.board,binding,packId:pack.manifest.id,hash:board.board,label:'人物设定图',className:'ap-gen-full'})),
      version&&h('div',{className:'ap-gen-side'},
        h('div',{className:'ap-gen-used'},h('span',{className:'ap-prop-key'},'版本'),h('span',{className:'ap-identity-version'},version))));
  }
  function IdentitySetteiRow({binding,pack,figure,busy,onUpload,help}) {
    const board=figure.identitySettei,[open,setOpen]=React.useState(false);
    React.useEffect(()=>{if(!board)setOpen(false);},[!board]);
    const pick=e=>{const file=e.target.files?.[0];e.target.value='';if(file)onUpload(file);};
    return h(ForkInlineRow,{label:'设定图',help,multiline:true,wide:true,className:'ap-gen-row is-identity'},
      h('div',{className:'ap-gen-settei ap-identity'},
        board?h('div',{className:'ap-gen-cell','data-shape':'settei','data-gen-slot':'identity-settei'},
            h('button',{type:'button',className:'ap-gen-tile','data-state':'filled','aria-label':'查看人物设定图',title:'查看人物设定图',onClick:()=>setOpen(true)},
              h('span',{className:'ap-gen-art'},h(Thumb,{key:board.board,binding,packId:pack.manifest.id,hash:board.board,label:'人物设定图',className:'ap-gen-thumb'})))):
          h('label',{className:'ap-gen-cell ap-identity-add','data-shape':'settei','data-disabled':busy||undefined,title:'上传人物设定图'},
            h('span',{className:'ap-gen-art'},h(Glyph,{name:'upload'})),
            h('input',{type:'file',accept:'image/png,image/webp,image/jpeg','aria-label':'上传人物设定图',disabled:!!busy,onChange:pick})),
        !board&&h('p',{className:'ap-empty'},'还没有人物设定图')),
      open&&board&&h(IdentitySetteiSheet,{binding,pack,figure,busy,onReplace:onUpload,onClose:()=>setOpen(false)}));
  }
  // The outfit 设定图 tile: the same menu language as a 差分 tile (查看大图 / 重画… / 改图… / 替换为本地图片… / 删除设定图…;
  // a waiting one 采用 / 不要 / 重画…; a request in flight 取消), an empty one ✦ (the dialog) with an upload beside it.
  function GenSetteiTile({gen,binding,pack,figure,outfit,settei:actions,run,ask,onDialog}) {
    const packId=pack.manifest.id,target={packId,figureId:figure.id,outfitKey:outfit.key,kind:'settei'},cell=genCell(gen,target),hash=outfit.settei||null;
    const input=React.useRef(null),label='「'+outfit.label+'」的设定图';
    const pickFile=()=>input.current?.click?.();
    const file=h('input',{ref:input,type:'file',tabIndex:-1,'aria-hidden':true,hidden:true,accept:'image/png,image/webp,image/jpeg','aria-label':'上传'+label,
      onChange:e=>{const f=e.target.files?.[0];e.target.value='';if(f)run('上传',()=>actions.upload(figure.id,outfit.key,f));}});
    const art=cell.state==='candidate'?h(CandidateArt,{gen,jobId:cell.job.jobId,className:'ap-gen-img'}):hash?h(Thumb,{key:hash,binding,packId,hash,label,className:'ap-gen-thumb'}):h(Glyph,{name:'spark'});
    if(!hash&&cell.state==='idle')return h('div',{className:'ap-gen-settei-cell'},
      h('div',{className:'ap-gen-cell','data-shape':'settei','data-gen-slot':'settei'},h('button',{type:'button',className:'ap-gen-tile','data-state':'empty','aria-label':'生成'+label,title:'生成设定图',onClick:()=>onDialog(target,'gen')},h('span',{className:'ap-gen-art'},art))),
      h(IconButton,{icon:'upload',label:'上传设定图',onClick:pickFile}),file);
    const item=(icon,text,onClick,extra={})=>h(MenuItem,{key:text,danger:extra.danger,disabled:extra.disabled,title:extra.title,onClick},h(Glyph,{name:icon}),h('span',null,text));
    const menu=close=>{const go=fn=>()=>{close();fn();};
      return h('div',{className:'ap-cell-menu',onKeyDown:genMenuKeys},h('div',{className:'ap-cell-menu-head','aria-hidden':true},h('b',null,'服装设定图'),h('small',null,outfit.label+(cell.state==='idle'?'':' · '+GEN_CELL_WORDS[cell.state]))),
        cell.state==='candidate'?[item('check','采用',go(()=>run('',()=>gen.accept(cell.job)))),item('close','不要',go(()=>run('',()=>gen.reject(cell.job)))),item('reset','重画…',go(()=>onDialog(target,'redraw'))),
            item('edit','改图…',go(()=>onDialog(target,'edit'))),item('eye','查看大图',go(()=>gen.openSheet(target)))]:
          cell.state==='running'||cell.state==='queued'?[item('close',cell.state==='queued'?'取消排队':'取消',go(()=>run('',()=>cell.state==='queued'?gen.dequeue(target):gen.cancel(cell.job)))),item('eye','查看进度',go(()=>gen.openSheet(target)))]:
          cell.state==='failed'?[h('p',{key:'warn',className:'ap-cell-menu-warn'},h(Glyph,{name:'warning'}),cell.error),item('reset','重试',go(()=>run('',()=>gen.start(target,cell.job?.userPrompt?{userPrompt:cell.job.userPrompt}:{})))),
            item('sliders','调整后重试…',go(()=>onDialog(target,'gen'))),item('upload','上传本地图片…',go(pickFile))]:
          [item('eye','查看大图',go(()=>gen.openSheet(target))),item('reset','重画…',go(()=>onDialog(target,'redraw'))),item('edit','改图…',go(()=>onDialog(target,'edit'))),item('upload','替换为本地图片…',go(pickFile)),
            actions.remove&&h('div',{key:'sep',className:'ap-menu-sep',role:'separator'}),
            actions.remove&&item('remove','删除设定图…',go(()=>ask({title:'删除'+label+'？',body:'这张设定图会从「'+outfit.label+'」移除；已有的立绘和头像不受影响。',confirmLabel:'删除',danger:true,onConfirm:()=>actions.remove(figure.id,outfit.key)})),{danger:true})]);};
    return h('div',{className:'ap-gen-settei-cell'},
      h('div',{className:'ap-gen-cell','data-shape':'settei','data-gen-slot':'settei'},
        h(Popover,{label:'服装设定图 操作',className:'ap-cell-menu-anchor',limit:420,float:true,fit:true,
          trigger:({toggle,open})=>h('button',{type:'button',className:'ap-gen-tile','data-state':cell.state==='idle'?'filled':cell.state,'aria-label':label+(cell.state==='idle'?'':'：'+GEN_CELL_WORDS[cell.state]),
              // private fork (cell menu input, owner 2026-10-17): mouse click = 查看大图 / 查看进度; menu on right click / Shift+F10 / tap.
              ...cellMenuTrigger({open,toggle,onPrimary:cell.state==='failed'?null:()=>gen.openSheet(target)})},
            h('span',{className:'ap-gen-art'},art,cell.state!=='idle'&&h(GenFaceMarks,{cell}))),
          content:menu})),file);
  }
  // One row of 「生成」: a request (待采用 / 生成中 / 排队中 / 生图失败) or an adopted record.
  function GenRecordRow({gen,binding,pack,figure,outfit,item,names,selected,onPick,onDialog}) {
    const packId=pack.manifest.id,[busy,setBusy]=React.useState(false),[error,setError]=React.useState('');
    const job=item.job,elapsed=useElapsed(job?.createdAt,item.state==='running'&&!!job);
    const run=fn=>{setBusy(true);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(false));};
    const view={sprite:'立绘',avatar:'头像'}[item.kind],name=item.kind==='settei'?'服装设定图':item.kind==='avatar-sheet'?'八个表情头像':(names[item.emotionId]||'差分')+' · '+view;
    const target=item.kind==='avatar-sheet'?{packId,figureId:figure.id,outfitKey:outfit.key,kind:'avatar-sheet'}:item.kind==='settei'?{packId,figureId:figure.id,outfitKey:outfit.key,kind:'settei'}:{packId,figureId:figure.id,outfitKey:outfit.key,kind:item.kind,emotionId:item.emotionId};
    const manifest=outfit.sprite&&pack.sprites?.[outfit.sprite.manifestKey],slot=item.kind==='settei'?outfit.settei:item.kind==='sprite'?genOwnSprite(outfit,manifest,item.emotionId):item.kind==='avatar'?outfit.avatars?.[item.emotionId]:null;
    const basis=job?.references?.some(r=>r.hash&&r.hash===outfit.settei)?'照服装设定图':item.kind==='settei'?'照设定文字':'照设定文字';
    const art=item.state==='candidate'?h(CandidateArt,{gen,jobId:job.jobId}):item.state==='running'?h(ForkSpinner,{key:'run',fill:true}):item.state==='queued'?h(Glyph,{name:'spark'}):
      item.state==='failed'?h(Glyph,{name:'warning'}):slot?h(Thumb,{binding,packId,hash:slot,label:name}):h(Glyph,{name:'check'});
    const sub=item.state==='candidate'?'待采用 · '+basis+' · '+genWhen(job.createdAt):item.state==='running'?'生成中 · '+basis:item.state==='queued'?'排队中':
      item.state==='failed'?h('span',{className:'ap-gen-warn-ink'},genFailText(job?.error?.message||item.error||'')):'已采用 · '+genWhen(item.at)+(item.prompt?' · '+item.prompt:'');
    const figureSlot=['sprite','avatar','settei'].includes(item.kind);
    const side=item.state==='candidate'?(figureSlot?[h(IconButton,{key:'no',icon:'close',label:'不要',disabled:busy,onClick:()=>run(()=>gen.reject(job))}),
        h(IconButton,{key:'redraw',icon:'reset',label:'重画…',disabled:busy,onClick:()=>onDialog(target,'redraw')}),
        h(Popover,{key:'more',label:'更多 '+name,className:'ap-kind-menu-anchor',float:true,trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'更多 '+name,'aria-expanded':open,disabled:busy,onClick:toggle}),
          content:close=>h(React.Fragment,null,h(MenuItem,{onClick:()=>{close();onDialog(target,'edit');}},h(Glyph,{name:'edit'}),h('span',null,'改图…')),
            h(MenuItem,{onClick:()=>{close();gen.openSheet(target);}},h(Glyph,{name:'eye'}),h('span',null,'查看大图')))}),
        h(Button,{key:'yes',className:'ap-gen-row-yes',disabled:busy,onClick:()=>run(()=>gen.accept(job))},'采用')]:
        [h(IconButton,{key:'no',icon:'close',label:'不要',disabled:busy,onClick:()=>run(()=>gen.reject(job))}),h(Button,{key:'view',className:'ap-gen-row-yes',disabled:busy,onClick:()=>gen.openSheet(target)},'查看')]):
      item.state==='running'?[job&&h('span',{key:'time',className:'ap-gen-row-time'},elapsed),h(IconButton,{key:'stop',icon:'close',label:'取消',disabled:busy||!job,onClick:()=>run(()=>gen.cancel(job))})]:
      item.state==='queued'?[h(IconButton,{key:'stop',icon:'close',label:'取消排队',disabled:busy,onClick:()=>gen.dequeue(target)})]:
      item.state==='failed'?[figureSlot&&h(Button,{key:'retry',className:'ap-gen-row-yes',disabled:busy,onClick:()=>run(()=>gen.start(target,job?.userPrompt?{userPrompt:job.userPrompt}:{}))},h(Glyph,{name:'reset'}),'重试'),
        figureSlot&&h(IconButton,{key:'adjust',icon:'sliders',label:'调整后重试…',disabled:busy,onClick:()=>onDialog(target,'gen')}),
        job&&h(IconButton,{key:'drop',icon:'remove',label:'移除这条',disabled:busy,onClick:()=>run(()=>gen.reject(job))})]:
      [h('span',{key:'done',className:'ap-gen-row-done'},h(Glyph,{name:'check'}),'已采用')];
    const pickable=['sprite','avatar'].includes(item.kind);
    return h('li',{role:'option','aria-selected':!!selected,className:'ap-gen-row-item','data-state':item.state,onClick:pickable?()=>onPick(item.kind,item.emotionId):undefined},
      h('span',{className:'ap-gen-row-art','data-kind':item.kind,'data-state':item.state},art),
      h('span',{className:'ap-gen-row-text'},h('b',null,name),h('small',null,sub),error&&h('small',{className:'ap-field-error',role:'alert'},error)),
      h('span',{className:'ap-gen-row-side',onClick:e=>e.stopPropagation()},side));
  }
  const GEN_ROW_ORDER={candidate:0,running:1,queued:1,failed:2,adopted:3};
  function FigureGenTab({binding,pack,figure,outfit,onOutfit,write,writeOutfit,gen,settei,identityBoard,picked,onPick,onDialog}) {
    const packId=pack.manifest.id;
    const [busy,setBusy]=React.useState(''),[error,setError]=React.useState(''),[confirm,setConfirm]=React.useState(null),[accepting,setAccepting]=React.useState(false);
    React.useEffect(()=>{gen.open();},[]);
    const run=(label,fn)=>{setBusy(label);setError('');return Promise.resolve().then(fn).catch(e=>setError(errorText(e))).finally(()=>setBusy(''));};
    const help=(key,label)=>h(Help,{text:GEN_HELP[key],label:label+' 说明'});
    const board=figure.identitySettei;
    const uploadBoard=file=>run('上传',()=>identityBoard.upload(figure.id,file));
    const removeBoard=()=>setConfirm({title:'删除人物设定图？',body:'「'+figure.name+'」的人物设定图将从素材包中移除，已有的服装设定图和立绘不受影响。',confirmLabel:'删除',danger:true,
      onConfirm:()=>identityBoard.remove(figure.id)});
    const boardMenu=board&&identityBoard&&h(Popover,{label:'人物操作',className:'ap-kind-menu-anchor',trigger:({toggle,open})=>h(IconButton,{icon:'more',label:'人物操作','aria-expanded':open,disabled:!!busy,onClick:toggle}),
      content:close=>h(MenuItem,{danger:true,onClick:()=>{close();removeBoard();}},h(Glyph,{name:'remove'}),h('span',null,'删除人物设定图…'))});
    const person=h('div',{className:'ap-gen-col',role:'group','aria-label':'人物'},
      h('h5',{className:'ap-gen-col-head'},h('span',null,'人物'),boardMenu&&h('span',{className:'ap-sub-tools'},boardMenu)),
      h(ForkInlineRow,{label:'外貌',multiline:true,wide:true,className:'ap-gen-row'},
        h(GenText,{label:'外貌',placeholder:'例：银色长发，红色眼睛，娇小',value:figure.identityAppearance||'',onCommit:v=>write(()=>({identityAppearance:v||null}))})),
      identityBoard&&h(IdentitySetteiRow,{binding,pack,figure,busy,onUpload:uploadBoard,help:help('board','人物设定图')}));
    const dialogs=confirm&&h(ConfirmDialog,{...confirm,onClose:()=>setConfirm(null)});
    const noBasis=!genBasis(figure,outfit);
    // private fork (settei ui, owner 2026-10): no 「设定」 heading over the two columns; 人物 and 服装 are the headings.
    if(!outfit)return h('div',{className:'ap-gen-tab'},h(ErrorBox,{error}),h('section',{className:'ap-gen-block','aria-label':'设定'},h('div',{className:'ap-gen-basis'},person)),h('p',{className:'ap-empty'},'还没有服装'),dialogs);
    const outfitCol=h('div',{className:'ap-gen-col',role:'group','aria-label':'服装'},
      h('h5',{className:'ap-gen-col-head'},h('span',null,'服装'),h(GenOutfitPicker,{binding,pack,figure,outfit,onOutfit})),
      h(ForkInlineRow,{label:'服装描述',multiline:true,wide:true,className:'ap-gen-row'},h(GenText,{key:outfit.key,label:'服装描述',placeholder:'例：深蓝水手服，红色领结',value:outfit.outfitAppearance||'',
        onCommit:v=>writeOutfit(o=>{const next={...o};if(v)next.outfitAppearance=v;else delete next.outfitAppearance;return next;})})),
      h(ForkInlineRow,{label:'设定图',multiline:true,wide:true,className:'ap-gen-row is-settei'},
        h(GenSetteiTile,{gen,binding,pack,figure,outfit,settei,run,ask:setConfirm,onDialog})));
    // 「生成」: requests of this outfit (live jobs and the ones queued), then its adopted records, newest first.
    const names=Object.fromEntries(figureEditorEmotions(figure).map(r=>[r.id,r.label])),items=[],seenKeys=new Set();
    const mine=t=>t.figureId===figure.id&&t.outfitKey===outfit.key&&['sprite','avatar','settei','avatar-sheet'].includes(t.kind);
    for(const j of gen.jobs||[]){if(!mine(j.target)||!genShown(j))continue;const st=j.status==='running'?'running':j.status==='failed'?'failed':'candidate';
      items.push({id:j.jobId,kind:j.target.kind,emotionId:j.target.emotionId,state:st,job:j,at:j.createdAt});seenKeys.add(genKey(j.target)+(st==='running'?'':'|'+j.jobId));}
    for(const [key,value] of Object.entries(gen.pending)){const [kind,figureId,outfitKey,emotionId]=key.split('/');if(figureId!==figure.id||outfitKey!==outfit.key||!['sprite','avatar','settei'].includes(kind))continue;
      if(seenKeys.has(key))continue;items.push({id:'pending:'+key,kind,emotionId:emotionId||undefined,state:value==='queued'?'queued':'running',job:null,at:Date.now()});}
    (outfit.genRecords||[]).forEach((r,i)=>items.push({id:'record:'+i,kind:r.kind,emotionId:r.emotionId,state:'adopted',at:r.at,prompt:r.prompt}));
    items.sort((a,b)=>GEN_ROW_ORDER[a.state]-GEN_ROW_ORDER[b.state]||b.at-a.at);
    const waiting=items.filter(i=>i.state==='candidate'&&i.job&&['sprite','avatar','settei'].includes(i.kind));
    const acceptAll=()=>{setAccepting(true);setError('');gen.acceptAll(waiting.map(i=>i.job)).finally(()=>setAccepting(false));};
    const anyRow=rows=>rows.find(r=>r.id===(picked?.emotionId))||figureEditorEmotions(figure)[0];
    const genNew=()=>{const r=anyRow(figureEditorEmotions(figure));if(r)onDialog({packId,figureId:figure.id,outfitKey:outfit.key,kind:picked?.kind==='avatar'?'avatar':'sprite',emotionId:r.id},'gen');};
    const tools=h('span',{className:'ap-sub-tools'},
      h(Button,{className:'ap-manage ap-gen-new',disabled:noBasis&&!figureEditorEmotions(figure).length,title:'生成一张立绘或头像',onClick:genNew},h(Glyph,{name:'spark'}),'生成…'),
      waiting.length>0&&h(Button,{className:'ap-manage',primary:true,disabled:accepting,onClick:acceptAll},accepting?'正在采用…':'全部采用'));
    const list=items.length?h(WindowedItems,{className:'ap-gen-rows',label:'生成记录',items,render:item=>h(GenRecordRow,{key:item.id,gen,binding,pack,figure,outfit,item,names,
        selected:picked&&item.kind===picked.kind&&item.emotionId===picked.emotionId,onPick,onDialog})}):h('p',{className:'ap-empty'},'还没有生成过');
    // The channel ⚠ is said once: here, or in the open dialog / sheet that hit it.
    return h('div',{className:'ap-gen-tab'},
      gen.problem&&!gen.sheet&&!gen.dialog&&h('p',{className:'ap-gen-problem',role:'alert'},h(Glyph,{name:'warning'}),h('span',null,GEN_PROBLEMS[gen.problem])),
      h(ErrorBox,{error}),
      h('section',{className:'ap-gen-block','aria-label':'设定'},
        noBasis&&h(HintLine,{text:'还没有设定：写几句外貌和服装描述，或上传一张设定图'}),
        h('div',{className:'ap-gen-basis'},person,outfitCol)),
      h('section',{className:'ap-gen-block','aria-label':'生成'},
        h('h4',{className:'ap-sub ap-gen-head'},'生成',items.length>0&&h('span',null,items.length),help('records','生成'),tools),
        list),
      busy&&h('p',{className:'ap-loading',role:'status'},h(ForkSpinner),busy==='上传'?'正在上传…':'正在处理…'),
      dialogs);
  }
  // ---------- 设置 → 生图 (owner 2026-10): the shared layer of every whole-image request, for all characters ----------
  // One folded section per kind with its template text (asset-generation.js prompts / setPrompt; the default stays in the
  // template file). The {{slots}} carry the character, the outfit, the 差分 and the cell's own prompt, so an edit keeps
  // them (checked here as the field's own validation and again on write). Enter or leaving the field saves (Shift+Enter: a
  // new line); a blue dot marks an edited kind and ⟲ 恢复默认 drops the edit. CG has no in-app generator, so no section.
  const GEN_PROMPT_KINDS={sprite:'立绘',avatar:'头像','avatar-sheet':'八个表情',settei:'服装设定图','identity-settei':'人物设定图',background:'背景'};
  const GEN_PROMPT_USE={sprite:'生成立绘',avatar:'生成单个头像','avatar-sheet':'一次生成八个表情',settei:'生成服装设定图','identity-settei':'生成人物设定图',background:'生成背景'};
  const genSlots=text=>[...new Set([...String(text).matchAll(/\{\{(\w+)\}\}/g)].map(m=>m[1]))];
  function GenPromptSettings({call}) {
    const [data,setData]=React.useState(null),[error,setError]=React.useState(''),[alert,setAlert]=React.useState(''),[saving,setSaving]=React.useState(''),[confirm,setConfirm]=React.useState(null),[epoch,setEpoch]=React.useState(0);
    const current=React.useRef(null),queue=React.useRef(Promise.resolve());
    const accept=value=>{current.current=value;setData(value);};
    const load=()=>call('getAssetGenPrompts').then(r=>{accept(r.data);setError('');},e=>setError(errorText(e)));
    React.useEffect(()=>{load();},[call]);
    // Serial writes on the newest revision; a refused one shows the stored text again with the reason.
    const write=(kind,text)=>{const task=queue.current.then(async()=>{
      setSaving('saving');setAlert('');
      try{accept((await call('setAssetGenPrompt',{kind,text,expectedRevision:current.current.revision})).data);setSaving('saved');}
      catch(e){setSaving('');setAlert(e?.code==='REVISION_CONFLICT'?e.message:errorText(e));if(e?.code==='REVISION_CONFLICT')await load();setEpoch(n=>n+1);}
    });queue.current=task.catch(()=>{});return task;};
    const known=new Set((data?.kinds||[]).flatMap(k=>k.required));
    const problem=k=>text=>{
      const used=genSlots(text),unknown=used.filter(v=>!known.has(v)),missing=k.required.filter(v=>!used.includes(v));
      return !text.trim()?'不能为空':unknown.length?'没有这个占位符：'+unknown.map(v=>'{{'+v+'}}').join(' '):missing.length?'请保留 '+missing.map(v=>'{{'+v+'}}').join(' '):'';
    };
    const section=k=>{const name=GEN_PROMPT_KINDS[k.kind];
      return h(StageSection,{key:k.kind,title:name,meta:k.edited?h(ForkOverrideDot,{label:'已改'}):undefined,foldKey:'gen-prompt:'+k.kind,defaultFolded:true,
        help:GEN_PROMPT_USE[k.kind]+'时附上的固定要求，所有人物共用。{{…}} 是每次填入的内容，要保留。',
        action:k.edited&&h(IconButton,{icon:'reset',label:'恢复默认',onClick:()=>setConfirm(k.kind)})},
        h(ForkInlineField,{key:k.kind+'/'+epoch,kind:'text',multiline:true,lines:true,wide:true,hideLabel:true,label:name,className:'ap-gen-prompt-field',
          value:k.text.trimEnd(),maxLength:12000,validate:problem(k),onCommit:text=>write(k.kind,text)}));};
    return h('div',{className:'ap-ui ap-gen-prompts'},
      h('p',{className:'ap-save-state',role:'status'},saving==='saving'?'正在保存…':saving==='saved'?'已保存':''),
      !data&&!error&&h(Loading),
      h(ErrorBox,{error,reload:load}),
      alert&&h('p',{className:'ap-alert',role:'alert'},h(Glyph,{name:'warning'}),alert),
      data&&data.kinds.filter(k=>GEN_PROMPT_KINDS[k.kind]).map(section),
      confirm&&h(ConfirmDialog,{title:'恢复默认',body:'「'+GEN_PROMPT_KINDS[confirm]+'」改过的内容会丢失。',confirmLabel:'恢复默认',onClose:()=>setConfirm(null),
        onConfirm:()=>write(confirm,null)}));
  }
