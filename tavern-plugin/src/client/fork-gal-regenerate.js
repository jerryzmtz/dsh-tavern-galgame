// Private fork: included inside play-controls to share body regeneration and its projections.
async function forkGalSubmitRegeneration(sessionId, turn, target, guidance) {
    const text = String(guidance || "").trim();
    if (target === "body") await submitBodyRegeneration(sessionId, { tail: null }, text);
    else if (target === "mvu") await rpc("retryMvuSettlement", { turn, guidance: text }, sessionId);
    else if (target === "director") await rpc("retryStageDirection", { turn, guidance: text }, sessionId);
    liveTavernView.invalidate(sessionId);
    tavernCoordination.invalidate(sessionId);
}

function ForkGalRegenerate(props) {
    const h = React.createElement;
    const [target, setTarget] = React.useState("body");
    const [guidance, setGuidance] = React.useState("");
    const [busy, setBusy] = React.useState(false);
    const pending = React.useRef(false);
    const root = React.useRef(null);
    const live = React.useRef(props);
    live.current = props;
    // private fork: galgame UI cues (fork-ui-sfx.js): target radios toggle, 取消 / Esc / right click cancel, 确定 confirms.
    useForkUiSfxControls(root);
    React.useLayoutEffect(function () {
        const opener = document.activeElement;
        root.current.querySelector('[role="radio"][aria-checked="true"]').focus({ preventScroll: true });
        function onKey(event) {
            if (event.isComposing) return;
            if (event.key === "Escape") {
                event.preventDefault(); event.stopImmediatePropagation(); forkUiSfx.play("cancel"); live.current.onClose();
            } else if (event.key === "Tab") {
                const nodes = Array.from(root.current.querySelectorAll('[role="radio"][aria-checked="true"]:not(:disabled), textarea:not(:disabled), button:not([role="radio"]):not(:disabled)'));
                const at = nodes.indexOf(document.activeElement);
                event.preventDefault(); event.stopImmediatePropagation();
                nodes[(at + (event.shiftKey ? nodes.length - 1 : 1)) % nodes.length].focus({ preventScroll: true });
            }
        }
        window.addEventListener("keydown", onKey, true);
        return function () {
            window.removeEventListener("keydown", onKey, true);
            if (opener && opener.isConnected) opener.focus({ preventScroll: true });
        };
    }, []);
    async function submit(event) {
        event.preventDefault();
        if (pending.current || props.busy || props.historical) return;
        pending.current = true; setBusy(true);
        props.onBusy(true);
        try {
            await forkGalSubmitRegeneration(props.sessionId, props.turn, target, guidance);
            props.onClose();
        } catch (error) { tavernErrorHub.report("重新生成", error); }
        finally { pending.current = false; setBusy(false); props.onBusy(false); }
    }
    const targets = [
        ["body", "正文", "重写本轮回复；之后照常结算与导演"],
        ["mvu", "变量结算（MVU）", "保留正文，重新结算本轮变量"],
        ["director", "舞台指导", "保留正文与变量，重新生成本轮演出"]
    ];
    return h("form", { ref: root, className: "fork-gal-menu-panel fork-gal-regenerate", role: "dialog", "aria-modal": true, "aria-label": "重新生成", "aria-busy": busy, onSubmit: submit,
        onClick: event => event.stopPropagation(), onKeyDown: event => event.stopPropagation(), onContextMenu: event => { event.preventDefault(); event.stopPropagation(); forkUiSfx.play("cancel"); props.onClose(); } },
        // private fork: no grey helper text — what each target does lives behind the title's 「?」 (and each option's title).
        h("h2", null, "重新生成", typeof ForkHelpTip === "function" ? h(ForkHelpTip, { label: "重新生成说明" }, targets.map(([id, label, note]) => h("span", { key: id }, label + "：" + note))) : null),
        // private fork (UI standard §三.6, phase 2 batch 8): the target is the shared ForkSegmented in the stage skin (was native
        // radios); ←→ choose, each option keeps its one-line title.
        h(ForkSegmented, { base: "fork-gal-config-seg", className: "fork-gal-regenerate-targets", label: "重新生成目标", value: target, disabled: busy, onChange: setTarget,
            options: targets.map(([id, label, note]) => [id, label, false, note, { "data-target": id }]) }),
        h("label", { className: "fork-gal-regenerate-guidance" }, "本次指导（可选）",
            h(ForkTextArea, { rows: 5, value: guidance, disabled: busy, onChange: setGuidance })),
        h("div", { className: "fork-gal-regenerate-actions" },
            h("button", { type: "button", "data-ui-sfx": "cancel", onClick: props.onClose }, "取消"),
            h("button", { type: "submit", "data-ui-sfx": "confirm", disabled: busy || props.busy || props.historical }, busy ? "执行中…" : "确定")));
}
