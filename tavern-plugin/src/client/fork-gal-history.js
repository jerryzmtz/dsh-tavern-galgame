// Presentation-only turn navigation. No history read here may start a director task.
// @include fork-gal-chat-entry.js
function forkGalPartOrder(a, b) {
    return (Number(a.order) || 0) - (Number(b.order) || 0) || a.index - b.index || String(a.scope || '').localeCompare(String(b.scope || ''));
}
function forkGalChatBase(partsMap, part, localBase) {
    if (!part || !partsMap) return localBase;
    // Local offsets already include preceding blocks of this node; only add earlier native nodes.
    const previous = Array.from(partsMap.values()).filter(item => item.turn === part.turn && item.nodeId !== part.nodeId && forkGalPartOrder(item, part) < 0);
    return localBase + forkGalParagraphs(previous).length;
}
function forkGalTurnIndex(parts) {
    const grouped = new Map();
    (parts || []).forEach(part => { if (!grouped.has(part.turn)) grouped.set(part.turn, []); grouped.get(part.turn).push(part); });
    grouped.forEach(parts => parts.sort(forkGalPartOrder));
    return grouped;
}
function forkGalPageAtPara(pages, para, offset = 0) {
    const anchors = forkGalPositionAnchors(pages);
    const exact = anchors.findIndex(item => item.para === para && item.offset <= offset && offset < item.offset + item.length);
    return exact >= 0 ? exact : Math.max(0, pages.findIndex(page => page.para >= para));
}
function forkGalResumeTurn(saved, turns, entry) {
    const latest = turns[turns.length - 1] || 0;
    if (entry && turns.includes(entry.turn)) return entry.turn;
    if (saved && turns.includes(saved.turn) && latest <= (saved.latestSeenTurn || saved.turn)) return saved.turn;
    return latest;
}
// The system menu's 「跳到最新一轮」: the latest turn at the furthest page read in it (same text), else its first page.
function forkGalLatestResume(readThrough, latest, digest) {
    const valid = readThrough && readThrough.turn === latest && readThrough.textDigest === digest && Number.isInteger(readThrough.page) && readThrough.page >= 0;
    return { turn: latest, page: valid ? readThrough.page : 0 };
}
function forkGalReadBookmark(sessionId) {
    try { return JSON.parse(localStorage.getItem('fork-stage-position:' + sessionId) || 'null'); } catch (_) { return null; }
}
// A transition belongs to the outgoing turn, so Back from page zero always reaches its last page.
function forkGalTurnStep(turns, turn, page, count, delta, transition) {
    const index = turns.indexOf(turn);
    if (transition) return delta > 0 ? { turn: turns[index + 1] || turn, page: 0 } : { turn, page: Math.max(0, count - 1) };
    if (delta > 0 && page >= count - 1) return index < turns.length - 1 ? { turn, page, transition: true } : null;
    if (delta < 0 && page <= 0) return index > 0 ? { turn: turns[index - 1], page: -1 } : null;
    return { turn, page: page + delta };
}
function forkGalHistoryVoiceWindow(grouped, turns, turn, pages, page, paused) {
    if (paused) return [];
    const upcoming = pages.slice(page);
    // Voice scanning does not paginate distant turns; at most eight handles are retained.
    let found = upcoming.filter(item => item.voice && !item.pending).length;
    for (let t = turns.indexOf(turn) + 1; t < turns.length && found < 8; t++) {
        for (const part of grouped.get(turns[t]) || []) {
            for (let i = 0; i < (part.segments || []).length && found < 8; i++) {
                const segment = part.segments[i], voice = part.voices && part.voices[i];
                if (segment.kind !== 'markdown' && !segment.streaming && voice) { upcoming.push({ voice }); found++; }
            }
            if (found >= 8) break;
        }
    }
    return forkStageVoiceWindow(upcoming, 0, false);
}
function forkGalParagraphCount(text) {
    return forkGalParagraphs([{ segments: forkParseBubbles(String(text || ''), false) }]).length;
}
// Icon-only: the stage glyph is drawn by CSS (fork-theme.css "chat stage entry"), so the button adds no text to the
// paragraph (copying prose never picks up a label); the tooltip and the accessible name carry the words.
function ForkStageEnterHere(props) {
    return React.createElement('button', { type: 'button', className: 'fork-stage-enter-here', 'aria-label': '从这里进入舞台', title: '从这里进入舞台',
        onClick: event => { event.preventDefault(); event.stopPropagation(); forkGalEnter(props.sessionId, { turn: props.turn, para: props.para }); } });
}
// The entry sits at the end of the bubble's last line: the row renders it (props.enter) inside its text block.
// private fork (stage perf): no portal; each portal container installed React's full delegated listener set.
function ForkStageParagraph(props) {
    const timer = React.useRef(null), root = React.useRef(null);
    const [pressed, setPressed] = React.useState(false);
    React.useLayoutEffect(function () {
        if (!root.current) return;
        root.current.querySelectorAll('p, .fork-bubble').forEach(node => {
            node.setAttribute('data-fork-stage-turn', props.turn); node.setAttribute('data-fork-stage-para', props.para);
        });
    }, [props.turn, props.para, props.children]);
    function cancel() { clearTimeout(timer.current); }
    React.useEffect(() => cancel, []);
    return React.createElement('div', { ref: root, className: 'fork-stage-paragraph' + (pressed ? ' is-long-pressed' : ''), 'data-fork-stage-turn': props.turn, 'data-fork-stage-para': props.para,
        onPointerDown: event => { if (event.pointerType !== 'mouse') timer.current = setTimeout(() => setPressed(true), 500); }, onPointerUp: cancel, onPointerCancel: cancel, onPointerMove: cancel },
        props.children);
}
