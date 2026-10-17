// private fork (P6 弹幕, dsh.danmaku; output/danmaku/P6-CONTRACT.md §2–3): the panel side. Included inside the asset-pack
// UI factory next to fork-mod-config-pages.js, so it uses the panel's one StageSection / Help / ModField / HintLine.
//  - ForkDanmakuModPage: 舞台设置 › 基础设置 › 弹幕 › — set-once engine settings only (ui-design R21): the model actually
//    used and the call cadence (the model itself is chosen in 酒馆设置 › 模组模型; this page only links there) and the
//    audience groups. The view is switched on the stage corner; 飘屏 appearance and density live in the stage CONFIG.
//  - ForkAudienceFields / ForkAudienceRuleSections: the 观众群 (audience) entry's content for the entry editor (人设 /
//    语气与尺度 / 口癖 / 示例, then one row per 预设弹幕 / 接话 rule).

const FORK_DANMAKU_CADENCE = Object.freeze({ minIntervalMs: 3000, maxPerMinute: 20, maxInFlight: 1 });
const FORK_AUDIENCE_LIMITS = Object.freeze({ persona: 1200, tone: 600, catchphrases: 12, catchphrase: 120, examples: 12, example: 240, nicknames: 32, nickname: 24 });
const forkDanmakuChars = s => [...String(s ?? '')].length;
// '最多 20 次/分 · 间隔 ≥ 3 秒'. Pure; tests.
function forkDanmakuCadenceText(c = FORK_DANMAKU_CADENCE) {
    return '最多 ' + c.maxPerMinute + ' 次/分 · 间隔 ≥ ' + Math.round(c.minIntervalMs / 100) / 10 + ' 秒';
}
// The model the slot really uses: its own global choice, else the foreground default it follows (frozen per request by
// the host). { label, follow, available }. Pure; tests.
function forkDanmakuModelInfo({ selection, foreground, catalog = [] }) {
    const pick = selection || foreground || null;
    const follow = !selection;
    if (!pick) return { label: 'DSH 默认模型', follow, available: true };
    const group = catalog.find(g => g.provider === pick.provider), model = group?.models?.find(m => m.id === pick.model);
    return { label: model ? model.name || model.id : pick.model || '未知模型', follow, available: !!model };
}
// The entry editor's content limits (the backend's validateAudienceContent is the real boundary). '' = fine. Pure; tests.
function forkAudienceProblem(key, value) {
    const L = FORK_AUDIENCE_LIMITS;
    if (key === 'persona') return !String(value || '').trim() ? '请填写人设' : forkDanmakuChars(value) > L.persona ? '人设最多 ' + L.persona + ' 字' : '';
    if (key === 'tone') return !String(value || '').trim() ? '请填写语气与尺度' : forkDanmakuChars(value) > L.tone ? '语气与尺度最多 ' + L.tone + ' 字' : '';
    if (key === 'catchphrases') return value.length > L.catchphrases ? '口癖最多 ' + L.catchphrases + ' 条' : value.some(w => forkDanmakuChars(w) > L.catchphrase) ? '每条口癖最多 ' + L.catchphrase + ' 字' : '';
    if (key === 'nicknamePool') return value.length > L.nicknames ? '昵称最多 ' + L.nicknames + ' 个' : value.some(w => forkDanmakuChars(w) > L.nickname) ? '每个昵称最多 ' + L.nickname + ' 字' : '';
    if (key === 'examples') return value.length > L.examples ? '示例最多 ' + L.examples + ' 条' : value.some(w => forkDanmakuChars(w) > L.example) ? '每条示例最多 ' + L.example + ' 字' : '';
    return '';
}
const forkAudienceLines = text => String(text || '').split('\n').map(s => s.trim()).filter(Boolean);

