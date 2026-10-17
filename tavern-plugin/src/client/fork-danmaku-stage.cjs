'use strict';

// private fork (P6 弹幕, dsh.danmaku; output/danmaku/P6-CONTRACT.md §2): the two audience-band renderers. Both read the
// same JSON DanmakuView; only the chosen perspective draws comments.
//  - view/overlay.js  飘屏 — what a viewer sees (bilibili): right→left scrolling, top-/bottom-fixed comments, colour and
//    size hints; lanes avoid every host safe region (dialogue box, top bar, choices, widget controls). Passthrough.
//  - view/sidebar.js  直播风格 — what the streamer (the player) sees, laid out like a streamer's own screen (OBS /
//    直播姬): on a wide stage the host yields a right column (dock) for the chat and, when keeping the scene's aspect
//    leaves a band below it, a 直播信息栏 there (live time, chapter, online/heat, the 醒目留言 tally, now playing). Chat
//    rows read like bilibili live: one username colour, viewers told apart only by badges (粉丝牌 / 舰长 / 房管); a
//    reply says 「回复 @名字」 and never indents. 醒目留言 (Super Chat, by amount tier) are a card in the list plus a
//    pill in the pinned strip over the chat for the tier's pin time. Phones and hosts without a dock get the same console
//    floating over the stage. The list scrolls (input regions).
//    In 飘屏 a 醒目留言 is only a short-lived tier card in the corner (the viewer's player shows it, it does not pin).
// Time is the host's active time (activeTimeMs, frozen while inactive); every comment is placed from its absolute
// offsetMs, so live play, remounts and history replay are the same projection. Motion is Web Animations on transform
// only (compositor), one timer per layer for the next due comment, a bounded node pool; inactive = zero ticks.

// Contract v3 budget: 32 visible comments in either view (醒目留言 included).
const DANMAKU_LIMITS = Object.freeze({ overlayVisible: 32, sidebarRows: 32, maxWaitMs: 2500, fixedMs: 4500, played: 400, pins: 6 });
// 醒目留言 (bilibili live Super Chat; contract v4: highlight.amount ∈ 30/50/100/500/1000/2000 CNY, null otherwise). The
// tiers keep bilibili's SUPER_CHAT colours (light header / saturated body, CSS tokens --gal-dm-sc-<index>-*) and its
// order of pin times — bilibili pins 1 / 2 / 5 / 30 / 60 / 120 min (official SC rules table); a story page lasts far less, so the pin (pinMs, the chat's top
// strip) is 20 s … 2 min of active time and the 飘屏 card (cardMs) 8 … 16 s. fx = strength of the brief entry effect
// (0 slide-in only · 1 a sheen · 2 + a glow · 3 + a second sheen · 4 + a spark burst); reduced motion shows none.
const DANMAKU_SC_TIERS = Object.freeze([
    { amount: 30, pinMs: 20000, cardMs: 8000, fx: 0 },
    { amount: 50, pinMs: 30000, cardMs: 9000, fx: 0 },
    { amount: 100, pinMs: 45000, cardMs: 10000, fx: 1 },
    { amount: 500, pinMs: 60000, cardMs: 12000, fx: 2 },
    { amount: 1000, pinMs: 90000, cardMs: 14000, fx: 3 },
    { amount: 2000, pinMs: 120000, cardMs: 16000, fx: 4 },
].map(Object.freeze));
// The tier of a highlight: {index, amount, pinMs, cardMs, fx}; a highlight without a valid amount (an older record)
// wears the first tier's colours and shows no price. null for ordinary comments. Pure; tests.
function danmakuScTier(comment) {
    if (!comment || comment.kind !== 'highlight') return null;
    const index = DANMAKU_SC_TIERS.findIndex(tier => tier.amount === comment.amount);
    return index >= 0 ? { index, ...DANMAKU_SC_TIERS[index] } : { index: 0, ...DANMAKU_SC_TIERS[0], amount: null };
}
const DANMAKU_ENTRIES = Object.freeze({ overlay: 'view/overlay.js', sidebar: 'view/sidebar.js' });

const dmClamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// FNV-1a: well mixed, so h % small primes stays fair for nicknames that differ only in their last character.
function danmakuHash(key) { let h = 0x811c9dc5; for (const ch of String(key)) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0; return h; }
// 飘屏 viewer preferences (stage CONFIG 弹幕; bilibili's 显示区域 / 不透明度 / 字号). Missing or odd values fall back to
// the defaults. area: share of the free reading band (top bar → dialogue box) the scrolling and top comments use.
const DANMAKU_AREAS = Object.freeze({ quarter: 0.25, half: 0.5, 'three-quarter': 0.75, full: 1 });
function danmakuOverlayPrefs(settings) {
    const s = settings || {}, num = (v, lo, hi, d) => Number.isFinite(Number(v)) && v !== null && v !== '' ? dmClamp(Number(v), lo, hi) : d;
    return { area: DANMAKU_AREAS[s.area] || DANMAKU_AREAS['three-quarter'], alpha: num(s.opacity, 10, 100, 90) / 100, scale: num(s.fontScale, 50, 150, 100) / 100 };
}
// A simulated viewer's badges, bilibili live style: a 粉丝牌 (the room's medal + level), 舰长, 房管. The DTO may carry
// them (comment.badges); otherwise they are derived from the nickname so one viewer always wears the same ones. They
// are decoration only (no money, no gifts). Pure; tests.
function danmakuBadges(comment, medal) {
    const given = comment && comment.badges;
    if (given && typeof given === 'object') return {
        medal: given.medal && Number.isSafeInteger(given.medal.level) ? { name: String(given.medal.name || medal || '主播').slice(0, 4), level: dmClamp(given.medal.level, 1, 40) } : null,
        guard: given.guard === true || given.guard === '舰长', admin: given.admin === true };
    const h = danmakuHash(comment && comment.author || '');
    return { medal: h % 10 < 4 ? { name: String(medal || '主播').slice(0, 4), level: 1 + (h >>> 5) % 21 } : null, guard: h % 23 === 0, admin: h % 31 === 1 };
}
// bilibili medal colour tiers by level (1–4, 5–8, 9–12, 13–16, 17+).
const danmakuMedalTier = level => Math.min(4, Math.floor((Math.max(1, level) - 1) / 4));
// 01:02:03 / 12:34
function danmakuClock(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000)), hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60, p = n => String(n).padStart(2, '0');
    return (hh ? hh + ':' : '') + p(mm) + ':' + p(ss);
}
// 3214 → "3,214"; 12345 → "1.2万"
function danmakuCount(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v >= 1e8) return (v / 1e8).toFixed(1).replace(/\.0$/, '') + '亿';
    if (v >= 1e4) return (v / 1e4).toFixed(1).replace(/\.0$/, '') + '万';
    return v.toLocaleString('en-US');
}
// '¥2,000'. Pure; tests.
const danmakuPrice = amount => Number.isSafeInteger(amount) && amount > 0 ? '¥' + amount.toLocaleString('en-US') : '';
// A 醒目留言 node, the one builder for every place it shows (also the review page's tier gallery):
//  variant 'card' — the 飘屏 corner card: header (initial, name, price) over the message, a draining time bar;
//  variant 'row'  — the same card as a row of the chat list (no time bar);
//  variant 'pill' — the chat's pinned strip: initial + price on the body colour, the remaining pin time draining behind.
// elapsed = ms since it appeared: animations start that far in, so a remount or history replay never re-fires an effect.
function danmakuScNode(doc, c, { variant = 'card', elapsed = 0 } = {}) {
    const el = (tag, cls, parent) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };
    const tier = danmakuScTier({ ...c, kind: 'highlight' }), price = danmakuPrice(tier.amount), name = c.author || '观众';
    const node = el(variant === 'pill' ? 'button' : 'div', variant === 'pill' ? 'fork-dm-sc-pill' : 'fork-dm-sc');
    node.dataset.tier = String(tier.index); node.dataset.fx = String(tier.fx); node.dataset.variant = variant; node.dataset.id = c.id;
    node.style.setProperty('--fork-dm-sc-age', -Math.max(0, Math.round(elapsed)) + 'ms');
    const face = () => { const f = el('span', 'fork-dm-sc-face'); f.textContent = [...name][0] || '观'; f.setAttribute('aria-hidden', 'true'); return f; };
    if (variant === 'pill') {
        node.type = 'button';
        const fill = el('i', 'fork-dm-sc-pill-fill', node);
        fill.style.animationDuration = tier.pinMs + 'ms'; fill.style.animationDelay = -Math.max(0, elapsed) + 'ms';
        node.appendChild(face());
        el('span', 'fork-dm-sc-pill-price', node).textContent = price || '醒目留言';
        node.setAttribute('aria-label', '醒目留言 ' + (price ? price + ' ' : '') + name + '：' + c.text);
        node.title = name + (price ? ' · ' + price : '');
        return node;
    }
    const head = el('div', 'fork-dm-sc-head', node);
    head.appendChild(face());
    el('b', 'fork-dm-sc-user', head).textContent = name;
    if (tier.index >= 3) { const gem = el('i', 'fork-dm-sc-gem', head); gem.setAttribute('aria-hidden', 'true'); if (tier.index === 5) gem.dataset.n = '2'; } // bilibili marks ¥500+ with an icon
    el('span', 'fork-dm-sc-price', head).textContent = price || '醒目留言';
    el('div', 'fork-dm-sc-text', node).textContent = c.text;
    if (variant === 'card') {
        const bar = el('i', 'fork-dm-sc-time', node);
        bar.style.animationDuration = (c.cardMs || tier.cardMs) + 'ms';
        bar.style.animationDelay = -Math.max(0, elapsed) + 'ms';
    }
    return node;
}
// A model colour is only ever a #RRGGBB hint. Dark hints keep their colour and get a light halo instead of the dark one.
function danmakuColour(hex) {
    if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return null;
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return { colour: hex.toLowerCase(), dark: 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.12 };
}
// Which perspective draws: 'overlay' | 'sidebar' | null (silent / off). Reduced motion shows the static console.
// stageReduced: the stage CONFIG 「减少动态」 read off the layer's own stage (when the host does not put it in the DTO).
function danmakuPerspective(view, stageReduced = false) {
    if (!view || view.silent || view.view === 'off') return null;
    if (view.view === 'sidebar' || view.settings?.reducedMotion || stageReduced) return 'sidebar';
    return 'overlay';
}
// Every comment the view carries, once, in (offsetMs, id) order: batches are the record window; sidebar.items and
// highlights are projections of it but are merged so a host that sends only those still plays.
function danmakuComments(view) {
    const seen = new Map();
    const add = c => { if (c && typeof c.id === 'string' && typeof c.text === 'string' && !seen.has(c.id)) seen.set(c.id, c); };
    for (const batch of view?.batches || []) for (const c of batch.comments || []) add(c);
    for (const c of view?.sidebar?.items || []) add(c);
    for (const c of view?.highlights || []) add(c);
    // A 醒目留言 stays pinned for its tier's time (the chat strip) and shows its 飘屏 card for the shorter cardMs.
    return [...seen.values()].map(c => {
        const tier = danmakuScTier(c), offsetMs = Number(c.offsetMs) || 0;
        if (tier) return { ...c, offsetMs, amount: tier.amount, tier: tier.index, durationMs: tier.pinMs, cardMs: tier.cardMs };
        return { ...c, offsetMs, durationMs: Number(c.durationMs) > 0 ? Number(c.durationMs) : 6500 };
    }).sort((a, b) => a.offsetMs - b.offsetMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
// Heat (0..100) at active time t (contract §2): the newest started batch's value, falling linearly to 0 at its
// heatExpiresAtMs, rounded like the runtime so live and history read the same numbers.
function danmakuHeatAt(view, t) {
    const started = (view?.batches || []).filter(b => b.offsetMs <= t);
    const last = started[started.length - 1];
    if (!last) return dmClamp(Number(view?.heat) || 0, 0, 100);
    const span = last.heatExpiresAtMs - last.offsetMs;
    return span > 0 ? dmClamp(Math.round(last.heat * Math.max(0, (last.heatExpiresAtMs - t) / span)), 0, 100) : 0;
}
// Online at active time t (contract §2): max(12, round(online - (heat - heatNow) * 2.4)) of the newest started batch; 0 before any.
function danmakuOnlineAt(view, t) {
    const started = (view?.batches || []).filter(b => b.offsetMs <= t), last = started[started.length - 1];
    if (!last) return Math.max(0, Math.round(Number(view?.online) || 0));
    return Math.max(12, Math.round(last.online - (last.heat - danmakuHeatAt(view, t)) * 2.4));
}

// Lanes: full-width horizontal bands that intersect no safe region. Every free band [{y,height}], top-down.
function danmakuLanes({ width, height, safeRegions = [], laneHeight, margin = 4 }) {
    if (!(width > 0 && height > 0 && laneHeight > 0)) return [];
    const regions = safeRegions.filter(r => r.width > 0 && r.height > 0);
    const free = [];
    let y = margin;
    while (y + laneHeight <= height - margin) {
        const hit = regions.filter(r => y < r.y + r.height + margin && y + laneHeight > r.y - margin);
        if (hit.length) { y = Math.max(...hit.map(r => r.y + r.height + margin)); continue; }
        free.push({ y, height: laneHeight });
        y += laneHeight;
    }
    return free;
}
// Scroll and top-fixed comments use the lanes inside the upper `area` share of the free band's height (bilibili 显示区域;
// at least one, at most maxLanes); bottom-fixed comments stack upward from the lowest free band, just above the box.
function danmakuLaneSets(free, { area = 0.75, maxLanes = 16, bottomLanes = 3 } = {}) {
    if (!free.length) return { upper: [], lower: [] };
    const top = free[0].y, limit = top + (free[free.length - 1].y + free[free.length - 1].height - top) * area + 0.5;
    const upper = free.filter(lane => lane.y + lane.height <= limit).slice(0, maxLanes);
    return { upper: upper.length ? upper : free.slice(0, 1), lower: free.slice(-Math.min(bottomLanes, free.length)).reverse() };
}
// Scroll lane for an item of `width` that started at `start`: the previous item's tail must have entered (plus gap)
// and the new head must not reach the left edge before the previous tail has left; lanes holding a top-fixed comment
// are skipped (blocked). -1 = no lane free.
// `prefer` (a reply: the lane under its parent's) is tried first, so a relay steps down the screen like a staircase.
function danmakuScrollLane(lanes, start, width, { viewWidth, duration, gap = 24, blocked = () => false, prefer = -1 }) {
    const v = (viewWidth + width) / duration;
    const order = [...lanes.keys()];
    if (prefer >= 0 && prefer < lanes.length) order.unshift(...order.splice(prefer, 1));
    for (const i of order) {
        if (blocked(i)) continue;
        const last = lanes[i];
        if (!last) return i;
        const lv = (viewWidth + last.width) / last.duration;
        const entered = last.start + (last.width + gap) / lv;
        const leaves = last.start + last.duration;
        if (start >= entered && start + (viewWidth - gap) / v >= leaves) return i;
    }
    return -1;
}
// Fixed lanes: the first lane (top-down for top, bottom-up for bottom; the caller orders them) whose occupant expired.
function danmakuFixedLane(lanes, now) {
    for (let i = 0; i < lanes.length; i++) if (!lanes[i] || lanes[i].until <= now) return i;
    return -1;
}

const DM_DEFAULT_CLOCK = {
    now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
    setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: id => clearTimeout(id),
};

// The renderer contract of createModUiLayerHost: render({root,context,viewport,budget}) → {update, dispose}. update()
// receives either the host's geometry refresh ({context,viewport}) or the mod's DanmakuView (version 1).
// Optional host hooks (output/danmaku/P6-REQUESTS.md F8): `dock(request|null)` — request {side:'right'} returns
// {column, below|null} slot elements beside / under the scene (the host shrinks the scene, keeping its aspect) or null
// when the stage is too narrow; null releases. `context.stage` — read-only display facts for the 直播信息栏
// {title?, turn?, latestTurn?, scene?, bgm?}; anything missing is simply not shown.
function createDanmakuLayer({ root, viewport, budget, context, dock = null, layer = 'overlay', clock = DM_DEFAULT_CLOCK }) {
    const doc = root.ownerDocument;
    const el = (tag, cls, parent) => { const n = doc.createElement(tag); if (cls) n.className = cls; if (parent) parent.appendChild(n); return n; };
    const maxVisible = Math.min(DANMAKU_LIMITS.overlayVisible, budget?.maxVisible || DANMAKU_LIMITS.overlayVisible);
    const maxNodes = Math.max(40, (budget?.maxNodes || 200) - 4);
    const st = { view: null, geometry: viewport || null, base: 0, baseAt: 0, active: false, shown: false, stage: context?.stage || null, liveMs: 0, liveAt: 0 };
    const now = () => st.base + (st.active ? clock.now() - st.baseAt : 0);
    const wrap = el('div', 'fork-dm', root);
    wrap.dataset.layer = layer;
    wrap.hidden = true;
    let timer = null;
    const played = new Set();
    const markPlayed = id => { played.add(id); if (played.size > DANMAKU_LIMITS.played) played.delete(played.values().next().value); };
    const area = () => { const v = st.view; return v && v.viewport?.width > 0 ? { width: v.viewport.width, height: v.viewport.height, safeRegions: v.safeRegions || [] } : st.geometry || { width: 0, height: 0, safeRegions: [] }; };

    // ---- shared head pieces: live tag, online (labelled 模拟观众: the audience is simulated), heat bar
    function liveTag(parent) { return el('span', 'fork-dm-live', parent); }
    function heatBar(parent) { const t = el('span', 'fork-dm-heat', parent); t.setAttribute('role', 'img'); return { track: t, bar: el('i', 'fork-dm-heat-bar', t) }; }
    // The bar drains by a CSS transition to the batch's cool-down end: no per-frame work.
    function paintHeat(h) {
        const v = st.view, t = now(), value = danmakuHeatAt(v, t) / 100;
        const started = (v?.batches || []).filter(b => b.offsetMs <= t), last = started[started.length - 1];
        const left = last && st.active && v.mode === 'live' ? Math.max(0, last.heatExpiresAtMs - t) : 0;
        h.bar.style.transition = 'none';
        h.bar.style.transform = `scaleX(${value})`;
        if (left > 0 && value > 0) { void h.bar.offsetWidth; h.bar.style.transition = `transform ${Math.round(left)}ms linear`; h.bar.style.transform = 'scaleX(0)'; }
        h.track.setAttribute('aria-label', '热度 ' + Math.round(value * 100));
        h.track.title = '热度';
    }
    function setStatus(node) {
        node.textContent = st.view?.mode === 'history' ? '回放' : '直播中';
        wrap.dataset.live = node.dataset.live = st.view?.mode === 'history' ? 'replay' : 'live';
    }

    // ================= overlay (飘屏)
    let ov = null;
    function overlayParts() {
        if (ov) return ov;
        const stage = el('div', 'fork-dm-stage', wrap);
        const corner = el('div', 'fork-dm-corner', wrap);
        const hud = el('div', 'fork-dm-hud', corner);
        const live = liveTag(hud);
        const online = el('span', 'fork-dm-online', hud);
        const cards = el('div', 'fork-dm-cards', corner);
        wrap.setAttribute('aria-hidden', 'true'); // decorative; the console is the readable form
        ov = { stage, corner, hud, live, online, cards, lanes: [], lower: [], scroll: [], top: [], bottom: [], items: new Map(), laneOf: new Map(), pool: [], fonts: {}, canvas: null, key: '' };
        return ov;
    }
    function fontOf(size) {
        if (ov.fonts[size]) return ov.fonts[size];
        const probe = el('span', 'fork-dm-item', ov.stage); probe.dataset.size = size; probe.style.visibility = 'hidden';
        const cs = typeof getComputedStyle === 'function' ? getComputedStyle(probe) : null;
        const f = { font: cs ? `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` : '600 20px sans-serif', px: (cs && parseFloat(cs.fontSize)) || 20 };
        probe.remove(); ov.fonts[size] = f; return f;
    }
    // Measure with a canvas: no forced layout per comment.
    function measure(text, size) {
        const f = fontOf(size);
        if (!ov.canvas) ov.canvas = doc.createElement('canvas').getContext?.('2d') || null;
        if (!ov.canvas) return text.length * f.px;
        ov.canvas.font = f.font; return Math.ceil(ov.canvas.measureText(text).width) + 4;
    }
    function relayout(v) {
        const prefs = danmakuOverlayPrefs(st.view?.settings);
        const key = JSON.stringify([v.width, v.height, v.safeRegions, st.view?.settings?.density, prefs]);
        if (key === ov.key) return;
        ov.key = key; ov.fonts = {};
        wrap.style.setProperty('--fork-dm-scale', String(prefs.scale));
        wrap.style.setProperty('--fork-dm-opacity', String(prefs.alpha));
        const regions = v.safeRegions || [], wide = r => r.width > v.width * 0.5;
        const topEdge = Math.max(0, ...regions.filter(r => wide(r) && r.y < v.height * 0.3).map(r => r.y + r.height));
        wrap.style.setProperty('--fork-dm-top', Math.round(topEdge) + 'px');
        wrap.dataset.narrow = v.width > 0 && v.width < 560 ? 'true' : '';
        // The corner chip (直播中 · 模拟观众) keeps its own row under the top bar; comments start below it. A lane fits a
        // large comment, so no size spills into a safe region or the next lane.
        const chip = { x: 0, y: topEdge, width: 1, height: 22 };
        const low = st.view?.settings?.density === 'low';
        const free = danmakuLanes({ width: v.width, height: v.height, safeRegions: [...regions, chip], laneHeight: Math.ceil(Math.max(fontOf('standard').px * 1.42, fontOf('large').px * 1.3 + 2)) });
        const sets = danmakuLaneSets(free, { area: prefs.area, maxLanes: v.width < 560 ? 9 : 16, bottomLanes: low ? 2 : 3 });
        ov.lanes = sets.upper; ov.lower = sets.lower;
        ov.scroll = ov.lanes.map(() => null); ov.top = ov.lanes.map(() => null); ov.bottom = ov.lower.map(() => null);
    }
    function dropItem(id) {
        const it = ov.items.get(id); if (!it) return;
        ov.items.delete(id); it.anim?.cancel(); it.node.remove();
        if (ov.pool.length < maxVisible) ov.pool.push(it.node);
    }
    // Place one comment that started `elapsed` ms ago. false = no room now (the caller may retry within maxWaitMs).
    function launch(c, t) {
        const v = area(), W = v.width, elapsed = t - c.offsetMs;
        const mode = ['top', 'bottom'].includes(c.mode) ? c.mode : 'scroll';
        const size = ['small', 'large'].includes(c.size) ? c.size : 'standard';
        const set = mode === 'bottom' ? ov.lower : ov.lanes;
        const cap = st.view?.settings?.density === 'low' ? Math.ceil(maxVisible / 2) : maxVisible;
        if (!set.length || ov.items.size + ov.cards.childElementCount >= cap) return false; // 醒目留言 cards share the budget
        const w = measure(c.text, size);
        const fixedMs = Math.min(c.durationMs, DANMAKU_LIMITS.fixedMs);
        const ms = mode === 'scroll' ? c.durationMs : fixedMs;
        if (elapsed >= ms) return true; // already over: count it as played
        let lane;
        if (mode === 'scroll') {
            // A relay reads down the screen: a reply tries the lane under its parent's first (no @ marker — viewers see plain danmaku).
            const parent = c.replyTo ? ov.laneOf.get(c.replyTo) : undefined;
            lane = danmakuScrollLane(ov.scroll, t - elapsed, w, { viewWidth: W, duration: ms, blocked: i => !!ov.top[i] && ov.top[i].until > t, prefer: parent === undefined ? -1 : (parent + 1) % ov.lanes.length });
            if (lane < 0) return false;
            ov.scroll[lane] = { start: t - elapsed, width: w, duration: ms };
            ov.laneOf.set(c.id, lane);
            if (ov.laneOf.size > DANMAKU_LIMITS.played) ov.laneOf.delete(ov.laneOf.keys().next().value);
        } else {
            const occ = mode === 'top' ? ov.top : ov.bottom;
            lane = danmakuFixedLane(occ, t);
            if (lane < 0) return false;
            occ[lane] = { until: t - elapsed + ms };
        }
        const band = set[lane], px = fontOf(size).px;
        const y = Math.round(band.y + (band.height - px * 1.3) / 2);
        const node = ov.pool.pop() || el('span', 'fork-dm-item');
        node.textContent = c.text; node.dataset.size = size; node.dataset.mode = mode;
        const tone = danmakuColour(c.color);
        if (tone) { node.style.setProperty('--gal-dm-c', tone.colour); node.dataset.dark = tone.dark ? 'true' : ''; }
        else { node.style.removeProperty('--gal-dm-c'); node.dataset.dark = ''; }
        ov.stage.appendChild(node);
        const x = Math.max(0, Math.round((W - w) / 2));
        const frames = mode === 'scroll'
            ? [{ transform: `translate3d(${W}px,${y}px,0)` }, { transform: `translate3d(${-w}px,${y}px,0)` }]
            : [{ transform: `translate3d(${x}px,${y}px,0)` }, { transform: `translate3d(${x}px,${y}px,0)` }]; // fixed: appears and leaves, like bilibili
        const it = { node, offsetMs: c.offsetMs, ms, anim: null };
        ov.items.set(c.id, it);
        if (typeof node.animate === 'function') {
            it.anim = node.animate(frames, { duration: ms, easing: 'linear', fill: 'both' });
            it.anim.currentTime = Math.max(0, elapsed);
            it.anim.onfinish = () => dropItem(c.id);
            if (!st.active) it.anim.pause();
        } else node.style.transform = frames[0].transform;
        return true;
    }
    // Highlight nodes: keyed by id, each removed at its own end (part of the next-due timer); new ones in arrival order.
    function syncCards(container, list, t, variant = 'card') {
        const want = new Map(list.map(c => [c.id, c]));
        for (const node of [...container.children]) if (!want.has(node.dataset.id)) node.remove();
        const have = new Set([...container.children].map(n => n.dataset.id));
        for (const c of list) if (!have.has(c.id)) container.appendChild(danmakuScNode(doc, c, { variant, elapsed: t - c.offsetMs }));
    }
    function drawOverlay(comments, t) {
        overlayParts();
        relayout(area());
        setStatus(ov.live);
        ov.online.textContent = danmakuCount(danmakuOnlineAt(st.view, t)) + ' 模拟观众';
        let next = Infinity;
        for (const c of comments) {
            if (c.kind === 'highlight') continue;
            if (played.has(c.id)) { const it = ov.items.get(c.id); if (it?.anim) { it.anim.currentTime = Math.max(0, t - it.offsetMs); } continue; }
            if (c.offsetMs > t) { next = Math.min(next, c.offsetMs); continue; }
            if (launch(c, t) || t - c.offsetMs > DANMAKU_LIMITS.maxWaitMs || st.view.settings?.density === 'low') markPlayed(c.id);
            else next = Math.min(next, t + 250);
        }
        // 飘屏 (the viewer's screen): a 醒目留言 is a card in the corner for its tier's cardMs — no pinned strip over the
        // scene; at most two at once, the newest below.
        const live = comments.filter(c => c.kind === 'highlight' && c.offsetMs <= t && t < c.offsetMs + c.cardMs).slice(-2);
        syncCards(ov.cards, live, t);
        for (const c of comments) if (c.kind === 'highlight') next = Math.min(next, c.offsetMs > t ? c.offsetMs : c.offsetMs + c.cardMs > t ? c.offsetMs + c.cardMs : Infinity);
        return next;
    }
    function clearOverlay() {
        if (!ov) return;
        // Comments still on screen are not 'played' yet: shown again (a view switch, silence lifted) they continue from where
        // they are now; finished ones stay played.
        for (const id of [...ov.items.keys()]) { played.delete(id); dropItem(id); }
        ov.cards.textContent = ''; ov.laneOf.clear();
        ov.scroll = ov.lanes.map(() => null); ov.top = ov.lanes.map(() => null); ov.bottom = ov.lower.map(() => null);
    }

    // ================= sidebar (直播风格: the streamer's chat dock + 直播信息栏)
    let sb = null;
    function sidebarParts() {
        if (sb) return sb;
        const dock = el('section', 'fork-dm-console', wrap);
        const head = el('header', 'fork-dm-head', dock);
        const live = liveTag(head);
        const online = el('span', 'fork-dm-online', head);
        const warn = el('span', 'fork-dm-warn', head); warn.hidden = true; warn.setAttribute('role', 'img'); warn.textContent = '⚠';
        const heat = heatBar(head);
        // bilibili's pinned strip: one pill per 醒目留言 still pinned (its tier's time draining behind); a pill opens
        // the full card under the strip, a second press (or Esc) closes it.
        const pinned = el('div', 'fork-dm-pinned', dock);
        pinned.setAttribute('data-mod-input', ''); pinned.setAttribute('role', 'group'); pinned.setAttribute('aria-label', '醒目留言');
        const detail = el('div', 'fork-dm-pin-detail', dock); detail.hidden = true; detail.setAttribute('data-mod-input', '');
        const list = el('ol', 'fork-dm-list', dock);
        list.setAttribute('data-mod-input', '');
        list.setAttribute('role', 'log'); list.setAttribute('aria-live', 'off');
        const latest = el('button', 'fork-dm-latest', dock);
        latest.type = 'button'; latest.setAttribute('data-mod-input', ''); latest.setAttribute('aria-label', '回到最新'); latest.title = '回到最新'; latest.textContent = '↓'; latest.hidden = true;
        sb = { dock, head, live, online, warn, heat, pinned, detail, list, latest, rows: new Map(), cut: new Set(), follow: true, band: null, slots: null, open: null };
        const openPin = id => {
            sb.open = sb.open === id ? null : id;
            for (const pill of pinned.children) pill.setAttribute('aria-expanded', String(pill.dataset.id === sb.open));
            draw();
        };
        pinned.addEventListener('click', event => { const pill = event.target.closest('.fork-dm-sc-pill'); if (pill) openPin(pill.dataset.id); });
        dock.addEventListener('keydown', event => { if (event.key === 'Escape' && sb.open) { const id = sb.open; event.stopPropagation(); openPin(id); pinned.querySelector('[data-id="' + CSS.escape(id) + '"]')?.focus(); } });
        // Scrolling or clicking the chat must not also turn the page (the stage owns wheel/click/keys on its root).
        for (const type of ['wheel', 'click', 'pointerdown', 'touchstart', 'keydown']) dock.addEventListener(type, event => { if (event.target.closest('[data-mod-input]')) event.stopPropagation(); }, { passive: true });
        list.addEventListener('scroll', () => { sb.follow = list.scrollTop + list.clientHeight >= list.scrollHeight - 8; latest.hidden = sb.follow; }, { passive: true });
        latest.addEventListener('click', () => { sb.follow = true; list.scrollTop = list.scrollHeight; latest.hidden = true; });
        return sb;
    }
    // The 直播信息栏 under the docked scene: what a streamer keeps on screen, from data we really have — the live state and
    // time on stage, the card's title and current chapter, the simulated audience and heat, the latest 醒目留言, the BGM.
    function bandParts() {
        if (sb.band) return sb.band;
        const node = el('section', 'fork-dm-band');
        node.setAttribute('aria-label', '直播信息');
        const info = el('div', 'fork-dm-band-card is-info', node);
        const status = el('div', 'fork-dm-band-status', info);
        const live = liveTag(status), clockNode = el('span', 'fork-dm-band-clock', status);
        const title = el('b', 'fork-dm-band-title', info);
        const chapter = el('span', 'fork-dm-band-meta', info);
        const stats = el('div', 'fork-dm-band-card is-stats', node);
        const count = el('b', 'fork-dm-band-count', stats);
        el('span', 'fork-dm-band-meta', stats).textContent = '模拟观众';
        const heatRow = el('div', 'fork-dm-band-heat', stats);
        el('span', 'fork-dm-band-meta', heatRow).textContent = '热度';
        const heat = heatBar(heatRow);
        // The 醒目留言 themselves are pinned on the chat; the band keeps the streamer's tally of them (simulated, like the audience).
        const side = el('div', 'fork-dm-band-card is-side', node);
        const scLabel = el('span', 'fork-dm-band-meta', side); scLabel.textContent = '醒目留言';
        const sc = el('b', 'fork-dm-band-sc', side);
        const scCount = el('span', 'fork-dm-band-meta', side);
        const bgm = el('div', 'fork-dm-band-bgm', side);
        sb.band = { node, live, clockNode, title, chapter, count, heat, sc, scCount, bgm };
        return sb.band;
    }
    // A row: badges · name · text. A 醒目留言 is its tier card in the list. A reply (relay of any depth) stays flat and
    // says whom it answers — 「回复 @名字」 — instead of indenting.
    function rowFor(c, medal, byId, t) {
        const li = el('li', 'fork-dm-row');
        li.dataset.id = c.id; li.dataset.kind = c.kind === 'highlight' ? 'highlight' : 'comment';
        if (c.kind === 'highlight') { li.appendChild(danmakuScNode(doc, c, { variant: 'row', elapsed: t - c.offsetMs })); return li; }
        const b = danmakuBadges(c, medal);
        // One node per badge (the layer's maxNodes is shared by 32 rows): the medal's level is drawn from data-level.
        if (b.medal) { const m = el('span', 'fork-dm-medal', li); m.dataset.tier = String(danmakuMedalTier(b.medal.level)); m.dataset.level = String(b.medal.level); m.textContent = b.medal.name; }
        if (b.guard) { const g = el('span', 'fork-dm-guard', li); g.title = '舰长'; g.setAttribute('aria-label', '舰长'); }
        if (b.admin) el('span', 'fork-dm-admin', li).textContent = '房管';
        el('b', 'fork-dm-user', li).textContent = (c.author || '观众') + '：';
        const parent = c.replyTo ? byId.get(c.replyTo) : null;
        if (parent) { el('span', 'fork-dm-reply', li).textContent = '回复 @' + (parent.author || '观众') + ' '; li.dataset.reply = 'true'; }
        el('span', 'fork-dm-text', li).textContent = c.text;
        return li;
    }
    const liveNow = () => st.liveMs + (st.active ? clock.now() - st.liveAt : 0);
    // Dock in the host's column when it offers one (wide stages), else float over the stage.
    function placeConsole() {
        const slots = typeof dock === 'function' ? dock({ side: 'right' }) : null;
        const column = slots && slots.column, below = slots && slots.below;
        if (column) { if (sb.dock.parentNode !== column) column.appendChild(sb.dock); sb.dock.dataset.dock = 'right'; }
        else { if (sb.dock.parentNode !== wrap) wrap.appendChild(sb.dock); delete sb.dock.dataset.dock; }
        if (column && below) { const band = bandParts(); if (band.node.parentNode !== below) below.appendChild(band.node); }
        else if (sb.band) sb.band.node.remove();
        sb.slots = column ? slots : null;
        return { docked: !!column, band: !!(column && below) };
    }
    function releaseDock() {
        if (!sb) return;
        if (sb.band) sb.band.node.remove();
        if (sb.dock.parentNode !== wrap) wrap.appendChild(sb.dock);
        delete sb.dock.dataset.dock;
        if (sb.slots && typeof dock === 'function') dock(null);
        sb.slots = null;
    }
    function paintBand(comments, t) {
        const band = sb.band, info = st.stage || {}, history = st.view?.mode === 'history';
        setStatus(band.live);
        band.clockNode.textContent = history ? '' : danmakuClock(liveNow());
        band.title.textContent = info.title || st.view.sidebar?.title || '模拟直播间';
        band.chapter.textContent = [Number.isSafeInteger(info.turn) ? '第 ' + info.turn + (Number.isSafeInteger(info.latestTurn) ? ' / ' + info.latestTurn : '') + ' 轮' : '', info.scene || ''].filter(Boolean).join(' · ');
        band.count.textContent = danmakuCount(danmakuOnlineAt(st.view, t));
        paintHeat(band.heat);
        const shown = comments.filter(c => c.kind === 'highlight' && c.offsetMs <= t), sum = shown.reduce((s, c) => s + (c.amount || 0), 0);
        band.sc.textContent = shown.length ? danmakuPrice(sum) || shown.length + ' 条' : '还没有';
        band.sc.dataset.empty = shown.length ? '' : 'true';
        band.scCount.textContent = shown.length && sum ? shown.length + ' 条' : '';
        band.bgm.textContent = info.bgm ? '♪ ' + info.bgm : '';
        band.bgm.hidden = !info.bgm;
    }
    function drawSidebar(comments, t) {
        sidebarParts();
        const placed = placeConsole();
        const v = area(), regions = v.safeRegions || [], wide = r => r.width > v.width * 0.5;
        const topEdge = Math.max(0, ...regions.filter(r => wide(r) && r.y < v.height * 0.3).map(r => r.y + r.height));
        const bottomEdge = Math.min(v.height || 0, ...regions.filter(r => wide(r) && r.y > v.height * 0.4).map(r => r.y));
        wrap.style.setProperty('--fork-dm-top', Math.round(topEdge) + 'px');
        wrap.style.setProperty('--fork-dm-bottom', Math.round(Math.max(0, (v.height || 0) - bottomEdge)) + 'px');
        wrap.dataset.narrow = v.width > 0 && v.width < 560 ? 'true' : '';
        setStatus(sb.live);
        sb.dock.setAttribute('aria-label', st.view.sidebar?.title || '模拟观众');
        sb.online.textContent = danmakuCount(danmakuOnlineAt(st.view, t)) + ' 模拟观众';
        const err = st.view.status === 'error' ? st.view.error?.message || '弹幕暂时不可用' : st.view.settings?.model && st.view.settings.model.available === false ? '弹幕模型不可用' : '';
        sb.warn.hidden = !err; sb.warn.title = err; sb.warn.setAttribute('aria-label', err);
        paintHeat(sb.heat);
        // Every pinned pill counts against the same 32 (contract v3/v4): the list gives up its places.
        const pin = comments.filter(c => c.kind === 'highlight' && c.offsetMs <= t && t < c.offsetMs + c.durationMs).slice(-DANMAKU_LIMITS.pins);
        const room = Math.min(maxVisible, st.view.sidebar?.limit || DANMAKU_LIMITS.sidebarRows) - pin.length;
        const due = comments.filter(c => c.offsetMs <= t && !sb.cut.has(c.id)).slice(-Math.max(0, room));
        const want = new Set(due.map(c => c.id)), medal = st.view.sidebar?.medal, byId = new Map(comments.map(c => [c.id, c]));
        for (const [id, li] of sb.rows) if (!want.has(id)) { li.remove(); sb.rows.delete(id); }
        let added = false;
        for (const c of due) if (!sb.rows.has(c.id)) { const li = rowFor(c, medal, byId, t); sb.list.appendChild(li); sb.rows.set(c.id, li); added = true; }
        if (added && sb.follow) sb.list.scrollTop = sb.list.scrollHeight;
        sb.latest.hidden = sb.follow;
        syncCards(sb.pinned, pin, t, 'pill');
        for (const pill of sb.pinned.children) pill.setAttribute('aria-expanded', String(pill.dataset.id === sb.open));
        const open = pin.find(c => c.id === sb.open);
        if (!open) sb.open = null;
        if ((sb.detail.dataset.id || '') !== (open?.id || '')) {
            sb.detail.textContent = ''; sb.detail.dataset.id = open?.id || '';
            if (open) sb.detail.appendChild(danmakuScNode(doc, open, { variant: 'row', elapsed: 1e7 }));
        }
        sb.detail.hidden = !open;
        // The host drops a layer that exceeds budget.maxNodes (counted over the layer and its dock slots): the oldest rows
        // give way first, so a list of 32 醒目留言 / badge-heavy rows never takes the whole console down.
        const nodes = () => wrap.querySelectorAll('*').length + 1 + (sb.dock.parentNode !== wrap ? sb.dock.querySelectorAll('*').length + 1 : 0) + (sb.band?.node.parentNode ? sb.band.node.querySelectorAll('*').length + 1 : 0);
        for (let n = nodes(); n > maxNodes && sb.list.firstChild;) {
            const li = sb.list.firstChild; n -= li.querySelectorAll('*').length + 1; sb.rows.delete(li.dataset.id); li.remove();
            sb.cut.add(li.dataset.id); if (sb.cut.size > DANMAKU_LIMITS.played) sb.cut.delete(sb.cut.values().next().value);
        }
        sb.dock.dataset.band = placed.band ? 'true' : '';
        sb.dock.dataset.paused = st.active ? '' : 'true';
        sb.dock.dataset.motion = wrap.dataset.motion;
        if (sb.band) { sb.band.node.dataset.paused = st.active ? '' : 'true'; sb.band.node.dataset.motion = wrap.dataset.motion; }
        let next = Infinity;
        if (placed.band) { paintBand(comments, t); if (st.active && st.view.mode !== 'history') next = t + 1000 - (liveNow() % 1000); }
        for (const c of comments) {
            if (c.offsetMs > t) next = Math.min(next, c.offsetMs);
            else if (c.kind === 'highlight' && c.offsetMs + c.durationMs > t) next = Math.min(next, c.offsetMs + c.durationMs);
        }
        return next;
    }
    function clearSidebar() { if (!sb) return; sb.list.textContent = ''; sb.rows.clear(); sb.cut.clear(); sb.pinned.textContent = ''; sb.detail.textContent = ''; sb.detail.dataset.id = ''; sb.detail.hidden = true; sb.open = null; sb.follow = true; }

    // ================= one draw, one timer
    function draw() {
        clock.clearTimeout(timer); timer = null;
        const v = st.view, reduced = !!v?.settings?.reducedMotion || !!root.closest?.('[data-reduced-motion]');
        const mine = danmakuPerspective(v, reduced) === layer;
        wrap.hidden = !mine;
        wrap.dataset.paused = st.active ? '' : 'true';
        wrap.dataset.motion = reduced ? 'reduced' : '';
        if (!mine) { if (layer === 'overlay') clearOverlay(); else { clearSidebar(); releaseDock(); } return; }
        const t = now(), comments = danmakuComments(v);
        const next = layer === 'overlay' ? drawOverlay(comments, t) : drawSidebar(comments, t);
        if (st.active && Number.isFinite(next)) timer = clock.setTimeout(draw, Math.max(16, next - t));
    }
    function setActive(active) {
        if (active === st.active) return;
        if (ov) for (const it of ov.items.values()) active ? it.anim?.play() : it.anim?.pause();
        const at = clock.now();
        if (st.active) st.liveMs += at - st.liveAt;
        st.liveAt = at; st.active = active;
    }
    return Object.freeze({
        update(arg) {
            // The host re-applies the view it holds on every sync (geometry, stage facts, resize): the same snapshot must not
            // rewind the clock to its activeTimeMs.
            if (arg && arg === st.view) { /* unchanged snapshot */ }
            else if (arg && arg.version === 1 && arg.modId === 'dsh.danmaku') {
                const anchorChanged = JSON.stringify(arg.anchor) !== JSON.stringify(st.view?.anchor) || arg.mode !== st.view?.mode;
                st.base = Number(arg.activeTimeMs) || 0; st.baseAt = clock.now();
                setActive(!!arg.active && !arg.silent);
                st.view = arg;
                // A new anchor or a switch to history: the previous page's comments leave with it; nothing is replayed
                // twice within one anchor (played ids), and history plays the records of the anchor it reads.
                if (anchorChanged) { clearOverlay(); clearSidebar(); }
            } else if (arg && arg.viewport) { st.geometry = arg.viewport; if (arg.context && arg.context.stage) st.stage = arg.context.stage; }
            draw();
        },
        stats: () => ({ layer, hidden: wrap.hidden, docked: !!(sb && sb.slots), visible: ov ? ov.items.size : 0, rows: sb ? sb.rows.size : 0, lanes: ov ? ov.lanes.length : 0, nodes: wrap.querySelectorAll('*').length + 1, timer: timer !== null }),
        dispose() { clock.clearTimeout(timer); timer = null; clearOverlay(); clearSidebar(); releaseDock(); wrap.remove(); },
    });
}
// Static renderer registry for the host layer (keyed modId/entry, as createModUiLayerHost looks them up).
const FORK_DANMAKU_RENDERERS = Object.freeze({
    ['dsh.danmaku/' + DANMAKU_ENTRIES.overlay]: args => createDanmakuLayer({ ...args, layer: 'overlay' }),
    ['dsh.danmaku/' + DANMAKU_ENTRIES.sidebar]: args => createDanmakuLayer({ ...args, layer: 'sidebar' }),
});

// First-party static registration in the host's application-owned stage renderer table (fork-mod-stage-layers.js,
// included before this file); idempotent.
if (typeof FORK_MOD_STAGE_RENDERERS === 'object' && FORK_MOD_STAGE_RENDERERS) Object.assign(FORK_MOD_STAGE_RENDERERS, FORK_DANMAKU_RENDERERS);

if (typeof module !== 'undefined' && typeof window === 'undefined') module.exports = { DANMAKU_LIMITS, DANMAKU_ENTRIES, DANMAKU_SC_TIERS, danmakuScTier, danmakuPrice, danmakuScNode, FORK_DANMAKU_RENDERERS, danmakuHash, danmakuOverlayPrefs, danmakuBadges, danmakuMedalTier, danmakuClock, DANMAKU_AREAS, danmakuCount, danmakuColour, danmakuPerspective, danmakuComments, danmakuHeatAt, danmakuOnlineAt, danmakuLanes, danmakuLaneSets, danmakuScrollLane, danmakuFixedLane, createDanmakuLayer };
