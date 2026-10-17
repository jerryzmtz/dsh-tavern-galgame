// Private fork (docs/fork/ui-design.md): context & session details popover on the
// composer's context ring, adapted from Pi Web's ComposerMetrics.
// Pure presentation of existing host projections — no requests, no own counters:
//   contextPressure / contextBreakdown  → context card
//   sessionStats / tokenUsage           → session cards
// Missing data renders "—", never 0.

const FORK_METRICS_TEXT = {
    title: "上下文与会话详情",
    context: "上下文已用",
    contextTokens: "当前上下文 Token",
    contextLimit: "模型上下文上限",
    system: "系统提示词（拆分）",
    tools: "工具定义（拆分）",
    messages: "消息（拆分）",
    contextHelp: "DSH 报告的当前上下文，不是累计用量；上限来自当前模型路由。系统提示词、工具定义、消息三项是宿主的拆分估算，不一定加起来等于已用量（例如不含酒馆注入的内容）。压缩后尚无新数据时显示未知。",
    session: "会话详情",
    runtime: "运行时间",
    runtimeLlm: "模型生成",
    runtimeTool: "工具执行",
    runtimeLive: "本轮进行中",
    runtimeHelp: "本会话中 AI 实际工作的时长：模型生成加工具执行，按整个会话日志累计。轮次之间你阅读或输入的时间不计入。运行中的一轮实时累加，结束后以宿主记录为准。",
    total: "累计 Token",
    totalHelp: "整个会话日志的累计用量（含已压缩的历史），不限于当前上下文。总量＝未缓存输入＋缓存读取＋缓存写入＋输出，各项只计一次。",
    cache: "缓存命中",
    cacheHelp: "按 Token 加权的命中率＝缓存读取÷（未缓存输入＋缓存读取＋缓存写入），不是请求命中次数占比。没有输入数据时显示未知，不当作 0%。",
    speed: "生成速度",
    speedHelp: "解码 Token÷解码耗时，只算首个 Token 之后的输出阶段，不含等待、预填充和工具执行；是纯解码速度。按整个会话日志累计。",
    turns: "轮次",
    turnsHelp: "本会话已记录的用户轮次。不等同于模型请求次数。",
    steps: "步数",
    stepsHelp: "模型请求（助手步）的次数，一轮里调用工具后继续生成会再计一步。",
    latency: "首字延迟",
    latencyHelp: "从一步开始到首个内容增量的平均时间，按有记录的步平均。DSH 只提供总和与次数，因此是平均值，不是 P95。",
    input: "未缓存输入",
    inputHelp: "累计未缓存输入，不含缓存读取和写入。",
    output: "输出 Token",
    outputHelp: "累计输出 Token。推理（思考）Token 是否计入取决于提供商，不额外估算。",
    cost: "费用",
    rateInput: "输入 $/M", rateCacheRead: "缓存读 $/M", rateCacheWrite: "缓存写 $/M", rateOutput: "输出 $/M",
    cacheTtl: "缓存剩余",
    cacheExpired: "已过期",
    cacheTtlLength: "缓存时长",
    cacheLastRequest: "上次请求",
    cacheTtlHelp: "倒计时从本会话最近一次模型请求开始时算起，按 1 小时计；过期后下一次请求要重新写入整个上下文，费用更高。是估计：上游实际保留时间可能不同。",
    cacheRead: "缓存读取", cacheWrite: "缓存写入", inputTotal: "输入 Token 合计",
    llmSteps: "有首字记录的步", decodeTokens: "解码 Token", decodeTime: "解码耗时",
    unknown: "暂无数据"
};
const FORK_CACHE_TTL_MS = 60 * 60 * 1000;
const FORK_METRICS_FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex="0"]';

