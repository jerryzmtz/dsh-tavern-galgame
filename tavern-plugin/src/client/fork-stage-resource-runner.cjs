'use strict';
const stageResourceDeps = typeof module !== 'undefined' && typeof window === 'undefined' ? require('./fork-stage-resources.cjs') : null;
const stageMatchesResource = (item, scope) => (stageResourceDeps?.stageResourceMatches || stageResourceMatches)(item,scope);
const stageResourceAuthority = source => JSON.stringify([source.sessionId,source.authorityEpoch]);
const stageResourceErrorText = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./fork-stage-runtime.cjs').stageRuntimeErrorText : stageRuntimeErrorText;
// private fork (new-user journey 2026-10): conflicts that resolve on a re-read (the stage moved on, a lease went stale).
const STAGE_TRANSIENT_CODES = ['REVISION_CONFLICT','ASSET_STALE'], STAGE_TRANSIENT_RETRIES = 6;
const stageErrorCode = error => typeof error === 'string' ? (error.match(/^([A-Z][A-Z0-9_]+)(?::|$)/) || [])[1] || '' : typeof error?.code === 'string' ? error.code : typeof error?.message === 'string' ? (error.message.match(/^([A-Z][A-Z0-9_]+)$/) || [])[1] || '' : '';
const stageTransientError = error => STAGE_TRANSIENT_CODES.includes(stageErrorCode(error));
// The one notice when the retries run out: a plain failure, not 「…，正在重试」; the cause stays for the 调试视图.
const stageRetryFailure = error => {
    const code = stageErrorCode(error), message = typeof error === 'string' ? error : typeof error?.message === 'string' ? error.message : '';
    return stageResourceErrorText({code:'PROJECTION_FAILED',message:code && message && !message.startsWith(code) ? code + ': ' + message : message || code});
};

// private fork (stage perf 2026-10): every page projection repeats the turn's cast catalogue (avatars, characters,
// performance: ~0.5 MB JSON). A freshly read value reuses the previous page's equal subtrees, so a cached turn
// holds one copy instead of one per page. `next` is a fresh RPC result owned by the caller; `previous` is never written.
function stageShareJson(next, previous) {
    if (next === previous) return previous;
    if (!next || !previous || typeof next !== 'object' || typeof previous !== 'object' || Array.isArray(next) !== Array.isArray(previous) || Object.isFrozen(next)) return next;
    const keys = Object.keys(next);
    let same = keys.length === Object.keys(previous).length;
    for (const key of keys) {
        if (!Object.hasOwn(previous, key)) { same = false; continue; }
        const value = stageShareJson(next[key], previous[key]);
        if (value !== previous[key]) same = false;
        if (value !== next[key]) next[key] = value;
    }
    return same ? previous : next;
}

// Resource descriptors of a projection value not yet in `seen` (identity, crop and alias), in walk order.
const stageResourceSeenKey = item => JSON.stringify([item.identity,Object.hasOwn(item,'crop') ? item.crop : '-',item.alias]);
function stageResourceDescriptors(value, seen) {
    const out = [];
    (function collect(item) {
        if (item?.resource === true) {
            const id = stageResourceSeenKey(item);
            if (!seen.has(id)) { seen.add(id); out.push(item); }
        } else if (item && typeof item === 'object') Object.values(item).forEach(collect);
    })(value);
    return out;
}

// Faces use avatar media, never the portrait's unused sprite/mouth catalogue.
function stageAvatarResources(value) {
    return (value || []).map(figure => figure.media?.avatar ? {
        alias:figure.alias,ref:figure.ref,revision:figure.revision,outfitKey:figure.outfitKey,
        avatarOutfitKey:figure.avatarOutfitKey,avatarStateId:figure.avatarStateId,state:{id:figure.state?.id},
        avatarCrop:figure.avatarCrop,avatarUrl:figure.avatarUrl,media:{avatar:figure.media.avatar},
        views:{stage:false,portrait:true},form:'avatar'
    } : figure);
}

// Warm the same canonical first page that foreground projection requests use.
function stageParagraphPageRequest(at, pages) {
    const index = pages?.findIndex(item => (item.para ?? item.anchor?.para) === at) ?? -1;
    const item = pages?.[index];
    return index < 0 ? {at} : {at,page:{index,para:at,offset:item.offset ?? item.anchor?.offset,version:1}};
}
function stagePerformancePageRequests(envelope, pages) {
    const states = [envelope.baseline,...(envelope.entries || []).map(entry => entry.state)];
    if (!states.some(state => state?.performance)) return [];
    const indices = states.flatMap(state => state?.performance ? [state.performance.startedAt.page,state.performance.startedAt.page + 1] : []);
    return [...new Set(indices)].flatMap(index => {
        const item = pages?.[index], para = item?.para ?? item?.anchor?.para, offset = item?.offset ?? item?.anchor?.offset;
        return para && para <= envelope.through ? [{at:para,page:{index,para,offset,version:1}}] : [];
    });
}

