// Private fork: one model/effort control over the host's shared ModelDirectory.
function forkModelChoices(state) {
    return (state.groups || []).flatMap(function (group) {
        return group.models.map(function (model) { return { group: group, model: model }; });
    });
}
function forkModelSelection(choice) {
    const selection = { provider: choice.group.id, model: choice.model.id };
    if (choice.model.reasoning && choice.model.reasoning.defaultEffort !== undefined) selection.reasoningEffort = choice.model.reasoning.defaultEffort;
    return selection;
}
function forkEffortOptions(reasoning) {
    if (!reasoning || !reasoning.efforts || !reasoning.efforts.length) return [];
    const labels = { off: "关闭", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "XHigh", max: "Max" };
    const options = reasoning.efforts.map(function (effort) { return { value: effort.id, label: labels[effort.id] || effort.name || effort.id }; });
    return options;
}
function forkSameModelSelection(a, b) {
    return !!a && !!b && a.provider === b.provider && a.model === b.model && a.reasoningEffort === b.reasoningEffort;
}
function createForkModelSelectionQueue(select, notify) {
    let active = false, disposed = false, pending = null, latest = null;
    async function drain() {
        if (active || disposed) return;
        active = true;
        while (pending && !disposed) {
            const request = pending; pending = null;
            let error = "";
            try { if (await select(request) === false) error = "未能应用选择，请重试。"; }
            catch (cause) { error = String(cause && cause.message || cause); }
            if (disposed) break;
            if (!pending) { latest = null; notify({ selection: null, pending: false, error: error, retry: error ? request : null }); }
        }
        active = false;
    }
    return {
        select: function (selection) {
            if (disposed || forkSameModelSelection(selection, latest)) return;
            latest = pending = Object.assign({}, selection);
            notify({ selection: latest, pending: true, error: "", retry: null });
            void drain();
        },
        dispose: function () { disposed = true; pending = latest = null; }
    };
}
function installForkModelHover(trigger, panel, show, ownerDocument) {
    let timer = null, hoverOpen = false, dragging = false;
    const inside = new Set();
    function cancel() { if (timer !== null) clearTimeout(timer); timer = null; }
    function pin() { hoverOpen = false; cancel(); }
    function schedule() {
        cancel();
        if (!hoverOpen || inside.size || dragging) return;
        // Bridge the gap between the trigger and its portalled popover.
        timer = setTimeout(function () { timer = null; hoverOpen = false; panel.hidePopover(); }, 250);
    }
    function enter(event) {
        if (event.pointerType !== "mouse" || event.buttons) return;
        inside.add(event.currentTarget); cancel();
        if (event.currentTarget === trigger && !panel.matches(":popover-open")) { hoverOpen = true; show(); }
    }
    function leave(event) { if (event.pointerType === "mouse") { inside.delete(event.currentTarget); schedule(); } }
    function down(event) { if (event.pointerType === "mouse") { dragging = true; cancel(); } }
    function up() { dragging = false; schedule(); }
    function toggle(event) { if (event.newState === "closed") pin(); }
    for (const node of [trigger, panel]) { node.addEventListener("pointerenter", enter); node.addEventListener("pointerleave", leave); }
    panel.addEventListener("pointerdown", down);
    panel.addEventListener("keydown", pin);
    panel.addEventListener("toggle", toggle);
    ownerDocument.addEventListener("pointerup", up);
    ownerDocument.addEventListener("pointercancel", up);
    return {
        isHoverOpen: function () { return hoverOpen; }, pin: pin,
        dispose: function () {
            pin();
            for (const node of [trigger, panel]) { node.removeEventListener("pointerenter", enter); node.removeEventListener("pointerleave", leave); }
            panel.removeEventListener("pointerdown", down); panel.removeEventListener("keydown", pin); panel.removeEventListener("toggle", toggle);
            ownerDocument.removeEventListener("pointerup", up); ownerDocument.removeEventListener("pointercancel", up);
        }
    };
}
function ForkModelControl(props) {
    const h = React.createElement;
    const state = React.useSyncExternalStore(function (fn) { return props.directory.subscribe(fn); }, function () { return props.directory.getSnapshot(); });
    const [request, setRequest] = React.useState({ selection: null, pending: false, error: "" });
    const queue = React.useMemo(function () {
        return createForkModelSelectionQueue(props.select, function (next) { setRequest(Object.assign({ owner: props.directory }, next)); });
    }, [props.directory]);
    React.useEffect(function () { props.load(); return function () { queue.dispose(); }; }, [queue]);
    const owned = request.owner === props.directory ? request : {};
    const selection = owned.selection || state.current;
    const choices = React.useMemo(function () { return forkModelChoices(state); }, [state.groups]);
    const choice = choices.find(function (item) { return selection && item.group.id === selection.provider && item.model.id === selection.model; });
    const reasoning = choice && choice.model.reasoning;
    const options = forkEffortOptions(reasoning);
    const effort = selection && selection.reasoningEffort !== undefined ? selection.reasoningEffort : reasoning && reasoning.defaultEffort;
    const selected = options.findIndex(function (item) { return item.value === effort; });
    const [preview, setPreview] = React.useState(null);
    const previewRef = React.useRef(null);
    const [open, setOpen] = React.useState(false), [view, setView] = React.useState("effort");
    const panel = React.useRef(null), trigger = React.useRef(null), modelButton = React.useRef(null), list = React.useRef(null);
    const typeahead = React.useRef({ text: "", time: 0 });
    const hover = React.useRef(null), pointerActivation = React.useRef(null);
    const panelId = React.useId();
    const disabled = props.locked || !props.available;
    const busy = !!owned.pending || (!owned.error && state.status === "selecting");
    const index = preview === null ? selected : preview;
    const label = options[index] ? options[index].label : effort || "请选择等级";
    const max = options.length > 1 && index === options.length - 1 && options[index].value !== undefined && options[index].value !== "off";
    const modelName = choice ? choice.model.name || choice.model.id : selection ? selection.model : "选择模型";
    const signature = options.map(function (item) { return item.value; }).join("|");
    React.useEffect(function () { setPreview(null); previewRef.current = null; }, [selection && selection.provider, selection && selection.model, signature]);
    function close() { panel.current?.hidePopover(); trigger.current?.focus({ preventScroll: true }); }
    function place() {
        const node = panel.current;
        // Portal scrolls must not force layout of the stage-suspended composer.
        if (!node || !node.matches(":popover-open")) return;
        const anchor = trigger.current?.getBoundingClientRect();
        if (!anchor) return;
        const rect = node.getBoundingClientRect();
        node.style.left = Math.max(8, Math.min(anchor.right - rect.width, window.innerWidth - rect.width - 8)) + "px";
        node.style.top = Math.max(8, Math.min(anchor.top >= rect.height + 16 ? anchor.top - rect.height - 8 : anchor.bottom + 8, window.innerHeight - rect.height - 8)) + "px";
    }
    React.useLayoutEffect(function () {
        place();
        if (open && view === "models") (list.current?.querySelector('[aria-selected="true"]') || list.current?.querySelector('[role="option"]'))?.focus({ preventScroll: true });
    }, [open, view, choices.length, options.length, owned.error, state.error]);
    React.useEffect(function () {
        const node = panel.current;
        function toggle(event) {
            const expanded = event.newState === "open"; setOpen(expanded);
            if (!expanded) { setView("effort"); setPreview(null); previewRef.current = null; }
        }
        function key(event) {
            if (event.key !== "Escape" || !node?.matches(":popover-open") || event.isComposing) return;
            event.preventDefault(); event.stopPropagation();
            if (view === "models") { setView("effort"); requestAnimationFrame(function () { modelButton.current?.focus(); }); }
            else close();
        }
        node?.addEventListener("toggle", toggle);
        document.addEventListener("keydown", key, true);
        window.addEventListener("resize", place);
        window.addEventListener("scroll", place, true);
        return function () {
            node?.removeEventListener("toggle", toggle); document.removeEventListener("keydown", key, true);
            window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true);
        };
    }, [view]);
    React.useEffect(function () { panel.current?.hidePopover(); }, [disabled, props.directory]);
    React.useEffect(function () {
        if (disabled) return;
        const control = installForkModelHover(trigger.current, panel.current, function () { props.load(); panel.current?.showPopover(); place(); }, document);
        hover.current = control;
        return function () { control.dispose(); hover.current = null; };
    }, [disabled, props.directory]);
    function commitPreview() {
        const value = previewRef.current;
        if (value === null || !selection || !options[value] || disabled) return;
        previewRef.current = null; setPreview(null);
        const next = { provider: selection.provider, model: selection.model };
        if (options[value].value !== undefined) next.reasoningEffort = options[value].value;
        queue.select(next);
    }
    function reset() {
        if (choice) { setPreview(null); previewRef.current = null; queue.select(forkModelSelection(choice)); }
    }
    function chooseModel(item) { setPreview(null); previewRef.current = null; queue.select(forkModelSelection(item)); setView("effort"); }
    function modelKeys(event) {
        const nodes = Array.from(list.current?.querySelectorAll('[role="option"]') || []);
        if (!nodes.length || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
        const current = nodes.indexOf(document.activeElement);
        let next = -1;
        if (event.key === "ArrowDown") next = (current + 1) % nodes.length;
        else if (event.key === "ArrowUp") next = (current + nodes.length - 1) % nodes.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = nodes.length - 1;
        else if (event.key.length === 1 && event.key !== " ") {
            const now = performance.now(), key = event.key.toLowerCase(), previous = typeahead.current;
            const prefix = now - previous.time < 700 && previous.text !== key ? previous.text + key : key;
            typeahead.current = { text: prefix, time: now };
            for (let i = 1; i <= nodes.length; i++) {
                const at = (Math.max(0, current) + i) % nodes.length;
                if (nodes[at].dataset.name.toLowerCase().startsWith(prefix)) { next = at; break; }
            }
        }
        if (next >= 0) { event.preventDefault(); nodes[next].focus(); nodes[next].scrollIntoView({ block: "nearest" }); }
    }
    const error = owned.error || state.error;
    const providersByName = new Map();
    choices.forEach(function (item) { const name = item.model.name || item.model.id; if (!providersByName.has(name)) providersByName.set(name, new Set()); providersByName.get(name).add(item.group.id); });
    const popup = h("div", { className: "fork-model-panel", ref: panel, id: panelId, popover: "auto", role: "dialog", "aria-label": "模型与推理等级", "data-view": view },
        error ? h("div", { className: "fork-model-error", role: "alert" }, error, h("button", { type: "button", onClick: function () { if (owned.retry) queue.select(owned.retry); else props.load(); } }, "重试")) : null,
        state.failures?.length ? h("div", { className: "fork-model-warning", role: "status" }, "部分提供方的模型列表加载失败。", h("button", { type: "button", onClick: props.load }, "重试")) : null,
        view === "models" ? h(React.Fragment, null,
            h("button", { type: "button", className: "fork-model-back", onClick: function () { setView("effort"); } }, "‹ 返回推理等级"),
            h("div", { className: "fork-model-list", role: "listbox", "aria-label": "模型", ref: list, onKeyDown: modelKeys }, choices.map(function (item) {
                const name = item.model.name || item.model.id;
                const active = selection && item.group.id === selection.provider && item.model.id === selection.model;
                return h("button", { key: item.group.id + ":" + item.model.id, type: "button", role: "option", "aria-selected": !!active, "data-name": name, disabled: disabled, onClick: function () { chooseModel(item); } },
                    h("span", { className: "fork-model-option-name" }, name), providersByName.get(name).size > 1 ? h("small", null, item.group.name || item.group.id) : null,
                    h("span", { className: "fork-model-check", "aria-hidden": true }, active ? "✓" : ""));
            }))) : h(React.Fragment, null,
            h("div", { className: "fork-model-heading" },
                h("div", null, h("strong", { "data-max": max }, options.length ? label : "推理等级"),
                    h("button", { type: "button", ref: modelButton, className: "fork-model-name", disabled: disabled || !choices.length, onClick: function () { setView("models"); typeahead.current = { text: "", time: 0 }; } }, h("span", null, modelName), " ›")),
                h("button", { type: "button", className: "fork-model-reset", title: "恢复模型默认推理等级", "aria-label": "恢复模型默认推理等级", disabled: disabled || !choice || !options.length || reasoning.defaultEffort === undefined, onClick: reset },
                    h("svg", { width: 18, height: 18, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true },
                        h("path", { d: "M3 11a9 9 0 1 1 2.7 6.4M3 4v7h7" })))),
            options.length ? h("div", { className: "fork-effort-slider", "data-max": max, style: { "--effort-progress": (options.length > 1 ? Math.max(0, index) / (options.length - 1) * 100 : 0) + "%" } },
                h("input", { type: "range", min: 0, max: options.length - 1, step: 1, value: Math.max(0, index), "aria-label": "推理等级", "aria-valuetext": label, disabled: disabled || options.length < 2,
                    onChange: function (event) { const next = Number(event.target.value); previewRef.current = next; setPreview(next); }, onPointerUp: commitPreview,
                    onPointerCancel: function () { previewRef.current = null; setPreview(null); }, onKeyUp: function (event) { if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commitPreview(); }, onBlur: commitPreview }),
                h("div", { className: "fork-effort-ticks", "aria-hidden": true }, options.map(function (option, at) { return h("i", { key: option.value || "default", style: { left: (options.length > 1 ? at / (options.length - 1) * 100 : 0) + "%" } }); })))
                : h("p", { className: "fork-model-empty" }, state.status === "loading" ? "正在读取模型…" : "此模型未提供可调推理档位。"),
            selected < 0 && options.length ? h("p", { className: "fork-model-warning", role: "status" }, "当前等级已不可用，请恢复默认或重新选择模型。") : null));
    return h(React.Fragment, null,
        h("button", { type: "button", className: "fork-model-trigger", ref: trigger, disabled: disabled, "aria-label": "选择模型与推理等级，当前 " + modelName + (options.length ? "，" + label : ""), "aria-haspopup": "dialog", "aria-expanded": open, "aria-controls": panelId,
            title: busy ? "正在保存，下次请求生效" : "模型与推理等级",
            onPointerDown: function () { pointerActivation.current = { open: panel.current?.matches(":popover-open"), hover: hover.current?.isHoverOpen() }; },
            onClick: function (event) {
                // Native light-dismiss may close the portal between pointerdown and click.
                const before = event.detail > 0 ? pointerActivation.current : null; pointerActivation.current = null;
                if (before?.hover || hover.current?.isHoverOpen()) { hover.current?.pin(); panel.current?.showPopover(); place(); return; }
                if (before?.open || panel.current?.matches(":popover-open")) close(); else { props.load(); panel.current?.showPopover(); place(); }
            } },
            h("span", { className: "fork-model-trigger-name" }, modelName), options.length ? h("span", { className: "fork-model-trigger-effort", "data-max": max }, label) : null,
            busy ? h(ForkSpinner, { className: "fork-model-pending", label: "正在保存模型选择" }) : null),
        forkPortal(popup));
}
function installForkModelControl(scope) {
        return scope.slots.inject("conversation.input.model", function () { return scope.slots.register({
            name: "conversation.input.model", priority: -1,
            inject: function (sessionId) {
                const directory = scope.modelDirectories.directoryFor(sessionId);
                const available = scope.sessions.subagentAddress(sessionId) === undefined;
                return { available: available, directory: directory.store,
                    load: function () { if (available) directory.load().catch(function () {}); },
                    select: function (selection) { return available ? directory.select(selection).then(function () { return true; }) : Promise.resolve(false); } };
            }
        }, ForkModelControl); });
}
