// Private fork (docs/fork/galgame-stage.md): the stage's backlog (履历).
// An overlay above the scene listing what the reader has already seen: every rendered earlier turn
// (read-only) and the current turn up to and including the current page. Rows of the current turn
// jump the stage back to their page. It reads the session-owned canonical text index and
// the Chat snapshot's user messages; it never writes story, variables or prompts.

// ---------- Backlog helpers (pure; tests/fork-gal-stage.test.mjs) ----------
// Earlier rendered turns (below `turn`), oldest first, each paged like the stage pages them.
function forkGalBacklogTurns(parts, turn) {
    const byTurn = new Map();
    (parts || []).forEach(function (part) {
        if (!part || !(part.turn < turn)) return;
        if (!byTurn.has(part.turn)) byTurn.set(part.turn, []);
        byTurn.get(part.turn).push(part);
    });
    return Array.from(byTurn.keys()).sort((a, b) => a - b)
        .map(t => ({ turn: t, pages: forkGalPages(byTurn.get(t).slice().sort(forkGalPartOrder)) }));
}
// The rows of the panel: a separator per turn, the player's input of that turn (when known), then its
// pages. The current turn stops at the current page (never shows pages the reader has not reached).
// inputs: { [storyTurn]: text }.
function forkGalBacklogEntries(earlier, turn, pages, page, inputs) {
    const out = [];
    const at = Math.min(Math.max(0, page), Math.max(0, (pages || []).length - 1));
    const turns = (earlier || []).map(item => ({ turn: item.turn, pages: item.pages, current: false }));
    if (turn) turns.push({ turn, pages: (pages || []).slice(0, at + 1), current: true });
    turns.forEach(function (item) {
        const input = String(inputs && inputs[item.turn] || "").trim();
        if (!item.pages.length && !input) return;
        out.push({ type: "turn", key: "t" + item.turn, turn: item.turn, current: item.current });
        if (input) out.push({ type: "input", key: "i" + item.turn, turn: item.turn, text: input });
        item.pages.forEach(function (p, index) {
            out.push({ type: "page", key: "p" + item.turn + ":" + index, turn: item.turn, page: index, current: item.current, here: item.current && index === at,
                kind: p.kind, alias: p.alias || "", name: p.name || "", mood: p.mood || "", text: p.text, thought: Boolean(p.thought), pending: Boolean(p.pending), voice: p.voice || null });
        });
    });
    return out;
}
function forkGalUserText(content) {
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.map(block => block && block.type === "text" ? String(block.text || "") : "").join("");
}
// The player's message of each turn from the Chat snapshot's nodes (legacy.nodes): a user node belongs
// to the next assistant reply (which carries the DSH turn). storyTurnOf maps a DSH turn to the story
// turn the stage uses; sourceOf(dshTurn) gives the host's edited / template source when there is one.
function forkGalPlayerInputs(nodes, storyTurnOf, sourceOf) {
    const out = {};
    let pending = null;
    (Array.isArray(nodes) ? nodes : []).forEach(function (node) {
        if (!node) return;
        if (node.kind === "user") { pending = forkGalUserText(node.content); return; }
        if (node.kind !== "assistant" || pending === null) return;
        const dsh = Number(node.turn) || 0;
        const text = pending;
        pending = null;
        if (!dsh || /^tavern-seed-trajectory:/.test(String(node.messageId || ""))) return;
        const source = sourceOf ? sourceOf(dsh) : null;
        const shown = String(source == null ? text : source).trim();
        if (shown) out[storyTurnOf ? storyTurnOf(dsh) : dsh] = shown;
    });
    return out;
}
// A row's voice for the chat bubble's voice control (fork-voice.js ForkVoiceButton): the published voice handle
// with the live player state; a click wakes lip sync and plays / pauses the line without jumping to its page.
function forkGalBacklogVoice(voice, player) {
    if (!voice) return null;
    return Object.assign({}, voice, { player: player || null, click(event) {
        if (event && event.stopPropagation) event.stopPropagation();
        if (typeof forkLipSync === "object" && forkLipSync.wake) forkLipSync.wake();
        voice.click();
    } });
}

