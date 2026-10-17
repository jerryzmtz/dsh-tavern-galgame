// Private fork: independent UI sizing and local scroll anchoring.
const FORK_UI_SIZES = { compact: 12, standard: 13, comfortable: 15, large: 17 };
const FORK_UI_SIZE_KEY = "dsh-tavern-ui-size";
function forkUiSize() {
    try { const value = localStorage.getItem(FORK_UI_SIZE_KEY); return FORK_UI_SIZES[value] ? value : "standard"; }
    catch (_) { return "standard"; }
}
function applyForkUiSize(value) {
    const size = FORK_UI_SIZES[value] || FORK_UI_SIZES.standard;
    document.body.style.setProperty("--fork-ui-size", size + "px");
    document.body.dataset.forkUiSize = FORK_UI_SIZES[value] ? value : "standard";
}
function ForkUiSizeSetting() {
    const h = React.createElement;
    const [value, setValue] = React.useState(forkUiSize);
    return h("label", { className: "dsh-tavern-settings-group dsh-tavern-settings-row" },
        h("span", { className: "dsh-tavern-settings-copy" },
            h("span", { className: "dsh-tavern-settings-title" }, "界面大小"),
            h("span", { className: "dsh-tavern-settings-desc" }, "调整导航、图标与菜单。阅读字号仍独立设置，历史与状态文字会适度跟随阅读字号。")),
        h("select", { "aria-label": "界面大小", value: value, onChange: function (event) {
            const next = event.target.value;
            try { localStorage.setItem(FORK_UI_SIZE_KEY, next); } catch (_) {}
            applyForkUiSize(next); setValue(next);
        } }, Object.entries({ compact: "紧凑", standard: "标准", comfortable: "舒适", large: "大号" }).map(function (entry) {
            return h("option", { key: entry[0], value: entry[0] }, entry[1]);
        })));
}
function forkCompactionCaption(text) {
    return text.replace(/（约\s*([\d,]+)\s*tokens）/, function (_, digits) {
        const count = Number(digits.replace(/,/g, ""));
        return Number.isSafeInteger(count) ? "（原文约 " + count.toLocaleString("en-US") + " tokens）" : _;
    });
}
function installForkCompactionCaptions() {
    // Weak: a rewritten summary leaves with its chat. A strong Map kept every switched-away transcript alive
    // (~3-4k detached nodes per chat switch, slower switches as a session ages). Uninstall restores the ones still shown.
    const changed = new WeakMap();
    const selector = '[data-chat-flow-kind="compaction"] [class*="_compactionSummary"]';
    function update(root) {
        if (!root || !root.querySelectorAll) return;
        const nodes = Array.from(root.querySelectorAll(selector));
        if (root.matches && root.matches(selector)) nodes.push(root);
        nodes.forEach(function (node) {
            const text = node.textContent, next = forkCompactionCaption(text);
            if (next !== text && node.firstChild && node.firstChild.nodeType === 3 && node.childNodes.length === 1) {
                changed.set(node, { before: text, after: next });
                node.firstChild.nodeValue = next;
            }
        });
    }
    update(document);
    const observer = new MutationObserver(function (records) {
        records.forEach(function (record) {
            if (record.type === "characterData") update(record.target.parentElement);
            else {
                if (record.target.matches && record.target.matches(selector)) update(record.target);
                record.addedNodes.forEach(update);
            }
        });
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    return function () {
        observer.disconnect();
        document.querySelectorAll(selector).forEach(function (node) {
            const text = changed.get(node);
            if (text && node.textContent === text.after) node.firstChild.nodeValue = text.before;
        });
    };
}
function installForkAccessibility() {
    const previousSize = document.body.style.getPropertyValue("--fork-ui-size"), previousPreset = document.body.getAttribute("data-fork-ui-size");
    applyForkUiSize(forkUiSize());
    const releaseCaptions = installForkCompactionCaptions();
    let frame = 0;
    function cancel() { cancelAnimationFrame(frame); frame = 0; }
    function anchor(event) {
        const button = event.target.closest && event.target.closest('[data-chat-flow-kind="compaction"] button[aria-expanded]');
        if (!button || button.disabled) return;
        cancel();
        let scroller = button.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        if (!scroller) return;
        const top = button.getBoundingClientRect().top;
        const deadline = performance.now() + 600;
        // Host resize/auto-follow runs after the disclosure commit. Preserve the
        // clicked divider through that layout, but yield immediately to user input.
        function restore() {
            if (!button.isConnected || !scroller.isConnected) return;
            const delta = button.getBoundingClientRect().top - top;
            if (Math.abs(delta) > 0.5) scroller.scrollTop += delta;
            if (performance.now() < deadline) frame = requestAnimationFrame(restore);
        }
        frame = requestAnimationFrame(restore);
    }
    document.addEventListener("click", anchor, true);
    ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (name) { document.addEventListener(name, cancel, true); });
    return function () {
        if (previousSize) document.body.style.setProperty("--fork-ui-size", previousSize); else document.body.style.removeProperty("--fork-ui-size");
        if (previousPreset === null) document.body.removeAttribute("data-fork-ui-size"); else document.body.setAttribute("data-fork-ui-size", previousPreset);
        releaseCaptions(); cancel(); document.removeEventListener("click", anchor, true);
        ["wheel", "touchstart", "pointerdown", "keydown"].forEach(function (name) { document.removeEventListener(name, cancel, true); });
    };
}
