// Private fork (docs/fork/dialogue-bubbles.md): dialogue bubbles.
// The model writes `@bubble:alias|name|mood|[line]` lines (thoughts as `[*...*]`);
// narration stays ordinary Markdown. Avatars, names and colors come from the
// card's bubble settings (host: lib/domain/dialogue-bubbles.js, RPC
// getDialogueBubbles / saveDialogueBubbles). Rendering needs no settings: an
// unknown alias gets a lettered placeholder.

// @include-protocol figure-resolution.cjs
// @include fork-bubble-line.cjs

const FORK_BUBBLE_MOODS = __TAVERN_BUBBLE_MOODS__;
// Explicit engine declarations and alias-scoped figure declarations have the same status.
const FORK_CUSTOM_MOOD_MAX = 256;
const FORK_CUSTOM_MOOD_COLOR = "#8b8f99";
// Card emotion ids → chip colours: deterministic per id from the surface table's emotion palette (fork-surfaces.cjs);
// harnesses without the surface table get the neutral colour.
function forkCustomMoodColors(ids) {
    return typeof forkSurfaces === "object" && forkSurfaces && typeof forkSurfaces.emotionColors === "function" ? forkSurfaces.emotionColors(ids) : (ids || []).map(() => FORK_CUSTOM_MOOD_COLOR);
}
const forkMoodListCache = new WeakMap();
function forkMoodWords(group) { return Array.isArray(group && group.words) ? group.words : String(group && group.words || "").split(" ").filter(Boolean); }
// Engine custom emotions [{ id, label, note }]. Figure rows use guidance instead.
function forkCustomEmotions(config) {
    const list = config && Array.isArray(config.emotions) ? config.emotions : [];
    return list.filter(item => item && typeof item.id === "string" && item.id && typeof item.label === "string" && item.label)
        .map(item => ({ id: item.id, label: item.label, ...(item.words ? {words:item.words} : {}), note: typeof item.note === "string" ? item.note : "" }));
}
// private fork: host and browser share the same per-figure vocabulary overlay.
function forkBubbleMoodList(config, alias) {
    if (alias !== undefined) return forkFigureBubbleMoods(forkBubbleMoodList(config), forkBubbleCharacter(config,alias)?.emotions);
    if (!config || typeof config !== "object") return FORK_BUBBLE_MOODS.map(group => ({...group, builtin:true}));
    if (forkMoodListCache.has(config)) return forkMoodListCache.get(config);
    const builtinIds = new Set(FORK_BUBBLE_MOODS.map(group => group.id));
    const given = Array.isArray(config.moods) ? config.moods.filter(item => item && typeof item.id === "string" && item.id && item.label) : [];
    const custom = Array.isArray(config.emotions) ? forkCustomEmotions(config) : given.filter(item => !builtinIds.has(item.id) && item.builtin !== true).map(item => ({ id: item.id, label: String(item.label), note: item.note || "" }));
    const list = FORK_BUBBLE_MOODS.map(({note, ...group}) => ({ ...group, builtin: true })).concat(custom.filter(item => !builtinIds.has(item.id)).map(item => {
        const known = given.find(entry => entry.id === item.id);
        return { id: item.id, label: item.label, note: item.note, color: known && known.color || FORK_CUSTOM_MOOD_COLOR, words: item.words || known && known.words || "", builtin: false };
    }));
    forkMoodListCache.set(config, list);
    return list;
}
// A mood word → its group: an exact id or label first (so a custom label wins over a builtin detailed word),
// then the builtin detailed words. `moods` defaults to the builtin emotions.
function forkBubbleMood(word, moods) {
    return forkResolveBubbleMood(word, moods || FORK_BUBBLE_MOODS);
}
// private fork: labels are presentation only; sprite and voice state IDs stay unchanged.
function forkBubbleMoodLabel(word, moods, config, alias) {
    const states = (config?.spriteDialogue || []).filter(row => row.alias === forkBubbleCharacter(config, alias)?.alias).flatMap(row => row.states || []);
    const seen = new Set();
    function resolve(value) {
        const text = String(value || "").trim();
        if (!text || seen.has(text)) return "";
        seen.add(text);
        const direct = forkBubbleMood(text, moods);
        if (direct) return direct.label;
        const state = states.find(item => item.id === text);
        const base = state && (state.parent || (state.emotion !== text ? state.emotion : ""));
        if (base) return resolve(base);
        const group = (moods || FORK_BUBBLE_MOODS).slice().sort((a,b) => b.id.length - a.id.length)
            .find(item => text === item.id + "_variant" || text.startsWith(item.id + "_variant_") || text.startsWith(item.id + "_variant-") || text.startsWith(item.id + "-"));
        return group?.label || "";
    }
    return resolve(word);
}
// private fork (owner 2026-10, docs/fork/figure-auto-color.md): one rule. A speaker's colour is its figure's image colour as
// the host projected it for this card, with its readable name inks per scheme (character.ink). A speaker without a figure
// has no image colour: the fallback token (ui-design §2.4), and its name stays in the reading ink.
function forkBubbleColor(character) {
    return character && character.color || "var(--fork-figure-fallback)";
}
// Per-session bubble settings, shared by every rendered message.
const forkBubbleStore = (function () {
    const entries = new Map();
    const listeners = new Set(), watches = new Map();
    function remember(sessionId, entry) {
        entries.delete(sessionId); entries.set(sessionId, entry);
        while (entries.size > 64) entries.delete(entries.keys().next().value);
    }
    function emit() { listeners.forEach(fn => fn()); }
    function load(sessionId, renew) {
        const current = entries.get(sessionId);
        // private fork (owner 2026-10 r2): a renewal supersedes a read already in flight (that read may predate the
        // save being shown), so a 舞台设置 change is never lost to the 60 s poll.
        if (current && !renew && (current.loading || current.data)) return;
        const request = { loading: true, data: current && current.data || null };
        remember(sessionId, request);
        rpc("getDialogueBubbles", { sessionId: sessionId }, sessionId).then(function (data) {
            if (entries.get(sessionId) !== request) return;
            remember(sessionId, { loading: false, data: data });
            emit();
        }, function (error) {
            // private fork: a failed renewal must not unmount the stage or blank its face images.
            const revoked = ["FORBIDDEN", "REVISION_CONFLICT", "CONSUMER_UNAVAILABLE", "ASSET_LIBRARY_UNAVAILABLE"].includes(error?.code);
            if (entries.get(sessionId) === request) entries.set(sessionId, { loading: false, data: revoked ? null : request.data });
        });
    }
    return {
        subscribe(fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
        get(sessionId) { const entry = entries.get(sessionId); if (entry) remember(sessionId, entry); return entry ? entry.data : null; },
        load: load,
        watch(sessionId) {
            let watch = watches.get(sessionId);
            if (!watch) {
                const refresh = () => load(sessionId, true);
                const timer = setInterval(refresh, 60000);
                timer.unref?.();
                if (typeof document !== "undefined") document.addEventListener("visibilitychange", refresh);
                watch = {count:0, stop() { clearInterval(timer); if (typeof document !== "undefined") document.removeEventListener("visibilitychange", refresh); }};
                watches.set(sessionId, watch);
            }
            watch.count++;
            return () => { if (--watch.count === 0) { watch.stop(); watches.delete(sessionId); } };
        },
        set(sessionId, data) {
            if (data.cardPath) for (const [id, entry] of entries) {
                if (entry.data && entry.data.cardPath === data.cardPath) entries.set(id, { loading: false, data: { ...entry.data, config: data.config, instruction: data.instruction, injection: data.injection } });
            }
            remember(sessionId, { loading: false, data: data }); emit();
        },
        invalidate(sessionId) { entries.delete(sessionId); emit(); }
    };
})();
function useForkBubbles(sessionId, wanted, select) {
    const data = React.useSyncExternalStore(forkBubbleStore.subscribe, function () {
        const value = forkBubbleStore.get(sessionId);
        return select ? select(value) : value;
    });
    React.useEffect(function () { if (wanted) forkBubbleStore.load(sessionId); }, [wanted, sessionId, data]);
    React.useEffect(function () { if (wanted) return forkBubbleStore.watch(sessionId); }, [wanted, sessionId]);
    return data;
}

// private fork: zoom uses an uncached original, never the stage overflow bitmap or thumbnail.
async function forkPortraitSource(media, signal) {
    const descriptor = media.avatar;
    if (!descriptor) return {src:media.src, release() {}};
    const service = forkPackTransport.service;
    const lease = await service.leaseMedia({packId:descriptor.ref.packId, hash:descriptor.hash});
    let original, target, source;
    try {
        if (lease.revision !== descriptor.revision) throw new Error('ASSET_STALE');
        signal.throwIfAborted();
        const response = await fetch(lease.url, {credentials:'same-origin', signal});
        if (!response.ok) throw new Error('RESOURCE_READ_FAILED');
        original = URL.createObjectURL(await response.blob());
        signal.throwIfAborted();
        if (!media.crop) {
            const src = original; original = null;
            return {src, release() { URL.revokeObjectURL(src); }};
        }
        source = new Image();
        await new Promise((resolve, reject) => { source.onload = resolve; source.onerror = reject; source.src = original; });
        signal.throwIfAborted();
        const crop = media.crop, width = source.naturalWidth * crop.w, height = source.naturalHeight * crop.h;
        target = document.createElement('canvas');
        target.width = Math.max(1, Math.round(width)); target.height = Math.max(1, Math.round(height));
        target.getContext('2d').drawImage(source, source.naturalWidth * crop.x, source.naturalHeight * crop.y,
            width, height, 0, 0, target.width, target.height);
        const blob = await new Promise(resolve => target.toBlob(resolve, 'image/png'));
        signal.throwIfAborted();
        if (!blob) throw new Error('AVATAR_ENCODE_FAILED');
        const src = URL.createObjectURL(blob);
        return {src, release() { URL.revokeObjectURL(src); }};
    } finally {
        if (source) { source.onload = source.onerror = null; source.src = ''; }
        if (target) target.width = target.height = 0;
        if (original) URL.revokeObjectURL(original);
        void service.releaseLease(lease.ticket);
    }
}
// private fork: retain only decoded zooms, bounded across this browser session.
const forkPortraitCache = new Map();
function forkPortraitKey(media) {
    const avatar = media.avatar;
    return JSON.stringify([avatar?.sessionId, avatar?.ref, avatar?.hash, avatar?.revision, media.identity, media.crop]);
}
function forkPortraitPreview(media, button) {
    const image = button?.querySelector('img');
    if (!image?.complete || !image.naturalWidth) return null;
    // Snapshot the displayed pixels so transcript cache eviction cannot revoke the preview.
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const crop = image.parentElement?.dataset.avatarCrop;
    const rect = crop ? JSON.parse(crop) : {x:0,y:0,w:1,h:1};
    const width = image.naturalWidth * rect.w, height = image.naturalHeight * rect.h;
    const scale = 256 / Math.max(width, height);
    canvas.getContext('2d').drawImage(image, image.naturalWidth * rect.x, image.naturalHeight * rect.y,
        width, height, (256 - width * scale) / 2, (256 - height * scale) / 2, width * scale, height * scale);
    return canvas.toDataURL('image/png');
}
function forkShowPortrait(media, caption, preview = media?.src) {
    if (!preview || typeof document === "undefined") return;
    const controller = new AbortController();
    const key = forkPortraitKey(media);
    const cached = forkPortraitCache.get(key);
    if (cached) { forkPortraitCache.delete(key); forkPortraitCache.set(key, cached); }
    const overlay = document.createElement("div");
    overlay.className = "fork-bubble-lightbox";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", caption || "头像");
    const figure = document.createElement("figure");
    const frame = document.createElement('div');
    frame.className = 'fork-portrait-frame';
    const img = document.createElement("img");
    img.alt = '';
    img.src = cached?.src || preview;
    frame.append(img);
    figure.append(frame);
    if (caption) { const text = document.createElement("figcaption"); text.textContent = caption; figure.append(text); }
    overlay.append(figure);
    function close() { controller.abort(); overlay.remove(); document.removeEventListener("keydown", onKey, true); }
    function onKey(event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }
    overlay.addEventListener("click", close);
    document.addEventListener("keydown", onKey, true);
    document.body.append(overlay);
    if (cached || !media.avatar) return;
    return forkPortraitSource(media, controller.signal).then(async value => {
        const sharp = new Image();
        try {
            await new Promise((resolve, reject) => { sharp.onload = resolve; sharp.onerror = reject; sharp.src = value.src; });
            if (controller.signal.aborted) { value.release(); return; }
            const previous = forkPortraitCache.get(key);
            previous?.release();
            forkPortraitCache.delete(key);
            forkPortraitCache.set(key, value);
            while (forkPortraitCache.size > 16) {
                const oldest = forkPortraitCache.keys().next().value;
                forkPortraitCache.get(oldest).release(); forkPortraitCache.delete(oldest);
            }
            sharp.alt = '';
            sharp.className = 'fork-portrait-sharp';
            frame.append(sharp);
            img.className = 'fork-portrait-preview-out';
        } catch (_) { value.release(); }
        finally { sharp.onload = sharp.onerror = null; }
    }, () => { /* Keep the already displayed preview on lease/crop failure. */ });
}
function forkBubbleMediaDescriptor(character, mood, moods) {
    const group = forkBubbleMood(mood, moods);
    return character?.avatarMedia?.moods?.[group?.id] || character?.avatarMedia?.default || null;
}
// Transcript and stage pin the same session/authority-owned bytes and Blob URL.
const forkBubbleMediaPool = (() => {
    let users = 0, generation = 0;
    const changed = event => { if (event?.type === 'unavailable' || event?.revision === null) generation++; };
    return {
        get generation() { return generation; },
        retain() {
            if (!users++) forkPackListeners.add(changed);
            return {owner:forkStageSessions.resourceOwner, release() { if (!--users) forkPackListeners.delete(changed); }};
        }
    };
})();
// private fork: observe against the transcript's own scroller. With the implicit viewport
// root, a scroller's overflow clip nullifies rootMargin, so there was no overscan at all.
// One scroller height above and below is prepared before it scrolls into view.
const forkBubbleViewport = (() => {
    const listeners = new Map(), observers = new Map(), nearest = new WeakMap();
    // Memoized per ancestor: a thousand-row transcript shares one ancestor chain.
    const scroller = node => {
        // private fork (perf: chat open): the chat's own scroller is marked by the host. Reading computed overflow up each row's
        // chain forced style on every (content-visibility skipped) turn: ~470 ms opening 小圆. Other containers keep the walk.
        const marked = node?.closest?.('[data-conversation-scroll]');
        if (marked) return marked;
        const seen = [];
        let found = null;
        for (let parent = node?.parentElement; parent && parent !== document.body && parent !== document.documentElement; parent = parent.parentElement) {
            if (nearest.has(parent)) { found = nearest.get(parent); break; }
            seen.push(parent);
            if (/^(auto|scroll|overlay)$/.test(getComputedStyle(parent).overflowY)) { found = parent; break; }
        }
        for (const element of seen) nearest.set(element, found);
        return found;
    };
    return {watch(node, notify) {
        if (typeof IntersectionObserver === 'undefined') { notify(true); return () => {}; }
        const root = scroller(node);
        let observer = observers.get(root);
        if (!observer) observers.set(root, observer = {users:0, value:new IntersectionObserver(entries =>
            entries.forEach(entry => listeners.get(entry.target)?.(entry.isIntersecting)), {root, rootMargin:'100% 0px'})});
        observer.users++;
        listeners.set(node, notify); observer.value.observe(node);
        return () => {
            observer.value.unobserve(node); listeners.delete(node);
            if (!--observer.users) { observer.value.disconnect(); if (observers.get(root) === observer) observers.delete(root); }
        };
    }};
})();
function useForkBubbleMedia(sessionId, character, mood, moods, wanted = true) {
    const descriptor = forkBubbleMediaDescriptor(character, mood, moods);
    const session = forkStageSessions.get(sessionId);
    const authority = React.useSyncExternalStore(session?.subscribe || (() => () => {}), () => {
        const source = session?.getSnapshot().source;
        return source ? JSON.stringify([source.sessionId,source.authorityEpoch]) : null;
    });
    const activeStage = React.useSyncExternalStore(forkGalActive.subscribe, forkGalActive.get);
    const enabled = wanted && activeStage !== sessionId;
    const revision = useForkPackRevision();
    const generation = forkBubbleMediaPool.generation;
    const [loaded, setLoaded] = React.useState(null);
    const key = JSON.stringify([authority, descriptor?.identity, descriptor?.revision, generation]);
    const avatar = descriptor ? {...descriptor,sessionId} : null;
    const cache = typeof forkAvatarCache === 'undefined' ? null : forkAvatarCache;
    const cached = React.useSyncExternalStore(cache?.subscribe || (() => () => {}), () => avatar && cache?.ready(avatar) || null);
    React.useEffect(() => {
        if (activeStage === sessionId || cached || (!enabled && !cache)) { setLoaded(null); return; }
        if (!descriptor || !authority || !forkStageSessions.resourceOwner) return;
        const pool = forkBubbleMediaPool.retain();
        let active = true, pin = null;
        // private fork: loaded transcript rows (including the viewport margin) warm
        // their actual mood at idle; ready rows never reacquire original sprite leases.
        const load = () => {
            if (enabled) setLoaded({key, loading:true});
            return pool.owner.acquire(descriptor, authority).then(async value => {
            if (!active) { value.release(); return; }
            pin = value;
            if (enabled) setLoaded({key, media:{identity:value.handle.identity, src:value.handle.url}});
            if (cache) await cache.prepare(avatar,value.handle.url);
            if (!enabled) { pin?.release(); pin = null; }
            }, () => { if (active) setLoaded(null); });
        };
        let cancel = () => {};
        if (enabled) void load();
        else if (typeof requestIdleCallback === 'function') {
            const task = requestIdleCallback(() => { if (active) void load(); }, {timeout:500});
            cancel = () => cancelIdleCallback(task);
        } else {
            const task = setTimeout(() => { if (active) void load(); }, 50);
            cancel = () => clearTimeout(task);
        }
        return () => { active = false; cancel(); pin?.release(); pin = null; pool.release(); };
    }, [key, descriptor?.revision, revision, enabled, cached, activeStage]);
    // private fork (stage perf): under the stage a row keeps its already-cached face (no lease),
    // so entering/leaving does not replace every transcript avatar and restyle the chat.
    if (activeStage === sessionId) return cached ? {identity:descriptor.identity,src:cached,crop:descriptor.crop,avatar,originalSrc:undefined} : null;
    if (!enabled && !cached) return null;
    const media = enabled && loaded?.key === key ? loaded.media : null;
    return media || cached ? {...media,identity:descriptor.identity,src:media?.src || cached,crop:descriptor.crop,avatar,originalSrc:media?.src}
        : enabled && loaded?.key === key && loaded.loading ? {loading:true} : null;
}

function ForkBubbleAvatar(props) {
    const h = React.createElement;
    const moodLabel = forkBubbleMoodLabel(props.mood, props.moods, props.config, props.alias);
    const src = props.media?.src;
    const image = src ? h(ForkPackImage, {identity:props.media.identity,src,crop:props.media.crop,avatar:props.media.avatar,originalSrc:props.media.originalSrc,alt:"",draggable:false}) : null;
    if (src && props.zoomable) return h("button", { type: "button", className: "fork-bubble-avatar fork-bubble-avatar-zoom", title: "查看大图",
        onClick: function (event) { forkShowPortrait(props.media, (props.name || "") + (moodLabel ? " · " + moodLabel : ""), forkPortraitPreview(props.media, event.currentTarget)); } },
        image);
    if (src) return h("span", { className: "fork-bubble-avatar" }, image);
    // Still loading: the shared spinner, centred on the plate after 150 ms; a new face (alias/mood) restarts the delay.
    return h("span", { className: "fork-bubble-avatar" }, props.media?.loading ? h(ForkSpinner, { key: JSON.stringify([props.alias,props.mood]), fill: true }) : null);
}

function ForkBubbleRow(props) {
    const h = React.createElement;
    const segment = props.segment, config = props.config;
    const character = forkBubbleCharacter(config,segment);
    const color = character && character.color || forkBubbleColor(character), ink = character && character.color ? character.ink : null;
    const name = forkBubbleDisplayName(segment, config);
    const chars = Array.from(name);
    const moods = forkBubbleMoodList(config, character?.alias);
    const mood = forkBubbleMood(segment.mood, moods);
    const moodLabel = forkBubbleMoodLabel(segment.mood, moods, config, character?.alias);
    const row = React.useRef(null), [visible, setVisible] = React.useState(false);
    React.useEffect(() => forkBubbleViewport.watch(row.current, setVisible), []);
    const media = useForkBubbleMedia(props.sessionId, character, segment.mood, moods, visible);
    return h("div", { ref:row, className: "fork-bubble" + (segment.thought ? " fork-bubble-thought" : ""), style: { "--bubble-color": color, "--bubble-ink-light": ink?.light, "--bubble-ink-dark": ink?.dark, "--mood-color": mood ? mood.color : color }, "data-alias": segment.alias },
        h("div", { className: "fork-bubble-portrait" },
            h(ForkBubbleAvatar, { media: media, config: config, mood: segment.mood, moods: moods, color: color, name: name, alias: character?.alias, zoomable: true }),
            props.voice ? h(ForkVoiceButton, { voice: props.voice }) : null),
        h("div", { className: "fork-bubble-body" },
            h("div", { className: "fork-bubble-head" },
                h("span", { className: "fork-bubble-name" }, chars.map(function (ch, index) {
                    return h("span", { key: index, className: index === 0 ? "fork-bubble-ch" : index === 2 ? "fork-bubble-cs" : undefined }, ch);
                })),
                moodLabel ? h("span", { className: "fork-bubble-mood" }, moodLabel) : null),
            h("div", { className: "fork-bubble-text" },
                // Inner thoughts read as a parenthesised aside, not italics.
                h("span", { className: "fork-bubble-line" }, segment.thought ? "（" + segment.text.replace(/^[（(]|[）)]$/g, "") + (segment.streaming ? "" : "）") : segment.text),
                // 「从这里进入舞台」 after the last character of the line (ForkStageParagraph); rendered here, not portalled.
                props.enter || null)));
}

// Drop-in for TavernColoredMarkdown on assistant prose.
// private fork: freeze the entire consumer, including Markdown and voice hooks.
function ForkBubblePublication(props) {
    const active = React.useSyncExternalStore(forkGalActive.subscribe, forkGalActive.get);
    const cached = React.useRef(null);
    if (active !== props.sessionId || props.voicePreview) cached.current = React.createElement(ForkBubbleContent, props);
    return cached.current;
}
function ForkBubbleContent(props) {
    const h = React.createElement;
    const text = String(props.text || "");
    const has = text.indexOf("@bubble") >= 0;
    const segments = React.useMemo(() => forkParseBubbles(text, props.streaming), [text, props.streaming]);
    const select = React.useMemo(() => forkBubbleMessageSelector(segments), [segments]);
    const data = useForkBubbles(props.sessionId, has || Boolean(props.voiceScope), select);
    const match = /^(\d+):(\d+)(?::plugin:\d+)?$/.exec(String(props.voiceScope || ""));
    const source = props.stageSource;
    const stageSuperseded = Boolean(props.stageSuperseded || source && (source.superseded || forkGalIsSuperseded(source.view, source.nativeTurn, match && Number(match[1]))));
    props = Object.assign({}, props, { stageSuperseded, stageOrder: source && source.order,
        voiceScope: source && match ? props.voiceScope + ":" + source.nodeId : props.voiceScope,
        interrupted: props.interrupted || stageSuperseded });
    const activeStage = React.useSyncExternalStore(forkGalActive.subscribe, forkGalActive.get);
    const transcript = React.useRef(null);
    const markdownProps = Object.assign({}, props, { stageTranscript: !props.voicePreview });
    delete markdownProps.sessionId;
    delete markdownProps.voiceScope;
    delete markdownProps.stageParaBase;
    delete markdownProps.stageParaOffset;
    delete markdownProps.stageSource;
    delete markdownProps.stageOrder;
    delete markdownProps.stageSuperseded;
    delete markdownProps.interrupted;
    const config = data && data.config || null;
    const voice = useForkVoiceBubbles(props, segments, data && data.cardPath, config);

    const enter = match && config && config.enabled && !props.voicePreview && !stageSuperseded;
    // private fork: a chunk changes the session map, not every historical paragraph's offset.
    // Subscribe to the scalar offset so hidden chat messages do not all re-render while streaming.
    const fragmentOffset = Number(props.stageParaOffset) || 0;
    const localBase = (Number(props.stageParaBase) || 0) + fragmentOffset;
    const sourceRef = React.useRef({match,source,enter,localBase,fragmentOffset}); sourceRef.current = {match,source,enter,localBase,fragmentOffset};
    const base = useForkStageSelector(props.sessionId, state => {
        const {match,source,enter,localBase,fragmentOffset} = sourceRef.current;
        if (!enter) return localBase;
        let count = 0;
        for (const part of state.textIndex.get(Number(match[1]))?.parts || []) {
            if (part.index === Number(match[2]) && (!source || part.nodeId === source.nodeId)) return count + fragmentOffset;
            count += part.units.length;
        }
        return localBase;
    });
    // Reuse the entire element tree, not merely its props: no host Markdown/paragraph
    // collection runs behind the stage, and the existing DOM retains chat scroll geometry.
    if (!activeStage || props.voicePreview) transcript.current = h(ForkBubbleMarkdown, { props, markdownProps, has, enter, segments, base, config, voice, turn: match && Number(match[1]) });
    return transcript.current;
}
// Config is JSON data. Keep only this message's roster and rendering/voice settings;
// a renewal or an edit to a different character must not wake this publication.
function forkBubbleMessageSelector(segments) {
    const speakers = segments.filter(segment => segment.kind === "bubble");
    let signature, selected;
    return data => {
        const config = data && data.config;
        const next = data ? { cardPath: data.cardPath, config: config ? {
            enabled: config.enabled, voice: config.voice, moods: config.moods, emotions: config.emotions,
            stage: { textLanguage: config.stage && config.stage.textLanguage },
            characters: [...new Set(speakers.map(segment => forkBubbleCharacter(config,segment)).filter(Boolean))]
        } : null } : null;
        const key = JSON.stringify(next);
        if (key !== signature) { signature = key; selected = next; }
        return selected;
    };
}
function forkBubbleShallowEqual(a, b) {
    if (Object.is(a, b)) return true;
    return !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && Object.is(a[key], b[key]));
}
function forkBubblePublicationEqual(a, b) {
    return Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => {
        if (!Object.hasOwn(b, key)) return false;
        if (Object.is(a[key], b[key])) return true;
        if (key === "codeLabels") return forkBubbleShallowEqual(a[key], b[key]);
        if (key === "labels") return !!a.labels && !!b.labels && forkBubbleShallowEqual({ ...a.labels, code: null }, { ...b.labels, code: null }) && forkBubbleShallowEqual(a.labels && a.labels.code, b.labels && b.labels.code);
        if (key !== "stageSource" || !a.stageSource || !b.stageSource) return false;
        const x = a.stageSource, y = b.stageSource, turn = Number(String(a.voiceScope).split(":")[0]);
        return x.nodeId === y.nodeId && x.nativeTurn === y.nativeTurn && x.order === y.order &&
            Boolean(x.superseded || forkGalIsSuperseded(x.view, x.nativeTurn, turn)) === Boolean(y.superseded || forkGalIsSuperseded(y.view, y.nativeTurn, turn));
    });
}
let forkBubblePublicationMemo;
function forkBubblePublicationType() {
    // Keep the factory's non-React document builders usable without mounting chat.
    return forkBubblePublicationMemo || (forkBubblePublicationMemo = React.memo(ForkBubblePublication, forkBubblePublicationEqual));
}

