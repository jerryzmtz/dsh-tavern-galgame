// Shared by host parsers and the bundled client. Only whole-line code quotes
// are syntax; backticks inside a bracket (including a streaming one) are text.
// private fork (B4): body models also wrap a whole bubble line in Markdown emphasis (`*@bubble…]*`, `…]**`); the
// markers outside the bracket are formatting, not text. Inner thoughts keep their `[*…*]` inside the bracket.
function forkStripBubbleCodeQuote(line) {
    const opening = /^([\t ]*)(?:`{1,2}|[*_~]{1,3})(?=@bubble(?:-voice)?(?:\s*[:\uff1a]|$))/.exec(line);
    const value = opening ? opening[1] + line.slice(opening[0].length) : line;
    if (!/^[\t ]*@bubble/.test(value)) return line;
    return value.replace(/(\])[\t ]*[`*_~]+[\t ]*(\r?)$/, "$1$2");
}
// A line that still starts with @bubble but does not parse is never shown raw: it degrades to narration of its
// bracketed (or last) field, without the prefix. Empty results are dropped.
function forkBubbleFallbackText(line) {
    const rest = String(line).replace(/^\s*@bubble(?:-voice)?\s*[:\uff1a]?\s*/, "");
    const bracket = /\[([^\]\n]*)(?:\]([^|\uff5c\[\n]*))?/.exec(rest), fields = rest.split(/[|\uff5c]/);
    const text = bracket ? bracket[1].trim().replace(/^\*([\s\S]*)\*$/, "$1") + (bracket[2] || "") : fields.length > 1 ? fields[fields.length - 1] : "";
    return text.trim();
}

// private fork: one tolerant reader for transcript and host/client stage units.
const FORK_BUBBLE_LINE = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)\]\s*$/;
const FORK_BUBBLE_PARTIAL = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[(.*)$/;

// `open`: the bracket has not closed in the text (a live tail, or a reply that ended early). Only `streaming`, the
// caller's real stream state, marks the segment unfinished.
function forkBubbleSegment(match, streaming, open = streaming) {
    const raw = String(match[4] || "").trim();
    const thought = /^\*[\s\S]*\*$/.test(raw) || (open && raw.startsWith("*"));
    return { kind: "bubble", alias: match[1].trim().toLowerCase(), name: match[2].trim(), mood: match[3].trim(), text: thought ? raw.replace(/^\*|\*$/g, "") : raw, thought: thought, streaming: Boolean(streaming) };
}
// Split prose into Markdown narration and bubble lines.
function forkParseBubbles(text, streaming) {
    const lines = String(text || "").split("\n");
    const segments = [];
    let buffer = [];
    function flush() { const md = buffer.join("\n"); if (md.trim() !== "") segments.push({ kind: "markdown", text: md }); buffer = []; }
    lines.forEach(function (line, index) {
        const original = line;
        line = forkStripBubbleCodeQuote(line);
        // A fifth field opts into voice text, even before its closing bracket arrives.
        const voiceLine = /^\s*@bubble-voice/.test(line) || /^\s*@bubble\s*[:：]\s*[^|｜\n]*[|｜][^|｜\n]*[|｜][^|｜\n]*[|｜]\s*\[[^\]\n]*\]\s*[|｜]/.test(line);
        const voiced = voiceLine && /^\s*@bubble(?:-voice)?\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[([^\]\n]*)\](?:[|｜]\s*\[([^\]\n]*)\])?\s*$/.exec(line);
        if (voiced) { flush(); const segment = forkBubbleSegment(voiced, voiced[5] === undefined && streaming && index === lines.length - 1); segment.speech = (voiced[5] === undefined ? voiced[4] : voiced[5]).trim().replace(/^\*([\s\S]*)\*$/, "$1").trim(); segment.singleVoiceText = voiced[5] === undefined; segment.voiced = true; segments.push(segment); return; }
        if (voiceLine) {
            flush();
            // private fork (O29): the text shape (`[…]|` with no voice field yet) never decides streaming; only the live
            // tail of a streaming reply is unfinished. A finished reply shows the bubble complete; its empty or unfinished
            // voice field still has no speech (never falls back to the display text).
            const live = Boolean(streaming) && index === lines.length - 1;
            const partial = /^\s*@bubble(?:-voice)?\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*\[([^\]\n]*)(\])?/.exec(line);
            if (partial) {
                const segment = forkBubbleSegment(partial, live, !partial[5]); segment.voiced = true;
                if (!live) segment.speech = "";
                segments.push(segment);
            }
            return;
        }
        const full = FORK_BUBBLE_LINE.exec(line);
        if (full) { flush(); segments.push(forkBubbleSegment(full, false)); return; }
        // An opening bracket still means an unfinished bracketed line, not bare text.
        const bare = /^\s*@bubble\s*[:：]\s*([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]([^|｜\n]*)[|｜]\s*([^\[\s][^\n]*)\s*$/.exec(line);
        if (bare) { flush(); segments.push(forkBubbleSegment(bare, streaming && index === lines.length - 1)); return; }
        if (streaming && index === lines.length - 1 && /^\s*@bubble/.test(line)) {
            const partial = FORK_BUBBLE_PARTIAL.exec(line);
            flush();
            if (partial) segments.push(forkBubbleSegment(partial, true));
            return;
        }
        if (/^\s*@bubble(?:-voice)?(?:\s*[:\uff1a]|$)/.test(line)) {
            const text = forkBubbleFallbackText(line);
            if (text) buffer.push(text);
            return;
        }
        buffer.push(original);
    });
    flush();
    return segments;
}

