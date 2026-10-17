// private fork: React consumes the session runtime; it never owns an observation loop.
const forkStageConsumers = new Map();
const forkStageEmptySnapshot = createStageRuntimeState();
const forkStageEmptyStore = {select(fn) {
    const value = fn(forkStageEmptySnapshot);
    return {getSnapshot:() => value,subscribe:() => () => {},dispose() {}};
}};
function useForkStageSelector(sessionId, select, equal = Object.is) {
    const store = forkStageSessions.get(sessionId) || forkStageEmptyStore;
    const selector = React.useMemo(() => store.select(select, equal), [store]);
    React.useEffect(() => () => selector.dispose(), [selector]);
    return React.useSyncExternalStore(selector.subscribe, selector.getSnapshot);
}
const forkStageUiEqual = (a, b) => Object.keys(a).every(key => Object.is(a[key], b[key]));
function useForkStageModHistory(sessionId) {
    const [history,setHistory]=React.useState(null);
    React.useEffect(()=>{
        let active=true,reading=false,dirty=false;
        async function read() {
            if(reading){dirty=true;return;}
            reading=true;
            try {const value=await rpc('getStageModHistory',{},sessionId);if(active)setHistory(value.turns);}
            catch (_) { /* A failed read never replaces a previously accepted history. */ }
            finally {reading=false;if(active && dirty){dirty=false;void read();}}
        }
        setHistory(null);void read();
        const stop=tavernSessionSignals.subscribe(sessionId,'stage-direction',read,read,read);
        return()=>{active=false;stop();};
    },[sessionId]);
    return history;
}
function useForkStageRuntime(sessionId) {
    const store = forkStageSessions.get(sessionId);
    const inputs = useForkStageSelector(sessionId, state => ({source:state.source, latestSource:state.latestSource,
        text:state.text, textIndex:state.textIndex, cursor:state.cursor}), forkStageUiEqual);
    const accepted = useForkStageSelector(sessionId, state => state.accepted);
    const director = useForkStageSelector(sessionId, state => state.director);
    const indicators = useForkStageSelector(sessionId, stageRuntimeIndicators, forkStageUiEqual);
    return {...inputs, accepted, director, indicators, store};
}

function useForkStagePosition(sessionId, runtime, parts, pages, {restored, onSelect}) {
    const writer = React.useMemo(() => {
        let storage = null;
        try { storage = localStorage; } catch (_) {}
        return forkGalPositionWriter(sessionId,storage,setTimeout,clearTimeout);
    },[sessionId]);
    const turn = runtime.source?.turn || 0;
    const page = Math.max(0,pages.findIndex(item => sameAnchor(item.anchor,runtime.cursor.anchor)));
    // private fork: the turn's text digest is hashed once per parts array, not on every render.
    const textDigest = React.useMemo(() => forkGalTextDigest(parts), [parts]);
    const anchor = pages[page]?.anchor;
    const active = {turn,page,textDigest,pageCount:pages.length,anchor:anchor ? {para:anchor.para,offset:anchor.offset} : null,latestSeenTurn:runtime.latestSource?.turn || turn};
    const ready = restored && !runtime.text.streaming && forkGalPositionReady(null,turn,parts,pages);
    React.useEffect(() => {
        if (ready) writer.write(active);
        else writer.discard();
    },[writer,turn,page,textDigest,ready,pages.length,active.latestSeenTurn]);
    React.useEffect(() => {
        window.addEventListener('pagehide',writer.flush);
        return () => {window.removeEventListener('pagehide',writer.flush);writer.flush();};
    },[writer]);
    return [page,index => {
        onSelect();
        if (index !== page) forkStageSessions.owner.navigate(sessionId,turn,index,index > page);
    },writer.saved,{
        textDigest,
        get readThrough() {return writer.readThrough;},
        markRead() {
            const current = pages[page];
            runtime.store.dispatch({type:'READ_PROGRESS',source:runtime.source,anchor:current?.anchor,readThrough:(current?.anchor.offset || 0) + (current?.text.length || 0)});
            if (!ready) return;
            writer.markRead({turn,page,textDigest}); writer.write(active);
        }
    }];
}