function ForkBubbleMarkdown({ props, markdownProps, has, enter, segments, base, config, voice, turn }) {
    const h = React.createElement;
    if (!has && !enter) return h(TavernColoredMarkdown, markdownProps);
    const paragraphs = forkGalParagraphs([{ segments }], base);
    return h("div", { className: "fork-bubbles" }, segments.map(function (segment, index) {
        if (segment.kind === "markdown") {
            if (!enter) return h(TavernColoredMarkdown, Object.assign({}, markdownProps, { key: "m" + index, text: segment.text }));
            const units = paragraphs.filter(unit => unit.index === index);
            return h(ForkStageMarkdown, { key: "m" + index, sessionId: props.sessionId, turn, base: units.length ? units[0].para - 1 : base, text: segment.text,
                markdownProps: Object.assign({}, markdownProps, { text: segment.text }) });
        }
        const para = enter ? paragraphs.find(unit => unit.index === index).para : 0;
        const row = h(ForkBubbleRow, { sessionId: props.sessionId, segment: segment, config: config, voice: voice[index],
            enter: enter ? h(ForkStageEnterHere, { sessionId: props.sessionId, turn, para }) : null });
        return enter ? h(ForkStageParagraph, { key: "b" + index, sessionId: props.sessionId, turn, para }, row) : h(React.Fragment, { key: "b" + index }, row);
    }));
}

