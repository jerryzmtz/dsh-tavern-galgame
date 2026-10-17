// private fork (P6 弹幕, dsh.danmaku; output/danmaku/P6-CONTRACT.md): the stage side of the mod's settings. Where each
// setting lives (docs/fork/ui-design.md R21):
//  - ForkDanmakuToggle — the stage top-right quick entry: the danmaku switch icon (bilibili style: a screen with comment
//    lines, accent while on, struck with a ⊘ badge while off) whose menu picks 飘屏 / 直播风格 / 关闭; D toggles 关闭
//    and back. Only the highest-frequency control.
//  - ForkDanmakuStageConfig — a section for the stage CONFIG screen (Esc › 设置): the per-session 飘屏 appearance
//    (显示区域 / 不透明度 / 字号) and the density. Mounted through the stage-config hook requested in P6-REQUESTS.md F6.
// Both write the mod's global settings (saveModSettings, CAS on the mod revision); the renderers (fork-danmaku-stage.cjs)
// follow the DanmakuView the mod sends back. Styled only through the stage UI tokens (fork-theme.css danmaku section).

const FORK_DANMAKU_MOD = 'dsh.danmaku';
const FORK_DANMAKU_VIEW_NAMES = Object.freeze({ overlay: '飘屏', sidebar: '直播风格', off: '关闭' });
// The stage CONFIG rows, in order; a row shows only when the manifest declares its field (P6-REQUESTS.md F9).
const FORK_DANMAKU_AREA_NAMES = Object.freeze({ quarter: '1/4', half: '半屏', 'three-quarter': '3/4', full: '不限' });
const FORK_DANMAKU_STAGE_FIELDS = Object.freeze(['area', 'opacity', 'fontScale', 'density']);
// The menu rows: the manifest's view choices in order, plus 关闭 when the setting accepts it. Pure; tests.
function forkDanmakuViewOptions(manifest) {
    const field = manifest?.settingsSchema?.fields?.find(f => f.key === 'view');
    const values = (field?.choices || []).map(c => c.value).filter(v => Object.hasOwn(FORK_DANMAKU_VIEW_NAMES, v));
    return values.map(value => ({ value, label: FORK_DANMAKU_VIEW_NAMES[value] }));
}
// D on the stage: 关闭 ⇄ the last shown view (飘屏 when there is none). Only when 关闭 is a real choice; never while typing
// or with modifiers.
function forkDanmakuShortcut(event, { current, last, options }) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return null;
    if (event.key !== 'd' && event.key !== 'D') return null;
    const t = event.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="menu"], [role="dialog"]')) return null;
    if (!options.some(o => o.value === 'off')) return null;
    const on = options.find(o => o.value === last && last !== 'off') || options.find(o => o.value === 'overlay') || options.find(o => o.value !== 'off');
    return current === 'off' ? on?.value || null : 'off';
}
// The stage CONFIG rows the manifest really declares: [{key, field}] in FORK_DANMAKU_STAGE_FIELDS order. Pure; tests.
function forkDanmakuStageFields(manifest) {
    const fields = manifest?.settingsSchema?.fields || [];
    return FORK_DANMAKU_STAGE_FIELDS.map(key => ({ key, field: fields.find(f => f.key === key) })).filter(row => row.field);
}
// One CAS write of a settings patch over the stored values; a revision conflict is retried once with fresh values.
async function forkDanmakuSave(rpc, patch) {
    for (let attempt = 0; attempt < 2; attempt++) {
        const current = await rpc('getMod', { modId: FORK_DANMAKU_MOD });
        try { await rpc('saveModSettings', { modId: FORK_DANMAKU_MOD, values: { ...current.settings.storedValues, ...patch }, expectedRevision: current.revision }); break; }
        catch (error) { if (error?.code !== 'MOD_REVISION_CONFLICT' || attempt) throw error; }
    }
    window.dispatchEvent(new CustomEvent('dsh-tavern-mods-changed'));
}

