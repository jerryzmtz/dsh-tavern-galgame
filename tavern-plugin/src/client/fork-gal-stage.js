// Private fork (docs/fork/galgame-stage.md): galgame stage view.
// A presentation of the same reply the chat view shows: it never writes story, variables
// or prompts. The session runtime owns text, observation and accepted presentation.
// The chat view can stay frozen or unmounted; backlog reads the same session index.

// @include fork-widget-source.js
// @include fork-stage-offstage.cjs
// @include-protocol fork-stage-pacing.cjs
// @include-protocol fork-stage-soundscape.cjs
// @include fork-stage-soundscape-player.cjs
// @include fork-gal-history.js
// @include fork-gal-menu.js
// @include fork-item-performance.js
// @include fork-mod-performance.js
// @include fork-textcard-stage.js
// @include fork-gal-entry.js

// private fork: forkGalIsSuperseded(...) reads the host projection; never changes its visibility or history.
function forkGalIsSuperseded(view, nativeTurn, storyTurn) {
    const mappings = view && view.regeneratedDshTurns || {};
    const replacement = Number(mappings[storyTurn]);
    if (replacement > 0) return Number(nativeTurn) !== replacement;
    // Replacement native turns are also suppressed by the host, but remain our authoritative source.
    if (Object.values(mappings).some(turn => Number(turn) === Number(nativeTurn))) return false;
    return (view && view.suppressedDshTurns || []).some(turn => Number(turn) === Number(nativeTurn));
}