// ---------------------------------------------------------------------------
// Avatar import: single images, many images, or a .zip. File naming:
//   madoka.png            → default avatar of alias "madoka"
//   madoka@喜悦.png        → mood variant (label or id: joy/anger/sad/anxious/calm/shy/disgust/love)
//   madoka/默认.png, madoka/喜悦.png → same, one folder per alias
function forkPickFiles(options) {
    return new Promise(function (resolve) {
        const input = document.createElement("input");
        input.type = "file"; input.accept = options.accept; input.multiple = Boolean(options.multiple);
        input.addEventListener("change", function () { resolve(Array.from(input.files || [])); }, { once: true });
        forkForeground.picker(true);
        input.addEventListener("change", () => forkForeground.picker(false), { once: true });
        input.addEventListener("cancel", () => { forkForeground.picker(false); resolve([]); }, { once: true });
        input.click();
    });
}

// Worldbook changes (bubble format entry) only reach a running game after a card reload.
function ForkBubbleReloadLine(props) {
    const h = React.createElement;
    const live = useLiveTavernView(props.sessionId);
    const askConfirm = useTavernConfirm(props.sessionId);
    const [busy, setBusy] = React.useState(false);
    const [error, setError] = React.useState("");
    const view = live && live.view;
    const update = view && ["story", "script"].includes(view.mode || "story") && view.requestMode !== "sillytavern" ? view.cardUpdate : null;
    if (!update || update.error || !(update.available || update.worldbookSyncRequired || update.legacy)) return error ? h("p", { className: "fork-bubble-note is-error", role: "alert" }, error) : null;
    const blocked = busy || view.settleStatus === "running" || Boolean(view.activity && view.activity.busy) || Boolean(view.regenInProgress);
    async function reload() {
        if (blocked) return;
        if (!await askConfirm("从资源库重新加载人物卡和世界书，让新的气泡格式立即生效。\n剧情和数值保留；本局脚本对世界书的修改会被替换；下一轮会重建提示词缓存（多花一些 Token 和等待时间）。是否继续？" + (update.migrations && update.migrations.length ? "\n\n声明的变量迁移：\n" + update.migrations.join("\n") : ""))) return;
        setBusy(true); setError("");
        try { await rpc("applyUpdatedCard", { digest: update.digest }, props.sessionId); liveTavernView.invalidate(props.sessionId); }
        catch (err) { setError("重新加载失败：" + String(err && err.message || err)); }
        finally { setBusy(false); }
    }
    return h("div", { className: "fork-bubble-reload-line", role: "status" },
        h("span", null, update.worldbookChanged || update.worldbookSyncRequired ? "本局仍在用旧世界书，气泡格式改动尚未生效" : "本局仍在用旧版人物卡"),
        h("button", { type: "button", className: "dsh-tavern-btn fork-bubble-primary", disabled: blocked, title: blocked && !busy ? "等本轮生成 / 结算结束后再加载" : "保留剧情和数值，替换本局人物卡与世界书", onClick: reload }, busy ? "加载中…" : "立即生效"),
        error ? h("span", { className: "fork-bubble-note is-error", role: "alert" }, error) : null);
}

