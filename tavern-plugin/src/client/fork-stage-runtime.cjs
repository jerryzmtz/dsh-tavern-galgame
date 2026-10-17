'use strict';

const performanceStateKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('../../../fork/mods/performance/state.cjs') : {performanceSustained:plan => performanceSustained(plan), reducePerformanceEvent:(layer,event) => reducePerformanceEvent(layer,event)};
const modProjectionKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./fork-mod-projection.cjs') : {modPerformanceLedgerKey:(...args) => modPerformanceLedgerKey(...args)};
const phoneBeatKernel = typeof module !== 'undefined' && typeof window === 'undefined'
    ? require('./fork-phone-beat.cjs') : {forkPhoneAutoVoiceAllowed:(...args) => forkPhoneAutoVoiceAllowed(...args)};
const performancePhaseLedgerKey = token => JSON.stringify(['performance-phase',token.instanceKey,token.phaseKey]);
const samePerformanceToken = (a,b) => !!a && !!b && sameSource(a.source,b.source) &&
    JSON.stringify(a.instanceKey) === JSON.stringify(b.instanceKey) && JSON.stringify(a.phaseKey) === JSON.stringify(b.phaseKey) && a.visitId === b.visitId && a.playbackEpoch === b.playbackEpoch;

// Phase A kernel. Inputs are immutable, validated adapter snapshots, never transport URLs.
const SOURCE_FIELDS = ['sessionId', 'authorityEpoch', 'branchId', 'turn', 'sourceKey', 'generation'];
const GROUPS = {
    visual: ['scene', 'lighting', 'figures', 'ruler'], // Explicit whole-scene clear only.
    background: ['scene', 'lighting', 'ruler'],
    music: ['music', 'musicRequest'], ambience: ['ambience'], avatars: ['avatars'], widgets: ['widgets'], performance: ['performance'], cg: ['cg'] // private fork: independent readiness
};
const sourceKey = source => source && JSON.stringify(SOURCE_FIELDS.map(key => source[key]));
const sameSource = (a, b) => sourceKey(a) === sourceKey(b);
const sameContext = (a, b) => a && b && ['sessionId', 'authorityEpoch', 'branchId'].every(key => a[key] === b[key]);
const emptyText = () => ({revision: -1, streaming: false, pages: [], hasReadableText: false});
const emptyDirector = () => ({phase: 'unknown', revision: -1, bindingKey: null, prefixRevision: -1, through: 0, complete: false, baseline: null, entries: []});
const emptyAccepted = (revision = 0) => ({presentationRevision: revision, provenanceByChannel: {}, figuresBySlot: {}, layout: null, scene: null, lighting: null, figures: null, ruler: null, music: null, musicRequest: null, ambience: null, avatars: null, widgets: null, performance: null, cg: null});
const emptyObservation = () => ({flight: null, timer: null, dirty: false, failures: 0, error: null});

function createStageRuntimeState() {
    return {
        source: null, latestSource: null, text: emptyText(), director: emptyDirector(), liveStreamSeen: false, visitStaged: false,
        // private fork: an undirected turn presents its baseline (the last directed turn's end), never the last page viewed.
        carry: null, carryRequest: null,
        // private fork: session inputs survive stage close and do not own media effects.
        textIndex: new Map(), settings: null, preferences: null,
        cursor: {mode: 'live', anchor: null, visitId: 0, readThrough: 0, skipping: false, firstPageEligible: false, afterEligible: false},
        accepted: emptyAccepted(), pending: {text: false, director: false, projection: false, resources: false, error: null},
        projection: null, observation: emptyObservation(), ledger: {}, serial: 0, playbackEpoch:0, performancePlayback:null, performanceFlashes:[],
        visible: true, opened: true, interrupted: false, disposed: false
    };
}

function stageRuntimeStatus(state) {
    if (!state.source) return 'idle';
    if (state.cursor.skipping) return 'skipping';
    if (state.cursor.mode === 'history') return 'historical-read';
    if (!state.text.hasReadableText && state.pending.text) return 'awaiting-text';
    if (state.director.phase === 'done') return 'directed';
    if (state.director.through > 0) return 'director-partial';
    return 'streaming-without-direction';
}

// RPC failures carry structured diagnostics; presentation must always receive text.
function stageRuntimeErrorText(error) {
    if (!error) return '';
    if (typeof error === 'string') return error;
    if (typeof error !== 'object') return String(error);
    const code = typeof error.code === 'string' ? error.code : '';
    const message = typeof error.message === 'string' ? error.message : '';
    const label = {PROJECTION_FAILED:'\u821e\u53f0\u8d44\u6e90\u6295\u5f71\u5931\u8d25', PLAYBACK_FAILED:'\u821e\u53f0\u56de\u653e\u8bfb\u53d6\u5931\u8d25',
        PLAYBACK_MEDIA_MISSING:'\u5386\u53f2\u6f14\u51fa\u7d20\u6750\u7f3a\u5931', ASSET_STALE:'\u7d20\u6750\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u91cd\u8bd5',
        REVISION_CONFLICT:'\u6f14\u51fa\u72b6\u6001\u5df2\u66f4\u65b0\uff0c\u6b63\u5728\u91cd\u8bd5'}[code] || '\u821e\u53f0\u8d44\u6e90\u8bfb\u53d6\u5931\u8d25';
    return (code ? code + ': ' : '') + label + (message ? '\uff08' + message + '\uff09' : '');
}

