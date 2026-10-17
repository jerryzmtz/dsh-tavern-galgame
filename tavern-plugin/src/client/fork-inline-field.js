// private fork (figure-editor r6, owner 2026-10): the plugin-wide inline field — 「label value」 on one line, the value
// read as text and edited in place (no boxed inputs). Spec: docs/fork/ui-design.md § 行内字段. Styles: `.fork-inline-*`
// in fork-theme.css. main.js bundles this file at the outer client level next to ForkSpinner, so every feature (素材库,
// settings pages, stage panels) can use it. It depends on nothing but the React global: its few glyphs are drawn here and
// it reads no closure of another module.
//
// <ForkInlineField kind label value onCommit … />
//   kind     'text' | 'number' | 'menu' | 'color' | 'chips' | 'link'
//   label    visible label (string, or a node with `controlLabel` giving the accessible name); `help` is a node shown
//            right after it (e.g. a 「?」 tooltip button); `hideLabel` keeps the label for assistive tech only (table rows)
//   value    current value (text / number / option value / '#rrggbb' or '' for automatic / string[] / display text)
//   onCommit(next) called once per change: text / number on Enter or blur, the others on pick; never for an unchanged
//            value. Esc cancels a pending edit (it only reaches the dialog when nothing was being edited).
//   validate(next) → '' | message: shown under the value (role=alert); an invalid draft is kept and not committed
//   placeholder, disabled, className, wide (spans both columns of a ForkInlineGrid), title, controlRef, controlClassName,
//   trail (small nodes after the value: a 「已修改」 tag, a reset button)
//   text:   maxLength, trim (default true), multiline (wraps in the value column; one paragraph, Enter saves), lines (with
//           multiline: keeps line breaks — Shift+Enter starts a new line, Enter still saves)
//   number: unit (text after the value), min, max, step (↑ / ↓), integer, optional (empty commits null)
//   menu:   options [{value, label, title?, group?}] — consecutive options with the same `group` sit under that quiet heading
//   color:  auto (the automatic colour, shown when value is empty), palette only when data declares one (else shades of auto); commits null for 自动
//   chips:  split(text) → words, addLabel; validate receives the whole list; onPick(word, index) makes each word a button
//           (e.g. 标签: filter the list by that level), pickTitle its tooltip
//   link:   onOpen() (the value opens its own page), before / after (small nodes beside the text), ariaLabel (the
//           button's full accessible name when the text alone does not say enough, e.g. a warning)
// Hit area: the whole field. A click on the label, the gap or the empty part of the value cell acts as a click on the value
// (focus a text box with the caret at the end, open a menu / colour / link, focus the chips' ＋ field).
// <ForkInlineGrid label columns? className?> — the container: two aligned columns on desktop, one on a phone.
// <ForkInlineRow label help? multiline?> — the same row around any other control (switch, slider, text area).
const FORK_INLINE_GLYPHS = { chevDown: "M4.5 6.5 8 10l3.5-3.5", chevRight: "M6.5 4.5 10 8l-3.5 3.5", check: "M3.5 8.5l3 3 6-7", plus: "M8 3.5v9M3.5 8h9", close: "M5 5l6 6M11 5l-6 6",
    // private fork (settings-ux r2): the one rotate-arrow reset glyph (the panel's IconButton icon:'reset' reads this path too).
    reset: "M3.2 6.5A5 5 0 1 1 3.5 10M3 3v3.5h3.5" };
