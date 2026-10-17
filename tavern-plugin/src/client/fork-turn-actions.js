// Private fork (docs/fork/ui-design.md): the action row under each reply.
//   [编辑] [变量] [重roll] [⋯]  time
// Edit / regenerate / delete / undo only apply to the latest round; the variable
// icon and the ⋯ menu (fork from here) appear under every reply. Included inside
// the play-controls module so it reuses the upstream actions, which keep their own
// rules (hidden or disabled when unavailable).

const FORK_RECEIPT_TITLES = {
    pending: "变量结算中", updated: "变量已更新", partial: "变量部分更新失败", error: "变量更新失败",
    stale: "变量结算已过期", interrupted: "变量结算已中断", unchanged: "本轮无需更新变量"
};

// DSH turn of a reply: the host's fork map, else the Chat node carrying that message.
function forkDshTurnOf(view, messageId, chatTurn) {
    return Number(view && view.forkTurnsByMessageId && view.forkTurnsByMessageId[String(messageId || "")]) || Number(chatTurn) || 0;
}
function useForkChatTurn(props) {
    return props.useChat(function (state) {
        const nodes = state && state.legacy && state.legacy.nodes || [];
        for (let i = nodes.length - 1; i >= 0; i--) if (nodes[i] && nodes[i].messageId === props.messageId) return Number(nodes[i].turn) || 0;
        return 0;
    });
}
function forkReceiptForMessage(view, messageId, chatTurn) {
    const dshTurn = forkDshTurnOf(view, messageId, chatTurn);
    if (!dshTurn) return null;
    const storyTurn = tavernStoryTurnForDshTurn(view, dshTurn);
    const receipt = storyTurn ? tavernMvuReceiptForTurn(view, storyTurn) : null;
    return receipt ? { receipt: receipt, storyTurn: storyTurn } : null;
}

// Floating layer anchored to a button; closes on outside click and Esc.
function useForkPopover(open, setOpen, anchor, layer) {
    React.useEffect(function () {
        if (!open) return;
        function outside(event) { if (anchor.current && anchor.current.contains(event.target)) return; if (layer.current && layer.current.contains(event.target)) return; setOpen(false); }
        function escape(event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } }
        document.addEventListener("pointerdown", outside, true);
        document.addEventListener("keydown", escape, true);
        return function () { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape, true); };
    }, [open]);
}

function ForkReceiptButton(props) {
    const h = React.createElement;
    const live = useLiveTavernView(props.sessionId, "receipt:" + String(props.messageId || ""));
    const [open, setOpen] = React.useState(false);
    const view = live.view;
    const found = forkReceiptForMessage(view, props.messageId, useForkChatTurn(props));
    if (!found) return null;
    const receipt = found.receipt;
    const status = FORK_RECEIPT_TITLES[receipt.status] ? receipt.status : "unchanged";
    const busy = Boolean(view && view.activity && view.activity.busy);
    const changes = Array.isArray(receipt.changes) ? receipt.changes.length : 0;
    const failures = Array.isArray(receipt.failures) ? receipt.failures.length : 0;
    const title = FORK_RECEIPT_TITLES[status] + (status === "updated" && changes ? " · " + changes + " 项" : "") + (failures ? " · 失败 " + failures + " 项" : "") + "（点击查看详情）";
    const shown = status === "pending" && busy ? "running" : status;
    // Sliders icon + an inline count (not a corner badge); other states tint the icon.
    const detail = status === "updated" && changes ? (changes > 99 ? "99+" : String(changes)) : status === "partial" ? changes + "/" + (changes + failures) : "";
    const subtitle = "第 " + found.storyTurn + " 轮 · " + (status === "updated" ? (changes ? changes + " 项" : "已更新") : status === "partial" ? changes + " 项 · 失败 " + failures + " 项" : FORK_RECEIPT_TITLES[status]);
    return h(React.Fragment, null,
        h("button", { type: "button", className: "fork-receipt-icon", "data-receipt": shown, title: title, "aria-label": title, onClick: function () { setOpen(true); } },
            detail ? h("span", { className: "fork-receipt-count" }, detail) : null),
        open ? forkPortal(h("div", { className: "fork-dialog-backdrop", onPointerDown: function (event) { if (event.target === event.currentTarget) setOpen(false); } },
            h("div", { className: "fork-dialog", role: "dialog", "aria-label": "第 " + found.storyTurn + " 轮变量结算",
                ref: function (node) { if (node && !node.contains(document.activeElement)) node.focus(); }, tabIndex: -1,
                onKeyDown: function (event) { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setOpen(false); } } },
                h("header", { className: "fork-dialog-head" },
                    h("div", { className: "fork-dialog-title" },
                        h("strong", null, "变量变化"),
                        h("span", { className: "fork-dialog-subtitle", "data-status": status }, subtitle),
                        found.storyTurn === (view && view.settlementTurn) ? h(ForkVariableRetryButton, { sessionId: props.sessionId, turn: found.storyTurn, status: status, busy: busy }) : null),
                    h("button", { type: "button", className: "fork-dialog-close", "aria-label": "关闭", onClick: function () { setOpen(false); } }, "×")),
                h("div", { className: "fork-dialog-body fork-var-body" },
                    h(ForkVariableReceipt, { receipt: receipt, sessionId: props.sessionId, turn: found.storyTurn, latest: found.storyTurn === (view && view.settlementTurn), busy: busy }))))) : null);
}