// private fork: retain code + message for debug consumers, never stringify diagnostic objects.
// Normal stage warnings show prose only, including for older persisted "code: message" strings.
function stageDiagnosticText(diagnostic, debug = false) {
    if (!diagnostic) return '';
    let code = '', message = '';
    if (typeof diagnostic === 'string') {
        const match = diagnostic.match(/^([a-z][a-z0-9]*(?:-[a-z0-9]+)+|[A-Z][A-Z0-9_]+)(?::\s*(.*))?$/s);
        if (match) { code = match[1]; message = match[2] || ''; }
        else message = diagnostic;
    } else if (typeof diagnostic === 'object') {
        code = typeof diagnostic.code === 'string' ? diagnostic.code : '';
        message = typeof diagnostic.message === 'string' ? diagnostic.message : '';
    } else return '';
    // private fork: raw validator prose belongs to diagnostics, never player details.
    if (!debug) {
        const reasons = {
            'Enter this actor first or choose a current cast actor.': '目标人物尚未入场，无法执行此演出',
            'Value not in catalogue': '指定值不在当前可用目录中',
            'Required field': '演出指令缺少必要参数',
            'Unknown field': '演出指令包含不支持的参数',
            'Event actor must be on stage': '目标人物尚未入场，无法执行此演出',
            'Failed to fetch': '网络连接失败，无法载入演出资源'
        };
        return reasons[message] || {
            PACING: '已按演出节奏保留原状态',
            ARG_INVALID: '演出指令参数未通过校验', INVALID_ASSET_PACK: '演出指令未通过素材校验',
            INVALID_JSON: '演出指令格式无效', REF_UNAVAILABLE: '所需素材不存在或当前不可用',
            PRECONDITION: '当前舞台状态不满足此演出的执行条件',
            DISABLED: '此演出能力未启用或没有可用素材', CAP_EXCEEDED: '演出指令超出安全限制',
            ACCEPTED_CONFLICT: '演出修正与已应用的内容冲突', INTERNAL: '演出处理失败',
            PROJECTION_FAILED: '舞台资源投影失败', PLAYBACK_FAILED: '舞台回放读取失败',
            PLAYBACK_MEDIA_MISSING: '历史演出素材缺失', ASSET_STALE: '素材已更新，正在重试',
            REVISION_CONFLICT: '演出状态已更新，正在重试',
            'time-look-missing': '缺少对应时段的灯光预设',
            'time-look-ambiguous': '对应时段存在多个灯光预设',
            'background-variant-missing': '没有可用的背景变体',
            'legacy-media-reconstructed': '旧存档未记录素材版本，已按当前素材重建'
        }[code] || (/^[^a-zA-Z]*[\u3400-\u9fff][^a-zA-Z]*$/.test(message) ? message : '本轮演出没能套用，正文不受影响；可以重新生成这一轮再试');
    }
    if (!message) {
        const time = typeof diagnostic.timeOfDay === 'string' ? diagnostic.timeOfDay : '';
        message = {
            'time-look-missing': 'No time lighting preset is available',
            'time-look-ambiguous': 'Multiple time lighting presets match',
            'background-variant-missing': 'No background variant is available',
            'legacy-media-reconstructed': 'Original media versions are unknown'
        }[code] || 'Stage presentation is degraded';
        if (time) message += ' (' + time + ')';
    }
    return debug && code ? code + ': ' + message : message;
}

const stageDropCache = new WeakMap(), stageNoDrops = Object.freeze([]);
function stageDropIsCorrection(drop) {
    // private fork: persisted records have no precondition subtype; match only the
    // registry's onstage guard, not every PRECONDITION (or non-retryable failure).
    return drop.code === 'PACING' || drop.code === 'PRECONDITION' &&
        drop.message === 'Enter this actor first or choose a current cast actor.' &&
        ['actor.act.play', 'actor.emote.play', 'closeup.play', 'dof.set'].includes(drop.command);
}
function stageDirectorDrops(record) {
    if (!record) return stageNoDrops;
    if (!stageDropCache.has(record)) stageDropCache.set(record, record.diagnostics?.filter(item => item.dropped && !stageDropIsCorrection(item)) || stageNoDrops);
    return stageDropCache.get(record);
}
function stageRuntimeIndicators(state) {
    return {
        writing: !state.text.hasReadableText && state.pending.text,
        // private fork (new-user journey 2026-10): the body is still streaming (the stage notice reads 「正在写正文…」).
        streaming: state.pending.text,
        // private fork: reading a stored direction (or waiting for text) is not director work.
        spinner: state.pending.director && !(state.text.hasReadableText && state.director.binding?.stream),
        // private fork: projection RPCs, warm cache hits and voice are not loading notices.
        loading: !!state.projection?.notice && state.projection.outstanding.some(stageVisualGroup),
        // private fork (R10): a failed direction warns on every visit to that turn, not only while the failure is fresh.
        error: state.pending.error ? stageRuntimeErrorText(state.pending.error)
            : state.director.phase === 'error' ? stageRuntimeErrorText(state.director.error || 'DIRECTION_FAILED') : null,
        degraded: ['off', 'error'].includes(state.director.phase) ? state.director.phase : null,
        // private fork: automatic corrections stay in diagnostics/stats; only real failures warn.
        drops: stageDirectorDrops(state.director.record),
        // private fork (B4, O41): Auto holds here; manual paging never does.
        awaitingDirection: stageAwaitingDirection(state)
    };
}
// The live page's paragraph has no director prefix yet although one is coming (body still streaming or director
// running). Off/error/done, history, skip and cancelled turns never wait.
function stageAwaitingDirection(state) {
    const anchor = state.cursor.anchor, config = state.settings?.config;
    if (!state.source || !anchor || state.cursor.mode !== 'live' || state.cursor.skipping || state.interrupted) return false;
    if (!config || config.enabled === false || config.stage?.director !== true) return false;
    if (state.director.complete || ['done', 'off', 'error'].includes(state.director.phase) || state.director.through >= anchor.para) return false;
    return state.pending.director || state.pending.text || state.text.streaming;
}