// props: { content: AudienceContent, onCommit(nextContent) → Promise, Help }. Rows for the editor's ForkInlineGrid.
function ForkAudienceFields({ content, onCommit, Help: HelpTip }) {
    const h = React.createElement, c = content || {}, help = (label, text) => HelpTip ? h(HelpTip, { text, label: label + ' 说明' }) : null;
    // nicknamePool (contract v4.2: 1..32 whole handles, ≤ 24 characters, used as-is) is optional: an emptied list is left out, not stored as [].
    const commit = patch => { const next = { ...c, persona: c.persona || '', tone: c.tone || '', catchphrases: c.catchphrases || [], examples: c.examples || [], ...patch }; if (!next.nicknamePool?.length) delete next.nicknamePool; return onCommit(next); };
    return [
        h(ForkInlineField, { key: 'persona', kind: 'text', multiline: true, label: '人设', className: 'ap-note-field', help: help('人设', '这群观众是谁、爱看什么、怎么说话。'), placeholder: '未填写', value: c.persona || '',
            validate: v => forkAudienceProblem('persona', v), onCommit: v => commit({ persona: v }) }),
        h(ForkInlineField, { key: 'tone', kind: 'text', multiline: true, label: '语气与尺度', className: 'ap-note-field', help: help('语气与尺度', '可以吐槽到什么程度、哪些话不说。'), placeholder: '未填写', value: c.tone || '',
            validate: v => forkAudienceProblem('tone', v), onCommit: v => commit({ tone: v }) }),
        h(ForkInlineField, { key: 'catchphrases', kind: 'chips', label: '口癖', addLabel: '添加口癖', value: c.catchphrases || [],
            split: text => [...new Set(String(text || '').split(/[\n，、]/).map(w => w.trim()).filter(Boolean))],
            validate: list => forkAudienceProblem('catchphrases', list), onCommit: list => commit({ catchphrases: list }) }),
        h(ForkInlineField, { key: 'examples', kind: 'text', multiline: true, lines: true, label: '示例', className: 'ap-note-field', help: help('示例', '每行一条示范弹幕。Shift+Enter 换行。'), placeholder: '未填写', value: (c.examples || []).join('\n'),
            validate: v => forkAudienceProblem('examples', forkAudienceLines(v)), onCommit: v => commit({ examples: forkAudienceLines(v) }) }),
        h(ForkInlineField, { key: 'nicknamePool', kind: 'chips', label: '昵称', addLabel: '添加昵称', help: help('昵称', '这群观众的模拟昵称（编的，别用真实账号），约五分之一的弹幕原样使用。不填就只用通用昵称。'), value: c.nicknamePool || [],
            split: text => [...new Set(String(text || '').split(/[\n，、]/).map(w => w.trim()).filter(Boolean))],
            validate: list => forkAudienceProblem('nicknamePool', list), onCommit: list => commit({ nicknamePool: list }) }),
    ];
}