// Voice chip on a roster card; opens a small listbox of the voices the TTS service offers.
// Each voice shows the portrait of the roster character with the same alias when there is one.
// The same chip + menu serves the portrait (Live2D) library.
function ForkBubbleLibraryPicker(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const [color, setColor] = React.useState("");
    const [query, setQuery] = React.useState("");
    const [activeOption,setActiveOption]=React.useState(0);
    const root = React.useRef(null);
    const trigger = React.useRef(null);
    const menu = React.useRef(null);
    const listId = React.useId();
    const found = props.entries.find(entry => entry.id === props.value);
    const current = found && !found.retired ? found : null;
    // Keep an unknown or retired saved binding visible instead of silently showing “none”.
    const options = [{ id: "", label: props.noneLabel, note: props.noneNote }]
        .concat(props.entries.filter(entry => !entry.retired),
            props.value && !current ? [{ id: props.value, label: found ? found.label : props.value, note: found ? "已停用" : props.missingNote, missing: true }] : []);
    // The menu floats in <body> (ForkPopover), so "outside" means outside both the trigger and the menu.
    React.useEffect(function () {
        if (!open) return;
        function outside(event) { if (root.current && !root.current.contains(event.target) && !(menu.current && menu.current.contains(event.target))) setOpen(false); }
        document.addEventListener("pointerdown", outside, true);
        const node = !props.searchable && menu.current && menu.current.querySelector("[aria-selected='true']");
        if (node) node.focus({ preventScroll: true });
        return () => document.removeEventListener("pointerdown", outside, true);
    }, [open]);
    React.useEffect(()=>{if(props.searchable&&open)menu.current?.children[activeOption]?.scrollIntoView({block:'nearest'});},[open,activeOption,query]);
    function toggle() {
        // The floating menu keeps the character's colour (it no longer inherits it from the editor).
        if (!open && root.current && typeof getComputedStyle === "function") setColor(getComputedStyle(root.current).getPropertyValue("--bubble-color").trim());
        setQuery(""); setOpen(!open);
    }
    function choose(id) { setOpen(false); if (id !== props.value) props.onChange(id); if (trigger.current) trigger.current.focus(); }
    function onKey(event) {
        const items = menu.current ? Array.from(menu.current.querySelectorAll("[role='option']")) : [];
        const at = items.indexOf(document.activeElement);
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); choose(props.value); }
        else if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); const next = items[(at + (event.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]; if (next) next.focus(); }
        else if (event.key === "Tab") { event.preventDefault(); choose(props.value); } // back to the trigger, not <body>
    }
    if(props.searchable) {
        const filtered=options.filter(option=>!option.id||[option.id,option.label,option.group].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
        const at=Math.min(activeOption,filtered.length-1);
        return h('div',{className:'fork-voice-combobox',ref:root},
            h('input',{ref:trigger,role:'combobox','aria-label':props.ariaPrefix,'aria-autocomplete':'list','aria-expanded':open&&!props.disabled,'aria-controls':listId,'aria-activedescendant':open?listId+'-'+at:undefined,disabled:props.disabled,
                placeholder:props.disabled?'配音服务未开启':props.noneLabel,value:props.disabled?(props.value?props.value+'（配音服务未开启）':'配音服务未开启'):open?query:(current?.label||props.value||props.noneLabel),
                onFocus:()=>{setQuery('');setActiveOption(0);setOpen(true);},onChange:event=>{setQuery(event.target.value);setActiveOption(0);setOpen(true);},
                onKeyDown:event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();setOpen(true);setActiveOption((at+(event.key==='ArrowDown'?1:filtered.length-1))%filtered.length);}else if(event.key==='Enter'&&open){event.preventDefault();choose(filtered[at].id);}else if(event.key==='Escape'||event.key==='Tab')setOpen(false);}}),
            open&&!props.disabled?h('div',{id:listId,role:'listbox',className:'fork-voice-combobox-list',ref:menu},filtered.map((option,index)=>h('button',{type:'button',id:listId+'-'+index,key:option.id,role:'option','aria-selected':index===at,tabIndex:-1,onMouseDown:event=>event.preventDefault(),onClick:()=>choose(option.id)},option.label,option.group?' · '+option.group:'',option.id?' · '+option.id:''))):null);
    }
    function badge(option) {
        if (!option.id) return h("span", { className: "fork-voice-option-badge is-none" }, h(ForkIcon, { name: props.noneIcon, size: 15 }));
        const src = props.badgeImage ? props.badgeImage(option) : "";
        return h("span", { className: "fork-voice-option-badge" + (option.kind === "clone" ? " is-clone" : "") }, src ? h("img", { src: src, alt: "" }) : null);
    }
    return h("div", { className: "fork-voice-picker" + (open ? " is-open" : ""), ref: root, onKeyDown: open ? onKey : undefined },
        h("button", { ref: trigger, type: "button", className: "fork-bubble-voice-pick" + (props.value ? " is-bound" : "") + (props.value && !current ? " is-missing" : ""),
            "aria-label": props.ariaPrefix + "：" + (current ? current.label : props.value ? props.value + "（不可用）" : props.noneLabel), "aria-haspopup": "listbox", "aria-expanded": open, "aria-controls": open ? listId : undefined,
            title: current ? props.titlePrefix + "：" + current.label : props.pickTitle, onClick: toggle },
            h(ForkIcon, { name: props.value ? props.icon : props.noneIcon }), props.value ? h("span", null, current ? current.label : found ? found.label : props.value) : null, h(ForkIcon, { name: "chevron", size: 12 })),
        open ? h(ForkPopover, { anchor: trigger, popRef: menu, className: "fork-voice-menu", role: "listbox", id: listId, "aria-label": props.menuLabel, minWidth: 260, style: color ? { "--bubble-color": color } : undefined },
            h("div", { className: "fork-voice-menu-title", "aria-hidden": true }, h(ForkIcon, { name: "globe", size: 12 }), props.menuTitle),
            // Long lists (the portrait library has dozens of outfits): a filter box and a scrolling list with group headings.
            options.length > 8 ? h(ForkSearchBox, { bare: true, inputClassName: "fork-voice-menu-search", value: query, placeholder: "搜索…", label: "搜索", autoFocus: true, onChange: setQuery, onKeyDown: e => { if (e.key === "ArrowDown") { e.preventDefault(); const first = menu.current && menu.current.querySelector("[role='option']"); if (first) first.focus(); } } }) : null,
            h("div", { className: "fork-voice-menu-list" }, options.filter(option => !query.trim() || !option.id || String(option.label).includes(query.trim()) || String(option.group || "").includes(query.trim())).map(function (option, index, list) {
                const heading = option.group && (index === 0 || list[index - 1].group !== option.group) ? h("div", { key: "g:" + option.group, className: "fork-voice-menu-group", "aria-hidden": true }, option.group) : null;
                return [heading, h("button", { key: option.id || "none", type: "button", role: "option", "aria-selected": option.id === props.value, className: "fork-voice-option" + (option.missing ? " is-missing" : ""),
                onClick: () => choose(option.id) },
                badge(option),
                h("span", { className: "fork-voice-option-text" }, h("b", null, option.group ? option.short || option.label : option.label), option.note ? h("small", null, option.note) : null),
                option.id === props.value ? h(ForkIcon, { name: "check", size: 15 }) : null)];
            })),
            h("button", { type: "button", className: "fork-voice-menu-foot", onClick: function () {
                setOpen(false);
                // Inside the Characters modal the foot opens the 素材库 at this kind; elsewhere it scrolls to the library.
                if (props.onFoot) { props.onFoot(); return; }
                const library = typeof document !== "undefined" && document.querySelector(props.footTarget);
                if (library) library.scrollIntoView({ block: "start", behavior: "smooth" });
            } }, props.footLabel)) : null);
}

