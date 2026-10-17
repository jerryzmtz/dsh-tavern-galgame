// Private fork (docs/fork/galgame-stage.md): the galgame stage's "what next" menu.
// Included inside the play-controls feature module so it reuses the candidate pipeline
// (Candidate Generator via submitTask, the shared candidate panel) instead of a new one.
// The host schedules automatic generation on live completion. This view only generates on
// an explicit click; opening the stage never starts a second task or retries a failed one.
// "generating" only while a candidate task for this message is pending or running (status "loading"). The auto
// preference alone is not enough: the host never backfills an older reply, so auto-on with no task offers the button.
function forkGalEndPanelState({ status, atEnd }) {
    if (!atEnd) return "hidden";
    if (status === "ready") return "ready";
    if (status === "error") return "failed";
    if (status === "loading") return "generating";
    return "off";
}
const FORK_GAL_CHOICE_WAIT_LINES = ["正在遍历世界线……", "世界线收束中……", "观测下一个分歧点……", "Reading Steiner 启动中……"];
let forkGalChoiceWaitLine = 0;
// private fork (owner 2026-10, panel stability): the end panel of one reply keeps one wait line and plays its entrance
// once. A remount of the same panel (the stage re-rendering at the end of the turn) or a state change and back must
// neither rotate the line nor wipe the rows in again — that read as the panel blinking while its choices generate.
let forkGalChoiceWait = { key: "", line: "" };
let forkGalChoicesShown = "";
// Choices stored before the host fix may hold double-escaped model output ("\\u7a97…"): show real characters.
function forkDecodeUnicodeEscapes(value) {
    const text = String(value == null ? "" : value);
    return /\\u[0-9a-fA-F]{4}/.test(text) ? text.replace(/(?:\\u[0-9a-fA-F]{4})+/g, run => { try { return JSON.parse('"' + run + '"'); } catch (_) { return run; } }) : text;
}
// An open editor the user has not changed (still the suggestion, or still empty for 「自由输入」).
// Only such an editor closes on a click outside it; typed text survives a stray click.
function forkGalChoiceUntouched(editing) {
    return Boolean(editing) && String(editing.text || "").trim() === String(editing.initial || "").trim();
}
function ForkGalChoices(props) {
    const h = React.createElement;
    const sessionId = props.sessionId;
    const panelState = useCandidatePanel();
    const running = props.useSession(snapshot => snapshot.running === true);
    const messageId = props.useChat(latestTavernAssistantMessageId);
    const coordination = useTavernCoordination(sessionId, String(running) + ":" + String(messageId || ""));
    const task = coordination.view && coordination.view.task;
    const taskForMessage = task && task.kind === "candidate" && task.input && String(task.input.messageId || "") === String(messageId || "") ? task : null;
    const panel = panelState && panelState.sessionId === sessionId && panelState.messageId === messageId ? panelState : null;
    const [editing, setEditing] = React.useState(null); // { index, text, initial } — index -1 is 「自由输入」
    const [sending, setSending] = React.useState(false);
    const [error, setError] = React.useState("");
    const editorRef = React.useRef(null);
    const requestRef = React.useRef(false);
    const status = panel ? panel.phase : taskForMessage ? taskForMessage.busy ? "loading" : taskForMessage.status === "succeeded" ? "ready" : "error" : "idle";
    const state = forkGalEndPanelState({ status, atEnd: props.atEnd !== false && !running });
    const panelKey = String(sessionId) + ":" + String(messageId || "");
    if (state === "generating" && forkGalChoiceWait.key !== panelKey)
        forkGalChoiceWait = { key: panelKey, line: FORK_GAL_CHOICE_WAIT_LINES[forkGalChoiceWaitLine++ % FORK_GAL_CHOICE_WAIT_LINES.length] };
    const settledRef = React.useRef(null);
    if (state !== "hidden" && settledRef.current === null) settledRef.current = forkGalChoicesShown === panelKey;
    React.useEffect(function () { if (state !== "hidden") forkGalChoicesShown = panelKey; }, [state !== "hidden", panelKey]);
    // private fork: galgame UI cues (fork-ui-sfx.js): a chime when this reply's options appear, confirm on sending.
    const rootRef = React.useRef(null);
    useForkUiSfxControls(rootRef, state !== "hidden");
    // A short stage: when the list overflows its bottom rows stay in view and the choices above scroll.
    const choiceCount = panel && panel.phase === "ready" && panel.choices ? panel.choices.length : 0;
    (React.useLayoutEffect || React.useEffect)(function () {
        const el = rootRef.current;
        if (el && el.scrollHeight > el.clientHeight + 1) el.scrollTop = el.scrollHeight;
    }, [state, choiceCount]);
    const offered = state === "ready" && Boolean(panel && panel.choices && panel.choices.length);
    React.useEffect(function () { if (offered) forkUiSfx.play("choice"); }, [offered, messageId]);
    // A click outside an untouched editor cancels it (capture phase, before the click does anything else).
    React.useEffect(function () {
        if (!editing || sending || typeof document === "undefined" || !document.addEventListener) return;
        function onPointerDown(event) {
            const card = editorRef.current;
            if (card && event.target && typeof card.contains === "function" && card.contains(event.target)) return;
            if (forkGalChoiceUntouched(editing)) setEditing(null);
        }
        document.addEventListener("pointerdown", onPointerDown, true);
        return function () { document.removeEventListener("pointerdown", onPointerDown, true); };
    }, [editing, sending]);
    // Mirror mailbox progress and failures too: a hidden composer must not leave us waiting forever.
    React.useEffect(function () {
        if (!taskForMessage) return;
        if (taskForMessage.busy)
            setCandidatePanel({ sessionId, messageId, phase: "loading", choices: [], error: "" });
        else if (taskForMessage.status === "succeeded" && taskForMessage.result && taskForMessage.result.candidates)
            setCandidatePanel(readyCandidatePanel(sessionId, messageId, taskForMessage.result.candidates));
        else if (taskForMessage.terminal)
            setCandidatePanel({ sessionId, messageId, phase: "error", choices: [], error: String(taskForMessage.error || "选项生成未完成") });
    }, [sessionId, messageId, taskForMessage && taskForMessage.taskId, taskForMessage && taskForMessage.version, taskForMessage && taskForMessage.status]);
    if (state === "hidden") return null;
    async function send(text) {
        const value = String(text || "").trim();
        if (!value || sending) return;
        if (typeof props.executeSlash !== "function") { setError("当前界面无法发送，请回到聊天视图输入"); return; }
        forkUiSfx.play("confirm");
        setSending(true); setError("");
        props.onSending?.(value);
        try {
            // A pipe would split the slash command; the full-width bar reads the same.
            await props.executeSlash("/send " + value.replace(/\|/g, "｜") + "|/trigger", sessionId);
            setCandidatePanel(null); setEditing(null);
            props.onSent && props.onSent(value);
        } catch (err) {
            setError("发送失败：" + String(err && err.message || err));
            props.onSendFailed?.(err);
        }
        finally { setSending(false); }
    }
    async function generate() {
        if (!messageId || requestRef.current || status === "loading" || taskForMessage && taskForMessage.busy) return;
        forkUiSfx.play("confirm");
        requestRef.current = true;
        setCandidatePanel({ sessionId, messageId, phase: "loading", choices: [], error: "" });
        try { await submitCandidateTask(sessionId, messageId, ""); }
        catch (err) { setCandidatePanel({ sessionId, messageId, phase: "error", choices: [], error: String(err && err.message || err) }); }
        finally { requestRef.current = false; liveTavernView.invalidate(sessionId); tavernCoordination.invalidate(sessionId); }
    }
    const choices = panel && panel.phase === "ready" ? (panel.choices || []).map(choice => choice !== null && typeof choice === "object" ? { ...choice, text: forkDecodeUnicodeEscapes(choice.text) } : { type: "action", text: forkDecodeUnicodeEscapes(String(choice)) }) : [];
    const textOf = choice => (choice.type === "scene" ? "【场景变化】" : "") + choice.text;
    const cancel = () => { forkUiSfx.play("cancel"); setEditing(null); };
    // private fork (owner 2026-10, panel stability): a row turns into its own editor in place — the same card element
    // (no remount, so no entrance wipe) and, for one line, the same height (fork-theme.css), so 自由输入 never moves.
    function editor(index) {
        return [
            // Styled only through the stage UI tokens (fork-theme.css "stage choices"), which also shield it from skins.
            h(ForkTextArea, { key: "input", className: "fork-gal-choice-input", "aria-label": index < 0 ? "自由输入下一步" : "修改选项", autoFocus: true, rows: 1, value: editing.text, placeholder: index < 0 ? "你想怎么做？" : "改完按 Enter 发送",
                onChange: text => setEditing({ index, text, initial: editing.initial }),
                onClick: e => e.stopPropagation(),
                onKeyDown: e => {
                    e.stopPropagation();
                    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(editing.text); }
                    else if (e.key === "Escape") { e.preventDefault(); cancel(); }
                } }),
            h("div", { key: "actions", className: "fork-gal-choice-actions" },
                h("button", { type: "button", className: "fork-gal-choice-cancel", disabled: sending, "aria-label": "取消", title: "取消（Esc）", onClick: e => { e.stopPropagation(); cancel(); } }, "取消"),
                h("button", { type: "button", className: "fork-gal-choice-send", disabled: sending || !editing.text.trim(), "aria-label": "发送", title: "发送（Enter）", onClick: e => { e.stopPropagation(); send(editing.text); } }, sending ? "…" : "发送"))];
    }
    const editingAt = editing ? editing.index : null;
    // One status slot (生成选项 / the wait line / 选项生成失败): switching between them reuses the card, so it never wipes in again.
    const statusRow = state === "generating" ? h("div", { key: "status", className: "fork-gal-choice is-loading", role: "status", "aria-live": "polite" }, h("span", null, forkGalChoiceWait.line))
        : state === "off" ? h("div", { key: "status", className: "fork-gal-choice" },
            h("button", { type: "button", role: "menuitem", "data-action": "generate", className: "fork-gal-choice-main", disabled: !messageId || sending, onClick: generate }, "生成选项"))
        : state === "failed" ? h("div", { key: "status", className: "fork-gal-choice is-error" }, h("span", null, "选项生成失败"),
            h("button", { type: "button", role: "menuitem", "data-action": "retry", className: "fork-gal-choice-edit", disabled: !messageId || sending, onClick: generate,
                title: String(panel && panel.error || taskForMessage && taskForMessage.error || "选项生成未完成") }, "重试"))
        : null;
    return h("div", { ref: rootRef, className: "fork-gal-choices fork-gal-endpanel", style: props.hidden ? { display: "none" } : undefined, "data-state": state, "data-settled": settledRef.current ? "" : undefined, role: "menu", "aria-label": "接下来", onClick: e => e.stopPropagation(), onWheel: e => e.stopPropagation() },
        choices.map(function (choice, index) {
            if (editingAt === index) return h("div", { key: index, ref: editorRef, className: "fork-gal-choice is-editing", "data-type": choice.type }, editor(index));
            return h("div", { key: index, className: "fork-gal-choice", "data-type": choice.type },
                h("button", { type: "button", role: "menuitem", className: "fork-gal-choice-main", disabled: sending, onClick: () => send(textOf(choice)), onPointerEnter: () => forkUiSfx.play("move") },
                    // A scene jump (time skip / change of place) gets a small kicker line above the text, not an inline badge.
                    choice.type === "scene" ? h("span", { className: "fork-gal-choice-kicker" }, h(ForkIcon, { name: "chevron", size: 11 }), "转场") : null, h("span", { className: "fork-gal-choice-text" }, choice.text)),
                h("button", { type: "button", className: "fork-gal-choice-edit", "data-ui-sfx": "toggle", "aria-label": "改一改再发送", title: "改一改再发送", disabled: sending, onClick: () => setEditing({ index, text: textOf(choice), initial: textOf(choice) }) }, h(ForkIcon, { name: "pencil", size: 15 })));
        }),
        statusRow,
        // private fork (owner 2026-10): turn-end menu order 生成选项 (or the choices) → 重新生成正文 → 自由输入. 重新生成正文 is the
        // stage's own regenerate dialog (fork-gal-regenerate.js, target 正文, optional guidance + 确定: the same regenBody RPC
        // and confirm step as the chat view's 「重新生成正文」); the stage passes onRegenerate and its busy rule.
        // While this reply's choices generate it stays disabled throughout: background work starting and stopping around
        // the task (worldbook prefilter, settlement, direction) otherwise flipped its ink on and off.
        typeof props.onRegenerate === "function" ? h("div", { key: "regen", className: "fork-gal-choice is-regen" },
            h("button", { type: "button", role: "menuitem", "data-action": "regenerate", className: "fork-gal-choice-main", disabled: sending || state === "generating" || Boolean(props.regenerateDisabled),
                onClick: () => props.onRegenerate() }, h(ForkIcon, { name: "replay", size: 15 }), h("span", null, "重新生成正文"))) : null,
        editingAt === -1 ? h("div", { key: "free", ref: editorRef, className: "fork-gal-choice is-free is-editing" }, editor(-1)) : h("div", { key: "free", className: "fork-gal-choice is-free" },
            h("button", { type: "button", role: "menuitem", "data-action": "free", className: "fork-gal-choice-main", "data-ui-sfx": "toggle", disabled: sending, onClick: () => setEditing({ index: -1, text: "", initial: "" }) }, h(ForkIcon, { name: "pencil", size: 15 }), h("span", null, "自由输入"))),
        error ? h("p", { className: "fork-gal-choice-error", role: "alert" }, error) : null);
}