// 预设弹幕 (triggers: keywords in newly shown text → one of the lines, by probability, with a cool-down) and 接话 (chains: a
// comment containing `match` → one of the replies, by probability). P6-CONTRACT §3/§5; the runtime does the matching and
// the dice, the editor only edits the rules. Each rule has a stable id inside the entry (never its text).
// One rule = one row (owner 2026-10): 「关键词 → 台词」 as chips, the probability as a small %, (预设) the cool-down; the
// grammar is explained once in the section's (?).
const FORK_AUDIENCE_RULE_KINDS = Object.freeze({
    triggers: { title: '预设弹幕', help: '正文新显示的文字里出现左边任一关键词时，按概率从右边随机发一条，不调用模型；发过后冷却期内不再触发。', add: '添加预设弹幕', empty: '还没有预设弹幕', prefix: 't',
        when: '关键词', say: { key: 'lines', label: '台词', add: '添加台词' }, probability: 1 },
    chains: { title: '接话', help: '飘过的弹幕包含左边这段文字时，按概率有观众从右边随机接一句。', add: '添加接话', empty: '还没有接话', prefix: 'c',
        when: '弹幕含', say: { key: 'replies', label: '接话', add: '添加接话台词' }, probability: 0.5 },
});
const FORK_AUDIENCE_RULE_LIMITS = Object.freeze({ rules: 12, words: 12, wordMin: 2, word: 120, lines: 12, line: 160, matchMin: 2, match: 160, cooldown: 3600 });
// '' = fine. field: keywords | lines | replies | match. Pure; tests.
function forkAudienceRuleProblem(field, value) {
    const L = FORK_AUDIENCE_RULE_LIMITS;
    if (field === 'match') { const n = forkDanmakuChars(String(value || '').trim()); return n < L.matchMin ? '至少 ' + L.matchMin + ' 个字' : n > L.match ? '最多 ' + L.match + ' 字' : ''; }
    if (field === 'keywords') return value.length > L.words ? '最多 ' + L.words + ' 个关键词' : value.some(w => forkDanmakuChars(w) < L.wordMin) ? '关键词至少 ' + L.wordMin + ' 个字' : value.some(w => forkDanmakuChars(w) > L.word) ? '每个关键词最多 ' + L.word + ' 字' : '';
    return value.length > L.lines ? '最多 ' + L.lines + ' 条' : value.some(w => forkDanmakuChars(w) > L.line) ? '每条最多 ' + L.line + ' 字' : '';
}
// A rule is stored once it has its trigger and something to say (the contract requires both). Pure; tests.
function forkAudienceRuleReady(kind, rule) {
    if (kind === 'chains') return !forkAudienceRuleProblem('match', rule.match) && (rule.replies || []).length > 0;
    return (rule.keywords || []).length > 0 && (rule.lines || []).length > 0;
}
// A new stable id: prefix + base36 time + a counter, unique in the list. Pure given `now`; tests.
function forkAudienceRuleId(kind, rules, now = Date.now()) {
    const taken = new Set(rules.map(r => r.id)), base = FORK_AUDIENCE_RULE_KINDS[kind].prefix + '-' + now.toString(36);
    let id = base, n = 1;
    while (taken.has(id)) id = base + '-' + n++;
    return id;
}
function forkAudienceRuleBlank(kind, rules) {
    const id = forkAudienceRuleId(kind, rules);
    return kind === 'chains' ? { id, match: '', replies: [], probability: FORK_AUDIENCE_RULE_KINDS.chains.probability } : { id, keywords: [], lines: [] };
}
// Probability shown as a whole percent; stored as 0..1. Pure; tests.
const forkAudiencePercent = (rule, kind) => Math.round((rule.probability ?? FORK_AUDIENCE_RULE_KINDS[kind].probability) * 100);
// Preset v4 candidates: a line / reply is a string or {text, kind, amount} (a 醒目留言 candidate). The chips edit the
// text; a candidate whose text is kept keeps its kind and amount (no editor for those yet). Pure; tests.
const forkAudienceLineText = line => typeof line === 'string' ? line : String(line?.text ?? '');
function forkAudienceMergeLines(previous, texts) {
    const kept = new Map((previous || []).filter(line => line && typeof line === 'object').map(line => [forkAudienceLineText(line), line]));
    return texts.map(text => kept.get(text) || text);
}
// Lines are whole sentences (they may contain commas): a chip per line, split only on line breaks.
const forkAudienceSplitLines = text => [...new Set(String(text || '').split(/\n/).map(w => w.trim()).filter(Boolean))];

