// private fork (mod-pages, owner 2026-10; approved design output/mod-plan/config-proposal, data docs/fork/mod-config.md):
// the settings pages of the first-party phone and items mods on the two-layer config model (全局 / 本卡, each value 自动 /
// 固定 / 引用 / 公式). They replace the generic pack-editor page for these two mods (ModDetail picks them by mod ID): the
// phone is a WYSIWYG preview — click a part to edit it; every phone setting is a part of it (settings-ux r2);
// the items page keeps its item packs and gains 背包. Every write goes through useForkModConfig (getModConfig /
// setModConfig / clearModConfig / uploadModConfigFile); thumbnails of uploaded files through readModConfigFile.
// The battery levels shared with the stage phone (≤40% yellow, ≤20% red):
// @include-mod phone/view/battery.js
const FORK_PHONE_SIZE = { w: 260, h: 540 };
// Preview parts in the preview's own 260 × 540 units. The frame comes first: it is under every other part, so the bezel
// (and only what nothing else covers) opens 机身颜色. private fork (settings-ux r2, owner 2026-10): every setting is on the
// phone — the status bar's own gaps open 显示状态栏 (a hidden bar is all gap), the bell at the end of the chat bar 来信提示音.
const FORK_PHONE_STATUS_PARTS = ['clockText', 'carrier', 'signal', 'battery'];
const FORK_PHONE_SPOTS = [
    { key: 'bodyColor', label: '机身颜色', target: '.fork-phone', rect: [0, 0, 260, 540] },
    { key: 'statusBar', label: '状态栏', target: '.fork-phone-status', rect: [9, 9, 242, 34] },
    { key: 'wallpaper', label: '壁纸', target: '.fork-phone-msgs', rect: [9, 97, 242, 386] },
    { key: 'clockText', label: '状态栏时间', target: '.fork-phone-clock', rect: [27, 21, 46, 11] },
    { key: 'cutout', label: '机型', target: '.fork-phone-cut', rect: [97, 16, 66, 19] },
    { key: 'carrier', label: '运营商', target: '.fork-phone-carrier', rect: [170, 16, 24, 18] },
    { key: 'signal', label: '信号', target: '.fork-phone-bars', rect: [198, 19, 15, 11] },
    { key: 'battery', label: '电量', target: '.fork-phone-batt', rect: [217, 19, 24, 11] },
    { key: 'contacts', label: '联系人', target: '.fork-phone-peer', rect: [37, 55, 120, 34] },
    { key: 'sound', label: '来信提示音', target: '.fork-phone-bell', rect: [223, 63, 18, 18], round: true },
    { key: 'accentColor', label: '主题色', target: '.fork-phone-bubble[data-side=out]', rect: [150, 150, 92, 33] },
    { key: 'surfaceColor', label: '内容底色', target: '.fork-phone-composer', rect: [9, 483, 242, 48] }
];
const forkCfgOwn = (layer, key) => !!layer && Object.prototype.hasOwnProperty.call(layer, key);
function forkCfgResolved(config, key) { const r = config.data && config.data.resolved && config.data.resolved[key]; return r && !r.error ? r : null; }
// Uploaded files of one mod as data: URLs (readModConfigFile is an authenticated RPC, not a GET route), cached per layer
// and path for the life of the page. A failed read is retried a few times (a card's first upload creates its private
// pack, and the card can take a moment to name it), then shows empty.
function useForkCfgFiles(rpc, modId, cardId) {
    const [files, setFiles] = React.useState({}), asked = React.useRef(new Set()), tries = React.useRef(new Map());
    React.useEffect(() => { asked.current = new Set(); tries.current = new Map(); setFiles({}); }, [rpc, modId, cardId]);
    return React.useCallback(function ({ layer, path }) {
        const key = layer + ':' + path;
        if (Object.prototype.hasOwnProperty.call(files, key)) return files[key] || null;
        if (!asked.current.has(key)) {
            asked.current.add(key);
            rpc('readModConfigFile', { modId, layer, path, ...(layer === 'card' && cardId ? { cardId } : {}) })
                .then(result => setFiles(now => ({ ...now, [key]: 'data:' + result.file.mime + ';base64,' + result.data })), () => {
                    const n = (tries.current.get(key) || 0) + 1; tries.current.set(key, n);
                    setFiles(now => ({ ...now, [key]: '' }));
                    if (n < 4) setTimeout(() => { if (tries.current.get(key) !== n) return; asked.current.delete(key); setFiles(now => { const next = { ...now }; delete next[key]; return next; }); }, 800 * n);
                });
        }
        return null;
    }, [files, rpc, modId, cardId]);
}
// The phone's contacts. private fork (settings-ux r2, owner 2026-10): exactly the stage's — the stage source's /contacts
// (fork-mod-config-host.js: the enabled figures of the card's packs through the one figure catalogue, keyed by the actor
// key the stage uses), each with its figure ref for the face. Without them (no card): the stage's characters of an open
// chat, then the stage source's characters. Plus any alias the settings already name.
const forkCfgNodeValue = node => node.children ? Object.fromEntries(node.children.map(child => [child.name, forkCfgNodeValue(child)])) : node.value;
function forkPhoneContacts(config, characters) {
    const rows = [], seen = new Set(), add = row => { if (row && row.alias && !seen.has(row.alias)) { seen.add(row.alias); rows.push(row); } };
    const stage = (config.sources || []).find(s => s.id === 'stage'), node = path => stage && (stage.tree || []).find(n => n.path === path);
    const listed = node('/contacts');
    if (listed && listed.children && listed.children.length) for (const row of listed.children.map(forkCfgNodeValue)) add({ alias: row.id, name: row.name || row.id, color: row.color, figure: row.figure && row.figure.packId ? row.figure : null, face: null });
    else {
        for (const c of characters || []) add({ alias: c.alias, name: c.name || c.alias, color: c.color, face: typeof c.avatar === 'string' ? c.avatar : c.avatar && c.avatar.src || null });
        const list = node('/characters');
        for (const row of (list && list.children || []).map(forkCfgNodeValue)) add({ alias: row.id, name: row.name || row.id, color: row.color, figure: row.figure && row.figure.packId ? row.figure : null, face: null });
    }
    const set = forkCfgResolved(config, 'contacts'), value = set && set.value && typeof set.value === 'object' ? set.value : {};
    for (const alias of Object.keys(value)) add({ alias, name: alias, color: null, face: null });
    return rows;
}
// 壁纸 is a set of up to 8 wallpapers ({file, name?, default?}[]): the one marked default (else the first) shows on the
// phone, and all of them are what the director can switch to during the story. A single image saved before the set reads
// as a set of one.
const FORK_PHONE_WALLS_MAX = 8;
const forkPhoneWalls = value => Array.isArray(value) ? value.filter(w => w && w.file) : value && value.file ? [{ file: value.file }] : [];
const forkPhoneWallDefault = list => Math.max(0, list.findIndex(w => w.default === true));
function forkPhoneContactView(config, files, contact) {
    const r = forkCfgResolved(config, 'contacts'), own = r && r.value && r.value[contact.alias] || {};
    const avatar = own.avatar && own.avatar.file ? files({ layer: r.layer, path: own.avatar.file }) : null;
    return { name: own.name || contact.name, avatar: avatar || contact.face, overridden: !!(own.name || own.avatar) };
}
// One round face: the uploaded / given picture, else the figure's own avatar (faceOf), else the initial on its colour.
function ForkPhoneFace({ shown, contact, faceOf, className }) {
    const h = React.createElement, art = !shown.avatar && contact && contact.figure && faceOf ? faceOf(contact.figure, shown.name) : null;
    return h('span', { className, 'data-art': art ? true : undefined, style: shown.avatar ? { backgroundImage: 'url("' + shown.avatar + '")' } : contact && contact.color ? { background: contact.color } : undefined },
        shown.avatar ? '' : art || Array.from(String(shown.name || '?'))[0]);
}
// The preview: the player's phone open on a chat with the first contact — the left bubbles are the contact, the right
// bubbles the player. It paints the resolved values of the scope being edited.
function ForkPhonePreview({ config, files, contact, faceOf }) {
    const h = React.createElement, v = key => { const r = forkCfgResolved(config, key); return r ? r.value : null; };
    const wall = forkCfgResolved(config, 'wallpaper'), walls = wall ? forkPhoneWalls(wall.value) : [], shownWall = walls[forkPhoneWallDefault(walls)];
    const wallUrl = shownWall ? files({ layer: wall.layer, path: shownWall.file }) : null;
    const battery = Math.max(0, Math.min(100, Number(v('battery') ?? 80))), signal = Math.max(0, Math.min(4, Math.round(Number(v('signal') ?? 4))));
    // A colour that cannot be read paints the field's declared default (as on stage).
    const hex = key => { const value = v(key), field = config.fields.get(key); return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : field && field.default; };
    const shown = contact ? forkPhoneContactView(config, files, contact) : { name: '联系人', avatar: null };
    // Text on the content surface is dark or light by the surface's luminance, as in the phone view.
    const lum = c => { const rgb = String(c || '').slice(1).match(/../g) || []; return rgb.length === 3 ? rgb.map(x => parseInt(x, 16) / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0) : 1; };
    return h('div', { className: 'fork-phone', 'data-ink': lum(hex('surfaceColor')) > .179 ? 'dark' : 'light', 'data-frame': ['island', 'notch', 'none'].includes(v('cutout')) ? v('cutout') : 'island',
            style: { '--fork-phone-accent': hex('accentColor'), '--fork-phone-surface': hex('surfaceColor'), '--fork-phone-body': hex('bodyColor') } },
        h('div', { className: 'fork-phone-screen' },
            h('div', { className: 'fork-phone-wall', 'data-image': wallUrl ? true : undefined, style: wallUrl ? { backgroundImage: 'url("' + wallUrl + '")' } : undefined }),
            h('i', { className: 'fork-phone-cut' }),
            v('statusBar') === false ? h('div', { className: 'fork-phone-status' }) : h('div', { className: 'fork-phone-status' },
                h('span', { className: 'fork-phone-clock' }, v('clockText') ?? ''),
                h('span', { className: 'fork-phone-sys' },
                    h('span', { className: 'fork-phone-carrier' }, v('carrier') || ''),
                    h('span', { className: 'fork-phone-bars' }, [1, 2, 3, 4].map(i => h('i', { key: i, 'data-on': i <= signal || undefined, style: { height: 3 + i * 2 } }))),
                    h('span', { className: 'fork-phone-batt', 'data-level': forkPhoneBatteryLevel(battery) }, h('i', { style: { width: battery + '%' } }), h('b', null, Math.round(battery))))),
            h('div', { className: 'fork-phone-appbar' }, h('span', { className: 'fork-phone-back' }, '‹'),
                h('span', { className: 'fork-phone-peer' }, h(ForkPhoneFace, { shown, contact, faceOf, className: 'fork-phone-avatar' }), h('strong', null, shown.name)),
                // 来信提示音: a bell (struck through for 静音) at the end of the chat bar.
                h('span', { className: 'fork-phone-bell', 'data-off': v('sound') === 'none' || v('sound') === false || undefined },
                    h('svg', { width: 18, height: 18, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
                        h('path', { d: 'M4 11V7.2a4 4 0 0 1 8 0V11l1.2 1.4H2.8L4 11ZM6.6 14.2h2.8' + (v('sound') === 'none' || v('sound') === false ? 'M2.5 2.5l11 11' : ''), stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' })))),
            h('div', { className: 'fork-phone-msgs' },
                [['in', '明天一起去上学吧！'], ['out', '好，老地方见'], ['in', '嘿嘿，晚安～']].map(([side, text], i) => h('div', { key: i, className: 'fork-phone-row', 'data-side': side },
                    side === 'in' ? h(ForkPhoneFace, { shown, contact, faceOf, className: 'fork-phone-avatar is-small' }) : null,
                    h('div', { className: 'fork-phone-bubble', 'data-side': side }, text)))),
            h('div', { className: 'fork-phone-composer' }, h('span', null, '+'), h('i'))));
}
// 联系人: one row per character — 备注名 (empty = the card's name) and 头像 (upload; 恢复 = the card's face). The map is one
// setting, written whole at the layer being edited; removing the last override clears the key (恢复为全局 / 自动).
function ForkPhoneContactsEditor({ config, files, contacts, faceOf, anchor, beside, placement, onClose }) {
    const h = React.createElement, pop = React.useRef(null), input = React.useRef(null), target = React.useRef(null), titleId = 'fork-phone-contacts-t';
    const [place, setPlace] = React.useState(null), [sheet, setSheet] = React.useState(false), [busy, setBusy] = React.useState('');
    const close = reason => { onClose && onClose(reason); if (reason === 'escape' && anchor && anchor.focus) anchor.focus(); };
    useForkOverlay(true, () => [pop.current, anchor, ...(typeof document !== 'undefined' ? document.querySelectorAll('[data-fork-cfg-keep]') : [])], close);
    useForkCfgPlacement(pop, { anchor, beside, placement }, setPlace, setSheet);
    React.useEffect(() => { config.needSources(); }, []);
    const focused = React.useRef(false);
    React.useEffect(() => { if (focused.current || !(place || sheet) || !pop.current) return; focused.current = true; const first = pop.current.querySelector('button'); if (first) first.focus({ preventScroll: true }); }, [place, sheet]);
    const data = config.data || {}, layer = config.layerFor('contacts'), own = forkCfgOwn(data[layer], 'contacts');
    // The map being edited: this layer's own value, else what this layer shows now (so a first edit keeps the others).
    const base = latest => { const d = latest || data, mine = d[layer] && d[layer].contacts; if (mine && mine.fixed) return mine.fixed; const r = d.resolved && d.resolved.contacts; return r && !r.error && r.value && typeof r.value === 'object' ? r.value : {}; };
    const write = next => Object.keys(next).length ? config.set('contacts', { fixed: next }) : config.clear('contacts');
    const change = (alias, patch) => {
        const all = { ...base() }, row = { ...(all[alias] || {}), ...patch };
        for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === '') delete row[k];
        if (Object.keys(row).length) all[alias] = row; else delete all[alias];
        return write(all);
    };
    const upload = file => {
        const alias = target.current; if (!alias) return;
        setBusy(alias);
        Promise.resolve(config.upload('contacts', file, (path, latest) => { const all = { ...base(latest) }; all[alias] = { ...(all[alias] || {}), avatar: { file: path } }; return { fixed: all }; })).finally(() => setBusy(''));
    };
    const current = base(), rows = contacts.length ? contacts : [];
    const style = sheet || !place ? (sheet ? undefined : { visibility: 'hidden', left: -9999, top: 0 }) : { left: place.left, top: place.top };
    const node = h('section', { ref: pop, className: 'fork-cfg-pop fk-surface fork-phone-contacts', 'data-level': 'popover', 'data-sheet': sheet || undefined, role: 'dialog', 'aria-modal': false, 'aria-labelledby': titleId, style },
        h('header', { className: 'fork-cfg-pop-head' }, h('span', { className: 'fork-cfg-pop-title', id: titleId }, '联系人'),
            own ? h(ForkOverrideDot, { layer }) : null,
            own ? h(ForkResetButton, { label: forkCfgResetLabel(layer), onClick: () => config.clear('contacts') }) : null,
            h('button', { type: 'button', className: 'fork-cfg-icon', 'aria-label': '关闭', title: '关闭', onClick: () => close('button') }, h(ForkInlineGlyph, { name: 'close' }))),
        h('div', { className: 'fork-cfg-pop-body' },
            rows.length ? rows.map(contact => {
                const mine = current[contact.alias] || {}, shown = forkPhoneContactView(config, files, contact), face = mine.avatar && mine.avatar.file ? files({ layer: own ? layer : (forkCfgResolved(config, 'contacts') || {}).layer, path: mine.avatar.file }) : contact.face;
                return h('div', { key: contact.alias, className: 'fork-phone-contact' },
                    face ? h('span', { className: 'fork-cfg-thumb is-round' }, h('img', { src: face, alt: '' })) : h(ForkPhoneFace, { shown: { name: shown.name, avatar: null }, contact, faceOf, className: 'fork-cfg-thumb is-round' }),
                    h(ForkInlineField, { kind: 'text', label: contact.name + ' 备注名', hideLabel: true, value: mine.name || '', placeholder: contact.name, maxLength: 64, trim: true, onCommit: next => change(contact.alias, { name: next || undefined }) }),
                    h('button', { type: 'button', className: 'fork-cfg-link', disabled: !!busy, 'aria-label': contact.name + ' 上传头像', onClick: () => { target.current = contact.alias; input.current && input.current.click(); } }, busy === contact.alias ? h(ForkSpinner, null) : null, '头像'),
                    mine.name || mine.avatar ? h('button', { type: 'button', className: 'fork-cfg-link', 'aria-label': contact.name + ' 恢复', onClick: () => change(contact.alias, { name: undefined, avatar: undefined }) }, '恢复') : null);
            }) : h('div', { className: 'fork-cfg-meta' }, '这张卡还没有人物')),
        config.error ? h('div', { className: 'fork-cfg-result is-warn', role: 'alert' }, '⚠ ', config.error) : null,
        h('input', { ref: input, type: 'file', accept: 'image/png,image/jpeg,image/webp', hidden: true, onChange: event => { const file = event.target.files && event.target.files[0]; event.target.value = ''; if (file) upload(file); } }));
    return forkInlineCanPortal() ? ReactDOM.createPortal(h('div', { className: 'ap-ui ap-layer fork-cfg-layer' }, node), document.body) : node;
}
// 壁纸: one row of thumbnails, an add tile (upload, several files at once) and per thumbnail 「设为默认」 / 移除. The set
// is one setting of the layer being edited and 本卡's set replaces 全局's as a whole — uploaded files belong to their
// layer, so a first 本卡 upload starts 本卡's own set. Removing the last wallpaper clears the key (恢复为全局 / 自动).
function ForkPhoneWallpaperEditor({ config, files, anchor, beside, placement, onClose }) {
    const h = React.createElement, pop = React.useRef(null), input = React.useRef(null), titleId = 'fork-phone-walls-t';
    const [place, setPlace] = React.useState(null), [sheet, setSheet] = React.useState(false), [busy, setBusy] = React.useState(0);
    const close = reason => { onClose && onClose(reason); if (reason === 'escape' && anchor && anchor.focus) anchor.focus(); };
    useForkOverlay(true, () => [pop.current, anchor, ...(typeof document !== 'undefined' ? document.querySelectorAll('[data-fork-cfg-keep]') : [])], close);
    useForkCfgPlacement(pop, { anchor, beside, placement }, setPlace, setSheet);
    const focused = React.useRef(false);
    React.useEffect(() => { if (focused.current || !(place || sheet) || !pop.current) return; focused.current = true; const first = pop.current.querySelector('.fork-phone-walls-row button, button'); if (first) first.focus({ preventScroll: true }); }, [place, sheet]);
    const data = config.data || {}, layer = config.layerFor('wallpaper'), own = forkCfgOwn(data[layer], 'wallpaper');
    const mine = latest => { const d = latest || data, v = d[layer] && d[layer].wallpaper; return v && v.fixed ? forkPhoneWalls(v.fixed) : []; };
    const inherited = layer === 'card' && forkCfgOwn(data.global, 'wallpaper') && data.global.wallpaper.fixed ? forkPhoneWalls(data.global.wallpaper.fixed) : [];
    const list = own ? mine() : inherited, from = own ? layer : 'global', def = forkPhoneWallDefault(list);
    const write = next => next.length ? config.set('wallpaper', { fixed: next }) : config.clear('wallpaper');
    const plain = w => { const row = { file: w.file }; if (w.name) row.name = w.name; return row; };
    const setDefault = i => write(mine().map((w, j) => j === i ? { ...plain(w), default: true } : plain(w)));
    const remove = i => write(mine().filter((w, j) => j !== i));
    const add = picked => {
        const room = Math.max(0, FORK_PHONE_WALLS_MAX - (own ? list.length : 0)), chosen = Array.from(picked || []).slice(0, room);
        if (!chosen.length) return;
        setBusy(n => n + chosen.length);
        for (const file of chosen) {
            const name = String(file.name || '').replace(/\.[^.]+$/, '').trim().slice(0, 64);
            Promise.resolve(config.upload('wallpaper', file, (path, latest) => ({ fixed: [...mine(latest), { file: path, ...(name ? { name } : {}) }].slice(0, FORK_PHONE_WALLS_MAX) }))).finally(() => setBusy(n => Math.max(0, n - 1)));
        }
    };
    const cardHides = layer === 'global' && config.cardId && forkCfgOwn(data.card, 'wallpaper');
    const style = sheet || !place ? (sheet ? undefined : { visibility: 'hidden', left: -9999, top: 0 }) : { left: place.left, top: place.top };
    const node = h('section', { ref: pop, className: 'fork-cfg-pop fk-surface fork-phone-walls', 'data-level': 'popover', 'data-sheet': sheet || undefined, role: 'dialog', 'aria-modal': false, 'aria-labelledby': titleId, style },
        h('header', { className: 'fork-cfg-pop-head' }, h('span', { className: 'fork-cfg-pop-title', id: titleId }, '壁纸'),
            own ? h(ForkOverrideDot, { layer }) : null,
            own ? h(ForkResetButton, { label: forkCfgResetLabel(layer), onClick: () => config.clear('wallpaper') }) : null,
            h('button', { type: 'button', className: 'fork-cfg-icon', 'aria-label': '关闭', title: '关闭', onClick: () => close('button') }, h(ForkInlineGlyph, { name: 'close' }))),
        h('div', { className: 'fork-cfg-pop-body' },
            !own ? h('div', { className: 'fork-cfg-meta' }, inherited.length ? '沿用全局的 ' + inherited.length + ' 张；在本卡添加会建立本卡自己的一组，整组替换全局' : '沿用自动：舞台底色') : null,
            h('div', { className: 'fork-phone-walls-row', role: 'list', 'aria-label': '壁纸' },
                list.map((w, i) => {
                    const url = files({ layer: from, path: w.file }), name = w.name || '壁纸 ' + (i + 1), isDefault = i === def;
                    return h('div', { key: w.file, className: 'fork-phone-wall-item', role: 'listitem', 'data-default': isDefault || undefined, 'data-inherited': own ? undefined : true },
                        h('span', { className: 'fork-cfg-thumb fork-phone-wall-thumb', 'data-empty': url ? undefined : true, title: name }, url ? h('img', { src: url, alt: name }) : null,
                            isDefault ? h('b', { className: 'fork-phone-wall-badge' }, '默认') : null),
                        own ? h('button', { type: 'button', className: 'fork-cfg-icon fork-phone-wall-remove', 'aria-label': '移除 ' + name, title: '移除', onClick: () => remove(i) }, h(ForkInlineGlyph, { name: 'close' })) : null,
                        own && !isDefault ? h('button', { type: 'button', className: 'fork-cfg-link fork-phone-wall-default', 'aria-label': '设为默认 ' + name, onClick: () => setDefault(i) }, '设为默认') : null);
                }),
                !own || list.length < FORK_PHONE_WALLS_MAX ? h('button', { type: 'button', className: 'fork-phone-wall-add', 'aria-label': '添加壁纸', title: '添加壁纸', disabled: busy > 0 || undefined, onClick: () => input.current && input.current.click() }, busy ? h(ForkSpinner, null) : '+') : null),
            h('div', { className: 'fork-cfg-meta' }, (own ? list.length + ' / ' + FORK_PHONE_WALLS_MAX + ' · ' : '') + '默认的那张显示在手机上，导演可在整组之间切换'),
            cardHides ? h('div', { className: 'fork-cfg-meta' }, '本卡 · ' + (config.cardName || '') + ' 另有一组，这张卡上看不到全局的') : null),
        config.error ? h('div', { className: 'fork-cfg-result is-warn', role: 'alert' }, '⚠ ', config.error) : null,
        h('input', { ref: input, type: 'file', accept: 'image/png,image/jpeg,image/webp', multiple: true, hidden: true, onChange: event => { const picked = Array.from(event.target.files || []); event.target.value = ''; add(picked); } }));
    return forkInlineCanPortal() ? ReactDOM.createPortal(h('div', { className: 'ap-ui ap-layer fork-cfg-layer' }, node), document.body) : node;
}
// private fork (settings-ux r2, owner 2026-10): beside the scope switch, the page-level reset (ForkResetButton) of the layer
// being edited — 全局: every value back to its default / 自动; 本卡: every 本卡 value cleared (the card follows 全局) — after
// one confirmation. Disabled while the layer sets nothing.
function ForkCfgScope({ config }) {
    const h = React.createElement, [ask, setAsk] = React.useState(false), keys = config.data ? config.ownKeys() : [];
    const card = config.scope === 'card' && !!config.cardId, label = card ? '清除本卡的全部修改' : '全部恢复默认';
    return h('div', { className: 'fork-cfg-scope-row' }, h(ForkScopeSwitch, { value: config.scope, onChange: config.setScope, cardName: config.cardName }),
        h(ForkResetButton, { label, disabled: !keys.length, onClick: () => setAsk(true) }),
        ask ? h(ConfirmDialog, { title: label, confirmLabel: card ? '清除' : '恢复', danger: !card, onClose: () => setAsk(false),
            body: card ? '本卡改过的 ' + keys.length + ' 项设置改回全局的值。' : '全局的 ' + keys.length + ' 项设置都恢复默认。',
            onConfirm: () => config.clearAll(keys) }) : null);
}
// private fork (mod-settings-simple, owner 2026-10): 状态来源 is one row of the page's list (no section repeating its
// name); its (?) says it is shared by every card. It has its own config (dsh.state, 全局 only).
const FORK_STATE_SOURCE_HELP = '全局共用。自动：卡里有 MVU 变量时读 MVU，没有时读游玩台账；也可手动指定其中一个。';
function ForkStateSourceField({ rpc, onChange }) {
    const h = React.createElement, config = useForkModConfig({ call: rpc, modId: 'dsh.state' }), previous = React.useRef(null);
    React.useEffect(() => {
        const revision = config.data?.revision;
        if (revision && previous.current && revision !== previous.current) onChange?.();
        if (revision) previous.current = revision;
    }, [config.data?.revision]);
    const help = h(Help, { text: FORK_STATE_SOURCE_HELP, label: '状态来源 说明' });
    if (!config.data) return h(ForkInlineRow, { label: '状态来源', help }, config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : h(ForkSpinner, { label: '正在载入' }));
    return h(React.Fragment, null, h(ForkCfgField, { config, fieldKey: 'source', label: '状态来源', help }),
        config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : null);
}
// The page's settings: one left-aligned list of compact rows (ForkCfgField) — 状态来源 first when the mod reads state —
// with loading / read / write errors under it.
function ForkCfgList({ rpc, config, keys, state }) {
    const h = React.createElement;
    return h(React.Fragment, null,
        h(ForkInlineGrid, { label: '设置', columns: 1, className: 'fork-cfg-list' },
            state ? h(ForkStateSourceField, { rpc, onChange: config.reload }) : null,
            config.data ? keys.map(key => h(ForkCfgField, { key, config, fieldKey: key })) : null),
        !config.data ? config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : h(ForkSpinner, { label: '正在载入' }) :
            config.error ? h(ErrorBox, { error: config.error, reload: config.reload }) : null);
}
// private fork (mod-settings-simple, owner 2026-10): a compact page like the other settings — the 全局 / 本卡 switch on
// top, the short list (状态来源 and what the phone cannot show), then the phone at its own size with its hint, all
// left-aligned. A part of the phone opens its editor as a popover beside the phone (a bottom sheet on a narrow window).
// faceOf(figureRef, name): the panel's face of a figure (the stage settings pass it; without it the initial shows).
function ForkPhoneConfigPage({ rpc, cardId, cardName, sessionId, faceOf }) {
    const h = React.createElement, files = useForkCfgFiles(rpc, 'dsh.phone', cardId);
    const config = useForkModConfig({ call: rpc, modId: 'dsh.phone', cardId, sessionId, cardName, fileUrl: files });
    const bubbles = useForkBubbles(sessionId || '', !!sessionId), characters = bubbles && bubbles.config && bubbles.config.characters || [];
    React.useEffect(() => { config.needSources(); }, []);
    const contacts = forkPhoneContacts(config, characters);
    const editor = (key, place) => key === 'contacts' ? h(ForkPhoneContactsEditor, { config, files, contacts, faceOf, ...place }) : key === 'wallpaper' ? h(ForkPhoneWallpaperEditor, { config, files, ...place }) : null;
    const bar = forkCfgResolved(config, 'statusBar'), spots = bar && bar.value === false ? FORK_PHONE_SPOTS.filter(spot => !FORK_PHONE_STATUS_PARTS.includes(spot.key)) : FORK_PHONE_SPOTS;
    const listed = config.data ? Array.from(config.fields.keys()).filter(key => !FORK_PHONE_SPOTS.some(spot => spot.key === key)) : [];
    return h('div', { className: 'fork-cfg-page fork-phone-page', 'data-compact': true },
        h(ForkCfgScope, { config }),
        h(ForkCfgList, { rpc, config, keys: listed, state: true }),
        h('div', { className: 'fork-cfg-previewbox' },
            h(ForkPreviewHotspots, { config, width: FORK_PHONE_SIZE.w, height: FORK_PHONE_SIZE.h, hotspots: spots, label: '手机预览', editor },
                config.data ? h(ForkPhonePreview, { config, files, contact: contacts[0] || null, faceOf }) : null),
            h('p', { className: 'fork-cfg-hint' }, '点手机上的任意部位修改')));
}
// A mod whose settings need no preview (文字演出: 强度): the scope switch and one row per setting, above the mod's own
// packs when it has any.
function ForkModConfigList({ rpc, cardId, cardName, sessionId, modId, manifest, data }) {
    const h = React.createElement, config = useForkModConfig({ call: rpc, modId, cardId, sessionId, cardName });
    const packs = !!(manifest && manifest.assetKinds && manifest.assetKinds.length);
    return h('div', { className: 'fork-cfg-page', 'data-mod': modId, 'data-compact': packs ? undefined : true },
        h(ForkCfgScope, { config }),
        h(ForkCfgList, { rpc, config, keys: config.data ? Array.from(config.fields.keys()) : [] }),
        packs ? h(ModAssets, { rpc, cardId, modId, data, title: '素材包' }) : null);
}
function ForkItemsCategories({ config, files }) {
    const h = React.createElement, [selected, setSelected] = React.useState(null), [busy, setBusy] = React.useState(false), [confirm, setConfirm] = React.useState(null), [problem, setProblem] = React.useState(''), pick = useSelection();
    const layer = config.layerFor('categories'), data = config.data, field = config.fields.get('categories');
    if (!data || !field) return null;
    const own = forkCfgOwn(data[layer], 'categories'), stored = own ? data[layer].categories : layer === 'card' ? data.global.categories : null;
    const rows = stored && stored.fixed || field.default, from = own ? layer : 'global', row = rows.find(item => item.id === selected);
    const save = async next => { setBusy(true); try { return await config.copyAndSet('categories', { fixed: next }, from); } finally { setBusy(false); } };
    const edit = patch => save(rows.map(item => item.id === selected ? { ...item, ...patch } : item));
    const upload = async file => {
        setBusy(true); setProblem('');
        try {
            const media = await modImageMedia(file), bytes = Uint8Array.from(atob(media.data), char => char.charCodeAt(0));
            const copied = await config.copyAndSet('categories', { fixed: rows }, from);
            if (!copied) return;
            await config.upload('categories', new Blob([bytes], { type: media.mime }), (path, latest) => ({ fixed: latest[layer].categories.fixed.map(item => item.id === selected ? { ...item, icon: { file: path } } : item) }));
        } catch (error) { setProblem(error.message || '上传失败'); }
        finally { setBusy(false); }
    };
    const action = pick.on ? h(SelectBar, { count: pick.ids.size, action: '删除', danger: true, busy, onCancel: pick.stop,
        onAction: () => setConfirm({ title: '删除所选分类？', body: '物品保留原标签，未登记标签使用默认图标。', confirmLabel: '删除', danger: true,
            onConfirm: async () => { await save(rows.filter(item => !pick.ids.has(item.id))); pick.stop(); setSelected(null); } }) }) :
        h(Popover, { label: '分类操作', trigger: ({ toggle, open }) => h(IconButton, { icon: 'more', label: '分类更多操作', 'aria-expanded': open, onClick: toggle }),
            content: close => h(MenuItem, { disabled: !rows.length || busy, onClick: () => { close(); setSelected(null); pick.start(); } }, '删除…') });
    return h(StageSection, { level: 2, title: '分类', foldKey: 'mod:dsh.items/categories', action,
        aside: own ? h(React.Fragment, null, h(ForkOverrideDot, { layer }), h(ForkResetButton, { label: forkCfgResetLabel(layer), disabled: busy, onClick: () => config.clear('categories') })) : null },
        h('div', { className: 'ap-mod-chips', role: 'group', 'aria-label': '物品分类', onKeyDown: e => { if (e.key === 'Escape' && pick.on) { e.stopPropagation(); pick.stop(); } } },
            rows.map(item => { const icon = item.icon, url = files({ layer: icon.file ? from : 'global', path: icon.file || 'categories/' + icon.builtin + '.png' });
                return h('button', { key: item.id, type: 'button', className: 'ap-mod-chip', disabled: busy, 'aria-pressed': pick.on ? undefined : selected === item.id,
                    role: pick.on ? 'checkbox' : undefined, 'aria-checked': pick.on ? pick.has(item.id) : undefined,
                    onClick: () => pick.on ? pick.flip(item.id) : setSelected(selected === item.id ? null : item.id) },
                    url ? h('img', { className: 'ap-mod-chip-art', src: url, alt: '' }) : null, item.label); }),
            !pick.on && rows.length < 64 ? h(CatAddTile, { label: '添加分类', className: 'ap-mod-chip-add', disabled: busy,
                onClick: async () => { if (busy) return; const id = 'c' + modRandom(8); let label = '新分类', n = 2; while (rows.some(item => item.label === label)) label = '新分类 ' + n++; if (await save([...rows, { id, label, icon: { builtin: 'misc' } }])) setSelected(id); } }) : null),
        !rows.length ? h('div', { className: 'fork-cfg-meta' }, '还没有分类') : null,
        !pick.on && row ? h(ForkInlineGrid, { label: row.label, columns: 1 },
            h(ForkInlineField, { kind: 'text', label: '名称', value: row.label, maxLength: 80, disabled: busy, validate: value => value.trim() ? '' : '请填写名称', onCommit: label => edit({ label: label.trim() }) }),
            h(ForkInlineRow, { label: '图标' }, h(ModUpload, { type: 'image', label: '换图', onFile: upload }))) : null,
        problem ? h(ErrorBox, { error: problem, reload: config.reload }) : null,
        confirm ? h(ConfirmDialog, { ...confirm, onClose: () => setConfirm(null) }) : null);
}
function ForkItemsConfigPage({ rpc, cardId, cardName, sessionId }) {
    const h = React.createElement, files = useForkCfgFiles(rpc, 'dsh.items', cardId);
    const config = useForkModConfig({ call: rpc, modId: 'dsh.items', cardId, cardName, sessionId, fileUrl: files });
    // Items use core props; this page owns settings and category icons, not mod packs.
    return h('div', { className: 'fork-cfg-page', 'data-mod': 'dsh.items' },
        h(ForkCfgScope, { config }),
        h(ForkCfgList, { rpc, config, keys: config.data ? Array.from(config.fields.keys()).filter(key => key !== 'categories') : [], state: true }),
        config.data ? h(ForkItemsCategories, { key: config.scope, config, files }) : null);
}
const ForkTextcardConfigPage = props => React.createElement(ForkModConfigList, { ...props, modId: 'dsh.textcard' });
const FORK_MOD_CONFIG_PAGES = { 'dsh.phone': ForkPhoneConfigPage, 'dsh.items': ForkItemsConfigPage, 'dsh.textcard': ForkTextcardConfigPage };
