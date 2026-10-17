'use strict';

// private fork: the kernel owns scheduling/single-flight; this adapter only executes
// read-only IO and validates the host's canonical identity against the display index.
const stageDirectorSourceKey = source => JSON.stringify(source);
const stageDirectorCanonical = value => Array.isArray(value) ? '[' + value.map(stageDirectorCanonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort((a,b) => {
        // private fork: compare Unicode scalars without allocating arrays per key comparison.
        let i = 0, j = 0;
        while (i < a.length && j < b.length) {
            const x = a.codePointAt(i), y = b.codePointAt(j);
            if (x !== y) return x - y;
            i += x > 65535 ? 2 : 1; j += y > 65535 ? 2 : 1;
        }
        return (a.length - i) - (b.length - j);
    }).map(key => JSON.stringify(key) + ':' + stageDirectorCanonical(value[key])).join(',') + '}' : JSON.stringify(value);
// private fork: the host computes and checks every digest (units, binding, page index,
// record/preview) before replying; the browser compares identities and alignment only.
async function validateStageDirection(value, source, text) {
    const check = condition => {if (!condition) throw new Error('Invalid or unaligned stage direction');};
    check(Number.isSafeInteger(value.revision));
    if (value.unchanged) return null;
    check(['unknown','running','partial','done','off','error'].includes(value.phase));
    if (!value.token) return {phase:value.phase, revision:value.revision, generation:value.generation, assetRevision:value.assetRevision, error:value.error};
    const token = value.token, target = value.target, binding = value.binding;
    check(target?.sessionId === source.sessionId && target.turn === source.turn && target.sourceKey === token.sourceKey &&
        target.branchId === token.branchId && value.generation === token.generation && binding?.target.sourceKey === target.sourceKey &&
        binding.target.sourceDigest === target.sourceDigest &&
        (typeof binding.unitsDigest === 'string' || value.complete && value.legacyPlayback === true && binding.unitsDigest === undefined));
    const unit = ({kind,text,alias,name}) => ({kind,text,...(alias === undefined ? {} : {alias}),...(name === undefined ? {} : {name})});
    // private fork: a host-admitted stream authenticates only its sealed display prefix.
    const streaming = value.streaming === true;
    if (binding.stream) check(binding.stream.version === 1 && typeof binding.stream.operationId === 'string' && binding.stream.epoch === token.generation);
    if (streaming) check(binding.stream && !binding.stream.committed && !value.complete);
    else if (binding.stream) check(binding.stream.committed === true && value.complete);
    check((streaming || !text.streaming) && Array.isArray(text.units) && stageDirectorCanonical((streaming ? text.units.slice(0,value.displayUnits.length) : text.units).map(unit)) === stageDirectorCanonical(value.displayUnits));
    if (value.pageIndex || binding.pageDigest) {
        const indexOf = typeof stagePageIndex === 'function' ? stagePageIndex : require('./fork-stage-page-index.cjs').stagePageIndex;
        const expected = indexOf(value.displayUnits);
        const actual = text.pages?.map((page, index) => ({page:index, para:page.anchor?.para, offset:page.anchor?.offset})).filter(page => !streaming || page.para <= value.displayUnits.length);
        if (stageDirectorCanonical(expected) !== stageDirectorCanonical(value.pageIndex) ||
            stageDirectorCanonical(actual) !== stageDirectorCanonical(expected.pages)) {
            throw Object.assign(new Error('STAGE_PAGE_MISMATCH: canonical reading pages differ'), {code:'STAGE_PAGE_MISMATCH'});
        }
    }
    check(Number.isSafeInteger(value.through) && value.through >= 0 && value.through <= value.units.length);
    if (value.complete) {
        const record = value.record;
        check(record?.complete === true && token.digest === record.digest);
    } else {
        const {prefixDigest, ...preview} = value.preview || {};
        check(preview.complete === false && prefixDigest === token.digest &&
            preview.through === value.through && preview.prefixRevision === token.prefixRevision && preview.generation === token.generation &&
            stageDirectorCanonical(preview.units) === stageDirectorCanonical(value.units));
    }
    const data = value.record || value.preview;
    check(stageDirectorCanonical(data.binding) === stageDirectorCanonical(binding) && stageDirectorCanonical(data.entries) === stageDirectorCanonical(value.entries) &&
        stageDirectorCanonical(data.baseline) === stageDirectorCanonical(value.baseline));
    let at = 0;
    const entries = value.entries.map((entry,ordinal) => {
        check(Number.isSafeInteger(entry.at) && entry.at >= Math.max(1,at) && entry.at <= value.through);
        at = entry.at;
        const commands = typeof directorCommands !== 'undefined' ? directorCommands : require('../../packages/dsh-presentation-protocol/src/director-commands.cjs');
        const ops = entry.ops.map(op => commands.recordOperation(op,binding)).filter(Boolean);
        return {...entry, ops, ordinal, events:ops.flatMap((op,ordinal) => op.op === 'event' ? [{...op.value, kind:op.value.op, ordinal}] : [])};
    });
    return {...value, entries};
}

function createStageDirectorSource({read, watch, clock = globalThis, onEffect = () => {}}) {
    const watches = new Map(), timers = new Map(), reads = new Map();
    // private fork: validated completed turns are reusable across back/forward visits.
    // Polls still read the host. A latest-turn wake must not evict old sealed turns.
    const completed = new Map(), signalVersions = new Map();
    function cache(sessionId) {
        if (!completed.has(sessionId)) completed.set(sessionId,new Map());
        return completed.get(sessionId);
    }
    function remember(source, text, envelope) {
        const entries = cache(source.sessionId), key = stageDirectorSourceKey(source);
        entries.delete(key);
        if (!text.streaming && (envelope?.complete && envelope.phase === 'done' || ['off','error','unknown'].includes(envelope?.phase))) {
            entries.set(key,{textKey:stageDirectorCanonical(text.units),envelope});
            while (entries.size > 200) entries.delete(entries.keys().next().value);
        }
        return envelope;
    }
    function runEffect(sessionId, intent, dispatch, getSnapshot) {
        const id = token => JSON.stringify([sessionId,token.id]);
        switch (intent.type) {
        case 'watch-director': {
            const source = intent.source, key = stageDirectorSourceKey(source);
            watches.get(key)?.();
            let subscribing = true;
            watches.set(key,watch(source,signal => {
                if (signal?.kind && signal.version !== undefined) {
                    const signalKey = JSON.stringify([source.sessionId,signal.kind]);
                    if (signalVersions.get(signalKey) === signal.version) return;
                    signalVersions.set(signalKey,signal.version);
                }
                // Subscription replay is not a mutation. Poll/wake validates only its source.
                if (!subscribing) {
                    cache(source.sessionId).delete(key);
                    dispatch({type:'DIRECTOR_WAKE',source});
                }
            }));
            subscribing = false;
            break;
        }
        case 'unwatch-director': {
            const key = stageDirectorSourceKey(intent.source);
            watches.get(key)?.(); watches.delete(key); break;
        }
        case 'read-director': {
            const token = intent.token, key = id(token), controller = new AbortController();
            const cacheKey = stageDirectorSourceKey(token.source), text = getSnapshot().text;
            const textKey = stageDirectorCanonical(text.units);
            const entries = cache(sessionId), cached = entries.get(cacheKey);
            if (intent.sinceRevision < 0 && cached && !text.streaming && cached.textKey === textKey) {
                entries.delete(cacheKey); entries.set(cacheKey,cached);
                dispatch({type:'DIRECTOR_READ_RESULT',token,envelope:cached.envelope});
                break;
            }
            reads.set(key,controller);
            Promise.resolve().then(() => read({sessionId,turn:token.source.turn,readOnly:true,sinceRevision:intent.sinceRevision},controller.signal))
                .then(async value => {
                    if (controller.signal.aborted) return;
                    const envelope = await validateStageDirection(value,token.source,getSnapshot().text);
                    if (!controller.signal.aborted) {
                        const before = getSnapshot().director;
                        if (envelope) remember(token.source,text,envelope);
                        else remember(token.source,text,before); // An unchanged wake revalidates the cached snapshot.
                        dispatch({type:'DIRECTOR_READ_RESULT',token,envelope});
                        if (envelope && before.assetRevision !== undefined && envelope.assetRevision !== before.assetRevision &&
                            envelope.token?.digest === before.token?.digest) dispatch({type:'REFRESH_BEGIN',source:token.source});
                    }
                }).catch(error => {
                    if (!controller.signal.aborted) dispatch({type:'DIRECTOR_READ_FAILED',token,error:String(error.message)});
                }).finally(() => {if (reads.get(key) === controller) reads.delete(key);});
            break;
        }
        case 'cancel-read': reads.get(id(intent.token))?.abort(); reads.delete(id(intent.token)); break;
        case 'schedule-read': {
            const key = id(intent.token);
            timers.set(key,clock.setTimeout(() => {timers.delete(key); dispatch({type:'READ_TIMER',token:intent.token});},intent.delay));
            break;
        }
        case 'cancel-timer': clock.clearTimeout(timers.get(id(intent.token))); timers.delete(id(intent.token)); break;
        default: onEffect(sessionId,intent,dispatch,getSnapshot);
        }
    }
    return {runEffect,
        cached(source, text) {
            const entries = cache(source.sessionId), key = stageDirectorSourceKey(source), entry = entries.get(key);
            if (!entry || text.streaming || entry.textKey !== stageDirectorCanonical(text.units)) return null;
            entries.delete(key); entries.set(key,entry);
            return entry.envelope;
        },
        async prime(source, text, value) {
            const entry = cache(source.sessionId).get(stageDirectorSourceKey(source));
            if (entry?.envelope === value && entry.textKey === stageDirectorCanonical(text.units)) return value;
            return remember(source,text,await validateStageDirection(value,source,text));
        },
        invalidate(sessionId) {completed.delete(sessionId);},
        dispose() {
        for (const stop of watches.values()) stop();
        for (const timer of timers.values()) clock.clearTimeout(timer);
        for (const controller of reads.values()) controller.abort();
        watches.clear(); timers.clear(); reads.clear(); completed.clear(); signalVersions.clear();
    }};
}
if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageDirectorSource, validateStageDirection};