function forkMetricNumber(value) { return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null; }
function forkFormatMetric(value) {
    const n = forkMetricNumber(value);
    if (n === null) return "—";
    for (const [scale, suffix] of [[1e9, "B"], [1e6, "M"], [1e3, "K"]]) if (n >= scale) return Number((n / scale).toFixed(1)) + suffix;
    return String(Math.round(n));
}
function forkFormatSeconds(value) { const n = forkMetricNumber(value); return n === null ? "—" : (n / 1000).toFixed(2) + " s"; }
function forkFormatDuration(value) {
    const n = forkMetricNumber(value);
    if (n === null) return "—";
    const total = Math.floor(n / 1000), h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    const pad = v => String(v).padStart(2, "0");
    return h > 0 ? h + "h " + pad(m) + "m" : m > 0 ? m + "m " + pad(s) + "s" : s + "s";
}
function forkFormatCost(value) {
    const n = forkMetricNumber(value);
    if (n === null) return "—";
    if (n > 0 && n < 0.0001) return "< $0.0001";
    return "$" + n.toFixed(n > 0 && n < 1 ? 4 : 2);
}
function forkFormatCountdown(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000)), m = Math.floor(total / 60), s = total % 60;
    return m + ":" + String(s).padStart(2, "0");
}
// Start of the session's most recent model request (the prompt-cache clock), from Chat nodes.
function forkLastRequestStart(nodes) {
    if (!Array.isArray(nodes)) return null;
    for (let i = nodes.length - 1; i >= 0; i--) {
        const node = nodes[i];
        if (!node || node.kind !== "assistant") continue;
        const start = node.timing && typeof node.timing.stepStartTime === "number" ? node.timing.stepStartTime : typeof node.time === "number" ? node.time : null;
        if (start !== null) return start;
    }
    return null;
}
function forkExact(value) { const n = forkMetricNumber(value); return n === null ? "—" : n.toLocaleString("zh-CN", { maximumFractionDigits: 4 }); }
function forkSumKnown() {
    const values = Array.from(arguments).map(forkMetricNumber);
    return values.some(v => v === null) ? null : values.reduce((a, b) => a + b, 0);
}
function forkContextMetrics(pressure, breakdown) {
    const tokens = forkMetricNumber(pressure && (pressure.projectedTokens !== undefined ? pressure.projectedTokens : pressure.pressureTokens));
    const limit = forkMetricNumber(pressure && pressure.contextWindow);
    const contextWindow = limit && limit > 0 ? limit : null;
    const percent = tokens !== null && contextWindow !== null ? tokens / contextWindow * 100 : null;
    const parts = breakdown ? [["system", breakdown.systemTokens], ["tools", breakdown.toolsTokens], ["messages", breakdown.messageTokens]].map(p => [p[0], forkMetricNumber(p[1])]) : null;
    const partsTotal = parts && parts.every(p => p[1] !== null) ? parts.reduce((a, p) => a + p[1], 0) : 0;
    return { tokens, contextWindow, percent, barPercent: Math.min(100, percent || 0), parts: partsTotal > 0 ? parts : null, partsTotal };
}
// Fixed-position overlays in visual-viewport coordinates (Pi Web placeMetricOverlay).
function forkPlaceOverlay(anchor, size, viewport, nearby) {
    const gap = 8, margin = 12;
    const minX = viewport.left + margin, minY = viewport.top + margin;
    const maxX = Math.max(minX, viewport.left + viewport.width - size.width - margin);
    const maxY = Math.max(minY, viewport.top + viewport.height - size.height - margin);
    const clampX = n => Math.max(minX, Math.min(n, maxX)), clampY = n => Math.max(minY, Math.min(n, maxY));
    const right = anchor.left + anchor.width, bottom = anchor.top + anchor.height;
    if (nearby) {
        if (right + gap <= maxX) return { left: right + gap, top: clampY(anchor.top - 8) };
        if (anchor.left - gap - size.width >= minX) return { left: anchor.left - gap - size.width, top: clampY(anchor.top - 8) };
    }
    const above = anchor.top - gap - size.height, below = bottom + gap;
    return { left: clampX(nearby ? anchor.left - size.width / 2 + anchor.width / 2 : right - size.width), top: above >= minY ? above : below <= maxY ? below : clampY(above) };
}
function forkViewport() {
    const vv = window.visualViewport;
    return { left: vv ? vv.offsetLeft : 0, top: vv ? vv.offsetTop : 0, width: vv ? vv.width : window.innerWidth, height: vv ? vv.height : window.innerHeight };
}