function ForkInlineGlyph(props) {
    const h = React.createElement;
    return h("svg", { className: "fork-inline-glyph", width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
        h("path", { d: FORK_INLINE_GLYPHS[props.name], stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" }));
}
// private fork (settings-ux r2, owner 2026-10; ui-design §三.20): the one reset control — a quiet 30px rotate-arrow icon
// button, its name and tooltip the exact action (「恢复为全局」, 「全部恢复为自动…」). <ForkResetButton label onClick disabled className>.
function ForkResetButton(props) {
    const h = React.createElement, p = props || {};
    return h("button", { type: "button", className: "fork-cfg-icon fork-reset-button" + (p.className ? " " + p.className : ""), "aria-label": p.label, title: p.label, disabled: p.disabled || undefined, onClick: p.onClick },
        h(ForkInlineGlyph, { name: "reset" }));
}
// One popup (menu / colour picker) anchored to its trigger. Outside pointer, Esc (focus returns to the trigger) or Tab
// closes it; opening focuses the checked item, else the first control.
// private fork (inline-field sweep, owner 2026-10): the popup floats in the top layer — a portal into <body> wrapped in
// `.ap-ui.ap-layer` (panel tokens, display: contents) with position: fixed, placed against the window: under the value,
// or above it when the window has more room there, kept inside the window edges (the same rule as the stage panel's
// popoverPlace). An overflow: hidden / scrolling panel or dialog therefore never clips it. It follows scrolling and
// closes when its value scrolls out of sight. Without a DOM portal (tests, SSR) it stays inline, absolutely positioned.
function forkInlinePlace(anchor, size, view) {
    const gap = 4, edge = 8, below = view.height - anchor.bottom - gap - edge, above = anchor.top - gap - edge, up = size.height > below && above > below;
    const maxHeight = Math.max(0, Math.floor(up ? above : below)), height = Math.min(size.height, maxHeight);
    const top = up ? Math.max(edge, anchor.top - gap - height) : Math.max(edge, Math.min(anchor.bottom + gap, view.height - edge - height));
    const left = Math.max(edge, Math.min(anchor.left - 6, view.width - edge - size.width));
    return { top: Math.round(top), left: Math.round(left), maxHeight: Math.min(320, maxHeight), up };
}
function forkInlineCanPortal() { return typeof ReactDOM !== "undefined" && !!ReactDOM && typeof ReactDOM.createPortal === "function" && typeof document !== "undefined" && !!document.body; }
// private fork (mod-ui, owner 2026-10): the one popup stack (ui-design §三.16). Every fork popup — dialogs (Modal, CatSheet,
// ConfirmDialog, ForkModal) and menus (the panel's anchored menus, the inline menus / colour picker) — registers while it is open, in opening
// order. A press outside the topmost popup closes only that popup; Esc does the same. A press while a text box inside the
// topmost popup holds an unsaved edit (data-fork-draft) closes nothing: it only ends the edit (the field saves on blur, or
// keeps an invalid draft with its message), so typed text is never lost. A press inside a layer mounted after the topmost
// popup (e.g. a 「?」 tip floating above a dialog) belongs to that popup.
const forkOverlayStack = [];
let forkOverlayInstalled = false;
function forkOverlayLayer(node) { while (node && node.parentNode && node.parentNode !== document.body) node = node.parentNode; return node && node.parentNode === document.body ? node : null; }
function forkOverlayOwns(entry, target) {
    const nodes = entry.nodes().filter(Boolean);
    if (nodes.some(node => node.contains && node.contains(target))) return true;
    const mine = nodes.length ? forkOverlayLayer(nodes[0]) : null, theirs = forkOverlayLayer(target);
    return !!(mine && theirs && mine !== theirs && mine.compareDocumentPosition && (mine.compareDocumentPosition(theirs) & 4));
}
function forkOverlayEditing(entry) {
    const active = typeof document !== "undefined" ? document.activeElement : null;
    return !!(active && active.closest && active.closest("[data-fork-draft]") && entry.nodes().some(node => node && node.contains && node.contains(active)));
}
// Esc: closes the topmost popup. Returns false when no popup is open (the caller's own Esc behaviour applies).
function forkOverlayEscape(event) {
    const top = forkOverlayStack[forkOverlayStack.length - 1];
    if (!top) return false;
    if (event) { event.preventDefault(); event.stopPropagation(); }
    top.close("escape");
    return true;
}
function forkOverlayInstall() {
    if (forkOverlayInstalled || typeof document === "undefined" || typeof document.addEventListener !== "function") return;
    forkOverlayInstalled = true;
    document.addEventListener("pointerdown", function (event) {
        const top = forkOverlayStack[forkOverlayStack.length - 1], target = event.target;
        if (!top || !target || target.isConnected === false || forkOverlayOwns(top, target) || forkOverlayEditing(top)) return;
        top.close("outside");
    }, true);
    // Bubble phase: a popup's own Esc handling (an inline edit being cancelled, a menu returning focus) runs first.
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && !event.defaultPrevented) forkOverlayEscape(event); });
}
function forkOverlayPush(entry) {
    forkOverlayInstall(); forkOverlayStack.push(entry);
    return function () { const at = forkOverlayStack.indexOf(entry); if (at >= 0) forkOverlayStack.splice(at, 1); };
}
// useForkOverlay(open, nodes() → [elements that count as inside], close(reason)) — registers while `open`.
function useForkOverlay(open, nodes, close) {
    const latest = React.useRef(null);
    latest.current = { nodes, close };
    React.useEffect(function () {
        if (!open) return undefined;
        return forkOverlayPush({ nodes: () => latest.current.nodes() || [], close: reason => latest.current.close(reason) });
    }, [open]);
}
function useForkInlinePopup() {
    const [open, setOpen] = React.useState(false), [place, setPlace] = React.useState(null), root = React.useRef(null), trigger = React.useRef(null), pop = React.useRef(null);
    const close = refocus => { setOpen(false); setPlace(null); if (refocus && trigger.current && trigger.current.focus) trigger.current.focus(); };
    const floating = forkInlineCanPortal();
    // private fork (mod-ui): outside press / Esc through the shared popup stack (only the topmost popup closes).
    useForkOverlay(open, () => [root.current, pop.current], reason => { setOpen(false); setPlace(null); if (reason === "escape" && trigger.current && trigger.current.focus) trigger.current.focus(); });
    (React.useLayoutEffect || React.useEffect)(function () {
        if (!open || !floating || typeof window === "undefined") return;
        const update = () => {
            const anchor = trigger.current && trigger.current.getBoundingClientRect ? trigger.current.getBoundingClientRect() : null, node = pop.current;
            if (!anchor || !node) return;
            if (anchor.bottom < 0 || anchor.top > window.innerHeight) { setOpen(false); setPlace(null); return; }
            const next = forkInlinePlace(anchor, { width: node.offsetWidth, height: Math.min(320, Math.max(node.offsetHeight, node.scrollHeight)) }, { width: window.innerWidth, height: window.innerHeight });
            setPlace(p => p && p.top === next.top && p.left === next.left && p.maxHeight === next.maxHeight ? p : next);
        };
        update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
        return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
    }, [open, floating]);
    React.useEffect(function () {
        const node = pop.current; if (!open || !node || !node.querySelector) return;
        if (!floating && node.scrollIntoView) node.scrollIntoView({ block: "nearest" });
        const first = node.querySelector('[aria-checked="true"]:not(:disabled),[aria-pressed="true"]') || node.querySelector("button:not(:disabled),input");
        if (first && first.focus) first.focus({ preventScroll: true });
    }, [open]);
    const keys = event => {
        if (!open) return;
        if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); close(true); }
        else if (event.key === "Tab") { if (floating && pop.current && pop.current.contains(event.target)) { event.preventDefault(); close(true); } else close(false); }
    };
    // The popup element: props of the .fork-inline-pop node and its children.
    const layer = (props, ...children) => {
        const style = floating ? { position: "fixed", top: place ? place.top : -9999, left: place ? place.left : -9999, maxHeight: place ? place.maxHeight : undefined, visibility: place ? undefined : "hidden" } : undefined;
        const node = React.createElement("div", { ...props, ref: pop, style, "data-floating": floating || undefined, "data-up": place && place.up || undefined }, ...children);
        return floating ? ReactDOM.createPortal(React.createElement("div", { className: "ap-ui ap-layer fork-inline-layer" }, node), document.body) : node;
    };
    return { open, setOpen: next => { if (!next) setPlace(null); setOpen(next); }, close, root, trigger, keys, layer };
}
// ↑ ↓ Home End walk a menu's items.
function forkInlineMenuKeys(event) {
    const items = [...event.currentTarget.querySelectorAll('[role^="menuitem"]:not(:disabled)')], i = items.indexOf(document.activeElement), n = items.length;
    const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key];
    if (next === undefined || !n) return;
    event.preventDefault(); items[(next + n) % n].focus();
}
function forkInlineNumberProblem(text, p, name) {
    if (!text.trim()) return p.optional ? "" : "请填写" + name;
    const n = Number(text);
    if (!Number.isFinite(n) || (p.integer && !Number.isInteger(n))) return name + "需为" + (p.integer ? "整数" : "数字");
    if ((p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max)) return name + "需为 " + (p.min ?? "") + "–" + (p.max ?? "") + (p.unit ? " " + p.unit : "");
    return "";
}
// text / number: always a real text box, drawn as text; the underline shows on hover and while editing. It grows with
// its text (a mirrored span sizes the grid cell), so the value sits right after the label.
function ForkInlineText(p) {
    const h = React.createElement, number = p.kind === "number", shown = v => v === null || v === undefined ? "" : String(v);
    const [draft, setDraft] = React.useState(shown(p.value)), last = React.useRef(shown(p.value)), focused = React.useRef(false), cancelled = React.useRef(false);
    React.useEffect(function () { const next = shown(p.value); if (next !== last.current) { last.current = next; if (!focused.current) { setDraft(next); p.report(""); } } }, [p.value]);
    function commit() {
        const text = number || p.trim !== false ? draft.trim() : draft;
        if (text === last.current) { p.report(""); if (text !== draft) setDraft(text); return true; }
        const problem = (number ? forkInlineNumberProblem(text, p, p.name) : "") || "", value = number ? (text ? Number(text) : null) : text;
        const message = problem || (p.validate ? p.validate(value) || "" : "");
        p.report(message);
        if (message) return false;
        last.current = text; setDraft(text); p.onCommit(value); return true;
    }
    const step = dir => { const n = Number(draft); if (!Number.isFinite(n)) return; let v = n + dir * (p.step || 1); if (p.min !== undefined) v = Math.max(p.min, v); if (p.max !== undefined) v = Math.min(p.max, v); setDraft(String(+v.toFixed(6))); p.report(""); };
    const keys = event => {
        if (event.key === "Enter") { event.preventDefault(); if (commit() && event.currentTarget && event.currentTarget.blur) event.currentTarget.blur(); }
        else if (event.key === "Escape" && (draft !== last.current || p.error)) { event.stopPropagation(); event.preventDefault(); cancelled.current = true; setDraft(last.current); p.report(""); if (event.currentTarget && event.currentTarget.blur) event.currentTarget.blur(); }
        else if (number && (event.key === "ArrowUp" || event.key === "ArrowDown")) { event.preventDefault(); step(event.key === "ArrowUp" ? 1 : -1); }
    };
    // private fork (figure-editor r7, owner 2026-10): `multiline` (text only) — a paragraph that wraps inside the value
    // column instead of scrolling sideways: a borderless text area that grows with its text (the same mirrored span sizes
    // it). It stays one paragraph: Enter saves like the one-line box, typed / pasted line breaks become spaces.
    // private fork (direction styles, owner 2026-10): `lines` keeps line breaks (a 演出风格 text); Shift+Enter adds one.
    if (p.multiline && !number) return h("span", { className: "fork-inline-edit is-multiline", "data-value": (draft || p.placeholder || "") + " " },
        h("textarea", { ref: p.controlRef, className: "fork-inline-input" + (p.controlClassName ? " " + p.controlClassName : ""), rows: 1,
            value: draft, placeholder: p.placeholder, maxLength: p.maxLength, spellCheck: false, autoComplete: "off",
            disabled: p.disabled, title: p.title, "aria-label": p.name, "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined, "data-fork-draft": draft !== last.current || undefined,
            onFocus: () => { focused.current = true; }, onChange: event => { setDraft(p.lines ? event.target.value.replace(/\r\n?/g, "\n") : event.target.value.replace(/\s*[\r\n]+\s*/g, " ")); p.report(""); },
            onKeyDown: event => { if (p.lines && event.key === "Enter" && event.shiftKey) return; keys(event); },
            onBlur: () => { focused.current = false; if (cancelled.current) { cancelled.current = false; return; } commit(); } }));
    // private fork (judge key, owner 2026-10): `secret` masks the value (a password box) and the sizing mirror only counts it.
    return h(React.Fragment, null,
        h("span", { className: "fork-inline-edit", "data-value": ((p.secret ? "•".repeat(draft.length) : draft) || p.placeholder || "") + " " },
            h("input", { ref: p.controlRef, className: "fork-inline-input" + (p.controlClassName ? " " + p.controlClassName : ""), type: p.secret ? "password" : "text", size: 1,
                inputMode: number ? (p.integer ? "numeric" : "decimal") : undefined, value: draft, placeholder: p.placeholder, maxLength: p.maxLength, spellCheck: false, autoComplete: p.secret ? "new-password" : "off",
                disabled: p.disabled, title: p.title, "aria-label": p.name, "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined, "data-fork-draft": draft !== last.current || undefined,
                onFocus: () => { focused.current = true; }, onChange: event => { setDraft(event.target.value); p.report(""); }, onKeyDown: keys,
                onBlur: () => { focused.current = false; if (cancelled.current) { cancelled.current = false; return; } commit(); } })),
        p.unit ? h("span", { className: "fork-inline-unit" }, p.unit) : null);
}
function ForkInlineMenu(p) {
    const h = React.createElement, pop = useForkInlinePopup(), options = p.options || [], current = options.find(o => o.value === p.value);
    const pick = value => { pop.close(true); if (value !== p.value) p.onCommit(value); };
    return h("span", { className: "fork-inline-anchor", ref: pop.root, onKeyDown: pop.keys },
        h("button", { ref: node => { pop.trigger.current = node; if (p.controlRef) p.controlRef.current = node; }, type: "button", className: "fork-inline-trigger" + (p.controlClassName ? " " + p.controlClassName : ""),
            disabled: p.disabled, title: p.title, "aria-haspopup": "menu", "aria-expanded": pop.open, "aria-label": p.name + "：" + (current ? current.label : p.placeholder || "未设置"),
            "data-empty": current ? undefined : true, onClick: () => pop.setOpen(!pop.open),
            onKeyDown: event => { if (event.key === "ArrowDown" && !pop.open) { event.preventDefault(); pop.setOpen(true); } } },
            h("span", { className: "fork-inline-text" }, current ? current.label : p.placeholder || "—"), h(ForkInlineGlyph, { name: "chevDown" })),
        pop.open ? pop.layer({ className: "fork-inline-pop", role: "menu", "aria-label": p.name, onKeyDown: forkInlineMenuKeys },
            options.flatMap((o, i) => [
                // private fork (settings polish, owner 2026-10): a group heading (e.g. the provider above its models).
                o.group && (i === 0 || options[i - 1].group !== o.group) ? h("div", { key: "group:" + i, role: "presentation", className: "fork-inline-group" }, o.group) : null,
                // private fork (director probe, owner 2026-10): `disabled` greys an option out (↑ ↓ skip it); `note` is a short
                // reason after its label (「不支持工具调用」).
                h("button", { key: String(o.value), type: "button", role: "menuitemradio", "aria-checked": o.value === p.value, className: "fork-inline-option" + (o.group ? " is-grouped" : ""), title: o.title, disabled: o.disabled || undefined, onClick: () => pick(o.value) },
                    h("span", null, o.label), o.note ? h("span", { className: "fork-inline-option-note" }, o.note) : null, o.value === p.value ? h(ForkInlineGlyph, { name: "check" }) : null)])) : null);
}
function ForkInlineColor(p) {
    const h = React.createElement, pop = useForkInlinePopup(), value = p.value || "", effective = value || p.auto || "#808080", autoLabel = p.autoLabel || "自动", [hexError, setHexError] = React.useState("");
    const pick = next => { pop.close(true); if ((next || "") !== value) p.onCommit(next); };
    // private fork (owner 2026-10): no preset palettes; unless the caller's data declares one, the swatches are shades of
    // the automatic colour (else the current value), figureColorShades in shared/figure-auto-color.cjs.
    const palette = p.palette || (typeof figureColorShades === "function" ? figureColorShades(/^#[0-9a-f]{6}$/i.test(p.auto || "") ? p.auto : value) : []);
    return h("span", { className: "fork-inline-anchor", ref: pop.root, onKeyDown: pop.keys },
        h("button", { ref: node => { pop.trigger.current = node; if (p.controlRef) p.controlRef.current = node; }, type: "button", className: "fork-inline-trigger is-swatch" + (p.controlClassName ? " " + p.controlClassName : ""),
            disabled: p.disabled, title: p.title || (value ? p.name : p.name + "（" + autoLabel + "）"), "aria-haspopup": "dialog", "aria-expanded": pop.open, "aria-label": p.name + "：" + (value ? value : autoLabel),
            "data-auto": value ? undefined : true, onClick: () => pop.setOpen(!pop.open) },
            h("span", { className: "fork-inline-swatch", style: { "--swatch": effective } })),
        pop.open ? pop.layer({ className: "fork-inline-pop is-palette", role: "dialog", "aria-label": p.name },
            p.allowAuto !== false ? h("button", { type: "button", className: "fork-inline-option", "aria-label": autoLabel + p.name, "aria-pressed": !value, onClick: () => pick(null) },
                h("span", { className: "fork-inline-swatch", style: { "--swatch": p.auto || "#808080" } }), h("span", null, autoLabel), !value ? h(ForkInlineGlyph, { name: "check" }) : null) : null,
            palette.length ? h("div", { className: "fork-inline-palette", role: "group", "aria-label": "常用颜色" }, palette.map(c => h("button", { key: c, type: "button", className: "fork-inline-palette-swatch",
                "aria-label": p.name + " " + c, "aria-pressed": c.toLowerCase() === value.toLowerCase(), style: { "--swatch": c }, onClick: () => pick(c) }))) : null,
            h(ForkInlineField, { kind: "text", label: "色值", controlLabel: p.name + "色值", value, placeholder: "#RRGGBB", maxLength: 7,
                validate: v => /^#[0-9a-f]{6}$/i.test(v) ? "" : "请输入 #RRGGBB", onCommit: v => pick(v) })) : null);
}
function ForkInlineChips(p) {
    const h = React.createElement, words = p.value || [], [draft, setDraft] = React.useState(""), addLabel = p.addLabel || "添加" + p.name;
    const split = p.split || (text => [...new Set(String(text || "").split(/[,，、\n]/).map(w => w.trim()).filter(Boolean))]);
    function add() {
        if (!draft.trim()) return true;
        const next = [...new Set([...words, ...split(draft)])], problem = p.validate ? p.validate(next) || "" : "";
        p.report(problem); if (problem) return false;
        setDraft(""); if (next.length !== words.length) p.onCommit(next); return true;
    }
    return h("span", { className: "fork-inline-chips" },
        words.map((word, index) => h("span", { key: word, className: "fork-inline-chip" }, p.onPick
                ? h("button", { type: "button", className: "fork-inline-chip-pick", title: p.pickTitle || "只看「" + word + "」", "aria-label": (p.pickTitle || "筛选") + " " + word, onClick: () => p.onPick(word, index) }, word)
                : h("span", null, word),
            h("button", { type: "button", className: "fork-inline-chip-remove", disabled: p.disabled, "aria-label": "删除" + p.name + " " + word, title: "删除", onClick: () => p.onCommit(words.filter(w => w !== word)) }, h(ForkInlineGlyph, { name: "close" })))),
        h("label", { className: "fork-inline-chip-add", "data-draft": draft ? true : undefined, title: addLabel }, h(ForkInlineGlyph, { name: "plus" }),
            h("input", { ref: p.controlRef, className: "fork-inline-input", type: "text", size: 1, value: draft, disabled: p.disabled, spellCheck: false, autoComplete: "off", "aria-label": addLabel, "data-fork-draft": draft ? true : undefined,
                "aria-invalid": p.error ? true : undefined, "aria-describedby": p.error ? p.errorId : undefined,
                onChange: event => { setDraft(event.target.value); p.report(""); },
                onKeyDown: event => {
                    if (event.key === "Enter" || event.key === "," || event.key === "，" || event.key === "、") { event.preventDefault(); add(); }
                    else if (event.key === "Escape" && (draft || p.error)) { event.stopPropagation(); event.preventDefault(); setDraft(""); p.report(""); }
                },
                onBlur: add })));
}
function ForkInlineLink(p) {
    const h = React.createElement;
    return h("button", { ref: p.controlRef, type: "button", className: "fork-inline-trigger is-link" + (p.controlClassName ? " " + p.controlClassName : ""), disabled: p.disabled, title: p.title,
            "aria-label": p.ariaLabel || p.name + "：" + (p.value || p.placeholder || "未设置"), "data-empty": p.value ? undefined : true, onClick: p.onOpen },
        p.before || null, h("span", { className: "fork-inline-text" }, p.value || p.placeholder || "—"), p.after || null, h(ForkInlineGlyph, { name: "chevRight" }));
}
const FORK_INLINE_KINDS = { text: ForkInlineText, number: ForkInlineText, menu: ForkInlineMenu, color: ForkInlineColor, chips: ForkInlineChips, link: ForkInlineLink };
function ForkInlineField(props) {
    const h = React.createElement, p = props || {}, kind = FORK_INLINE_KINDS[p.kind] ? p.kind : "text", root = React.useRef(null);
    const [error, setError] = React.useState(""), id = React.useId ? React.useId() : "fork-inline", errorId = id + "-error";
    const name = p.controlLabel || (typeof p.label === "string" ? p.label : "");
    // private fork (stage panel r6, owner 2026-10): the hit area is the whole field, not the text's width. A click on the
    // label (not on its 「?」), the gap or the empty part of the value cell reaches the control as if it were clicked: a
    // text / number box takes focus with the caret at the end, a menu / colour / link opens, chips focus their ＋ field.
    // Clicks on a real control (the value itself, a trail button), in an open popup or from a portal are left alone.
    const activate = event => {
        const node = root.current, target = event.target;
        if (p.disabled || !node || !target || !target.closest || !node.contains(target)) return;
        const hit = target.closest("button, input, textarea, select, a, label, [role], [tabindex], .fork-inline-pop, .fork-inline-error");
        if ((hit && node.contains(hit)) || target.closest(".fork-inline-field") !== node) return;
        const control = node.querySelector(kind === "chips" ? ".fork-inline-chip-add input" : ".fork-inline-value input, .fork-inline-value textarea, .fork-inline-value button");
        if (!control || control.disabled) return;
        if (control.tagName === "INPUT" || control.tagName === "TEXTAREA") { control.focus(); const end = control.value.length; try { control.setSelectionRange(end, end); } catch (_) { /* not a text box */ } }
        else if (control.click) control.click();
    };
    return h("div", { ref: root, className: "fork-inline-field" + (p.className ? " " + p.className : ""), "data-kind": kind, "data-multiline": p.multiline && kind === "text" || undefined, "data-wide": p.wide || undefined, "data-bare": p.hideLabel || undefined, "data-invalid": error ? true : undefined, "data-disabled": p.disabled || undefined, onClick: activate },
        h("span", { className: "fork-inline-label" + (p.hideLabel ? " is-hidden" : "") }, h("span", { className: "fork-inline-label-text" }, p.label), p.help || null),
        h("span", { className: "fork-inline-value" }, h(FORK_INLINE_KINDS[kind], { ...p, kind, name, error, errorId, report: setError }), p.trail || null),
        error ? h("span", { className: "fork-inline-error", id: errorId, role: "alert" }, error) : null);
}
// private fork (inline-field sweep, owner 2026-10): <ForkInlineRow label help? multiline? wide? className?>children</ForkInlineRow>
// — the same 「label value」 row for a value that is not a text / menu / colour (a switch, a slider, a segmented choice,
// a multi-line text), so it lines up with the fields around it. `multiline` tops the label for a text area.
function ForkInlineRow(props) {
    const h = React.createElement, p = props || {};
    return h("div", { className: "fork-inline-field" + (p.className ? " " + p.className : ""), "data-kind": p.multiline ? "multiline" : "custom", "data-wide": p.wide || undefined },
        h("span", { className: "fork-inline-label" }, h("span", { className: "fork-inline-label-text" }, p.label), p.help || null),
        h("span", { className: "fork-inline-value" }, p.children));
}
function ForkInlineGrid(props) {
    const h = React.createElement, p = props || {};
    return h("div", { className: "fork-inline-grid" + (p.className ? " " + p.className : ""), role: "group", "aria-label": p.label, "data-columns": p.columns || 2 }, p.children);
}
// private fork (UI standard §三.22, phase 2 batch 10): the one search box — the only boxed text input, here at the outer level
// so the panels' SearchBox, the BGM player and the bubble voice / portrait menu share it. <ForkSearchBox value onChange(text)
// label placeholder className icon inputClassName inputRef autoFocus onKeyDown disabled spellCheck bare>: a <label.className>
// around `icon` (the caller's magnifier glyph, optional) and an <input type=search>; `bare` returns the input alone for a
// row that draws its own frame (the Fish voice finder, the voice menu filter).
// private fork (mod settings): `inputProps` are extra attributes for the input (the data picker's combobox role, aria-*,
// focus / blur), so a filter field that opens a list stays this one input.
function ForkSearchBox(props) {
    const h = React.createElement, p = props || {};
    const input = h("input", { ref: p.inputRef, type: "search", className: p.inputClassName || undefined, "aria-label": p.label, placeholder: p.placeholder === undefined ? p.label : p.placeholder,
        value: p.value, disabled: p.disabled || undefined, autoFocus: p.autoFocus || undefined, spellCheck: p.spellCheck, onKeyDown: p.onKeyDown, onChange: e => p.onChange(e.target.value), ...p.inputProps });
    if (p.bare) return input;
    return h("label", { className: p.className || "ap-search" }, p.icon || null, input);
}
// private fork (UI standard §三.7, phase 2 batch 7): the one switch — the only native checkbox (role=switch) in the client,
// here at the outer level so the panels' SwitchRow and the chat-side settings rows (调试视图, card scripts)
// share it. <ForkSwitch checked onChange(bool) label id title disabled className bare>: `bare` returns the input alone for a
// row that wraps it in its own <label> (SwitchRow); otherwise the chat skin, <label.dsh-tavern-settings-switch> input + track.
function ForkSwitch(props) {
    const h = React.createElement, p = props || {};
    const input = h("input", { id: p.id, type: "checkbox", role: "switch", "aria-label": p.label, checked: !!p.checked, disabled: !!p.disabled, onChange: e => p.onChange(e.target.checked) });
    if (p.bare) return input;
    return h("label", { className: "dsh-tavern-settings-switch" + (p.className ? " " + p.className : ""), title: p.title || undefined }, input, h("span", { className: "dsh-tavern-settings-track", "aria-hidden": true }));
}
// private fork (UI standard §三.6, phase 2 batch 4): the one segmented choice, here at the outer level so the stage (CONFIG)
// uses the same component as the panels (fork-asset-pack-ui.js `Segmented` is this). `options` are
// [value, text, disabled?, title?, extra button props?]. A radiogroup with a roving tab stop: ← → (↑ ↓) move and choose,
// Home / End jump; aria-pressed is kept for styling. `base` is the skin class (`ap-segmented` in panels,
// `fork-gal-config-seg` on the stage, drawn in --gal-ui-*).
function ForkSegmented(props) {
    const h = React.createElement, p = props || {}, options = p.options || [], value = p.value;
    const live = options.filter(o => !(p.disabled || o[2])), stop = options.some(o => o[0] === value) ? value : live[0] && live[0][0];
    const keys = e => {
        if (p.onKeyDown) p.onKeyDown(e);
        const at = live.findIndex(o => o[0] === value), n = live.length;
        if (e.defaultPrevented || !n) return;
        const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: n - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        const v = live[(next + n) % n][0];
        if (v !== value) p.onChange(v);
        const i = options.findIndex(o => o[0] === v), buttons = e.currentTarget && e.currentTarget.querySelectorAll ? e.currentTarget.querySelectorAll("button") : null;
        if (buttons && buttons[i] && buttons[i].focus) buttons[i].focus();
    };
    return h("div", { className: (p.base || "ap-segmented") + (p.className ? " " + p.className : ""), role: "radiogroup", "aria-label": p.label, onKeyDown: keys },
        options.map(([v, text, off, title, extra]) => h("button", { key: String(v), type: "button", role: "radio", "aria-checked": value === v, "aria-pressed": value === v,
            tabIndex: v === stop ? 0 : -1, disabled: p.disabled || off || undefined, title, ...extra, onClick: () => { if (value !== v) p.onChange(v); } }, text)));
}
// private fork (UI standard §三.8, phase 2 batch 4): the one slider — a track (role=slider) with a fill and a thumb, the
// reading beside it. <ForkSlider value min max step label valueText output onChange onCommit reset skin className disabled>
//   onChange(v) follows the drag and every key step (live preview / live setting); onCommit(v) once on release or per key
//   step, only when the value changed. A release also fires a bubbling DOM `change` on the track, like a native range, so
//   delegated listeners (the stage's UI sounds, fork-ui-sfx.js) hear it.
//   Keys: ← ↓ / → ↑ one step, PageDown / PageUp ten, Home / End the ends. Double click goes to `reset` when given.
//   skin: the class prefix — `ap-slider` (panels, --fork-*), `fork-gal-slider` (stage, --gal-ui-*), `fork-bgm-slider` (BGM
//   player, --bgm-*): `<skin>` wraps, `<skin>-track` / `-fill` / `-thumb` draw it; `output` (a node, or shown => node) is the reading; `valueText` likewise.
function forkSliderSnap(v, min, max, step) { return +Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min)).toFixed(6); }
function ForkSlider(props) {
    const h = React.createElement, p = props || {}, min = p.min ?? 0, max = p.max ?? 1, step = p.step || (max - min) / 100, skin = p.skin || "ap-slider";
    const [draft, setDraft] = React.useState(null), track = React.useRef(null), start = React.useRef(null);
    const value = Number(p.value) || 0, shown = draft ?? value, pct = max > min ? Math.max(0, Math.min(100, (shown - min) / (max - min) * 100)) : 0;
    const at = event => { const r = track.current && track.current.getBoundingClientRect ? track.current.getBoundingClientRect() : null; return r && r.width ? forkSliderSnap(min + (event.clientX - r.left) / r.width * (max - min), min, max, step) : shown; };
    const changed = () => { const node = track.current; if (node && node.dispatchEvent && typeof Event === "function") node.dispatchEvent(new Event("change", { bubbles: true })); };
    const move = v => { setDraft(v); if (v !== shown && p.onChange) p.onChange(v); };
    const done = (v, from) => { setDraft(null); if (p.onChange) p.onChange(v); if (Math.abs(v - from) > 1e-9) { if (p.onCommit) p.onCommit(v); changed(); } };
    const keys = event => {
        const by = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1, PageUp: 10, PageDown: -10 }[event.key];
        const to = event.key === "Home" ? min : event.key === "End" ? max : by === undefined ? null : forkSliderSnap(value + by * step, min, max, step);
        if (to === null || p.disabled) return;
        event.preventDefault(); done(to, value);
    };
    return h("div", { className: skin + (p.className ? " " + p.className : ""), "data-disabled": p.disabled || undefined },
        h("div", { ref: track, className: skin + "-track", role: "slider", tabIndex: p.disabled ? -1 : 0, "aria-label": p.label, "aria-valuemin": min, "aria-valuemax": max, "aria-valuenow": shown,
            "aria-valuetext": typeof p.valueText === "function" ? p.valueText(shown) : p.valueText, "aria-disabled": p.disabled || undefined, style: { "--slider-fill": pct + "%" },
            onPointerDown: event => { if (p.disabled || event.button > 0) return; if (event.currentTarget && event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId); start.current = value; move(at(event)); },
            onPointerMove: event => { if (draft !== null) move(at(event)); },
            onPointerUp: event => { if (draft !== null) done(at(event), start.current ?? value); },
            onPointerCancel: () => { if (draft !== null) done(draft, start.current ?? value); },
            onDoubleClick: p.reset !== undefined ? () => done(p.reset, value) : undefined, onKeyDown: keys },
            h("span", { className: skin + "-fill", style: { width: pct + "%" } }), h("span", { className: skin + "-thumb", style: { left: pct + "%" } })),
        p.output !== undefined ? h("output", { className: p.outputClassName, "aria-hidden": p.outputHidden || undefined }, typeof p.output === "function" ? p.output(shown) : p.output) : null);
}
// private fork (UI standard §三.22, phase 2 batch 16): the one draft text area — a paragraph typed before a separate
// 「生成 / 发送 / 保存」 action (unlike ForkInlineField multiline, which saves on Enter). <ForkTextArea value onChange(text, event)
// className inputRef rows maxLength placeholder label autoFocus disabled onKeyDown id …>: it grows with its text from `rows`
// lines up to the skin's max-height (then scrolls); no resize handle. Other props pass through to the <textarea>.
function ForkTextArea(props) {
    const h = React.createElement, p = props || {}, own = React.useRef(null), ref = p.inputRef || own;
    const { inputRef, className, onChange, label, value, ...rest } = p;
    const fit = () => { const el = ref.current; if (!el || !el.style || typeof el.scrollHeight !== "number") return; el.style.height = "auto";
        const edge = (el.offsetHeight || 0) - (el.clientHeight || 0); el.style.height = el.scrollHeight + Math.max(0, edge) + "px"; };
    (React.useLayoutEffect || React.useEffect)(fit, [value]);
    return h("textarea", { ...rest, ref, value: value === null || value === undefined ? "" : value, "aria-label": label || p["aria-label"],
        className: "fork-textarea" + (className ? " " + className : ""), onChange: event => { if (onChange) onChange(event.target.value, event); } });
}
// private fork (UI standard §三.23, phase 2 batch 16): the one "add a new one by name" control — a dashed ＋ tile that turns
// into a text box in place. Enter confirms (trimmed, not empty), Esc cancels (and does not close the dialog around it).
// <ForkInlineAdd onConfirm(text) onCancel onOpen open? value? onChange? label addLabel placeholder busy disabled invalid
// maxLength type inputMode className inputClassName tileClassName tile bare inputRef children>:
// `open` / `value` make it controlled (the caller's own trigger or text); `tile` replaces the dashed tile (a menu item);
// `children` follow the box (the caller's 创建 / ✕ buttons); `bare` returns the box alone.
function ForkInlineAdd(props) {
    const h = React.createElement, p = props || {};
    const [own, setOwn] = React.useState(false), [ownText, setOwnText] = React.useState(""), mine = React.useRef(null), ref = p.inputRef || mine;
    const open = p.open === undefined ? own : !!p.open, text = p.value === undefined ? ownText : p.value || "";
    const setText = v => { if (p.value === undefined) setOwnText(v); if (p.onChange) p.onChange(v); };
    React.useEffect(function () { if (open && ref.current && ref.current.focus) ref.current.focus(); }, [open]);
    const close = () => { if (p.open === undefined) { setOwn(false); setOwnText(""); } };
    const cancel = () => { close(); if (p.onCancel) p.onCancel(); };
    const accept = () => { const v = text.trim(); if (!v || p.busy || p.disabled) return; const r = p.onConfirm ? p.onConfirm(v) : true;
        Promise.resolve(r).then(ok => { if (ok !== false) close(); }); };
    const begin = () => { if (p.open === undefined) setOwn(true); if (p.onOpen) p.onOpen(); };
    if (!open) {
        if (p.tile === null) return null;
        if (p.tile) return h(p.tile.type, { ...p.tile.props, onClick: begin }, ...(Array.isArray(p.tile.children) ? p.tile.children : []));
        return h("button", { type: "button", className: "fork-inline-add" + (p.tileClassName ? " " + p.tileClassName : ""), "aria-label": p.addLabel || p.label, title: p.addLabel || p.label,
            disabled: p.disabled || undefined, onClick: begin }, h(ForkInlineGlyph, { name: "plus" }));
    }
    const box = h("input", { ref, type: p.type || "text", inputMode: p.inputMode, className: p.inputClassName || "fork-inline-add-input", "aria-label": p.label, placeholder: p.placeholder,
        value: text, maxLength: p.maxLength, spellCheck: p.spellCheck, autoComplete: "off", disabled: p.busy || undefined, "aria-invalid": p.invalid ? true : undefined,
        onChange: event => setText(event.target.value),
        onKeyDown: event => { if (event.key === "Enter") { event.preventDefault(); accept(); } else if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancel(); } } });
    if (p.bare) return box;
    return h("div", { className: p.className || "fork-inline-add-row" }, box, p.children);
}