// Prefix offsets include estimated heights for unvisited rows; measured rows replace them.
function forkGalBacklogWindow(offsets, scrollTop, height, overscan) {
    const count = offsets.length - 1;
    if (count <= 0) return { start: 0, end: 0 };
    const top = Math.max(0, Math.min(scrollTop, Math.max(0, offsets[count] - height)));
    function at(value) {
        let lo = 0, hi = count;
        while (lo < hi) { const mid = (lo + hi) >>> 1; if (offsets[mid + 1] <= value) lo = mid + 1; else hi = mid; }
        return lo;
    }
    return { start: Math.max(0, at(top) - overscan), end: Math.min(count, at(Math.max(top, top + height - 0.001)) + 1 + overscan) };
}

// private fork: immutable session paragraphs, with voice handles built only for visible rows.
function forkStageHistoryEntries(index,turn,pages,page,inputs) {
    const entries = [], turns = [...(index?.keys() || [])].filter(value => value <= turn);
    if (!turns.includes(turn)) turns.push(turn);
    for (const number of turns.sort((a,b) => a-b)) {
        const current = number === turn;
        entries.push({type:'turn',key:'t'+number,turn:number,current});
        if (inputs[number]) entries.push({type:'input',key:'i'+number,turn:number,text:inputs[number]});
        const rows = current ? pages.slice(0,page+1) : index.get(number).units || index.get(number).text.pages;
        rows.forEach((row,i) => entries.push({...row,type:'page',key:'p'+number+':'+i,turn:number,page:i,current,
            targetPara:current ? undefined : row.para || row.anchor.para, here:current && i === page,
            descriptor:current ? null : row.segment ? stageVoiceDescriptor(row) : row.voice,
            voice:current ? row.voice : null}));
    }
    return entries;
}

// Generic mod rows are read-derived; removed performances never reach this list.
function forkStageModHistoryEntries(entries,history) {
    if (!history?.some(row=>row.performances.length)) return entries;
    const after=new Map(),before=new Map();
    for(const {turn,performances} of history) for(const performance of performances) {
        const textcard=typeof forkTextcardAccepts==='function' && forkTextcardAccepts(performance);
        const follows=textcard && performance.payload.placement==='after';
        const matches=row=>row.type==='page' && row.turn===turn && (row.para || row.anchor?.para || row.targetPara || row.page+1)===performance.at;
        const index=follows ? entries.findLastIndex(matches) : entries.findIndex(matches);
        if(index<0)continue;
        // Explicit placement survives pagination; unmarked historical cards still precede their paragraph.
        if(textcard) {
            const card=textcardHistory(performance.payload);
            if(!card)continue;
            const target=follows ? after : before;
            if(!target.has(index))target.set(index,[]);
            target.get(index).push({type:'card',key:'card:'+turn+':'+performance.id,turn,tag:card.tag,parts:card.parts});
            continue;
        }
        if(typeof performance.payload.text!=='string')continue;
        if(!after.has(index))after.set(index,[]);
        after.get(index).push({...entries[index],key:'mod:'+turn+':'+performance.id,kind:'narration',text:performance.payload.text,
            thought:false,pending:false,voice:null,descriptor:null,modPerformance:performance});
    }
    return entries.flatMap((row,index)=>[...(before.get(index) || []),row,...(after.get(index) || [])]);
}

function forkPhoneBacklogEntries(entries,directions) {
    const out=[],seen=new Map();
    for (const entry of entries) {
        const para=entry.para || entry.anchor?.para || entry.targetPara || entry.page+1;
        const mark=entry.type==='page' && entry.kind==='line' && directions.get(entry.turn) && forkPhoneBeat(directions.get(entry.turn),para);
        if (!mark) {out.push(entry);continue;}
        const key=JSON.stringify([entry.turn,para]),previous=seen.get(key);
        if (previous) {
            previous.text=previous.text.slice(0,entry.anchor?.offset ?? previous.text.length)+entry.text;
            previous.here=previous.here || entry.here;
            continue;
        }
        const row={...entry,phoneForm:mark.form,phoneSide:mark.side,...(mark.form==='text'?{voice:null,descriptor:null}:{})};
        seen.set(key,row);out.push(row);
    }
    return out;
}