function ForkComposerMetrics(props) {
    const h = React.createElement, T = FORK_METRICS_TEXT;
    const useProjection = typeof props.useProjection === "function" ? props.useProjection : function () { return undefined; };
    const pressure = useProjection("contextPressure");
    const breakdown = useProjection("contextBreakdown");
    const stats = useProjection("sessionStats");
    const usage = useProjection("tokenUsage");
    const running = typeof props.useSession === "function" ? props.useSession(function (s) { return s.running === true; }) : false;
    const lastRequest = typeof props.useChat === "function" ? props.useChat(function (s) { return forkLastRequestStart(s && s.legacy && s.legacy.nodes); }) : null;
    const [quote, setQuote] = React.useState(null);

    const [open, setOpen] = React.useState(false);
    const [activeInfo, setActiveInfo] = React.useState(null);
    const [position, setPosition] = React.useState({ left: 12, top: 12 });
    const [infoPosition, setInfoPosition] = React.useState({ left: 12, top: 12 });
    const [now, setNow] = React.useState(Date.now);
    const trigger = React.useRef(null), panel = React.useRef(null), tooltip = React.useRef(null);
    const infoButtons = React.useRef({});
    const pinned = React.useRef(false), pinnedInfo = React.useRef(null), suppressFocus = React.useRef(false);
    const hovering = React.useRef(new Set());
    const closeTimer = React.useRef(null), infoTimer = React.useRef(null), focusOnOpen = React.useRef(false);
    // Live runtime: host totals settle when a turn ends; until then count locally.
    const runStart = React.useRef(null);
    if (running && runStart.current === null) runStart.current = Date.now();
    if (!running && runStart.current !== null) runStart.current = null;

    // Prices follow the session's current model; ask the host each time the panel opens.
    React.useEffect(function () {
        if (!open || !props.presentation) return;
        let active = true;
        props.presentation.getModelPricing(props.sessionId).then(function (result) { if (active) setQuote(result || null); }, function (error) { if (active) setQuote({ available: false, reason: String(error && error.message || error) }); });
        return function () { active = false; };
    }, [open, props.sessionId]);
    React.useEffect(function () {
        if (!open || (!running && lastRequest === null)) return;
        setNow(Date.now());
        const timer = setInterval(function () { setNow(Date.now()); }, 1000);
        return function () { clearInterval(timer); };
    }, [open, running, lastRequest]);

    const cancelClose = React.useCallback(function () { if (closeTimer.current) clearTimeout(closeTimer.current); closeTimer.current = null; }, []);
    const cancelInfoClose = React.useCallback(function () { if (infoTimer.current) clearTimeout(infoTimer.current); infoTimer.current = null; }, []);
    const inside = React.useCallback(function (node) {
        return Boolean(node && ((trigger.current && trigger.current.contains(node)) || (panel.current && panel.current.contains(node)) || (tooltip.current && tooltip.current.contains(node))));
    }, []);
    const close = React.useCallback(function (restoreFocus) {
        cancelClose(); cancelInfoClose();
        pinned.current = false; pinnedInfo.current = null; hovering.current.clear(); focusOnOpen.current = false;
        setActiveInfo(null); setOpen(false);
        if (restoreFocus && trigger.current) { suppressFocus.current = true; trigger.current.focus({ preventScroll: true }); suppressFocus.current = false; }
    }, [cancelClose, cancelInfoClose]);
    function keepOpen() { cancelClose(); setOpen(true); }
    function closeSoon() {
        cancelClose();
        closeTimer.current = setTimeout(function () { if (!pinned.current && hovering.current.size === 0 && !inside(document.activeElement)) close(); }, 180);
    }
    function leaveInfo() {
        cancelInfoClose();
        infoTimer.current = setTimeout(function () {
            const focused = Object.keys(infoButtons.current).some(function (key) { return infoButtons.current[key] === document.activeElement; });
            if (!hovering.current.has("tooltip") && !pinnedInfo.current && !focused) setActiveInfo(null);
        }, 180);
    }
    function showInfo(key) { cancelClose(); cancelInfoClose(); pinnedInfo.current = null; setActiveInfo(key); }
    React.useEffect(function () { if (activeInfo === null) hovering.current.delete("tooltip"); }, [activeInfo]);
    React.useEffect(function () { return function () { cancelClose(); cancelInfoClose(); }; }, [cancelClose, cancelInfoClose]);

    React.useEffect(function () {
        if (!open) return;
        function dismiss(event) {
            if (!inside(event.target)) close();
            else if (activeInfo && !(tooltip.current && tooltip.current.contains(event.target)) && !(infoButtons.current[activeInfo] && infoButtons.current[activeInfo].contains(event.target))) { pinnedInfo.current = null; setActiveInfo(null); }
        }
        function keydown(event) {
            if (event.key !== "Escape") return;
            if (event.isComposing || event.keyCode === 229) { event.stopPropagation(); return; }
            // The host's window-level Escape aborts generation; dismiss overlays first.
            event.preventDefault(); event.stopPropagation();
            if (activeInfo) { cancelInfoClose(); pinnedInfo.current = null; setActiveInfo(null); }
            else close(Boolean((panel.current && panel.current.contains(document.activeElement)) || (tooltip.current && tooltip.current.contains(document.activeElement))));
        }
        function focusin(event) { if (!inside(event.target)) close(); }
        function visibility() { if (document.hidden) close(); }
        document.addEventListener("pointerdown", dismiss, true);
        document.addEventListener("keydown", keydown, true);
        document.addEventListener("focusin", focusin);
        document.addEventListener("visibilitychange", visibility);
        return function () {
            document.removeEventListener("pointerdown", dismiss, true);
            document.removeEventListener("keydown", keydown, true);
            document.removeEventListener("focusin", focusin);
            document.removeEventListener("visibilitychange", visibility);
        };
    }, [open, activeInfo, close, cancelInfoClose, inside]);

    React.useLayoutEffect(function () {
        if (!open) return;
        function place() {
            if (!trigger.current || !panel.current) return;
            const anchor = trigger.current.getBoundingClientRect();
            if (!anchor.width || !anchor.height) { close(); return; }
            const viewport = forkViewport();
            const maxWidth = Math.max(1, viewport.width - 24), maxHeight = Math.max(1, viewport.height - 24);
            panel.current.style.maxWidth = maxWidth + "px"; panel.current.style.maxHeight = maxHeight + "px";
            const next = forkPlaceOverlay(anchor, panel.current.getBoundingClientRect(), viewport);
            panel.current.style.left = next.left + "px"; panel.current.style.top = next.top + "px";
            setPosition({ left: next.left, top: next.top, maxWidth: maxWidth, maxHeight: maxHeight });
            if (activeInfo && tooltip.current) {
                const button = infoButtons.current[activeInfo];
                if (!button) return;
                const target = button.getBoundingClientRect(), bounds = panel.current.getBoundingClientRect();
                if (target.bottom < bounds.top || target.top > bounds.bottom) { pinnedInfo.current = null; setActiveInfo(null); return; }
                tooltip.current.style.maxWidth = maxWidth + "px"; tooltip.current.style.maxHeight = maxHeight + "px";
                const spot = forkPlaceOverlay(target, tooltip.current.getBoundingClientRect(), viewport, true);
                setInfoPosition({ left: spot.left, top: spot.top, maxWidth: maxWidth, maxHeight: maxHeight });
            }
        }
        place();
        if (focusOnOpen.current) { focusOnOpen.current = false; const first = panel.current && panel.current.querySelector("button"); if (first) first.focus(); }
        const observer = typeof ResizeObserver === "function" ? new ResizeObserver(place) : null;
        if (observer) { observer.observe(trigger.current); observer.observe(panel.current); if (tooltip.current) observer.observe(tooltip.current); }
        const vv = window.visualViewport;
        window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
        if (vv) { vv.addEventListener("resize", place); vv.addEventListener("scroll", place); }
        return function () {
            if (observer) observer.disconnect();
            window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
            if (vv) { vv.removeEventListener("resize", place); vv.removeEventListener("scroll", place); }
        };
    }, [open, activeInfo, pressure, breakdown, stats, usage, close]);

    const c = forkContextMetrics(pressure, breakdown);
    const input = forkMetricNumber(usage && usage.uncachedInputTokens), cacheRead = forkMetricNumber(usage && usage.cacheReadTokens);
    const cacheWrite = forkMetricNumber(usage && usage.cacheWriteTokens), output = forkMetricNumber(usage && usage.outputTokens);
    const inputTotal = forkSumKnown(input, cacheRead, cacheWrite);
    const total = forkMetricNumber(usage && usage.totalTokens) !== null ? usage.totalTokens : forkSumKnown(inputTotal, output);
    const hitPercent = inputTotal !== null && inputTotal > 0 && cacheRead !== null ? cacheRead / inputTotal * 100 : null;
    const llmMs = forkMetricNumber(stats && stats.llmMs), toolMs = forkMetricNumber(stats && stats.toolMs);
    const recorded = llmMs === null && toolMs === null ? null : (llmMs || 0) + (toolMs || 0);
    const liveMs = running && runStart.current !== null ? Math.max(0, now - runStart.current) : null;
    const runtime = recorded === null && liveMs === null ? null : (recorded || 0) + (liveMs || 0);
    const decodeMs = forkMetricNumber(stats && stats.decodeMs), decodeTokens = forkMetricNumber(stats && stats.decodeTokens);
    const tps = decodeMs && decodeTokens !== null ? decodeTokens / (decodeMs / 1000) : null;
    const ttftSteps = forkMetricNumber(stats && stats.ttftSteps), ttftTotal = forkMetricNumber(stats && stats.ttftMs);
    const ttftMean = ttftSteps && ttftTotal !== null ? ttftTotal / ttftSteps : null;
    const r = quote && quote.available ? quote.rates : null;
    const cost = r && input !== null && cacheRead !== null && cacheWrite !== null && output !== null
        ? (input * r.input + cacheRead * r.cacheRead + cacheWrite * r.cacheWrite + output * r.output) / 1e6 : null;
    const cacheRemaining = lastRequest === null ? null : running ? FORK_CACHE_TTL_MS : Math.max(0, lastRequest + FORK_CACHE_TTL_MS - now);
    const pct = v => v === null ? "—" : Number(v.toFixed(1)) + "%";
    const row = (label, value) => ({ label: label, value: forkExact(value) });
    const tokenRows = [row(T.input, input), row(T.cacheRead, cacheRead), row(T.cacheWrite, cacheWrite), row(T.output, output), row(T.total, total)];

    const highlights = [
        { id: "runtime", label: T.runtime, value: forkFormatDuration(runtime), live: running, details: [{ label: T.runtimeLlm, value: forkFormatDuration(llmMs) }, { label: T.runtimeTool, value: forkFormatDuration(toolMs) }].concat(liveMs === null ? [] : [{ label: T.runtimeLive, value: forkFormatDuration(liveMs) }]), explanation: T.runtimeHelp },
        { id: "cost", label: T.cost, value: forkFormatCost(cost), details: [
            { label: "USD", value: cost === null ? "—" : cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }) },
            { label: T.rateInput, value: r ? String(r.input) : "—" }, { label: T.rateCacheRead, value: r ? String(r.cacheRead) : "—" },
            { label: T.rateCacheWrite, value: r ? String(r.cacheWrite) : "—" }, { label: T.rateOutput, value: r ? String(r.output) : "—" }
        ] },
        { id: "total", label: T.total, value: forkFormatMetric(total), details: tokenRows, explanation: T.totalHelp },
        { id: "cache", label: T.cache, value: pct(hitPercent),
            details: [row(T.cacheRead, cacheRead), row(T.cacheWrite, cacheWrite), row(T.inputTotal, inputTotal)].concat(lastRequest === null ? [] : [
                { label: T.cacheTtlLength, value: forkFormatCountdown(FORK_CACHE_TTL_MS) },
                { label: T.cacheLastRequest, value: new Date(lastRequest).toLocaleTimeString("zh-CN") }]),
            explanation: T.cacheHelp + (lastRequest === null ? "" : " " + T.cacheTtlHelp) }
    ];
    const details = [
        { id: "speed", label: T.speed, value: tps === null ? "—" : tps.toFixed(1) + " tok/s", details: [row(T.decodeTokens, decodeTokens), { label: T.decodeTime, value: forkFormatSeconds(decodeMs) }], explanation: T.speedHelp },
        { id: "turns", label: T.turns, value: forkExact(stats && stats.turns), details: [row(T.turns, stats && stats.turns)], explanation: T.turnsHelp },
        { id: "steps", label: T.steps, value: forkExact(stats && stats.steps), details: [row(T.steps, stats && stats.steps)], explanation: T.stepsHelp },
        { id: "latency", label: T.latency, value: forkFormatSeconds(ttftMean), details: [{ label: T.latency, value: forkFormatSeconds(ttftMean) }, row(T.llmSteps, ttftSteps)], explanation: T.latencyHelp },
        { id: "input", label: T.input, value: forkFormatMetric(input), details: tokenRows.slice(0, 3), explanation: T.inputHelp },
        { id: "output", label: T.output, value: forkFormatMetric(output), details: [row(T.output, output)], explanation: T.outputHelp }
    ];
    const contextInfo = { label: T.context, details: [row(T.contextTokens, c.tokens), row(T.contextLimit, c.contextWindow)].concat(c.parts ? c.parts.map(p => row(T[p[0]], p[1])) : []), explanation: T.contextHelp };
    const info = activeInfo === "context" ? contextInfo : highlights.concat(details).find(card => card.id === activeInfo);
    const level = c.percent === null ? undefined : c.percent >= 90 ? "critical" : c.percent >= 75 ? "high" : undefined;

    function infoProps(key) {
        return {
            ref: function (node) { infoButtons.current[key] = node; },
            type: "button", "data-metric-info": key,
            "aria-describedby": activeInfo === key ? "fork-metrics-detail" : undefined,
            onPointerEnter: function (event) { if (event.pointerType !== "touch") showInfo(key); },
            onPointerLeave: leaveInfo,
            onFocus: function () { if (!suppressFocus.current) showInfo(key); },
            onBlur: function (event) { if (!(tooltip.current && tooltip.current.contains(event.relatedTarget))) { pinnedInfo.current = null; leaveInfo(); } },
            onClick: function () {
                cancelInfoClose();
                if (pinnedInfo.current === key) { pinnedInfo.current = null; setActiveInfo(null); }
                else { pinnedInfo.current = key; setActiveInfo(key); }
            }
        };
    }
    function tile(card, variant) {
        return h("button", Object.assign({ key: card.id }, infoProps(card.id), { className: "fork-metrics-tile fork-metrics-tile-" + variant, "data-metric": card.id, "data-live": card.live || undefined }),
            h("span", { className: "fork-metrics-tile-label" }, card.live ? h("i", { className: "fork-metrics-live-dot", "aria-hidden": true }) : null, card.label),
            h("strong", { className: "fork-metrics-value" }, card.value));
    }
    function focusFirst() {
        pinned.current = true; keepOpen();
        const first = panel.current && panel.current.querySelector("button");
        if (first) first.focus(); else focusOnOpen.current = true;
    }
    const portal = ReactDOM && typeof ReactDOM.createPortal === "function" ? ReactDOM.createPortal : null;
    const R = 7, dash = c.barPercent;

    return h(React.Fragment, null,
        h("span", { className: "fork-metrics" },
            h("button", { ref: trigger, type: "button", className: "fork-metrics-trigger", "data-level": level, "aria-label": T.title + "：" + (c.percent === null ? T.unknown : T.context + " " + Math.round(c.percent) + "%"),
                "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": open ? "fork-metrics-panel" : undefined,
                onPointerEnter: function (event) { if (event.pointerType !== "touch") { hovering.current.add("trigger"); keepOpen(); } },
                onPointerLeave: function () { hovering.current.delete("trigger"); closeSoon(); },
                onClick: function () { if (pinned.current) close(); else { pinned.current = true; keepOpen(); } },
                onFocus: function () { if (!suppressFocus.current) keepOpen(); }, onBlur: closeSoon,
                onKeyDown: function (event) {
                    if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey && open)) { event.preventDefault(); event.stopPropagation(); focusFirst(); }
                } },
                h("svg", { width: 18, height: 18, viewBox: "0 0 20 20", "aria-hidden": true },
                    h("circle", { cx: 10, cy: 10, r: R, fill: "none", stroke: "var(--fork-hairline, currentColor)", strokeWidth: 3 }),
                    c.percent === null ? null : h("circle", { className: "fork-metrics-ring", cx: 10, cy: 10, r: R, fill: "none", stroke: "currentColor", strokeWidth: 3, strokeLinecap: "round", pathLength: 100, strokeDasharray: dash + " 100", transform: "rotate(-90 10 10)" })),
                h("span", null, c.percent === null ? "—" : Math.round(c.percent) + "%"))),
        open && portal ? portal(h("div", { ref: panel, id: "fork-metrics-panel", className: "fork-metrics-popover", role: "dialog", "aria-modal": "false", "aria-label": T.title, style: position,
            onPointerEnter: function (event) { if (event.pointerType !== "touch") { hovering.current.add("panel"); cancelClose(); } },
            onPointerLeave: function () { hovering.current.delete("panel"); closeSoon(); },
            onKeyDown: function (event) {
                if (event.key !== "Tab") return;
                event.stopPropagation();
                const buttons = Array.from(panel.current.querySelectorAll("button"));
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); if (trigger.current) trigger.current.focus(); }
                else if (!event.shiftKey && document.activeElement === buttons[buttons.length - 1]) {
                    event.preventDefault();
                    const all = Array.from(document.querySelectorAll(FORK_METRICS_FOCUSABLE)).filter(function (node) { return node.getClientRects().length && !panel.current.contains(node) && !(tooltip.current && tooltip.current.contains(node)); });
                    const next = all[all.indexOf(trigger.current) + 1];
                    close();
                    if (next) next.focus(); else if (trigger.current) { suppressFocus.current = true; trigger.current.focus(); suppressFocus.current = false; }
                }
            } },
            h("div", { className: "fork-metrics-context", "data-level": level },
                h("button", Object.assign({}, infoProps("context"), { className: "fork-metrics-context-button" }),
                    // One row: small light label + large percentage, figures and cache countdown on the right.
                    h("span", { className: "fork-metrics-context-row" },
                        h("span", { className: "fork-metrics-context-lead" },
                            h("span", { className: "fork-metrics-context-label" }, "上下文"),
                            h("b", { className: "fork-metrics-context-percent" }, pct(c.percent))),
                        h("span", { className: "fork-metrics-context-size" },
                            forkFormatMetric(c.tokens) + " / " + forkFormatMetric(c.contextWindow),
                            cacheRemaining === null ? null : h("span", { className: "fork-metrics-sub", "data-expired": cacheRemaining === 0 || undefined },
                                cacheRemaining > 0 ? T.cacheTtl + " " + forkFormatCountdown(cacheRemaining) : "缓存" + T.cacheExpired)))),
                h("div", { className: "fork-metrics-bar", role: "progressbar", "aria-label": T.context, "aria-valuemin": 0, "aria-valuemax": 100,
                    "aria-valuenow": c.percent === null ? undefined : Math.round(c.barPercent), "aria-valuetext": c.percent === null ? T.unknown : pct(c.percent), "data-unknown": c.percent === null },
                    h("span", { style: { width: c.barPercent + "%" } }))),
            h("section", { className: "fork-metrics-session", "aria-label": T.session },
                h("h3", { className: "fork-metrics-eyebrow" }, T.session),
                h("div", { className: "fork-metrics-highlights" }, highlights.map(card => tile(card, "highlight"))),
                h("div", { className: "fork-metrics-details" }, details.map(card => tile(card, "detail"))))), document.body) : null,
        open && info && portal ? portal(h("div", { ref: tooltip, id: "fork-metrics-detail", role: "tooltip", className: "fork-metrics-tooltip", style: infoPosition,
            onPointerEnter: function (event) { if (event.pointerType !== "touch") { hovering.current.add("tooltip"); cancelInfoClose(); cancelClose(); } },
            onPointerLeave: function () { hovering.current.delete("tooltip"); leaveInfo(); closeSoon(); } },
            h("strong", null, info.label),
            h("dl", null, info.details.map(function (detail, i) { return h("div", { key: detail.label + i }, h("dt", null, detail.label), h("dd", null, detail.value)); })),
            info.explanation ? h("p", null, info.explanation) : null), document.body) : null);
}
