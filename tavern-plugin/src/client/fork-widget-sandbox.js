// @include fork-widget-media.cjs
// Only visible source text and declared variable projections cross this bridge; never chat/session context.
let forkWidgetMediaOwner;
// @include fork-widget-theme.js
function ForkWidgetSandbox({ widget, seconds }) {
    const ref = React.useRef(null), instance = React.useRef(null), current = React.useRef(null);
    const [failed, setFailed] = React.useState(false);
    current.current = { widget, seconds };
    const media=React.useRef(null);
    if (!instance.current) instance.current = { token: Array.from(crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16)).join('-'), url:widget.definition.url, srcDoc:widget.definition.srcDoc, loads: 0, ready: false, timer: null, sentTheme: '' };
    const send = (type, data = {}) => {
        const frame = ref.current;
        try { if (frame?.contentWindow) frame.contentWindow.postMessage({ channel: 'dsh-widget', version: 2, token: instance.current.token, type, ...data }, '*'); } catch { /* a detached frame has no remaining work */ }
    };
    function fail(reason) {
        if (instance.current.failed) return;
        instance.current.failed = true;
        forkWidgetCount('errors'); if (reason !== 'errors') forkWidgetCount(reason);
        current.current.widget.onFailure?.();media.current?.update({active:false});
        clearTimeout(instance.current.timer); setFailed(true);
    }
    function variableProjection(value) {
        if (!value.definition.document.variables) return undefined;
        if (value.variables && !value.presentation?.suspended && forkWidgetBytes(value.variables)<=15000) return value.variables;
        return {contextKey:'unavailable',revision:'',sequence:0,position:{turn:0,swipeId:0},snapshot:{kind:'unavailable',turn:null},settlement:'idle',writable:{allowed:false,reason:'unavailable'},values:Object.fromEntries(Object.keys(value.definition.document.variables.reads || {}).map(id=>[id,{status:'unavailable'}]))};
    }
    function settingsProjection(value) {
        return {settings:value.settings || value.definition.settings || forkWidgetResolveSettings(value.definition.document).settings,
            settingAssets:value.settingAssets || {}, assets:Object.fromEntries(Object.entries(value.definition.assets || {}).map(([key,item])=>[key,['music','sfx'].includes(item.kind)?{kind:item.kind}:item]))};
    }
    function init() {
        if (!ref.current) return;
        const { widget: value } = current.current, theme = forkWidgetThemeTokens(ref.current);
        instance.current.sentTheme = JSON.stringify(theme);
        const settings=settingsProjection(value);instance.current.sentSettings=JSON.stringify(settings);
        send('init', { ...(variableProjection(value) ? {variables:variableProjection(value)} : {}), presentation:value.presentation, state:value.state || {}, ...settings, theme, playback:value.playback || {}, locale:document.documentElement.lang || 'zh-CN' });
    }
    function playback(value) {return {...value.playback,paused:document.hidden || value.playback?.paused || value.presentation?.suspended};}
    function publish() {
        const value=current.current.widget;
        send('presentation',{presentation:value.presentation});
        send('playback',{playback:playback(value)});
        const variables=variableProjection(value);
        if (variables) send('variables',variables);
        const settings=settingsProjection(value),signature=JSON.stringify(settings);
        if(signature!==instance.current.sentSettings){instance.current.sentSettings=signature;send('settings',settings);}
        if (value.presentation?.suspended) return;
        for (const [type,payload] of [['update',{state:value.state || {},eventToken:value.playback?.eventToken}],...(value.sourceOnly?[['source',{source:value.source}]]:[])]) {
            const key='sent:'+type,signature=JSON.stringify(payload);
            if(instance.current[key]!==signature){instance.current[key]=signature;send(type,payload);}
        }
    }
    React.useLayoutEffect(() => {
        forkWidgetMediaOwner ||= createForkWidgetMedia({createAudio:url=>new Audio(url),bind:(node,kind,url)=>forkStageAudio.bind(node,kind,url),release:node=>forkStageAudio.release(node)});
        media.current=forkWidgetMediaOwner.acquire(widget.scopeKey || widget.originKey);
        let count = 0, since = performance.now(), proposals = [], statuses = [], pendingVariable = false;
        function message(event) {
            const frame = ref.current, state = instance.current;
            if (state.failed || !frame || event.source !== frame.contentWindow || event.origin !== 'null') return;
            const data = event.data;
            if (!forkWidgetPlain(data) || data.channel !== 'dsh-widget' || data.version !== 2 || data.token !== state.token) return;
            if (performance.now() - since >= 1000) { since = performance.now(); count = 0; }
            let bytes;
            try { bytes = forkWidgetBytes(data); } catch { fail('floods'); return; }
            if (++count > 20 || bytes > 16384) { fail('floods'); return; }
            const fields = ['channel','version','token','type'].concat(({action:['action'],'audio.play':['asset','eventToken'],'audio.stop':['asset'],'voice.replay':['handle'],'stage.advance':[],'stage.wheel':['deltaY','deltaMode'],'transcript.toggle':['id'],'variables.propose':['requestId','contextKey','revision','label','operations'],'variables.status':['requestId','operationId']})[data.type] || []);
            if (Object.keys(data).some(key => !fields.includes(key))) return;
            if (data.type === 'ready') {
                state.ready = true; clearTimeout(state.timer);
                const latest = current.current;
                latest.widget.onReady?.(true);updateTheme();publish();
                if (!latest.widget.presentation?.suspended && Number.isFinite(latest.seconds)) send('tick',{seconds:latest.seconds});
            }
            else if (data.type === 'variables.propose' || data.type === 'variables.status') {
                const value=current.current.widget, projection=variableProjection(value), now=performance.now();
                if (typeof data.requestId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(data.requestId)) return;
                const result=(status,reason)=>send('variables.result',{requestId:data.requestId,status,reason});
                if (!state.ready || state.failed || document.hidden || value.presentation?.suspended || value.presentation?.state === 'hidden' || !projection || !value.onVariableRequest) {result('unavailable','unavailable');return;}
                if (data.type === 'variables.propose') {
                    proposals=proposals.filter(at=>now-at<1000);
                    if (proposals.length>=2 || pendingVariable) {result('rejected','rate-limit');return;}
                    proposals.push(now);
                    if (data.contextKey !== projection.contextKey || data.revision !== projection.revision) {result('conflict','position-changed');return;}
                    if (!projection.writable.allowed) {result('rejected',projection.writable.reason);return;}
                    if (!Array.isArray(data.operations) || !data.operations.length || data.operations.length>16 || forkWidgetBytes(data.operations)>8192 || data.label !== undefined && (typeof data.label !== 'string' || [...data.label].length>80)) {result('rejected','invalid-request');return;}
                } else {
                    statuses=statuses.filter(at=>now-at<1000);
                    if (statuses.length || typeof data.operationId !== 'string' || data.operationId.length>128) {result('rejected','rate-limit');return;}
                    statuses.push(now);
                }
                pendingVariable=true;
                const contextKey=projection.contextKey, revision=projection.revision;
                Promise.resolve().then(()=>value.onVariableRequest(data)).then(reply=>{
                    const latest=variableProjection(current.current.widget);
                    if (!state.failed && latest?.contextKey===contextKey && latest.revision===revision && forkWidgetPlain(reply)) {
                        const result=Object.fromEntries(['operationId','status','reason','revision','normalized'].filter(key=>Object.hasOwn(reply,key)).map(key=>[key,reply[key]]));
                        if (forkWidgetBytes(result)<=1024) send('variables.result',{...result,requestId:data.requestId});
                    }
                },()=>{const latest=variableProjection(current.current.widget);if(!state.failed && latest?.contextKey===contextKey && latest.revision===revision)result('unknown','request-interrupted');}).finally(()=>{pendingVariable=false;});
            }
            else if (!state.ready || current.current.widget.presentation?.suspended) return;
            else if (data.type === 'action' && ['open','collapse','hide'].includes(data.action)) current.current.widget.onAction?.(data.action);
            else if (data.type === 'audio.play' && typeof data.asset === 'string') media.current.play(data.asset,data.eventToken);
            else if (data.type === 'audio.stop' && typeof data.asset === 'string') media.current.stop(data.asset);
            else if (data.type === 'voice.replay' && typeof data.handle === 'string') current.current.widget.voiceHandles?.get(data.handle)?.();
            else if (current.current.widget.modSource && data.type === 'stage.advance') current.current.widget.onAdvance?.();
            else if (current.current.widget.modSource && data.type === 'stage.wheel' && Number.isFinite(data.deltaY) && [0,1,2].includes(data.deltaMode)) current.current.widget.onWheel?.({deltaY:data.deltaY,deltaMode:data.deltaMode});
            else if (current.current.widget.modSource && data.type === 'transcript.toggle' && typeof data.id === 'string') current.current.widget.onTranscript?.(data.id);
        }
        const visibility=()=>{const value=current.current.widget;media.current?.update({active:!instance.current.failed,assets:value.definition.assets,policy:value.mediaPolicy,playback:{...value.playback,paused:document.hidden || value.playback?.paused || value.presentation?.suspended}});send('playback',{playback:{...value.playback,paused:document.hidden || value.playback?.paused || value.presentation?.suspended}});};
        document.addEventListener('visibilitychange',visibility);
        window.addEventListener('message', message);
        const state = instance.current;
        // Includes failure to load at all, not just failure to acknowledge init.
        state.timer = setTimeout(() => fail('timeouts'), 5000);
        const frame = ref.current, scope = frame?.closest('.fork-gal-stage, .fork-gal-theme-scope');
        const updateTheme = () => {
            if (!ref.current || !state.ready) return;
            const theme = forkWidgetThemeTokens(ref.current), signature = JSON.stringify(theme);
            if (signature !== state.sentTheme) { state.sentTheme = signature; send('theme', { theme, transitionMs:forkWidgetThemeOwners.get(scope)?.transitionMs || 0 }); }
        };
        const observer = new MutationObserver(updateTheme);
        scope?.addEventListener('widget-theme',updateTheme);
        // A preview scope may itself inherit updated font/theme tokens from the stage.
        for (let ancestor = scope; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) observer.observe(ancestor, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] });
        observer.observe(document.body, { attributes: true, attributeFilter: ['class', 'style'] });
        return () => { send('hide'); current.current.widget.onReady?.(false);media.current.dispose();document.removeEventListener('visibilitychange',visibility);clearTimeout(state.timer); observer.disconnect(); scope?.removeEventListener('widget-theme',updateTheme); window.removeEventListener('message', message); };
    }, []);
    React.useLayoutEffect(() => {media.current?.update({active:!failed,assets:widget.definition.assets,policy:widget.mediaPolicy,playback:{...widget.playback,paused:document.hidden || widget.playback?.paused || widget.presentation?.suspended}});if(instance.current.ready)publish();},[failed,JSON.stringify(widget.state),JSON.stringify(widget.source),JSON.stringify(widget.playback),JSON.stringify(widget.presentation),JSON.stringify(widget.mediaPolicy),JSON.stringify(widget.definition.assets),JSON.stringify(widget.settings),JSON.stringify(widget.settingAssets),JSON.stringify(widget.definition.settings),JSON.stringify(widget.variables)]);
    React.useEffect(() => { if (instance.current.ready && !widget.presentation?.suspended && Number.isFinite(seconds)) send('tick', { seconds }); }, [seconds]);
    if (failed) return null;
    return React.createElement('iframe', { ref, title: widget.definition.title, src: instance.current.url, srcDoc:instance.current.srcDoc, sandbox: 'allow-scripts', referrerPolicy: 'no-referrer',
        allow: "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; fullscreen 'none'", 'data-third-party': true,
        style: { border: 0, display: 'block', width: widget.presentation?.bounds.width || widget.definition.document.presentation.open.width, height: widget.presentation?.bounds.height || widget.definition.document.presentation.open.height, background: 'transparent',
            // private fork: a colour-scheme mismatch with the embedding element paints an opaque backdrop; widgets default to normal.
            colorScheme: 'normal' },
        onError: () => fail('errors'), onLoad: () => {
            const state = instance.current;
            // Self-navigation is an accepted outbound risk; never keep its replacement document alive.
            if (++state.loads > 1) { fail('navigations'); return; }
            init(); clearTimeout(state.timer); state.timer = setTimeout(() => fail('timeouts'), 1500);
        } });
}
// private fork: only host-authorized v2 widget leases reach the opaque iframe.
function forkHydrateWidgetDefinitions(items) {
    return (items || []).filter(item => item.thirdParty && item.ref?.kind === 'widgets' &&
        item.id === [item.ref.packId,item.ref.kind,item.ref.assetId].join('/') &&
        /^\/api\/dsh-asset-library\/v2\/lease\/[A-Za-z0-9_-]+\//.test(item.url));
}
function ForkWidgetPreview({ definition, state, sample = 0, settings = {}, theme = 'classic', film = false }) {
    const item = forkHydrateWidgetDefinitions([definition])[0];
    if (!item) return null;
    // private fork: preview executes no commands; it displays a validated declared state.set sample.
    const example = item.samples?.[sample] || item.samples?.[0];
    const command = item.document?.commands.find(command => command.name === example?.command && command.effect === 'state.set');
    const candidate = state ?? (command ? example.params : null);
    const normalized = candidate && forkWidgetSchemaValue(item.stateSchema,candidate) && forkWidgetBytes(candidate) <= item.caps.bytes ? candidate : null;
    if (!normalized) return React.createElement('p', { role: 'status' }, '模组参数不符合 schema');
    const widget = forkWidgetPresentation({ widgetId: 'preview', ref: item.ref, originKey:'preview:'+item.id, state: normalized, slot: item.slot || 'corner-right', remainingSeconds: normalized.remainingSeconds }, item);
    widget.settings=forkWidgetResolveSettings(item.document,{...item.settingsDefaults,...settings}).settings;
    return React.createElement('div', { className: 'fork-gal-theme-scope fork-widget-preview', 'data-theme': theme, 'data-film': film, style: { padding: film ? '40px 16px' : '16px', maxWidth: '100%' } },
        React.createElement(getForkWidgetBoundary(), { key: item.id + ':' + (item.revision || item.version) }, React.createElement(ForkWidgetCard, { widget })));
}