function forkStageVoiceHandle(sessionId, descriptor, config, paragraphId, available) {
    if (!descriptor || config?.voice?.enabled === false || !(available ?? forkStageVoiceAvailable())) return null;
    const input = forkPackSpeechInput({...descriptor, kind:'bubble'}, config);
    if (!input) return null;
    const character = forkBubbleCharacter(config,descriptor);
    const owner = sessionId + ':stage', id = JSON.stringify([paragraphId, descriptor.alias, input.text, input.mood,
        character.voiceKey, character.voiceLanguage || character.voiceLang || config.stage?.textLanguage || 'zh']);
    // Match transcript identity after authored/legacy names resolve to the same figure.
    const cacheKey = JSON.stringify([sessionId,character.alias,character.voiceKey,character.voiceLanguage || character.voiceLang || config.stage?.textLanguage || 'zh',input.text,input.mood]);
    const selectionKey=descriptor.lineIdentity ? JSON.stringify([sessionId,...descriptor.lineIdentity]) : undefined;
    const request = {...input, owner, id, selectionKey, cacheKey:JSON.stringify([cacheKey,selectionKey])}, resource = () => rpc('openAssetPackVoice', {alias:character.alias}, sessionId);
    return {...request, prefetch:() => forkVoicePlayer.prefetch(resource, request),
        click:options => forkVoicePlayer.play(resource, {...request, handoff:options?.handoff === true, automatic:options?.automatic === true})};
}

// private fork (stage perf 2026-10): callers that build many handles (every page of a turn, each render) look the
// TTS client up once and pass `available`; the host service lookup per handle was a page-turn hot spot.
function forkStageVoiceAvailable() { return typeof forkTtsScope !== 'undefined' && !!forkTtsScope?.get('ttsClient')?.available(); }
function forkStageVoiceWindowFromIndex(sessionId,index,turn,pages,page,config) {
    const handles = [], seen = new Set(), available = forkStageVoiceAvailable();
    const next = [...index.keys()].filter(number => number > turn).sort((a,b) => a-b)[0];
    for (const number of [turn,next]) {
        const row = index.get(number);
        if (!row) continue;
        // private fork: current/next first on jumps, then finish the whole viewed turn.
        for (const item of number === turn ? [...pages.slice(page),...pages.slice(0,page)] : row.text.pages) {
            if (item.pending || !item.voice) continue;
            const handle = number === turn ? item.voice : forkStageVoiceHandle(sessionId,item.voice,config,item.anchor.paragraphId,available);
            // private fork: subtitle cards share one speech clip.
            const key = handle && JSON.stringify([handle.owner,handle.id]);
            if (handle && !seen.has(key)) {seen.add(key); handles.push(handle);}
        }
    }
    return handles;
}