// Plain reading text for the text box: markdown decorations off, line breaks kept.
function forkGalPlain(text) { return stagePagePlain(text); }
// Narration: one page per paragraph; a long paragraph splits at sentence ends.
// Paragraph blocks, counted exactly like the host director (lib/domain/stage-director.js
// stageParagraphs): blank lines split; HTML blocks, rules and empty blocks do not count.
function forkGalBlocks(text) {
    return String(text || "").split(/\n\s*\n/).filter(block => block.trim() && !/^\s*</.test(block) && !/^\s*[-*_]{3,}\s*$/.test(block));
}
function forkGalNarrationPages(text) {
    const pages = [];
    forkGalBlocks(text).forEach(function (block) { forkGalBlockPages(block).forEach(page => pages.push(page)); });
    return pages;
}
function forkGalBlockPages(block) { return stageBlockPages(block); }
// One source index for chat entries, stage pages and history rows. Pagination never adds paragraphs.
function forkGalParagraphs(parts, base = 0) {
    const units = [];
    let para = base;
    parts.forEach(function (part, partIndex) {
        (part.segments || []).forEach(function (segment, index) {
            const lastSegment = partIndex === parts.length - 1 && index === part.segments.length - 1;
            if (segment.kind === "markdown") {
                const blocks = forkGalBlocks(segment.text);
                blocks.forEach((block, b) => units.push({ kind: "narration", block, text: forkGalPlain(block), para: ++para, index,
                    pending: Boolean(lastSegment && part.streaming && b === blocks.length - 1) }));
            } else {
                units.push({ kind: "line", para: ++para, index, alias: segment.alias, name: segment.name, mood: segment.mood,
                    text: segment.thought ? "（" + segment.text + (segment.streaming ? "" : "）") : segment.text,
                    thought: segment.thought, pending: Boolean(segment.streaming), voice: part.voices && part.voices[index] || null });
            }
        });
    });
    return units;
}
// Each page carries its source paragraph number (para, from 1) for the director's cues.
function forkGalPages(parts) {
    return forkGalParagraphs(parts).flatMap(function (unit) {
        const { block, index, ...page } = unit;
        if (unit.kind !== "narration") return [page];
        const texts = stagePageCards(unit).map(card => card.text);
        return texts.map((text, n) => ({ ...page, text, pending: page.pending && n === texts.length - 1 }));
    });
}
// Film cards are display-only: offsets count source characters, never director paragraphs.
// An oversized bracketed passage is closed/reopened on each card; a pair that fits is kept whole.
function forkGalSubtitleCards(text, fits) {
    const chars = Array.from(String(text || ""));
    const pairs = { "「": "」", "『": "』", "（": "）", "(": ")", "【": "】", "[": "]", "“": "”", "‘": "’" };
    const stack = [], matched = new Map();
    chars.forEach(function (char, i) {
        if (pairs[char]) stack.push(i);
        else if (stack.length && pairs[chars[stack[stack.length - 1]]] === char) { const open = stack.pop(); matched.set(open, i); }
    });
    const active = [], edges = [[]];
    chars.forEach(function (char, i) {
        if (matched.has(i)) active.push(i);
        else if (active.length && matched.get(active[active.length - 1]) === i) active.pop();
        edges.push(active.slice());
    });
    const cardText = (start, end) => edges[start].map(i => chars[i]).join("") + chars.slice(start, end).join("") + edges[end].slice().reverse().map(i => pairs[chars[i]]).join("");
    const rank = end => /[。！？!?…」』）)】\]”’]/.test(chars[end - 1]) ? 3 : /[，；：、,;:\s]/.test(chars[end - 1]) ? 2 : 1;
    const cards = [];
    for (let start = 0; start < chars.length;) {
        let low = start + 1, high = chars.length, max = start;
        while (low <= high) {
            const mid = Math.floor((low + high) / 2);
            if (fits(cardText(start, mid))) { max = mid; low = mid + 1; } else high = mid - 1;
        }
        // Even a single glyph must make progress at pathological viewport widths.
        max = Math.max(start + 1, max);
        let end = max;
        if (max < chars.length) {
            const safe = [];
            for (let i = start + 1; i <= max; i++) if (!edges[i].length) safe.push(i);
            const candidates = safe.length ? safe : Array.from({ length: max - start }, (_, i) => start + i + 1);
            end = candidates.reduce((best, i) => rank(i) >= rank(best) ? i : best, candidates[0]);
        }
        cards.push({ text: cardText(start, end), start, end });
        start = end;
    }
    return cards.length ? cards : [{ text: "", start: 0, end: 0 }];
}
function forkGalSubtitleStep(page, card, delta, counts) {
    if (delta > 0 && card + 1 < counts[page]) return { page, card: card + 1 };
    if (delta < 0 && card > 0) return { page, card: card - 1 };
    const next = Math.max(0, Math.min(counts.length - 1, page + delta));
    return { page: next, card: next === page ? card : delta < 0 ? counts[next] - 1 : 0 };
}
function forkGalSubtitleVoiceTime(cards, card, duration) {
    const total = cards.reduce((sum, item) => sum + item.end - item.start, 0);
    return total > 0 && Number.isFinite(duration) && duration > 0 ? duration * cards.slice(0, card + 1).reduce((sum, item) => sum + item.end - item.start, 0) / total : null;
}
// Display only (classic text box): a spoken line reads 「…」. Text that already opens with a bracket
// (a thought's （…）, a quote the model wrote itself) is left alone; the closing bracket waits until
// the line has finished streaming.
function forkGalQuoted(text, pending) {
    const value = String(text || "").replace(/^\s+/, "");
    if (!value || /^[「『（(【〈《“"‘'［\[]/.test(value)) return value;
    return "「" + value + (pending || /」$/.test(value) ? "" : "」");
}
// Speakers up to the page, most recent last; the stage keeps at most three.
function forkGalCast(pages, at, offstage = new Set()) {
    const order = [];
    for (let i = 0; i <= at && i < pages.length; i++) {
        const page = pages[i];
        if (page.kind !== "line" || offstage.has(page.alias)) continue;
        const found = order.findIndex(item => item.alias === page.alias);
        if (found >= 0) order[found] = { alias: page.alias, name: page.name, mood: page.mood, last: i };
        else order.push({ alias: page.alias, name: page.name, mood: page.mood, last: i });
    }
    const kept = order.slice().sort((a, b) => b.last - a.last).slice(0, 3);
    // Stable left-to-right order: first appearance.
    return order.filter(item => kept.includes(item));
}

// Director cues (host: lib/domain/stage-director.js) for the page's paragraph: the latest
// scene with a picture and the latest cast at or before it.
// private fork: running responses may carry an in-memory validated prefix.
function forkGalHasDirection(direction) {
    return Boolean(direction && (direction.status === "done" || direction.status === "running" && (direction.protocol === "incremental-v1" ? direction.through >= 1 : direction.entries && direction.entries.length)));
}
function forkGalDirectionCovers(direction, para) {
    return forkGalHasDirection(direction) && (direction.status === "done" || para <= (direction.protocol === "incremental-v1" ? direction.through : direction.entries[direction.entries.length - 1].at));
}
function forkGalCarriedDirection(direction, carried, pages, at, offstage = new Set(), looks) {
    const start = { ...(direction && direction.start || carried || {}), moods: direction && direction.start && direction.start.moods || carried && carried.moods || {} };
    if (start.protocol === "incremental-v1" && !direction?.protocol) direction = { ...direction, protocol: start.protocol };
    if (direction && direction.entries && direction.protocol !== "incremental-v1") direction = { ...direction, entries: forkStagePacing(start, direction.entries, looks, direction.units).entries };
    const para = pages[at] && pages[at].para || 1;
    const entries = forkGalHasDirection(direction) ? (direction.entries || []).filter(entry => entry.at <= para) : [];
    if (forkGalDirectionCovers(direction, para)) return { ...direction, start };
    let cast = (start.cast || []).filter(id => !offstage.has(id));
    entries.forEach(entry => { if (entry.cast) cast = entry.cast.filter(id => !offstage.has(id)); });
    const since = entries.length ? entries[entries.length - 1].at : 0;
    const recent = cast.slice(), order = cast.slice();
    pages.slice(0, at + 1).forEach(function (page) {
        if (page.para <= since || page.kind !== "line" || offstage.has(page.alias)) return;
        const index = recent.indexOf(page.alias);
        if (index >= 0) recent.splice(index, 1);
        recent.push(page.alias);
        if (!order.includes(page.alias)) order.push(page.alias);
    });
    const kept = recent.slice(-3), next = order.filter(id => kept.includes(id));
    if (next.join("\n") !== cast.join("\n")) entries.push({ at: para, cast: next });
    return { ...direction, status: "done", start, entries };
}
function forkGalEndState(direction, carried, pages, offstage, looks, figureCatalog, config) {
    const at = pages.length - 1, para = pages[at] && pages[at].para || 1;
    const effective = forkGalCarriedDirection(direction, carried, pages, at, offstage, looks);
    const cue = forkGalCue(effective, para, offstage), staging = forkGalStaging(effective, para, offstage, undefined, looks);
    const cast = staging.order, focus = {}, look = {}, moods = {};
    staging.members.forEach(function (member) {
        if (!member.visible) return;
        if (member.focus !== "normal" && member.focus !== "close") focus[member.id] = member.focus;
        if (member.look) look[member.id] = member.look;
        moods[member.id] = forkGalMoodOf(pages, at, member.id, config) || effective.start.moods[member.id] || "";
    });
    if (direction?.protocol === "incremental-v1" && direction.end) return { ...direction.end, moods,
        ...(figureCatalog && (Object.keys(figureCatalog).length || effective.start.figureScale) ? { figureScale: forkFigureCarry(forkFigureDirection(effective.start, direction.entries, figureCatalog, para)) } : {}) };
    return { scene: cue.scenes[cue.scenes.length - 1] || "", cast, order: cast.slice(), outfits: cue.outfits, music: cue.music,
        focus, look, moods, light: staging.light, lighting: staging.lighting, weather: staging.weather, camera: staging.camera,
        dof: staging.dof, figureLight: staging.figureLight,
        pacing: forkStagePacing(effective.start, effective.entries, looks, para).pacing,
        // private fork: deterministic across turn boundaries, including player-input pages.
        ...(figureCatalog && (Object.keys(figureCatalog).length || effective.start.figureScale) ? { figureScale: forkFigureCarry(forkFigureDirection(effective.start, direction?.figureToken ? direction.entries : effective.entries, figureCatalog, para)) } : {}) };
}
function forkGalTurnState(previous, sessionId, turn) {
    if (previous && previous.sessionId === sessionId && previous.turn === turn) return previous;
    return { sessionId, turn, start: previous && previous.sessionId === sessionId && turn === previous.turn + 1 ? previous.end : null, end: null };
}
// Hash text only: voice readiness and other render metadata must not invalidate a bookmark.
function forkGalTextDigest(parts) {
    const text = parts.map(part => typeof part.text === "string" ? part.text : (part.segments || []).map(segment => segment.text || "").join("\n")).join("\n");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    return (hash >>> 0).toString(16).padStart(8, "0");
}
// Offsets ignore pagination whitespace (page splitting trims its edges).
function forkGalPositionAnchors(pages) {
    const offsets = new Map();
    return pages.map(function (page) {
        if (page.anchor) return { para: page.anchor.para, offset: page.anchor.offset, length: String(page.text || "").length };
        const offset = offsets.get(page.para) || 0;
        const length = String(page.text || "").replace(/\s/g, "").length;
        offsets.set(page.para, offset + length);
        return { para: page.para, offset, length };
    });
}
function forkGalRestorePosition(saved, turn, pageCount, textDigest, pages = []) {
    const valid = saved && saved.turn === turn && saved.textDigest === textDigest && Number.isInteger(saved.page);
    let page = valid ? Math.max(0, Math.min(saved.page, Math.max(0, pageCount - 1))) : 0;
    const anchors = forkGalPositionAnchors(pages), anchor = valid && saved.anchor;
    const anchored = anchor && Number.isInteger(anchor.para) && Number.isInteger(anchor.offset) && anchor.offset >= 0
        ? anchors.findIndex(item => item.para === anchor.para && item.offset <= anchor.offset && anchor.offset < item.offset + item.length) : -1;
    if (anchored >= 0) page = anchored;
    const target = anchored >= 0 ? anchor : anchors[page];
    return { turn, page, pageCount, textDigest, ...(Number.isInteger(saved && saved.latestSeenTurn) ? { latestSeenTurn: saved.latestSeenTurn } : {}), ...(target ? { anchor: { para: target.para, offset: target.offset } } : {}) };
}
// private fork: a cold runtime can publish an empty/unloaded row or a temporary
// text prefix. None of those is permission to consume a durable reading bookmark.
// private fork: callers that also restore pass `digestOf` so the turn text is hashed at most once.
function forkGalPositionReady(saved, turn, parts, pages, digestOf = () => forkGalTextDigest(parts)) {
    if (!turn || !parts.length || !pages.length || parts.some(part => part.streaming || part.unloaded) || pages.some(page => page.pending)) return false;
    if (!saved || saved.turn !== turn) return true;
    if (saved.textDigest !== digestOf()) return false;
    if (saved.anchor) return forkGalPositionAnchors(pages).some(item => item.para === saved.anchor.para && item.offset <= saved.anchor.offset && saved.anchor.offset < item.offset + item.length);
    return pages.length >= (saved.pageCount || saved.page + 1);
}
function forkGalReadThrough(previous, current) {
    const valid = value => value && Number.isInteger(value.turn) && value.turn > 0 && Number.isInteger(value.page) && value.page >= 0 && typeof value.textDigest === 'string';
    if (!valid(current)) return valid(previous) ? previous : null;
    if (!valid(previous) || previous.turn === current.turn && previous.textDigest !== current.textDigest) return { ...current };
    return current.turn > previous.turn || current.turn === previous.turn && current.page > previous.page ? { ...current } : previous;
}
function forkGalPageRead(readThrough, next) {
    return Boolean(readThrough && next && (next.turn < readThrough.turn || next.turn === readThrough.turn && next.textDigest === readThrough.textDigest && next.page <= readThrough.page));
}
// Consume wheel notches, never queue a burst for later. A gesture is quiet for 300ms;
// any action on unread text locks the rest of that gesture, even if typing completes.
function forkGalWheelDecision(previous, event) {
    const now = event.now, dy = Number(event.deltaY);
    if (!Number.isFinite(dy) || !dy) return { state: previous, action: 'none' };
    const direction = Math.sign(dy);
    const fresh = !previous || previous.direction !== direction || now - previous.lastEvent >= 300 || now < previous.lastEvent;
    const state = fresh ? { direction, lastEvent: now, lastAdvance: previous?.lastAdvance ?? -Infinity, delta: 0, unreadUsed: false } : { ...previous, lastEvent: now };
    const pixels = Math.abs(dy) * (event.deltaMode === 1 ? 100 / 3 : event.deltaMode === 2 ? 100 : 1);
    state.delta += pixels;
    if (state.delta < 100) return { state, action: 'none' };
    state.delta %= 100;
    // private fork: upward wheel opens the log; keys and the Back control still page back.
    if (direction < 0) return { state, action: 'backlog' };
    if (state.unreadUsed) return { state, action: 'none' };
    const read = forkGalPageRead(event.readThrough, event.next) && !event.hidden;
    if (read) {
        if (now - state.lastAdvance < 200) return { state, action: 'none' };
        state.lastAdvance = now;
        return { state, action: 'advance-read' };
    }
    state.unreadUsed = true;
    state.lastAdvance = now;
    return { state, action: event.typed && !event.hidden ? 'advance' : 'finish' };
}
function forkGalPositionWriter(sessionId, storage, schedule, cancel) {
    const key = "fork-stage-position:" + sessionId;
    let saved = null, pending = null, timer = null;
    try { saved = JSON.parse(storage && storage.getItem(key) || "null"); } catch (_) {}
    function flush() {
        if (timer !== null) cancel(timer);
        timer = null;
        if (!pending) return;
        try { if (storage && sessionId) storage.setItem(key, JSON.stringify(pending)); } catch (_) {}
        pending = null;
    }
    function discard() { if (timer !== null) cancel(timer); timer = null; pending = null; }
    let readThrough = forkGalReadThrough(saved && saved.readThrough, null);
    return { saved, flush, discard, get readThrough() { return readThrough; },
        markRead(value) { readThrough = forkGalReadThrough(readThrough, value); },
        write(value) { pending = { ...value, ...(readThrough ? { readThrough } : {}) }; if (timer === null) timer = schedule(flush, 250); } };
}
function forkGalSubtitleCache(limit) {
    const entries = new Map();
    return {
        clear() { entries.clear(); },
        get(text, width, font, size, measure) {
            const key = JSON.stringify([text, width, font, size]);
            if (entries.has(key)) { const value = entries.get(key); entries.delete(key); entries.set(key, value); return value; }
            const value = measure();
            entries.set(key, value);
            while (entries.size > limit) entries.delete(entries.keys().next().value);
            return value;
        }
    };
}
// Display cards fit the actual text box without changing canonical/director page indices.
function useForkGalSubtitles(film, pages, page, identity, theme) {
    const [element, setElement] = React.useState(null);
    const textRef = React.useCallback(node => setElement(node), []);
    const [layout, setLayout] = React.useState(null);
    const [position, setPosition] = React.useState(null);
    const cache = React.useMemo(() => forkGalSubtitleCache(256), []);
    const measureNode = React.useRef(null);
    const texts = JSON.stringify(pages.map(item => item.text));
    const key = identity + ":" + page;
    const measured = layout && layout.texts === texts && layout.theme === theme && layout.film === film;
    // private fork (reading controls perf, 2026-10): only the current page and its neighbours are measured (navigation needs
    // their card counts). Measuring every page of the turn on each width change (the face gutter toggles it between
    // faced and unfaced pages) thrashed the cache and cost a 0.5–1 s long task per toggle in reading and fast-forward.
    const pageRef = React.useRef(page);
    pageRef.current = page;
    const measureNow = React.useRef(null);
    const all = pages.map((item, index) => measured && layout.cards[index] || [{ text: item.text, start: 0, end: Array.from(item.text).length }]);
    const cards = all[page] || [{ text: "", start: 0, end: 0 }];
    const sameText = position && pages[page] && (pages[page].text === position.text || position.pending && pages[page].text.startsWith(position.text));
    const offset = position && position.key === key && sameText ? position.offset : 0;
    const card = Math.max(0, cards.findIndex(item => item.end > offset || item === cards[cards.length - 1]));
    React.useLayoutEffect(function () {
        if (!element) return;
        let scheduled = 0;
        const clone = measureNode.current || (measureNode.current = element.cloneNode(false));
        clone.removeAttribute("id"); clone.removeAttribute("aria-live"); clone.setAttribute("aria-hidden", "true");
        clone.className = element.className;
        Object.assign(clone.style, { position: "fixed", left: "-100000px", top: "0", height: "auto", maxHeight: "none", minHeight: "0", boxSizing: "border-box", visibility: "hidden", overflow: "visible", pointerEvents: "none" });
        function measure() {
            if (scheduled) return;
            scheduled = forkForeground.requestAnimationFrame(function () { scheduled = 0; run(); });
        }
        function run() {
            const width = element.clientWidth || element.getBoundingClientRect().width;
            if (!width) return;
            clone.style.width = width + "px";
            element.parentNode.appendChild(clone);
            try {
                const style = getComputedStyle(clone), lineHeight = parseFloat(style.lineHeight);
                // Without the stage stylesheet there is no fixed-height box to paginate.
                if (!Number.isFinite(lineHeight) || lineHeight <= 0) return;
                const font = [style.fontFamily, style.fontWeight, style.fontStyle, style.fontStretch, style.letterSpacing, style.lineHeight, style.wordBreak, style.overflowWrap, style.whiteSpace, style.padding, style.boxSizing].join("|");
                const lines = film ? 2 : 3, near = index => Math.abs(index - pageRef.current) <= 1;
                const next = { texts, theme, film, cards: pages.map((item, index) => !near(index) ? null : cache.get(item.text, width, font + ':' + lines + ':' + item.kind, style.fontSize, () => forkGalSubtitleCards(item.text, text => {
                    // The real inline typewriter/cursor also occupies the line after a trailing newline.
                    clone.textContent = (!film && (theme || 'classic') === 'classic' && item.kind === 'line' ? forkGalQuoted(text, false) : text) + (/[\r\n]$/.test(text) ? "\u200b" : "");
                    return clone.getBoundingClientRect().height <= lineHeight * lines + 0.5;
                }))) };
                setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
            } finally { clone.remove(); }
        }
        measureNow.current = run;
        measure();
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
        if (observer) observer.observe(element);
        window.addEventListener("resize", measure);
        let disposed = false;
        const unsubscribe = typeof forkFonts !== "undefined" ? forkFonts.subscribe(() => Promise.resolve().then(() => { if (!disposed) measure(); })) : null;
        const fonts = typeof document !== "undefined" && document.fonts;
        function fontLoaded() { cache.clear(); measure(); }
        if (fonts) fonts.addEventListener("loadingdone", fontLoaded);
        return () => { disposed = true; measureNow.current = null; forkForeground.cancelAnimationFrame(scheduled); clone.remove(); if (observer) observer.disconnect(); window.removeEventListener("resize", measure); if (unsubscribe) unsubscribe(); if (fonts) fonts.removeEventListener("loadingdone", fontLoaded); };
    }, [film, texts, theme, element]);
    // A page turn measures its new neighbourhood before paint (cached pages cost no text layout).
    React.useLayoutEffect(function () { if (measureNow.current) measureNow.current(); }, [page]);
    function select(nextPage, nextCard) {
        const target = all[nextPage] && all[nextPage][nextCard];
        const source = pages[nextPage];
        setPosition({ key: identity + ":" + nextPage, text: source && source.text, pending: source && source.pending, offset: target ? target.start : 0 });
    }
    return { textRef, cards, card, text: cards[card].text, counts: all.map(items => items.length), select };
}
function forkGalNewEffects(memory, key, effects) {
    if (memory.key !== key) { memory.key = key; memory.played = new Set(); }
    const counts = new Map();
    return effects.filter(function (effect) {
        const value = JSON.stringify(effect), index = counts.get(value) || 0;
        counts.set(value, index + 1);
        const id = value + ":" + index;
        if (memory.played.has(id)) return false;
        memory.played.add(id);
        return true;
    });
}
// Missing appearance media is a display fallback only. Keep the requested outfit
// in the canonical cue so restoring the asset restores the same appearance.
function forkGalPortraitOf(alias, characters, models, outfits, protocol) {
    const character = characters.find(item => item.alias === alias) || null;
    const outfit = character && outfits[alias] ? (character.outfits || []).find(item => item.label === outfits[alias]) : null;
    const modelId = outfit ? outfit.model : character && character.portrait;
    let model = modelId ? models.find(item => item.id === modelId && !item.retired) || null : null;
    if (!model && protocol === "incremental-v1" && character && outfit) model = models.find(item => item.id === character.portrait && !item.retired) || null;
    return { character, model };
}
function forkGalCue(direction, para, offstage = new Set()) {
    const cue = { scenes: [], cast: null, outfits: {}, music: "" };
    if (!forkGalHasDirection(direction)) return cue;
    if (direction.protocol === "incremental-v1") cue.sceneCleared = Boolean(direction.start && direction.start.sceneCleared);
    if (direction.start && direction.start.scene) cue.scenes.push(direction.start.scene);
    if (direction.start && direction.start.cast) cue.cast = direction.start.cast;
    Object.assign(cue.outfits, direction.start && direction.start.outfits || {});
    if (direction.start && direction.start.music) cue.music = direction.start.music;
    if (direction.start && direction.start.assetRefs) { cue.sceneRef = direction.start.assetRefs.scene; cue.musicRef = direction.start.assetRefs.music; }
    (direction.entries || []).forEach(function (entry) {
        if (entry.at > para) return;
        if (direction.protocol === "incremental-v1" && Object.prototype.hasOwnProperty.call(entry, "scene")) { cue.scenes = entry.scene ? [entry.scene] : []; cue.sceneCleared = !entry.scene; cue.sceneRef = entry.assetRefs && entry.assetRefs.scene; }
        else if (entry.scene) { cue.scenes.push(entry.scene); cue.sceneRef = entry.assetRefs && entry.assetRefs.scene; }
        if (entry.cast) cue.cast = entry.cast;
        Object.assign(cue.outfits, entry.outfits || {});
        if (Object.prototype.hasOwnProperty.call(entry, "music")) { cue.music = entry.music === "none" ? "" : entry.music; cue.musicRef = entry.assetRefs && entry.assetRefs.music; }
    });
    if (cue.cast) cue.cast = cue.cast.filter(id => !offstage.has(id));
    Object.keys(cue.outfits).forEach(function (id) { if (offstage.has(id)) delete cue.outfits[id]; });
    if (!forkGalDirectionCovers(direction, para)) cue.cast = null;
    return cue;
}
// Staging DSL (host: stage-director.js parseDirection / stagingState). State-like commands (focus,
// look, zoom, cast) are recomputed from the turn's start up to the paragraph, so paging back
// restores them; one-shot commands (act, shake, flash, fade) and entrances/exits belong to the
// paragraph itself. Layout keeps a stable left-to-right order (forkGalOrder): nobody changes sides
// while on stage; arrivals join on the side they come from. Close-ups last for their paragraph and
// the next two. Offstage actors are never staged. stageable(id), when given, says who has a
// figure to stand on stage (avatar-only characters only show in the face window): slots are laid out
// among them and the rest get x: undefined. Members: { id, x, focus, look, visible, enter, exit };
// exiting members come last with visible: false.
const FORK_GAL_FOCUS = { close: 1.45, normal: 1 };
// Must match the host (stage-director.js stageOrder).
function forkGalOrder(order, cast, sides) {
    const kept = (order || []).filter(alias => cast.includes(alias));
    const pending = new Set();
    function insert(alias) {
        if (kept.includes(alias)) return;
        // private fork: resolve newly declared after targets before their dependents.
        if (pending.has(alias)) { kept.push(alias); return; }
        pending.add(alias);
        const side = sides && sides[alias] || "";
        const after = side.startsWith("after:") ? side.slice(6) : "";
        if (after && after !== alias && cast.includes(after) && !kept.includes(after)) insert(after);
        if (!kept.includes(alias)) {
            if (side === "left") kept.unshift(alias);
            else if (side === "center") kept.splice(Math.ceil(kept.length / 2), 0, alias);
            else if (after && kept.includes(after)) kept.splice(kept.indexOf(after) + 1, 0, alias);
            else kept.push(alias);
        }
        pending.delete(alias);
    }
    cast.forEach(insert);
    return kept;
}
// private fork: one equal slot per figure; historical absolute positions are ignored.
function forkGalSlotMap(order, stageable) {
    const placed = stageable ? order.filter(stageable) : order, map = {};
    const slots = placed.length > 3 ? placed.map((_, i) => 0.1 + 0.8 * i / (placed.length - 1)) : forkLive2dSlots(placed.length);
    placed.forEach((id, i) => { map[id] = slots[i]; });
    return map;
}
// Cinematic vocabulary (docs/fork/stage-direction-v2.md). Persistent: light, weather, cam, dof, glow /
// shadow / lit (figure light), and trans (the transition of the scene change on its line). One-shots: beat,
// emote, title, act. Legacy commands map onto them: shake N / flash / fade black|in → beat, zoom in →
// cam push, zoom out → cam reset. Sound: sfx is a one-shot; environment loops use record snapshots.
// light names any stage look id (docs/fork/stage-looks.md); ids the loaded looks do not know fall back to
// auto when the scene resolves them.
const FORK_GAL_STAGE_LIGHT = /^[a-z][a-z0-9-]{0,31}$/;
const FORK_GAL_STAGE_WEATHERS = ["rain", "storm", "snow", "sakura", "leaves", "sparkle"];
const FORK_GAL_STAGE_SHOTS = ["push", "close", "pan-left", "pan-right", "dutch"];
const FORK_GAL_STAGE_TRANSITIONS = ["cut", "fade", "black", "white", "wipe", "iris"];
const FORK_GAL_STAGE_ACTS = ["nod", "shake", "jump", "tremble", "turn", "bow", "lean", "step-back"];
function forkGalCommand(command) {
    if (!command || !command.op) return null;
    const op = command.op, value = command.value;
    if (op === "shake") return { op: "beat", value: "shake-" + Math.max(1, Math.min(3, Math.round(Number(value) || 1))) };
    if (op === "flash") return { op: "beat", value: "flash" };
    if (op === "fade") return { op: "beat", value: value === "in" ? "fade-in" : "blackout" };
    if (op === "zoom") return { op: "cam", value: value === "in" ? "push" : "reset" };
    if (op === "beat") { const name = forkGalBeatName(value); return name ? { op, value: name } : null; }
    if (op === "emote") { const name = forkGalEmoteName(value); return name && command.id ? { op, id: command.id, value: name } : null; }
    if (op === "act") return FORK_GAL_STAGE_ACTS.includes(value) && command.id ? command : null;
    if (op === "title") { const text = String(value == null ? "" : value).trim(); return text ? { op, value: Array.from(text).slice(0, 24).join("") } : null; }
    return command;
}
// private fork: paragraphs a close-up holds after the one that cues it (docs/fork/stage-incremental-architecture.md).
const FORK_GAL_CLOSE_PARAS = 4;
// A carried camera (direction.start.camera): { value, id } or a plain shot name; the legacy zoom flag.
function forkGalStartCamera(start) {
    const camera = start.camera;
    const value = typeof camera === "string" ? camera : camera && camera.value || "";
    if (FORK_GAL_STAGE_SHOTS.includes(value)) return value === "close" ? (camera.id ? { value, id: camera.id } : { value: "" }) : { value };
    return { value: !camera && start.zoom === "in" ? "push" : "" };
}
function forkGalStaging(direction, para, offstage = new Set(), stageable, looks) {
    const out = { members: [], effects: [], order: [], light: "auto", lighting: { time: "auto", mood: "none" }, timeFadeMs: 800, weather: "", camera: { value: "" }, dof: "", figureLight: {}, transition: "" };
    if (!forkGalHasDirection(direction)) return out;
    // Accept the old single-alias argument for existing callers.
    if (typeof offstage === "string") offstage = new Set(offstage ? [offstage] : []);
    const keep = alias => alias && !offstage.has(alias);
    const start = direction.start || {}, incremental = direction.protocol === "incremental-v1";
    const transientFocus = {};
    const positionedSlots = order => forkGalSlotMap(order, stageable);
    let cast = (start.cast || []).filter(keep);
    let order = forkGalOrder((start.order || []).filter(keep), cast, {});
    const focus = Object.assign({}, start.focus), look = Object.assign({}, start.look), focusAt = {};
    let light = FORK_GAL_STAGE_LIGHT.test(start.light || "") ? start.light : "auto";
    let weather = FORK_GAL_STAGE_WEATHERS.includes(start.weather) ? start.weather : "";
    let camera = forkGalStartCamera(start), cameraAt = 0;
    let dof = typeof start.dof === "string" && start.dof !== "off" ? start.dof : "";
    const figureLight = {};
    Object.keys(start.figureLight || {}).forEach(function (id) { if (keep(id) && (start.figureLight[id] === "glow" || start.figureLight[id] === "shadow")) figureLight[id] = start.figureLight[id]; });
    if (!incremental) {
        if (camera.id && !cast.includes(camera.id)) camera = { value: "" };
        if (dof && !cast.includes(dof)) dof = "";
        Object.keys(figureLight).forEach(function (id) { if (!cast.includes(id)) delete figureLight[id]; });
    }
    Object.keys(look).forEach(function (id) { if (!keep(id) || offstage.has(look[id])) delete look[id]; });
    let transition = "";
    const entering = {}, exiting = [];
    (direction.entries || []).forEach(function (entry) {
        if (entry.at > para) return;
        const here = entry.at === para;
        const before = order.slice(), xBefore = positionedSlots(before), focusBefore = Object.assign({}, focus);
        const sides = {};
        if (entry.scene) transition = "";
        // private fork: a close-up never survives a scene change (a new place is a new shot).
        if (entry.scene && camera.value === "close") camera = { value: "" };
        (entry.commands || []).forEach(function (raw) {
            if (raw && (offstage.has(raw.id) || raw.op === "look" && (offstage.has(raw.value) || offstage.has(raw.at)))) return;
            const command = forkGalCommand(raw);
            if (!command) return;
            const id = command.id;
            if (id !== undefined && !keep(id)) return;
            const op = command.op, value = command.value;
            if (op === "pos") sides[id] = value;
            else if (op === "enter") { if (!sides[id] && value !== "fade") sides[id] = value; if (here) entering[id] = value; }
            else if (op === "exit") { if (incremental) delete transientFocus[id]; if (here && before.includes(id)) exiting.push({ id, x: xBefore[id], focus: focus[id] || "normal", to: value }); delete entering[id]; }
            else if (op === "focus") {
                if (incremental && command.transient) transientFocus[id] = { value, at: entry.at };
                else { delete transientFocus[id]; if (value !== "close") delete focus[id]; else { focus[id] = value; focusAt[id] = entry.at; } }
            }
            else if (incremental && op === "reset-transients") Object.keys(transientFocus).forEach(id => delete transientFocus[id]);
            else if (op === "look") { if (value === "viewer") delete look[id]; else look[id] = value; }
            else if (op === "light") { if (typeof value === "string" && FORK_GAL_STAGE_LIGHT.test(value)) light = value; }
            else if (op === "weather") { if (value === "none") weather = ""; else if (FORK_GAL_STAGE_WEATHERS.includes(value)) weather = value; }
            else if (op === "cam") {
                if (value === "wide" || value === "reset") camera = { value: "" };
                else if (value === "close") { if (id) { camera = { value, id }; cameraAt = entry.at; } }
                else if (FORK_GAL_STAGE_SHOTS.includes(value)) camera = { value };
            }
            else if (op === "dof") { if (value === "off" || (!id && !value)) dof = ""; else if (id) dof = id; }
            else if (op === "glow" || op === "shadow") { if (id) figureLight[id] = op; }
            else if (op === "lit") { if (id) delete figureLight[id]; }
            else if (op === "trans") { if ((entry.scene || incremental) && FORK_GAL_STAGE_TRANSITIONS.includes(value)) transition = value; }
            else if (op === "beat" || op === "emote" || op === "title" || op === "act" || op === "sfx") { if (here) out.effects.push(command); }
        });
        if (entry.cast) { cast = entry.cast.filter(keep); order = forkGalOrder(order, cast, sides); }
        // Arrivals and departures written only as a new [list] still fade at their slots.
        if (here) {
            order.forEach(function (id) { if (!before.includes(id) && !(id in entering)) entering[id] = "soft"; });
            before.forEach(function (id) { if (!order.includes(id) && !exiting.some(item => item.id === id)) exiting.push({ id, x: xBefore[id], focus: focusBefore[id] || "normal", to: "soft" }); });
        }
        if (incremental) for (const id of Object.keys(transientFocus)) if (!cast.includes(id)) delete transientFocus[id];
        // Legacy per-person state ends on exit; incremental persistent state is retained.
        if (!incremental) {
            [focus, look, figureLight].forEach(map => Object.keys(map).forEach(function (id) { if (!cast.includes(id)) delete map[id]; }));
            Object.keys(look).forEach(function (id) { if (look[id] !== "away" && !cast.includes(look[id])) delete look[id]; });
            if (camera.id && !cast.includes(camera.id)) camera = { value: "" };
            if (dof && !cast.includes(dof)) dof = "";
        }
    });
    const slots = positionedSlots(order);
    order.forEach(function (id) {
        let level = incremental && transientFocus[id] && para - transientFocus[id].at <= 2 ? transientFocus[id].value : focus[id] || "normal";
        if (!incremental && level === "close" && !(para - (focusAt[id] == null ? -99 : focusAt[id]) <= 2)) level = "normal";
        if (level !== "close") level = "normal";
        out.members.push({ id, x: slots[id], focus: level, look: look[id] || "", light: figureLight[id] || "", visible: true, enter: entering[id] || "", exit: "" });
    });
    exiting.forEach(function (item) {
        if (order.includes(item.id)) return;
        out.members.push({ id: item.id, x: item.x, focus: "normal", look: "", light: "", visible: false, enter: "", exit: item.to });
    });
    // private fork: a close-up is a short emphasis, not a held framing: this paragraph plus FORK_GAL_CLOSE_PARAS.
    if (camera.value === "close" && para - cameraAt > FORK_GAL_CLOSE_PARAS) camera = { value: "" };
    const layers = forkStageLightingReplay(start, (direction.entries || []).filter(entry => entry.at <= para), looks);
    Object.assign(out, { order, light, lighting: layers.lighting, timeFadeMs: layers.timeFadeMs, weather, camera: camera.id && !cast.includes(camera.id) ? { value: "" } : camera, dof: dof && !cast.includes(dof) ? "" : dof, figureLight, transition });
    return out;
}
// Keeps figures that just left the stage for a moment (visible: false) so every departure can
// fade out instead of vanishing. Items: [{ key, ... }].
function useForkGalPresence(items, ms) {
    const memory = React.useRef(new Map());
    const [, tick] = React.useState(0);
    const now = forkForeground.now(), keys = new Set(items.map(item => item.key)), leaving = [];
    items.forEach(item => memory.current.set(item.key, { item, until: 0 }));
    memory.current.forEach(function (record, key) {
        if (keys.has(key)) return;
        if (!record.until) record.until = now + ms;
        if (record.until <= now) { memory.current.delete(key); return; }
        leaving.push(Object.assign({}, record.item, { visible: false, speaking: false, talking: false, audio: null, act: null, enter: "", exit: record.item.visible === false ? record.item.exit : "soft" }));
    });
    React.useEffect(function () {
        if (!leaving.length) return;
        const timer = forkForeground.setTimeout(() => tick(n => n + 1), ms + 40);
        return () => forkForeground.clearTimeout(timer);
    });
    return items.concat(leaving);
}
// Gaze direction on screen for a member: -1 left, 0 viewer, 1 right; null when not directed.
function forkGalGaze(look, x, others) {
    if (!look) return null;
    if (look === "away") return x > 0.5 ? 1 : -1;
    const target = others[look];
    if (target == null || Math.abs(target - x) < 0.01) return 0;
    return target > x ? 1 : -1;
}
// Latest mood of a character up to the page (for their portrait expression).
function forkGalMoodOf(pages, at, alias, config) {
    for (let i = Math.min(at, pages.length - 1); i >= 0; i--) if (pages[i].kind === "line" && forkBubbleCharacter(config, pages[i])?.alias === alias) return pages[i].mood || "";
    return "";
}
// A talk frame belongs to the selected base slot, never to a different mood's picture.
function forkGalStaticFrames(model, mood) {
    const spriteBundle = model.spritePack ? forkSpriteBundle(model, mood) : null;
    if (spriteBundle) return { src: spriteBundle.view.src, talkSrc: "", spriteBundle };
    const images = model.images || {}, slot = images[mood] ? mood : "default";
    return { src: images[slot] || "", talkSrc: model.talk && model.talk[slot] || "" };
}
// Revalidate on every visit; only the latest pending turn or an explicit generation polls.
// The stage is a full-screen mode of one session at a time; it is not remembered across reloads.
const forkGalActive = (function () {
    let session = "";
    const listeners = new Set();
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => session,
        set(value) { session = value || ""; listeners.forEach(fn => fn()); }
    };
})();
let forkGalEntry = null;
function forkGalEnter(sessionId, target) {
    // private fork (stage setup wizard v2): the first entry on a card without 素材包 opens 舞台设置 › 设置向导 instead
    // (fork-asset-launcher.js forkStageSetupGate; absent where the stage is loaded on its own). The host check is one
    // local read, well inside the click's activation window, so full screen is still granted afterwards.
    const setup = typeof forkStageSetupGate === "function" ? forkStageSetupGate(sessionId) : null;
    if (setup) { setup.then(opened => { if (!opened) forkGalOpen(sessionId, target); }); return; }
    forkGalOpen(sessionId, target);
}
function forkGalOpen(sessionId, target) {
    forkUiSfx.preload(); forkUiSfx.play("open"); // private fork: fork-ui-sfx.js
    forkGalEntry = target && Number.isInteger(target.turn) ? { sessionId, turn: target.turn, para: Math.max(1, Number(target.para) || 1), token: Date.now() } : null;
    forkGalCoverChat();
    forkGalActive.set(sessionId);
    // Called from the click itself, so the browser grants full screen.
    const root = document.documentElement;
    if (!document.fullscreenElement && root.requestFullscreen) root.requestFullscreen().catch(() => {});
}
// Requests for the stage's system menu from outside the stage (the host: system full screen was left, which the
// browser does on Esc before the page sees the key). A counter; the mounted stage opens its menu on a change.
const forkGalMenuRequest = (function () {
    let count = 0;
    const listeners = new Set();
    return {
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
        get: () => count,
        request() { count++; listeners.forEach(fn => fn()); }
    };
})();
// private fork (owner 2026-10): in full screen the stage holds Esc (Keyboard Lock), so a press reaches the page and opens
// the menu in place - no exit, no window shrink. Holding Esc still leaves full screen (the browser's rule). Without the
// API the host's fullscreen-lost path opens the menu instead.
function forkGalEscapeLock(on) {
    const keyboard = typeof navigator !== "undefined" ? navigator.keyboard : null;
    if (!keyboard || typeof keyboard.lock !== "function") return;
    if (on) keyboard.lock(["Escape"]).catch(() => {}); else keyboard.unlock();
}
// 「返回主页面」(the system menu, the chat button and the top-bar ✕): leave the stage, keep the bookmark.
function forkGalLeave() {
    forkUiSfx.play("close");
    forkGalActive.set("");
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
// One plugin-owned capture listener also works when an editor or modal has focus.
function forkGalStageShortcut(ctx) {
    let composing = false;
    const compositionStart = () => { composing = true; };
    const compositionEnd = () => { composing = false; };
    function onKey(event) {
        if (event.key !== "F12" || composing || event.isComposing || event.keyCode === 229) return;
        const sessionId = ctx.sessions.list.getSnapshot().current;
        const data = sessionId && forkBubbleStore.get(sessionId);
        if (!data?.cardPath || !data.config?.enabled) return;
        event.preventDefault();
        event.stopPropagation();
        if (event.repeat) return;
        if (forkGalActive.get() === sessionId) forkGalLeave();
        else forkGalEnter(sessionId);
    }
    window.addEventListener("compositionstart", compositionStart, true);
    window.addEventListener("compositionend", compositionEnd, true);
    window.addEventListener("blur", compositionEnd);
    window.addEventListener("keydown", onKey, true);
    return function () {
        window.removeEventListener("compositionstart", compositionStart, true);
        window.removeEventListener("compositionend", compositionEnd, true);
        window.removeEventListener("blur", compositionEnd);
        window.removeEventListener("keydown", onKey, true);
    };
}
function useForkGalOn(sessionId) {
    const active = React.useSyncExternalStore(forkGalActive.subscribe, forkGalActive.get);
    const data = useForkBubbles(sessionId, Boolean(sessionId));
    const available = Boolean(data && data.cardPath && data.config && data.config.enabled);
    return { available, on: available && active === sessionId, data };
}
// private fork: galgame typewriter (fork-theme.css "stage typewriter"). The whole page is laid out from the
// first frame and glyphs are only revealed (opacity), so shown text never re-wraps: line breaks, kinsoku and
// the box are fixed before the first character appears. While the text still streams in, the last glyphs (and
// an unfinished Latin word) stay hidden so later text cannot move them. Each glyph fades in with a slight rise;
// the rhythm pauses briefly after punctuation. Fonts settle before the first glyph.
// props.speed: milliseconds per character (the reading preference; 0 shows the whole line at once).
function ForkGalTypewriter(props) {
    const speed = props.speed == null ? FORK_STAGE_READING_DEFAULTS.textSpeed : props.speed;
    const instant = Boolean(props.instant) || !(speed > 0);
    const pending = Boolean(props.pending);
    const reveal = props.skin ? stageSkinReveal(props.skin,speed,{reducedMotion:props.reducedMotion === true,photosensitive:props.photosensitive !== false}) : null;
    const stepped = reveal && reveal.kind !== 'type' && !instant;
    const fadeMs = FORK_GAL_GLYPH_FADE_MS;
    // Skin hop clock (stepped reveals only): the current hop step and the step each glyph appeared on.
    const [skinStep,setSkinStep] = React.useState(0);
    const hop = React.useRef({step:0,t0:null,base:0,born:[]});
    const glyphs = React.useMemo(() => forkGalGlyphs(props.text), [props.text]);
    const limit = forkGalRevealLimit(glyphs, pending);
    const fontsReady = useForkGalFontsReady();
    const [shown, setShown] = React.useState(instant ? limit : 0);
    const visible = instant ? limit : Math.min(shown, limit);
    // Only the glyphs still fading in are separate elements (one per glyph); shown text is one run and the
    // hidden rest another, so the text paints exactly as plain text (no per-glyph shadow overlap) once settled.
    const [settled, setSettled] = React.useState(-1);
    const onDone = React.useRef(props.onDone), onReveal=React.useRef(props.onReveal), onVisible=React.useRef(props.onVisible);
    onVisible.current=props.onVisible;
    React.useLayoutEffect(()=>{onVisible.current?.(glyphs.slice(0,visible).join(""));},[visible,glyphs,props.visibleKey]);
    onDone.current = props.onDone;onReveal.current=props.onReveal;
    React.useEffect(function () {
        if (stepped) return; // the hop clock below drives stepped skin reveals
        if (!pending && visible >= glyphs.length) onDone.current && onDone.current();
        if (instant || !fontsReady || visible >= limit) {
            const timer = forkForeground.setTimeout(() => setSettled(visible), fadeMs + 40);
            return () => forkForeground.clearTimeout(timer);
        }
        // private fork: the page is laid out but its first glyph waits while the previous face clears (useForkGalFaceHandoff).
        if (props.hold) return;
        const delay = (reveal?.stepMs || speed) * (1 + (visible > 0 ? forkGalGlyphPause(glyphs, visible - 1) : 0));
        const timer = forkForeground.setTimeout(() => {
            setShown(Math.min(limit,visible + 1));
            onReveal.current?.(visible);
        },delay);
        return () => forkForeground.clearTimeout(timer);
    }, [visible, limit, glyphs, pending, instant, fontsReady, speed, stepped, reveal?.kind, reveal?.stepMs, reveal?.chars, Boolean(props.hold)]);
    // private fork (owner 2026-10): stepped skin reveals are cut-out animation on twos. One frame-quantized clock
    // (absolute from its start, read at the frame's own time) drives both the reveal steps and every glyph's pose,
    // so poses never drift off the steps and each is held the same number of display frames. A glyph enters in
    // one clean step (hop 0), lands on the next (hop 1) and then holds at rest; there are no CSS animation timers.
    // A long task skips poses rather than slowing the reading speed. The page reports done once its last glyphs
    // have landed, so the final hop is not cut short by the typed state.
    React.useEffect(function () {
        if (!stepped || !fontsReady) return;
        // The face handoff hold (props.hold) stops the hop clock too; it restarts with a fresh step when released.
        if (props.hold) { hop.current.t0 = null; return; }
        const state = hop.current, settledAt = visible > 0 ? (state.born[visible - 1] ?? 0) + 2 : 0;
        if (visible >= limit && state.step >= settledAt) {
            state.t0 = null;
            if (!pending && visible >= glyphs.length) onDone.current && onDone.current();
            return;
        }
        let frame = null;
        const tick = function () {
            const now = forkGalFrameNow();
            if (state.t0 === null) { state.t0 = now; state.base = state.step + 1; }
            // 2 ms absorbs frame timestamp jitter without moving a step across a frame boundary (a 144 Hz frame is 6.9 ms).
            const step = state.base + Math.floor((now - state.t0 + 2) / reveal.stepMs);
            if (step <= state.step) { frame = forkForeground.requestAnimationFrame(tick); return; }
            let next = visible;
            for (let k = state.step + 1; k <= step; k++) {
                const count = next < limit ? Math.min(limit - next, stageSkinRevealCount(reveal, next, k)) : 0;
                if (count > 0) onReveal.current?.(next);
                for (let i = next; i < next + count; i++) state.born[i] = k;
                next += count;
            }
            state.step = step;
            frame = null;
            setShown(next); setSkinStep(step);
        };
        frame = forkForeground.requestAnimationFrame(tick);
        return () => { if (frame !== null) forkForeground.cancelAnimationFrame(frame); };
    }, [stepped, fontsReady, visible, limit, glyphs, pending, skinStep, reveal?.kind, reveal?.stepMs, reveal?.chunk, reveal?.speed, Boolean(props.hold)]);
    // Glyphs before `settled` finished fading earlier (a held streaming tail), so they never fade again.
    const tail = Math.ceil(fadeMs/Math.max(1,speed))+1;
    const landed = stepped ? hop.current.born.findIndex((born, i) => i < visible && born + 2 > skinStep) : -1;
    const done = instant ? visible : stepped ? (landed < 0 ? visible : landed) : Math.min(visible, Math.max(0, settled, visible - tail));
    const h = React.createElement;
    return h("span", { className: "fork-gal-type" + (instant ? " is-instant" : ""), 'data-skin-reveal':stepped ? reveal.kind : undefined },
        done > 0 ? h("span", { key: "shown", className: "fork-gal-type-shown" }, glyphs.slice(0, done).join("")) : null,
        glyphs.slice(done, visible).map((glyph, index) => h("span", { key: done + index, className: "fork-gal-glyph" }, glyph,
            stepped ? h('span',{className:'fork-skin-glyph-paint','data-glyph':glyph,'data-hop':Math.min(2,skinStep-(hop.current.born[done+index] ?? skinStep)),'aria-hidden':true}) : null)),
        visible < glyphs.length ? h("span", { key: "rest", className: "fork-gal-type-rest" }, glyphs.slice(visible).join("")) : null);
}
// Matches fork-gal-glyph-in in fork-theme.css.
const FORK_GAL_GLYPH_FADE_MS = 220;
// The presentation clock (forkForeground: stops while the window is in the background) at the current frame's start.
// Inside a frame callback document.timeline.currentTime is the frame time shared by every callback of that frame, so
// a Live2D or Pixi callback that ran first cannot push a hop step across a frame boundary.
function forkGalFrameNow() {
    const now = forkForeground.now(), frame = typeof document !== "undefined" ? document.timeline?.currentTime : null;
    return typeof frame === "number" && typeof performance !== "undefined" ? now - Math.max(0, performance.now() - frame) : now;
}
const FORK_GAL_GLYPH_SEGMENTER = typeof Intl !== "undefined" && Intl.Segmenter ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;
function forkGalGlyphs(text) {
    const value = String(text || "");
    return FORK_GAL_GLYPH_SEGMENTER ? Array.from(FORK_GAL_GLYPH_SEGMENTER.segment(value), part => part.segment) : Array.from(value);
}
// A streaming page keeps its last two glyphs (and a Latin word still being written) hidden: a following 。 or 」
// may pull the glyph before it onto the next line (kinsoku), and a growing word may wrap as a whole.
function forkGalRevealLimit(glyphs, pending) {
    if (!pending) return glyphs.length;
    const word = glyph => /^[\p{L}\p{N}'\u2019-]$/u.test(glyph || "") && !/[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}\p{sc=Hangul}]/u.test(glyph || "");
    let end = Math.max(0, glyphs.length - 2);
    while (end > 0 && word(glyphs[end - 1]) && word(glyphs[end])) end--;
    return end;
}
// Extra glyph steps to wait after glyphs[index]: after a sentence end (also behind its closing quote, 。」) and a
// line break, a shorter one after a comma; none inside a run of punctuation or at the end.
function forkGalGlyphPause(glyphs, index) {
    const closers = /^[」』）)】〉》”"’'］\]]$/u, next = glyphs[index + 1];
    if (next === undefined || closers.test(next) || /^[、，,。．.！!？?…‥：:；;～~—―]$/u.test(next)) return 0;
    let at = index;
    while (at > 0 && closers.test(glyphs[at])) at--;
    const glyph = glyphs[at];
    if (glyph === "\n" || /^[。．.！？!?…‥]$/u.test(glyph) && (glyph !== "." || /^\s$/.test(next))) return 5;
    if (/^[、，,；;：:～~]$/u.test(glyph)) return 2;
    if (/^[—―]$/u.test(glyph)) return 1;
    return 0;
}
function useForkGalFontsReady() {
    const fonts = typeof document !== "undefined" ? document.fonts : null;
    const [ready, setReady] = React.useState(() => !fonts || fonts.status === "loaded");
    React.useEffect(function () {
        if (ready) return;
        let live = true;
        const done = () => { if (live) setReady(true); };
        fonts.ready.then(done, done);
        const timer = forkForeground.setTimeout(done, 800);
        return () => { live = false; forkForeground.clearTimeout(timer); };
    }, []);
    return ready;
}

// Dialogue box dressing: filigree corners (generated art, runtime-assets/gal-stage) and a
// light sweep along the top edge; purely decorative.
function ForkGalBoxFrame() {
    const h = React.createElement;
    // look / grain: the stage look pressed onto the box (vignette and haze on the edges, a light film grain).
    return h("span", { className: "fork-gal-frame", "aria-hidden": true }, h("i", { className: "look" }), h("i", { className: "grain" }), h("i", { className: "tl" }), h("i", { className: "br" }), h("i", { className: "sweep" }), h("i", { className: "bow" }),
        [0, 1, 2, 3, 4, 5].map(n => h("i", { key: n, className: "spark s" + n })));
}
// Scene names are 「地点·细节·时间」. When the cued scene has no picture yet (待补图), stand in with the
// closest picture of the card's range: shared place words first, then the same time of day, and grade
// the picture towards the wanted time (a night filter over a daytime street) rather than show sunshine.
const FORK_GAL_TIMES = [["night", /夜|晚上|深夜|午夜/], ["dusk", /黄昏|傍晚|夕/], ["day", /清晨|早晨|早上|晨|白天|昼|中午|午后|下午|上午|晴/]];
function forkGalTimeOf(name) { const hit = FORK_GAL_TIMES.find(([, pattern]) => pattern.test(String(name || ""))); return hit ? hit[0] : ""; }
function forkGalStandIn(name, entries) {
    const parts = String(name || "").split(/[·・\s]+/).filter(part => part && !forkGalTimeOf(part));
    const time = forkGalTimeOf(name);
    let best = null, bestScore = 0;
    entries.forEach(function (entry) {
        const words = entry.name.split(/[·・\s]+/);
        let score = 0;
        parts.forEach(part => { if (words.includes(part)) score += 4; else if (words.some(word => word.includes(part) || part.includes(word))) score += 2; else { const shared = new Set([...part].filter(ch => entry.name.includes(ch))).size; if (shared >= 2) score += shared * 0.8; } });
        if (time && forkGalTimeOf(entry.name) === time) score += 1.5;
        if (score > bestScore) { best = entry; bestScore = score; }
    });
    return bestScore >= 1.5 ? best : null;
}
// Face window at the left of the text box: the speaker's static mood avatar (the stage figure is
// already the moving portrait, so the face stays a still picture).
function ForkGalFace(props) {
    const h = React.createElement;
    const face = props.face;
    const emote = props.emote;
    return h("div", { className: "fork-gal-face" + (face ? " is-on" : ""), "aria-hidden": true },
        face && face.spriteBundle ? h(ForkSpriteImage, { className: "fork-gal-face-img", bundle: face.spriteBundle, audio: face.audio, enabled: face.enabled, voiceKey: face.voiceKey }) : face && face.src ? h(ForkPackImage, { key: face.key, identity:face.identity, className: "fork-gal-face-img", src: face.src, crop:face.crop, avatar:face.avatar, alt: "" }) : null,
        // An emote for a speaker who is not standing on stage pops up on their face window instead.
        face && emote ? h("img", { key: emote.nonce, className: "fork-gal-face-emote", "data-kind": emote.kind, src: forkGalEmoteDataUrl(emote.kind, forkGalCssColor(emote.color)), alt: "" }) : null);
}
// Classic theme side image: the speaker's mood avatar unframed at the bottom-left, rising out of the box.
// A mood change crossfades; a new speaker slides in from the left; no face (narration) clears it quickly
// (props.clearMs, the hold of the next page's text in useForkGalFaceHandoff). Leaving layers stay mounted for their
// animation, then are dropped. props.snap (skip, page back / jump, a click that finished a held page): no animation,
// leaving layers go at once and a new face is simply there. props.calm: the clear is a plain fade (reduced motion).
function ForkGalSide(props) {
    const h = React.createElement;
    const face = props.face && props.face.src ? props.face : null;
    const emote = props.emote;
    const seq = React.useRef(1), snap = React.useRef(false);
    snap.current = Boolean(props.snap);
    const [layers, setLayers] = React.useState(() => face ? [{ id: 0, key: face.key, identity:face.identity, src: face.src, crop:face.crop, avatar:face.avatar, spriteBundle: face.spriteBundle, revision: JSON.stringify(face.crop || face.spriteBundle?.revision || ""), enter: "none", out: "" }] : []);
    const faceKey = face ? face.key : "", faceSrc = face ? face.src : "", faceIdentity = face?.identity, faceRevision = JSON.stringify(face?.crop || face?.spriteBundle?.revision || "");
    React.useLayoutEffect(function () {
        setLayers(function (list) {
            const top = list.filter(layer => !layer.out).pop() || null;
            if (!faceSrc) return snap.current ? [] : top ? list.map(layer => layer.out ? layer : Object.assign({}, layer, { out: "clear" })) : list;
            if (top && top.key === faceKey && top.identity === faceIdentity && top.revision === faceRevision) return list;
            const same = Boolean(top && top.key === faceKey);
            const next = { id: seq.current++, key: faceKey, identity:faceIdentity, src: faceSrc, crop:face?.crop, avatar:face?.avatar, spriteBundle: face && face.spriteBundle, revision: faceRevision, enter: snap.current ? "none" : same ? "fade" : "slide", out: "" };
            if (snap.current) return [next];
            // Fast paging keeps at most the two newest leaving layers.
            return list.map(layer => layer.out ? layer : Object.assign({}, layer, { out: same ? "fade" : "slide" })).slice(-2).concat([next]);
        });
        const timer = forkForeground.setTimeout(() => setLayers(list => list.filter(layer => !layer.out)), 420);
        return () => forkForeground.clearTimeout(timer);
    }, [faceKey, faceIdentity, faceRevision]);
    // A snap that arrives while a layer is still leaving drops it in the same frame (state follows, so it never returns).
    React.useLayoutEffect(function () { if (props.snap && layers.some(layer => layer.out)) setLayers(list => list.filter(layer => !layer.out)); }, [props.snap, layers]);
    const shown = props.snap ? layers.filter(layer => !layer.out) : layers;
    return h("div", { className: "fork-gal-side" + (face ? " is-on" : "") + (props.calm ? " is-calm" : ""), "aria-hidden": true, style: props.clearMs ? { "--gal-face-clear-ms": props.clearMs + "ms" } : undefined },
        // private fork: identify each layer so its orientation follows its own stage actor.
        shown.map(layer => layer.spriteBundle ? h(ForkSpriteImage, { key: layer.id, faceActor: layer.key, className: "fork-gal-side-img", bundle: !layer.out && face?.identity === layer.identity ? face.spriteBundle : layer.spriteBundle, enter: layer.enter, out: layer.out, audio: !layer.out && face ? face.audio : null, enabled: !layer.out && face && face.enabled, voiceKey: !layer.out && face ? face.voiceKey : "out:" + layer.id }) : h(ForkPackImage, { key: layer.id, identity:layer.identity, "data-face-actor": layer.key, cropOverflow:true, className: "fork-gal-side-img", "data-enter": layer.enter, "data-out": layer.out || undefined, src: !layer.out && face?.identity === layer.identity ? face.src : layer.src, crop:!layer.out && face?.identity === layer.identity ? face.crop : layer.crop, avatar:!layer.out && face?.identity === layer.identity ? face.avatar : layer.avatar, alt: "", draggable: false })),
        face && emote ? h("img", { key: "e" + emote.nonce, className: "fork-gal-face-emote", "data-kind": emote.kind, src: forkGalEmoteDataUrl(emote.kind, forkGalCssColor(emote.color)), alt: "" }) : null);
}
// Title card (director `title`, one-shot): black screen, serif text typed out, a short hold, fade out.
// Click skips it. props.title: { text, nonce }.
function ForkGalTitle(props) {
    const h = React.createElement;
    const text = Array.from(props.title.text || "");
    const [shown, setShown] = React.useState(0);
    const [phase, setPhase] = React.useState("in"); // in → typing → hold → out
    React.useEffect(function () {
        let timer = 0;
        if (phase === "in") timer = forkForeground.setTimeout(() => setPhase("typing"), 420);
        else if (phase === "typing") timer = shown < text.length ? forkForeground.setTimeout(() => setShown(n => n + 1), 105) : forkForeground.setTimeout(() => setPhase("hold"), 60);
        else if (phase === "hold") timer = forkForeground.setTimeout(() => setPhase("out"), 1400);
        else if (phase === "out") timer = forkForeground.setTimeout(() => props.onDone(), 760);
        return () => forkForeground.clearTimeout(timer);
    }, [phase, shown]);
    return h("div", { className: "fork-gal-title is-" + phase, role: "status", "aria-label": props.title.text, title: "点击跳过",
        onClick: event => { event.stopPropagation(); if (phase !== "out") setPhase("out"); } },
        h("div", { className: "fork-gal-title-text", "aria-hidden": true },
            text.map((ch, i) => h("span", { key: i, className: i < shown ? "is-on" : "" }, ch))),
        h("i", { className: "fork-gal-title-rule", "aria-hidden": true }));
}
// Machine preference: film mode (letterbox + subtitles instead of the dialogue box), off by default.
const forkStageFilm = (function () {
    const KEY = "fork-stage-film";
    const listeners = new Set();
    function get() { try { return localStorage.getItem(KEY) === "on"; } catch (_) { return false; } }
    return {
        get,
        set(value) { try { localStorage.setItem(KEY, value ? "on" : "off"); } catch (_) {} listeners.forEach(fn => fn()); },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useForkStageFilm() { return React.useSyncExternalStore(forkStageFilm.subscribe, forkStageFilm.get); }
// Machine preference: reading pace (Config → 文字). textSpeed = milliseconds per typed character (0 = the whole
// line at once); autoWait = the auto mode's pause after a line's voice ends. A silent page waits its reading
// time (forkGalAutoHold) shifted by the same amount. autoSpeed scales both waits;
// the 1.3x default shortens idle dwell without speeding up or cutting off speech.
// voiceRate: every dialogue voice clip plays this much faster, pitch preserved (Config → 声音).
const FORK_STAGE_READING_DEFAULTS = { textSpeed: 28, autoWait: 700, autoSpeed: 1.3, voiceRate: 1, frameCap: 60, reducedMotion:false, photosensitive:true };
const FORK_STAGE_READING_LIMITS = { textSpeed: [0, 80, 2], autoWait: [0, 3000, 100], autoSpeed: [0.5, 3, 0.1], voiceRate: [0.8, 2, 0.1] }; // [min, max, step]
function forkStageReadingPrefs(saved) {
    const out = { ...FORK_STAGE_READING_DEFAULTS };
    if (!saved || typeof saved !== "object") return out;
    if ([0, 30, 60, 120].includes(saved.frameCap)) out.frameCap = saved.frameCap;
    for (const key of ['reducedMotion','photosensitive']) if (typeof saved[key] === 'boolean') out[key]=saved[key];
    for (const key of Object.keys(FORK_STAGE_READING_LIMITS)) {
        const [min, max, step] = FORK_STAGE_READING_LIMITS[key], value = Number(saved[key]);
        if (saved[key] !== null && saved[key] !== "" && Number.isFinite(value)) out[key] = Math.max(min, Math.min(max, Number((Math.round(value / step) * step).toFixed(3))));
    }
    return out;
}
// private fork (reading controls §2.3, owner 2026-10): a silent page's reading time scales with its visible characters
// (letters, digits, CJK; a punctuation-only line such as 「……」 counts as one), so 「嗯」 does not wait like a full line:
// clamp(400 + 70 × chars, 800, 10000) ms. From about 18 characters on it is within a few percent of the old
// max(1600, chars × 85); very long pages are capped.
const FORK_GAL_AUTO_HOLD = { base: 400, perChar: 70, min: 800, max: 10000 };
// Fast-forward (SKIP control or held Ctrl): one read page per tick, each painted fully before the next.
const FORK_GAL_SKIP_PAGE_MS = 70;
function forkGalVisibleChars(text) { return Math.max(1, (String(text || "").match(/[\p{L}\p{N}]/gu) || []).length); }
function forkGalAutoHold(text) { const hold = FORK_GAL_AUTO_HOLD; return Math.max(hold.min, Math.min(hold.max, hold.base + hold.perChar * forkGalVisibleChars(text))); }
function forkGalAutoDelay(reading, voiced, text) {
    const wait = reading && Number.isFinite(reading.autoWait) ? reading.autoWait : FORK_STAGE_READING_DEFAULTS.autoWait;
    const speed = forkStageReadingPrefs(reading).autoSpeed;
    if (voiced) return Math.max(0, wait) / speed;
    return Math.max(0, forkGalAutoHold(text) + wait - FORK_STAGE_READING_DEFAULTS.autoWait) / speed;
}
const forkStageReading = (function () {
    const KEY = "fork-stage-reading";
    const listeners = new Set();
    let cached = null;
    function get() {
        if (!cached) { let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch (_) {} cached = forkStageReadingPrefs(saved); }
        return cached;
    }
    return {
        get,
        set(patch) {
            cached = forkStageReadingPrefs({ ...get(), ...patch });
            try { localStorage.setItem(KEY, JSON.stringify(cached)); } catch (_) {}
            listeners.forEach(fn => fn());
        },
        subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
    };
})();
function useForkStageReading() { return React.useSyncExternalStore(forkStageReading.subscribe, forkStageReading.get); }
if (typeof FORK_ICON_PATHS === "object" && !FORK_ICON_PATHS.film) FORK_ICON_PATHS.film = "M3.5 5.5h17v13h-17zM3.5 8.5h17M3.5 15.5h17M10.5 10.2v3.6l3.2-1.8z";

function ForkGalStage(props) {
    const h = React.createElement;
    const sessionId = props.sessionId;
    const runtime = useForkStageRuntime(sessionId);
    const partsMap = React.useMemo(() => new Map([...runtime.textIndex.values()].flatMap(row => (row.unloaded ? [{scope:'unloaded:' + row.turn,turn:row.turn,segments:[],unloaded:true}] : row.parts).map(part => [part.scope, part]))), [runtime.textIndex]);
    const config = props.data && props.data.config || { characters: [] };
    const [, redraw] = React.useState(0);
    React.useEffect(() => forkVoicePlayer.subscribe(() => redraw(n => n + 1)), []);
    const grouped = React.useMemo(() => forkGalTurnIndex(partsMap ? Array.from(partsMap.values()) : []), [partsMap]);
    // private fork: each grouped turn's text is hashed once, not on every render or skip tick.
    const turnDigests = React.useMemo(() => new WeakMap(), [grouped]);
    const turnDigest = value => { const parts = grouped.get(value) || []; let digest = turnDigests.get(parts); if (digest === undefined) turnDigests.set(parts, digest = forkGalTextDigest(parts)); return digest; };
    const turns = Array.from(runtime.textIndex.keys()).sort((a, b) => a - b);
    const latestTurn = runtime.latestSource?.turn || turns[turns.length - 1] || 0;
    if (latestTurn && !turns.includes(latestTurn)) turns.push(latestTurn);
    // The active session string does not change when an entry targets an already mounted stage.
    const entry = React.useSyncExternalStore(forkGalActive.subscribe, () => forkGalEntry && forkGalEntry.sessionId === sessionId ? forkGalEntry : null);
    const initial = React.useMemo(() => ({ saved: forkGalReadBookmark(sessionId), entry }), [sessionId]);
    const turn = runtime.source?.turn || latestTurn;
    const target = entry;
    const viewed = runtime.source;
    const resumeReady = true;
    const parts = grouped.get(turn) || [];
    const voiceAvailable = forkStageVoiceAvailable();
    const pages = runtime.text.pages.map(page => ({...page, para:page.anchor.para,
        voice:forkStageVoiceHandle(sessionId,page.voice,config,page.anchor.paragraphId,voiceAvailable)}));
    const turnIndex = turns.indexOf(turn);
    const [restored, setRestored] = React.useState(null);
    const restoreLoading = React.useRef(null);
    const [page, setPage, savedPosition, readState] = useForkStagePosition(sessionId,runtime,parts,pages,
        {restored:restored === sessionId, onSelect:() => setRestored(sessionId)});
    React.useLayoutEffect(() => {
        if (restored === sessionId) return;
        const saved = initial.saved;
        if (!initial.entry && saved && latestTurn < (saved.latestSeenTurn || saved.turn)) return;
        const selected = forkGalResumeTurn(saved,turns,initial.entry), row = runtime.textIndex.get(selected);
        if (row?.unloaded) {
            const key = sessionId + ':' + selected;
            if (restoreLoading.current !== key) {
                restoreLoading.current = key;
                void forkStageSessions.owner.navigate(sessionId,selected,saved?.page || 0,selected === latestTurn && !initial.entry,initial.entry?.para);
            }
            return;
        }
        if (!row) return;
        let textDigest = null;
        const digestOf = () => textDigest === null ? (textDigest = forkGalTextDigest(row.parts)) : textDigest;
        if (!forkGalPositionReady(initial.entry ? null : saved,selected,row.parts,row.text.pages,digestOf)) return;
        const index = initial.entry?.para ? row.text.pages.findIndex(page => page.anchor.para >= initial.entry.para) :
            forkGalRestorePosition(saved,selected,row.text.pages.length,digestOf(),row.text.pages).page;
        forkStageSessions.owner.navigate(sessionId,selected,Math.max(0,index || 0),selected === latestTurn && !initial.entry,initial.entry?.para);
        setRestored(sessionId);
    },[sessionId,runtime.textIndex,latestTurn,restored]);
    const [transition, setTransition] = React.useState(null);
    const transitioning = transition === turn;
    const playerInputs = useForkGalPlayerInputs(sessionId, props.choiceProps && props.choiceProps.useChat);
    const film = useForkStageFilm();
    const subtitles = useForkGalSubtitles(film, pages, page, sessionId + ":" + turn, config.stage && config.stage.theme);
    const card = subtitles.card;
    const lastCard = card >= subtitles.cards.length - 1;
    const [typed, setTyped] = React.useState(false);
    React.useLayoutEffect(function () { setTyped(false); }, [sessionId, turn, runtime.source?.generation]);
    const readingPage = transitioning ? { kind: "transition", para: pages[page]?.para || 1, text: playerInputs[turns[turnIndex + 1]] || "（这一轮没有可显示的玩家输入）" } : pages[page] || null;
    const streaming = parts.some(part => part.streaming);
    const atEnd = turn === latestTurn && !transitioning && !streaming && lastCard && page >= pages.length - 1 && (!readingPage || !readingPage.pending);
    const stageConfig = config.stage || {};
    const offstage = forkStageOffstage(config);
    const [sceneVisit, setSceneVisit] = React.useState(0);
    const [forwardReading, setForwardReading] = React.useState(false);
    const turnState = React.useRef(null);
    turnState.current = forkGalTurnState(turnState.current, sessionId, turn);
    // After a choice is sent, the old turn stays on screen until the reply starts streaming;
    // show the player's move and a "writing" state so the stage never looks stuck.
    const useSession = props.choiceProps && props.choiceProps.useSession;
    const running = useSession ? useSession(snapshot => snapshot.running === true) : false;
    // private fork: the system-menu action shares upstream settlement activity.
    const regenerationActivity = useTavernCoordination(sessionId, String(running) + ":" + latestTurn);
    // private fork (owner 2026-10): the worldbook prefilter yields to any other task and never blocks the player (as in
    // describeTavernActivity); counting it flipped 重新生成正文 on and off at every turn end.
    const regenerationBusy = regenerationActivity.view?.activity?.role !== "worldbook-filter" && (regenerationActivity.view?.activity?.busy || regenerationActivity.view?.activity?.phase === "pending");
    const awaitingText = forkGalAwaitingText(regenerationActivity.view?.activity);
    const bodyFailure = useForkStageSelector(sessionId, state => state.interrupted && state.cursor.mode !== 'history');
    const [waiting, setWaiting] = React.useState(null); // { turn, text, seen }
    const sending = Boolean(waiting && waiting.turn === turn) || (running && atEnd && !streaming);
    const receivedDirection = {...runtime.director, status:runtime.director.phase === 'partial' ? 'running' : runtime.director.phase};
    const regenerateBlocked = Boolean(!latestTurn || running || streaming || regenerationBusy || ["running", "partial"].includes(receivedDirection?.status));
    const directing = runtime.indicators.spinner;
    const entryKey = sessionId + ':' + sceneVisit;
    const accepted = runtime.accepted;
    const pack = {state:accepted.layout?.state || accepted.scene?.state, scene:accepted.scene, characters:accepted.figures || [],
        avatars:accepted.avatars || [], widgets:accepted.widgets || [],
        audio:{music:accepted.music,soundscape:accepted.ambience,sfx:[]}, core:accepted.layout?.core || accepted.scene?.core || ''};
    const rootRef = React.useRef(null);
    const entryGate = useForkGalEntry(runtime.store, rootRef);
    const sceneHolding = !entryGate.visible;
    const firstRun = useForkGalFirstRunHints(entryGate.visible, rootRef, turn + ':' + page);
    // private fork (perf r5): the page shown at the entry reveal; figures that finish loading while it is still the
    // page on screen fade in (the scene keeps snapping figures that were ready at the reveal).
    const entryPage = React.useRef(null);
    React.useEffect(function () {
        if (!waiting) return;
        if (waiting.turn !== turn) { setWaiting(null); return; }
        if (running && !waiting.seen) { setWaiting({ ...waiting, seen: true }); return; }
        if (!running && waiting.seen) { setWaiting(null); return; }
        // private fork: submit acknowledgement bookkeeping is not a presentation timer.
        if (!waiting.seen) { const timer = setTimeout(() => setWaiting(null), 15000); return () => clearTimeout(timer); }
    }, [waiting, running, turn, directing]);
    // The completed previous page must not hide the submit acknowledgement.
    // Once the new source has text it always wins, even without any direction.
    const awaiting = sending && !streaming || !readingPage && runtime.indicators.writing;
    // private fork (new-user journey 2026-10): the turn's wait is told in phases beside the stage spinner — 「正在写正文…」
    // while the body streams (the text box already says 「正在书写下一幕」 before its first page), then 「正在编排演出…」.
    const writingBody = Boolean(runtime.indicators.streaming) && !awaiting;
    const current = readingPage;
    const openingOnly = !current && atEnd && !awaiting && Boolean(runtime.source);
    const figureRecord = receivedDirection;
    const direction = receivedDirection;
    const [hidden, setHidden] = React.useState(false);
    const [auto, setAuto] = React.useState(false);
    // Skip is either latched (the SKIP control) or held (Ctrl down, like most galgames).
    const [skipLatch, setSkipping] = React.useState(false);
    const [skipHeld, setSkipHeld] = React.useState(false);
    const skipPossibleRef = React.useRef(false);
    const skipping = skipLatch || skipHeld;
    // Backlog (fork-gal-backlog.js): while open, auto and skip pause and the choices are hidden.
    const [backlog, setBacklog] = React.useState(false);
    const backlogClosedAt = React.useRef(0);
    React.useEffect(() => { forkUiSfx.preload(); }, []);
    // private fork: galgame UI cues (fork-ui-sfx.js) on the user-facing open / close paths only.
    function openBacklog() { forkLipSync.wake(); forkUiSfx.play("open"); setHidden(false); setBacklog(true); }
    function closeBacklog() { forkUiSfx.play("close"); backlogClosedAt.current = Date.now(); setBacklog(false); }
    // Config screen (fork-gal-config.js): pauses auto / skip like the backlog; closing returns focus to the opener.
    const [configOpen, setConfig] = React.useState(false);
    // private fork: gallery is a local modal, never a second stage cursor.
    const [galleryOpen,setGallery]=React.useState(false);
    // private fork (owner 2026-10): opened from the system menu's 回想 item (fork-gal-menu.js), not from the control row.
    function openGallery() { setHidden(false); setGallery(true); }
    const [sceneError, setSceneError] = React.useState(""); // private fork: shown in the notice stack, not over the HUD
    const configOpener = React.useRef(null);
    function openConfig(opener) { forkLipSync.wake(); forkUiSfx.play("open"); configOpener.current = opener || (typeof document !== "undefined" ? document.activeElement : null); setHidden(false); setConfig(true); }
    function closeConfig() {
        forkUiSfx.play("close"); backlogClosedAt.current = Date.now(); setConfig(false);
        const opener = configOpener.current; configOpener.current = null;
        if (opener && opener.focus) forkForeground.setTimeout(() => { if (opener.isConnected) opener.focus({ preventScroll: true }); }, 0);
    }
    // System menu (fork-gal-menu.js): Esc opens it; auto / skip pause like the backlog. Leaving system full screen
    // (the browser takes that Esc) opens it too, and closing it asks for full screen again.
    const [menuOpen, setMenu] = React.useState(false);
    // private fork (owner 2026-10): the turn-end menu's 「重新生成正文」 opens the menu straight into its 重新生成 dialog.
    const [menuRegenerate, setMenuRegenerate] = React.useState(false);
    const menuOpener = React.useRef(null);
    const menuFullscreen = React.useRef(false);
    function openRegenerate() { openMenu(false); setMenuRegenerate(true); }
    function openMenu(fullscreenLost) {
        forkLipSync.wake();
        setMenuRegenerate(false);
        menuOpener.current = typeof document !== "undefined" ? document.activeElement : null;
        menuFullscreen.current = Boolean(fullscreenLost);
        setHidden(false); setMenu(true);
    }
    function closeMenu() {
        backlogClosedAt.current = Date.now(); setMenu(false);
        if (!menuFullscreen.current) return;
        menuFullscreen.current = false;
        const root = typeof document !== "undefined" ? document.documentElement : null;
        if (root && root.requestFullscreen && !document.fullscreenElement) root.requestFullscreen().catch(() => {});
    }
    // private fork (owner 2026-10): the request opens the menu inside the host's fullscreenchange task (flushSync there),
    // so it lands in the first windowed frame. A store read + passive effect took two re-renders of the resized stage
    // (~130 ms): the window shrank, then the menu dimmed it a few frames later - a visible double flash.
    const menuRequestOpen = React.useRef(null);
    menuRequestOpen.current = function () { if (!menuOpen && !backlog && !configOpen && !galleryOpen) openMenu(true); };
    React.useLayoutEffect(() => forkGalMenuRequest.subscribe(() => menuRequestOpen.current()), []);
    const menuActions = {
        onClose: closeMenu,
        onBacklog() { closeMenu(); openBacklog(); },
        onGallery() { closeMenu(); openGallery(); },
        onConfig() { const opener = menuOpener.current; closeMenu(); openConfig(opener); },
        onLatest() { closeMenu(); jumpLatest(); },
        onKeys() { closeMenu(); firstRun.showKeys(); },
        // private fork (reading controls §2.4): phones reach these from the menu instead of the control row.
        onHide() { closeMenu(); setHidden(true); const root = rootRef.current; if (root && typeof root.focus === "function") root.focus({ preventScroll: true }); },
        onBack() { closeMenu(); input(-1); },
        onLeave() { menuFullscreen.current = false; setMenu(false); props.onExit(); }
    };
    const reading = useForkStageReading();
    const narrow = useForkGalNarrow(); // private fork (reading controls §2.4): fork-gal-menu.js
    const performanceLayer=useForkPerformanceLayer(rootRef,sessionId,reading);
    const defaultKey=JSON.stringify(stageConfig.defaultSkin);
    const projectedSkin=pack.scene?.skinDefault && JSON.stringify(pack.scene.skinDefault)!==defaultKey ? stageConfig.skin : pack.scene?.skin;
    const activeSkin = useForkStageSkin(rootRef, performanceLayer.skin || projectedSkin || stageConfig.skin, sessionId + ':' + turn + ':' + page, film, stageConfig.theme || 'classic', {defaultKey,fallback:stageConfig.skin,ready:Boolean(accepted.provenanceByChannel?.background),snap:runtime.cursor.mode === 'history' || skipping || !!(performanceLayer.skin && performanceLayer.snap)});
    useForkWidgetTheme(rootRef,pack.scene,activeSkin,{theme:stageConfig.theme || 'classic',snap:runtime.cursor.mode==='history' || skipping || performanceLayer.snap,reducedMotion:reading.reducedMotion});
    const sourceWidget = useForkWidgetStage({ sessionId, config, placeKey:props.data && props.data.cardPath, source:runtime.source, turn, pages, page, card, record:receivedDirection,
        widgets:[...(pack.widgets || []),...performanceLayer.widgets.map(widget=>({...widget,performance:true}))], assetRevision:accepted.presentationRevision,
        mode:runtime.cursor.mode, rootRef, avatarOf, enabled:true, film, revealed:typed && lastCard && !current?.pending,
        historyVoice:line=>forkStageVoiceHandle(sessionId,line.voice,config,line.anchor?.paragraphId),
        reducedMotion:reading.reducedMotion, paused:hidden || backlog || configOpen || galleryOpen || menuOpen || transitioning || awaiting || sceneHolding || Boolean(atEnd && typed && props.Choices),skipping,
        onPause:()=>{setAuto(false);setSkipping(false);} });
    const wheelGesture = React.useRef(null);
    React.useEffect(function () {
        if (typed && lastCard && current && !current.pending && !transitioning && !hidden && !backlog && !configOpen && !galleryOpen && !menuOpen && !sceneHolding) readState.markRead();
    }, [sessionId, turn, page, typed, lastCard, current && current.text, current && current.pending, transitioning, hidden, backlog, configOpen, galleryOpen, menuOpen, sceneHolding]);
    function selectTurn(nextTurn, nextPage, para, forward = false) {
        forkVoicePlayer.stop(undefined, true);
        setTransition(null);
        setForwardReading(forward);
        if (!forward) setSceneVisit(n => n + 1);
        const row = runtime.textIndex.get(nextTurn);
        const index = para ? row?.text.pages.findIndex(page => page.anchor.para >= para) : nextPage < 0 ? (row?.text.pages.length || 1) - 1 : nextPage;
        forkStageSessions.owner.navigate(sessionId,nextTurn,nextPage < 0 && row?.unloaded ? -1 : Math.max(0,index || 0),forward,para);
        setTyped(false);
    }
    const navigation = React.useRef(initial.entry && initial.entry.token || 0);
    const entryVisit = React.useRef(entry);
    React.useLayoutEffect(function () {
        if (entryVisit.current === entry) return;
        entryVisit.current = entry;
        if (!entry) return;
        setAuto(false); setSkipping(false); setHidden(false); setBacklog(false); setConfig(false); setMenu(false);
        selectTurn(entry.turn, 0, entry.para);
    }, [entry]);
    function jumpBack(target, targetTurn = turn, targetPara) {
        closeBacklog();
        if (awaiting && targetTurn === turn) return;
        setAuto(false); setSkipping(false);
        if (targetTurn !== turn || targetPara) { selectTurn(targetTurn, target, targetPara); return; }
        setTransition(null); setForwardReading(false); setSceneVisit(n => n + 1);
        const next = Math.max(0, Math.min(pages.length - 1, target));
        subtitles.select(next, 0); forkStageSessions.owner.navigate(sessionId,turn,next,false); setTyped(true);
    }
    // 「跳到最新一轮」: the latest turn's resume point (the furthest page read there), through the same navigation as a backlog jump.
    function jumpLatest() {
        if (turn === latestTurn || !latestTurn) return;
        setAuto(false); setSkipping(false);
        const resume = forkGalLatestResume(readState.readThrough, latestTurn, turnDigest(latestTurn));
        selectTurn(resume.turn, resume.page);
    }
    function go(delta, fromSkip) {
        forkLipSync.wake();
        if (awaiting || sceneHolding) return false;
        if (!fromSkip && skipLatch) { setSkipping(false); return; }
        if (!fromSkip && delta > 0 && current && !typed) { setTyped(true); return; } // first click finishes the line (a streaming one up to its stable end)
        if (transitioning || delta > 0 && lastCard && page >= pages.length - 1 || delta < 0 && card === 0 && page === 0) {
            const nextTurn = forkGalTurnStep(turns, turn, page, pages.length, delta, transitioning);
            if (!nextTurn) return false;
            if (nextTurn.transition) { setTransition(turn); setTyped(false); }
            else if (nextTurn.turn !== turn) selectTurn(nextTurn.turn, nextTurn.page, undefined, delta > 0);
            else { setTransition(null); setTyped(false); }
            return true;
        }
        const next = forkGalSubtitleStep(page, card, delta, subtitles.counts);
        if (next.page === page && next.card === card) return false;
        setForwardReading(delta > 0);
        if (delta < 0) setSceneVisit(n => n + 1);
        subtitles.select(next.page, next.card); setPage(next.page); setTyped(false);
        return true;
    }
    // Any manual input stops auto; any input while hidden only brings the box back.
    // private fork (reading controls §2.1, owner 2026-10): the box comes back first and a playing 文字演出 card keeps
    // playing; the next input ends the card. The input that stopped a fast-forward does only that (skipStopped).
    function input(delta) {
        if (hidden) { setHidden(false); return; }
        if (skipStopped.current) { skipStopped.current = false; return; }
        if (textcard.skip()) return; // private fork: input during a 文字演出 card ends the card (fork-textcard-stage.js)
        if (auto) setAuto(false);
        go(delta);
    }
    // The position one page turn ahead, for the read check (wheel and skip share it).
    function nextPosition() {
        const nextTurn = transitioning || lastCard && page >= pages.length - 1 ? turns[turnIndex + 1] : turn;
        return nextTurn ? { turn: nextTurn, page: nextTurn !== turn ? 0 : lastCard ? page + 1 : page,
            textDigest: nextTurn === turn ? readState.textDigest : turnDigest(nextTurn) } : null;
    }
    // Skip: rapid page turns without voice over text already read (galgame convention); it stops at
    // the first unread page, the latest written end or a pending paragraph.
    // private fork: a held Ctrl ends like the SKIP control, so nothing keeps the skip animation running
    // over a line that cannot advance (the latest read line flickered while Ctrl stayed down).
    function stopSkip() { setSkipping(false); setSkipHeld(false); }
    // private fork (reading controls §2.2, owner 2026-10): the SKIP control behaves like a held Ctrl — any key, click or
    // wheel stops it (the Ctrl hold effect below owns that for both), and that input is not also a page turn.
    const skippingRef = React.useRef(false);
    skippingRef.current = skipping;
    const skipStopped = React.useRef(false);
    const skipPossible = !atEnd && !(current && current.pending) && forkGalPageRead(readState.readThrough, nextPosition());
    skipPossibleRef.current = skipPossible;
    React.useEffect(function () {
        if (!skipping || awaiting || sceneHolding) return;
        if (atEnd || (current && current.pending)) { stopSkip(); return; }
        if (backlog || configOpen || galleryOpen || menuOpen) return;
        if (!forkGalPageRead(readState.readThrough, nextPosition())) { stopSkip(); return; }
        const timer = forkForeground.setTimeout(() => {
            go(1, true); setTyped(true);
        }, FORK_GAL_SKIP_PAGE_MS);
        return () => forkForeground.clearTimeout(timer);
    }, [skipping, turn, transitioning, page, card, subtitles.text, pages.length, backlog, configOpen, galleryOpen, menuOpen, awaiting, atEnd, sceneHolding]);
    React.useEffect(() => () => forkVoicePlayer.stop(),[sessionId]);
    // private fork (perf round 3): until the entry reveal only the current page is synthesized; the rest of the window
    // (each line a synthesis job polled every 150 ms) would hold the connections the reveal's figures load through.
    const voiceWindow = skipping || backlog || awaiting ? [] : !entryGate.visible ? (current && !current.pending && current.voice ? [current.voice] : []) : forkStageVoiceWindowFromIndex(sessionId,runtime.textIndex,turn,pages,page,config);
    React.useEffect(() => {
        for (const handle of voiceWindow) void handle.prefetch?.();
        forkVoicePlayer.prioritize(voiceWindow);
    },[sessionId,JSON.stringify(voiceWindow.map(handle=>[handle.owner,handle.id]))]);
    // Cached playback starts before paint; the outgoing line has a short fading tail.
    const voice = !sceneHolding && !sourceWidget.phoneBeat && current && current.voice;
    const player = forkVoicePlayer.get();
    const playingHere = Boolean(voice && player && player.owner === voice.owner && player.id === voice.id);
    function replay() {
        forkLipSync.wake();
        if (!voice) return;
        const now = forkVoicePlayer.get();
        if (playingHere && now && now.audio) { now.audio.currentTime = 0; now.audio.play().catch(() => {}); }
        else voice.click();
    }
    const [title, setTitle] = React.useState(null);
    const modPerformances=useForkModPerformances(sessionId,{live:runtime.cursor.mode === 'live',skipping,overlay:backlog||configOpen||galleryOpen||menuOpen||hidden,sourceKey:receivedDirection.token?.sourceKey,generation:receivedDirection.token?.generation,assetRevision:receivedDirection.assetRevision});
    const textcard=useForkTextcardStage({sessionId,reducedMotion:reading.reducedMotion,blocked:backlog||configOpen||galleryOpen||menuOpen||skipping});
    // Auto waits for each presentation's own clock; manual navigation still cancels immediately.
    const presentationBusy = textcard.busy || modPerformances.busy || !!title;
    // private fork (B4, O41): Auto waits for this paragraph's director prefix and says so; manual paging stays immediate.
    const awaitingDirection = runtime.indicators.awaitingDirection, autoHeld = auto && awaitingDirection && !writingBody;
    // Intermediate voiced cards follow the paragraph audio clock, not a new playback lease.
    const audioBusy = playingHere && (!player.audio || forkForeground.isPlaying(player.audio)) && !player.error;
    React.useEffect(function () {
        if (!auto || skipping || hidden || backlog || configOpen || galleryOpen || menuOpen || !typed || !current || current.pending) return;
        if (atEnd || presentationBusy || awaitingDirection) return;
        if (!lastCard && voice && audioBusy) {
            const timer = forkForeground.setInterval(function () {
                const now = forkVoicePlayer.get();
                const audio = now && now.owner === voice.owner && now.id === voice.id && now.audio;
                const target = audio && forkGalSubtitleVoiceTime(subtitles.cards, card, audio.duration);
                if (audio && !audio.paused && target !== null && audio.currentTime >= target) go(1, true);
            }, 80);
            return () => forkForeground.clearInterval(timer);
        }
        if (audioBusy) return;
        const timer = forkForeground.setTimeout(() => go(1, true), forkGalHandoffAutoDelay(forkGalAutoDelay(reading, Boolean(voice) && lastCard, !transitioning ? subtitles.text : current.text), handoff.heldMs));
        return () => forkForeground.clearTimeout(timer);
    }, [auto, skipping, hidden, backlog, configOpen, galleryOpen, menuOpen, typed, turn, transitioning, page, card, film, subtitles.text, lastCard, audioBusy, current && current.text, awaiting, reading.autoWait, reading.autoSpeed, atEnd, sceneHolding, presentationBusy, awaitingDirection]);
    // private fork (reading controls §2.1): a Space the stage took is not also a press of the focused control on keyup.
    const pressedSpace = React.useRef(false);
    React.useEffect(function () {
        function onKey(event) {
            // The Config screen and the system menu keep the keyboard (each closes itself on Esc).
            if (configOpen || galleryOpen || menuOpen) return;
            // private fork (reading controls §2.6): no stage key while an input method is composing.
            if (event.isComposing || event.keyCode === 229) return;
            // A held Esc (auto-repeat) is not a new press: it would toggle the menu on every repeat while the browser
            // waits for the hold that leaves full screen.
            if (event.key === "Escape" && event.repeat) { event.preventDefault(); return; }
            // An inner overlay (the choice editor, a widget reader, a popover) already took this Esc.
            if (event.key === "Escape" && event.defaultPrevented) return;
            const target = event.target;
            // The chat composer can retain/retake focus behind this portal. Only stage editors
            // own editing keys; an invisible composer must not disable Back or Escape.
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) && rootRef.current && rootRef.current.contains(target)) return;
            const key = event.key, letter = key.length === 1 && /[a-z]/i.test(key) ? key.toLowerCase() : "";
            const advance = key === " " || key === "Enter" || key === "ArrowRight" || key === "PageDown", back = key === "ArrowLeft" || key === "PageUp" || key === "Backspace";
            // private fork (reading controls §2.6): letter shortcuts leave Ctrl / Alt / Meta combinations to the browser
            // (Ctrl+A, Ctrl+R, Ctrl+L); a held key turns one page and toggles once (auto-repeat is ignored).
            if (letter && (event.ctrlKey || event.altKey || event.metaKey)) return;
            if (event.repeat && (advance || back || letter)) { if (advance || back) event.preventDefault(); return; }
            // A control the keyboard focused (Tab, :focus-visible) keeps its own Enter / Space; after a pointer click they
            // belong to the stage again (the control also hands focus back, see control()).
            if ((key === " " || key === "Enter") && target && target !== rootRef.current && typeof target.closest === "function" && target.closest("button, a[href], [role='button']") && rootRef.current && rootRef.current.contains(target) && typeof target.matches === "function" && target.matches(":focus-visible")) return;
            // The backlog keeps the keyboard (arrows / Page keys scroll it; Enter on a row jumps).
            if (backlog) {
                if (key === "Escape" || letter === "l") { event.preventDefault(); closeBacklog(); }
                return;
            }
            if (letter === "l") { event.preventDefault(); openBacklog(); return; }
            if (advance) { event.preventDefault(); if (key === " ") pressedSpace.current = true; input(1); }
            else if (back) { event.preventDefault(); input(-1); }
            else if (event.key === "Escape") {
                event.preventDefault();
                if (hidden) { setHidden(false); return; }
                if (sourceWidget.openKey) {sourceWidget.action(sourceWidget.openKey,'collapse');return;}
                // A modal dialog inside the stage (a widget's reader) closes itself first, even without focus.
                const root = rootRef.current;
                if (root && typeof root.querySelector === "function" && root.querySelector("[aria-modal='true']")) return;
                openMenu(false);
            }
            else if (letter === "h") setHidden(!hidden);
            else if (letter === "r") replay();
            // Like the AUTO control: turning auto on also ends a SKIP.
            else if (letter === "a") { if (!auto) setSkipping(false); setAuto(!auto); }
        }
        function onKeyUp(event) { if (event.key === " " && pressedSpace.current) { pressedSpace.current = false; event.preventDefault(); } }
        window.addEventListener("keydown", onKey);
        window.addEventListener("keyup", onKeyUp, true);
        return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKeyUp, true); };
    });
    // Hold Ctrl to fast-forward (released = stop). A short arm delay and cancelling on any other
    // key, click or wheel keep Ctrl shortcuts (copy, Ctrl+wheel reading size) from skipping.
    const skipHoldBlocked = configOpen || galleryOpen || menuOpen || backlog || hidden;
    React.useEffect(function () {
        if (skipHoldBlocked) { setSkipHeld(false); return; }
        let timer = 0;
        function cancel() { forkForeground.clearTimeout(timer); timer = 0; setSkipHeld(false); }
        // private fork (reading controls §2.2): any other key, click or wheel also stops a SKIP-control fast-forward, and
        // input() / wheel() drop that input instead of turning a page. The SKIP control's own press toggles it instead.
        function interrupt(event) {
            const own = event && event.type === "pointerdown" && event.target && typeof event.target.closest === "function" && event.target.closest("[data-fork-skip]");
            const running = skippingRef.current && !own;
            skipStopped.current = running;
            cancel();
            if (running) setSkipping(false);
        }
        function onDown(event) {
            if (event.key !== "Control") { interrupt(event); return; }
            if (event.repeat || timer || event.altKey || event.shiftKey || event.metaKey) return;
            const target = event.target;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            timer = forkForeground.setTimeout(() => { timer = 0; if (!skipPossibleRef.current) return; setAuto(false); setSkipHeld(true); }, 160);
        }
        function onUp(event) { if (event.key === "Control") cancel(); }
        function onHidden() { if (document.hidden) cancel(); }
        window.addEventListener("keydown", onDown, true);
        window.addEventListener("keyup", onUp, true);
        window.addEventListener("wheel", interrupt, true);
        window.addEventListener("pointerdown", interrupt, true);
        window.addEventListener("blur", cancel);
        document.addEventListener("visibilitychange", onHidden);
        return () => {
            forkForeground.clearTimeout(timer); setSkipHeld(false); skipStopped.current = false;
            window.removeEventListener("keydown", onDown, true);
            window.removeEventListener("keyup", onUp, true);
            window.removeEventListener("wheel", interrupt, true);
            window.removeEventListener("pointerdown", interrupt, true);
            window.removeEventListener("blur", cancel);
            document.removeEventListener("visibilitychange", onHidden);
        };
    }, [skipHoldBlocked]);
    const para = current && current.para || 1;
    function colorOf(alias) { const character = forkBubbleCharacter(config,alias); return character?.color || (alias ? forkBubbleColor(character) : ''); }
    const state = pack.state;
    const soundscapePlan = accepted.ambience;
    const [shot, setShot] = React.useState({key:'',n:0,acts:{},effects:[],emotes:[]});
    const [debugEmote, setDebugEmote] = React.useState(null);
    const cg = useForkCgStage(sessionId,runtime.store,{paused:backlog || configOpen || galleryOpen || menuOpen || sceneHolding,reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive,forward:forwardReading && !skipping});
    // The card's accent is its anchored line's speaker's 形象色, before or after that line.
    const textcardAccent = anchor => { const line = pages.find(row => row.anchor?.para === anchor?.para && row.kind === 'line'); const alias = line ? forkBubbleCharacter(config,line)?.alias : ''; return alias ? colorOf(alias) : ''; };
    const onPresented = useForkStageConsumers(sessionId,runtime.store,(effect,token) => {
        if (effect.kind === 'mod-performance' && textcard.accepts(effect.performance)) return textcard.play(effect,{accent:textcardAccent(token.anchor)});
        if (effect.kind === 'mod-performance') return modPerformances.play(effect,token);
        if (effect.kind === 'title') setTitle({text:effect.value,nonce:token.id});
        else if (['act', 'beat', 'emote'].includes(effect.kind)) setShot(old => ({key:turn + ':' + page,n:token.id,
            acts:effect.kind === 'act' ? {...old.acts,[effect.id]:effect.value} : old.acts,
            effects:effect.kind === 'beat' ? [{...effect,nonce:token.id}] : old.effects,
            emotes:effect.kind === 'emote' ? [{...effect,nonce:token.id}] : old.emotes}));
    },performanceLayer.accept,cg.accept,{play:modPerformances.play,cancel:intent=>{modPerformances.cancel(intent);textcard.cancel();}});
    React.useLayoutEffect(() => { runtime.store.dispatch({type:skipping ? 'SKIP_START' : 'SKIP_END',index:page}); },[skipping]);
    const moodList = forkBubbleMoodList(config, current ? forkBubbleCharacter(config, current)?.alias : undefined);
    // The DOM UI follows the scene (colour, flashes, vignette, grain, shake) through the stage root.
    React.useLayoutEffect(function () {
        const root = rootRef.current;
        if (!root || typeof document === "undefined") return;
        const opener = document.activeElement;
        root.focus({ preventScroll: true });
        // After the same commit uncovers the chat (ForkGalStageHost): focusing inside the still-covered
        // transcript would force its whole skipped layout first.
        return () => { queueMicrotask(() => { if (opener && opener.isConnected && opener.focus) opener.focus({ preventScroll: true }); }); };
    }, [sessionId]);
    const applyUi = React.useMemo(() => forkGalUiApplier(), []);
    const onUi = React.useCallback(frame => applyUi(rootRef.current, frame), [applyUi]);
    const track = accepted.music;
    // Dialogue aliases/names resolve to the same stable actor key as voice and pack figures.
    const speaker = current?.kind === 'line' ? forkBubbleCharacter(config,current)?.alias || '' : '';
    const audio = playingHere && player.audio ? player.audio : null;
    const renderInputs = new Map(pack.characters.map(figure => [figure.alias,packFigureRenderInputs(figure,{audio,speaking:figure.alias === speaker,skipping,voiceKey:turn+':'+page,sessionId})]));
    const shotHere = !awaiting && shot.key === turn + ':' + page;
    // private fork: reserve the full directed cast's slots while individual resources arrive.
    const members = state ? packStageMembers(state).filter(member => !!renderInputs.get(member.id)?.stage) : [];
    const xs = Object.fromEntries(members.map(member => [member.id,member.x]));
    const items = members.map(member => {
        const selected = pack.characters.find(figure => figure.alias === member.id), input = renderInputs.get(member.id).stage;
        return {...input,alias:member.id,x:member.x,speaking:member.id===speaker,light:member.light,color:colorOf(member.id),shade:packFigureShade(member.id,speaker,members,state?.camera),
            // private fork: reopening/restoring is not a new entrance (same policy as the background cut).
            visible:true,enter:forwardReading&&!skipping?'soft':'none',exit:'soft',gaze:forkGalGaze(member.gaze,member.x,xs),act:shotHere&&shot.acts[member.id]?{name:shot.acts[member.id],nonce:shot.n}:null,
            figureSizing:{pack:true,heightCm:selected.heightCm,version:1,source:selected.geometry.stage,sourceUrl:input.src,heightBasis:selected.heightBasis,outfitKey:selected.outfitKey,anatomy:selected.anatomy,assetScale:selected.anatomy?.assetScale ?? 1,elevationCm:selected.elevationCm}};
    });
    const quality = useForkStageQuality();
    const onStage = alias => members.some(member => member.id === alias);
    const sceneEffects = shotHere ? shot.effects.concat(shot.emotes.filter(effect => onStage(effect.id))) : [];
    const faceEmoteCue = shotHere ? shot.emotes.find(effect => !onStage(effect.id)&&effect.id===speaker) : null;
    const faceEmote = faceEmoteCue ? {kind:faceEmoteCue.value,color:colorOf(speaker),nonce:faceEmoteCue.nonce} : debugEmote;
    const layers = React.useMemo(() => createPackSceneLayers(),[]);
    const layeredScene=React.useMemo(()=>pack.scene && performanceLayer.look ? {...pack.scene,mood:performanceLayer.look} : pack.scene,[pack.scene,performanceLayer.look]);
    const packLayers = layeredScene ? layers(layeredScene) : null;
    if (entryGate.visible && entryPage.current === null) entryPage.current = turn + ':' + page;
    const scene = {presentationRevision:accepted.presentationRevision,figureScale:accepted.layout?.ruler || accepted.ruler,core:pack.core || '',quality,film,holding:false,visit:runtime.cursor.visitId,snap:!entryGate.visible || runtime.cursor.mode === 'history' || skipping,
        lateFade:entryGate.visible && !skipping && entryPage.current === turn + ':' + page,
        background:pack.scene?.backgroundUrl ? {identity:pack.scene.backgroundMedia.identity,url:pack.scene.backgroundUrl,scene:JSON.stringify(pack.scene.background),transition:forwardReading&&!skipping?(pack.scene.transition || 'fade'):'cut'} : null,
        hideFigures:!!accepted.cg || cg.visible,figuresAway:sourceWidget.phoneOpen,figures:items,packLayers,grade:packLayers?JSON.stringify([packLayers.time,packLayers.mood]):'',timeFadeMs:pack.scene?.timeTransitionMs || 0,
        weather:state?.weather || 'none',camera:{shot:state?.camera.mode || '',target:state?.camera.actor || ''},dof:state?.dof,effects:sceneEffects,skipping,preload:[],
        animatedUi:Boolean(speaker || stageConfig.widgets || !typed || title || faceEmote)};
    const displayScene = scene;
    function onSceneDebug(effect) {
        if (effect.op === "title") setTitle({ text: effect.value, nonce: "debug:" + Date.now() });
        else if (effect.op === "emote") { const kind = forkGalEmoteName(effect.value); if (kind) setDebugEmote({ id: effect.id, kind, color: effect.color || colorOf(effect.id), nonce: effect.nonce }); }
    }
    const place = pack.scene?.backgroundName || '';
    // private fork: accepted CG suppresses the face DOM through the complete exit handoff.
    const faceMode = film || accepted.cg || cg.visible ? 'off' : 'always';
    // private fork (owner 2026-10): a phone line is read in the phone; the dialogue box stays up and keeps the last line read
    // outside the phone (no blank, no hide, no face handoff). The phone line still types through a hidden reader, which
    // drives the phone's reveal, AUTO and the next-page cue exactly as before.
    const phoneLine = Boolean(sourceWidget.phoneLine && current && !transitioning && !awaiting);
    const heldBox = React.useRef(null);
    let boxIndex = page;
    if (phoneLine) { boxIndex = -1; for (let i = page - 1; i >= 0; i--) if (!forkPhoneBeat(receivedDirection, pages[i]?.para)) { boxIndex = i; break; } }
    const boxLine = !phoneLine ? current : boxIndex >= 0 ? pages[boxIndex] : heldBox.current && heldBox.current.turn < turn ? heldBox.current.line : null;
    if (!phoneLine && current && !transitioning && !current.pending) heldBox.current = { turn, line: current };
    const boxSpeaker = phoneLine ? (boxLine?.kind === 'line' ? forkBubbleCharacter(config,boxLine)?.alias || '' : '') : speaker;
    const boxMoodList = phoneLine ? forkBubbleMoodList(config, boxLine ? forkBubbleCharacter(config, boxLine)?.alias : undefined) : moodList;
    const portraits = new Map(pack.avatars.map(figure => [figure.alias,packFigureRenderInputs(figure,{audio,speaking:figure.alias === speaker,skipping,sessionId}).face]));
    const portraitFace = !film && speaker ? portraits.get(speaker) || null : null;
    const boxFace = phoneLine ? (!film && boxSpeaker ? portraits.get(boxSpeaker) || null : null) : portraitFace;
    // private fork (owner rule 「可以有 fallback，不能静默掩盖缺图」): a cast figure is never dropped silently. A sprite outfit
    // without any image stands in as its avatar (its slot), and every display fallback is listed in the stage notice.
    const castMembers = state ? packStageMembers(state) : [];
    const standIns = castMembers.filter(member => !renderInputs.get(member.id)?.stage && portraits.get(member.id)?.src && packSpriteStandIn(pack.characters.find(figure => figure.alias === member.id)));
    const spriteFallbacks = useForkGalSpriteFallbacks(sessionId, packSpriteFallbacks(pack.characters, alias => castMembers.some(member => member.id === alias), alias => !!portraits.get(alias)?.src));
    // private fork (new-user journey 2026-10): the host projected an on-stage Live2D figure down to its sprite (no Core).
    const live2dMissing = pack.characters.some(figure => figure.diagnostics?.includes('live2d-core-missing') && castMembers.some(member => member.id === figure.alias));
    const live2dRequest = React.useCallback((method, args) => rpc(method, args, sessionId), [sessionId]);
    // private fork: the gutter is latched per page (useForkGalFaceColumn); the classic theme only shows a face
    // in a page that reserved its column (other themes always reserve it via .has-face).
    const pageKey = turn + ":" + page + ":" + card + (transitioning ? ":transition" : "");
    // A phone line keeps the held line's page key, so the box's face and gutter do not change hands.
    const boxPageKey = !phoneLine ? pageKey : heldBox.current && boxLine === heldBox.current.line ? heldBox.current.key : turn + ":" + boxIndex + ":held";
    if (!phoneLine && heldBox.current && heldBox.current.line === current) heldBox.current.key = pageKey;
    const facing = useForkGalFaceColumn(sessionId, boxPageKey, boxSpeaker, portraits, config.characters, faceMode !== "off");
    const face = facing || (stageConfig.theme || "classic") !== "classic" ? boxFace : null;
    // private fork: face → no-face pages clear the face before writing (useForkGalFaceHandoff). Only the classic column
    // follows the gutter; the other themes keep one inset. Skip and backward reading show the final state at once.
    const faceSnap = skipping || !forwardReading;
    const calmMotion = reading.reducedMotion === true || typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    const handoff = useForkGalFaceHandoff(sessionId + ":" + boxPageKey, { facing, shown: Boolean(face && face.src), moves: (stageConfig.theme || "classic") === "classic" && faceMode !== "off", snap: faceSnap || !!accepted.cg || cg.visible, calm: calmMotion, typed });
    function avatarOf(entry) { return portraits.get(forkBubbleCharacter(config, entry)?.alias) || null; }
    function nameOf(alias) { const character = forkBubbleCharacter(config,alias); return character && character.name || ""; }
    const color = speaker ? colorOf(speaker) : "";
    const boxColor = boxSpeaker ? colorOf(boxSpeaker) : "";
    const name = current && current.kind === "line" ? forkBubbleDisplayName(current, config) : "";
    const boxName = !phoneLine ? name : boxLine && boxLine.kind === "line" ? forkBubbleDisplayName(boxLine, config) : "";
    const voiceError = (playingHere ? player.error : null) || forkVoicePlayer.getError(voice);
    const voiceState = voiceError ? "error" : playingHere ? (player.audio ? (player.audio.paused ? "paused" : "playing") : "loading") : voice ? "ready" : "";
    // Classic theme (the default): the name is the box's first line (【名字】), spoken lines read 「…」, the side
    // image rises out of the box's left end. Every theme puts the replay button right after the name.
    const theme = stageConfig.theme || "classic";
    const classic = theme === "classic";
    useForkFigureTextContrast(React,rootRef,true,theme,film,boxColor,boxName,boxLine?.mood);
    const shownText = current ? (transitioning ? current.text : !film && classic && current.kind === "line" ? forkGalQuoted(subtitles.text, current.pending) : subtitles.text) : "";
    const heldText = boxLine ? (classic && boxLine.kind === "line" ? forkGalQuoted(boxLine.text, false) : boxLine.text) : "";
    // The opaque phone forwards wheel input to this same stage gesture owner.
    function wheel(event) {
        if (backlog || configOpen || galleryOpen || menuOpen || Date.now() - backlogClosedAt.current < 450) return;
        if (skipStopped.current) { skipStopped.current = false; return; } // private fork: this notch only stopped a fast-forward
        if (event.deltaY > 0 && !hidden && textcard.skip()) return; // private fork: hidden → the box comes back first
        const next = nextPosition();
        const decision = forkGalWheelDecision(wheelGesture.current, { now: Date.now(), deltaY: event.deltaY, deltaMode: event.deltaMode, typed, hidden, next, readThrough: readState.readThrough });
        wheelGesture.current = decision.state;
        if (decision.action === 'backlog') openBacklog();
        else if (decision.action === 'advance-read') { setAuto(false); setSkipping(false); go(1, true); }
        else if (decision.action !== 'none') input(1);
    }
    // Mixer and Config: what plays on each layer, and cheap previews (a short built-in one-shot, the current voice line).
    const ambienceNames = (soundscapePlan?.layers || []).map(layer => layer.name || layer.id);
    const mixNames = { music: track ? track.name : "", ambience: ambienceNames.join(" + ") };
    const testSfx = pack.audio?.sfx[0]?.url;
    const mixTests = { voice: voice ? replay : null, sfx: testSfx ? () => forkStageSfx.play(testSfx) : null };
    const backDisabled = turnIndex <= 0 && page === 0 && card === 0 && !transitioning;
    // private fork: data-reduced-motion mirrors CONFIG 「减少动态」 for CSS-only theme motion (the crt power-on/blink).
    return h("div", { ref: rootRef, tabIndex: -1, className: "fork-gal-stage" + (film ? " is-film" : "") + (backlog ? " is-backlog" : "") + (configOpen ? " is-config" : "") + (menuOpen ? " is-menu" : "") + (textcard.up ? " is-textcard" : ""), "data-theme": theme, "data-entry": entryGate.phase, "data-reduced-motion": reading.reducedMotion === true || undefined, "data-cg-visible": !!accepted.cg || cg.visible || undefined, "data-phone-open": sourceWidget.phoneOpen || undefined, "data-fk-context": "stage-" + theme, "data-speaking": speaker ? "true" : "false", "data-fork-stage-turn": turn, "data-fork-stage-para": para,
        onClick: event => { if (galleryOpen || menuOpen || event.target.closest("button, a, input, textarea, select")) return; input(1); },
        // private fork: conventional galgame wheel: up opens the log, down advances.
        // A gesture that just closed the backlog does not also turn pages.
        onWheel: wheel,
        onContextMenu: event => { event.preventDefault(); if(galleryOpen)return; if (hidden) setHidden(false); else setHidden(true); } },
        h(ForkGalScene, { onPresented:revision => { entryGate.onPresented(revision); if (entryGate.visible) onPresented(revision); }, onBackdrop:entryGate.onBackdrop, scene: displayScene, onDebug: onSceneDebug, onUi, onError: setSceneError }),
        !accepted.cg && !cg.visible && standIns.length ? h(ForkGalStandIns, { members: standIns, portraits, colorOf }) : null,
        cg.node,
        // private fork (item showcase B1): the item glow takes the speaker's 形象色.
        modPerformances.node && React.cloneElement(modPerformances.node,{accent:color || undefined}),
        h(ForkModStageLayers,{sessionId,sourceKey:receivedDirection.token?.sourceKey,stage:{title:props.data?.cardName,turn,latestTurn,scene:place,bgm:track?.name}}),
        textcard.node,
        stageConfig.items===true ? h(ForkItemPerformance,{key:sessionId,sessionId,enabled:true,accent:color || undefined,turn,para:current?.pending ? null : current?.para,page,live:runtime.cursor.mode!=='history',skipping,overlay:backlog||configOpen||galleryOpen||menuOpen||hidden,sourceKey:receivedDirection.token?.sourceKey,generation:receivedDirection.token?.generation}) : null,
        h(ForkGalEntryOverlay, {phase:entryGate.phase}),
        h("div", {className:"fork-gal-scene-hold" + (entryGate.visible ? " is-resolved" : ""), "aria-hidden":true}),
        h(ForkGalWidgets,{owner:sourceWidget,onBacklog:openBacklog,onAdvance:()=>input(1),onWheel:wheel}),
        sourceWidget.claim ? h('div', { className: 'fork-widget-source-controls', role: 'toolbar', 'aria-label': '模组演出控制', onClick: event => event.stopPropagation() },
            control('auto', auto ? '停止自动（A）' : '自动翻页（A）', () => { setSkipping(false); setAuto(!auto); }, auto),
            control('skip', skipLatch ? '停止跳过' : '跳过已读（按住 Ctrl 快进）', () => { setAuto(false); setSkipping(!skipLatch); }, skipping, atEnd),
            control('backlog', '履历（L）', openBacklog), h(ForkGalConfig, { open: configOpen, onOpen: openConfig }), menuButton(),
            control('chat', '返回主页面', props.onExit), h('button', { type: 'button', className: 'fork-gal-control', onClick: () => input(1) }, '继续')) : null,
        h("svg", { className: "fork-gal-look-defs", "aria-hidden": true, width: 0, height: 0, focusable: "false" },
            h("filter", { id: "fork-gal-look-ui", colorInterpolationFilters: "sRGB", filterUnits: "userSpaceOnUse", x: "-640", y: "-640", width: "5200", height: "3400" }, h("feColorMatrix", { type: "matrix", values: "1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 1 0" }))),
        h("div", { className: "fork-gal-letterbox", "aria-hidden": true }, h("i"), h("i")),
        h("div", { className: "fork-gal-topbar", onClick: event => event.stopPropagation() },
            h("div", { className: "fork-gal-topleft" },
                h("span", { className: "fork-gal-history-indicator", "data-historical": turn !== latestTurn }, "第 " + turn + " / " + latestTurn + " 轮"),
                turn !== latestTurn && receivedDirection && receivedDirection.status !== "done" ? h("div", { className: "fork-gal-history-direction", "data-state": receivedDirection.status, "aria-live": "polite" },
                    receivedDirection.status === "running" ? h("span", { className: "fork-gal-history-direction-progress", role: "status" }, "演出生成中…") :
                        h("button", { type: "button", className: "fork-gal-generate-turn", onClick: () => rpc('retryStageDirection',{turn},sessionId).then(() => runtime.store.dispatch({type:'DIRECTOR_WAKE'})) }, "为这一轮生成演出"),
                    receivedDirection.status === "error" ? h("span", { className: "fork-gal-history-direction-error", role: "alert" }, stageDiagnosticText(stageRuntimeErrorText(receivedDirection.error)) || "演出生成失败，请重试") : null) : null,
                h(ForkBgmStage, { sessionId, place, live: runtime.cursor.mode !== 'history' && !skipping }), // private fork: fork-bgm-player.js
                h(ForkGalMixer, { names: mixNames })), // private fork: fork-gal-mixer.js
            h("div", { className: "fork-gal-topright" },
                h(ForkWidgetMenu,{owner:sourceWidget}),
                Object.entries(FORK_STAGE_QUICK_ENTRIES).map(([modId, Component]) => h(Component, {key:modId, rpc, sessionId})),
                h("button", { type: "button", className: "fork-gal-film", "aria-pressed": film, title: "电影模式", "aria-label": film ? "电影模式（已开启，点击关闭）" : "电影模式（点击开启）",
                    onClick: event => { forkStageFilm.set(!film); refocusStage(event); } }, h(ForkIcon, { name: "film", size: 16 })),
                h("button", { type: "button", className: "fork-gal-quality", "data-quality": quality, title: quality === "low" ? "特效：低" : "特效：高", "aria-label": quality === "low" ? "特效：低（点击切换为高）" : "特效：高（点击切换为低）",
                    onClick: event => { forkStageQuality.set(quality === "low" ? "high" : "low"); refocusStage(event); } }, h(ForkIcon, { name: "sparkle", size: 16 })),
                h("button", { type: "button", className: "fork-gal-quit", title: "返回主页面", "aria-label": "返回主页面", onClick: props.onExit }, h(ForkIcon, { name: "close", size: 16 })))),
        (directing || autoHeld || writingBody || firstRun.keys || firstRun.sound || runtime.indicators.loading || runtime.indicators.error || runtime.indicators.drops?.length || accepted.scene?.diagnostics?.length || sceneError || cg.notice || spriteFallbacks.length || live2dMissing) ?
            h(ForkGalRuntimeStatus, { busy: directing || autoHeld ? 'direct' : runtime.indicators.loading ? 'load' : writingBody ? 'write' : null, hints: firstRun, bodyFailure, error: runtime.indicators.error, drops: runtime.indicators.drops, diagnostics: accepted.scene?.diagnostics, sceneError, cgNotice:cg.notice, spriteFallbacks, nameOf,
                live2dRequest: live2dMissing ? live2dRequest : null }) : null,

        awaiting ? h("div", { className: "fork-gal-box is-awaiting", role: "status", "aria-label": awaitingText },
            activeSkin ? h(ForkStageSkinFrame,{skin:activeSkin}) : h(ForkGalBoxFrame),
            waiting && waiting.text ? h("div", { className: "fork-gal-sent" }, h(ForkIcon, { name: "chevron", size: 14 }), h("span", null, waiting.text)) : null,
            h("div", { className: "fork-gal-text fork-gal-writing" }, h("span", null, awaitingText), h("span", { className: "fork-gal-typing", "aria-hidden": true }, h("i"), h("i"), h("i"))),
            h("div", { className: "fork-gal-progress", "aria-hidden": true })) :
        h("div", { className: "fork-gal-box" + (sourceWidget.claim ? " is-source-widget-line" : "") + (transitioning ? " fork-gal-transition" : "") + (boxLine && boxLine.kind === "narration" ? " is-narration" : "") + (hidden ? " is-hidden" : "") + (skipping ? " is-skipping" : "") + (boxLine && boxLine.thought ? " is-thought" : "") + (phoneLine ? " is-phone-held" : "") + (faceMode !== "off" ? " has-face" : "") + (facing ? " is-facing" : ""), style: { "--bubble-color": boxColor || "var(--fork-accent)" }, 'data-figure-skip-color':boxColor, role: "region", "aria-label": "舞台文本", "aria-hidden": sourceWidget.claim || undefined },
            activeSkin ? h(ForkStageSkinFrame,{skin:activeSkin}) : h(ForkGalBoxFrame),
            // private fork: every theme shares the bottom-aligned sprite face window.
            faceMode !== "off" ? h(ForkGalSide, { face, emote: faceEmote, snap: faceSnap || handoff.cut, calm: calmMotion, clearMs: forkGalFaceClearMs(calmMotion) }) : null,
            phoneLine ? (boxName ? h(ForkGalNamePlate, { name: boxName, mood: forkBubbleMoodLabel(boxLine.mood, boxMoodList, config, boxSpeaker), classic, film, voiceState: "", voiceError: null, onReplay: replay }) : null) :
            name ? h(ForkGalNamePlate, { name, mood: forkBubbleMoodLabel(current.mood, moodList, config, speaker), classic, film, voiceState, voiceError, onReplay: replay }) : null,
            transitioning ? h("div", { className: "fork-gal-transition-label" }, "你 · 第 " + turns[turnIndex + 1] + " 轮") : null,
            h("div", { ref: subtitles.textRef, className: "fork-gal-text", "aria-live": phoneLine ? "off" : "polite" },
                phoneLine && boxLine ? h(ForkGalTypewriter, { key: "held:" + boxPageKey, text: heldText, speed: reading.textSpeed, skin: activeSkin, instant: true, reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive }) : null,
                current ? h(phoneLine ? "span" : React.Fragment, phoneLine ? { className: "fork-gal-phone-reader", "aria-hidden": true } : null, h(ForkGalTypewriter, { key: sessionId + ":" + turn + ":" + page + ":" + card + (transitioning ? ":transition" : ""), text: shownText, speed: reading.textSpeed, skin: activeSkin, instant: typed, hold: handoff.holding || textcard.busy, pending: current.pending,reducedMotion:reading.reducedMotion,photosensitive:reading.photosensitive,
                    visibleKey:sourceWidget.readingKey,onVisible:value=>sourceWidget.onVisible(Array.from(current.text).slice(0,subtitles.cards[card]?.start || 0).join('') + value.slice(Math.max(0,shownText.indexOf(subtitles.text)),Math.max(0,shownText.indexOf(subtitles.text))+subtitles.text.length)),
                    onReveal:ordinal=>performanceLayer.cue({cueId:'type',ordinal:[page,card,ordinal]}), onDone: () => setTyped(true) }))
                    : h("span", { className: "fork-gal-waiting" }, streaming ? "……" : "还没有正文"),
                current && current.pending && !phoneLine ? h("span", { className: "fork-gal-typing", "aria-label": "正在生成" }, h("i"), h("i"), h("i")) : null,
                // private fork: the next-page cue is laid out with the page from its first frame and only shown when
                // typed, so its arrival cannot re-wrap the last line (fork-theme.css "stage typewriter").
                current && !current.pending ? h("span", { className: "fork-gal-next" + (activeSkin?.cursor ? " fork-skin-next" : "") + (typed && !atEnd ? "" : " is-waiting"), "aria-hidden": true }, activeSkin?.cursor ? h(ForkStageSkinCursor,{cursor:activeSkin.cursor,active:typed&&!atEnd,snap:runtime.cursor.mode==='history'||skipping}) : null) : null),
            // private fork (reading controls §2.4, owner 2026-10): film mode shows the page count briefly on each page turn
            // (the keyed node restarts its CSS fade); hover still shows it in full.
            h("div", { key: film ? "flash:" + pageKey : "meta", className: "fork-gal-meta" + (film ? " is-flash" : "") },
                h("span", null, pages.length ? (page + 1) + " / " + pages.length + (streaming ? "+" : "") : "")),
            // private fork (reading controls §2.4): phones show only forkGalControlIds(true); the rest is in the menu.
            h("div", { className: "fork-gal-controls", role: "toolbar", "aria-label": "舞台控制", "data-compact": narrow || undefined },
                forkGalControlIds(narrow).map(id =>
                    id === "auto" ? control("auto", auto ? "停止自动（A）" : "自动翻页（A）", () => { setSkipping(false); setAuto(!auto); }, auto) :
                    id === "skip" ? control("skip", skipLatch ? "停止跳过" : "跳过已读（按住 Ctrl 快进）", () => { setAuto(false); setSkipping(!skipLatch); }, skipping, atEnd) :
                    id === "eye-off" ? control("eye-off", "隐藏文本框（H / 右键）", () => setHidden(true)) :
                    id === "chevron-left" ? control("chevron-left", "上一页（左箭头 / PageUp）", () => input(-1), undefined, backDisabled) :
                    id === "backlog" ? control("backlog", "履历（L）", openBacklog) :
                    id === "config" ? h(ForkGalConfig, { key: id, open: configOpen, onOpen: openConfig }) : // private fork: fork-gal-config.js
                    // private fork (owner 2026-10): ≡ opens the system menu for touch and mouse too; Esc still opens it.
                    id === "menu" ? menuButton() :
                    control("chat", "返回主页面", props.onExit)))),
        // Reading done: the next move sits in the middle of the screen.
        // private fork (O13): a latest turn with nothing to read (an HTML introduction / opening chooser) is done too: the
        // panel offers 生成选项 and 自由输入 (no 重新生成正文); leaving is the existing 返回主页面 (R13).
        atEnd && (typed || openingOnly) && !hidden && props.Choices ? h(props.Choices, Object.assign({}, props.choiceProps, { key: sessionId + ":" + turn, sessionId, atEnd, hidden: awaiting,
            // private fork (owner 2026-10): 重新生成正文 — the same busy rule as the system menu's 重新生成 item.
            onRegenerate: props.Regenerate && !openingOnly ? openRegenerate : undefined, regenerateDisabled: regenerateBlocked,
            onSending: text => { setAuto(false); setWaiting({ turn, text: String(text || ""), seen: false }); },
            onSendFailed: () => setWaiting(null) })) : null,
        galleryOpen ? h(ForkCgGallery,{key:sessionId,sessionId,store:runtime.store,onClose:()=>{setGallery(false);backlogClosedAt.current=Date.now();}}) : null,
        configOpen ? h(ForkGalConfigScreen, { sessionId, data: props.data, names: mixNames, tests: mixTests, onClose: closeConfig }) : null,
        menuOpen ? h(ForkGalMenu, Object.assign({ sessionId, Regenerate: props.Regenerate, regenerate: menuRegenerate, historical: turn !== latestTurn, latestTurn,
            busy: regenerateBlocked, narrow, backDisabled }, menuActions)) : null,
        backlog ? h(ForkGalBacklog, { sessionId, config, direction:receivedDirection, readDirection:args=>rpc('getStageDirection',args,sessionId), textIndex:runtime.textIndex, voiceOf:descriptor => forkStageVoiceHandle(sessionId,descriptor,config,descriptor.paragraphId), turn, pages, page, useChat: props.choiceProps && props.choiceProps.useChat, colorOf, avatarOf, nameOf, quote: classic && !film, onJump: jumpBack, onClose: closeBacklog }) : null,
        title ? h(ForkGalTitle, { key: title.nonce, title, onDone: () => setTitle(null) }) : null);
    // private fork (owner 2026-10): ≡ opens the system menu; its own Enter / Space must not also turn the page.
    function menuButton() {
        return h("button", { key: "menu", type: "button", className: "fork-gal-control fork-gal-menu-toggle", title: "菜单", "aria-label": "菜单", "aria-haspopup": "menu", "aria-expanded": menuOpen,
            onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); },
            onClick: event => { event.stopPropagation(); openMenu(false); } }, h(ForkIcon, { name: "menu", size: 17 }));
    }
    function control(icon, label, action, active, disabled) {
        return h("button", { key: icon, type: "button", className: "fork-gal-control" + (active ? " is-active" : ""), title: label, "aria-label": label, "aria-pressed": active === undefined ? undefined : Boolean(active), disabled: Boolean(disabled),
            "data-fork-skip": icon === "skip" || undefined,
            onClick: event => { event.stopPropagation(); action(); refocusStage(event, icon === "eye-off"); } }, h(ForkIcon, { name: icon, size: 17 }));
    }
    // private fork (reading controls §2.1, owner 2026-10): a pointer click leaves focus on the button, where the next Space
    // or Enter would press it again (the hide button re-hid the box). Pointer clicks hand focus back to the stage root;
    // keyboard presses keep it, except hiding, whose button is no longer on screen.
    function refocusStage(event, always) {
        const root = rootRef.current;
        if ((always || event && event.detail > 0) && root && typeof root.focus === "function") root.focus({ preventScroll: true });
    }
}

// private fork: the text column (is-facing gutter) is decided once per page, when it opens, from what is known
// synchronously: the face window is on, the page is a spoken line, and the speaker has a face (the accepted
// portraits, else what this session already learned, else "is a configured character"). Portrait loading never
// moves it mid-page: a face that arrives later fades into the reserved window; one that turns out missing leaves
// the gutter empty until the page ends. Narration stays full width.
function useForkGalFaceColumn(sessionId, pageKey, speaker, portraits, characters, enabled) {
    const memory = React.useRef(null), latch = React.useRef(null);
    if (!memory.current || memory.current.sessionId !== sessionId) memory.current = { sessionId, faces: new Map() };
    for (const [alias, face] of portraits) memory.current.faces.set(alias, Boolean(face));
    const key = JSON.stringify([sessionId, pageKey, speaker, Boolean(enabled)]);
    if (!latch.current || latch.current.key !== key) {
        const known = memory.current.faces.get(speaker);
        latch.current = { key, facing: Boolean(enabled && speaker && (known ?? (characters || []).some(character => character && character.alias === speaker))) };
    }
    return latch.current.facing;
}
// private fork: face handoff between pages (docs/fork/textbox-face-transition.md). The classic text column follows
// the face gutter, so a page that drops the gutter (a faced line followed by narration, a faceless line or a
// close-up) would start writing where the previous face still stands. The new page is laid out at once (no reflow),
// the face clears in clearMs and only then does the first glyph appear: text never shares the screen with a face it
// would run under. A page that gains the gutter does not wait (the face slides into reserved space beside the text).
// Skip, page back / jumps and reopening snap (no hold, no animation); a click during the hold shows the page and
// cuts the face at once. Reduced motion keeps the order with a shorter, plain fade.
// The clear animation (fork-theme.css fork-gal-side-clear) and the text hold: the hold adds two frames so the face
// is gone even when its animation started a frame after the page committed.
const FORK_GAL_FACE_CLEAR_MS = 120, FORK_GAL_FACE_CLEAR_CALM_MS = 90, FORK_GAL_FACE_HOLD_MARGIN_MS = 32;
function forkGalFaceClearMs(calm) { return calm ? FORK_GAL_FACE_CLEAR_CALM_MS : FORK_GAL_FACE_CLEAR_MS; }
// previous: the page shown before ({ facing, shown }), next: { facing, moves (the column follows the gutter), snap, calm }.
function forkGalFaceHold(previous, next) {
    if (!previous || !next || next.snap || !next.moves) return 0;
    return previous.facing && previous.shown && !next.facing ? forkGalFaceClearMs(next.calm) + FORK_GAL_FACE_HOLD_MARGIN_MS : 0;
}
// Auto mode: a held page's wait is shortened by the hold, so auto pacing per page stays as without the handoff.
function forkGalHandoffAutoDelay(delay, heldMs) { return Math.max(0, delay - (heldMs || 0)); }
// Returns { holding (typewriter waits), cut (the outgoing face must go now), heldMs (for auto pacing) }.
function useForkGalFaceHandoff(pageKey, { facing, shown, moves, snap, calm, typed }) {
    const ref = React.useRef(null), [, setReleased] = React.useState(0);
    if (!ref.current || ref.current.key !== pageKey) {
        const hold = forkGalFaceHold(ref.current, { facing, moves, snap, calm });
        ref.current = { key: pageKey, facing, shown, hold, released: !hold };
    }
    const current = ref.current;
    // What this page shows last is what the next page hands off from (a late face counts, a lost one does not).
    current.shown = Boolean(shown);
    React.useEffect(function () {
        if (current.released) return;
        const timer = forkForeground.setTimeout(() => { current.released = true; setReleased(n => n + 1); }, current.hold);
        return () => forkForeground.clearTimeout(timer);
    }, [current]);
    return { holding: !current.released && !typed && !snap, cut: current.hold > 0 && Boolean(typed || snap), heldMs: current.hold };
}
// private fork: localized, theme-matching runtime notices (docs/fork/panel-ui-design.md). Display only;
// they stack under the top-right controls, clear of the place/music HUD; Chinese failure details stay under 详情. No reassurance\n// subtitles (panel-ui-design.md §一.5): a short title is the whole notice.
// Scene diagnostics are internal: only the 调试视图 (body.dsh-fork-debug) shows them.
const FORK_GAL_DIAGNOSTIC_TEXT = { 'legacy-media-reconstructed': '旧存档未记录素材版本，已按当前素材重建' };
const FORK_GAL_DEBUG_HOWTO = '打开「设置 › DSH Tavern › 调试视图」，这里会显示具体原因。';
// private fork (new-user journey 2026-10): with the shared display preference in scope (features/settings.js) the line is
// one action instead — 「打开调试视图」 turns the same switch on, and the technical line shows in place.
const FORK_GAL_DEBUG_PREFS = () => typeof displayPreferences === 'object' && displayPreferences && typeof displayPreferences.save === 'function' ? displayPreferences : null;
// private fork (owner rule 「可以有 fallback，不能静默掩盖缺图」): every display fallback of a missing 差分 image in this
// session (packSpriteFallbacks rows), once per figure · outfit · 差分, in the order they first happened. Rows are kept
// across pages until the session changes; nothing is written anywhere.
function useForkGalSpriteFallbacks(sessionId, rows) {
    const seen = React.useRef(null);
    if (!seen.current || seen.current.sessionId !== sessionId) seen.current = { sessionId, rows: new Map(), list: [] };
    const current = seen.current;
    let added = false;
    for (const row of rows) if (!current.rows.has(row.key)) { current.rows.set(row.key, row); added = true; }
    if (added) current.list = [...current.rows.values()];
    return current.list;
}
// 「大肥鱼 · 女仆装 · 平和 → 喜悦」: figure · outfit · requested 差分 → what the stage showed instead.
function forkGalSpriteFallbackLine(row, nameOf) {
    const shown = row.shown === '@avatar' ? '头像（小图）' : row.shown ? row.shownLabel || row.shown : '没有可显示的图';
    return [row.figure || (nameOf && nameOf(row.alias)) || row.alias, row.outfit, row.requestedLabel || row.requested].filter(Boolean).join(' · ') + ' → ' + shown;
}
function forkGalSpriteFallbackTitle(rows) {
    return rows.every(row => row.shown === 'calm') ? '差分缺图，已临时显示平和' : '差分缺图，已临时替代显示';
}
// A sprite outfit without any image (not even calm) stands in as its avatar: a small framed portrait in the figure's
// stage slot, under CG and the text box. Display only.
function ForkGalStandIns({ members, portraits, colorOf }) {
    const h = React.createElement;
    return h('div', { className: 'fork-gal-standins', 'aria-hidden': true }, members.map(member => {
        const face = portraits.get(member.id);
        return h('div', { key: member.id, className: 'fork-gal-standin', 'data-alias': member.id, style: { left: 100 * member.x + '%', '--figure-color': colorOf(member.id) || 'var(--fork-accent)' } },
            h(ForkPackImage, { identity: face.identity, src: face.src, crop: face.crop, avatar: face.avatar, className: 'fork-gal-standin-img', alt: '' }));
    }));
}
// The end of a failure's 详情 with the shared preference: the technical line while the 调试视图 is on (re-rendered when the
// switch changes, here or in 设置), otherwise 「打开调试视图」.
function ForkGalDebugLine({ debug }) {
    const h = React.createElement, prefs = FORK_GAL_DEBUG_PREFS();
    const hidden = React.useSyncExternalStore(prefs.subscribe, prefs.snapshot, prefs.snapshot);
    const [opening, setOpening] = React.useState(false), [failed, setFailed] = React.useState(false);
    if (hidden === false) return h('code', { className: 'fork-gal-runtime-debug' }, debug);
    async function open() {
        if (opening) return;
        setOpening(true); setFailed(false);
        try { await prefs.save(false); } catch (_) { setFailed(true); } finally { setOpening(false); }
    }
    return h('span', { className: 'fork-gal-runtime-howto' }, failed ? '没能打开调试视图，请在设置里打开。' : '具体原因在调试视图里。',
        h('button', { type: 'button', className: 'fork-gal-runtime-open-debug', disabled: opening, onClick: open }, opening ? '正在打开…' : '打开调试视图'));
}
// private fork (new-user journey 2026-10, R10): an on-stage Live2D figure is showing its static sprite (or nothing) because
// this machine has no Cubism Core (the user imports it: official page, then the file). One ⚠ notice 「Live2D 未安装 · 安装」; 安装 unfolds the shared licence + install entry
// (ForkCubismCoreEntry, as in 设置 › DSH Tavern › 运行库) in place. Installing re-reads the stage (fork-stage-session-binding.js),
// so the figures switch to Live2D without a reload; the notice goes as soon as the Core is in.
function ForkGalCubismNotice({ icon, request }) {
    const h = React.createElement;
    useForkCubismRevision();
    const [open, setOpen] = React.useState(false), panel = React.useId(), toggle = React.useRef(null);
    if (forkCubismCore.core) return null;
    // The stage reads Enter/Space/Esc on window; keys on the notice's own controls stay here, Esc folds the entry first.
    const keys = event => {
        if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false); toggle.current?.focus(); }
        else if ([' ', 'Enter'].includes(event.key) && event.target.closest?.('button,a')) event.stopPropagation();
    };
    return h('div', { className: 'fork-gal-runtime-status', 'data-tone': 'error', role: 'status', onKeyDown: keys }, icon,
        h('div', { className: 'fork-gal-runtime-text' },
            h('div', { className: 'fork-gal-runtime-head' }, h('strong', null, 'Live2D 未安装'), ' · ',
                h('button', { type: 'button', ref: toggle, className: 'fork-gal-runtime-action', 'aria-expanded': open, 'aria-controls': panel, onClick: () => setOpen(!open) }, '安装')),
            open ? h('div', { id: panel, className: 'fork-gal-cubism-install' }, h(ForkCubismCoreEntry, { request, head: false })) : null));
}
// private fork (new-user journey 2026-10): first-run hints, shown in the stage's notice stack (not a modal) once the entry
// is revealed. keys: the stage's real shortcuts (FORK_GAL_SHORTCUTS), once per profile — 「已看过」 is kept in the persisted
// host-only frame storage (forkFrameStorage.seen / markSeen, frame-storage.json), which survives restarts and port changes;
// nothing shows before that store has loaded, nor without it. sound: 「点任意处开启声音」 while the browser's autoplay policy
// holds the BGM back (forkStageMusic.blocked()), at most once per page load. Any key or click dismisses both; the same
// gesture resumes the audio (the BGM kick and the mixer resume listen to it). A click on the bare stage only dismisses
// (it does not also turn the page); keys pass through (A still starts auto). private fork (B2 O43): the first page turn
// (auto, skip or a click) also retires the key list, and the system menu's 「快捷键」 shows it again (showKeys).
const FORK_GAL_KEYS_HINT = 'stage-shortcuts', FORK_GAL_NO_MUSIC = { subscribeBlocked: () => () => {}, blocked: () => false };
let forkGalSoundHintShown = false;
function useForkGalFirstRunHints(visible, rootRef, position) {
    const store = typeof forkFrameStorage === 'object' && forkFrameStorage && typeof forkFrameStorage.seen === 'function' ? forkFrameStorage : null;
    const [keys, setKeys] = React.useState(false), [soundGone, setSoundGone] = React.useState(forkGalSoundHintShown);
    const music = typeof forkStageMusic === 'object' && forkStageMusic && typeof forkStageMusic.subscribeBlocked === 'function' ? forkStageMusic : FORK_GAL_NO_MUSIC;
    const blocked = React.useSyncExternalStore(music.subscribeBlocked, music.blocked, () => false);
    React.useEffect(function () {
        if (!visible || !store) return undefined;
        let live = true;
        Promise.resolve(store.load()).then(() => { if (live && store.loaded() && !store.seen(FORK_GAL_KEYS_HINT)) setKeys(true); }, () => {});
        return () => { live = false; };
    }, [visible]);
    const sound = Boolean(visible && blocked && !soundGone);
    if (sound) forkGalSoundHintShown = true;
    React.useEffect(function () {
        if (!keys && !sound) return undefined;
        let timer = 0;
        const swallow = event => { event.stopPropagation(); event.preventDefault(); };
        function dismiss(event) {
            if (keys) store.markSeen(FORK_GAL_KEYS_HINT);
            setKeys(false); setSoundGone(true);
            const target = event.target, root = rootRef.current;
            if (event.type === 'pointerdown' && root && target && root.contains(target) && !(target.closest && target.closest('button, input, select, textarea, a'))) {
                document.addEventListener('click', swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener('click', swallow, true), 600);
            }
        }
        window.addEventListener('keydown', dismiss, true);
        window.addEventListener('pointerdown', dismiss, true);
        return () => { window.removeEventListener('keydown', dismiss, true); window.removeEventListener('pointerdown', dismiss, true); };
    }, [keys, sound]);
    const shownAt = React.useRef(null);
    React.useEffect(function () {
        if (!keys) { shownAt.current = null; return; }
        if (shownAt.current === null) { shownAt.current = position; return; }
        if (shownAt.current !== position) { if (store) store.markSeen(FORK_GAL_KEYS_HINT); setKeys(false); }
    }, [keys, position]);
    const showKeys = React.useCallback(() => setKeys(true), []);
    return React.useMemo(() => ({ keys, sound, showKeys }), [keys, sound, showKeys]);
}
// The stage's real key bindings (the window keydown handler in ForkGalStage, the held Ctrl and forkGalStageShortcut's F12).
const FORK_GAL_SHORTCUTS = [['自动', 'A'], ['跳过', '按住 Ctrl'], ['隐藏', 'H'], ['履历', 'L'], ['菜单', 'Esc'], ['回聊天', 'F12']];
function forkGalAwaitingText(activity) {
    if (activity?.role === 'settlement' && (activity.busy || ['pending', 'running'].includes(activity.phase))) {
        return '正在等待上一轮后台结算，完成后开始正文';
    }
    return '正在书写下一幕';
}
function ForkGalRuntimeStatus({ busy, hints, error, bodyFailure = false, drops = [], diagnostics, sceneError, cgNotice, spriteFallbacks = [], nameOf, live2dRequest }) {
    const h = React.createElement;
    const notes = diagnostics || [], cancelled = error === 'cancelled';
    const icon = h('svg', { className: 'fork-gal-runtime-icon', width: 15, height: 15, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('path', { d: 'M12 4.5 20.5 19h-17L12 4.5zM12 10v4.2M12 16.8v.2', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
    // private fork (new-user journey 2026-10): a failure's 详情 is the plain reason; its technical line (code: message) is
    // rendered only while the 调试视图 is on (body.dsh-fork-debug, read each render), otherwise one line says where to turn
    // it on. Raw validator prose never reaches the player's DOM.
    const debugView = typeof document !== 'undefined' && !!document.body && document.body.classList.contains('dsh-fork-debug');
    const notice = (key, tone, mark, title, note, detail, debug) => h('div', { key, className: 'fork-gal-runtime-status', 'data-tone': tone, role: 'status' }, mark,
        h('div', { className: 'fork-gal-runtime-text' }, h('strong', null, title), note ? h('span', null, note) : null,
            detail ? h('details', null, h('summary', null, '详情'), h('code', null, detail),
                debug ? FORK_GAL_DEBUG_PREFS() ? h(ForkGalDebugLine, { debug }) : debugView ? h('code', { className: 'fork-gal-runtime-debug' }, debug) : h('span', { className: 'fork-gal-runtime-howto' }, FORK_GAL_DEBUG_HOWTO) : null) : null));
    const providerRefusal = bodyFailure && error && tavernProviderRefusalNotice(stageRuntimeErrorText(error));
    const errorTitle = bodyFailure ? (providerRefusal ? '正文模型被服务商内容审核拒绝' : cancelled ? '正文生成已停止' : '正文生成失败') : cancelled ? '演出已取消' : '演出暂不可用';
    const errorDetail = bodyFailure ? (providerRefusal || '本轮正文未完成，可以重新生成本轮，或回到聊天查看错误详情。') : stageDiagnosticText(stageRuntimeErrorText(error));
    const direction = error ? notice('direction', 'error', icon, errorTitle, null, cancelled ? '' : errorDetail, cancelled ? '' : stageDiagnosticText(stageRuntimeErrorText(error), true))
        : busy ? notice('direction', 'busy', h(ForkSpinner, { className: 'fork-gal-runtime-spinner' }), busy === 'load' ? '正在载入素材…' : busy === 'write' ? '正在写正文…' : '正在编排演出…') : null;
    // private fork (new-user journey 2026-10): first-run hints ride the same stack (no modal): 「点任意处开启声音」 while the
    // browser holds the BGM back, and the stage's real shortcuts once (useForkGalFirstRunHints).
    return h('div', { className: 'fork-gal-notices', onWheel: event => event.stopPropagation(), onClick: event => event.stopPropagation() },
        hints?.sound ? notice('sound', 'hint', h('span', { className: 'fork-gal-runtime-icon', 'aria-hidden': true }, h(ForkIcon, { name: 'speaker', size: 15 })), '点任意处开启声音') : null,
        hints?.keys ? h('div', { key: 'keys', className: 'fork-gal-runtime-status fork-gal-runtime-keys', 'data-tone': 'hint', role: 'note', 'aria-label': '快捷键' },
            h('dl', null, FORK_GAL_SHORTCUTS.map(([label, key]) => h(React.Fragment, { key: label }, h('dt', null, h('kbd', null, key)), h('dd', null, label))))) : null,
        direction,
        live2dRequest ? h(ForkGalCubismNotice, { key: 'live2d-core', icon, request: live2dRequest }) : null,
        ...[...new Set(drops.map(drop => drop.capability))].map(capability => notice('drop:' + capability, 'error', icon,
            (directorCommands.dimensions[capability] || '其他') + '部分演出未应用', null,
            drops.filter(drop => drop.capability === capability).map(drop => '第 ' + drop.at + ' 段：' + stageDiagnosticText(drop)).join('\n'),
            drops.filter(drop => drop.capability === capability).map(drop => '第 ' + drop.at + ' 段：' + stageDiagnosticText(drop, true)).join('\n'))),
        notes.length ? notice('diagnostics', 'debug', icon, '场景诊断 ' + notes.length + ' 条', notes.map(note => FORK_GAL_DIAGNOSTIC_TEXT[typeof note === 'string' ? note.split(':')[0] : note?.code] || stageDiagnosticText(note)).filter(Boolean).join('；'), notes.map(note => stageDiagnosticText(note, true)).filter(Boolean).join('\n')) : null,
        spriteFallbacks.length ? notice('sprite-fallback', 'error', icon, forkGalSpriteFallbackTitle(spriteFallbacks), null,
            spriteFallbacks.map(row => forkGalSpriteFallbackLine(row, nameOf)).join('\n')) : null,
        cgNotice ? notice('cg-gallery', 'error', icon, cgNotice) : null,
        sceneError ? notice('scene', 'error', icon, '画面载入失败', null, stageDiagnosticText(sceneError)) : null);
}
// private fork (reading controls §2.4, owner 2026-10): phones (≤ 480 px) keep only four primary controls under the
// text box, each a 44 px touch target: 自动 / 跳过 / 履历 / ≡. Hiding the box and the previous page move into the system
// menu (fork-gal-menu.js, options.narrow); 设置 and 返回主页面 are menu items already. Wider screens keep the full row.
const FORK_GAL_NARROW_QUERY = "(max-width: 480px)";
const FORK_GAL_CONTROLS_FULL = ["auto", "skip", "eye-off", "chevron-left", "backlog", "config", "menu", "chat"];
const FORK_GAL_CONTROLS_NARROW = ["auto", "skip", "backlog", "menu"];
function forkGalControlIds(narrow) { return narrow ? FORK_GAL_CONTROLS_NARROW : FORK_GAL_CONTROLS_FULL; }
function useForkGalNarrow() {
    const has = typeof matchMedia === "function";
    const [narrow, setNarrow] = React.useState(() => has && matchMedia(FORK_GAL_NARROW_QUERY).matches);
    React.useEffect(function () {
        if (!has) return undefined;
        const list = matchMedia(FORK_GAL_NARROW_QUERY), changed = () => setNarrow(list.matches);
        changed();
        if (list.addEventListener) list.addEventListener("change", changed);
        return () => { if (list.removeEventListener) list.removeEventListener("change", changed); };
    }, []);
    return narrow;
}

// private fork: HUD change moments (docs/fork/panel-ui-design.md). One step per render for a top-left label
// (place or track): the first value, a cleared label, a new session or a change outside live playback (history,
// skip) just shows; a change in place gets a new key, so the label remounts and a newer change cuts a running
// one short (latest wins). A label appearing from nothing animates only when opts.fromEmpty allows it.
function forkGalHudStep(prev, value, opts) {
    value = value || "";
    const scope = opts && opts.scope || "";
    if (!prev || prev.scope !== scope) return { value, scope, key: prev ? prev.key + 1 : 0, from: "", animate: false };
    if (prev.value === value) return prev;
    return { value, scope, key: prev.key + 1, from: prev.value, animate: Boolean(value && opts.live && (prev.value || opts.fromEmpty)) };
}
// The place and track labels of the top-left HUD. props: { place, track: { name, usage }, scope (session), live
// (in-place playback: not history, not skipping) }. Music starting from silence animates only once the place
// already shows and the stage has been open a while (not while the first scene loads). props.music (the BGM
// player, fork-bgm-player.js: { ref, open, paused, toggle() }) makes the track label its chip, shown even in silence.
function ForkGalHudLabels(props) {
    const h = React.createElement;
    const openedAt = React.useRef(Date.now()), placeRef = React.useRef(null), trackRef = React.useRef(null);
    const place = props.place || "", track = props.track || null, chip = props.music || null;
    const placeBefore = placeRef.current ? placeRef.current.value : "";
    const placeHud = placeRef.current = forkGalHudStep(placeRef.current, place, { scope: props.scope, live: props.live });
    const trackHud = trackRef.current = forkGalHudStep(trackRef.current, track ? track.name : "", { scope: props.scope, live: props.live,
        fromEmpty: Boolean(placeBefore) && Date.now() - openedAt.current > 1500 });
    const from = hud => hud.animate && hud.from ? h("span", { className: "fork-gal-hud-from", "aria-hidden": true }, hud.from) : null;
    // private fork (reading controls §2.4): one line for place and track; phones truncate it (fork-theme.css), wider
    // screens lay it out as before (display: contents).
    return h("span", { className: "fork-gal-hud-line" },
        place ? h("span", { key: "place:" + placeHud.key, className: "fork-gal-place" + (placeHud.animate ? " is-changing" : "") },
            h("span", { className: "fork-gal-place-name" }, place), from(placeHud)) : null,
        track || chip ? h(chip ? "button" : "span", { key: "track:" + trackHud.key, className: "fork-gal-track" + (trackHud.animate ? " is-changing" : "") + (chip ? " fork-bgm-chip" + (chip.paused ? " is-paused" : "") : ""),
            ...(chip ? { ref: chip.ref, type: "button", title: "BGM", "aria-label": "BGM" + (track ? "：" + track.name : ""), "aria-haspopup": "dialog", "aria-expanded": chip.open, onClick: chip.toggle,
                // Enter / Space open the player instead of turning the page (the stage listens on window).
                onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } } : { title: track.usage || track.name }) },
            h(ForkIcon, { name: "music", size: 16 }), track ? h("span", { className: "fork-gal-track-name" }, track.name) : null, from(trackHud)) : null);
}

// Name plate of the text box: the name (classic: 【名字】 unless in film mode), the mood tag (other themes) and,
// only when the line is voiced, a small replay button right after the name (R does the same).
// props: { name, mood, classic, film, voiceState ("" | ready | loading | playing | paused | error), voiceError, onReplay() }.
function ForkGalNamePlate(props) {
    const h = React.createElement;
    const state = props.voiceState || "";
    const reason = {VOICE_NOT_FOUND:"声音绑定未解析，请重新选择该人物的声音","voice-unbound":"声音绑定未解析，请重新选择该人物的声音",QWEN_MODEL_NOT_FOUND:"Qwen 配音模型不存在，请在声音预设中选择服务当前提供的模型",QWEN_AUDIO_NOT_FOUND:"Qwen 合成音频下载失败（404），请重试",QWEN_RESOURCE_NOT_FOUND:"Qwen 语音服务资源不存在（404），请检查区域、模型与音色",FISH_AUTH_FAILED:"Fish Audio 密钥无效（401）",FISH_BILLING_REQUIRED:"Fish Audio 额度或余额不足（402），未切换付费模型",FISH_RATE_LIMITED:"Fish Audio 请求受限（429），请稍后重试",FISH_REQUEST_FAILED:"Fish Audio 请求失败，请检查声音模型 ID 与服务状态",QWEN_BILLING_REQUIRED:"千问额度或账户余额不足，请检查阿里云用量与账单",QWEN_AUTH_FAILED:"千问密钥无效",QWEN_RATE_LIMITED:"千问请求过于频繁或达到限额",QWEN_ACCESS_DENIED:"千问访问被拒绝，请检查模型权限与账户状态",QWEN_REQUEST_FAILED:"千问服务请求失败",SERVICE_OFFLINE:"配音服务暂时不可用",TIMEOUT:"配音请求超时"}[props.voiceError] || props.voiceError || "配音服务暂时不可用";
    const label = state === "error" ? "配音失败：" + reason + "；点击重试" : state === "loading" ? "语音准备中" : "重播这一句";
    const voice = state ? h("button", { type: "button", className: "fork-gal-voice", "data-state": state, title: state === "loading" ? label : label + "（R）", "aria-label": label, "aria-keyshortcuts": "R",
        onClick: event => { event.stopPropagation(); props.onReplay(); },
        // Enter / Space activate the focused button instead of turning the page (the stage listens on window).
        onKeyDown: event => { if (event.key === "Enter" || event.key === " ") event.stopPropagation(); } }, state === "error" ? "⚠ 配音" : h(ForkIcon, { name: "speaker", size: 14 })) : null;
    if (props.classic) return h("div", { className: "fork-gal-name" }, h("b", null, props.film ? props.name : "【" + props.name + "】"), voice);
    return h("div", { className: "fork-gal-name" }, h("i", { className: "fork-gal-name-gem", "aria-hidden": true }), h("b", null, props.name), props.mood ? h("span", null, props.mood) : null, voice);
}

// Mounted in the session shell; the stage covers the whole window (and the screen, when the
// browser grants full screen). Leaving full screen opens the stage menu (Esc exits full screen first).
function ForkGalStageHost(props) {
    const state = useForkGalOn(props.sessionId);
    const [target, setTarget] = React.useState(null);
    React.useLayoutEffect(function () {
        if (!state.on) { setTarget(null); return; }
        const mount = document.createElement("div");
        mount.className = "fork-gal-mount";
        document.body.appendChild(mount);
        forkGalCoverChat();
        let wasFull = Boolean(document.fullscreenElement), lostSent = false;
        // Leaving system full screen (Esc, which the browser takes first) opens the stage menu instead of leaving.
        // Commit it before the first windowed frame paints (flushSync): one transition, not resize then menu.
        function fullscreenLost() {
            if (lostSent || forkGalActive.get() !== props.sessionId) return;
            lostSent = true;
            if (ReactDOM && typeof ReactDOM.flushSync === "function") ReactDOM.flushSync(forkGalMenuRequest.request); else forkGalMenuRequest.request();
        }
        // private fork (owner 2026-10): Electron shrinks the window 50-100 ms before fullscreenchange; the window no
        // longer filling the screen is the first sign, so the menu lands in that same frame.
        function onResize() {
            if (wasFull && document.fullscreenElement && (outerWidth !== screen.width || outerHeight !== screen.height)) fullscreenLost();
        }
        function onFullscreen() {
            if (wasFull && !document.fullscreenElement) fullscreenLost();
            wasFull = Boolean(document.fullscreenElement); lostSent = false;
            forkGalEscapeLock(wasFull);
        }
        document.addEventListener("fullscreenchange", onFullscreen);
        window.addEventListener("resize", onResize);
        forkGalEscapeLock(wasFull);
        setTarget(mount);
        return function () {
            forkGalEscapeLock(false);
            document.removeEventListener("fullscreenchange", onFullscreen);
            window.removeEventListener("resize", onResize);
            mount.remove(); forkGalUncover?.(); setTarget(null);
        };
    }, [props.sessionId, state.on]);
    React.useEffect(() => () => { if (forkGalActive.get() === props.sessionId) forkGalLeave(); }, [props.sessionId]);
    const h = React.createElement;
    return target && ReactDOM && ReactDOM.createPortal ? ReactDOM.createPortal(h(ForkGalStage, { sessionId: props.sessionId, data: state.data, Regenerate: props.Regenerate, Choices: props.Choices, choiceProps: props.choiceProps, onExit: forkGalLeave }), target) : null;
}

// Header button: enter the stage (full screen). Esc opens the stage menu; its 「返回主页面」(or the chat button) leaves.
function ForkGalStageToggle(props) {
    const state = useForkGalOn(props.sessionId);
    if (!state.available) return null;
    return React.createElement("button", { type: "button", className: "dsh-tavern-btn fork-gal-toggle", title: "进入舞台模式（F12 切换，Esc 打开菜单）", "aria-keyshortcuts": "F12", onClick: () => forkGalEnter(props.sessionId) },
        React.createElement(ForkIcon, { name: "stage", size: 16 }), React.createElement("span", null, "舞台"));
}
