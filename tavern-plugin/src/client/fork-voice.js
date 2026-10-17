// private fork: host speech descriptors only; the browser never registers voices or grants.
// @include fork-pack-playback.cjs
let forkTtsScope;
const forkVoicePlayer = createPackVoicePlayer({now: forkForeground.now, schedule: forkForeground.setInterval, cancel: forkForeground.clearInterval, getClient:() => forkTtsScope?.get('ttsClient'),
    prepareAudio:(audio,blob) => {forkForeground.media(audio);forkStageAudio.prepareVoice(audio,blob);audio.preservesPitch=true;audio.playbackRate=forkStageReading.get().voiceRate;},
    onAudio:audio => forkStageAudio.voice(Boolean(audio))});
function forkVoiceObservedTurn(_session,_turn,running) { return running; }
// private fork: the bound figure owns voice identity; language and text completeness gate speech.
function forkPackSpeechInput(segment, config) {
    const character = forkBubbleCharacter(config,segment);
    if (segment.kind !== 'bubble' || segment.streaming || !character?.voice) return null;
    const language = character.voiceLanguage || character.voiceLang || config.stage?.textLanguage || 'zh';
    const sameLanguage = language === (config.stage?.textLanguage || 'zh');
    if (segment.singleVoiceText && !sameLanguage) return null;
    const text = segment.speech ?? (sameLanguage ? segment.text : '');
    if (!text || !/[\p{L}\p{N}]/u.test(text) || text.length > 1500) return null;
    return {text, mood:forkBubbleMood(segment.mood,forkBubbleMoodList(config,character.alias))?.id || character.defaultEmotion || null};
}
// private fork: native handles keep look-ahead local; no host queue or polling ticker.
function forkStageVoiceWindow(pages, page, paused) {
    if (paused) return [];
    const limit = pages[page]?.voice && !pages[page].pending ? 8 : 7;
    return pages.slice(page).filter(item => item.voice && !item.pending).slice(0,limit).map(item => item.voice);
}
function useForkVoiceBubbles(props,segments,_cardPath,config) {
    useForkPackRevision(() => Boolean(forkTtsScope?.get('ttsClient')?.available()));
    const client=forkTtsScope?.get('ttsClient');
    const owner=String(props.sessionId)+':'+String(props.voiceScope);
    const active = React.useSyncExternalStore(forkGalActive.subscribe,forkGalActive.get);
    const available = client?.available() && !props.interrupted && config?.voice?.enabled !== false;
    React.useEffect(()=>{
        const invalidate=event=>{ if (event?.type === 'unavailable') forkVoicePlayer.invalidate(); };
        const off=forkPackTransport?.service.subscribe(invalidate), host=tavernSessionSignals?.subscribe(props.sessionId,'tavern-state',invalidate);
        return()=>{off?.();host?.();if(forkVoicePlayer.get()?.owner===owner)forkVoicePlayer.stop();};
    },[owner]);
    const voiceOrdinals = new Map(forkGalParagraphs([{segments,streaming:false}]).map((unit,n)=>[unit.index,n]));
    const handles = Object.fromEntries(available ? segments.flatMap((segment,index)=>{
        const input = forkPackSpeechInput(segment,config);
        if (!input) return [];
        const {text,mood} = input;
        const id=JSON.stringify([index,text,mood,forkBubbleCharacter(config,segment)?.voiceKey]);
        const character = forkBubbleCharacter(config,segment);
        const cacheKey = JSON.stringify([props.sessionId,character.alias,character.voiceKey,character.voiceLanguage || character.voiceLang || config.stage?.textLanguage || 'zh',text,mood]);
        const selectionKey=props.stageSource ? JSON.stringify([props.sessionId,props.stageSource.nativeTurn,(props.stageParaBase||0)+(props.stageParaOffset||0)+(voiceOrdinals.get(index)||0)]) : undefined;
        const request={text,mood,owner,id,selectionKey,cacheKey:JSON.stringify([cacheKey,selectionKey])}, descriptor=()=>rpc('openAssetPackVoice',{alias:character.alias},props.sessionId);
        return [[index,{...request,player:forkVoicePlayer.get(),get error(){return forkVoicePlayer.getError(request);},prefetch:()=>forkVoicePlayer.prefetch(descriptor,request),
            click:options=>forkVoicePlayer.play(descriptor,{...request,handoff:options?.handoff===true})}]];
    }) : []);
    // Observe this message's failures as well as the active playback lease.
    React.useSyncExternalStore(forkVoicePlayer.subscribe, () => {
        const player = forkVoicePlayer.get();
        return JSON.stringify([available && player?.owner === owner ? [player.id,player.loading,player.error,Boolean(player.audio),player.audio?.paused] : null,
            Object.values(handles).map(handle => forkVoicePlayer.getError(handle))]);
    });
    React.useEffect(()=>{
        if (active===props.sessionId || !props.voiceAuto || !available) return;
        for (const handle of Object.values(handles)) void handle.prefetch();
    },[active,props.sessionId,props.voiceAuto,available,JSON.stringify(Object.values(handles).map(handle=>handle.id))]);
    return handles;
}
function ForkVoiceButton({voice}) {
    const current=voice.player?.owner===voice.owner&&voice.player?.id===voice.id?voice.player:null;
    const failure = current?.error || voice.error;
    const error = {QWEN_INVALID_TEXT:'这句没有可朗读内容或被 Qwen 拒绝，请修改台词后重播',VOICE_NOT_FOUND:'声音绑定未解析，请重新选择该人物的声音','voice-unbound':'声音绑定未解析，请重新选择该人物的声音',QWEN_MODEL_NOT_FOUND:'Qwen 当前服务无法访问此配音模型（404），请在百炼控制台检查模型开通状态与区域',QWEN_RESOURCE_NOT_FOUND:'Qwen 语音服务资源不存在（404），请检查区域、模型与音色',QWEN_AUDIO_NOT_FOUND:'Qwen 合成音频下载失败（404），请重试',QWEN_REQUEST_FAILED:'Qwen 语音服务请求失败'}[failure] || failure;
    const state = error ? 'error' : current?.loading ? 'loading' : current?.audio ? (current.audio.paused ? 'paused' : 'playing') : 'idle';
    const label = {idle:'合成并播放',loading:'正在准备语音',playing:'暂停播放',paused:'继续播放',error:'重试语音'}[state];
    const h = React.createElement;
    const path = state === 'playing' ? 'M6 4h4v16H6zm8 0h4v16h-4z' : state === 'error' ? 'M11 4h2v10h-2zm0 13h2v3h-2z' : 'M7 4v16l14-8z';
    const click = current?.audio && !current.error ? event => {
        event?.stopPropagation();
        forkLipSync.wake();
        if (current.audio.paused) current.audio.play().catch(() => {});
        else current.audio.pause();
    } : voice.click;
    return h('button',{type:'button',className:'fork-voice-button','data-voice-state':state,'aria-label':label,'aria-busy':state==='loading',disabled:state==='loading',title:error||label,onClick:click},
        state==='error'?h('span',{'aria-hidden':true},'⚠'):state==='loading'?h(ForkSpinner,{className:'fork-voice-spinner'}):h('svg',{width:12,height:12,viewBox:'0 0 24 24','aria-hidden':true},h('path',{d:path,fill:'currentColor'})));
}