// Portrait chip: which Live2D model the galgame stage uses for this character.
function ForkBubblePortraitPicker(props) {
    return React.createElement(ForkBubbleLibraryPicker, {
        value: props.value, onChange: props.onChange, onFoot: props.onFoot, icon: "figure", noneIcon: "figure-off",
        // Grouped by character; this character's own outfits first.
        entries: (props.models || []).map(model => ({ id: model.id, label: model.label, group: forkModelOwner(model.label), short: forkOutfitName(model.label), note: model.kind === "static" ? "静态立绘" : "Live2D", retired: model.retired, kind: model.kind, thumb: forkPortraitThumb(model) }))
            .sort((a, b) => (b.group === props.owner) - (a.group === props.owner)),
        noneLabel: "无立绘", noneNote: "舞台上用头像", missingNote: "模型不在立绘库",
        ariaPrefix: "角色立绘绑定", titlePrefix: "立绘", pickTitle: "选择立绘", menuLabel: "立绘模型", menuTitle: "来自本卡「角色立绘」",
        footTarget: ".fork-portrait-library", footLabel: props.footLabel || "打开角色立绘 / 调整表情",
        badgeImage: option => option.thumb || "",
    });
}
// Outfits: the default portrait plus extra outfits; the stage director picks one per scene.
// A model label like 「鹿目圆（魔法少女）」 gives the outfit name 「魔法少女」.
function forkOutfitName(label) { const match = /[（(]([^）)]+)[）)]\s*$/.exec(String(label || "")); return (match ? match[1] : String(label || "")).slice(0, 12); }
function forkPortraitOwner(item, models) { const bound = (models || []).find(model => model.id === item.portrait); return bound ? forkModelOwner(bound.label) : item.name; }
function forkPortraitThumb(model) { return model ? (model.kind === "static" ? (model.images && model.images.default) || "" : model.thumb || "") : ""; }
function forkModelOwner(label) { return String(label || "").replace(/[（(][^）)]*[）)]\s*$/, "").trim(); }
function ForkBubbleOutfits(props) {
    const h = React.createElement;
    const item = props.item, models = props.models || [];
    const base = models.find(model => model.id === item.portrait);
    if (!base) return null;
    const owner = forkModelOwner(base.label);
    const outfits = item.outfits || [];
    const used = new Set([item.portrait].concat(outfits.map(outfit => outfit.model)));
    const same = models.filter(model => !used.has(model.id) && !model.retired && forkModelOwner(model.label) === owner);
    const others = models.filter(model => !used.has(model.id) && !model.retired && forkModelOwner(model.label) !== owner);
    const defaultLabel = item.outfitLabel || forkOutfitName(base.label) || "默认";
    function add(id) {
        const model = models.find(entry => entry.id === id);
        if (!model) return;
        let label = forkOutfitName(model.label) || model.label, n = 2;
        while (label === defaultLabel || outfits.some(outfit => outfit.label === label)) label = forkOutfitName(model.label) + n++;
        props.onChange({ outfitLabel: defaultLabel, outfits: outfits.concat([{ label, model: id }]) });
    }
    return h("div", { className: "fork-outfits", "aria-label": "服装" },
        h("span", { className: "fork-outfits-title", title: "舞台上按剧情换衣服：自动换景开启时，由后台判断每一段穿哪套" }, h(ForkIcon, { name: "figure", size: 13 }), "服装"),
        h("span", { className: "fork-outfit is-default", title: base.label + "（默认）" }, defaultLabel, h("small", null, "默认")),
        outfits.map((outfit, index) => h("span", { key: outfit.label, className: "fork-outfit", title: (models.find(model => model.id === outfit.model) || {}).label || outfit.model },
            outfit.label,
            h("button", { type: "button", "aria-label": "移除服装 " + outfit.label, onClick: () => props.onChange({ outfits: outfits.filter((_, i) => i !== index) }) }, "×"))),
        same.length || others.length ? h("label", { className: "fork-outfit-add", title: "添加一套服装" },
            h(ForkIcon, { name: "plus", size: 12 }),
            h("select", { value: "", "aria-label": "添加服装", onChange: e => add(e.target.value) },
                h("option", { value: "" }, "添加服装"),
                same.length ? h("optgroup", { label: owner }, same.map(model => h("option", { key: model.id, value: model.id }, forkOutfitName(model.label)))) : null,
                others.length ? h("optgroup", { label: "其他模型" }, others.map(model => h("option", { key: model.id, value: model.id }, model.label))) : null)) : null);
}