const stageVisualGroup = key => key === 'cg' || key === 'background' || key === 'avatars' || key.startsWith('figure:');
const sameAnchor = (a, b) => a === b || !!a && !!b && a.paragraphId === b.paragraphId && a.para === b.para && a.offset === b.offset;
function pageAt(text, anchor) {
    return text.pages.find(page => sameAnchor(page.anchor, anchor));
}
function reconcileAnchor(text, anchor) {
    if (!anchor) return text.pages[0]?.anchor || null;
    const pages = text.pages.filter(page => page.anchor.paragraphId === anchor.paragraphId);
    return pages.filter(page => page.anchor.offset <= anchor.offset).at(-1)?.anchor || pages[0]?.anchor || text.pages[0]?.anchor || null;
}
const directionToken = state => ({bindingKey: state.director.bindingKey, prefixRevision: state.director.prefixRevision});
const sameDirection = (a, b) => a?.bindingKey === b?.bindingKey && a?.prefixRevision === b?.prefixRevision;
function sameRequest(a, b) {
    return !!a && !!b && a.id === b.id && sameSource(a.source, b.source) &&
        sameDirection(a.direction, b.direction) && a.visitId === b.visitId && sameAnchor(a.anchor, b.anchor);
}

function reduceStageRuntime(previous, event) {
    if (previous.disposed) {
        const type = event.type === 'PROJECTION_READY' ? 'release-projection' : event.type === 'ONE_SHOT_READY' ? 'release-one-shot' : null;
        return {state: previous, effects: type ? [{type, token: event.token}] : []};
    }
    let state = previous;
    const effects = [];
    const patch = value => { state = {...state, ...value}; };
    const pending = value => patch({pending: {...state.pending, ...value}});
    const observation = value => patch({observation: {...state.observation, ...value}});
    const nextId = () => { patch({serial: state.serial + 1}); return state.serial; };
    const effect = (type, value = {}) => effects.push({type, ...value});
    const scoped = () => sameSource(event.source, state.source) && !!state.source;

    function cancelTimer() {
        if (state.observation.timer) effect('cancel-timer', {token: state.observation.timer});
        observation({timer: null});
    }
    function cancelProjection() {
        if (state.projection) effect('cancel-projection', {token: state.projection.token});
        patch({projection: null});
        pending({projection: false, resources: false});
    }
    function cancelPlayback(reason) {
        let ledger = state.ledger;
        for (const [key, entry] of Object.entries(ledger)) {
            if (entry.status !== 'pending') continue;
            if (ledger === state.ledger) ledger = {...ledger};
            if (entry.descriptor.kind === 'mod-performance') delete ledger[key];
            else ledger[key] = {...entry, status: 'skipped', reason};
        }
        patch({ledger, playbackEpoch:state.playbackEpoch+1, performancePlayback:null});
        effect('cancel-playback', {source: state.source, visitId: state.cursor.visitId, reason});
    }
    function cancelSource() {
        cancelTimer(); cancelProjection(); cancelPlayback('source-changed');
        effect('release-preload');
        if (state.observation.flight) effect('cancel-read', {token: state.observation.flight});
        if (state.source) effect('unwatch-director', {source: state.source});
        patch({observation: emptyObservation()});
    }
    function requestRead() {
        if (!state.source) { observation({dirty: true}); return; }
        if (state.observation.flight) { observation({dirty: true}); return; }
        cancelTimer();
        const token = {id: nextId(), source: state.source};
        observation({flight: token, dirty: false});
        effect('read-director', {token, sinceRevision: state.director.revision, readOnly: true});
    }
    function scheduleRead() {
        cancelTimer();
        if (!state.source || state.cursor.mode === 'history') return;
        const converged = ['done', 'off', 'error'].includes(state.director.phase);
        if (converged && !state.opened) return;
        const delay = state.observation.failures ? Math.min(5000, 700 * 2 ** (state.observation.failures - 1)) : converged ? 5000 : 700;
        const token = {id: nextId(), source: state.source};
        observation({timer: token});
        effect('schedule-read', {token, delay});
    }
    function finishRead(failed) {
        const dirty = state.observation.dirty;
        observation({flight: null, failures: failed ? state.observation.failures + 1 : 0,
            error: failed ? state.observation.error : null, dirty: false});
        if (dirty && !failed) requestRead();
        else scheduleRead();
    }
    const directed = () => !!state.director.bindingKey && (state.director.complete || state.director.through > 0);
    // A settled turn without a usable prefix (failed or never directed) carries its baseline.
    const carryNeeded = () => !!state.source && state.director.revision >= 0 && !directed() &&
        (state.director.phase === 'error' || state.director.phase === 'unknown' && !state.pending.text && !state.text.streaming);
    function requestCarry() {
        if (state.carry || state.carryRequest || !carryNeeded()) return;
        const token = {id: nextId(), source: state.source};
        patch({carryRequest: token});
        effect('resolve-carry', {token});
    }
    function requestProjection() {
        cancelProjection();
        if (!state.cursor.anchor) return;
        if (!directed()) {
            const carry = state.carry?.envelope;
            if (!carry) return;
            // The predecessor's sealed end, folded at its last paragraph; nothing of this turn is replayed.
            const token = {id: nextId(), source: state.source, direction: {bindingKey: carry.bindingKey, prefixRevision: carry.prefixRevision}, visitId: state.cursor.visitId, anchor: state.cursor.anchor};
            patch({projection: {token, carry: true, outstanding: Object.keys(GROUPS).filter(key => key !== 'visual')}});
            pending({projection: true});
            effect('project', {token, at: carry.through, carry: {source: state.carry.source, token: carry.token, assetRevision: carry.assetRevision},
                baseline: carry.baseline, entries: carry.entries, complete: true,
                transition: state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal'});
            return;
        }
        const token = {id: nextId(), source: state.source, direction: directionToken(state), visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        patch({projection: {token, outstanding: Object.keys(GROUPS).filter(key => key !== 'visual')}});
        pending({projection: true});
        effect('project', {
            token, at: Math.min(state.cursor.anchor.para, state.director.through),
            ...(state.cursor.anchor.para <= state.director.through ? {page:{index:state.text.pages.findIndex(page => sameAnchor(page.anchor,state.cursor.anchor)),para:state.cursor.anchor.para,offset:state.cursor.anchor.offset,version:1}} : {}),
            baseline: state.director.baseline, entries: state.director.entries,
            complete: state.director.complete,
            transition: state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal'
        });
    }
    function ledgerEvent(key, at, descriptor, late = false, after = false) {
        if (state.ledger[key] || at > state.cursor.anchor.para) return;
        const cursor = state.cursor;
        // private fork (B4): every consumed-without-playing event records why (diagnostics; no replay).
        const reason = late ? 'late' : at < cursor.anchor.para ? 'passed' : cursor.skipping ? 'skip' : !state.opened ? 'stage-closed'
            : cursor.mode !== 'live' ? 'history' : (after ? !cursor.afterEligible : cursor.anchor.offset !== 0 || !cursor.firstPageEligible) ? 'not-first-page' : null;
        const eligible = !reason;
        // One-shot presentations are consumed by history/skip, never queued for a later visit.
        const token = {key, id: nextId(), source: state.source, visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        patch({ledger: {...state.ledger, [key]: {status: eligible ? 'pending' : 'skipped', token, descriptor, ...(reason ? {reason} : {})}}});
        if (eligible) effect('prepare-one-shot', {token, descriptor});
    }
    function scanEvents(late = false) {
        if (!state.cursor.anchor) return;
        for (const entry of state.director.entries) {
            if (entry.at > state.director.through || entry.at > state.cursor.anchor.para) break;
            for (const op of entry.events || []) {
                const key = JSON.stringify([sourceKey(state.source), state.director.generation ?? 0, entry.ordinal, op.ordinal, state.cursor.visitId]);
                ledgerEvent(key, entry.at, op, late);
            }
        }
        for (const performance of state.director.modPerformances || []) {
            if (performance.at > state.director.through) continue;
            const after = /^dsh\.textcard(?:\.|$)/.test(performance.kind || '') && performance.payload?.placement === 'after';
            if (after && performance.at === state.cursor.anchor.para && state.cursor.mode === 'live' && !state.cursor.skipping && state.opened && !late && state.cursor.afterEligible) {
                const page = pageAt(state.text, state.cursor.anchor), next = state.text.pages[state.text.pages.indexOf(page) + 1];
                // Echoes wait for the entire anchored paragraph, including its final page, to be revealed.
                if (!page || page.pending || typeof page.text !== 'string' || next?.anchor.para === performance.at ||
                    state.cursor.readThrough < page.anchor.offset + page.text.length) continue;
            }
            const key = modProjectionKernel.modPerformanceLedgerKey(sourceKey(state.source),performance.id,state.director.generation ?? 0);
            ledgerEvent(key, performance.at, {kind:'mod-performance',performance}, late, after);
        }
        const page = pageAt(state.text, state.cursor.anchor);
        if (page?.voice && phoneBeatKernel.forkPhoneAutoVoiceAllowed(state.director,page.anchor.para,state.settings?.config?.stage?.director===true)) {
            const key = JSON.stringify([sourceKey(state.source), 'voice', page.anchor.paragraphId, state.cursor.visitId]);
            ledgerEvent(key, page.anchor.para, {kind: 'voice', ...page.voice});
        }
    }
    // follow: the cursor reached this turn by following the live latest turn, so the presentation on
    // screen is this turn's starting point. Navigation (history jump, resume, a SEND that pulls a
    // historical cursor forward) still shows the departure position until this visit stages a page.
    function selectSource(source, mode, text, anchor, generating, follow = false) {
        const old = state.source;
        cancelSource();
        const revoke = old && !sameContext(old, source);
        if (revoke) {
            patch({accepted: emptyAccepted(state.accepted.presentationRevision + 1)});
            effect('revoke-presentation', {source: old, groups: Object.keys(GROUPS), reason: 'context-changed'});
        }
        const nextText = text || emptyText();
        // Mod one-shots are consumed for the session, not for a reading visit.
        const ledger = Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => entry.descriptor.kind === 'mod-performance'));
        patch({source, text: nextText, director: emptyDirector(), carry: null, carryRequest: null, ledger, liveStreamSeen: mode === 'live' && (!!generating || nextText.streaming),
            visitStaged: mode === 'live' && follow,
            cursor: {mode, anchor: anchor || nextText.pages[0]?.anchor || null, visitId: state.cursor.visitId + 1, readThrough: 0, skipping: false, firstPageEligible: mode === 'live', afterEligible: mode === 'live'},
            interrupted: false,
            pending: {text: !!generating || nextText.streaming, director: false, projection: false, resources: false, error: null}});
        if (mode === 'live') patch({latestSource: source});
        if (source) {
            effect('watch-director', {source});
            requestRead(); scanEvents();
        }
    }
    function acceptDirector(envelope) {
        if (!scoped() || envelope.revision <= state.director.revision) return;
        // The source adapter verifies digest/units/sealed entries. Revision is the watch
        // envelope version; prefixRevision only changes when persistent semantics change.
        // private fork: an explicit host retry is a new semantic generation even
        // when native text is unchanged. Keep presentation and paragraph voice.
        if (envelope.generation !== undefined && state.director.generation !== undefined && envelope.generation !== state.director.generation) {
            if (envelope.generation < state.director.generation) return;
            cancelProjection();
            patch({director: emptyDirector(), carry: null, carryRequest: null, ledger: Object.fromEntries(Object.entries(state.ledger)
                .filter(([,entry]) => entry.descriptor.kind === 'voice' || entry.descriptor.kind === 'mod-performance' && entry.status !== 'pending'))});
        }
        const hasPrefix = envelope.prefixRevision !== undefined;
        if (hasPrefix && (envelope.prefixRevision < state.director.prefixRevision || envelope.through < state.director.through)) return;
        // private fork (stuck-loading): a tokenless envelope means the host no longer serves any direction for this
        // turn (a stopped or failed stream, a removed preview, direction turned off). Its old prefix cannot be
        // projected any more, so the turn becomes undirected and carries its baseline; accepted media stay until then.
        const dropped = !hasPrefix && dropUnservedPrefix();
        const before = directionToken(state);
        // The failure text is part of the turn's direction state (R10), replaced by every newer envelope.
        const director = hasPrefix ? {...state.director, ...envelope, error: envelope.error || null} : {...state.director, phase: envelope.phase, revision: envelope.revision, generation: envelope.generation, assetRevision: envelope.assetRevision, error: envelope.error || null};
        patch({director, liveStreamSeen: state.liveStreamSeen || state.cursor.mode === 'live' && envelope.streaming === true});
        if (envelope.modCorrectionRevision !== previous.director.modCorrectionRevision) {
            const performances = new Map((director.modPerformances || []).map(row => [row.id,row]));
            let ledger = state.ledger;
            for (const [key,entry] of Object.entries(ledger)) {
                if (entry.status !== 'pending' || entry.descriptor.kind !== 'mod-performance') continue;
                if (ledger === state.ledger) ledger = {...ledger};
                const performance = performances.get(entry.descriptor.performance.id);
                ledger[key] = performance ? {...entry,descriptor:{kind:'mod-performance',performance}} : {...entry,status:'skipped'};
                if (!performance) effect('release-one-shot',{token:entry.token});
            }
            if (ledger !== state.ledger) patch({ledger});
        }
        pending({director: !state.interrupted && !director.complete && ['running', 'partial'].includes(director.phase), error: envelope.error || (state.interrupted ? state.pending.error : null)});
        // private fork: streaming direction can advance logic, never restage the page
        // already on screen. Remember this visit's live stream through its final deltas;
        // a persisted stream binding alone must not fence a cold completed-turn read.
        // Forward/history navigation projects the newest fold normally.
        // The fence protects a page this live flow already shows. It never preserves a departure
        // position's presentation: a visit that has staged nothing yet projects its current page.
        const readFence = state.liveStreamSeen && state.visitStaged && !!envelope.binding?.stream && state.cursor.mode === 'live' && state.text.hasReadableText;

        if (hasPrefix && (!sameDirection(before, directionToken(state)) || envelope.complete && !previous.director.complete)) {
            if (readFence) cancelProjection(); else requestProjection();
        }
        if (dropped && state.carry) requestProjection();
        requestCarry();
        scanEvents(readFence);
    }
    function dropUnservedPrefix() {
        if (!state.director.bindingKey) return false;
        cancelProjection();
        const {phase, revision, generation, assetRevision, error} = state.director;
        patch({director: {...emptyDirector(), phase: ['running', 'partial', 'done'].includes(phase) ? 'unknown' : phase, revision, generation, assetRevision, error: error || null}});
        pending({director: false});
        return true;
    }
    function performanceBoundaryPlayback() {
        const value=state.accepted.performance, old=state.performancePlayback;
        if (!value) {
            const ledger=Object.fromEntries(Object.entries(state.ledger).map(([key,entry]) => [key,entry.performanceEvent && entry.status === 'pending' ? {...entry,status:'skipped'} : entry]));
            patch({ledger,performancePlayback:null,playbackEpoch:state.playbackEpoch+1}); return;
        }
        if (old && JSON.stringify(old.token.instanceKey) === JSON.stringify(value.instanceKey) && JSON.stringify(old.token.phaseKey) === JSON.stringify(value.phaseKey) &&
            old.token.playbackEpoch === state.playbackEpoch && sameSource(old.token.source,state.source)) {
            patch({performancePlayback:{...old,mode:'keep'}}); return;
        }
        const token={source:state.source,instanceKey:value.instanceKey,phaseKey:value.phaseKey,visitId:state.cursor.visitId,playbackEpoch:state.playbackEpoch+1};
        const key=performancePhaseLedgerKey(token), summary=state.ledger[key];
        // private fork (owner 2026-10): turning forward onto the trigger page plays the phase in real time even while
        // replaying a completed turn (history); jumps, page-back and revisits in this visit (ledger summary) snap.
        const live=!summary && state.opened && !state.cursor.skipping && state.cursor.firstPageEligible && value.phase !== 'idle';
        const layer=performanceStateKernel.performanceSustained(value.plan);
        let initial=layer;
        if (live) {
            initial={skin:null,bgm:value.plan.bgm || null,look:null,ambience:null,widgets:{}};
            if (value.phase === 'exit' && old) initial=old.layer;
            if (value.phase !== 'entry') for (const event of value.plan.sustainedEvents || []) {
                if (event.block === 'entry') initial=performanceStateKernel.reducePerformanceEvent(initial,event);
            }
        }
        // Older cycles collapse into the phase summary; no per-frame or unbounded idle history.
        const ledger=Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => !entry.performanceEvent));
        ledger[key]=summary || {status:live ? 'pending' : 'skipped',descriptor:{kind:'performance-phase'},lastCompletedCycle:-1};
        patch({ledger,playbackEpoch:token.playbackEpoch,performancePlayback:{token,mode:live ? 'start' : 'seek',layer:initial}});
    }
    function commitGroups(groups, token, transition) {
        let accepted = state.accepted;
        const changed = [];
        for (const [group, intent] of Object.entries(groups)) {
            const figure = group.startsWith('figure:');
            const fields = figure ? ['figures'] : GROUPS[group];
            if (!fields || !['set', 'clear'].includes(intent.kind)) continue;
            const values = intent.kind === 'clear' ? Object.fromEntries(fields.map(field => [field, null])) :
                figure ? {figures:intent.value} : ['visual','background','music'].includes(group) ? intent.value : {[group]: intent.value};
            if (fields.some(field => !Object.hasOwn(values, field))) throw new TypeError('Incomplete presentation group: ' + group);
            const provenance = {token, kind: intent.kind, reason: intent.reason || null};
            if (accepted === state.accepted) accepted = {...accepted, provenanceByChannel: {...accepted.provenanceByChannel}};
            if (figure) {
                accepted.figuresBySlot = {...accepted.figuresBySlot};
                if (intent.kind === 'clear') delete accepted.figuresBySlot[group];
                else accepted.figuresBySlot[group] = intent.value;
                const order = state.projection?.figureKeys || Object.keys(accepted.figuresBySlot);
                const keys = [...order, ...Object.keys(accepted.figuresBySlot).filter(key => !order.includes(key))];
                accepted.figures = keys.map(key => accepted.figuresBySlot[key]).filter(Boolean);
            } else {
                for (const field of fields) accepted[field] = values[field];
                if (group === 'visual') {accepted.figuresBySlot = {}; accepted.layout = null;}
            }
            if ((figure || group === 'background') && state.projection?.layout) accepted.layout = state.projection.layout;
            accepted.provenanceByChannel[group] = provenance;
            changed.push(group);
        }
        if (changed.length) {
            accepted.presentationRevision++;
            patch({accepted});
            if (changed.includes('performance')) performanceBoundaryPlayback();
            effect('present', {token, groups: changed, accepted, transition, performancePlayback:state.performancePlayback});
        }
    }

    switch (event.type) {
    case 'SESSION_INPUTS': {
        const inputs = {};
        for (const key of ['textIndex', 'settings', 'preferences']) {
            if (Object.hasOwn(event, key) && event[key] !== state[key]) inputs[key] = event[key];
        }
        if (Object.keys(inputs).length) patch(inputs);
        break;
    }
    case 'SESSION_EMPTY':
        selectSource(null, 'live', emptyText(), null, false);
        break;
    case 'SEND':
    case 'SEND_ACK':
    case 'TURN_CHANGED':
        if (state.cursor.mode === 'history' && event.type === 'TURN_CHANGED' && sameContext(state.source, event.source)) {
            patch({latestSource: event.source});
        } else if (!sameSource(state.source, event.source)) {
            selectSource(event.source, 'live', event.text, null, event.type !== 'TURN_CHANGED' || event.generating, state.cursor.mode === 'live' && !!state.source);
        } else if (event.type !== 'TURN_CHANGED' && state.cursor.mode === 'history') {
            // SEND can precede the new native node. Leave history now, or its later
            // TURN_CHANGED would keep following the old turn forever.
            patch({cursor: {...state.cursor, mode: 'live'}, latestSource: event.source});
            requestRead();
        }
        break;
    case 'HISTORY_JUMP':
        selectSource(event.source, 'history', event.text, event.anchor, false);
        // Turning forward into a completed turn lands on its first page like a live page turn (performance entry).
        if (event.forward && state.cursor.anchor?.offset === 0) patch({cursor:{...state.cursor, firstPageEligible:true}});
        break;
    case 'RESUME_LIVE':
        selectSource(event.source || state.latestSource, 'live', event.text, event.anchor, event.generating);
        break;
    case 'TEXT_APPEND':
    case 'TEXT_RECONCILE': {
        if (!scoped() || event.text.revision <= state.text.revision) break;
        const oldAnchor = state.cursor.anchor;
        const anchor = reconcileAnchor(event.text, oldAnchor && {...oldAnchor, offset: Math.max(oldAnchor.offset, state.cursor.readThrough)});
        const sameParagraph = oldAnchor?.paragraphId === anchor?.paragraphId;
        patch({text: event.text, liveStreamSeen: state.liveStreamSeen || state.cursor.mode === 'live' && event.text.streaming, cursor: {...state.cursor, anchor,
            readThrough: sameParagraph ? state.cursor.readThrough : 0,
            firstPageEligible: state.cursor.firstPageEligible && (!oldAnchor || sameParagraph) && anchor?.offset === 0}});
        pending({text: event.text.streaming && !state.interrupted});
        if (!sameAnchor(anchor, oldAnchor)) {
            cancelPlayback('anchor-changed'); requestProjection();
        }
        scanEvents();
        if (!event.text.streaming && previous.text.streaming) { requestRead(); requestCarry(); }
        break;
    }
    case 'SEND_FAILED':
    case 'SEND_CANCELLED':
        if (scoped()) {
            patch({text: {...state.text, streaming: false}, interrupted: true});
            pending({text: false, director: false, error: event.error || 'cancelled'});
            requestRead();
            // private fork (B4, madoka-1 #11): a failed/cancelled (re)generation is undirected; show its baseline, never blank.
            requestCarry();
        }
        break;
    case 'READ_PROGRESS':
        if (scoped() && (!event.anchor || sameAnchor(event.anchor,state.cursor.anchor))) {
            patch({cursor: {...state.cursor, readThrough: Math.max(state.cursor.readThrough, event.readThrough)}});
            scanEvents();
        }
        break;
    case 'PAGE': {
        const page = state.text.pages[event.index];
        if (!page || sameAnchor(page.anchor, state.cursor.anchor)) break;
        cancelPlayback('page-changed');
        const forward = !state.cursor.anchor || page.anchor.para > state.cursor.anchor.para;
        patch({cursor: {...state.cursor, anchor: page.anchor, readThrough: page.anchor.offset,
            afterEligible: forward && page.anchor.offset === 0 || state.cursor.afterEligible && page.anchor.para === state.cursor.anchor?.para && page.anchor.offset > state.cursor.anchor.offset,
            firstPageEligible: forward && page.anchor.offset === 0}});
        requestProjection(); scanEvents();
        break;
    }
    case 'SKIP_START': {
        cancelPlayback('skip');
        const index = Math.max(0, Math.min(event.index ?? state.text.pages.length - 1, state.text.pages.length - 1));
        patch({cursor: {...state.cursor, skipping: true, anchor: state.text.pages[index]?.anchor || state.cursor.anchor, readThrough: 0, firstPageEligible: false, afterEligible: false}});
        requestProjection(); scanEvents();
        break;
    }
    case 'SKIP_END':
        patch({cursor: {...state.cursor, skipping: false}});
        break;
    case 'ACCEPT_PREFIX':
    case 'DIRECTOR_SNAPSHOT':
        acceptDirector(event.envelope);
        if (scoped() && !state.observation.flight) scheduleRead();
        break;
    case 'DIRECTOR_READ_RESULT':
    case 'DIRECTOR_READ_FAILED':
        if (event.token?.id !== state.observation.flight?.id || !sameSource(event.token?.source, state.source)) break;
        if (event.type === 'DIRECTOR_READ_FAILED') {
            observation({error: event.error});
            pending({error: event.error});
        } else {
            if (state.observation.error && state.pending.error === state.observation.error) pending({error: null});
            if (event.envelope) {
                // Completion events carry their source in the read token, not a second identity.
                event = {...event, source: event.token.source};
                acceptDirector(event.envelope);
            }
        }
        finishRead(event.type === 'DIRECTOR_READ_FAILED');
        break;
    case 'CARRY_RESULT':
        // carry: {source, envelope} of the nearest earlier complete direction, or null (none / unreadable).
        if (event.token?.id !== state.carryRequest?.id || !sameSource(event.token?.source, state.source)) break;
        patch({carryRequest: null, carry: event.carry || null});
        if (event.carry && !directed()) requestProjection();
        break;
    case 'RECONCILE':
    case 'DIRECTOR_WAKE':
        if (!event.source || scoped()) requestRead();
        break;
    case 'READ_TIMER':
        if (event.token?.id === state.observation.timer?.id && sameSource(event.token?.source, state.source)) {
            observation({timer: null}); requestRead();
        }
        break;
    case 'VISIBILITY':
        patch({visible: event.visible});
        // Visibility may pause painting, never source reads or incremental state.
        if (event.visible) requestRead();
        break;
    case 'STAGE_OPEN':
        patch({opened: event.opened});
        effect('playback-policy', {opened:event.opened});
        if (event.opened) {
            // private fork: opening a settled stream is an explicit restore, not a late delta.
            if (!previous.opened && state.liveStreamSeen && state.director.complete && !state.text.streaming) {
                patch({liveStreamSeen: false}); requestProjection();
            }
            requestRead();
            if (state.accepted.performance && !state.performancePlayback) {
                performanceBoundaryPlayback();
                effect('present',{token:{id:nextId(),source:state.source},groups:['performance'],accepted:state.accepted,transition:'snap',performancePlayback:state.performancePlayback});
            }
        } else {
            cancelPlayback('stage-closed');
            patch({cursor: {...state.cursor, firstPageEligible: false, afterEligible: false}});
            scheduleRead();
        }
        break;
    case 'READ_PENDING':
    case 'REFRESH_BEGIN':
        if (scoped()) {
            if (event.type === 'REFRESH_BEGIN') effect('invalidate-projection');
            pending({error: null}); requestProjection();
        }
        break;
    case 'READ_FAILED':
        if (scoped()) pending({error: event.error});
        break;
    case 'PROJECTION_PENDING':
        if (sameRequest(event.token, state.projection?.token)) pending({projection: false, resources: true});
        break;
    // private fork (stuck-loading): the host no longer serves the direction this request names (a cancelled or failed
    // stream, a redirected or removed record). Re-asking with that token can only be answered stale again, so the
    // request settles here instead of waiting forever; accepted presentation is kept until a replacement is accepted.
    case 'PROJECTION_STALE': {
        if (!sameRequest(event.token, state.projection?.token)) break;
        const carried = !!state.projection.carry;
        cancelProjection();
        // A stale carry is resolved again only by a changed direction read, never in a loop on the same answer.
        if (carried) { patch({carry: null}); break; }
        // The host has no direction for this turn at all: the turn is undirected and presents its baseline.
        if (!event.directionToken && dropUnservedPrefix()) {
            if (state.carry) requestProjection(); else requestCarry();
        }
        // A newer direction is picked up by the ordinary read; its new token projects the current page.
        requestRead();
        break;
    }
    // private fork: discovery registers directed slots before any asynchronous group can finish.
    case 'PROJECTION_GROUPS':
        if (sameRequest(event.token, state.projection?.token) && !state.projection.figureKeys) {
            patch({projection:{...state.projection, figureKeys:event.figureKeys, layout:event.layout,
                outstanding:[...state.projection.outstanding, ...event.figureKeys]}});
        }
        break;
    case 'RESOURCE_WAIT_NOTICE':
        if (sameRequest(event.token, state.projection?.token) && state.projection.outstanding.some(stageVisualGroup)) {
            patch({projection: {...state.projection, notice: true}});
        }
        break;
    case 'PROJECTION_GROUP_ERROR':
        if (sameRequest(event.token, state.projection?.token) && state.projection.outstanding.includes(event.group)) {
            patch({projection:{...state.projection, errors:{...state.projection.errors,[event.group]:event.error}}});
            pending({error:event.error});
        }
        break;
    case 'PROJECTION_FAILED':
        if (sameRequest(event.token, state.projection?.token)) {
            cancelProjection(); pending({error: event.error});
        }
        break;
    case 'PROJECTION_READY': {
        if (!sameRequest(event.token, state.projection?.token)) {
            effect('release-projection', {token: event.token}); break;
        }
        const groups = Object.fromEntries(Object.entries(event.groups).filter(([key]) => state.projection.outstanding.includes(key)));
        const retired = {};
        if (groups.background && groups.background.kind !== 'unknown' && state.projection.figureKeys) {
            for (const key of Object.keys(state.accepted.figuresBySlot)) {
                if (!state.projection.figureKeys.includes(key)) retired[key] = {kind:'clear',reason:'slot-removed'};
            }
        }
        commitGroups({...groups,...retired}, event.token, state.cursor.mode === 'history' || state.cursor.skipping ? 'snap' : 'normal');
        const resolved = Object.keys(groups).filter(key => groups[key].kind !== 'unknown');
        if (resolved.some(stageVisualGroup) && !state.visitStaged) patch({visitStaged: true});
        const outstanding = state.projection.outstanding.filter(key => !resolved.includes(key));
        const errors = {...state.projection.errors};
        for (const key of resolved) {if (event.error) errors[key] = event.error; else delete errors[key];}
        patch({projection: outstanding.length ? {...state.projection, outstanding, errors} : null});
        pending({projection: outstanding.length > 0, resources: outstanding.length > 0,
            // private fork (B4): a carried scene must not erase the failed generation's notice.
            error: Object.values(errors)[0] || (state.interrupted ? state.pending.error : null)});
        break;
    }
    case 'AVATARS_WARMED':
        if (sameRequest(event.token,state.accepted.provenanceByChannel.avatars?.token))
            patch({accepted:{...state.accepted,avatars:event.value}});
        break;
    case 'PERFORMANCE_UNAVAILABLE':
        if (scoped()) {
            const token = {id:nextId(),source:state.source,direction:directionToken(state),visitId:state.cursor.visitId,anchor:state.cursor.anchor};
            commitGroups({performance:{kind:'clear',reason:event.reason}},token,'snap');
        }
        break;
    case 'RESOURCE_REVOKED':
        if (scoped()) {
            cancelProjection();
            const token = {id:nextId(),source:state.source,direction:directionToken(state),visitId:state.cursor.visitId,anchor:state.cursor.anchor};
            commitGroups(event.groups,token,'snap');
        }
        break;
    case 'CLEAR':
    case 'REVOKE': {
        if (!scoped()) break;
        // Revocation invalidates the whole in-flight candidate, but only clears named groups.
        cancelProjection();
        if (event.type === 'REVOKE') cancelPlayback('revoked');
        const token = {id: nextId(), source: state.source, direction: directionToken(state), visitId: state.cursor.visitId, anchor: state.cursor.anchor};
        const groups = Object.fromEntries(event.groups.map(group => [group, {kind: 'clear', reason: event.reason}]));
        commitGroups(groups, token, 'snap');
        break;
    }
    case 'PERFORMANCE_EVENT_DUE': {
        const playback=state.performancePlayback;
        // Only a started (first forward visit) playback schedules events, in live and history alike.
        if (!samePerformanceToken(event.token,playback?.token) || state.cursor.skipping || !state.opened || state.ledger[event.key]) break;
        const summary=state.ledger[performancePhaseLedgerKey(event.token)];
        if (event.descriptor.cueId !== 'type' && (event.descriptor.cycle ?? 0) <= (summary?.lastCompletedCycle ?? -1)) break;
        const descriptor=event.descriptor, token={...event.token,key:event.key,id:nextId(),anchor:state.cursor.anchor,performance:true};
        const audio=descriptor.do === 'sfx';
        if (descriptor.do === 'flash') {
            const flashes=state.performanceFlashes.filter(at => event.atMs-at<1000);
            if(flashes.length>=3) {
                patch({ledger:{...state.ledger,[event.key]:{status:'skipped',token,descriptor,performanceEvent:true}}});break;
            }
            patch({performanceFlashes:[...flashes,event.atMs]});
        }
        const layer=descriptor.retiring ? playback.layer : performanceStateKernel.reducePerformanceEvent(playback.layer,descriptor);
        patch({performancePlayback:{...playback,layer},ledger:{...state.ledger,[event.key]:{status:audio ? 'pending' : 'played',token,descriptor,performanceEvent:true}}});
        if (audio) effect('prepare-one-shot',{token,descriptor:{...descriptor,kind:'sfx',value:descriptor.ref}});
        else effect('performance-event',{token:playback.token,descriptor,layer});
        break;
    }
    case 'PERFORMANCE_PHASE_CONSUMED':
    case 'PERFORMANCE_CYCLE_COMPLETED': {
        if (!samePerformanceToken(event.token,state.performancePlayback?.token)) break;
        const key=performancePhaseLedgerKey(event.token), old=state.ledger[key];
        if (!old) break;
        const cycle=event.cycle ?? old.lastCompletedCycle;
        const ledger=Object.fromEntries(Object.entries(state.ledger).filter(([,entry]) => !entry.performanceEvent || (entry.descriptor.cycle ?? 0)>cycle || entry.status === 'pending'));
        ledger[key]={...old,status:event.skipped ? 'skipped' : 'played',lastCompletedCycle:Math.max(old.lastCompletedCycle,cycle)};
        patch({ledger});
        if (event.type === 'PERFORMANCE_PHASE_CONSUMED') effect('performance-sustained',{token:event.token,value:state.accepted.performance,snap:!!event.skipped});
        break;
    }
    case 'ONE_SHOT_READY': {
        const entry = state.ledger[event.token?.key];
        if (!entry || entry.status !== 'pending' || entry.token.id !== event.token.id ||
            !sameSource(event.token.source, state.source) || event.token.visitId !== state.cursor.visitId ||
            (event.token.performance && !samePerformanceToken(event.token,state.performancePlayback?.token)) ||
            !sameAnchor(event.token.anchor, state.cursor.anchor) || state.cursor.skipping || state.cursor.mode === 'history' && !event.token.performance && entry.descriptor.kind !== 'mod-performance' || !state.opened) {
            effect('release-one-shot', {token: event.token}); break;
        }
        patch({ledger: {...state.ledger, [event.token.key]: {...entry, status: 'played'}}});
        effect('play-one-shot', {token: event.token, descriptor: entry.descriptor});
        break;
    }
    case 'ONE_SHOT_FAILED': {
        const entry = state.ledger[event.token?.key];
        if (entry?.status === 'pending' && entry.token.id === event.token.id) {
            patch({ledger: {...state.ledger, [event.token.key]: {...entry, status: 'skipped', reason: 'failed'}}});
        }
        break;
    }
    case 'DISPOSE':
        cancelSource();
        effect('release-presentation', {accepted: state.accepted});
        patch({disposed: true});
        break;
    default:
        throw new TypeError('Unknown stage runtime event: ' + event.type);
    }
    return {state, effects};
}

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = {createStageRuntimeState, reduceStageRuntime, stageRuntimeStatus, stageRuntimeIndicators, stageRuntimeErrorText, stageDiagnosticText, sourceKey, sameSource};