// props: { kind: 'triggers' | 'chains', rules, onCommit(nextRules) → Promise }. A level-2 section of the 观众群 editor.
// ＋ adds an unsaved row that is stored once complete. No button on the row (R13, owner 2026-10: deleting a rule is rare):
// the row's own menu (cellMenuTrigger — right click / Shift+F10 / the menu key with a mouse or keyboard, a tap on the
// row's free space on touch) holds 「删除这条预设弹幕 / 接话」 (no …: no dialog follows); it deletes at once and leaves one 「撤销」 line.
function ForkAudienceRules({ kind, rules = [], onCommit }) {
    const h = React.createElement, k = FORK_AUDIENCE_RULE_KINDS[kind];
    const [draft, setDraft] = React.useState(null), [busy, setBusy] = React.useState(false), [undo, setUndo] = React.useState(null);
    const save = async next => { setBusy(true); try { await onCommit(next); return true; } catch (_) { return false; } finally { setBusy(false); } };
    const change = (id, patch) => save(rules.map(rule => rule.id === id ? { ...rule, ...patch } : rule));
    const changeDraft = patch => { const next = { ...draft, ...patch }; if (forkAudienceRuleReady(kind, next)) { setDraft(null); return save([...rules, next]); } setDraft(next); return Promise.resolve(true); };
    const remove = rule => { const at = rules.indexOf(rule); save(rules.filter(r => r !== rule)).then(ok => { if (ok) setUndo({ rule, at }); }); };
    const restore = () => { const u = undo; setUndo(null); if (u && rules.length < FORK_AUDIENCE_RULE_LIMITS.rules) save([...rules.slice(0, u.at), u.rule, ...rules.slice(u.at)]); };
    // Clicks, right clicks and keys that belong to a field (editing a chip or number, a text box's own context menu) stay
    // with it; the rest of the row is the menu trigger.
    const free = event => !event.target.closest?.('.fork-inline-field, button, input, textarea, [contenteditable]');
    const typing = event => !!event.target.closest?.('input, textarea, [contenteditable]');
    const row = (rule, set, isDraft) => h(Popover, { key: rule.id, label: k.title + ' 操作', className: 'ap-dm-rule-anchor', float: true, fit: true,
        content: close => [h(MenuItem, { key: 'delete', danger: true, onClick: () => { close(); if (isDraft) setDraft(null); else remove(rule); } }, isDraft ? '放弃这条' : '删除这条' + k.title)],
        trigger: ({ open, toggle }) => { const menu = cellMenuTrigger({ open, toggle, onPrimary: () => {} }); return rowBody(rule, set, isDraft, {
            'aria-haspopup': menu['aria-haspopup'], 'aria-expanded': menu['aria-expanded'], 'aria-keyshortcuts': menu['aria-keyshortcuts'], 'data-menu-open': open || undefined,
            onClick: event => { if (free(event)) menu.onClick(event); },
            onContextMenu: event => { if (!typing(event)) menu.onContextMenu(event); },
            onKeyDown: event => { if (!typing(event)) menu.onKeyDown(event); } }); } });
    const rowBody = (rule, set, isDraft, menuProps) => h('div', { className: 'ap-dm-rule', role: 'group', 'aria-label': k.title + (isDraft ? '（新）' : ''), ...menuProps },
        kind === 'chains'
            ? h(ForkInlineField, { kind: 'text', label: k.when, hideLabel: true, className: 'ap-dm-rule-when', placeholder: k.when + '…', value: rule.match || '', disabled: busy, validate: v => forkAudienceRuleProblem('match', v), onCommit: v => set({ match: v }) })
            : h(ForkInlineField, { kind: 'chips', label: k.when, hideLabel: true, className: 'ap-dm-rule-when', addLabel: '添加关键词', value: rule.keywords || [], disabled: busy, validate: list => forkAudienceRuleProblem('keywords', list), onCommit: list => set({ keywords: list }) }),
        h('span', { className: 'ap-dm-rule-arrow', 'aria-hidden': true }, '→'),
        h(ForkInlineField, { kind: 'chips', label: k.say.label, hideLabel: true, className: 'ap-dm-rule-say', addLabel: k.say.add, value: (rule[k.say.key] || []).map(forkAudienceLineText), split: forkAudienceSplitLines, disabled: busy,
            validate: list => forkAudienceRuleProblem(k.say.key, list), onCommit: list => set({ [k.say.key]: forkAudienceMergeLines(rule[k.say.key], list) }) }),
        h('span', { className: 'ap-dm-rule-nums' },
            h(ForkInlineField, { kind: 'number', label: '概率', hideLabel: true, title: '概率', className: 'ap-dm-rule-num', unit: '%', integer: true, min: 0, max: 100, value: forkAudiencePercent(rule, kind), disabled: busy,
                onCommit: v => { const p = (v ?? k.probability * 100) / 100; if (Math.abs(p - (rule.probability ?? k.probability)) > 0.001) set({ probability: p }); } }),
            kind === 'triggers' ? h(ForkInlineField, { kind: 'number', label: '冷却', hideLabel: true, title: '冷却', className: 'ap-dm-rule-num', unit: '秒', integer: true, min: 0, max: FORK_AUDIENCE_RULE_LIMITS.cooldown, value: rule.cooldown ?? 30, disabled: busy,
                onCommit: v => set({ cooldown: v ?? 30 }) }) : null));
    return h(StageSection, { title: k.title, meta: rules.length, level: 2, help: k.help, foldKey: 'audience/' + kind },
        h('div', { className: 'ap-dm-rules' },
            !rules.length && !draft ? h('p', { className: 'ap-empty' }, k.empty) : null,
            rules.map(rule => row(rule, patch => change(rule.id, patch), false)),
            draft ? row(draft, changeDraft, true) : null,
            undo ? h('p', { className: 'ap-notice', role: 'status' }, h('span', null, '已删除一条' + k.title), h(Button, { className: 'ap-hint-chip', onClick: restore }, '撤销')) : null,
            !draft && rules.length < FORK_AUDIENCE_RULE_LIMITS.rules ? h(CatAddTile, { label: k.add, className: 'ap-dm-rule-add', onClick: () => { setUndo(null); setDraft(forkAudienceRuleBlank(kind, rules)); } }) : null));
}
// Both rule sections under the entry's fields: props { content, onCommit(nextContent) }.
function ForkAudienceRuleSections({ content, onCommit }) {
    const h = React.createElement, c = content || {};
    return h(React.Fragment, null,
        h(ForkAudienceRules, { kind: 'triggers', rules: c.triggers || [], onCommit: triggers => onCommit({ ...c, triggers }) }),
        h(ForkAudienceRules, { kind: 'chains', rules: c.chains || [], onCommit: chains => onCommit({ ...c, chains }) }));
}