// The runner awaits these actual consumer acknowledgements before retiring outgoing pins.
function useForkStageConsumers(sessionId, store, onEvent, performanceAdapter, cgAdapter, modAdapter) {
    const event = React.useRef(onEvent); event.current = onEvent;
    const performanceSink=React.useRef(performanceAdapter);performanceSink.current=performanceAdapter;
    const cgSink=React.useRef(cgAdapter);cgSink.current=cgAdapter; // private fork
    const modSink=React.useRef(modAdapter);modSink.current=modAdapter;
    const pending = React.useRef(new Map());
    const onPresented = React.useCallback(revision => {
        for (const [key, resolve] of pending.current) if (key <= revision) { pending.current.delete(key); resolve(); }
    }, []);
    React.useLayoutEffect(() => {
        const ambience = forkCreateSoundscapePlayer({Audio, mixer:forkStageAudio});
        let ambiencePlan = null, performanceAmbience=null;
        const applyAmbience=snap=>{ambience.apply({...ambiencePlan,layers:[...(ambiencePlan?.layers || []),...(performanceAmbience ? [{...performanceAmbience,slot:'performance',id:performanceAmbience.identity,lowpassHz:null}] : [])]},{snap});};
        const debug = {snapshot:() => ({plan:ambiencePlan,player:ambience.snapshot()})};
        window.forkSoundscapeDebug = debug;
        const consume = {
            present(intent) {
                if (intent.type === 'playback-policy') return;
                if (intent.type === 'release-presentation' || intent.type === 'revoke-presentation') { ambience.stop(); modSink.current?.cancel(intent); return cgSink.current?.(intent); }
                // private fork: music is the BGM player's (fork-bgm-player.cjs), in the stage and in chat alike.
                const waits = [], value = intent.accepted, snap = intent.transition === 'snap';
                if (intent.groups.includes('cg')) waits.push(cgSink.current?.(intent));
                if (intent.groups.includes('ambience')) {
                    ambiencePlan = value.ambience || {version:1,layers:[],warnings:[]};
                    applyAmbience(snap);
                    waits.push(ambience.whenSettled());
                }
                if (intent.groups.some(group => ['visual','background','avatars'].includes(group) || group.startsWith('figure:'))) waits.push(new Promise(resolve => {
                    const previous = pending.current.get(value.presentationRevision);
                    pending.current.set(value.presentationRevision, () => {previous?.(); resolve();});
                }));
                return Promise.all(waits);
            },
            performance(intent) {
                if(intent.type === 'layer') {
                    const layer=intent.layer.ambience, ref=layer?.ref;
                    const track=ref && intent.value.dependencies.find(item => item.ref.packId===ref.packId && item.ref.kind===ref.kind && item.ref.assetId===ref.assetId);
                    performanceAmbience=track ? {...track,gain:10**((layer.gainDb || 0)/20)} : null;
                    applyAmbience(intent.snap);
                } else if(intent.type === 'clear') {performanceAmbience=null;applyAmbience(true);}
                return performanceSink.current?.(intent);
            },
            play(value, token) {
                if (store.getSnapshot().accepted.cg && ['act','emote','focus'].includes(value.kind)) return;
                if (value.kind === 'voice') {
                    const state=store.getSnapshot();
                    if(!forkPhoneAutoVoiceAllowed(state.director,token.anchor.para,state.settings?.config?.stage?.director===true))return;
                    const voice = forkStageVoiceHandle(sessionId, value, state.settings?.config, token.anchor.paragraphId);
                    return voice?.click({handoff:true,automatic:true});
                }
                if (value.url) return forkStageSfx.play(value.url, value.identity, value.ref, token.id, value.gain ?? 1, value);
                return event.current(value, token);
            },
            cancel(intent) {
                if (!intent.token) modSink.current?.cancel(intent);
                if (intent.reason === 'revoked' && intent.token) forkStageSfx.stopToken(intent.token.id);
                else { forkStageSfx.stop(); forkVoicePlayer.stopPlayback(); }
            }
        };
        forkStageConsumers.set(sessionId, consume);
        consume.present({type:'present', accepted:store.getSnapshot().accepted, groups:['ambience'], transition:'snap'});
        const gesture = () => ambience.resume();
        window.addEventListener('pointerdown', gesture); window.addEventListener('keydown', gesture);
        store.dispatch({type:'STAGE_OPEN', opened:true});
        return () => {
            store.dispatch({type:'STAGE_OPEN', opened:false});
            forkStageConsumers.delete(sessionId);
            if (window.forkSoundscapeDebug === debug) delete window.forkSoundscapeDebug;
            ambience.dispose(); forkStageSfx.stop(); forkVoicePlayer.stop();
            window.removeEventListener('pointerdown', gesture); window.removeEventListener('keydown', gesture);
            onPresented(Infinity);
        };
    }, [sessionId, store]);
    return onPresented;
}