// The mod's global settings as the stage needs them: enabled (global scope), values, manifest, view choices, set(patch).
function useForkDanmakuMod(rpc) {
    const [state, setState] = React.useState({ loading: true, enabled: false, values: {}, manifest: null, options: [], error: '' });
    const life = React.useRef(0), last = React.useRef('overlay');
    const read = React.useCallback(async () => {
        const own = life.current;
        try {
            const data = await rpc('getMod', { modId: FORK_DANMAKU_MOD });
            if (own !== life.current) return;
            const values = data?.settings?.values || {};
            if (values.view && values.view !== 'off') last.current = values.view;
            setState({ loading: false, enabled: data?.scope === 'global', values, manifest: data?.manifest || null, options: forkDanmakuViewOptions(data?.manifest), error: '' });
        } catch (_) { if (own === life.current) setState(s => ({ ...s, loading: false, enabled: false })); } // not installed / unavailable: nothing
    }, [rpc]);
    React.useEffect(() => {
        life.current++; read();
        const refresh = () => read();
        window.addEventListener('dsh-tavern-mods-changed', refresh);
        return () => { life.current++; window.removeEventListener('dsh-tavern-mods-changed', refresh); };
    }, [read]);
    async function set(patch, failure) {
        if (Object.entries(patch).every(([k, v]) => state.values[k] === v)) return;
        if (patch.view && patch.view !== 'off') last.current = patch.view;
        setState(s => ({ ...s, values: { ...s.values, ...patch }, error: '' })); // the stage answers at once; a failure puts it back
        try { await forkDanmakuSave(rpc, patch); }
        catch (_) { setState(s => ({ ...s, error: failure || '没能保存弹幕设置' })); read(); }
    }
    return { ...state, view: state.values.view || 'overlay', last: last.current, set };
}

// The switch glyph: a screen with three comment lines; while off a ⊘ badge cuts into its corner (masked, so it reads on
// any scene without a plate).
function ForkDanmakuIcon({ off }) {
    const h = React.createElement, id = 'fork-dm-cut-' + (React.useId ? React.useId().replace(/[^a-zA-Z0-9_-]/g, '') : 'x');
    const body = h('g', off ? { mask: 'url(#' + id + ')' } : null,
        h('path', { d: 'M5.5 4.5h13A2.5 2.5 0 0 1 21 7v9a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16V7a2.5 2.5 0 0 1 2.5-2.5z' }),
        h('path', { d: 'M6.8 8.6h5.4M14.6 8.6h2.8M9.2 11.8h8M6.8 15h4.2' }));
    return h('svg', { className: 'fork-gal-danmaku-icon', width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true, focusable: 'false' },
        off ? h('mask', { id }, h('rect', { x: 0, y: 0, width: 24, height: 24, fill: 'white', stroke: 'none' }), h('circle', { cx: 18.6, cy: 17.6, r: 5.6, fill: 'black', stroke: 'none' })) : null,
        body,
        off ? h('g', { className: 'fork-gal-danmaku-cut' }, h('circle', { cx: 18.6, cy: 17.6, r: 3.6 }), h('path', { d: 'M16.1 20.1l5-5' })) : null);
}