// ---------- Backlog view ----------
function useForkGalPlayerInputs(sessionId, useChat) {
    const nodes = useChat ? useChat(snapshot => snapshot && snapshot.legacy && snapshot.legacy.nodes || null) : null;
    const live = useLiveTavernView(sessionId, "gal-backlog");
    const view = live && live.view;
    return React.useMemo(function () {
        const sources = view && view.inputSources;
        return forkGalPlayerInputs(nodes, dsh => tavernStoryTurnForDshTurn(view, dsh),
            dsh => sources && Object.prototype.hasOwnProperty.call(sources, String(dsh)) && sources[dsh] != null ? String(sources[dsh]) : null);
    }, [nodes, view]);
}
// props: { sessionId, config, textIndex, voiceOf(descriptor, anchor), turn, pages, page, useChat, colorOf(alias), avatarOf(alias, mood),
// nameOf(alias), quote (classic theme: spoken lines read 「…」), onJump(page), onClose() }. Mounted only while open.
function ForkGalBacklog(props) {
    const h = React.createElement;
    const scroller = React.useRef(null);
    const openedAt = React.useRef(Date.now());
    const movedAt = React.useRef(0);
    const [, redraw] = React.useState(0);
    React.useEffect(() => forkVoicePlayer.subscribe(() => redraw(n => n + 1)), []);
    const inputs = useForkGalPlayerInputs(props.sessionId, props.useChat);
    const modHistory = typeof useForkStageModHistory === 'function' ? useForkStageModHistory(props.sessionId) : null;
    const [phoneDirections,setPhoneDirections]=React.useState(()=>new Map());
    const entries = React.useMemo(() => {
        const directions=new Map(phoneDirections);directions.set(props.turn,props.direction);
        return forkPhoneBacklogEntries(forkStageModHistoryEntries(forkStageHistoryEntries(props.textIndex, props.turn, props.pages || [], props.page, inputs),modHistory),directions);
    }, [props.textIndex, props.turn, props.pages, props.page, props.direction, inputs,modHistory,phoneDirections]);
    const heights = React.useRef(new Map());
    const nodes = React.useRef(new Map());
    const pendingFocus = React.useRef(null);
    const pendingScroll = React.useRef(null);
    const anchorRow = React.useRef(null);
    const [viewport, setViewport] = React.useState({ top: Infinity, height: 800 });
    const offsets = [0];
    entries.forEach(entry => offsets.push(offsets[offsets.length - 1] + (heights.current.get(entry.key) || (entry.type === "turn" ? 54 : 100))));
    const range = forkGalBacklogWindow(offsets, viewport.top, viewport.height, 20);
    const visibleTurns=JSON.stringify([...new Set(entries.slice(range.start,range.end).map(row=>row.turn))].filter(turn=>turn!==props.turn));
    // private fork (B2 O10): turns outside the loaded history window are index rows without text (a separator and the
    // player's input only); reading toward them loads their paragraphs, read-only, a few turns at a time.
    // Each unloaded row object is read once: a failed read leaves it as it was (no retry loop), while a history
    // cache revision that rebuilds the index (and drops loaded rows) yields new row objects that are read again.
    const hydrating = React.useRef(new WeakSet());
    React.useEffect(()=>{
        const owner = typeof forkStageSessions === 'object' ? forkStageSessions.owner : null;
        if(!owner || typeof owner.hydrateText!=='function' || !props.textIndex)return;
        for(const turn of JSON.parse(visibleTurns)) {
            const row = props.textIndex.get(turn);
            if(!row?.unloaded || hydrating.current.has(row))continue;
            hydrating.current.add(row);
            void Promise.resolve(owner.hydrateText(props.sessionId,turn)).catch(()=>false);
        }
    },[props.sessionId,visibleTurns,props.textIndex]);
    // private fork (B2b O10): at the top of the list, turns before the native conversation window are paged in
    // (owner.loadOlder), read-only; anchorRow keeps the reader's row in place as they arrive. A page that brings no
    // earlier turn is not retried for the same oldest turn; a failure shows ⚠ with a retry.
    const [older, setOlder] = React.useState("idle");
    const olderTried = React.useRef(null), mounted = React.useRef(true);
    React.useEffect(() => () => { mounted.current = false; }, []);
    const firstTurn = entries.length ? entries[0].turn : null;
    const atTop = viewport.top !== Infinity && range.start === 0;
    function loadOlder() {
        const owner = typeof forkStageSessions === 'object' ? forkStageSessions.owner : null;
        if (!owner || typeof owner.loadOlder !== 'function' || !owner.hasOlder(props.sessionId)) return;
        olderTried.current = firstTurn;
        setOlder("loading");
        Promise.resolve(owner.loadOlder(props.sessionId)).then(
            () => { if (mounted.current) setOlder("idle"); },
            () => { if (mounted.current) setOlder("failed"); });
    }
    React.useEffect(() => {
        if (atTop && older === "idle" && olderTried.current !== firstTurn) loadOlder();
    }, [atTop, older, firstTurn, props.sessionId]);
    React.useEffect(()=>{
        if(!props.readDirection)return;
        let active=true;
        for(const turn of JSON.parse(visibleTurns)) {
            if(phoneDirections.has(turn))continue;
            Promise.resolve(props.readDirection({turn,readOnly:true})).then(value=>{
                if(!active)return;
                const direction={phase:value.phase,through:value.through,entries:(value.entries || []).filter(entry=>entry.ops?.some(op=>op.modId==='dsh.phone'))};
                setPhoneDirections(old=>new Map(old).set(turn,direction));
            }).catch(()=>{});
        }
        return()=>{active=false;};
    },[props.sessionId,visibleTurns]);
    function readViewport() {
        const box = scroller.current;
        if (!box) return;
        const top = box.scrollTop, height = box.clientHeight;
        // Layout corrections, scroll events and ResizeObserver can report the same viewport.
        setViewport(previous => previous.top === top && previous.height === height ? previous : { top, height });
    }
    // private fork (B2 O10): rows inserted above the first visible row (an earlier turn's text arriving) keep that row
    // where the reader sees it, instead of pushing the page down (anchorRow).
    React.useLayoutEffect(function () {
        const box = scroller.current, previous = anchorRow.current;
        if (!box) return;
        if (previous && previous.entries !== entries && viewport.top !== Infinity && pendingScroll.current == null) {
            const index = entries.findIndex(entry => entry.key === previous.key);
            const shift = index >= 0 ? offsets[index] - previous.offset : 0;
            if (Math.abs(shift) > 0.5) { box.scrollTop += shift; readViewport(); }
        }
        const first = forkGalBacklogWindow(offsets, box.scrollTop, box.clientHeight, 0).start;
        anchorRow.current = { entries, key: entries[first]?.key, offset: offsets[first] || 0 };
    });
    React.useLayoutEffect(function () {
        const box = scroller.current;
        if (!box) return;
        if (pendingScroll.current != null) {
            const target = pendingScroll.current;
            pendingScroll.current = null;
            box.scrollTop = target === Infinity ? box.scrollHeight : target;
            readViewport();
        }
        const atEnd = viewport.top === Infinity || box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
        const anchor = forkGalBacklogWindow(offsets, viewport.top, viewport.height, 0).start;
        let changed = false, shift = 0;
        for (let i = range.start; i < range.end; i++) {
            const node = nodes.current.get(i), next = nodes.current.get(i + 1);
            if (!node) continue;
            const style = getComputedStyle(node);
            const height = next ? next.offsetTop - node.offsetTop : node.getBoundingClientRect().height + parseFloat(style.marginBottom);
            const previous = heights.current.get(entries[i].key) || (entries[i].type === "turn" ? 54 : 100);
            // offsetTop rounds each edge separately: a spacer shift can change their difference
            // by one pixel without resizing the row. Do not feed that jitter back into anchoring.
            if (height > 0 && Math.abs(height - previous) > 1) {
                heights.current.set(entries[i].key, height); changed = true;
                if (i < anchor) shift += height - previous;
            }
        }
        if (changed) {
            // Apply the anchor correction after React replaces the two spacer heights.
            pendingScroll.current = atEnd ? Infinity : box.scrollTop + shift;
            redraw(n => n + 1);
        } else if (pendingFocus.current != null) {
            const node = nodes.current.get(pendingFocus.current.index);
            if (node) {
                const focus = pendingFocus.current, buttons = node.querySelectorAll('button:not([disabled])');
                const target = focus.last ? buttons[buttons.length - 1] || node : focus.controlOnly ? buttons[0] || node : node;
                target.focus({ preventScroll: true }); pendingFocus.current = null;
            }
        }
    });
    React.useEffect(function () {
        const box = scroller.current;
        if (!box || typeof ResizeObserver !== "function") return;
        let width = box.clientWidth, frame = 0;
        const observer = new ResizeObserver(function () {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(function () {
                if (width !== box.clientWidth) { width = box.clientWidth; heights.current.clear(); }
                readViewport();
            });
        });
        observer.observe(box);
        nodes.current.forEach(node => observer.observe(node));
        return () => { cancelAnimationFrame(frame); observer.disconnect(); };
    }, [range.start, range.end]);
    function onListKey(event) {
        if (event.key !== "Tab") return;
        const box = scroller.current, active = document.activeElement;
        const items = Array.from(box.querySelectorAll('[tabindex="0"], button:not([disabled])'));
        if (active !== (event.shiftKey ? items[0] : items[items.length - 1])) return;
        const step = event.shiftKey ? -1 : 1;
        let index = event.shiftKey ? range.start - 1 : range.end;
        while (index >= 0 && index < entries.length && !(entries[index].type === "page")) index += step;
        if (index < 0 || index >= entries.length) return;
        event.preventDefault(); event.stopPropagation();
        pendingFocus.current = { index, last: event.shiftKey, controlOnly: false };
        box.scrollTop = offsets[index];
        readViewport();
    }
    // Opens with the current page (the last row) at the bottom, keyboard scrolling ready.
    React.useLayoutEffect(function () {
        const box = scroller.current;
        if (!box) return;
        // The current page is the last row; pin to the end (the measuring pass keeps the end pinned).
        box.scrollTop = box.scrollHeight;
        box.focus({ preventScroll: true });
        readViewport();
    }, []);
    // Wheel down past the end closes (galgame convention); a gesture still scrolling does not.
    function onWheel(event) {
        event.stopPropagation();
        const box = scroller.current;
        // private fork: positive LINE/PAGE and small trackpad deltas count at the end too.
        if (!box || !Number.isFinite(event.deltaY) || event.deltaY <= 0) return;
        const now = Date.now();
        const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 2;
        if (atEnd && now - movedAt.current > 220 && now - openedAt.current > 300) props.onClose();
    }
    const player = forkVoicePlayer.get();
    function row(entry, index) {
        const ref = node => { if (node) nodes.current.set(index, node); else nodes.current.delete(index); };
        if (entry.type === "turn") return h("div", { key: entry.key, ref, style: index === 0 ? { marginTop: 4 } : undefined, className: "fork-gal-backlog-turn" + (entry.current ? " is-current" : ""), role: "separator" },
            h("span", null, "第 " + entry.turn + " 轮" + (entry.current ? " · 本轮" : "")));
        if (entry.type === "input") return h("div", { key: entry.key, ref, className: "fork-gal-backlog-input" },
            h("span", { className: "fork-gal-backlog-you" }, "你"), h("p", null, entry.text));
        // private fork: one muted line per 文字演出 card, between the lines where it appeared.
        if (entry.type === "card") return h("div", { key: entry.key, ref, className: "fork-gal-backlog-card" },
            h("span", { className: "fork-gal-backlog-card-tag" }, entry.tag),
            h("p", null, entry.parts.flatMap((part, i) => i ? [h("span", { key: i, className: "fork-gal-backlog-card-sep", "aria-hidden": true }, " / "), part] : [part])));
        const line = entry.kind === "line";
        // private fork: use the stage/voice resolver before indexing canonical figure media.
        const speaker = line ? (forkBubbleCharacter(props.config, entry)?.alias || entry.alias) : "";
        const color = line ? props.colorOf(speaker) : "";
        const avatar = line ? props.avatarOf(speaker, entry.mood) : "";
        const name = line ? entry.name || props.nameOf(speaker) || entry.alias : "";
        const jump = true;
        const handle = entry.voice || (entry.descriptor ? props.voiceOf?.(entry.descriptor) : null);
        const voice = line ? forkGalBacklogVoice(handle, player) : null;
        const classes = "fork-gal-backlog-row" + (line ? " is-line" : " is-narration") + (entry.thought ? " is-thought" : "") + (jump ? " is-jump" : " is-past") + (entry.here ? " is-here" : "");
        const go = () => props.onJump(entry.page, entry.turn, entry.targetPara);
        return h("div", { key: entry.key, ref, className: classes, style: color ? { "--row-color": color } : undefined,
            role: jump ? "button" : undefined, tabIndex: jump ? 0 : undefined, title: jump ? (entry.here ? "当前这一页（点击回到舞台）" : "回到这一页") : undefined,
            "aria-current": entry.here ? "true" : undefined, "data-fork-stage-turn": entry.turn, "data-fork-stage-para": entry.para, "data-phone-form":entry.phoneForm,
            onClick: jump ? go : undefined,
            onKeyDown: jump ? event => { if (event.target !== event.currentTarget) return; if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); go(); } } : undefined },
            // Avatar with the chat bubble's play badge on its corner, as in the story view.
            h("div", { className: "fork-gal-backlog-face" },
                line && avatar ? h(ForkPackImage, { identity:avatar.identity, src: avatar.src, crop: avatar.crop, avatar:avatar.avatar, alt: "" }) : null,
                voice ? h(ForkVoiceButton, { voice }) : null),
            h("div", { className: "fork-gal-backlog-body" },
                line ? h("div", { className: "fork-gal-backlog-name" }, h("b", null, name), entry.thought ? h("span", { className: "fork-gal-backlog-tag" }, "心声") : null, entry.phoneForm ? h("span", { className: "fork-gal-backlog-tag" }, entry.phoneForm==='voice' ? '手机 · 语音' : '手机 · 文字') : null) : null,
                h("p", { className: "fork-gal-backlog-text" }, props.quote && line ? forkGalQuoted(entry.text, entry.pending) : entry.text, entry.pending ? h("span", { className: "fork-gal-typing", "aria-label": "正在生成" }, h("i"), h("i"), h("i")) : null)));
    }
    return h("div", { className: "fork-gal-backlog" + (props.quote ? " is-quoted" : ""), role: "dialog", "aria-modal": "true", "aria-label": "履历",
        onClick: event => event.stopPropagation(),
        onContextMenu: event => { event.preventDefault(); event.stopPropagation(); props.onClose(); },
        onWheel },
        // How to use it lives in a ? tip next to the title, not in a permanent hint line.
        h("div", { className: "fork-gal-backlog-head" },
            h("div", { className: "fork-gal-backlog-title" }, h("i", { className: "fork-gal-backlog-gem", "aria-hidden": true }), h("b", null, "履历"), h("small", null, "BACKLOG"),
                h(ForkHelpTip, { label: "履历操作说明" }, h("span", null, "点击本轮的句子回到那一页"), h("span", null, "滚轮向下到底、右键或 Esc 关闭"))),
            // Paging state of the earlier turns, over the top edge of the list (it never shifts the rows).
            older === "loading" ? h("div", { className: "fork-gal-backlog-older" }, h(ForkSpinner, { label: "正在读取更早的轮次" })) : null,
            older === "failed" ? h("div", { className: "fork-gal-backlog-older" },
                h("span", null, "⚠ 更早的轮次没有读取到"),
                h("button", { type: "button", className: "fork-gal-backlog-older-retry", onClick: event => { event.stopPropagation(); loadOlder(); } }, "重试")) : null),
        // The measuring pass owns anchoring; native anchoring can undo it as spacer margins change.
        h("div", { className: "fork-gal-backlog-list", ref: scroller, style: { overflowAnchor: "none" }, tabIndex: 0, "aria-label": "已读内容",
            onKeyDown: onListKey, onScroll: () => { movedAt.current = Date.now(); readViewport(); } },
            h("div", { className: "fork-gal-backlog-col" },
                h("div", { "aria-hidden": true, style: { height: offsets[range.start] } }),
                entries.length ? entries.slice(range.start, range.end).map((entry, index) => row(entry, range.start + index)) : h("p", { className: "fork-gal-backlog-empty" }, "还没有可以回看的内容"),
                h("div", { "aria-hidden": true, style: { height: offsets[entries.length] - offsets[range.end] } }))),
        // Close: a quiet icon button in the overlay's top-right corner (Esc / right click / wheel past the end too).
        h("button", { type: "button", className: "fork-gal-backlog-close", title: "关闭履历（Esc / 右键）", "aria-label": "关闭履历", onClick: props.onClose }, h(ForkIcon, { name: "close", size: 20 })));
}