// private fork: refresh only native-owned projections, preserving unfinished character edits.
function forkBubbleRefreshAssets(draft, config, append) {
    if (!draft || !config) return draft;
    const matched = new Set();
    const characters = draft.characters.map(item => {
        const source = forkBubbleCharacter(config, item);
        if (!source) return item;
        matched.add(source.alias);
        return { ...item, avatarMedia: source.avatarMedia, assetAlias: source.assetAlias || source.alias };
    });
    if (append) characters.push(...config.characters.filter(item => !matched.has(item.alias)));
    return { ...draft, characters };
}

// private fork: dialogue options share the native Engine CAS owner, not card files.
// private fork (owner 2026-10 r3): 舞台设置 › 提示词 edits the global 对白格式 (engine dialogue.injection) in place; the
// card owns its bubble switch and emotions, and the 正文语言 (dialogue.textLanguage) keeps its stored value without a
// control. One serial writer per session: each save reads the newest engine revision, replaces only `injection`, then
// republishes the shared dialogue store (every open view of the card follows).
const forkDialogueInjectionWrites = new Map();
function forkSaveDialogueInjection(sessionId, change) {
    const run = (forkDialogueInjectionWrites.get(sessionId) || Promise.resolve()).catch(() => {}).then(async () => {
        const current = await rpc('getAssetEngineSettings', {}, sessionId), dialogue = current.values.dialogue;
        await rpc('saveAssetEngineSettings', { expectedRevision: current.revision, patch: { dialogue: { ...dialogue, injection: change(dialogue.injection) } } }, sessionId);
        const data = await rpc('getDialogueBubbles', {}, sessionId);
        forkBubbleStore.set(sessionId, data);
        return data;
    });
    forkDialogueInjectionWrites.set(sessionId, run);
    return run;
}
// 恢复默认: the host's default template and no extra request; the worldbook placement stays where the user put it.
function forkResetDialogueInjection(sessionId) { return forkSaveDialogueInjection(sessionId, injection => ({ ...injection, template: '', extra: '' })); }
// The 对白格式 editor (ForkBubblePromptEditor) over the session's dialogue data. Its 「角色 ↗」 shows the page's 素材包 (private fork, stage setup wizard: the 人物 section is gone).
function ForkStageDialogueEditor({ sessionId, onClose }) {
    const data = useForkBubbles(sessionId, true), askConfirm = useTavernConfirm(sessionId);
    if (!data) return null;
    const ctx = { sessionId, data, draft: data.config, askConfirm,
        save: next => forkSaveDialogueInjection(sessionId, () => next.injection).catch(error => { try { tavernErrorHub.report('保存对白格式', error); } catch (_) { console.warn('保存对白格式', error); } }),
        openModal: () => { if (typeof document !== 'undefined') document.querySelector('.ap-stage .ap-pack-section')?.scrollIntoView({ block: 'center' }); } };
    return React.createElement(ForkBubblePromptEditor, { ctx, onClose });
}