// props: { rpc }. Nothing when the mod is off or not installed.
function ForkDanmakuToggle({ rpc }) {
    const h = React.createElement;
    const dm = useForkDanmakuMod(rpc);
    const [open, setOpen] = React.useState(false);
    const button = React.useRef(null), panel = React.useRef(null);
    const sfx = name => { if (typeof forkUiSfx === 'object' && forkUiSfx) forkUiSfx.play(name); };
    const choose = view => dm.set({ view }, '没能切换弹幕视图');
    React.useEffect(() => {
        if (!open) return undefined;
        (panel.current?.querySelector('[aria-checked="true"]') || panel.current?.querySelector('button'))?.focus({ preventScroll: true });
        function close(refocus) { sfx('close'); setOpen(false); if (refocus) button.current?.focus(); }
        // Esc closes the menu before the stage sees it (the stage would open its system menu on Esc).
        function onKey(event) { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close(true); } }
        let timer = 0;
        function swallow(event) { event.stopPropagation(); event.preventDefault(); }
        function outside(event) {
            if (panel.current?.contains(event.target) || button.current?.contains(event.target)) return;
            close(false);
            // A click on the bare stage only dismisses; it does not also turn the page.
            if (!event.target?.closest?.('button, input, select, textarea, a')) {
                document.addEventListener('click', swallow, { capture: true, once: true });
                timer = setTimeout(() => document.removeEventListener('click', swallow, true), 600);
            }
        }
        window.addEventListener('keydown', onKey, true);
        document.addEventListener('pointerdown', outside, true);
        return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('pointerdown', outside, true); clearTimeout(timer); };
    }, [open]);
    React.useEffect(() => {
        if (!dm.enabled) return undefined;
        function onKey(event) { const next = forkDanmakuShortcut(event, { current: dm.view, last: dm.last, options: dm.options }); if (next) { event.preventDefault(); choose(next); } }
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [dm.enabled, dm.view, dm.last, dm.options]);
    if (!dm.enabled || !dm.options.length) return null;
    const off = dm.view === 'off';
    const label = '弹幕：' + (FORK_DANMAKU_VIEW_NAMES[dm.view] || FORK_DANMAKU_VIEW_NAMES.overlay) + (dm.error ? '（' + dm.error + '）' : '');
    const stop = event => event.stopPropagation();
    const keys = event => {
        event.stopPropagation();
        const items = [...panel.current.querySelectorAll('[role="menuitemradio"]')], i = items.indexOf(document.activeElement), n = items.length;
        const next = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: n - 1 }[event.key];
        if (next !== undefined && n) { event.preventDefault(); items[(next + n) % n].focus(); }
        if (event.key === 'Tab') setOpen(false);
    };
    return h('div', { className: 'fork-gal-danmaku-anchor', onClick: stop, onWheel: stop, onContextMenu: stop },
        h('button', { ref: button, type: 'button', className: 'fork-gal-danmaku', 'data-view': dm.view, 'data-warn': dm.error ? true : undefined, 'aria-haspopup': 'menu', 'aria-expanded': open,
            title: label, 'aria-label': label,
            onKeyDown: event => { if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') event.stopPropagation(); if (event.key === 'ArrowDown' && !open) { event.preventDefault(); setOpen(true); } },
            onClick: () => { sfx(open ? 'close' : 'open'); setOpen(!open); } }, h(ForkDanmakuIcon, { off })),
        open ? h('div', { ref: panel, className: 'fork-gal-danmaku-menu', role: 'menu', 'aria-label': '弹幕', onKeyDown: keys },
            dm.options.map(o => h('button', { key: o.value, type: 'button', role: 'menuitemradio', 'aria-checked': o.value === dm.view, className: 'fork-gal-danmaku-item' + (o.value === 'off' ? ' is-off' : ''),
                onClick: () => { sfx('confirm'); setOpen(false); button.current?.focus(); choose(o.value); } },
                h('span', null, o.label), o.value === 'off' ? h('kbd', { 'aria-hidden': true }, 'D') : null))) : null);
}