// private fork: P6 consumes replay's ruler; measurement/loading order is not a scale input.
function stagePlaybackVisual(value, requestToken, directionToken) {
    const ruler = value.state.figureScale;
    if (!ruler) throw new Error('Missing P6 replay ruler');
    return {scene:{...value.scene,state:value.state,figureScale:ruler,diagnostics:[...(value.scene?.diagnostics || []),...(value.diagnostics || [])]},
        lighting:value.state.lighting,figures:value.characters.map(figure => {
            const measurement = value.measurements?.[figure.geometry?.stage];
            return measurement ? {...figure,measurement} : figure;
        }),ruler};
}

// private fork: extends the director source's onEffect. No store, player or hook
// is created here. F supplies sinks; E's visual adapter receives both captured
// request and canonical direction tokens, never a later mutable snapshot.
function createStageResourceRunner({read, owner, clock = globalThis, foreground = clock, idle = async () => true, resolveSpeaker = (_snapshot,page) => page.voice?.character?.alias, music, preparePerformance = async () => {}, performance = () => {}, present = () => {}, play = () => {}, cancelPlayback = () => {}, visual}) {
    const timelineFactory = typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../../fork/mods/performance/timeline.cjs').createPerformanceTimeline : createPerformanceTimeline;
    const sustained = typeof module !== 'undefined' && typeof window === 'undefined' ? require('../../../fork/mods/performance/state.cjs').performanceSustained : performanceSustained;
    const now = () => typeof foreground.now === 'function' ? foreground.now() : foreground.now ?? globalThis.performance.now();
    const sameToken = (a,b) => a && b && JSON.stringify(a) === JSON.stringify(b);
    const refKey = ref => JSON.stringify([ref?.packId,ref?.kind,ref?.assetId]);
    function performanceLayer(id,state,layer,token,descriptor,snap=false) {
        const value=state.accepted.get('performance')?.value;
        if (!value) return;
        const track=layer.bgm && value.dependencies.find(item => refKey(item.ref) === refKey(layer.bgm.ref));
        const bgm=music?.();
        if (bgm && !descriptor?.retiring) {
            if (layer.bgm) {
                if (JSON.stringify(state.musicLock?.instanceKey) !== JSON.stringify(value.instanceKey)) {
                    const acquired=bgm.acquirePerformance({sessionId:id,authority:state.authority,instanceKey:value.instanceKey,phaseKey:value.phaseKey,
                        track:track ? {...track,fadeMs:layer.bgm.fadeMs ?? layer.bgm.fadeInMs} : null,lock:value.plan.bgm?.lock !== false,restore:value.plan.bgm?.restore || 'previous',restoreTarget:value.restore,token,snap});
                    state.musicLock={instanceKey:value.instanceKey,handle:acquired.handle,token};
                }
                if (state.musicLock) state.musicLock.token=token;
                state.musicLock?.handle?.update({phaseKey:value.phaseKey,token,track,fadeMs:layer.bgm.fadeMs ?? layer.bgm.fadeInMs,snap});
            } else if (state.musicLock) {
                state.musicLock.handle?.release({token:state.musicLock.token,reason:'restore',restoreTarget:value.restore,fadeMs:descriptor?.fadeMs,snap}); state.musicLock=null;
            }
        }
        return performance(id,{type:'layer',value,layer,token,descriptor,snap,authority:state.authority,handles:state.performanceHandles || [],cue:event => state.timeline?.cue({...event,token})});
    }
    function ensureTimeline(id,state,dispatch,getSnapshot) {
        if (state.timeline) return state.timeline;
        state.timeline=timelineFactory({foreground:{now,setTimeout:(fn,ms) => foreground.setTimeout(fn,ms),clearTimeout:id => foreground.clearTimeout(id)},
            isCurrent:token => sameToken(token,getSnapshot().performancePlayback?.token),
            ledger:{due:event => dispatch({type:'PERFORMANCE_EVENT_DUE',...event}),consumed:event => dispatch({type:'PERFORMANCE_PHASE_CONSUMED',...event}),cycle:event => dispatch({type:'PERFORMANCE_CYCLE_COMPLETED',...event})},
            sinks:{cancel:info => performance(id,{type:'cancel',...info}),sustained:options => performanceLayer(id,state,sustained(options.plan),options.token,null,true)}});
        return state.timeline;
    }
    const sessions = new Map();
    function session(id) {
        if (!sessions.has(id)) sessions.set(id,{accepted:new Map(), jobs:new Map(), shots:new Map(), handoffs:new Set(), projections:new Map(), revision:0});
        return sessions.get(id);
    }
    // private fork: keep presentation inputs with each sealed turn, independently of
    // transient player pins. Snap only changes transition duration, not projection data.
    function projection(source, direction, assetRevision, args) {
        const state = session(source.sessionId);
        const key = JSON.stringify(source), version = JSON.stringify([direction,assetRevision]);
        let entry = state.projections.get(key);
        state.projections.delete(key);
        if (!entry || entry.version !== version) entry = {version,pages:new Map()};
        state.projections.set(key,entry);
        const pages = entry.pages;
        // private fork (stage perf 2026-10): every cached page holds the full presentation (~0.5 MB JSON: avatars,
        // characters, performance), ~25 MiB per read turn. Keep the navigation working set only: this turn, the two
        // turns history prefetch reads on opening and the next one. One stage is shown at a time; other chats re-read.
        while (state.projections.size > 4) state.projections.delete(state.projections.keys().next().value);
        for (const [id, other] of sessions) if (id !== source.sessionId) other.projections.clear();
        const pageKey = JSON.stringify([args.at,args.page?.index ?? null,args.page?.version ?? null]);
        let job = pages.get(pageKey);
        const cached = !!job;
        if (!job) {
            job = Promise.resolve().then(() => read({...args,snap:false})).then(result => {
                if (result.cgReceipt?.displayToken || result.status !== 'ready' || JSON.stringify(result.directionToken) !== JSON.stringify(direction)) pages.delete(pageKey);
                else if (result.value && typeof result.value === 'object') { result.value = stageShareJson(result.value, entry.shared); entry.shared = result.value; }
                return result;
            },error => {pages.delete(pageKey); throw error;});
            // private fork: cache semantics, never a single-use display capability.
            pages.set(pageKey,job);
        }
        if (cached && args.cgDisplay) job = job.then(result => result.value?.scene?.cg ? read({...args,snap:false}) : result);
        return job.then(result => args.snap && result.status === 'ready'
            ? {...result,value:{...result.value,scene:{...result.value.scene,timeTransitionMs:0}}} : result);
    }
    function invalidate(sessionId) {
        const state = sessions.get(sessionId);
        if (state) {
            state.revision++; state.projections.clear(); releaseWarm(state);
            // An executable capability cannot survive permission uncertainty as last-good.
            if (state.accepted.get('performance')?.value?.executionDependencies?.length && state.dispatch) {
                const source = state.getSnapshot().source;
                state.dispatch({type:'PERFORMANCE_UNAVAILABLE',source,reason:'widget-permission-refresh'});
            }
        }
    }
    async function prefetch(source, envelope) {
        if (!envelope?.complete || !envelope.token) return;
        const state = session(source.sessionId), revision = state.revision;
        // Only adjacent boundary pages are speculative. Walking hundreds of historical
        // paragraphs transfers the same catalogue repeatedly while the current scene loads.
        const boundary = new Set([1,2,3,envelope.through-2,envelope.through-1,envelope.through].filter(at => at > 0 && at <= envelope.through));
        const requests = [...stagePerformancePageRequests(envelope,envelope.pageIndex?.pages).filter(request => boundary.has(request.at)),
            ...[...boundary].map(at => stageParagraphPageRequest(at,envelope.pageIndex?.pages))];
        const queue = [...new Map(requests.map(request => [JSON.stringify(request),request])).values()];
        const valid = () => sessions.get(source.sessionId) === state && state.revision === revision;
        // private fork (stage perf 2026-10): pages of a turn reference the same few resources. Prepare each resource
        // once per prefetch, not every page's whole value (an async walk over ~0.5 MB JSON per page, chained through
        // resolved promises into one long task when the pages were already cached).
        const seen = new Set();
        async function worker() {
            while (queue.length && valid()) {
                await state.foreground?.done;
                if (!valid() || !queue.length) return;
                const coordinate = queue.shift();
                try {
                    const result = await projection(source,envelope.token,envelope.assetRevision,
                        {sessionId:source.sessionId,turn:source.turn,...coordinate,history:true,expectedDirectionToken:envelope.token});
                    if (!valid() || result.status !== 'ready') continue;
                    const performance = result.value.performance;
                    const value = {...result.value,avatars:stageAvatarResources(result.value.avatars),performance:performance && !performance.unavailable ? {...performance,
                        dependencies:performance.dependencies.filter(item => item.role === 'required')} : null};
                    const pins = [], batch = stageResourceDescriptors(value,seen);
                    try {
                        for (const descriptor of batch) pins.push(await owner.prepare(descriptor,stageResourceAuthority(source),{prefetch:true}));
                    } catch (error) {
                        // Unprepared resources stay eligible for a later page, as before.
                        batch.slice(pins.length).forEach(descriptor => seen.delete(stageResourceSeenKey(descriptor)));
                        throw error;
                    } finally { pins.forEach(pin => pin.release()); }
                    for (const dependency of performance?.dependencies || []) if (dependency.role === 'restore') {
                        try {(await owner.prepare(dependency,stageResourceAuthority(source),{prefetch:true})).release();} catch (_) { /* Best effort only. */ }
                    } // The 2 GiB owner retains decoded, unpinned content.
                } catch (_) { /* Speculation cannot fail the foreground navigation. */ }
            }
        }
        await Promise.all([worker(),worker()]);
    }
    function cancel(job) {
        if (!job) return;
        job.cancelled = true; job.controller?.abort(); job.finish?.(); clock.clearTimeout(job.timer); clock.clearTimeout(job.noticeTimer);
        for (const prepared of job.groups?.values() || []) prepared.release();
        job.groups?.clear(); job.prepared?.release();
    }
    function releaseAccepted(state) { for (const prepared of state.accepted.values()) prepared.release(); state.accepted.clear(); }
    // private fork: a direction's sealed timeline owns its warm pins, not page visits.
    // Two sequential workers bound both projection RPCs and media preparation.
    function releaseWarm(state) {
        if (!state.warm) return;
        state.warm.cancelled = true;
        for (const prepared of state.warm.prepared) prepared.release();
        state.warm = null;
    }
    function warmTimeline(state, token, direction, history, getSnapshot) {
        const key = JSON.stringify([token.source,direction,history,getSnapshot().director.assetRevision]);
        const snapshot = getSnapshot(), through = snapshot.director.through;
        const current = Math.min(token.anchor.para,through);
        function enqueue(warm) {
            const requests = stagePerformancePageRequests(snapshot.director,snapshot.text?.pages)
                .filter(request => request.at >= current && request.at <= current + 3);
            for (let at = current + 1; at <= Math.min(through,current + 3); at++) requests.push(stageParagraphPageRequest(at,snapshot.text?.pages));
            for (const request of requests) {
                const id = JSON.stringify(request);
                if (!warm.requested.has(id)) {warm.requested.add(id); warm.queue.push(request);}
            }
        }
        if (state.warm?.key === key) {enqueue(state.warm); return state.warm;}
        releaseWarm(state);
        const warm = {key,cancelled:false,prepared:[],seen:new Set(),queue:[],requested:new Set(),attempts:new Map()};
        state.warm = warm;
        // Advance a small lookahead on navigation, retaining the same timeline's pins.
        enqueue(warm);
        warm.pin = async value => {
            const descriptors = [];
            function collect(item) {
                if (item?.resource === true) {
                    const id = JSON.stringify([item.identity,item.alias]);
                    if (!warm.seen.has(id)) {warm.seen.add(id); descriptors.push(item);}
                } else if (item && typeof item === 'object') Object.values(item).forEach(collect);
            }
            collect({...value,avatars:stageAvatarResources(value.avatars)});
            for (const descriptor of descriptors) {
                await state.foreground?.done;
                if (warm.cancelled) return;
                try {
                    const prepared = await owner.prepare(descriptor,stageResourceAuthority(token.source),{prefetch:true});
                    if (warm.cancelled) prepared.release(); else warm.prepared.push(prepared);
                } catch (_) {warm.seen.delete(JSON.stringify([descriptor.identity,descriptor.alias]));}
            }
        };
        warm.start = () => {
            if (warm.started) return;
            warm.started = true;
            async function worker() {
                while (!warm.cancelled && warm.queue.length) {
                    await state.foreground?.done;
                    if (warm.cancelled || !warm.queue.length) return;
                    const coordinate = warm.queue.shift(), requestKey = JSON.stringify(coordinate);
                    try {
                        const result = await projection(token.source,direction,snapshot.director.assetRevision,
                            {sessionId:token.source.sessionId,turn:token.source.turn,...coordinate,history,expectedDirectionToken:direction});
                        if (warm.cancelled) return;
                        if (JSON.stringify(result.directionToken) !== JSON.stringify(direction)) continue;
                        if (result.status === 'ready') await warm.pin(result.value);
                        else if (['pending','stale'].includes(result.status)) {
                            const attempts = (warm.attempts.get(requestKey) || 0) + 1;
                            warm.attempts.set(requestKey,attempts);
                            if (attempts < 3) warm.queue.push(coordinate);
                        }
                    } catch (_) { /* Off-page failures must not block the current presentation. */ }
                }
            }
            void Promise.all([worker(),worker()]).finally(() => {warm.started = false; if (!warm.cancelled && warm.queue.length) warm.start();});
        };
        return warm;
    }
    function revoke(state, scope, source, dispatch, getSnapshot) {
        invalidate(source.sessionId);
        releaseWarm(state);
        for (const job of state.jobs.values()) cancel(job);
        state.jobs.clear();
        const groups = {};
        // private fork: match the descriptor tree, not shared Blob URLs. Revoking
        // one alias must not erase another alias using the same content handle.
        function scrub(item, descriptor) {
            if (stageMatchesResource(descriptor,scope)) return null;
            if (!item || typeof item !== 'object') return item;
            if (Array.isArray(item)) return item.map((v,i) => scrub(v,descriptor?.[i])).filter(v => v !== null);
            return Object.fromEntries(Object.entries(item).map(([k,v]) => [k,scrub(v,descriptor?.[k])]));
        }
        const matchesTree = item => item && typeof item === 'object' && (stageMatchesResource(item,scope) || Object.values(item).some(matchesTree));
        for (const [group,prepared] of state.accepted) {
            const next = (group === 'cg' && matchesTree(prepared.descriptors) || group === 'performance' && matchesTree([prepared.descriptors?.ref,prepared.descriptors?.dependencies,prepared.descriptors?.executionDependencies]))
                ? null : scrub(prepared.value,prepared.descriptors);
            if (JSON.stringify(next) === JSON.stringify(prepared.value)) continue;
            const retained = new Set();
            function collect(item) {if (typeof item === 'string') retained.add(item); else if (item && typeof item === 'object') Object.values(item).forEach(collect);}
            collect(next);
            prepared.pins = prepared.pins.filter(pin => {if (retained.has(pin.handle.url) && !stageMatchesResource(pin.descriptor,scope)) return true; pin.release(); return false;});
            prepared.value = next;
            prepared.descriptors = scrub(prepared.descriptors,prepared.descriptors);
            groups[group] = next === null ? {kind:'clear',reason:'revoked'} : {kind:'set',value:next};
        }
        for (const [id,shot] of state.shots) if (stageMatchesResource(shot.ref,scope) || shot.prepared?.pins.some(pin => stageMatchesResource(pin.descriptor,scope))) {
            cancel(shot); state.shots.delete(id);
            dispatch({type:'ONE_SHOT_FAILED',token:shot.token,error:'revoked'});
            cancelPlayback(source.sessionId,{token:shot.token,reason:'revoked'});
        }
        // The reducer invalidates readiness before owner destruction; late promises
        // cannot publish against the retired projection token.
        dispatch({type:'RESOURCE_REVOKED',source,groups,reason:'revoked'});
        owner.revoke(scope,stageResourceAuthority(source));
    }
    function onEffect(sessionId, intent, dispatch, getSnapshot) {
        const state = session(sessionId), token = intent.token;
        state.dispatch = dispatch; state.getSnapshot = getSnapshot;
        switch (intent.type) {
        case 'invalidate-projection': invalidate(sessionId); break;
        case 'release-preload': releaseWarm(state); break;
        case 'project': {
            // private fork: a carry projects the predecessor turn's sealed end under its own direction token.
            const carry = intent.carry, history = getSnapshot().cursor.mode === 'history';
            const expectedDirectionToken = carry ? carry.token : getSnapshot().director.token;
            const projectionSource = carry ? carry.source : token.source, assetRevision = () => carry ? carry.assetRevision : getSnapshot().director.assetRevision;
            if (!expectedDirectionToken) return;
            const warm = carry ? {cancelled:false,pin:async () => {},start() {}} : warmTimeline(state,token,expectedDirectionToken,history,getSnapshot);
            const job = {token,groups:new Map(),cancelled:false,failures:0,groupFailures:new Map(),controller:new AbortController()};
            job.done = new Promise(resolve => {job.finish = resolve;});
            state.foreground = job; state.jobs.set(token.id,job);
            const authority = stageResourceAuthority(token.source);
            state.authority = authority;
            const current = () => !job.cancelled && getSnapshot().projection?.token.id === token.id;
            // private fork (new-user journey 2026-10): a transient conflict the runner retries by itself (the host's
            // pending / stale answers, REVISION_CONFLICT / ASSET_STALE) is not a warning: it stays silent while retrying and
            // only a retry budget that runs out shows one notice (stageRetryFailure). Real failures warn at once, as before.
            const retry = (error, answer) => {
                if (!current()) return;
                // A bare pending / stale status keeps waiting without a budget; one with a cause counts as transient.
                const waiting = ['pending','stale','resources-pending'].includes(error), transient = !waiting && (answer === 'transient' || stageTransientError(error));
                if (!waiting && ++job.failures >= (transient ? STAGE_TRANSIENT_RETRIES : 3)) {
                    dispatch({type:'PROJECTION_FAILED',token,error:transient ? stageRetryFailure(error) : stageResourceErrorText(error)});
                    job.finish(); return;
                }
                dispatch({type:'PROJECTION_PENDING',token});
                if (!waiting && !transient) dispatch({type:'READ_FAILED',source:token.source,error:stageResourceErrorText(error)});
                job.timer = clock.setTimeout(run,700);
            };
            // private fork (stuck-loading): the host answers for a different direction than the one requested. Asking
            // again with the same token can never succeed; the reducer settles this request and follows the host.
            const superseded = result => {
                if (!current()) return false;
                if (!['pending','stale','ready'].includes(result.status) || !Object.hasOwn(result,'directionToken') ||
                    JSON.stringify(result.directionToken ?? null) === JSON.stringify(expectedDirectionToken)) return false;
                clock.clearTimeout(job.noticeTimer);
                dispatch({type:'PROJECTION_STALE',token,directionToken:result.directionToken ?? null});
                job.finish(); return true;
            };
            async function run() {
                try {
                    const validateResources = [...state.accepted.entries()].flatMap(([usage,value]) => value.pins.map(pin => ({ref:pin.descriptor.ref,alias:pin.descriptor.alias,usage})));
                    job.read = projection(projectionSource,expectedDirectionToken,assetRevision(),
                        {sessionId,turn:projectionSource.turn,at:intent.at,cgDisplay:{visitId:token.visitId,requestId:token.id},...(intent.page ? {page:intent.page} : {}),snap:intent.transition === 'snap',history,expectedDirectionToken,validateResources});
                    const result = await job.read;
                    if (!current()) return;
                    if (result.status === 'revoked') {revoke(state,result.scope,token.source,dispatch,getSnapshot); return;}
                    if (superseded(result)) return;
                    // A pending / stale answer is transient whatever error it carries.
                    if (result.status !== 'ready') {retry(result.error || result.status, ['pending','stale'].includes(result.status) ? 'transient' : undefined); return;}
                    if (JSON.stringify(result.directionToken) !== JSON.stringify(expectedDirectionToken)) {retry('stale'); return;}
                    let value = result.value;
                    // A turn's end resets a close-up (asset-pack seal); the carried baseline does too.
                    if (carry && value.state?.camera?.mode === 'close') value = {...value,state:{...value.state,camera:{mode:'reset',actor:null}}};
                    const plan = await (visual || stagePlaybackVisual)(value,token,expectedDirectionToken);
                    if (!current()) return;
                    const figures = Object.fromEntries((plan.figures || []).filter(figure =>
                        !plan.scene?.state?.cast || plan.scene.state.cast.includes(figure.alias)).map((figure,index) =>
                        ['figure:' + (figure.slotId ?? figure.alias ?? index),figure]));
                    // private fork: CG preparation must never hold the base scene or avatars.
                    const {cg:cgImage, ...baseScene} = plan.scene;
                    const avatars = stageAvatarResources(value.avatars);
                    const snapshot = getSnapshot(), page = snapshot.text?.pages.find(page => page.anchor?.para === token.anchor.para && page.anchor?.offset === token.anchor.offset);
                    const speaker = page && resolveSpeaker(snapshot,page);
                    const visibleAliases = new Set([...(plan.scene?.state?.cast || []),speaker].filter(Boolean));
                    const visibleAvatars = page && (page.kind !== 'line' || speaker) ? avatars.filter(figure => !figure.alias || visibleAliases.has(figure.alias) || owner.isPrepared(figure,authority)) : avatars;
                    const candidates = {
                        cg:cgImage ? {...cgImage,receipt:result.cgReceipt || null,transition:result.cgTransition || 'fade'} : null,
                        background:{scene:baseScene,lighting:plan.lighting,ruler:plan.ruler}, ...figures,
                        music:{music:value.audio.music, musicRequest:value.audio.musicRequest || null}, ambience:value.audio.soundscape, avatars:visibleAvatars, widgets:value.widgets,
                        performance:value.performance?.unavailable ? null : value.performance ? {...value.performance,
                            dependencies:value.performance.dependencies.filter(item => item.role === 'required'),
                            retiring:value.performance.retiring ? {...value.performance.retiring,dependencies:[]} : null} : null
                    };
                    dispatch({type:'PROJECTION_GROUPS',token,figureKeys:Object.keys(figures),
                        layout:{state:plan.scene?.state,ruler:plan.ruler,core:plan.scene?.core}});
                    const isVisual = group => group === 'cg' || group === 'background' || group === 'avatars' || group.startsWith('figure:');
                    if (!job.noticeTimer && Object.entries(candidates).some(([group,candidate]) =>
                        isVisual(group) && getSnapshot().projection?.outstanding.includes(group) && !owner.isPrepared(candidate,authority))) {
                        job.noticeTimer = clock.setTimeout(() => {
                            if (current()) dispatch({type:'RESOURCE_WAIT_NOTICE',token});
                        },600);
                    }
                    // private fork: each slot owns its preparation, acceptance and outgoing pin.
                    // One failed/slow figure cannot hold the background or another figure hostage.
                    await Promise.all(Object.entries(candidates).map(async ([group,candidate]) => {
                        if (!current() || !getSnapshot().projection.outstanding.includes(group)) return;
                        try {
                            const options = {usage:group,signal:job.controller.signal};
                            let prepared, notice = value.notice;
                            const previous = state.accepted.get(group);
                            const immediate = group === 'performance' && (!candidate || candidate.phase === 'exit');
                            if (immediate) prepared = {value:candidate ? {...candidate,dependencies:previous?.value?.dependencies || []} : null,
                                descriptors:candidate,pins:[],release() {}};
                            if (group === 'performance' && candidate && !immediate) await preparePerformance(candidate);
                            if (!current()) return;
                            const prepare = async candidate => {
                                try {return await owner.prepare(candidate,authority,options);}
                                catch (error) {
                                    if (error.code !== 'RESOURCE_BUDGET') throw error;
                                    releaseWarm(state);
                                    return owner.prepare(candidate,authority,options);
                                }
                            };
                            try {prepared ||= await prepare(candidate);}
                            catch (error) {
                                if (group !== 'background' || !candidate.scene?.skin) throw error;
                                // A skin bundle is optional; keep the independently valid base scene.
                                notice = 'skin-unavailable: ' + stageResourceErrorText(error);
                                prepared = await prepare({...candidate,scene:{...candidate.scene,skin:null,
                                    diagnostics:[...(candidate.scene.diagnostics || []),notice]}});
                            }
                            if (!current()) {prepared.release(); return;}
                            if (group === 'performance' && value.performance?.unavailable) dispatch({type:'READ_FAILED',source:token.source,error:value.performance.unavailable.code});
                            if (previous && JSON.stringify(previous.value) === JSON.stringify(prepared.value)) {
                                prepared.release();
                                dispatch({type:'PROJECTION_READY',token,error:notice,groups:{[group]:{kind:'keep'}}});
                            } else {
                                job.groups.set(group,prepared);
                                dispatch({type:'PROJECTION_READY',token,error:notice,groups:{[group]:{kind:'set',value:prepared.value}}});
                            }
                        } catch (error) {
                            if (!current()) return;
                            const failures = (job.groupFailures.get(group) || 0) + 1, transient = stageTransientError(error);
                            job.groupFailures.set(group,failures);
                            // A stale lease (ASSET_STALE) is retried silently; only the last attempt warns.
                            if (!transient) dispatch({type:'PROJECTION_GROUP_ERROR',token,group,error:stageResourceErrorText(error)});
                            if (failures >= 3) {
                                // Keep last-good for this element; a first-load failure is empty.
                                dispatch({type:'PROJECTION_READY',token,error:transient ? stageRetryFailure(error) : stageResourceErrorText(error),
                                    groups:{[group]:{kind:state.accepted.has(group) && (group !== 'cg' || refKey(state.accepted.get(group).value?.ref) === refKey(candidate?.ref)) ? 'keep' : 'clear',reason:'resource-failed'}}});
                            }
                        }
                    }));
                    if (current()) {
                        job.timer = clock.setTimeout(run,700);
                    } else {
                        clock.clearTimeout(job.noticeTimer); job.finish();
                        if (!job.cancelled && !warm.cancelled) {
                            const avatarToken = getSnapshot().accepted.provenanceByChannel.avatars?.token;
                            const eligible = () => !warm.cancelled && !job.cancelled && state.foreground === job && getSnapshot().opened !== false &&
                                getSnapshot().accepted.provenanceByChannel.avatars?.token === avatarToken;
                            void (async () => {
                                if (!await idle(sessionId,eligible) || !eligible()) return;
                                if (visibleAvatars.length !== avatars.length) {
                                    const prepared = await owner.prepare(avatars,authority,{usage:'avatars'});
                                    if (!eligible()) {prepared.release(); return;}
                                    const previous = state.accepted.get('avatars');
                                    state.accepted.set('avatars',prepared);
                                    dispatch({type:'AVATARS_WARMED',token:avatarToken,value:prepared.value});
                                    previous?.release();
                                }
                                if (!eligible()) return;
                                void warm.pin({...value,avatars}); warm.start();
                            })().catch(() => {});
                        }
                        if (!job.groups.size) state.jobs.delete(token.id);
                    }
                } catch (error) {retry(error);}
            }
            void run(); break;
        }
        case 'present': {
            const job = state.jobs.get(token.id), outgoing = [];
            const groups = intent.groups.includes('visual')
                ? [...intent.groups,...[...state.accepted.keys()].filter(key => key === 'background' || key.startsWith('figure:'))]
                : intent.groups;
            for (const group of groups) {
                const prepared = job?.groups.get(group);
                if (!prepared) {
                    if (intent.accepted.provenanceByChannel[group]?.kind === 'clear' || intent.groups.includes('visual')) {
                        const previous = state.accepted.get(group);
                        if (previous) outgoing.push(previous);
                        state.accepted.delete(group);
                    }
                    continue; // scoped revoke keeps the unaffected pins
                }
                job.groups.delete(group);
                const previous = state.accepted.get(group);
                if (previous) outgoing.push(previous);
                state.accepted.set(group,prepared);
            }
            // A sink's acknowledgement ends the crossfade/model handoff pin.
            const preparedPerformance = state.accepted.get('performance');
            const handles = [...(preparedPerformance?.pins || []),...outgoing.flatMap(value => value.pins)].map(pin => pin.handle);
            let finite;
            if (groups.includes('performance')) {
                state.performanceHandles=handles;
                state.retiringDependencies=outgoing.flatMap(value => value.value?.dependencies || []);
                const playback=intent.performancePlayback;
                if (!playback || playback.mode !== 'keep') for (const [id,shot] of state.shots) {
                    if (!shot.token.performance) continue;
                    cancel(shot); state.shots.delete(id);
                    dispatch({type:'ONE_SHOT_FAILED',token:shot.token,error:'Performance cancelled'});
                    cancelPlayback(sessionId,{token:shot.token,reason:'revoked'});
                }
                if (!preparedPerformance?.value || !playback) {
                    state.timeline?.dispose('unavailable'); state.finishPerformance?.();
                    performance(sessionId,{type:'clear'});
                    state.musicLock?.handle?.release({token:state.musicLock.token,reason:'unavailable',snap:true}); state.musicLock=null;
                } else {
                    const timeline=ensureTimeline(sessionId,state,dispatch,getSnapshot);
                    if (playback.mode !== 'keep') {
                        state.finishPerformance?.();
                        performanceLayer(sessionId,state,playback.layer,playback.token,null,playback.mode !== 'start');
                        const options={token:playback.token,plan:preparedPerformance.value.plan,retiring:preparedPerformance.value.retiring,handles,to:'sustained'};
                        if (playback.mode === 'start') {
                            finite=new Promise(resolve => {state.finishPerformance=resolve;});
                            timeline.start(options);
                        } else timeline.seek(options);
                    } else performanceLayer(sessionId,state,playback.layer,playback.token,null,true);
                }
            }
            const handoff = Promise.all([present(sessionId,{...intent,performanceHandles:handles}),finite]).catch(() => {}).finally(() => {
                outgoing.forEach(value => value.release()); state.handoffs.delete(handoff);
            });
            state.handoffs.add(handoff);
            break;
        }
        case 'performance-event':
            performanceLayer(sessionId,state,intent.layer,intent.token,intent.descriptor); break;
        case 'performance-sustained':
            if (intent.value) performanceLayer(sessionId,state,sustained(intent.value.plan),intent.token,{do:'phase-end'},intent.snap);
            state.finishPerformance?.(); state.finishPerformance=null; break;
        case 'cancel-projection':
        case 'release-projection': cancel(state.jobs.get(token.id)); state.jobs.delete(token.id); break;
        case 'prepare-one-shot': {
            if (intent.descriptor.kind !== 'sfx') {
                state.shots.set(token.id,{token,cancelled:false,prepared:{value:intent.descriptor,release() {}}});
                dispatch({type:'ONE_SHOT_READY',token});
                break;
            }
            const shot = {token,ref:intent.descriptor.value,cancelled:false}; state.shots.set(token.id,shot);
            if (token.performance) {
                const value=state.accepted.get('performance')?.value;
                const dependencies=intent.descriptor.retiring ? state.retiringDependencies : value?.dependencies;
                const track=dependencies?.find(item => refKey(item.ref) === refKey(shot.ref));
                const pin=track && owner.retain(track.identity,stageResourceAuthority(token.source));
                if (!pin) { state.shots.delete(token.id); dispatch({type:'ONE_SHOT_FAILED',token,error:'Performance SFX unavailable'}); break; }
                shot.prepared={value:{...track,url:pin.handle.url,gain:10**((intent.descriptor.gainDb || 0)/20)},pins:[pin],release:pin.release};
                dispatch({type:'ONE_SHOT_READY',token}); break;
            }
            const eligible = () => !shot.cancelled && getSnapshot().ledger[token.key]?.status === 'pending';
            async function prepareShot() {
                if (!eligible()) return;
                const expectedDirectionToken = getSnapshot().director.token;
                try {
                    const result = await projection(token.source,expectedDirectionToken,getSnapshot().director.assetRevision,
                        {sessionId,turn:token.source.turn,at:token.anchor.para,expectedDirectionToken});
                    if (!eligible()) return;
                    if (result.status === 'revoked') {
                        revoke(state,result.scope,token.source,dispatch,getSnapshot);
                        dispatch({type:'ONE_SHOT_FAILED',token,error:'revoked'}); return;
                    }
                    if (result.status !== 'ready' || JSON.stringify(result.directionToken) !== JSON.stringify(expectedDirectionToken)) throw new Error('SFX pending');
                    const track = result.value.audio.sfx.find(track => stageMatchesResource(track.ref,{refs:[shot.ref]}));
                    if (!track) {dispatch({type:'ONE_SHOT_FAILED',token,error:'SFX unavailable'}); state.shots.delete(token.id); return;}
                    const prepared = await owner.prepare(track,stageResourceAuthority(token.source));
                    if (!eligible()) {prepared.release(); return;}
                    shot.prepared = prepared; dispatch({type:'ONE_SHOT_READY',token});
                } catch (error) {
                    // A partial->done race changes the direction token, not this event.
                    if (eligible()) shot.timer = clock.setTimeout(prepareShot,700);
                }
            }
            void prepareShot(); break;
        }
        case 'play-one-shot': {
            const shot = state.shots.get(token.id);
            if (!shot?.prepared || shot.cancelled) break;
            Promise.resolve(play(sessionId,intent.descriptor.kind === 'mod-performance' ? intent.descriptor : shot.prepared.value,token)).finally(() => {cancel(shot); state.shots.delete(token.id);}).catch(() => {});
            break;
        }
        case 'release-one-shot': cancel(state.shots.get(token.id)); state.shots.delete(token.id); break;
        case 'cancel-playback':
            state.timeline?.dispose(intent.reason); state.finishPerformance?.(); state.finishPerformance=null;
            if (state.accepted.get('performance')?.value) {
                const value=state.accepted.get('performance').value;
                performanceLayer(sessionId,state,sustained(value.plan),state.musicLock?.token,null,true);
            }
            for (const shot of state.shots.values()) cancel(shot);
            state.shots.clear(); cancelPlayback(sessionId,intent); break;
        case 'playback-policy': present(sessionId,intent); break;
        case 'revoke-presentation':
        case 'release-presentation':
            invalidate(sessionId);
            for (const job of state.jobs.values()) cancel(job);
            state.timeline?.dispose(intent.type); state.finishPerformance?.();
            state.musicLock?.handle?.release({token:state.musicLock.token,reason:intent.type,snap:true}); state.musicLock=null;
            state.jobs.clear(); releaseWarm(state); releaseAccepted(state); present(sessionId,intent);
            if (state.authority) owner.revoke({authority:true},state.authority);
            if (intent.type === 'release-presentation') sessions.delete(sessionId);
            break;
        }
    }
    return {onEffect, prefetch, invalidate, revoke(sessionId,scope,dispatch,getSnapshot) {
        const source = getSnapshot().source;
        if (source) revoke(session(sessionId),scope,source,dispatch,getSnapshot);
    }, dispose() {
        for (const state of sessions.values()) {state.timeline?.dispose(); state.finishPerformance?.(); state.musicLock?.handle?.release({token:state.musicLock.token,reason:'dispose',snap:true}); for (const job of state.jobs.values()) cancel(job); for (const shot of state.shots.values()) cancel(shot); releaseWarm(state); releaseAccepted(state);}
        sessions.clear(); owner.dispose();
    }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageResourceRunner, stageResourceAuthority, stagePlaybackVisual};