// FORK_MOD_CONFIG_PAGES['dsh.danmaku'] (wiring requested in output/danmaku/P6-REQUESTS.md). props as every config page,
// plus the optional onOpenModelSettings (酒馆设置 › 模组模型 at this slot) and audience ({count, onOpen}: this card's
// 观众群 in the asset library). Set-once engine settings only (docs/fork/ui-design.md R21): the model, its cadence and
// the audience groups; the view is on the stage corner, 飘屏 appearance and density in the stage CONFIG.
// Registered below in the host's FORK_MOD_CONFIG_PAGES (fork-mod-config-pages.js, included before this file).
function ForkDanmakuModPage({ rpc, onOpenModelSettings, audience }) {
    const h = React.createElement;
    const [model, setModel] = React.useState(null), [modelError, setModelError] = React.useState('');
    React.useEffect(() => {
        let live = true;
        const load = () => rpc('getTavernSettings').then(result => {
            if (!live) return;
            const s = result?.settings || {};
            setModel(forkDanmakuModelInfo({ selection: s.modModels?.[FORK_DANMAKU_MOD]?.audience || null, foreground: s.defaultForegroundModel || null, catalog: result?.modelCatalog || [] }));
            setModelError('');
        }, () => { if (live) setModelError('读取模型设置失败'); });
        load();
        window.addEventListener('dsh-tavern-mods-changed', load);
        return () => { live = false; window.removeEventListener('dsh-tavern-mods-changed', load); };
    }, [rpc]);
    const modelValue = model ? h('span', { className: 'ap-dm-model' }, model.label, model.follow ? h('span', { className: 'ap-dm-meta' }, '跟随前台') : null) : modelError ? null : h(Loading);
    const count = audience && Number.isSafeInteger(audience.count) ? audience.count : null;
    return h(React.Fragment, null,
        h(StageSection, { title: '模型', help: '弹幕只读你已读完的正文和你发出的选择，不影响剧情。', foldKey: 'mod:' + FORK_DANMAKU_MOD + '/model' },
            h(ForkInlineGrid, { label: '弹幕模型', columns: 1 },
                h(ForkInlineRow, { label: '弹幕模型' }, modelValue,
                    model && !model.available ? h(HintLine, { compact: true, text: '模型不可用', action: onOpenModelSettings ? '去选择' : undefined, onAction: onOpenModelSettings }) : null,
                    modelError ? h(HintLine, { compact: true, text: modelError }) : null,
                    onOpenModelSettings ? h('button', { type: 'button', className: 'ap-kind-jump', 'aria-label': '选择弹幕模型', title: '选择弹幕模型', onClick: onOpenModelSettings }, h(Glyph, { name: 'chevRight' })) : null),
                h(ForkInlineRow, { label: '调用节奏' }, h('span', { className: 'ap-dm-meta-value' }, forkDanmakuCadenceText())))),
        audience ? h(StageSection, { title: '观众群', meta: count ?? undefined, help: '在素材库里管理；蓝灯常驻，绿灯在提到关键词时入场。', foldKey: 'mod:' + FORK_DANMAKU_MOD + '/audience' },
            count === 0 ? h(HintLine, { text: '本卡没有开启的观众群', action: audience.onOpen ? '去添加' : undefined, onAction: audience.onOpen })
                : audience.onOpen ? h(ForkInlineGrid, { label: '观众群', columns: 1 }, h(ForkInlineField, { kind: 'link', label: '素材库', value: '观众群', onOpen: audience.onOpen })) : null) : null);
}
if (typeof FORK_MOD_CONFIG_PAGES === 'object' && FORK_MOD_CONFIG_PAGES) FORK_MOD_CONFIG_PAGES['dsh.danmaku'] = ForkDanmakuModPage;