// props: { rpc, compact }. The stage CONFIG section (fork-gal-config.js building blocks; include after it). Sliders
// preview while dragging and save on release; nothing when the mod is off or declares none of these fields.
function ForkDanmakuStageConfig({ rpc }) {
    const h = React.createElement, dm = useForkDanmakuMod(rpc), [draft, setDraft] = React.useState({});
    const rows = forkDanmakuStageFields(dm.manifest);
    if (!dm.enabled || !rows.length) return null;
    const value = (key, field) => draft[key] ?? dm.values[key] ?? field.default;
    const slider = (key, field, ends, label) => {
        const v = Number(value(key, field)), text = n => Math.round(n) + '%';
        return forkGalConfigSlider(ends, { min: field.min ?? 10, max: field.max ?? 100, step: field.step || 5, value: v, label, valueText: text(v), output: text(v),
            onChange: n => setDraft(d => ({ ...d, [key]: n })), onCommit: n => { setDraft(d => { const { [key]: _, ...rest } = d; return rest; }); dm.set({ [key]: n }); } });
    };
    const row = ({ key, field }) => {
        if (key === 'area') return forkGalConfigRow('显示区域', forkGalConfigSegmented({ label: '显示区域', value: value(key, field),
            options: (field.choices || []).filter(c => FORK_DANMAKU_AREA_NAMES[c.value]).map(c => [c.value, FORK_DANMAKU_AREA_NAMES[c.value]]), onChange: v => dm.set({ area: v }) }),
            '飘屏的滚动和顶部弹幕只用画面上方这一部分；底部弹幕照常贴在文本框上沿。');
        if (key === 'opacity') return forkGalConfigRow('不透明度', slider(key, field, ['淡', '浓'], '不透明度'));
        if (key === 'fontScale') return forkGalConfigRow('字号', slider(key, field, ['小', '大'], '字号'));
        return forkGalConfigRow('显示密度', forkGalConfigSegmented({ label: '显示密度', value: value(key, field), options: (field.choices || []).map(c => [c.value, c.value === 'low' ? '疏朗' : '标准']), onChange: v => dm.set({ density: v }) }),
            '疏朗：同屏弹幕减半，来不及显示的就跳过。飘屏和直播风格都生效。');
    };
    // Its own CONFIG tab (弹幕): 「显示」 (density, both views) then 「飘屏」 (the viewer's appearance rows); an empty group is left out.
    const error = dm.error ? h('span', { key: 'error', className: 'fork-gal-config-caption-rest', role: 'alert' }, '⚠ ' + dm.error) : null;
    const groups = [['显示', rows.filter(r => r.key === 'density')], ['飘屏', rows.filter(r => r.key !== 'density')]].filter(([, list]) => list.length);
    return h(React.Fragment, null, groups.map(([title, list], i) => h(React.Fragment, { key: title },
        forkGalConfigGroup([title, i === 0 ? error : null], null, ...list.map(r => h(React.Fragment, { key: r.key }, row(r)))))));
}

// The stage CONFIG tab entry for the host's FORK_STAGE_CONFIG_SECTIONS (P6-REQUESTS.md F6): one name to reference.
const FORK_DANMAKU_STAGE_CONFIG = Object.freeze({ label: '弹幕', en: 'DANMAKU', Component: ForkDanmakuStageConfig });
// First-party static registration in the host's application-owned slots (F6 stage CONFIG tab, F7 top-right quick entry;
// fork-gal-config.js, included before this file). Idempotent: the host may also list them itself.
if (typeof FORK_STAGE_CONFIG_SECTIONS === 'object' && FORK_STAGE_CONFIG_SECTIONS) FORK_STAGE_CONFIG_SECTIONS[FORK_DANMAKU_MOD] = FORK_DANMAKU_STAGE_CONFIG;
if (typeof FORK_STAGE_QUICK_ENTRIES === 'object' && FORK_STAGE_QUICK_ENTRIES) FORK_STAGE_QUICK_ENTRIES[FORK_DANMAKU_MOD] = ForkDanmakuToggle;

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { FORK_DANMAKU_STAGE_CONFIG, FORK_DANMAKU_MOD, FORK_DANMAKU_VIEW_NAMES, FORK_DANMAKU_AREA_NAMES, FORK_DANMAKU_STAGE_FIELDS, forkDanmakuViewOptions, forkDanmakuShortcut, forkDanmakuStageFields };