function ForkTurnMenu(props) {
    const h = React.createElement;
    const [open, setOpen] = React.useState(false);
    const [position, setPosition] = React.useState(null);
    const anchor = React.useRef(null), layer = React.useRef(null);
    const live = useLiveTavernView(props.sessionId, "menu:" + String(props.messageId || ""));
    const view = live.view;
    const forkTurn = forkDshTurnOf(view, props.messageId, useForkChatTurn(props));
    useForkPopover(open, setOpen, anchor, layer);
    function toggle() {
        if (!open && anchor.current) { const rect = anchor.current.getBoundingClientRect(); setPosition({ left: rect.left, top: rect.bottom + 4 }); }
        setOpen(!open);
    }
    async function fork() {
        setOpen(false);
        try { await tavernConversationForkRequests.request({ sessionId: props.sessionId, turn: forkTurn }); }
        catch (error) { tavernErrorHub.report("分叉对话", error); }
    }
    if (!forkTurn && !props.latest) return null;
    return h(React.Fragment, null,
        h("button", { ref: anchor, type: "button", className: "fork-turn-more", title: "更多", "aria-label": "更多", "aria-haspopup": "menu", "aria-expanded": open, onClick: toggle }),
        open && position ? forkPortal(h("div", { ref: layer, className: "fork-turn-menu", role: "menu", style: { left: position.left + "px", top: position.top + "px" },
            onClick: function (event) { if (event.target.closest("button:not(:disabled)")) window.setTimeout(function () { setOpen(false); }, 0); } },
            forkTurn ? h("button", { type: "button", role: "menuitem", onClick: fork }, "从这里分支") : null,
            props.latest ? h(TavernUndoRollbackAction, props) : null,
            props.latest ? h(TavernRollbackAction, props) : null)) : null);
}

function ForkTurnActions(props) {
    const mode = useTavernSessionMode(props.sessionId);
    const latestMessageId = props.useChat(latestTavernAssistantMessageId);
    if (!isPlayMode(mode) || !props.messageId) return null;
    const latest = props.messageId === latestMessageId;
    const h = React.createElement;
    return h("span", { className: "dsh-fork-turn-actions" },
        latest ? h("span", { "data-fork-turn": "edit", title: "编辑正文" }, h(TavernEditBodyAction, props)) : null,
        h("span", { "data-fork-turn": "receipt" }, h(ForkReceiptButton, props)),
        latest ? h("span", { "data-fork-turn": "regen" }, h(CandidateAction, Object.assign({}, props, { only: "regen" }))) : null,
        h("span", { "data-fork-turn": "more" }, h(ForkTurnMenu, Object.assign({}, props, { latest: latest }))));
}

// ---------------------------------------------------------------------------
// private fork: joint progress belongs to the button; only native foreground
// compaction owns a history divider. Keep dismissible failures below the story.
const forkCompactionRuns = (function () {
    const runs = new Map(), listeners = new Set();
    function emit() { listeners.forEach(function (fn) { fn(); }); }
    return {
        subscribe(fn) { listeners.add(fn); return function () { listeners.delete(fn); }; },
        get(sessionId) { return runs.get(sessionId) || null; },
        set(sessionId, value) { if (value) runs.set(sessionId, value); else runs.delete(sessionId); emit(); }
    };
})();

function forkCompactionMessage(message) {
    return String(message || "").replace(/Compacted (\d+) history items \(~([\d,]+) tokens\)\./g, function (_, count, tokens) {
        return "已压缩 " + count + " 条历史记录（原文约 " + Number(tokens.replace(/,/g, "")).toLocaleString("en-US") + " tokens）";
    });
}
function forkCompactionSideText(side) {
    if (!side) return "等待中";
    if (side.status === "dispatching") return "压缩中…";
    if (side.status === "pending") return "等待中";
    return forkCompactionMessage(side.message) || ({ succeeded: "压缩完成", skipped: "无需压缩", failed: "压缩失败" }[side.status] || "等待中");
}
function forkCompactionProgressTitle(operation) {
    return operation ? "前台：" + forkCompactionSideText(operation.foreground) + "；后台：" + forkCompactionSideText(operation.background) : "";
}
function useForkCompactionState(sessionId) {
    const local = React.useSyncExternalStore(forkCompactionRuns.subscribe, function () { return forkCompactionRuns.get(sessionId); });
    const live = useLiveTavernView(sessionId, "compaction:" + String(local && local.phase || ""));
    const state = live.view && live.view.contextCompaction || null;
    return { local: local, live: live, state: state, operation: state && state.operation,
        running: Boolean(local && local.phase === "running" || state && state.operation && state.operation.status === "running") };
}
function ForkCompactionLine(props) {
    const h = React.createElement;
    const status = useForkCompactionState(props.sessionId);
    const local = status.local, live = status.live, state = status.state;
    const warning = state && state.warning || "";
    if (!isPlayMode(live.view && live.view.mode) || status.running) return null;
    let phase = null, text = "";
    if (local && local.phase === "failed") { phase = "failed"; text = local.message || "压缩未完成"; }
    else if (warning) { phase = "failed"; text = forkCompactionMessage(warning); }
    if (!phase) return null;
    function dismiss() {
        forkCompactionRuns.set(props.sessionId, null);
        if (warning) rpc("dismissCompactionWarning", { sessionId: props.sessionId }, props.sessionId).then(function () { liveTavernView.invalidate(props.sessionId); }, function (error) { tavernErrorHub.report("关闭压缩提示", error); });
    }
    return h("div", { className: "fork-compaction-line", "data-phase": phase, role: "status" },
        h("span", { className: "fork-compaction-text", title: text }, phase === "running" ? h(ForkSpinner, { className: "fork-compaction-dots" }) : null, text),
        phase === "failed" ? h("button", { type: "button", className: "fork-compaction-dismiss", "aria-label": "关闭", title: "关闭", onClick: dismiss }, "×") : null);
}