// private fork: a figure's vocabulary is local to its alias, never another cast member.
// Local IDs/labels take precedence over colliding engine custom rows.
function forkFigureBubbleMoods(base, emotions) {
    return (emotions === undefined ? base : emotions).filter(row=>row.label!==undefined).map(row=>({...row}));
}

// Exact names win; a shortened label wins over a builtin synonym.
function forkResolveBubbleMood(word, list) {
    const text = String(word || "").trim();
    if (!text) return null;
    const words = group => Array.isArray(group.words) ? group.words : String(group.words || "").split(/\s+/);
    return list.find(group => group.id === text || group.label === text)
        || list.find(group => String(group.label).startsWith(text))
        || list.find(group => words(group).includes(text)) || null;
}
// private fork: the same exact resolver is used by host, voice and browser projection.
// private fork (stage perf 2026-10): a speaker resolves once per character list (a config change replaces the
// list), not on every render: normalizing the whole catalogue per call was a page-turn hot spot.
const forkBubbleCharacterLists = new WeakMap();
function forkBubbleCharacter(config, segment) {
    const rows = config?.characters || [];
    if (!rows.length) return null;
    let resolved = forkBubbleCharacterLists.get(rows);
    if (!resolved) forkBubbleCharacterLists.set(rows, resolved = new Map());
    const key = typeof segment === 'string' ? '\u0000' + segment : JSON.stringify([segment?.alias ?? null, segment?.name ?? null]);
    if (resolved.has(key)) return resolved.get(key);
    const resolver = typeof forkFigureResolution !== 'undefined' ? forkFigureResolution : require('../../packages/dsh-presentation-protocol/src/figure-resolution.cjs');
    const result = resolver.resolveFigureName(rows.map(row => ({...row,actorKey:row.alias})),segment);
    const row = result.status === 'resolved' ? rows.find(row => row.alias === result.actorKey) : null;
    resolved.set(key, row);
    return row;
}
function forkBubbleDisplayName(segment, config) {
    const alias = String(segment?.alias || "").trim().toLowerCase();
    const character = forkBubbleCharacter(config,segment);
    const names = [character?.name, segment?.name];
    return names.map(name => String(name || "").trim()).find(name => name && name.toLowerCase() !== alias) || "";
}
if (typeof window === "undefined" && typeof module !== "undefined") module.exports = { forkStripBubbleCodeQuote, forkParseBubbles, forkResolveBubbleMood, forkBubbleDisplayName, forkFigureBubbleMoods, forkBubbleCharacter };
